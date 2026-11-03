import assert from 'node:assert/strict';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import {prepareDiscoveredNativeScheduleJob as prepare,validateNativeSchedulePreparationSource as validate} from '../src/native-schedule-source-orchestration.js';
import {validateNativeLocationRecipient} from '../src/native-location-reservation.js';
import {buildNativeScheduleContentCandidate} from '../src/native-schedule-delivery-preparation.js';
const clone=structuredClone,id=n=>`ed000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const retained=JSON.parse(fs.readFileSync(new URL('./fixtures/native-schedule-source-original.json',import.meta.url))),first=retained.first,w=first.reservation.window,r=w.recipient;
 const request={source_key:w.assignment_occurrence_id,employee_id:w.employee_id,generation_id:w.generation_id};
 const authority=Object.fromEntries(['projection_id','publication_id','version_id','source_revision'].map(k=>[k,w[k]]));
 const expected={assignment_epoch:String(r.assignment_epoch),credential_id:r.credential_id,device_id:r.device_identifier,
  employee_id:r.employee_id,generation_id:r.generation_id,principal_digest:r.principal_digest,registration_id:id(9),token_digest:r.token_digest};
 const discovery={schema:'custodial.native-schedule-source-requests.v1',status:'SOURCE_CANDIDATES_ONLY',service_date:w.service_date,timezone:'America/Chicago',authority,
  requests:[request],dispatch_authorized:false,delivery_admitted:false,clock_effect_authority:null,retention_authority:null};
 const projection={schema:'custodial.native-schedule-preparation-source.v1',status:'CURRENT_PREPARATION_SOURCE_ONLY',source_status:'CURRENT_WINDOW_SOURCE_ONLY',dispatch_authorized:false,delivery_admitted:false,
  clock_effect_authority:null,retention_authority:null,preparation:{...request,service_date:w.service_date,...authority,expected_source_sha256:w.server_source_sha256,expected}};
 const args={sourceKey:request.source_key,employeeId:request.employee_id,generationId:request.generation_id,expectedSourceSha256:w.server_source_sha256,operationId:first.reservation.operation_id};
 const candidate=buildNativeScheduleContentCandidate(first,args);
 const content={schema:'custodial.native-schedule-content-source.v1',status:'CONTENT_CURRENT_SOURCE_ONLY',dispatch_authorized:false,delivery_admitted:false,candidate,
  source_status:{schema:'custodial.native-schedule-source-status.v1',status:'ORIGINAL_SOURCE_RETAINED',source_current:true,current_source_status:'CURRENT_WINDOW_SOURCE_ONLY',dispatch_authorized:false,
   delivery_admitted:false,clock_effect_authority:null,retention_authority:null,reservation:clone(first.reservation)}};
 const receipt={schema:'custodial.native-schedule-job-preparation.v1',status:'JOB_PREPARED_NATIVE_UNQUALIFIED',prepared:true,replayed:false,dispatch_authorized:false,delivery_admitted:false,
  job:{job_id:id(10),operation_id:id(11),source_reservation_id:first.reservation.reservation_id,prepared_at:w.server_now,payload_sha256:'a'.repeat(64),source_window_sha256:first.reservation.window_sha256}};
 return {retained,first,w,request,discovery,projection,args,candidate,content,receipt,expected};
}
export {fixture as nativeScheduleSourceOrchestrationFixture};
export async function runNativeScheduleSourceOrchestrationTests(){
 let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},reject=async(fn,m)=>{await assert.rejects(fn,undefined,m);checks++;};
 const f=fixture();assert.throws(()=>validateNativeLocationRecipient(f.w.recipient));checks++;
 eq(validate(f.projection,f),f.projection,'authoritative native expected projection, not raw window alias');
 for(const key of Object.keys(f.projection)){const v=clone(f.projection);delete v[key];assert.throws(()=>validate(v,f));checks++;}
 for(const key of Object.keys(f.projection.preparation)){const v=clone(f.projection);delete v.preparation[key];assert.throws(()=>validate(v,f));checks++;}
 for(const key of Object.keys(f.expected)){const v=clone(f.projection);delete v.preparation.expected[key];assert.throws(()=>validate(v,f));checks++;}
 for(const edit of [v=>v.dispatch_authorized=true,v=>v.delivery_admitted=true,v=>v.clock_effect_authority={},v=>v.retention_authority={},
  v=>v.preparation.expected.registration_id='guess',v=>v.preparation.expected.device_id=f.w.recipient.device_id,v=>v.preparation.expected.assignment_epoch=1,
  v=>v.preparation.employee_id=id(99),v=>v.preparation.generation_id=id(99),v=>v.preparation.source_key=id(99),v=>v.preparation.service_date='2026-10-09',
  v=>v.preparation.projection_id=id(99),v=>v.preparation.publication_id=id(99),v=>v.preparation.version_id=id(99),v=>v.preparation.source_revision='999',
  v=>v.preparation.expected_source_sha256='guess',v=>v.token='PRIVATE',v=>v.preparation.expected.extra=true,v=>Object.setPrototypeOf(v,{})]){
  const v=clone(f.projection);edit(v);assert.throws(()=>validate(v,f));checks++;
 }
 let getter=0;const hostile=clone(f.projection);Object.defineProperty(hostile.preparation.expected,'registration_id',{enumerable:true,get(){getter++;return id(9);}});
 assert.throws(()=>validate(hostile,f));checks++;eq(getter,0,'getter never executed');
 const invoke=async({editProjection,editReceipt,transportAt,mutateContext,replay=false}={})=>{
  const v=fixture(),calls=[],ctx={discovery:v.discovery,request:v.request,sourceOperationId:replay?id(90):v.first.reservation.operation_id,jobOperationId:replay?id(91):id(11)};
  const db={rpc:async(fn,args)=>{
   calls.push({fn,args:clone(args)});
   if(fn===transportAt)return {error:{message:'PRIVATE'}};
   if(fn==='custodial_native_schedule_preparation_source'){
    const p=clone(v.projection);editProjection?.(p);if(mutateContext){ctx.request.employee_id=id(99);ctx.discovery.authority.projection_id=id(99);}return{data:p};
   }
   if(fn==='custodial_native_schedule_source_reserve')return{data:clone(replay?v.retained.replay:v.first)};
   if(fn==='custodial_native_schedule_content_source')return{data:clone(v.content)};
   if(fn==='custodial_native_schedule_job_prepare'){
    const r=clone(v.receipt);if(replay){r.replayed=true;r.status='ORIGINAL_JOB_RETAINED';}editReceipt?.(r);return{data:r};
   }
   throw Error('unexpected private RPC');
  }};
  return{result:await prepare({db,...ctx}),calls,v};
 };
 const ok=await invoke();eq(ok.calls.map(c=>c.fn),['custodial_native_schedule_preparation_source','custodial_native_schedule_source_reserve','custodial_native_schedule_content_source','custodial_native_schedule_job_prepare'],'actual real helper chain');
 eq(ok.result.status,'SOURCE_JOB_PREPARED_NATIVE_UNQUALIFIED','prepared is not send admission');eq(ok.result.job,ok.v.receipt.job,'exact job original');
 eq([ok.result.dispatch_authorized,ok.result.delivery_admitted,ok.result.clock_effect_authority,ok.result.retention_authority],[false,false,null,null]);
 eq(ok.calls[0].args,{p_source:f.request.source_key,p_employee:f.request.employee_id,p_generation:f.request.generation_id},'no caller clock/date');
 eq(ok.calls[1].args.p_expected_source_sha256,f.w.server_source_sha256,'SQL digest retained');eq(ok.calls[3].args.p_expected,f.expected,'no guessed registration');
 const changed=await invoke({mutateContext:true});eq(changed.result,ok.result,'immutable source context across await');
 const replayed=await invoke({replay:true});eq(replayed.result.source_operation_id,f.first.reservation.operation_id,'source retry retains original operation');eq(replayed.result.job.operation_id,id(11),'job retry retains original operation');eq(replayed.result.replayed,true);
 for(const fn of ok.calls.map(c=>c.fn)){
  const pending=await invoke({transportAt:fn});eq(pending.result.status,'SOURCE_JOB_PENDING','loss remains pending '+fn);eq(pending.result.delivery_admitted,false);eq(pending.calls.length,ok.calls.findIndex(c=>c.fn===fn)+1,'no retry or later call '+fn);
 }
 const stale=await invoke({editProjection:p=>{p.status='SOURCE_NOT_CURRENT';p.source_status='TARGET_STALE';p.preparation=null;}});eq(stale.calls.length,1,'no reservation on stale source');eq(stale.result.reason,'TARGET_STALE');
 for(const source_status of ['TARGET_STALE','SOURCE_STALE','WINDOW_NOT_STARTED','SOURCE_WINDOW_EXPIRED','NO_OWNERSHIP_CHANGE']){
  const v={...clone(f.projection),status:'SOURCE_NOT_CURRENT',source_status,preparation:null};eq(validate(v,f),v,'exact source disposition '+source_status);
 }
 for(const change of [v=>v.source_status='UNKNOWN',v=>v.source_status='NO_OWNERSHIP_CHANGE',v=>{v.status='SOURCE_NOT_CURRENT';v.preparation=null;}]){
  const v=clone(f.projection);change(v);assert.throws(()=>validate(v,f));checks++;
 }
 const retired=await invoke({editReceipt:r=>{r.status='SOURCE_OR_ACTOR_SUPERSEDED';r.prepared=false;r.replayed=false;r.job=null;}});eq(retired.result.status,'SOURCE_JOB_PENDING','changed actor creates no admission');
 await reject(()=>invoke({editProjection:p=>p.preparation.publication_id=id(99)}),'changed publication refuses before writes');
 await reject(()=>invoke({editReceipt:r=>r.delivery_admitted=true}),'job cannot invent delivery');
 await reject(()=>prepare({db:{rpc:async()=>{throw Error('must not call');}},...f,request:{...f.request,employee_id:id(99)},sourceOperationId:id(11),jobOperationId:id(12)}),'unlisted actor refused before read');
 return{status:'PASS',checks,actual_helpers_executed:true,synthetic_RPC:true,actual_SQL:false,provider_dispatch:false,normal_worker_activated:false,phone:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleSourceOrchestrationTests()));
