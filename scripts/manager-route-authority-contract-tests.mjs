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
  system_key: "eric_custodial_manager",
  is_system_principal: false,
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
app.get("/owner-write-route", makeOpsAccessMiddleware({ env, trustedDeviceStore: store, requireWrite: true }), (_req,res)=>res.json({ok:true}));
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

  let writeResult = await fetch(`${base}/owner-write-route`, {headers:{authorization:`Bearer ${trustedToken}`}});
  assert.equal(writeResult.status,200,'protected owner can write');
  // The already issued full-access token remains signed, but a current delegate
  // registry entry must never retain owner writes through its old enrollment.
  trustedRow.manager = {...manager,system_key:'brandy_gull_horticulture_manager'};
  writeResult = await fetch(`${base}/owner-write-route`, {headers:{authorization:`Bearer ${trustedToken}`}});
  assert.equal(writeResult.status,403,'old full-access token is clamped by current delegate policy');
  assert.equal((await get(trustedToken)).status,200,'delegate keeps read access');
  trustedRow.manager = manager;
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
const actions = await readFile(new URL('../src/owner-access-api.js',import.meta.url),'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261006031304_custodial_owner_delegated_actions.sql',import.meta.url),'utf8');
assert.match(index,/installOwnerAccessRoutes\(app, \{ store: opsTrustedDeviceStore, runRpc, backendSecret: offlineAuthoritySecret \}\)/);
for(const route of ['admin-api','dashboard-api'])assert.ok(actions.includes('/'+route+'/close-ticket'));
assert.match(actions,/assertServerAssignedActor\(req.body\)/);
assert.match(actions,/requiredPermission: 'close_scan_tickets'/);
assert.match(actions,/managerActionArguments\(req\)/);
assert.ok(migration.includes("'manager:'||p_manager_id::text||':'||left(actor->>'manager_name',155)"),'ticket actor is server-derived in the database writer');


console.log("MANAGER_ROUTE_AUTHORITY_CONTRACT_PASS");
