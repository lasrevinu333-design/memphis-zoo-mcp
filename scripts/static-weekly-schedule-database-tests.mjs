#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { postgresJsonbCanonicalText, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const finalBackendMigrationName = "20260810190000_final_integrated_backend_operational_correction.sql";
const schedulerMigrationName = "20260810200000_static_weekly_scheduler_authority_integrated.sql";
const migrationPath = path.resolve(migrationsDir, schedulerMigrationName);
const databaseUser = "supabase_admin";
const backendMigrationPaths = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql") && name <= finalBackendMigrationName)
  .sort()
  .map((name) => path.resolve(migrationsDir, name));
const manager = "10000000-0000-4000-8000-000000000001";
const digest = (character) => character.repeat(64);

function exactAuthorityDocument(effectiveDate = "2026-09-07") {
  const slotId = "20000000-0000-4000-8000-000000000001";
  const personId = "30000000-0000-4000-8000-000000000002";
  const workId = "work-v2";
  const planWorkId = `1:${workId}`;
  const compilerInput = {
    serviceDate: effectiveDate, exceptions: [], proximity: [],
    version: {
      id: "fixture-v2", assignments: [{ workId, dayOfWeek: 1, locationId: "40000000-0000-4000-8000-000000000001", window: { start: "08:00", end: "09:00" }, ownerSlotId: slotId, serviceEffortMinutes: 12, requiredQualifications: ["general"], restrictions: [] }],
      slotAvailability: [{ slotId, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityMinutes: 1, qualifications: ["general"], qualificationProvenance: "fixture", restrictions: [], restrictionProvenance: "fixture" }],
    },
    slots: [{ id: slotId, label: "Stable slot A", incumbencies: [{ personId, displayName: "Morgan Replacement", effectiveStart: "2026-08-17", effectiveEnd: null }] }],
  };
  const ownerDigest = postgresJsonbContentDigest({ planWorkId, slotId, personId, serviceDate: effectiveDate });
  const exactOwnerIdentity = postgresJsonbContentDigest({ plan_work_id: planWorkId, service_date: effectiveDate, optimized_owner_slot_id: slotId, optimized_owner_person_id: personId, baseline_owner_slot_id: slotId, baseline_owner_person_id: personId });
  const optimizerResult = { assignments: [{ planWorkId, workId, dayOfWeek: 1, serviceDate: effectiveDate, status: "ASSIGNED", slotId, personId, displayName: "Morgan Replacement", ownerDigest, exactOwnerIdentity, baselineSlotId: slotId, baselineOwnerPersonId: personId, baselineOwnerName: "Morgan Replacement", originalActorPersonId: personId, originalActorName: "Morgan Replacement", optimizedOwnerSlotId: slotId, optimizedOwnerPersonId: personId, window: { start: "08:00", end: "09:00" }, serviceEffortMinutes: 12 }] };
  const authority = {
    authority_digest: digest("8"), input_digest: postgresJsonbContentDigest(compilerInput), baseline_input_digest: postgresJsonbContentDigest(compilerInput), replay_digest: digest("6"), solution_digest: postgresJsonbContentDigest(optimizerResult),
    effective_date: effectiveDate,
    compiler_input: compilerInput, overlay_compiler_input: compilerInput, applied_exceptions: [], optimizer_result: optimizerResult,
  };
  authority.database_content_identity = postgresJsonbContentDigest(authority);
  const assignment = { work_id: workId, day_of_week: 1, location_id: "40000000-0000-4000-8000-000000000001", location_code_snapshot: "TETON", location_name_snapshot: "Teton", coverage_start: "08:00", coverage_end: "09:00", owner_slot_id: slotId, owner_slot_label_snapshot: "Stable slot A", owner_person_id_snapshot: personId, owner_name_snapshot: "Morgan Replacement", required_qualifications_snapshot: ["general"], restriction_snapshot: [], workload_points: 12, workload_provenance: { source: "fixture" }, manual_lock: true, payload_json: { owner_digest: ownerDigest, exact_owner_identity: exactOwnerIdentity, authority_facts: { stable_roster_slot_id: slotId, baseline_owner_slot_id: slotId, baseline_owner_person_id: personId, baseline_owner_name: "Morgan Replacement", original_actor_person_id: personId, original_actor_name: "Morgan Replacement", optimized_owner_slot_id: slotId, optimized_owner_person_id: personId } } };
  const document = {
    slot_availability: [{ slot_id: slotId, day_of_week: 1, availability_state: "working", shift_start: "07:00", shift_end: "16:00", capacity_units: 1, max_load_points: 100, qualification_snapshot: ["general"], qualification_provenance: { source: "fixture" }, restriction_snapshot: [], restriction_provenance: { source: "fixture" }, slot_label_snapshot: "Stable slot A", incumbent_person_id_snapshot: personId, incumbent_name_snapshot: "Morgan Replacement" }],
    assignments: [assignment], objective_inputs: [{ input_key: "proximity", input_value: { dataset: "fixture" }, provenance: { verified: true } }], authority,
    validation: { status: "FEASIBLE", replay_digest: digest("6"), input_digest: authority.input_digest, authority_digest: authority.authority_digest, solution_digest: authority.solution_digest, server_computed: true },
  };
  document.validation.database_document_identity = postgresJsonbContentDigest({ effective_date: effectiveDate, authority, slot_availability: document.slot_availability, assignments: document.assignments, objective_inputs: document.objective_inputs });
  return document;
}
function exactProjectionEnvelope(document, effectiveDate = "2026-09-07") {
  const source = document.authority.optimizer_result.assignments[0];
  const authority = {
    effectiveDate,
    compilerInput: document.authority.compiler_input, overlayCompilerInput: document.authority.compiler_input,
    inputDigest: document.authority.input_digest, baselineInputDigest: document.authority.baseline_input_digest, appliedExceptions: [],
    optimizerResult: { assignments: [{ ...source }] },
  };
  authority.databaseContentIdentity = postgresJsonbContentDigest(authority);
  const assignments = [{ plan_work_id: "1:work-v2", work_id: "work-v2", status: "assigned", owner_slot_id: source.slotId, owner_person_id: source.personId, owner_digest: source.ownerDigest, exact_owner_identity: source.exactOwnerIdentity, authority_digest: document.authority.authority_digest, baseline_owner_slot_id: source.baselineSlotId, baseline_owner_person_id: source.baselineOwnerPersonId, baseline_owner_name: source.baselineOwnerName, original_actor_person_id: source.originalActorPersonId, original_actor_name: source.originalActorName, optimized_owner_slot_id: source.optimizedOwnerSlotId, optimized_owner_person_id: source.optimizedOwnerPersonId, explanation: { hardConstraints: "satisfied" } }];
  const envelope = { service_date: effectiveDate, authority, authority_digest: document.authority.authority_digest, replay_digest: document.authority.replay_digest, exception_set_digest: postgresJsonbContentDigest([]), assignments };
  envelope.database_projection_identity = postgresJsonbContentDigest(envelope);
  return envelope;
}
function resealExactDocument(document) {
  const authorityWithoutIdentity = { ...document.authority }; delete authorityWithoutIdentity.database_content_identity;
  document.authority.database_content_identity = postgresJsonbContentDigest(authorityWithoutIdentity);
  document.validation.input_digest = document.authority.input_digest;
  document.validation.solution_digest = document.authority.solution_digest;
  document.validation.authority_digest = document.authority.authority_digest;
  document.validation.database_document_identity = postgresJsonbContentDigest({ effective_date: document.authority.effective_date, authority: document.authority, slot_availability: document.slot_availability, assignments: document.assignments, objective_inputs: document.objective_inputs });
  return document;
}
function resealOptimizerDocument(document) {
  document.authority.solution_digest = postgresJsonbContentDigest(document.authority.optimizer_result);
  return resealExactDocument(document);
}
function adapterBaselineCompilerInput(effectiveDate = "2026-09-21") {
  const slotId = "20000000-0000-4000-8000-000000000001";
  const personId = "30000000-0000-4000-8000-000000000002";
  const locationId = "40000000-0000-4000-8000-000000000001";
  return {
    serviceDate: effectiveDate, timezone: "America/Chicago", exceptions: [],
    proximity: [{ from: "ADAPTER_START", to: locationId, minutes: 1, verified: true, provenance: "adapter-disposable-route" }],
    slots: [{ id: slotId, label: "Stable slot A", incumbencies: [{ personId, displayName: "Morgan Replacement", effectiveStart: "2026-08-17", effectiveEnd: null }] }],
    versions: [{
      id: "adapter-baseline-week", publicationId: "adapter-baseline-publication", status: "published", effectiveStart: effectiveDate, effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: [{ slotId, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "adapter-disposable-shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "adapter-disposable-maximum", qualifications: ["general"], qualificationProvenance: "adapter-disposable-qualification", restrictions: [], restrictionProvenance: "adapter-disposable-restriction", acceptedRouteAnchorLocationId: "ADAPTER_START", acceptedRouteProvenance: "adapter-disposable-route" }],
      assignments: [{ workId: "adapter-baseline-work", dayOfWeek: 1, locationId, window: { start: "08:00", end: "09:00" }, ownerSlotId: slotId, serviceEffortMinutes: 20, serviceEffortProvenance: "adapter-disposable-service", priority: 1, priorityProvenance: "adapter-disposable-priority", requiredQualifications: ["general"], qualificationProvenance: "adapter-disposable-work-qualification", restrictions: [], restrictionProvenance: "adapter-disposable-work-restriction" }],
    }],
  };
}
function adapterSevenDayCompilerInput(effectiveDate = "2026-10-05") {
  const slotA = "20000000-0000-4000-8000-000000000001";
  const slotB = "20000000-0000-4000-8000-000000000011";
  const personA = "30000000-0000-4000-8000-000000000002";
  const personBOld = "30000000-0000-4000-8000-000000000011";
  const personBNew = "30000000-0000-4000-8000-000000000012";
  const locationA = "40000000-0000-4000-8000-000000000011";
  const locationB = "40000000-0000-4000-8000-000000000012";
  const availability = (slotId, dayOfWeek, anchor) => ({
    slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" },
    productiveCapacityProvenance: "seven-day-shift", maxServiceEffortMinutes: 300,
    maxServiceEffortProvenance: "seven-day-maximum", qualifications: ["general"],
    qualificationProvenance: "seven-day-qualification", restrictions: [],
    restrictionProvenance: "seven-day-restriction", acceptedRouteAnchorLocationId: anchor,
    acceptedRouteProvenance: "seven-day-route",
  });
  const work = (workId, dayOfWeek, locationId, ownerSlotId, extra = {}) => ({
    workId, dayOfWeek, locationId, locationCodeSnapshot: `DAY_${dayOfWeek}`,
    locationNameSnapshot: dayOfWeek === 3 ? "Area 50% North" : `Area ${dayOfWeek}`,
    window: { start: "08:00", end: "09:00" }, ownerSlotId,
    serviceEffortMinutes: 20, serviceEffortProvenance: "seven-day-service",
    priority: 1, priorityProvenance: "seven-day-priority",
    requiredQualifications: ["general"], qualificationProvenance: "seven-day-work-qualification",
    restrictions: [], restrictionProvenance: "seven-day-work-restriction", ...extra,
  });
  const assignments = Array.from({ length: 7 }, (_, dayOfWeek) => work(
    dayOfWeek === 0 || dayOfWeek === 6 ? "repeated-rounds" : `required-day-${dayOfWeek}`,
    dayOfWeek,
    dayOfWeek % 2 ? locationB : locationA,
    dayOfWeek % 2 ? slotB : slotA,
  ));
  assignments.push(work("optional-special", 4, locationB, slotB, {
    window: { start: "10:00", end: "11:00" }, required: false,
    coveragePolicy: "permitted_open", requiredQualifications: ["special-unavailable"],
  }));
  return {
    serviceDate: effectiveDate, timezone: "America/Chicago", exceptions: [],
    proximity: [
      { from: "START_A", to: locationA, minutes: 1, verified: true, provenance: "seven-day-route" },
      { from: "START_A", to: locationB, minutes: 4, verified: true, provenance: "seven-day-route" },
      { from: "START_B", to: locationA, minutes: 4, verified: true, provenance: "seven-day-route" },
      { from: "START_B", to: locationB, minutes: 1, verified: true, provenance: "seven-day-route" },
    ],
    slots: [
      { id: slotA, label: "Stable slot A", incumbencies: [{ personId: personA, displayName: "Morgan Replacement", effectiveStart: "2026-08-17", effectiveEnd: null }] },
      { id: slotB, label: "Stable slot 50% B", incumbencies: [
        { personId: personBOld, displayName: "Jordan Old", effectiveStart: "2020-01-01", effectiveEnd: "2026-10-07" },
        { personId: personBNew, displayName: "Jordan New", effectiveStart: "2026-10-07", effectiveEnd: null },
      ] },
    ],
    versions: [{
      id: "adapter-seven-day-week", publicationId: "adapter-seven-day-publication",
      status: "published", effectiveStart: effectiveDate, effectiveEnd: null,
      objective: { requireVerifiedProximity: true },
      slotAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => [
        availability(slotA, dayOfWeek, "START_A"), availability(slotB, dayOfWeek, "START_B"),
      ]).flat(),
      assignments,
    }],
  };
}
function resealProjectionEnvelope(envelope) {
  const authorityWithoutIdentity = { ...envelope.authority }; delete authorityWithoutIdentity.databaseContentIdentity;
  envelope.authority.databaseContentIdentity = postgresJsonbContentDigest(authorityWithoutIdentity);
  const envelopeWithoutIdentity = { ...envelope }; delete envelopeWithoutIdentity.database_projection_identity;
  envelope.database_projection_identity = postgresJsonbContentDigest(envelopeWithoutIdentity);
  return envelope;
}

async function docker(args, options = {}) {
  return execFileAsync("docker", args, { maxBuffer: 16 * 1024 * 1024, ...options });
}
async function sql(database, statement) {
  if (Buffer.byteLength(statement, "utf8") > 96 * 1024) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", databaseUser, "-d", database]);
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.once("close", (code) => {
        if (code === 0) resolve(String(stdout || "").trim());
        else reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr, code }));
      });
      child.stdin.end(statement);
    });
  }
  const { stdout } = await docker(["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", databaseUser, "-d", database, "-c", statement]);
  return String(stdout || "").trim();
}
async function expectFailure(database, statement, pattern) {
  await assert.rejects(() => sql(database, statement), (error) => pattern.test(`${error.stdout || ""}\n${error.stderr || ""}`));
}
async function applyBackendMigrations(database) {
  for (const migration of backendMigrationPaths) {
    await sql(database, fs.readFileSync(migration, "utf8"));
  }
}
async function applySchedulerMigration(database) {
  await sql(database, fs.readFileSync(migrationPath, "utf8"));
}
async function waitForPostgres() {
  let lastError;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await sql("postgres", "select 1");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await sql("postgres", "select 1");
      const health = (await docker(["inspect", container, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}"]))?.stdout?.trim();
      if (!health || health === "healthy") {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        await sql("postgres", "select 1");
        return;
      }
    } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw lastError || new Error("disposable PostgreSQL did not start");
}
async function prepareRoles(database) {
  await sql(database, "do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
}

assert.equal(fs.existsSync(migrationPath), true, "owned migration must exist");
assert.equal(backendMigrationPaths.length, 62, "exact backend source must contain 62 migrations through 190000");
assert.equal(path.basename(backendMigrationPaths.at(-1)), finalBackendMigrationName, "backend migration order must end at 190000");
await docker(["image", "inspect", "supabase/postgres:17.6.1.143"]);
let removed = false;
try {
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", "supabase/postgres:17.6.1.143", "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  await waitForPostgres();
  await prepareRoles("postgres");
  await applyBackendMigrations("postgres");
  await sql("postgres", `
    insert into public.employees(id,employee_code,display_name,active,role)
    values ('40000000-0000-4000-8000-000000000091','STATIC-WEEKLY-LEGACY','Legacy schedule employee',true,'staff');
    insert into public.location_groups(id,group_code,group_name,active)
    values ('40000000-0000-4000-8000-000000000092','STATIC_WEEKLY_LEGACY','Legacy schedule group',true);
    insert into public.daily_schedule_assignments(id,service_date,location_group_id,assigned_employee_id,coverage_start,coverage_end,notes,source_type)
    values ('40000000-0000-4000-8000-000000000093','2026-08-10','40000000-0000-4000-8000-000000000092','40000000-0000-4000-8000-000000000091','08:00','09:00','legacy row preserved across scheduler integration','manual');
  `);
  await applySchedulerMigration("postgres");
  assert.equal(await sql("postgres", "select to_regclass('public.weekly_schedule_versions') is not null"), "t");
  assert.equal(await sql("postgres", "select to_regclass('public.weekly_schedule_exception_commands') is not null"), "t");
  assert.equal(await sql("postgres", "select count(*) from public.static_weekly_schedule_control where singleton"), "1");

  await sql("postgres", `
    insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values
      ('20000000-0000-4000-8000-000000000001','SLOT_A','Stable slot A','${manager}','Named Manager','${digest("a")}');
    insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values
      ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Avery Departed','2020-01-01','2026-08-17','${manager}','Named Manager','${digest("b")}'),
      ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','Morgan Replacement','2026-08-17',null,'${manager}','Named Manager','${digest("c")}');
  `);
  assert.equal(await sql("postgres", "select to_regclass('public.weekly_roster_slot_incumbency_closures') is not null"), "t");

  const draftA = await sql("postgres", `select public.static_weekly_create_draft('2026-08-17','objective-v1','{}','{}','{}','${digest("e")}',0,'${manager}','Named Manager','create-a')->>'version_id'`);
  assert.match(draftA, /^[0-9a-f-]{36}$/);
  assert.equal(await sql("postgres", `select public.static_weekly_create_draft('2026-08-17','objective-v1','{}','{}','{}','${digest("e")}',0,'${manager}','Named Manager','create-a')->>'version_id'`), draftA, "draft retry must return the exact first receipt");
  await expectFailure("postgres", `update public.weekly_schedule_versions set objective_json='{"bad":true}' where version_id='${draftA}'`, /revision-checked command/i);
  const draftDocument = `$$
    {"slot_availability":[{"slot_id":"20000000-0000-4000-8000-000000000001","day_of_week":1,"availability_state":"working","shift_start":"07:00","shift_end":"16:00","capacity_units":1,"qualification_snapshot":["general"],"qualification_provenance":{"source":"fixture"},"restriction_snapshot":[],"restriction_provenance":{"source":"fixture"},"slot_label_snapshot":"Stable slot A"}],
     "assignments":[{"work_id":"work-a","day_of_week":1,"location_code_snapshot":"TETON","location_name_snapshot":"Teton","coverage_start":"08:00","coverage_end":"09:00","owner_slot_id":"20000000-0000-4000-8000-000000000001","owner_slot_label_snapshot":"Stable slot A","owner_person_id_snapshot":"30000000-0000-4000-8000-000000000002","owner_name_snapshot":"Morgan Replacement","required_qualifications_snapshot":["general"],"restriction_snapshot":[],"workload_points":12,"workload_provenance":{"source":"fixture"},"manual_lock":true}],
     "objective_inputs":[{"input_key":"proximity","input_value":{"dataset":"fixture"},"provenance":{"verified":true}}]}
  $$::jsonb`;
  assert.equal(await sql("postgres", `select public.static_weekly_update_draft('${draftA}',${draftDocument},'{}','{}','${digest("f")}',1,1,'${manager}','Named Manager','update-a')->>'draft_revision'`), "2");
  const publicationA = JSON.parse(await sql("postgres", `select public.static_weekly_publish_draft('${draftA}',2,2,'${manager}','Named Manager','publish-a','publish',null)::text`));
  assert.equal(publicationA.revision, 3);
  assert.equal(await sql("postgres", `select public.static_weekly_effective_version('2026-08-17')::text`), publicationA.version_id);
  assert.equal(await sql("postgres", `select count(*) from public.weekly_schedule_slot_assignments where version_id='${publicationA.version_id}' and work_id='work-a'`), "1", "published authority must snapshot immutable draft work assignments");
  assert.deepEqual(JSON.parse(await sql("postgres", `select public.static_weekly_publish_draft('${draftA}',2,2,'${manager}','Named Manager','publish-a','publish',null)::text`)), publicationA, "publication retry must be exactly once");
  await expectFailure("postgres", `update public.weekly_schedule_versions set objective_json='{}' where version_id='${publicationA.version_id}'`, /published weekly schedule versions are immutable/i);
  await expectFailure("postgres", `update public.weekly_schedule_slot_assignments set workload_points=99 where version_id='${publicationA.version_id}' and work_id='work-a'`, /revision-checked draft command/i);
  await expectFailure("postgres", `delete from public.weekly_schedule_publications where publication_id='${publicationA.publication_id}'`, /append-only/i);

  const draftB = await sql("postgres", `select public.static_weekly_create_draft('2026-08-24','objective-v1','{}','{}','{}','${digest("1")}',3,'${manager}','Named Manager','create-b')->>'version_id'`);
  const publicationB = JSON.parse(await sql("postgres", `select public.static_weekly_publish_draft('${draftB}',1,4,'${manager}','Named Manager','publish-b','supersede',null)::text`));
  assert.equal(await sql("postgres", `select effective_end::text from public.v_weekly_schedule_effective_ranges where version_id='${publicationA.version_id}'`), "2026-08-24");
  assert.equal(await sql("postgres", `select public.static_weekly_effective_version('2026-08-23')::text`), publicationA.version_id);
  assert.equal(await sql("postgres", `select public.static_weekly_effective_version('2026-08-24')::text`), publicationB.version_id);
  const overlappingDraft = await sql("postgres", `select public.static_weekly_create_draft('2026-08-24','objective-v1','{}','{}','{}','${digest("2")}',5,'${manager}','Named Manager','overlap-draft')->>'version_id'`);
  await expectFailure("postgres", `select public.static_weekly_publish_draft('${overlappingDraft}',1,6,'${manager}','Named Manager','overlap-publish','supersede',null)`, /later effective date/i);

  const exceptionA = JSON.parse(await sql("postgres", `select public.static_weekly_apply_exception('pto','2026-08-25',null,null,'${publicationB.version_id}','${publicationB.publication_id}','approved pto','{"slotId":"20000000-0000-4000-8000-000000000001"}','${digest("3")}',6,'${manager}','Named Manager','pto-a',null)::text`));
  assert.equal(exceptionA.revision, 7);
  const reversal = JSON.parse(await sql("postgres", `select public.static_weekly_apply_exception('reverse','2026-08-25',null,null,'${publicationB.version_id}','${publicationB.publication_id}','reverse approved pto','{"reversesExceptionId":"${exceptionA.exception_id}"}','${digest("4")}',7,'${manager}','Named Manager','pto-a-reverse','${exceptionA.exception_id}')::text`));
  assert.equal(reversal.revision, 8);
  await expectFailure("postgres", `select public.static_weekly_apply_exception('manager_correction','2026-08-25',null,null,'${publicationB.version_id}','${publicationB.publication_id}','stale correction','{}','${digest("5")}',6,'${manager}','Named Manager','stale-correction',null)`, /stale expected revision/i);
  await expectFailure("postgres", `delete from public.weekly_schedule_exception_commands where exception_id='${exceptionA.exception_id}'`, /append-only/i);

  // V2 is the real application seam.  It calculates all request/content/output
  // digests in PostgreSQL and rejects an empty authority before revision advance.
  const emptyV2 = JSON.parse(await sql("postgres", `select public.static_weekly_v2_create_draft('2026-08-31','objective-v2','{}','{}','{}',8,'${manager}','Named Manager','v2-empty')::text`));
  await expectFailure("postgres", `select public.static_weekly_v2_publish_draft('${emptyV2.data.version_id}',1,9,'${manager}','Named Manager','v2-empty-publish','publish',null)`, /empty weekly authority|server-reviewed feasible|repeating baseline/i);
  const exactDocument = exactAuthorityDocument();
  const v2Document = `$$${JSON.stringify(exactDocument)}$$::jsonb`;
  const mismatchedDocument = structuredClone(exactDocument); mismatchedDocument.assignments[0].owner_person_id_snapshot = "30000000-0000-4000-8000-000000000001";
  await expectFailure("postgres", `select public.static_weekly_v2_create_draft('2026-09-07','objective-v2','{}','{}',$$${JSON.stringify(mismatchedDocument)}$$::jsonb,9,'${manager}','Named Manager','v2-mismatched')`, /identity|owner.*match|canonical|draft, effective/i);
  const baselineOverlayDocument = structuredClone(exactDocument);
  baselineOverlayDocument.authority.overlay_compiler_input = structuredClone(baselineOverlayDocument.authority.compiler_input);
  baselineOverlayDocument.authority.overlay_compiler_input.exceptions = [{ id: "forged-overlay", type: "pto" }];
  baselineOverlayDocument.authority.input_digest = postgresJsonbContentDigest(baselineOverlayDocument.authority.overlay_compiler_input);
  baselineOverlayDocument.authority.applied_exceptions = [{ id: "forged-overlay", type: "pto", serviceDate: "2026-09-07", payloadDigest: digest("f") }];
  resealExactDocument(baselineOverlayDocument);
  await expectFailure("postgres", `select public.static_weekly_v2_create_draft('2026-09-07','objective-v2','{}','{}',$$${JSON.stringify(baselineOverlayDocument)}$$::jsonb,9,'${manager}','Named Manager','v2-baseline-overlay')`, /exception-free|repeating baseline/i);
  const contradictoryDocument = structuredClone(exactDocument);
  contradictoryDocument.authority.compiler_input.version.assignments[0].locationId = "40000000-0000-4000-8000-000000000099";
  contradictoryDocument.authority.overlay_compiler_input = structuredClone(contradictoryDocument.authority.compiler_input);
  contradictoryDocument.authority.input_digest = postgresJsonbContentDigest(contradictoryDocument.authority.compiler_input);
  contradictoryDocument.authority.baseline_input_digest = contradictoryDocument.authority.input_digest;
  resealExactDocument(contradictoryDocument);
  await expectFailure("postgres", `select public.static_weekly_v2_create_draft('2026-09-07','objective-v2','{}','{}',$$${JSON.stringify(contradictoryDocument)}$$::jsonb,9,'${manager}','Named Manager','v2-contradictory')`, /exact canonical|draft work|immutable work/i);
  const fullV2 = JSON.parse(await sql("postgres", `select public.static_weekly_v2_create_draft('2026-09-07','objective-v2','{}','{}',${v2Document},9,'${manager}','Named Manager','v2-full')::text`));
  await assert.rejects(() => sql("postgres", `select public.static_weekly_v2_create_draft('2026-09-07','objective-v2','{"changed":true}','{}',${v2Document},9,'${manager}','Named Manager','v2-full')`), /idempotency key/i);
  const v2Update = JSON.parse(await sql("postgres", `select public.static_weekly_v2_update_draft('${fullV2.data.version_id}',${v2Document},'{"requireVerifiedProximity":true}','{}',1,10,'${manager}','Named Manager','v2-update')::text`));
  assert.equal(v2Update.revision, 11);
  const v2Publication = JSON.parse(await sql("postgres", `select public.static_weekly_v2_publish_draft('${fullV2.data.version_id}',2,11,'${manager}','Named Manager','v2-publish','supersede',null)::text`));
  assert.equal(v2Publication.revision, 12);
  assert.match(v2Publication.output_digest, /^[0-9a-f]{64}$/);
  assert.equal(await sql("postgres", `select response_digest from public.weekly_schedule_command_receipts where actor_manager_id='${manager}' and idempotency_key='v2-publish'`), v2Publication.output_digest, "stored response digest must attest the stored response");
  const v2Exception = JSON.parse(await sql("postgres", `select public.static_weekly_v2_apply_exception('pto','2026-09-08',null,null,'${v2Publication.data.version_id}','${v2Publication.data.publication_id}','approved pto','{"slotId":"20000000-0000-4000-8000-000000000001"}',12,'${manager}','Named Manager','v2-pto',null)::text`));
  assert.equal(v2Exception.revision, 13);
  await expectFailure("postgres", `select public.static_weekly_v2_apply_exception('reverse','2026-09-08',null,null,'${v2Publication.data.version_id}','${v2Publication.data.publication_id}','bad reversal','{}',13,'${manager}','Named Manager','bad-reverse',null)`, /reversal target coherence/i);

  await sql("postgres", `insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values ('20000000-0000-4000-8000-000000000009','SLOT_B','Stable slot B','${manager}','Named Manager','${digest("8")}'); insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values ('30000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000009','Departed Open','2020-01-01',null,'${manager}','Named Manager','${digest("9")}');`);
  const replacement = JSON.parse(await sql("postgres", `select public.static_weekly_v2_replace_incumbency('20000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000010','Later Replacement','2026-09-14',13,'${manager}','Named Manager','replace-open-slot')::text`));
  assert.equal(replacement.revision, 14);
  assert.equal(await sql("postgres", "select effective_end::text from public.v_weekly_roster_slot_incumbency_ranges where incumbency_id='30000000-0000-4000-8000-000000000009'"), "2026-09-14");
  assert.equal(await sql("postgres", "select person_name_snapshot from public.v_weekly_roster_slot_incumbency_ranges where slot_id='20000000-0000-4000-8000-000000000009' and effective_end is null"), "Later Replacement");

  const projectionEnvelope = exactProjectionEnvelope(exactDocument);
  const projectionSql = `$$${JSON.stringify(projectionEnvelope)}$$::jsonb`;
  const mismatchedProjection = structuredClone(projectionEnvelope); mismatchedProjection.assignments[0].owner_person_id = "30000000-0000-4000-8000-000000000001"; resealProjectionEnvelope(mismatchedProjection);
  await expectFailure("postgres", `select public.static_weekly_v2_materialize_projection('${v2Publication.data.publication_id}','2026-09-07','${postgresJsonbContentDigest([])}','static-weekly-exact-v2','{}','{}','${digest("6")}',$$${JSON.stringify(mismatchedProjection)}$$::jsonb,14,'${manager}','Named Manager','materialize-v2-mismatch')`, /projection payload|owner facts|exception digest/i);
  const forgedOverlayProjection = structuredClone(projectionEnvelope);
  const forgedOptimizer = { ...forgedOverlayProjection.authority.optimizerResult.assignments[0], planWorkId: "1:unaccepted-overlay", workId: "unaccepted-overlay" };
  forgedOverlayProjection.authority.optimizerResult.assignments.push(forgedOptimizer);
  forgedOverlayProjection.assignments.push({ ...forgedOverlayProjection.assignments[0], plan_work_id: "1:unaccepted-overlay", work_id: "unaccepted-overlay", work_snapshot: { overlayWork: true, locationId: "40000000-0000-4000-8000-000000000001", window: { start: "10:00", end: "11:00" } } });
  resealProjectionEnvelope(forgedOverlayProjection);
  await expectFailure("postgres", `select public.static_weekly_v2_materialize_projection('${v2Publication.data.publication_id}','2026-09-07','${postgresJsonbContentDigest([])}','static-weekly-exact-v2','{}','{}','${digest("6")}',$$${JSON.stringify(forgedOverlayProjection)}$$::jsonb,14,'${manager}','Named Manager','materialize-v2-unaccepted-overlay')`, /canonical baseline work|accepted event overlay|overlay work/i);
  const materialized = JSON.parse(await sql("postgres", `select public.static_weekly_v2_materialize_projection('${v2Publication.data.publication_id}','2026-09-07','${postgresJsonbContentDigest([])}','static-weekly-exact-v2','{}','{}','${digest("6")}',${projectionSql},14,'${manager}','Named Manager','materialize-v2')::text`));
  assert.equal(materialized.revision, 15);
  const occurrenceId = await sql("postgres", `select occurrence_id::text from public.weekly_schedule_occurrences where publication_id='${v2Publication.data.publication_id}' and service_date='2026-09-07' and work_id='work-v2'`);
  assert.match(occurrenceId, /^[0-9a-f-]{36}$/);
  assert.equal(await sql("postgres", `select owner_person_id_snapshot::text from public.weekly_schedule_slot_assignments where version_id='${v2Publication.data.version_id}' and work_id='work-v2'`), "30000000-0000-4000-8000-000000000002", "published weekly assignment retains the optimizer-selected owner");
  assert.equal(await sql("postgres", `select owner_person_id_snapshot::text || '|' || original_actor_person_id::text from public.weekly_schedule_occurrences where occurrence_id='${occurrenceId}'`), "30000000-0000-4000-8000-000000000002|30000000-0000-4000-8000-000000000002", "occurrence derives the canonical effective baseline actor");
  assert.equal(await sql("postgres", `select owner_person_id_snapshot::text from public.weekly_schedule_projection_assignments where occurrence_id='${occurrenceId}'`), "30000000-0000-4000-8000-000000000002", "projection carries the same selected owner");

  // Compensation is a later immutable publication.  It binds the target's
  // template content, rather than requiring impossible digest equality across
  // fresh draft/version UUIDs and a later effective date.
  const rollbackDocument = exactAuthorityDocument("2026-09-14");
  const rollbackDraft = JSON.parse(await sql("postgres", `select public.static_weekly_v2_create_draft('2026-09-14','objective-v2','{}','{}',$$${JSON.stringify(rollbackDocument)}$$::jsonb,15,'${manager}','Named Manager','rollback-clone-draft')::text`));
  await sql("postgres", `select public.static_weekly_v2_update_draft('${rollbackDraft.data.version_id}',$$${JSON.stringify(rollbackDocument)}$$::jsonb,'{"requireVerifiedProximity":true}','{}',1,16,'${manager}','Named Manager','rollback-clone-update')`);
  const rollbackPublication = JSON.parse(await sql("postgres", `select public.static_weekly_v2_publish_draft('${rollbackDraft.data.version_id}',2,17,'${manager}','Named Manager','rollback-clone-publish','rollback_compensation','${v2Publication.data.version_id}')::text`));
  assert.match(await sql("postgres", `select compensates_content_digest from public.weekly_schedule_publications where publication_id='${rollbackPublication.data.publication_id}'`), /^[0-9a-f]{64}$/);
  assert.equal(await sql("postgres", `select compensates_publication_id::text from public.weekly_schedule_publications where publication_id='${rollbackPublication.data.publication_id}'`), v2Publication.data.publication_id);

  const parityDocument = exactAuthorityDocument("2026-11-02");
  const parityDraft = JSON.parse(await sql("postgres", `select public.static_weekly_v2_create_draft('2026-11-02','parity-negative','{}','{}',$$${JSON.stringify(parityDocument)}$$::jsonb,18,'${manager}','Named Manager','parity-negative-create')::text`));
  await sql("postgres", `select set_config('app.static_weekly_draft_command','on',false); delete from public.weekly_schedule_slot_assignments where version_id='${parityDraft.data.version_id}'`);
  await expectFailure("postgres", `select public.static_weekly_v2_publish_draft('${parityDraft.data.version_id}',1,19,'${manager}','Named Manager','parity-negative-publish','supersede',null)`, /relational schedule row counts.*immutable document/i);

  const v2WriteRpcs = [
    "public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)",
    "public.static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text)",
    "public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)",
    "public.static_weekly_v2_apply_exception(text,date,time,time,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid)",
    "public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text)",
    "public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
  ];
  for (const role of ["anon", "authenticated"]) {
    for (const rpc of v2WriteRpcs) {
      assert.equal(await sql("postgres", `select has_function_privilege('${role}','${rpc}','execute')::text`), "false", `${role} must not execute ${rpc}`);
    }
  }
  for (const rpc of v2WriteRpcs) {
    assert.equal(await sql("postgres", `select has_function_privilege('service_role','${rpc}','execute')::text`), "true", `service_role must execute ${rpc}`);
  }
  assert.equal(await sql("postgres", "select has_function_privilege('service_role','public.static_weekly_materialize_draft_document(uuid,jsonb,text,uuid,text)','execute')::text"), "false", "internal draft materialization must remain owner-only");

  await expectFailure("postgres", `set role service_role; insert into public.weekly_schedule_versions(lifecycle_state,effective_start,objective_version,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values ('draft','2026-10-01','bypass','${digest("a")}','${manager}','Named Manager')`, /permission denied|row-level security/i);
  await expectFailure("postgres", "set role service_role; truncate public.weekly_schedule_exception_commands", /permission denied|TRUNCATE is forbidden/i);
  await expectFailure("postgres", `set role service_role; update public.static_weekly_schedule_control set current_revision=99`, /permission denied|row-level security/i);

  assert.equal(await sql("postgres", "select notes from public.daily_schedule_assignments where id='40000000-0000-4000-8000-000000000093'"), "legacy row preserved across scheduler integration", "additive migration must preserve backend daily-schedule history");
  const revisionBeforeReplay = await sql("postgres", "select current_revision::text from public.static_weekly_schedule_control where singleton");
  await applySchedulerMigration("postgres");
  assert.equal(await sql("postgres", "select current_revision::text from public.static_weekly_schedule_control where singleton"), revisionBeforeReplay, "reapplying the integrated migration must not reset populated authority state");
  assert.equal(await sql("postgres", "select notes from public.daily_schedule_assignments where id='40000000-0000-4000-8000-000000000093'"), "legacy row preserved across scheduler integration", "migration replay must preserve backend daily-schedule history");
  assert.equal(await sql("postgres", "select count(*) from pg_constraint where conname='weekly_roster_slot_incumbencies_no_overlap'"), "0", "migration replay must not resurrect the raw-row overlap constraint retired by append-only closure authority");
  assert.equal(await sql("postgres", "select count(*) from public.v_weekly_roster_slot_incumbency_ranges left_range join public.v_weekly_roster_slot_incumbency_ranges right_range on left_range.slot_id=right_range.slot_id and left_range.incumbency_id<right_range.incumbency_id and daterange(left_range.effective_start,coalesce(left_range.effective_end,'infinity'::date),'[)') && daterange(right_range.effective_start,coalesce(right_range.effective_end,'infinity'::date),'[)')"), "0", "closure-aware incumbency ranges must remain non-overlapping after migration replay");
  console.log("static weekly schedule database tests: PASS");
} finally {
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned disposable PostgreSQL state must be removed");
