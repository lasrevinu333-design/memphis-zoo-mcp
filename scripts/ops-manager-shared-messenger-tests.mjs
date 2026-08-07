import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const MANAGER_A_ID = "00000000-0000-4000-8000-000000000802";
const MANAGER_B_ID = "00000000-0000-4000-8000-000000000803";
const MANAGER_A_USER_ID = "00000000-0000-4000-8000-000000000804";
const MANAGER_B_USER_ID = "00000000-0000-4000-8000-000000000805";
const MANAGER_A_THREAD_ID = "00000000-0000-4000-8000-000000000806";
const MANAGER_B_THREAD_ID = "00000000-0000-4000-8000-000000000807";
const rpcCalls = [];

const sessions = new Map([
  ["manager-a-desktop", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-desktop", credential_id: "00000000-0000-4000-8000-000000000811" }],
  ["manager-a-phone", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-phone", credential_id: "00000000-0000-4000-8000-000000000812" }],
  ["manager-b-desktop", { manager_id: MANAGER_B_ID, manager_display_name: "Manager B", device_id: "manager-b-desktop", credential_id: "00000000-0000-4000-8000-000000000813" }],
]);

function userForManager(managerId) {
  if (managerId === MANAGER_A_ID) return { id: MANAGER_A_USER_ID, display_name: "Manager A" };
  if (managerId === MANAGER_B_ID) return { id: MANAGER_B_USER_ID, display_name: "Manager B" };
  return null;
}

async function runRpc(fn, args) {
  rpcCalls.push({ fn, args });
  if (fn === "msg_get_or_create_ops_manager_thread") {
    throw new Error("retired shared-room bootstrap must never be called");
  }
  if (fn === "msg_ensure_ops_manager_user") {
    const user = userForManager(args.p_manager_id);
    assert.ok(user, "only authenticated manager fixtures may receive a Messenger principal");
    return {
      ...user,
      user_id: user.id,
      msg_user_id: user.id,
      role: "manager",
      is_active: true,
      ops_manager_id: args.p_manager_id,
    };
  }
  throw new Error(`Unexpected RPC: ${fn}`);
}

async function runReadOnlySql(sql) {
  if (/from public\.msg_users u[\s\S]*join public\.ops_manager_managers m/i.test(sql)) {
    if (sql.includes(MANAGER_A_USER_ID)) {
      return [{ msg_user_id: MANAGER_A_USER_ID, manager_id: MANAGER_A_ID, manager_display_name: "Manager A", job_title: "Operations Manager A", department_key: "operations", manager_roles: ["OPS_MANAGER"] }];
    }
    if (sql.includes(MANAGER_B_USER_ID)) {
      return [{ msg_user_id: MANAGER_B_USER_ID, manager_id: MANAGER_B_ID, manager_display_name: "Manager B", job_title: "Operations Manager B", department_key: "operations", manager_roles: ["OPS_MANAGER"] }];
    }
  }
  if (/thread_participants/i.test(sql) && /last_messages/i.test(sql)) {
    if (sql.includes(MANAGER_A_USER_ID)) {
      return [{ thread_id: MANAGER_A_THREAD_ID, thread_type: "direct", thread_title: "Manager A conversation", system_key: null, is_ops_manager_shared: false, viewer_can_send: true, participant_names: "Manager A, Employee A", unread_count: 0, updated_at: "2026-08-07T00:00:00.000Z" }];
    }
    if (sql.includes(MANAGER_B_USER_ID)) {
      return [{ thread_id: MANAGER_B_THREAD_ID, thread_type: "direct", thread_title: "Manager B conversation", system_key: null, is_ops_manager_shared: false, viewer_can_send: true, participant_names: "Manager B, Employee B", unread_count: 0, updated_at: "2026-08-07T00:00:00.000Z" }];
    }
  }
  return [];
}

function managerBoundary(req, res, next) {
  const token = String(req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session) {
    res.status(401).json({ ok: false, error: "Trusted Ops Manager session required." });
    return;
  }
  req.memphisAuth = { ...session, roles: ["OPS_MANAGER"], read_only: false };
  next();
}

async function startServer() {
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
  return {
    async request(token, path) {
      const response = await fetch(`${origin}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: response.status, payload: await response.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const first = await startServer();
try {
  const aDesktop = await first.request("manager-a-desktop", "/me/by-device");
  const aPhone = await first.request("manager-a-phone", "/me/by-device");
  const bDesktop = await first.request("manager-b-desktop", "/me/by-device");
  assert.equal(aDesktop.status, 200);
  assert.equal(aPhone.status, 200);
  assert.equal(bDesktop.status, 200);
  assert.equal(aDesktop.payload.data.msg_user_id, MANAGER_A_USER_ID);
  assert.equal(aPhone.payload.data.msg_user_id, MANAGER_A_USER_ID, "one named manager retains one principal across devices");
  assert.equal(bDesktop.payload.data.msg_user_id, MANAGER_B_USER_ID, "different managers retain different principals");
  assert.notEqual(aDesktop.payload.data.msg_user_id, bDesktop.payload.data.msg_user_id);
  assert.equal(Object.prototype.hasOwnProperty.call(aDesktop.payload.data, "ops_manager_thread_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bDesktop.payload.data, "ops_manager_thread_id"), false);

  const aThreads = await first.request("manager-a-phone", `/threads?user_id=${MANAGER_A_USER_ID}`);
  const bThreads = await first.request("manager-b-desktop", `/threads?user_id=${MANAGER_B_USER_ID}`);
  assert.equal(aThreads.status, 200);
  assert.equal(bThreads.status, 200);
  assert.equal(aThreads.payload.data[0].thread_id, MANAGER_A_THREAD_ID);
  assert.equal(bThreads.payload.data[0].thread_id, MANAGER_B_THREAD_ID);
  assert.equal(aThreads.payload.data[0].is_ops_manager_shared, false);
  assert.equal(bThreads.payload.data[0].is_ops_manager_shared, false);

  const impersonation = await first.request("manager-a-desktop", `/threads?user_id=${MANAGER_B_USER_ID}`);
  assert.equal(impersonation.status, 403, "a named manager session cannot impersonate another Messenger principal");
  const invalid = await first.request("revoked-or-expired-session", "/me/by-device");
  assert.equal(invalid.status, 401);
} finally {
  await first.close();
}

const restarted = await startServer();
try {
  const afterRestart = await restarted.request("manager-a-desktop", "/me/by-device");
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.payload.data.msg_user_id, MANAGER_A_USER_ID, "backend restart preserves deterministic named identity");
} finally {
  await restarted.close();
}

assert.equal(rpcCalls.some((call) => call.fn === "msg_get_or_create_ops_manager_thread"), false);
console.log("OPS_MANAGER_NAMED_MESSENGER_INTEGRATION_PASS");
