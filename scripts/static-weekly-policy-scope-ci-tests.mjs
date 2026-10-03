// Mandatory owning lane: importing the helper alone is not execution.
import assert from 'node:assert/strict';
import {runStaticWeeklyPolicyScopeContractTests} from './static-weekly-policy-scope-contract-tests.mjs';

const receipt = runStaticWeeklyPolicyScopeContractTests();
assert.equal(receipt.status, 'PASS');
assert.equal(receipt.checks, 57);
assert.equal(receipt.generations, 2);
assert.equal(receipt.fixtureSha256, '197d8eb0078f2bc9acb3cfb667c64874c8e41944f600bbaa026675d4594e9dfc');
assert.equal(receipt.sourcePins['src/static-weekly-schedule-program.js'],
  '885825644a37ae8e601e1639d987d0016d61d9a1beff49e6e0340342391f1186');
assert.equal(receipt.currentSourcePins['src/static-weekly-schedule-program.js'],
  '619fee19eb136aaddc46ec1be15acc4be5bf7b853267aa60bfe5675d726dcddf');
assert.equal(receipt.currentSourcePins['src/static-weekly-schedule-model.js'],
  '23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e');
assert.equal(receipt.independentlyProvesOptimality, false);
for (const key of ['solver', 'worker', 'sql', 'publication']) assert.equal(receipt[key], false);
