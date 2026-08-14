#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { buildReleaseCanaryTransportProbeCall } from "../src/native-phone-transport.js";

const credentialId = "123e4567-e89b-42d3-a456-426614174000";
const requestId = "223e4567-e89b-42d3-a456-426614174000";
const credentialSecret = "native_canary_route_credential_secret_0123456789";
const body = Buffer.from('{"fn":"tool_get_system_settings","args":{}}');
const timestamp = "2026-08-13T15:00:00.000Z";
const bodyHash = createHash("sha256").update(body).digest("hex");
const message = [
  "custodial-native-request.v1", credentialId, "KIOSK_08", "POST", "/scan-api/rpc",
  bodyHash, requestId, timestamp, "custodial",
].join("\n");
const signature = createHmac("sha256", credentialSecret).update(message, "utf8").digest("hex");
const req = {
  method: "POST",
  originalUrl: "/scan-api/rpc",
  headers: {
    authorization: `Device ${credentialId}.${credentialSecret}`,
    origin: "https://localhost",
    "x-memphis-app-edition": "custodial",
    "x-memphis-native-attestation-version": "custodial-native-request.v1",
    "x-memphis-native-request-id": requestId,
    "x-memphis-native-request-timestamp": timestamp,
    "x-memphis-native-request-attestation": signature,
  },
  scanAuthorityRawBody: body,
  memphisDevice: { canonical_device_id: "KIOSK_08" },
  memphisDeviceCredential: { credential_id: credentialId },
  memphisDeviceAuth: { credentialed: true, offline_recovery_only: false },
};

req.memphisNativeRequestAttestation = {
  request_id: requestId,
  timestamp,
  signature,
};
const call = buildReleaseCanaryTransportProbeCall({
  req,
  deviceIdentifier: "KIOSK_08",
  backendCommitSha: "a".repeat(40),
  releaseId: "native-route-test",
  nativeRouteProofSecret: "native_route_proof_secret_01234567890123456789",
});
assert.equal(call.fn, "custodial_record_release_canary_transport_probe");
assert.equal(call.args.p_request_sha256, bodyHash);
assert.equal(call.args.p_native_request_id, requestId);
assert.equal(call.args.p_native_request_attestation_sha256, createHash("sha256").update(signature).digest("hex"));
assert.equal(call.args.p_native_route_proof_secret, "native_route_proof_secret_01234567890123456789");
assert.throws(
  () => buildReleaseCanaryTransportProbeCall({
    req: { ...req, memphisDeviceAuth: { credentialed: true, offline_recovery_only: true } },
    deviceIdentifier: "KIOSK_08", backendCommitSha: "a".repeat(40), releaseId: "native-route-test",
    nativeRouteProofSecret: "native_route_proof_secret_01234567890123456789",
  }),
  (error) => error?.code === "release_canary_probe_credential_required",
);

console.log(JSON.stringify({ ok: true, exact_route_call_bound: true, stale_credential_denied: true }));
