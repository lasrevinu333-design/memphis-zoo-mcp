#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  requireSigningKey,
  restoreReconciliationBinding,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";
import {
  captureStorageSupportedState,
  validateStorageOperatorEvidence,
} from "./disaster-recovery-storage.mjs";

const { Client } = pg;
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const actor = String(process.env.RESTORE_RECONCILIATION_NAMED_ACTOR || "").trim();
const key = requireSigningKey(process.env.RESTORE_RECONCILIATION_SIGNING_KEY, "RESTORE_RECONCILIATION_SIGNING_KEY");
const keyId = String(process.env.RESTORE_RECONCILIATION_SIGNING_KEY_ID || "").trim();
const ttlMinutes = Math.max(5, Math.min(60, Number(process.env.RESTORE_RECONCILIATION_TTL_MINUTES || 30)));
const requestedResolutions = JSON.parse(String(process.env.RESTORE_RECONCILIATION_RESOLUTIONS_JSON || "null"));
const storageSecret = String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const testStorageBytes = String(process.env.RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON || "").trim();

if (!databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_DB_URL and SUPABASE_PROJECT_REF are required.");
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RESTORE_RECONCILIATION_NAMED_ACTOR must identify the approving operator.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RESTORE_RECONCILIATION_SIGNING_KEY_ID is required.");
if (!Array.isArray(requestedResolutions)) throw new Error("RESTORE_RECONCILIATION_RESOLUTIONS_JSON must be an explicit JSON array, including [] when none are open.");

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function normalizeResolutions(value) {
  const rows = value.map((row) => ({
    category: String(row?.category || "").trim(),
    disposition: String(row?.disposition || "").trim(),
    resolution: String(row?.resolution || "").trim(),
    evidence: row?.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? row.evidence : {},
  })).sort((a, b) => a.category.localeCompare(b.category));
  if (rows.some((row) => !/^[a-z0-9_]{1,120}$/.test(row.category)
      || !["RESOLVED", "ACCEPTED_LOSS"].includes(row.disposition)
      || row.resolution.length < 10 || row.resolution.length > 2000)) {
    throw new Error("Every requested reconciliation must name one category, RESOLVED or ACCEPTED_LOSS, and a 10-2000 character explanation.");
  }
  if (new Set(rows.map((row) => row.category)).size !== rows.length) throw new Error("Reconciliation categories must be unique.");
  return rows;
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

const db = new Client({
  connectionString: databaseUrl,
  application_name: "memphis-zoo-create-restore-reconciliation",
  ...(databaseCaCertPath ? { ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true } } : {}),
});
await db.connect();
try {
  await db.query("begin isolation level repeatable read read only");
  const control = await db.query("select * from custodial_dr.restore_control where singleton=true");
  const state = control.rows[0];
  if (!state || state.state !== "PAUSED_RECONCILIATION" || state.mutations_paused !== true || !state.restore_id) {
    throw new Error("Only an exact verified restore held in PAUSED_RECONCILIATION can receive a reconciliation intent.");
  }
  if (state.target_project_ref !== projectRef) throw new Error("The paused restore targets a different project.");
  const manifestResult = await db.query("select * from custodial_dr.restore_manifests where restore_id=$1", [state.restore_id]);
  const manifest = manifestResult.rows[0];
  if (!manifest || manifest.database_verified !== true
      || manifest.authority_invalidated !== true || manifest.post_restore_verified !== true
      || !/^[0-9a-f]{64}$/.test(String(manifest.final_manifest_sha256 || ""))) {
    throw new Error("The paused restore does not have a complete final verification manifest.");
  }
  const discrepancyResult = await db.query(`
    select category,status,before_sha256,restored_sha256,before_count,restored_count,details_json
    from custodial_dr.restore_discrepancies where restore_id=$1 order by category
  `, [state.restore_id]);
  const discrepancies = discrepancySnapshot(discrepancyResult.rows);
  let resolutions = normalizeResolutions(requestedResolutions);
  const open = discrepancies.filter((row) => row.status === "OPEN").map((row) => row.category);
  if (stableJson(open) !== stableJson(resolutions.map((row) => row.category))) {
    throw new Error("The requested reconciliation categories must equal the complete exact OPEN discrepancy set.");
  }
  const storageResolution = resolutions.find((row) => row.category === "storage_state");
  const storageDiscrepancy = discrepancyResult.rows.find((row) => row.category === "storage_state" && row.status === "OPEN");
  if (manifest.storage_verified !== true) {
    if (!storageResolution || !storageDiscrepancy) throw new Error("An unverified Storage manifest requires the exact OPEN storage_state reconciliation.");
  } else if (storageResolution) {
    throw new Error("A verified Storage manifest cannot receive a synthetic Storage resolution.");
  }
  const discrepancySnapshotSha256 = sha256(stableJson(discrepancies));
  const storageSupportedStateResample = manifest.storage_verified === true ? null : await captureStorageSupportedState({
    db,
    downloadObject: makeStorageDownloader(),
  });
  if (storageResolution) {
    const evidence = validateStorageOperatorEvidence({
      evidence: storageResolution.evidence,
      discrepancy: storageDiscrepancy,
      manifestUpdatedAt: manifest.updated_at,
      finalManifestSha256: manifest.final_manifest_sha256,
      discrepancySnapshotSha256,
      supportedStateResample: storageSupportedStateResample,
      reconciliationDisposition: storageResolution.disposition,
    });
    resolutions = resolutions.map((row) => row.category === "storage_state" ? { ...row, evidence } : row);
  }
  const intent = {
    reconciliation_id: randomUUID(),
    restore_id: String(state.restore_id),
    authority_generation: Number(state.authority_generation),
    archive_digest: state.archive_digest,
    target_project_ref: projectRef,
    final_manifest_sha256: manifest.final_manifest_sha256,
    discrepancy_snapshot_sha256: discrepancySnapshotSha256,
    storage_supported_state_resample: storageSupportedStateResample,
    resolutions,
    actor,
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
  };
  console.log(JSON.stringify({
    format: "memphis-zoo-production-restore-reconciliation.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    intent,
    signature: signBinding(restoreReconciliationBinding(intent), key),
  }));
  await db.query("rollback");
} finally {
  await db.end();
}
