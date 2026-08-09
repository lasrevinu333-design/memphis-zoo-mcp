#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import {
  authenticatePresentedOpsAccessRequest,
  createOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
} from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "test",
  OPS_MANAGER_AUTH_REQUIRED: "true",
  OPS_MANAGER_ACCESS_TTL_MS: "900000",
  OPS_MANAGER_SESSION_SECRET: "manager-v2-shared-auth-test-secret-at-least-32-bytes",
};
const now = new Date();
const sessionId = "61000000-0000-4000-8000-000000000001";
const credentialId = "61000000-0000-4000-8000-000000000002";
const managerId = "61000000-0000-4000-8000-000000000003";
const deviceId = "ops-app-61000000-0000-4000-8000-000000000004";
const roles = ["OPS_MANAGER", "CUSTODIAL_MANAGER", "DIRECTOR", "SECURITY_ADMIN"];

function request(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    header(name) { return this.headers[String(name).toLowerCase()] || ""; },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function resign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", env.OPS_MANAGER_SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

const issued = createOpsManagerSession({
  credentialId,
  deviceId,
  manager: { manager_id: managerId, display_name: "Test Manager", roles },
  now,
  env,
  authMode: "manager_device_auth_v2",
  accessLevel: "full_access",
  maximumAccessLevel: "full_access",
  sessionId,
  authorityEpoch: 7,
});
assert.equal(issued.session_id, sessionId);
assert.equal(issued.credential_id, credentialId);
assert.equal(issued.device_id, deviceId);
assert.equal(issued.authority_epoch, 7);
assert.deepEqual(issued.roles, roles);
assert.equal(issued.access_level, "full_access");

const parsed = authenticatePresentedOpsAccessRequest(request(issued.token), {
  env,
  now: new Date(now.getTime() + 1_000),
});
assert.equal(parsed.ok, true);
assert.equal(parsed.session.session_id, sessionId);
assert.deepEqual(parsed.session.roles, roles);
assert.equal(parsed.session.authority_epoch, 7);

let validated = 0;
const middleware = makeOpsAccessMiddleware({
  env,
  requireWrite: true,
  managerV2SessionValidator: async (candidate) => {
    validated += 1;
    assert.equal(candidate.token, issued.token);
    assert.equal(candidate.session_id, sessionId);
    assert.equal(candidate.credential_id, credentialId);
    assert.equal(candidate.manager_id, managerId);
    assert.equal(candidate.device_id, deviceId);
    assert.equal(candidate.authority_epoch, 7);
    assert.deepEqual(candidate.roles, roles);
    return {
      ok: true,
      session: {
        session_id: sessionId,
        credential_id: credentialId,
        manager_id: managerId,
        device_id: deviceId,
        authority_epoch: 7,
        roles,
        access_level: "full_access",
        read_only: false,
      },
    };
  },
});
const req = request(issued.token);
const res = response();
let nextCalled = false;
await middleware(req, res, () => { nextCalled = true; });
assert.equal(validated, 1);
assert.equal(nextCalled, true);
assert.equal(req.memphisAuth.auth_mode, "manager_device_auth_v2");
assert.deepEqual(req.memphisAuth.roles, roles);

let sharedRouteValidationAllowed = true;
let sharedRouteValidationCount = 0;
const trustedDeviceStore = {
  async find(requestedCredentialId) {
    assert.equal(requestedCredentialId, credentialId);
    return {
      credential_id: credentialId,
      device_id: deviceId,
      max_access_level: "full_access",
      expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
      revoked_at: null,
      manager: {
        manager_id: managerId,
        display_name: "Test Manager",
        roles: [...roles].reverse(),
        active: true,
        revoked_at: null,
      },
    };
  },
  async touch() {},
  async audit() {},
  async getSharedEnrollmentWindow() {
    return { status: "inactive", active: false };
  },
  async listTrustedDevices() { return []; },
};
const sharedApp = express();
sharedApp.use(express.json());
installSharedAuthRoutes(sharedApp, {
  env,
  trustedDeviceStore,
  managerV2SessionValidator: async (candidate) => {
    sharedRouteValidationCount += 1;
    assert.equal(candidate.session_id, sessionId);
    assert.deepEqual(candidate.roles, roles);
    return sharedRouteValidationAllowed
      ? { ok: true, session: { ...candidate, roles, read_only: false, access_level: "full_access" } }
      : { ok: false, status: 401 };
  },
});
const sharedServer = sharedApp.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  sharedServer.once("listening", resolve);
  sharedServer.once("error", reject);
});
try {
  const address = sharedServer.address();
  const routeResponse = await fetch(`http://127.0.0.1:${address.port}/auth-api/ops/shared-enrollment`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(routeResponse.status, 200, "v2 Custodial Manager must retain leadership administration access");
  assert.equal((await routeResponse.json()).ok, true);
  const sessionResponse = await fetch(`http://127.0.0.1:${address.port}/auth-api/session`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(sessionResponse.status, 200, "session introspection must accept live durable v2 authority");
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.data.session.session_id, sessionId);
  assert.deepEqual(sessionPayload.data.session.roles, roles,
    "legacy trusted-device hydration must not reorder the signed canonical v2 role authority");
  sharedRouteValidationAllowed = false;
  const revokedResponse = await fetch(`http://127.0.0.1:${address.port}/auth-api/ops/shared-enrollment`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(revokedResponse.status, 401, "shared-auth routes must revalidate durable v2 session authority");
  const revokedSessionResponse = await fetch(`http://127.0.0.1:${address.port}/auth-api/session`, {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  assert.equal(revokedSessionResponse.status, 401, "session introspection must reject revoked durable v2 authority");
  assert.equal(sharedRouteValidationCount, 4);
} finally {
  await new Promise((resolve, reject) => sharedServer.close((error) => (error ? reject(error) : resolve())));
}

const denial = makeOpsAccessMiddleware({
  env,
  managerV2SessionValidator: async () => ({ ok: false, status: 401 }),
});
const deniedResponse = response();
await denial(request(issued.token), deniedResponse, () => assert.fail("revoked v2 session reached next middleware"));
assert.equal(deniedResponse.statusCode, 401);
assert.deepEqual(deniedResponse.body, { ok: false, error: "Ops Manager session is no longer authorized." });

assert.throws(() => createOpsManagerSession({
  credentialId,
  deviceId,
  manager: { manager_id: managerId, roles: ["DIRECTOR", "OPS_MANAGER"] },
  now,
  env,
  authMode: "manager_device_auth_v2",
  sessionId,
  authorityEpoch: 7,
}), /Invalid manager device-auth v2 session authority/);

const [encoded] = issued.token.split(".");
const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
for (const mutation of [
  { ...payload, roles: ["CUSTODIAL_MANAGER"] },
  { ...payload, roles: ["OPS_MANAGER", "DIRECTOR", "CUSTODIAL_MANAGER", "SECURITY_ADMIN"] },
  { ...payload, authority_epoch: 0 },
  { ...payload, device_id: "manager-browser" },
]) {
  const invalid = authenticatePresentedOpsAccessRequest(request(resign(mutation)), {
    env,
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 401);
}

console.log("manager device-auth v2 shared authorization tests passed");
