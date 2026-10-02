import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateNativeLocationReservation,validateNativeLocationRecipient} from './native-location-reservation.js';
import {resolveNativeLocationTarget,nativeLocationOutcomeBinding,recordNativeLocationOutcome,readNativeLocationOutcome} from './native-location-lifecycle.js';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const isUuid=v=>typeof v==='string'&&uuid.test(v);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),keys.sort());
const failure=(code,terminal=false)=>Object.assign(new Error(code),{code,terminal,permanent:terminal});
const invalid=()=>{throw failure('native_location_dispatch_contract_invalid');};
const hash=v=>createHash('sha256').update(v).digest('hex');

// SQL owns the business clock. This arithmetic preserves microseconds exactly;
// it is not a device clock qualification or proof of timely provider delivery.
function micros(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v))invalid();
 const ms=Date.parse(v.slice(0,19)+'Z');if(!Number.isFinite(ms))invalid();
 return BigInt(ms)*1000n+BigInt(v.slice(20,26));
}
export function validateNativeLocationDispatch(value,{jobId,leaseToken,expected}){
 if(!exact(value,['schema','dispatch_authorized','reservation','attempt_id','outcome_operation_id','ttl_seconds'])
  ||value.schema!=='custodial.native-location-dispatch.v1'||value.dispatch_authorized!==true
  ||!isUuid(value.attempt_id)||!isUuid(value.outcome_operation_id)||value.attempt_id===value.outcome_operation_id)invalid();
 const reservation=validateNativeLocationReservation(value.reservation,{jobId,expected});
 if(!reservation.dispatch_authorized||!isUuid(leaseToken))invalid();
 const ttl=Number((micros(reservation.payload.valid_until)-micros(reservation.payload.reservation_at))/1000000n);
 if(!Number.isSafeInteger(value.ttl_seconds)||value.ttl_seconds!==Math.min(2419200,ttl)||ttl<0)invalid();
 return Object.freeze({...value,reservation,binding:nativeLocationOutcomeBinding({reservation,leaseToken,expected})});
}

async function existingOutcome(db,jobId){
 const r=await db.rpc('custodial_native_location_dispatch_status',{p_job:jobId});
 if(r.error)throw failure('native_location_dispatch_status_pending');
 if(exact(r.data,['schema','reserved','dispatch_authorized'])&&r.data.schema==='custodial.native-location-dispatch-status.v1'
  &&r.data.reserved===false&&r.data.dispatch_authorized===false)return null;
 const v=r.data;
 if(!exact(v,['schema','reserved','dispatch_authorized','binding','attempt_id','outcome_operation_id'])
  ||v.schema!=='custodial.native-location-dispatch-status.v1'||v.reserved!==true||v.dispatch_authorized!==false
  ||v.binding?.receipt_job_id!==jobId||!((v.attempt_id===null&&v.outcome_operation_id===null)
   ||(isUuid(v.attempt_id)&&isUuid(v.outcome_operation_id)&&v.attempt_id!==v.outcome_operation_id)))invalid();
 return readNativeLocationOutcome({db,binding:v.binding});
}
function settled(result,replayed){
 if(result.provider_outcome==='provider_accepted')return Object.freeze({provider_message_id:result.evidence.provider_message_id,replayed,native_location:true});
 // Prepared means the fresh permission was lost or its owner is still running.
 // Finishing this job terminally cannot grant a new attempt; inventory survives.
 throw failure(result.provider_outcome==='known_nonacceptance'?'native_location_provider_refused':'native_location_outcome_unknown_no_resend',true);
}
export async function deliverNativeLocationJob({db,pushRuntime,job}){
 if(!isUuid(job?.job_id)||!isUuid(job?.lease_token)||job.job_type!=='employee_native_push'
  ||job.payload_json?.data_json?.kind!=='employee_location_status'||Object.hasOwn(job.payload_json.data_json,'test_delivery'))invalid();
 const jobId=job.job_id,leaseToken=job.lease_token;
 const prior=await existingOutcome(db,jobId);if(prior)return settled(prior,true);
 // All OAuth awaits precede the final database-owned admission/clock sample.
 if(typeof pushRuntime?.prepareNativeLocationSender!=='function')throw failure('native_location_sender_unavailable');
 let send;
 try{send=await pushRuntime.prepareNativeLocationSender();}
 catch{throw failure('native_location_sender_preparation_pending');}
 if(typeof send!=='function')invalid();
 const target=await resolveNativeLocationTarget({db,jobId,leaseToken});
 if(!target.current)throw failure(target.reason,true);
 const r=await db.rpc('custodial_native_location_dispatch_prepare',{p_job:jobId,p_lease:leaseToken,p_expected:target.expected});
 if(r.error)throw failure('native_location_dispatch_prepare_pending');
 if(r.data?.dispatch_authorized===false){
  const original=await existingOutcome(db,jobId);if(original)return settled(original,true);
  if(!exact(r.data,['current','dispatch_authorized','reason'])||r.data.current!==false||typeof r.data.reason!=='string')invalid();
  throw failure('native_location_admission_superseded',true);
 }
 const permit=validateNativeLocationDispatch(r.data,{jobId,leaseToken,expected:target.expected});
 // No await, alternate token lookup, local time admission or retry between
 // validation and invocation. The one-use sender consumes permission first.
 let outcome;
 try{outcome=await send({permit,expected:target.expected,token:target.token});}
 catch{outcome={outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'native_location_sender_unknown'};}
 const evidence={operation_id:permit.outcome_operation_id,...outcome};
 try{
  const receipt=await recordNativeLocationOutcome({db,binding:permit.binding,evidence});
  return settled({provider_outcome:receipt.evidence.outcome,evidence:receipt.evidence},false);
 }catch(error){
  if(error.terminal)throw error;
  // Exact readback only. Missing evidence is pending, not accepted and not resend.
  const status=await readNativeLocationOutcome({db,binding:permit.binding});
  if(status.evidence&&isDeepStrictEqual(status.evidence,evidence))return settled(status,true);
  throw failure('native_location_outcome_reconciliation_pending');
 }
}

// Internal callable transport factory. A synthetic fetch is injected by tests;
// the production private OAuth closure supplies only the already existing app.
export function prepareNativeLocationDataSender({projectId,accessToken,fetchImpl=fetch}){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)||typeof accessToken!=='string'||!accessToken
  ||/[\r\n]/.test(accessToken)||typeof fetchImpl!=='function')invalid();
 let used=false;
 return async function sendNativeLocation({permit,expected,token}){
  if(used)throw failure('native_location_sender_already_consumed');used=true;
  const original=validateNativeLocationRecipient(expected);
  const {binding,...raw}=permit;
  const p=validateNativeLocationDispatch(raw,{jobId:permit?.reservation?.payload?.receipt_job_id,
   leaseToken:permit?.binding?.lease_token,expected:original});
  if(!isDeepStrictEqual(p.binding,binding)||typeof token!=='string'||hash(token)!==original.token_digest)invalid();
  const message={token,data:p.reservation.payload,android:{priority:'high',ttl:p.ttl_seconds+'s',restricted_package_name:'org.memphiszoo.custodial'}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();
  // Transport timeout is a resource budget, not an expiry/clock safety premise.
  try{
   const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,{
    method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({message}),signal:controller.signal});
   if(!response.ok){
    await response.body?.cancel().catch(()=>{});
    const refused=response.status>=400&&response.status<500&&response.status!==408;
    return {outcome:refused?'known_nonacceptance':'delivery_outcome_unknown',provider_message_id:null,error_code:refused?'fcm_http_refused':'fcm_response_unknown'};
   }
   if(!response.body?.getReader)throw new Error('bounded response required');
   const reader=response.body.getReader();let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384)throw new Error('response budget');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(text),prefix=`projects/${projectId}/messages/`;
   if(!exact(value,['name'])||typeof value.name!=='string'||!value.name.startsWith(prefix)||value.name.length<=prefix.length
    ||value.name.length>1000||/[\s\u0000-\u001f\u007f-\u009f]/u.test(value.name))throw new Error('ambiguous provider receipt');
   return {outcome:'provider_accepted',provider_message_id:value.name,error_code:null};
  }catch{return {outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'fcm_response_unknown'};}
  finally{clearTimeout(timer);}
 };
}
