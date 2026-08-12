#!/usr/bin/env node

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { createOpsManagerSession } from "../src/auth/shared-access-auth.js";
import { createStaticWeeklyControlPlaneRuntime, startStaticWeeklyControlPlaneRuntime } from "../src/static-weekly-control-plane-runtime.js";

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
let snapshots = 0;
const controlPlane = {
  async health() { return { ready: true }; },
  async getManagerSnapshot({ weekStart }) { snapshots += 1; return { schema: "memphis-zoo.static-weekly-manager-snapshot.v1", week_start: weekStart, authority_revision: 0 }; },
  async applyContractorCapacity() { mutations += 1; return { revision: mutations, data: { exception_id: `contractor-${mutations}` } }; },
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

async function managerSnapshot() {
  const response = await fetch(`${origin}/static-weekly/manager-snapshot?week_start=2026-10-05`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  return { status: response.status, body: await response.json() };
}

try {
  let health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200, "health must pass only when the database authority reports ready");
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal((await health.json()).data.ready, true);

  health = await fetch(`${origin}/ready`);
  assert.equal(health.status, 200, "the deployment readiness path must share the authority health gate");

  const preflight = await fetch(`${origin}/static-weekly/manager-snapshot`, {
    method: "OPTIONS",
    headers: { Origin: "https://lasrevinu333-design.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-device-id" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://lasrevinu333-design.github.io");
  assert.match(preflight.headers.get("access-control-allow-headers") || "", /Authorization/);

  let snapshot = await managerSnapshot();
  assert.equal(snapshot.status, 200, "a currently associated named manager may read the coherent weekly snapshot");
  assert.equal(snapshot.body.data.schema, "memphis-zoo.static-weekly-manager-snapshot.v1");
  assert.equal(snapshots, 1);

  const rejectedOrigin = await fetch(`${origin}/static-weekly/manager-snapshot`, {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(rejectedOrigin.status, 204);
  assert.equal(rejectedOrigin.headers.get("access-control-allow-origin"), null, "unknown browser origins must not receive scheduler CORS access");

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
  snapshot = await managerSnapshot();
  assert.equal(snapshot.status, 403, "a removed manager/device association must be rejected before scheduler reads");
  assert.equal(snapshots, 1);
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

async function fetchHealth(controlPlaneHealth) {
  const healthRuntime = createStaticWeeklyControlPlaneRuntime({
    env,
    trustedDeviceStore: store,
    database: {},
    controlPlane: { async health() { return controlPlaneHealth(); } },
  });
  const healthServer = createServer(healthRuntime.app);
  await new Promise((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${healthServer.address().port}/ready`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => healthServer.close(resolve));
  }
}

let unavailableHealth = await fetchHealth(() => ({ ready: false, active_key_count: 0 }));
assert.equal(unavailableHealth.status, 503, "a not-ready authority must prevent deployment readiness");
assert.equal(unavailableHealth.body.ok, false);
assert.equal(unavailableHealth.body.data.active_key_count, 0);

unavailableHealth = await fetchHealth(() => { throw new Error("database unavailable"); });
assert.equal(unavailableHealth.status, 503, "an authority health failure must fail closed without exposing database errors");
assert.equal(unavailableHealth.body.code, "static_weekly_control_plane_unavailable");
assert.doesNotMatch(JSON.stringify(unavailableHealth.body), /database unavailable/);

const processTarget = new EventEmitter();
let closeCount = 0;
const started = startStaticWeeklyControlPlaneRuntime({
  env: { ...env, PORT: "0" },
  processTarget,
  logger: { log() {}, error() {} },
  trustedDeviceStore: store,
  database: {},
  controlPlane: {
    async health() { return { ready: true }; },
    async close() { closeCount += 1; },
  },
});
await new Promise((resolve, reject) => {
  if (started.server.listening) resolve();
  else {
    started.server.once("listening", resolve);
    started.server.once("error", reject);
  }
});
assert.equal(processTarget.listenerCount("SIGTERM"), 1, "the process, not the HTTP server, must own SIGTERM");
processTarget.emit("SIGTERM");
await started.shutdown();
assert.equal(started.server.listening, false, "SIGTERM must drain the HTTP listener");
assert.equal(closeCount, 1, "SIGTERM and repeated shutdown calls must close the authority pool exactly once");
assert.equal(processTarget.listenerCount("SIGTERM"), 0, "shutdown must remove process signal handlers");

assert.throws(() => startStaticWeeklyControlPlaneRuntime({
  env: { ...env, PORT: "not-a-port" }, trustedDeviceStore: store, database: {}, controlPlane,
}), /port must be an integer/i, "invalid deployment ports must fail before listening");

console.log("static weekly control-plane runtime trusted-device fail-closed tests: PASS");
