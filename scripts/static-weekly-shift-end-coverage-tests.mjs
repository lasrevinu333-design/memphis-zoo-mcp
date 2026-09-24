import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completeRecurringShiftEndCoverage,validateRecurringShiftEndCoverage} from '../src/static-weekly-shift-end-coverage.js';
const packetPath=process.env.STATIC_WEEKLY_COVERAGE_PACKET;
assert.ok(packetPath,'explicit candidate packet is required; no production connection');
const packet=JSON.parse(readFileSync(packetPath,'utf8'));
const config=JSON.parse(readFileSync(new URL('../config/custodial-recurring-schedule-20260923.json',import.meta.url),'utf8'));
const input=packet.compilerInput,original=JSON.stringify(input);
assert.throws(()=>validateRecurringShiftEndCoverage(input,input,config),/coverage gap/,
 'the old all-week source must expose its missing afternoon handoffs');
const completed=completeRecurringShiftEndCoverage(input,config);
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
 const position=Object.values(config.slots).find(s=>s.slotId===row.ownerSlotId);
 assert.ok(row.window.start>=position.shift[0]&&row.window.end<=position.shift[1],
  'a later vacancy fill must not inherit responsibility outside its unchanged shift');
}
assert.ok(completed.notes.some(n=>n.fromVacantPosition),'a vacant early-ending responsibility needs a real staffed successor');
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
assert.deepEqual(completeRecurringShiftEndCoverage(input,config),completed,'repeat generation must be deterministic');
const missingTravel=structuredClone(input);missingTravel.proximity=[];
assert.throws(()=>completeRecurringShiftEndCoverage(missingTravel,config),/eligible on-duty handoff/,'missing proximity is not invented');
const offDuty=structuredClone(completed.input);
const departedHandoff=completed.notes.find(n=>!n.fromVacantPosition);
const bad=offDuty.version.assignments.find(r=>r.workId===departedHandoff.workId);
const originalOwner=departedHandoff.fromSlotId;
bad.ownerSlotId=originalOwner;
assert.throws(()=>validateRecurringShiftEndCoverage(input,offDuty,config),/off-duty recurring owner/,'ended shifts cannot remain responsible');
assert.ok(completed.notes.every(row=>!Object.values(config.slots).some(slot=>slot.slotId===row.toSlotId&&slot.name==='Alijah Collins'&&row.locationCode==='HERPETARIUM')),'Alijah restriction survives every handoff');
assert.ok(completed.input.version.assignments.every(row=>!row.workId.includes(':handoff:')||!config.mondayOnlyFamilies.includes(row.locationCodeSnapshot)),'gift-shop work never gains late handoffs');
const future=structuredClone(input);
for(const slot of future.slots.filter(s=>future.version.vacantSlotIds.includes(s.id))) {
 slot.incumbencies.push({personId:`SYNTHETIC-${slot.id}`,displayName:'TEST ONLY FUTURE HIRE',effectiveStart:future.serviceDate,effectiveEnd:null});
 for(const row of future.version.slotAvailability.filter(r=>r.slotId===slot.id))row.status='working';
}
future.version.vacantSlotIds=[];
const fullyStaffed=completeRecurringShiftEndCoverage(future,config);
assert.equal(fullyStaffed.validation.staffedDepartureByDay[4],'17:00','17:00 is legitimate only after the synthetic vacancy is actually filled');
assert.equal(fullyStaffed.validation.staffedDepartureByDay[5],'17:00');
const turnover=structuredClone(input),late=config.slots.OPTION1.slotId;
turnover.slots.find(s=>s.id===late).incumbencies.push({personId:'SYNTHETIC-LATE-HIRE',displayName:'TEST ONLY',effectiveStart:'2026-10-02',effectiveEnd:null});
turnover.version.vacantSlotIds=turnover.version.vacantSlotIds.filter(s=>s!==late);
const dated=completeRecurringShiftEndCoverage(turnover,config);
assert.equal(dated.validation.staffedDepartureByDay[4],'16:00','future hire must not count before their effective day');
assert.equal(dated.validation.staffedDepartureByDay[5],'17:00','actual dated hire changes staffed boundary');
const forged=structuredClone(completed.input);
forged.version.assignments.find(r=>r.workId.includes(':handoff:')).ownerSlotId=config.slots.OPTION1.slotId;
assert.throws(()=>validateRecurringShiftEndCoverage(input,forged,config),/vacancy cannot receive|off-duty/);
assert.equal(JSON.stringify(input),original,'synthetic future staff never enter the real source');
console.log(JSON.stringify({assertions:'all passed',failed:0,handoffRows:completed.notes.length,...completed.validation,
 geography_review:'separate; existing proposed geography is not accepted by this test',physical_verification:false},null,2));
