#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";
import {
  releaseMigrationAuthorizationBinding,
  signBinding,
  stableJson,
  stableJsonFile,
  stableJsonFileSha256,
} from "./disaster-recovery-crypto.mjs";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const adminUrl = String(process.env.RELEASE_MIGRATION_TEST_DATABASE_URL || "").trim();
if (!/(localhost|127\.0\.0\.1|test|ci)/i.test(adminUrl)) throw new Error("RELEASE_MIGRATION_TEST_DATABASE_URL must identify a disposable local/test PostgreSQL server.");
const root = resolve(new URL("..", import.meta.url).pathname);
const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
const pending = new Set(state.pending_migrations.map((item) => item.file));
const migrationFiles = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
const preMigrationFiles = migrationFiles.filter((name) => !pending.has(name));
const outlookAdoptionSql = readFileSync(resolve(root, "supabase/migrations/20260827152000_adopt_outlook_event_sync_authority.sql"), "utf8");
const requestedDatabaseName = String(process.env.RELEASE_MIGRATION_TEST_DATABASE_NAME || "").trim();
if (requestedDatabaseName && !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(requestedDatabaseName)) {
  throw new Error("RELEASE_MIGRATION_TEST_DATABASE_NAME must use the disposable mz_schema_rebuild_* namespace.");
}
const databaseName = requestedDatabaseName || `mz_schema_rebuild_release_plan_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const admin = new Client({ connectionString: adminUrl });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const databaseUrl = String(url);
const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
let sourceLedgerSha256 = null;
let sourceCatalogFingerprint = null;
let sourceCatalogCounts = null;
const authorizationKey = "release-migration-authorization-fixture-key-000001";
const authorizationKeyId = "fixture-release-migration-key-v1";
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function ledgerFileSha256(rows) { return stableJsonFileSha256(rows); }
function authorizationEnvelope({ expired = false } = {}) {
  const now = Date.now();
  const plan = state.pending_migrations.map(({ order, source_migration_version, file, sha256: digest }) => ({ order, source_migration_version, file, sha256: digest }));
  const intent = {
    authorization_id: randomUUID(),
    project_ref: state.project_ref,
    candidate_commit: candidateCommit,
    candidate_tree: candidateTree,
    pending_migration_plan_sha256: sha256(stableJson(plan)),
    source_catalog_fingerprint: state.observed_production.catalog_privilege_fingerprint,
    source_migration_head: state.observed_production.ledger_head,
    source_migration_count: Number(state.observed_production.production_ledger_count),
    source_migration_ledger_sha256: sourceLedgerSha256,
    target_catalog_fingerprint: state.target.canonical_source_schema_fingerprint,
    target_migration_head: state.target.source_migration_version,
    target_migration_count: Number(state.target.production_ledger_count),
    backup: { archive_digest: "c".repeat(64), completed_at: new Date(now - 2_000).toISOString(), source_commit: candidateCommit, source_tree: candidateTree },
    rehearsal: {
      receipt_sha256: "d".repeat(64),
      attestation_sha256: "e".repeat(64),
      attestation_key_id: "fixture-rehearsal-attestation-v1",
      completed_at: new Date(now - 1_000).toISOString(),
      backup_run_id: "fixture-1",
      repository: "lasrevinu333-design/memphis-zoo-mcp",
      workflow_ref: "lasrevinu333-design/memphis-zoo-mcp/.github/workflows/production-backup-migration-rehearsal.yml@refs/heads/fixture",
      workflow_sha: candidateCommit,
      run_id: "100",
      run_attempt: "1",
      active_mutation_leases: 0,
      expired_mutation_leases: 0,
    },
    actor: "release migration test approver",
    approved_at: new Date(now).toISOString(),
    expires_at: new Date(expired ? now - 1_000 : now + 30 * 60_000).toISOString(),
  };
  return JSON.stringify({ format: "memphis-zoo-release-migration-authorization.v1", algorithm: "hmac-sha256", key_id: authorizationKeyId, intent, signature: signBinding(releaseMigrationAuthorizationBinding(intent), authorizationKey) });
}
function normalizeDisposableCronDatabase(catalog) {
  return {
    ...catalog,
    cron_jobs: catalog.cron_jobs.map((row) => row.database === databaseName ? { ...row, database: "postgres" } : row),
  };
}
function firstCatalogDifference(expected, actual) {
  for (const name of Object.keys(expected)) {
    const before = expected[name] || [];
    const after = actual[name] || [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) return { name, index, expected: before[index], actual: after[index] };
    }
  }
  return null;
}
async function runPlan(extraEnv = {}) {
  return execFileAsync(process.execPath, [resolve(root, "scripts/apply-release-migration-plan.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      SUPABASE_DB_URL: databaseUrl,
      SUPABASE_PROJECT_REF: state.project_ref,
      RELEASE_MIGRATION_CONFIRM_PROJECT_REF: state.project_ref,
      RELEASE_MIGRATION_NAMED_ACTOR: "release migration database test",
      RELEASE_MIGRATION_APPLY: "true",
      RELEASE_MIGRATION_REHEARSAL: "true",
      RELEASE_MIGRATION_CANDIDATE_COMMIT: candidateCommit,
      RELEASE_MIGRATION_CANDIDATE_TREE: candidateTree,
      RELEASE_MIGRATION_SOURCE_LEDGER_SHA256: sourceLedgerSha256,
      RELEASE_MIGRATION_TEST_SOURCE_CATALOG_FINGERPRINT: sourceCatalogFingerprint,
      RELEASE_MIGRATION_TEST_SOURCE_CATALOG_COUNTS_JSON: JSON.stringify(sourceCatalogCounts),
      ...extraEnv,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
}

await admin.connect();
await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
const db = new Client({ connectionString: databaseUrl });
try {
  await db.connect();
  await db.query("set statement_timeout=0");
  await db.query("set role pg_database_owner; grant usage on schema public to postgres; reset role");
  await db.query("create schema if not exists supabase_migrations authorization supabase_admin");
  await db.query(`
    create table supabase_migrations.schema_migrations(
      version text primary key, statements text[] not null default '{}', name text,
      created_by text, idempotency_key text, rollback text
    )
  `);
  for (const file of preMigrationFiles) await db.query(readFileSync(resolve(root, "supabase/migrations", file), "utf8"));
  // Production owns this table before source migration 152. Recreate that
  // exact owning state without recording 152 in the migration ledger.
  await db.query(outlookAdoptionSql);
  const outlookId = randomUUID();
  await db.query(`
    insert into public.events_app_outlook_sync(id,outlook_message_id,source_event_key,source_subject,payload_hash,source_payload)
    values($1,'fixture-message','fixture-event','Production-owned row',$2,'{"fixture":true}'::jsonb)
  `, [outlookId, sha256("fixture-payload")]);
  const filler = [];
  for (let index = 0; index < Number(state.observed_production.production_ledger_count) - 1; index += 1) {
    filler.push([`202601${String(index + 1).padStart(8, "0")}`, `fixture_${index + 1}`]);
  }
  filler.push([state.observed_production.ledger_head, state.observed_production.source_migration_name]);
  for (const [version, name] of filler) {
    await db.query("insert into supabase_migrations.schema_migrations(version,name,statements,created_by) values($1,$2,'{}',$3)", [version, name, "fixture"]);
  }
  const sourceLedger = await db.query("select version::text,name::text,statements from supabase_migrations.schema_migrations order by version");
  sourceLedgerSha256 = ledgerFileSha256(sourceLedger.rows);
  assert.equal(sourceLedgerSha256, sha256(stableJsonFile(sourceLedger.rows)),
    "the locked live ledger must use the exact canonical backup-file serialization");
  const beforeCatalog = normalizeDisposableCronDatabase(await captureSchemaCatalog({ query: (sql) => db.query(sql) }));
  sourceCatalogFingerprint = fingerprintSchemaCatalog(beforeCatalog).fingerprint;
  sourceCatalogCounts = Object.fromEntries(Object.entries(beforeCatalog).map(([name, rows]) => [name, rows.length]));
  assert.notEqual(sourceCatalogFingerprint, state.target.canonical_source_schema_fingerprint,
    "the local source fixture must remain distinct from the exact reviewed target catalog");
  await assert.rejects(runPlan({ RELEASE_MIGRATION_REHEARSAL: "false" }), /AUTHORIZATION_VERIFY_KEY|authorization/i,
    "the production mutator refuses to run without separately signed fresh backup/rehearsal authority");
  await assert.rejects(runPlan({
    RELEASE_MIGRATION_REHEARSAL: "false",
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY: authorizationKey,
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID: authorizationKeyId,
    RELEASE_MIGRATION_AUTHORIZATION_JSON: authorizationEnvelope({ expired: true }),
  }), /stale|authorization/i, "an expired production migration authorization is rejected before database mutation");
  await assert.rejects(runPlan({ RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER: "1" }), /failure probe after order 1/);
  assert.equal((await db.query("select count(*)::int count from supabase_migrations.schema_migrations")).rows[0].count,
    Number(state.observed_production.production_ledger_count), "failure injection rolls the complete migration plan back");
  assert.equal((await db.query("select to_regprocedure('public.custodial_begin_application_mutation_lease(uuid,text)') is not null present")).rows[0].present, false,
    "failure injection cannot leave migration-one authority behind");
  await db.query("create table public.release_plan_catalog_race_fixture(id integer primary key)");
  await assert.rejects(runPlan(), /Locked source catalog/, "an exact-head catalog change is rejected inside the migration transaction");
  await db.query("drop table public.release_plan_catalog_race_fixture");
  const firstLedger = sourceLedger.rows[0];
  await db.query("update supabase_migrations.schema_migrations set statements=array['drift'] where version=$1", [firstLedger.version]);
  await assert.rejects(runPlan(), /ledger digest/, "same count/head with an altered earlier ledger body is rejected inside the transaction");
  await db.query("update supabase_migrations.schema_migrations set statements=$2 where version=$1", [firstLedger.version, firstLedger.statements]);
  const applied = JSON.parse((await runPlan({
    RELEASE_MIGRATION_REHEARSAL: "false",
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY: authorizationKey,
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID: authorizationKeyId,
    RELEASE_MIGRATION_AUTHORIZATION_JSON: authorizationEnvelope(),
  })).stdout);
  assert.equal(applied.after_ledger_count, state.target.production_ledger_count);
  assert.equal(applied.after_ledger_head, state.target.source_migration_version);
  assert.equal(applied.outlook_rows_preserved, 1);
  const row = await db.query("select id,outlook_message_id,source_event_key,source_subject,payload_hash,source_payload from public.events_app_outlook_sync where id=$1", [outlookId]);
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].source_subject, "Production-owned row");
  const afterCatalog = normalizeDisposableCronDatabase(await captureSchemaCatalog({ query: (sql) => db.query(sql) }));
  const afterFingerprint = fingerprintSchemaCatalog(afterCatalog);
  const canonical = JSON.parse(readFileSync(resolve(root, "supabase/canonical/schema-fingerprint-input.json"), "utf8"));
  assert.equal(afterFingerprint.fingerprint, state.target.canonical_source_schema_fingerprint,
    `the exact four-migration plan must terminate at the canonical target catalog: ${JSON.stringify(firstCatalogDifference(canonical, afterFingerprint.normalized))}`);
  await assert.rejects(runPlan(), /already present|pre-migration production state|Locked source catalog/,
    "the complete plan is exactly-once and rejects replay or partial application");
  console.log("RELEASE_MIGRATION_PLAN_DATABASE_TESTS_PASS");
} finally {
  await db.end().catch(() => {});
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => {});
  await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
  await admin.end().catch(() => {});
}
