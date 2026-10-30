import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintSchemaCatalog } from './schema-fingerprint-catalog.mjs';

const CANONICAL = '432052a95830b4a8550cd6478d766bacc2bbbb4b2dd21d44544b238c70c5f001';
const DEPLOYMENT = 'b57982c0c739632fcbfc9ba30177fccab05a5847ce44121408b5ddab8d169d33';
const SOURCE = '0096e7c488aca86f1d38b061561696b2d4ac409036f063ffc9f196625b9ee9c2';
const FORWARD_CANONICAL='95ad1f4e76159d18c5ccdb7c84fb639918005f05155b152641f79c15919f082d';
const FORWARD_DEPLOYMENT='09a3374c452a81cd0a8904273d9212444de3ba41be01bf4d07fd887a21f4d0c6';
const COMPACT_CANONICAL='aa4d4fad502031a493a15ddfad6305d783cbae90eee5aefb85a8f0c19a737c40';
const COMPACT_DEPLOYMENT='742caa62cb7a7dff55b3ddeaf0a3eafde511930cb9d9ba7c965ed9f8be3a80a5';
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
function validateCapturedTargetSchemaProfile(canonicalCatalog, profile) {
  closed(profile, ['schema', 'canonical_fingerprint', 'deployment_fingerprint', 'source_fingerprint',
    'source_catalog_sha256', 'source_ledger_sha256', 'archive_digest', 'capture',
    'original_columns', 'original_role_memberships', 'policy_owner'], 'Closed production target profile required');
  assert.equal(profile.schema, 'custodial.production-target-schema-profile.v1');
  const compact=profile.canonical_fingerprint===COMPACT_CANONICAL,successor=profile.canonical_fingerprint===FORWARD_CANONICAL,
    canonicalFingerprint=compact?COMPACT_CANONICAL:successor?FORWARD_CANONICAL:CANONICAL,
    deploymentFingerprint=compact?COMPACT_DEPLOYMENT:successor?FORWARD_DEPLOYMENT:DEPLOYMENT;
  assert.equal(profile.canonical_fingerprint, canonicalFingerprint);
  assert.equal(profile.deployment_fingerprint, deploymentFingerprint);
  assert.equal(profile.source_fingerprint, SOURCE);
  assert.equal(profile.source_catalog_sha256, 'f034e7a0a019010093b15388ab1c2ee7865420bf343a4404d23a9a21c183b277');
  assert.equal(profile.source_ledger_sha256, '2f80104d2f1fe54a6604c2c84436f823b1a78542bc4ba3d7975236951db93b66');
  assert.equal(profile.archive_digest, '67c0d74bbf18c346314669119f0ae53ff61d9b00c4e6550b7af917b7f02bbdfe');
  closed(profile.capture, ['report_sha256', 'report_bytes', 'candidate_commit', 'candidate_tree',
    'plan_sha256', 'source_ledger_count', 'target_ledger_count', 'pending_count'], 'Exact genuine target capture required');
  assert.equal(profile.capture.report_sha256, compact?'cf5d77a95b3f7e6c64d9f321d5b3aaa19fb78d5bd2e9f313a123cfe8e323fcd3':successor?'7fded7c546d4c6d879df233f8059cbf4752433c2d9b403641730d6886452593a':'dafa8d869004fa047ec7a191b040d22503bef8001a4200a44123c860fba5ec94');
  assert.equal(profile.capture.report_bytes, compact?18593702:successor?18585920:18580457);
  assert.equal(profile.capture.candidate_commit, compact?'5455fc4b1ee2ad6910d6d52e491e5db116adee7a':successor?'7dec6b966b832a658240f114243c0d40971330dd':'588b893b761d08b5157b4ca5b926f11a784bd142');
  assert.equal(profile.capture.candidate_tree, compact?'0b42825b28bc95ce4fff61dfdb060d6d6502b0bc':successor?'10e44aad24960bfaae4121efadf850955ba4dbb9':'6783245807db5c90db056d9afaab7ba1839ca664');
  assert.equal(profile.capture.plan_sha256, compact?'ec143c3344d84f5d01fa33693827d62a19a48f491a91a553864071570a0bfff7':successor?'f92f1867a5f8ec0e7cb201b87b040d1593cefbb5f1b1d5756dda4e248b945d61':'1f9b4bf9e4721f4f9b871a762c8b76b2fdd959d4309632aba2f1ceb588aa7182');
  assert.equal(profile.capture.source_ledger_count, 235);
  assert.equal(profile.capture.target_ledger_count, compact?401:successor?400:399);
  assert.equal(profile.capture.pending_count, compact?166:successor?165:164);
  closed(profile.policy_owner, ['canonical_role', 'deployment_role', 'actual_private_schema_owners'], 'Exact policy-owner context required');
  assert.equal(profile.policy_owner.canonical_role, 'supabase_admin');
  assert.equal(profile.policy_owner.deployment_role, 'postgres');
  assert.deepEqual(profile.policy_owner.actual_private_schema_owners, [
    {schema_name: 'custodial_recovery', owner_name: 'postgres'},
    {schema_name: 'custodial_release_identity', owner_name: 'postgres'},
  ]);
  const canonical = fingerprintSchemaCatalog(canonicalCatalog);
  assert.equal(canonical.fingerprint, canonicalFingerprint, 'Complete fresh canonical catalog must remain exact');
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
  assert.equal(actual.fingerprint, deploymentFingerprint, 'Full physical catalog must equal the captured populated target');
  return {canonicalFingerprint, deploymentFingerprint,
    canonicalCatalog: canonical.normalized, deploymentCatalog: actual.normalized,
    canonicalCounts: counts(canonical.normalized), deploymentCounts: counts(actual.normalized), profile: clone(profile)};
}

// A forward expectation is not a new populated-target observation. Rebuild
// the exact captured predecessor first, then substitute the sole function
// observed after the forward SQL. No ACL, role, column, policy or other
// catalog surface is omitted. Normal release still needs its fresh populated
// target/rehearsal evidence and compares the complete physical fingerprint.
export function validateProductionTargetSchemaProfile(canonicalCatalog,profile){
 if(profile?.schema!=='custodial.production-target-schema-profile.forward.v1')return validateCapturedTargetSchemaProfile(canonicalCatalog,profile);
 closed(profile,['schema','canonical_fingerprint','deployment_fingerprint','parent_profile','previous_function',
  'forward_migration','canonical_capture','expected_ledger','qualification'],'Closed forward target profile required');
 assert.equal(profile.canonical_fingerprint,FORWARD_CANONICAL);assert.equal(profile.deployment_fingerprint,FORWARD_DEPLOYMENT);
 assert.deepEqual(profile.forward_migration,{path:'supabase/migrations/20261030031200_approved_manual_full_hour_coverers.sql',
  sha256:'de548422310c3369bac0560e14507e4022cc9d5b9effe898d4f24ae79156cf6a',bytes:4436});
 assert.deepEqual(profile.canonical_capture,{path:'release/schema-evidence/SOURCE299_CANONICAL_FORWARD_CAPTURE.json',
  sha256:'6baf6fcd8fc154921f1cada007760c6dcf4d6acd025500b1715d8c225deb167d',bytes:846});
 assert.deepEqual(profile.expected_ledger,{source:235,target:400,pending:165});
 assert.deepEqual(profile.qualification,{method:'GENUINE_PARENT_TARGET_PLUS_ACTUAL_CANONICAL_FORWARD_SQL',
  new_populated_target_observed:false,fresh_exact_head_populated_rehearsal_required:true});
 const canonical=fingerprintSchemaCatalog(canonicalCatalog);assert.equal(canonical.fingerprint,FORWARD_CANONICAL);
 const previous=profile.previous_function;
 closed(previous,['comment','definition','function_name','identity_arguments','owner_name','schema_name'],'Exact preceding function required');
 assert.equal(previous.schema_name,'public');assert.equal(previous.function_name,'static_weekly_v8_assert_lunch_document');
 assert.equal(previous.identity_arguments,'p_projection_id uuid, p_document jsonb');
 const matches=row=>row.schema_name===previous.schema_name&&row.function_name===previous.function_name&&row.identity_arguments===previous.identity_arguments,
  current=one(canonical.normalized.functions,matches,'One exact forward function required'),
  {definition:oldDefinition,...oldAttrs}=previous,{definition:newDefinition,...newAttrs}=current;
 assert.deepEqual(newAttrs,oldAttrs,'Forward function metadata changed');assert.notEqual(newDefinition,oldDefinition);
 const predecessor=clone(canonical.normalized);predecessor.functions[predecessor.functions.findIndex(matches)]=clone(previous);
 const parent=validateCapturedTargetSchemaProfile(predecessor,profile.parent_profile),deployment=clone(parent.deploymentCatalog),
  oldPhysical=one(deployment.functions,matches,'Exact captured preceding function required');
 assert.deepEqual(oldPhysical,previous);
 deployment.functions[deployment.functions.indexOf(oldPhysical)]=clone(current);
 const physical=fingerprintSchemaCatalog(deployment);assert.equal(physical.fingerprint,FORWARD_DEPLOYMENT);
 return {canonicalFingerprint:FORWARD_CANONICAL,deploymentFingerprint:FORWARD_DEPLOYMENT,
  canonicalCatalog:canonical.normalized,deploymentCatalog:physical.normalized,
  canonicalCounts:counts(canonical.normalized),deploymentCounts:counts(physical.normalized),profile:clone(profile),
  profileQualification:'FORWARD_EXPECTATION_REQUIRES_FRESH_POPULATED_REHEARSAL'};
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
  const profile=JSON.parse(raw),validated=validateProductionTargetSchemaProfile(canonicalCatalog,profile);
  if(profile.schema==='custodial.production-target-schema-profile.forward.v1'){
    for(const reference of [profile.forward_migration,profile.canonical_capture]){
      const bytes=read(reference.path);assert.equal(bytes.length,reference.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),reference.sha256,'Forward profile reference bytes differ');
    }
    const capture=JSON.parse(read(profile.canonical_capture.path));
    assert.equal(capture.status,'PASS');assert.equal(capture.profile,'normal');assert.equal(capture.canonicalCaptureQualified,true);
    assert.equal(capture.populatedTarget,false);assert.equal(capture.catalogChangedFunctions,1);
    assert.equal(capture.measuredFingerprint,FORWARD_CANONICAL);assert.equal(capture.productionWritten,false);
  }
  return {...validated,
    profileSha256: createHash('sha256').update(raw).digest('hex')};
}
