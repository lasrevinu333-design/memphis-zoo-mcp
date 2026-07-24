import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const MANAGER_ID = "00000000-0000-4000-8000-000000000701";
const MANAGER_USER_ID = "00000000-0000-4000-8000-000000000702";
const FORGED_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000703";
const THREAD_ID = "00000000-0000-4000-8000-000000000704";
const SHARED_THREAD_ID = "00000000-0000-4000-8000-000000000707";
const calls = [];

async function runRpc(fn, args) {
  calls.push({ fn, args });
  if (fn === "msg_ensure_ops_manager_user") {
    assert.equal(args.p_manager_id, MANAGER_ID);
    return { id: MANAGER_USER_ID, user_id: MANAGER_USER_ID, display_name: "Authority Test Manager", role: "manager", is_active: true, ops_manager_id: MANAGER_ID };
  }
  if (fn === "msg_get_or_create_ops_manager_thread") {
    assert.equal(args.p_manager_id, MANAGER_ID);
    return { id: SHARED_THREAD_ID, thread_type: "group", title: "Ops Manager Chat", system_key: "ops_manager_shared_chat_v1" };
  }
  if (fn === "msg_send_broadcast") return { id: "broadcast-test", sender_user_id: args.p_sender_user_id };
  if (fn === "msg_create_group_thread_v2") return { id: THREAD_ID, created_by_user_id: args.p_created_by_user_id, title: args.p_title, client_thread_id: args.p_client_thread_id };
  if (fn === "msg_send_message") return { id: "message-test", sender_user_id: args.p_sender_user_id };
  if (fn === "msg_delete_message") {
    return {
      id: "00000000-0000-4000-8000-000000000708",
      thread_id: THREAD_ID,
      sender_user_id: MANAGER_USER_ID,
      body: "[deleted]",
      is_deleted: true,
      deleted_at: "2026-07-24T18:00:00.000Z",
      purge_after: "2026-08-07T18:00:00.000Z",
    };
  }
  if (fn === "msg_mark_thread_read") return { marked: true, user_id: args.p_user_id };
  return {};
}

async function runReadOnlySql(sql) {
  if (/from public\.msg_users u[\s\S]*join public\.ops_manager_managers m/i.test(sql)) {
    return [{
      msg_user_id: MANAGER_USER_ID,
      manager_id: MANAGER_ID,
      manager_display_name: "Authority Test Manager",
      job_title: "Director of Test Operations",
      department_key: "operations",
      manager_roles: ["DIRECTOR"],
    }];
  }
  if (/msg_list_users/i.test(sql)) {
    return [
      { id: MANAGER_USER_ID, display_name: "Authority Test Manager", role: "manager", is_active: true },
      { id: FORGED_EMPLOYEE_ID, display_name: "Authority Test Employee", role: "employee", is_active: true },
    ];
  }
  if (/select m\.id, m\.thread_id, m\.sender_user_id, m\.is_deleted/i.test(sql)) {
    return [{ id: "00000000-0000-4000-8000-000000000708", thread_id: THREAD_ID, sender_user_id: MANAGER_USER_ID, is_deleted: false }];
  }
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
  contractVersion: "messaging.v4",
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
async function get(path) {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.json() };
}

try {
  const identity = await get("/messaging-api/me/by-device");
  assert.equal(identity.status, 200);
  assert.equal(identity.body.data.display_name, "Authority Test Manager");
  assert.equal(identity.body.data.role_title, "Director of Test Operations");
  assert.equal(identity.body.data.department_key, "operations");

  const users = await get("/messaging-api/users");
  assert.equal(users.status, 200);
  const managerContact = users.body.data.find((row) => row.id === MANAGER_USER_ID);
  assert.equal(managerContact.role_title, "Director of Test Operations");
  assert.equal(managerContact.job_title, "Director of Test Operations");
  const employeeContact = users.body.data.find((row) => row.id === FORGED_EMPLOYEE_ID);
  assert.equal(employeeContact.role_title, "Employee");
  const forgedMessage = await post(`/messaging-api/thread/${THREAD_ID}/message`, {
    sender_user_id: FORGED_EMPLOYEE_ID,
    body: "forged",
    client_message_id: "00000000-0000-4000-8000-000000000706",
  });
  assert.equal(forgedMessage.status, 403);
  assert.match(forgedMessage.body.error, /cannot impersonate/i);

  const forgedRead = await post(`/messaging-api/thread/${THREAD_ID}/read`, { user_id: FORGED_EMPLOYEE_ID });
  assert.equal(forgedRead.status, 403);

  const forgedMessageDelete = await post(`/messaging-api/thread/${THREAD_ID}/message/00000000-0000-4000-8000-000000000708/delete`, {
    user_id: FORGED_EMPLOYEE_ID,
  });
  assert.equal(forgedMessageDelete.status, 403);
  assert.match(forgedMessageDelete.body.error, /derived from authenticated server identity/i);
  assert.equal(calls.some((call) => call.fn === "msg_delete_message"), false, "forged actor input must fail before the database RPC");

  const authoritativeMessageDelete = await post(`/messaging-api/thread/${THREAD_ID}/message/00000000-0000-4000-8000-000000000708/delete`, {});
  assert.equal(authoritativeMessageDelete.status, 200);
  assert.equal(authoritativeMessageDelete.body.data.is_deleted, true);
  assert.equal(authoritativeMessageDelete.body.meta.retention_hours, 336);
  const deleteCall = calls.find((call) => call.fn === "msg_delete_message");
  assert.deepEqual(deleteCall.args, {
    p_message_id: "00000000-0000-4000-8000-000000000708",
    p_request_user_id: MANAGER_USER_ID,
  });

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

  const selectedRecipients = [
    "00000000-0000-4000-8000-000000000711",
    "00000000-0000-4000-8000-000000000712",
    "00000000-0000-4000-8000-000000000713",
  ];
  const managerGroup = await post("/messaging-api/thread/group", {
    created_by_user_id: MANAGER_USER_ID,
    title: "Custodial Team",
    member_user_ids: selectedRecipients,
    client_thread_id: "thread:manager-authority-test",
  });
  assert.equal(managerGroup.status, 200);
  const groupCall = calls.find((call) => call.fn === "msg_create_group_thread_v2");
  assert.equal(groupCall.args.p_created_by_user_id, MANAGER_USER_ID, "group creator is server-derived");
  assert.deepEqual(groupCall.args.p_member_user_ids, selectedRecipients, "all selected recipients are preserved exactly once");
  assert.equal(groupCall.args.p_client_thread_id, "thread:manager-authority-test", "group retries retain one stable operation id");

  const forgedGroupCreator = await post("/messaging-api/thread/group", {
    created_by_user_id: FORGED_EMPLOYEE_ID,
    title: "Forged role",
    member_user_ids: selectedRecipients,
    client_thread_id: "thread:forged-authority-test",
  });
  assert.equal(forgedGroupCreator.status, 403, "a browser cannot choose the group creator or role");

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
