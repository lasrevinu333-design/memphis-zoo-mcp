import {validateApprovedManualCoverAllFacts,applyApprovedManualTypedCoverAllChanges} from './approved-manual-coverall-facts.js';
// Distinct recurring owner operation, on the caller's SAME checked transaction.
// No command/exception receipt is manufactured and no connection is acquired here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {readApprovedManualWeek} from './approved-manual-week.js';
import {approvedManualRecurringFrame,prepareApprovedManualRecurringPeriod} from './approved-manual-recurring-period.js';
import {approvedManualPeriodStaffingFacts,approvedManualNativeTransport} from './approved-manual-staffing-transport.js';
import {approvedManualEmploymentPeriod,approvedManualEmploymentChanges} from './approved-manual-employment-integration.js';
import {captureApprovedManualPeriodWorkerInput,captureApprovedManualPeriodWorkerResult} from './approved-manual-period-worker.js';
const clone=structuredClone,MANIFEST='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f';
const fail=(code,extra={})=>{throw Object.assign(new Error(code),{code,...extra});};
const uuid=v=>{assert.equal(typeof v,'string');assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);return v;};
const add=(s,n)=>new Date(Date.parse(s+'T12:00Z')+n*86400000).toISOString().slice(0,10);
export const isApprovedManualPublication=s=>s?.compiler_input?.version?.manualGroupRatingAuthority?.manifestSha256===MANIFEST;
export function approvedManualMaterializationFrame(source,date){
 assert.ok(isApprovedManualPublication(source));
 return approvedManualRecurringFrame(source.effective_start??source.compiler_input.version.effectiveStart,date).frameStart;
}
export function approvedManualRecurringOperationId(managerId,idempotencyKey){
 uuid(managerId);assert.equal(typeof idempotencyKey,'string');assert.ok(idempotencyKey.length>0&&idempotencyKey.length<=200&&idempotencyKey.trim()===idempotencyKey);
 const h=createHash('sha256').update('custodial.manual.recurring-operation.v1\0'+managerId+'\0'+idempotencyKey).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function approvedManualRecurringWorkerInput({basis,actor,operationId}){
 uuid(operationId);assert.equal(basis.schema,'custodial.approved-manual-period-basis.v1');assert.equal(basis.originalCommand,null);
 assert.equal(basis.managerId,actor.managerId);assert.equal(basis.actor.manager_name,actor.managerName);
 const {basisDigest,...body}=basis;assert.equal(basisDigest,digest(body));assert.equal(basis.normalSourceDigest,digest(basis.normalSource));
 const week=readApprovedManualWeek(),employment=approvedManualEmploymentPeriod({frameStart:basis.frameStart,expectedRevision:basis.authorityRevision,employmentByDate:basis.employmentByDate});
 assert.equal(digest(employment.revisionVector),digest(basis.employmentRevisionVector));
 // The capacity supplement remains an actual accepted fact. Union canonical
 // absence, PRE_START and actual roster unavailability BEFORE the third-owner rule.
 const typedFacts=validateApprovedManualCoverAllFacts({source:basis.normalSource,sourceId:basis.sourceId,exceptions:basis.preparedExceptions,
  selectedDays:basis.acceptedCoverAllDays,priorDays:basis.priorDayBases});
 const facts=approvedManualPeriodStaffingFacts({week,source:basis.normalSource,exceptions:typedFacts.legacyExceptions});
 const changes=approvedManualEmploymentChanges({week,changes:facts.changes,employment}),byDate=new Map(changes.map(c=>[c.serviceDate,c]));
 assert.ok(Array.isArray(basis.rosterUnavailableByDate));const seen=new Set();
 for(const r of basis.rosterUnavailableByDate){
  assert.deepEqual(Object.keys(r).sort(),['employeeId','serviceDate','slotId']);uuid(r.employeeId);uuid(r.slotId);
  assert.ok(r.serviceDate>=basis.frameStart&&r.serviceDate<=basis.frameEnd);const key=r.serviceDate+':'+r.slotId;assert.ok(!seen.has(key));seen.add(key);
  const slot=basis.normalSource.slots.find(s=>s.id===r.slotId),active=slot?.incumbencies.filter(i=>i.effectiveStart<=r.serviceDate&&(i.effectiveEnd==null||r.serviceDate<i.effectiveEnd));
  assert.equal(active?.length,1);assert.equal(active[0].personId,r.employeeId);
  const available=basis.normalSource.version.slotAvailability.find(a=>a.slotId===r.slotId&&a.dayOfWeek===new Date(r.serviceDate+'T12:00Z').getUTCDay());assert.equal(available?.status,'working');
  const change=byDate.get(r.serviceDate)||{serviceDate:r.serviceDate,absentPersonIds:[]};change.absentPersonIds=[...new Set([...change.absentPersonIds,r.employeeId])].sort();
  if(!byDate.has(r.serviceDate)){changes.push(change);byDate.set(r.serviceDate,change);}
 }
 assert.ok(Array.isArray(basis.acceptedCoverAllDays));const capacityDates=new Set();
 for(const day of basis.acceptedCoverAllDays){
  assert.ok(!capacityDates.has(day.serviceDate));capacityDates.add(day.serviceDate);
  const actual=basis.preparedExceptions.filter(e=>e.coverAllChoiceId===day.choiceId&&e.serviceDate===day.serviceDate);
  assert.equal(actual.filter(e=>e.type==='cover_all').length,1);assert.equal(actual.filter(e=>e.type==='lunch').length,1);
  const cap=actual.find(e=>e.type==='cover_all'),lunch=actual.find(e=>e.type==='lunch');assert.equal(cap.status,'accepted');assert.equal(lunch.status,'accepted');
  assert.equal(cap.payload.availability.slotId,day.capacityId);assert.deepEqual(cap.payload.availability.shift,day.shift);assert.deepEqual(lunch.window,day.lunch);
  const change=byDate.get(day.serviceDate);if(change?.absentPersonIds.length!==3)fail('approved_manual_recurring_accepted_coverall_basis_changed');
  change.substitute={slotId:day.capacityId,serviceDate:day.serviceDate,shift:clone(day.shift),lunch:clone(day.lunch),lunchCovererSlotId:day.lunchCovererSlotId,
   confirmationReference:day.confirmationReference,actualHoursConfirmed:true,managerConfirmed:true};
 }
 return captureApprovedManualPeriodWorkerInput({schema:'custodial.approved-manual-period-worker-input.v2',source:basis.normalSource,ownerConfig:basis.ownerConfig,
  frameStart:basis.frameStart,changes:applyApprovedManualTypedCoverAllChanges(changes,typedFacts).sort((a,b)=>a.serviceDate.localeCompare(b.serviceDate)),priorDays:basis.priorDayBases,acceptedExceptions:basis.preparedExceptions,
  priorProjection:basis.priorProjection,actor,expectedRevision:basis.authorityRevision,idempotencyKey:`manual-recurring:${operationId}`,employmentByDate:basis.employmentByDate});
}
export function approvedManualRecurringTransport({workerInput,workerResult,basis,operationId}){
 const input=captureApprovedManualPeriodWorkerInput(workerInput),result=captureApprovedManualPeriodWorkerResult(workerResult,input);
 assert.equal(digest(input),digest(approvedManualRecurringWorkerInput({basis,actor:input.actor,operationId})));
 if(!result.nativeProjection||result.period.status!=='COMPLETE_VALIDATED_DATED_DRAFTS'){
  const third=result.period.issues?.some(i=>String(i.reason??i.code??'').includes('THIRD_ABSENCE'));
  fail(third?'static_manual_coverall_choice_required':'approved_manual_recurring_actual_coverage_unresolved',{operationId,details:clone(result.period.issues??[])});
 }
 const recurringOperation={kind:'RECURRING_MANUAL_MATERIALIZATION',operationId,managerId:basis.managerId,sourceId:basis.sourceId,publicationId:basis.publicationId,
  versionId:basis.versionId,frameStart:basis.frameStart,frameEnd:basis.frameEnd,authorityRevision:basis.authorityRevision};
 return approvedManualNativeTransport({input,result,basis,semanticSnapshot:{schema:'custodial.approved-manual-recurring-adjustment-snapshot.v1',recurringOperation,
  originalSource:clone(basis.originalSource),scopeDates:Array.from({length:7},(_,n)=>add(input.frameStart,n)),weekStart:input.frameStart,
  generation:basis.generation,catalogEntryDigest:basis.catalogEntryDigest,nativeBasisDigest:basis.basisDigest}});
}
export async function materializeApprovedManualRecurringOnCurrentTransaction({client,call,manager,actor,publicationId,serviceDate,expectedRevision,idempotencyKey,prepareOperational}){
 assert.equal(typeof call,'function');assert.equal(typeof prepareOperational,'function');uuid(manager?.credential_id);
 assert.equal(manager.manager_id??manager.managerId,actor.managerId);assert.equal(typeof manager.device_id,'string');assert.ok(manager.device_id.length>0);
 assert.ok(['full_access','read_only'].includes(manager.access_level));
 const principal=digest(manager),operationId=approvedManualRecurringOperationId(actor.managerId,idempotencyKey),
  request={schema:'custodial.approved-manual-recurring-request.v1',kind:'RECURRING_MANUAL_MATERIALIZATION',operationId,managerId:actor.managerId,
   publicationId:uuid(publicationId),serviceDate,expectedRevision,idempotencyKey};
 const physical=(await client.query('select pg_backend_pid() as pid,pg_current_xact_id()::text as xid')).rows?.[0];
 assert.ok(Number.isSafeInteger(physical?.pid)&&physical.pid>0&&/^\d+$/.test(physical?.xid));
 const same=async()=>{const now=(await client.query('select pg_backend_pid() as pid,pg_current_xact_id()::text as xid')).rows?.[0];
  if(now?.pid!==physical.pid||now?.xid!==physical.xid||digest(manager)!==principal)fail('APPROVED_MANUAL_RECURRING_TRANSACTION_UNKNOWN',{operationId});};
 const credentials=[manager.credential_id,manager.device_id,manager.access_level];
 try{
  await same();const begun=await call(client,'static_weekly_begin_manual_recurring',[request,...credentials]);await same();
  if(begun?.state==='ORIGINAL_RECEIPT'){assert.equal(begun.operationId,operationId);return {...begun.receipt,replayed:true,currentReadbackRepeated:false};}
  assert.equal(begun.operationId,operationId);assert.equal(begun.backendPid,physical.pid);assert.equal(begun.transactionId,physical.xid);
  if(begun.state==='NORMAL_REFERENCE_REQUIRED'){
   const b=begun.repeatBasis;
   assert.equal(b.managerId,actor.managerId);assert.equal(b.publicationId,publicationId);assert.equal(b.authorityRevision,expectedRevision);assert.equal(b.frameStart,serviceDate);
   const decision=prepareApprovedManualRecurringPeriod({basis:b,serviceDate,expectedRevision,expectedGeneration:b.generation,requestId:operationId});
   assert.equal(decision.status,'NORMAL_PERIOD_READY_DATA');await same();
   const receipt=await call(client,'static_weekly_finish_manual_recurring_normal',[operationId,actor.managerId,decision.referenceEnvelope,decision.referenceDigest]);await same();return receipt;
  }
  assert.equal(begun.state,'NATIVE_ADJUSTMENT_REQUIRED');const basis=begun.basis;
  assert.equal(basis.publicationId,publicationId);assert.equal(basis.authorityRevision,expectedRevision);assert.equal(basis.frameStart,serviceDate);
  const input=approvedManualRecurringWorkerInput({basis,actor,operationId});
  const result=await prepareOperational(input);await same();const projection=approvedManualRecurringTransport({workerInput:input,workerResult:result,basis,operationId});
  const candidateDigest=digest({envelope:projection.envelope,lunch:projection.lunchDocument});
  const stage=await call(client,'static_weekly_stage_manual_recurring',[operationId,actor.managerId,projection.envelope,projection.lunchDocument]);await same();
  assert.equal(stage.state,'STAGED_UNCOMMITTED');assert.equal(stage.candidateDigest,candidateDigest);
  const receipt=await call(client,'static_weekly_finalize_manual_recurring',[operationId,actor.managerId,candidateDigest]);await same();return receipt;
 }catch(error){if(error&&typeof error==='object'){error.operationId=operationId;error.originalRecurringRequest=clone(request);}throw error;}
}
