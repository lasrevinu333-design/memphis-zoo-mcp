#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const phaseA = readFileSync("supabase/migrations/20260810143000_offline_actor_occurrence_reconciliation.sql", "utf8");
const phaseB = readFileSync("supabase/migrations/20260810150000_enforce_integrated_backend_authority.sql", "utf8");
const phaseC = readFileSync("supabase/migrations/20260810160000_close_offline_authority_integrity_gaps.sql", "utf8");
const phaseD = readFileSync("supabase/migrations/20260810170000_finish_offline_authority_operational_closure.sql", "utf8");
const phaseE = readFileSync("supabase/migrations/20260810190000_final_integrated_backend_operational_correction.sql", "utf8");
const schedulerAuthority = readFileSync("supabase/migrations/20260810220000_static_weekly_scheduler_complete_authority_correction.sql", "utf8");
const schedulerClosure = readFileSync("supabase/migrations/20260810230000_static_weekly_scheduler_authority_closure_correction.sql", "utf8");
const dayChangeReconciliation = readFileSync("supabase/migrations/20260814224034_reconcile_static_weekly_day_change_receipts.sql", "utf8");
const managedSchemaUsage = readFileSync("supabase/migrations/20260815163346_restore_explicit_public_schema_usage.sql", "utf8");
const runtimeReadAndScanAlertAuthority = readFileSync("supabase/migrations/20260822170000_repair_runtime_read_and_scan_alert_authority.sql", "utf8");
const coverAllSecondAbsencePolicy = readFileSync("supabase/migrations/20260822222500_correct_coverall_second_absence_policy.sql", "utf8");
const staticWeeklyRuntimeIdentity = readFileSync("supabase/migrations/20260823024500_provision_static_weekly_runtime_identity.sql", "utf8");
const staticWeeklyRegisteredRosterBootstrap = readFileSync("supabase/migrations/20260823143000_static_weekly_registered_roster_bootstrap.sql", "utf8");
const applicationReaderReleaseRecovery = readFileSync("supabase/migrations/20260825174500_rebind_application_reader_release_recovery.sql", "utf8");
const credentialReplacementLineageFile = "20260826020000_preserve_offline_work_across_manager_credential_recovery.sql";
const credentialReplacementLineage = readFileSync(`supabase/migrations/${credentialReplacementLineageFile}`, "utf8");
const legacyScheduleWriterRetirementFile = "20260826114516_retire_legacy_daily_schedule_writers_after_static_weekly_cutover.sql";
const legacyScheduleWriterRetirement = readFileSync(`supabase/migrations/${legacyScheduleWriterRetirementFile}`, "utf8");
const applicationReaderMessengerRuntimeFile = "20260826155000_restore_application_reader_messenger_runtime.sql";
const applicationReaderEventsRuntimeFile = "20260826160000_restore_application_reader_employee_events_runtime.sql";
const vacantRosterSlotsFile = "20260827010500_static_weekly_vacant_roster_slots.sql";
const vacantRosterSlots = readFileSync(`supabase/migrations/${vacantRosterSlotsFile}`, "utf8");
const initialDraftRosterHydrationFile = "20260827024500_static_weekly_initial_draft_roster_hydration.sql";
const initialDraftRosterHydration = readFileSync(`supabase/migrations/${initialDraftRosterHydrationFile}`, "utf8");
const registeredSourceDatedStatusFile = "20260827033500_static_weekly_registered_source_dated_status.sql";
const registeredSourceDatedStatus = readFileSync(`supabase/migrations/${registeredSourceDatedStatusFile}`, "utf8");
const disasterRecoveryMutationFenceFile = "20260827150000_disaster_recovery_global_mutation_fence.sql";
const disasterRecoveryMutationFence = readFileSync(`supabase/migrations/${disasterRecoveryMutationFenceFile}`, "utf8");
const applicationReaderFeedbackRuntimeFile = "20260827151000_restore_application_reader_feedback_runtime.sql";
const applicationReaderFeedbackRuntime = readFileSync(`supabase/migrations/${applicationReaderFeedbackRuntimeFile}`, "utf8");
const outlookEventSyncAuthorityFile = "20260827152000_adopt_outlook_event_sync_authority.sql";
const outlookEventSyncAuthority = readFileSync(`supabase/migrations/${outlookEventSyncAuthorityFile}`, "utf8");
const index = readFileSync("src/index.js", "utf8");
const scanAuthorityCutover = readFileSync("src/scan-authority-cutover.js", "utf8");
const schedulerControlPlane = readFileSync("src/static-weekly-control-plane.js", "utf8");
const auth = readFileSync("src/auth/device-credential-auth.js", "utf8");
const scheduleApi = readFileSync("src/schedule-api.js", "utf8");
const nativePhoneTransport = readFileSync("src/native-phone-transport.js", "utf8");
const populatedPreflightWorkflow = readFileSync(".github/workflows/custodial-populated-schema-preflight.yml", "utf8");
const schemaFingerprintRefresh = readFileSync("scripts/refresh-schema-fingerprint.mjs", "utf8");
const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const releaseInput = JSON.parse(readFileSync("release/integrated-backend-authority-input.json", "utf8"));
const releaseEvidence = JSON.parse(readFileSync("release/integrated-backend-authority-evidence.json", "utf8"));
const productionMigrationState = JSON.parse(readFileSync("release/production-migration-state.json", "utf8"));
const canonicalCatalog = JSON.parse(readFileSync("supabase/canonical/schema-fingerprint-input.json", "utf8"));
const exactAppliedReleaseMigrations = [
  "20260825134500_scan_alert_runtime_authority_closure.sql",
  "20260825173000_restore_application_reader_device_identity.sql",
  "20260825173500_fence_application_reader_device_credentials.sql",
  "20260825174500_rebind_application_reader_release_recovery.sql",
  credentialReplacementLineageFile,
  legacyScheduleWriterRetirementFile,
  applicationReaderMessengerRuntimeFile,
  applicationReaderEventsRuntimeFile,
  vacantRosterSlotsFile,
  initialDraftRosterHydrationFile,
  registeredSourceDatedStatusFile,
];
const exactPendingReleaseMigrations = [
  disasterRecoveryMutationFenceFile,
  applicationReaderFeedbackRuntimeFile,
  outlookEventSyncAuthorityFile,
];
const exactMigrationCount = readdirSync("supabase/migrations").filter((name) => /^[0-9]{14}_.+\.sql$/.test(name)).length;

assert.match(phaseA, /Phase A is deliberately additive/i);
assert.match(phaseA, /custodial_start_offline_occurrence/i);
assert.match(phaseA, /client_session_id text not null unique/i);
assert.match(phaseA, /occurrence_fingerprint text not null unique/i);
assert.match(phaseA, /custodial_offline_submission_proofs/i);
assert.match(phaseB, /Phase B: final precedence/i);
assert.match(phaseB, /custodial_offline_employee_time_no_overlap/i);
assert.match(phaseB, /custodial_offline_device_time_no_overlap/i);
assert.match(phaseB, /custodial_offline_scan_event_evidence/i);
assert.match(phaseB, /custodial_quarantine_offline_submission/i);
assert.match(phaseB, /operational_commit_exception/i);
assert.match(phaseB, /malformed_scan_evidence/i);
assert.match(phaseB, /revoke all on table public\.custodial_offline_reconciliation_records[\s\S]*service_role/i);
assert.match(phaseB, /tool_complete_session_authoritative/i);
assert.match(phaseB, /Use tool_complete_session_authoritative through the authenticated scan backend/i);
assert.match(phaseB, /msg_delete_thread_permanently[\s\S]*Permanent Messenger thread deletion is retired/i);
assert.match(phaseB, /custodial_manager_list_offline_reconciliations/i);
assert.match(phaseB, /custodial_manager_get_offline_reconciliation/i);
assert.match(phaseB, /custodial_manager_dispose_offline_reconciliation/i);
assert.match(phaseC, /custodial_offline_reconciliation_outbox/i);
assert.match(phaseC, /custodial_reject_offline_evidence_truncate/i);
assert.match(phaseC, /custodial_lock_offline_reconciliation_keys/i);
assert.match(phaseC, /duplicate scan event identity in one payload/i);
assert.match(phaseC, /length\(coalesce\(p_execution_secret,''\)\)<32/i);
assert.match(phaseC, /custodial_manager_dispose_offline_reconciliation\([\s\S]*p_request_id uuid/i);
assert.match(phaseD, /issued_submission_proof text/i);
assert.match(phaseD, /custodial_claim_offline_reconciliation_notifications/i);
assert.match(phaseD, /custodial_finish_offline_reconciliation_notification/i);
assert.match(phaseD, /custodial_enqueue_offline_reconciliation_disposition_notice/i);
assert.match(phaseD, /app_apply_operational_command/i);
assert.match(phaseD, /app_apply_event_command/i);
assert.match(phaseD, /app_apply_schedule_command/i);
assert.match(phaseD, /revoke all on function public\.run_application_write\(text,text\), public\.run_sql_write\(text\), public\.run_sql_write\(text,text\), public\.run_sql_migration\(text,text\)/i);
assert.match(phaseD, /'durable_start_proof_replay',true/i);
assert.match(phaseE, /custodial_terminal_writer_inventory/i);
assert.match(phaseE, /custodial_claim_offline_reconciliation_notification_recipients/i);
assert.match(phaseE, /recipient_idempotent_delivery/i);
assert.match(schedulerAuthority, /static_weekly_control_plane noinherit nologin/i);
assert.match(staticWeeklyRuntimeIdentity, /create role static_weekly_runtime_20260823[\s\S]*login[\s\S]*password null[\s\S]*noinherit/i);
assert.match(staticWeeklyRuntimeIdentity, /grant static_weekly_control_plane to static_weekly_runtime_20260823/i);
assert.match(staticWeeklyRuntimeIdentity, /revoke static_weekly_release_operator from static_weekly_runtime_20260823/i);
assert.match(schedulerAuthority, /static_weekly_authority_source_documents/i);
assert.match(schedulerAuthority, /static_weekly_v3_register_authority_source/i);
assert.match(schedulerAuthority, /static_weekly_v3_constant_time_equal/i);
assert.match(schedulerAuthority, /static_weekly_v3_assert_rollback_lineage/i);
assert.match(schedulerAuthority, /static_weekly_v3_materialize_projection/i);
assert.match(schedulerClosure, /static_weekly_v4_hydrate_compiler_source/i);
assert.match(schedulerClosure, /static_weekly_v4_assert_projection_envelope/i);
assert.match(schedulerClosure, /operational_sign_verify_canary/i);
assert.doesNotMatch(schedulerControlPlane, /STATIC_WEEKLY_AUTHORITY_ATTESTATION_SECRET|createHmac\s*\(/);
assert.match(schedulerControlPlane, /static_weekly_v3_read_authority_source/);
assert.match(phaseE, /Custodial terminal history purge is retired/i);
assert.match(index, /tool_start_offline_occurrence/);
assert.match(index, /tool_commit_cleaning_workflow_authoritative/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(index, /CUSTODIAL_BACKEND_PROOF_SECRET/);
assert.match(index, /runCanonicalScanRpc/);
assert.match(scanAuthorityCutover, /return runRpc\(fn, prepared\.args\)/);
assert.doesNotMatch(index, /runPreparedScanRpc|prepared\?\.fallback|accepted legacy writer/);
assert.match(index, /tool_finish_session/);
assert.match(index, /custodial_finish_historical_session_authoritative/);
assert.match(index, /Exact UUID session and finish operation identities are required/);
assert.match(index, /sqlStateHttpStatus/);
assert.match(index, /scanRpcHttpOutcome/);
assert.match(index, /executeScanRpcTransport/);
assert.match(index, /collectBackendAuthorityHealth/);
assert.match(index, /scan_rpc_transport/);
assert.match(index, /custodial_get_release_canary_transport_probe_health/,
  "release health must read the durable exact-phone receipt instead of invoking the RPC implementation internally");
assert.match(index, /buildReleaseCanaryTransportProbeCall/,
  "the authenticated native canary route must use the exact transport recorder helper");
assert.match(nativePhoneTransport, /custodial_record_release_canary_transport_probe/,
  "the authenticated native canary route must persist its transport receipt");
assert.doesNotMatch(index, /collectBackendAuthorityHealth\([\s\S]{0,1400}executeScanRpcTransport\(/,
  "release health must not bypass the real phone HTTP and native-vault path");
assert.match(index, /action === "resume_canary" && authoritativeHealth\?\.ok !== true/,
  "physical canary resume must require the combined database and real scan-transport health probe");
assert.match(index, /runCustodialOfflineReconciliationNotificationWorker/);
assert.doesNotMatch(index, /run_application_write|force-close-session/);
assert.match(index, /app\.post\("\/admin-api\/close-ticket"[\s\S]{0,900}runRpc\("custodial_close_maintenance_ticket_authoritative"/);
assert.match(index, /app\.post\("\/dashboard-api\/close-ticket"[\s\S]{0,900}runRpc\("custodial_close_maintenance_ticket_authoritative"/);
assert.match(index, /notification_instance_key: recipient\.notification_instance_key/);
assert.match(index, /client_message_id: recipient\.client_message_id/);
assert.doesNotMatch(index, /custodial_issue_offline_actor_context/);
assert.match(index, /offline-reconciliations/);
assert.match(auth, /normalCommitEligible/);
assert.match(auth, /offline_recovery_only/);
assert.match(auth, /deviceCredentialSecretKeyId/);
assert.match(auth, /device_credential_recovery_required/);
assert.match(index, /getDeviceCredentialSecretReadiness/);
assert.doesNotMatch(scheduleApi, /maybeAutoRestroomRebalance|setInterval\([\s\S]{0,300}restroomRebalance/);
assert.match(scheduleApi, /owner:\s*"static_weekly_authority"/);
assert.equal(releaseEvidence.backend_contract.authority, "offline-authority.v5");
assert.match(releaseInput.backend_contract.device_credential_secret_gate, /Every active employee-device credential.*manager-code phone recovery.*legacy secret fallback is forbidden/i);
assert.equal(packageManifest.scripts["release:populated-schema:preflight"], "node scripts/refresh-schema-fingerprint.mjs --preflight");
assert.match(schemaFingerprintRefresh, /schema_from_fingerprint/);
assert.match(populatedPreflightWorkflow, /release:populated-schema:preflight/);
assert.match(releaseInput.cutover.phase_order[1], /exact observed production ledger head.*catalog\/privilege fingerprint.*zero target-position collisions/i);
assert.match(releaseInput.cutover.phase_order[2], /fresh post-capture backup receipt.*exact pending-migration digest.*exact source attestation/i);
assert.match(releaseInput.cutover.phase_order[3], /three exact ordered pending release-foundation migrations.*global restore mutation fence.*restricted feedback reader.*Outlook event-sync authority adoption.*ledger to advance exactly three entries.*do not replay the eleven already-applied release migrations/i);
assert.match(releaseInput.cutover.phase_order[4], /refresh and publish the already-preserved immutable weighted-schedule draft.*expected-revision and idempotency guards.*do not create a competing draft.*preserve the current publication/i);
assert.equal(releaseInput.cutover.production_migration_state, "release/production-migration-state.json");
assert.equal(productionMigrationState.artifact, "production-migration-state.v2");
assert.equal(productionMigrationState.mode, "migration_required");
assert.equal(productionMigrationState.project_ref, "rqquvtjdmugpigbndmne");
assert.equal(productionMigrationState.observed_production.ledger_head, "20260827042443");
assert.equal(productionMigrationState.observed_production.source_migration_name, "static_weekly_registered_source_dated_status");
assert.equal(productionMigrationState.observed_production.catalog_privilege_fingerprint, "155ecd281da5d5452a8c629f724af0d3df32c96df03c7803b7f715313a0e694c");
assert.equal(productionMigrationState.observed_production.catalog_capture_format, "connected_database_catalog.v1 stable normalized JSON SHA-256");
assert.equal(productionMigrationState.observed_production.public_function_count, 494);
assert.equal(productionMigrationState.observed_production.registered_source_count, 2);
assert.equal(productionMigrationState.observed_production.active_authority_key_count, 1);
assert.equal(productionMigrationState.observed_production.roster_slot_count, 22);
assert.equal(productionMigrationState.observed_production.roster_incumbency_count, 21);
assert.equal(productionMigrationState.observed_production.published_version_count, 2);
assert.equal(productionMigrationState.observed_production.draft_version_count, 0);
assert.equal(productionMigrationState.observed_production.publication_count, 2);
assert.equal(productionMigrationState.observed_production.command_receipt_count, 16);
assert.equal(productionMigrationState.observed_production.authority_revision, 16);
assert.equal(productionMigrationState.observed_production.projection_count, 2);
assert.equal(productionMigrationState.observed_production.occurrence_count, 766);
assert.equal(productionMigrationState.observed_production.application_reader_identity_policy_count, 14);
assert.equal(productionMigrationState.observed_production.application_reader_credential_select, false);
assert.equal(productionMigrationState.observed_production.production_ledger_count, 219);
assert.equal(productionMigrationState.observed_production.source_authority_migration_count, exactMigrationCount - exactPendingReleaseMigrations.length);
assert.equal(productionMigrationState.observed_production.target_schedule_slot_count, 5);
assert.equal(productionMigrationState.observed_production.vacancy_functions_present, true);
assert.equal(productionMigrationState.observed_production.hydrated_initial_draft_reader_present, true);
assert.equal(productionMigrationState.observed_production.registered_source_dated_status_excluded, true);
assert.equal(productionMigrationState.observed_production.outlook_event_sync_table_present, true);
assert.equal(productionMigrationState.target.source_migration_file, outlookEventSyncAuthorityFile);
assert.equal(productionMigrationState.target.source_migration_name, "adopt_outlook_event_sync_authority");
assert.equal(productionMigrationState.target.source_migration_version, "20260827152000");
assert.equal(productionMigrationState.target.production_ledger_version, null);
assert.equal(productionMigrationState.target.canonical_source_schema_fingerprint, "0a687e3ee3340b9c94c4fd6153d99cf1030713770ce731c2932115ad0bed099e");
assert.equal(productionMigrationState.target.public_function_count, 499);
assert.equal(productionMigrationState.target.production_ledger_count, 222);
assert.equal(productionMigrationState.target.source_authority_migration_count, exactMigrationCount);
assert.equal(productionMigrationState.target.pending_migration_count, exactPendingReleaseMigrations.length);
assert.equal(productionMigrationState.target.registered_source_dated_status_excluded, true);
assert.equal(productionMigrationState.target.expected_catalog_counts.functions, 499);
assert.equal(productionMigrationState.target.expected_catalog_counts.triggers, 310);
assert.equal(productionMigrationState.target.expected_catalog_counts.policies, 42);
assert.equal(productionMigrationState.target.expected_catalog_counts.routine_grants, 341);
assert.equal(productionMigrationState.target.expected_catalog_counts.schema_grants, 9);
assert.deepEqual(
  productionMigrationState.target.expected_catalog_counts,
  Object.fromEntries(Object.keys(productionMigrationState.target.expected_catalog_counts).map((section) => [section, canonicalCatalog[section].length])),
  "release target catalog counts must be generated from the complete canonical inventory",
);
assert.equal(productionMigrationState.authorization.production_mutation_required, true);
assert.equal(productionMigrationState.authorization.sequence_policy, "apply_exact_ordered_pending_migrations_after_release_admission");
assert.equal(productionMigrationState.backup_evidence.state, "fresh_verified_backup_required_before_mutation");
assert.equal(productionMigrationState.backup_evidence.last_verified.workflow_run_id, 33102836824);
assert.equal(productionMigrationState.backup_evidence.last_verified.source_commit, "e679618b605c10ffc4055181797743cdf01978cb");
assert.equal(productionMigrationState.backup_evidence.last_verified.artifact_sha256, "f3e7782513e3b046b04b246d509528a4b7e6cb814c7747ce6538c1b968dac8ba");
assert.equal(productionMigrationState.backup_evidence.last_verified.archive_digest, "e3a545d1af72be16e592b6c24a53c92a7e69dc08e974774286e8f0007beffcbe");
assert.equal(productionMigrationState.backup_evidence.last_verified.restore_verification, "passed");
assert.deepEqual(productionMigrationState.applied_release_migrations.map(({ file }) => file), exactAppliedReleaseMigrations);
for (const [index, migration] of productionMigrationState.applied_release_migrations.entries()) {
  assert.equal(migration.order, index + 1);
  const bytes = readFileSync(`supabase/migrations/${migration.file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), migration.sha256, `stale applied migration digest: ${migration.file}`);
}
assert.deepEqual(productionMigrationState.pending_migrations.map(({ file }) => file), exactPendingReleaseMigrations);
for (const [index, migration] of productionMigrationState.pending_migrations.entries()) {
  assert.equal(migration.order, index + 1);
  assert.equal(migration.source_migration_version, migration.file.slice(0, 14));
  const bytes = readFileSync(`supabase/migrations/${migration.file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), migration.sha256, `stale pending migration digest: ${migration.file}`);
}
assert.match(legacyScheduleWriterRetirement, /static_weekly_reject_legacy_daily_schedule_write/i);
assert.match(legacyScheduleWriterRetirement, /cron\.alter_job/i);
assert.match(vacantRosterSlots, /static_weekly_v7_create_vacant_roster_slot/i);
assert.match(vacantRosterSlots, /static_weekly_v7_fill_vacant_roster_slot/i);
assert.match(vacantRosterSlots, /shift_start<lunch_start and lunch_end<shift_end/i);
assert.match(initialDraftRosterHydration, /static_weekly_v3_read_authority_source\(\s*p_source_id uuid,\s*p_service_date date\s*\)/i);
assert.match(initialDraftRosterHydration, /static_weekly_v4_hydrate_compiler_source/i);
assert.doesNotMatch(initialDraftRosterHydration, /grant execute on function public\.static_weekly_v3_read_authority_source\(uuid,date\) to (?:public|anon|authenticated|service_role|static_weekly_release_operator|custodial_application_reader)/i);
assert.match(registeredSourceDatedStatus, /static_weekly_v5_registered_source_identity\(p_source jsonb\)/i);
assert.match(registeredSourceDatedStatus, /item-'status'/i);
assert.doesNotMatch(registeredSourceDatedStatus, /-'vacancyCapableSlotIds'/i);
assert.match(disasterRecoveryMutationFence, /create event trigger custodial_dr_guard_application_ddl/i);
assert.match(disasterRecoveryMutationFence, /custodial_heartbeat_application_mutation_lease/i);
assert.match(applicationReaderFeedbackRuntime, /create policy custodial_application_reader_system_feedback_runtime/i);
assert.match(applicationReaderFeedbackRuntime, /system_feedback_legacy_image_backups/i);
assert.match(outlookEventSyncAuthority, /create table if not exists public\.events_app_outlook_sync/i);
assert.match(outlookEventSyncAuthority, /grant delete, insert, maintain, references, select, trigger, truncate, update[\s\S]*to service_role/i);
assert.match(outlookEventSyncAuthority, /revoke all privileges on table public\.events_app_outlook_sync[\s\S]*from public, anon, authenticated, service_role, custodial_application_reader,[\s\S]*postgres, supabase_admin/i);
assert.doesNotMatch(outlookEventSyncAuthority, /grant\s+[^;]+\s+to\s+(?:anon|authenticated|custodial_application_reader)\b/i);
assert.equal(releaseEvidence.compatibility_window.accepted_engine.scan, "scan.v2");
assert.equal(releaseEvidence.compatibility_window.required_engine.scan, "scan.v4.snapshot-bound-authority");
assert.equal(releaseEvidence.migrations.at(-1).name, outlookEventSyncAuthorityFile);
assert.match(applicationReaderReleaseRecovery, /application_reader_identity_projection_bounded/i);
assert.match(applicationReaderReleaseRecovery, /custodial_application_reader_device_identity/i);
assert.match(applicationReaderReleaseRecovery, /' grant '\|\|g\.privilege_type\|\|' \('\|\|quote_ident\(a\.attname\)/i);
assert.match(applicationReaderReleaseRecovery, /\('devices','device_id'\)/i);
const correctedAuthorityHealth = applicationReaderReleaseRecovery.match(
  /create or replace function public\.custodial_backend_authority_health\(p_backend_execution_secret text\)[\s\S]*?\$function\$;/i,
)?.[0] || "";
assert.match(correctedAuthorityHealth, /application_reader_identity_projection_bounded/i);
assert.doesNotMatch(correctedAuthorityHealth, /authority_column_grants_absent/i);
assert.match(staticWeeklyRegisteredRosterBootstrap, /static_weekly_v6_initialize_registered_roster/i);
assert.match(staticWeeklyRegisteredRosterBootstrap, /static_weekly_v3_assert_release_operator/i);
assert.match(staticWeeklyRegisteredRosterBootstrap, /grant execute on function public\.static_weekly_v6_initialize_registered_roster\(uuid,uuid,text\)\s+to static_weekly_release_operator/i);
assert.doesNotMatch(staticWeeklyRegisteredRosterBootstrap, /grant execute on function public\.static_weekly_v6_initialize_registered_roster\(uuid,uuid,text\) to (?:public|anon|authenticated|service_role|static_weekly_control_plane)/i);
assert.match(runtimeReadAndScanAlertAuthority, /grant execute on function public\.get_setting_int\(text, integer\)[\s\S]*to custodial_application_reader/i);
assert.match(runtimeReadAndScanAlertAuthority, /msg_get_or_create_memphis_thread\(p_msg_user_id\)/i);
assert.doesNotMatch(runtimeReadAndScanAlertAuthority.match(/create or replace function public\.sch_get_or_create_scan_alert_thread[\s\S]*?\$function\$;/i)?.[0] || "", /insert into public\.msg_threads/i);
assert.match(coverAllSecondAbsencePolicy, /app_apply_coverall_assignment_policy_v2/i);
assert.match(coverAllSecondAbsencePolicy, /preserves the first recorded absence for internal redistribution/i);
assert.match(coverAllSecondAbsencePolicy, /coverall_capacity_employee_id/i);
assert.match(coverAllSecondAbsencePolicy, /revoke all on function public\.app_apply_coverall_assignment_policy_v2\(jsonb\) from public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(managedSchemaUsage, /grant usage on schema public[\s\S]*anon[\s\S]*authenticated[\s\S]*service_role[\s\S]*static_weekly_control_plane[\s\S]*static_weekly_release_operator/i);
assert.doesNotMatch(managedSchemaUsage, /grant usage on schema public[\s\S]*\bto public\b/i);
assert.match(releaseEvidence.compatibility_window.release_phone_transport_and_offline_activation_phase, /native-vault \/scan-api\/rpc/);
assert.match(releaseEvidence.compatibility_window.u4_ops_closure_phase,
  /wire timestamps.*activation boundaries.*UUID completion.*two-phase employee notification dispatch ledgers.*durable manager dispatch preparation.*outcome-unknown restart recovery.*notification recovery authority.*terminal notification retries.*authority set/);
assert.match(releaseEvidence.compatibility_window.atomic_day_change_reconciliation_phase, /existing complete child\/projection receipt chain.*before mutable Weekly Schedule authority/i);
assert.match(releaseEvidence.compatibility_window.managed_schema_authority_normalization_phase, /broad future-object defaults.*managed postgres\/supabase_admin deployment authority/i);
assert.match(releaseEvidence.compatibility_window.runtime_read_and_scan_alert_authority_phase, /restricted reader.*canonical Memphis conversation/i);
assert.match(releaseEvidence.compatibility_window.coverall_second_absence_policy_phase, /first absence.*internal.*second.*later absence.*distinct registered CoverAll capacity/i);
assert.match(releaseEvidence.compatibility_window.static_weekly_writer_and_device_secret_closure_phase,
  /removes the retired minute-driven 09:45 schedule writer.*manager-approved schedule or absence publication.*blocks canary resume.*manager-code recovery/i);
assert.match(releaseEvidence.compatibility_window.application_reader_runtime_recovery_phase,
  /restores restricted Messenger reads.*restores restricted Employee Events reads.*without granting browser roles/i);
assert.match(releaseEvidence.compatibility_window.static_weekly_vacancy_and_lunch_phase,
  /first-class empty schedule positions.*valid lunch inside its shift.*without synthetic identity.*static-weekly control plane/i);
assert.match(releaseEvidence.compatibility_window.disaster_recovery_foundation_phase,
  /fences application mutations.*quiescent restore lease.*restores scheduler state.*bounded feedback reader projection.*without exposing legacy images.*Outlook event-sync audit ledger.*without rewriting its rows.*browser authority/i);
assert.match(dayChangeReconciliation, /static_weekly_v4_begin_day_changes/);
assert.equal(releaseEvidence.artifact, "integrated-backend-authority-release-evidence.v2");
assert.equal(releaseEvidence.release_id, "release-2026.07.19.custodial-v3.12");
assert.equal(releaseEvidence.frontend_commit_sha, "5d0d5716e03f6179110708add09f7b2fc3afc2b3");
assert.equal(releaseEvidence.frontend_commit_state, "final_pair_bound");
assert.equal(releaseEvidence.schema_fingerprint, "0a687e3ee3340b9c94c4fd6153d99cf1030713770ce731c2932115ad0bed099e");
assert.equal(releaseEvidence.cutover.source_identity.kind, "external_signed_release_attestation");
assert.equal(releaseEvidence.cutover.source_identity.generated_evidence_excluded_from_content_identity, true);
assert.equal(Object.hasOwn(releaseInput.cutover.source_identity, "authority_content_paths"), false, "manual authority inventory is forbidden");
assert.equal(releaseInput.cutover.source_identity.authority_inventory.source, "all-tracked-paths-in-external-expected-tree");
assert.deepEqual(releaseInput.cutover.source_identity.authority_inventory.exclude, ["release/integrated-backend-authority-evidence.json"]);
assert.equal(releaseEvidence.authority_content_identity.source, "complete_tracked_git_tree_from_external_signed_release_attestation");
assert.equal(releaseEvidence.authority_content_identity.generated_evidence_excluded_path, "release/integrated-backend-authority-evidence.json");
assert.ok(Array.isArray(releaseEvidence.authority_content_identity.expected_tree_inventory));
assert.ok(releaseEvidence.authority_content_identity.expected_tree_inventory.some(({ path }) => path === "src/index.js"));
assert.ok(releaseEvidence.authority_content_identity.expected_tree_inventory.some(({ path }) => path === "scripts/integrated-backend-authority-suite-order-tests.mjs"));
assert.equal(releaseEvidence.authority_content_identity.expected_tree_inventory.some(({ path }) => path === "release/integrated-backend-authority-evidence.json"), false);
assert.equal(releaseEvidence.authority_content_identity.authority_path_count, releaseEvidence.authority_content_identity.expected_tree_inventory.length);
assert.equal(releaseEvidence.authority_content_identity.migration_path_count, exactMigrationCount);
assert.equal(releaseEvidence.migrations.length, exactMigrationCount);
assert.equal(releaseEvidence.migrations.at(-1).name, outlookEventSyncAuthorityFile);
assert.match(releaseEvidence.compatibility_window.credential_replacement_lineage_phase,
  /append-only same-device predecessor-to-successor transport lineage.*original actor, device, credential, or work evidence/i);
assert.equal(Object.hasOwn(releaseEvidence.authority_content_identity, "value"), false, "generated evidence must not self-assert a worktree-derived content hash");
console.log("INTEGRATED_BACKEND_AUTHORITY_CONTRACT_PASS");
