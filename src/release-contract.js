import assert from "node:assert/strict";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PAIR_KEYS = ["artifact", "backend_commit_sha", "frontend_commit_sha", "release_id"];

export function assertExactReleasePair(input) {
  assert.ok(input && typeof input === "object" && !Array.isArray(input), "release pair input must be an object");
  assert.deepEqual(Object.keys(input).sort(), PAIR_KEYS, "release pair input has an unexpected shape");
  assert.equal(input.artifact, "memphis-zoo-integrated-release-pair.v1");
  assert.match(String(input.release_id || ""), /^release-[a-z0-9.-]+$/);
  assert.match(String(input.backend_commit_sha || ""), COMMIT, "release pair backend commit is invalid");
  assert.match(String(input.frontend_commit_sha || ""), COMMIT, "release pair frontend commit is invalid");
  return Object.freeze({ ...input });
}

export function assertObservedSchemaIdentity(identity, expectedFingerprint) {
  assert.match(String(expectedFingerprint || ""), FINGERPRINT, "canonical schema target fingerprint is invalid");
  assert.equal(identity?.observation, "connected_database_catalog.v1", "production schema identity was not observed from the connected database");
  assert.match(String(identity?.fingerprint || ""), FINGERPRINT, "observed production schema fingerprint is invalid");
  assert.equal(identity.fingerprint, expectedFingerprint, "observed production schema fingerprint does not equal the canonical target");
  return identity.fingerprint;
}

export function assertManifestContract(manifest, expected) {
  assert.deepEqual(manifest?.api_contract_versions, expected.api_contract_versions,
    "api_contract_versions must equal the release's canonical contract");
  assert.deepEqual(manifest?.queue_compatibility_versions, expected.queue_compatibility_versions,
    "queue_compatibility_versions must equal the release's canonical contract");
  assert.deepEqual(manifest?.minimum_supported, expected.minimum_supported,
    "minimum_supported must equal the release's canonical minimum versions");
  return true;
}
