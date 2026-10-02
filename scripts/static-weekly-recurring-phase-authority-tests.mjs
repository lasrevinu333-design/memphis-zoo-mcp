import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {contentDigest,canonicalJson,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {staticWeeklySafeName} from '../src/static-weekly-schedule-program.js';
import {postgresJsonbContentDigest as postgresDigest} from '../src/static-weekly-schedule-compiler.js';
import {getScheduleComponentWeightLedger} from '../src/schedule-component-weight-authority.js';
import {deriveCanonicalRecurringPhaseCandidate,deriveScalableCanonicalRecurringPhaseCandidate,
 deriveScalableCanonicalRecurringWeekCandidate,deriveRecurringStaffingPattern,recurringSecondaryOwnerReference,
 currentPatternFromPublishedReadback,currentHandoutRecurringStructure,adaptRegisteredRecurringSource,recurringOwnerLunch,
 createRecurringPhaseSourceBasis,recurringPatternFromFinalPhaseSource,createFullNineReductionContext,
 assertFullNineReductionPreferenceReceipt} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource,
 evaluateRecurringPhaseCanonicalSource,enumerateRecurringPhaseMinimum,assertRecurringPhaseMinimum}
 from '../src/static-weekly-recurring-phase-authority.js';
import {solveRecurringPhaseCanonicalMinimum,createRecurringPreferencePrimitiveObjective,
 assertRecurringPhasePreferenceNormalization,assertRecurringPreferencePrimitiveWitness,
 createRecurringIdentityRadixLayout,assertRecurringIdentityRadixEncoding,assertRecurringPhaseIdentityEncoding,
 createRecurringPhaseEvidenceInvocation} from '../src/static-weekly-recurring-phase-authority.js';
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
export function runRecurringPrimitiveObjectiveTests(){
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS primitive',name);};
 const terms=[[100,'a'],[4,'b'],[2,'c']],binary=['a','b','c'];
 check('exact100/4/2 positive GCD preserves distinct original and primitive units',()=>{
  const r=createRecurringPreferencePrimitiveObjective(terms,binary);assert.equal(r.positiveDivisor,2);
  assert.deepEqual(r.primitiveTerms,[[50,'a'],[2,'b'],[1,'c']]);assert.deepEqual(r.originalTerms,terms);
  assert.notEqual(r.originalUnit,r.primitiveUnit);assert.equal(r.fixedEqualityUsesOriginalTerms,true);
  const {normalizationDigest,...body}=r;assert.equal(normalizationDigest,contentDigest(body));
 });
 check('empty objective is exact divisor1',()=>{const r=createRecurringPreferencePrimitiveObjective([],binary);assert.equal(r.positiveDivisor,1);assert.deepEqual(r.primitiveTerms,[]);});
 check('coprime coefficients are unchanged',()=>{const r=createRecurringPreferencePrimitiveObjective([[100,'a'],[3,'b']],binary);assert.equal(r.positiveDivisor,1);});
 check('safe maximal coefficient reconstructed exactly by BigInt',()=>{const r=createRecurringPreferencePrimitiveObjective([[Number.MAX_SAFE_INTEGER,'a']],binary);assert.equal(r.positiveDivisor,Number.MAX_SAFE_INTEGER);assert.deepEqual(r.primitiveTerms,[[1,'a']]);});
 const witnessInput={terms,binary,normalization:createRecurringPreferencePrimitiveObjective(terms,binary),
  integerWitness:[['a',1],['b',1],['c',1]],primitiveObjectiveValue:53,originalScaleObjectiveValue:106};
 check('exact full witness reconstructs106 from53*2',()=>assert.equal(assertRecurringPreferencePrimitiveWitness(witnessInput).originalScaleObjectiveValue,106));
 for(const [name,mutate]of [
  ['nonprimitive divisor',x=>{x.normalization.positiveDivisor=1;}],['wrong original units',x=>{x.normalization.originalUnit='MINUTES';}],
  ['wrong primitive',x=>{x.primitiveObjectiveValue++;}],['wrong original',x=>{x.originalScaleObjectiveValue++;}],
  ['fractional binary witness',x=>{x.integerWitness[0][1]=0.5;}],['nonbinary witness',x=>{x.integerWitness[0][1]=2;}],
  ['unknown witness identity',x=>{x.integerWitness.push(['extra',1]);}],['duplicate witness',x=>{x.integerWitness.push(x.integerWitness[0]);}],
 ])check('reject witness '+name,()=>{const x=structuredClone(witnessInput);mutate(x);assert.throws(()=>assertRecurringPreferencePrimitiveWitness(x));});
 check('reject safe coefficient sum overflow via exactBigInt reconstruction',()=>{
  const t=[[Number.MAX_SAFE_INTEGER,'a'],[Number.MAX_SAFE_INTEGER,'b']],b=['a','b'];
  assert.throws(()=>assertRecurringPreferencePrimitiveWitness({terms:t,binary:b,normalization:createRecurringPreferencePrimitiveObjective(t,b),
   integerWitness:[['a',1],['b',1]],primitiveObjectiveValue:2,originalScaleObjectiveValue:Number.MAX_SAFE_INTEGER*2}));
 });
 for(const [name,t,b]of [
  ['fractional',[[2.5,'a']],binary],['negative',[[-2,'a']],binary],['zero',[[0,'a']],binary],
  ['unsafe',[[Number.MAX_SAFE_INTEGER+1,'a']],binary],['NaN',[[NaN,'a']],binary],['infinite',[[Infinity,'a']],binary],
  ['unknown variable',[[2,'foreign']],binary],['duplicate term',[[2,'a'],[4,'a']],binary],
  ['extra term field',[[2,'a','injected']],binary],['duplicate domain',[[2,'a']],['a','a']],
  ['nonstring domain',[],['a',1]],
 ])check('reject '+name,()=>assert.throws(()=>createRecurringPreferencePrimitiveObjective(t,b)));
 console.log(JSON.stringify({schema:'custodial.recurring-primitive-objective-tests.v1',checks,solver:false,toleranceChange:false}));return checks;
}
export function runRecurringIdentityRadixTests(){
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS radix',name);};
 const ids=Array.from({length:23},(_,i)=>`ordered-work-${i}`),layouts=[3,6].map(chunkSize=>createRecurringIdentityRadixLayout({ownerRadix:8,orderedWorkIds:ids,chunkSize}));
 const value=v=>layouts.map(layout=>assertRecurringIdentityRadixEncoding({layout,ownerIndexes:v,expectedOrderedWorkIds:ids}));
 const base=Array(23).fill(0);
 check('exact23-digit primitive reconstruction old6/new3 identical',()=>{
  for(const v of [base,Array(23).fill(7),ids.map((_,i)=>i%8)]){
   const e=value(v);assert.equal(e[0].completeLexvectorInteger,e[1].completeLexvectorInteger);
   assert.equal(e[0].chunkObjectives.length,8);assert.equal(e[1].chunkObjectives.length,4);
  }
 });
 // For every first differing digit and every ordered pair of legal digits,
 // maximal hostile suffixes cannot outweigh that earlier digit. This is the
 // actual radix-order lemma, not comparison of a solver stub's selected result.
 check('all23 first-difference positions preserve exact code-unit vector ordering',()=>{
  for(let position=0;position<23;position++)for(let a=0;a<8;a++)for(let b=a+1;b<8;b++){
   const low=Array(23).fill(7),high=Array(23).fill(0);
   for(let i=0;i<position;i++)low[i]=high[i]=i%8;low[position]=a;high[position]=b;
   const l=value(low),h=value(high);
   for(let i=0;i<2;i++){
    assert.ok(BigInt(l[i].completeLexvectorInteger)<BigInt(h[i].completeLexvectorInteger));
    const first=l[i].chunkObjectives.findIndex((x,j)=>x!==h[i].chunkObjectives[j]);assert.ok(first>=0);
    assert.ok(l[i].chunkObjectives[first]<h[i].chunkObjectives[first]);
   }
  }
 });
 for(const [name,mutate]of [
  ['omitted work',x=>{x.expectedOrderedWorkIds.pop();}],['reordered work',x=>{x.expectedOrderedWorkIds.reverse();}],
  ['omitted digit',x=>{x.ownerIndexes.pop();}],['fractional digit',x=>{x.ownerIndexes[0]=0.5;}],
  ['out-of-range digit',x=>{x.ownerIndexes[0]=8;}],['negative digit',x=>{x.ownerIndexes[0]=-1;}],
  ['invalid radix',x=>{x.layout.ownerRadix=0;}],['altered multiplier',x=>{x.layout.chunks[0].multipliers[0]++;}],
  ['omitted chunk',x=>{x.layout.chunks.pop();}],['reordered chunk',x=>{x.layout.chunks.reverse();}],
 ])check('refuse '+name,()=>{const x={layout:structuredClone(layouts[0]),ownerIndexes:[...base],expectedOrderedWorkIds:[...ids]};mutate(x);assert.throws(()=>assertRecurringIdentityRadixEncoding(x));});
 for(const ownerRadix of [0,-1,2.5,Number.MAX_SAFE_INTEGER+1])check('refuse invalid radix '+ownerRadix,()=>assert.throws(()=>createRecurringIdentityRadixLayout({ownerRadix,orderedWorkIds:ids})));
 check('refuse coefficient overflow',()=>assert.throws(()=>createRecurringIdentityRadixLayout({ownerRadix:Number.MAX_SAFE_INTEGER,orderedWorkIds:ids})));
 console.log(JSON.stringify({schema:'custodial.recurring-identity-radix-tests.v1',checks,solver:false,prioritiesChanged:false}));return checks;
}
function fullNineSyntheticFixtureFactory(){
 const fullConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-recurring-schedule-20260924.json',import.meta.url))),
  correctionConfig=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url))),
  fullIdentity=JSON.parse(fs.readFileSync(new URL('../config/custodial-full-nine-family-owners-20260926.json',import.meta.url))),fullOwners=fullIdentity.owners;
 // Existing explicitly named retained local artifact only. This runner does
 // not create an alleged production source/registration or solve nine staff.
 const bytes=fs.readFileSync(process.env.CUSTODIAL_FULL_NINE_BASE_PACKET||fullConfig.basePacket.path);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),fullConfig.basePacket.sha256,'exact retained full-nine base bytes required');
 const packet=JSON.parse(bytes),rawBase=packet.compilerInput;assert.equal(postgresDigest(rawBase),fullIdentity.baseSourceDigest);
 const make=count=>{
  const base=structuredClone(rawBase),historical=structuredClone(fullConfig);
  for(const [key,slot]of Object.entries(historical.slots).filter(([,s])=>s.personId)){
   const row=base.slots.find(r=>r.id===slot.slotId);
   if(!row.incumbencies.some(p=>p.effectiveStart<='2026-09-28'&&(!p.effectiveEnd||'2026-09-28'<p.effectiveEnd)))
    row.incumbencies.push({personId:slot.personId,displayName:slot.name,effectiveStart:'2026-09-28',effectiveEnd:null});
  }
  for(const [i,key]of ['OPTION1','OPTION2','OPTION4'].entries()){
   const slot=historical.slots[key],personId=`74000000-0000-4000-8000-00000000000${i+1}`,name=`Synthetic source-authorized ${key}`;
   Object.assign(slot,{personId,name,vacancy:false});
   const row=base.slots.find(r=>r.id===slot.slotId);
   for(const old of row.incumbencies)if(old.effectiveEnd===null)old.effectiveEnd='2026-09-28';
   row.incumbencies.push({personId,displayName:name,effectiveStart:'2026-09-28',effectiveEnd:null});
  }
  const accepted=adaptRegisteredRecurringSource({registeredSource:base,fullNineSource:base,patternConfig:historical}).compilerInput;
  assert.equal(accepted.version.assignments.length,313);
  for(const key of ['OPTION1','OPTION2','OPTION4']){
   const retained=(count>=7&&key==='OPTION1')||(count>=8&&key==='OPTION4');
   if(!retained)accepted.slots.find(s=>s.id===historical.slots[key].slotId).incumbencies.at(-1).effectiveEnd='2026-10-05';
  }
  const roster=Object.entries(correctionConfig.slots).map(([key,slot])=>{
   const row=accepted.slots.find(s=>s.id===slot.slotId),current=row.incumbencies.find(p=>p.effectiveStart<='2026-10-05'&&(!p.effectiveEnd||'2026-10-05'<p.effectiveEnd));
   return {slot_id:slot.slotId,contractor_capacity:false,incumbencies:row.incumbencies.map(p=>({person_id:p.personId,person_name:p.displayName,
    effective_start:p.effectiveStart,effective_end:p.effectiveEnd})),week_staffing:current?slot.workDays.map(day=>({
     service_date:new Date(Date.parse('2026-10-05T12:00:00Z')+((day+6)%7)*86400000).toISOString().slice(0,10),person_id:current.personId,employee_active:true})):[]};
  });
  return {publishedSource:{source_id:'75000000-0000-4000-8000-000000000001',publication_id:accepted.version.publicationId,
    authority_revision:42,compiler_input:accepted},managerSnapshot:{week_start:'2026-10-05',authority_revision:42,
     current_publication:{publication_id:accepted.version.publicationId},roster},correctionConfig,fullConfig,fullOwners,
    fullNineSource:{source_id:fullIdentity.baseSourceId,compiler_input:base},effectiveDate:'2026-10-05',expectedRevision:42};
 };
 return {make,fullConfig,correctionConfig,fullOwners,packet};
}
export function createSyntheticFullNineReductionFixture(count){
 assert.ok([6,7,8].includes(count),'explicit synthetic reduction count required');
 return fullNineSyntheticFixtureFactory().make(count);
}
export async function runRecurringFullNineReductionTests({counts=[6,7,8]}={}){
 assert.ok(Array.isArray(counts)&&counts.length>0&&new Set(counts).size===counts.length&&counts.every(n=>[6,7,8].includes(n)), 'explicit focused counts required');
 const started=performance.now();let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 runRecurringPrimitiveObjectiveTests();runRecurringIdentityRadixTests();
 const {make,fullConfig,correctionConfig,fullOwners,packet}=fullNineSyntheticFixtureFactory(),
  original=make(6),before=canonicalJson(original),context=createFullNineReductionContext(original);
 check('exact source313 kind is independent of target six occupancy',()=>{
  const bound=currentPatternFromPublishedReadback({...original,templateConfig:correctionConfig});
  assert.equal(bound.sourcePatternKind,'FULL_NINE');assert.equal(bound.reductionContext.contextDigest,context.contextDigest);
  assert.equal(Object.values(context.currentConfig.slots).filter(s=>!s.vacancy).length,6);assert.equal(canonicalJson(original),before);
 });
 check('split ledger retains all physical IDs/79 points and inherited family reference only',()=>{
  const split=context.comparisonLedger.find(r=>r.day===0&&r.phase==='equalized'&&r.family==='ZAMBEZI');
  assert.equal(split.originalRows.length,2);assert.equal(split.inheritedWorkloadPoints,79);
  assert.equal(split.referenceSlotId,correctionConfig.slots.KAILI.slotId);assert.equal(new Set(split.physicalMemberIds).size,3);
  assert.equal(contentDigest(split.originalRows),split.originalRowsDigest);
  assert.equal(split.referenceKind,'EXISTING_DOMINANT_POINT_SHARE_FAMILY_PREFERENCE_ONLY');
 });
 check('new authority correction is explicit full diff, not historical facts',()=>{
  assert.equal(context.correctionReceipt.newBytesAreHistoricalFacts,false);assert.ok(context.correctionReceipt.diff.length>0);
  assert.equal(context.correctionReceipt.diffDigest,contentDigest(context.correctionReceipt.diff));
  assert.equal(context.correctionReceipt.oldElephantReminder.dayOfWeek,1);
  assert.equal(context.correctionReceipt.currentTuesdayReminder.dayOfWeek,2);
  assert.equal(contentDigest(context.correctionReceipt.currentTuesdayReminder),'9f88759ab63488bbd9f43c1c45c6e915f0a53688216ee0c78911afb8ef8baf4b');
  assert.equal(context.correctionReceipt.historicalNamedPolicy.namedHandoffs,undefined);
  assert.deepEqual(context.correctionReceipt.currentNamedPolicy.namedHandoffs,correctionConfig.namedShiftEndHandoffs);
 });
 for(const [name,mutate]of [
  ['base work',x=>{x.fullNineSource.compiler_input.version.assignments[0].priority++;}],
  ['base ID',x=>{x.fullNineSource.source_id='74000000-0000-4000-8000-000000000099';}],
  ['current correction authority',x=>{x.correctionConfig.slots.KATHY.lunchByDay['4']=['10:30','11:30'];}],
  ['current named policy',x=>{x.correctionConfig.namedShiftEndHandoffs=[];}],
  ['historical config',x=>{x.fullConfig.overrides['1'].equalized.KAREN.pop();}],
  ['historical guidance',x=>{x.fullOwners['0'].equalized.ZAMBEZI='GREGORY';}],
  ['historical extra field',x=>{x.publishedSource.compiler_input.version.assignments[0].unknown=true;}],
  ['split drop',x=>{x.publishedSource.compiler_input.version.assignments=x.publishedSource.compiler_input.version.assignments.filter(r=>r.workId!=='0:ZAMBEZI:equalized:5d2d2a0e');}],
  ['split member',x=>{x.publishedSource.compiler_input.version.assignments.find(r=>r.workId==='0:ZAMBEZI:equalized:5d2d2a0e').includedLocations[0].locationId=correctionConfig.slots.KATHY.slotId;}],
  ['split points',x=>{x.publishedSource.compiler_input.version.assignments.find(r=>r.workId==='0:ZAMBEZI:equalized:5d2d2a0e').serviceEffortMinutes++;}],
  ['split owner',x=>{x.publishedSource.compiler_input.version.assignments.find(r=>r.workId==='0:ZAMBEZI:equalized:5d2d2a0e').originSlotId=correctionConfig.slots.KATHY.slotId;}],
  ['source person',x=>{x.publishedSource.compiler_input.slots.find(s=>s.id===correctionConfig.slots.KAREN.slotId).incumbencies.at(-1).personId='74000000-0000-4000-8000-000000000099';}],
  ['manager active',x=>{x.managerSnapshot.roster[0].week_staffing[0].employee_active=false;}],
  ['revision',x=>{x.managerSnapshot.authority_revision++;}],
  ['publication',x=>{x.managerSnapshot.current_publication.publication_id='74000000-0000-4000-8000-000000000099';}],
 ])check(`refuse full-nine reduction ${name}`,()=>{const x=structuredClone(original);mutate(x);assert.throws(()=>createFullNineReductionContext(x));});
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js');
 const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),results=[];
 for(const count of counts){
  const args=make(count),snapshot=canonicalJson(args),ctx=createFullNineReductionContext(args),
   normal=deriveRecurringStaffingPattern({currentConfig:ctx.currentConfig,targetSlots:ctx.currentConfig.slots,fullOwners,fullConfig,
    highs:{solve:(lp,options)=>solver.solve(lp,{timeLimitSeconds:options.time_limit}).result}}),
   basis=createRecurringPhaseSourceBasis({registeredSource:args.publishedSource.compiler_input,patternConfig:normal.config,reductionContext:ctx});
  check(`9→${count} basis preserves current fixed days/lunch/identity and historical ledger`,()=>{
   assert.equal(canonicalJson(args),snapshot);assert.equal(basis.reductionContext.contextDigest,ctx.contextDigest);
   for(const slot of Object.values(normal.config.slots))for(const day of slot.workDays){const a=basis.source.version.slotAvailability.find(r=>r.slotId===slot.slotId&&r.dayOfWeek===day);
    assert.deepEqual(a.lunch,recurringOwnerLunch(slot,day));assert.deepEqual(a.shift,{start:slot.shift[0],end:slot.shift[1]});}
   assert.equal(contentDigest(basis.source.version.assignments.find(r=>r.workId.includes(':one-time:'))),'9f88759ab63488bbd9f43c1c45c6e915f0a53688216ee0c78911afb8ef8baf4b');
   assert.equal(basis.ownerConfig.overrides['0'].equalized.KAILI.includes('ZAMBEZI'),true);
  });
  const proof=deriveScalableCanonicalRecurringWeekCandidate({source:basis.source,currentConfig:basis.ownerConfig,fullOwners,solver,phaseSourceBasis:basis});
  if(process.env.CUSTODIAL_FULL_NINE_REDUCTION_PROOFS_PATH)fs.writeFileSync(
   path.resolve(process.env.CUSTODIAL_FULL_NINE_REDUCTION_PROOFS_PATH)+`.${count}.json`,
   JSON.stringify({args,context:ctx,normalConfig:normal.config,basis,proof},null,2)+'\n',{flag:'wx'});
  check(`9→${count} all seven original-reference phase bounds match complete final canonical witness`,()=>{
   assert.equal(proof.status,'UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE',JSON.stringify({stage:proof.stage,day:proof.dayOfWeek,reason:proof.reason,
    last:proof.proofs?.at(-1)?.reason}));assert.equal(proof.proofs.length,7);assert.ok(proof.proofs.every(p=>p.status==='PROVEN_CANONICAL_PHASE_MINIMUM'));
   assert.equal(proof.canonicalHardWitness.feasible,true);assert.equal(proof.originalPreferenceBaselinePreserved,true);
  });
  check(`9→${count} mandatory constant is separate from actual raw LP and recomputed`,()=>{
 const p=proof.proofs[6],receipt=assertFullNineReductionPreferenceReceipt({phaseSourceBasis:basis,proof:p,dayOfWeek:6,fullOwners});
   assert.equal(receipt.fixedUnavoidableOriginalOwnerChangeCost,100);assert.equal(receipt.rawSolverReceiptIncludesConstant,false);
   assert.equal(receipt.originalScaleVariablePreferenceCost,p.preferenceCost);assert.equal(receipt.fullInheritedPreferenceCost,p.preferenceCost+100);
   assert.equal(receipt.rawPrimitiveLpPreferenceCost*receipt.objectiveNormalization.positiveDivisor,p.preferenceCost);
   for(const dayProof of proof.proofs){
    const input={proof:dayProof,source:basis.source,ownerConfig:basis.ownerConfig,fullOwners},
     transform=assertRecurringPhasePreferenceNormalization(input);
    assert.equal(transform.originalScaleObjectiveValue,dayProof.preferenceCost);
    for(const mutation of [
     t=>{t.objectiveNormalization.positiveDivisor++;},t=>{t.originalScaleObjectiveValue++;},
     t=>{t.objectiveValue++;},t=>{t.objectiveNormalization.originalUnit='MINUTES';},
     t=>{t.objectiveNormalization.primitiveTerms[0][0]++;},
     t=>{t.model.terms[0][0]++;},t=>{t.model.binary.push('forged_binary');},
     t=>{t.integerWitness.push(t.integerWitness[0]);},
    ]){
     const altered=structuredClone(dayProof),tier=altered.lowerBoundEvidence.tiers.find(t=>t.name==='inherited_preference');mutation(tier);
     const {normalizationDigest,...normalizationBody}=tier.objectiveNormalization;tier.objectiveNormalization.normalizationDigest=contentDigest(normalizationBody);
     tier.modelDigest=contentDigest(tier.model);
     assert.throws(()=>assertRecurringPhasePreferenceNormalization({...input,proof:altered}));
    }
    const altered=structuredClone(dayProof),raw=altered.lowerBoundEvidence,
     tierIndex=raw.tiers.findIndex(t=>t.name==='inherited_preference'),fixed=raw.tiers[tierIndex+1].model.rows.find(r=>r.name==='phase_fixed_2');
    fixed.value=raw.tiers[tierIndex].objectiveValue;
    assert.throws(()=>assertRecurringPhasePreferenceNormalization({...input,proof:altered}));
   }
   assert.equal(receipt.bindings[0].originalReferenceSlotId,correctionConfig.slots.GREGORY.slotId);
   assert.equal(receipt.bindings[0].mandatoryPrimarySlotId,correctionConfig.slots.KAREN.slotId);
   for(const mutation of [r=>r.fullInheritedPreferenceCost++,r=>r.fixedUnavoidableOriginalOwnerChangeCost=0,
    r=>r.bindings[0].originalReferenceSlotId=correctionConfig.slots.KAREN.slotId,r=>r.bindings[0].mandatoryPrimarySlotId=correctionConfig.slots.GREGORY.slotId]){
     const altered=structuredClone(p);mutation(altered.mandatoryCurrentOwnerPreferenceReceipt);
     const {receiptDigest,...body}=altered.mandatoryCurrentOwnerPreferenceReceipt;altered.mandatoryCurrentOwnerPreferenceReceipt.receiptDigest=contentDigest(body);
     assert.throws(()=>assertFullNineReductionPreferenceReceipt({phaseSourceBasis:basis,proof:altered,dayOfWeek:6,fullOwners}));
   }
  });
  const final=recurringPatternFromFinalPhaseSource({phaseSourceBasis:basis,finalSource:proof.candidateSource});
  check(`9→${count} final config is actual witness source and protected source stays bound`,()=>{
   assert.equal(final.finalSourceDigest,proof.candidateSourceDigest);const forged=structuredClone(proof.candidateSource);
   forged.version.assignments.find(r=>r.locationCodeSnapshot==='ZAMBEZI').includedLocations.pop();
   assert.throws(()=>recurringPatternFromFinalPhaseSource({phaseSourceBasis:basis,finalSource:forged}));
   const drift=structuredClone(ctx);drift.correctionReceipt.currentTuesdayReminder.priority++;
   assert.throws(()=>createRecurringPhaseSourceBasis({registeredSource:args.publishedSource.compiler_input,patternConfig:normal.config,reductionContext:drift}));
  });
  results.push({count,contextDigest:ctx.contextDigest,basisDigest:basis.basisDigest,sourceDigest:contentDigest(basis.source),
   finalSourceDigest:proof.candidateSourceDigest,finalConfigDigest:final.configDigest,comparisonLedgerDigest:ctx.comparisonLedgerDigest,
   correctionDiffDigest:ctx.correctionReceipt.diffDigest,minima:proof.proofs.map(p=>p.minimumDoubledSpread),
   rawVariableCosts:proof.proofs.map(p=>p.preferenceCost),fullInheritedCosts:proof.mandatoryCurrentOwnerPreferenceReceipts.map(p=>p.fullInheritedPreferenceCost),
   mandatoryPreferenceReceipts:proof.mandatoryCurrentOwnerPreferenceReceipts,canonicalRows:proof.canonicalHardWitness.hardConstraintCount,
   syntheticRoster:true,sql:false,workerIpc:false,published:false});
 }
 const receipt={status:'PASS',checks,counts,elapsedMs:Math.round(performance.now()-started),baseFileSha256:fullConfig.basePacket.sha256,
  baseSourceDigest:packet.sourceDigest,sourceProvenance:'EXACT_RETAINED_V6_BYTES_AND_ACTUAL_HISTORICAL_ADAPTER_WITH_EXPLICIT_SYNTHETIC_DATED_CURRENT_INCUMBENTS',results};
 if(process.env.CUSTODIAL_FULL_NINE_REDUCTION_EVIDENCE_PATH)fs.writeFileSync(path.resolve(process.env.CUSTODIAL_FULL_NINE_REDUCTION_EVIDENCE_PATH),
  JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringInvocationFactTests(){
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js'),
  solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4}),
  tiny=fixture(['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY']),fullOwners={1:{equalized:Object.fromEntries(tiny.source.versions[0].assignments.map(r=>[r.locationCodeSnapshot,r.originSlotId]))}},
  invocation=createRecurringPhaseEvidenceInvocation();let solverCalls=0;
 const freshSolver={solve(...args){solverCalls++;return solver.solve(...args);}},proof=invocation.solve({...tiny,fullOwners,solver:freshSolver});
 assert.equal(proof.status,'PROVEN_CANONICAL_PHASE_MINIMUM',proof.reason);let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS invocation facts',name);},input={proof,source:tiny.source,ownerConfig:tiny.ownerConfig,fullOwners};
 check('original private proof reuses only exact source/config/selection descriptor',()=>{
  assert.equal(invocation.assertPreference(input).descriptorValidation.method,'INVOCATION_LOCAL_PRIVATE_ORIGINAL_PROOF_SOURCE_HASH');
  assertRecurringPhaseIdentityEncoding(input);
 });
 check('ordinary exported validator fully recomputes',()=>assert.equal(assertRecurringPhasePreferenceNormalization(input).descriptorValidation.method,'FULL_SOURCE_RECOMPUTATION'));
 check('different invocation does not reuse prior seal',()=>assert.equal(createRecurringPhaseEvidenceInvocation().assertPreference(input).descriptorValidation.method,'FULL_SOURCE_RECOMPUTATION'));
 check('deep-cloned proof has no original private identity',()=>assert.equal(invocation.assertPreference({...input,proof:structuredClone(proof)}).descriptorValidation.method,'FULL_SOURCE_RECOMPUTATION'));
 check('serialized proof has no original private identity',()=>assert.equal(invocation.assertPreference({...input,proof:JSON.parse(JSON.stringify(proof))}).descriptorValidation.method,'FULL_SOURCE_RECOMPUTATION'));
 check('no caller seal or skip API',()=>{assert.equal(invocation.seal,undefined);assert.ok(Object.isFrozen(invocation));assert.deepEqual(Object.keys(invocation).sort(),['assertPreference','solve']);});
 for(const [name,mutate]of [
  ['changed actual source',x=>{x.source.versions[0].assignments[0].priority++;}],
  ['changed actual config',x=>{x.ownerConfig.weights.CHINA++;}],
  ['mutated owner choice',x=>{x.proof.descriptor.choices[0].owners.pop();}],
  ['mutated primitive objective',x=>{x.proof.tiers.find(t=>t.name==='inherited_preference').objectiveValue++;}],
  ['mutated selected multiplicity',x=>{x.proof.descriptor.selectedWorkIds.pop();}],
 ])check('reject '+name,()=>{const x=structuredClone(input);mutate(x);assert.throws(()=>invocation.assertPreference(x));});
 check('mutation of original private proof cannot mutate deep sealed facts',()=>{
  const original=structuredClone(proof.descriptor);proof.descriptor.choices[0].owners.pop();
  assert.throws(()=>invocation.assertPreference(input));proof.descriptor=original;
  assert.equal(invocation.assertPreference(input).descriptorValidation.method,'INVOCATION_LOCAL_PRIVATE_ORIGINAL_PROOF_SOURCE_HASH');
 });
 check('same-source prepared facts still require every fresh terminal and witness',()=>{
  const before=solverCalls,p=invocation.solve({...tiny,fullOwners,solver:freshSolver});assert.equal(p.status,'PROVEN_CANONICAL_PHASE_MINIMUM',p.reason);
  assert.ok(solverCalls-before>=3);assert.notEqual(p,proof);
 });
 check('changed actual incumbency cannot use prepared facts from unchanged source',()=>{
  const source=structuredClone(tiny.source);source.slots[0].incumbencies[0].displayName='changed actual source identity';
  assert.throws(()=>invocation.solve({...tiny,source,fullOwners,solver:freshSolver}));
 });
 const receipt={schema:'custodial.recurring-invocation-facts-tests.v1',checks,realTinySolverRuns:2,solverCalls,solverOptimaCached:false,canonicalWitnessCached:false,crossRequestCache:false};
 console.log(JSON.stringify(receipt));return receipt;
}
export async function runRecurringReductionInvocationMutationTests(){
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js'),
  solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4});
 let checks=0;
 for(const rehash of [false,true]){
  const args=createSyntheticFullNineReductionFixture(6),context=createFullNineReductionContext(args),
   bound=currentPatternFromPublishedReadback({...args,templateConfig:args.correctionConfig}),
   pattern=deriveRecurringStaffingPattern({currentConfig:bound.currentConfig,targetSlots:bound.currentConfig.slots,fullOwners:args.fullOwners,fullConfig:args.fullConfig,
    highs:{solve:(lp,options)=>solver.solve(lp,{timeLimitSeconds:options.time_limit}).result}}),
   basis=createRecurringPhaseSourceBasis({registeredSource:args.publishedSource.compiler_input,patternConfig:pattern.config,reductionContext:context});
  let changed=false;
  const hostile={solve(...inputs){const result=solver.solve(...inputs);if(!changed){changed=true;
    basis.fixedOtherDaysSource.version.assignments.find(r=>r.window.start==='09:45').serviceEffortMinutes++;
    if(rehash){const {basisDigest,...body}=basis;basis.basisDigest=contentDigest(body);}}
   return result;}};
  assert.throws(()=>deriveScalableCanonicalRecurringWeekCandidate({source:basis.source,currentConfig:basis.ownerConfig,
    fullOwners:args.fullOwners,solver:hostile,phaseSourceBasis:basis}),
    rehash?/fixed-other-day scaffold changed package\/budget\/provenance/:/reduction phase basis changed/);
  assert.equal(changed,true);checks++;console.log('PASS invocation reduction basis mutation',rehash?'rehashed actual bytes still fully revalidated':'actual bytes invalidate exact source-keyed facts');
 }
 const receipt={schema:'custodial.recurring-reduction-invocation-mutations.v1',checks,realSolver:true,syntheticRoster:true,noOptimumCache:true};console.log(JSON.stringify(receipt));return receipt;
}
export function runRecurringRetainedTransformTests({files}){
 assert.ok(Array.isArray(files)&&files.length>0,'explicit retained actual proof files required');let checks=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS retained transform',name);};
 installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text,'utf8').digest('hex'));
 const receipts=[];
 for(const file of files){const bytes=fs.readFileSync(file),x=JSON.parse(bytes),{basis,proof}=x,fullOwners=x.args.fullOwners;
  assert.equal(proof.status,'UNREGISTERED_CANONICAL_RECURRING_WEEK_CANDIDATE','no retained UNKNOWN promoted');
  assert.equal(proof.proofs.length,7);assert.equal(proof.canonicalHardWitness.feasible,true);
  for(const [day,dayProof]of proof.proofs.entries()){
   const input={proof:dayProof,source:basis.source,ownerConfig:basis.ownerConfig,fullOwners};
   check(`actual ${file.split('.').at(-2)} day${day} exact primitive+radix+constant`,()=>{
    assertRecurringPhasePreferenceNormalization(input);assertRecurringPhaseIdentityEncoding({proof:dayProof,ownerConfig:basis.ownerConfig});
    assertFullNineReductionPreferenceReceipt({phaseSourceBasis:basis,proof:dayProof,dayOfWeek:day,fullOwners});
   });
   check(`day${day} hostile identity/report coefficients cannot rehash authority`,()=>{
    for(const mutate of [
     p=>{p.lowerBoundEvidence.identityLayout.chunks.pop();},p=>{p.lowerBoundEvidence.identityLayout.orderedWorkIds.reverse();},
     p=>{p.lowerBoundEvidence.identityEncoding.completeLexvectorInteger='0';},p=>{p.lowerBoundEvidence.stableIdentity[0]++;},
     p=>{p.lowerBoundEvidence.tiers.find(t=>t.name==='inherited_identity_0').model.terms[0][0]++;},
     p=>{p.lowerBoundEvidence.tiers.find(t=>t.name==='inherited_identity_3').model.rows.find(r=>r.name==='phase_fixed_3').value++;},
    ]){const p=structuredClone(dayProof);mutate(p);for(const t of p.lowerBoundEvidence.tiers)t.modelDigest=contentDigest(t.model);
     assert.throws(()=>assertRecurringPhaseIdentityEncoding({proof:p,ownerConfig:basis.ownerConfig}));}
    const changed=structuredClone(dayProof);changed.lowerBoundEvidence.descriptor.choices[0].owners.pop();
    const {descriptorDigest,...body}=changed.lowerBoundEvidence.descriptor;changed.lowerBoundEvidence.descriptor.descriptorDigest=contentDigest(body);
    changed.descriptor=structuredClone(changed.lowerBoundEvidence.descriptor);
    assert.throws(()=>assertRecurringPhasePreferenceNormalization({...input,proof:changed}));
   });
  }
  receipts.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),wholeWeekCanonicalWitnessDigest:proof.canonicalHardWitness.witnessDigest});
 }
 const receipt={schema:'custodial.recurring-retained-transforms-tests.v1',checks,receipts,newSolverRuns:0,publication:false};console.log(JSON.stringify(receipt));return receipt;
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
 if(process.argv.includes('--invocation-basis-mutations'))await runRecurringReductionInvocationMutationTests();
 else if(process.argv.includes('--invocation-facts'))await runRecurringInvocationFactTests();
 else if(process.argv.includes('--primitive-objective')){runRecurringPrimitiveObjectiveTests();runRecurringIdentityRadixTests();}
 else if(process.argv.includes('--full-nine-reduction'))await runRecurringFullNineReductionTests();
 else if(process.argv.includes('--current-handout'))await runRecurringCurrentHandoutStructureTests();
 else if(process.argv.includes('--admin-morning'))await runRecurringAdminMorningReferenceTests();
 else if(process.argv.includes('--scalable'))await runStaticWeeklyRecurringPhaseScalableTests();
 else runStaticWeeklyRecurringPhaseAuthorityTests();
}
