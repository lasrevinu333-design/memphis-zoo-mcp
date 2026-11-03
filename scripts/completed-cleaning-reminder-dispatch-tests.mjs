// Actual current LOCATION worker; explicit synthetic SQL and provider only.
// No current/expired admission is inferred from the local fixture clock.
import assert from 'node:assert/strict';
import express from 'express';
import {createHash} from 'node:crypto';
import {installEmployeeNotificationRoutes} from '../src/employee-notifications.js';
import {canonicalNativeLocation,NATIVE_LOCATION_PAYLOAD_KEYS,NATIVE_LOCATION_SCHEMA} from '../src/native-location-reservation.js';
const id=n=>`a5000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha=x=>createHash('sha256').update(x).digest('hex');
const token='SYNTHETIC_LOCAL_PROVIDER_TOKEN_NOT_REAL',expected={credential_id:id(3),employee_id:id(4),generation_id:id(5),
 registration_id:id(6),device_id:'KIOSK_08',assignment_epoch:'1',principal_digest:sha('synthetic-principal'),token_digest:sha(token)};
const job={job_id:id(1),lease_token:id(2),job_type:'employee_native_push',payload_json:{credential_id:expected.credential_id,
 assignment_epoch:1,data_json:{kind:'employee_location_status'}}};
const payload=Object.fromEntries(NATIVE_LOCATION_PAYLOAD_KEYS.map(key=>[key,'']));
Object.assign(payload,{schema:NATIVE_LOCATION_SCHEMA,generation_id:expected.generation_id,principal_digest:expected.principal_digest,
 token_digest:expected.token_digest,receipt_job_id:job.job_id,receipt_credential_id:expected.credential_id,
 receipt_employee_id:expected.employee_id,receipt_device_id:expected.device_id,receipt_assignment_epoch:'1',
 kind:'employee_location_status',notification_type:'location_status',title:'Synthetic location',body:'Synthetic restroom is due.',
 channel_id:'employee-overdue',route:'employee-schedule.html?hub=employee',service_date:'2026-10-11',
 reminder_contract:'completed-cleaning-reminders.v1',projection_id:id(7),publication_id:id(8),version_id:id(9),
 occurrence_id:id(10),authority_source_id:id(11),location_id:id(12),authority_source:'static_weekly_projection',
 authority_source_digest:sha('synthetic-source'),notification_key:'synthetic-cycle:projection:'+id(7),
 reservation_at:'2026-10-11T15:00:00.000000Z',valid_until:'2026-10-11T15:01:00.000000Z',
 cleaned_at:'2026-10-11T13:00:00.000000Z',cycle_base_at:'2026-10-11T13:00:00.000000Z',
 cycle_base_evidence:'server_completed_cleaning',due_soon_at:'2026-10-11T14:15:00.000000Z',overdue_at:'2026-10-11T14:30:00.000000Z',
 coverage_end_at:'2026-10-11T21:00:00.000000Z',operational_end_at:'2026-10-11T21:00:00.000000Z',
 status_code:'overdue',location_code:'SYNTHETIC',location_name:'Synthetic restroom',form_type:'restroom'});
payload.content_sha256=sha(canonicalNativeLocation(payload,{excludeHash:true}));
const permit={schema:'custodial.native-location-dispatch.v1',dispatch_authorized:true,attempt_id:id(13),outcome_operation_id:id(14),ttl_seconds:60,
 reservation:{current:true,replayed:false,delivery_outcome_unknown:false,dispatch_authorized:true,payload,wire:canonicalNativeLocation(payload)}};
let allow=false,sent=0,validated=0,receipt=null,preparations=0;const calls=[];
const db={async rpc(name,args){
 calls.push(name);
 if(name==='custodial_native_location_dispatch_status')return{data:receipt
  ?{schema:'custodial.native-location-dispatch-status.v1',reserved:true,dispatch_authorized:false,binding:receipt.binding,attempt_id:permit.attempt_id,outcome_operation_id:permit.outcome_operation_id}
  :{schema:'custodial.native-location-dispatch-status.v1',reserved:false,dispatch_authorized:false}};
 if(name==='custodial_native_location_target')return{data:{current:true,expected,token}};
 if(name==='custodial_native_location_dispatch_prepare'){
  validated++;assert.deepEqual(args,{p_job:job.job_id,p_lease:job.lease_token,p_expected:expected});
  return{data:allow?permit:{current:false,dispatch_authorized:false,reason:'location_reminder_cycle_or_responsibility_superseded'}};
 }
 if(name==='custodial_native_location_outcome'){
  receipt={schema:'custodial.native-location-outcome-receipt.v1',binding:args.p_binding,evidence:args.p_evidence,
   server_received_at:'2026-10-11T15:00:01.000000Z',replayed:false,dispatch_authorized:false};return{data:receipt};
 }
 if(name==='custodial_native_location_outcome_status'){
  assert.deepEqual(args.p_binding,receipt.binding);return{data:{schema:'custodial.native-location-outcome-status.v1',binding:receipt.binding,
   dispatch_authorized:false,provider_outcome:receipt.evidence.outcome,evidence:receipt.evidence,server_received_at:receipt.server_received_at}};
 }
 throw Error('Unexpected or retired RPC '+name);
}};
const runtime=installEmployeeNotificationRoutes(express(),{supabase:db,pushRuntime:{configured:true,
 async send(){assert.fail('real LOCATION cannot use the retired generic sender');},
 async prepareNativeLocationSender(){preparations++;return async input=>{
  assert.deepEqual(input.expected,expected);assert.equal(input.token,token);assert.equal(input.permit.reservation.wire,permit.reservation.wire);
  sent++;return{outcome:'provider_accepted',provider_message_id:'synthetic-provider-id',error_code:null};
 };}}});
await assert.rejects(()=>runtime.deliverClaimedJob(job),e=>e.terminal===true&&e.code==='native_location_admission_superseded');
assert.equal(sent,0);assert.equal(validated,1);assert.equal(receipt,null);
allow=true;const first=await runtime.deliverClaimedJob(job);
assert.equal(first.native_location,true);assert.equal(first.replayed,false);assert.equal(sent,1);assert.equal(validated,2);
const replay=await runtime.deliverClaimedJob(job);
assert.equal(replay.replayed,true);assert.equal(sent,1);assert.equal(validated,2);assert.equal(preparations,2);
assert.ok(calls.every(name=>name.startsWith('custodial_native_location_')));
console.log(JSON.stringify({status:'PASS',cases:3,staleSQLAdmission:'NO_SEND',currentAdmission:'ONE_SYNTHETIC_SEND',
 duplicate:'EXACT_ORIGINAL_READBACK_NO_RESEND',scope:'ACTUAL_CURRENT_WORKER_WITH_SYNTHETIC_SQL_AND_PROVIDER',SQL:false,providerNetwork:false}));
