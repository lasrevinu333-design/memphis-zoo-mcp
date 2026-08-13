import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  const canonicalContracts = {
    api_contract_versions: releaseInput.api_contract_versions,
    queue_compatibility_versions: releaseInput.queue_compatibility_versions,
    minimum_supported: releaseInput.minimum_supported,
  };

  return {
    release_id: String(process.env.MEMPHIS_RELEASE_ID || releaseInput.release_id || appVersion || releaseId || "").trim(),
    ...schemaTransitionFields(frontendManifest),
    backend: {
      commit_sha: String(
        process.env.RENDER_GIT_COMMIT
          || process.env.BACKEND_COMMIT_SHA
          || process.env.GIT_COMMIT
          || process.env.SOURCE_VERSION
          || "unknown",
      ),
      app_version: appVersion,
      runtime_release_id: releaseId,
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
