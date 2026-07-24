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
const managerId = "00000000-0000-4000-8000-00000000f301";
await sql(`insert into public.ops_manager_managers(manager_id,display_name,job_title,department_key,roles,active,is_system_principal,metadata_json)
  values ('${managerId}'::uuid,'Custodial Phone Database Test Manager','Custodial Manager','custodial',array['OPS_MANAGER','CUSTODIAL_MANAGER','SECURITY_ADMIN']::text[],true,false,'{"database_acceptance":true}'::jsonb)
  on conflict(manager_id) do update set active=true,revoked_at=null,roles=excluded.roles;`);
const eric = await sql(`select manager_id from public.ops_manager_managers where manager_id='${managerId}'::uuid and active=true and revoked_at is null;`);
assert.equal(eric, managerId);
const deviceId = "00000000-0000-4000-8000-00000000f302";
await sql(`insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values ('${deviceId}'::uuid,'KIOSK_10','Unassigned KIOSK_10',true,null)
  on conflict(device_id) do update set active=true,updated_at=now();`);
const devicePk = await sql("select id from public.devices where device_id='KIOSK_10' and active=true;");
assert.match(devicePk, /^[0-9a-f-]{36}$/i);
const credentialId = "00000000-0000-4000-8000-00000000f303";
await sql(`insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,confirmed_at,expires_at
  ) values (
    '${credentialId}'::uuid,'${devicePk}'::uuid,repeat('a',64),'database acceptance credential',now(),now()+interval '1 day'
  ) on conflict(credential_id) do update set revoked_at=null,revoked_reason=null,confirmed_at=now(),expires_at=now()+interval '1 day';`);
const operationId = "00000000-0000-4000-8000-00000000f304";
const assigned = await json(`public.custodial_reassign_employee_phone(
  '${operationId}'::uuid,'KIOSK_10',null,null,'Database Phone Test Employee',
  '${eric}'::uuid,'database assignment acceptance',false,false
)`);
assert.equal(assigned.replayed, false);
assert.equal(assigned.credential_reenrollment_required, true);
assert.equal(assigned.device.device_id, "KIOSK_10");
assert.equal(assigned.device.assigned_employee_name, "Database Phone Test Employee");
const employeeId = assigned.employee.id;
assert.match(employeeId, /^[0-9a-f-]{36}$/i);
assert.match(assigned.employee.employee_code, /^EMP\d{3,6}$/);
assert.equal(await sql(`select assigned_employee_id::text from public.devices where device_id='KIOSK_10';`), employeeId);
assert.equal(await sql(`select device_name from public.devices where device_id='KIOSK_10';`), "Database Phone Test Employee");
assert.equal(await sql(`select count(*) from public.msg_device_assignments a join public.msg_users u on u.id=a.msg_user_id where a.device_identifier='KIOSK_10' and a.is_active=true and u.employee_id='${employeeId}'::uuid;`), "1");
assert.ok(Number(await sql(`select count(*) from public.custodial_employee_device_assignment_history where device_identifier='KIOSK_10' and new_employee_id='${employeeId}'::uuid;`)) >= 1);
assert.equal(await sql(`select revoked_reason from public.device_auth_credentials where credential_id='${credentialId}'::uuid;`), "device_assignment_changed");
const historyBeforeReplay = await sql(`select count(*) from public.custodial_employee_device_assignment_history where device_identifier='KIOSK_10';`);
const replayed = await json(`public.custodial_reassign_employee_phone(
  '${operationId}'::uuid,'KIOSK_10',null,null,'Database Phone Test Employee',
  '${eric}'::uuid,'database assignment acceptance',false,false
)`);
assert.equal(replayed.replayed, true);
assert.equal(await sql(`select count(*) from public.custodial_employee_device_assignment_history where device_identifier='KIOSK_10';`), historyBeforeReplay);
await assert.rejects(
  () => sql(`select public.custodial_reassign_employee_phone(
    '00000000-0000-4000-8000-00000000f305'::uuid,'KIOSK_10',null,null,'Database Orphan Must Roll Back',
    '${eric}'::uuid,'stale compare-and-set',false,false
  );`),
  /assignment changed/i,
);
assert.equal(await sql(`select count(*) from public.employees where display_name='Database Orphan Must Roll Back';`), "0");

const replacement = await json(`public.custodial_create_employee('Database Replacement Employee',null,'disposable database acceptance','${eric}'::uuid)`);
const replacementId = replacement.employee.id;
const replacementCredential = "00000000-0000-4000-8000-00000000f306";
await sql(`insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,confirmed_at,expires_at
  ) values (
    '${replacementCredential}'::uuid,'${devicePk}'::uuid,repeat('b',64),'replacement credential',now(),now()+interval '1 day'
  );`);
await sql(`insert into public.employee_push_registrations(
    registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash
  ) select
    '00000000-0000-4000-8000-00000000f307'::uuid,id,'${replacementCredential}'::uuid,
    assigned_employee_id,assignment_epoch,'android',repeat('fcm-token-',4),repeat('c',64)
  from public.devices where device_id='KIOSK_10';`);
const replaced = await json(`public.custodial_reassign_employee_phone(
  '00000000-0000-4000-8000-00000000f308'::uuid,'KIOSK_10','${employeeId}'::uuid,'${replacementId}'::uuid,null,
  '${eric}'::uuid,'employee replacement',false,true
)`);
assert.equal(replaced.replayed, false);
assert.equal(await sql(`select revoked_reason from public.device_auth_credentials where credential_id='${replacementCredential}'::uuid;`), "device_assignment_changed");
assert.equal(await sql(`select revoked_reason from public.employee_push_registrations where credential_id='${replacementCredential}'::uuid;`), "assignment_epoch_rotated");
assert.equal(await sql(`select active::text from public.employees where id='${employeeId}'::uuid;`), "false");

const inactive = await json(`public.custodial_set_employee_active('${replacementId}'::uuid,false,'${eric}'::uuid,'employment ended',true)`);
assert.equal(inactive.changed, true);
assert.deepEqual(inactive.released_devices, ["KIOSK_10"]);
assert.equal(await sql(`select active::text from public.employees where id='${replacementId}'::uuid;`), "false");
assert.equal(await sql("select assigned_employee_id is null from public.devices where device_id='KIOSK_10';"), "t");
assert.equal(await sql("select is_active::text from public.msg_device_assignments where device_identifier='KIOSK_10';"), "false");
const reactivated = await json(`public.custodial_set_employee_active('${replacementId}'::uuid,true,'${eric}'::uuid,'rehire acceptance',true)`);
assert.equal(reactivated.changed, true);
assert.equal(await sql(`select active::text from public.employees where id='${replacementId}'::uuid;`), "true");
assert.equal(await sql(`select is_active::text from public.msg_users where employee_id='${replacementId}'::uuid;`), "true");
assert.ok(Number(await sql(`select count(*) from public.custodial_employee_status_history where employee_id='${replacementId}'::uuid;`)) >= 3);
const unassignedOperation = "00000000-0000-4000-8000-00000000f309";
const unassignedCreated = await json(`public.custodial_create_employee_idempotent(
  '${unassignedOperation}'::uuid,'Database Unassigned Employee','${eric}'::uuid
)`);
const unassignedReplayed = await json(`public.custodial_create_employee_idempotent(
  '${unassignedOperation}'::uuid,'Database Unassigned Employee','${eric}'::uuid
)`);
assert.equal(unassignedCreated.replayed, false);
assert.equal(unassignedReplayed.replayed, true);
assert.equal(unassignedReplayed.employee.id, unassignedCreated.employee.id);
assert.equal(await sql(`select count(*) from public.employees where display_name='Database Unassigned Employee';`), "1");
console.log("CUSTODIAL_EMPLOYEE_PHONE_DATABASE_PASS");
