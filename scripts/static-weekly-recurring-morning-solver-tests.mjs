import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalJson,contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest as pg} from '../src/static-weekly-schedule-program.js';
import {createRecurringMorningObjectiveContract as contract,scoreRecurringMorningOwnership as score,
 enumerateRecurringMorningObjectiveOracle as oracle,createRecurringMorningProspectiveSource as prospective,
 solveRecurringMorningCanonicalMinimum as solve,assertRecurringMorningCanonicalProof as verify,
 RECURRING_MORNING_ERROR} from '../src/static-weekly-recurring-morning-solver.js';
const sha=x=>createHash('sha256').update(x).digest('hex'),clone=x=>structuredClone(x);
const read=(p,expected)=>{const bytes=fs.readFileSync(new URL(p,import.meta.url));assert.equal(sha(bytes),expected,'exact tracked synthetic input/config bytes');return JSON.parse(bytes);};
export function createMorningSolverTestInput({families=['CHINA'],dayOfWeek=1}={}){
 const fixture=read('./fixtures/six-person-absence-source.json','882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469'),source=fixture.compilerInput,
  ownerConfig=read('../config/custodial-six-person-static-20261005.json','40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30'),
  fullOwners=read('../config/custodial-full-nine-family-owners-20260926.json','f2dbf647910b140ee13af91fd949f5b5127da733b6234b1d572ee4b3ac1cd4e9').owners;
 assert.equal(pg(source),fixture.sourceDigest);assert.equal(fixture.sourceDigest,'ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a');
 assert.equal(fixture.provenance.classification,'LOCAL_UNPUBLISHED_CANONICAL_TEMPLATE_NOT_PRODUCTION_STATE');
 return {planningInput:{source,ownerConfig,bindings:{sourceDigest:pg(source),ownerConfigDigest:pg(ownerConfig)},
  scope:'NEW_RECURRING_MORNING_DESIGN',dayOfWeek,
  selectedWorkIds:source.version.assignments.filter(r=>r.dayOfWeek===dayOfWeek&&r.window.end==='09:45'&&families.includes(r.locationCodeSnapshot)).map(r=>r.workId)},fullOwners};
}
function rebind(x){x.planningInput.bindings={sourceDigest:pg(x.planningInput.source),ownerConfigDigest:pg(x.planningInput.ownerConfig)};return x;}
// Independent arithmetic/oracle: candidate membership is the bound contract's
// explicit domain, but this calculation does NOT call production score/model.
// It proves objective/ordering, not canonical feasibility or current roster auth.
function independent(c,selection){
 const loads=c.fixedLoads.slice(),counts=c.fixedCounts.slice(),chosen=selection.map(s=>c.options.find(o=>o.workId===s.workId&&o.slotId===s.slotId)||null);
 chosen.forEach(o=>{if(o){loads[o.ownerIndex]+=o.doubledAggregateWeight;counts[o.ownerIndex]++;}});
 if(counts.some(n=>n===0))return null;
 const a=loads.map((w,i)=>w+c.owners[i].startAdvantageDoubledWeight),sum=a.reduce((a,b)=>a+b,0),n=a.length,
  deviations=a.map(w=>Math.abs(n*w-sum)),coverage=c.priorityOrder.map(p=>c.choices.filter((x,i)=>x.sourceRow.priority===p&&!chosen[i]).length),
  g=chosen.reduce((s,o)=>s+(o?.geographyCost||0),0),preference=chosen.reduce((s,o)=>s+(o?.preferenceCost||0),0),
  identity=chosen.map(o=>o?.ownerIndex??n);
 return [...coverage,g,Math.max(...deviations),deviations.reduce((a,b)=>a+b,0),preference,...identity];
}
const compare=(a,b)=>a.reduce((d,v,i)=>d||v-b[i],0);
function independentOracle(c){let best=null,count=0;const visit=(i,s)=>{
 if(i<c.choices.length){const id=c.choices[i].workId;for(const slotId of [...c.options.filter(o=>o.workId===id).map(o=>o.slotId),null])visit(i+1,[...s,{workId:id,slotId}]);return;}
 count++;const vector=independent(c,s);if(vector&&(!best||compare(vector,best.vector)<0))best={vector,selection:s};};visit(0,[]);return {best,count};}
export function runRecurringMorningPureTests(){
 installStaticWeeklySha256HexAccelerator(sha);let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS morning pure',name);};
 const input=createMorningSolverTestInput({families:['CHINA','HERPETARIUM']}),before=canonicalJson(input),c=contract(input),actual=oracle(input),expected=independentOracle(c);
 check('source-required coverage precedes actual directed geography and exact start ladder',()=>{
  assert.deepEqual(c.objectiveOrder,['PLANNED_SOURCE_RESPONSIBILITY_COVERAGE_BY_EXISTING_PRIORITY','ANCHORED_DIRECTED_PACKAGE_PROXIMITY_COST',
   'START_LADDER_MAXIMUM_EXACT_DEVIATION','START_LADDER_TOTAL_EXACT_DEVIATION','INHERITED_100_4_2_PREFERENCE','COMPLETE_CODE_UNIT_IDENTITY']);
  assert.deepEqual(actual.minimum.vector,expected.best.vector);assert.equal(actual.visited,expected.count);assert.equal(actual.canonicalFeasibilityProven,false);
 });
 check('all enumerable selections match independently computed individual minimax/L1',()=>{
  for(const slot1 of [...c.options.filter(o=>o.workId===c.choices[0].workId).map(o=>o.slotId),null])
   for(const slot2 of [...c.options.filter(o=>o.workId===c.choices[1].workId).map(o=>o.slotId),null]){
    const s=[{workId:c.choices[0].workId,slotId:slot1},{workId:c.choices[1].workId,slotId:slot2}],ref=independent(c,s);
    if(ref)assert.deepEqual(score(input,s).vector,ref);else assert.throws(()=>score(input,s));}
 });
 check('opening responsibility beats any lower-tier improvement',()=>{assert.ok(compare([0,999,999,999,999,9],[1,0,0,0,0,0])<0);});
 check('directed geography beats any closer ladder/preference',()=>{assert.ok(compare([0,1,999,999,999,9],[0,2,0,0,0,0])<0);});
 check('minimax prevents residual dumping and L1 resolves same worst residual',()=>{
  assert.ok(compare([0,1,2,4,999],[0,1,3,3,0])<0);assert.ok(compare([0,1,2,4,999],[0,1,2,5,0])<0);
 });
 const selected=(china,herp)=>c.choices.map(p=>({workId:p.workId,slotId:c.owners[p.family==='CHINA'?china:herp]?.slotId??null}));
 check('actual source priorities rank uncovered CHINA before uncovered Herpetarium',()=>{
  const low=independent(c,selected(4,null)),high=independent(c,selected(null,1));
  assert.deepEqual(low.slice(0,2),[0,1]);assert.deepEqual(high.slice(0,2),[1,0]);assert.ok(compare(low,high)<0);
 });
 check('actual directed geography wins over a strictly better source ladder',()=>{
  const compact=independent(c,selected(4,3)),balanced=independent(c,selected(4,1));
  assert.ok(compact[2]<balanced[2]);assert.equal(compact[3],balanced[3]);assert.ok(compact[4]>balanced[4]);assert.ok(compare(compact,balanced)<0);
 });
 check('actual same-geography minimax beats cheaper familiar-owner preference',()=>{
  const fair=independent(c,selected(4,3)),familiar=independent(c,selected(4,2));
  assert.equal(fair[2],familiar[2]);assert.ok(fair[3]<familiar[3]);assert.ok(fair[5]>familiar[5]);assert.ok(compare(fair,familiar)<0);
 });
 check('exact declared synthetic directed-cost tie exposes real L1 refinement',()=>{
  const x=clone(input),o=c.options.find(o=>o.family==='HERPETARIUM'&&o.ownerIndex===1),p=c.choices.find(p=>p.family==='HERPETARIUM');
  // Test-only declared source graph change, independently rebound. Not a new
  // operational edge, same-shape shortcut, or fabricated engine outcome.
  x.planningInput.source.proximity.find(e=>e.fromLocationId===o.originalAnchorLocationId&&e.toLocationId===p.primaryLocationId).minutes=2;rebind(x);
  const tied=contract(x),best=oracle(x),reference=independentOracle(tied),first=independent(tied,selected(4,1)),second=independent(tied,selected(4,3));
  assert.equal(first[2],second[2]);assert.equal(first[3],second[3]);assert.ok(first[4]<second[4]);assert.ok(compare(first,second)<0);
  assert.deepEqual(best.minimum.vector,reference.best.vector);assert.equal(canonicalJson(input),before);
 });
 check('exact halfhour offset implements source start-hour ladder, not minutes utilization',()=>{
  for(const o of c.owners){const start=o.baselineAvailability.shift.start.split(':').map(Number),first=c.owners.map(x=>x.baselineAvailability.shift.start.split(':').map(Number)).map(([h,m])=>h*60+m);
   assert.equal(o.startAdvantageDoubledWeight,((start[0]*60+start[1])-Math.min(...first))/30);}
  assert.equal(c.integerWeightScale,2);assert.equal(c.aggregateWeightUnit,'AUTHORIZED_AGGREGATE_SCHEDULE_WORKLOAD_WEIGHT');
  assert.equal(c.descriptor.inheritedWorkloadUnit,'dimensionless_production_workload_points');
 });
 check('incomplete member weights stay partial without losing exact aggregate authority',()=>{
  assert.ok(c.descriptor.packages.some(p=>!p.componentLoadComplete));assert.ok(c.descriptor.packages.filter(p=>!p.componentLoadComplete).every(p=>p.physicalMembers.some(m=>m.componentWeight===null)));
  assert.ok(c.choices.every(p=>Number.isFinite(p.configAggregateWeight)));assert.equal(c.compulsoryFull,false);assert.equal(c.missingCriticalClassification,true);
 });
 check('response-only Cat/Primate remain area bindings with zero physical cleaning members',()=>{
  for(const family of ['CAT_COUNTRY','PRIMATE_CANYON']){const p=c.descriptor.packages.find(p=>p.family===family);
   assert.equal(p.sourceRow.serviceMode,'response_only_no_clean');assert.deepEqual(p.physicalMembers,[]);assert.equal(p.responseOnlyWeight,0.5);}
 });
 check('Admin-only missing historical morning preference uses exact existing source authority',()=>{
  const x=createMorningSolverTestInput({families:['EAST_ADMIN','WEST_ADMIN']}),a=contract(x);
  assert.equal(a.secondaryOwnerReferences.length,2);
  assert.ok(a.secondaryOwnerReferences.every(r=>r.reference.kind==='AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE'));
  for(const mutate of [y=>y.planningInput.ownerConfig.allowAdminMorning=false,
   y=>delete y.fullOwners['1'].equalized.EAST_ADMIN,
   y=>y.planningInput.ownerConfig.overrides['1'].morning.KATHY=['EAST_ADMIN']]){
   const y=clone(x);mutate(y);rebind(y);assert.throws(()=>contract(y));}
 });
 check('geographic cost uses frozen original directed anchor bytes',()=>{
  for(const o of c.options){const anchor=input.planningInput.source.version.slotAvailability.find(a=>a.dayOfWeek===1&&a.slotId===o.slotId).acceptedRouteAnchorLocationId;
   assert.equal(o.originalAnchorLocationId,anchor);const edge=input.planningInput.source.proximity.find(e=>e.fromLocationId===anchor&&e.toLocationId===c.choices.find(p=>p.workId===o.workId).primaryLocationId);
   assert.equal(o.geographyCost,anchor===c.choices.find(p=>p.workId===o.workId).primaryLocationId?0:edge.minutes);}
 });
 check('prospective ownership changes no source anchor/lunch/window boundary/protected bytes',()=>{
  const candidate=prospective(input,actual.selection),selected=new Set(c.choices.map(x=>x.workId));
  assert.deepEqual(candidate.version.slotAvailability,input.planningInput.source.version.slotAvailability);
  assert.deepEqual(candidate.proximity,input.planningInput.source.proximity);
  assert.deepEqual(candidate.version.assignments.filter(r=>!c.options.some(o=>o.prospectiveWorkId===r.workId)),input.planningInput.source.version.assignments.filter(r=>!selected.has(r.workId)));
  for(const row of candidate.version.assignments.filter(r=>c.options.some(o=>o.prospectiveWorkId===r.workId)))assert.equal(row.window.end,'09:45');
  assert.equal(canonicalJson(input),before);
 });
 check('preserved accepted static path never invokes solver or selects new work',()=>{
  const x=clone(input);x.planningInput.scope='ACCEPTED_PATTERN_PRESERVED';x.planningInput.selectedWorkIds=[];
  assert.equal(solve(x,{solve(){throw Error('must not execute');}}).status,'PRESERVED_NOT_REOPTIMIZED');
 });
 check('whole selection code-unit vector is independent of supplied selected order',()=>{
  const x=clone(input);x.planningInput.selectedWorkIds.reverse();assert.deepEqual(oracle(x).minimum.vector,actual.minimum.vector);
 });
 for(const [name,mutation]of [
  ['source without independent binding',x=>x.planningInput.source.version.assignments[0].priority++],
  ['unknown normal scope',x=>x.planningInput.scope='DATED_RECOVERY'],
  ['caller extra skip',x=>x.skipCanonical=true],
  ['missing original anchor',x=>{delete x.planningInput.source.version.slotAvailability.find(a=>a.dayOfWeek===1&&a.slotId===c.owners[0].slotId).acceptedRouteAnchorLocationId;rebind(x);}],
  ['missing directed edge no fallback',x=>{const o=c.options.find(o=>o.geographyCost>0),pkg=c.choices.find(p=>p.workId===o.workId);x.planningInput.source.proximity=x.planningInput.source.proximity.filter(e=>!(e.fromLocationId===o.originalAnchorLocationId&&e.toLocationId===pkg.primaryLocationId));rebind(x);}],
  ['unverified directed edge',x=>{const o=c.options.find(o=>o.geographyCost>0),pkg=c.choices.find(p=>p.workId===o.workId);x.planningInput.source.proximity.find(e=>e.fromLocationId===o.originalAnchorLocationId&&e.toLocationId===pkg.primaryLocationId).verified=false;rebind(x);}],
  ['wrong aggregate known weight',x=>{x.planningInput.ownerConfig.weights.CHINA++;rebind(x);}],
  ['partial known physical package cannot inherit full aggregate',x=>{x.planningInput.source.version.assignments.find(r=>r.dayOfWeek===1&&r.locationCodeSnapshot==='ZAMBEZI'&&r.window.end==='09:45').includedLocations.pop();rebind(x);}],
  ['response-only area cannot become cleaning members',x=>{const r=x.planningInput.source.version.assignments.find(r=>r.dayOfWeek===1&&r.locationCodeSnapshot==='CAT_COUNTRY'&&r.window.end==='09:45');r.includedLocations=[{locationId:r.locationId}];rebind(x);}],
  ['missing original full-position preference',x=>delete x.fullOwners['1'].morning.CHINA],
  ['late work selected',x=>x.planningInput.selectedWorkIds=[x.planningInput.source.version.assignments.find(r=>r.window.start==='09:45').workId]],
  ['duplicate selection',x=>x.planningInput.selectedWorkIds.push(x.planningInput.selectedWorkIds[0])],
 ])check('refuse '+name,()=>{const x=clone(input);mutation(x);assert.throws(()=>contract(x));});
 check('source-required OPEN never becomes prospective candidate',()=>assert.throws(()=>prospective(input,c.choices.map(p=>({workId:p.workId,slotId:null}))),e=>e.code===RECURRING_MORNING_ERROR));
 check('duplicate/drop/foreign ownership multiplicities rejected',()=>{for(const s of [actual.selection.slice(1),[actual.selection[0],actual.selection[0]],actual.selection.map(o=>({...o,slotId:'unknown'}))])assert.throws(()=>score(input,s));});
 check('full canonical solver is mandatory, not a relaxed oracle promotion',()=>{
  assert.equal(solve(input,null).status,'UNKNOWN_CANONICAL_MORNING');assert.equal(actual.status,'RELAXED_OBJECTIVE_ORACLE_NOT_CANONICAL');
 });
 const receipt={status:'PASS',checks,solver:false,canonicalOptimumClaim:false,sourceDigest:input.planningInput.bindings.sourceDigest,contractDigest:c.contractDigest,
  enumerableSelections:actual.visited,sourceUnchanged:canonicalJson(input)===before};console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringMorningEngineTests({families=['CHINA','HERPETARIUM']}={}){
 installStaticWeeklySha256HexAccelerator(sha);const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js');
 const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),input=createMorningSolverTestInput({families}),before=canonicalJson(input),started=performance.now();
 const proof=solve(input,solver);if(process.env.CUSTODIAL_MORNING_PROOF_PATH)fs.writeFileSync(process.env.CUSTODIAL_MORNING_PROOF_PATH,JSON.stringify({input,proof},null,2)+'\n',{flag:'wx'});
 assert.equal(proof.status,'PROVEN_SOURCE_PLANNED_MORNING_MINIMUM',proof.reason);let checks=0;
 assert.equal(verify(proof,input),true);checks++;
 assert.deepEqual(proof.metrics.vector,oracle(input).minimum.vector);checks++;
 assert.equal(proof.canonicalHardWitness.feasible,true);checks++;
 assert.equal(proof.openingReadinessProven,false);assert.equal(proof.missingOpeningCriticalClassification,true);checks++;
 assert.equal(canonicalJson(input),before);checks++;
 for(const mutation of [p=>p.metrics.geography++,p=>p.contract.owners[0].baselineAvailability.acceptedRouteAnchorLocationId='forged',
  p=>p.tiers.reverse(),p=>p.tiers[0].originalObjectiveValue++,p=>p.tiers[0].solved.identity.wasmSha256='a'.repeat(64),
  p=>p.tiers[0].solved.options.mip_rel_gap=0.1,p=>p.candidateSource.version.slotAvailability[0].lunch.start='12:00',
  p=>p.selection.push(p.selection[0]),p=>p.canonicalHardWitness.feasible=false,
  p=>p.tiers[0].solved.result.Columns.extra={Primal:0},p=>p.tiers[0].solved.result.Columns[Object.keys(p.tiers[0].solved.result.Columns)[0]].Lower=0]){
  const x=clone(proof);mutation(x);const {proofDigest,...body}=x;x.proofDigest=contentDigest(body);assert.throws(()=>verify(x,input));checks++;
 }
 const changed=clone(input);changed.planningInput.source.version.assignments[0].priority++;rebind(changed);assert.throws(()=>verify(proof,changed));checks++;
 const hostileInput=clone(input);let altered=false;const hostile={solve(...args){const output=solver.solve(...args);if(!altered){hostileInput.planningInput.source.version.assignments[0].priority++;altered=true;}return output;}};
 const hostileProof=solve(hostileInput,hostile);assert.equal(hostileProof.status,'UNKNOWN_CANONICAL_MORNING');assert.equal(hostileProof.candidateSource,null);checks++;
 const receipt={status:'PASS',checks,elapsedMs:Math.round(performance.now()-started),proofDigest:proof.proofDigest,metrics:proof.metrics,
 tierCount:proof.tiers.length,canonicalRows:proof.canonicalHardWitness.hardConstraintCount,syntheticLocalSource:true,workerIpc:false,sql:false,published:false};console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringMorningCurrentDayTest(){
 installStaticWeeklySha256HexAccelerator(sha);const input=createMorningSolverTestInput(),source=input.planningInput.source,before=canonicalJson(input);
 input.planningInput.selectedWorkIds=source.version.assignments.filter(r=>r.dayOfWeek===1&&r.window.end==='09:45').map(r=>r.workId);
 const fullBefore=canonicalJson(input),{initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js'),
  solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),started=performance.now(),proof=solve(input,solver);
 if(process.env.CUSTODIAL_MORNING_PROOF_PATH)fs.writeFileSync(process.env.CUSTODIAL_MORNING_PROOF_PATH,JSON.stringify({input,proof},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:proof.status,reason:proof.reason??null,selectedPackages:input.planningInput.selectedWorkIds.length,
  completedTiers:proof.tiers.length,elapsedMs:Math.round(performance.now()-started),solverAdmissionBudgetMs:30_000,canonicalOptimumClaim:proof.status==='PROVEN_SOURCE_PLANNED_MORNING_MINIMUM'}));
 assert.equal(proof.status,'PROVEN_SOURCE_PLANNED_MORNING_MINIMUM',proof.reason);
 assert.equal(verify(proof,input),true);assert.equal(proof.canonicalHardWitness.feasible,true);assert.equal(canonicalJson(input),fullBefore);
 const selected=new Set(input.planningInput.selectedWorkIds),generated=new Set(proof.selection.map(s=>proof.contract.options.find(o=>o.workId===s.workId&&o.slotId===s.slotId).prospectiveWorkId));
 assert.deepEqual(proof.candidateSource.version.assignments.filter(r=>!generated.has(r.workId)),source.version.assignments.filter(r=>!selected.has(r.workId)));
 const receipt={status:'PASS',checks:5,dayOfWeek:1,selectedPackages:selected.size,proofDigest:proof.proofDigest,metrics:proof.metrics,
  canonicalRows:proof.canonicalHardWitness.hardConstraintCount,selectionOnlyTestSetupChanged:before!==fullBefore,
  syntheticLocalSource:true,wholeWeekMorningProof:false,workerIpc:false,sql:false,published:false};console.log(JSON.stringify(receipt));return receipt;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--current-day'))await runRecurringMorningCurrentDayTest();
 else if(process.argv.includes('--engine'))await runRecurringMorningEngineTests(process.argv.includes('--single')?{families:['CHINA']} : {});else runRecurringMorningPureTests();
}
