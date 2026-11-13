import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {scheduleVersion,scheduleBoundaryValid,scheduleNotificationKey,scheduleLocalBoundary} from '../src/native-schedule-version.js';
import {validateNativeSchedulePayload} from '../src/native-schedule-payload.js';
import {deliverNativeScheduleJob} from '../src/native-schedule-dispatch.js';
const sha=x=>createHash('sha256').update(x).digest('hex');
const id=n=>`ca000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function runNativeDepartureCurrentCiTests(){
 let checks=0;const eq=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;};
 const evidenceBytes=readFileSync(new URL('./fixtures/departure-r9-ci-evidence.json',import.meta.url));
 eq('closed retained evidence identity',sha(evidenceBytes),'89b4b6b7f2c0f7730e8a4238786a2417e25cb1dd6f05929a402b15f2c3d4ac90');
 const evidence=JSON.parse(evidenceBytes),wirePath=new URL('./fixtures/departure-r9-sql-wire.json',import.meta.url),wireBytes=readFileSync(wirePath),wire=JSON.parse(wireBytes);
 eq('exact completed SQL output',sha(wireBytes),evidence.wire_sha256);
 eq('exact current proposed SQL',sha(readFileSync(new URL('../proposals/native-departure-v2.proposed.sql',import.meta.url))),evidence.proposal_sha256);
 eq('retained SQL completion',[wire.status,wire.cases.length,evidence.cleanup],['PASS',37,true]);
 for(const label of ['reservation without job remains preparation work','unowned malformed operational row cannot suppress work',
  'prepared job cannot conceal a second current generation','ambiguous source has no requests','no provider effects'])eq('retained actual SQL control '+label,wire.checks.includes(label),true);
 const producer=evidence.producer;
 eq('bounded real-SQL producer receipt',[producer.status,producer.prepared_boundaries,producer.budget_ms,producer.groups.length],['PASS',37,10000,18]);
 eq('all settled receipt sweeps quiet',producer.results.filter(r=>r.label.startsWith('settled ')).every(r=>r.result.status==='NO_SOURCE_REQUESTS'&&r.result.requested===0),true);
 eq('all producer authority remains false',producer.results.every(r=>r.result.dispatch_authorized===false&&r.result.delivery_admitted===false&&r.result.native_qualified===false),true);
 eq('legacy boundary remains separate',[scheduleBoundaryValid('09:45',1),scheduleBoundaryValid('09:45',2),scheduleBoundaryValid('14:00',1)],[true,false,false]);
 eq('unknown schema refused',scheduleVersion('custodial.native-schedule-payload.v3','payload'),0);
 for(const c of wire.cases){
  const p=c.payload;eq('current v2 payload actual implementation',validateNativeSchedulePayload(p,{jobId:c.job_id,expected:c.expected,sourceCandidate:c.candidate}),p);
  eq('v2 key binds actual episode',scheduleNotificationKey(p,p.receipt_employee_id,2),p.notification_key);
  eq('source boundary calendar',[scheduleLocalBoundary(p.source_valid_from).date,scheduleLocalBoundary(p.source_valid_from).boundary,scheduleLocalBoundary(p.source_valid_from).exactMinute],[p.service_date,p.boundary_local,true]);
  assert.throws(()=>validateNativeSchedulePayload({...p,schema:'custodial.native-schedule-payload.v1'},{jobId:c.job_id,expected:c.expected,sourceCandidate:c.candidate}));checks++;
  const lease=id(1),operation=id(2),binding={receipt_job_id:p.receipt_job_id,lease_token:lease,registration_id:c.expected.registration_id,
   generation_id:p.generation_id,reservation_at:p.reservation_at,content_sha256:p.content_sha256,token_digest:p.token_digest,principal_digest:p.principal_digest,
   receipt_credential_id:p.receipt_credential_id,receipt_assignment_epoch:p.receipt_assignment_epoch,receipt_employee_id:p.receipt_employee_id,
   receipt_device_id:p.receipt_device_id,source_reservation_id:p.source_reservation_id};
  const job={job_id:p.receipt_job_id,lease_token:lease,job_type:'employee_native_push',job_key:`employee-schedule-push:${p.source_reservation_id}:${p.receipt_credential_id}`,
   payload_json:{credential_id:p.receipt_credential_id,device_id:id(4),device_identifier:p.receipt_device_id,employee_id:p.receipt_employee_id,
    assignment_epoch:p.receipt_assignment_epoch,data_json:{kind:'employee_schedule_ownership',source_reservation_id:p.source_reservation_id}}};
  for(const outcome of ['prepared','delivery_outcome_unknown']){
   const calls=[];let senderPreparations=0;
   const prior={schema:'custodial.native-schedule-dispatch-status.v1',attempted:true,dispatch_authorized:false,delivery_admitted:false,
    attempt:{attempt_id:id(3),outcome_operation_id:operation,attempt_reserved_at:p.reservation_at,binding,provider_outcome:outcome,
     evidence:outcome==='prepared'?null:{operation_id:operation,outcome,provider_message_id:null,error_code:'synthetic_unknown'},server_received_at:outcome==='prepared'?null:p.reservation_at}};
   await assert.rejects(()=>deliverNativeScheduleJob({job,db:{rpc:async(fn)=>{calls.push(fn);assert.equal(fn,'custodial_native_schedule_dispatch_status');return {data:prior};}},
    pushRuntime:{prepareNativeScheduleSender:async()=>{senderPreparations++;assert.fail('No sender for an existing uncertain original');}}}),e=>e.code==='native_schedule_outcome_unknown_no_resend');checks++;
   eq('v2 unknown keeps original status only',calls,['custodial_native_schedule_dispatch_status']);eq('v2 unknown never prepares sender',senderPreparations,0);
  }
 }
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./native-departure-inventory-sql-wire-tests.mjs',import.meta.url)),fileURLToPath(wirePath)],
  {encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
 eq('current inventory owning child exit',child.status,0);assert.equal(child.error,undefined);
 const receipt=JSON.parse(child.stdout.trim());eq('exact inventory owning receipt',[receipt.status,receipt.checks,receipt.sql_cases,receipt.http_cases,receipt.owned_http_server_closed],['PASS',2518,37,37,true]);
 for(const flag of ['live_database','dispatch_authorized','native_qualified','phone'])eq('inventory false authority '+flag,receipt[flag],false);
 return {status:'PASS',checks,retained_sql_cases:37,actual_current_modules:true,actual_HTTP_cases:37,retained_SQL_evidence_only:true,
  new_SQL:false,provider_dispatch:false,clock_qualified:false,audio_qualified:false,worker_activated:false,phone:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await runNativeDepartureCurrentCiTests()));
