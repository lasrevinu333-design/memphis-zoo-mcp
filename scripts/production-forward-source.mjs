import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const profile='existing-postgres-owner';
const admitted=new Map([
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
