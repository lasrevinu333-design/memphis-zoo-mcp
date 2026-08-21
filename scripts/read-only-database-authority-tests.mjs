#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Pool } from "pg";
import { runReadOnlySql } from "../src/supabase/read.js";

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
const readSource = await readFile(new URL("../src/supabase/read.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
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
alter table public.rls_fixture enable row level security;
insert into public.read_fixture values (1,'visible');
insert into public.rls_fixture values (1);

create or replace function public.run_sql_readonly(text) returns jsonb
language plpgsql security definer as $$ begin return '[]'::jsonb; end $$;
grant execute on function public.run_sql_readonly(text) to service_role;

create or replace function public.dangerous_mutation() returns integer
language plpgsql security definer as $$ begin insert into public.mutation_fixture values (1); return 1; end $$;
grant execute on function public.dangerous_mutation() to public;

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
  await psql(String.raw`
    create role custodial_readonly_test login password 'read-test-only' inherit;
    grant custodial_application_reader to custodial_readonly_test;
    create role custodial_overprivileged_test login password 'overprivileged-test' superuser;
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

  await assert.rejects(
    () => runReadOnlySql({ pool: privilegedPool, sql: "select 1 as should_never_be_served" }),
    (error) => error?.code === "read_authority_not_dedicated",
    "an overprivileged DSN must be rejected before application read SQL is served",
  );

  const legitimate = await runReadOnlySql({ pool, sql: "select id,label from public.read_fixture order by id" });
  assert.deepEqual(legitimate.rows, [{ id: 1, label: "visible" }]);

  const withQuery = await runReadOnlySql({ pool, sql: "with item as (select 7::integer as value) select value from item" });
  assert.deepEqual(withQuery.rows, [{ value: 7 }]);

  const explain = await runReadOnlySql({ pool, sql: "explain select * from public.read_fixture" });
  assert.equal(explain.rows.length > 0, true);

  const rls = await runReadOnlySql({ pool, sql: "select * from public.rls_fixture" });
  assert.deepEqual(rls.rows, [], "reader must not bypass RLS");

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
      'service_proxy',has_function_privilege('service_role','public.run_sql_readonly(text)','execute')
    )::text
    from pg_roles r where r.rolname='custodial_application_reader';
  `);
  assert.deepEqual(JSON.parse(authority), {
    superuser: false,
    bypassrls: false,
    can_insert: false,
    service_proxy: false,
  });

  console.log("Read-only database authority tests passed.");
} finally {
  await pool?.end().catch(() => {});
  await privilegedPool?.end().catch(() => {});
  await docker(["rm", "-f", container]).catch(() => {});
}
