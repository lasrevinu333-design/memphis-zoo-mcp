import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getScheduleComponentWeightLedger} from '../src/schedule-component-weight-authority.js';
import {installStaticWeeklySha256HexAccelerator,contentDigest} from '../src/static-weekly-schedule-model.js';
import {initializeStaticWeeklySolverEngine} from '../src/static-weekly-schedule-solver-worker.js';
import {solveRecurringPhaseCanonicalMinimum,assertRecurringPhaseIdentityEncoding,createRecurringIdentityUnitObjective} from '../src/static-weekly-recurring-phase-authority.js';
const sha=x=>createHash('sha256').update(x).digest('hex');installStaticWeeklySha256HexAccelerator(sha);
const bytes=readFileSync(new URL('./static-weekly-recurring-phase-authority-tests.mjs',import.meta.url));
assert.equal(sha(bytes),'5ca762a9765b497e1bd5fe1c634b46284886a106762d6c7308cd7321b8e46533');
const text=bytes.toString(),start="const slotA=",end='// Independent finite oracle';
assert.equal(text.split(start).length,2);assert.equal(text.split(end).length,2);
// Extract only the unchanged synthetic data factory; product imports remain current.
const fixture=Function('ledger',text.slice(text.indexOf(start),text.indexOf(end))+';return fixture;')(new Map(getScheduleComponentWeightLedger().families.map(f=>[f.code,f])));
const solver=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:256,maxWasmMemoryPages:1536,maxSemiSpaceSizeMb:4});let checks=0;
for(const fixed of [false,true]){
 const input=fixed?fixture(['CHINA'],{fixedPhase:['CAT_COUNTRY','PRIMATE_CANYON']}):fixture(['CHINA','BREEZEWAY_RESTROOMS','CAT_COUNTRY']);
 const fullOwners={1:{equalized:Object.fromEntries(input.source.versions[0].assignments.map(r=>[r.locationCodeSnapshot,r.originSlotId]))}},proof=solveRecurringPhaseCanonicalMinimum({...input,fullOwners,solver});
 assert.equal(proof.status,'PROVEN_CANONICAL_PHASE_MINIMUM',proof.reason);assertRecurringPhaseIdentityEncoding({proof,ownerConfig:input.ownerConfig});checks++;
 assert.ok(proof.tiers.every(t=>t.model.integerLoadBoundsVersion===1));assert.equal(proof.tiers[0].model.rows.filter(r=>r.name.startsWith('phase_integer_load_')).length,0);assert.equal(proof.tiers[1].model.rows.filter(r=>r.name.startsWith('phase_integer_load_')).length,4);checks++;
 const d=proof.descriptor,keys=Object.keys(input.ownerConfig.slots).sort(),bySlot=new Map(keys.map(k=>[input.ownerConfig.slots[k].slotId,k])),packages=new Map(d.packages.map(p=>[p.workId,p]));
 const compare=(a,b)=>a<b?-1:a>b?1:0,owners=d.owners.slice().sort((a,b)=>compare(bySlot.get(a.slotId),bySlot.get(b.slotId))),choices=d.choices.slice().sort((a,b)=>compare(packages.get(a.workId).family,packages.get(b.workId).family));
 for(const mutate of [
  m=>m.rows.find(r=>r.name==='phase_integer_load_floor_0').value++,
  m=>m.rows.find(r=>r.name==='phase_integer_load_ceiling_0').value++,
  m=>m.rows.splice(m.rows.findIndex(r=>r.name==='phase_integer_load_floor_0'),1),
  m=>{const i=m.rows.findIndex(r=>r.name==='phase_integer_load_floor_0');[m.rows[i],m.rows[i+1]]=[m.rows[i+1],m.rows[i]];},
  m=>m.rows.find(r=>r.name==='phase_integer_load_floor_0').terms[0][0]++,
  m=>delete m.integerLoadBoundsVersion,
 ]){
  const changed=structuredClone(proof),tier=changed.tiers.find(t=>t.name.startsWith('inherited_identity_')),rep=tier.identityObjectiveRepresentation;
  const base={...structuredClone(tier.model),terms:rep.originalTerms,rows:tier.model.rows.filter(r=>r.name!==rep.definingRow.name),general:['phase_spread'],bounds:tier.model.bounds.slice(0,1)};mutate(base);
  const replacement=createRecurringIdentityUnitObjective({model:base,layout:changed.identityLayout,choices,owners,offset:rep.offset});
  tier.model=replacement.model;tier.modelDigest=contentDigest(tier.model);tier.lpDigest=sha(replacement.lp);tier.identityObjectiveRepresentation=replacement.representation;
  assert.throws(()=>assertRecurringPhaseIdentityEncoding({proof:changed,ownerConfig:input.ownerConfig}));checks++;
 }
 const unknown=structuredClone(proof);unknown.tiers[0].model.integerLoadBoundsVersion=2;assert.throws(()=>assertRecurringPhaseIdentityEncoding({proof:unknown,ownerConfig:input.ownerConfig}));checks++;
}
console.log(JSON.stringify({status:'PASS',checks,actualTinySolves:2,currentRowsIndependentlyReconstructed:true,selfRehashedMutationsRefused:12,SQL:false,app_build:false,phone:false}));
