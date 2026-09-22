import { createHash } from "node:crypto";
import { stableJson } from "../scripts/disaster-recovery-crypto.mjs";

function text(value) { return String(value ?? "").trim(); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export function migrationManifestSha256(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) throw new Error("Migration manifest is required.");
  for (const item of migrations) {
    if (!item || !/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(text(item.file))
        || !/^[0-9a-f]{64}$/.test(text(item.sha256))) throw new Error("Migration manifest entry is malformed.");
  }
  return sha256(stableJson(migrations));
}

export function releaseIdentitySummary(row) {
  if (!row) return null;
  return {
    release_id: text(row.release_id), backend_commit: text(row.backend_commit).toLowerCase(),
    frontend_commit: text(row.frontend_commit).toLowerCase(), migration_head: text(row.migration_head),
    migration_manifest_sha256: text(row.migration_manifest_sha256).toLowerCase(),
    environment_contract_version: text(row.environment_contract_version), status: text(row.status),
  };
}

export function sameReleaseIdentity(left, right) {
  return stableJson(releaseIdentitySummary(left)) === stableJson(releaseIdentitySummary(right));
}
export function archivedReleaseId(row) {
  const summary = releaseIdentitySummary(row);
  if (!summary?.release_id || !/^[0-9a-f]{40}$/.test(summary.backend_commit)) {
    throw new Error("Existing release identity cannot be archived safely.");
  }
  return `${summary.release_id}-history-${sha256(stableJson(summary)).slice(0, 12)}`;
}

function stableLiveIdentity(liveCheck, target) {
  if (liveCheck?.ok !== true || liveCheck.release_id !== target.release_id
      || liveCheck.backend_commit_sha !== target.backend_commit
      || liveCheck.frontend_commit_sha !== target.frontend_commit) {
    throw new Error("Live release alignment does not match the recording target.");
  }
  for (const [field, length] of [["backend_tree_sha", 40], ["backend_evidence_sha256", 64],
    ["observed_production_schema_fingerprint", 64]]) {
    if (!new RegExp(`^[0-9a-f]{${length}}$`).test(text(liveCheck[field]))) {
      throw new Error(`Live release identity field ${field} is missing or malformed.`);
    }
  }
  return Object.fromEntries(["release_id", "backend_commit_sha", "backend_tree_sha",
    "backend_evidence_sha256", "frontend_commit_sha", "observed_production_schema_fingerprint",
    "schema_alignment_mode", "schema_transition_id"].map(key => [key, liveCheck[key] ?? null]));
}
function stableWorkflowIdentity(provenance, target) {
  if (provenance?.kind !== "github-actions" || !text(provenance.repository)
      || provenance.workflow_sha !== target.backend_commit
      || !/^[1-9][0-9]*$/.test(text(provenance.run_id))
      || !/^[1-9][0-9]*$/.test(text(provenance.run_attempt)) || !text(provenance.actor)) {
    throw new Error("Recorder workflow provenance does not match the recording target.");
  }
  return { kind: provenance.kind, repository: provenance.repository, workflow_sha: provenance.workflow_sha };
}

export function buildRecordingPlan({ currentBase, otherDeployed = [], target, liveCheck, provenance, runtimeConfigurationSha256 }) {
  const targetSummary = releaseIdentitySummary(target);
  if (!targetSummary || targetSummary.status !== "deployed") throw new Error("Target deployed release identity is required.");
  if (!/^[0-9a-f]{64}$/.test(text(runtimeConfigurationSha256))) throw new Error("Runtime configuration digest is required.");
  const currentSummary = releaseIdentitySummary(currentBase);
  const archive_release_id = currentSummary && !sameReleaseIdentity(currentSummary, targetSummary)
    ? archivedReleaseId(currentSummary) : null;
  const prior_deployed_release_ids = otherDeployed.map((row) => text(row.release_id))
    .filter((releaseId) => releaseId && releaseId !== targetSummary.release_id).sort();
  const binding = {
    format: "memphis-zoo.production-release-recording-plan.v1",
    current_base: currentSummary,
    archive_release_id,
    prior_deployed_release_ids,
    target: targetSummary,
    live_identity: stableLiveIdentity(liveCheck, targetSummary),
    workflow_identity: stableWorkflowIdentity(provenance, targetSummary),
    runtime_configuration_sha256: text(runtimeConfigurationSha256),
  };
  // Plan and apply are different workflow runs. Bind release facts, not the
  // run ID, actor, network latency or queue depth. Every phase still reruns
  // the unchanged live gates; retain its full evidence outside the plan hash.
  return { ...binding, live_check: liveCheck, provenance,
    plan_sha256: sha256(stableJson(binding)) };
}
