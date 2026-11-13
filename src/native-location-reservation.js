import {createHash} from 'node:crypto';

// Callable service boundary, deliberately not imported by a production sender.
// A fresh reservation is not provider acceptance or native display authority.
export const NATIVE_LOCATION_SCHEMA='custodial.native-location-payload.v2';
const recipientKeys=['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest'];
const payloadKeys=`schema generation_id principal_digest token_digest receipt_job_id receipt_credential_id receipt_employee_id receipt_device_id receipt_assignment_epoch notification_key reservation_at valid_until content_sha256 kind notification_type title body channel_id route service_date reminder_contract cleaned_at cycle_base_at cycle_base_evidence due_soon_at overdue_at status_code location_id location_code location_name form_type group_code group_name projection_id publication_id version_id occurrence_id authority_source authority_source_id authority_source_digest coverage_end_at operational_end_at`.split(' ').sort();
export const NATIVE_LOCATION_PAYLOAD_KEYS=Object.freeze(payloadKeys);
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest=/^[0-9a-f]{64}$/;
const invalid=()=>new Error('native_location_reservation_contract_invalid');
const keys=(value,expected)=>value&&Object.getPrototypeOf(value)===Object.prototype&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(expected);
const string=(value)=>typeof value==='string'&&Buffer.from(value,'utf8').toString('utf8')===value;
function timestamp(value){
 const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
 if(!m)throw invalid();
 const [y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>lengths[month-1]||h>23||min>59||s>59)throw invalid();
 return value; // Canonical fixed-width UTC strings order exactly, including microseconds.
}
export function canonicalNativeLocation(data,{excludeHash=false}={}) {
 if(!data||Array.isArray(data)||typeof data!=='object')throw invalid();
 const ordered={};for(const key of Object.keys(data).sort()){
  if(!/^[a-z][a-z0-9_]*$/.test(key)||!string(data[key]))throw invalid();
  if(excludeHash&&key==='content_sha256')continue;
  ordered[key]=data[key];
 }return JSON.stringify(ordered);
}
function expectedRecipient(value){
 if(!keys(value,recipientKeys)||Object.values(value).some(v=>!string(v)))throw invalid();
 for(const key of ['credential_id','employee_id','generation_id','registration_id'])if(!uuid.test(value[key]))throw invalid();
 if(!/^KIOSK_(?:0[2-9]|10)$/.test(value.device_id)||!digest.test(value.principal_digest)||!digest.test(value.token_digest)
  ||! /^[1-9][0-9]{0,15}$/.test(value.assignment_epoch)||BigInt(value.assignment_epoch)>9007199254740991n)throw invalid();
 return Object.freeze({...value});
}
export const validateNativeLocationRecipient=expectedRecipient;
export function validateNativeLocationReservation(value,{jobId,expected}){
 expected=expectedRecipient(expected);if(!uuid.test(jobId))throw invalid();
 if(!value||value.current!==true||!keys(value,['current','delivery_outcome_unknown','dispatch_authorized','payload',...(value.replayed?['reason']:[]),'replayed','wire'].sort())
  ||typeof value.replayed!=='boolean'||value.dispatch_authorized!==!value.replayed||value.delivery_outcome_unknown!==value.replayed
  ||(value.replayed&&value.reason!=='native_location_outcome_unknown_no_resend'))throw invalid();
 const p=value.payload;
 if(!keys(p,payloadKeys)||Object.values(p).some(v=>!string(v))||p.schema!==NATIVE_LOCATION_SCHEMA
  ||p.kind!=='employee_location_status'||p.notification_type!=='location_status'||p.receipt_job_id!==jobId)throw invalid();
 for(const [field,target] of Object.entries({generation_id:'generation_id',principal_digest:'principal_digest',token_digest:'token_digest',
  receipt_credential_id:'credential_id',receipt_employee_id:'employee_id',receipt_device_id:'device_id',receipt_assignment_epoch:'assignment_epoch'}))
  if(p[field]!==expected[target])throw invalid();
 const wire=canonicalNativeLocation(p);
 if(wire!==value.wire||Buffer.byteLength(wire,'utf8')>3500||!digest.test(p.content_sha256)
  ||createHash('sha256').update(canonicalNativeLocation(p,{excludeHash:true})).digest('hex')!==p.content_sha256)throw invalid();
 for(const field of ['projection_id','publication_id','version_id','occurrence_id','authority_source_id','location_id'])if(!uuid.test(p[field]))throw invalid();
 if(!digest.test(p.authority_source_digest)||!['static_weekly_projection','static_weekly_lunch_coverage'].includes(p.authority_source)
  ||!p.notification_key.endsWith(':projection:'+p.projection_id))throw invalid();
 // Do not convert SQL microseconds to Date milliseconds or invent client time.
 for(const field of ['reservation_at','valid_until','cleaned_at','cycle_base_at','due_soon_at','overdue_at','coverage_end_at','operational_end_at'])
  timestamp(p[field]);
 if(p.reservation_at>=p.valid_until||p.valid_until>p.coverage_end_at||p.valid_until>p.operational_end_at)throw invalid();
 return Object.freeze({...value,payload:Object.freeze({...p})});
}
export async function reserveNativeLocation({db,jobId,leaseToken,expected}){
 const original=expectedRecipient(expected);if(!uuid.test(jobId)||!uuid.test(leaseToken)||typeof db?.rpc!=='function')throw invalid();
 const result=await db.rpc('custodial_native_location_reserve',{p_job:jobId,p_lease:leaseToken,p_expected:original});
 if(result?.error)throw new Error('native_location_reservation_pending',{cause:result.error});
 const value=result?.data;
 if(value?.current===false&&value.dispatch_authorized===false&&keys(value,['current','dispatch_authorized','reason'])&&string(value.reason))
  return Object.freeze({...value});
 return validateNativeLocationReservation(value,{jobId,expected:original});
}
