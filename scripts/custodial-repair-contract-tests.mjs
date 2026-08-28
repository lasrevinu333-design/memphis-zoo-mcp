import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const indexSource = readFileSync("src/index.js", "utf8");
const messagingSource = readFileSync("src/messaging-api.js", "utf8");
const sharedAuthSource = readFileSync("src/auth/shared-access-auth.js", "utf8");
const deviceAuthSource = readFileSync("src/auth/device-credential-auth.js", "utf8");
const releaseManifestSource = readFileSync("src/release-manifest.js", "utf8");
const frontendReleaseManifest = JSON.parse(readFileSync("release/frontend-release-manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const migration = readFileSync("supabase/migrations/20260717161000_custodial_foundation_repair_delta.sql", "utf8");
const atomicCommitMigration = readFileSync(
  "supabase/migrations/20260801131340_custodial_atomic_offline_completion_identity.sql",
  "utf8",
);
const offlineActorRecoveryMigration = readFileSync(
  "supabase/migrations/20260810143000_offline_actor_occurrence_reconciliation.sql",
  "utf8",
);
const offlineAuthorityEnforcementMigration = readFileSync(
  "supabase/migrations/20260810150000_enforce_integrated_backend_authority.sql",
  "utf8",
);
const offlineAuthorityClosureMigration = readFileSync(
  "supabase/migrations/20260810160000_close_offline_authority_integrity_gaps.sql",
  "utf8",
);
const schemaReconciliationMigration = readFileSync(
  "supabase/migrations/20260801134430_reconcile_canonical_schema_security_metadata.sql",
  "utf8",
);
const namedManagerSharedRoomRetirementMigration = readFileSync(
  "supabase/migrations/20260810120000_retire_named_manager_shared_room_authority.sql",
  "utf8",
);
const namedManagerSharedRoomRetirementCorrectionMigration = readFileSync(
  "supabase/migrations/20260810130000_harden_named_manager_retired_archive_and_concurrency.sql",
  "utf8",
);
const foreignKeyIndexMigration = readFileSync(
  "supabase/migrations/20260730222357_index_remaining_foreign_keys.sql",
  "utf8",
);

assert.doesNotMatch(indexSource, /"tool_start_session_v2"/);
assert.doesNotMatch(indexSource, /"tool_record_scan_event"/);
assert.match(indexSource, /p_client_session_id is required and p_client_completion_id must be a UUID for idempotent completion/);
assert.match(indexSource, /prepareScanRpcCall/);
assert.match(indexSource, /bindOfflineActorProof/);
assert.match(indexSource, /tool_start_offline_occurrence/);
assert.match(indexSource, /tool_commit_cleaning_workflow_authoritative/);
assert.match(indexSource, /CUSTODIAL_BACKEND_PROOF_SECRET/);
assert.doesNotMatch(indexSource, /custodial_issue_offline_actor_context/);
assert.match(indexSource, /sqlStateHttpStatus/);
assert.match(indexSource, /custodial_quarantine_malformed_scan_http/);
assert.match(indexSource, /requiredRequestOperationId/);
assert.match(indexSource, /authorityHttpFailure/);
assert.match(offlineAuthorityClosureMigration, /custodial_offline_reconciliation_outbox/);
assert.match(offlineAuthorityClosureMigration, /custodial_reject_offline_evidence_truncate/);
assert.match(offlineAuthorityClosureMigration, /invalid_payload_shape_or_bounds/);
assert.match(offlineAuthorityClosureMigration, /duplicate scan event identity in one payload/);
assert.match(offlineAuthorityClosureMigration, /scan_event_identity_already_bound/);
assert.match(offlineAuthorityClosureMigration, /revoke all on table public\.sessions,public\.completion_responses,public\.scan_events,public\.maintenance_tickets/);
assert.doesNotMatch(indexSource, /create table if not exists public\.guest_cleanliness_reports/i);
assert.doesNotMatch(indexSource, /create table if not exists public\.system_feedback_items/i);
assert.match(indexSource, /storage_bucket/);
assert.match(indexSource, /supabaseAdmin\.storage/);
assert.match(indexSource, /\/release-manifest/);
assert.match(indexSource, /app\.use\(\["\/version", "\/release-manifest", "\/scheduler-runtime-config", "\/healthz", "\/health", "\/health\/dependencies"\]/);
function assertConstantProcessLivenessRoute(source) {
  assert.equal(
    source.match(/\/healthz/g)?.length || 0,
    2,
    "the backend may mention /healthz only in its public CORS admission and unconditional route",
  );
  const livenessRouteStart = source.indexOf('app.get("/healthz"');
  const livenessRouteEnd = source.indexOf('app.get("/version"');
  assert.ok(livenessRouteStart >= 0 && livenessRouteEnd > livenessRouteStart, "the process-liveness route must remain inspectable");
  const livenessRoute = source.slice(livenessRouteStart, livenessRouteEnd).trim();
  assert.equal(livenessRoute, `app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    process_alive: true,
    probe_scope: "process_liveness",
    dependencies_ready: null,
    release_id: RELEASE_ID,
    app_version: APP_VERSION,
  });
});`, "process liveness must remain an unconditional constant response");
}

async function reserveLoopbackPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function proveProcessLivenessWithUnavailableDependencies() {
  const port = await reserveLoopbackPort();
  const childEnv = { ...process.env };
  for (const name of [
    "DATABASE_URL",
    "MEMPHIS_RELEASE_ATTESTATION_JSON",
    "MEMPHIS_RELEASE_ATTESTATION_PUBLIC_KEY",
    "RENDER",
    "RENDER_GIT_COMMIT",
  ]) delete childEnv[name];
  Object.assign(childEnv, {
    NODE_ENV: "production",
    PORT: String(port),
    OPS_MANAGER_SESSION_SECRET: `liveness-ops-${process.pid}-${Date.now()}-independent-secret`,
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_SERVICE_ROLE_KEY: "custodial-liveness-unavailable-fixture",
    CUSTODIAL_READONLY_DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid",
    EVENT_MAINTENANCE_SWEEP_MS: "0",
    FEEDBACK_REMINDER_SWEEP_MS: "0",
    OPERATIONAL_NOTIFICATION_SWEEP_MS: "0",
  });
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    let livenessResponse = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`liveness fixture exited before startup: ${output}`);
      try {
        livenessResponse = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(250) });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    assert.ok(livenessResponse, `liveness fixture did not start: ${output}`);
    assert.equal(livenessResponse.status, 200);
    assert.deepEqual(await livenessResponse.json(), {
      ok: true,
      process_alive: true,
      probe_scope: "process_liveness",
      dependencies_ready: null,
      release_id: "release-2026.07.19.custodial-v3.12",
      app_version: "release-2026.07.19.custodial-v3.12",
    });
    const readinessResponse = await fetch(`http://127.0.0.1:${port}/health/dependencies`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(readinessResponse.status, 503, "unavailable database authority must fail dependency readiness without failing process liveness");
    const readiness = await readinessResponse.json();
    assert.equal(readiness.ok, false);
    assert.equal(readiness.process_alive, true);
    assert.equal(readiness.database_reachable, false);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`liveness fixture did not stop: ${output}`)), 5_000)),
    ]);
  }
}

assertConstantProcessLivenessRoute(indexSource);
const dependencyGatedLivenessMutant = indexSource.replace(
  'app.get("/healthz", (_req, res) => {',
  'app.get("/healthz", (_req, res) => {\n  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false });',
);
assert.notEqual(dependencyGatedLivenessMutant, indexSource);
assert.throws(() => assertConstantProcessLivenessRoute(dependencyGatedLivenessMutant), /unconditional constant response/);
const productionMiddlewareLivenessMutant = indexSource.replace(
  'app.get("/healthz", (_req, res) => {',
  `app.use("/healthz", (_req, res, next) => {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) return res.status(503).json({ ok: false });
  next();
});
app.get("/healthz", (_req, res) => {`,
);
assert.notEqual(productionMiddlewareLivenessMutant, indexSource);
assert.throws(() => assertConstantProcessLivenessRoute(productionMiddlewareLivenessMutant), /may mention \/healthz only/);
await proveProcessLivenessWithUnavailableDependencies();
assert.match(indexSource, /app\.get\(\["\/health", "\/health\/dependencies"\]/);
assert.match(indexSource, /req\.method === "OPTIONS"/);
assert.match(indexSource, /\/health\/dependencies/);
assert.match(indexSource, /required_schema_present/);
assert.match(indexSource, /expired_worker_leases/);
assert.match(indexSource, /release_manifest/);
assert.match(indexSource, /OPERATIONAL_ANALYTICS_CONTRACT_VERSION = "operational-analytics\.v1"/);
assert.match(indexSource, /operational_analytics: OPERATIONAL_ANALYTICS_CONTRACT_VERSION/);

assert.match(releaseManifestSource, /schema-fingerprint\.txt/);
assert.match(releaseManifestSource, /supabase\/migrations/);
assert.match(releaseManifestSource, /queue_compatibility_versions/);
assert.match(releaseManifestSource, /minimum_supported/);
assert.equal(frontendReleaseManifest.frontend_commit_sha, "5d0d5716e03f6179110708add09f7b2fc3afc2b3");
assert.equal(frontendReleaseManifest.frontend_commit_state, "final_pair_bound");
assert.equal(frontendReleaseManifest.api_contract_versions.operational_analytics, "operational-analytics.v1");
assert.equal(packageJson.scripts["test:schema-fingerprint"], "node scripts/schema-fingerprint-check.mjs");
assert.equal(packageJson.scripts["test:empty-db-rebuild"], "node scripts/empty-database-rebuild-check.mjs");

assert.match(sharedAuthSource, /return isProductionLike\(env\)/);

assert.match(deviceAuthSource, /"enforce-ready"/);
assert.match(deviceAuthSource, /\["enforce-ready", "enforce"\]\.includes\(requestedMode\)/);
assert.match(migration, /'enforce-ready'::text/);
assert.match(migration, /requires_physical_acceptance/);
assert.match(migration, /storage\.buckets/);

assert.match(atomicCommitMigration, /create or replace function public\.commit_cleaning_workflow/i);
assert.match(atomicCommitMigration, /v_session_location_id uuid/i);
assert.match(atomicCommitMigration, /v_session_device_pk uuid/i);
assert.match(atomicCommitMigration, /v_session_employee_id uuid/i);
assert.match(
  atomicCommitMigration,
  /v_session_location_id, v_session_device_pk, v_session_employee_id\s+from public\.sessions/i,
  "optional session lookup must write only to session identity variables",
);

for (const contract of [
  "custodial_offline_actor_contexts",
  "custodial_offline_submission_proofs",
  "occurrence_id",
  "assignment_epoch",
  "assignment_change_id",
  "occurrence_fingerprint",
  "custodial_start_offline_occurrence",
  "custodial_backend_execution_config",
]) assert.match(offlineActorRecoveryMigration, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
for (const contract of [
  "custodial_offline_reconciliation_records",
  "custodial_offline_reconciliation_audits",
  "custodial_offline_scan_event_evidence",
  "custodial_offline_time_reservations",
  "payload_fingerprint",
  "payload_fingerprint_conflict",
  "custodial_quarantine_offline_submission",
  "tool_complete_session_authoritative",
  "custodial_offline_employee_time_no_overlap",
  "custodial_offline_device_time_no_overlap",
]) assert.match(offlineAuthorityEnforcementMigration, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
assert.doesNotMatch(
  offlineActorRecoveryMigration,
  /identity_source','devices\.assigned_employee_id'/,
  "forward commit authority must not rebind an offline occurrence to the device's current employee",
);
assert.match(deviceAuthSource, /offline_recovery_only/);
assert.match(deviceAuthSource, /isOfflineRecoveryRequest/);
assert.match(deviceAuthSource, /tool_start_offline_occurrence[\s\S]*tool_commit_cleaning_workflow/,
  "stale credential recovery is limited to snapshot activation and terminal submission");
assert.doesNotMatch(
  atomicCommitMigration,
  /v_location_id, v_device_pk, v_employee_id\s+from public\.sessions/i,
  "optional session lookup must not clobber freshly resolved identity",
);
assert.match(
  atomicCommitMigration,
  /v_existing_client_completion_id is distinct from v_client_completion_id/i,
  "a completed session must reject a different completion identifier",
);
assert.match(
  atomicCommitMigration,
  /'client_completion_id', v_existing_client_completion_id/i,
  "session replay must return the stored completion identifier",
);
assert.match(
  atomicCommitMigration,
  /revoke all on function public\.commit_cleaning_workflow[\s\S]*from public, anon, authenticated/i,
);
assert.match(
  atomicCommitMigration,
  /grant execute on function public\.commit_cleaning_workflow[\s\S]*to postgres, service_role/i,
);

assert.match(schemaReconciliationMigration, /create or replace function public\.msg_ensure_ops_manager_user/i);
assert.match(schemaReconciliationMigration, /grant execute on function public\.msg_ensure_ops_manager_user[\s\S]*to service_role/i);
assert.match(schemaReconciliationMigration, /set search_path=pg_catalog,public/);
assert.match(schemaReconciliationMigration, /set local lock_timeout = '5s'/i);
assert.match(schemaReconciliationMigration, /set local statement_timeout = '60s'/i);
assert.match(schemaReconciliationMigration, /Prefer the exact real name/);
assert.match(namedManagerSharedRoomRetirementMigration, /drop function if exists public\.msg_get_or_create_ops_manager_thread\(uuid\)/i);
assert.match(namedManagerSharedRoomRetirementMigration, /update public\.msg_threads[\s\S]*is_active = false[\s\S]*ops_manager_shared_chat_v1/i);
assert.match(namedManagerSharedRoomRetirementMigration, /update public\.msg_thread_participants p[\s\S]*set left_at = coalesce\(p\.left_at, now\(\)\)[\s\S]*ops_manager_shared_chat_v1/i);
assert.match(namedManagerSharedRoomRetirementMigration, /create trigger trg_msg_reject_retired_ops_manager_shared_thread_mutation/i);
assert.match(namedManagerSharedRoomRetirementMigration, /before insert or update of system_key, is_active on public\.msg_threads/i);
assert.match(namedManagerSharedRoomRetirementMigration, /create trigger trg_msg_reject_retired_ops_manager_shared_participation/i);
assert.match(namedManagerSharedRoomRetirementMigration, /before insert or update of thread_id, left_at on public\.msg_thread_participants/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /where system_key = 'ops_manager_shared_chat_v1'[\s\S]*is_active is distinct from false/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /and p\.left_at is null/i,
  "the forward correction must only canonicalize active legacy participation");
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /before insert or update or delete on public\.msg_threads/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /before insert or update or delete on public\.msg_thread_participants/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /before insert or update or delete on public\.msg_messages/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /before insert or update or delete on public\.msg_message_audit/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /before insert or update or delete on public\.msg_receipts/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /msg_canonical_thread_pairs/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /pg_advisory_xact_lock/i);
assert.match(namedManagerSharedRoomRetirementCorrectionMigration, /msg_mark_thread_read/i);
assert.match(namedManagerSharedRoomRetirementMigration, /cannot be recreated/i);
assert.match(namedManagerSharedRoomRetirementMigration, /must remain inactive/i);
assert.match(namedManagerSharedRoomRetirementMigration, /cannot have active participants/i);
for (const tableName of [
  "custodial_employee_device_assignment_history",
  "custodial_employee_status_history",
]) {
  assert.match(
    schemaReconciliationMigration,
    new RegExp(`alter table public\\.${tableName}[\\s\\S]*enable row level security`, "i"),
  );
  assert.match(
    schemaReconciliationMigration,
    new RegExp(`alter table public\\.${tableName}[\\s\\S]*force row level security`, "i"),
  );
  assert.match(
    schemaReconciliationMigration,
    new RegExp(`create policy ${tableName}_service_all[\\s\\S]*to service_role[\\s\\S]*using \\(true\\)[\\s\\S]*with check \\(true\\)`, "i"),
  );
}
assert.match(
  schemaReconciliationMigration,
  /comment on table public\.ops_manager_notification_queue is\s+'Durable manager mobile push queue with leasing, retry and delivery audit state\.'/i,
);

assert.match(foreignKeyIndexMigration, /set lock_timeout = '5s'/);
assert.match(foreignKeyIndexMigration, /set statement_timeout = '30s'/);
assert.equal(
  (foreignKeyIndexMigration.match(/create index if not exists/gi) || []).length,
  21,
);
for (const [table, column] of [
  ["cleaning_inspections", "inspector_manager_id"],
  ["custodial_employee_device_assignment_history", "previous_employee_id"],
  ["custodial_employee_device_assignment_history", "changed_by_manager_id"],
  ["custodial_employee_status_history", "changed_by_manager_id"],
  ["device_auth_enrollment_codes", "revoked_by_manager_id"],
  ["employee_push_registrations", "device_id"],
  ["event_default_rules", "primary_venue_id"],
  ["event_push_instances", "credential_id"],
  ["event_push_instances", "device_id"],
  ["event_push_instances", "employee_id"],
  ["gemini_console_repair_jobs", "approving_credential_id"],
  ["gemini_console_repair_jobs", "authorization_message_id"],
  ["msg_message_audit", "thread_id"],
  ["ops_manager_device_security_config", "rotated_by_manager_id"],
  ["ops_manager_device_security_sessions", "credential_id"],
  ["ops_manager_enrollment_codes", "consumed_credential_id"],
  ["ops_manager_enrollment_codes", "created_by_credential_id"],
  ["ops_manager_notification_queue", "manager_id"],
  ["ops_manager_security_code_events", "credential_id"],
  ["ops_manager_security_code_events", "manager_id"],
  ["ops_manager_security_code_events", "target_device_id"],
]) {
  assert.match(
    foreignKeyIndexMigration,
    new RegExp(`on public\\.${table} \\(${column}\\)`, "i"),
  );
}

assert.match(messagingSource, /order by coalesce\(m\.sent_at, m\.created_at\) desc, m\.id desc/);
assert.match(messagingSource, /order by coalesce\(sent_at, created_at\) asc, id asc/);
assert.match(messagingSource, /p_client_message_id: clientMessageId \|\| null/);
assert.match(messagingSource, /Sender user ID must match the authenticated viewer/);
assert.match(messagingSource, /Read acknowledgement user ID must match the authenticated viewer/);
assert.match(messagingSource, /p_user_id: viewer\.effectiveUserId/);
assert.doesNotMatch(
  messagingSource,
  /runRpc\(\s*["']msg_get_or_create_ops_manager_thread["']/,
  "current Messenger routes must not bootstrap the retired shared room",
);

console.log("CUSTODIAL_REPAIR_CONTRACT_TESTS_PASS");
