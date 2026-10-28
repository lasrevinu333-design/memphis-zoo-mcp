import assert from 'node:assert/strict';
import {test} from 'node:test';
import {makeEmployeeFeedbackOriginalReceiptReader} from '../src/employee-feedback-original-receipt.js';
const op='11111111-1111-4111-8111-111111111111',employee='22222222-2222-4222-8222-222222222222',credential='33333333-3333-4333-8333-333333333333';
function fixture(){
 const request={body:{operation_id:op,hub_context:'employee',expected_employee_id:employee,expected_credential_id:credential,expected_assignment_epoch:'7'},memphisDeviceAuth:{credentialed:true},memphisDeviceCredential:{credential_id:credential},memphisDevice:{canonical_device_id:'KIOSK_08',assigned_employee_id:employee,assigned_employee_name:'Fixture',assignment_epoch:7}};
 const item={id:'44444444-4444-4444-8444-444444444444',operation_id:op,request_fingerprint:'a'.repeat(64),category:'app_problem',priority:'normal',message:'Exact original',hub_context:'employee',device_id:'KIOSK_08',page_url:null,metadata_json:{identity_verification:{status:'verified',kind:'enrolled_employee_device',device_id:'KIOSK_08',employee_id:employee,credential_id:credential,assignment_epoch:7}}};
 let reads=0,auth=0,hook=()=>{};
 const reader=makeEmployeeFeedbackOriginalReceiptReader({readItem:async id=>{assert.equal(id,op);reads++;hook();return item;},revalidate:async()=>{auth++;}});
 return{request,item,reader,counts:()=>({reads,auth}),hook:fn=>{hook=fn;}};
}
test('exact original employee receipt; read-only response has no private metadata or delivery claim',async()=>{
 const f=fixture(),r=await f.reader(f.request);assert.equal(r.data.item.operation_id,op);assert.equal(r.data.item.binding.employee_id,employee);assert.deepEqual(Object.keys(r.data.item).sort(),['binding','id','operation_id']);assert.deepEqual(f.counts(),{reads:1,auth:2});
});
test('foreign credential/epoch/device/employee and absent original cannot mint receipt',async()=>{
 for(const [key,value] of [['credential_id',employee],['assignment_epoch',8],['device_id','KIOSK_09'],['employee_id',credential]]){
  const f=fixture();f.item.metadata_json.identity_verification[key]=value;await assert.rejects(()=>f.reader(f.request));
 }
 const f=fixture();f.item.operation_id=employee;await assert.rejects(()=>f.reader(f.request));
 const absent=makeEmployeeFeedbackOriginalReceiptReader({readItem:async()=>null,revalidate:async()=>{}});await assert.rejects(()=>absent(f.request));
});
test('authority change across the read refuses original receipt',async()=>{
 const f=fixture();f.hook(()=>{f.request.memphisDevice.assignment_epoch=8;});await assert.rejects(()=>f.reader(f.request));
});
test('public selector and malformed operation cannot read',async()=>{
 for(const patch of [{hub_context:'public'},{operation_id:'bad'}]){const f=fixture();Object.assign(f.request.body,patch);await assert.rejects(()=>f.reader(f.request));assert.equal(f.counts().reads,0);}
});
