#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.CUSTODIAL_REMOVAL_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.CUSTODIAL_REMOVAL_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}
const psqlArgs = ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database];
async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [...psqlArgs, "-c", statement], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
async function json(statement) {
  const output = await sql(`select (${statement})::text;`);
  return JSON.parse(output.split("\n").at(-1));
}
function concurrentSql(statement) {
  return new Promise((resolve) => {
    const child = spawn("docker", [...psqlArgs, "-c", statement], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const ids = {
  location: "42000000-0000-4000-8000-000000000001",
  venue: "42000000-0000-4000-8000-000000000002",
  employee: "42000000-0000-4000-8000-000000000003",
  device: "42000000-0000-4000-8000-000000000004",
  credential: "42000000-0000-4000-8000-000000000005",
  registration: "42000000-0000-4000-8000-000000000006",
  event: "42000000-0000-4000-8000-000000000007",
  eventInstance: "42000000-0000-4000-8000-000000000008",
  pendingSource: "42000000-0000-4000-8000-000000000009",
  leasedSource: "42000000-0000-4000-8000-000000000010",
  operation: "42000000-0000-4000-8000-000000000011",
  rollbackEmployee: "42000000-0000-4000-8000-000000000012",
  rollbackDevice: "42000000-0000-4000-8000-000000000013",
  rollbackCredential: "42000000-0000-4000-8000-000000000014",
  rollbackRegistration: "42000000-0000-4000-8000-000000000015",
  rollbackSource: "42000000-0000-4000-8000-000000000016",
  rollbackOperation: "42000000-0000-4000-8000-000000000017",
};
const credentialHash = "a".repeat(64);
const rollbackHash = "b".repeat(64);
const pendingJobKey = "custodial-removal-pending";
const leasedJobKey = "custodial-removal-leased";
const rollbackJobKey = "custodial-removal-rollback";

await sql(`
  delete from public.operational_notification_jobs
   where job_key in ('${pendingJobKey}','${leasedJobKey}','${rollbackJobKey}');
  delete from public.device_auth_removal_operations
   where operation_id in ('${ids.operation}'::uuid,'${ids.rollbackOperation}'::uuid);
  delete from public.event_push_instances where instance_id='${ids.eventInstance}'::uuid;
  delete from public.employee_push_registrations
   where registration_id in ('${ids.registration}'::uuid,'${ids.rollbackRegistration}'::uuid);
  delete from public.device_auth_events
   where device_id in ('${ids.device}'::uuid,'${ids.rollbackDevice}'::uuid);
  delete from public.device_auth_credentials
   where credential_id in ('${ids.credential}'::uuid,'${ids.rollbackCredential}'::uuid);
  delete from public.devices where id in ('${ids.device}'::uuid,'${ids.rollbackDevice}'::uuid);
  delete from public.employees where id in ('${ids.employee}'::uuid,'${ids.rollbackEmployee}'::uuid);

  insert into public.location_groups(
    id,group_code,group_name,active,eligible_event_venue,event_venue,
    eligible_custodial_coverage,eligible_staffing_assignment
  ) values (
    '${ids.location}'::uuid,'REMOVAL_DB_GROUP','Removal Database Group',true,true,true,true,true
  ) on conflict(id) do update set active=true,eligible_event_venue=true,event_venue=true;
  insert into public.event_venues(
    id,venue_code,display_name,event_scope,location_group_id,
    eligible_event_venue,eligible_event_scope,aliases,active,metadata_json
  ) values (
    '${ids.venue}'::uuid,'REMOVAL_DB_VENUE','Removal Database Venue',
    'SINGLE_VENUE','${ids.location}'::uuid,true,false,array['Removal Database Venue']::text[],true,
    '{"database_acceptance":true}'::jsonb
  ) on conflict(id) do update set active=true,eligible_event_venue=true;
  insert into public.employees(id,employee_code,display_name,active,role) values
    ('${ids.employee}'::uuid,'EMPREMOVE1','Removal Database Employee',true,'staff'),
    ('${ids.rollbackEmployee}'::uuid,'EMPREMOVE2','Removal Rollback Employee',true,'staff');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id,assignment_epoch) values
    ('${ids.device}'::uuid,'KIOSK_02','Removal Database Phone',true,'${ids.employee}'::uuid,1),
    ('${ids.rollbackDevice}'::uuid,'KIOSK_03','Removal Rollback Phone',true,'${ids.rollbackEmployee}'::uuid,1);
  insert into public.device_auth_credentials(
    credential_id,device_id,token_hash,device_label,metadata_json,created_at,confirmed_at,last_used_at,expires_at
  ) values
    ('${ids.credential}'::uuid,'${ids.device}'::uuid,'${credentialHash}','Removal Database Credential','{}'::jsonb,now(),now(),now(),now()+interval '1 day'),
    ('${ids.rollbackCredential}'::uuid,'${ids.rollbackDevice}'::uuid,'${rollbackHash}','Removal Rollback Credential','{}'::jsonb,now(),now(),now(),now()+interval '1 day');
  insert into public.employee_push_registrations(
    registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash,active
  ) values
    ('${ids.registration}'::uuid,'${ids.device}'::uuid,'${ids.credential}'::uuid,'${ids.employee}'::uuid,1,'android','fcm-removal-${"x".repeat(40)}','${"c".repeat(64)}',true),
    ('${ids.rollbackRegistration}'::uuid,'${ids.rollbackDevice}'::uuid,'${ids.rollbackCredential}'::uuid,'${ids.rollbackEmployee}'::uuid,1,'android','fcm-rollback-${"x".repeat(40)}','${"d".repeat(64)}',true);
  insert into public.events_app_events(
    id,event_name,location_group_id,primary_venue_id,venue_ids,
    event_date,end_date,start_time,end_time,attendee_count,notes,created_by,
    status,event_scope,coverage_location_ids,display_location
  ) values (
    '${ids.event}'::uuid,'Removal Database Event','${ids.location}'::uuid,
    '${ids.venue}'::uuid,array['${ids.venue}'::uuid],date '2030-01-02',date '2030-01-02',
    time '10:00',time '11:00',10,'Removal database acceptance','database-test',
    'SCHEDULED','SINGLE_VENUE',array['${ids.location}'::uuid],'Removal Database Venue'
  ) on conflict(id) do update set status='SCHEDULED';
  insert into public.event_push_instances(
    instance_id,notification_key,event_id,event_revision,service_date,employee_id,
    device_id,credential_id,assignment_epoch,notification_kind,scheduled_for,state
  ) values (
    '${ids.eventInstance}'::uuid,'custodial-removal-event','${ids.event}'::uuid,1,date '2030-01-02','${ids.employee}'::uuid,
    '${ids.device}'::uuid,'${ids.credential}'::uuid,1,'day_before',now(),'leased'
  );
  insert into public.operational_notification_jobs(job_key,job_type,source_id,payload_json) values
    ('${pendingJobKey}','employee_native_push','${ids.pendingSource}'::uuid,
      jsonb_build_object('credential_id','${ids.credential}','device_id','${ids.device}','employee_id','${ids.employee}','assignment_epoch',1)),
    ('${leasedJobKey}','employee_event_push','${ids.leasedSource}'::uuid,
      jsonb_build_object('credential_id','${ids.credential}','device_id','${ids.device}','employee_id','${ids.employee}','assignment_epoch',1)),
    ('${rollbackJobKey}','employee_native_push','${ids.rollbackSource}'::uuid,
      jsonb_build_object('credential_id','${ids.rollbackCredential}','device_id','${ids.rollbackDevice}','employee_id','${ids.rollbackEmployee}','assignment_epoch',1));
`);

const leased = await json(`row_to_json(public.claim_operational_notification_job_by_key('${leasedJobKey}','removal-database-worker',90))`);
assert.match(leased.lease_token, /^[0-9a-f-]{36}$/i);

function removeSql({
  operationId = ids.operation,
  deviceId = ids.device,
  credentialId = ids.credential,
  tokenHash = credentialHash,
} = {}) {
  return `select public.device_auth_remove_custodial_credential(
    '${operationId}'::uuid,'${deviceId}'::uuid,'${credentialId}'::uuid,'${tokenHash}'
  )::text;`;
}

const concurrent = await Promise.all([concurrentSql(removeSql()), concurrentSql(removeSql())]);
assert.ok(concurrent.every((result) => result.status === 0), concurrent.map((result) => result.stderr).join("\n"));
const concurrentResults = concurrent.map((result) => JSON.parse(result.stdout.split("\n").filter(Boolean).at(-1)));
assert.ok(concurrentResults.every((result) => result.ok === true && result.removed === true));
assert.deepEqual(concurrentResults.map((result) => result.replayed).sort(), [false, true]);
assert.ok(concurrentResults.every((result) => result.operation_id === ids.operation));
assert.ok(concurrentResults.every((result) => result.device_id === "KIOSK_02"));

assert.equal(await sql(`select count(*) from public.device_auth_removal_operations where operation_id='${ids.operation}'::uuid;`), "1");
assert.equal(await sql(`select count(*) from public.device_auth_events where credential_id='${ids.credential}'::uuid and event_type='custodial_device_removed';`), "1");
assert.equal(await sql(`select revoked_reason from public.device_auth_credentials where credential_id='${ids.credential}'::uuid;`), "custodial_device_removed");
assert.equal(await sql(`select active::text||'|'||revoked_reason from public.employee_push_registrations where registration_id='${ids.registration}'::uuid;`), "false|custodial_device_removed");
assert.equal(await sql(`select state||'|'||last_error from public.event_push_instances where instance_id='${ids.eventInstance}'::uuid;`), "cancelled|custodial_device_removed");
assert.equal(await sql(`select status||'|'||last_error from public.operational_notification_jobs where job_key='${pendingJobKey}';`), "dead|custodial_device_removed");
assert.equal(await sql(`select status||'|'||(lease_token='${leased.lease_token}'::uuid)::text||'|'||last_error from public.operational_notification_jobs where job_key='${leasedJobKey}';`), "dead|true|custodial_device_removed");
assert.equal(await sql(`select coalesce((public.claim_operational_notification_job_by_key('${pendingJobKey}','restart-worker',90)).job_id::text,'');`), "");
assert.equal(await sql(`select coalesce((public.claim_operational_notification_job_by_key('${leasedJobKey}','restart-worker',90)).job_id::text,'');`), "");

// A worker holding the exact pre-removal lease may make the already-dead row
// fully terminal; it cannot turn the cancelled job back into retryable work.
await sql(`select public.finish_operational_notification_job_terminal(
  '${leased.job_id}'::uuid,'${leased.lease_token}'::uuid,'custodial_device_removed'
);`);
assert.equal(await sql(`select status||'|'||(lease_token is null)::text from public.operational_notification_jobs where job_key='${leasedJobKey}';`), "dead|true");

// New docker/psql processes model a backend restart. The exact proof replays,
// while a UUID alone, a wrong hash, or a fresh UUID after revocation fails.
const restartReplay = await json(`public.device_auth_remove_custodial_credential(
  '${ids.operation}'::uuid,'${ids.device}'::uuid,'${ids.credential}'::uuid,'${credentialHash}'
)`);
assert.equal(restartReplay.replayed, true);
const wrongHash = await json(`public.device_auth_remove_custodial_credential(
  '${ids.operation}'::uuid,'${ids.device}'::uuid,'${ids.credential}'::uuid,'${"e".repeat(64)}'
)`);
assert.equal(wrongHash.ok, false);
assert.equal(wrongHash.reason, "operation_conflict");
const freshAfterRevoke = await json(`public.device_auth_remove_custodial_credential(
  '42000000-0000-4000-8000-000000000018'::uuid,'${ids.device}'::uuid,'${ids.credential}'::uuid,'${credentialHash}'
)`);
assert.equal(freshAfterRevoke.ok, false);
assert.equal(freshAfterRevoke.reason, "credential_revoked");
const operationOnly = await concurrentSql(`select public.device_auth_remove_custodial_credential(
  '${ids.operation}'::uuid,'${ids.device}'::uuid,null,null
);`);
assert.notEqual(operationOnly.status, 0);
assert.match(operationOnly.stderr, /credential proof are required/i);

const finalAuthority = await json(`public.mz_resolve_employee_push_delivery('${ids.credential}'::uuid,1,now())`);
assert.equal(finalAuthority.ok, false);
assert.equal(finalAuthority.terminal, true);
assert.equal(finalAuthority.reason, "device_credential_revoked");

// Rollback leaves every participating row untouched, which preserves the
// documented application rollback path for a failed transaction/deploy.
await sql(`begin; select public.device_auth_remove_custodial_credential(
  '${ids.rollbackOperation}'::uuid,'${ids.rollbackDevice}'::uuid,'${ids.rollbackCredential}'::uuid,'${rollbackHash}'
); rollback;`);
assert.equal(await sql(`select (revoked_at is null)::text from public.device_auth_credentials where credential_id='${ids.rollbackCredential}'::uuid;`), "true");
assert.equal(await sql(`select active::text from public.employee_push_registrations where registration_id='${ids.rollbackRegistration}'::uuid;`), "true");
assert.equal(await sql(`select status from public.operational_notification_jobs where job_key='${rollbackJobKey}';`), "pending");
assert.equal(await sql(`select count(*) from public.device_auth_removal_operations where operation_id='${ids.rollbackOperation}'::uuid;`), "0");

assert.equal(await sql(`select relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class where oid='public.device_auth_removal_operations'::regclass;`), "true|true");
assert.equal(await sql(`select has_table_privilege('anon','public.device_auth_removal_operations','select')::text||'|'||has_table_privilege('authenticated','public.device_auth_removal_operations','select')::text;`), "false|false");
assert.equal(await sql(`select has_function_privilege('anon','public.device_auth_remove_custodial_credential(uuid,uuid,uuid,text,timestamptz)','execute')::text||'|'||has_function_privilege('authenticated','public.device_auth_remove_custodial_credential(uuid,uuid,uuid,text,timestamptz)','execute')::text;`), "false|false");
assert.equal(await sql(`select (result_json::text like '%${credentialHash}%')::text from public.device_auth_removal_operations where operation_id='${ids.operation}'::uuid;`), "false");

console.log("CUSTODIAL_DEVICE_REMOVAL_DATABASE_PASS");
