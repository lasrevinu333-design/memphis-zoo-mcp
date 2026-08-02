#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BACKUP_WORKFLOW_PATH = ".github/workflows/production-disaster-recovery-backup.yml";
export const BACKUP_MAX_AGE_MS = 90 * 60 * 1000;

export function validateSingleOwnerAuthorization({
  repository,
  repositoryOwner,
  actor,
  triggeringActor,
  runAttempt,
}) {
  assert.equal(repository, "lasrevinu333-design/memphis-zoo-mcp", "workflow repository is not authorized");
  assert.equal(repositoryOwner, "lasrevinu333-design", "workflow repository owner is not authorized");
  assert.equal(actor, "lasrevinu333-design", "only the repository owner may authorize this bootstrap");
  assert.equal(triggeringActor, "lasrevinu333-design",
    "only the repository owner may trigger or rerun this bootstrap");
  assert.equal(String(runAttempt), "1", "production bootstrap reruns are not authorized");
  return {
    model: "single-owner-exact-workflow-dispatch",
    actor,
    triggering_actor: triggeringActor,
    run_attempt: 1,
    repository_owner: repositoryOwner,
  };
}

export function validateBackupEvidence({ workflow, run, artifacts, repository, sha, backupRunId, now = Date.now() }) {
  assert.equal(workflow?.path, BACKUP_WORKFLOW_PATH, "backup workflow path differs from the reviewed workflow");
  assert.equal(String(run?.id), String(backupRunId), "backup run ID does not match the requested evidence");
  assert.equal(run?.workflow_id, workflow.id, "backup evidence belongs to a different workflow");
  assert.equal(run?.status, "completed", "backup workflow is not complete");
  assert.equal(run?.conclusion, "success", "backup workflow did not succeed");
  assert.equal(run?.head_branch, "main", "backup workflow did not run from main");
  assert.equal(run?.head_sha, sha, "backup workflow did not run from this exact main commit");
  assert.equal(run?.repository?.full_name, repository, "backup workflow belongs to a different repository");
  assert.ok(["workflow_dispatch", "schedule"].includes(run?.event), "backup workflow event is not reviewed");
  const completedAt = Date.parse(run?.updated_at || "");
  assert.ok(Number.isFinite(completedAt), "backup completion time is invalid");
  const ageMs = now - completedAt;
  assert.ok(ageMs >= 0 && ageMs <= BACKUP_MAX_AGE_MS,
    "backup workflow is not fresh (maximum age is 90 minutes)");
  const expectedName = `memphis-zoo-disaster-recovery-${backupRunId}`;
  const exact = (artifacts || []).filter((artifact) => artifact.name === expectedName);
  assert.equal(exact.length, 1, "backup run must retain exactly one expected disaster-recovery artifact");
  const artifact = exact[0];
  assert.equal(artifact.expired, false, "backup artifact is expired");
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
    "backup artifact is empty");
  assert.match(String(artifact.digest || ""), /^sha256:[0-9a-f]{64}$/,
    "backup artifact must expose an immutable SHA-256 digest");
  return {
    workflow_id: workflow.id,
    run_id: run.id,
    run_attempt: run.run_attempt,
    event: run.event,
    head_sha: run.head_sha,
    completed_at: run.updated_at,
    age_seconds: Math.floor(ageMs / 1000),
    artifact: {
      id: artifact.id,
      name: artifact.name,
      size_bytes: artifact.size_in_bytes,
      digest: artifact.digest,
      expires_at: artifact.expires_at,
    },
  };
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "memphis-zoo-production-schema-c674-bootstrap",
    },
  });
  assert.ok(response.ok, `GitHub evidence request failed with HTTP ${response.status} for ${path}`);
  return response.json();
}

function requiredEnvironment() {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const repositoryOwner = String(process.env.GITHUB_REPOSITORY_OWNER || "").trim();
  const actor = String(process.env.GITHUB_ACTOR || "").trim();
  const triggeringActor = String(process.env.GITHUB_TRIGGERING_ACTOR || "").trim();
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();
  const sha = String(process.env.GITHUB_SHA || "").trim();
  const backupRunId = String(process.env.PRODUCTION_BACKUP_RUN_ID || "").trim();
  assert.ok(token, "GITHUB_TOKEN is required");
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "GITHUB_REPOSITORY is invalid");
  validateSingleOwnerAuthorization({ repository, repositoryOwner, actor, triggeringActor, runAttempt });
  assert.match(sha, /^[0-9a-f]{40}$/, "GITHUB_SHA must be an exact commit SHA");
  assert.match(backupRunId, /^[1-9][0-9]*$/, "PRODUCTION_BACKUP_RUN_ID must be numeric");
  return { token, repository, repositoryOwner, actor, triggeringActor, runAttempt, sha, backupRunId };
}

function outputEvidence(path, evidence) {
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  const githubOutput = String(process.env.GITHUB_OUTPUT || "").trim();
  if (githubOutput) {
    appendFileSync(githubOutput, `backup_run_id=${evidence.backup.run_id}\n`);
    appendFileSync(githubOutput, `backup_artifact_name=${evidence.backup.artifact.name}\n`);
    appendFileSync(githubOutput, `backup_artifact_digest=${evidence.backup.artifact.digest}\n`);
  }
}

export async function run(argv = process.argv.slice(2)) {
  assert.deepEqual(argv.slice(0, 1), ["--evidence-out"], "usage: --evidence-out PATH");
  assert.equal(argv.length, 2, "usage: --evidence-out PATH");
  const evidencePath = resolve(argv[1]);
  const {
    token,
    repository,
    repositoryOwner,
    actor,
    triggeringActor,
    runAttempt,
    sha,
    backupRunId,
  } = requiredEnvironment();
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
  const repo = await githubJson(`/repos/${encodedRepository}`, token);
  assert.equal(repo.default_branch, "main", "repository default branch must be main");
  assert.equal(repo.owner?.login, repositoryOwner, "repository ownership changed");
  const mainRef = await githubJson(`/repos/${encodedRepository}/git/ref/heads/main`, token);
  assert.equal(mainRef.object?.type, "commit", "main ref does not resolve to a commit");
  assert.equal(mainRef.object?.sha, sha, "workflow commit is no longer the exact main tip");

  const workflow = await githubJson(
    `/repos/${encodedRepository}/actions/workflows/${encodeURIComponent("production-disaster-recovery-backup.yml")}`, token,
  );
  const runResult = await githubJson(`/repos/${encodedRepository}/actions/runs/${backupRunId}`, token);
  const artifactResult = await githubJson(
    `/repos/${encodedRepository}/actions/runs/${backupRunId}/artifacts?per_page=100`, token,
  );
  assert.equal(artifactResult.total_count, artifactResult.artifacts.length,
    "backup artifact response is incomplete");
  const backupEvidence = validateBackupEvidence({
    workflow,
    run: runResult,
    artifacts: artifactResult.artifacts,
    repository,
    sha,
    backupRunId,
  });
  const evidence = {
    ok: true,
    verified_at: new Date().toISOString(),
    repository,
    exact_main_sha: sha,
    authorization: validateSingleOwnerAuthorization({
      repository,
      repositoryOwner,
      actor,
      triggeringActor,
      runAttempt,
    }),
    backup: backupEvidence,
  };
  outputEvidence(evidencePath, evidence);
  console.log(JSON.stringify({
    ok: true,
    exact_main_sha: sha,
    backup_run_id: backupEvidence.run_id,
    backup_artifact_digest: backupEvidence.artifact.digest,
    evidence_path: basename(evidencePath),
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await run();
}
