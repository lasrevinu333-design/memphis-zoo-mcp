#!/usr/bin/env node

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { createOpsManagerSession } from "../src/auth/shared-access-auth.js";
import { staticWeeklyDatabaseConnectionOptions } from "../src/static-weekly-control-plane.js";
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
const recentPast = () => new Date(Date.now() - 60_000).toISOString();
const currentTrustedDevice = (overrides = {}) => ({
  credential_id: credentialId,
  device_id: deviceId,
  max_access_level: "full_access",
  created_at: recentPast(),
  expires_at: future(),
  manager_id: manager.manager_id,
  manager: { ...manager },
  ...overrides,
});

const tlsOptions = staticWeeklyDatabaseConnectionOptions({
  connectionString: "postgresql://runtime:secret@db.example.invalid:5432/postgres?sslmode=require&sslrootcert=%2Ftmp%2Funtrusted.crt&uselibpqcompat=true",
  caPem: "-----BEGIN CERTIFICATE-----\\ntest-ca-body\\n-----END CERTIFICATE-----",
});
const tlsUrl = new URL(tlsOptions.connectionString);
assert.equal(tlsUrl.searchParams.has("sslmode"), false, "URL TLS settings must not replace the reviewed runtime CA policy");
assert.equal(tlsUrl.searchParams.has("sslrootcert"), false);
assert.equal(tlsUrl.searchParams.has("uselibpqcompat"), false);
assert.equal(tlsOptions.ssl.rejectUnauthorized, true, "the scheduler database must verify the CA and hostname");
assert.match(tlsOptions.ssl.ca, /BEGIN CERTIFICATE[\s\S]+END CERTIFICATE/);
assert.throws(() => staticWeeklyDatabaseConnectionOptions({
  connectionString: "postgresql://runtime:secret@db.example.invalid:5432/postgres?sslmode=require",
  caPem: "",
}), /certificate authority is required/i, "the production database path must fail closed without its CA");
assert.throws(() => staticWeeklyDatabaseConnectionOptions({
  connectionString: "https://db.example.invalid/postgres",
  caPem: "-----BEGIN CERTIFICATE-----\\ntest-ca-body\\n-----END CERTIFICATE-----",
}), /database_url_invalid/, "non-PostgreSQL URLs must be rejected before pool creation");
const loopbackRehearsal = staticWeeklyDatabaseConnectionOptions({
  connectionString: "postgresql://runtime:fixture@127.0.0.1:5432/mz_schema_rebuild_fixture",
  caPem: "",
  allowInsecureLoopbackRehearsal: true,
});
assert.equal(loopbackRehearsal.ssl, false, "an explicit test-only loopback rehearsal may use the disposable runner database without TLS");
assert.throws(() => staticWeeklyDatabaseConnectionOptions({
  connectionString: "postgresql://runtime:fixture@127.0.0.1:5432/postgres",
  caPem: "",
  allowInsecureLoopbackRehearsal: true,
}), /certificate authority is required/i, "the rehearsal switch is restricted to an isolated mz_schema_rebuild database");
assert.throws(() => staticWeeklyDatabaseConnectionOptions({
  connectionString: "postgresql://runtime:fixture@db.example.invalid:5432/postgres",
  caPem: "",
  allowInsecureLoopbackRehearsal: true,
}), /certificate authority is required/i, "the rehearsal switch can never weaken a non-loopback database connection");

assert.throws(() => createStaticWeeklyControlPlaneRuntime({
  env: { ...env, SUPABASE_URL: "" }, trustedDeviceStore: { async find() { return null; } }, database: {}, controlPlane: {},
}), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/i, "the scheduler runtime must not start without its required trusted-device Supabase configuration");
assert.throws(() => createStaticWeeklyControlPlaneRuntime({
  env: { ...env, NODE_ENV: "production", OPS_MANAGER_SESSION_SECRET: "" }, trustedDeviceStore: { async find() { return null; } }, database: {}, controlPlane: {},
}), /OPS_MANAGER_SESSION_SECRET must contain at least 32 characters/i, "the production scheduler runtime must fail closed before serving when its dedicated manager-session secret is absent");
assert.throws(() => createStaticWeeklyControlPlaneRuntime({
  env, trustedDeviceStore: {}, database: {}, controlPlane: {},
}), /trusted-device revocation and association store/i, "the scheduler runtime must not start with a store that cannot look up revocation state");

let lookup = async () => currentTrustedDevice();
const store = { async find(id) { return lookup(id); } };
let mutations = 0;
let snapshots = 0;
let rebuilds = 0;
let exceptionRequest = null;
let rebuildRequest = null;
let dayChangesRequest = null;
let mutationFailure = null;
const controlPlane = {
  async health() { return { ready: true }; },
  async getManagerSnapshot({ weekStart }) { snapshots += 1; return { schema: "memphis-zoo.static-weekly-manager-snapshot.v1", week_start: weekStart, authority_revision: 0 }; },
  async applyContractorCapacity() { mutations += 1; return { revision: mutations, data: { exception_id: `contractor-${mutations}` } }; },
  async applyException(request) { if (mutationFailure) throw mutationFailure; exceptionRequest = request; mutations += 1; return { revision: mutations, data: { exception_id: `runtime-${mutations}` } }; },
  async applyDayChanges(request) { dayChangesRequest = request; mutations += 1; return { operation: "apply_day_changes", revision: mutations, data: { mutation_count: request.operations.length } }; },
  async rebuildCurrentProjection(request) { rebuildRequest = request; rebuilds += 1; return { revision: request.expectedRevision + 1, data: { projection_id: `rebuild-${request.weekStart}-${request.idempotencyKey}` } }; },
};
const runtime = createStaticWeeklyControlPlaneRuntime({
  env,
  supabase: { async rpc() { return { data: { mutations_paused: false, state: "READY", authority_generation: 0, restore_id: null }, error: null }; } },
  trustedDeviceStore: store,
  database: {},
  controlPlane,
});
const server = createServer(runtime.app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function mutation() {
  const response = await fetch(`${origin}/static-weekly/exceptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ exception_type: "pto", service_date: "2026-10-06", base_version_id: "60000000-0000-4000-8000-000000000091", publication_id: "70000000-0000-4000-8000-000000000091", reason: "runtime test", payload: { slotId: "20000000-0000-4000-8000-000000000091" }, expected_revision: 0, idempotency_key: "runtime-test", week_start: "2026-10-05" }),
  });
  return { status: response.status, body: await response.json() };
}

async function managerSnapshot() {
  const response = await fetch(`${origin}/static-weekly/manager-snapshot?week_start=2026-10-05`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  return { status: response.status, body: await response.json() };
}

async function rebuildCurrentProjection() {
  const response = await fetch(`${origin}/static-weekly/rebuild-current-projection`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ week_start: "2026-10-05", expected_revision: 0, idempotency_key: "runtime-rebuild" }),
  });
  return { status: response.status, body: await response.json() };
}

async function dayChanges() {
  const response = await fetch(`${origin}/static-weekly/day-changes/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      service_date: "2026-10-06", week_start: "2026-10-05", publication_id: "70000000-0000-4000-8000-000000000091", base_version_id: "60000000-0000-4000-8000-000000000091", version_id: "60000000-0000-4000-8000-000000000091", expected_revision: 1, idempotency_key: "runtime-day-changes",
      operations: [
        { operation: "exception", exception_type: "pto", reason: "runtime call-out", payload: { slotId: "20000000-0000-4000-8000-000000000091" } },
        { operation: "cover_all", slot_id: "20000000-0000-4000-8000-000000000092", reason: "runtime CoverAll" },
      ],
    }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  let liveness = await fetch(`${origin}/healthz`);
  assert.equal(liveness.status, 200, "liveness must prove the configured scheduler process can answer");
  assert.equal(liveness.headers.get("cache-control"), "no-store");
  const livenessBody = await liveness.json();
  assert.equal(livenessBody.data.process_ready, true);
  assert.equal(livenessBody.data.probe_scope, "process_liveness");
  assert.equal(livenessBody.data.database_reachable, null, "liveness must not claim database readiness it did not check");
  assert.equal(livenessBody.data.authority_ready, null, "liveness must not claim publication authority readiness it did not check");

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
  assert.equal(exceptionRequest.projectionWeekStart, "2026-10-05", "the runtime binds each atomic mutation to the requested Monday projection week");

  response = await dayChanges();
  assert.equal(response.status, 200, "a valid trusted named-manager credential may submit one bounded daily batch");
  assert.equal(response.body.data.operation, "apply_day_changes");
  assert.equal(mutations, 2);
  assert.equal(dayChangesRequest.manager.manager_id, manager.manager_id, "the daily batch receives only the authenticated manager identity");
  assert.equal(dayChangesRequest.projectionWeekStart, "2026-10-05");
  assert.equal(dayChangesRequest.versionId, "60000000-0000-4000-8000-000000000091");
  assert.equal(dayChangesRequest.operations.length, 2, "the runtime forwards the complete daily operation set as one authority request");

  response = await rebuildCurrentProjection();
  assert.equal(response.status, 200, "a valid trusted named-manager credential may invoke rebuild-only projection recovery");
  assert.equal(response.body.data.revision, 1);
  assert.equal(rebuilds, 1);
  assert.deepEqual(rebuildRequest, { manager: exceptionRequest.manager, weekStart: "2026-10-05", expectedRevision: 0, idempotencyKey: "runtime-rebuild" }, "the named recovery endpoint passes only its manager authority and rebuild command identity");

  const retiredIncumbency = await fetch(`${origin}/static-weekly/incumbencies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ slot_id: "20000000-0000-4000-8000-000000000091", person_id: "30000000-0000-4000-8000-000000000091", effective_start: "2099-01-01" }),
  });
  assert.equal(retiredIncumbency.status, 404, "the arbitrary person/date incumbency endpoint is retired");
  assert.equal(mutations, 2, "the retired endpoint cannot reach any scheduler mutation");

  lookup = async () => currentTrustedDevice({ revoked_at: new Date().toISOString() });
  response = await mutation();
  assert.equal(response.status, 401, "a revoked trusted-device credential must be rejected before scheduler mutation");
  assert.equal(mutations, 2);

  lookup = async () => currentTrustedDevice({ manager: { ...manager, active: false, revoked_at: new Date().toISOString() } });
  response = await mutation();
  assert.equal(response.status, 403, "a revoked manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 2);

  lookup = async () => currentTrustedDevice({ manager_id: null, manager: null });
  snapshot = await managerSnapshot();
  assert.equal(snapshot.status, 403, "a removed manager/device association must be rejected before scheduler reads");
  assert.equal(snapshots, 1);
  response = await mutation();
  assert.equal(response.status, 403, "a removed manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 2);

  const otherManager = { ...manager, manager_id: "10000000-0000-4000-8000-000000000092", display_name: "Other Runtime Manager" };
  lookup = async () => currentTrustedDevice({ manager_id: otherManager.manager_id, manager: otherManager });
  response = await mutation();
  assert.equal(response.status, 403, "a changed manager/device association must be rejected before scheduler mutation");
  assert.equal(mutations, 2);

  lookup = async () => currentTrustedDevice();
  response = await mutation();
  assert.equal(response.status, 200, "the current matching manager/device association may reach the scheduler mutation boundary");
  assert.equal(mutations, 3);

  mutationFailure = Object.assign(new Error("The scheduler database connection was interrupted. No schedule change was accepted."), { code: "static_weekly_control_plane_database_unavailable" });
  response = await mutation();
  assert.equal(response.status, 503, "an interrupted authority connection is a retryable unavailable response, not a revision conflict");
  assert.equal(response.body.code, "static_weekly_control_plane_database_unavailable");
  assert.equal(mutations, 3, "an interrupted authority connection cannot report or count a mutation");
  mutationFailure = null;

  lookup = async () => { throw new Error("trusted store unavailable"); };
  response = await mutation();
  assert.equal(response.status, 500, "a trusted-device lookup failure must fail closed before scheduler mutation");
  assert.equal(mutations, 3);

  const savedFind = store.find;
  delete store.find;
  response = await mutation();
  assert.equal(response.status, 503, "an unavailable trusted-device lookup method must fail closed before scheduler mutation");
  assert.equal(mutations, 3);
  store.find = savedFind;
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function fetchHealth(controlPlaneHealth, path = "/ready") {
  const healthRuntime = createStaticWeeklyControlPlaneRuntime({
    env,
    trustedDeviceStore: store,
    database: {},
    controlPlane: { async health() { return controlPlaneHealth(); } },
  });
  const healthServer = createServer(healthRuntime.app);
  await new Promise((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${healthServer.address().port}${path}`);
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

let livenessHealthCalls = 0;
let livenessHealth = await fetchHealth(() => { livenessHealthCalls += 1; return { ready: false, active_key_count: 0 }; }, "/healthz");
assert.equal(livenessHealth.status, 200, "Render liveness must not depend on the schedule publication gate");
assert.equal(livenessHealth.body.ok, true);
assert.equal(livenessHealth.body.data.process_ready, true);
assert.equal(livenessHealth.body.data.probe_scope, "process_liveness");
assert.equal(livenessHealth.body.data.database_reachable, null);
assert.equal(livenessHealth.body.data.authority_ready, null);
assert.equal(livenessHealthCalls, 0, "liveness must not enter the database/solver readiness path");

let releaseBlockedReadiness;
const blockedReadiness = new Promise((resolve) => { releaseBlockedReadiness = resolve; });
livenessHealth = await Promise.race([
  fetchHealth(async () => { await blockedReadiness; return { ready: true }; }, "/healthz"),
  new Promise((_, reject) => setTimeout(() => reject(new Error("process liveness waited for blocked readiness")), 250)),
]);
releaseBlockedReadiness();
assert.equal(livenessHealth.status, 200, "process liveness must answer while strict readiness is indefinitely blocked");
assert.equal(livenessHealth.body.data.process_ready, true);

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
