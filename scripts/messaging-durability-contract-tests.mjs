import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260914051527_messaging_read_horizon_and_send_idempotency.sql", import.meta.url),
  "utf8",
);

assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
assert.equal((migration.match(/^commit;$/gim) || []).length, 1);

const readStart = migration.indexOf("create or replace function public.msg_mark_thread_read_through(");
const metadataStart = migration.indexOf("create or replace function public.msg_effective_message_metadata(", readStart);
const fiveArgStart = migration.indexOf("create or replace function public.msg_send_message(", readStart);
const sixArgStart = migration.indexOf("create or replace function public.msg_send_message(", fiveArgStart + 1);
assert.ok(readStart >= 0 && metadataStart > readStart && fiveArgStart > metadataStart && sixArgStart > fiveArgStart);

const readFunction = migration.slice(readStart, metadataStart);
const metadataFunction = migration.slice(metadataStart, fiveArgStart);
const fiveArgFunction = migration.slice(fiveArgStart, sixArgStart);
const sixArgFunction = migration.slice(sixArgStart);

assert.match(readFunction, /msg_assert_active_mutable_thread\(p_thread_id\)/i);
assert.match(readFunction, /msg_thread_participants[\s\S]*tp\.user_id=p_user_id[\s\S]*tp\.left_at is null/i,
  "read acknowledgements require active thread participation");
assert.match(readFunction, /m\.id=p_through_message_id[\s\S]*m\.thread_id=p_thread_id[\s\S]*m\.is_deleted is false/i,
  "the horizon must be a visible message in the requested thread");
assert.match(readFunction, /r\.read_at is null[\s\S]*\(coalesce\(m\.sent_at,m\.created_at\),m\.id\) <= \(v_through_at,p_through_message_id\)/i,
  "only previously unread receipts at or before the visible horizon may change");
assert.match(readFunction, /get diagnostics v_count=row_count/i);
assert.match(readFunction, /revoke all on function public\.msg_mark_thread_read_through\(uuid,uuid,uuid\) from public,anon,authenticated/i);
assert.match(readFunction, /grant execute on function public\.msg_mark_thread_read_through\(uuid,uuid,uuid\) to service_role,postgres/i);

assert.match(metadataFunction, /client_message_id must match metadata_json\.client_message_id/i,
  "the duplicate client-id representation must be canonicalized");
assert.match(metadataFunction, /v_metadata := v_metadata - 'client_message_id'/i);
assert.match(metadataFunction, /notification_instance_key/i, "notification aliases must persist as the canonical key");
assert.match(metadataFunction, /- 'instance_key'[\s\S]*- 'notification_key'[\s\S]*- 'alert_key'[\s\S]*- 'reminder_key'/i,
  "all notification-key aliases must be removed before persisting the canonical key");
assert.match(metadataFunction, /v_dedupe_key is null and v_source='events_app'/i,
  "event-derived notification keys must be canonicalized too");
assert.match(metadataFunction, /revoke all on function public\.msg_effective_message_metadata\(jsonb,text\) from public,anon,authenticated,service_role/i);

for (const [label, source] of [["five-argument", fiveArgFunction], ["six-argument", sixArgFunction]]) {
  assert.match(source, /length\(v_body\)>2000[\s\S]*Message body cannot exceed 2000 characters/i,
    `${label} sends must share the 2000-character ceiling`);
  assert.doesNotMatch(source, /4000/, `${label} sends must not retain a divergent 4000-character ceiling`);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\('msg-client-message:'\|\|v_client_message_id,0\)\)/i,
    `${label} sends must serialize the globally unique client message id`);
  assert.match(source, /where m\.client_message_id=v_client_message_id[\s\S]*v_message\.thread_id<>p_thread_id[\s\S]*v_message\.sender_user_id<>p_sender_user_id[\s\S]*v_message\.body<>v_body[\s\S]*v_message\.message_type<>v_message_type/i,
    `${label} retries must reject a client id bound to a different visible payload`);
  assert.equal(
    (source.match(/msg_effective_message_metadata\(v_message\.metadata_json,v_message\.client_message_id\) is distinct from v_metadata/gi) || []).length,
    label === "five-argument" ? 4 : 2,
    `${label} replay and uniqueness-race paths must compare exact effective metadata`,
  );
  assert.match(source, /exception when unique_violation[\s\S]*where m\.client_message_id=v_client_message_id/i,
    `${label} sends must reconcile a database uniqueness race`);
}

assert.match(fiveArgFunction, /message-notification:/i,
  "the legacy notification-instance dedupe contract must be preserved");
assert.match(fiveArgFunction, /v_source='events_app'[\s\S]*v_event_id/i,
  "event notification dedupe must remain available");
assert.ok(
  fiveArgFunction.indexOf("v_metadata := public.msg_effective_message_metadata")
    < fiveArgFunction.indexOf("where m.client_message_id=v_client_message_id"),
  "a client-id replay must use canonical metadata before lookup",
);
assert.ok(
  fiveArgFunction.indexOf("where m.client_message_id=v_client_message_id")
    < fiveArgFunction.indexOf("message-notification:"),
  "client-id conflict validation must precede notification-key early success",
);
assert.equal((fiveArgFunction.match(/notification instance key belongs to a different message payload/gi) || []).length, 2,
  "notification-key normal and uniqueness-race paths must reject changed payloads");
assert.match(fiveArgFunction, /v_client_message_id is not null and v_message\.client_message_id is distinct from v_client_message_id/i,
  "a new or mismatched client id cannot be accepted through notification dedupe");
assert.match(sixArgFunction, /revoke all on function public\.msg_send_message\(uuid,uuid,text,text,jsonb,text\) from public,anon,authenticated/i);
assert.match(sixArgFunction, /grant execute on function public\.msg_send_message\(uuid,uuid,text,text,jsonb,text\) to service_role,postgres/i);

console.log("MESSAGING_DURABILITY_CONTRACT_TESTS_PASS");
