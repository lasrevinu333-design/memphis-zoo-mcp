#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOctoberTransitionCandidate,assertTransitionDate,selectOctoberCandidateDay,compilerInput} from '../src/static-weekly-october-transition-candidate.js';
import {selectEffectiveWeeklyVersion} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {verifyStaticWeeklyScheduleResult} from '../src/static-weekly-schedule-verifier.js';
import {prepareStaticWeeklyRegistrationArtifact} from './static-weekly-schedule-candidate-importer.mjs';
const dir=process.argv[2];assert.ok(dir,'explicit local evidence directory required');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const config=read('config/custodial-six-person-static-20261005.json');
const old=read('config/custodial-six-person-static-20260928.json');
const same=structuredClone(config);same.effectiveDate=old.effectiveDate;delete same.dateAuthority;
assert.deepEqual(same,old,'date correction cannot change approved availability/geography/workload');
const packet=read('evidence/october5-recurring.json');
const transition=read(`${dir}/transition-candidate.json`);
const document=read(`${dir}/phone-pdf-data.json`);
const original=JSON.stringify(packet);
assert.deepEqual(createOctoberTransitionCandidate(packet),transition);
assert.equal(JSON.stringify(packet),original,'source cannot mutate');
assert.deepEqual(transition.compilerInput.version.assignments,packet.compilerInput.version.assignments,'dated transition preserves all duties and physical restroom packages');
assert.deepEqual(transition.compilerInput.version.slotAvailability,packet.compilerInput.version.slotAvailability,'dated transition preserves exact shift/lunch/eligibility');
assert.deepEqual(transition.compilerInput.slots,packet.compilerInput.slots,'stable positions and incumbent history stay exact');
for(const date of ['2026-09-28','2026-09-29','2026-09-30','2026-10-05','2026-10-06'])
 assert.throws(()=>assertTransitionDate(transition,date),/outside October/);
for(const date of ['2026-10-01','2026-10-02','2026-10-03','2026-10-04'])assert.equal(assertTransitionDate(transition,date),date);
assert.throws(()=>assertTransitionDate(transition,'2026-02-30'));
assert.throws(()=>selectEffectiveWeeklyVersion([transition.compilerInput.version],'2026-09-30'));
assert.throws(()=>selectEffectiveWeeklyVersion([transition.compilerInput.version],'2026-10-05'));
assert.equal(selectEffectiveWeeklyVersion([transition.compilerInput.version,packet.compilerInput.version],'2026-10-05').id,packet.compilerInput.version.id);
assert.equal((await prepareStaticWeeklyRegistrationArtifact(transition)).admissibleForRegistration,false,
 'dated local candidate must never be sent to recurring registration');
const forged=structuredClone(transition);forged.compilerInput.version.effectiveStart='2026-09-28';
assert.throws(()=>assertTransitionDate(forged,'2026-10-01'),/digest mismatch/);
const wrongRevision=structuredClone(document);wrongRevision.days[0].assignments[0].window.end='23:00';
assert.throws(()=>selectOctoberCandidateDay(wrongRevision,'2026-10-01'),/revision mismatch/);
assert.throws(()=>selectOctoberCandidateDay(document,'2026-09-30'),/outside prepared/);
assert.throws(()=>selectOctoberCandidateDay(document,'2026-10-12'),/outside prepared/);
assert.equal(document.days.length,11);
assert.equal(document.rosterSlots.length,9);
assert.equal(document.rosterSlots.filter(r=>r.personId).length,6);
let rows=0,lunches=0,openRows=0;
for(const day of document.days){
 assert.deepEqual(selectOctoberCandidateDay(document,day.serviceDate),day);
 const dow=new Date(`${day.serviceDate}T12:00:00Z`).getUTCDay();
 assert.equal(day.phase,day.serviceDate<'2026-10-05'?'dated_transition':'recurring');
 assert.ok(day.assignments.every(row=>row.serviceDate===day.serviceDate),'no compiler-week rows leak across transition');
 for(const [key,slot] of Object.entries(config.slots).filter(([,s])=>s.personId)){
  const av=day.availability.find(row=>row.slotId===slot.slotId);
  if(!slot.workDays.includes(dow)){assert.ok(!av||av.status!=='working',`${key} offday`);continue;}
  assert.equal(av.status,'working');assert.equal(av.incumbentPersonId,slot.personId);
  assert.deepEqual([av.shift.start,av.shift.end],slot.shift,`${key} exact shift`);
  assert.deepEqual([av.lunch.start,av.lunch.end],slot.lunchByDay[String(dow)],`${key} exact lunch`);
  lunches++;
 }
 for(const row of day.assignments){
  rows++;
  if(row.status==='OPEN'){openRows++;assert.equal(row.slotId,null);assert.equal(row.personId,null);continue;}
  const av=day.availability.find(a=>a.slotId===row.slotId);
  assert.equal(av?.status,'working');assert.equal(av.incumbentPersonId,row.personId);
  assert.ok(row.window.start>=av.shift.start&&row.window.end<=av.shift.end,'no fabricated hours');
  assert.ok(!(row.slotId===config.slots.ALIJAH.slotId&&row.workSnapshot.locationCodeSnapshot==='HERPETARIUM'));
 }
 for(const seg of ['morning','equalized']){
  const source=(day.phase==='dated_transition'?transition.compilerInput:packet.compilerInput).version.assignments;
  const expected=Object.entries(config.overrides[String(dow)][seg]).flatMap(([key,families])=>families.map(family=>[family,config.slots[key].slotId])).sort();
  const actual=source.filter(row=>row.dayOfWeek===dow&&row.serviceMode!=='reminder_only'&&(row.window.start==='09:45'?'equalized':'morning')===seg).map(row=>[row.locationCodeSnapshot,row.ownerSlotId]).sort();
  assert.deepEqual(actual,expected,'all exact primary assignment families preserved');
 }
 const friday=day.assignments.filter(r=>r.status==='OPEN');
 if(dow===5){assert.equal(friday.length,1);assert.equal(friday[0].workSnapshot.locationCodeSnapshot,'HERPETARIUM');assert.deepEqual(friday[0].window,{start:'15:00',end:'16:00',startMinute:900,endMinute:960});}
 else assert.equal(friday.length,0,'no concealed extra gaps');
 if(dow===6){
  const cat=day.assignments.filter(r=>r.workSnapshot.locationCodeSnapshot==='CAT_COUNTRY'&&r.window.start>='09:45').sort((a,b)=>a.window.start.localeCompare(b.window.start));
  assert.deepEqual(cat.map(r=>[r.slotId,r.window.start,r.window.end]),[[config.slots.KAREN.slotId,'09:45','14:00'],[config.slots.ALIJAH.slotId,'14:00','16:00'],[config.slots.GREGORY.slotId,'16:00','17:00']]);
 }
 for(const loan of day.lunchLoans){
  assert.equal(loan.status,'PLANNED');assert.equal(loan.fallback,null);
  for(const id of loan.helperSlotIds){const av=day.availability.find(a=>a.slotId===id);assert.equal(av.status,'working');assert.ok(av.shift.start<=loan.window.start&&av.shift.end>=loan.window.end);assert.ok(av.lunch.end<=loan.window.start||av.lunch.start>=loan.window.end);}
 }
 assert.equal(day.checkPolicy.adminMaximumHoursBetweenChecks,3);
 assert.equal(day.checkPolicy.adminMorningAllowed,true);
 for(const item of day.lunchLoans.flatMap(l=>l.responsibilities)){
  assert.equal(item.createsDeepClean,false);
  if(item.covererSlotId===config.slots.GREGORY.slotId)assert.equal(item.responseMode,'on_call_issues_only');
 }
 for(const family of ['EAST_ADMIN','WEST_ADMIN'])assert.ok(day.assignments.some(r=>r.workSnapshot.locationCodeSnapshot===family&&r.window.start<'09:45'),'Admin has permitted morning cleaning');
}
assert.equal(openRows,2,'Friday gap must remain honest in both periods');
for(const date of ['2026-10-02','2026-10-09']){
 const day=selectOctoberCandidateDay(document,date),present=day.availability.filter(r=>r.status==='working'&&r.shift.end>'15:00');
 assert.deepEqual(present.map(r=>r.slotId),[config.slots.ALIJAH.slotId],'only remaining 15-16 staff is ineligible');
}
const reminder=document.days.flatMap(d=>d.assignments).filter(r=>r.workSnapshot.locationCodeSnapshot==='ELEPHANT_TRUNK_RESTROOMS');
assert.equal(reminder.length,1);assert.equal(reminder[0].serviceDate,'2026-10-06');assert.equal(reminder[0].slotId,config.slots.KATHY.slotId);assert.equal(reminder[0].workSnapshot.serviceMode,'reminder_only');assert.deepEqual(reminder[0].workSnapshot.includedLocations,[]);
assert.equal(document.revision,postgresJsonbContentDigest((({revision,...body})=>body)(document)));
for(const [phase,source] of [['dated_transition',transition.compilerInput],['recurring',packet.compilerInput]]){
 const result=read(`${dir}/${phase}-compiler-result.json`);
 assert.equal(verifyStaticWeeklyScheduleResult(compilerInput(source),result).ok,true,'complete verifier must validate retained witness');
 assert.equal(result.status,'FEASIBLE');assert.equal(result.reviewWork.length,0);
 assert.equal(result.canonicalAuthority.shiftEndDerivation.continuity.coverageGaps,0);
 assert.equal(result.canonicalAuthority.shiftEndDerivation.continuity.duplicateLocations,0);
}
console.log(JSON.stringify({ok:true,revision:document.revision,dates:11,assignmentRows:rows,scheduledLunches:lunches,explicitOpenFridayRows:openRows,fullVerifierWitnesses:2,historyUnchanged:true,publication:'NOT_RUN'}));
