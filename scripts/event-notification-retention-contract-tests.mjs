import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const eventsApi = read('src/events-api.js');
const migration = read('supabase/migrations/20260722224000_event_notification_retention_integrity.sql');
const cutover = read('supabase/migrations/20260724020000_event_messenger_cutover_deletion_semantics.sql');

assert.match(eventsApi, /mz_enqueue_employee_event_pushes/,
  'the events worker must enqueue the native employee notification ledger');
assert.match(eventsApi, /native_employee_push_only/,
  'event maintenance must advertise native-only delivery');
assert.doesNotMatch(eventsApi, /msg_get_or_create_memphis_thread|msg_send_message|msg_unhide_thread_for_device/,
  'the event worker must have zero Messenger RPC coupling');
assert.match(cutover, /trg_mz_reject_event_messenger_message/,
  'the database must reject new events_app Messenger rows');
assert.match(cutover, /legacy_event_chat_tombstone/,
  'legacy event-generated chat content must enter the 14-day tombstone flow');

assert.match(migration, /events_app_notification_log_kind_check/,
  'the schema migration must own the notification-kind domain');
assert.match(migration, /'event_reminder'::text/,
  'the database constraint must accept the worker canonical value');
assert.match(migration, /create or replace function public\.mz_apply_free_tier_retention/i,
  'the migration must replace the incompatible legacy retention entry point');
assert.match(migration, /'disabled',\s*true/i,
  'the legacy retention entry point must report that it is disabled');
assert.match(migration, /'deleted_events',\s*0/i,
  'the compatibility retention call must not delete historical events');
assert.doesNotMatch(migration, /delete\s+from\s+public\.events_app_events/i,
  'the repair migration must not introduce event deletion');
assert.doesNotMatch(migration, /delete\s+from\s+public\.events_app_event_history/i,
  'event audit history must remain immutable');

console.log(JSON.stringify({
  ok: true,
  checked: [
    'native_employee_push_cutover',
    'zero_messenger_coupling',
    'database_event_chat_guard',
    'legacy_event_chat_tombstone',
    'legacy_retention_noop',
    'event_history_preservation',
  ],
}, null, 2));
