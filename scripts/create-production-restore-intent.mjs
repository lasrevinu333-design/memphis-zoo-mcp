#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  requireSigningKey,
  restoreIntentBinding,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";
import { materializeVerifiedArchive, restoreArchiveAdmission } from "./disaster-recovery-archive.mjs";
import { validateV4StorageArchiveObjects } from "./disaster-recovery-storage.mjs";

const { Client } = pg;
const sourceInputDir = resolve(String(process.env.RESTORE_SOURCE_DIR || ""));
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
const actor = String(process.env.RESTORE_NAMED_ACTOR || "").trim();
const key = requireSigningKey(process.env.RESTORE_INTENT_SIGNING_KEY, "RESTORE_INTENT_SIGNING_KEY");
const keyId = String(process.env.RESTORE_INTENT_SIGNING_KEY_ID || "").trim();
const archiveVerifyKey = requireSigningKey(process.env.RESTORE_ARCHIVE_VERIFY_KEY, "RESTORE_ARCHIVE_VERIFY_KEY");
const archiveVerifyKeyId = String(process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID || "").trim();
const ttlMinutes = Math.max(5, Math.min(60, Number(process.env.RESTORE_INTENT_TTL_MINUTES || 30)));

if (!sourceInputDir || !databaseUrl || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("RESTORE_SOURCE_DIR, SUPABASE_DB_URL and SUPABASE_PROJECT_REF are required.");
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RESTORE_NAMED_ACTOR must identify the approving operator.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RESTORE_INTENT_SIGNING_KEY_ID is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(archiveVerifyKeyId)) throw new Error("RESTORE_ARCHIVE_VERIFY_KEY_ID is required.");
if (key === archiveVerifyKey) throw new Error("Archive verification and restore-intent signing keys must be independent.");

const verifiedArchive = materializeVerifiedArchive({
  sourceDir: sourceInputDir,
  archiveVerifyKey,
  archiveVerifyKeyId,
  supportedFormats: ["memphis-zoo-disaster-recovery.v4"],
  requiredEntries: [
    "backup-summary.json",
    "inventory/table-catalog.json",
    "inventory/storage-buckets.json",
    "inventory/storage-objects.json",
  ],
});
const sourceDir = verifiedArchive.directory;
const { summary, archiveDigest } = verifiedArchive;
try {
  restoreArchiveAdmission(summary.format, { apply: true });
  const archivedStorageObjects = JSON.parse(readFileSync(join(sourceDir, "inventory", "storage-objects.json"), "utf8"));
  validateV4StorageArchiveObjects(archivedStorageObjects);
  const checksumEntries = new Map(readFileSync(join(sourceDir, "SHA256SUMS"), "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error("The verified v4 archive checksum inventory is malformed.");
    return [match[2], match[1]];
  }));
  for (const object of archivedStorageObjects) {
    const objectPath = join(sourceDir, object.file);
    if (checksumEntries.get(object.file) !== object.sha256 || statSync(objectPath).size !== object.size_bytes) {
      throw new Error("The verified v4 Storage row does not bind its exact checksummed object bytes.");
    }
  }
  if (summary.project_ref !== projectRef || !summary.source_identity || typeof summary.source_identity !== "object") {
    throw new Error("The verified v4 archive does not bind the exact target project and source identity.");
  }
} catch (error) {
  verifiedArchive.cleanup();
  throw error;
}

const db = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-restore-intent" });
try {
  await db.connect();
  await db.query("begin read only");
  const control = await db.query("select authority_generation,mutations_paused,state,restore_id from custodial_dr.restore_control where singleton=true");
  if (control.rowCount !== 1) throw new Error("The restore control plane is unavailable.");
  const controlState = control.rows[0];
  const retryFailure = controlState.mutations_paused === true && controlState.state === "PAUSED_FAILURE" && controlState.restore_id;
  const freshRestore = controlState.mutations_paused === false && ["READY", "COMPLETE"].includes(controlState.state);
  if (!retryFailure && !freshRestore) {
    throw new Error("Only an unpaused ready control plane or an exact PAUSED_FAILURE can receive a restore intent.");
  }
  const leases = await db.query(`
    select
      count(*) filter (where expires_at>clock_timestamp())::int active_count,
      count(*) filter (where expires_at<=clock_timestamp())::int expired_count
    from custodial_dr.application_mutation_leases
  `);
  if (Number(leases.rows[0].expired_count) !== 0) {
    throw new Error("Expired application mutation leases require signed abandoned-lease reconciliation before a restore intent can be approved.");
  }
  if (retryFailure && Number(leases.rows[0].active_count) !== 0) {
    throw new Error("A PAUSED_FAILURE retry requires every admitted application mutation lease to be settled or reconciled.");
  }
  const migration = await db.query("select max(version)::text migration_head from supabase_migrations.schema_migrations");
  const release = await db.query(`
    select release_id,backend_commit,frontend_commit,migration_head,migration_manifest_sha256
    from public.release_deployment_manifest
    where status in ('deployed','validated','candidate')
    order by (status='deployed') desc,deployed_at desc nulls last,created_at desc limit 1
  `);
  if (release.rowCount !== 1) throw new Error("The target release identity is unavailable.");
  const intent = {
    restore_id: randomUUID(),
    authority_generation: Number(controlState.authority_generation) + 1,
    retry_of_restore_id: retryFailure ? String(controlState.restore_id) : null,
    archive_digest: archiveDigest,
    source_project_ref: summary.project_ref,
    target_project_ref: projectRef,
    source_identity_sha256: createHash("sha256").update(stableJson(summary.source_identity)).digest("hex"),
    target_migration_head: String(migration.rows[0]?.migration_head || ""),
    target_release_identity: release.rows[0],
    actor,
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    resume_after_verification: false,
  };
  const envelope = {
    format: "memphis-zoo-production-restore-intent.v1",
    algorithm: "hmac-sha256",
    key_id: keyId,
    intent,
    signature: signBinding(restoreIntentBinding(intent), key),
  };
  console.log(JSON.stringify(envelope));
  await db.query("rollback");
} finally {
  await db.end().catch(() => {});
  verifiedArchive.cleanup();
}
