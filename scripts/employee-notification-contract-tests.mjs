import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [source, manager, bootstrap, migration] = await Promise.all([
  readFile(new URL('src/employee-notifications.js', root), 'utf8'),
  readFile(new URL('src/manager-notifications.js', root), 'utf8'),
  readFile(new URL('src/mcp-schema-bootstrap.js', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8'),
]);

for (const route of [
  '/employee-notifications-api/register',
  '/employee-notifications-api/events',
  '/employee-notifications-api/opened',
]) assert.ok(source.includes(route), `missing ${route}`);

assert.match(source, /messenger_fallback: false/);
assert.match(source, /claim_operational_notification_job_by_key/);
assert.doesNotMatch(source, /claim_operational_notification_jobs/);
assert.match(source, /channelId: 'employee-events'/);
assert.match(source, /notification_key/);
assert.match(manager, /export function createPushRuntime/);
assert.match(manager, /channel_id: channelId/);
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

console.log('EMPLOYEE_EVENT_NOTIFICATION_CONTRACT_PASS');
