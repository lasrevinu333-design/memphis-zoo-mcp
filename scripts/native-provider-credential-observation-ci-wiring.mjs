import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const statement="await import('./native-provider-credential-observation-ci-tests.mjs');";
const wrapper="import assert from 'node:assert/strict';\nimport {runCredentialObservationContractTests} from './native-provider-credential-observation-contract-tests.mjs';\nconst receipt=await runCredentialObservationContractTests();\nassert.equal(receipt.checks,199);\nassert.equal(receipt.sqlChecks,25);\nconsole.log(JSON.stringify({suite:'native-credential-observation-source',status:'PASS',...receipt,sql_executed:false,mounted:false}));\n";
const pins={
 'src/auth/device-credential-auth.js':'6421105294f101041bdaaab2a6c2597107e87df9d099c1d656d446b64f5af1ea',
 'src/native-provider-credential-observation.js':'b55bb76b0a8c8f37575ae301de2635b740737a567be6cc761912349e9d7765a9',
 'scripts/native-provider-credential-observation-contract-tests.mjs':'57150e432d57256a2852cabe7312959408e72b4ae1d5ed3d6ff2add0cd7badfa',
 'scripts/native-provider-credential-observation-sql-contract-tests.mjs':'be08e31c25bf32c5608fbffbd5a639557e9a36b6ab2d6f0416e4e62e4af64bb7',
 'scripts/fixtures/native-provider-credential-observation-proposal.sql':'4eaf3682a4cd0b65a5d4cd506dfb3fed902d14e275e923117946b2e055d54827',
};
function validate(source,actual,files){
 const lines=source.split('\n');
 assert.equal(lines.filter(x=>x===statement).length,1);
 assert.equal(lines.filter(x=>/^await import\(/.test(x)).length,53);
 const prior=lines.filter(x=>x!==statement).join('\n').replace('53 explicit owning suites','52 explicit owning suites');
 assert.equal(sha(prior),'a448263c9903794a1b8779c7fa8d4b56033cd31f3fc4b3637699551003000f91','exact prior52 retained');
 assert.equal(actual,wrapper,'entry must actually await all199+25 checks');
 assert.deepEqual(Object.keys(files).sort(),Object.keys(pins).sort());
 for(const[p,pin]of Object.entries(pins))assert.equal(sha(files[p]),pin,p);
 return prior;
}
export function verifyCredentialObservationWiring(source,root){
 const actual=readFileSync(resolve(root,'scripts/native-provider-credential-observation-ci-tests.mjs'),'utf8');
 const files=Object.fromEntries(Object.keys(pins).map(p=>[p,readFileSync(resolve(root,p),'utf8')]));
 const prior=validate(source,actual,files);let hostile=0;
 for(const replacement of ['', '// '+statement,statement+'\n'+statement,'if(false){'+statement+'}',statement.replace('await ',''),statement.replace(');',').catch(()=>{});')]){
  assert.throws(()=>validate(source.replace(statement,replacement),actual,files));hostile++;
 }
 for(const[from,to]of [['await runCredentialObservationContractTests()','{}'],['receipt.checks,199','receipt.checks,0'],['receipt.sqlChecks,25','receipt.sqlChecks,0'],['sql_executed:false','sql_executed:true']]){
  assert.throws(()=>validate(source,actual.replace(from,to),files));hostile++;
 }
 for(const p of Object.keys(files)){assert.throws(()=>validate(source,actual,{...files,[p]:files[p]+'\n// unbound\n'}));hostile++;}
 assert.equal(hostile,15);
 console.log('Native credential observation wiring PASS: 15 omission/execution/source mutants rejected; prior52 guards preserved');
 return prior;
}
