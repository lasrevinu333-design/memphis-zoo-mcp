import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [source, manager, bootstrap, migration, lifecycleMigration, envSource, indexSource] = await Promise.all([
  readFile(new URL('src/employee-notifications.js', root), 'utf8'),
  readFile(new URL('src/manager-notifications.js', root), 'utf8'),
  readFile(new URL('src/mcp-schema-bootstrap.js', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724145808_lifecycle_integrity_repairs.sql', root), 'utf8'),
  readFile(new URL('src/config/env.js', root), 'utf8'),
  readFile(new URL('src/index.js', root), 'utf8'),
]);

assert.equal(/const API_PREFIX = ['"]\/employee-notifications-api['"]/.test(source), true);
for (const route of ['/register', '/events', '/opened']) {
  assert.ok(source.includes(`\${API_PREFIX}${route}`), `missing ${route}`);
}

assert.match(source, /messenger_fallback: false/);
assert.match(source, /claim_operational_notification_job_by_key/);
assert.doesNotMatch(source, /claim_operational_notification_jobs/);
assert.match(source, /channelId: 'employee-events'/);
assert.match(source, /ttlSeconds:/);
assert.match(source, /collapseKey: instance\.notification_key/);
assert.match(source, /invalid_fcm_token/);
assert.match(source, /finish_operational_notification_job_v2/);
assert.match(source, /assertDb/);
assert.match(source, /notification_key/);
assert.match(manager, /export function createPushRuntime/);
assert.match(manager, /channel_id: channelId/);
assert.match(manager, /collapse_key: normalizedCollapseKey/);
assert.match(manager, /apns-expiration/);
assert.match(manager, /apns-collapse-id/);
assert.match(manager, /getClientConfig, send, sweep/);
assert.match(bootstrap, /installEmployeeNotificationRoutes/);

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
assert.match(lifecycleMigration, /finish_operational_notification_job_v2/);
assert.match(lifecycleMigration, /p_terminal boolean/);
assert.match(envSource, /firebaseServiceAccountConfigured/);
assert.match(envSource, /EMPLOYEE_NOTIFICATION_SWEEP_MS/);
assert.match(indexSource, /active_employee_push_registrations/);
assert.match(indexSource, /employee_push_failures/);
assert.match(indexSource, /notificationQueuesHealthy/);

console.log('EMPLOYEE_EVENT_NOTIFICATION_CONTRACT_PASS');
