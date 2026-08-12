#!/usr/bin/env node
// Independent-session race and rollback probes for the full I2 backend chain.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "../src/static-weekly-schedule-database-adapter.js";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_i2_race_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort().map((name) => path.resolve(migrationsDir, name));
const one = { id: "10000000-0000-4000-8000-000000000001", name: "Manager One" };
const two = { id: "10000000-0000-4000-8000-000000000002", name: "Manager Two" };
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `$$${JSON.stringify(value)}$$::jsonb`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });

function input({ exceptions = [] } = {}) {
  const slot = "20000000-0000-4000-8000-000000000041";
  const person = "30000000-0000-4000-8000-000000000041";
  const location = "40000000-0000-4000-8000-000000000041";
  return {
    serviceDate: "2026-11-02", timezone: "America/Chicago", exceptions,
    proximity: [{ from: "START", to: location, minutes: 1, verified: true, provenance: "race-route-v1" }],
    slots: [{ id: slot, label: "Race stable slot", incumbencies: [{ personId: person, displayName: "Race Worker", effectiveStart: "2020-01-01", effectiveEnd: null }] }],
    versions: [{ id: "60000000-0000-4000-8000-000000000041", publicationId: "70000000-0000-4000-8000-000000000041", status: "published", effectiveStart: "2026-11-02", effectiveEnd: null, objective: { requireVerifiedProximity: true },
      slotAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => ({ slotId: slot, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "race-shift-v1", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "race-maximum-v1", qualifications: ["general"], qualificationProvenance: "race-qualification-v1", restrictions: [], restrictionProvenance: "race-restriction-v1", acceptedRouteAnchorLocationId: "START", acceptedRouteProvenance: "race-route-v1" })),
      assignments: Array.from({ length: 7 }, (_, dayOfWeek) => ({ workId: `race-work-${dayOfWeek}`, dayOfWeek, locationId: location, locationCodeSnapshot: `RACE_${dayOfWeek}`, locationNameSnapshot: `Race ${dayOfWeek}`, window: { start: "08:00", end: "09:00" }, ownerSlotId: slot, serviceEffortMinutes: 20, serviceEffortProvenance: "race-service-v1", priority: 1, priorityProvenance: "race-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "race-work-qualification-v1", restrictions: [], restrictionProvenance: "race-work-restriction-v1" })),
    }],
  };
}

async function sql(statement) {
  if (Buffer.byteLength(statement) > 96 * 1024 || /^\s*--/.test(statement)) return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
    let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr }))); child.stdin.end(statement);
  });
  const { stdout } = await docker(["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]);
  return stdout.trim();
}
const scalar = async (statement) => (await sql(statement)).split("\n").at(-1);
async function control(statement) { return JSON.parse(await scalar(`set role static_weekly_control_plane; select ${statement}::text`)); }
async function migrate(pathname) { await sql(fs.readFileSync(pathname, "utf8")); }
async function expectReject(promise, expression) { await assert.rejects(promise, (error) => expression.test(`${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`)); }

let removed = false;
try {
  await docker(["image", "inspect", "supabase/postgres:17.6.1.143"]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", "supabase/postgres:17.6.1.143", "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { await sql("select 1"); await new Promise((resolve) => setTimeout(resolve, 1_000)); await sql("select 1"); const health = (await docker(["inspect", container, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}"]))?.stdout?.trim(); if (!health || health === "healthy") { await new Promise((resolve) => setTimeout(resolve, 10_000)); await sql("select 1"); ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("owned race database did not start");
  await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const migration of migrations) await migrate(migration);
  await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values
    (${quote(one.id)},${quote(one.name)},array['OPS_MANAGER']::text[],true,'{}'::jsonb,false),
    (${quote(two.id)},${quote(two.name)},array['OPS_MANAGER']::text[],true,'{}'::jsonb,false);`);
  await sql(`set role static_weekly_release_operator; select public.static_weekly_v3_configure_initial_authority_key('static-weekly-authority-hmac-v2','static-weekly-concurrency-test-attestation-secret-0123456789','concurrency-suite');`);

  const base = input(); const compiled = await compileStaticWeeklySchedule(base); assert.equal(compiled.status, "FEASIBLE");
  const sourceId = "80000000-0000-4000-8000-000000000041";
  await sql(`set role static_weekly_release_operator; select public.static_weekly_v3_register_authority_source(${quote(sourceId)},${json(compiled.canonicalAuthority.compilerInput)},'concurrency-source-registration');`);
  const slot = base.slots[0]; const incumbent = slot.incumbencies[0];
  await sql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},'RACE_SLOT',${quote(slot.label)},${quote(one.id)},${quote(one.name)},repeat('a',64)); insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(incumbent.personId)},${quote(incumbent.displayName)},'2020-01-01',${quote(one.id)},${quote(one.name)},repeat('b',64));`);
  const draftInput = createStaticWeeklyDraftRpcInput({ result: compiled, expectedRevision: 0, actor: { managerId: one.id, managerName: one.name, idempotencyKey: "race-create" } });
  const draft = await control(`public.static_weekly_v3_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(draftInput.document)},0,${quote(one.id)},'race-create',${quote(sourceId)})`);
  assert.equal(await scalar(`select authority_source_id::text from public.weekly_schedule_versions where version_id=${quote(draft.data.version_id)}`), sourceId, "v3 draft creation binds the release-registered source before publication");

  // Separate psql processes begin at the same time. They are independent DB
  // sessions, not promises sharing a client or transaction.
  const publishSql = `public.static_weekly_v3_publish_draft(${quote(draft.data.version_id)},1,1,${quote(one.id)},'race-publish','publish',null)`;
  const publishResults = await Promise.all(Array.from({ length: 8 }, () => control(publishSql)));
  assert.equal(new Set(publishResults.map((row) => JSON.stringify(row))).size, 1, "same-key publication race converges on one immutable receipt");
  const publication = publishResults[0]; assert.equal(publication.revision, 2);

  const ptoSql = `public.static_weekly_v3_apply_exception('pto','2026-11-03',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'race PTO',${json({ slotId: slot.id })},2,${quote(one.id)},'race-pto',null)`;
  const ptoResults = await Promise.all(Array.from({ length: 10 }, () => control(ptoSql)));
  assert.equal(new Set(ptoResults.map((row) => JSON.stringify(row))).size, 1, "same-key exception race returns the original receipt to every independent session");
  const pto = ptoResults[0]; assert.equal(pto.revision, 3);
  await expectReject(control(`public.static_weekly_v3_apply_exception('pto','2026-11-03','10:00','11:00',${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'changed',${json({ slotId: slot.id })},2,${quote(one.id)},'race-pto',null)`), /idempotency key/i);

  const lunchOne = control(`public.static_weekly_v3_apply_exception('lunch','2026-11-04','12:00','12:30',${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'one',${json({ slotId: slot.id })},3,${quote(one.id)},'race-lunch-one',null)`);
  const lunchTwo = control(`public.static_weekly_v3_apply_exception('lunch','2026-11-04','12:00','12:30',${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'two',${json({ slotId: slot.id })},3,${quote(two.id)},'race-lunch-two',null)`);
  const stale = await Promise.allSettled([lunchOne, lunchTwo]);
  assert.equal(stale.filter((result) => result.status === "fulfilled").length, 1, "different independent sessions cannot both pass a stale revision fence");
  assert.equal(stale.filter((result) => result.status === "rejected").length, 1);
  const current = Number(await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton"));

  // Caller transaction failure removes all command effects. A new independent
  // session can then apply once, and restart-style replay remains receipt-stable.
  const faultPayload = { locks: [{ workId: "race-work-4", slotId: slot.id }] };
  const faultSql = `begin; set local role static_weekly_control_plane; select public.static_weekly_v3_apply_exception('manager_correction','2026-11-05',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'fault',${json(faultPayload)},${current},${quote(one.id)},'fault-retry',null); select 1/0;`;
  await expectReject(sql(faultSql), /division by zero/i);
  assert.equal(await scalar("select count(*) from public.weekly_schedule_command_receipts where idempotency_key='fault-retry'"), "0", "failure injection rolls back authority revision, command, and receipt together");
  const retrySql = `public.static_weekly_v3_apply_exception('manager_correction','2026-11-05',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'fault',${json(faultPayload)},${current},${quote(one.id)},'fault-retry',null)`;
  const retried = await control(retrySql); assert.deepEqual(await control(retrySql), retried, "restart replay preserves the successful response byte-for-byte");
  const revisionAfterRetry = retried.revision;

  const accepted = JSON.parse(await scalar(`select public.static_weekly_accepted_exception_set(${quote(publication.data.publication_id)},'2026-11-02')::text`));
  const compilerExceptions = JSON.parse(await scalar(`select public.static_weekly_compiler_exception_set(${quote(publication.data.publication_id)},'2026-11-02')::text`));
  const overlay = input({ exceptions: compilerExceptions }); const overlayResult = await compileStaticWeeklySchedule(overlay); assert.equal(overlayResult?.verifier?.ok, true, JSON.stringify(overlayResult.fatal || overlayResult));
  assert.deepEqual(overlayResult.canonicalAuthority.appliedExceptions, accepted, "compiler applied-exception projection and SQL accepted-set identity are exact");
  const projectionInput = createStaticWeeklyProjectionRpcInput({ result: overlayResult, publicationId: publication.data.publication_id, expectedRevision: revisionAfterRetry, actor: { managerId: one.id, managerName: one.name, idempotencyKey: "race-projection" } });
  assert.equal(await scalar(`select public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(${quote(publication.data.publication_id)},'2026-11-02'))`), projectionInput.exceptionSetDigest, "adapter and SQL derive one exact complete weekly exception identity");
  const projectionSql = `public.static_weekly_v3_materialize_projection(${quote(projectionInput.publicationId)},${quote(projectionInput.serviceDate)},${quote(projectionInput.exceptionSetDigest)},${quote(projectionInput.compilerVersion)},${json(projectionInput.objective)},${json(projectionInput.metrics)},${quote(projectionInput.replayDigest)},${json(projectionInput.envelope)},${revisionAfterRetry},${quote(one.id)},'race-projection')`;
  const projectionRace = await Promise.all(Array.from({ length: 6 }, () => control(projectionSql)));
  assert.equal(new Set(projectionRace.map((row) => JSON.stringify(row))).size, 1, "full seven-day projection race is idempotent across independent sessions");
  const projection = projectionRace[0];

  const reversalSql = `public.static_weekly_v3_apply_exception('reverse','2026-11-03',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'PTO reversed',${json({ reversesExceptionId: pto.data.exception_id })},${projection.revision},${quote(one.id)},'race-reverse',${quote(pto.data.exception_id)})`;
  const reversals = await Promise.all(Array.from({ length: 6 }, () => control(reversalSql)));
  assert.equal(new Set(reversals.map((row) => JSON.stringify(row))).size, 1, "successful reversal replay is checked after the shared lock and before mutable reversal validation");
  const reversal = reversals[0];
  await expectReject(control(`public.static_weekly_v3_apply_exception('reverse','2026-11-03',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'changed reversal',${json({ reversesExceptionId: pto.data.exception_id })},${projection.revision},${quote(one.id)},'race-reverse',${quote(pto.data.exception_id)})`), /idempotency key/i);

  assert.equal(await scalar("select (to_regprocedure('public.static_weekly_v3_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text)') is null)::text"), "true", "the arbitrary legacy replacement writer is absent during concurrent authority operation");
  console.log("static weekly schedule real independent-session concurrency tests: PASS");
} finally {
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned disposable PostgreSQL container must be removed");
