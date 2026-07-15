import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260715114500_messenger_runtime_membership_thread_delete.sql"),
  "utf8",
);
const messagingApi = readFileSync(resolve(root, "src/messaging-api.js"), "utf8");

assert.match(migration, /create or replace function public\.msg_is_runtime_user/i);
assert.match(migration, /mu\.role = 'employee'[\s\S]*e\.active = true[\s\S]*employee_code[\s\S]*\^EMP/i);
assert.match(migration, /mu\.role in \('manager','ops','ops_manager','operations_manager'\)/i);
assert.match(migration, /mu\.role = 'bot'[\s\S]*memphis/i);
assert.match(migration, /public\.msg_is_runtime_user\(mu\.id\)/i);
assert.match(migration, /User is not an active custodial Messenger identity/i);
assert.match(migration, /device_aliases[\s\S]*canonical_device_id/i);
assert.match(migration, /update public\.msg_thread_participants[\s\S]*set left_at = v_hidden_before/i);
assert.match(migration, /participant_left'[\s\S]*true/i);
assert.match(migration, /grant execute on function public\.msg_mark_thread_deleted/i);

assert.match(messagingApi, /router\.delete\("\/thread\/:threadId\/delete"/);
assert.match(messagingApi, /msg_mark_thread_deleted/);
assert.match(messagingApi, /p_device_identifier/);
assert.match(messagingApi, /msg_get_or_create_memphis_thread/);

console.log("MESSENGER_RUNTIME_MEMBERSHIP_THREAD_DELETE_PASS");
