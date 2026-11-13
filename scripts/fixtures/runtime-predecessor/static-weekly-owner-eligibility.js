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
export const MANUAL_NORMAL_RESTRICTION_AUTHORITY=Object.freeze({
 schema:'custodial.approved-manual-normal-restrictions.v1',
 manifestSha256:'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f',
 policyDeltaSha256:'1e0510e468fce2bf46762b286bb6e801df1b19591ecc0825411c5250a57feee3',
 referenceSha256:'2f8b138c0cddf9e05741ddf63c2bc774bbf3f3abac2b8a908e0fd93aa84bafdc',
});
const inheritedAlertMode='APPROVED_MANUAL_ALERTS_AND_ISSUES_ONLY';
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
 const manual=config.manualNormalRestrictionAuthority!==undefined;
 if(manual)assert.deepEqual(config.manualNormalRestrictionAuthority,MANUAL_NORMAL_RESTRICTION_AUTHORITY,'Unknown manual restriction classification');
 for(const [key,slot] of Object.entries(config.slots)){
  assert.equal(slot.inheritedAlertCustodyMode,manual?inheritedAlertMode:undefined,'Alert custody scope must belong to the approved manual model');
  if(slot.normalForbiddenFamiliesByDay!==undefined){
   assert.ok(manual&&key==='ALIJAH'&&slot.personId===alijah.personId,'Unreviewed normal-only personal restriction');
   assert.deepEqual(slot.normalForbiddenFamiliesByDay,Object.fromEntries(Array.from({length:7},(_,d)=>[d,d===1?[]:['HERPETARIUM']])));
  }
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
  if(slot.hardForbiddenFamiliesByDay!==undefined){
   assert.ok(slot.hardForbiddenFamiliesByDay&&Object.getPrototypeOf(slot.hardForbiddenFamiliesByDay)===Object.prototype,`${key}: invalid weekday restrictions`);
   assert.deepEqual(Object.keys(slot.hardForbiddenFamiliesByDay).sort(),['0','1','2','3','4','5','6'],`${key}: explicit seven-day restrictions required`);
   for(const families of Object.values(slot.hardForbiddenFamiliesByDay)){
    assert.ok(Array.isArray(families)&&families.every(f=>typeof f==='string'&&/^[A-Z0-9_]+$/.test(f)),`${key}: invalid weekday family`);
    assert.equal(new Set(families).size,families.length,`${key}: duplicate weekday family`);
   }
  }
  if(slot.mandatoryNormalFamilies!==undefined){
   assert.ok(Array.isArray(slot.mandatoryNormalFamilies)&&slot.mandatoryNormalFamilies.every(f=>slot.normalAssignmentFamilies?.includes(f)),`${key}: mandatory family outside normal geography`);
   assert.equal(new Set(slot.mandatoryNormalFamilies).size,slot.mandatoryNormalFamilies.length,`${key}: duplicate mandatory family`);
  }
 }
 const slot=config.slots.ALIJAH;
 assert.equal(slot.slotId,alijah.slotId,'Alijah stable position identity changed');
 if(String(slot.personId||'').toLowerCase()===alijah.personId){
  if(manual){
   assert.deepEqual(slot.hardForbiddenFamilies,[],'Classified personal scheduling rule cannot remain an all-purpose prohibition');
   assert.equal(slot.hardForbiddenFamiliesByDay,undefined);
   assert.deepEqual(slot.normalForbiddenFamiliesByDay,Object.fromEntries(Array.from({length:7},(_,d)=>[d,d===1?[]:['HERPETARIUM']])));
  }else if(slot.hardForbiddenFamiliesByDay){
   assert.deepEqual(slot.hardForbiddenFamilies,[],'weekday correction must not retain the superseded blanket ban');
   assert.deepEqual(slot.hardForbiddenFamiliesByDay,Object.fromEntries(Array.from({length:7},(_,d)=>[d,d===1?[]:['HERPETARIUM']])),'Alijah Herpetarium is Monday only');
  }else assert.deepEqual(slot.hardForbiddenFamilies,['HERPETARIUM'],'historical person hard restriction remains exact');
 }
 // Declared/inherited source restrictions are still preserved for replacements.
 // Removing an inherited restriction requires the existing classified, bound
 // source transition, never just changing this config person's ID.
}
export function forbiddenFamiliesForDay(owner,dayOfWeek){
 // Missing weekday never opens a day-specific permission. Historical configs
 // retain their original all-week restriction until explicitly superseded.
 const daily=owner.hardForbiddenFamiliesByDay;
 return [...new Set([...(owner.hardForbiddenFamilies||[]),...(daily
  ?Number.isInteger(dayOfWeek)&&dayOfWeek>=0&&dayOfWeek<=6?daily[dayOfWeek]||[]:Object.values(daily).flat()
  :[])])].sort();
}
export function isHardForbidden(owner,family,dayOfWeek){return forbiddenFamiliesForDay(owner,dayOfWeek).includes(family);}
export function mandatoryNormalOwner(config,family,dayOfWeek){
 const matches=Object.values(config.slots).filter(s=>s.vacancy!==true&&s.workDays.includes(dayOfWeek)
  &&s.mandatoryNormalFamilies?.includes(family)&&normalGeographyRestrictionApplies(s));
 assert.ok(matches.length<=1,'conflicting mandatory normal owners');
 return matches[0]?.slotId??null;
}
export function assertNormalOwnerEligibility(owner,family,dayOfWeek,coveragePurpose='NORMAL_AREA_OWNERSHIP'){
 assert.ok(!isHardForbidden(owner,family,dayOfWeek),`${owner.key||owner.name} received forbidden family ${family}`);
 const inherited=coveragePurpose==='INHERITED_ALERTS_AND_ISSUES_ONLY'&&owner.inheritedAlertCustodyMode===inheritedAlertMode;
 if(!inherited){
  const normal=owner.normalForbiddenFamiliesByDay;
  assert.ok(!normal||!(Number.isInteger(dayOfWeek)?normal[dayOfWeek]||[]:Object.values(normal).flat()).includes(family),`${owner.key||owner.name} normal-only family restriction violated: ${family}`);
  if(normalGeographyRestrictionApplies(owner))assert.ok(owner.normalAssignmentFamilies.includes(family),`${owner.key||owner.name} normal geography violated: ${family}`);
 }
}
export function hardRestrictedSlots(config,family,inherited=[],dayOfWeek){
 return [...new Set([...inherited,...Object.values(config.slots).filter(s=>isHardForbidden(s,family,dayOfWeek)).map(s=>s.slotId)])].sort();
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
