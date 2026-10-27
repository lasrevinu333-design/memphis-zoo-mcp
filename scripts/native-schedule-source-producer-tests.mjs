import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {nativeScheduleSourceOrchestrationFixture as fixture} from './native-schedule-source-orchestration-tests.mjs';
import {prepareNativeScheduleSourceJobs as prepare,boundedNativeScheduleSourceDb,NATIVE_SCHEDULE_PREPARATION_BUDGET_MS} from '../src/native-schedule-source-producer.js';
import {qualifiedAlertDispatcher} from './fixtures/qualified-alert-dispatcher.mjs';
import {buildNativeScheduleContentCandidate} from '../src/native-schedule-delivery-preparation.js';
const clone=structuredClone;
export function nativeScheduleSourceProducerFixture({sourceStatus,readError=false,bad=false}={}){
 const f=fixture(),calls=[],controls=[];let sourceSaved=false,jobSaved=false;
 const db={rpc(fn,args){
  let signal;return {retry(v){controls.push(['retry',v]);return this;},abortSignal(v){signal=v;controls.push(['signal',v]);return this;},async then(resolve,reject){
   try{
    assert.ok(signal instanceof AbortSignal);calls.push({fn,args:clone(args)});
    if(fn==='custodial_native_schedule_source_requests')return resolve(readError?{error:{code:'PRIVATE'}}:{data:bad?{...clone(f.discovery),dispatch_authorized:true}:clone(f.discovery)});
    if(fn==='custodial_native_schedule_preparation_source'){
     const p=clone(f.projection);if(sourceStatus){p.status='SOURCE_NOT_CURRENT';p.source_status=sourceStatus;p.preparation=null;}return resolve({data:p});
    }
    if(fn==='custodial_native_schedule_source_reserve'){
     const r=clone(sourceSaved?f.retained.replay:f.first);if(!sourceSaved){
      r.reservation.operation_id=args.p_operation_id;f.first.reservation.operation_id=args.p_operation_id;f.content.source_status.reservation.operation_id=args.p_operation_id;
      f.content.candidate=buildNativeScheduleContentCandidate(r,{sourceKey:args.p_source_key,employeeId:args.p_employee_id,generationId:args.p_generation_id,expectedSourceSha256:args.p_expected_source_sha256,operationId:args.p_operation_id});
      f.retained.replay.reservation.operation_id=args.p_operation_id;sourceSaved=true;
     }return resolve({data:r});
    }
    if(fn==='custodial_native_schedule_content_source')return resolve({data:clone(f.content)});
    if(fn==='custodial_native_schedule_job_prepare'){
     const r=clone(f.receipt);if(jobSaved){r.status='ORIGINAL_JOB_RETAINED';r.replayed=true;}else{r.job.operation_id=args.p_operation;f.receipt.job.operation_id=args.p_operation;jobSaved=true;}return resolve({data:r});
    }
    throw Error('unknown source RPC');
   }catch(e){return reject(e);}
  }};
 }};
 return{f,db,calls,controls,counts:()=>({sourceSaved,jobSaved})};
}
export async function runNativeScheduleSourceProducerTests(){
 let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 eq(NATIVE_SCHEDULE_PREPARATION_BUDGET_MS,10000,'I/O bound, not cue timing');
 const f=nativeScheduleSourceProducerFixture(),first=await prepare({db:f.db});
 eq(first.status,'SOURCE_JOBS_PREPARED_NATIVE_UNQUALIFIED');eq([first.requested,first.prepared,first.replayed,first.pending,first.skipped],[1,1,0,0,0]);
 eq([first.dispatch_authorized,first.delivery_admitted,first.native_qualified,first.clock_effect_authority,first.retention_authority],[false,false,false,null,null]);
 eq(f.calls.length,5,'one read and four real helper calls');eq(f.controls.filter(x=>x[0]==='retry').map(x=>x[1]),Array(5).fill(false),'no automatic SDK replay');
 eq(new Set(f.controls.filter(x=>x[0]==='signal').map(x=>x[1])).size,1,'one owned source-pass signal');
 eq(f.controls.filter(x=>x[0]==='signal').every(x=>x[1].aborted),true,'pass signal closed after completion');
 const again=await prepare({db:f.db});eq(again.jobs.map(j=>j.job_id),first.jobs.map(j=>j.job_id),'another sweep retains same original');eq(again.replayed,1);eq(f.counts(),{sourceSaved:true,jobSaved:true});
 for(const sourceStatus of ['NO_OWNERSHIP_CHANGE','SOURCE_WINDOW_EXPIRED','WINDOW_NOT_STARTED','TARGET_STALE','SOURCE_STALE']){
  const f=nativeScheduleSourceProducerFixture({sourceStatus}),r=await prepare({db:f.db}),skip=['NO_OWNERSHIP_CHANGE','SOURCE_WINDOW_EXPIRED'].includes(sourceStatus);
  eq([r.prepared,r.skipped,r.pending],[0,skip?1:0,skip?0:1],sourceStatus);eq(f.calls.length,2,'no writes on '+sourceStatus);eq(r.delivery_admitted,false);
  eq(r.reasons,[sourceStatus],'exact disposition remains visible');eq(r.status,skip?'NO_NEW_SOURCE_JOBS':'SOURCE_PREPARATION_PENDING','skip is not pending');
 }
 const lost=nativeScheduleSourceProducerFixture({readError:true}),unknown=await prepare({db:lost.db});eq(unknown.status,'SOURCE_READ_PENDING');eq([unknown.requested,unknown.pending],[null,null],'unavailable is not an empty roster');eq(lost.calls.length,1);
 const malformed=nativeScheduleSourceProducerFixture({bad:true}),denied=await prepare({db:malformed.db});eq(denied.status,'SOURCE_PREPARATION_FAILED');eq(malformed.calls.length,1,'no writes after malformed authority');
 let called=0;const ac=new AbortController(),bounded=boundedNativeScheduleSourceDb({rpc(){called++;return{};}},ac.signal);
 assert.throws(()=>bounded.rpc('unapproved_sender',{}));checks++;eq(called,0,'unknown RPC does not start');assert.throws(()=>bounded.rpc('custodial_native_schedule_source_requests',{}));checks++;
 ac.abort();assert.throws(()=>bounded.rpc('custodial_native_schedule_source_requests',{}));checks++;eq(called,1,'closed signal prevents later request');
 // Execute the actual worker sweep. Source preparation only; its hard native
 // hold must run before OAuth/provider/finish and create no second timer.
 const workerFake=nativeScheduleSourceProducerFixture(),sourceRpc=workerFake.db.rpc.bind(workerFake.db),ordinary=[];
 workerFake.db.rpc=(fn,args)=>{
  if(fn.startsWith('custodial_native_schedule_'))return sourceRpc(fn,args);
  ordinary.push(fn);if(fn.startsWith('mz_enqueue_'))return Promise.resolve({data:0});
  if(fn==='claim_operational_notification_job_by_key')return Promise.resolve({data:{job_type:'employee_native_push',job_key:'employee-schedule-push:'+workerFake.f.first.reservation.reservation_id,
   payload_json:{data_json:{kind:'employee_schedule_ownership'}}}});
  throw Error('must not send/finish');
 };
 workerFake.db.from=table=>{eq(table,'operational_notification_jobs');const q={select(){return this;},in(){return this;},lte(){return this;},order(){return this;},limit(){return Promise.resolve({data:[{job_key:'synthetic-schedule'}]});}};return q;};
 const runtime=await qualifiedAlertDispatcher({db:workerFake.db,pushRuntime:{configured:true,send(){throw Error('no source send');}}});
 const sweep=await runtime.sweep();eq(sweep.ok,true,'ordinary sweep completed, not program readiness');eq(sweep.claimed,1);
 eq(sweep.schedule_preparation.status,'SOURCE_JOBS_PREPARED_NATIVE_UNQUALIFIED');eq(sweep.schedule_preparation.delivery_admitted,false);
 eq(ordinary,['mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes','mz_enqueue_employee_lunch_coverage_pushes','claim_operational_notification_job_by_key'],'old lanes unchanged; held schedule has no finish');
 for(const failOrdinary of [false,true]){
  const f=fixture(),log=[];let release,reads=0,fail=failOrdinary;const gate=new Promise(r=>release=r);
  const db={rpc(fn){
   if(fn==='custodial_native_schedule_source_requests')return {retry(){return this;},abortSignal(){return this;},async then(resolve){reads++;await gate;resolve({data:{...clone(f.discovery),requests:[]}});}};
   log.push(fn);return Promise.resolve(fail?{error:Error('SYNTHETIC_ORDINARY_FAILURE')}:{data:0});
  },from(){const q={select(){return this;},in(){return this;},lte(){return this;},order(){return this;},limit(){return Promise.resolve({data:[]});}};return q;}};
  const r=await qualifiedAlertDispatcher({db,pushRuntime:{configured:true}});const first=r.sweep();first.catch(()=>{});
  await new Promise(done=>setImmediate(done));eq(log.slice(0,3),['mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes','mz_enqueue_employee_lunch_coverage_pushes'],'ordinary work starts without waiting on source');
  eq((await r.sweep()).skipped,'in_flight','source lifetime remains single-flight even ordinary failure');eq(reads,1,'no second source pass');
  release();if(failOrdinary){await assert.rejects(()=>first,/SYNTHETIC_ORDINARY_FAILURE/);checks++;}else eq((await first).schedule_preparation.status,'NO_SOURCE_REQUESTS');
  fail=false;eq((await r.sweep()).ok,true,'single-flight clears after all owned source work settles');
 }
 return{status:'PASS',checks,actual_worker_sweep:true,real_helpers:true,synthetic_RPC:true,actual_SQL:false,provider_dispatch:false,phone:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runNativeScheduleSourceProducerTests()));
