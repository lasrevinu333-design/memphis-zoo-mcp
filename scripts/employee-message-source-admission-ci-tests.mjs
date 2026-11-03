// Mandatory called source proof; importing an export-only test is not execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runBoundedNodeProof} from './bounded-node-proof.mjs';
import {runEmployeeMessageSourceAdmissionTests,runEmployeeMessageMigrationSourceTests}
  from './employee-message-source-admission-tests.mjs';

// The generic sender was superseded by the qualified native MESSAGE owner.
// Retain all historical assertions against its exact committed predecessor;
// independently require the current worker and native owner below.
const predecessor=new URL('./fixtures/employee-message-generic-dispatcher-e31626c.txt',import.meta.url);
assert.equal(createHash('sha256').update(readFileSync(predecessor)).digest('hex'),
  '840931765d9ae9ad3f5f6223e801ec9a34bb32043717b99c494282082f4ccefb');
const dispatcher=await runEmployeeMessageSourceAdmissionTests({sourcePath:predecessor});
assert.equal(dispatcher.status,'PASS');
assert.equal(dispatcher.checks,256);
const migration=await runEmployeeMessageMigrationSourceTests();
assert.equal(migration.status,'PASS');
assert.equal(migration.checks,64);
assert.equal(migration.predecessor_checks.status,'PASS');
assert.equal(migration.predecessor_checks.checks,67);
const current=await runBoundedNodeProof({
  args:['--max-old-space-size=256','--test','scripts/native-message-dispatch-tests.mjs'],
  cwd:fileURLToPath(new URL('..',import.meta.url)),absoluteMilliseconds:30000,cleanupReserveMilliseconds:5000,
});
for(const line of ['# tests 53','# pass 53','# fail 0','# cancelled 0','# skipped 0','# todo 0'])
  assert.ok(current.stdout.split('\n').includes(line),'current qualified MESSAGE receipt: '+line);
console.log(JSON.stringify({suite:'employee-message-source-admission-called',status:'PASS',
  checks:{dispatcher:dispatcher.checks,migration:migration.checks,predecessor:migration.predecessor_checks.checks},
  generic_dispatcher_scope:'EXACT_HISTORICAL_PREDECESSOR',current_qualified_MESSAGE_tests:53,
  sql:false,provider:false,production:false}));
