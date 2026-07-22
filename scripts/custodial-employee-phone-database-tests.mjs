#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_PHONE_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_PHONE_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}
async function sql(statement) {
  const { stdout } = await execFileAsync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
async function json(statement) {
  const output = await sql(`select (${statement})::text;`);
  return JSON.parse(output.split("\n").at(-1));
}
const eric = await sql("select manager_id from public.ops_manager_managers where lower(btrim(display_name))='eric operle' and active=true and revoked_at is null order by case when system_key='eric_custodial_manager' then 0 else 1 end,created_at limit 1;");
assert.match(eric, /^[0-9a-f-]{36}$/i);
const devicePk = await sql("select id from public.devices where device_id='KIOSK_10';");
assert.match(devicePk, /^[0-9a-f-]{36}$/i);
const credentialBefore = await sql(`select coalesce(string_agg(credential_id::text,',' order by credential_id::text),'') from public.device_auth_credentials where device_id='${devicePk}'::uuid and revoked_at is null;`);
const created = await json(`public.custodial_create_employee('Database Phone Test Employee',null,'disposable database acceptance','${eric}'::uuid)`);
assert.equal(created.created, true);
assert.match(created.employee.id, /^[0-9a-f-]{36}$/i);
assert.match(created.employee.employee_code, /^EMP\d{3,6}$/);
const employeeId = created.employee.id;
const assigned = await json(`public.custodial_assign_employee_device('KIOSK_10','${employeeId}'::uuid,'${eric}'::uuid,'database assignment acceptance',false)`);
assert.equal(assigned.changed, true);
assert.equal(assigned.device.device_id, "KIOSK_10");
assert.equal(assigned.device.assigned_employee_name, "Database Phone Test Employee");
assert.equal(await sql(`select assigned_employee_id::text from public.devices where device_id='KIOSK_10';`), employeeId);
assert.equal(await sql(`select device_name from public.devices where device_id='KIOSK_10';`), "Database Phone Test Employee");
assert.equal(await sql(`select count(*) from public.msg_device_assignments a join public.msg_users u on u.id=a.msg_user_id where a.device_identifier='KIOSK_10' and a.is_active=true and u.employee_id='${employeeId}'::uuid;`), "1");
assert.ok(Number(await sql(`select count(*) from public.custodial_employee_device_assignment_history where device_identifier='KIOSK_10' and new_employee_id='${employeeId}'::uuid;`)) >= 1);
const credentialAfterAssignment = await sql(`select coalesce(string_agg(credential_id::text,',' order by credential_id::text),'') from public.device_auth_credentials where device_id='${devicePk}'::uuid and revoked_at is null;`);
assert.equal(credentialAfterAssignment, credentialBefore, "phone reassignment must preserve the device credential");
const inactive = await json(`public.custodial_set_employee_active('${employeeId}'::uuid,false,'${eric}'::uuid,'employment ended',true)`);
assert.equal(inactive.changed, true);
assert.deepEqual(inactive.released_devices, ["KIOSK_10"]);
assert.equal(await sql(`select active::text from public.employees where id='${employeeId}'::uuid;`), "false");
assert.equal(await sql("select assigned_employee_id is null from public.devices where device_id='KIOSK_10';"), "t");
assert.equal(await sql("select is_active::text from public.msg_device_assignments where device_identifier='KIOSK_10';"), "false");
const reactivated = await json(`public.custodial_set_employee_active('${employeeId}'::uuid,true,'${eric}'::uuid,'rehire acceptance',true)`);
assert.equal(reactivated.changed, true);
assert.equal(await sql(`select active::text from public.employees where id='${employeeId}'::uuid;`), "true");
assert.equal(await sql(`select is_active::text from public.msg_users where employee_id='${employeeId}'::uuid;`), "true");
assert.ok(Number(await sql(`select count(*) from public.custodial_employee_status_history where employee_id='${employeeId}'::uuid;`)) >= 3);
console.log("CUSTODIAL_EMPLOYEE_PHONE_DATABASE_PASS");
