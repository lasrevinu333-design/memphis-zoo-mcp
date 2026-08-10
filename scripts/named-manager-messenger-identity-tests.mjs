import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const MANAGER_A_ID = "00000000-0000-4000-8000-000000000801";
const MANAGER_B_ID = "00000000-0000-4000-8000-000000000802";
const MANAGER_A_USER_ID = "00000000-0000-4000-8000-000000000803";
const MANAGER_B_USER_ID = "00000000-0000-4000-8000-000000000804";
const calls = [];
const unavailableProfileUserIds = new Set();

const managers = new Map([
  [MANAGER_A_ID, { userId: MANAGER_A_USER_ID, displayName: "Manager A", jobTitle: "Operations Manager" }],
  [MANAGER_B_ID, { userId: MANAGER_B_USER_ID, displayName: "Manager B", jobTitle: "Custodial Manager" }],
]);
const sessions = new Map([
  ["manager-a-desktop", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-desktop" }],
  ["manager-a-phone", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-phone" }],
  ["manager-b-desktop", { manager_id: MANAGER_B_ID, manager_display_name: "Manager B", device_id: "manager-b-desktop" }],
]);

async function runRpc(fn, args) {
  calls.push({ fn, args });
  if (fn === "msg_get_or_create_ops_manager_thread") {
    throw new Error("named manager identity must not depend on the retired shared room");
  }
  if (fn !== "msg_ensure_ops_manager_user") throw new Error(`Unexpected RPC: ${fn}`);
  const manager = managers.get(args.p_manager_id);
  assert.ok(manager, "only authenticated named managers may receive a Messenger principal");
  return {
    id: manager.userId,
    user_id: manager.userId,
    msg_user_id: manager.userId,
    display_name: manager.displayName,
    role: "manager",
    is_active: true,
    ops_manager_id: args.p_manager_id,
  };
}

async function runReadOnlySql(sql) {
  if (!/join public\.ops_manager_managers m/i.test(sql)) return [];
  for (const [managerId, manager] of managers) {
    if (!sql.includes(manager.userId)) continue;
    if (unavailableProfileUserIds.has(manager.userId)) {
      throw new Error("optional leadership profile read is temporarily unavailable");
    }
    return [{
      msg_user_id: manager.userId,
      manager_id: managerId,
      manager_display_name: manager.displayName,
      job_title: manager.jobTitle,
      department_key: "operations",
      manager_roles: ["OPS_MANAGER"],
    }];
  }
  return [];
}

function managerBoundary(req, res, next) {
  const token = String(req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session) {
    res.status(401).json({ ok: false, error: "Trusted named manager session required." });
    return;
  }
  req.memphisAuth = { ...session, roles: ["OPS_MANAGER"], read_only: false };
  next();
}

const app = express();
app.use(express.json());
app.use("/messaging-api", createMessagingRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload: () => ({ ok: true }),
  requireDeviceAccess: managerBoundary,
  requireOpsManagerAuth: managerBoundary,
  appVersion: "test",
  releaseId: "test",
  contractVersion: "messaging.v4",
}));

const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/messaging-api`;

async function identity(token) {
  const response = await fetch(`${origin}/me/by-device`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

try {
  const managerADesktop = await identity("manager-a-desktop");
  const managerAPhone = await identity("manager-a-phone");
  const managerBDesktop = await identity("manager-b-desktop");

  assert.equal(managerADesktop.status, 200);
  assert.equal(managerAPhone.status, 200);
  assert.equal(managerBDesktop.status, 200);
  assert.equal(managerADesktop.body.data.msg_user_id, MANAGER_A_USER_ID);
  assert.equal(managerAPhone.body.data.msg_user_id, MANAGER_A_USER_ID, "one manager keeps one principal across devices");
  assert.equal(managerBDesktop.body.data.msg_user_id, MANAGER_B_USER_ID);
  assert.notEqual(managerBDesktop.body.data.msg_user_id, managerADesktop.body.data.msg_user_id, "different managers retain distinct actors");
  assert.equal(managerADesktop.body.data.display_name, "Manager A");
  assert.equal(managerBDesktop.body.data.display_name, "Manager B");

  for (const result of [managerADesktop, managerAPhone, managerBDesktop]) {
    assert.equal(Object.hasOwn(result.body.data, "ops_manager_thread_id"), false);
  }
  assert.equal(calls.some((call) => call.fn === "msg_get_or_create_ops_manager_thread"), false);
  assert.deepEqual(
    calls.filter((call) => call.fn === "msg_ensure_ops_manager_user").map((call) => call.args.p_manager_id),
    [MANAGER_A_ID, MANAGER_A_ID, MANAGER_B_ID],
  );

  unavailableProfileUserIds.add(MANAGER_B_USER_ID);
  const managerBWithUnavailableEnrichment = await identity("manager-b-desktop");
  assert.equal(managerBWithUnavailableEnrichment.status, 200,
    "a resolved named-manager principal must remain available when optional enrichment fails");
  assert.equal(managerBWithUnavailableEnrichment.body.data.msg_user_id, MANAGER_B_USER_ID);
  assert.equal(managerBWithUnavailableEnrichment.body.data.display_name, "Manager B");
  assert.equal(managerBWithUnavailableEnrichment.body.data.role, "manager");
  unavailableProfileUserIds.delete(MANAGER_B_USER_ID);

  const anonymous = await identity("");
  assert.equal(anonymous.status, 401);
  console.log("NAMED_MANAGER_MESSENGER_IDENTITY_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
