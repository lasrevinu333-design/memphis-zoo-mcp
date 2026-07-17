import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { installSharedAuthRoutes } from "../src/auth/shared-access-auth.js";

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
    setHeader(k, v) { this.headers.set(k.toLowerCase(), v); },
    append(k, v) { this.headers.set(k.toLowerCase(), v); },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

async function invoke(handler, req) {
  const res = resCapture();
  await handler(req, res, () => {});
  return res;
}

function req({ body = {}, headers = {}, params = {}, query = {} } = {}) {
  return {
    body, headers, params, query,
    header(name) { return headers[name] || headers[name.toLowerCase()] || ""; },
  };
}

const adminManager = {
  manager_id: randomUUID(),
  display_name: "Eric",
  roles: ["OPS_MANAGER", "DIRECTOR", "SECURITY_ADMIN"],
  active: true,
  revoked_at: null,
};

function makeStore() {
  const managers = new Map([[adminManager.manager_id, adminManager]]);
  const devices = new Map();
  const invitations = new Map();
  const currentCredential = randomUUID();
  devices.set(currentCredential, {
    credential_id: currentCredential,
    device_id: "manager-browser-test",
    device_label: "Eric desktop",
    token_hash: "unused",
    max_access_level: "full_access",
    manager_id: adminManager.manager_id,
    manager: adminManager,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
  });
  return {
    currentCredential,
    managers,
    devices,
    invitations,
    async find(id) { return devices.get(id) || null; },
    async touch() {},
    async audit() {},
    async listTrustedDevices() { return Array.from(devices.values()); },
    async listManagers() { return Array.from(managers.values()).map((manager) => ({ ...manager, role: manager.roles.at(-1), devices: Array.from(devices.values()).filter((d) => d.manager_id === manager.manager_id) })); },
    async createManager(record) {
      const roles = Array.isArray(record.roles) ? record.roles : [record.roles || "OPS_MANAGER"];
      const manager = { manager_id: randomUUID(), display_name: record.display_name, contact_label: record.contact_label, roles, role: roles.at(-1), active: true, created_at: new Date().toISOString(), devices: [] };
      managers.set(manager.manager_id, manager);
      return manager;
    },
    async updateManager(id, patch) { const manager = managers.get(id); Object.assign(manager, patch); return manager; },
    async revokeManager(id) { const manager = managers.get(id); manager.active = false; manager.revoked_at = new Date().toISOString(); return manager; },
    async revokeManagerDevices(id) { const revoked = []; for (const device of devices.values()) if (device.manager_id === id && !device.revoked_at) { device.revoked_at = new Date().toISOString(); revoked.push(device); } return revoked; },
    async revoke(id) { const device = devices.get(id); if (device) device.revoked_at = new Date().toISOString(); },
    async createManagerInvitation(record) {
      const manager = managers.get(record.manager_id);
      const token = "a".repeat(64 - String(invitations.size).length) + String(invitations.size);
      const invitation = { ok: true, pairing_id: randomUUID(), pairing_token: token, manager, manager_id: manager.manager_id, intended_role: record.role, invitation_kind: record.invitation_kind, expires_at: new Date(Date.now() + 86400000).toISOString(), ttl_seconds: 86400, max_uses: 1, use_count: 0 };
      invitations.set(token, invitation);
      return invitation;
    },
    async consumeManagerInvitation(record) {
      const invitation = invitations.get(record.pairing_token);
      if (!invitation) return { ok: false, status: 401, reason: "invalid" };
      if (invitation.use_count >= 1) return { ok: false, status: 410, reason: "used", pairing_id: invitation.pairing_id };
      invitation.use_count += 1;
      const device = { credential_id: record.credential_id, device_id: record.device_id, device_label: record.device_label, token_hash: record.token_hash, max_access_level: "full_access", manager_id: invitation.manager_id, manager: invitation.manager, created_at: new Date().toISOString(), expires_at: record.expires_at, revoked_at: null };
      devices.set(device.credential_id, device);
      return { ok: true, pairing_id: invitation.pairing_id, manager: invitation.manager, trusted_device: device };
    },
  };
}

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  OPS_MANAGER_SESSION_SECRET: "test-secret-for-manager-onboarding",
};
const app = appCapture();
const store = makeStore();
installSharedAuthRoutes(app, { env, trustedDeviceStore: store, setCors() {} });

function bearerForCurrent() {
  const { createOpsManagerSession } = globalThis.__unused || {};
  return null;
}

// Use cookie trust for current admin device.
const trustCookie = `memphis_ops_trust=${store.currentCredential}.not-real`;
// Bypass cookie secret verification by using explicit session token generated by the live module through a session refresh route is not needed here:
// create a signed session by consuming an invitation first.
const bootstrapInvite = await store.createManagerInvitation({ manager_id: adminManager.manager_id, role: "SECURITY_ADMIN", invitation_kind: "pc" });
let result = await invoke(app.routes.get("POST /auth-api/ops/pairing/consume"), req({
  body: { pairing_token: bootstrapInvite.pairing_token, device_id: "admin-device-2", device_label: "Admin device", access_level: "full_access" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "desktop chrome" },
}));
assert.equal(result.statusCode, 200);
const adminToken = result.payload.data.session.token;

result = await invoke(app.routes.get("POST /auth-api/ops/managers"), req({
  body: { display_name: "Disposable Manager", contact_label: "test", role: "OPS_MANAGER" },
  headers: { authorization: `Bearer ${adminToken}`, origin: "https://lasrevinu333-design.github.io" },
}));
assert.equal(result.statusCode, 200);
const manager = result.payload.data.manager;
assert.equal(manager.display_name, "Disposable Manager");
assert.deepEqual(manager.roles, ["OPS_MANAGER"]);

result = await invoke(app.routes.get("POST /auth-api/ops/managers/:managerId/invitations"), req({
  params: { managerId: manager.manager_id },
  body: { role: "OPS_MANAGER", invitation_kind: "phone", ttl_seconds: 86400 },
  headers: { authorization: `Bearer ${adminToken}`, origin: "https://lasrevinu333-design.github.io" },
}));
assert.equal(result.statusCode, 200);
assert.match(result.payload.data.enrollment_url, /ops_pairing_token=[a-f0-9]{64}/);
const inviteToken = new URL(result.payload.data.enrollment_url).searchParams.get("ops_pairing_token");

result = await invoke(app.routes.get("POST /auth-api/ops/pairing/consume"), req({
  body: { pairing_token: inviteToken, device_id: "manager-phone", device_label: "Manager phone", access_level: "full_access" },
  headers: { origin: "https://evil.example", "user-agent": "android chrome" },
}));
assert.equal(result.statusCode, 403, "wrong origin must be denied");

result = await invoke(app.routes.get("POST /auth-api/ops/pairing/consume"), req({
  body: { pairing_token: inviteToken, device_id: "manager-phone", device_label: "Manager phone", access_level: "full_access" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "android chrome" },
}));
assert.equal(result.statusCode, 200, "one-click invite should enroll the browser");
assert.equal(result.payload.data.manager.manager_id, manager.manager_id);

result = await invoke(app.routes.get("POST /auth-api/ops/pairing/consume"), req({
  body: { pairing_token: inviteToken, device_id: "other-phone", device_label: "Other phone", access_level: "full_access" },
  headers: { origin: "https://lasrevinu333-design.github.io", "user-agent": "android chrome" },
}));
assert.equal(result.statusCode, 410, "invitation reuse must be denied");

console.log("MANAGER_PASSWORDLESS_ONBOARDING_TESTS_PASS");
