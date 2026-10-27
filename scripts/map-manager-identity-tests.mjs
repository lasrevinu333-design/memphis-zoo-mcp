import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAP_DASHBOARD_MANAGER_SYSTEM_KEYS,
  isMapDashboardSession,
  verifyCurrentMapDashboardSession,
  verifyMapManagerAccessToken,
} from "../src/auth/map-manager-identity.js";
import {
  createOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
} from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  OPS_MANAGER_SESSION_SECRET: "map-dashboard-test-secret-32-characters-minimum",
  MEMPHIS_MAP_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
};
const manager = {
  manager_id: "11111111-1111-4111-8111-111111111111",
  display_name: "Jennifer Sheffield",
  system_key: MAP_DASHBOARD_MANAGER_SYSTEM_KEYS["jsheffield@memphiszoo.org"],
  roles: ["DIRECTOR", "CUSTODIAL_MANAGER", "SECURITY_ADMIN"],
  is_system_principal: false,
  active: true,
  revoked_at: null,
};

const accepted = await verifyMapManagerAccessToken("map-token", {
  env,
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      email: "jsheffield@memphiszoo.org",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    }),
  }),
});
assert.equal(accepted.system_key, manager.system_key);
assert.equal(accepted.email, "jsheffield@memphiszoo.org");

const ownerIdentity = await verifyMapManagerAccessToken("owner-map-token", {
  env,
  fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ id: "33333333-3333-4333-8333-333333333333", email: "eoperle@memphiszoo.org", email_confirmed_at: "2026-01-01T00:00:00.000Z" }) };
  },
});
assert.equal(ownerIdentity.system_key, "eric_custodial_manager", "the existing canonical owner Map identity is explicitly mapped");
await assert.rejects(verifyMapManagerAccessToken("unknown-map-token", {
  env, fetchImpl: async () => ({ ok: true, json: async () => ({ id: "33333333-3333-4333-8333-333333333333", email: "unregistered@memphiszoo.org", email_confirmed_at: "2026-01-01T00:00:00.000Z" }) }),
}), /does not have Custodial dashboard access/i);

const session = createOpsManagerSession({
  env,
  deviceId: "map-dashboard-test",
  manager,
  authMode: `map_identity:${manager.system_key}`,
  accessLevel: "read_only",
  maximumAccessLevel: "read_only",
});
assert.equal(isMapDashboardSession(session), true);

const ownerManager = { ...manager, manager_id: "44444444-4444-4444-8444-444444444444", display_name: "Existing Custodial Owner", system_key: "eric_custodial_manager" };
let issued = null;
const store = {
  async getManagerBySystemKey(systemKey) {
    return systemKey === manager.system_key ? manager : systemKey === ownerManager.system_key ? ownerManager : null;
  },
  async enroll(record) { issued = { ...record, manager: record.manager_id === ownerManager.manager_id ? ownerManager : manager, revoked_at: null }; return issued; },
  async find(id) { return issued?.credential_id === id ? issued : null; },
  async audit() {},
  async revoke(id) { assert.equal(id, issued.credential_id); issued.revoked_at = new Date().toISOString(); },
};
const checked = await verifyCurrentMapDashboardSession(session, { store });
assert.equal(checked.ok, true);
assert.equal(checked.session.access_level, "read_only");
assert.equal(checked.session.read_only, true);
assert.deepEqual(checked.session.roles, ["OPS_MANAGER"]);

function request(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    header(name) { return this.headers[String(name).toLowerCase()] || ""; },
  };
}

async function runMiddleware(middleware, token) {
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const req = request(token);
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await middleware(req, res, () => { nextCalled = true; });
  return { req, statusCode, payload, nextCalled };
}

const readResult = await runMiddleware(
  makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: false }),
  session.token,
);
assert.equal(readResult.nextCalled, true);
assert.equal(readResult.req.memphisAuth.read_only, true);
assert.deepEqual(readResult.req.memphisAuth.roles, ["OPS_MANAGER"]);

const writeResult = await runMiddleware(
  makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: true }),
  session.token,
);
assert.equal(writeResult.nextCalled, false);
assert.equal(writeResult.statusCode, 403);

const routes = new Map();
installSharedAuthRoutes({
  use() {},
  get(path, handler) { routes.set(`GET ${path}`, handler); },
  post(path, handler) { routes.set(`POST ${path}`, handler); },
}, { env, setCors() {}, trustedDeviceStore: store });

const originalFetch = globalThis.fetch;
let providerEmail = "jsheffield@memphiszoo.org";
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    email: providerEmail,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
  }),
});
try {
  let statusCode = 200;
  let payload = null;
  const req = {
    body: { access_token: "map-token" },
    headers: { "x-device-id": "map-site-browser" },
    header(name) { return this.headers[String(name).toLowerCase()] || ""; },
  };
  const responseHeaders = {};
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
    getHeader(name) { return responseHeaders[name.toLowerCase()]; },
  };
  await routes.get("POST /auth-api/map-session")(req, res);
  assert.equal(statusCode, 200);
  assert.equal(payload.data.identity_source, "memphis_map");
  assert.equal(payload.data.session.read_only, true);
  assert.deepEqual(payload.data.session.roles, ["OPS_MANAGER"]);
  assert.deepEqual(payload.data.manager.roles, ["OPS_MANAGER"]);
  assert.equal(payload.data.session.trusted_device, true);
  assert.equal(payload.data.session.permissions.schema, "custodial.manager-permissions.v1");
  assert.equal(payload.data.session.permissions.owner, false);
  assert.equal(payload.data.session.permissions.manage_absences, true);
  assert.equal(issued.metadata_json.identity_source, "memphis_map");
  assert.match(String(responseHeaders["set-cookie"]), /HttpOnly.*SameSite=None.*Secure/);
  const delegated = await runMiddleware(makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requiredPermission: "manage_absences" }), payload.data.session.token);
  assert.equal(delegated.nextCalled, true, "a verified Map delegate keeps the canonical bounded delegated capability");
  const generalWrite = await runMiddleware(makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: true }), payload.data.session.token);
  assert.equal(generalWrite.statusCode, 403, "delegated capability does not grant general owner writes");
  providerEmail = "eoperle@memphiszoo.org";
  await routes.get("POST /auth-api/map-session")(req, res);
  assert.equal(statusCode, 200);
  assert.equal(payload.data.session.manager_id, ownerManager.manager_id);
  assert.equal(payload.data.session.permissions.owner, true);
  assert.equal(payload.data.session.read_only, false);
  const ownerRead = await runMiddleware(makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: true }), payload.data.session.token);
  assert.equal(ownerRead.nextCalled, true);
  issued.revoked_at = new Date().toISOString();
  const staleOwner = await runMiddleware(makeOpsAccessMiddleware({ env, trustedDeviceStore: store }), payload.data.session.token);
  assert.equal(staleOwner.statusCode, 401, "revoked Map trust remains denied after canonical identity projection");
} finally {
  globalThis.fetch = originalFetch;
}

const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
assert.match(
  indexSource,
  /https:\/\/memphis-zoo-infrastructure-map\.lasrevinu333\.chatgpt\.site/,
  "Map origin must be explicitly allowed for the identity exchange",
);
assert.deepEqual(
  Object.keys(MAP_DASHBOARD_MANAGER_SYSTEM_KEYS).sort(),
  [
    "afeist@memphiszoo.org",
    "bgull@memphiszoo.org",
    "emckenney@memphiszoo.org",
    "eoperle@memphiszoo.org",
    "hlejman@memphiszoo.org",
    "jsheffield@memphiszoo.org",
  ],
);

console.log("MAP_MANAGER_IDENTITY_TESTS_PASS");
