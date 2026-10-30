import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {prepareApprovedManualCapacityTransition} from '../src/approved-manual-roster-transition.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {installStaticWeeklySha256HexAccelerator,snapshotContractorCapacity} from '../src/static-weekly-schedule-model.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
assert.ok(process.argv.length===2||(process.argv.length===3&&isAbsolute(process.argv[2])));
const out=process.argv[2];if(out)fs.mkdirSync(out,{mode:0o700});
const save=(file,x)=>{if(out)fs.writeFileSync(resolve(out,file),JSON.stringify(x,null,2)+'\n',{flag:'wx',mode:0o600});};
const recorded=JSON.parse(fs.readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url)));
assert.equal(recorded.classification,'RECORDED_READ_ONLY_FACTS_NOT_FRESH_AUTHORITY');
const week=readApprovedManualWeek(),draft=prepareApprovedManualSourceDraft({week,
 referenceBytes:fs.readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),snapshot=recorded.readback,
 selection=draft.sourceDraft.slots.filter(s=>s.contractorCapacity).map((slot,i)=>({legacy_slot_id:slot.id,new_capacity_id:randomUUID(),capacity_code:`CoverAll0${i+1}`})),
 original=digest({week,draft,snapshot,selection}),prepare=(mapping=selection)=>prepareApprovedManualCapacityTransition({week,draft,snapshot,selection:mapping}),plan=prepare();
assert.equal(plan.serviceDate,snapshot.serviceDate);assert.equal(plan.status,'DATA_REQUIRES_NATIVE_ATOMIC_ADMISSION');
assert.equal(plan.existingRosterPositions,22);assert.equal(plan.additionalNonemployeeCapacityPositions,8);assert.equal(plan.expectedTotalRosterPositions,30);
assert.equal(plan.unchangedPositionIds.length,9);assert.equal(plan.newCapacityIds.length,8);assert.equal(plan.historicalCapacitySlotIds.length,8);
for(const id of plan.newCapacityIds)assert.ok(!snapshot.rosterSlots.some(s=>s.slotId===id));
const typed=plan.projectedSourceDraft.slots.filter(s=>s.contractorCapacity);
assert.equal(typed.length,8);for(const slot of typed){const owner=snapshotContractorCapacity(slot,plan.serviceDate);assert.equal(owner.personId,null);assert.deepEqual(slot.incumbencies,[]);}
assert.deepEqual(plan.projectedSourceDraft.version.assignments,draft.sourceDraft.version.assignments);
assert.deepEqual(plan.projectedSourceDraft.version.lunchCoveragePolicy,draft.sourceDraft.version.lunchCoveragePolicy);
assert.deepEqual(plan.projectedSourceDraft.version.slotAvailability,draft.sourceDraft.version.slotAvailability);
assert.deepEqual(plan.preservedLiveHistoryDigests,snapshot.rosterSlots.map(s=>({slotId:s.slotId,digest:digest(s)})));
for(const change of [x=>x.pop(),x=>{x[1].new_capacity_id=x[0].new_capacity_id;},x=>{x[0].new_capacity_id=snapshot.rosterSlots[0].slotId;},
 x=>{x[0].legacy_slot_id=week.referenceBindings.people[0].slotId;},x=>{x[1].capacity_code=x[0].capacity_code;},x=>{x[0].extra='unbound';}]){
 const bad=structuredClone(selection);change(bad);assert.throws(()=>prepare(bad));
}
assert.equal(digest({week,draft,snapshot,selection}),original);
for(const flag of ['source301AdmissionEligible','registrationEligible','publicationEligible','productionWritten','legacyRowsChanged','normalSchedulesChanged'])assert.equal(plan[flag],false);
save('DATA_PLAN.json',plan);
const result={status:'PASS',scope:'Pure current-date DATA preparation over a recorded readback, using the existing capacity transition mapping; not fresh authority or registration',
 originalPositions:22,additionalTypedCapacityPositions:8,prospectiveTotalPositions:30,newEmployees:0,allHistoricalRangesPreserved:true,
 allApprovedNormalAssignmentsLunchesAndShiftsExact:true,sixInvalidMappingsRefused:true,productionWritten:false};
save('RESULT.json',result);console.log(JSON.stringify(result));
