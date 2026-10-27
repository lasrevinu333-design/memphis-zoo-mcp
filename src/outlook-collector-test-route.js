import {createHash} from 'node:crypto';
import {outlookSyncSchema,OUTLOOK_SYNC_CONTRACT} from './outlook-event-sync.js';

const MAILBOX='eoperle@memphiszoo.org';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF=/^[a-z0-9]{20}$/;
const fail=code=>{throw new Error(code);};
const ROUTE_KEYS=new Set(['kind','project_ref','production_project_ref','writer_project_ref',
  'reader_project_ref','manager_id','approved_message_id','run_id']);

// This is a bounded, injected connector path for one original message in an
// isolated TEST project. It has no default Supabase client, mailbox token,
// scheduler, cursor, or production fallback. The caller supplies the existing
// authenticated Outlook fetch, typed writer, and named-manager reader.
export async function collectOneOutlookEventInIsolatedTest({route,messageId,fetchOriginal,
  decideEvent,importObservation,readManagerFeed}={}){
  // All callback-visible binding fields come from this one validated snapshot.
  // A caller can otherwise change its route object during the awaited fetch.
  const boundRoute=route&&Object.freeze({...route});
  if(boundRoute?.kind!=='isolated_test'||!REF.test(boundRoute.project_ref||'')
    ||!REF.test(boundRoute.production_project_ref||'')
    ||boundRoute.project_ref===boundRoute.production_project_ref
    ||boundRoute.writer_project_ref!==boundRoute.project_ref
    ||boundRoute.reader_project_ref!==boundRoute.project_ref
    ||!UUID.test(boundRoute.manager_id||'')||!UUID.test(boundRoute.run_id||'')
    ||boundRoute.approved_message_id!==messageId
    ||Object.keys(boundRoute).some(key=>!ROUTE_KEYS.has(key)))
    fail('isolated_test_route_unverified');
  if(typeof messageId!=='string'||messageId.length<8||messageId.length>1500
    ||![fetchOriginal,decideEvent,importObservation,readManagerFeed].every(fn=>typeof fn==='function'))
    fail('isolated_test_collection_input_invalid');

  // Fetch first. Source identity and digest are derived here, never accepted
  // from an event-extraction callback or a previous AI summary.
  const original=await fetchOriginal(messageId);
  if(original?.kind!=='original_message'||original?.complete!==true
    ||original?.id!==messageId||original?.mailbox!==MAILBOX
    ||typeof original.content!=='string'||!original.content.trim()
    ||Buffer.byteLength(original.content,'utf8')>262144
    ||!Number.isFinite(Date.parse(original.source_at))
    ||!Number.isFinite(Date.parse(original.received_at)))fail('outlook_original_unverified');
  const content_sha256=createHash('sha256').update(original.content,'utf8').digest('hex');
  const observed_at_utc=new Date().toISOString();
  const provenance={run_id:boundRoute.run_id,message_id:messageId,source_at:original.source_at,
    received_at:original.received_at,observed_at_utc,source_age_seconds:Math.floor(
      (Date.parse(observed_at_utc)-Date.parse(original.source_at))/1000),
    mailbox_completeness:'unknown',source_digest:content_sha256};
  const source={mailbox:MAILBOX,message_id:messageId,content_sha256,
    source_at:original.source_at,received_at:original.received_at,
    ...(original.subject?{subject:original.subject}:{})};
  // Extraction sees only the validated primitive source fields; no mutable
  // caller-owned original or nested provider object is passed through.
  const extractionView=Object.freeze({kind:original.kind,complete:original.complete,
    id:original.id,mailbox:original.mailbox,content:original.content,
    source_at:source.source_at,received_at:source.received_at,
    ...(source.subject?{subject:source.subject}:{})});
  const decision=await decideEvent(extractionView);
  if(!decision||!['apply','cancel','review'].includes(decision.action)
    ||!decision.observation||typeof decision.observation!=='object')fail('outlook_decision_invalid');
  // A decision must not supply or override source evidence.
  if(Object.hasOwn(decision.observation,'source'))fail('outlook_source_override');
  source.evidence_kind=decision.evidence_kind;
  const request=outlookSyncSchema.parse({contract_version:OUTLOOK_SYNC_CONTRACT,
    request:{action:decision.action,observation:{...decision.observation,source}}});
  // A write may have happened even if its response or ledger readback is lost.
  // Never report such an attempt as a successful or safe-to-retry import.
  let result;
  try{result=await importObservation(request,boundRoute);}
  catch{return {outcome:'IMPORT_UNCONFIRMED',import_verified:false,
    manager_readback_verified:false,...provenance};}
  if(result?.target_project_ref!==boundRoute.project_ref||!UUID.test(result?.ledger_id||'')
    ||result?.readback_verified!==true||result?.action!==decision.action
    ||!['APPLIED','CANCELLED','UNCHANGED','NEEDS_REVIEW','BLOCKED_MANUAL'].includes(result.state)
    ||(['APPLIED','CANCELLED'].includes(result.state)&&!UUID.test(result.event_id||'')))
    return {outcome:'IMPORT_UNCONFIRMED',import_verified:false,
      manager_readback_verified:false,...provenance};
  const imported={outcome:'IMPORTED_MANAGER_UNCONFIRMED',import_verified:true,
    state:result.state,ledger_id:result.ledger_id,event_id:result.event_id??null,
    replayed:result.replayed===true,manager_readback_verified:false,...provenance};
  if(!UUID.test(result.event_id||''))return imported;

  let response;
  try{response=await readManagerFeed(boundRoute);}
  catch{return imported;}
  if(response?.target_project_ref!==boundRoute.project_ref
    ||response?.ok!==true||response?.feed?.schema!=='custodial.events-feed.v1'
    ||response?.meta?.manager_id!==boundRoute.manager_id
    ||typeof response?.meta?.credential_id!=='string'||!response.meta.credential_id
    ||!Array.isArray(response.feed.rows))return imported;
  const rows=response.feed.rows.filter(row=>row?.id===result.event_id);
  if(rows.length!==1||!Number.isSafeInteger(rows[0].revision)||rows[0].revision<1)
    return imported;
  if(result.state==='APPLIED'&&result.replayed!==true){
    const event=request.request.observation.event;
    const expectedRevision=request.request.observation.expected_revision;
    if((expectedRevision!==undefined&&rows[0].revision<expectedRevision+1)
      ||rows[0].name!==event.event_name.trim()||rows[0].date!==event.event_date
      ||rows[0].start_time!==event.start_time||rows[0].end_time!==event.end_time)
      return imported;
  }
  if(result.state==='CANCELLED'&&(rows[0].status!=='CANCELLED'
    ||rows[0].revision<request.request.observation.expected_revision+1))return imported;
  return {...imported,outcome:'IMPORTED_MANAGER_READBACK',revision:rows[0].revision,
    projection_check:result.replayed===true?'identity_only_replay':'current_projection',
    manager_readback_verified:true};
}
