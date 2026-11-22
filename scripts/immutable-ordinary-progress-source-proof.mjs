import {removePrivateContextCostObservation} from './private-context-cost-source-proof.mjs';
// Exact historical source-proof inverse only. No target, SQL or effect port.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function removeOrdinaryProgressObservations(name,source){
 assert.equal(arguments.length,2);assert.equal(typeof name,'string');assert.equal(typeof source,'string');
 const raw=readFileSync(new URL('../release/installed-source/20261120_ordinary_progress_observational_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'9313240aadfd69a87b4b3b233104f1a59849c95f17716396a82232fe64c6c8d7');
 const data=JSON.parse(raw);assert.equal(data.format,'custodial.ordinary-progress-observational-source-inverse.v1');
 const file=data.files.find(f=>f.file===name);assert.ok(file,'Only the two fixed observation sources may be normalized');
 if(sha(source)===file.previousSha256)return source;
 if(name==='immutable-private-data-import.mjs')source=removePrivateContextCostObservation('scripts/'+name,source);
 if(name==='immutable-private-stage-diagnostic.mjs'&&sha(source)==='930ae3db20f74d7a6141cd749943ef73d35e64443ea1f698d574190afc4e9c28'){
  const completionStages=",'LEGACY_COMPLETION_UUID_CHECK_STAGED','LEGACY_COMPLETION_UUID_CHECK_RESTORED'";
  assert.equal(source.split(completionStages).length,2);
  source=source.replace(completionStages,'');
 }
 assert.equal(sha(source),file.currentSha256,'Whole exact source required before observational normalization');
 for(const hunk of file.hunks){assert.equal(source.split(hunk.after).length,2);source=source.replace(hunk.after,()=>hunk.before);}
 assert.equal(sha(source),file.previousSha256,'Every predecessor control, SQL, deadline and cleanup byte must survive');return source;
}
