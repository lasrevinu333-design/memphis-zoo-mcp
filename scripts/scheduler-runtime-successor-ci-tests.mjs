import assert from 'node:assert/strict';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
const result=await runBoundedNodeProof({args:['--max-old-space-size=256','--wasm-max-mem-pages=1536','--max-semi-space-size=4','scripts/scheduler-runtime-successor-tests.mjs'],maxBuffer:2*1024*1024});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1));
assert.equal(receipt.status,'PASS');assert.deepEqual(receipt.results.map(r=>r.name),['canonical','integer-load','coverage','postgres-order','phase-identity','preparation']);
assert.equal(receipt.originalCombinedReductionSeparateAndUnchanged,true);
for(const field of ['SQL','app_build','phone'])assert.equal(receipt[field],false);
assert.equal(result.receipt.groupAbsent,true);
