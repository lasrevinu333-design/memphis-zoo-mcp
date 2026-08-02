#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_DATABASE_IDENTITY,
  productionDatabaseConnectionFromPassword,
  productionSystemIdentifierDigest,
  validateProductionDatabaseIdentityRow,
  validateProductionDatabasePassword,
  validateProductionDatabaseUrl,
} from "./production-database-identity.mjs";
import {
  extractLegacyDatabasePassword,
  sealPasswordForGitHub,
} from "./production-database-credential-bridge.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const projectRef = PRODUCTION_DATABASE_IDENTITY.project_ref;

assert.deepEqual(PRODUCTION_DATABASE_IDENTITY, {
  project_ref: "rqquvtjdmugpigbndmne",
  session_pooler_host: "aws-1-us-east-1.pooler.supabase.com",
  system_identifier_domain: "memphis-zoo-production-system-id:v1",
  system_identifier_sha256: "353529a1fab57d124366abbaaf7a2819c4a14bbe9f7df87693ad9740c5b4c1c9",
});

const password = "fixture:@/%?# password";
const connection = productionDatabaseConnectionFromPassword(password, projectRef);
const parsed = new URL(connection.connectionString);
assert.equal(parsed.hostname, PRODUCTION_DATABASE_IDENTITY.session_pooler_host);
assert.equal(parsed.port, "5432");
assert.equal(parsed.pathname, "/postgres");
assert.equal(decodeURIComponent(parsed.username), `postgres.${projectRef}`);
assert.equal(decodeURIComponent(parsed.password), password);
assert.deepEqual(connection.safeIdentity, {
  connection_mode: "shared-session-pooler",
  project_binding: "reviewed-constant",
  database: "postgres",
  port: 5432,
});
assert.throws(() => productionDatabaseConnectionFromPassword(password, "a".repeat(20)),
  /not the reviewed Memphis Zoo project/);
assert.throws(() => validateProductionDatabasePassword("secret-sentinel\nbreak"), (error) => {
  assert.doesNotMatch(String(error.stack || error), /secret-sentinel/);
  return /control characters/.test(String(error.message));
});

assert.equal(extractLegacyDatabasePassword(
  `postgresql://postgres.${"a".repeat(20)}:${encodeURIComponent(password)}`
  + "@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
), password);
assert.throws(() => extractLegacyDatabasePassword(
  `postgresql://postgres.${"a".repeat(20)}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres?options=evil`,
), /query parameters/);
assert.throws(() => extractLegacyDatabasePassword(
  `postgresql://postgres.${"a".repeat(20)}:fixture@attacker.example:5432/postgres`,
), /not a managed Supabase/);
const sealedFixture = await sealPasswordForGitHub("fixture-password");
assert.equal(sealedFixture.key_id, "3380204578043523366");
assert.match(sealedFixture.encrypted_value, /^[A-Za-z0-9+/]+={0,2}$/);
assert.ok(Buffer.from(sealedFixture.encrypted_value, "base64").length > "fixture-password".length);

assert.equal(validateProductionDatabaseUrl(
  `postgresql://postgres.${projectRef}:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
  projectRef,
).safeIdentity.project_binding, "exact");

const fixtureSystemIdentifier = "12345678901234567890";
const fixtureDigest = productionSystemIdentifierDigest(fixtureSystemIdentifier);
assert.match(fixtureDigest, /^[a-f0-9]{64}$/);
assert.deepEqual(validateProductionDatabaseIdentityRow({
  database_role: "postgres",
  database_name: "postgres",
  system_identifier: fixtureSystemIdentifier,
  can_create_public: true,
  can_record_migration: true,
  notification_jobs_owner: "postgres",
}, { expectedSystemIdentifierSha256: fixtureDigest, migrationAuthority: true }), {
  database_role: "postgres",
  database_name: "postgres",
  system_identifier_sha256: fixtureDigest,
  can_create_public: true,
  can_record_migration: true,
  notification_jobs_owner: "postgres",
});
assert.throws(() => validateProductionDatabaseIdentityRow({
  database_role: "postgres",
  database_name: "postgres",
  system_identifier: "99999999999999999999",
}, { expectedSystemIdentifierSha256: fixtureDigest }), (error) => {
  assert.doesNotMatch(String(error.stack || error), /99999999999999999999/);
  return /physical-cluster identity/.test(String(error.message));
});

const bridgeWorkflow = read(".github/workflows/production-database-credential-bridge.yml");
const bridgeScript = read("scripts/production-database-credential-bridge.mjs");
assert.match(bridgeWorkflow, /^on:\n  workflow_dispatch:/m);
assert.doesNotMatch(bridgeWorkflow, /^\s+(?:push|pull_request|schedule):/m);
assert.match(bridgeWorkflow, /test "\$GITHUB_ACTOR" = "lasrevinu333-design"/);
assert.match(bridgeWorkflow, /test "\$GITHUB_TRIGGERING_ACTOR" = "lasrevinu333-design"/);
assert.match(bridgeWorkflow, /test "\$GITHUB_RUN_ATTEMPT" = "1"/);
assert.match(bridgeWorkflow, /test "\$EXPECTED_MAIN_SHA" = "\$GITHUB_SHA"/);
assert.match(bridgeScript, /crypto_box_seal/);
assert.doesNotMatch(bridgeScript, /spawnSync|execFile|\bgh\b/);
assert.match(bridgeWorkflow, /retention-days: 1/);
assert.doesNotMatch(bridgeWorkflow, /echo.*LEGACY_SUPABASE_DB_URL|echo.*SUPABASE_DB_PASSWORD/);

console.log(JSON.stringify({
  ok: true,
  contract: "production-database-password-and-cluster-identity",
  production_project_ref: projectRef,
  system_identifier_sha256: PRODUCTION_DATABASE_IDENTITY.system_identifier_sha256,
}, null, 2));
