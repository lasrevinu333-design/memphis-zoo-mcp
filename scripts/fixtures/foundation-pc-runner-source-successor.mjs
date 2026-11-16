// Only these exact routing, evidence-output, historical-source caller and CI
// wall-budget successors may be projected for historical workflow contracts.
// This grants no SQL/runtime admission. Original checks, per-test limits,
// resource/storage guards and image/checksums remain required.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreSplitFoundationWorkflow} from '../foundation-ci-split-layout.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const current='e1dc3b5a7dbc4d4ed350db52e314f3ed6fbe3e7ccded2d945aad454c07c2749b';
const previous='7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e';
const routing="    runs-on: ${{ github.event_name == 'push' && github.actor == 'lasrevinu333-design' && github.ref == 'refs/heads/codex/mod-full-name-20261114' && 'custodial-foundation-isolated' || 'ubuntu-24.04' }}";
const evidence='          node scripts/scheduler-reported-boundaries-tests.mjs "$RUNNER_TEMP/scheduler-reported-boundaries-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"';
const canonical304='          node scripts/sealed-canonical304-source-fixture-tests.mjs\n          TMPDIR="$ci_sql_parent" node --max-old-space-size=384 scripts/run-sealed-canonical304-fixture.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
const canonical304Prior='          node --max-old-space-size=384 scripts/sealed-repair-canonical-database-tests.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
const legacy='          TMPDIR="$ci_sql_parent" node scripts/run-sealed-legacy-scheduler-database-tests.mjs';
const legacyPrior='          npm run --silent test:static-weekly-scheduler:database';
export function restoreFoundationPcRunnerWorkflow(source,name){
 source=restoreSplitFoundationWorkflow(source,name);
 if(name==='foundation-security-gate.yml'&&sha(source)==='4ff403c1cc51c42224d6ab3807b7d9cea8f60d03b263262b4bdb216ea2232ad7'){
  // Exact current observer successor; frozen canonical304 driver/SQL unchanged.
  assert.equal(sha(readFileSync(new URL('../run-sealed-canonical304-fixture.mjs',import.meta.url))),'7fcacecdf43c0ac016c3c4daa76b1896899b1f623b69a9c4c0b4943b381a2e2c');
  assert.equal(sha(readFileSync(new URL('../canonical304-kernel-resource-view.mjs',import.meta.url))),'2bc4777d641f84331fa7f88e980f5c6656f2936d716452cb22c8e0b3aaaf9f29');
  assert.equal(sha(readFileSync(new URL('../canonical304-historical-state-view.mjs',import.meta.url))),'e1337a7201b07f8488a52e37ab8e14b6bb0beb639438e087a32901c9b6841fa1');
  assert.equal(sha(readFileSync(new URL('../manual-period-historical-state-successor.mjs',import.meta.url))),'052090bdfa009fa3bfd79720c98f7dd770a95444c0bd038bfc865746e73f4ce2');
  assert.equal(sha(readFileSync(new URL('../manual-offday-owned-source-view.mjs',import.meta.url))),'3e622967dd872528a0cada144ef1381433591a4437d97cee43901471527318d2');
  assert.equal(sha(readFileSync(new URL('../manual-offday-historical-routing.mjs',import.meta.url))),'968e2070165f81075428935a21dec9a97519d53079fa1d163c95f790ed95be5c');
  assert.equal(sha(readFileSync(new URL('../manual-offday-child-source-view.mjs',import.meta.url))),'a611ae9e7137efa82f454f3b7b2238865f46e1403afa2a393fc55844c9e52084');
  assert.equal(sha(readFileSync(new URL('../manual-offday-source-successor.mjs',import.meta.url))),'b35920108637fa1e27d5da89a217d6b6b830c79570d7f61feb78c84a2ff2ede5');
  assert.equal(sha(readFileSync(new URL('../../release/offday-child-source-closure.json',import.meta.url))),'e63d8eb506c7cdd919bd92b84599fecfdfa5ebc3a24d34ec231e51b69c95e6d2');
  assert.equal(sha(readFileSync(new URL('../../release/offday-historical304-source-closure.json',import.meta.url))),'184c5b11df2b715a77b0d9f05f4cd6c49cfb619b4ab76badbc8e030e282b4aff');
  assert.equal(sha(readFileSync(new URL('../fixture-cgroup-memory-contract.mjs',import.meta.url))),'6809f2075d489359a35af840db0bf09ae58a0995d6d3b93b6ab0e3fd352e8d86');
  assert.equal(sha(readFileSync(new URL('../run-retained-release-provenance-tests.mjs',import.meta.url))),
   '6f49f7bc0d09a984e17ea747683d5cc266896319e05bd98a1eeabc7669ec7f20');
  const from='          TMPDIR="$ci_sql_parent" node scripts/run-retained-release-provenance-tests.mjs\n';
  assert.equal(source.split(from).length,2);
  source=source.replace(from,'          npm run --silent test:integrated-backend-authority-release-provenance\n');
  assert.equal(sha(source),'e4c8aae8f2b440ebc706169387ebd11e81690faaab00cbb78d0d4f337d5c9bd9');
 }
 if(name==='foundation-security-gate.yml'&&sha(source)==='e4c8aae8f2b440ebc706169387ebd11e81690faaab00cbb78d0d4f337d5c9bd9'){
  // Verify the executable current caller before reproducing the retained
  // workflow view. Both unchanged SQL orders remain in the original command.
  assert.equal(sha(readFileSync(new URL('../run-sealed-legacy-scheduler-database-tests.mjs',import.meta.url))),
   '0bd9b7c56e0424d76ab9322c3a6bfaebc5b1c5b19ec44c76d3b1c8cc75ec2108');
  const from='          TMPDIR="$ci_sql_parent" node scripts/run-sealed-legacy-scheduler-database-tests.mjs --integrated-suite-order\n';
  assert.equal(source.split(from).length,2);
  source=source.replace(from,'          npm run --silent test:integrated-backend-authority-suite-order\n');
  assert.equal(sha(source),current,'complete prior workflow must be reproduced');
 }
 if(name!=='foundation-security-gate.yml'||sha(source)!==current)return source;
 assert.equal(source.split(routing).length,2);
 assert.equal(source.split(evidence).length,2);
 assert.equal(source.split(canonical304).length,2);
 assert.equal(source.split(legacy).length,2);
 assert.equal(source.split('    timeout-minutes: 60').length,2);
 const prior=source.replace(routing,'    runs-on: ubuntu-24.04').replace(evidence,'          node scripts/scheduler-reported-boundaries-tests.mjs').replace(canonical304,canonical304Prior).replace(legacy,legacyPrior).replace('    timeout-minutes: 60','    timeout-minutes: 35');
 assert.equal(sha(prior),previous,'entire genuine prior Foundation workflow preserved');
 return prior;
}
