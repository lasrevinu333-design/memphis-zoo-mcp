#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = String(process.env.RELEASE_CANARY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.RELEASE_CANARY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const secret = "release-canary-recovery-test-01234567890123456789";
const nativeRouteSecret = "release-canary-native-route-test-01234567890123";
const managerId = "00000000-0000-4000-8000-000000000001";
const deviceId = "KIOSK_08";
const backendCommit = "a".repeat(40);
const releaseId = "release-canary-database-test";
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sql(statement, { role = "supabase_admin", expectFailure = false } = {}) {
  try {
    const output = execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", role, "-d", database, "-c", statement], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
    if (expectFailure) assert.fail(`Expected SQL failure: ${statement}`);
    return output.split("\n").at(-1) || "";
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message);
  }
}

sql(`select public.custodial_configure_backend_execution_key(
  encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),
  'release-canary-recovery-database-test');`);
sql(`select public.custodial_configure_native_route_proof_key(
  encode(extensions.digest(convert_to(${q(nativeRouteSecret)},'UTF8'),'sha256'),'hex'),
  'release-canary-recovery-database-test');`);
sql("revoke insert on table public.custodial_offline_scan_event_evidence from service_role;");
sql("alter table public.custodial_release_canary_transport_probes disable trigger trg_custodial_release_canary_transport_probes_immutable;");
try {
  sql(`delete from public.custodial_release_canary_rollback_audits where device_identifier=${q(deviceId)};
    update public.custodial_release_canary_controls set last_transport_probe_id=null where device_identifier=${q(deviceId)};
    delete from public.custodial_release_canary_transport_probes where device_identifier=${q(deviceId)};
    delete from public.custodial_release_canary_controls where device_identifier=${q(deviceId)};`);
} finally {
  sql("alter table public.custodial_release_canary_transport_probes enable trigger trg_custodial_release_canary_transport_probes_immutable;");
}
assert.match(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)});`, { expectFailure: true }), /has not been initialized/i,
  "an absent canary control must fail closed rather than silently enable traffic");

const pauseRequest = randomUUID();
const pause = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${pauseRequest}'::uuid,${q(deviceId)},'pause_canary','database recovery test',
  '{"ok":false,"probe":"test"}'::jsonb,${q(secret)})::text;`));
assert.equal(pause.canary_paused, true);
assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)})::text;`), "true",
  "pause must survive a new database connection");
assert.equal(JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${pauseRequest}'::uuid,${q(deviceId)},'pause_canary','database recovery test',
  '{"ok":false,"probe":"test"}'::jsonb,${q(secret)})::text;`)).replayed, true);
assert.match(sql(`select public.custodial_release_canary_is_paused('canary-check',${q(secret)});`, { expectFailure: true }), /exact employee-phone canary/i);

const expectedHealthDigest = sql("select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity::regprocedure='public.custodial_backend_authority_health(text)'::regprocedure;");
const expectedSecretVerifierDigest = sql("select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity::regprocedure='public.custodial_require_backend_execution_secret(text)'::regprocedure;");
assert.match(sql("select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity::regprocedure='public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure;"), /^[0-9a-f]{64}$/,
  "the restoration inventory includes its exact release control surface");
sql(`create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text) returns jsonb language sql as $$select '{"ok":false,"broken":true}'::jsonb$$;`);
sql(`create or replace function public.custodial_require_backend_execution_secret(p_execution_secret text) returns void language plpgsql as $$begin raise exception 'broken verifier'; end$$;`);
sql("drop function public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text);");
sql("drop function public.custodial_run_release_canary_recovery_probe(text,text);");
sql("drop function public.custodial_release_canary_is_paused(text,text);");
sql("drop trigger trg_custodial_release_canary_transport_probes_immutable on public.custodial_release_canary_transport_probes;");
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).broken, true,
  "the test must first prove a present-but-broken authority function");

const restore = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'restore_authority','restore known-good authority set',
  '{"ok":false,"probe":"present-but-broken"}'::jsonb,${q(secret)})::text;`));
assert.equal(restore.canary_paused, true);
assert.ok(restore.restored_objects > 40, "the catalog-derived closure restores functions, constraints, triggers, and grants");
const health = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(health.ok, true, "forward restoration must recover the canonical authority health RPC");
assert.equal(Object.values(health.checks).every((value) => value === true), true,
  "canary health must derive every authority, ledger, constraint, grant, writer, and operational-date check from the live catalog");
assert.equal(sql("select to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)') is not null;"), "t",
  "forward restoration must recover an absent canonical authority RPC");
assert.equal(sql("select to_regprocedure('public.custodial_run_release_canary_recovery_probe(text,text)') is not null;"), "t");
assert.equal(sql("select to_regprocedure('public.custodial_release_canary_is_paused(text,text)') is not null;"), "t");
assert.equal(sql("select count(*) from pg_trigger where tgrelid='public.custodial_release_canary_transport_probes'::regclass and tgname='trg_custodial_release_canary_transport_probes_immutable' and tgenabled<>'D';"), "1",
  "forward restoration must recover immutable phone-transport evidence enforcement");
assert.equal(sql("select encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),'UTF8'),'sha256'),'hex');"), expectedHealthDigest,
  "restored function must equal the captured known-good definition");
assert.equal(sql("select encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_require_backend_execution_secret(text)'::regprocedure),'UTF8'),'sha256'),'hex');"), expectedSecretVerifierDigest,
  "the inline-authenticated controller must recover a broken secret verifier before dependent functions");
assert.equal(sql("select has_function_privilege('service_role','public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)'::regprocedure,'EXECUTE')::text;"), "false",
  "recovery must not revive the legacy completion writer");
assert.equal(sql(`select count(*) from public.custodial_terminal_writer_inventory where application_callable
  and (mutates_terminal_truth or delegates_alternate_terminal_authority)
  and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative');`), "0",
  "the recovery control must not become an alternate terminal writer");

const expectedFingerprintDigest = sql("select definition_sha256 from public.custodial_release_authority_restore_inventory where object_kind='function' and object_identity::regprocedure='public.custodial_offline_payload_fingerprint(public.custodial_offline_actor_contexts,text,timestamp with time zone,timestamp with time zone,jsonb,jsonb,text)'::regprocedure;");
assert.match(expectedFingerprintDigest, /^[0-9a-f]{64}$/, "the payload fingerprint helper is captured in the transitive authority inventory");
sql("create or replace function public.custodial_offline_payload_fingerprint(p_context public.custodial_offline_actor_contexts,p_client_completion_id text,p_started_at timestamptz,p_ended_at timestamptz,p_response_json jsonb,p_scan_evidence jsonb,p_correlation_id text) returns text language sql immutable as $$select repeat('0',64)$$;");
const helperCorruptionHealth = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(helperCorruptionHealth.ok, false, "helper corruption must be detected by the closure health check");
assert.ok(helperCorruptionHealth.mismatched_objects.some((identity) => identity.includes("custodial_offline_payload_fingerprint")));
const helperRestore = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'restore_authority','restore corrupted fingerprint helper',
  '{"ok":false,"probe":"helper-corruption"}'::jsonb,${q(secret)})::text;`));
assert.ok(helperRestore.restored_objects > 40);
assert.equal(sql("select encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_offline_payload_fingerprint(public.custodial_offline_actor_contexts,text,timestamp with time zone,timestamp with time zone,jsonb,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex');"), expectedFingerprintDigest,
  "catalog inventory restores the exact fingerprint helper definition");

const functionGrantIdentity = sql("select object_identity from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity='public.tool_get_offline_scan_authority_snapshot(text,text,text)'::regprocedure::text;");
const tableGrantIdentity = "public.sessions";
const expectedFunctionGrant = sql(`select definition_sql from public.custodial_release_authority_restore_inventory
  where object_kind='grant' and object_identity=${q(functionGrantIdentity)};`);
const expectedTableGrant = sql(`select definition_sql from public.custodial_release_authority_restore_inventory
  where object_kind='grant' and object_identity=${q(tableGrantIdentity)};`);
assert.match(expectedFunctionGrant, /grant execute on function .* to service_role;/i,
  "the captured function grant must include the native snapshot authority");
assert.match(expectedTableGrant, /grant SELECT on table .* to service_role;/,
  "the captured table grant must include the session read authority");
sql("revoke execute on function public.tool_get_offline_scan_authority_snapshot(text,text,text) from service_role;");
sql("revoke select on table public.sessions from service_role;");
const revokedGrantHealth = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(revokedGrantHealth.ok, false, "catalog health must detect revoked captured grants");
assert.ok(revokedGrantHealth.mismatched_objects.includes(functionGrantIdentity),
  "health must identify the revoked function EXECUTE grant");
assert.ok(revokedGrantHealth.mismatched_objects.includes(tableGrantIdentity),
  "health must identify the revoked table privilege");
const grantRestore = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'restore_authority','restore revoked authority grants',
  '{"ok":false,"probe":"revoked-grants"}'::jsonb,${q(secret)})::text;`));
assert.ok(grantRestore.restored_objects > 40, "authority restoration must replay every captured grant");
const restoredGrantHealth = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(restoredGrantHealth.ok, true, "grant restoration must return exact catalog health");
assert.deepEqual(restoredGrantHealth.missing_objects, []);
assert.deepEqual(restoredGrantHealth.mismatched_objects, []);
assert.equal(sql(`select public.custodial_release_authority_current_grant_definition(${q(functionGrantIdentity)})=${q(expectedFunctionGrant)};`), "t",
  "function ACL rendering must be byte-for-byte equal to its captured inventory row");
assert.equal(sql(`select public.custodial_release_authority_current_grant_definition(${q(tableGrantIdentity)})=${q(expectedTableGrant)};`), "t",
  "table ACL rendering must be byte-for-byte equal to its captured inventory row");
assert.equal(sql("select has_function_privilege('service_role','public.tool_get_offline_scan_authority_snapshot(text,text,text)'::regprocedure,'EXECUTE')::text;"), "true");
assert.equal(sql("select has_table_privilege('service_role','public.sessions','SELECT')::text;"), "true");

const driftRole = `custodial_inventory_drift_${Date.now().toString(36)}`;
const triggerIdentity = "public.custodial_release_canary_transport_probes.trg_custodial_release_canary_transport_probes_immutable";
const indexIdentity = sql("select object_identity from public.custodial_release_authority_restore_inventory where object_kind='index' order by object_identity limit 1;");
const policyIdentity = "public.maintenance_tickets:maintenance_tickets_select_policy";
const relationStateIdentity = "public.maintenance_tickets";
const triggerHelperIdentity = "enforce_session_status_transition()";
const constraintIdentity = "public.completion_responses:completion_responses_client_completion_id_uuid";
const genericWriterGrantIdentity = "run_sql_write(text)";
const alternateWriterGrantIdentity = "tool_force_close_session(text,text,text)";
const expectedTriggerHelperDigest = sql(`select definition_sha256 from public.custodial_release_authority_restore_inventory
  where object_kind='function' and object_identity=${q(triggerHelperIdentity)};`);
const expectedConstraintRestore = sql(`select definition_sql from public.custodial_release_authority_restore_inventory
  where object_kind='constraint' and object_identity=${q(constraintIdentity)};`);
assert.match(expectedTriggerHelperDigest, /^[0-9a-f]{64}$/, "direct trigger helpers must be captured");
assert.match(expectedConstraintRestore, /completion_responses_client_completion_id_uuid/, "UUID constraint restore must be captured");
assert.equal(sql(`select count(*) from public.custodial_release_authority_restore_inventory where object_kind='grant' and object_identity in (${q(genericWriterGrantIdentity)},${q(alternateWriterGrantIdentity)});`), "2",
  "generic and alternate terminal writer ACLs must be part of the runtime restoration inventory");
const originalRls = sql("select relrowsecurity::text from pg_class where oid='public.maintenance_tickets'::regclass;");
sql(`create role ${driftRole} nologin; grant select on table public.sessions to ${driftRole};`);
sql("alter table public.custodial_release_canary_transport_probes disable trigger trg_custodial_release_canary_transport_probes_immutable;");
sql("create or replace function public.enforce_session_status_transition() returns trigger language plpgsql as $$begin return new; end$$;");
sql("alter table public.completion_responses drop constraint completion_responses_client_completion_id_uuid; alter table public.completion_responses add constraint completion_responses_client_completion_id_uuid check (true) not valid;");
sql("grant execute on function public.run_sql_write(text),public.tool_force_close_session(text,text,text) to service_role;");
sql(`drop index ${indexIdentity};`);
sql(`alter table public.maintenance_tickets ${originalRls === "true" ? "disable" : "enable"} row level security;`);
sql("drop policy maintenance_tickets_select_policy on public.maintenance_tickets;");
const expandedDriftHealth = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(expandedDriftHealth.ok, false, "expanded authority drift must fail the canary health gate");
assert.ok(expandedDriftHealth.missing_objects.includes(indexIdentity));
assert.ok(expandedDriftHealth.missing_objects.includes(policyIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(triggerIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(triggerHelperIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(constraintIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(relationStateIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(tableGrantIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(genericWriterGrantIdentity));
assert.ok(expandedDriftHealth.mismatched_objects.includes(alternateWriterGrantIdentity));
const expandedRestore = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'restore_authority','restore expanded authority drift',
  '{"ok":false,"probe":"expanded-drift"}'::jsonb,${q(secret)})::text;`));
assert.equal(expandedRestore.restored_objects, expandedDriftHealth.canonical_objects_expected);
const expandedRestoreHealth = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(expandedRestoreHealth.ok, true, "helpers, constraints, indexes, policies, trigger state, RLS state, and arbitrary-role grants must restore exactly");
assert.equal(sql(`select encode(extensions.digest(convert_to(pg_get_functiondef(${q(triggerHelperIdentity)}::regprocedure),'UTF8'),'sha256'),'hex');`), expectedTriggerHelperDigest);
assert.equal(sql(`select public.custodial_release_authority_current_constraint_definition(${q(constraintIdentity)})=${q(expectedConstraintRestore)};`), "t");
assert.equal(sql(`select has_table_privilege(${q(driftRole)},'public.sessions','SELECT')::text;`), "false");
assert.equal(sql("select has_function_privilege('service_role','public.run_sql_write(text)'::regprocedure,'EXECUTE')::text;"), "false");
assert.equal(sql("select has_function_privilege('service_role','public.tool_force_close_session(text,text,text)'::regprocedure,'EXECUTE')::text;"), "false");
assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.maintenance_tickets'::regclass;`), originalRls);
sql(`drop role ${driftRole};`);

sql("drop function public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text);");
const bootstrapRestore = JSON.parse(sql(`select public.custodial_bootstrap_restore_release_authority(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},${q(secret)})::text;`));
assert.equal(bootstrapRestore.canary_paused, true);
assert.equal(sql("select to_regprocedure('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)') is not null;"), "t",
  "an independently callable bootstrap restorer recovers a missing controller");

const probesBeforeFailedResume = sql(`select count(*) from public.custodial_release_canary_recovery_probes where device_identifier=${q(deviceId)};`);
sql("grant insert on table public.custodial_offline_scan_event_evidence to service_role;");
try {
  const unhealthyResume = sql(`select public.custodial_control_release_canary(
    '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'resume_canary','unhealthy resume must fail',
    '{"ok":true}'::jsonb,${q(secret)});`, { expectFailure: true });
  assert.match(unhealthyResume, /fresh persisted database recovery probe is green/i);
  assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)})::text;`), "true");
  assert.equal(sql(`select count(*) from public.custodial_release_canary_recovery_probes where device_identifier=${q(deviceId)};`), probesBeforeFailedResume,
    "a failed recovery probe and resume must roll back atomically");
} finally {
  sql("revoke insert on table public.custodial_offline_scan_event_evidence from service_role;");
}

const canaryCredential = randomUUID();
const canaryCredentialTokenHash = randomUUID().replaceAll("-", "").repeat(2);
let canaryDevicePk = sql(`select id::text from public.devices where upper(btrim(device_id))=${q(deviceId)} limit 1;`);
if (!canaryDevicePk) {
  canaryDevicePk = randomUUID();
  const employeeId = randomUUID();
  sql(`insert into public.employees(id,employee_code,display_name,active,role,notes)
    values('${employeeId}'::uuid,'EMP08','Release Canary Employee',true,'staff','disposable canary test');
    insert into public.devices(id,device_id,device_name,active,assigned_employee_id,notes)
    values('${canaryDevicePk}'::uuid,${q(deviceId)},'Release Canary Device',true,'${employeeId}'::uuid,'disposable canary test');`);
}
sql(`update public.device_auth_credentials
  set revoked_at=coalesce(revoked_at,now()), revoked_reason=coalesce(revoked_reason,'disposable canary credential rotation')
  where device_id='${canaryDevicePk}'::uuid and revoked_at is null;`);
sql(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values('${canaryCredential}'::uuid,'${canaryDevicePk}'::uuid,${q(canaryCredentialTokenHash)},'canary transport test',now(),now()+interval '1 day','{}'::jsonb);`);
const noPhoneHealth = JSON.parse(sql(`select public.custodial_get_release_canary_transport_probe_health(
  ${q(deviceId)},${q(backendCommit)},${q(releaseId)},${q(secret)})::text;`));
assert.equal(noPhoneHealth.ready, false, "database-only recovery evidence cannot stand in for the physical phone path");
assert.match(sql(`set role service_role; select public.custodial_record_release_canary_transport_probe(
  ${q(deviceId)},'${canaryCredential}'::uuid,'${"c".repeat(64)}',${q(backendCommit)},${q(releaseId)},
  'https://localhost','custodial','${randomUUID()}'::uuid,now()::text,'${"d".repeat(64)}',${q(secret)});`, { expectFailure: true }),
  /native phone route proof is not authorized/i,
  "the general service-role backend secret cannot fabricate native phone evidence");
const phoneProbe = JSON.parse(sql(`select public.custodial_record_release_canary_transport_probe(
  ${q(deviceId)},'${canaryCredential}'::uuid,'${"c".repeat(64)}',${q(backendCommit)},${q(releaseId)},
  'https://localhost','custodial','${randomUUID()}'::uuid,now()::text,'${"d".repeat(64)}',${q(nativeRouteSecret)})::text;`));
assert.equal(phoneProbe.ready, true);
const combinedHealth = { ...health, ok: true, scan_rpc_transport: {
  ...phoneProbe, ready: true, backend_commit_sha: backendCommit, release_id: releaseId,
} };
const resume = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'resume_canary','authority health verified',
  ${q(JSON.stringify(combinedHealth))}::jsonb,${q(secret)})::text;`));
assert.equal(resume.canary_paused, false);
assert.equal(resume.verified_authoritative_health.passed, true);
assert.equal(resume.verified_transport_health.probe_id, phoneProbe.probe_id,
  "resume binds the exact physical-phone transport receipt");
assert.match(resume.verified_authoritative_health.probe_id, /^[0-9a-f-]{36}$/i);
assert.equal(sql(`select count(*) from public.custodial_release_canary_recovery_probes where probe_id='${resume.verified_authoritative_health.probe_id}'::uuid and passed and expires_at>checked_at;`), "1",
  "resume must persist one fresh bounded recovery probe");
assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)})::text;`), "false");
const postResumeHealth = JSON.parse(sql(`select public.custodial_get_release_canary_transport_probe_health(
  ${q(deviceId)},${q(backendCommit)},${q(releaseId)},${q(secret)})::text;`));
assert.equal(postResumeHealth.ready, true, "health retains the exact receipt bound by the completed resume");

console.log(JSON.stringify({ ok: true, durable_canary_pause: true, present_broken_authority_restored: true,
  restored_objects: restore.restored_objects, controller_bootstrap_recovered: true, legacy_writer_revived: false }, null, 2));
