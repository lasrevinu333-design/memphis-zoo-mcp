import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {week,source,draft,normal,adjusted,withThird,extended} from './approved-manual-period-tests.mjs';
import {prepareApprovedManualPeriodProjection} from '../src/approved-manual-period-projection.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {approvedManualManagerView} from '../src/approved-manual-manager-view.js';
const args=process.argv.slice(2);assert.ok(!args.length||(args.length===2&&args[0]==='--native-evidence-dir'&&isAbsolute(args[1])));
const out=args[1];if(out)fs.mkdirSync(out,{mode:0o700});
const save=(file,x)=>{if(out)fs.writeFileSync(resolve(out,file),JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});};
// Accepted records below are explicit disposable DATA fixtures, never real
// manager receipts or an authorization to write anything.
const acceptedFor=period=>period.days.flatMap(day=>{
 if(day.kind==='NORMAL')return[];
 const absent=day.kind==='COVERALL'?day.overlay.absentPersonIds:day.input.absentPersonIds,
  base={baseVersionId:source.version.id,publicationId:source.version.publicationId,serviceDate:day.serviceDate,
   actorId:'00000000-0000-4000-8000-000000001099',reason:'LOCAL_ACCEPTED_FACT_FIXTURE_NOT_A_REAL_APPROVAL',expectedRevision:0,status:'accepted'},
  rows=absent.map((id,i)=>({...base,id:`fixture-absence-${day.serviceDate}-${i}`,idempotencyKey:`fixture-absence-${day.serviceDate}-${i}`,type:'pto',
   payload:{slotId:week.referenceBindings.people.find(p=>p.employeeId===id).slotId}}));
 if(day.kind==='COVERALL'){
  const s=day.overlay.substitute,slot=source.slots.find(slt=>slt.id===s.slotId),
   template=slot.contractorAvailability.find(a=>a.dayOfWeek===day.input.weekday),
   availability={...Object.fromEntries(['acceptedRouteAnchorLocationId','acceptedRouteProvenance','maxServiceEffortMinutes','maxServiceEffortProvenance','productiveCapacityProvenance','qualificationProvenance','qualifications','restrictionProvenance','restrictions'].map(k=>[k,structuredClone(template[k])])),slotId:s.slotId,shift:s.shift};
  rows.push({...base,id:`fixture-capacity-${day.serviceDate}`,idempotencyKey:`fixture-capacity-${day.serviceDate}`,type:'cover_all',payload:{availability}},
   {...base,id:`fixture-capacity-lunch-${day.serviceDate}`,idempotencyKey:`fixture-capacity-lunch-${day.serviceDate}`,type:'lunch',window:s.lunch,payload:{slotId:s.slotId}});
 }
 return rows.map((row,i)=>({...row,sequence:i+1,acceptedAt:'2026-10-30T12:00:00Z'}));
});
const run=period=>prepareApprovedManualPeriodProjection({week,source,ownerConfig:draft.ownerConfig,period,acceptedExceptions:acceptedFor(period)}),
 before=digest({week,source,draft,normal,adjusted,withThird,extended});
save('FIXTURE.json',{week,source,ownerConfig:draft.ownerConfig,normal,adjusted,withThird,extended,accepted:{normal:acceptedFor(normal),adjusted:acceptedFor(adjusted),withThird:acceptedFor(withThird),extended:acceptedFor(extended)}});
const nativeNormal=run(normal);save('NORMAL_NATIVE.json',nativeNormal);
assert.equal(nativeNormal.projectionAssignments.length,346);assert.equal(nativeNormal.lunchDocument.loans.length,40);
for(const loan of nativeNormal.lunchDocument.loans)assert.equal(loan.status,'PLANNED');
const nativeAbsence=run(adjusted);save('TWO_ABSENCE_NATIVE.json',nativeAbsence);
const unchanged=rows=>rows.filter(r=>r.service_date!=='2026-11-03');
assert.deepEqual(unchanged(nativeAbsence.projectionAssignments),unchanged(nativeNormal.projectionAssignments));
for(const b of nativeAbsence.authority.groupDayBudgets)assert.equal(b.sourceBudget,b.datedBudget);
assert.equal(nativeAbsence.lunchDocument.loans.length,38);
const nativeThird=run(withThird);save('THIRD_COVERALL_NATIVE.json',nativeThird);
assert.equal(nativeThird.lunchDocument.loans.length,38);
for(const r of nativeThird.projectionAssignments.filter(r=>r.owner_kind==='CONTRACTOR_CAPACITY')){
 assert.equal(r.owner_person_id,null);assert.equal(r.capacity_id,r.owner_slot_id);
}
const nativeLate=run(extended);save('LATE_COVERALL_NATIVE.json',nativeLate);
const last=nativeLate.projectionAssignments.filter(r=>r.service_date==='2026-11-03'&&r.work_snapshot.window.end==='18:00');
assert.equal(new Set(last.map(r=>r.work_snapshot.locationCodeSnapshot)).size,23);
assert.ok(last.every(r=>r.owner_kind==='CONTRACTOR_CAPACITY'&&r.owner_person_id===null));
assert.ok(nativeLate.authority.projectionAvailability.every(a=>a.ownerKind==='CONTRACTOR_CAPACITY'||a.shift?.end!=='18:00'));
const projectionId='00000000-0000-4000-8000-000000001003',view=approvedManualManagerView({source,
 snapshot:{projection_status:'current',current_publication:{publication_id:source.version.publicationId},
  latest_projection:{projection_id:projectionId,assignments:nativeLate.projectionAssignments}},
 projectionAvailability:nativeLate.authority.projectionAvailability,
 lunchDocument:{...nativeLate.lunchDocument,projection_id:projectionId,persistence_status:'PERSISTED'}});
for(const day of view.days)for(const phase of day.phases)if(phase.completeSiteCoverageRequired)assert.equal(phase.totalPoints,136);
const closing=view.days.find(d=>d.serviceDate==='2026-11-03').phases.find(p=>p.start<='17:00'&&p.end>'17:00');
assert.equal(closing.zooWideCoverage,true);assert.equal(closing.owners.length,1);
assert.equal(closing.owners[0].ownerKind,'CONTRACTOR_CAPACITY');assert.equal(closing.owners[0].personId,null);
assert.equal(closing.owners[0].groups.length,23);save('TYPED_CAPACITY_MANAGER_VIEW_DATA.json',view);
const bad=structuredClone(adjusted);bad.days.find(d=>d.kind==='ABSENCE').plan.coverage[0].owners.CHINA='invented';
assert.throws(()=>run(bad));
const wrong=structuredClone(source);wrong.version.assignments[0].includedLocations=[];
assert.throws(()=>prepareApprovedManualPeriodProjection({week,source:wrong,ownerConfig:draft.ownerConfig,period:adjusted}));
assert.equal(digest({week,source,draft,normal,adjusted,withThird,extended}),before);
const result={status:'PASS',scope:'Native DATA preparation with maintained exact hard-constraint witness and native full-hour lunch derivation; no SQL, deployment or real manager claim',
 normalRows:346,normalLunches:40,adjustedLunches:38,unaffectedSixDaysExact:true,combinedGroupDayBudgetsConserved:true,
 typedFixtureCapacityHasNoEmployeeIdentity:true,all23GroupsThroughConfirmed18:true,baselineAndAcceptedPlansUnchanged:true,
 productionWritten:false};save('RESULT.json',result);console.log(JSON.stringify(result));
