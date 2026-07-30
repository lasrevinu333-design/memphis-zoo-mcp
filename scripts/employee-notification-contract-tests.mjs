import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { installEmployeeNotificationRoutes } from '../src/employee-notifications.js';

const root = new URL('../', import.meta.url);
const [source, manager, indexSource, migration] = await Promise.all([
  readFile(new URL('src/employee-notifications.js', root), 'utf8'),
  readFile(new URL('src/manager-notifications.js', root), 'utf8'),
  readFile(new URL('src/index.js', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8'),
]);

assert.match(source, /const API_PREFIX = ['"]\/employee-notifications-api['"]/);
for (const route of ['register', 'events', 'opened']) {
  assert.ok(source.includes(`\${API_PREFIX}/${route}`), `missing ${route} route registration`);
}

assert.match(source, /messenger_fallback: false/);
assert.match(source, /makeDeviceCredentialMiddleware\(\{ supabase: db, runReadOnlySql \}\)/);
assert.match(source, /device_auth_resolver_configured: authReadConfigured/);
assert.match(source, /employee_notification_auth_ready/);
assert.match(source, /claim_operational_notification_job_by_key/);
assert.doesNotMatch(source, /claim_operational_notification_jobs/);
assert.match(source, /channelId: 'employee-events'/);
assert.match(source, /notification_key/);
assert.match(manager, /export function createPushRuntime/);
assert.match(manager, /channel_id: channelId/);
assert.match(manager, /getClientConfig, send, sweep/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*runReadOnlySql:[\s\S]*runSupabaseReadOnlySql/);

for (const contract of [
  'employee_push_registrations',
  'event_push_instances',
  'assignment_epoch',
  'day_before',
  'shift_plus_15',
  'employee_event_push',
  'mz_enqueue_employee_event_pushes',
  'mz_register_employee_push',
  'mz_mark_employee_event_opened',
]) assert.ok(migration.includes(contract), `missing migration contract ${contract}`);

assert.match(migration, /08:00:00 America\/Chicago/);
assert.match(migration, /shift_start::text\|\|' America\/Chicago'\)::timestamptz \+ interval '15 minutes'/);
assert.match(migration, /status='dead'/);
assert.doesNotMatch(migration, /operational_notification_jobs[\s\S]{0,240}status='cancelled'/);

async function checkHealth(options) {
  const app = express();
  installEmployeeNotificationRoutes(app, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/employee-notifications-api/health`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const healthy = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
  runReadOnlySql: async () => [{ employee_notification_auth_ready: true }],
});
assert.equal(healthy.status, 200);
assert.equal(healthy.body.ok, true);
assert.deepEqual(healthy.body.dependencies, {
  database_reachable: true,
  device_auth_resolver_configured: true,
  push_provider_configured: true,
});

const missingAuthResolver = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
});
assert.equal(missingAuthResolver.status, 503);
assert.equal(missingAuthResolver.body.ok, false);
assert.equal(missingAuthResolver.body.dependencies.device_auth_resolver_configured, false);

console.log('EMPLOYEE_EVENT_NOTIFICATION_CONTRACT_PASS');
