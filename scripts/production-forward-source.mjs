import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const profile='existing-postgres-owner';
const admitted=new Map([
 ['20261002090000_manager_issue_outcomes.sql','4e2032be8225a87bd5612824d9b26c7d4197d2a950e1e6411d9faecd59220017'],
 ['20261011000206_native_private_custody_complete_frame_readback.sql','ae478c85db3321c257038273765f7124c821eb0c40d4636daa051affae75657d'],
 ['20261010193211_native_private_custody_chunk_retention.sql','28275c65a49b26a21ee0f37538a0f9c337a45c5fb41f0fa701d2ffdf555f863b'],
 ['20261007161645_approved_initial_selection_metadata.sql','c155c2dc027ddc395dcf74e2c3a964cf97be253b71e0c4f349a8197517c9694d'],
 ['20261008032718_native_lunch_spoken_accepted_duties.sql','6f51364149b88f791825175b4ae5b5ab3e95aac7ead2f193a0efa48ea20c1c1c'],
 ['20261008064748_native_schedule_server_source_window.sql','e8cf7343635fd0180fd89a617538a09c1bf39b77e17cc7d68d1a11e29cadc036'],
 ['20261008075109_native_schedule_source_reservation.sql','dfa2d15872e6dbe274fd31c375a6b7e28999649140e29d7eb1292412c2d3dda5'],
 ['20261008083139_native_schedule_content_source.sql','3ac5159ec6682eb3e4b6b3a8db61ae9a07fadc5a9b121e87b0135ff589377764'],
 ['20261008095837_native_schedule_server_finalization.sql','546e266027a5d881660717e6d47a6889a2a5754fdfb2c50b4f566d8a1dabdd1b'],
 ['20261008102957_native_schedule_inventory.sql','1dc56786eb5783df203bb11264b0d3ad24ee7144e12a137b28c651b5d21fd4ea'],
 ['20261008111355_native_schedule_observation_binding.sql','e5e843e965c273ad5104e5549453f153389054585c7f2125f21f8256fe8e46e8'],
 ['20261008115557_native_schedule_job_preparation.sql','d8e60a063312022b4f44c6479c83b1ce70a4dc19008ec50686815756b4c318a7'],
 ['20261008122247_native_schedule_attempt_outcome.sql','2b547c771f90d95e5fbe68c3f14d787e4115a93311812b61f432e056f12b126e'],
 ['20261008124644_native_schedule_sender_inventory.sql','5ffae3607b44915187e06a33517b7423965588267eac7927b31e9c53ca02dd6c'],
 ['20261008135429_native_schedule_source_discovery.sql','cacc3ca2a86e0028bee8c8013f9e65ee68e96edf78ab0ee0005b2cfdbdb121ce'],
 ['20261008142316_native_schedule_preparation_source.sql','266cfdb8e28f87ec5bfe2aa5d62d8cb70375fc219df13602043fe0c0a5d64df0'],
 ['20261011214943_custodial_feedback_triage_receipt_reader.sql','88ca748da7713fd87502675663e34144ea6dea925a29cedd5d358cfbf55c139b'],
 ['20261003220000_current_release_authority_completion.sql','8d8d60f1b10427f5c184488a9faa5e4f4bbb9ac2f11526ff921bb8c2eac70898'],
 ['20261006190426_manager_scheduler_recovery_binding.sql','7a57b1b3607d27bd298646f72bc65917cb522e26a2c6169bb610ec79500c6209'],
 ['20261015040830_same_original_retained_completion_read.sql','ecb708c726535401ddf085d122c54bfad1e58b6322c17c0c89af7c234b046c3d'],
 ['20261017225101_approved_static_dated_original_materialization.sql','2526dde3e55268da83ba43c8ce30c61c5f1a8c83df50aae85d557c517c383418'],
 ['20261002120000_october_dated_recovery_inventory_rebind.sql','3ba81c38118b4b56543d2f89135bbdb7a6652c700c78b5dedcf898b3e60f6000'],
 ['20261018151858_registered_never_filled_vacancy_source_recovery.sql','4127e4a9aa2cb0a5fab6f230040002af04fa3352ee54f231402e3ca05b7fe9ed'],
 ['20261018161845_approved_static_pending_staffing_original_recovery.sql','8063bc0c21a881c14806ef685749acc14c809a0fbfe69629f844ea7fa51ce047'],
 ['20261021124949_dashboard_independent_verified_check_reader.sql','743a210140bee5653b6c7bdaf932850dc08c0ab4564ce40f4efa3c9f8f35e761'],
]);
const exact=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort());
export function productionForwardSourceManifest(backendRoot){
 const manifest=JSON.parse(readFileSync(resolve(backendRoot,'release/production-forward-source/manifest.json'),'utf8'));
 assert.equal(manifest.schema,'custodial.production-forward-source.v1');
 assert.equal(manifest.project_ref,'rqquvtjdmugpigbndmne');assert.equal(manifest.profile,profile);
 assert.equal(manifest.requires_existing_signed_release_authorization,true);
 assert.equal(manifest.migrations.length,admitted.size);
 for(const item of manifest.migrations){
  exact(item,['canonical_file','canonical_sha256','forward_file','forward_sha256','profile']);
  assert.equal(item.canonical_sha256,admitted.get(item.canonical_file));
  assert.equal(item.forward_file,'release/production-forward-source/'+item.canonical_file);
  assert.equal(item.profile,profile);assert.match(item.forward_sha256,/^[0-9a-f]{64}$/);
 }
 assert.equal(new Set(manifest.migrations.map(x=>x.canonical_file)).size,admitted.size);
 return manifest;
}
// Preserve the exact old identity when no adapter is selected. For the finite
// new tail, signed authorization binds BOTH canonical and executed bytes.
export function releaseMigrationPlanIdentity(items){
 return items.map(({order,source_migration_version,file,sha256,forward_source})=>({
  order,source_migration_version,file,sha256,
  ...(forward_source?{forward_source:{...forward_source}}:{}),
 }));
}
export function resolveReleaseMigrationSource(backendRoot,item){
 assert.match(item.file,/^[0-9]{14}_[a-z0-9_]+\.sql$/);
 const canonical=readFileSync(resolve(backendRoot,'supabase/migrations',item.file),'utf8');
 if(!item.forward_source){
  assert.equal(sha(canonical),item.sha256,'Canonical pending source hash mismatch');
  // Old plans do not include these files. Their future production plan must
  // make the existing postgres-owner variant explicit, never silently select.
  assert.ok(!admitted.has(item.file),'Exact production forward-source binding required for this source-only owner profile');
  return {sql:canonical,canonical_sha256:item.sha256,forward_profile:null};
 }
 const spec=item.forward_source;
 exact(spec,['schema','profile','canonical_sha256','file','sha256']);
 assert.equal(spec.schema,'custodial.production-forward-source-binding.v1');
 assert.equal(spec.profile,profile);assert.equal(spec.canonical_sha256,admitted.get(item.file));
 assert.equal(sha(canonical),spec.canonical_sha256,'Canonical source preimage changed');
 const declared=productionForwardSourceManifest(backendRoot).migrations.find(x=>x.canonical_file===item.file);
 assert.ok(declared,'Forward source is outside the finite admitted owner closure');
 assert.equal(spec.file,declared.forward_file);assert.equal(spec.sha256,declared.forward_sha256);
 assert.equal(item.sha256,spec.sha256,'Plan digest must identify actual executed SQL');
 const sql=readFileSync(resolve(backendRoot,spec.file),'utf8');
 assert.equal(sha(sql),spec.sha256,'Executed forward-source bytes changed');
 return {sql,canonical_sha256:spec.canonical_sha256,forward_profile:profile};
}

// Source preparation only. A release author explicitly selects this one fixed
// profile; execution still needs the existing fresh backup/rehearsal signature.
// Never derive/choose an owner from arbitrary live surviving objects.
export function bindExistingPostgresForwardSources(backendRoot,canonicalItems){
 const manifest=productionForwardSourceManifest(backendRoot);
 return canonicalItems.map(item=>{
  assert.ok(!item.forward_source,'Expected unchanged canonical input declaration');
  const declared=manifest.migrations.find(x=>x.canonical_file===item.file);
  if(!declared){resolveReleaseMigrationSource(backendRoot,item);return {...item};}
  assert.equal(item.sha256,declared.canonical_sha256);
  const bound={...item,sha256:declared.forward_sha256,forward_source:{
   schema:'custodial.production-forward-source-binding.v1',profile,
   canonical_sha256:declared.canonical_sha256,file:declared.forward_file,sha256:declared.forward_sha256,
  }};
  resolveReleaseMigrationSource(backendRoot,bound);return bound;
 });
}
