// One new bounded source entry. The original combined6/7/8 entry is unchanged.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {readRuntimeSuccessorInputs,validateRuntimeSuccessorInputs,restoreRuntimeCurrentSource} from './fixtures/scheduler-runtime-source-successor.mjs';
const started=performance.now(),root=fileURLToPath(new URL('../',import.meta.url));
const files=readRuntimeSuccessorInputs(root),provenance=validateRuntimeSuccessorInputs(files);let refusals=0;
for(const path of Object.keys(files)){
 const omitted={...files};delete omitted[path];assert.throws(()=>validateRuntimeSuccessorInputs(omitted));refusals++;
 assert.throws(()=>validateRuntimeSuccessorInputs({...files,[path]:files[path]+'\n// unknown successor\n'}));refusals++;
}
assert.throws(()=>restoreRuntimeCurrentSource('src/unknown.js',''));refusals++;
const path='scripts/current-full-hour-ci-tests.mjs',call="await import('./scheduler-runtime-successor-ci-tests.mjs');";
for(const replacement of ['',call.replace('await ',''),'if(false){'+call+'}',call.replace(');',').catch(()=>{});'),call+'\n'+call]){
 const changed=files[path].replace(call,replacement);assert.notEqual(changed,files[path]);assert.throws(()=>validateRuntimeSuccessorInputs({...files,[path]:changed}));refusals++;
}
const cases=[['canonical',2856],['integer-load',692],['coverage',48],['postgres-order',13],['phase-identity',18],['preparation',25]],results=[];
for(const [name,count]of cases){
 const remaining=Math.floor(55000-(performance.now()-started));assert.ok(remaining>0);
 const child=spawnSync(process.execPath,['--max-old-space-size=256','--wasm-max-mem-pages=1536','--max-semi-space-size=4',`scripts/scheduler-runtime-${name}-tests.mjs`],
  {cwd:root,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},encoding:'utf8',timeout:remaining,maxBuffer:2*1024*1024});
 assert.equal(child.error,undefined,String(child.error));assert.equal(child.status,0,child.stderr||child.stdout);
 const receipt=JSON.parse(child.stdout.trim().split('\n').at(-1));assert.equal(receipt.status,'PASS');assert.equal(receipt.checks??receipt.cases,count);
 if(name==='preparation')assert.equal(receipt.invocationChecks,24);
 process.stdout.write(child.stdout);results.push({name,...receipt});
}
validateRuntimeSuccessorInputs(readRuntimeSuccessorInputs(root));
console.log(JSON.stringify({suite:'scheduler-runtime-successor-current',status:'PASS',provenance,refusals,results,elapsedMs:performance.now()-started,
 originalCombinedReductionSeparateAndUnchanged:true,SQL:false,app_build:false,phone:false}));
