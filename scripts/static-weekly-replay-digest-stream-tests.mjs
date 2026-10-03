import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalJson,contentDigest,sha256Hex,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const legacySite=`  const canonicalReplay = canonicalJson(replay);
  // Keep only the digest. Returning canonicalReplay duplicated the complete
  // result byte-for-byte after its size check and defeated the envelope cap.
  return { ...result, replayDigest: sha256Hex(canonicalReplay) };`;
const currentSite=`  // Preserve the exact canonical replay identity without retaining a second
  // whole-result string solely for hashing. The existing digest helper keeps
  // its legacy serializer fallback where incremental hashing is unavailable.
  return { ...result, replayDigest: contentDigest(replay) };`;
const predecessorSha='8724f6dd8768e8f126076fa91c72e473e0555e626d50ecb9d66c5cba4bf2bc21';
const compiler=readFileSync(new URL('../src/static-weekly-schedule-compiler.js',import.meta.url),'utf8');
const one=(text,needle)=>{assert.equal(text.split(needle).length,2,'Exact one-site binding required');return text.replace(needle,legacySite);};
function exactProjection(){
 const matches=[...compiler.matchAll(/^function replayProjection\(result\) \{[^]*?^\}/gm)];assert.equal(matches.length,1);
 return new Function('clone','array',matches[0][0]+';return replayProjection;')(value=>JSON.parse(JSON.stringify(value)),value=>Array.isArray(value)?value:[]);
}
function assertNarrowSource(){assert.equal(sha(one(compiler,currentSite)),predecessorSha);return 1;}
const legacy=replay=>sha256Hex(canonicalJson(replay)),patched=replay=>contentDigest(replay);
const capture=fn=>{try{return{value:fn()};}catch(error){return{error,name:error.name,message:error.message,code:error.code};}};
function runCase(mode){
 let checks=assertNarrowSource(),sinks=0,writes=0,characters=0,maxChunk=0,fallbacks=0;
 const native=text=>{fallbacks++;return sha(text);};
 if(mode==='string-only')installStaticWeeklySha256HexAccelerator(native);
 if(mode==='incremental')installStaticWeeklySha256HexAccelerator(native,{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){sinks++;const h=createHash('sha256');return{
  writeUtf8(text){writes++;characters+=text.length;maxChunk=Math.max(maxChunk,text.length);h.update(text,'utf8');},finishHex(){return h.digest('hex');},
 };}});
 const compare=factory=>{
  const before=factory(),after=factory(),expected=capture(()=>legacy(before.value)),actual=capture(()=>patched(after.value));
  for(const key of ['value','name','message','code'])assert.equal(actual[key],expected[key]);
  if(before.trace)assert.deepEqual(after.trace,before.trace);
  if(before.sentinel){assert.equal(expected.error,before.sentinel);assert.equal(actual.error,after.sentinel);}checks++;
 };
 for(const value of [null,true,false,0,-0,1e-7,1e21,Number.MAX_VALUE,'📱\ud800\u0000',[],[1,,3],{é:1,'e\u0301':2,'𐀀':3,'\ud800':4},Object.create(null),undefined,NaN,Infinity,1n,Symbol('s'),()=>1,new Date(0)])compare(()=>({value}));
 compare(()=>{const trace=[],value={b:2};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push('a');delete value.b;value.z=4;return 3;}});return{trace,value};});
 compare(()=>{const trace=[],sentinel=new Error('sentinel'),value={};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push('a');throw sentinel;}});return{trace,sentinel,value};});
 compare(()=>{const trace=[],value=new Proxy({b:2,a:1},{ownKeys(t){trace.push('keys');return Reflect.ownKeys(t).reverse();},getOwnPropertyDescriptor(t,k){trace.push('desc:'+k);return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){trace.push('get:'+k);return Reflect.get(t,k,r);}});return{value,trace};});
 compare(()=>{const trace=[],value=[1,2];value.map=function(){trace.push('map');return{join(){trace.push('join');return 'CUSTOM';}};};return{value,trace};});
 const cyclic={};cyclic.self=cyclic;compare(()=>({value:cyclic}));
 for(const length of [16382,16383,16384,16385,32767])for(const suffix of ['📱','\ud800','界'])compare(()=>({value:{s:'a'.repeat(length)+suffix}}));
 const projection=exactProjection();
 const source=JSON.parse(readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url)));
 assert.equal(sha(readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url))),'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');checks++;
 const tier={name:'identity',objective:2,options:{time_limit:30,threads:1},attestation:{terminalReport:'retained',rawReceiptDigest:'raw',modelDigest:'model',lpDigest:'lp'}};
 const result={assignments:[{id:'exact',displayName:'📱\ud800'}],certificate:{tiers:[structuredClone(tier)],options:[{time_limit:30,threads:1}],tierReceiptDigest:'r',tierOptionsDigest:'o',execution:{durationMilliseconds:42,receiptBytes:7,workerOutputBytes:8,resultBytes:9,other:10}},solver:{tiers:[structuredClone(tier)]},canonicalAuthority:{optimizerResult:{certificate:{tiers:[structuredClone(tier)],options:[{time_limit:30,threads:1}],execution:{durationMilliseconds:42,receiptBytes:7,workerOutputBytes:8,resultBytes:9,other:10}},tiers:[structuredClone(tier)]},databaseContentIdentity:'db'},authorityDigest:'a',solutionDigest:'s',sourceFactSelection:source};
 const original=JSON.stringify(result),replay=projection(result);
 assert.equal(JSON.stringify(result),original);checks++;
 const actual=patched(replay),expected=legacy(replay);assert.equal(actual,expected);checks++;
 const previousSinks=sinks;assert.equal(patched(replay),actual);assert.equal(patched(replay),actual);
 assert.equal(sinks-previousSinks,mode==='incremental'?2:0);checks++;
 for(const list of [replay.solver.tiers,replay.certificate.tiers,replay.canonicalAuthority.optimizerResult.tiers,replay.canonicalAuthority.optimizerResult.certificate.tiers]){
  assert.equal(list[0].attestation.terminalReport,undefined);assert.equal(list[0].attestation.rawReceiptDigest,undefined);assert.equal(list[0].options.time_limit,undefined);assert.equal(list[0].attestation.modelDigest,'model');checks++;
 }
 const volatile=structuredClone(result);for(const list of [volatile.solver.tiers,volatile.certificate.tiers,volatile.canonicalAuthority.optimizerResult.tiers,volatile.canonicalAuthority.optimizerResult.certificate.tiers]){list[0].options.time_limit=0.125;list[0].attestation.terminalReport='different';list[0].attestation.rawReceiptDigest='different';}
 volatile.certificate.execution.durationMilliseconds=123;volatile.certificate.execution.receiptBytes=100;volatile.certificate.execution.workerOutputBytes=200;volatile.certificate.execution.resultBytes=300;
 volatile.certificate.tierReceiptDigest='changed';volatile.certificate.tierOptionsDigest='changed';volatile.solutionDigest='changed';volatile.authorityDigest='changed';volatile.canonicalAuthority.databaseContentIdentity='changed';
 assert.equal(patched(projection(volatile)),actual);checks++;
 for(const mutate of [v=>v.assignments[0].id='other',v=>v.solver.tiers[0].objective++,v=>v.certificate.execution.other++,v=>v.canonicalAuthority.optimizerResult.tiers[0].attestation.modelDigest='other',v=>v.sourceFactSelection.extra='different']){
  const changed=structuredClone(result);mutate(changed);assert.notEqual(patched(projection(changed)),actual);checks++;
 }
 const returned={...result,replayDigest:patched(replay)};assert.equal(returned.replayDigest,expected);for(const key of Object.keys(result))assert.equal(returned[key],result[key]);checks++;
 assert.equal(JSON.stringify(result),original);checks++;
 const mutation={a:{b:1}},first=patched(mutation);mutation.a.b=2;assert.notEqual(patched(mutation),first);checks++;
 if(mode==='incremental'){assert.ok(sinks>0);assert.ok(writes>0);assert.ok(maxChunk<=16384);checks+=3;}else{assert.equal(sinks,0);checks++;}
 return{status:'PASS',mode,checks,sinks,writes,characters,maxChunk,fallbacks,sourceFixtureSha256:sha(readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url))),replayDigest:actual,syntheticResultShape:true,actualCompilerResultClaim:false,solver:false,publication:false};
}
function runAllocation(mode){
 assert.equal(typeof global.gc,'function');let observedPeak=0,samples=0,maxChunk=0,writes=0;
 installStaticWeeklySha256HexAccelerator(sha,{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){const h=createHash('sha256');return{
  writeUtf8(text){samples++;writes++;maxChunk=Math.max(maxChunk,text.length);observedPeak=Math.max(observedPeak,process.memoryUsage().heapUsed);h.update(text,'utf8');observedPeak=Math.max(observedPeak,process.memoryUsage().heapUsed);},finishHex(){return h.digest('hex');},
 };}});
 const source=JSON.parse(readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url)));
 // Allocation microcase: exact source facts repeated, not a compiler witness.
 const result={allocationMicrocase:Array(8).fill(source),solver:{tiers:[]},certificate:{execution:{durationMilliseconds:1}}},before=sha(JSON.stringify(result));
 const replay=exactProjection()(result);global.gc();const startHeap=process.memoryUsage().heapUsed,t=performance.now();observedPeak=startHeap;
 samples=0;writes=0;maxChunk=0;
 let digest,characters=null,afterSerialize=null;
 if(mode==='allocation-legacy'){const text=canonicalJson(replay);characters=text.length;afterSerialize=process.memoryUsage().heapUsed;observedPeak=Math.max(observedPeak,afterSerialize);digest=sha256Hex(text);observedPeak=Math.max(observedPeak,process.memoryUsage().heapUsed);}
 else digest=contentDigest(replay);
 const elapsedMs=performance.now()-t,after=process.memoryUsage().heapUsed;
 assert.equal(sha(JSON.stringify(result)),before);assert.ok(/^[0-9a-f]{64}$/.test(digest));assert.ok(maxChunk<=16384);
 return{status:'PASS',mode,checks:3,digest,characters,afterSerialize,startHeap,afterHeap:after,observedPeak,samples,writes,maxChunk,elapsedMs,node:process.version,sourceReferences:8,syntheticAllocationOnly:true,peakIsSampledNotProcessMaximum:true,benchmarkNotWholePath:true,solver:false,publication:false};
}
export function runStaticWeeklyReplayDigestStreamTests(){
 const results=[];
 for(const mode of ['portable','string-only','incremental','allocation-legacy','allocation-stream']){
  const child=spawnSync(process.execPath,['--max-old-space-size=128','--max-semi-space-size=8','--stack-size=4096',...(mode.startsWith('allocation-')?['--expose-gc']:[]),fileURLToPath(import.meta.url),'--case',mode],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr||child.stdout);results.push(JSON.parse(child.stdout.trim()));
 }
 const legacy=results.find(r=>r.mode==='allocation-legacy'),stream=results.find(r=>r.mode==='allocation-stream');assert.equal(stream.digest,legacy.digest);
 const result={status:'PASS',checks:results.reduce((n,r)=>n+r.checks,0)+1,results,sourceDeltaOnlyReplayDigest:true,predecessorSha,solver:false,actualPreviewExecuted:false,publication:false};console.log(JSON.stringify(result));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--case')){const mode=process.argv.at(-1);console.log(JSON.stringify(mode.startsWith('allocation-')?runAllocation(mode):runCase(mode)));}
 else runStaticWeeklyReplayDigestStreamTests();
}
