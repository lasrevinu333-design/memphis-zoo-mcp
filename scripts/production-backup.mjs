#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
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
import { promisify } from "node:util";
import pg from "pg";
import {
  archiveSignatureBinding,
  requireSigningKey,
  signBinding,
  stable,
  stableJsonFile,
} from "./disaster-recovery-crypto.mjs";
import { loadRecoveryRuntimeContract, validateRecoveryRuntimeConfiguration } from "./disaster-recovery-runtime-contract.mjs";
import {
  storageObjectArchivePath,
  storageOwnerPrincipalId,
  validateV4StorageArchiveObjects,
} from "./disaster-recovery-storage.mjs";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const secret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const backupDirInput = String(process.env.BACKUP_DIR || "").trim();
const backupDir = backupDirInput ? resolve(backupDirInput) : "";
const pageSize = Math.max(100, Math.min(5000, Number(process.env.BACKUP_PAGE_SIZE || 1000)));
const startedAt = new Date().toISOString();
const schemas = ["public", "auth", "storage"];
const manifestSigningKey = requireSigningKey(process.env.BACKUP_MANIFEST_SIGNING_KEY, "BACKUP_MANIFEST_SIGNING_KEY");
const manifestSigningKeyId = String(process.env.BACKUP_MANIFEST_SIGNING_KEY_ID || "").trim();
const backupToolCommit = String(process.env.BACKUP_TOOL_COMMIT || "").trim().toLowerCase();
const backupToolTree = String(process.env.BACKUP_TOOL_TREE || "").trim().toLowerCase();
const applicationSchemaPath = join(backupDir, "inventory", "application-schema.sql");
const pgDumpImage = String(process.env.BACKUP_PG_DUMP_IMAGE || "").trim();
const runtimeContractPath = resolve(String(process.env.BACKUP_RUNTIME_CONTRACT_PATH || new URL("../release/disaster-recovery-runtime-contract.json", import.meta.url).pathname));
const runtimeConfigurationInput = String(process.env.BACKUP_RUNTIME_CONFIGURATION_JSON || "").trim();

if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be the 20-character project reference.");
if (!secret) throw new Error("SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY is required for Storage object backup.");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required for a transactionally consistent snapshot.");
if (!databaseCaCertPath) throw new Error("SUPABASE_DB_CA_CERT_PATH is required for synchronized schema capture.");
if (!backupDir) throw new Error("BACKUP_DIR is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(manifestSigningKeyId)) throw new Error("BACKUP_MANIFEST_SIGNING_KEY_ID is required.");
if (!/^[0-9a-f]{40}$/.test(backupToolCommit) || !/^[0-9a-f]{40}$/.test(backupToolTree)) {
  throw new Error("BACKUP_TOOL_COMMIT and BACKUP_TOOL_TREE must be exact Git identities.");
}
if (!/^supabase\/postgres@sha256:[0-9a-f]{64}$/.test(pgDumpImage)) {
  throw new Error("BACKUP_PG_DUMP_IMAGE must pin the exact Supabase Postgres image digest.");
}
if (!runtimeConfigurationInput) throw new Error("BACKUP_RUNTIME_CONFIGURATION_JSON is required and must contain only non-secret recoverable deployment configuration.");

for (const path of [backupDir, join(backupDir, "database"), join(backupDir, "inventory"), join(backupDir, "storage", "objects")]) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function writeJson(path, value) {
  writeFileSync(path, stableJsonFile(value), { mode: 0o600 });
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

function storageConsistencyState(row) {
  // Reading an object may legitimately advance platform-managed access time.
  // Content, owner, version, and all other archived metadata must remain exact.
  const { last_accessed_at: _accessedByBackup, ...consistent } = row || {};
  return consistent;
}

async function captureApplicationSchema(exportedSnapshot) {
  if (!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(String(exportedSnapshot || ""))) {
    throw new Error("PostgreSQL did not provide a usable exported snapshot for schema capture.");
  }
  const inventoryDir = join(backupDir, "inventory");
  const caPath = resolve(databaseCaCertPath);
  const args = [
    "run", "--rm", "--entrypoint", "pg_dump",
    "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "-e", "PGDATABASE", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
    "-e", "PGSSLMODE=verify-full", "-e", "PGSSLROOTCERT=/cert/prod-ca.crt",
    "-v", `${caPath}:/cert/prod-ca.crt:ro`,
    "-v", `${inventoryDir}:/backup:rw`,
    pgDumpImage,
    "--schema-only", "--clean", "--if-exists", `--snapshot=${exportedSnapshot}`,
    "--file=/backup/application-schema.sql",
  ];
  await execFileAsync("docker", args, {
    env: { ...process.env, PGDATABASE: databaseUrl },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!statSync(applicationSchemaPath).isFile() || statSync(applicationSchemaPath).size < 1024) {
    throw new Error("The synchronized application schema is missing or implausibly small.");
  }
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-consistent-backup",
  ...(databaseCaCertPath ? {
    ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true },
  } : {}),
});
const tableCatalog = [];
const storageObjects = [];
const storageBuckets = [];
let migrationLedger = [];
let cronJobs = [];
let extensionInventory = [];
let snapshot = null;
let migrationHead = null;
let releaseIdentity = null;

await client.connect();
try {
  await client.query("begin isolation level repeatable read read only deferrable");
  const exportedSnapshotResult = await client.query("select pg_export_snapshot() exported_snapshot");
  const exportedSnapshot = String(exportedSnapshotResult.rows[0]?.exported_snapshot || "");
  await captureApplicationSchema(exportedSnapshot);
  const snapshotResult = await client.query(`
    select current_database() database_name, current_setting('server_version') server_version,
           current_setting('TimeZone') timezone, transaction_timestamp() captured_at,
           txid_current_snapshot() snapshot_id,
           $1::text schema_export_snapshot
  `, [exportedSnapshot]);
  snapshot = snapshotResult.rows[0];

  const migrationResult = await client.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
  migrationHead = String(migrationResult.rows[0]?.migration_head || "").trim();
  if (!/^\d{14}$/.test(migrationHead)) throw new Error("The production migration head is unavailable or malformed.");
  const migrationLedgerResult = await client.query(`
    select version::text, name::text, statements
    from supabase_migrations.schema_migrations
    order by version
  `);
  migrationLedger = migrationLedgerResult.rows;
  if (!migrationLedger.length || String(migrationLedger.at(-1)?.version || "") !== migrationHead) {
    throw new Error("The captured migration ledger does not terminate at the production migration head.");
  }
  const cronResult = await client.query("select row_to_json(j) row from cron.job j order by j.jobid");
  cronJobs = cronResult.rows.map((item) => item.row);
  const extensionResult = await client.query(`
    select e.extname, e.extversion, n.nspname schema_name
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    order by e.extname
  `);
  extensionInventory = extensionResult.rows;
  const releaseResult = await client.query(`
    select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256,
           environment_contract_version,status,details_json,created_at,deployed_at
    from public.release_deployment_manifest
    where status in ('deployed','validated','candidate')
    order by (status='deployed') desc,deployed_at desc nulls last,created_at desc
    limit 1
  `);
  if (releaseResult.rowCount !== 1) throw new Error("The production release identity is unavailable.");
  releaseIdentity = releaseResult.rows[0];
  if (!/^[0-9a-f]{40}$/.test(String(releaseIdentity.backend_commit || ""))
      || !/^[0-9a-f]{40}$/.test(String(releaseIdentity.frontend_commit || ""))
      || !/^\d{14}$/.test(String(releaseIdentity.migration_head || ""))
      || !/^[0-9a-f]{64}$/.test(String(releaseIdentity.migration_manifest_sha256 || ""))) {
    throw new Error("The production release identity is incomplete or malformed.");
  }
  if (String(releaseIdentity.migration_head) !== migrationHead) {
    throw new Error("The live release migration head does not equal the captured production migration ledger head.");
  }
  const runtimeContract = loadRecoveryRuntimeContract(runtimeContractPath);
  const runtimeConfiguration = validateRecoveryRuntimeConfiguration({
    contract: runtimeContract,
    configuration: JSON.parse(runtimeConfigurationInput),
    releaseIdentity,
    projectRef,
  });
  writeJson(join(backupDir, "inventory", "runtime-contract.json"), runtimeContract);
  writeJson(join(backupDir, "inventory", "runtime-configuration.json"), runtimeConfiguration);

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
  const objects = await client.query("select row_to_json(o) row from storage.objects o order by bucket_id,name,id");
  for (const item of objects.rows) {
    storageOwnerPrincipalId(item.row);
    storageObjects.push(item.row);
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
}

writeJson(join(backupDir, "inventory", "database-snapshot.json"), snapshot);
writeJson(join(backupDir, "inventory", "table-catalog.json"), tableCatalog);
writeJson(join(backupDir, "inventory", "storage-buckets.json"), storageBuckets);
writeJson(join(backupDir, "inventory", "migration-ledger.json"), migrationLedger);
writeJson(join(backupDir, "inventory", "cron-jobs.json"), cronJobs);
writeJson(join(backupDir, "inventory", "extensions.json"), extensionInventory);
const databaseCatalogSha256 = await sha256File(join(backupDir, "inventory", "table-catalog.json"));
const applicationSchemaSha256 = await sha256File(applicationSchemaPath);
const migrationLedgerSha256 = await sha256File(join(backupDir, "inventory", "migration-ledger.json"));
const cronJobsSha256 = await sha256File(join(backupDir, "inventory", "cron-jobs.json"));
const extensionsSha256 = await sha256File(join(backupDir, "inventory", "extensions.json"));
const runtimeContractSha256 = await sha256File(join(backupDir, "inventory", "runtime-contract.json"));
const runtimeConfigurationSha256 = await sha256File(join(backupDir, "inventory", "runtime-configuration.json"));

const objectManifest = [];
for (const object of storageObjects) {
  const file = storageObjectArchivePath(object.bucket_id, object.name);
  const outputPath = join(backupDir, file);
  const encodedName = String(object.name).split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${encodedName}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!response.ok || !response.body) throw new Error(`Storage backup failed for object ${object.id} with HTTP ${response.status}.`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  chmodSync(outputPath, 0o600);
  const current = await client.query(
    "select row_to_json(o) row from storage.objects o where bucket_id=$1 and name=$2",
    [object.bucket_id, object.name],
  );
  if (current.rowCount !== 1) throw new Error(`Storage object ${object.id} changed or disappeared during backup.`);
  const before = JSON.stringify(stable(storageConsistencyState(object)));
  const after = JSON.stringify(stable(storageConsistencyState(current.rows[0].row)));
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
    database_row: object,
  });
}
await client.end();
validateV4StorageArchiveObjects(objectManifest);
writeJson(join(backupDir, "inventory", "storage-objects.json"), objectManifest);

const summary = {
  ok: true,
  format: "memphis-zoo-disaster-recovery.v4",
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
  source_identity: {
    backup_tool_commit: backupToolCommit,
    backup_tool_tree: backupToolTree,
    migration_head: migrationHead,
    database_catalog_sha256: databaseCatalogSha256,
    application_schema_sha256: applicationSchemaSha256,
    migration_ledger_sha256: migrationLedgerSha256,
    migration_ledger_count: migrationLedger.length,
    cron_jobs_sha256: cronJobsSha256,
    cron_job_count: cronJobs.length,
    extensions_sha256: extensionsSha256,
    runtime_contract_sha256: runtimeContractSha256,
    runtime_configuration_sha256: runtimeConfigurationSha256,
    pg_dump_image: pgDumpImage,
    release: releaseIdentity,
  },
  schema_restore_source: "signed application-schema.sql followed by production-restore.mjs; repository migrations are forward-only after the archived head",
};
writeJson(join(backupDir, "backup-summary.json"), summary);

const hashFiles = [...walkFiles(backupDir), join(backupDir, "backup-summary.json")].sort();
const manifestLines = [];
for (const path of hashFiles) manifestLines.push(`${await sha256File(path)}  ${relative(backupDir, path)}`);
writeFileSync(join(backupDir, "SHA256SUMS"), `${manifestLines.join("\n")}\n`, { mode: 0o600 });
chmodSync(join(backupDir, "SHA256SUMS"), 0o600);
const archiveDigest = await sha256File(join(backupDir, "SHA256SUMS"));
writeJson(join(backupDir, "archive-signature.json"), {
  format: "memphis-zoo-disaster-recovery-signature.v1",
  algorithm: "hmac-sha256",
  key_id: manifestSigningKeyId,
  archive_digest: archiveDigest,
  signature: signBinding(archiveSignatureBinding({
    archiveDigest,
    projectRef,
    sourceIdentity: summary.source_identity,
    archiveFormat: summary.format,
  }), manifestSigningKey),
});

console.log(JSON.stringify({ ...summary, archive_digest: archiveDigest, backup_directory: basename(backupDir) }, null, 2));
