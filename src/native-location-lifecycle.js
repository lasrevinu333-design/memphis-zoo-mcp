import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {canonicalNativeLocation,NATIVE_LOCATION_PAYLOAD_KEYS,validateNativeLocationRecipient,validateNativeLocationReservation} from './native-location-reservation.js';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,sha=/^[0-9a-f]{64}$/;
const exact=(v,fields)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...fields].sort());
const invalid=()=>Object.assign(new Error('native_location_lifecycle_contract_invalid'),{status:400,code:'native_location_lifecycle_contract_invalid'});
const fail=()=>{throw invalid();};
const digest=v=>createHash('sha256').update(v).digest('hex');
function timestamp(v){
 const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)fail();
 const[y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)fail();return v;
}
function tuple(v){if(v===null)return null;if(!exact(v,['reservation_at','job_id'])||typeof v.job_id!=='string'||!uuid.test(v.job_id))fail();timestamp(v.reservation_at);return v;}
const compare=(a,b)=>{for(const k of ['reservation_at','job_id']){if(a[k]<b[k])return -1;if(a[k]>b[k])return 1;}return 0;};
export async function resolveNativeLocationTarget({db,jobId,leaseToken}){
 if(typeof jobId!=='string'||typeof leaseToken!=='string'||!uuid.test(jobId)||!uuid.test(leaseToken)||typeof db?.rpc!=='function')fail();
 const r=await db.rpc('custodial_native_location_target',{p_job:jobId,p_lease:leaseToken});if(r.error)throw new Error('native_location_target_pending');
 const v=r.data;if(exact(v,['current','reason'])&&v.current===false&&v.reason==='native_location_target_unavailable')return Object.freeze({...v});
 if(!exact(v,['current','expected','token'])||v.current!==true||typeof v.token!=='string'||Buffer.byteLength(v.token)<20||Buffer.byteLength(v.token)>4096||/[\u0000-\u001f\u007f-\u009f]/u.test(v.token))fail();
 const expected=validateNativeLocationRecipient(v.expected);if(digest(v.token)!==expected.token_digest)fail();
 // Token remains an internal return value, never diagnostic/public status data.
 return Object.freeze({current:true,expected,token:v.token});
}
const bindingFields=['receipt_job_id','lease_token','registration_id','generation_id','reservation_at','content_sha256','token_digest','principal_digest','receipt_credential_id','receipt_assignment_epoch','receipt_employee_id','receipt_device_id'];
function outcomeBinding(v){
 if(!exact(v,bindingFields)||Object.values(v).some(x=>typeof x!=='string'))fail();
 for(const key of ['receipt_job_id','lease_token','registration_id','generation_id','receipt_credential_id','receipt_employee_id'])if(!uuid.test(v[key]))fail();
 for(const key of ['content_sha256','token_digest','principal_digest'])if(!sha.test(v[key]))fail();
 if(!/^KIOSK_(?:0[2-9]|10)$/.test(v.receipt_device_id)||! /^[1-9][0-9]{0,15}$/.test(v.receipt_assignment_epoch)||BigInt(v.receipt_assignment_epoch)>9007199254740991n)fail();
 timestamp(v.reservation_at);return Object.freeze({...v});
}
function outcomeEvidence(v){
 if(!exact(v,['operation_id','outcome','provider_message_id','error_code'])||typeof v.operation_id!=='string'||!uuid.test(v.operation_id)||!['provider_accepted','known_nonacceptance','delivery_outcome_unknown'].includes(v.outcome))fail();
 if(v.outcome==='provider_accepted'){
  if(typeof v.provider_message_id!=='string'||v.provider_message_id.length<1||v.provider_message_id.length>1000||v.provider_message_id!==v.provider_message_id.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(v.provider_message_id)||v.error_code!==null)fail();
 }else if(v.provider_message_id!==null||typeof v.error_code!=='string'||!/^[a-z][a-z0-9_]{0,99}$/.test(v.error_code))fail();
 return Object.freeze({...v});
}
export function nativeLocationOutcomeBinding({reservation,leaseToken,expected}){
 const p=validateNativeLocationReservation(reservation,{jobId:reservation?.payload?.receipt_job_id,expected}).payload;
 return outcomeBinding(Object.fromEntries(bindingFields.map(k=>[k,k==='lease_token'?leaseToken:k==='registration_id'?expected.registration_id:p[k]])));
}
export async function recordNativeLocationOutcome({db,binding,evidence}){
 const original=outcomeBinding(binding),observed=outcomeEvidence(evidence);if(typeof db?.rpc!=='function')fail();
 const r=await db.rpc('custodial_native_location_outcome',{p_binding:original,p_evidence:observed});if(r.error)throw new Error('native_location_outcome_pending');
 const v=r.data;if(!exact(v,['schema','binding','evidence','server_received_at','replayed','dispatch_authorized'])||v.schema!=='custodial.native-location-outcome-receipt.v1'
  ||v.dispatch_authorized!==false||typeof v.replayed!=='boolean'||!isDeepStrictEqual(v.binding,original)||!isDeepStrictEqual(v.evidence,observed))fail();
 timestamp(v.server_received_at);if(v.server_received_at<original.reservation_at)fail();
 return Object.freeze({...v,binding:original,evidence:observed});
}
export async function readNativeLocationOutcome({db,binding}){
 const original=outcomeBinding(binding);if(typeof db?.rpc!=='function')fail();
 const r=await db.rpc('custodial_native_location_outcome_status',{p_binding:original});if(r.error)throw new Error('native_location_outcome_status_pending');
 const v=r.data;if(!exact(v,['schema','binding','dispatch_authorized','provider_outcome','evidence','server_received_at'])
  ||v.schema!=='custodial.native-location-outcome-status.v1'||v.dispatch_authorized!==false||!isDeepStrictEqual(v.binding,original))fail();
 let evidence=null;
 if(v.provider_outcome==='prepared'){if(v.evidence!==null||v.server_received_at!==null)fail();}
 else{evidence=outcomeEvidence(v.evidence);if(evidence.outcome!==v.provider_outcome)fail();timestamp(v.server_received_at);if(v.server_received_at<original.reservation_at)fail();}
 return Object.freeze({...v,binding:original,evidence});
}
export function validateNativeLocationInventoryRequest(body){
 if(!exact(body,['schema','scan_id','principal_digest','device_id','credential_id','employee_id','assignment_epoch','generation_ids','limit','cursor','ceiling','server_now'])
  ||body.schema!=='custodial.native-provider-inventory-request.v1'||!uuid.test(body.scan_id)||!uuid.test(body.credential_id)||!uuid.test(body.employee_id)
  ||!sha.test(body.principal_digest)||!/^KIOSK_(?:0[2-9]|10)$/.test(body.device_id)||!Number.isSafeInteger(body.assignment_epoch)||body.assignment_epoch<1||body.limit!==32
  ||!Array.isArray(body.generation_ids)||body.generation_ids.length<1||body.generation_ids.length>32||new Set(body.generation_ids).size!==body.generation_ids.length
  ||body.generation_ids.some(v=>typeof v!=='string'||!uuid.test(v)))fail();
 for(const k of ['schema','scan_id','principal_digest','device_id','credential_id','employee_id'])if(typeof body[k]!=='string')fail();
 tuple(body.cursor);tuple(body.ceiling);if(body.server_now===null){if(body.cursor!==null||body.ceiling!==null)fail();}
 else{timestamp(body.server_now);if(body.ceiling&&body.ceiling.reservation_at>body.server_now)fail();if(body.cursor&&(!body.ceiling||compare(body.cursor,body.ceiling)>0))fail();}
 return Object.freeze({...body,generation_ids:Object.freeze([...body.generation_ids]),cursor:body.cursor&&Object.freeze({...body.cursor}),ceiling:body.ceiling&&Object.freeze({...body.ceiling})});
}
export function validateNativeLocationInventoryResponse(value,request){
 const q=validateNativeLocationInventoryRequest(request);
 if(value?.ok===false){
  if(!exact(value,['ok','error','schema','scan_id','principal_digest','cursor','ceiling','server_now','generation_ids'])
   ||value.error!=='custodial_native_provider_cursor_invalid'||value.schema!=='custodial.native-provider-inventory-restart.v1'||q.cursor===null)fail();
  for(const k of ['scan_id','principal_digest','cursor','ceiling','server_now','generation_ids'])if(!isDeepStrictEqual(value[k],q[k]))fail();return value;
 }
 if(!exact(value,['ok','data'])||value.ok!==true)fail();const d=value.data;
 if(!exact(d,['schema','scan_id','principal_digest','device_id','credential_id','employee_id','assignment_epoch','generation_ids','cursor','ceiling','server_now','has_more','rows'])
  ||d.schema!=='custodial.native-provider-inventory.v1'||typeof d.has_more!=='boolean'||!Array.isArray(d.rows)||d.rows.length>32)fail();
 for(const k of ['scan_id','principal_digest','device_id','credential_id','employee_id','assignment_epoch','generation_ids'])if(!isDeepStrictEqual(d[k],q[k]))fail();
 timestamp(d.server_now);tuple(d.ceiling);tuple(d.cursor);if(q.server_now!==null&&q.server_now!==d.server_now)fail();if(q.ceiling!==null&&!isDeepStrictEqual(q.ceiling,d.ceiling))fail();
 if(d.ceiling&&d.ceiling.reservation_at>d.server_now)fail();let last=q.cursor;
 for(const row of d.rows){
  if(!exact(row,['payload','provider_outcome'])||!['prepared','delivery_outcome_unknown','provider_accepted'].includes(row.provider_outcome))fail();const p=row.payload;
  if(!exact(p,NATIVE_LOCATION_PAYLOAD_KEYS)||Object.values(p).some(v=>typeof v!=='string')||p.schema!=='custodial.native-location-payload.v2'||!q.generation_ids.includes(p.generation_id)
   ||p.principal_digest!==q.principal_digest||p.receipt_device_id!==q.device_id||p.receipt_credential_id!==q.credential_id||p.receipt_employee_id!==q.employee_id||p.receipt_assignment_epoch!==String(q.assignment_epoch)
   ||!sha.test(p.content_sha256)||digest(canonicalNativeLocation(p,{excludeHash:true}))!==p.content_sha256||Buffer.byteLength(canonicalNativeLocation(p))>3500)fail();
  const now=tuple({reservation_at:p.reservation_at,job_id:p.receipt_job_id});timestamp(p.valid_until);
  if(now.reservation_at>d.server_now||p.valid_until<=d.server_now||!d.ceiling||compare(now,d.ceiling)>0||(last&&compare(now,last)<=0))fail();last=now;
 }
 if(!isDeepStrictEqual(last,d.cursor)||(d.has_more&&(!d.rows.length||!d.cursor||!d.ceiling||compare(d.cursor,d.ceiling)>=0)))fail();
 if(Buffer.byteLength(JSON.stringify(value))>262144)fail();return value;
}
