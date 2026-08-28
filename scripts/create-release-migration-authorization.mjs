#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  releaseMigrationAuthorizationBinding,
  releaseMigrationRehearsalAttestationBinding,
  requireSigningKey,
  signBinding,
  stableJson,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";
import { materializeVerifiedArchive } from "./disaster-recovery-archive.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const state = JSON.parse(readFileSync(resolve(root, "release/production-migration-state.json"), "utf8"));
const backupDirInput = String(process.env.RELEASE_MIGRATION_BACKUP_DIR || "").trim();
const rehearsalReceiptInput = String(process.env.RELEASE_MIGRATION_REHEARSAL_RECEIPT || "").trim();
const rehearsalAttestationInput = String(process.env.RELEASE_MIGRATION_REHEARSAL_ATTESTATION || "").trim();
const backupDir = backupDirInput ? resolve(backupDirInput) : "";
const rehearsalReceiptPath = rehearsalReceiptInput ? resolve(rehearsalReceiptInput) : "";
const rehearsalAttestationPath = rehearsalAttestationInput ? resolve(rehearsalAttestationInput) : "";
const candidateCommit = String(process.env.RELEASE_MIGRATION_CANDIDATE_COMMIT || "").trim().toLowerCase();
const candidateTree = String(process.env.RELEASE_MIGRATION_CANDIDATE_TREE || "").trim().toLowerCase();
const actor = String(process.env.RELEASE_MIGRATION_AUTHORIZATION_NAMED_ACTOR || "").trim();
const key = requireSigningKey(process.env.RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY, "RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY");
const keyId = String(process.env.RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY_ID || "").trim();
const archiveVerifyKey = requireSigningKey(process.env.RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY, "RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY");
const archiveVerifyKeyId = String(process.env.RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY_ID || "").trim();
const rehearsalAttestationVerifyKey = requireSigningKey(process.env.RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY, "RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY");
const rehearsalAttestationVerifyKeyId = String(process.env.RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY_ID || "").trim();
const ttlMinutes = Math.max(5, Math.min(60, Number(process.env.RELEASE_MIGRATION_AUTHORIZATION_TTL_MINUTES || 30)));

if (!/^[0-9a-f]{40}$/.test(candidateCommit) || !/^[0-9a-f]{40}$/.test(candidateTree)) throw new Error("Exact candidate commit and tree are required.");
if (!backupDir || !rehearsalReceiptPath || !rehearsalAttestationPath) throw new Error("Exact backup directory, rehearsal receipt, and rehearsal attestation paths are required.");
if (!actor || !/^[a-zA-Z0-9 ._@:-]{2,160}$/.test(actor)) throw new Error("RELEASE_MIGRATION_AUTHORIZATION_NAMED_ACTOR must identify the approving operator.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(keyId)) throw new Error("RELEASE_MIGRATION_AUTHORIZATION_SIGNING_KEY_ID is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(archiveVerifyKeyId)) throw new Error("RELEASE_MIGRATION_ARCHIVE_VERIFY_KEY_ID is required.");
if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(rehearsalAttestationVerifyKeyId)) throw new Error("RELEASE_REHEARSAL_ATTESTATION_VERIFY_KEY_ID is required.");
if (key === archiveVerifyKey || rehearsalAttestationVerifyKey === archiveVerifyKey || rehearsalAttestationVerifyKey === key) {
  throw new Error("Archive, rehearsal-attestation, and release-authorization keys must be independent.");
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
const verifiedArchive = materializeVerifiedArchive({
  sourceDir: backupDir,
  archiveVerifyKey,
  archiveVerifyKeyId,
  supportedFormats: ["memphis-zoo-disaster-recovery.v4"],
  requiredEntries: ["backup-summary.json", "inventory/migration-ledger.json"],
});
const verifiedBackupDir = verifiedArchive.directory;
const { summary, archiveDigest, checksumPaths } = verifiedArchive;
const archivedLedger = JSON.parse(readFileSync(join(verifiedBackupDir, "inventory/migration-ledger.json"), "utf8"));
const archivedLedgerSha256 = await sha256File(join(verifiedBackupDir, "inventory/migration-ledger.json"));
const receiptBytes = readFileSync(rehearsalReceiptPath);
const receiptLines = receiptBytes.toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const rehearsal = [...receiptLines].reverse().find((row) => row?.ok === true);
const rehearsalAttestationBytes = readFileSync(rehearsalAttestationPath);
const rehearsalAttestationEnvelope = JSON.parse(rehearsalAttestationBytes.toString("utf8"));
const rehearsalAttestation = rehearsalAttestationEnvelope?.attestation || {};
if (rehearsalAttestationEnvelope?.format !== "memphis-zoo-release-migration-rehearsal-attestation.v1"
    || rehearsalAttestationEnvelope?.algorithm !== "hmac-sha256"
    || rehearsalAttestationEnvelope?.key_id !== rehearsalAttestationVerifyKeyId
    || !verifyBinding(releaseMigrationRehearsalAttestationBinding(rehearsalAttestation), rehearsalAttestationEnvelope?.signature, rehearsalAttestationVerifyKey)) {
  throw new Error("Release migration rehearsal attestation signature verification failed.");
}
const plan = state.pending_migrations.map(({ order, source_migration_version, file, sha256: digest }) => ({ order, source_migration_version, file, sha256: digest }));
const planSha256 = sha256(stableJson(plan));
const backupCompletedAt = Date.parse(String(summary.completed_at || ""));
const rehearsalCompletedAt = Date.parse(String(rehearsal?.completed_at || ""));
const rehearsalAttestedAt = Date.parse(String(rehearsalAttestation.attested_at || ""));
const observedAt = Date.parse(String(state.observed_production.captured_at || ""));
if (summary.format !== "memphis-zoo-disaster-recovery.v4" || summary.ok !== true
    || summary.consistent_database_snapshot !== true || summary.project_ref !== state.project_ref
    || !Array.isArray(archivedLedger)
    || archivedLedger.length !== Number(summary.source_identity?.migration_ledger_count)
    || archivedLedger.length !== Number(state.observed_production.production_ledger_count)
    || String(archivedLedger.at(-1)?.version || "") !== String(summary.source_identity?.migration_head || "")
    || summary.source_identity?.migration_head !== state.observed_production.ledger_head
    || Number(summary.source_identity?.migration_ledger_count) !== Number(state.observed_production.production_ledger_count)
    || archivedLedgerSha256 !== summary.source_identity?.migration_ledger_sha256
    || archiveDigest !== rehearsal?.archive_digest || summary.source_identity?.backup_tool_commit !== candidateCommit
    || summary.source_identity?.backup_tool_tree !== candidateTree || rehearsal?.source_commit !== candidateCommit
    || rehearsal?.source_tree !== candidateTree || rehearsal?.source_migration_head !== state.observed_production.ledger_head
    || Number(rehearsal?.source_migration_count) !== Number(state.observed_production.production_ledger_count)
    || rehearsal?.source_migration_ledger_sha256 !== summary.source_identity?.migration_ledger_sha256
    || rehearsal?.source_catalog_fingerprint !== state.observed_production.catalog_privilege_fingerprint
    || rehearsal?.target_catalog_fingerprint !== state.target.canonical_source_schema_fingerprint
    || rehearsal?.target_migration_head !== state.target.source_migration_version
    || Number(rehearsal?.target_migration_count) !== Number(state.target.production_ledger_count)
    || Number(rehearsal?.active_mutation_leases) !== 0 || Number(rehearsal?.expired_mutation_leases) !== 0
    || rehearsal?.authority_health !== true || rehearsal?.direct_dml_denied !== true
    || rehearsalAttestation.receipt_sha256 !== sha256(receiptBytes)
    || rehearsalAttestation.result_sha256 !== sha256(stableJson(rehearsal))
    || rehearsalAttestation.result_completed_at !== rehearsal?.completed_at
    || rehearsalAttestation.backup_run_id !== String(rehearsal?.backup_run_id)
    || rehearsalAttestation.repository !== "lasrevinu333-design/memphis-zoo-mcp"
    || !String(rehearsalAttestation.workflow_ref || "").startsWith("lasrevinu333-design/memphis-zoo-mcp/.github/workflows/production-backup-migration-rehearsal.yml@")
    || rehearsalAttestation.workflow_sha !== candidateCommit
    || !/^[1-9][0-9]*$/.test(String(rehearsalAttestation.run_id || ""))
    || !/^[1-9][0-9]*$/.test(String(rehearsalAttestation.run_attempt || ""))) {
  throw new Error("Backup and rehearsal evidence do not bind the exact candidate, source state, target state, and zero-lease recovery result.");
}
if (![backupCompletedAt, rehearsalCompletedAt, rehearsalAttestedAt, observedAt].every(Number.isFinite)
    || backupCompletedAt < observedAt || rehearsalCompletedAt < backupCompletedAt
    || rehearsalAttestedAt < rehearsalCompletedAt || rehearsalAttestedAt > Date.now()
    || Date.now() - rehearsalCompletedAt > 24 * 60 * 60 * 1000 || rehearsalCompletedAt > Date.now()) {
  throw new Error("Backup/rehearsal evidence is stale, out of order, or predates the observed production state.");
}
const intent = {
  authorization_id: randomUUID(),
  project_ref: state.project_ref,
  candidate_commit: candidateCommit,
  candidate_tree: candidateTree,
  pending_migration_plan_sha256: planSha256,
  source_catalog_fingerprint: state.observed_production.catalog_privilege_fingerprint,
  source_migration_head: state.observed_production.ledger_head,
  source_migration_count: Number(state.observed_production.production_ledger_count),
  source_migration_ledger_sha256: summary.source_identity.migration_ledger_sha256,
  target_catalog_fingerprint: state.target.canonical_source_schema_fingerprint,
  target_migration_head: state.target.source_migration_version,
  target_migration_count: Number(state.target.production_ledger_count),
  backup: {
    archive_digest: archiveDigest,
    archive_signature_key_id: archiveVerifyKeyId,
    checksum_entry_count: checksumPaths.size,
    completed_at: summary.completed_at,
    source_commit: summary.source_identity.backup_tool_commit,
    source_tree: summary.source_identity.backup_tool_tree,
  },
  rehearsal: {
    receipt_sha256: sha256(receiptBytes),
    attestation_sha256: sha256(rehearsalAttestationBytes),
    attestation_key_id: rehearsalAttestationVerifyKeyId,
    completed_at: rehearsal.completed_at,
    backup_run_id: String(rehearsal.backup_run_id),
    repository: rehearsalAttestation.repository,
    workflow_ref: rehearsalAttestation.workflow_ref,
    workflow_sha: rehearsalAttestation.workflow_sha,
    run_id: rehearsalAttestation.run_id,
    run_attempt: rehearsalAttestation.run_attempt,
    active_mutation_leases: 0,
    expired_mutation_leases: 0,
  },
  actor,
  approved_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
};
console.log(JSON.stringify({
  format: "memphis-zoo-release-migration-authorization.v1",
  algorithm: "hmac-sha256",
  key_id: keyId,
  intent,
  signature: signBinding(releaseMigrationAuthorizationBinding(intent), key),
}));
