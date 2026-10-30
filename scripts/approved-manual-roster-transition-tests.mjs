import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualRosterTransition} from '../src/approved-manual-roster-transition.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';

const bytes=fs.readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url));
assert.equal(bytes.length,12830);assert.equal(createHash('sha256').update(bytes).digest('hex'),'ba5147dfd345c20bad9acd5f403cf20aff40294109ed53e4d5b6c5c5c7f6fb0f');
const fixture=JSON.parse(bytes);assert.equal(fixture.classification,'RECORDED_READ_ONLY_FACTS_NOT_FRESH_AUTHORITY');
const snapshot=fixture.readback,week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 before=JSON.stringify({snapshot,draft}),prepare=(state=snapshot,at=state.serviceDate)=>prepareApprovedManualRosterTransition({week,draft,snapshot:state,effectiveStart:at}),
 result=prepare();
assert.equal(JSON.stringify({snapshot,draft}),before,'Preparing a transition must not change a captured range or original candidate');
assert.equal(result.status,'PREPARED_NOT_ADMITTED');assert.equal(result.expectedRevision,19);assert.equal(result.liveSlotCount,22);
assert.equal(result.transfers.length,4);assert.equal(result.transfers.filter(t=>t.closure).length,3);
assert.equal(result.unchanged.length,4);assert.equal(result.unreferencedSlotsToPreserve.length,5);
assert.deepEqual(result.parentPublication,snapshot.parentPublication);assert.equal(result.serviceDate,snapshot.serviceDate);
assert.deepEqual(result.projectedSourceDraft.version.assignments,draft.sourceDraft.version.assignments,'Every approved area, lunch boundary and departure owner must remain exact');
assert.deepEqual(result.projectedSourceDraft.version.lunchCoveragePolicy,draft.sourceDraft.version.lunchCoveragePolicy);
assert.deepEqual(result.projectedSourceDraft.version.manualGroupRatingAuthority,draft.sourceDraft.version.manualGroupRatingAuthority);
const wanted=new Map([['Derrick Henderson','Kaili Michaelson'],['Jada Rawlings','Tabitha Masterson'],['Kiltra Horton','Maurice Stanton'],['Xavier Green',null]]);
for(const change of result.transfers){
 assert.equal(change.closure?.displayName||null,wanted.get(change.employeeName));
 assert.equal(change.newEmployeeCreated,false);assert.equal(change.messengerPrincipalCreated,false);assert.equal(change.phoneAssignment,null);
 const live=snapshot.rosterSlots.find(s=>s.slotId===change.slotId),projected=result.projectedSourceDraft.slots.find(s=>s.id===change.slotId);
 assert.equal(projected.label,live.label);assert.equal(change.expectedLiveRangeDigest,digest(live));
 assert.equal(projected.incumbencies.length,live.incumbencies.length+1);
 for(const old of live.incumbencies){
  const copied=projected.incumbencies.find(r=>r.personId===old.personId&&r.effectiveStart===old.effectiveStart);assert.ok(copied);
  assert.equal(copied.displayName,old.displayName);
  assert.equal(copied.effectiveEnd,old.incumbencyId===change.closure?.incumbencyId?result.serviceDate:old.effectiveEnd);
 }
 const added=projected.incumbencies.find(r=>r.personId===change.employeeId&&r.effectiveStart===result.serviceDate);
 assert.ok(added);assert.equal(added.effectiveEnd,null);
}
const xavier=result.transfers.find(t=>t.employeeName==='Xavier Green'),slot=result.projectedSourceDraft.slots.find(s=>s.id===xavier.slotId);
assert.equal(slot.label,'Option 3 schedule position');assert.equal(slot.incumbencies.length,1);
assert.ok(!slot.incumbencies.some(i=>i.displayName==='Gregory Staples'),'Candidate-only Gregory history cannot enter a live transition');
for(const preserved of [...result.preservedReferencedSlots,...result.unreferencedSlotsToPreserve])
 assert.equal(preserved.liveRangeDigest,digest(snapshot.rosterSlots.find(s=>s.slotId===preserved.slotId)));
for(const key of ['initialBootstrap','historyRewrite','productionWritten','registrationEligible','publicationEligible','currentDateWeeklyAdmissionProven','formulaApproved'])assert.equal(result[key],false);
let refusals=0;
for(const change of [
 s=>{s.rosterSlots=s.rosterSlots.filter(r=>r.slotId!==xavier.slotId);},
 s=>{s.employees[0].active=false;},
 s=>{s.employees[0].hasMessenger=false;},
 s=>{s.employees[0].displayName='Wrong person';},
 s=>{s.employees[0].employeeCode='UNASSIGNED';},
 s=>{s.authorityRevision=-1;},
 s=>{s.parentPublication=null;},
 s=>{s.rosterSlots.find(r=>r.slotId===result.transfers[0].slotId).incumbencies[0].effectiveStart=s.serviceDate;},
 s=>{const other=s.rosterSlots.find(r=>result.unreferencedSlotsToPreserve.some(p=>p.slotId===r.slotId));
  other.incumbencies=[{incumbencyId:randomUUID(),personId:xavier.employeeId,displayName:xavier.employeeName,effectiveStart:s.serviceDate,effectiveEnd:null}];},
 s=>{const target=s.rosterSlots.find(r=>r.slotId===xavier.slotId);target.incumbencies=[{incumbencyId:randomUUID(),personId:xavier.employeeId,displayName:xavier.employeeName,effectiveStart:'2026-11-02',effectiveEnd:null}];},
 s=>{const target=s.rosterSlots.find(r=>r.slotId===result.transfers[0].slotId);target.incumbencies.push({...target.incumbencies[0],incumbencyId:randomUUID()});},
]){const changed=structuredClone(snapshot);change(changed);assert.throws(()=>prepare(changed));refusals++;}
for(const differentDate of ['2026-10-26','2026-10-30','2026-11-02']){assert.throws(()=>prepare(snapshot,differentDate));refusals++;}
// A captured completed target becomes DATA with zero new transfer proposals;
// this is not command replay authority or permission to resend an unknown write.
const completed=structuredClone(snapshot);
for(const change of result.transfers){const live=completed.rosterSlots.find(s=>s.slotId===change.slotId);
 if(change.closure)live.incumbencies.find(r=>r.incumbencyId===change.closure.incumbencyId).effectiveEnd=result.serviceDate;
 live.incumbencies.push({incumbencyId:randomUUID(),personId:change.employeeId,displayName:change.employeeName,effectiveStart:result.serviceDate,effectiveEnd:null});
}
const observedCompleted=prepare(completed);assert.equal(observedCompleted.transfers.length,0);assert.equal(observedCompleted.unchanged.length,8);
assert.equal(observedCompleted.publicationEligible,false);
console.log(JSON.stringify({status:'PASS',scope:'Recorded live roster DATA reconciliation and refusal behavior only; not atomic command, publication, SQL qualification or production activation',
 recordedOperationalDate:snapshot.serviceDate,livePositionsPreserved:22,projectedClosures:3,existingEmployeesAssigned:4,unchangedEmployees:4,
 unrelatedPositionsPreserved:5,hostileRefusals:refusals,productionWritten:false}));
