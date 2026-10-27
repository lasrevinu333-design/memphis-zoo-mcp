import {createHash} from 'node:crypto';
import {canonicalNativeLocation,validateNativeLocationRecipient} from './native-location-reservation.js';

export const NATIVE_LUNCH_SCHEMA='custodial.native-provider-payload.v1';
export const NATIVE_LUNCH_PAYLOAD_KEYS=Object.freeze(`schema generation_id principal_digest token_digest receipt_job_id receipt_credential_id receipt_employee_id receipt_device_id receipt_assignment_epoch notification_key reservation_at valid_until content_sha256 kind notification_type title body channel_id route service_date event loan_id scheduled_time scheduled_at coverer_slot_id projection_id document_identity`.split(' ').sort());
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha=/^[0-9a-f]{64}$/;
const invalid=()=>{throw new Error('native_lunch_reservation_contract_invalid');};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype
 &&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const text=value=>typeof value==='string'&&Buffer.from(value,'utf8').toString('utf8')===value;
function micros(value){
 const m=text(value)&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
 if(!m)invalid();
 const [y,month,day,h,min,s,us]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)invalid();
 const milliseconds=Date.parse(value.slice(0,19)+'Z');if(!Number.isFinite(milliseconds))invalid();
 return BigInt(milliseconds)*1000n+BigInt(us);
}
export function validateNativeLunchReservation(value,{jobId,expected}){
 expected=validateNativeLocationRecipient(expected);
 if(!uuid.test(jobId)||!exact(value,['current','delivery_outcome_unknown','dispatch_authorized','payload',...(value?.replayed?['reason']:[]),'replayed','wire'])
  ||value.current!==true||typeof value.replayed!=='boolean'||value.dispatch_authorized!==!value.replayed
  ||value.delivery_outcome_unknown!==value.replayed
  ||(value.replayed&&value.reason!=='native_lunch_outcome_unknown_no_resend'))invalid();
 const p=validateNativeLunchPayload(value.payload,{jobId,expected});
 if(value.wire!==canonicalNativeLocation(p))invalid();
 return Object.freeze({...value,payload:p});
}
export function validateNativeLunchPayload(value,{jobId,expected}){
 const p=value;
 if(!exact(p,NATIVE_LUNCH_PAYLOAD_KEYS)||Object.values(p).some(v=>!text(v))
  ||p.schema!==NATIVE_LUNCH_SCHEMA||p.kind!=='employee_lunch_coverage'
  ||p.notification_type!=='lunch_coverage'||p.channel_id!=='employee-lunch-coverage'
  ||p.route!=='employee-schedule.html?hub=employee'||!['start','end'].includes(p.event)
  ||p.receipt_job_id!==jobId||![p.generation_id,p.receipt_credential_id,p.receipt_employee_id,p.projection_id].every(v=>uuid.test(v))
  ||!/^KIOSK_(?:0[2-9]|10)$/.test(p.receipt_device_id)
  ||!/^[1-9][0-9]{0,15}$/.test(p.receipt_assignment_epoch)
  ||BigInt(p.receipt_assignment_epoch)>9007199254740991n
  ||![p.principal_digest,p.token_digest].every(v=>sha.test(v))
  ||![p.notification_key,p.loan_id,p.document_identity,p.content_sha256].every(v=>sha.test(v))
  ||!/^\d{4}-\d{2}-\d{2}$/.test(p.service_date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.scheduled_time)
  ||!text(p.coverer_slot_id)||!p.coverer_slot_id||Buffer.byteLength(p.coverer_slot_id)>100)invalid();
 if(!expected||typeof expected!=='object')invalid();
 for(const [field,target] of Object.entries({generation_id:'generation_id',principal_digest:'principal_digest',
  token_digest:'token_digest',receipt_credential_id:'credential_id',receipt_employee_id:'employee_id',
  receipt_device_id:'device_id',receipt_assignment_epoch:'assignment_epoch'}))
  if(expected[target]!==undefined&&p[field]!==expected[target])invalid();
 const [year,month,day]=p.service_date.split('-').map(Number);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1])invalid();
 const scheduled=micros(p.scheduled_at),reserved=micros(p.reservation_at),until=micros(p.valid_until);
 if(reserved<scheduled||reserved>=until||(p.event==='start'&&until>scheduled+3600000000n))invalid();
 const wire=canonicalNativeLocation(p);
 if(Buffer.byteLength(wire)>3500
  ||createHash('sha256').update(canonicalNativeLocation(p,{excludeHash:true})).digest('hex')!==p.content_sha256)invalid();
 for(const [key,fieldValue] of Object.entries(p)){
  if(!fieldValue||/[\u0000-\u001f\u007f-\u009f]/u.test(fieldValue)
   ||Buffer.byteLength(fieldValue)>({title:180,notification_key:240}[key]||1000))invalid();
 }
 return Object.freeze({...p});
}

export async function resolveNativeLunchTarget({db,jobId,leaseToken}){
 if(!uuid.test(jobId)||!uuid.test(leaseToken)||typeof db?.rpc!=='function')invalid();
 const result=await db.rpc('custodial_native_lunch_target',{p_job:jobId,p_lease:leaseToken});
 if(result.error)throw new Error('native_lunch_target_pending',{cause:result.error});
 const value=result.data;
 if(exact(value,['current','reason'])&&value.current===false&&value.reason==='native_lunch_target_unavailable')return value;
 if(!exact(value,['current','expected','token'])||value.current!==true||typeof value.token!=='string'
  ||Buffer.byteLength(value.token)<20||Buffer.byteLength(value.token)>4096)invalid();
 const expected=validateNativeLocationRecipient(value.expected);
 if(createHash('sha256').update(value.token).digest('hex')!==expected.token_digest)invalid();
 return Object.freeze({current:true,expected,token:value.token});
}
