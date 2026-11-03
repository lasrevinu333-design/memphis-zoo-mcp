import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateNativeScheduleSourceRequests as validate,readNativeScheduleSourceRequests as read} from '../src/native-schedule-source-discovery.js';
const id=n=>`dc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=()=>({schema:'custodial.native-schedule-source-requests.v1',status:'SOURCE_CANDIDATES_ONLY',service_date:'2026-10-08',timezone:'America/Chicago',
 authority:{projection_id:id(1),publication_id:id(2),version_id:id(3),source_revision:'19'},
 requests:[{source_key:id(4),employee_id:id(5),generation_id:id(6)},{source_key:id(4),employee_id:id(7),generation_id:id(8)}],
 dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null});
export async function runNativeScheduleSourceDiscoveryTests(){
 let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},deny=(change,m)=>{const v=fixture();change(v);assert.throws(()=>validate(v),/native_schedule_source_discovery_invalid/,m);checks++;};
 const f=fixture();eq(validate(f),f,'exact typed source-only result');eq(Object.isFrozen(validate(f).requests[0]),true,'immutable requests');
 eq(validate({...fixture(),requests:[]}).requests,[],'no fabricated off-day recipient');
 for(const status of ['SOURCE_NOT_CURRENT','SOURCE_ORIGIN_UNSUPPORTED','SOURCE_AMBIGUOUS','SOURCE_LIMIT_EXCEEDED']){
  const v={...fixture(),status,authority:null,requests:[]};eq(validate(v),v,status);deny(x=>x.status=status,'no partial results on refusal');
 }
 for(const key of Object.keys(f))deny(v=>delete v[key],'missing field '+key);
 for(const key of Object.keys(f.authority))deny(v=>delete v.authority[key],'missing authority '+key);
 for(const key of Object.keys(f.requests[0]))deny(v=>delete v.requests[0][key],'missing request '+key);
 for(const change of [v=>v.dispatch_authorized=true,v=>v.delivery_admitted=true,v=>v.clock_effect_authority={},v=>v.retention_authority={},
  v=>v.timezone='UTC',v=>v.service_date='2026-02-30',v=>v.service_date='0000-01-01',v=>v.authority.source_revision='9007199254740992',
  v=>v.authority.source_revision=19,v=>v.status='provider_accepted',v=>v.token='PRIVATE',v=>v.requests[0].extra=true,
  v=>v.requests.reverse(),v=>v.requests[1].employee_id=v.requests[0].employee_id,v=>v.requests[1].generation_id=v.requests[0].generation_id,
  v=>v.requests[0].source_key='unknown',v=>delete v.requests[0],v=>v.requests.extra=true,
  v=>v.requests=Array(4097).fill(f.requests[0]),v=>Object.setPrototypeOf(v,{})])deny(change,'closed hostile source result');
 let getter=0;deny(v=>Object.defineProperty(v.requests[0],'source_key',{enumerable:true,get(){getter++;return id(4);}}),'getter rejected');eq(getter,0,'getter never executed');
 let calls=0;const from=fixture();const result=await read({db:{rpc:async(fn,args)=>{
  eq(fn,'custodial_native_schedule_source_requests','only protected read wrapper');eq(args,{},'no caller clock/date/actor override');calls++;return{data:from};}}});
 from.requests[0].employee_id=id(99);eq(result.requests[0].employee_id,id(5),'response snapshot retained');eq(calls,1,'no retry/refresh loop');
 for(const db of [{rpc:async()=>{throw Error('PRIVATE');}},{rpc:async()=>({error:{code:'PRIVATE'}})}]){
  const r=await read({db});eq(r,{status:'SOURCE_READ_PENDING',dispatch_authorized:false,delivery_admitted:false,requests:[]},'transport loss stays pending');
 }
 await assert.rejects(()=>read({db:{rpc:async()=>({data:{...fixture(),dispatch_authorized:true}})}}),/native_schedule_source_discovery_invalid/);checks++;
 return {status:'PASS',checks,source_only:true,SQL_executed:false,provider_dispatch:false,normal_worker_activated:false,phone:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleSourceDiscoveryTests()));
