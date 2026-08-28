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

const receiptPath = resolve(String(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT || ""));
const key = requireSigningKey(process.env.RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY, "RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY");
const keyId = String(process.env.RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const workflowRef = String(process.env.GITHUB_WORKFLOW_REF || "").trim();
const workflowSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
const runId = String(process.env.GITHUB_RUN_ID || "").trim();
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();

if (!String(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT || "").trim()) throw new Error("RELEASE_MIGRATION_REHEARSAL_RECEIPT is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID is required.");
if (repository !== "lasrevinu333-design/memphis-zoo-mcp"
    || !workflowRef.startsWith(`${repository}/.github/workflows/production-backup-migration-rehearsal.yml@`)
    || !/^[0-9a-f]{40}$/.test(workflowSha) || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) {
  throw new Error("The rehearsal attestation must be created by the exact GitHub repository workflow run.");
}

const receiptBytes = readFileSync(receiptPath);
const rows = receiptBytes.toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const result = [...rows].reverse().find((row) => row?.ok === true);
if (!result || result.source_commit !== workflowSha || !/^[0-9a-f]{40}$/.test(String(result.source_tree || ""))
    || !String(result.backup_run_id || "").trim()) {
  throw new Error("The rehearsal receipt does not contain an exact successful result for the workflow SHA.");
}
const completedAt = Date.parse(String(result.completed_at || ""));
if (!Number.isFinite(completedAt) || completedAt > Date.now() || Date.now() - completedAt > 24 * 60 * 60 * 1000) {
  throw new Error("The rehearsal result is stale or has an invalid completion time.");
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const attestation = {
  receipt_sha256: sha256(receiptBytes),
  result_sha256: sha256(stableJson(result)),
  result_completed_at: result.completed_at,
  backup_run_id: String(result.backup_run_id),
  repository,
  workflow_ref: workflowRef,
  workflow_sha: workflowSha,
  run_id: runId,
  run_attempt: runAttempt,
  attested_at: new Date().toISOString(),
};
console.log(JSON.stringify({
  format: "memphis-zoo-release-migration-rehearsal-attestation.v1",
  algorithm: "hmac-sha256",
  key_id: keyId,
  attestation,
  signature: signBinding(releaseMigrationRehearsalAttestationBinding(attestation), key),
}));
