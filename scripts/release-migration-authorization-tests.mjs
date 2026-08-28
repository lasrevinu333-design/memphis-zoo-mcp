#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  archiveSignatureBinding,
  releaseMigrationAuthorizationBinding,
  signBinding,
  stableJsonFile,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "release-migration-authorization-"));
const backupDir = join(work, "backup");
mkdirSync(backupDir, { mode: 0o700 });
const receiptPath = join(work, "rehearsal.jsonl");
const attestationPath = join(work, "rehearsal-attestation.json");
const key = "release-migration-authorization-test-key-00000001";
const keyId = "release-migration-authorization-test-v1";
const archiveKey = "release-migration-archive-test-key-000000000001";
const archiveKeyId = "release-migration-archive-test-v1";
const rehearsalAttestationKey = "release-migration-rehearsal-attestation-test-key-0001";
const rehearsalAttestationKeyId = "release-migration-rehearsal-attestation-test-v1";
const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
const now = Date.now();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ledger = Array.from({ length: Number(state.observed_production.production_ledger_count) }, (_, index) => ({
  version: index === Number(state.observed_production.production_ledger_count) - 1
    ? state.observed_production.ledger_head
    : `202601${String(index + 1).padStart(8, "0")}`,
  name: index === Number(state.observed_production.production_ledger_count) - 1
    ? state.observed_production.source_migration_name
    : `fixture_${index + 1}`,
  statements: [],
}));
const ledgerBytes = Buffer.from(stableJsonFile(ledger));
const ledgerSha256 = sha256(ledgerBytes);
let archiveDigest = null;

function writeReceipt({ expiredLeases = 0 } = {}) {
  const receipt = {
    ok: true,
    backup_run_id: "fixture-100",
    archive_digest: archiveDigest,
    source_commit: candidateCommit,
    source_tree: candidateTree,
    source_migration_head: state.observed_production.ledger_head,
    source_migration_count: state.observed_production.production_ledger_count,
    source_migration_ledger_sha256: ledgerSha256,
    source_catalog_fingerprint: state.observed_production.catalog_privilege_fingerprint,
    target_migration_head: state.target.source_migration_version,
    target_migration_count: state.target.production_ledger_count,
    target_catalog_fingerprint: state.target.canonical_source_schema_fingerprint,
    active_mutation_leases: 0,
    expired_mutation_leases: expiredLeases,
    authority_health: true,
    direct_dml_denied: true,
    completed_at: new Date(now - 1_000).toISOString(),
  };
  writeFileSync(receiptPath, `${JSON.stringify({ started: true })}\n${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}
async function writeAttestation() {
  const result = await execFileAsync(process.execPath, [resolve(root, "scripts/create-release-migration-rehearsal-attestation.mjs")], {
    env: {
      ...process.env,
      RELEASE_MIGRATION_REHEARSAL_RECEIPT: receiptPath,
      RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY: rehearsalAttestationKey,
      RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY_ID: rehearsalAttestationKeyId,
      GITHUB_REPOSITORY: "lasrevinu333-design/memphis-zoo-mcp",
      GITHUB_WORKFLOW_REF: "lasrevinu333-design/memphis-zoo-mcp/.github/workflows/production-backup-migration-rehearsal.yml@refs/heads/fixture",
      GITHUB_SHA: candidateCommit,
      GITHUB_RUN_ID: "100",
      GITHUB_RUN_ATTEMPT: "1",
    },
  });
  writeFileSync(attestationPath, result.stdout, { mode: 0o600 });
}
async function createAuthorization(extraEnv = {}) {
  return execFileAsync(process.execPath, [resolve(root, "scripts/create-release-migration-authorization.mjs")], {
    env: {
      ...process.env,
      RELEASE_MIGRATION_BACKUP_DIR: backupDir,
      RELEASE_MIGRATION_REHEARSAL_RECEIPT: receiptPath,
      RELEASE_MIGRATION_REHEARSAL_ATTESTATION: attestationPath,
      RELEASE_MIGRATION_CANDIDATE_COMMIT: candidateCommit,
      RELEASE_MIGRATION_CANDIDATE_TREE: candidateTree,
      RELEASE_MIGRATION_AUTHORIZATION_NAMED_ACTOR: "release authorization test operator",
      RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY: key,
      RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY_ID: keyId,
      RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY: archiveKey,
      RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY_ID: archiveKeyId,
      RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY: rehearsalAttestationKey,
      RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY_ID: rehearsalAttestationKeyId,
      ...extraEnv,
    },
  });
}

try {
  mkdirSync(join(backupDir, "inventory"), { mode: 0o700 });
  writeFileSync(join(backupDir, "inventory/migration-ledger.json"), ledgerBytes, { mode: 0o600 });
  const summary = {
    ok: true,
    format: "memphis-zoo-disaster-recovery.v4",
    consistent_database_snapshot: true,
    completed_at: new Date(now - 2_000).toISOString(),
    project_ref: state.project_ref,
    source_identity: {
      backup_tool_commit: candidateCommit,
      backup_tool_tree: candidateTree,
      migration_head: state.observed_production.ledger_head,
      migration_ledger_count: state.observed_production.production_ledger_count,
      migration_ledger_sha256: ledgerSha256,
    },
  };
  writeFileSync(join(backupDir, "backup-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  const checksumBytes = Buffer.from([
    `${sha256(readFileSync(join(backupDir, "backup-summary.json")))}  backup-summary.json`,
    `${sha256(ledgerBytes)}  inventory/migration-ledger.json`,
  ].join("\n") + "\n");
  writeFileSync(join(backupDir, "SHA256SUMS"), checksumBytes, { mode: 0o600 });
  archiveDigest = sha256(checksumBytes);
  writeFileSync(join(backupDir, "archive-signature.json"), `${JSON.stringify({
    format: "memphis-zoo-disaster-recovery-signature.v1",
    algorithm: "hmac-sha256",
    key_id: archiveKeyId,
    archive_digest: archiveDigest,
    signature: signBinding(archiveSignatureBinding({
      archiveDigest,
      projectRef: summary.project_ref,
      sourceIdentity: summary.source_identity,
      archiveFormat: summary.format,
    }), archiveKey),
  }, null, 2)}\n`, { mode: 0o600 });
  writeReceipt();
  await writeAttestation();
  const envelope = JSON.parse((await createAuthorization()).stdout);
  assert.equal(envelope.format, "memphis-zoo-release-migration-authorization.v1");
  assert.equal(envelope.intent.candidate_commit, candidateCommit);
  assert.equal(envelope.intent.source_migration_ledger_sha256, ledgerSha256);
  assert.equal(envelope.intent.backup.archive_signature_key_id, archiveKeyId);
  assert.equal(envelope.intent.rehearsal.expired_mutation_leases, 0);
  assert.equal(envelope.intent.rehearsal.repository, "lasrevinu333-design/memphis-zoo-mcp");
  assert.equal(envelope.intent.rehearsal.workflow_sha, candidateCommit);
  assert.match(envelope.intent.rehearsal.attestation_sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyBinding(releaseMigrationAuthorizationBinding(envelope.intent), envelope.signature, key), true);
  await assert.rejects(createAuthorization({ RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY: key }), /must be independent/i,
    "the archive signer and production migration authorizer must remain separate authorities");
  writeReceipt({ expiredLeases: 1 });
  await writeAttestation();
  await assert.rejects(createAuthorization(), /zero-lease recovery result/,
    "authorization cannot bless a rehearsal that retained an expired fail-closed lease");
  writeReceipt();
  await writeAttestation();
  writeFileSync(receiptPath, `${readFileSync(receiptPath, "utf8")}\n`, { mode: 0o600 });
  await assert.rejects(createAuthorization(), /do not bind the exact candidate/i,
    "authorization must reject a fabricated or modified rehearsal receipt after run attestation");
  writeReceipt();
  await writeAttestation();
  const tamperedAttestation = JSON.parse(readFileSync(attestationPath, "utf8"));
  tamperedAttestation.signature = `${tamperedAttestation.signature.slice(0, -1)}${tamperedAttestation.signature.endsWith("0") ? "1" : "0"}`;
  writeFileSync(attestationPath, `${JSON.stringify(tamperedAttestation)}\n`, { mode: 0o600 });
  await assert.rejects(createAuthorization(), /attestation signature verification failed/i,
    "authorization must reject a rehearsal attestation with a modified signature");
  writeReceipt();
  await writeAttestation();
  const tamperedSummary = { ...summary, completed_at: new Date(now).toISOString() };
  writeFileSync(join(backupDir, "backup-summary.json"), `${JSON.stringify(tamperedSummary, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(createAuthorization(), /checksum verification failed/,
    "authorization must reject a freshness timestamp changed after the signed archive was created");
  console.log("RELEASE_MIGRATION_AUTHORIZATION_TESTS_PASS");
} finally {
  rmSync(work, { recursive: true, force: true });
}
