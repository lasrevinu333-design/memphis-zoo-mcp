// Bounded application contract. This is deliberately separate from the
// seven-day SQL authority; an existing weekly adapter cannot implement it.
// No signer, production connection, automatic publication or phone receipt.
import assert from 'node:assert/strict';
import {postgresJsonbContentDigest as digest} from './static-weekly-schedule-program.js';
import {verifyStaticWeeklyScheduleResult} from './static-weekly-schedule-verifier.js';
import {createStaticWeeklyLunchCoverageCandidate} from './static-weekly-lunch-coverage.js';
import {createOctoberTransitionCandidate,compilerInput} from './static-weekly-october-transition-candidate.js';

export const DATED_TRANSITION_STORE_CONTRACT='custodial.dated-transition-store.v1';
export const OCTOBER_PHONE_PDF_REVISION='ee75f76a21e0d3a82291b8c720b5548532e1f168f1941a0cd74e80662302bd08';
export const OCTOBER_DATED_PLAN_DIGEST='89f600b965259f6bbf30488ff5eef2a6d754b3cbd0072f00419b318245e9459d';
const DATES=['2026-10-01','2026-10-02','2026-10-03','2026-10-04'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const copy=structuredClone;
const verifiedPlans=new WeakMap();
const fail=code=>Object.assign(new Error(code),{code});
const bind=body=>({...body,planDigest:digest(body)});
const validatePlan=plan=>{
 const {planDigest,...body}=plan||{};
 assert.equal(digest(body),planDigest,'bounded plan digest mismatch');
 assert.equal(body.schema,'custodial.dated-transition-materialization-plan.v1');
 assert.equal(body.phonePdfRevision,OCTOBER_PHONE_PDF_REVISION);
 assert.equal(body.effectiveStart,DATES[0]);assert.equal(body.effectiveEndExclusive,'2026-10-05');
 assert.deepEqual(body.days.map(d=>d.serviceDate),DATES);
 return body;
};

// Reverify the complete retained witness, not a shortened solver input.
// The four-day plan is a strict selection of the independently reviewed
// phone/PDF document. The document's immutable identity remains unchanged.
export function prepareOctoberDatedMaterialization({recurringPacket,transitionCandidate,document,compilerResult}){
 assert.deepEqual(transitionCandidate,createOctoberTransitionCandidate(recurringPacket));
 const {revision,...body}=document;
 assert.equal(revision,OCTOBER_PHONE_PDF_REVISION);assert.equal(digest(body),revision);
 assert.equal(document.transitionCandidateDigest,transitionCandidate.candidateDigest);
 assert.equal(document.recurringSourceDigest,recurringPacket.sourceDigest);
 const input=compilerInput(transitionCandidate.compilerInput);
 const verified=verifyStaticWeeklyScheduleResult(input,compilerResult);
 assert.equal(verified.ok,true,'complete transition compiler witness rejected');
 assert.equal(compilerResult.status,'FEASIBLE');assert.equal(compilerResult.publicationAuthority,'ACCEPTABLE');
 assert.equal(compilerResult.reviewWork.length,0);
 const lunch=createStaticWeeklyLunchCoverageCandidate(input,compilerResult);
 assert.equal(lunch.status,'PLANNED');assert.ok(lunch.lunches.every(l=>l.status==='PLANNED'&&!l.fallback));
 const proof=document.proofs.find(p=>p.phase==='dated_transition');
 assert.deepEqual([proof.sourceDigest,proof.authorityDigest,proof.replayDigest,proof.lunchDigest],
  [transitionCandidate.sourceDigest,compilerResult.authorityDigest,compilerResult.replayDigest,lunch.candidateDigest]);
 const days=copy(document.days.filter(d=>d.phase==='dated_transition'));
 assert.deepEqual(days.map(d=>d.serviceDate),DATES);
 for(const day of days){
  assert.deepEqual(day.assignments,compilerResult.weeklyAssignments.filter(a=>a.serviceDate===day.serviceDate));
  assert.deepEqual(day.availability,compilerResult.canonicalAuthority.projectionAvailability.filter(a=>a.serviceDate===day.serviceDate));
  assert.equal(day.weeklyVersionId,compilerResult.weeklyVersionId);
 }
 const open=days.flatMap(d=>d.assignments).filter(a=>a.status==='OPEN');
 assert.equal(open.length,1);assert.equal(open[0].serviceDate,'2026-10-02');
 assert.equal(open[0].workSnapshot.locationCodeSnapshot,'HERPETARIUM');
 assert.deepEqual(open[0].window,{start:'15:00',end:'16:00',startMinute:900,endMinute:960});assert.equal(open[0].personId,null);
 const plan=bind({schema:'custodial.dated-transition-materialization-plan.v1',
  classification:'PREPARED_LOCAL_NOT_SQL_AUTHORITY',phonePdfRevision:revision,
  effectiveStart:DATES[0],effectiveEndExclusive:'2026-10-05',
  transitionSourceDigest:transitionCandidate.sourceDigest,recurringSourceDigest:recurringPacket.sourceDigest,
  completeWitness:{start:DATES[0],end:'2026-10-07',authorityDigest:compilerResult.authorityDigest,
   replayDigest:compilerResult.replayDigest,lunchDigest:lunch.candidateDigest},
  rosterSlots:copy(document.rosterSlots),days,
  acceptedExceptions:[{serviceDate:'2026-10-02',locationCode:'HERPETARIUM',start:'15:00',end:'16:00',
   status:'OPEN',personId:null,ownerQuote:'We will just leave it open.'}],
  productionWritten:false,phoneDeliveryState:'PENDING'});
 verifiedPlans.set(plan,plan.planDigest);
 return plan;
}

function actor(manager){
 if(!UUID.test(manager?.managerId||''))throw fail('dated_transition_named_manager_required');
 return manager.managerId.toLowerCase();
}
function revision(value){if(!Number.isSafeInteger(value)||value<0)throw fail('dated_transition_revision_required');return value;}
function key(value){if(typeof value!=='string'||!value.trim()||value.length>200)throw fail('dated_transition_idempotency_key_required');return value;}
function previewBinding(plan,managerId,state){
 return digest({planDigest:plan.planDigest,managerId,authorityRevision:state.authorityRevision,
  dependencyDigest:state.dependencyDigest});
}
function validateSnapshot(state,managerId,plan){
 if(state?.authorizedManagerId!==managerId)throw fail('dated_transition_manager_not_authorized');
 revision(state.authorityRevision);
 if(typeof state.hasExistingOccurrences!=='boolean')throw fail('dated_transition_occurrence_state_required');
 if(!/^[a-f0-9]{64}$/.test(state.dependencyDigest||''))throw fail('dated_transition_dependency_identity_required');
 // The adapter must read current incumbents, vacancies and their availability
 // under the same lock; a label-only or partial roster is insufficient.
 assert.deepEqual(state.rosterSlots,plan.rosterSlots,'dated transition current roster mismatch');
 assert.deepEqual(state.approvedAvailability,plan.days.map(d=>({serviceDate:d.serviceDate,availability:d.availability})),
  'dated transition current availability mismatch');
}
function validateRecord(record,plan){
 if(record?.persistenceStatus!=='PERSISTED'||!UUID.test(record.publicationId||'')||!UUID.test(record.projectionId||'')
  ||record.planDigest!==plan.planDigest||record.phonePdfRevision!==plan.phonePdfRevision)
  throw fail('dated_transition_persisted_identity_mismatch');
 assert.deepEqual(record.days,plan.days,'dated transition persisted rows mismatch');
}
const unavailable=()=>{throw fail('dated_transition_store_unavailable_requires_bounded_database_adapter');};

// Runtime may load only this exact immutable plan prepared and fully verified
// offline. It cannot accept an arbitrary serialized/rehashed candidate.
export function loadPreparedOctoberDatedPlan(value){
 const plan=copy(value);validatePlan(plan);
 if(plan.planDigest!==OCTOBER_DATED_PLAN_DIGEST)throw fail('dated_transition_unapproved_plan_identity');
 verifiedPlans.set(plan,plan.planDigest);return plan;
}

/**
 * The injected store is a server authority, not a client cache. It must provide
 * transaction(work): commit atomically, roll back errors, hold the existing
 * scheduler authority lock, and reauthorize every manager in tx.snapshot().
 * tx: snapshot(managerId,start,end), receipt(managerId,key), stage(plan),
 * readStaged(), finalize(request,record), current(planDigest),
 * appendRollback(request,record), readCurrentDay(serviceDate).
 * finalize atomically advances authority revision and records the immutable
 * receipt. stage may write only the exclusive four-day range and must refuse
 * any existing/protected occurrences. appendRollback preserves all history
 * and protected work; it deactivates only this exact current publication.
 * PostgreSQL's existing v3 weekly mutators do NOT satisfy this interface.
 */
export function createOctoberDatedMaterializationController({plan,store}={}){
 if(!plan||verifiedPlans.get(plan)!==plan.planDigest)throw fail('dated_transition_reverified_plan_required');
 const fixed=copy(plan);validatePlan(fixed);
 if(store?.contract!==DATED_TRANSITION_STORE_CONTRACT||typeof store.transaction!=='function'){
  return {preview:unavailable,confirm:unavailable,status:unavailable,rollback:unavailable,readDay:unavailable};
 }
 function request(manager,expectedRevision,idempotencyKey,previewDigest,operation='materialize'){
  return {operation,managerId:actor(manager),expectedRevision:revision(expectedRevision),
   idempotencyKey:key(idempotencyKey),planDigest:fixed.planDigest,phonePdfRevision:fixed.phonePdfRevision,previewDigest};
 }
 async function replay(tx,requested){
  const prior=await tx.receipt(requested.managerId,requested.idempotencyKey);
  if(!prior)return null;
  assert.deepEqual(prior.request,requested,'dated transition idempotency conflict');
  const current=await tx.current(fixed.planDigest);
  return {...copy(prior.response),replayed:true,effectivePublicationCurrent:requested.operation==='materialize'
   &&current?.publicationId===prior.response.publicationId&&current?.projectionId===prior.response.projectionId};
 }
 return {
  async preview({manager,expectedRevision}){
   const managerId=actor(manager),expected=revision(expectedRevision);
   return store.transaction(async tx=>{
    const state=await tx.snapshot(managerId,fixed.effectiveStart,fixed.effectiveEndExclusive);
    validateSnapshot(state,managerId,fixed);
    if(state.authorityRevision!==expected)throw fail('dated_transition_revision_conflict');
    if(state.hasExistingOccurrences===true)throw fail('dated_transition_existing_occurrences_require_reconciliation');
    return {planDigest:fixed.planDigest,phonePdfRevision:fixed.phonePdfRevision,
     previewDigest:previewBinding(fixed,managerId,state),expectedRevision:expected,
     effectiveStart:fixed.effectiveStart,effectiveEndExclusive:fixed.effectiveEndExclusive,
     days:copy(fixed.days),published:false,phoneDeliveryState:'PENDING'};
   });
  },
  async confirm({manager,expectedRevision,idempotencyKey,previewDigest}){
   const requested=request(manager,expectedRevision,idempotencyKey,previewDigest);
   return store.transaction(async tx=>{
    const state=await tx.snapshot(requested.managerId,fixed.effectiveStart,fixed.effectiveEndExclusive);
    validateSnapshot(state,requested.managerId,fixed);
    const prior=await replay(tx,requested);if(prior)return prior;
    if(state.authorityRevision!==requested.expectedRevision)throw fail('dated_transition_revision_conflict');
    if(previewDigest!==previewBinding(fixed,requested.managerId,state))throw fail('dated_transition_preview_mismatch');
    if(state.hasExistingOccurrences===true)throw fail('dated_transition_existing_occurrences_require_reconciliation');
    await tx.stage(copy(fixed));
    const record=await tx.readStaged();validateRecord(record,fixed);
    const response=await tx.finalize(copy(requested),copy(record));
    if(response?.revision!==requested.expectedRevision+1||response.phoneDeliveryState!=='PENDING'
     ||response.affectedPhonesUpdated!==false||response.publicationId!==record.publicationId
     ||response.projectionId!==record.projectionId||response.planDigest!==fixed.planDigest
     ||response.phonePdfRevision!==fixed.phonePdfRevision)throw fail('dated_transition_completion_receipt_mismatch');
    return copy(response);
   });
  },
  async status({manager,idempotencyKey}){
   const managerId=actor(manager),operationKey=key(idempotencyKey);
   return store.transaction(async tx=>{
    const state=await tx.snapshot(managerId,fixed.effectiveStart,fixed.effectiveEndExclusive,true);
    if(state?.authorizedManagerId!==managerId)throw fail('dated_transition_manager_not_authorized');
    const receipt=await tx.receipt(managerId,operationKey);
    const current=await tx.current(fixed.planDigest);
    return receipt?{operationReceipt:copy(receipt.response),effectivePublicationCurrent:
     current?.publicationId===receipt.response.publicationId&&current?.projectionId===receipt.response.projectionId,
     phoneDeliveryState:'PENDING'}:{state:'NOT_FOUND',phoneDeliveryState:'PENDING'};
   });
  },
  async rollback({manager,expectedRevision,idempotencyKey,publicationId,projectionId}){
   const requested={...request(manager,expectedRevision,idempotencyKey,null,'rollback'),publicationId,projectionId};
   return store.transaction(async tx=>{
    const state=await tx.snapshot(requested.managerId,fixed.effectiveStart,fixed.effectiveEndExclusive,true);
    if(state?.authorizedManagerId!==requested.managerId)throw fail('dated_transition_manager_not_authorized');
    const prior=await replay(tx,requested);if(prior)return prior;
    if(state.authorityRevision!==requested.expectedRevision)throw fail('dated_transition_revision_conflict');
    const current=await tx.current(fixed.planDigest);validateRecord(current,fixed);
    if(current.publicationId!==publicationId||current.projectionId!==projectionId)
     throw fail('dated_transition_rollback_identity_mismatch');
    const response=await tx.appendRollback(copy(requested),copy(current));
    if(response?.state!=='ROLLED_BACK'||response.revision!==requested.expectedRevision+1
     ||response.phoneDeliveryState!=='PENDING'||response.affectedPhonesUpdated!==false
     ||response.planDigest!==fixed.planDigest||await tx.current(fixed.planDigest)!==null)
     throw fail('dated_transition_rollback_receipt_mismatch');
    return copy(response);
   });
  },
  async readDay(serviceDate){
   if(!DATES.includes(serviceDate))throw fail('dated_transition_outside_exclusive_range');
   return store.transaction(async tx=>{
    const current=await tx.current(fixed.planDigest);if(!current)return null;
    validateRecord(current,fixed);
    const day=await tx.readCurrentDay(serviceDate);
    assert.deepEqual(day,fixed.days.find(d=>d.serviceDate===serviceDate),'dated transition readback mismatch');
    return {day:copy(day),publicationId:current.publicationId,projectionId:current.projectionId,
     planDigest:fixed.planDigest,phonePdfRevision:fixed.phonePdfRevision};
   });
  },
 };
}
