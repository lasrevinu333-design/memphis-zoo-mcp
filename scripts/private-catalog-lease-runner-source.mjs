// Fixed complete byte inverse of the current-only disposable catalog lease.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function removePrivateCatalogLeaseRunner(source){
 assert.equal(arguments.length,1);assert.equal(typeof source,'string');
 const raw=readFileSync(new URL('../release/installed-source/20261120_private_catalog_lease_runner_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'e047a1cabbd8413ed22cfc849c34c6796cadd47565319ef693a280f3eb33554e');
 const inverse=JSON.parse(raw);assert.equal(inverse.format,'custodial.private-catalog-lease-runner-inverse.v1');assert.equal(inverse.hunks.length,4);
 assert.equal(inverse.previousSha256,'05902eaa885fa652590ac056658715691ed13df2265fcd10aee51bed0b69f586');
 if(sha(source)===inverse.previousSha256)return source;
 assert.equal(sha(source),inverse.currentSha256);
 for(const hunk of inverse.hunks){assert.equal(source.split(hunk.after).length,2);source=source.replace(hunk.after,()=>hunk.before);}
 assert.equal(sha(source),inverse.previousSha256);return source;
}
