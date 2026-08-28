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
  restoreReconciliationBinding,
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
const reconciliationKey = "restore-reconciliation-fixture-key-000000000003";
const reconciliationKeyId = "fixture-reconciliation-key-v1";
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
const storageObjectDir = join(work, "storage", "objects");
mkdirSync(databaseDir, { mode: 0o700 });
mkdirSync(inventoryDir, { mode: 0o700 });
mkdirSync(storageObjectDir, { recursive: true, mode: 0o700 });

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
  "storage.buckets": [{ id: "fixture-private", name: "fixture-private", owner: oldEmployee, public: false, file_size_limit: 4096, allowed_mime_types: ["text/plain"], created_at: "2026-08-01T00:00:00+00:00", updated_at: "2026-08-01T00:00:00+00:00" }],
  "storage.objects": [{ id: "00000000-0000-4000-8000-000000000701", bucket_id: "fixture-private", name: "proof.txt", owner: oldEmployee, owner_id: oldEmployee, metadata: { mimetype: "text/plain", cacheControl: "3600", size: 23 }, user_metadata: { ticket: "fixture-7" }, version: "fixture-version-1", created_at: "2026-08-01T00:00:00+00:00", updated_at: "2026-08-01T00:00:00+00:00", last_accessed_at: "2026-08-01T00:00:00+00:00" }],
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
  ["storage", "buckets", ["id", "name", "owner", "public", "file_size_limit", "allowed_mime_types", "created_at", "updated_at"]],
  ["storage", "objects", ["id", "bucket_id", "name", "owner", "owner_id", "metadata", "user_metadata", "version", "created_at", "updated_at", "last_accessed_at"]],
].map(([schemaName, tableName, fieldNames]) => {
  const key = `${schemaName}.${tableName}`;
  const dataFile = `database/${key}.jsonl`;
  const rows = archiveRows[key];
  write(join(work, dataFile), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  return { schema_name: schemaName, table_name: tableName, primary_key: [fieldNames[0]], columns: columns(fieldNames), row_count: String(rows.length), data_file: dataFile };
});
write(join(inventoryDir, "table-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
const storageBytes = Buffer.from("verified storage bytes\n");
const storageFile = `storage/objects/${sha256(`fixture-private\0proof.txt`)}.bin`;
write(join(work, storageFile), storageBytes);
const storageArchiveRow = archiveRows["storage.objects"][0];
const storageObjectManifest = [{
  id: storageArchiveRow.id,
  bucket_id: storageArchiveRow.bucket_id,
  name: storageArchiveRow.name,
  file: storageFile,
  size_bytes: storageBytes.length,
  sha256: sha256(storageBytes),
  metadata: storageArchiveRow.metadata,
  user_metadata: storageArchiveRow.user_metadata,
  version: storageArchiveRow.version,
  created_at: storageArchiveRow.created_at,
  updated_at: storageArchiveRow.updated_at,
  database_row: storageArchiveRow,
}];
write(join(inventoryDir, "storage-buckets.json"), `${JSON.stringify(archiveRows["storage.buckets"], null, 2)}\n`);
write(join(inventoryDir, "storage-objects.json"), `${JSON.stringify(storageObjectManifest, null, 2)}\n`);
write(join(inventoryDir, "database-snapshot.json"), '{"snapshot_id":"fixture"}\n');
write(join(inventoryDir, "application-schema.sql"), `-- signed v4 schema fixture\n${"-- deterministic padding\n".repeat(64)}`);
write(join(inventoryDir, "migration-ledger.json"), `${JSON.stringify([{ version: "20260801000000", name: "fixture_archive_head", statements: [] }], null, 2)}\n`);
const archivedCronJobs = [{
  jobid: 3,
  schedule: "5 * * * *",
  command: "select public.expire_stale_open_sessions();",
  nodename: "localhost",
  nodeport: 5432,
  database: "fixture_source",
  username: "supabase_admin",
  active: true,
  jobname: "mz-stale-sessions-hourly",
}];
write(join(inventoryDir, "cron-jobs.json"), `${JSON.stringify(archivedCronJobs, null, 2)}\n`);
write(join(inventoryDir, "extensions.json"), `${JSON.stringify([{ extname: "plpgsql", extversion: "1.0", schema_name: "pg_catalog" }], null, 2)}\n`);
write(join(inventoryDir, "runtime-contract.json"), '{"format":"memphis-zoo.disaster-recovery-runtime-contract.v1"}\n');
write(join(inventoryDir, "runtime-configuration.json"), '{"format":"memphis-zoo.disaster-recovery-runtime-configuration.v1"}\n');

const sourceIdentity = {
  backup_tool_commit: "d".repeat(40),
  backup_tool_tree: "e".repeat(40),
  migration_head: "20260801000000",
  database_catalog_sha256: sha256(readFileSync(join(inventoryDir, "table-catalog.json"))),
  application_schema_sha256: sha256(readFileSync(join(inventoryDir, "application-schema.sql"))),
  migration_ledger_sha256: sha256(readFileSync(join(inventoryDir, "migration-ledger.json"))),
  migration_ledger_count: 1,
  cron_jobs_sha256: sha256(readFileSync(join(inventoryDir, "cron-jobs.json"))),
  cron_job_count: archivedCronJobs.length,
  extensions_sha256: sha256(readFileSync(join(inventoryDir, "extensions.json"))),
  runtime_contract_sha256: sha256(readFileSync(join(inventoryDir, "runtime-contract.json"))),
  runtime_configuration_sha256: sha256(readFileSync(join(inventoryDir, "runtime-configuration.json"))),
  pg_dump_image: `supabase/postgres@sha256:${"0".repeat(64)}`,
  release: archiveRows["public.release_deployment_manifest"][0],
};
const summary = {
  ok: true,
  format: "memphis-zoo-disaster-recovery.v4",
  consistent_database_snapshot: true,
  project_ref: projectRef,
  database_snapshot: { database_name: "fixture_source", snapshot_id: "fixture" },
  database_row_count: Object.values(archiveRows).reduce((total, rows) => total + rows.length, 0),
  source_identity: sourceIdentity,
};
write(join(work, "backup-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const files = [
  "backup-summary.json",
  ...catalog.map((table) => table.data_file),
  "inventory/database-snapshot.json",
  "inventory/application-schema.sql",
  "inventory/migration-ledger.json",
  "inventory/cron-jobs.json",
  "inventory/extensions.json",
  "inventory/runtime-contract.json",
  "inventory/runtime-configuration.json",
  "inventory/storage-buckets.json",
  "inventory/storage-objects.json",
  "inventory/table-catalog.json",
  storageFile,
].sort();
write(join(work, "SHA256SUMS"), `${files.map((file) => `${sha256(readFileSync(join(work, file)))}  ${file}`).join("\n")}\n`);
const archiveDigest = sha256(readFileSync(join(work, "SHA256SUMS")));
write(join(work, "archive-signature.json"), `${JSON.stringify({
  format: "memphis-zoo-disaster-recovery-signature.v1",
  algorithm: "hmac-sha256",
  key_id: archiveKeyId,
  archive_digest: archiveDigest,
  signature: signBinding(archiveSignatureBinding({ archiveDigest, projectRef, sourceIdentity, archiveFormat: summary.format }), archiveKey),
}, null, 2)}\n`);

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
await admin.query("do $$ begin create role anon; exception when duplicate_object then null; end $$");
await admin.query("do $$ begin create role authenticated; exception when duplicate_object then null; end $$");
await admin.query("do $$ begin create role service_role; exception when duplicate_object then null; end $$");

const migrationSql = [
  "20260820125325_custodial_disaster_restore_generation_authority.sql",
  "20260827150000_disaster_recovery_global_mutation_fence.sql",
].map((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");

async function setupTarget(databaseName, { divergent }) {
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
  const target = new Client({ connectionString: dbUrl(databaseName) });
  await target.connect();
  try {
    await target.query("create schema auth");
    await target.query("create schema storage");
    await target.query("create schema supabase_migrations");
    await target.query("create table supabase_migrations.schema_migrations(version text primary key,name text not null,statements text[] not null default '{}')");
    await target.query("insert into supabase_migrations.schema_migrations values ('20260820125325','target_head','{}')");
    await target.query("create schema cron");
    await target.query("create table cron.job(jobid bigint generated by default as identity primary key,schedule text,command text,nodename text,nodeport integer,database text,username text,active boolean,jobname text)");
    await target.query("insert into cron.job(schedule,command,nodename,nodeport,database,username,active,jobname) values ('0 0 * * *','select 1','localhost',5432,current_database(),current_user,false,'stale-target-job')");
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
    await target.query("create table storage.buckets(id text primary key,name text,owner uuid,public boolean,file_size_limit bigint,allowed_mime_types text[],created_at timestamptz,updated_at timestamptz)");
    await target.query("create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,user_metadata jsonb,version text,created_at timestamptz,updated_at timestamptz,last_accessed_at timestamptz,unique(bucket_id,name))");
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
    const generation = await target.query("select authority_generation+1 generation,state,restore_id from custodial_dr.restore_control where singleton=true");
    const migration = await target.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
    const release = await target.query("select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256 from public.release_deployment_manifest where status='deployed' order by deployed_at desc limit 1");
    const intent = {
      restore_id: randomUUID(),
      authority_generation: Number(generation.rows[0].generation),
      retry_of_restore_id: generation.rows[0].state === "PAUSED_FAILURE" ? String(generation.rows[0].restore_id) : null,
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

async function createRestoreIntent(databaseName) {
  return execFileAsync(process.execPath, [new URL("./create-production-restore-intent.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      RESTORE_SOURCE_DIR: work,
      SUPABASE_PROJECT_REF: projectRef,
      SUPABASE_DB_URL: dbUrl(databaseName),
      RESTORE_NAMED_ACTOR: "restore drill retry approver",
      RESTORE_INTENT_SIGNING_KEY: intentKey,
      RESTORE_INTENT_SIGNING_KEY_ID: intentKeyId,
      RESTORE_ARCHIVE_VERIFY_KEY: archiveKey,
      RESTORE_ARCHIVE_VERIFY_KEY_ID: archiveKeyId,
    },
  });
}

async function prepareIsolated(databaseName) {
  return execFileAsync(process.execPath, [new URL("./prepare-isolated-restore-target.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      RESTORE_SOURCE_DIR: work,
      SUPABASE_DB_URL: dbUrl(databaseName),
    },
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function createReconciliation(databaseName, resolutions = []) {
  return execFileAsync(process.execPath, [new URL("./create-production-restore-reconciliation.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      SUPABASE_DB_URL: dbUrl(databaseName),
      SUPABASE_PROJECT_REF: projectRef,
      RESTORE_RECONCILIATION_NAMED_ACTOR: "restore drill reviewer",
      RESTORE_RECONCILIATION_SIGNING_KEY: reconciliationKey,
      RESTORE_RECONCILIATION_SIGNING_KEY_ID: reconciliationKeyId,
      RESTORE_RECONCILIATION_RESOLUTIONS_JSON: JSON.stringify(resolutions),
      RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON: JSON.stringify({
        "fixture-private\0proof.txt": storageBytes.toString("base64"),
      }),
    },
  });
}

async function applyReconciliation(databaseName, envelope, extraEnv = {}) {
  return execFileAsync(process.execPath, [new URL("./apply-production-restore-reconciliation.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      SUPABASE_DB_URL: dbUrl(databaseName),
      SUPABASE_PROJECT_REF: projectRef,
      RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF: projectRef,
      RESTORE_RECONCILIATION_APPLY: "true",
      RESTORE_RECONCILIATION_VERIFY_KEY: reconciliationKey,
      RESTORE_RECONCILIATION_VERIFY_KEY_ID: reconciliationKeyId,
      RESTORE_RECONCILIATION_JSON: envelope,
      RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON: JSON.stringify({
        "fixture-private\0proof.txt": storageBytes.toString("base64"),
      }),
      ...extraEnv,
    },
  });
}

async function exactOpenResolutions(databaseName) {
  const target = new Client({ connectionString: dbUrl(databaseName) });
  await target.connect();
  try {
    const rows = await target.query("select category from custodial_dr.restore_discrepancies where status='OPEN' order by category");
    return rows.rows.map((row) => ({
      category: row.category,
      disposition: "RESOLVED",
      resolution: `The isolated retry drill verified and reconciled the exact ${row.category} state before reopening admission.`,
    }));
  } finally { await target.end(); }
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
  await assert.rejects(createReconciliation(divergentDb, []), /complete exact OPEN discrepancy set/,
    "a reconciliation that omits an open discrepancy must fail without resuming production");

  const cleanDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(cleanDb);
  await setupTarget(cleanDb, { divergent: false });
  const prepared = await prepareIsolated(cleanDb);
  assert.match(prepared.stdout, /"stage":"signed_recovery_control_hydrated"/);
  await runRestore(cleanDb, await makeIntent(cleanDb, true));
  const clean = new Client({ connectionString: dbUrl(cleanDb) });
  await clean.connect();
  try {
    const control = await clean.query("select state,mutations_paused from custodial_dr.restore_control");
    assert.deepEqual(control.rows[0], { state: "PAUSED_RECONCILIATION", mutations_paused: true },
      "even a zero-discrepancy restore remains paused for separately signed reconciliation");
    assert.equal((await clean.query("select count(*)::int count from public.audit3_restore_fixture where id=7 and body='verified restore drill'")).rows[0].count, 1);
    const cron = await clean.query("select jobid,schedule,command,database,active,jobname from cron.job");
    assert.deepEqual(cron.rows, [{
      jobid: "3",
      schedule: "5 * * * *",
      command: "select public.expire_stale_open_sessions();",
      database: cleanDb,
      active: true,
      jobname: "mz-stale-sessions-hourly",
    }], "signed pg_cron state must replace the target inventory and point at the isolated recovered database");
  } finally { await clean.end(); }

  const reconciliation = (await createReconciliation(cleanDb, [])).stdout.trim();
  await assert.rejects(applyReconciliation(cleanDb, reconciliation, { RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT: "true" }), /crash probe before commit/);
  const afterCrash = new Client({ connectionString: dbUrl(cleanDb) });
  await afterCrash.connect();
  try {
    assert.deepEqual((await afterCrash.query("select state,mutations_paused from custodial_dr.restore_control")).rows[0],
      { state: "PAUSED_RECONCILIATION", mutations_paused: true }, "a crash before reconciliation commit leaves admission paused");
  } finally { await afterCrash.end(); }
  const resumed = await applyReconciliation(cleanDb, reconciliation);
  assert.match(resumed.stdout, /"resumed":true/);
  const replay = await applyReconciliation(cleanDb, reconciliation);
  assert.match(replay.stdout, /"idempotent_replay":true/);

  const staleEnvelope = JSON.parse(reconciliation);
  staleEnvelope.intent.expires_at = new Date(Date.now() - 60_000).toISOString();
  staleEnvelope.signature = signBinding(restoreReconciliationBinding(staleEnvelope.intent), reconciliationKey);
  await assert.rejects(applyReconciliation(cleanDb, JSON.stringify(staleEnvelope)), /expired/,
    "a stale signed reconciliation cannot replay or resume a restore");

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
  const retryIntent = (await createRestoreIntent(failureDb)).stdout.trim();
  assert.match(retryIntent, /"retry_of_restore_id":"[0-9a-f-]{36}"/,
    "the supported intent command binds the exact failed restore before continuous-pause retry");
  await runRestore(failureDb, retryIntent);
  const failureRetryReconciliation = (await createReconciliation(failureDb, await exactOpenResolutions(failureDb))).stdout.trim();
  await applyReconciliation(failureDb, failureRetryReconciliation);
  const recoveredFailure = new Client({ connectionString: dbUrl(failureDb) });
  await recoveredFailure.connect();
  try {
    assert.deepEqual((await recoveredFailure.query("select state,mutations_paused,authority_generation from custodial_dr.restore_control")).rows[0],
      { state: "COMPLETE", mutations_paused: false, authority_generation: "2" },
      "a separately signed retry of PAUSED_FAILURE keeps admission paused through a fresh verified restore and reconciliation");
    const retryEvidence = await recoveredFailure.query("select release_identity->>'retry_of_restore_id' retry_of_restore_id from custodial_dr.restore_control");
    assert.match(retryEvidence.rows[0].retry_of_restore_id, /^[0-9a-f-]{36}$/);
  } finally { await recoveredFailure.end(); }

  const storageReconciliationDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(storageReconciliationDb);
  await setupTarget(storageReconciliationDb, { divergent: false });
  await runRestore(storageReconciliationDb, await makeIntent(storageReconciliationDb, true));
  const storageTarget = new Client({ connectionString: dbUrl(storageReconciliationDb) });
  await storageTarget.connect();
  try {
    const control = await storageTarget.query("select restore_id,authority_generation from custodial_dr.restore_control");
    const details = {
      discrepancies: [{ scope: "object", key: '["fixture-private","proof.txt"]', bucket_id: "fixture-private", name: "proof.txt", field: "owner_access_boundary", reason: "provider owner access requires an operator session" }],
      final_quiescent_resample: { buckets: 1, objects: 1 },
    };
    await storageTarget.query("update custodial_dr.restore_manifests set storage_verified=false,storage_evidence=$2::jsonb where restore_id=$1", [control.rows[0].restore_id, JSON.stringify(details)]);
    await storageTarget.query(`
      insert into custodial_dr.restore_discrepancies(
        restore_id,authority_generation,category,status,before_count,restored_count,details_json
      ) values($1,$2,'storage_state','OPEN',1,1,$3::jsonb)
    `, [control.rows[0].restore_id, control.rows[0].authority_generation, JSON.stringify(details)]);
  } finally { await storageTarget.end(); }
  const storageResolution = [{
    category: "storage_state",
    disposition: "RESOLVED",
    resolution: "A named operator verified the restored object through its exact owner boundary and accepted the supported metadata resample.",
    evidence: {
      format: "memphis-zoo.storage-operator-reconciliation.v2",
      platform_managed_disposition: "PRESERVED",
      verification_method: "Downloaded and hashed the exact restored object while authenticated as its recorded owner.",
      verified_at: new Date().toISOString(),
      owner_access_results: [{
        bucket_id: "fixture-private",
        name: "proof.txt",
        owner_principal_id: oldEmployee,
        non_owner_principal_id: currentEmployee,
        owner_read_succeeded: true,
        non_owner_read_denied: true,
        tested_at: new Date().toISOString(),
        evidence_reference: "Disposable drill owner and non-owner Storage requests returned the expected allow and deny results.",
      }],
    },
  }];
  const storageEnvelope = (await createReconciliation(storageReconciliationDb, storageResolution)).stdout.trim();
  await assert.rejects(applyReconciliation(storageReconciliationDb, storageEnvelope, {
    RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON: JSON.stringify({
      "fixture-private\0proof.txt": Buffer.from("changed after approval").toString("base64"),
    }),
  }), /object bytes changed after reconciliation approval|metadata or object bytes changed after reconciliation approval/i,
  "Storage bytes changed after approval must keep admission paused");
  await applyReconciliation(storageReconciliationDb, storageEnvelope);
  const reconciledStorage = new Client({ connectionString: dbUrl(storageReconciliationDb) });
  await reconciledStorage.connect();
  try {
    const manifest = await reconciledStorage.query("select storage_verified,reconciliation_manifest_sha256,storage_evidence from custodial_dr.restore_manifests");
    assert.equal(manifest.rows[0].storage_verified, true);
    assert.match(manifest.rows[0].reconciliation_manifest_sha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.rows[0].storage_evidence.operator_reconciliation.evidence.owner_access_results[0].non_owner_read_denied, true);
    assert.equal(manifest.rows[0].storage_evidence.operator_reconciliation.storage_supported_state_resample.state.object_byte_digests[0].sha256, sha256(storageBytes));
  } finally { await reconciledStorage.end(); }

  const identityRaceDb = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  databases.push(identityRaceDb);
  await setupTarget(identityRaceDb, { divergent: false });
  const identityRaceIntent = await makeIntent(identityRaceDb, true);
  const raceController = new Client({ connectionString: dbUrl(identityRaceDb) });
  await raceController.connect();
  try {
    await raceController.query("select pg_advisory_lock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
    const restorePromise = runRestore(identityRaceDb, identityRaceIntent, { RESTORE_DRILL_PREFLIGHT_BARRIER: "true" });
    let waitingAtBarrier = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const waiting = await raceController.query(`
        select exists(
          select 1 from pg_stat_activity
          where application_name='memphis-zoo-disaster-restore'
            and wait_event_type='Lock'
            and wait_event='advisory'
            and query like '%memphis-zoo-restore-drill-preflight-barrier%'
        ) waiting
      `);
      waitingAtBarrier = waiting.rows[0].waiting;
      if (waitingAtBarrier) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waitingAtBarrier, true, "the restore must reach the deterministic post-preflight race barrier");
    await raceController.query("update public.release_deployment_manifest set backend_commit=$1 where status='deployed'", ["9".repeat(40)]);
    await raceController.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
    await assert.rejects(restorePromise, /target migration or release identity changed after restore intent approval/i);
    const data = await raceController.query("select id,body from public.audit3_restore_fixture order by id");
    assert.deepEqual(data.rows, [{ id: 1, body: "stale target row" }], "a target-identity race must be rejected before destructive truncation");
    const control = await raceController.query("select state,mutations_paused from custodial_dr.restore_control");
    assert.deepEqual(control.rows[0], { state: "PAUSED_FAILURE", mutations_paused: true }, "a detected post-intent identity race must fail closed");
  } finally {
    await raceController.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))").catch(() => {});
    await raceController.end();
  }

  console.log("DISASTER_RESTORE_GENERATION_DRILL_PASS");
} finally {
  for (const databaseName of databases) {
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => {});
    await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
  }
  await admin.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
