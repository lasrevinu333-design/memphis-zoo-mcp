import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';
import {validateApprovedManualBindings} from '../src/approved-manual-bindings.js';
import {prepareApprovedManualCompilerData} from '../src/approved-manual-compiler-data.js';
import {validateFullHourLunchPolicy} from '../src/static-weekly-lunch-policy.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {validateApprovedManualPolicyDelta} from '../src/approved-manual-policy-delta.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {splitPreservedWorkloadBudget} from '../src/static-weekly-shift-end-coverage.js';
import {prepareStaticWeeklySchedulingProblem} from '../src/static-weekly-schedule-program.js';

const week=readApprovedManualWeek(),pointByGroup=new Map(week.ratings.map(r=>[r.group,r.score]));
const compilerData=prepareApprovedManualCompilerData(week),nativeLunches=validateFullHourLunchPolicy(compilerData.lunchCoveragePolicy,postgresJsonbContentDigest);
assert.equal(nativeLunches.size,40);assert.equal(compilerData.availabilityInputs.length,40);
assert.equal(compilerData.assignmentInputs.length,346);assert.equal(compilerData.groupRatingAuthority.groups.length,23);
assert.equal(compilerData.groupRatingAuthority.groups.reduce((n,g)=>n+g.score,0),136);
assert.equal(compilerData.groupRatingAuthority.legacyComponentWeightsReplaced,false);
assert.equal(compilerData.canonicalCompilerInput,null);assert.equal(compilerData.registrationEligible,false);
assert.equal(compilerData.effectiveStart,null);assert.equal(compilerData.sourceId,null);
assert.equal(compilerData.completeCanonicalSource,false);
assert.deepEqual(compilerData.unresolvedLegacyDuties,[]);
assert.deepEqual(compilerData.excludedLegacyDuties,['ELEPHANT_TRUNK_RESTROOMS']);
assert.equal(compilerData.policy0945,'OWNER_APPROVED_NO_CHANGEOVER');
assert.equal(week.activation.ownerApproved,true);
assert.deepEqual(week.activation.unresolvedPolicies,['prearrival_ownership']);
assert.ok(!compilerData.groupRatingAuthority.groups.some(g=>g.locationCode==='ELEPHANT_TRUNK_RESTROOMS'));
assert.ok(!compilerData.assignmentInputs.some(g=>g.locationCodeSnapshot==='ELEPHANT_TRUNK_RESTROOMS'));
assert.ok(!compilerData.lunchCoveragePolicy.loans.some(l=>l.areas.some(a=>a.locationCode==='ELEPHANT_TRUNK_RESTROOMS')));
const tampered=structuredClone(week);tampered.days[0].employees[0].baseGroups=[];
assert.throws(()=>prepareApprovedManualCompilerData(tampered),/changed after intake/);
assert.throws(()=>compilerData.assignmentInputs[0].window.start='05:00');
assert.deepEqual(week.days.map(d=>d.employees.length),[7,6,5,5,6,6,5]);
assert.equal(week.days.reduce((n,d)=>n+d.lunches.length,0),40);
assert.equal(week.ratings.reduce((n,r)=>n+r.score,0),136);
assert.equal(pointByGroup.get('Bonobos restrooms'),8);
assert.deepEqual(week.objective,{proximityPercent:75,loadPercent:25,normalizedFormula:null,formulaApproved:false});
assert.equal(week.runtimeBinding.registeredSourceId,null);
assert.equal(week.runtimeBinding.state,'CANDIDATE_REFERENCES_ONLY_NOT_REGISTERED');
assert.equal(week.referenceBindings.people.length,8);assert.equal(week.referenceBindings.groups.length,23);
assert.equal(week.referenceBindings.approvedEducationScope.classroom_count,4);
assert.equal(week.activation.published,false);assert.equal(week.receiptEligible,false);
assert.throws(()=>week.days[0].employees[0].baseGroups.push('invented'));
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
let minuteSamples=0,ownerSamples=0,reliefSamples=0,compilerOwnerSamples=0;
for(const day of week.days){
  for(let n=minute(day.checkedWindow.start);n<minute(day.checkedWindow.end);n++){
    const view=previewApprovedManualDay(week,{day:day.day,time:clock(n)});
    assert.equal(view.owners.length,23);assert.equal(new Set(view.owners.map(o=>o.group)).size,23);
    assert.equal(view.status,'APPROVED_PLANNING_PREVIEW_ONLY');assert.equal(view.published,false);assert.equal(view.receiptEligible,false);
    assert.equal(view.owners.reduce((s,o)=>s+pointByGroup.get(o.group),0),136);
    for(const owner of view.owners){
      const person=week.referenceBindings.people.find(p=>p.approvedName===owner.employee),group=week.referenceBindings.groups.find(g=>g.approvedGroup===owner.group);
      assert.equal(owner.employeeId,person.employeeId);assert.equal(owner.slotId,person.slotId);
      assert.equal(owner.locationId,group.primaryLocationId);assert.equal(owner.locationCode,group.referenceCode);
    }
    // Reconstruct the native field-name fragments using the real policy
    // validator's Map, then compare to the independently selected day view.
    const fragments=compilerData.assignmentInputs.filter(r=>r.dayOfWeek===day.weekday&&r.window.start<=clock(n)&&clock(n)<r.window.end);
    assert.equal(fragments.length,23);assert.equal(new Set(fragments.map(r=>r.locationId)).size,23);
    for(const row of fragments){
      const loan=nativeLunches.get(`${day.weekday}\0${row.ownerSlotId}`),
        covered=loan&&loan.window.start<=clock(n)&&clock(n)<loan.window.end,
        slot=covered?loan.areas.get(row.locationCodeSnapshot):row.ownerSlotId;
      assert.ok(slot,'Whole-hour native policy omitted a current area');
      assert.equal(slot,view.owners.find(o=>o.locationId===row.locationId).slotId);
      compilerOwnerSamples++;
    }
    for(const loan of day.lunches.filter(l=>minute(l.start)<=n&&n<minute(l.end))){
      for(const group of loan.groups){const owner=view.owners.find(o=>o.group===group);assert.equal(owner.employee,loan.coverer);assert.equal(owner.reason,'FULL_HOUR_LUNCH_RELIEF');reliefSamples++;}
      assert.ok(!view.owners.some(o=>o.employee===loan.recipient));
    }
    const remaining=day.employees.filter(p=>minute(p.shift.start)<=n&&n<minute(p.shift.end));
    assert.equal(view.zooWideCoverage,remaining.length===1);
    assert.equal(view.createsMandatoryInheritedCleaningRoutes,false);
    minuteSamples++;ownerSamples+=view.owners.length;
  }
  assert.equal(previewApprovedManualDay(week,{day:day.day,time:'05:00'}).status,'PREARRIVAL_POLICY_UNRESOLVED');
  assert.deepEqual(previewApprovedManualDay(week,{day:day.day,time:day.checkedWindow.end}).owners,[]);
}
const phase=(day,time)=>week.days.find(d=>d.day===day).phases.find(p=>p.start===time);
assert.deepEqual(phase('friday','15:00').points,{'Kiltra Horton':67,'Alijah Collins':69});
assert.deepEqual(phase('saturday','15:00').points,{'Alijah Collins':45,'Kiltra Horton':52,'Xavier Green':39});
assert.deepEqual(phase('sunday','15:00').points,{'Alijah Collins':36,'Kiltra Horton':35,'Derrick Henderson':36,'Xavier Green':29});
for(const day of ['thursday','friday'])assert.equal(previewApprovedManualDay(week,{day,time:'16:00'}).status,'OUTSIDE_STAFFED_COVERAGE');
assert.equal(previewApprovedManualDay(week,{day:'monday',time:'09:45'}).owners.find(o=>o.group==='Zambezi and restrooms').employee,'Alijah Collins');
assert.throws(()=>previewApprovedManualDay(week,{day:'monday',serviceDate:'2026-11-03',time:'10:00'}),/weekday differs/);
for(const d of week.days)assert.equal(d.policy0945,'OWNER_APPROVED_NO_CHANGEOVER');
const delta=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/policy-delta.json',import.meta.url)));
for(const change of [d=>{d.policy.elephant_trunk.status='Create an engine duty';},d=>{d.policy.elephant_trunk.excluded_from=[];},
  d=>{d.policy.global_0945.status='Monday only';},d=>{d.base_snapshot.zip_sha256='0'.repeat(64);}]){
  const invalid=structuredClone(delta);change(invalid);assert.throws(()=>validateApprovedManualPolicyDelta(invalid,week));
}

const reference=JSON.parse(readFileSync(new URL('../release/static-schedules/custodial-eight-20261102-registration.json',import.meta.url))),
  binding=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/reference-bindings.json',import.meta.url))),
  ratings=JSON.parse(readFileSync(new URL('../config/schedules/manual-approved-20261030/packet/sources/custodial_area_group_scoring_draft_20261029.json',import.meta.url))),
  manual={manifestSha256:week.manifestSha256,days:week.days,ratings:week.ratings,educationScope:ratings.education_scope};
let rejectedBindings=0;
function rejectBinding(change){const invalid=structuredClone(binding);change(invalid);
  assert.throws(()=>validateApprovedManualBindings({binding:invalid,reference,referenceSha256:binding.reference.sha256,manual}));rejectedBindings++;}
rejectBinding(b=>{b.people[0].employeeId=b.people[1].employeeId;});
rejectBinding(b=>{[b.people[0].employeeId,b.people[1].employeeId]=[b.people[1].employeeId,b.people[0].employeeId];});
rejectBinding(b=>{b.people[0].slotId=b.people[1].slotId;});
rejectBinding(b=>{b.people.pop();});
rejectBinding(b=>{b.people[0].referenceEffectiveStart='2026-11-09';});
rejectBinding(b=>{b.groups.find(g=>g.includedLocations.length>1).includedLocations.pop();});
rejectBinding(b=>{b.groups[0].primaryLocationId=b.groups[1].primaryLocationId;});
rejectBinding(b=>{b.groups[0].retainedServiceModes=['response_only_no_clean'];});
rejectBinding(b=>{b.unresolvedLegacyDuties[0].approvedOwner=b.people[0].employeeId;});
rejectBinding(b=>{b.approvedEducationScope={};});
rejectBinding(b=>{b.canonicalRegistrationSource=true;});
rejectBinding(b=>{b.productionPublished=true;});
assert.equal(reference.ownerConfig.weights.BONOBOS_RESTROOMS,2,'Retained component weights must stay separate from the new group rating');
assert.equal(binding.unresolvedLegacyDuties[0].score,null);

const referenceBytes=readFileSync(new URL('../release/static-schedules/custodial-eight-20261102-registration.json',import.meta.url)),
  referenceBefore=Buffer.from(referenceBytes),weekBefore=JSON.stringify(week),
  sourceDraft=prepareApprovedManualSourceDraft({week,referenceBytes}),draft=sourceDraft.sourceDraft;
assert.equal(draft.version.assignments.length,346);assert.equal(draft.version.slotAvailability.length,40);
assert.equal(sourceDraft.budgetBindings.length,161);assert.equal(sourceDraft.restrictionConflicts.length,1);
assert.equal(sourceDraft.restrictionConflicts[0].coveragePurpose,'INHERITED_ALERTS_AND_ISSUES_ONLY');
assert.equal(sourceDraft.restrictionConflicts[0].dayOfWeek,5);
assert.equal(sourceDraft.restrictionConflicts[0].locationCode,'HERPETARIUM');
assert.deepEqual(sourceDraft.restrictionConflicts[0].window,{start:'15:00',end:'16:00'});
assert.equal(sourceDraft.registrationEligible,false);assert.equal(sourceDraft.activationApprovalRecorded,true);
assert.equal(draft.serviceDate,null);assert.equal(draft.version.effectiveStart,null);assert.equal(draft.version.id,null);
assert.equal(Object.hasOwn(draft.version,'shiftEndContinuityPolicy'),false,'Old 09:45 derivation must not reappear in the new fixed source');
assert.ok(!draft.version.assignments.some(r=>r.locationCodeSnapshot==='ELEPHANT_TRUNK_RESTROOMS'));
for(const budget of sourceDraft.budgetBindings){
  assert.equal(budget.retainedWork.reduce((n,r)=>n+r.value,0),budget.budget);
  assert.equal(budget.segments.reduce((n,r)=>n+r.value,0),budget.budget);
  assert.ok(budget.segments.every(r=>Number.isSafeInteger(r.value)&&r.value>0));
  assert.equal(budget.newGroupRatingUsedAsBudget,false);
}
for(const row of draft.version.assignments){
  const fragment=compilerData.assignmentInputs.find(r=>r.workId===row.workId);
  assert.equal(row.ownerSlotId,fragment.ownerSlotId);assert.deepEqual(row.window,fragment.window);
  assert.equal(row.manualBaseOwnerSlotId,fragment.originSlotId);assert.equal(row.originSlotId,row.ownerSlotId);
  assert.deepEqual(row.includedLocations,fragment.includedLocations);
}
for(const row of draft.version.slotAvailability){
  const retained=reference.template.source.version.slotAvailability.find(r=>r.slotId===row.slotId&&r.dayOfWeek===row.dayOfWeek);
  assert.equal(row.maxServiceEffortMinutes,retained.maxServiceEffortMinutes);
  assert.deepEqual(row.qualifications,retained.qualifications);assert.deepEqual(row.restrictions,retained.restrictions);
  assert.equal(row.maxDutyMinutes,minute(row.shift.end)-minute(row.shift.start)-60);
}
const attempted=structuredClone(draft);attempted.serviceDate='2026-11-02';attempted.versions=[attempted.version];delete attempted.version;
assert.equal(prepareStaticWeeklySchedulingProblem(attempted).error.code,'candidate_workbook_evidence_not_publishable');
assert.throws(()=>prepareApprovedManualSourceDraft({week,referenceBytes:Buffer.concat([referenceBytes,Buffer.from(' ')])}));
assert.deepEqual(referenceBytes,referenceBefore);assert.equal(JSON.stringify(week),weekBefore);
assert.deepEqual(splitPreservedWorkloadBudget(10,[{start:'08:00',end:'09:00'},{start:'09:00',end:'10:00'},{start:'10:00',end:'11:00'}]),[4,3,3]);
assert.throws(()=>splitPreservedWorkloadBudget(1,[{start:'08:00',end:'09:00'},{start:'09:00',end:'10:00'}]));

const root=mkdtempSync(join(tmpdir(),'custodial-manual-packet-test-'));
try{
  const original=fileURLToPath(new URL('../config/schedules/manual-approved-20261030/',import.meta.url)),copy=join(root,'copy');
  cpSync(original,copy,{recursive:true});const catalogPath=join(copy,'catalog.json');
  const source=join(copy,'packet/sources/custodial_manual_monday_working_draft.json'),bytes=readFileSync(source);
  writeFileSync(source,Buffer.concat([bytes,Buffer.from(' ')]));
  assert.throws(()=>readApprovedManualWeek({catalogPath}),/Packet length changed/);writeFileSync(source,bytes);
  const catalog=JSON.parse(readFileSync(catalogPath));catalog.publication.published=true;writeFileSync(catalogPath,JSON.stringify(catalog));
  assert.throws(()=>readApprovedManualWeek({catalogPath}));catalog.publication.published=false;
  catalog.unresolvedPolicies=[];writeFileSync(catalogPath,JSON.stringify(catalog));assert.throws(()=>readApprovedManualWeek({catalogPath}));
}finally{rmSync(root,{recursive:true});}
console.log(JSON.stringify({marker:'APPROVED_MANUAL_WEEK_DATA_PASS',days:7,groups:23,fullHourReliefs:40,minuteSamples,ownerSamples,reliefSamples,
  candidateEmployeeReferences:8,rejectedBindings,compilerAssignmentFragments:compilerData.assignmentInputs.length,compilerOwnerSamples,
  nativeFullHourPolicyValidated:true,sourceWorkloadBudgetsPreserved:161,sourceDraftRestrictionConflicts:1,
  sourceDraftFeasibilityQualified:false,activationOwnerApproved:true,activation:'HELD',published:false,engineRecalculationQualified:false,physicalAcceptance:false}));
