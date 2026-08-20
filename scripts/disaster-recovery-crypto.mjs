import { createHmac, timingSafeEqual } from "node:crypto";

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

export function archiveSignatureBinding({ archiveDigest, projectRef, sourceIdentity }) {
  return {
    purpose: "memphis-zoo-disaster-recovery-archive",
    format: "memphis-zoo-disaster-recovery.v3",
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
