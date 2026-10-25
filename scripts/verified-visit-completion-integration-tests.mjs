import { hasCanonicalCompletionSelection } from "../src/completion-selection-read-boundary.js";
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
const direct=!!process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct&&process.argv.includes('--original-completion-readback-domain-only')){
 await originalCompletionReadbackDomain();process.exit(0);
}
async function originalCompletionReadbackDomain(){
 const {readOriginalScanCompletion,SCAN_COMPLETION_READBACK_PATH,SCAN_COMPLETION_READBACK_SCHEMA}=await import('../src/scan-completion-readback.js');
 let checks=0;const hash=v=>createHash('sha256').update(v).digest('hex');
 function fixture(){
  const ids={device:randomUUID(),employee:randomUUID(),credential:randomUUID(),context:randomUUID(),occurrence:randomUUID(),
   session:randomUUID(),completion:randomUUID(),finish:randomUUID(),location:randomUUID(),receipt:randomUUID(),response:randomUUID()};
  const payload={p_device_id:'KIOSK_02',p_client_session_id:ids.session,p_client_completion_id:ids.completion,p_location_code:'CHINA',
   p_client_started_at:'2026-10-12T10:00:00.000Z',p_client_ended_at:'2026-10-12T10:15:00.000Z',
   p_response_json:{work_result:'checked_no_cleaning_needed',services_performed:[],
    __custodial_offline_reconciliation_v1:{context_id:ids.context,submission_proof:'a'.repeat(64)}},
   p_scan_evidence:[{client_event_id:ids.finish,event_type:'scan_finish',result:'ok',notes:null,
    scanned_at:'2026-10-12T10:15:00.000Z',payload_json:{entry_source:'native-nfc'}}],
   p_correlation_id:'original:correlation',p_native_finish_scan_entry_id:ids.finish,
   p_native_completion_attestation_version:'custodial-native-completion.v2',p_native_completion_attestation:'b'.repeat(64)};
  const request={method:'POST',originalUrl:SCAN_COMPLETION_READBACK_PATH,url:SCAN_COMPLETION_READBACK_PATH,
   headers:{authorization:'Device SYNTHETIC_ONLY',origin:'https://localhost','x-device-id':'KIOSK_02'},
   body:{completion_payload:payload}};
  request.scanAuthorityRawBody=Buffer.from(JSON.stringify(request.body));
  const auth={ok:true,credentialed:true,device:{canonical_device_pk:ids.device,canonical_device_id:'KIOSK_02',
   device_active:true,employee_active:true,assigned_employee_id:ids.employee,assignment_epoch:7},
   credential:{credential_id:ids.credential,device_id:ids.device,confirmed_at:'2026-10-12T09:00:00Z',
    expires_at:'2027-10-12T09:00:00Z',revoked_at:null}};
  const result={status:'closed',terminal:true,client_session_id:ids.session,client_completion_id:ids.completion,
   session_uuid:ids.session,completion_response_id:ids.response,occurrence_id:ids.occurrence,original_employee_id:ids.employee,
   started_at:payload.p_client_started_at,ended_at:payload.p_client_ended_at,correlation_id:payload.p_correlation_id,
   maintenance_ticket_count:0,replayed:false};
  const original={reconciliation_id:ids.receipt,context_id:ids.context,occurrence_id:ids.occurrence,
   original_employee_id:ids.employee,original_credential_id:ids.credential,device_id:ids.device,location_id:ids.location,
   client_session_id:ids.session,client_completion_id:ids.completion,assignment_epoch:7,payload_fingerprint:'c'.repeat(64),
   submitted_at:'2026-10-12T10:16:00.000Z'};
  let authCalls=0,queries=[];
  const attestation={version:'custodial-native-request.v1',request_id:randomUUID(),timestamp:'2026-10-12T10:20:00.000Z',
   credential_id:ids.credential,device_id:'KIOSK_02',method:'POST',path:SCAN_COMPLETION_READBACK_PATH,
   body_sha256:hash(request.scanAuthorityRawBody),signature:'d'.repeat(64)};
  const options={request,completionPayload:payload,
   revalidateCurrentRequest:async()=>{authCalls++;request.memphisNativeRequestAttestation=structuredClone(attestation);return structuredClone(auth);},
   runReadOnlySql:async sql=>{queries.push(sql);return [{result:structuredClone(result),original:structuredClone(original),
    event_fingerprints:[{source:'synthetic-original-event',fingerprint:hash('synthetic-original-event')}]}];}};
  return {ids,payload,request,auth,result,original,options,queries,get authCalls(){return authCalls;}};
 }
 const only=process.argv.find(arg=>arg.startsWith('--readback-case='));
 async function test(name,fn){if(only && !name.includes(only.slice(16)))return;
  await fn();checks++;console.log(JSON.stringify({case:name,status:'PASS_DOMAIN_RECORDING'}));}
 await test('event-fingerprint-boundary: exact original serialization required without digest privileges',async()=>{
  const good=fixture();assert.equal((await readOriginalScanCompletion(good.options)).found,true);
  assert.doesNotMatch(good.queries[0],/extensions\.digest|static_weekly_digest_text/);
  for(const vector of [undefined,[],[{source:'changed',fingerprint:hash('original')}],[{source:'original',fingerprint:hash('original'),extra:true}]]){
   const f=fixture();f.options.runReadOnlySql=async()=>[{result:f.result,original:f.original,event_fingerprints:vector}];
   await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_readback_response_invalid'});
  }
 });
 await test('strict-fields: array-coerced optional original epoch and extra readback data refuse',async()=>{
  const f=fixture();f.payload.p_snapshot_assignment_epoch=[7];
  f.request.scanAuthorityRawBody=Buffer.from(JSON.stringify(f.request.body));
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_original_binding_invalid'});
  const extra=fixture();extra.original.unapproved_private_data='not permitted';
  await assert.rejects(readOriginalScanCompletion(extra.options),{code:'scan_completion_readback_response_invalid'});
 });
 await test('original result/times preserved; one fixed read and two current-auth calls',async()=>{
  const f=fixture(),raw=Buffer.from(f.request.scanAuthorityRawBody),before=JSON.stringify(f.payload);
  const value=await readOriginalScanCompletion(f.options);assert.equal(value.schema,SCAN_COMPLETION_READBACK_SCHEMA);
  assert.deepEqual(value.result,f.result);assert.deepEqual(value.readback,f.original);
  assert.equal(f.authCalls,2);assert.equal(f.queries.length,1);assert.equal(JSON.stringify(f.payload),before);
  assert.ok(raw.equals(f.request.scanAuthorityRawBody));
  // Predicate source composition, NOT PostgreSQL execution or record acceptance.
  assert.match(f.queries[0],/custodial_offline_payload_fingerprint\(context/);
  assert.match(f.queries[0],/evidence\.event_payload=event/);
  assert.match(f.queries[0],/device\.assigned_employee_id=context\.employee_id/);
  assert.doesNotMatch(f.queries[0],/custodial_credential_may_transmit_frozen_work|\b(insert|update|delete|grant)\b/i);
 });
 await test('missing current native/auth callback is not a proof',async()=>{
  const f=fixture();delete f.options.revalidateCurrentRequest;
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_readback_not_mounted'});assert.equal(f.queries.length,0);
 });
 await test('caller credentialed flag without native attestation refuses',async()=>{
  const f=fixture();f.options.revalidateCurrentRequest=async()=>f.auth;
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_current_native_auth_required'});
 });
 for(const [name,change] of [['path',f=>f.request.originalUrl+='/other'],['body',f=>f.request.body.completion_payload.p_location_code='OTHER'],
  ['raw',f=>f.request.scanAuthorityRawBody[0]=32],['headers',f=>f.request.headers.authorization='Device CHANGED']]){
  await test('request '+name+' mutation across SQL await refuses',async()=>{
   const f=fixture();f.options.runReadOnlySql=async()=>{change(f);return [{result:f.result,original:f.original}];};
   await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_request_changed'});
  });
 }
 await test('current employee/epoch changes during lookup refuses',async()=>{
  const f=fixture();f.options.runReadOnlySql=async()=>{f.auth.device.assigned_employee_id=randomUUID();f.auth.device.assignment_epoch++;
   return [{result:f.result,original:f.original}];};
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_principal_changed'});
 });
 await test('current credential cannot be stamped as original receipt credential',async()=>{
  const f=fixture();f.original.original_credential_id=randomUUID();
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_readback_response_invalid'});
 });
 await test('absent original and missing legacy origin remain unknown, not resend authority',async()=>{
  const f=fixture();f.options.runReadOnlySql=async()=>[];assert.deepEqual(await readOriginalScanCompletion(f.options),{found:false});
  const legacy=fixture();delete legacy.payload.p_response_json.__custodial_offline_reconciliation_v1;
  legacy.request.scanAuthorityRawBody=Buffer.from(JSON.stringify(legacy.request.body));
  const auth=legacy.options.revalidateCurrentRequest;legacy.options.revalidateCurrentRequest=async()=>{const value=await auth();
   legacy.request.memphisNativeRequestAttestation.body_sha256=hash(legacy.request.scanAuthorityRawBody);return value;};
  assert.deepEqual(await readOriginalScanCompletion(legacy.options),{found:false});assert.equal(legacy.queries.length,0);
 });
 await test('altered result identity and duplicate result rows refuse',async()=>{
  const f=fixture();f.result.client_completion_id=randomUUID();
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_readback_response_invalid'});
  const dup=fixture();dup.options.runReadOnlySql=async()=>[{result:dup.result,original:dup.original},{result:dup.result,original:dup.original}];
  await assert.rejects(readOriginalScanCompletion(dup.options),{code:'scan_completion_readback_response_invalid'});
 });
 await test('denied normal read never switches role or writes',async()=>{
  const f=fixture();f.options.runReadOnlySql=async()=>{throw Object.assign(new Error('permission denied'),{code:'42501'});};
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_readback_unavailable'});
 });
 await test('exact raw body must carry supplied payload and only the closed route body',async()=>{
  const f=fixture();f.options.completionPayload={...f.payload,p_location_code:'OTHER'};
  await assert.rejects(readOriginalScanCompletion(f.options),{code:'scan_completion_request_invalid'});
  const extra=fixture();extra.request.body.query='arbitrary';extra.request.scanAuthorityRawBody=Buffer.from(JSON.stringify(extra.request.body));
  await assert.rejects(readOriginalScanCompletion(extra.options),{code:'scan_completion_request_invalid'});
 });
 console.log(JSON.stringify({status:'PASS_ORIGINAL_COMPLETION_READBACK_DOMAIN_RECORDING',checks,
  limits:'Existing owning member; real domain functions/fixed SQL construction with recording auth/read callbacks. No authenticated route, SQL execution, native RequestPolicy, provider, browser or independent acceptance.'}));
}
/** Existing owning integration member, callable by main's protected stack.
 * No fixture provisioning, credential construction or accepted-row INSERT.
 * The three callbacks must close over main's ORIGINAL normally started visit,
 * normal writer and normal authenticated original-completion reader. A callback
 * name or readRole string is not SQL/auth proof; main must retain that evidence.
 */
export async function currentOriginalCompletionDashboardProof({runReadOnlySql,readRole,
 sourceFixture,commitOriginalVisit,readOriginalCompletion,presentDashboard}){
 for(const fn of [runReadOnlySql,commitOriginalVisit,readOriginalCompletion,presentDashboard])
  assert.equal(typeof fn,'function','main-owned normal SQL/writer/readback/presenter capability required');
 assert.equal(typeof readRole,'string');assert.ok(readRole.length>0,'intended normal read role required');
 const expected=structuredClone(sourceFixture);assert.ok(expected&&typeof expected==='object');
 for(const key of ['employee_id','employee_name','location_id','device_id','credential_id','context_id',
  'occurrence_id','snapshot_id','assignment_epoch','client_session_id','client_completion_id','started_at','completed_at','work_result'])
  assert.equal(typeof expected[key],'string','original start/response fixture field '+key+' required');
 assert.ok(Array.isArray(expected.services_performed));
 // Execute the actual current summary body, including ALL four fixed
 // reads, the same-snapshot exact-session original join, and its map/filter composition. Never rebuild its DTO here.
 const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const start=source.indexOf('async function runPublicDashboardSummary() {');
 const end=source.indexOf('\nasync function runCanaryChecks()',start);
 assert.ok(start>=0&&end>start,'current owning summary source boundary required');
 const version=readFileSync(new URL('../src/app-version.js',import.meta.url),'utf8');
 const events=readFileSync(new URL('../src/events-api.js',import.meta.url),'utf8');
 const literal=(body,key)=>{const match=body.match(new RegExp('(?:export )?const '+key+' = "([^"\\n]+)";'));
  assert.ok(match,'actual current metadata literal '+key+' required');return match[1];};
 const context={runReadOnlySql,hasCanonicalCompletionSelection,Date,APP_VERSION:literal(version,'APP_VERSION'),
  EVENTS_CONTRACT_VERSION:literal(events,'EVENTS_CONTRACT_VERSION')};
 context.RELEASE_ID=context.APP_VERSION;
 for(const key of ['SCAN_CONTRACT_VERSION','DASHBOARD_CONTRACT_VERSION','MESSAGING_CONTRACT_VERSION','SCHEDULE_CONTRACT_VERSION'])
  context[key]=literal(source,key);
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.readSummary=runPublicDashboardSummary;',context);
 const readSummary=async()=>structuredClone(await context.readSummary());
 const find=summary=>{const rows=[...summary.restrooms,...summary.exhibits].filter(row=>row.location_id===expected.location_id);
  assert.equal(rows.length,1,'one exact current fixture location required');return rows[0];};
 const pendingSummary=await readSummary(),before=find(pendingSummary);
 assert.ok(['active','pending_submit'].includes(before.open_session_status),
  'normal START/pending projection missing: activated offline context alone is not a dashboard open session');
 assert.notEqual(before.latest_original_completion?.client_completion_id,expected.client_completion_id,
  'fixture already accepted; do not rerun an original writer');
 // One explicit normal writer invocation only. A throw/unknown stops, never retries.
 const result=structuredClone(await commitOriginalVisit());
 assert.equal(result.status,'closed');assert.equal(result.client_session_id,expected.client_session_id);
 assert.equal(result.client_completion_id,expected.client_completion_id);
 const readback=structuredClone(await readOriginalCompletion());
 assert.equal(readback.schema,'custodial.original-completion-readback.v1');assert.equal(readback.found,true);
 assert.deepEqual(readback.result,result,'reader must return exact original persisted result');
 const acceptedSummary=await readSummary(),after=find(acceptedSummary),original=after.latest_original_completion;
 // Bind the protected persisted readback to the one original writer for either
 // outcome; a check-only card cannot borrow a different cleaning receipt.
 for(const [expectedKey,readbackKey] of [['context_id','context_id'],['occurrence_id','occurrence_id'],
  ['employee_id','original_employee_id'],['credential_id','original_credential_id'],
  ['device_id','device_id'],['location_id','location_id']])
  assert.equal(readback.readback[readbackKey],expected[expectedKey],'actual original readback '+expectedKey);
 assert.equal(String(readback.readback.assignment_epoch),expected.assignment_epoch);
 if(expected.work_result==='checked_no_cleaning_needed'){
  assert.equal(original,null,'check-only original is not an exact latest-cleaning original; keep it unavailable');
  assert.notEqual(after.latest_completed_session_uuid,result.session_uuid,'check-only cannot become latest cleaning');
  assert.equal(after.latest_verified_check_session_uuid,result.session_uuid,'exact current verified-check session');
  assert.equal(after.latest_verified_check_completion_id,expected.client_completion_id,'exact current verified-check completion');
  assert.equal(after.latest_verified_checker_name,expected.employee_name,'original verified-check employee');
  assert.equal(Date.parse(after.latest_verified_check_at),Date.parse(expected.completed_at),'original verified-check time');
 }else{
  assert.equal(original?.location_id,after.location_id,'original location must match the one SQL location row');
  assert.equal(original?.session_uuid,after.latest_completed_session_uuid,'original session must match latest cleaning in the one SQL row');
  assert.ok(original,'current operational-day fixed original SELECT returned no record; do not invent/shift times');
  for(const key of ['employee_id','employee_name','location_id','device_id','credential_id','context_id','occurrence_id',
   'snapshot_id','assignment_epoch','client_session_id','client_completion_id','work_result'])
   assert.equal(original[key],expected[key],'actual original dashboard '+key);
  assert.deepEqual(original.services_performed,expected.services_performed);
  for(const [dashboardKey,readbackKey] of [['reconciliation_id','reconciliation_id'],['context_id','context_id'],
   ['occurrence_id','occurrence_id'],['employee_id','original_employee_id'],['credential_id','original_credential_id'],
   ['device_id','device_id'],['location_id','location_id'],['payload_fingerprint','payload_fingerprint']])
   assert.equal(original[dashboardKey],readback.readback[readbackKey]);
  assert.equal(original.assignment_epoch,String(readback.readback.assignment_epoch));
  assert.equal(original.session_uuid,result.session_uuid);
 }
 // Native START projects the original client UUID before the terminal writer
 // materializes its server session UUID. They are different identity fields.
 assert.equal(before.open_session_uuid,expected.client_session_id);
 if(original!==null){
  assert.equal(Date.parse(original.started_at),Date.parse(expected.started_at));
  assert.equal(Date.parse(original.completed_at),Date.parse(expected.completed_at));
 }
 assert.equal(after.open_session_status,null);assert.equal(after.open_session_uuid,null);
 // Compare actual normal summary aggregates independently of the accepted
 // original card. A check-only visit must not become a cleaning timestamp.
 // This fixture never seeds a prior accepted cleaning business row.
 const timestampMillis=value=>value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN;
 const completedMillis=timestampMillis(expected.completed_at);
 assert.ok(Number.isFinite(completedMillis));
 const priorCleaning=before.latest_completed_at??null;
 if(expected.work_result==='checked_no_cleaning_needed'){
  assert.deepEqual(after.latest_completed_at??null,priorCleaning,'check-only must preserve the exact prior cleaning timestamp');
  assert.equal(timestampMillis(after.latest_checked_at),completedMillis,'check-only must advance the actual latest-checked aggregate');
  if(before.latest_checked_at!=null)assert.ok(timestampMillis(after.latest_checked_at)>timestampMillis(before.latest_checked_at),
   'fresh check-only must advance the prior actual checked timestamp');
 }else{
  assert.ok(['full','details'].includes(expected.work_result));
  assert.equal(timestampMillis(after.latest_completed_at),completedMillis,'accepted cleaning must advance the actual cleaned aggregate');
 }
 const aggregateTimestampProof={
  prior_cleaning_baseline:priorCleaning===null?'EMPTY_PRIOR_CLEANING_IN_FRESH_NATIVE_FIXTURE':'ACTUAL_PREEXISTING_CLEANING_FROM_SAME_PROTECTED_SUMMARY',
  before_latest_completed_at:priorCleaning,after_latest_completed_at:after.latest_completed_at??null,
  before_latest_checked_at:before.latest_checked_at??null,after_latest_checked_at:after.latest_checked_at??null,
  work_result:expected.work_result,accepted_native_completed_at:expected.completed_at,
  accepted_rows_seeded_for_prior_cleaning:0,
 };
 const presentation=await presentDashboard({pendingSummary,acceptedSummary,result,readback,expected});
 assert.equal(presentation.qualifying_surface,'actual-dashboard-data-controller-in-process-DOM');
 return {case:'current-original-completion-SQL-summary-dashboard-composition',read_role_requested:readRole,
  work_result:expected.work_result,client_completion_id:expected.client_completion_id,
  original_projection:original===null?'UNAVAILABLE_FOR_LATEST_CLEANING_SESSION':'EXACT_LATEST_CLEANING_SESSION',
  summary_source_sha256:createHash('sha256').update(source.slice(start,end)).digest('hex'),
  writer_calls:1,readback_calls:1,presentation,aggregate_timestamps:aggregateTimestampProof,
  limits:'Callable evidence only: main must bind actual normal SQL/read-role/writer/reader execution. Named-session withdrawal is a source fixture, not real manager/browser/NFC/provider proof.'};
}

if(direct)await verifiedVisitCompletionIntegration();
async function verifiedVisitCompletionIntegration(){
// Synthetic native-route inputs in an isolated database; never field NFC proof.
const container=process.env.VERIFIED_VISIT_TEST_CONTAINER;
assert.match(container??'',/^mz_verified_visit_[0-9]+$/);
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspect.HostConfig.PortBindings??{}).length,0);
const q=value=>`'${String(value??'').replaceAll("'","''")}'`;
function sql(text){return execFileSync('docker',['exec','-i',container,'psql','-X','-q',
 '-v','ON_ERROR_STOP=1','-At','-U','supabase_admin','-d','postgres'],
 {input:text,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024}).trim().split('\n').at(-1);}
let passed=0;
function check(name,actual,expected){assert.deepEqual(actual,expected,name);passed++;}
function reject(name,text,pattern){assert.throws(()=>sql(text),pattern,name);passed++;}
const id={employee:randomUUID(),device:randomUUID(),credential:randomUUID(),location:randomUUID()};
const suffix=randomUUID().slice(0,8).toUpperCase();
const deviceCode=`VISIT-TEST-${suffix}`,locationCode=`VT${suffix}`;
const secret='isolated-visit-execution-secret-012345678901234';
const routeSecret='isolated-visit-native-route-secret-0123456789';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>`${q(JSON.stringify(value))}::jsonb`;
const iso=value=>new Date(value).toISOString();
const backendSource=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const checkQueryStart=backendSource.indexOf('select location_id,latest_verified_check_at,latest_verified_checker_name,');
const checkQueryEnd=backendSource.indexOf('`),',checkQueryStart);
assert.ok(checkQueryStart>=0&&checkQueryEnd>checkQueryStart,'dashboard exact private verified-check reader query must be present');
const dashboardCheckSql=backendSource.slice(checkQueryStart,checkQueryEnd);
const dashboardCheck=()=>JSON.parse(sql(`select row_to_json(result) from (${dashboardCheckSql}) result where result.location_id=${q(id.location)}::uuid;`));
sql(`select public.custodial_configure_backend_execution_key(${q(hash(secret))},'isolated-visit-test');
select public.custodial_configure_native_route_proof_key(${q(hash(routeSecret))},'isolated-visit-test');
insert into public.employees(id,employee_code,display_name,active,role)
values(${q(id.employee)},${q(`VE${suffix}`)},'Synthetic Visit Employee',true,'staff');
insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
values(${q(id.device)},${q(deviceCode)},'Synthetic Visit Device',true,${q(id.employee)});
insert into public.locations(id,location_code,location_name,location_type,form_type,active)
values(${q(id.location)},${q(locationCode)},'Synthetic Visit Restroom','restroom','restroom',true);
insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
values(${q(id.credential)},${q(id.device)},${q(hash(suffix))},now(),now()+interval '1 day');
insert into public.custodial_employee_device_assignment_history(device_id,device_identifier,
 new_employee_id,new_employee_name,change_reason,source)
values(${q(id.device)},${q(deviceCode)},${q(id.employee)},'Synthetic Visit Employee','test fixture','test');`);
const snapshot=JSON.parse(sql(`select public.tool_get_offline_scan_authority_snapshot(
 ${q(deviceCode)},${q(id.credential)},${q(secret)})::text;`));
let nextTime=Date.parse(snapshot.generated_at)+1;
function startVisit(){
 const session=randomUUID(),start=iso(nextTime++),finish=iso(nextTime++),scan=randomUUID();
 const context=JSON.parse(sql(`select public.tool_start_offline_occurrence(
 ${q(deviceCode)},${q(locationCode)},${q(session)},${q(start)},${q(snapshot.snapshot_id)},
 ${q(snapshot.employee_id)},${snapshot.assignment_epoch},${q(id.credential)},${q(id.credential)},
 ${q(scan)},'custodial-native-start.v1',${q('a'.repeat(64))},${q(routeSecret)},${q(secret)})::text;`));
 return {session,start,finish,scan,finishScan:randomUUID(),completion:randomUUID(),context};
}
function completeSql(visit,response,options={}){
 const finishScan=options.finishScan??visit.finishScan;
 const scans=options.scans??[{client_event_id:finishScan,event_type:'scan_finish',result:'ok',
  notes:'SYNTHETIC INTEGRATION FIXTURE',scanned_at:visit.finish,payload_json:{entry_source:'native-nfc'}}];
 return `select public.tool_commit_cleaning_workflow_authoritative(
 ${q(visit.session)},${q(visit.completion)},${q(deviceCode)},${q(locationCode)},${q(visit.start)},${q(visit.finish)},
 ${json(response)},${json(scans)},'synthetic-visit-integration',${q(visit.context.context_id)},
 ${q(visit.context.submission_proof)},${q(id.credential)},${q(finishScan)},
 'custodial-native-completion.v2',${q('b'.repeat(64))},${q(routeSecret)},${q(secret)})::text;`;
}
const status=()=>JSON.parse(sql(`select json_build_object(
 'cleaned',public.custodial_canonical_utc_millis(latest_completed_at),
 'checked',public.custodial_canonical_utc_millis(latest_checked_at),
 'status',status_code,'services',services_performed) from public.v_location_dashboard_status
 where location_id=${q(id.location)}::uuid;`));
if(process.argv.includes('--seed-pre-cutover-legacy')){
 const visit=startVisit(),response={services_performed:['Sweep the floor'],note:'Exact pre-cutover saved answers'};
 const statement=completeSql(visit,response),accepted=JSON.parse(sql(statement));
 assert.equal(accepted.status,'closed');
 const fresh=startVisit();
 const fixture={visit,response,statement,location:id.location,accepted,
  freshStatement:completeSql(fresh,response),
  forgedStatement:completeSql(fresh,{...response,legacy:true,created_at:'2020-01-01',schema_version:1}),
  tamperedStatement:completeSql(visit,{...response,note:'changed'}),
  bytes:sql(`select to_jsonb(cr)::text from public.completion_responses cr where client_completion_id=${q(visit.completion)}`),
  dashboard:status()};
 console.log(JSON.stringify(fixture));process.exit(0);
}
const checkOnly={work_result:'checked_no_cleaning_needed',services_performed:[]};
const cleaning={work_result:'full',services_performed:['Full cleaning services']};
const preclean=startVisit();
check('native start alone does not establish a cleaning',status().cleaned,null);
check('check-only completion accepted',JSON.parse(sql(completeSql(preclean,checkOnly))).status,'closed');
check('check-only does not fabricate first cleaning',status().cleaned,null);
check('completed check visible as last checked',status().checked,preclean.finish);
check('dashboard exact check-only actor',dashboardCheck().latest_verified_checker_name,'Synthetic Visit Employee');
check('dashboard exact check-only time',iso(dashboardCheck().latest_verified_check_at),preclean.finish);
check('dashboard exact check-only session identity',dashboardCheck().latest_verified_check_session_uuid,preclean.session);
check('dashboard exact check-only completion identity',dashboardCheck().latest_verified_check_completion_id,preclean.completion);
check('no recurring reminder before actual first cleaning',Number(sql(`select count(*) from
 public.mz_location_reminder_candidates(public.sch_service_date(now()),now())
 where location_id=${q(id.location)}::uuid`)),0);
const cleaned=startVisit();
check('actual cleaning accepted',JSON.parse(sql(completeSql(cleaned,cleaning))).status,'closed');
check('actual last cleaned updated',status().cleaned,cleaned.finish);
const serviceDate=sql('select public.sch_service_date(now())::text;');
function reminder(when){return JSON.parse(sql(`select coalesce(json_agg(row_to_json(candidate)),'[]')::text
 from public.mz_location_reminder_candidates(${q(serviceDate)}::date,${q(when)}::timestamptz) candidate
 where location_id=${q(id.location)}::uuid;`));}
const oldOverdue=iso(Date.parse(cleaned.finish)+90*60000);
check('first overdue candidate',reminder(oldOverdue)[0]?.status_code,'overdue');
const pending=startVisit();
check('scan-in preserves last completed visit',status().checked,cleaned.finish);
check('scan-in alone leaves reminder overdue',reminder(oldOverdue)[0]?.status_code,'overdue');
reject('empty finish evidence rejected',completeSql(pending,checkOnly,{scans:[]}),/physical NFC finish scan/i);
reject('different same-tag finish identity rejected',completeSql(pending,checkOnly,{finishScan:pending.scan}),/different|finish|start/i);
reject('fake services in check rejected',completeSql(pending,{...checkOnly,services_performed:['Floor']}),/check-only outcome cannot claim/i);
reject('unknown completion outcome rejected',completeSql(pending,{work_result:'invented',services_performed:['Floor']}),/unsupported completion outcome/i);
check('invalid attempts did not clear overdue',reminder(oldOverdue)[0]?.status_code,'overdue');
const statement=completeSql(pending,checkOnly);
const completed=JSON.parse(sql(statement));
check('protected check completed',completed.status,'closed');
check('actual cleaning time preserved after check',status().cleaned,cleaned.finish);
check('last checked advances to checkout',status().checked,pending.finish);
check('dashboard exact latest check-only identity',dashboardCheck().latest_verified_check_session_uuid,pending.session);
check('cleaning services are not replaced with check',status().services,['Full cleaning services']);
check('old overdue replaced by new visit cycle',reminder(oldOverdue)[0]?.status_code,'due_soon');
assert.equal(typeof completed.session_uuid,'string');
check('completion replay returns same session',JSON.parse(sql(statement)).session_uuid,completed.session_uuid);
check('replay did not duplicate closed session',Number(sql(`select count(*) from public.sessions
 where client_session_id=${q(pending.session)} and status='closed'`)),1);
check('replay did not duplicate response',Number(sql(`select count(*) from public.completion_responses
 where client_completion_id=${q(pending.completion)}`)),1);
const nextOverdue=Date.parse(pending.finish)+90*60000;
const repeated=[0,5,10].map(minutes=>reminder(iso(nextOverdue+minutes*60000))[0]);
check('all subsequent unresolved reminders remain overdue',repeated.map(row=>row.status_code),['overdue','overdue','overdue']);
check('repeated reminders have distinct identities',new Set(repeated.map(row=>row.notification_key)).size,3);
sql(`select public.ack_device_notification(${q(deviceCode)},${q(repeated[0].notification_key)},
 'location_status','dismissed','{}'::jsonb);`);
check('dismissal cannot resolve overdue',reminder(iso(nextOverdue+5*60000))[0]?.status_code,'overdue');
check('dismissal cannot change last checked',status().checked,pending.finish);
// Exercise the real queue against an explicitly synthetic ungoverned assignment.
// This is not static-publication, lunch-allocation, or provider-delivery acceptance.
check('queue fixture is ungoverned',sql(`select governed::text from public.static_weekly_v6_schedule_authority_state(${q(serviceDate)}::date)`),'false');
const group=randomUUID(),token=`synthetic-fcm-${randomUUID()}`;
sql(`insert into public.location_groups(id,group_code,group_name,active)
 values(${q(group)},${q(`VG${suffix}`)},'Synthetic Restroom Family',true);
 insert into public.location_group_memberships(location_id,location_group_id,active)
 values(${q(id.location)},${q(group)},true);
 insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,active)
 values(${q(serviceDate)},${q(id.employee)},'04:00','23:59','synthetic-test',true);
 insert into public.daily_schedule_assignments(service_date,location_group_id,segment_number,
 assigned_employee_id,owner_type,coverage_start,coverage_end,status,load_points,source_type,coverage_purpose)
 values(${q(serviceDate)},${q(group)},1,${q(id.employee)},'EMPLOYEE','04:00','23:59','ASSIGNED',1,'synthetic-test','area_owner');
 select public.mz_register_employee_push(${q(id.credential)},${q(token)},${q(hash(token))},'android','test','test');`);
function enqueue(when){return JSON.parse(sql(`select public.mz_enqueue_employee_location_pushes(${q(when)}::timestamptz)::text`));}
const queueCount=()=>Number(sql(`select count(*) from public.operational_notification_jobs
 where payload_json->>'credential_id'=${q(id.credential)} and job_type='employee_native_push'`));
const queueTime=nextOverdue+10*60000;
check('unresolved overdue enqueues one job',enqueue(iso(queueTime)).enqueued,1);
check('same repeat retried does not duplicate',enqueue(iso(queueTime)).enqueued,0);
check('one queue record exists',queueCount(),1);
const key=reminder(iso(queueTime))[0].notification_key;
sql(`select public.ack_device_notification(${q(deviceCode)},${q(key)},'location_status','dismissed','{}'::jsonb)`);
check('dismissed repeat stays one record',enqueue(iso(queueTime)).enqueued,0);
check('next five-minute repeat still enqueues',enqueue(iso(queueTime+5*60000)).enqueued,1);
check('two distinct overdue jobs exist',queueCount(),2);

// OC24: independent issue reporting must survive the entire authenticated
// completion/persistence route for all outcomes, including no-cleaning checks.
for(const selection of [cleaning,{work_result:'details',services_performed:['Restock toilet paper']},checkOnly]){
 const visit=startVisit(),response={...selection,form_type:'restroom',maintenance_issues_found:['Sink leaking'],note:'Synthetic OC24 independent issue',out_of_order_signed:'Yes',out_of_order_details:'Sink one'};
 const before=status().cleaned;
 check('independent issue accepted with '+selection.work_result,JSON.parse(sql(completeSql(visit,response))).status,'closed');
 const saved=JSON.parse(sql(`select response_json from public.completion_responses where client_completion_id=${q(visit.completion)}`));
 for(const field of ['work_result','services_performed','maintenance_issues_found','note','out_of_order_signed','out_of_order_details'])check('persisted '+field+' for '+selection.work_result,saved[field],response[field]);
 check('truthful cleaned time for '+selection.work_result,status().cleaned,selection.work_result==='checked_no_cleaning_needed'?before:visit.finish);
}

// CB02: challenge the actual native-route precheck and final persisted answers.
const whitespaceVisit=startVisit(),cleanedBeforeWhitespace=status().cleaned;
for(const code of [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]){
 const ws=String.fromCodePoint(code);
 for(const services of [[ws],[ws+'Full cleaning services'+ws],[ws+'Full cleaning services'+ws,'Sweep the floor']])
  reject('SQL precheck rejects selective whitespace/alias U+'+code.toString(16),completeSql(whitespaceVisit,{work_result:'details',services_performed:services}),/selective cleaning/);
}
for(const service of [null,0,false,{},[]])reject('SQL precheck rejects nonstring service '+JSON.stringify(service),completeSql(whitespaceVisit,{work_result:'details',services_performed:[service]}),/selective cleaning/);
check('rejected whitespace does not advance last-cleaned',status().cleaned,cleanedBeforeWhitespace);
check('rejected whitespace does not insert completion',Number(sql(`select count(*) from public.completion_responses where client_completion_id=${q(whitespaceVisit.completion)}`)),0);
const wrappedFull={work_result:'full',services_performed:['\tFull cleaning services\u00a0']};
check('JS-valid wrapped full accepted',JSON.parse(sql(completeSql(whitespaceVisit,wrappedFull))).status,'closed');
check('wrapped full preserved exactly not normalized on write',JSON.parse(sql(`select response_json from public.completion_responses where client_completion_id=${q(whitespaceVisit.completion)}`)),wrappedFull);
check('wrapped full replay same operation',JSON.parse(sql(completeSql(whitespaceVisit,wrappedFull))).replayed,true);
const result={passed,failed:0,fixture:'synthetic native-route/database integration',
 physical_nfc_verified:false,provider_delivery_verified:false};
console.log(JSON.stringify(result,null,2));
}
