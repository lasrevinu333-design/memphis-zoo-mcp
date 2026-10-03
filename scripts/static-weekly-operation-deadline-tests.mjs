import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {REQUEST_DEADLINE_MILLISECONDS,createStaticWeeklyDeadline,remainingStaticWeeklyMilliseconds,admitStaticWeeklyRawInput} from '../src/static-weekly-schedule-program.js';

// Finite monotonic/driver-control tests ONLY. No compiler/solver/model/authority
// result is mocked into evidence. Root separately owns runtime cancellation.
export async function runStaticWeeklyOperationDeadlineTests(){
 let checks=0;const check=(f)=>{f();checks++;},digest=x=>createHash('sha256').update(x).digest('hex');
 check(()=>assert.equal(REQUEST_DEADLINE_MILLISECONDS,60000));
 const property=Object.getOwnPropertyDescriptor(globalThis,'performance');let clock=1000;
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
 try{
  const deadline=createStaticWeeklyDeadline();check(()=>assert.equal(deadline,61000));
  clock=11000;check(()=>assert.equal(remainingStaticWeeklyMilliseconds(deadline),50000));
  clock=51000;check(()=>assert.equal(remainingStaticWeeklyMilliseconds(deadline),10000));
  clock=61000;check(()=>assert.throws(()=>remainingStaticWeeklyMilliseconds(deadline),{code:'solver_timeout'}));
  for(const value of [60001,315000,300000,Infinity,NaN,0,-1,1.5,'60000'])check(()=>assert.throws(()=>createStaticWeeklyDeadline(value),{code:'solver_timeout'}));
  for(const value of [NaN,Infinity,-Infinity,undefined])check(()=>assert.throws(()=>remainingStaticWeeklyMilliseconds(value),{code:'solver_timeout'}));
  clock=1000;check(()=>assert.equal(createStaticWeeklyDeadline(100),1100));
  clock=62000;check(()=>assert.equal(admitStaticWeeklyRawInput({},deadline).code,'solver_timeout'));
 }finally{Object.defineProperty(globalThis,'performance',property);}
 const program=readFileSync(new URL('../src/static-weekly-schedule-program.js',import.meta.url),'utf8');
 const oldComment='// One compiler request performs a bounded sequence of independently bounded\n// solver tiers and then regenerates/verifies the complete witness twice.  Do\n// not reuse the 30-second *per-tier* worker limit as the deadline for that\n// whole sequence: production authority currently requires 111 exact tiers.\n// The admitted V10 schedule completes locally inside two minutes but exceeds\n// that parent bound on the Render Starter CPU. Five minutes remains a finite,\n// fail-closed request boundary while preserving each worker\'s stricter\n// 30-second ceiling and the control plane\'s one-request serialization.\nexport const REQUEST_DEADLINE_MILLISECONDS = 300_000;';
 const newComment=program.slice(program.indexOf('// October3 controlling'),program.indexOf('// HiGHS terminal reports'));
 const constructorGuard="  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > REQUEST_DEADLINE_MILLISECONDS) {\n    throw Object.assign(new RangeError('Static weekly operation deadline must be within the absolute60s ceiling.'), {code:'solver_timeout'});\n  }\n";
 const remainingGuard="  if (!Number.isFinite(deadline)) throw Object.assign(new Error('Static weekly request deadline is invalid.'), {code:'solver_timeout'});\n";
 for(const needle of [newComment,constructorGuard,remainingGuard])check(()=>assert.equal(program.split(needle).length,2));
 const reversed=program.replace(newComment,oldComment+'\n').replace(constructorGuard,'').replace(remainingGuard,'');
 check(()=>assert.equal(digest(reversed),'6feeea1894da194d26b315d4f923b88bcd39d901f0df812466446d6b3d4b76b9','entire program predecessor bytes; no objective/model/history changes'));
 const gate=readFileSync(new URL('./static-weekly-recurring-morning-integration-tests.mjs',import.meta.url),'utf8'),start='export async function runRecurringMorningFusedSixTest(',end='\n// Owning diagnostic ONLY:';
 check(()=>assert.equal(gate.split(start).length,2));check(()=>assert.equal(gate.split(end).length,2));
 const original=gate.slice(gate.indexOf(start),gate.indexOf(end));
 for(const needle of ['assert.equal(preview.staffedPositions,count)','assert.equal(preview.morningCommitment.morningFacts.days.length,7)','assertRecurringAdmissionCandidate(admission)',
  'assert.equal(preview.morningCommitment.digest,admission.candidate.morningCommitment.digest)','assert.equal(preview.weekCommitment.digest,admission.candidate.weekCommitment.digest)',
  'assert.equal(preview.decisionDigest,admission.candidate.decisionDigest)','assert.equal(preview.candidateSourceDigest,admission.candidate.candidateSourceDigest)',
  'assert.equal(canonicalJson(request),before)','expectedRevision:41','/revision changed/','checks:11'])check(()=>assert.ok(original.includes(needle),needle));
 // Exact source fragment, replacing only dynamic imports with finite transport
 // dependencies to exercise attempt-clock/cancellation/cleanup ordering. The
 // stand-in candidate is never returned by these tests as authority evidence.
 let body=original.replace('export async function','async function');
 for(const [needle,replacement]of [
  ["await import('../src/static-weekly-schedule-compiler-runtime.js')",'dependencies.runtime'],
  ["await import('../src/static-weekly-recurring-week-commitment.js')",'dependencies.commitment'],
  ["await import('../src/static-weekly-recurring-preview.js')",'dependencies.preview']]){check(()=>assert.equal(body.split(needle).length,2));body=body.replace(needle,replacement);}
 const factory=new Function('dependencies','performance','createCurrentMorningIntegrationRequest','canonicalJson','AbortController','setTimeout','clearTimeout','assert','fs','process','console','return ('+body+');');
 for(const mode of ['complete','first-overrun','cleanup-overrun','abort']){
  let elapsed=0,callback,timerMilliseconds,cleared=false,shutdown=false;const options=[],logs=[];
  const candidate={staffedPositions:8,morningCommitment:{digest:'fake-control-flow-only',morningFacts:{days:Array(7).fill(null)}},weekCommitment:{digest:'fake-control-flow-only'},decisionDigest:'fake',candidateSourceDigest:'fake'};
  const runtime={async prepareRecurringCandidate(request,opt){options.push(opt);if(request.expectedRevision===41){elapsed+=2000;throw new Error('revision changed');}elapsed+=mode==='first-overrun'?60000:15000;if(mode==='abort')callback();return candidate;},
   async prepareRecurringAdmissionCandidate(request,opt){options.push(opt);elapsed+=10000;return {candidate};},async shutdown(){shutdown=true;elapsed+=mode==='cleanup-overrun'?60000:1000;}};
  const dependencies={runtime:{createStaticWeeklyCompilerRuntime:()=>runtime},commitment:{assertRecurringMorningCommitmentCandidate:()=>true},preview:{assertRecurringAdmissionCandidate:()=>{}}};
  const fn=factory(dependencies,{now:()=>elapsed},()=>{elapsed+=2000;return {request:{expectedRevision:42},fixture:{differences:[]}};},JSON.stringify,AbortController,
   (f,ms)=>{callback=f;timerMilliseconds=ms;return 'one-timer';},token=>{assert.equal(token,'one-timer');cleared=true;},assert,{writeFileSync(){assert.fail('artifact disabled in finite driver proof');}},{env:{}},{log:v=>logs.push(v)});
  if(mode==='complete'){const r=await fn({count:8});check(()=>assert.equal(r.elapsedMs,30000));check(()=>assert.equal(options.length,3));check(()=>assert.deepEqual(options.map(o=>o.deadlineMilliseconds),[58000,43000,33000]));check(()=>assert.ok(options.every(o=>o.signal===options[0].signal)));check(()=>assert.equal(logs.length,1));}
  else{await assert.rejects(()=>fn({count:8}),{code:'solver_timeout'});checks++;check(()=>assert.equal(logs.length,0,'no PASS printed before complete cleanup/deadline check'));if(mode==='first-overrun'||mode==='abort')check(()=>assert.equal(options.length,1,'no fresh-admission renewal after failure'));}
  check(()=>assert.equal(timerMilliseconds,60000));check(()=>assert.equal(cleared,true));check(()=>assert.equal(shutdown,true));
 }
 return {status:'PASS',checks,scope:'FINITE_MONOTONIC_AND_DRIVER_CONTROL_ONLY',absoluteMilliseconds:60000,actual_solver:false,actual_private_preview:false,correctness_or_optimality_changed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await runStaticWeeklyOperationDeadlineTests()));
