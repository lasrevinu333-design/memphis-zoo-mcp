import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolveNativeLocationTarget,recordNativeLocationOutcome,readNativeLocationOutcome,validateNativeLocationInventoryRequest,validateNativeLocationInventoryResponse} from '../src/native-location-lifecycle.js';
const id=n=>`77000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=x=>createHash('sha256').update(x).digest('hex');
let checks=0;const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks++;console.log('PASS',name);};
const token='synthetic-lifecycle-token-only',expected={assignment_epoch:'1',credential_id:id(1),device_id:'KIOSK_08',employee_id:id(2),generation_id:id(3),principal_digest:'a'.repeat(64),registration_id:id(4),token_digest:hash(token)};
const target={current:true,expected,token};
const db=value=>({rpc:async()=>({data:value})});
const t=await resolveNativeLocationTarget({db:db(target),jobId:id(5),leaseToken:id(6)});check('synthetic strict target identity',t.expected,expected);
for(const mutate of [v=>v.token+='wrong',v=>v.extra=true,v=>v.expected.assignment_epoch=1,v=>v.expected.principal_digest=[],v=>v.expected.extra=true]){
 const v=structuredClone(target);mutate(v);await assert.rejects(()=>resolveNativeLocationTarget({db:db(v),jobId:id(5),leaseToken:id(6)}));checks++;
}
const binding={receipt_job_id:id(5),lease_token:id(6),registration_id:id(4),generation_id:id(3),reservation_at:'2026-10-02T15:00:00.123456Z',content_sha256:'b'.repeat(64),token_digest:hash(token),principal_digest:'a'.repeat(64),receipt_credential_id:id(1),receipt_assignment_epoch:'1',receipt_employee_id:id(2),receipt_device_id:'KIOSK_08'};
const evidence={operation_id:id(7),outcome:'provider_accepted',provider_message_id:'synthetic-provider-id',error_code:null};
const result={schema:'custodial.native-location-outcome-receipt.v1',binding,evidence,server_received_at:'2026-10-02T15:00:01.123456Z',replayed:false,dispatch_authorized:false};
check('synthetic exact outcome receipt',await recordNativeLocationOutcome({db:db(result),binding,evidence}),result);
for(const mutate of [v=>v.binding.generation_id=id(9),v=>v.evidence.operation_id=id(8),v=>v.extra=true,v=>v.dispatch_authorized=true,v=>v.server_received_at='2026-10-02T15:00:00.123455Z',v=>v.replayed='true']){
 const v=structuredClone(result);mutate(v);await assert.rejects(()=>recordNativeLocationOutcome({db:db(v),binding,evidence}));checks++;
}
const mutable=structuredClone(binding),pending=recordNativeLocationOutcome({binding:mutable,evidence,db:{rpc:async(name,args)=>{check('exact outcome RPC',name,'custodial_native_location_outcome');mutable.generation_id=id(99);return{data:{...result,binding:args.p_binding}};}}});
check('await cannot relabel original outcome snapshot',(await pending).binding.generation_id,id(3));
const status={schema:'custodial.native-location-outcome-status.v1',binding,dispatch_authorized:false,provider_outcome:'provider_accepted',evidence,server_received_at:result.server_received_at};
check('terminal readback does not require another settlement attempt',await readNativeLocationOutcome({db:db(status),binding}),status);
check('prepared readback remains unknown not sent',(await readNativeLocationOutcome({db:db({...status,provider_outcome:'prepared',evidence:null,server_received_at:null}),binding})).provider_outcome,'prepared');
for(const change of [{dispatch_authorized:true},{provider_outcome:'prepared'},{binding:{...binding,generation_id:id(99)}},{evidence:{...evidence,operation_id:[]}}]){
 await assert.rejects(()=>readNativeLocationOutcome({db:db({...status,...change}),binding}));checks++;
}
const request={schema:'custodial.native-provider-inventory-request.v1',scan_id:id(8),principal_digest:'a'.repeat(64),device_id:'KIOSK_08',credential_id:id(1),employee_id:id(2),assignment_epoch:1,generation_ids:[id(3)],limit:32,cursor:null,ceiling:null,server_now:null};
check('bounded native inventory request',validateNativeLocationInventoryRequest(request),request);
for(const change of [{scan_id:[id(8)]},{credential_id:1},{principal_digest:['a'.repeat(64)]},{device_id:['KIOSK_08']},{assignment_epoch:'1'},{generation_ids:[]},{generation_ids:[id(3),id(3)]},{extra:true},{limit:31},{server_now:'2026-02-30T00:00:00.000000Z'}]){
 assert.throws(()=>validateNativeLocationInventoryRequest({...request,...change}));checks++;
}
const data={...request,schema:'custodial.native-provider-inventory.v1',server_now:'2026-10-02T15:00:00.123456Z',has_more:false,rows:[]};delete data.limit;
check('explicit empty end is not presentation',validateNativeLocationInventoryResponse({ok:true,data},request),{ok:true,data});
for(const change of [{extra:true},{has_more:true},{cursor:{reservation_at:data.server_now,job_id:id(99)}},{employee_id:id(99)},{server_now:'2026-02-30T00:00:00.000000Z'}]){
 assert.throws(()=>validateNativeLocationInventoryResponse({ok:true,data:{...data,...change}},request));checks++;
}
console.log(JSON.stringify({status:'PASS',checks,syntheticRpc:true,production:false,clockQualification:false,delivery:false}));
