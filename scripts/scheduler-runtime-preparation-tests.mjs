import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as current from '../src/static-weekly-schedule-program.js';
import * as prior from './fixtures/runtime-predecessor/static-weekly-schedule-program.js';
import {installStaticWeeklySha256HexAccelerator as installCurrent} from '../src/static-weekly-schedule-model.js';
import {installStaticWeeklySha256HexAccelerator as installPrior} from './fixtures/runtime-predecessor/static-weekly-schedule-model.js';
import {fullHourLunchFixture} from './fixtures/full-hour-lunch-source.mjs';
import {createSyntheticFullNineReductionFixture} from './static-weekly-recurring-phase-authority-tests.mjs';
import {createFullNineReductionContext,deriveRecurringStaffingPattern,createRecurringPhaseSourceBasis} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringPhaseWeekInvocation,createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource} from '../src/static-weekly-recurring-phase-authority.js';
import {initializeStaticWeeklySolverEngine} from '../src/static-weekly-schedule-solver-worker.js';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');installCurrent(hash);installPrior(hash);
const capture=(fn,input)=>{try{return {returned:fn(input)};}catch(error){return {thrown:{name:error.name,message:error.message,code:error.code}};}};
let checks=0,invocationChecks=0;
const compare=(name,input)=>{const before=JSON.stringify(input),left=capture(prior.prepareStaticWeeklySchedulingProblem,input),right=capture(current.prepareStaticWeeklySchedulingProblem,input);assert.deepEqual(right,left,name);assert.equal(JSON.stringify(input),before,name+' input mutation');const facts=capture(current.prepareStaticWeeklyDescriptorFacts,input);if(left.thrown||left.returned?.error)assert.deepEqual(facts,left,name+' descriptor refusal');else assert.deepEqual(facts.returned,{availabilityByDaySlot:left.returned.availabilityByDaySlot,incumbencyByDaySlot:left.returned.incumbencyByDaySlot},name+' validated descriptor facts');const modelFacts=capture(current.prepareStaticWeeklyHardModelFacts,input);if(left.thrown||left.returned?.error)assert.deepEqual(modelFacts,left,name+' model refusal');else {const expected={};for(const field of ['slots','work','candidates','availabilityByDaySlot','edges','exactEquityScale','inputDigest','preflight'])expected[field]=left.returned[field];assert.deepEqual(modelFacts.returned,expected,name+' hard model inputs');const objective={name:'selected_normal_hard_feasibility',family:'required_coverage',terms:[]};assert.deepEqual(current.buildStaticWeeklySchedulingModel(modelFacts.returned,[],objective),prior.buildStaticWeeklySchedulingModel(left.returned,[],objective),name+' complete canonical hard model');}checks++;console.log('PASS exact preparation',name);return right.returned;};
const {input}=fullHourLunchFixture();const good=compare('full hour lunch',input);assert.ok(good&&!good.error);
for(const [name,change]of [
 ['invalid weekday',x=>x.versions[0].assignments[0].dayOfWeek=7],
 ['duplicate work identity',x=>x.versions[0].assignments.push(structuredClone(x.versions[0].assignments[0]))],
 ['changed work provenance',x=>delete x.versions[0].assignments[0].qualificationProvenance],
 ['duplicate slot identity',x=>x.slots.push(structuredClone(x.slots[0]))],
 ['wrong lunch digest',x=>x.versions[0].lunchCoveragePolicy.policyDigest='0'.repeat(64)],
 ['invalid proximity',x=>x.proximity.push({from:'unexpected',to:'absent',minutes:-1,source:'synthetic invalid edge'})],
 ['invalid exception',x=>x.exceptions.push({id:'bad',type:'unknown'})],
 ['null lunch policy',x=>x.versions[0].lunchCoveragePolicy=null],
]){const changed=structuredClone(input);change(changed);compare(name,changed);}
const canonicalBefore=JSON.stringify(good.canonicalInput);good.baselineCanonicalInput.slots[0].label='mutation';assert.equal(JSON.stringify(good.canonicalInput),canonicalBefore);compare('later call cannot reuse mutated returned view',input);
const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4});
for(const count of [6,7,8]){
 const args=createSyntheticFullNineReductionFixture(count),context=createFullNineReductionContext(args),normal=deriveRecurringStaffingPattern({currentConfig:context.currentConfig,targetSlots:context.currentConfig.slots,fullOwners:args.fullOwners,fullConfig:args.fullConfig,highs:{solve:(lp,options)=>solver.solve(lp,{timeLimitSeconds:options.time_limit}).result}}),basis=createRecurringPhaseSourceBasis({registeredSource:args.publishedSource.compiler_input,patternConfig:normal.config,reductionContext:context});
 const invocation=createRecurringPhaseWeekInvocation(),dayOfWeek=0,selectedWorkIds=basis.source.version.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window.start==='09:45').map(r=>r.workId),
  descriptorInput={source:basis.source,ownerConfig:basis.ownerConfig,dayOfWeek,selectedWorkIds},
  descriptor=createRecurringPhaseDescriptor(descriptorInput),selection=descriptor.choices.map(c=>({workId:c.workId,slotId:c.owners[0].slotId})),
  rebound=invocation.rebind({...descriptorInput,selection});
 assert.deepEqual(Object.keys(invocation).sort(),['assertPreference','rebind','solve']);invocationChecks++;
 assert.deepEqual(rebound,{descriptor,candidate:createRecurringPhaseProspectiveSource({...descriptorInput,descriptor,selection})});invocationChecks++;
 assert.deepEqual(invocation.rebind({...descriptorInput,selection,descriptor:{sourceDigest:'forged'},skipValidation:true}),rebound);invocationChecks++;
 for(const bad of [selection.slice(1),[...selection,selection[0]],selection.map((x,i)=>i?x:{...x,slotId:'foreign-owner'})]){assert.throws(()=>invocation.rebind({...descriptorInput,selection:bad}));invocationChecks++;}
 const changed=structuredClone(descriptorInput);changed.source.version.assignments.push(structuredClone(changed.source.version.assignments[0]));assert.throws(()=>invocation.rebind({...changed,selection}));invocationChecks++;
 const renamed=structuredClone(descriptorInput);renamed.source.slots[0].label+=' changed label';const fresh=createRecurringPhaseDescriptor(renamed),updated=invocation.rebind({...renamed,selection});assert.deepEqual(updated.descriptor,fresh);assert.notEqual(updated.descriptor.sourceDigest,rebound.descriptor.sourceDigest);invocationChecks++;
 const source=structuredClone(basis.source);source.versions=[source.version];delete source.version;
 const prepared=compare('actual reduction '+count,source);assert.ok(prepared&&!prepared.error,JSON.stringify(prepared?.error));
 for(const [name,change]of [
  ['named handoff source',x=>x.versions[0].shiftEndContinuityPolicy.namedHandoffs[0].fromSlotId='invalid'],
  ['source package points',x=>x.versions[0].assignments.find(r=>r.window.start==='09:45').serviceEffortMinutes++],
  ['source owner shift',x=>x.versions[0].slotAvailability[0].shift.end='08:00'],
  ['current incumbent',x=>x.slots.find(s=>s.incumbencies?.length).incumbencies.at(-1).displayName='changed actual name'],
 ]){const changed=structuredClone(source);change(changed);compare(count+' '+name,changed);}
}
console.log(JSON.stringify({status:'PASS',checks,invocationChecks,comparison:'complete prepared result and descriptor/hard-model projections including Maps, all canonical inputs/digests/preflight, full hard-model output and refusals',baseline:'exact prior runtime',current:'separate successor',SQL:false,provider:false,app_build:false,phone:false}));
