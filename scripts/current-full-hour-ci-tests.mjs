// Current algorithms and current full-hour policy execute in an owned process.
// The native template suite installs a process-local hash accelerator once.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await runBoundedNodeProof({args:['--max-old-space-size=128','--max-semi-space-size=8','scripts/static-weekly-full-hour-lunch-tests.mjs'],cwd:root,absoluteMilliseconds:60000,cleanupReserveMilliseconds:5000,maxBuffer:1024*1024});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);
const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1));
assert.deepEqual(receipt,{status:'PASS',realCompilerAndVerifier:true,loans:4,segments:10,originalBoundaryRetained:true,wholeLunchWindow:true,exactPrintedHelpers:true,currentnessAndEligibilityRefusals:4,malformedSourceRefusals:2,changedRosterRefused:true,legacyContractPreserved:true,publication:false});
assert.equal(result.receipt.groupAbsent,true);
console.log(JSON.stringify({suite:'current-full-hour-policy-called',...receipt,owned_process_closed:true,SQL:false,build:false,phone:false}));

await import('./scheduler-runtime-successor-ci-tests.mjs');
