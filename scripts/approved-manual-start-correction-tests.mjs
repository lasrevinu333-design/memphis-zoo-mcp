import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
const bytes=fs.readFileSync(new URL('./fixtures/approved-manual-week-before-start-correction.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'837fc6f43fc2b5a506a81264bedf449be82def63e3a243a13fbe86e28eeb868b');
const before=JSON.parse(bytes),week=readApprovedManualWeek(),expected=structuredClone(before);
delete expected.dataDigest;
for(const day of expected.days.filter(d=>['monday','wednesday'].includes(d.day))){
 const person=day.employees.find(p=>p.name==='Derrick Henderson');
 assert.deepEqual(person.shift,{start:'07:00',end:'16:00'});person.shift={start:'08:00',end:'17:00'};
 const previous=day.phases.find(p=>p.start==='15:00'),closing=day.phases.find(p=>p.start==='16:00');
 for(const [group,owner]of Object.entries(previous.owners))if(owner===person.name)closing.owners[group]=person.name;
 closing.zooWideCoverage=false;closing.points={};
 for(const [group,owner]of Object.entries(closing.owners))closing.points[owner]=(closing.points[owner]||0)+before.ratings.find(r=>r.group===group).score;
 day.transfers=day.transfers.filter(t=>!(t.from===person.name&&t.time==='16:00'));
}
const {dataDigest,ownerStartCorrection,...actual}=week;
assert.deepEqual(actual,expected,'Only the two approved shifts and their derived closing custody may change');
assert.notEqual(dataDigest,before.dataDigest);
assert.equal(ownerStartCorrection.employeeId,'8067cca2-7487-4589-ba7c-aa442e135045');
const draft=prepareApprovedManualSourceDraft({week,referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))});
assert.deepEqual(draft.restrictionConflicts,[]);
assert.equal(draft.sourceDraft.version.assignments.length,327);
assert.equal(draft.sourceDraft.version.lunchCoveragePolicy.loans.length,40);
for(const row of draft.sourceDraft.version.slotAvailability.filter(a=>a.slotId===ownerStartCorrection.slotId)){
 assert.deepEqual(row.shift,{start:[1,3].includes(row.dayOfWeek)?'08:00':'07:00',end:[1,3].includes(row.dayOfWeek)?'17:00':'16:00'});
 assert.equal(row.maxDutyMinutes,480);
}
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));let minuteSamples=0,ownershipChecks=0;
for(const day of week.days){
 for(let at=minute(day.checkedWindow.start);at<minute(day.checkedWindow.end);at++){
  const time=String(Math.floor(at/60)).padStart(2,'0')+':'+String(at%60).padStart(2,'0');
  const view=previewApprovedManualDay(week,{day:day.day,time});
  assert.equal(view.owners.length,23);assert.equal(new Set(view.owners.map(o=>o.group)).size,23);
  for(const owner of view.owners){
   const person=day.employees.find(p=>p.name===owner.employee);assert.ok(person);
   assert.ok(minute(person.shift.start)<=at&&at<minute(person.shift.end));
   assert.ok(at<minute(person.lunch.start)||at>=minute(person.lunch.end));ownershipChecks++;
  }
  minuteSamples++;
 }
}
console.log(JSON.stringify({status:'PASS_APPROVED_SHIFT_CORRECTION_SOURCE',days:7,employees:8,changedEmployeeDays:2,assignments:327,coalescedObsoleteHandoffFragments:19,fullHourLunches:40,minuteSamples,ownershipChecks,originalPacketPreserved:true,coverageScope:'Owner-confirmed08:00-17:00 Monday/Wednesday; retain Derrick custody through17:00; unchanged complete-site windows and all other employee shifts.',production:false,appBuild:false,phone:false}));
