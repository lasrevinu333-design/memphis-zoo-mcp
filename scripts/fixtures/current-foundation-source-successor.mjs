// Source-only CI lineage. The actual current workflow and current added tests
// are checked before the immutable historical workflow contract is evaluated.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex');
const added='          node --test scripts/source252-production-role-order-tests.mjs scripts/current310-production-role-order-tests.mjs scripts/production-forward-current310-311-tests.mjs\n';
export function restoreCurrentFoundationProof(source){
 assert.equal(sha(source),'50ff473e92806741673452014374bfc4b84623ae03dcb09e25d8e3417e7ff774');
 for(const[from,to]of [
  ['edf046bfee522838fc0d4a48fef82862865debf705e3d96a4d04e89d29506bcc  package.json','1332a6e1176035f18e283667472e107f57c681da203684c0ba8417158e8423af  package.json'],
  ['6437d19f892910fda47da67c7a85a0ac9cbdf80a06955f481f46e32f6a19b37e  scripts/legacy-activation-http-tests.mjs','d8ad584e8dd3adf8be9aa04bf7287fb45ed8805f7d771c814183cc781e8e2149  scripts/legacy-activation-http-tests.mjs'],
  [added,''],
 ]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
 assert.equal(sha(source),'32e24c53b37eecb323211588778af80594fdc504b8fbeaa43ff7a56b58298636');return source;
}
export function currentFoundationReviewedRegressionView(source){
 // The added current suites are executed and hash-bound above. This one view
 // keeps today's seven input pins for the older dedicated-step mutation tests.
 restoreCurrentFoundationProof(source);assert.equal(source.split(added).length,2);
 return source.replace(added,'');
}
export function restoreCurrentRepairWorkflowProof(source){
 assert.equal(sha(source),'2eab0ed3a7b838b3fa592332cb7738034643b41e2b5048952e3ecce7954c1ea7');
 for(const[from,to]of [
  ['edf046bfee522838fc0d4a48fef82862865debf705e3d96a4d04e89d29506bcc  package.json','1332a6e1176035f18e283667472e107f57c681da203684c0ba8417158e8423af  package.json'],
  ['6437d19f892910fda47da67c7a85a0ac9cbdf80a06955f481f46e32f6a19b37e  scripts/legacy-activation-http-tests.mjs','d8ad584e8dd3adf8be9aa04bf7287fb45ed8805f7d771c814183cc781e8e2149  scripts/legacy-activation-http-tests.mjs'],
 ]){assert.equal(source.split(from).length,2);source=source.replace(from,to);}
 assert.equal(sha(source),'6f70812189d0bd11a45f7888cd8fdc673aaf493a0c40d2725b77d721096d03e3');return source;
}
export function restoreCurrentBuild52WorkflowProof(source){
 assert.equal(sha(source),'aa9c40e0300f759539e2950a53f9cad1b2fc7f973dc284c34c6b2e2d43998a46');
 const addition='            ${{ runner.temp }}/build52-production-migration-refusal.json\n';
 assert.equal(source.split(addition).length,2);source=source.replace(addition,'');
 assert.equal(sha(source),'6f6f498a29f0cf189123050b7dda63feada17c9fed49fe208281390a0fbd0a05');return source;
}
export function verifyCurrentFoundationSource(root){
 const current=readFileSync(resolve(root,'.github/workflows/foundation-security-gate.yml'),'utf8');
 const historical=restoreCurrentFoundationProof(current);let rejected=0;
 for(const mutation of [current+'\n',current.replace(added,''),current.replace(added,added+added),current.replace('node --test','node --test || true')]){assert.throws(()=>restoreCurrentFoundationProof(mutation));rejected++;}
 const block=current.split("<<'REVIEWED_INPUTS'\n")[1].split('          REVIEWED_INPUTS')[0];
 const bound=[...block.matchAll(/^          ([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/gm)];assert.equal(bound.length,7);
 for(const[,digest,path]of bound)assert.equal(sha(readFileSync(resolve(root,path))),digest,'current Foundation reviewed input '+path);
 const tests={
  'scripts/source252-production-role-order-tests.mjs':'c9e2b2dd4d61afefe08a2bfa7f1cf91ab9c4dda0f33ce1922fd5e479c325b40e',
  'scripts/current310-production-role-order-tests.mjs':'bf6d7f081a366b20ebdbaa314ceb514ac3335fe896d6888c877139ebbc117b06',
  'scripts/production-forward-current310-311-tests.mjs':'85d04cf8742dd5f0e9c17a30ec8a3b23326ac4718d2e26c88f5196429b3068df',
 };
 for(const[path,digest]of Object.entries(tests))assert.equal(sha(readFileSync(resolve(root,path))),digest);
 const result=spawnSync(process.execPath,['--test',...Object.keys(tests)],{cwd:root,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
 console.log(JSON.stringify({suite:'current-foundation-source-successor',status:'PASS',current_bound_inputs:7,current_source_suites:3,rejected,SQL_executed:false,build:false,runtime_admission:false}));
 return historical;
}
