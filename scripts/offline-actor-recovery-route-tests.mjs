import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { authenticateDeviceCredentialRequest } from "../src/auth/device-credential-auth.js";

const credentialId = "00000000-0000-4000-8000-00000000fb01";
const devicePk = "00000000-0000-4000-8000-00000000fb02";
const secret = "A".repeat(40);
const env = { DEVICE_CREDENTIAL_SECRET: "offline-actor-route-test-secret", NODE_ENV: "test" };
const tokenHash = createHmac("sha256", env.DEVICE_CREDENTIAL_SECRET).update(`device-token:${secret}`, "utf8").digest("hex");
const device = {
  canonical_device_pk: devicePk,
  canonical_device_id: "KIOSK_08",
  device_id: "KIOSK_08",
  device_active: true,
  assigned_employee_id: "00000000-0000-4000-8000-00000000fb03",
  assigned_employee_name: "Frozen Actor",
  employee_active: true,
  employee_code: "EMP08",
  assignment_valid: true,
};

function request(fn, token = `${credentialId}.${secret}`) {
  return {
    body: { fn, args: { p_device_id: "KIOSK_08" } },
    headers: { authorization: `Device ${token}`, "x-device-id": "KIOSK_08" },
    header(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

function store(credential) {
  return {
    getPolicy: async () => ({ mode: "enforce" }),
    findCredential: async () => credential,
    touchCredential: async () => {},
    audit: async () => {},
  };
}

const resolver = async () => [device];
const revokedCredential = {
  credential_id: credentialId,
  device_id: devicePk,
  token_hash: tokenHash,
  confirmed_at: "2026-08-10T00:00:00.000Z",
  expires_at: "2026-12-31T00:00:00.000Z",
  revoked_at: "2026-08-10T01:00:00.000Z",
};
const recovery = await authenticateDeviceCredentialRequest(request("tool_commit_cleaning_workflow"), {
  env, store: store(revokedCredential), runReadOnlySql: resolver, now: new Date("2026-08-10T02:00:00.000Z"),
});
assert.equal(recovery.ok, true);
assert.equal(recovery.offline_recovery_only, true);
assert.equal(recovery.credential.credential_id, credentialId);

const generalAccess = await authenticateDeviceCredentialRequest(request("tool_get_location_scan_state"), {
  env, store: store(revokedCredential), runReadOnlySql: resolver, now: new Date("2026-08-10T02:00:00.000Z"),
});
assert.equal(generalAccess.ok, false);
assert.equal(generalAccess.code, "device_credential_required");

const activeCredential = { ...revokedCredential, revoked_at: null };
const normalCommit = await authenticateDeviceCredentialRequest(request("tool_commit_cleaning_workflow"), {
  env, store: store(activeCredential), runReadOnlySql: resolver, now: new Date("2026-08-10T02:00:00.000Z"),
});
assert.equal(normalCommit.ok, true);
assert.equal(normalCommit.offline_recovery_only, undefined);

const forged = await authenticateDeviceCredentialRequest(request("tool_commit_cleaning_workflow", `${credentialId}.${"B".repeat(40)}`), {
  env, store: store(revokedCredential), runReadOnlySql: resolver, now: new Date("2026-08-10T02:00:00.000Z"),
});
assert.equal(forged.ok, false);
assert.equal(forged.code, "device_credential_required");

console.log("OFFLINE_ACTOR_RECOVERY_ROUTE_PASS");
