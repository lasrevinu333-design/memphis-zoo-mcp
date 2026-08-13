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
const managerId = "00000000-0000-4000-8000-000000000001";
const deviceId = "KIOSK_08";
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
sql("revoke insert on table public.custodial_offline_scan_event_evidence from service_role;");
sql(`delete from public.custodial_release_canary_rollback_audits where device_identifier=${q(deviceId)};
  delete from public.custodial_release_canary_controls where device_identifier=${q(deviceId)};`);
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

const expectedHealthDigest = sql("select definition_sha256 from public.custodial_release_authority_restore_definitions where function_identity='public.custodial_backend_authority_health(text)';");
sql(`create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text) returns jsonb language sql as $$select '{"ok":false,"broken":true}'::jsonb$$;`);
sql("drop function public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text);");
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).broken, true,
  "the test must first prove a present-but-broken authority function");

const restore = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'restore_authority','restore known-good authority set',
  '{"ok":false,"probe":"present-but-broken"}'::jsonb,${q(secret)})::text;`));
assert.equal(restore.canary_paused, true);
assert.equal(restore.restored_functions, 7);
const health = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(health.ok, true, "forward restoration must recover the canonical authority health RPC");
assert.equal(Object.values(health.checks).every((value) => value === true), true,
  "canary health must derive every authority, ledger, constraint, grant, writer, and operational-date check from the live catalog");
assert.equal(sql("select to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)') is not null;"), "t",
  "forward restoration must recover an absent canonical authority RPC");
assert.equal(sql("select encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),'UTF8'),'sha256'),'hex');"), expectedHealthDigest,
  "restored function must equal the captured known-good definition");
assert.equal(sql("select has_function_privilege('service_role','public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)'::regprocedure,'EXECUTE')::text;"), "false",
  "recovery must not revive the legacy completion writer");
assert.equal(sql(`select count(*) from public.custodial_terminal_writer_inventory where application_callable
  and (mutates_terminal_truth or delegates_alternate_terminal_authority)
  and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative');`), "0",
  "the recovery control must not become an alternate terminal writer");

const probesBeforeFailedResume = sql(`select count(*) from public.custodial_release_canary_recovery_probes where device_identifier=${q(deviceId)};`);
sql("grant insert on table public.custodial_offline_scan_event_evidence to service_role;");
try {
  const unhealthyResume = sql(`select public.custodial_control_release_canary(
    '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'resume_canary','unhealthy resume must fail',
    '{"ok":true}'::jsonb,${q(secret)});`, { expectFailure: true });
  assert.match(unhealthyResume, /fresh persisted recovery probe is green/i);
  assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)})::text;`), "true");
  assert.equal(sql(`select count(*) from public.custodial_release_canary_recovery_probes where device_identifier=${q(deviceId)};`), probesBeforeFailedResume,
    "a failed recovery probe and resume must roll back atomically");
} finally {
  sql("revoke insert on table public.custodial_offline_scan_event_evidence from service_role;");
}

const resume = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,${q(deviceId)},'resume_canary','authority health verified',
  ${q(JSON.stringify(health))}::jsonb,${q(secret)})::text;`));
assert.equal(resume.canary_paused, false);
assert.equal(resume.verified_authoritative_health.passed, true);
assert.match(resume.verified_authoritative_health.probe_id, /^[0-9a-f-]{36}$/i);
assert.equal(sql(`select count(*) from public.custodial_release_canary_recovery_probes where probe_id='${resume.verified_authoritative_health.probe_id}'::uuid and passed and expires_at>checked_at;`), "1",
  "resume must persist one fresh bounded recovery probe");
assert.equal(sql(`select public.custodial_release_canary_is_paused(${q(deviceId)},${q(secret)})::text;`), "false");

console.log(JSON.stringify({ ok: true, durable_canary_pause: true, present_broken_authority_restored: true,
  restored_functions: restore.restored_functions, legacy_writer_revived: false }, null, 2));
