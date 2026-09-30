#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';

const path=process.env.STATIC_WEEKLY_SIX_PERSON_PACKET;
assert.ok(path,'explicit generated candidate packet required; no production connection');
const packet=JSON.parse(readFileSync(path,'utf8'));
const config=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260928.json',import.meta.url),'utf8'));
const source=packet.compilerInput,assignments=source.version.assignments;
const phase=row=>row.window.start==='09:45'?'equalized':'morning';
assert.equal(postgresJsonbContentDigest(source),packet.sourceDigest);
assert.equal(packet.effectiveDate,'2026-09-28');
assert.equal(packet.rosterSlots.length,9);
assert.equal(packet.rosterSlots.filter(row=>row.personId).length,6);
assert.equal(packet.rosterSlots.filter(row=>!row.personId).length,3);
assert.equal(assignments.length,7*2*23);
for(let day=0;day<7;day++)for(const segment of ['morning','equalized']){
 const rows=assignments.filter(row=>row.dayOfWeek===day&&phase(row)===segment);
 const expected=Object.entries(config.overrides[String(day)][segment]).flatMap(([key,families])=>
  families.map(family=>({family,slotId:config.slots[key].slotId})));
 assert.equal(rows.length,23,`${day}/${segment} must have 23 distinct families`);
 assert.equal(new Set(rows.map(row=>row.locationCodeSnapshot)).size,23);
 assert.deepEqual(rows.map(row=>({family:row.locationCodeSnapshot,slotId:row.ownerSlotId}))
  .sort((a,b)=>a.family.localeCompare(b.family)),expected.sort((a,b)=>a.family.localeCompare(b.family)),
  `${day}/${segment} candidate ownership differs from bounded approved correction`);
}
for(const [key,slot] of Object.entries(config.slots))for(const day of slot.workDays){
 const available=source.version.slotAvailability.find(row=>row.slotId===slot.slotId&&row.dayOfWeek===day);
 assert.ok(available,`${day}/${key} missing availability`);
 assert.deepEqual([available.shift.start,available.shift.end],slot.shift,`${day}/${key} shift changed`);
 assert.deepEqual([available.lunch.start,available.lunch.end],slot.lunchByDay?.[String(day)]||slot.lunch,
  `${day}/${key} lunch changed`);
}
const cat=assignments.find(row=>row.dayOfWeek===6&&row.window.start==='09:45'
 &&row.locationCodeSnapshot==='CAT_COUNTRY');
assert.equal(cat.ownerSlotId,config.slots.KAREN.slotId);
assert.equal(cat.serviceEffortMinutes,4,'four positive Saturday shift-end segments need four points');
assert.match(cat.serviceEffortProvenance,/four-segment continuity accounting floor/);
assert.equal(assignments.some(row=>config.retiredAreaFamilies.includes(row.locationCodeSnapshot)),false);
assert.equal(assignments.some(row=>row.ownerSlotId===config.slots.ALIJAH.slotId
 &&row.locationCodeSnapshot==='HERPETARIUM'),false);
console.log(JSON.stringify({ok:true,sourceDigest:packet.sourceDigest,assignments:assignments.length,
 staffed:6,vacant:3,saturdayCatCountryBudget:4,productionWritten:false}));
