import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const statement="await import('./static-weekly-manager-ingress-ci-tests.mjs');";
const pins={
 'scripts/static-weekly-manager-operation-tests.mjs':'a58c6096ac1e6f98e8f1e72630435ca31bc644543eb5da06d38d3d732628895d',
 'scripts/static-weekly-manager-auth-deadline-tests.mjs':'8f1975218389748f47d1d8b53317ae94b655e48bca83fabfacaa1f9df3288261',
 'scripts/static-weekly-manager-ingress-http-tests.mjs':'b6ce7cc8876ba6bbc403e3cb931af4881a4fd557ccf63ae5179e718a8a62d38a',
 'scripts/restore-mutation-gate-tests.mjs':'b70a07230f37968699a4eeaa1e43ab115b5a05439898390a46418263ea78b993',
 'scripts/static-weekly-control-plane-runtime-tests.mjs':'c57ed5068694eea7e9da9c5ea58ba425e9a84a34761c221a24024e4fecbc3c91',
 'scripts/static-weekly-recurring-operation-owner-tests.mjs':'af1a6223804c83650e538de749b2254b2517fc63cee2438957d83177f0adff5c',
 'scripts/static-weekly-recurring-operation-child-tests.mjs':'a9664a1daf527d8cbd657064b144eaaeaaea4fb95ae474244059ba63308d2576',
 'scripts/static-weekly-recurring-operation-handler-tests.mjs':'1598500497210ee0a62ba8e88c0bcc2d7022b4ebb554233e5eb4da8006d799e8',
 'scripts/static-weekly-recurring-shared-admission-tests.mjs':'01c4cccc502c1bf82d12c1088d89c89787ac2f8374eee49a2758efb104101d0e',
 'scripts/static-weekly-recurring-owned-http-tests.mjs':'4cf3794d4328109ab43cf3449db1e4e3f55b8156e0473584ef8b3ad0fadd1368',
 'scripts/bounded-node-proof.mjs':'fc0443523fa3d0a79c053ead70120126e17b5ca59d2170fba8103cf9006dd7a6',
};
const wrapperPin='72c52edcf3e50300d3c1c9e512f813d33e576fba8f184ca6eb2ff2fee33e0054';
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
 for(const[from,to]of [
  ['const origin=0','const origin=performance.now()'],
  ['deadline=origin+60000','deadline=origin+600000'],
  ['Math.floor(deadline-performance.now())-1000','60000'],
  ['cleanupReserveMilliseconds:5000','cleanupReserveMilliseconds:1'],
  ['await runBoundedNodeProof','runBoundedNodeProof'],
  ['assert.equal(proof.checks,expected)','assert.ok(true)'],
  ['assert.equal(receipts.length,10)','assert.equal(receipts.length,5)'],
  ['entries:10','entries:5'],
  ['managerE2E:false','managerE2E:true'],
 ]){
  const changed=wrapper.replace(from,to);assert.notEqual(changed,wrapper);assert.throws(()=>validate(source,changed,files));hostile++;
 }
 for(const p of Object.keys(files)){assert.throws(()=>validate(source,wrapper,{...files,[p]:files[p]+'\n// unbound\n'}));hostile++;}
 assert.equal(hostile,26);console.log('Manager ingress called wiring PASS:26 omission/receipt/deadline/source mutants; exact prior53 retained');return prior;
}
