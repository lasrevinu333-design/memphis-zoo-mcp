#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BACKUP_WORKFLOW_PATH = ".github/workflows/production-disaster-recovery-backup.yml";
export const BACKUP_MAX_AGE_MS = 90 * 60 * 1000;

export function validateProductionEnvironment(environment, customPolicies, branchProtected) {
  assert.equal(environment?.name, "production", "the protected production environment does not exist");
  const reviewerRule = environment.protection_rules?.find((rule) => rule.type === "required_reviewers");
  assert.ok(reviewerRule, "production environment must require reviewers");
  assert.ok(Array.isArray(reviewerRule.reviewers) && reviewerRule.reviewers.length > 0,
    "production environment must name at least one required reviewer");
  assert.equal(reviewerRule.prevent_self_review, true,
    "production environment must prevent the initiator from approving their own deployment");
  const policy = environment.deployment_branch_policy;
  assert.ok(policy, "production environment must restrict deployment branches");
  assert.notEqual(Boolean(policy.protected_branches), Boolean(policy.custom_branch_policies),
    "production environment must select exactly one deployment branch policy mode");
  if (policy.protected_branches) {
    assert.equal(branchProtected, true,
      "production environment relies on protected branches, but main is not protected");
  } else {
    assert.ok(Array.isArray(customPolicies), "custom production branch policies are unavailable");
    assert.equal(customPolicies.length, 1, "production environment must allow exactly one custom branch policy");
    assert.equal(customPolicies[0].name, "main", "production environment may only deploy main");
    assert.ok(["branch", undefined].includes(customPolicies[0].type),
      "production environment main policy must be a branch policy");
  }
  return {
    environment: environment.name,
    required_reviewer_count: reviewerRule.reviewers.length,
    deployment_policy: policy.protected_branches ? "protected-branches" : "main-only",
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

async function githubJson(path, token, optional = false) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "memphis-zoo-production-schema-c674-bootstrap",
    },
  });
  if (optional && response.status === 404) return null;
  assert.ok(response.ok, `GitHub evidence request failed with HTTP ${response.status} for ${path}`);
  return response.json();
}

function requiredEnvironment() {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const sha = String(process.env.GITHUB_SHA || "").trim();
  const backupRunId = String(process.env.PRODUCTION_BACKUP_RUN_ID || "").trim();
  assert.ok(token, "GITHUB_TOKEN is required");
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "GITHUB_REPOSITORY is invalid");
  assert.match(sha, /^[0-9a-f]{40}$/, "GITHUB_SHA must be an exact commit SHA");
  assert.match(backupRunId, /^[1-9][0-9]*$/, "PRODUCTION_BACKUP_RUN_ID must be numeric");
  return { token, repository, sha, backupRunId };
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
  const { token, repository, sha, backupRunId } = requiredEnvironment();
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
  const repo = await githubJson(`/repos/${encodedRepository}`, token);
  assert.equal(repo.default_branch, "main", "repository default branch must be main");
  const mainRef = await githubJson(`/repos/${encodedRepository}/git/ref/heads/main`, token);
  assert.equal(mainRef.object?.type, "commit", "main ref does not resolve to a commit");
  assert.equal(mainRef.object?.sha, sha, "workflow commit is no longer the exact main tip");

  const environment = await githubJson(`/repos/${encodedRepository}/environments/production`, token);
  const policy = environment.deployment_branch_policy;
  let customPolicies = [];
  let branchProtected = false;
  if (policy?.custom_branch_policies) {
    const result = await githubJson(
      `/repos/${encodedRepository}/environments/production/deployment-branch-policies?per_page=100`, token,
    );
    assert.equal(result.total_count, result.branch_policies.length,
      "production branch policy response is incomplete");
    customPolicies = result.branch_policies;
  }
  if (policy?.protected_branches) {
    branchProtected = Boolean(await githubJson(`/repos/${encodedRepository}/branches/main/protection`, token, true));
  }
  const environmentEvidence = validateProductionEnvironment(environment, customPolicies, branchProtected);

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
    production_environment: environmentEvidence,
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
