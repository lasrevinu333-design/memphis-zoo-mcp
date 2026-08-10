#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.SCHEMA_RECONCILIATION_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.SCHEMA_RECONCILIATION_TEST_DATABASE || "postgres").trim();

if (
  !/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
  || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)
) {
  throw new Error("A disposable schema-rebuild database is required.");
}

const migration = readFileSync(
  new URL("../supabase/migrations/20260810120000_retire_named_manager_shared_room_authority.sql", import.meta.url),
  "utf8",
);

async function sql(statement) {
  const { stdout, stderr } = await execFileAsync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-c",
      statement,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(stderr.trim(), "");
  return stdout.trim().split("\n").at(-1);
}

function applyReconciliation() {
  const result = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "supabase_admin",
      "-d",
      database,
    ],
    { input: migration, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  assert.match(result, /COMMIT/);
}

const inventorySql = `
with functions as (
  select
    p.oid::regprocedure::text as signature,
    md5(pg_get_functiondef(p.oid)) as definition_md5,
    pg_get_functiondef(p.oid) as definition,
    p.prosecdef as security_definer,
    p.proconfig as configuration,
    obj_description(p.oid,'pg_proc') as comment,
    has_function_privilege('public',p.oid,'execute') as public_execute,
    has_function_privilege('anon',p.oid,'execute') as anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') as service_execute
  from pg_proc p
  where p.pronamespace='public'::regnamespace
    and p.proname in (
      'msg_ensure_ops_manager_user',
      'msg_get_or_create_ops_manager_thread'
    )
), tables as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    obj_description(c.oid,'pg_class') as comment,
    has_table_privilege('public',c.oid,'select')
      or has_table_privilege('public',c.oid,'insert')
      or has_table_privilege('public',c.oid,'update')
      or has_table_privilege('public',c.oid,'delete') as public_has_crud,
    has_table_privilege('anon',c.oid,'select')
      or has_table_privilege('anon',c.oid,'insert')
      or has_table_privilege('anon',c.oid,'update')
      or has_table_privilege('anon',c.oid,'delete') as anon_has_crud,
    has_table_privilege('authenticated',c.oid,'select')
      or has_table_privilege('authenticated',c.oid,'insert')
      or has_table_privilege('authenticated',c.oid,'update')
      or has_table_privilege('authenticated',c.oid,'delete') as authenticated_has_crud,
    has_table_privilege('service_role',c.oid,'select,insert,update,delete') as service_has_crud
  from pg_class c
  where c.relnamespace='public'::regnamespace
    and c.relname in (
      'custodial_employee_device_assignment_history',
      'custodial_employee_status_history',
      'ops_manager_notification_queue'
    )
), policies as (
  select
    tablename as table_name,
    policyname as policy_name,
    permissive,
    roles,
    cmd,
    qual,
    with_check
  from pg_policies
  where schemaname='public'
    and tablename in (
      'custodial_employee_device_assignment_history',
      'custodial_employee_status_history'
    )
)
select jsonb_build_object(
  'functions',(select jsonb_agg(to_jsonb(f) order by signature) from functions f),
  'tables',(select jsonb_agg(to_jsonb(t) order by table_name) from tables t),
  'policies',(select jsonb_agg(to_jsonb(p) order by table_name,policy_name) from policies p)
)::text;
`;

const before = JSON.parse(await sql(inventorySql));
applyReconciliation();
applyReconciliation();
const after = JSON.parse(await sql(inventorySql));
assert.deepEqual(after, before, "replaying the reconciliation changed canonical schema state");

const functions = Object.fromEntries(after.functions.map((entry) => [entry.signature, entry]));
const ensureManager = functions["msg_ensure_ops_manager_user(uuid)"];
assert.equal(ensureManager.definition_md5, "b951391487f43ceade3e725dd98b2090");
assert.equal(ensureManager.security_definer, true);
assert.deepEqual(ensureManager.configuration, ["search_path=pg_catalog, public"]);
assert.equal(ensureManager.comment, null);
assert.equal(ensureManager.public_execute, false);
assert.equal(ensureManager.anon_execute, false);
assert.equal(ensureManager.authenticated_execute, false);
assert.equal(ensureManager.service_execute, true);
assert.match(ensureManager.definition, /Prefer the exact real name/);

assert.equal(
  Object.hasOwn(functions, "msg_get_or_create_ops_manager_thread(uuid)"),
  false,
  "the retired shared-room RPC must not remain callable by any role",
);

const tables = Object.fromEntries(after.tables.map((entry) => [entry.table_name, entry]));
for (const name of [
  "custodial_employee_device_assignment_history",
  "custodial_employee_status_history",
]) {
  const table = tables[name];
  assert.equal(table.rls_enabled, true, `${name} must enable RLS`);
  assert.equal(table.rls_forced, true, `${name} must force RLS`);
  assert.equal(table.public_has_crud, false, `${name} exposed CRUD to PUBLIC`);
  assert.equal(table.anon_has_crud, false, `${name} exposed CRUD to anon`);
  assert.equal(table.authenticated_has_crud, false, `${name} exposed CRUD to authenticated`);
  assert.equal(table.service_has_crud, true, `${name} is unavailable to service_role`);
}
assert.equal(
  tables.ops_manager_notification_queue.comment,
  "Durable manager mobile push queue with leasing, retry and delivery audit state.",
);

assert.deepEqual(
  after.policies.map((policy) => ({
    table_name: policy.table_name,
    policy_name: policy.policy_name,
    permissive: policy.permissive,
    roles: policy.roles,
    command: policy.cmd,
    using: policy.qual,
    check: policy.with_check,
  })),
  [
    {
      table_name: "custodial_employee_device_assignment_history",
      policy_name: "custodial_employee_device_assignment_history_service_all",
      permissive: "PERMISSIVE",
      roles: ["service_role"],
      command: "ALL",
      using: "true",
      check: "true",
    },
    {
      table_name: "custodial_employee_status_history",
      policy_name: "custodial_employee_status_history_service_all",
      permissive: "PERMISSIVE",
      roles: ["service_role"],
      command: "ALL",
      using: "true",
      check: "true",
    },
  ],
);

const behavior = await sql(`
begin;
do $acceptance$
declare
  v_manager_id uuid;
  v_other_manager_id uuid;
  v_user public.msg_users%rowtype;
  v_other_user public.msg_users%rowtype;
  v_archived_thread public.msg_threads%rowtype;
begin
  select manager_id into strict v_manager_id
  from public.ops_manager_managers
  where active is true
    and revoked_at is null
    and is_system_principal is false
    and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  order by manager_id
  limit 1;

  v_user := public.msg_ensure_ops_manager_user(v_manager_id);
  if v_user.ops_manager_id <> v_manager_id or v_user.is_active is not true or v_user.role <> 'manager' then
    raise exception 'named manager identity reconciliation failed';
  end if;

  select manager_id into strict v_other_manager_id
  from public.ops_manager_managers
  where active is true
    and revoked_at is null
    and is_system_principal is false
    and manager_id <> v_manager_id
  order by manager_id
  limit 1;
  v_other_user := public.msg_ensure_ops_manager_user(v_other_manager_id);
  if v_other_user.id = v_user.id or v_other_user.ops_manager_id <> v_other_manager_id then
    raise exception 'different named managers did not retain distinct Messenger identities';
  end if;

  if to_regprocedure('public.msg_get_or_create_ops_manager_thread(uuid)') is not null then
    raise exception 'retired shared-room RPC remains available';
  end if;

  select * into strict v_archived_thread
  from public.msg_threads
  where system_key = 'ops_manager_shared_chat_v1';
  if v_archived_thread.is_active is true
     or v_archived_thread.title <> 'Operations Leadership Chat (Retired)'
     or exists (
       select 1 from public.msg_thread_participants
       where thread_id = v_archived_thread.id and left_at is null
     ) then
    raise exception 'retired shared-room archival state is not durable';
  end if;

  begin
    update public.msg_threads set is_active = true where id = v_archived_thread.id;
    raise exception 'retired shared room was reactivated';
  exception when check_violation then
    if sqlerrm not like '%must remain inactive%' then raise; end if;
  end;
  begin
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active,system_key)
    values ('group','Illegal Operations Leadership recreation',v_user.id,true,'ops_manager_shared_chat_v1');
    raise exception 'retired shared room was recreated';
  exception when check_violation then
    if sqlerrm not like '%cannot be recreated%' then raise; end if;
  end;
  begin
    insert into public.msg_thread_participants(thread_id,user_id,left_at)
    values (v_archived_thread.id,v_user.id,null);
    raise exception 'active retired shared-room participant was inserted';
  exception when check_violation then
    if sqlerrm not like '%cannot have active participants%' then raise; end if;
  end;
  begin
    update public.msg_thread_participants
    set left_at = null
    where id = (
      select id from public.msg_thread_participants
      where thread_id = v_archived_thread.id
      order by id
      limit 1
    );
    raise exception 'retired shared-room participant was restored';
  exception when check_violation then
    if sqlerrm not like '%cannot have active participants%' then raise; end if;
  end;
end
$acceptance$;
rollback;
`);
assert.equal(behavior, "ROLLBACK");

console.log("CANONICAL_SCHEMA_RECONCILIATION_DATABASE_PASS");
