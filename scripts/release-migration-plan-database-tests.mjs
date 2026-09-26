#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pg from "pg";
import { captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";
import {
  releaseMigrationAuthorizationBinding,
  signBinding,
  stableJson,
  stableJsonFile,
  stableJsonFileSha256,
} from "./disaster-recovery-crypto.mjs";
import { assertOwnedReleaseFixture, canonicalReleaseFixtureConnection } from "./release-migration-fixture-guard.mjs";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const adminUrl = String(process.env.RELEASE_MIGRATION_TEST_DATABASE_URL || "").trim();
if (process.env.RELEASE_MIGRATION_TEST_USE_OWNED_CONTAINER_DB !== "1") {
  throw new Error("The release-plan database test requires its isolated owned-container wrapper.");
}
const databaseName = assertOwnedReleaseFixture({
  databaseUrl: adminUrl,
  containerId: process.env.RELEASE_MIGRATION_TEST_CONTAINER_ID,
  ownerToken: process.env.RELEASE_MIGRATION_TEST_OWNER_TOKEN,
  hostname: hostname(),
});
const { clientConfig, databaseUrl } = canonicalReleaseFixtureConnection(databaseName);
const root = resolve(new URL("..", import.meta.url).pathname);
const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
assert.deepEqual(state.pending_migrations.map(({ order, file }) => ({ order, file })), [
  { order: 1, file: "20260922050000_lunch_delivery_failure_manager_alert.sql" },
  { order: 2, file: "20260922070000_completed_cleaning_reminder_cycles.sql" },
  { order: 3, file: "20260922090000_verified_visit_reminder_state.sql" },
  { order: 4, file: "20260922163000_static_weekly_lunch_publication.sql" },
  { order: 5, file: "20260922200000_lunch_notification_producer.sql" },
  { order: 6, file: "20260922235500_static_weekly_existing_employee_restore.sql" },
  { order: 7, file: "20260923065000_static_weekly_vacate_roster_slot.sql" },
  { order: 8, file: "20260923121151_visitor_attendance_reader.sql" },
  { order: 9, file: "20260924022250_release_selection_and_occurrence_guards.sql" },
  { order: 10, file: "20260924023930_notification_receipt_and_lunch_integrity.sql" },
  { order: 11, file: "20260924032226_bind_release_selection_guard_recovery.sql" },
  { order: 12, file: "20260924042758_static_weekly_canonical_shift_end_derivation.sql" },
  { order: 13, file: "20260924044035_static_weekly_atomic_roster_completion.sql" },
  { order: 14, file: "20260924053507_assigned_phone_activation_transport.sql" },
  { order: 15, file: "20260924080839_custodial_legacy_installation_observation.sql" },
  { order: 16, file: "20260924161004_owner_oc24_cleaning_and_inspection_boundaries.sql" },
  { order: 17, file: "20260924172500_oc24_manual_contractor_lunch.sql" },
  { order: 18, file: "20260924201258_native_provider_durable_authority.sql" },
  { order: 19, file: "20260925015905_oc24_completion_selection_normalization.sql" },
  { order: 20, file: "20260925020244_oc24_bound_legacy_completion_replay.sql" },
  { order: 21, file: "20260925050718_static_weekly_staffing_command_ledger.sql" },
  { order: 22, file: "20260925054802_static_weekly_staffing_atomic_acceptance.sql" },
  { order: 23, file: "20260925190000_gps_exact_location_authority_boundary.sql" },
], "the correction release fixture must contain exactly the twenty-three candidate migrations in order");
assert.equal(
  state.pending_migrations.every((item) => item.source_migration_version > state.observed_production.ledger_head),
  true,
  "all reviewed correction migrations must advance beyond the admitted production head",
);
const pending = new Set(state.pending_migrations.map((item) => item.file));
const migrationFiles = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
const preMigrationFiles = migrationFiles.filter((name) => !pending.has(name));
const outlookAdoptionSql = readFileSync(resolve(root, "supabase/migrations/20260827152000_adopt_outlook_event_sync_authority.sql"), "utf8");
const admin = new Client(clientConfig);
const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
let sourceLedgerSha256 = null;
let sourceCatalogFingerprint = null;
let sourceCatalogCounts = null;
const authorizationKey = "release-migration-authorization-fixture-key-000001";
const authorizationKeyId = "fixture-release-migration-key-v1";
const localExecutionId = "123e4567-e89b-42d3-a456-426614174000";
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function ledgerFileSha256(rows) { return stableJsonFileSha256(rows); }
function authorizationEnvelope({ expired = false, provenanceKind = "github-actions", mixed = false } = {}) {
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
      ...(provenanceKind === "task-local" ? {
        provenance_kind: "task-local",
        local_execution_id: localExecutionId,
        candidate_commit: candidateCommit,
        candidate_tree: candidateTree,
        archive_digest: "c".repeat(64),
        result_sha256: "f".repeat(64),
        attested_at: new Date(now - 500).toISOString(),
        runner_path: "scripts/run-production-backup-migration-rehearsal.sh",
        runner_sha256: sha256(readFileSync(resolve(root, "scripts/run-production-backup-migration-rehearsal.sh"))),
        archive_local_only: true,
        external_uploads: 0,
        ...(mixed ? { repository: "lasrevinu333-design/memphis-zoo-mcp" } : {}),
      } : {
        repository: "lasrevinu333-design/memphis-zoo-mcp",
        workflow_ref: "lasrevinu333-design/memphis-zoo-mcp/.github/workflows/production-backup-migration-rehearsal.yml@refs/heads/fixture",
        workflow_sha: candidateCommit,
        run_id: "100",
        run_attempt: "1",
      }),
      active_mutation_leases: 0,
      expired_mutation_leases: 0,
      ...(provenanceKind === "task-local" ? {
        authority_health: true,
        direct_dml_denied: true,
        live_production_reads: 0,
      } : {}),
    },
    actor: "release migration database test",
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
const preflight = await admin.query("select (select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')) as public_tables, to_regclass('supabase_migrations.schema_migrations') is not null as ledger_present");
assert.equal(preflight.rows[0].public_tables, 0, "owned disposable postgres must have no application tables");
assert.equal(preflight.rows[0].ledger_present, false, "owned disposable postgres must have no migration ledger");
const db = new Client(clientConfig);
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
  const sourceCoverallDefinition = (await db.query(
    "select pg_get_functiondef('public.app_apply_coverall_assignment_policy_v2(jsonb)'::regprocedure) definition"
  )).rows[0].definition;
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
  assert.equal((await db.query(
    "select pg_get_functiondef('public.app_apply_coverall_assignment_policy_v2(jsonb)'::regprocedure) definition"
  )).rows[0].definition, sourceCoverallDefinition,
    "failure injection must restore the exact pre-migration CoverAll authority definition");
  await assert.rejects(runPlan({
    RELEASE_MIGRATION_REHEARSAL: "false",
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY: authorizationKey,
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID: authorizationKeyId,
    RELEASE_MIGRATION_AUTHORIZATION_JSON: authorizationEnvelope(),
    RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER: "1",
  }), /failure probe after order 1/,
  "GitHub authorization retains the same atomic migration transaction path");
  await assert.rejects(runPlan({
    RELEASE_MIGRATION_REHEARSAL: "false",
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY: authorizationKey,
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID: authorizationKeyId,
    RELEASE_MIGRATION_AUTHORIZATION_JSON: authorizationEnvelope({ provenanceKind: "task-local" }),
    RELEASE_MIGRATION_TEST_FAIL_AFTER_ORDER: "1",
  }), /failure probe after order 1/,
  "a valid task-local authorization reaches the same atomic migration transaction");
  assert.equal((await db.query("select count(*)::int count from supabase_migrations.schema_migrations")).rows[0].count,
    Number(state.observed_production.production_ledger_count), "task-local failure injection rolls the complete plan back");
  await assert.rejects(runPlan({
    RELEASE_MIGRATION_REHEARSAL: "false",
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY: authorizationKey,
    RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID: authorizationKeyId,
    RELEASE_MIGRATION_AUTHORIZATION_JSON: authorizationEnvelope({ provenanceKind: "task-local", mixed: true }),
  }), /mixes mutually exclusive provenance fields/i,
  "the production mutator rejects validly signed mixed local/GitHub provenance before database mutation");
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
  }).catch(async (error) => {
    // Diagnostic only in this disposable fixture: reproduce the same frozen
    // transaction bodies, show the first catalog mismatch, and ALWAYS roll back.
    // The original failed mutator is still thrown; this cannot turn a gate green.
    await db.query('begin');
    try {
      for (const item of state.pending_migrations) {
        const sql = readFileSync(resolve(root, 'supabase/migrations', item.file), 'utf8');
        assert.equal(sha256(sql), item.sha256);
        const envelope = sql.match(/^([\s\S]*?\n)?begin;\s*\n([\s\S]*)\ncommit;\s*$/i);
        await db.query(envelope ? `${envelope[1] || ''}${envelope[2]}` : sql);
      }
      const actual = fingerprintSchemaCatalog(normalizeDisposableCronDatabase(
        await captureSchemaCatalog({ query: sql => db.query(sql) })));
      const expected = JSON.parse(readFileSync(resolve(root, 'supabase/canonical/schema-fingerprint-input.json'), 'utf8'));
      console.error('ISOLATED_RELEASE_TARGET_DIFFERENCE', JSON.stringify({
        expectedFingerprint: state.target.canonical_source_schema_fingerprint,
        actualFingerprint: actual.fingerprint,
        firstDifference: firstCatalogDifference(expected, actual.normalized),
      }));
    } finally { await db.query('rollback'); }
    throw error;
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
    `the exact twenty-three-migration correction plan must terminate at the canonical target catalog: ${JSON.stringify(firstCatalogDifference(canonical, afterFingerprint.normalized))}`);
  await assert.rejects(runPlan(), /already present|pre-migration production state|Locked source catalog/,
    "the complete plan is exactly-once and rejects replay or partial application");
  console.log("RELEASE_MIGRATION_PLAN_DATABASE_TESTS_PASS");
} finally {
  await db.end().catch(() => {});
  await admin.end().catch(() => {});
}
