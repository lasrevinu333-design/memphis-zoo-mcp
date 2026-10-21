#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readOriginalRestoreDatabaseStatus } from "./disaster-recovery-state.mjs";
import { readVerifiedImmutableFreshDatabaseCommitOutcome, readVerifiedImmutableFreshAuthorityCommitOutcome, readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal } from "./immutable-private-fresh-restore-recovery.mjs";
import {
  requireSigningKey,
  restoreReconciliationBinding,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";
import {
  captureStorageSupportedState,
  isExplicitLocalRestoreFixtureTarget,
  validateStorageOperatorEvidence,
} from "./disaster-recovery-storage.mjs";

const { Client } = pg;
const endReconciliationIntentClient = Client.prototype.end;
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const statusKeys = ["RESTORE_RECONCILIATION_STATUS_ID", "RESTORE_RECONCILIATION_STATUS_GENERATION", "RESTORE_RECONCILIATION_STATUS_ARCHIVE_DIGEST"];
const authorityStatusKeys = ["RESTORE_RECONCILIATION_STATUS_DATABASE_OID", "RESTORE_RECONCILIATION_STATUS_EFFECT_BACKEND_PID",
  "RESTORE_RECONCILIATION_STATUS_EFFECT_TRANSACTION_ID", "RESTORE_RECONCILIATION_STATUS_ORIGINAL_TRANSACTION_ID"];
const authorityStatusFlagName = "RESTORE_RECONCILIATION_STATUS_AUTHORITY_OUTCOME";
const authorityOriginalStatusFlagName = "RESTORE_RECONCILIATION_STATUS_AUTHORITY_FROM_ORIGINAL";
const allowedStatusKeys = new Set([...statusKeys, ...authorityStatusKeys, authorityStatusFlagName, authorityOriginalStatusFlagName, "RESTORE_RECONCILIATION_STATUS_COMMIT_OUTCOME"]);
if (Object.keys(process.env).some(name => name.startsWith("RESTORE_RECONCILIATION_STATUS_") && !allowedStatusKeys.has(name))) {
  throw new Error("Unknown original status configuration field.");
}
const authorityStatusRequested = Object.hasOwn(process.env, authorityStatusFlagName)
  || Object.hasOwn(process.env, authorityOriginalStatusFlagName)
  || authorityStatusKeys.some(name => Object.hasOwn(process.env, name));
const statusMode = statusKeys.some(name => Object.hasOwn(process.env, name)) || authorityStatusRequested;
if (statusMode && !statusKeys.every(name => Object.hasOwn(process.env, name) && process.env[name].length > 0)) {
  throw new Error("Original status requires RESTORE_RECONCILIATION_STATUS_ID, RESTORE_RECONCILIATION_STATUS_GENERATION and RESTORE_RECONCILIATION_STATUS_ARCHIVE_DIGEST together.");
}
let statusRequest = statusMode ? {
  restoreId: process.env.RESTORE_RECONCILIATION_STATUS_ID,
  generation: process.env.RESTORE_RECONCILIATION_STATUS_GENERATION,
  archiveDigest: process.env.RESTORE_RECONCILIATION_STATUS_ARCHIVE_DIGEST,
  targetProjectRef: projectRef,
} : null;
const statusCommitOutcomeFlag = process.env.RESTORE_RECONCILIATION_STATUS_COMMIT_OUTCOME;
if (statusCommitOutcomeFlag !== undefined && statusCommitOutcomeFlag !== "false" && statusCommitOutcomeFlag !== "true") {
  throw new Error("RESTORE_RECONCILIATION_STATUS_COMMIT_OUTCOME must be exactly true or false when supplied.");
}
const statusCommitOutcome = statusCommitOutcomeFlag === "true";
if (statusCommitOutcome && (!statusMode || !/^[a-z0-9]{20}$/.test(projectRef))) {
  throw new Error("Commit outcome requires complete original status configuration and SUPABASE_PROJECT_REF.");
}
const statusAuthorityOutcomeFlag = process.env[authorityStatusFlagName];
if (Object.hasOwn(process.env, authorityStatusFlagName) && statusAuthorityOutcomeFlag !== "false" && statusAuthorityOutcomeFlag !== "true") {
  throw new Error("RESTORE_RECONCILIATION_STATUS_AUTHORITY_OUTCOME must be exactly true or false when supplied.");
}
const statusAuthorityOutcome = statusAuthorityOutcomeFlag === "true";
const statusAuthorityOriginalFlag = process.env[authorityOriginalStatusFlagName];
if (Object.hasOwn(process.env, authorityOriginalStatusFlagName) && statusAuthorityOriginalFlag !== "false" && statusAuthorityOriginalFlag !== "true") {
  throw new Error("RESTORE_RECONCILIATION_STATUS_AUTHORITY_FROM_ORIGINAL must be exactly true or false when supplied.");
}
const statusAuthorityOriginalOutcome = statusAuthorityOriginalFlag === "true";
if (statusAuthorityOriginalOutcome && (statusAuthorityOutcome || statusCommitOutcome
    || authorityStatusKeys.some(name => Object.hasOwn(process.env, name)))) {
  throw new Error("Original-only authority recovery excludes database/recorded-authority outcome modes and recorded lookup fields.");
}
if (statusAuthorityOriginalOutcome) {
  if (!statusRequest || typeof statusRequest.restoreId !== "string" || statusRequest.restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(statusRequest.restoreId)
      || typeof statusRequest.generation !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(statusRequest.generation)
      || BigInt(statusRequest.generation) > 9223372036854775807n
      || typeof statusRequest.archiveDigest !== "string" || statusRequest.archiveDigest.length !== 64
      || !/^[0-9a-f]{64}$/.test(statusRequest.archiveDigest)
      || typeof process.env.SUPABASE_PROJECT_REF !== "string" || process.env.SUPABASE_PROJECT_REF !== projectRef
      || !/^[a-z0-9]{20}(?![\s\S])/.test(projectRef)) {
    throw new Error("Original-only authority recovery requires the exact original restore ID, generation, archive digest and target project together.");
  }
  statusRequest = Object.freeze(statusRequest);
}
if (statusAuthorityOutcome && statusCommitOutcome) {
  throw new Error("Database and authority commit outcome modes are mutually exclusive.");
}
if (!statusAuthorityOutcome && authorityStatusKeys.some(name => Object.hasOwn(process.env, name))) {
  throw new Error("Recorded authority status fields require explicit authority outcome mode.");
}
if (statusAuthorityOutcome) {
  const decimal = (value, maximum) => typeof value === "string" && /^[1-9][0-9]{0,18}(?![\s\S])/.test(value)
    && BigInt(value) <= maximum;
  const databaseOid = process.env.RESTORE_RECONCILIATION_STATUS_DATABASE_OID;
  const effectPid = process.env.RESTORE_RECONCILIATION_STATUS_EFFECT_BACKEND_PID;
  const effectTransactionId = process.env.RESTORE_RECONCILIATION_STATUS_EFFECT_TRANSACTION_ID;
  const originalTransactionId = process.env.RESTORE_RECONCILIATION_STATUS_ORIGINAL_TRANSACTION_ID;
  if (!statusRequest || typeof statusRequest.restoreId !== "string" || statusRequest.restoreId.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(statusRequest.restoreId)
      || !decimal(statusRequest.generation, 9223372036854775807n)
      || typeof statusRequest.archiveDigest !== "string" || statusRequest.archiveDigest.length !== 64
      || !/^[0-9a-f]{64}$/.test(statusRequest.archiveDigest)
      || typeof process.env.SUPABASE_PROJECT_REF !== "string" || process.env.SUPABASE_PROJECT_REF !== projectRef
      || !/^[a-z0-9]{20}(?![\s\S])/.test(projectRef)
      || !decimal(databaseOid, 4294967295n) || !decimal(effectPid, 2147483647n)
      || !decimal(effectTransactionId, 9223372036854775807n) || !decimal(originalTransactionId, 9223372036854775807n)
      || originalTransactionId === effectTransactionId) {
    throw new Error("Authority status requires the complete exact original tuple and canonical recorded database/PID/transaction lookup fields.");
  }
  // PID is converted only AFTER primitive canonical decimal/int32 validation;
  // all other original lookup scalars remain exact TEXT, never authority.
  statusRequest = Object.freeze({ ...statusRequest, databaseOid, effectBackendPid: Number(effectPid),
    effectTransactionId, originalTransactionId });
}
const actor = statusMode ? "" : String(process.env.RESTORE_RECONCILIATION_NAMED_ACTOR || "").trim();
const key = statusMode ? null : requireSigningKey(process.env.RESTORE_RECONCILIATION_SIGNING_KEY, "RESTORE_RECONCILIATION_SIGNING_KEY");
const keyId = statusMode ? "" : String(process.env.RESTORE_RECONCILIATION_SIGNING_KEY_ID || "").trim();
const ttlMinutes = statusMode ? null : Math.max(5, Math.min(60, Number(process.env.RESTORE_RECONCILIATION_TTL_MINUTES || 30)));
const requestedResolutions = statusMode ? null : JSON.parse(String(process.env.RESTORE_RECONCILIATION_RESOLUTIONS_JSON || "null"));
const storageSecret = statusMode ? "" : String(process.env.SUPABASE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const testStorageBytes = statusMode ? "" : String(process.env.RESTORE_RECONCILIATION_TEST_STORAGE_BYTES_JSON || "").trim();

if (!databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_DB_URL and SUPABASE_PROJECT_REF are required.");
if (!statusMode) {
  if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RESTORE_RECONCILIATION_NAMED_ACTOR must identify the approving operator.");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RESTORE_RECONCILIATION_SIGNING_KEY_ID is required.");
  if (!Array.isArray(requestedResolutions)) throw new Error("RESTORE_RECONCILIATION_RESOLUTIONS_JSON must be an explicit JSON array, including [] when none are open.");
}

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
if (testStorageBytes && !isExplicitLocalRestoreFixtureTarget(databaseUrl)) {
  throw new Error("Storage-byte fixtures require an explicit loopback mz_schema_rebuild_* PostgreSQL target without URI overrides.");
}
function makeStorageDownloader() {
  const allowFixture = isExplicitLocalRestoreFixtureTarget(databaseUrl) && testStorageBytes;
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
if (statusMode) {
  let status, firstFailure;
  let failed = false, rollbackRequired = false;
  const endStatusClient = Client.prototype.end;
  try {
    await db.connect();
    rollbackRequired = true;
    await db.query("begin isolation level repeatable read read only");
    if (statusAuthorityOriginalOutcome) {
      await db.query("set local search_path = pg_catalog, pg_temp");
      status = await readVerifiedImmutableFreshAuthorityCommitOutcomeFromOriginal({ db, request: statusRequest });
    } else if (statusAuthorityOutcome) {
      await db.query("set local search_path = pg_catalog, pg_temp");
      status = await readVerifiedImmutableFreshAuthorityCommitOutcome({ db, request: statusRequest });
    } else {
      status = statusCommitOutcome
        ? await readVerifiedImmutableFreshDatabaseCommitOutcome({ db, request: statusRequest })
        : await readOriginalRestoreDatabaseStatus(db, statusRequest);
    }
  } catch (error) {
    firstFailure = error;
    failed = true;
  }
  if (rollbackRequired) {
    try {
      await db.query("rollback");
    } catch (error) {
      if (!failed) { firstFailure = error; failed = true; }
    }
  }
  try {
    await Reflect.apply(endStatusClient, db, []);
  } catch (error) {
    if (!failed) { firstFailure = error; failed = true; }
  }
  if (failed) throw firstFailure;
  console.log(JSON.stringify(status));
} else {
let pendingEnvelope, firstFailure;
let failed = false, rollbackRequired = false;
const cleanupErrors = [];
try {
  await db.connect();
  rollbackRequired = true;
  await db.query("begin isolation level repeatable read read only");
  const control = await db.query("select * from custodial_dr.restore_control where singleton=true");
  const state = Array.isArray(control.rows) ? control.rows[0] : null;
  if (control.rowCount !== 1 || !Array.isArray(control.rows) || control.rows.length !== 1
      || !state || state.state !== "PAUSED_RECONCILIATION" || state.mutations_paused !== true
      || typeof state.restore_id !== "string" || state.restore_id.length !== 36
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(state.restore_id)
      || typeof state.archive_digest !== "string" || state.archive_digest.length !== 64
      || !/^[0-9a-f]{64}$/.test(state.archive_digest)) {
    throw new Error("Only an exact verified restore held in PAUSED_RECONCILIATION can receive a reconciliation intent.");
  }
  if (state.target_project_ref !== projectRef) throw new Error("The paused restore targets a different project.");
  const originalGeneration = state.authority_generation;
  if (typeof originalGeneration !== "string" || !/^[1-9][0-9]{0,18}(?![\s\S])/.test(originalGeneration)) {
    throw new Error("Reconciliation requires a canonical positive SQL generation string.");
  }
  const exactGeneration = BigInt(originalGeneration);
  if (exactGeneration > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Reconciliation generation exceeds the supported v1 safe-integer contract.");
  }
  const authorityGeneration = Number(exactGeneration);
  const manifestResult = await db.query("select * from custodial_dr.restore_manifests where restore_id=$1", [state.restore_id]);
  const manifest = Array.isArray(manifestResult.rows) ? manifestResult.rows[0] : null;
  if (manifestResult.rowCount !== 1 || !Array.isArray(manifestResult.rows) || manifestResult.rows.length !== 1
      || !manifest || manifest.restore_id !== state.restore_id
      || typeof manifest.authority_generation !== "string" || manifest.authority_generation !== originalGeneration
      || manifest.archive_digest !== state.archive_digest
      || manifest.database_verified !== true
      || manifest.authority_invalidated !== true || manifest.post_restore_verified !== true
      || typeof manifest.final_manifest_sha256 !== "string" || manifest.final_manifest_sha256.length !== 64
      || !/^[0-9a-f]{64}$/.test(manifest.final_manifest_sha256)) {
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
    authority_generation: authorityGeneration,
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
  pendingEnvelope = {
    format: "memphis-zoo-production-restore-reconciliation.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    intent,
    signature: signBinding(restoreReconciliationBinding(intent), key),
  };
} catch (error) {
  firstFailure = error;
  failed = true;
} finally {
  if (rollbackRequired) {
    try { await db.query("rollback"); } catch (error) { cleanupErrors.push(error); }
  }
  try { await Reflect.apply(endReconciliationIntentClient, db, []); } catch (error) { cleanupErrors.push(error); }
}
if (failed || cleanupErrors.length) {
  const errors = failed ? [firstFailure, ...cleanupErrors] : cleanupErrors;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "Reconciliation intent failed and cleanup did not complete.", failed ? { cause: firstFailure } : undefined);
}
console.log(JSON.stringify(pendingEnvelope));
}
