#!/usr/bin/env node
// Real-PostgreSQL evidence for the outer, transaction-owning daily batch and
// its database-authoritative complete-chain replay contract.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput } from "../src/static-weekly-schedule-database-adapter.js";
import { createStaticWeeklyControlPlane } from "../src/static-weekly-control-plane.js";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_day_changes_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort().map((name) => path.join(migrationsDir, name));
const image = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
const actor = { manager_id: "10000000-0000-4000-8000-000000000061", manager_display_name: "Batch Manager" };
const publicationId = "70000000-0000-4000-8000-000000000061";
const versionId = "60000000-0000-4000-8000-000000000061";
const sourceId = "80000000-0000-4000-8000-000000000061";
const weekStart = "2026-11-02";
const serviceDate = "2026-11-03";
const slotIds = ["20000000-0000-4000-8000-000000000061", "20000000-0000-4000-8000-000000000062"];
const personIds = ["30000000-0000-4000-8000-000000000061", "30000000-0000-4000-8000-000000000062"];
const locationIds = ["40000000-0000-4000-8000-000000000061", "40000000-0000-4000-8000-000000000062"];
const contractorSlotId = "20000000-0000-4000-8000-000000000063";
const contractorPersonId = "30000000-0000-4000-8000-000000000063";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `$$${JSON.stringify(value)}$$::jsonb`;
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 64 * 1024 * 1024, ...options });

function sourceInput({ exceptions = [] } = {}) {
  const availability = (slotId, dayOfWeek, anchor) => ({ slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "batch-shift-v1", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "batch-capacity-v1", qualifications: ["general"], qualificationProvenance: "batch-qualification-v1", restrictions: [], restrictionProvenance: "batch-restriction-v1", acceptedRouteAnchorLocationId: anchor, acceptedRouteProvenance: "batch-route-v1" });
  return {
    serviceDate: weekStart,
    timezone: "America/Chicago",
    exceptions,
    proximity: [
      { from: locationIds[0], to: locationIds[0], minutes: 1, verified: true, provenance: "batch-route-v1" },
      { from: locationIds[0], to: locationIds[1], minutes: 4, verified: true, provenance: "batch-route-v1" },
      { from: locationIds[1], to: locationIds[0], minutes: 4, verified: true, provenance: "batch-route-v1" },
      { from: locationIds[1], to: locationIds[1], minutes: 1, verified: true, provenance: "batch-route-v1" },
    ],
    slots: [
      ...slotIds.map((id, index) => ({ id, label: `Batch slot ${index + 1}`, incumbencies: [{ personId: personIds[index], displayName: `Batch Worker ${index + 1}`, effectiveStart: "2020-01-01", effectiveEnd: null }] })),
      { id: contractorSlotId, label: "Batch CoverAll capacity", contractorCapacity: true, incumbencies: [{ personId: contractorPersonId, displayName: "Batch CoverAll", effectiveStart: "2020-01-01", effectiveEnd: null }], contractorAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => { const { slotId: _slotId, ...template } = availability(contractorSlotId, dayOfWeek, locationIds[1]); return template; }) },
    ],
    versions: [{
      id: versionId,
      publicationId,
      status: "published",
      effectiveStart: weekStart,
      effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => [
        ...slotIds.map((slotId, index) => availability(slotId, dayOfWeek, locationIds[index])),
        availability(contractorSlotId, dayOfWeek, locationIds[1]),
      ]).flat(),
      assignments: Array.from({ length: 7 }, (_, dayOfWeek) => slotIds.map((slotId, index) => ({ workId: `batch-work-${dayOfWeek}-${index}`, dayOfWeek, locationId: locationIds[index], locationCodeSnapshot: `BATCH_${dayOfWeek}_${index}`, locationNameSnapshot: `Batch ${dayOfWeek} ${index}`, window: { start: index ? "09:00" : "08:00", end: index ? "10:00" : "09:00" }, ownerSlotId: slotId, serviceEffortMinutes: 20, serviceEffortProvenance: "batch-service-v1", priority: 1, priorityProvenance: "batch-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "batch-work-qualification-v1", restrictions: [], restrictionProvenance: "batch-work-restriction-v1" }))).flat(),
    }],
  };
}

async function containerSql(statement) {
  if (Buffer.byteLength(statement) > 96 * 1024 || statement.includes("\n")) return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
    child.stdin.end(statement);
  });
  const { stdout } = await docker(["exec", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]);
  return stdout.trim();
}
const scalar = async (statement) => (await containerSql(statement)).split("\n").at(-1);

function tracedDatabase(pool, trace, { failProjection = false, terminateProjection = false, adminPool = null } = {}) {
  let nextConnectionId = 0;
  return {
    async connect() {
      const raw = await pool.connect();
      const connectionId = ++nextConnectionId;
      if (terminateProjection) raw.on("error", () => {});
      return {
        async query(statement, values) {
          const entry = { connectionId, statement, values: values || [], startedAt: Date.now() };
          trace.push(entry);
          try {
            if (statement.includes("static_weekly_v3_materialize_projection") && failProjection) return await raw.query("select 1/0");
            if (statement.includes("static_weekly_v3_materialize_projection") && terminateProjection) {
              const pid = Number((await raw.query("select pg_backend_pid() as pid")).rows[0].pid);
              await adminPool.query("select pg_terminate_backend($1)", [pid]);
            }
            const result = await raw.query(statement, values);
            entry.finishedAt = Date.now();
            if (statement.includes("pg_advisory_xact_lock") || statement.includes("static_weekly_v4_begin_day_changes")) entry.rows = result.rows;
            return result;
          } catch (error) {
            entry.finishedAt = Date.now();
            entry.sqlstate = error?.code || null;
            entry.error = error?.message || String(error);
            throw error;
          }
        },
        release: (...args) => raw.release(...args),
      };
    },
  };
}

function batchRequest(key, expectedRevision, operations) {
  return { manager: actor, serviceDate, baseVersionId: versionId, versionId, publicationId, operations, expectedRevision, idempotencyKey: key, projectionWeekStart: weekStart };
}

function firstDifference(left, right, pathLabel = "response") {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return { path: `${pathLabel}.length`, left: left.length, right: right.length };
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${pathLabel}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const difference = firstDifference(left[key], right[key], `${pathLabel}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path: pathLabel, left, right };
}

const ptoOperations = [
  { operation: "exception", exceptionType: "pto", reason: "Batch PTO 1", payload: { slotId: slotIds[0] } },
  { operation: "cover_all", slotId: contractorSlotId, reason: "Batch CoverAll 1" },
];
const alternatePtoOperations = [
  { operation: "exception", exceptionType: "pto", reason: "Alternate batch PTO", payload: { slotId: slotIds[1] } },
  { operation: "cover_all", slotId: contractorSlotId, reason: "Alternate batch CoverAll" },
];
const correctionOperations = slotIds.map((slotId, index) => ({ operation: "exception", exceptionType: "manager_correction", reason: `Batch correction ${index + 1}`, payload: { locks: [{ workId: `batch-work-2-${index}`, slotId }] } }));

let pool = null;
let removed = false;
try {
  await docker(["image", "inspect", image]);
  await docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", image, "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements", "-c", "listen_addresses=*"]);
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const logs = (await docker(["logs", container])).stdout;
      if (logs.includes("PostgreSQL init process complete; ready for start up.")) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await containerSql("select 1");
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(ready, true, "owned disposable PostgreSQL must start");
  await containerSql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const migration of migrations) await containerSql(fs.readFileSync(migration, "utf8"));
  await containerSql("alter role supabase_admin password 'postgres'");
  const port = Number((await docker(["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1));
  assert.equal(Number.isInteger(port) && port > 0, true, "owned PostgreSQL must expose one loopback test port");
  pool = new Pool({ connectionString: `postgres://supabase_admin:postgres@127.0.0.1:${port}/postgres`, max: 16, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 2_000 });

  await containerSql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values(${quote(actor.manager_id)},${quote(actor.manager_display_name)},array['OPS_MANAGER']::text[],true,'{}'::jsonb,false)`);
  await containerSql("set role static_weekly_release_operator; select public.static_weekly_v3_configure_initial_authority_key('static-weekly-authority-hmac-v2','static-weekly-day-change-test-secret-012345678901234567890','day-change-suite')");
  const source = sourceInput(); const compiled = await compileStaticWeeklySchedule(source); assert.equal(compiled.status, "FEASIBLE");
  await containerSql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${quote(sourceId)},${json(compiled.canonicalAuthority.compilerInput)},'day-change-source')`);
  for (const [index, slot] of source.slots.entries()) {
    const incumbent = slot.incumbencies[0];
    await containerSql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(`BATCH_SLOT_${index}`)},${quote(slot.label)},${quote(actor.manager_id)},${quote(actor.manager_display_name)},repeat(${quote(index ? "b" : "a")},64)); insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(incumbent.personId)},${quote(incumbent.displayName)},'2020-01-01',${quote(actor.manager_id)},${quote(actor.manager_display_name)},repeat(${quote(index ? "d" : "c")},64));`);
  }
  const draftInput = createStaticWeeklyDraftRpcInput({ result: compiled, expectedRevision: 0, actor: { managerId: actor.manager_id, managerName: actor.manager_display_name, idempotencyKey: "day-change-create" } });
  const draft = JSON.parse(await scalar(`set role static_weekly_control_plane; select public.static_weekly_v3_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(draftInput.document)},0,${quote(actor.manager_id)},'day-change-create',${quote(sourceId)})::text`));
  const publication = JSON.parse(await scalar(`set role static_weekly_control_plane; select public.static_weekly_v3_publish_draft(${quote(draft.data.version_id)},1,1,${quote(actor.manager_id)},'day-change-publish','publish',null)::text`));
  assert.equal(publication.revision, 2);

  const trace = []; let compilerCalls = 0; let latestCompilation = null;
  const controlPlane = createStaticWeeklyControlPlane({ database: tracedDatabase(pool, trace), compiler: async (input) => { compilerCalls += 1; latestCompilation = await compileStaticWeeklySchedule(input); return latestCompilation; } });
  const originalRequest = batchRequest("outer-day-change", 2, ptoOperations);
  const original = await controlPlane.applyDayChanges(originalRequest);
  assert.equal(original.revision, 5, "two child mutations and one projection commit in one outer transaction");
  assert.equal(original.data.mutations.length, 2);
  assert.equal(await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton"), "5");
  const immediate = await controlPlane.applyDayChanges(originalRequest);
  assert.deepEqual(immediate, original, "immediate whole-action replay is byte-stable");

  const variants = [
    { label: "proper prefix", operations: ptoOperations.slice(0, 1) },
    { label: "extension", operations: [...ptoOperations, correctionOperations[0]] },
    { label: "reorder", operations: [...ptoOperations].reverse() },
    { label: "first-position mutation", operations: [{ ...ptoOperations[0], reason: "Changed first position" }, ptoOperations[1]] },
    { label: "second-position mutation", operations: [ptoOperations[0], { ...ptoOperations[1], reason: "Changed second position" }] },
    { label: "CoverAll shift mutation", operations: [ptoOperations[0], { ...ptoOperations[1], shift: { start: "08:00", end: "17:00" } }] },
  ];
  for (const variant of variants) {
    const before = await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s");
    await assert.rejects(() => controlPlane.applyDayChanges(batchRequest("outer-day-change", 2, variant.operations)), (error) => error?.code === "23505", `${variant.label} must conflict with the accepted complete request`);
    assert.equal(await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s"), before, `${variant.label} must not mutate authority`);
  }

  const reverseOperations = original.data.mutations.map((mutation, index) => ({ operation: "exception", exceptionType: "reverse", reason: `Reverse batch PTO ${index + 1}`, payload: { reversesExceptionId: mutation.exception_id }, reversesExceptionId: mutation.exception_id }));
  const identicalRequest = batchRequest("outer-identical-race", 5, reverseOperations);
  const identical = await Promise.all(Array.from({ length: 6 }, () => controlPlane.applyDayChanges(identicalRequest)));
  for (const response of identical.slice(1)) {
    assert.equal(firstDifference(identical[0], response), null, "independent pooled sessions converge on one complete-batch response");
  }
  const baselineCompilation = latestCompilation;
  const afterIdentical = identical[0].revision;
  const conflictKey = "outer-conflicting-race";
  const conflicts = await Promise.allSettled([
    controlPlane.applyDayChanges(batchRequest(conflictKey, afterIdentical, ptoOperations)),
    controlPlane.applyDayChanges(batchRequest(conflictKey, afterIdentical, alternatePtoOperations)),
  ]);
  const conflictSummary = conflicts.map((item) => item.status === "fulfilled"
    ? { status: item.status, revision: item.value?.revision }
    : { status: item.status, code: item.reason?.code || null, message: item.reason?.message || String(item.reason) });
  const conflictConnectionIds = new Set(trace.filter((entry) => entry.statement.includes("static_weekly_v4_begin_day_changes") && entry.values[7] === conflictKey).map((entry) => entry.connectionId));
  const conflictTrace = trace.filter((entry) => conflictConnectionIds.has(entry.connectionId)).map(({ connectionId, statement, startedAt, finishedAt, rows, sqlstate }) => ({ connectionId, statement, startedAt, finishedAt, rows, sqlstate }));
  const conflictReceiptKeys = [0, 1].map((index) => `day-change-${createHash("sha256").update(`${conflictKey}:${index}`).digest("hex")}`);
  conflictReceiptKeys.push(`projection-${createHash("sha256").update(conflictKey).digest("hex")}`);
  const conflictReceipts = (await pool.query("select idempotency_key,command_type,expected_revision from public.weekly_schedule_command_receipts where actor_manager_id=$1 and idempotency_key=any($2::text[]) order by expected_revision", [actor.manager_id, conflictReceiptKeys])).rows;
  const conflictDiagnostic = JSON.stringify({ outcomes: conflictSummary, receipts: conflictReceipts, trace: conflictTrace });
  assert.equal(conflictConnectionIds.size, 2, `conflicting requests must execute through independent database sessions: ${conflictDiagnostic}`);
  assert.equal(conflicts.filter((item) => item.status === "fulfilled").length, 1, `one conflicting complete batch wins: ${conflictDiagnostic}`);
  assert.equal(conflicts.filter((item) => item.status === "rejected" && item.reason?.code === "23505").length, 1, `the other conflicting batch fails by parent idempotency identity: ${conflictDiagnostic}`);
  assert.equal(conflictReceipts.length, 3, `only the winner's two child receipts and final projection receipt may persist: ${conflictDiagnostic}`);
  const conflictWinner = conflicts.find((item) => item.status === "fulfilled").value;
  const lateFailureOperations = conflictWinner.data.mutations.map((mutation, index) => ({ operation: "exception", exceptionType: "reverse", reason: `Late-failure rollback ${index + 1}`, payload: { reversesExceptionId: mutation.exception_id }, reversesExceptionId: mutation.exception_id }));

  const beforeAdvancedReplay = await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s");
  trace.length = 0;
  assert.deepEqual(await controlPlane.applyDayChanges(originalRequest), original, "whole-action replay survives intervening authority advancement");
    assert.equal(await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s"), beforeAdvancedReplay, "historical replay is read-only");
    assert.equal(compilerCalls, 3, "only the three winning batches compile; all immediate, concurrent, conflicting, variant, and historical replays stop at the database receipt-chain gate");

    await pool.query("update public.ops_manager_managers set active=false where manager_id=$1", [actor.manager_id]);
    await assert.rejects(() => controlPlane.applyDayChanges(originalRequest), (error) => error?.code === "42501", "current authorization is checked before historical replay");
    await pool.query("update public.ops_manager_managers set active=true where manager_id=$1", [actor.manager_id]);

    const currentRevision = Number(await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton"));
    const stableState = await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s");
    const compilerTrace = [];
    const compilerRejecting = createStaticWeeklyControlPlane({ database: tracedDatabase(pool, compilerTrace), compiler: async () => ({ status: "INFEASIBLE", publicationAuthority: "REJECTED", verifier: { ok: false } }) });
    await assert.rejects(() => compilerRejecting.applyDayChanges(batchRequest("outer-late-compiler", currentRevision, lateFailureOperations)), (error) => error?.code === "static_weekly_control_plane_compiler_rejected");
    assert.equal(compilerTrace.filter((entry) => entry.statement.includes("static_weekly_v3_apply_exception") && !entry.sqlstate).length, 2, "all children succeed before compiler rejection");
    assert.equal(await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s"), stableState, "compiler rejection rolls back children and receipts");

    const projectionTrace = [];
    const projectionFailing = createStaticWeeklyControlPlane({ database: tracedDatabase(pool, projectionTrace, { failProjection: true }), compiler: async () => baselineCompilation });
    await assert.rejects(() => projectionFailing.applyDayChanges(batchRequest("outer-late-projection", currentRevision, lateFailureOperations)), (error) => error?.code === "22012");
    assert.equal(projectionTrace.filter((entry) => entry.statement.includes("static_weekly_v3_apply_exception") && !entry.sqlstate).length, 2, "all children succeed before projection failure");
    assert.equal(await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s"), stableState, "projection failure rolls back children and receipts");

    const crashTrace = [];
    const crashing = createStaticWeeklyControlPlane({ database: tracedDatabase(pool, crashTrace, { terminateProjection: true, adminPool: pool }), compiler: async () => baselineCompilation });
    await assert.rejects(() => crashing.applyDayChanges(batchRequest("outer-connection-loss", currentRevision, lateFailureOperations)), (error) => ["57P01", "ECONNRESET"].includes(error?.code) || /connection (terminated unexpectedly|error.*not queryable)/i.test(error?.message || ""));
    assert.equal(crashTrace.filter((entry) => entry.statement.includes("static_weekly_v3_apply_exception") && !entry.sqlstate).length, 2, "all children succeed before connection loss");
    assert.equal(await scalar("select row_to_json(s)::text from (select current_revision,(select count(*) from public.weekly_schedule_exception_commands) exceptions,(select count(*) from public.weekly_schedule_compiled_projections) projections,(select count(*) from public.weekly_schedule_command_receipts) receipts from public.static_weekly_schedule_control where singleton) s"), stableState, "connection loss rolls back the PostgreSQL transaction");
    assert.equal(await scalar("select count(*)::text from public.weekly_schedule_command_receipts where actor_manager_id='10000000-0000-4000-8000-000000000061' and (idempotency_key in (select public.static_weekly_v4_day_change_child_key('outer-connection-loss',i) from generate_series(0,25) i) or idempotency_key=public.static_weekly_v4_day_change_projection_key('outer-connection-loss'))"), "0", "connection loss leaves the complete request key reusable rather than partially claimed");

    const chain = JSON.parse(await scalar("select jsonb_build_object('parent_receipts',count(*) filter(where command_type='apply_day_changes'),'child_receipts',count(*) filter(where idempotency_key in (select public.static_weekly_v4_day_change_child_key('outer-day-change',i) from generate_series(0,25) i)),'projection_receipts',count(*) filter(where idempotency_key=public.static_weekly_v4_day_change_projection_key('outer-day-change')))::text from public.weekly_schedule_command_receipts where actor_manager_id='10000000-0000-4000-8000-000000000061'"));
    assert.deepEqual(chain, { parent_receipts: 0, child_receipts: 2, projection_receipts: 1 }, "the database recognizes the existing bounded child/projection chain without duplicating a parent payload receipt");
    assert.equal(await scalar("select (position('insert into public.weekly_schedule_command_receipts' in lower(pg_get_functiondef('public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)'::regprocedure)))=0)::text"), "true", "the replay gate validates existing immutable receipts without persisting another copy of batch inputs");
    assert.equal(await scalar("select (not has_function_privilege('anon','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE') and not has_function_privilege('service_role','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE') and has_function_privilege('static_weekly_control_plane','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE'))::text"), "true", "batch receipt functions are least-privilege");
  console.log("static weekly outer day-change real PostgreSQL tests: PASS");
} catch (error) {
  throw error;
} finally {
  if (pool) await pool.end().catch(() => {});
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned disposable PostgreSQL container must be removed");
