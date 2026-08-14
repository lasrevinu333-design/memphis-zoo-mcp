#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const container = String(process.env.FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.FINAL_UNCERTAINTY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

const secret = "final-uncertainty-test-012345678901234567890";
const nativeRouteSecret = "final-uncertainty-native-route-test-01234567890";
const managerId = "00000000-0000-4000-8000-000000000001";
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const execFileAsync = promisify(execFile);
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
async function sqlAsync(statement) {
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return String(stdout || "").trim().split("\n").at(-1) || "";
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

const unexpectedAuthorityRole = `custodial_uncertainty_${stamp}`;
sql(`create role ${unexpectedAuthorityRole} login bypassrls;
  grant service_role to ${unexpectedAuthorityRole};`);
let unexpectedAuthorityDetected = false;
try {
  execFileSync(process.execPath, ["scripts/refresh-schema-fingerprint.mjs", "--check"], {
    cwd: process.cwd(), encoding: "utf8", stdio: "pipe",
    env: {
      ...process.env,
      SCHEMA_FINGERPRINT_DOCKER_CONTAINER: container,
      SCHEMA_FINGERPRINT_DATABASE: database,
    },
  });
} catch {
  unexpectedAuthorityDetected = true;
} finally {
  sql(`revoke service_role from ${unexpectedAuthorityRole}; drop role ${unexpectedAuthorityRole};`);
}
assert.equal(unexpectedAuthorityDetected, true,
  "an arbitrary BYPASSRLS login with service-role membership must change connected schema identity");
execFileSync(process.execPath, ["scripts/refresh-schema-fingerprint.mjs", "--check"], {
  cwd: process.cwd(), encoding: "utf8", stdio: "pipe",
  env: {
    ...process.env,
    SCHEMA_FINGERPRINT_DOCKER_CONTAINER: container,
    SCHEMA_FINGERPRINT_DATABASE: database,
  },
});

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

const requiredNotificationAuthorityFunctions = [
  "mz_register_employee_push(uuid,text,text,text,text,text)",
  "mz_mark_employee_event_opened(uuid,text)",
  "mz_enqueue_employee_event_pushes(timestamp with time zone)",
  "mz_enqueue_employee_location_pushes(timestamp with time zone)",
  "mz_resolve_employee_push_delivery(uuid,bigint,timestamp with time zone)",
  "mz_record_employee_push_delivery(uuid,text,boolean,boolean,text,timestamp with time zone)",
  "mz_claim_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)",
  "mz_release_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)",
  "mz_record_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)",
  "mz_get_employee_native_push_delivery_receipt(uuid,uuid,uuid,bigint)",
  "mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)",
  "mz_release_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text)",
  "mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)",
  "finish_operational_notification_job(uuid,uuid,boolean,text,integer)",
  "finish_operational_notification_job_terminal(uuid,uuid,text)",
];
assert.equal(sql(`select count(*) from public.custodial_release_authority_restore_inventory
  where object_kind='function' and object_identity in (${requiredNotificationAuthorityFunctions.map(q).join(',')});`),
String(requiredNotificationAuthorityFunctions.length), "every live employee-notification boundary must be recoverable");
assert.equal(sql(`select coalesce(string_agg(p.oid::regprocedure::text,',' order by p.oid::regprocedure::text),'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like '%notification%' or p.proname like '%push%')
    and not exists(select 1 from public.custodial_release_authority_restore_inventory i
      where i.object_kind='function' and i.object_identity=p.oid::regprocedure::text);`), "",
"every live notification and push function must be generated into the recovery inventory");
assert.equal(sql(`select coalesce(string_agg(c.relname,',' order by c.relname),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (c.relname like '%notification%' or c.relname like '%push%')
    and not exists(select 1 from public.custodial_release_authority_restore_inventory i
      where i.object_kind='relation' and i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname));`), "",
"every live notification and push relation must be generated into the recovery inventory");
sql(`drop function public.mz_register_employee_push(uuid,text,text,text,text,text);`);
const missingNotificationAuthority = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(missingNotificationAuthority.ok, false);
assert.ok(missingNotificationAuthority.missing_objects.includes("mz_register_employee_push(uuid,text,text,text,text,text)"),
  "dropping a live notification RPC must fail the canonical authority health gate");
sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','restore_authority','restore missing notification authority',
  ${q(JSON.stringify(missingNotificationAuthority))}::jsonb,${q(secret)});`);
assert.ok(sql(`select to_regprocedure('public.mz_register_employee_push(uuid,text,text,text,text,text)') is not null;`) === "t");
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).ok, true);
sql(`drop table public.device_notification_acknowledgements;`);
const missingNotificationRelation = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(missingNotificationRelation.ok, false);
assert.ok(missingNotificationRelation.missing_objects.includes("public.device_notification_acknowledgements"),
  "dropping a live notification relation must fail the canonical authority health gate");
sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','restore_authority','restore missing notification relation',
  ${q(JSON.stringify(missingNotificationRelation))}::jsonb,${q(secret)});`);
assert.equal(sql(`select (to_regclass('public.device_notification_acknowledgements') is not null)::text;`), "true");
assert.equal(JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`)).ok, true);

sql(`alter table public.custodial_release_canary_controls
  alter column paused drop not null,
  alter column paused set default false,
  add column unreviewed_restore_drift text;
`);
const inPlaceRelationDrift = JSON.parse(sql(`select public.custodial_backend_authority_health(${q(secret)})::text;`));
assert.equal(inPlaceRelationDrift.ok, false);
assert.ok(inPlaceRelationDrift.mismatched_objects.includes("public.custodial_release_canary_controls"),
  "default, nullability, and extra-column drift must fail canonical relation health");
assert.ok(inPlaceRelationDrift.mismatched_objects.includes("public.custodial_release_canary_controls:paused"));
sql(`select public.custodial_control_release_canary(
  '${managerId}'::uuid,'${randomUUID()}'::uuid,'KIOSK_09','restore_authority','restore in-place relation drift',
  ${q(JSON.stringify(inPlaceRelationDrift))}::jsonb,${q(secret)});`);
const restoredPausedColumn = sql(`select a.attnotnull::text||'|'||pg_get_expr(d.adbin,d.adrelid)
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.custodial_release_canary_controls'::regclass and a.attname='paused';`);
assert.equal(restoredPausedColumn, "true|true", "in-place nullability and default drift must restore exactly");
assert.equal(sql(`select (not exists(select 1 from pg_attribute where attrelid='public.custodial_release_canary_controls'::regclass
  and attname='unreviewed_restore_drift' and attnum>0 and not attisdropped))::text;`), "true",
"unexpected columns must be removed by the exact column-set restoration entry");
assert.equal(sql(`select paused::text from public.custodial_release_canary_controls where device_identifier='KIOSK_09';`), "true",
  "in-place restoration must preserve canonical canary control data");
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
sql(`update public.ops_manager_trusted_devices
  set created_at=now()-interval '1 day',expires_at=now()-interval '1 second'
  where credential_id='${credentialId}'::uuid;`);
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
const employeeCredentialTokenHash = createHash("sha256").update(`employee-credential-${stamp}`).digest("hex");
function leaseEmployeeEventJob(instanceId, label) {
  const jobId = randomUUID();
  const leaseToken = randomUUID();
  const jobKey = `uncertainty-event-${label}-${stamp}-${jobId}`;
  sql(`insert into public.operational_notification_jobs(
      job_id,job_key,job_type,source_id,available_at,payload_json,status,attempts,max_attempts,
      leased_at,leased_until,lease_token,worker_id)
    values('${jobId}'::uuid,${q(jobKey)},'employee_event_push','${instanceId}'::uuid,now()-interval '1 second',
      '{}'::jsonb,'leased',1,3,now(),now()+interval '2 minutes','${leaseToken}'::uuid,${q(`uncertainty-${label}`)});`);
  return { jobId, leaseToken, jobKey };
}
sql(`insert into public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at,metadata_json)
  values('${employeeCredentialId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialTokenHash}','employee notification race',now(),now()+interval '1 day','{}'::jsonb);
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

const cancelledEmployeeEventInstanceId = randomUUID();
sql(`insert into public.event_push_instances(
    instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
    assignment_epoch,notification_kind,scheduled_for,state,cancelled_at,last_error)
  select '${cancelledEmployeeEventInstanceId}'::uuid,${q(`employee-event-cancelled-${stamp}`)},e.id,e.revision,e.event_date,
    '${employeeId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialId}'::uuid,d.assignment_epoch,
    'day_before',now()-interval '1 minute','cancelled',now(),'cancelled before provider claim'
  from public.events_app_events e cross join public.devices d
  where e.id='${rescheduledId}'::uuid and d.id='${deviceId}'::uuid;`);
const cancelledEmployeeEventJob = leaseEmployeeEventJob(cancelledEmployeeEventInstanceId, "cancelled");
const cancelledEmployeeEventClaim = JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${cancelledEmployeeEventJob.jobId}'::uuid,'${cancelledEmployeeEventJob.leaseToken}'::uuid,
  '${cancelledEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`));
assert.equal(cancelledEmployeeEventClaim.ok, false);
assert.equal(cancelledEmployeeEventClaim.reason, "event_push_instance_cancelled",
  "a cancelled employee event must fail the database-bound pre-provider claim");

const crossingEmployeeEventInstanceId = randomUUID();
sql(`insert into public.event_push_instances(
    instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
    assignment_epoch,notification_kind,scheduled_for,state)
  select '${crossingEmployeeEventInstanceId}'::uuid,${q(`employee-event-crossing-${stamp}`)},e.id,e.revision,e.event_date,
    '${employeeId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialId}'::uuid,d.assignment_epoch,
    'shift_plus_15',now()-interval '1 minute','pending'
  from public.events_app_events e cross join public.devices d
  where e.id='${rescheduledId}'::uuid and d.id='${deviceId}'::uuid;`);
const crossingEmployeeEventJob = leaseEmployeeEventJob(crossingEmployeeEventInstanceId, "crossing");
const crossingEmployeeEventClaim = JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${crossingEmployeeEventJob.jobId}'::uuid,'${crossingEmployeeEventJob.leaseToken}'::uuid,
  '${crossingEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`));
assert.equal(crossingEmployeeEventClaim.ok, true);
assert.equal(sql(`select state from public.event_push_instances where instance_id='${crossingEmployeeEventInstanceId}'::uuid;`), "leased");
sql(`update public.events_app_events set status='CANCELLED',cancelled_at=now(),cancelled_by='employee provider boundary test'
  where id='${rescheduledId}'::uuid;`);
const crossingEmployeeEventFinish = JSON.parse(sql(`select public.mz_record_employee_event_push_delivery(
  '${crossingEmployeeEventJob.jobId}'::uuid,'${crossingEmployeeEventJob.leaseToken}'::uuid,
  '${crossingEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-result-must-not-commit',now())::text;`));
assert.equal(crossingEmployeeEventFinish.current, false,
  "an event cancelled across the provider boundary cannot be recorded as delivered");
assert.equal(crossingEmployeeEventFinish.recorded, false);
assert.equal(sql(`select state from public.event_push_instances where instance_id='${crossingEmployeeEventInstanceId}'::uuid;`), "cancelled");
assert.equal(sql(`select (last_successful_delivery_at is null)::text from public.employee_push_registrations
  where registration_id='${employeeRegistrationId}'::uuid;`), "true");

const successfulEmployeeEventId = randomUUID();
const successfulEmployeeEventInstanceId = randomUUID();
sql(`insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_date,status,event_scope,display_location,needs_review)
  select '${successfulEmployeeEventId}'::uuid,'Uncertainty employee delivery',id,((now()+interval '4 hours') at time zone 'America/Chicago')::date,
    ((now()+interval '4 hours') at time zone 'America/Chicago')::time,((now()+interval '4 hours') at time zone 'America/Chicago')::date,
    'SCHEDULED','ZOO_WIDE','Zoo Footprint',false from public.location_groups order by id limit 1;
  insert into public.event_push_instances(
    instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
    assignment_epoch,notification_kind,scheduled_for,state)
  select '${successfulEmployeeEventInstanceId}'::uuid,${q(`employee-event-success-${stamp}`)},e.id,e.revision,e.event_date,
    '${employeeId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialId}'::uuid,d.assignment_epoch,
    'day_before',now()-interval '1 minute','pending'
  from public.events_app_events e cross join public.devices d
  where e.id='${successfulEmployeeEventId}'::uuid and d.id='${deviceId}'::uuid;`);
const successfulEmployeeEventJob = leaseEmployeeEventJob(successfulEmployeeEventInstanceId, "success");
assert.equal(JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${successfulEmployeeEventJob.jobId}'::uuid,'${successfulEmployeeEventJob.leaseToken}'::uuid,
  '${successfulEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`)).ok, true);
const sameLeaseEmployeeEventClaim = JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${successfulEmployeeEventJob.jobId}'::uuid,'${successfulEmployeeEventJob.leaseToken}'::uuid,
  '${successfulEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`));
assert.equal(sameLeaseEmployeeEventClaim.ok, false);
assert.equal(sameLeaseEmployeeEventClaim.defer_finish, true);
assert.equal(sameLeaseEmployeeEventClaim.reason, "event_push_delivery_in_flight");
assert.equal(sql(`select state from public.event_push_instances where instance_id='${successfulEmployeeEventInstanceId}'::uuid;`), "leased",
  "an exact same-lease claim retry must not cancel the original in-flight provider boundary");
const recordSuccessfulEmployeeEventSql = `select public.mz_record_employee_event_push_delivery(
  '${successfulEmployeeEventJob.jobId}'::uuid,'${successfulEmployeeEventJob.leaseToken}'::uuid,
  '${successfulEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-result-committed',now())::text;`;
const successfulEmployeeEventFinishes = (await Promise.all(
  Array.from({ length: 4 }, () => sqlAsync(recordSuccessfulEmployeeEventSql)),
)).map((value) => JSON.parse(value));
assert.ok(successfulEmployeeEventFinishes.every((result) => result.current === true && result.recorded === true));
assert.equal(successfulEmployeeEventFinishes.filter((result) => result.already_recorded === false).length, 1,
  "one concurrent event result advances the durable dispatch and the rest replay it");
assert.equal(successfulEmployeeEventFinishes.filter((result) => result.already_recorded === true).length, 3);
assert.equal(sql(`select state||'|'||provider_message_id||'|'||(sent_at is not null)::text
  from public.event_push_instances where instance_id='${successfulEmployeeEventInstanceId}'::uuid;`),
"sent|provider-result-committed|true");
assert.equal(sql(`select (last_successful_delivery_at is not null)::text from public.employee_push_registrations
  where registration_id='${employeeRegistrationId}'::uuid;`), "true");

const ambiguousEmployeeEventId = randomUUID();
const ambiguousEmployeeEventInstanceId = randomUUID();
sql(`insert into public.events_app_events(id,event_name,location_group_id,event_date,start_time,end_date,status,event_scope,display_location,needs_review)
  select '${ambiguousEmployeeEventId}'::uuid,'Uncertainty ambiguous employee delivery',id,((now()+interval '5 hours') at time zone 'America/Chicago')::date,
    ((now()+interval '5 hours') at time zone 'America/Chicago')::time,((now()+interval '5 hours') at time zone 'America/Chicago')::date,
    'SCHEDULED','ZOO_WIDE','Zoo Footprint',false from public.location_groups order by id limit 1;
  insert into public.event_push_instances(
    instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
    assignment_epoch,notification_kind,scheduled_for,state)
  select '${ambiguousEmployeeEventInstanceId}'::uuid,${q(`employee-event-ambiguous-${stamp}`)},e.id,e.revision,e.event_date,
    '${employeeId}'::uuid,'${deviceId}'::uuid,'${employeeCredentialId}'::uuid,d.assignment_epoch,
    'day_before',now()-interval '1 minute','pending'
  from public.events_app_events e cross join public.devices d
  where e.id='${ambiguousEmployeeEventId}'::uuid and d.id='${deviceId}'::uuid;`);
const ambiguousEmployeeEventJob = leaseEmployeeEventJob(ambiguousEmployeeEventInstanceId, "ambiguous");
assert.equal(JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${ambiguousEmployeeEventJob.jobId}'::uuid,'${ambiguousEmployeeEventJob.leaseToken}'::uuid,
  '${ambiguousEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`)).dispatch_authorized, true);
sql(`update public.operational_notification_jobs set leased_until=now()-interval '1 second'
  where job_id='${ambiguousEmployeeEventJob.jobId}'::uuid;`);
const ambiguousEmployeeEventRetryLease = JSON.parse(sql(`select row_to_json(public.claim_operational_notification_job_by_key(
  ${q(ambiguousEmployeeEventJob.jobKey)},'uncertainty-event-reclaimed-worker',120))::text;`));
const ambiguousEmployeeEventClaim = JSON.parse(sql(`select public.mz_claim_employee_event_push_delivery(
  '${ambiguousEmployeeEventJob.jobId}'::uuid,'${ambiguousEmployeeEventRetryLease.lease_token}'::uuid,
  '${ambiguousEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`));
assert.equal(ambiguousEmployeeEventClaim.ok, false);
assert.equal(ambiguousEmployeeEventClaim.reason, "event_push_delivery_outcome_unknown",
  "a reclaimed event worker must never repeat an unresolved provider dispatch");
const staleEmployeeEventRecord = JSON.parse(sql(`select public.mz_record_employee_event_push_delivery(
  '${ambiguousEmployeeEventJob.jobId}'::uuid,'${ambiguousEmployeeEventJob.leaseToken}'::uuid,
  '${ambiguousEmployeeEventInstanceId}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-event-stale-worker',now())::text;`));
assert.equal(staleEmployeeEventRecord.current, false);
assert.equal(staleEmployeeEventRecord.reason, "employee_event_push_lease_superseded");
sql(`select public.finish_operational_notification_job_terminal(
  '${ambiguousEmployeeEventJob.jobId}'::uuid,'${ambiguousEmployeeEventRetryLease.lease_token}'::uuid,
  'event push delivery outcome unknown');`);
assert.equal(sql(`select status from public.operational_notification_jobs where job_id='${ambiguousEmployeeEventJob.jobId}'::uuid;`), "dead");

const nativeReceiptJobId = randomUUID();
const nativeReceiptLease = randomUUID();
const nativeReceiptJobKey = `uncertainty-native-receipt-${stamp}`;
sql(`insert into public.operational_notification_jobs(
    job_id,job_key,job_type,source_id,available_at,payload_json,status,attempts,max_attempts,
    leased_at,leased_until,lease_token,worker_id)
  select '${nativeReceiptJobId}'::uuid,${q(nativeReceiptJobKey)},'employee_native_push','${randomUUID()}'::uuid,now()-interval '1 second',
    jsonb_build_object('credential_id','${employeeCredentialId}'::uuid,'assignment_epoch',assignment_epoch,
      'employee_id','${employeeId}'::uuid,'device_id','${deviceId}'::uuid,'channel_id','employee-messages'),
    'leased',1,3,now(),now()+interval '2 minutes','${nativeReceiptLease}'::uuid,'uncertainty-native-worker'
  from public.devices where id='${deviceId}'::uuid;`);
const emptyNativeReceipt = JSON.parse(sql(`select public.mz_get_employee_native_push_delivery_receipt(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid))::text;`));
assert.equal(emptyNativeReceipt.already_recorded, false);
const preparedNativeReceipt = JSON.parse(sql(`select public.mz_prepare_employee_native_push_delivery(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`));
assert.equal(preparedNativeReceipt.dispatch_authorized, true);
assert.equal(preparedNativeReceipt.already_prepared, false);
const unresolvedNativeReceipt = JSON.parse(sql(`select public.mz_get_employee_native_push_delivery_receipt(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid))::text;`));
assert.equal(unresolvedNativeReceipt.delivery_outcome_unknown, true,
  "a prepared provider boundary must suppress a second dispatch until its exact result is recorded");
const recordNativeSql = `select public.mz_record_employee_native_push_delivery(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-native-once',now())::text;`;
const concurrentNativeRecords = (await Promise.all(Array.from({ length: 4 }, () => sqlAsync(recordNativeSql))))
  .map((value) => JSON.parse(value));
assert.ok(concurrentNativeRecords.every((result) => result.current === true && result.recorded === true),
  "concurrent duplicate provider results must all reconcile idempotently");
assert.equal(concurrentNativeRecords.filter((result) => result.already_recorded === false).length, 1,
  "one concurrent caller advances prepared to delivered and the rest replay it");
assert.equal(concurrentNativeRecords.filter((result) => result.already_recorded === true).length, 3);
const mismatchedNativeReceipt = JSON.parse(sql(`select public.mz_record_employee_native_push_delivery(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-native-duplicate',now())::text;`));
assert.equal(mismatchedNativeReceipt.current, false,
  "a receipt cannot make a different provider result look idempotent");
assert.equal(mismatchedNativeReceipt.reason, "native_push_delivery_receipt_input_mismatch");
sql(`select public.finish_operational_notification_job(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptLease}'::uuid,false,'simulated response loss after receipt commit',5);`);
sql(`update public.operational_notification_jobs set available_at=now()-interval '1 second'
  where job_id='${nativeReceiptJobId}'::uuid and status='pending';`);
const nativeReceiptRetryLease = JSON.parse(sql(`select row_to_json(public.claim_operational_notification_job_by_key(
  ${q(nativeReceiptJobKey)},'uncertainty-native-restart',120))::text;`));
const replayedNativeReceipt = JSON.parse(sql(`select public.mz_get_employee_native_push_delivery_receipt(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptRetryLease.lease_token}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid))::text;`));
assert.equal(replayedNativeReceipt.already_recorded, true,
  "worker restart after provider acceptance must reuse the durable native delivery receipt");
assert.equal(replayedNativeReceipt.provider_message_id, "provider-native-once");
assert.equal(sql(`select count(*) from public.employee_native_push_delivery_receipts where job_id='${nativeReceiptJobId}'::uuid;`), "1");
sql(`select public.finish_operational_notification_job(
  '${nativeReceiptJobId}'::uuid,'${nativeReceiptRetryLease.lease_token}'::uuid,true,null,30);`);
assert.equal(sql(`select status from public.operational_notification_jobs where job_id='${nativeReceiptJobId}'::uuid;`), "completed");

const ambiguousNativeJobId = randomUUID();
const ambiguousNativeLease = randomUUID();
const ambiguousNativeJobKey = `uncertainty-native-ambiguous-${stamp}`;
sql(`insert into public.operational_notification_jobs(
    job_id,job_key,job_type,source_id,available_at,payload_json,status,attempts,max_attempts,
    leased_at,leased_until,lease_token,worker_id)
  select '${ambiguousNativeJobId}'::uuid,${q(ambiguousNativeJobKey)},'employee_native_push','${randomUUID()}'::uuid,now()-interval '1 second',
    jsonb_build_object('credential_id','${employeeCredentialId}'::uuid,'assignment_epoch',assignment_epoch,
      'employee_id','${employeeId}'::uuid,'device_id','${deviceId}'::uuid,'channel_id','employee-messages'),
    'leased',1,3,now(),now()+interval '2 minutes','${ambiguousNativeLease}'::uuid,'uncertainty-native-stale-worker'
  from public.devices where id='${deviceId}'::uuid;`);
assert.equal(JSON.parse(sql(`select public.mz_prepare_employee_native_push_delivery(
  '${ambiguousNativeJobId}'::uuid,'${ambiguousNativeLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},now())::text;`)).dispatch_authorized, true);
sql(`update public.operational_notification_jobs set leased_until=now()-interval '1 second'
  where job_id='${ambiguousNativeJobId}'::uuid;`);
const ambiguousNativeRetryLease = JSON.parse(sql(`select row_to_json(public.claim_operational_notification_job_by_key(
  ${q(ambiguousNativeJobKey)},'uncertainty-native-reclaimed-worker',120))::text;`));
const ambiguousNativeReceipt = JSON.parse(sql(`select public.mz_get_employee_native_push_delivery_receipt(
  '${ambiguousNativeJobId}'::uuid,'${ambiguousNativeRetryLease.lease_token}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid))::text;`));
assert.equal(ambiguousNativeReceipt.delivery_outcome_unknown, true,
  "lease recovery must expose an unresolved provider boundary instead of authorizing a duplicate dispatch");
assert.equal(ambiguousNativeReceipt.reason, "native_push_delivery_outcome_unknown");
const staleNativeRecord = JSON.parse(sql(`select public.mz_record_employee_native_push_delivery(
  '${ambiguousNativeJobId}'::uuid,'${ambiguousNativeLease}'::uuid,'${employeeCredentialId}'::uuid,
  (select assignment_epoch from public.devices where id='${deviceId}'::uuid),
  '${employeeRegistrationId}'::uuid,${q(employeeTokenHashC)},'provider-stale-worker',now())::text;`));
assert.equal(staleNativeRecord.current, false);
assert.equal(staleNativeRecord.reason, "employee_native_push_lease_superseded");
sql(`select public.finish_operational_notification_job_terminal(
  '${ambiguousNativeJobId}'::uuid,'${ambiguousNativeRetryLease.lease_token}'::uuid,'native push delivery outcome unknown');`);
assert.equal(sql(`select status from public.operational_notification_jobs where job_id='${ambiguousNativeJobId}'::uuid;`), "dead");

const exhaustedJobKey = `uncertainty-exhausted-job-${stamp}`;
sql(`insert into public.operational_notification_jobs(job_key,job_type,source_id,available_at,max_attempts)
  values (${q(exhaustedJobKey)},'employee_native_push','${randomUUID()}'::uuid,now()-interval '1 second',1);`);
const exhaustedLease = JSON.parse(sql(`select row_to_json(public.claim_operational_notification_job_by_key(
  ${q(exhaustedJobKey)},'final-uncertainty-worker',120))::text;`));
const exhaustedFinish = JSON.parse(sql(`select row_to_json(public.finish_operational_notification_job(
  '${exhaustedLease.job_id}'::uuid,'${exhaustedLease.lease_token}'::uuid,false,'expected final failure',30))::text;`));
assert.equal(exhaustedFinish.status, "dead");
assert.ok(exhaustedFinish.completed_at, "a retry-exhausted dead job must carry a terminal completion timestamp");

console.log(JSON.stringify({ ok: true, stale_session_masked: false, rollback_without_quiescence_accepted: false,
  rollback_after_quiescence_ready: true, spoofed_authority_health_accepted: false,
  historical_finish_adapter_replayed: true,
  expired_event_claimed: false, stale_location_claimed: false, stale_location_recorded_sent: false,
  revoked_recipient_claimed: false, expired_recipient_recorded_sent: false, rotated_token_recorded_sent: false,
  stale_employee_token_result_recorded: false, cancelled_employee_event_claimed: false,
  cancelled_employee_event_recorded_sent: false, valid_employee_event_recorded_sent: true,
  same_lease_event_claim_cancelled: false, duplicate_event_dispatch_after_lease_expiry: false,
  concurrent_event_receipt_record_failed: false,
  native_push_replayed_after_receipt: false, duplicate_native_dispatch_after_lease_expiry: false,
  concurrent_native_receipt_record_failed: false, mismatched_native_receipt_accepted: false,
  missing_notification_authority_ignored: false,
  retry_exhausted_job_missing_completed_at: false,
  cancelled_event_recorded_sent: false, rescheduled_event_claimed: false }, null, 2));
