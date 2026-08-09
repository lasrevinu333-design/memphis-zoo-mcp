#!/usr/bin/env node
import assert from "node:assert/strict";
import express from "express";
import {
  createManagerDeviceAuthV2HttpRuntime,
  installManagerDeviceAuthV2Routes,
  managerDeviceAuthV2RouteInternals,
} from "../src/auth/manager-device-auth-v2-routes.js";

const operationId = "20000000-0000-4000-8000-000000000001";
const deviceId = "ops-app-20000000-0000-4000-8000-000000000002";
const credential = `20000000-0000-4000-8000-000000000003.${"C".repeat(43)}`;
const calls = [];
let cancelCalls = 0;
const service = {
  async challenge(body, context) { calls.push({ method: "challenge", body, context }); return { ok: true, data: { method: "challenge" } }; },
  async create(body, context) { calls.push({ method: "create", body, context }); return { ok: true, data: { method: "create" } }; },
  async resume(body) { calls.push({ method: "resume", body }); return { ok: true, data: { method: "resume" } }; },
  async confirm(body, value) { calls.push({ method: "confirm", body, credential: value }); return { ok: true, data: { method: "confirm" } }; },
  async cancel(body) {
    calls.push({ method: "cancel", body });
    cancelCalls += 1;
    return {
      ok: true,
      data: {
        contract_version: "manager-device-auth.v2",
        operation_id: body.operation_id,
        status: "cancelled",
        device_id: deviceId,
        cancelled_at: "2026-08-03T01:00:00.000Z",
        result_envelope: null,
        replayed: cancelCalls > 1,
      },
    };
  },
  async remove(body, value, context) { calls.push({ method: "remove", body, credential: value, context }); return { ok: true, data: { method: "remove" } }; },
  async authorizedSession(body, value, context) { calls.push({ method: "session", body, credential: value, context }); return { ok: true, data: { method: "session" } }; },
  async sweepExpired() { return {}; },
};
let durableSessionCandidate = null;
const runtime = {
  service,
  serverSecret: "route-test-secret-that-is-at-least-thirty-two-bytes",
  repository: {
    async validateAuthorizedSession(candidate) {
      durableSessionCandidate = candidate;
      return { ok: true, session: { session_id: candidate.sessionId } };
    },
  },
};
const app = express();
app.use(express.json());
const installed = installManagerDeviceAuthV2Routes(app, { runtime });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const base = `http://127.0.0.1:${server.address().port}`;

async function post(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

try {
  const challengeBody = { operation_id: operationId, device_id: deviceId, purpose: "enroll" };
  const challenge = await post("/manager-device-auth/v2/attestation-challenges", challengeBody, { "idempotency-key": operationId });
  assert.equal(challenge.response.status, 200);
  assert.equal(challenge.body.data.method, "challenge");
  assert.equal(challenge.response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(calls.at(-1).context.deviceCredential, "");
  assert.match(calls.at(-1).context.rateKey, /^[a-f0-9]{64}$/);

  const sessionChallenge = await post("/manager-device-auth/v2/attestation-challenges", {
    ...challengeBody,
    purpose: "authorized_session",
  }, { "idempotency-key": operationId });
  assert.equal(sessionChallenge.response.status, 401);
  assert.equal(sessionChallenge.body.code, "manager_v2_invalid_device_credential");
  assert.equal(JSON.stringify(sessionChallenge.body).includes("credential"), true);

  const authenticatedChallenge = await post("/manager-device-auth/v2/attestation-challenges", {
    ...challengeBody,
    purpose: "authorized_session",
  }, { "idempotency-key": operationId, authorization: `Device ${credential}` });
  assert.equal(authenticatedChallenge.response.status, 200);
  assert.equal(calls.at(-1).context.deviceCredential, credential);

  const enrollment = await post("/manager-device-auth/v2/enrollment-operations", {
    operation_id: operationId,
    device_id: deviceId,
  }, { "idempotency-key": operationId });
  assert.equal(enrollment.response.status, 200);
  assert.equal(calls.at(-1).method, "create");

  for (const action of ["resume", "cancel"]) {
    const result = await post(`/manager-device-auth/v2/enrollment-operations/${operationId}/${action}`, {
      operation_id: operationId,
    }, { "idempotency-key": operationId });
    assert.equal(result.response.status, 200);
    if (action === "cancel") {
      assert.equal(result.body.data.contract_version, "manager-device-auth.v2");
      assert.equal(result.body.data.operation_id, operationId);
      assert.equal(result.body.data.status, "cancelled");
      assert.equal(result.body.data.result_envelope, null);
      assert.equal(result.body.data.replayed, false);
    } else {
      assert.equal(result.body.data.method, action);
    }
  }
  const cancellationReplay = await post(`/manager-device-auth/v2/enrollment-operations/${operationId}/cancel`, {
    operation_id: operationId,
  }, { "idempotency-key": operationId });
  assert.equal(cancellationReplay.response.status, 200);
  assert.equal(cancellationReplay.body.data.status, "cancelled");
  assert.equal(cancellationReplay.body.data.replayed, true);
  const confirmation = await post(`/manager-device-auth/v2/enrollment-operations/${operationId}/confirm`, {
    operation_id: operationId,
  }, { authorization: `Device ${credential}`, "idempotency-key": operationId });
  assert.equal(confirmation.response.status, 200);
  assert.equal(calls.at(-1).credential, credential);

  const mismatch = await post(`/manager-device-auth/v2/enrollment-operations/${operationId}/resume`, {
    operation_id: "20000000-0000-4000-8000-000000000099",
  }, { "idempotency-key": operationId });
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.body.code, "manager_v2_operation_conflict");

  for (const [path, expected] of [
    ["/manager-device-auth/v2/removal-operations", "remove"],
    ["/manager-device-auth/v2/authorized-sessions", "session"],
  ]) {
    const result = await post(path, { operation_id: operationId, device_id: deviceId }, {
      "idempotency-key": operationId,
      authorization: `Device ${credential}`,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.method, expected);
  }

  const wrongScheme = await post("/manager-device-auth/v2/removal-operations", {
    operation_id: operationId,
    device_id: deviceId,
  }, { "idempotency-key": operationId, authorization: `device ${credential}` });
  assert.equal(wrongScheme.response.status, 401);

  const malformedIdempotency = await post("/manager-device-auth/v2/enrollment-operations", {
    operation_id: operationId,
    device_id: deviceId,
  }, { "idempotency-key": `${operationId}, ${operationId}` });
  assert.equal(malformedIdempotency.response.status, 409);

  service.create = async () => {
    throw Object.assign(new Error("counter replay"), { code: "manager_v2_attestation_replayed", status: 409 });
  };
  const replayedAttestation = await post("/manager-device-auth/v2/enrollment-operations", {
    operation_id: operationId,
    device_id: deviceId,
  }, { "idempotency-key": operationId });
  assert.equal(replayedAttestation.response.status, 409);
  assert.equal(replayedAttestation.body.code, "manager_v2_attestation_replayed");

  service.create = async () => { throw new Error("password=must-never-cross-the-boundary"); };
  const internalFailure = await post("/manager-device-auth/v2/enrollment-operations", {
    operation_id: operationId,
    device_id: deviceId,
  }, { "idempotency-key": operationId });
  assert.equal(internalFailure.response.status, 500);
  assert.equal(internalFailure.body.code, "manager_v2_unavailable");
  assert.equal(JSON.stringify(internalFailure.body).includes("password"), false);

  assert.equal(managerDeviceAuthV2RouteInternals.enabled({ MANAGER_V2_ENABLED: "true" }), true);
  assert.equal(managerDeviceAuthV2RouteInternals.enabled({}), false);
  assert.equal(
    managerDeviceAuthV2RouteInternals.privacyRateKey({ ip: "203.0.113.7", headers: { "x-forwarded-for": "198.51.100.1" } }, runtime.serverSecret),
    managerDeviceAuthV2RouteInternals.privacyRateKey({ ip: "203.0.113.7", headers: { "x-forwarded-for": "192.0.2.9" } }, runtime.serverSecret),
    "an attacker-controlled X-Forwarded-For prefix must not rotate an enrollment rate bucket",
  );
  const durable = await installed.validateAuthorizedSession({
    session_id: operationId,
    credential_id: "20000000-0000-4000-8000-000000000005",
    device_id: deviceId,
    manager_id: "20000000-0000-4000-8000-000000000006",
    authority_epoch: 3,
    access_level: "full_access",
    roles: ["OPS_MANAGER", "DIRECTOR"],
    token: "eyJ0ZXN0Ijp0cnVlfQ.fixture_signature",
  });
  assert.equal(durable.ok, true);
  assert.equal(durableSessionCandidate.sessionId, operationId);
  assert.match(durableSessionCandidate.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(durableSessionCandidate, "token"), false);
  assert.throws(() => createManagerDeviceAuthV2HttpRuntime({ env: {} }), /manager_v2_unavailable/);
} finally {
  await installed.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log("manager device-auth v2 HTTP route tests passed");
