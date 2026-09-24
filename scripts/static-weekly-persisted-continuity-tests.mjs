import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareStaticWeeklySchedulingProblem} from '../src/static-weekly-schedule-program.js';

// This tests the actual normalizer/program path against ONE saved source.
// It deliberately never invokes the offline recurring-source generator.
// Database hydration/transaction/admission require separate PostgreSQL proof.
const path=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(path,'explicit synthetic/local candidate packet required; no database/network');
const packet=JSON.parse(readFileSync(path,'utf8'));
const original=JSON.stringify(packet),source=packet.compilerInput;
const config=JSON.parse(readFileSync(new URL('../config/custodial-recurring-schedule-20260923.json',import.meta.url),'utf8'));
const positions=new Map(Object.values(config.slots).map(p=>[p.slotId,p]));
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const ids=r=>r.includedLocations?.length?r.includedLocations.map(x=>x.locationId):[r.locationId];
function prepared(input){
 const copy=structuredClone(input);copy.versions=[copy.version];delete copy.version;
 const problem=prepareStaticWeeklySchedulingProblem(copy);
 assert.equal(problem.error,undefined,JSON.stringify(problem.error));
 return problem;
}
function proveClosingCoverage(problem,label){
 let checks=0;
 for(let day=0;day<7;day++){
  const onDay=[...positions.values()].filter(p=>p.workDays.includes(day));
  const real=onDay.filter(p=>Boolean(problem.incumbencyByDaySlot.get(`${day}\0${p.slotId}`)?.personId));
  assert.ok(real.length,`${label}: no real staff on ${day}`);
  const close=Math.max(...real.map(p=>minutes(p.shift[1])));
  const expected=new Set(source.version.assignments.filter(r=>r.dayOfWeek===day&&r.window.start==='09:45').flatMap(ids));
  const rows=problem.work.filter(r=>r.dayOfWeek===day&&minutes(r.window.start)>=585);
  for(const row of rows){
   const position=positions.get(row.originSlotId);
   assert.ok(position&&position.workDays.includes(day),`${label}: unknown/off-day owner`);
   assert.ok(minutes(row.window.start)>=minutes(position.shift[0])&&minutes(row.window.end)<=minutes(position.shift[1]),`${label}: off-shift responsibility`);
   assert.ok(minutes(row.window.end)<=close,`${label}: responsibility after real staffed departure`);
  }
  for(let at=585;at<close;at++){
   const count=new Map();
   for(const row of rows.filter(r=>minutes(r.window.start)<=at&&at<minutes(r.window.end)))
    for(const id of ids(row))count.set(id,(count.get(id)||0)+1);
   assert.equal(count.size,expected.size,`${label}: missing physical responsibility day=${day} minute=${at}; same immutable source must survive roster fill`);
   for(const id of expected){assert.equal(count.get(id),1,`${label}: missing/duplicate physical identity ${id}`);checks++;}
  }
 }
 return checks;
}
const currentChecks=proveClosingCoverage(prepared(source),'current six-person roster');
const filled=structuredClone(source);
for(const slotId of source.version.vacantSlotIds){
 const hex=createHash('sha256').update(`SYNTHETIC_CONTINUITY_TEST_ONLY:${slotId}`).digest('hex');
 const personId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
 filled.slots.find(s=>s.id===slotId).incumbencies.push({personId,displayName:'SYNTHETIC CONTINUITY TEST',effectiveStart:filled.serviceDate,effectiveEnd:null});
 for(const row of filled.version.slotAvailability.filter(r=>r.slotId===slotId))row.status='working';
}
filled.version.vacantSlotIds=[];
assert.deepEqual(filled.version.assignments,source.version.assignments,'test may not regenerate or replace recurring assignments');
const filledChecks=proveClosingCoverage(prepared(filled),'later full roster');
assert.equal(JSON.stringify(packet),original,'synthetic incumbents never mutate original source');
console.log(JSON.stringify({passed:true,currentChecks,filledChecks,sourceRegenerated:false,actualDatabase:false,physicalVerification:false},null,2));
