#!/usr/bin/env node
// Proves that the additive reconciliation migration converges both plausible
// 20260813210000 histories without consulting or mutating any durable database.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { captureSchemaCatalog, fingerprintSchemaCatalog } from "./schema-fingerprint-catalog.mjs";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const migrationsDir = path.join(root, "supabase/migrations");
const migrationNames = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const uncertainMigration = "20260813210000_custodial_u4_ops_closure.sql";
const additiveMigration = "20260814224034_reconcile_static_weekly_day_change_receipts.sql";
const oldHistoryCommit = "3900f7db34ba8ed9aa7a743db4a2dee112e82c4c";
const image = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 64 * 1024 * 1024, ...options });

assert.equal(migrationNames.at(-1), additiveMigration, "the reconciliation migration must remain the terminal local migration during this focused proof");
await execFileAsync("git", ["merge-base", "--is-ancestor", oldHistoryCommit, "HEAD"], { cwd: root });
const oldUncertainBody = (await execFileAsync("git", ["show", `${oldHistoryCommit}:supabase/migrations/${uncertainMigration}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;
const preservedUncertainBody = fs.readFileSync(path.join(migrationsDir, uncertainMigration), "utf8");
assert.notEqual(oldUncertainBody, preservedUncertainBody, "old and preserved U4 migration histories must remain distinct fixtures");

async function psql(container, statement) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
    child.stdin.end(statement);
  });
}

async function captureHistory(label, useOldUncertainBody) {
  const container = `mz_u4_convergence_${label}_${process.pid}`;
  let pool = null;
  try {
    await docker(["image", "inspect", image]);
    await docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", image, "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements", "-c", "listen_addresses=*"]);
    let ready = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        const logs = (await docker(["logs", container])).stdout;
        if (logs.includes("PostgreSQL init process complete; ready for start up.")) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          await psql(container, "select 1");
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, `${label} disposable PostgreSQL must start`);
    await psql(container, "do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
    for (const name of migrationNames) {
      if (useOldUncertainBody && name === additiveMigration) {
        await psql(container, "alter role supabase_admin password 'postgres'");
        const compatibilityPort = Number((await docker(["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1));
        const compatibilityPool = new Pool({ connectionString: `postgres://supabase_admin:postgres@127.0.0.1:${compatibilityPort}/postgres`, max: 2, connectionTimeoutMillis: 10_000 });
        try {
          const before = (await compatibilityPool.query("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'exceptions',(select count(*) from public.weekly_schedule_exception_commands),'receipts',(select count(*) from public.weekly_schedule_command_receipts)) as state")).rows[0].state;
          let compilerCalls = 0;
          const currentRuntime = createStaticWeeklyControlPlane({
            database: compatibilityPool,
            compiler: async () => { compilerCalls += 1; throw new Error("new runtime must not compile against the old schema"); },
            initializeSolver: async () => ({}),
            getSolverReadiness: () => ({ available: true }),
          });
          await assert.rejects(() => currentRuntime.health(), (error) => error?.code === "42883", "new runtime readiness must fail closed when the day-change capability migration is absent");
          await assert.rejects(() => currentRuntime.applyDayChanges({
            manager: { manager_id: "10000000-0000-4000-8000-000000000081", manager_display_name: "Compatibility Manager" },
            serviceDate: "2026-11-03", projectionWeekStart: "2026-11-02",
            baseVersionId: "60000000-0000-4000-8000-000000000081", versionId: "60000000-0000-4000-8000-000000000081",
            publicationId: "70000000-0000-4000-8000-000000000081", expectedRevision: 0, idempotencyKey: "compatibility-day-change",
            operations: [{ operation: "exception", exceptionType: "pto", reason: "compatibility proof", payload: { slotId: "20000000-0000-4000-8000-000000000081" } }],
          }), (error) => error?.code === "42883", "new runtime mutation must stop at the missing database capability before source reads or child writes");
          const after = (await compatibilityPool.query("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'exceptions',(select count(*) from public.weekly_schedule_exception_commands),'receipts',(select count(*) from public.weekly_schedule_command_receipts)) as state")).rows[0].state;
          assert.deepEqual(after, before, "new-runtime/old-schema incompatibility must be fail-closed and mutation-free");
          assert.equal(compilerCalls, 0, "new-runtime/old-schema incompatibility must stop before compilation");
        } finally {
          await compatibilityPool.end();
        }
      }
      const body = useOldUncertainBody && name === uncertainMigration ? oldUncertainBody : fs.readFileSync(path.join(migrationsDir, name), "utf8");
      await psql(container, body);
    }
    await psql(container, "alter role supabase_admin password 'postgres'");
    const port = Number((await docker(["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1));
    pool = new Pool({ connectionString: `postgres://supabase_admin:postgres@127.0.0.1:${port}/postgres`, max: 2, connectionTimeoutMillis: 10_000 });
    const catalog = fingerprintSchemaCatalog(await captureSchemaCatalog(pool));
    const { rows: [capability] } = await pool.query(`
      select
        exists(select 1 from pg_attribute where attrelid='public.custodial_offline_actor_contexts'::regclass and attname='native_finish_scan_entry_id' and attnum>0 and not attisdropped) as finish_column,
        exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='custodial_offline_native_completion_evidence_check') as finish_check,
        exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='uq_custodial_offline_native_finish_scan_entry') as finish_unique,
        to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text)') is null as old_commit_absent,
        to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)') is not null as final_commit_present,
        to_regprocedure('public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)') is not null as batch_gate_present,
        to_regprocedure('public.static_weekly_v3_apply_exception(text,date,time without time zone,time without time zone,uuid,uuid,text,jsonb,bigint,uuid,text,uuid)') is not null
          and to_regprocedure('public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)') is not null
          and to_regprocedure('public.static_weekly_v3_read_publication_source(uuid,date)') is not null as old_runtime_functions_preserved,
        not has_function_privilege('anon','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
          and not has_function_privilege('authenticated','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
          and not has_function_privilege('service_role','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
          and has_function_privilege('static_weekly_control_plane','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE') as batch_gate_least_privilege
    `);
    assert.equal(Object.values(capability).every(Boolean), true, `${label} history must expose only the final native and scheduler authorities`);
    const { rows: inventory } = await pool.query("select object_kind,object_identity,definition_sha256 from public.custodial_release_authority_restore_inventory order by object_kind,object_identity");
    return { fingerprint: catalog.fingerprint, inventory, capability };
  } finally {
    if (pool) await pool.end().catch(() => {});
    await docker(["rm", "-f", container]).catch(() => {});
  }
}

const oldLedger = await captureHistory("old", true);
const preservedLedger = await captureHistory("preserved", false);
assert.equal(oldLedger.fingerprint, preservedLedger.fingerprint, "old-ledger plus additive and preserved-ledger plus additive must converge on one catalog fingerprint");
assert.deepEqual(oldLedger.inventory, preservedLedger.inventory, "both histories must converge on one exact release recovery inventory");
assert.deepEqual(oldLedger.capability, preservedLedger.capability, "both histories must expose identical bounded capabilities");
console.log(JSON.stringify({
  ok: true,
  old_history: `${uncertainMigration}@${oldHistoryCommit} + ${additiveMigration}`,
  preserved_history: `${uncertainMigration}@HEAD + ${additiveMigration}`,
  converged_schema_fingerprint: oldLedger.fingerprint,
  recovery_inventory_entries: oldLedger.inventory.length,
}, null, 2));
