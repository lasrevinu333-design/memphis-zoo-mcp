import assert from 'node:assert/strict';
import {runRecurringIdentityUnitContractTests} from './static-weekly-recurring-phase-authority-tests.mjs';

// Call the owning exports, not their CLI main guards. This portable algebra
// proof is separate from the exact retained-tier and complete 6/7/8 solves.
const result = await runRecurringIdentityUnitContractTests();
assert.deepEqual(result, {pure:52, typed:9, solver:false});
console.log(JSON.stringify({status:'PASS', checks:61,
  suite:'recurring-identity-unit-called-contract', solver:false,
  privateIpc:false, sql:false, publication:false}));
