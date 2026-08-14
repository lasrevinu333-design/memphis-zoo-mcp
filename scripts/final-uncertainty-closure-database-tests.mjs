#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const container = String(process.env.FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.FINAL_UNCERTAINTY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const secret = "final-uncertainty-test-012345678901234567890";
const nativeRouteSecret = "final-uncertainty-native-route-test-01234567890";
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
sql(`select public.tool_report_device_sync_status('UNCERTAINTY_${stamp}',0,null,0,now(),'test',null,'rollback-readiness-test');`);
const blockedRollback = JSON.parse(sql(`select public.tool_get_device_rollback_readiness('UNCERTAINTY_${stamp}')::text;`));
assert.equal(blockedRollback.contract_version, "custodial-rollback-readiness.v2");
assert.equal(blockedRollback.eligible, false, "a backend session blocks rollback even when the browser queue is reported empty");
assert.equal(blockedRollback.backend_open_session_count, 1);
sql(`update public.sessions set status='cancelled',ended_at=now(),updated_at=now() where session_uuid='uncertainty-stale-${stamp}';`);
const readyRollback = JSON.parse(sql(`select public.tool_get_device_rollback_readiness('UNCERTAINTY_${stamp}')::text;`));
assert.equal(readyRollback.eligible, true, "a fresh zero queue report with no backend open session permits a rollback receipt");
assert.equal(readyRollback.backend_queue_count, 0);
assert.equal(sql(`select public.sch_service_date('2026-08-13 02:00:00-05'::timestamptz);`), "2026-08-12",
  "the schedule service date must stay on the same operational day before the 04:00 Central cutoff");
assert.equal(sql(`select public.sch_service_date('2026-08-13 03:59:59-05'::timestamptz);`), "2026-08-12");
assert.equal(sql(`select public.sch_service_date('2026-08-13 04:00:00-05'::timestamptz);`), "2026-08-13");
assert.equal(sql(`select public.sch_service_date('2026-03-08 03:59:59-05'::timestamptz);`), "2026-03-07",
  "spring DST transition must preserve the configured Central operational boundary");
assert.equal(sql(`select public.sch_service_date('2026-03-08 04:00:00-05'::timestamptz);`), "2026-03-08");
assert.equal(sql(`select public.sch_service_date('2026-11-01 03:59:59-06'::timestamptz);`), "2026-10-31",
  "fall DST transition must preserve the configured Central operational boundary");
assert.equal(sql(`select public.sch_service_date('2026-11-01 04:00:00-06'::timestamptz);`), "2026-11-01");

sql(`select public.custodial_configure_backend_execution_key(
  encode(extensions.digest(convert_to(${q(secret)},'UTF8'),'sha256'),'hex'),'final uncertainty test');`);
sql(`select public.custodial_configure_native_route_proof_key(
  encode(extensions.digest(convert_to(${q(nativeRouteSecret)},'UTF8'),'sha256'),'hex'),'final uncertainty test');`);
const historicalSessionId = randomUUID();
const historicalFinishId = randomUUID();
sql(`insert into public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at)
  values ('${historicalSessionId}','${historicalSessionId}','${locationId}'::uuid,'${employeeId}'::uuid,'${deviceId}'::uuid,'active',now()-interval '10 minutes');`);
const historicalFinish = JSON.parse(sql(`select public.custodial_finish_historical_session_authoritative(
  '${historicalSessionId}','UNCERTAINTY_${stamp}','${historicalFinishId}'::uuid,now(),${q(secret)})::text;`));
assert.equal(historicalFinish.status, "pending_submit");
assert.equal(historicalFinish.finish_operation_id, historicalFinishId);
const historicalFinishReplay = JSON.parse(sql(`select public.custodial_finish_historical_session_authoritative(
  '${historicalSessionId}','UNCERTAINTY_${stamp}','${historicalFinishId}'::uuid,now(),${q(secret)})::text;`));
assert.equal(historicalFinishReplay.replayed, true, "the exact Build 22 finish adapter must replay one stable operation");
sql(`update public.sessions set status='cancelled',updated_at=now() where session_uuid='${historicalSessionId}';`);
const pause = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','pause_canary','uncertainty health test','{"ok":true}'::jsonb,${q(secret)})::text;`));
assert.equal(pause.canary_paused, true);
sql(`create or replace function public.tool_start_offline_occurrence(
  p_device_id text,p_location_code text,p_client_session_id text,p_client_started_at text,p_snapshot_id text,
  p_snapshot_employee_id text,p_snapshot_assignment_epoch integer,p_snapshot_credential_id text,
  p_authenticated_credential_id text,p_native_scan_entry_id text,p_native_start_attestation_version text,
  p_native_start_attestation text,p_native_route_proof_secret text,p_backend_execution_secret text)
  returns jsonb language sql as $$select '{"broken":true}'::jsonb$$;`);
const unhealthy = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(unhealthy.ok, false);
assert.ok(unhealthy.mismatched_objects.includes("tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)"));
const spoofedResume = sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','resume_canary','spoofed green health','{"ok":true}'::jsonb,${q(secret)});`, { expectFailure: true });
assert.match(spoofedResume, /fresh persisted database recovery probe is green before canary resume/i);
const restored = JSON.parse(sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','restore_authority','restore exact authority set',${q(JSON.stringify(unhealthy))}::jsonb,${q(secret)})::text;`));
assert.equal(restored.restored_objects, unhealthy.canonical_objects_expected);
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).ok, true);

const credentialId = randomUUID();
const fcmToken = `uncertainty-fcm-${stamp}-00000000000000000000`;
const fcmTokenSha256 = createHash("sha256").update(fcmToken).digest("hex");
sql(`
  insert into public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at,metadata_json)
  values ('${credentialId}'::uuid,'uncertainty-manager-${stamp}','Uncertainty Manager','${"a".repeat(64)}','full_access','${managerId}'::uuid,now()+interval '1 day','{"test":true}'::jsonb);
  insert into public.ops_manager_notification_preferences(credential_id,manager_id,due_soon_enabled,overdue_enabled)
  values ('${credentialId}'::uuid,'${managerId}'::uuid,true,true);
  insert into public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
  values ('${credentialId}'::uuid,'${managerId}'::uuid,'uncertainty-manager-${stamp}','android',${q(fcmToken)});
`);
const pushDeviceId = sql(`select push_device_id from public.ops_manager_push_devices where credential_id='${credentialId}'::uuid;`);
const expiredKey = `event-expired-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(expiredKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'event_digest','Expired event','Must not send',
    jsonb_build_object('kind','event_digest','next_event_starts_at',to_char(now()-interval '1 minute','YYYY-MM-DD"T"HH24:MI:SSOF')));`);
assert.equal(sql(`select count(*) from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) where job_key=${q(expiredKey)};`), "0");
assert.equal(sql(`select status from public.ops_manager_notification_queue where job_key=${q(expiredKey)};`), "cancelled");

const staleLocationKey = `location-stale-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(staleLocationKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'location_digest','Stale location','Must not send',
    jsonb_build_object('kind','location_digest','location_fingerprint','${"0".repeat(32)}'));`);
assert.equal(sql(`select count(*) from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) where job_key=${q(staleLocationKey)};`), "0");
assert.equal(sql(`select status from public.ops_manager_notification_queue where job_key=${q(staleLocationKey)};`), "cancelled",
  "a location digest must not be claimed after its dashboard state changes");

const crossingLocationKey = `location-crossing-${stamp}`;
const crossingLocationLease = randomUUID();
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json,status,leased_at,leased_until,lease_token,worker_id)
  values (${q(crossingLocationKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'location_digest','Crossing location','Must expire before finish',
    jsonb_build_object('kind','location_digest','location_fingerprint','${"0".repeat(32)}'),'leased',now(),now()+interval '2 minutes','${crossingLocationLease}'::uuid,'uncertainty-worker');`);
const crossingLocationQueueId = sql(`select queue_id from public.ops_manager_notification_queue where job_key=${q(crossingLocationKey)};`);
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${crossingLocationQueueId}'::uuid,'${crossingLocationLease}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "f",
  "the worker must revalidate location dashboard truth immediately before provider dispatch");
const finishedLocation = JSON.parse(sql(`select row_to_json(public.ops_manager_finish_notification_job('${crossingLocationQueueId}'::uuid,'${crossingLocationLease}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)},true,'must-not-be-recorded',null,30))::text;`));
assert.equal(finishedLocation.status, "cancelled", "a stale location digest cannot be recorded as sent");
assert.equal(finishedLocation.provider_message_id, null);

const revokedBeforeClaimKey = `recipient-revoked-before-claim-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
  values (${q(revokedBeforeClaimKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'test','Revoked recipient','Must not send');
  update public.ops_manager_trusted_devices set revoked_at=now() where credential_id='${credentialId}'::uuid;`);
assert.equal(sql(`select count(*) from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) where job_key=${q(revokedBeforeClaimKey)};`), "0");
assert.equal(sql(`select status from public.ops_manager_notification_queue where job_key=${q(revokedBeforeClaimKey)};`), "cancelled",
  "a notification must not be claimed after its recipient authority is revoked");
sql(`update public.ops_manager_trusted_devices set revoked_at=null,expires_at=now()+interval '1 day' where credential_id='${credentialId}'::uuid;`);

const revokedAfterLeaseKey = `recipient-revoked-after-lease-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
  values (${q(revokedAfterLeaseKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'test','Crossing recipient','Must not send');`);
const recipientLease = JSON.parse(sql(`select row_to_json(q)::text from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) q where q.job_key=${q(revokedAfterLeaseKey)};`));
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${recipientLease.queue_id}'::uuid,'${recipientLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "t");
sql(`update public.ops_manager_trusted_devices set expires_at=now()-interval '1 second' where credential_id='${credentialId}'::uuid;`);
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${recipientLease.queue_id}'::uuid,'${recipientLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "f",
  "the worker must revalidate exact recipient authority immediately before provider dispatch");
const finishedRecipient = JSON.parse(sql(`select row_to_json(public.ops_manager_finish_notification_job('${recipientLease.queue_id}'::uuid,'${recipientLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)},true,'must-not-be-recorded',null,30))::text;`));
assert.equal(finishedRecipient.status, "cancelled", "an expired recipient cannot be recorded as sent");
assert.equal(finishedRecipient.provider_message_id, null);
assert.match(finishedRecipient.last_error, /recipient authority/i);
sql(`update public.ops_manager_trusted_devices set expires_at=now()+interval '1 day' where credential_id='${credentialId}'::uuid;`);

const rotatedTokenKey = `recipient-token-rotated-${stamp}`;
sql(`insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
  values (${q(rotatedTokenKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'test','Rotated recipient','Must not reach the stale registration');`);
const rotatedTokenLease = JSON.parse(sql(`select row_to_json(q)::text from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) q where q.job_key=${q(rotatedTokenKey)};`));
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${rotatedTokenLease.queue_id}'::uuid,'${rotatedTokenLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "t");
sql(`update public.ops_manager_push_devices set fcm_token=${q(`${fcmToken}-rotated`)} where push_device_id='${pushDeviceId}'::uuid;`);
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${rotatedTokenLease.queue_id}'::uuid,'${rotatedTokenLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "f",
  "a token rotation must invalidate the exact registration selected by the worker");
const finishedRotatedToken = JSON.parse(sql(`select row_to_json(public.ops_manager_finish_notification_job('${rotatedTokenLease.queue_id}'::uuid,'${rotatedTokenLease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)},true,'must-not-be-recorded',null,30))::text;`));
assert.equal(finishedRotatedToken.status, "cancelled", "a stale push registration cannot be recorded as sent");
assert.equal(finishedRotatedToken.provider_message_id, null);
sql(`update public.ops_manager_push_devices set fcm_token=${q(fcmToken)} where push_device_id='${pushDeviceId}'::uuid;`);

const crossingKey = `event-crossing-${stamp}`;
const eventId = randomUUID();
sql(`insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_date,status,event_scope,display_location,needs_review)
  select '${eventId}'::uuid,'Uncertainty canonical event',id,((now()+interval '1 hour') at time zone 'America/Chicago')::date,
    ((now()+interval '1 hour') at time zone 'America/Chicago')::time,((now()+interval '1 hour') at time zone 'America/Chicago')::date,
    'SCHEDULED','ZOO_WIDE','Zoo Footprint',false from public.location_groups order by id limit 1;
  insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(crossingKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'event_digest','Crossing event','Must expire before finish',
    jsonb_build_object('kind','event_digest','next_event_id','${eventId}'::uuid,'next_event_starts_at',
      (select (event_date+start_time) at time zone 'America/Chicago' from public.events_app_events where id='${eventId}'::uuid)));`);
const lease = JSON.parse(sql(`select row_to_json(q)::text from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) q where q.job_key=${q(crossingKey)};`));
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${lease.queue_id}'::uuid,'${lease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "t");
sql(`update public.events_app_events set status='CANCELLED',cancelled_at=now(),cancelled_by='final uncertainty test' where id='${eventId}'::uuid;`);
assert.equal(sql(`select public.ops_manager_notification_job_is_current('${lease.queue_id}'::uuid,'${lease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)});`), "f",
  "the worker must revalidate the canonical event immediately before provider dispatch");
const finished = JSON.parse(sql(`select row_to_json(public.ops_manager_finish_notification_job('${lease.queue_id}'::uuid,'${lease.lease_token}'::uuid,'${pushDeviceId}'::uuid,${q(fcmTokenSha256)},true,'must-not-be-recorded',null,30))::text;`));
assert.equal(finished.status, "cancelled", "an event cancelled while leased cannot be recorded as sent");
assert.equal(finished.provider_message_id, null);

const rescheduledId = randomUUID();
const rescheduledKey = `event-rescheduled-${stamp}`;
sql(`insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_date,status,event_scope,display_location,needs_review)
  select '${rescheduledId}'::uuid,'Uncertainty rescheduled event',id,((now()+interval '2 hours') at time zone 'America/Chicago')::date,
    ((now()+interval '2 hours') at time zone 'America/Chicago')::time,((now()+interval '2 hours') at time zone 'America/Chicago')::date,
    'SCHEDULED','ZOO_WIDE','Zoo Footprint',false from public.location_groups order by id limit 1;
  insert into public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body,data_json)
  values (${q(rescheduledKey)},'${credentialId}'::uuid,'${managerId}'::uuid,'event_digest','Rescheduled event','Old occurrence must not send',
    jsonb_build_object('kind','event_digest','next_event_id','${rescheduledId}'::uuid,'next_event_starts_at',
      (select (event_date+start_time) at time zone 'America/Chicago' from public.events_app_events where id='${rescheduledId}'::uuid)));
  update public.events_app_events set start_time=((now() at time zone 'America/Chicago')+interval '3 hours')::time where id='${rescheduledId}'::uuid;`);
assert.equal(sql(`select count(*) from public.ops_manager_claim_notification_jobs('uncertainty-worker',10,120) where job_key=${q(rescheduledKey)};`), "0");
assert.equal(sql(`select status from public.ops_manager_notification_queue where job_key=${q(rescheduledKey)};`), "cancelled");

const employeeCredentialId = randomUUID();
const employeeRegistrationId = randomUUID();
const employeeTokenA = `employee-token-a-${stamp}-00000000000000000000`;
const employeeTokenB = `employee-token-b-${stamp}-00000000000000000000`;
const employeeTokenC = `employee-token-c-${stamp}-00000000000000000000`;
const employeeTokenHashA = createHash("sha256").update(employeeTokenA).digest("hex");
const employeeTokenHashB = createHash("sha256").update(employeeTokenB).digest("hex");
const employeeTokenHashC = createHash("sha256").update(employeeTokenC).digest("hex");
sql(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values('${employeeCredentialId}'::uuid,'${deviceId}'::uuid,'${"b".repeat(64)}','employee notification race',now(),now()+interval '1 day','{}'::jsonb);
  insert into public.employee_push_registrations(registration_id,device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash)
  select '${employeeRegistrationId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialId}'::uuid,'${employeeId}'::uuid,assignment_epoch,'android',${q(employeeTokenA)},${q(employeeTokenHashA)}
  from public.devices where id='${deviceId}'::uuid;`);
sql(`update public.employee_push_registrations set fcm_token=${q(employeeTokenB)},token_hash=${q(employeeTokenHashB)},last_successful_delivery_at=null,last_error=null
  where registration_id='${employeeRegistrationId}'::uuid;`);
const staleEmployeeSuccess = JSON.parse(sql(`select public.mz_record_employee_push_delivery(
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashA)},true,false,null,now())::text;`));
assert.equal(staleEmployeeSuccess.current, false, "an old token success cannot update the reused registration row");
const staleEmployeeReject = JSON.parse(sql(`select public.mz_record_employee_push_delivery(
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashA)},false,true,'old token rejected',now())::text;`));
assert.equal(staleEmployeeReject.current, false, "an old token rejection cannot revoke the replacement token");
assert.equal(sql(`select active::text||'|'||(last_successful_delivery_at is null)::text||'|'||(last_error is null)::text
  from public.employee_push_registrations where registration_id='${employeeRegistrationId}'::uuid;`), "true|true|true");
assert.equal(JSON.parse(sql(`select public.mz_record_employee_push_delivery(
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashB)},true,false,null,now())::text;`)).current, true);
assert.equal(sql(`select (last_successful_delivery_at is not null)::text from public.employee_push_registrations
  where registration_id='${employeeRegistrationId}'::uuid;`), "true");
sql(`select public.mz_register_employee_push('${employeeCredentialId}'::uuid,${q(employeeTokenC)},${q(employeeTokenHashC)},'android','test','test');`);
assert.equal(sql(`select (token_hash=${q(employeeTokenHashC)})::text||'|'||(last_successful_delivery_at is null)::text
  from public.employee_push_registrations where registration_id='${employeeRegistrationId}'::uuid;`), "true|true",
  "rotating a reused registration must clear the previous token generation's success state");

console.log(JSON.stringify({ ok: true, stale_session_masked: false, rollback_without_quiescence_accepted: false,
  rollback_after_quiescence_ready: true, spoofed_authority_health_accepted: false,
  historical_finish_adapter_replayed: true,
  expired_event_claimed: false, stale_location_claimed: false, stale_location_recorded_sent: false,
  revoked_recipient_claimed: false, expired_recipient_recorded_sent: false, rotated_token_recorded_sent: false,
  stale_employee_token_result_recorded: false,
  cancelled_event_recorded_sent: false, rescheduled_event_claimed: false }, null, 2));
