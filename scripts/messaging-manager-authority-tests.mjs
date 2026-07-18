import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const MANAGER_ID = "00000000-0000-4000-8000-000000000701";
const MANAGER_USER_ID = "00000000-0000-4000-8000-000000000702";
const FORGED_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000703";
const THREAD_ID = "00000000-0000-4000-8000-000000000704";
const calls = [];

async function runRpc(fn, args) {
  calls.push({ fn, args });
  if (fn === "msg_ensure_ops_manager_user") {
    assert.equal(args.p_manager_id, MANAGER_ID);
    return { id: MANAGER_USER_ID, user_id: MANAGER_USER_ID, display_name: "Authority Test Manager", role: "manager", is_active: true, ops_manager_id: MANAGER_ID };
  }
  if (fn === "msg_send_broadcast") return { id: "broadcast-test", sender_user_id: args.p_sender_user_id };
  if (fn === "msg_send_message") return { id: "message-test", sender_user_id: args.p_sender_user_id };
  if (fn === "msg_mark_thread_read") return { marked: true, user_id: args.p_user_id };
  return {};
}

async function runReadOnlySql(sql) {
  if (/from public\.msg_threads t/i.test(sql)) {
    return [{ id: THREAD_ID, thread_type: "group", title: "Authority test", is_active: true, has_memphis_bot: false }];
  }
  if (/from public\.msg_thread_participants/i.test(sql)) return [];
  return [];
}

function managerBoundary(req, _res, next) {
  req.memphisAuth = {
    manager_id: MANAGER_ID,
    manager_display_name: "Authority Test Manager",
    credential_id: "00000000-0000-4000-8000-000000000705",
    device_id: "authority-test-manager-browser",
    roles: ["CUSTODIAL_MANAGER", "OPS_MANAGER"],
    read_only: false,
  };
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
  contractVersion: "messaging.v3",
}));

const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function post(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const forgedMessage = await post(`/messaging-api/thread/${THREAD_ID}/message`, {
    sender_user_id: FORGED_EMPLOYEE_ID,
    body: "forged",
    client_message_id: "00000000-0000-4000-8000-000000000706",
  });
  assert.equal(forgedMessage.status, 403);
  assert.match(forgedMessage.body.error, /cannot impersonate/i);

  const forgedRead = await post(`/messaging-api/thread/${THREAD_ID}/read`, { user_id: FORGED_EMPLOYEE_ID });
  assert.equal(forgedRead.status, 403);

  const forgedBroadcast = await post("/messaging-api/broadcast", {
    sender_user_id: FORGED_EMPLOYEE_ID,
    title: "Forged",
    body: "forged",
  });
  assert.equal(forgedBroadcast.status, 403);

  const validBroadcast = await post("/messaging-api/broadcast", { title: "Operations", body: "Manager authority test" });
  assert.equal(validBroadcast.status, 200);
  const broadcastCall = calls.find((call) => call.fn === "msg_send_broadcast");
  assert.equal(broadcastCall.args.p_sender_user_id, MANAGER_USER_ID);

  const deviceAck = await post("/messaging-api/device-notifications/ack", {
    device_id: "FORGED_EMPLOYEE_DEVICE",
    notification_key: "forged",
  });
  assert.equal(deviceAck.status, 403);
  assert.match(deviceAck.body.error, /manager sessions cannot acknowledge/i);

  assert.equal(calls.some((call) => call.fn === "msg_send_message"), false);
  assert.equal(calls.some((call) => call.fn === "msg_mark_thread_read"), false);
  console.log("MESSAGING_MANAGER_SERVER_AUTHORITY_INTEGRATION_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
