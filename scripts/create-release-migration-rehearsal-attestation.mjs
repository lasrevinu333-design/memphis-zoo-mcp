#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  releaseMigrationRehearsalAttestationBinding,
  requireSigningKey,
  signBinding,
  stableJson,
} from "./disaster-recovery-crypto.mjs";
import { parseJsonValueStream } from "./json-value-stream.mjs";
import {
  TASK_LOCAL_PROVENANCE_KIND,
  TASK_LOCAL_RUNNER_PATH,
  validateRehearsalAttestationProvenance,
} from "./release-migration-rehearsal-provenance.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const receiptPath = resolve(String(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT || ""));
const key = requireSigningKey(process.env.RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY, "RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY");
const keyId = String(process.env.RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const workflowRef = String(process.env.GITHUB_WORKFLOW_REF || "").trim();
const workflowSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
const runId = String(process.env.GITHUB_RUN_ID || "").trim();
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();
const provenanceKind = String(process.env.RELEASE_REHEARSAL_PROVENANCE_KIND || "github-actions").trim();
const localExecutionId = String(process.env.RELEASE_REHEARSAL_LOCAL_EXECUTION_ID || "").trim();
const candidateCommit = String(process.env.RELEASE_MIGRATION_CANDIDATE_COMMIT || "").trim().toLowerCase();
const candidateTree = String(process.env.RELEASE_MIGRATION_CANDIDATE_TREE || "").trim().toLowerCase();

if (!String(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT || "").trim()) throw new Error("RELEASE_MIGRATION_REHEARSAL_RECEIPT is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID is required.");
if (provenanceKind === "github-actions") {
  if (localExecutionId || candidateCommit || candidateTree) {
    throw new Error("GitHub Actions rehearsal attestation cannot include task-local provenance inputs.");
  }
  if (repository !== "lasrevinu333-design/memphis-zoo-mcp"
      || !workflowRef.startsWith(`${repository}/.github/workflows/production-backup-migration-rehearsal.yml@`)
      || !/^[0-9a-f]{40}$/.test(workflowSha) || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) {
    throw new Error("The rehearsal attestation must be created by the exact GitHub repository workflow run.");
  }
} else if (provenanceKind === TASK_LOCAL_PROVENANCE_KIND) {
  if (repository || workflowRef || workflowSha || runId || runAttempt || String(process.env.GITHUB_ACTIONS || "").trim()) {
    throw new Error("Task-local rehearsal attestation cannot include GitHub Actions provenance inputs.");
  }
} else {
  throw new Error(`Unsupported rehearsal provenance kind: ${provenanceKind || "<empty>"}.`);
}

const receiptBytes = readFileSync(receiptPath);
const rows = parseJsonValueStream(receiptBytes.toString("utf8"), "Release migration rehearsal receipt");
const result = [...rows].reverse().find((row) => row?.ok === true);
const expectedCommit = provenanceKind === TASK_LOCAL_PROVENANCE_KIND ? candidateCommit : workflowSha;
if (!result || result.source_commit !== expectedCommit || !/^[0-9a-f]{40}$/.test(String(result.source_tree || ""))
    || !String(result.backup_run_id || "").trim()) {
  throw new Error("The rehearsal receipt does not contain an exact successful result for the attested candidate.");
}
const completedAt = Date.parse(String(result.completed_at || ""));
if (!Number.isFinite(completedAt) || completedAt > Date.now() || Date.now() - completedAt > 24 * 60 * 60 * 1000) {
  throw new Error("The rehearsal result is stale or has an invalid completion time.");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const resultSha256 = sha256(stableJson(result));
const attestedAt = new Date().toISOString();
const commonAttestation = {
  receipt_sha256: sha256(receiptBytes),
  result_sha256: resultSha256,
  result_completed_at: result.completed_at,
  backup_run_id: String(result.backup_run_id),
};
let attestation;
if (provenanceKind === "github-actions") {
  attestation = {
    ...commonAttestation,
    repository,
    workflow_ref: workflowRef,
    workflow_sha: workflowSha,
    run_id: runId,
    run_attempt: runAttempt,
    attested_at: attestedAt,
  };
  validateRehearsalAttestationProvenance(attestation, { candidateCommit: workflowSha });
} else {
  const runnerSha256 = sha256(readFileSync(resolve(root, TASK_LOCAL_RUNNER_PATH)));
  attestation = {
    ...commonAttestation,
    provenance_kind: TASK_LOCAL_PROVENANCE_KIND,
    local_execution_id: localExecutionId,
    candidate_commit: candidateCommit,
    candidate_tree: candidateTree,
    archive_digest: String(result.archive_digest || ""),
    attested_at: attestedAt,
    runner_path: TASK_LOCAL_RUNNER_PATH,
    runner_sha256: runnerSha256,
    active_mutation_leases: Number(result.active_mutation_leases),
    expired_mutation_leases: Number(result.expired_mutation_leases),
    authority_health: result.authority_health,
    direct_dml_denied: result.direct_dml_denied,
    live_production_reads: Number(result.live_production_reads),
    archive_local_only: result.archive_local_only,
    external_uploads: Number(result.external_uploads),
  };
  if (result.provenance_kind !== TASK_LOCAL_PROVENANCE_KIND
      || result.local_execution_id !== localExecutionId
      || result.source_tree !== candidateTree) {
    throw new Error("The rehearsal receipt does not bind the exact task-local execution and candidate tree.");
  }
  validateRehearsalAttestationProvenance(attestation, {
    candidateCommit,
    candidateTree,
    archiveDigest: String(result.archive_digest || ""),
    resultSha256,
    runnerSha256,
  });
}
console.log(JSON.stringify({
  format: "memphis-zoo-release-migration-rehearsal-attestation.v1",
  algorithm: "hmac-sha256",
  key_id: keyId,
  attestation,
  signature: signBinding(releaseMigrationRehearsalAttestationBinding(attestation), key),
}));
