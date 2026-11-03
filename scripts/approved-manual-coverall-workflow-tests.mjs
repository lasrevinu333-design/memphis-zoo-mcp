import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {installStaticWeeklySha256HexAccelerator,snapshotContractorCapacity} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest,canonicalAuthorityInput} from '../src/static-weekly-schedule-program.js';
import {prepareApprovedManualCoverAllActivation,prepareApprovedManualCoverAllChoice,approvedManualCoverAllWorkerInput,prepareApprovedManualCoverAllInitialOnCurrentTransaction,approvedManualCoverAllInitialWorkerInput,approvedManualCoverAllInitialNativeTransport} from '../src/approved-manual-coverall-workflow.js';
import {readOwnerConfirmedEmploymentAdmissionData,prepareApprovedManualEmploymentAdmission} from '../src/approved-manual-employment-admission.js';
import {approvedManualEmploymentPeriod} from '../src/approved-manual-employment-integration.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const D=new URL('../release/worker1-coverall-workflow-20261030/',import.meta.url),copy=structuredClone,checks=[],test=(name,f)=>{f();checks.push(name);},
 fixture=JSON.parse(readFileSync(new URL('TYPED_THIRD_ABSENCE_PURE_FIXTURE.json',D))),week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,referenceBytes:readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 snapshot=JSON.parse(readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url))).readback,
 uid=n=>`79000000-0000-4000-8000-${String(n).padStart(12,'0')}`,manager=uid(1),operation=uid(2),publication=fixture.source.version.publicationId,sourceId=uid(3),projectionId=uid(4),choiceId=uid(5),
 semanticBody={absenceKind:'pto',commandKind:'absence',employeeId:fixture.thirdDay.overlay.replacedPersonId,startDate:fixture.thirdDay.serviceDate,endDate:fixture.thirdDay.serviceDate,targetAbsenceId:null},
 command={operationId:operation,preparerId:manager,semanticBody,semanticDigest:digest(semanticBody),expectedRevision:42,currentServiceDate:'2026-10-30',originalCancellationTarget:null},
 capacity=fixture.thirdDay.overlay.substitute.slotId,
 day={serviceDate:semanticBody.startDate,sourceId,publicationId:publication,capacityId:capacity,shift:copy(fixture.thirdDay.overlay.substitute.shift),lunch:copy(fixture.thirdDay.overlay.substitute.lunch),
 lunchCovererSlotId:fixture.thirdDay.overlay.lunchPlans.find(l=>l.recipientSlotId===capacity).covererSlotId,confirmationReference:fixture.thirdDay.overlay.substitute.confirmationReference,actualHoursConfirmed:true},
 basis={originalCommand:command,normalSources:[{sourceId,publicationId:publication,source:fixture.source}],retainedDays:[{serviceDate:day.serviceDate,sourceId,publicationId:publication,projectionId,envelopeIdentity:'a'.repeat(64),dayBasis:fixture.retainedDay}]},
 prepare=(d=day,b=basis,c=command)=>prepareApprovedManualCoverAllChoice({originalCommand:c,basis:b,choiceId,days:[d]});
const before=digest({fixture,week,draft,snapshot,basis,command,day}),prepared=prepare();
test('Original six semantic fields and operation/revision are immutable separate from actual-hours DATA',()=>{
 assert.equal(prepared.status,'PREPARING_DATA_NOT_ACCEPTED');assert.deepEqual(prepared.choice.canonicalSemanticBody,semanticBody);
 assert.equal(prepared.choice.operationId,operation);assert.equal(prepared.choice.expectedRevision,42);assert.equal(prepared.choice.contractorBooked,false);
 assert.deepEqual(Object.keys(semanticBody).sort(),['absenceKind','commandKind','employeeId','endDate','startDate','targetAbsenceId']);
});
test('Exact retained two-absence phase geometry, replacing only third owner',()=>{
 const overlay=prepared.overlays[0].overlay,replaced=fixture.retainedDay.input.roster.find(r=>r.personId===semanticBody.employeeId);
 assert.equal(overlay.acceptedPlanDigest,fixture.retainedDay.plan.planDigest);assert.equal(overlay.solverInvoked,false);assert.equal(overlay.scoringRerun,false);
 for(let i=0;i<fixture.retainedDay.plan.phaseOwners.length;i++)for(const [code,slot]of Object.entries(fixture.retainedDay.plan.phaseOwners[i].owners))assert.equal(overlay.phaseOwners[i].owners[code],slot===replaced.slotId?capacity:slot);
 for(const row of overlay.roster.filter(r=>r.kind==='EMPLOYEE')){const old=fixture.retainedDay.input.roster.find(r=>r.slotId===row.slotId);assert.deepEqual(row.shift,old.shift);assert.deepEqual(row.lunch,old.lunch);}
 assert.equal(overlay.otherNormalOwnersChanged,false);
});
test('Actual full-hour lunch and exact existing helper are retained',()=>{
 const o=prepared.overlays[0].overlay,l=o.lunchPlans.find(l=>l.recipientSlotId===capacity);assert.deepEqual(l.window,day.lunch);assert.equal(l.covererSlotId,day.lunchCovererSlotId);
 assert.ok(o.lunchPlans.every(l=>Number(l.window.end.slice(0,2))*60+Number(l.window.end.slice(3))-Number(l.window.start.slice(0,2))*60-Number(l.window.start.slice(3))===60));
});
for(const [name,change]of [
 ['unconfirmed hours',d=>d.actualHoursConfirmed=false],['blank confirmation',d=>d.confirmationReference=''],['whitespace confirmation',d=>d.confirmationReference=' confirmed '],
 ['short lunch',d=>d.lunch.end='10:00'],['lunch outside actual shift',d=>d.lunch={start:'03:00',end:'04:00'}],['actual shift misses retained complete-crew duty',d=>d.shift.start='09:00'],
 ['helper is absent third owner',d=>d.lunchCovererSlotId=fixture.retainedDay.input.roster.find(r=>r.personId===semanticBody.employeeId).slotId],
 ['different source capacity',d=>d.capacityId=uid(44)],['changed publication',d=>d.publicationId=uid(45)],['changed Source',d=>d.sourceId=uid(46)],
 ['date outside canonical command',d=>d.serviceDate='2026-11-04'],['extra arbitrary choice fields',d=>d.booked=true]
])test(`Refuses ${name}`,()=>{const d=copy(day);change(d);assert.throws(()=>prepare(d),name);});
for(const [name,change]of [
 ['operation substitution',c=>c.operationId=uid(47)],['preparer substitution',c=>c.preparerId=uid(48)],['revision substitution',c=>c.expectedRevision=43],
 ['semantic digest mismatch',c=>c.semanticBody.absenceKind='daily_absence']
])test(`Refuses ${name}`,()=>{const c=copy(command);change(c);assert.throws(()=>prepare(day,basis,c));});
test('No retained accepted two-plan or incorrect retained count refuses',()=>{
 const b=copy(basis);b.retainedDays=[];assert.throws(()=>prepare(day,b));const x=copy(basis);x.retainedDays[0].dayBasis.input.absentPersonIds.pop();assert.throws(()=>prepare(day,x));
});
test('Retained plan body mutation refuses even with caller unchanged plan hash',()=>{const b=copy(basis);b.retainedDays[0].dayBasis.plan.phaseOwners[0].window.end='11:59';assert.throws(()=>prepare(day,b));});
test('Duplicate service-day choices refuse',()=>assert.throws(()=>prepareApprovedManualCoverAllChoice({originalCommand:command,basis,choiceId,days:[day,day]})));
test('Actual later contractor hours inherit all23 areas after original normal end, without extending employees',()=>{
 const d=copy(day);d.shift.end=fixture.extendedDay.overlay.substitute.shift.end;const o=prepare(d).overlays[0].overlay,last=o.phaseOwners.at(-1);
 assert.equal(o.schema,'custodial.approved-manual-coverall-overlay.v2');assert.equal(last.window.start,fixture.retainedDay.input.checkedWindow.end);assert.equal(last.window.end,d.shift.end);
 assert.equal(Object.keys(last.owners).length,23);assert.ok(Object.values(last.owners).every(id=>id===capacity));assert.equal(o.confirmedCoverageExtension.employeeShiftExtensions,false);
 for(const row of o.roster.filter(r=>r.kind==='EMPLOYEE'))assert.deepEqual(row.shift,fixture.retainedDay.input.roster.find(r=>r.slotId===row.slotId).shift);
});
test('Earlier confirmed clock-in does not invent earlier full-site coverage',()=>{
 const d=copy(day);d.shift.start='04:00';const o=prepare(d).overlays[0].overlay;assert.equal(o.checkedWindow.start,fixture.retainedDay.input.checkedWindow.start);
 assert.ok(o.phaseOwners.every(p=>p.window.start>=fixture.retainedDay.input.checkedWindow.start));
});
const friday=copy(snapshot);friday.serviceDate='2026-10-30';
const legacy=draft.sourceDraft.slots.filter(s=>s.contractorCapacity),selection=legacy.map((s,i)=>({legacy_slot_id:s.id,new_capacity_id:uid(100+i),capacity_code:`CoverAll${String(i+1).padStart(2,'0')}`})),
 activation=prepareApprovedManualCoverAllActivation({week,draft,snapshot:friday,selection,sourceId:uid(6),versionId:uid(7),templatePublicationId:uid(8),templateId:'COVERALL_PURE_CURRENT_FRIDAY',packetId:uid(9),managerId:manager});
test('Current Friday activation uses ordinary seven-day origin and exact fixed346/40 pattern',()=>{
 assert.equal(activation.serviceDate,'2026-10-30');assert.equal(activation.windowEnd,'2026-11-05');assert.equal(activation.feasibility.projectionAssignments.length,346);assert.equal(activation.feasibility.lunch.lunches.length,40);
 assert.equal(activation.feasibility.solverInvoked,false);assert.equal(activation.feasibility.mapping.unchanged,true);
 const old=activation.transition.projectedSourceDraft,expected=canonicalAuthorityInput(old.version,old.slots,[],old.proximity,activation.serviceDate);
 assert.deepEqual(activation.source.version.assignments,expected.version.assignments);assert.deepEqual(activation.source.version.lunchCoveragePolicy,expected.version.lunchCoveragePolicy);
});
test('Typed eight slots are NEW separate nonemployee UUIDs;22history positions plus8, not30employees',()=>{
 assert.equal(activation.currentPositions,22);assert.equal(activation.prospectivePositions,30);assert.equal(activation.newEmployees,0);
 const prior=new Set(snapshot.rosterSlots.map(s=>s.slotId));for(const s of activation.source.slots.filter(s=>s.kind==='CONTRACTOR_CAPACITY')){assert.ok(!prior.has(s.id));assert.deepEqual(s.incumbencies,[]);assert.equal(snapshotContractorCapacity(s,activation.serviceDate).personId,null);}
 assert.equal(activation.capacityTransition.preservedLiveHistoryDigests.length,22);assert.equal(activation.registered,false);assert.equal(activation.published,false);
});
test('Activation rejects ID reuse and unknown source mapping instead of touching history',()=>{
 const bad=copy(selection);bad[0].new_capacity_id=snapshot.rosterSlots[0].slotId;assert.throws(()=>prepareApprovedManualCoverAllActivation({week,draft,snapshot:friday,selection:bad,sourceId:uid(6),versionId:uid(7),templatePublicationId:uid(8),templateId:'bad',packetId:uid(9),managerId:manager}));
});
test('No input source, original plan, roster, seven normal days or original request is mutated',()=>assert.equal(digest({fixture,week,draft,snapshot,basis,command,day}),before));
const sql=readFileSync(new URL('../proposals/approved-manual-coverall-workflow.sql',import.meta.url),'utf8');
test('SQL proposal binds same canonical acceptance revision, not a second authority advance',()=>{
 assert.match(sql,/p_revision<>c.expected_revision\+1/);assert.match(sql,/r.operation='apply_staffing_command'/);assert.doesNotMatch(sql,/perform public\.static_weekly_advance_authority/i);
 assert.match(sql,/complete_coverall_activation[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
});
test('Cancellation is append-only exact original operation/date range with no historical deletion',()=>{
 assert.match(sql,/a.operation_id=c.target_absence_id AND a.service_date BETWEEN c.start_date AND c.end_date/);assert.match(sql,/INSERT INTO custodial_coverall.cancellations/);assert.doesNotMatch(sql,/DELETE FROM custodial_coverall/i);
});
test('Original future-Monday bridge and Source301 memory-safe component scheme remain separate',()=>{
 assert.doesNotMatch(sql,/static_weekly_(begin|finish)_contractor_capacity_transition\(/);assert.match(sql,/static_weekly_manual_activation_packet_fingerprint/);
 assert.match(sql,/SELECT packet_id,source_id,template_id,manager_id,service_date,expected_revision,roster_digest,preview_digest,/);
});
// Synthetic transport cases exercise ONLY the same-client lifecycle. No SQL
// authorization/native validation/acceptance credit is claimed from this mock.
const asyncTest=async(name,f)=>{await f();checks.push(name);};
function transactionFixture({workerFailure=false,changeClient=false,sqlFailure=false}={}){
 const calls=[],physical={pid:12345,xid:'56789'},vector=Array.from({length:14},(_,i)=>({serviceDate:'2026-10-30',employeeId:uid(300+i),employmentRevision:1,requestId:uid(400+i)})),
  beginning={schema:'custodial.coverall-initial-uncommitted.v1',kind:'INITIAL_EMPLOYMENT_OPERATIONALIZATION',operationId:operation,managerId:manager,backendPid:physical.pid,transactionId:physical.xid,
   sourceId,publicationId:publication,committed:false,accepted:false,normalBaselineIsNotActualCoverage:true,basis:{employmentByDate:Array.from({length:7},(_,i)=>({syntheticDate:i})),employmentRevisionVector:vector}},
  envelope={semantic_snapshot:{initialActivation:{operationId:operation}},authority:{employmentRevisionVector:vector}},lunchDocument={synthetic:true},
  receipt={schema:'custodial.approved-manual-coverall-source-confirmation.v2',kind:'INITIAL_EMPLOYMENT_OPERATIONALIZATION',operationId:operation,status:'PERSISTED_CURRENT',sourceId,publicationId:publication,samePhysicalTransaction:true,employmentRevisionVector:vector};
 let physicalReads=0;
 const client={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('select pg_backend_pid'))return{rows:[changeClient&&++physicalReads>2?{...physical,pid:55555}:physical]};
  if(sql.includes('begin_coverall_activation'))return{rows:[{value:beginning}]};
  if(sql.includes('stage_initial_operational')){if(sqlFailure)throw Error('synthetic native validation refusal');return{rows:[{value:{state:'STAGED_UNCOMMITTED',operationId:operation,candidateDigest:'b'.repeat(64),committed:false}}]};}
  if(sql.includes('finalize_initial_operational'))return{rows:[{value:receipt}]};if(sql==='ROLLBACK')return{rows:[]};throw Error('Unexpected SQL in transport fixture');}},
  run=()=>prepareApprovedManualCoverAllInitialOnCurrentTransaction({client,managerId:manager,packetId:uid(6),operationId:operation,expectedRevision:42,previewDigest:'a'.repeat(64),credentialId:uid(7),deviceId:'PURE_TEST_DEVICE',sessionAccess:'full_access',
   prepareOperational:async request=>{assert.equal(request.kind,'INITIAL_EMPLOYMENT_OPERATIONALIZATION');assert.deepEqual(request.employmentRevisionVector,vector);if(workerFailure)throw Error('synthetic child refusal');return{envelope,lunchDocument};}});
 return{run,calls,physical,envelope};
}
await asyncTest('Same physical transaction performs begin then actual worker DATA then stage/finalize; Main alone commits',async()=>{
 const f=transactionFixture(),r=await f.run();assert.equal(r.committed,false);assert.equal(r.callerMustCommit,true);assert.equal(r.readyForExternalResponse,false);
 assert.deepEqual(f.calls.filter(c=>!c.sql.startsWith('select pg_backend_pid')).map(c=>c.sql.match(/public\.([a-z_]+)/)?.[1]),['static_weekly_begin_coverall_activation','static_weekly_coverall_stage_initial_operational','static_weekly_coverall_finalize_initial_operational']);
 assert.ok(f.calls.every(c=>!['BEGIN','COMMIT'].includes(c.sql)));
});
await asyncTest('Compiler refusal rolls back original physical transaction; no stage/finalize or retry',async()=>{
 const f=transactionFixture({workerFailure:true});await assert.rejects(f.run(),e=>e.coverAllOriginalTransactionRolledBack===true);assert.equal(f.calls.filter(c=>c.sql==='ROLLBACK').length,1);assert.ok(f.calls.every(c=>!c.sql.includes('stage_initial')&&!c.sql.includes('finalize_initial')));
});
await asyncTest('SQL native guard refusal rolls back and never returns a publication receipt',async()=>{
 const f=transactionFixture({sqlFailure:true});await assert.rejects(f.run(),e=>e.coverAllOriginalTransactionRolledBack===true);assert.equal(f.calls.filter(c=>c.sql==='ROLLBACK').length,1);assert.ok(f.calls.every(c=>!c.sql.includes('finalize_initial')));
});
await asyncTest('Physical client replacement is UNKNOWN; no new stage, no second transaction, no guessed original rollback',async()=>{
 const f=transactionFixture({changeClient:true});await assert.rejects(f.run(),e=>e.code==='COVERALL_ACTIVATION_TRANSACTION_UNKNOWN');assert.ok(f.calls.every(c=>!c.sql.includes('stage_initial')&&c.sql!=='ROLLBACK'));
});
test('Staffing worker wrapper detaches frozen canonical input before attaching original choice; no authority flag invented',()=>{
 const raw=fixture.retainedDay.input.absentPersonIds.map((id,n)=>({id:'pure-accepted-'+n,type:'pto',serviceDate:day.serviceDate,actorId:manager,reason:'PURE_ACCEPTED_MATHEMATICS_NOT_AUTHORITY',expectedRevision:41,status:'accepted',
  idempotencyKey:'pure-accepted-'+n,payload:{slotId:week.referenceBindings.people.find(p=>p.employeeId===id).slotId},baseVersionId:fixture.source.version.id,publicationId:publication}));
 raw.push({id:operation+':'+day.serviceDate,type:'pto',serviceDate:day.serviceDate,actorId:manager,reason:'Approved staffing unavailability',expectedRevision:42,
  idempotencyKey:'staffing:'+operation+':'+day.serviceDate,staffingAbsenceId:operation,staffingAbsenceKind:'pto',payload:{slotId:week.referenceBindings.people.find(p=>p.employeeId===semanticBody.employeeId).slotId},baseVersionId:fixture.source.version.id,publicationId:publication});
 const b={schema:'custodial.approved-manual-period-basis.v1',frameStart:fixture.source.serviceDate,originalCommand:command,authorityRevision:42,managerId:manager,actor:{manager_name:'Synthetic Manager'},normalSource:fixture.source,ownerConfig:fixture.ownerConfig,
  preparedExceptions:raw,priorDayBases:[fixture.retainedDay],priorProjection:null};
 const input=approvedManualCoverAllWorkerInput({basis:b,week,actor:{managerId:manager,managerName:'Synthetic Manager'},operationId:operation,expectedRevision:42,frameStart:fixture.source.serviceDate,choice:prepared.choice});
 assert.equal(input.changes[0].absentPersonIds.length,3);assert.equal(input.changes[0].substitute.slotId,capacity);assert.deepEqual(input.acceptedExceptions,raw);assert.equal(raw.at(-1).status,undefined);
});
test('SQL two-phase has actual transaction/PID/deferred receipt and native storage/full lunch, never fake staffing/PTO',()=>{
 assert.match(sql,/owner_xid<>pg_current_xact_id\(\).*a.backend_pid<>pg_backend_pid\(\)/s);assert.match(sql,/static_weekly_coverall_initial_projection_sink/);assert.match(sql,/static_weekly_v8_materialize_lunch_document\(projection/);
 assert.match(sql,/Main factored initial-employment native guard not installed/);assert.doesNotMatch(sql,/INSERT INTO public\.static_weekly_staffing_commands/i);
});
const employmentCommands=readOwnerConfirmedEmploymentAdmissionData().employees.map((e,i)=>prepareApprovedManualEmploymentAdmission({employeeId:e.employeeId,managerId:manager,requestId:uid(700+i),expectedAuthorityRevision:42,expectedEmploymentRevision:0}).command),
 employmentByDate=Array.from({length:7},(_,i)=>({schema:'custodial.employment-admission-read.v1',serviceDate:new Date(Date.parse(fixture.source.serviceDate+'T12:00Z')+i*86400000).toISOString().slice(0,10),authorityRevision:42,
  employees:employmentCommands.map(c=>({employeeId:c.employeeId,employmentRevision:1,acceptedByManagerId:manager,command:c}))})),
 employmentVector=approvedManualEmploymentPeriod({frameStart:fixture.source.serviceDate,expectedRevision:42,employmentByDate}).revisionVector,
 initialBasisBody={schema:'custodial.approved-manual-period-basis.v1',managerId:manager,sourceId,publicationId:publication,versionId:fixture.source.version.id,
  frameStart:fixture.source.serviceDate,frameEnd:'2026-11-08',authorityRevision:42,originalCommand:null,normalSource:fixture.source,normalSourceDigest:digest(fixture.source),ownerConfig:fixture.ownerConfig,
  actor:{manager_name:'Synthetic Manager'},preparedExceptions:[],preparedSummary:[],priorDayBases:[],priorProjection:null,employmentByDate,employmentRevisionVector:employmentVector,
  originalSource:{publication_id:publication,version_id:fixture.source.version.id},generation:1,catalogEntryDigest:'d'.repeat(64)},
 initialBeginning={schema:'custodial.coverall-initial-uncommitted.v1',operationId:operation,managerId:manager,sourceId,publicationId:publication,authorityRevision:42,committed:false,accepted:false,
  basis:{...initialBasisBody,basisDigest:digest(initialBasisBody)}};
test('Initial v2 input carries actual-read-shaped7/14 bindings and NO fake staffing command or PTO facts',()=>{
 const input=approvedManualCoverAllInitialWorkerInput({beginning:initialBeginning,week});assert.equal(input.schema,'custodial.approved-manual-period-worker-input.v2');
 assert.equal(input.employmentByDate.length,7);assert.deepEqual(input.acceptedExceptions,[]);assert.deepEqual(input.changes,[]);assert.equal(input.idempotencyKey,'coverall-initial:'+operation);assert.equal(initialBeginning.basis.originalCommand,null);
});
test('Initial preparation refuses missing actual employment day and changed SQL basis body',()=>{
 const x=copy(initialBeginning);x.basis.employmentByDate.pop();assert.throws(()=>approvedManualCoverAllInitialWorkerInput({beginning:x,week}));
 const y=copy(initialBeginning);y.basis.normalSource.version.effectiveStart='2026-11-03';assert.throws(()=>approvedManualCoverAllInitialWorkerInput({beginning:y,week}));
});
test('No fabricated optimizer/native result can be translated to initial database envelope',()=>{
 const input=approvedManualCoverAllInitialWorkerInput({beginning:initialBeginning,week});assert.throws(()=>approvedManualCoverAllInitialNativeTransport({beginning:initialBeginning,workerInput:input,workerResult:{compatible:true}}));
});
console.log(JSON.stringify({status:'PASS',scope:'Pure actual-hours/retained-plan mechanics plus synthetic same-client protocol cases and Source-only SQL guard contract; NOT SQL qualification, acceptance, booking, vendor approval or publication',groups:checks.length,checks,actualSQL:false}));
