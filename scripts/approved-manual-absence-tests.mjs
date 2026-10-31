import {withApprovedManualFixtureCapacities} from './fixtures/approved-manual-capacity-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualAbsenceDay,solveApprovedManualAbsenceAdjustment,validateApprovedManualAbsenceProposal,applyApprovedManualCoverAllSubstitute} from '../src/approved-manual-absence.js';

const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 capacityFixtureSource=withApprovedManualFixtureCapacities(draft.sourceDraft),
 proposal=JSON.parse(fs.readFileSync(new URL('../config/schedules/manual-approved-20261030/absence-objective-proposal.json',import.meta.url))),
 id=name=>week.referenceBindings.people.find(p=>p.approvedName.startsWith(name+' ')).employeeId,
 input=(serviceDate,names)=>prepareApprovedManualAbsenceDay({week,source:capacityFixtureSource,ownerConfig:draft.ownerConfig,
  serviceDate,absentPersonIds:names.map(id)});
const args=process.argv.slice(2);assert.ok(!args.length||(args.length===2&&args[0]==='--evidence-dir'&&isAbsolute(args[1])));
const evidence=args.length?args[1]:null;
const save=(name,value)=>{if(evidence)fs.writeFileSync(resolve(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});};
if(evidence){
 fs.mkdirSync(evidence,{mode:0o700});
 const files=['src/approved-manual-absence.js','src/approved-manual-gps.js','scripts/approved-manual-absence-tests.mjs',
  'config/schedules/manual-approved-20261030/gps-reference-20261030.json','config/schedules/manual-approved-20261030/absence-objective-proposal.json'];
 save('INTENT.json',{startedAt:new Date().toISOString(),scope:'OWNER_APPROVED_FORMULA_LOCAL_DATED_DRAFTS_ONLY',
  files:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex')})),
  productionWritten:false,publicationEligible:false,physicalAcceptance:false});
}
const lockedWeek=JSON.stringify(week),lockedSource=JSON.stringify(draft.sourceDraft),lockedConfig=JSON.stringify(draft.ownerConfig),lockedCapacityFixture=JSON.stringify(capacityFixtureSource);
for(let date=2;date<=8;date++){
 const unchanged=input(`2026-11-0${date}`,[]);assert.equal(unchanged.status,'UNCHANGED_APPROVED_DAY');
 assert.deepEqual(unchanged.day,week.days.find(d=>d.weekday===new Date(`2026-11-0${date}T12:00Z`).getUTCDay()));
 assert.equal(unchanged.solverInvoked,false);
}
const third=input('2026-11-02',['Tammy','Karen','Jada']);assert.equal(third.status,'MANAGER_COVERALL_DECISION_REQUIRED');
assert.equal(third.contractorBooked,false);assert.equal(third.solverInvoked,false);
const noCloser=input('2026-11-02',['Xavier']);assert.equal(noCloser.status,'PREPARED_FOR_EXPLICIT_OBJECTIVE');
assert.deepEqual(noCloser.checkedWindow,{start:'07:00',end:'16:00'});
assert.ok(noCloser.phases.every(p=>p.window.end<='16:00'));
const noLunch=input('2026-11-08',['Derrick','Jada']);assert.equal(noLunch.status,'COVERAGE_CONSTRAINTS_UNRESOLVED');
assert.ok(noLunch.issues.some(i=>i.code==='NO_FULL_HOUR_LUNCH_HELPER'&&i.window.start==='12:00'&&i.window.end==='13:00'));
assert.throws(()=>input('2026-11-02',['Kathy']));assert.throws(()=>input('2026-11-02',['Tammy','Tammy']));
const cases=[['2026-11-02',['Tammy']],['2026-11-03',['Jada','Derrick']],['2026-11-05',['Kathy','Alijah']]],results=[];
for(const [date,names]of cases){
 const prepared=input(date,names),before=JSON.stringify(prepared);
 assert.equal(prepared.status,'PREPARED_FOR_EXPLICIT_OBJECTIVE',JSON.stringify(prepared.issues));
 const solved=await solveApprovedManualAbsenceAdjustment(prepared,{proposal});
 assert.equal(solved.status,'COMPLETE_APPROVED_FORMULA_ADJUSTMENT_DRAFT',JSON.stringify({status:solved.status,reason:solved.reason,stage:solved.failedStage,detail:solved.solverDetail,issues:solved.issues}));
 assert.equal(JSON.stringify(prepared),before,'Solver mutated its prepared input');
 assert.equal(solved.formulaApproved,true);assert.equal(solved.publicationEligible,false);assert.equal(solved.productionWritten,false);
 assert.equal(solved.employeePlans.length,prepared.roster.length);
 const checked=validateApprovedManualAbsenceProposal({plan:solved,input:prepared,proposal});
 assert.equal(checked.fullHourLunches,prepared.roster.length);
 assert.equal(solved.hardFeasibilityValidatedBeforeScoring,true);
 assert.equal(solved.stages[0].stage,'HARD_FEASIBILITY');assert.ok(solved.stages.every(s=>s.coverageValidated));
 assert.equal(checked.tammyChinaExtraMinutes,0,'Use others before giving Tammy China in these feasible cases');
 assert.equal(checked.preferredCoreMovedMinutes,0,'Retain Karen/Kathy core areas when feasible');
 assert.ok(checked.scoreBreakdown.proximityPenalty>=0&&checked.scoreBreakdown.proximityPenalty<=100);
 assert.ok(checked.scoreBreakdown.workloadPenalty>=0&&checked.scoreBreakdown.workloadPenalty<=100);
 assert.equal(solved.globalOptimalityClaim,false);
 // Walk every minute of the operating window against the named real shifts
 // and lunches. A score/solver status cannot substitute for complete coverage.
 const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));let ownershipChecks=0;
 for(let at=minute(prepared.checkedWindow.start);at<minute(prepared.checkedWindow.end);at++){
  const rows=solved.coverage.filter(p=>minute(p.window.start)<=at&&at<minute(p.window.end));assert.equal(rows.length,1);
  assert.equal(Object.keys(rows[0].owners).length,23);let sum=0;
  for(const group of prepared.groups){
   const person=prepared.roster.find(p=>p.slotId===rows[0].owners[group.code]);assert.ok(person);
   assert.ok(!names.some(name=>person.personId===id(name)));
   assert.ok(minute(person.shift.start)<=at&&at<minute(person.shift.end));
   assert.ok(!(minute(person.lunch.start)<=at&&at<minute(person.lunch.end)));
   sum+=group.points;ownershipChecks++;
  }
  assert.equal(sum,136);
 }
 const changed=structuredClone(solved);changed.coverage[0].owners[prepared.groups[0].code]='not-a-working-employee';
 assert.throws(()=>validateApprovedManualAbsenceProposal({plan:changed,input:prepared,proposal}));
 const badLunch=structuredClone(solved);badLunch.lunchPlans[0].window.end=badLunch.lunchPlans[0].window.start;
 assert.throws(()=>validateApprovedManualAbsenceProposal({plan:badLunch,input:prepared,proposal}));
 const wrongPolicy=structuredClone(proposal);wrongPolicy.weights.proximity=100;
 await assert.rejects(()=>solveApprovedManualAbsenceAdjustment(prepared,{proposal:wrongPolicy}));
 if(date==='2026-11-03'){
  const replacement=prepared.roster.find(p=>p.personId===id('Karen')),capacity=capacityFixtureSource.slots.find(s=>s.contractorCapacity===true),
   substitute={slotId:capacity.id,serviceDate:date,managerConfirmed:true,actualHoursConfirmed:true,
    confirmationReference:'LOCAL_FIXTURE_NOT_A_BOOKING',shift:structuredClone(replacement.shift),lunch:structuredClone(replacement.lunch)},
   apply=sub=>applyApprovedManualCoverAllSubstitute({acceptedPlan:solved,input:prepared,proposal,source:capacityFixtureSource,
    absentPersonId:replacement.personId,substitute:sub}),overlay=apply(substitute);
  assert.equal(overlay.solverInvoked,false);assert.equal(overlay.otherNormalOwnersChanged,false);assert.equal(overlay.scoringRerun,false);
  assert.equal(overlay.absentPersonIds.length,3);assert.equal(overlay.contractorBooked,false);assert.equal(overlay.publicationEligible,false);
  assert.ok(!overlay.coverage.some(c=>Object.values(c.owners).includes(replacement.slotId)));
  const short=structuredClone(substitute);short.shift.end='13:00';assert.throws(()=>apply(short));
  const late=structuredClone(substitute);late.shift.start='09:00';assert.throws(()=>apply(late));
  const unconfirmed=structuredClone(substitute);unconfirmed.actualHoursConfirmed=false;assert.throws(()=>apply(unconfirmed));
  const fake=structuredClone(substitute);fake.slotId=prepared.roster[0].slotId;assert.throws(()=>apply(fake));
  const shortLunch=structuredClone(substitute);shortLunch.lunch.end='10:00';assert.throws(()=>apply(shortLunch));
  const incompatibleLunch=structuredClone(substitute);incompatibleLunch.lunch={start:'12:30',end:'13:30'};
  incompatibleLunch.lunchCovererSlotId=prepared.roster.find(p=>p.name.startsWith('Xavier ')).slotId;
  assert.throws(()=>apply(incompatibleLunch));
  const stale=structuredClone(solved);stale.phaseOwners[0].owners.CHINA='stale-owner';
  assert.throws(()=>applyApprovedManualCoverAllSubstitute({acceptedPlan:stale,input:prepared,proposal,source:capacityFixtureSource,absentPersonId:replacement.personId,substitute}));
  save('THIRD_ABSENCE_COVERALL_OVERLAY.json',overlay);
 }
 results.push({date,absent:names,status:solved.status,fullHourLunches:checked.fullHourLunches,ownershipChecks,
  tammyChinaExtraMinutes:checked.tammyChinaExtraMinutes,preferredCoreMovedMinutes:checked.preferredCoreMovedMinutes,score:checked.scoreBreakdown});
 save(`CASE_${date}.json`,{input:prepared,plan:solved,validation:checked,ownershipChecks});
 console.log(JSON.stringify(results.at(-1)));
}
assert.equal(JSON.stringify(week),lockedWeek);assert.equal(JSON.stringify(draft.sourceDraft),lockedSource);assert.equal(JSON.stringify(draft.ownerConfig),lockedConfig);assert.equal(JSON.stringify(capacityFixtureSource),lockedCapacityFixture);
const result={status:'PASS',scope:'Real bounded local solver with the exact owner-approved formula; not manager publication, SQL admission, production activation or physical acceptance',formulaApproved:true,results,
 allSevenBaselinesPreserved:true,sourceAndOwnerConfigPreserved:true,thirdAbsenceRequestsManagerDecision:true,
 thirdAbsenceUsesExistingCapacityWithoutReshuffle:true,unconfirmedShortAndConflictingContractorHoursRejected:true,
 noClosingStaffInvented:true,noFullHourReliefInvented:true,
 productionWritten:false,publicationEligible:false,physicalAcceptance:false};save('RESULT.json',result);console.log(JSON.stringify(result));
