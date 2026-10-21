import {isDeepStrictEqual} from 'node:util';
import {validateNativeLocationRecipient,canonicalNativeLocation} from './native-location-reservation.js';
import {validateNativeSchedulePayload} from './native-schedule-payload.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const FIELDS=['receipt_job_id','lease_token','registration_id','generation_id','reservation_at','content_sha256',
 'token_digest','principal_digest','receipt_credential_id','receipt_assignment_epoch','receipt_employee_id','receipt_device_id','source_reservation_id'];
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(k=>typeof k==='string'
 &&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...keys].sort());
const invalid=()=>{throw new Error('native_schedule_attempt_contract_invalid');};
function micros(v){
 const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)invalid();
 const[y,mo,d,h,mi,s,us]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||s>59)invalid();
 const date=new Date(0);date.setUTCFullYear(y,mo-1,d);date.setUTCHours(h,mi,s,0);return BigInt(date.valueOf())*1000n+BigInt(us);
}
export function validateNativeScheduleAttemptBinding(v){
 if(!exact(v,FIELDS)||Object.values(v).some(x=>typeof x!=='string'))invalid();
 for(const k of ['receipt_job_id','lease_token','registration_id','generation_id','receipt_credential_id','receipt_employee_id','source_reservation_id'])if(!UUID.test(v[k]))invalid();
 for(const k of ['content_sha256','token_digest','principal_digest'])if(!SHA.test(v[k]))invalid();
 if(!/^KIOSK_(?:0[2-9]|10)$/.test(v.receipt_device_id)||!/^[1-9][0-9]{0,15}$/.test(v.receipt_assignment_epoch)
  ||BigInt(v.receipt_assignment_epoch)>9007199254740991n)invalid();micros(v.reservation_at);return Object.freeze({...v});
}
function evidence(v){
 if(!exact(v,['operation_id','outcome','provider_message_id','error_code'])||typeof v.operation_id!=='string'||!UUID.test(v.operation_id)
  ||!['provider_accepted','known_nonacceptance','delivery_outcome_unknown'].includes(v.outcome))invalid();
 if(v.outcome==='provider_accepted'){
  if(typeof v.provider_message_id!=='string'||v.provider_message_id.length<1||v.provider_message_id.length>1000
   ||v.provider_message_id!==v.provider_message_id.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(v.provider_message_id)||v.error_code!==null)invalid();
 }else if(v.provider_message_id!==null||typeof v.error_code!=='string'||!/^[a-z][a-z0-9_]{0,99}$/.test(v.error_code))invalid();
 return Object.freeze({...v});
}
function ids(a){if(typeof a.attempt_id!=='string'||typeof a.outcome_operation_id!=='string'||!UUID.test(a.attempt_id)
 ||!UUID.test(a.outcome_operation_id)||a.attempt_id===a.outcome_operation_id)invalid();}
export function validateNativeScheduleDispatch(v,{jobId,leaseToken,sourceReservationId,expected,sourceCandidate}){
 const actor=validateNativeLocationRecipient(expected);
 if(!exact(v,['schema','dispatch_authorized','delivery_admitted','replayed','reason','attempt'])
  ||v.schema!=='custodial.native-schedule-dispatch.v1'||v.dispatch_authorized!==true||v.delivery_admitted!==false
  ||v.replayed!==false||v.reason!==null)invalid();
 const a=v.attempt; if(!exact(a,['attempt_id','outcome_operation_id','attempt_reserved_at','binding','payload','wire','ttl_seconds']))invalid();ids(a);
 const b=validateNativeScheduleAttemptBinding(a.binding),p=validateNativeSchedulePayload(a.payload,{jobId,expected:actor,sourceCandidate});
 const want=Object.fromEntries(FIELDS.map(k=>[k,k==='lease_token'?leaseToken:k==='registration_id'?actor.registration_id:p[k]]));
 if(!isDeepStrictEqual(b,want)||b.source_reservation_id!==sourceReservationId||a.wire!==canonicalNativeLocation(p))invalid();
 const at=micros(a.attempt_reserved_at),from=micros(p.reservation_at),until=micros(p.valid_until),raw=(until-at)/1000000n;
 if(at<from||at>=until||raw<=0n||!Number.isSafeInteger(a.ttl_seconds)||a.ttl_seconds!==Number(raw>2419200n?2419200n:raw))invalid();
 return Object.freeze({...v,attempt:Object.freeze({...a,binding:b,payload:p})});
}
const pending=()=>Object.freeze({status:'ATTEMPT_RECONCILIATION_PENDING',dispatch_authorized:false,delivery_admitted:false,attempt:null});
export async function prepareNativeScheduleAttempt({db,jobId,leaseToken,sourceReservationId,expected,sourceCandidate}){
 const actor=validateNativeLocationRecipient(expected);
 if(![jobId,leaseToken,sourceReservationId].every(x=>typeof x==='string'&&UUID.test(x))||typeof db?.rpc!=='function')invalid();
 if(!exact(sourceCandidate,['body','kind','route','title','schema','channel_id','version_id','employee_id','service_date','generation_id',
  'projection_id','boundary_local','publication_id','source_revision','notification_key','notification_type','source_valid_from',
  'source_valid_until','source_operation_id','server_source_sha256','source_window_sha256','source_reservation_id','assignment_occurrence_id'])
  ||Object.values(sourceCandidate).some(x=>typeof x!=='string'))invalid();
 const candidate=Object.freeze({...sourceCandidate});
 let r;try{r=await db.rpc('custodial_native_schedule_dispatch_prepare',{p_job:jobId,p_lease:leaseToken,p_source:sourceReservationId,p_expected:actor});}catch{return pending();}
 if(r?.error)return pending();
 if(r?.data?.dispatch_authorized===true)return validateNativeScheduleDispatch(r.data,{jobId,leaseToken,sourceReservationId,expected:actor,sourceCandidate:candidate});
 const v=r?.data;
 if(!exact(v,['schema','dispatch_authorized','delivery_admitted','replayed','reason','attempt'])||v.schema!=='custodial.native-schedule-dispatch.v1'
  ||v.dispatch_authorized!==false||v.delivery_admitted!==false||v.attempt!==null
  ||!(v.replayed===true&&v.reason==='ORIGINAL_ATTEMPT_RETAINED'||v.replayed===false&&v.reason==='SOURCE_OR_JOB_SUPERSEDED'))invalid();
 return Object.freeze({...v});
}
export async function readNativeScheduleAttempt({db,jobId}){
 if(typeof jobId!=='string'||!UUID.test(jobId)||typeof db?.rpc!=='function')invalid();
 let r;try{r=await db.rpc('custodial_native_schedule_dispatch_status',{p_job:jobId});}catch{return pending();}
 if(r?.error)return pending();const v=r?.data;
 if(!exact(v,['schema','attempted','dispatch_authorized','delivery_admitted','attempt'])
  ||v.schema!=='custodial.native-schedule-dispatch-status.v1'||typeof v.attempted!=='boolean'
  ||v.dispatch_authorized!==false||v.delivery_admitted!==false)invalid();
 if(!v.attempted){if(v.attempt!==null)invalid();return Object.freeze({...v});}
 const a=v.attempt;if(!exact(a,['attempt_id','outcome_operation_id','attempt_reserved_at','binding','provider_outcome','evidence','server_received_at']))invalid();ids(a);
 const b=validateNativeScheduleAttemptBinding(a.binding);if(b.receipt_job_id!==jobId||micros(a.attempt_reserved_at)<micros(b.reservation_at))invalid();
 let e=null;if(a.provider_outcome==='prepared'){if(a.evidence!==null||a.server_received_at!==null)invalid();}
 else{e=evidence(a.evidence);if(e.operation_id!==a.outcome_operation_id||e.outcome!==a.provider_outcome
  ||micros(a.server_received_at)<micros(a.attempt_reserved_at))invalid();}
 return Object.freeze({...v,attempt:Object.freeze({...a,binding:b,evidence:e})});
}
export async function recordNativeScheduleOutcome({db,binding:raw,evidence:rawEvidence}){
 const b=validateNativeScheduleAttemptBinding(raw),e=evidence(rawEvidence);if(typeof db?.rpc!=='function')invalid();
 let r;try{r=await db.rpc('custodial_native_schedule_outcome',{p_binding:b,p_evidence:e});}catch{r={error:true};}
 if(r?.error){
  // An ambiguous write is reconciled by original status, not a second send
  // or a second prepare call. Only exact persisted evidence settles it.
  const original=await readNativeScheduleAttempt({db,jobId:b.receipt_job_id});
  if(original.attempt&&isDeepStrictEqual(original.attempt.binding,b)&&isDeepStrictEqual(original.attempt.evidence,e))
   return Object.freeze({status:'ORIGINAL_OUTCOME_RECONCILED',replayed:true,dispatch_authorized:false,delivery_admitted:false,attempt:original.attempt});
  return pending();
 }
 const v=r?.data;if(!exact(v,['schema','binding','evidence','server_received_at','replayed','dispatch_authorized','delivery_admitted'])
  ||v.schema!=='custodial.native-schedule-outcome-receipt.v1'||typeof v.replayed!=='boolean'||v.dispatch_authorized!==false||v.delivery_admitted!==false
  ||!isDeepStrictEqual(v.binding,b)||!isDeepStrictEqual(v.evidence,e)||micros(v.server_received_at)<micros(b.reservation_at))invalid();
 return Object.freeze({...v,binding:b,evidence:e});
}
