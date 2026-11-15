// Only the exact owner-approved runner routing successor may be projected for
// historical workflow contracts. This grants no SQL or runtime admission;
// every actual step, resource/storage guard and image/checksum remains intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const current='4f29bc1954cb3ba7e8ab9f0f1ea575d1309f695a4fcccec44357ca24cfa16299';
const previous='7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e';
const routing="    runs-on: ${{ github.event_name == 'push' && github.actor == 'lasrevinu333-design' && github.ref == 'refs/heads/codex/mod-full-name-20261114' && 'custodial-foundation-isolated' || 'ubuntu-24.04' }}";
const evidence='          node scripts/scheduler-reported-boundaries-tests.mjs "$RUNNER_TEMP/scheduler-reported-boundaries-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"';
export function restoreFoundationPcRunnerWorkflow(source,name){
 if(name!=='foundation-security-gate.yml'||sha(source)!==current)return source;
 assert.equal(source.split(routing).length,2);
 assert.equal(source.split(evidence).length,2);
 const prior=source.replace(routing,'    runs-on: ubuntu-24.04').replace(evidence,'          node scripts/scheduler-reported-boundaries-tests.mjs');
 assert.equal(sha(prior),previous,'entire genuine prior Foundation workflow preserved');
 return prior;
}
