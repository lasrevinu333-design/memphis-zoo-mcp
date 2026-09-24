import assert from 'node:assert/strict';

export function validateOwnerEligibilityConfig(config){
 assert.equal(config.schema,'custodial.owner-corrected-recurring-schedule.v2','explicit normal vs hard eligibility schema required');
 for(const [key,slot] of Object.entries(config.slots)){
  assert.ok(!('normalAllowedFamilies' in slot)&&!('forbiddenFamilies' in slot),`${key}: ambiguous legacy restriction field`);
  for(const field of ['normalAssignmentFamilies','hardForbiddenFamilies'])if(slot[field]!==undefined){
   assert.ok(Array.isArray(slot[field])&&slot[field].every(v=>typeof v==='string'&&/^[A-Z0-9_]+$/.test(v)),`${key}: invalid ${field}`);
   assert.equal(new Set(slot[field]).size,slot[field].length,`${key}: duplicate ${field}`);
  }
 }
 assert.deepEqual(config.slots.ALIJAH.hardForbiddenFamilies,['HERPETARIUM'],'owner hard restriction remains exact');
}
export function assertNormalOwnerEligibility(owner,family){
 assert.ok(!(owner.hardForbiddenFamilies||[]).includes(family),`${owner.key||owner.name} received forbidden family ${family}`);
 if(owner.normalAssignmentFamilies)assert.ok(owner.normalAssignmentFamilies.includes(family),`${owner.key||owner.name} normal geography violated: ${family}`);
}
export function hardRestrictedSlots(config,family,inherited=[]){
 return [...new Set([...inherited,...Object.values(config.slots).filter(s=>(s.hardForbiddenFamilies||[]).includes(family)).map(s=>s.slotId)])].sort();
}
export function verifiedBaseRestrictionInventory(input,sha256){
 const entries=input.version.assignments.filter(a=>a.restrictedSlotIds?.length).map(a=>({workId:a.workId,
  dayOfWeek:a.dayOfWeek,restrictedSlotIds:[...a.restrictedSlotIds],provenance:a.restrictionProvenance??null}));
 // This reviewed base is known to contain no hard restrictions. A changed base
 // with inherited restrictions needs explicit classification, never a blanket
 // removal or silent promotion of a preference into a prohibition.
 assert.equal(entries.length,0,'base restriction inventory needs explicit hard-vs-normal classification');
 return {basePacketSha256:sha256,nonemptyRestrictionCount:entries.length,entries,classification:'exact_hash_bound_empty_inventory'};
}
