#!/usr/bin/env node
// Complete authority regression suite. It uses one disposable PostgreSQL
// container and intentionally attacks the ordinary service role before proving
// the separately provisioned control-plane role can complete the same flow.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import { createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "../src/static-weekly-schedule-database-adapter.js";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_i2_v3_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const manager = { managerId: "10000000-0000-4000-8000-000000000001", managerName: "Named Manager" };
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `$$${JSON.stringify(value)}$$::jsonb`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });

function sourceInput({ serviceDate = "2026-10-05", versionId = "60000000-0000-4000-8000-000000000001", publicationId = "70000000-0000-4000-8000-000000000001", exceptions = [] } = {}) {
  const a = "20000000-0000-4000-8000-000000000001"; const b = "20000000-0000-4000-8000-000000000002";
  const departedA = "20000000-0000-4000-8000-000000000003"; const departedB = "20000000-0000-4000-8000-000000000004";
  const locationA = "40000000-0000-4000-8000-000000000011"; const locationB = "40000000-0000-4000-8000-000000000012";
  const availability = (slotId, dayOfWeek, anchor) => ({ slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "v3-test-shift", maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "v3-test-capacity", qualifications: ["general"], qualificationProvenance: "v3-test-qualifications", restrictions: [], restrictionProvenance: "v3-test-restrictions", acceptedRouteAnchorLocationId: anchor, acceptedRouteProvenance: "v3-test-route" });
  const work = (workId, dayOfWeek, locationId, ownerSlotId) => ({ workId, dayOfWeek, locationId, locationCodeSnapshot: `DAY_${dayOfWeek}`, locationNameSnapshot: `Area ${dayOfWeek}`, window: { start: "08:00", end: "09:00" }, ownerSlotId, serviceEffortMinutes: 20, serviceEffortProvenance: "v3-test-effort", priority: 1, priorityProvenance: "v3-test-priority", requiredQualifications: ["general"], qualificationProvenance: "v3-test-work-qualifications", restrictions: [], restrictionProvenance: "v3-test-work-restrictions" });
  return {
    serviceDate, timezone: "America/Chicago", exceptions,
    proximity: [{ from: "START_A", to: locationA, minutes: 1, verified: true, provenance: "v3-test-route" }, { from: "START_A", to: locationB, minutes: 4, verified: true, provenance: "v3-test-route" }, { from: "START_B", to: locationA, minutes: 4, verified: true, provenance: "v3-test-route" }, { from: "START_B", to: locationB, minutes: 1, verified: true, provenance: "v3-test-route" }],
    slots: [
      { id: a, label: "Working A", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000001", displayName: "Morgan", effectiveStart: "2020-01-01", effectiveEnd: null }] },
      { id: b, label: "Working B", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000002", displayName: "Jordan Old", effectiveStart: "2020-01-01", effectiveEnd: "2026-10-07" }, { personId: "30000000-0000-4000-8000-000000000003", displayName: "Jordan New", effectiveStart: "2026-10-07", effectiveEnd: null }] },
      { id: departedA, label: "Avery Departed", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000004", displayName: "Avery Departed", effectiveStart: "2020-01-01", effectiveEnd: null }] },
      { id: departedB, label: "Riley Departed", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000005", displayName: "Riley Departed", effectiveStart: "2020-01-01", effectiveEnd: null }] },
    ],
    versions: [{ id: versionId, publicationId, status: "published", effectiveStart: serviceDate, effectiveEnd: null, objective: { requireVerifiedProximity: true }, namedAbsentSlotIds: [departedA, departedB], slotAvailability: Array.from({ length: 7 }, (_, day) => [availability(a, day, "START_A"), availability(b, day, "START_B")]).flat(), assignments: Array.from({ length: 7 }, (_, day) => work(`work-${day}`, day, day % 2 ? locationB : locationA, day % 2 ? departedB : departedA)) }],
  };
}

async function sql(statement) {
  if (Buffer.byteLength(statement) > 96 * 1024 || /^\s*--/.test(statement)) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
      let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject); child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr }))); child.stdin.end(statement);
    });
  }
  const { stdout } = await docker(["exec", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]); return stdout.trim();
}
const scalar = async (statement) => (await sql(statement)).split("\n").at(-1);
async function expectReject(statement, pattern) { await assert.rejects(() => sql(statement), (error) => pattern.test(`${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`)); }
async function state() { return JSON.parse(await scalar("select jsonb_build_object('revision',(select current_revision from public.static_weekly_schedule_control where singleton),'versions',(select count(*) from public.weekly_schedule_versions),'publications',(select count(*) from public.weekly_schedule_publications),'exceptions',(select count(*) from public.weekly_schedule_exception_commands),'receipts',(select count(*) from public.weekly_schedule_command_receipts),'projections',(select count(*) from public.weekly_schedule_compiled_projections),'occurrences',(select count(*) from public.weekly_schedule_occurrences))::text")); }
async function expectNoMutation(statement, pattern, label) { const before = await state(); await expectReject(statement, pattern); assert.deepEqual(await state(), before, `${label}: rejection must precede revision, receipt, exception, publication, and projection mutation`); }
const cp = (name, args) => `set role static_weekly_control_plane; select public.${name}(${args})::text`;
const release = (name, args) => `set role static_weekly_release_operator; select public.${name}(${args})::text`;

let removed = false;
try {
  await docker(["image", "inspect", "supabase/postgres:17.6.1.143"]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", "supabase/postgres:17.6.1.143", "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) { try { await sql("select 1"); await new Promise((resolve) => setTimeout(resolve, 1_000)); await sql("select 1"); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); } }
  assert.equal(ready, true, "owned PostgreSQL must start before migrations run");
  await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) await sql(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  await sql(`insert into public.ops_manager_managers(manager_id,display_name,roles,active,metadata_json,is_system_principal) values(${quote(manager.managerId)},${quote(manager.managerName)},array['OPS_MANAGER']::text[],true,'{}'::jsonb,false)`);
  const healthBefore = JSON.parse(await scalar(release("static_weekly_v3_authority_health", ""))); assert.equal(healthBefore.ready, false, "release readiness fails closed before key provisioning");
  const keySecret = "static-weekly-v3-disposable-key-012345678901234567890";
  const initialized = JSON.parse(await scalar(release("static_weekly_v3_configure_initial_authority_key", `${quote("static-weekly-authority-hmac-v2")},${quote(keySecret)},'v3-test-release'`))); assert.equal(initialized.ready, true, "release readiness accepts exactly one active control-plane key");
  await expectReject("set role service_role; select public.static_weekly_v3_authority_health()", /permission denied|identity/i);
  await expectReject("set role service_role; select public.static_weekly_v3_issue_attestation('recurring_document','{}'::jsonb)", /permission denied/i);
  const attestationPayload = "{}";
  const issuedAttestation = JSON.parse(await scalar(`select public.static_weekly_v3_issue_attestation('recurring_document','${attestationPayload}'::jsonb)::text`));
  const verifyAttestation = (attestation) => `select public.static_weekly_assert_authority_attestation(${json(attestation)},'recurring_document','${attestationPayload}'::jsonb); select 'verified'`;
  assert.equal(await scalar(verifyAttestation(issuedAttestation)), "verified", "the active versioned key verifies an exact scoped semantic payload");
  for (const [label, signature] of [
    ["malformed", "g".repeat(64)], ["short", "a".repeat(62)], ["long", "a".repeat(66)], ["mixed-case", issuedAttestation.signature.toUpperCase()],
  ]) await expectReject(verifyAttestation({ ...issuedAttestation, signature }), /canonical lower-case fixed-length hex/i);
  await expectReject(verifyAttestation({ ...issuedAttestation, key_id: "static-weekly-authority-hmac-v999" }), /unknown, expired, or revoked/i);
  await expectReject(verifyAttestation({ ...issuedAttestation, signature: `${issuedAttestation.signature.slice(0, -1)}${issuedAttestation.signature.endsWith("0") ? "1" : "0"}` }), /does not bind/i);
  const sourceId = "80000000-0000-4000-8000-000000000001";
  const source = sourceInput();
  const compiled = await compileStaticWeeklySchedule(source); assert.equal(compiled.status, "FEASIBLE"); assert.equal(compiled.verifier.ok, true);
  await scalar(release("static_weekly_v3_register_authority_source", `${quote(sourceId)},${json(compiled.canonicalAuthority.compilerInput)},'v3-test-source-registration'`));
  for (const [index, slot] of source.slots.entries()) { await sql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(`SLOT_${index}`)},${quote(slot.label)},${quote(manager.managerId)},${quote(manager.managerName)},repeat('${String.fromCharCode(97 + index)}',64))`); for (const incumbent of slot.incumbencies) await sql(`insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(incumbent.personId)},${quote(incumbent.displayName)},${quote(incumbent.effectiveStart)},${incumbent.effectiveEnd ? quote(incumbent.effectiveEnd) : "null"},${quote(manager.managerId)},${quote(manager.managerName)},repeat('f',64))`); }
  const draft = createStaticWeeklyDraftRpcInput({ result: compiled, expectedRevision: 0, actor: { ...manager, idempotencyKey: "v3-create" } });
  await expectReject(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective)},${json(draft.inputProvenance)},${json(draft.document)},0,${quote(manager.managerId)},${quote(manager.managerName)},'forged-v2')`, /permission denied/i);
  const forgedDocument = clone(draft.document); forgedDocument.semantic_snapshot.recurring_source.slots[0].label = "forged caller source";
  await expectNoMutation(cp("static_weekly_v3_create_draft", `${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective)},${json(draft.inputProvenance)},${json(forgedDocument)},0,${quote(manager.managerId)},'forged-v3-source',${quote(sourceId)}`), /registered recurring source|compiler input/i, "forged control-plane compiler source");
  const created = JSON.parse(await scalar(cp("static_weekly_v3_create_draft", `${quote(draft.effectiveStart)},${quote(draft.objectiveVersion)},${json(draft.objective)},${json(draft.inputProvenance)},${json(draft.document)},0,${quote(manager.managerId)},'v3-create',${quote(sourceId)}`)));
  const versionId = created.data.version_id;
  const published = JSON.parse(await scalar(cp("static_weekly_v3_publish_draft", `${quote(versionId)},1,1,${quote(manager.managerId)},'v3-publish','publish',null`)));
  const publicationId = published.data.publication_id;
  assert.equal(await scalar(`select count(*) from public.weekly_schedule_slot_availability where availability_state='departed_named_absent'`), "14", "both departed employees remain named absent placeholders for all seven weekdays");
  const firstProjection = createStaticWeeklyProjectionRpcInput({ result: compiled, publicationId, expectedRevision: 2, actor: { ...manager, idempotencyKey: "v3-projection-first" } });
  await scalar(cp("static_weekly_v3_materialize_projection", `${quote(publicationId)},${quote(firstProjection.serviceDate)},${quote(firstProjection.exceptionSetDigest)},${quote(firstProjection.compilerVersion)},${json(firstProjection.objective)},${json(firstProjection.metrics)},${quote(firstProjection.replayDigest)},${json(firstProjection.envelope)},2,${quote(manager.managerId)},'v3-projection-first'`));
  const secondInput = sourceInput({ serviceDate: "2026-10-12", versionId, publicationId }); const secondCompiled = await compileStaticWeeklySchedule(secondInput); assert.equal(secondCompiled.status, "FEASIBLE", "same recurring publication compiles a second aligned week without republish");
  const secondProjection = createStaticWeeklyProjectionRpcInput({ result: secondCompiled, publicationId, expectedRevision: 3, actor: { ...manager, idempotencyKey: "v3-projection-second" } });
  await scalar(cp("static_weekly_v3_materialize_projection", `${quote(publicationId)},${quote(secondProjection.serviceDate)},${quote(secondProjection.exceptionSetDigest)},${quote(secondProjection.compilerVersion)},${json(secondProjection.objective)},${json(secondProjection.metrics)},${quote(secondProjection.replayDigest)},${json(secondProjection.envelope)},3,${quote(manager.managerId)},'v3-projection-second'`));
  const laterInput = sourceInput({ serviceDate: "2027-01-04", versionId, publicationId }); const laterCompiled = await compileStaticWeeklySchedule(laterInput); assert.equal(laterCompiled.status, "FEASIBLE", "distant week/year boundary recurrence remains publishable");
  const laterProjection = createStaticWeeklyProjectionRpcInput({ result: laterCompiled, publicationId, expectedRevision: 4, actor: { ...manager, idempotencyKey: "v3-projection-later" } });
  await scalar(cp("static_weekly_v3_materialize_projection", `${quote(publicationId)},${quote(laterProjection.serviceDate)},${quote(laterProjection.exceptionSetDigest)},${quote(laterProjection.compilerVersion)},${json(laterProjection.objective)},${json(laterProjection.metrics)},${quote(laterProjection.replayDigest)},${json(laterProjection.envelope)},4,${quote(manager.managerId)},'v3-projection-later'`));
  const invalids = [
    ["cross-weekday event removal", `'event_impact','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'bad',${json({ removeWorkIds: ["work-1"], patchWork: [], addWork: [] })},5,${quote(manager.managerId)},'bad-cross-weekday',null`],
    ["malformed shift", `'shift_override','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'bad',${json({ slotId: source.slots[0].id, status: "working", shift: { start: "garbage", end: false } })},5,${quote(manager.managerId)},'bad-shift',null`],
    ["negative coverall effort", `'cover_all','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'bad',${json({ availability: { slotId: source.slots[0].id, shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "x", maxServiceEffortMinutes: -1, maxServiceEffortProvenance: "x", qualifications: ["general"], qualificationProvenance: "x", restrictions: [], restrictionProvenance: "x", acceptedRouteAnchorLocationId: "40000000-0000-4000-8000-000000000011", acceptedRouteProvenance: "x" } })},5,${quote(manager.managerId)},'bad-cover',null`],
    ["wrong-weekday event", `'event_impact','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'bad',${json({ removeWorkIds: [], patchWork: [], addWork: [{ workId: "bad-event", dayOfWeek: 6, originSlotId: source.slots[0].id, locationId: "40000000-0000-4000-8000-000000000011", locationCodeSnapshot: "E", locationNameSnapshot: "Event", window: { start: "10:00", end: "11:00" }, serviceEffortMinutes: 10, serviceEffortProvenance: "x", priority: 1, priorityProvenance: "x", requiredQualifications: ["general"], qualificationProvenance: "x", restrictions: [], restrictionProvenance: "x" }] })},5,${quote(manager.managerId)},'bad-event',null`],
  ];
  for (const [label, args] of invalids) await expectNoMutation(cp("static_weekly_v3_apply_exception", args), /exception|window|weekday|effort|slot/i, label);
  for (const type of ["pto", "daily_absence", "partial_absence", "shift_override", "cover_all", "lunch", "nine_forty_five_rebalance", "event_impact", "manager_correction", "reverse"]) {
    await expectNoMutation(
      cp("static_weekly_v3_apply_exception", `'${type}','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'malformed ${type}', '{}'::jsonb,5,${quote(manager.managerId)},'malformed-${type}',null`),
      /payload|window|lock|event|slot|reversal/i,
      `malformed ${type} payload`,
    );
  }
  const ptoArgs = `'pto','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'approved PTO',${json({ slotId: source.slots[0].id })},5,${quote(manager.managerId)},'valid-pto',null`;
  const pto = JSON.parse(await scalar(cp("static_weekly_v3_apply_exception", ptoArgs))); assert.equal(pto.revision, 6);
  await expectNoMutation(cp("static_weekly_v3_apply_exception", `'pto','2026-10-06',null,null,${quote(versionId)},${quote(publicationId)},'duplicate PTO',${json({ slotId: source.slots[0].id })},6,${quote(manager.managerId)},'duplicate-pto',null`), /duplicate|conflict|absence/i, "duplicate PTO");

  // A later ordinary publication establishes the only current authority. A
  // rollback must create a later replacement, cannot name the current
  // authority itself, and can only target a non-rollback ancestor in that
  // immutable publication lineage.
  const supersedeSource = sourceInput({ serviceDate: "2027-02-01", versionId: "60000000-0000-4000-8000-000000000006", publicationId: "70000000-0000-4000-8000-000000000006" });
  const supersedeCompiled = await compileStaticWeeklySchedule(supersedeSource); assert.equal(supersedeCompiled.status, "FEASIBLE");
  const supersedeDraftInput = createStaticWeeklyDraftRpcInput({ result: supersedeCompiled, expectedRevision: 6, actor: { ...manager, idempotencyKey: "v3-supersede-create" } });
  const supersedeDraft = JSON.parse(await scalar(cp("static_weekly_v3_create_draft", `${quote(supersedeDraftInput.effectiveStart)},${quote(supersedeDraftInput.objectiveVersion)},${json(supersedeDraftInput.objective)},${json(supersedeDraftInput.inputProvenance)},${json(supersedeDraftInput.document)},6,${quote(manager.managerId)},'v3-supersede-create',${quote(sourceId)}`)));
  const superseded = JSON.parse(await scalar(cp("static_weekly_v3_publish_draft", `${quote(supersedeDraft.data.version_id)},1,7,${quote(manager.managerId)},'v3-supersede-publish','supersede',null`))); assert.equal(superseded.revision, 8);
  const supersededBoundaryInput = sourceInput({ serviceDate: "2027-02-01", versionId, publicationId }); const supersededBoundaryCompiled = await compileStaticWeeklySchedule(supersededBoundaryInput); assert.equal(supersededBoundaryCompiled.status, "FEASIBLE");
  const supersededBoundaryProjection = createStaticWeeklyProjectionRpcInput({ result: supersededBoundaryCompiled, publicationId, expectedRevision: 8, actor: { ...manager, idempotencyKey: "v3-superseded-projection" } });
  await expectNoMutation(cp("static_weekly_v3_materialize_projection", `${quote(publicationId)},${quote(supersededBoundaryProjection.serviceDate)},${quote(supersededBoundaryProjection.exceptionSetDigest)},${quote(supersededBoundaryProjection.compilerVersion)},${json(supersededBoundaryProjection.objective)},${json(supersededBoundaryProjection.metrics)},${quote(supersededBoundaryProjection.replayDigest)},${json(supersededBoundaryProjection.envelope)},8,${quote(manager.managerId)},'v3-superseded-projection'`), /effective publication|aligned complete/i, "superseded publication projection boundary");
  const rollbackSource = sourceInput({ serviceDate: "2027-02-08", versionId: "60000000-0000-4000-8000-000000000007", publicationId: "70000000-0000-4000-8000-000000000007" });
  const rollbackCompiled = await compileStaticWeeklySchedule(rollbackSource); assert.equal(rollbackCompiled.status, "FEASIBLE");
  const rollbackDraftInput = createStaticWeeklyDraftRpcInput({ result: rollbackCompiled, expectedRevision: 8, actor: { ...manager, idempotencyKey: "v3-rollback-create" } });
  const rollbackDraft = JSON.parse(await scalar(cp("static_weekly_v3_create_draft", `${quote(rollbackDraftInput.effectiveStart)},${quote(rollbackDraftInput.objectiveVersion)},${json(rollbackDraftInput.objective)},${json(rollbackDraftInput.inputProvenance)},${json(rollbackDraftInput.document)},8,${quote(manager.managerId)},'v3-rollback-create',${quote(sourceId)}`)));
  await expectNoMutation(cp("static_weekly_v3_publish_draft", `${quote(rollbackDraft.data.version_id)},1,9,${quote(manager.managerId)},'v3-rollback-current','rollback_compensation',${quote(superseded.data.version_id)}`), /distinct current-lineage|rollback/i, "rollback naming the current authority");
  const rollback = JSON.parse(await scalar(cp("static_weekly_v3_publish_draft", `${quote(rollbackDraft.data.version_id)},1,9,${quote(manager.managerId)},'v3-rollback-ancestor','rollback_compensation',${quote(versionId)}`))); assert.equal(rollback.revision, 10);
  const invalidRollbackSource = sourceInput({ serviceDate: "2027-02-15", versionId: "60000000-0000-4000-8000-000000000008", publicationId: "70000000-0000-4000-8000-000000000008" });
  const invalidRollbackCompiled = await compileStaticWeeklySchedule(invalidRollbackSource); assert.equal(invalidRollbackCompiled.status, "FEASIBLE");
  const invalidRollbackDraftInput = createStaticWeeklyDraftRpcInput({ result: invalidRollbackCompiled, expectedRevision: 10, actor: { ...manager, idempotencyKey: "v3-rollback-of-rollback-create" } });
  const invalidRollbackDraft = JSON.parse(await scalar(cp("static_weekly_v3_create_draft", `${quote(invalidRollbackDraftInput.effectiveStart)},${quote(invalidRollbackDraftInput.objectiveVersion)},${json(invalidRollbackDraftInput.objective)},${json(invalidRollbackDraftInput.inputProvenance)},${json(invalidRollbackDraftInput.document)},10,${quote(manager.managerId)},'v3-rollback-of-rollback-create',${quote(sourceId)}`)));
  await expectNoMutation(cp("static_weekly_v3_publish_draft", `${quote(invalidRollbackDraft.data.version_id)},1,11,${quote(manager.managerId)},'v3-rollback-of-rollback','rollback_compensation',${quote(rollbackDraft.data.version_id)}`), /non-rollback|rollback/i, "rollback of a rollback target");
  const postRollbackSupersede = JSON.parse(await scalar(cp("static_weekly_v3_publish_draft", `${quote(invalidRollbackDraft.data.version_id)},1,11,${quote(manager.managerId)},'v3-post-rollback-supersede','supersede',null`))); assert.equal(postRollbackSupersede.revision, 12, "a later ordinary supersession remains valid after one rollback compensation");
  assert.equal(await scalar(`select closed_at_effective_date::text from public.weekly_schedule_effective_range_closures where closed_version_id=${quote(rollbackDraft.data.version_id)} order by created_at desc limit 1`), "2027-02-15", "the later ordinary supersession closes the rollback range at its exact effective boundary");
  const rotation = JSON.parse(await scalar(release("static_weekly_v3_rotate_authority_key", `${quote("static-weekly-authority-hmac-v3")},${quote("static-weekly-v3-rotation-secret-01234567890123456789")},statement_timestamp()+interval '1 hour','v3-test-rotation'`))); assert.equal(rotation.ready, true, "key rotation keeps exactly one active key with bounded overlap");
  assert.equal(await scalar(verifyAttestation(issuedAttestation)), "verified", "the bounded overlap continues to verify outstanding v2 work during rotation");
  await expectReject(release("static_weekly_v3_revoke_authority_key", `${quote("static-weekly-authority-hmac-v3")},'wrong active revoke'`), /non-active/i);
  await scalar(release("static_weekly_v3_revoke_authority_key", `${quote("static-weekly-authority-hmac-v2")},'overlap revoked'`));
  await expectReject(verifyAttestation(issuedAttestation), /unknown, expired, or revoked/i);
  assert.equal((JSON.parse(await scalar(release("static_weekly_v3_authority_health", "")))).ready, true, "revoked overlap cannot downgrade the active key");
  const recovered = JSON.parse(await scalar(release("static_weekly_v3_recover_authority_key", `${quote("static-weekly-authority-hmac-v4")},${quote("static-weekly-v3-recovery-secret-01234567890123456789")},${quote("static-weekly-authority-hmac-v2")},'v3-test-recovery'`)));
  assert.equal(recovered.ready, true, "recovery replaces a failed active key only through a new version tied to a revoked predecessor");
  console.log("static weekly scheduler complete v3 authority tests: PASS");
} finally { await docker(["rm", "-f", container]).catch(() => {}); removed = true; }
assert.equal(removed, true, "worker-owned PostgreSQL container must be removed");
