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

export function buildReleaseManifest({ appVersion, releaseId, contracts = {} } = {}) {
  const canonicalFingerprintPath = join(repoRoot, "supabase/canonical/schema-fingerprint.txt");
  const frontendManifestPath = join(repoRoot, "release/frontend-release-manifest.json");
  const frontendManifest = existsSync(frontendManifestPath)
    ? JSON.parse(readText(frontendManifestPath, "{}"))
    : null;

  return {
    release_id: String(process.env.MEMPHIS_RELEASE_ID || appVersion || releaseId || "").trim(),
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
      commit_sha: String(process.env.FRONTEND_COMMIT_SHA || frontendManifest?.frontend_commit_sha || "unknown"),
      manifest: frontendManifest,
    },
    schema: {
      fingerprint: readText(canonicalFingerprintPath).trim() || "unknown",
      fingerprint_file: "supabase/canonical/schema-fingerprint.txt",
      migrations: listSqlFiles(join(repoRoot, "supabase/migrations")),
    },
    api_contract_versions: contracts,
    queue_compatibility_versions: {
      scan: ["legacy-local-storage", "indexeddb-v1", "indexeddb-v2", "indexeddb-v3", "indexeddb-v4"],
      messaging: ["local-storage-outbox-v1"],
      gemini_console: ["indexeddb-outbox-v1"],
    },
    minimum_supported: {
      frontend_version: "release-2026.07.18.custodial-v3.7",
      backend_version: "release-2026.07.18.custodial-v3.7",
    },
    build_time: String(process.env.BUILD_TIME || process.env.RENDER_BUILD_TIMESTAMP || "source-controlled"),
  };
}
