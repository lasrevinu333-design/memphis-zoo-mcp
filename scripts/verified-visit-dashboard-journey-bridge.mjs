import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {currentOriginalCompletionDashboardProof} from './verified-visit-completion-integration-tests.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const READER='custodial_application_reader';
function summarySource(root){
 const source=readFileSync(resolve(root,'src/index.js'),'utf8');
 const begin=source.indexOf('async function runPublicDashboardSummary() {');
 const end=source.indexOf('\nasync function runCanaryChecks()',begin);
 assert.ok(begin>=0&&end>begin,'shipping Dashboard summary source required');
 return source.slice(begin,end);
}
function nativeArguments(loan){
 assert.ok(loan&&Buffer.isBuffer(loan.exactRequestBytes)&&Buffer.isBuffer(loan.exactArgumentBytes));
 const args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(loan.exactArgumentBytes));
 const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(loan.exactRequestBytes));
 assert.deepEqual(body.args,args,'original native argument/request bytes must agree');
 return args;
}

/** Existing owner supplies its fresh dedicated isolated SQL session and the
 * unchanged prepareSameOriginalNativeAcceptedCompletionFixture result. Native
 * must create the original byte loans; this bridge never signs or fabricates
 * them. It creates no fixture rows, starts no database, and retries no writer.
 * Normal native authentication/writes remain inside the original fixture.
 */
export async function qualifyNativeOriginalVisitDashboardJourney({admin,backendRoot,frontendRoot,
 originalFixture,nativeStartLoan,deliverStartAndTakeCompletion}){
 assert.equal(typeof admin?.query,'function','original dedicated isolated SQL session required');
 assert.equal(typeof originalFixture?.startOriginal,'function');
 assert.equal(typeof originalFixture?.commitOriginal,'function');
 assert.equal(typeof deliverStartAndTakeCompletion,'function','owner native response/capture capability required');
 const prepared=clone(originalFixture.prepared);
 assert.equal(prepared.scope,'SYNTHETIC_ACTIVE_FIXTURE_BEFORE_NATIVE_START_NOT_AUTHORITY');
 assert.equal(prepared.context,null,'fixture must precede original normal native START');
 const localRoot=fileURLToPath(new URL('..',import.meta.url));
 const body=summarySource(backendRoot);
 assert.equal(sha(body),sha(summarySource(localRoot)),'bridge and shipping summary bytes differ');
 const fixedReads=[...body.matchAll(/runReadOnlySql\(`([\s\S]*?)`\)/g)].map(match=>match[1]);
 assert.equal(fixedReads.length,5,'exact five current shipping Dashboard reads required');
 const backendPid=(await admin.query('select pg_backend_pid() pid')).rows[0]?.pid;
 assert.ok(Number.isInteger(backendPid));
 let reads=0,writerAttempts=0,committed=null,completionLoan,readerTail=Promise.resolve();
 async function readerTransaction(sql,values=[]){
  assert.equal((await admin.query('select pg_backend_pid() pid')).rows[0]?.pid,backendPid,
   'dedicated original fixture SQL session changed');
  await admin.query('begin read only');
  try{
   await admin.query('set local role '+READER);
   const who=(await admin.query('select current_user who,current_setting(\'transaction_read_only\') ro')).rows[0];
   assert.equal(who.who,READER);assert.equal(who.ro,'on');
   const result=(await admin.query(sql,values)).rows;reads++;await admin.query('commit');return result;
  }catch(error){try{await admin.query('rollback');}catch(cleanup){error.rollbackFailure=cleanup;}throw error;}
 }
 // Shipping summary uses Promise.all; one original dedicated SQLsession must
 // execute these role-bound transactions serially, never overlap BEGIN/COMMIT.
 function reader(sql,values=[]){
  const work=readerTail.then(()=>readerTransaction(sql,values));
  readerTail=work.catch(()=>{});return work;
 }
 const startArgs=nativeArguments(nativeStartLoan);
 assert.equal(startArgs.p_location_code,prepared.location_code);
 const start=await originalFixture.startOriginal(nativeStartLoan);
 assert.equal(start.actual_start_result.client_session_id,startArgs.p_client_session_id);
 assert.equal(start.actual_start_result.native_start_attested,true);
 assert.ok(Buffer.isBuffer(start.exactResponseBytes));
 // The original native owner receives the exact authenticated START response
 // before it can return a new original completion. A byte echo is not capture.
 completionLoan=await deliverStartAndTakeCompletion(start);
 const p=nativeArguments(completionLoan);
 assert.equal(p.p_client_session_id,startArgs.p_client_session_id);
 assert.equal(p.p_client_started_at,startArgs.p_client_started_at);
 assert.equal(p.p_location_code,prepared.location_code);
 assert.notEqual(p.p_native_finish_scan_entry_id,startArgs.p_native_scan_entry_id);
 const control=p.p_response_json?.__custodial_offline_reconciliation_v1;
 assert.equal(control?.context_id,start.actual_start_result.context_id);
 assert.equal(control?.submission_proof,start.actual_start_result.submission_proof);
 const names=await reader('select display_name from public.employees where id=$1::uuid',[prepared.employee_id]);
 assert.equal(names.length,1);
 const expected={employee_id:prepared.employee_id,employee_name:names[0].display_name,
  location_id:prepared.location_id,device_id:prepared.device_id,credential_id:prepared.credential_id,
  context_id:start.actual_start_result.context_id,occurrence_id:start.actual_start_result.occurrence_id,
  snapshot_id:prepared.snapshot.snapshot_id,assignment_epoch:String(prepared.assignment_epoch),
  client_session_id:p.p_client_session_id,client_completion_id:p.p_client_completion_id,
  started_at:p.p_client_started_at,completed_at:p.p_client_ended_at,
  work_result:p.p_response_json.work_result,services_performed:clone(p.p_response_json.services_performed)};
 const {originalCompletionDashboardPresentationProof}=await import(pathToFileURL(resolve(frontendRoot,'scripts/operations-dashboard-tests.mjs')));
 const proof=await currentOriginalCompletionDashboardProof({
  sourceFixture:expected,readRole:READER,
  runReadOnlySql:sql=>{assert.ok(fixedReads.includes(sql),'only exact shipping Dashboard queries allowed');return reader(sql);},
  commitOriginalVisit:async()=>{
   assert.equal(writerAttempts++,0,'never replay an attempted original writer, including unknown results');
   committed=await originalFixture.commitOriginal(completionLoan);
   assert.equal(committed.original_completion_arguments_sha256,sha(completionLoan.exactArgumentBytes));
   return committed.actual_commit_result;
  },
  readOriginalCompletion:async()=>{
   assert.ok(committed,'only read the exact attempted original; never substitute a write');
   const rows=await reader('select * from custodial_release_identity.read_original_scan_completion_v1($1::uuid,$2,$3::uuid,$4::bigint,$5::uuid,$6::jsonb)',
    [prepared.device_id,prepared.device_identifier,prepared.employee_id,prepared.assignment_epoch,
     prepared.credential_id,committed.original_completion_arguments_utf8]);
   assert.equal(rows.length,1);assert.deepEqual(rows[0],committed.actual_fixed_readback,
    'fresh actual restricted-reader result must equal original fixture authenticated readback');
   // Adapter envelope only. SQL fields are actual and authenticated inside the
   // original fixture; this is NOT a second native/manager HTTP auth result.
   return {schema:'custodial.original-completion-readback.v1',found:true,
    result:rows[0].result,readback:rows[0].original};
  },
  presentDashboard:async input=>{
   // Independent issues are part of the exact accepted original payload. The
   // canonical fixed readback only returns a row when the stored receipt AND
   // persisted response equal that complete response, not merely work_result.
   assert.deepEqual(JSON.parse(committed.original_completion_arguments_utf8).p_response_json,p.p_response_json);
   const count=Number(committed.actual_commit_result.maintenance_ticket_count||0);
   if(count>0){
    const tickets=input.acceptedSummary.open_tickets.filter(row=>row.location_code===prepared.location_code);
    assert.ok(tickets.length>=count,'actual accepted issue tickets must remain separately visible');
   }
   return originalCompletionDashboardPresentationProof(input);
  },
 });
 assert.equal(writerAttempts,1);
 return {proof,exactCompletionResponseBytes:Buffer.from(committed.exactResponseBytes),
  original_completion_arguments_sha256:committed.original_completion_arguments_sha256,
  restricted_reader_transactions:reads,summary_source_sha256:sha(body),
  scope:'SYNTHETIC_OWNING_NATIVE_AUTH_SQL_WRITER_PROTECTED_SUMMARY_DOM_COMPOSITION',
  writer_attempts:writerAttempts,accepted_completion_rows_inserted_by_bridge:0,
  work_result:p.p_response_json.work_result,
  original_answer_fields_verified_by_fixed_SQL:Object.keys(p.p_response_json).filter(key=>key!=='__custodial_offline_reconciliation_v1').sort(),
  new_native_or_manager_HTTP_auth_claimed:false,native_response_capture_proven:false,
  physical_NFC_verified:false,production:false};
}
