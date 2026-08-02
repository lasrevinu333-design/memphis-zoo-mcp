#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sodium from "libsodium-wrappers";
import pg from "pg";
import { BOOTSTRAP } from "./production-schema-c674-bootstrap.mjs";
import {
  assertProductionDatabaseIdentity,
  productionDatabaseConnectionFromPassword,
  validateProductionDatabasePassword,
  validateProductionProjectRef,
} from "./production-database-identity.mjs";
import {
  captureSchemaCatalog,
  fingerprintSchemaCatalog,
} from "./schema-fingerprint-catalog.mjs";

const { Client } = pg;
const SECRET_NAME = "SUPABASE_DB_PASSWORD";
const GITHUB_ACTIONS_SECRETS_PUBLIC_KEY = Object.freeze({
  key_id: "3380204578043523366",
  key: "JdVX3R29kQt0kDfeAMtjNiFR4Wr78AnStHVPp0tnCmY=",
});

function decodeSecretComponent(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    assert.fail(`legacy production database ${label} is not valid URL userinfo`);
  }
}

export function extractLegacyDatabasePassword(databaseUrlInput) {
  const databaseUrl = String(databaseUrlInput || "").trim();
  assert.ok(databaseUrl, "legacy production database URL is required");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    assert.fail("legacy production database URL is not well formed");
  }
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol),
    "legacy production database URL must use PostgreSQL");
  assert.equal(parsed.hash, "", "legacy production database URL cannot contain a fragment");
  assert.equal(parsed.pathname, "/postgres", "legacy production database URL must select postgres");
  assert.equal(parsed.port || "5432", "5432", "legacy production database URL must use port 5432");
  assert.match(parsed.hostname, /^aws-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/,
    "legacy production database URL is not a managed Supabase session-pooler endpoint");
  assert.match(decodeSecretComponent(parsed.username, "username"), /^postgres\.[a-z0-9]{20}$/,
    "legacy production database username is not a Supabase project binding");
  assert.equal([...parsed.searchParams.keys()].length, 0,
    "legacy production database URL contains query parameters that cannot be carried forward");
  return validateProductionDatabasePassword(decodeSecretComponent(parsed.password, "password"));
}

export async function sealPasswordForGitHub(passwordInput) {
  const password = validateProductionDatabasePassword(passwordInput);
  await sodium.ready;
  const publicKey = sodium.from_base64(
    GITHUB_ACTIONS_SECRETS_PUBLIC_KEY.key,
    sodium.base64_variants.ORIGINAL,
  );
  assert.equal(publicKey.length, sodium.crypto_box_PUBLICKEYBYTES,
    "pinned GitHub Actions secrets public key is malformed");
  const encrypted = sodium.crypto_box_seal(sodium.from_string(password), publicKey);
  assert.equal(encrypted.length, sodium.from_string(password).length + sodium.crypto_box_SEALBYTES,
    "sealed GitHub secret has an unexpected length");
  return Object.freeze({
    key_id: GITHUB_ACTIONS_SECRETS_PUBLIC_KEY.key_id,
    encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
  });
}

async function exactPreflight(client) {
  const databaseIdentity = await assertProductionDatabaseIdentity(client, { migrationAuthority: true });
  const physical = fingerprintSchemaCatalog(await captureSchemaCatalog(client));
  assert.equal(physical.fingerprint, BOOTSTRAP.from_fingerprint,
    "credential bridge reached a database outside the reviewed pre-bootstrap physical state");
  const ledger = await client.query(`
    select count(*)::integer as migration_count,
           max(version) as max_version,
           count(*) filter (where version = $1 or name = $2)::integer as target_conflicts,
           encode(extensions.digest(convert_to(coalesce(
             jsonb_agg(jsonb_build_object(
               'version', version,
               'name', name,
               'statements', statements,
               'created_by', created_by,
               'idempotency_key', idempotency_key,
               'rollback', rollback
             ) order by version, name)::text,
             '[]'
           ), 'UTF8'), 'sha256'), 'hex') as ledger_sha256
      from supabase_migrations.schema_migrations
  `, [BOOTSTRAP.migration_version, BOOTSTRAP.migration_name]);
  assert.equal(ledger.rowCount, 1, "production migration ledger preflight is incomplete");
  assert.deepEqual(ledger.rows[0], {
    migration_count: BOOTSTRAP.before_ledger_count,
    max_version: BOOTSTRAP.before_ledger_max_version,
    target_conflicts: 0,
    ledger_sha256: BOOTSTRAP.base_ledger_sha256,
  }, "credential bridge reached a database outside the exact reviewed migration-ledger state");
  return {
    database_identity: databaseIdentity,
    physical_fingerprint: physical.fingerprint,
    migration_count: ledger.rows[0].migration_count,
    migration_max_version: ledger.rows[0].max_version,
  };
}

export async function run() {
  const legacyUrl = String(process.env.LEGACY_SUPABASE_DB_URL || "");
  const projectRef = validateProductionProjectRef(process.env.SUPABASE_PROJECT_REF);
  const caPath = resolve(String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim());
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const sourceSha = String(process.env.GITHUB_SHA || "").trim();
  const outputPath = resolve(String(process.env.SEALED_SECRET_OUT || "").trim());
  assert.equal(repository, "lasrevinu333-design/memphis-zoo-mcp", "credential bridge repository is not reviewed");
  assert.match(sourceSha, /^[0-9a-f]{40}$/, "credential bridge source SHA is required");
  assert.ok(process.env.SUPABASE_DB_CA_CERT_PATH, "production database CA certificate path is required");
  assert.ok(process.env.SEALED_SECRET_OUT, "sealed-secret output path is required");
  const password = extractLegacyDatabasePassword(legacyUrl);
  const database = productionDatabaseConnectionFromPassword(password, projectRef);
  const ca = readFileSync(caPath, "utf8");
  assert.match(ca, /-----BEGIN CERTIFICATE-----/, "production database CA certificate is invalid");
  const client = new Client({
    connectionString: database.connectionString,
    ssl: { ca, rejectUnauthorized: true },
    application_name: "memphis-zoo-production-db-credential-bridge",
  });

  let preflight;
  await client.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout = '120s'");
    preflight = await exactPreflight(client);
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }

  const sealed = await sealPasswordForGitHub(password);
  assert.match(sealed.encrypted_value, /^[A-Za-z0-9+/]+={0,2}$/,
    "sealed GitHub secret value is malformed");

  const artifact = {
    format: "memphis-zoo-github-sealed-secret.v1",
    repository,
    secret_name: SECRET_NAME,
    key_id: sealed.key_id,
    encrypted_value: sealed.encrypted_value,
    source_sha: sourceSha,
    generated_at: new Date().toISOString(),
    verification: preflight,
  };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  console.log(JSON.stringify({
    ok: true,
    sealed_for_repository: repository,
    secret_name: SECRET_NAME,
    source_sha: sourceSha,
    verification: preflight,
    output_file_created: true,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
