// Mandatory local source proof; not runtime recurring admission or publication.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runStaticWeeklyRecurringPhaseAuthorityTests} from './static-weekly-recurring-phase-authority-tests.mjs';

const receipt = runStaticWeeklyRecurringPhaseAuthorityTests();
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.checks, 55);
assert.equal(receipt.currentPreservationHardRows, 644);
assert.deepEqual(receipt.cases.map(x => x.minimumDoubledSpread), [0, 1, 4, 2, 1]);
for (const key of ['solver', 'worker', 'sql', 'publication']) assert.equal(receipt[key], false);

// This export actually invokes the pinned solver for the three normal-pattern
// reference regressions; importing its main-guarded file alone is insufficient.
const output = execFileSync(process.execPath, ['--max-old-space-size=256',
  '--wasm-max-mem-pages=1536', '--max-semi-space-size=4',
  fileURLToPath(new URL('./static-weekly-recurring-phase-authority-tests.mjs', import.meta.url)),
  '--admin-morning'], {encoding:'utf8',timeout:60000,maxBuffer:1024*1024,
  env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
const admin = JSON.parse(output.trim().split('\n').at(-1));
process.stdout.write(output);
assert.equal(admin.status, 'PASS');
assert.equal(admin.checks, 129);
assert.deepEqual(admin.results.map(x => x.count), [6, 7, 8]);
for (const result of admin.results) {
  assert.equal(result.secondaryPreferenceBindings.length, 14);
  assert.equal(result.admitted, false);
  assert.equal(result.published, false);
}
for (const key of ['worker', 'sql', 'publication']) assert.equal(admin[key], false);
