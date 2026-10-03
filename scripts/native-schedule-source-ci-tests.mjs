// Mandatory executed consumer proof; no SQL, clock or delivery qualification.
import assert from 'node:assert/strict';
import {runNativeScheduleOccurrenceTests} from './native-schedule-occurrence-tests.mjs';

const receipt=await runNativeScheduleOccurrenceTests();
assert.equal(receipt.status,'PASS');
assert.equal(receipt.checks,352);
assert.equal(receipt.original_checks,213);
assert.equal(receipt.dated_checks,139);
assert.equal(receipt.sql_executed,false);
assert.equal(receipt.solver_executed,false);
assert.equal(receipt.delivery_admitted,false);
console.log(JSON.stringify({suite:'native-schedule-source-called',...receipt}));
