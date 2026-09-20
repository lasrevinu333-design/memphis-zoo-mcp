#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Intentionally unavailable against a URL, provider database, or general Docker target.
const container = String(process.env.BUILD52_RECOVERY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.BUILD52_RECOVERY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("BUILD52_RECOVERY_TEST_DOCKER_CONTAINER must name an owned disposable mz_schema_rebuild database.");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const secret = `build52-recovery-fixture-${randomUUID()}`;
const nativeSecret = `build52-native-fixture-${randomUUID()}`;
const managerId = "00000000-0000-4000-8000-000000000001";
const deviceId = "KIOSK_08";
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const functions = [
  "public.app_apply_coverall_assignment_policy_v2(jsonb)",
  "public.claim_operational_notification_jobs_v2(text,integer,integer,boolean)",
  "public.claim_operational_notification_jobs(text,integer,integer)",
  "public.pause_guest_notification_job(uuid,uuid)",
  "public.mz_event_reminder_schedule(uuid,integer,uuid,text)",
  "public.mz_enqueue_employee_event_pushes(timestamp with time zone)",
  "public.mz_claim_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)",
];
const constraint = "public.event_push_instances:event_push_instances_notification_kind_check";
const scheduleFunction = functions[4];
const enqueueFunction = functions[5];
const revokedFunction = functions[3];

function sql(statement) {
  const output = execFileSync("docker", [
    "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).trim();
  return output.split("\n").at(-1) || "";
}

function canonicalCheck(phase) {
  const result = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL("./refresh-schema-fingerprint.mjs", import.meta.url)), "--check",
  ], {
    cwd: root,
    // Clear a possibly inherited remote target: this check must use the same disposable DB.
    env: { ...process.env, SCHEMA_FINGERPRINT_MCP_URL: "",
      SCHEMA_FINGERPRINT_DOCKER_CONTAINER: container, SCHEMA_FINGERPRINT_DATABASE: database },
    encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  }).trim());
  assert.equal(result.ok, true, `${phase}: canonical checker did not pass`);
  assert.equal(result.mode, "check", `${phase}: canonical files must never be refreshed by this test`);
  assert.equal(result.checked, true);
  assert.match(result.schema_fingerprint, /^[0-9a-f]{64}$/);
  return result.schema_fingerprint;
}

function health() {
  return JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
}

function assertHealthy(phase) {
  const current = health();
  const evidence = `${phase}: ${JSON.stringify(current)}`;
  assert.equal(current.ok, true, evidence);
  assert.ok(current.checks && Object.keys(current.checks).length > 0, evidence);
  assert.ok(Object.values(current.checks).every((value) => value === true), evidence);
  assert.deepEqual(current.missing_objects, [], evidence);
  assert.deepEqual(current.mismatched_objects, [], evidence);
  assert.deepEqual(current.surface_missing_objects, [], evidence);
  assert.deepEqual(current.surface_uncovered_objects, [], evidence);
  return current;
}

function assertDrift(phase, identity, { missing = false } = {}) {
  const current = health();
  const evidence = `${phase}: ${JSON.stringify(current)}`;
  assert.equal(current.ok, false, evidence);
  const identities = missing ? current.missing_objects : current.mismatched_objects;
  assert.ok(Array.isArray(identities) && identities.includes(identity), evidence);
}

function snapshotOwnedBindings() {
  return JSON.parse(sql(`with required as (
      select signature,to_regprocedure(signature)::text as identity
      from unnest(array[${functions.map(q).join(",")}]) as required(signature)
    ), live as (
      select signature,identity,'function'::text as object_kind,
        pg_get_functiondef(to_regprocedure(signature)) as live_definition from required
      union all
      select signature,identity,'grant',
        public.custodial_release_authority_current_grant_definition(identity) from required
      union all
      select ${q(constraint)},${q(constraint)},'constraint',
        public.custodial_release_authority_current_constraint_definition(${q(constraint)})
    )
    select json_agg(json_build_object(
      'signature',l.signature,'identity',l.identity,'kind',l.object_kind,
      'restore_order',i.restore_order,'definition',i.definition_sql,
      'sha256',i.definition_sha256,'live_definition',l.live_definition,
      'live_sha256',encode(extensions.digest(convert_to(l.live_definition,'UTF8'),'sha256'),'hex')
    ) order by l.object_kind,l.signature)::text
    from live l left join public.custodial_release_authority_restore_inventory i
      on i.object_kind=l.object_kind and i.object_identity=l.identity;`));
}

function assertExactBindings(rows, phase) {
  assert.equal(rows.length, 15, `${phase}: seven functions, seven grants, and the constraint must be captured exactly once`);
  for (const row of rows) {
    const context = `${phase}: ${row.kind} ${row.signature}`;
    assert.ok(row.identity && row.definition && row.live_definition, `${context}: missing live or captured definition`);
    assert.equal(row.definition, row.live_definition, `${context}: captured definition differs from live`);
    assert.equal(row.sha256, row.live_sha256, `${context}: captured digest differs from live`);
    assert.match(row.sha256, /^[0-9a-f]{64}$/, context);
    assert.ok(Number.isInteger(row.restore_order), `${context}: restore order is absent`);
  }
  const functionRow = (signature) => rows.find((row) => row.kind === "function" && row.signature === signature);
  for (const [helper, dependent] of [
    [functions[1], functions[2]], [scheduleFunction, enqueueFunction], [scheduleFunction, functions[6]],
  ]) {
    assert.ok(functionRow(helper).restore_order < functionRow(dependent).restore_order,
      `${phase}: ${helper} must be recreated before ${dependent}`);
  }
  for (const signature of functions) {
    const grantRow = rows.find((row) => row.kind === "grant" && row.signature === signature);
    assert.ok(functionRow(signature).restore_order < grantRow.restore_order,
      `${phase}: a function must exist before its captured grants are replayed: ${signature}`);
  }
}

function control(action, reason) {
  return JSON.parse(sql(`select public.custodial_control_release_canary(
    ${q(managerId)}::uuid,${q(randomUUID())}::uuid,${q(deviceId)},${q(action)},${q(reason)},
    '{"ok":false,"probe":"build52-recovery-binding-regression"}'::jsonb,${q(secret)})::text;`));
}

// Fail before corruption if the supposedly canonical candidate already has stale recovery bindings.
const canonicalBefore = canonicalCheck("before fixture configuration");
assert.equal(canonicalBefore, readFileSync(new URL("../supabase/canonical/schema-fingerprint.txt", import.meta.url), "utf8").trim());
sql(`select public.custodial_configure_backend_execution_key(
  encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'build52-recovery-binding-regression');
  select public.custodial_configure_native_route_proof_key(
  encode(extensions.digest(convert_to(${q(nativeSecret)},'UTF8'),'sha256'),'hex'),'build52-recovery-binding-regression');`);
assertHealthy("initial canonical recovery health");
const before = snapshotOwnedBindings();
assertExactBindings(before, "before corruption");
assert.equal(sql(`select exists(select 1 from public.ops_manager_managers where manager_id=${q(managerId)}::uuid
  and active=true and revoked_at is null and roles && array['DIRECTOR','SECURITY_ADMIN']::text[]);`), "t",
"The existing disposable named-manager fixture is required; this test must not enroll a manager.");
const pause = control("pause_canary", "pause disposable Build52 recovery-binding fixture");
assert.equal(pause.canary_paused, true);
const canonicalIdentity = (signature) => before.find((row) => row.kind === "function" && row.signature === signature).identity;
assert.equal(sql(`select has_function_privilege('service_role',${q(revokedFunction)}::regprocedure,'EXECUTE');`), "t");

let needsRecovery = false;
let restored;
try {
  needsRecovery = true;
  // A permissive replacement admits all existing fixture rows without touching event data.
  sql(`alter table public.event_push_instances drop constraint event_push_instances_notification_kind_check;
    alter table public.event_push_instances add constraint event_push_instances_notification_kind_check check (true);`);
  assertDrift("notification-kind constraint corruption", constraint);

  sql(`create or replace function public.mz_enqueue_employee_event_pushes(p_now timestamp with time zone default now())
    returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
    as $fixture$ begin return '{"ok":false,"build52_fixture_corruption":true}'::jsonb; end $fixture$;`);
  assertDrift("present-but-corrupt event function", canonicalIdentity(enqueueFunction));

  sql(`revoke execute on function ${revokedFunction} from service_role;`);
  assertDrift("revoked current function grant", canonicalIdentity(revokedFunction));

  // No CASCADE: any unexpected dependency is a genuine regression, not silently removed.
  sql(`drop function ${scheduleFunction};`);
  assert.equal(sql(`select to_regprocedure(${q(scheduleFunction)}) is null;`), "t");
  assertDrift("absent new event-schedule helper", canonicalIdentity(scheduleFunction), { missing: true });

  restored = control("restore_authority", "recover exact Build52 function, helper, constraint, and grant bindings");
  assert.equal(restored.canary_paused, true);
  assert.ok(restored.restored_objects >= before.length, JSON.stringify(restored));
  assertHealthy("after controller recovery");
  const after = snapshotOwnedBindings();
  assertExactBindings(after, "after controller recovery");
  assert.deepEqual(after, before, "Controller recovery must preserve the exact seven current functions, grants, constraint, and helper order");
  assert.equal(sql(`select has_function_privilege('service_role',${q(revokedFunction)}::regprocedure,'EXECUTE');`), "t");
  assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)});`), "t");
  const canonicalAfter = canonicalCheck("after controller recovery");
  assert.equal(canonicalAfter, canonicalBefore, "Recovery must not rewind any canonical schema or grant");
  needsRecovery = false;
  console.log(JSON.stringify({
    ok: true, marker: "BUILD52_RELEASE_RECOVERY_BINDING_DATABASE_PASS",
    schema_fingerprint_before: canonicalBefore, schema_fingerprint_after: canonicalAfter,
    functions_checked: functions, grant_bindings_checked: functions.length, constraint_checked: constraint,
    challenges: ["constraint_drift", "function_drift", "grant_revoked", "helper_missing"],
    restored_objects: restored.restored_objects, canary_left_paused: true,
  }, null, 2));
} finally {
  if (needsRecovery) {
    // Preserve the original failing verdict while attempting bounded cleanup of our corruption.
    try {
      control("restore_authority", "cleanup failed disposable Build52 recovery-binding regression");
      assertHealthy("failed-test cleanup");
      canonicalCheck("failed-test cleanup");
    } catch (cleanupError) {
      console.error(`BUILD52_RECOVERY_FIXTURE_CLEANUP_FAILED: ${cleanupError.message}`);
    }
  }
}
