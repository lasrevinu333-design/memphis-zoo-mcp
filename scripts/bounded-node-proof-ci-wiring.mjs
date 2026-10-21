import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const pins={
 'scripts/bounded-node-proof.mjs':'fc0443523fa3d0a79c053ead70120126e17b5ca59d2170fba8103cf9006dd7a6',
 'scripts/bounded-node-proof-tests.mjs':'d70644f4e3453b6588fc14dde91acf33f5a7e294a9f361332049c199b09afea6',
 'scripts/static-weekly-recurring-phase-authority-ci-tests.mjs':'2547fee983a0e4cc0b5fa232e8eea075269f5c870fc117789136eec0cf59167b',
 'scripts/static-weekly-recurring-morning-solver-ci-tests.mjs':'3e03f22aae5fe316d6eb11c1e9e80ba6ef324e4ee45c0c86d506e197f679c839',
};
function validate(files){
 assert.deepEqual(Object.keys(files).sort(),Object.keys(pins).sort());
 for(const[p,h]of Object.entries(pins))assert.equal(sha(files[p]),h,p);
 const phase=files['scripts/static-weekly-recurring-phase-authority-ci-tests.mjs'];
 const morning=files['scripts/static-weekly-recurring-morning-solver-ci-tests.mjs'];
 assert.equal(phase.split('\n').filter(l=>l==="await import('./bounded-node-proof-tests.mjs');").length,1);
 assert.equal((phase.match(/await runBoundedNodeProof\(/g)||[]).length,4);
 assert.equal((morning.match(/await runBoundedNodeProof\(/g)||[]).length,1);
 for(const entry of ["run([])","run(['--engine'])","run(['--current-day'])"])assert(morning.includes('await '+entry));
 for(const text of [phase,morning]){
  assert(!text.includes('execFileSync'));
  assert(!/timeout:\s*(?:90000|900000)/.test(text));
  for(const flag of ['--max-old-space-size=256','--wasm-max-mem-pages=1536','--max-semi-space-size=4'])assert(text.includes(flag));
 }
 assert(phase.includes("assert.deepEqual(reduction.counts, [6, 7, 8]);"));
 assert(phase.includes("assert.equal(reduction.checks, 30);"));
}
export function verifyBoundedProofWiring(root){
 const files=Object.fromEntries(Object.keys(pins).map(p=>[p,readFileSync(resolve(root,p),'utf8')]));
 validate(files);let rejected=0;
 for(const p of Object.keys(pins)){assert.throws(()=>validate({...files,[p]:files[p]+'\n// unbound\n'}));rejected++;}
 for(const [p,from,to]of [
  ['scripts/bounded-node-proof.mjs','absoluteMilliseconds=60000','absoluteMilliseconds=900000'],
  ['scripts/static-weekly-recurring-phase-authority-ci-tests.mjs',"await import('./bounded-node-proof-tests.mjs');",''],
  ['scripts/static-weekly-recurring-phase-authority-ci-tests.mjs','assert.equal(reduction.checks, 30);',''],
  ['scripts/static-weekly-recurring-morning-solver-ci-tests.mjs',"const day=await run(['--current-day']);","const day={status:'PASS'};"],
 ]){assert(files[p].includes(from));assert.throws(()=>validate({...files,[p]:files[p].replace(from,to)}));rejected++;}
 assert.equal(rejected,8);
 console.log('Bounded CI proof wiring PASS: 8 execution/guard/source mutants rejected; all original solver assertions and resource flags retained');
}
