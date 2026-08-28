#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  requireSigningKey,
  restoreReconciliationBinding,
  stableJson,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";
import { captureStorageSupportedState, validateStorageOperatorEvidence } from "./disaster-recovery-storage.mjs";

const { Client } = pg;
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const confirmedRef = String(process.env.RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF || "").trim();
const apply = String(process.env.RESTORE_RECONCILIATION_APPLY || "false").toLowerCase() === "true";
const key = requireSigningKey(process.env.RESTORE_RECONCILIATION_VERIFY_KEY, "RESTORE_RECONCILIATION_VERIFY_KEY");
const keyId = String(process.env.RESTORE_RECONCILIATION_VERIFY_KEY_ID || "").trim();
const envelope = JSON.parse(String(process.env.RESTORE_RECONCILIATION_JSON || "null"));
const storageSecret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const testStorageBytes = String(process.env.RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON || "").trim();

if (!apply) throw new Error("RESTORE_RECONCILIATION_APPLY=true is required.");
if (!databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef) || confirmedRef !== projectRef) {
  throw new Error("SUPABASE_DB_URL, SUPABASE_PROJECT_REF, and exact RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF are required.");
}
if (!envelope || envelope.format !== "memphis-zoo-production-restore-reconciliation.v1"
    || envelope.algorithm !== "hmac-sha256" || envelope.key_id !== keyId
    || !verifyBinding(restoreReconciliationBinding(envelope.intent || {}), envelope.signature, key)) {
  throw new Error("Production restore reconciliation signature verification failed.");
}
const intent = envelope.intent || {};
if (!/^[0-9a-f-]{36}$/i.test(String(intent.reconciliation_id || ""))
    || !/^[0-9a-f-]{36}$/i.test(String(intent.restore_id || ""))
    || !Number.isSafeInteger(intent.authority_generation)
    || !/^[0-9a-f]{64}$/.test(String(intent.archive_digest || ""))
    || !/^[0-9a-f]{64}$/.test(String(intent.final_manifest_sha256 || ""))
    || !/^[0-9a-f]{64}$/.test(String(intent.discrepancy_snapshot_sha256 || ""))
    || intent.target_project_ref !== projectRef || !String(intent.actor || "").trim()
    || !Array.isArray(intent.resolutions)) {
  throw new Error("Production restore reconciliation identity is invalid.");
}
const expiresAt = Date.parse(String(intent.expires_at || ""));
if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 24 * 60 * 60 * 1000) {
  throw new Error("Production restore reconciliation is expired or exceeds the 24-hour authorization window.");
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function discrepancySnapshot(rows) {
  return rows.map((row) => ({
    category: row.category,
    status: row.status,
    before_sha256: row.before_sha256,
    restored_sha256: row.restored_sha256,
    before_count: row.before_count === null ? null : String(row.before_count),
    restored_count: row.restored_count === null ? null : String(row.restored_count),
    details_sha256: sha256(stableJson(row.details_json || {})),
  }));
}
function makeStorageDownloader() {
  const target = new URL(databaseUrl);
  const allowFixture = /^(127\.0\.0\.1|localhost)$/.test(target.hostname)
    && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname) && testStorageBytes;
  if (allowFixture) {
    const fixture = JSON.parse(testStorageBytes);
    return async (bucketId, name) => {
      const encoded = fixture[`${bucketId}\0${name}`];
      if (typeof encoded !== "string") throw new Error(`No isolated Storage-byte fixture exists for ${bucketId}/${name}.`);
      return Buffer.from(encoded, "base64");
    };
  }
  if (!storageSecret) throw new Error("SUPABASE_SECRET or SUPABASE_SERVICE_ROLE_KEY is required to resample current Storage object bytes.");
  const supabase = createClient(`https://${projectRef}.supabase.co`, storageSecret, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (bucketId, name) => {
    const result = await supabase.storage.from(bucketId).download(name);
    if (result.error || !result.data) throw result.error || new Error(`Storage object-byte resample failed for ${bucketId}/${name}.`);
    return Buffer.from(await result.data.arrayBuffer());
  };
}
const intentDigest = sha256(stableJson(restoreReconciliationBinding(intent)));
const target = new URL(databaseUrl);
const allowCrashProbe = /^(127\.0\.0\.1|localhost)$/.test(target.hostname)
  && /^\/mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(target.pathname);
const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-apply-restore-reconciliation",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
await db.connect();
await db.query("select pg_advisory_lock(hashtextextended('memphis-zoo-production-restore',0))");
try {
  await db.query("begin isolation level serializable");
  await db.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-admission',0))");
  const controlResult = await db.query("select * from custodial_dr.restore_control where singleton=true for update");
  const control = controlResult.rows[0];
  if (control?.state === "COMPLETE" && control.mutations_paused === false) {
    const prior = await db.query(`
      select 1 from custodial_dr.restore_events
      where restore_id=$1 and authority_generation=$2 and phase='PRODUCTION_RECONCILIATION'
        and outcome='RESOLVED' and evidence_json->>'reconciliation_id'=$3
        and evidence_json->>'intent_sha256'=$4
    `, [intent.restore_id, intent.authority_generation, intent.reconciliation_id, intentDigest]);
    if (prior.rowCount !== 1) throw new Error("Production is already resumed by a different reconciliation authority.");
    await db.query("commit");
    console.log(JSON.stringify({ ok: true, idempotent_replay: true, restore_id: intent.restore_id, reconciliation_id: intent.reconciliation_id }));
    process.exit(0);
  }
  if (!control || control.state !== "PAUSED_RECONCILIATION" || control.mutations_paused !== true
      || String(control.restore_id) !== intent.restore_id
      || Number(control.authority_generation) !== intent.authority_generation
      || control.archive_digest !== intent.archive_digest
      || control.target_project_ref !== projectRef) {
    throw new Error("Paused restore control does not match the signed reconciliation.");
  }
  const manifestResult = await db.query("select * from custodial_dr.restore_manifests where restore_id=$1 for update", [intent.restore_id]);
  const manifest = manifestResult.rows[0];
  if (!manifest || manifest.database_verified !== true
      || manifest.authority_invalidated !== true || manifest.post_restore_verified !== true
      || manifest.final_manifest_sha256 !== intent.final_manifest_sha256) {
    throw new Error("Final restore manifest does not match the signed reconciliation.");
  }
  const discrepancyResult = await db.query(`
    select category,status,before_sha256,restored_sha256,before_count,restored_count,details_json
    from custodial_dr.restore_discrepancies where restore_id=$1 order by category for update
  `, [intent.restore_id]);
  const snapshot = discrepancySnapshot(discrepancyResult.rows);
  if (sha256(stableJson(snapshot)) !== intent.discrepancy_snapshot_sha256) {
    throw new Error("Restore discrepancy state changed after reconciliation approval.");
  }
  const open = snapshot.filter((row) => row.status === "OPEN").map((row) => row.category);
  const resolutionCategories = intent.resolutions.map((row) => String(row?.category || ""));
  if (stableJson(open) !== stableJson([...resolutionCategories].sort())) throw new Error("Signed resolutions do not equal the complete OPEN discrepancy set.");
  const storageResolution = intent.resolutions.find((row) => row?.category === "storage_state");
  const storageDiscrepancy = discrepancyResult.rows.find((row) => row.category === "storage_state" && row.status === "OPEN");
  if (manifest.storage_verified !== true) {
    if (!storageResolution || !storageDiscrepancy || !intent.storage_supported_state_resample) throw new Error("Unverified Storage requires a signed exact byte-level Storage reconciliation and resample.");
    validateStorageOperatorEvidence({
      evidence: storageResolution.evidence,
      discrepancy: storageDiscrepancy,
      manifestUpdatedAt: manifest.updated_at,
      finalManifestSha256: manifest.final_manifest_sha256,
      discrepancySnapshotSha256: intent.discrepancy_snapshot_sha256,
      supportedStateResample: intent.storage_supported_state_resample,
      reconciliationDisposition: storageResolution.disposition,
      requireBindings: true,
    });
    const currentStorageResample = await captureStorageSupportedState({ db, downloadObject: makeStorageDownloader() });
    if (stableJson(currentStorageResample.state) !== stableJson(intent.storage_supported_state_resample.state)
        || currentStorageResample.state_sha256 !== intent.storage_supported_state_resample.state_sha256) {
      throw new Error("Supported Storage metadata or object bytes changed after reconciliation approval.");
    }
  } else if (storageResolution || intent.storage_supported_state_resample !== null) {
    throw new Error("Verified Storage cannot receive a synthetic Storage reconciliation.");
  }
  for (const resolution of intent.resolutions) {
    if (!/^[a-z0-9_]{1,120}$/.test(String(resolution.category || ""))
        || !["RESOLVED", "ACCEPTED_LOSS"].includes(resolution.disposition)
        || String(resolution.resolution || "").trim().length < 10
        || String(resolution.resolution || "").trim().length > 2000
        || !resolution.evidence || typeof resolution.evidence !== "object" || Array.isArray(resolution.evidence)) throw new Error("Signed discrepancy resolution is invalid.");
    const updated = await db.query(`
      update custodial_dr.restore_discrepancies set
        status=$1,resolved_by=$2,resolved_at=clock_timestamp(),resolution=$3
      where restore_id=$4 and category=$5 and status='OPEN'
    `, [resolution.disposition, intent.actor, resolution.resolution, intent.restore_id, resolution.category]);
    if (updated.rowCount !== 1) throw new Error(`Failed to resolve exact discrepancy ${resolution.category}.`);
  }
  let reconciliationManifestSha256 = null;
  if (storageResolution) {
    const reconciledStorageEvidence = {
      ...(manifest.storage_evidence || {}),
      operator_reconciliation: {
        reconciliation_id: intent.reconciliation_id,
        actor: intent.actor,
        disposition: storageResolution.disposition,
        resolution: storageResolution.resolution,
        evidence: storageResolution.evidence,
        storage_supported_state_resample: intent.storage_supported_state_resample,
      },
    };
    reconciliationManifestSha256 = sha256(stableJson({
      prior_final_manifest_sha256: intent.final_manifest_sha256,
      discrepancy_snapshot_sha256: intent.discrepancy_snapshot_sha256,
      storage_evidence: reconciledStorageEvidence,
      resolutions: intent.resolutions,
    }));
    await db.query(`
      update custodial_dr.restore_manifests set
        storage_verified=true,storage_evidence=$2::jsonb,reconciliation_manifest_sha256=$3,updated_at=clock_timestamp()
      where restore_id=$1
    `, [intent.restore_id, JSON.stringify(reconciledStorageEvidence), reconciliationManifestSha256]);
  }
  if (String(process.env.RESTORE_RECONCILIATION_TEST_FAIL_BEFORE_COMMIT || "").toLowerCase() === "true") {
    if (!allowCrashProbe) throw new Error("The reconciliation crash probe is restricted to a disposable loopback database.");
    throw new Error("Isolated reconciliation crash probe before commit.");
  }
  const remaining = await db.query("select count(*)::int count from custodial_dr.restore_discrepancies where restore_id=$1 and status='OPEN'", [intent.restore_id]);
  if (Number(remaining.rows[0].count) !== 0) throw new Error("Restore retains unresolved discrepancies.");
  const leases = await db.query("select count(*)::int count from custodial_dr.application_mutation_leases");
  if (Number(leases.rows[0].count) !== 0) throw new Error("Application mutation leases remain; production cannot resume.");
  const resumed = await db.query(`
    update custodial_dr.restore_control set
      state='COMPLETE',mutations_paused=false,completed_at=clock_timestamp(),failure_reason=null,updated_at=clock_timestamp()
    where singleton=true and restore_id=$1 and authority_generation=$2 and state='PAUSED_RECONCILIATION' and mutations_paused=true
  `, [intent.restore_id, intent.authority_generation]);
  if (resumed.rowCount !== 1) throw new Error("Restore control changed before reconciliation commit.");
  await db.query(`
    insert into custodial_dr.restore_events(restore_id,authority_generation,phase,outcome,actor,evidence_json)
    values ($1,$2,'PRODUCTION_RECONCILIATION','RESOLVED',$3,$4::jsonb)
  `, [intent.restore_id, intent.authority_generation, intent.actor, JSON.stringify({
    reconciliation_id: intent.reconciliation_id,
    intent_sha256: intentDigest,
    archive_digest: intent.archive_digest,
    final_manifest_sha256: intent.final_manifest_sha256,
    discrepancy_snapshot_sha256: intent.discrepancy_snapshot_sha256,
    resolutions: intent.resolutions,
    storage_supported_state_resample: intent.storage_supported_state_resample,
    reconciliation_manifest_sha256: reconciliationManifestSha256,
  })]);
  await db.query("commit");
  console.log(JSON.stringify({ ok: true, idempotent_replay: false, restore_id: intent.restore_id, reconciliation_id: intent.reconciliation_id, resumed: true }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  throw error;
} finally {
  await db.query("select pg_advisory_unlock(hashtextextended('memphis-zoo-production-restore',0))").catch(() => {});
  await db.end().catch(() => {});
}
