import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateDeviceCredentialRequest,
  deviceCredentialInternals,
  installDeviceCredentialRoutes,
  makeDeviceCredentialMiddleware,
} from "../src/auth/device-credential-auth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const env = {
  NODE_ENV: "production",
  RENDER: "true",
  DEVICE_CREDENTIAL_SECRET: "device-credential-foundation-test-secret",
  DEVICE_CREDENTIAL_TTL_DAYS: "3650",
};
const deviceA = {
  requested_device_id: "KIOSK_06",
  matched_by: "canonical",
  canonical_device_pk: "11111111-1111-4111-8111-111111111111",
  canonical_device_id: "KIOSK_06",
  device_id: "KIOSK_06",
  device_name: "Kinnaye Peete",
  device_active: true,
  assigned_employee_id: "22222222-2222-4222-8222-222222222222",
  assigned_employee_name: "Kinnaye Peete",
  employee_code: "EMP005",
  employee_active: true,
  assignment_valid: true,
};
const deviceB = {
  ...deviceA,
  requested_device_id: "KIOSK_07",
  canonical_device_pk: "33333333-3333-4333-8333-333333333333",
  canonical_device_id: "KIOSK_07",
  device_id: "KIOSK_07",
};
const managerDevice = {
  requested_device_id: "KIOSK_01",
  matched_by: "alias",
  canonical_device_pk: "77777777-7777-4777-8777-777777777777",
  canonical_device_id: "1e74fe4c-dc20b3b9",
  device_id: "1e74fe4c-dc20b3b9",
  device_name: "Custodial Phone 1",
  device_active: true,
  assigned_employee_id: null,
  assigned_employee_name: null,
  employee_code: null,
  employee_active: false,
  assignment_valid: false,
};

function request({ deviceId = "KIOSK_06", cookie = "", authorization = "", body = {}, query = {} } = {}) {
  const headers = {
    "x-device-id": deviceId,
    cookie,
    authorization,
    "user-agent": "Device Credential Test",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-proto": "https",
  };
  return {
    body: { ...body }, query: { ...query }, headers, ip: "127.0.0.1", secure: true,
    header(name) { return headers[String(name).toLowerCase()] || ""; },
  };
}

function resolver(sql) {
  const upper = String(sql).toUpperCase();
  if (upper.includes("KIOSK_01") || upper.includes("1E74FE4C-DC20B3B9")) return [managerDevice];
  if (upper.includes("KIOSK_07")) return [deviceB];
  if (upper.includes("KIOSK_06")) return [deviceA];
  return [];
}

function storeFor({ mode = "enroll", credential = null } = {}) {
  const audit = [];
  return {
    audit,
    async getPolicy() { return { mode, updated_at: null, updated_by: null }; },
    async findCredential() { return credential; },
    async touchCredential() {},
    async audit(event) { audit.push(event); },
    async consumeEnrollmentCode(args) { return { ok: true, ...args, expires_at: args.expiresAt }; },
    async issueEnrollmentCode(args) { return { enrollment_id: "44444444-4444-4444-8444-444444444444", device_id: args.devicePk, expires_at: args.expiresAt }; },
    async revokeCredential() { return null; },
    async revokeByTokenHash() { return null; },
    async setPolicy(nextMode) { mode = nextMode; return { mode }; },
  };
}

let result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
assert.equal(result.ok, true);
assert.equal(result.legacy, true);
assert.equal(result.enrollment_required, true);

result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "observe" }), runReadOnlySql: resolver });
assert.equal(result.ok, true);
assert.equal(result.enrollment_required, false);

result = await authenticateDeviceCredentialRequest(request({ deviceId: "KIOSK_01" }), { env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
assert.equal(result.ok, false);
assert.equal(result.code, "device_not_eligible");
assert.equal(deviceCredentialInternals.isEligibleEmployeeDevice(managerDevice), false);
assert.equal(deviceCredentialInternals.isEligibleEmployeeDevice(deviceA), true);

result = await authenticateDeviceCredentialRequest(request(), { env, store: storeFor({ mode: "enforce" }), runReadOnlySql: resolver });
assert.equal(result.ok, false);
assert.equal(result.code, "device_credential_required");
assert.equal(result.status, 401);

const credentialId = "55555555-5555-4555-8555-555555555555";
const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-";
const credential = {
  credential_id: credentialId,
  device_id: deviceA.canonical_device_pk,
  token_hash: deviceCredentialInternals.tokenHash(secret, env),
  created_at: "2026-07-15T20:00:00.000Z",
  last_used_at: "2026-07-15T20:00:00.000Z",
  expires_at: "2036-07-15T20:00:00.000Z",
  revoked_at: null,
};
const cookie = `memphis_device_credential=${credentialId}.${secret}`;
result = await authenticateDeviceCredentialRequest(request({ cookie }), {
  env, store: storeFor({ mode: "enforce", credential }), runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, true);
assert.equal(result.credentialed, true);
assert.equal(result.device.canonical_device_id, "KIOSK_06");

result = await authenticateDeviceCredentialRequest(request({ deviceId: "KIOSK_07", cookie }), {
  env, store: storeFor({ mode: "enforce", credential }), runReadOnlySql: resolver,
  now: new Date("2026-07-15T21:00:00.000Z"),
});
assert.equal(result.ok, false);
assert.equal(result.code, "device_credential_required");

assert.equal(deviceCredentialInternals.credentialTokenParts("not-a-token"), null);
assert.equal(deviceCredentialInternals.credentialTokenParts(`${credentialId}.${secret}`)?.credentialId, credentialId);
assert.equal(deviceCredentialInternals.requestDeviceIdentifier(request({ body: { args: { p_device_identifier: "kiosk-6" } }, deviceId: "" })), "KIOSK_06");

let middlewareNext = false;
let middlewareStatus = 200;
let middlewarePayload = null;
const middleware = makeDeviceCredentialMiddleware({ env, store: storeFor({ mode: "enroll" }), runReadOnlySql: resolver });
await middleware(request(), {
  setHeader() {},
  status(code) { middlewareStatus = code; return this; },
  json(payload) { middlewarePayload = payload; return this; },
}, () => { middlewareNext = true; });
assert.equal(middlewareNext, true);
assert.equal(middlewareStatus, 200);
assert.equal(middlewarePayload, null);

function fakeApp() {
  const routes = new Map();
  return {
    routes,
    use() {},
    get(pathname, ...handlers) { routes.set(`GET ${pathname}`, handlers); },
    post(pathname, ...handlers) { routes.set(`POST ${pathname}`, handlers); },
  };
}
function responseCapture() {
  const headers = {};
  return {
    code: 200, payload: null, headers,
    append(name, value) { headers[String(name).toLowerCase()] = value; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
    sendStatus(code) { this.code = code; return this; },
  };
}
const app = fakeApp();
const routeStore = storeFor({ mode: "enroll" });
installDeviceCredentialRoutes(app, {
  env,
  store: routeStore,
  supabase: {},
  runReadOnlySql: resolver,
  requireOpsAuth: (_req, _res, next) => next(),
  requireOpsWrite: (_req, _res, next) => next(),
});
assert.ok(app.routes.has("GET /device-auth/status"));
assert.ok(app.routes.has("POST /device-auth/enroll"));
assert.ok(app.routes.has("POST /device-auth/logout"));
assert.ok(app.routes.has("GET /admin-api/device-auth/summary"));

const statusHandler = app.routes.get("GET /device-auth/status").at(-1);
const statusRes = responseCapture();
await statusHandler(request({ deviceId: "KIOSK_06" }), statusRes);
assert.equal(statusRes.code, 200);
assert.equal(statusRes.payload.data.authenticated, false);
assert.equal(statusRes.payload.data.employee_name, null, "unenrolled status must not disclose employee identity");
assert.equal(statusRes.payload.data.device_name, null, "unenrolled status must not disclose device labels");

const logoutHandler = app.routes.get("POST /device-auth/logout").at(-1);
const logoutWithoutHeader = responseCapture();
await logoutHandler(request({ deviceId: "" }), logoutWithoutHeader);
assert.equal(logoutWithoutHeader.code, 400, "logout must require the preflight-protected X-Device-Id header");

const enrollHandler = app.routes.get("POST /device-auth/enroll").at(-1);
const enrollRes = responseCapture();
await enrollHandler(request({ body: { enrollment_code: "12345678", device_id: "KIOSK_06" } }), enrollRes);
assert.equal(enrollRes.code, 200);
assert.equal(enrollRes.payload.ok, true);
assert.equal(Object.hasOwn(enrollRes.payload.data, "token"), false, "raw device credential must never enter JSON");
assert.match(String(enrollRes.headers["set-cookie"]), /HttpOnly/);
assert.match(String(enrollRes.headers["set-cookie"]), /Secure/);
assert.match(String(enrollRes.headers["set-cookie"]), /SameSite=None/);
assert.match(String(enrollRes.headers["set-cookie"]), /Partitioned/);
assert.match(String(enrollRes.headers["set-cookie"]), /Max-Age=315360000/);

const migration = read("supabase/migrations/20260715213000_device_credential_foundation.sql");
for (const table of ["device_auth_policy", "device_auth_credentials", "device_auth_enrollment_codes", "device_auth_events"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
}
assert.match(migration, /device_auth_issue_enrollment_code/);
assert.match(migration, /device_auth_consume_enrollment_code/);
assert.match(migration, /failed_attempts = v_failed_attempts/);
assert.match(migration, /return jsonb_build_object\('ok',false,'reason','invalid_or_expired'\)/);
assert.match(migration, /one_active_per_device/);
assert.match(migration, /confirmed_at timestamptz null/);
assert.match(migration, /metadata_json, confirmed_at, last_used_at, expires_at/);

const moduleSource = read("src/auth/device-credential-auth.js");
assert.match(moduleSource, /Array\.from\(\{ length: 9 \}/);
assert.match(moduleSource, /ready_to_enforce/);
assert.match(moduleSource, /All nine employee kiosks must be enrolled/);
assert.match(moduleSource, /app\.use\("\/admin-api\/device-auth", deviceRouteCors\)/);
assert.match(moduleSource, /An active canonical employee kiosk assignment is required/);
assert.match(moduleSource, /device_credential_confirmed/);
assert.match(moduleSource, /X-Device-Id is required/);
assert.doesNotMatch(moduleSource, /res\.status\(200\).*rawToken/s);

const indexSource = read("src/index.js");
assert.match(indexSource, /installDeviceCredentialRoutes/);
assert.match(indexSource, /requireDeviceOrOpsAccess, requireScanRpcAuthorization, scanRpcRateLimit/);
assert.match(indexSource, /X-Device-Credential/);
assert.match(indexSource, /Access-Control-Expose-Headers", "X-Device-Enrollment-Required, Retry-After"/);
assert.match(indexSource, /sessionId is required/);
assert.match(indexSource, /Unknown or expired SSE session/);
assert.doesNotMatch(indexSource, /entries\[entries\.length - 1\]/);

const messaging = read("src/messaging-api.js");
assert.match(messaging, /requireDeviceAccess/);
assert.match(messaging, /requireWritableDeviceOrOpsAuth/);
assert.match(messaging, /router\.post\("\/thread\/direct", requireWritableDeviceOrOpsAuth/);
assert.match(messaging, /Read-only Ops Manager access cannot modify Messenger/);

const schedule = read("src/schedule-api.js");
assert.match(schedule, /requirePersonalScheduleAccess/);
assert.match(schedule, /router\.get\("\/my-day", requireEmployeeDevice/);
assert.match(schedule, /router\.get\("\/my-day-summary", requirePersonalScheduleAccess/);
assert.match(schedule, /router\.get\("\/my-schedule", requirePersonalScheduleAccess/);

const mcpAuth = read("src/auth/mcp-connector-auth.js");
assert.doesNotMatch(mcpAuth, /authenticateOpsAccessRequest|open_ops_manager/);

console.log("DEVICE_CREDENTIAL_FOUNDATION_TESTS_PASS");
