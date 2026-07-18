import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOpsManagerSession, installSharedAuthRoutes } from "../src/auth/shared-access-auth.js";

function appCapture() {
  const routes = new Map();
  return {
    routes,
    use() {},
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers.at(-1)); },
  };
}

function resCapture() {
  return {
    statusCode: 200,
    headers: new Map(),
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    setHeader(k, v) { this.headers.set(String(k).toLowerCase(), v); },
    append(k, v) { this.headers.set(String(k).toLowerCase(), v); },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function invoke(handler, request) {
  const res = resCapture();
  await handler(request, res, () => {});
  return res;
}

function req({ body = {}, headers = {}, params = {}, query = {}, ip = "127.0.0.1" } = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    body, headers: normalized, params, query, ip,
    socket: { remoteAddress: ip },
    header(name) { return normalized[String(name || "").toLowerCase()] || ""; },
  };
}

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  OPS_MANAGER_SESSION_SECRET: "test-secret-for-one-time-manager-codes",
};

function makeStore() {
  const adminManager = {
    manager_id: "00000000-0000-4000-8000-000000000001",
    display_name: "Eric",
    contact_label: "test security admin",
    roles: ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
    role: "SECURITY_ADMIN",
    active: true,
    revoked_at: null,
    created_at: new Date().toISOString(),
  };
  const opsManager = {
    manager_id: randomUUID(),
    display_name: "Ops Manager Test",
    contact_label: "disposable",
    roles: ["OPS_MANAGER"],
    role: "OPS_MANAGER",
    active: true,
    revoked_at: null,
    created_at: new Date().toISOString(),
  };
  const adminCredential = randomUUID();
  const managers = new Map([[adminManager.manager_id, adminManager], [opsManager.manager_id, opsManager]]);
  const devices = new Map([[adminCredential, {
    credential_id: adminCredential,
    device_id: "eric-existing-desktop",
    device_label: "Eric desktop",
    max_access_level: "full_access",
    manager_id: adminManager.manager_id,
    manager: adminManager,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
  }]]);
  const codes = new Map();
  const rateLimits = new Map();
  const events = [];

  function publicCode(row) {
    const { code_hash, metadata_json, ...safe } = row;
    return { ...safe, code_id: row.id };
  }

  return {
    adminManager,
    adminCredential,
    opsManager,
    managers,
    devices,
    codes,
    rateLimits,
    events,
    async find(id) { return devices.get(id) || null; },
    async touch() {},
    async audit(event) { events.push(event); },
    async listTrustedDevices() { return Array.from(devices.values()); },
    async listManagers() {
      return Array.from(managers.values()).map((manager) => ({
        ...manager,
        devices: Array.from(devices.values()).filter((d) => d.manager_id === manager.manager_id),
        enrollment_codes: Array.from(codes.values()).filter((c) => c.manager_id === manager.manager_id).map(publicCode),
      }));
    },
    async createManager(record) {
      const roles = Array.isArray(record.roles) ? record.roles : [record.role || "OPS_MANAGER"];
      const manager = {
        manager_id: randomUUID(),
        display_name: record.display_name,
        contact_label: record.contact_label || null,
        roles,
        role: roles.includes("SECURITY_ADMIN") ? "SECURITY_ADMIN" : roles.includes("DIRECTOR") ? "DIRECTOR" : "OPS_MANAGER",
        active: true,
        revoked_at: null,
        created_at: new Date().toISOString(),
      };
      managers.set(manager.manager_id, manager);
      return manager;
    },
    async updateManager(id, patch) {
      const manager = managers.get(id);
      if (!manager) return null;
      if (patch.roles || patch.role) {
        const roles = Array.isArray(patch.roles) ? patch.roles : [patch.role];
        manager.roles = roles.includes("SECURITY_ADMIN") ? ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"] : roles.includes("DIRECTOR") ? ["OPS_MANAGER", "DIRECTOR"] : ["OPS_MANAGER"];
        manager.role = manager.roles.at(-1);
      }
      if (patch.active !== undefined) manager.active = patch.active !== false;
      return manager;
    },
    async revokeManager(id) {
      const manager = managers.get(id);
      if (manager) {
        manager.active = false;
        manager.revoked_at = new Date().toISOString();
      }
      return manager || null;
    },
    async revokeManagerDevices(id) {
      const revoked = [];
      for (const device of devices.values()) {
        if (device.manager_id === id && !device.revoked_at) {
          device.revoked_at = new Date().toISOString();
          revoked.push(device);
        }
      }
      return revoked;
    },
    async revoke(id, reason = "manager_revoke_device") {
      const device = devices.get(id);
      if (device) {
        device.revoked_at = new Date().toISOString();
        device.revoked_reason = reason;
      }
    },
    async createManagerEnrollmentCode(record) {
      const manager = managers.get(record.manager_id);
      if (!manager?.active) throw Object.assign(new Error("Active manager required"), { status: 404 });
      const role = String(record.role || manager.role || "OPS_MANAGER");
      if (!manager.roles.includes(role)) throw Object.assign(new Error("One-time code role must match the named manager."), { status: 400 });
      for (const existing of codes.values()) {
        if (existing.code_hash === record.code_hash) {
          const error = new Error("duplicate key");
          error.code = "23505";
          throw error;
        }
      }
      const now = Date.now();
      const row = {
        id: randomUUID(),
        manager_id: manager.manager_id,
        code_hash: record.code_hash,
        role_snapshot: role,
        created_by_manager_id: record.created_by_manager_id || null,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + Number(record.ttl_seconds || 900) * 1000).toISOString(),
        consumed_at: null,
        revoked_at: null,
        revoked_reason: null,
        status: "active",
        attempt_count: 0,
        max_attempts: Number(record.max_attempts || 5),
        metadata_json: record.metadata_json || {},
      };
      codes.set(row.id, row);
      return { ok: true, ...publicCode(row), ttl_seconds: Number(record.ttl_seconds || 900), manager };
    },
    async revokeManagerEnrollmentCode(codeId, { reason = "manager_code_cancelled" } = {}) {
      const row = codes.get(codeId);
      if (!row || row.consumed_at || row.revoked_at) return null;
      row.revoked_at = new Date().toISOString();
      row.revoked_reason = reason;
      row.status = "revoked";
      return publicCode(row);
    },
    async consumeManagerEnrollmentCode(record) {
      const row = Array.from(codes.values()).find((code) => code.code_hash === record.code_hash);
      if (!row) return { ok: false, status: 401, reason: "invalid" };
      if (row.consumed_at || row.status === "used") return { ok: false, status: 410, reason: "used", code_id: row.id };
      if (row.revoked_at || row.status === "revoked") return { ok: false, status: 410, reason: "revoked", code_id: row.id };
      if (Date.parse(row.expires_at) <= Date.now() || row.status === "expired") return { ok: false, status: 410, reason: "expired", code_id: row.id };
      const manager = managers.get(row.manager_id);
      if (!manager?.active || manager.revoked_at) return { ok: false, status: 403, reason: "manager_inactive", code_id: row.id };
      if (!manager.roles.includes(row.role_snapshot)) return { ok: false, status: 403, reason: "role_mismatch", code_id: row.id };
      for (const device of devices.values()) {
        if (device.device_id === record.device_id && !device.revoked_at) device.revoked_at = new Date().toISOString();
      }
      const device = {
        credential_id: record.credential_id,
        device_id: record.device_id,
        device_label: record.device_label,
        token_hash: record.token_hash,
        max_access_level: "full_access",
        manager_id: manager.manager_id,
        manager,
        manager_enrollment_code_id: row.id,
        platform_summary: record.platform_summary,
        created_at: new Date().toISOString(),
        expires_at: record.expires_at,
        revoked_at: null,
      };
      devices.set(device.credential_id, device);
      row.consumed_at = new Date().toISOString();
      row.consumed_credential_id = device.credential_id;
      row.consumed_device_id = device.device_id;
      row.status = "used";
      return { ok: true, code_id: row.id, manager, trusted_device: device };
    },
    async getManagerCodeRateLimit(keyHash) { return rateLimits.get(keyHash) || null; },
    async recordManagerCodeFailure(keyHash, metadata = {}) {
      const current = rateLimits.get(keyHash);
      const failureCount = Number(current?.failure_count || 0) + 1;
      const row = {
        key_hash: keyHash,
        failure_count: failureCount,
        first_failed_at: current?.first_failed_at || new Date().toISOString(),
        last_failed_at: new Date().toISOString(),
        locked_until: failureCount >= 5 ? new Date(Date.now() + 900_000).toISOString() : null,
        metadata_json: metadata,
      };
      rateLimits.set(keyHash, row);
      return row;
    },
    async clearManagerCodeFailures(keyHash) { rateLimits.delete(keyHash); },
  };
}

const app = appCapture();
const store = makeStore();
installSharedAuthRoutes(app, { env, trustedDeviceStore: store, setCors() {} });

const adminToken = createOpsManagerSession({
  credentialId: store.adminCredential,
  deviceId: "eric-existing-desktop",
  manager: store.adminManager,
  accessLevel: "full_access",
  env,
}).token;

const adminHeaders = {
  authorization: `Bearer ${adminToken}`,
  origin: "https://lasrevinu333-design.github.io",
  "user-agent": "Desktop Chrome",
};

for (const name of [
  "POST /auth-api/ops/managers",
  "POST /auth-api/ops/managers/:managerId/enrollment-codes",
  "POST /auth-api/ops/manager-codes/consume",
  "POST /auth-api/ops/manager-codes/:codeId/revoke",
  "POST /auth-api/ops/trusted-devices/:credentialId/revoke",
  "POST /auth-api/ops/managers/:managerId/revoke-sessions",
]) {
  assert.equal(typeof app.routes.get(name), "function", `${name} route must be installed`);
}

let result = await invoke(app.routes.get("POST /auth-api/ops/managers"), req({
  body: { display_name: "Disposable Manager", contact_label: "test", role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 200);
const disposableManager = result.payload.data.manager;
assert.equal(disposableManager.display_name, "Disposable Manager");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: disposableManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 200);
const firstCode = result.payload.data.one_time_code;
assert.match(firstCode, /^\d{8}$/);
assert.match(result.payload.data.display_code, /^\d{4} \d{4}$/);
assert.equal(JSON.stringify(Array.from(store.codes.values())).includes(firstCode), false, "plaintext code must not be persisted in code storage");

result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: `${firstCode.slice(0, 4)} ${firstCode.slice(4)}`, device_id: "manager-desktop", device_label: "Jennifer Work PC", access_level: "full_access" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 200, "formatted one-time code must enroll a browser");
assert.equal(result.payload.data.manager.manager_id, disposableManager.manager_id);
assert.match(String(result.headers.get("set-cookie") || ""), /memphis_ops_trust=.*HttpOnly/);
assert.equal(Array.from(store.devices.values()).filter((d) => d.manager_id === disposableManager.manager_id && !d.revoked_at).length, 1);

result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: firstCode, device_id: "manager-desktop-reuse", device_label: "Reuse", access_level: "full_access" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 410, "reused one-time code must be denied");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: disposableManager.manager_id },
  body: { role: "SECURITY_ADMIN" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 400, "browser/client must not be able to escalate manager role through code creation");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: disposableManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
const cancelledCode = result.payload.data;
assert.equal(result.statusCode, 200);
result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/:codeId/revoke"), req({
  params: { codeId: cancelledCode.code_id },
  body: { reason: "test_cancel" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 200);
result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: cancelledCode.one_time_code, device_id: "cancelled", device_label: "Cancelled" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 410, "cancelled one-time code must be denied");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: disposableManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 200);
const expiredCode = result.payload.data;
store.codes.get(expiredCode.code_id).expires_at = new Date(Date.now() - 1000).toISOString();
result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: expiredCode.one_time_code, device_id: "expired", device_label: "Expired" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 410, "expired one-time code must be denied");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: disposableManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
assert.equal(result.statusCode, 200);
const disabledCode = result.payload.data.one_time_code;
await store.revokeManager(disposableManager.manager_id);
result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: disabledCode, device_id: "disabled", device_label: "Disabled" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 401, "code for disabled manager must fail generically");

const secondManager = await store.createManager({ display_name: "Second Device Manager", role: "OPS_MANAGER" });
result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: secondManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
const secondDeviceCode = result.payload.data.one_time_code;
assert.equal(result.statusCode, 200);
result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: secondDeviceCode, device_id: "manager-phone", device_label: "Clayton Phone" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Android Chrome" },
}));
assert.equal(result.statusCode, 200, "second physical browser/profile should enroll with a fresh code");
assert.equal(result.payload.data.trusted_device.device_label, "Clayton Phone");

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/enrollment-codes"), req({
  params: { managerId: secondManager.manager_id },
  body: { role: "OPS_MANAGER" },
  headers: adminHeaders,
}));
const raceCode = result.payload.data.one_time_code;
const race = await Promise.all([
  invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
    body: { code: raceCode, device_id: "race-a", device_label: "Race A" },
    headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
  })),
  invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
    body: { code: raceCode, device_id: "race-b", device_label: "Race B" },
    headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Edge" },
  })),
]);
assert.equal(race.filter((item) => item.statusCode === 200).length, 1, "only one simultaneous consume can succeed");
assert.equal(race.filter((item) => item.statusCode === 410).length, 1, "losing simultaneous consume sees used code");

for (let index = 0; index < 5; index += 1) {
  result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
    body: { code: "0000 0000", device_id: "rate-limited", device_label: "Rate Limited" },
    headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "Desktop Chrome" },
    ip: "203.0.113.44",
  }));
}
assert.equal(result.statusCode, 429, "five failed attempts should lock out the browser/IP window");
assert.ok(result.headers.get("retry-after"));

result = await invoke(app.routes.get("POST /auth-api/ops/manager-codes/consume"), req({
  body: { code: "1111 1111", device_id: "wrong-origin", device_label: "Wrong Origin" },
  headers: { origin: "https://evil.example", "user-agent": "Desktop Chrome" },
}));
assert.equal(result.statusCode, 403, "wrong origin must be denied");

assert.equal(store.devices.get(store.adminCredential).revoked_at, null, "existing Eric trusted device row must remain active");

console.log("MANAGER_ONE_TIME_CODE_TESTS_PASS");
