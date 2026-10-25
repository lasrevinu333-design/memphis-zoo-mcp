import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";

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
  if (typeof signature !== "string" || signature.length !== 64 || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signBinding(binding, key), "hex");
  let provided;
  try { provided = Buffer.from(signature, "hex"); } catch { return false; }
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

/** Metadata-only original capture. Signature integrity is NOT source/target,
 * actor, expiry, generation, SQL admission, or operational permission.
 * Never passes caller objects to stableJson/restoreIntentBinding/verifyBinding.
 * This is not a ROW JSON text decoder and does not normalize archived DATA. */
export function captureVerifiedOriginalRestoreIntent(envelope, verificationKey, expectedKeyId) {
  try {
    if (typeof verificationKey !== "string" || verificationKey.length > 65536
      || Buffer.byteLength(verificationKey, "utf8") < 32 || Buffer.byteLength(verificationKey, "utf8") > 65536
      || typeof expectedKeyId !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(expectedKeyId)) throw originalIntentCaptureFailure();
    const original = captureOriginalIntentData(envelope);
    if (!original || typeof original !== "object" || Array.isArray(original)
      || Object.keys(original).sort().join("|") !== "algorithm|format|intent|key_id|signature"
      || original.format !== "memphis-zoo-production-restore-intent.v1" || original.algorithm !== "hmac-sha256"
      || original.key_id !== expectedKeyId || typeof original.signature !== "string" || !/^[a-f0-9]{64}$/.test(original.signature)
      || !original.intent || typeof original.intent !== "object" || Array.isArray(original.intent)
      // The actual v1 producer has no binding-purpose overrides in its DTO.
      || Object.hasOwn(original.intent, "purpose") || Object.hasOwn(original.intent, "format")) throw originalIntentCaptureFailure();
    const binding = restoreIntentBinding(original.intent);
    if (Buffer.byteLength(stableJson(binding), "utf8") > 1048576
      || !verifyBinding(binding, original.signature, verificationKey)) throw originalIntentCaptureFailure();
    return original.intent;
  } catch {
    // No attacker messages, signing key, signature, or observable cause.
    throw originalIntentCaptureFailure();
  }
}

function captureOriginalIntentData(root) {
  const active = new WeakSet();
  let nodes = 0, stringBytes = 0;
  const text = value => {
    if (value.length > 1048576) throw originalIntentCaptureFailure();
    stringBytes += Buffer.byteLength(value, "utf8");
    if (stringBytes > 1048576) throw originalIntentCaptureFailure();
  };
  const copy = (value, depth) => {
    if (++nodes > 16384 || depth > 32) throw originalIntentCaptureFailure();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { text(value); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw originalIntentCaptureFailure();
      return value; // Preserve original finite JS numeric value, including -0.
    }
    if (typeof value !== "object" || isProxy(value)) throw originalIntentCaptureFailure();
    // isProxy is checked BEFORE any prototype/key/descriptor reflection.
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype)
      || Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")
      || (array && Object.getOwnPropertyDescriptor(Array.prototype, "toJSON"))
      || active.has(value)) throw originalIntentCaptureFailure();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 16384 || keys.some(key => typeof key !== "string" || key === "toJSON")) throw originalIntentCaptureFailure();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const captured = array ? [] : {};
    active.add(value);
    try {
      let length = 0;
      if (array) {
        const descriptor = descriptors.length;
        if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== false
          || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0 || descriptor.value > 16383) throw originalIntentCaptureFailure();
        length = descriptor.value;
        if (keys.length !== length + 1) throw originalIntentCaptureFailure();
      }
      for (const key of keys) {
        if (array && key === "length") continue;
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) throw originalIntentCaptureFailure();
        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) throw originalIntentCaptureFailure();
        text(key);
        // Define DATA even for '__proto__'; never invoke a prototype setter.
        Object.defineProperty(captured, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return Object.freeze(captured);
    } finally { active.delete(value); }
  };
  return copy(root, 0);
}

function originalIntentCaptureFailure() {
  return Object.assign(new TypeError("original_restore_intent_capture_invalid"), { code: "original_restore_intent_capture_invalid" });
}
