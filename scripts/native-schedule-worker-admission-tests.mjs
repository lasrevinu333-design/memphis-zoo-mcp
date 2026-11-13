import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {qualifiedAlertDispatcher} from './fixtures/qualified-alert-dispatcher.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/native-schedule-wire.json',import.meta.url)));
const token='synthetic-schedule-worker-admission-token',digest=createHash('sha256').update(token).digest('hex');
const expected={...f.expected,token_digest:digest},p=f.payload,id=n=>`ac000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const job={job_id:p.receipt_job_id,lease_token:id(1),job_type:'employee_native_push',job_key:`employee-schedule-push:${p.source_reservation_id}:${p.receipt_credential_id}`,
 payload_json:{credential_id:p.receipt_credential_id,device_id:id(5),device_identifier:p.receipt_device_id,employee_id:p.receipt_employee_id,assignment_epoch:p.receipt_assignment_epoch,data_json:{kind:'employee_schedule_ownership',source_reservation_id:p.source_reservation_id}}};
let checks=0,sends=0;const calls=[],handlers={};
const db={rpc:async(name)=>{calls.push(name);
 if(name==='custodial_native_schedule_dispatch_status')return{data:{schema:'custodial.native-schedule-dispatch-status.v1',attempted:false,dispatch_authorized:false,delivery_admitted:false,attempt:null}};
 if(name==='custodial_native_schedule_target')return{data:{schema:'custodial.native-schedule-target.v1',current:true,delivery_admitted:false,expected,token,source_candidate:f.sourceCandidate}};
 if(name==='custodial_native_schedule_dispatch_prepare')return{data:{schema:'custodial.native-schedule-dispatch.v1',dispatch_authorized:false,delivery_admitted:false,replayed:false,reason:'NATIVE_RELEASE_UNQUALIFIED',attempt:null}};
 assert.fail('No alternate RPC or legacy sender: '+name);
}};
const runtime=await qualifiedAlertDispatcher({db,pushRuntime:{configured:true,prepareNativeScheduleSender:async()=>{calls.push('prepare-private-sender');return async()=>{sends++;assert.fail('Unaccepted release cannot send');};}},registerOperationalJobHandler:(kind,handler)=>handlers[kind]=handler});
assert.equal(handlers.employee_native_push,runtime.deliverClaimedJob);checks++;
await assert.rejects(()=>handlers.employee_native_push(job),e=>e.code==='native_schedule_delivery_unqualified'&&e.deferFinish===true&&e.terminal===false);checks++;
assert.deepEqual(calls,['custodial_native_schedule_dispatch_status','prepare-private-sender','custodial_native_schedule_target','custodial_native_schedule_dispatch_prepare']);checks++;
assert.equal(sends,0);checks++;
for(const changed of [{...job,job_type:'malformed'},{...job,payload_json:{...job.payload_json,data_json:{kind:'wrong'}}}]){
 const n=calls.length;await assert.rejects(()=>runtime.deliverClaimedJob(changed),e=>e.code==='native_schedule_delivery_unqualified');checks++;
 assert.equal(calls.length,n);checks++;
}
for(const data of [{...job.payload_json.data_json,test_delivery:true},{...job.payload_json.data_json,enabled:true}]){
 const n=calls.length;await assert.rejects(()=>runtime.deliverClaimedJob({...job,payload_json:{...job.payload_json,data_json:data}}),e=>e.code==='native_schedule_dispatch_contract_invalid');checks++;
 assert.equal(calls.length,n);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,actual_worker:true,actual_dispatcher:true,SQL:false,synthetic_transport:true,provider_sends:sends,production:false}));
