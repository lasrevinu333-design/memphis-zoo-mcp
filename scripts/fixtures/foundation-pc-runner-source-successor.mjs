// Only the exact owner-approved runner routing successor may be projected for
// historical workflow contracts. This grants no SQL or runtime admission;
// every actual step, resource/storage guard and image/checksum remains intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const current='3b62d6e4e0376e3b9902918a268baba95d8274e57b492c82d1bb4a5fd46e18d6';
const previous='7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e';
const routing="    runs-on: ${{ github.event_name == 'push' && github.actor == 'lasrevinu333-design' && github.ref == 'refs/heads/codex/mod-full-name-20261114' && 'custodial-foundation-isolated' || 'ubuntu-24.04' }}";
const evidence='          node scripts/scheduler-reported-boundaries-tests.mjs "$RUNNER_TEMP/scheduler-reported-boundaries-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"';
const canonical304='          node scripts/sealed-canonical304-source-fixture-tests.mjs\n          node --max-old-space-size=384 scripts/run-sealed-canonical304-fixture.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
const canonical304Prior='          node --max-old-space-size=384 scripts/sealed-repair-canonical-database-tests.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
export function restoreFoundationPcRunnerWorkflow(source,name){
 if(name!=='foundation-security-gate.yml'||sha(source)!==current)return source;
 assert.equal(source.split(routing).length,2);
 assert.equal(source.split(evidence).length,2);
 assert.equal(source.split(canonical304).length,2);
 const prior=source.replace(routing,'    runs-on: ubuntu-24.04').replace(evidence,'          node scripts/scheduler-reported-boundaries-tests.mjs').replace(canonical304,canonical304Prior);
 assert.equal(sha(prior),previous,'entire genuine prior Foundation workflow preserved');
 return prior;
}
