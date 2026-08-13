#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = String(process.env.FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.FINAL_UNCERTAINTY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const secret = "final-uncertainty-test-012345678901234567890";
const managerId = "00000000-0000-4000-8000-000000000001";
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement, { expectFailure = false } = {}) {
  try {
    const result = execFileSync("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    }).trim().split("\n").at(-1) || "";
    if (expectFailure) assert.fail(`Expected SQL failure: ${statement}`);
    return result;
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message);
  }
}

const stamp = randomUUID().replaceAll("-", "").slice(0, 12);
const locationId = randomUUID();
const employeeId = randomUUID();
const deviceId = randomUUID();
sql(`
  insert into public.locations(id,location_code,location_name,location_type,form_type,active)
  values ('${locationId}'::uuid,'UNCERTAINTY_${stamp}','Uncertainty stale session','restroom','restroom',true);
  insert into public.employees(id,employee_code,display_name,active,role)
  values ('${employeeId}'::uuid,'UNC${stamp}','Uncertainty Employee',true,'staff');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values ('${deviceId}'::uuid,'UNCERTAINTY_${stamp}','Uncertainty Device',true,'${employeeId}'::uuid);
  insert into public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
  values ('uncertainty-stale-${stamp}','uncertainty-stale-${stamp}','${locationId}'::uuid,'${employeeId}'::uuid,'${deviceId}'::uuid,'active',public.operational_day_start(now())-interval '1 minute');
`);
const staleStatus = sql(`select status_code||'|'||coalesce(open_session_status,'none') from public.v_location_dashboard_status where location_id='${locationId}'::uuid;`);
assert.equal(staleStatus, "not_cleaned|none", "a prior-operational-day abandoned session cannot mask current readiness as in progress");

sql(`select public.custodial_configure_backend_execution_key(
  encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'final uncertainty test');`);
const pause = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','pause_canary','uncertainty health test','{"ok":true}'::jsonb,${q(secret)})::text;`));
assert.equal(pause.canary_paused, true);
sql(`create or replace function public.tool_start_offline_occurrence(
  p_device_id text,p_location_code text,p_client_session_id text,p_client_started_at text,p_snapshot_id text,
  p_snapshot_employee_id text,p_snapshot_assignment_epoch integer,p_snapshot_credential_id text,
  p_authenticated_credential_id text,p_backend_execution_secret text)
  returns jsonb language sql as $$select '{"broken":true}'::jsonb$$;`);
const unhealthy = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(unhealthy.ok, false);
assert.ok(unhealthy.mismatched_functions.includes("public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)"));
const spoofedResume = sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','resume_canary','spoofed green health','{"ok":true}'::jsonb,${q(secret)});`, { expectFailure: true });
assert.match(spoofedResume, /cannot resume until authoritative health is green/i);
const restored = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','restore_authority','restore exact authority set',${q(JSON.stringify(unhealthy))}::jsonb,${q(secret)})::text;`));
assert.equal(restored.restored_functions, 7);
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).ok, true);

const credentialId = randomUUID();
sql(`
  insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json)
  values ('${credentialId}'::uuid,'uncertainty-manager-${stamp}','Uncertainty Manager','${"a".repeat(64)}','full_access','${managerId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb);
`);
const expiredKey = `event-expired-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(expiredKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'event_digest','Expired event','Must not send',
    jsonb_build_object('kind','event_digest','next_event_starts_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSOF')));`);
assert.equal(sql(`select count(*) from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) where job_key=${q(expiredKey)};`), "0");
assert.equal(sql(`select status from public.ops_manager_notification_queue where job_key=${q(expiredKey)};`), "cancelled");

const crossingKey = `event-crossing-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(crossingKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'event_digest','Crossing event','Must expire before finish',
    jsonb_build_object('kind','event_digest','next_event_starts_at',to_char(now()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SSOF')));`);
const lease = JSON.parse(sql(`select row_to_json(q)::text from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) q where q.job_key=${q(crossingKey)};`));
sql(`update public.ops_manager_notification_queue set data_json=jsonb_set(data_json,'{next_event_starts_at}',to_jsonb(to_char(now()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SSOF'))) where queue_id='${lease.queue_id}'::uuid;`);
const finished = JSON.parse(sql(`select row_to_json(public.ops_manager_finish_notification_job('${lease.queue_id}'::uuid,'${lease.lease_token}'::uuid,true,'must-not-be-recorded',null,30))::text;`));
assert.equal(finished.status, "cancelled", "an event crossing its start while leased cannot be recorded as sent");
assert.equal(finished.provider_message_id, null);

console.log(JSON.stringify({ ok: true, stale_session_masked: false, spoofed_authority_health_accepted: false,
  expired_event_claimed: false, crossing_event_recorded_sent: false }, null, 2));
