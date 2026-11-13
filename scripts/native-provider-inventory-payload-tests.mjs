import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateNativeProviderInventoryPayload} from '../src/native-provider-inventory-payload.js';
import {validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
import {canonicalNativeAlert} from '../src/native-alert-reservation.js';
import {syntheticNativeAlertWire} from './fixtures/native-alert-wire-fixture.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const schedule=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url),'utf8')).payload;
const actor=p=>({generation_id:p.generation_id,principal_digest:p.principal_digest,credential_id:p.receipt_credential_id,
 employee_id:p.receipt_employee_id,device_id:p.receipt_device_id,assignment_epoch:p.receipt_assignment_epoch});
const rehash=p=>({...p,content_sha256:sha(canonicalNativeAlert(p,{excludeHash:true}))});
function page(payloads){
 const p=payloads[0],request={schema:'custodial.native-provider-inventory-request.v1',scan_id:id(1),principal_digest:p.principal_digest,
  device_id:p.receipt_device_id,credential_id:p.receipt_credential_id,employee_id:p.receipt_employee_id,assignment_epoch:Number(p.receipt_assignment_epoch),
  generation_ids:[p.generation_id],limit:32,cursor:null,ceiling:null,server_now:null};
 const rows=[...payloads].sort((a,b)=>(a.reservation_at+' '+a.receipt_job_id).localeCompare(b.reservation_at+' '+b.receipt_job_id));
 const last=rows.at(-1),cursor={reservation_at:last.reservation_at,job_id:last.receipt_job_id};
 const data={...request,schema:'custodial.native-provider-inventory.v1',server_now:p.reservation_at,has_more:false,
  cursor,ceiling:cursor,rows:rows.map(payload=>({payload,provider_outcome:'prepared'}))};delete data.limit;
 return{request,response:{ok:true,data}};
}
export function runNativeProviderInventoryPayloadTests(){
 let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;},reject=(name,fn)=>{assert.throws(fn,undefined,name);checks++;};
 for(const p of [syntheticNativeAlertWire.event,syntheticNativeAlertWire.message,schedule]){
  check('typed payload '+p.kind,validateNativeProviderInventoryPayload(p,actor(p)),p);
  const {request,response}=page([p]);check('typed inventory envelope '+p.kind,validateNativeLocationInventoryResponse(response,request),response);
  for(const key of Object.keys(p))reject('missing closed field '+p.kind+'/'+key,()=>{const bad={...p};delete bad[key];validateNativeProviderInventoryPayload(bad,actor(p));});
  for(const change of [{extra:true},{schema:'custodial.unknown'},{kind:'employee_location_status'},{notification_type:'location_status'},
   {channel_id:'employee-location-status'},{route:'https://example.invalid/'},{receipt_employee_id:id(2)},{receipt_credential_id:id(3)},
   {receipt_device_id:'KIOSK_01'},{receipt_assignment_epoch:'2.0'},{token_digest:'bad'},{service_date:'2026-02-30'},
   {reservation_at:'2026-02-30T15:00:00.000000Z'},{valid_until:p.reservation_at},{content_sha256:'d'.repeat(64)},
   {title:'a'.repeat(181)},{body:'x'.repeat(1001)},{body:'bad\ncontent'},{body:'bad\ud800'}]){
   const bad={...p,...change};if(Object.values(bad).every(x=>typeof x==='string')&&Object.keys(change)[0]!=='content_sha256'){
    try{bad.content_sha256=sha(canonicalNativeAlert(bad,{excludeHash:true}));}catch{/* malformed content is still rejected below */}
   }
   reject('bad '+p.kind+'/'+Object.keys(change)[0],()=>validateNativeProviderInventoryPayload(bad,actor(p)));
  }
  for(const key of Object.keys(actor(p)))reject('wrong envelope actor '+p.kind+'/'+key,()=>validateNativeProviderInventoryPayload(p,{...actor(p),[key]:'wrong'}));
  reject('registration must not be invented '+p.kind,()=>validateNativeProviderInventoryPayload(p,{...actor(p),registration_id:id(6)}));
  reject('prototype rejected '+p.kind,()=>validateNativeProviderInventoryPayload(Object.assign(Object.create(null),p),actor(p)));
  const getter={...p};Object.defineProperty(getter,'schema',{enumerable:true,get(){throw new Error('getter executed');}});
  reject('accessor rejected without evaluation '+p.kind,()=>validateNativeProviderInventoryPayload(getter,actor(p)));
  const wrong={...response,data:{...response.data,rows:[{payload:p,provider_outcome:'known_nonacceptance'}]}};
  reject('nonacceptance excluded '+p.kind,()=>validateNativeLocationInventoryResponse(wrong,request));
 }
 for(const change of [{boundary_local:'09:44'},{source_revision:'0'},{source_revision:'9007199254740992'},{source_reservation_id:'000000AA-0000-4000-8000-000000000999'},
  {source_operation_id:'not-a-uuid'},{source_window_sha256:'bad'},{server_source_sha256:'bad'},
  {source_valid_from:schedule.source_valid_from.replace('45:00','44:00')},{source_valid_until:schedule.reservation_at},
  {valid_until:'2026-10-08T15:01:00.000000Z'}])reject('schedule source shape '+Object.keys(change)[0],()=>validateNativeProviderInventoryPayload(rehash({...schedule,...change}),actor(schedule)));
 const s=actor(schedule),shared=p=>{
  const x={...p,generation_id:s.generation_id,principal_digest:s.principal_digest,receipt_credential_id:s.credential_id,
   receipt_employee_id:s.employee_id,receipt_device_id:s.device_id,receipt_assignment_epoch:s.assignment_epoch,
   reservation_at:schedule.reservation_at,valid_until:schedule.valid_until,service_date:schedule.service_date};
  if(x.kind==='employee_event')x.notification_key=`event:${x.event_id}:${x.event_revision}:${x.service_date}:${s.employee_id}:${x.recipient_device_uuid}:${s.assignment_epoch}:${x.notification_kind}`;
  return rehash(x);
 };
 const event=shared(syntheticNativeAlertWire.event),message=shared({...syntheticNativeAlertWire.message,receipt_job_id:id(7)}),mixed=page([schedule,event,message]);
 check('mixed three-kind source envelope',validateNativeLocationInventoryResponse(mixed.response,mixed.request),mixed.response);
 reject('mixed payload generation not in scan',()=>validateNativeLocationInventoryResponse({...mixed.response,data:{...mixed.response.data,
  rows:mixed.response.data.rows.map((x,i)=>i?x:{...x,payload:rehash({...x.payload,generation_id:id(9)})})}},mixed.request));
 reject('expired mixed inventory',()=>validateNativeLocationInventoryResponse({...mixed.response,data:{...mixed.response.data,server_now:schedule.valid_until}},mixed.request));
 reject('duplicate inventory tuple',()=>validateNativeLocationInventoryResponse({...mixed.response,data:{...mixed.response.data,rows:[mixed.response.data.rows[0],...mixed.response.data.rows]}},mixed.request));
 // A correctly rehashed alternative body is just format-valid. Current SQL
 // receipt/source equality, not this shape parser, must refuse its admission.
 const altered=rehash({...schedule,body:'Different, format-valid content'});
 check('shape validation is not business-source admission',validateNativeProviderInventoryPayload(altered,actor(schedule)).body,altered.body);
 return Object.freeze({status:'PASS',checks,SQL_executed:false,production:false,native_qualified:false,provider_dispatch:false,phone:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(runNativeProviderInventoryPayloadTests()));
