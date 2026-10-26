import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateProductionTargetSchemaProfile, resolveReleaseSchemaTarget } from './production-target-schema-profile.mjs';
import { fingerprintSchemaCatalog } from './schema-fingerprint-catalog.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const canonical = JSON.parse(readFileSync(join(root, 'supabase/canonical/schema-fingerprint-input.json')));
const profile = JSON.parse(readFileSync(join(root, 'release/production-target-schema-profile.json')));
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(name, run) { run(); checks++; }
const resolved = validateProductionTargetSchemaProfile(canonical, profile);
check('distinct real physical target and canonical reference remain distinct', () => {
  assert.notEqual(resolved.canonicalFingerprint, resolved.deploymentFingerprint);
  assert.equal(fingerprintSchemaCatalog(canonical).fingerprint, resolved.canonicalFingerprint);
  assert.equal(fingerprintSchemaCatalog(resolved.deploymentCatalog).fingerprint, resolved.deploymentFingerprint);
  assert.equal(resolved.canonicalCounts.functions, 963);
  assert.equal(resolved.deploymentCounts.functions, 963);
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
  assert.equal(resolveReleaseSchemaTarget(root).deploymentFingerprint, profile.deployment_fingerprint);
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
console.log(JSON.stringify({status: 'PASS_SOURCE_PROFILE_ONLY', checks, database_queries: false,
  production_catalog_unchanged: true, raw_fingerprint_normalization_changed: false}));
