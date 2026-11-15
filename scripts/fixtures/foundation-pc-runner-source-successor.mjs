// Only these exact routing, evidence-output, historical-source caller and CI
// wall-budget successors may be projected for historical workflow contracts.
// This grants no SQL/runtime admission. Original checks, per-test limits,
// resource/storage guards and image/checksums remain required.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const current='27874ab563fda9f14c686e4c7a097fc2a88eb24993529f144e2f7e5501f05779';
const previous='7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e';
const routing="    runs-on: ${{ github.event_name == 'push' && github.actor == 'lasrevinu333-design' && github.ref == 'refs/heads/codex/mod-full-name-20261114' && 'custodial-foundation-isolated' || 'ubuntu-24.04' }}";
const evidence='          node scripts/scheduler-reported-boundaries-tests.mjs "$RUNNER_TEMP/scheduler-reported-boundaries-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"';
const canonical304='          node scripts/sealed-canonical304-source-fixture-tests.mjs\n          TMPDIR="$ci_sql_parent" node --max-old-space-size=384 scripts/run-sealed-canonical304-fixture.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
const canonical304Prior='          node --max-old-space-size=384 scripts/sealed-repair-canonical-database-tests.mjs --out "$RUNNER_TEMP/approved-manual-activation-sql"';
export function restoreFoundationPcRunnerWorkflow(source,name){
 if(name!=='foundation-security-gate.yml'||sha(source)!==current)return source;
 assert.equal(source.split(routing).length,2);
 assert.equal(source.split(evidence).length,2);
 assert.equal(source.split(canonical304).length,2);
 assert.equal(source.split('    timeout-minutes: 60').length,2);
 const prior=source.replace(routing,'    runs-on: ubuntu-24.04').replace(evidence,'          node scripts/scheduler-reported-boundaries-tests.mjs').replace(canonical304,canonical304Prior).replace('    timeout-minutes: 60','    timeout-minutes: 35');
 assert.equal(sha(prior),previous,'entire genuine prior Foundation workflow preserved');
 return prior;
}
