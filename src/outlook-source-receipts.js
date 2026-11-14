import {readSchoolSourceReceipts} from './operations-mail-ledger.js';
import {publicOperationsDetails} from './public-dashboard-details.js';
import {listSourceBoundEvents} from './events-api.js';
import {runReadOnlySql} from './supabase/read.js';

export const OUTLOOK_SOURCE_RECEIPT_SCHEMA='custodial.outlook-source-receipt.v1';
const TABLE='events_app_outlook_sync',PREFIX='custodial-outlook-events-v1/event/';
// Retain the existing imported-mail and canonical event projection bounds.
const MAX_ROWS=10000,MAX_BYTES=8*1024*1024,MAX_EVENTS=500;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const STATES=new Set(['APPLIED','CANCELLED','UNCHANGED','NEEDS_REVIEW','BLOCKED_MANUAL']);
const COLUMNS='id,event_id,outlook_message_id,source_event_key,payload_hash,sync_status,source_payload,received_at,created_at';
const fail=()=>{throw Error('outlook_source_receipt_unavailable');};
const validInstant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function completeRows(result,limit=MAX_ROWS){
  if(result?.error||!Number.isSafeInteger(result?.count)||result.count<0||result.count>limit
    ||!Array.isArray(result.data)||result.data.length!==result.count
    ||Buffer.byteLength(JSON.stringify(result.data))>MAX_BYTES)fail();
  return result.data;
}

async function canonicalEvents({records,current,now,readSql}){
  const ids=[...new Set(records.map(row=>row.event_id).filter(Boolean))];
  if(!ids.length)return{state:'not_applicable',events:[],reason:'no_bound_canonical_event'};
  try{
    if(ids.length>MAX_EVENTS)fail();
    current();
    const rows=await listSourceBoundEvents(async sql=>{
      current();const result=await readSql({sql});current();
      if(result?.ok!==true||result.row_limit_truncated!==false||result.response_truncated!==false
        ||!Array.isArray(result.rows)||result.rowCount!==result.rows.length
        ||Buffer.byteLength(JSON.stringify(result.rows))>MAX_BYTES)fail();
      return result.rows;
    },ids),seen=new Set();
    current();
    for(const row of rows){
      if(!UUID.test(row.id)||!ids.includes(row.id)||seen.has(row.id.toLowerCase())
        ||!Number.isSafeInteger(row.revision)||row.revision<1)fail();
      seen.add(row.id.toLowerCase());
    }
    // Same approved public fields and audience exclusions, but no active-time
    // filter: an ended event may still have a real protected source binding.
    const generated=now(),events=publicOperationsDetails(rows,null,generated).events;
    const exposed=new Set(events.map(row=>row.id));
    return{state:'snapshot',generated_at:generated.toISOString(),events,
      not_exposed_event_ids:ids.filter(id=>!exposed.has(id)),
      current_public_feed_visibility_verified:false,
      consistency:'separate_protected_reads_not_an_atomic_cross_table_snapshot'};
  }catch{
    current();
    return{state:'unavailable',reason:'canonical_event_source_unavailable'};
  }
}

// Only original source identities/document bytes or an established exact event
// key select records. No caller SQL,
// namespace, arbitrary event ID, manager identity, raw payload or free-text search.
// This observes persisted bindings; it does not recreate a past tool-call receipt,
// certify Microsoft provenance, publish a review item or complete a mailbox scan.
export async function readOutlookSourceReceipts({client,selector,signal,assertCurrent,
  validateEventObservation,now=()=>new Date(),readSql=runReadOnlySql}={}){
  const current=()=>{if(signal?.aborted)fail();assertCurrent?.();};
  current();
  let records,canonical={state:'not_applicable',reason:'school_source_receipt'};
  if(selector.kind==='school_attachment'){
    records=await readSchoolSourceReceipts({client,attachmentSha256:selector.attachment_sha256,signal,assertCurrent:current});
  }else if(selector.kind==='event_notice'||selector.kind==='event_key'){
    const query=client.from(TABLE).select(COLUMNS,{count:'exact'});
    const selected=selector.kind==='event_notice'
      ?query.eq('outlook_message_id',selector.message_id).like('source_event_key',`${PREFIX}%`)
      :query.eq('source_event_key',PREFIX+selector.source_event_key);
    const result=await selected.order('id').range(0,MAX_ROWS-1).abortSignal(signal).retry(false);
    current();
    const seen=new Set();
    records=completeRows(result).map(row=>{
      const observation=row.source_payload;
      if(!UUID.test(row.id)||seen.has(row.id.toLowerCase())||!HASH.test(row.payload_hash)||!STATES.has(row.sync_status)
        ||(row.event_id!==null&&!UUID.test(row.event_id))
        ||(row.sync_status!=='NEEDS_REVIEW'&&row.event_id===null)
        ||!validInstant(row.received_at)||!validInstant(row.created_at)
        ||(selector.kind==='event_notice'&&row.outlook_message_id!==selector.message_id)
        ||observation?.source?.message_id!==row.outlook_message_id
        ||(selector.kind==='event_key'&&observation?.source_event_key!==selector.source_event_key)
        ||row.source_event_key!==PREFIX+observation?.source_event_key
        ||Date.parse(row.received_at)!==Date.parse(observation?.source?.received_at))fail();
      validateEventObservation(observation,row.sync_status);
      // JSON preserves UUID casing while PostgreSQL UUID columns normalize it.
      // An explicit observed target must still name this exact stored binding.
      if(Object.hasOwn(observation,'event_id')
        &&observation.event_id.toLowerCase()!==row.event_id?.toLowerCase())fail();
      seen.add(row.id.toLowerCase());
      const source=observation.source;
      return{ledger_id:row.id,event_id:row.event_id,source_key:row.source_event_key,
        state:row.sync_status,payload_sha256:row.payload_hash,
        imported_at:new Date(row.created_at).toISOString(),
        source:{mailbox:source.mailbox,message_id:source.message_id,content_sha256:source.content_sha256,
          evidence_kind:source.evidence_kind,source_at:source.source_at,received_at:source.received_at},
        binding:selector.kind==='event_notice'?'exact_original_message_id':'exact_established_event_key',
        integrity:'protected_ledger_binding_observed',
        publication_verified:false,review_required:row.sync_status==='NEEDS_REVIEW'};
    });
    canonical=await canonicalEvents({records,current,now,readSql});
  }else fail();
  current();
  const result={schema:OUTLOOK_SOURCE_RECEIPT_SCHEMA,state:records.length?'found':'not_found',
    query_scope:selector.kind,records,canonical_events:canonical,
    original_write_call_receipt_recreated:false,
    source_observation_kind:'authenticated_connected_agent_not_provider_attestation',
    mailbox_completeness_verified:false,collector_activation_verified:false};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_BYTES)fail();
  current();return result;
}
