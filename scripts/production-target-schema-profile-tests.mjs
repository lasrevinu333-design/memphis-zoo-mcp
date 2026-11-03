import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateProductionTargetSchemaProfile, resolveReleaseSchemaTarget } from './production-target-schema-profile.mjs';
import { fingerprintSchemaCatalog } from './schema-fingerprint-catalog.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const currentCanonical=JSON.parse(readFileSync(join(root,'supabase/canonical/schema-fingerprint-input.json'))),
 currentProfile=JSON.parse(readFileSync(join(root,'release/production-target-schema-profile.json'))),
 canonical=structuredClone(currentCanonical),profile=currentProfile.parent_profile||currentProfile;
if(currentProfile.previous_function){const previous=currentProfile.previous_function;
 const i=canonical.functions.findIndex(f=>f.schema_name===previous.schema_name&&f.function_name===previous.function_name&&f.identity_arguments===previous.identity_arguments);
 assert.ok(i>=0);canonical.functions[i]=structuredClone(previous);}
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(name, run) { run(); checks++; }
const resolved = validateProductionTargetSchemaProfile(canonical, profile);
check('distinct real physical target and canonical reference remain distinct', () => {
  assert.notEqual(resolved.canonicalFingerprint, resolved.deploymentFingerprint);
  assert.equal(fingerprintSchemaCatalog(canonical).fingerprint, resolved.canonicalFingerprint);
  assert.equal(fingerprintSchemaCatalog(resolved.deploymentCatalog).fingerprint, resolved.deploymentFingerprint);
  assert.equal(resolved.canonicalCounts.functions, 972);
  assert.equal(resolved.deploymentCounts.functions, 972);
  assert.equal(resolved.canonicalCounts.role_memberships, 10);
  assert.equal(resolved.deploymentCounts.role_memberships, 25);
});
check('functions, all grant surfaces and 21 unchanged sections remain byte-equivalent data', () => {
  for (const key of Object.keys(canonical)) {
    if (!['columns', 'policies', 'role_memberships'].includes(key)) assert.deepEqual(resolved.deploymentCatalog[key], resolved.canonicalCatalog[key]);
  }
});
check('existing notes remain in authenticated production ordinal positions without rewriting their definitions', () => {
  const rows = resolved.deploymentCatalog.columns.filter(row => row.table_name === 'events_app_events'
    && ['custodial_public_notes', 'custodial_note_codes'].includes(row.column_name));
  assert.deepEqual(rows, profile.original_columns);
});
for (const [name, edit] of [
  ['unregistered target identity', p => { p.deployment_fingerprint = '0'.repeat(64); }],
  ['different original source', p => { p.source_ledger_sha256 = '0'.repeat(64); }],
  ['unrelated capture plan', p => { p.capture.plan_sha256 = '0'.repeat(64); }],
  ['historical160 capture report', p => { p.capture.report_sha256 = '946dd61971aba8f6976b5dd463909a7808b8fba697991c9513477f325e9b1dc0'; }],
  ['historical395 target ledger', p => { p.capture.target_ledger_count = 395; }],
  ['historical400 target ledger', p => { p.capture.target_ledger_count = 400; }],
  ['historical165 pending count', p => { p.capture.pending_count = 165; }],
  ['historical399 target ledger', p => { p.capture.target_ledger_count = 399; }],
  ['historical164 pending count', p => { p.capture.pending_count = 164; }],
  ['historical398 target ledger', p => { p.capture.target_ledger_count = 398; }],
  ['historical163 pending plan', p => { p.capture.pending_count = 163; }],
  ['historical297 report cannot authorize full-hour target', p => { p.capture.report_sha256 = '8042bc5e3a1bd141442fddb2b52b532b9eb67bdec6d0588bc5b87d951920a37e'; }],

  ['historical160 pending count', p => { p.capture.pending_count = 160; }],
  ['other original archive', p => { p.archive_digest = '5a72377ae70ff1a632c3d38df52a104f5f134332a87b41fc99473e42ff2a008d'; }],
  ['new platform privilege', p => { p.original_role_memberships[0].admin_option = !p.original_role_memberships[0].admin_option; }],
  ['extra membership', p => { p.original_role_memberships.push({...p.original_role_memberships[0], member_role: 'unreviewed_actor'}); }],
  ['wrong current policy owner', p => { p.policy_owner.deployment_role = 'service_role'; }],
  ['changed existing column default', p => { p.original_columns[0].default_expression = "'changed'::text"; }],
  ['unknown profile property', p => { p.ignore_rls = true; }],
]) check(name + ' refuses', () => { const changed = clone(profile); edit(changed); assert.throws(() => validateProductionTargetSchemaProfile(canonical, changed)); });
check('changed canonical grants cannot be hidden by the deployment profile', () => {
  const changed = clone(canonical); changed.table_grants[0].is_grantable = !changed.table_grants[0].is_grantable;
  assert.throws(() => validateProductionTargetSchemaProfile(changed, profile));
});
check('changed function body cannot be hidden by the deployment profile', () => {
  const changed = clone(canonical); changed.functions[0].definition += '\n--unreviewed';
  assert.throws(() => validateProductionTargetSchemaProfile(changed, profile));
});
check('source resolver reads the declared physical profile and keeps legacy no-profile catalogs explicit', () => {
  assert.equal(resolveReleaseSchemaTarget(root).deploymentFingerprint, currentProfile.deployment_fingerprint);
  const dir = mkdtempSync(join(tmpdir(), 'custodial-schema-profile-'));
  try {
    mkdirSync(join(dir, 'supabase/canonical'), {recursive: true});
    writeFileSync(join(dir, 'supabase/canonical/schema-fingerprint-input.json'), JSON.stringify(canonical));
    writeFileSync(join(dir, 'supabase/canonical/schema-fingerprint.txt'), profile.canonical_fingerprint + '\n');
    const legacy = resolveReleaseSchemaTarget(dir);
    assert.equal(legacy.profile, null);
    assert.equal(legacy.deploymentFingerprint, legacy.canonicalFingerprint);
    assert.notEqual(legacy.deploymentFingerprint, profile.deployment_fingerprint);
  } finally { rmSync(dir, {recursive: true}); }
});
const preparationProfile=JSON.parse(readFileSync(join(root,'release/schema-evidence/SOURCE299_PRE_CAPTURE_EXPECTATION.json')));
if(preparationProfile.schema==='custodial.production-target-schema-profile.forward.v1'){
 const currentProfile=preparationProfile,profile=currentProfile.parent_profile;
 const historicalCanonical=clone(currentCanonical),predecessors=JSON.parse(readFileSync(join(root,'release/schema-evidence/SOURCE300_FUNCTION_PREDECESSORS.json')));
 for(const f of predecessors.functions){const i=historicalCanonical.functions.findIndex(row=>row.schema_name===f.schema_name&&row.function_name===f.function_name&&row.identity_arguments===f.identity_arguments);assert.ok(i>=0);historicalCanonical.functions[i]=clone(f);}
 assert.equal(fingerprintSchemaCatalog(historicalCanonical).fingerprint,preparationProfile.canonical_fingerprint);

 const forward=validateProductionTargetSchemaProfile(historicalCanonical,currentProfile);
 check('forward expectation keeps complete catalog identity and genuine parent capture',()=>{
  assert.equal(forward.canonicalFingerprint,currentProfile.canonical_fingerprint);
  assert.equal(forward.deploymentFingerprint,currentProfile.deployment_fingerprint);
  assert.equal(forward.profileQualification,'FORWARD_EXPECTATION_REQUIRES_FRESH_POPULATED_REHEARSAL');
  assert.equal(forward.profile.qualification.new_populated_target_observed,false);
  assert.deepEqual(forward.profile.parent_profile,profile);
  for(const key of Object.keys(historicalCanonical))if(!['columns','policies','role_memberships'].includes(key))
   assert.deepEqual(forward.deploymentCatalog[key],forward.canonicalCatalog[key]);
 });
 for(const [name,edit]of [
  ['forged populated observation',p=>{p.qualification.new_populated_target_observed=true;}],
  ['removed fresh rehearsal requirement',p=>{p.qualification.fresh_exact_head_populated_rehearsal_required=false;}],
  ['unreviewed forward SQL',p=>{p.forward_migration.sha256='0'.repeat(64);}],
  ['changed preceding function',p=>{p.previous_function.definition+='\n-- drift';}],
  ['changed genuine parent capture',p=>{p.parent_profile.capture.target_ledger_count=400;}],
  ['old399 ledger substituted for forward400',p=>{p.expected_ledger.target=399;}],
  ['unrelated canonical capture',p=>{p.canonical_capture.sha256='0'.repeat(64);}],
  ['unknown forward property',p=>{p.ignore_grants=true;}],
 ])check(name+' refuses',()=>{const bad=clone(currentProfile);edit(bad);assert.throws(()=>validateProductionTargetSchemaProfile(historicalCanonical,bad));});
 check('forward profile cannot hide changed current grants',()=>{const bad=clone(historicalCanonical);bad.table_grants[0].is_grantable=!bad.table_grants[0].is_grantable;
  assert.throws(()=>validateProductionTargetSchemaProfile(bad,currentProfile));});
}
console.log(JSON.stringify({status: 'PASS_SOURCE_PROFILE_ONLY', checks, database_queries: false,
  production_catalog_unchanged: true, raw_fingerprint_normalization_changed: false}));
