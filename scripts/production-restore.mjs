#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, openAsBlob, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  archiveSignatureBinding,
  requireSigningKey,
  restoreIntentBinding,
  stableJson,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";
import {
  capturePreRestoreState,
  compareRestoredState,
  invalidateRestoredAuthority,
  preserveCurrentReleaseIdentity,
} from "./disaster-recovery-state.mjs";

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
const archiveVerifyKey = requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY, "RESTORE_ARCHIVE_VERIFY_KEY");
const archiveVerifyKeyId = String(process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID || "").trim();

if (!sourceDir) throw new Error("RESTORE_SOURCE_DIR is required.");

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

const summary = JSON.parse(readFileSync(join(sourceDir, "backup-summary.json"), "utf8"));
if (summary.format !== "memphis-zoo-disaster-recovery.v3" || summary.ok !== true || summary.consistent_database_snapshot !== true) {
  throw new Error("Backup is not a signed Memphis Zoo disaster-recovery v3 archive.");
}
if (!/^[a-z0-9]{20}$/.test(String(summary.project_ref || ""))) throw new Error("Archive project identity is invalid.");
if (!summary.source_identity || typeof summary.source_identity !== "object") throw new Error("Archive source identity is missing.");

const checksumBytes = readFileSync(join(sourceDir, "SHA256SUMS"));
const checksums = checksumBytes.toString("utf8").trim().split("\n").filter(Boolean);
for (const line of checksums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error("Malformed SHA256SUMS entry.");
  const path = resolve(sourceDir, match[2]);
  if (!path.startsWith(`${sourceDir}/`)) throw new Error("Checksum path escapes the restore source.");
  if (await sha256File(path) !== match[1]) throw new Error(`Checksum mismatch for ${match[2]}.`);
}
const archiveDigest = sha256Bytes(checksumBytes);
const archiveSignature = JSON.parse(readFileSync(join(sourceDir, "archive-signature.json"), "utf8"));
if (archiveSignature.format !== "memphis-zoo-disaster-recovery-signature.v1"
    || archiveSignature.algorithm !== "hmac-sha256"
    || archiveSignature.key_id !== archiveVerifyKeyId
    || archiveSignature.archive_digest !== archiveDigest
    || !verifyBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
    }), archiveSignature.signature, archiveVerifyKey)) {
  throw new Error("Archive signature verification failed.");
}

const catalog = JSON.parse(readFileSync(join(sourceDir, "inventory", "table-catalog.json"), "utf8"));
const buckets = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-buckets.json"), "utf8"));
const objects = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-objects.json"), "utf8"));
const catalogDigest = await sha256File(join(sourceDir, "inventory", "table-catalog.json"));
if (catalogDigest !== summary.source_identity.database_catalog_sha256) throw new Error("Database catalog identity does not match the signed archive.");
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
    archive_signature_verified: true,
    archive_digest: archiveDigest,
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
const databaseTables = catalog.filter((table) => ["public", "auth"].includes(table.schema_name));
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

await db.connect();
await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
try {
  restorePhase = "preflight";
  const control = await db.query("select * from custodial_dr.restore_control where singleton=true for update");
  if (control.rowCount !== 1) throw new Error("The non-restored disaster-recovery control plane is unavailable.");
  if (control.rows[0].mutations_paused) throw new Error("Another restore or reconciliation already holds the mutation pause.");
  if (generation !== Number(control.rows[0].authority_generation) + 1) throw new Error("Restore intent generation is not the next non-restored authority generation.");
  const targetMigration = await db.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
  const targetMigrationHead = String(targetMigration.rows[0]?.migration_head || "");
  const targetRelease = await db.query(`
    select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256
    from public.release_deployment_manifest
    where status in ('deployed','validated','candidate')
    order by (status='deployed') desc,deployed_at desc nulls last,created_at desc limit 1
  `);
  const targetReleaseIdentity = targetRelease.rows[0] || null;
  if (intent.target_migration_head !== targetMigrationHead
      || stableJson(intent.target_release_identity || null) !== stableJson(targetReleaseIdentity)) {
    throw new Error("The target migration or release identity changed after restore intent approval.");
  }

  restorePhase = "pause_and_snapshot";
  await db.query("begin");
  try {
    await db.query(`
      update custodial_dr.restore_control set
        authority_generation=$1,mutations_paused=true,state='PREPARING',restore_id=$2,
        archive_digest=$3,source_project_ref=$4,target_project_ref=$5,
        release_identity=$6::jsonb,started_by=$7,started_at=clock_timestamp(),
        completed_at=null,failure_reason=null,updated_at=clock_timestamp()
      where singleton=true
    `, [generation, restoreId, archiveDigest, summary.project_ref, projectRef, JSON.stringify({ archive: summary.source_identity.release, target: targetReleaseIdentity }), intent.actor]);
    await db.query(`
      insert into custodial_dr.restore_manifests(restore_id,authority_generation,archive_digest)
      values ($1,$2,$3)
    `, [restoreId, generation, archiveDigest]);
    const snapshotEvidence = await capturePreRestoreState(db, { restoreId, generation });
    await recordEvent("PREPARE", "PASSED", { target_migration_head: targetMigrationHead, snapshots: snapshotEvidence });
    await db.query("commit");
    prepared = true;
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
      const input = createInterface({ input: createReadStream(join(sourceDir, table.data_file)), crlfDelay: Infinity });
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

  restorePhase = "restore_storage";
  await setControl("STORAGE_RESTORING");
  let storageEvidence;
  if (databaseOnly && String(process.env.RESTORE_DRILL_FORCE_STORAGE_FAILURE || "").toLowerCase() === "true") {
    throw new Error("Isolated restore drill forced a Storage restoration failure.");
  }
  if (databaseOnly) {
    storageEvidence = { skipped_for_isolated_database_drill: true, archived_objects: objects.length };
  } else {
    const supabase = createClient(`https://${projectRef}.supabase.co`, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const bucket of buckets) {
      const options = { public: Boolean(bucket.public), fileSizeLimit: bucket.file_size_limit == null ? undefined : Number(bucket.file_size_limit), allowedMimeTypes: bucket.allowed_mime_types || undefined };
      const created = await supabase.storage.createBucket(bucket.id, options);
      if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw created.error;
      if (created.error) {
        const updated = await supabase.storage.updateBucket(bucket.id, options);
        if (updated.error) throw updated.error;
      }
    }
    for (const object of objects) {
      const body = await openAsBlob(join(sourceDir, object.file), { type: object.metadata?.mimetype || "application/octet-stream" });
      const uploaded = await supabase.storage.from(object.bucket_id).upload(object.name, body, { upsert: true, contentType: object.metadata?.mimetype || "application/octet-stream", cacheControl: object.metadata?.cacheControl || "0" });
      if (uploaded.error) throw uploaded.error;
      const downloaded = await supabase.storage.from(object.bucket_id).download(object.name);
      if (downloaded.error || !downloaded.data) throw downloaded.error || new Error(`Storage verification failed for ${object.id}.`);
      const actual = sha256Bytes(Buffer.from(await downloaded.data.arrayBuffer()));
      if (actual !== object.sha256) throw new Error(`Restored Storage object digest mismatch for ${object.id}.`);
    }
    storageEvidence = { buckets: buckets.length, verified_objects: objects.length, archived_bytes: objects.reduce((total, item) => total + Number(item.size_bytes), 0) };
  }
  await db.query(`update custodial_dr.restore_manifests set storage_verified=true,storage_evidence=$2::jsonb,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, JSON.stringify(storageEvidence)]);
  await recordEvent("STORAGE", "PASSED", storageEvidence);

  restorePhase = "post_restore_verification";
  await setControl("VERIFYING");
  const unresolved = await db.query("select count(*)::int count from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN'", [restoreId]);
  const unresolvedCount = Number(unresolved.rows[0].count);
  const resume = intent.resume_after_verification === true && unresolvedCount === 0;
  const finalManifest = {
    restore_id: restoreId,
    authority_generation: generation,
    archive_digest: archiveDigest,
    source_identity: summary.source_identity,
    database_tables: databaseTables.length,
    database_rows: databaseTables.reduce((total, table) => total + Number(table.row_count), 0),
    storage: storageEvidence,
    authority_invalidated: invalidated,
    unresolved_discrepancies: unresolvedCount,
    resume_eligible: resume,
  };
  const finalManifestSha256 = sha256Bytes(stableJson(finalManifest));
  await db.query(`update custodial_dr.restore_manifests set post_restore_verified=true,final_manifest_sha256=$2,updated_at=clock_timestamp() where restore_id=$1`, [restoreId, finalManifestSha256]);
  if (resume) {
    await setControl("COMPLETE", { paused: false, completed: true });
    await recordEvent("FINAL", "PASSED", { resumed: true, unresolved_discrepancies: 0 });
  } else {
    await setControl("PAUSED_RECONCILIATION", { paused: true, completed: true });
    await recordEvent("FINAL", "HELD", { resumed: false, unresolved_discrepancies: unresolvedCount, explicit_resume_requested: intent.resume_after_verification === true });
  }
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
    mutations_paused: !resume,
    state: resume ? "COMPLETE" : "PAUSED_RECONCILIATION",
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
  await db.end().catch(() => {});
}
