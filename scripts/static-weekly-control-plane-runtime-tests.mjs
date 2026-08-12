#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOpsManagerSession } from "../src/auth/shared-access-auth.js";
import { createStaticWeeklyControlPlaneRuntime } from "../src/static-weekly-control-plane-runtime.js";

const env = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://scheduler-runtime-test.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "scheduler-runtime-test-service-role-key",
  OPS_MANAGER_SESSION_SECRET: "scheduler-runtime-test-session-secret-0123456789",
};
const manager = { manager_id: "10000000-0000-4000-8000-000000000091", display_name: "Runtime Named Manager", roles: ["OPS_MANAGER"], active: true };
const credentialId = "runtime-credential";
const deviceId = "runtime-device";
const session = createOpsManagerSession({ credentialId, deviceId, manager, authMode: "trusted_device", accessLevel: "full_access", maximumAccessLevel: "full_access", env });
const future = () => new Date(Date.now() + 60_000).toISOString();

assert.throws(() => createStaticWeeklyControlPlaneRuntime({
  env: { ...env, SUPABASE_URL: "" }, trustedDeviceStore: { async find() { return null; } }, database: {}, controlPlane: {},
}), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/i, "the scheduler runtime must not start without its required trusted-device Supabase configuration");
assert.throws(() => createStaticWeeklyControlPlaneRuntime({
  env, trustedDeviceStore: {}, database: {}, controlPlane: {},
}), /trusted-device revocation and association store/i, "the scheduler runtime must not start with a store that cannot look up revocation state");

let lookup = async () => ({
  credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(),
  manager_id: manager.manager_id,
  manager: { ...manager },
});
const store = { async find(id) { return lookup(id); } };
let mutations = 0;
const controlPlane = {
  async health() { return { ready: true }; },
  async applyException() { mutations += 1; return { revision: mutations, data: { exception_id: `runtime-${mutations}` } }; },
};
const runtime = createStaticWeeklyControlPlaneRuntime({ env, trustedDeviceStore: store, database: {}, controlPlane });
const server = createServer(runtime.app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function mutation() {
  const response = await fetch(`${origin}/static-weekly/exceptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ exception_type: "pto", service_date: "2026-10-06", base_version_id: "60000000-0000-4000-8000-000000000091", publication_id: "70000000-0000-4000-8000-000000000091", reason: "runtime test", payload: { slotId: "20000000-0000-4000-8000-000000000091" }, expected_revision: 0, idempotency_key: "runtime-test" }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  let response = await mutation();
  assert.equal(response.status, 200, "a valid trusted named-manager credential may reach the scheduler mutation boundary");
  assert.equal(mutations, 1);

  lookup = async () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(), revoked_at: new Date().toISOString(), manager_id: manager.manager_id, manager: { ...manager } });
  response = await mutation();
  assert.equal(response.status, 401, "a revoked trusted-device credential must be rejected before scheduler mutation");
  assert.equal(mutations, 1);

  lookup = async () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(), manager_id: manager.manager_id, manager: { ...manager, active: false, revoked_at: new Date().toISOString() } });
  response = await mutation();
  assert.equal(response.status, 403, "a revoked manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 1);

  lookup = async () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(), manager_id: null, manager: null });
  response = await mutation();
  assert.equal(response.status, 403, "a removed manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 1);

  const otherManager = { ...manager, manager_id: "10000000-0000-4000-8000-000000000092", display_name: "Other Runtime Manager" };
  lookup = async () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(), manager_id: otherManager.manager_id, manager: otherManager });
  response = await mutation();
  assert.equal(response.status, 403, "a changed manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 1);

  lookup = async () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access", expires_at: future(), manager_id: manager.manager_id, manager: { ...manager } });
  response = await mutation();
  assert.equal(response.status, 200, "the current matching manager/device association may reach the scheduler mutation boundary");
  assert.equal(mutations, 2);

  lookup = async () => { throw new Error("trusted store unavailable"); };
  response = await mutation();
  assert.equal(response.status, 500, "a trusted-device lookup failure must fail closed before scheduler mutation");
  assert.equal(mutations, 2);

  const savedFind = store.find;
  delete store.find;
  response = await mutation();
  assert.equal(response.status, 503, "an unavailable trusted-device lookup method must fail closed before scheduler mutation");
  assert.equal(mutations, 2);
  store.find = savedFind;
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("static weekly control-plane runtime trusted-device fail-closed tests: PASS");
