import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {resolveSupabaseClient} from './supabase/client.js';

// Connected-agent source observations, not Microsoft attestations. The existing
// collector must read the original source and complete all pages before it may
// assert completeness. This adapter neither reads mail nor starts a collector.
export const OUTLOOK_SYNC_CONTRACT='custodial.outlook-event-sync-adapter.v1';
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid();
const instant=z.string().datetime({offset:true});
const source=z.object({mailbox:z.literal('eoperle@memphiszoo.org'),message_id:z.string().min(8).max(1500),
  content_sha256:hash,evidence_kind:z.enum(['original_event_notice','event_update','event_cancellation']),
  source_at:instant,received_at:instant,subject:z.string().max(200).optional()}).strict();
const event=z.object({event_name:z.string().min(1).max(180),event_scope:z.enum(['ZOO_WIDE','SINGLE_VENUE','MULTI_VENUE','OFFSITE']),
  primary_venue_id:uuid.nullable().optional(),venue_ids:z.array(uuid).max(100).optional(),location_group_id:uuid.nullable().optional(),
  display_location:z.string().max(240).nullable().optional(),event_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),start_time:z.string().regex(/^\d{2}:\d{2}:\d{2}$/),end_time:z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  start_instant_utc:instant,end_instant_utc:instant,attendee_count:z.number().int().min(0).max(2147483647).nullable().optional(),
  custodial_public_notes:z.string().max(500).nullable().optional(),custodial_note_codes:z.array(z.enum(['trash_boxes','extra_cans','restroom_checks'])).max(3).optional(),
  coverage_location_ids:z.array(uuid).max(100).optional()}).strict();
const identity={source,source_event_key:z.string().min(5).max(400),event_id:uuid.optional(),expected_revision:z.number().int().positive().max(2147483647).optional()};
export const outlookSyncSchema=z.object({contract_version:z.literal(OUTLOOK_SYNC_CONTRACT),
  request:z.discriminatedUnion('action',[
    z.object({action:z.literal('status'),observation:z.object({}).strict()}).strict(),
    z.object({action:z.literal('apply'),observation:z.object({...identity,event}).strict()}).strict(),
    z.object({action:z.literal('cancel'),observation:z.object({...identity,event_id:uuid,expected_revision:z.number().int().positive(),
      source:source.extend({evidence_kind:z.literal('event_cancellation')}),reason:z.string().max(1000).optional()}).strict()}).strict(),
    z.object({action:z.literal('review'),observation:z.object({...identity,reason:z.string().min(1).max(1000)}).strict()}).strict(),
    z.object({action:z.literal('checkpoint'),observation:z.object({mailbox:z.literal('eoperle@memphiszoo.org'),run_id:uuid,
      from:instant,through:instant,complete:z.literal(true),pages_read:z.number().int().min(1).max(9999999),evidence_sha256:hash}).strict()}).strict(),
  ])}).strict();
export const OUTLOOK_SYNC_SCHEMA_SHA256=createHash('sha256').update(JSON.stringify(z.toJSONSchema(outlookSyncSchema))).digest('hex');
const fail=code=>{throw new Error(code);};
function principal(extra){
  const a=extra?.authInfo,s=a?.extra?.authSource;
  if(!a||(a.expiresAt!==undefined&&(!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=Math.floor(Date.now()/1000))))fail('outlook_sync_principal_required');
  if(s==='connector_token'&&a.clientId==='memphis-mcp-connector-token')return a;
  if(s!=='self_contained_oauth'||!['mcp:read','mcp:write'].every(v=>a.scopes?.includes(v))
    ||![a.extra?.issuer,a.extra?.subject,a.clientId].every(v=>typeof v==='string'&&v.length>0&&v.length<=2048))fail('outlook_sync_principal_required');
  return a;
}
// Bind only validated authorization metadata, never the token or other secrets.
// Replacing an equivalent authInfo/context is not renewal of this invocation.
function originalPrincipal(extra){
  const auth=principal(extra),context=auth.extra,scopes=auth.scopes;
  const source=context?.authSource,client=auth.clientId,issuer=context?.issuer,subject=context?.subject,expiry=auth.expiresAt;
  const scopeValues=Array.isArray(scopes)?scopes.slice():null;
  return ()=>{
    if(extra.authInfo!==auth||auth.extra!==context||auth.clientId!==client||auth.expiresAt!==expiry
      ||context?.authSource!==source||context?.issuer!==issuer||context?.subject!==subject||auth.scopes!==scopes
      ||scopeValues&&(scopes.length!==scopeValues.length||scopeValues.some((value,index)=>scopes[index]!==value)))
      fail('outlook_sync_principal_required');
    principal(extra);
  };
}
function status(value){
  if(value?.schema!=='custodial.outlook-event-sync.v1'||value.writer_ready!==true||value.mailbox!=='eoperle@memphiszoo.org')fail('outlook_sync_status_invalid');
  for(const key of ['cursor','checkpoint_at','last_import_at'])if(value[key]!==null&&(!instant.safeParse(value[key]).success))fail('outlook_sync_status_invalid');
  return {schema:value.schema,writer_ready:true,mailbox:value.mailbox,cursor:value.cursor,checkpoint_at:value.checkpoint_at,last_import_at:value.last_import_at};
}
export async function callOutlookEventSync(args,extra,{client,signal}={}){
  const requireOriginal=originalPrincipal(extra),checked=outlookSyncSchema.parse(args),{action,observation}=checked.request;
  if(Buffer.byteLength(JSON.stringify(observation))>65536)fail('outlook_sync_observation_limit');
  const service=resolveSupabaseClient(client),timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
  const current=()=>{
    try{requireOriginal();if(timeout.aborted)fail('outlook_sync_cancelled');}
    catch{fail(action==='status'?'outlook_sync_status_unavailable':'outlook_sync_write_unconfirmed');}
  };
  let response;
  try{current();response=await service.rpc('custodial_outlook_event_sync_v1',{p_action:action,p_observation:observation}).abortSignal(timeout).retry(false);current();}
  catch{fail(action==='status'?'outlook_sync_status_unavailable':'outlook_sync_write_unconfirmed');}
  if(response?.error)fail(action==='status'?'outlook_sync_status_unavailable':'outlook_sync_write_unconfirmed');
  if(action==='status'){const observed=status(response?.data);current();return observed;}
  const checkpoint=action==='checkpoint',key=checkpoint?'custodial-outlook-events-v1/checkpoint':`custodial-outlook-events-v1/event/${observation.source_event_key}`;
  const message=checkpoint?`collector:${observation.run_id}`:observation.source.message_id;
  let saved;
  current();
  try{saved=await service.from('events_app_outlook_sync').select('id,event_id,outlook_message_id,source_event_key,payload_hash,sync_status,source_payload')
    .eq('outlook_message_id',message).eq('source_event_key',key).abortSignal(timeout).retry(false).single();}
  catch{fail('outlook_sync_readback_unconfirmed');}
  current();
  const row=saved?.data,result=response?.data;
  if(saved?.error||!uuid.safeParse(row?.id).success||row.outlook_message_id!==message||row.source_event_key!==key
    ||!hash.safeParse(row.payload_hash).success||!isDeepStrictEqual(row.source_payload,observation))fail('outlook_sync_readback_unconfirmed');
  if(checkpoint){
    if(result?.state!=='CHECKPOINT_SAVED'||Date.parse(result.through)!==Date.parse(observation.through)
      ||row.sync_status!=='UNCHANGED'||row.event_id!==null)fail('outlook_sync_readback_unconfirmed');
  }else if(result?.schema!=='custodial.outlook-event-sync.v1'||!['APPLIED','CANCELLED','UNCHANGED','NEEDS_REVIEW','BLOCKED_MANUAL'].includes(result.state)
    ||row.sync_status!==result.state||row.event_id!==result.event_id||(row.event_id!==null&&!uuid.safeParse(row.event_id).success)
    ||(result.ledger_id!==undefined&&result.ledger_id!==row.id)
    ||(result.source_sha256!==undefined&&result.source_sha256!==row.payload_hash))fail('outlook_sync_readback_unconfirmed');
  const verified={contract_version:OUTLOOK_SYNC_CONTRACT,action,state:result.state,ledger_id:row.id,event_id:row.event_id,
    ...(checkpoint?{through:observation.through}:{}),replayed:result.replayed===true,readback_verified:true,
    source_observation_kind:'authenticated_connected_agent_not_provider_attestation',
    collector_activation_verified:false,external_mail_or_ticket_mutation:false};
  current();return verified;
}
