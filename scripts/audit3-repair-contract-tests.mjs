#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGeminiControlledRepairWorker } from "../src/gemini-controlled-worker.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const backup = read("scripts/production-backup.mjs");
const restore = read("scripts/production-restore.mjs");
const restoreIntent = read("scripts/create-production-restore-intent.mjs");
const restoreReconciliation = read("scripts/apply-production-restore-reconciliation.mjs");
const abandonedLeaseReconciliation = read("scripts/apply-abandoned-mutation-lease-reconciliation.mjs");
const recoveryCrypto = read("scripts/disaster-recovery-crypto.mjs");
const migration = read("supabase/migrations/20260729203938_third_audit_recovery_gemini_gps.sql");
const gemini = read("src/gemini-console-api.js");
const index = read("src/index.js");
const workflow = read(".github/workflows/production-disaster-recovery-backup.yml");

assert.match(backup, /repeatable read read only deferrable/i);
assert.match(backup, /txid_current_snapshot/);
assert.match(recoveryCrypto, /value instanceof Date/);
assert.match(backup, /schemas = \["public", "auth", "storage"\]/);
assert.match(backup, /storage\/v1\/object\/authenticated/);
assert.match(backup, /storageOwnerPrincipalId\(item\.row\)/,
  "backup must reject ambiguous owner_id and legacy owner columns before signing the Storage archive");
assert.match(backup, /storageObjectArchivePath\(object\.bucket_id, object\.name\)/,
  "backup and restore admission must share the deterministic Storage object archive path");
assert.match(backup, /validateV4StorageArchiveObjects\(objectManifest\)/,
  "the producer must validate its own exact v4 Storage schema before signing the archive");
assert.match(backup, /changed during backup; retry for a coherent archive/);
assert.doesNotMatch(backup, /offset: String\(offset\)/);
assert.match(restore, /archive_verified/);
assert.match(backup, /memphis-zoo-disaster-recovery\.v4/);
assert.match(backup, /migration-ledger\.json/);
assert.match(backup, /releaseIdentity\.migration_head\) !== migrationHead/,
  "a backup must not sign a release identity whose migration head differs from its snapshot ledger");
assert.match(backup, /cron-jobs\.json/);
assert.match(backup, /application-schema\.sql/);
assert.match(backup, /--schema-only", "--clean", "--if-exists"/);
assert.match(backup, /pg_export_snapshot/);
assert.match(backup, /--snapshot=\$\{exportedSnapshot\}/);
assert.match(restore, /memphis-zoo-disaster-recovery\.v4/);
assert.match(restore, /restoreArchiveAdmission\(summary\.format, \{ apply \}\)/,
  "historical v3 evidence must be rejected before any restore apply path can reach Storage reconciliation");
assert.match(restore, /validateV4StorageArchiveObjects\(objects\)/,
  "restore-compatible v4 archives must validate every exact Storage database row before admission");
assert.match(restoreIntent, /materializeVerifiedArchive\([\s\S]*supportedFormats: \["memphis-zoo-disaster-recovery\.v4"\]/,
  "restore intent creation must authenticate a v4 archive rather than trust local summary bytes");
assert.match(restoreIntent, /validateV4StorageArchiveObjects\(archivedStorageObjects\)/,
  "restore intent creation must reject a v3-shaped object relabeled as v4");
assert.doesNotMatch(restoreIntent, /memphis-zoo-disaster-recovery\.v3/,
  "a historical-only v3 archive cannot receive a production restore intent");
assert.ok(restoreIntent.indexOf("materializeVerifiedArchive({") < restoreIntent.indexOf("new Client("),
  "archive authentication and v4 schema admission must complete before target database connection");
assert.match(restore, /migration_ledger_sha256/);
assert.match(restore, /databaseOnly \? \["storage"\]/);
assert.match(backup, /BACKUP_MANIFEST_SIGNING_KEY/);
assert.match(restore, /archive_signature_verified/);
assert.match(restore, /RESTORE_INTENT_VERIFY_KEY/);
assert.match(restore, /PAUSED_RECONCILIATION/);
assert.match(restore, /invalidateRestoredAuthority/);
assert.match(restore, /RESTORE_CONFIRM_PROJECT_REF/);
assert.match(restore, /RESTORE_DATABASE_ONLY/);
assert.match(restore, /loopback mz_schema_rebuild_\* database/);
assert.match(restore, /restore_phase/);
assert.match(restore, /truncate_target_tables/);
assert.match(restore, /database_only_metadata_verified/);
assert.match(restore, /json_populate_record/);
assert.doesNotMatch(restore, /delete from custodial_dr\.application_mutation_leases where expires_at<=clock_timestamp\(\)/,
  "lease expiry cannot be treated as proof that external work stopped");
assert.match(restore, /expired application mutation lease\(s\).*exact named reconciliation is required/i,
  "expired external-mutation leases must fail the restore closed");
assert.match(restore, /storage\.createBucket/);
assert.match(restore, /storage\.from\(object\.bucket_id\)\.upload/);
assert.match(restoreIntent, /PAUSED_FAILURE[\s\S]*retry_of_restore_id/,
  "a failed restore must have a separately signed continuous-pause retry path");
assert.match(abandonedLeaseReconciliation, /owning_process_terminated[\s\S]*delete from custodial_dr\.application_mutation_leases/,
  "expired external leases require signed process-termination evidence before exact deletion");
assert.match(restoreReconciliation, /storage_supported_state_resample[\s\S]*reconciliation_manifest_sha256/,
  "supported Storage discrepancies require signed resampling evidence before resume");
assert.match(index, /withApplicationMutationLease\(\{[\s\S]*memphis-zoo-operational-notification-worker[\s\S]*await handler\(job, mutationLease\)/,
  "the enabled operational worker must lease its external Storage side effects");
assert.match(workflow, /schedule:/);
assert.match(workflow, /restore:verify/);
assert.match(workflow, /openssl enc -aes-256-cbc -salt -pbkdf2/);

assert.match(migration, /gemini_console_worker_heartbeats/);
assert.match(migration, /for update skip locked/);
assert.match(migration, /gemini_console_record_repair_backup/);
assert.match(migration, /completed repair requires test and verification evidence/);
assert.match(migration, /controlled repair worker is not currently available/);
assert.match(migration, /openstreetmap:node:1240762017/);
assert.match(gemini, /p_backend_commit: backendCommit/);
assert.doesNotMatch(gemini, /p_backend_commit: releaseId/);
assert.match(index, /geminiControlledRepairWorker\.start\(\)/);

const calls = [];
const supabase = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === "gemini_console_claim_repair_jobs") return { data: [], error: null };
    return { data: { ok: true }, error: null };
  },
};
const worker = createGeminiControlledRepairWorker({
  supabase,
  workerUrl: "https://controlled-worker.example.test",
  workerToken: "fixture-token-at-least-24-characters",
  releaseId: "fixture-release",
  backendCommit: "a".repeat(40),
});
assert.equal(worker.enabled, true);
const result = await worker.sweep();
assert.deepEqual(result, { ok: true, claimed: 0 });
assert.deepEqual(calls.map((call) => call.name), ["gemini_console_worker_heartbeat", "gemini_console_claim_repair_jobs"]);

const executionCalls = [];
const job = {
  repair_job_id: "00000000-0000-4000-8000-000000000001",
  proposal_id: "00000000-0000-4000-8000-000000000002",
  lease_token: "00000000-0000-4000-8000-000000000003",
  affected_components: ["custodial_program"],
  attempt_count: 1,
};
const executingWorker = createGeminiControlledRepairWorker({
  supabase: {
    async rpc(name, args) {
      executionCalls.push({ kind: "rpc", name, args });
      return { data: { ok: true }, error: null };
    },
  },
  workerUrl: "https://controlled-worker.example.test",
  workerToken: "fixture-token-at-least-24-characters",
  fetchImpl: async (url) => {
    executionCalls.push({ kind: "fetch", url });
    if (url.endsWith("/backup")) return new Response(JSON.stringify({ ok: true, backup_reference: "backup://fixture", evidence: { sha256_verified: true } }));
    return new Response(JSON.stringify({
      ok: true,
      status: "completed",
      changed_files: ["fixture.js"],
      test_evidence: [{ result: "pass" }],
      verification_evidence: [{ result: "pass" }],
      rollback_evidence: [{ result: "available" }],
    }));
  },
});
await executingWorker.processJob(job);
assert.deepEqual(executionCalls.filter((call) => call.kind === "fetch").map((call) => call.url), [
  "https://controlled-worker.example.test/v1/repairs/backup",
  "https://controlled-worker.example.test/v1/repairs/execute",
]);
assert.deepEqual(executionCalls.filter((call) => call.kind === "rpc").map((call) => call.name), [
  "gemini_console_record_repair_backup",
  "gemini_console_finish_repair_job",
]);

console.log("AUDIT3_REPAIR_CONTRACT_TESTS_PASS");
