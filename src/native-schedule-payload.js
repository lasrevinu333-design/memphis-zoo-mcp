import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {canonicalNativeLocation,validateNativeLocationRecipient} from './native-location-reservation.js';

// Closed conditional wire validation ONLY. No payload builder, native clock,
// receipt reservation, provider permission, send or runtime route is added.
export const NATIVE_SCHEDULE_PAYLOAD_SCHEMA='custodial.native-schedule-payload.v1';
export const NATIVE_SCHEDULE_PAYLOAD_KEYS=Object.freeze(`schema generation_id principal_digest token_digest receipt_job_id receipt_credential_id receipt_employee_id receipt_device_id receipt_assignment_epoch notification_key reservation_at valid_until content_sha256 kind notification_type title body channel_id route service_date boundary_local source_reservation_id source_operation_id source_window_sha256 server_source_sha256 source_revision projection_id publication_id version_id assignment_occurrence_id source_valid_from source_valid_until`.split(' ').sort());
const candidateKeys=`schema kind notification_type title body channel_id route notification_key service_date boundary_local employee_id generation_id source_reservation_id source_operation_id source_window_sha256 server_source_sha256 source_revision projection_id publication_id version_id assignment_occurrence_id source_valid_from source_valid_until`.split(' ').sort();
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const invalid=()=>{throw new Error('native_schedule_payload_contract_invalid');};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).every(k=>typeof k==='string'
 &&Object.getOwnPropertyDescriptor(x,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(x).sort(),keys);
const text=x=>typeof x==='string'&&Buffer.from(x,'utf8').toString('utf8')===x;
function instant(value){
 const m=text(value)&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);if(!m)invalid();
 const [y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>lengths[month-1]||h>23||min>59||s>59)invalid();return value;
}
function chicagoBoundary(value,date){
 const x=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  .formatToParts(new Date(value)).map(v=>[v.type,v.value]));
 return `${x.year.padStart(4,'0')}-${x.month}-${x.day}`===date&&x.hour==='09'&&x.minute==='45'&&x.second==='00'&&value.endsWith('00.000000Z');
}
export function validateNativeSchedulePayload(p,{jobId,expected,sourceCandidate}){
 expected=validateNativeLocationRecipient(expected);
 if(!UUID.test(jobId)||!exact(p,NATIVE_SCHEDULE_PAYLOAD_KEYS)||!exact(sourceCandidate,candidateKeys)
  ||Object.entries(p).some(([key,x])=>!text(x)||!x||/[\u0000-\u001f\u007f-\u009f]/u.test(x)||Buffer.byteLength(x)>({title:180,notification_key:240}[key]||1000))
  ||Object.values(sourceCandidate).some(x=>!text(x))||p.schema!==NATIVE_SCHEDULE_PAYLOAD_SCHEMA
  ||sourceCandidate.schema!=='custodial.native-schedule-content-candidate.v1'||p.kind!=='employee_schedule_ownership'
  ||p.notification_type!=='schedule_ownership'||p.channel_id!=='employee-schedule-ownership'
  ||p.route!=='employee-schedule.html?hub=employee'||p.boundary_local!=='09:45'||p.receipt_job_id!==jobId)invalid();
 for(const [field,key] of Object.entries({generation_id:'generation_id',principal_digest:'principal_digest',token_digest:'token_digest',receipt_credential_id:'credential_id',
  receipt_employee_id:'employee_id',receipt_device_id:'device_id',receipt_assignment_epoch:'assignment_epoch'}))if(p[field]!==expected[key])invalid();
 if(sourceCandidate.employee_id!==expected.employee_id||sourceCandidate.generation_id!==expected.generation_id)invalid();
 for(const key of candidateKeys)if(!['schema','employee_id'].includes(key)&&p[key]!==sourceCandidate[key])invalid();
 for(const field of ['generation_id','receipt_credential_id','receipt_employee_id','source_reservation_id','source_operation_id','projection_id','publication_id','version_id','assignment_occurrence_id'])if(!UUID.test(p[field]))invalid();
 for(const field of ['principal_digest','token_digest','content_sha256','source_window_sha256','server_source_sha256'])if(!SHA.test(p[field]))invalid();
 if(!/^[1-9][0-9]{0,15}$/.test(p.source_revision)||!Number.isSafeInteger(Number(p.source_revision))
  ||p.notification_key!==`schedule-ownership:${p.service_date}:${p.receipt_employee_id}:09:45`)invalid();
 const from=instant(p.source_valid_from),end=instant(p.source_valid_until),at=instant(p.reservation_at),until=instant(p.valid_until);
 if(!chicagoBoundary(from,p.service_date)||from>at||at>=until||until>end||from>=end)invalid();
 const wire=canonicalNativeLocation(p);
 if(Buffer.byteLength(p.title)>180||Buffer.byteLength(p.notification_key)>240||Buffer.byteLength(wire)>3500
  ||createHash('sha256').update(canonicalNativeLocation(p,{excludeHash:true})).digest('hex')!==p.content_sha256)invalid();
 return Object.freeze({...p});
}
export function nativeScheduleRecordId(payload){
 if(!exact(payload,NATIVE_SCHEDULE_PAYLOAD_KEYS)||![payload.generation_id,payload.source_reservation_id].every(x=>text(x)&&UUID.test(x))
  ||!text(payload.notification_key))invalid();
 return createHash('sha256').update(payload.generation_id+'\n'+payload.source_reservation_id+'\n'+payload.notification_key).digest('hex');
}
