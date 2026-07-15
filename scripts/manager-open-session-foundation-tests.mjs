import assert from "node:assert/strict";
import {
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  normalizeOpsAccessLevel,
} from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  OPS_MANAGER_PASSWORD: "manager-password",
  OPS_MANAGER_SESSION_SECRET: "manager-foundation-secret",
};

assert.equal(normalizeOpsAccessLevel("read-only"), "read_only");
assert.equal(normalizeOpsAccessLevel("anything-else"), "read_only");
assert.equal(normalizeOpsAccessLevel("full"), "full_access");
assert.throws(() => createPublicOpsManagerSession(), /Passwordless Ops Manager sessions are disabled/);

const rows = new Map();
const store = {
  async enroll(row) { rows.set(row.credential_id, { ...row, revoked_at: null }); return rows.get(row.credential_id); },
  async find(id) { return rows.get(id) || null; },
  async touch() {},
  async revoke(id) { const row = rows.get(id); if (row) rows.set(id, { ...row, revoked_at: new Date().toISOString() }); },
  async revokeActiveForDevice(deviceId) { for (const [id, row] of rows) if (row.device_id === deviceId && !row.revoked_at) rows.set(id, { ...row, revoked_at: new Date().toISOString() }); },
  async audit() {},
};

const routes = new Map();
const app = { use() {}, get(path, handler) { routes.set(`GET ${path}`, handler); }, post(path, handler) { routes.set(`POST ${path}`, handler); } };
installSharedAuthRoutes(app, { env, setCors() {}, trustedDeviceStore: store });

function request({ query = {}, body = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value]));
  return { query, body, headers: lower, header(name) { return lower[String(name).toLowerCase()] || ""; } };
}
async function invoke(handler, req) {
  let statusCode = 200;
  let payload = null;
  const headers = new Map();
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    append(name, value) { headers.set(String(name).toLowerCase(), value); },
  };
  await handler(req, res);
  return { statusCode, payload, headers };
}

const sessionHandler = routes.get("GET /auth-api/session");
let result = await invoke(sessionHandler, request({ query: { access_level: "full_access" }, headers: { "X-Device-Id": "manager-full" } }));
assert.equal(result.statusCode, 401, "an untrusted browser must not open the manager hub");

const enrollHandler = routes.get("POST /auth-api/ops/enroll");
result = await invoke(enrollHandler, request({ body: { password: "manager-password", device_id: "manager-full", access_level: "full_access" } }));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");
assert.match(String(result.headers.get("set-cookie")), /HttpOnly/);
console.log("MANAGER_TRUSTED_DEVICE_FOUNDATION_PASS");
