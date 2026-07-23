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
  const command = `set timezone='America/Chicago';\n${statement}`;
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", command,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "";
}
async function json(statement) {
  return JSON.parse(await sql(`select (${statement})::text;`));
}

const ids = {
  location: "00000000-0000-4000-8000-00000000a101",
  fastEmployee: "00000000-0000-4000-8000-00000000a102",
  slowEmployee: "00000000-0000-4000-8000-00000000a103",
  fastDevice: "00000000-0000-4000-8000-00000000a104",
  slowDevice: "00000000-0000-4000-8000-00000000a105",
  fastSession: "00000000-0000-4000-8000-00000000a106",
  slowSession: "00000000-0000-4000-8000-00000000a107",
  fastCompletion: "00000000-0000-4000-8000-00000000a108",
  slowCompletion: "00000000-0000-4000-8000-00000000a109",
  fastInspection: "00000000-0000-4000-8000-00000000a110",
  slowInspection: "00000000-0000-4000-8000-00000000a111",
  thread: "00000000-0000-4000-8000-00000000a113",
  oldMessage: "00000000-0000-4000-8000-00000000a114",
  recentMessage: "00000000-0000-4000-8000-00000000a115",
  oldEvent: "00000000-0000-4000-8000-00000000a116",
  recentEvent: "00000000-0000-4000-8000-00000000a117",
};

const policy = await json(`(
  select jsonb_object_agg(setting_key,setting_value)
  from public.system_settings
  where setting_key in (
    'retention_event_days','retention_message_days','retention_scan_history_days',
    'retention_maintenance_closed_days','retention_operational_history_mode'
  )
)`);
assert.deepEqual(policy, {
  retention_event_days: 14,
  retention_message_days: 14,
  retention_scan_history_days: 3650,
  retention_maintenance_closed_days: 3650,
  retention_operational_history_mode: "preserve",
});
assert.equal(await sql(`select count(*) from pg_trigger where tgrelid='public.events_app_events'::regclass and tgname='trg_events_app_delete_retention_guard' and not tgisinternal;`), "1");
assert.equal(await sql(`select count(*) from cron.job where jobname='mz-events-expired-retention-hourly' and active=true;`), "1");
assert.equal(await sql(`select confdeltype from pg_constraint where conrelid='public.events_app_event_history'::regclass and conname='events_app_event_history_event_id_fkey';`), "r");
for (const objectName of ["cleaning_inspections", "v_cleaning_session_facts", "v_cleaning_performance_comparison", "v_maintenance_ticket_trends"]) {
  assert.equal(await sql(`select (to_regclass('public.${objectName}') is not null)::text;`), "true", `${objectName} must exist`);
}

assert.equal(
  await sql(`
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('cleaning_inspections_set_snapshot','events_app_delete_retention_guard')
      and (
        has_function_privilege('public',p.oid,'EXECUTE')
        or has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
      );
  `),
  "0",
  "trigger-only security-definer functions must not be exposed as RPCs",
);
assert.equal(
  await sql(`
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('cleaning_inspections_set_snapshot','events_app_delete_retention_guard')
      and has_function_privilege('service_role',p.oid,'EXECUTE');
  `),
  "2",
  "service_role must retain trigger helper execution",
);
assert.equal(
  await sql(`
    select coalesce(array_to_string(p.proconfig,','),'')
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='mz_retention_setting_int'
      and pg_get_function_identity_arguments(p.oid)='p_key text, p_default integer, p_min integer, p_max integer';
  `),
  "search_path=pg_catalog, public",
  "retention setting helper must use a fixed search path",
);

await sql(`
  insert into public.locations(id,location_code,location_name,location_type,form_type,active)
  values ('${ids.location}','ANALYTICS_TETON','Analytics Teton','exhibit','exhibit',true);
  insert into public.employees(id,employee_code,display_name,active,role,notes) values
    ('${ids.fastEmployee}','EMP990101','Analytics Tammy',true,'staff','analytics acceptance'),
    ('${ids.slowEmployee}','EMP990102','Analytics Sherita',true,'staff','analytics acceptance');
  insert into public.devices(id,device_id,device_name,active,assigned_employee_id) values
    ('${ids.fastDevice}','ANALYTICS_DEVICE_FAST','Analytics Fast Device',true,'${ids.fastEmployee}'),
    ('${ids.slowDevice}','ANALYTICS_DEVICE_SLOW','Analytics Slow Device',true,'${ids.slowEmployee}');
  insert into public.sessions(
    id,session_uuid,client_session_id,location_id,employee_id,device_id,status,
    started_at,ended_at,duration_minutes,duration_display,completion_source
  ) values
    ('${ids.fastSession}','analytics-fast-session','analytics-fast-session','${ids.location}','${ids.fastEmployee}','${ids.fastDevice}','closed',now()-interval '45 minutes',now(),45,'45 min','kiosk_form'),
    ('${ids.slowSession}','analytics-slow-session','analytics-slow-session','${ids.location}','${ids.slowEmployee}','${ids.slowDevice}','closed',now()-interval '90 minutes',now(),90,'90 min','kiosk_form');
  insert into public.completion_responses(
    id,session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id
  ) values
    ('${ids.fastCompletion}','${ids.fastSession}','${ids.location}','${ids.fastEmployee}','${ids.fastDevice}',
      '{"form_type":"exhibit","services_performed":["Full cleaning services"],"note":"Inspection-ready"}','analytics-fast-completion'),
    ('${ids.slowCompletion}','${ids.slowSession}','${ids.location}','${ids.slowEmployee}','${ids.slowDevice}',
      '{"form_type":"exhibit","services_performed":["Full cleaning services"],"note":"Inspection-ready"}','analytics-slow-completion');
  insert into public.cleaning_inspections(
    id,operation_id,request_fingerprint,session_id,inspector_name_snapshot,
    inspection_type,rubric_version,overall_score,appearance_score,sanitation_score,
    supplies_score,detail_score,safety_score,pass_threshold,critical_failure,
    follow_up_required,findings_json,notes
  ) values
    ('${ids.fastInspection}','10000000-0000-4000-8000-00000000a110','${"a".repeat(64)}','${ids.fastSession}','Database Inspector',
      'manager_spot_check','custodial-v1',96,98,96,94,96,98,85,false,false,'[]','Looks excellent.'),
    ('${ids.slowInspection}','10000000-0000-4000-8000-00000000a111','${"b".repeat(64)}','${ids.slowSession}','Database Inspector',
      'manager_spot_check','custodial-v1',72,75,70,78,65,74,85,false,true,'[{"category":"detail","note":"Edges and fixtures need work"}]','Needs improvement.');
  insert into public.maintenance_tickets(
    completion_response_id,session_id,location_id,reported_by_employee_id,device_id,
    issue_source,status,issue_summary,issue_category,fixture_type,fixture_identifier,
    out_of_order,issue_payload,location_code_snapshot,location_name_snapshot,
    reporter_name_snapshot,reported_at,closed_at,closed_by,close_notes,closed_via
  )
  select '${ids.slowCompletion}','${ids.slowSession}','${ids.location}','${ids.slowEmployee}','${ids.slowDevice}',
    'completion_form','closed','Stall 2 toilet not flushing','Toilet not flushing properly','toilet','Stall 2',
    false,jsonb_build_object('analytics_acceptance',true,'occurrence',ordinality),'ANALYTICS_TETON','Analytics Teton',
    'Analytics Sherita',now()-((ordinality-1)::integer*interval '1 day'),now()-((ordinality-1)::integer*interval '1 day')+interval '2 hours',
    'Database Inspector','Resolved for acceptance','manager'
  from generate_series(1,3) with ordinality as occurrence(value,ordinality);
`);

const comparison = await json(`(
  select jsonb_agg(to_jsonb(v) order by employee_name)
  from public.v_cleaning_performance_comparison v
  where location_id='${ids.location}'
)`);
assert.equal(comparison.length, 2);
const tammy = comparison.find((row) => row.employee_name === "Analytics Tammy");
const sherita = comparison.find((row) => row.employee_name === "Analytics Sherita");
assert.deepEqual({
  duration: Number(tammy.average_duration_minutes),
  score: Number(tammy.average_inspection_score),
  passRate: Number(tammy.inspection_pass_rate_pct),
  durationDelta: Number(tammy.duration_delta_from_location_minutes),
  scoreDelta: Number(tammy.inspection_score_delta_from_location),
}, { duration: 45, score: 96, passRate: 100, durationDelta: -22.5, scoreDelta: 12 });
assert.deepEqual({
  duration: Number(sherita.average_duration_minutes),
  score: Number(sherita.average_inspection_score),
  passRate: Number(sherita.inspection_pass_rate_pct),
  durationDelta: Number(sherita.duration_delta_from_location_minutes),
  scoreDelta: Number(sherita.inspection_score_delta_from_location),
}, { duration: 90, score: 72, passRate: 0, durationDelta: 22.5, scoreDelta: -12 });
assert.equal(Number(tammy.location_average_duration_minutes), 67.5);
assert.equal(Number(tammy.location_average_inspection_score), 84);

const ticketTrend = await json(`(
  select to_jsonb(v) from public.v_maintenance_ticket_trends v
  where location_id='${ids.location}'
    and issue_category_key='toilet not flushing properly'
    and fixture_identifier_key='stall 2'
)`);
assert.deepEqual({
  total: ticketTrend.total_ticket_count,
  week: ticketTrend.ticket_count_last_7_days,
  month: ticketTrend.ticket_count_last_30_days,
  status: ticketTrend.recurrence_status,
  fixture: ticketTrend.fixture_identifier,
}, { total: 3, week: 3, month: 3, status: "hotspot", fixture: "Stall 2" });

const msgUserId = await sql(`select id::text from public.msg_users where is_active=true order by created_at,id limit 1;`);
assert.match(msgUserId, /^[0-9a-f-]{36}$/i, "a canonical Messenger identity is required");
await sql(`
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active,client_thread_id)
  values ('${ids.thread}','direct','Analytics Retention Thread','${msgUserId}',true,'analytics-retention-thread');
  insert into public.msg_thread_participants(thread_id,user_id) values ('${ids.thread}','${msgUserId}');
  insert into public.msg_messages(
    id,thread_id,sender_user_id,message_type,body,metadata_json,sent_at,created_at,is_deleted,
    client_message_id,updated_at,deleted_at,deleted_by_user_id,purge_after
  ) values
    ('${ids.oldMessage}','${ids.thread}','${msgUserId}','text','[deleted]','{}',now()-interval '15 days',now()-interval '15 days',true,
      'analytics-old-deleted-message',now()-interval '15 days',now()-interval '15 days','${msgUserId}',now()-interval '1 day'),
    ('${ids.recentMessage}','${ids.thread}','${msgUserId}','text','[deleted]','{}',now()-interval '13 days',now()-interval '13 days',true,
      'analytics-recent-deleted-message',now()-interval '13 days',now()-interval '13 days','${msgUserId}',now()+interval '1 day');
`);

const venue = (await sql(`
  select ev.id::text||'|'||ev.location_group_id::text||'|'||replace(ev.display_name,'|',' ')
  from public.event_venues ev
  where ev.active=true and ev.eligible_event_venue=true and ev.location_group_id is not null
  order by ev.display_name limit 1;
`)).split("|");
assert.equal(venue.length, 3, "eligible event venue fixture is required");
const [venueId, venueGroupId, venueName] = venue;
await sql(`
  insert into public.events_app_events(
    id,event_name,location_group_id,event_date,end_date,start_time,end_time,created_by,
    event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,
    staffing_area_ids,operation_id,status
  ) values
    ('${ids.oldEvent}','Expired Analytics Event','${venueGroupId}',current_date-15,current_date-15,'10:00','11:00','database-test',
      'SINGLE_VENUE','${venueId}',array['${venueId}'::uuid],'${venueName.replaceAll("'", "''")}',array[]::uuid[],array[]::uuid[],'${ids.oldEvent}','SCHEDULED'),
    ('${ids.recentEvent}','Protected Analytics Event','${venueGroupId}',current_date-13,current_date-13,'10:00','11:00','database-test',
      'SINGLE_VENUE','${venueId}',array['${venueId}'::uuid],'${venueName.replaceAll("'", "''")}',array[]::uuid[],array[]::uuid[],'${ids.recentEvent}','SCHEDULED');
  insert into public.events_app_event_history(event_id,action,actor,reason,new_record) values
    ('${ids.oldEvent}','create','database-test','expired event acceptance',jsonb_build_object('id','${ids.oldEvent}')),
    ('${ids.recentEvent}','create','database-test','protected event acceptance',jsonb_build_object('id','${ids.recentEvent}'));
  delete from public.events_app_events where id in ('${ids.oldEvent}','${ids.recentEvent}');
`);
assert.equal(await sql(`select count(*) from public.events_app_events where id='${ids.oldEvent}';`), "0");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${ids.oldEvent}';`), "0");
assert.equal(await sql(`select count(*) from public.events_app_events where id='${ids.recentEvent}';`), "1");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${ids.recentEvent}';`), "1");

await sql(`update public.events_app_events set event_date=current_date-14,end_date=current_date-14 where id='${ids.recentEvent}';`);
const eventPurge = await json(`public.events_app_purge_expired(now(),500)`);
assert.equal(eventPurge.retention_days, 14);
assert.equal(eventPurge.deleted_events, 1);
assert.equal(await sql(`select count(*) from public.events_app_events where id='${ids.recentEvent}';`), "0");
assert.equal(await sql(`select count(*) from public.events_app_event_history where event_id='${ids.recentEvent}';`), "0");

const messagePurge = await json(`public.msg_purge_deleted_content(now(),1000)`);
assert.equal(messagePurge.retention_days, 14);
assert.equal(await sql(`select count(*) from public.msg_messages where id='${ids.oldMessage}';`), "0");
assert.equal(await sql(`select count(*) from public.msg_message_audit where message_id='${ids.oldMessage}';`), "0");
assert.equal(await sql(`select count(*) from public.msg_messages where id='${ids.recentMessage}';`), "1");

assert.equal(await sql(`select count(*) from public.sessions where id in ('${ids.fastSession}','${ids.slowSession}');`), "2");
assert.equal(await sql(`select count(*) from public.completion_responses where id in ('${ids.fastCompletion}','${ids.slowCompletion}');`), "2");
assert.equal(await sql(`select count(*) from public.cleaning_inspections where id in ('${ids.fastInspection}','${ids.slowInspection}');`), "2");
assert.equal(await sql(`select count(*) from public.maintenance_tickets where location_id='${ids.location}';`), "3");

console.log("OPERATIONAL_ANALYTICS_DATABASE_PASS");
