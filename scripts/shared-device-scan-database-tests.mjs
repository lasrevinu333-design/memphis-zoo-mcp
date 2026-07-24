#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.SHARED_SCAN_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.SHARED_SCAN_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}
async function sql(statement) {
  const { stdout } = await execFileAsync(
    "docker",
    ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}
async function json(statement) {
  return JSON.parse((await sql(`select (${statement})::text;`)).split("\n").at(-1));
}

const managerId = "00000000-0000-4000-8000-00000000f401";
const employeeId = "00000000-0000-4000-8000-00000000f402";
await sql(`
  insert into public.ops_manager_managers(manager_id,display_name,job_title,department_key,roles,active,is_system_principal,metadata_json)
  values ('${managerId}'::uuid,'Shared Scan Test Manager','Custodial Manager','custodial',array['OPS_MANAGER','CUSTODIAL_MANAGER']::text[],true,false,'{}'::jsonb)
  on conflict(manager_id) do update set active=true,revoked_at=null,roles=excluded.roles;
  insert into public.employees(id,employee_code,display_name,active)
  values ('${employeeId}'::uuid,'SHARED401','Shared Scan Test Employee',true)
  on conflict(id) do update set active=true,display_name=excluded.display_name;
`);
const activeEmployees = await json("public.tool_list_active_employees()");
const selectedEmployee = activeEmployees.find((employee) => employee.employee_id === employeeId);
assert.equal(selectedEmployee?.display_name, "Shared Scan Test Employee");
const location = await sql("select location_code from public.locations where active=true order by location_code limit 1;");
assert.ok(location);
assert.equal(await sql("select assigned_employee_id is null from public.devices where device_id='KIOSK_01' and active=true;"), "t");
const initialScanState = await json(`public.tool_get_location_scan_state_v2('${location}','KIOSK_01')`);
assert.equal(initialScanState.device_approved, true);
assert.equal(initialScanState.suggested_action, "start_session");

const clientSessionId = "00000000-0000-4000-8000-00000000f403";
const started = await json(`public.tool_start_shared_session_v1(
  '${location}','KIOSK_01','${employeeId}'::uuid,'${clientSessionId}',now(),'${managerId}'::uuid,'shared-db-test'
)`);
assert.equal(started.employee_id, employeeId);
assert.equal(started.employee_name, "Shared Scan Test Employee");
assert.equal(started.device_id, "KIOSK_01");
assert.equal(started.identity_source, "manager_authorized_employee_id");
assert.equal(started.replayed, false);
const activeScanState = await json(`public.tool_get_location_scan_state_v2('${location}','KIOSK_01')`);
assert.equal(activeScanState.suggested_action, "finish_session");
assert.equal(activeScanState.latest_employee_name, "Shared Scan Test Employee");
const startEvents = await sql(`select count(*) from public.session_events where session_id=(select id from public.sessions where client_session_id='${clientSessionId}') and event_type='session_started';`);
const replayed = await json(`public.tool_start_shared_session_v1(
  '${location}','KIOSK_01','${employeeId}'::uuid,'${clientSessionId}',now(),'${managerId}'::uuid,'shared-db-test-replay'
)`);
assert.equal(replayed.replayed, true);
assert.equal(await sql(`select count(*) from public.session_events where session_id=(select id from public.sessions where client_session_id='${clientSessionId}') and event_type='session_started';`), startEvents);
const otherLocation = await sql(`select location_code from public.locations where active=true and location_code <> '${location}' order by location_code limit 1;`);
assert.ok(otherLocation);
await assert.rejects(
  () => sql(`select public.tool_start_shared_session_v1(
    '${otherLocation}','KIOSK_01','${employeeId}'::uuid,'${clientSessionId}',now(),'${managerId}'::uuid,'shared-db-test-wrong-location'
  );`),
  /already bound to another location/i,
);

await assert.rejects(
  () => sql(`select public.tool_start_shared_session_v1(
    '${location}','KIOSK_02','${employeeId}'::uuid,'00000000-0000-4000-8000-00000000f404',now(),'${managerId}'::uuid,null
  );`),
  /only on KIOSK_01/i,
);
await assert.rejects(
  () => sql(`select public.tool_start_shared_session_v1(
    '${location}','KIOSK_01','${employeeId}'::uuid,'00000000-0000-4000-8000-00000000f405',now(),'00000000-0000-4000-8000-00000000ffff'::uuid,null
  );`),
  /authorized Ops Manager/i,
);

const completionId = "00000000-0000-4000-8000-00000000f406";
const completed = await json(`public.tool_commit_shared_cleaning_workflow_v1(
  '${clientSessionId}','${completionId}','KIOSK_01','${location}',now()-interval '5 minutes',now(),
  '{"services_performed":["restroom_check"],"issues":[]}'::jsonb,'[]'::jsonb,'${managerId}'::uuid,'shared-complete-test'
)`);
assert.equal(completed.status, "closed");
assert.equal(completed.employee_id, employeeId);
assert.equal(completed.atomic_shared_commit, true);
assert.equal(await sql(`select status from public.sessions where client_session_id='${clientSessionId}';`), "closed");
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id='${completionId}';`), "1");
assert.equal(await sql(`select count(*) from public.session_events where session_id=(select id from public.sessions where client_session_id='${clientSessionId}') and event_type='shared_device_completion_authorized';`), "1");

const completionReplay = await json(`public.tool_commit_shared_cleaning_workflow_v1(
  '${clientSessionId}','${completionId}','KIOSK_01','${location}',now()-interval '5 minutes',now(),
  '{"services_performed":["restroom_check"],"issues":[]}'::jsonb,'[]'::jsonb,'${managerId}'::uuid,'shared-complete-replay'
)`);
assert.equal(completionReplay.status, "closed");
assert.equal(await sql(`select count(*) from public.completion_responses where client_completion_id='${completionId}';`), "1");
assert.equal(await sql(`select count(*) from public.session_events where session_id=(select id from public.sessions where client_session_id='${clientSessionId}') and event_type='shared_device_completion_authorized';`), "1");

console.log("SHARED_DEVICE_SCAN_DATABASE_PASS");
