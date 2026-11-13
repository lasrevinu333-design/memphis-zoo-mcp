import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {qualifyNativeAlert} from './native-alert-two-stage.js';
import {validateNativeAlertRecipient,validateNativeAlertReservation} from './native-alert-reservation.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const fail=(code,terminal=false)=>Object.assign(new Error(code),{code,terminal,permanent:terminal,deferFinish:!terminal});
const invalid=()=>{throw fail('native_event_dispatch_contract_invalid');};
const providerId=v=>typeof v==='string'&&v.length<=1000&&/^projects\/[a-z][a-z0-9-]{4,62}\/messages\/[^\s\u0000-\u001f\u007f-\u009f]+$/u.test(v);
function outcomeFields(v,{prepared=false}={}){
 if(v.provider_outcome==='provider_accepted')return providerId(v.provider_message_id)&&v.error_code===null;
 if(prepared&&v.provider_outcome==='prepared')return v.provider_message_id===null&&v.error_code===null;
 return ['known_nonacceptance','delivery_outcome_unknown'].includes(v.provider_outcome)&&v.provider_message_id===null
  &&typeof v.error_code==='string'&&/^[a-z][a-z0-9_]{0,99}$/.test(v.error_code);
}
async function status(db,jobId){
 const result=await db.rpc('custodial_native_alert_dispatch_status',{p_job:jobId});
 if(result.error)throw fail('native_event_status_pending');
 const v=result.data;
 if(exact(v,['schema','reserved','dispatch_authorized'])&&v.schema==='custodial.native-alert-dispatch-status.v1'
  &&v.reserved===false&&v.dispatch_authorized===false)return null;
 if(!exact(v,['schema','reserved','dispatch_authorized','job_id','attempt_id','outcome_operation_id','content_sha256','provider_outcome','provider_message_id','error_code'])
  ||v.schema!=='custodial.native-alert-dispatch-status.v1'||v.reserved!==true||v.dispatch_authorized!==false
  ||v.job_id!==jobId||!UUID.test(v.attempt_id)||!UUID.test(v.outcome_operation_id)||v.attempt_id===v.outcome_operation_id
  ||!SHA.test(v.content_sha256)||!outcomeFields(v,{prepared:true}))invalid();
 return Object.freeze({...v});
}
function settled(value,replayed){
 if(value.provider_outcome==='provider_accepted')return Object.freeze({provider_message_id:value.provider_message_id,replayed,native_event:true});
 throw fail(value.provider_outcome==='known_nonacceptance'?'native_event_provider_refused':'native_event_outcome_unknown_no_resend',true);
}
async function target(db,job){
 const result=await db.rpc('custodial_native_alert_target',{p_job:job.job_id,p_lease:job.lease_token});
 if(result.error)throw fail('native_event_target_pending');
 const v=result.data;
 if(exact(v,['current','reason'])&&v.current===false&&['native_alert_job_superseded','native_alert_kind_unavailable','native_alert_recipient_superseded'].includes(v.reason))throw fail(v.reason,true);
 if(!exact(v,['current','kind','token','expected'])||v.current!==true||v.kind!=='EVENT'
  ||typeof v.token!=='string'||Buffer.byteLength(v.token)<20||Buffer.byteLength(v.token)>4096)invalid();
 const expected=validateNativeAlertRecipient(v.expected),payload=job.payload_json;
 if(createHash('sha256').update(v.token).digest('hex')!==expected.token_digest
  ||expected.credential_id!==payload.credential_id||expected.employee_id!==payload.employee_id
  ||expected.device_uuid!==payload.device_id
  ||expected.assignment_epoch!==String(payload.assignment_epoch))invalid();
 return Object.freeze({expected,token:v.token});
}
function sourceFromPayload(p){return{kind:'EVENT',event_id:p?.event_id,instance_id:p?.instance_id,
 event_revision:p?.event_revision,notification_kind:p?.notification_kind,source_revision:p?.source_revision,valid_until:p?.valid_until};}
function checkedPermit(permit,jobId,leaseToken,expected){
 if(permit?.reservation?.payload?.kind!=='employee_event')invalid();
 return validateNativeAlertReservation(permit,{jobId,leaseToken,expected,source:sourceFromPayload(permit.reservation.payload)});
}
export async function deliverNativeEventJob({db,pushRuntime,job,eventBody}){
 // Snapshot before any await; a caller cannot swap job/recipient/source while
 // OAuth or SQL is pending. Only real leased Event jobs enter this owner.
 job=structuredClone(job);
 if(!UUID.test(job?.job_id)||!UUID.test(job?.lease_token)||!UUID.test(job?.source_id)
  ||job.job_type!=='employee_event_push'||!job.payload_json||Object.getPrototypeOf(job.payload_json)!==Object.prototype
  ||Object.hasOwn(job.payload_json,'test_delivery')||typeof eventBody!=='function'
  ||job.payload_json.instance_id!==job.source_id||!UUID.test(job.payload_json.event_id)
  ||typeof job.payload_json.notification_key!=='string'||Buffer.byteLength(job.payload_json.notification_key)>240
  ||!UUID.test(job.payload_json.credential_id)||!UUID.test(job.payload_json.employee_id)||!UUID.test(job.payload_json.device_id)
  ||!Number.isSafeInteger(job.payload_json.assignment_epoch)||job.payload_json.assignment_epoch<1
  ||!['three_days_before','two_days_before','shift_plus_15'].includes(job.payload_json.notification_kind)
  ||job.job_key!==`employee-event-push:${job.payload_json.notification_key}`||typeof db?.rpc!=='function')invalid();
 const jobId=job.job_id,leaseToken=job.lease_token;
 const prior=await status(db,jobId);if(prior)return settled(prior,true);
 // OAuth must settle BEFORE final source/identity admission, not between a
 // short-lived SQL permit and its sole provider invocation.
 if(typeof pushRuntime?.prepareNativeEventSender!=='function')throw fail('native_event_sender_unavailable');
 let send;try{send=await pushRuntime.prepareNativeEventSender();}catch{throw fail('native_event_sender_preparation_pending');}
 if(typeof send!=='function')invalid();
 const resolved=await target(db,job);
 let permit;
 try{permit=await qualifyNativeAlert({db,jobId,leaseToken,expected:resolved.expected,eventBody});}
 catch{
  // A lost finalize response can mean the original permit was committed.
  // Resolve that ledger before considering any later attempt; never resend.
  const priorNow=await status(db,jobId);if(priorNow)return settled(priorNow,true);
  // Lost finalization is resolved only against the private original receipt.
  // Never claim or send through the legacy Event boundary as a fallback.
  throw fail('native_event_qualification_pending');
 }
 permit=checkedPermit(permit,jobId,leaseToken,resolved.expected);
 if(permit.reservation.payload.instance_id!==job.source_id
  ||permit.reservation.payload.event_id!==job.payload_json.event_id
  ||permit.reservation.payload.notification_key!==job.payload_json.notification_key
  ||permit.reservation.payload.notification_kind!==job.payload_json.notification_kind)invalid();
 let result;
 try{result=await send({permit,jobId,leaseToken,expected:resolved.expected,token:resolved.token});}
 catch{result={outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'native_event_sender_unknown'};}
 if(!exact(result,['outcome','provider_message_id','error_code'])||!outcomeFields({...result,provider_outcome:result.outcome}))
  result={outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'native_event_sender_unknown'};
 const evidence=Object.freeze({operation_id:permit.outcome_operation_id,...result});
 let acknowledged=false;
 try{
  const recorded=await db.rpc('custodial_native_alert_record_outcome',{p_job:jobId,p_operation:permit.outcome_operation_id,p_evidence:evidence});
  const v=recorded.data;
  acknowledged=!recorded.error&&exact(v,['schema','recorded','replayed','provider_outcome','provider_message_id','error_code'])
   &&v.schema==='custodial.native-alert-outcome.v1'&&v.recorded===true&&typeof v.replayed==='boolean'
   &&v.provider_outcome===evidence.outcome&&v.provider_message_id===evidence.provider_message_id&&v.error_code===evidence.error_code;
 }catch{/* Read the original receipt; never repeat the provider operation. */}
 if(acknowledged)return settled({provider_outcome:evidence.outcome,...evidence},false);
 const readback=await status(db,jobId);
 if(readback&&readback.attempt_id===permit.attempt_id&&readback.outcome_operation_id===permit.outcome_operation_id
  &&readback.content_sha256===permit.reservation.payload.content_sha256
  &&readback.provider_outcome===evidence.outcome&&readback.provider_message_id===evidence.provider_message_id&&readback.error_code===evidence.error_code)
  return settled(readback,true);
 throw fail('native_event_outcome_reconciliation_pending');
}

export function prepareNativeEventDataSender({projectId,accessToken,fetchImpl=fetch}){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)
  ||typeof accessToken!=='string'||!accessToken||/[\r\n]/.test(accessToken)||typeof fetchImpl!=='function')invalid();
 let used=false;
 return async function sendNativeEvent({permit,jobId,leaseToken,expected,token}){
  if(used)throw fail('native_event_sender_already_consumed',true);used=true;
  const p=checkedPermit(permit,jobId,leaseToken,expected);
  if(typeof token!=='string'||createHash('sha256').update(token).digest('hex')!==expected.token_digest)invalid();
  const message={token,data:p.reservation.payload,android:{priority:'high',ttl:p.ttl_seconds+'s',restricted_package_name:'org.memphiszoo.custodial'}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();
  try{
   const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,{
    method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({message}),signal:controller.signal});
   if(!response.ok){await response.body?.cancel().catch(()=>{});const refused=response.status>=400&&response.status<500&&response.status!==408;
    return{outcome:refused?'known_nonacceptance':'delivery_outcome_unknown',provider_message_id:null,error_code:refused?'fcm_http_refused':'fcm_response_unknown'};}
   if(!response.body?.getReader)throw Error('bounded response required');
   const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384)throw Error('response budget');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(text);
   if(!exact(value,['name'])||!providerId(value.name)||!value.name.startsWith(`projects/${projectId}/messages/`))throw Error('ambiguous provider receipt');
   return{outcome:'provider_accepted',provider_message_id:value.name,error_code:null};
  }catch{return{outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'fcm_response_unknown'};}
  finally{clearTimeout(timer);}
 };
}
