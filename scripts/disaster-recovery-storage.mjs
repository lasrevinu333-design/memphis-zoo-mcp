import { createHash } from "node:crypto";
import { stableJson } from "./disaster-recovery-crypto.mjs";

const SYSTEM_BUCKET_FIELDS = new Set(["created_at", "updated_at"]);
const SYSTEM_OBJECT_FIELDS = new Set(["id", "owner", "owner_id", "created_at", "updated_at", "last_accessed_at", "version"]);
export const STORAGE_OPERATOR_EVIDENCE_FORMAT = "memphis-zoo.storage-operator-reconciliation.v2";
export const STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObjectOrNull(value) {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

function isTimestampString(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const maximumDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  return year >= 1 && day >= 1 && day <= maximumDay
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 15 && offsetMinute <= 59
    && (fractionText === undefined || !fractionText.endsWith("0"))
    && !(offsetSign === "-" && offsetHour === 0 && offsetMinute === 0)
    && Number.isFinite(Date.parse(value));
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export function storageOwnerPrincipalId(row) {
  const ownerValues = [row?.owner_id, row?.owner];
  if (ownerValues.some((value) => value != null && typeof value !== "string")) {
    throw new Error("Storage owner_id and legacy owner must be null or strings.");
  }
  const principalIds = [...new Set(ownerValues
    .filter((value) => value != null && value.trim() !== "")
    .map((value) => value.trim()))];
  if (principalIds.length > 1) {
    throw new Error("Storage owner_id and legacy owner must identify one unambiguous principal before backup or reconciliation.");
  }
  return principalIds[0] || null;
}

export function storageObjectArchivePath(bucketId, name) {
  return `storage/objects/${sha256(`${bucketId}\0${name}`)}.bin`;
}

export function validateV4StorageArchiveObjects(objects) {
  if (!Array.isArray(objects)) throw new Error("The v4 Storage object inventory must be an array.");
  const identities = new Set();
  const objectIds = new Set();
  const files = new Set();
  const exactWrapperFields = [
    "id", "bucket_id", "name", "file", "size_bytes", "sha256", "metadata", "user_metadata",
    "version", "created_at", "updated_at", "database_row",
  ].sort();
  for (const object of objects) {
    if (!object || typeof object !== "object" || Array.isArray(object)
        || !object.database_row || typeof object.database_row !== "object" || Array.isArray(object.database_row)) {
      throw new Error("Every v4 Storage object must retain its complete database_row.");
    }
    const row = object.database_row;
    const requiredWrapperFields = exactWrapperFields.filter((field) => field !== "database_row");
    const requiredRowFields = ["id", "bucket_id", "name", "owner_id", "owner", "metadata", "user_metadata", "version", "created_at", "updated_at", "last_accessed_at"];
    if (stableJson(Object.keys(object).sort()) !== stableJson(exactWrapperFields)
        || requiredWrapperFields.some((field) => !Object.hasOwn(object, field))
        || requiredRowFields.some((field) => !Object.hasOwn(row, field))
        || !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 0
        || typeof object.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(object.sha256)) {
      throw new Error("The v4 Storage object inventory is missing its exact row or byte identity.");
    }
    for (const field of ["id", "bucket_id", "name", "metadata", "user_metadata", "version", "created_at", "updated_at"]) {
      if (stableJson(object[field]) !== stableJson(row[field])) {
        throw new Error(`The v4 Storage object wrapper disagrees with database_row.${field}.`);
      }
    }
    if (typeof row.id !== "string" || !row.id.trim()
        || typeof row.bucket_id !== "string" || !row.bucket_id.trim() || row.bucket_id.includes("\0")
        || typeof row.name !== "string" || !row.name.trim() || row.name.includes("\0")
        || !isPlainObjectOrNull(row.metadata) || !isPlainObjectOrNull(row.user_metadata)
        || !(row.version === null || (typeof row.version === "string" && row.version.trim() !== ""))
        || !isTimestampString(row.created_at) || !isTimestampString(row.updated_at)
        || !(row.last_accessed_at === null || isTimestampString(row.last_accessed_at))) {
      throw new Error("The v4 Storage object inventory contains a non-producer-shaped row value or PostgreSQL row_to_json timestamp.");
    }
    for (const field of ["owner_id", "owner"]) {
      if (!(row[field] === null || (typeof row[field] === "string" && row[field].trim() !== ""))) {
        throw new Error("The v4 Storage owner fields must be null or nonblank strings.");
      }
    }
    storageOwnerPrincipalId(row);
    const identity = `${row.bucket_id}\0${row.name}`;
    const expectedFile = storageObjectArchivePath(row.bucket_id, row.name);
    if (typeof object.file !== "string" || object.file !== expectedFile) {
      throw new Error("The v4 Storage object file must equal the deterministic producer archive path for its bucket and name.");
    }
    if (identities.has(identity) || objectIds.has(row.id) || files.has(object.file)) {
      throw new Error("The v4 Storage object inventory contains a duplicate object, database id, or archive file identity.");
    }
    identities.add(identity);
    objectIds.add(row.id);
    files.add(object.file);
  }
  return objects;
}

export function storageBucketOptions(bucket) {
  return definedEntries({
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit == null ? undefined : Number(bucket.file_size_limit),
    allowedMimeTypes: bucket.allowed_mime_types || undefined,
  });
}

export function storageObjectUploadOptions(object) {
  const row = object.database_row || object;
  const metadata = row.metadata || object.metadata || {};
  return definedEntries({
    upsert: true,
    contentType: metadata.mimetype || "application/octet-stream",
    cacheControl: metadata.cacheControl || metadata.cache_control || "0",
    metadata: row.user_metadata ?? object.user_metadata ?? undefined,
  });
}

function difference(scope, key, field, expected, actual, support, identity = {}) {
  return { scope, key, ...identity, field, support, expected: expected ?? null, actual: actual ?? null };
}

export function compareStorageState({ archivedBuckets, archivedObjects, actualBuckets, actualObjects }) {
  const differences = [];
  const bucketById = new Map(actualBuckets.map((bucket) => [String(bucket.id), bucket]));
  const archivedBucketIds = new Set(archivedBuckets.map((bucket) => String(bucket.id)));
  for (const archived of archivedBuckets) {
    const key = String(archived.id);
    const actual = bucketById.get(key);
    if (!actual) {
      differences.push(difference("bucket", key, "presence", true, false, "supported", {
        expected_bucket_row: archived,
      }));
      continue;
    }
    for (const [field, expected] of Object.entries(archived)) {
      if (field === "id") continue;
      if (stableJson(expected) !== stableJson(actual[field])) {
        differences.push(difference("bucket", key, field, expected, actual[field], SYSTEM_BUCKET_FIELDS.has(field) ? "platform_managed" : "supported"));
      }
    }
  }
  for (const actual of actualBuckets) {
    if (!archivedBucketIds.has(String(actual.id))) differences.push(difference("bucket", String(actual.id), "target_only", false, true, "operator_reconciliation"));
  }

  const objectKey = (object) => `${object.bucket_id}\0${object.name}`;
  const objectIdentity = (object) => ({
    key: stableJson([String(object.bucket_id), String(object.name)]),
    bucket_id: String(object.bucket_id),
    name: String(object.name),
  });
  const actualObjectByKey = new Map(actualObjects.map((object) => [objectKey(object), object]));
  const archivedObjectKeys = new Set();
  for (const object of archivedObjects) {
    const archived = object.database_row || object;
    const key = objectKey(archived);
    archivedObjectKeys.add(key);
    const actual = actualObjectByKey.get(key);
    const identity = objectIdentity(archived);
    if (!actual) {
      const { last_accessed_at: _downloadSideEffect, ...expectedObjectRow } = archived;
      differences.push(difference("object", identity.key, "presence", true, false, "supported", {
        ...identity,
        expected_object_row: expectedObjectRow,
        expected_object_sha256: String(object.sha256 || ""),
        expected_object_size_bytes: Number(object.size_bytes),
      }));
      continue;
    }
    for (const [field, expected] of Object.entries(archived)) {
      if (["bucket_id", "name"].includes(field)) continue;
      if (stableJson(expected) !== stableJson(actual[field])) {
        differences.push(difference("object", identity.key, field, expected, actual[field], SYSTEM_OBJECT_FIELDS.has(field) ? "platform_managed_or_owner" : "supported", identity));
      }
    }
    const archivedOwnerPrincipalId = storageOwnerPrincipalId(archived);
    if (archivedOwnerPrincipalId && archivedOwnerPrincipalId === storageOwnerPrincipalId(actual)) {
      differences.push(difference("object", identity.key, "owner_access_boundary", "owner-scoped access test", "not independently exercised", "operator_reconciliation", identity));
    }
  }
  for (const actual of actualObjects) {
    const key = objectKey(actual);
    const identity = objectIdentity(actual);
    if (!archivedObjectKeys.has(key)) differences.push(difference("object", identity.key, "target_only", false, true, "operator_reconciliation", identity));
  }
  return differences;
}

export async function captureStorageSupportedState({ db, downloadObject, observedAt = null }) {
  if (!db || typeof downloadObject !== "function") throw new TypeError("A database and current Storage object downloader are required.");
  const buckets = await db.query("select row_to_json(b) row from storage.buckets b order by b.id");
  const objects = await db.query("select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
  const bucketRows = buckets.rows.map((row) => row.row);
  const objectRows = objects.rows.map((row) => row.row);
  const supportedObjectRows = objectRows.map(({ last_accessed_at: _downloadSideEffect, ...row }) => row);
  const objectByteDigests = [];
  for (const row of objectRows) {
    const bytes = Buffer.from(await downloadObject(String(row.bucket_id), String(row.name)));
    objectByteDigests.push({
      bucket_id: String(row.bucket_id),
      name: String(row.name),
      owner_principal_id: storageOwnerPrincipalId(row),
      size_bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const state = {
    bucket_count: bucketRows.length,
    object_count: objectRows.length,
    bucket_rows: bucketRows,
    object_rows: supportedObjectRows,
    metadata_sha256: sha256(stableJson({ buckets: bucketRows, objects: supportedObjectRows })),
    object_byte_digests: objectByteDigests,
    object_bytes_sha256: sha256(stableJson(objectByteDigests)),
  };
  return {
    format: "memphis-zoo.storage-supported-state-resample.v1",
    observed_at: new Date(observedAt || Date.now()).toISOString(),
    state,
    state_sha256: sha256(stableJson(state)),
  };
}

export function validateStorageOperatorEvidence({
  evidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256,
  discrepancySnapshotSha256,
  supportedStateResample,
  reconciliationDisposition = "RESOLVED",
  requireBindings = false,
  now = Date.now(),
}) {
  const verifiedAt = Date.parse(String(evidence?.verified_at || ""));
  const manifestAt = Date.parse(String(manifestUpdatedAt || ""));
  if (!evidence || evidence.format !== STORAGE_OPERATOR_EVIDENCE_FORMAT
      || String(evidence.verification_method || "").trim().length < 20
      || !Number.isFinite(verifiedAt) || !Number.isFinite(manifestAt)
      || verifiedAt < manifestAt || verifiedAt > now || now - verifiedAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS
      || !["PRESERVED", "ACCEPTED_LOSS", "NOT_APPLICABLE"].includes(evidence.platform_managed_disposition)
      || !supportedStateResample || !/^[0-9a-f]{64}$/.test(String(supportedStateResample.state_sha256 || ""))
      || !Array.isArray(supportedStateResample.state?.bucket_rows)
      || !Array.isArray(supportedStateResample.state?.object_rows)
      || sha256(stableJson(supportedStateResample.state)) !== supportedStateResample.state_sha256) {
    throw new Error("Storage operator evidence must be current v2 proof newer than the exact final manifest.");
  }
  const differences = Array.isArray(discrepancy?.details_json?.discrepancies) ? discrepancy.details_json.discrepancies : [];
  const currentBuckets = new Map(supportedStateResample.state.bucket_rows.map((row) => [String(row.id), row]));
  const currentObjects = new Map(supportedStateResample.state.object_rows.map((row) => [`${row.bucket_id}\0${row.name}`, row]));
  const currentObjectDigests = new Map(supportedStateResample.state.object_byte_digests.map((row) => [`${row.bucket_id}\0${row.name}`, row]));
  function currentRecord(row) {
    return row?.scope === "bucket"
      ? currentBuckets.get(String(row.key || ""))
      : currentObjects.get(`${String(row.bucket_id || "")}\0${String(row.name || "")}`);
  }
  function presenceIdentityIsComplete(row) {
    if (row?.scope === "bucket") {
      return row.expected_bucket_row && typeof row.expected_bucket_row === "object"
        && !Array.isArray(row.expected_bucket_row) && String(row.expected_bucket_row.id) === String(row.key || "");
    }
    return row?.scope === "object"
      && row.expected_object_row && typeof row.expected_object_row === "object" && !Array.isArray(row.expected_object_row)
      && String(row.expected_object_row.bucket_id) === String(row.bucket_id || "")
      && String(row.expected_object_row.name) === String(row.name || "")
      && /^[0-9a-f]{64}$/.test(String(row.expected_object_sha256 || ""))
      && Number.isSafeInteger(row.expected_object_size_bytes) && row.expected_object_size_bytes >= 0;
  }
  function differenceIsResolved(row) {
    const current = currentRecord(row);
    if (row?.field === "presence" && row?.expected === true) {
      if (!current || !presenceIdentityIsComplete(row)) return false;
      if (row.scope === "bucket") return stableJson(current) === stableJson(row.expected_bucket_row);
      const digest = currentObjectDigests.get(`${String(row.bucket_id)}\0${String(row.name)}`);
      return Boolean(digest)
        && stableJson(current) === stableJson(row.expected_object_row)
        && digest.sha256 === row.expected_object_sha256
        && Number(digest.size_bytes) === row.expected_object_size_bytes;
    }
    if (row?.field === "target_only") return !current;
    if (!current || !Object.hasOwn(current, row?.field)) return false;
    return stableJson(current[row.field] ?? null) === stableJson(row?.expected ?? null);
  }
  const valueDifferences = differences.filter((row) => row?.field !== "owner_access_boundary");
  const presenceDifferences = valueDifferences.filter((row) => row?.field === "presence" && row?.expected === true);
  if (presenceDifferences.some((row) => !presenceIdentityIsComplete(row))) {
    throw new Error("A missing archived Storage entry must retain its exact signed row and object byte identity before reconciliation.");
  }
  for (const row of presenceDifferences.filter((item) => item.scope === "object")) {
    storageOwnerPrincipalId(row.expected_object_row);
  }
  const unresolvedDifferences = valueDifferences.filter((row) => !differenceIsResolved(row));
  const replacementOwnerDrift = presenceDifferences.filter((row) => row.scope === "object" && currentRecord(row)).some((row) => {
    const current = currentRecord(row);
    return ["owner_id", "owner"].some((field) => {
      const expectedHasField = Object.hasOwn(row.expected_object_row, field);
      const currentHasField = Object.hasOwn(current, field);
      return expectedHasField !== currentHasField
        || (expectedHasField && stableJson(current[field]) !== stableJson(row.expected_object_row[field]));
    });
  });
  if (unresolvedDifferences.some((row) => row?.scope === "object" && ["owner", "owner_id"].includes(row?.field))) {
    throw new Error("Storage ownership must be restored to the signed archived principal before operator reconciliation can resume admission.");
  }
  if (replacementOwnerDrift) {
    throw new Error("A replacement Storage object must restore the signed archived owner before operator reconciliation can resume admission.");
  }
  if (unresolvedDifferences.length > 0
      && (reconciliationDisposition !== "ACCEPTED_LOSS" || evidence.platform_managed_disposition !== "ACCEPTED_LOSS")) {
    throw new Error("Remaining missing or changed Storage state requires an explicit signed ACCEPTED_LOSS reconciliation and evidence disposition.");
  }
  if (unresolvedDifferences.length === 0
      && (reconciliationDisposition === "ACCEPTED_LOSS" || evidence.platform_managed_disposition === "ACCEPTED_LOSS")) {
    throw new Error("Storage state repaired in the current resample cannot be mislabeled as ACCEPTED_LOSS.");
  }
  const requiredOwnerObjects = differences
    .filter((row) => row?.field === "owner_access_boundary" && row?.scope === "object")
    .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") }))
    .concat(valueDifferences
      .filter((row) => row?.scope === "object" && ["owner", "owner_id"].includes(row?.field)
        && !unresolvedDifferences.includes(row))
      .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") })))
    .concat(valueDifferences
      .filter((row) => row?.scope === "object" && row?.field === "presence" && row?.expected === true
        && Boolean(storageOwnerPrincipalId(currentObjects.get(`${String(row.bucket_id || "")}\0${String(row.name || "")}`))))
      .map((row) => ({ bucket_id: String(row.bucket_id || ""), name: String(row.name || "") })))
    .filter((row, index, rows) => rows.findIndex((item) => item.bucket_id === row.bucket_id && item.name === row.name) === index)
    .sort((a, b) => `${a.bucket_id}\0${a.name}`.localeCompare(`${b.bucket_id}\0${b.name}`));
  if (requiredOwnerObjects.some((row) => !row.bucket_id || !row.name)) {
    throw new Error("Storage owner-boundary discrepancies must persist an exact bucket and object name.");
  }
  const ownerAccessResults = (Array.isArray(evidence.owner_access_results) ? evidence.owner_access_results : []).map((row) => ({
    bucket_id: String(row?.bucket_id || ""),
    name: String(row?.name || ""),
    owner_principal_id: String(row?.owner_principal_id || ""),
    non_owner_principal_id: String(row?.non_owner_principal_id || ""),
    owner_read_succeeded: row?.owner_read_succeeded === true,
    non_owner_read_denied: row?.non_owner_read_denied === true,
    tested_at: new Date(row?.tested_at).toISOString(),
    evidence_reference: String(row?.evidence_reference || "").trim(),
  })).sort((a, b) => `${a.bucket_id}\0${a.name}`.localeCompare(`${b.bucket_id}\0${b.name}`));
  if (stableJson(ownerAccessResults.map(({ bucket_id, name }) => ({ bucket_id, name }))) !== stableJson(requiredOwnerObjects)) {
    throw new Error("Storage owner-access results must name the exact object discrepancy set.");
  }
  for (const result of ownerAccessResults) {
    const testedAt = Date.parse(result.tested_at);
    const currentObject = supportedStateResample.state.object_byte_digests.find((row) => row.bucket_id === result.bucket_id && row.name === result.name);
    const currentObjectRow = currentObjects.get(`${result.bucket_id}\0${result.name}`);
    const currentOwnerPrincipalId = storageOwnerPrincipalId(currentObjectRow);
    if (!currentObject || currentObject.owner_principal_id !== currentOwnerPrincipalId
        || currentOwnerPrincipalId !== result.owner_principal_id
        || !/^[a-zA-Z0-9._@:-]{2,160}$/.test(result.owner_principal_id)
        || !/^[a-zA-Z0-9._@:-]{2,160}$/.test(result.non_owner_principal_id)
        || result.non_owner_principal_id === result.owner_principal_id
        || result.owner_read_succeeded !== true || result.non_owner_read_denied !== true
        || testedAt < manifestAt || testedAt > now || now - testedAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS
        || result.evidence_reference.length < 20 || result.evidence_reference.length > 2000) {
      throw new Error("A current named owner/non-owner access result is required for every owner-boundary object.");
    }
  }
  const bindings = {
    final_manifest_sha256: finalManifestSha256,
    discrepancy_snapshot_sha256: discrepancySnapshotSha256,
    supported_state_resample_sha256: supportedStateResample.state_sha256,
  };
  if (requireBindings && Object.entries(bindings).some(([key, value]) => evidence[key] !== value)) {
    throw new Error("Storage operator evidence is not bound to the exact manifest, discrepancy snapshot, and supported-state resample.");
  }
  const boundAt = requireBindings ? Date.parse(String(evidence.bound_at || "")) : now;
  if (!Number.isFinite(boundAt) || boundAt < Date.parse(supportedStateResample.observed_at)
      || boundAt < verifiedAt || boundAt > now || now - boundAt > STORAGE_OPERATOR_EVIDENCE_MAX_AGE_MS) {
    throw new Error("Storage operator evidence must be bound after the exact supported-state resample and remain current.");
  }
  return {
    format: STORAGE_OPERATOR_EVIDENCE_FORMAT,
    verification_method: String(evidence.verification_method).trim(),
    verified_at: new Date(verifiedAt).toISOString(),
    platform_managed_disposition: evidence.platform_managed_disposition,
    owner_access_results: ownerAccessResults,
    bound_at: new Date(boundAt).toISOString(),
    ...bindings,
  };
}
