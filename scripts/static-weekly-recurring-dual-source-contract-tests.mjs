import assert from 'node:assert/strict';
import {createSyntheticRegisteredCurrentCorrectionReductionFixture} from './fixtures/registered-current-correction-reduction.mjs';
import {createFullNineReductionContext,currentPatternFromPublishedReadback,createRecurringMorningWeekSourceBasis,
  assertRecurringMorningWeekSourceBasis} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringMorningObjectiveContract} from '../src/static-weekly-recurring-morning-solver.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-compiler.js';

let checks=0;
const check=(predicate,label)=>{assert.ok(predicate,label);checks++;};
const rejects=(run,label)=>{assert.throws(run,label);checks++;};
const sourceId='81000000-0000-4000-8000-000000000001';
const input=createSyntheticRegisteredCurrentCorrectionReductionFixture(6);
const context=createFullNineReductionContext(input),basis=createRecurringMorningWeekSourceBasis({
 registeredSource:input.publishedSource.compiler_input,currentConfig:context.currentConfig,
 reductionContext:context,targetEffectiveDate:input.effectiveDate});
const readback=currentPatternFromPublishedReadback({publishedSource:input.publishedSource,
 managerSnapshot:input.managerSnapshot,templateConfig:input.correctionConfig,fullConfig:input.fullConfig,
 fullOwners:input.fullOwners,fullNineSource:input.fullNineSource,
 correctionSource:input.correctionSource,correctionWitness:input.correctionWitness,
 effectiveDate:input.effectiveDate,expectedRevision:input.expectedRevision});
check(readback.reductionContext?.contextDigest===context.contextDigest,
 'authenticated pattern readback retains the same two-source reduction context');
check(assertRecurringMorningWeekSourceBasis(basis)===true,'independently reconstructed historical/current basis');
check(context.registeredCorrectionSourceDigest&&context.correctionWitness.digest===input.correctionWitness.digest,
 'distinct registered correction identity and locked witness retained');
check(context.acceptedSourceDigest!==context.registeredCorrectionSourceDigest,
 'historical and current source bytes are never coalesced');
const missing=context.dayAvailabilityReferences.filter(r=>r.kind==='CURRENT_CORRECTION_NEW_DAY');
check(missing.length===3&&missing.every(r=>r.currentCorrectionDigest),'three missing original days have exact current source rows');
check(context.comparisonLedger.some(r=>r.referenceKind==='AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE'),
 'Admin current-correction owner is classified separately from historical family');
check(context.comparisonLedger.some(r=>r.referenceKind==='EXISTING_DOMINANT_POINT_SHARE_FAMILY_PREFERENCE_ONLY'),
 'historical split family ledger is retained');

for(let day=0;day<7;day++){
 const source=basis.source,ownerConfig=basis.ownerConfig,
  reference={schema:'custodial.original-target-morning-reference.v1',
   reductionContextDigest:context.contextDigest,historicalSource:basis.originalRegisteredSource,
   currentCorrectionSource:context.registeredCorrectionSource,
   dayAvailabilityReferences:basis.dayAvailabilityReferences,
   morningComparisonLedger:context.comparisonLedger.filter(r=>r.phase==='morning')},
  request={planningInput:{source,ownerConfig,bindings:{sourceDigest:digest(source),ownerConfigDigest:digest(ownerConfig)},
   scope:'NEW_RECURRING_MORNING_DESIGN',dayOfWeek:day,selectedWorkIds:basis.days[day].selectedWorkIds},
   fullOwners:input.fullOwners,originalReference:reference},
  contract=createRecurringMorningObjectiveContract(request);
 check(contract.status==='OBJECTIVE_CONTRACT_ONLY'&&contract.originalReferenceDigest,
  `day ${day} binds distinct reference without solver or publication`);
 const changed=context.comparisonLedger.find(r=>r.phase==='morning'&&r.day===day&&
  source.version.assignments.some(s=>s.dayOfWeek===day&&s.locationCodeSnapshot===r.family&&
   s.window.end==='09:45'&&s.originSlotId!==r.referenceSlotId));
 if(changed){
  const choice=contract.choices.find(c=>c.family===changed.family),targetRow=source.version.assignments.find(s=>s.workId===choice.workId),
   target=contract.options.find(o=>o.workId===choice.workId&&o.slotId===targetRow.originSlotId);
  if(target)check(target.preferenceCost>=100,
   `day ${day} preserves historical original-owner 100 cost when current seed owner differs`);
 }
}
const noCorrection=structuredClone(input);delete noCorrection.correctionSource;delete noCorrection.correctionWitness;
rejects(()=>createRecurringMorningWeekSourceBasis({registeredSource:input.publishedSource.compiler_input,
 currentConfig:context.currentConfig,reductionContext:{...context,registeredCorrectionSource:null},targetEffectiveDate:input.effectiveDate}),
 'missing registered correction refuses historical transition');
const altered=structuredClone(context);altered.registeredCorrectionSource.version.slotAvailability.find(r=>
 r.dayOfWeek===1&&r.slotId===input.correctionConfig.slots.KAREN.slotId).acceptedRouteAnchorLocationId=sourceId;
rejects(()=>createRecurringMorningWeekSourceBasis({registeredSource:input.publishedSource.compiler_input,
 currentConfig:context.currentConfig,reductionContext:altered,targetEffectiveDate:input.effectiveDate}),
 'changed current-correction anchor refuses independently reconstructed basis');
const changedWitness=structuredClone(input);changedWitness.correctionWitness={...input.correctionWitness,digest:'c'.repeat(64)};
rejects(()=>createFullNineReductionContext(changedWitness),'forged locked witness refuses');
for(const count of [7,8]){
 const fixture=createSyntheticRegisteredCurrentCorrectionReductionFixture(count),
  reduced=createFullNineReductionContext(fixture),
  future=createRecurringMorningWeekSourceBasis({registeredSource:fixture.publishedSource.compiler_input,
    currentConfig:reduced.currentConfig,reductionContext:reduced,targetEffectiveDate:fixture.effectiveDate});
 check(future.source.version.assignments.length===323&&
  reduced.dayAvailabilityReferences.filter(r=>r.kind==='CURRENT_CORRECTION_NEW_DAY').length===3&&
  assertRecurringMorningWeekSourceBasis(future),
  `current ${count} target remains a distinct registered current correction with historical split ledger`);
}
console.log(JSON.stringify({status:'PASS',checks,scope:'pure historical313/current323 distinct source and objective contract; no solver, SQL, registration or admission'}));
