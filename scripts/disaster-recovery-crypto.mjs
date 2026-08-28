import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stable(value));
}

export function stableJsonFile(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function stableJsonFileSha256(value) {
  return createHash("sha256").update(stableJsonFile(value)).digest("hex");
}

export function requireSigningKey(value, name) {
  const key = String(value || "");
  if (Buffer.byteLength(key, "utf8") < 32) throw new Error(`${name} must contain at least 32 bytes.`);
  return key;
}

export function signBinding(binding, key) {
  return createHmac("sha256", key).update(stableJson(binding)).digest("hex");
}

export function verifyBinding(binding, signature, key) {
  const expected = Buffer.from(signBinding(binding, key), "hex");
  let provided;
  try { provided = Buffer.from(String(signature || ""), "hex"); } catch { return false; }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function archiveSignatureBinding({ archiveDigest, projectRef, sourceIdentity, archiveFormat = "memphis-zoo-disaster-recovery.v3" }) {
  return {
    purpose: "memphis-zoo-disaster-recovery-archive",
    format: archiveFormat,
    archive_digest: archiveDigest,
    project_ref: projectRef,
    source_identity: sourceIdentity,
  };
}

export function restoreIntentBinding(intent) {
  return {
    purpose: "memphis-zoo-production-restore-intent",
    format: "memphis-zoo-production-restore-intent.v1",
    ...intent,
  };
}

export function restoreReconciliationBinding(intent) {
  return {
    purpose: "memphis-zoo-production-restore-reconciliation",
    format: "memphis-zoo-production-restore-reconciliation.v1",
    ...intent,
  };
}

export function abandonedMutationLeaseReconciliationBinding(intent) {
  return {
    purpose: "memphis-zoo-abandoned-mutation-lease-reconciliation",
    format: "memphis-zoo-abandoned-mutation-lease-reconciliation.v1",
    ...intent,
  };
}

export function releaseMigrationAuthorizationBinding(intent) {
  return {
    purpose: "memphis-zoo-release-migration-authorization",
    format: "memphis-zoo-release-migration-authorization.v1",
    ...intent,
  };
}

export function releaseMigrationRehearsalAttestationBinding(attestation) {
  return {
    purpose: "memphis-zoo-release-migration-rehearsal-attestation",
    format: "memphis-zoo-release-migration-rehearsal-attestation.v1",
    ...attestation,
  };
}
