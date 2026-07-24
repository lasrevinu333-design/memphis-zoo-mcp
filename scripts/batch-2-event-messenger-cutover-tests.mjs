import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const eventsApi = read('src/events-api.js');
const messagingApi = read('src/messaging-api.js');
const migration = read('supabase/migrations/20260724015534_event_messenger_cutover_deletion_semantics.sql');
const advisorIndex = read('supabase/migrations/20260724020041_msg_thread_deletion_operations_user_index.sql');
const messageDeletionRepair = read('supabase/migrations/20260724223021_restore_authorized_message_deletion.sql');

assert.match(eventsApi, /mz_enqueue_employee_event_pushes/);
assert.match(eventsApi, /native_employee_push_only/);
assert.match(eventsApi, /messenger_coupling:\s*false/);
assert.doesNotMatch(eventsApi, /msg_get_or_create_memphis_thread/);
assert.doesNotMatch(eventsApi, /msg_send_message/);
assert.doesNotMatch(eventsApi, /msg_unhide_thread_for_device/);
assert.doesNotMatch(eventsApi, /source:\s*["']events_app["']/);

assert.match(messagingApi, /router\.get\("\/device-event-reminders"[\s\S]*data:\s*\[\]/);
assert.match(messagingApi, /delivery:\s*"native_employee_push_only"/);
assert.doesNotMatch(
  messagingApi.match(/router\.get\("\/device-event-reminders"[\s\S]*?router\.get\("\/device-location-status-reminders"/)?.[0] || '',
  /from public\.msg_messages/
);
assert.match(messagingApi, /router\.post\("\/thread\/:threadId\/message\/:messageId\/delete"/);
assert.match(messagingApi, /msg_delete_message/);
assert.match(messagingApi, /retention_hours:\s*336/);
assert.match(messagingApi, /deletion:\s*"current_user_only"/);
assert.match(messagingApi, /router\.post\("\/thread\/:threadId\/admin-tombstone"/);
assert.match(messagingApi, /msg_admin_tombstone_thread/);
assert.match(messagingApi, /msg_thread_visibility/);
assert.match(messagingApi, /hidden_before/);
assert.match(messagingApi, /old_history_restores:\s*false/);
assert.match(messagingApi, /deletion:\s*"all_participants"/);
assert.doesNotMatch(messagingApi, /msg_restore_thread_visibility/);

assert.match(migration, /create table if not exists public\.msg_thread_deletion_operations/);
assert.match(migration, /alter table public\.msg_thread_deletion_operations force row level security/);
assert.match(migration, /deletion_scope in \('user','global'\)/);
assert.match(migration, /operation_id=p_operation_id/);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_operation_id::text,0\)\)/);
assert.match(migration, /Deletion operation id was already used for another target/);
assert.match(migration, /device_identifier is null/);
assert.match(migration, /memphis_generation_ended/);
assert.match(migration, /create or replace function public\.msg_admin_tombstone_thread/);
assert.match(migration, /v_request_role<>'admin'/);
assert.match(migration, /Individual-message deletion is retired/);
assert.match(messageDeletionRepair, /create or replace function public\.msg_delete_message/);
assert.match(messageDeletionRepair, /v_message\.sender_user_id<>p_request_user_id/);
assert.match(messageDeletionRepair, /v_request_role<>'manager'/);
assert.match(messageDeletionRepair, /purge_after=v_now\+interval '336 hours'/);
assert.match(messageDeletionRepair, /revoke all on function public\.msg_delete_message\(uuid,uuid\) from public,anon,authenticated/);
assert.match(messageDeletionRepair, /grant execute on function public\.msg_delete_message\(uuid,uuid\) to service_role,postgres/);
assert.match(migration, /create trigger trg_mz_reject_event_messenger_message/);
assert.match(migration, /Event notifications are native-only and cannot create Messenger messages/);
assert.match(migration, /legacy_event_chat_tombstone/);
assert.match(migration, /purge_after=coalesce\(purge_after,coalesce\(deleted_at,now\(\)\)\+interval '14 days'\)/);
assert.doesNotMatch(migration, /grant execute on function public\.msg_delete_thread\(uuid,uuid,uuid\) to (?:anon|authenticated|public)/);
assert.match(advisorIndex, /idx_msg_thread_deletion_operations_user/);
assert.match(advisorIndex, /msg_thread_deletion_operations\(user_id,deleted_at desc\)/);

console.log('BATCH_2_EVENT_MESSENGER_CUTOVER_CONTRACTS_PASS');
