import {isDeepStrictEqual} from 'node:util';
import {validateNativeLunchReservation} from './native-lunch-reservation.js';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha=/^[0-9a-f]{64}$/;
const fields=['receipt_job_id','lease_token','registration_id','generation_id','reservation_at','content_sha256',
 'token_digest','principal_digest','receipt_credential_id','receipt_assignment_epoch','receipt_employee_id','receipt_device_id'];
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype
 &&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const invalid=()=>{throw new Error('native_lunch_lifecycle_contract_invalid');};
function timestamp(value){
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
 if(!m)invalid();
 const [y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)invalid();return value;
}
function binding(v){
 if(!exact(v,fields)||Object.values(v).some(x=>typeof x!=='string'))invalid();
 for(const k of ['receipt_job_id','lease_token','registration_id','generation_id','receipt_credential_id','receipt_employee_id'])
  if(!uuid.test(v[k]))invalid();
 for(const k of ['content_sha256','token_digest','principal_digest'])if(!sha.test(v[k]))invalid();
 if(!/^KIOSK_(?:0[2-9]|10)$/.test(v.receipt_device_id)
  ||!/^[1-9][0-9]{0,15}$/.test(v.receipt_assignment_epoch)
  ||BigInt(v.receipt_assignment_epoch)>9007199254740991n)invalid();
 timestamp(v.reservation_at);return Object.freeze({...v});
}
function evidence(v){
 if(!exact(v,['operation_id','outcome','provider_message_id','error_code'])||!uuid.test(v.operation_id)
  ||!['provider_accepted','known_nonacceptance','delivery_outcome_unknown'].includes(v.outcome))invalid();
 if(v.outcome==='provider_accepted'){
  if(typeof v.provider_message_id!=='string'||v.provider_message_id.length<1||v.provider_message_id.length>1000
   ||v.provider_message_id!==v.provider_message_id.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(v.provider_message_id)
   ||v.error_code!==null)invalid();
 }else if(v.provider_message_id!==null||typeof v.error_code!=='string'||!/^[a-z][a-z0-9_]{0,99}$/.test(v.error_code))invalid();
 return Object.freeze({...v});
}
export function nativeLunchOutcomeBinding({reservation,leaseToken,expected}){
 const p=validateNativeLunchReservation(reservation,{jobId:reservation?.payload?.receipt_job_id,expected}).payload;
 return binding(Object.fromEntries(fields.map(k=>[k,k==='lease_token'?leaseToken:k==='registration_id'?expected.registration_id:p[k]])));
}
export async function recordNativeLunchOutcome({db,binding:raw,evidence:rawEvidence}){
 const original=binding(raw),observed=evidence(rawEvidence);
 if(typeof db?.rpc!=='function')invalid();
 const result=await db.rpc('custodial_native_lunch_outcome',{p_binding:original,p_evidence:observed});
 if(result.error)throw new Error('native_lunch_outcome_pending',{cause:result.error});
 const v=result.data;
 if(!exact(v,['schema','binding','evidence','server_received_at','replayed','dispatch_authorized'])
  ||v.schema!=='custodial.native-lunch-outcome-receipt.v1'||v.dispatch_authorized!==false
  ||typeof v.replayed!=='boolean'||!isDeepStrictEqual(v.binding,original)||!isDeepStrictEqual(v.evidence,observed))invalid();
 timestamp(v.server_received_at);if(v.server_received_at<original.reservation_at)invalid();
 return Object.freeze({...v,binding:original,evidence:observed});
}
export async function readNativeLunchOutcome({db,binding:raw}){
 const original=binding(raw);if(typeof db?.rpc!=='function')invalid();
 const result=await db.rpc('custodial_native_lunch_outcome_status',{p_binding:original});
 if(result.error)throw new Error('native_lunch_outcome_status_pending',{cause:result.error});
 const v=result.data;
 if(!exact(v,['schema','binding','dispatch_authorized','provider_outcome','evidence','server_received_at'])
  ||v.schema!=='custodial.native-lunch-outcome-status.v1'||v.dispatch_authorized!==false
  ||!isDeepStrictEqual(v.binding,original))invalid();
 if(v.provider_outcome==='prepared'){
  if(v.evidence!==null||v.server_received_at!==null)invalid();return Object.freeze({...v,binding:original});
 }
 const observed=evidence(v.evidence);
 if(observed.outcome!==v.provider_outcome)invalid();timestamp(v.server_received_at);
 if(v.server_received_at<original.reservation_at)invalid();
 return Object.freeze({...v,binding:original,evidence:observed});
}
