import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateOwnerEligibilityConfig,assertNormalOwnerEligibility,hardRestrictedSlots,mandatoryNormalOwner,isHardForbidden} from '../src/static-weekly-owner-eligibility.js';
const c=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
validateOwnerEligibilityConfig(c);
for(let day=0;day<7;day++){
 const forbidden=day!==1;
 assert.equal(isHardForbidden(c.slots.ALIJAH,'HERPETARIUM',day),forbidden);
 assert.equal(hardRestrictedSlots(c,'HERPETARIUM',[],day).includes(c.slots.ALIJAH.slotId),forbidden);
 if(forbidden)assert.throws(()=>assertNormalOwnerEligibility(c.slots.ALIJAH,'HERPETARIUM',day));
 else assert.doesNotThrow(()=>assertNormalOwnerEligibility(c.slots.ALIJAH,'HERPETARIUM',day));
 for(const phase of ['morning','equalized']){
  const seen=new Set();
  for(const [key,families]of Object.entries(c.overrides[day][phase]))for(const f of families){
   assert.ok(!seen.has(f),`duplicate ${day}/${phase}/${f}`);seen.add(f);
   assertNormalOwnerEligibility({...c.slots[key],key},f,day);
   const required=mandatoryNormalOwner(c,f,day);
   assert.ok(!required||required===c.slots[key].slotId,`mandatory area moved ${day}/${phase}/${f}`);
  }
  assert.equal(seen.size,23);
 }
}
assert.ok(isHardForbidden(c.slots.ALIJAH,'HERPETARIUM'), 'missing weekday cannot open permission');
assert.deepEqual(hardRestrictedSlots(c,'HERPETARIUM',['independent-hard-restriction'],1),['independent-hard-restriction']);
assert.equal(mandatoryNormalOwner(c,'EAST_END_RESTROOMS',0),null,'Tammy off-day relief remains possible');
assert.equal(isHardForbidden(c.slots.KAREN,'EAST_END_RESTROOMS',1),false,'anchor is not a lunch-cover ban');
const bad=structuredClone(c);delete bad.slots.ALIJAH.hardForbiddenFamiliesByDay[5];assert.throws(()=>validateOwnerEligibilityConfig(bad));
const wrong=structuredClone(c);wrong.slots.ALIJAH.hardForbiddenFamiliesByDay[5]=[];assert.throws(()=>validateOwnerEligibilityConfig(wrong));
assert.deepEqual(c.slots.KATHY.lunchByDay['4'],['10:00','11:00']);
assert.deepEqual(c.slots.KAILI.lunchByDay['4'],['11:00','12:00']);
assert.deepEqual(c.slots.ALIJAH.lunchByDay['4'],['12:00','13:00']);
console.log('PASS: all seven weekdays, 14 retained phases/322 area rows, mandatory anchors, Monday-only eligibility, inherited restrictions and fixed lunches. No publication.');
