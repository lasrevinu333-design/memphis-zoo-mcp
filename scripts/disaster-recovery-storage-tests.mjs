#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  captureStorageSupportedState,
  compareStorageState,
  storageBucketOptions,
  storageObjectArchivePath,
  storageObjectUploadOptions,
  storageOwnerPrincipalId,
  validateV4StorageArchiveObjects,
  validateStorageOperatorEvidence,
} from "./disaster-recovery-storage.mjs";

assert.deepEqual(storageBucketOptions({ public: false, file_size_limit: 4096, allowed_mime_types: ["image/png"] }), {
  public: false,
  fileSizeLimit: 4096,
  allowedMimeTypes: ["image/png"],
});
assert.deepEqual(storageObjectUploadOptions({ database_row: { metadata: { mimetype: "image/png", cacheControl: "3600" }, user_metadata: { ticket: "T-7" } } }), {
  upsert: true,
  contentType: "image/png",
  cacheControl: "3600",
  metadata: { ticket: "T-7" },
});
assert.equal(storageOwnerPrincipalId({ owner_id: "", owner: "employee-1" }), "employee-1",
  "a blank owner_id cannot mask a populated legacy owner");
assert.throws(() => storageOwnerPrincipalId({ owner_id: 123, owner: 123 }),
  /null or strings/i, "owner values cannot be string-coerced from arbitrary signed JSON scalars");
assert.throws(() => storageOwnerPrincipalId({ owner_id: "employee-1", owner: "employee-3" }),
  /one unambiguous principal/i, "conflicting populated owner columns must fail closed");
const v4ArchiveRow = {
  id: "v4-object-id", bucket_id: "private", name: "v4-proof.bin",
  owner_id: "employee-1", owner: "employee-1", metadata: { size: 8 }, user_metadata: null,
  version: "v4-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
  last_accessed_at: "2026-08-27T00:00:00+00:00",
};
const v4ArchiveObject = {
  id: v4ArchiveRow.id, bucket_id: v4ArchiveRow.bucket_id, name: v4ArchiveRow.name,
  file: storageObjectArchivePath(v4ArchiveRow.bucket_id, v4ArchiveRow.name), size_bytes: 8,
  sha256: createHash("sha256").update("v4-proof").digest("hex"),
  metadata: v4ArchiveRow.metadata, user_metadata: v4ArchiveRow.user_metadata, version: v4ArchiveRow.version,
  created_at: v4ArchiveRow.created_at, updated_at: v4ArchiveRow.updated_at,
  database_row: v4ArchiveRow,
};
assert.doesNotThrow(() => validateV4StorageArchiveObjects([v4ArchiveObject]));
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, database_row: undefined }]),
  /complete database_row/i, "a v3-shaped wrapper cannot be relabeled as a restore-compatible v4 object");
const { owner: _missingLegacyOwner, ...rowWithoutOwner } = v4ArchiveRow;
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, database_row: rowWithoutOwner }]),
  /exact row or byte identity/i, "v4 must bind both ownership columns, including an explicit null value");
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, name: "wrapper-drift.bin" }]),
  /wrapper disagrees/i, "the v4 wrapper cannot disagree with its archived database row");
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, file: "backup-summary.json" }]),
  /deterministic producer archive path/i, "a checksummed control file cannot be substituted for Storage object bytes");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, database_row: { ...v4ArchiveRow, owner_id: 123, owner: 123 },
}]), /owner fields must be null or nonblank strings/i, "numeric owner fields cannot become synthetic string principals");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, database_row: { ...v4ArchiveRow, owner_id: "", owner: "employee-1" },
}]), /owner fields must be null or nonblank strings/i, "v4 producer rows must use null rather than blank owner values");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, metadata: [], database_row: { ...v4ArchiveRow, metadata: [] },
}]), /non-producer-shaped row value/i, "Storage metadata must be a JSON object or null");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, version: 7, database_row: { ...v4ArchiveRow, version: 7 },
}]), /non-producer-shaped row value/i, "Storage version cannot be an arbitrary JSON scalar");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, updated_at: "not-a-date", database_row: { ...v4ArchiveRow, updated_at: "not-a-date" },
}]), /non-producer-shaped row value/i, "Storage timestamps must retain producer timestamp strings");
for (const timestamp of [
  "0", "Aug 27 2026", "2026-08-27", "2026-08-27T00:00:00Z", "2026-02-30T00:00:00+00:00",
  "2026-08-27T00:00:00.0+00:00", "2026-08-27T00:00:00.123400+00:00", "2026-08-27T00:00:00-00:00",
]) {
  assert.throws(() => validateV4StorageArchiveObjects([{
    ...v4ArchiveObject, updated_at: timestamp, database_row: { ...v4ArchiveRow, updated_at: timestamp },
  }]), /PostgreSQL row_to_json timestamp/i,
  `JavaScript-parseable non-producer timestamp ${timestamp} must fail exact v4 admission`);
}
for (const timestamp of [
  "2026-08-27T00:00:00+00:00", "2026-08-27T00:00:00.1+00:00", "2026-08-27T00:00:00.123456-05:00",
]) {
  const row = { ...v4ArchiveRow, updated_at: timestamp };
  assert.doesNotThrow(() => validateV4StorageArchiveObjects([{
    ...v4ArchiveObject, updated_at: timestamp, database_row: row,
  }]), `canonical PostgreSQL row_to_json timestamp ${timestamp} must remain admissible`);
}
assert.throws(() => validateV4StorageArchiveObjects([v4ArchiveObject, v4ArchiveObject]),
  /duplicate object, database id, or archive file identity/i, "duplicate object and file identities must fail admission");

const archivedBucket = { id: "private", name: "private", public: false, file_size_limit: 4096, allowed_mime_types: ["image/png"], created_at: "before" };
const archivedObject = { database_row: { id: "old-id", bucket_id: "private", name: "a.png", owner_id: "employee-1", metadata: { mimetype: "image/png", cacheControl: "3600", size: 4 }, user_metadata: { ticket: "T-7" }, version: "old-version" } };
const differences = compareStorageState({
  archivedBuckets: [archivedBucket],
  archivedObjects: [archivedObject],
  actualBuckets: [{ ...archivedBucket, created_at: "after" }, { id: "target-only" }],
  actualObjects: [{ ...archivedObject.database_row, id: "new-id", owner_id: null, version: "new-version" }, { bucket_id: "target-only", name: "extra.bin" }],
});
assert.ok(differences.some((item) => item.field === "created_at" && item.support === "platform_managed"));
assert.ok(differences.some((item) => item.field === "owner_id" && item.support === "platform_managed_or_owner"));
assert.ok(differences.some((item) => item.field === "target_only" && item.scope === "bucket"));
assert.ok(differences.some((item) => item.field === "target_only" && item.scope === "object"));

const exactOwner = compareStorageState({
  archivedBuckets: [{ id: "private", public: false }],
  archivedObjects: [archivedObject],
  actualBuckets: [{ id: "private", public: false }],
  actualObjects: [archivedObject.database_row],
});
assert.ok(exactOwner.some((item) => item.field === "owner_access_boundary"), "owner equality alone cannot prove owner-scoped Storage access");
assert.ok(exactOwner.every((item) => !String(item.key).includes("\0")), "persisted Storage discrepancy identities cannot contain PostgreSQL-jsonb-incompatible NUL characters");
assert.deepEqual(JSON.parse(exactOwner.find((item) => item.scope === "object").key), ["private", "a.png"]);

const bytes = Buffer.from("exact current bytes");
const currentRows = {
  buckets: [{ id: "private", public: false }],
  objects: [{ bucket_id: "private", name: "a.png", owner_id: "employee-1", metadata: { size: bytes.length } }],
};
const db = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: currentRows.buckets.length, rows: currentRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: currentRows.objects.length, rows: currentRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const resample = await captureStorageSupportedState({ db, downloadObject: async () => bytes });
const unownedRows = {
  buckets: currentRows.buckets,
  objects: [{ ...currentRows.objects[0], owner_id: null }],
};
const unownedDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: unownedRows.buckets.length, rows: unownedRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: unownedRows.objects.length, rows: unownedRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const unownedResample = await captureStorageSupportedState({ db: unownedDb, downloadObject: async () => bytes });
assert.equal(resample.state.object_byte_digests[0].size_bytes, bytes.length);
assert.match(resample.state.object_byte_digests[0].sha256, /^[0-9a-f]{64}$/);
const manifestUpdatedAt = new Date(Date.now() - 5_000).toISOString();
const verifiedAt = new Date(Date.now() - 1_000).toISOString();
const discrepancy = { details_json: { discrepancies: [{ scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png", field: "owner_access_boundary" }] } };
const operatorEvidence = {
  format: "memphis-zoo.storage-operator-reconciliation.v2",
  verification_method: "Authenticated exact owner and non-owner reads of the named object.",
  verified_at: verifiedAt,
  platform_managed_disposition: "PRESERVED",
  owner_access_results: [{
    bucket_id: "private", name: "a.png", owner_principal_id: "employee-1",
    non_owner_principal_id: "employee-2",
    owner_read_succeeded: true, non_owner_read_denied: true, tested_at: verifiedAt,
    evidence_reference: "Exact owner read succeeded and the named non-owner read was denied by Storage.",
  }],
};
const boundEvidence = validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
});
assert.equal(boundEvidence.supported_state_resample_sha256, resample.state_sha256);
validateStorageOperatorEvidence({
  evidence: boundEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
  requireBindings: true,
});
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, verified_at: "2000-01-01T00:00:00.000Z" },
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), /current v2 proof/, "stale operator prose cannot reopen Storage admission");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png",
    field: "owner_id", expected: "employee-1", actual: null,
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: unownedResample,
}), /ownership must be restored/i, "a changed or missing owner cannot be described as preserved or bypass named access proof");
assert.doesNotThrow(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png",
    field: "owner_id", expected: "employee-1", actual: null,
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), "a repaired owner must advance to exact named owner/non-owner proof instead of dead-ending on historical discrepancy state");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, owner_access_results: [{
    ...operatorEvidence.owner_access_results[0], non_owner_principal_id: "employee-1",
  }] },
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), /current named owner\/non-owner access result/i, "the denied principal must be named and distinct from the owner");
const archivedMissingBytes = Buffer.from("signed archived bytes");
const replacementBytes = Buffer.from("different replacement bytes");
const archivedMissingRow = {
  id: "archived-id", bucket_id: "private", name: "lost.png", owner_id: "employee-1", owner: "employee-1",
  metadata: { size: archivedMissingBytes.length, mimetype: "image/png" }, version: "archived-version",
};
const missingDifferences = compareStorageState({
  archivedBuckets: currentRows.buckets,
  archivedObjects: [{
    database_row: archivedMissingRow,
    sha256: createHash("sha256").update(archivedMissingBytes).digest("hex"),
    size_bytes: archivedMissingBytes.length,
  }],
  actualBuckets: currentRows.buckets,
  actualObjects: [],
});
assert.match(missingDifferences[0].expected_object_sha256, /^[0-9a-f]{64}$/,
  "a missing-object discrepancy must retain the signed archived byte identity");
const replacementRows = {
  buckets: currentRows.buckets,
  objects: [{ ...archivedMissingRow, id: "replacement-id", metadata: { size: replacementBytes.length }, version: "replacement-version" }],
};
const replacementDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: replacementRows.buckets.length, rows: replacementRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: replacementRows.objects.length, rows: replacementRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const replacementResample = await captureStorageSupportedState({ db: replacementDb, downloadObject: async () => replacementBytes });
const missingObjectEvidence = {
  ...operatorEvidence,
  owner_access_results: [{ ...operatorEvidence.owner_access_results[0], name: "lost.png" }],
};
assert.throws(() => validateStorageOperatorEvidence({
  evidence: missingObjectEvidence,
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: replacementResample,
  reconciliationDisposition: "RESOLVED",
}), /explicit signed ACCEPTED_LOSS/i,
"a same-key replacement with different metadata or bytes cannot be mislabeled PRESERVED or RESOLVED");
assert.doesNotThrow(() => validateStorageOperatorEvidence({
  evidence: { ...missingObjectEvidence, platform_managed_disposition: "ACCEPTED_LOSS" },
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: replacementResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), "only an explicit signed top-level and evidence-level ACCEPTED_LOSS may admit a non-identical replacement");
const wrongOwnerRows = {
  buckets: currentRows.buckets,
  objects: [{ ...replacementRows.objects[0], owner_id: "employee-3", owner: "employee-3" }],
};
const wrongOwnerDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: wrongOwnerRows.buckets.length, rows: wrongOwnerRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: wrongOwnerRows.objects.length, rows: wrongOwnerRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const wrongOwnerResample = await captureStorageSupportedState({ db: wrongOwnerDb, downloadObject: async () => replacementBytes });
assert.throws(() => validateStorageOperatorEvidence({
  evidence: {
    ...missingObjectEvidence,
    platform_managed_disposition: "ACCEPTED_LOSS",
    owner_access_results: [{
      ...missingObjectEvidence.owner_access_results[0], owner_principal_id: "employee-3",
    }],
  },
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: wrongOwnerResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), /must restore the signed archived owner/i, "ACCEPTED_LOSS cannot admit a replacement under the wrong owner");
const wrongLegacyOwnerRows = {
  buckets: currentRows.buckets,
  objects: [{ ...replacementRows.objects[0], owner_id: "employee-1", owner: "employee-3" }],
};
const wrongLegacyOwnerDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: wrongLegacyOwnerRows.buckets.length, rows: wrongLegacyOwnerRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: wrongLegacyOwnerRows.objects.length, rows: wrongLegacyOwnerRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
await assert.rejects(
  () => captureStorageSupportedState({ db: wrongLegacyOwnerDb, downloadObject: async () => replacementBytes }),
  /one unambiguous principal/i,
  "a replacement whose owner_id matches while legacy owner drifts must fail before access evidence or ACCEPTED_LOSS",
);
const legacyOnlyArchivedRow = { ...archivedMissingRow, owner_id: "", owner: "employee-1" };
const legacyOnlyDifferences = compareStorageState({
  archivedBuckets: currentRows.buckets,
  archivedObjects: [{
    database_row: legacyOnlyArchivedRow,
    sha256: createHash("sha256").update(archivedMissingBytes).digest("hex"),
    size_bytes: archivedMissingBytes.length,
  }],
  actualBuckets: currentRows.buckets,
  actualObjects: [],
});
const legacyOnlyRows = {
  buckets: currentRows.buckets,
  objects: [{ ...legacyOnlyArchivedRow, metadata: { size: replacementBytes.length }, version: "replacement-version" }],
};
const legacyOnlyDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: legacyOnlyRows.buckets.length, rows: legacyOnlyRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: legacyOnlyRows.objects.length, rows: legacyOnlyRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const legacyOnlyResample = await captureStorageSupportedState({ db: legacyOnlyDb, downloadObject: async () => replacementBytes });
assert.equal(legacyOnlyResample.state.object_byte_digests[0].owner_principal_id, "employee-1");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...missingObjectEvidence, platform_managed_disposition: "ACCEPTED_LOSS", owner_access_results: [] },
  discrepancy: { details_json: { discrepancies: legacyOnlyDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: legacyOnlyResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), /owner-access results must name the exact object discrepancy set/i,
"a populated legacy owner requires named owner/non-owner proof even when owner_id is blank");
const exactRestoredRows = { buckets: currentRows.buckets, objects: [archivedMissingRow] };
const exactRestoredDb = {
  async query(sql) {
    if (sql.includes("storage.buckets")) return { rowCount: exactRestoredRows.buckets.length, rows: exactRestoredRows.buckets.map((row) => ({ row })) };
    if (sql.includes("storage.objects")) return { rowCount: exactRestoredRows.objects.length, rows: exactRestoredRows.objects.map((row) => ({ row })) };
    throw new Error(`Unexpected query ${sql}`);
  },
};
const exactRestoredResample = await captureStorageSupportedState({ db: exactRestoredDb, downloadObject: async () => archivedMissingBytes });
assert.doesNotThrow(() => validateStorageOperatorEvidence({
  evidence: missingObjectEvidence,
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: exactRestoredResample,
  reconciliationDisposition: "RESOLVED",
}), "an exact byte-and-row restoration must clear the historical presence discrepancy with named owner-boundary proof");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, owner_access_results: [] },
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","absent.png"]', bucket_id: "private", name: "absent.png",
    field: "user_metadata", support: "supported", expected: null, actual: { prior: true },
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
  reconciliationDisposition: "RESOLVED",
}), /explicit signed ACCEPTED_LOSS/i, "an absent row cannot satisfy a historical field whose expected value happened to be null");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: { ...resample, state: { ...resample.state, object_count: 999 } },
}), /current v2 proof/i, "the current supported-state rows and counts must remain bound by their exact digest");

console.log("DISASTER_RECOVERY_STORAGE_TESTS_PASS");
