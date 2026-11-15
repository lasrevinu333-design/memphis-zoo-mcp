// Historical baseline only; actual current source has separate required tests.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {withSealedCanonical304SourceFixture} from './fixtures/sealed-canonical304-source-fixture.mjs';
assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--out');
const out=resolve(process.argv[3]);assert.equal(out,process.argv[3],'Exact absolute evidence output required');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
await withSealedCanonical304SourceFixture(root,async(fixture,receipt)=>{
 console.log(JSON.stringify({status:'EXACT_HISTORICAL304_SOURCE_SELECTED',...receipt,SQL_executed:false}));
 const result=spawnSync(process.execPath,[...process.execArgv,resolve(fixture,'scripts/sealed-repair-canonical-database-tests.mjs'),'--out',out],
  {cwd:fixture,env:process.env,stdio:'inherit'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,'Original canonical304 test was interrupted');
 assert.equal(result.status,0,'Original canonical304 rehearsal failed; no acceptance');
});
