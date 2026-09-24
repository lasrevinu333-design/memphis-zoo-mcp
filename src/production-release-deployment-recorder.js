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
function occurrenceTimestamp(value, nullable = false) {
  if (nullable && value == null) return null;
  // SQL reads use UTC text with all six PostgreSQL fractional digits. Never
  // round a TIMESTAMPTZ occurrence through JavaScript Date parsing.
  const raw = value instanceof Date ? value.toISOString() : text(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/);
  if (!match) throw new Error('Release occurrence timestamp must be exact UTC text.');
  return `${match[1]}.${(match[2] || '').padEnd(6, '0')}Z`;
}
export function releaseOccurrenceSummary(row) {
  if (!row) return null;
  if (!row.details_json || typeof row.details_json !== 'object' || Array.isArray(row.details_json)) {
    throw new Error('Release occurrence provenance must be an object.');
  }
  return { ...releaseIdentitySummary(row), details_json: JSON.parse(stableJson(row.details_json)),
    created_at: occurrenceTimestamp(row.created_at), deployed_at: occurrenceTimestamp(row.deployed_at, true) };
}
export function sameReleaseOccurrence(left, right) {
  return stableJson(releaseOccurrenceSummary(left)) === stableJson(releaseOccurrenceSummary(right));
}
export function archivedReleaseId(row) {
  const summary = releaseOccurrenceSummary(row);
  if (!summary?.release_id || !/^[0-9a-f]{40}$/.test(summary.backend_commit)) {
    throw new Error("Existing release identity cannot be archived safely.");
  }
  return `${summary.release_id}-history-v2-${sha256(stableJson(summary))}`;
}
export function archivedReleaseRecord(row) {
  const occurrence = releaseOccurrenceSummary(row);
  return { ...occurrence, release_id: archivedReleaseId(row), status: 'retired',
    details_json: { ...occurrence.details_json, recorder_archive: {
      format: 'memphis-zoo.release-occurrence.v2', original: occurrence,
    } } };
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
  const currentSummary = releaseOccurrenceSummary(currentBase);
  // Even a same-code redeployment is a new occurrence with new provenance.
  const archive_release_id = currentSummary ? archivedReleaseId(currentBase) : null;
  const prior_deployed_releases = otherDeployed.map((row) => {
    const identity = releaseIdentitySummary(row);
    if (!identity?.release_id || identity.status !== "deployed") {
      throw new Error("Every superseded production identity must be an exact deployed release.");
    }
    return { identity, occurrence: releaseOccurrenceSummary(row), archive_release_id: archivedReleaseId(row) };
  }).filter((item) => item.identity.release_id !== targetSummary.release_id)
    .sort((left, right) => left.identity.release_id.localeCompare(right.identity.release_id));
  const prior_deployed_release_ids = prior_deployed_releases.map((item) => item.identity.release_id);
  const binding = {
    format: "memphis-zoo.production-release-recording-plan.v2",
    current_base: currentSummary,
    archive_release_id,
    prior_deployed_release_ids,
    prior_deployed_releases,
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
