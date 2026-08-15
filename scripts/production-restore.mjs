#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, openAsBlob, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;
const sourceInput = String(process.env.RESTORE_SOURCE_DIR || "").trim();
const sourceDir = sourceInput ? resolve(sourceInput) : "";
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.RESTORE_CONFIRM_PROJECT_REF || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const secret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const apply = String(process.env.RESTORE_APPLY || "false").toLowerCase() === "true";
const databaseOnly = String(process.env.RESTORE_DATABASE_ONLY || "false").toLowerCase() === "true";

if (!sourceDir) throw new Error("RESTORE_SOURCE_DIR is required.");
const summary = JSON.parse(readFileSync(join(sourceDir, "backup-summary.json"), "utf8"));
if (summary.format !== "memphis-zoo-disaster-recovery.v2" || summary.ok !== true || summary.consistent_database_snapshot !== true) {
  throw new Error("Backup is not a verified Memphis Zoo disaster-recovery v2 archive.");
}

function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function qualified(schema, table) { return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`; }
function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

const checksums = readFileSync(join(sourceDir, "SHA256SUMS"), "utf8").trim().split("\n").filter(Boolean);
for (const line of checksums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error("Malformed SHA256SUMS entry.");
  const path = resolve(sourceDir, match[2]);
  if (!path.startsWith(`${sourceDir}/`)) throw new Error("Checksum path escapes the restore source.");
  if (await sha256File(path) !== match[1]) throw new Error(`Checksum mismatch for ${match[2]}.`);
}

const catalog = JSON.parse(readFileSync(join(sourceDir, "inventory", "table-catalog.json"), "utf8"));
const buckets = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-buckets.json"), "utf8"));
const objects = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-objects.json"), "utf8"));
for (const object of objects) {
  const path = resolve(sourceDir, object.file);
  if (!path.startsWith(`${sourceDir}/`) || statSync(path).size !== Number(object.size_bytes) || await sha256File(path) !== object.sha256) {
    throw new Error(`Storage object archive verification failed for ${object.id}.`);
  }
}

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    dry_run: true,
    archive_verified: true,
    project_ref_in_archive: summary.project_ref,
    tables: catalog.length,
    rows: summary.database_row_count,
    storage_buckets: buckets.length,
    storage_objects: objects.length,
  }, null, 2));
  process.exit(0);
}

if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required for restore apply.");
if (databaseOnly) {
  const target = new URL(databaseUrl);
  if (!/^(127\.0\.0\.1|localhost)$/.test(target.hostname)
      || !/^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname)) {
    throw new Error("Database-only restore is restricted to a loopback mz_schema_rebuild_* database.");
  }
} else if (!/^[a-z0-9]{20}$/.test(projectRef) || confirmedRef !== projectRef) {
  throw new Error("Destructive restore requires SUPABASE_PROJECT_REF and an exact RESTORE_CONFIRM_PROJECT_REF match.");
}
if (!databaseOnly && !secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for a production restore apply.");

const databaseTables = catalog.filter((table) => ["public", "auth"].includes(table.schema_name));

const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-disaster-restore",
  ...(databaseCaCertPath ? {
    ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true },
  } : {}),
});
await db.connect();
try {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  if (databaseTables.length) {
    await db.query(`truncate ${databaseTables.map((table) => qualified(table.schema_name, table.table_name)).join(",")} restart identity cascade`);
  }
  for (const table of databaseTables) {
    const target = qualified(table.schema_name, table.table_name);
    const columns = table.columns.filter((column) => !column.generated).map((column) => column.name);
    const projection = columns.map((column) => `r.${quoteIdentifier(column)}`).join(",");
    const insert = `insert into ${target} (${columns.map(quoteIdentifier).join(",")}) overriding system value select ${projection} from json_populate_record(null::${target},$1::json) r`;
    const input = createInterface({ input: createReadStream(join(sourceDir, table.data_file)), crlfDelay: Infinity });
    let restored = 0;
    for await (const line of input) {
      if (!line) continue;
      await db.query(insert, [line]);
      restored += 1;
    }
    if (restored !== Number(table.row_count)) throw new Error(`Row-count mismatch while restoring ${table.schema_name}.${table.table_name}.`);
  }
  await db.query("commit");
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.end();
}

if (databaseOnly) {
  console.log(JSON.stringify({
    ok: true,
    database_only: true,
    restored_database: new URL(databaseUrl).pathname.slice(1),
    tables: catalog.filter((table) => ["public", "auth"].includes(table.schema_name)).length,
    rows: databaseTables.reduce((total, table) => total + Number(table.row_count), 0),
    storage_objects_skipped: objects.length,
  }, null, 2));
  process.exit(0);
}

const supabase = createClient(`https://${projectRef}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false } });
for (const bucket of buckets) {
  const options = {
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit == null ? undefined : Number(bucket.file_size_limit),
    allowedMimeTypes: bucket.allowed_mime_types || undefined,
  };
  const created = await supabase.storage.createBucket(bucket.id, options);
  if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw created.error;
  if (created.error) {
    const updated = await supabase.storage.updateBucket(bucket.id, options);
    if (updated.error) throw updated.error;
  }
}
for (const object of objects) {
  const body = await openAsBlob(join(sourceDir, object.file), { type: object.metadata?.mimetype || "application/octet-stream" });
  const uploaded = await supabase.storage.from(object.bucket_id).upload(
    object.name,
    body,
    { upsert: true, contentType: object.metadata?.mimetype || "application/octet-stream", cacheControl: object.metadata?.cacheControl || "0" },
  );
  if (uploaded.error) throw uploaded.error;
}

console.log(JSON.stringify({ ok: true, restored_project_ref: projectRef, tables: catalog.length, storage_objects: objects.length }, null, 2));
