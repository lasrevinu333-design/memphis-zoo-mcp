#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const DEVICE_USER = "00000000-0000-4000-8000-00000000e112";
const MANAGER_ID = "00000000-0000-4000-8000-00000000e501";
const GENERATED_MANAGER_PRINCIPAL = "00000000-0000-4000-8000-00000000e503";
const UNRELATED_SAME_NAME_PRINCIPAL = "00000000-0000-4000-8000-00000000e502";
const RETIRED_MESSAGE = "00000000-0000-4000-8000-00000000e130";
const INACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e114";
const INACTIVE_THREAD = "00000000-0000-4000-8000-00000000e110";
const ACTIVE_THREAD = "00000000-0000-4000-8000-00000000e120";
const ACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e121";
const calls = [];
let memphisHandler = null;

function retiredOrInactiveError() {
  return Object.assign(new Error("The retired or inactive conversation cannot be modified."), { status: 409 });
}

async function runReadOnlySql(sql) {
  const query = String(sql || "");
  if (/from public\.device_aliases/i.test(query) && /from public\.devices/i.test(query)) {
    return [{ canonical_device_id: "NMMS-ROUTE-DEVICE", device_id: "NMMS-ROUTE-DEVICE", device_active: true, assigned_employee_id: "employee-fixture", employee_active: true }];
  }
  if (/msg_get_user_by_device\('NMMS-ROUTE-DEVICE'\)/i.test(query)) {
    return [{ msg_user_id: DEVICE_USER, role: "employee", display_name: "Route Fixture Employee" }];
  }
  if (/from public\.msg_threads t/i.test(query) && query.includes(INACTIVE_THREAD)) {
    return [{ id: INACTIVE_THREAD, thread_type: "group", title: "inactive", system_key: null, is_active: false, has_memphis_bot: false }];
  }
  if (/join public\.ops_manager_managers m/i.test(query)) {
    return [{ msg_user_id: GENERATED_MANAGER_PRINCIPAL, manager_id: MANAGER_ID, manager_display_name: "Same Name Collision", manager_roles: ["OPS_MANAGER"] }];
  }
  if (/from public\.msg_messages m/i.test(query) && /join public\.msg_threads t/i.test(query)) {
    assert.match(query, /t\.is_active is true/i, "Memphis background source lookup must require an active thread");
    assert.match(query, /t\.system_key is distinct from 'ops_manager_shared_chat_v1'/i,
      "Memphis background source lookup must reject the retired archive by exact key");
    return [];
  }
  return [];
}

async function runRpc(fn, args) {
  calls.push({ fn, args });
  if (fn === "msg_ensure_ops_manager_user") {
    assert.equal(args.p_manager_id, MANAGER_ID);
    return {
      id: GENERATED_MANAGER_PRINCIPAL,
      msg_user_id: GENERATED_MANAGER_PRINCIPAL,
      display_name: "Same Name Collision · Leadership 00000000",
      role: "manager",
      is_active: true,
      ops_manager_id: MANAGER_ID,
    };
  }
  if (fn === "msg_acknowledge_event_device_notification") throw retiredOrInactiveError();
  if (fn === "msg_send_message") throw new Error("background reply must fail before a send RPC for inactive source");
  if (fn === "msg_delete_thread" || fn === "msg_admin_tombstone_thread") throw new Error("inactive route reached a writer RPC");
  if (fn === "ack_device_notification" || fn === "msg_acknowledge_message") throw new Error("event acknowledgement was split into non-atomic RPCs");
  return {};
}

function boundary(req, _res, next) {
  if (String(req.header("authorization") || "") === "Bearer manager") {
    req.memphisAuth = { manager_id: MANAGER_ID, manager_display_name: "Same Name Collision", device_id: "manager-route-device", roles: ["OPS_MANAGER"], read_only: false };
  } else {
    req.memphisDevice = { canonical_device_id: "NMMS-ROUTE-DEVICE", device_id: "NMMS-ROUTE-DEVICE" };
  }
  next();
}

const app = express();
app.use(express.json());
app.use("/messaging-api", createMessagingRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload: () => ({ ok: true }),
  requireDeviceAccess: boundary,
  requireOpsManagerAuth: boundary,
  registerOperationalJobHandler: (name, handler) => {
    if (name === "memphis_bot_reply") memphisHandler = handler;
  },
  appVersion: "test",
  releaseId: "test",
  contractVersion: "messaging.v4",
}));

const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/messaging-api`;

async function post(path, body, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  for (const messageId of [RETIRED_MESSAGE, INACTIVE_MESSAGE]) {
    const response = await post("/device-notifications/ack", {
      device_id: "NMMS-ROUTE-DEVICE",
      notification_key: `route-${messageId}`,
      notification_type: "event",
      action: "acknowledged",
      message_id: messageId,
    });
    assert.equal(response.status, 409);
    assert.match(response.body.error, /retired or inactive/i);
  }
  assert.equal(calls.filter((call) => call.fn === "msg_acknowledge_event_device_notification").length, 2,
    "linked event acknowledgements must use the single atomic RPC");
  assert.equal(calls.some((call) => call.fn === "ack_device_notification" || call.fn === "msg_acknowledge_message"), false,
    "route must not commit native acknowledgement before linked-message rejection");

  const inactiveDelete = await post(`/thread/${INACTIVE_THREAD}/delete`, {
    device_id: "NMMS-ROUTE-DEVICE",
    operation_id: "00000000-0000-4000-8000-00000000e116",
  });
  assert.equal(inactiveDelete.status, 409);
  const inactiveTombstone = await post(`/thread/${INACTIVE_THREAD}/admin-tombstone`, {
    operation_id: "00000000-0000-4000-8000-00000000e117",
  }, { Authorization: "Bearer manager" });
  assert.equal(inactiveTombstone.status, 409);
  assert.equal(calls.some((call) => call.fn === "msg_delete_thread" || call.fn === "msg_admin_tombstone_thread"), false,
    "inactive deletion routes must reject before their writer RPCs");

  const callsBeforeMessageDelete = calls.length;
  const retiredMessageDelete = await post(`/thread/${ACTIVE_THREAD}/message/${ACTIVE_MESSAGE}/delete`, {
    device_id: "NMMS-ROUTE-DEVICE",
    user_id: UNRELATED_SAME_NAME_PRINCIPAL,
  });
  assert.equal(retiredMessageDelete.status, 410);
  assert.match(retiredMessageDelete.body.error, /delete the conversation/i);
  assert.equal(calls.length, callsBeforeMessageDelete,
    "retired individual-message deletion route reached a database RPC");

  const identity = await fetch(`${origin}/me/by-device`, { headers: { Authorization: "Bearer manager" } });
  const identityPayload = await identity.json();
  assert.equal(identity.status, 200);
  assert.equal(identityPayload.data.msg_user_id, GENERATED_MANAGER_PRINCIPAL,
    "route must use the database-resolved manager principal, not a same-name Messenger row");
  assert.notEqual(identityPayload.data.msg_user_id, UNRELATED_SAME_NAME_PRINCIPAL);

  assert.ok(memphisHandler, "Memphis background handler was not registered");
  await assert.rejects(
    () => memphisHandler({ source_id: INACTIVE_MESSAGE, payload_json: { message_id: INACTIVE_MESSAGE } }),
    /source message no longer exists/i,
  );
  assert.equal(calls.some((call) => call.fn === "msg_send_message"), false,
    "inactive Memphis background source must not reach the send writer");

  console.log("NAMED_MANAGER_MESSENGER_RETIREMENT_CORRECTION_ROUTE_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
