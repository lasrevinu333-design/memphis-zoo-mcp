// Called actual synthetic canonical proof. No staffing IPC/SQL/provider claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const output=execFileSync(process.execPath,['--max-old-space-size=128',
  '--max-semi-space-size=8','--wasm-max-mem-pages=1536','--stack-size=4096',
  fileURLToPath(new URL('./static-weekly-lunch-fused-seed-construction-tests.mjs',import.meta.url)),
  '--canonical-four'],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
const receipt=JSON.parse(output.trim().split('\n').at(-1));
assert.equal(receipt.classification,'BOUNDED_SYNTHETIC_CANONICAL_FOUR_PROOF');
assert.equal(receipt.checks,35);
assert.equal(receipt.pureChecks,114);
assert.equal(receipt.actualCanonicalTiers,21);
assert.deepEqual(receipt.observedDefaultCounts,{verifierCalls:2,terminalCalls:42,derivations:2});
assert.equal(receipt.fixtureProducerSha256,'8025947cf18698bb97288fbd2eb9c08f6d0908f9d602bdcc57de52fc0c6803e0');
for(const field of ['independentlyProvesOptimality','actualStaffingRuntimeAcceptance','timingBenefitEstablished'])
  assert.equal(receipt[field],false);
assert.equal(receipt.sqlRuns,0);
assert.equal(receipt.productionWrites,0);
process.stdout.write(output);
