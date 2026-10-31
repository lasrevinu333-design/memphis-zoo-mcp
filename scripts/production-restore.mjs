#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { types } from "node:util";
import {verifyArchivedSchemaExtension} from "./backup-release-schema-binding.mjs";
import {stageVerifiedImmutablePrivateData,stageVerifiedImmutableFreshData,commitVerifiedImmutableFreshData,
  inspectCommittedImmutableFreshData,
  inspectCommittedImmutableFreshAuthorityData,
  holdVerifiedImmutableFreshPostAuthorityFence,
  reconcileCommittedImmutableFreshAuthority,commitVerifiedImmutableFreshAuthority} from './immutable-private-data-import.mjs';
import {readVerifiedImmutableFreshDatabaseCommitOutcome,
  readVerifiedImmutableFreshAuthorityCommitOutcome} from './immutable-private-fresh-restore-recovery.mjs';
import {prepareVerifiedImmutableBootstrapSource,assertVerifiedImmutableBootstrapSource} from './immutable-private-source-bootstrap.mjs';
import { createClient } from "@supabase/supabase-js";
import {
  requireSigningKey,
  captureVerifiedOriginalRestoreIntent,
  stableJson,
} from "./disaster-recovery-crypto.mjs";
import { materializeVerifiedArchive, restoreArchiveAdmission, selectVerifiedRestoreTables, readVerifiedRestoreTableSelection, decodeRestoreTableRowLine, assertRestoreRowMutationFidelity, createRestoreRowUtf8Guard, readVerifiedArchiveSourceBinding, openVerifiedRestoreTableData, postgresTextColumnsLineEncoding } from "./disaster-recovery-archive.mjs";
import {
  capturePreRestoreState,
  compareRestoredState,
  invalidateRestoredAuthority,
  invalidateRestoredOrdinaryNativeAuthority,
  preserveCurrentReleaseIdentity,
  refuseUnreconciledImmutableRetry,
} from "./disaster-recovery-state.mjs";
import {
  compareStorageState,
  compareVerifiedStorageTableData,
  prepareVerifiedStorageUploads,
  validateV4StorageArchiveObjects,
  captureVerifiedFreshLocalStorageProvider,
  verifyFreshLocalStorageProvider,
} from "./disaster-recovery-storage.mjs";
import {
  compareCronJobs,
  readCronJobs,
  restoreCronJobs,
  verifyRestoredCronJobs,
} from "./disaster-recovery-cron.mjs";
import {
  reinstateUnvalidatedRestoreChecks,
  restoreCheckEvidence,
  suspendUnvalidatedRestoreChecks,
} from "./restore-unvalidated-checks.mjs";

const { Client } = pg;
const sourceInput = String(process.env.RESTORE_SOURCE_DIR || "").trim();
const sourceInputDir = sourceInput ? resolve(sourceInput) : "";
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.RESTORE_CONFIRM_PROJECT_REF || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const secret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const apply = String(process.env.RESTORE_APPLY || "false").toLowerCase() === "true";
const databaseOnly = String(process.env.RESTORE_DATABASE_ONLY || "false").toLowerCase() === "true";
const archiveVerifyKey = requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY, "RESTORE_ARCHIVE_VERIFY_KEY");
const archiveVerifyKeyId = String(process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID || "").trim();

if (!sourceInputDir) throw new Error("RESTORE_SOURCE_DIR is required.");

function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function qualified(schema, table) { return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`; }
function sha256Bytes(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

const verifiedArchive = materializeVerifiedArchive({
  sourceDir: sourceInputDir,
  archiveVerifyKey,
  archiveVerifyKeyId,
  supportedFormats: ["memphis-zoo-disaster-recovery.v3", "memphis-zoo-disaster-recovery.v4"],
  requiredEntries: [
    "backup-summary.json",
    "inventory/table-catalog.json",
    "inventory/storage-buckets.json",
    "inventory/storage-objects.json",
  ],
});
const cleanupVerifiedArchive = verifiedArchive.cleanup;
let archiveSuccessOutput, archiveLifecycleFailure, archiveCleanupFailure;
let archiveLifecycleFailed = false, archiveCleanupFailed = false;
let archiveFreshFailureOutput;
try {
  archiveSuccessOutput = await (async () => {
const sourceDir = verifiedArchive.directory;
const sourceBinding = readVerifiedArchiveSourceBinding(verifiedArchive);
const { summary } = sourceBinding;
const archiveDigest = sourceBinding.archive_digest;
const checksumPaths = new Set(verifiedArchive.checksumPaths);
function requireOriginalArchiveSource() {
  if (readVerifiedArchiveSourceBinding(verifiedArchive) !== sourceBinding) {
    throw new Error('The original verified archive source binding changed.');
  }
}
const archiveAdmission = restoreArchiveAdmission(summary.format, { apply });
function verifiedArchivePath(relativePath, description) {
  const relative = String(relativePath || "");
  const path = resolve(sourceDir, relative);
  if (!checksumPaths.has(relative) || !path.startsWith(`${sourceDir}${sep}`)) {
    throw new Error(`${description} does not name a checksummed file in the verified archive snapshot.`);
  }
  return path;
}
if (!/^[a-z0-9]{20}$/.test(String(summary.project_ref || ""))) throw new Error("Archive project identity is invalid.");
if (!summary.source_identity || typeof summary.source_identity !== "object") throw new Error("Archive source identity is missing.");

const catalog = JSON.parse(readFileSync(join(sourceDir, "inventory", "table-catalog.json"), "utf8"));
const buckets = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-buckets.json"), "utf8"));
const objects = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-objects.json"), "utf8"));
if (archiveAdmission.restore_compatible) validateV4StorageArchiveObjects(objects);
let archivedCronJobs = [];
const catalogDigest = await sha256File(join(sourceDir, "inventory", "table-catalog.json"));
if (catalogDigest !== summary.source_identity.database_catalog_sha256) throw new Error("Database catalog identity does not match the signed archive.");
if (summary.format === "memphis-zoo-disaster-recovery.v4") {
  const requiredInventory = [
    ["application-schema.sql", "application_schema_sha256"],
    ["migration-ledger.json", "migration_ledger_sha256"],
    ["cron-jobs.json", "cron_jobs_sha256"],
    ["extensions.json", "extensions_sha256"],
    ["runtime-contract.json", "runtime_contract_sha256"],
    ["runtime-configuration.json", "runtime_configuration_sha256"],
  ];
  for (const [file, identityField] of requiredInventory) {
    const actual = await sha256File(join(sourceDir, "inventory", file));
    if (actual !== summary.source_identity[identityField]) {
      throw new Error(`Signed recovery inventory identity mismatch for ${file}.`);
    }
  }
  const ledger = JSON.parse(readFileSync(join(sourceDir, "inventory", "migration-ledger.json"), "utf8"));
  const cronJobs = JSON.parse(readFileSync(join(sourceDir, "inventory", "cron-jobs.json"), "utf8"));
  if (!Array.isArray(ledger) || ledger.length !== Number(summary.source_identity.migration_ledger_count)
      || String(ledger.at(-1)?.version || "") !== String(summary.source_identity.migration_head || "")) {
    throw new Error("Signed migration ledger inventory is incomplete or does not terminate at the archived head.");
  }
  if (!Array.isArray(cronJobs) || cronJobs.length !== Number(summary.source_identity.cron_job_count)) {
    throw new Error("Signed cron inventory count is inconsistent.");
  }
  if(summary.source_identity.release?.migration_head!==summary.source_identity.migration_head){
    for(const [name,field]of [["source-schema-binding.json","source_schema_binding_sha256"],["source-catalog.json","source_catalog_sha256"]]){
      const path=verifiedArchivePath("inventory/"+name,"Source schema binding");
      if(await sha256File(path)!==summary.source_identity[field])throw new Error("Signed source schema extension inventory mismatch.");
    }
    verifyArchivedSchemaExtension({summary,ledger,
      binding:JSON.parse(readFileSync(join(sourceDir,"inventory","source-schema-binding.json"),"utf8")),
      catalog:JSON.parse(readFileSync(join(sourceDir,"inventory","source-catalog.json"),"utf8"))});
  }
  archivedCronJobs = cronJobs;
}
for (const object of objects) {
  const path = verifiedArchivePath(object.file, `Storage object ${object.id}`);
  if (statSync(path).size !== Number(object.size_bytes) || await sha256File(path) !== object.sha256) {
    throw new Error(`Storage object archive verification failed for ${object.id}.`);
  }
}
for (const table of catalog) verifiedArchivePath(table.data_file, `Database table ${table.schema_name}.${table.table_name}`);
let tableSelection = archiveAdmission.restore_compatible
  ? selectVerifiedRestoreTables({summary,catalog,checksumPaths,databaseOnly}) : null;
if (tableSelection !== null) {
  requireOriginalArchiveSource();
  const originalSelection = readVerifiedRestoreTableSelection(verifiedArchive, {databaseOnly});
  if (stableJson(tableSelection) !== stableJson(originalSelection)) throw new Error('Original signed restore table selection changed.');
  tableSelection = originalSelection; // Detached frozen private-catalog members, not caller/public metadata.
}
// The normal importer still TRUNCATEs and INSERTs under replica mode. That
// cannot bypass immutable ALWAYS guards, nor authorize a purged original.
// Do not accept a caller flag, row-count zero or a signed declaration as a
// substitute for the still-missing owning original-DATA import contract.
const privateImportBlocker = tableSelection?.privateTables.length
  ? "PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED" : null;
// Native TEXT uses the ordinary owner only for the existing isolated DB-only
// target. Full production and mixed legacy/native DATA retain their pre-connect
// hold. The signed tag chooses representation, never a target or effect grant.
const hasOrdinaryNativeText = tableSelection && !tableSelection.privateTables.length
  && tableSelection.databaseTables.some(table=>table.data_encoding===postgresTextColumnsLineEncoding);
const nativeTextDatabase = hasOrdinaryNativeText && databaseOnly
  && tableSelection.databaseTables.every(table=>table.data_encoding===postgresTextColumnsLineEncoding);
const nativeTextLegacyBlocker = hasOrdinaryNativeText && !nativeTextDatabase
  ? "NATIVE_TEXT_RESTORE_REQUIRES_IMMUTABLE_ORIGINAL_ROUTE" : null;
// Selector only, not fresh-target or transaction authority. The exact local
// URI guard below AND the fresh API's original native owner/catalog/intent
// checks remain mandatory. Full production/Storage APPLY stays held.
const freshPrivateDatabase = databaseOnly && privateImportBlocker !== null;

// This normal entry now consumes the independently pinned current program
// Source and original signed metadata, rather than relying on fixture-only
// recipe construction. Preparation never clears the private APPLY barrier.
let immutableBootstrapSource=null,immutableBootstrapPreparation=null;
function safeBootstrapPrerequisite(error){
  if(!error||typeof error!=='object')return {};
  const code=Object.getOwnPropertyDescriptor(error,'code'),member=Object.getOwnPropertyDescriptor(error,'source_member');
  if(!code||!member||!Object.hasOwn(code,'value')||!Object.hasOwn(member,'value'))return {};
  const allowed=code.value==='IMMUTABLE_BOOTSTRAP_INVENTORY_UNAVAILABLE'
    ?['application-schema.sql','migration-ledger.json','cron-jobs.json','extensions.json','table-catalog.json',
      'original-relations.json','original-guards.json','original-acls.json'].map(name=>'inventory/'+name)
    :code.value==='IMMUTABLE_BOOTSTRAP_ORIGINAL_ROWS_UNAVAILABLE'
      ?['public.release_deployment_manifest','public.custodial_release_authority_restore_inventory']:[];
  return allowed.includes(member.value)?{code:code.value,source_member:member.value}:{};
}
if(privateImportBlocker){
  try{
    immutableBootstrapSource=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);
    assertVerifiedImmutableBootstrapSource(immutableBootstrapSource,verifiedArchive);
    immutableBootstrapPreparation=Object.freeze({status:'SOURCE_PREPARED_NOT_TARGET_ADMITTED',
      guard_recipes:immutableBootstrapSource.recipes.length,source_statements:immutableBootstrapSource.statements.length,
      target_authority:false,transaction_authority:false,import_authority:false,resume_allowed:false});
  }catch(error){
    immutableBootstrapSource=null;
    // Do not expose signed private row/SQL details from a failed preparation.
    immutableBootstrapPreparation=Object.freeze({status:'CURRENT_SOURCE_OR_ORIGINAL_METADATA_UNAVAILABLE',
      ...safeBootstrapPrerequisite(error),
      target_authority:false,transaction_authority:false,import_authority:false,resume_allowed:false});
  }
}

if (!apply) {
  return JSON.stringify({
    ok: true,
    dry_run: true,
    archive_verified: true,
    archive_signature_verified: true,
    archive_digest: archiveDigest,
    restore_compatible: archiveAdmission.restore_compatible && privateImportBlocker === null && nativeTextLegacyBlocker === null,
    archive_format_restore_compatible: archiveAdmission.restore_compatible,
    selected_database_tables: tableSelection?.databaseTables.length ?? 0,
    selected_private_tables: tableSelection?.privateTables.length ?? 0,
    data_import_blocker: privateImportBlocker ?? nativeTextLegacyBlocker,
    ...(immutableBootstrapPreparation===null?{}:{immutable_source_preparation:immutableBootstrapPreparation}),
    historical_verification_only: archiveAdmission.historical_verification_only,
    project_ref_in_archive: summary.project_ref,
    source_identity: summary.source_identity,
    tables: catalog.length,
    rows: summary.database_row_count,
    storage_buckets: buckets.length,
    storage_objects: objects.length,
  }, null, 2);
}

if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required for restore apply.");
if (databaseOnly) {
  let target;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("Database-only restore is restricted to a loopback mz_schema_rebuild_* database.");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)
      || /[?#]/.test(databaseUrl)
      || target.search !== "" || target.hash !== ""
      || !/^(127\.0\.0\.1|localhost)$/.test(target.hostname)
      || !/^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname)) {
    throw new Error("Database-only restore is restricted to a loopback mz_schema_rebuild_* database.");
  }
} else if (!/^[a-z0-9]{20}$/.test(projectRef) || confirmedRef !== projectRef) {
  throw new Error("Destructive restore requires SUPABASE_PROJECT_REF and an exact RESTORE_CONFIRM_PROJECT_REF match.");
}
if (projectRef !== summary.project_ref) throw new Error("The signed archive project does not equal the confirmed restore target.");
if (!databaseOnly && !secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for a production restore apply.");

const intentVerifyKey = requireSigningKey(process.env.RESTORE_INTENT_VERIFY_KEY, "RESTORE_INTENT_VERIFY_KEY");
if (intentVerifyKey === archiveVerifyKey) throw new Error("Archive and restore-intent verification keys must be independent.");
const intentVerifyKeyId = String(process.env.RESTORE_INTENT_VERIFY_KEY_ID || "").trim();
const intentEnvelope = JSON.parse(String(process.env.RESTORE_INTENT_JSON || "null"));
const intent = captureVerifiedOriginalRestoreIntent(intentEnvelope, intentVerifyKey, intentVerifyKeyId);
if (!/^[0-9a-f-]{36}$/i.test(String(intent.restore_id || ""))) throw new Error("Restore intent ID is invalid.");
if (!Number.isSafeInteger(intent.authority_generation) || intent.authority_generation < 1) throw new Error("Restore intent generation is invalid.");
if (intent.retry_of_restore_id !== null && !/^[0-9a-f-]{36}$/i.test(String(intent.retry_of_restore_id || ""))) {
  throw new Error("Restore intent retry identity is invalid.");
}
if (intent.archive_digest !== archiveDigest
    || intent.source_project_ref !== summary.project_ref
    || intent.target_project_ref !== projectRef
    || intent.source_identity_sha256 !== sha256Bytes(stableJson(summary.source_identity))) {
  throw new Error("Restore intent does not bind the exact archive and project identities.");
}
if (!String(intent.actor || "").trim()) throw new Error("Restore intent must identify the named actor.");
const expiresAt = Date.parse(String(intent.expires_at || ""));
function requireRestoreIntentFresh() {
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1000) {
    throw new Error("Restore intent is expired or exceeds the 24-hour authorization window.");
  }
}
requireRestoreIntentFresh();

// Explicit same-original disposable official provider. The normal production
// private APPLY barrier below is unchanged; no caller-selected role/profile.
const freshStorageProviderInput = String(process.env.RESTORE_FRESH_STORAGE_PROVIDER_JSON || "");
const freshStorageServiceKey = String(process.env.RESTORE_FRESH_STORAGE_SERVICE_KEY || "");
const freshStorageJwtSecret = String(process.env.RESTORE_FRESH_STORAGE_JWT_SECRET || "");
let freshStorageProvider = null;
let freshNativeRestoreTarget = null;
if (freshStorageProviderInput || freshStorageServiceKey || freshStorageJwtSecret) {
  if (!databaseOnly || !(freshPrivateDatabase || nativeTextDatabase) || !freshStorageProviderInput || !freshStorageServiceKey || !freshStorageJwtSecret)
    throw new Error("Fresh local Storage requires the existing authenticated whole-fresh database route.");
  const providerEnvelope=JSON.parse(freshStorageProviderInput);
  freshStorageProvider = captureVerifiedFreshLocalStorageProvider({verifiedArchive,
    originalIntentEnvelope:intentEnvelope,intentVerifyKey,intentVerifyKeyId,
    providerEnvelope,serviceKey:freshStorageServiceKey,jwtSecret:freshStorageJwtSecret,databaseUrl});
  if(nativeTextDatabase){
    if(providerEnvelope.binding.source_profile!=="native-text-v4-fresh-supabase-admin")
      throw new Error("Fresh native whole-archive restore requires its authenticated Supabase administrator profile.");
    freshNativeRestoreTarget=Object.freeze({...providerEnvelope.binding.host_target});
  }
}

if (nativeTextLegacyBlocker !== null) {
  throw Object.assign(new Error("Native-text DATA cannot use the legacy JSON-value replica restore route. No target was connected or changed."),{code:nativeTextLegacyBlocker});
}
if (privateImportBlocker !== null && !freshPrivateDatabase) {
  const failure = new Error("Private original ledger DATA is selected but cannot be imported by the existing TRUNCATE/INSERT route: ALWAYS guards and purged-origin admission require the owning immutable-data restore contract. No target was connected, paused or changed.");
  failure.code = privateImportBlocker;
  throw failure;
}
const databaseTables = tableSelection.databaseTables;
// Private integration callable only for the same original verified intent,
// source and REAL managed client under the existing owning transaction/fence.
// NOT activated: the early unsupported guard remains until Main qualifies
// the proposed SQL and the whole-archive fresh import branch below. Never
// call this from the ordinary TRUNCATE/replica loop or with caller flags.
async function stagePrivateOriginalsUnderOwnedFence() {
  if (!prepared || !mutationFenceHeld) throw Object.assign(new Error('PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'),{code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'});
  requireOriginalArchiveSource();
  assertVerifiedImmutableBootstrapSource(immutableBootstrapSource,verifiedArchive);
  const result = await stageVerifiedImmutablePrivateData({db,verifiedArchive,originalIntentEnvelope:intentEnvelope,intentVerifyKey,intentVerifyKeyId});
  assertVerifiedImmutableBootstrapSource(immutableBootstrapSource,verifiedArchive);
  requireOriginalArchiveSource();
  return result;
}
const restoreId = String(intent.restore_id).toLowerCase();
const generation = Number(intent.authority_generation);
const restoreClientOptions = {
  connectionString: databaseUrl,
  application_name: "memphis-zoo-disaster-restore",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
};
async function preflightOrdinaryLegacyRestoreData() {
  if (freshPrivateDatabase || nativeTextDatabase) return;
  requireRestoreIntentFresh();
  requireOriginalArchiveSource();
  for (const selectedTable of databaseTables) {
    const tableData = openVerifiedRestoreTableData(verifiedArchive, selectedTable.schema_name, selectedTable.table_name);
    let rowStream, utf8Guard, wireSettled, input, tableFailure;
    try {
      const table = tableData.table;
      rowStream = tableData.stream;
      utf8Guard = createRestoreRowUtf8Guard();
      wireSettled = pipeline(rowStream, utf8Guard);
      wireSettled.catch(() => {});
      input = createInterface({ input: utf8Guard, crlfDelay: Infinity });
      let rows = 0;
      for await (const line of input) {
        requireRestoreIntentFresh();
        requireOriginalArchiveSource();
        assertRestoreRowMutationFidelity(line, table);
        rows += 1;
      }
      await wireSettled;
      await tableData.verified;
      if (rows !== Number(table.row_count)) throw new Error("Legacy restore admission row-count mismatch.");
      requireRestoreIntentFresh();
      requireOriginalArchiveSource();
    } catch (error) {
      tableFailure = error;
      throw error;
    } finally {
      input?.close(); rowStream?.destroy(); utf8Guard?.destroy();
      if (wireSettled) await wireSettled.catch(() => {});
      try { await tableData.close(); }
      catch (cleanupError) {
        if (tableFailure) throw new AggregateError([tableFailure, cleanupError], "Legacy restore admission and source cleanup failed.", { cause: tableFailure });
        throw cleanupError;
      }
    }
  }
}
function requireOrdinaryRestoreIntentFresh() {
  if (!freshPrivateDatabase && !nativeTextDatabase) requireRestoreIntentFresh();
}
await preflightOrdinaryLegacyRestoreData();

const db = new Client(restoreClientOptions);
// Fixed, local read snapshot only: no caller query/body/profile or effect
// authority. Each checkpoint must observe a new snapshot, never a saved flag.
const storageSnapshotQuery = Client.prototype.query;
const storageSnapshotConnection = db.connection;
async function readExactOriginalStorageSnapshot() {
  let phase = "INPUT", attempted = false, failed = false, firstFailure, observation, selection;
  const cleanup = [];
  const unavailable = () => { throw Object.assign(new Error("Original Storage exact snapshot unavailable."), {
    code: "STORAGE_EXACT_SNAPSHOT_UNAVAILABLE", storage_read_phase: phase, retry_safe: false,
  }); };
  const own = (value, key) => {
    if (!value || typeof value !== "object" || types.isProxy(value)) unavailable();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, "value")) unavailable();
    return field.value;
  };
  const closed = (value, keys) => {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) unavailable();
    return Object.fromEntries(keys.map(key => [key, own(value, key)]));
  };
  const dense = value => {
    if (!value || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) unavailable();
    return Array.from({length:value.length}, (_, i) => own(value, String(i)));
  };
  const stream = own(storageSnapshotConnection, "stream");
  const connection = () => {
    if (!db || types.isProxy(db) || Object.getPrototypeOf(db) !== Client.prototype
      || own(db, "connection") !== storageSnapshotConnection || types.isProxy(storageSnapshotConnection)
      || own(storageSnapshotConnection, "stream") !== stream || !stream || types.isProxy(stream)
      || stream.destroyed !== false || own(db, "_connected") !== true || own(db, "_ending") !== false
      || own(db, "_ended") !== false || own(db, "_queryable") !== true) unavailable();
  };
  const native = state => {
    connection();
    const active = own(db, "_activeQuery");
    if (Object.hasOwn(db, "query") || Client.prototype.query !== storageSnapshotQuery
      || own(db, "_txStatus") !== state || own(db, "readyForQuery") !== true
      || (active !== null && active !== undefined) || dense(own(db, "_queryQueue")).length !== 0) unavailable();
  };
  const receipt = (value, command) => {
    if (own(value, "command") !== command || own(value, "rowCount") !== null || dense(own(value, "rows")).length !== 0) unavailable();
  };
  const current = () => {
    requireOriginalArchiveSource();
    if (selection !== undefined && readVerifiedRestoreTableSelection(verifiedArchive, {databaseOnly:true}) !== selection) unavailable();
  };
  try {
    requireOriginalArchiveSource(); native("I");
    selection = readVerifiedRestoreTableSelection(verifiedArchive, {databaseOnly:true});
    phase = "BEGIN"; current(); native("I"); attempted = true; // Consume before the actual await, including lost replies.
    const begun = await Reflect.apply(storageSnapshotQuery, db, ["begin isolation level repeatable read read only"]);
    current(); native("T"); receipt(begun, "BEGIN");
    phase = "PROFILE";
    for (const sql of ["set local row_security = off", "set local search_path = pg_catalog, pg_temp",
      "set local extra_float_digits = 3", "set local DateStyle = 'ISO, YMD'", "set local TimeZone = 'UTC'",
      "set local IntervalStyle = 'postgres'", "set local bytea_output = 'hex'"]) {
      current(); native("T"); const configured = await Reflect.apply(storageSnapshotQuery, db, [sql]);
      current(); native("T"); receipt(configured, "SET");
    }
    phase = "COMPARE"; current(); native("T");
    const result = await compareVerifiedStorageTableData({db,verifiedArchive});
    current(); native("T"); phase = "RESULT";
    const compared = closed(result, ["sourceBinding", "status", "tables"]);
    if (compared.sourceBinding !== sourceBinding) unavailable();
    const tables = dense(compared.tables);
    if (tables.length !== selection.storageTables.length) unavailable();
    const count = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,18})(?![\s\S])/.test(value)
      && BigInt(value) <= 9223372036854775807n;
    const projected = tables.map((table, index) => {
      const status = own(table, "status"), unsupported = status === "UNSUPPORTED";
      const value = closed(table, ["schema_name", "table_name", "status", "original_count", "current_count", "missing_count", "extra_count",
        ...(unsupported ? ["reason"] : [])]);
      const original = selection.storageTables[index];
      if (value.schema_name !== "storage" || value.table_name !== original.table_name
        || !count(value.original_count) || value.original_count !== original.row_count) unavailable();
      if (unsupported) {
        if ([value.current_count,value.missing_count,value.extra_count].some(value => value !== null)
          || !["ORIGINAL_POSTGRES_TEXT_ENCODING_REQUIRED", "STORAGE_TABLE_PARAMETER_LIMIT", "TARGET_SOURCE_CATALOG_OR_FULL_VISIBILITY_UNSUPPORTED"].includes(value.reason)) unavailable();
      } else if (!["MATCH", "DIFFERENT"].includes(status) || ![value.current_count,value.missing_count,value.extra_count].every(count)
        || BigInt(value.missing_count) > BigInt(value.original_count) || BigInt(value.extra_count) > BigInt(value.current_count)
        || BigInt(value.original_count)-BigInt(value.missing_count) !== BigInt(value.current_count)-BigInt(value.extra_count)
        || (status === "MATCH") !== (value.missing_count === "0" && value.extra_count === "0")) unavailable();
      return Object.freeze(value); // Only bounded existing identity/status/decimal count DATA, no Source handle.
    });
    const status = !tables.length ? "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"
      : projected.some(table => table.status === "UNSUPPORTED") ? "UNSUPPORTED"
        : projected.some(table => table.status === "DIFFERENT") ? "DIFFERENT" : "MATCH";
    if (compared.status !== status) unavailable();
    observation = Object.freeze({status,tables:Object.freeze(projected)}); current();
  } catch (error) { failed = true; firstFailure = error; }
  finally {
    if (attempted) {
      phase = "ROLLBACK";
      // Source withdrawal must not prevent cleanup of this one attempted
      // read transaction. Never use a changed per-instance/prototype query.
      try { current(); } catch (error) { cleanup.push(error); }
      try {
        connection(); const rolledBack = await Reflect.apply(storageSnapshotQuery, db, ["rollback"]);
        connection(); receipt(rolledBack, "ROLLBACK"); native("I");
      } catch (error) { cleanup.push(error); }
      try { current(); } catch (error) { cleanup.push(error); }
    }
  }
  if (failed) {
    if (cleanup.length) throw new AggregateError([firstFailure,...cleanup], "Original Storage exact read and cleanup failed.", {cause:firstFailure});
    throw firstFailure; // Includes null/undefined/false/0: no truthiness adoption.
  }
  if (cleanup.length) throw new AggregateError(cleanup, "Original Storage exact read cleanup failed.", {cause:cleanup[0]});
  phase = "FINAL_SOURCE"; current(); native("I");
  return observation;
}
let restorePhase = "connect";
let restoreTable = null;
let prepared = false;
let mutationFenceHeld = false;
db.on("error", (error) => {
  console.error(JSON.stringify({ ok: false, restore_phase: restorePhase, restore_table: restoreTable, connection_error: error instanceof Error ? error.message : String(error) }));
});

async function recordEvent(phase, outcome, evidence = {}) {
  await db.query(`
    insert into custodial_dr.restore_events(restore_id,authority_generation,phase,outcome,actor,evidence_json)
    values ($1,$2,$3,$4,$5,$6::jsonb)
  `, [restoreId, generation, phase, outcome, intent.actor, JSON.stringify(evidence)]);
}

async function setControl(state, { paused = true, failureReason = null, completed = false } = {}) {
  await db.query(`
    update custodial_dr.restore_control set
      state=$1,mutations_paused=$2,failure_reason=$3,
      completed_at=case when $4 then clock_timestamp() else completed_at end,
      updated_at=clock_timestamp()
    where singleton=true and restore_id=$5 and authority_generation=$6
  `, [state, paused, failureReason, completed, restoreId, generation]);
}

async function readTargetIdentity() {
  const migration = await db.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
  const release = await db.query(`
    select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256
    from public.release_deployment_manifest
    where status='deployed'
    order by deployed_at desc nulls last,created_at desc,release_id
  `);
  if (release.rowCount !== 1) {
    throw new Error(`Restore target requires exactly one deployed release identity; found ${release.rowCount}.`);
  }
  return {
    migration_head: String(migration.rows[0]?.migration_head || ""),
    release_identity: release.rows[0],
  };
}

function assertIntentTargetIdentity(target) {
  if (intent.target_migration_head !== target.migration_head
      || stableJson(intent.target_release_identity || null) !== stableJson(target.release_identity)) {
    throw new Error("The target migration or release identity changed after restore intent approval.");
  }
}

// Ordinary native TEXT DATA has no private-original capability. These helpers
// are private to the normal owner below: the actual signed intent, client,
// paused generation, drained leases and held fence precede every invocation.
// Only server-enumerated type identifiers enter SQL; archived type text is
// compared as DATA, never interpolated as executable cast syntax.
const nativeTextQueryMethod = Client.prototype.query;
function requireNativeTextOwner() {
  requireOriginalArchiveSource();
  if (!nativeTextDatabase || !databaseOnly || !prepared || !mutationFenceHeld
      || Date.now() >= expiresAt || Object.getPrototypeOf(db) !== Client.prototype
      || Object.hasOwn(db,"query") || Client.prototype.query !== nativeTextQueryMethod
      || db._txStatus !== "T" || db._connected !== true || db._ending !== false) {
    throw Object.assign(new Error("Ordinary native TEXT restore owner is unavailable."),
      {code:"NATIVE_TEXT_RESTORE_OWNER_UNAVAILABLE",retry_safe:false});
  }
}
async function nativeTextQuery(sql, values=[]) {
  requireNativeTextOwner();
  const reply=await Reflect.apply(nativeTextQueryMethod,db,[sql,values]);
  requireNativeTextOwner();
  return reply;
}
function nativeTextRestorePlan(table, actual) {
  const refuse=()=>{throw Object.assign(new Error("Native TEXT target columns or input types differ from the original archive."),
    {code:"NATIVE_TEXT_TARGET_CATALOG_MISMATCH",retry_safe:false});};
  if (!actual || actual.relation_kind!=="r" || actual.is_partition!==false
      || actual.inheritance_count!=="0" || actual.dropped_count!=="0"
      || !Array.isArray(actual.columns) || !Array.isArray(actual.casts)
      || stableJson(actual.columns)!==stableJson(table.columns)
      || stableJson(actual.primary_key)!==stableJson(table.primary_key)
      || actual.casts.length!==table.columns.length) refuse();
  const literal=value=>"E'"+value.replaceAll("\\","\\\\").replaceAll("'","''")+"'";
  const names=table.columns.map(column=>column.name);
  const writable=table.columns.filter(column=>!column.generated);
  for(let i=0;i<names.length;i++){
    const cast=actual.casts[i];
    if(!cast || cast.name!==names[i] || cast.supported_io!==true
      || typeof cast.type_schema!=="string" || !cast.type_schema
      || typeof cast.type_name!=="string" || !cast.type_name
      || [cast.type_schema,cast.type_name].some(value=>value.includes("\0")))refuse();
  }
  // An all-generated table cannot carry a populated original in this route.
  if(!writable.length)refuse();
  const projection=alias=>`pg_catalog.json_object(ARRAY[${names.map(literal).join(",")}]::pg_catalog.text[],`
    +`ARRAY[${names.map(name=>`${alias}.${quoteIdentifier(name)}::pg_catalog.text`).join(",")}]::pg_catalog.text[])::pg_catalog.text`;
  const originalProjection=`pg_catalog.json_object(ARRAY[${names.map(literal).join(",")}]::pg_catalog.text[],`
    +`ARRAY[${names.map(name=>`raw::pg_catalog.json->>${literal(name)}`).join(",")}]::pg_catalog.text[])::pg_catalog.text`;
  const values=writable.map(column=>{
    const cast=actual.casts[names.indexOf(column.name)];
    return `($1::pg_catalog.json->>${literal(column.name)})::${qualified(cast.type_schema,cast.type_name)}`;
  }).join(",");
  const target=qualified(table.schema_name,table.table_name);
  return Object.freeze({insert:`with inserted as (insert into ${target} (${writable.map(c=>quoteIdentifier(c.name)).join(",")}) overriding system value select ${values} returning 1),
    retained as (insert into pg_temp.custodial_native_text_restore_expected(schema_name,table_name,raw)
      select $2::pg_catalog.text,$3::pg_catalog.text,$1::pg_catalog.text from inserted returning 1)
    select (select count(*)::pg_catalog.text from inserted) inserted,(select count(*)::pg_catalog.text from retained) retained`,
    compare:`with expected as materialized (select ${originalProjection} collate pg_catalog."C" image
      from pg_temp.custodial_native_text_restore_expected where schema_name=$1 and table_name=$2),
    actual as materialized (select ${projection("r")} collate pg_catalog."C" image from only ${target} r),
    missing as (select image from expected except all select image from actual),
    extra as (select image from actual except all select image from expected)
    select (select count(*)::pg_catalog.text from expected) expected_rows,
      (select count(*)::pg_catalog.text from actual) actual_rows,
      (select count(*)::pg_catalog.text from missing) missing_rows,(select count(*)::pg_catalog.text from extra) extra_rows`});
}
async function requireNativeTextRelationCensus() {
  const reply=await nativeTextQuery(`select n.nspname schema_name,c.relname table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('r','p','f')
    order by n.nspname,c.relname`);
  const expected=databaseTables.map(t=>({schema_name:t.schema_name,table_name:t.table_name}));
  const ordered=rows=>rows.map(row=>JSON.stringify([row.schema_name,row.table_name])).sort();
  if(reply.rowCount!==expected.length || stableJson(ordered(reply.rows))!==stableJson(ordered(expected)))
    throw new Error("Native TEXT target relation scope differs from the authenticated source.");
}
async function prepareNativeTextRestorePlans(expectedState="PREPARING", retainedRows=false) {
  // Hold the real control row through DATA+evidence COMMIT. No stale public
  // result/flag substitutes for the same generation's paused owner.
  const control=await nativeTextQuery(`select restore_id::text,authority_generation::text,archive_digest,
    source_project_ref,target_project_ref,mutations_paused,state from custodial_dr.restore_control where singleton=true for update`);
  const row=control.rows[0];
  if(control.rowCount!==1 || row.restore_id!==restoreId || row.authority_generation!==String(generation)
    || row.archive_digest!==archiveDigest || row.source_project_ref!==summary.project_ref
    || row.target_project_ref!==projectRef || row.mutations_paused!==true || row.state!==expectedState)
    throw new Error("Original native TEXT restore control owner changed.");
  if(freshStorageProvider!==null){
    // The whole authenticated archive includes platform-owned relations. Use
    // the genuine administrator only on this already-authenticated disposable
    // target; never grant catalog/table privileges or change their owners.
    const target=freshNativeRestoreTarget;
    const context=await nativeTextQuery(`select current_database() database_name,
      (select oid::text from pg_catalog.pg_database where datname=current_database()) database_oid,
      session_user::text session_user,current_user::text current_user,
      (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where datname=current_database()) database_owner`);
    const actual=context.rows[0];
    if(!target || !Object.isFrozen(target) || !Object.isFrozen(freshStorageProvider)
      || target.session_user!=="supabase_admin" || target.database_owner!=="postgres"
      || context.rowCount!==1 || actual.database_name!==target.database_name || actual.database_oid!==target.database_oid
      || actual.session_user!=="supabase_admin" || actual.current_user!=="supabase_admin" || actual.database_owner!=="postgres")
      throw Object.assign(new Error("Authenticated fresh native whole-archive database identity changed."),
        {code:"FRESH_NATIVE_WHOLE_ARCHIVE_OWNER_UNAVAILABLE",retry_safe:false});
  }
  await nativeTextQuery("set local search_path = pg_catalog, pg_temp");
  await nativeTextQuery("set local row_security = off");
  for(const sql of ["set local extra_float_digits = 3","set local datestyle = 'ISO, YMD'",
    "set local timezone = 'UTC'","set local intervalstyle = 'postgres'","set local bytea_output = 'hex'"])
    await nativeTextQuery(sql);
  // Table locks do not pin independent type/cast/function DDL. Keep the
  // actual catalog I/O definitions fixed in this same transaction as DATA.
  await nativeTextQuery("lock table pg_catalog.pg_type,pg_catalog.pg_proc,pg_catalog.pg_cast,pg_catalog.pg_namespace,pg_catalog.pg_enum,pg_catalog.pg_range in share mode");
  await nativeTextQuery(`lock table ${databaseTables.map(t=>"only "+qualified(t.schema_name,t.table_name)).join(",")} in access exclusive mode`);
  await requireNativeTextRelationCensus();
  const plans=new Map();
  for(const table of databaseTables){
    const result=await nativeTextQuery(`select c.relkind::text relation_kind,c.relispartition is_partition,
      (select count(*)::text from pg_catalog.pg_inherits where inhparent=c.oid or inhrelid=c.oid) inheritance_count,
      (select count(*)::text from pg_catalog.pg_attribute where attrelid=c.oid and attnum>0 and attisdropped) dropped_count,
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'data_type',pg_catalog.format_type(a.atttypid,a.atttypmod),
        'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns,
      coalesce((select pg_catalog.jsonb_agg(a.attname order by k.ordinality) from pg_catalog.pg_index i
        cross join lateral pg_catalog.unnest(i.indkey) with ordinality k(attnum,ordinality)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where i.indrelid=c.oid and i.indisprimary and i.indisvalid),'[]'::jsonb) primary_key,
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type_schema',tn.nspname,'type_name',t.typname,
        'supported_io',not exists(select 1 from pg_catalog.pg_cast x
            left join pg_catalog.pg_proc cast_proc on cast_proc.oid=x.castfunc
            where ((x.castsource=t.oid and x.casttarget='pg_catalog.text'::pg_catalog.regtype)
              or (x.castsource='pg_catalog.text'::pg_catalog.regtype and x.casttarget=t.oid))
              and (t.typtype='e' or (x.castmethod='b' and tn.nspname<>'pg_catalog') or (x.castmethod='f' and
                (cast_proc.pronamespace<>'pg_catalog'::pg_catalog.regnamespace
                  or cast_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='internal')
                  or cast_proc.prosecdef or cast_proc.proconfig is not null))))
          and ti.pronamespace='pg_catalog'::pg_catalog.regnamespace and tout.pronamespace=ti.pronamespace
          and ti.prolang=(select oid from pg_catalog.pg_language where lanname='internal') and tout.prolang=ti.prolang
          and ((tn.nspname='pg_catalog' and t.typisdefined and (t.typtype in ('b','r')))
            or (t.typtype='e' and t.typinput='pg_catalog.enum_in(cstring,oid)'::pg_catalog.regprocedure
              and t.typoutput='pg_catalog.enum_out(anyenum)'::pg_catalog.regprocedure))) order by a.attnum)
        from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
        join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace join pg_catalog.pg_proc ti on ti.oid=t.typinput
        join pg_catalog.pg_proc tout on tout.oid=t.typoutput
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) casts
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2`,
      [table.schema_name,table.table_name]);
    if(result.rowCount!==1)throw new Error("Native TEXT target relation is unavailable.");
    plans.set(table,nativeTextRestorePlan(table,result.rows[0]));
  }
  const collision=await nativeTextQuery("select pg_catalog.to_regclass('pg_temp.custodial_native_text_restore_expected')::text relation");
  if(collision.rowCount!==1 || (retainedRows ? collision.rows[0].relation===null : collision.rows[0].relation!==null))
    throw new Error("Native TEXT expected-row namespace differs from the original phase.");
  return plans;
}
async function compareNativeTextRestorePlans(plans,tables=databaseTables) {
  await requireNativeTextRelationCensus();
  for(const table of tables){
    const reply=await nativeTextQuery(plans.get(table).compare,[table.schema_name,table.table_name]);
    const row=reply.rows[0];
    if(reply.rowCount!==1 || row.expected_rows!==table.row_count || row.actual_rows!==table.row_count
      || row.missing_rows!=="0" || row.extra_rows!=="0")throw new Error("Native TEXT original table readback differs.");
  }
  requireNativeTextOwner();
}

const endRestoreClient = Client.prototype.end;
let restoreSessionLockHeld = false;
let restoreLifecycleFailed = false;
let restoreLifecycleFailure;
let restoreSuccessOutput;
const restoreCleanupErrors = [];
let freshCommitNeedsObservation = false;
let freshDatabaseCommitAcknowledged = false;
let freshAuthorityCommitInvoked = false, freshAuthorityCommitAcknowledged = false;
let freshAuthorityOriginalRequest, freshAuthorityCommitNeedsObservation = false;
let freshDataReadbackDisposition;
let freshFailureOutput;
const freshOriginalRequest = freshPrivateDatabase ? Object.freeze({restoreId,generation:String(generation),
  archiveDigest,targetProjectRef:projectRef}) : null;

// A distinct read-only snapshot AFTER the original managed connection closes.
// Never reconnect/retry a write, infer rollback from absence, or renew intent.
async function observeFreshOriginalCommit() {
  const reader = new Client(restoreClientOptions);
  const endReader = endRestoreClient;
  let observation, firstFailure, failed = false, readTransactionAttempted = false;
  const cleanupErrors = [];
  try {
    await reader.connect();
    readTransactionAttempted = true;
    await reader.query("begin isolation level repeatable read read only");
    observation = await readVerifiedImmutableFreshDatabaseCommitOutcome({db:reader,request:freshOriginalRequest});
  } catch (error) { failed = true; firstFailure = error; }
  finally {
    if (readTransactionAttempted) {
      try { await reader.query("rollback"); } catch (error) { cleanupErrors.push(error); }
    }
    try { await Reflect.apply(endReader,reader,[]); } catch (error) { cleanupErrors.push(error); }
  }
  if (failed) {
    if (cleanupErrors.length) throw new AggregateError([firstFailure,...cleanupErrors],
      "Original commit observation and cleanup failed.",{cause:firstFailure});
    throw firstFailure;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors,"Original commit observation cleanup failed.",
    {cause:cleanupErrors[0]});
  return observation; // Metadata only, never completion/retry/resume permission.
}
async function observeFreshOriginalAuthorityCommit(){
  if(!freshAuthorityOriginalRequest)throw new Error('Original authority status tuple is unavailable.');
  const reader=new Client(restoreClientOptions);let observation,failed=false,failure,attempted=false;
  const cleanup=[];
  try{
    await reader.connect();attempted=true;
    await reader.query('begin isolation level repeatable read read only');
    await reader.query('set local search_path = pg_catalog, pg_temp');
    observation=await readVerifiedImmutableFreshAuthorityCommitOutcome({db:reader,request:freshAuthorityOriginalRequest});
  }catch(error){failed=true;failure=error;}
  finally{
    if(attempted)try{await reader.query('rollback');}catch(error){cleanup.push(error);}
    try{await Reflect.apply(endRestoreClient,reader,[]);}catch(error){cleanup.push(error);}
  }
  if(failed){if(cleanup.length)throw new AggregateError([failure,...cleanup],'Original authority readback and cleanup failed',{cause:failure});throw failure;}
  if(cleanup.length)throw new AggregateError(cleanup,'Original authority readback cleanup failed',{cause:cleanup[0]});
  return observation;
}
async function continueRestoreAfterDatabase({databaseEvidence,immutablePrivateDataEvidence,unvalidatedCheckEvidence,invalidated}) {
  const requireFreshContinuation = () => {
    if (!freshPrivateDatabase && !nativeTextDatabase) {
      requireRestoreIntentFresh();
      requireOriginalArchiveSource();
      return;
    }
    if(nativeTextDatabase && Date.now()>=expiresAt)throw new Error("Original native restore intent expired.");
    requireOriginalArchiveSource();
    if (!databaseOnly || !prepared || !mutationFenceHeld) {
      throw new Error("Fresh paused continuation requires its original retained mutation fence.");
    }
  };
  requireFreshContinuation();
  if (freshPrivateDatabase) {
    // The six effects already committed through the private original factory.
    // Persist their observed evidence only; never call legacy invalidation or
    // claim a legacy pre-restore snapshot/release-preservation operation.
    restorePhase = "record_fresh_original_authority_evidence";
    const authorityEvidence = {invalidated,authority_commit:databaseEvidence.authority_commit,
      authority_observation:databaseEvidence.authority_observation,
      original_data_readback:databaseEvidence.authority_data_readback};
    await db.query(`update custodial_dr.restore_manifests set authority_invalidated=true,authority_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify(authorityEvidence)]);
    requireFreshContinuation();
    await recordEvent("AUTHORITY_RECONCILIATION", "PASSED", authorityEvidence);
    requireFreshContinuation();
  }
  let cronEvidence = null;
  if (summary.format === "memphis-zoo-disaster-recovery.v4") {
    restorePhase = "restore_cron";
    requireFreshContinuation();
    // The fresh initializer restored cron in its original unpaused DATA
    // transaction. Once paused, observe it in a read-only snapshot; never
    // repeat DDL/counter writes through the application mutation fence.
    await db.query(freshPrivateDatabase ? "begin isolation level repeatable read read only" : "begin");
    try {
      requireFreshContinuation();
      if(nativeTextDatabase)await db.query("set local session_replication_role = replica");
      cronEvidence = await (freshPrivateDatabase ? verifyRestoredCronJobs : restoreCronJobs)(db, archivedCronJobs, {
        sourceDatabase: String(summary.database_snapshot?.database_name || "") || null,
      });
      requireFreshContinuation();
      await db.query(freshPrivateDatabase ? "rollback" : "commit");
      requireFreshContinuation();
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
    if (cronEvidence.differences.length) {
      requireFreshContinuation();
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'cron_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, cronEvidence.before.length, cronEvidence.actual.length, JSON.stringify(cronEvidence)]);
      requireFreshContinuation();
    }
    requireFreshContinuation();
    await recordEvent("CRON", cronEvidence.differences.length ? "HELD" : "PASSED", {
      before_count: cronEvidence.before.length,
      restored_count: cronEvidence.actual.length,
      differences: cronEvidence.differences,
    });
    requireFreshContinuation();
  }

  restorePhase = "restore_storage";
  requireFreshContinuation();
  await setControl("STORAGE_RESTORING");
  requireFreshContinuation();
  let storageEvidence;
  let productionSupabase = null;
  if (databaseOnly && String(process.env.RESTORE_DRILL_FORCE_STORAGE_FAILURE || "").toLowerCase() === "true") {
    throw new Error("Isolated restore drill forced a Storage restoration failure.");
  }
  if (databaseOnly) {
    if (freshPrivateDatabase) {
      requireFreshContinuation();
      const relationResult = await db.query("select pg_catalog.to_regclass('storage.buckets')::oid::text buckets_oid,pg_catalog.to_regclass('storage.objects')::oid::text objects_oid");
      requireFreshContinuation();
      const unavailable = () => { throw new Error("Fresh original Storage relation availability is inconsistent or unavailable."); };
      const data = (value, key) => {
        if (!value || typeof value !== "object" || types.isProxy(value)) unavailable();
        const field = Object.getOwnPropertyDescriptor(value, key);
        if (!field || !Object.hasOwn(field, "value")) unavailable();
        return field.value;
      };
      const relationRows = data(relationResult, "rows");
      if (data(relationResult, "command") !== "SELECT" || data(relationResult, "rowCount") !== 1
          || !Array.isArray(relationRows) || types.isProxy(relationRows)
          || Object.getPrototypeOf(relationRows) !== Array.prototype || relationRows.length !== 1
          || Reflect.ownKeys(relationRows).length !== 2) unavailable();
      const relation = data(relationRows, "0");
      if (!relation || types.isProxy(relation) || Object.getPrototypeOf(relation) !== Object.prototype
          || Reflect.ownKeys(relation).length !== 2
          || !Object.hasOwn(relation, "buckets_oid") || !Object.hasOwn(relation, "objects_oid")) unavailable();
      const bucketsOid = data(relation, "buckets_oid"), objectsOid = data(relation, "objects_oid");
      const oid = value => typeof value === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/.test(value)
        && BigInt(value) <= 4294967295n;
      if ((bucketsOid !== null && !oid(bucketsOid)) || (objectsOid !== null && !oid(objectsOid))) unavailable();
      if (bucketsOid !== null && bucketsOid === objectsOid) unavailable();
      if ((bucketsOid === null) !== (objectsOid === null)) unavailable();
      if (bucketsOid === null) {
        if (tableSelection.storageTables.length !== 0 || buckets.length !== 0 || objects.length !== 0
            || databaseEvidence.original_data_readback?.storage_data?.status !== "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"
            || databaseEvidence.authority_data_readback?.storage_data?.status !== "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS") unavailable();
        requireFreshContinuation();
        // Completed N/A stage only: neither hidden-row emptiness nor metadata,
        // owner/access, object-byte or provider verification is asserted.
        storageEvidence = {status:"NOT_APPLICABLE_ORIGINAL_NO_MEMBERS",stage_disposition:"NOT_APPLICABLE",
          scope:"FRESH_DATABASE_ONLY_ORIGINAL_NO_MEMBERS_AND_TARGET_RELATIONS_ABSENT",
          target_relations:{buckets:"ABSENT",objects:"ABSENT"},
          original_data_readback_status:"NOT_APPLICABLE_ORIGINAL_NO_MEMBERS",
          authority_data_readback_status:"NOT_APPLICABLE_ORIGINAL_NO_MEMBERS",
          database_only_metadata_verified:false,metadata_and_ownership_verified:false,
          object_bytes_verified:false,provider_verified:false,metadata_only:true};
        requireFreshContinuation();
      }
    }
    if (storageEvidence === undefined) {
    requireFreshContinuation();
    const restoredBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    requireFreshContinuation();
    const restoredObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    requireFreshContinuation();
    const storageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: restoredBuckets.rows.map((item) => item.row),
      actualObjects: restoredObjects.rows.map((item) => item.row),
    }).filter((item) => item.field !== "owner_access_boundary");
    if (storageDifferences.length) throw new Error(`Isolated database Storage metadata restore differed in ${storageDifferences.length} field(s).`);
    storageEvidence = { database_only_metadata_verified: true, archived_buckets: buckets.length, archived_objects: objects.length };
    if(nativeTextDatabase){
      // Independently re-lock/revalidate the same actual columns/I/O after
      // authority reconciliation, then compare EVERY Storage table to the
      // retained exact original TEXT. No private decoder/source is borrowed.
      await db.query("begin");
      try{
        const plans=await prepareNativeTextRestorePlans("STORAGE_RESTORING",true);
        await compareNativeTextRestorePlans(plans,tableSelection.storageTables);
        await db.query("rollback");
      }catch(error){await db.query("rollback").catch(()=>{});throw error;}
      requireFreshContinuation();
      storageEvidence.exact_table_data={status:"MATCH",tables:tableSelection.storageTables.length,
        original_text_multiset:true,scope:"POST_AUTHORITY_SAME_ORIGINAL_NATIVE_SQL",object_provider_verified:false};
    }
    }
  } else {
    const supabase = createClient(`https://${projectRef}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    productionSupabase = supabase;
    const targetBucketsBefore = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    const targetObjectsBefore = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const preparedUploads = await prepareVerifiedStorageUploads({ verifiedArchive });
    let storageUploadFailed = false;
    try {
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource(); preparedUploads.requireCurrent();
    for (const bucket of preparedUploads.buckets) {
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      const created = await supabase.storage.createBucket(bucket.id, bucket.options);
      if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw created.error;
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      if (created.error) {
        requireOrdinaryRestoreIntentFresh();
        requireOriginalArchiveSource(); preparedUploads.requireCurrent();
        const updated = await supabase.storage.updateBucket(bucket.id, bucket.options);
        if (updated.error) throw updated.error;
        requireOrdinaryRestoreIntentFresh();
        requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      }
    }
    for (const object of preparedUploads.objects) {
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      const uploaded = await supabase.storage.from(object.bucket_id).upload(object.name, object.body, object.options);
      if (uploaded.error) throw uploaded.error;
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      const downloaded = await supabase.storage.from(object.bucket_id).download(object.name);
      if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("Original Storage byte verification unavailable.");
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      const actual = sha256Bytes(Buffer.from(await downloaded.data.arrayBuffer()));
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource(); preparedUploads.requireCurrent();
      if (actual !== object.sha256) throw new Error("Original Storage byte verification differs.");
    }
    } catch (error) { storageUploadFailed = true; throw error; }
    finally {
      let cleanupFailed = false, cleanupFailure;
      try { requireOriginalArchiveSource(); preparedUploads.requireCurrent(); }
      catch (error) { cleanupFailed = true; cleanupFailure = error; }
      try { preparedUploads.close(); }
      catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupFailure = error; } }
      if (cleanupFailed && !storageUploadFailed) throw cleanupFailure;
    }
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const actualBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const actualObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const storageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: actualBuckets.rows.map((item) => item.row),
      actualObjects: actualObjects.rows.map((item) => item.row),
    });
    const exactStorageData = await readExactOriginalStorageSnapshot();
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    storageEvidence = {
      buckets: buckets.length,
      verified_object_bytes: objects.length,
      archived_bytes: objects.reduce((total, item) => total + Number(item.size_bytes), 0),
      target_buckets_before: targetBucketsBefore.rowCount,
      target_objects_before: targetObjectsBefore.rowCount,
      metadata_and_ownership_verified: storageDifferences.length === 0 && exactStorageData.status === "MATCH",
      exact_table_data: exactStorageData,
      discrepancies: storageDifferences,
    };
    if (!storageEvidence.metadata_and_ownership_verified) {
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource();
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'storage_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, objects.length, actualObjects.rowCount, JSON.stringify(storageEvidence)]);
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource();
    }
  }
  if (freshStorageProvider !== null) {
    requireFreshContinuation();
    const providerEvidence = await verifyFreshLocalStorageProvider({token:freshStorageProvider,db,state:"STORAGE_RESTORING"});
    requireFreshContinuation();
    const actualBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    requireFreshContinuation();
    const actualObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    requireFreshContinuation();
    const differences = compareStorageState({archivedBuckets:buckets,archivedObjects:objects,
      actualBuckets:actualBuckets.rows.map(item=>item.row),actualObjects:actualObjects.rows.map(item=>item.row)})
      .filter(item=>!(item.field==='owner_access_boundary' && providerEvidence.owner_access_probes.some(probe=>probe.bucket_id===item.bucket_id && probe.name===item.name && probe.status==='VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY')));
    const exact = await readExactOriginalStorageSnapshot();
    requireFreshContinuation();
    // Clear only the boundary for this exact archived member after genuine
    // intended/foreign/anon/invalid-signature HTTP probes, not service reads.
    storageEvidence = {...storageEvidence,...providerEvidence,exact_table_data:exact,discrepancies:differences,
      metadata_only:false,metadata_and_ownership_verified:differences.length===0 && exact.status==="MATCH"};
    if (!storageEvidence.metadata_and_ownership_verified) {
      await db.query(`insert into custodial_dr.restore_discrepancies(
        restore_id,authority_generation,category,status,before_count,restored_count,details_json
      ) values ($1,$2,'storage_state','OPEN',$3,$4,$5::jsonb)
      on conflict (restore_id,category) do update set status='OPEN',before_count=excluded.before_count,
        restored_count=excluded.restored_count,details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null`,
      [restoreId,generation,objects.length,actualObjects.rowCount,JSON.stringify(storageEvidence)]);
      requireFreshContinuation();
    }
  }
  const storageVerified = freshStorageProvider !== null
    ? storageEvidence.provider_verified === true && storageEvidence.metadata_and_ownership_verified === true
    : databaseOnly || storageEvidence.metadata_and_ownership_verified === true;
  requireFreshContinuation();
  await db.query(`update custodial_dr.restore_manifests set storage_verified=$2,storage_evidence=$3::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, storageVerified, JSON.stringify(storageEvidence)]);
  requireFreshContinuation();
  await recordEvent("STORAGE", storageVerified ? "PASSED" : "HELD", storageEvidence);
  requireFreshContinuation();

  restorePhase = "post_restore_verification";
  requireFreshContinuation();
  await setControl("VERIFYING");
  requireFreshContinuation();

  if (!databaseOnly || freshStorageProvider !== null) {
    if (freshStorageProvider !== null) {
      requireFreshContinuation();
      storageEvidence.final_provider_resample = await verifyFreshLocalStorageProvider({token:freshStorageProvider,db,state:"VERIFYING"});
      requireFreshContinuation();
    }
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const finalBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const finalObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const finalStorageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: finalBuckets.rows.map((item) => item.row),
      actualObjects: finalObjects.rows.map((item) => item.row),
    }).filter(item=>!(freshStorageProvider !== null && item.field==='owner_access_boundary'
      && storageEvidence.final_provider_resample.owner_access_probes.some(probe=>probe.bucket_id===item.bucket_id && probe.name===item.name && probe.status==='VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY')));
    const finalExactStorageData = await readExactOriginalStorageSnapshot();
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    const finalStorageVerified = finalStorageDifferences.length === 0 && finalExactStorageData.status === "MATCH";
    storageEvidence.metadata_and_ownership_verified = storageEvidence.metadata_and_ownership_verified === true && finalStorageVerified;
    storageEvidence.final_quiescent_resample = {
      buckets: finalBuckets.rowCount,
      objects: finalObjects.rowCount,
      differences: finalStorageDifferences,
      exact_table_data: finalExactStorageData,
      metadata_and_ownership_verified: finalStorageVerified,
      application_mutation_fence_held: mutationFenceHeld,
      storage_api_client_initialized: Boolean(productionSupabase),
    };
    if (!finalStorageVerified) {
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource();
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'storage_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, objects.length, finalObjects.rowCount, JSON.stringify(storageEvidence)]);
      requireOrdinaryRestoreIntentFresh();
      requireOriginalArchiveSource();
    }
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
    await db.query("update custodial_dr.restore_manifests set storage_verified=$2,storage_evidence=$3::jsonb,updated_at=clock_timestamp() where restore_id=$1", [restoreId, storageEvidence.metadata_and_ownership_verified, JSON.stringify(storageEvidence)]);
    requireOrdinaryRestoreIntentFresh();
    requireOriginalArchiveSource();
  }
  if (cronEvidence) {
    requireFreshContinuation();
    const finalCronJobs = await readCronJobs(db);
    requireFreshContinuation();
    const finalCronDifferences = compareCronJobs(cronEvidence.expected, finalCronJobs);
    cronEvidence.final_quiescent_resample = { jobs: finalCronJobs.length, differences: finalCronDifferences };
    if (finalCronDifferences.length) {
      requireFreshContinuation();
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'cron_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, cronEvidence.expected.length, finalCronJobs.length, JSON.stringify(cronEvidence)]);
      requireFreshContinuation();
    }
  }
  requireFreshContinuation();
  const unresolved = await db.query("select count(*)::int count from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN'", [restoreId]);
  requireFreshContinuation();
  const unresolvedCount = Number(unresolved.rows[0].count);
  const resumeEligible = unresolvedCount === 0;
  const finalManifest = {
    restore_id: restoreId,
    authority_generation: generation,
    archive_digest: archiveDigest,
    source_identity: summary.source_identity,
    database_tables: databaseEvidence.tables,
    database_rows: databaseEvidence.rows,
    ...(immutablePrivateDataEvidence === null && !nativeTextDatabase ? {} : { database_evidence: databaseEvidence }),
    unvalidated_check_constraints: unvalidatedCheckEvidence,
    storage: storageEvidence,
    cron: cronEvidence,
    authority_invalidated: invalidated,
    unresolved_discrepancies: unresolvedCount,
    resume_eligible: resumeEligible,
  };
  const finalManifestSha256 = sha256Bytes(stableJson(finalManifest));
  requireFreshContinuation();
  await db.query(`update custodial_dr.restore_manifests set post_restore_verified=true,final_manifest_sha256=$2,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, finalManifestSha256]);
  requireFreshContinuation();
  // A destructive restore never reopens admission itself. A separately signed
  // reconciliation binds this final manifest and resolves the exact discrepancy
  // set after the restore releases its global fence. A crash at any point leaves
  // mutations paused.
  await setControl("PAUSED_RECONCILIATION", { paused: true, completed: true });
  requireFreshContinuation();
  await recordEvent("FINAL", "HELD", {
    resumed: false,
    resume_eligible: resumeEligible,
    unresolved_discrepancies: unresolvedCount,
    separate_signed_reconciliation_required: true,
  });
  requireFreshContinuation();
  restoreSuccessOutput = JSON.stringify({
    ok: true,
    restore_id: restoreId,
    authority_generation: generation,
    restored_project_ref: projectRef,
    database_only: databaseOnly,
    database_tables: databaseEvidence.tables,
    database_rows: databaseEvidence.rows,
    ...(immutablePrivateDataEvidence === null && !nativeTextDatabase ? {} : { database_evidence: databaseEvidence }),
    storage: storageEvidence,
    authority_invalidated: invalidated,
    final_manifest_sha256: finalManifestSha256,
    unresolved_discrepancies: unresolvedCount,
    mutations_paused: true,
    resume_eligible: resumeEligible,
    state: "PAUSED_RECONCILIATION",
    ...(freshPrivateDatabase ? {complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,
      archive_digest:archiveDigest,target_project_ref:projectRef,database_phase:databaseEvidence.original_data_import,
      original_data_readback:databaseEvidence.original_data_readback,authority_staged:databaseEvidence.authority_staged,
      authority_commit:databaseEvidence.authority_commit,authority_observation:databaseEvidence.authority_observation,
      authority_data_readback:databaseEvidence.authority_data_readback,
      remaining_phases:["SIGNED_RECONCILIATION"],normal_production_private_apply:"PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"} : {}),
  }, null, 2);
  requireFreshContinuation();
}
try {
  await db.connect();
  await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
  restoreSessionLockHeld = true;
try {
  requireRestoreIntentFresh();
  if (freshPrivateDatabase) {
    // No legacy pause/prepare, second initializer, TRUNCATE/replica or second
    // authority rewrite. Only the original private factory may bridge to the
    // existing paused continuation after both acknowledged original decisions.
    let transactionAttempted = false, commitInvoked = false;
    try {
      requireOriginalArchiveSource();
      restorePhase = "fresh_private_database_transaction";
      transactionAttempted = true;
      await db.query("begin");
      requireOriginalArchiveSource();
      await db.query("set local search_path = pg_catalog");
      requireOriginalArchiveSource();
      await db.query("set local extra_float_digits = 3;set local datestyle = 'ISO, YMD';set local timezone = 'UTC';set local intervalstyle = 'postgres';set local bytea_output = 'hex'");
      requireOriginalArchiveSource();
      // This does not disable RLS: PostgreSQL must refuse any filtered row.
      await db.query("set local row_security = off");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
      requireOriginalArchiveSource();
      restorePhase = "stage_fresh_private_database";
      await stageVerifiedImmutableFreshData({db,verifiedArchive,originalIntentEnvelope:intentEnvelope,intentVerifyKey,intentVerifyKeyId});
      requireOriginalArchiveSource();
      restorePhase = "commit_fresh_private_database";
      commitInvoked = true;
      const committed = await commitVerifiedImmutableFreshData({db,verifiedArchive});
      transactionAttempted = false;
      freshDatabaseCommitAcknowledged = true;
      // Current original DATA verification is a separate READ ONLY snapshot,
      // not a second import/COMMIT or authorization from the public reply.
      // Keep the original private module state, same native connection and
      // both actual fences. The source registry's existing SHARE-lock check
      // remains mandatory; no cached old-xid or missing-lock fallback.
      restorePhase = "read_committed_fresh_original_data";
      transactionAttempted = true;
      await db.query("begin isolation level repeatable read read only");
      requireOriginalArchiveSource();
      await db.query("set local extra_float_digits = 3;set local datestyle = 'ISO, YMD';set local timezone = 'UTC';set local intervalstyle = 'postgres';set local bytea_output = 'hex'");
      requireOriginalArchiveSource();
      // Source migrations can initialize a TEMP namespace on this same
      // backend. Explicitly put it LAST; omitting it implicitly searches it
      // before pg_catalog even after its ON COMMIT DROP tables are gone.
      await db.query("set local search_path = pg_catalog, pg_temp");
      requireOriginalArchiveSource();
      await db.query("set local row_security = off");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
      requireOriginalArchiveSource();
      await db.query("lock table public.custodial_release_authority_restore_inventory in share mode");
      requireOriginalArchiveSource();
      const originalDataReadback = await inspectCommittedImmutableFreshData({db,verifiedArchive});
      requireOriginalArchiveSource();
      // Preserve only observed comparison metadata if a later condition
      // refuses. No raw archived/current rows or SQL leave this handoff.
      freshDataReadbackDisposition = {
        private_state: originalDataReadback.private_data.state,
        ordinary_state: originalDataReadback.ordinary_data.state,
        storage_status: originalDataReadback.storage_data.status,
        unresolved_table_ids: [
          ...originalDataReadback.private_data.tables,
          ...originalDataReadback.ordinary_data.tables,
          ...originalDataReadback.storage_data.tables,
        ].filter(table => ["UNSUPPORTED", "DIFFERENT"].includes(table.state || table.status))
          .map(table => `${table.schema_name}.${table.table_name}`),
        source_owned_table_ids: originalDataReadback.ordinary_data.tables
          .filter(table => table.state === "CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK")
          .map(table => `${table.schema_name}.${table.table_name}`),
      };
      if (originalDataReadback.private_data.state !== "MATCH"
          || !["MATCH", "CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK", "SOURCE_TRANSFORMATION_VERIFIED"].includes(originalDataReadback.ordinary_data.state)
          || !["MATCH", "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"].includes(originalDataReadback.storage_data.status)) {
        throw Object.assign(new Error("Committed original DATA remains different or unsupported; retain the paused original for reconciliation."), {
          code: "IMMUTABLE_FRESH_ORIGINAL_DATA_UNRESOLVED", outcome: "UNKNOWN", retry_safe: false,
          commit_status: "ACKNOWLEDGED", complete_restore: false, resume_allowed: false, rerun_import_allowed: false,
        });
      }
      await db.query("rollback");
      transactionAttempted = false;
      // The private factory owns BEGIN and all DATA locks before its first
      // snapshot SELECT; an already-open caller snapshot is never admitted.
      restorePhase = "reconcile_committed_fresh_original_authority";
      transactionAttempted = true;
      const authorityStaged = await reconcileCommittedImmutableFreshAuthority({db,verifiedArchive});
      requireOriginalArchiveSource();
      restorePhase = "commit_fresh_original_authority";
      freshAuthorityCommitInvoked = true;
      const authorityCommitted = await commitVerifiedImmutableFreshAuthority({db,verifiedArchive});
      freshAuthorityCommitAcknowledged = true;
      freshAuthorityOriginalRequest = authorityCommitted.requested_original;
      transactionAttempted = false;
      requireOriginalArchiveSource();
      // Observe the exact committed CONSUMED scope in a separate actual RO
      // snapshot. The private factory alone admitted effects; this public
      // request is lookup DATA and cannot recreate any execution authority.
      restorePhase = "read_committed_fresh_original_authority";
      transactionAttempted = true;
      await db.query("begin isolation level repeatable read read only");
      requireOriginalArchiveSource();
      await db.query("set local search_path = pg_catalog, pg_temp");
      requireOriginalArchiveSource();
      await db.query("set local extra_float_digits = 3;set local datestyle = 'ISO, YMD';set local timezone = 'UTC';set local intervalstyle = 'postgres';set local bytea_output = 'hex'");
      requireOriginalArchiveSource();
      await db.query("set local row_security = off");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
      requireOriginalArchiveSource();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
      requireOriginalArchiveSource();
      await db.query("lock table public.custodial_release_authority_restore_inventory in share mode");
      requireOriginalArchiveSource();
      const authorityObservation = await readVerifiedImmutableFreshAuthorityCommitOutcome({db,request:freshAuthorityOriginalRequest});
      requireOriginalArchiveSource();
      if (authorityObservation.outcome !== "AUTHORITY_COMPLETION_OBSERVED") {
        throw Object.assign(new Error("Original authority COMMIT readback remains unavailable."), {
          code:"IMMUTABLE_FRESH_AUTHORITY_READBACK_UNRESOLVED",outcome:"UNKNOWN",retry_safe:false,
        });
      }
      // The public fixed outcome is metadata, not a data-verification token.
      // The same MODULE's private original invocation must still own its
      // acknowledged import and authority ancestry. Compare every original
      // table under the two normal fences; never waive the six changed stores.
      restorePhase = "read_committed_fresh_original_authority_data";
      const authorityDataReadback = await inspectCommittedImmutableFreshAuthorityData({db,verifiedArchive});
      requireOriginalArchiveSource();
      if (authorityDataReadback.schema !== "custodial.immutable-private-post-authority-data-readback.v1"
          || !["MATCH", "SOURCE_TRANSFORMATION_VERIFIED"].includes(authorityDataReadback.state)
          || authorityDataReadback.private_data.state !== "MATCH"
          || !["MATCH", "SOURCE_TRANSFORMATION_VERIFIED"].includes(authorityDataReadback.ordinary_data.state)
          || !["MATCH", "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"].includes(authorityDataReadback.storage_data.status)
          || authorityDataReadback.comparison_only !== true || authorityDataReadback.metadata_only !== true
          || ["complete_restore", "resume_allowed", "retry_allowed", "rerun_import_allowed",
            "inventory_acknowledged", "effects"].some(key => authorityDataReadback[key] !== false)) {
        throw Object.assign(new Error("Original DATA after authority invalidation remains unresolved."), {
          code:"IMMUTABLE_FRESH_POST_AUTHORITY_DATA_UNRESOLVED",outcome:"UNKNOWN",retry_safe:false,
        });
      }
      // Bridge the already-held xact fences BEFORE this original RO snapshot
      // ends. The module's private same-invocation ancestry, not public DATA,
      // admits this ONE session-fence acquisition. An unknown result is not
      // retried: normal end of the original connection drains session locks.
      restorePhase = "hold_fresh_original_authority_post_data_fence";
      requireOriginalArchiveSource();
      await holdVerifiedImmutableFreshPostAuthorityFence({db,verifiedArchive});
      mutationFenceHeld = true;
      requireOriginalArchiveSource();
      await db.query("rollback");
      transactionAttempted = false;
      requireOriginalArchiveSource();
      prepared = true;
      // Counts describe the complete signed original selection, not current
      // target row counts or guessed imported/revoked totals. No CHECK was
      // suspended or tested by this immutable path; do not manufacture a zero
      // CHECK inventory or a restored legacy snapshot.
      const unvalidatedCheckEvidence = {mode:"NOT_SUSPENDED"};
      const databaseEvidence = {
        tables: tableSelection.databaseTables.length,
        rows: tableSelection.databaseTables.reduce((total,table)=>total+BigInt(table.row_count),0n).toString(),
        row_count_basis: "SIGNED_ORIGINAL_SELECTION",
        unvalidated_check_constraints: unvalidatedCheckEvidence,
        original_data_import: committed, original_data_readback: originalDataReadback,
        authority_staged: authorityStaged, authority_commit: authorityCommitted,
        authority_observation: authorityObservation, authority_data_readback: authorityDataReadback,
      };
      requireOriginalArchiveSource();
      await continueRestoreAfterDatabase({databaseEvidence,immutablePrivateDataEvidence:committed,
        unvalidatedCheckEvidence,invalidated:authorityStaged.completion.revocations});
    } catch (error) {
      const attempted = error && typeof error === "object"
        ? Object.getOwnPropertyDescriptor(error,"commit_attempted") : null;
      const explicitlyNotAttempted = attempted && Object.hasOwn(attempted,"value") && attempted.value === false;
      freshCommitNeedsObservation = commitInvoked && !freshDatabaseCommitAcknowledged && !explicitlyNotAttempted;
      freshAuthorityCommitNeedsObservation = freshAuthorityCommitInvoked && !freshAuthorityCommitAcknowledged && !explicitlyNotAttempted;
      if (freshAuthorityCommitNeedsObservation && error && typeof error === "object" && !types.isProxy(error)) {
        const field=Object.getOwnPropertyDescriptor(error,"requested_original");
        if(field&&Object.hasOwn(field,"value"))freshAuthorityOriginalRequest=field.value;
      }
      if (transactionAttempted && !freshCommitNeedsObservation && !freshAuthorityCommitNeedsObservation) {
        try { await db.query("rollback"); }
        catch (cleanupError) {
          const failure = new AggregateError([error,cleanupError],"Fresh database phase and rollback cleanup failed.",{cause:error});
          if (error?.outcome === "UNKNOWN" && error?.retry_safe === false) Object.assign(failure,
            {outcome:"UNKNOWN",retry_safe:false,code:error.code});
          throw failure;
        }
      }
      if (freshCommitNeedsObservation && !(error?.outcome === "UNKNOWN" && error?.retry_safe === false)) {
        throw Object.assign(new Error("Original fresh database commit outcome requires fixed read-only observation."),
          {code:"IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN",outcome:"UNKNOWN",retry_safe:false});
      }
      throw error;
    }
  } else {
  restorePhase = "preflight";
  requireOrdinaryRestoreIntentFresh();
  const control = await db.query("select * from custodial_dr.restore_control where singleton=true for update");
  if (control.rowCount !== 1) throw new Error("The non-restored disaster-recovery control plane is unavailable.");
  const previousControl = control.rows[0];
  const retryFailure = previousControl.mutations_paused === true
    && previousControl.state === "PAUSED_FAILURE"
    && String(previousControl.restore_id) === String(intent.retry_of_restore_id || "");
  const freshRestore = previousControl.mutations_paused === false
    && ["READY", "COMPLETE"].includes(previousControl.state)
    && intent.retry_of_restore_id === null;
  if (!retryFailure && !freshRestore) throw new Error("Another restore or reconciliation already holds the mutation pause, or the retry authority is stale.");
  if (generation !== Number(previousControl.authority_generation) + 1) throw new Error("Restore intent generation is not the next non-restored authority generation.");
  if (retryFailure) {
    await refuseUnreconciledImmutableRetry(db, { restoreId: previousControl.restore_id, generation: previousControl.authority_generation });
    requireOrdinaryRestoreIntentFresh();
    const retryLeases = await db.query("select count(*)::int count from custodial_dr.application_mutation_leases");
    if (Number(retryLeases.rows[0].count) !== 0) throw new Error("A PAUSED_FAILURE retry requires every application mutation lease to be settled or reconciled.");
  }
  const preflightTargetIdentity = await readTargetIdentity();
  assertIntentTargetIdentity(preflightTargetIdentity);
  if (databaseOnly && /^(1|true|yes)$/i.test(String(process.env.RESTORE_DRILL_PREFLIGHT_BARRIER || ""))) {
    requireOrdinaryRestoreIntentFresh();
    await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
    await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
    requireOrdinaryRestoreIntentFresh();
  }

  requireOriginalArchiveSource();
  requireRestoreIntentFresh();
  restorePhase = "pause_admission";
  requireOrdinaryRestoreIntentFresh();
  await db.query("begin");
  try {
    // Close HTTP/API admission atomically. Existing request leases are allowed
    // to finish; later admissions wait on this lock and then observe pause.
    requireOrdinaryRestoreIntentFresh();
    await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
    requireRestoreIntentFresh();
    await db.query(`
      update custodial_dr.restore_control set
        authority_generation=$1,mutations_paused=true,state='PREPARING',restore_id=$2,
        archive_digest=$3,source_project_ref=$4,target_project_ref=$5,
        release_identity=$6::jsonb,started_by=$7,started_at=clock_timestamp(),
        completed_at=null,failure_reason=null,updated_at=clock_timestamp()
      where singleton=true
    `, [generation, restoreId, archiveDigest, summary.project_ref, projectRef, JSON.stringify({ archive: summary.source_identity.release, target: preflightTargetIdentity.release_identity, retry_of_restore_id: intent.retry_of_restore_id }), intent.actor]);
    requireOrdinaryRestoreIntentFresh();
    await db.query(`
      insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest)
      values ($1,$2,$3)
    `, [restoreId, generation, archiveDigest]);
    requireRestoreIntentFresh();
    await db.query("commit");
    prepared = true;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }

  restorePhase = "drain_admitted_mutations";
  const leaseDrainDeadline = Date.now() + 5 * 60_000;
  let activeLeaseCount = 0;
  let expiredLeaseCount = 0;
  do {
    requireOrdinaryRestoreIntentFresh();
    const leases = await db.query(`
      select
        count(*) filter (where expires_at>clock_timestamp())::int active_count,
        count(*) filter (where expires_at<=clock_timestamp())::int expired_count
      from custodial_dr.application_mutation_leases
    `);
    activeLeaseCount = Number(leases.rows[0].active_count);
    expiredLeaseCount = Number(leases.rows[0].expired_count);
    if (expiredLeaseCount > 0) {
      throw new Error(`Restore pause found ${expiredLeaseCount} expired application mutation lease(s). Expiry is not proof that external mutation stopped; exact named reconciliation is required.`);
    }
    if (activeLeaseCount === 0) break;
    if (Date.now() >= leaseDrainDeadline) throw new Error(`Restore pause could not drain ${activeLeaseCount} admitted application mutation lease(s).`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (true);

  restorePhase = "acquire_global_mutation_fence";
  requireOrdinaryRestoreIntentFresh();
  await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
  mutationFenceHeld = true;

  restorePhase = "quiescent_target_identity";
  const quiescentTargetIdentity = await readTargetIdentity();
  assertIntentTargetIdentity(quiescentTargetIdentity);

  restorePhase = "quiescent_snapshot";
  requireOrdinaryRestoreIntentFresh();
  await db.query("begin");
  try {
    // Canonical native TEXT output belongs only to this snapshot transaction.
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local extra_float_digits = 3");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local datestyle = 'ISO, YMD'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local timezone = 'UTC'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local intervalstyle = 'postgres'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local bytea_output = 'hex'");
    requireOriginalArchiveSource();
    // The session-level exclusive fence remains held through database, cron,
    // Storage, and final verification. DDL and direct writers either drained
    // before this point or observe the paused generation after release.
    requireOrdinaryRestoreIntentFresh();
    const snapshotEvidence = await capturePreRestoreState(db, { restoreId, generation });
    requireOrdinaryRestoreIntentFresh();
    await recordEvent("PREPARE", "PASSED", {
      target_migration_head: quiescentTargetIdentity.migration_head,
      drained_application_mutation_leases: activeLeaseCount,
      expired_application_mutation_lease_blockers: expiredLeaseCount,
      target_identity_revalidated_under_global_fence: true,
      snapshots: snapshotEvidence,
    });
    requireOrdinaryRestoreIntentFresh();
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }

  requireOriginalArchiveSource();
  restorePhase = "restore_database";
  requireOrdinaryRestoreIntentFresh();
  await db.query("begin");
  let unvalidatedCheckEvidence = restoreCheckEvidence([]);
  let immutablePrivateDataEvidence = null;
  let nativeTextPlans = null;
  let databaseEvidence;
  let databaseEventEvidence;
  let mixedDataCommitAttempted = false;
  async function recordDatabaseRestored() {
    requireOrdinaryRestoreIntentFresh();
    await setControl("DATABASE_RESTORED");
    requireOrdinaryRestoreIntentFresh();
    await db.query(`update custodial_dr.restore_manifests set database_verified=true,database_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify(databaseEvidence)]);
    requireOrdinaryRestoreIntentFresh();
    await recordEvent("DATABASE", "PASSED", databaseEventEvidence);
  }
  try {
    if (tableSelection.privateTables.length) {
      // Still unreachable until Main removes the PRE-CONNECT unsupported hold
      // after target qualification. This is NOT the destructive replica route:
      // begin_immutable_private_import must lock/prove the actual EMPTY target,
      // same managed owner/session/transaction, original control and guards.
      // The existing importer consumes BOTH private and ordinary original DATA,
      // including exact raw TEXT/EOF/digests. Never run the ordinary loop twice.
      restorePhase = "restore_immutable_mixed_data";
      immutablePrivateDataEvidence = await stagePrivateOriginalsUnderOwnedFence();
      requireOriginalArchiveSource();
      assertIntentTargetIdentity(await readTargetIdentity());
      requireOriginalArchiveSource();
      // No CHECK, ALWAYS trigger, RLS or ACL was suspended in this branch.
      unvalidatedCheckEvidence = { ...unvalidatedCheckEvidence, mode: "NOT_SUSPENDED" };
    } else {
    nativeTextPlans=nativeTextDatabase ? await prepareNativeTextRestorePlans() : null;
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local session_replication_role = replica");
    if(nativeTextPlans)await nativeTextQuery(`create temporary table custodial_native_text_restore_expected(
      schema_name pg_catalog.text not null,table_name pg_catalog.text not null,raw pg_catalog.text not null) on commit preserve rows`);
    if (databaseTables.length) {
      restorePhase = "truncate_target_tables";
      // Native TEXT truncates ONLY the complete authenticated table set.
      // PostgreSQL refuses an external FK dependent; CASCADE must never reach
      // an unselected namespace just because the selected census matched.
      const sql=`truncate ${databaseTables.map((table) => qualified(table.schema_name, table.table_name)).join(",")} restart identity${nativeTextDatabase ? "" : " cascade"}`;
      if (!nativeTextDatabase) {
        requireOrdinaryRestoreIntentFresh();
        await db.query(`lock table ${databaseTables.map((table) => qualified(table.schema_name, table.table_name)).join(",")} in access exclusive mode`);
        requireOrdinaryRestoreIntentFresh();
      }
      if(nativeTextDatabase)await nativeTextQuery(sql);else {
        requireOrdinaryRestoreIntentFresh();
        await db.query(sql);
      }
    }
    restorePhase = "suspend_unvalidated_restore_checks";
    requireOrdinaryRestoreIntentFresh();
    const suspendedChecks = await suspendUnvalidatedRestoreChecks(db, databaseTables);
    for (const selectedTable of databaseTables) {
      restoreTable = `${selectedTable.schema_name}.${selectedTable.table_name}`;
      restorePhase = "restore_table";
      const tableData = openVerifiedRestoreTableData(verifiedArchive, selectedTable.schema_name, selectedTable.table_name);
      let rowStream, utf8Guard, wireSettled, input, tableFailure;
      try {
        // The reader resolves the table and expected bytes from its private
        // authenticated catalog. Caller paths or hashes grant no source custody.
        const table = tableData.table;
        const target = qualified(table.schema_name, table.table_name);
        const columns = table.columns.filter((column) => !column.generated).map((column) => column.name);
        const projection = columns.map((column) => `r.${quoteIdentifier(column)}`).join(",");
        const insert = `insert into ${target} (${columns.map(quoteIdentifier).join(",")}) overriding system value select ${projection} from json_populate_record(null::${target},$1::json) r`;
        rowStream = tableData.stream;
        utf8Guard = createRestoreRowUtf8Guard();
        wireSettled = pipeline(rowStream, utf8Guard);
        wireSettled.catch(() => {});
        input = createInterface({ input: utf8Guard, crlfDelay: Infinity });
        let restored = 0;
        for await (const line of input) {
          // Legacy JSON cannot distinguish JSON-column null from SQL NULL.
          // Require the existing mutation-fidelity proof before any row INSERT;
          // refusal stays inside this transaction and cannot become count-only success.
          const rawRowText = nativeTextPlans ? decodeRestoreTableRowLine(line, table)
            : assertRestoreRowMutationFidelity(line, table);
          if(nativeTextPlans){
            const result=await nativeTextQuery(nativeTextPlans.get(selectedTable).insert,[rawRowText,table.schema_name,table.table_name]);
            if(result.rowCount!==1 || result.rows[0].inserted!=="1" || result.rows[0].retained!=="1")
              throw new Error("Native TEXT original row import was not exact.");
          } else {
            requireOrdinaryRestoreIntentFresh();
            await db.query(insert, [rawRowText]);
          }
          restored += 1;
        }
        await wireSettled;
        // Inserts are still uncommitted. EOF, consumed-byte checksum and the
        // original source lifetime must settle before row-count/commit success.
        await tableData.verified;
        if (restored !== Number(table.row_count)) throw new Error(`Row-count mismatch while restoring ${restoreTable}.`);
      } catch (error) {
        tableFailure = error;
        throw error;
      } finally {
        input?.close();
        rowStream?.destroy();
        utf8Guard?.destroy();
        if (wireSettled) await wireSettled.catch(() => {});
        try {
          await tableData.close();
        } catch (cleanupError) {
          if (tableFailure) throw new AggregateError([tableFailure, cleanupError], "Restore table failed and its source cleanup also failed.", { cause: tableFailure });
          throw cleanupError;
        }
      }
    }
    restoreTable = null;
    restorePhase = "reinstate_unvalidated_restore_checks";
    requireOrdinaryRestoreIntentFresh();
    unvalidatedCheckEvidence = await reinstateUnvalidatedRestoreChecks(db, suspendedChecks);
    if(nativeTextPlans)await compareNativeTextRestorePlans(nativeTextPlans);
    }
    const importedTables = immutablePrivateDataEvidence === null ? databaseTables
      : databaseTables.filter((table) => !(table.schema_name === "public" && table.table_name === "release_deployment_manifest"));
    databaseEvidence = {
      tables: importedTables.length,
      rows: immutablePrivateDataEvidence === null
        ? databaseTables.reduce((total, table) => total + Number(table.row_count), 0)
        : importedTables.reduce((total, table) => total + BigInt(table.row_count), 0n).toString(),
      unvalidated_check_constraints: unvalidatedCheckEvidence,
    };
    databaseEventEvidence = { tables: importedTables.length, unvalidated_check_constraints: unvalidatedCheckEvidence };
    if(nativeTextDatabase){
      databaseEvidence.native_text_readback={state:"MATCH",tables:databaseTables.length,original_text_multiset:true};
      databaseEventEvidence.native_text_readback=databaseEvidence.native_text_readback;
    }
    if (immutablePrivateDataEvidence !== null) {
      const mixedEvidence = {
        original_data_import: immutablePrivateDataEvidence,
        consumed_source_tables: databaseTables.length,
        consumed_source_rows: databaseTables.reduce((total, table) => total + BigInt(table.row_count), 0n).toString(),
        preserved_current_release_bootstrap: true,
      };
      Object.assign(databaseEvidence, mixedEvidence);
      Object.assign(databaseEventEvidence, mixedEvidence);
      // DATA and its existing control/manifest/event evidence commit together.
      // A lost COMMIT reply must be reconciled from that same restore identity,
      // never by blindly replaying the original importer into a nonempty target.
      await recordDatabaseRestored();
    }
    if(nativeTextDatabase){
      await recordDatabaseRestored();
      // Last table comparison follows every evidence/check callback. The same
      // ACCESS EXCLUSIVE locks and control row remain held through COMMIT.
      await compareNativeTextRestorePlans(nativeTextPlans);
    }
    requireOriginalArchiveSource();
    if (immutablePrivateDataEvidence !== null || nativeTextDatabase) {
      if(nativeTextDatabase)requireNativeTextOwner();
      restorePhase = nativeTextDatabase ? "commit_native_text_data" : "commit_immutable_mixed_data";
      mixedDataCommitAttempted = true;
    }
    requireOrdinaryRestoreIntentFresh();
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    if (mixedDataCommitAttempted) {
      // A successful ROLLBACK reply cannot undo/prove absence of an earlier
      // COMMIT whose response was lost. Keep the original paused for named
      // reconciliation; expose no raw private SQL/row error detail here.
      throw Object.assign(new Error("Original DATA commit outcome is unknown; retain the original restore identity for named reconciliation, not an import retry."), {
        code: nativeTextDatabase ? "NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN" : "IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN", outcome: "UNKNOWN", retry_safe: false,
      });
    }
    throw error;
  }
  if (immutablePrivateDataEvidence === null && !nativeTextDatabase) {
    requireOrdinaryRestoreIntentFresh();
    await recordDatabaseRestored();
  }

  restorePhase = "authority_reconciliation";
  requireOrdinaryRestoreIntentFresh();
  await db.query("begin");
  let discrepancies;
  let invalidated;
  try {
    // Match the retained snapshot's native TEXT output before comparison/upsert.
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local extra_float_digits = 3");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local datestyle = 'ISO, YMD'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local timezone = 'UTC'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local intervalstyle = 'postgres'");
    requireOriginalArchiveSource();
    requireOrdinaryRestoreIntentFresh();
    await db.query("set local bytea_output = 'hex'");
    requireOriginalArchiveSource();
    if (immutablePrivateDataEvidence !== null) {
      // Private originals remain guarded during reconciliation too. Never
      // switch modes to make a rejected authority mutation succeed.
      if (!prepared || !mutationFenceHeld) throw new Error("Immutable authority reconciliation requires the existing prepared mutation fence.");
      requireOriginalArchiveSource();
      requireOrdinaryRestoreIntentFresh();
      const mode = await db.query("show session_replication_role");
      if (mode.rowCount !== 1 || mode.rows[0]?.session_replication_role !== "origin") {
        throw new Error("Immutable authority reconciliation requires origin replication mode.");
      }
      requireOriginalArchiveSource();
      assertIntentTargetIdentity(await readTargetIdentity());
      requireOriginalArchiveSource();
    } else if(nativeTextDatabase) {
      // The normal owner retains its ordinary replica route; a separate
      // original-archive join below preserves the private origin contract.
      requireOriginalArchiveSource();
      requireOrdinaryRestoreIntentFresh();
      await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
      requireOrdinaryRestoreIntentFresh();
      await db.query("set local session_replication_role = replica");
      requireOrdinaryRestoreIntentFresh();
      await db.query("set local row_security = off");
      requireOrdinaryRestoreIntentFresh();
      await db.query("set local search_path = pg_catalog, pg_temp");
      requireOriginalArchiveSource();
    } else {
      requireOrdinaryRestoreIntentFresh();
      await db.query("set local session_replication_role = replica");
    }
    requireOrdinaryRestoreIntentFresh();
    discrepancies = await compareRestoredState(db, { restoreId, generation });
    requireOrdinaryRestoreIntentFresh();
    const preservedReleaseRows = await preserveCurrentReleaseIdentity(db, { restoreId, generation });
    requireOrdinaryRestoreIntentFresh();
    invalidated = nativeTextDatabase
      ? await invalidateRestoredOrdinaryNativeAuthority(db,{generation,verifiedArchive})
      : await invalidateRestoredAuthority(db, { generation });
    requireOrdinaryRestoreIntentFresh();
    await db.query(`update custodial_dr.restore_manifests set authority_invalidated=true,authority_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify({ invalidated, preserved_release_rows: preservedReleaseRows, discrepancies })]);
    requireOrdinaryRestoreIntentFresh();
    await recordEvent("AUTHORITY_RECONCILIATION", "PASSED", { invalidated, preserved_release_rows: preservedReleaseRows, discrepancies });
    requireOrdinaryRestoreIntentFresh();
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }

  await continueRestoreAfterDatabase({databaseEvidence,immutablePrivateDataEvidence,unvalidatedCheckEvidence,invalidated});
  }
} catch (error) {
  const outcomeUnknown = error?.outcome === "UNKNOWN" && error?.retry_safe === false;
  const code = outcomeUnknown && (error?.code === "IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN"
    || error?.code === "NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN"
    || error?.code === "PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"
    || (freshPrivateDatabase && error?.code === "IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED")
    || error?.code === "RESTORE_RETRY_RECONCILIATION_REQUIRED") ? error.code : null;
  const currentImport = code === "IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN"
    || code === "NATIVE_TEXT_DATA_COMMIT_OUTCOME_UNKNOWN"
    || code === "PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED"
    || (freshPrivateDatabase && code === "IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED");
  let requestedOriginalRestore;
  if (code === "RESTORE_RETRY_RECONCILIATION_REQUIRED") {
    try {
      const field = Object.getOwnPropertyDescriptor(error, "requested_original_restore");
      const pointer = field && Object.hasOwn(field, "value") ? field.value : null;
      if (pointer && typeof pointer === "object" && Object.getPrototypeOf(pointer) === Object.prototype
          && Object.isFrozen(pointer)) {
        const keys = Reflect.ownKeys(pointer);
        const id = Object.getOwnPropertyDescriptor(pointer, "restore_id");
        const authority = Object.getOwnPropertyDescriptor(pointer, "authority_generation");
        if (keys.length === 2 && keys.every(key => key === "restore_id" || key === "authority_generation")
            && id && Object.hasOwn(id, "value") && id.enumerable
            && authority && Object.hasOwn(authority, "value") && authority.enumerable
            && typeof id.value === "string" && id.value.length === 36
            && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id.value)
            && typeof authority.value === "string" && /^[1-9][0-9]*(?![\s\S])/.test(authority.value)) {
          // Original read-request DATA only, not a committed/stored outcome.
          requestedOriginalRestore = Object.freeze({ restore_id: id.value, authority_generation: authority.value });
        }
      }
    } catch {
      // An uninspectable pointer is omitted, never replaced by this planned ID.
    }
  }
  let originalStatusRequest;
  if (outcomeUnknown && currentImport) {
    const originalGeneration = typeof generation === "string" ? generation
      : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : "";
    if (typeof restoreId === "string" && restoreId.length === 36
        && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(restoreId)
        && /^[1-9][0-9]{0,18}(?![\s\S])/.test(originalGeneration)
        && BigInt(originalGeneration) <= 9223372036854775807n
        && typeof archiveDigest === "string" && archiveDigest.length === 64 && /^[0-9a-f]{64}$/.test(archiveDigest)
        && typeof projectRef === "string" && projectRef.length === 20 && /^[a-z0-9]{20}$/.test(projectRef)) {
      // Exact reader arguments only: a requested metadata observation, not a
      // committed outcome, retry, resume, reimport or application authority.
      originalStatusRequest = Object.freeze({ restoreId, generation: originalGeneration, archiveDigest, targetProjectRef: projectRef });
    }
  }
  const originalStatusHandoff = originalStatusRequest
    ? { original_status_request: originalStatusRequest, metadata_only: true,
      retry_allowed: false, resume_allowed: false, rerun_import_allowed: false }
    : code === "RESTORE_RETRY_RECONCILIATION_REQUIRED"
      ? { original_status_request_missing_prerequisites: requestedOriginalRestore
        ? ["archiveDigest", "targetProjectRef"] : ["restoreId", "generation", "archiveDigest", "targetProjectRef"],
        metadata_only: true, retry_allowed: false, resume_allowed: false, rerun_import_allowed: false }
      : {};
  const uncertainty = outcomeUnknown
    ? {
      outcome: "UNKNOWN", retry_safe: false,
      ...(code === null ? {} : { code }),
      ...(currentImport ? { restore_id: restoreId, authority_generation: generation,
        archive_digest: archiveDigest, target_project_ref: projectRef } : {}),
      ...(requestedOriginalRestore ? { requested_original_restore: requestedOriginalRestore } : {}),
      ...originalStatusHandoff,
    } : {};
  const failureOutput = { ok: false, restore_phase: restorePhase, restore_table: restoreTable, restore_error: freshPrivateDatabase
    ? "Fresh restore remains paused; retain the original operation for reconciliation, never a blind retry."
    : outcomeUnknown
    ? "Original restore outcome is unknown; retain the original restore identity for named reconciliation, not a retry."
    : error instanceof Error ? error.message : String(error), ...uncertainty,
    ...(freshPrivateDatabase ? {database_only:true,complete_restore:false,
      retry_allowed:false,rerun_import_allowed:false,resume_allowed:false} : {}) };
  if (freshPrivateDatabase) {
    delete failureOutput.original_status_request;
    delete failureOutput.authority_status_request;
    Object.assign(failureOutput, freshRecordedFailureHandoff());
  }
  if (freshPrivateDatabase && freshDatabaseCommitAcknowledged) {
    // Decisions come from this invocation's recorded native outcomes, not a
    // stage-name substring or a thrown assertion/status/lookup object.
    if (freshDataReadbackDisposition) failureOutput.data_readback_disposition = freshDataReadbackDisposition;
    // Early reader refusal keeps only closed DATA disposition, never row values,
    // exception text, retry authority or a fabricated successful later reader.
    if (!freshDataReadbackDisposition && error && typeof error === "object" && !types.isProxy(error)) {
      const field = Object.getOwnPropertyDescriptor(error, "data_readback_disposition");
      const value = field && Object.hasOwn(field, "value") ? field.value : null;
      if (value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype) {
        const fields = Object.getOwnPropertyDescriptors(value);
        const keys = ["private_state", "ordinary_state", "storage_status", "unresolved_table_ids"];
        if (Reflect.ownKeys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields, key) && Object.hasOwn(fields[key], "value"))) {
          const privateState = fields.private_state.value, ordinaryState = fields.ordinary_state.value;
          const storageStatus = fields.storage_status.value, ids = fields.unresolved_table_ids.value;
          const states = ["NOT_RUN", "MATCH", "DIFFERENT", "UNSUPPORTED"];
          if (states.includes(privateState) && [...states, "CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK", "SOURCE_TRANSFORMATION_VERIFIED"].includes(ordinaryState)
              && [...states, "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS"].includes(storageStatus)
              && Array.isArray(ids) && !types.isProxy(ids) && Object.getPrototypeOf(ids) === Array.prototype && ids.length <= 4096) {
            const items = Object.getOwnPropertyDescriptors(ids);
            const safeIds = [];
            if (Reflect.ownKeys(items).length === ids.length + 1) {
              for (let index = 0; index < ids.length; index++) {
                const item = items[String(index)];
                if (!item || !Object.hasOwn(item, "value") || typeof item.value !== "string"
                    || !/^(?:public|auth|storage|custodial_release_identity|custodial_employment|custodial_coverall|custodial_leadership_private)\.[a-z_][a-z0-9_]{0,62}$/.test(item.value)) break;
                safeIds.push(item.value);
              }
              if (safeIds.length === ids.length) failureOutput.data_readback_disposition = {
                private_state: privateState, ordinary_state: ordinaryState, storage_status: storageStatus, unresolved_table_ids: safeIds,
              };
            }
          }
        }
      }
    }
    // Retain only closed diagnostic vocabulary, never private SQL/rows or
    // a caller's arbitrary assertion message in the structured outcome.
    if (error && typeof error === "object") {
      for (const [key, allowed] of [
        ["authority_refusal", ["Original authority mutation witness differs", "Original authority attempt unavailable or consumed",
          "Original authority owner transaction unavailable", "Original authority fixed target unavailable",
          "Original authority reviewed application guard unavailable", "Original authority fixed columns unavailable",
          "Original authority ancestry is ambiguous", "Original authority committed ancestry differs",
          "Original authority sealed Source differs", "Original authority Source inventory differs",
          "Original authority private originals differ", "Original authority DATABASE evidence differs",
          "Original authority expired during validation", "Original authority DATA selector unavailable",
          "Original authority DATA relation unavailable", "Original authority Source changed before DATA comparison",
          "Original authority current DATA differs", "Original authority Source changed after DATA comparison",
          "Original authority pre-effect context changed", "Original authority arm differs",
          "Original authority effect count differs", "Original authority post-effect context changed",
          "Original authority close-statement differs", "Original authority final context changed",
          "Original authority active statement differs",
          "Immutable import original global fence unavailable"]],
        ["read_phase", ["PRIVATE_ORIGINAL_ADMISSION", "SOURCE_CURRENTNESS", "INITIAL_CONTEXT", "PRIVATE_DATA", "ORDINARY_DATA", "STORAGE_DATA", "STORAGE_RESULT", "FINAL_CONTEXT", "RESULT"]],
        ["reader_check_phase", ["INPUT", "NATIVE_FENCE", "ORIGINAL_CONTEXT", "SOURCE_EPOCH", "CURRENT_CONTROL", "DATABASE_MARKERS", "FINAL_FENCE"]],
        ["storage_check_phase", ["INPUT", "NATIVE_PORT", "SOURCE", "CONTEXT", "CATALOG", "ORIGINAL_DATA", "COMPARE", "FINAL_CONTEXT", "RESULT"]],
        ["storage_context_check", ["TEXT_FIELDS", "READ_ONLY", "ISOLATION", "REPLICATION", "FIRST_SCHEMA", "FLOAT_DIGITS", "DATABASE_OID", "BACKEND_PID", "TRANSACTION_ID", "SNAPSHOT", "PRINCIPAL", "SAME_CONTEXT"]],
      ]) {
        const field = Object.getOwnPropertyDescriptor(error, key);
        if (field && Object.hasOwn(field, "value") && allowed.includes(field.value)) failureOutput[key] = field.value;
      }
      for (const key of ["sql_state", "code"]) {
        const field = Object.getOwnPropertyDescriptor(error, key);
        if (field && Object.hasOwn(field, "value") && typeof field.value === "string" && /^[0-9A-Z]{5}$/.test(field.value)) {
          failureOutput.sql_state = field.value; break;
        }
      }
    }
  }
  if (freshPrivateDatabase && error && typeof error === "object" && !types.isProxy(error)) {
    // A pre-DATABASE-COMMIT refusal needs the same bounded operator visibility
    // as later readback. Static labels and SQLSTATE only, never private detail.
    const refusal=Object.getOwnPropertyDescriptor(error,"import_refusal");
    if(refusal&&Object.hasOwn(refusal,"value")&&[
      "Immutable import original global fence unavailable","Immutable import Source inventory epoch unavailable",
      "Immutable import Source inventory context changed","Immutable import Source inventory original changed",
      "Immutable import original context changed","Immutable import full target catalog mismatch",
      "Immutable private guard kind unsupported","IMMUTABLE_MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED",
      "IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED","Immutable import current Source registry unavailable or stale",
    ].includes(refusal.value))failureOutput.import_refusal=refusal.value;
    const state=Object.getOwnPropertyDescriptor(error,"sql_state");
    if(state&&Object.hasOwn(state,"value")&&typeof state.value==='string'&&/^[0-9A-Z]{5}$/.test(state.value))
      failureOutput.sql_state=state.value;
  }
  if (freshPrivateDatabase) freshFailureOutput = failureOutput;
  else console.error(JSON.stringify(failureOutput));
  if (prepared && !outcomeUnknown) {
    await setControl("PAUSED_FAILURE", { paused: true, failureReason: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) }).catch(() => {});
    await recordEvent(restorePhase, "FAILED", { error: error instanceof Error ? error.message : String(error), ...uncertainty }).catch(() => {});
  }
  throw error;
}
} catch (error) {
  restoreLifecycleFailed = true;
  restoreLifecycleFailure = error;
} finally {
  if (restoreSessionLockHeld) {
    try {
      const released = await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))");
      if (released?.rowCount !== 1 || released?.rows?.[0]?.pg_advisory_unlock !== true) {
        throw new Error("Original restore session lock release was not confirmed.");
      }
      restoreSessionLockHeld = false;
    } catch (error) { restoreCleanupErrors.push(error); }
  }
  if (mutationFenceHeld) {
    try {
      const released = await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
      if (released?.rowCount !== 1 || released?.rows?.[0]?.pg_advisory_unlock !== true) {
        throw new Error("Original mutation session lock release was not confirmed.");
      }
      mutationFenceHeld = false;
    } catch (error) { restoreCleanupErrors.push(error); }
  }
  try { await Reflect.apply(endRestoreClient, db, []); }
  catch (error) { restoreCleanupErrors.push(error); }
}
function freshRecordedFailureHandoff() {
  const data = (value, keys) => {
    if (!value || typeof value !== "object" || types.isProxy(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== keys.length) return null;
    const copy = {};
    for (const key of keys) {
      const field = fields[key];
      if (!field || !Object.hasOwn(field,"value") || field.enumerable !== true) return null;
      copy[key] = field.value;
    }
    return copy;
  };
  const decimal = (value, limit = 9223372036854775807n) => typeof value === "string"
    && /^[1-9][0-9]{0,18}(?![\s\S])/.test(value) && BigInt(value) <= limit;
  const originalKeys = ["restoreId","generation","archiveDigest","targetProjectRef"];
  let original = data(freshOriginalRequest,originalKeys);
  const originalGeneration = typeof generation === "string" ? generation
    : Number.isSafeInteger(generation) && generation > 0 ? String(generation) : null;
  if (!original || typeof original.restoreId !== "string" || original.restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(original.restoreId)
      || !decimal(original.generation) || typeof original.archiveDigest !== "string" || original.archiveDigest.length !== 64
      || !/^[0-9a-f]{64}$/.test(original.archiveDigest) || typeof original.targetProjectRef !== "string"
      || original.targetProjectRef.length !== 20 || !/^[a-z0-9]{20}$/.test(original.targetProjectRef)
      || original.restoreId !== restoreId || original.generation !== originalGeneration
      || original.archiveDigest !== archiveDigest || original.targetProjectRef !== projectRef) original = null;
  const authorityKeys = [...originalKeys,"databaseOid","effectBackendPid","effectTransactionId","originalTransactionId"];
  let authority = data(freshAuthorityOriginalRequest,authorityKeys);
  if (!original || !authority || originalKeys.some(key => authority[key] !== original[key])
      || !decimal(authority.databaseOid,4294967295n) || !Number.isSafeInteger(authority.effectBackendPid)
      || authority.effectBackendPid < 1 || authority.effectBackendPid > 2147483647
      || !decimal(authority.effectTransactionId) || !decimal(authority.originalTransactionId)
      || authority.effectTransactionId === authority.originalTransactionId) authority = null;
  // These flags are recorded only by the original live caller. Lookup DATA,
  // error properties and cleanup failures cannot promote or demote a decision.
  const database = freshDatabaseCommitAcknowledged === true ? "ACKNOWLEDGED"
    : freshCommitNeedsObservation === true ? "UNKNOWN" : null;
  // No persistent DATABASE not-attempted decision is available in this error
  // scope. Absence of an observation flag is not nonexecution proof.
  const authorityStatus = freshAuthorityCommitAcknowledged === true ? "ACKNOWLEDGED"
    : freshAuthorityCommitNeedsObservation === true || freshAuthorityCommitInvoked === true ? "UNKNOWN" : "NOT_COMMITTED";
  // Fresh prepared becomes true ONLY after accepted post-authority DATA, the
  // private fence bridge, successful RO rollback and original Source check.
  // It is not a claim that cron/Storage/final reconciliation has succeeded.
  const verifiedBeforeContinuation = database === "ACKNOWLEDGED" && authorityStatus === "ACKNOWLEDGED" && prepared === true;
  const restoreError = verifiedBeforeContinuation
    ? "The original DATABASE and AUTHORITY COMMITs were acknowledged and original DATA was verified before continuation. A remaining restore stage or cleanup failed; retain the paused original for reconciliation, never resend effects or reimport."
    : database === "ACKNOWLEDGED" && authorityStatus === "ACKNOWLEDGED"
      ? "The original DATABASE and AUTHORITY COMMITs were acknowledged; subsequent verification or fence handoff remains unresolved. Retain the paused original for reconciliation, never resend effects or reimport."
      : database === "ACKNOWLEDGED"
        ? "The original DATABASE COMMIT was acknowledged; the separate authority workflow remains unresolved. Retain the paused original and use fixed status observation, never resend effects or reimport."
        : "The original DATABASE COMMIT is not acknowledged; retain the original operation for fixed status observation, never a blind retry.";
  return {
    ...(database === null ? {database_commit_status_unavailable:true} : {commit_status:database}),
    authority_commit_status:authorityStatus,
    ...(original && database !== null ? {original_status_request:Object.freeze(original)} : {}),
    ...(!original && database !== null ? {original_status_request_missing_prerequisites:originalKeys} : {}),
    ...(authority && (authorityStatus !== "NOT_COMMITTED" || freshAuthorityCommitInvoked === true)
      ? {authority_status_request:Object.freeze(authority)}
      : authorityStatus !== "NOT_COMMITTED" || freshAuthorityCommitInvoked === true
        ? {authority_status_request_missing_prerequisites:authorityKeys} : {}),
    readback_outcome:verifiedBeforeContinuation ? "VERIFIED_BEFORE_CONTINUATION_FAILURE" : "UNRESOLVED",
    ...(database === "ACKNOWLEDGED" ? {mutations_paused:true} : {}),
    metadata_only:true,complete_restore:false,resume_allowed:false,
    retry_allowed:false,rerun_import_allowed:false,retry_safe:false,restore_error:restoreError,
  };
}
// Retain bounded same-invocation recovery DATA for archive cleanup only.
// Never reconstruct decisions from the public success string or error claims.
if (freshPrivateDatabase) archiveFreshFailureOutput = {
  ok:false,database_only:true,restore_phase:"archive_cleanup",restore_table:null,...freshRecordedFailureHandoff(),
};
if (freshPrivateDatabase && !restoreLifecycleFailed && restoreCleanupErrors.length) {
  console.error(JSON.stringify({ok:false,database_only:true,restore_phase:"restore_cleanup",restore_table:null,
    ...freshRecordedFailureHandoff()}));
}
if (restoreLifecycleFailed) {
  if (freshPrivateDatabase && freshFailureOutput) {
    if (freshCommitNeedsObservation && restoreCleanupErrors.length === 0) {
      try { freshFailureOutput.original_commit_observation = await observeFreshOriginalCommit(); }
      catch (error) { restoreCleanupErrors.push(error); }
    }
    if (freshAuthorityCommitNeedsObservation && restoreCleanupErrors.length === 0) {
      try { freshFailureOutput.original_authority_commit_observation = await observeFreshOriginalAuthorityCommit(); }
      catch (error) { restoreCleanupErrors.push(error); }
    }
    console.error(JSON.stringify(freshFailureOutput));
  }
  if (restoreCleanupErrors.length) {
    throw new AggregateError([restoreLifecycleFailure, ...restoreCleanupErrors],
      "Production restore failed; lifecycle cleanup also failed.", { cause: restoreLifecycleFailure });
  }
  throw restoreLifecycleFailure;
}
if (restoreCleanupErrors.length === 1) throw restoreCleanupErrors[0];
if (restoreCleanupErrors.length > 1) {
  throw new AggregateError(restoreCleanupErrors, "Production restore lifecycle cleanup failed.",
    { cause: restoreCleanupErrors[0] });
}
return restoreSuccessOutput;
  })();
} catch (error) {
  archiveLifecycleFailed = true;
  archiveLifecycleFailure = error;
} finally {
  try { await Reflect.apply(cleanupVerifiedArchive, verifiedArchive, []); }
  catch (error) { archiveCleanupFailed = true; archiveCleanupFailure = error; }
}
if (archiveLifecycleFailed) {
  if (archiveCleanupFailed) {
    throw new AggregateError([archiveLifecycleFailure, archiveCleanupFailure],
      "Production restore failed; verified archive cleanup also failed.", { cause: archiveLifecycleFailure });
  }
  throw archiveLifecycleFailure;
}
if (archiveCleanupFailed && archiveFreshFailureOutput) console.error(JSON.stringify(archiveFreshFailureOutput));
if (archiveCleanupFailed) throw archiveCleanupFailure;
console.log(archiveSuccessOutput);
