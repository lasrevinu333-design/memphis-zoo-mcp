import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,sha=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort());
const fail=()=>{throw Object.assign(new Error('native_provider_event_contract_invalid'),{status:400,code:'native_provider_event_contract_invalid'});};
export const NATIVE_PROVIDER_EVENT_FIELDS=Object.freeze(['schema','event_id','record_id','action','generation_id','content_sha256','receipt_job_id','notification_key',
 'receipt_credential_id','receipt_employee_id','receipt_device_id','receipt_assignment_epoch','principal_digest','token_digest','original_observation','admitted_at']);
const actions=['received','displayed','opened','acknowledged'];
function time(v){
 const m=typeof v==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(v);if(!m)fail();
 const[y,month,day,h,min,s]=m.slice(1).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||month<1||month>12||day<1||day>days[month-1]||h>23||min>59||s>59)fail();return v;
}
function event(v){
 if(!exact(v,NATIVE_PROVIDER_EVENT_FIELDS)||v.schema!=='custodial.native-provider-event.v1'||!actions.includes(v.action))fail();
 for(const k of ['event_id','generation_id','receipt_job_id','receipt_credential_id','receipt_employee_id'])if(typeof v[k]!=='string'||!uuid.test(v[k]))fail();
 for(const k of ['record_id','content_sha256','principal_digest','token_digest'])if(typeof v[k]!=='string'||!sha.test(v[k]))fail();
 if(typeof v.receipt_device_id!=='string'||!/^KIOSK_(?:0[2-9]|10)$/.test(v.receipt_device_id)
  ||!Number.isSafeInteger(v.receipt_assignment_epoch)||v.receipt_assignment_epoch<1||typeof v.notification_key!=='string'
  ||v.notification_key.length<1||v.notification_key.length>1000||/[\u0000-\u001f\u007f-\u009f]/u.test(v.notification_key))fail();
 if(createHash('sha256').update(v.generation_id+'\n'+v.receipt_job_id+'\n'+v.notification_key).digest('hex')!==v.record_id)fail();
 time(v.admitted_at);const o=v.original_observation;
 if(!exact(o,['authenticated_at','elapsed_realtime_ms','boot_count']))fail();
 for(const k of ['elapsed_realtime_ms','boot_count'])if(o[k]!==null&&(!Number.isSafeInteger(o[k])||o[k]<0))fail();
 if(o.boot_count!==null&&o.boot_count>2147483647)fail();
 if(o.authenticated_at!==null){time(o.authenticated_at);if(o.elapsed_realtime_ms===null||o.boot_count===null)fail();}
 if(v.action==='displayed'&&o.authenticated_at===null)fail();
 return Object.freeze({...v,original_observation:Object.freeze({...o})});
}
export function validateNativeProviderEventsRequest(body){
 if(!exact(body,['schema','events'])||body.schema!=='custodial.native-provider-events.v1'||!Array.isArray(body.events)
  ||body.events.length<1||body.events.length>16||Buffer.byteLength(JSON.stringify(body))>65536)fail();
 const events=body.events.map(event),ids=new Set(),transitions=new Set(),principal=events[0];
 for(const e of events){
  if(ids.has(e.event_id)||transitions.has(e.record_id+'\n'+e.action))fail();ids.add(e.event_id);transitions.add(e.record_id+'\n'+e.action);
  for(const k of ['receipt_credential_id','receipt_employee_id','receipt_device_id','receipt_assignment_epoch','principal_digest'])if(e[k]!==principal[k])fail();
 }
 return Object.freeze({schema:body.schema,events:Object.freeze(events)});
}
export function validateNativeProviderEventsResponse(value,request){
 const body=validateNativeProviderEventsRequest(request),byId=new Map(body.events.map(e=>[e.event_id,e]));
 if(!exact(value,['ok','data'])||value.ok!==true||!exact(value.data,['schema','results'])
  ||value.data.schema!=='custodial.native-provider-event-receipts.v1'||!Array.isArray(value.data.results)||value.data.results.length>16)fail();
 const seen=new Set(),results=[];
 for(const r of value.data.results){
  const e=byId.get(r?.event_id);if(!e||seen.has(r.event_id))fail();seen.add(r.event_id);
  if(r.admitted_state==='REJECTED'){
   if(!exact(r,['event_id','admitted_state','code'])||!['native_provider_original_binding_invalid','native_provider_event_conflict','native_provider_transition_pending','native_provider_observation_invalid'].includes(r.code))fail();
   results.push(Object.freeze({...r}));continue;
  }
  if(!exact(r,[...NATIVE_PROVIDER_EVENT_FIELDS,'admitted_state','server_received_at','replayed'])||r.schema!=='custodial.native-provider-event-receipt.v1'
   ||r.admitted_state!=='ACCEPTED'||typeof r.replayed!=='boolean')fail();
  const original={...r,schema:e.schema};delete original.admitted_state;delete original.server_received_at;delete original.replayed;
  if(!isDeepStrictEqual(original,e)||time(r.server_received_at)<e.admitted_at)fail();
  results.push(Object.freeze({...r,original_observation:e.original_observation}));
 }
 // An omitted result is pending, never synthesized as accepted.
 return Object.freeze({ok:true,data:Object.freeze({schema:value.data.schema,results:Object.freeze(results)})});
}
