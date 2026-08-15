import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ATTESTATION_KEYS = [
  "artifact",
  "backend_commit_sha",
  "backend_evidence_blob_sha",
  "backend_evidence_sha256",
  "backend_tree_sha",
  "frontend_commit_sha",
  "release_id",
  "schema_fingerprint",
  "signature",
];
const SIGNED_PAYLOAD_KEYS = ATTESTATION_KEYS.filter((key) => key !== "signature");

export function releaseAttestationPayload(input) {
  return Object.fromEntries(SIGNED_PAYLOAD_KEYS.map((key) => [key, input?.[key]]));
}

export function assertExactReleaseAttestation(input, { publicKeyPem } = {}) {
  assert.ok(input && typeof input === "object" && !Array.isArray(input), "release attestation input must be an object");
  assert.deepEqual(Object.keys(input).sort(), ATTESTATION_KEYS, "release attestation input has an unexpected shape");
  assert.equal(input.artifact, "memphis-zoo-integrated-release-attestation.v2");
  assert.match(String(input.release_id || ""), /^release-[a-z0-9.-]+$/);
  assert.match(String(input.backend_commit_sha || ""), COMMIT, "release attestation backend commit is invalid");
  assert.match(String(input.backend_tree_sha || ""), COMMIT, "release attestation backend tree is invalid");
  assert.match(String(input.backend_evidence_blob_sha || ""), COMMIT, "release attestation evidence blob is invalid");
  assert.match(String(input.backend_evidence_sha256 || ""), FINGERPRINT, "release attestation evidence digest is invalid");
  assert.match(String(input.frontend_commit_sha || ""), COMMIT, "release attestation frontend commit is invalid");
  assert.match(String(input.schema_fingerprint || ""), FINGERPRINT, "release attestation schema fingerprint is invalid");
  assert.deepEqual(Object.keys(input.signature || {}).sort(), ["algorithm", "key_id", "value_base64"]);
  assert.equal(input.signature.algorithm, "ed25519");
  assert.match(String(input.signature.key_id || ""), /^[a-z0-9][a-z0-9._-]{2,63}$/);
  assert.match(String(input.signature.value_base64 || ""), /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(String(publicKeyPem || "").trim(), "release attestation public key is required");
  const payload = Buffer.from(`${JSON.stringify(releaseAttestationPayload(input))}\n`, "utf8");
  const signature = Buffer.from(input.signature.value_base64, "base64");
  assert.equal(signature.length, 64, "release attestation signature must be one Ed25519 signature");
  assert.equal(verify(null, payload, createPublicKey(publicKeyPem), signature), true,
    "release attestation signature is invalid");
  return Object.freeze({ ...input });
}

// Retained as a source-compatible alias while all callers move to the v2 name.
export const assertExactReleasePair = assertExactReleaseAttestation;

export function assertObservedSchemaIdentity(identity, expectedFingerprint) {
  assert.match(String(expectedFingerprint || ""), FINGERPRINT, "canonical schema target fingerprint is invalid");
  assert.equal(identity?.observation, "connected_database_catalog.v1", "production schema identity was not observed from the connected database");
  assert.match(String(identity?.fingerprint || ""), FINGERPRINT, "observed production schema fingerprint is invalid");
  assert.equal(identity.fingerprint, expectedFingerprint, "observed production schema fingerprint does not equal the canonical target");
  return identity.fingerprint;
}

export function assertManifestContract(manifest, expected) {
  assert.equal(manifest?.release_id, expected.release_id,
    "release_id must equal the source-controlled release identity");
  assert.deepEqual(manifest?.api_contract_versions, expected.api_contract_versions,
    "api_contract_versions must equal the release's canonical contract");
  assert.deepEqual(manifest?.queue_compatibility_versions, expected.queue_compatibility_versions,
    "queue_compatibility_versions must equal the release's canonical contract");
  assert.deepEqual(manifest?.minimum_supported, expected.minimum_supported,
    "minimum_supported must equal the release's canonical minimum versions");
  return true;
}

export function assertFrontendReleaseIdentity(manifest, expected) {
  assert.equal(manifest?.frontend_commit_sha, expected.frontend_commit_sha,
    "frontend_commit_sha must equal the source-controlled frontend identity");
  if (expected.frontend_tree_sha) {
    assert.equal(manifest?.frontend_tree_sha, expected.frontend_tree_sha,
      "frontend_tree_sha must equal the source-controlled frontend tree identity");
  }
  return true;
}

export function assertFrontendReleaseDeclaration(manifest) {
  assert.equal(manifest?.frontend_commit_sha_source, "exact-release-pair-input-and-github-pages-deployment-commit",
    "frontend release manifest must delegate its self-referential commit identity to the signed attestation and Pages deployment manifest");
  assert.match(String(manifest?.audited_start_commit || ""), COMMIT, "frontend audited start commit is invalid");
  assert.ok(manifest?.asset_hashes_sha256 && typeof manifest.asset_hashes_sha256 === "object" && !Array.isArray(manifest.asset_hashes_sha256),
    "frontend release manifest must bind its runtime asset hashes");
  assert.ok(Object.keys(manifest.asset_hashes_sha256).length >= 50, "frontend release asset inventory is incomplete");
  for (const digest of Object.values(manifest.asset_hashes_sha256)) assert.match(String(digest), FINGERPRINT, "frontend runtime asset digest is invalid");
  return true;
}

export function assertBackendFrontendIdentity(manifest, expected) {
  assert.equal(manifest?.frontend?.commit_sha, expected.frontend_commit_sha,
    "backend embedded frontend commit must equal the source-controlled frontend identity");
  if (expected.frontend_tree_sha) {
    assert.equal(manifest?.frontend?.tree_sha, expected.frontend_tree_sha,
      "backend embedded frontend tree must equal the source-controlled frontend tree identity");
  }
  return true;
}
