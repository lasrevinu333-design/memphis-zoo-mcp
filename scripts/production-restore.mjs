#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, openAsBlob, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  requireSigningKey,
  restoreIntentBinding,
  stableJson,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";
import { materializeVerifiedArchive, restoreArchiveAdmission } from "./disaster-recovery-archive.mjs";
import {
  capturePreRestoreState,
  compareRestoredState,
  invalidateRestoredAuthority,
  preserveCurrentReleaseIdentity,
} from "./disaster-recovery-state.mjs";
import {
  compareStorageState,
  storageBucketOptions,
  storageObjectUploadOptions,
  validateV4StorageArchiveObjects,
} from "./disaster-recovery-storage.mjs";
import {
  compareCronJobs,
  readCronJobs,
  restoreCronJobs,
} from "./disaster-recovery-cron.mjs";

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
const sourceDir = verifiedArchive.directory;
const { summary, archiveDigest, checksumPaths } = verifiedArchive;
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
  archivedCronJobs = cronJobs;
}
for (const object of objects) {
  const path = verifiedArchivePath(object.file, `Storage object ${object.id}`);
  if (statSync(path).size !== Number(object.size_bytes) || await sha256File(path) !== object.sha256) {
    throw new Error(`Storage object archive verification failed for ${object.id}.`);
  }
}
for (const table of catalog) verifiedArchivePath(table.data_file, `Database table ${table.schema_name}.${table.table_name}`);

if (!apply) {
  console.log(JSON.stringify({
    ok: true,
    dry_run: true,
    archive_verified: true,
    archive_signature_verified: true,
    archive_digest: archiveDigest,
    restore_compatible: archiveAdmission.restore_compatible,
    historical_verification_only: archiveAdmission.historical_verification_only,
    project_ref_in_archive: summary.project_ref,
    source_identity: summary.source_identity,
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
if (projectRef !== summary.project_ref) throw new Error("The signed archive project does not equal the confirmed restore target.");
if (!databaseOnly && !secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for a production restore apply.");

const intentVerifyKey = requireSigningKey(process.env.RESTORE_INTENT_VERIFY_KEY, "RESTORE_INTENT_VERIFY_KEY");
if (intentVerifyKey === archiveVerifyKey) throw new Error("Archive and restore-intent verification keys must be independent.");
const intentVerifyKeyId = String(process.env.RESTORE_INTENT_VERIFY_KEY_ID || "").trim();
const intentEnvelope = JSON.parse(String(process.env.RESTORE_INTENT_JSON || "null"));
if (!intentEnvelope || typeof intentEnvelope !== "object" || intentEnvelope.format !== "memphis-zoo-production-restore-intent.v1") {
  throw new Error("A signed production restore intent is required.");
}
if (intentEnvelope.key_id !== intentVerifyKeyId || !verifyBinding(restoreIntentBinding(intentEnvelope.intent), intentEnvelope.signature, intentVerifyKey)) {
  throw new Error("Production restore intent signature verification failed.");
}
const intent = intentEnvelope.intent || {};
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
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
  throw new Error("Restore intent is expired or exceeds the 24-hour authorization window.");
}

if (catalog.some((table) => table.schema_name === "custodial_dr")) throw new Error("The non-restored control schema must not appear in the archive.");
const databaseTables = catalog.filter((table) => ["public", "auth", ...(databaseOnly ? ["storage"] : [])].includes(table.schema_name));
const restoreId = String(intent.restore_id).toLowerCase();
const generation = Number(intent.authority_generation);
const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-disaster-restore",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
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
    where status in ('deployed','validated','candidate')
    order by (status='deployed') desc,deployed_at desc nulls last,created_at desc limit 1
  `);
  return {
    migration_head: String(migration.rows[0]?.migration_head || ""),
    release_identity: release.rows[0] || null,
  };
}

function assertIntentTargetIdentity(target) {
  if (intent.target_migration_head !== target.migration_head
      || stableJson(intent.target_release_identity || null) !== stableJson(target.release_identity)) {
    throw new Error("The target migration or release identity changed after restore intent approval.");
  }
}

await db.connect();
await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
try {
  restorePhase = "preflight";
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
    const retryLeases = await db.query("select count(*)::int count from custodial_dr.application_mutation_leases");
    if (Number(retryLeases.rows[0].count) !== 0) throw new Error("A PAUSED_FAILURE retry requires every application mutation lease to be settled or reconciled.");
  }
  const preflightTargetIdentity = await readTargetIdentity();
  assertIntentTargetIdentity(preflightTargetIdentity);
  if (databaseOnly && /^(1|true|yes)$/i.test(String(process.env.RESTORE_DRILL_PREFLIGHT_BARRIER || ""))) {
    await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
    await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-restore-drill-preflight-barrier',0))");
  }

  restorePhase = "pause_admission";
  await db.query("begin");
  try {
    // Close HTTP/API admission atomically. Existing request leases are allowed
    // to finish; later admissions wait on this lock and then observe pause.
    await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
    await db.query(`
      update custodial_dr.restore_control set
        authority_generation=$1,mutations_paused=true,state='PREPARING',restore_id=$2,
        archive_digest=$3,source_project_ref=$4,target_project_ref=$5,
        release_identity=$6::jsonb,started_by=$7,started_at=clock_timestamp(),
        completed_at=null,failure_reason=null,updated_at=clock_timestamp()
      where singleton=true
    `, [generation, restoreId, archiveDigest, summary.project_ref, projectRef, JSON.stringify({ archive: summary.source_identity.release, target: preflightTargetIdentity.release_identity, retry_of_restore_id: intent.retry_of_restore_id }), intent.actor]);
    await db.query(`
      insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest)
      values ($1,$2,$3)
    `, [restoreId, generation, archiveDigest]);
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
  await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
  mutationFenceHeld = true;

  restorePhase = "quiescent_target_identity";
  const quiescentTargetIdentity = await readTargetIdentity();
  assertIntentTargetIdentity(quiescentTargetIdentity);

  restorePhase = "quiescent_snapshot";
  await db.query("begin");
  try {
    // The session-level exclusive fence remains held through database, cron,
    // Storage, and final verification. DDL and direct writers either drained
    // before this point or observe the paused generation after release.
    const snapshotEvidence = await capturePreRestoreState(db, { restoreId, generation });
    await recordEvent("PREPARE", "PASSED", {
      target_migration_head: quiescentTargetIdentity.migration_head,
      drained_application_mutation_leases: activeLeaseCount,
      expired_application_mutation_lease_blockers: expiredLeaseCount,
      target_identity_revalidated_under_global_fence: true,
      snapshots: snapshotEvidence,
    });
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }

  restorePhase = "restore_database";
  await db.query("begin");
  try {
    await db.query("set local session_replication_role = replica");
    if (databaseTables.length) {
      restorePhase = "truncate_target_tables";
      await db.query(`truncate ${databaseTables.map((table) => qualified(table.schema_name, table.table_name)).join(",")} restart identity cascade`);
    }
    for (const table of databaseTables) {
      restoreTable = `${table.schema_name}.${table.table_name}`;
      restorePhase = "restore_table";
      const target = qualified(table.schema_name, table.table_name);
      const columns = table.columns.filter((column) => !column.generated).map((column) => column.name);
      const projection = columns.map((column) => `r.${quoteIdentifier(column)}`).join(",");
      const insert = `insert into ${target} (${columns.map(quoteIdentifier).join(",")}) overriding system value select ${projection} from json_populate_record(null::${target},$1::json) r`;
      const input = createInterface({ input: createReadStream(verifiedArchivePath(table.data_file, `Database table ${restoreTable}`)), crlfDelay: Infinity });
      let restored = 0;
      for await (const line of input) {
        if (!line) continue;
        await db.query(insert, [line]);
        restored += 1;
      }
      if (restored !== Number(table.row_count)) throw new Error(`Row-count mismatch while restoring ${restoreTable}.`);
    }
    restoreTable = null;
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }
  await setControl("DATABASE_RESTORED");
  await db.query(`update custodial_dr.restore_manifests set database_verified=true,database_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify({ tables: databaseTables.length, rows: databaseTables.reduce((total, table) => total + Number(table.row_count), 0) })]);
  await recordEvent("DATABASE", "PASSED", { tables: databaseTables.length });

  restorePhase = "authority_reconciliation";
  await db.query("begin");
  let discrepancies;
  let invalidated;
  try {
    await db.query("set local session_replication_role = replica");
    discrepancies = await compareRestoredState(db, { restoreId, generation });
    const preservedReleaseRows = await preserveCurrentReleaseIdentity(db, { restoreId });
    invalidated = await invalidateRestoredAuthority(db, { generation });
    await db.query(`update custodial_dr.restore_manifests set authority_invalidated=true,authority_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify({ invalidated, preserved_release_rows: preservedReleaseRows, discrepancies })]);
    await recordEvent("AUTHORITY_RECONCILIATION", "PASSED", { invalidated, preserved_release_rows: preservedReleaseRows, discrepancies });
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  }

  let cronEvidence = null;
  if (summary.format === "memphis-zoo-disaster-recovery.v4") {
    restorePhase = "restore_cron";
    await db.query("begin");
    try {
      cronEvidence = await restoreCronJobs(db, archivedCronJobs, {
        sourceDatabase: String(summary.database_snapshot?.database_name || "") || null,
      });
      await db.query("commit");
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
    if (cronEvidence.differences.length) {
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'cron_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, cronEvidence.before.length, cronEvidence.actual.length, JSON.stringify(cronEvidence)]);
    }
    await recordEvent("CRON", cronEvidence.differences.length ? "HELD" : "PASSED", {
      before_count: cronEvidence.before.length,
      restored_count: cronEvidence.actual.length,
      differences: cronEvidence.differences,
    });
  }

  restorePhase = "restore_storage";
  await setControl("STORAGE_RESTORING");
  let storageEvidence;
  let productionSupabase = null;
  if (databaseOnly && String(process.env.RESTORE_DRILL_FORCE_STORAGE_FAILURE || "").toLowerCase() === "true") {
    throw new Error("Isolated restore drill forced a Storage restoration failure.");
  }
  if (databaseOnly) {
    const restoredBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    const restoredObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    const storageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: restoredBuckets.rows.map((item) => item.row),
      actualObjects: restoredObjects.rows.map((item) => item.row),
    }).filter((item) => item.field !== "owner_access_boundary");
    if (storageDifferences.length) throw new Error(`Isolated database Storage metadata restore differed in ${storageDifferences.length} field(s).`);
    storageEvidence = { database_only_metadata_verified: true, archived_buckets: buckets.length, archived_objects: objects.length };
  } else {
    const supabase = createClient(`https://${projectRef}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    productionSupabase = supabase;
    const targetBucketsBefore = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    const targetObjectsBefore = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    for (const bucket of buckets) {
      const options = storageBucketOptions(bucket);
      const created = await supabase.storage.createBucket(bucket.id, options);
      if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw created.error;
      if (created.error) {
        const updated = await supabase.storage.updateBucket(bucket.id, options);
        if (updated.error) throw updated.error;
      }
    }
    for (const object of objects) {
      const uploadOptions = storageObjectUploadOptions(object);
      const body = await openAsBlob(verifiedArchivePath(object.file, `Storage object ${object.id}`), { type: uploadOptions.contentType });
      const uploaded = await supabase.storage.from(object.bucket_id).upload(object.name, body, uploadOptions);
      if (uploaded.error) throw uploaded.error;
      const downloaded = await supabase.storage.from(object.bucket_id).download(object.name);
      if (downloaded.error || !downloaded.data) throw downloaded.error || new Error(`Storage verification failed for ${object.id}.`);
      const actual = sha256Bytes(Buffer.from(await downloaded.data.arrayBuffer()));
      if (actual !== object.sha256) throw new Error(`Restored Storage object digest mismatch for ${object.id}.`);
    }
    const actualBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    const actualObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    const storageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: actualBuckets.rows.map((item) => item.row),
      actualObjects: actualObjects.rows.map((item) => item.row),
    });
    storageEvidence = {
      buckets: buckets.length,
      verified_object_bytes: objects.length,
      archived_bytes: objects.reduce((total, item) => total + Number(item.size_bytes), 0),
      target_buckets_before: targetBucketsBefore.rowCount,
      target_objects_before: targetObjectsBefore.rowCount,
      metadata_and_ownership_verified: storageDifferences.length === 0,
      discrepancies: storageDifferences,
    };
    if (storageDifferences.length) {
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'storage_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, objects.length, actualObjects.rowCount, JSON.stringify(storageEvidence)]);
    }
  }
  const storageVerified = databaseOnly || storageEvidence.metadata_and_ownership_verified === true;
  await db.query(`update custodial_dr.restore_manifests set storage_verified=$2,storage_evidence=$3::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, storageVerified, JSON.stringify(storageEvidence)]);
  await recordEvent("STORAGE", storageVerified ? "PASSED" : "HELD", storageEvidence);

  restorePhase = "post_restore_verification";
  await setControl("VERIFYING");

  if (!databaseOnly) {
    const finalBuckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
    const finalObjects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
    const finalStorageDifferences = compareStorageState({
      archivedBuckets: buckets,
      archivedObjects: objects,
      actualBuckets: finalBuckets.rows.map((item) => item.row),
      actualObjects: finalObjects.rows.map((item) => item.row),
    });
    storageEvidence.final_quiescent_resample = {
      buckets: finalBuckets.rowCount,
      objects: finalObjects.rowCount,
      differences: finalStorageDifferences,
      application_mutation_fence_held: mutationFenceHeld,
      storage_api_client_initialized: Boolean(productionSupabase),
    };
    if (finalStorageDifferences.length) {
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'storage_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, objects.length, finalObjects.rowCount, JSON.stringify(storageEvidence)]);
      await db.query("update custodial_dr.restore_manifests set storage_verified=false,storage_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1", [restoreId, JSON.stringify(storageEvidence)]);
    }
  }
  if (cronEvidence) {
    const finalCronJobs = await readCronJobs(db);
    const finalCronDifferences = compareCronJobs(cronEvidence.expected, finalCronJobs);
    cronEvidence.final_quiescent_resample = { jobs: finalCronJobs.length, differences: finalCronDifferences };
    if (finalCronDifferences.length) {
      await db.query(`
        insert into custodial_dr.restore_discrepancies(
          restore_id,authority_generation,category,status,before_count,restored_count,details_json
        ) values ($1,$2,'cron_state','OPEN',$3,$4,$5::jsonb)
        on conflict (restore_id,category) do update set
          status='OPEN',before_count=excluded.before_count,restored_count=excluded.restored_count,
          details_json=excluded.details_json,resolved_by=null,resolved_at=null,resolution=null
      `, [restoreId, generation, cronEvidence.expected.length, finalCronJobs.length, JSON.stringify(cronEvidence)]);
    }
  }
  const unresolved = await db.query("select count(*)::int count from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN'", [restoreId]);
  const unresolvedCount = Number(unresolved.rows[0].count);
  const resumeEligible = unresolvedCount === 0;
  const finalManifest = {
    restore_id: restoreId,
    authority_generation: generation,
    archive_digest: archiveDigest,
    source_identity: summary.source_identity,
    database_tables: databaseTables.length,
    database_rows: databaseTables.reduce((total, table) => total + Number(table.row_count), 0),
    storage: storageEvidence,
    cron: cronEvidence,
    authority_invalidated: invalidated,
    unresolved_discrepancies: unresolvedCount,
    resume_eligible: resumeEligible,
  };
  const finalManifestSha256 = sha256Bytes(stableJson(finalManifest));
  await db.query(`update custodial_dr.restore_manifests set post_restore_verified=true,final_manifest_sha256=$2,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, finalManifestSha256]);
  // A destructive restore never reopens admission itself. A separately signed
  // reconciliation binds this final manifest and resolves the exact discrepancy
  // set after the restore releases its global fence. A crash at any point leaves
  // mutations paused.
  await setControl("PAUSED_RECONCILIATION", { paused: true, completed: true });
  await recordEvent("FINAL", "HELD", {
    resumed: false,
    resume_eligible: resumeEligible,
    unresolved_discrepancies: unresolvedCount,
    separate_signed_reconciliation_required: true,
  });
  console.log(JSON.stringify({
    ok: true,
    restore_id: restoreId,
    authority_generation: generation,
    restored_project_ref: projectRef,
    database_only: databaseOnly,
    database_tables: databaseTables.length,
    database_rows: databaseTables.reduce((total, table) => total + Number(table.row_count), 0),
    storage: storageEvidence,
    authority_invalidated: invalidated,
    final_manifest_sha256: finalManifestSha256,
    unresolved_discrepancies: unresolvedCount,
    mutations_paused: true,
    resume_eligible: resumeEligible,
    state: "PAUSED_RECONCILIATION",
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, restore_phase: restorePhase, restore_table: restoreTable, restore_error: error instanceof Error ? error.message : String(error) }));
  if (prepared) {
    await setControl("PAUSED_FAILURE", { paused: true, failureReason: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) }).catch(() => {});
    await recordEvent(restorePhase, "FAILED", { error: error instanceof Error ? error.message : String(error) }).catch(() => {});
  }
  throw error;
} finally {
  await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))").catch(() => {});
  if (mutationFenceHeld) await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-application-mutation-fence',0))").catch(() => {});
  await db.end().catch(() => {});
}
