// Source-only provider-boundary tests. No live service, employee or push is used.
import assert from 'node:assert/strict';
import express from 'express';
import {installEmployeeNotificationRoutes} from '../src/employee-notifications.js';
let sent=0,validated=0,allow=false;
const job={job_id:'synthetic-job',lease_token:'synthetic-lease',job_type:'employee_native_push',payload_json:{credential_id:'synthetic-credential',assignment_epoch:1,channel_id:'employee-overdue',data_json:{kind:'employee_location_status',notification_type:'location_status',reminder_contract:'completed-cleaning-reminders.v1'}}};
const db={async rpc(name){
 if(name==='mz_get_employee_native_push_delivery_receipt')return {data:{current:true,already_recorded:false}};
 if(name==='mz_resolve_employee_push_delivery')return {data:{ok:true,registration:{registration_id:'synthetic-registration',fcm_token:'synthetic-local-test-token'}}};
 if(name==='mz_validate_employee_location_reminder'){validated++;return {data:{current:allow,reason:'location_reminder_cycle_or_responsibility_superseded'}};}
 if(name==='mz_prepare_employee_native_push_delivery')return {data:{current:true,dispatch_authorized:true}};
 if(name==='mz_record_employee_native_push_delivery')return {data:{current:true,recorded:true}};
 throw new Error('Unexpected test RPC '+name);
}};
const runtime=installEmployeeNotificationRoutes(express(),{supabase:db,pushRuntime:{configured:true,async send(){sent++;return 'synthetic-provider-id';}}});
await assert.rejects(()=>runtime.deliverClaimedJob(job),e=>e.terminal===true&&e.code==='location_reminder_cycle_or_responsibility_superseded');
assert.equal(sent,0);assert.equal(validated,1);
allow=true;await runtime.deliverClaimedJob(job);assert.equal(sent,1);assert.equal(validated,2);
console.log('DISPATCHER_CYCLE_REVALIDATION_PASS: rejected stale reminder without provider send; allowed current reminder. Mocked provider only.');
