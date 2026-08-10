#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const phaseA = readFileSync("supabase/migrations/20260810143000_offline_actor_occurrence_reconciliation.sql", "utf8");
const phaseB = readFileSync("supabase/migrations/20260810150000_enforce_integrated_backend_authority.sql", "utf8");
const index = readFileSync("src/index.js", "utf8");
const auth = readFileSync("src/auth/device-credential-auth.js", "utf8");
const releaseEvidence = JSON.parse(readFileSync("release/integrated-backend-authority-evidence.json", "utf8"));

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
assert.match(index, /tool_start_offline_occurrence/);
assert.match(index, /tool_commit_cleaning_workflow_authoritative/);
assert.match(index, /tool_complete_session_authoritative/);
assert.match(index, /CUSTODIAL_BACKEND_PROOF_SECRET/);
assert.doesNotMatch(index, /custodial_issue_offline_actor_context/);
assert.match(index, /offline-reconciliations/);
assert.match(auth, /normalCommitEligible/);
assert.match(auth, /offline_recovery_only/);
assert.equal(releaseEvidence.backend_contract.authority, "offline-authority.v2");
assert.equal(releaseEvidence.compatibility_window.accepted_engine.scan, "scan.v2");
assert.equal(releaseEvidence.compatibility_window.required_engine.scan, "scan.v3.offline-authority");
assert.equal(releaseEvidence.migrations.at(-1).name, "20260810150000_enforce_integrated_backend_authority.sql");
console.log("INTEGRATED_BACKEND_AUTHORITY_CONTRACT_PASS");
