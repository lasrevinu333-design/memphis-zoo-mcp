// Mandatory isolated pure representation proof. Importing a main-guarded test
// alone is not execution; run the exact owning CLI in fresh Node module state.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const output = execFileSync(process.execPath, ['--max-old-space-size=128',
  '--max-semi-space-size=8', '--wasm-max-mem-pages=1536', '--stack-size=4096',
  fileURLToPath(new URL('./static-weekly-digest-stream-tests.mjs', import.meta.url))],
  {encoding:'utf8',timeout:60000,maxBuffer:1024*1024,
    env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
process.stdout.write(output);
const receipt = JSON.parse(output.trim().split('\n').at(-1));
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.checks, 1009);
assert.equal(receipt.isolatedProcesses, true);
assert.deepEqual(receipt.results.map(result=>result.mode), ['portable','string-only','invalid','native','allocation']);
assert.deepEqual(receipt.results.map(result=>result.checks), [245,245,258,251,10]);
for (const proof of [receipt,...receipt.results]) {
  for (const field of ['solver','publication']) assert.equal(proof[field], false);
}
console.log(JSON.stringify({suite:'canonical-digest-stream-called-ci',passed:true,
  checks:receipt.checks,solver:false,sql:false,publication:false,production:false}));
