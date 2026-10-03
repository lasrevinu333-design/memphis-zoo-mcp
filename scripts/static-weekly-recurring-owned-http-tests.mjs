import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOpsManagerSession } from "../src/auth/shared-access-auth.js";
import { createStaticWeeklyControlPlaneRuntime } from "../src/static-weekly-control-plane-runtime.js";

const env = { NODE_ENV: "test", SUPABASE_URL: "https://owned-recurring.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
  OPS_MANAGER_SESSION_SECRET: "owned-recurring-manager-session-secret-0123456789" };
const manager = { manager_id: "10000000-0000-4000-8000-000000000091", display_name: "Named Manager",
  roles: ["OPS_MANAGER"], active: true };
const credentialId = "owned-credential", deviceId = "owned-device";
const token = createOpsManagerSession({ credentialId, deviceId, manager, authMode: "trusted_device",
  accessLevel: "full_access", maximumAccessLevel: "full_access", env }).token;
const trustedRow = () => ({ credential_id: credentialId, device_id: deviceId, max_access_level: "full_access",
  manager_id: manager.manager_id, manager, created_at: new Date(Date.now()-1000).toISOString(),
  expires_at: new Date(Date.now()+60_000).toISOString(), revoked_at: null });

async function fixture(run) {
  const calls = [], retained = new Set();
  const supabase = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "custodial_begin_application_mutation_lease") {
      retained.add(args.p_request_id);
      return { data: { mutations_paused: false, authority_generation: 1 }, error: null };
    }
    if (name === "custodial_heartbeat_application_mutation_lease") return { data: true, error: null };
    if (name === "custodial_release_application_mutation_lease") {
      retained.delete(args.p_request_id);
      return { data: true, error: null };
    }
    throw new Error(`Unexpected mutation RPC ${name}`);
  } };
  const runtime = createStaticWeeklyControlPlaneRuntime({ env, supabase,
    trustedDeviceStore: { find: async () => trustedRow() }, database: {},
    controlPlane: { async health() { return { ready: true }; } }, recurringOperationRunner: run,
    recurringOperationAdmission: ({action}) => action() });
  const server = createServer(runtime.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(body, bearer = token) {
    const response = await fetch(`${origin}/static-weekly/recurring-adaptation/preview`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  return { calls, retained, post, close: () => new Promise(resolve => server.close(resolve)) };
}
const body = { effective_start: "2026-10-05", expected_revision: 1 };

{
  let work = 0;
  const f = await fixture(async ({ kind, manager: actor, body: input, signal, deadlineAt, onLaunch, onCustody }) => {
    work++;
    assert.equal(kind, "preview"); assert.equal(actor.manager_id, manager.manager_id);
    assert.deepEqual(input, body); assert.equal(signal instanceof AbortSignal, true);
    assert.equal(deadlineAt > performance.now(), true);
    onLaunch(); onCustody();
    return { source: "AUTHENTICATED_MANAGER_READBACK", admitted: false, published: false, affectedPhonesUpdated: false };
  });
  try {
    const denied = await f.post(body, null);
    assert.equal(denied.status, 401); assert.equal(work, 0);
    const malformed = await f.post({ ...body, assignments: [] });
    assert.equal(malformed.status, 422); assert.equal(work, 0);
    const accepted = await f.post(body);
    assert.equal(accepted.status, 200); assert.equal(accepted.data.data.admitted, false);
    assert.equal(work, 1);
    assert.equal(f.retained.size, 0, "only exact proved group absence and lease release precede 200");
    assert.equal(f.calls.filter(row => row.name === "custodial_release_application_mutation_lease").length >= 1, true);
  } finally { await f.close(); }
}
{
  const f = await fixture(async ({ onLaunch }) => { onLaunch(); throw new Error("synthetic unproved child"); });
  try {
    const result = await f.post(body);
    assert.equal(result.status, 503);
    assert.equal(result.data.code, "static_weekly_recurring_operation_custody_unknown");
    assert.equal(result.data.ok, false);
    assert.equal(f.retained.size, 1, "unproved child leaves its exact row as the existing restore blocker");
    assert.equal(f.calls.some(row => row.name === "custodial_release_application_mutation_lease"), false);
  } finally { await f.close(); }
}
{
  const f = await fixture(async ({ onLaunch }) => { onLaunch(); throw Object.assign(
    new Error("outcome unknown, group absent"), { code: "static_weekly_operation_outcome_unknown", groupAbsent: true }); });
  try {
    const result = await f.post(body);
    assert.equal(result.status, 503);
    assert.equal(result.data.ok, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.retained.size, 0, "proved absence permits release without claiming COMMIT outcome");
  } finally { await f.close(); }
}
console.log("static-weekly recurring operation-owned authenticated loopback checks PASS");
