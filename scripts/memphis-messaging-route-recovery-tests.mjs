import assert from 'node:assert/strict';
import express from 'express';
import { createMessagingRouter } from '../src/messaging-api.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const BOT_ID = '10000000-0000-4000-8000-000000000002';
const THREAD_ID = '20000000-0000-4000-8000-000000000001';
const rpcCalls = [];
let messageCounter = 0;

const runReadOnlySql = async (sql) => {
  const query = String(sql || '');
  if (/public\.device_aliases/i.test(query) && /order by match_rank/i.test(query)) {
    return [{
      requested_device_id: 'KIOSK_02', matched_by: 'canonical', canonical_device_id: 'KIOSK_02',
      device_id: 'KIOSK_02', device_name: 'Alijah phone', device_active: true,
      assigned_employee_id: '30000000-0000-4000-8000-000000000001', assigned_employee_name: 'Alijah Collins',
      employee_code: 'EMP001', role: 'employee', employee_active: true,
    }];
  }
  if (/msg_get_user_by_device\('KIOSK_02'\)/i.test(query)) {
    return [{ msg_user_id: USER_ID, display_name: 'Alijah Collins', role: 'employee' }];
  }
  if (/select\s+t\.id,\s*t\.thread_type/i.test(query)) {
    return [{ id: THREAD_ID, thread_type: 'bot', title: 'Memphis', is_active: true, has_memphis_bot: true }];
  }
  if (/from public\.msg_thread_participants/i.test(query) && /select 1/i.test(query)) return [{ one: 1 }];
  if (/msg_get_memphis_user_id/i.test(query)) return [{ memphis_user_id: BOT_ID }];
  if (/from public\.msg_messages m/i.test(query) && /where m\.id/i.test(query)) {
    return [{
      id: '30000000-0000-4000-8000-000000000001',
      thread_id: THREAD_ID,
      sender_user_id: USER_ID,
      body: 'help',
      metadata_json: { channel: 'memphis', device_id: 'KIOSK_02', client_message_id: 'client-message-001' },
      device_id: 'KIOSK_02',
    }];
  }
  if (/from public\.msg_threads t/i.test(query)) {
    return [{
      thread_id: THREAD_ID, updated_at: '2026-07-15T00:00:00Z', thread_type: 'bot', thread_title: 'Memphis',
      unread_count: 0, last_message_at: null, last_message_id: null, last_sender_name: null,
      last_message_body: null, last_message_type: null, participant_names: 'Alijah Collins, Memphis', viewer_can_send: true,
    }];
  }
  if (/sch_service_date/i.test(query)) return [{ service_date: '2026-07-15' }];
  return [];
};

const runRpc = async (name, params = {}) => {
  rpcCalls.push({ name, params });
  if (name === 'msg_get_or_create_memphis_thread') return { id: THREAD_ID, thread_type: 'bot', title: 'Memphis', is_active: true };
  if (name === 'msg_send_message') {
    messageCounter += 1;
    return {
      id: messageCounter === 1 ? '30000000-0000-4000-8000-000000000001' : '30000000-0000-4000-8000-000000000002',
      ...params,
    };
  }
  if (name === 'claim_operational_notification_job_by_key') {
    return {
      job_id: '40000000-0000-4000-8000-000000000001',
      source_id: '30000000-0000-4000-8000-000000000001',
      lease_token: '40000000-0000-4000-8000-000000000002',
      payload_json: { message_id: '30000000-0000-4000-8000-000000000001' },
    };
  }
  if (name === 'finish_operational_notification_job') return { status: 'completed' };
  return null;
};

const app = express();
app.use(express.json());
app.use('/messaging-api', createMessagingRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload: (area, extra = {}) => ({ ok: true, area, ...extra }),
  appVersion: 'test',
  releaseId: 'test',
  contractVersion: 'messaging.v2',
}));

const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const threads = await fetch(`${base}/messaging-api/threads?user_id=${USER_ID}&device_id=KIOSK_02`).then((response) => response.json());
  assert.equal(threads.ok, true);
  assert.equal(rpcCalls.some((call) => call.name === 'msg_get_or_create_memphis_thread'), false, 'Thread listing must not recreate a conversation the user deleted');

  rpcCalls.length = 0;
  messageCounter = 0;
  const response = await fetch(`${base}/messaging-api/thread/${THREAD_ID}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender_user_id: USER_ID,
      device_id: 'KIOSK_02',
      body: 'help',
      client_message_id: 'client-message-001',
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.meta.responder, 'memphis');
  assert.equal(payload.data.thread.id, THREAD_ID);
  assert.match(payload.data.bot_message.p_body, /I am Memphis/);
  const sendCalls = rpcCalls.filter((call) => call.name === 'msg_send_message');
  assert.equal(sendCalls.length, 2, 'Generic sends inside a Memphis thread must create the user message and one bot response');
  assert.equal(sendCalls[0].params.p_metadata_json.client_message_id, 'client-message-001');
  assert.equal(sendCalls[1].params.p_metadata_json.client_message_id, 'memphis-reply:30000000-0000-4000-8000-000000000001');
  assert.equal(sendCalls[1].params.p_metadata_json.reply_to_message_id, '30000000-0000-4000-8000-000000000001');
  assert.ok(rpcCalls.some((call) => call.name === 'claim_operational_notification_job_by_key'), 'The request path must lease the durable bot job rather than starting untracked work');
  assert.ok(rpcCalls.some((call) => call.name === 'finish_operational_notification_job' && call.params.p_succeeded === true), 'The durable bot job must be finalized with its authoritative lease');

  console.log('MEMPHIS_MESSAGING_ROUTE_RECOVERY_TESTS_PASS');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
