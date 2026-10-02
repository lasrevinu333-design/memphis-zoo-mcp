import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {contentDigest,canonicalJson} from '../src/static-weekly-schedule-model.js';
import {staticWeeklySafeName} from '../src/static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger} from '../src/schedule-component-weight-authority.js';
import {deriveCanonicalRecurringPhaseCandidate} from '../src/static-weekly-recurring-staffing-adaptation.js';
import {createRecurringPhaseDescriptor,createRecurringPhaseProspectiveSource,
 evaluateRecurringPhaseCanonicalSource,enumerateRecurringPhaseMinimum,assertRecurringPhaseMinimum}
 from '../src/static-weekly-recurring-phase-authority.js';
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
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runStaticWeeklyRecurringPhaseAuthorityTests();
