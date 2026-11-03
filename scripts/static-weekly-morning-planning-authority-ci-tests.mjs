import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// This owning suite installs the once-only accelerator. Run its guarded CLI
// in isolated module state, just like the adjacent morning-solver CI wrapper.
// The parent aggregate may already have installed its own accelerator; never
// relax the product guard or skip this suite's independent validation.
const output=execFileSync(process.execPath,['--max-old-space-size=256',
  '--wasm-max-mem-pages=1536','--max-semi-space-size=4',
  fileURLToPath(new URL('./static-weekly-morning-planning-authority-tests.mjs',import.meta.url))],
  {encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
    env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
process.stdout.write(output);
const receipt=JSON.parse(output.trim().split('\n').at(-1));
assert.equal(receipt.status,'PASS');
assert.equal(receipt.checks,132);
assert.equal(receipt.solverExecuted,false);
assert.equal(receipt.fullRecordClosed,false);
for(const key of ['descriptorDigest','sourceDigest','ownerConfigDigest'])
  assert.match(receipt[key],/^[a-f0-9]{64}$/);
console.log(JSON.stringify(receipt));
