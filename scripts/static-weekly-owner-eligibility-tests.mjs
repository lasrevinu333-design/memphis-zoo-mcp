import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateOwnerEligibilityConfig,assertNormalOwnerEligibility,hardRestrictedSlots,verifiedBaseRestrictionInventory} from '../src/static-weekly-owner-eligibility.js';
const read=name=>JSON.parse(readFileSync(new URL('../config/'+name,import.meta.url),'utf8'));
const old=read('custodial-recurring-schedule-20260923.json'),config=read('custodial-recurring-schedule-20260924.json');
validateOwnerEligibilityConfig(config);
const normalized=structuredClone(config);normalized.schema=old.schema;
for(const slot of Object.values(normalized.slots)){
 if(slot.normalAssignmentFamilies){slot.normalAllowedFamilies=slot.normalAssignmentFamilies;delete slot.normalAssignmentFamilies;}
 if(slot.hardForbiddenFamilies){slot.forbiddenFamilies=slot.hardForbiddenFamilies;delete slot.hardForbiddenFamilies;}
}
assert.deepEqual(normalized,old,'only explicit scope/schema names changed; every owner fact retained');
assert.throws(()=>validateOwnerEligibilityConfig(old),/explicit normal vs hard/);
for(const legacy of ['normalAllowedFamilies','forbiddenFamilies']){
 const bad=structuredClone(config);bad.slots.KAREN[legacy]=[];assert.throws(()=>validateOwnerEligibilityConfig(bad),/ambiguous/);
}
assert.equal(Object.keys(config.slots).length,9);
assert.equal(Object.values(config.slots).filter(s=>s.vacancy).length,3);
assert.deepEqual(config.slots.KAREN.workDays,[1,2,3,5,6]);
assert.throws(()=>assertNormalOwnerEligibility(config.slots.TAMMY,'HERPETARIUM'),/normal geography/);
assert.ok(!hardRestrictedSlots(config,'HERPETARIUM').includes(config.slots.TAMMY.slotId),'nearby temporary Tammy coverage is not globally forbidden');
assert.deepEqual(hardRestrictedSlots(config,'HERPETARIUM'),[config.slots.ALIJAH.slotId]);
assert.throws(()=>assertNormalOwnerEligibility(config.slots.ALIJAH,'HERPETARIUM'),/forbidden family/);
assert.deepEqual(hardRestrictedSlots(config,'EAST_ADMIN'),[],'normal geography does not become a universal exclusion');
assert.deepEqual(hardRestrictedSlots(config,'EAST_ADMIN',['synthetic-hard-inherited']),['synthetic-hard-inherited'],'hard inherited data not silently erased');
const bytes=readFileSync(config.basePacket.path),hash=createHash('sha256').update(bytes).digest('hex');
assert.equal(hash,config.basePacket.sha256);
const base=JSON.parse(bytes),inventory=verifiedBaseRestrictionInventory(base.compilerInput,hash);
assert.equal(inventory.nonemptyRestrictionCount,0);
const badBase=structuredClone(base.compilerInput);badBase.version.assignments[0].restrictedSlotIds=['unclassified'];
assert.throws(()=>verifiedBaseRestrictionInventory(badBase,hash),/needs explicit hard-vs-normal/);
console.log(JSON.stringify({status:'PASS',normalGeographyPreserved:true,hardHerpetariumBanPreserved:true,baseRestrictionInventory:inventory,production:false}));
