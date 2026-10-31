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
const implementationBytes=readFileSync(new URL('./current-scheduler-implementation-source-successors.json',import.meta.url));
assert.ok(implementationBytes.length<=256*1024);assert.equal(sha(implementationBytes),'0d525297806b6e54d5a3dcb5a1e9d2028b03e3c2f8cb2a905c5b1dc0c8df3652');
const implementations=JSON.parse(implementationBytes);assert.equal(implementations.schema,'custodial.test-only-exact-implementation-source-successors.v1');assert.equal(implementations.profiles.length,2);
export function restoreSchedulerProofSource(profile,source){
 assert.equal(typeof profile,'string');assert.equal(typeof source,'string');
 const row=document.profiles.find(value=>value.profile===profile);assert.ok(row,'explicit retained Source profile required');
 // Restore only these two complete, hash-bound implementation successors
 // to their preserved Git ancestors before the immutable15 historical proofs.
 const implementation=implementations.profiles.find(value=>value.profile===profile&&value.current_sha256===sha(source));
 if(implementation){
  assert.equal(implementation.prior_sha256,row.current_sha256);assert.ok(implementation.hunks.length>0&&implementation.hunks.length<=16);
  for(const change of implementation.hunks){assert.ok(change.current.length>0&&Buffer.byteLength(change.current)<=256*1024&&Buffer.byteLength(change.prior)<=256*1024);assert.equal(source.split(change.current).length,2);source=source.replace(change.current,change.prior);}
  assert.equal(sha(source),implementation.prior_sha256,'Whole preserved implementation source must be reproduced');
 }
 // Source302 contributes only its one exact already-constructed append.
 // Reproduce the complete preserved301 replay before the unchanged chain.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'&&sha(source)==='c642e562bf012416548f26f215a3c74aae434ca6573fc0f8be83e5c0bcc59b2e'){
  const current=JSON.parse(source);assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,75]);
  assert.deepEqual(current.phases[2].files.pop(),{name:'20261031125902_approved_manual_native_operations.sql',sha256:'ffebba2a6d32ed7a3de29c9446f2554fc56063253afebdfcc5ccadabb911d138'});
  source=JSON.stringify(current,null,2)+'\n';assert.equal(sha(source),'aa3225489f809029f362f9bb2a5ff30f1442a85eb5dda468663b3f0800a9e83b');
 }
 // Exact revised unreleased302 replay for the current eight-person launch.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'&&sha(source)==='af4d8f471f1e5e6276f3232e396d3511a1ae1767edde093f12fe145f461930a9'){const current=JSON.parse(source);assert.deepEqual(current.phases.map(p=>p.files.length),[134,93,75]);assert.deepEqual(current.phases[2].files.pop(),{name:'20261031125902_approved_manual_native_operations.sql',sha256:'10238c293dda15a52321fa670f3763dd772ab6d976665cf306f737c613696b6d'});source=JSON.stringify(current,null,2)+'\n';assert.equal(sha(source),'aa3225489f809029f362f9bb2a5ff30f1442a85eb5dda468663b3f0800a9e83b');}
 // Admit only the exact Source301 replay tail to this TEST-ONLY historical
 // view. Reproduce the complete preserved Source300 bytes before following
 // its unchanged reconstruction chain; no runtime/catalog normalization.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'
  &&sha(source)==='aa3225489f809029f362f9bb2a5ff30f1442a85eb5dda468663b3f0800a9e83b'){
  const current=JSON.parse(source);assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,74]);
  assert.deepEqual(current.phases[2].files.pop(),{name:'20261030155202_approved_manual_current_day_activation.sql',sha256:'54d95f3ab7ffb088a7e72241c360fe22edb1a06a24a3f768f9adcc494ed69492'});
  source=JSON.stringify(current,null,2)+'\n';
  assert.equal(sha(source),'be9f1ce99e037690b3095c8b8e963fc30efd8c83adaa1e415856a79808dc31b1');
 }
 // Exact source299/300 tails, solely for this historical wiring view. Match
 // the full current bytes and reproduce the entire preserved source298 image
 // before applying its existing historical transformations. This is not a
 // runtime replay, catalog normalization or publication admission.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'
  &&['965300d634959010c017ac203d71fe915f65b4b42e69910b173b96d034c38001',
    'be9f1ce99e037690b3095c8b8e963fc30efd8c83adaa1e415856a79808dc31b1'].includes(sha(source))){
  const count=sha(source)==='be9f1ce99e037690b3095c8b8e963fc30efd8c83adaa1e415856a79808dc31b1'?2:1,
   current=JSON.parse(source),tails=[
    {name:'20261030031200_approved_manual_full_hour_coverers.sql',sha256:'de548422310c3369bac0560e14507e4022cc9d5b9effe898d4f24ae79156cf6a'},
    {name:'20261030050235_compact_approved_initial_confirmation.sql',sha256:'fa9373adcf48f8d13db1b8e4876a5f134b02f8a897f20f887987cbd384393469'},
   ];
  assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,71+count]);
  assert.deepEqual(current.phases[2].files.slice(-count),tails.slice(0,count));
  current.phases[2].files=current.phases[2].files.slice(0,-count);source=JSON.stringify(current,null,2)+'\n';
  assert.equal(sha(source),'aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba');
 }
 // Exact source298 successor, solely for this historical wiring view.
 // Runtime replay and the selected297 fixture admission remain unchanged.
 if(profile==='NATIVE_CURRENT_REPLAY_MANIFEST_RETAINED_WIRING'&&sha(source)==='aca06e305ff4c5918e83045acf4d739fcb8746e41dcc89ceb59fcd0f98ab20ba') {
  const current=JSON.parse(source);assert.deepEqual(current.phases.map(phase=>phase.files.length),[134,93,71]);
  assert.deepEqual(current.phases[2].files.at(-1),{name:'20261028224728_full_scheduled_lunch_source_policy.sql',sha256:'a47387ddf244a04df646c9bb2d60eef86a769b96baf9106759f1c2a703248514'});
  current.phases[2].files.pop();source=JSON.stringify(current,null,2)+'\n';
  assert.equal(sha(source),'e37cf98ffde8165797069595b45d84fdaf89871a719c31a839905e9e6317d54c');
 }
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
