import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {NATIVE_EVENT_SCHEMA,NATIVE_MESSAGE_SCHEMA,NATIVE_EVENT_KEYS,NATIVE_MESSAGE_KEYS,canonicalNativeAlert} from './native-alert-reservation.js';
import {NATIVE_SCHEDULE_PAYLOAD_SCHEMA,NATIVE_SCHEDULE_PAYLOAD_KEYS} from './native-schedule-payload.js';

// Inventory response validation ONLY. SQL owns current business source and
// original registration/token bindings; this parser does not manufacture a
// reservation recipient/registration/source candidate or grant dispatch.
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const ACTOR=['generation_id','principal_digest','credential_id','employee_id','device_id','assignment_epoch'].sort();
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype
 &&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'))
 &&isDeepStrictEqual(Reflect.ownKeys(v).sort(),[...keys].sort());
const fail=()=>{throw new Error('native_provider_inventory_payload_invalid');};
const text=v=>typeof v==='string'&&Buffer.from(v,'utf8').toString('utf8')===v;
function date(v){
 const m=text(v)&&/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);if(!m)fail();
 const[y,month,day]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1])fail();return v;
}
function instant(v){
 const m=text(v)&&/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)fail();
 date(m[1]);if(Number(m[2])>23||Number(m[3])>59||Number(m[4])>59)fail();return v;
}
function positive(v,maxDigits){
 if(!text(v)||!new RegExp('^[1-9][0-9]{0,'+(maxDigits-1)+'}$').test(v)||BigInt(v)>9007199254740991n)fail();
}
export function validateNativeProviderInventoryPayload(p,actor){
 if(!exact(actor,ACTOR)||Object.values(actor).some(v=>!text(v))
  ||![actor.generation_id,actor.credential_id,actor.employee_id].every(v=>UUID.test(v))
  ||!SHA.test(actor.principal_digest)||!/^KIOSK_(?:0[2-9]|10)$/.test(actor.device_id))fail();
 positive(actor.assignment_epoch,16);
 const schema=p&&Object.getPrototypeOf(p)===Object.prototype?Object.getOwnPropertyDescriptor(p,'schema')?.value:null;
 const schedule=schema===NATIVE_SCHEDULE_PAYLOAD_SCHEMA,event=schema===NATIVE_EVENT_SCHEMA,message=schema===NATIVE_MESSAGE_SCHEMA;
 if(!schedule&&!event&&!message)fail();
 if(!exact(p,schedule?NATIVE_SCHEDULE_PAYLOAD_KEYS:event?NATIVE_EVENT_KEYS:NATIVE_MESSAGE_KEYS)
  ||Object.entries(p).some(([k,v])=>!text(v)||!v||/[\u0000-\u001f\u007f-\u009f]/u.test(v)
   ||Buffer.byteLength(v)>({title:180,notification_key:240}[k]||1000)))fail();
 for(const [field,key] of Object.entries({generation_id:'generation_id',principal_digest:'principal_digest',receipt_credential_id:'credential_id',
  receipt_employee_id:'employee_id',receipt_device_id:'device_id',receipt_assignment_epoch:'assignment_epoch'}))if(p[field]!==actor[key])fail();
 for(const k of ['generation_id','receipt_job_id','receipt_credential_id','receipt_employee_id'])if(!UUID.test(p[k]))fail();
 for(const k of ['principal_digest','token_digest','content_sha256'])if(!SHA.test(p[k]))fail();
 const from=instant(p.reservation_at),until=instant(p.valid_until);if(from>=until)fail();date(p.service_date);
 const wire=canonicalNativeAlert(p);if(Buffer.byteLength(wire)>3500
  ||createHash('sha256').update(canonicalNativeAlert(p,{excludeHash:true})).digest('hex')!==p.content_sha256)fail();
 if(schedule){
  if(p.kind!=='employee_schedule_ownership'||p.notification_type!=='schedule_ownership'||p.channel_id!=='employee-schedule-ownership'
   ||p.route!=='employee-schedule.html?hub=employee'||p.boundary_local!=='09:45'
   ||p.notification_key!==`schedule-ownership:${p.service_date}:${actor.employee_id}:09:45`)fail();
  for(const k of ['source_reservation_id','source_operation_id','projection_id','publication_id','version_id','assignment_occurrence_id'])if(!UUID.test(p[k]))fail();
  for(const k of ['source_window_sha256','server_source_sha256'])if(!SHA.test(p[k]))fail();positive(p.source_revision,16);
  const start=instant(p.source_valid_from),end=instant(p.source_valid_until);if(start>from||until>end||start>=end)fail();
  const x=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
   .formatToParts(new Date(start)).map(v=>[v.type,v.value]));
  if(`${x.year.padStart(4,'0')}-${x.month}-${x.day}`!==p.service_date||x.hour!=='09'||x.minute!=='45'||x.second!=='00'||!start.endsWith('00.000000Z'))fail();
 }else if(event){
  if(p.kind!=='employee_event'||p.notification_type!=='event'||p.channel_id!=='employee-events'
   ||![p.event_id,p.instance_id,p.recipient_device_uuid].every(v=>UUID.test(v))||!SHA.test(p.source_revision)
   ||!['three_days_before','two_days_before','shift_plus_15'].includes(p.notification_kind))fail();positive(p.event_revision,10);
  if(p.route!==`events.html?hub=employee&event_id=${p.event_id}`
   ||p.notification_key!==`event:${p.event_id}:${p.event_revision}:${p.service_date}:${actor.employee_id}:${p.recipient_device_uuid}:${actor.assignment_epoch}:${p.notification_kind}`)fail();
 }else{
  if(p.kind!=='employee_message'||p.notification_type!=='message'||p.channel_id!=='employee-messages'
   ||![p.message_id,p.thread_id,p.recipient_user_id].every(v=>UUID.test(v))||!SHA.test(p.source_revision)
   ||p.notification_key!==`message:${p.message_id}`||p.route!==`messages.html?hub=employee&thread_id=${p.thread_id}`)fail();
 }
 return Object.freeze({...p});
}
