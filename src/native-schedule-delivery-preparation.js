import {isDeepStrictEqual} from 'node:util';
import {postgresJsonbContentDigest} from './static-weekly-schedule-program.js';

// Content preparation ONLY. The immutable SQL SOURCE original is not a
// provider receipt. No token, native clock, delivery time/hash or send permit
// is manufactured here; finalization must independently admit the native wire.
export const NATIVE_SCHEDULE_CONTENT_SCHEMA='custodial.native-schedule-content-candidate.v1';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const failure=()=>Object.assign(new Error('native_schedule_delivery_preparation_invalid'),{code:'native_schedule_delivery_preparation_invalid'});
const requireValue=value=>{if(!value)throw failure();};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype
 &&Reflect.ownKeys(x).every(k=>typeof k==='string'&&Object.getOwnPropertyDescriptor(x,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(x).sort(),[...keys].sort());
const utf8=x=>typeof x==='string'&&Buffer.from(x,'utf8').toString('utf8')===x;
const clean=(x,max)=>utf8(x)&&x.length>0&&!/[\u0000-\u001f\u007f-\u009f]/u.test(x)&&Buffer.byteLength(x)<=max;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const windowKeys='schema logical_key service_date timezone employee_id employee_name generation_id recipient projection_id publication_id version_id source_revision assignment_occurrence_id before_units after_units server_source_sha256 server_digest_format valid_from valid_until server_now'.split(' ');
const recipientKeys='employee_id device_id device_identifier credential_id assignment_epoch generation_id principal_digest token_digest'.split(' ');
const reservationKeys='schema status reserved replayed dispatch_authorized delivery_admitted clock_effect_authority retention_authority reservation'.split(' ');
const statusKeys='schema status source_current current_source_status dispatch_authorized delivery_admitted clock_effect_authority retention_authority reservation'.split(' ');
const stopped=new Set(['TARGET_STALE','SOURCE_STALE','WINDOW_NOT_STARTED','SOURCE_WINDOW_EXPIRED','NO_OWNERSHIP_CHANGE','SOURCE_CHANGED','ORIGINAL_SOURCE_CONFLICT']);
function micros(value){
 const m=utf8(value)&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);requireValue(m);
 const [y,month,day,h,min,s,us]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 const lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 requireValue(y>=1&&month>=1&&month<=12&&day>=1&&day<=lengths[month-1]&&h<24&&min<60&&s<60);
 const ms=Date.parse(value.slice(0,19)+'Z');requireValue(Number.isFinite(ms));return BigInt(ms)*1000n+BigInt(us);
}
function boundaryDate(value){
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
 requireValue(fields.hour==='09'&&fields.minute==='45'&&fields.second==='00'&&value.endsWith('00.000000Z'));
 return fields.year.padStart(4,'0')+'-'+fields.month+'-'+fields.day;
}
function units(values){
 requireValue(Array.isArray(values)&&Object.getPrototypeOf(values)===Array.prototype&&values.length<=4096
  &&Reflect.ownKeys(values).length===values.length+1&&Reflect.ownKeys(values).every(k=>typeof k==='string'
   &&(k==='length'||(/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<values.length&&Object.hasOwn(Object.getOwnPropertyDescriptor(values,k),'value')))));
 let previous='';for(const x of values){requireValue(utf8(x)&&/^(?:LOCATION:|DUTY:(?:reminder_only|response_only_no_clean):)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x)&&x>previous);previous=x;}
}
function request(value){
 requireValue(exact(value,['sourceKey','employeeId','generationId','expectedSourceSha256','operationId']));
 requireValue([value.sourceKey,value.employeeId,value.generationId,value.operationId].every(x=>utf8(x)&&UUID.test(x))&&utf8(value.expectedSourceSha256)&&SHA.test(value.expectedSourceSha256));
 return structuredClone(value);
}
function original(value,expected){
 requireValue(exact(value,['reservation_id','operation_id','reserved_at','window','window_sha256']));
 requireValue([value.reservation_id,value.operation_id].every(x=>utf8(x)&&UUID.test(x))&&utf8(value.window_sha256)&&SHA.test(value.window_sha256));
 const w=value.window;requireValue(exact(w,windowKeys)&&exact(w.recipient,recipientKeys));
 requireValue(w.schema==='custodial.native-schedule-server-window.v1'&&w.timezone==='America/Chicago'
  &&w.employee_id===expected.employeeId&&w.generation_id===expected.generationId&&w.assignment_occurrence_id===expected.sourceKey
  &&w.server_source_sha256===expected.expectedSourceSha256&&w.server_digest_format==='postgres-jsonb-sha256.v1'
  &&[w.projection_id,w.publication_id,w.version_id].every(x=>utf8(x)&&UUID.test(x))
  &&clean(w.employee_name,180)&&w.employee_name.trim().length>0
  &&utf8(w.source_revision)&&/^[1-9][0-9]{0,15}$/.test(w.source_revision)&&Number.isSafeInteger(Number(w.source_revision))
  &&w.logical_key===`schedule-ownership:${w.service_date}:${w.employee_id}:09:45`);
 const r=w.recipient;requireValue(r.employee_id===w.employee_id&&r.generation_id===w.generation_id
  &&[r.device_id,r.credential_id].every(x=>utf8(x)&&UUID.test(x))&&/^KIOSK_(?:0[2-9]|10)$/.test(r.device_identifier)
  &&Number.isSafeInteger(r.assignment_epoch)&&r.assignment_epoch>=1&&[r.principal_digest,r.token_digest].every(x=>utf8(x)&&SHA.test(x)));
 const from=micros(w.valid_from),until=micros(w.valid_until),at=micros(w.server_now);
 requireValue(from<=at&&at<until&&value.reserved_at===w.server_now&&boundaryDate(w.valid_from)===w.service_date);
 units(w.before_units);units(w.after_units);requireValue(!isDeepStrictEqual(w.before_units,w.after_units));
 requireValue(Buffer.byteLength(JSON.stringify(w))<=2097152&&postgresJsonbContentDigest(w)===value.window_sha256);
 return value;
}
export function validateNativeScheduleSourceReservation(value,context){
 const expected=request(context);
 requireValue(exact(value,reservationKeys)&&value.schema==='custodial.native-schedule-source-reservation.v1'
  &&value.dispatch_authorized===false&&value.delivery_admitted===false&&value.clock_effect_authority===null&&value.retention_authority===null);
 if(stopped.has(value.status)){requireValue(value.reserved===false&&value.replayed===false&&value.reservation===null);return freeze(structuredClone(value));}
 requireValue(value.reserved===true&&['SOURCE_RESERVED_NATIVE_UNQUALIFIED','ORIGINAL_SOURCE_RESERVED'].includes(value.status)
  &&value.replayed===(value.status==='ORIGINAL_SOURCE_RESERVED'));
 const record=original(value.reservation,expected);
 if(!value.replayed)requireValue(record.operation_id===expected.operationId);
 return freeze(structuredClone(value));
}
export function buildNativeScheduleContentCandidate(value,context){
 const source=validateNativeScheduleSourceReservation(value,context);requireValue(source.reserved===true);
 const r=source.reservation,w=r.window;
 const candidate={schema:NATIVE_SCHEDULE_CONTENT_SCHEMA,kind:'employee_schedule_ownership',notification_type:'schedule_ownership',
  title:'9:45 assignment update',body:`${w.employee_name}, your scheduled responsibilities have changed at 9:45 AM. Please see your Schedule page for your updated assignments.`,
  channel_id:'employee-schedule-ownership',route:'employee-schedule.html?hub=employee',notification_key:w.logical_key,
  service_date:w.service_date,boundary_local:'09:45',employee_id:w.employee_id,generation_id:w.generation_id,
  source_reservation_id:r.reservation_id,source_operation_id:r.operation_id,source_window_sha256:r.window_sha256,
  server_source_sha256:w.server_source_sha256,source_revision:w.source_revision,projection_id:w.projection_id,
  publication_id:w.publication_id,version_id:w.version_id,assignment_occurrence_id:w.assignment_occurrence_id,
  source_valid_from:w.valid_from,source_valid_until:w.valid_until};
 requireValue(Object.values(candidate).every(x=>clean(x,1000))&&Buffer.byteLength(candidate.title)<=180
  &&Buffer.byteLength(candidate.notification_key)<=240&&Buffer.byteLength(JSON.stringify(candidate))<=3500);
 return freeze(candidate);
}
export async function prepareNativeScheduleContent({db,...context}){
 const expected=request(context);requireValue(typeof db?.rpc==='function');
 const pending=reason=>freeze({schema:'custodial.native-schedule-content-preparation.v1',status:'SOURCE_PENDING',reason,
  delivery_admitted:false,dispatch_authorized:false,clock_effect_authority:null,retention_authority:null,candidate:null});
 let first;
 try{first=await db.rpc('custodial_native_schedule_source_reserve',{p_source_key:expected.sourceKey,p_employee_id:expected.employeeId,
  p_generation_id:expected.generationId,p_expected_source_sha256:expected.expectedSourceSha256,p_operation_id:expected.operationId});}
 catch{return pending('SOURCE_RESERVATION_UNAVAILABLE');}
 if(first?.error)return pending('SOURCE_RESERVATION_UNAVAILABLE');
 // Validate before cloning; unsupported prototypes must not become trusted DTOs.
 const source=validateNativeScheduleSourceReservation(first?.data,expected);
 if(!source.reserved)return pending(source.status);
 let second;
 try{second=await db.rpc('custodial_native_schedule_content_source',{p_operation_id:source.reservation.operation_id,
  p_employee_id:expected.employeeId,p_generation_id:expected.generationId});}
 catch{return pending('SOURCE_CONTENT_UNAVAILABLE');}
 if(second?.error)return pending('SOURCE_CONTENT_UNAVAILABLE');
 const content=second?.data;
 requireValue(exact(content,['schema','status','dispatch_authorized','delivery_admitted','source_status','candidate'])
  &&content.schema==='custodial.native-schedule-content-source.v1'&&content.dispatch_authorized===false&&content.delivery_admitted===false);
 const status=content.source_status;
 if(exact(status,['schema','status','source_current','dispatch_authorized','delivery_admitted','reservation'])
  &&status.schema==='custodial.native-schedule-source-status.v1'&&status.status==='ORIGINAL_NOT_FOUND'
  &&status.source_current===false&&status.dispatch_authorized===false&&status.delivery_admitted===false&&status.reservation===null)
  {requireValue(content.status==='CONTENT_SOURCE_UNAVAILABLE'&&content.candidate===null);return pending('ORIGINAL_NOT_FOUND');}
 requireValue(exact(status,statusKeys)&&status.schema==='custodial.native-schedule-source-status.v1'&&status.status==='ORIGINAL_SOURCE_RETAINED'
  &&typeof status.source_current==='boolean'&&status.dispatch_authorized===false&&status.delivery_admitted===false
  &&status.clock_effect_authority===null&&status.retention_authority===null);
 original(status.reservation,expected);requireValue(isDeepStrictEqual(status.reservation,source.reservation));
 if(status.source_current===false){requireValue(content.status==='CONTENT_SOURCE_UNAVAILABLE'&&content.candidate===null
  &&(stopped.has(status.current_source_status)||status.current_source_status==='CURRENT_WINDOW_SOURCE_ONLY'));return pending('ORIGINAL_SOURCE_NO_LONGER_CURRENT');}
 requireValue(status.current_source_status==='CURRENT_WINDOW_SOURCE_ONLY');
 const candidate=buildNativeScheduleContentCandidate(source,expected);
 requireValue(content.status==='CONTENT_CURRENT_SOURCE_ONLY'&&exact(content.candidate,Object.keys(candidate))&&isDeepStrictEqual(content.candidate,candidate));
 return freeze({schema:'custodial.native-schedule-content-preparation.v1',status:'CONTENT_PREPARED_NATIVE_UNQUALIFIED',reason:'FINALIZATION_AND_NATIVE_POLICY_REQUIRED',
  delivery_admitted:false,dispatch_authorized:false,clock_effect_authority:null,retention_authority:null,
  candidate});
}
