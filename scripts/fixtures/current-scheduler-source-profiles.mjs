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
