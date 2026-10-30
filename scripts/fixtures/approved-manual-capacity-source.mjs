import assert from 'node:assert/strict';

// Explicit NEW nonemployee-capacity DATA for local tests. These fixed fixture
// UUIDs have no production registration. Never convert an old placeholder's
// slot in place: the original source and all historical people remain intact.
export function withApprovedManualFixtureCapacities(source){
 const result=structuredClone(source),legacy=result.slots.filter(s=>s.contractorCapacity);
 assert.equal(legacy.length,8);
 const oldIds=new Set(legacy.map(s=>s.id));
 assert.ok(!(result.version||result.versions[0]).assignments.some(w=>oldIds.has(w.ownerSlotId)||oldIds.has(w.originSlotId)));
 result.slots=result.slots.map(slot=>{
  if(!slot.contractorCapacity)return slot;
  const n=Number(slot.label.match(/([1-8])$/)?.[1]);assert.ok(n);
  const id=`71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  assert.ok(!source.slots.some(s=>s.id===id));
  return{id,capacityId:id,label:`CoverAll0${n}`,kind:'CONTRACTOR_CAPACITY',contractorCapacity:true,
   incumbencies:[],contractorAvailability:slot.contractorAvailability};
 });
 return result;
}
