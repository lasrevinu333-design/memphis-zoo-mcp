#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import {
  archiveSignatureBinding,
  restoreIntentBinding,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const adminUrl = String(process.env.RESTORE_DRILL_DATABASE_URL || "").trim();
if (!/(localhost|127\.0\.0\.1|test|ci)/i.test(adminUrl)) throw new Error("RESTORE_DRILL_DATABASE_URL must identify a disposable local/test PostgreSQL server.");

const projectRef = "abcdefghijklmnopqrst";
const archiveKey = "archive-verification-fixture-key-0000000000000001";
const intentKey = "restore-intent-fixture-key-0000000000000000002";
const archiveKeyId = "fixture-archive-key-v1";
const intentKeyId = "fixture-intent-key-v1";
const oldEmployee = "00000000-0000-4000-8000-000000000101";
const currentEmployee = "00000000-0000-4000-8000-000000000102";
const credentialId = "00000000-0000-4000-8000-000000000201";
const deviceUuid = "00000000-0000-4000-8000-000000000301";
const managerCredential = "00000000-0000-4000-8000-000000000401";
const archivedSession = "00000000-0000-4000-8000-000000000501";
const currentSession = "00000000-0000-4000-8000-000000000502";
const currentCorrection = "00000000-0000-4000-8000-000000000503";
const work = mkdtempSync(join(tmpdir(), "memphis-zoo-restore-drill-"));
const databaseDir = join(work, "database");
const inventoryDir = join(work, "inventory");
mkdirSync(databaseDir, { mode: 0o700 });
mkdirSync(inventoryDir, { mode: 0o700 });

function write(path, body) { writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); }
function dbUrl(name) { const url = new URL(adminUrl); url.pathname = `/${name}`; return String(url); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function columns(names) { return names.map((name) => ({ name, generated: "", identity: "", data_type: "text" })); }

const archiveRows = {
  "public.audit3_restore_fixture": [{ id: 7, body: "verified restore drill" }],
  "public.device_auth_credentials": [{ credential_id: credentialId, device_id: deviceUuid, confirmed_at: "2026-08-01T12:00:00Z", expires_at: "2030-01-01T00:00:00Z", revoked_at: null, revoked_reason: null, created_at: "2026-08-01T12:00:00Z", last_used_at: null }],
  "public.devices": [{ id: deviceUuid, device_id: "KIOSK_08", active: true, assigned_employee_id: oldEmployee, assignment_epoch: 1, last_seen_at: null, updated_at: "2026-08-01T12:00:00Z" }],
  "public.employees": [{ id: oldEmployee, employee_code: "OLD", display_name: "Archived Employee", active: true, role: "staff", updated_at: "2026-08-01T12:00:00Z" }],
  "public.ops_manager_trusted_devices": [{ credential_id: managerCredential, device_id: "MANAGER_01", device_label: "Archived Manager", max_access_level: "full_access", created_at: "2026-08-01T12:00:00Z", last_used_at: null, expires_at: "2030-01-01T00:00:00Z", revoked_at: null, revoked_reason: null }],
  "public.sessions": [{ id: archivedSession, session_uuid: "archived-session", client_session_id: "archived-client-session", location_id: deviceUuid, employee_id: oldEmployee, device_id: deviceUuid, employee_name_snapshot: "Archived Employee", location_code_snapshot: "ARCHIVE", location_name_snapshot: "Archived Location", device_identifier_snapshot: "KIOSK_08", device_name_snapshot: "Archived Employee", assignment_epoch_snapshot: 1, identity_snapshot_provenance: "session_create", status: "completed", started_at: "2026-08-01T12:00:00Z", ended_at: "2026-08-01T13:00:00Z", created_at: "2026-08-01T12:00:00Z", updated_at: "2026-08-01T13:00:00Z" }],
  "public.custodial_session_corrections": [],
  "public.completion_responses": [],
  "public.release_deployment_manifest": [{ release_id: "release-archived", backend_commit: "a".repeat(40), frontend_commit: "b".repeat(40), migration_head: "20260801000000", migration_manifest_sha256: "c".repeat(64), environment_contract_version: "fixture-v1", status: "deployed", details_json: {}, created_at: "2026-08-01T00:00:00Z", deployed_at: "2026-08-01T00:00:00Z" }],
  "auth.sessions": [{ id: "00000000-0000-4000-8000-000000000601" }],
};

const catalog = [
  ["public", "audit3_restore_fixture", ["id", "body"]],
  ["public", "device_auth_credentials", ["credential_id", "device_id", "confirmed_at", "expires_at", "revoked_at", "revoked_reason", "created_at", "last_used_at"]],
  ["public", "devices", ["id", "device_id", "active", "assigned_employee_id", "assignment_epoch", "last_seen_at", "updated_at"]],
  ["public", "employees", ["id", "employee_code", "display_name", "active", "role", "updated_at"]],
  ["public", "ops_manager_trusted_devices", ["credential_id", "device_id", "device_label", "max_access_level", "created_at", "last_used_at", "expires_at", "revoked_at", "revoked_reason"]],
  ["public", "sessions", ["id", "session_uuid", "client_session_id", "location_id", "employee_id", "device_id", "employee_name_snapshot", "location_code_snapshot", "location_name_snapshot", "device_identifier_snapshot", "device_name_snapshot", "assignment_epoch_snapshot", "identity_snapshot_provenance", "status", "started_at", "ended_at", "created_at", "updated_at"]],
  ["public", "custodial_session_corrections", ["correction_id", "operation_id", "request_fingerprint", "session_id", "corrected_by_manager_id", "corrected_by_manager_name_snapshot", "reason", "changed_fields", "effective_employee_id", "effective_employee_name_snapshot", "effective_location_id", "effective_location_code_snapshot", "effective_location_name_snapshot", "effective_device_id", "effective_device_identifier_snapshot", "effective_device_name_snapshot", "effective_assignment_epoch_snapshot", "effective_started_at", "effective_ended_at", "created_at"]],
  ["public", "completion_responses", ["id", "session_id", "client_completion_id", "location_id", "submitted_by_employee_id", "device_id", "submitted_at", "created_at"]],
  ["public", "release_deployment_manifest", ["release_id", "backend_commit", "frontend_commit", "migration_head", "migration_manifest_sha256", "environment_contract_version", "status", "details_json", "created_at", "deployed_at"]],
  ["auth", "sessions", ["id"]],
].map(([schemaName, tableName, fieldNames]) => {
  const key = `${schemaName}.${tableName}`;
  const dataFile = `database/${key}.jsonl`;
  const rows = archiveRows[key];
  write(join(work, dataFile), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  return { schema_name: schemaName, table_name: tableName, primary_key: [fieldNames[0]], columns: columns(fieldNames), row_count: String(rows.length), data_file: dataFile };
});
write(join(inventoryDir, "table-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
write(join(inventoryDir, "storage-buckets.json"), "[]\n");
write(join(inventoryDir, "storage-objects.json"), "[]\n");
write(join(inventoryDir, "database-snapshot.json"), '{"snapshot_id":"fixture"}\n');

const sourceIdentity = {
  backup_tool_commit: "d".repeat(40),
  backup_tool_tree: "e".repeat(40),
  migration_head: "20260801000000",
  database_catalog_sha256: sha256(readFileSync(join(inventoryDir, "table-catalog.json"))),
  release: archiveRows["public.release_deployment_manifest"][0],
};
const summary = {
  ok: true,
  format: "memphis-zoo-disaster-recovery.v3",
  consistent_database_snapshot: true,
  project_ref: projectRef,
  database_row_count: Object.values(archiveRows).reduce((total, rows) => total + rows.length, 0),
  source_identity: sourceIdentity,
};
write(join(work, "backup-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const files = [
  "backup-summary.json",
  ...catalog.map((table) => table.data_file),
  "inventory/database-snapshot.json",
  "inventory/storage-buckets.json",
  "inventory/storage-objects.json",
  "inventory/table-catalog.json",
].sort();
write(join(work, "SHA256SUMS"), `${files.map((file) => `${sha256(readFileSync(join(work, file)))}  ${file}`).join("\n")}\n`);
const archiveDigest = sha256(readFileSync(join(work, "SHA256SUMS")));
write(join(work, "archive-signature.json"), `${JSON.stringify({
  format: "memphis-zoo-disaster-recovery-signature.v1",
  algorithm: "hmac-sha256",
  key_id: archiveKeyId,
  archive_digest: archiveDigest,
  signature: signBinding(archiveSignatureBinding({ archiveDigest, projectRef, sourceIdentity }), archiveKey),
}, null, 2)}\n`);

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
await admin.query("do $$ begin create role anon; exception when duplicate_object then null; end $$");
await admin.query("do $$ begin create role authenticated; exception when duplicate_object then null; end $$");
await admin.query("do $$ begin create role service_role; exception when duplicate_object then null; end $$");

const migrationSql = readFileSync(new URL("../supabase/migrations/20260820125325_custodial_disaster_restore_generation_authority.sql", import.meta.url), "utf8");

async function setupTarget(databaseName, { divergent }) {
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
  const target = new Client({ connectionString: dbUrl(databaseName) });
  await target.connect();
  try {
    await target.query("create schema auth");
    await target.query("create schema supabase_migrations");
    await target.query("create table supabase_migrations.schema_migrations(version text primary key)");
    await target.query("insert into supabase_migrations.schema_migrations values ('20260820125325')");
    await target.query("create table public.audit3_restore_fixture(id integer primary key, body text not null)");
    await target.query("create table public.device_auth_credentials(credential_id uuid primary key,device_id uuid,confirmed_at timestamptz,expires_at timestamptz,revoked_at timestamptz,revoked_reason text,created_at timestamptz,last_used_at timestamptz)");
    await target.query("create table public.devices(id uuid primary key,device_id text,active boolean,assigned_employee_id uuid,assignment_epoch integer,last_seen_at timestamptz,updated_at timestamptz)");
    await target.query("create table public.employees(id uuid primary key,employee_code text,display_name text,active boolean,role text,updated_at timestamptz)");
    await target.query("create table public.ops_manager_trusted_devices(credential_id uuid primary key,device_id text,device_label text,max_access_level text,created_at timestamptz,last_used_at timestamptz,expires_at timestamptz,revoked_at timestamptz,revoked_reason text)");
    await target.query("create table public.sessions(id uuid primary key,session_uuid text,client_session_id text,location_id uuid,employee_id uuid,device_id uuid,employee_name_snapshot text,location_code_snapshot text,location_name_snapshot text,device_identifier_snapshot text,device_name_snapshot text,assignment_epoch_snapshot bigint,identity_snapshot_provenance text,status text,started_at timestamptz,ended_at timestamptz,created_at timestamptz,updated_at timestamptz)");
    await target.query("create table public.custodial_session_corrections(correction_id uuid primary key,operation_id uuid,request_fingerprint text,session_id uuid,corrected_by_manager_id uuid,corrected_by_manager_name_snapshot text,reason text,changed_fields text[],effective_employee_id uuid,effective_employee_name_snapshot text,effective_location_id uuid,effective_location_code_snapshot text,effective_location_name_snapshot text,effective_device_id uuid,effective_device_identifier_snapshot text,effective_device_name_snapshot text,effective_assignment_epoch_snapshot bigint,effective_started_at timestamptz,effective_ended_at timestamptz,created_at timestamptz)");
    await target.query("create table public.completion_responses(id uuid primary key,session_id uuid,client_completion_id text,location_id uuid,submitted_by_employee_id uuid,device_id uuid,submitted_at timestamptz,created_at timestamptz)");
    await target.query("create table public.release_deployment_manifest(release_id text primary key,backend_commit text,frontend_commit text,migration_head text,migration_manifest_sha256 text,environment_contract_version text,status text,details_json jsonb,created_at timestamptz,deployed_at timestamptz)");
    await target.query("create table auth.sessions(id uuid primary key)");
    for (const [key, rows] of Object.entries(archiveRows)) {
      if (key === "public.audit3_restore_fixture") continue;
      const [schemaName, tableName] = key.split(".");
      for (const row of rows) {
        const current = { ...row };
        if (divergent && key === "public.device_auth_credentials") { current.revoked_at = "2026-08-19T12:00:00Z"; current.revoked_reason = "lost_phone"; }
        if (divergent && key === "public.devices") { current.assigned_employee_id = currentEmployee; current.assignment_epoch = 2; current.updated_at = "2026-08-19T12:00:00Z"; }
        if (divergent && key === "public.employees") current.active = false;
        if (divergent && key === "public.release_deployment_manifest") { current.release_id = "release-current"; current.backend_commit = "f".repeat(40); current.frontend_commit = "1".repeat(40); current.migration_head = "20260820125325"; current.migration_manifest_sha256 = "2".repeat(64); current.deployed_at = "2026-08-19T00:00:00Z"; }
        const names = Object.keys(current);
        await target.query(`insert into ${pg.escapeIdentifier(schemaName)}.${pg.escapeIdentifier(tableName)}(${names.map(pg.escapeIdentifier).join(",")}) values (${names.map((_, index) => `$${index + 1}`).join(",")})`, Object.values(current));
      }
    }
    if (divergent) {
      await target.query("insert into public.sessions values ($1,'post-backup','post-backup-client',$2,$3,$2,'Current Employee','CURRENT','Current Location','KIOSK_08','Current Employee',2,'session_create','completed','2026-08-19T12:00:00Z','2026-08-19T13:00:00Z','2026-08-19T12:00:00Z','2026-08-19T13:00:00Z')", [currentSession, deviceUuid, currentEmployee]);
      await target.query("insert into public.custodial_session_corrections values ($1,$1,$2,$3,$4,'Current Manager','Corrected after backup',array['employee'],$5,'Current Employee',$6,'CURRENT','Current Location',$6,'KIOSK_08','Current Employee',2,'2026-08-19T12:00:00Z','2026-08-19T13:00:00Z','2026-08-19T14:00:00Z')", [currentCorrection, "3".repeat(64), archivedSession, managerCredential, currentEmployee, deviceUuid]);
    }
    await target.query("insert into public.audit3_restore_fixture values (1,'stale target row')");
    await target.query(migrationSql);
  } finally { await target.end(); }
}

async function makeIntent(databaseName, resumeAfterVerification) {
  const target = new Client({ connectionString: dbUrl(databaseName) });
  await target.connect();
  try {
    const generation = await target.query("select authority_generation+1 generation from custodial_dr.restore_control where singleton=true");
    const migration = await target.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
    const release = await target.query("select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256 from public.release_deployment_manifest where status='deployed' order by deployed_at desc limit 1");
    const intent = {
      restore_id: randomUUID(),
      authority_generation: Number(generation.rows[0].generation),
      archive_digest: archiveDigest,
      source_project_ref: projectRef,
      target_project_ref: projectRef,
      source_identity_sha256: sha256(stableJson(sourceIdentity)),
      target_migration_head: migration.rows[0].migration_head,
      target_release_identity: release.rows[0],
      actor: "restore drill",
      approved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      resume_after_verification: resumeAfterVerification,
    };
    return JSON.stringify({ format: "memphis-zoo-production-restore-intent.v1", algorithm: "hmac-sha256", key_id: intentKeyId, intent, signature: signBinding(restoreIntentBinding(intent), intentKey) });
  } finally { await target.end(); }
}

async function runRestore(databaseName, intentJson, extraEnv = {}) {
  return execFileAsync(process.execPath, [new URL("./production-restore.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      RESTORE_SOURCE_DIR: work,
      RESTORE_APPLY: "true",
      RESTORE_DATABASE_ONLY: "true",
      RESTORE_CONFIRM_PROJECT_REF: projectRef,
      SUPABASE_PROJECT_REF: projectRef,
      SUPABASE_DB_URL: dbUrl(databaseName),
      RESTORE_ARCHIVE_VERIFY_KEY: archiveKey,
      RESTORE_ARCHIVE_VERIFY_KEY_ID: archiveKeyId,
      RESTORE_INTENT_VERIFY_KEY: intentKey,
      RESTORE_INTENT_VERIFY_KEY_ID: intentKeyId,
      RESTORE_INTENT_JSON: intentJson,
      ...extraEnv,
    },
    maxBuffer: 32 * 1024 * 1024,
  });
}

const databases = [];
try {
  const divergentDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(divergentDb);
  await setupTarget(divergentDb, { divergent: true });
  await runRestore(divergentDb, await makeIntent(divergentDb, true));
  const divergent = new Client({ connectionString: dbUrl(divergentDb) });
  await divergent.connect();
  try {
    const control = await divergent.query("select state,mutations_paused,authority_generation from custodial_dr.restore_control");
    assert.deepEqual(control.rows[0], { state: "PAUSED_RECONCILIATION", mutations_paused: true, authority_generation: "1" });
    const credential = await divergent.query("select revoked_at is not null revoked,revoked_reason from public.device_auth_credentials where credential_id=$1", [credentialId]);
    assert.equal(credential.rows[0].revoked, true, "a credential resurrected by the archive must be invalidated");
    assert.equal(credential.rows[0].revoked_reason, "disaster_restore_generation_1");
    assert.equal((await divergent.query("select count(*)::int count from auth.sessions")).rows[0].count, 0, "restored auth sessions must be invalidated");
    assert.equal((await divergent.query("select count(*)::int count from custodial_dr.restore_discrepancies where status='OPEN'")).rows[0].count > 0, true, "assignment/status/post-backup differences must hold the application paused");
    assert.equal((await divergent.query("select count(*)::int count from custodial_dr.restore_discrepancies where status='OPEN' and category='cleaning_session_corrections'")).rows[0].count, 1, "post-backup append-only cleaning corrections must hold the application paused");
    assert.equal((await divergent.query("select count(*)::int count from custodial_dr.restore_discrepancies where status='OPEN' and category='cleaning_sessions'")).rows[0].count, 1, "post-backup immutable cleaning identity must hold the application paused");
    assert.equal((await divergent.query("select count(*)::int count from public.release_deployment_manifest where release_id='release-current'")).rows[0].count, 1, "the current release identity must survive an old data restore");
  } finally { await divergent.end(); }

  const cleanDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(cleanDb);
  await setupTarget(cleanDb, { divergent: false });
  await runRestore(cleanDb, await makeIntent(cleanDb, true));
  const clean = new Client({ connectionString: dbUrl(cleanDb) });
  await clean.connect();
  try {
    const control = await clean.query("select state,mutations_paused from custodial_dr.restore_control");
    assert.deepEqual(control.rows[0], { state: "COMPLETE", mutations_paused: false });
    assert.equal((await clean.query("select count(*)::int count from public.audit3_restore_fixture where id=7 and body='verified restore drill'")).rows[0].count, 1);
  } finally { await clean.end(); }

  const failureDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(failureDb);
  await setupTarget(failureDb, { divergent: false });
  await assert.rejects(runRestore(failureDb, await makeIntent(failureDb, true), { RESTORE_DRILL_FORCE_STORAGE_FAILURE: "true" }), /forced a Storage restoration failure/);
  const failed = new Client({ connectionString: dbUrl(failureDb) });
  await failed.connect();
  try {
    const control = await failed.query("select state,mutations_paused from custodial_dr.restore_control");
    assert.deepEqual(control.rows[0], { state: "PAUSED_FAILURE", mutations_paused: true });
  } finally { await failed.end(); }

  console.log("DISASTER_RESTORE_GENERATION_DRILL_PASS");
} finally {
  for (const databaseName of databases) {
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => {});
    await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
  }
  await admin.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
