#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Pool } from "pg";
import { createReadOnlyPool, runReadOnlySql } from "../src/supabase/read.js";
import { SCHEMA_CATALOG_QUERIES } from "./schema-fingerprint-catalog.mjs";

const execFileAsync = promisify(execFile);
const image = process.env.SCHEMA_REBUILD_DOCKER_IMAGE
  || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const container = `mz_read_authority_${process.pid}`;
const migration = await readFile(new URL(
  "../supabase/migrations/20260820133000_create_application_read_authority.sql",
  import.meta.url,
), "utf8");
const retirementMigration = await readFile(new URL(
  "../supabase/migrations/20260820133100_retire_owner_sql_proxy.sql",
  import.meta.url,
), "utf8");
const cronCatalogMigration = await readFile(new URL(
  "../supabase/migrations/20260822142500_grant_readonly_cron_catalog_observation.sql",
  import.meta.url,
), "utf8");
const relationAuthorityFenceMigration = await readFile(new URL(
  "../supabase/migrations/20260822150000_fence_application_reader_relation_authority.sql",
  import.meta.url,
), "utf8");
const cronIdentityBridgeMigration = await readFile(new URL(
  "../supabase/migrations/20260822153000_bridge_cron_identity_and_rebind_recovery_acl.sql",
  import.meta.url,
), "utf8");
const deviceIdentityReadMigration = await readFile(new URL(
  "../supabase/migrations/20260825173000_restore_application_reader_device_identity.sql",
  import.meta.url,
), "utf8");
const readSource = await readFile(new URL("../src/supabase/read.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const supabaseRootCa = await readFile(new URL("../certs/supabase-root-2021-ca.pem", import.meta.url), "utf8");
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 16 * 1024 * 1024, ...options });

assert.doesNotMatch(readSource, /\.rpc\(["']run_sql_readonly["']/,
  "application reads must not use the owner-authority RPC proxy");
assert.match(readSource, /begin isolation level repeatable read read only/i);
assert.match(readSource, /set local row_security = on/i);
assert.match(readSource, /assertDedicatedReadAuthority\(client\)/,
  "every application read transaction must prove the dedicated restricted login before caller SQL");
assert.match(indexSource, /read_authority_ready:\s*readAuthorityReady/,
  "production health must expose the dedicated reader boundary");
assert.match(retirementMigration, /revoke all privileges on function public\.run_sql_readonly\(text\)[\s\S]*service_role/i);
assert.doesNotMatch(
  migration,
  /alter\s+role\s+custodial_application_reader[\s\S]{0,200}\b(?:nosuperuser|noreplication|nobypassrls)\b/i,
  "managed Supabase migrations must not attempt superuser-only ALTER ROLE attributes",
);
assert.match(
  migration,
  /reader\.rolsuper\s+or\s+reader\.rolreplication\s+or\s+reader\.rolbypassrls[\s\S]*raise exception/i,
  "an existing reader role with forbidden authority must fail closed",
);
assert.equal(
  new X509Certificate(supabaseRootCa).fingerprint256.replaceAll(":", "").toLowerCase(),
  "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa",
  "the checked-in Supabase root CA must match the admitted production trust anchor",
);

class CapturingPool {
  constructor(options) {
    this.options = options;
  }
}

const typedPool = createReadOnlyPool({
  connectionString: "postgres://reader:example@127.0.0.1:5432/postgres",
  PoolClass: CapturingPool,
});
assert.equal(
  typedPool.options.types.getTypeParser(1082, "text")("2026-08-22"),
  "2026-08-22",
  "the dedicated reader must preserve PostgreSQL DATE as timezone-free YYYY-MM-DD text",
);

async function psql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
    child.stdin.end(statement);
  });
}

const fixtureSql = String.raw`
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create table public.read_fixture(id integer primary key, label text not null);
create table public.mutation_fixture(id integer primary key);
create table public.rls_fixture(id integer primary key);
create table public.employees(
  id uuid primary key,
  employee_code text not null,
  display_name text not null,
  active boolean not null,
  role text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.devices(
  id uuid primary key,
  device_id text not null,
  device_name text,
  active boolean not null,
  assigned_employee_id uuid references public.employees(id),
  notes text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assignment_epoch bigint not null default 1
);
create table public.device_aliases(
  alias_identifier text primary key,
  canonical_device_id uuid not null references public.devices(id),
  active boolean not null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.device_auth_credentials(
  credential_id uuid primary key,
  device_id uuid not null references public.devices(id),
  token_hash text not null
);
create table public.custodial_session_corrections(id uuid primary key);
create view public.v_custodial_cleaning_session_truth as select id from public.custodial_session_corrections;
create schema cron;
create table cron.job(
  jobname text not null,
  schedule text not null,
  command text not null,
  database text not null,
  username text not null,
  active boolean not null
);
insert into cron.job values ('fixture-job','0 * * * *','select 1','postgres','postgres',true);
grant select on table cron.job to public;
alter table cron.job enable row level security;
create policy cron_job_policy on cron.job using (username=current_user);
alter table public.rls_fixture enable row level security;
alter table public.employees enable row level security;
alter table public.employees force row level security;
alter table public.devices enable row level security;
alter table public.devices force row level security;
alter table public.device_aliases enable row level security;
alter table public.device_aliases force row level security;
alter table public.device_auth_credentials enable row level security;
alter table public.device_auth_credentials force row level security;
insert into public.read_fixture values (1,'visible');
insert into public.rls_fixture values (1);
insert into public.employees(id,employee_code,display_name,active,role,notes)
values ('11111111-1111-4111-8111-111111111111','EMP007','Karen Robinson',true,'staff','private employee note');
insert into public.devices(id,device_id,device_name,active,assigned_employee_id,notes,assignment_epoch)
values ('22222222-2222-4222-8222-222222222222','KIOSK_08','Karen Robinson',true,'11111111-1111-4111-8111-111111111111','private device note',1);
insert into public.device_aliases(alias_identifier,canonical_device_id,active,source)
values ('a7b69ce3-dc662d3d','22222222-2222-4222-8222-222222222222',true,'fixture');
insert into public.device_auth_credentials(credential_id,device_id,token_hash)
values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','must-remain-hidden');

create or replace function public.run_sql_readonly(text) returns jsonb
language plpgsql security definer as $$ begin return '[]'::jsonb; end $$;
grant execute on function public.run_sql_readonly(text) to service_role;

create or replace function public.dangerous_mutation() returns integer
language plpgsql security definer as $$ begin insert into public.mutation_fixture values (1); return 1; end $$;
grant execute on function public.dangerous_mutation() to public;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.custodial_release_authority_restore_inventory(
  object_kind text not null,
  object_identity text not null,
  definition_sql text not null,
  definition_sha256 text not null,
  captured_at timestamptz not null default statement_timestamp(),
  primary key(object_kind,object_identity)
);
create or replace function public.custodial_release_authority_current_grant_definition(text)
returns text language sql stable as $$
  select $1||':'||has_table_privilege('custodial_application_reader',$1,'select')::text
$$;
create or replace function public.custodial_release_inventory_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then raise exception 'immutable'; end if;
  return new;
end
$$;
create trigger trg_custodial_release_authority_restore_inventory_immutable
before update or delete on public.custodial_release_authority_restore_inventory
for each row execute function public.custodial_release_inventory_immutable();

create or replace function public.msg_get_memphis_thread_context(uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.msg_get_memphis_user_id() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.msg_get_user_by_device(text) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.msg_list_users(uuid) returns table(id uuid) language sql stable security definer as $$ select null::uuid where false $$;
create or replace function public.sch2_compare_current_vs_preview(uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch2_explain_assignment(uuid,uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch_absence_preview(date,uuid[]) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch_audit_schedule_day(date) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch_employee_my_schedule_page(date,uuid,timestamptz) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch_extract_lunch_end(text) returns time language sql immutable as $$ select null::time $$;
create or replace function public.sch_extract_lunch_start(text) returns time language sql immutable as $$ select null::time $$;
create or replace function public.sch_get_coverage_candidates(date,uuid,time,time) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.sch_get_current_owner(text,timestamptz) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.sch_get_daily_schedule_with_purpose(date) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.sch_get_employee_work_status(date,uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function public.sch_get_schedule_close_time(date) returns time language sql stable as $$ select null::time $$;
create or replace function public.sch_is_employee_location_group_restricted(uuid,uuid,integer) returns boolean language sql stable as $$ select false $$;
create or replace function public.sch_is_public_restroom_group(uuid) returns boolean language sql stable as $$ select false $$;
create or replace function public.sch_list_location_workload_settings() returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
create or replace function public.sch_resolve_employee_ref(text) returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.sch_service_date(timestamptz) returns date language sql stable as $$ select current_date $$;
create or replace function public.sch_validate_operational_schedule_rules(date,date) returns table(ok boolean) language sql stable as $$ select true $$;
create or replace function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) returns jsonb language sql stable security definer as $$ select '{}'::jsonb $$;
create or replace function public.tool_admin_bundle(integer,integer,integer,integer,integer) returns jsonb language sql stable security definer as $$ select '{}'::jsonb $$;
`;

let pool;
let privilegedPool;
let extraMembershipPool;
let directGrantPool;
try {
  await docker(["image", "inspect", image]);
  await docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m", "-e", "POSTGRES_PASSWORD=postgres", image, "-c", "listen_addresses=*"]);

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const logs = (await docker(["logs", container])).stdout;
      if (logs.includes("PostgreSQL init process complete; ready for start up.")) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await psql("select 1;");
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(ready, true, "owned disposable PostgreSQL must start");

  await psql(fixtureSql);
  await psql(migration);
  await psql(cronCatalogMigration);
  await psql(String.raw`
    insert into public.custodial_release_authority_restore_inventory(
      object_kind,object_identity,definition_sql,definition_sha256
    )
    select 'grant','public.custodial_session_corrections',definition,
      encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
    from (
      select public.custodial_release_authority_current_grant_definition(
        'public.custodial_session_corrections'
      ) definition
    ) captured;
  `);
  await psql(relationAuthorityFenceMigration);
  await psql(cronIdentityBridgeMigration);
  await psql(deviceIdentityReadMigration);
  await psql("create table public.reader_future_fixture(id integer primary key);");
  await psql(String.raw`
    create role custodial_readonly_test login password 'read-test-only' inherit;
    grant custodial_application_reader to custodial_readonly_test;
    create role custodial_overprivileged_test login password 'overprivileged-test' superuser;
    create role custodial_extra_read_role nologin;
    create role custodial_extra_membership_test login password 'extra-membership-test' inherit;
    grant custodial_application_reader, custodial_extra_read_role to custodial_extra_membership_test;
    create role custodial_direct_grant_test login password 'direct-grant-test' inherit;
    grant custodial_application_reader to custodial_direct_grant_test;
    grant select on public.mutation_fixture to custodial_direct_grant_test;
    create role custodial_readonly_runtime_20991231 login password 'runtime-test-only' inherit;
    alter role custodial_readonly_runtime_20991231 set default_transaction_read_only = on;
    alter role custodial_readonly_runtime_20991231 set statement_timeout = '15s';
    alter role custodial_readonly_runtime_20991231 set idle_in_transaction_session_timeout = '15s';
    grant custodial_application_reader to custodial_readonly_runtime_20991231;
    grant custodial_readonly_runtime_20991231 to supabase_admin with admin option;
    create role custodial_readonly_runtime_20991230 login password 'runtime-extra-test-only' inherit;
    grant custodial_application_reader, custodial_extra_read_role to custodial_readonly_runtime_20991230;
    grant custodial_readonly_runtime_20991230 to supabase_admin with admin option;
  `);
  await psql(retirementMigration);

  const port = Number((await docker(["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1));
  pool = new Pool({
    connectionString: `postgres://custodial_readonly_test:read-test-only@127.0.0.1:${port}/postgres`,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });

  privilegedPool = new Pool({
    connectionString: `postgres://custodial_overprivileged_test:overprivileged-test@127.0.0.1:${port}/postgres`,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  extraMembershipPool = new Pool({
    connectionString: `postgres://custodial_extra_membership_test:extra-membership-test@127.0.0.1:${port}/postgres`,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  directGrantPool = new Pool({
    connectionString: `postgres://custodial_direct_grant_test:direct-grant-test@127.0.0.1:${port}/postgres`,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  await assert.rejects(
    () => runReadOnlySql({ pool: privilegedPool, sql: "select 1 as should_never_be_served" }),
    (error) => error?.code === "read_authority_not_dedicated",
    "an overprivileged DSN must be rejected before application read SQL is served",
  );

  await assert.rejects(
    () => runReadOnlySql({ pool: extraMembershipPool, sql: "select 1 as should_never_be_served" }),
    (error) => error?.code === "read_authority_not_dedicated",
    "a reader login with any additional inherited role must be rejected",
  );

  await assert.rejects(
    () => runReadOnlySql({ pool: directGrantPool, sql: "select 1 as should_never_be_served" }),
    (error) => error?.code === "read_authority_not_dedicated",
    "a reader login with direct object grants must be rejected",
  );

  const legitimate = await runReadOnlySql({ pool, sql: "select id,label from public.read_fixture order by id" });
  assert.deepEqual(legitimate.rows, [{ id: 1, label: "visible" }]);

  const cronCatalog = await runReadOnlySql({
    pool,
    sql: SCHEMA_CATALOG_QUERIES.cron_jobs,
  });
  assert.deepEqual(cronCatalog.rows, [{
    jobname: "fixture-job",
    schedule: "0 * * * *",
    command: "select 1",
    database: "postgres",
    username: "migration_owner",
    active: true,
  }], "the dedicated reader must observe exactly the admitted pg_cron catalog columns");

  const directCronCatalog = await runReadOnlySql({ pool, sql: "select jobname from cron.job" });
  assert.deepEqual(
    directCronCatalog.rows,
    [],
    "the provider-managed cron policy must hide every job from a direct reader query",
  );

  const withQuery = await runReadOnlySql({ pool, sql: "with item as (select 7::integer as value) select value from item" });
  assert.deepEqual(withQuery.rows, [{ value: 7 }]);

  const explain = await runReadOnlySql({ pool, sql: "explain select * from public.read_fixture" });
  assert.equal(explain.rows.length > 0, true);

  const rls = await runReadOnlySql({ pool, sql: "select * from public.rls_fixture" });
  assert.deepEqual(rls.rows, [], "reader must not bypass RLS");

  const canonicalDevice = await runReadOnlySql({ pool, sql: `
    select d.id, d.device_id, d.device_name, d.active, d.assigned_employee_id,
           d.assignment_epoch, e.display_name, e.employee_code, e.active as employee_active
    from public.devices d
    join public.employees e on e.id = d.assigned_employee_id
    where d.device_id = 'KIOSK_08'
  ` });
  assert.deepEqual(canonicalDevice.rows, [{
    id: "22222222-2222-4222-8222-222222222222",
    device_id: "KIOSK_08",
    device_name: "Karen Robinson",
    active: true,
    assigned_employee_id: "11111111-1111-4111-8111-111111111111",
    assignment_epoch: "1",
    display_name: "Karen Robinson",
    employee_code: "EMP007",
    employee_active: true,
  }], "the restricted reader must resolve the exact enrolled phone identity through forced RLS");

  const alias = await runReadOnlySql({ pool, sql: `
    select alias_identifier, canonical_device_id, active
    from public.device_aliases
    where alias_identifier = 'a7b69ce3-dc662d3d'
  ` });
  assert.deepEqual(alias.rows, [{
    alias_identifier: "a7b69ce3-dc662d3d",
    canonical_device_id: "22222222-2222-4222-8222-222222222222",
    active: true,
  }], "the restricted reader must resolve an admitted hardware alias through forced RLS");

  await assert.rejects(
    () => runReadOnlySql({ pool, sql: "select notes from public.devices" }),
    (error) => error?.code === "42501",
    "the device identity policy must not expose device notes",
  );
  await assert.rejects(
    () => runReadOnlySql({ pool, sql: "select notes from public.employees" }),
    (error) => error?.code === "42501",
    "the employee identity policy must not expose employee notes",
  );
  const credentials = await runReadOnlySql({ pool, sql: "select token_hash from public.device_auth_credentials" });
  assert.deepEqual(credentials.rows, [], "the identity policy must not expose credential material through forced RLS");

  await assert.rejects(
    () => runReadOnlySql({ pool, sql: "select public.dangerous_mutation()" }),
    (error) => error?.code === "25006",
    "SELECT-shaped calls to mutating definer functions must fail in the database",
  );

  const mutationCount = await psql("select count(*) from public.mutation_fixture;");
  assert.equal(mutationCount, "0", "failed confused-deputy call must leave no side effect");

  const authority = await psql(String.raw`
    select json_build_object(
      'superuser',r.rolsuper,
      'bypassrls',r.rolbypassrls,
      'can_insert',has_table_privilege('custodial_application_reader','public.mutation_fixture','insert'),
      'cron_usage',has_schema_privilege('custodial_application_reader','cron','usage'),
      'cron_create',has_schema_privilege('custodial_application_reader','cron','create'),
      'cron_insert',has_table_privilege('custodial_application_reader','cron.job','insert'),
      'cron_public_select',has_table_privilege('custodial_application_reader','cron.job','select'),
      'cron_explicit_column_grants',exists(
        select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl
        join pg_roles grantee on grantee.oid=acl.grantee
        where a.attrelid='cron.job'::regclass and grantee.rolname='custodial_application_reader'
          and acl.privilege_type='SELECT'
      ),
      'cron_bridge',has_function_privilege('custodial_application_reader','custodial_release_identity.custodial_schema_identity_cron_jobs()','execute'),
      'anon_cron_bridge',has_function_privilege('anon','custodial_release_identity.custodial_schema_identity_cron_jobs()','execute'),
      'correction_table_select',has_table_privilege('custodial_application_reader','public.custodial_session_corrections','select'),
      'correction_view_select',has_table_privilege('custodial_application_reader','public.v_custodial_cleaning_session_truth','select'),
      'future_table_select',has_table_privilege('custodial_application_reader','public.reader_future_fixture','select'),
      'service_proxy',has_function_privilege('service_role','public.run_sql_readonly(text)','execute')
    )::text
    from pg_roles r where r.rolname='custodial_application_reader';
  `);
  assert.deepEqual(JSON.parse(authority), {
    superuser: false,
    bypassrls: false,
    can_insert: false,
    cron_usage: true,
    cron_create: false,
    cron_insert: false,
    cron_public_select: true,
    cron_explicit_column_grants: false,
    cron_bridge: true,
    anon_cron_bridge: false,
    correction_table_select: false,
    correction_view_select: false,
    future_table_select: false,
    service_proxy: false,
  });

  const normalizedMemberships = JSON.parse(await psql(`
    select coalesce(json_agg(row_to_json(memberships)), '[]'::json)::text
    from (${SCHEMA_CATALOG_QUERIES.role_memberships}) memberships;
  `));
  assert.equal(
    normalizedMemberships.some((row) => row.granted_role === "custodial_readonly_runtime_20991231"),
    false,
    "the safe managed-owner membership for a dedicated runtime login must not alter schema identity",
  );
  assert.equal(
    normalizedMemberships.some((row) => row.granted_role === "custodial_readonly_runtime_20991230"),
    false,
    "the safe managed-owner membership remains provisioning state even when another inherited role must be reported",
  );
  assert.equal(
    normalizedMemberships.some((row) => row.granted_role === "custodial_extra_read_role" && row.member_role === "custodial_readonly_runtime_20991230"),
    true,
    "an extra role inherited by a dedicated runtime login must remain fingerprinted",
  );

  console.log("Read-only database authority tests passed.");
} finally {
  await pool?.end().catch(() => {});
  await privilegedPool?.end().catch(() => {});
  await extraMembershipPool?.end().catch(() => {});
  await directGrantPool?.end().catch(() => {});
  await docker(["rm", "-f", container]).catch(() => {});
}
