import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import { authenticateDeviceCredentialRequest, makeDeviceCredentialMiddleware } from "../src/auth/device-credential-auth.js";
import { deferJsonParserErrors } from "../src/offline-authority-http.js";

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

const startRecovery = await authenticateDeviceCredentialRequest(request("tool_start_offline_occurrence"), {
  env, store: store(revokedCredential), runReadOnlySql: resolver, now: new Date("2026-08-10T02:00:00.000Z"),
});
assert.equal(startRecovery.ok, true);
assert.equal(startRecovery.offline_recovery_only, true,
  "a cryptographically valid stale token may reach only the database-verified snapshot activation path");

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

// Direct authentication tests do not prove production middleware order. This
// route parses valid JSON before authentication while retaining parse failures
// for a later authenticated quarantine handler, matching /scan-api/rpc.
const app = express();
const parseBeforeAuthentication = deferJsonParserErrors(express.json({ limit: "1mb", strict: true }));
let routeCredential = revokedCredential;
const routeStore = {
  getPolicy: async () => ({ mode: "enforce" }),
  findCredential: async () => routeCredential,
  touchCredential: async () => {},
  audit: async () => {},
};
app.post("/scan-api/rpc",
  parseBeforeAuthentication,
  makeDeviceCredentialMiddleware({ env, store: routeStore, runReadOnlySql: resolver }),
  (req, res) => {
    if (req.deferredJsonParseError) {
      res.status(422).json({ ok: false, code: "invalid_json" });
      return;
    }
    if (req.memphisDeviceAuth?.offline_recovery_only !== true
        || !["tool_start_offline_occurrence", "tool_commit_cleaning_workflow"].includes(req.body?.fn)) {
      res.status(403).json({ ok: false, code: "recovery_scope_violation" });
      return;
    }
    res.status(200).json({ ok: true, recovery_only: true });
  },
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const routeRecovery = await fetch(`${origin}/scan-api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${credentialId}.${secret}`,
      "X-Device-Id": "KIOSK_08",
    },
    body: JSON.stringify({ fn: "tool_commit_cleaning_workflow", args: { p_device_id: "KIOSK_08" } }),
  });
  assert.equal(routeRecovery.status, 200, "real route order exposes the terminal function before stale-credential authentication");
  assert.deepEqual(await routeRecovery.json(), { ok: true, recovery_only: true });

  const routeStartRecovery = await fetch(`${origin}/scan-api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${credentialId}.${secret}`,
      "X-Device-Id": "KIOSK_08",
    },
    body: JSON.stringify({ fn: "tool_start_offline_occurrence", args: { p_device_id: "KIOSK_08" } }),
  });
  assert.equal(routeStartRecovery.status, 200,
    "queued snapshot activation reaches database verification before a stale token is rejected");

  const routeRead = await fetch(`${origin}/scan-api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${credentialId}.${secret}`,
      "X-Device-Id": "KIOSK_08",
    },
    body: JSON.stringify({ fn: "tool_get_location_scan_state", args: { p_device_id: "KIOSK_08" } }),
  });
  assert.equal(routeRead.status, 401, "the same stale credential cannot use an ordinary scan RPC");

  routeCredential = activeCredential;
  const malformed = await fetch(`${origin}/scan-api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${credentialId}.${secret}`,
      "X-Device-Id": "KIOSK_08",
    },
    body: '{"fn":"tool_commit_cleaning_workflow",',
  });
  assert.equal(malformed.status, 422, "malformed JSON remains available to the post-authentication quarantine boundary");
  assert.deepEqual(await malformed.json(), { ok: false, code: "invalid_json" });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("OFFLINE_ACTOR_RECOVERY_ROUTE_PASS");
