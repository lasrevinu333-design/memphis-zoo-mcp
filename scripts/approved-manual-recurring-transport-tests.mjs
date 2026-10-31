import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {approvedManualRecurringOperationId,approvedManualRecurringWorkerInput,approvedManualRecurringTransport,
 materializeApprovedManualRecurringOnCurrentTransaction,isApprovedManualPublication,approvedManualMaterializationFrame} from '../src/approved-manual-recurring-transport.js';
import {prepareApprovedManualPeriodWorkerData} from '../src/approved-manual-period-worker.js';
import {readOwnerConfirmedEmploymentAdmissionData,prepareApprovedManualEmploymentAdmission} from '../src/approved-manual-employment-admission.js';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const checks=[],test=async(n,f)=>{await f();checks.push(n);},clone=structuredClone,
 fixture=JSON.parse(readFileSync(new URL('../release/worker1-coverall-workflow-20261030/TYPED_THIRD_ABSENCE_PURE_FIXTURE.json',import.meta.url))),
 uid=n=>`79000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor={managerId:uid(1),managerName:'OWNED_SYNTHETIC_PROTOCOL_FIXTURE'},
 manager={manager_id:actor.managerId,credential_id:uid(2),device_id:'OWNED_SYNTHETIC_DEVICE_NOT_PHYSICAL',access_level:'full_access'},
 pub=fixture.source.version.publicationId,op=approvedManualRecurringOperationId(actor.managerId,'same-original-period-key'),at=(d,n)=>new Date(Date.parse(d+'T12:00Z')+n*86400000).toISOString().slice(0,10),
 records=readOwnerConfirmedEmploymentAdmissionData().employees;
function makeBasis({preStart=false}={}){
 const employmentByDate=[];for(let n=0;n<7;n++)employmentByDate.push({schema:'custodial.employment-admission-read.v1',serviceDate:at(fixture.source.serviceDate,n),authorityRevision:42,
  employees:records.map((r,i)=>{const command=prepareApprovedManualEmploymentAdmission({employeeId:r.employeeId,managerId:actor.managerId,requestId:uid(i+10),expectedAuthorityRevision:42,expectedEmploymentRevision:0,
   ...(!preStart&&i===1?{explicitFact:{effectiveFrom:fixture.source.serviceDate,state:'START_DATE_CONFIRMED',firstServiceDate:fixture.source.serviceDate,approvedLunch:null,ownerEvidenceSha256:'b'.repeat(64)}}:{})}).command;
   return{employeeId:r.employeeId,employmentRevision:1,acceptedByManagerId:actor.managerId,command};})});
 const employmentRevisionVector=employmentByDate.flatMap(d=>d.employees.map(e=>({serviceDate:d.serviceDate,employeeId:e.employeeId,employmentRevision:e.employmentRevision,requestId:e.command.requestId}))).sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.employeeId.localeCompare(b.employeeId));
 const b={schema:'custodial.approved-manual-period-basis.v1',managerId:actor.managerId,actor:{manager_name:actor.managerName},publicationId:pub,versionId:fixture.source.version.id,sourceId:uid(3),
  frameStart:fixture.source.serviceDate,frameEnd:at(fixture.source.serviceDate,6),authorityRevision:42,originalCommand:null,originalSource:{publication_id:pub},normalSource:clone(fixture.source),normalSourceDigest:digest(fixture.source),
  ownerConfig:clone(fixture.ownerConfig),catalogEntryDigest:'c'.repeat(64),generation:3,employmentByDate,employmentRevisionVector,preparedExceptions:[],preparedSummary:[],priorProjection:null,priorDayBases:[],rosterUnavailableByDate:[],acceptedCoverAllDays:[]};
 return{...b,basisDigest:digest(b)};
}
const seal=b=>{delete b.basisDigest;b.basisDigest=digest(b);return b;},basis=makeBasis(),input=approvedManualRecurringWorkerInput({basis,actor,operationId:op}),before=digest({basis,input,fixture}),week=readApprovedManualWeek();
await test('Stable original operation UUID is manager/key-bound and retry-stable',()=>{
 assert.equal(approvedManualRecurringOperationId(actor.managerId,'same-original-period-key'),op);
 assert.notEqual(approvedManualRecurringOperationId(actor.managerId,'new-key'),op);assert.notEqual(approvedManualRecurringOperationId(uid(4),'same-original-period-key'),op);
 assert.throws(()=>approvedManualRecurringOperationId(actor.managerId,' trailing '));
});
await test('Any civil origin retains its publication alignment; ordinary sources are not relabelled',()=>{
 const source={compiler_input:clone(fixture.source)};source.compiler_input.version.effectiveStart='2026-10-30';
 assert.equal(isApprovedManualPublication(source),true);assert.equal(approvedManualMaterializationFrame(source,'2026-11-10'),'2026-11-06');
 assert.equal(isApprovedManualPublication({compiler_input:{version:{}}}),false);
});
await test('Worker receives distinct typed original identity with seven actual reads/fourteen bindings',()=>{
 assert.equal(input.schema,'custodial.approved-manual-period-worker-input.v2');assert.equal(input.employmentByDate.length,7);
 assert.equal(basis.employmentRevisionVector.length,14);assert.equal(input.idempotencyKey,`manual-recurring:${op}`);assert.deepEqual(input.changes,[]);assert.deepEqual(input.acceptedExceptions,[]);
});
await test('Pre-start union is not canonical PTO and retains its classification',()=>{
 const b=makeBasis({preStart:true}),i=approvedManualRecurringWorkerInput({basis:b,actor,operationId:op});
 assert.ok(i.changes.some(c=>c.preStartPersonIds?.includes(records[1].employeeId)));assert.deepEqual(i.acceptedExceptions,[]);
});
const scheduled=fixture.source.version.slotAvailability.find(a=>a.status==='working'),person=fixture.source.slots.find(s=>s.id===scheduled.slotId).incumbencies[0],serviceDate=Array.from({length:7},(_,n)=>at(basis.frameStart,n)).find(d=>new Date(d+'T12:00Z').getUTCDay()===scheduled.dayOfWeek);
await test('SQL-derived actual roster displacement excludes original owner without inventing PTO or replacement',()=>{
 const b=clone(basis);b.rosterUnavailableByDate=[{serviceDate,slotId:scheduled.slotId,employeeId:person.personId}];seal(b);
 const i=approvedManualRecurringWorkerInput({basis:b,actor,operationId:op});assert.ok(i.changes.find(c=>c.serviceDate===serviceDate).absentPersonIds.includes(person.personId));
 assert.deepEqual(i.acceptedExceptions,[]);assert.deepEqual(i.source.slots,basis.normalSource.slots);
});
for(const [name,change]of [['duplicate roster fact',b=>b.rosterUnavailableByDate=[{serviceDate,slotId:scheduled.slotId,employeeId:person.personId},{serviceDate,slotId:scheduled.slotId,employeeId:person.personId}]],
 ['different historical owner',b=>b.rosterUnavailableByDate=[{serviceDate,slotId:scheduled.slotId,employeeId:uid(88)}]],['unaccepted capacity bool',b=>b.acceptedCoverAllDays=[{serviceDate,choiceId:uid(10),capacityId:uid(11)}]],
 ['missing employment read',b=>b.employmentByDate.pop()],['stale employment vector',b=>b.employmentRevisionVector[0].employmentRevision++],['invented staffing command',b=>b.originalCommand={operationId:op}]]){
 await test(name+' refuses',()=>{const b=clone(basis);change(b);seal(b);assert.throws(()=>approvedManualRecurringWorkerInput({basis:b,actor,operationId:op}));});
}
await test('Canonical PTO and pre-start mathematical union remain separate actual facts',()=>{
 const b=makeBasis({preStart:true}),p=week.referenceBindings.people.find(p=>p.approvedName.startsWith('Derrick '));
 b.preparedExceptions=[{id:'synthetic-existing-accepted-pto',type:'pto',status:'accepted',serviceDate:'2026-11-03',baseVersionId:b.versionId,publicationId:pub,actorId:actor.managerId,
  reason:'SYNTHETIC_EXISTING_FACT',idempotencyKey:'synthetic',expectedRevision:42,sequence:1,payload:{slotId:p.slotId}}];seal(b);
 const i=approvedManualRecurringWorkerInput({basis:b,actor,operationId:op}),d=i.changes.find(d=>d.serviceDate==='2026-11-03');assert.ok(d.absentPersonIds.includes(p.employeeId));assert.ok(d.absentPersonIds.includes(records[1].employeeId));
 assert.equal(i.acceptedExceptions.length,1);assert.equal(i.acceptedExceptions[0].id,'synthetic-existing-accepted-pto');
});
// Real mathematical normal projection DATA, not a fake result/attestation. All
// seven days unchanged => existing worker bypasses the optimizer entirely.
const native=await prepareApprovedManualPeriodWorkerData(input,performance.now()+45000),projection=approvedManualRecurringTransport({workerInput:input,workerResult:native,basis,operationId:op});
await test('Real unchanged native DATA has346rows/40full-hour lunches and no solver invocation',()=>{assert.equal(native.period.solverInvoked,false);assert.equal(native.nativeProjection.projectionAssignments.length,346);assert.equal(projection.lunchDocument.loans.length,40);assert.equal(projection.envelope.semantic_snapshot.recurringOperation.kind,'RECURRING_MANUAL_MATERIALIZATION');assert.ok(!('originalCommand'in projection.envelope.semantic_snapshot));});
await test('Lowering preserves all fourteen bindings, fresh lunch hashes and native hard proof',()=>{
 assert.deepEqual(projection.envelope.authority.employmentRevisionVector,basis.employmentRevisionVector);assert.equal(projection.envelope.database_projection_identity,digest(Object.fromEntries(Object.entries(projection.envelope).filter(([k])=>k!=='database_projection_identity'))));
 assert.equal(projection.lunchDocument.base_authority_digest,projection.envelope.authority_digest);assert.equal(projection.lunchDocument.base_replay_digest,projection.replayDigest);
});
await test('Mutated native assignment result refuses before stage',()=>{const x=clone(native);x.nativeProjection.projectionAssignments[0].owner_person_id=uid(99);assert.throws(()=>approvedManualRecurringTransport({workerInput:input,workerResult:x,basis,operationId:op}));});
function ports({state='NATIVE_ADJUSTMENT_REQUIRED',wrongPhysical=false,stageConflict=false,prepareError=false,originalReceipt=false}={}){
 let physicalReads=0;const calls=[],client={query:async()=>({rows:[{pid:40001,xid:wrongPhysical&&++physicalReads>2?'999':'12345'}]})};
 const call=async(c,name,args)=>{assert.equal(c,client);calls.push(name);
  if(name==='static_weekly_begin_manual_recurring')return{state:originalReceipt?'ORIGINAL_RECEIPT':state,operationId:op,backendPid:40001,transactionId:'12345',basis,
   repeatBasis:{schema:'custodial.approved-manual-recurring-basis.v1',managerId:actor.managerId,sourceId:uid(3),publicationId:pub,versionId:basis.versionId,origin:'2026-10-26',frameStart:basis.frameStart,frameEnd:basis.frameEnd,
    authorityRevision:42,generation:3,manifestSha256:fixture.source.version.manualGroupRatingAuthority.manifestSha256,baselineSnapshotDigest:'a'.repeat(64),catalogEntryDigest:'b'.repeat(64),sourceProjectionIdentity:'c'.repeat(64),sourceLunchIdentity:'d'.repeat(64),
    assignmentCount:346,lunchCount:40,acceptedExceptions:[],adjustmentReasons:[],employmentByDate:basis.employmentByDate,existingProjectionId:null,
    participants:Array.from({length:7},(_,n)=>({serviceDate:at(basis.frameStart,n),assignmentEmployeeIds:[],lunchOwnerEmployeeIds:[],lunchCovererEmployeeIds:[]}))},
   receipt:{status:'PERSISTED_CURRENT',operationId:op,projectionId:uid(50)}};
  if(name==='static_weekly_finish_manual_recurring_normal'){
   assert.equal(args[0],op);assert.equal(args[1],actor.managerId);assert.equal(args[2].requestId,op);assert.equal(args[2].employmentRevisionVector.length,14);assert.equal(args[3],digest(args[2]));
   return{schema:'custodial.approved-manual-recurring-confirmation.v2',kind:'RECURRING_MANUAL_MATERIALIZATION',status:'PERSISTED_CURRENT',operationId:op,projectionId:uid(50)};
  }
  if(name==='static_weekly_stage_manual_recurring')return{state:'STAGED_UNCOMMITTED',candidateDigest:stageConflict?'f'.repeat(64):digest({envelope:args[2],lunch:args[3]})};
  if(name==='static_weekly_finalize_manual_recurring')return{schema:'custodial.approved-manual-recurring-confirmation.v2',kind:'RECURRING_MANUAL_MATERIALIZATION',status:'PERSISTED_CURRENT',operationId:op,projectionId:uid(50)};
  throw Error(name);
 };
 const run=()=>materializeApprovedManualRecurringOnCurrentTransaction({client,call,manager:clone(manager),actor,publicationId:pub,serviceDate:basis.frameStart,expectedRevision:42,idempotencyKey:'same-original-period-key',
  prepareOperational:async i=>{assert.deepEqual(i,input);if(prepareError)throw Object.assign(Error('unknown child custody'),{code:'OWNED_CHILD_UNKNOWN'});return native;}});
 return{run,calls};
}
await test('Same physical transaction protocol begins/stages/finalizes only after real DATA capture',async()=>{const p=ports();assert.equal((await p.run()).status,'PERSISTED_CURRENT');assert.deepEqual(p.calls,['static_weekly_begin_manual_recurring','static_weekly_stage_manual_recurring','static_weekly_finalize_manual_recurring']);});
await test('Normal reference invokes no worker and finishes the original compact reference with14 bindings',async()=>{const p=ports({state:'NORMAL_REFERENCE_REQUIRED'});assert.equal((await p.run()).status,'PERSISTED_CURRENT');assert.deepEqual(p.calls,['static_weekly_begin_manual_recurring','static_weekly_finish_manual_recurring_normal']);});
await test('Original accepted receipt replay never spawns/prepares/rechecks current as new',async()=>{const p=ports({originalReceipt:true});const r=await p.run();assert.equal(r.currentReadbackRepeated,false);assert.equal(r.replayed,true);assert.deepEqual(p.calls,['static_weekly_begin_manual_recurring']);});
await test('Changed physical transaction fences before native work/staging',async()=>{const p=ports({wrongPhysical:true});await assert.rejects(p.run(),e=>e.code==='APPROVED_MANUAL_RECURRING_TRANSACTION_UNKNOWN'&&e.operationId===op);assert.deepEqual(p.calls,['static_weekly_begin_manual_recurring']);});
await test('UNKNOWN native child preserves same original operation and never stages/retries',async()=>{const p=ports({prepareError:true});await assert.rejects(p.run(),e=>e.code==='OWNED_CHILD_UNKNOWN'&&e.originalRecurringRequest.operationId===op);assert.deepEqual(p.calls,['static_weekly_begin_manual_recurring']);});
await test('Candidate conflict stops before finalize',async()=>{const p=ports({stageConflict:true});await assert.rejects(p.run());assert.equal(p.calls.at(-1),'static_weekly_stage_manual_recurring');});
await test('Full inputs remain byte-equivalent after real DATA and mocked transaction cases',()=>assert.equal(digest({basis,input,fixture}),before));
const sql=readFileSync(new URL('../proposals/approved-manual-recurring-native.sql',import.meta.url),'utf8'),cp=readFileSync(new URL('../src/static-weekly-control-plane.js',import.meta.url),'utf8');
await test('SQL companion closes same-original transaction/revision/ACL and no half-commit',()=>{
 for(const marker of ['owner_xid<>pg_current_xact_id()','backend_pid<>pg_backend_pid()','DEFERRABLE INITIALLY DEFERRED','ENABLE ALWAYS TRIGGER complete_recurring_receipt',
  'employmentByDate','employmentRevisionVector','static_weekly_coverall_effective_facts','static_weekly_coverall_assert_retained_day','inverse<>original','pg_column_size(p_envelope)>16777216','static_weekly_v8_materialize_lunch_document'])assert.ok(sql.includes(marker),marker);
 assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:employees|weekly_roster_slots|static_weekly_staffing_commands|static_weekly_staffing_absences|static_weekly_approved_initial_baselines)/i);
 assert.doesNotMatch(sql,/static_weekly_digest_jsonb\(\s*\w+\.feasibility\s*\)/i);
});
await test('CP dispatch precedes legacy compiler and generic no-op; original legacy branch remains',()=>{
 const block=cp.slice(cp.indexOf('async function materializeCurrentProjection'),cp.indexOf('async function mutateAndMaterializeCurrentProjection'));
 assert.ok(block.indexOf('if(isApprovedManualPublication(source))')<block.indexOf('const projection = preparedProjection ||'));
 assert.match(cp,/getApprovedManualRecurringMaterializationStatus/);assert.match(cp,/createApprovedManualCoverAllManagement/);
 assert.match(cp,/static_weekly_coverall_bind_actor/);assert.match(cp,/static_manual_coverall_cancellation_must_retain_original_two_plan/);
 assert.match(cp,/static_manual_coverall_choice_required/);assert.match(cp,/requireMonday\(requestedDate,'projection start'\)/);
});
console.log(JSON.stringify({status:'PASS',groups:checks.length,checks,realUnchangedNativeRows:346,realUnchangedNativeLunches:40,realNormalSolverInvoked:false,
 mockedTransactionCases:true,sqlExecuted:false,productionWritten:false,actualManagerOrPhysicalDevice:false,scope:'Pure typed recurrence/real unchanged DATA and mocked same-client transaction ports; SQL unqualified'}));
