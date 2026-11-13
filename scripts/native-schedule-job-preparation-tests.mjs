import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {prepareNativeScheduleJob,holdUnqualifiedNativeScheduleJob} from '../src/native-schedule-job-preparation.js';
import {qualifiedAlertDispatcher} from './fixtures/qualified-alert-dispatcher.mjs';
import {messageFixture} from './fixtures/native-message-dispatch-fixture.mjs';
const id=n=>`bb000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url),'utf8')),expected=fixture.expected,source=fixture.payload.source_reservation_id;
const first={schema:'custodial.native-schedule-job-preparation.v1',status:'JOB_PREPARED_NATIVE_UNQUALIFIED',prepared:true,replayed:false,dispatch_authorized:false,delivery_admitted:false,
 job:{job_id:id(1),operation_id:id(2),source_reservation_id:source,prepared_at:fixture.payload.reservation_at,payload_sha256:'a'.repeat(64),source_window_sha256:'b'.repeat(64)}};
export async function runNativeScheduleJobPreparationTests(){
 let checks=0;const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks++;},reject=async(name,fn)=>{await assert.rejects(fn,undefined,name);checks++;};
 const prepare=(value=first,db)=>prepareNativeScheduleJob({db:db??{rpc:async()=>({data:value})},sourceReservationId:source,operationId:id(2),expected});
 check('exact source-only job receipt',await prepare(),first);
 const replay={...first,status:'ORIGINAL_JOB_RETAINED',replayed:true,job:{...first.job,operation_id:id(3)}};check('original replay retains original operation',await prepare(replay),replay);
 for(const status of ['ORIGINAL_JOB_CONFLICT','SOURCE_OR_ACTOR_SUPERSEDED','UNOWNED_JOB_CONFLICT']){
  const r={...first,status,prepared:false,replayed:false,job:null};check('explicit refusal '+status,await prepare(r),r);
 }
 for(const key of Object.keys(first)){const r=structuredClone(first);delete r[key];await reject('closed response '+key,()=>prepare(r));}
 for(const key of Object.keys(first.job)){const r=structuredClone(first);delete r.job[key];await reject('closed original '+key,()=>prepare(r));}
 for(const change of [{dispatch_authorized:true},{delivery_admitted:true},{extra:true},{schema:'other'},{prepared:'true'},
  {job:{...first.job,source_reservation_id:id(99)}},{job:{...first.job,operation_id:id(99)}},{job:{...first.job,prepared_at:'2026-02-30T15:00:00.000000Z'}},
  {job:{...first.job,payload_sha256:'bad'}},{job:{...first.job,extra:true}}])await reject('bad receipt '+Object.keys(change)[0],()=>prepare({...first,...change}));
 for(const db of [{rpc:async()=>{throw Error('SYNTHETIC_PRIVATE_LOSS');}},{rpc:async()=>({error:{code:'XX000',message:'PRIVATE'}})}]){
  const r=await prepare(first,db);check('loss stays pending without send/terminal receipt',[r.status,r.dispatch_authorized,r.delivery_admitted,r.job],['JOB_PREPARATION_PENDING',false,false,null]);
 }
 let mutable={...expected};const r=await prepareNativeScheduleJob({sourceReservationId:source,operationId:id(2),expected:mutable,db:{rpc:async(name,args)=>{
  check('exact job RPC',name,'custodial_native_schedule_job_prepare');mutable.generation_id=id(99);check('actor snapshot preserved',args.p_expected,expected);return{data:first};}}});
 check('snapshot result retained',r,first);
 for(const kind of ['employee_message','employee_lunch_coverage','employee_location_status','employee_event'])check('ordinary kind not captured '+kind,
  holdUnqualifiedNativeScheduleJob({job_key:'ordinary',payload_json:{data_json:{kind}}}),undefined);
 const variants=[{job_key:'employee-schedule-push:'+source,payload_json:{data_json:{kind:'employee_message'}}},
  {job_key:'other',payload_json:{data_json:{kind:'employee_schedule_ownership'}}},
  {job_key:'employee-schedule-push:'+source,payload_json:{}},
  ...[true,false,null,'true',1,{},[]].map(test_delivery=>({job_key:'other',payload_json:{data_json:{kind:'employee_schedule_ownership',test_delivery}}}))];
 const f=messageFixture(),runtime=await qualifiedAlertDispatcher(f);
 for(const v of variants){
  await reject('actual dispatcher cannot legacy-forward SCHEDULE',async()=>runtime.deliverClaimedJob({...f.job,...v}));
  let error;try{holdUnqualifiedNativeScheduleJob(v);}catch(e){error=e;}
  check('unqualified hold neither terminal nor finishable',[error.code,error.deferFinish,error.terminal,error.permanent],['native_schedule_delivery_unqualified',true,false,false]);
 }
 check('actual dispatcher made no DB/OAuth/provider calls',[f.calls.length,f.requests.length],[0,0]);
 return Object.freeze({status:'PASS',checks,synthetic_RPC:true,worker_body_executed:true,actual_SQL:false,provider_dispatch:false,native_qualified:false,phone:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await runNativeScheduleJobPreparationTests()));
