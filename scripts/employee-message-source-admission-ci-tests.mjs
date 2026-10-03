// Mandatory called source proof; importing an export-only test is not execution.
import assert from 'node:assert/strict';
import {runEmployeeMessageSourceAdmissionTests,runEmployeeMessageMigrationSourceTests}
  from './employee-message-source-admission-tests.mjs';

const dispatcher=await runEmployeeMessageSourceAdmissionTests();
assert.equal(dispatcher.status,'PASS');
assert.equal(dispatcher.checks,256);
const migration=await runEmployeeMessageMigrationSourceTests();
assert.equal(migration.status,'PASS');
assert.equal(migration.checks,38);
assert.equal(migration.predecessor_checks.status,'PASS');
assert.equal(migration.predecessor_checks.checks,67);
console.log(JSON.stringify({suite:'employee-message-source-admission-called',status:'PASS',
  checks:{dispatcher:dispatcher.checks,migration:migration.checks,predecessor:migration.predecessor_checks.checks},
  sql:false,provider:false,production:false}));
