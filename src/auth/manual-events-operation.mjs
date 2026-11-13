import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import express from 'express';
import {normalizeEventPayload,getEventReferenceData} from '../events-api.js';
import {isCustodialLeadershipManagementSession} from './manager-permissions.js';
const fault=(code,status=403)=>Object.assign(new Error(code),{code,status});
const path='/custodial-leadership-internal/manual-events';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const rawFields=['operation_id','expected_revision','event_name','event_scope','primary_venue_id','venue_ids','display_location','location_group_id','location_group_name','coverage_location_ids','staffing_area_ids','source_location_text','source_text','source_format','parser_confidence','needs_review','parse_reason','manually_overridden','event_timezone','event_date','end_date','start_time','end_time','start_instant_utc','end_instant_utc','attendee_count','notes','custodial_note_codes','custodial_public_notes'];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function validateManualEventInput(input){
 if(!object(input)||Buffer.byteLength(JSON.stringify(input),'utf8')>65536)throw fault('invalid_manual_event_request',422);
 if(input.kind==='status'){
  if(!exact(input,['kind','operation_id'])||!uuid(input.operation_id))throw fault('invalid_manual_event_request',422);
  return input;
 }
 if(!exact(input,['kind','event_id','request_digest','record'])||input.kind!=='save'||input.event_id!==null&&!uuid(input.event_id)
  ||!object(input.record)||Object.keys(input.record).some(k=>!rawFields.includes(k))||!uuid(input.record.operation_id)
  ||input.event_id===null&&!['paste','csv','spreadsheet','manual_form'].includes(input.record.source_format)
  ||input.event_id!==null&&input.record.source_format!==null&&typeof input.record.source_format!=='string'
  ||input.record.source_text!==null&&(typeof input.record.source_text!=='string'||input.record.source_text.length>40000)
  ||input.event_id!==null&&(!Number.isSafeInteger(input.record.expected_revision)||input.record.expected_revision<1)
  ||input.event_id===null&&Object.hasOwn(input.record,'expected_revision')
  ||input.request_digest!==digest({event_id:input.event_id,record:input.record}))throw fault('invalid_manual_event_request',422);
 return input;
}
// Explicit user-intent projection. Database audit columns and derived overnight
// display metadata never participate in the intent comparison.
const intentFields=['event_name','event_scope','status','primary_venue_id','venue_ids','display_location','location_group_id','coverage_location_ids','staffing_area_ids','source_location_text','parser_confidence','needs_review','parse_reason','source_text','source_format','event_timezone','event_date','end_date','start_time','end_time','start_instant_utc','end_instant_utc','attendee_count','notes','custodial_note_codes','custodial_public_notes'];
export function manualEventIntent(record){
 const result={};
 for(const key of intentFields){let value=record[key];
  if(['start_time','end_time'].includes(key)&&typeof value==='string')value=value.slice(0,5);
  if(['start_instant_utc','end_instant_utc'].includes(key)&&value)value=new Date(value).toISOString();
  if(Array.isArray(value))value=[...value].sort();
  result[key]=value;
 }
 return result;
}
export function createManualEventOperation({database,service,verifyTransaction,requestId=randomUUID}){
 if(!database?.connect||typeof service?.authenticateManagerSessionToken!=='function'||typeof verifyTransaction!=='function')throw fault('manual_event_authority_unavailable',503);
 let outstanding=0;
 return async({token,csrfToken,input})=>{
  const selected=validateManualEventInput(input);
  const verified=await service.authenticateManagerSessionToken({token,csrf:csrfToken,requireCsrf:selected.kind==='save'});
  const manager=verified.managerSession;
  if(!isCustodialLeadershipManagementSession(manager)||manager.identity_assurance!=='SELF_ASSERTED_NAME'||manager.individual_identity_verified!==false)throw fault('manual_event_authority_denied');
  if(outstanding>=4)throw fault('manual_event_busy',503);
  outstanding++;let client,commitStarted=false;
  try{
   client=await database.connect();await client.query('begin');await client.query('set local role static_weekly_control_plane');
   await client.query("set local statement_timeout='5000ms'");await client.query("set local lock_timeout='5000ms'");
   const originalRequestId=requestId();const actor=await verifyTransaction(client,{manager:{...manager,token},leadershipRequestId:originalRequestId});
   if(actor?.policy_version!==manager.permissions.policyVersion||actor.claimed_account_id!==manager.claimed_manager_id||actor.request_id!==originalRequestId
    ||actor.identity_assurance!=='SELF_ASSERTED_NAME'||actor.individual_identity_verified!==false)throw fault('manual_event_authority_denied');
   let canonical;
   const invoke=async(kind,input)=>{
    const r=await client.query('select public.custodial_leadership_manual_event_operation_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',[manager.manager_id,manager.credential_id,manager.device_id,kind,JSON.stringify(input)]);
    if(r.rows?.length!==1||!object(r.rows[0].result))throw fault('manual_event_readback_unavailable',503);
    return r.rows[0].result;
   };
   const finish=async result=>{
    if(!['SAVED','NOT_SAVED','OUTCOME_UNKNOWN'].includes(result.state)||result.operation_id!==(selected.kind==='save'?selected.record.operation_id:selected.operation_id))throw fault('manual_event_readback_unavailable',503);
    if(selected.kind==='save'&&(result.state==='OUTCOME_UNKNOWN'||result.request_digest!==selected.request_digest))throw fault('manual_event_readback_unavailable',503);
    if(result.state==='SAVED'&&(!uuid(result.event?.id)||!Number.isSafeInteger(result.event.revision)||result.event.revision<1
     ||selected.kind==='save'&&selected.event_id!==null&&result.event.id!==selected.event_id
     ||canonical&&!isDeepStrictEqual(manualEventIntent(result.event),manualEventIntent(canonical))))throw fault('manual_event_readback_unavailable',503);
    if(result.state==='NOT_SAVED'&&!['EVENT_CHANGED','REVIEW_REQUIRED'].includes(result.rejection_code))throw fault('manual_event_readback_unavailable',503);
    // Same transaction holds verified cohort/policy locks through COMMIT.
    commitStarted=true;await client.query('commit');return result;
   };
   if(selected.kind==='status')return await finish(await invoke('status',{operation_id:selected.operation_id}));
   const prior=await invoke('status',{operation_id:selected.record.operation_id});
   if(['SAVED','NOT_SAVED'].includes(prior.state))return await finish(prior);
   if(prior.state!=='OUTCOME_UNKNOWN')throw fault('manual_event_readback_unavailable',503);
   // Reference reads share this exact authorized transaction.
   const references=await invoke('references',{});
   const refs=await getEventReferenceData(async sql=>{
    const rows=references[createHash('sha256').update(sql).digest('hex')];
    if(!Array.isArray(rows))throw fault('manual_event_references_unavailable',503);return rows;
   });
   try{
    canonical=normalizeEventPayload(selected.record,refs);
    if(canonical.needs_review||canonical.event_scope==='UNKNOWN')throw fault('manual_event_review_required',422);
   }catch{
    canonical=null;
    return await finish(await invoke('reject',{operation_id:selected.record.operation_id,request_digest:selected.request_digest}));
   }
   return await finish(await invoke('save',{operation_id:selected.record.operation_id,event_id:selected.event_id,expected_revision:selected.event_id?selected.record.expected_revision:null,request_digest:selected.request_digest,record:canonical}));

  }catch(e){if(client)await client.query('rollback').catch(()=>{});if(commitStarted)throw fault('manual_event_outcome_unconfirmed',503);throw e;}
  finally{client?.release();outstanding--;}
 };
}
export function installManualEventCompanion({router,database,service,verifyTransaction,requireOrigin,token}){
 const operation=database?.connect?createManualEventOperation({database,service,verifyTransaction}):null;
 router.post(path,express.json({limit:'80kb'}),async(req,res)=>{
  try{
   const b=req.body;if(!exact(b,['csrfToken','input','origin'])||typeof b.origin!=='string'||typeof b.csrfToken!=='string')throw fault('invalid_manual_event_request',422);
   const input=validateManualEventInput(b.input);requireOrigin(b.origin);
   if(!operation)throw fault('manual_event_authority_unavailable',503);
   const data=await operation({token:token(req),csrfToken:b.csrfToken,input});res.set('Cache-Control','no-store').json({ok:true,data});
  }catch(e){res.set('Cache-Control','no-store').status([403,422].includes(e.status)?e.status:503).json({ok:false,error:'Manual event result could not be confirmed.',state:'OUTCOME_UNKNOWN',retry_safe:false});}
 });
}
export function createManualEventBridge({env=process.env,fetchImpl=fetch}={}){
 return async(req,input)=>{
  if(env.CUSTODIAL_LEADERSHIP_PIN_ENABLED!=='true'||!isCustodialLeadershipManagementSession(req.memphisAuth))throw fault('manual_event_authority_denied');
  const selected=validateManualEventInput(input);
  try{
   const u=new URL(String(env.STATIC_WEEKLY_CONTROL_PLANE_PUBLIC_URL||''));
   if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||(u.protocol!=='https:'&&!(env.CUSTODIAL_LEADERSHIP_ALLOW_LOOPBACK_TEST==='true'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error();
   const response=await fetchImpl(u.origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+req.memphisAuth.token},body:JSON.stringify({input:selected,origin:String(req.get?.('Origin')||''),csrfToken:String(req.get?.('X-CSRF-Token')||'')})});
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks=[];let n=0;
   try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.byteLength;if(n>1048576)throw Error();chunks.push(Buffer.from(p.value));}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!response.ok||body?.ok!==true||!object(body.data))throw Error();
   return body.data;
  }catch{throw fault('manual_event_outcome_unconfirmed',503);}
 };
}
