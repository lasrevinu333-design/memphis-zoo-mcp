import assert from 'node:assert/strict';

// Personal owner directions bind the exact accepted person AND position.
// Callers must separately verify these config people against authoritative
// source incumbencies (the normal adapter and phase descriptor do so). This
// pure helper is not a roster/admission authority. Replacements do not inherit
// a departed person's geography merely by taking the same stable position.
const protectedGeographyPositions=new Map([
 ['f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f',{key:'KAREN',personId:'3da709bb-2223-4e15-8e3a-db02e3f32e97'}],
 ['4a5a83ca-d297-5a30-8344-db08d05b978c',{key:'TAMMY',personId:'cd97111e-cfa0-4228-b4d7-401bc7a5ac13'}],
 ['55e5939c-175c-5026-94fd-c4350d538922',{key:'KATHY',personId:'30ec85e0-a579-45a8-9c27-c164e77a9190'}],
]);
const alijah={slotId:'36829381-70d7-521b-9f14-bad0af16ba87',personId:'77d50e9a-6338-43b1-aed5-9f47d7129466'};
export function normalGeographyRestrictionApplies(owner){
 assert.ok(!owner.slotId||!owner.id||String(owner.slotId).toLowerCase()===String(owner.id).toLowerCase(),'owner slot aliases disagree');
 const id=String(owner.slotId||owner.id||'').toLowerCase(),binding=protectedGeographyPositions.get(id);
 const personal=[...protectedGeographyPositions].find(([,b])=>b.personId===String(owner.personId||'').toLowerCase());
 assert.ok(!personal||personal[0]===id,'protected current person/position mismatch needs source provenance');
 if(owner.key!==undefined){
  const declared=[...protectedGeographyPositions].find(([,b])=>b.key===owner.key)?.[0];
  assert.ok(!declared||declared===id,'protected geography key/slot identity mismatch');
  assert.ok(!binding||owner.key===binding.key,'protected geography slot/key identity mismatch');
 }
 if(binding)assert.ok(owner.vacancy===true?owner.personId==null:
  typeof owner.personId==='string'&&owner.personId.length>0,'protected position needs explicit source-bound incumbent or vacancy');
 const applies=Boolean(binding&&binding.personId===String(owner.personId).toLowerCase());
 if(applies)assert.ok(Array.isArray(owner.normalAssignmentFamilies),'protected current geography missing');
 return applies;
}

export function validateOwnerEligibilityConfig(config){
 assert.equal(config.schema,'custodial.owner-corrected-recurring-schedule.v2','explicit normal vs hard eligibility schema required');
 for(const [key,slot] of Object.entries(config.slots)){
  normalGeographyRestrictionApplies({key,...slot});
  if(String(slot.personId||'').toLowerCase()===alijah.personId){
   assert.equal(key,'ALIJAH','current Alijah person/key needs explicit source provenance');
   assert.equal(slot.slotId,alijah.slotId,'current Alijah person/position needs explicit source provenance');
  }
  assert.ok(!('normalAllowedFamilies' in slot)&&!('forbiddenFamilies' in slot),`${key}: ambiguous legacy restriction field`);
  for(const field of ['normalAssignmentFamilies','hardForbiddenFamilies'])if(slot[field]!==undefined){
   assert.ok(Array.isArray(slot[field])&&slot[field].every(v=>typeof v==='string'&&/^[A-Z0-9_]+$/.test(v)),`${key}: invalid ${field}`);
   assert.equal(new Set(slot[field]).size,slot[field].length,`${key}: duplicate ${field}`);
  }
 }
 const slot=config.slots.ALIJAH;
 assert.equal(slot.slotId,alijah.slotId,'Alijah stable position identity changed');
 if(String(slot.personId||'').toLowerCase()===alijah.personId)assert.deepEqual(slot.hardForbiddenFamilies,['HERPETARIUM'],'current person hard restriction remains exact');
 // Declared/inherited source restrictions are still preserved for replacements.
 // Removing an inherited restriction requires the existing classified, bound
 // source transition, never just changing this config person's ID.
}
export function assertNormalOwnerEligibility(owner,family){
 assert.ok(!(owner.hardForbiddenFamilies||[]).includes(family),`${owner.key||owner.name} received forbidden family ${family}`);
 if(normalGeographyRestrictionApplies(owner))assert.ok(owner.normalAssignmentFamilies.includes(family),`${owner.key||owner.name} normal geography violated: ${family}`);
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
