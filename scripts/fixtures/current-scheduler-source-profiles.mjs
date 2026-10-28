import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// TEST-ONLY source text for immutable historical representation/wiring proofs.
// Never imported by src/ or used as a live worker/clock/receipt authority.
const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=readFileSync(new URL('./current-scheduler-source-profile-deltas.json',import.meta.url));
assert.ok(bytes.length<=1024*1024);assert.equal(sha(bytes),'1d832c27a0e59a2804e966d43825d864a8ee73e7af644b690bb9a495ac67f1e9');
const document=JSON.parse(bytes);assert.equal(document.schema,'custodial.current-scheduler-retained-source-deltas.v1');
assert.equal(document.profiles.length,15);assert.equal(new Set(document.profiles.map(row=>row.profile)).size,15);
export function restoreSchedulerProofSource(profile,source){
 assert.equal(typeof profile,'string');assert.equal(typeof source,'string');
 const row=document.profiles.find(value=>value.profile===profile);assert.ok(row,'explicit retained Source profile required');
 // Only this historical wiring proof may consume the exact selected297 manifest.
 // Strip its fixed three-row extension back to the authentic294 whole-file
 // endpoint, then apply the unchanged historical profile. No runtime, SQL,
 // catalog, replay/admission or arbitrary source normalization is authorized.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'&&sha(source)==='e37cf98ffde8165797069595b45d84fdaf89871a719c31a839905e9e6317d54c') {
  const current=JSON.parse(source);assert.equal(current.schema,'custodial.migration-replay-order.v2');
  assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,70]);
  assert.deepEqual(current.phases[2].files.slice(-3),[
   {name:'20261027230000_accepted_actual_lunch_windows.sql',sha256:'55b2cd92ebe36c6920a3c27cc13031ef6ca263d8f10114182c3058fd0991c81b'},
   {name:'20261027231000_canonical_coverall_capacity_links.sql',sha256:'c4be89a07f46717ddcc7ceebed639cdc10b589b8ff72e9cf20a3523bdec43903'},
   {name:'20261027234814_mcp_oauth_durable_token_families.sql',sha256:'e74210f033e5c65d5e99a090ca201d1c010d6cb5c4159a015bb08e3719c44f6e'},
  ]);
  current.phases[2].files=current.phases[2].files.slice(0,-3);
  source=JSON.stringify(current,null,2)+'\n';
  assert.equal(sha(source),'5a0ac3a398d25f59a0a7f6e045d0db1c4d59b28924a18ec479f01bbe5a710121','Entire authentic294 source image must be reproduced');
 }
 assert.equal(sha(source),row.current_sha256,'exact current Source profile; unrelated drift refuses');
 assert.ok(row.hunks.length>0&&row.hunks.length<=16);let prior=source;
 for(const change of row.hunks){
  assert.equal(typeof change.current,'string');assert.equal(typeof change.prior,'string');
  assert.ok(change.current.length>0&&Buffer.byteLength(change.current)<=256*1024&&Buffer.byteLength(change.prior)<=256*1024);
  assert.equal(prior.split(change.current).length,2,'unique complete reviewed Source delta');
  prior=prior.replace(change.current,change.prior);
 }
 assert.equal(sha(prior),row.prior_sha256,'entire historical Source profile required');return prior;
}
