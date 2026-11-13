// Executes the complete retained 28+56 ingress checks against their authentic
// historical module. Actual current ingress checks run separately in the caller.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,lstatSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {runBoundedNodeProof} from '../bounded-node-proof.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function runHistoricalManagerOperationProof(){
 const entries=[
  ['scripts/static-weekly-manager-operation-tests.mjs','./historical-manager-operation-tests.mjs',null],
  ['src/static-weekly-manager-operation.js','./historical-general-manager-operation.mjs','ae546852ebde937d1b75f2cb6db35cdfcdc8aea3bc44e5da400076e995e8a32f'],
  ['scripts/fixtures/static-weekly-manager-operation-before-general-owner.mjs','./static-weekly-manager-operation-before-general-owner.mjs','74510b9c0f65f6ad03e523e7bd7ff5b0d4af859ec8939044781bfce58797c717'],
 ];
 const dir=mkdtempSync(join(tmpdir(),'custodial-historical-manager-proof-')),id=lstatSync(dir);
 try{
  for(const [path,input,pin]of entries){
   const bytes=readFileSync(new URL(input,import.meta.url));assert.equal(sha(bytes),pin??'65bc7b8d4b14ab6a026b593d0fcebbcbb2395aa83e733a22c5eae9130422f69a');
   const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
  }
  writeFileSync(join(dir,'package.json'),'{"type":"module"}\n',{flag:'wx'});
  const result=await runBoundedNodeProof({args:['scripts/static-weekly-manager-operation-tests.mjs'],cwd:dir,absoluteMilliseconds:50000,cleanupReserveMilliseconds:5000,maxBuffer:65536});
  const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.status,'PASS');assert.equal(receipt.checks,28);assert.equal(receipt.currentChecks,56);
  assert.equal(receipt.currentOwnerSourceSha256,entries[1][2]);assert.equal(receipt.historicalOwnerSourceSha256,entries[2][2]);assert.equal(result.receipt.groupAbsent,true);
  console.log(JSON.stringify({status:'PASS',scope:'HISTORICAL_GENERAL_MANAGER_SOURCE_ONLY',checks:28,currentChecks:56,groupAbsent:true}));
 }finally{
  const st=lstatSync(dir);assert.equal(st.dev,id.dev);assert.equal(st.ino,id.ino);assert.equal(st.uid,process.getuid());assert.equal(st.isSymbolicLink(),false);assert.equal(realpathSync(dir),dir);rmSync(dir,{recursive:true});
 }
}
