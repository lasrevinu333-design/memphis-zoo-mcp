export function buildIntegratedBackendAuthorityReleaseEvidence({
  input,
  schemaFingerprint,
  frontendManifest,
  authorityInventory,
  generatedEvidencePath,
}) {
  const migrations = authorityInventory
    .filter(({ path }) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))
    .map(({ path }) => ({ name: path.slice("supabase/migrations/".length) }));

  return {
    artifact: "integrated-backend-authority-release-evidence.v2",
    release_id: frontendManifest.release_id,
    frontend_commit_sha: frontendManifest.frontend_commit_sha,
    frontend_commit_state: frontendManifest.frontend_commit_state,
    schema_fingerprint: schemaFingerprint,
    schema_transition: frontendManifest.schema_transition,
    frontend_source_fingerprint: frontendManifest.schema_fingerprint,
    backend_contract: input.backend_contract,
    compatibility_window: {
      accepted_engine: input.accepted_engine_contract,
      required_engine: input.required_engine_contract,
      additive_phase: "20260810143000 supplies explicit activation and records no state-read proof",
      enforcement_phase: "20260810150000 routes both canonical and legacy completion through one server-authenticated transaction",
      closure_phase: "20260810160000 removes direct DML and legacy-writer authority, fences terminal conflicts, and writes manager outbox evidence",
      operational_closure_phase: "20260810170000 recovers durable exact-start proofs, retires every service-role generic writer, and runs leased reconciliation notification delivery",
      final_operational_correction_phase: "20260810190000 fences reassigned proof replay, retires alternate terminal writers and purge, and records idempotent recipient delivery evidence",
      scan_snapshot_phase: "20260813035530 exposes bounded offline scan authority and enforces exact provenance evidence shape",
      snapshot_rebind_closure_phase: "20260813050000 binds activation to an issued snapshot and derives current operational-day truth",
      canary_operational_recovery_phase: "20260813060000 adds durable exact-device pause and known-good forward restoration of canonical authority functions",
      operational_service_date_phase: "20260813070000 unifies schedules, turnover, occurrences, dashboard truth, and recovery probes at the 04:00 Central service date",
      operational_boundary_closure_phase: "20260813141806 aligns notification service dates, exact activation replay identity, and the captured rollback definition",
      device_sync_actor_groups_phase: "20260813173000 stores verified pending work groups by issued snapshot, employee, and assignment epoch while retaining the Build 22 aggregate reporter",
      release_phone_transport_and_offline_activation_phase: "20260813190000 requires a fresh immutable receipt from the designated phone's native-vault /scan-api/rpc path before resume and permits delayed activation only for work begun while snapshot, credential, and assignment authority were valid",
      u4_ops_closure_phase: "20260813210000 canonicalizes native wire timestamps, records immutable activation boundaries, enforces UUID completion identities, installs two-phase employee notification dispatch ledgers, durable manager dispatch preparation with terminal outcome-unknown restart recovery, complete notification recovery authority, and terminal notification retries, and restores the catalog-derived authority set",
      atomic_day_change_reconciliation_phase: "20260814224034 converges both preserved U4 migration histories and recognizes the existing complete child/projection receipt chain before mutable Weekly Schedule authority is reread",
      managed_schema_authority_normalization_phase: "20260815160613 removes broad future-object defaults; 20260815163346 preserves application and scheduler access through explicit role grants while keeping PUBLIC revoked, and managed postgres/supabase_admin deployment authority remains comparable without hiding application grants or role memberships",
      runtime_read_and_scan_alert_authority_phase: "20260822170000 restores the pure service-date helper only to the restricted reader and routes scan-alert delivery through the one canonical Memphis conversation without rewriting existing evidence",
      coverall_second_absence_policy_phase: "20260822222500 keeps the first absence internal and assigns each second or later absence to one distinct registered CoverAll capacity without rewriting manager overrides",
      static_weekly_runtime_identity_phase: "20260823024500 provisions one passwordless-by-source NOINHERIT login shell with only static_weekly_control_plane membership; release operations install its generated SCRAM verifier out of band before the dedicated service can become ready",
      static_weekly_family_location_truth_phase: "20260823060000 preserves the exact physical-location family behind each routing anchor across compilation, event overlays, projections, and the employee-day read surface while retaining legacy singleton reads",
      static_weekly_registered_roster_bootstrap_phase: "20260823143000 permits only the protected release operator to hydrate the complete immutable roster from one active registered authority source, rejects partial or mismatched state, and makes exact replay non-mutating",
    },
    rollback: input.rollback,
    cutover: input.cutover,
    authority_content_identity: {
      source: "complete_tracked_git_tree_from_external_signed_release_attestation",
      expected_tree_inventory: authorityInventory.map(({ path, mode, object_id }) => ({ path, mode, object_id })),
      authority_path_count: authorityInventory.length,
      migration_path_count: migrations.length,
      generated_evidence_excluded_path: generatedEvidencePath,
      binding: "The executable cutover gate verifies one external Ed25519-signed release attestation, deterministically enumerates every tracked entry in its exact backend tree, rejects non-regular or symlink authority entries and forbidden index flags, compares every worktree byte sequence and mode with its exact tree blob and mode, and separately verifies this generated evidence file against the signed digest and exact tree blob.",
    },
    manager_recovery: {
      list: "GET /admin-api/custodial/offline-reconciliations?limit=1..100&before=<ISO-8601>",
      detail: "GET /admin-api/custodial/offline-reconciliations/:reconciliationId",
      disposition: "POST /admin-api/custodial/offline-reconciliations/:reconciliationId/dispositions",
      authority: "active named manager; disposition write additionally requires DIRECTOR or SECURITY_ADMIN",
    },
    migrations,
    release_boundary: "Prepare distinct minimum-32-character backend and native-route secrets before cutover; configure their database digests immediately after the migrations that create each configuration function, retain the bridge backend artifact through the scan-snapshot phase, and require the executable health/restoration probes before traffic changes.",
  };
}
