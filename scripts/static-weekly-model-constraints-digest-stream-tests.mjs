import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {readFileSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalJson,contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import * as current from '../src/static-weekly-schedule-program.js';
import {reconstructProgramBeforeOperationDeadline} from './static-weekly-operation-deadline-ci-wiring.mjs';
import {createCurrentMorningIntegrationRequest} from './static-weekly-recurring-morning-integration-tests.mjs';

// Owning representation proof only. No solver, worker, acceptance, SQL or
// publication. A deliberately zero-valued witness below tests regeneration
// identity, NOT feasibility/optimality of that witness.
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const predecessorSha='b29306b218a68d1907bf0db3795460be90ac65f55566d69117b51ca0ce80c44d';
const productSha='6feeea1894da194d26b315d4f923b88bcd39d901f0df812466446d6b3d4b76b9';
const modelSha='23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e';
const verifierSha='1700488fafa6e7683aed9ba11e1d6b0eb9800ed4a19d2713410a987417bfcabf';
const policyFixtureSha='197d8eb0078f2bc9acb3cfb667c64874c8e41944f600bbaa026675d4594e9dfc';
const sourceUrl=new URL('../src/static-weekly-schedule-program.js',import.meta.url);
const oldSite='sha256Hex(canonicalJson(constraints.map((constraint) => ({ name: constraint.name, terms: constraint.terms, relation: constraint.relation, value: constraint.value }))))';
const newSite='contentDigest(constraints.map((constraint) => ({ name: constraint.name, terms: constraint.terms, relation: constraint.relation, value: constraint.value })))';
const text=reconstructProgramBeforeOperationDeadline(readFileSync(sourceUrl,'utf8'));
function reverseSingleSite(value){
 assert.equal(sha(value),productSha,'Exact current source required before reversal');
 assert.equal(value.split(newSite).length,2,'Exactly one intended replacement');
 const previous=value.replace(newSite,oldSite);assert.equal(sha(previous),predecessorSha,'No other product change permitted');return previous;
}
async function predecessor(){
 const previous=reverseSingleSite(text);
 // Ephemeral TEST-ONLY predecessor module. A normal file URL avoids retaining
 // the whole source in a data-URL stack/module identity. Exact shared imports,
 // no product path replacement or alternate authority/admission endpoint.
 const resolved=previous.replace(/from "(\.\/[^"\n]+)"/g,(_,relative)=>`from "${new URL(relative,sourceUrl).href}"`);
 const dir=mkdtempSync(join(tmpdir(),'custodial-constraints-predecessor-')),file=join(dir,'program.mjs');
 try{writeFileSync(file,resolved,{flag:'wx'});return await import(pathToFileURL(file).href);}
 finally{unlinkSync(file);rmdirSync(dir);}
}
const capture=fn=>{try{return{value:fn()};}catch(error){return{error,name:error.name,message:error.message,code:error.code};}};
// Never build an assertion diff containing whole programs/models or hostile
// graphs. Equality remains complete; only failure presentation is bounded.
const equal=(left,right,label)=>assert.equal(isDeepStrictEqual(left,right),true,label);
const stage=name=>process.stderr.write(`MODEL_CONSTRAINTS_TEST_STAGE ${name}\n`);
function sourceInput(count=8){
 const {request}=createCurrentMorningIntegrationRequest({count,targetEffectiveDate:'2026-10-12'}),source=request.publishedSource.compiler_input;
 // The public program generator consumes the raw versions[] form, whereas
 // canonicalAuthorityInput returns a normalized singular version wrapper.
 // Preserve actual source facts/header; select the explicitly bound date.
 return {input:{...source,versions:[source.version],serviceDate:request.effectiveDate},request};
}
function install(mode,stats){
 if(mode==='portable')return;
 const native=x=>{stats.fallbacks++;return sha(x);};
 if(mode==='string-only'){installStaticWeeklySha256HexAccelerator(native);return;}
 installStaticWeeklySha256HexAccelerator(native,{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){
  stats.sinks++;const h=createHash('sha256');let finished=false;return{
   writeUtf8(chunk){assert.equal(finished,false);stats.writes++;stats.maxChunk=Math.max(stats.maxChunk,chunk.length);
    if(stats.measure)stats.observedHeap=Math.max(stats.observedHeap,process.memoryUsage().heapUsed);h.update(chunk,'utf8');},
   finishHex(){assert.equal(finished,false);finished=true;return h.digest('hex');},
  };
 }});
}
async function runCase(mode,{exoticOnly=false,primitiveOnly=false,depthOnly=false}={}){
 stage('import');let checks=0;const stats={sinks:0,writes:0,maxChunk:0,fallbacks:0};install(mode,stats);const legacy=await predecessor();checks++;
 assert.equal(sha(readFileSync(new URL('../src/static-weekly-schedule-model.js',import.meta.url))),modelSha);checks++;
 assert.equal(sha(readFileSync(new URL('../src/static-weekly-schedule-verifier.js',import.meta.url))),verifierSha);checks++;
 for(const altered of [text.replace('const modelBytes =','const modelBytesX ='),text.replace(newSite,newSite+'\n'+newSite),text.replace(newSite,oldSite)]){
  assert.throws(()=>reverseSingleSite(altered));checks++;
 }
 const compare=factory=>{
  const left=factory(),right=factory(),expected=capture(()=>sha(canonicalJson(left.value))),actual=capture(()=>contentDigest(right.value));
  for(const key of ['value','name','message','code'])assert.equal(actual[key],expected[key]);
  if(left.trace)equal(right.trace,left.trace,'Getter/proxy trace changed');
  if(left.sentinel){assert.equal(expected.error,left.sentinel);assert.equal(actual.error,right.sentinel);}checks++;
 };
 // Exercise the actual second-map field evaluation before hashing, including
 // getter mutation and abrupt completion. No sharing of the first rows map.
 const compareMapped=factory=>{
  const left=factory(),right=factory(),project=row=>({name:row.name,terms:row.terms,relation:row.relation,value:row.value});
  const expected=capture(()=>sha(canonicalJson(left.rows.map(project)))),actual=capture(()=>contentDigest(right.rows.map(project)));
  for(const key of ['value','name','message','code'])assert.equal(actual[key],expected[key]);
  equal(right.trace,left.trace,'Mapped field evaluation changed');
  if(left.sentinel){assert.equal(expected.error,left.sentinel);assert.equal(actual.error,right.sentinel);}checks++;
 };
 for(const throwAt of [null,'name','terms','relation','value'])compareMapped(()=>{
  const trace=[],sentinel=new Error('mapped field sentinel'),row={};
  for(const key of ['name','terms','relation','value'])Object.defineProperty(row,key,{enumerable:true,get(){trace.push(key);if(key===throwAt)throw sentinel;return key==='terms'?[[2,'x']]:key==='value'?0:key;}});
  return{rows:[row,row],trace,...(throwAt?{sentinel}:{})};
 });
 for(const value of [null,true,false,-0,1e-7,1e21,Number.MAX_VALUE,'📱\ud800\u0000',[],[1,,3],Object.create(null),
  {é:1,'e\u0301':2,'𐀀':3,'\ud800':4},undefined,NaN,Infinity,1n,Symbol('s'),()=>1,new Date(0)])compare(()=>({value}));
 if(primitiveOnly)return{status:'PASS',checks,mode,probe:'PRIMITIVE_ONLY_NO_MODEL_NO_DEEP_GRAPH',...stats};
 compare(()=>{const trace=[],value={a:1,z:2};Object.defineProperty(value,'b',{enumerable:true,get(){trace.push('b');delete value.z;value.new=4;return 3;}});return{value,trace};});
 compare(()=>{const trace=[],sentinel=new Error('getter sentinel'),value={};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push('a');throw sentinel;}});return{value,trace,sentinel};});
 compare(()=>{const trace=[],value=new Proxy({b:2,a:1},{ownKeys(t){trace.push('keys');return Reflect.ownKeys(t).reverse();},getOwnPropertyDescriptor(t,k){trace.push('desc:'+k);return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){trace.push('get:'+String(k));return Reflect.get(t,k,r);}});return{value,trace};});
 compare(()=>{const trace=[],sentinel=new Error('proxy sentinel'),value=new Proxy({}, {ownKeys(){trace.push('throw');throw sentinel;}});return{value,trace,sentinel};});
 compare(()=>{const trace=[],value=[1,2];value.map=()=>{trace.push('map');return{join(){trace.push('join');return'CUSTOM';}}};return{value,trace};});
 compare(()=>{const trace=[];class Custom extends Array{static get [Symbol.species](){trace.push('species');return Array;}}return{value:new Custom(1,2),trace};});
 compare(()=>{const trace=[],value=[1,2];Object.defineProperty(value,'map',{get(){trace.push('map');return Array.prototype.map;}});return{value,trace};});
 compare(()=>{const value={a:1};value[Symbol('extra')]=2;return{value};});
 compare(()=>({value:Object.assign(Object.create({inherited:2}),{a:1})}));
 if(exoticOnly)return{status:'PASS',checks,mode,probe:'EXOTIC_ONLY_NO_MODEL_NO_DEEP_GRAPH',...stats};
 stage('bounded-depth');
 // The unchanged mandatory digest-stream suite owns unbounded pure-cycle
 // legacy rejection. This one-site suite adds only a finite256-depth graph
 // and finite recursive getter with a precise sentinel/error/read-order.
 let deep={};for(let i=0;i<256;i++)deep={child:deep};compare(()=>({value:deep}));
 compare(()=>{const trace=[],sentinel=new RangeError('bounded recursive getter sentinel'),value={};let reads=0;
  Object.defineProperty(value,'child',{enumerable:true,get(){trace.push(++reads);if(reads===32)throw sentinel;return value;}});return{value,trace,sentinel};});
 for(const length of [16382,16383,16384,16385,32767])for(const tail of ['📱','\ud800','界'])compare(()=>({value:{s:'a'.repeat(length)+tail}}));
 if(depthOnly)return{status:'PASS',checks,mode,probe:'BOUNDED_DEPTH_NO_MODEL',...stats};
 const policyBytes=readFileSync(new URL('./fixtures/static-weekly-policy-scope-receipts.json',import.meta.url));assert.equal(sha(policyBytes),policyFixtureSha);checks++;
 const retained=JSON.parse(policyBytes).cases.baseline;
 const measurements=[];
 for(const [label,input]of [['retained-six',retained.input],...(mode==='incremental'?[['current-eight-Oct12',sourceInput().input]]:[])]){
  stage(label+'-program-generation');
  const before=canonicalJson(input),oldProgram=legacy.generateStaticWeeklySchedulingProgram(input,null),newProgram=current.generateStaticWeeklySchedulingProgram(input,null);
  assert.equal(oldProgram.error,undefined);assert.equal(newProgram.error,undefined);checks+=2;
  equal(newProgram,oldProgram,'Complete generated program changed');checks++;
  assert.equal(canonicalJson(input)===before,true,'Exact input bytes changed');checks++;
  // This existing lossless selection stores the complete canonical descriptor,
  // not the full model basis. Full fresh basis equality is checked above;
  // compare the actual retained descriptor and its independently bound digest.
  if(label==='retained-six'){assert.equal(newProgram.modelBasisDigest,retained.canonicalProgram.modelBasisDigest,'Retained basis digest changed');assert.equal(current.canonicalProgramMatches(retained.canonicalProgram,newProgram.descriptor),true,'Exact retained canonical descriptor bytes changed');checks+=2;}
  stage(label+'-model-comparison');
  const objective=newProgram.objectives[0];let oldModel=legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,[],objective),newModel=current.buildStaticWeeklySchedulingModel(newProgram.problem,[],objective);
  equal(newModel,oldModel,'Complete model/LP/Maps/identities changed');checks++;
  const values=new Map([...newModel.binary,...newModel.general].map(k=>[k,0]));
  assert.equal(current.recomputeStaticWeeklyObjective(objective,newModel,values,newProgram.problem),legacy.recomputeStaticWeeklyObjective(objective,oldModel,values,oldProgram.problem));checks++;
  const basis=newModel.modelBasis,rows=basis.constraints.rows,original=contentDigest(basis),prior=stats.sinks;
  assert.equal(contentDigest(rows),basis.constraints.digest);assert.equal(sha(canonicalJson(rows)),basis.constraints.digest);checks+=2;
  assert.equal(contentDigest(basis),sha(canonicalJson(basis)));assert.equal(contentDigest(basis),original);checks+=2;
  if(mode==='incremental'){assert.equal(stats.sinks-prior,3);checks++;}
  for(const mutate of [v=>v.inputDigest='changed',v=>v.binaryVariables.push('extra'),v=>v.binaryVariables.reverse(),v=>v.assignmentVariables[0].slotId='changed',
   v=>v.uncoveredVariables[0].planWorkId='changed',v=>v.constraints.rows.pop(),v=>v.constraints.rows.push(v.constraints.rows[0]),
   v=>v.constraints.rows[0].name='forged',v=>v.constraints.rows[0].relation='forged',v=>v.constraints.rows[0].value++,
   v=>v.constraints.rows[0].terms[0][0]++,v=>v.constraints.rows.reverse(),v=>v.constraints.rows[0].terms.push([1,'forged']),v=>v.routeCanonicality.extra='changed']){
   const changed=structuredClone(basis);mutate(changed);assert.notEqual(contentDigest(changed),original);assert.equal(contentDigest(changed),sha(canonicalJson(changed)));checks+=2;
  }
  stage(label+'-witness-comparison');
  // Drop whole comparison models before independently materializing witness
  // models. Keep exact basis and identity scalars, never a cached proof.
  const identity={modelBasisDigest:newModel.modelBasisDigest,modelDigest:newModel.modelDigest,lpDigest:sha(newModel.lp),binaryVariables:newModel.binary.size};
  oldModel=null;newModel=null;
  const oldIt=legacy.iterateStaticWeeklySchedulingWitnessTiers(oldProgram,values),newIt=current.iterateStaticWeeklySchedulingWitnessTiers(newProgram,values);
  for(let i=0;i<2;i++){const newer=newIt.next(),older=oldIt.next();assert.equal(newer.done,false);assert.equal(newer.value.error,undefined);assert.equal(older.value.error,undefined);equal(newer,older,'Fresh witness-tier regeneration/bindings changed');checks+=4;}
  oldIt.return();newIt.return();
  const mutatedObjective=structuredClone(objective);mutatedObjective.terms.push([1,basis.binaryVariables[0]]);
  let changedModel=current.buildStaticWeeklySchedulingModel(newProgram.problem,[],mutatedObjective);assert.notEqual(changedModel.modelDigest,identity.modelDigest);checks++;changedModel=null;
  const bindings=[{name:objective.name,terms:objective.terms,value:0},{name:'test-only-second',terms:[[1,basis.binaryVariables[0]]],value:0}];
  let bound=current.buildStaticWeeklySchedulingModel(newProgram.problem,bindings,objective),boundOld=legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,bindings,objective);
  assert.equal(bound.error,undefined);assert.equal(boundOld.error,undefined);equal(bound,boundOld,'Bound model changed');checks+=3;
  const boundIdentity={priorBindingDigest:bound.priorBindingDigest,modelDigest:bound.modelDigest};bound=null;boundOld=null;
  let reversed=current.buildStaticWeeklySchedulingModel(newProgram.problem,bindings.slice().reverse(),objective);assert.notEqual(reversed.priorBindingDigest,boundIdentity.priorBindingDigest);assert.notEqual(reversed.modelDigest,boundIdentity.modelDigest);checks+=2;reversed=null;
  const invalid={...input,slots:[...input.slots,input.slots[0]]};equal(current.generateStaticWeeklySchedulingProgram(invalid),legacy.generateStaticWeeklySchedulingProgram(invalid),'Invalid source error changed');checks++;
  const expired=()=>({serviceDate:'2026-10-12',get slots(){throw new Error('expired accessor must not run');}});
  equal(current.generateStaticWeeklySchedulingProgram(expired(),null,0),legacy.generateStaticWeeklySchedulingProgram(expired(),null,0),'Expired input error changed');checks++;
  assert.equal(canonicalJson(input)===before,true,'Exact input bytes changed');checks++;
  measurements.push({label,sourceDigest:sha(before),...identity,modelBasisCharacters:canonicalJson(basis).length,
   objectiveCount:newProgram.objectives.length,witness:'TEST_ONLY_ZERO_VALUES_NOT_FEASIBILITY',canonicalGeneration:true});
 }
 if(mode==='incremental'){assert.ok(stats.sinks>0);assert.ok(stats.maxChunk<=16384);checks+=2;}else{assert.equal(stats.sinks,0);checks++;}
 return{status:'PASS',checks,mode,predecessorSha,productSha:sha(text),modelSha,policyFixtureSha,measurements,...stats,solver:false,worker:false,publication:false,independentlyProvesOptimality:false};
}
async function runAllocation(mode){
 assert.equal(typeof global.gc,'function');const stats={sinks:0,writes:0,maxChunk:0,fallbacks:0,measure:false,observedHeap:0};install('incremental',stats);
 reverseSingleSite(text);const {input,request}=sourceInput(),program=current.generateStaticWeeklySchedulingProgram(input,null);assert.equal(program.error,undefined);
 const value=program.modelBasis.constraints.rows,before=sha(canonicalJson(input));global.gc();const startHeap=process.memoryUsage().heapUsed;stats.observedHeap=startHeap;stats.measure=true;
 stats.sinks=0;stats.writes=0;stats.maxChunk=0;stats.fallbacks=0;
 const start=performance.now();let digest,characters=null,afterSerialization=null;
 if(mode==='allocation-legacy'){const serialized=canonicalJson(value);characters=serialized.length;afterSerialization=process.memoryUsage().heapUsed;stats.observedHeap=Math.max(stats.observedHeap,afterSerialization);digest=sha(serialized);stats.observedHeap=Math.max(stats.observedHeap,process.memoryUsage().heapUsed);}
 else digest=contentDigest(value);
 const elapsedMs=performance.now()-start,afterHeap=process.memoryUsage().heapUsed;stats.measure=false;
 assert.equal(sha(canonicalJson(input)),before);assert.equal(digest,program.modelBasis.constraints.digest);assert.ok(stats.maxChunk<=16384);
 return{status:'PASS',checks:5,mode,digest,sourceDigest:before,requestDigest:sha(canonicalJson(request)),constraintsCharacters:characters??canonicalJson(value).length,startHeap,afterSerialization,afterHeap,observedPeak:stats.observedHeap,
  elapsedMs,node:process.version,flags:process.execArgv,maxChunk:stats.maxChunk,writes:stats.writes,exactCurrentEightSourceGeneratedConstraints:true,
  sampleNotProcessPeak:true,benchmarkNotWholePath:true,forcedGcTestOnly:true,solver:false,worker:false,publication:false};
}
export function runStaticWeeklyModelConstraintsDigestStreamTests(){
 const started=performance.now();
 const results=[];for(const mode of ['portable','string-only','incremental','allocation-legacy','allocation-stream']){
  const child=spawnSync(process.execPath,['--max-old-space-size=128','--max-semi-space-size=8','--stack-size=4096',...(mode.startsWith('allocation-')?['--expose-gc']:[]),fileURLToPath(import.meta.url),'--case',mode],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  assert.equal(child.error,undefined);assert.equal(child.status,0,JSON.stringify({mode,signal:child.signal,stderr:child.stderr,stdout:child.stdout}));results.push(JSON.parse(child.stdout.trim()));
 }
 const legacy=results.find(r=>r.mode==='allocation-legacy'),stream=results.find(r=>r.mode==='allocation-stream');assert.equal(stream.digest,legacy.digest);assert.equal(stream.sourceDigest,legacy.sourceDigest);
 const result={status:'PASS',checks:results.reduce((n,r)=>n+r.checks,0)+2,results,elapsedMs:performance.now()-started,isolatedProcesses:true,productDelta:'ONE_MODEL_CONSTRAINTS_DIGEST_SITE',solver:false,worker:false,publication:false};console.log(JSON.stringify(result));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--probe')){const probe=process.argv.at(-1);assert.ok(['import','primitive','exotic','depth'].includes(probe));console.log(JSON.stringify(probe==='import'?(await predecessor(),{status:'PASS',probe,checks:1,productSha:sha(text)}):await runCase('portable',{exoticOnly:probe!=='depth',primitiveOnly:probe==='primitive',depthOnly:probe==='depth'})));}
 else if(process.argv.includes('--case')){const mode=process.argv.at(-1);console.log(JSON.stringify(mode.startsWith('allocation-')?await runAllocation(mode):await runCase(mode)));}
 else runStaticWeeklyModelConstraintsDigestStreamTests();
}
