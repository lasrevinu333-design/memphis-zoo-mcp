import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const pkg=JSON.parse(read('package.json'));
const workflow=read('.github/workflows/backup-source-contracts.yml');
const commands={
 'test:backup-binding':'node --test scripts/backup-release-schema-binding-tests.mjs scripts/backup-ledger-binding-v2-tests.mjs',
 'test:backup-source-preflight':'node --test scripts/production-backup-source-preflight-tests.mjs',
 'test:backup-private-namespaces':'node scripts/backup-private-namespace-compatibility-tests.mjs',
 'test:backup-leadership-guard':'node scripts/leadership-restore-generation-tests.mjs',
 'test:backup-encrypted-readback':'python3 scripts/test-encrypted-backup-readback.py',
 'test:backup-ci-wiring':'node --test scripts/backup-contract-ci-wiring-tests.mjs',
};
test('aggregate requires all six offline suites with no failure masking',()=>{
 for(const [name,command]of Object.entries(commands))assert.equal(pkg.scripts[name],command);
 assert.equal(pkg.scripts['test:backup-source-contracts'],['test:backup-ci-wiring',...Object.keys(commands).filter(k=>k!=='test:backup-ci-wiring')].map(k=>'npm run --silent '+k).join(' && '));
});
test('source workflow runs on PR and main pushes covering every contract dependency',()=>{
 assert.match(workflow,/on:\n  pull_request:\n    paths:/);assert.match(workflow,/  push:\n    branches: \[main\]\n    paths:/);
 for(const path of ['scripts/**','release/**','supabase/**','package*.json','.github/workflows/**'])assert.equal(workflow.split("- '"+path+"'").length-1,2);
 assert.match(workflow,/run: npm run test:backup-source-contracts\n/);assert.match(workflow,/run: npm run test:ci-workflows\n/);
});
test('offline job has no production credentials, database, dispatch, deploy, or artifact access',()=>{
 assert.match(workflow,/permissions:\n  contents: read\n/);assert.match(workflow,/persist-credentials: false/);
 assert.doesNotMatch(workflow,/secrets\.|vars\.|pull_request_target|workflow_dispatch|workflow_call|environment:|continue-on-error|actions: (read|write)|contents: write|id-token:|upload-artifact|download-artifact|backup:production|restore:|DATABASE_URL|SUPABASE|\bgh\s|\bdocker\s/);
 const runs=[...workflow.matchAll(/^        run: (.+)$/gm)].map(x=>x[1]);
 assert.deepEqual(runs,['npm ci --ignore-scripts --no-audit --no-fund','python3 --version && openssl version','npm run test:backup-source-contracts','npm run test:ci-workflows']);
 assert.match(workflow,/timeout-minutes: 10/);
});
test('source selects only reviewed active v2 and preserves inactive candidate and historical v1',()=>{
 assert.equal(JSON.parse(read('release/production-backup-source-extension-v2.candidate.json')).activation_status,'candidate');
 assert.equal(JSON.parse(read('release/production-backup-source-extension.json')).schema,'custodial.backup-schema-extension-declaration.v1');
 assert.doesNotMatch(read('scripts/production-backup.mjs'),/production-backup-source-extension-v2\.candidate\.json/);
 assert.match(read('scripts/production-backup.mjs'),/production-backup-source-extension-v2\.active\.json/);
 const active=JSON.parse(read('release/production-backup-source-extension-v2.active.json'));
 assert.equal(active.activation_status,'active');
 assert.equal(active.observed_catalog_fingerprint,'53cb0b65c062a0e1334ef19cc669f0a0731168b38c37830245b3dea4585316fc');
});
test('published offline tests do not depend on private evidence or live captures',()=>{
 assert.doesNotMatch(workflow,/evidence\//);
 for(const file of ['scripts/backup-ledger-binding-v2-tests.mjs','scripts/production-backup-source-preflight-tests.mjs'])
  assert.doesNotMatch(read(file),/\.\.\/evidence\/|\/mnt\/ai_models\/|live-expanded-catalog|live-source-2026/);
 const provenance=JSON.parse(read('release/backup-installed-source-provenance.json'));assert.equal(provenance.statement_source_bindings.length,189);
});
