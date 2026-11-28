import {withRehearsalContext} from './fixtures/rehearsal-shell-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreUnifiedBackupPackage,restoreUnifiedBackupWorkflow,restoreUnifiedQualifiedSource,verifyUnifiedBackupCiInputs} from './fixtures/unified-backup-ci-source-successor.mjs';
const root=new URL('../',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const document=JSON.parse(readFileSync(new URL('scripts/fixtures/unified-backup-ci-source-successor.json',root)));
for(const row of document.qualified_sources)test('complete original owned fixture entry survives its exact source successor: '+row.path,()=>{
 const source=readFileSync(new URL(row.path,root),'utf8');assert.equal(sha(source),row.current_sha256);
 assert.equal(sha(restoreUnifiedQualifiedSource(row.path,source)),row.prior_sha256);
 for(const mutant of [source+'\n',source.replace(/./,'!')]){
  assert.notEqual(mutant,source);assert.equal(restoreUnifiedQualifiedSource(row.path,mutant),mutant);assert.notEqual(sha(mutant),row.prior_sha256);
 }
});
test('integrated package adds exactly nine backup verification commands and preserves every previous dependency and command',()=>{
 const bytes=readFileSync(new URL('package.json',root));
 assert.equal(sha(restoreUnifiedBackupPackage(bytes)),document.package.prior_sha256);
 const changed=JSON.parse(bytes);changed.scripts.start='true';const mutant=Buffer.from(JSON.stringify(changed,null,2)+'\n');
 assert.equal(restoreUnifiedBackupPackage(mutant),mutant);assert.notEqual(sha(mutant),document.package.prior_sha256);
 assert.equal(Object.keys(document.package.added_scripts).length,9);
});
for(const row of document.workflows)test('complete genuine workflow predecessor survives exact integration: '+row.name,()=>{
 const source=readFileSync(new URL('.github/workflows/'+row.name,root),'utf8');
 assert.equal(sha(restoreUnifiedBackupWorkflow(source,row.name)),row.prior_sha256);
 for(const mutant of [source+'\n',source.replace('npm ci --ignore-scripts','npm ci --ignore-scripts || true')]){
  assert.notEqual(mutant,source);assert.equal(restoreUnifiedBackupWorkflow(mutant,row.name),mutant);assert.notEqual(sha(mutant),row.prior_sha256);
 }
});
test('current rehearsal retains authenticated dependency probe and original private cleanup ownership',()=>{
 const source=withRehearsalContext(readFileSync(new URL('.github/workflows/production-backup-migration-rehearsal.yml',root),'utf8'));
 assert.ok(source.includes('"$auth_dir/dependency-manager-authorization.header"'));
 const start=source.indexOf('          cleanup() {'),stop=source.indexOf('          trap cleanup EXIT',start);assert.ok(start>0&&stop>start);
 const cleanup=source.slice(start,stop),early='if test "${private_route_active:-false}" = true; then\n              trap - EXIT\n              exit "$status"\n            fi';
 assert.equal(cleanup.split(early).length,2);assert.ok(cleanup.indexOf(early)<cleanup.indexOf('for owned_pid'));
 assert.ok(cleanup.includes('rm -rf -- "$auth_dir"'));
 for(const mutant of [source.replace(early,''),source.replace('"$auth_dir/dependency-manager-authorization.header"','')])
  assert.equal(restoreUnifiedBackupWorkflow(mutant,'production-backup-migration-rehearsal.yml'),mutant);
 assert.equal(verifyUnifiedBackupCiInputs(root).release_admission,false);
});

test('the hosted rehearsal sources the reviewed shell in the same execution context', () => {
  const name = 'production-backup-migration-rehearsal.yml';
  const actual = readFileSync(new URL('.github/workflows/' + name, root), 'utf8');
  const line = '          source scripts/prepare-backup-rehearsal-context.sh';
  assert.equal(actual.split(line).length, 2);
  assert.equal(sha(withRehearsalContext(actual)), '2c766a3d081399c9fd53004838f083c9ed987663fc7e050f44d332dc19639d47');
  const changed = actual.replace(line, '          bash scripts/prepare-backup-rehearsal-context.sh');
  assert.equal(withRehearsalContext(changed), changed);
  const reviewed = document.workflows.find(row => row.name === name);
  assert.notEqual(sha(restoreUnifiedBackupWorkflow(changed, name)), reviewed.prior_sha256);
});
