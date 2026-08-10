#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.SCHEMA_RECONCILIATION_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.SCHEMA_RECONCILIATION_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

const migration = readFileSync(
  new URL("../supabase/migrations/20260810140000_finalize_named_manager_messenger_retirement_integrity.sql", import.meta.url),
  "utf8",
);
const ARCHIVE_MESSAGE_ID = "00000000-0000-4000-8000-00000000d901";
const ARCHIVE_AUDIT_ID = "00000000-0000-4000-8000-00000000d902";

async function sql(statement) {
  const { stdout, stderr } = await execFileAsync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(stderr.trim(), "");
  return stdout.trim().split("\n").at(-1);
}

function applyReconciliation() {
  const result = execFileSync("docker", [
    "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", "supabase_admin", "-d", database,
  ], { input: migration, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.match(result, /COMMIT/);
}

// A historical archive can legitimately have message evidence even if the
// empty rebuild fixture begins without it. Seed one preserved row set with the
// archive guards temporarily disabled by the owner, then restore the guards
// before every service_role attack. This models already-retired evidence; it
// never uses a public post-retirement writer.
await sql(`
  alter table public.msg_messages disable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;
  alter table public.msg_messages disable trigger trg_msg_message_immutable_audit;
  alter table public.msg_message_audit disable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;
  alter table public.msg_receipts disable trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation;
  alter table public.msg_message_deletions disable trigger trg_msg_reject_retired_ops_manager_shared_message_delete;
  insert into public.msg_messages(id,thread_id,sender_user_id,message_type,body,metadata_json,sent_at,created_at)
  select '${ARCHIVE_MESSAGE_ID}'::uuid,t.id,p.user_id,'text','historical archived evidence','{"fixture":"archive"}'::jsonb,
         timestamptz '2026-08-01T00:00:00Z',timestamptz '2026-08-01T00:00:00Z'
  from public.msg_threads t
  join lateral (
    select user_id from public.msg_thread_participants where thread_id=t.id order by id limit 1
  ) p on true
  where t.system_key='ops_manager_shared_chat_v1'
  on conflict (id) do nothing;
  insert into public.msg_message_audit(
    audit_id,message_id,thread_id,sender_user_id,message_type,sender_display_name,sender_role,created_at
  )
  select '${ARCHIVE_AUDIT_ID}'::uuid,m.id,m.thread_id,m.sender_user_id,m.message_type,u.display_name,u.role,m.created_at
  from public.msg_messages m join public.msg_users u on u.id=m.sender_user_id
  where m.id='${ARCHIVE_MESSAGE_ID}'::uuid
  on conflict (message_id) do nothing;
  insert into public.msg_receipts(message_id,user_id,queued_at,delivered_at,displayed_at,read_at,acknowledged_at,delivery_attempts)
  select m.id,p.user_id,timestamptz '2026-08-01T00:01:00Z',timestamptz '2026-08-01T00:02:00Z',
         timestamptz '2026-08-01T00:03:00Z',timestamptz '2026-08-01T00:04:00Z',
         timestamptz '2026-08-01T00:05:00Z',7
  from public.msg_messages m
  join lateral (
    select p.user_id
    from public.msg_thread_participants p
    where p.thread_id=m.thread_id and p.user_id<>m.sender_user_id
    order by p.id limit 1
  ) p on true
  where m.id='${ARCHIVE_MESSAGE_ID}'::uuid
  on conflict (message_id,user_id) do nothing;
  insert into public.msg_message_deletions(message_id,user_id,deleted_at)
  select m.id,p.user_id,timestamptz '2026-08-01T00:06:00Z'
  from public.msg_messages m
  join lateral (
    select p.user_id from public.msg_thread_participants p
    where p.thread_id=m.thread_id order by p.id limit 1
  ) p on true
  where m.id='${ARCHIVE_MESSAGE_ID}'::uuid
  on conflict (message_id,user_id) do nothing;
  alter table public.msg_message_deletions enable trigger trg_msg_reject_retired_ops_manager_shared_message_delete;
  alter table public.msg_receipts enable trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation;
  alter table public.msg_message_audit enable trigger trg_msg_reject_retired_ops_manager_shared_audit_guard;
  alter table public.msg_messages enable trigger trg_msg_message_immutable_audit;
  alter table public.msg_messages enable trigger trg_msg_reject_retired_ops_manager_shared_message_mutation;
`);

const inventorySql = `
with functions as (
  select p.oid::regprocedure::text as signature,
         md5(pg_get_functiondef(p.oid)) as definition_md5,
         pg_get_functiondef(p.oid) as definition,
         p.prosecdef as security_definer,
         p.proconfig as configuration,
         has_function_privilege('public',p.oid,'execute') as public_execute,
         has_function_privilege('anon',p.oid,'execute') as anon_execute,
         has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
         has_function_privilege('service_role',p.oid,'execute') as service_execute
  from pg_proc p
  where p.pronamespace='public'::regnamespace
    and p.proname in (
      'msg_ensure_ops_manager_user',
      'msg_get_or_create_ops_manager_thread',
      'msg_get_or_create_direct_thread',
      'msg_get_or_create_memphis_thread',
      'msg_mark_thread_read',
      'msg_mark_messages_delivered',
      'msg_mark_messages_displayed',
      'msg_mark_message_delivered',
      'msg_mark_message_displayed',
      'msg_acknowledge_message',
      'msg_delete_message',
      'msg_reject_retired_ops_manager_shared_thread_mutation',
      'msg_reject_retired_ops_manager_shared_participation',
      'msg_reject_retired_ops_manager_shared_message_mutation',
      'msg_reject_retired_ops_manager_shared_message_audit_mutation',
      'msg_reject_retired_ops_manager_shared_receipt_mutation',
      'msg_reject_retired_ops_manager_shared_message_deletion_mutation'
    )
), triggers as (
  select c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled as enabled
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where t.tgname like 'trg_msg_reject_retired_ops_manager_shared_%'
    and not t.tgisinternal
), archive as (
  select jsonb_build_object(
    'thread',(select to_jsonb(t) from public.msg_threads t where t.system_key='ops_manager_shared_chat_v1'),
    'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.msg_thread_participants p join public.msg_threads t on t.id=p.thread_id where t.system_key='ops_manager_shared_chat_v1'),
    'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.msg_messages m join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1'),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.audit_id),'[]'::jsonb) from public.msg_message_audit a join public.msg_threads t on t.id=a.thread_id where t.system_key='ops_manager_shared_chat_v1'),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.msg_receipts r join public.msg_messages m on m.id=r.message_id join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1'),
    'deletions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.msg_message_deletions d join public.msg_messages m on m.id=d.message_id join public.msg_threads t on t.id=m.thread_id where t.system_key='ops_manager_shared_chat_v1')
  ) as data
)
select jsonb_build_object(
  'functions',(select coalesce(jsonb_agg(to_jsonb(f) order by signature),'[]'::jsonb) from functions f),
  'triggers',(select coalesce(jsonb_agg(to_jsonb(t) order by table_name,trigger_name),'[]'::jsonb) from triggers t),
  'archive',(select data from archive),
  'pair_table',jsonb_build_object(
    'exists',to_regclass('public.msg_canonical_thread_pairs') is not null,
    'service_has_any_crud',coalesce(has_table_privilege('service_role','public.msg_canonical_thread_pairs','select') or has_table_privilege('service_role','public.msg_canonical_thread_pairs','insert') or has_table_privilege('service_role','public.msg_canonical_thread_pairs','update') or has_table_privilege('service_role','public.msg_canonical_thread_pairs','delete'),false)
  )
)::text;
`;

const before = JSON.parse(await sql(inventorySql));
applyReconciliation();
applyReconciliation();
const afterReplay = JSON.parse(await sql(inventorySql));
assert.deepEqual(afterReplay, before, "replaying the final correction changed canonical schema or archived evidence");

const functions = Object.fromEntries(afterReplay.functions.map((entry) => [entry.signature, entry]));
assert.equal(Object.hasOwn(functions, "msg_get_or_create_ops_manager_thread(uuid)"), false,
  "the retired shared-room RPC must not remain callable by any role");
for (const name of [
  "msg_reject_retired_ops_manager_shared_thread_mutation()",
  "msg_reject_retired_ops_manager_shared_participation()",
  "msg_reject_retired_ops_manager_shared_message_mutation()",
  "msg_reject_retired_ops_manager_shared_message_audit_mutation()",
  "msg_reject_retired_ops_manager_shared_receipt_mutation()",
  "msg_reject_retired_ops_manager_shared_message_deletion_mutation()",
]) {
  const fn = functions[name];
  assert.ok(fn, `${name} is missing`);
  assert.equal(fn.security_definer, false, `${name} must not become a privileged RPC`);
  assert.deepEqual(fn.configuration, ["search_path=pg_catalog, public"]);
  assert.equal(fn.public_execute, false, `${name} exposed to PUBLIC`);
  assert.equal(fn.anon_execute, false, `${name} exposed to anon`);
  assert.equal(fn.authenticated_execute, false, `${name} exposed to authenticated`);
  assert.equal(fn.service_execute, false, `${name} exposed to service_role`);
}
for (const name of [
  "msg_get_or_create_direct_thread(uuid,uuid)",
  "msg_get_or_create_memphis_thread(uuid)",
]) {
  assert.match(functions[name].definition, /pg_advisory_xact_lock/,
    `${name} must serialize canonical-pair resolution`);
  assert.match(functions[name].definition, /msg_canonical_thread_pairs/,
    `${name} must use the structural canonical-pair authority`);
}
for (const name of [
  "msg_mark_thread_read(uuid,uuid)",
  "msg_mark_messages_delivered(uuid,uuid,uuid\[\])",
  "msg_mark_messages_displayed(uuid,uuid,uuid\[\])",
  "msg_mark_message_delivered(uuid,uuid,text)",
  "msg_mark_message_displayed(uuid,uuid,text)",
  "msg_acknowledge_message(uuid,uuid,text)",
]) {
  assert.match(functions[name].definition, /msg_assert_active_mutable/,
    `${name} must reject retired and inactive targets before mutating receipt state`);
}
const messageDelete = functions["msg_delete_message(uuid,uuid)"];
assert.ok(messageDelete, "retired individual-message deletion RPC is missing");
assert.equal(messageDelete.security_definer, true, "retired deletion RPC must retain its server-side authority boundary");
assert.match(messageDelete.definition, /Individual-message deletion is retired/,
  "individual-message deletion must fail with the accepted retirement contract");
assert.match(messageDelete.definition, /0A000/,
  "individual-message deletion must fail as feature_not_supported");
assert.doesNotMatch(messageDelete.definition, /msg_message_deletions/,
  "retired individual-message deletion must not write deletion evidence");
assert.equal(messageDelete.public_execute, false, "retired deletion RPC exposed to PUBLIC");
assert.equal(messageDelete.anon_execute, false, "retired deletion RPC exposed to anon");
assert.equal(messageDelete.authenticated_execute, false, "retired deletion RPC exposed to authenticated");
assert.equal(messageDelete.service_execute, true, "retired deletion RPC must be executable only by service_role");
assert.deepEqual(afterReplay.triggers.map((trigger) => [trigger.table_name, trigger.trigger_name]), [
  ["msg_message_audit", "trg_msg_reject_retired_ops_manager_shared_audit_guard"],
  ["msg_message_deletions", "trg_msg_reject_retired_ops_manager_shared_message_delete"],
  ["msg_messages", "trg_msg_reject_retired_ops_manager_shared_message_mutation"],
  ["msg_receipts", "trg_msg_reject_retired_ops_manager_shared_receipt_mutation"],
  ["msg_thread_participants", "trg_msg_reject_retired_ops_manager_shared_participation"],
  ["msg_threads", "trg_msg_reject_retired_ops_manager_shared_thread_mutation"],
]);
for (const trigger of afterReplay.triggers) {
  assert.match(trigger.definition, /^CREATE TRIGGER .* BEFORE /);
  assert.match(trigger.definition, / INSERT /);
  assert.match(trigger.definition, / UPDATE /);
  assert.match(trigger.definition, / DELETE /);
}
assert.equal(afterReplay.pair_table.exists, true);
assert.equal(afterReplay.pair_table.service_has_any_crud, false,
  "service_role must not bypass canonical-pair uniqueness with direct mapping writes");
assert.equal(afterReplay.archive.thread.title, "Operations Leadership Chat (Retired)");
assert.equal(afterReplay.archive.thread.is_active, false);
assert.equal(afterReplay.archive.participants.some((row) => row.left_at === null), false);
assert.equal(afterReplay.archive.messages.some((row) => row.id === ARCHIVE_MESSAGE_ID), true);
assert.equal(afterReplay.archive.audit.some((row) => row.message_id === ARCHIVE_MESSAGE_ID), true);
assert.equal(afterReplay.archive.receipts.some((row) => row.message_id === ARCHIVE_MESSAGE_ID), true);
assert.equal(afterReplay.archive.deletions.some((row) => row.message_id === ARCHIVE_MESSAGE_ID), true);

await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  select '00000000-0000-4000-8000-00000000d903'::uuid,'group','ordinary reassignment source',m.sender_user_id,true
  from public.msg_messages m where m.id='${ARCHIVE_MESSAGE_ID}'::uuid
  on conflict (id) do nothing;
  insert into public.msg_thread_participants(thread_id,user_id)
  select '00000000-0000-4000-8000-00000000d903'::uuid,m.sender_user_id
  from public.msg_messages m where m.id='${ARCHIVE_MESSAGE_ID}'::uuid
  on conflict (thread_id,user_id) do nothing;
  set role service_role;
  do $attacks$
  declare
    v_thread uuid;
    v_sender uuid;
    v_recipient uuid;
    v_participant uuid;
    v_receipt uuid;
    v_deletion uuid;
  begin
    select id,created_by_user_id into v_thread,v_sender from public.msg_threads where system_key='ops_manager_shared_chat_v1';
    select user_id into v_recipient from public.msg_thread_participants where thread_id=v_thread order by id offset 1 limit 1;
    select id into v_participant from public.msg_thread_participants where thread_id=v_thread order by id limit 1;
    select id into v_receipt from public.msg_receipts where message_id='${ARCHIVE_MESSAGE_ID}'::uuid limit 1;
    select id into v_deletion from public.msg_message_deletions where message_id='${ARCHIVE_MESSAGE_ID}'::uuid limit 1;

    begin update public.msg_threads set title='rewritten archive' where id=v_thread; raise exception 'archive title mutation was accepted'; exception when check_violation then null; end;
    begin update public.msg_threads set thread_type='direct' where id=v_thread; raise exception 'archive type mutation was accepted'; exception when check_violation then null; end;
    begin update public.msg_threads set created_by_user_id=v_recipient where id=v_thread; raise exception 'archive creator mutation was accepted'; exception when check_violation then null; end;
    begin update public.msg_threads set system_key=null where id=v_thread; raise exception 'archive key mutation was accepted'; exception when check_violation then null; end;
    begin update public.msg_threads set is_active=true where id=v_thread; raise exception 'archive active-state mutation was accepted'; exception when check_violation then null; end;
    begin delete from public.msg_threads where id=v_thread; raise exception 'archive delete/cascade was accepted'; exception when check_violation then null; end;

    begin delete from public.msg_thread_participants where id=v_participant; raise exception 'archive participant delete was accepted'; exception when check_violation then null; end;
    begin update public.msg_thread_participants set user_id=v_recipient where id=v_participant; raise exception 'archive participant reassignment was accepted'; exception when check_violation then null; end;
    begin insert into public.msg_thread_participants(thread_id,user_id,left_at) values(v_thread,v_sender,now()); raise exception 'fabricated archived participant was accepted'; exception when check_violation then null; end;
    begin update public.msg_thread_participants set thread_id=v_thread where thread_id='00000000-0000-4000-8000-00000000d903'::uuid; raise exception 'ordinary participant reassignment into archive was accepted'; exception when check_violation then null; end;

    begin update public.msg_messages set body='rewritten evidence' where id='${ARCHIVE_MESSAGE_ID}'::uuid; raise exception 'archive message update was accepted'; exception when check_violation then null; end;
    begin delete from public.msg_messages where id='${ARCHIVE_MESSAGE_ID}'::uuid; raise exception 'archive message delete was accepted'; exception when check_violation then null; end;
    begin insert into public.msg_messages(thread_id,sender_user_id,body) values(v_thread,v_sender,'post-retirement fabrication'); raise exception 'post-retirement archived message was accepted'; exception when check_violation then null; end;
    begin update public.msg_message_audit set sender_display_name='forged' where message_id='${ARCHIVE_MESSAGE_ID}'::uuid; raise exception 'archive audit update was accepted'; exception when check_violation then null; end;
    begin delete from public.msg_message_audit where message_id='${ARCHIVE_MESSAGE_ID}'::uuid; raise exception 'archive audit delete was accepted'; exception when check_violation then null; end;
    begin insert into public.msg_message_audit(message_id,thread_id,sender_user_id,message_type,sender_display_name,sender_role) values('${ARCHIVE_MESSAGE_ID}'::uuid,v_thread,v_sender,'text','forged','manager'); raise exception 'archive audit fabrication was accepted'; exception when check_violation then null; end;
    begin update public.msg_receipts set read_at=now() where id=v_receipt; raise exception 'archive receipt update was accepted'; exception when check_violation then null; end;
    begin delete from public.msg_receipts where id=v_receipt; raise exception 'archive receipt delete was accepted'; exception when check_violation then null; end;
    begin insert into public.msg_receipts(message_id,user_id) values('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender); raise exception 'archive receipt fabrication was accepted'; exception when check_violation then null; end;
    begin update public.msg_message_deletions set deleted_at=now() where id=v_deletion; raise exception 'archive deletion evidence update was accepted'; exception when check_violation then null; end;
    begin delete from public.msg_message_deletions where id=v_deletion; raise exception 'archive deletion evidence delete was accepted'; exception when check_violation then null; end;
    begin insert into public.msg_message_deletions(message_id,user_id) values('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender); raise exception 'archive deletion evidence fabrication was accepted'; exception when check_violation then null; end;

    begin perform public.msg_mark_thread_read(v_thread,v_sender); raise exception 'read RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_mark_messages_delivered(v_thread,v_sender); raise exception 'batch delivery RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_mark_messages_displayed(v_thread,v_sender); raise exception 'batch display RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_mark_message_delivered('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender,'fixture-device'); raise exception 'single delivery RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_mark_message_displayed('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender,'fixture-device'); raise exception 'single display RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_acknowledge_message('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender,'fixture-device'); raise exception 'acknowledgement RPC accepted retired archive'; exception when check_violation then null; end;
    begin perform public.msg_delete_message('${ARCHIVE_MESSAGE_ID}'::uuid,v_sender); raise exception 'individual-message deletion RPC accepted a request'; exception when feature_not_supported then null; end;
  end
  $attacks$;
  reset role;
`);

const afterAttacks = JSON.parse(await sql(inventorySql));
assert.deepEqual(afterAttacks.archive, afterReplay.archive,
  "service_role archive attacks changed preserved room, participants, messages, audit rows, or receipts");

console.log("CANONICAL_SCHEMA_RECONCILIATION_DATABASE_PASS");
