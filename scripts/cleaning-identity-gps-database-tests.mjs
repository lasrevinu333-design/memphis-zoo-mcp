#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CLEANING_IDENTITY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CLEANING_IDENTITY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", `set timezone='America/Chicago';\n${statement}`,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "";
}

async function expectSqlFailure(statement, pattern) {
  await assert.rejects(() => sql(statement), (error) => {
    assert.match(String(error?.stderr || error?.message || error), pattern);
    return true;
  });
}

const ids = {
  employee1: "00000000-0000-4000-8000-00000000c701",
  employee2: "00000000-0000-4000-8000-00000000c702",
  location1: "00000000-0000-4000-8000-00000000c703",
  location2: "00000000-0000-4000-8000-00000000c704",
  device1: "00000000-0000-4000-8000-00000000c705",
  device2: "00000000-0000-4000-8000-00000000c706",
  manager: "00000000-0000-4000-8000-00000000c707",
  session: "00000000-0000-4000-8000-00000000c708",
  activeSession: "00000000-0000-4000-8000-00000000c709",
  correction: "00000000-0000-4000-8000-00000000c710",
  inspection: "00000000-0000-4000-8000-00000000c711",
  inspectionOperation: "00000000-0000-4000-8000-00000000c712",
  finish: "00000000-0000-4000-8000-00000000c713",
};
const secret = "cleaning-identity-disposable-test-secret";

await sql(`
  select public.custodial_configure_backend_execution_key(
    encode(extensions.digest(convert_to('${secret}','UTF8'),'sha256'),'hex'),
    'cleaning-identity-database-test'
  );
  insert into public.employees(id,employee_code,display_name,active,role) values
    ('${ids.employee1}','IDENTITY001','Original Employee',true,'staff'),
    ('${ids.employee2}','IDENTITY002','Corrected Employee',true,'staff');
  insert into public.locations(id,location_code,location_name,location_type,form_type,active) values
    ('${ids.location1}','IDENTITY_ONE','Original Location','exhibit','exhibit',true),
    ('${ids.location2}','IDENTITY_TWO','Corrected Location','exhibit','exhibit',true);
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values
    ('${ids.device1}','IDENTITY_DEVICE_ONE','Original Phone',true,'${ids.employee1}'),
    ('${ids.device2}','IDENTITY_DEVICE_TWO','Corrected Phone',true,'${ids.employee2}');
  insert into public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal)
  values ('${ids.manager}','Named Test Manager',array['OPS_MANAGER']::text[],true,false);
  insert into public.sessions(
    id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at
  ) values (
    '${ids.session}','identity-session-closed','identity-session-closed','${ids.location1}',
    '${ids.employee1}','${ids.device1}','active',clock_timestamp()-interval '30 minutes'
  );
`);

assert.equal(await sql(`
  select employee_name_snapshot||'|'||location_code_snapshot||'|'||device_identifier_snapshot||'|'||assignment_epoch_snapshot||'|'||identity_snapshot_provenance
  from public.sessions where id='${ids.session}';
`), "Original Employee|IDENTITY_ONE|IDENTITY_DEVICE_ONE|1|session_create");

await expectSqlFailure(
  `update public.sessions set employee_id='${ids.employee2}' where id='${ids.session}';`,
  /Original cleaning identity is immutable/,
);
await expectSqlFailure(
  `update public.sessions set started_at=started_at-interval '1 hour' where id='${ids.session}';`,
  /Original cleaning identity is immutable/,
);

await sql(`
  update public.sessions set status='pending_submit',ended_at=clock_timestamp(),duration_minutes=30,
    duration_display='30 min',finish_operation_id='${ids.finish}' where id='${ids.session}';
  update public.sessions set status='closed',completion_source='kiosk_form' where id='${ids.session}';
`);
assert.equal(await sql(`select status from public.sessions where id='${ids.session}';`), "closed");
await expectSqlFailure(
  `update public.sessions set ended_at=ended_at+interval '1 minute' where id='${ids.session}';`,
  /Cleaning end time is immutable/,
);

const correction = JSON.parse(await sql(`
  set role service_role;
  select public.custodial_append_session_correction(
    '${ids.correction}','${ids.session}','${ids.manager}','Corrected after named-manager evidence review','${secret}',
    '${ids.employee2}','${ids.location2}','${ids.device2}',null,null
  )::text;
`));
assert.equal(correction.replayed, false);
assert.deepEqual(correction.changed_fields.sort(), ["device", "employee", "location"]);

const replay = JSON.parse(await sql(`
  set role service_role;
  select public.custodial_append_session_correction(
    '${ids.correction}','${ids.session}','${ids.manager}','Corrected after named-manager evidence review','${secret}',
    '${ids.employee2}','${ids.location2}','${ids.device2}',null,null
  )::text;
`));
assert.equal(replay.replayed, true);
assert.equal(replay.correction_id, correction.correction_id);

await expectSqlFailure(`
  set role service_role;
  select public.custodial_append_session_correction(
    '${ids.correction}','${ids.session}','${ids.manager}','Conflicting replay','${secret}',
    '${ids.employee2}',null,null,null,null
  );
`, /already used for a different request/);

assert.equal(await sql(`
  select original_employee_name||'|'||current_employee_name||'|'||original_location_code||'|'||current_location_code||'|'||original_device_identifier||'|'||current_device_identifier
  from public.v_custodial_cleaning_session_truth where session_id='${ids.session}';
`), "Original Employee|Corrected Employee|IDENTITY_ONE|IDENTITY_TWO|IDENTITY_DEVICE_ONE|IDENTITY_DEVICE_TWO");
assert.equal(await sql(`select employee_id='${ids.employee1}'::uuid from public.sessions where id='${ids.session}';`), "t");
await expectSqlFailure(
  `update public.custodial_session_corrections set reason='rewritten' where operation_id='${ids.correction}';`,
  /Cleaning corrections are append-only/,
);
await expectSqlFailure(
  `delete from public.custodial_session_corrections where operation_id='${ids.correction}';`,
  /Cleaning corrections are append-only/,
);

await sql(`
  insert into public.cleaning_inspections(
    id,operation_id,request_fingerprint,session_id,inspector_manager_id,inspector_name_snapshot,
    employee_name_snapshot,location_code_snapshot,location_name_snapshot,location_id,employee_id,
    session_started_at,inspection_type,rubric_version,overall_score,pass_threshold,
    critical_failure,follow_up_required,findings_json
  ) values (
    '${ids.inspection}','${ids.inspectionOperation}','${"a".repeat(64)}','${ids.session}','${ids.manager}','placeholder',
    'placeholder','placeholder','placeholder','${ids.location1}','${ids.employee1}',clock_timestamp(),
    'manager_spot_check','custodial-v1',90,85,false,false,'[]'::jsonb
  );
  update public.employees set display_name='Renamed Directory Employee' where id='${ids.employee1}';
  update public.locations set location_name='Renamed Directory Location' where id='${ids.location1}';
  update public.cleaning_inspections set notes='Rubric note updated without rebinding evidence' where id='${ids.inspection}';
`);
assert.equal(await sql(`
  select employee_name_snapshot||'|'||location_name_snapshot||'|'||inspector_name_snapshot
  from public.cleaning_inspections where id='${ids.inspection}';
`), "Original Employee|Original Location|Named Test Manager");
await expectSqlFailure(
  `update public.cleaning_inspections set employee_name_snapshot='Rebound' where id='${ids.inspection}';`,
  /Inspection actor, cleaning identity, and snapshots are immutable/,
);

await sql(`
  insert into public.location_proximity_settings(location_id,latitude,longitude,coordinate_source,coordinate_confidence,active)
  values ('${ids.location1}',35.1495,-90.0490,'cleaning_identity_test','test',true);
`);
const lateGps = JSON.parse(await sql(`
  set role service_role;
  select public.tool_evaluate_location_proximity_v2(
    'IDENTITY_ONE','IDENTITY_DEVICE_ONE',35.1495,-90.0490,8,'identity-session-closed',
    'identity-gps-late','identity-gps-late',clock_timestamp()
  )::text;
`));
assert.equal(lateGps.result, "post_session");
assert.equal(lateGps.authoritative, false);
assert.equal(lateGps.evidence_scope, "post_session_advisory");
assert.equal(await sql(`select result||'|'||(payload_json->>'authoritative') from public.scan_events where client_event_id='identity-gps-late';`), "post_session|false");
assert.equal(await sql(`select result||'|'||(metadata_json->>'authoritative') from public.device_location_proximity_status where session_uuid='identity-session-closed';`), "post_session|false");

await sql(`
  insert into public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
  values ('${ids.activeSession}','identity-session-active','identity-session-active','${ids.location1}','${ids.employee1}','${ids.device1}','active',clock_timestamp());
`);
const activeGps = JSON.parse(await sql(`
  set role service_role;
  select public.tool_evaluate_location_proximity_v2(
    'IDENTITY_ONE','IDENTITY_DEVICE_ONE',35.1495,-90.0490,8,'identity-session-active',
    'identity-gps-active','identity-gps-active',clock_timestamp()
  )::text;
`));
assert.equal(activeGps.result, "near");
assert.equal(activeGps.session_uuid, "identity-session-active");

assert.equal(await sql(`
  select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'custodial_sessions_preserve_original_identity','custodial_reject_session_correction_mutation',
    'custodial_evaluate_location_proximity_measurement','custodial_evaluate_location_proximity_v2_measurement',
    'custodial_gps_session_state','custodial_mark_post_session_gps'
  ) and (
    has_function_privilege('public',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
  );
`), "0");

console.log(JSON.stringify({
  ok: true,
  original_identity_immutable: true,
  correction_append_only: true,
  correction_replay_exact_once: true,
  inspection_snapshot_frozen: true,
  terminal_gps_advisory_only: true,
  active_gps_preserved: true,
}, null, 2));
