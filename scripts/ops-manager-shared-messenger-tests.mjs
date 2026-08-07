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
const MANAGER_A_MEMPHIS_ID = "00000000-0000-4000-8000-000000000808";
const MANAGER_B_MEMPHIS_ID = "00000000-0000-4000-8000-000000000809";
const MANAGER_A_CLIENT_ID = "00000000-0000-4000-8000-000000000821";
const MANAGER_B_CLIENT_ID = "00000000-0000-4000-8000-000000000822";
const rpcCalls = [];
const messages = [];

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

function threadForManager(managerId) {
  if (managerId === MANAGER_A_ID) return MANAGER_A_THREAD_ID;
  if (managerId === MANAGER_B_ID) return MANAGER_B_THREAD_ID;
  return "";
}

function memphisThreadForUser(userId) {
  if (userId === MANAGER_A_USER_ID) return MANAGER_A_MEMPHIS_ID;
  if (userId === MANAGER_B_USER_ID) return MANAGER_B_MEMPHIS_ID;
  return "";
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
  if (fn === "msg_get_or_create_memphis_thread") {
    const id = memphisThreadForUser(args.p_user_id);
    assert.ok(id, "Memphis thread must be scoped to the authenticated named principal");
    return { id, thread_type: "bot", title: "Memphis", is_active: true };
  }
  if (fn === "msg_send_message_as_ops_manager") {
    const user = userForManager(args.p_manager_id);
    assert.ok(user, "send actor must be an authenticated named manager");
    assert.equal(args.p_thread_id, threadForManager(args.p_manager_id), "manager may send only through the fixture's authorized thread");
    const duplicate = messages.find((row) => row.manager_id === args.p_manager_id && row.client_message_id === args.p_client_message_id);
    if (duplicate) return duplicate;
    const row = {
      id: args.p_manager_id === MANAGER_A_ID
        ? "00000000-0000-4000-8000-000000000831"
        : "00000000-0000-4000-8000-000000000832",
      thread_id: args.p_thread_id,
      manager_id: args.p_manager_id,
      sender_user_id: user.id,
      sender_display_name: user.display_name,
      body: args.p_body,
      message_type: args.p_message_type,
      client_message_id: args.p_client_message_id,
      sent_at: "2026-08-07T00:05:00.000Z",
      created_at: "2026-08-07T00:05:00.000Z",
      updated_at: "2026-08-07T00:05:00.000Z",
      is_deleted: false,
    };
    messages.push(row);
    return row;
  }
  if (fn === "msg_mark_thread_read") {
    return { marked: true, thread_id: args.p_thread_id, user_id: args.p_user_id };
  }
  throw new Error(`Unexpected RPC: ${fn}`);
}

function includesPair(sql, threadId, userId) {
  return sql.includes(threadId) && sql.includes(userId);
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
  if (/^\s*select\s+1\s+from public\.msg_thread_participants/i.test(sql)) {
    if (includesPair(sql, MANAGER_A_THREAD_ID, MANAGER_A_USER_ID)) return [{ "?column?": 1 }];
    if (includesPair(sql, MANAGER_B_THREAD_ID, MANAGER_B_USER_ID)) return [{ "?column?": 1 }];
    return [];
  }
  if (/from public\.msg_threads t/i.test(sql) && /as has_memphis_bot/i.test(sql)) {
    if (sql.includes(MANAGER_A_THREAD_ID)) return [{ id: MANAGER_A_THREAD_ID, thread_type: "direct", title: "Manager A conversation", system_key: null, is_active: true, has_memphis_bot: false }];
    if (sql.includes(MANAGER_B_THREAD_ID)) return [{ id: MANAGER_B_THREAD_ID, thread_type: "direct", title: "Manager B conversation", system_key: null, is_active: true, has_memphis_bot: false }];
    if (sql.includes(MANAGER_A_MEMPHIS_ID)) return [{ id: MANAGER_A_MEMPHIS_ID, thread_type: "bot", title: "Memphis", system_key: null, is_active: true, has_memphis_bot: true }];
    if (sql.includes(MANAGER_B_MEMPHIS_ID)) return [{ id: MANAGER_B_MEMPHIS_ID, thread_type: "bot", title: "Memphis", system_key: null, is_active: true, has_memphis_bot: true }];
  }
  if (/thread_participants/i.test(sql) && /last_messages/i.test(sql)) {
    if (sql.includes(MANAGER_A_USER_ID)) {
      return [{ thread_id: MANAGER_A_THREAD_ID, thread_type: "direct", thread_title: "Manager A conversation", system_key: null, is_ops_manager_shared: false, viewer_can_send: true, participant_names: "Manager A, Employee A", unread_count: 0, updated_at: "2026-08-07T00:00:00.000Z" }];
    }
    if (sql.includes(MANAGER_B_USER_ID)) {
      return [{ thread_id: MANAGER_B_THREAD_ID, thread_type: "direct", thread_title: "Manager B conversation", system_key: null, is_ops_manager_shared: false, viewer_can_send: true, participant_names: "Manager B, Employee B", unread_count: 0, updated_at: "2026-08-07T00:00:00.000Z" }];
    }
  }
  if (/thread_messages/i.test(sql)) {
    if (sql.includes(MANAGER_A_THREAD_ID)) return messages.filter((row) => row.thread_id === MANAGER_A_THREAD_ID);
    if (sql.includes(MANAGER_B_THREAD_ID)) return messages.filter((row) => row.thread_id === MANAGER_B_THREAD_ID);
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
    async request(token, path, { method = "GET", body = null } = {}) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
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

  const sentA = await first.request("manager-a-phone", `/thread/${MANAGER_A_THREAD_ID}/message`, {
    method: "POST",
    body: { body: "Named manager A message", client_message_id: MANAGER_A_CLIENT_ID },
  });
  const retryA = await first.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/message`, {
    method: "POST",
    body: { body: "Named manager A message", client_message_id: MANAGER_A_CLIENT_ID },
  });
  const sentB = await first.request("manager-b-desktop", `/thread/${MANAGER_B_THREAD_ID}/message`, {
    method: "POST",
    body: { body: "Named manager B message", client_message_id: MANAGER_B_CLIENT_ID },
  });
  assert.equal(sentA.status, 200, JSON.stringify(sentA.payload));
  assert.equal(retryA.status, 200, JSON.stringify(retryA.payload));
  assert.equal(sentB.status, 200, JSON.stringify(sentB.payload));
  assert.equal(retryA.payload.data.id, sentA.payload.data.id, "cross-device retry remains one logical message");
  assert.equal(sentA.payload.data.sender_user_id, MANAGER_A_USER_ID);
  assert.equal(sentB.payload.data.sender_user_id, MANAGER_B_USER_ID);
  assert.notEqual(sentA.payload.data.sender_user_id, sentB.payload.data.sender_user_id);

  const aMessages = await first.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/messages?user_id=${MANAGER_A_USER_ID}&limit=100`);
  const bMessages = await first.request("manager-b-desktop", `/thread/${MANAGER_B_THREAD_ID}/messages?user_id=${MANAGER_B_USER_ID}&limit=100`);
  assert.deepEqual(aMessages.payload.data.map((row) => row.body), ["Named manager A message"]);
  assert.deepEqual(bMessages.payload.data.map((row) => row.body), ["Named manager B message"]);

  const readA = await first.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/read`, {
    method: "POST",
    body: { user_id: MANAGER_A_USER_ID },
  });
  assert.equal(readA.status, 200);
  assert.equal(readA.payload.data.user_id, MANAGER_A_USER_ID);

  const memphisA = await first.request("manager-a-phone", "/memphis/thread", {
    method: "POST",
    body: { user_id: MANAGER_A_USER_ID },
  });
  assert.equal(memphisA.status, 200);
  assert.equal(memphisA.payload.data.id, MANAGER_A_MEMPHIS_ID);

  const impersonation = await first.request("manager-a-desktop", `/threads?user_id=${MANAGER_B_USER_ID}`);
  assert.equal(impersonation.status, 403, "a named manager session cannot impersonate another Messenger principal");
  const forgedSend = await first.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/message`, {
    method: "POST",
    body: { sender_user_id: MANAGER_B_USER_ID, body: "forged", client_message_id: "00000000-0000-4000-8000-000000000823" },
  });
  assert.equal(forgedSend.status, 403);
  const forgedRead = await first.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/read`, {
    method: "POST",
    body: { user_id: MANAGER_B_USER_ID },
  });
  assert.equal(forgedRead.status, 403);
  const forgedMemphis = await first.request("manager-a-desktop", "/memphis/thread", {
    method: "POST",
    body: { user_id: MANAGER_B_USER_ID },
  });
  assert.equal(forgedMemphis.status, 403);
  const invalid = await first.request("revoked-or-expired-session", "/me/by-device");
  assert.equal(invalid.status, 401);
} finally {
  await first.close();
}

const restarted = await startServer();
try {
  const afterRestart = await restarted.request("manager-a-desktop", "/me/by-device");
  const threadsAfterRestart = await restarted.request("manager-a-desktop", `/threads?user_id=${MANAGER_A_USER_ID}`);
  const messagesAfterRestart = await restarted.request("manager-a-desktop", `/thread/${MANAGER_A_THREAD_ID}/messages?user_id=${MANAGER_A_USER_ID}&limit=100`);
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.payload.data.msg_user_id, MANAGER_A_USER_ID, "backend restart preserves deterministic named identity");
  assert.equal(threadsAfterRestart.payload.data[0].thread_id, MANAGER_A_THREAD_ID);
  assert.deepEqual(messagesAfterRestart.payload.data.map((row) => row.body), ["Named manager A message"], "reconnect preserves the named manager conversation");
} finally {
  await restarted.close();
}

assert.equal(messages.length, 2, "idempotent retry must not duplicate messages");
assert.equal(rpcCalls.some((call) => call.fn === "msg_get_or_create_ops_manager_thread"), false);
assert.ok(rpcCalls.some((call) => call.fn === "msg_mark_thread_read" && call.args.p_user_id === MANAGER_A_USER_ID));
assert.ok(rpcCalls.some((call) => call.fn === "msg_get_or_create_memphis_thread" && call.args.p_user_id === MANAGER_A_USER_ID));
console.log("OPS_MANAGER_NAMED_MESSENGER_INTEGRATION_PASS");
