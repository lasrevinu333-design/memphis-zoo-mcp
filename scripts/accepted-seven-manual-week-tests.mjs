import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {readAcceptedSevenManualWeek,deriveAcceptedSevenManualWeek,ACCEPTED_SEVEN_DATA_DIGEST} from '../src/accepted-seven-manual-week.js';
import {readApprovedManualWeekForSource} from '../src/accepted-manual-week-selection.js';
import {readRetainedApprovedManualWeek,RETAINED_MANUAL_DATA_DIGEST} from '../src/approved-manual-retained-week.js';
import {acceptedManualPatternProfile} from '../src/accepted-manual-pattern-profiles.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
const base=readApprovedManualWeek(),before=JSON.stringify(base),week=readAcceptedSevenManualWeek(base);
const candidateBytes=readFileSync(new URL('../config/schedules/accepted-seven-20261115/seven-person-static-candidate-current-review.json',import.meta.url));
const acceptanceBytes=readFileSync(new URL('../config/schedules/accepted-seven-20261115/OWNER_ACCEPTANCE.json',import.meta.url));
let checks=0;const check=(name,run)=>{run();checks++;};
check('retained eight input stays byte-identical',()=>assert.equal(JSON.stringify(base),before));
check('exact accepted successor digest',()=>assert.equal(week.dataDigest,ACCEPTED_SEVEN_DATA_DIGEST));
check('seven exact named existing roles, excluding only Kiltra',()=>{
 assert.equal(week.referenceBindings.people.length,7);
 assert.deepEqual(week.referenceBindings.people.map(p=>p.employeeId),base.referenceBindings.people.filter(p=>p.approvedName!=='Kiltra Horton').map(p=>p.employeeId));
});
check('normal hours and named lunches retain accepted values',()=>{
 const accepted=JSON.parse(candidateBytes);
 for(const day of week.days){const expected=accepted.days.find(d=>d.day===day.day);
  assert.deepEqual(day.employees,expected.employees);assert.deepEqual(day.lunches,expected.lunches);
  for(let i=0;i<day.phases.length;i++)assert.deepEqual({start:day.phases[i].start,end:day.phases[i].end,owners:day.phases[i].owners},
   {start:expected.phases[i].start,end:expected.phases[i].end,owners:expected.phases[i].owners});
 }
});
check('whole seven days and35 full hours',()=>{
 assert.equal(week.days.length,7);assert.equal(week.days.reduce((n,d)=>n+d.lunches.length,0),35);
 for(const d of week.days)for(const p of d.employees)assert.equal(+p.lunch.end.slice(0,2)*60+(+p.lunch.end.slice(3))-(+p.lunch.start.slice(0,2)*60+(+p.lunch.start.slice(3))),60);
});
check('no fabricated interim owners, dates or admission',()=>{
 assert.ok(week.days.every(d=>d.prearrivalPolicy==='UNRESOLVED'));
 assert.equal(week.acceptedStaticPattern.prearrivalPolicy,'OWN_BASE_AREAS_FROM_ACTUAL_SHIFT_START_ONLY');
 assert.equal(week.acceptedStaticPattern.effectiveDateChosen,false);assert.equal(week.acceptedStaticPattern.published,false);
 assert.equal(week.runtimeBinding.registeredSourceId,null);assert.equal(week.receiptEligible,false);
});
check('deeply frozen planning data',()=>{
 assert.ok(Object.isFrozen(week.days[0].employees[0].shift));
 assert.throws(()=>{week.days[0].employees[0].shift.start='08:00';},TypeError);
});
check('unknown source never selects seven',()=>{
 for(const sourceDigest of ['0'.repeat(64),base.dataDigest])
  assert.equal(readApprovedManualWeekForSource({version:{lunchCoveragePolicy:{sourceDigest}}}).dataDigest,base.dataDigest);
});
check('retained source keeps its own eight-person pattern and immutable data',()=>{
 const original=readRetainedApprovedManualWeek();
 const selected=readApprovedManualWeekForSource({version:{lunchCoveragePolicy:{sourceDigest:RETAINED_MANUAL_DATA_DIGEST}}});
 assert.deepEqual(selected,original);assert.notEqual(selected.dataDigest,base.dataDigest);
 assert.ok(Object.isFrozen(selected.days[0].employees[0].shift));
 const draft=prepareApprovedManualSourceDraft({week:selected,referenceBytes:readFileSync(new URL('../'+selected.referenceBindings.reference.path,import.meta.url))});
 assert.equal(draft.sourceDraft.version.assignments.length,346);assert.equal(draft.sourceDraft.version.slotAvailability.length,40);
 assert.equal(draft.sourceDraft.version.lunchCoveragePolicy.sourceDigest,RETAINED_MANUAL_DATA_DIGEST);
 assert.equal(draft.published,false);assert.equal(draft.registrationEligible,false);
});
check('only exact admitted source selects seven',()=>assert.equal(readApprovedManualWeekForSource({version:{lunchCoveragePolicy:{sourceDigest:ACCEPTED_SEVEN_DATA_DIGEST}}}).dataDigest,ACCEPTED_SEVEN_DATA_DIGEST));
check('unknown source count authority refused',()=>assert.throws(()=>acceptedManualPatternProfile('0'.repeat(64)),/Exact admitted/));
check('historical and corrected eight profiles unchanged',()=>{
 assert.deepEqual(acceptedManualPatternProfile('eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8'),{staff:8,assignments:346,lunches:40});
 assert.deepEqual(acceptedManualPatternProfile(base.dataDigest),{staff:8,assignments:327,lunches:40});
});
check('seven profile requires exact323/35',()=>assert.deepEqual(acceptedManualPatternProfile(week.dataDigest),{staff:7,assignments:323,lunches:35}));
for(const mutation of [c=>{c.days[0].employees[0].shift.start='08:00';},c=>{c.days[0].lunches[0].coverer='Xavier Green';},c=>{c.roster.push(c.roster[0]);},c=>{c.days[0].phases[0].owners.Aquarium='Kiltra Horton';}]){
 check('changed accepted artifact refused before preparation',()=>{const c=JSON.parse(candidateBytes);mutation(c);assert.throws(()=>deriveAcceptedSevenManualWeek({base,candidateBytes:Buffer.from(JSON.stringify(c)),acceptanceBytes}),/Exact accepted seven-person/);});
}
check('changed owner acceptance refused',()=>{
 const a=JSON.parse(acceptanceBytes);a.liveScheduleActivated=true;
 assert.throws(()=>deriveAcceptedSevenManualWeek({base,candidateBytes,acceptanceBytes:Buffer.from(JSON.stringify(a))}),/Exact retained owner acceptance/);
});
check('changed eight reference refused',()=>{
 const b=structuredClone(base);b.days[0].employees[0].shift.start='08:00';
 assert.throws(()=>deriveAcceptedSevenManualWeek({base:b,candidateBytes,acceptanceBytes}));
});
check('compiler source uses323 fixed rows,35 exact availabilities and no normal restriction conflicts',()=>{
 const d=prepareApprovedManualSourceDraft({week,referenceBytes:readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
 assert.equal(d.sourceDraft.version.assignments.length,323);assert.equal(d.sourceDraft.version.slotAvailability.length,35);
 assert.deepEqual(d.restrictionConflicts,[]);assert.equal(d.registrationEligible,false);assert.equal(d.published,false);
});
assert.equal(JSON.stringify(base),before);
console.log(JSON.stringify({status:'PASS_ACCEPTED_SEVEN_SOURCE_INTAKE',checks,staff:7,days:7,lunches:35,assignments:323,
 nativeFullQualification:false,SQLOrPublicationPerformed:false}));
