// Execute the three exact pure/mocked boundaries in fresh module state.
// No engine, database, publication, or runtime registration is exercised here.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cases = [
  ['static-weekly-recurring-correction-binding-tests.mjs', 28],
  ['static-weekly-recurring-dual-source-contract-tests.mjs', 26],
  ['static-weekly-recurring-correction-control-plane-tests.mjs', 9],
];
const receipts = [];
for (const [name, expected] of cases) {
  const output = execFileSync(process.execPath,
    [fileURLToPath(new URL('./' + name, import.meta.url))],
    {encoding:'utf8', timeout:45000, maxBuffer:1024*1024,
      env:{PATH:process.env.PATH, LANG:'C.UTF-8'}});
  process.stdout.write(output);
  const receipt = JSON.parse(output.trim().split('\n').at(-1));
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.checks, expected);
  receipts.push({name, checks:receipt.checks});
}
assert.deepEqual(receipts.map(row=>row.checks), [28,26,9]);
console.log(JSON.stringify({suite:'recurring-correction-called-ci', status:'PASS',
  checks:63, receipts, solver:false, sql:false, publication:false,
  production:false, sourceRegistration:false}));
