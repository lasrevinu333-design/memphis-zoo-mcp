import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const statement="await import('./static-weekly-manager-ingress-ci-tests.mjs');";
const pins={
 'scripts/static-weekly-manager-operation-tests.mjs':'a58c6096ac1e6f98e8f1e72630435ca31bc644543eb5da06d38d3d732628895d',
 'scripts/static-weekly-manager-auth-deadline-tests.mjs':'8f1975218389748f47d1d8b53317ae94b655e48bca83fabfacaa1f9df3288261',
 'scripts/static-weekly-manager-ingress-http-tests.mjs':'dba72d59fa4bdd88baa7e75721585169fdeab9a9f37245ecf4bd98934617466f',
 'scripts/restore-mutation-gate-tests.mjs':'28c3a7872707b3281418e93060daae429c218fe3d12ac93438de399b2abe7bef',
 'scripts/static-weekly-control-plane-runtime-tests.mjs':'108474bcee79ed64fff0c6f5980493006d8b6c34308f89ed30a058ead8afe8f1',
 'scripts/bounded-node-proof.mjs':'fc0443523fa3d0a79c053ead70120126e17b5ca59d2170fba8103cf9006dd7a6',
};
const wrapperPin='ffa89c188df9d8c74e94d3ebcdeeb5ff8db8a8ac3ece9271baa32d28d4bdd1bf';
function validate(source,wrapper,files){
 const lines=source.split('\n');assert.equal(lines.filter(x=>x===statement).length,1);
 assert.equal(lines.filter(x=>/^await import\(/.test(x)).length,54);
 const prior=lines.filter(x=>x!==statement).join('\n').replace('54 explicit owning suites','53 explicit owning suites');
 assert.equal(sha(prior),'6ba0bd6bccd20352870bd0a59446ef5c6d0ce1c549d2b91a6fea62fd4629bd73','all prior53 owning entries preserved');
 assert.equal(sha(wrapper),wrapperPin,'exact five called children, receipts and shared60s origin');
 assert.deepEqual(Object.keys(files).sort(),Object.keys(pins).sort());
 for(const[p,pin]of Object.entries(pins))assert.equal(sha(files[p]),pin,p);
 return prior;
}
export function verifyManagerIngressWiring(source,root){
 const wrapper=readFileSync(resolve(root,'scripts/static-weekly-manager-ingress-ci-tests.mjs'),'utf8');
 const files=Object.fromEntries(Object.keys(pins).map(p=>[p,readFileSync(resolve(root,p),'utf8')]));
 const prior=validate(source,wrapper,files);let hostile=0;
 for(const replacement of ['', '// '+statement,statement+'\n'+statement,'if(false){'+statement+'}',statement.replace('await ',''),statement.replace(');',').catch(()=>{});')]){
  assert.throws(()=>validate(source.replace(statement,replacement),wrapper,files));hostile++;
 }
 for(const[from,to]of [['deadline=origin+60000','deadline=origin+600000'],['deadline-performance.now()','60000'],['await runBoundedNodeProof','runBoundedNodeProof'],['assert.equal(proof.checks,expected)','assert.ok(true)'],['entries:5','entries:0'],['managerE2E:false','managerE2E:true']]){
  const changed=wrapper.replace(from,to);assert.notEqual(changed,wrapper);assert.throws(()=>validate(source,changed,files));hostile++;
 }
 for(const p of Object.keys(files)){assert.throws(()=>validate(source,wrapper,{...files,[p]:files[p]+'\n// unbound\n'}));hostile++;}
 assert.equal(hostile,18);console.log('Manager ingress called wiring PASS:18 omission/receipt/deadline/source mutants; exact prior53 retained');return prior;
}
