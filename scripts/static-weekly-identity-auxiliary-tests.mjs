// Portable identity representation contract and optional one-tier engine proof.
// Explicitly synthetic extraction; no whole-week or production-data claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalJson,contentDigest as digest} from '../src/static-weekly-schedule-model.js';
import {createRecurringIdentityRadixLayout,createRecurringIdentityUnitObjective,assertRecurringIdentityUnitRepresentation,assertRecurringIdentityUnitWitness,
 assertRecurringPhaseIdentityEncoding,assertRecurringIdentityRadixEncoding,createRecurringPreferencePrimitiveObjective} from '../src/static-weekly-recurring-phase-authority.js';
const clone=structuredClone,sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const pinned={fixture:'56e8b4fbbd6524204a36416a5697d9688b42f2f390247cd7aa6084a49d195502',
 model:'94620b04c1d4a0dcaebaf3e8a6e47832284593f95438843ed0ee5cfa731d3282',
 lp:'c2a3c87cb4b75516343c819a8e4af5c15b24b2737429f030665975d472395dd4'};
const scalar=terms=>terms.length?terms.map(([n,v])=>`${n<0?'-':'+'} ${Math.abs(n)} ${v}`).join(' ').replace(/^\+ /,''):'0';
const lpFor=m=>`Minimize\n phase_objective: ${scalar(m.terms)}\nSubject To\n${m.rows.map(r=>` ${r.name}: ${scalar(r.terms)} ${r.relation} ${r.value}`).join('\n')}\nBounds\n ${m.bounds.join('\n ')}\nGeneral\n ${m.general.join(' ')}\nBinary\n ${m.binary.join(' ')}\nEnd\n`;
function safe(n){assert.ok(Number.isSafeInteger(n),'unsafe integer');return n;}
function maximum(radix,length){safe(radix);safe(length);assert.ok(radix>=1&&length>=1&&length<=3,'explicit radix3 chunk');
 const n=BigInt(radix)**BigInt(length)-1n;assert.ok(n<=BigInt(Number.MAX_SAFE_INTEGER),'unsafe radix bound');return Number(n);}
function termsFor(layout,choices,owners,offset){const c=layout.chunks.find(c=>c.offset===offset);assert.ok(c,'exact chunk offset');
 return choices.slice(c.offset,c.offset+c.orderedWorkIds.length).flatMap((choice,i)=>owners.flatMap((o,j)=>j&&choice.owners.some(x=>x.slotId===o.slotId)
  ?[[safe(j*c.multipliers[i]),`phase_x_${c.offset+i}_${j}`]]:[]));}
function validateBase(context){createRecurringIdentityUnitObjective(context);return context.layout.chunks.find(c=>c.offset===context.offset);}
const represent=createRecurringIdentityUnitObjective;
const assertRepresentation=(received,context)=>assertRecurringIdentityUnitRepresentation({received,...context});
function assertIntegerWitness(model,values){const variables=[...model.binary,...model.general];
 assert.equal(values.size,variables.length,'extra/missing integer witness');assert.ok(variables.every(v=>values.has(v)&&Number.isSafeInteger(values.get(v))),'noninteger/missing witness');
 assert.ok(model.binary.every(v=>[0,1].includes(values.get(v))),'nonbinary witness');
 for(const b of model.bounds){const match=/^(\d+) <= (\w+) <= (\d+)$/.exec(b);assert.ok(match,'unknown bound syntax');
  const value=BigInt(values.get(match[2]));assert.ok(value>=BigInt(match[1])&&value<=BigInt(match[3]),'integer bound');}
 for(const r of model.rows){const lhs=r.terms.reduce((n,[c,v])=>n+BigInt(c)*BigInt(values.get(v)),0n),rhs=BigInt(r.value);
  assert.ok(r.relation==='='?lhs===rhs:r.relation==='<='?lhs<=rhs:lhs>=rhs,'exact integer row');}
 return model.terms.reduce((n,[c,v])=>n+BigInt(c)*BigInt(values.get(v)),0n);
}
function loadContext(){const bytes=fs.readFileSync(new URL('./fixtures/recurring-identity-retained-failure.json',import.meta.url));assert.equal(sha(bytes),pinned.fixture);
 const fixture=JSON.parse(bytes),a=fixture.attempt,d=fixture.descriptor,cfg=fixture.ownerConfig;
 assert.equal(fixture.originalStatus,'UNKNOWN_CANONICAL_PHASE');assert.equal(a.name,'inherited_identity_0');assert.equal(digest(a.model),pinned.model);
 assert.equal(a.model.descriptorDigest,d.descriptorDigest);
 assert.equal(a.modelDigest,pinned.model);assert.equal(sha(lpFor(a.model)),pinned.lp);assert.equal(a.lpDigest,pinned.lp);assert.equal(d.configDigest,digest(cfg));
 const keys=Object.keys(cfg.slots).sort(),keyBySlot=new Map(keys.map(k=>[cfg.slots[k].slotId,k])),packages=new Map(d.packages.map(p=>[p.workId,p])),
  owners=d.owners.slice().sort((a,b)=>keyBySlot.get(a.slotId)<keyBySlot.get(b.slotId)?-1:1),
  choices=d.choices.slice().sort((a,b)=>packages.get(a.workId).family<packages.get(b.workId).family?-1:1),
  layout=createRecurringIdentityRadixLayout({ownerRadix:owners.length,orderedWorkIds:choices.map(c=>c.workId)}),
  context={model:clone(a.model),layout,owners,choices,offset:0};validateBase(context);
 return {context,fixture};
}
// The unchanged private checker and decimal helpers are fragment-byte-pinned.
// No fixture code or weaker parallel terminal comparison is executed.
function strictChecker(){const bytes=fs.readFileSync(new URL('../src/static-weekly-recurring-phase-authority.js',import.meta.url));
 const source=bytes.toString(),start=source.indexOf('const pinnedPhaseSolver='),end=source.indexOf('// Existing portable hash implementation;',start);
 assert.ok(start>=0&&end>start);const fragment=source.slice(start,end);assert.equal(sha(fragment),'809b275b92a35904a17f6c605d6fbac30965b3466feb52c29d166258b194bbea');const requireFact=(ok,message)=>assert.ok(ok,message);
 return {assertTerminal:new Function('canonicalJson','requireFact','contentDigestBytes','Buffer',fragment+'\nreturn checkPhaseTerminal;')(canonicalJson,requireFact,sha,Buffer),
  exactCheckerSourceSha256:sha(fragment),productionPhaseSha256:sha(bytes)};
}
function syntheticContext(radix,length){maximum(radix,length);const owners=Array.from({length:radix},(_,i)=>({slotId:`owner-${i}`})),
 choices=Array.from({length},(_,i)=>({workId:`work-${i}`,owners:clone(owners)})),layout=createRecurringIdentityRadixLayout({ownerRadix:radix,orderedWorkIds:choices.map(c=>c.workId)}),
 binary=choices.flatMap((c,i)=>owners.map((o,j)=>`phase_x_${i}_${j}`)),rows=choices.map((c,i)=>({name:`phase_cover_${i}`,terms:owners.map((o,j)=>[1,`phase_x_${i}_${j}`]),relation:'=',value:1})),
 model={descriptorDigest:'0'.repeat(64),name:'inherited_identity_0',terms:termsFor(layout,choices,owners,0),rows,binary,general:['phase_spread'],bounds:['0 <= phase_spread <= 0']};
 // An independent fixed earlier-tier condition, preserved by the transform.
 rows.push({name:'fixed_original_condition',terms:owners.map((o,j)=>[j,`phase_x_0_${j}`]),relation:'=',value:Math.floor((radix-1)/2)});
 return {model,layout,owners,choices,offset:0};
}
export function runStaticWeeklyIdentityAuxiliaryTests(){let checks=0,vectors=0,feasibleVectors=0;
 const {context}=loadContext(),transformed=represent(context);assert.deepEqual(assertRepresentation(transformed,context),transformed);checks++;
 const originalWitness=new Map(loadContext().fixture.attempt.integerWitness);assert.equal(assertIntegerWitness(context.model,originalWitness),9n);checks++;
 const extended=new Map(originalWitness);extended.set(transformed.representation.variable,9);assert.equal(assertIntegerWitness(transformed.model,extended),9n);checks++;
 assert.equal(assertRecurringIdentityUnitWitness({...context,received:transformed,integerWitness:[...extended],objectiveValue:9}).originalObjectiveValue,9);checks++;
 const rebind=x=>{x.representation.transformedModelDigest=digest(x.model);x.lp=lpFor(x.model);x.representation.transformedLpDigest=sha(x.lp);
  const {representationDigest,...body}=x.representation;x.representation.representationDigest=digest(body);};
 for(const mutate of [x=>x.model.rows.at(-1).terms.pop(),x=>x.model.rows.at(-1).terms.push(clone(x.model.rows.at(-1).terms[0])),
  x=>x.model.rows.at(-1).terms[0][0]++,x=>x.model.rows.at(-1).terms[0][1]='unknown',x=>x.model.rows.at(-1).terms.reverse(),
  x=>x.model.rows.pop(),x=>x.model.general.pop(),x=>x.model.binary.pop(),x=>x.model.binary.reverse(),
  x=>x.model.bounds[x.model.bounds.length-1]='0 <= phase_identity_objective_0 <= 216',x=>x.model.terms[0][0]=2,
  x=>x.model.rows.find(r=>r.name==='phase_fixed_1').value++,x=>x.representation.originalTerms.pop(),x=>x.representation.orderedChunkWorkIds.reverse(),
  x=>x.model.rows.reverse(),x=>x.model.rows.at(-1).terms[0][0]=Number.MAX_SAFE_INTEGER+1]){
  const x=clone(transformed);mutate(x);rebind(x);assert.throws(()=>assertRepresentation(x,context));checks++;
 }
 for(const wrong of [9.5,-1,216,Number.MAX_SAFE_INTEGER+1]){const w=new Map(extended);w.set(transformed.representation.variable,wrong);
  assert.throws(()=>assertIntegerWitness(transformed.model,w));
  assert.throws(()=>assertRecurringIdentityUnitWitness({...context,received:transformed,integerWitness:[...w],objectiveValue:wrong}));checks++;}
 assert.throws(()=>maximum(1000000,3));checks++;assert.throws(()=>maximum(2,4));checks++;
 for(const mutate of [c=>c.model.terms.pop(),c=>c.model.terms.push(clone(c.model.terms[0])),c=>c.model.terms.reverse(),
  c=>c.model.terms[0][0]++,c=>c.model.terms[0][1]='unknown',c=>c.model.terms[0][0]=Number.MAX_SAFE_INTEGER+1,
  c=>c.model.rows.splice(c.model.rows.findIndex(r=>r.name==='phase_cover_0'),1),c=>c.model.rows.find(r=>r.name==='phase_cover_0').terms[0][0]=2,
  c=>c.layout.orderedWorkIds.reverse(),c=>c.layout.ownerRadix=2.5,c=>c.owners.push(clone(c.owners[0])),
  c=>c.choices[0].owners.push(clone(c.choices[0].owners[0])),c=>c.choices[0].owners[0].slotId='unknown-owner',
  c=>c.choices.push(clone(c.choices[0]))]){
  const c=clone(context);mutate(c);assert.throws(()=>represent(c));checks++;
 }
 for(let radix=1;radix<=4;radix++)for(let length=1;length<=3;length++){
  const c=syntheticContext(radix,length),t=represent(c),size=radix**length,maximumValue=size-1,oldOptima=[],newOptima=[];
  for(let encoded=0;encoded<size;encoded++){
   vectors++;let value=encoded;const ownerVector=Array(length);for(let i=length-1;i>=0;i--){ownerVector[i]=value%radix;value=Math.floor(value/radix);}
   const witness=new Map([...c.model.binary,...c.model.general].map(v=>[v,0]));ownerVector.forEach((j,i)=>witness.set(`phase_x_${i}_${j}`,1));
   const reconstructed=c.model.terms.reduce((n,[coefficient,v])=>n+BigInt(coefficient)*BigInt(witness.get(v)),0n);assert.equal(reconstructed,BigInt(encoded));
   const w=new Map(witness);w.set(t.representation.variable,encoded);
   if(ownerVector[0]!==Math.floor((radix-1)/2)){assert.throws(()=>assertIntegerWitness(t.model,w));continue;}
   feasibleVectors++;assert.equal(assertIntegerWitness(c.model,witness),BigInt(encoded));assert.equal(assertIntegerWitness(t.model,w),BigInt(encoded));
   let compatible=0;for(let z=0;z<=maximumValue;z++)if(BigInt(z)===reconstructed)compatible++;
   assert.equal(compatible,1);oldOptima.push(encoded);newOptima.push(Number(assertIntegerWitness(t.model,w)));
  }
  assert.deepEqual(oldOptima,newOptima);assert.equal(Math.min(...oldOptima),Math.min(...newOptima));checks++;
 }
 const result={status:'PASS_IDENTITY_REPRESENTATION_CONTRACT_ONLY',checks,vectors,feasibleVectors,bijection:true,priorFixedConditionsPreserved:true,
  sameOwnerVectorOrdering:true,solver:false,productSourceChanged:true,wholeWeekProof:false};console.log(JSON.stringify(result));return result;
}
// Typed phase-validator fixture only, NOT terminal/canonical acceptance.
// Assignment comes from the retained failed integer witness; UNKNOWN stays.
export function createSyntheticIdentityValidationProof(){
 const {context,fixture}=loadContext(),base=clone(context.model),values=new Map(fixture.attempt.integerWitness);
 const fixed=base.rows.filter(r=>r.name.startsWith('phase_fixed_')),rows=base.rows.filter(r=>!r.name.startsWith('phase_fixed_'));
 assert.deepEqual(fixed.map(r=>r.name),['phase_fixed_1','phase_fixed_2']);
 const spread={...clone(base),name:'raw_spread',terms:clone(fixed[0].terms),rows:clone(rows)},
  normalization=createRecurringPreferencePrimitiveObjective(fixed[1].terms,base.binary),
  preference={...clone(base),name:'inherited_preference',terms:normalization.primitiveTerms,
   rows:[...clone(rows),clone(fixed[0])],objectiveNormalization:normalization};
 const tiers=[{name:spread.name,model:spread,objectiveValue:fixed[0].value},
  {name:preference.name,model:preference,objectiveValue:fixed[1].value/normalization.positiveDivisor,
   objectiveNormalization:normalization,originalScaleObjectiveValue:fixed[1].value}];
 const selectedOwnership=context.choices.map((c,i)=>{const j=context.owners.findIndex((o,j)=>values.get(`phase_x_${i}_${j}`)===1);
  assert.ok(j>=0);return {workId:c.workId,slotId:context.owners[j].slotId};}),
  stableIdentity=selectedOwnership.map(s=>context.owners.findIndex(o=>o.slotId===s.slotId)),
  encoding=assertRecurringIdentityRadixEncoding({layout:context.layout,ownerIndexes:stableIdentity,expectedOrderedWorkIds:context.choices.map(c=>c.workId)}),
  bindings=clone(fixed);
 for(const [i,chunk]of context.layout.chunks.entries()){
  const model={...clone(base),name:`inherited_identity_${chunk.offset}`,terms:termsFor(context.layout,context.choices,context.owners,chunk.offset),rows:[...clone(rows),...clone(bindings)]},
   t=represent({...context,model,offset:chunk.offset}),w=new Map(values);w.set(t.representation.variable,encoding.chunkObjectives[i]);
  tiers.push({name:model.name,model:t.model,modelDigest:digest(t.model),lpDigest:sha(t.lp),objectiveValue:encoding.chunkObjectives[i],
   identityObjectiveRepresentation:t.representation,integerWitness:[...w]});
  bindings.push({name:`phase_fixed_${i+3}`,terms:clone(model.terms),relation:'=',value:encoding.chunkObjectives[i]});
 }
 const proof={descriptor:fixture.descriptor,tiers,selectedOwnership,stableIdentity,identityLayout:context.layout,identityEncoding:encoding};
 return {proof,ownerConfig:fixture.ownerConfig};
}
export function runStaticWeeklyIdentityPhaseValidationTests(){
 let checks=0;const input=createSyntheticIdentityValidationProof(),verified=assertRecurringPhaseIdentityEncoding(input);
 assert.equal(verified.representations.length,input.proof.identityLayout.chunks.length);checks++;
 for(const mutate of [p=>p.tiers[2].model.general.pop(),p=>p.tiers[2].model.bounds.pop(),p=>p.tiers[2].identityObjectiveRepresentation.originalTerms.pop(),
  p=>p.tiers[3].model.rows.find(r=>r.name==='phase_fixed_3').value++,p=>p.tiers[2].model.rows.reverse(),
  p=>p.tiers[2].integerWitness.push(clone(p.tiers[2].integerWitness[0])),p=>p.tiers[2].integerWitness.find(t=>t[0]==='phase_identity_objective_0')[1]=9.5,
  p=>p.tiers[2].lpDigest='0'.repeat(64)]){
  const wrong=clone(input);mutate(wrong.proof);
  for(const t of wrong.proof.tiers){t.modelDigest=digest(t.model);if(t.identityObjectiveRepresentation){const r=t.identityObjectiveRepresentation;
   r.transformedModelDigest=t.modelDigest;const {representationDigest,...body}=r;r.representationDigest=digest(body);}}
  assert.throws(()=>assertRecurringPhaseIdentityEncoding(wrong));checks++;
 }
 console.log(JSON.stringify({status:'PASS_TYPED_PHASE_VALIDATOR_ONLY',checks,solver:false,originalUnknownPreserved:true}));return checks;
}
export async function runStaticWeeklyRetainedIdentitySolve(){const {context,fixture}=loadContext(),transformed=represent(context);
 assertRepresentation(transformed,context);const strict=strictChecker(),
  {initializeStaticWeeklySolverEngine}=await import('../src/static-weekly-schedule-solver-worker.js'),
  engine=await initializeStaticWeeklySolverEngine({maxOldGenerationSizeMb:128,maxSemiSpaceSizeMb:8,maxWasmMemoryPages:1536}),
  attestation={schema:'custodial.recurring-phase-lower-bound-model.v1',modelDigest:digest(transformed.model),descriptorDigest:context.model.descriptorDigest},
  started=performance.now(),solved=engine.solve(transformed.lp,{timeLimitSeconds:fixture.attempt.solverOptions.time_limit,modelAttestation:attestation});
 let status='UNKNOWN',reason=null,objective=null,integerWitness=null;
 try{const variables=[...transformed.model.binary,...transformed.model.general],values=new Map(variables.map(v=>{
  const value=solved.result.Columns[v]?.Primal;assert.ok(Number.isFinite(value)&&Math.abs(value-Math.round(value))<=1e-9,'inherited integer scalar guard');return[v,Math.round(value)];}));
  assertRecurringIdentityUnitWitness({...context,received:transformed,integerWitness:[...values],objectiveValue:values.get(transformed.representation.variable)});const actual=assertIntegerWitness(transformed.model,values),original=context.model.terms.reduce((n,[c,v])=>n+BigInt(c)*BigInt(values.get(v)),0n);
  assert.equal(actual,original,'original objective reconstruction');assert.ok(actual>=0n&&actual<=BigInt(Number.MAX_SAFE_INTEGER));objective=Number(actual);integerWitness=[...values];
  strict.assertTerminal(solved,objective,attestation);status='STRICT_EXACT_RETAINED_TIER_PROVEN_ONLY';
 }catch(error){reason=error.message;}
 const receipt={schema:'custodial.retained-identity-auxiliary-experiment.v1',status,reason,transformed,
  originalModelDigest:fixture.attempt.modelDigest,originalLpDigest:fixture.attempt.lpDigest,originalStatus:fixture.originalStatus,
  originalRawReceiptDigest:fixture.attempt.rawReceiptDigest,originalTerminalStillUnknown:true,
  objective,integerWitness,solved,strictChecker:strict.exactCheckerSourceSha256,phaseSourceSha256:strict.productionPhaseSha256,
  elapsedMs:Math.round(performance.now()-started),sourceFixtureSha256:pinned.fixture,oneRetainedTierOnly:true,
  productSourceChanged:true,wholeWeekProof:false,canonicalWitnessClaim:false,policyOrLimitsChanged:false};
 if(process.env.CUSTODIAL_IDENTITY_EXPERIMENT_RECEIPT_PATH)fs.writeFileSync(process.env.CUSTODIAL_IDENTITY_EXPERIMENT_RECEIPT_PATH,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status,reason,originalModelDigest:fixture.attempt.modelDigest,modelDigest:attestation.modelDigest,
  lpDigest:sha(transformed.lp),representationDigest:transformed.representation.representationDigest,objective,
  objectObjective:solved.result.ObjectiveValue,terminal:solved.evidence.terminalReport.records.filter(r=>/bound|objective|Gap/.test(r.text)),
  rawReceiptDigest:solved.evidence.rawReceiptDigest,elapsedMs:receipt.elapsedMs,wholeWeekProof:false}));return receipt;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--solve')){const r=await runStaticWeeklyRetainedIdentitySolve();assert.equal(r.status,'STRICT_EXACT_RETAINED_TIER_PROVEN_ONLY',r.reason);}
 else {runStaticWeeklyIdentityAuxiliaryTests();runStaticWeeklyIdentityPhaseValidationTests();}
}
