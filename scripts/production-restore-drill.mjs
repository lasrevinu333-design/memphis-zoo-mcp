#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const adminUrl = String(process.env.RESTORE_DRILL_DATABASE_URL || "").trim();
if (!/(localhost|127\.0\.0\.1|test|ci)/i.test(adminUrl)) {
  throw new Error("RESTORE_DRILL_DATABASE_URL must identify a disposable local/test PostgreSQL server.");
}
const databaseName = `mz_schema_rebuild_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const work = mkdtempSync(join(tmpdir(), "memphis-zoo-restore-drill-"));
const databaseDir = join(work, "database");
const inventoryDir = join(work, "inventory");
mkdirSync(databaseDir, { mode: 0o700 });
mkdirSync(inventoryDir, { mode: 0o700 });

function write(path, body) { writeFileSync(path, body, { mode: 0o600 }); chmodSync(path, 0o600); }
function dbUrl(name) { const url = new URL(adminUrl); url.pathname = `/${name}`; return String(url); }

const catalog = [{
  schema_name: "public",
  table_name: "audit3_restore_fixture",
  primary_key: ["id"],
  columns: [{ name: "id", generated: "", identity: "", data_type: "integer" }, { name: "body", generated: "", identity: "", data_type: "text" }],
  row_count: "1",
  data_file: "database/public.audit3_restore_fixture.jsonl",
}];
write(join(databaseDir, "public.audit3_restore_fixture.jsonl"), '{"id":7,"body":"verified restore drill"}\n');
write(join(inventoryDir, "table-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
write(join(inventoryDir, "storage-buckets.json"), "[]\n");
write(join(inventoryDir, "storage-objects.json"), "[]\n");
write(join(inventoryDir, "database-snapshot.json"), '{"snapshot_id":"fixture"}\n');
write(join(work, "backup-summary.json"), `${JSON.stringify({
  ok: true,
  format: "memphis-zoo-disaster-recovery.v2",
  consistent_database_snapshot: true,
  project_ref: "abcdefghijklmnopqrst",
  database_row_count: 1,
}, null, 2)}\n`);
const files = [
  "backup-summary.json",
  "database/public.audit3_restore_fixture.jsonl",
  "inventory/database-snapshot.json",
  "inventory/storage-buckets.json",
  "inventory/storage-objects.json",
  "inventory/table-catalog.json",
];
write(join(work, "SHA256SUMS"), `${files.map((file) => `${createHash("sha256").update(readFileSync(join(work, file))).digest("hex")}  ${file}`).join("\n")}\n`);

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
try {
  await admin.query(`create database ${pg.escapeIdentifier(databaseName)}`);
  const target = new Client({ connectionString: dbUrl(databaseName) });
  await target.connect();
  try {
    await target.query("create table public.audit3_restore_fixture(id integer primary key, body text not null)");
    await target.query("insert into public.audit3_restore_fixture values (1,'stale target row')");
  } finally { await target.end(); }

  await execFileAsync(process.execPath, [new URL("./production-restore.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      RESTORE_SOURCE_DIR: work,
      RESTORE_APPLY: "true",
      RESTORE_CONFIRM_PROJECT_REF: "abcdefghijklmnopqrst",
      SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      SUPABASE_DB_URL: dbUrl(databaseName),
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key-not-for-production",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  const verify = new Client({ connectionString: dbUrl(databaseName) });
  await verify.connect();
  try {
    const result = await verify.query("select id,body from public.audit3_restore_fixture");
    if (result.rowCount !== 1 || result.rows[0].id !== 7 || result.rows[0].body !== "verified restore drill") {
      throw new Error("Restore drill did not reproduce the archived row exactly.");
    }
  } finally { await verify.end(); }
  console.log("AUDIT3_PRODUCTION_RESTORE_DRILL_PASS");
} finally {
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [databaseName]).catch(() => {});
  await admin.query(`drop database if exists ${pg.escapeIdentifier(databaseName)}`).catch(() => {});
  await admin.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
