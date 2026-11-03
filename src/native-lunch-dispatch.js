import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateNativeLunchReservation,resolveNativeLunchTarget} from './native-lunch-reservation.js';
import {nativeLunchOutcomeBinding,recordNativeLunchOutcome,readNativeLunchOutcome} from './native-lunch-lifecycle.js';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const failure=(code,terminal=false)=>Object.assign(new Error(code),{code,terminal,permanent:terminal});
const invalid=()=>{throw failure('native_lunch_dispatch_contract_invalid');};
function micros(value){
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
 if(!m)invalid();const [y,month,day,h,min,s,us]=m.slice(1).map(Number);
 const leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)invalid();
 const ms=Date.parse(value.slice(0,19)+'Z');if(!Number.isFinite(ms))invalid();
 return BigInt(ms)*1000n+BigInt(us);
}
export function validateNativeLunchDispatch(value,{jobId,leaseToken,expected}){
 if(!exact(value,['schema','dispatch_authorized','reservation','attempt_id','outcome_operation_id','ttl_seconds'])
  ||value.schema!=='custodial.native-lunch-dispatch.v1'||value.dispatch_authorized!==true
  ||!uuid.test(value.attempt_id)||!uuid.test(value.outcome_operation_id)||value.attempt_id===value.outcome_operation_id
  ||!uuid.test(leaseToken))invalid();
 const reservation=validateNativeLunchReservation(value.reservation,{jobId,expected});
 if(reservation.dispatch_authorized!==true)invalid();
 const raw=(micros(reservation.payload.valid_until)-micros(reservation.payload.reservation_at))/1000000n;
 if(raw<=0n||!Number.isSafeInteger(value.ttl_seconds)||value.ttl_seconds!==Number(raw>2419200n?2419200n:raw))invalid();
 return Object.freeze({...value,reservation,binding:nativeLunchOutcomeBinding({reservation,leaseToken,expected})});
}
async function existingOutcome(db,jobId){
 const result=await db.rpc('custodial_native_lunch_dispatch_status',{p_job:jobId});
 if(result.error)throw failure('native_lunch_dispatch_status_pending');
 const v=result.data;
 if(exact(v,['schema','reserved','dispatch_authorized'])&&v.schema==='custodial.native-lunch-dispatch-status.v1'
  &&v.reserved===false&&v.dispatch_authorized===false)return null;
 if(!exact(v,['schema','reserved','dispatch_authorized','binding','attempt_id','outcome_operation_id'])
  ||v.schema!=='custodial.native-lunch-dispatch-status.v1'||v.reserved!==true||v.dispatch_authorized!==false
  ||v.binding?.receipt_job_id!==jobId||!((v.attempt_id===null&&v.outcome_operation_id===null)
   ||(uuid.test(v.attempt_id)&&uuid.test(v.outcome_operation_id)&&v.attempt_id!==v.outcome_operation_id)))invalid();
 return readNativeLunchOutcome({db,binding:v.binding});
}
function settled(result,replayed){
 if(result.provider_outcome==='provider_accepted')return Object.freeze({provider_message_id:result.evidence.provider_message_id,replayed,native_lunch:true});
 throw failure(result.provider_outcome==='known_nonacceptance'?'native_lunch_provider_refused':'native_lunch_outcome_unknown_no_resend',true);
}
export async function deliverNativeLunchJob({db,pushRuntime,job}){
 if(!uuid.test(job?.job_id)||!uuid.test(job?.lease_token)||job.job_type!=='employee_native_push'
  ||job.payload_json?.data_json?.kind!=='employee_lunch_coverage'||Object.hasOwn(job.payload_json.data_json,'test_delivery'))invalid();
 const jobId=job.job_id,leaseToken=job.lease_token;
 const prior=await existingOutcome(db,jobId);if(prior)return settled(prior,true);
 // The sender is an injected private one-use capability. The production
 // provider factory is not activated by this source-only LUNCH seam.
 if(typeof pushRuntime?.prepareNativeLunchSender!=='function')throw failure('native_lunch_sender_unavailable');
 let send;try{send=await pushRuntime.prepareNativeLunchSender();}catch{throw failure('native_lunch_sender_preparation_pending');}
 if(typeof send!=='function')invalid();
 const target=await resolveNativeLunchTarget({db,jobId,leaseToken});
 if(!target.current)throw failure(target.reason,true);
 const result=await db.rpc('custodial_native_lunch_dispatch_prepare',{p_job:jobId,p_lease:leaseToken,p_expected:target.expected});
 if(result.error)throw failure('native_lunch_dispatch_prepare_pending');
 if(result.data?.dispatch_authorized===false){
  const original=await existingOutcome(db,jobId);if(original)return settled(original,true);
  if(!exact(result.data,['current','dispatch_authorized','reason'])||result.data.current!==false)invalid();
  throw failure('native_lunch_admission_superseded',true);
 }
 const permit=validateNativeLunchDispatch(result.data,{jobId,leaseToken,expected:target.expected});
 let outcome;try{outcome=await send({permit,expected:target.expected,token:target.token});}
 catch{outcome={outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'native_lunch_sender_unknown'};}
 const evidence={operation_id:permit.outcome_operation_id,...outcome};
 try{
  const receipt=await recordNativeLunchOutcome({db,binding:permit.binding,evidence});
  return settled({provider_outcome:receipt.evidence.outcome,evidence:receipt.evidence},false);
 }catch(error){
  if(error.terminal)throw error;
  const status=await readNativeLunchOutcome({db,binding:permit.binding});
  if(status.evidence&&isDeepStrictEqual(status.evidence,evidence))return settled(status,true);
  throw failure('native_lunch_outcome_reconciliation_pending');
 }
}

export function prepareNativeLunchDataSender({projectId,accessToken,fetchImpl=fetch}){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)
  ||typeof accessToken!=='string'||!accessToken||/[\r\n]/.test(accessToken)||typeof fetchImpl!=='function')invalid();
 let used=false;
 return async function sendNativeLunch({permit,expected,token}){
  if(used)throw failure('native_lunch_sender_already_consumed');used=true;
  const {binding,...raw}=permit;
  const p=validateNativeLunchDispatch(raw,{jobId:permit?.reservation?.payload?.receipt_job_id,
   leaseToken:binding?.lease_token,expected});
  if(!isDeepStrictEqual(p.binding,binding)||typeof token!=='string'
   ||createHash('sha256').update(token).digest('hex')!==expected.token_digest)invalid();
  const message={token,data:p.reservation.payload,android:{priority:'high',ttl:p.ttl_seconds+'s',
   restricted_package_name:'org.memphiszoo.custodial'}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();
  try{
   const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,{
    method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({message}),signal:controller.signal});
   if(!response.ok){
    await response.body?.cancel().catch(()=>{});const refused=response.status>=400&&response.status<500&&response.status!==408;
    return {outcome:refused?'known_nonacceptance':'delivery_outcome_unknown',provider_message_id:null,
     error_code:refused?'fcm_http_refused':'fcm_response_unknown'};
   }
   if(!response.body?.getReader)throw new Error('bounded response required');
   const reader=response.body.getReader();let text='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
    if(bytes>16384)throw new Error('response budget');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const value=JSON.parse(text),prefix=`projects/${projectId}/messages/`;
   if(!exact(value,['name'])||typeof value.name!=='string'||!value.name.startsWith(prefix)
    ||value.name.length<=prefix.length||value.name.length>1000||/[\s\u0000-\u001f\u007f-\u009f]/u.test(value.name))throw new Error('ambiguous provider receipt');
   return {outcome:'provider_accepted',provider_message_id:value.name,error_code:null};
  }catch{return {outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'fcm_response_unknown'};}
  finally{clearTimeout(timer);}
 };
}
