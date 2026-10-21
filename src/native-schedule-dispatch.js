import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
import{validateNativeLocationRecipient}from'./native-location-reservation.js';
import{prepareNativeScheduleAttempt,validateNativeScheduleDispatch,readNativeScheduleAttempt,recordNativeScheduleOutcome}from'./native-schedule-attempt-lifecycle.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const KEYS='schema kind notification_type title body channel_id route notification_key service_date boundary_local employee_id generation_id source_reservation_id source_operation_id source_window_sha256 server_source_sha256 source_revision projection_id publication_id version_id assignment_occurrence_id source_valid_from source_valid_until'.split(' ');
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(k=>typeof k==='string'
 &&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...keys].sort());
const hash=v=>createHash('sha256').update(v).digest('hex'),id=v=>typeof v==='string'&&UUID.test(v);
const failure=(code,terminal=false)=>Object.assign(new Error(code),{code,terminal,permanent:terminal,deferFinish:!terminal});
const invalid=()=>{throw failure('native_schedule_dispatch_contract_invalid');};
function candidate(v,expected,source){
 if(!exact(v,KEYS)||Object.entries(v).some(([k,x])=>typeof x!=='string'||!x||Buffer.from(x,'utf8').toString('utf8')!==x
  ||/[\u0000-\u001f\u007f-\u009f]/u.test(x)||Buffer.byteLength(x)>({title:180,notification_key:240}[k]||1000))
  ||v.schema!=='custodial.native-schedule-content-candidate.v1'||v.kind!=='employee_schedule_ownership'||v.notification_type!=='schedule_ownership'
  ||v.channel_id!=='employee-schedule-ownership'||v.route!=='employee-schedule.html?hub=employee'||v.boundary_local!=='09:45'
  ||v.employee_id!==expected.employee_id||v.generation_id!==expected.generation_id||v.source_reservation_id!==source
  ||v.notification_key!==`schedule-ownership:${v.service_date}:${expected.employee_id}:09:45`
  ||!['source_reservation_id','source_operation_id','projection_id','publication_id','version_id','assignment_occurrence_id'].every(k=>id(v[k]))
  ||!['source_window_sha256','server_source_sha256'].every(k=>SHA.test(v[k]))
  ||!/^[1-9][0-9]{0,15}$/.test(v.source_revision)||BigInt(v.source_revision)>9007199254740991n)invalid();
 return Object.freeze({...v});
}
export async function resolveNativeScheduleTarget({db,jobId,leaseToken,sourceReservationId}){
 if(![jobId,leaseToken,sourceReservationId].every(id)||typeof db?.rpc!=='function')invalid();
 let r;try{r=await db.rpc('custodial_native_schedule_target',{p_job:jobId,p_lease:leaseToken});}catch{throw failure('native_schedule_target_pending');}
 if(r?.error)throw failure('native_schedule_target_pending');const v=r?.data;
 if(exact(v,['schema','current','delivery_admitted','reason'])&&v.schema==='custodial.native-schedule-target.v1'
  &&v.current===false&&v.delivery_admitted===false&&v.reason==='native_schedule_target_unavailable')return Object.freeze({...v});
 if(!exact(v,['schema','current','delivery_admitted','expected','token','source_candidate'])||v.schema!=='custodial.native-schedule-target.v1'
  ||v.current!==true||v.delivery_admitted!==false||typeof v.token!=='string'||Buffer.byteLength(v.token)<20
  ||Buffer.byteLength(v.token)>4096||/[\r\n\u0000]/.test(v.token))invalid();
 const expected=validateNativeLocationRecipient(v.expected),sourceCandidate=candidate(v.source_candidate,expected,sourceReservationId);
 if(hash(v.token)!==expected.token_digest)invalid();
 return Object.freeze({current:true,delivery_admitted:false,expected,token:v.token,sourceCandidate});
}
function settled(a,replayed){
 if(a.provider_outcome==='provider_accepted')return Object.freeze({provider_message_id:a.evidence.provider_message_id,replayed,native_schedule:true,delivery_admitted:false});
 throw failure(a.provider_outcome==='known_nonacceptance'?'native_schedule_provider_refused':'native_schedule_outcome_unknown_no_resend',true);
}
// This callable seam is NOT installed into the worker. The worker's existing
// native qualification hold stays first; the injected sender is private.
export async function deliverNativeScheduleJob({db,pushRuntime,job}){
 if(!id(job?.job_id)||!id(job?.lease_token)||job.job_type!=='employee_native_push'
  ||!exact(job.payload_json,['credential_id','device_id','device_identifier','employee_id','assignment_epoch','data_json'])
  ||!exact(job.payload_json.data_json,['kind','source_reservation_id'])||job.payload_json.data_json.kind!=='employee_schedule_ownership'
  ||!id(job.payload_json.data_json.source_reservation_id)||!id(job.payload_json.credential_id)||!id(job.payload_json.device_id)||!id(job.payload_json.employee_id)
  ||typeof job.payload_json.assignment_epoch!=='string'||!/^[1-9][0-9]{0,15}$/.test(job.payload_json.assignment_epoch)
  ||BigInt(job.payload_json.assignment_epoch)>9007199254740991n||!/^KIOSK_(?:0[2-9]|10)$/.test(job.payload_json.device_identifier)
  ||job.job_key!==`employee-schedule-push:${job.payload_json.data_json.source_reservation_id}:${job.payload_json.credential_id}`)invalid();
 const jobId=job.job_id,leaseToken=job.lease_token,sourceReservationId=job.payload_json.data_json.source_reservation_id;
 const prior=await readNativeScheduleAttempt({db,jobId});
 if(prior.status==='ATTEMPT_RECONCILIATION_PENDING')throw failure('native_schedule_dispatch_status_pending');
 if(prior.attempted){
  const b=prior.attempt.binding;if(b.source_reservation_id!==sourceReservationId||b.receipt_credential_id!==job.payload_json.credential_id
   ||b.receipt_employee_id!==job.payload_json.employee_id||b.receipt_device_id!==job.payload_json.device_identifier
   ||b.receipt_assignment_epoch!==job.payload_json.assignment_epoch)invalid();return settled(prior.attempt,true);
 }
 // OAuth/private resource preparation awaits precede the SQL-owned clock.
 if(typeof pushRuntime?.prepareNativeScheduleSender!=='function')throw failure('native_schedule_sender_unavailable');
 let send;try{send=await pushRuntime.prepareNativeScheduleSender();}catch{throw failure('native_schedule_sender_preparation_pending');}
 if(typeof send!=='function')invalid();
 const target=await resolveNativeScheduleTarget({db,jobId,leaseToken,sourceReservationId});
 if(!target.current)throw failure(target.reason,true);
 const {expected,token,sourceCandidate}=target;
 if(expected.credential_id!==job.payload_json.credential_id||expected.employee_id!==job.payload_json.employee_id
  ||expected.device_id!==job.payload_json.device_identifier||expected.assignment_epoch!==job.payload_json.assignment_epoch)invalid();
 const permit=await prepareNativeScheduleAttempt({db,jobId,leaseToken,sourceReservationId,expected,sourceCandidate});
 if(permit.dispatch_authorized!==true){
  const original=await readNativeScheduleAttempt({db,jobId});if(original.attempted)return settled(original.attempt,true);
  if(permit.status==='ATTEMPT_RECONCILIATION_PENDING'||original.status==='ATTEMPT_RECONCILIATION_PENDING')throw failure('native_schedule_attempt_reconciliation_pending');
  throw failure('native_schedule_admission_superseded',true);
 }
 // No alternate lookup, local-clock admission, await or retry before invoke.
 let outcome;try{outcome=await send({permit,expected,sourceCandidate,token});}
 catch{outcome={outcome:'delivery_outcome_unknown',provider_message_id:null,error_code:'native_schedule_sender_unknown'};}
 const evidence={...outcome,operation_id:permit.attempt.outcome_operation_id};
 const result=await recordNativeScheduleOutcome({db,binding:permit.attempt.binding,evidence});
 if(result.attempt)return settled(result.attempt,true);
 if(result.evidence)return settled({provider_outcome:result.evidence.outcome,evidence:result.evidence},result.replayed);
 throw failure('native_schedule_outcome_reconciliation_pending');
}

// Deliberately requires an explicitly injected fetch. Constructing this private
// capability does not qualify a worker, clock, release or handset for delivery.
export function prepareNativeScheduleDataSender({projectId,accessToken,fetchImpl}){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)||typeof accessToken!=='string'||!accessToken
  ||/[\r\n]/.test(accessToken)||typeof fetchImpl!=='function')invalid();
 let used=false;return async function sendNativeSchedule({permit,expected,sourceCandidate,token}){
  if(used)throw failure('native_schedule_sender_already_consumed',true);used=true;
  const actor=validateNativeLocationRecipient(expected),a=permit?.attempt;
  const p=validateNativeScheduleDispatch(permit,{jobId:a?.payload?.receipt_job_id,leaseToken:a?.binding?.lease_token,
   sourceReservationId:a?.binding?.source_reservation_id,expected:actor,sourceCandidate});
  if(typeof token!=='string'||hash(token)!==actor.token_digest)invalid();
  const message={token,data:p.attempt.payload,android:{priority:'high',ttl:p.attempt.ttl_seconds+'s',restricted_package_name:'org.memphiszoo.custodial'}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();
  try{
   const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,{
    method:'POST',redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({message}),signal:controller.signal});
   if(!response.ok){await response.body?.cancel().catch(()=>{});const refused=response.status>=400&&response.status<500&&response.status!==408;
    return {outcome:refused?'known_nonacceptance':'delivery_outcome_unknown',provider_message_id:null,error_code:refused?'fcm_http_refused':'fcm_response_unknown'};}
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
