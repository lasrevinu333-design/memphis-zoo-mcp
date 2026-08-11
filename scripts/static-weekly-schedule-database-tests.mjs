#!/usr/bin/env node
// Full-backend I2 authority probe. Every persisted authority document below is
// produced by compileStaticWeeklySchedule and the production adapter.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { compileStaticWeeklySchedule } from "../src/static-weekly-schedule-compiler.js";
import { adaptCompiledStaticWeeklySchedule, createStaticWeeklyDraftRpcInput, createStaticWeeklyProjectionRpcInput } from "../src/static-weekly-schedule-database-adapter.js";
import { postgresJsonbCanonicalText, postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";

const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_i2_${process.pid}`;
const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const backendFinal = "20260810190000_final_integrated_backend_operational_correction.sql";
const migrationPath = path.resolve(migrationsDir, "20260810200000_static_weekly_scheduler_authority_integrated.sql");
const correctionPath = path.resolve(migrationsDir, "20260810210000_static_weekly_scheduler_three_high_foundation_correction.sql");
const backendMigrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && name <= backendFinal).sort().map((name) => path.resolve(migrationsDir, name));
const manager = { managerId: "10000000-0000-4000-8000-000000000001", managerName: "Named Manager" };
const attestationSecret = "static-weekly-database-test-attestation-secret-0123456789";
process.env.STATIC_WEEKLY_AUTHORITY_ATTESTATION_SECRET = attestationSecret;
const clone = (value) => JSON.parse(JSON.stringify(value));
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `$$${JSON.stringify(value)}$$::jsonb`;
const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 32 * 1024 * 1024, ...options });

function compilerInput({ serviceDate = "2026-10-05", versionId = "60000000-0000-4000-8000-000000000001", publicationId = "70000000-0000-4000-8000-000000000001" } = {}) {
  const slotA = "20000000-0000-4000-8000-000000000001";
  const slotB = "20000000-0000-4000-8000-000000000002";
  const departedOne = "20000000-0000-4000-8000-000000000003";
  const departedTwo = "20000000-0000-4000-8000-000000000004";
  const locationA = "40000000-0000-4000-8000-000000000011";
  const locationB = "40000000-0000-4000-8000-000000000012";
  const availability = (slotId, dayOfWeek, anchor) => ({
    slotId, dayOfWeek, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityProvenance: "database-test-shift-v1",
    maxServiceEffortMinutes: 300, maxServiceEffortProvenance: "database-test-maximum-v1", qualifications: ["general"],
    qualificationProvenance: "database-test-qualification-v1", restrictions: [], restrictionProvenance: "database-test-restriction-v1",
    acceptedRouteAnchorLocationId: anchor, acceptedRouteProvenance: "database-test-route-v1",
  });
  const work = (workId, dayOfWeek, locationId, ownerSlotId, extra = {}) => ({
    workId, dayOfWeek, locationId, locationCodeSnapshot: `DAY_${dayOfWeek}`, locationNameSnapshot: `Area ${dayOfWeek}`,
    window: { start: "08:00", end: "09:00" }, ownerSlotId, serviceEffortMinutes: 20, serviceEffortProvenance: "database-test-service-v1",
    priority: 1, priorityProvenance: "database-test-priority-v1", requiredQualifications: ["general"],
    qualificationProvenance: "database-test-work-qualification-v1", restrictions: [], restrictionProvenance: "database-test-work-restriction-v1", ...extra,
  });
  const assignments = Array.from({ length: 7 }, (_, day) => work(
    day === 0 || day === 6 ? "repeated-departed-round" : `departed-round-${day}`, day, day % 2 ? locationB : locationA,
    day % 2 ? departedTwo : departedOne,
  ));
  assignments.push(work("event-patch-target", 1, locationA, departedOne, {
    locationCodeSnapshot: "PATCH_BASE", locationNameSnapshot: "Patch baseline", window: { start: "10:00", end: "11:00" }, serviceEffortMinutes: 20,
    serviceEffortProvenance: "database-test-patch-base-effort-v1", priority: 1, priorityProvenance: "database-test-patch-base-priority-v1",
    requiredQualifications: ["general"], qualificationProvenance: "database-test-patch-base-qualification-v1", restrictions: [], restrictionProvenance: "database-test-patch-base-restriction-v1",
  }));
  assignments.push(work("optional-open", 4, locationB, departedTwo, { window: { start: "10:00", end: "11:00" }, required: false, coveragePolicy: "permitted_open", requiredQualifications: ["unavailable-optional"] }));
  return {
    serviceDate, timezone: "America/Chicago", exceptions: [],
    proximity: [
      { from: "START_A", to: locationA, minutes: 1, verified: true, provenance: "database-test-route-v1" },
      { from: "START_A", to: locationB, minutes: 4, verified: true, provenance: "database-test-route-v1" },
      { from: "START_B", to: locationA, minutes: 4, verified: true, provenance: "database-test-route-v1" },
      { from: "START_B", to: locationB, minutes: 1, verified: true, provenance: "database-test-route-v1" },
    ],
    slots: [
      { id: slotA, label: "Stable working A", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000001", displayName: "Morgan", effectiveStart: "2020-01-01", effectiveEnd: null }] },
      { id: slotB, label: "Stable working B", incumbencies: [
        { personId: "30000000-0000-4000-8000-000000000002", displayName: "Jordan Old", effectiveStart: "2020-01-01", effectiveEnd: "2026-10-07" },
        { personId: "30000000-0000-4000-8000-000000000003", displayName: "Jordan New", effectiveStart: "2026-10-07", effectiveEnd: null },
      ] },
      { id: departedOne, label: "Departed named origin one", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000004", displayName: "Avery Departed", effectiveStart: "2020-01-01", effectiveEnd: null }] },
      { id: departedTwo, label: "Departed named origin two", incumbencies: [{ personId: "30000000-0000-4000-8000-000000000005", displayName: "Riley Departed", effectiveStart: "2020-01-01", effectiveEnd: null }] },
    ],
    versions: [{
      id: versionId, publicationId, status: "published", effectiveStart: serviceDate, effectiveEnd: null, objective: { requireVerifiedProximity: true },
      namedAbsentSlotIds: [departedOne, departedTwo],
      slotAvailability: Array.from({ length: 7 }, (_, day) => [availability(slotA, day, "START_A"), availability(slotB, day, "START_B")]).flat(), assignments,
    }],
  };
}

async function sql(statement) {
  if (Buffer.byteLength(statement) > 96 * 1024) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres"]);
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(Object.assign(new Error(`psql exited ${code}`), { stdout, stderr })));
      child.stdin.end(statement);
    });
  }
  const { stdout } = await docker(["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", "postgres", "-c", statement]);
  return stdout.trim();
}
const scalar = async (statement) => (await sql(statement)).split("\n").at(-1);
async function expectFailure(statement, pattern) {
  await assert.rejects(() => sql(statement), (error) => pattern.test(`${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`));
}
async function authorityMutationState() {
  return JSON.parse(await scalar(`select jsonb_build_object(
    'revision',(select current_revision from public.static_weekly_schedule_control where singleton),
    'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',version_id,'revision',revision,'digest',content_digest,'document_digest',public.static_weekly_digest_jsonb(draft_document)) order by version_id),'[]'::jsonb) from public.weekly_schedule_versions),
    'authority_revisions',(select count(*) from public.weekly_schedule_authority_revisions),
    'receipts',(select count(*) from public.weekly_schedule_command_receipts),
    'publications',(select count(*) from public.weekly_schedule_publications),
    'exceptions',(select count(*) from public.weekly_schedule_exception_commands),
    'projections',(select count(*) from public.weekly_schedule_compiled_projections),
    'occurrences',(select count(*) from public.weekly_schedule_occurrences),
    'projection_assignments',(select count(*) from public.weekly_schedule_projection_assignments),
    'draft_assignments',(select count(*) from public.weekly_schedule_slot_assignments),
    'availability',(select count(*) from public.weekly_schedule_slot_availability)
  )::text`));
}
async function expectNoMutation(statement, pattern, label) {
  const before = await authorityMutationState();
  await expectFailure(statement, pattern);
  assert.deepEqual(await authorityMutationState(), before, `${label}: targeted authority validation leaves no partial revision or relational write`);
}
function refreshDocumentValidation(document) {
  document.validation.authority_digest = postgresJsonbContentDigest(document.authority);
  document.validation.solution_digest = postgresJsonbContentDigest(document.authority.optimizerResult);
  document.validation.input_digest = document.authority.inputDigest;
  document.validation.replay_digest = document.receipt.compiler.replayDigest;
  document.validation.receipt_digest = postgresJsonbContentDigest(document.receipt);
  document.validation.database_document_identity = postgresJsonbContentDigest({
    adapter: document.adapter, authority: document.authority, receipt: document.receipt,
    slot_availability: document.slot_availability, assignments: document.assignments, objective_inputs: document.objective_inputs, semantic_snapshot: document.semantic_snapshot,
  });
  return document;
}
function signAttestation(scope, payload) {
  return {
    schema: "memphis-zoo.static-weekly-authority-attestation.v1", key_id: "static-weekly-authority-hmac-v1", scope,
    payload_digest: postgresJsonbContentDigest(payload),
    signature: createHmac("sha256", attestationSecret).update(`${scope}\n${postgresJsonbCanonicalText(payload)}`, "utf8").digest("hex"),
  };
}
function refreshDocumentAttestation(document) {
  refreshDocumentValidation(document);
  document.attestation = signAttestation("recurring_document", {
    adapter: document.adapter, authority: document.authority, receipt: document.receipt,
    slot_availability: document.slot_availability, assignments: document.assignments,
    objective_inputs: document.objective_inputs, semantic_snapshot: document.semantic_snapshot,
  });
  return document;
}
function refreshProjectionIdentity(envelope, { attest = true } = {}) {
  // A trusted fixture that deliberately exercises lower projection validation
  // must keep the signed semantic snapshot coherent.  The untrusted caller
  // probes below pass attest:false and therefore cannot forge this boundary.
  if (attest && envelope.semantic_snapshot) envelope.semantic_snapshot.active_assignments = clone(envelope.assignments);
  const identity = clone(envelope); delete identity.database_projection_identity; delete identity.attestation;
  envelope.database_projection_identity = postgresJsonbContentDigest(identity);
  if (attest) envelope.attestation = signAttestation("dated_projection", (() => { const payload = clone(envelope); delete payload.attestation; return payload; })());
  return envelope;
}
async function applyAll() { for (const migration of backendMigrations) await sql(fs.readFileSync(migration, "utf8")); }
async function applyI2() { await sql(fs.readFileSync(migrationPath, "utf8")); }
async function applyCorrection() { await sql(fs.readFileSync(correctionPath, "utf8")); }
async function serviceRpc(name, argsSql) { return JSON.parse(await scalar(`set role service_role; select public.${name}(${argsSql})::text`)); }

let removed = false;
try {
  assert.equal(backendMigrations.length, 62, "the full backend migration chain through 190000 is required");
  await docker(["image", "inspect", "supabase/postgres:17.6.1.143"]);
  await docker(["run", "--rm", "-d", "--name", container, "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "-e", "POSTGRES_PASSWORD=postgres", "supabase/postgres:17.6.1.143", "-c", "shared_preload_libraries=pg_cron,pg_net,pg_stat_statements"]);
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await sql("select 1");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await sql("select 1");
      const health = (await docker(["inspect", container, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}"]))?.stdout?.trim();
      if (!health || health === "healthy") { await new Promise((resolve) => setTimeout(resolve, 10_000)); await sql("select 1"); ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("owned PostgreSQL did not start");
  await sql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  await applyAll();
  await applyI2();
  await applyCorrection();
  await sql(`select public.static_weekly_configure_authority_attestation_key(${quote(attestationSecret)},'static-weekly-database-test');`);

  const source = compilerInput();
  const compiled = await compileStaticWeeklySchedule(source);
  assert.equal(compiled.status, "FEASIBLE", JSON.stringify(compiled.fatal || compiled.verifier)); assert.equal(compiled.verifier.ok, true);
  for (const [index, slot] of source.slots.entries()) {
    await sql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(`SLOT_${index}`)},${quote(slot.label)},${quote(manager.managerId)},${quote(manager.managerName)},repeat('${String.fromCharCode(97 + index)}',64));`);
    for (const incumbent of slot.incumbencies) await sql(`insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,effective_end,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values(${quote(slot.id)},${quote(incumbent.personId)},${quote(incumbent.displayName)},${quote(incumbent.effectiveStart)},${incumbent.effectiveEnd ? quote(incumbent.effectiveEnd) : "null"},${quote(manager.managerId)},${quote(manager.managerName)},repeat('f',64));`);
  }

  const v2 = [
    "static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)",
    "static_weekly_v2_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text,text)",
    "static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)",
    "static_weekly_v2_apply_exception(text,date,time without time zone,time without time zone,uuid,uuid,text,jsonb,bigint,uuid,text,text,uuid)",
    "static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text)",
    "static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
  ];
  const acl = JSON.parse(await scalar(`select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'service',has_function_privilege('service_role',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'public',has_function_privilege('public',p.oid,'execute'),'security_definer',p.prosecdef) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly%';`));
  assert.ok(acl.length > 6, "the full effective scheduler graph includes internal helpers as well as RPCs");
  assert.equal(acl.every((row) => !row.anon && !row.authenticated && !row.public), true, "browser and PUBLIC roles execute zero scheduler functions, including security-definer helpers");
  assert.deepEqual(acl.filter((row) => row.service).map((row) => row.signature.replace("public.", "")).sort(), v2.sort(), "service_role executes exactly the six v2 scheduler write RPC signatures across the full inherited graph");
  assert.equal(acl.filter((row) => row.security_definer && (row.anon || row.authenticated || row.public)).length, 0, "no browser role can execute a scheduler security-definer helper");

  const draftInput = createStaticWeeklyDraftRpcInput({ result: compiled, expectedRevision: 0, actor: { ...manager, idempotencyKey: "base-create" } });
  const createArgs = `${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(draftInput.document)},${draftInput.expectedRevision},${quote(draftInput.actorManagerId)},${quote(draftInput.actorManagerName)},${quote(draftInput.idempotencyKey)}`;
  const missingValidation = clone(draftInput.document); delete missingValidation.validation.authority_digest;
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(missingValidation)},0,${quote(manager.managerId)},${quote(manager.managerName)},'missing-validation-authority')`, /validation|document|exact/i, "missing required validation field");
  const nullValidation = clone(draftInput.document); nullValidation.validation.authority_digest = null;
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(nullValidation)},0,${quote(manager.managerId)},${quote(manager.managerName)},'null-validation-authority')`, /validation|document|exact/i, "JSON-null required validation field");
  const missingReceipt = refreshDocumentValidation(clone(draftInput.document)); delete missingReceipt.receipt.compiler.canonicalAuthority; refreshDocumentValidation(missingReceipt);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(missingReceipt)},0,${quote(manager.managerId)},${quote(manager.managerName)},'missing-receipt-authority')`, /attestation|receipt|compiler|exact/i, "missing required receipt field");
  const nullReceipt = refreshDocumentValidation(clone(draftInput.document)); nullReceipt.receipt.compiler.canonicalAuthority = null; refreshDocumentValidation(nullReceipt);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(nullReceipt)},0,${quote(manager.managerId)},${quote(manager.managerName)},'null-receipt-authority')`, /attestation|receipt|compiler|exact/i, "JSON-null required receipt field");
  const forgedDraftQualification = clone(draftInput.document);
  forgedDraftQualification.assignments[0].required_qualifications_snapshot = ["FORGED_DRAFT_QUALIFICATION"];
  forgedDraftQualification.semantic_snapshot.relational_assignments[0].required_qualifications_snapshot = ["FORGED_DRAFT_QUALIFICATION"];
  refreshDocumentValidation(forgedDraftQualification);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(forgedDraftQualification)},0,${quote(manager.managerId)},${quote(manager.managerName)},'forged-draft-qualification')`, /attestation/i, "FORGED_DRAFT_QUALIFICATION with recomputed public identities is rejected before relational materialization");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(draftInput.document)},0,null,${quote(manager.managerName)},'missing-create-actor')`, /actor identity|idempotency/i, "missing create actor identity");
  const draft = await serviceRpc("static_weekly_v2_create_draft", createArgs);
  assert.equal(draft.revision, 1);
  assert.deepEqual(await serviceRpc("static_weekly_v2_create_draft", createArgs), draft, "successful create retry returns its original receipt after state advances");
  await expectFailure(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftInput.effectiveStart)},${quote(draftInput.objectiveVersion)},'{"changed":true}'::jsonb,${json(draftInput.inputProvenance)},${json(draftInput.document)},0,${quote(manager.managerId)},${quote(manager.managerName)},'base-create')`, /idempotency key/i);
  await expectFailure(`set role service_role; select public.static_weekly_v2_create_draft('2026-12-01','fake','{}','{}','{}',1,${quote(manager.managerId)},${quote(manager.managerName)},'fake-authority')`, /trusted|compiler|adapter|authority/i);
  const altered = clone(draftInput.document); altered.authority.optimizerResult.assignments[0].personId = "30000000-0000-4000-8000-000000000099";
  await expectFailure(`set role service_role; select public.static_weekly_v2_create_draft('2026-12-08',${quote(draftInput.objectiveVersion)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},${json(altered)},1,${quote(manager.managerId)},${quote(manager.managerName)},'altered-authority')`, /attestation|identity|authority|optimizer/i);

  // Two independently valid drafts must never be cross-bound by an update.
  const siblingSource = compilerInput({ versionId: "60000000-0000-4000-8000-000000000004", publicationId: "70000000-0000-4000-8000-000000000004" });
  const siblingCompiled = await compileStaticWeeklySchedule(siblingSource);
  const siblingDraftInput = createStaticWeeklyDraftRpcInput({ result: siblingCompiled, expectedRevision: 1, actor: { ...manager, idempotencyKey: "sibling-create" } });
  const siblingDraft = await serviceRpc("static_weekly_v2_create_draft", `${quote(siblingDraftInput.effectiveStart)},${quote(siblingDraftInput.objectiveVersion)},${json(siblingDraftInput.objective)},${json(siblingDraftInput.inputProvenance)},${json(siblingDraftInput.document)},1,${quote(manager.managerId)},${quote(manager.managerName)},'sibling-create'`);
  assert.equal(siblingDraft.revision, 2, "independent sibling draft has its own authority revision");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_update_draft(${quote(draft.data.version_id)},${json(siblingDraftInput.document)},${json(siblingDraftInput.objective)},${json(siblingDraftInput.inputProvenance)},1,2,${quote(manager.managerId)},${quote(manager.managerName)},'cross-version-update')`, /compiler version identity|p_version_id|version identity/i, "cross-version complete document update");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_update_draft(${quote(draft.data.version_id)},${json(draftInput.document)},${json(draftInput.objective)},${json(draftInput.inputProvenance)},1,2,${quote(manager.managerId)},'   ','blank-update-actor-name')`, /actor identity|actor name|idempotency/i, "blank update actor name");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_publish_draft(${quote(draft.data.version_id)},1,2,${quote(manager.managerId)},${quote(manager.managerName)},'',null,null)`, /actor identity|idempotency/i, "blank publish idempotency key");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_publish_draft(${quote(draft.data.version_id)},1,2,${quote(manager.managerId)},${quote(manager.managerName)},'null-publication-kind',null,null)`, /invalid publication kind/i, "null publication kind");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_publish_draft(${quote(draft.data.version_id)},1,2,${quote(manager.managerId)},${quote(manager.managerName)},'mislabeled-first-supersede','supersede',null)`, /first weekly authority publication.*publish/i, "the first publication cannot be mislabeled supersede");
  const publication = await serviceRpc("static_weekly_v2_publish_draft", `${quote(draft.data.version_id)},1,2,${quote(manager.managerId)},${quote(manager.managerName)},'base-publish','publish',null`);
  assert.equal(publication.revision, 3, "revision-1 draft publishes directly through service_role after sibling draft cross-binding proof");
  assert.equal(publication.data.version_id, source.versions[0].id, "compiler weekly version identity is the immutable database version identity");
  assert.equal(publication.data.publication_id, source.versions[0].publicationId, "compiler publication identity is the immutable database publication identity");

  // A second real compiler result exercises update_draft without weakening the
  // direct revision-1 publication proof above.
  const futureSource = compilerInput({ serviceDate: "2026-10-12", versionId: "60000000-0000-4000-8000-000000000002", publicationId: "70000000-0000-4000-8000-000000000002" });
  const futureCompiled = await compileStaticWeeklySchedule(futureSource);
  const futureDraftInput = createStaticWeeklyDraftRpcInput({ result: futureCompiled, expectedRevision: 3, actor: { ...manager, idempotencyKey: "future-create" } });
  const futureDraft = await serviceRpc("static_weekly_v2_create_draft", `${quote(futureDraftInput.effectiveStart)},${quote(futureDraftInput.objectiveVersion)},${json(futureDraftInput.objective)},${json(futureDraftInput.inputProvenance)},${json(futureDraftInput.document)},3,${quote(manager.managerId)},${quote(manager.managerName)},'future-create'`);
  const update = await serviceRpc("static_weekly_v2_update_draft", `${quote(futureDraft.data.version_id)},${json(futureDraftInput.document)},${json(futureDraftInput.objective)},${json(futureDraftInput.inputProvenance)},1,4,${quote(manager.managerId)},${quote(manager.managerName)},'future-update'`);
  assert.equal(update.revision, 5);

  // A real accepted dated event may materialize a projection, but it must not
  // ever be accepted as a recurring draft document (at either draft RPC).
  const draftOverlaySource = compilerInput({ serviceDate: "2026-10-12", versionId: "60000000-0000-4000-8000-000000000003", publicationId: "70000000-0000-4000-8000-000000000003" });
  draftOverlaySource.exceptions = [{
    id: "80000000-0000-4000-8000-000000000003", type: "event_impact", status: "accepted", serviceDate: "2026-10-13",
    baseVersionId: draftOverlaySource.versions[0].id, publicationId: draftOverlaySource.versions[0].publicationId, actorId: manager.managerId,
    reason: "draft boundary event", idempotencyKey: "draft-boundary-event", expectedRevision: 0, acceptedAt: "2026-10-12T12:00:00Z", sequence: 1,
    payload: { addWork: [], patchWork: [{ workId: "event-patch-target", locationId: "40000000-0000-4000-8000-000000000012", locationCodeSnapshot: "DRAFT_EVENT", locationNameSnapshot: "Draft Event Must Not Persist", window: { start: "10:00", end: "11:30" }, serviceEffortMinutes: 45, serviceEffortProvenance: "draft-boundary-event-effort-v1", priority: 2, priorityProvenance: "draft-boundary-event-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "draft-boundary-event-qualification-v1", restrictions: ["draft-boundary-event-restriction"], restrictionProvenance: "draft-boundary-event-restriction-v1" }], removeWorkIds: [] },
  }];
  const draftOverlayCompiled = await compileStaticWeeklySchedule(draftOverlaySource);
  assert.equal(draftOverlayCompiled.status, "FEASIBLE", JSON.stringify(draftOverlayCompiled.fatal || draftOverlayCompiled.verifier)); assert.equal(draftOverlayCompiled.verifier.ok, true);
  const draftOverlayDocument = adaptCompiledStaticWeeklySchedule(draftOverlayCompiled, { requirePublishable: true });
  const draftOverlayProvenance = {
    adapter_schema: "memphis-zoo.static-weekly-database-adapter.v1", compiler_version: draftOverlayCompiled.compilerVersion,
    input_digest: draftOverlayCompiled.inputDigest, baseline_input_digest: draftOverlayCompiled.canonicalAuthority.baselineInputDigest,
    authority_digest: draftOverlayCompiled.authorityDigest, replay_digest: draftOverlayCompiled.replayDigest,
  };
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_create_draft(${quote(draftOverlayCompiled.serviceDate)},${quote(draftOverlayCompiled.compilerVersion)},${json(draftOverlayCompiled.canonicalAuthority.optimizerResult.objective)},${json(draftOverlayProvenance)},${json(draftOverlayDocument)},5,${quote(manager.managerId)},${quote(manager.managerName)},'event-overlay-create-draft')`, /exception-free baseline/i, "accepted exception create draft");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_update_draft(${quote(futureDraft.data.version_id)},${json(draftOverlayDocument)},${json(draftOverlayCompiled.canonicalAuthority.optimizerResult.objective)},${json(draftOverlayProvenance)},2,5,${quote(manager.managerId)},${quote(manager.managerName)},'event-overlay-update-draft')`, /exception-free baseline/i, "accepted exception update draft");
  assert.equal(await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton"), "5", "rejected accepted-exception draft attempts leave authority revision unchanged");

  await expectNoMutation(`set role service_role; select public.static_weekly_v2_apply_exception(null,'2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'null exception type',${json({ slotId: source.slots[0].id })},5,${quote(manager.managerId)},${quote(manager.managerName)},'null-exception-type',null)`, /complete exception|exception semantic/i, "null exception type");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_apply_exception('pto','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'contradictory reverse target',${json({ slotId: source.slots[0].id })},5,${quote(manager.managerId)},${quote(manager.managerName)},'contradictory-reverse-target','80000000-0000-4000-8000-000000000099')`, /reversal target coherence/i, "contradictory non-reverse target");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_apply_exception('pto','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'missing exception actor',${json({ slotId: source.slots[0].id })},5,null,${quote(manager.managerName)},'missing-exception-actor',null)`, /actor identity|idempotency/i, "missing exception actor identity");
  for (const malformed of [
    { type: "pto", starts: "null", ends: "null", payload: {}, label: "targetless PTO" },
    { type: "daily_absence", starts: "null", ends: "null", payload: {}, label: "targetless daily absence" },
    { type: "partial_absence", starts: "'10:00'", ends: "'11:00'", payload: {}, label: "targetless partial absence" },
    { type: "shift_override", starts: "null", ends: "null", payload: {}, label: "targetless shift override" },
    { type: "cover_all", starts: "null", ends: "null", payload: {}, label: "targetless coverall" },
    { type: "lunch", starts: "'12:00'", ends: "'12:30'", payload: {}, label: "targetless lunch" },
    { type: "nine_forty_five_rebalance", starts: "null", ends: "null", payload: { locks: [] }, label: "empty rebalance" },
    { type: "manager_correction", starts: "null", ends: "null", payload: { locks: [] }, label: "empty manager correction" },
    { type: "event_impact", starts: "null", ends: "null", payload: {}, label: "targetless event impact" },
  ]) {
    await expectNoMutation(`set role service_role; select public.static_weekly_v2_apply_exception(${quote(malformed.type)},'2026-10-06',${malformed.starts},${malformed.ends},${quote(publication.data.version_id)},${quote(publication.data.publication_id)},${quote(malformed.label)},${json(malformed.payload)},5,${quote(manager.managerId)},${quote(manager.managerName)},${quote(`malformed-${malformed.type}`)},null)`, /requires|payload|exact|working|nonempty/i, `${malformed.label}: rejected atomically before authority advancement`);
  }
  const pto = await serviceRpc("static_weekly_v2_apply_exception", `'pto','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'approved seven-day PTO',${json({ slotId: source.slots[0].id })},5,${quote(manager.managerId)},${quote(manager.managerName)},'pto-a',null`);
  const absence = await serviceRpc("static_weekly_v2_apply_exception", `'daily_absence','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'approved adjacent daily absence',${json({ slotId: source.slots[1].id })},6,${quote(manager.managerId)},${quote(manager.managerName)},'absence-b',null`);
  assert.equal(absence.revision, 7);
  await expectFailure(`set role service_role; select public.static_weekly_v2_apply_exception('pto','2026-10-06','10:00','11:00',${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'changed time and reason',${json({ slotId: source.slots[0].id })},5,${quote(manager.managerId)},${quote(manager.managerName)},'pto-a',null)`, /idempotency key/i);

  const eventPayload = {
    removeWorkIds: ["departed-round-1"],
    patchWork: [{
      workId: "event-patch-target", locationId: "40000000-0000-4000-8000-000000000012", locationCodeSnapshot: "EVENT_PATCH", locationNameSnapshot: "Event Patch Exhibit",
      window: { start: "10:00", end: "11:30" }, serviceEffortMinutes: 45, serviceEffortProvenance: "database-test-event-patch-effort-v1",
      priority: 2, priorityProvenance: "database-test-event-patch-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "database-test-event-patch-qualification-v1",
      restrictions: ["event-patch-restriction"], restrictionProvenance: "database-test-event-patch-restriction-v1",
    }],
    addWork: [{
      workId: "event-added-work", dayOfWeek: 1, originSlotId: source.slots[2].id, locationId: "40000000-0000-4000-8000-000000000011", locationCodeSnapshot: "EVENT_ADD", locationNameSnapshot: "Event Added Exhibit",
      window: { start: "12:00", end: "13:00" }, serviceEffortMinutes: 30, serviceEffortProvenance: "database-test-event-add-effort-v1",
      priority: 1, priorityProvenance: "database-test-event-add-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "database-test-event-add-qualification-v1",
      restrictions: ["event-add-restriction"], restrictionProvenance: "database-test-event-add-restriction-v1",
    }],
  };
  const eventArgs = `'event_impact','2026-10-05',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'accepted event remove patch add',${json(eventPayload)},7,${quote(manager.managerId)},${quote(manager.managerName)},'event-impact-a',null`;
  const event = await serviceRpc("static_weekly_v2_apply_exception", eventArgs);
  assert.equal(event.revision, 8, "accepted event is an authority revision and has receipt-stable replay");
  assert.deepEqual(await serviceRpc("static_weekly_v2_apply_exception", eventArgs), event, "accepted event replay returns its original receipt");

  const accepted = JSON.parse(await scalar(`select public.static_weekly_accepted_exception_set(${quote(publication.data.publication_id)},'2026-10-05')::text`));
  const compilerExceptions = JSON.parse(await scalar(`select public.static_weekly_compiler_exception_set(${quote(publication.data.publication_id)},'2026-10-05')::text`));
  assert.equal(accepted.length, 3, "the accepted exception identity covers PTO, absence, and the event command across the weekly set");
  const overlaySource = clone(source); overlaySource.exceptions = compilerExceptions;
  const overlayCompiled = await compileStaticWeeklySchedule(overlaySource);
  assert.equal(overlayCompiled.verifier.ok, true);
  assert.equal(overlayCompiled.weeklyAssignments.some((assignment) => assignment.status === "REVIEW"), true, "overlay compiler sees both adjacent dated absences across the joint week");
  assert.equal(overlayCompiled.weeklyAssignments.some((assignment) => assignment.planWorkId === "1:departed-round-1"), false, "accepted event removal eliminates the baseline work before optimization");
  assert.equal(overlayCompiled.weeklyAssignments.some((assignment) => assignment.planWorkId === "1:event-added-work"), true, "accepted event addition reaches the active seven-day program");
  const projectionInput = createStaticWeeklyProjectionRpcInput({ result: overlayCompiled, publicationId: publication.data.publication_id, expectedRevision: 8, actor: { ...manager, idempotencyKey: "weekly-projection" } });
  const projectionArgs = `${quote(projectionInput.publicationId)},${quote(projectionInput.serviceDate)},${quote(projectionInput.exceptionSetDigest)},${quote(projectionInput.compilerVersion)},${json(projectionInput.objective)},${json(projectionInput.metrics)},${quote(projectionInput.replayDigest)},${json(projectionInput.envelope)},${projectionInput.expectedRevision},${quote(manager.managerId)},${quote(manager.managerName)},${quote(projectionInput.idempotencyKey)}`;
  const projectionStatement = (input, idempotencyKey, expectedRevision = 8) => `set role service_role; select public.static_weekly_v2_materialize_projection(${quote(input.publicationId)},${quote(input.serviceDate)},${quote(input.exceptionSetDigest)},${quote(input.compilerVersion)},${json(input.objective)},${json(input.metrics)},${quote(input.replayDigest)},${json(input.envelope)},${expectedRevision},${quote(manager.managerId)},${quote(manager.managerName)},${quote(idempotencyKey)})`;
  async function expectMalformedProjection({ label, idempotencyKey, pattern, mutate }) {
    const forged = clone(projectionInput);
    mutate(forged.envelope.assignments.find((row) => row.plan_work_id === "1:event-patch-target"));
    refreshProjectionIdentity(forged.envelope);
    await expectNoMutation(projectionStatement(forged, idempotencyKey), pattern, label);
  }
  for (const proof of [
    { label: "blank plan_work_id", idempotencyKey: "blank-plan-work-id", pattern: /nonblank string plan_work_id and work_id/i, mutate: (row) => { row.plan_work_id = "   "; } },
    { label: "non-string plan_work_id", idempotencyKey: "number-plan-work-id", pattern: /nonblank string plan_work_id and work_id/i, mutate: (row) => { row.plan_work_id = 1; } },
    { label: "missing work_id", idempotencyKey: "missing-work-id", pattern: /every identity, status, snapshot, and explanation key/i, mutate: (row) => { delete row.work_id; } },
    { label: "non-string work_id", idempotencyKey: "number-work-id", pattern: /nonblank string plan_work_id and work_id/i, mutate: (row) => { row.work_id = 1; } },
    { label: "fractional day_of_week", idempotencyKey: "fractional-day-of-week", pattern: /integer day_of_week values from 0 through 6/i, mutate: (row) => { row.day_of_week = 1.5; } },
    { label: "out-of-range day_of_week", idempotencyKey: "out-of-range-day-of-week", pattern: /integer day_of_week values from 0 through 6/i, mutate: (row) => { row.day_of_week = 7; } },
    { label: "non-number day_of_week", idempotencyKey: "string-day-of-week", pattern: /integer day_of_week values from 0 through 6/i, mutate: (row) => { row.day_of_week = "1"; } },
    { label: "malformed service_date", idempotencyKey: "malformed-service-date", pattern: /canonical valid seven-day service_date/i, mutate: (row) => { row.service_date = "not-a-date"; } },
    { label: "impossible service_date", idempotencyKey: "impossible-service-date", pattern: /canonical valid seven-day service_date/i, mutate: (row) => { row.service_date = "2026-02-30"; } },
    { label: "noncanonical service_date", idempotencyKey: "noncanonical-service-date", pattern: /canonical valid seven-day service_date/i, mutate: (row) => { row.service_date = "2026-10-5"; } },
    { label: "out-of-horizon service_date", idempotencyKey: "out-of-horizon-service-date", pattern: /canonical valid seven-day service_date/i, mutate: (row) => { row.service_date = "2026-10-12"; } },
    { label: "missing explanation", idempotencyKey: "missing-explanation", pattern: /every identity, status, snapshot, and explanation key/i, mutate: (row) => { delete row.explanation; } },
    { label: "null explanation", idempotencyKey: "null-explanation", pattern: /object explanation facts/i, mutate: (row) => { row.explanation = null; } },
    { label: "non-object explanation", idempotencyKey: "array-explanation", pattern: /object explanation facts/i, mutate: (row) => { row.explanation = []; } },
  ]) await expectMalformedProjection(proof);
  const missingProjectionStatus = clone(projectionInput); delete missingProjectionStatus.envelope.assignments[0].status; refreshProjectionIdentity(missingProjectionStatus.envelope);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(missingProjectionStatus.publicationId)},${quote(missingProjectionStatus.serviceDate)},${quote(missingProjectionStatus.exceptionSetDigest)},${quote(missingProjectionStatus.compilerVersion)},${json(missingProjectionStatus.objective)},${json(missingProjectionStatus.metrics)},${quote(missingProjectionStatus.replayDigest)},${json(missingProjectionStatus.envelope)},8,${quote(manager.managerId)},${quote(manager.managerName)},'missing-projection-status')`, /projection assignments|status-bearing|complete typed/i, "missing projection assignment status");
  const nullProjectionStatus = clone(projectionInput); nullProjectionStatus.envelope.assignments[0].status = null; refreshProjectionIdentity(nullProjectionStatus.envelope);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(nullProjectionStatus.publicationId)},${quote(nullProjectionStatus.serviceDate)},${quote(nullProjectionStatus.exceptionSetDigest)},${quote(nullProjectionStatus.compilerVersion)},${json(nullProjectionStatus.objective)},${json(nullProjectionStatus.metrics)},${quote(nullProjectionStatus.replayDigest)},${json(nullProjectionStatus.envelope)},8,${quote(manager.managerId)},${quote(manager.managerName)},'null-projection-status')`, /projection assignments|status-bearing|complete typed/i, "JSON-null projection assignment status");
  const missingWorkSnapshotField = clone(projectionInput); delete missingWorkSnapshotField.envelope.assignments.find((row) => row.plan_work_id === "1:event-patch-target").work_snapshot.serviceEffortProvenance; refreshProjectionIdentity(missingWorkSnapshotField.envelope);
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(missingWorkSnapshotField.publicationId)},${quote(missingWorkSnapshotField.serviceDate)},${quote(missingWorkSnapshotField.exceptionSetDigest)},${quote(missingWorkSnapshotField.compilerVersion)},${json(missingWorkSnapshotField.objective)},${json(missingWorkSnapshotField.metrics)},${quote(missingWorkSnapshotField.replayDigest)},${json(missingWorkSnapshotField.envelope)},8,${quote(manager.managerId)},${quote(manager.managerName)},'missing-work-snapshot-field')`, /work snapshots|semantic authority|canonical optimizer/i, "missing required semantic work snapshot field");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(projectionInput.publicationId)},${quote(projectionInput.serviceDate)},${quote(projectionInput.exceptionSetDigest)},${quote(projectionInput.compilerVersion)},${json(projectionInput.objective)},${json(projectionInput.metrics)},${quote(projectionInput.replayDigest)},${json(projectionInput.envelope)},8,${quote(manager.managerId)},'   ','blank-projection-actor-name')`, /actor identity|actor name|idempotency/i, "blank materialization actor name");
  const projection = await serviceRpc("static_weekly_v2_materialize_projection", projectionArgs);
  assert.equal(projection.revision, 9);
  assert.deepEqual(await serviceRpc("static_weekly_v2_materialize_projection", projectionArgs), projection, "successful projection retry survives later state advancement");
  assert.equal(await scalar(`select count(*) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and service_date between '2026-10-05' and '2026-10-11'`), String(overlayCompiled.weeklyAssignments.length), "one projection stores the complete seven-day optimizer horizon");
  assert.equal(await scalar(`select count(*) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and work_id='departed-round-1' and day_of_week=1`), "0", "removed event work produces no persisted occurrence");
  assert.equal(await scalar(`select count(*) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and state in ('open','review') and (owner_slot_id is not null or owner_person_id_snapshot is not null or owner_name_snapshot is not null)`), "0", "OPEN/REVIEW rows cannot inherit the preceding ASSIGNED owner state");
  assert.equal(await scalar(`select count(*) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and state='review'`), "1", "the unrelated PTO/absence review is retained as an optimizer result rather than caller-authored data");
  const persistedEventFacts = JSON.parse(await scalar(`select jsonb_build_object(
    'patched', (select jsonb_build_object('assignment_id',assignment_id,'location_id',location_id,'location_code_snapshot',location_code_snapshot,'location_name_snapshot',location_name_snapshot,'coverage_start',to_char(coverage_start,'HH24:MI'),'coverage_end',to_char(coverage_end,'HH24:MI')) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and work_id='event-patch-target' and day_of_week=1),
    'added', (select jsonb_build_object('assignment_id',assignment_id,'location_id',location_id,'location_code_snapshot',location_code_snapshot,'location_name_snapshot',location_name_snapshot,'coverage_start',to_char(coverage_start,'HH24:MI'),'coverage_end',to_char(coverage_end,'HH24:MI')) from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and work_id='event-added-work' and day_of_week=1),
    'patched_snapshot', (select projection_envelope#>'{assignments}' from public.weekly_schedule_compiled_projections where projection_id=${quote(projection.data.projection_id)})
  )::text`));
  assert.deepEqual(persistedEventFacts.patched, { assignment_id: await scalar(`select assignment_id::text from public.weekly_schedule_slot_assignments where version_id=${quote(publication.data.version_id)} and work_id='event-patch-target' and day_of_week=1`), location_id: "40000000-0000-4000-8000-000000000012", location_code_snapshot: "EVENT_PATCH", location_name_snapshot: "Event Patch Exhibit", coverage_start: "10:00", coverage_end: "11:30" }, "patched occurrence uses active event facts while retaining its baseline assignment link");
  assert.deepEqual(persistedEventFacts.added, { assignment_id: null, location_id: "40000000-0000-4000-8000-000000000011", location_code_snapshot: "EVENT_ADD", location_name_snapshot: "Event Added Exhibit", coverage_start: "12:00", coverage_end: "13:00" }, "event-added work uses active facts and has no fabricated baseline assignment link");
  const persistedPatchedSnapshot = persistedEventFacts.patched_snapshot.find((row) => row.work_id === "event-patch-target" && row.day_of_week === 1)?.work_snapshot;
  assert.deepEqual({ serviceEffortMinutes: persistedPatchedSnapshot?.serviceEffortMinutes, serviceEffortProvenance: persistedPatchedSnapshot?.serviceEffortProvenance, priority: persistedPatchedSnapshot?.priority, priorityProvenance: persistedPatchedSnapshot?.priorityProvenance, requiredQualifications: persistedPatchedSnapshot?.requiredQualifications, qualificationProvenance: persistedPatchedSnapshot?.qualificationProvenance, restrictions: persistedPatchedSnapshot?.restrictions, restrictionProvenance: persistedPatchedSnapshot?.restrictionProvenance, overlayWork: persistedPatchedSnapshot?.overlayWork }, { serviceEffortMinutes: 45, serviceEffortProvenance: "database-test-event-patch-effort-v1", priority: 2, priorityProvenance: "database-test-event-patch-priority-v1", requiredQualifications: ["general"], qualificationProvenance: "database-test-event-patch-qualification-v1", restrictions: ["event-patch-restriction"], restrictionProvenance: "database-test-event-patch-restriction-v1", overlayWork: false }, "persisted projection envelope retains exact active patch qualifications, restrictions, priority, and provenance");
  assert.equal(await scalar(`select owner_person_id_snapshot::text from public.weekly_schedule_occurrences where projection_id=${quote(projection.data.projection_id)} and work_id='departed-round-3' and day_of_week=3`), "30000000-0000-4000-8000-000000000001", "unrelated weekly occurrence retains canonical owner truth");
  const malformedProjection = clone(projectionInput);
  malformedProjection.envelope.assignments.find((row) => row.plan_work_id === "1:event-patch-target").work_snapshot.serviceEffortMinutes = 999;
  refreshProjectionIdentity(malformedProjection.envelope, { attest: false });
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(malformedProjection.publicationId)},${quote(malformedProjection.serviceDate)},${quote(malformedProjection.exceptionSetDigest)},${quote(malformedProjection.compilerVersion)},${json(malformedProjection.objective)},${json(malformedProjection.metrics)},${quote(malformedProjection.replayDigest)},${json(malformedProjection.envelope)},9,${quote(manager.managerId)},${quote(manager.managerName)},'malformed-work-snapshot')`, /attestation/i, "forged numeric SQL work snapshot fact cannot be persisted after public identity recomputation");
  const forgedCallerWorkFact = clone(projectionInput);
  forgedCallerWorkFact.envelope.assignments.find((row) => row.plan_work_id === "1:event-patch-target").work_snapshot.coveragePolicyProvenance = "FORGED_CALLER_WORK_FACT";
  refreshProjectionIdentity(forgedCallerWorkFact.envelope, { attest: false });
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(forgedCallerWorkFact.publicationId)},${quote(forgedCallerWorkFact.serviceDate)},${quote(forgedCallerWorkFact.exceptionSetDigest)},${quote(forgedCallerWorkFact.compilerVersion)},${json(forgedCallerWorkFact.objective)},${json(forgedCallerWorkFact.metrics)},${quote(forgedCallerWorkFact.replayDigest)},${json(forgedCallerWorkFact.envelope)},9,${quote(manager.managerId)},${quote(manager.managerName)},'forged-caller-work-fact')`, /attestation/i, "FORGED_CALLER_WORK_FACT with a recomputed public projection identity is rejected before occurrence mutation");
  await expectNoMutation(`set role service_role; select public.static_weekly_v2_materialize_projection(${quote(projectionInput.publicationId)},${quote(projectionInput.serviceDate)},${quote(projectionInput.exceptionSetDigest)},'forged-compiler',${json(projectionInput.objective)},${json(projectionInput.metrics)},${quote(projectionInput.replayDigest)},${json(projectionInput.envelope)},9,${quote(manager.managerId)},${quote(manager.managerName)},'forged-projection')`, /compiler|identity|projection/i, "forged compiler command identity");

  const reversal = await serviceRpc("static_weekly_v2_apply_exception", `'reverse','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'PTO cancelled',${json({ reversesExceptionId: pto.data.exception_id })},9,${quote(manager.managerId)},${quote(manager.managerName)},'reverse-pto',${quote(pto.data.exception_id)}`);
  assert.equal(reversal.revision, 10);
  const reversalArgs = `'reverse','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'PTO cancelled',${json({ reversesExceptionId: pto.data.exception_id })},9,${quote(manager.managerId)},${quote(manager.managerName)},'reverse-pto',${quote(pto.data.exception_id)}`;
  assert.deepEqual(await serviceRpc("static_weekly_v2_apply_exception", reversalArgs), reversal, "exact successful reversal replay is receipt-stable after mutable reversal validation would otherwise fail");
  await expectFailure(`set role service_role; select public.static_weekly_v2_apply_exception('reverse','2026-10-06',null,null,${quote(publication.data.version_id)},${quote(publication.data.publication_id)},'changed reversal reason',${json({ reversesExceptionId: pto.data.exception_id })},7,${quote(manager.managerId)},${quote(manager.managerName)},'reverse-pto',${quote(pto.data.exception_id)})`, /idempotency key/i);

  await expectNoMutation(`set role service_role; select public.static_weekly_v2_replace_incumbency(${quote(source.slots[1].id)},'30000000-0000-4000-8000-000000000006','Jordan Later','2026-10-19',10,${quote(manager.managerId)},${quote(manager.managerName)},'')`, /actor identity|idempotency/i, "blank replacement idempotency key");
  const replacement = await serviceRpc("static_weekly_v2_replace_incumbency", `${quote(source.slots[1].id)},'30000000-0000-4000-8000-000000000006','Jordan Later','2026-10-19',10,${quote(manager.managerId)},${quote(manager.managerName)},'replace-incumbency'`);
  assert.equal(replacement.operation, "replace_incumbency");
  assert.equal(await scalar(`select operation from public.weekly_schedule_authority_revisions where authority_revision=11`), "replace_incumbency");
  assert.equal(await scalar(`select command_type from public.weekly_schedule_command_receipts where idempotency_key='replace-incumbency'`), "replace_incumbency");

  await expectNoMutation(`set role service_role; select public.static_weekly_v2_publish_draft(${quote(futureDraft.data.version_id)},2,11,${quote(manager.managerId)},${quote(manager.managerName)},'mislabeled-later-publish','publish',null)`, /supersede/i, "a later ordinary replacement cannot be mislabeled publish");
  const supersede = await serviceRpc("static_weekly_v2_publish_draft", `${quote(futureDraft.data.version_id)},2,11,${quote(manager.managerId)},${quote(manager.managerName)},'future-supersede','supersede',null`);
  assert.equal(supersede.operation, "supersede", "a later ordinary replacement is truthfully labeled supersede");
  assert.equal(await scalar(`select closed_at_effective_date::text from public.weekly_schedule_effective_range_closures where closed_version_id=${quote(publication.data.version_id)}`), "2026-10-12", "supersede closes the preceding effective range at the new authority start");
  assert.equal(await scalar(`select publication_kind from public.weekly_schedule_versions where version_id=${quote(futureDraft.data.version_id)}`), "supersede");

  const rollbackSource = compilerInput({ serviceDate: "2026-10-19", versionId: "60000000-0000-4000-8000-000000000005", publicationId: "70000000-0000-4000-8000-000000000005" });
  rollbackSource.slots[1].incumbencies = [
    { personId: "30000000-0000-4000-8000-000000000002", displayName: "Jordan Old", effectiveStart: "2020-01-01", effectiveEnd: "2026-10-07" },
    { personId: "30000000-0000-4000-8000-000000000003", displayName: "Jordan New", effectiveStart: "2026-10-07", effectiveEnd: "2026-10-19" },
    { personId: "30000000-0000-4000-8000-000000000006", displayName: "Jordan Later", effectiveStart: "2026-10-19", effectiveEnd: null },
  ];
  const rollbackCompiled = await compileStaticWeeklySchedule(rollbackSource);
  assert.equal(rollbackCompiled.status, "FEASIBLE", JSON.stringify(rollbackCompiled.fatal || rollbackCompiled.verifier));
  const rollbackDraftInput = createStaticWeeklyDraftRpcInput({ result: rollbackCompiled, expectedRevision: 12, actor: { ...manager, idempotencyKey: "rollback-create" } });
  const rollbackDraft = await serviceRpc("static_weekly_v2_create_draft", `${quote(rollbackDraftInput.effectiveStart)},${quote(rollbackDraftInput.objectiveVersion)},${json(rollbackDraftInput.objective)},${json(rollbackDraftInput.inputProvenance)},${json(rollbackDraftInput.document)},12,${quote(manager.managerId)},${quote(manager.managerName)},'rollback-create'`);
  assert.equal(rollbackDraft.data.version_id, rollbackSource.versions[0].id, "rollback compensation uses a new compiler/database version identity");
  const rollback = await serviceRpc("static_weekly_v2_publish_draft", `${quote(rollbackDraft.data.version_id)},1,13,${quote(manager.managerId)},${quote(manager.managerName)},'rollback-compensation','rollback_compensation',${quote(publication.data.version_id)}`);
  assert.equal(rollback.operation, "rollback", "rollback compensation is reachable through public v2 draft and publish operations");
  assert.equal(rollback.data.rollback_of_version_id, publication.data.version_id, "rollback response preserves the immutable earlier target link");
  assert.equal(await scalar(`select rollback_of_version_id::text from public.weekly_schedule_versions where version_id=${quote(rollbackDraft.data.version_id)}`), publication.data.version_id, "rollback publication links the prior authority without erasing history");
  assert.equal(await scalar(`select closed_at_effective_date::text from public.weekly_schedule_effective_range_closures where closed_version_id=${quote(futureDraft.data.version_id)}`), "2026-10-19", "rollback compensation closes the superseded range with a later effective date");
  assert.deepEqual(await serviceRpc("static_weekly_v2_publish_draft", `${quote(rollbackDraft.data.version_id)},1,13,${quote(manager.managerId)},${quote(manager.managerName)},'rollback-compensation','rollback_compensation',${quote(publication.data.version_id)}`), rollback, "rollback publication retry remains receipt-stable");
  const rollbackProjectionInput = createStaticWeeklyProjectionRpcInput({ result: rollbackCompiled, publicationId: rollback.data.publication_id, expectedRevision: 14, actor: { ...manager, idempotencyKey: "rollback-projection" } });
  const rollbackProjection = await serviceRpc("static_weekly_v2_materialize_projection", `${quote(rollbackProjectionInput.publicationId)},${quote(rollbackProjectionInput.serviceDate)},${quote(rollbackProjectionInput.exceptionSetDigest)},${quote(rollbackProjectionInput.compilerVersion)},${json(rollbackProjectionInput.objective)},${json(rollbackProjectionInput.metrics)},${quote(rollbackProjectionInput.replayDigest)},${json(rollbackProjectionInput.envelope)},14,${quote(manager.managerId)},${quote(manager.managerName)},'rollback-projection'`);
  assert.equal(rollbackProjection.operation, "materialize_projection", "a compensated authority has a truthful new dated projection");
  assert.equal(await scalar(`select owner_person_id_snapshot::text from public.weekly_schedule_occurrences where projection_id=${quote(rollbackProjection.data.projection_id)} and owner_slot_id=${quote(source.slots[1].id)} limit 1`), "30000000-0000-4000-8000-000000000006", "rollback restores the stable recurring schedule while retaining the separately accepted current actual actor");

  await expectFailure("set role service_role; insert into public.weekly_schedule_versions(lifecycle_state,effective_start,objective_version,objective_json,input_provenance_json,draft_document,content_digest,created_by_manager_id,created_by_manager_name_snapshot) values('draft','2027-01-01','bypass','{}','{}','{}',repeat('0',64)," + quote(manager.managerId) + "," + quote(manager.managerName) + ")", /permission denied|row-level security/i);
  assert.equal(await scalar("select count(*) from pg_constraint c join pg_class r on r.oid=c.conrelid where r.relname like 'weekly_%' and c.convalidated=false"), "0", "fresh migration has zero scheduler NOT VALID constraints");
  assert.equal(await scalar("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'static_weekly%' and has_function_privilege('service_role',p.oid,'execute') and p.proname not like 'static_weekly_v2_%'"), "0", "no legacy writer or internal helper remains service-callable");

  const beforeReplay = await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton");
  await applyI2();
  await applyCorrection();
  assert.equal(await scalar("select current_revision::text from public.static_weekly_schedule_control where singleton"), beforeReplay, "migration replay preserves populated immutable authority");
  assert.equal(await scalar("select to_regclass('public.static_weekly_scheduler_cutover_manifest') is null"), "t", "no later-consumer cutover/readiness metadata exists");
  console.log("static weekly schedule database tests: PASS");
} finally {
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned disposable PostgreSQL container must be removed");
