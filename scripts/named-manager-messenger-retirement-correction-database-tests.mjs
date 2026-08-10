#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
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
const MEMPHIS_USER = "00000000-0000-4000-8000-00000000e125";
const INACTIVE_THREAD = "00000000-0000-4000-8000-00000000e110";
const INACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e114";
const ACTIVE_THREAD = "00000000-0000-4000-8000-00000000e120";
const ACTIVE_MESSAGE = "00000000-0000-4000-8000-00000000e121";
const TOMBSTONED_THREAD = "00000000-0000-4000-8000-00000000e119";
const TOMBSTONED_MESSAGE = "00000000-0000-4000-8000-00000000e11a";
const DEVICE_ID = "NMMS-RETIREMENT-DEVICE";
const ARCHIVE_MESSAGE = "00000000-0000-4000-8000-00000000e130";
const ARCHIVE_AUDIT = "00000000-0000-4000-8000-00000000e131";
const ARCHIVE_OPERATION = "00000000-0000-4000-8000-00000000e132";
const EVENT_EMPLOYEE = "00000000-0000-4000-8000-00000000e190";
const EVENT_USER = "00000000-0000-4000-8000-00000000e191";
const EVENT_DEVICE = "00000000-0000-4000-8000-00000000e192";
const EVENT_CREDENTIAL = "00000000-0000-4000-8000-00000000e193";
const EVENT_ID = "00000000-0000-4000-8000-00000000e194";
const EVENT_THREAD = "00000000-0000-4000-8000-00000000e195";
const EVENT_MESSAGE = "00000000-0000-4000-8000-00000000e196";

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

async function concurrentSameNameProvision(managerIds) {
  const runConcurrentPsql = (statement) => new Promise((resolveResult) => {
    const child = spawn("docker", [
      "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
      "-U", "supabase_admin", "-d", database,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
    child.stdin.end(statement);
  });
  const results = await Promise.all(managerIds.map((managerId) => runConcurrentPsql(`
      insert into public.named_manager_test_barrier(backend_pid) values (pg_backend_pid());
      begin;
      do $wait_for_peer$
      declare v_started timestamptz:=clock_timestamp();
      begin
        while (select count(*) from public.named_manager_test_barrier) < 2 loop
          if clock_timestamp()-v_started>interval '5 seconds' then raise exception 'same-name provisioning barrier timed out'; end if;
          perform pg_sleep(0.01);
        end loop;
      end
      $wait_for_peer$;
      set role service_role;
      select (public.msg_ensure_ops_manager_user('${managerId}'::uuid)).id::text;
      commit;
    `)));
  return results.map(({ status, stdout, stderr }) => {
    assert.equal(status, 0, `same-name provisioning failed: ${stderr || stdout}`);
    assert.equal(stderr.trim(), "");
    const ids = String(stdout).match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig) || [];
    assert.equal(ids.length, 1, `same-name provisioning did not return exactly one Messenger principal: ${stdout}`);
    return ids[0];
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
      'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'visibility',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.msg_thread_visibility v join public.msg_threads t on t.id=v.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'hidden_devices',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from public.msg_hidden_threads_by_device h join public.msg_threads t on t.id=h.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'memphis_context',(select coalesce(jsonb_agg(to_jsonb(c) order by c.thread_id),'[]'::jsonb) from public.msg_memphis_thread_context c join public.msg_threads t on t.id=c.thread_id where t.system_key='ops_manager_shared_chat_v1'),
      'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_id),'[]'::jsonb) from public.msg_thread_deletion_operations o join public.msg_threads t on t.id=o.thread_id where t.system_key='ops_manager_shared_chat_v1')
    )::text;
  `).then(JSON.parse);
}

await sql(`
  insert into public.msg_users(id,display_name,role,is_active)
  values
    ('${USER_A}'::uuid,'Retirement Fixture Sender','manager',true),
    ('${USER_B}'::uuid,'Retirement Fixture Recipient','manager',true),
    ('${ADMIN_USER}'::uuid,'Retirement Fixture Admin','admin',true),
    ('${NONPARTICIPANT_USER}'::uuid,'Retirement Fixture Nonparticipant','manager',true),
    ('${MEMPHIS_USER}'::uuid,'Memphis','bot',true)
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
  alter table public.msg_thread_visibility disable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_hidden_threads_by_device disable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_memphis_thread_context disable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_thread_deletion_operations disable trigger trg_msg_reject_retired_ops_shared_evidence;
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
  insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before,created_at,updated_at)
  select t.id,p.user_id,'archive-visibility-device',t.created_at,t.created_at,t.created_at
  from public.msg_threads t join lateral (
    select user_id from public.msg_thread_participants where thread_id=t.id order by id limit 1
  ) p on true where t.system_key='ops_manager_shared_chat_v1'
  on conflict(thread_id,user_id,device_identifier) do nothing;
  insert into public.msg_hidden_threads_by_device(thread_id,device_identifier,hidden_at)
  select t.id,'archive-hidden-device',t.created_at from public.msg_threads t
  where t.system_key='ops_manager_shared_chat_v1'
  on conflict(thread_id,device_identifier) do nothing;
  insert into public.msg_memphis_thread_context(thread_id,last_intent,context_json,updated_at)
  select t.id,'archived_context','{"fixture":"archive"}'::jsonb,t.created_at
  from public.msg_threads t where t.system_key='ops_manager_shared_chat_v1'
  on conflict(thread_id) do nothing;
  insert into public.msg_thread_deletion_operations(operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,thread_type,metadata_json)
  select '${ARCHIVE_OPERATION}'::uuid,t.id,p.user_id,'user',t.created_at,t.created_at,t.thread_type,'{"fixture":"archive"}'::jsonb
  from public.msg_threads t join lateral (
    select user_id from public.msg_thread_participants where thread_id=t.id order by id limit 1
  ) p on true where t.system_key='ops_manager_shared_chat_v1'
  on conflict(operation_id) do nothing;
  alter table public.msg_thread_deletion_operations enable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_memphis_thread_context enable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_hidden_threads_by_device enable trigger trg_msg_reject_retired_ops_shared_evidence;
  alter table public.msg_thread_visibility enable trigger trg_msg_reject_retired_ops_shared_evidence;
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
    foreach v_table in array array['msg_threads','msg_thread_participants','msg_messages','msg_message_audit','msg_receipts','msg_message_deletions','msg_thread_visibility','msg_hidden_threads_by_device','msg_memphis_thread_context','msg_thread_deletion_operations'] loop
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

for (const statement of [
  `update public.msg_thread_visibility set hidden_before=now() where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `delete from public.msg_thread_visibility where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before) select t.id,p.user_id,'archive-attack-visibility',now() from public.msg_threads t join lateral (select user_id from public.msg_thread_participants where thread_id=t.id order by id limit 1) p on true where t.system_key='ops_manager_shared_chat_v1';`,
  `update public.msg_hidden_threads_by_device set hidden_at=now() where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `delete from public.msg_hidden_threads_by_device where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `insert into public.msg_hidden_threads_by_device(thread_id,device_identifier) select id,'archive-attack-hidden' from public.msg_threads where system_key='ops_manager_shared_chat_v1';`,
  `update public.msg_memphis_thread_context set updated_at=now() where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `delete from public.msg_memphis_thread_context where thread_id=(select id from public.msg_threads where system_key='ops_manager_shared_chat_v1');`,
  `insert into public.msg_memphis_thread_context(thread_id,last_intent) select id,'archive-attack-context' from public.msg_threads where system_key='ops_manager_shared_chat_v1';`,
  `update public.msg_thread_deletion_operations set deleted_at=now() where operation_id='${ARCHIVE_OPERATION}'::uuid;`,
  `delete from public.msg_thread_deletion_operations where operation_id='${ARCHIVE_OPERATION}'::uuid;`,
  `insert into public.msg_thread_deletion_operations(operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,thread_type) select '00000000-0000-4000-8000-00000000e133'::uuid,t.id,p.user_id,'user',now(),now(),t.thread_type from public.msg_threads t join lateral (select user_id from public.msg_thread_participants where thread_id=t.id order by id limit 1) p on true where t.system_key='ops_manager_shared_chat_v1';`,
]) expectRejected(`set role service_role; ${statement}`, /retired Operations Leadership conversation evidence is immutable/i);
assert.deepEqual(await archiveInventory(), archiveBeforeReplay,
  "service_role row attacks changed retired presentation or deletion evidence");

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
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_id),'[]'::jsonb) from public.msg_thread_deletion_operations o where o.thread_id='${INACTIVE_THREAD}'::uuid)
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
  `select public.msg_hide_thread_for_device('${INACTIVE_THREAD}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_unhide_thread_for_device('${INACTIVE_THREAD}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_restore_thread_visibility('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_mark_thread_deleted('${INACTIVE_THREAD}'::uuid,'${USER_B}'::uuid,'${DEVICE_ID}');`,
  `select public.msg_delete_thread('${INACTIVE_THREAD}'::uuid,'${USER_A}'::uuid,'00000000-0000-4000-8000-00000000e116'::uuid);`,
  `select public.msg_admin_tombstone_thread('${INACTIVE_THREAD}'::uuid,'${ADMIN_USER}'::uuid,'00000000-0000-4000-8000-00000000e117'::uuid);`,
]) {
  expectRejected(`set role service_role; ${statement}`, /retired or inactive|immutable|Legacy thread deletion is retired/i);
}
expectRejected(
  `set role service_role; select public.msg_delete_message('${INACTIVE_MESSAGE}'::uuid,'${USER_B}'::uuid);`,
  /Individual-message deletion is retired/i,
);
assert.equal(await sql(`
  select jsonb_build_object(
    'thread',(select to_jsonb(t) from public.msg_threads t where t.id='${INACTIVE_THREAD}'::uuid),
    'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.msg_messages m where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.msg_receipts r join public.msg_messages m on m.id=r.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id where m.thread_id='${INACTIVE_THREAD}'::uuid),
    'visibility',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.msg_thread_visibility v where v.thread_id='${INACTIVE_THREAD}'::uuid),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_id),'[]'::jsonb) from public.msg_thread_deletion_operations o where o.thread_id='${INACTIVE_THREAD}'::uuid)
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

await sql(`
  insert into public.employees(id,employee_code,display_name,active,role)
  values ('${EVENT_EMPLOYEE}'::uuid,'EMP90190','Authoritative Event Employee',true,'staff')
  on conflict(id) do update set active=true;
  insert into public.msg_users(id,employee_id,display_name,role,is_active)
  values ('${EVENT_USER}'::uuid,'${EVENT_EMPLOYEE}'::uuid,'Authoritative Event Employee','employee',true)
  on conflict(id) do update set employee_id=excluded.employee_id,role='employee',is_active=true;
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch)
  values ('${EVENT_DEVICE}'::uuid,'AUTHORITATIVE-EVENT-DEVICE','Authoritative event device',true,'${EVENT_EMPLOYEE}'::uuid,7)
  on conflict(id) do update set active=true,assigned_employee_id=excluded.assigned_employee_id,assignment_epoch=excluded.assignment_epoch;
  insert into public.device_auth_credentials(credential_id,device_id,token_hash,confirmed_at,expires_at)
  values ('${EVENT_CREDENTIAL}'::uuid,'${EVENT_DEVICE}'::uuid,repeat('a',64),now(),now()+interval '1 day')
  on conflict(credential_id) do update set device_id=excluded.device_id,confirmed_at=excluded.confirmed_at,revoked_at=null,expires_at=excluded.expires_at;
  insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_date,event_scope,display_location,status,revision,audience_scope,audience_employee_ids)
  values ('${EVENT_ID}'::uuid,'Authoritative Event Ack Fixture',(select id from public.location_groups order by id limit 1),current_date,'09:00',current_date,'ZOO_WIDE','Zoo Footprint','SCHEDULED',1,'specific_employees',array['${EVENT_EMPLOYEE}'::uuid])
  on conflict(id) do update set status='SCHEDULED',revision=1,cancelled_at=null;
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values ('${EVENT_THREAD}'::uuid,'direct','Authoritative Event Ack','${USER_A}'::uuid,true)
  on conflict(id) do update set is_active=true;
  insert into public.msg_thread_participants(thread_id,user_id)
  values ('${EVENT_THREAD}'::uuid,'${USER_A}'::uuid),('${EVENT_THREAD}'::uuid,'${EVENT_USER}'::uuid)
  on conflict(thread_id,user_id) do update set left_at=null;
  insert into public.msg_messages(id,thread_id,sender_user_id,message_type,body,metadata_json)
  values ('${EVENT_MESSAGE}'::uuid,'${EVENT_THREAD}'::uuid,'${USER_A}'::uuid,'text','Authoritative Event response','{}'::jsonb)
  on conflict(id) do update set thread_id=excluded.thread_id,is_deleted=false;
  insert into public.msg_receipts(message_id,user_id,queued_at)
  values ('${EVENT_MESSAGE}'::uuid,'${EVENT_USER}'::uuid,now())
  on conflict(message_id,user_id) do update set acknowledged_at=null;
  insert into public.events_app_notification_log(event_id,employee_id,msg_user_id,thread_id,notification_kind,scheduled_for_local,status,response_message_id)
  values ('${EVENT_ID}'::uuid,'${EVENT_EMPLOYEE}'::uuid,'${EVENT_USER}'::uuid,'${EVENT_THREAD}'::uuid,'day_before',now()::timestamp,'sent','${EVENT_MESSAGE}'::uuid)
  on conflict(event_id,employee_id,notification_kind) do update set msg_user_id=excluded.msg_user_id,thread_id=excluded.thread_id,status='sent',response_message_id=excluded.response_message_id;
  insert into public.event_push_instances(notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,assignment_epoch,notification_kind,scheduled_for,state)
  values
    ('authoritative-event-ack','${EVENT_ID}'::uuid,1,current_date,'${EVENT_EMPLOYEE}'::uuid,'${EVENT_DEVICE}'::uuid,'${EVENT_CREDENTIAL}'::uuid,7,'day_before',now(),'sent'),
    ('native-only-event-ack','${EVENT_ID}'::uuid,1,current_date,'${EVENT_EMPLOYEE}'::uuid,'${EVENT_DEVICE}'::uuid,'${EVENT_CREDENTIAL}'::uuid,7,'shift_plus_15',now(),'sent')
  on conflict(notification_key) do update set state='sent',assignment_epoch=excluded.assignment_epoch;
`);

const activeAck = JSON.parse(await sql(`
  set role service_role;
  select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,null,'${EVENT_USER}'::uuid)::text;
`));
assert.equal(activeAck.linked_message_id, EVENT_MESSAGE, "event acknowledgement did not derive the authoritative Messenger message");
assert.ok(activeAck.message_receipt_id, "event acknowledgement did not atomically return its Messenger receipt");
assert.equal(await sql(`select count(*)::text from public.device_notification_acknowledgements where notification_key='authoritative-event-ack';`), "1");
assert.equal(await sql(`select (acknowledged_at is not null)::text from public.msg_receipts where message_id='${EVENT_MESSAGE}'::uuid and user_id='${EVENT_USER}'::uuid;`), "true");
const activeAckReplay = JSON.parse(await sql(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,'${EVENT_MESSAGE}'::uuid,'${EVENT_USER}'::uuid)::text;`));
assert.equal(activeAckReplay.message_receipt_id, activeAck.message_receipt_id, "authoritative event acknowledgement replay changed its receipt");
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,'${ACTIVE_MESSAGE}'::uuid,'${EVENT_USER}'::uuid);`, /does not match the authoritative event notification link/i);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,null,'${USER_B}'::uuid);`, /does not match the authoritative event notification recipient/i);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('${DEVICE_ID}','authoritative-event-ack','event','opened','{}'::jsonb,null,'${EVENT_USER}'::uuid);`, /Active event notification was not found/i);
await sql(`update public.events_app_notification_log set thread_id='${ACTIVE_THREAD}'::uuid where event_id='${EVENT_ID}'::uuid and employee_id='${EVENT_EMPLOYEE}'::uuid and notification_kind='day_before';`);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,null,'${EVENT_USER}'::uuid);`, /response message linkage is invalid/i);
await sql(`update public.events_app_notification_log set thread_id='${EVENT_THREAD}'::uuid where event_id='${EVENT_ID}'::uuid and employee_id='${EVENT_EMPLOYEE}'::uuid and notification_kind='day_before'; update public.devices set assignment_epoch=8 where id='${EVENT_DEVICE}'::uuid;`);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,null,'${EVENT_USER}'::uuid);`, /Active event notification was not found/i);
await sql(`update public.devices set assignment_epoch=7 where id='${EVENT_DEVICE}'::uuid; update public.msg_threads set is_active=false where id='${EVENT_THREAD}'::uuid;`);
expectRejected(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','authoritative-event-ack','event','opened','{}'::jsonb,null,'${EVENT_USER}'::uuid);`, /retired or inactive/i);
await sql(`update public.msg_threads set is_active=true where id='${EVENT_THREAD}'::uuid;`);
const nativeOnlyAck = JSON.parse(await sql(`set role service_role; select public.msg_acknowledge_event_device_notification('AUTHORITATIVE-EVENT-DEVICE','native-only-event-ack','event','opened','{}'::jsonb,null,null)::text;`));
assert.equal(nativeOnlyAck.message_receipt_id, null, "valid native-only event acknowledgement unexpectedly wrote a Messenger receipt");
assert.equal(await sql(`select count(*)::text from public.device_notification_acknowledgements where notification_key='native-only-event-ack';`), "1");

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

const SAME_NAME_MANAGER_A = "00000000-0000-4000-8000-00000000e511";
const SAME_NAME_MANAGER_B = "00000000-0000-4000-8000-00000000e512";
await sql(`
  do $reset_named_manager_test_barrier$
  begin
    if to_regclass('public.named_manager_test_barrier') is not null then
      drop table public.named_manager_test_barrier;
    end if;
  end
  $reset_named_manager_test_barrier$;
  create unlogged table public.named_manager_test_barrier(backend_pid integer primary key);
  insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values
    ('${SAME_NAME_MANAGER_A}'::uuid,'Simultaneous Same Name',array['OPS_MANAGER']::text[],true,false),
    ('${SAME_NAME_MANAGER_B}'::uuid,'Simultaneous Same Name',array['OPS_MANAGER']::text[],true,false)
  on conflict(manager_id) do update set display_name=excluded.display_name,roles=excluded.roles,active=true,revoked_at=null,is_system_principal=false;
`);
const sameNamePrincipals = await concurrentSameNameProvision([SAME_NAME_MANAGER_A, SAME_NAME_MANAGER_B]);
assert.equal(new Set(sameNamePrincipals).size, 2, "simultaneous same-name manager provisioning adopted one principal");
const sameNameRows = JSON.parse(await sql(`select jsonb_agg(jsonb_build_object('manager_id',ops_manager_id,'id',id,'display_name',display_name) order by ops_manager_id)::text from public.msg_users where ops_manager_id in ('${SAME_NAME_MANAGER_A}'::uuid,'${SAME_NAME_MANAGER_B}'::uuid);`));
assert.equal(sameNameRows.length, 2, "simultaneous same-name manager provisioning did not create two principals");
assert.equal(new Set(sameNameRows.map((row) => row.display_name)).size, 2, "same-name manager labels collided");
assert.ok(sameNameRows.some((row) => row.display_name === "Simultaneous Same Name"));
assert.ok(sameNameRows.some((row) => / · Leadership 0000000000004000800000000000e51[12]$/.test(row.display_name)),
  "same-name collision label did not use a full deterministic UUID identity");
for (const row of sameNameRows) {
  const replay = await sql(`set role service_role; select (public.msg_ensure_ops_manager_user('${row.manager_id}'::uuid)).id::text;`);
  assert.equal(replay, row.id, "same-name provision replay changed the manager principal");
}

const NAMED_RESTORE_THREAD = "00000000-0000-4000-8000-00000000e513";
await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values ('${NAMED_RESTORE_THREAD}'::uuid,'group','Named manager legacy restore','${collisionPrincipal}'::uuid,true)
  on conflict(id) do update set is_active=true;
  insert into public.msg_thread_participants(thread_id,user_id)
  values ('${NAMED_RESTORE_THREAD}'::uuid,'${collisionPrincipal}'::uuid)
  on conflict(thread_id,user_id) do update set left_at=null;
  delete from public.msg_thread_visibility
  where thread_id='${NAMED_RESTORE_THREAD}'::uuid and user_id='${collisionPrincipal}'::uuid;
  insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before)
  values ('${NAMED_RESTORE_THREAD}'::uuid,'${collisionPrincipal}'::uuid,null,now())
  on conflict(thread_id,user_id,device_identifier) do update set hidden_before=excluded.hidden_before;
  set role service_role;
  select public.msg_restore_thread_visibility('${NAMED_RESTORE_THREAD}'::uuid,'${collisionPrincipal}'::uuid,null);
`);
assert.equal(await sql(`select count(*)::text from public.msg_thread_visibility where thread_id='${NAMED_RESTORE_THREAD}'::uuid and user_id='${collisionPrincipal}'::uuid;`), "0",
  "active named manager could not use legacy visibility restoration");
await sql(`
  delete from public.msg_thread_visibility
  where thread_id='${NAMED_RESTORE_THREAD}'::uuid and user_id='${collisionPrincipal}'::uuid;
  insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before)
  values ('${NAMED_RESTORE_THREAD}'::uuid,'${collisionPrincipal}'::uuid,null,now());
  update public.ops_manager_managers set active=false,revoked_at=now() where manager_id='${COLLISION_MANAGER}'::uuid;
`);
expectRejected(`set role service_role; select public.msg_restore_thread_visibility('${NAMED_RESTORE_THREAD}'::uuid,'${collisionPrincipal}'::uuid,null);`, /Runtime messaging user not found or inactive/i);
assert.equal(await sql(`select count(*)::text from public.msg_thread_visibility where thread_id='${NAMED_RESTORE_THREAD}'::uuid and user_id='${collisionPrincipal}'::uuid;`), "1",
  "revoked named manager legacy restoration changed visibility evidence");
assert.equal(await sql(`select public.msg_is_runtime_identity('${collisionPrincipal}'::uuid)::text;`), "false",
  "named-manager-aware runtime identity accepted a revoked manager");
await sql(`update public.ops_manager_managers set active=true,revoked_at=null where manager_id='${COLLISION_MANAGER}'::uuid;`);

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
