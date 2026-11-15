// This legacy suite owns historical304 fixtures. Current candidate database
// consumers and forward migration rehearsals remain separate required checks.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withSealedCanonical304SourceFixture} from './fixtures/sealed-canonical304-source-fixture.mjs';
const args=process.argv.slice(2);
assert.ok(args.length===0||(args.length===1&&args[0]==='--integrated-suite-order'),
 'Only the complete legacy scheduler suite or complete original integration-order suite may be supplied');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const integration=args[0]==='--integrated-suite-order';
const script=integration?'test:integrated-backend-authority-suite-order':'test:static-weekly-scheduler:database';
const command=integration?'node scripts/integrated-backend-authority-suite-order-isolated-tests.mjs':'node scripts/static-weekly-schedule-authority-v3-tests.mjs && node scripts/static-weekly-schedule-authority-closure-tests.mjs && node scripts/static-weekly-schedule-concurrency-tests.mjs && node scripts/static-weekly-day-changes-database-tests.mjs && node scripts/static-weekly-vacant-roster-slot-database-tests.mjs && npm run --silent test:static-weekly-existing-employee-restore-db && npm run --silent test:static-weekly-vacate-roster-slot-db';
const selected=root=>JSON.parse(readFileSync(resolve(root,'package.json'))).scripts[script];
assert.equal(selected(root),command,'The complete original legacy suite must remain required');
await withSealedCanonical304SourceFixture(root,async(fixture,proof)=>{
 assert.equal(selected(fixture),command,'The genuine view must execute the same complete suite');
 console.log(JSON.stringify({status:'EXACT_HISTORICAL304_LEGACY_SUITE_SELECTED',script,...proof,current319_or_production_admission:false}));
 const result=spawnSync('npm',['run','--silent',script],{cwd:fixture,env:{...process.env},stdio:'inherit'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,'Legacy suite was interrupted');
 assert.equal(result.status,0,'Original legacy SQL checks failed; no acceptance');
});
