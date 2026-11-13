import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const headers=['X-Memphis-Native-Attestation-Version','X-Memphis-Native-Request-Id','X-Memphis-Native-Request-Timestamp','X-Memphis-Native-Request-Attestation'];

// Existing current native producer's agreed closed file stages. Every response
// is fully written+fsynced before CREATE_NEW hard-link publication. Retain .part
// bytes and all native originals; never infer capture merely from a byte echo.
export function nativeJourneyStageIO(root,{ownerTerminal=()=>null}={}){
 function publish(name,value){
  assert.match(name,/^[A-Z][A-Z0-9_]*\.(?:json|bin)$/);
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
  const part=join(root,name+'.part'),final=join(root,name);
  const fd=fs.openSync(part,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.linkSync(part,final);assert.ok(fs.readFileSync(final).equals(bytes));
 }
 async function waitJson(name,milliseconds){
  const deadline=Date.now()+milliseconds,path=join(root,name);
  while(!fs.existsSync(path)){
   const terminal=ownerTerminal();
   if(terminal)throw Object.assign(Error('NEW_NATIVE_OWNER_TERMINAL_BEFORE_STAGE_'+name),{code:'NEW_NATIVE_OWNER_TERMINAL',native_terminal:terminal});
   if(Date.now()>=deadline)throw Object.assign(Error('NEW_NATIVE_STAGE_TIMEOUT_'+name),{code:'NEW_NATIVE_STAGE_TIMEOUT'});
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  const stat=fs.lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=3*1024*1024);
  const raw=fs.readFileSync(path),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const after=fs.lstatSync(path);assert.equal(after.dev,stat.dev);assert.equal(after.ino,stat.ino);assert.equal(after.size,stat.size);
  return value;
 }
 async function loan(name){
  const value=await waitJson(name,180000);
  assert.deepEqual(Object.keys(value).sort(),['schema','client_session_id','client_completion_id','exactRequestBytesBase64','exactArgumentBytesBase64','nativeHeaders'].sort());
  assert.equal(value.schema,'custodial.test-current-native-visit-loan.v1');
  assert.deepEqual(Object.keys(value.nativeHeaders).sort(),headers.slice().sort());
  const decode=x=>{assert.equal(typeof x,'string');const b=Buffer.from(x,'base64');assert.equal(b.toString('base64'),x);assert.ok(b.length>0&&b.length<=1048576);return b;};
  const request=decode(value.exactRequestBytesBase64),args=decode(value.exactArgumentBytesBase64);
  const parsed=JSON.parse(args.toString('utf8'));assert.equal(parsed.p_client_session_id,value.client_session_id);
  if(name==='COMPLETION_LOAN.json')assert.equal(parsed.p_client_completion_id,value.client_completion_id);
  assert.deepEqual(JSON.parse(request.toString('utf8')).args,parsed);
  return {exactRequestBytes:request,exactArgumentBytes:args,nativeHeaders:value.nativeHeaders};
 }
 async function capture(name,kind,response,session,completion){
  const r=await waitJson(name,40000);
  const wanted=['schema','exact_received_response_sha256','native_authorized_response_sha256','client_session_id','capture_source','journal_state',...(completion?['client_completion_id','original_completion_arguments_sha256']:[])];
  assert.deepEqual(Object.keys(r).sort(),wanted.sort());
  assert.equal(r.schema,'custodial.test-current-native-'+kind+'-captured.v1');
  assert.equal(r.exact_received_response_sha256,sha(response));
  // Normal native HTTPS scrubResponseBody may reserialize its authorized DTO;
  // its independent hash is retained, never forced equal to raw SQL bytes.
  assert.match(r.native_authorized_response_sha256,/^[0-9a-f]{64}$/);
  assert.equal(r.client_session_id,session);if(completion)assert.equal(r.client_completion_id,completion);
  assert.equal(r.capture_source,completion?'NORMAL_HTTPS_CURRENT_ENGINE_AND_NATIVE_COMPLETION_JOURNAL':'NORMAL_HTTPS_TRANSPORT_AND_CURRENT_ACTIVE_ENGINE_RESPONSE');
  assert.equal(r.journal_state,completion?'NORMAL_CAPTURE_AND_SAME_ORIGINAL_RECOVERED_CLOSED':'NATIVE_OCCURRENCE_START_RETAINED_NO_SERVER_START_JOURNAL');
  if(completion)assert.match(r.original_completion_arguments_sha256,/^[0-9a-f]{64}$/);
  return r;
 }
 return Object.freeze({publish,waitJson,loan,capture});
}

/** ONE fresh dedicated fixture, native Engine and two distinct normal visits.
 * No accepted-row seed, separation/ACK, permission change or replay. Caller
 * owns actual native lifecycle and SQL bootstrap; these are exact byte DATA
 * loans, not native authentication capabilities. Normal fixture authenticates
 * every request and executes its maintained authoritative writer/fixed reader.
 */
export async function runNativeCleaningThenCheckOnlyPair({admin,backendRoot,frontendRoot,
 ipcRoot,launchNative,ownerTerminal}){
 assert.equal(typeof launchNative,'function');
 const rootBefore=fs.lstatSync(ipcRoot);
 assert.ok(rootBefore.isDirectory()&&!rootBefore.isSymbolicLink());
 assert.equal(rootBefore.uid,process.getuid());assert.equal(rootBefore.mode&0o777,0o700);
 assert.equal(fs.realpathSync(ipcRoot),ipcRoot);assert.deepEqual(fs.readdirSync(ipcRoot),[]);
 const rootCurrent=()=>{const now=fs.lstatSync(ipcRoot);assert.equal(now.dev,rootBefore.dev);assert.equal(now.ino,rootBefore.ino);
  assert.ok(now.isDirectory()&&!now.isSymbolicLink());assert.equal(now.uid,process.getuid());assert.equal(now.mode&0o777,0o700);};
 const rootIO=nativeJourneyStageIO(ipcRoot,{ownerTerminal});
 const {prepareSameOriginalNativeAcceptedCompletionFixture}=await import(pathToFileURL(join(backendRoot,'scripts/same-original-recovery-local-database-tests.mjs')));
 const {qualifyNativeOriginalVisitDashboardJourney}=await import(pathToFileURL(join(backendRoot,'scripts/verified-visit-dashboard-journey-bridge.mjs')));
 const fixture=await prepareSameOriginalNativeAcceptedCompletionFixture({admin,backendRoot,ordinaryTwoVisit:true});
 let phase='PREPARED_NO_NATIVE_ORIGINAL_YET',native=null;
 const milliseconds=value=>{const observed=value instanceof Date?value.getTime():Date.parse(value);
  assert.ok(Number.isFinite(observed),'finite actual native/SQL timestamp required');return observed;};
 const results=[];const nativeSessions=new Set(),nativeCompletions=new Set(),nativeScans=new Set();
 try{
  // Launch contract validates this same original empty directory. No borrowed
  // native process, old loan/keys or previously unknown writer is restarted.
  native=await launchNative({className:'org.memphiszoo.custodial.vault.CurrentNativeCheckOnlyAfterCleaningSqlProducer',directory:ipcRoot});
  assert.ok(native&&native.completion&&typeof native.terminateOwned==='function');
  assert.ok(Number.isSafeInteger(native.pid)&&native.pid>0);rootCurrent();
  const ready=await rootIO.waitJson('PAIR_NATIVE_READY.json',40000);
  assert.deepEqual(Object.keys(ready).sort(),['schema','pid','class_name','native_engine_created','visits'].sort());
  assert.equal(ready.schema,'custodial.test-current-native-two-visit-pair-ready.v1');
  assert.equal(ready.pid,native.pid);assert.equal(ready.class_name,'org.memphiszoo.custodial.vault.CurrentNativeCheckOnlyAfterCleaningSqlProducer');
  assert.equal(ready.native_engine_created,false);assert.equal(ready.visits,2);
  rootIO.publish('PREPARED.json',fixture.prepared);
  for(let visit=1;visit<=2;visit++){
   phase='AWAIT_DISTINCT_NATIVE_START_'+visit;
   const directory=join(ipcRoot,visit===1?'prior-cleaning':'check-only');
   const waitBegin=process.hrtime.bigint();
   while(!fs.existsSync(directory)){
    const terminal=ownerTerminal?.();assert.ok(!terminal,'new native exited before new visit directory');
    assert.ok(process.hrtime.bigint()-waitBegin<40000000000n,'bounded new visit directory wait');
    await new Promise(resolve=>setTimeout(resolve,5));
   }
   rootCurrent();const observed=fs.lstatSync(directory);
   assert.ok(observed.isDirectory()&&!observed.isSymbolicLink());assert.equal(observed.uid,process.getuid());
   assert.equal(observed.mode&0o777,0o700);assert.equal(fs.realpathSync(directory),directory);
   const io=nativeJourneyStageIO(directory,{ownerTerminal});
   const startLoan=await io.loan('START_LOAN.json');const startArguments=JSON.parse(startLoan.exactArgumentBytes.toString('utf8'));
   assert.ok(!nativeSessions.has(startArguments.p_client_session_id));nativeSessions.add(startArguments.p_client_session_id);
   assert.ok(!nativeScans.has(startArguments.p_native_scan_entry_id));nativeScans.add(startArguments.p_native_scan_entry_id);
   let startCapture,completionLoan,completionArguments;
   phase='NEW_START_ATTEMPT_POSSIBLY_UNKNOWN_'+visit;
   const proof=await qualifyNativeOriginalVisitDashboardJourney({admin,backendRoot,frontendRoot,originalFixture:fixture,nativeStartLoan:startLoan,
    async deliverStartAndTakeCompletion(start){
     io.publish('EXACT_START_RESPONSE.bin',start.exactResponseBytes);io.publish('START_RESULT.json',start.actual_start_result);
     startCapture=await io.capture('START_CAPTURED.json','start',start.exactResponseBytes,startArguments.p_client_session_id);
     completionLoan=await io.loan('COMPLETION_LOAN.json');completionArguments=JSON.parse(completionLoan.exactArgumentBytes.toString('utf8'));
     assert.equal(completionArguments.p_response_json.work_result,visit===1?'full':'checked_no_cleaning_needed');
     assert.ok(!nativeCompletions.has(completionArguments.p_client_completion_id));nativeCompletions.add(completionArguments.p_client_completion_id);
     assert.ok(!nativeScans.has(completionArguments.p_native_finish_scan_entry_id));nativeScans.add(completionArguments.p_native_finish_scan_entry_id);
     phase='NEW_COMPLETION_ATTEMPT_POSSIBLY_UNKNOWN_'+visit;return completionLoan;
    }});
   phase='SQL_RETURNED_AWAIT_ACTUAL_NATIVE_CAPTURE_'+visit;
   io.publish('EXACT_COMPLETION_RESPONSE.bin',proof.exactCompletionResponseBytes);
   const completionCapture=await io.capture('COMPLETION_CAPTURED.json','completion',proof.exactCompletionResponseBytes,
    completionArguments.p_client_session_id,completionArguments.p_client_completion_id);
   const aggregate=proof.proof.aggregate_timestamps;assert.ok(aggregate);
   assert.equal(aggregate.accepted_rows_seeded_for_prior_cleaning,0);
   if(visit===1){
    assert.equal(aggregate.work_result,'full');assert.equal(aggregate.before_latest_completed_at,null);
    assert.equal(aggregate.prior_cleaning_baseline,'EMPTY_PRIOR_CLEANING_IN_FRESH_NATIVE_FIXTURE');
    assert.notEqual(aggregate.after_latest_completed_at,null);
    assert.equal(milliseconds(aggregate.after_latest_completed_at),milliseconds(completionArguments.p_client_ended_at));
    // This first writer and actual native journal capture must settle before
    // authorizing this fixture's ONE distinct second ordinary visit.
    await fixture.advanceToSecondNativeVisit({exactCapturedResponseBytes:proof.exactCompletionResponseBytes});
   }else{
    const first=results[0].proof.aggregate_timestamps;
    assert.equal(aggregate.work_result,'checked_no_cleaning_needed');
    assert.equal(aggregate.prior_cleaning_baseline,'ACTUAL_PREEXISTING_CLEANING_FROM_SAME_PROTECTED_SUMMARY');
    assert.notEqual(aggregate.before_latest_completed_at,null);
    assert.deepEqual(aggregate.before_latest_completed_at,first.after_latest_completed_at);
    assert.deepEqual(aggregate.after_latest_completed_at,first.after_latest_completed_at);
    assert.equal(milliseconds(aggregate.after_latest_checked_at),milliseconds(completionArguments.p_client_ended_at));
    assert.ok(milliseconds(aggregate.after_latest_checked_at)>milliseconds(first.after_latest_completed_at));
   }
   const retained={...proof,exactCompletionResponseBytes:undefined,start_capture:startCapture,completion_capture:completionCapture,
    native_argument_serialization_sha256:completionCapture.original_completion_arguments_sha256,
    raw_loan_argument_bytes_sha256:sha(completionLoan.exactArgumentBytes)};
   io.publish('DASHBOARD_JOURNEY_RESULT.json',retained);results.push(retained);rootCurrent();
   phase='ACTUAL_NATIVE_SQL_VISIT_VERIFIED_'+visit;
   io.publish('VISIT_VERIFIED.json',{visit,client_session_id:completionArguments.p_client_session_id,
    client_completion_id:completionArguments.p_client_completion_id,actual_SQL:true,native_capture_observed:true,
    authority:false,physical_NFC:false});
   startLoan.exactRequestBytes.fill(0);startLoan.exactArgumentBytes.fill(0);
   completionLoan.exactRequestBytes.fill(0);completionLoan.exactArgumentBytes.fill(0);proof.exactCompletionResponseBytes.fill(0);
  }
  const pair=await rootIO.waitJson('PAIR_NATIVE_CAPTURED.json',40000);
  assert.equal(pair.schema,'custodial.test-current-native-two-visit-pair-captured.v1');
  assert.equal(pair.visits,2);assert.equal(pair.normal_native_receipts_retained,2);
  assert.equal(pair.original_snapshot_id,fixture.prepared.snapshot.snapshot_id);
  assert.equal(pair.separation_read,false);assert.equal(pair.private_ACK,false);assert.equal(pair.physical_NFC,false);
  const terminal=await native.completion;assert.equal(terminal.exitCode,0);assert.equal(terminal.signal,null);rootCurrent();phase='COMPLETE';
  const result={schema:'custodial.native-cleaning-check-pair-result.v1',actual_SQL:true,normal_native_capture:true,
   native_Engine_owner_count:1,normal_enrollment_fixture_count:1,distinct_sessions:nativeSessions.size,
   distinct_completions:nativeCompletions.size,distinct_native_scan_entries:nativeScans.size,
   authoritative_completion_writer_calls:2,normal_start_writer_calls:2,normal_business_writer_calls:4,accepted_business_rows_seeded:0,prior_cleaning_from_first_normal_native_writer:true,
   later_check_only_preserves_first_cleaning:true,native_completion_journal_retains_both_originals:true,
   visits:results,production:false,Android:false,physical_NFC:false,real_manager:false,private_ACK:false,finalizer:false};
  rootIO.publish('PAIR_RESULT.json',result);return result;
 }catch(error){
  rootIO.publish('PAIR_UNKNOWN.json',{phase,name:error.name,code:error.code||null,writer_replay_allowed:false,
   accepted_or_captured_inference:false,old_owner_restarted:false,production:false});throw error;
 }finally{
  // Parent retains the exact Popen and proves settlement/cleanup. No SQL
  // rollback can undo an already committed normal original. Never retry it.
  try{if(native){
    let settlementTimer;
    try{await Promise.race([native.completion,new Promise(resolve=>{settlementTimer=setTimeout(resolve,45000);})]);}
    finally{clearTimeout(settlementTimer);await native.terminateOwned();}
  }}finally{fixture.close();}
 }
}
