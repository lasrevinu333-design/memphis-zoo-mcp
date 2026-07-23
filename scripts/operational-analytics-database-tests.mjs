#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.OPERATIONAL_ANALYTICS_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.OPERATIONAL_ANALYTICS_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container) || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("A disposable schema-rebuild database is required.");
}

async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
async function json(statement) {
  const output = await sql(`select (${statement})::text;`);
  return JSON.parse(output.split("\n").at(-1));
}

const locationId = "00000000-0000-4000-8000-00000000a101";
const employeeFastId = "00000000-0000-4000-8000-00000000a102";
const employeeSlowId = "00000000-0000-4000-8000-00000000a103";
const deviceFastId = "00000000-0000-4000-8000-00000000a104";
const deviceSlowId = "00000000-0000-4000-8000-00000000a105";
const sessionFastId = "00000000-0000-4000-8000-00000000a106";
const sessionSlowId = "00000000-0000-4000-8000-00000000a107";
const completionFastId = "00000000-0000-4000-8000-00000000a108";
const completionSlowId = "00000000-0000-4000-8000-00000000a109";
const inspectionFastId = "00000000-0000-4000-8000-00000000a110";
const inspectionSlowId = "00000000-0000-4000-8000-00000000a111";
const msgUserId = "00000000-0000-4000-8000-00000000a112";
const msgThreadId = "00000000-0000-4000-8000-00000000a113";
const oldMessageId = "00000000-0000-4000-8000-00000000a114";
const recentMessageId = "00000000-0000-4000-8000-00000000a115";
const oldEventId = "00000000-0000-4000-8000-00000000a116";
const recentEventId = "00000000-0000-4000-8000-00000000a117";

const policy = await json(`(
  select jsonb_object_agg(setting_key,setting_value)
  from public.system_settings
  where setting_key in (
    'retention_event_days','retention_message_days','retention_scan_history_days',
    'retention_maintenance_closed_days','retention_operational_history_mode'
  )
)`);
assert.equal(policy.retention_event_days, 14);
assert.equal(policy.retention_message_days, 14);
assert.equal(policy.retention_scan_history_days, 3650);
assert.equal(policy.retention_maintenance_closed_days, 3650);
assert.equal(policy.retention_operational_history_mode, "preserve");

assert.equal(await sql(`select count(*) from pg_trigger where tgrelid='public.events_app_events'::regclass and tgname='trg_events_app_delete_retention_guard' and not tgisinternal;`), "1");
assert.equal(await sql(`select count(*) from cron.job where jobname='mz-events-expired-retention-hourly' and active=true;`), "1");
assert.equal(await sql(`select count(*) from information_schema.tables where table_schema='public' and table_name='cleaning_inspections';`), "1");
for (const view of ["v_cleaning_session_facts", "v_cleaning_performance_comparison", "v_maintenance_ticket_trends"]) {
  assert.equal(await sql(`select count(*) from information_schema.views where table_schema='public' and table_name='${view}';`), "1", `${view} must exist`);
}

await sql(`
  insert into public.locations(id,location_code,location_name,location_type,form_type,active)
  values ('${locationId}'::uuid,'ANALYTICS_TETON','Analytics Teton','exhibit','exhibit',true);

  insert into public.employees(id,employee_code,display_name,active,role,notes)
  values
    ('${employeeFastId}'::uuid,'EMP990101','Analytics Tammy',true,'staff','retention analytics acceptance'),
    ('${employeeSlowId}'::uuid,'EMP990102','Analytics Sherita',true,'staff','retention analytics acceptance');

  insert into public.devices(id,device_id,device_name,active,assigned_employee_id)
  values
    ('${deviceFastId}'::uuid,'ANALYTICS_DEVICE_FAST','Analytics Fast Device',true,'${employeeFastId}'::uuid),
    ('${deviceSlowId}'::uuid,'ANALYTICS_DEVICE_SLOW','Analytics Slow Device',true,'${employeeSlowId}'::uuid);

  insert into public.sessions(
    id,session_uuid,client_session_id,location_id,employee_id,device_id,status,
    started_at,ended_at,duration_minutes,duration_display,completion_source
  ) values
    ('${sessionFastId}'::uuid,'analytics-fast-session','analytics-fast-session','${locationId}'::uuid,'${employeeFastId}'::uuid,'${deviceFastId}'::uuid,'closed',now()-interval '45 minutes',now(),45,'45 min','kiosk_form'),
    ('${sessionSlowId}'::uuid,'analytics-slow-session','analytics-slow-session','${locationId}'::uuid,'${employeeSlowId}'::uuid,'${deviceSlowId}'::uuid,'closed',now()-interval '90 minutes',now(),90,'90 min','kiosk_form');

  insert into public.completion_responses(
    id,session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id
  ) values
    ('${completionFastId}'::uuid,'${sessionFastId}'::uuid,'${locationId}'::uuid,'${employeeFastId}'::uuid,'${deviceFastId}'::uuid,
      '{"form_type":"exhibit","services_performed":["Full cleaning services"],"note":"Inspection-ready"}'::jsonb,'analytics-fast-completion'),
    ('${completionSlowId}'::uuid,'${sessionSlowId}'::uuid,'${locationId}'::uuid,'${employeeSlowId}'::uuid,'${deviceSlowId}'::uuid,
      '{"form_type":"exhibit","services_performed":["Full cleaning services"],"note":"Inspection-ready"}'::jsonb,'analytics-slow-completion');

  insert into public.cleaning_inspections(
    id,operation_id,request_fingerprint,session_id,inspector_name_snapshot,
    inspection_type,rubric_version,overall_score,appearance_score,sanitation_score,
    supplies_score,detail_score,safety_score,pass_threshold,critical_failure,
    follow_up_required,findings_json,notes
  ) values
    ('${inspectionFastId}'::uuid,'10000000-0000-4000-8000-00000000a110'::uuid,'${"a".repeat(64)}','${sessionFastId}'::uuid,'Database Inspector',
      'manager_spot_check','custodial-v1',96,98,96,94,96,98,85,false,false,'[]'::jsonb,'Looks excellent.'),
    ('${inspectionSlowId}'::uuid,'10000000-0000-4000-8000-00000000a111'::uuid,'${"b".repeat(64)}','${sessionSlowId}'::uuid,'Database Inspector',
      'manager_spot_check','custodial-v1',72,75,70,78,65,74,85,false,true,'[{"category":"detail","note":"Edges and fixtures need work"}]'::jsonb,'Needs improvement.');

  insert into public.maintenance_tickets(
    completion_response_id,session_id,location_id,reported_by_employee_id,device_id,
    issue_source,status,issue_summary,issue_category,fixture_type,fixture_identifier,
    out_of_order,issue_payload,location_code_snapshot,location_name_snapshot,
    reporter_name_snapshot,reported_at,closed_at,closed_by,close_notes,closed_via
  )
  select
    '${completionSlowId}'::uuid,'${sessionSlowId}'::uuid,'${locationId}'::uuid,'${employeeSlowId}'::uuid,'${deviceSlowId}'::uuid,
    'completion_form','closed','Stall 2 toilet not flushing','Toilet not flushing properly','toilet','Stall 2',
    false,jsonb_build_object('analytics_acceptance',true,'occurrence',ordinality),'ANALYTICS_TETON','Analytics Teton',
    'Analytics Sherita',now()-make_interval(days=>ordinality-1),now()-make_interval(days=>ordinality-1)+interval '2 hours',
    'Database Inspector','Resolved for acceptance','manager'
  from generate_series(1,3) with ordinality as occurrence(value,ordinality);

  insert into public.msg_users(id,employee_id,display_name,role,is_active,active,messaging_identity_key)
  values ('${msgUserId}'::uuid,'${employeeFastId}'::uuid,'Analytics Tammy','employee',true,true,'analytics-tammy');
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active,client_thread_id)
  values ('${msgThreadId}'::uuid,'direct','Analytics Retention Thread','${msgUserId}'::uuid,true,'analytics-retention-thread');
  insert into public.msg_thread_participants(thread_id,user_id) values ('${msgThreadId}'::uuid,'${msgUserId}'::uuid);
  insert into public.msg_messages(
    id,thread_id,sender_user_id,message_type,body,metadata_json,sent_at,created_at,is_deleted,
    client_message_id,updated_at,deleted_at,deleted_by_user_id,purge_after
  ) values
    ('${oldMessageId}'::uuid,'${msgThreadId}'::uuid,'${msgUserId}'::uuid,'text','[deleted]','{}'::jsonb,now()-interval '15 days',now()-interval '15 days',true,
      'analytics-old-deleted-message',now()-interval '15 days',now()-interval '15 days','${msgUserId}'::uuid,now()-interval '1 day'),
    ('${recentMessageId}'::uuid,'${msgThreadId}'::uuid,'${msgUserId}'::uuid,'text','[deleted]','{}'::jsonb,now()-interval '13 days',now()-interval '13 days',true,
      'analytics-recent-deleted-message',now()-interval '13 days',now()-interval '13 days','${msgUserId}'::uuid,now()+interval '1 day');
`);

const comparison = await json(`(
  select jsonb_agg(to_jsonb(v) order by employee_name)
  from public.v_cleaning_performance_comparison v
  where location_id='${locationId}'::uuid
)`);
assert.equal(comparison.length, 2);
const sherita = comparison.find((row) => row.employee_name === "Analytics Sherita");
const tammy = comparison.find((row) => row.employee_name === "Analytics Tammy");
assert.equal(Number(tammy.average_duration_minutes), 45);
assert.equal(Number(tammy.average_inspection_score), 96);
assert.equal(Number(tammy.inspection_pass_rate_pct), 100);
assert.equal(Number(sherita.average_duration_minutes), 90);
assert.equal(Number(sherita.average_inspection_score), 72);
assert.equal(Number(sherita.inspection_pass_rate_pct), 0);
assert.equal(Number(tammy.location_average_duration_minutes), 67.5);
assert.equal(Number(tammy.duration_delta_from_location_minutes), -22.5);
assert.equal(Number(sherita.duration_delta_from_location_minutes), 22.5);
assert.equal(Number(tammy.location_average_inspection_score), 84);
assert.equal(Number(tammy.inspection_score_delta_from_location), 12);
assert.equal(Number(sherita.inspection_score_delta_from_location), -12);

const ticketTrend = await json(`(
  select to_jsonb(v)
  from public.v_maintenance_ticket_trends v
  where location_id='${locationId}'::uuid
    and issue_category_key='toilet not flushing properly'
    and fixture_identifier_key='stall 2'
)`);
assert.equal(ticketTrend.total_ticket_count, 3);
assert.equal(ticketTrend.ticket_count_last_7_days, 3);
assert.equal(ticketTrend.ticket_count_last_30_days, 3);
assert.equal(ticketTrend.recurrence_status, "hotspot");
assert.equal(ticketTrend.fixture_identifier, "Stall 2");

const venue = (await sql(`select ev.id::text||'|'||ev.location_group_id::text||'|'||replace(ev.display_name,'|',' ') from public.event_venues ev where ev.active=true and ev.eligible_event_venue=true and ev.location_group_id is not null order by ev.display_name limit 1;`)).split("|");
assert.equal(venue.length, 3, "eligible event venue fixture is required");
const [venueId, venueGroupId, venueName] = venue;

await sql(`
  insert into public.events_app_events(
    id,event_name,location_group_id,event_date,end_date,start_time,end_time,created_by,
    event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,
    staffing_area_ids,operation_id,status
  ) values
    ('${oldEventId}'::uuid,'Expired Analytics Event','${venueGroupId}'::uuid,
      (now() at time zone 'America/Chicago')::date-15,(now() at time zone 'America/Chicago')::date-15,time '10:00',time '11:00','database-test',
      'SINGLE_VENUE','${venueId}'::uuid,array['${venueId}'::uuid],'${venueName.replaceAll("'", "''")}',array[]::uuid[],array[]::uuid[],'${oldEventId}'::uuid,'SCHEDULED'),
    ('${recentEventId}'::uuid,'Protected Analytics Event','${venueGroupId}'::uuid,
      (now() at time zone 'America/Chicago')::date-13,(now() at time zone 'America/Chicago')::date-13,time '10:00',time '11:00','database-test',
      'SINGLE_VENUE','${venueId}'::uuid,array['${venueId}'::uuid],'${venueName.replaceAll("'", "''")}',array[]::uuid[],array[]::uuid[],'${recentEventId}'::uuid,'SCHEDULED');
  insert into public.events_app_event_history(event_id,action,actor,reason,new_record)
  values
    ('${oldEventId}'::uuid,'create','database-test','expired event acceptance',jsonb_build_object('id','${oldEventId}')),
    ('${recentEventId}'::uuid,'create','database-test','protected event acceptance',jsonb_build_object('id','${recentEventId}'));
`);

await sql(`delete from public.events_app_events where id in ('${oldEventId}'::uuid,'${recentEventId}'::uuid);`);
assert.equal(await sql(`select count(*) from public.events_app_events where id='${oldEventId}'::uuid;`), "0", "15-day-old event should be physically deleted");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${oldEventId}'::uuid;`), "0", "expired event history should leave with the event");
assert.equal(await sql(`select count(*) from public.events_app_events where id='${recentEventId}'::uuid;`), "1", "13-day-old event must be protected from a broad legacy delete");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${recentEventId}'::uuid;`), "1");

await sql(`update public.events_app_events set event_date=(now() at time zone 'America/Chicago')::date-14,end_date=(now() at time zone 'America/Chicago')::date-14 where id='${recentEventId}'::uuid;`);
const eventPurge = await json(`public.events_app_purge_expired(now(),500)`);
assert.equal(eventPurge.retention_days, 14);
assert.equal(eventPurge.deleted_events, 1);
assert.equal(await sql(`select count(*) from public.events_app_events where id='${recentEventId}'::uuid;`), "0");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${recentEventId}'::uuid;`), "0");

const messagePurge = await json(`public.msg_purge_deleted_content(now(),1000)`);
assert.equal(messagePurge.retention_days, 14);
assert.equal(await sql(`select count(*) from public.msg_messages where id='${oldMessageId}'::uuid;`), "0", "expired deleted message should be physically removed");
assert.equal(await sql(`select count(*) from public.msg_message_audit where message_id='${oldMessageId}'::uuid;`), "0", "deleted-message audit should be removed with expired deleted content");
assert.equal(await sql(`select count(*) from public.msg_messages where id='${recentMessageId}'::uuid;`), "1", "recent deleted message must remain during its review window");

assert.equal(await sql(`select count(*) from public.sessions where id in ('${sessionFastId}'::uuid,'${sessionSlowId}'::uuid);`), "2", "event/message purge must not touch cleaning history");
assert.equal(await sql(`select count(*) from public.completion_responses where id in ('${completionFastId}'::uuid,'${completionSlowId}'::uuid);`), "2");
assert.equal(await sql(`select count(*) from public.cleaning_inspections where id in ('${inspectionFastId}'::uuid,'${inspectionSlowId}'::uuid);`), "2");
assert.equal(await sql(`select count(*) from public.maintenance_tickets where location_id='${locationId}'::uuid;`), "3", "ticket history must remain available for recurrence analysis");

console.log("OPERATIONAL_ANALYTICS_DATABASE_PASS");
