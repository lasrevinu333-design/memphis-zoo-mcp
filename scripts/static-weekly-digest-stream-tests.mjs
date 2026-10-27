import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {canonicalJson,contentDigest,installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
import {postgresJsonbCanonicalText,postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {createCurrentMorningIntegrationRequest} from './static-weekly-recurring-morning-integration-tests.mjs';

const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const capture=fn=>{try{return{value:fn()};}catch(error){return{error,name:error.name,message:error.message,code:error.code};}};
function runCase(mode) {
 let checks=0,sinks=0,writes=0,maxChunkChars=0,maxChunkBytes=0,hashedBytes=0,fallbacks=0,lastCompletedText=null;
 const native=text=>{fallbacks++;return sha(text);};
 const capability={schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){sinks++;const hash=createHash('sha256'),chunks=[];let finished=false;return{
  writeUtf8(text){assert.equal(finished,false);chunks.push(text);writes++;maxChunkChars=Math.max(maxChunkChars,text.length);maxChunkBytes=Math.max(maxChunkBytes,Buffer.byteLength(text));hashedBytes+=Buffer.byteLength(text);hash.update(text,'utf8');},
  finishHex(){assert.equal(finished,false);finished=true;lastCompletedText=chunks.join('');return hash.digest('hex');},
 };}};
 if(mode==='invalid') {
  for(const altered of [null,{}, {...capability,schema:'other'}, {...capability,extra:true}, {...capability,[Symbol('extra')]:true}, {...capability,isProxy:()=>false},
   {...capability,create:()=>({writeUtf8(){},finishHex(){return '0'.repeat(64);}})}]) {
   if(altered===null)continue;assert.throws(()=>installStaticWeeklySha256HexAccelerator(native,altered));checks++;
  }
  installStaticWeeklySha256HexAccelerator(native,capability);assert.throws(()=>installStaticWeeklySha256HexAccelerator(native,capability),/only once/);checks++;
 }else if(mode==='native')installStaticWeeklySha256HexAccelerator(native,capability);
 else if(mode==='string-only')installStaticWeeklySha256HexAccelerator(native);
 const baselineSinks=sinks;
 const compare=factory=>{
  for(const [text,digest]of [[canonicalJson,contentDigest],[postgresJsonbCanonicalText,postgresJsonbContentDigest]]) {
   const before=factory(),after=factory();let expectedText=null;const expected=capture(()=>{expectedText=text(before.value);return sha(expectedText);}),priorSinks=sinks,actual=capture(()=>digest(after.value));
   for(const field of ['value','name','message','code'])assert.equal(actual[field],expected[field]);
   if(before.trace)assert.deepEqual(after.trace,before.trace);
   if(before.sentinel){assert.equal(expected.error,before.sentinel);assert.equal(actual.error,after.sentinel);}checks++;
   if(sinks>priorSinks && !actual.error)assert.equal(lastCompletedText,expectedText,'Exact emitted bytes differ from legacy serializer');
  }
 };
 const values=[null,true,false,0,-0,0.5,1e-7,1e21,1e-300,Number.MAX_VALUE,'"\n📱\ud800',[],[1,,3],
  {a:1,bbb:{z:2,a:3}},Object.create(null),new Date(0),new Map([['a',1]]),new Uint16Array([1,500]),undefined,NaN,Infinity,-Infinity,1n,Symbol('s'),()=>1];
 for(const value of values)compare(()=>({value}));
 const keys=['tier_10','tier_2','tier_01','A','a','é','e\u0301','𐀀','📱','\ud800','\ud801','\ufffd','\u0000','__proto__','constructor','1','01'];
 for(const order of [keys,keys.slice().reverse()]){
  compare(()=>({value:Object.fromEntries(order.map((k,i)=>[k,i]))}));
  compare(()=>{const trace=[],value={};for(const k of order)Object.defineProperty(value,k,{enumerable:true,get(){trace.push(k);return k;}});return{value,trace};});
 }
 compare(()=>{const sentinel=new Error('same getter sentinel'),trace=[],value={};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push('throw');throw sentinel;}});return{value,trace,sentinel};});
 compare(()=>{const trace=[],value={a:1,z:2};Object.defineProperty(value,'b',{enumerable:true,get(){trace.push('b');delete value.z;value.new='not included';return 3;}});return{value,trace};});
 compare(()=>{const trace=[],value=new Proxy({b:2,a:1},{ownKeys(t){trace.push('keys');return Reflect.ownKeys(t).reverse();},getOwnPropertyDescriptor(t,k){trace.push('descriptor:'+k);return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){trace.push('get:'+String(k));return Reflect.get(t,k,r);}});return{value,trace};});
 compare(()=>{const trace=[],sentinel=new Error('proxy sentinel'),value=new Proxy({}, {ownKeys(){trace.push('throw');throw sentinel;}});return{value,trace,sentinel};});
 compare(()=>{const trace=[],value=[1,2];Object.defineProperty(value,'map',{get(){trace.push('map');return Array.prototype.map;}});return{value,trace};});
 compare(()=>{const trace=[];class Custom extends Array {static get [Symbol.species](){trace.push('species');return Array;}}return{value:new Custom(1,2),trace};});
 compare(()=>{const trace=[],value=[1,2];value.map=function(fn){trace.push('custom-map');return{join(sep){trace.push('join:'+sep);return 'CUSTOM';}}};return{value,trace};});
 compare(()=>{const trace=[],value=[1,2];Object.defineProperty(value,'map',{value(){trace.push('nonenumerable-map');return{join(){trace.push('custom-join');return 'CUSTOM';}};}});return{value,trace};});
 compare(()=>{const trace=[],value=[1,2];class Result extends Array {join(){trace.push('species-join');return 'CUSTOM';}}Object.defineProperty(value,'constructor',{value:{[Symbol.species]:Result}});return{value,trace};});
 compare(()=>{const value=[1,2];value[Symbol('ignored')]=3;return{value};});
 compare(()=>{const value={a:1};Object.defineProperty(value,'ignored',{get(){throw new Error('not visited');}});return{value};});
 for(const length of [16382,16383,16384,16385,32767])for(const suffix of ['📱','\ud800','é'])compare(()=>({value:{s:'a'.repeat(length)+suffix+'tail'}}));
 for(const value of ['界'.repeat(40000),'📱'.repeat(40000)])compare(()=>({value:{s:value}}));
 let seed=0x20261003;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 function tree(depth){if(!depth)return [null,true,false,-0,1e-7,'📱\ud800'][rnd()%6];if(rnd()%3===0)return Array.from({length:rnd()%5},()=>tree(depth-1));const value={};for(let i=0,n=rnd()%7;i<n;i++)value[keys[rnd()%keys.length]]=tree(depth-1);return value;}
 for(let i=0;i<60;i++){const value=tree(3);compare(()=>({value:structuredClone(value)}));}
 const cyclic={};cyclic.self=cyclic;compare(()=>({value:cyclic}));
 const mut={a:{b:1}};for(const digest of [contentDigest,postgresJsonbContentDigest]){const first=digest(mut);mut.a.b++;assert.notEqual(digest(mut),first);checks++;}
 const measurements=[];
 for(const count of [6,7,8]){
  const {request}=createCurrentMorningIntegrationRequest({count,targetEffectiveDate:'2026-10-12'}),value=request.publishedSource.compiler_input;
  const before=JSON.stringify(value),sinkCount=sinks;
  for(const [text,digest,name]of [[canonicalJson,contentDigest,'portable'],[postgresJsonbCanonicalText,postgresJsonbContentDigest,'postgres']]){
   const start=performance.now(),expected=sha(text(value)),referenceMs=performance.now()-start,t=performance.now(),actual=digest(value),streamMs=performance.now()-t;
   assert.equal(actual,expected);assert.equal(JSON.stringify(value),before);checks++;
   if(mode==='native'||mode==='invalid')assert.equal(lastCompletedText,text(value));
   measurements.push({count,name,bytes:Buffer.byteLength(text(value)),digest:actual,referenceMs,streamMs});
  }
  if(mode==='native'||mode==='invalid'){assert.equal(sinks-sinkCount,2);checks++;}
 }
 if(mode==='native'||mode==='invalid'){assert.ok(sinks>baselineSinks);assert.ok(writes>0);assert.ok(maxChunkChars<=16384);assert.ok(maxChunkBytes<=49152);checks+=4;}
 else{assert.equal(sinks,0);checks++;}
 const result={status:'PASS',mode,checks,sinks,writes,maxChunkChars,maxChunkBytes,hashedBytes,fallbacks,measurements,solver:false,worker:false,publication:false};console.log(JSON.stringify(result));return result;
}
function runRetainedCase(path){
 const bytes=readFileSync(path);assert.equal(sha(bytes),'fdeedf481bf438c8db17409a3d9f1599bd1296145d13f776103c1237155273b1');
 const p=JSON.parse(bytes),measurements=[];let sinks=0;
 installStaticWeeklySha256HexAccelerator(sha,{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){sinks++;const h=createHash('sha256');return{writeUtf8(text){h.update(text,'utf8');},finishHex(){return h.digest('hex');}};}});
 for(const [label,value]of [['preview.decision',p.preview.decision],['preview.morningCommitment',p.preview.morningCommitment],['preview.weekCommitment',p.preview.weekCommitment],['admission.canonicalSource',p.admission.canonicalSource]]){
  for(const [text,digest,name]of [[canonicalJson,contentDigest,'portable'],[postgresJsonbCanonicalText,postgresJsonbContentDigest,'postgres']]){
   const expected=sha(text(value)),before=sinks;assert.equal(digest(value),expected);assert.equal(sinks,before+1);measurements.push({label,name,bytes:Buffer.byteLength(text(value)),digest:expected});
  }
 }
 const result={status:'PASS',checks:17,retainedProofSha256:sha(bytes),retainedProofBytes:bytes.length,measurements,existingOrdinarySevenNotRerun:true,changedRuntimeReadyClaim:false,solver:false,publication:false};console.log(JSON.stringify(result));return result;
}
function runAllocationCase(){
 assert.equal(typeof global.gc,'function');
 let samples=0,streamPeak=0,maxChunkChars=0,maxChunkBytes=0;
 installStaticWeeklySha256HexAccelerator(sha,{schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,create(){const h=createHash('sha256');return{
  writeUtf8(text){samples++;maxChunkChars=Math.max(maxChunkChars,text.length);maxChunkBytes=Math.max(maxChunkBytes,Buffer.byteLength(text));streamPeak=Math.max(streamPeak,process.memoryUsage().heapUsed);h.update(text,'utf8');streamPeak=Math.max(streamPeak,process.memoryUsage().heapUsed);},
  finishHex(){return h.digest('hex');},
 };}});
 const source=createCurrentMorningIntegrationRequest({count:7,targetEffectiveDate:'2026-10-12'}).request.publishedSource.compiler_input;
 // A bounded allocation stressor containing eight references to the EXACT
 // current synthetic7 source. Not a compiler result or scheduling fixture.
 const value={allocationMicrocase:Array(8).fill(source)},sourceDigest=sha(canonicalJson(source)),measurements=[];
 for(const [serializer,digest,name]of [[canonicalJson,contentDigest,'portable'],[postgresJsonbCanonicalText,postgresJsonbContentDigest,'postgres']]){
  global.gc();const refStart=process.memoryUsage().heapUsed,t=performance.now();let text=serializer(value);
  const afterSerialization=process.memoryUsage().heapUsed,bytes=Buffer.byteLength(text),expected=sha(text),afterHash=process.memoryUsage().heapUsed,referenceMs=performance.now()-t;
  text=null;global.gc();const streamStart=process.memoryUsage().heapUsed;streamPeak=streamStart;samples=0;maxChunkChars=0;maxChunkBytes=0;const u=performance.now(),actual=digest(value),streamMs=performance.now()-u;
  assert.equal(actual,expected);assert.equal(sha(canonicalJson(source)),sourceDigest);assert.ok(samples>0);assert.ok(maxChunkChars<=16384);assert.ok(maxChunkBytes<=49152);
  measurements.push({name,bytes,digest:actual,referenceStartHeap:refStart,referenceAfterSerializationHeap:afterSerialization,referenceAfterHashHeap:afterHash,referenceObservedPeak:Math.max(refStart,afterSerialization,afterHash),streamStartHeap:streamStart,streamObservedPeak:streamPeak,samples,maxChunkChars,maxChunkBytes,referenceMs,streamMs});
 }
 const result={status:'PASS',mode:'allocation',checks:10,measurements,sourceDigest,sourceReferences:8,node:process.version,forcedGcBetweenCasesTestOnly:true,peakIsCapturedNotProcessMaximum:true,benchmarkNotWholePath:true,solver:false,publication:false};console.log(JSON.stringify(result));return result;
}
export function runStaticWeeklyDigestStreamTests(){
 const results=[];for(const mode of ['portable','string-only','invalid','native','allocation']){
  const child=spawnSync(process.execPath,['--max-old-space-size=128','--max-semi-space-size=8','--stack-size=4096',...(mode==='allocation'?['--expose-gc']:[]),fileURLToPath(import.meta.url),'--case',mode],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr||child.stdout);results.push(JSON.parse(child.stdout.trim()));
 }
 const result={status:'PASS',checks:results.reduce((n,r)=>n+r.checks,0),results,isolatedProcesses:true,solver:false,publication:false};console.log(JSON.stringify(result));return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv.includes('--retained'))runRetainedCase(process.argv.at(-1));else if(process.argv.includes('--case')){if(process.argv.at(-1)==='allocation')runAllocationCase();else runCase(process.argv.at(-1));}else runStaticWeeklyDigestStreamTests();}
