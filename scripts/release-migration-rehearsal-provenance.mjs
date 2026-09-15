const GITHUB_REPOSITORY = "lasrevinu333-design/memphis-zoo-mcp";
const GITHUB_WORKFLOW_PREFIX = `${GITHUB_REPOSITORY}/.github/workflows/production-backup-migration-rehearsal.yml@`;
export const TASK_LOCAL_PROVENANCE_KIND = "task-local";
export const TASK_LOCAL_RUNNER_PATH = "scripts/run-production-backup-migration-rehearsal.sh";

const githubFields = ["repository", "workflow_ref", "workflow_sha", "run_id", "run_attempt"];
const taskLocalExclusiveFields = [
  "provenance_kind",
  "local_execution_id",
  "candidate_commit",
  "candidate_tree",
  "archive_digest",
  "runner_path",
  "runner_sha256",
  "archive_local_only",
  "external_uploads",
];
const taskLocalAuthorizationFieldNames = [
  ...taskLocalExclusiveFields,
  "result_sha256",
  "attested_at",
  "active_mutation_leases",
  "expired_mutation_leases",
  "authority_health",
  "direct_dml_denied",
  "live_production_reads",
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function requireAbsent(value, fields, label) {
  const mixed = fields.filter((field) => hasOwn(value, field));
  if (mixed.length) throw new Error(`${label} mixes mutually exclusive provenance fields: ${mixed.join(", ")}.`);
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ""));
}

function validGitIdentity(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ""));
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function validateGithub(value, candidateCommit, label) {
  requireAbsent(value, taskLocalExclusiveFields, label);
  if (value?.repository !== GITHUB_REPOSITORY
      || !String(value?.workflow_ref || "").startsWith(GITHUB_WORKFLOW_PREFIX)
      || value?.workflow_sha !== candidateCommit
      || !/^[1-9][0-9]*$/.test(String(value?.run_id || ""))
      || !/^[1-9][0-9]*$/.test(String(value?.run_attempt || ""))) {
    throw new Error(`${label} does not contain the exact GitHub Actions rehearsal provenance.`);
  }
  return "github-actions";
}

function validateTaskLocal(value, { candidateCommit, candidateTree, archiveDigest, resultSha256, runnerSha256 }, label) {
  requireAbsent(value, githubFields, label);
  if (value?.provenance_kind !== TASK_LOCAL_PROVENANCE_KIND
      || !validUuid(value?.local_execution_id)
      || !validGitIdentity(value?.candidate_commit)
      || !validGitIdentity(value?.candidate_tree)
      || value.candidate_commit !== candidateCommit
      || value.candidate_tree !== candidateTree
      || !validSha256(value?.archive_digest)
      || (archiveDigest && value.archive_digest !== archiveDigest)
      || !validSha256(value?.result_sha256)
      || (resultSha256 && value.result_sha256 !== resultSha256)
      || value?.runner_path !== TASK_LOCAL_RUNNER_PATH
      || !validSha256(value?.runner_sha256)
      || (runnerSha256 && value.runner_sha256 !== runnerSha256)
      || Number(value?.active_mutation_leases) !== 0
      || Number(value?.expired_mutation_leases) !== 0
      || value?.authority_health !== true
      || value?.direct_dml_denied !== true
      || Number(value?.live_production_reads) !== 0
      || value?.archive_local_only !== true
      || Number(value?.external_uploads) !== 0) {
    throw new Error(`${label} does not contain exact task-local rehearsal provenance.`);
  }
  return TASK_LOCAL_PROVENANCE_KIND;
}

export function validateRehearsalAttestationProvenance(attestation, expected) {
  const kind = attestation?.provenance_kind;
  if (kind === undefined) return validateGithub(attestation, expected.candidateCommit, "Rehearsal attestation");
  if (kind === TASK_LOCAL_PROVENANCE_KIND) {
    return validateTaskLocal(attestation, expected, "Rehearsal attestation");
  }
  throw new Error(`Unsupported rehearsal provenance kind: ${String(kind || "<empty>")}.`);
}

export function validateAuthorizationRehearsalProvenance(rehearsal, expected) {
  const kind = rehearsal?.provenance_kind;
  if (kind === undefined) return validateGithub(rehearsal, expected.candidateCommit, "Release migration authorization");
  if (kind === TASK_LOCAL_PROVENANCE_KIND) {
    return validateTaskLocal(rehearsal, expected, "Release migration authorization");
  }
  throw new Error(`Unsupported release migration authorization provenance kind: ${String(kind || "<empty>")}.`);
}

export function taskLocalAuthorizationFields(attestation) {
  return Object.fromEntries(taskLocalAuthorizationFieldNames.map((field) => [field, attestation[field]]));
}

export function githubAuthorizationFields(attestation) {
  return Object.fromEntries(githubFields.map((field) => [field, attestation[field]]));
}
