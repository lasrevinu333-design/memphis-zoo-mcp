import assert from 'node:assert/strict';
import {createSyntheticFullNineReductionFixture} from '../static-weekly-recurring-phase-authority-tests.mjs';
import {loadCurrentManagerPublicationFixture} from './current-manager-publication-source.mjs';
import {targetSlotsFromManagerRoster,recurringOwnerLunch} from '../../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringCorrectionBinding,recurringCorrectionWitness,
  RECURRING_CORRECTION_BINDING_SCHEMA} from '../../src/static-weekly-recurring-correction-binding.js';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-compiler.js';

export const SYNTHETIC_CORRECTION_SOURCE_ID='81000000-0000-4000-8000-000000000001';

// Test-only distinct registered source. Current323 work and provenance come
// from the pinned current handout fixture; retained historical313 work/split
// rows come from the separate accepted synthetic publication. Incumbency
// hydration is made coherent with THAT fixture's authenticated dated roster,
// not selected from a count, browser request, source-list order, or production.
export function createSyntheticRegisteredCurrentCorrectionReductionFixture(count){
 const input=createSyntheticFullNineReductionFixture(count),
  current=structuredClone(loadCurrentManagerPublicationFixture().packet.compilerInput),
  targetSlots=targetSlotsFromManagerRoster({templateConfig:input.correctionConfig,
    managerSnapshot:input.managerSnapshot,effectiveDate:input.effectiveDate,
    expectedRevision:input.expectedRevision});
 assert.equal(input.publishedSource.compiler_input.version.assignments.length,313);
 assert.equal(current.version.assignments.length,323);
 current.slots=structuredClone(input.publishedSource.compiler_input.slots);
 current.version.vacantSlotIds=Object.values(targetSlots).filter(slot=>slot.vacancy===true)
  .map(slot=>slot.slotId).sort();
 for(const row of current.version.slotAvailability){
  const slot=Object.values(targetSlots).find(s=>s.slotId===row.slotId);
  if(!slot)continue;
  assert.ok(slot.workDays.includes(row.dayOfWeek),'current correction cannot add an unapproved workday');
  row.status=slot.vacancy===true?'vacant_unfilled':'working';
  row.shift={start:slot.shift[0],end:slot.shift[1]};
  row.lunch=recurringOwnerLunch(slot,row.dayOfWeek);
 }
 // The accepted original day ledger intentionally has no Karen/Tammy Monday
 // or OPTION4 Saturday. Those are separate explicitly registered current-day
 // corrections, never borrowed from another original day or defaulted to 0.
 const missing=[['KAREN',1],['TAMMY',1],['OPTION4',6]];
 input.publishedSource.compiler_input.version.slotAvailability=
  input.publishedSource.compiler_input.version.slotAvailability.filter(row=>
   !missing.some(([key,day])=>row.slotId===targetSlots[key].slotId&&row.dayOfWeek===day));
 input.correctionSource={source_id:SYNTHETIC_CORRECTION_SOURCE_ID,compiler_input:current};
 const binding=createRecurringCorrectionBinding({schema:RECURRING_CORRECTION_BINDING_SCHEMA,
   sourceId:SYNTHETIC_CORRECTION_SOURCE_ID,canonicalDigest:postgresJsonbContentDigest(current)});
 input.managerSnapshot.sources=[{source_id:input.publishedSource.source_id,
   source_digest:postgresJsonbContentDigest(input.publishedSource.compiler_input)},
  {source_id:binding.sourceId,source_digest:binding.canonicalDigest}];
 input.managerSnapshot.availability=[];
 input.correctionWitness=recurringCorrectionWitness({binding,snapshot:input.managerSnapshot,
  patternSource:input.publishedSource,correctionSource:input.correctionSource,
  effectiveWeek:input.effectiveDate,expectedRevision:input.expectedRevision,
  recurringGeneration:1,effectivePublicationId:input.managerSnapshot.current_publication.publication_id});
 return input;
}
