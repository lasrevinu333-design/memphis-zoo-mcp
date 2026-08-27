#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_vacancy_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const managerId = "10000000-0000-4000-8000-000000000091";
const firstVacantSlot = "20000000-0000-4000-8000-000000000091";
const secondVacantSlot = "20000000-0000-4000-8000-000000000092";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `$$${JSON.stringify(value)}$$::jsonb`;
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });

async function sql(statement) {
  if (Buffer.byteLength(statement) > 96 * 1024) {
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
  const { stdout } = await docker(["exec", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]);
  return stdout.trim();
}

const scalar = async (statement) => (await sql(statement)).split("\n").at(-1);
const cp = (name, args) => `set role static_weekly_control_plane; select public.${name}(${args})::text`;
async function expectReject(statement, pattern) {
  await assert.rejects(() => sql(statement), (error) => pattern.test(`${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`));
}
async function state() {
  return JSON.parse(await scalar("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'slots',(select count(*) from public.weekly_roster_slots),'incumbencies',(select count(*) from public.weekly_roster_slot_incumbencies),'staffing',(select count(*) from public.weekly_roster_slot_staffing_states),'employees',(select count(*) from public.employees),'messenger',(select count(*) from public.msg_users),'receipts',(select count(*) from public.weekly_schedule_command_receipts))::text"));
}

let removed = false;
try {
  const image = process.env.SCHEMA_REBUILD_DOCKER_IMAGE || "supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453";
  await docker(["image", "inspect", image]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", image, "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  let ready = false; let consecutiveReadyChecks = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await sql("select 1"); consecutiveReadyChecks += 1;
      if (consecutiveReadyChecks >= 5) { ready = true; break; }
    } catch { consecutiveReadyChecks = 0; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(ready, true, "disposable PostgreSQL must start before vacancy authority tests");
  await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) await sql(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values(${quote(managerId)},'Vacancy Test Manager',array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[],true,'{}'::jsonb,false)`);
  const vacancyTemplateConstraint = await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.weekly_schedule_slot_availability'::regclass and conname='weekly_schedule_slot_availability_vacancy_template_check'");
  assert.match(vacancyTemplateConstraint, /lunch_start IS NOT NULL.*lunch_end IS NOT NULL.*shift_start < lunch_start.*lunch_end < shift_end/i, "an empty schedule position cannot be published without a protected lunch inside its shift");

  const initial = await state();
  assert.equal(initial.revision, 0);
  const createdOne = JSON.parse(await scalar(cp("static_weekly_v7_create_vacant_roster_slot", `${quote(firstVacantSlot)},'Employee 1',0,${quote(managerId)},'vacancy-create-one'`)));
  assert.equal(createdOne.revision, 1);
  assert.equal(createdOne.data.vacant, true);
  assert.equal(createdOne.data.slot_label, "Employee 1");
  const replayOne = JSON.parse(await scalar(cp("static_weekly_v7_create_vacant_roster_slot", `${quote(firstVacantSlot)},'Employee 1',0,${quote(managerId)},'vacancy-create-one'`)));
  assert.deepEqual(replayOne, createdOne, "an exact create replay returns the original terminal receipt without advancing authority");
  const beforeCreateConflict = await state();
  await expectReject(cp("static_weekly_v7_create_vacant_roster_slot", `${quote(firstVacantSlot)},'Different label',0,${quote(managerId)},'vacancy-create-one'`), /idempotency key.*different semantic inputs/i);
  assert.deepEqual(await state(), beforeCreateConflict, "a conflicting create replay has no partial effects");

  const createdTwo = JSON.parse(await scalar(cp("static_weekly_v7_create_vacant_roster_slot", `${quote(secondVacantSlot)},'Kaili schedule position',1,${quote(managerId)},'vacancy-create-two'`)));
  assert.equal(createdTwo.revision, 2);
  const effectiveStart = await scalar("select (public.sch_service_date(statement_timestamp())-(extract(isodow from public.sch_service_date(statement_timestamp()))::integer-1))::text");
  const filled = JSON.parse(await scalar(cp("static_weekly_v7_fill_vacant_roster_slot", `${quote(secondVacantSlot)},'Kaili Test Employee',${quote(effectiveStart)},'Initial named hire for stable position',2,${quote(managerId)},'vacancy-fill-two'`)));
  assert.equal(filled.revision, 3);
  assert.match(filled.data.new_employee_id, /^[0-9a-f-]{36}$/i);
  assert.match(filled.data.new_employee_code, /^EMP[0-9]+$/);
  assert.equal(await scalar(`select active::text from public.employees where id=${quote(filled.data.new_employee_id)}`), "true");
  assert.equal(await scalar(`select is_active::text from public.msg_users where employee_id=${quote(filled.data.new_employee_id)}`), "true", "initial fill creates the same fresh Messenger identity");
  assert.equal(await scalar(`select count(*)::text from public.weekly_roster_slot_incumbencies where slot_id=${quote(secondVacantSlot)} and person_id=${quote(filled.data.new_employee_id)}`), "1");
  assert.equal(await scalar(`select staffing_state from public.weekly_roster_slot_staffing_states where slot_id=${quote(secondVacantSlot)} order by authority_revision desc limit 1`), "working");
  const fillReplay = JSON.parse(await scalar(cp("static_weekly_v7_fill_vacant_roster_slot", `${quote(secondVacantSlot)},'Kaili Test Employee',${quote(effectiveStart)},'Initial named hire for stable position',2,${quote(managerId)},'vacancy-fill-two'`)));
  assert.deepEqual(fillReplay, filled, "an exact fill replay creates no second employee or incumbency");
  const beforeSecondFill = await state();
  await expectReject(cp("static_weekly_v7_fill_vacant_roster_slot", `${quote(secondVacantSlot)},'Other Employee',${quote(effectiveStart)},'Should be rejected',3,${quote(managerId)},'vacancy-fill-again'`), /only a never-filled vacant stable position/i);
  assert.deepEqual(await state(), beforeSecondFill, "a second fill cannot duplicate identity or advance authority");

  const availability = (slotId) => ({
    slotId, dayOfWeek: 1, status: "vacant_unfilled", shift: { start: "08:00", end: "17:00" }, lunch: { start: "12:30", end: "13:30" },
    productiveCapacityProvenance: "vacancy-test-shift-lunch", maxServiceEffortMinutes: 100, maxServiceEffortProvenance: "vacancy-test-load",
    qualifications: ["general"], qualificationProvenance: "vacancy-test-qualification", restrictions: [], restrictionProvenance: "vacancy-test-restriction",
    acceptedRouteAnchorLocationId: "40000000-0000-4000-8000-000000000091", acceptedRouteProvenance: "vacancy-test-route",
  });
  const source = {
    serviceDate: effectiveStart, timezone: "America/Chicago", exceptions: [], proximity: [],
    slots: [{ id: firstVacantSlot, label: "Employee 1", incumbencies: [] }, { id: secondVacantSlot, label: "Kaili schedule position", incumbencies: [] }],
    version: { id: "60000000-0000-4000-8000-000000000091", publicationId: "70000000-0000-4000-8000-000000000091", status: "published", effectiveStart, effectiveEnd: null, objective: {}, vacancyCapableSlotIds: [firstVacantSlot, secondVacantSlot], vacantSlotIds: [firstVacantSlot, secondVacantSlot], slotAvailability: [availability(firstVacantSlot), availability(secondVacantSlot)], assignments: [] },
  };
  const dynamicVacancyVariant = structuredClone(source);
  dynamicVacancyVariant.version.vacantSlotIds = [firstVacantSlot];
  assert.equal(await scalar(`select (public.static_weekly_v3_source_identity(${json(source)})=public.static_weekly_v3_source_identity(${json(dynamicVacancyVariant)}))::text`), "true", "dated active vacancy membership does not change immutable source identity");
  const capabilityVariant = structuredClone(source);
  capabilityVariant.version.vacancyCapableSlotIds = [firstVacantSlot];
  assert.equal(await scalar(`select (public.static_weekly_v3_source_identity(${json(source)})=public.static_weekly_v3_source_identity(${json(capabilityVariant)}))::text`), "false", "vacancy capability remains exact registered source authority");
  const hydrated = JSON.parse(await scalar(`select public.static_weekly_v4_hydrate_compiler_source(${json(source)},${quote(effectiveStart)})::text`));
  assert.deepEqual(hydrated.version.vacantSlotIds, [firstVacantSlot], "hydration retains only the still-empty position as an active vacancy");
  assert.equal(hydrated.version.slotAvailability.find((row) => row.slotId === firstVacantSlot).status, "vacant_unfilled");
  assert.equal(hydrated.version.slotAvailability.find((row) => row.slotId === secondVacantSlot).status, "working");
  assert.equal(hydrated.slots.find((slot) => slot.id === firstVacantSlot).incumbencies.length, 0);
  assert.equal(hydrated.slots.find((slot) => slot.id === secondVacantSlot).incumbencies[0].personId, filled.data.new_employee_id, "a hire activates the pre-existing schedule position without changing its source template");
  const tuesday = await scalar(`select (${quote(effectiveStart)}::date+1)::text`);
  const hydratedFromTuesday = JSON.parse(await scalar(`select public.static_weekly_v4_hydrate_compiler_source(${json(source)},${quote(tuesday)})::text`));
  assert.deepEqual(hydratedFromTuesday.version.vacantSlotIds, [firstVacantSlot], "daily manager changes hydrate against the containing Monday-Sunday authority week");
  assert.equal(hydratedFromTuesday.slots.find((slot) => slot.id === secondVacantSlot).incumbencies[0].personId, filled.data.new_employee_id);

  for (const role of ["public", "anon", "authenticated", "service_role", "custodial_application_reader"]) {
    assert.equal(await scalar(`select has_function_privilege(${quote(role)},'public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text)','execute')::text`), "false", `${role} cannot create schedule positions`);
    assert.equal(await scalar(`select has_function_privilege(${quote(role)},'public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)','execute')::text`), "false", `${role} cannot fill schedule positions`);
  }
  assert.equal(await scalar("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text)','execute')::text"), "true");
  assert.equal(await scalar("select has_function_privilege('static_weekly_control_plane','public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)','execute')::text"), "true");

  console.log("static weekly vacant roster-slot database tests: PASS");
} finally {
  try { await docker(["rm", "-f", container]); removed = true; } catch {}
  if (!removed) process.exitCode = 1;
}
