import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createMessagingRouter } from '../src/messaging-api.js';
import { MEMPHIS_READ_ONLY_TOOL_NAMES, assertMemphisReadOnlyOperationalTool } from '../src/memphis-ai.js';

let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const source = readFileSync(new URL('../src/memphis-ai.js', import.meta.url), 'utf8');
const toolBody = source.slice(source.indexOf('async function executeTool('), source.indexOf('async function generateSystemReply('));
check(toolBody.includes('assertMemphisReadOnlyOperationalTool(name);'), true, 'real executor enforces the allowlist before any branch');
const branches = [...toolBody.matchAll(/if \(name === "([a-z_]+)"\)/g)].map((match) => match[1]);
check([...branches].sort(), [...MEMPHIS_READ_ONLY_TOOL_NAMES].sort(), 'every operational branch is enumerated exactly once');
for (const name of MEMPHIS_READ_ONLY_TOOL_NAMES) check(assertMemphisReadOnlyOperationalTool(name), name, `read-only ${name} admitted`);
for (const name of ['create_event', 'update_schedule', 'close_ticket', 'send_message', 'generic_sql', '', null, '__proto__']) {
  assert.throws(() => assertMemphisReadOnlyOperationalTool(name), /not permitted/, `${name} must not reach SQL/RPC`);
  checks += 1;
}

const viewer = '22222222-2222-4222-8222-222222222222';
const foreign = '33333333-3333-4333-8333-333333333333';
const thread = '44444444-4444-4444-8444-444444444444';
const message = '55555555-5555-4555-8555-555555555555';
const observed = [];
const row = { id: message, thread_id: thread, sender_user_id: foreign, sender_display_name: 'Memphis',
  message_type: 'bot_response', body: 'Published schedule answer',
  metadata_json: { channel: 'memphis', ai: true, sources: ['custodial_memphis_schedule_day'] },
  sent_at: '2026-10-03T12:00:00Z', created_at: '2026-10-03T12:00:00Z', updated_at: '2026-10-03T12:00:00Z' };
const runReadOnlySql = async (sql) => {
  observed.push(sql);
  if (sql.includes('public.msg_get_user_by_device')) return [{ msg_user_id: viewer, role: 'employee', display_name: 'Employee' }];
  if (sql.includes('from public.msg_messages m')) {
    return [{ ...row, sender_role: sql.includes('sender.role as sender_role') ? 'bot' : undefined }];
  }
  return [];
};
const app = express();
app.use('/messaging-api', createMessagingRouter({ runReadOnlySql, runRpc: async () => { throw new Error('unexpected write'); },
  requireDeviceAccess: (_req, _res, next) => next(), appVersion: 'test', releaseId: 'test', contractVersion: 'test' }));
const server = await new Promise((resolve) => { const listener = app.listen(0, () => resolve(listener)); });
try {
  const base = `http://127.0.0.1:${server.address().port}/messaging-api/thread/${thread}`;
  const full = await fetch(`${base}/messages?user_id=${viewer}&device_id=KIOSK_02`).then((response) => response.json());
  check(full.ok, true, 'authenticated full read works');
  check(full.data[0].sender_role, 'bot', 'full read projects catalog role, not metadata/display-name inference');
  const updates = await fetch(`${base}/updates?user_id=${viewer}&device_id=KIOSK_02&after=1970-01-01T00%3A00%3A00Z&after_id=00000000-0000-0000-0000-000000000000&wait_ms=1`).then((response) => response.json());
  check(updates.ok, true, 'authenticated incremental read works');
  check(updates.data[0].sender_role, 'bot', 'incremental read projects identical catalog role');
  check(observed.filter((sql) => sql.includes('from public.msg_messages m')).every((sql) => sql.includes('sender.role as sender_role')), true,
    'both actual SQL routes select the role');
  const spoof = await fetch(`${base}/messages?user_id=${foreign}&device_id=KIOSK_02`).then((response) => response.json());
  check(spoof.ok, false, 'employee device cannot impersonate a foreign viewer');
  const missingDevice = await fetch(`${base}/messages?user_id=${viewer}`).then((response) => response.json());
  check(missingDevice.ok, false, 'device boundary is preserved');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log(`memphis-provenance-boundary: ${checks} checks PASS`);
