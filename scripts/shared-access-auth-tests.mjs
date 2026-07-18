import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  authenticateOpsAccessRequest,
  createAdminApiKeySession,
  createOpsManagerSession,
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

function mockRequest({ query = {}, body = {}, headers = {}, params = {}, ip = "127.0.0.1" } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    query,
    body,
    params,
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

async function invokeMiddleware(middleware, req) {
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await middleware(req, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled, auth: req.memphisAuth || null };
}

function makeMemoryTrustedDeviceStore() {
  const rows = new Map();
  const events = [];
  const pairings = new Map();
  const bootstrapManager = {
    manager_id: "00000000-0000-4000-8000-000000000001",
    display_name: "Eric",
    contact_label: "test security admin",
    roles: ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    active: true,
    revoked_at: null,
    created_at: new Date().toISOString(),
  };
  let tokenCounter = 1;
  function publicRow(row) {
    const { token_hash, user_agent_hash, created_ip_hash, last_ip_hash, last_user_agent_hash, metadata_json, ...safe } = row;
    return safe;
  }
  return {
    rows,
    events,
    pairings,
    async createPairingToken(record = {}) {
      const token = String(tokenCounter++).padStart(64, "0");
      const row = {
        pairing_id: randomUUID(),
        pairing_token: token,
        created_by_credential_id: record.created_by_credential_id || null,
        created_by_device_id: record.created_by_device_id || "",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        used_at: null,
        revoked_at: null,
      };
      pairings.set(token, row);
      return { ok: true, pairing_id: row.pairing_id, pairing_token: token, expires_at: row.expires_at, ttl_seconds: 600, max_access_level: "full_access" };
    },
    async consumePairingAndEnroll(record = {}) {
      const token = String(record.pairing_token || record.token || "");
      const pairing = pairings.get(token);
      if (!pairing) return { ok: false, status: 401, reason: "invalid" };
      if (pairing.revoked_at) return { ok: false, status: 410, reason: "revoked", pairing_id: pairing.pairing_id };
      if (pairing.used_at) return { ok: false, status: 410, reason: "used", pairing_id: pairing.pairing_id };
      if (Date.parse(pairing.expires_at) <= Date.now()) return { ok: false, status: 410, reason: "expired", pairing_id: pairing.pairing_id };
      for (const [id, row] of rows) {
        if (row.device_id === record.device_id && !row.revoked_at) rows.set(id, { ...row, revoked_at: new Date().toISOString(), revoked_reason: "device_re-enrolled_by_pairing" });
      }
      const now = new Date().toISOString();
      const row = {
        credential_id: record.credential_id,
        device_id: record.device_id,
        device_label: record.device_label,
        token_hash: record.token_hash,
        max_access_level: record.max_access_level || "full_access",
        manager_id: bootstrapManager.manager_id,
        manager: bootstrapManager,
        created_at: now,
        last_used_at: null,
        expires_at: record.expires_at,
        revoked_at: null,
        revoked_reason: null,
        metadata_json: { pairing_id: pairing.pairing_id },
      };
      rows.set(record.credential_id, row);
      pairings.set(token, { ...pairing, used_at: now, used_by_credential_id: record.credential_id, used_by_device_id: record.device_id });
      return { ok: true, pairing_id: pairing.pairing_id, trusted_device: publicRow(row) };
    },
    async enroll(record) { rows.set(record.credential_id, { ...record, created_at: new Date().toISOString(), revoked_at: null }); return rows.get(record.credential_id); },
    async find(id) { const row = rows.get(id); return row ? { ...row, manager: row.manager || bootstrapManager, manager_id: row.manager_id || bootstrapManager.manager_id } : null; },
    async getManager() { return bootstrapManager; },
    async touch(id, patch = {}) { const row = rows.get(id); if (row) rows.set(id, { ...row, ...patch, last_used_at: new Date().toISOString() }); },
    async listTrustedDevices() { return Array.from(rows.values()).map(publicRow).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async revoke(id, reason = "logout") { const row = rows.get(id); if (row) rows.set(id, { ...row, revoked_at: new Date().toISOString(), revoked_reason: reason }); },
    async revokeActiveForDevice(deviceId, reason = "re-enrolled") {
      for (const [id, row] of rows) if (row.device_id === deviceId && !row.revoked_at) rows.set(id, { ...row, revoked_at: new Date().toISOString(), revoked_reason: reason });
    },
    async revokeAll(reason = "revoke_all") {
      const revoked = [];
      for (const [id, row] of rows) {
        if (!row.revoked_at) {
          const next = { ...row, revoked_at: new Date().toISOString(), revoked_reason: reason };
          rows.set(id, next);
          revoked.push(publicRow(next));
        }
      }
      return revoked;
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
const consumePairingRoute = routes.get("POST /auth-api/ops/pairing/consume");
const createPairingRoute = routes.get("POST /auth-api/ops/pairing-links");
const listTrustedRoute = routes.get("GET /auth-api/ops/trusted-devices");
const revokeTrustedRoute = routes.get("POST /auth-api/ops/trusted-devices/:credentialId/revoke");
const revokeAllRoute = routes.get("POST /auth-api/ops/trusted-devices/revoke-all");
const logoutRoute = routes.get("POST /auth-api/ops/logout");
for (const route of [sessionRoute, enrollRoute, consumePairingRoute, createPairingRoute, listTrustedRoute, revokeTrustedRoute, revokeAllRoute, logoutRoute]) assert.equal(typeof route, "function");

let result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 401, "untrusted manager sessions must be rejected");
assert.equal(result.payload.enrollment_required, true);
assert.equal(store.rows.size, 0);

result = await invokeRoute(enrollRoute, mockRequest({
  body: { device_id: "manager-browser-full", access_level: "full_access" },
  headers: { "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 410, "legacy Ops Manager enrollment route must be disabled");
assert.equal(store.rows.size, 0);

const bootstrapPairing = await store.createPairingToken({ created_by_actor: "repair_session" });
result = await invokeRoute(consumePairingRoute, mockRequest({
  body: {
    pairing_token: bootstrapPairing.pairing_token,
    device_id: "manager-browser-full",
    device_label: "Eric office computer",
    access_level: "full_access",
  },
  headers: { "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");
assert.equal(result.payload.data.session.auth_mode, "trusted_device");
assert.equal(result.payload.data.session.trusted_device, true);
assert.equal(store.rows.size, 1);
const trustCookie = cookiePair(result.headers.get("set-cookie"));
assert.match(trustCookie, /^memphis_ops_trust=/);
assert.match(String(result.headers.get("set-cookie")), /HttpOnly/);
assert.match(String(result.headers.get("set-cookie")), /Max-Age=/);
assert.equal(JSON.stringify(result.payload).includes("token_hash"), false, "server must not return persisted hashes");
const fullAccessToken = result.payload.data.session.token;
const fullCredentialId = result.payload.data.trusted_device.credential_id;

result = await invokeRoute(consumePairingRoute, mockRequest({
  body: { pairing_token: bootstrapPairing.pairing_token, device_id: "manager-browser-other", device_label: "Other browser" },
}));
assert.equal(result.statusCode, 410, "pairing tokens must be single-use");
assert.equal(store.rows.size, 1);

result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "read_only" },
  headers: { Cookie: trustCookie, "X-Device-Id": "manager-browser-full", "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "read_only");
const readOnlyToken = result.payload.data.session.token;

result = await invokeRoute(sessionRoute, mockRequest({
  query: { access_level: "full_access" },
  headers: { Cookie: trustCookie, "X-Device-Id": "manager-browser-full", "user-agent": "test-browser" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");

const opsOnlyManager = {
  manager_id: "22222222-2222-4222-8222-222222222222",
  display_name: "Ops Only",
  contact_label: "test ops manager",
  roles: ["OPS_MANAGER"],
  active: true,
  revoked_at: null,
};
const opsOnlyCredentialId = randomUUID();
const opsOnlySession = createOpsManagerSession({
  credentialId: opsOnlyCredentialId,
  deviceId: "manager-browser-ops-only",
  manager: opsOnlyManager,
  accessLevel: "full_access",
  maximumAccessLevel: "full_access",
  env,
});
store.rows.set(opsOnlyCredentialId, {
  credential_id: opsOnlyCredentialId,
  device_id: "manager-browser-ops-only",
  device_label: "Ops only browser",
  token_hash: "not-used-by-bearer-session-test",
  max_access_level: "full_access",
  manager_id: opsOnlyManager.manager_id,
  manager: opsOnlyManager,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  revoked_at: null,
  revoked_reason: null,
});

result = await invokeRoute(createPairingRoute, mockRequest({
  body: { ttl_seconds: 600 },
  headers: { Authorization: `Bearer ${opsOnlySession.token}`, "X-Device-Id": "manager-browser-ops-only" },
}));
assert.equal(result.statusCode, 403, "ordinary OPS_MANAGER cannot create manager pairing links");

result = await invokeRoute(listTrustedRoute, mockRequest({
  headers: { Authorization: `Bearer ${opsOnlySession.token}`, "X-Device-Id": "manager-browser-ops-only" },
}));
assert.equal(result.statusCode, 403, "ordinary OPS_MANAGER cannot list manager trusted devices");

result = await invokeRoute(revokeTrustedRoute, mockRequest({
  params: { credentialId: fullCredentialId },
  body: { reason: "ops_only_attempt" },
  headers: { Authorization: `Bearer ${opsOnlySession.token}`, "X-Device-Id": "manager-browser-ops-only" },
}));
assert.equal(result.statusCode, 403, "ordinary OPS_MANAGER cannot revoke manager trusted devices");
assert.notEqual(store.rows.get(fullCredentialId).revoked_reason, "ops_only_attempt");

result = await invokeRoute(revokeAllRoute, mockRequest({
  body: { reason: "ops_only_attempt_all" },
  headers: { Authorization: `Bearer ${opsOnlySession.token}`, "X-Device-Id": "manager-browser-ops-only" },
}));
assert.equal(result.statusCode, 403, "ordinary OPS_MANAGER cannot revoke all manager sessions");
store.rows.delete(opsOnlyCredentialId);

result = await invokeRoute(createPairingRoute, mockRequest({
  body: { ttl_seconds: 600 },
  headers: { Authorization: `Bearer ${fullAccessToken}`, "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 200);
assert.match(result.payload.data.enrollment_url, /ops_pairing_token=[a-f0-9]{64}/);
assert.equal(JSON.stringify(result.payload).includes("token_hash"), false, "pairing-link responses must not include persisted hashes");
const secondPairingUrl = new URL(result.payload.data.enrollment_url);
const secondPairingToken = secondPairingUrl.searchParams.get("ops_pairing_token");

result = await invokeRoute(listTrustedRoute, mockRequest({
  headers: { Authorization: `Bearer ${fullAccessToken}`, "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.devices.length, 1);
assert.equal(JSON.stringify(result.payload).includes("token_hash"), false, "trusted-device list must not include token hashes");

result = await invokeRoute(consumePairingRoute, mockRequest({
  body: { pairing_token: secondPairingToken, device_id: "manager-browser-second", device_label: "Second trusted manager" },
}));
assert.equal(result.statusCode, 200);
assert.equal(store.rows.size, 2);
const secondCredentialId = result.payload.data.trusted_device.credential_id;

result = await invokeRoute(revokeTrustedRoute, mockRequest({
  params: { credentialId: secondCredentialId },
  body: { reason: "unit_test_revoke" },
  headers: { Authorization: `Bearer ${fullAccessToken}`, "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 200);
assert.equal(store.rows.get(secondCredentialId).revoked_reason, "unit_test_revoke");

const viewMiddleware = makeOpsAccessMiddleware({ env, trustedDeviceStore: store });
const writeMiddleware = makeOpsAccessMiddleware({ env, requireWrite: true, trustedDeviceStore: store });
let guarded = await invokeMiddleware(viewMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, true);
assert.equal(guarded.auth.access_level, "read_only");

guarded = await invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${readOnlyToken}` } }));
assert.equal(guarded.nextCalled, false);
assert.equal(guarded.statusCode, 403);

guarded = await invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }));
assert.equal(guarded.nextCalled, true);

guarded = await invokeMiddleware(writeMiddleware, mockRequest());
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

result = await invokeRoute(revokeAllRoute, mockRequest({
  body: { reason: "unit_test_revoke_all" },
  headers: { Authorization: `Bearer ${fullAccessToken}`, "X-Device-Id": "manager-browser-full" },
}));
assert.equal(result.statusCode, 200);
assert.equal(store.rows.get(fullCredentialId).revoked_reason, "unit_test_revoke_all");

guarded = await invokeMiddleware(writeMiddleware, mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }));
assert.equal(guarded.nextCalled, false, "revoked trusted-device bearer token must fail immediately when the store is available");
assert.equal(guarded.statusCode, 401);

result = await invokeRoute(sessionRoute, mockRequest({ headers: { Authorization: `Bearer ${fullAccessToken}` } }));
assert.equal(result.statusCode, 401, "revoked trusted-device bearer token must not refresh a session");

result = await invokeRoute(sessionRoute, mockRequest({ headers: { Cookie: trustCookie } }));
assert.equal(result.statusCode, 401, "revoked trusted device cookie must not refresh a session");

const replacementPairing = await store.createPairingToken({ created_by_actor: "repair_session" });
result = await invokeRoute(consumePairingRoute, mockRequest({
  body: {
    pairing_token: replacementPairing.pairing_token,
    device_id: "manager-browser-full",
    device_label: "Eric office computer re-enrolled",
    access_level: "full_access",
  },
}));
assert.equal(result.statusCode, 200, "current browser can be re-enrolled using a fresh pairing link");
const replacementCookie = cookiePair(result.headers.get("set-cookie"));

result = await invokeRoute(logoutRoute, mockRequest({ headers: { Cookie: replacementCookie } }));
assert.equal(result.statusCode, 200);
assert.match(String(result.headers.get("set-cookie")), /Max-Age=0/);

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
const trustedDeviceMigration = readMigration("20260715180000_ops_manager_trusted_device_auth.sql");
const pairingMigration = readMigration("20260717175320_ops_manager_pairing_links.sql");
const managerCodeMigration = readMigration("20260717235932_ops_manager_one_time_codes.sql");
assert.match(backendIndex, /installSharedAuthRoutes\(app, \{ setCors: setAdminApiCors, supabase: supabaseAdmin, trustedDeviceStore: opsTrustedDeviceStore \}\)/);
assert.match(backendIndex, /Access-Control-Allow-Credentials/);
assert.match(sharedAccess, /memphis_ops_trust/);
assert.match(sharedAccess, /ops\/manager-codes\/consume/);
assert.match(sharedAccess, /enrollment-codes/);
assert.match(sharedAccess, /ops\/pairing\/consume/);
assert.match(sharedAccess, /ops\/pairing-links/);
assert.match(sharedAccess, /Ops Manager enrollment uses one-time manager codes on the normal Hub URL/);
assert.match(sharedAccess, /Ops Manager authentication is required on this deployment/);
assert.match(sharedAccess, /operations_first/);
assert.match(sharedAccess, /trusted_device/);
assert.doesNotMatch(mcpAuth, /authenticateOpsAccessRequest|open_ops_manager/);
assert.match(trustedDeviceMigration, /ops_manager_trusted_devices/);
assert.match(trustedDeviceMigration, /ops_manager_auth_events/);
assert.match(trustedDeviceMigration, /revoke all on table public\.ops_manager_trusted_devices from public, anon, authenticated/);
assert.match(pairingMigration, /ops_manager_pairing_tokens/);
assert.match(pairingMigration, /ops_manager_create_pairing_token/);
assert.match(pairingMigration, /ops_manager_consume_pairing_and_enroll/);
assert.match(pairingMigration, /revoke all on table public\.ops_manager_pairing_tokens from public, anon, authenticated/);
assert.match(managerCodeMigration, /ops_manager_enrollment_codes/);
assert.match(managerCodeMigration, /ops_manager_consume_enrollment_code/);
assert.match(managerCodeMigration, /revoke all on table public\.ops_manager_enrollment_codes from public, anon, authenticated/);

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
  const managerAccess = readFileSync(resolve(engineRoot, "manager-access.html"), "utf8");
  const deviceSecurity = readFileSync(resolve(engineRoot, "device-security.html"), "utf8");
  assert.doesNotMatch(authHelper, /const\s+OPS_SESSION_KEY|localStorage\.setItem\([^\n]*memphisOpsManagerSession\.v2/);
  assert.match(authHelper, /credentials:'include'/);
  assert.match(authHelper, /ops\/pairing\/consume/);
  assert.match(authHelper, /ops\/pairing-links/);
  assert.match(authHelper, /ops\/manager-codes\/consume/);
  assert.doesNotMatch(authHelper, /ops\/enroll|promptForOneTimeEnrollment|Ops Manager password|Manager password|enrollOpsManagerDevice/);
  assert.match(managerHub, /one-time manager code/i);
  assert.doesNotMatch(managerHub, /password/i);
  assert.match(managerAccess, /MANAGER ACCESS/);
  assert.match(managerAccess, /Generate One-Time Code/);
  assert.match(managerAccess, /Copy Code/);
  assert.match(managerAccess, /Cancel Unused Code/);
  assert.doesNotMatch(managerAccess, /Generate PC Invite|Generate Phone Invite|Copy Invite Link|Display Invite QR|ops_pairing_token/);
  assert.match(deviceSecurity, /Security Admin unlock required/);
  assert.match(deviceSecurity, /Device Security password/);
  assert.doesNotMatch(deviceSecurity, /Generate Pairing Link/);
}

console.log("SHARED_ACCESS_AUTH_TESTS_PASS");
