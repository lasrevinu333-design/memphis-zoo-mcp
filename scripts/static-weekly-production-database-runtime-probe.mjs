#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createStaticWeeklyCompilerRuntime } from "../src/static-weekly-schedule-compiler-runtime.js";
import { STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS } from "../src/static-weekly-control-plane.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "../src/static-weekly-schedule-database-adapter.js";

const execFileAsync = promisify(execFile);
const packetPath = process.argv[2];
if (!packetPath) throw new Error("Usage: static-weekly-production-database-runtime-probe.mjs <verified-packet.json>");

const container = `mz_static_weekly_production_db_probe_${process.pid}`;
const dataVolume = `${container}_data`;
const databaseMemoryMb = Number.parseInt(process.env.STATIC_WEEKLY_DATABASE_PROBE_MEMORY_MB || "0", 10);
if (!Number.isSafeInteger(databaseMemoryMb) || databaseMemoryMb < 0) throw new Error("STATIC_WEEKLY_DATABASE_PROBE_MEMORY_MB must be a non-negative integer");
const skipLegacyTimeout = process.env.STATIC_WEEKLY_DATABASE_PROBE_SKIP_LEGACY_TIMEOUT === "1";
const draftCachePath = process.env.STATIC_WEEKLY_DATABASE_PROBE_DRAFT_CACHE || "";
const probeStage = process.env.STATIC_WEEKLY_DATABASE_PROBE_STAGE || "full";
if (!["full", "attestation", "compiler", "document", "attested", "publication"].includes(probeStage)) throw new Error("STATIC_WEEKLY_DATABASE_PROBE_STAGE is invalid");
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
    // psql may close stdin before Node finishes writing a multi-megabyte
    // statement. The child close event carries the authoritative SQL error;
    // consume EPIPE here so it cannot replace that diagnostic.
    child.stdin.on("error", () => {});
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
  let draft;
  let compiled;
  let compileMilliseconds = 0;
  if (draftCachePath && probeStage !== "publication") {
    draft = await readFile(draftCachePath, "utf8").then(JSON.parse).catch(() => null);
  }
  if (!draft) {
    await runtime.initialize();
    const compileStarted = performance.now();
    if (probeStage === "publication") {
      compiled = await runtime.compile(compilerInput);
      draft = createStaticWeeklyDraftRpcInput({
        result: compiled,
        expectedRevision: 0,
        actor: { managerId, managerName: "Eric", idempotencyKey: "production-database-runtime-probe" },
      });
    } else {
      draft = await runtime.compileAndPrepare(compilerInput, {
        kind: "draft",
        expectedRevision: 0,
        actor: { managerId, managerName: "Eric", idempotencyKey: "production-database-runtime-probe" },
      });
    }
    compileMilliseconds = Math.round(performance.now() - compileStarted);
    if (draftCachePath) await writeFile(draftCachePath, `${JSON.stringify(draft)}\n`, { mode: 0o600, flag: "wx" });
  }
  assert.equal(draft.document?.validation?.status, "FEASIBLE");
  assert.equal(draft.document?.receipt?.compiler?.verifier?.ok, true);
  assert.equal(draft.document?.receipt?.compiler?.independentVerification?.ok, true);
  assert.equal(draft.effectiveStart, packet.effectiveDate, "a cached draft must target the packet effective date");
  assert.equal(draft.document?.authority?.baselineInputDigest, packet.sourceDigest, "a cached draft must bind the exact verified source packet");

  const postgresImage = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
  await docker(["image", "inspect", postgresImage]);
  const databaseStorage = databaseMemoryMb > 0
    ? ["--mount", `type=volume,source=${dataVolume},target=/var/lib/postgresql/data`]
    : ["--tmpfs", "/var/lib/postgresql/data:rw,size=1g"];
  await docker(["run", "--rm", "-d", "--name", container, ...databaseStorage, "-e", "POSTGRES_PASSWORD=postgres", postgresImage]);
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
  const runtimeLimits = ["update", "--cpus", "0.10"];
  if (databaseMemoryMb > 0) runtimeLimits.push("--memory", `${databaseMemoryMb}m`, "--memory-swap", `${databaseMemoryMb}m`);
  runtimeLimits.push(container);
  await docker(runtimeLimits);

  probe: {
    if (probeStage === "publication") {
      assert.ok(compiled, "the publication gate must retain the exact verified compiler result");
      const initial = await state();
      assert.deepEqual(initial, { revision: 0, versions: 0, publications: 0, receipts: 0 });
      const createStarted = performance.now();
      const created = JSON.parse((await sql(`begin;
set local role static_weekly_control_plane;
set local statement_timeout='${STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS}ms';
select public.static_weekly_v3_create_draft(${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective, "publication_objective")},${json(draft.inputProvenance, "publication_provenance")},${json(draft.document, "publication_document")},0,${quote(managerId)},'production-publication-draft',${quote(packet.sourceId)})::text;
commit;`)).split("\n").find((line) => line.startsWith("{")));
      const createMilliseconds = Math.round(performance.now() - createStarted);
      assert.equal(created.revision, 1);

      const published = JSON.parse((await sql(`begin;
set local role static_weekly_control_plane;
set local statement_timeout='${STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS}ms';
select public.static_weekly_v3_publish_draft(${quote(created.data.version_id)},1,1,${quote(managerId)},'production-publication-publish','publish',null)::text;
commit;`)).split("\n").find((line) => line.startsWith("{")));
      assert.equal(published.revision, 2);

      const projectionInput = createStaticWeeklyProjectionRpcInput({
        result: compiled,
        publicationId: published.data.publication_id,
        expectedRevision: 2,
        actor: { managerId, managerName: "Eric", idempotencyKey: "production-publication-projection" },
      });
      const compactEnvelopeBytes = Buffer.byteLength(JSON.stringify(projectionInput.envelope));
      const projectionStarted = performance.now();
      const projection = JSON.parse((await sql(`begin;
set local role static_weekly_control_plane;
set local statement_timeout='${STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS}ms';
select public.static_weekly_v3_materialize_projection(${quote(projectionInput.publicationId)},${quote(projectionInput.serviceDate)},${quote(projectionInput.exceptionSetDigest)},${quote(projectionInput.compilerVersion)},${json(projectionInput.objective, "publication_projection_objective")},${json(projectionInput.metrics, "publication_projection_metrics")},${quote(projectionInput.replayDigest)},${json(projectionInput.envelope, "publication_projection_envelope")},2,${quote(managerId)},'production-publication-projection')::text;
commit;`)).split("\n").find((line) => line.startsWith("{")));
      const projectionMilliseconds = Math.round(performance.now() - projectionStarted);
      assert.equal(projection.revision, 3);
      const final = JSON.parse(await sql(`select jsonb_build_object(
        'revision',(select current_revision from public.static_weekly_schedule_control where singleton),
        'versions',(select count(*) from public.weekly_schedule_versions),
        'publications',(select count(*) from public.weekly_schedule_publications),
        'projections',(select count(*) from public.weekly_schedule_compiled_projections),
        'occurrences',(select count(*) from public.weekly_schedule_occurrences),
        'receipts',(select count(*) from public.weekly_schedule_command_receipts)
      )::text`));
      assert.deepEqual(final, { revision: 3, versions: 1, publications: 1, projections: 1, occurrences: compiled.weeklyAssignments.length, receipts: 3 });
      assert.equal(projectionMilliseconds < STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS, true);
      process.stdout.write(`${JSON.stringify({
        schema: "memphis-zoo.static-weekly-production-publication-database-probe.v1",
        packetPath: resolve(packetPath),
        sourceId: packet.sourceId,
        sourceDigest: packet.sourceDigest,
        assignments: compiled.weeklyAssignments.length,
        compactEnvelopeBytes,
        compileMilliseconds,
        createMilliseconds,
        projectionMilliseconds,
        admittedStatementTimeoutMilliseconds: STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,
        exactFinalState: final,
        status: "PASS",
      }, null, 2)}\n`);
      break probe;
    }

    if (probeStage !== "full") {
      const document = json(draft.document, "stage_document");
      const stageStatement = {
        attestation: `select public.static_weekly_v6_issue_document_attestation(${document})::text`,
        compiler: `select public.static_weekly_assert_compiler_authority(${document}->'authority',${document}->'receipt',${quote(draft.effectiveStart)},true)`,
        document: `select public.static_weekly_assert_document(jsonb_set(${document}-'semantic_snapshot','{validation,database_document_identity}',to_jsonb(public.static_weekly_document_identity(${document}-'semantic_snapshot')),true),${quote(draft.effectiveStart)},true)`,
        attested: `do $stage$ declare v_document jsonb:=${document}; begin v_document:=jsonb_set(v_document,'{attestation}',public.static_weekly_v6_issue_document_attestation(v_document),true); perform public.static_weekly_assert_document_attested(v_document,${quote(draft.effectiveStart)},true); end $stage$`,
      }[probeStage];
      const stageStarted = performance.now();
      await sql(`begin; set local statement_timeout='${STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS}ms'; ${stageStatement}; rollback;`);
      process.stdout.write(`${JSON.stringify({ schema: "memphis-zoo.static-weekly-production-database-stage-probe.v1", probeStage, databaseMemoryMb, stageMilliseconds: Math.round(performance.now() - stageStarted), status: "PASS" }, null, 2)}\n`);
      break probe;
    }

    const call = (timeoutMs, key) => `begin;
set local role static_weekly_control_plane;
set local statement_timeout='${timeoutMs}ms';
select public.static_weekly_v3_create_draft(${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective, "objective")},${json(draft.inputProvenance, "provenance")},${json(draft.document, "document")},0,${quote(managerId)},${quote(key)},${quote(packet.sourceId)})::text;
rollback;`;

    const before = await state();
    let legacyTimeoutMilliseconds = null;
    if (!skipLegacyTimeout) {
      const legacyStarted = performance.now();
      await assert.rejects(() => sql(call(30_000, "production-database-probe-legacy")), (error) => /statement timeout/i.test(`${error.stderr}\n${error.stdout}\n${error.message}`));
      legacyTimeoutMilliseconds = Math.round(performance.now() - legacyStarted);
      assert.deepEqual(await state(), before, "the legacy 30-second cancellation must roll back every authority effect");
    }

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
      disposableDatabaseMemoryLimitMb: databaseMemoryMb || null,
      legacyStatementTimeoutMilliseconds: 30_000,
      legacyTimeoutProbeSkipped: skipLegacyTimeout,
      legacyTimeoutObservedMilliseconds: legacyTimeoutMilliseconds,
      admittedStatementTimeoutMilliseconds: STATIC_WEEKLY_DATABASE_OPERATION_STATEMENT_TIMEOUT_MS,
      compileMilliseconds,
      admittedDatabaseMilliseconds,
      combinedMilliseconds: compileMilliseconds + admittedDatabaseMilliseconds,
      requestDeadlineMilliseconds: 315_000,
      exactRollbackState: before,
      status: "PASS",
    }, null, 2)}\n`);
  }
} finally {
  await runtime.shutdown().catch(() => {});
  await docker(["rm", "-f", container]).then(() => { removed = true; }).catch(() => {});
  if (databaseMemoryMb > 0) await docker(["volume", "rm", "-f", dataVolume]).catch(() => {});
  if (!removed) process.stderr.write(`warning: disposable container ${container} may require cleanup\n`);
}
