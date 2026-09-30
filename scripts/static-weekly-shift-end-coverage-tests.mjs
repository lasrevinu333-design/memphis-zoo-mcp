import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRecurringShiftEndCoverage} from '../src/static-weekly-shift-end-coverage.js';
import {deriveDatedShiftEndCoverage} from '../src/static-weekly-shift-end-derivation.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
const packetPath=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(packetPath,'explicit candidate packet is required; no production connection');
const packet=JSON.parse(readFileSync(packetPath,'utf8'));
const ownerConfig=JSON.parse(readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url),'utf8'));
const input=packet.compilerInput,original=JSON.stringify(input);
// The production compiler derives these position facts from the canonical
// source. The old September 23 config omits the empty position's source-bound
// route anchor and must not be spliced into this official candidate test.
const config={slots:{},weights:input.version.shiftEndContinuityPolicy.weights,
 sourceBoundEligibility:true,fullSegmentIdentity:true};
for(const slot of input.slots){
 const availability=input.version.slotAvailability.filter(row=>row.slotId===slot.id);
 if(!availability.length)continue;
 config.slots[slot.id]={slotId:slot.id,workDays:availability.map(row=>row.dayOfWeek),
  datedAvailability:Object.fromEntries(availability.map(row=>[row.dayOfWeek,{
   shift:[row.shift.start,row.shift.end],lunch:[row.lunch.start,row.lunch.end],
   status:row.status,qualifications:row.qualifications,restrictions:row.restrictions,
   acceptedRouteAnchorLocationId:row.acceptedRouteAnchorLocationId||null,
  }]))};
}
assert.throws(()=>validateRecurringShiftEndCoverage(input,input,config),/coverage gap/,
 'the old all-week source must expose its missing afternoon handoffs');
const completed=deriveDatedShiftEndCoverage(input,postgresJsonbContentDigest);
const saturdayCatParent=input.version.assignments.find(r=>r.dayOfWeek===6
 &&r.window.start==='09:45'&&r.locationCodeSnapshot==='CAT_COUNTRY');
assert.ok(saturdayCatParent,'Saturday Cat Country parent required');
const saturdayCatChain=completed.input.version.assignments.filter(r=>r.dayOfWeek===6
 &&(r.workId===saturdayCatParent.workId||r.workId.startsWith(`${saturdayCatParent.workId}:`)))
 .sort((a,b)=>a.window.start.localeCompare(b.window.start));
assert.deepEqual(saturdayCatChain.map(r=>[r.ownerSlotId,r.window.start,r.window.end]),[
 [ownerConfig.slots.KAREN.slotId,'09:45','14:00'],
 [ownerConfig.slots.ALIJAH.slotId,'14:00','16:00'],
 [ownerConfig.slots.GREGORY.slotId,'16:00','17:00'],
],'named Saturday handoff must match the employee sheets without an intermediate Kathy reassignment');
assert.equal(saturdayCatChain.reduce((n,r)=>n+r.serviceEffortMinutes,0),3,
 'named handoff must conserve inherited workload without an invented extra point');
const changedNamed=structuredClone(input);
changedNamed.version.shiftEndContinuityPolicy.namedHandoffs[0].toSlotId=ownerConfig.slots.KATHY.slotId;
assert.throws(()=>deriveDatedShiftEndCoverage(changedNamed,postgresJsonbContentDigest),/identity mismatch/,
 'named employee handoff is bound by the immutable policy digest');
for(const day of [4,5])assert.ok(completed.input.version.assignments.filter(r=>r.dayOfWeek===day)
 .every(r=>r.window.end<='16:00'),'Thursday/Friday must end at real staffed departure, not a vacant 17:00 position');
assert.ok(completed.notes.every(n=>input.slots.find(s=>s.id===n.toSlotId)?.incumbencies.some(i=>
 i.effectiveStart<=input.serviceDate&&(!i.effectiveEnd||input.serviceDate<i.effectiveEnd))),
 'no vacant position may receive a handoff');
assert.equal(JSON.stringify(input),original,'input source must not mutate');
assert.ok(completed.notes.length>0,'must actually create handoff assignments');
assert.equal(completed.validation.coverageGaps,0);
assert.equal(completed.validation.duplicateLocations,0);
const sum=rows=>rows.reduce((n,r)=>n+r.serviceEffortMinutes,0);
assert.equal(sum(completed.input.version.assignments),sum(input.version.assignments),'retain exact existing workload-point budget');
assert.deepEqual(completed.input.slots,input.slots,'do not invent employees or overwrite incumbency history');
assert.deepEqual(completed.input.version.slotAvailability,input.version.slotAvailability,'do not change shifts or lunches');
for(const row of completed.input.version.assignments){
 const position=input.version.slotAvailability.find(s=>s.slotId===row.ownerSlotId&&s.dayOfWeek===row.dayOfWeek);
 assert.ok(position&&row.window.start>=position.shift.start&&row.window.end<=position.shift.end,
  'a later vacancy fill must not inherit responsibility outside its unchanged shift');
}
assert.equal(input.version.assignments.filter(r=>input.version.vacantSlotIds.includes(r.ownerSlotId)).length,0,
 'the six-person source removes normal work from all vacant positions');
assert.ok(completed.notes.length>0&&completed.notes.every(n=>!input.version.vacantSlotIds.includes(n.toSlotId)),
 'late physical handoffs go only to real staffed successors');
const fridayOpen=completed.openResponsibilities.find(n=>n.day===5&&n.at==='15:00'&&n.locationCode==='HERPETARIUM');
assert.ok(fridayOpen,'Friday Herpetarium must remain explicitly OPEN when the only real worker is restricted');
assert.equal(fridayOpen.personId,null);
assert.ok(!completed.notes.some(n=>n.workId===fridayOpen.workId),'OPEN is never reported as a physical handoff');
const broken=structuredClone(completed.input);
const addedIndex=broken.version.assignments.findIndex(r=>r.workId.includes(':handoff:'));
broken.version.assignments.splice(addedIndex,1);
assert.throws(()=>validateRecurringShiftEndCoverage(input,broken,config),/coverage gap/,'a missing handoff must fail');
const doubled=structuredClone(completed.input);
doubled.version.assignments.push(structuredClone(doubled.version.assignments.find(r=>r.workId.includes(':handoff:'))));
assert.throws(()=>validateRecurringShiftEndCoverage(input,doubled,config),/duplicate location/,'duplicate coverage must fail');
assert.deepEqual(deriveDatedShiftEndCoverage(input,postgresJsonbContentDigest),completed,'repeat generation must be deterministic');
const missingTravel=structuredClone(input);missingTravel.proximity=[];
assert.throws(()=>deriveDatedShiftEndCoverage(missingTravel,postgresJsonbContentDigest),/eligible on-duty handoff/,'missing proximity is not invented');
const offDuty=structuredClone(completed.input);
const departedHandoff=completed.notes.find(n=>!n.fromVacantPosition);
const bad=offDuty.version.assignments.find(r=>r.workId===departedHandoff.workId);
const originalOwner=departedHandoff.fromSlotId;
bad.ownerSlotId=originalOwner;
assert.throws(()=>validateRecurringShiftEndCoverage(input,offDuty,config),/off-duty recurring owner/,'ended shifts cannot remain responsible');
assert.ok(completed.notes.every(row=>!(row.toSlotId===ownerConfig.slots.ALIJAH.slotId&&row.locationCode==='HERPETARIUM')),'Alijah restriction survives every handoff');
assert.ok(completed.input.version.assignments.every(row=>!row.workId.includes(':handoff:')||!ownerConfig.mondayOnlyFamilies.includes(row.locationCodeSnapshot)),'gift-shop work never gains late handoffs');
const future=structuredClone(input);
for(const slot of future.slots.filter(s=>future.version.vacantSlotIds.includes(s.id))) {
 slot.incumbencies.push({personId:`SYNTHETIC-${slot.id}`,displayName:'TEST ONLY FUTURE HIRE',effectiveStart:future.serviceDate,effectiveEnd:null});
 for(const row of future.version.slotAvailability.filter(r=>r.slotId===slot.id))row.status='working';
}
future.version.vacantSlotIds=[];
const fullyStaffed=deriveDatedShiftEndCoverage(future,postgresJsonbContentDigest);
assert.equal(fullyStaffed.validation.staffedDepartureByDay[4],'17:00','17:00 is legitimate only after the synthetic vacancy is actually filled');
assert.equal(fullyStaffed.validation.staffedDepartureByDay[5],'17:00');
const turnover=structuredClone(input),late=ownerConfig.slots.OPTION1.slotId;
// Friday hire is relative to the tested Monday, including later recurring starts.
const hireDate=new Date(`${input.serviceDate}T12:00:00Z`);hireDate.setUTCDate(hireDate.getUTCDate()+4);
const fridayHireDate=hireDate.toISOString().slice(0,10);
turnover.slots.find(s=>s.id===late).incumbencies.push({personId:'SYNTHETIC-LATE-HIRE',displayName:'TEST ONLY',effectiveStart:fridayHireDate,effectiveEnd:null});
turnover.version.vacantSlotIds=turnover.version.vacantSlotIds.filter(s=>s!==late);
for(const row of turnover.version.slotAvailability.filter(r=>r.slotId===late&&(r.dayOfWeek===0||r.dayOfWeek>=5)))row.status='working';
const dated=deriveDatedShiftEndCoverage(turnover,postgresJsonbContentDigest);
assert.equal(dated.validation.staffedDepartureByDay[4],'16:00','future hire must not count before their effective day');
assert.equal(dated.validation.staffedDepartureByDay[5],'17:00','actual dated hire changes staffed boundary');
const forged=structuredClone(completed.input);
forged.version.assignments.find(r=>r.workId.includes(':handoff:')).ownerSlotId=ownerConfig.slots.OPTION1.slotId;
assert.throws(()=>validateRecurringShiftEndCoverage(input,forged,config),/vacancy cannot receive|off-duty/);
assert.equal(JSON.stringify(input),original,'synthetic future staff never enter the real source');
console.log(JSON.stringify({assertions:'all passed',failed:0,handoffRows:completed.notes.length,...completed.validation,
 geography_review:'separate; existing proposed geography is not accepted by this test',physical_verification:false},null,2));
