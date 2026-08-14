#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  verifyNativeDeviceRequestAttestation,
  verifyNativeOfflineWorkAttestation,
} from "../src/auth/device-credential-auth.js";

const credentialId = "123e4567-e89b-42d3-a456-426614174000";
const employeeId = "223e4567-e89b-42d3-a456-426614174000";
const contextId = "323e4567-e89b-42d3-a456-426614174000";
const requestId = "423e4567-e89b-42d3-a456-426614174000";
const secret = "native_phone_attestation_test_secret_0123456789";
const token = `${credentialId}.${secret}`;
const requestTimestamp = "2026-08-13T15:00:00.000Z";
const rawBody = Buffer.from(JSON.stringify({ fn: "tool_get_system_settings", args: {} }));
const requestPath = "/scan-api/rpc?release_probe=1";
const requestVersion = "custodial-native-request.v1";

function hmac(message) {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function request(overrides = {}) {
  const headers = {
    authorization: `Device ${token}`,
    "x-memphis-app-edition": "custodial",
    "x-memphis-native-attestation-version": requestVersion,
    "x-memphis-native-request-id": requestId,
    "x-memphis-native-request-timestamp": requestTimestamp,
  };
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  headers["x-memphis-native-request-attestation"] = hmac([
    requestVersion, credentialId, "KIOSK_08", "POST", requestPath,
    bodySha256, requestId, requestTimestamp, "custodial",
  ].join("\n"));
  return {
    method: "POST",
    originalUrl: requestPath,
    headers,
    scanAuthorityRawBody: rawBody,
    memphisDevice: { canonical_device_id: "KIOSK_08" },
    memphisDeviceCredential: { credential_id: credentialId },
    ...overrides,
  };
}

const now = new Date("2026-08-13T15:01:00.000Z");
const verifiedRequest = verifyNativeDeviceRequestAttestation(request(), { now });
assert.equal(verifiedRequest.request_id, requestId);
assert.equal(verifiedRequest.body_sha256, createHash("sha256").update(rawBody).digest("hex"));
assert.throws(
  () => verifyNativeDeviceRequestAttestation(request({ scanAuthorityRawBody: Buffer.from("{}") }), { now }),
  (error) => error?.code === "native_request_attestation_invalid",
  "altered request bytes must invalidate the phone-vault request proof",
);
assert.throws(
  () => verifyNativeDeviceRequestAttestation(request(), { now: new Date("2026-08-13T15:03:00.001Z") }),
  (error) => error?.code === "native_request_attestation_expired",
  "an expired request proof must be rejected",
);
assert.throws(
  () => verifyNativeDeviceRequestAttestation(request(), { now: new Date("2026-08-13T14:59:44.999Z") }),
  (error) => error?.code === "native_request_attestation_expired",
  "a request proof more than fifteen seconds in the future must be rejected",
);

const startArgs = {
  p_location_code: "TETM",
  p_client_session_id: "native-attestation-session-1",
  p_client_started_at: "2026-08-13T14:45:00.000Z",
  p_snapshot_id: "a".repeat(64),
  p_snapshot_employee_id: employeeId,
  p_snapshot_assignment_epoch: 3,
  p_snapshot_credential_id: credentialId,
  p_native_start_attestation_version: "custodial-native-start.v1",
};
startArgs.p_native_start_attestation = hmac([
  startArgs.p_native_start_attestation_version, credentialId, "KIOSK_08", "TETM",
  startArgs.p_client_session_id, startArgs.p_snapshot_id, employeeId, "3", credentialId,
  startArgs.p_client_started_at,
].join("\n"));
assert.equal(verifyNativeOfflineWorkAttestation(request(), startArgs, "start").started_at, startArgs.p_client_started_at);
assert.throws(
  () => verifyNativeOfflineWorkAttestation(request(), { ...startArgs, p_location_code: "TETX" }, "start"),
  (error) => error?.code === "native_start_attestation_invalid",
  "a signed start cannot be moved to another location",
);
assert.throws(
  () => verifyNativeOfflineWorkAttestation(request(), { ...startArgs, p_snapshot_credential_id: "523e4567-e89b-42d3-a456-426614174000" }, "start"),
  (error) => error?.code === "native_start_attestation_required",
  "snapshot authority must match the authenticated credential before SQL binding",
);

const completionArgs = {
  p_location_code: "TETM",
  p_client_session_id: startArgs.p_client_session_id,
  p_client_completion_id: "native-attestation-completion-1",
  p_client_started_at: startArgs.p_client_started_at,
  p_client_ended_at: "2026-08-13T14:55:00.000Z",
  p_response_json: { __custodial_offline_reconciliation_v1: { context_id: contextId, submission_proof: "b".repeat(64) } },
  p_native_completion_attestation_version: "custodial-native-completion.v1",
};
completionArgs.p_native_completion_attestation = hmac([
  completionArgs.p_native_completion_attestation_version, credentialId, "KIOSK_08", "TETM",
  completionArgs.p_client_session_id, completionArgs.p_client_completion_id, contextId,
  completionArgs.p_client_started_at, completionArgs.p_client_ended_at,
].join("\n"));
assert.equal(verifyNativeOfflineWorkAttestation(request(), completionArgs, "completion").ended_at, completionArgs.p_client_ended_at);
assert.throws(
  () => verifyNativeOfflineWorkAttestation(request(), { ...completionArgs, p_client_ended_at: "2026-08-13T14:56:00.000Z" }, "completion"),
  (error) => error?.code === "native_completion_attestation_invalid",
  "a signed completion cannot be backdated or extended",
);

console.log(JSON.stringify({ ok: true, native_request_hmac: true, native_start_hmac: true, native_completion_hmac: true }));
