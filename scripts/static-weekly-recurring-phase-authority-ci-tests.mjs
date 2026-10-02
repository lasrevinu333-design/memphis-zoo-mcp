// Mandatory local source proof; not runtime recurring admission or publication.
import assert from 'node:assert/strict';
import {runStaticWeeklyRecurringPhaseAuthorityTests} from './static-weekly-recurring-phase-authority-tests.mjs';

const receipt = runStaticWeeklyRecurringPhaseAuthorityTests();
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.checks, 52);
assert.equal(receipt.currentPreservationHardRows, 644);
assert.deepEqual(receipt.cases.map(x => x.minimumDoubledSpread), [0, 1, 4, 2, 1]);
for (const key of ['solver', 'worker', 'sql', 'publication']) assert.equal(receipt[key], false);
