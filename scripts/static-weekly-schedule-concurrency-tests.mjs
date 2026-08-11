#!/usr/bin/env node
// Real multi-session PostgreSQL probes for the static weekly authority seam.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { postgresJsonbContentDigest } from "../src/static-weekly-schedule-compiler.js";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const container = `mz_static_weekly_concurrency_${process.pid}`;
const initialMigration = resolve(process.cwd(), "supabase/migrations/20260810200000_static_weekly_scheduler_authority_integrated.sql");
const managerOne = "10000000-0000-4000-8000-000000000001";
const managerTwo = "10000000-0000-4000-8000-000000000002";
const slot = "20000000-0000-4000-8000-000000000001";
const person = "30000000-0000-4000-8000-000000000001";

const docker = (args, options = {}) => execFileAsync("docker", args, { maxBuffer: 16 * 1024 * 1024, ...options });
const digest = (character) => character.repeat(64);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let port = null;
const activeClients = new Set();

async function execSql(sql) {
  const result = await docker(["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql]);
  return result.stdout;
}
async function client() {
  const connection = new Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres", password: "static-weekly-test" });
  // Preserve the originating assertion/query error if cleanup later stops the
  // disposable server while another client is still unwinding.
  connection.on("error", () => {});
  await connection.connect();
  activeClients.add(connection);
  return connection;
}
async function closeClient(connection) {
  activeClients.delete(connection);
  await connection.end();
}
async function rpc(connection, name, args) {
  const { rows } = await connection.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as result`, args);
  return rows[0].result;
}
async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { await execSql("select 1"); await new Promise((resolve) => setTimeout(resolve, 250)); return; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw new Error("disposable PostgreSQL did not start");
}
function validDocument() {
  const effectiveDate = "2026-09-07";
  const workId = "work-concurrent";
  const planWorkId = `1:${workId}`;
  const locationId = "40000000-0000-4000-8000-000000000001";
  const compilerInput = {
    serviceDate: effectiveDate,
    exceptions: [],
    proximity: [],
    version: {
      id: "concurrency-v1",
      assignments: [{ workId, dayOfWeek: 1, locationId, window: { start: "08:00", end: "09:00" }, ownerSlotId: slot, serviceEffortMinutes: 10, requiredQualifications: ["general"], restrictions: [] }],
      slotAvailability: [{ slotId: slot, dayOfWeek: 1, status: "working", shift: { start: "07:00", end: "16:00" }, productiveCapacityMinutes: 1, qualifications: ["general"], qualificationProvenance: "concurrency", restrictions: [], restrictionProvenance: "concurrency" }],
    },
    slots: [{ id: slot, label: "Stable slot", incumbencies: [{ personId: person, displayName: "Concurrent Person", effectiveStart: "2020-01-01", effectiveEnd: null }] }],
  };
  const ownerDigest = postgresJsonbContentDigest({ planWorkId, slotId: slot, personId: person, serviceDate: effectiveDate });
  const exactOwnerIdentity = postgresJsonbContentDigest({ plan_work_id: planWorkId, service_date: effectiveDate, optimized_owner_slot_id: slot, optimized_owner_person_id: person, baseline_owner_slot_id: slot, baseline_owner_person_id: person });
  const optimizerResult = { assignments: [{ planWorkId, workId, dayOfWeek: 1, serviceDate: effectiveDate, status: "ASSIGNED", slotId: slot, personId: person, displayName: "Concurrent Person", ownerDigest, exactOwnerIdentity, baselineSlotId: slot, baselineOwnerPersonId: person, baselineOwnerName: "Concurrent Person", originalActorPersonId: person, originalActorName: "Concurrent Person", optimizedOwnerSlotId: slot, optimizedOwnerPersonId: person, window: { start: "08:00", end: "09:00" }, serviceEffortMinutes: 10 }] };
  const authority = {
    authority_digest: digest("8"),
    input_digest: postgresJsonbContentDigest(compilerInput),
    baseline_input_digest: postgresJsonbContentDigest(compilerInput),
    replay_digest: digest("6"),
    solution_digest: postgresJsonbContentDigest(optimizerResult),
    effective_date: effectiveDate,
    compiler_input: compilerInput,
    overlay_compiler_input: compilerInput,
    applied_exceptions: [],
    optimizer_result: optimizerResult,
  };
  authority.database_content_identity = postgresJsonbContentDigest(authority);
  const assignment = {
    work_id: workId,
    day_of_week: 1,
    location_id: locationId,
    location_code_snapshot: "TETON",
    location_name_snapshot: "Teton",
    coverage_start: "08:00",
    coverage_end: "09:00",
    owner_slot_id: slot,
    owner_slot_label_snapshot: "Stable slot",
    owner_person_id_snapshot: person,
    owner_name_snapshot: "Concurrent Person",
    required_qualifications_snapshot: ["general"],
    restriction_snapshot: [],
    workload_points: 10,
    workload_provenance: { source: "concurrency" },
    manual_lock: true,
    payload_json: { owner_digest: ownerDigest, exact_owner_identity: exactOwnerIdentity },
  };
  const document = {
    slot_availability: [{ slot_id: slot, day_of_week: 1, availability_state: "working", shift_start: "07:00", shift_end: "16:00", capacity_units: 1, max_load_points: 100, qualification_snapshot: ["general"], qualification_provenance: { source: "concurrency" }, restriction_snapshot: [], restriction_provenance: { source: "concurrency" }, slot_label_snapshot: "Stable slot", incumbent_person_id_snapshot: person, incumbent_name_snapshot: "Concurrent Person" }],
    assignments: [assignment],
    objective_inputs: [{ input_key: "proximity", input_value: { source: "concurrency" }, provenance: { verified: true } }],
    authority,
    validation: { status: "FEASIBLE", replay_digest: authority.replay_digest, input_digest: authority.input_digest, authority_digest: authority.authority_digest, solution_digest: authority.solution_digest, server_computed: true },
  };
  document.validation.database_document_identity = postgresJsonbContentDigest({ effective_date: effectiveDate, authority, slot_availability: document.slot_availability, assignments: document.assignments, objective_inputs: document.objective_inputs });
  return document;
}

let removed = false;
try {
  await docker(["image", "inspect", "postgres:17-alpine"]);
  await docker(["run", "--rm", "-d", "--name", container, "-p", "127.0.0.1::5432", "-e", "POSTGRES_PASSWORD=static-weekly-test", "postgres:17-alpine"]);
  const inspection = JSON.parse((await docker(["inspect", container, "--format", "{{json .NetworkSettings.Ports}}"])).stdout);
  port = Number(inspection["5432/tcp"][0].HostPort);
  await waitForPostgres();
  await docker(["cp", initialMigration, `${container}:/tmp/initial.sql`]);
  await execSql("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  await execSql("\\i /tmp/initial.sql");
  await execSql(`insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values (${quote(slot)},'CONCURRENT','Stable slot',${quote(managerOne)},'Manager One',${quote(digest("c"))}); insert into public.weekly_roster_slot_incumbencies(slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest) values (${quote(slot)},${quote(person)},'Concurrent Person','2020-01-01',${quote(managerOne)},'Manager One',${quote(digest("d"))});`);

  const seed = await client();
  const draft = await rpc(seed, "static_weekly_v2_create_draft", ["2026-09-07", "concurrency-v1", {}, {}, validDocument(), 0, managerOne, "Manager One", "seed-draft"]);
  await rpc(seed, "static_weekly_v2_update_draft", [draft.data.version_id, validDocument(), { requireVerifiedProximity: true }, {}, 1, 1, managerOne, "Manager One", "seed-update"]);
  const publication = await rpc(seed, "static_weekly_v2_publish_draft", [draft.data.version_id, 2, 2, managerOne, "Manager One", "seed-publish", "publish", null]);
  assert.equal(publication.revision, 3);

  // Same actor/key/request: ten independent sockets begin together.  Every
  // call rechecks the receipt after the authority lock and returns one result.
  const duplicateClients = await Promise.all(Array.from({ length: 10 }, () => client()));
  const duplicateCalls = duplicateClients.map((connection) => rpc(connection, "static_weekly_v2_apply_exception", ["pto", "2026-09-08", null, null, publication.data.version_id, publication.data.publication_id, "same key", { slotId: slot }, 3, managerOne, "Manager One", "same-key", null]));
  const duplicateResults = await Promise.all(duplicateCalls);
  await Promise.all(duplicateClients.map((connection) => closeClient(connection)));
  assert.equal(new Set(duplicateResults.map((result) => JSON.stringify(result))).size, 1, "same-key concurrent calls must converge in one bounded attempt");
  assert.equal(Number((await seed.query("select count(*)::int as count from public.weekly_schedule_exception_commands where idempotency_key='same-key' and actor_manager_id=$1", [managerOne])).rows[0].count), 1);
  await assert.rejects(() => rpc(seed, "static_weekly_v2_apply_exception", ["pto", "2026-09-08", null, null, publication.data.version_id, publication.data.publication_id, "different body", { slotId: "different" }, 3, managerOne, "Manager One", "same-key", null]), /idempotency key/i);

  // Different manager commands with the same authority revision are safe: one
  // advances the fence and the other sees a deterministic serialization error.
  const revisionAfterDuplicate = 4;
  const one = await client();
  const two = await client();
  const managers = await Promise.allSettled([
    rpc(one, "static_weekly_v2_apply_exception", ["lunch", "2026-09-08", "12:00", "12:30", publication.data.version_id, publication.data.publication_id, "manager one", { slotId: slot }, revisionAfterDuplicate, managerOne, "Manager One", "manager-one-race", null]),
    rpc(two, "static_weekly_v2_apply_exception", ["lunch", "2026-09-08", "12:00", "12:30", publication.data.version_id, publication.data.publication_id, "manager two", { slotId: slot }, revisionAfterDuplicate, managerTwo, "Manager Two", "manager-two-race", null]),
  ]);
  await closeClient(one); await closeClient(two);
  assert.equal(managers.filter((entry) => entry.status === "fulfilled").length, 1, "two managers cannot both commit at one stale authority revision");
  assert.equal(managers.filter((entry) => entry.status === "rejected").length, 1);

  // A function result is still atomic with its caller transaction.  The later
  // fault erases its revision, receipt, and history; restart/retry then applies
  // exactly once and a later replay is receipt-stable.
  const current = Number((await seed.query("select current_revision from public.static_weekly_schedule_control where singleton")).rows[0].current_revision);
  const fault = await client();
  await fault.query("begin");
  await rpc(fault, "static_weekly_v2_apply_exception", ["manager_correction", "2026-09-08", null, null, publication.data.version_id, publication.data.publication_id, "fault", { locks: [] }, current, managerOne, "Manager One", "fault-retry", null]);
  await assert.rejects(() => fault.query("select 1/0"));
  await fault.query("rollback");
  await closeClient(fault);
  assert.equal(Number((await seed.query("select count(*)::int as count from public.weekly_schedule_command_receipts where idempotency_key='fault-retry'")).rows[0].count), 0, "post-write fault must roll back the receipt");
  const retryConnection = await client();
  const retried = await rpc(retryConnection, "static_weekly_v2_apply_exception", ["manager_correction", "2026-09-08", null, null, publication.data.version_id, publication.data.publication_id, "fault", { locks: [] }, current, managerOne, "Manager One", "fault-retry", null]);
  await closeClient(retryConnection);
  const restartReplay = await rpc(seed, "static_weekly_v2_apply_exception", ["manager_correction", "2026-09-08", null, null, publication.data.version_id, publication.data.publication_id, "fault", { locks: [] }, current, managerOne, "Manager One", "fault-retry", null]);
  assert.deepEqual(restartReplay, retried, "restart/retry must preserve exactly-once response identity");
  await closeClient(seed);
  console.log("static weekly schedule real PostgreSQL concurrency tests: PASS");
} finally {
  await Promise.allSettled([...activeClients].map((connection) => closeClient(connection)));
  await docker(["rm", "-f", container]).catch(() => {});
  removed = true;
}
assert.equal(removed, true, "owned disposable PostgreSQL container must be removed");
