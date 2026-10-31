// Fixed-period DATA/reference preparation only. No solver, source write or RPC.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJson} from './static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {prepareApprovedManualEmploymentAvailability} from './approved-manual-employment-admission.js';
const MANIFEST='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f';
const DAY=86400000,clone=structuredClone;
const uuid=v=>{assert.equal(typeof v,'string');assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);return v;};
const hash=v=>{assert.equal(typeof v,'string');assert.match(v,/^[a-f0-9]{64}$/);return v;};
const rev=v=>{assert.ok(Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER);return v;};
function date(v){assert.equal(typeof v,'string');assert.match(v,/^[12]\d{3}-\d{2}-\d{2}$/);assert.equal(new Date(v+'T12:00Z').toISOString().slice(0,10),v);return Date.parse(v+'T12:00Z');}
const dayDate=(start,weekday)=>new Date(date(start)+((weekday-new Date(date(start)).getUTCDay()+7)%7)*DAY).toISOString().slice(0,10);
export function approvedManualRecurringFrame(origin,serviceDate){
 const o=date(origin),d=date(serviceDate);assert.ok(d>=o,'Date precedes approved activation');
 const index=Math.floor((d-o)/(7*DAY)),frameStart=new Date(o+index*7*DAY).toISOString().slice(0,10);
 return {origin,periodIndex:index,frameStart,frameEnd:new Date(date(frameStart)+6*DAY).toISOString().slice(0,10)};
}
// Small component transposition; callers never pass/store the13MB feasibility.
// SQL derives the same rows privately, so client-generated DATA cannot authorize it.
export function repeatApprovedManualNormalRows({sourceId,origin,frameStart,assignments,projectionAvailability,lunchDocument,overlayCompilerInput}){
 uuid(sourceId);const f=approvedManualRecurringFrame(origin,frameStart);assert.equal(f.frameStart,frameStart);assert.ok(f.periodIndex>0);
 assert.ok(Array.isArray(assignments)&&assignments.length===346);assert.ok(Array.isArray(projectionAvailability));
 assert.equal(lunchDocument.loans.length,40);assert.equal(lunchDocument.week_start,origin);assert.ok(overlayCompilerInput&&overlayCompilerInput.serviceDate===origin);assert.deepEqual(overlayCompilerInput.exceptions,[]);
 const seen=new Set();for(const r of assignments){assert.ok(Number.isInteger(r.day_of_week)&&r.day_of_week>=0&&r.day_of_week<=6);
  assert.equal(r.service_date,dayDate(origin,r.day_of_week));assert.equal(r.status,'assigned');uuid(r.owner_person_id);
  assert.ok(!seen.has(r.plan_work_id));seen.add(r.plan_work_id);}
 const overlayInput={...clone(overlayCompilerInput),serviceDate:frameStart},overlayInputDigest=digest(overlayInput),
  nativeHash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex'),loanIds=new Map();
 const rows=assignments.map(r=>{const service_date=dayDate(frameStart,r.day_of_week);return {...clone(r),service_date,
  owner_digest:digest({planWorkId:r.plan_work_id,slotId:r.owner_slot_id,personId:r.owner_person_id,serviceDate:service_date}),
  exact_owner_identity:digest({plan_work_id:r.plan_work_id,service_date,optimized_owner_slot_id:r.owner_slot_id,
   optimized_owner_person_id:r.owner_person_id,baseline_owner_slot_id:r.baseline_owner_slot_id,baseline_owner_person_id:r.baseline_owner_person_id})};});
 const loans=lunchDocument.loans.map(r=>{assert.ok(Number.isInteger(r.day_of_week)&&r.day_of_week>=0&&r.day_of_week<=6);assert.equal(r.service_date,dayDate(origin,r.day_of_week));assert.ok(!loanIds.has(r.loan_id));
  const id=nativeHash({policy:'owner-20260921-two-nearby-full-hour-v1',input:overlayInputDigest,serviceDate:dayDate(frameStart,r.day_of_week),ownerSlotId:r.normal_owner_slot_id,start:r.coverage_start,end:r.coverage_end});loanIds.set(r.loan_id,id);return {...clone(r),loan_id:id,service_date:dayDate(frameStart,r.day_of_week)};});
 const responsibilities=lunchDocument.responsibilities.map(r=>{assert.ok(loanIds.has(r.loan_id));assert.equal(r.service_date,dayDate(origin,r.day_of_week));return {...clone(r),
  responsibility_id:nativeHash({loanId:loanIds.get(r.loan_id),areaId:nativeHash([...r.segments].sort((a,b)=>a.planWorkId<b.planWorkId?-1:a.planWorkId>b.planWorkId?1:0).map(s=>({work:s.planWorkId,start:Number(s.normalWindow.start.slice(0,2))*60+Number(s.normalWindow.start.slice(3)),end:Number(s.normalWindow.end.slice(0,2))*60+Number(s.normalWindow.end.slice(3))}))),covererSlotId:r.coverer_slot_id}),loan_id:loanIds.get(r.loan_id),service_date:dayDate(frameStart,r.day_of_week)};});
 const notification_intents=lunchDocument.notification_intents.map(r=>{assert.ok(loanIds.has(r.loan_id));const loan=lunchDocument.loans.find(l=>l.loan_id===r.loan_id);
  assert.equal(r.service_date,loan.service_date);return {...clone(r),notification_key:nativeHash({loanId:loanIds.get(r.loan_id),slot:r.coverer_slot_id,event:r.event}),loan_id:loanIds.get(r.loan_id),service_date:dayDate(frameStart,loan.day_of_week)};});
 return {frameStart,frameEnd:f.frameEnd,overlayInputDigest,assignments:rows,projectionAvailability:projectionAvailability.map(r=>{
  assert.equal(r.serviceDate,dayDate(origin,r.dayOfWeek));return {...clone(r),serviceDate:dayDate(frameStart,r.dayOfWeek)};}),
  loans,responsibilities,notification_intents,solverInvoked:false,normalSourceChanged:false,published:false};
}
// basis is an authenticated SAME-transaction native RPC read, never request JSON.
export function prepareApprovedManualRecurringPeriod({basis,serviceDate,expectedRevision,expectedGeneration,requestId}){
 assert.equal(basis.schema,'custodial.approved-manual-recurring-basis.v1');uuid(basis.managerId);uuid(basis.sourceId);uuid(basis.publicationId);uuid(basis.versionId);uuid(requestId);
 rev(expectedRevision);rev(expectedGeneration);assert.equal(basis.authorityRevision,expectedRevision);assert.equal(basis.generation,expectedGeneration);
 assert.equal(basis.manifestSha256,MANIFEST);for(const k of ['baselineSnapshotDigest','catalogEntryDigest','sourceProjectionIdentity','sourceLunchIdentity'])hash(basis[k]);
 const frame=approvedManualRecurringFrame(basis.origin,serviceDate);assert.ok(frame.periodIndex>0,'Initial frame belongs to original activation');
 assert.equal(basis.frameStart,frame.frameStart);assert.equal(basis.frameEnd,frame.frameEnd);assert.equal(basis.assignmentCount,346);assert.equal(basis.lunchCount,40);
 assert.ok(Array.isArray(basis.acceptedExceptions)&&basis.acceptedExceptions.length<=512);assert.equal(basis.participants.length,7);assert.equal(basis.employmentByDate.length,7);
 const reasons=clone(basis.adjustmentReasons);assert.ok(Array.isArray(reasons));
 if(basis.acceptedExceptions.length)reasons.push({kind:'ACCEPTED_EXCEPTIONS',exceptionIds:basis.acceptedExceptions.map(e=>e.id)});
 const employmentRevisionVector=[],days=new Set();
 for(const day of basis.participants){date(day.serviceDate);assert.ok(day.serviceDate>=frame.frameStart&&day.serviceDate<=frame.frameEnd);assert.ok(!days.has(day.serviceDate));days.add(day.serviceDate);
  for(const k of ['assignmentEmployeeIds','lunchOwnerEmployeeIds','lunchCovererEmployeeIds']){assert.ok(Array.isArray(day[k]));for(const id of day[k])uuid(id);}
  const reads=basis.employmentByDate.filter(r=>r.serviceDate===day.serviceDate);assert.equal(reads.length,1);
  const employment=prepareApprovedManualEmploymentAvailability({serviceDate:day.serviceDate,expectedAuthorityRevision:expectedRevision,acceptedRead:reads[0]});
  for(const employee of employment.employees){employmentRevisionVector.push({serviceDate:day.serviceDate,employeeId:employee.employeeId,
   employmentRevision:employee.employmentRevision,requestId:employee.requestId});
   if(!employee.actualCoverageEligible&&[...day.assignmentEmployeeIds,...day.lunchOwnerEmployeeIds,...day.lunchCovererEmployeeIds].includes(employee.employeeId))
    reasons.push({kind:'PRE_START_NOT_PTO',serviceDate:day.serviceDate,employeeId:employee.employeeId});
  }
 }
 assert.equal(days.size,7);employmentRevisionVector.sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)||a.employeeId.localeCompare(b.employeeId));
 if(reasons.length)return {schema:'custodial.approved-manual-recurring-decision.v1',status:'NEEDS_DATED_ADJUSTMENT',...frame,
  reasons,route:'SAME_NATIVE_APPROVED_MANUAL_DATED_OWNER_PATH',normalSourceChanged:false,solverInvoked:false,published:false,referenceEnvelope:null};
 if(basis.existingProjectionId!==null){uuid(basis.existingProjectionId);return {schema:'custodial.approved-manual-recurring-decision.v1',status:'ALREADY_MATERIALIZED',...frame,
  projectionId:basis.existingProjectionId,normalSourceChanged:false,solverInvoked:false,published:false,referenceEnvelope:null};}
 const referenceEnvelope={schema:'custodial.approved-manual-recurring-reference.v1',managerId:basis.managerId,requestId,
  sourceId:basis.sourceId,publicationId:basis.publicationId,versionId:basis.versionId,origin:basis.origin,frameStart:frame.frameStart,frameEnd:frame.frameEnd,
  expectedRevision,generation:expectedGeneration,baselineSnapshotDigest:basis.baselineSnapshotDigest,catalogEntryDigest:basis.catalogEntryDigest,
  sourceProjectionIdentity:basis.sourceProjectionIdentity,sourceLunchIdentity:basis.sourceLunchIdentity,employmentRevisionVector,
  exceptionSetDigest:digest(basis.acceptedExceptions)};
 return {schema:'custodial.approved-manual-recurring-decision.v1',status:'NORMAL_PERIOD_READY_DATA',...frame,referenceEnvelope,
  referenceDigest:digest(referenceEnvelope),normalSourceChanged:false,solverInvoked:false,published:false};
}
