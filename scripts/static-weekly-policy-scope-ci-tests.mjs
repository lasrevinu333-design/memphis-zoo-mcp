// Mandatory owning lane: importing the helper alone is not execution.
import assert from 'node:assert/strict';
import {runStaticWeeklyPolicyScopeContractTests} from './static-weekly-policy-scope-contract-tests.mjs';

const receipt = runStaticWeeklyPolicyScopeContractTests();
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.checks, 57);
assert.equal(receipt.generations, 2);
assert.equal(receipt.fixtureSha256, '197d8eb0078f2bc9acb3cfb667c64874c8e41944f600bbaa026675d4594e9dfc');
assert.equal(receipt.independentlyProvesOptimality, false);
for (const key of ['solver', 'worker', 'sql', 'publication']) assert.equal(receipt[key], false);
