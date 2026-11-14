import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateApprovedOperationalTarget as target, validateOperationalVersion as version} from './approved-operational-live-target.mjs';
const input = JSON.parse(readFileSync(new URL('../release/operational-live-approved-target.json', import.meta.url), 'utf8'));
const receipt = readFileSync(new URL('../release/operational-live-api-receipt.json', import.meta.url));
const approved = target(input, receipt);
const different = 'a'.repeat(40);
let refusals = 0;
for (const patch of [
  {schema:'other'}, {scope:'control_and_api'}, {origin:'https://unapproved.invalid'},
  {repository:'other/repository'}, {service_id:'srv-other'}, {backend_commit_sha:different},
  {deployment_id:'dep-other'}, {not_launcher_identity:false}, {retired_application_http_status:200},
  {deployment_receipt_sha256:'0'.repeat(64)}, {extra:true},
]) { assert.throws(() => target({...input, ...patch}, receipt)); refusals++; }
for (const patch of [{status:'failed'}, {commit:{id:different}}, {id:'dep-other'}]) {
  const changed = JSON.parse(receipt); Object.assign(changed.deployment, patch);
  const bytes = Buffer.from(JSON.stringify(changed));
  assert.throws(() => target({...input, deployment_receipt_sha256:createHash('sha256').update(bytes).digest('hex')}, bytes)); refusals++;
}
assert.equal(version({ok:true,backend_commit_sha:approved.backend_commit_sha}, approved), true);
for (const value of [null, [], {}, {ok:false,backend_commit_sha:approved.backend_commit_sha},
  {ok:true,backend_commit_sha:different,release_manifest:{backend:{commit_sha:approved.backend_commit_sha}}},
  {ok:true,release_manifest:{backend:{commit_sha:approved.backend_commit_sha}}},
]) { assert.throws(() => version(value, approved)); refusals++; }
const command = new URL('./approved-operational-live-target.mjs', import.meta.url);
const run = (args, input='') => spawnSync(process.execPath, [command.pathname,...args], {input,encoding:'utf8'});
const read = run([]); assert.equal(read.status, 0, read.stderr); assert.equal(read.stdout.trim(), approved.backend_commit_sha);
const good = run(['--verify-response',approved.backend_commit_sha], JSON.stringify({ok:true,backend_commit_sha:approved.backend_commit_sha}));
assert.equal(good.status, 0, good.stderr);
for (const [args,body] of [
  [['--verify-response',different],JSON.stringify({ok:true,backend_commit_sha:different})],
  [['--verify-response',approved.backend_commit_sha],JSON.stringify({ok:true,backend_commit_sha:different})],
  [['--verify-response',approved.backend_commit_sha],'invalid JSON'],
  [['--verify-response',approved.backend_commit_sha],''],
]) {const result=run(args,body);assert.equal(result.status,1);assert.equal(result.stdout,'');refusals++;}
console.log(JSON.stringify({ok:true,independent_target:true,refusal_cases:refusals,network:false}));
