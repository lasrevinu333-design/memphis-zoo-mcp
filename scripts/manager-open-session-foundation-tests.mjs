import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createPublicOpsManagerSession,
  installSharedAuthRoutes,
  normalizeOpsAccessLevel,
} from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  OPS_MANAGER_SESSION_SECRET: "manager-foundation-secret",
  OPS_MANAGER_AUTH_REQUIRED: "true",
};

assert.equal(normalizeOpsAccessLevel("read-only"), "read_only");
assert.equal(normalizeOpsAccessLevel("anything-else"), "read_only");
assert.equal(normalizeOpsAccessLevel("full"), "full_access");
assert.throws(() => createPublicOpsManagerSession({ env }), /authentication is required/i);

const rows = new Map();
const pairings = new Map();
const store = {
  async createPairingToken() {
    const token = String(pairings.size + 1).padStart(64, "a");
    const row = { pairing_id: randomUUID(), pairing_token: token, expires_at: new Date(Date.now() + 600_000).toISOString(), used_at: null };
    pairings.set(token, row);
    return { ok: true, pairing_id: row.pairing_id, pairing_token: token, expires_at: row.expires_at, ttl_seconds: 600 };
  },
  async consumePairingAndEnroll(record) {
    const pairing = pairings.get(record.pairing_token);
    if (!pairing || pairing.used_at) return { ok: false, status: pairing?.used_at ? 410 : 401, reason: pairing?.used_at ? "used" : "invalid" };
    const row = {
      credential_id: record.credential_id,
      device_id: record.device_id,
      device_label: record.device_label,
      token_hash: record.token_hash,
      max_access_level: "full_access",
      created_at: new Date().toISOString(),
      expires_at: record.expires_at,
      revoked_at: null,
    };
    rows.set(row.credential_id, row);
    pairing.used_at = new Date().toISOString();
    return { ok: true, pairing_id: pairing.pairing_id, trusted_device: row };
  },
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
result = await invoke(enrollHandler, request({ body: { device_id: "manager-full", access_level: "full_access" } }));
assert.equal(result.statusCode, 410, "legacy Ops Manager enrollment route must remain disabled");

const consumeHandler = routes.get("POST /auth-api/ops/pairing/consume");
const pairing = await store.createPairingToken();
result = await invoke(consumeHandler, request({ body: { pairing_token: pairing.pairing_token, device_id: "manager-full", device_label: "Eric desktop", access_level: "full_access" } }));
assert.equal(result.statusCode, 200);
assert.equal(result.payload.data.session.access_level, "full_access");
assert.equal(result.payload.data.session.trusted_device, true);
assert.match(String(result.headers.get("set-cookie")), /HttpOnly/);

result = await invoke(consumeHandler, request({ body: { pairing_token: pairing.pairing_token, device_id: "manager-other", device_label: "Other" } }));
assert.equal(result.statusCode, 410, "one-time pairing links must not be reusable");

console.log("MANAGER_TRUSTED_DEVICE_FOUNDATION_PASS");
