// Only the exact owner-approved runner routing successor may be projected for
// historical workflow contracts. This grants no SQL or runtime admission;
// every actual step, resource/storage guard and image/checksum remains intact.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const current='5a2940c824f1e0c7bfe3e1bdbd6f5cd088f08076b8a88e9cd53a744564218795';
const previous='7d3b6cd5e5f8992f625e0ea12a3432c83099f8bb4c8192c494362552bd3ae61e';
const routing="    runs-on: ${{ github.event_name == 'push' && github.actor == 'lasrevinu333-design' && github.ref == 'refs/heads/codex/mod-full-name-20261114' && 'custodial-foundation-isolated' || 'ubuntu-24.04' }}";
export function restoreFoundationPcRunnerWorkflow(source,name){
 if(name!=='foundation-security-gate.yml'||sha(source)!==current)return source;
 assert.equal(source.split(routing).length,2);
 const prior=source.replace(routing,'    runs-on: ubuntu-24.04');
 assert.equal(sha(prior),previous,'entire genuine prior Foundation workflow preserved');
 return prior;
}
