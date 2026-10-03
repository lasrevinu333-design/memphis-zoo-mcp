import assert from 'node:assert/strict';
import {createSyntheticFullNineReductionFixture} from '../static-weekly-recurring-phase-authority-tests.mjs';
import {createSyntheticRegisteredCurrentCorrectionReductionFixture} from './registered-current-correction-reduction.mjs';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-compiler.js';

// Only a disposable SQL fixture. The historical publication is created while
// all nine synthetic incumbents are present. Three later immediate, official
// vacancy commands close those incumbencies; the distinct current correction
// is registered with the resulting six-person source authority. No source
// assignment, original person ID, work package, or accepted day is rewritten.
export function createDualSourceRegisteredCorrectionSqlSource(){
 const published=createSyntheticFullNineReductionFixture(6),
  correctionFixture=createSyntheticRegisteredCurrentCorrectionReductionFixture(6),
  historical=structuredClone(published.publishedSource.compiler_input),
  current=structuredClone(correctionFixture.correctionSource.compiler_input),
  original=structuredClone(published.fullNineSource.compiler_input),
  week=published.effectiveDate,syntheticServiceDate='2026-10-02';
 assert.equal(week,'2026-10-05');
 assert.equal(historical.version.assignments.length,313);
 assert.equal(current.version.assignments.length,323);
 assert.equal(original.version.assignments.length,314);
 assert.notEqual(published.publishedSource.source_id,correctionFixture.correctionSource.source_id);
 const former=[];
 for(const [key,slot]of Object.entries(published.correctionConfig.slots).filter(([,slot])=>slot.vacancy===true)){
  const past=historical.slots.find(row=>row.id===slot.slotId),now=current.slots.find(row=>row.id===slot.slotId);
  assert.ok(past&&now,`stable synthetic vacancy position ${key} missing`);
  const predecessor=past.incumbencies.at(-1),currentPredecessor=now.incumbencies.at(-1);
  assert.equal(predecessor.effectiveEnd,week,`historical ${key} synthetic end must be explicit`);
  assert.equal(currentPredecessor.personId,predecessor.personId,`current ${key} former identity changed`);
  predecessor.effectiveEnd=null;
  currentPredecessor.effectiveEnd=syntheticServiceDate;
  former.push({key,slotId:slot.slotId,personId:predecessor.personId,
   personName:predecessor.displayName});
 }
 assert.equal(former.length,3);
 assert.deepEqual(historical.version.vacantSlotIds,[]);
 assert.deepEqual([...current.version.vacantSlotIds].sort(),former.map(row=>row.slotId).sort());
 assert.equal(postgresJsonbContentDigest(historical.version.assignments),
  postgresJsonbContentDigest(published.publishedSource.compiler_input.version.assignments));
 assert.equal(postgresJsonbContentDigest(current.version.assignments),
  postgresJsonbContentDigest(correctionFixture.correctionSource.compiler_input.version.assignments));
 return {schema:'custodial.synthetic-dual-source-registered-correction-sql.v1',
  classification:'ISOLATED_SOURCE_PREP_ONLY_NOT_PRODUCTION_REGISTRATION',week,syntheticServiceDate,
  original:{sourceId:published.fullNineSource.source_id,compilerInput:original,
   sourceDigest:postgresJsonbContentDigest(original)},
  historical:{sourceId:published.publishedSource.source_id,compilerInput:historical,
   sourceDigest:postgresJsonbContentDigest(historical)},
  correction:{sourceId:correctionFixture.correctionSource.source_id,compilerInput:current,
   sourceDigest:postgresJsonbContentDigest(current)},former};
}
