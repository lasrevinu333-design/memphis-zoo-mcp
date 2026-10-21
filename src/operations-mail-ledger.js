import {createHash,randomUUID} from 'node:crypto';
import {spiceworksObservation,reconcileSpiceworks,reconcileSchoolSnapshots} from './operations-mail-contract.js';
import {withApplicationMutationLease} from './restore-mutation-gate.js';

// Existing service-only Outlook ledger. No new grant, public ingestion route,
// mailbox credential, scheduler, ticket database or external ticket mutation.
// The caller must already have authenticated the connector source and separated
// current notification fields from quoted mail. Sender strings are NOT auth.
const TABLE='events_app_outlook_sync',PREFIX='custodial-operations-v1/';
const COLUMNS='id,event_id,outlook_message_id,source_event_key,received_at,payload_hash,sync_status,source_payload,created_at';
const MAX_ROWS=10000,MAX_BYTES=8*1024*1024;
const fail=code=>{throw new Error(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const boundedSignal=signal=>signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('operations_mail_not_json');
}
function keys(value,required,optional=[]){
  if(!value||Array.isArray(value)||typeof value!=='object'
    ||required.some(key=>!Object.hasOwn(value,key))
    ||Object.keys(value).some(key=>![...required,...optional].includes(key)))fail('operations_mail_shape_invalid');
}
function validated(kind,observation){
  keys(observation?.source,['mailbox','sender','message_id','content_sha256','source_at']);
  if(kind==='spiceworks'){
    keys(observation,['source','ticket_id','change_lines'],['title']);spiceworksObservation(observation);
  }else if(kind==='school'){
    keys(observation,['source','attachment','headers','rows','complete_for_dates'],['date_system']);
    keys(observation.attachment,['id','sha256']);reconcileSchoolSnapshots([observation]);
  }else fail('operations_mail_kind_invalid');
  const body=canonical({schema:'custodial.operations-mail-record.v1',kind,observation});
  if(Buffer.byteLength(body)>256*1024)fail('operations_mail_record_too_large');
  return {payload:JSON.parse(body),digest:sha(body),key:`${PREFIX}${kind}/${kind==='school'?sha(observation.attachment.id):observation.ticket_id}`};
}
function record(kind,observation){
  const v=validated(kind,observation);
  return {outlook_message_id:observation.source.message_id,source_event_key:v.key,event_id:null,
    received_at:new Date(observation.source.source_at).toISOString(),source_subject:null,
    payload_hash:v.digest,sync_status:'APPLIED',sync_note:null,source_payload:v.payload};
}
function checkedRow(row){
  if(!row||typeof row.id!=='string'||row.event_id!==null||row.sync_status!=='APPLIED')fail('operations_mail_record_invalid');
  keys(row.source_payload,['schema','kind','observation']);
  if(row.source_payload.schema!=='custodial.operations-mail-record.v1')fail('operations_mail_record_invalid');
  const {kind,observation}=row.source_payload,v=validated(kind,observation);
  if(row.source_event_key!==v.key||row.payload_hash!==v.digest||row.outlook_message_id!==observation.source.message_id
    ||Date.parse(row.received_at)!==Date.parse(observation.source.source_at)
    ||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))fail('operations_mail_binding_invalid');
  return {kind,observation,created_at:new Date(row.created_at).toISOString()};
}

// Service adapter, intentionally NOT an HTTP endpoint. An admitted collector
// may call it using its existing authority. Each observation is an atomic unit;
// the first value for its unique source key wins, without overwriting history.
export async function recordOperationsMail({client,kind,observation,signal}={}){
  if(!client?.from||!client?.rpc)fail('operations_mail_service_client_required');
  const row=record(kind,observation); // own a JSON snapshot before any await
  const timeout=boundedSignal(signal);
  const requestId=randomUUID();let leaseUnconfirmed=false;
  // Reuse the program's actual restore fence, not merely service-role access.
  // The same bounded deadline includes begin/write/readback/release. If release
  // is unconfirmed, retain the exact request ID for normal reconciliation.
  const leasedClient={rpc:(name,args)=>client.rpc(name,args).abortSignal(timeout)};
  try{
    const result=await withApplicationMutationLease({supabase:leasedClient,serviceName:'custodial-operations-outlook-import',requestId:()=>requestId,
      logger:{error(){leaseUnconfirmed=true;}},operation:async({signal:leaseSignal,assertActive})=>{
        assertActive();const result=await persistRecord(client,row,AbortSignal.any([timeout,leaseSignal]));assertActive();return result;
      }});
    if(leaseUnconfirmed)fail('operations_mail_cleanup_unconfirmed');
    return result;
  }catch(error){
    const code=typeof error?.message==='string'&&/^operations_mail_[a-z_]+$/.test(error.message)?error.message:'operations_mail_mutation_unavailable';
    throw Object.assign(new Error(code),{request_id:requestId});
  }
}
async function persistRecord(client,row,timeout){
  let written;
  try{written=await client.from(TABLE).upsert(row,{onConflict:'outlook_message_id,source_event_key',ignoreDuplicates:true}).abortSignal(timeout);}
  catch{fail('operations_mail_write_outcome_unknown');}
  if(written?.error)fail('operations_mail_write_unconfirmed');
  let saved;
  try{saved=await client.from(TABLE).select(COLUMNS).eq('outlook_message_id',row.outlook_message_id)
    .eq('source_event_key',row.source_event_key).abortSignal(timeout).single();}
  catch{fail('operations_mail_readback_unavailable');}
  if(saved?.error)fail('operations_mail_readback_unavailable');
  checkedRow(saved.data);
  if(saved.data.payload_hash!==row.payload_hash||canonical(saved.data.source_payload)!==canonical(row.source_payload))fail('operations_mail_replay_conflict');
  return {state:'SAVED_READBACK',id:saved.data.id,source_key:row.source_event_key,payload_sha256:row.payload_hash,imported_at:saved.data.created_at,
    mailbox_completeness_verified:false,external_ticket_mutation:false};
}
const unavailable=reason=>({state:'unavailable',reason,rows:[]});
export function projectOperationsMailRows(rows){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS||Buffer.byteLength(JSON.stringify(rows))>MAX_BYTES)fail('operations_mail_snapshot_limit');
  const groups={school:[],spiceworks:[]},identities=new Set();
  for(const row of rows){const r=checkedRow(row);if(identities.has(row.id))fail('operations_mail_duplicate_row');identities.add(row.id);groups[r.kind].push(r);}
  function feed(kind,project){
    const items=groups[kind];if(!items.length)return unavailable(`no_imported_${kind}_observations`);
    return {state:'snapshot',generated_at:items.map(item=>item.created_at).sort().at(-1),
      source_latest_at:items.map(item=>new Date(item.observation.source.source_at).toISOString()).sort().at(-1),
      coverage:'imported_only',mailbox_completeness_verified:false,rows:project(items.map(item=>item.observation))};
  }
  return {
    spiceworks:feed('spiceworks',items=>reconcileSpiceworks(items).map(({ticket_id,title,category,assignee,status,custodial,active,provenance})=>
      ({ticket_id,title,category,assignee,status,custodial,active,source_revision:sha(canonical(provenance))}))),
    schools:feed('school',items=>reconcileSchoolSnapshots(items).rows.map(row=>{
      const {provenance,prior_provenance,superseded_by,...display}=row;
      return {...display,source_revision:sha(canonical({provenance,prior_provenance:prior_provenance||null,superseded_by:superseded_by||null}))};
    })),
  };
}
export async function readOperationsMailLedger({client,signal}={}){
  const missing=reason=>({schools:unavailable(reason),spiceworks:unavailable(reason)});
  if(!client?.from)return missing('operations_mail_service_not_configured');
  try{
    // One statement, exact count: a response cap must not silently remove a
    // closure/reassignment/correction from the imported history.
    const {data,error,count}=await client.from(TABLE).select(COLUMNS,{count:'exact'})
      .like('source_event_key',`${PREFIX}%`).order('id').range(0,MAX_ROWS-1)
      .abortSignal(boundedSignal(signal));
    if(error)return missing('operations_mail_reader_unavailable');
    if(!Number.isSafeInteger(count)||count<0||count>MAX_ROWS||!Array.isArray(data)||data.length!==count)
      return missing('operations_mail_snapshot_incomplete');
    return projectOperationsMailRows(data);
  }catch{return missing('operations_mail_snapshot_invalid');}
}
