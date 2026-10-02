import assert from 'node:assert/strict';
import express from 'express';
import { createOpsManagerSession, makeOpsAccessMiddleware } from '../src/auth/shared-access-auth.js';
import { makeManagerNotificationHistoryHandler } from '../src/manager-notification-history.js';

const managerId = '91000000-0000-4000-8000-000000000021';
const credentialId = '91000000-0000-4000-8000-000000000022';
const foreignManagerId = '91000000-0000-4000-8000-000000000023';
const env = { NODE_ENV: 'production', OPS_MANAGER_AUTH_REQUIRED: 'true',
  OPS_MANAGER_SESSION_SECRET: 'synthetic-manager-notification-history-only-secret' };
const manager = { manager_id: managerId, display_name: 'Synthetic manager', roles: ['CUSTODIAL_MANAGER'], active: true, revoked_at: null };
const trusted = { credential_id: credentialId, device_id: 'OPS_HISTORY_FIXTURE', manager_id: managerId, manager,
  token_hash: 'synthetic-test-only-hash', created_at: new Date().toISOString(),
  max_access_level: 'full_access', revoked_at: null, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
const token = createOpsManagerSession({ credentialId, deviceId: trusted.device_id, manager,
  authMode: 'trusted_device', accessLevel: 'full_access', maximumAccessLevel: 'full_access', env }).token;
const at = '2026-10-03T17:00:00.123456+00:00';
const queueId = (n) => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, type = 'message', status = 'sent') => ({
  queue_id: queueId(n), manager_id: managerId, notification_type: type, status,
  created_at: at, updated_at: at, available_at: at, sent_at: status === 'sent' ? at : null,
  title: 'PRIVATE TITLE', body: 'PRIVATE MESSAGE BODY', data_json: { token: 'SECRET' },
  last_error: 'PRIVATE PROVIDER ERROR', provider_message_id: 'SECRET',
});
let fixtureRows = [row(1)];
let fixtureError = null;
let queryCount = 0;
const calls = [];
const db = { from(table) {
  queryCount += 1;
  calls.push(['from', table]);
  return {
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    async limit(count) { calls.push(['limit', count]); return { data: fixtureRows.slice(0, count), error: fixtureError }; },
  };
} };
const app = express();
app.use(express.json());
app.get('/manager-notifications-api/history',
  makeOpsAccessMiddleware({ env, trustedDeviceStore: { find: async id => id === credentialId ? trusted : null } }),
  makeManagerNotificationHistoryHandler({ db }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/manager-notifications-api/history`;
const headers = { authorization: `Bearer ${token}`, 'X-Device-Id': trusted.device_id };
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1; };
try {
  let response = await fetch(url);
  eq(response.status, 401); eq(queryCount, 0);
  response = await fetch(`${url}?manager_id=${foreignManagerId}`, { headers });
  eq(response.status, 422); eq(queryCount, 0);
  response = await fetch(url, { headers });
  eq(response.status, 200);
  eq(response.headers.get('cache-control'), 'private, no-store');
  let payload = await response.json();
  eq(payload.data.manager_id, managerId); eq(payload.data.credential_id, credentialId);
  eq(payload.data.notifications.length, 1); eq(payload.data.truncated, false);
  eq(payload.data.notifications[0].label, 'Messenger activity');
  eq(payload.data.notifications[0].href, './messages.html?hub=manager');
  eq(payload.data.notifications[0].status_label, 'Provider accepted; phone display and reading not verified');
  for (const privateValue of ['PRIVATE TITLE', 'PRIVATE MESSAGE BODY', 'SECRET', 'PRIVATE PROVIDER ERROR']) {
    assert.ok(!JSON.stringify(payload).includes(privateValue)); checks += 1;
  }
  eq(calls, [
    ['from', 'ops_manager_notification_queue'],
    ['select', 'queue_id,manager_id,notification_type,status,created_at,updated_at,available_at,sent_at'],
    ['eq', 'manager_id', managerId],
    ['order', 'created_at', { ascending: false }],
    ['order', 'queue_id', { ascending: false }],
    ['limit', 101],
  ]);
  fixtureRows = Array.from({ length: 101 }, (_, index) => row(index + 1, 'event_digest', 'pending'));
  response = await fetch(url, { headers }); payload = await response.json();
  eq(response.status, 200); eq(payload.data.notifications.length, 100); eq(payload.data.truncated, true);
  eq(payload.data.notifications[0].status_label, 'Queued; no delivery confirmed');
  eq(payload.data.notifications[0].href, './events.html');
  fixtureRows = [row(1, 'location_digest', 'leased'), row(2, 'lunch_delivery_failure', 'failed'),
    row(3, 'test', 'cancelled'), row(4, 'future_type', 'future_status')];
  response = await fetch(url, { headers }); payload = await response.json();
  eq(payload.data.notifications.map(item => item.href), ['./dashboard.html', null, null, null]);
  eq(payload.data.notifications.map(item => item.status), ['leased', 'failed', 'cancelled', 'unknown']);
  assert.match(JSON.stringify(payload), /delivery outcome unknown/); checks += 1;
  assert.match(JSON.stringify(payload), /delivery state unavailable/i); checks += 1;
  fixtureRows = [{ ...row(1), manager_id: foreignManagerId }];
  response = await fetch(url, { headers }); eq(response.status, 503);
  eq((await response.json()).data, undefined);
  fixtureRows = [row(1)]; fixtureError = new Error('PRIVATE DATABASE ERROR');
  response = await fetch(url, { headers }); eq(response.status, 503);
  assert.ok(!(await response.text()).includes('PRIVATE DATABASE ERROR')); checks += 1;
  fixtureError = null;
  trusted.revoked_at = new Date().toISOString();
  const before = queryCount;
  response = await fetch(url, { headers }); eq(response.status, 401); eq(queryCount, before);
  console.log(JSON.stringify({ status: 'MANAGER_NOTIFICATION_HISTORY_ROUTE_PASS', checks,
    actualAuth: true, readOnly: true, queryLimit: 101, source: 'synthetic private queue fixture', externalRequests: false }));
} finally {
  await new Promise(resolve => server.close(resolve));
}
