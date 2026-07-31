import assert from "node:assert/strict";
import express from "express";
import { createMessagingRouter } from "../src/messaging-api.js";

const USER_ID = "00000000-0000-4000-8000-000000000088";
const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000099";
const DEVICE_ID = "KIOSK_TEST";
const readQueries = [];

async function runReadOnlySql(sql) {
  const query = String(sql || "");
  readQueries.push(query);
  if (/public\.device_aliases/i.test(query) && /order by match_rank/i.test(query)) {
    return [{
      requested_device_id: DEVICE_ID,
      matched_by: "canonical",
      canonical_device_id: DEVICE_ID,
      device_id: DEVICE_ID,
      device_name: "Incremental sync test device",
      device_active: true,
      assigned_employee_id: "30000000-0000-4000-8000-000000000088",
      assigned_employee_name: "Incremental Sync Tester",
      employee_code: "SYNC_TEST",
      employee_active: true,
    }];
  }
  if (/msg_get_user_by_device/i.test(query)) {
    return [{
      msg_user_id: USER_ID,
      display_name: "Incremental Sync Tester",
      role: "employee",
      canonical_device_id: DEVICE_ID,
    }];
  }
  if (/thread_updates/i.test(query)) {
    return [{
      id: MESSAGE_ID,
      thread_id: THREAD_ID,
      sender_user_id: USER_ID,
      sender_display_name: "Incremental Sync Tester",
      message_type: "text",
      body: "[deleted]",
      metadata_json: { deleted_by: USER_ID },
      sent_at: "2026-07-18T12:00:00.000Z",
      created_at: "2026-07-18T12:00:00.000Z",
      updated_at: "2026-07-18T12:05:00.000Z",
      is_deleted: true,
    }];
  }
  if (/visible_threads/i.test(query)) {
    return [{ thread_id: THREAD_ID, changed_at: "2026-07-18T12:00:00.000Z" }];
  }
  return [];
}

const app = express();
app.use(express.json());
app.use("/messaging-api", createMessagingRouter({
  runReadOnlySql,
  runRpc: async () => null,
  buildHealthPayload: (area, extra) => ({ ok: true, area, ...extra }),
  appVersion: "test",
  releaseId: "test",
  contractVersion: "messaging.v2",
}));

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});

try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/messaging-api`;
  const query = new URLSearchParams({
    user_id: USER_ID,
    device_id: DEVICE_ID,
    after: "1970-01-01T00:00:00.000Z",
    after_id: "00000000-0000-0000-0000-000000000000",
    request_seq: "17",
    wait_ms: "1",
  });

  let response = await fetch(`${base}/thread/${THREAD_ID}/updates?${query}`);
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].id, MESSAGE_ID);
  assert.equal(payload.data[0].is_deleted, true, "deletion tombstones propagate through the incremental cursor");
  assert.equal(payload.meta.transport, "cursor_long_poll");
  assert.equal(payload.meta.request_sequence, 17);
  assert.deepEqual(payload.meta.next_cursor, {
    after: "2026-07-18T12:05:00.000Z",
    after_id: MESSAGE_ID,
  });

  response = await fetch(`${base}/me/by-device`, { headers: { "X-Device-Id": DEVICE_ID } });
  assert.equal(response.status, 200, "the authenticated device header must satisfy identity lookup without a duplicate query parameter");
  payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.canonical_device_id, DEVICE_ID);

  response = await fetch(`${base}/threads/updates?${query}`);
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].thread_id, THREAD_ID);
  assert.equal(payload.meta.transport, "cursor_long_poll");
  assert.deepEqual(payload.meta.next_cursor, {
    after: "2026-07-18T12:00:00.000Z",
    after_id: THREAD_ID,
  });

  response = await fetch(`${base}/thread/${THREAD_ID}/updates?device_id=${DEVICE_ID}&user_id=${USER_ID}&after=not-a-date&after_id=${MESSAGE_ID}`);
  assert.equal(response.status, 422, "invalid cursors must be rejected before a long poll begins");

  response = await fetch(`${base}/thread/${THREAD_ID}/updates?after=1970-01-01T00%3A00%3A00.000Z&after_id=${MESSAGE_ID}`);
  assert.equal(response.status, 401, "anonymous incremental message access must fail closed");

  const messageSql = readQueries.find((sql) => /thread_updates/i.test(sql));
  assert.ok(messageSql);
  assert.match(messageSql, /\(m\.updated_at, m\.id\) >/);
  assert.match(messageSql, /order by m\.updated_at asc, m\.id asc/);
  assert.doesNotMatch(messageSql, /m\.is_deleted\s*=\s*false/, "deleted-message tombstones are not suppressed from reconciliation");
  assert.match(messageSql, /msg_thread_participants/);

  const threadSql = readQueries.find((sql) => /visible_threads/i.test(sql));
  assert.ok(threadSql);
  assert.match(threadSql, /msg_thread_participants/);
  assert.match(threadSql, /msg_receipts/);

  console.log("MESSAGING_INCREMENTAL_SYNC_TESTS_PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
