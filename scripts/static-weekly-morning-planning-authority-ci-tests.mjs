import assert from 'node:assert/strict';
import {runMorningPlanningAuthorityTests} from './static-weekly-morning-planning-authority-tests.mjs';

// The source module's CLI is guarded; import alone does not execute its tests.
const receipt=runMorningPlanningAuthorityTests();
assert.equal(receipt.status,'PASS');
assert.equal(receipt.checks,132);
assert.equal(receipt.solverExecuted,false);
assert.equal(receipt.fullRecordClosed,false);
for(const key of ['descriptorDigest','sourceDigest','ownerConfigDigest'])
  assert.match(receipt[key],/^[a-f0-9]{64}$/);
console.log(JSON.stringify(receipt));
