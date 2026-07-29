#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import pg from "pg";

const { Client } = pg;
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const secret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const backupDirInput = String(process.env.BACKUP_DIR || "").trim();
const backupDir = backupDirInput ? resolve(backupDirInput) : "";
const pageSize = Math.max(100, Math.min(5000, Number(process.env.BACKUP_PAGE_SIZE || 1000)));
const startedAt = new Date().toISOString();
const schemas = ["public", "auth", "storage"];

if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be the 20-character project reference.");
if (!secret) throw new Error("SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY is required for Storage object backup.");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required for a transactionally consistent snapshot.");
if (!backupDir) throw new Error("BACKUP_DIR is required.");

for (const path of [backupDir, join(backupDir, "database"), join(backupDir, "inventory"), join(backupDir, "storage", "objects")]) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualified(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function walkFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else if (entry.isFile() && entry.name !== "SHA256SUMS" && entry.name !== "backup-summary.json") result.push(path);
  }
  return result.sort();
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function objectKey(bucket, name) {
  return createHash("sha256").update(`${bucket}\0${name}`).digest("hex");
}

const client = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-consistent-backup" });
const tableCatalog = [];
const storageObjects = [];
const storageBuckets = [];
let snapshot = null;

await client.connect();
try {
  await client.query("begin isolation level repeatable read read only deferrable");
  const snapshotResult = await client.query(`
    select current_database() database_name, current_setting('server_version') server_version,
           current_setting('TimeZone') timezone, transaction_timestamp() captured_at,
           txid_current_snapshot() snapshot_id
  `);
  snapshot = snapshotResult.rows[0];

  const catalogResult = await client.query(`
    select n.nspname schema_name, c.relname table_name,
           coalesce((
             select jsonb_agg(a.attname order by k.ordinality)
             from pg_index i
             cross join lateral unnest(i.indkey) with ordinality k(attnum, ordinality)
             join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
             where i.indrelid=c.oid and i.indisprimary
           ), '[]'::jsonb) primary_key,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'name',a.attname,'generated',a.attgenerated,'identity',a.attidentity,'data_type',format_type(a.atttypid,a.atttypmod)
             ) order by a.attnum)
             from pg_attribute a
             where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
           ), '[]'::jsonb) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[]) and c.relkind in ('r','p') and not c.relispartition
    order by n.nspname,c.relname
  `, [schemas]);

  for (const catalog of catalogResult.rows) {
    const target = qualified(catalog.schema_name, catalog.table_name);
    const countResult = await client.query(`select count(*)::bigint row_count from only ${target}`);
    const rowCount = String(countResult.rows[0].row_count);
    const dataFile = `database/${catalog.schema_name}.${catalog.table_name}.jsonl`;
    const outputPath = join(backupDir, dataFile);
    const stream = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
    const order = catalog.primary_key.length
      ? `order by ${catalog.primary_key.map(quoteIdentifier).join(",")}`
      : "order by ctid";
    let offset = 0;
    while (offset < Number(rowCount)) {
      const rows = await client.query(
        `select row_to_json(snapshot_row) row from (select * from only ${target} ${order} limit $1 offset $2) snapshot_row`,
        [pageSize, offset],
      );
      for (const item of rows.rows) stream.write(`${JSON.stringify(item.row)}\n`);
      if (!rows.rowCount) break;
      offset += rows.rowCount;
    }
    stream.end();
    await finished(stream);
    chmodSync(outputPath, 0o600);
    tableCatalog.push({ ...catalog, row_count: rowCount, data_file: dataFile });
  }

  const buckets = await client.query("select row_to_json(b) row from storage.buckets b order by b.id");
  storageBuckets.push(...buckets.rows.map((item) => item.row));
  const objects = await client.query(`
    select id,bucket_id,name,updated_at,created_at,last_accessed_at,metadata,version,user_metadata
    from storage.objects order by bucket_id,name,id
  `);
  storageObjects.push(...objects.rows);
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
}

writeJson(join(backupDir, "inventory", "database-snapshot.json"), snapshot);
writeJson(join(backupDir, "inventory", "table-catalog.json"), tableCatalog);
writeJson(join(backupDir, "inventory", "storage-buckets.json"), storageBuckets);

const objectManifest = [];
for (const object of storageObjects) {
  const key = objectKey(object.bucket_id, object.name);
  const file = `storage/objects/${key}.bin`;
  const outputPath = join(backupDir, file);
  const encodedName = String(object.name).split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${encodedName}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!response.ok || !response.body) throw new Error(`Storage backup failed for object ${object.id} with HTTP ${response.status}.`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  chmodSync(outputPath, 0o600);
  const current = await client.query(
    "select id,updated_at,metadata,version,user_metadata from storage.objects where bucket_id=$1 and name=$2",
    [object.bucket_id, object.name],
  );
  if (current.rowCount !== 1) throw new Error(`Storage object ${object.id} changed or disappeared during backup.`);
  const before = JSON.stringify(stable({ id: object.id, updated_at: object.updated_at, metadata: object.metadata, version: object.version, user_metadata: object.user_metadata }));
  const after = JSON.stringify(stable(current.rows[0]));
  if (before !== after) throw new Error(`Storage object ${object.id} changed during backup; retry for a coherent archive.`);
  objectManifest.push({
    id: object.id,
    bucket_id: object.bucket_id,
    name: object.name,
    file,
    size_bytes: statSync(outputPath).size,
    sha256: await sha256File(outputPath),
    metadata: object.metadata,
    user_metadata: object.user_metadata,
    version: object.version,
    created_at: object.created_at,
    updated_at: object.updated_at,
  });
}
await client.end();
writeJson(join(backupDir, "inventory", "storage-objects.json"), objectManifest);

const summary = {
  ok: true,
  format: "memphis-zoo-disaster-recovery.v2",
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  project_ref: projectRef,
  database_snapshot: snapshot,
  consistent_database_snapshot: true,
  backed_up_schemas: schemas,
  table_count: tableCatalog.length,
  database_row_count: tableCatalog.reduce((total, table) => total + Number(table.row_count), 0),
  storage_bucket_count: storageBuckets.length,
  storage_object_count: objectManifest.length,
  storage_bytes: objectManifest.reduce((total, item) => total + item.size_bytes, 0),
  schema_restore_source: "repository migrations followed by production-restore.mjs",
};
writeJson(join(backupDir, "backup-summary.json"), summary);

const hashFiles = [...walkFiles(backupDir), join(backupDir, "backup-summary.json")].sort();
const manifestLines = [];
for (const path of hashFiles) manifestLines.push(`${await sha256File(path)}  ${relative(backupDir, path)}`);
writeFileSync(join(backupDir, "SHA256SUMS"), `${manifestLines.join("\n")}\n`, { mode: 0o600 });
chmodSync(join(backupDir, "SHA256SUMS"), 0o600);

console.log(JSON.stringify({ ...summary, backup_directory: basename(backupDir) }, null, 2));
