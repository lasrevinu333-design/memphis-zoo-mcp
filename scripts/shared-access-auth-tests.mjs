import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  authenticateOpsAccessRequest,
  createAdminApiKeySession,
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  makeOpsAccessMiddleware,
  normalizeOpsAccessLevel,
} from "../src/auth/shared-access-auth.js";
import { authenticateMcpConnectorRequest } from "../src/auth/mcp-connector-auth.js";
import { loginGeminiAdmin, verifyGeminiAdminToken } from "../src/auth/gemini-admin-auth.js";

const env = {
  NODE_ENV: "production",
  ADMIN_API_KEY: "service-key",
  OPS_MANAGER_PASSWORD: "manager-password",
  OPS_MANAGER_SESSION_SECRET: "test-ops-session-secret",
  OPS_MANAGER_ACCESS_TTL_MS: "900000",
  OPS_MANAGER_TRUST_TTL_MS: String(10 * 365 * 24 * 60 * 60 * 1000),
  GEMINI_ADMIN_PASSWORD: "memzoo",
  GEMINI_ADMIN_SESSION_SECRET: "test-gemini-secret",
  MOXIE_WEB_PASSWORD: "memzoo",
  MOXIE_WEB_COOKIE_SECRET: "test-moxie-cookie-secret",
  MCP_CONNECTOR_TOKEN: "connector-secret",
  OPS_MANAGER_AUTH_REQUIRED: "true",
};

function mockRequest({ query = {}, body = {}, headers = {}, ip = "127.0.0.1" } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    query,
    body,
    ip,
    headers: normalizedHeaders,
    header(name) {
      return normalizedHeaders[String(name || "").toLowerCase()] || "";
    },
  };
}

function captureAuthRoutes(testEnv, trustedDeviceStore) {
  const routes = new Map();
  const app = {
    use() {},
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  };
  installSharedAuthRoutes(app, { setCors() {}, env: testEnv, trustedDeviceStore });
  return routes;
}

async function invokeRoute(handler, req) {
  let statusCode = 200;
  let payload = null;
  const headers = new Map();
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    sendStatus(code) { statusCode = code; return this; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    append(name, value) {
      const key = String(name).toLowerCase();
      const previous = headers.get(key);
      headers.set(key, previous == null ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]);
    },
  };
  await handler(req, res);
  return { statusCode, payload, headers };
}

function invokeMiddleware(middleware, req) {
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  middleware(req, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled, auth: req.memphisAuth || null };
}

function makeMemoryTrustedDeviceStore() {
  const rows = new Map();
  const events = [];
  return {
    rows,
    events,
    async enroll(record) { rows.set(record.credential_id, { ...record, created_at: new Date().toISOString(), revoked_at: null }); return rows.get(record.credential_id); },
    async find(id) { return rows.get(id) || null; },
    async touch(id, patch = {}) { const row = rows.get(id); if (row) rows.set(id, { ...row, ...patch, last_used_at: new Date().toISOString() }); },
    async revoke(id, reason = "logout") { const row = rows.get(id); if (row) rows.set(id, { ...row, revoked_at: new Date().toISOString(), revoked_reason: reason }); },
    async revokeActiveForDevice(deviceId, reason = "re-enrolled") {
      for (const [id, row] of rows) if (row.device_id === deviceId && !row.revoked_at) rows.set(id, { ...row, revoked_at: new Date().toISOString(), revoked_reason: reason });
    },
    async audit(event) { events.push(event); },
  };
}

function cookiePair(setCookieHeader) {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : String(setCookieHeader || "");
  return raw.split(";", 1)[0];
}

assert.equal(normalizeOpsAccessLevel("read-only"), "read_only");
assert.equal(normalizeOpsAccessLevel("READONLY"), "read_only");
assert.equal(normalizeOpsAccessLevel("anything-else"), "read_only");
assert.equal(normalizeOpsAccessLevel("full"), "full_access");
assert.throws(() => createPublicOpsManagerSession({ env }), /authentication is required/i);

const adminSession = createAdminApiKeySession({
  deviceId: "attendance-pusher",
  now: new Date("2026-05-26T15:00:00.000Z"),
  env,
});
assert.equal(adminSession.auth_mode, "admin_api_key");
assert.equal(adminSession.access_level, "full_access");

const store = makeMemoryTrustedDeviceStore();
const routes = captureAuthRoutes(env, store);
const sessionRoute = routes.get("GET /auth-api/session");
const enrollRoute = routes.get("POST /auth-api/ops/enroll");
const logoutRoute = routes.get("POST /auth-api/ops/logout");
assert.equal(typeof sessionRoute, "function");
assert.equal(typeof enrollRoute, "function");
assert.equal(typeof logoutRoute, "function");

let result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 401, "passwordless manager sessions must be rejected");
assert.equal(result.payload.enrollment_required, true);
assert.equal(store.rows.size, 0);

result = await invokeRoute(enrollRoute, mockRequest({
  body: { password: "wrong", device_id: "manager-browser-full", access_level: "full_access" },
  headers: { "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 401, "wrong manager password must be rejected");
assert.equal(store.rows.size, 0);

result = await invokeRoute(enrollRoute, mockRequest({
  body: {
    password: env.OPS_MANAGER_PASSWORD,
    device_id: "manager-browser-full",
    device_label: "Eric office computer",
    access_level: "full_access",
  },
  headers: { "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");
assert.equal(result.payload.data.session.auth_mode, "trusted_device");
assert.equal(store.rows.size, 1);
const trustCookie = cookiePair(result.headers.get("set-cookie"));
assert.match(trustCookie, /^memphis_ops_trust=/);
assert.match(String(result.headers.get("set-cookie")), /HttpOnly/);
assert.match(String(result.headers.get("set-cookie")), /Max-Age=/);
assert.equal(JSON.stringify(result.payload).includes("token_hash"), false, "server must not return the persisted hash");
const fullAccessToken = result.payload.data.session.token;

let readOnlyEnrollment = await invokeRoute(enrollRoute, mockRequest({
  body: {
    password: env.OPS_MANAGER_PASSWORD,
    device_id: "manager-browser-readonly-entry",
    device_label: "Read-only entry browser",
    access_level: "read_only",
    maximum_access_level: "read_only",
  },
}));
assert.equal(readOnlyEnrollment.statusCode, 200);
assert.equal(readOnlyEnrollment.payload.data.session.access_level, "read_only");
const readOnlyEnrollmentCookie = cookiePair(readOnlyEnrollment.headers.get("set-cookie"));
readOnlyEnrollment = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { Cookie: readOnlyEnrollmentCookie },
}));
assert.equal(readOnlyEnrollment.statusCode, 200, "one trusted-device enrollment must work for both manager hubs");
assert.equal(readOnlyEnrollment.payload.data.session.access_level, "full_access");

result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "read_only" },
  headers: { Cookie: trustCookie, "X-Device-Id": "manager-browser-full", "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "read_only");
assert.equal(result.payload.data.session.read_only, true);
const readOnlyToken = result.payload.data.session.token;

result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { Cookie: trustCookie, "X-Device-Id": "manager-browser-full", "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");

const viewMiddleware = makeOpsAccessMiddleware({ env });
const writeMiddleware = makeOpsAccessMiddleware({ env, requireWrite: true });
let guarded = invokeMiddleware(viewMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, true);
assert.equal(guarded.auth.access_level, "read_only");

guarded = invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, false);
assert.equal(guarded.statusCode, 403);

guarded = invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }));
assert.equal(guarded.nextCalled, true);

guarded = invokeMiddleware(writeMiddleware, mockRequest());
assert.equal(guarded.nextCalled, false);
assert.equal(guarded.statusCode, 401);

const fullAuth = authenticateOpsAccessRequest(mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }), { env });
assert.equal(fullAuth.ok, true);
assert.equal(fullAuth.session.access_level, "full_access");

const adminAuth = authenticateOpsAccessRequest(mockRequest({
  headers: { "X-Admin-Key": env.ADMIN_API_KEY, "X-Device-Id": "attendance-pusher" },
}), { env });
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.session.auth_mode, "admin_api_key");

result = await invokeRoute(logoutRoute, mockRequest({ headers: { Cookie: trustCookie } }));
assert.equal(result.statusCode, 200);
assert.match(String(result.headers.get("set-cookie")), /Max-Age=0/);
assert.equal(Array.from(store.rows.values())[0].revoked_reason, "user_logout");

result = await invokeRoute(sessionRoute, mockRequest({ headers: { Cookie: trustCookie } }));
assert.equal(result.statusCode, 401, "revoked trusted device cookie must not refresh a session");

assert.equal(authenticateMcpConnectorRequest(mockRequest(), { env: { ...env, MCP_CONNECTOR_TOKEN: "" } }).status, 503);
assert.equal(authenticateMcpConnectorRequest(mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }), { env: { ...env, MCP_CONNECTOR_TOKEN: "" } }).ok, false, "Ops tokens must never substitute for MCP connector auth");
assert.equal(authenticateMcpConnectorRequest(mockRequest({ headers: { Authorization: "Bearer connector-secret" } }), { env }).ok, true);

assert.throws(() => loginGeminiAdmin({ password: "wrong", env }), /Gemini password required/);
const geminiSession = loginGeminiAdmin({ password: "memzoo", env, now: new Date("2026-07-15T12:00:00Z") });
assert.equal(verifyGeminiAdminToken(geminiSession.token, { env, now: new Date("2026-07-15T12:05:00Z") }).ok, true);

const backendIndex = readFileSync(resolve("src/index.js"), "utf8");
const sharedAccess = readFileSync(resolve("src/auth/shared-access-auth.js"), "utf8");
const mcpAuth = readFileSync(resolve("src/auth/mcp-connector-auth.js"), "utf8");
function readMigration(name) {
  const current = resolve("supabase/migrations", name);
  if (existsSync(current)) return readFileSync(current, "utf8");
  return readFileSync(resolve("supabase/legacy_migrations", name), "utf8");
}
const migration = readMigration("20260715180000_ops_manager_trusted_device_auth.sql");
assert.match(backendIndex, /installSharedAuthRoutes\(app, \{ setCors: setAdminApiCors, supabase: supabaseAdmin \}\)/);
assert.match(backendIndex, /Access-Control-Allow-Credentials/);
assert.match(sharedAccess, /memphis_ops_trust/);
assert.match(sharedAccess, /Ops Manager authentication is required on this deployment/);
assert.match(sharedAccess, /operations_first/);
assert.match(sharedAccess, /trusted_device/);
assert.doesNotMatch(mcpAuth, /authenticateOpsAccessRequest|open_ops_manager/);
assert.match(migration, /ops_manager_trusted_devices/);
assert.match(migration, /ops_manager_auth_events/);
assert.match(migration, /revoke all on table public\.ops_manager_trusted_devices from public, anon, authenticated/);

const engineRoot = [
  process.env.ENGINE_FIXTURE_ROOT,
  "/home/eric/Projects/Engine-repair",
  resolve("../Engine"),
  resolve("../engine"),
  "/home/eric/Projects/memphis-zoo/Engine",
].filter(Boolean).find((candidate) => existsSync(resolve(candidate, "memphis-auth.js")));

if (engineRoot) {
  const authHelper = readFileSync(resolve(engineRoot, "memphis-auth.js"), "utf8");
  const managerHub = readFileSync(resolve(engineRoot, "ops-manager-hub.html"), "utf8");
  assert.doesNotMatch(authHelper, /const\s+OPS_SESSION_KEY|localStorage\.setItem\([^\n]*memphisOpsManagerSession\.v2/);
  assert.match(authHelper, /credentials:'include'/);
  assert.match(authHelper, /ops\/enroll/);
  assert.match(authHelper, /trust this device.*once|once on this device/i);
  assert.match(managerHub, /one time|once/i);
}

console.log("SHARED_ACCESS_AUTH_TESTS_PASS");
