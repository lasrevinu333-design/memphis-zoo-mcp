import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalJson,contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {createMorningSolverTestInput} from './static-weekly-recurring-morning-solver-tests.mjs';
import {createRecurringMorningWeekSourceBasis,deriveVerifiedRecurringMorningWeekCandidate,assertRecurringMorningWeekCandidate,
 createRecurringPhaseSourceBasis,deriveScalableCanonicalRecurringWeekCandidate,recurringPatternFromFinalPhaseSource,
 recurringMorningWeekSemanticFacts} from '../src/static-weekly-recurring-staffing-adaptation.js';
const clone=structuredClone;
let accelerated=false;const accelerate=()=>{if(!accelerated){installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));accelerated=true;}};
export function createCurrentMorningIntegrationFixture(count=6){
 assert.ok([6,7,8].includes(count));const input=createMorningSolverTestInput(),original=clone(input),source=input.planningInput.source,config=input.planningInput.ownerConfig;
 const differences=[];
 for(const [index,key]of ['OPTION1','OPTION2'].slice(0,count-6).entries()){
  const c=config.slots[key],personId=`72000000-0000-4000-8000-00000000000${index+1}`,name=`Synthetic registered current ${key} incumbent`;
  assert.equal(c.vacancy,true);c.vacancy=false;c.personId=personId;c.name=name;
  c.history=[...(c.history||[]),{personId,name,start:'2026-10-05',end:null}];
  const slot=source.slots.find(s=>s.id===c.slotId);slot.incumbencies.push({personId,displayName:name,effectiveStart:'2026-10-05',effectiveEnd:null});
  const rows=source.version.slotAvailability.filter(a=>a.slotId===c.slotId);assert.deepEqual(rows.map(a=>a.dayOfWeek).sort(),c.workDays.slice().sort());
  for(const a of rows){assert.equal(a.status,'vacant_unfilled');a.status='working';}
  source.version.vacantSlotIds=source.version.vacantSlotIds.filter(id=>id!==c.slotId);
  differences.push({kind:'EXPLICIT_SYNTHETIC_CURRENT_SOURCE_INCUMBENCY_AND_STATUS',stableSlotId:c.slotId,personId,effectiveStart:'2026-10-05',sourceAdmissionClaim:false});
 }
 assert.deepEqual(source.version.assignments,original.planningInput.source.version.assignments,'original accepted work reference bytes changed');
 assert.deepEqual(source.proximity,original.planningInput.source.proximity);assert.equal(source.slots.length,original.planningInput.source.slots.length);
 assert.equal(Object.keys(config.slots).length,9);assert.ok(Object.values(config.slots).every(c=>source.slots.filter(s=>s.id===c.slotId&&!s.contractorCapacity).length===1));
 return {input,differences,original,productionRosterClaim:false};
}
export function runRecurringMorningIntegrationPureTests(){
 accelerate();let checks=0;const input=createMorningSolverTestInput(),source=input.planningInput.source,config=input.planningInput.ownerConfig,
  before=canonicalJson(input),basis=createRecurringMorningWeekSourceBasis({registeredSource:source,currentConfig:config});
 assert.equal(basis.days.length,7);checks++;
 assert.ok(basis.days.every(d=>d.selectedWorkIds.length===23));checks++;
 assert.equal(canonicalJson(basis.source),canonicalJson(source));checks++;
 assert.equal(canonicalJson(basis.ownerConfig),canonicalJson(config));checks++;
 assert.equal(basis.comparisonReference,'ORIGINAL_ACCEPTED_MORNING_ROWS_AND_DIRECTED_ANCHORS');checks++;
 assert.ok(basis.days.every(d=>d.selectedWorkIds.every(id=>source.version.assignments.find(r=>r.workId===id)?.window.end==='09:45')));checks++;
 for(const mutate of [s=>s.version.assignments.pop(),s=>s.version.assignments[0].workId='unknown',s=>s.version.shiftEndContinuityPolicy.namedHandoffs=[],
  s=>s.version.assignments.find(r=>r.workId.includes('one-time')).window.start='09:45']){
  const x=clone(source);mutate(x);assert.throws(()=>createRecurringMorningWeekSourceBasis({registeredSource:x,currentConfig:config}));checks++;
 }
 const falseWeek={status:'UNREGISTERED_VERIFIED_RECURRING_MORNING_WEEK',proofs:[],candidateSource:source};falseWeek.proofDigest=contentDigest(falseWeek);
 assert.throws(()=>assertRecurringMorningWeekCandidate({week:falseWeek,basis,fullOwners:input.fullOwners}));checks++;
 assert.equal(canonicalJson(input),before);checks++;
 for(const count of [7,8]){const f=createCurrentMorningIntegrationFixture(count);
  assert.equal(f.differences.length,count-6);assert.equal(Object.values(f.input.planningInput.ownerConfig.slots).filter(s=>!s.vacancy).length,count);
  createRecurringMorningWeekSourceBasis({registeredSource:f.input.planningInput.source,currentConfig:f.input.planningInput.ownerConfig});checks++;
 }
 const result={status:'PASS',checks,sourceOnly:true,solver:false,wholeWeekProof:false,sourceBasisDigest:basis.basisDigest};console.log(JSON.stringify(result));return result;
}
export async function runRecurringMorningIntegrationWeekTests({combined=false}={}){
 accelerate();const input=createMorningSolverTestInput(),source=input.planningInput.source,config=input.planningInput.ownerConfig,before=canonicalJson(input),
  basis=createRecurringMorningWeekSourceBasis({registeredSource:source,currentConfig:config}),
  {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js'),
  solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),started=performance.now(),
  week=deriveVerifiedRecurringMorningWeekCandidate({basis,fullOwners:input.fullOwners,solver});
 const artifact={input,basis,week};if(process.env.CUSTODIAL_MORNING_INTEGRATION_PROOF_PATH)fs.writeFileSync(process.env.CUSTODIAL_MORNING_INTEGRATION_PROOF_PATH,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:week.status,stage:week.stage,dayOfWeek:week.dayOfWeek,proofs:week.proofs.length,reason:week.proofs.at(-1)?.reason,elapsedMs:Math.round(performance.now()-started)}));
 assert.equal(week.status,'UNREGISTERED_VERIFIED_RECURRING_MORNING_WEEK');let checks=0;
 assert.equal(assertRecurringMorningWeekCandidate({week,basis,fullOwners:input.fullOwners}).feasible,true);checks++;
 assert.equal(week.proofs.length,7);checks++;
 assert.ok(week.proofs.every(p=>p.contract.choices.length===23&&p.metrics.coverage.every(n=>n===0)));checks++;
 assert.deepEqual(week.candidateSource.version.slotAvailability,source.version.slotAvailability);checks++;
 assert.deepEqual(week.candidateSource.version.assignments.filter(r=>r.window.start==='09:45'),source.version.assignments.filter(r=>r.window.start==='09:45'));checks++;
 assert.equal(canonicalJson(input),before);checks++;
 const semantic=recurringMorningWeekSemanticFacts(week),timed=clone(week);timed.proofs[0].tiers[0].solved.options.time_limit-=0.001;
 const {proofDigest,...timedBody}=timed;timed.proofDigest=contentDigest(timedBody);
 assert.equal(canonicalJson(recurringMorningWeekSemanticFacts(timed)),canonicalJson(semantic));checks++;
 assert.throws(()=>assertRecurringMorningWeekCandidate({week:timed,basis,fullOwners:input.fullOwners}));checks++;
 for(const mutate of [w=>w.candidateSource.version.slotAvailability[0].acceptedRouteAnchorLocationId='forged',w=>w.proofs.pop(),
  w=>w.proofs[0].metrics.geography++,w=>w.candidateSource.version.assignments.find(r=>r.workId.includes('one-time')).locationNameSnapshot='forged']){
  const w=clone(week);mutate(w);const {proofDigest,...body}=w;w.proofDigest=contentDigest(body);assert.throws(()=>assertRecurringMorningWeekCandidate({week:w,basis,fullOwners:input.fullOwners}));checks++;
 }
 if(combined){
  const phaseBasis=createRecurringPhaseSourceBasis({registeredSource:source,patternConfig:config,morningWeek:week,morningBasis:basis,fullOwners:input.fullOwners});
  const late=deriveScalableCanonicalRecurringWeekCandidate({source:phaseBasis.source,currentConfig:phaseBasis.ownerConfig,fullOwners:input.fullOwners,solver,phaseSourceBasis:phaseBasis});
  console.log(JSON.stringify({status:late.status,stage:late.stage,dayOfWeek:late.dayOfWeek,reason:late.reason||late.proofs.at(-1)?.reason,elapsedMs:Math.round(performance.now()-started)}));
  assert.equal(late.status,'UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE');checks++;
  assert.equal(assertRecurringMorningWeekCandidate({week,basis,fullOwners:input.fullOwners,finalSource:late.candidateSource}).feasible,true);checks++;
  const pattern=recurringPatternFromFinalPhaseSource({phaseSourceBasis:phaseBasis,finalSource:late.candidateSource});
  assert.deepEqual(pattern.config.slots,config.slots);checks++;
  assert.deepEqual(late.candidateSource.version.slotAvailability,source.version.slotAvailability);checks++;
  if(process.env.CUSTODIAL_MORNING_COMBINED_PROOF_PATH)fs.writeFileSync(process.env.CUSTODIAL_MORNING_COMBINED_PROOF_PATH,JSON.stringify({...artifact,phaseBasis,late,pattern},null,2)+'\n',{flag:'wx'});
 }
 const result={status:'PASS',checks,scope:combined?'current-six actual morning + late final canonical':'current-six seven-day morning canonical',
  sharedAdmissionBudgetMs:30_000,selectedPackages:161,days:7,elapsedMs:Math.round(performance.now()-started),workerIpc:false,sql:false,published:false};console.log(JSON.stringify(result));return result;
}
export async function runRecurringMorningFusedSixTest({count=6}={}){
 const fixture=createCurrentMorningIntegrationFixture(count),input=fixture.input,source=input.planningInput.source,config=input.planningInput.ownerConfig,
  {createStaticWeeklyCompilerRuntime}=await import('../src/static-weekly-schedule-compiler-runtime.js'),
  {assertRecurringMorningCommitmentCandidate}=await import('../src/static-weekly-recurring-week-commitment.js'),
  {assertRecurringAdmissionCandidate}=await import('../src/static-weekly-recurring-preview.js');
 const managerSnapshot={week_start:'2026-10-05',authority_revision:42,current_publication:{publication_id:source.version.publicationId},
  roster:Object.values(config.slots).map(s=>({slot_id:s.slotId,contractor_capacity:false,
   incumbencies:source.slots.find(r=>r.id===s.slotId).incumbencies.map(p=>({person_id:p.personId,person_name:p.displayName,effective_start:p.effectiveStart,effective_end:p.effectiveEnd})),
   week_staffing:s.vacancy?[]:s.workDays.map(d=>({service_date:new Date(Date.parse('2026-10-05T12:00:00Z')+((d+6)%7)*86400000).toISOString().slice(0,10),person_id:s.personId,employee_active:true}))}))};
 const request={publishedSource:{source_id:'73000000-0000-4000-8000-000000000001',publication_id:source.version.publicationId,authority_revision:42,compiler_input:source},managerSnapshot,effectiveDate:'2026-10-05',expectedRevision:42},
  before=canonicalJson(request),runtime=createStaticWeeklyCompilerRuntime(),started=performance.now();
 try{
  const preview=await runtime.prepareRecurringCandidate(request);assert.equal(assertRecurringMorningCommitmentCandidate(preview),true);
  assert.equal(preview.staffedPositions,count);assert.equal(preview.morningCommitment.morningFacts.days.length,7);
  const admission=await runtime.prepareRecurringAdmissionCandidate(request);assertRecurringAdmissionCandidate(admission);
  assert.equal(assertRecurringMorningCommitmentCandidate(admission.candidate),true);
  assert.equal(preview.morningCommitment.digest,admission.candidate.morningCommitment.digest);
  assert.equal(preview.weekCommitment.digest,admission.candidate.weekCommitment.digest);
  assert.equal(preview.decisionDigest,admission.candidate.decisionDigest);
  assert.equal(preview.candidateSourceDigest,admission.candidate.candidateSourceDigest);
  assert.equal(canonicalJson(request),before);
  await assert.rejects(()=>runtime.prepareRecurringCandidate({...request,expectedRevision:41}),/revision changed/);
  if(process.env.CUSTODIAL_MORNING_FUSED_PROOF_PATH)fs.writeFileSync(process.env.CUSTODIAL_MORNING_FUSED_PROOF_PATH,JSON.stringify({request,preview,admission,typedSourceDifferences:fixture.differences,productionRosterClaim:false},null,2)+'\n',{flag:'wx'});
  const receipt={status:'PASS',checks:11,staffedPositions:count,morningDays:7,lateDays:7,sourceAssignments:323,
   morningDigest:preview.morningCommitment.digest,lateDigest:preview.weekCommitment.digest,decisionDigest:preview.decisionDigest,
   elapsedMs:Math.round(performance.now()-started),actualFreshPrivateWorker:true,sql:false,publication:false};console.log(JSON.stringify(receipt));return receipt;
 }finally{await runtime.shutdown();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--fused-six')||process.argv.includes('--fused-seven')||process.argv.includes('--fused-eight'))await runRecurringMorningFusedSixTest({count:process.argv.includes('--fused-eight')?8:process.argv.includes('--fused-seven')?7:6});
 else if(process.argv.includes('--week')||process.argv.includes('--combined'))await runRecurringMorningIntegrationWeekTests({combined:process.argv.includes('--combined')});
 else runRecurringMorningIntegrationPureTests();
}
