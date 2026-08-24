#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";
import { STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS } from "../src/static-weekly-control-plane.js";

const execFileAsync = promisify(execFile);
const packetPath = process.argv[2];
if (!packetPath) throw new Error("Usage: static-weekly-production-database-runtime-probe.mjs <verified-packet.json>");

const container = `mz_static_weekly_production_db_probe_${process.pid}`;
const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const managerId = "10000000-0000-4000-8000-000000000001";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value, tag) => {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(`$${tag}$`), false);
  return `$${tag}$${serialized}$${tag}$::jsonb`;
};
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });

async function sql(statement) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolvePromise(stdout.trim())
      : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
    child.stdin.end(statement);
  });
}

const state = async () => JSON.parse((await sql("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'versions',(select count(*) from public.weekly_schedule_versions),'publications',(select count(*) from public.weekly_schedule_publications),'receipts',(select count(*) from public.weekly_schedule_command_receipts))::text")).split("\n").at(-1));

const packet = JSON.parse(await readFile(packetPath, "utf8"));
const compilerInput = structuredClone(packet.compilerInput);
if (compilerInput.version && !compilerInput.versions) {
  compilerInput.versions = [compilerInput.version];
  delete compilerInput.version;
}
compilerInput.serviceDate = packet.effectiveDate;
compilerInput.exceptions = [];

const runtime = createStaticWeeklyCompilerRuntime();
let removed = false;
try {
  await runtime.initialize();
  const compileStarted = performance.now();
  const draft = await runtime.compileAndPrepare(compilerInput, {
    kind: "draft",
    expectedRevision: 0,
    actor: { managerId, managerName: "Eric", idempotencyKey: "production-database-runtime-probe" },
  });
  const compileMilliseconds = Math.round(performance.now() - compileStarted);
  assert.equal(draft.document?.validation?.status, "FEASIBLE");
  assert.equal(draft.document?.receipt?.compiler?.verifier?.ok, true);
  assert.equal(draft.document?.receipt?.compiler?.independentVerification?.ok, true);

  const postgresImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
  await docker(["image", "inspect", postgresImage]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", postgresImage]);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await sql("select 1");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
      await sql("select 1");
      break;
    } catch (error) {
      if (attempt === 119) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await sql(await readFile(resolve(migrationsDir, file), "utf8"));
  }
  await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values(${quote(managerId)},'Eric',array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[],true,'{}'::jsonb,false);`);
  await sql(`begin;
set local role static_weekly_release_operator;
select public.static_weekly_v3_configure_initial_authority_key('static-weekly-authority-hmac-v2','production-database-probe-key-012345678901234567890','production-database-probe');
select public.static_weekly_v3_register_authority_source(${quote(packet.sourceId)},${json(packet.compilerInput, "source")},'production-database-probe');
select public.static_weekly_v6_initialize_registered_roster(${quote(packet.sourceId)},${quote(managerId)},'production-database-probe');
commit;`);
  await docker(["update", "--cpus", "0.10", container]);

  const call = (timeoutMs, key) => `begin;
set local role static_weekly_control_plane;
set local statement_timeout='${timeoutMs}ms';
select public.static_weekly_v3_create_draft(${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective, "objective")},${json(draft.inputProvenance, "provenance")},${json(draft.document, "document")},0,${quote(managerId)},${quote(key)},${quote(packet.sourceId)})::text;
rollback;`;

  const before = await state();
  const legacyStarted = performance.now();
  await assert.rejects(() => sql(call(30_000, "production-database-probe-legacy")), (error) => /statement timeout/i.test(`${error.stderr}\n${error.stdout}\n${error.message}`));
  const legacyTimeoutMilliseconds = Math.round(performance.now() - legacyStarted);
  assert.deepEqual(await state(), before, "the legacy 30-second cancellation must roll back every authority effect");

  const admittedStarted = performance.now();
  const admitted = await sql(call(STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS, "production-database-probe-admitted"));
  const admittedDatabaseMilliseconds = Math.round(performance.now() - admittedStarted);
  assert.match(admitted, /"revision"\s*:\s*1/);
  assert.deepEqual(await state(), before, "the admitted success probe also rolls back every disposable authority effect");
  assert.equal(compileMilliseconds + admittedDatabaseMilliseconds < 315_000, true, "compile plus database admission must fit the production request deadline");

  process.stdout.write(`${JSON.stringify({
    schema: "memphis-zoo.static-weekly-production-database-runtime-probe.v1",
    packetPath: resolve(packetPath),
    sourceId: packet.sourceId,
    sourceDigest: packet.sourceDigest,
    disposableDatabaseCpuLimit: 0.10,
    legacyStatementTimeoutMilliseconds: 30_000,
    legacyTimeoutObservedMilliseconds: legacyTimeoutMilliseconds,
    admittedStatementTimeoutMilliseconds: STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,
    compileMilliseconds,
    admittedDatabaseMilliseconds,
    combinedMilliseconds: compileMilliseconds + admittedDatabaseMilliseconds,
    requestDeadlineMilliseconds: 315_000,
    exactRollbackState: before,
    status: "PASS",
  }, null, 2)}\n`);
} finally {
  await runtime.shutdown().catch(() => {});
  await docker(["rm", "-f", container]).then(() => { removed = true; }).catch(() => {});
  if (!removed) process.stderr.write(`warning: disposable container ${container} may require cleanup\n`);
}
