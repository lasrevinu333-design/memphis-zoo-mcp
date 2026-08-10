#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.NAMED_MANAGER_RETIREMENT_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.NAMED_MANAGER_RETIREMENT_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

const migration = readFileSync(
  new URL("../supabase/migrations/20260810140000_finalize_named_manager_messenger_retirement_integrity.sql", import.meta.url),
  "utf8",
);

const USER_A = "00000000-0000-4000-8000-00000000e111";
const USER_B = "00000000-0000-4000-8000-00000000e112";
const ADMIN_USER = "00000000-0000-4000-8000-00000000e113";
const NONPARTICIPANT_USER = "00000000-0000-4000-8000-00000000e118";
const INACTIVE_THREAD = "00000000-0000-4000-8000-00000000e110";
const INACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e114";
const ACTIVE_THREAD = "00000000-0000-4000-8000-00000000e120";
const ACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e121";
const TOMBSTONED_THREAD = "00000000-0000-4000-8000-00000000e119";
const TOMBSTONED_MESSAGE = "00000000-0000-4000-8000-00000000e11a";
const DEVICE_ID = "NMMS-RETIREMENT-DEVICE";
const ARCHIVE_MESSAGE = "00000000-0000-4000-8000-00000000e130";
const ARCHIVE_AUDIT = "00000000-0000-4000-8000-00000000e131";

async function sql(statement) {
  const { stdout, stderr } = await execFileAsync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(stderr.trim(), "");
  return stdout.trim().split("\n").at(-1);
}

function psqlResult(statement) {
  return spawnSync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function expectRejected(statement, expected) {
  const result = psqlResult(statement);
  assert.notEqual(result.status, 0, `expected rejection, received: ${result.stdout}`);
  assert.match(`${result.stderr}\n${result.stdout}`, expected);
}

function applyFinalCorrection() {
  const result = execFileSync("docker", [
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "supabase_admin", "-d", database,
  ], { input: migration, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.match(result, /COMMIT/);
}

async function concurrentSql(statement, count = 10) {
  const calls = await Promise.all(Array.from({ length: count }, () => execFileAsync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 4 * 1024 * 1024 })));
  return calls.map(({ stdout, stderr }) => {
    assert.equal(stderr.trim(), "");
    return stdout.trim().split("\n").at(-1);
  });
}

function archiveInventory() {
  return sql(`
    select jsonb_build_object(
      'thread',(select to_jsonb(t) from public.msg_threads t where t.system_key='ops_manager_shared_chat_v1'),
      'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.msg_messages m join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.audit_id),'[]'::jsonb) from public.msg_message_audit a join public.msg_threads t on t.id=a.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.msg_receipts r join public.msg_messages m on m.id=r.message_id join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1')
    )::text;
  `).then(JSON.parse);
}

await sql(`
  insert into public.msg_users(id,display_name,role,is_active)
  values
    ('${USER_A}'::uuid,'Retirement Fixture Sender','manager',true),
    ('${USER_B}'::uuid,'Retirement Fixture Recipient','manager',true),
    ('${ADMIN_USER}'::uuid,'Retirement Fixture Admin','admin',true),
    ('${NONPARTICIPANT_USER}'::uuid,'Retirement Fixture Nonparticipant','manager',true)
  on conflict (id) do update set is_active=true;
  insert into public.devices(id,device_id,device_name,active)
  values ('00000000-0000-4000-8000-00000000e115'::uuid,'${DEVICE_ID}','Named manager retirement disposable device',true)
  on conflict (device_id) do update set active=true;
`);

// Seed pre-existing archive evidence only as the owner with the exact archive
//guards disabled. The final correction must replay byte-for-byte afterward.
await sql(`
  alter table public.msg_messages disable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;
  alter table public.msg_messages disable trigger trg_msg_message_immutable_audit;
  alter table public.msg_message_audit disable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;
  alter table public.msg_receipts disable trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation;
  alter table public.msg_message_deletions disable trigger trg_msg_reject_retired_ops_manager_shared_message_delete;
  insert into public.msg_messages(id,thread_id,sender_user_id,message_type,body,metadata_json,sent_at,created_at)
  select '${ARCHIVE_MESSAGE}'::uuid,t.id,p.user_id,'text','retired deletion-evidence fixture','{}'::jsonb,
         timestamptz '2026-08-01T00:00:00Z',timestamptz '2026-08-01T00:00:00Z'
  from public.msg_threads t join lateral (
    select p.user_id from public.msg_thread_participants p where p.thread_id=t.id order by p.id limit 1
  ) p on true
  where t.system_key='ops_manager_shared_chat_v1'
  on conflict (id) do nothing;
  insert into public.msg_message_audit(audit_id,message_id,thread_id,sender_user_id,message_type,sender_display_name,sender_role,created_at)
  select '${ARCHIVE_AUDIT}'::uuid,m.id,m.thread_id,m.sender_user_id,m.message_type,u.display_name,u.role,m.created_at
  from public.msg_messages m join public.msg_users u on u.id=m.sender_user_id
  where m.id='${ARCHIVE_MESSAGE}'::uuid on conflict (message_id) do nothing;
  insert into public.msg_receipts(message_id,user_id,queued_at)
  select m.id,p.user_id,timestamptz '2026-08-01T00:01:00Z'
  from public.msg_messages m join lateral (
    select p.user_id from public.msg_thread_participants p where p.thread_id=m.thread_id and p.user_id<>m.sender_user_id order by p.id limit 1
  ) p on true
  where m.id='${ARCHIVE_MESSAGE}'::uuid on conflict(message_id,user_id) do nothing;
  insert into public.msg_message_deletions(message_id,user_id,deleted_at)
  select m.id,p.user_id,timestamptz '2026-08-01T00:02:00Z'
  from public.msg_messages m join lateral (
    select p.user_id from public.msg_thread_participants p where p.thread_id=m.thread_id order by p.id limit 1
  ) p on true
  where m.id='${ARCHIVE_MESSAGE}'::uuid on conflict(message_id,user_id) do nothing;
  alter table public.msg_message_deletions enable trigger trg_msg_reject_retired_ops_manager_shared_message_delete;
  alter table public.msg_receipts enable trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation;
  alter table public.msg_message_audit enable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;
  alter table public.msg_messages enable trigger trg_msg_message_immutable_audit;
  alter table public.msg_messages enable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;
`);

const archiveBeforeReplay = await archiveInventory();
applyFinalCorrection();
applyFinalCorrection();
assert.deepEqual(await archiveInventory(), archiveBeforeReplay,
  "final correction replay changed retired deletion evidence or archive bytes");

await sql(`
  set role service_role;
  do $truncate_attacks$
  declare v_table text;
  begin
    foreach v_table in array array['msg_threads','msg_thread_participants','msg_messages','msg_message_audit','msg_receipts','msg_message_deletions'] loop
      begin execute format('truncate table public.%I',v_table); raise exception 'service_role truncated %',v_table;
      exception when insufficient_privilege or check_violation then null;
      end;
    end loop;
    begin execute 'truncate table public.msg_messages cascade'; raise exception 'service_role cascade-truncated msg_messages';
    exception when insufficient_privilege or check_violation then null;
    end;
    begin execute 'truncate table public.msg_threads cascade'; raise exception 'service_role cascade-truncated msg_threads';
    exception when insufficient_privilege or check_violation then null;
    end;
  end
  $truncate_attacks$;
  reset role;
`);
assert.deepEqual(await archiveInventory(), archiveBeforeReplay,
  "service_role TRUNCATE attack changed retired archive bytes");

await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values
    ('${INACTIVE_THREAD}'::uuid,'group','Inactive ordinary fixture','${USER_A}'::uuid,true),
    ('${ACTIVE_THREAD}'::uuid,'group','Active ordinary fixture','${USER_A}'::uuid,true)
  on conflict (id) do nothing;
  insert into public.msg_thread_participants(thread_id,user_id)
  values ('${INACTIVE_THREAD}'::uuid,'${USER_A}'::uuid),('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid),
         ('${ACTIVE_THREAD}'::uuid,'${USER_A}'::uuid),('${ACTIVE_THREAD}'::uuid,'${USER_B}'::uuid)
  on conflict (thread_id,user_id) do nothing;
  insert into public.msg_messages(id,thread_id,sender_user_id,message_type,body,metadata_json)
  values
    ('${INACTIVE_MESSAGE}'::uuid,'${INACTIVE_THREAD}'::uuid,'${USER_A}'::uuid,'text','inactive fixture source','{}'::jsonb),
    ('${ACTIVE_MESSAGE}'::uuid,'${ACTIVE_THREAD}'::uuid,'${USER_A}'::uuid,'text','active fixture source','{}'::jsonb)
  on conflict (id) do nothing;
  insert into public.msg_receipts(message_id,user_id,queued_at)
  values ('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid,now()),('${ACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid,now())
  on conflict (message_id,user_id) do nothing;
  update public.msg_threads set is_active=false where id='${INACTIVE_THREAD}'::uuid;
`);

const inactiveBefore = await sql(`
  select jsonb_build_object(
    'thread',(select to_jsonb(t) from public.msg_threads t where t.id='${INACTIVE_THREAD}'::uuid),
    'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.msg_messages m where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.msg_receipts r join public.msg_messages m on m.id=r.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'visibility',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.msg_thread_visibility v where v.thread_id='${INACTIVE_THREAD}'::uuid),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_id),'[]'::jsonb) from public.msg_thread_deletion_operations o where o.thread_id='${INACTIVE_THREAD}'::uuid),
    'native_ack_count',(select count(*) from public.device_notification_acknowledgements where notification_key in ('inactive-event-ack','retired-event-ack'))
  )::text;
`);

for (const statement of [
  `select public.msg_send_message('${INACTIVE_THREAD}'::uuid,'${USER_A}'::uuid,'must fail','text','{}'::jsonb,'inactive-send');`,
  `select public.msg_mark_message_delivered('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_mark_message_displayed('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_acknowledge_message('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_mark_messages_delivered('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid);`,
  `select public.msg_mark_messages_displayed('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid);`,
  `select public.msg_mark_thread_read('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid);`,
  `select public.msg_set_memphis_thread_context('${INACTIVE_THREAD}'::uuid,'inactive-context',null,null,null,null,null,'{}'::jsonb);`,
  `select public.msg_unhide_thread_for_device('${INACTIVE_THREAD}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_delete_thread('${INACTIVE_THREAD}'::uuid,'${USER_A}'::uuid,'00000000-0000-4000-8000-00000000e116'::uuid);`,
  `select public.msg_admin_tombstone_thread('${INACTIVE_THREAD}'::uuid,'${ADMIN_USER}'::uuid,'00000000-0000-4000-8000-00000000e117'::uuid);`,
  `select public.msg_acknowledge_event_device_notification('${DEVICE_ID}','inactive-event-ack','event','acknowledged','{}'::jsonb,'${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid);`,
]) {
  expectRejected(`set role service_role; ${statement}`, /retired or inactive|immutable/i);
}
expectRejected(
  `set role service_role; select public.msg_delete_message('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid);`,
  /Individual-message deletion is retired/i,
);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('${DEVICE_ID}','retired-event-ack','event','acknowledged','{}'::jsonb,'${ARCHIVE_MESSAGE}'::uuid,(select user_id from public.msg_receipts where message_id='${ARCHIVE_MESSAGE}'::uuid limit 1));`, /retired|immutable/i);
assert.equal(await sql(`
  select jsonb_build_object(
    'thread',(select to_jsonb(t) from public.msg_threads t where t.id='${INACTIVE_THREAD}'::uuid),
    'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.msg_messages m where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.msg_receipts r join public.msg_messages m on m.id=r.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'visibility',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.msg_thread_visibility v where v.thread_id='${INACTIVE_THREAD}'::uuid),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_id),'[]'::jsonb) from public.msg_thread_deletion_operations o where o.thread_id='${INACTIVE_THREAD}'::uuid),
    'native_ack_count',(select count(*) from public.device_notification_acknowledgements where notification_key in ('inactive-event-ack','retired-event-ack'))
  )::text;
`), inactiveBefore, "inactive or retired writer rejection left a durable partial state");

const activeMessageBeforeDelete = await sql(`select to_jsonb(m)::text from public.msg_messages m where m.id='${ACTIVE_MESSAGE}'::uuid;`);
const activeDeletionCountBefore = await sql(`select count(*)::text from public.msg_message_deletions where message_id='${ACTIVE_MESSAGE}'::uuid;`);
expectRejected(
  `set role service_role; select public.msg_delete_message('${ACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid);`,
  /Individual-message deletion is retired/i,
);
expectRejected(
  `set role service_role; select public.msg_delete_message('${ACTIVE_MESSAGE}'::uuid,'${NONPARTICIPANT_USER}'::uuid);`,
  /Individual-message deletion is retired/i,
);
assert.equal(
  await sql(`select count(*)::text from public.msg_message_deletions where message_id='${ACTIVE_MESSAGE}'::uuid;`),
  activeDeletionCountBefore,
  "retired individual-message deletion left deletion evidence",
);
assert.equal(
  await sql(`select to_jsonb(m)::text from public.msg_messages m where m.id='${ACTIVE_MESSAGE}'::uuid;`),
  activeMessageBeforeDelete,
  "retired individual-message deletion rewrote message evidence",
);

await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values ('${TOMBSTONED_THREAD}'::uuid,'group','Tombstoned message fixture','${USER_A}'::uuid,true)
  on conflict (id) do nothing;
  insert into public.msg_thread_participants(thread_id,user_id)
  values ('${TOMBSTONED_THREAD}'::uuid,'${USER_A}'::uuid),('${TOMBSTONED_THREAD}'::uuid,'${USER_B}'::uuid)
  on conflict (thread_id,user_id) do nothing;
  insert into public.msg_messages(id,thread_id,sender_user_id,message_type,body,metadata_json,is_deleted,deleted_at,deleted_by_user_id)
  values ('${TOMBSTONED_MESSAGE}'::uuid,'${TOMBSTONED_THREAD}'::uuid,'${USER_A}'::uuid,'text','tombstoned fixture','{}'::jsonb,true,now(),'${ADMIN_USER}'::uuid)
  on conflict (id) do nothing;
  update public.msg_threads set is_active=false where id='${TOMBSTONED_THREAD}'::uuid;
`);
expectRejected(`set role service_role; select public.msg_delete_message('${TOMBSTONED_MESSAGE}'::uuid,'${USER_B}'::uuid);`, /Individual-message deletion is retired/i);
assert.equal(await sql(`select count(*)::text from public.msg_message_deletions where message_id='${TOMBSTONED_MESSAGE}'::uuid;`), "0",
  "tombstoned message accepted a new user-scoped hide");
expectRejected(`set role service_role; select public.msg_delete_message('${ARCHIVE_MESSAGE}'::uuid,'${USER_A}'::uuid);`, /Individual-message deletion is retired/i);
assert.deepEqual(await archiveInventory(), archiveBeforeReplay,
  "retired archived message deletion fixture was changed by the final writer");

const activeAck = JSON.parse(await sql(`
  set role service_role;
  select public.msg_acknowledge_event_device_notification('${DEVICE_ID}','active-event-ack','event','opened','{}'::jsonb,'${ACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid)::text;
`));
assert.ok(activeAck.message_receipt_id, "active event acknowledgement did not atomically return its Messenger receipt");
assert.equal(await sql(`select count(*)::text from public.device_notification_acknowledgements where notification_key='active-event-ack';`), "1");
assert.equal(await sql(`select (acknowledged_at is not null)::text from public.msg_receipts where message_id='${ACTIVE_MESSAGE}'::uuid and user_id='${USER_B}'::uuid;`), "true");

const COLLISION_MANAGER = "00000000-0000-4000-8000-00000000e501";
const COLLISION_USER = "00000000-0000-4000-8000-00000000e502";
await sql(`
  insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values ('${COLLISION_MANAGER}'::uuid,'Same Name Collision',array['OPS_MANAGER']::text[],true,false)
  on conflict (manager_id) do update set display_name=excluded.display_name,active=true,revoked_at=null,is_system_principal=false;
  insert into public.msg_users(id,display_name,role,is_active)
  values ('${COLLISION_USER}'::uuid,'Same Name Collision','employee',true)
  on conflict (id) do update set display_name=excluded.display_name,role='employee',is_active=true,ops_manager_id=null,messaging_identity_key=null;
`);
const unrelatedBefore = await sql(`select to_jsonb(u)::text from public.msg_users u where u.id='${COLLISION_USER}'::uuid;`);
const collisionPrincipal = await sql(`set role service_role; select (public.msg_ensure_ops_manager_user('${COLLISION_MANAGER}'::uuid)).id::text;`);
assert.notEqual(collisionPrincipal, COLLISION_USER, "same-name unrelated Messenger principal was adopted");
assert.equal(await sql(`select to_jsonb(u)::text from public.msg_users u where u.id='${COLLISION_USER}'::uuid;`), unrelatedBefore,
  "same-name unrelated Messenger principal changed during manager provisioning");
assert.equal(await sql(`select (ops_manager_id='${COLLISION_MANAGER}'::uuid and role='manager' and is_active and display_name like 'Same Name Collision · Leadership %')::text from public.msg_users where id='${collisionPrincipal}'::uuid;`), "true");

async function seedRawPair(userLow, userHigh, threadIds, messagePrefix) {
  await sql(`
    alter table public.msg_threads disable trigger trg_msg_enforce_canonical_active_pair_thread;
    alter table public.msg_thread_participants disable trigger trg_msg_enforce_canonical_active_pair_participants;
    ${threadIds.map((threadId, index) => `insert into public.msg_threads(id,thread_type,created_by_user_id,is_active,title) values('${threadId}'::uuid,'direct','${userLow}'::uuid,true,'${messagePrefix}-${index}') on conflict(id) do nothing; insert into public.msg_thread_participants(thread_id,user_id) values('${threadId}'::uuid,'${userLow}'::uuid),('${threadId}'::uuid,'${userHigh}'::uuid) on conflict(thread_id,user_id) do nothing; insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json) values('${threadId}'::uuid,'${userLow}'::uuid,'text','${messagePrefix}-${index}','{}'::jsonb);`).join("\n")}
    alter table public.msg_thread_participants enable trigger trg_msg_enforce_canonical_active_pair_participants;
    alter table public.msg_threads enable trigger trg_msg_enforce_canonical_active_pair_thread;
  `);
}

const DUP_A = "00000000-0000-4000-8000-00000000e161";
const DUP_B = "00000000-0000-4000-8000-00000000e162";
await sql(`insert into public.msg_users(id,display_name,role,is_active) values ('${DUP_A}'::uuid,'Duplicate Direct A','manager',true),('${DUP_B}'::uuid,'Duplicate Direct B','manager',true) on conflict (id) do update set is_active=true;`);
await seedRawPair(DUP_A, DUP_B, ["00000000-0000-4000-8000-00000000e163", "00000000-0000-4000-8000-00000000e164"], "duplicate-before-mapping");
const duplicateBeforeMapping = await sql(`
  select jsonb_build_object('threads',(select jsonb_agg(to_jsonb(t) order by t.id) from public.msg_threads t where t.id in ('00000000-0000-4000-8000-00000000e163'::uuid,'00000000-0000-4000-8000-00000000e164'::uuid)),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.msg_messages m where m.thread_id in ('00000000-0000-4000-8000-00000000e163'::uuid,'00000000-0000-4000-8000-00000000e164'::uuid)),
    'mapping',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.msg_canonical_thread_pairs p where p.principal_low_id=least('${DUP_A}'::uuid,'${DUP_B}'::uuid) and p.principal_high_id=greatest('${DUP_A}'::uuid,'${DUP_B}'::uuid)))::text;
`);
expectRejected(`set role service_role; select public.msg_get_or_create_direct_thread('${DUP_A}'::uuid,'${DUP_B}'::uuid);`, /ambiguous active Messenger canonical pair/i);
assert.equal(await sql(`
  select jsonb_build_object('threads',(select jsonb_agg(to_jsonb(t) order by t.id) from public.msg_threads t where t.id in ('00000000-0000-4000-8000-00000000e163'::uuid,'00000000-0000-4000-8000-00000000e164'::uuid)),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.msg_messages m where m.thread_id in ('00000000-0000-4000-8000-00000000e163'::uuid,'00000000-0000-4000-8000-00000000e164'::uuid)),
    'mapping',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.msg_canonical_thread_pairs p where p.principal_low_id=least('${DUP_A}'::uuid,'${DUP_B}'::uuid) and p.principal_high_id=greatest('${DUP_A}'::uuid,'${DUP_B}'::uuid)))::text;
`), duplicateBeforeMapping, "duplicate-before-mapping call changed evidence");

const MAPPED_A = "00000000-0000-4000-8000-00000000e165";
const MAPPED_B = "00000000-0000-4000-8000-00000000e166";
await sql(`insert into public.msg_users(id,display_name,role,is_active) values ('${MAPPED_A}'::uuid,'Duplicate Mapped A','manager',true),('${MAPPED_B}'::uuid,'Duplicate Mapped B','manager',true) on conflict (id) do update set is_active=true;`);
const mappedThread = await sql(`set role service_role; select (public.msg_get_or_create_direct_thread('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid)).id::text;`);
const rawDuplicateCount = await sql(`select count(*)::text from public.msg_threads where id='00000000-0000-4000-8000-00000000e168'::uuid;`);
expectRejected(`
  begin;
  set role service_role;
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values ('00000000-0000-4000-8000-00000000e168'::uuid,'direct','raw duplicate blocked','${MAPPED_A}'::uuid,true);
  insert into public.msg_thread_participants(thread_id,user_id)
  values ('00000000-0000-4000-8000-00000000e168'::uuid,'${MAPPED_A}'::uuid),('00000000-0000-4000-8000-00000000e168'::uuid,'${MAPPED_B}'::uuid);
  commit;
`, /ambiguous active Messenger canonical pair/i);
assert.equal(await sql(`select count(*)::text from public.msg_threads where id='00000000-0000-4000-8000-00000000e168'::uuid;`), rawDuplicateCount,
  "canonical write boundary left a raw duplicate assembly behind");
await seedRawPair(MAPPED_A, MAPPED_B, ["00000000-0000-4000-8000-00000000e167"], "duplicate-after-mapping");
const duplicateAfterMapping = await sql(`
  select jsonb_build_object('threads',(select jsonb_agg(to_jsonb(t) order by t.id) from public.msg_threads t where t.id in ('${mappedThread}'::uuid,'00000000-0000-4000-8000-00000000e167'::uuid)),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.msg_messages m where m.thread_id in ('${mappedThread}'::uuid,'00000000-0000-4000-8000-00000000e167'::uuid)),
    'mapping',(select jsonb_agg(to_jsonb(p)) from public.msg_canonical_thread_pairs p where p.principal_low_id=least('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid) and p.principal_high_id=greatest('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid)))::text;
`);
expectRejected(`set role service_role; select public.msg_get_or_create_direct_thread('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid);`, /ambiguous active Messenger canonical pair/i);
assert.equal(await sql(`
  select jsonb_build_object('threads',(select jsonb_agg(to_jsonb(t) order by t.id) from public.msg_threads t where t.id in ('${mappedThread}'::uuid,'00000000-0000-4000-8000-00000000e167'::uuid)),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.msg_messages m where m.thread_id in ('${mappedThread}'::uuid,'00000000-0000-4000-8000-00000000e167'::uuid)),
    'mapping',(select jsonb_agg(to_jsonb(p)) from public.msg_canonical_thread_pairs p where p.principal_low_id=least('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid) and p.principal_high_id=greatest('${MAPPED_A}'::uuid,'${MAPPED_B}'::uuid)))::text;
`), duplicateAfterMapping, "duplicate-after-mapping call changed evidence or its canonical map");

const STALE_A = "00000000-0000-4000-8000-00000000e171";
const STALE_B = "00000000-0000-4000-8000-00000000e172";
await sql(`insert into public.msg_users(id,display_name,role,is_active) values ('${STALE_A}'::uuid,'Stale Direct A','manager',true),('${STALE_B}'::uuid,'Stale Direct B','manager',true) on conflict (id) do update set is_active=true;`);
const staleOriginal = await sql(`set role service_role; select (public.msg_get_or_create_direct_thread('${STALE_A}'::uuid,'${STALE_B}'::uuid)).id::text;`);
await sql(`update public.msg_threads set is_active=false where id='${staleOriginal}'::uuid;`);
await seedRawPair(STALE_A, STALE_B, ["00000000-0000-4000-8000-00000000e173"], "stale-pair-replacement");
const staleReplacement = await sql(`set role service_role; select (public.msg_get_or_create_direct_thread('${STALE_B}'::uuid,'${STALE_A}'::uuid)).id::text;`);
assert.equal(staleReplacement, "00000000-0000-4000-8000-00000000e173");
assert.equal(await sql(`set role service_role; select (public.msg_get_or_create_direct_thread('${STALE_A}'::uuid,'${STALE_B}'::uuid)).id::text;`), staleReplacement,
  "stale canonical pair replay did not stay stable");
assert.equal(await sql(`select is_active::text from public.msg_threads where id='${staleOriginal}'::uuid;`), "false");

const RACE_A = "00000000-0000-4000-8000-00000000e181";
const RACE_B = "00000000-0000-4000-8000-00000000e182";
await sql(`insert into public.msg_users(id,display_name,role,is_active) values ('${RACE_A}'::uuid,'Race Direct A','manager',true),('${RACE_B}'::uuid,'Race Direct B','manager',true) on conflict (id) do update set is_active=true;`);
const directRace = await concurrentSql(`set role service_role; select (public.msg_get_or_create_direct_thread('${RACE_A}'::uuid,'${RACE_B}'::uuid)).id::text;`);
assert.equal(new Set(directRace).size, 1, "ten concurrent direct callers did not converge");
assert.equal(await sql(`set role service_role; select (public.msg_get_or_create_direct_thread('${RACE_B}'::uuid,'${RACE_A}'::uuid)).id::text;`), directRace[0],
  "direct replay changed canonical identity");
const memphisRace = await concurrentSql(`set role service_role; select (public.msg_get_or_create_memphis_thread('${RACE_A}'::uuid)).id::text;`);
assert.equal(new Set(memphisRace).size, 1, "ten concurrent Memphis callers did not converge");
assert.equal(await sql(`set role service_role; select (public.msg_get_or_create_memphis_thread('${RACE_A}'::uuid)).id::text;`), memphisRace[0],
  "Memphis replay changed canonical identity");

console.log("NAMED_MANAGER_MESSENGER_RETIREMENT_CORRECTION_DATABASE_PASS");
