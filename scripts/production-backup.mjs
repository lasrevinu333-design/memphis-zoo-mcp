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
import { promisify, types } from "node:util";
import pg from "pg";
import {captureCatalogFromSnapshot} from "./schema-catalog-readonly-client.mjs";
import {bindBackupSchemaExtension} from "./backup-release-schema-binding.mjs";
import { captureProductionBackupOriginalMetadata,readProductionBackupOriginalRelease } from "./production-backup-original-metadata.mjs";
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
import {
  productionBackupPgDumpDockerArgs,
  productionBackupDataSchemas,
  productionBackupSnapshotStatements,
  requireProductionBackupDataScope,
  productionBackupRowCount,
  requireProductionBackupPage,
  productionBackupTextColumnsDataEncoding,
  encodeProductionBackupTextColumnsDataRow,
  productionBackupSchemaSections,
  productionBackupPgDumpSectionDockerArgs,
  requireProductionBackupSchemaSections,
} from "./production-backup-pg-dump-command.mjs";

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
const schemas = productionBackupDataSchemas;
const manifestSigningKey = requireSigningKey(process.env.BACKUP_MANIFEST_SIGNING_KEY, "BACKUP_MANIFEST_SIGNING_KEY");
const manifestSigningKeyId = String(process.env.BACKUP_MANIFEST_SIGNING_KEY_ID || "").trim();
const backupToolCommit = String(process.env.BACKUP_TOOL_COMMIT || "").trim().toLowerCase();
const backupToolTree = String(process.env.BACKUP_TOOL_TREE || "").trim().toLowerCase();
const applicationSchemaPath = join(backupDir, "inventory", "application-schema.sql");
const pgDumpImage = String(process.env.BACKUP_PG_DUMP_IMAGE || "").trim();
const runtimeContractPath = resolve(String(process.env.BACKUP_RUNTIME_CONTRACT_PATH || new URL("../release/disaster-recovery-runtime-contract.json", import.meta.url).pathname));
const runtimeConfigurationInput = String(process.env.BACKUP_RUNTIME_CONFIGURATION_JSON || "").trim();
const backupExecutionMode = String(process.env.BACKUP_EXECUTION_MODE || "github-actions").trim();
const pgDumpNetworkHostInput = String(process.env.BACKUP_PG_DUMP_NETWORK_HOST || "false").trim().toLowerCase();
if (!["github-actions", "task-local"].includes(backupExecutionMode)) throw new Error("BACKUP_EXECUTION_MODE must be github-actions or task-local.");
if (!["true", "false"].includes(pgDumpNetworkHostInput)) throw new Error("BACKUP_PG_DUMP_NETWORK_HOST must be true or false.");
if (backupExecutionMode === "task-local" && String(process.env.GITHUB_ACTIONS || "").trim()) {
  throw new Error("Task-local backup execution cannot claim GitHub Actions runtime provenance.");
}
const pgDumpNetworkHost = pgDumpNetworkHostInput === "true";

if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF must be the 20-character project reference.");
if (!secret) throw new Error("SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY is required for Storage object backup.");
if (!databaseUrl) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required for a transactionally consistent snapshot.");
if (!databaseCaCertPath) throw new Error("SUPABASE_DB_CA_CERT_PATH is required for synchronized schema capture.");
if (!backupDir) throw new Error("BACKUP_DIR is required.");
let databaseConnection;
try {
  databaseConnection = new URL(databaseUrl);
} catch {
  // The production backup contract requires a URL-form PostgreSQL connection string.
}
const databaseUsername = decodeURIComponent(databaseConnection?.username || "").trim();
const databasePassword = decodeURIComponent(databaseConnection?.password || "");
const databaseHost = String(databaseConnection?.hostname || "").trim();
const databasePort = String(databaseConnection?.port || "5432").trim();
const databaseName = decodeURIComponent(String(databaseConnection?.pathname || "").replace(/^\//, "")).trim();
if (!["postgres:", "postgresql:"].includes(databaseConnection?.protocol)
    || !databaseUsername || !databasePassword || !databaseHost
    || !/^[1-9][0-9]{0,4}$/.test(databasePort) || !databaseName || databaseName.includes("/")) {
  throw new Error("SUPABASE_DB_URL must be an explicit PostgreSQL URL for containerized pg_dump.");
}
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

// PostgreSQL JSON is DATA, not a JavaScript-number round trip. Parsing below
// validates only the closed wrapper/row shape; no parsed metadata is emitted.
function encodeRawStorageInventoryRows(rows) {
  if (!Array.isArray(rows)) throw new Error("Original Storage JSON rows are required.");
  for (const raw of rows) {
    if (typeof raw !== "string") throw new Error("Original Storage JSON text is required.");
    const shape = JSON.parse(raw);
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) throw new Error("Original Storage row object is required.");
  }
  return `[\n${rows.join(",\n")}\n]\n`;
}

function finishRawStorageObjectArchiveRow(raw, {file, size_bytes, sha256}) {
  encodeRawStorageInventoryRows([raw]);
  const shape = JSON.parse(raw);
  const fields = ["id", "bucket_id", "name", "metadata", "user_metadata", "version", "created_at", "updated_at", "database_row"].sort();
  if (JSON.stringify(Object.keys(shape).sort()) !== JSON.stringify(fields)
      || typeof file !== "string" || !/^storage\/objects\/[0-9a-f]{64}\.bin$/.test(file)
      || !Number.isSafeInteger(size_bytes) || size_bytes < 0
      || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Original Storage wrapper and exact archive-byte identity are required.");
  }
  const end = raw.lastIndexOf("}");
  return raw.slice(0, end) + "," + JSON.stringify({file, size_bytes, sha256}).slice(1) + raw.slice(end + 1);
}

function writeRawStorageInventory(path, rows) {
  writeFileSync(path, encodeRawStorageInventoryRows(rows), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualified(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

// Fixed native-column DATA projection, not a caller-selected SQL/type API.
// ALL columns retain catalog order, including generated and identity values.
function backupTextColumnsProjection(columns) {
  const unavailable = () => { throw new Error("Exact ordered backup columns are required for native text capture."); };
  if (!Array.isArray(columns) || types.isProxy(columns) || Object.getPrototypeOf(columns) !== Array.prototype
      || columns.length === 0 || Reflect.ownKeys(columns).length !== columns.length + 1) unavailable();
  const names = new Set(), keys = [], values = [];
  for (let i = 0; i < columns.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(columns, String(i));
    const column = entry && Object.hasOwn(entry, "value") ? entry.value : null;
    if (!column || typeof column !== "object" || types.isProxy(column)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(column))) unavailable();
    const field = Object.getOwnPropertyDescriptor(column, "name");
    const name = field && Object.hasOwn(field, "value") ? field.value : null;
    if (typeof name !== "string" || name.length === 0 || name.includes("\0") || names.has(name)
        || Buffer.byteLength(name, "utf8") > 63 || Buffer.from(name, "utf8").toString("utf8") !== name) unavailable();
    names.add(name);
    // E literals escape backslashes AND quotes, irrespective of the session's
    // standard_conforming_strings setting. Identifier quoting is independent.
    keys.push("E'" + name.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'");
    values.push(`snapshot_row.${quoteIdentifier(name)}::text`);
  }
  return `pg_catalog.json_object(ARRAY[${keys.join(",")}]::text[], ARRAY[${values.join(",")}]::text[])::text`;
}

// Only the owned read-only snapshots' output profile is changed.
// No session/default/role changes; restoration must independently join v2.
const backupNativeTextOutputStatements = Object.freeze([
  "set local extra_float_digits = 3",
  "set local datestyle = 'ISO, YMD'",
  "set local timezone = 'UTC'",
  "set local intervalstyle = 'postgres'",
  "set local bytea_output = 'hex'",
]);

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

async function captureApplicationSchema(exportedSnapshot) {
  if (!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(String(exportedSnapshot || ""))) {
    throw new Error("PostgreSQL did not provide a usable exported snapshot for schema capture.");
  }
  const inventoryDir = join(backupDir, "inventory");
  const caPath = resolve(databaseCaCertPath);
  const args = productionBackupPgDumpDockerArgs({
    caPath,
    databaseHost,
    databaseName,
    databasePort,
    databaseUsername,
    exportedSnapshot,
    inventoryDir,
    networkHost: pgDumpNetworkHost,
    executionMode: backupExecutionMode,
    pgDumpImage,
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
  });
  await execFileAsync("docker", args, {
    env: { ...process.env, PGPASSWORD: databasePassword },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!statSync(applicationSchemaPath).isFile() || statSync(applicationSchemaPath).size < 1024) {
    throw new Error("The synchronized application schema is missing or implausibly small.");
  }
  const sections = [];
  for (const profile of productionBackupSchemaSections) {
    await execFileAsync("docker", productionBackupPgDumpSectionDockerArgs({
      caPath, databaseHost, databaseName, databasePort, databaseUsername,
      exportedSnapshot, inventoryDir, networkHost: pgDumpNetworkHost,
      executionMode: backupExecutionMode, pgDumpImage,
      uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
    }, profile.section), {
      env: { ...process.env, PGPASSWORD: databasePassword },
      maxBuffer: 10 * 1024 * 1024,
    });
    const sectionPath = join(backupDir, profile.path);
    const state = statSync(sectionPath);
    if (!state.isFile() || state.size === 0) {
      throw new Error("The synchronized schema evidence section is missing or empty.");
    }
    sections.push({ ...profile, sha256: await sha256File(sectionPath) });
  }
  return requireProductionBackupSchemaSections(sections);
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-consistent-backup",
  ...(databaseCaCertPath ? {
    ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true },
  } : {}),
});
const tableCatalog = [];
let databaseRowCount = 0;
const storageObjects = [];
const storageBuckets = [];
let storageConsistencyProjection = null;
let migrationLedger = [];
let cronJobs = [];
let extensionInventory = [];
let snapshot = null;
let migrationHead = null;
let releaseIdentity = null;
let sourceSchemaBinding = null;
let applicationSchemaSections = null;
let originalMetadata = null;

const endBackupClient = Client.prototype.end;
let backupTransactionMayBeOpen = false;
let backupLifecycleFailed = false;
let backupLifecycleFailure;
const backupCleanupErrors = [];
let finishBackupArtifacts;
try {
  await client.connect();
  backupTransactionMayBeOpen = true;
  for (const statement of productionBackupSnapshotStatements) await client.query(statement);
  for (const statement of backupNativeTextOutputStatements) await client.query(statement);
  const exportedSnapshotResult = await client.query("select pg_export_snapshot() exported_snapshot");
  const exportedSnapshot = String(exportedSnapshotResult.rows[0]?.exported_snapshot || "");
  applicationSchemaSections = await captureApplicationSchema(exportedSnapshot);
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
  const cronResult = await client.query(`
    select json_build_object(
      'jobid', j.jobid::text, 'schedule', j.schedule, 'command', j.command,
      'nodename', j.nodename, 'nodeport', j.nodeport, 'database', j.database,
      'username', j.username, 'active', j.active, 'jobname', j.jobname
    ) row from cron.job j order by j.jobid
  `);
  cronJobs = cronResult.rows.map((item) => {
    const row = item.row;
    if (typeof row?.jobid !== "string" || !/^[1-9][0-9]{0,18}$/.test(row.jobid) || row.jobid.trim() !== row.jobid
        || BigInt(row.jobid) > 9223372036854775807n) {
      throw new Error("The captured pg_cron BIGINT jobid is unavailable or malformed.");
    }
    return row;
  });
  const extensionResult = await client.query(`
    select e.extname, e.extversion, n.nspname schema_name
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    order by e.extname
  `);
  extensionInventory = extensionResult.rows;
  const releaseResult = await client.query(`
    select row_to_json(r)::text original_row
    from public.release_deployment_manifest r
    where status='deployed'
    order by deployed_at desc nulls last,created_at desc,release_id
  `);
  if (releaseResult.rowCount !== 1) {
    throw new Error(`Production backup requires exactly one deployed release identity; found ${releaseResult.rowCount}.`);
  }
  releaseIdentity = readProductionBackupOriginalRelease(releaseResult);
  if (!/^[0-9a-f]{40}$/.test(String(releaseIdentity.backend_commit || ""))
      || !/^[0-9a-f]{40}$/.test(String(releaseIdentity.frontend_commit || ""))
      || !/^\d{14}$/.test(String(releaseIdentity.migration_head || ""))
      || !/^[0-9a-f]{64}$/.test(String(releaseIdentity.migration_manifest_sha256 || ""))) {
    throw new Error("The production release identity is incomplete or malformed.");
  }
  if (String(releaseIdentity.migration_head) !== migrationHead) {
    // Preserve both true identities; admit only the exact previously applied
    // source extension, never an arbitrary drift or invented deployed release.
    const catalog=await captureCatalogFromSnapshot(client);
    const declaration=JSON.parse(readFileSync(new URL("../release/production-backup-source-extension.json",import.meta.url),"utf8"));
    sourceSchemaBinding=bindBackupSchemaExtension({projectRef,releaseIdentity,migrationLedger,catalog,declaration,
      readSource:(filename,location)=>readFileSync(new URL((location==="retained_installed"?"../release/installed-source/":"../supabase/migrations/")+filename,import.meta.url))});
    writeJson(join(backupDir,"inventory","source-catalog.json"),catalog);
    writeJson(join(backupDir,"inventory","source-schema-binding.json"),sourceSchemaBinding);
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

  const namespaceResult = await client.query(`
    select nspname schema_name,has_schema_privilege(current_user,oid,'USAGE') usage_allowed
    from pg_namespace where nspname=any($1::text[]) order by nspname
  `, [schemas]);
  const privateRelationResult = await client.query(`
    select c.relname table_name,c.relkind::text relation_kind,c.relispartition is_partition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='custodial_release_identity' and c.relkind in ('r','p','f') order by c.relname
  `);
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
  requireProductionBackupDataScope(namespaceResult.rows,privateRelationResult.rows,catalogResult.rows);

  for (const catalog of catalogResult.rows) {
    const target = qualified(catalog.schema_name, catalog.table_name);
    const rowProjection = backupTextColumnsProjection(catalog.columns);
    const countResult = await client.query(`select count(*)::bigint row_count from only ${target}`);
    const countedRows = productionBackupRowCount(countResult);
    const rowCount = String(countedRows);
    const dataFile = `database/${catalog.schema_name}.${catalog.table_name}.jsonl`;
    const outputPath = join(backupDir, dataFile);
    const stream = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
    const settled = finished(stream);
    settled.catch(() => {});
    const order = catalog.primary_key.length
      ? `order by ${catalog.primary_key.map(quoteIdentifier).join(",")}`
      : "order by ctid";
    let offset = 0;
    try {
      while (offset < countedRows) {
        const result = await client.query(
          `select ${rowProjection} as row from (select * from only ${target} ${order} limit $1 offset $2) snapshot_row`,
          [pageSize, offset],
        );
        const rows = requireProductionBackupPage(result,{offset,rowCount:countedRows,pageSize});
        for (const item of rows) stream.write(`${encodeProductionBackupTextColumnsDataRow(item.row)}\n`);
        offset += rows.length;
      }
      if (offset !== countedRows) throw new Error("Backup table export did not preserve its counted snapshot rows.");
      stream.end();
      await settled;
    } catch (error) {
      // Retain the incomplete unsealed file, but settle its owned handle. No
      // catalog/signature can promote a short/failed export to a good backup.
      stream.destroy();
      await settled.catch(() => {});
      throw error;
    }
    chmodSync(outputPath, 0o600);
    databaseRowCount += countedRows;
    if (!Number.isSafeInteger(databaseRowCount)) throw new Error("Complete backup database row count exceeds the supported exact bound.");
    tableCatalog.push({ ...catalog, row_count: rowCount, data_file: dataFile, data_encoding: productionBackupTextColumnsDataEncoding });
  }

  const buckets = await client.query("select row_to_json(b)::text row from storage.buckets b order by b.id");
  storageBuckets.push(...buckets.rows.map((item) => item.row));
  encodeRawStorageInventoryRows(storageBuckets);
  const objectCatalog = tableCatalog.find(row => row.schema_name === "storage" && row.table_name === "objects");
  if (!objectCatalog) throw new Error("Original Storage objects catalog is missing.");
  // Native text preserves SQL NULL versus JSON null, exact numeric/JSON text,
  // and every column. Only the download's documented access-time side effect
  // is excluded, as before; it remains present in the untouched archived row.
  storageConsistencyProjection = backupTextColumnsProjection(objectCatalog.columns.filter(column => column.name !== "last_accessed_at"));
  const objects = await client.query(`select row_to_json(snapshot_row)::text row,
    ${storageConsistencyProjection} consistency,
    pg_catalog.json_build_object('id',snapshot_row.id,'bucket_id',snapshot_row.bucket_id,'name',snapshot_row.name,
      'metadata',snapshot_row.metadata,'user_metadata',snapshot_row.user_metadata,'version',snapshot_row.version,
      'created_at',snapshot_row.created_at,'updated_at',snapshot_row.updated_at,
      'database_row',row_to_json(snapshot_row))::text archive_row
    from storage.objects snapshot_row order by bucket_id,name,id`);
  for (const item of objects.rows) {
    encodeRawStorageInventoryRows([item.row, item.archive_row]);
    encodeProductionBackupTextColumnsDataRow(item.consistency);
    const row = JSON.parse(item.row); // Identity/owner checks only, never DATA output.
    storageOwnerPrincipalId(row);
    storageObjects.push({row, consistency: item.consistency, archive_row: item.archive_row});
  }
  // Type identities must match the original pg_catalog-scoped Source capture.
  // This remains the SAME exported read-only snapshot; no role/owner fallback.
  await client.query("set local search_path = pg_catalog");
  originalMetadata = await captureProductionBackupOriginalMetadata(client);
  await client.query("commit");
  backupTransactionMayBeOpen = false;

writeJson(join(backupDir, "inventory", "database-snapshot.json"), snapshot);
writeJson(join(backupDir, "inventory", "table-catalog.json"), tableCatalog);
writeRawStorageInventory(join(backupDir, "inventory", "storage-buckets.json"), storageBuckets);
writeJson(join(backupDir, "inventory", "migration-ledger.json"), migrationLedger);
writeJson(join(backupDir, "inventory", "cron-jobs.json"), cronJobs);
writeJson(join(backupDir, "inventory", "extensions.json"), extensionInventory);
writeJson(join(backupDir, "inventory", "original-relations.json"), originalMetadata.relations);
writeJson(join(backupDir, "inventory", "original-guards.json"), originalMetadata.guards);
writeJson(join(backupDir, "inventory", "original-acls.json"), originalMetadata.acls);
const originalRelationsSha256 = await sha256File(join(backupDir, "inventory", "original-relations.json"));
const originalGuardsSha256 = await sha256File(join(backupDir, "inventory", "original-guards.json"));
const originalAclsSha256 = await sha256File(join(backupDir, "inventory", "original-acls.json"));
const databaseCatalogSha256 = await sha256File(join(backupDir, "inventory", "table-catalog.json"));
const applicationSchemaSha256 = await sha256File(applicationSchemaPath);
const migrationLedgerSha256 = await sha256File(join(backupDir, "inventory", "migration-ledger.json"));
const cronJobsSha256 = await sha256File(join(backupDir, "inventory", "cron-jobs.json"));
const extensionsSha256 = await sha256File(join(backupDir, "inventory", "extensions.json"));
const runtimeContractSha256 = await sha256File(join(backupDir, "inventory", "runtime-contract.json"));
const runtimeConfigurationSha256 = await sha256File(join(backupDir, "inventory", "runtime-configuration.json"));

const objectManifest = [];
const originalObjectManifestText = [];
for (const original of storageObjects) {
  const object = original.row;
  const file = storageObjectArchivePath(object.bucket_id, object.name);
  const outputPath = join(backupDir, file);
  const encodedName = String(object.name).split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://${projectRef}.supabase.co/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${encodedName}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!response.ok || !response.body) throw new Error(`Storage backup failed for object ${object.id} with HTTP ${response.status}.`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  chmodSync(outputPath, 0o600);
  // Re-enter the original native text profile after the capture COMMIT.
  // SET LOCAL was intentionally transaction-only; session defaults may differ.
  // Mark the BEGIN attempt before its await so the existing outer finally
  // closes even an unknown read-only outcome, without changing any defaults.
  backupTransactionMayBeOpen = true;
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local row_security = off");
  for (const statement of backupNativeTextOutputStatements) await client.query(statement);
  const current = await client.query(
    `select ${storageConsistencyProjection} consistency from storage.objects snapshot_row where bucket_id=$1 and name=$2`,
    [object.bucket_id, object.name],
  );
  if (current.rowCount !== 1) throw new Error(`Storage object ${object.id} changed or disappeared during backup.`);
  encodeProductionBackupTextColumnsDataRow(current.rows[0].consistency);
  if (original.consistency !== current.rows[0].consistency) throw new Error(`Storage object ${object.id} changed during backup; retry for a coherent archive.`);
  await client.query("rollback");
  backupTransactionMayBeOpen = false;
  const archived = finishRawStorageObjectArchiveRow(original.archive_row, {
    file,
    size_bytes: statSync(outputPath).size,
    sha256: await sha256File(outputPath),
  });
  originalObjectManifestText.push(archived);
  objectManifest.push(JSON.parse(archived)); // Existing shape/identity validation only.
}
// Retain the original artifact code and its captured snapshot values, but do
// not invoke it unless the managed client has ended successfully below.
finishBackupArtifacts = async () => {
validateV4StorageArchiveObjects(objectManifest);
writeRawStorageInventory(join(backupDir, "inventory", "storage-objects.json"), originalObjectManifestText);

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
  database_row_count: databaseRowCount,
  storage_bucket_count: storageBuckets.length,
  storage_object_count: objectManifest.length,
  storage_bytes: objectManifest.reduce((total, item) => total + item.size_bytes, 0),
  source_identity: {
    backup_tool_commit: backupToolCommit,
    backup_tool_tree: backupToolTree,
    migration_head: migrationHead,
    ...(sourceSchemaBinding?{source_schema_binding_sha256:await sha256File(join(backupDir,"inventory","source-schema-binding.json")),source_catalog_sha256:await sha256File(join(backupDir,"inventory","source-catalog.json"))}:{}),
    database_catalog_sha256: databaseCatalogSha256,
    application_schema_sha256: applicationSchemaSha256,
    application_schema_sections: requireProductionBackupSchemaSections(applicationSchemaSections),
    migration_ledger_sha256: migrationLedgerSha256,
    migration_ledger_count: migrationLedger.length,
    cron_jobs_sha256: cronJobsSha256,
    cron_job_count: cronJobs.length,
    extensions_sha256: extensionsSha256,
    runtime_contract_sha256: runtimeContractSha256,
    runtime_configuration_sha256: runtimeConfigurationSha256,
    original_relations_sha256: originalRelationsSha256,
    original_guards_sha256: originalGuardsSha256,
    original_acls_sha256: originalAclsSha256,
    pg_dump_image: pgDumpImage,
    release: releaseIdentity,
  },
  schema_restore_source: "signed application-schema.sql followed by production-restore.mjs; only the exact separately authorized pending migration list may follow restoration; filenames older than the ledger head are not presumed applied",
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
};
} catch (error) {
  backupLifecycleFailed = true;
  backupLifecycleFailure = error;
} finally {
  if (backupTransactionMayBeOpen) {
    try {
      await client.query("rollback");
      backupTransactionMayBeOpen = false;
    } catch (error) { backupCleanupErrors.push(error); }
  }
  try { await Reflect.apply(endBackupClient, client, []); }
  catch (error) { backupCleanupErrors.push(error); }
}
if (backupLifecycleFailed) {
  if (backupCleanupErrors.length) {
    throw new AggregateError([backupLifecycleFailure, ...backupCleanupErrors],
      "Original backup failed; lifecycle cleanup also failed.", { cause: backupLifecycleFailure });
  }
  throw backupLifecycleFailure;
}
if (backupCleanupErrors.length === 1) throw backupCleanupErrors[0];
if (backupCleanupErrors.length > 1) {
  throw new AggregateError(backupCleanupErrors, "Original backup lifecycle cleanup failed.",
    { cause: backupCleanupErrors[0] });
}
await finishBackupArtifacts();
