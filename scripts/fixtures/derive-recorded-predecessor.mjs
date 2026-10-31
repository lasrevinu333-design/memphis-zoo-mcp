import assert from 'node:assert/strict';

const clone=value=>JSON.parse(JSON.stringify(value));
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday=date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};

// Main-selected SYNTHETIC populated predecessor. Not the original source identity,
// a current roster observation, a feasible receipt, or an approved manual baseline.
export function deriveOriginal314RecordedPredecessor({fixture,recorded,anchorCivilDate}){
 assert.equal(fixture.sourceId,'a00cdf2a-0623-5e2d-bc65-338c1dd67202');
 assert.equal(fixture.sourceDigest,'b2b0c7951b427a9f04b7d504d26591eb0e25f514c8e8652b1e6a5628d498abdc');
 assert.equal(recorded.parentPublication.sourceId,fixture.sourceId);
 assert.equal(recorded.parentPublication.publicationId,'07bc1528-cf56-474b-adb0-216a908c4eed');
 assert.equal(recorded.parentPublication.effectiveStart,'2026-08-31');
 assert.match(anchorCivilDate,/^\d{4}-\d{2}-\d{2}$/);
 const raw=fixture.compilerInput,before=JSON.stringify(raw),rosterBefore=JSON.stringify(recorded),
  previousMonday=monday(addDays(anchorCivilDate,-1)),days=Array.from({length:7},(_,n)=>addDays(previousMonday,n));
 assert.ok(previousMonday<anchorCivilDate);
 assert.equal(raw.slots.length,17);assert.equal(raw.version.assignments.length,314);
 assert.ok(!Object.hasOwn(raw.version,'shiftEndPolicy'));
 assert.ok(!Object.hasOwn(raw.version,'lunchCoveragePolicy'));
 assert.equal(recorded.rosterSlots.length,22);
 assert.equal(new Set(recorded.rosterSlots.map(r=>r.slotId)).size,22);
 const seed=clone(raw);delete seed.version;
 seed.versions=[{...clone(raw.version),effectiveStart:previousMonday,effectiveEnd:null}];seed.serviceDate=previousMonday;
 const map=new Map(seed.slots.map(s=>[s.id,s])),added=[];
 for(const r of recorded.rosterSlots){
  const histories=r.incumbencies.map(({personId,displayName,effectiveStart,effectiveEnd})=>({personId,displayName,effectiveStart,effectiveEnd}));
  for(const h of histories){assert.equal(typeof h.personId,'string');assert.equal(typeof h.displayName,'string');assert.match(h.effectiveStart,/^\d{4}-\d{2}-\d{2}$/);assert.ok(h.effectiveEnd===null||h.effectiveEnd>h.effectiveStart);}
  if(map.has(r.slotId))map.get(r.slotId).incumbencies=histories;
  else{const slot={id:r.slotId,label:r.label,incumbencies:histories};seed.slots.push(slot);map.set(r.slotId,slot);added.push(r.slotId);}
 }
 assert.equal(added.length,5);assert.equal(seed.slots.length,22);
 assert.ok(raw.version.assignments.every(r=>!added.includes(r.ownerSlotId)), 'five historical extras must be unreferenced by original duties');
 assert.ok(raw.version.slotAvailability.every(r=>!added.includes(r.slotId)), 'no new hours/capabilities for historical extras');
 const empty=new Set(),occupancy=[];
 for(const s of seed.slots.filter(s=>s.contractorCapacity!==true)){
  const each=days.map(day=>s.incumbencies.filter(r=>r.effectiveStart<=day&&(r.effectiveEnd===null||day<r.effectiveEnd)));
  assert.ok(each.every(r=>r.length<=1),'overlapping recorded history');
  assert.ok(each.every(r=>r.length===1)||each.every(r=>r.length===0),'no invented midweek transition');
  if(each.every(r=>r.length===0)){
   assert.ok(raw.version.vacancyCapableSlotIds.includes(s.id),'empty position was not originally vacancy-capable');empty.add(s.id);
  }
  occupancy.push({slotId:s.id,days:days.map((date,n)=>({date,personId:each[n][0]?.personId??null}))});
 }
 seed.versions[0].vacantSlotIds=[...empty].sort();
 const changedAvailability=[];
 seed.versions[0].slotAvailability=raw.version.slotAvailability.map(r=>{
  const slot=map.get(r.slotId);assert.ok(slot&&slot.contractorCapacity!==true);
  assert.ok(['working','vacant_unfilled'].includes(r.status),'unexpected original availability status');
  const next={...clone(r),status:empty.has(r.slotId)?'vacant_unfilled':'working'};
  const {status:oldStatus,...oldRest}=r,{status:newStatus,...newRest}=next;
  assert.deepEqual(newRest,oldRest,'every original hour/lunch/capability/eligibility byte-value retained');
  if(oldStatus!==newStatus)changedAvailability.push({slotId:r.slotId,dayOfWeek:r.dayOfWeek,before:oldStatus,after:newStatus});
  return next;
 });
 for(const s of raw.slots){const {incumbencies:oldHistory,...oldRest}=s,{incumbencies:newHistory,...newRest}=map.get(s.id);assert.deepEqual(newRest,oldRest);}
 assert.deepEqual(seed.versions[0].assignments,raw.version.assignments);
 assert.deepEqual(seed.proximity,raw.proximity);
 assert.equal(seed.slots.filter(s=>s.contractorCapacity===true).length,8);
 assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(recorded),rosterBefore);
 return {seed,transformation:{schema:'custodial.synthetic-original314-recorded22-predecessor.v1',
  classification:'SYNTHETIC_FACT_DERIVED_FIXTURE_NOT_CURRENT_AUTHORITY',anchorCivilDate,
  previousMonday,dateRule:'existing driver: Monday of anchorCivilDate minus one day',
  originalSourceId:fixture.sourceId,originalSourceDigest:fixture.sourceDigest,
  recordedParent:clone(recorded.parentPublication),recordedServiceDate:recorded.serviceDate,
  originalAssignments:314,originalSlots:17,recordedSlots:22,addedUnreferencedSlotIds:added,
  vacancyHydration:[...empty].sort(),occupancy,changedAvailability,
  originalHoursLunchQualificationsRestrictionsWeightsDutiesProximityUnchanged:true,
  noShiftEndOrFullLunchPolicyAdded:true,noEarlyFutureHireFill:true,
  approved346BaselinePublished:false,solverReceiptInjected:false,registration:false,publication:false}};
}
