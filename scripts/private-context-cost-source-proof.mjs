// Complete byte inverse for a finite diagnostic. No target or effect port.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export function removePrivateContextCostObservation(name,source){
 assert.equal(arguments.length,2);assert.equal(typeof name,'string');assert.equal(typeof source,'string');
 const raw=readFileSync(new URL('../release/installed-source/20261120_private_context_cost_source_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'b748f59056123d37d25fdca27274ae2d6236ab1ee1c6cd20ca72d98840c52b37');const data=JSON.parse(raw);assert.equal(data.format,'custodial.private-context-cost-observer-source-inverse.v1');
 assert.deepEqual(Object.keys(data.files).sort(),['.github/workflows/production-backup-migration-rehearsal.yml','scripts/immutable-private-data-import.mjs','scripts/run-private-backup-only-rehearsal.mjs']);
 const file=data.files[name];assert.ok(file,'Only fixed observation sources may be normalized');
 if(sha(source)===file.previousSha256)return source;
 assert.equal(sha(source),file.currentSha256);
 for(const h of file.hunks){if(h.before===''){assert.ok(source.endsWith(h.after));source=source.slice(0,-h.after.length);}else{assert.equal(source.split(h.after).length,2);source=source.replace(h.after,()=>h.before);}}
 assert.equal(sha(source),file.previousSha256);return source;
}
