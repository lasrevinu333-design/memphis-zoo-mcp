import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assertExactReleaseAttestation } from "./release-contract.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readText(path, fallback = "") {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readText(path)); } catch { return fallback; }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function configuredReleaseAttestation() {
  const value = String(process.env.MEMPHIS_RELEASE_ATTESTATION_JSON || "").trim();
  if (!value) return null;
  const publicKeyPem = String(process.env.MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY || "").replaceAll("\\n", "\n").trim();
  return assertExactReleaseAttestation(readJsonFromText(value), { publicKeyPem: `${publicKeyPem}\n` });
}

export function releaseAttestationRequired(env = process.env) {
  return env.NODE_ENV === "production" && /^(1|true|yes)$/i.test(String(env.RENDER || ""));
}

export function assertConfiguredReleaseIdentity({ required = releaseAttestationRequired() } = {}) {
  const attestation = configuredReleaseAttestation();
  if (!attestation) {
    if (required) throw new Error("The signed integrated release attestation is required in production.");
    return null;
  }
  const releaseInput = readJson(join(repoRoot, "release/schema-alignment-input.json"), {});
  const frontendManifest = readJson(join(repoRoot, "release/frontend-release-manifest.json"), {});
  const schemaFingerprint = readText(join(repoRoot, "supabase/canonical/schema-fingerprint.txt")).trim();
  const evidenceBytes = readFileSync(join(repoRoot, "release/integrated-backend-authority-evidence.json"));
  const deploymentCommit = String(
    process.env.RENDER_GIT_COMMIT
      || process.env.BACKEND_COMMIT_SHA
      || process.env.GIT_COMMIT
      || process.env.SOURCE_VERSION
      || "unknown",
  ).trim();
  if (deploymentCommit !== "unknown" && deploymentCommit !== attestation.backend_commit_sha) {
    throw new Error("The deployed backend commit does not equal the signed release attestation.");
  }
  if (releaseInput.release_id !== attestation.release_id) throw new Error("The source release ID does not equal the signed release attestation.");
  if (frontendManifest.frontend_commit_sha !== attestation.frontend_commit_sha) throw new Error("The embedded frontend commit does not equal the signed release attestation.");
  if (schemaFingerprint !== attestation.schema_fingerprint) throw new Error("The canonical schema fingerprint does not equal the signed release attestation.");
  if (createHash("sha256").update(evidenceBytes).digest("hex") !== attestation.backend_evidence_sha256) {
    throw new Error("The backend evidence digest does not equal the signed release attestation.");
  }
  if (gitBlobSha1(evidenceBytes) !== attestation.backend_evidence_blob_sha) {
    throw new Error("The backend evidence blob does not equal the signed release attestation.");
  }
  return attestation;
}

function listSqlFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => {
        const path = join(dir, name);
        return {
          file: relative(repoRoot, path),
          sha256: sha256File(path),
        };
      });
  } catch {
    return [];
  }
}

export function schemaTransitionFields(frontendManifest) {
  return frontendManifest?.schema_transition
    ? { schema_transition: frontendManifest.schema_transition }
    : {};
}

export function buildReleaseManifest({ appVersion, releaseId, contracts = {} } = {}) {
  const canonicalFingerprintPath = join(repoRoot, "supabase/canonical/schema-fingerprint.txt");
  const releaseInputPath = join(repoRoot, "release/schema-alignment-input.json");
  const frontendManifestPath = join(repoRoot, "release/frontend-release-manifest.json");
  const releaseInput = readJson(releaseInputPath, {});
  const frontendManifest = existsSync(frontendManifestPath) ? readJson(frontendManifestPath, {}) : null;
  const evidencePath = join(repoRoot, "release/integrated-backend-authority-evidence.json");
  const evidenceBytes = readFileSync(evidencePath);
  const configuredAttestation = assertConfiguredReleaseIdentity();
  const canonicalContracts = {
    api_contract_versions: releaseInput.api_contract_versions,
    queue_compatibility_versions: releaseInput.queue_compatibility_versions,
    minimum_supported: releaseInput.minimum_supported,
  };

  return {
    release_id: String(releaseInput.release_id || appVersion || releaseId || "").trim(),
    ...schemaTransitionFields(frontendManifest),
    backend: {
      commit_sha: String(
        process.env.RENDER_GIT_COMMIT
          || process.env.BACKEND_COMMIT_SHA
          || process.env.GIT_COMMIT
          || process.env.SOURCE_VERSION
          || "unknown",
      ),
      tree_sha: configuredAttestation?.backend_tree_sha || null,
      app_version: appVersion,
      runtime_release_id: releaseId,
      evidence: {
        path: "release/integrated-backend-authority-evidence.json",
        sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
        git_blob_sha: gitBlobSha1(evidenceBytes),
      },
    },
    frontend: {
      // This source tree intentionally contains no guessed final frontend.
      // The live gate accepts a caller-supplied exact pair only after rebind.
      commit_sha: frontendManifest?.frontend_commit_sha || null,
      pair_state: frontendManifest?.frontend_commit_state || "final_rebind_required",
      manifest: frontendManifest,
    },
    schema: {
      fingerprint: readText(canonicalFingerprintPath).trim() || "unknown",
      fingerprint_file: "supabase/canonical/schema-fingerprint.txt",
      migrations: listSqlFiles(join(repoRoot, "supabase/migrations")),
    },
    api_contract_versions: canonicalContracts.api_contract_versions,
    queue_compatibility_versions: canonicalContracts.queue_compatibility_versions,
    minimum_supported: canonicalContracts.minimum_supported,
    runtime_contracts: contracts,
    build_time: String(process.env.BUILD_TIME || process.env.RENDER_BUILD_TIMESTAMP || "source-controlled"),
  };
}

function readJsonFromText(value) {
  try { return JSON.parse(String(value || "")); } catch { return null; }
}
