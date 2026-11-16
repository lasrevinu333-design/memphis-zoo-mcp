import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {retainedFoundationWorkflow,priorFoundationWorkflowSha,splitFoundationWorkflow,restoreSplitFoundationWorkflow} from './foundation-ci-split-layout.mjs';
const prior=retainedFoundationWorkflow(),actual=readFileSync(new URL('../.github/workflows/foundation-security-gate.yml',import.meta.url),'utf8');
function jobs(source){
 const body=source.slice(source.indexOf('jobs:\n')+'jobs:\n'.length),heads=[...body.matchAll(/^  ([a-z_]+):\n/gm)];
 return Object.fromEntries(heads.map((m,i)=>[m[1],body.slice(m.index,heads[i+1]?.index??body.length)]));
}
function script(source,label){
 const header='      - name: '+label+'\n        run: |\n',at=source.indexOf(header);assert.ok(at>=0);
 const start=at+header.length,end=source.indexOf('\n      - ',start);return source.slice(start,end<0?source.length:end)+'\n';
}
const calls=source=>source.split('\n').map(x=>x.trim()).filter(x=>/^(?:npm run|node |python3 |TMPDIR=)/.test(x));
test('complete exact previous workflow is recoverable from the reviewed two-job layout',()=>{
 assert.equal(createHash('sha256').update(prior).digest('hex'),priorFoundationWorkflowSha);
 assert.equal(splitFoundationWorkflow(prior),actual);assert.equal(restoreSplitFoundationWorkflow(actual,'foundation-security-gate.yml'),prior);
 for(const changed of [prior+'\n',prior.replace('timeout-minutes: 60','timeout-minutes: 120')])assert.throws(()=>splitFoundationWorkflow(changed));
});
test('both jobs preserve the existing runner route,60-minute budget and read-only repository permissions',()=>{
 const old=jobs(prior),next=jobs(actual);assert.deepEqual(Object.keys(next),['validate','remaining_contracts']);
 const routing=old.validate.split('\n').find(l=>l.startsWith('    runs-on:'));
 for(const block of Object.values(next)){assert.ok(block.split('\n').includes(routing));assert.match(block,/^    timeout-minutes: 60$/m);}
 assert.match(next.remaining_contracts,/^    needs: validate$/m);assert.match(actual,/^permissions:\n  contents: read\n/m);
 assert.doesNotMatch(actual,/id-token: write|contents: write|workflow_dispatch/);
});
test('every original test invocation appears once in the same execution order across the phase boundary',()=>{
 const next=jobs(actual),old=script(prior,'Authentication and integration contracts');
 const first=script(next.validate,'Authentication and integration contracts'),rest=script(next.remaining_contracts,'Retained scheduler SQL and release closure contracts');
 assert.deepEqual([...calls(first),...calls(rest)],calls(old));
 const start=old.indexOf('          # This starts only disposable worker-owned PostgreSQL containers and\n');assert.ok(start>0);
 assert.equal(first,old.slice(0,start));
 assert.ok(rest.endsWith(old.slice(start)));
 assert.equal((rest.match(/run-sealed-legacy-scheduler-database-tests.mjs/g)||[]).length,2);
 assert.equal((rest.match(/run-retained-release-provenance-tests.mjs/g)||[]).length,1);
});
test('remaining phase keeps the secondary-disk refusal and receives a distinct owned namespace',()=>{
 const next=jobs(actual),first=script(next.validate,'Authentication and integration contracts'),rest=script(next.remaining_contracts,'Retained scheduler SQL and release closure contracts');
 for(const body of [first,rest]){
  assert.ok(body.includes('test ! -e "$ci_sql_parent"'));assert.ok(body.includes('Foundation database qualification requires an existing secondary disk.'));
  assert.ok(body.includes('sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" "$ci_sql_parent"'));
 }
 assert.match(rest,/ci_sql_parent="\/mnt\/custodial-sql-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}-remaining"/);
 assert.ok(!first.includes('GITHUB_RUN_ATTEMPT}-remaining'));
});
test('both jobs retain the exact dependency and selected-image provisioning steps',()=>{
 const next=jobs(actual),provision=prior.slice(prior.indexOf('      - name: Provision exact selected fresh PostgreSQL image\n'),prior.indexOf('      - name: Authentication and integration contracts\n'));
 for(const block of Object.values(next)){
  assert.ok(block.includes(provision));assert.ok(block.includes('node-version: \'22.23.4\''));
  assert.ok(block.includes('run: npm ci --ignore-scripts'));assert.ok(block.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'));
  assert.ok(block.includes('run: node scripts/foundation-ci-split-layout-tests.mjs'));
 }
 assert.match(next.remaining_contracts,/name: ci-fresh-only-failure-evidence-\$\{\{ github.run_id \}\}-remaining/);
});
test('changed job dependencies, missing checks or altered budgets cannot masquerade as the reviewed source view',()=>{
 for(const changed of [actual.replace('needs: validate','needs: missing'),actual.replace('remaining_contracts:\n    needs: validate','remaining_contracts:\n    needs: validate\n    if: false'),
  actual.replace('          npm run --silent test:isolated-restore-lease-shim\n',''),actual.replace('timeout-minutes: 60','timeout-minutes: 120')]){
  assert.notEqual(changed,actual);assert.equal(restoreSplitFoundationWorkflow(changed,'foundation-security-gate.yml'),changed);
 }
 assert.equal(restoreSplitFoundationWorkflow(actual,'unrelated.yml'),actual);
});
