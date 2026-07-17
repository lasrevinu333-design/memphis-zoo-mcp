import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { installDeviceCredentialRoutes } from "../src/auth/device-credential-auth.js";

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  DEVICE_CREDENTIAL_SECRET: "device-security-test-secret",
};

function hmacHex(purpose, value) {
  return createHmac("sha256", env.DEVICE_CREDENTIAL_SECRET).update(`${purpose}:${String(value || "")}`, "utf8").digest("hex");
}

function appCapture() {
  const routes = new Map();
  return {
    routes,
    use() {},
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
  };
}

function resCapture() {
  return {
    statusCode: 200,
    headers: new Map(),
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader(k, v) { this.headers.set(k.toLowerCase(), v); },
    append(k, v) { this.headers.set(k.toLowerCase(), v); },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function invoke(handlers, req) {
  const res = resCapture();
  let index = 0;
  async function next() {
    const handler = handlers[index++];
    if (handler) await handler(req, res, next);
  }
  await next();
  return res;
}

function req({ body = {}, headers = {}, params = {}, auth = {} } = {}) {
  return {
    body, headers, params,
    memphisAuth: {
      manager_id: "00000000-0000-4000-8000-000000000001",
      credential_id: "11111111-1111-4111-8111-111111111111",
      manager_display_name: "Eric",
      roles: ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
      ...auth,
    },
    header(name) { return headers[name] || headers[name.toLowerCase()] || ""; },
  };
}

const password = "correct horse battery staple";
const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 8192, timeCost: 2, parallelism: 1 });
const sessions = new Map();
const rateLimits = new Map();
const enrollmentCodes = new Map();
const managers = new Map([
  ["00000000-0000-4000-8000-000000000001", {
    manager_id: "00000000-0000-4000-8000-000000000001",
    display_name: "Eric",
    roles: ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    active: true,
  }],
  ["44444444-4444-4444-8444-444444444444", {
    manager_id: "44444444-4444-4444-8444-444444444444",
    display_name: "Ops Only",
    roles: ["OPS_MANAGER"],
    active: true,
  }],
]);
const store = {
  async getManager(id) { return managers.get(id) || null; },
  async getDeviceSecurityConfig() { return { password_hash: passwordHash, password_version: 1, rotated_at: new Date().toISOString(), sessions_revoked_at: null }; },
  async getDeviceSecurityRateLimit(k) { return rateLimits.get(k) || null; },
  async recordDeviceSecurityFailure(k) { const current = rateLimits.get(k) || { failure_count: 0 }; const next = { key_hash: k, failure_count: current.failure_count + 1, locked_until: current.failure_count + 1 >= 5 ? new Date(Date.now() + 900000).toISOString() : null }; rateLimits.set(k, next); return next; },
  async clearDeviceSecurityFailures(k) { rateLimits.delete(k); },
  async createDeviceSecuritySession(record) { sessions.set(record.session_id, record); return record; },
  async findDeviceSecuritySession(id) { return sessions.get(id) || null; },
  async touchDeviceSecuritySession(id) { const row = sessions.get(id); if (row) row.last_used_at = new Date().toISOString(); },
  async revokeDeviceSecuritySession(id, reason) { const row = sessions.get(id); if (row) { row.revoked_at = new Date().toISOString(); row.revoked_reason = reason; } },
  async revokeAllDeviceSecuritySessions() { for (const row of sessions.values()) row.revoked_at = new Date().toISOString(); return Array.from(sessions.values()); },
  async getPolicy() { return { mode: "observe" }; },
  async issueEnrollmentCode({ devicePk, expiresAt }) { const row = { enrollment_id: randomUUID(), device_id: devicePk, expires_at: expiresAt, status: "active" }; enrollmentCodes.set(row.enrollment_id, row); return row; },
  async revokeEnrollmentCode(id) { const row = enrollmentCodes.get(id); if (row) { row.status = "revoked"; row.revoked_at = new Date().toISOString(); } return row || null; },
  async audit() {},
  async auditSecurityCode() {},
};

async function runReadOnlySql() {
  return [{
    canonical_device_pk: "22222222-2222-4222-8222-222222222222",
    canonical_device_id: "KIOSK_02",
    requested_device_id: "KIOSK_02",
    device_name: "Kiosk 02",
    device_active: true,
    assigned_employee_id: "33333333-3333-4333-8333-333333333333",
    assignment_valid: true,
    employee_active: true,
    employee_code: "EMP001",
    assigned_employee_name: "Test Employee",
  }];
}

const app = appCapture();
const requireOpsAuth = (request, _res, next) => next();
const requireOpsWrite = (request, _res, next) => next();
installDeviceCredentialRoutes(app, { env, store, setCors() {}, runReadOnlySql, requireOpsAuth, requireOpsWrite, supabase: { from() { return { select() { return this; }, in() { return this; }, order() { return Promise.resolve({ data: [], error: null }); }, is() { return this; }, gt() { return Promise.resolve({ data: [], error: null }); } }; } } });

let result = await invoke(app.routes.get("POST /admin-api/device-security/unlock"), req({ body: { password: "wrong" } }));
assert.equal(result.statusCode, 401);

result = await invoke(app.routes.get("POST /admin-api/device-security/unlock"), req({ body: { password } }));
assert.equal(result.statusCode, 200);
assert.ok(result.payload.data.csrf_token);
const setCookie = String(result.headers.get("set-cookie") || "");
assert.match(setCookie, /memphis_device_security_session=/);
assert.match(setCookie, /HttpOnly/);
const cookie = setCookie.split(";")[0];
const csrf = result.payload.data.csrf_token;

result = await invoke(app.routes.get("GET /admin-api/device-security/session"), req({ headers: { cookie } }));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.unlocked, true);

result = await invoke(app.routes.get("POST /admin-api/device-auth/enrollment-code"), req({
  body: { device_id: "KIOSK_02" },
  headers: { cookie, "x-device-security-csrf": csrf },
}));
assert.equal(result.statusCode, 200);
assert.match(result.payload.data.enrollment_code, /^\d{8}$/);
assert.equal(JSON.stringify(enrollmentCodes).includes(result.payload.data.enrollment_code), false, "plaintext code must not be stored");

result = await invoke(app.routes.get("POST /admin-api/device-auth/codes/:codeId/revoke"), req({
  params: { codeId: result.payload.data.code_id },
  headers: { cookie, "x-device-security-csrf": csrf },
}));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.revoked, true);

result = await invoke(app.routes.get("POST /admin-api/device-auth/enrollment-code"), req({
  body: { device_id: "KIOSK_02" },
  headers: { cookie },
}));
assert.equal(result.statusCode, 403, "CSRF header is required after unlock");

const ordinaryManagerAuth = {
  manager_id: "44444444-4444-4444-8444-444444444444",
  credential_id: "55555555-5555-4555-8555-555555555555",
  manager_display_name: "Ops Only",
  roles: ["OPS_MANAGER"],
};

result = await invoke(app.routes.get("GET /admin-api/device-security/session"), req({ auth: ordinaryManagerAuth }));
assert.equal(result.statusCode, 403, "ordinary managers cannot inspect Device Security session state");

result = await invoke(app.routes.get("POST /admin-api/device-security/unlock"), req({ body: { password }, auth: ordinaryManagerAuth }));
assert.equal(result.statusCode, 403, "ordinary managers cannot unlock Device Security");

result = await invoke(app.routes.get("POST /admin-api/device-auth/enrollment-code"), req({
  body: { device_id: "KIOSK_02" },
  headers: { cookie, "x-device-security-csrf": csrf },
  auth: ordinaryManagerAuth,
}));
assert.equal(result.statusCode, 403, "ordinary managers cannot use a Security Admin device-session cookie");

console.log("DEVICE_SECURITY_APP_TESTS_PASS");
