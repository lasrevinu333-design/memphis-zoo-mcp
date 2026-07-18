import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const SHARED_THREAD_ID = "00000000-0000-4000-8000-000000000801";
const MANAGER_A_ID = "00000000-0000-4000-8000-000000000802";
const MANAGER_B_ID = "00000000-0000-4000-8000-000000000803";
const MANAGER_A_USER_ID = "00000000-0000-4000-8000-000000000804";
const MANAGER_B_USER_ID = "00000000-0000-4000-8000-000000000805";
const participants = new Set();
const messages = [];
const rpcCalls = [];

const sessions = new Map([
  ["manager-a-desktop", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-desktop", credential_id: "00000000-0000-4000-8000-000000000811" }],
  ["manager-a-phone", { manager_id: MANAGER_A_ID, manager_display_name: "Manager A", device_id: "manager-a-phone", credential_id: "00000000-0000-4000-8000-000000000812" }],
  ["manager-b-desktop", { manager_id: MANAGER_B_ID, manager_display_name: "Manager B", device_id: "manager-b-desktop", credential_id: "00000000-0000-4000-8000-000000000813" }],
]);

function userForManager(managerId) {
  if (managerId === MANAGER_A_ID || managerId === MANAGER_B_ID) return { id: MANAGER_A_USER_ID, display_name: "Ops Manager" };
  return null;
}

async function runRpc(fn, args) {
  rpcCalls.push({ fn, args });
  if (fn === "msg_ensure_ops_manager_user") {
    const user = userForManager(args.p_manager_id);
    assert.ok(user, "only authenticated manager fixtures may receive a Messenger principal");
    return { ...user, user_id: user.id, msg_user_id: user.id, role: "manager", is_active: true, messaging_identity_key: "ops_manager_shared_identity_v1" };
  }
  if (fn === "msg_get_or_create_ops_manager_thread") {
    const user = userForManager(args.p_manager_id);
    assert.ok(user);
    participants.add(user.id);
    return { id: SHARED_THREAD_ID, thread_type: "group", title: "Ops Manager Chat", system_key: "ops_manager_shared_chat_v1" };
  }
  if (fn === "msg_get_or_create_memphis_thread") return { id: randomUUID(), thread_type: "bot", title: "Memphis" };
  if (fn === "msg_send_message_as_ops_manager") {
    assert.equal(args.p_thread_id, SHARED_THREAD_ID);
    assert.ok(userForManager(args.p_manager_id));
    const duplicate = messages.find((row) => row.sender_user_id === MANAGER_A_USER_ID && row.client_message_id === args.p_client_message_id);
    if (duplicate) return duplicate;
    const row = {
      id: randomUUID(),
      thread_id: SHARED_THREAD_ID,
      sender_user_id: MANAGER_A_USER_ID,
      sender_display_name: "Ops Manager",
      authenticated_manager_id: args.p_manager_id,
      body: args.p_body,
      message_type: "text",
      client_message_id: args.p_client_message_id,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false,
    };
    messages.push(row);
    return row;
  }
  if (fn === "msg_delete_message") {
    const row = messages.find((message) => message.id === args.p_message_id);
    assert.ok(row, "message deletion targets a persisted message");
    assert.ok(participants.has(args.p_request_user_id), "deletion actor is a server-authenticated participant");
    if (!row.is_deleted) {
      row.body = "[deleted]";
      row.is_deleted = true;
      row.deleted_at = new Date(Date.now() + 1000).toISOString();
      row.purge_after = new Date(Date.parse(row.deleted_at) + 14 * 86400000).toISOString();
      row.updated_at = row.deleted_at;
    }
    return row;
  }
  if (fn === "msg_mark_thread_read") return 1;
  throw new Error(`Unexpected RPC: ${fn}`);
}

function uuidFrom(sql, pattern) {
  return sql.match(pattern)?.[1] || "";
}

async function runReadOnlySql(sql) {
  if (/^\s*select\s+1\s+from public\.msg_thread_participants/i.test(sql)) {
    const userId = uuidFrom(sql, /user_id\s*=\s*'([0-9a-f-]{36})'/i);
    return participants.has(userId) ? [{ "?column?": 1 }] : [];
  }
  if (/as has_memphis_bot/i.test(sql)) {
    return [{ id: SHARED_THREAD_ID, thread_type: "group", title: "Ops Manager Chat", system_key: "ops_manager_shared_chat_v1", is_active: true, has_memphis_bot: false }];
  }
  if (/select m\.id, m\.thread_id, m\.sender_user_id, m\.is_deleted/i.test(sql)) {
    const messageId = uuidFrom(sql, /m\.id\s*=\s*'([0-9a-f-]{36})'/i);
    const threadId = uuidFrom(sql, /m\.thread_id\s*=\s*'([0-9a-f-]{36})'/i);
    const row = messages.find((message) => message.id === messageId && message.thread_id === threadId);
    return row ? [{ id: row.id, thread_id: row.thread_id, sender_user_id: row.sender_user_id, is_deleted: row.is_deleted }] : [];
  }
  if (/thread_rows/i.test(sql)) {
    const viewerUserId = uuidFrom(sql, /tp\.user_id\s*=\s*'([0-9a-f-]{36})'/i) || (sql.includes(MANAGER_A_USER_ID) ? MANAGER_A_USER_ID : MANAGER_B_USER_ID);
    return [{
      thread_id: SHARED_THREAD_ID,
      thread_type: "group",
      thread_title: "Ops Manager Chat",
      system_key: "ops_manager_shared_chat_v1",
      is_ops_manager_shared: true,
      viewer_can_send: participants.has(viewerUserId),
      participant_names: "Ops Manager",
      unread_count: 0,
      updated_at: new Date().toISOString(),
    }];
  }
  if (/thread_messages/i.test(sql)) return messages.filter((message) => !message.is_deleted);
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

async function request(token, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return { status: response.status, payload: await response.json() };
}

try {
  const aDesktop = await request("manager-a-desktop", "/me/by-device");
  const aPhone = await request("manager-a-phone", "/me/by-device");
  const bDesktop = await request("manager-b-desktop", "/me/by-device");
  assert.equal(aDesktop.status, 200);
  assert.equal(aPhone.payload.data.msg_user_id, aDesktop.payload.data.msg_user_id, "one manager keeps one sender identity across devices");
  assert.equal(bDesktop.payload.data.msg_user_id, aDesktop.payload.data.msg_user_id, "all manager sessions share the one public Ops Manager messaging identity");
  assert.equal(aDesktop.payload.data.ops_manager_thread_id, SHARED_THREAD_ID);
  assert.equal(bDesktop.payload.data.ops_manager_thread_id, SHARED_THREAD_ID, "all manager sessions resolve the same room");

  const aThreads = await request("manager-a-phone", `/threads?user_id=${MANAGER_A_USER_ID}`);
  const bThreads = await request("manager-b-desktop", `/threads?user_id=${MANAGER_A_USER_ID}`);
  assert.equal(aThreads.payload.data[0].is_ops_manager_shared, true);
  assert.equal(bThreads.payload.data[0].thread_id, SHARED_THREAD_ID);
  assert.equal(aThreads.payload.data[0].viewer_can_send, true);
  assert.equal(bThreads.payload.data[0].viewer_can_send, true);

  const forged = await request("manager-a-desktop", `/thread/${SHARED_THREAD_ID}/message`, {
    method: "POST",
    body: JSON.stringify({ sender_user_id: MANAGER_B_USER_ID, body: "forged", client_message_id: randomUUID() }),
  });
  assert.equal(forged.status, 403, "a browser cannot choose another manager sender");

  const aClientId = randomUUID();
  const sentA = await request("manager-a-phone", `/thread/${SHARED_THREAD_ID}/message`, {
    method: "POST",
    body: JSON.stringify({ body: "Shared room from manager A", client_message_id: aClientId }),
  });
  const retryA = await request("manager-a-desktop", `/thread/${SHARED_THREAD_ID}/message`, {
    method: "POST",
    body: JSON.stringify({ body: "Shared room from manager A", client_message_id: aClientId }),
  });
  const sentB = await request("manager-b-desktop", `/thread/${SHARED_THREAD_ID}/message`, {
    method: "POST",
    body: JSON.stringify({ body: "Shared room from manager B", client_message_id: randomUUID() }),
  });
  assert.equal(sentA.status, 200, JSON.stringify(sentA.payload));
  assert.equal(retryA.payload.data.id, sentA.payload.data.id, "cross-device retry keeps one logical message");
  assert.equal(sentB.payload.data.sender_user_id, MANAGER_A_USER_ID);
  assert.equal(sentB.payload.data.authenticated_manager_id, MANAGER_B_ID, "the server still retains the authenticated manager behind the shared public sender");
  assert.equal(messages.length, 2);

  const visibleToB = await request("manager-b-desktop", `/thread/${SHARED_THREAD_ID}/messages?user_id=${MANAGER_A_USER_ID}&limit=100`);
  assert.deepEqual(visibleToB.payload.data.map((row) => row.body), ["Shared room from manager A", "Shared room from manager B"]);

  const forgedDelete = await request("manager-a-desktop", `/thread/${SHARED_THREAD_ID}/message/${sentA.payload.data.id}/delete`, {
    method: "POST",
    body: JSON.stringify({ user_id: MANAGER_B_USER_ID }),
  });
  assert.equal(forgedDelete.status, 403, "a browser cannot choose the message-deletion actor");

  const deletedByManagerB = await request("manager-b-desktop", `/thread/${SHARED_THREAD_ID}/message/${sentA.payload.data.id}/delete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(deletedByManagerB.status, 200, JSON.stringify(deletedByManagerB.payload));
  assert.equal(deletedByManagerB.payload.data.is_deleted, true);
  assert.equal(deletedByManagerB.payload.data.body, "[deleted]");
  const deleteCall = rpcCalls.find((call) => call.fn === "msg_delete_message");
  assert.equal(deleteCall.args.p_request_user_id, MANAGER_A_USER_ID, "server session supplies the shared public deletion actor");

  const deleteRetry = await request("manager-b-desktop", `/thread/${SHARED_THREAD_ID}/message/${sentA.payload.data.id}/delete`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(deleteRetry.status, 200, "message deletion is idempotent");
  assert.equal(messages.length, 2, "soft deletion never duplicates or hard-deletes the row");
  const afterDelete = await request("manager-a-phone", `/thread/${SHARED_THREAD_ID}/messages?limit=100`);
  assert.equal(afterDelete.payload.data.some((row) => row.id === sentA.payload.data.id), false, "deleted messages disappear from every manager device");

  const deleteShared = await request("manager-a-desktop", `/thread/${SHARED_THREAD_ID}/delete`, { method: "POST", body: JSON.stringify({ operation_id: randomUUID() }) });
  assert.equal(deleteShared.status, 409, "the canonical manager room cannot be hidden or deleted");
  const anonymous = await request("", "/me/by-device");
  assert.equal(anonymous.status, 401);
  assert.ok(rpcCalls.some((call) => call.fn === "msg_get_or_create_ops_manager_thread"));
  console.log("OPS_MANAGER_SHARED_MESSENGER_INTEGRATION_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
