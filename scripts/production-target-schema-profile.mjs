import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintSchemaCatalog } from './schema-fingerprint-catalog.mjs';

const CANONICAL = '91eb02974fd180586869fb3d4b905da7e9bded0ac518d83b6ee03a570cd1f944';
const DEPLOYMENT = 'f67580f03992120abd4086a9b53af98b05c29469eb140013221384df57bdd160';
const SOURCE = '0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2';
const PROFILE_PATH = 'release/production-target-schema-profile.json';
const POLICIES = [
  ['custodial_native_inventory_manifest_chunks', 'native_inventory_manifest_owner'],
  ['custodial_native_inventory_requests', 'native_inventory_request_owner'],
  ['custodial_original_inventory_separation_approvals', 'original_inventory_approval_owner'],
  ['custodial_same_original_recovery_approvals', 'recovery_approval_owner'],
  ['custodial_same_original_recovery_challenges', 'recovery_challenge_owner'],
];
const PLATFORM_MEMBERSHIPS = [
  ['anon', 'authenticator', false], ['authenticated', 'authenticator', false],
  ['authenticator', 'migration_owner', true], ['authenticator', 'supabase_storage_admin', false],
  ['pg_create_subscription', 'migration_owner', true], ['pg_monitor', 'migration_owner', true],
  ['pg_monitor', 'supabase_etl_admin', false], ['pg_monitor', 'supabase_read_only_user', false],
  ['pg_read_all_data', 'migration_owner', true], ['pg_read_all_data', 'supabase_etl_admin', false],
  ['pg_read_all_data', 'supabase_read_only_user', false], ['pg_signal_backend', 'migration_owner', true],
  ['service_role', 'authenticator', false], ['supabase_privileged_role', 'migration_owner', false],
  ['supabase_privileged_role', 'supabase_etl_admin', false],
].map(([granted_role, member_role, admin_option]) => ({granted_role, member_role, grantor_role: 'migration_owner', admin_option}));
const clone = value => JSON.parse(JSON.stringify(value));
const counts = catalog => Object.fromEntries(Object.entries(catalog).map(([key, rows]) => {
  assert.ok(Array.isArray(rows), 'Every catalog section must remain an array');
  return [key, rows.length];
}));
function closed(value, keys, label) {
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), label);
  for (const key of keys) assert.ok(Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable, label);
}
function one(rows, predicate, label) {
  const found = rows.filter(predicate);
  assert.equal(found.length, 1, label);
  return found[0];
}

// This is an explicit, source-reviewed physical deployment profile. It does
// not modify catalog capture or its fingerprint, ignore roles/ACLs, or claim
// that the fresh and populated catalogs have the same physical identity.
export function validateProductionTargetSchemaProfile(canonicalCatalog, profile) {
  closed(profile, ['schema', 'canonical_fingerprint', 'deployment_fingerprint', 'source_fingerprint',
    'source_catalog_sha256', 'source_ledger_sha256', 'archive_digest', 'capture',
    'original_columns', 'original_role_memberships', 'policy_owner'], 'Closed production target profile required');
  assert.equal(profile.schema, 'custodial.production-target-schema-profile.v1');
  assert.equal(profile.canonical_fingerprint, CANONICAL);
  assert.equal(profile.deployment_fingerprint, DEPLOYMENT);
  assert.equal(profile.source_fingerprint, SOURCE);
  assert.equal(profile.source_catalog_sha256, 'f034e7a0a019010093b15388ab1c2ee7865420bf343a4404d23a9a21c183b277');
  assert.equal(profile.source_ledger_sha256, '2f80104d2f1fe54a6604c2c84436f823b1a78542bc4ba3d7975236951db93b66');
  assert.equal(profile.archive_digest, '5a72377ae70ff1a632c3d38df52a104f5f134332a87b41fc99473e42ff2a008d');
  closed(profile.capture, ['report_sha256', 'report_bytes', 'candidate_commit', 'candidate_tree',
    'plan_sha256', 'source_ledger_count', 'target_ledger_count', 'pending_count'], 'Exact genuine target capture required');
  assert.equal(profile.capture.report_sha256, '946dd61971aba8f6976b5dd463909a7808b8fba697991c9513477f325e9b1dc0');
  assert.equal(profile.capture.report_bytes, 18450496);
  assert.equal(profile.capture.candidate_commit, 'e93a29c738efb4fffd1c4caaf85f534a71a76993');
  assert.equal(profile.capture.candidate_tree, 'b4612003372064c6640bbdb4d6cc3aa22943bd69');
  assert.equal(profile.capture.plan_sha256, 'c4b55a4a78abe5e7ed8d41e9e4dee9fc515bcf6a970794ea45dd0f12b71b7051');
  assert.equal(profile.capture.source_ledger_count, 235);
  assert.equal(profile.capture.target_ledger_count, 395);
  assert.equal(profile.capture.pending_count, 160);
  closed(profile.policy_owner, ['canonical_role', 'deployment_role', 'actual_private_schema_owners'], 'Exact policy-owner context required');
  assert.equal(profile.policy_owner.canonical_role, 'supabase_admin');
  assert.equal(profile.policy_owner.deployment_role, 'postgres');
  assert.deepEqual(profile.policy_owner.actual_private_schema_owners, [
    {schema_name: 'custodial_recovery', owner_name: 'postgres'},
    {schema_name: 'custodial_release_identity', owner_name: 'postgres'},
  ]);
  const canonical = fingerprintSchemaCatalog(canonicalCatalog);
  assert.equal(canonical.fingerprint, CANONICAL, 'Complete fresh canonical catalog must remain exact');
  const deployment = clone(canonical.normalized);
  assert.ok(Array.isArray(profile.original_columns) && profile.original_columns.length === 2);
  const note = one(deployment.columns, row => row.schema_name === 'public' && row.table_name === 'events_app_events'
    && row.column_name === 'custodial_note_codes', 'Exact original note-code column required');
  const text = one(deployment.columns, row => row.schema_name === 'public' && row.table_name === 'events_app_events'
    && row.column_name === 'custodial_public_notes', 'Exact original public-note column required');
  assert.equal(note.ordinal_position, 41); assert.equal(text.ordinal_position, 42);
  const noteIndex = deployment.columns.indexOf(note), textIndex = deployment.columns.indexOf(text);
  assert.equal(textIndex, noteIndex + 1);
  const originalText = {...text, ordinal_position: 41}, originalNote = {...note, ordinal_position: 42};
  assert.deepEqual(profile.original_columns, [originalText, originalNote], 'Preserve original ordinal positions and canonical post-migration column definitions');
  deployment.columns[noteIndex] = originalText; deployment.columns[textIndex] = originalNote;
  for (const [table, name] of POLICIES) {
    const policy = one(deployment.policies, row => row.schema_name === 'public' && row.table_name === table
      && row.policy_name === name, 'Exactly five known private owner policies required');
    assert.deepEqual(policy.roles, ['supabase_admin']);
    policy.roles = ['postgres'];
  }
  assert.ok(Array.isArray(profile.original_role_memberships) && profile.original_role_memberships.length === 25);
  assert.equal(deployment.role_memberships.length, 10);
  const memberships = profile.original_role_memberships;
  for (const row of memberships) closed(row, ['granted_role', 'member_role', 'grantor_role', 'admin_option'], 'Closed source role-membership tuple required');
  const key = row => JSON.stringify([row.granted_role, row.member_role, row.grantor_role, row.admin_option]);
  assert.equal(new Set(memberships.map(key)).size, 25);
  for (const row of deployment.role_memberships) assert.equal(memberships.filter(other => key(other) === key(row)).length, 1);
  const extras = memberships.filter(row => !deployment.role_memberships.some(other => key(other) === key(row)));
  assert.deepEqual(extras.map(key).sort(), PLATFORM_MEMBERSHIPS.map(key).sort(), 'Only authenticated pre-existing platform memberships may differ');
  deployment.role_memberships = clone(memberships);
  const actual = fingerprintSchemaCatalog(deployment);
  assert.equal(actual.fingerprint, DEPLOYMENT, 'Full physical catalog must equal the captured populated target');
  return {canonicalFingerprint: CANONICAL, deploymentFingerprint: DEPLOYMENT,
    canonicalCatalog: canonical.normalized, deploymentCatalog: actual.normalized,
    canonicalCounts: counts(canonical.normalized), deploymentCounts: counts(actual.normalized), profile: clone(profile)};
}

export function resolveReleaseSchemaTarget(root) {
  const read = name => {
    const file = resolve(root, name), stat = lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Schema source must be a regular file: ' + name);
    return readFileSync(file);
  };
  const canonicalCatalog = JSON.parse(read('supabase/canonical/schema-fingerprint-input.json'));
  const identity = fingerprintSchemaCatalog(canonicalCatalog);
  assert.equal(read('supabase/canonical/schema-fingerprint.txt').toString('utf8').trim(), identity.fingerprint);
  if (!existsSync(resolve(root, PROFILE_PATH))) return {
    canonicalFingerprint: identity.fingerprint, deploymentFingerprint: identity.fingerprint,
    canonicalCatalog: identity.normalized, deploymentCatalog: identity.normalized,
    canonicalCounts: counts(identity.normalized), deploymentCounts: counts(identity.normalized), profile: null, profileSha256: null,
  };
  const raw = read(PROFILE_PATH);
  return {...validateProductionTargetSchemaProfile(canonicalCatalog, JSON.parse(raw)),
    profileSha256: createHash('sha256').update(raw).digest('hex')};
}
