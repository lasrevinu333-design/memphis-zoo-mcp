import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {canonicalJson, contentDigest} from '../src/static-weekly-schedule-model.js';
import {generateStaticWeeklySchedulingProgram, canonicalProgramMatches,
 STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE} from '../src/static-weekly-schedule-program.js';

// TEST-ONLY scoped evidence. Never imported by product/admission code.
// Exactly two pure null-witness program generations; no compiler, verifier,
// worker, solver, SQL, network, publication or claimed physical-time proof.
const fixtureUrl=new URL('./fixtures/static-weekly-policy-scope-receipts.json',import.meta.url);
const fixtureSchema='custodial.static-weekly-policy-scope-receipts.v1';
const classification='ALREADY_EXECUTED_LOCAL_SYNTHETIC_RESULT_NOT_PRODUCTION_NOT_NEW_SOLVE';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const EXPECTED_FIXTURE_SHA256='197d8eb0078f2bc9acb3cfb667c64874c8e41944f600bbaa026675d4594e9dfc';
const sourcePins={
 'src/static-weekly-schedule-program.js':'885825644a37ae8e601e1639d987d0016d61d9a1beff49e6e0340342391f1186',
 'src/static-weekly-schedule-model.js':'3dc26cf30b1c707f120c5385c6b80acd327f222689cdcae36cd23ac0cf251fec',
 'src/static-weekly-schedule-compiler.js':'8724f6dd8768e8f126076fa91c72e473e0555e626d50ecb9d66c5cba4bf2bc21',
 'src/static-weekly-schedule-verifier.js':'4ffdc408d4cc6414c3ec9779d3b70ecc0ef61244dd17b6554d72ebef61074740',
 'config/custodial-six-person-static-20261005.json':'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30'
};
// The retained fixture above remains bound to its ORIGINAL executed source.
// d85e4b7 changed only PostgreSQL key encoding; 054f181 added the byte-identical
// incremental digest path. Keep historical pins immutable and bind current
// generation separately. The replay and model-basis digest replacements are
// also bound only as current source; the historical fixture is untouched.
// The called key-order/stream suites prove their
// representation contracts; below both complete retained descriptors/model
// bases must still equal freshly generated current programs, not just a hash.
const currentSourcePins=Object.freeze({...sourcePins,
 'src/static-weekly-schedule-verifier.js':'1700488fafa6e7683aed9ba11e1d6b0eb9800ed4a19d2713410a987417bfcabf',
 'src/static-weekly-schedule-program.js':'6feeea1894da194d26b315d4f923b88bcd39d901f0df812466446d6b3d4b76b9',
 'src/static-weekly-schedule-compiler.js':'593893e4daac566fa665bb987af17ce803414c92ebd59abf6e8a24aed2361f1a',
 'src/static-weekly-schedule-model.js':'23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e'
});
const retainedPins={
 baseline:{
  input:'87df062ab96741f774e12d6f2736a51f2424d13053cfbeef3e9966f90e1366f3',
  result:'5abc86825db3730b310405a8e184461dfe242e72366151b11c8c00b39c53403b',
  verifier:'ce0c1e51e8d08b9c79e35a8d1d158e869609b3b662a6ba2d5e841b5925280bc4'
 },
 one:{
  input:'acb39eb18f481da7f077460dab009a078030a4a7d2abdaf29a049b9a41550f5e',
  result:'21c07f29b58e9fda0b8e9cd337bf9d9ffa9840f279923931b5db17c2373dd7a1',
  verifier:'762cdf2d5de6ec9b2a7f049805e87f3401fd2face1fa2be092232683a0dab6ed'
 }
};
const expectedRanking=[
 'required coverage','explicit best-effort coverage','daily workload utilization ranks worst-first',
 'daily stable-ID tie','weekly workload utilization ranks worst-first','weekly stable-ID tie',
 'directed travel proximity','baseline disruption','stable-ID identity over mutable choices'
];
const expectedUnits={
 serviceEffortWireSemantics:'fixed work uses provenanced minutes; flexible_coverage_ownership uses dimensionless production workload points',
 weeklyEquityResource:'total provenanced workload / total verified productive minutes across every working day of the slot',
 flexibleCoverageTravelRole:'advisory_proximity_objective_not_clock_duty'
};
const scopes={baseline:'ACCEPTED_STATIC_PRESERVATION_NOT_NORMAL_DESIGN_OPTIMUM',one:'DATED_ABSENCE_RECOVERY_NOT_NORMAL_DESIGN_OPTIMUM'};
const absentSlot='f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f';
function deriveFixtureScope(input){
 assert.equal(input.serviceDate,'2026-10-05');
 assert.ok(Array.isArray(input.exceptions));
 if(input.exceptions.length===0)return scopes.baseline;
 assert.equal(input.exceptions.length,1,'only the actual retained one-absence fixture is in scope');
 const e=input.exceptions[0];
 assert.equal(e.id,'six-absence-KAREN');assert.equal(e.type,'daily_absence');
 assert.equal(e.serviceDate,'2026-10-05');assert.deepEqual(e.payload,{slotId:absentSlot});
 return scopes.one;
}
function selectionBody(c){
 return {input:c.input,canonicalProgram:c.canonicalProgram,certificate:c.certificate,
  verifier:c.verifier,objective:c.objective,scope:c.scope,status:c.status,publicationAuthority:c.publicationAuthority};
}

// Mechanical lossless fixture extraction is an explicit CLI-only producer.
// Original whole-file pins must match; no result is fabricated or solved.
// This writes a generated data artifact, not product/source policy.
function extractFixture(directory){
 assert.ok(directory,'retained evidence directory required');
 assert.equal(fs.existsSync(fixtureUrl),false,'never overwrite retained fixture evidence');
 const cases={};
 for(const name of ['baseline','one']){
  const bytes={};
  for(const kind of ['input','result','verifier']){
   bytes[kind]=fs.readFileSync(path.join(directory,name+(kind==='verifier'?'-independent-verifier':'-'+kind)+'.json'));
   assert.equal(sha(bytes[kind]),retainedPins[name][kind],name+' exact original '+kind);
  }
  const input=JSON.parse(bytes.input),result=JSON.parse(bytes.result),verifier=JSON.parse(bytes.verifier);
  assert.equal(result.verifier.ok,true);assert.equal(verifier.ok,true);
  assert.equal(verifier.evidence.independentlyProvesOptimality,false);
  const cert=result.certificate;
  const c={input,canonicalProgram:cert.canonicalProgram,certificate:{
   schema:cert.schema,compilerVersion:cert.compilerVersion,verifierVersion:cert.verifierVersion,
   objectivePolicyVersion:cert.objectivePolicyVersion,canonicalInputDigest:cert.canonicalInputDigest,
   baselineInputDigest:cert.baselineInputDigest,weeklyVersionDigest:cert.weeklyVersionDigest,
   modelBasisDigest:cert.modelBasisDigest,tierReceiptDigest:cert.tierReceiptDigest,
   tierOptionsDigest:cert.tierOptionsDigest,assignmentDigest:cert.assignmentDigest},
   verifier:{ok:verifier.ok,digest:verifier.digest,verifierVersion:verifier.verifierVersion,evidence:verifier.evidence},
   objective:{rankingOrder:result.objective.rankingOrder,...Object.fromEntries(Object.keys(expectedUnits).map(k=>[k,result.objective[k]]))},
   scope:deriveFixtureScope(input),status:result.status,publicationAuthority:result.publicationAuthority};
  c.provenance={classification,originalSha256:retainedPins[name],selectedInputDigest:contentDigest(input),
   selectionDigest:contentDigest(selectionBody(c)),originalDirectoryBasename:path.basename(directory),
   extraction:'Lossless original input and complete canonicalProgram; exact selected certificate, verifier and objective fields. No original assignments/witness/tier attestations copied or recreated.'};
  cases[name]=c;
 }
 const packet={schema:fixtureSchema,sourcePins,cases,
  limitations:{independentlyProvesOptimality:false,newSolve:false,publication:false,
   unclosed:['SCH-012 normal-design optimum','SCH-013 nearest-feasible start ladder','SCH-014 phase balance','SCH-016 half-unit feasibility','SCH-022 exact-ID seasonal admission']}};
 fs.writeFileSync(fixtureUrl,JSON.stringify(packet)+'\n',{flag:'wx'});
 console.log(JSON.stringify({fixtureSha256:sha(fs.readFileSync(fixtureUrl)),bytes:fs.statSync(fixtureUrl).size,producer:'mechanical extraction only; no program generation'}));
}
function assertBinding(candidate,program,trusted){
 assert.equal(candidate.scope,deriveFixtureScope(candidate.input));
 assert.equal(candidate.scope,trusted.scope,'scope cannot be supplied as a redesign certificate');
 assert.equal(contentDigest(candidate.input),trusted.provenance.selectedInputDigest,'exact raw source binding, including fields normalized away by program');
 assert.equal(candidate.provenance.selectionDigest,contentDigest(selectionBody(candidate)));
 assert.deepEqual(candidate.provenance.originalSha256,trusted.provenance.originalSha256);
 assert.equal(candidate.verifier.evidence.independentlyProvesOptimality,false);
 assert.deepEqual(candidate.objective.rankingOrder,expectedRanking);
 assert.deepEqual(Object.fromEntries(Object.keys(expectedUnits).map(k=>[k,candidate.objective[k]])),expectedUnits);
 assert.equal(candidate.certificate.canonicalInputDigest,program.problem.inputDigest);
 assert.equal(candidate.certificate.modelBasisDigest,program.modelBasisDigest);
 assert.equal(candidate.canonicalProgram.modelBasisDigest,program.modelBasisDigest);
 assert.equal(canonicalProgramMatches(candidate.canonicalProgram,program.descriptor),true,'full source-regenerated descriptor must match');
 assert.equal(candidate.certificate.tierReceiptDigest,trusted.certificate.tierReceiptDigest);
 assert.equal(candidate.certificate.tierOptionsDigest,trusted.certificate.tierOptionsDigest);
 assert.equal(candidate.certificate.assignmentDigest,trusted.certificate.assignmentDigest);
 assert.deepEqual(candidate.certificate,trusted.certificate);
 assert.deepEqual(candidate.verifier,trusted.verifier);
}
function tierRuns(tiers){
 return tiers.reduce((rows,t,index)=>{
  const key=t.family||t.name;let row=rows.at(-1);
  if(!row||row.key!==key)rows.push(row={key,first:index,last:index,count:0});
  row.last=index;row.count++;return rows;
 },[]);
}
function selfRehash(c){
 // Make carried ordering/index/hash metadata internally consistent. The
 // negative must fail source binding, not merely a stale index/self-hash.
 c.canonicalProgram.tiers.forEach((tier,index)=>{tier.index=index;});
 c.canonicalProgram.tierDigest=contentDigest(c.canonicalProgram.tiers);
 c.provenance.selectedInputDigest=contentDigest(c.input);
 c.provenance.selectionDigest=contentDigest(selectionBody(c));
 return c;
}

// Explicit export: root mandatory CI must CALL this, not merely import it.
// No case filtering, caller fixture/source injection, or optional-report path.
export function runStaticWeeklyPolicyScopeContractTests(){
 const started=performance.now();let checks=0,generations=0;
 const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 const bytes=fs.readFileSync(fixtureUrl),packet=JSON.parse(bytes);
 check('exact committed fixture and extraction schema',()=>{assert.equal(sha(bytes),EXPECTED_FIXTURE_SHA256);assert.equal(packet.schema,fixtureSchema);});
 check('exact two cases, immutable historical pins and explicit current source pins',()=>{
  assert.deepEqual(Object.keys(packet.cases),['baseline','one']);assert.deepEqual(packet.sourcePins,sourcePins);
  assert.deepEqual(Object.keys(currentSourcePins),Object.keys(sourcePins));
  for(const [file,digest]of Object.entries(currentSourcePins))assert.equal(sha(fs.readFileSync(new URL('../'+file,import.meta.url))),digest,file);
 });
 check('optimality and whole-clause limits stay explicit',()=>{
  assert.equal(packet.limitations.independentlyProvesOptimality,false);
  assert.equal(packet.limitations.newSolve,false);assert.equal(packet.limitations.publication,false);
  assert.deepEqual(packet.limitations.unclosed,['SCH-012 normal-design optimum','SCH-013 nearest-feasible start ladder','SCH-014 phase balance','SCH-016 half-unit feasibility','SCH-022 exact-ID seasonal admission']);
 });
 const config=JSON.parse(fs.readFileSync(new URL('../config/custodial-six-person-static-20261005.json',import.meta.url)));
 const people=new Set(Object.values(config.slots).filter(s=>s.personId).map(s=>s.personId));
 check('current six employees, not contractor employee headcount',()=>assert.equal(people.size,6));
 const programs={};
 for(const name of ['baseline','one']){
  const c=packet.cases[name],before=canonicalJson(c);
  check(name+': exact retained receipt provenance',()=>{
   assert.equal(c.provenance.classification,classification);assert.deepEqual(c.provenance.originalSha256,retainedPins[name]);
   assert.equal(contentDigest(c.input),c.provenance.selectedInputDigest);
   assert.equal(c.certificate.schema,'memphis-zoo.static-weekly-solver-certificate.v5');
   assert.equal(c.certificate.objectivePolicyVersion,'monotonic-leximax-v1');
   assert.equal(c.status,'FEASIBLE');assert.equal(c.publicationAuthority,'ACCEPTABLE');
  });
  // The ONLY generator invocation in this test; null means no witness tiers.
  const program=generateStaticWeeklySchedulingProgram(c.input,null);generations++;programs[name]=program;
  check(name+': complete pure source program exists',()=>assert.equal(program.error,undefined));
  check(name+': complete descriptor and model basis bind retained certificate',()=>assertBinding(c,program,c));
  check(name+': input and retained certificate bytes unchanged',()=>assert.equal(canonicalJson(c),before));
  check(name+': exact nine-stage order with both stable-rank ties',()=>{
   const counts=name==='baseline'?[16,30,1,6,1,1,1,55]:[16,29,1,6,1,1,1,99];
   const keys=['required_coverage','daily_leximax','daily_stable_tie','weekly_leximax','weekly_stable_tie','incremental_directed_route_cost','accepted_baseline_disruption','stable_identity'];
   assert.deepEqual(tierRuns(program.descriptor.tiers).map(r=>[r.key,r.count]),keys.map((k,i)=>[k,counts[i]]));
   assert.equal(program.descriptor.tiers.some(t=>t.family==='best_effort_coverage'),false,'no best-effort tiers invented in these retained cases');
  });
  check(name+': unchanged flexible responsibility stays original-owner locked',()=>{
   let baseline=0,adapted=0;
   for(const w of program.problem.work){
    if(w.schedulingMode!==STATIC_WEEKLY_FLEXIBLE_COVERAGE_MODE)continue;
    const isAbsent=name==='one'&&w.dayOfWeek===1&&w.originSlotId===absentSlot;
    assert.equal(w.custodialCoverageMode,isAbsent?'internal_even':'zoo_employee_baseline');
    const candidates=program.problem.candidates.filter(x=>x.item.key===w.key);
    if(isAbsent){adapted++;assert.ok(candidates.every(x=>x.slot.id!==absentSlot));}
    else {baseline++;assert.ok(candidates.every(x=>x.slot.id===w.originSlotId));}
   }
   assert.ok(baseline>0);assert.equal(adapted>0,name==='one');
  });
  check(name+': no manager-added or phantom contractor identity',()=>{
   assert.ok(!c.input.exceptions.some(e=>e.type==='cover_all'));
   assert.equal(program.problem.slots.filter(s=>s.contractorCapacity!==true).length,9);
   assert.ok(program.problem.slots.filter(s=>s.contractorCapacity===true).every(s=>s.kind==='CONTRACTOR_CAPACITY'&&s.incumbencies.length===0));
   assert.ok(program.problem.candidates.every(x=>!x.slot.contractorCapacity));
   assert.ok(program.problem.roster.filter(r=>r.personId).every(r=>people.has(r.personId)));
  });
  const hostile=[
   ['reordered coverage/daily',x=>[x.canonicalProgram.tiers[0],x.canonicalProgram.tiers[16]]=[x.canonicalProgram.tiers[16],x.canonicalProgram.tiers[0]]],
   ['removed daily stable tie',x=>x.canonicalProgram.tiers.splice(x.canonicalProgram.tiers.findIndex(t=>t.family==='daily_stable_tie'),1)],
   ['removed weekly stable tie',x=>x.canonicalProgram.tiers.splice(x.canonicalProgram.tiers.findIndex(t=>t.family==='weekly_stable_tie'),1)],
   ['changed coefficient',x=>x.canonicalProgram.tiers.find(t=>t.terms.length).terms[0][0]++],
   ['changed daily stable-tie coefficient',x=>x.canonicalProgram.tiers.find(t=>t.family==='daily_stable_tie').terms[0][0]++],
   ['changed weekly stable-tie coefficient',x=>x.canonicalProgram.tiers.find(t=>t.family==='weekly_stable_tie').terms[0][0]++],
   ['duplicate plus missing substitution',x=>x.canonicalProgram.tiers[1]=structuredClone(x.canonicalProgram.tiers[0])],
   ['equity/proximity priority swap',x=>{const i=x.canonicalProgram.tiers.findIndex(t=>t.name==='incremental_directed_route_cost');[x.canonicalProgram.tiers[16],x.canonicalProgram.tiers[i]]=[x.canonicalProgram.tiers[i],x.canonicalProgram.tiers[16]];}],
   ['extra descriptor field',x=>x.canonicalProgram.claimedDesignOptimal=true],
   ['wrong source identity',x=>x.input.versions[0].publicationId='00000000-0000-4000-8000-000000000001'],
   ['changed source work coefficient',x=>x.input.versions[0].assignments[0].serviceEffortMinutes++],
   ['caller redesign scope',x=>x.scope='NEW_RECURRING_DESIGN_OPTIMUM'],
   ['caller scope hidden in source',x=>x.input.claimedPolicyScope='NEW_RECURRING_DESIGN_OPTIMUM'],
   ['physical minute substitution',x=>x.objective.serviceEffortWireSemantics='elapsed minutes'],
   ['component-weight substitution',x=>x.objective.weeklyEquityResource='dimensionless_owner_component_weight'],
   ['independent optimality overclaim',x=>x.verifier.evidence.independentlyProvesOptimality=true],
   ['substituted external receipt',x=>x.provenance.originalSha256.result='0'.repeat(64)],
   ['changed actual assignment receipt',x=>x.certificate.assignmentDigest='0'.repeat(64)]
  ];
  for(const [label,mutate]of hostile)check(name+': rejects '+label+' even with carried self-hashes updated',()=>{
   const forged=structuredClone(c);mutate(forged);selfRehash(forged);
   assert.throws(()=>assertBinding(forged,program,c));
  });
 }
 check('only exact dated absence differs between inputs',()=>{
  const {exceptions:a,...base}=packet.cases.baseline.input,{exceptions:b,...one}=packet.cases.one.input;
  assert.deepEqual(base,one);assert.deepEqual(a,[]);assert.equal(b.length,1);
  assert.equal(deriveFixtureScope(packet.cases.baseline.input),scopes.baseline);
  assert.equal(deriveFixtureScope(packet.cases.one.input),scopes.one);
 });
 check('case/source exchange cannot bind an otherwise valid certificate',()=>{
  assert.throws(()=>assertBinding(packet.cases.one,programs.baseline,packet.cases.baseline));
  assert.throws(()=>assertBinding(packet.cases.baseline,programs.one,packet.cases.one));
 });
 check('exactly two pure null-witness program generations ran',()=>assert.equal(generations,2));
 const receipt={status:'PASS',checks,generations,elapsedMs:Math.round(performance.now()-started),
  fixtureSha256:sha(bytes),sourcePins,currentSourcePins,
  sourcePinScope:'sourcePins are immutable retained execution; currentSourcePins bind fresh generation; no new solver proof',
  caseTierCounts:Object.fromEntries(Object.entries(programs).map(([n,p])=>[n,p.descriptor.tiers.length])),
  independentlyProvesOptimality:false,solver:false,worker:false,sql:false,publication:false,
  scope:'Exact static-preservation versus dated-absence canonical policy/order/binding regression only; remaining SCH012 design/013/014/016/022 gaps retained'};
 console.log(JSON.stringify(receipt));return receipt;
}

const direct=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){
 if(process.argv[2]==='--extract-fixture'){
  assert.equal(process.argv.length,4);extractFixture(process.argv[3]);
 }else{
  assert.equal(process.argv.length,2,'no narrowing, skipping or alternate test fixture CLI');
  runStaticWeeklyPolicyScopeContractTests();
 }
}
