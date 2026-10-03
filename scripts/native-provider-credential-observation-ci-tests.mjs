import assert from 'node:assert/strict';
import {runCredentialObservationContractTests} from './native-provider-credential-observation-contract-tests.mjs';
const receipt=await runCredentialObservationContractTests();
assert.equal(receipt.checks,199);
assert.equal(receipt.sqlChecks,25);
console.log(JSON.stringify({suite:'native-credential-observation-source',status:'PASS',...receipt,sql_executed:false,mounted:false}));
