#!/usr/bin/env node

import assert from "node:assert/strict";
import { authorityHttpFailure, authorityHttpOutcome, malformedScanAuthorityOutcome, rpcFailure, scanRpcHttpOutcome, sqlStateHttpStatus } from "../src/offline-authority-http.js";

for (const [state, expected] of [
  ["42501", 403], ["P0002", 404], ["22023", 422], ["23505", 409], ["40901", 409], ["40001", 503], ["XX000", 500],
]) assert.equal(sqlStateHttpStatus(state), expected, `${state} maps to its truthful HTTP class`);

const conflict = rpcFailure({ code: "23505", message: "same key" }, "authoritative_commit");
assert.equal(conflict.status, 409);
assert.equal(conflict.code, "23505");
const fenced = authorityHttpFailure(rpcFailure({ code: "40901", message: "assignment changed" }, "authoritative_start"), "fallback");
assert.deepEqual(fenced, { status: 409, body: { ok: false, error: "assignment changed", code: "40901", retryable: false } });
const retry = authorityHttpFailure(rpcFailure({ code: "40001", message: "retry" }, "authoritative_commit"), "fallback");
assert.deepEqual(retry, { status: 503, body: { ok: false, error: "retry", code: "40001", retryable: true } });
const invalid = authorityHttpFailure(rpcFailure({ code: "22023", message: "invalid payload" }, "authoritative_commit"), "fallback");
assert.equal(invalid.status, 422);
assert.equal(invalid.body.retryable, false);
const accepted = authorityHttpOutcome({ status: "closed", replayed: false, reconciliation_id: "accepted" });
assert.equal(accepted.status, 200);
assert.equal(accepted.body.ok, true);
assert.equal(accepted.body.outcome, "accepted");
const exactReplay = authorityHttpOutcome({ status: "closed", replayed: true, reconciliation_id: "accepted" });
assert.equal(exactReplay.status, 200);
assert.equal(exactReplay.body.outcome, "replayed");
const quarantined = authorityHttpOutcome({ status: "quarantined", reason: "malformed_scan_evidence", terminal: true });
assert.equal(quarantined.status, 422);
assert.equal(quarantined.body.ok, false);
assert.equal(quarantined.body.outcome, "quarantined");
const changedContent = authorityHttpOutcome({ status: "quarantined", reason: "payload_fingerprint_conflict", terminal: true, automatic_replay_fenced: true });
assert.equal(changedContent.status, 409);
assert.equal(changedContent.body.ok, false);
assert.equal(changedContent.body.outcome, "changed_content");
for (const [functionName, data] of [
  ["tool_get_system_settings", { system_enabled: true }],
  ["tool_get_offline_scan_authority_snapshot", { schema_version: "offline-scan-snapshot.v2", snapshot_id: "a".repeat(64) }],
  ["tool_report_device_sync_status_v2", { ok: true, queue_count: 0 }],
  ["tool_get_location_scan_state", { location_code: "TETM", suggested_action: "start_session" }],
  ["tool_list_active_employees", []],
]) {
  const ordinary = scanRpcHttpOutcome(functionName, data);
  assert.equal(ordinary.status, 200, `${functionName} is an ordinary successful transport payload`);
  assert.equal(ordinary.body.ok, true);
  assert.deepEqual(ordinary.body.data, data);
}
const unknownTerminal = scanRpcHttpOutcome("tool_commit_cleaning_workflow", { ok: true });
assert.equal(unknownTerminal.status, 500, "terminal commands retain strict outcome classification");
const invalidOrdinary = scanRpcHttpOutcome("tool_get_system_settings", null);
assert.equal(invalidOrdinary.status, 500, "missing ordinary RPC data fails closed");
const malformedDevice = malformedScanAuthorityOutcome({ deviceQuarantined: true });
const malformedManager = malformedScanAuthorityOutcome({ deviceQuarantined: false });
assert.equal(malformedDevice.status, 422);
assert.equal(malformedDevice.body.ok, false);
assert.equal(malformedDevice.body.outcome, "quarantined");
assert.equal(malformedManager.status, 422);
assert.equal(malformedManager.body.ok, false);
assert.equal(malformedManager.body.outcome, "rejected");
console.log("OFFLINE_AUTHORITY_ROUTE_STATUS_PASS");
