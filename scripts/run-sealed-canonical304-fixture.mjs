// Historical baseline only; actual current source has separate required tests.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {lstatSync,mkdtempSync,writeFileSync} from 'node:fs';
import {validateOwnedDiskParent} from './ci-fresh-owned-disk.mjs';
import {withSealedCanonical304SourceFixture} from './fixtures/sealed-canonical304-source-fixture.mjs';
assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--out');
const out=resolve(process.argv[3]);assert.equal(out,process.argv[3],'Exact absolute evidence output required');
assert.equal(lstatSync(out,{throwIfNoEntry:false}),undefined,'New evidence path only; never reuse a consumed rehearsal');
// Provisioned earlier in this workflow and covered by its always-uploaded
// evidence glob. Retain constructor custody/cleanup receipts here, not in /tmp.
const diskParent=resolve(dirname(out),'ci-fresh-only-failure-evidence');
const parent=validateOwnedDiskParent(diskParent);
assert.notEqual(parent.parentIdentity.dev,lstatSync('/').dev,'Actual secondary disk required');
const diskTmp=mkdtempSync(resolve(diskParent,'canonical304-'));
const diskIdentity=validateOwnedDiskParent(diskTmp);
writeFileSync(resolve(diskTmp,'EXPLICIT_PRIVATE_TMPDIR.json'),JSON.stringify({schema:'custodial.canonical304-private-disk-input.v1',
 parent:diskIdentity.parentIdentity,filesystem:diskIdentity.filesystem,SQL_executed:false,production_admission:false},null,2)+'\n',{flag:'wx',mode:0o600});
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
await withSealedCanonical304SourceFixture(root,async(fixture,receipt)=>{
 console.log(JSON.stringify({status:'EXACT_HISTORICAL304_SOURCE_SELECTED',...receipt,SQL_executed:false}));
 const result=spawnSync(process.execPath,[...process.execArgv,resolve(fixture,'scripts/sealed-repair-canonical-database-tests.mjs'),'--out',out],
  {cwd:fixture,env:{...process.env,TMPDIR:diskTmp},stdio:'inherit'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,'Original canonical304 test was interrupted');
 assert.equal(result.status,0,'Original canonical304 rehearsal failed; no acceptance');
});
