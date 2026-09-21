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

await assert.rejects(
  verifyMapManagerAccessToken("owner-map-token", {
    env,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        id: "33333333-3333-4333-8333-333333333333",
        email: "eoperle@memphiszoo.org",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      }),
    }),
  }),
  /does not have Custodial dashboard access/i,
);

const session = createOpsManagerSession({
  env,
  deviceId: "map-dashboard-test",
  manager,
  authMode: `map_identity:${manager.system_key}`,
  accessLevel: "read_only",
  maximumAccessLevel: "read_only",
});
assert.equal(isMapDashboardSession(session), true);

const store = {
  async getManagerBySystemKey(systemKey) {
    return systemKey === manager.system_key ? manager : null;
  },
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
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    email: "jsheffield@memphiszoo.org",
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
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await routes.get("POST /auth-api/map-session")(req, res);
  assert.equal(statusCode, 200);
  assert.equal(payload.data.identity_source, "memphis_map");
  assert.equal(payload.data.session.read_only, true);
  assert.deepEqual(payload.data.session.roles, ["OPS_MANAGER"]);
  assert.deepEqual(payload.data.manager.roles, ["OPS_MANAGER"]);
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
    "hlejman@memphiszoo.org",
    "jsheffield@memphiszoo.org",
  ],
);

console.log("MAP_MANAGER_IDENTITY_TESTS_PASS");
