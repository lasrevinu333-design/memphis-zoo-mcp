#!/usr/bin/env node

import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { createOpsManagerSession, makeOpsAccessMiddleware } from "../src/auth/shared-access-auth.js";
import { assertServerAssignedActor, authenticatedManagerActor } from "../src/manager-authority.js";

const env = {
  NODE_ENV: "production",
  OPS_MANAGER_AUTH_REQUIRED: "true",
  OPS_MANAGER_SESSION_SECRET: "manager-route-authority-contract-secret",
};
const managerId = "61000000-0000-4000-8000-000000000001";
const replacementManagerId = "61000000-0000-4000-8000-000000000002";
const credentialId = "61000000-0000-4000-8000-000000000003";
const deviceId = "MANAGER_AUTHORITY_PHONE";
const manager = {
  manager_id: managerId,
  display_name: "Named Manager",
  roles: ["CUSTODIAL_MANAGER"],
  active: true,
  revoked_at: null,
};
const trustedRow = {
  credential_id: credentialId,
  device_id: deviceId,
  device_label: "Manager Authority Phone",
  token_hash: "test-only-hash",
  max_access_level: "full_access",
  manager_id: managerId,
  manager,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  revoked_at: null,
};
const store = { async find(value) { return value === credentialId ? structuredClone(trustedRow) : null; } };

const app = express();
app.get("/human-manager-route", makeOpsAccessMiddleware({ env, trustedDeviceStore: store }), (req, res) => {
  res.json({ ok: true, manager_id: req.memphisAuth.manager_id });
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function get(token) {
  const response = await fetch(`${base}/human-manager-route`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

try {
  const untrustedToken = createOpsManagerSession({
    deviceId: "OPERATIONS_FIRST",
    manager,
    authMode: "operations_first",
    accessLevel: "full_access",
    maximumAccessLevel: "full_access",
    env,
  }).token;
  let result = await get(untrustedToken);
  assert.equal(result.status, 403);
  assert.match(result.body.error, /named manager device session is required/i);

  const trustedToken = createOpsManagerSession({
    credentialId,
    deviceId,
    manager,
    authMode: "trusted_device",
    accessLevel: "full_access",
    maximumAccessLevel: "full_access",
    env,
  }).token;
  result = await get(trustedToken);
  assert.equal(result.status, 200);
  assert.equal(result.body.manager_id, managerId);

  trustedRow.manager_id = replacementManagerId;
  trustedRow.manager = { ...manager, manager_id: replacementManagerId };
  result = await get(trustedToken);
  assert.equal(result.status, 403);
  assert.match(result.body.error, /assignment changed/i);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

assert.equal(authenticatedManagerActor({ manager_id: managerId, manager_display_name: "Named Manager" }), `manager:${managerId}:Named Manager`);
assert.throws(() => authenticatedManagerActor({ manager_id: "not-a-uuid", manager_display_name: "Named Manager" }), /authenticated named manager/i);
assert.throws(() => authenticatedManagerActor({ manager_id: managerId, manager_display_name: "" }), /authenticated named manager/i);
assert.doesNotThrow(() => assertServerAssignedActor({ ticket_id: "ticket" }));
assert.throws(() => assertServerAssignedActor({ ticket_id: "ticket", closed_by: "substitute" }), /assigned from the authenticated manager session/i);

const index = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
for (const route of ["admin-api", "dashboard-api"]) {
  assert.match(index, new RegExp(`app\\.post\\(\"\\/${route}\\/close-ticket\"[\\s\\S]{0,1200}assertServerAssignedActor\\(req\\.body\\)[\\s\\S]{0,1200}p_closed_by: authenticatedManagerActor\\(req\\.memphisAuth\\)`));
}

console.log("MANAGER_ROUTE_AUTHORITY_CONTRACT_PASS");
