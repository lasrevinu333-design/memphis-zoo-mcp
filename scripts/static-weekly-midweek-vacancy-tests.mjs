import assert from 'node:assert/strict';
import {compileStaticWeeklySchedule} from '../src/static-weekly-schedule-compiler.js';
import {prepareStaticWeeklySchedulingProblem} from '../src/static-weekly-schedule-program.js';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
const days=[1,2,3,4,5,6,0], vacant=day=>![1,2].includes(day);
const input={serviceDate:'2026-08-10',timezone:'America/Chicago',exceptions:[],
 proximity:[{from:'A',to:'B',minutes:1,verified:true,bidirectional:true,provenance:'synthetic-walk'}],
 slots:['a','b'].map(id=>({id,label:'Slot '+id,incumbencies:[{personId:'person-'+id,displayName:'Synthetic '+id,effectiveStart:'2020-01-01',effectiveEnd:id==='a'?'2026-08-12':null}]})),
 versions:[{id:'midweek',publicationId:'midweek-publication',status:'published',effectiveStart:'2026-08-03',effectiveEnd:null,
 objective:{requireVerifiedProximity:true},vacancyCapableSlotIds:['a'],vacantSlotIds:[],
 slotAvailability:days.flatMap(day=>['a','b'].map(id=>({slotId:id,dayOfWeek:day,status:id==='a'&&vacant(day)?'vacant_unfilled':'working',
 shift:{start:'07:00',end:'16:00'},lunch:{start:'12:00',end:'13:00'},productiveCapacityProvenance:'synthetic-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'synthetic-capacity',
 qualifications:['general'],qualificationProvenance:'synthetic-qualified',restrictions:[],restrictionProvenance:'synthetic-restrictions',acceptedRouteAnchorLocationId:id.toUpperCase(),acceptedRouteProvenance:'synthetic-route'}))),
 assignments:days.flatMap(day=>['a','b'].map(id=>({workId:'work-'+id,dayOfWeek:day,locationId:id.toUpperCase(),window:{start:id==='a'?'08:00':'10:00',end:id==='a'?'09:00':'11:00'},ownerSlotId:id,
 serviceEffortMinutes:20,serviceEffortProvenance:'synthetic-effort',priority:2,priorityProvenance:'synthetic-priority',requiredQualifications:['general'],qualificationProvenance:'synthetic-work-qualified',restrictions:[],restrictionProvenance:'synthetic-work-restrictions'})))}]};
const sourceBefore=JSON.stringify(input), result=await compileStaticWeeklySchedule(structuredClone(input));
assert.equal(result.status,'FEASIBLE',JSON.stringify(result.fatal||result.verifier));
assert.equal(result.verifier.ok,true);
assert.equal(JSON.stringify(input),sourceBefore,'source templates and earlier history unchanged');
for(const day of days){
 const a=result.weeklyAssignments.find(x=>x.dayOfWeek===day&&x.workId==='work-a');
 assert.equal(a.status,vacant(day)?'OPEN':'ASSIGNED');
 assert.equal(a.baselineOwnerPersonId,vacant(day)?null:'person-a');
 const b=result.weeklyAssignments.find(x=>x.dayOfWeek===day&&x.workId==='work-b');
 assert.equal(b.status,'ASSIGNED','unrelated employee retains assignments');
 const available=result.canonicalAuthority.projectionAvailability.find(x=>x.dayOfWeek===day&&x.slotId==='a');
 assert.equal(available.incumbentPersonId,vacant(day)?null:'person-a');
 assert.deepEqual(available.lunch,{start:'12:00',end:'13:00'});
}
const forged=structuredClone(result);forged.weeklyAssignments.find(x=>x.dayOfWeek===3&&x.workId==='work-a').baselineOwnerPersonId='person-a';
assert.equal(verifyStaticWeeklyScheduleResult(input,forged).ok,false,'stale predecessor cannot be certified after closure');
const noCapability=structuredClone(input);noCapability.versions[0].vacancyCapableSlotIds=[];
assert.equal(prepareStaticWeeklySchedulingProblem(noCapability).error?.code,'invalid_incumbency_history');
const hiddenIncumbent=structuredClone(input);hiddenIncumbent.versions[0].vacantSlotIds=['a'];
assert.equal(prepareStaticWeeklySchedulingProblem(hiddenIncumbent).error?.detail,'vacant_slot_has_incumbency');
const wrongAvailability=structuredClone(input);wrongAvailability.versions[0].slotAvailability.find(x=>x.dayOfWeek===3&&x.slotId==='a').status='working';
assert.equal(prepareStaticWeeklySchedulingProblem(wrongAvailability).error?.code,'vacant_slot_availability_mismatch');
console.log(JSON.stringify({ok:true,weekDays:7,workRows:14,preservedOccupiedDays:2,trueVacantDays:5,unrelatedEmployeeDays:7,forgedSnapshotRejected:true,productionWritten:false}));
