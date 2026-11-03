import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {contentDigest} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {getScheduleComponentWeightLedger,assertScheduleComponentWeightLedger,
 validateScheduleComponentWeightSource,validateScheduleComponentWeightPacket,
 createScheduleComponentWeightPhaseLoads,COMPONENT_WEIGHT_LEDGER_DIGEST,
 COMPONENT_WEIGHT_UNIT,INHERITED_WORKLOAD_UNIT} from '../src/schedule-component-weight-authority.js';

let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixtureBytes=fs.readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url));
assert.equal(sha(fixtureBytes),'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');
const fixture=JSON.parse(fixtureBytes);
const source=fixture.compilerInput;
const configBytes=fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url));
assert.equal(sha(configBytes),'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30');
const ownerConfig=JSON.parse(configBytes),ledger=getScheduleComponentWeightLedger();
const originalSource=JSON.stringify(source),originalConfig=JSON.stringify(ownerConfig);
const receipt=validateScheduleComponentWeightSource({source,ownerConfig});
const call=s=>validateScheduleComponentWeightSource({source:s,ownerConfig});
const denied=(name,fn)=>check(name,()=>assert.throws(fn,e=>e.code==='invalid_component_weight_authority'));
const mutate=fn=>{const s=structuredClone(source);fn(s);return s;};
const row=(s,code)=>s.version.assignments.find(r=>r.locationCodeSnapshot===code);
check('exact unchanged current source bound',()=>assert.equal(receipt.sourceDigest,fixture.sourceDigest));
check('trusted ledger bound independently from supplied config',()=>assert.equal(contentDigest(ledger),COMPONENT_WEIGHT_LEDGER_DIGEST));
check('ten families and 140 complete phase bindings',()=>assert.deepEqual([receipt.knownFamilies,receipt.validatedSourceRows],[10,140]));
check('separate units and no physical duration assertion',()=>assert.deepEqual([receipt.componentWeightUnit,receipt.inheritedEffortUnit,receipt.physicalDurationUnit],[COMPONENT_WEIGHT_UNIT,INHERITED_WORKLOAD_UNIT,'NOT_ESTABLISHED']));
check('not admission/publication or budget recomputation',()=>assert.deepEqual([receipt.admitted,receipt.published,receipt.sourceMutated,receipt.effortBudgetsRecomputed,receipt.physicalMinuteFeasibilityProven],[false,false,false,false,false]));
check('receipt covers its complete body',()=>{const {receiptDigest,...body}=receipt;assert.equal(contentDigest(body),receiptDigest);});
for(const family of ledger.families){
 check(`${family.requirementId}: exact component aggregate and identities`,()=>{
  const b=receipt.bindings.filter(r=>r.locationCode===family.code);assert.equal(b.length,14);
  assert.ok(b.every(r=>r.aggregateWeight===ownerConfig.weights[family.code]
   &&r.componentWeights.reduce((a,b)=>a+b,0)===family.aggregateWeight
   &&r.componentIds.join(',')===family.components.map(c=>c.locationId).join(',')));
 });
 denied(`${family.requirementId}: altered aggregate rejected`,()=>{const c=structuredClone(ownerConfig);c.weights[family.code]+=0.5;validateScheduleComponentWeightSource({source,ownerConfig:c});});
 denied(`${family.requirementId}: caller-forged component weight rejected`,()=>{const l=getScheduleComponentWeightLedger();l.families.find(x=>x.code===family.code).components[0].weight+=0.5;validateScheduleComponentWeightSource({source,ownerConfig,ledger:l});});
 for(const component of family.components){
  if(family.serviceMode==='response_only_no_clean')continue;
  denied(`${family.code}: wrong identity ${component.locationId}`,()=>call(mutate(s=>{
   row(s,family.code).includedLocations.find(m=>m.locationId===component.locationId).locationId='ffffffff-ffff-4fff-8fff-ffffffffffff';
  })));
 }
}
denied('duplicate+missing member substitution with same list length',()=>call(mutate(s=>{const r=row(s,'TETON');r.includedLocations[1]=structuredClone(r.includedLocations[0]);})));
denied('missing member',()=>call(mutate(s=>row(s,'CHINA').includedLocations.pop())));
denied('extra member',()=>call(mutate(s=>row(s,'CHINA').includedLocations.push(structuredClone(row(s,'EXPO').includedLocations[0])))));
denied('wrong primary identity',()=>call(mutate(s=>row(s,'TETON').locationId=row(s,'EXPO').locationId)));
denied('known UUID cannot escape via unknown family code',()=>call(mutate(s=>row(s,'TETON').locationCodeSnapshot='CALLER_NEW_FAMILY')));
denied('duplicate family phase with different work ID',()=>call(mutate(s=>{const r=structuredClone(row(s,'CHINA'));r.workId='caller-other-work';s.version.assignments.push(r);})));
denied('missing family phase',()=>call(mutate(s=>s.version.assignments.splice(s.version.assignments.findIndex(r=>r.locationCodeSnapshot==='CHINA'),1))));
denied('duplicate work ID',()=>call(mutate(s=>row(s,'EXPO').workId=row(s,'CHINA').workId)));
denied('ambiguous version namespaces',()=>call(mutate(s=>s.versions=[structuredClone(s.version)])));
denied('caller unit at source level',()=>call(mutate(s=>s.unit='elapsed_minutes')));
denied('caller unit at row level',()=>call(mutate(s=>row(s,'CHINA').serviceEffortUnit=COMPONENT_WEIGHT_UNIT)));
denied('caller half-weight/unit at member level',()=>call(mutate(s=>row(s,'CHINA').includedLocations[1].componentWeightUnit='minutes')));
denied('flexible points cannot become fixed timed service',()=>call(mutate(s=>row(s,'CHINA').schedulingMode='fixed_service')));
denied('component weight cannot replace integer inherited budget',()=>call(mutate(s=>row(s,'CHINA').serviceEffortMinutes=0.5)));
denied('missing inherited provenance',()=>call(mutate(s=>row(s,'CHINA').serviceEffortProvenance='')));
denied('unknown ledger revision',()=>{const l=getScheduleComponentWeightLedger();l.revision=2;assertScheduleComponentWeightLedger(l);});
denied('ledger unit substitution',()=>{const l=getScheduleComponentWeightLedger();l.inheritedEffortUnit=COMPONENT_WEIGHT_UNIT;assertScheduleComponentWeightLedger(l);});
denied('ledger duplicate member',()=>{const l=getScheduleComponentWeightLedger();l.families[0].components[1]=structuredClone(l.families[0].components[0]);assertScheduleComponentWeightLedger(l);});
denied('explicit China half-weight altered while aggregate stays2',()=>{
 const l=getScheduleComponentWeightLedger(),f=l.families.find(x=>x.code==='CHINA');
 f.components[0].weight=0.5;f.components[1].weight=1;
 assert.equal(f.components.reduce((sum,c)=>sum+c.weight,0),2);
 assertScheduleComponentWeightLedger(l);
});
denied('forged ledger and config cannot jointly replace trusted half-weights',()=>{
 const l=getScheduleComponentWeightLedger(),c=structuredClone(ownerConfig),f=l.families.find(x=>x.code==='BREEZEWAY_RESTROOMS');
 f.components[0].weight=1;f.aggregateWeight=1.5;c.weights.BREEZEWAY_RESTROOMS=1.5;
 validateScheduleComponentWeightSource({source,ownerConfig:c,ledger:l});
});
denied('unknown validation options cannot supply units',()=>validateScheduleComponentWeightSource({source,ownerConfig,unit:'minutes'}));
for(const code of ['CAT_COUNTRY','PRIMATE_CANYON']){
 check(`${code}: exact0.5 response-only binding without physical members`,()=>{
  const b=receipt.bindings.filter(r=>r.locationCode===code);assert.ok(b.every(r=>r.aggregateWeight===0.5&&r.serviceMode==='response_only_no_clean'));
  assert.ok(source.version.assignments.filter(r=>r.locationCodeSnapshot===code).every(r=>r.includedLocations.length===0));
 });
 denied(`${code}: fabricated physical member`,()=>call(mutate(s=>row(s,code).includedLocations.push({locationId:row(s,code).locationId,locationNameSnapshot:code}))));
 denied(`${code}: scan capability substitution`,()=>call(mutate(s=>row(s,code).serviceMode='scan_tracked')));
}
check('display-only rename does not replace stable identity',()=>{
 const s=mutate(s=>{row(s,'CHINA').locationNameSnapshot='Selected renamed display';row(s,'CHINA').includedLocations[0].locationNameSnapshot='Selected renamed display';});
 assert.notEqual(call(s).sourceDigest,receipt.sourceDigest);
});
check('member order does not duplicate or flatten the package',()=>call(mutate(s=>row(s,'CHINA').includedLocations.reverse())));
check('getter mutation cannot alter trusted module authority',()=>{const l=getScheduleComponentWeightLedger();l.families[0].components[0].weight=999;assert.equal(getScheduleComponentWeightLedger().families[0].components[0].weight,2);});
// Mechanical existing effort-envelope values from the exact source, not a
// solver-success substitute. No compiler or source admission is invoked.
const packet={compilerInput:source,sourceDigest:fixture.sourceDigest,serviceEffort:source.version.assignments.map(r=>({workId:r.workId,dayOfWeek:r.dayOfWeek,workloadPoints:r.serviceEffortMinutes,unit:INHERITED_WORKLOAD_UNIT,provenance:r.serviceEffortProvenance}))};
const packetReceipt=validateScheduleComponentWeightPacket({packet,ownerConfig});
check('actual packet consumer checks all323 existing budgets',()=>assert.equal(packetReceipt.packetEffortRowsChecked,323));
check('packet receipt hash binds complete packet/body',()=>{const {receiptDigest,...body}=packetReceipt;assert.equal(contentDigest(body),receiptDigest);});
for(const [name,edit] of [
 ['unit substitution',p=>p.serviceEffort[0].unit='elapsed_minutes'],
 ['component-unit substitution',p=>p.serviceEffort[0].unit=COMPONENT_WEIGHT_UNIT],
 ['altered budget',p=>p.serviceEffort[0].workloadPoints+=1],
 ['duplicate+missing substitution',p=>p.serviceEffort[1]=structuredClone(p.serviceEffort[0])],
 ['missing effort row',p=>p.serviceEffort.pop()],
 ['wrong source digest',p=>p.sourceDigest='0'.repeat(64)],
 ['altered provenance',p=>p.serviceEffort[0].provenance='caller'],
 ])denied(`packet: ${name}`,()=>{const p=structuredClone(packet);edit(p);validateScheduleComponentWeightPacket({packet:p,ownerConfig});});
const phaseLoads=createScheduleComponentWeightPhaseLoads({source,ownerConfig});
check('phase report computes component sums, not inherited budgets',()=>{
 for(const l of phaseLoads.loads){const selected=receipt.bindings.filter(r=>r.dayOfWeek===l.dayOfWeek&&r.phase===l.phase&&r.ownerSlotId===l.ownerSlotId);
  assert.equal(l.weight,selected.reduce((sum,r)=>sum+r.componentWeights.reduce((a,b)=>a+b,0),0));assert.equal(l.unit,COMPONENT_WEIGHT_UNIT);}
});
check('source/config/all historical IDs and budget bytes unchanged',()=>{assert.equal(JSON.stringify(source),originalSource);assert.equal(JSON.stringify(ownerConfig),originalConfig);assert.equal(postgresJsonbContentDigest(source),fixture.sourceDigest);});
const generator=fs.readFileSync(new URL('./generate-owner-corrected-static-weekly-schedule.mjs',import.meta.url),'utf8');
check('generator exact-handout validation precedes compile',()=>{assert.ok(generator.includes('const componentWeightInputReceipt = exactSixPersonHandout'));assert.ok(generator.indexOf('validateScheduleComponentWeightSource({source:input,ownerConfig:config})')<generator.indexOf('await compileStaticWeeklySchedule(compileInput)'));});
check('canonical packet validation precedes registration',()=>assert.ok(generator.indexOf('validateScheduleComponentWeightPacket({packet,ownerConfig:config})')<generator.indexOf('await prepareStaticWeeklyRegistrationArtifact(packet)')));
check('new receipt is separate sidecar with exact file hashes',()=>{assert.ok(generator.includes('`${OUTPUT}.component-weights.json`'));assert.ok(generator.includes('ownerConfigFileSha256:fileHash(CONFIG_PATH),packetFileSha256:fileHash(OUTPUT)'));});
let retainedPacketReceipt=null;
if(process.env.STATIC_WEEKLY_COMPONENT_RETAINED_PACKET){
 const b=fs.readFileSync(process.env.STATIC_WEEKLY_COMPONENT_RETAINED_PACKET);
 assert.equal(sha(b),'c318fbe200e41eeffcf6b5a6bfc1f55014bed7d7e3d35ff2f6dd35859b3abcfd');
 const retained=JSON.parse(b);assert.deepEqual(retained.compilerInput,source);
 retainedPacketReceipt=validateScheduleComponentWeightPacket({packet:retained,ownerConfig});
 check('retained full packet actual existing wire values validated without rewrite',()=>assert.equal(retainedPacketReceipt.packetEffortRowsChecked,323));
}
const summary={status:'PASS',checks,scope:'Exact source ledger/pure consumer validation plus static generator hook checks; no generator/solver/admission/publication/physical test',fixtureSha256:sha(fixtureBytes),ownerConfigFileSha256:sha(configBytes),ledgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,sourceReceipt:receipt,packetReceipt,retainedPacketReceipt,phaseLoads,solverRuns:0,databaseRuns:0,production:false};
if(process.env.STATIC_WEEKLY_COMPONENT_PROOF_OUTPUT){const out=process.env.STATIC_WEEKLY_COMPONENT_PROOF_OUTPUT;assert.equal(fs.existsSync(out),false,'fresh evidence only');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/receipt.json`,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:summary.status,checks,sourceDigest:receipt.sourceDigest,ledgerDigest:COMPONENT_WEIGHT_LEDGER_DIGEST,rows:receipt.validatedSourceRows,packetEffortRows:packetReceipt.packetEffortRowsChecked,solverRuns:0,databaseRuns:0,production:false}));
