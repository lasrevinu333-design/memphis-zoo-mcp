import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createOpsManagerSession, installSharedAuthRoutes } from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  OPS_MANAGER_SESSION_SECRET: "test-only-named-manager-enrollment-secret",
};
const allowedOrigin = "https://lasrevinu333-design.github.io";
const admin = {
  manager_id: "00000000-0000-4000-8000-000000000001",
  display_name: "Eric Operle",
  roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "SECURITY_ADMIN"],
  active: true,
  revoked_at: null,
};
const namedManager = {
  manager_id: "00000000-0000-4000-8000-000000000002",
  display_name: "Brandy Gull",
  roles: ["OPS_MANAGER"],
  active: true,
  revoked_at: null,
};
const adminCredential = "00000000-0000-4000-8000-000000000011";
const adminDevice = {
  credential_id: adminCredential,
  device_id: "eric-existing-desktop",
  device_label: "Eric Desktop",
  token_hash: "a".repeat(64),
  max_access_level: "full_access",
  manager_id: admin.manager_id,
  manager: admin,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  revoked_at: null,
};

const events = [];
const calls = { consume: 0, revoke: 0, shared: 0 };
let acceptNamedCode = false;
const store = {
  async find(credentialId) { return credentialId === adminCredential ? adminDevice : null; },
  async touch() {},
  async audit(event) { events.push(event); },
  async getManagerCodeRateLimit() { return null; },
  async recordManagerCodeFailure(keyHash, metadata = {}) {
    return {
      key_hash: keyHash,
      failure_count: 1,
      first_failed_at: new Date().toISOString(),
      last_failed_at: new Date().toISOString(),
      locked_until: null,
      metadata_json: metadata,
    };
  },
  async clearManagerCodeFailures() {},
  async consumeManagerEnrollmentCode(record) {
    calls.consume += 1;
    assert.match(record.code_hash, /^[a-f0-9]{64}$/);
    if (!acceptNamedCode) return { ok: false, status: 401, reason: "invalid" };
    return {
      ok: true,
      code_id: "00000000-0000-4000-8000-000000000021",
      manager: namedManager,
      trusted_device: {
        credential_id: record.credential_id,
        device_id: record.device_id,
        device_label: record.device_label,
        manager_id: namedManager.manager_id,
        manager: namedManager,
        max_access_level: "full_access",
        expires_at: record.expires_at,
      },
    };
  },
  async revokeManagerEnrollmentCode(codeId, { reason } = {}) {
    calls.revoke += 1;
    return { id: codeId, manager_id: namedManager.manager_id, status: "revoked", revoked_reason: reason };
  },
  async getSharedEnrollmentWindow() { calls.shared += 1; throw new Error("retired shared store must not be called"); },
  async createSharedEnrollmentWindow() { calls.shared += 1; throw new Error("retired shared store must not be called"); },
  async disableSharedEnrollmentWindow() { calls.shared += 1; throw new Error("retired shared store must not be called"); },
  async consumeSharedEnrollmentWindow() { calls.shared += 1; throw new Error("retired shared store must not be called"); },
};

const app = express();
app.use(express.json({ limit: "64kb" }));
installSharedAuthRoutes(app, { env, trustedDeviceStore: store, setCors() {} });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const adminToken = createOpsManagerSession({
  credentialId: adminCredential,
  deviceId: adminDevice.device_id,
  manager: admin,
  accessLevel: "full_access",
  env,
}).token;
const adminHeaders = {
  authorization: `Bearer ${adminToken}`,
  origin: allowedOrigin,
  "content-type": "application/json",
  "user-agent": "Desktop Chrome",
  "x-device-id": adminDevice.device_id,
};

async function json(path, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined || /^(GET|HEAD)$/i.test(method) ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return { response, payload: await response.json() };
}

try {
  let result = await json("/auth-api/config");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.named_manager_enrollment, true);
  assert.equal(result.payload.data.shared_48_hour_enrollment, false);
  assert.equal(result.payload.data.shared_enrollment_ttl_seconds, null);
  assert.equal(result.payload.data.trusted_device_codes, true);

  for (const retired of [
    ["GET", "/auth-api/ops/shared-enrollment"],
    ["POST", "/auth-api/ops/shared-enrollment"],
    ["POST", "/auth-api/ops/shared-enrollment/consume"],
    ["POST", `/auth-api/ops/shared-enrollment/${randomUUID()}/disable`],
  ]) {
    const result = await json(retired[1], { method: retired[0], headers: adminHeaders, body: { code: "00000000" } });
    assert.equal(result.response.status, 410, `${retired[0]} ${retired[1]} must stay retired`);
    assert.match(result.payload.error, /personal code.*named leadership account/i);
  }
  assert.equal(calls.shared, 0, "retired shared routes must not reach shared-enrollment storage");

  for (const retired of [
    ["GET", "/auth-api/ops/managers"],
    ["POST", "/auth-api/ops/pairing/consume"],
    ["POST", "/auth-api/ops/invitations/test/revoke"],
  ]) {
    const result = await json(retired[1], { method: retired[0], headers: adminHeaders, body: {} });
    assert.equal(result.response.status, 410, `${retired[0]} ${retired[1]} must stay retired`);
  }

  result = await json("/auth-api/ops/manager-codes/consume", {
    method: "POST",
    headers: { ...adminHeaders, "x-device-id": "named-browser-invalid" },
    body: { code: "00000000", device_id: "named-browser-invalid", device_label: "Invalid Named Browser" },
  });
  assert.equal(result.response.status, 401, "named browser consume must reach its handler rather than the retirement middleware");
  assert.match(result.payload.error, /one-time manager code/i);

  acceptNamedCode = true;
  result = await json("/auth-api/ops/manager-codes/consume", {
    method: "POST",
    headers: { ...adminHeaders, "x-device-id": "brandy-work-desktop" },
    body: { code: "24681357", device_id: "brandy-work-desktop", device_label: "Brandy Work Desktop" },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.data.session.manager_id, namedManager.manager_id);
  assert.equal(result.payload.data.session.manager_display_name, namedManager.display_name);
  assert.deepEqual(result.payload.data.session.roles, ["OPS_MANAGER"]);
  assert.match(result.response.headers.get("set-cookie") || "", /memphis_ops_trust=.*HttpOnly.*SameSite=None.*Secure/);

  const codeId = "00000000-0000-4000-8000-000000000021";
  result = await json(`/auth-api/ops/manager-codes/${codeId}/revoke`, {
    method: "POST",
    headers: adminHeaders,
    body: { reason: "test_named_code_revoke" },
  });
  assert.equal(result.response.status, 200, "named code revoke must remain reachable with the named code resource");
  assert.equal(result.payload.data.revoked, true);
  assert.equal(calls.revoke, 1);
  assert.equal(calls.consume, 2);
  assert.equal(events.some((event) => event.event_type === "device_enrolled_by_manager_code"), true);
  assert.equal(events.some((event) => event.event_type === "shared_manager_enrollment_route_rejected"), true);
  assert.equal(JSON.stringify(events).includes("24681357"), false, "audit events cannot contain plaintext codes");
  console.log("MANAGER_NAMED_ENROLLMENT_HTTP_INTEGRATION_PASS");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
