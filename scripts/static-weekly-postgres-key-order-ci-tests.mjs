// Explicit invocation: importing the reusable test module alone is not proof.
import assert from 'node:assert/strict';
import {runStaticWeeklyPostgresKeyOrderTests} from './static-weekly-postgres-key-order-tests.mjs';
const receipt = runStaticWeeklyPostgresKeyOrderTests();
assert.equal(receipt.status, 'PASS_PURE_BYTE_EQUIVALENCE_ONLY');
assert.equal(receipt.checks, 167);
for (const field of ['solver', 'preview', 'publication', 'production']) assert.equal(receipt[field], false);
console.log(JSON.stringify(receipt));
