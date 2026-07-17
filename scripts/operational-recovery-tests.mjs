import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  opsManagerAuthRequired,
} from "../src/auth/shared-access-auth.js";

const openEnv = {
  NODE_ENV: "development",
  OPS_MANAGER_SESSION_SECRET: "operations-first-test-secret",
};
const productionDefaultEnv = {
  NODE_ENV: "production",
  OPS_MANAGER_SESSION_SECRET: "operations-first-test-secret",
};
const lockedEnv = {
  ...productionDefaultEnv,
  OPS_MANAGER_AUTH_REQUIRED: "true",
};

assert.equal(opsManagerAuthRequired(openEnv), false);
assert.equal(opsManagerAuthRequired(productionDefaultEnv), true);
assert.equal(opsManagerAuthRequired(lockedEnv), true);
const openSession = createPublicOpsManagerSession({
  env: openEnv,
  deviceId: "manager-browser-test",
  accessLevel: "full_access",
});
assert.equal(openSession.auth_mode, "operations_first");
assert.equal(openSession.access_level, "full_access");
assert.throws(
  () => createPublicOpsManagerSession({ env: productionDefaultEnv }),
  /authentication is required/i,
);
assert.throws(
  () => createPublicOpsManagerSession({ env: lockedEnv }),
  /authentication is required/i,
);

function captureRoutes(env) {
  const routes = new Map();
  const app = {
    use() {},
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
  installSharedAuthRoutes(app, { env, setCors() {}, trustedDeviceStore: null });
  return routes;
}

function request({ query = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    query,
    body: {},
    headers: lower,
    header(name) { return lower[String(name).toLowerCase()] || ""; },
  };
}

async function invoke(handler, req) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    setHeader() {},
    getHeader() { return undefined; },
    append() {},
  };
  await handler(req, res);
  return { statusCode, payload };
}

let result = await invoke(
  captureRoutes(openEnv).get("GET /auth-api/session"),
  request({ query: { access_level: "full_access" }, headers: { "X-Device-Id": "manager-browser-test" } }),
);
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.operations_first, true);
assert.equal(result.payload.data.session.access_level, "full_access");

result = await invoke(
  captureRoutes(lockedEnv).get("GET /auth-api/session"),
  request({ query: { access_level: "full_access" }, headers: { "X-Device-Id": "manager-browser-test" } }),
);
assert.equal(result.statusCode, 401);
assert.equal(result.payload.enrollment_required, true);

const operationalRecoveryMigration = resolve("supabase/migrations/20260716130000_operational_recovery.sql");
const migration = readFileSync(
  existsSync(operationalRecoveryMigration)
    ? operationalRecoveryMigration
    : resolve("supabase/legacy_migrations/20260716130000_operational_recovery.sql"),
  "utf8"
);
assert.match(migration, /device_auth_policy[\s\S]*'observe'/i);
assert.match(migration, /drop trigger if exists trg_device_auth_auto_enforce/i);
assert.match(migration, /update public\.devices[\s\S]*last_seen_at = v_now/i);
assert.match(migration, /greatest\(d\.last_seen_at, ds\.last_server_ack_at, ds\.updated_at\)/i);
assert.match(migration, /d\.assigned_employee_id is not null/i);

const moxie = readFileSync(resolve("src/routes/moxie.js"), "utf8");
assert.match(moxie, /MOXIE_AUTH_REQUIRED/);
assert.match(moxie, /if \(!MOXIE_AUTH_REQUIRED\) return true/);
assert.match(moxie, /escapeHtml\(err\.message \|\| err\)/);
assert.doesNotMatch(moxie, /Password accepted for this session/);

console.log("OPERATIONAL_RECOVERY_TESTS_PASS");
