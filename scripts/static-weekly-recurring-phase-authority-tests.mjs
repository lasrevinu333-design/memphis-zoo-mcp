import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {contentDigest,canonicalJson,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {staticWeeklySafeName} from '../src/static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger} from '../src/schedule-component-weight-authority.js';
import {deriveCanonicalRecurringPhaseCandidate,deriveScalableCanonicalRecurringPhaseCandidate,
 deriveScalableCanonicalRecurringWeekCandidate,deriveRecurringStaffingPattern,recurringSecondaryOwnerReference,
 currentPatternFromPublishedReadback,currentHandoutRecurringStructure,adaptRegisteredRecurringSource,recurringOwnerLunch,
 createRecurringPhaseSourceBasis,recurringPatternFromFinalPhaseSource} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource,
 evaluateRecurringPhaseCanonicalSource,enumerateRecurringPhaseMinimum,assertRecurringPhaseMinimum}
 from '../src/static-weekly-recurring-phase-authority.js';
import {solveRecurringPhaseCanonicalMinimum} from '../src/static-weekly-recurring-phase-authority.js';
import {assertNormalOwnerEligibility,normalGeographyRestrictionApplies,validateOwnerEligibilityConfig} from '../src/static-weekly-owner-eligibility.js';
const ledger=new Map(getScheduleComponentWeightLedger().families.map(f=>[f.code,f]));
const slotA='71000000-0000-4000-8000-000000000001',slotB='71000000-0000-4000-8000-000000000002';
function fixture(codes,{capacityA=100,capacityB=100,morning=false,morningEffort=capacityA,restrictB=[],fixedPhase=[]}={}){
 const keys=[slotA,slotB],config={weights:Object.fromEntries([...ledger].map(([c,f])=>[c,f.aggregateWeight])),publicRestroomFamilies:[],slots:{}};
 for(const [i,id]of keys.entries())config.slots[id]={slotId:id,name:'Synthetic '+i,personId:'synthetic-person-'+i,vacancy:false,
  workDays:[1],shift:[i?'07:00':'05:00','16:00'],lunch:['12:00','13:00']};
 const allCodes=[...codes,...fixedPhase];
 const locs=[...new Set(allCodes.flatMap(c=>[ledger.get(c).primaryLocationId,...ledger.get(c).components.map(x=>x.locationId)]))];
 const source={serviceDate:'2026-10-05',timezone:'America/Chicago',exceptions:[],
  slots:keys.map((id,i)=>({id,label:'Synthetic ordinary slot '+i,incumbencies:[{personId:'synthetic-person-'+i,displayName:'Synthetic '+i,effectiveStart:'2020-01-01',effectiveEnd:null}]})),
  proximity:locs.flatMap(from=>locs.filter(to=>to!==from).map(to=>({from,to,minutes:1,verified:true,provenance:'synthetic-declared-directed-fact-not-physical-proof'}))),
  versions:[{id:'synthetic-version',publicationId:'synthetic-publication',status:'published',effectiveStart:'2026-10-05',effectiveEnd:null,
   objective:{requireVerifiedProximity:true},slotAvailability:keys.map((id,i)=>({slotId:id,dayOfWeek:1,status:'working',
    shift:{start:config.slots[id].shift[0],end:'16:00'},lunch:{start:'12:00',end:'13:00'},
    productiveCapacityProvenance:'synthetic-fixed-shift',maxServiceEffortMinutes:i?capacityB:capacityA,
    maxServiceEffortProvenance:'synthetic-existing-point-budget',qualifications:['general'],qualificationProvenance:'synthetic-qualification',
    restrictions:i?restrictB:[],restrictionProvenance:'synthetic-restriction',acceptedRouteAnchorLocationId:locs[0],acceptedRouteProvenance:'synthetic-existing-anchor'})),
   assignments:allCodes.map((code,i)=>{const f=ledger.get(code),owner=i<codes.length?(i%2?slotB:slotA):((i-codes.length)%2?slotB:slotA);
    return {workId:(i<codes.length?'selected-':'fixed-phase-')+code,dayOfWeek:1,locationId:f.primaryLocationId,
    locationCodeSnapshot:code,locationNameSnapshot:code,serviceMode:f.serviceMode,schedulingMode:'flexible_coverage_ownership',
    includedLocations:f.serviceMode==='response_only_no_clean'?[]:f.components.map(c=>({locationId:c.locationId,locationNameSnapshot:code})),
    window:{start:'09:45',end:'16:00'},ownerSlotId:owner,originSlotId:owner,
    serviceEffortMinutes:10,serviceEffortProvenance:'synthetic-inherited-workload-points',priority:2,priorityProvenance:'synthetic-priority',
    requiredQualifications:['general'],qualificationProvenance:'synthetic-work-qualifications',restrictions:[],restrictionProvenance:'synthetic-work-restrictions'};})}]};
 if(morning){const row=structuredClone(source.versions[0].assignments[0]);row.workId='fixed-morning';row.window={start:'05:00',end:'09:45'};
  row.ownerSlotId=slotA;row.originSlotId=slotA;row.serviceEffortMinutes=morningEffort;source.versions[0].assignments.unshift(row);}
 return {source,ownerConfig:config,dayOfWeek:1,selectedWorkIds:source.versions[0].assignments.filter(r=>r.workId.startsWith('selected-')).map(r=>r.workId)};
}
// Independent finite oracle for these explicitly synthetic flexible fixtures:
// original point caps/qualification restriction and indivisible package sums.
// It does not import the production phase descriptor/model/oracle.
function independent(f){
 const rows=f.source.versions[0].assignments,selected=rows.filter(r=>f.selectedWorkIds.includes(r.workId)),fixed=rows.filter(r=>!f.selectedWorkIds.includes(r.workId));
 let min=null,feasible=0;
 for(let mask=0;mask<2**selected.length;mask++){
  const weight=[0,0],effort=[0,0],count=[0,0],av=f.source.versions[0].slotAvailability;
  for(const r of fixed){const o=r.originSlotId===slotA?0:1;effort[o]+=r.serviceEffortMinutes;
   if(r.window.start==='09:45'){weight[o]+=f.ownerConfig.weights[r.locationCodeSnapshot]*2;count[o]++;}}
  let valid=true;
  selected.forEach((r,i)=>{const o=(mask>>i)&1;count[o]++;weight[o]+=f.ownerConfig.weights[r.locationCodeSnapshot]*2;effort[o]+=r.serviceEffortMinutes;
   if(av[o].restrictions.includes(r.locationId))valid=false;});
  if(effort.some((x,i)=>x>av[i].maxServiceEffortMinutes))valid=false;
  if(count.some(n=>n===0))valid=false;
  if(valid){feasible++;const spread=Math.abs(weight[0]-weight[1]);min=min===null?spread:Math.min(min,spread);}
 }
 return {min,feasible};
}
export function runStaticWeeklyRecurringPhaseAuthorityTests(){
 let checks=0;const start=performance.now(),check=(n,fn)=>{fn();checks++;console.log('PASS',n);};
 const cases=[
  ['zero',['CAT_COUNTRY','PRIMATE_CANYON'],{},0],
  ['half',['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY'],{},1],
  ['indivisible pair',['CHINA'],{fixedPhase:['CAT_COUNTRY','PRIMATE_CANYON']},4],
  ['canonical point-cap blocker',['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY','PRIMATE_CANYON'],{capacityA:30,capacityB:20,morning:true,morningEffort:10},2],
  ['canonical restriction',['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY'],{restrictB:[ledger.get('CHINA').primaryLocationId]},1]
 ];
 const summaries=[];
 for(const [name,codes,opts,expected]of cases){
  const f=fixture(codes,opts),before=canonicalJson(f),reference=independent(f),proof=enumerateRecurringPhaseMinimum(f);
  check(name+': actual enumeration matches independent complete oracle',()=>{assert.equal(proof.status,'PROVEN_MINIMUM_COMPLETE_SELECTED_SCOPE');
   assert.equal(proof.minimumDoubledSpread,reference.min);assert.equal(reference.min,expected);
   assert.equal(proof.receipts.filter(r=>r.canonicalFeasible&&r.publicSiteValid&&r.nonemptyPhaseOwners&&r.selectedPackagesCovered).length,reference.feasible);});
  check(name+': every pattern has real canonical hard-row identity',()=>{assert.equal(proof.enumerated,2**codes.length);
   assert.ok(proof.receipts.every(r=>r.hardConstraintCount>0&&r.modelBasisDigest&&r.hardConstraintDigest&&r.witnessDigest));});
  check(name+': bound and scope honest',()=>{assert.equal(proof.halfUnitFeasible,expected<=1);assert.equal(proof.physicalMinuteFeasibilityClaim,false);
   assert.equal(proof.solver,false);assert.equal(proof.costOrTieSelectionPerformed,false);assert.equal(proof.sourceMutated,false);});
  check(name+': complete actual integer witness',()=>{assert.ok(proof.minimumWitness.proof.integerWitness.length>0);
   assert.ok(proof.minimumWitness.proof.integerWitness.every(([,v])=>v===0||v===1));assert.equal(proof.minimumWitness.proof.violations.length,0);});
  check(name+': source/config/fixed rows stay unchanged',()=>assert.equal(canonicalJson(f),before));
  if(opts.morning)check('relaxed half-unit solution rejected by canonical capacity rows',()=>assert.ok(proof.receipts.some(r=>r.doubledSpread===0&&!r.canonicalFeasible&&r.violations.some(v=>v.constraint===staticWeeklySafeName(`service_capacity_1\u0000${slotA}`)))));
  summaries.push({name,minimumDoubledSpread:proof.minimumDoubledSpread,patterns:proof.enumerated,canonicalAndNormalConditionsFeasiblePatterns:reference.feasible});
 }
 const small=fixture(['CAT_COUNTRY','PRIMATE_CANYON']),proof=enumerateRecurringPhaseMinimum(small);
 check('empty staffed phase cannot enter normal minimum despite canonical feasibility',()=>{
  assert.ok(proof.receipts.some(r=>r.canonicalFeasible&&!r.nonemptyPhaseOwners));
  assert.ok(proof.minimumWitness.loads.every(r=>r.doubledLoad>0));
 });
 check('Monday-only source owner is fixed before canonical comparison',()=>{
  const f=fixture(['CAT_COUNTRY','PRIMATE_CANYON']);f.ownerConfig.mondayOnlyFamilies=['CAT_COUNTRY'];
  const p=enumerateRecurringPhaseMinimum(f),c=p.descriptor.choices.find(r=>r.workId==='selected-CAT_COUNTRY');
  assert.deepEqual(c.owners.map(o=>o.slotId),[slotA]);assert.equal(p.enumerated,2);
  assert.ok(p.receipts.every(r=>r.selection.find(s=>s.workId===c.workId).slotId===slotA));
  assert.equal(p.minimumDoubledSpread,0);
 });
 check('uncovered optional response package cannot masquerade as selected coverage',()=>{
  const f=fixture(['CAT_COUNTRY','PRIMATE_CANYON']);
  f.source.versions[0].slotAvailability.forEach(r=>r.qualifications=[]);
  const p=enumerateRecurringPhaseMinimum(f);
  assert.equal(p.status,'INFEASIBLE_COMPLETE_SELECTED_SCOPE');
  assert.ok(p.receipts.every(r=>r.selectedPackagesCovered===false));
  assert.equal(p.minimumDoubledSpread,null);
 });
 check('rehashed descriptor cannot substitute a different source',()=>{
  const d=createRecurringPhaseDescriptor(small),other=structuredClone(small.source);
  other.versions[0].assignments[0].serviceEffortMinutes=11;
  assert.throws(()=>createRecurringPhaseProspectiveSource({source:other,ownerConfig:small.ownerConfig,descriptor:d,
   selection:d.choices.map(c=>({workId:c.workId,slotId:slotA}))}));
 });
 check('full canonical recomputation accepts original finite proof',()=>assert.equal(assertRecurringPhaseMinimum({...small,proof}),true));
 for(const [name,mutate]of[
  ['forged minimum',p=>p.minimumDoubledSpread=17],['forged witness',p=>p.minimumWitness.proof.integerWitness[0][1]=9],
  ['dropped pattern',p=>p.receipts.pop()],['scope overclaim',p=>p.minimumClaimScope='GLOBAL_CURRENT_SCHEDULE_OPTIMUM'],
  ['unit substitution',p=>p.descriptor.unit='minutes']]){
  check(name+' rejected after carried hash update',()=>{const p=structuredClone(proof);mutate(p);const {proofDigest,...body}=p;p.proofDigest=contentDigest(body);
   assert.throws(()=>assertRecurringPhaseMinimum({...small,proof:p}));});
 }
 check('pair/member splitting rejected before enumeration',()=>{const f=fixture(['CHINA']);f.source.versions[0].assignments[0].includedLocations.pop();
  assert.throws(()=>createRecurringPhaseDescriptor(f));});
 check('duplicate selected identity rejected',()=>assert.throws(()=>createRecurringPhaseDescriptor({...small,selectedWorkIds:[...small.selectedWorkIds,small.selectedWorkIds[0]]})));
 check('morning row cannot be selected for post45 unlock',()=>{const f=fixture(['CAT_COUNTRY'],{morning:true});f.selectedWorkIds=['fixed-morning'];assert.throws(()=>createRecurringPhaseDescriptor(f));});
 check('dated absence/manual capacity cannot silently enter normal design',()=>{const f=fixture(['CHINA']);f.source.exceptions=[{type:'cover_all'}];assert.throws(()=>createRecurringPhaseDescriptor(f));});
 for(const [name,mutate]of[
  ['incumbent substitution',f=>f.ownerConfig.slots[slotA].personId='different-current-person'],
  ['fixed lunch substitution',f=>f.ownerConfig.slots[slotA].lunch=['11:00','12:00']],
  ['fixed shift substitution',f=>f.ownerConfig.slots[slotA].shift=['06:00','16:00']]])
  check(name+' rejected',()=>{const f=fixture(['CHINA']);mutate(f);assert.throws(()=>createRecurringPhaseDescriptor(f));});
 check('prospective source changes only exact selected normal rows',()=>{const d=createRecurringPhaseDescriptor(small),s=createRecurringPhaseProspectiveSource({...small,descriptor:d,
  selection:d.choices.map(c=>({workId:c.workId,slotId:slotB}))});assert.deepEqual(s.slots,small.source.slots);assert.deepEqual(s.versions[0].slotAvailability,small.source.versions[0].slotAvailability);
  assert.deepEqual(s.proximity,small.source.proximity);assert.deepEqual(s.exceptions,[]);assert.deepEqual(s.versions[0].assignments.map(r=>r.serviceEffortMinutes),[10,10]);});
 check('complete infeasibility differs from limit/unknown',()=>{const f=fixture(['CHINA'],{capacityA:1,capacityB:1});const p=enumerateRecurringPhaseMinimum(f);
  assert.equal(p.status,'INFEASIBLE_COMPLETE_SELECTED_SCOPE');assert.equal(p.minimumDoubledSpread,null);assert.equal(p.halfUnitFeasible,null);assert.equal(p.enumerated,2);});
 check('resource bound does not claim infeasible or a minimum',()=>{const f=fixture(['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY','PRIMATE_CANYON','EVENT_CENTER','TETON','ZAMBEZI']);
  const p=enumerateRecurringPhaseMinimum(f);assert.equal(p.status,'UNKNOWN_RESOURCE_BOUND');assert.equal(p.enumerated,0);assert.equal(p.minimumDoubledSpread,null);assert.equal(p.halfUnitFeasible,null);});
 // Actual retained six-person input, not a synthetic-success replacement.
 const packetBytes=fs.readFileSync(new URL('./fixtures/static-weekly-policy-scope-receipts.json',import.meta.url));
 const configBytes=fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
 check('retained actual source fixture and current owner config bytes pinned',()=>{
  assert.equal(createHash('sha256').update(packetBytes).digest('hex'),'197d8eb0078f2bc9acb3cfb667c64874c8e41944f600bbaa026675d4594e9dfc');
  assert.equal(createHash('sha256').update(configBytes).digest('hex'),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
 });
 const packet=JSON.parse(packetBytes),current=packet.cases.baseline.input,ownerConfig=JSON.parse(configBytes);
 check('current protected three retain exact accepted geography and all hard bans',()=>{
  validateOwnerEligibilityConfig(ownerConfig);
  for(const key of ['KAREN','TAMMY','KATHY']){
   assert.equal(normalGeographyRestrictionApplies({key,...ownerConfig.slots[key]}),true);
   const outside='NOT_AN_ACCEPTED_AREA';assert.throws(()=>assertNormalOwnerEligibility({key,...ownerConfig.slots[key]},outside));
  }
  for(const family of ['EAST_ADMIN','WEST_ADMIN','COURTYARD_RESTROOMS','BREEZEWAY_RESTROOMS'])assertNormalOwnerEligibility({key:'KATHY',...ownerConfig.slots.KATHY},family);
  assert.throws(()=>assertNormalOwnerEligibility({key:'ALIJAH',...ownerConfig.slots.ALIJAH},'HERPETARIUM'));
 });
 check('nonprotected familiarity is preference and identity spoof cannot unlock protection',()=>{
  assertNormalOwnerEligibility({key:'GREGORY',...ownerConfig.slots.GREGORY},'BREEZEWAY_RESTROOMS');
  assertNormalOwnerEligibility({key:'KAILI',...ownerConfig.slots.KAILI},'NORTH_WEST_PASSAGE');
  assert.throws(()=>normalGeographyRestrictionApplies({key:'GREGORY',...ownerConfig.slots.KAREN}));
  assert.throws(()=>normalGeographyRestrictionApplies({key:'KAREN',...ownerConfig.slots.GREGORY}));
  assert.throws(()=>normalGeographyRestrictionApplies({...ownerConfig.slots.KAREN,id:ownerConfig.slots.GREGORY.slotId}));
  assert.equal(normalGeographyRestrictionApplies({...ownerConfig.slots.KAREN,slotId:ownerConfig.slots.KAREN.slotId.toUpperCase()}),true);
 });
 check('personal geography follows verified current people, not replacement positions or names',()=>{
  for(const key of ['KAREN','TAMMY','KATHY']){
   const replacement={key,...ownerConfig.slots[key],personId:'72000000-0000-4000-8000-000000000009'};
   assert.equal(normalGeographyRestrictionApplies(replacement),false);
   assertNormalOwnerEligibility(replacement,'NOT_AN_ACCEPTED_AREA');
   assert.equal(normalGeographyRestrictionApplies({...replacement,name:ownerConfig.slots[key].name}),false);
   assert.equal(normalGeographyRestrictionApplies({key,...ownerConfig.slots[key],vacancy:true,personId:null,name:null}),false);
   assert.throws(()=>normalGeographyRestrictionApplies({key:'GREGORY',...ownerConfig.slots.GREGORY,personId:ownerConfig.slots[key].personId}));
   const forged=structuredClone(ownerConfig);forged.slots[key].personId=replacement.personId;
   const day=forged.slots[key].workDays[0];
   assert.throws(()=>createRecurringPhaseDescriptor({source:current,ownerConfig:forged,dayOfWeek:day}),/incumbent\/config mismatch/);
   const typed=structuredClone(current),row=typed.slots.find(s=>s.id===replacement.slotId);
   row.incumbencies.find(p=>p.personId===ownerConfig.slots[key].personId).effectiveEnd='2026-10-05';
   row.incumbencies.push({personId:replacement.personId,displayName:replacement.name,effectiveStart:'2026-10-05',effectiveEnd:null});
   const bound=createRecurringPhaseDescriptor({source:typed,ownerConfig:forged,dayOfWeek:day});
   assert.ok(bound.owners.some(o=>o.slotId===replacement.slotId));
   assert.equal(row.incumbencies.length,current.slots.find(s=>s.id===replacement.slotId).incumbencies.length+1);
  }
  const replacement=structuredClone(ownerConfig);replacement.slots.ALIJAH.personId='72000000-0000-4000-8000-000000000009';
  validateOwnerEligibilityConfig(replacement);
  assert.throws(()=>assertNormalOwnerEligibility({key:'ALIJAH',...replacement.slots.ALIJAH},'HERPETARIUM'));
  const stripped=structuredClone(ownerConfig);stripped.slots.ALIJAH.hardForbiddenFamilies=[];
  assert.throws(()=>validateOwnerEligibilityConfig(stripped));
 });
 const currentBefore=canonicalJson(current);
 const currentProof=enumerateRecurringPhaseMinimum({source:current,ownerConfig,dayOfWeek:1});
 check('exact current six-person source is preserved, not reoptimized',()=>{assert.equal(currentProof.status,'PRESERVED_NOT_REOPTIMIZED');
  assert.equal(currentProof.minimumDoubledSpread,null);assert.equal(currentProof.halfUnitFeasible,null);assert.equal(currentProof.enumerated,1);
  assert.equal(currentProof.preservedCanonicalFeasible,true);assert.equal(canonicalJson(current),currentBefore);});
 check('current unchanged other-days/roster/lunch remain source-bound',()=>{assert.equal(currentProof.descriptor.otherDaysAndMorningFixed,true);
  assert.equal(currentProof.descriptor.sourceDigest,contentDigest(current));assert.equal(currentProof.descriptor.configDigest,contentDigest(ownerConfig));});
 const guidance={1:{equalized:Object.fromEntries(small.source.versions[0].assignments.map(r=>[r.locationCodeSnapshot,r.originSlotId]))}};
 const selected=deriveCanonicalRecurringPhaseCandidate({source:small.source,currentConfig:small.ownerConfig,fullOwners:guidance,dayOfWeek:1});
 check('derived whole-phase adapter uses real canonical minimum before inherited preference/ties',()=>{
  assert.equal(selected.status,'UNREGISTERED_CANONICAL_PHASE_CANDIDATE');assert.equal(selected.proof.minimumDoubledSpread,0);
  assert.deepEqual(selected.existingPreferenceCostsPreserved,[100,4,2]);assert.equal(selected.preferenceCost,4);
  assert.equal(selected.canonicalHardWitness.feasible,true);assert.equal(selected.publication,false);assert.equal(selected.admitted,false);
  assert.deepEqual(selected.selectedOwnership.map(r=>r.slotId),[slotA,slotB]);});
 check('derived scope includes every explicit post45 package without caller selector',()=>{
  assert.deepEqual(selected.proof.descriptor.selectedWorkIds,[...small.selectedWorkIds].sort());
  assert.equal(selected.proof.descriptor.otherDaysAndMorningFixed,true);assert.deepEqual(selected.candidateSource.slots,small.source.slots);
  assert.deepEqual(selected.candidateSource.versions[0].slotAvailability,small.source.versions[0].slotAvailability);
  assert.equal(selected.datedPriorityChange,false);});
 check('actual six-person full phase is bounded UNKNOWN, never fake feasible/infeasible',()=>{
  const fullOwners={1:{equalized:{}}};const p=deriveCanonicalRecurringPhaseCandidate({source:current,currentConfig:ownerConfig,fullOwners,dayOfWeek:1});
  assert.equal(p.status,'UNKNOWN_RESOURCE_BOUND');assert.equal(p.candidateSource,null);assert.equal(p.proof.enumerated,0);
  assert.equal(p.proof.minimumDoubledSpread,null);assert.equal(p.proof.halfUnitFeasible,null);});
 const receipt={status:'PASS',checks,elapsedMs:Math.round(performance.now()-start),cases:summaries,currentPreservationHardRows:currentProof.receipts[0].hardConstraintCount,
  solver:false,worker:false,sql:false,publication:false,scope:'real canonical hard-row witnesses and complete tiny selected-phase enumeration, not whole current phase optimum or runtime manager integration'};
 console.log(JSON.stringify(receipt));return receipt;
}
export async function runStaticWeeklyRecurringPhaseScalableTests(){
 const started=performance.now();let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 // Same byte-verified Node accelerator installed by the real fused worker.
 // The default pure suite separately exercises the portable implementation.
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js');
 const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4});
 const tiny=fixture(['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY']);
 const fullOwners={1:{equalized:Object.fromEntries(tiny.source.versions[0].assignments.map(r=>[r.locationCodeSnapshot,r.originSlotId]))}};
 const p=solveRecurringPhaseCanonicalMinimum({...tiny,fullOwners,solver});
 check('real pinned terminal bounds match exhaustive canonical minimum',()=>{
  assert.equal(p.status,'PROVEN_CANONICAL_PHASE_MINIMUM',p.reason);assert.equal(p.minimumDoubledSpread,1);
  assert.equal(p.independentlyMatchedCanonicalWitness,true);assert.equal(p.canonicalHardWitness.feasible,true);
  assert.ok(p.tiers.length>=3&&p.tiers.every(t=>t.rawReceiptDigest&&t.terminalReport));
 });
 const exhaustive=deriveCanonicalRecurringPhaseCandidate({source:tiny.source,currentConfig:tiny.ownerConfig,fullOwners,dayOfWeek:1});
 check('real scalable preference and code-unit ties match complete enumerable oracle',()=>{
  assert.equal(p.preferenceCost,exhaustive.preferenceCost);assert.deepEqual(p.stableIdentity,exhaustive.stableIdentity);
  assert.deepEqual(p.selectedOwnership.slice().sort((a,b)=>a.workId.localeCompare(b.workId)),exhaustive.selectedOwnership);
 });
 const blocked=fixture(['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY','PRIMATE_CANYON'],{capacityA:30,capacityB:20,morning:true,morningEffort:10});
 const blockedGuidance={1:{equalized:Object.fromEntries(blocked.source.versions[0].assignments.filter(r=>r.window.start==='09:45').map(r=>[r.locationCodeSnapshot,r.originSlotId]))}};
 const mismatch=solveRecurringPhaseCanonicalMinimum({...blocked,fullOwners:blockedGuidance,solver});
 check('unmatched relaxed capacity optimum is UNKNOWN, never canonical minimum',()=>{
  assert.equal(mismatch.status,'UNKNOWN_CANONICAL_PHASE');assert.equal(mismatch.minimumDoubledSpread,null);
  assert.equal(mismatch.candidateSource,null);assert.ok(mismatch.tiers.length>=3);
 });
 const malicious={solve(lp,options){const answer=structuredClone(solver.solve(lp,options));answer.evidence.terminalReport.utf8Sha256='0'.repeat(64);return answer;}};
 const rejected=solveRecurringPhaseCanonicalMinimum({...tiny,fullOwners,solver:malicious});
 check('mutated actual terminal receipt cannot claim canonical optimum',()=>{
  assert.equal(rejected.status,'UNKNOWN_CANONICAL_PHASE');assert.equal(rejected.minimumDoubledSpread,null);
 });
 for(const [name,mutate]of [
  ['model identity',answer=>{answer.modelAttestation.modelDigest='0'.repeat(64);}],
  ['SDK objective',answer=>{answer.result.ObjectiveValue+=0.01;}],
  ['SDK status',answer=>{answer.result.Status='Time limit reached';}],
  ['primal row',answer=>{const variable=Object.keys(answer.result.Columns).find(v=>v.startsWith('phase_x_'));answer.result.Columns[variable].Primal=0.5;}],
 ]){
  const hostile={solve(lp,options){const answer=structuredClone(solver.solve(lp,options));mutate(answer);return answer;}};
  const p=solveRecurringPhaseCanonicalMinimum({...tiny,fullOwners,solver:hostile});
  check('hostile actual '+name+' cannot admit a phase proof',()=>{
   assert.equal(p.status,'UNKNOWN_CANONICAL_PHASE');assert.equal(p.candidateSource,null);assert.equal(p.minimumDoubledSpread,null);
  });
 }
 const packet=JSON.parse(fs.readFileSync(new URL('./fixtures/static-weekly-policy-scope-receipts.json',import.meta.url)));
 const source=packet.cases.baseline.input,currentConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
 const guidance=JSON.parse(fs.readFileSync(new URL('../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))).owners;
 const currentBefore=canonicalJson(source),current=deriveScalableCanonicalRecurringPhaseCandidate({source,currentConfig,fullOwners:guidance,dayOfWeek:1,solver});
 console.log('CURRENT_PHASE_RESULT',JSON.stringify({status:current.status,reason:current.reason,minimumDoubledSpread:current.minimumDoubledSpread,
  preferenceCost:current.preferenceCost,packages:current.descriptor.packages.length,owners:current.descriptor.owners.length,tiers:current.tiers.length,
  canonicalRows:current.canonicalHardWitness?.hardConstraintCount}));
 check('actual current phase exceeds finite bound yet uses bounded real source-derived solve',()=>{
  assert.equal(current.descriptor.packages.length,23);assert.ok(current.tiers.length>0,current.reason);
  assert.equal(canonicalJson(source),currentBefore);assert.equal(current.published,false);assert.equal(current.sourceMutated,false);
  assert.equal(current.status,'PROVEN_CANONICAL_PHASE_MINIMUM',current.reason);
  assert.equal(current.minimumDoubledSpread,1);assert.equal(current.preferenceCost,358);
  assert.equal(current.canonicalHardWitness.feasible,true);assert.equal(current.canonicalHardWitness.hardConstraintCount,642);
 });
 const week=deriveScalableCanonicalRecurringWeekCandidate({source,currentConfig,fullOwners:guidance,solver});
 console.log('CURRENT_WEEK_RESULT',JSON.stringify({status:week.status,stage:week.stage,dayOfWeek:week.dayOfWeek,
  proofs:week.proofs.map(p=>({day:p.descriptor.dayOfWeek,status:p.status,reason:p.reason,solverStatus:p.lastSolverAttempt?.status,spread:p.minimumDoubledSpread,cost:p.preferenceCost}))}));
 check('complete current week never combines stale other-day witnesses',()=>{
  assert.equal(canonicalJson(source),currentBefore);
  assert.equal(week.status,'UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE',week.reason);
    assert.equal(week.proofs.length,7);assert.ok(week.proofs.every(p=>p.candidateSourceDigest===week.candidateSourceDigest));
    assert.equal(week.allOtherDaysBoundToFinalCandidate,true);assert.equal(week.canonicalHardWitness.feasible,true);
    assert.deepEqual(week.proofs.map(p=>p.minimumDoubledSpread),[1,1,1,1,1,1,1]);
    assert.deepEqual(week.proofs.map(p=>p.preferenceCost),[374,358,568,566,344,574,566]);
    assert.ok(week.proofs.every(p=>p.freshSolverRunClaim===false&&p.finalCanonicalWitnessDigest===week.canonicalHardWitness.witnessDigest
      &&p.lowerBoundEvidence.proofDigest===p.originalLowerBoundProofDigest
      &&p.lowerBoundEvidence.tiers.every(t=>t.rawReceiptDigest&&t.terminalReport)));
    assert.deepEqual(week.candidateSource.slots,source.slots);
    assert.deepEqual(week.candidateSource.versions[0].slotAvailability,source.versions[0].slotAvailability);
    assert.deepEqual(week.candidateSource.versions[0].assignments.filter(r=>r.window.start!=='09:45'),source.versions[0].assignments.filter(r=>r.window.start!=='09:45'));
 });
 const remainingDays=[],remainingDayProofs=[];
 for(const dayOfWeek of [2,3,4,5,6]){
  const p=deriveScalableCanonicalRecurringPhaseCandidate({source,currentConfig,fullOwners:guidance,dayOfWeek,solver});
  remainingDayProofs.push(p);
  remainingDays.push({dayOfWeek,status:p.status,reason:p.reason||null,solverStatus:p.lastSolverAttempt?.status||null,
   minimumDoubledSpread:p.minimumDoubledSpread,preferenceCost:p.preferenceCost??null,canonicalRows:p.canonicalHardWitness?.hardConstraintCount||null});
  check('real current weekday '+dayOfWeek+' has canonical proof or explicit non-admissible failure',()=>{
   assert.equal(canonicalJson(source),currentBefore);
   if(p.status==='PROVEN_CANONICAL_PHASE_MINIMUM'){
    assert.equal(p.canonicalHardWitness.feasible,true);assert.equal(p.independentlyMatchedCanonicalWitness,true);
    assert.ok(p.tiers.length>=3&&p.tiers.every(t=>t.rawReceiptDigest));
   }else{assert.equal(p.status,'UNKNOWN_CANONICAL_PHASE');assert.equal(p.candidateSource,null);assert.equal(p.minimumDoubledSpread,null);assert.ok(p.reason);}
  });
 }
 console.log('OTHER_CURRENT_DAYS',JSON.stringify(remainingDays));
 const freshShapes=[],freshShapeProofs=[];
 for(const count of [7,8]){
  const freshSource=structuredClone(source),freshConfig=structuredClone(currentConfig),v=freshSource.versions[0];
  for(const [i,key]of ['OPTION1','OPTION4'].slice(0,count-6).entries()){
   const slot=freshConfig.slots[key],personId=`72000000-0000-4000-8000-00000000000${i+1}`,name=`Synthetic fresh ${key} incumbent`;
   slot.vacancy=false;slot.personId=personId;slot.name=name;
   freshSource.slots.find(s=>s.id===slot.slotId).incumbencies.push({personId,displayName:name,effectiveStart:'2026-10-05',effectiveEnd:null});
   for(const a of v.slotAvailability.filter(a=>a.slotId===slot.slotId))a.status='working';
   v.vacantSlotIds=v.vacantSlotIds.filter(id=>id!==slot.slotId);
  }
  const before=canonicalJson(freshSource),proof=deriveScalableCanonicalRecurringPhaseCandidate({source:freshSource,currentConfig:freshConfig,fullOwners:guidance,dayOfWeek:1,solver});
  freshShapeProofs.push(proof);
  freshShapes.push({classification:'EXPLICIT_SYNTHETIC_FRESH_INCUMBENTS_NOT_REGISTERED_NOT_REAL_HIRES',staffedPositions:count,
   sourceDigest:contentDigest(freshSource),configDigest:contentDigest(freshConfig),status:proof.status,reason:proof.reason||null,
   workingOwners:proof.descriptor.owners.length,minimumDoubledSpread:proof.minimumDoubledSpread,preferenceCost:proof.preferenceCost??null,
   canonicalRows:proof.canonicalHardWitness?.hardConstraintCount||null,existingMorningPreservedNotProvedOptimal:true});
  check('fresh synthetic '+count+'-person source has real scalable canonical phase proof',()=>{
   assert.equal(proof.status,'PROVEN_CANONICAL_PHASE_MINIMUM',proof.reason);assert.equal(proof.descriptor.owners.length,count-1);
   assert.equal(proof.canonicalHardWitness.feasible,true);assert.equal(proof.published,false);assert.equal(proof.admitted,false);
   assert.equal(canonicalJson(freshSource),before);assert.equal(Object.values(freshConfig.slots).filter(s=>s.vacancy!==true).length,count);
   assert.deepEqual(freshSource.slots.map(s=>s.id),source.slots.map(s=>s.id));
   assert.deepEqual(v.assignments,source.versions[0].assignments);assert.deepEqual(freshSource.proximity,source.proximity);
  });
  if(count===7){
   const highs={solve(lp,options){return solver.solve(lp,{timeLimitSeconds:options.time_limit}).result;}};
   check('current normal morning source binds only exact authorized Admin secondary references',()=>{
    const normal=deriveRecurringStaffingPattern({currentConfig,targetSlots:freshConfig.slots,fullOwners:guidance,highs});
    assert.equal(normal.preview.flatMap(row=>row.secondaryPreferenceBindings).length,14);
    assert.ok(normal.preview.flatMap(row=>row.secondaryPreferenceBindings).every(row=>row.kind==='AUTHORIZED_ADMIN_MORNING_CURRENT_SOURCE'));
   });
   const supported=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url)));
   const supportedSlots=structuredClone(supported.slots);
   Object.assign(supportedSlots.OPTION1,{vacancy:false,personId:freshConfig.slots.OPTION1.personId,name:freshConfig.slots.OPTION1.name});
   const normal=deriveRecurringStaffingPattern({currentConfig:supported,targetSlots:supportedSlots,fullOwners:guidance,highs});
   check('original normal adapter supported historical shape retains genuine restrictions, not current admission',()=>{
    assert.equal(normal.preview.length,14);assert.deepEqual(normal.config.slots,supportedSlots);
    for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
     const output=normal.config.overrides[String(day)][phase];
     assert.deepEqual(Object.values(output).flat().sort(),Object.values(supported.overrides[String(day)][phase]).flat().sort());
     for(const [key,families]of Object.entries(output))for(const family of families)assertNormalOwnerEligibility({key,...supportedSlots[key]},family);
    }
    assert.equal(canonicalJson(source),currentBefore);assert.equal(canonicalJson(freshSource),before);
   });
  }
 }
 console.log('FRESH_SYNTHETIC_SHAPES',JSON.stringify(freshShapes));
 const receipt={status:'PASS',checks,elapsedMs:Math.round(performance.now()-started),currentStatus:current.status,
  currentReason:current.reason||null,currentMinimumDoubledSpread:current.minimumDoubledSpread,currentCanonicalHardRows:current.canonicalHardWitness?.hardConstraintCount||null,
  currentWeekStatus:week.status,currentWeekStage:week.stage||null,currentWeekDay:week.dayOfWeek??null,
  remainingDays,
  freshShapes,
  currentRoster:'EXACT_RETAINED_SIX_PERSON_SYNTHETIC_INPUT_PLUS_EXPLICIT_UNREGISTERED_SYNTHETIC_FRESH_SHAPES',solver:true,publication:false,worker:false,sql:false};
 if(process.env.CUSTODIAL_PHASE_EVIDENCE_PATH){
  const target=path.resolve(process.env.CUSTODIAL_PHASE_EVIDENCE_PATH);
  fs.writeFileSync(target,JSON.stringify({schema:'custodial.recurring-phase-focused-test-evidence.v1',receipt,
   current,week,remainingDayProofs,freshShapeProofs},null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringAdminMorningReferenceTests(){
 const started=performance.now();let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const currentConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url))),
  guidance=JSON.parse(fs.readFileSync(new URL('../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))).owners;
 const configBefore=canonicalJson(currentConfig),guideBefore=canonicalJson(guidance);
 for(let day=0;day<7;day++)for(const family of ['EAST_ADMIN','WEST_ADMIN']){
  const sourceOwner=new Map(Object.entries(currentConfig.overrides[day].morning).flatMap(([key,families])=>families.map(f=>[f,key])));
  const args={currentConfig,fullOwners:guidance,day,phase:'morning',family,sourceOwner};
  check(`authorized exact Admin reference ${day}/${family}`,()=>{
   assert.equal(guidance[day].morning[family],undefined);const r=recurringSecondaryOwnerReference(args);
   assert.equal(r.owner,sourceOwner.get(family));assert.equal(r.currentConfigDigest,contentDigest(currentConfig));
   assert.equal(r.historicalEqualizedOwner,guidance[day].equalized[family]);
  });
  for(const [name,mutate]of [
   ['flag absent',a=>{delete a.currentConfig.allowAdminMorning;}],
   ['flag false',a=>{a.currentConfig.allowAdminMorning=false;}],
   ['family not listed',a=>{a.currentConfig.adminFamilies=[];}],
   ['missing equalized',a=>{delete a.fullOwners[day].equalized[family];}],
   ['bad equalized identity',a=>{a.fullOwners[day].equalized[family]='UNKNOWN';}],
   ['missing source owner',a=>{a.sourceOwner.delete(family);}],
   ['changed source owner',a=>{a.sourceOwner.set(family,'OPTION1');}],
   ['unknown family',a=>{a.family='UNKNOWN';}],
  ]){check(`denied ${name} ${day}/${family}`,()=>{const a=structuredClone(args);mutate(a);assert.throws(()=>recurringSecondaryOwnerReference(a));});}
 }
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js');
 const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),results=[];
 for(const count of [6,7,8]){
  const targetSlots=structuredClone(currentConfig.slots);
  for(const [i,key]of ['OPTION1','OPTION4'].slice(0,count-6).entries())Object.assign(targetSlots[key],{
   vacancy:false,personId:`72000000-0000-4000-8000-00000000000${i+1}`,name:`Synthetic fresh ${key} incumbent`});
  const result=deriveRecurringStaffingPattern({currentConfig,targetSlots,fullOwners:guidance,
   highs:{solve(lp,options){return solver.solve(lp,{timeLimitSeconds:options.time_limit}).result;}}});
  check(`real normal generator ${count} synthetic/current shape binds14 references without data edits`,()=>{
   assert.equal(result.preview.length,14);assert.equal(result.preview.flatMap(r=>r.secondaryPreferenceBindings).length,14);
   for(let day=0;day<7;day++)for(const phase of ['morning','equalized']){
    const output=result.config.overrides[day][phase];
    assert.deepEqual(Object.values(output).flat().sort(),Object.values(currentConfig.overrides[day][phase]).flat().sort());
    for(const [key,families]of Object.entries(output))for(const family of families)assertNormalOwnerEligibility({key,...targetSlots[key]},family);
   }
   assert.equal(canonicalJson(currentConfig),configBefore);assert.equal(canonicalJson(guidance),guideBefore);
  });
  results.push({count,configDigest:contentDigest(result.config),secondaryPreferenceBindings:result.preview.flatMap(r=>r.secondaryPreferenceBindings),
   claim:'ORIGINAL_NORMAL_GENERATOR_REFERENCE_REGRESSION_NOT_CANONICAL_MINIMUM_OR_WORKER_ADMISSION',admitted:false,published:false});
 }
 const receipt={status:'PASS',checks,elapsedMs:Math.round(performance.now()-started),results,worker:false,sql:false,publication:false};
 if(process.env.CUSTODIAL_PHASE_ADMIN_EVIDENCE_PATH)fs.writeFileSync(path.resolve(process.env.CUSTODIAL_PHASE_ADMIN_EVIDENCE_PATH),
  JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringCurrentHandoutStructureTests(){
 const started=performance.now();let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const packet=JSON.parse(fs.readFileSync(new URL('./fixtures/static-weekly-policy-scope-receipts.json',import.meta.url))),
  templateConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url))),
  fullOwners=JSON.parse(fs.readFileSync(new URL('../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))).owners;
 const fullConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-recurring-schedule-20260924.json',import.meta.url)));
 const make=count=>{
  const source=structuredClone(packet.cases.baseline.input);source.version=source.versions[0];delete source.versions;
  const config=structuredClone(templateConfig);
  for(const [i,key]of ['OPTION1','OPTION4'].slice(0,count-6).entries()){
   Object.assign(config.slots[key],{vacancy:false,personId:`72000000-0000-4000-8000-00000000000${i+1}`,name:`Synthetic fresh ${key} incumbent`});
   source.slots.find(s=>s.id===config.slots[key].slotId).incumbencies.push({personId:config.slots[key].personId,
    displayName:config.slots[key].name,effectiveStart:'2026-10-05',effectiveEnd:null});
   for(const row of source.version.slotAvailability.filter(r=>r.slotId===config.slots[key].slotId))row.status='working';
   source.version.vacantSlotIds=source.version.vacantSlotIds.filter(id=>id!==config.slots[key].slotId);
  }
  const managerSnapshot={week_start:'2026-10-05',authority_revision:42,current_publication:{publication_id:source.version.publicationId},
   roster:Object.values(config.slots).map(slot=>({slot_id:slot.slotId,contractor_capacity:false,
    incumbencies:source.slots.find(s=>s.id===slot.slotId).incumbencies.map(p=>({person_id:p.personId,person_name:p.displayName,
     effective_start:p.effectiveStart,effective_end:p.effectiveEnd})),week_staffing:slot.vacancy===true?[]:slot.workDays.map(day=>({
      service_date:new Date(Date.parse('2026-10-05T12:00:00Z')+((day+6)%7)*86400000).toISOString().slice(0,10),
      person_id:slot.personId,employee_active:true}))}))};
  return {source,config,args:{publishedSource:{source_id:'73000000-0000-4000-8000-000000000001',
   publication_id:source.version.publicationId,authority_revision:42,compiler_input:source},managerSnapshot,
   templateConfig,fullConfig,fullOwners,effectiveDate:'2026-10-05',expectedRevision:42}};
 };
 const original=make(6),before=canonicalJson(original.args),structure=currentHandoutRecurringStructure(original.source,templateConfig);
 check('only exact retained September26 handout selects historical branch',()=>{
  const legacy=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20260926.json',import.meta.url)));
  assert.equal(currentHandoutRecurringStructure(original.source,legacy),null);
  const altered=structuredClone(legacy);altered.sourceHandout.precedence+=' altered';
  assert.throws(()=>currentHandoutRecurringStructure(original.source,altered));
  const downgrade=structuredClone(original.args);downgrade.templateConfig=legacy;
  assert.throws(()=>currentPatternFromPublishedReadback(downgrade),/assignment count changed/);
 });
 check('exact current package identities/multiplicity replace stale312 count',()=>{
  assert.equal(original.source.version.assignments.length,323);assert.equal(structure.fixedRows.length,1);
  assert.equal(structure.phaseByWorkId.get(structure.fixedRows[0].workId),null);assert.equal(structure.retiredFamilyBindings.length,4);
  const bound=currentPatternFromPublishedReadback(original.args);assert.equal(bound.sourcePatternKind,'UNSPLIT');
  assert.ok(!Object.values(bound.currentConfig.overrides['2'].morning).flat().includes('ELEPHANT_TRUNK_RESTROOMS'));
  assert.equal(canonicalJson(original.args),before);
 });
 for(const [name,mutate]of [
  ['drop package',a=>a.publishedSource.compiler_input.version.assignments.splice(0,1)],
  ['duplicate package',a=>a.publishedSource.compiler_input.version.assignments.push(structuredClone(a.publishedSource.compiler_input.version.assignments[0]))],
  ['different primary',a=>{a.publishedSource.compiler_input.version.assignments[0].locationId='73000000-0000-4000-8000-000000000999';}],
  ['different member',a=>{a.publishedSource.compiler_input.version.assignments[0].includedLocations[0].locationId='73000000-0000-4000-8000-000000000999';}],
  ['wrong service',a=>{a.publishedSource.compiler_input.version.assignments[0].serviceMode='reminder_only';}],
  ['wrong window',a=>{a.publishedSource.compiler_input.version.assignments[0].window.start='06:01';}],
  ['different handout',a=>{a.templateConfig.sourceHandout.pdfSha256='0'.repeat(64);}],
  ['missing lineage',a=>{delete a.templateConfig.dateAuthority;}],
  ['missing named handoff',a=>{delete a.publishedSource.compiler_input.version.shiftEndContinuityPolicy.namedHandoffs;}],
  ['changed named handoff',a=>{a.templateConfig.namedShiftEndHandoffs[0].at='15:00';}],
  ['both handoffs empty',a=>{a.templateConfig.namedShiftEndHandoffs=[];a.publishedSource.compiler_input.version.shiftEndContinuityPolicy.namedHandoffs=[];}],
  ['policy digest',a=>{a.publishedSource.compiler_input.version.shiftEndContinuityPolicy.policyDigest='0'.repeat(64);}],
  ['unknown retired family',a=>{a.templateConfig.retiredAreaFamilies.push('CHINA');}],
  ['missing retired family',a=>{a.templateConfig.retiredAreaFamilies.pop();}],
  ['unknown historical family',a=>{a.fullOwners['0'].morning.UNKNOWN='KAREN';}],
  ['retired outside exact historical day',a=>{a.fullOwners['2'].morning.BAMBOO_SPRINGS_GIFT_SHOP='KAREN';}],
  ['missing package guidance',a=>{delete a.fullOwners['0'].morning.CHINA;}],
  ['roster person',a=>{a.managerSnapshot.roster.find(r=>r.slot_id===templateConfig.slots.KAREN.slotId).incumbencies[0].person_id='73000000-0000-4000-8000-000000000999';}],
  ['roster active',a=>{a.managerSnapshot.roster.find(r=>r.slot_id===templateConfig.slots.KAREN.slotId).week_staffing[0].employee_active=false;}],
  ['revision',a=>{a.publishedSource.authority_revision++;}],
  ['publication',a=>{a.managerSnapshot.current_publication.publication_id='73000000-0000-4000-8000-000000000999';}],
 ])check(`refuse current worker-data seam ${name}`,()=>{const a=structuredClone(original.args);mutate(a);assert.throws(()=>currentPatternFromPublishedReadback(a));});
 const fixed=a=>a.publishedSource.compiler_input.version.assignments.find(row=>row.workId.includes(':one-time:'));
 for(const [name,mutate]of [
  ['drop',a=>{a.publishedSource.compiler_input.version.assignments=a.publishedSource.compiler_input.version.assignments.filter(row=>!row.workId.includes(':one-time:'));}],
  ['extra field',a=>{fixed(a).unknown=true;}],['window',a=>{fixed(a).window.start='08:00';}],
  ['priority',a=>{fixed(a).priority++;}],['mode',a=>{fixed(a).serviceMode='scan_tracked';}],
  ['physical member',a=>{fixed(a).includedLocations=[{locationId:fixed(a).locationId,locationNameSnapshot:'fake'}];}],
  ['owner',a=>{fixed(a).ownerSlotId=templateConfig.slots.KAREN.slotId;}],
 ])check(`refuse protected reminder ${name}`,()=>{const a=structuredClone(original.args);mutate(a);assert.throws(()=>currentPatternFromPublishedReadback(a));});
 check('trusted day-specific lunch preserves different days and explicit default',()=>{
  assert.deepEqual(recurringOwnerLunch(templateConfig.slots.KATHY,2),{start:'10:30',end:'11:30'});
  assert.deepEqual(recurringOwnerLunch(templateConfig.slots.KATHY,4),{start:'10:00',end:'11:00'});
  const defaultSlot=structuredClone(templateConfig.slots.KATHY);delete defaultSlot.lunchByDay;
  assert.deepEqual(recurringOwnerLunch(defaultSlot,3),{start:defaultSlot.lunch[0],end:defaultSlot.lunch[1]});
  assert.throws(()=>recurringOwnerLunch(templateConfig.slots.TAMMY,0));
  assert.deepEqual(templateConfig.slots.TAMMY.lunchByDay['0'],['08:30','09:30']);
 });
 for(const [name,mutate]of [
  ['null day value',s=>{s.lunchByDay['2']=null;}],['missing endpoint',s=>{s.lunchByDay['2']=['10:30'];}],
  ['invalid time',s=>{s.lunchByDay['2']=['24:00','25:00'];}],['reverse',s=>{s.lunchByDay['2']=['11:30','10:30'];}],
  ['outside shift',s=>{s.lunchByDay['2']=['00:00','01:00'];}],['unknown day',s=>{s.lunchByDay['9']=['11:30','12:30'];}],
  ['noncanonical day',s=>{s.lunchByDay['02']=['11:30','12:30'];}],['null map',s=>{s.lunchByDay=null;}],
 ])check(`refuse explicit lunch ${name}`,()=>{const s=structuredClone(templateConfig.slots.KATHY);mutate(s);assert.throws(()=>recurringOwnerLunch(s,2));});
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js');
 const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),results=[];
 for(const count of [6,7,8]){
  const fixture=make(count),snapshotBefore=canonicalJson(fixture.args),bound=currentPatternFromPublishedReadback(fixture.args);
  const normal=deriveRecurringStaffingPattern({currentConfig:bound.currentConfig,targetSlots:bound.currentConfig.slots,fullOwners,
    highs:{solve(lp,options){return solver.solve(lp,{timeLimitSeconds:options.time_limit}).result;}}});
  const adapted=adaptRegisteredRecurringSource({registeredSource:fixture.source,patternConfig:normal.config});
  const basis=createRecurringPhaseSourceBasis({registeredSource:fixture.source,patternConfig:normal.config});
  check(`actual worker-data helper seam ${count} preserves fixed reminder and accepted reference`,()=>{
   assert.equal(Object.values(bound.currentConfig.slots).filter(s=>s.vacancy!==true).length,count);
   const old=fixture.source.version.assignments.find(row=>row.workId.includes(':one-time:'));
   assert.equal(canonicalJson(adapted.compilerInput.version.assignments.find(row=>row.workId===old.workId)),canonicalJson(old));
   assert.equal(canonicalJson(basis.source.version.assignments.find(row=>row.workId===old.workId)),canonicalJson(old));
   for(const slot of Object.values(normal.config.slots))for(const day of slot.workDays){
    const row=adapted.compilerInput.version.slotAvailability.find(row=>row.dayOfWeek===day&&row.slotId===slot.slotId);
    assert.deepEqual(row.lunch,recurringOwnerLunch(slot,day));
   }
   assert.equal(basis.comparisonReference,'ORIGINAL_ACCEPTED_POST0945_SOURCE');
   assert.equal(canonicalJson(fixture.args),snapshotBefore);
  });
  const phase=deriveScalableCanonicalRecurringPhaseCandidate({source:basis.source,currentConfig:basis.ownerConfig,fullOwners,dayOfWeek:1,solver});
  check(`roster-bound normal ${count} phase baseline has actual canonical minimum witness`,()=>{
   assert.equal(phase.status,'PROVEN_CANONICAL_PHASE_MINIMUM',phase.reason);assert.equal(phase.minimumDoubledSpread,1);
   assert.equal(phase.canonicalHardWitness.feasible,true);
  });
  const final=recurringPatternFromFinalPhaseSource({phaseSourceBasis:basis,finalSource:phase.candidateSource});
  check(`final source rather than intermediate ${count} owners determines config`,()=>{
   assert.equal(final.finalSourceDigest,phase.candidateSourceDigest);
   for(const [key,families]of Object.entries(final.config.overrides['1'].equalized))for(const family of families)
    assert.equal(phase.candidateSource.version.assignments.find(row=>row.dayOfWeek===1&&row.window.start==='09:45'
     &&row.locationCodeSnapshot===family).originSlotId,final.config.slots[key].slotId);
   const forged=structuredClone(phase.candidateSource);forged.version.assignments.find(row=>row.workId.includes(':one-time:')).priority++;
   assert.throws(()=>recurringPatternFromFinalPhaseSource({phaseSourceBasis:basis,finalSource:forged}));
   const changedBudget=structuredClone(phase.candidateSource);changedBudget.version.assignments.find(row=>row.window.start==='09:45').serviceEffortMinutes++;
   assert.throws(()=>recurringPatternFromFinalPhaseSource({phaseSourceBasis:basis,finalSource:changedBudget}));
   assert.equal(canonicalJson(basis.source.version.shiftEndContinuityPolicy.namedHandoffs),canonicalJson(fixture.source.version.shiftEndContinuityPolicy.namedHandoffs));
  });
  const badSource=structuredClone(fixture.source);badSource.version.slotAvailability.find(r=>r.slotId===templateConfig.slots.KATHY.slotId&&r.dayOfWeek===4).lunch={start:'10:30',end:'11:30'};
  check(`refuse ${count} mismatched registered day lunch`,()=>assert.throws(()=>adaptRegisteredRecurringSource({registeredSource:badSource,patternConfig:normal.config})));
  const missingLunch=structuredClone(normal.config);delete missingLunch.slots.KATHY.lunchByDay['4'];
  check(`refuse ${count} missing authoritative explicit Thursday lunch`,()=>assert.throws(()=>adaptRegisteredRecurringSource({registeredSource:fixture.source,patternConfig:missingLunch})));
  results.push({count,basisDigest:basis.basisDigest,sourceDigest:contentDigest(basis.source),configDigest:contentDigest(basis.ownerConfig),
   phaseStatus:phase.status,minimumDoubledSpread:phase.minimumDoubledSpread,canonicalRows:phase.canonicalHardWitness.hardConstraintCount,
   finalPatternConfigDigest:final.configDigest,fixedReminderDigest:contentDigest(structure.fixedRows[0]),
   classification:'ACTUAL_PURE_WORKER_DATA_FUNCTIONS_WITH_SYNTHETIC_AUTHORITY_SHAPE_NOT_DB_HTTP_IPC_ADMISSION',published:false});
 }
 const receipt={status:'PASS',checks,elapsedMs:Math.round(performance.now()-started),results,workerIpc:false,sql:false,publication:false};
 if(process.env.CUSTODIAL_PHASE_STRUCTURE_EVIDENCE_PATH)fs.writeFileSync(path.resolve(process.env.CUSTODIAL_PHASE_STRUCTURE_EVIDENCE_PATH),
  JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--current-handout'))await runRecurringCurrentHandoutStructureTests();
 else if(process.argv.includes('--admin-morning'))await runRecurringAdminMorningReferenceTests();
 else if(process.argv.includes('--scalable'))await runStaticWeeklyRecurringPhaseScalableTests();
 else runStaticWeeklyRecurringPhaseAuthorityTests();
}
