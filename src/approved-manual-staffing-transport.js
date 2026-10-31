import assert from 'node:assert/strict';
import {assertExceptionCommand} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {captureApprovedManualPeriodWorkerInput,captureApprovedManualPeriodWorkerResult} from './approved-manual-period-worker.js';
import {enumerateStaffingServiceWindow,STAFFING_PREPARATION_LIMITS} from './static-weekly-staffing-preparation.js';

const clone=structuredClone,fail=code=>{throw Object.assign(new Error(code),{code});},
 dateAt=(start,n)=>new Date(Date.parse(start+'T12:00Z')+n*86400000).toISOString().slice(0,10);

// The SQL owner supplies the effective publication's actual seven-day origin.
// Calendar labels alone never choose a new normal schedule or future hold.
export function staffingWindowFromOwnerFrames({command,managerId,frameVector}){
 const c=command,expected={operationId:c.operation_id,preparerId:managerId,semanticBody:c.semantic_body,semanticDigest:c.semantic_digest,
  expectedRevision:c.expected_revision,currentServiceDate:c.current_service_date,originalCancellationTarget:c.original_cancellation_target??null},
  calendar=enumerateStaffingServiceWindow(c.semantic_body.startDate,c.semantic_body.endDate);
 assert.equal(frameVector?.schema,'custodial.staffing-source-period-frames.v1');assert.equal(digest(frameVector.originalCommand),digest(expected));
 assert.ok(Array.isArray(frameVector.frames));assert.equal(frameVector.frames.length,calendar.dates.length);
 const weeks=[];
 for(let index=0;index<calendar.dates.length;index++){
  const row=frameVector.frames[index];assert.equal(Object.keys(row).sort().join(','),'frameStart,serviceDate');
  assert.equal(row.serviceDate,calendar.dates[index]);assert.match(row.frameStart,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(row.frameStart+'T12:00Z').toISOString().slice(0,10),row.frameStart);
  assert.ok(row.frameStart<=row.serviceDate&&row.serviceDate<=dateAt(row.frameStart,6));
  if(!weeks.includes(row.frameStart)){assert.ok(!weeks.length||weeks.at(-1)<row.frameStart);weeks.push(row.frameStart);}
 }
 assert.ok(weeks.length<=STAFFING_PREPARATION_LIMITS.weeks);
 return Object.freeze({dates:calendar.dates,weeks:Object.freeze(weeks)});
}

export function approvedManualStaffingWorkerInput({basis,week,actor,operationId,expectedRevision,frameStart}){
 assert.equal(basis.schema,'custodial.approved-manual-period-basis.v1');assert.equal(basis.frameStart,frameStart);
 assert.equal(basis.originalCommand.operationId,operationId);assert.equal(basis.originalCommand.preparerId,actor.managerId);
 assert.equal(basis.authorityRevision,expectedRevision);assert.equal(basis.managerId,actor.managerId);assert.equal(basis.actor.manager_name,actor.managerName);
 const facts=approvedManualPeriodStaffingFacts({week,source:basis.normalSource,exceptions:basis.preparedExceptions,originalCommand:basis.originalCommand});
 return captureApprovedManualPeriodWorkerInput({schema:'custodial.approved-manual-period-worker-input.v1',source:basis.normalSource,
  ownerConfig:basis.ownerConfig,frameStart,changes:facts.changes,priorDays:basis.priorDayBases,acceptedExceptions:basis.preparedExceptions,
  priorProjection:basis.priorProjection,actor,expectedRevision,idempotencyKey:`staffing:${operationId}:${frameStart}`});
}

// Normalize only the owner-supplied canonical (or pending-preview) exceptions.
// status=accepted is mathematical input, not an approval source: the SQL owner
// rechecks the real ledger/command before accepting any result.
export function approvedManualPeriodStaffingFacts({week,source,exceptions,originalCommand=null}){
 const frame=source.serviceDate,dates=Array.from({length:7},(_,n)=>dateAt(frame,n)),days=new Map(),
  sourceSlots=new Map(source.slots.map(s=>[s.id,s])),ignoredOffDays=[];
 for(const e of exceptions){
  assertExceptionCommand(e);
  const c=originalCommand,b=c?.semanticBody,pending=c&&b?.commandKind==='absence'&&e.status===undefined
   &&e.id===`${c.operationId}:${e.serviceDate}`&&e.staffingAbsenceId===c.operationId&&e.actorId===c.preparerId
   &&e.expectedRevision===c.expectedRevision&&e.staffingAbsenceKind===b.absenceKind
   &&e.type===(b.absenceKind==='pto'?'pto':'daily_absence')&&e.serviceDate>=b.startDate&&e.serviceDate<=b.endDate
   &&e.idempotencyKey===`staffing:${c.operationId}:${e.serviceDate}`;
  assert.ok(e.status==='accepted'||pending,'Only actual accepted or exact owner-bound pending mathematics may enter preparation');
  assert.ok(dates.includes(e.serviceDate));
  const version=source.version||source.versions[0];assert.equal(e.baseVersionId,version.id);assert.equal(e.publicationId,version.publicationId);
  if(!days.has(e.serviceDate))days.set(e.serviceDate,{absent:new Set(),capacity:[],lunches:new Map(),factIds:[]});
  const state=days.get(e.serviceDate),weekday=new Date(e.serviceDate+'T12:00Z').getUTCDay();state.factIds.push(e.id);
  if(['pto','daily_absence'].includes(e.type)){
   if(e.window)fail('approved_manual_partial_window_requires_adjustment');
   const person=week.referenceBindings.people.find(p=>p.slotId===e.payload.slotId);
   if(!person)fail('approved_manual_absence_person_not_in_approved_source');
   if(pending&&person.employeeId!==b.employeeId)fail('approved_manual_pending_employee_changed');
   const scheduled=week.days.find(d=>d.weekday===weekday).employees.some(p=>p.name===person.approvedName);
   if(scheduled)state.absent.add(person.employeeId);else ignoredOffDays.push({serviceDate:e.serviceDate,employeeId:person.employeeId,factId:e.id});
  }else if(e.type==='cover_all'){
   const slot=sourceSlots.get(e.payload.availability.slotId);
   if(!slot||slot.kind!=='CONTRACTOR_CAPACITY')fail('approved_manual_typed_capacity_source_required');
   if(e.payload.availability.breakChoice==='NONE')fail('approved_manual_substitute_full_hour_lunch_required');
   state.capacity.push(e);
  }else if(e.type==='lunch'){
   if(state.lunches.has(e.payload.slotId))fail('approved_manual_duplicate_dated_lunch');
   state.lunches.set(e.payload.slotId,e);
  }else fail('approved_manual_unsupported_dated_exception_'+e.type);
 }
 const changes=[];
 for(const [serviceDate,state]of [...days].sort(([a],[b])=>a.localeCompare(b))){
  const absentPersonIds=[...state.absent].sort(),change={serviceDate,absentPersonIds};
  if(state.capacity.length>1)fail('approved_manual_explicit_single_substitute_required');
  if(state.capacity.length){
   if(absentPersonIds.length!==3)fail('approved_manual_capacity_needs_third_absence_basis');
   const e=state.capacity[0],a=e.payload.availability,lunch=state.lunches.get(a.slotId);
   if(!lunch?.window||!a.shift)fail('approved_manual_actual_capacity_hours_and_lunch_required');
   change.substitute={slotId:a.slotId,serviceDate,shift:clone(a.shift),lunch:clone(lunch.window),
    managerConfirmed:true,actualHoursConfirmed:true,confirmationReference:e.id};
  }
  for(const [slotId,lunch]of state.lunches){
   if(state.capacity.some(e=>e.payload.availability.slotId===slotId))continue;
   const normal=(source.version||source.versions[0]).slotAvailability.find(a=>a.slotId===slotId&&a.dayOfWeek===new Date(serviceDate+'T12:00Z').getUTCDay());
   if(!normal||digest(lunch.window)!==digest({start:normal.lunch.start,end:normal.lunch.end}))fail('approved_manual_employee_lunch_change_requires_explicit_plan');
  }
  if(absentPersonIds.length||state.capacity.length)changes.push(change);
 }
 return{changes,ignoredOffDays,factsDigest:digest(exceptions),publicationEligible:false};
}

// Translate verified native DATA into the existing twelve-field staffing
// transport and native lunch companion. No optimizer receipt or attestation
// is synthesized. The existing original request/confirmation remains owner.
export function approvedManualPendingStaffingTransport({workerInput,workerResult,basis}){
 const input=captureApprovedManualPeriodWorkerInput(workerInput),result=captureApprovedManualPeriodWorkerResult(workerResult,input),
  native=result.nativeProjection,command=basis.originalCommand;
 if(!native||result.period.status!=='COMPLETE_VALIDATED_DATED_DRAFTS')fail('approved_manual_dated_coverage_unresolved');
 assert.equal(basis.schema,'custodial.approved-manual-period-basis.v1');
 const {basisDigest,...basisBody}=basis;assert.equal(basisDigest,digest(basisBody));
 assert.ok(command?.operationId);assert.equal(command.preparerId,input.actor.managerId);
 assert.equal(command.expectedRevision,input.expectedRevision);assert.equal(basis.managerId,input.actor.managerId);
 assert.equal(basis.normalSourceDigest,digest(input.source));assert.equal(digest(basis.normalSource),digest(input.source));
 assert.equal(basis.frameStart,input.frameStart);assert.equal(basis.frameEnd,native.frameEnd);
 assert.equal(input.idempotencyKey,`staffing:${command.operationId}:${input.frameStart}`);
 const authority={...clone(native.authority),compilerInput:clone(input.source)},authorityDigest=digest(authority),
  lunch=clone(native.lunchDocument);
 delete lunch.document_identity;delete lunch.base_authority_digest;delete lunch.base_replay_digest;
 const replayDigest=digest({projectionAssignments:native.projectionAssignments,lunchDocument:lunch}),
  scopeDates=Array.from({length:7},(_,n)=>dateAt(input.frameStart,n)).filter(d=>d>=command.semanticBody.startDate&&d<=command.semanticBody.endDate),
  adapter={schema:'custodial.approved-manual-period-database-adapter.v1',version:'approved-manual-period-v1'},
  objective={contract:'OWNER_APPROVED_MANUAL_DATED_75_25_V2',formulaObjectiveDigest:result.period.formulaObjectiveDigest,
   proximityPercent:75,workloadPercent:25,normalDaysOptimized:false},
  metrics={hardConstraints:native.authority.hardConstraintCount,violations:0},
  envelope={adapter,service_date:input.frameStart,week_start:input.frameStart,week_end:native.frameEnd,authority,
   receipt:{schema:'custodial.approved-manual-native-feasibility-data.v1',nativePreparationDigest:native.projectionDataDigest,
    hardConstraintCount:native.authority.hardConstraintCount,hardConstraintDigest:native.authority.hardConstraintDigest,
    fixedWitnessDigest:native.authority.fixedWitnessDigest,selectionSolverInvoked:result.period.solverInvoked},
   authority_digest:authorityDigest,replay_digest:replayDigest,compiler_version:adapter.version,objective,metrics,
   applied_exceptions:clone(basis.preparedSummary),assignments:clone(native.projectionAssignments),
   semantic_snapshot:{schema:'custodial.approved-manual-pending-staffing-snapshot.v1',originalCommand:clone(command),
    originalSource:clone(basis.originalSource),scopeDates,weekStart:input.frameStart,generation:basis.generation,
    catalogEntryDigest:basis.catalogEntryDigest,nativeBasisDigest:basisDigest}};
 envelope.database_projection_identity=digest(envelope);
 const lunchDocument={...lunch,base_authority_digest:authorityDigest,base_replay_digest:replayDigest};
 lunchDocument.document_identity=digest(lunchDocument);
 return{publicationId:basis.publicationId,serviceDate:input.frameStart,exceptionSetDigest:digest(basis.preparedSummary),
  compilerVersion:adapter.version,objective,metrics,replayDigest,envelope,expectedRevision:input.expectedRevision,
  actorManagerId:input.actor.managerId,actorManagerName:input.actor.managerName,idempotencyKey:input.idempotencyKey,lunchDocument};
}
