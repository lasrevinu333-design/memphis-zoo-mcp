import {restoreBoundedFailureOutputSource} from './bounded-node-proof-diagnostics-source.mjs';
// Strict Source representation proof for the ordered aggregate isolation seam.
// Returns the exact historical55 Source image ONLY after validating the current
// two-child topology/helper/unchanged owning wrappers; never executes oldSource.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const prefix="import {runFreshCurrentOwningEntry} from './current-system-fresh-owning-entry.mjs';\n";
const targets=["static-weekly-fixed-rank-link-ci-tests.mjs", "static-weekly-manager-ingress-ci-tests.mjs"];
const bindings={"static-weekly-fixed-rank-link-ci-tests.mjs": "3e883e83c6b2844b5b337905f2e163b31c5c0c0e07bd7db02b867dad6a97fe5d", "static-weekly-manager-ingress-ci-tests.mjs": "fa5c30d628cc15c1543eb87d057b055df2475450fee388a1c04ebfeda43a78e1", "bounded-node-proof.mjs": "fc0443523fa3d0a79c053ead70120126e17b5ca59d2170fba8103cf9006dd7a6"};
export function restoreFreshCurrentOwningSource(source){
 assert.equal(sha(source),'816c3ebc70a98f385b7882cdf8ba229e2ade1d51ad818ec242c67da4a6b8f6e5','exact changed aggregate owning Source required');
 assert.equal(source.split(prefix).length,2);let prior=source.replace(prefix,'');
 for(const file of targets){
  const changed=`await runFreshCurrentOwningEntry('${file}');`;
  assert.equal(prior.split(changed).length,2);prior=prior.replace(changed,`await import('./${file}');`);
 }
 assert.equal(sha(prior),'0093b877d7134a98451baee1b4bb5484f6e83798069beb5a4010617a57761220','exact original55 import order/terminal required');return prior;
}
export function verifyFreshCurrentOwningWiring(root){
 const source=readFileSync(resolve(root,'scripts/current-system-source-contract-tests.mjs'),'utf8');
 const helper=readFileSync(resolve(root,'scripts/current-system-fresh-owning-entry.mjs'),'utf8');
 assert.equal(sha(helper),'af39c434b16a775c4866557696801875243de305e4e6af260e11a43bd3e45cb1','same finite one-use existing lifecycle helper/60s/5s/abort cleanup required');
 for(const[file,digest]of Object.entries(bindings)){const current=readFileSync(resolve(root,'scripts',file),'utf8');assert.equal(sha(file==='bounded-node-proof.mjs'?restoreBoundedFailureOutputSource(current,file):current),digest,file);}
 const prior=restoreFreshCurrentOwningSource(source);let mutants=0;
 for(const current of [source+'\n// drift\n',source.replace(prefix,''),source.replace(prefix,prefix+prefix),
  ...targets.flatMap(file=>{const line=`await runFreshCurrentOwningEntry('${file}');`;return[source.replace(line,''),source.replace(line,line+'\n'+line),source.replace(line,`void runFreshCurrentOwningEntry('${file}');`),source.replace(line,`await import('./${file}');`)];})]){
  assert.notEqual(current,source);assert.throws(()=>restoreFreshCurrentOwningSource(current));mutants++;
 }
 assert.equal(mutants,11);
 console.log('Fresh aggregate owning-entry wiring PASS:11 omission/duplicate/await/isolation/source mutants; exact original55 order retained');return prior;
}
