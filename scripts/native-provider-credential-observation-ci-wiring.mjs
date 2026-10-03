import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const statement="await import('./native-provider-credential-observation-ci-tests.mjs');";
const wrapper="import assert from 'node:assert/strict';\nimport {runCredentialObservationContractTests} from './native-provider-credential-observation-contract-tests.mjs';\nconst receipt=await runCredentialObservationContractTests();\nassert.equal(receipt.checks,199);\nassert.equal(receipt.sqlChecks,25);\nassert.equal(receipt.http.checks,106);\nassert.equal(receipt.http.loopback_http,true);\nassert.equal(receipt.http.listener_closed,true);\nassert.equal(receipt.http.remaining_sockets,0);\nassert.equal(receipt.http.sql_executed,false);\nassert.equal(receipt.http.production_mount,false);\nassert.ok(receipt.http.elapsed_ms<30000);\nconsole.log(JSON.stringify({suite:'native-credential-observation-source',status:'PASS',...receipt,sql_executed:false,mounted:false}));\n";
const pins={
 'src/auth/device-credential-auth.js':'6421105294f101041bdaaab2a6c2597107e87df9d099c1d656d446b64f5af1ea',
 'src/native-provider-credential-observation.js':'b55bb76b0a8c8f37575ae301de2635b740737a567be6cc761912349e9d7765a9',
 'scripts/native-provider-credential-observation-contract-tests.mjs':'7bb0a6e3f317ea3b6323255c977bf4ecc1e1e2c384eb0e7a14648fed257f15e1',
 'scripts/native-provider-credential-observation-http-tests.mjs':'45def6ce31288cdef5222f041705661cffded749d8c9d9c82beeb68613135551',
 'src/request-json-parser.js':'c7d44c3795c3642246fb7db8090958842bbb3de8ce9406b05a5849cf30993689',
 'src/native-provider-api.js':'d330398f959ca4c5682ca6195152b9d0d82d72704fc853af8fe5c3361e93b1e6',
 'scripts/native-provider-credential-observation-sql-contract-tests.mjs':'be08e31c25bf32c5608fbffbd5a639557e9a36b6ab2d6f0416e4e62e4af64bb7',
 'scripts/fixtures/native-provider-credential-observation-proposal.sql':'4eaf3682a4cd0b65a5d4cd506dfb3fed902d14e275e923117946b2e055d54827',
};
function validate(source,actual,files){
 const lines=source.split('\n');
 assert.equal(lines.filter(x=>x===statement).length,1);
 assert.equal(lines.filter(x=>/^await import\(/.test(x)).length,53);
 const prior=lines.filter(x=>x!==statement).join('\n').replace('53 explicit owning suites','52 explicit owning suites');
 assert.equal(sha(prior),'a448263c9903794a1b8779c7fa8d4b56033cd31f3fc4b3637699551003000f91','exact prior52 retained');
 assert.equal(actual,wrapper,'entry must actually await all199+25+106 checks and exact listener cleanup');
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
 for(const[from,to]of [['await runCredentialObservationContractTests()','{}'],['receipt.checks,199','receipt.checks,0'],['receipt.sqlChecks,25','receipt.sqlChecks,0'],['receipt.http.checks,106','receipt.http.checks,0'],['receipt.http.loopback_http,true','receipt.http.loopback_http,false'],['receipt.http.listener_closed,true','receipt.http.listener_closed,false'],['receipt.http.remaining_sockets,0','receipt.http.remaining_sockets,1'],['receipt.http.sql_executed,false','receipt.http.sql_executed,true'],['receipt.http.production_mount,false','receipt.http.production_mount,true'],['receipt.http.elapsed_ms<30000','true']]){
  assert.throws(()=>validate(source,actual.replace(from,to),files));hostile++;
 }
 for(const p of Object.keys(files)){assert.throws(()=>validate(source,actual,{...files,[p]:files[p]+'\n// unbound\n'}));hostile++;}
 assert.equal(hostile,24);
 console.log('Native credential observation wiring PASS: 24 omission/execution/cleanup/source mutants rejected; prior52 guards preserved');
 return prior;
}
