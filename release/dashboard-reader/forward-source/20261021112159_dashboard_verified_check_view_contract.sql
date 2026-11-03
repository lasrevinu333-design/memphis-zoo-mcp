-- Exact observed predecessor -> canonical Dashboard visit-view only.
-- No Place-name, schedule publication, notification writer or admission replay.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
do $predecessor$
declare expected record;
begin
 if current_setting('custodial.deployment_project_ref',true) is distinct from 'rqquvtjdmugpigbndmne'
  or current_user<>'postgres' then raise exception 'Exact Custodial project and owner required';end if;
 if not exists(select 1 from pg_class where oid=to_regclass('public.v_location_dashboard_status')
  and relkind='v' and relowner='postgres'::regrole and reloptions is null)
  or md5(pg_get_viewdef('public.v_location_dashboard_status'::regclass,true)) is distinct from 'bab6b9acaa3aedd76b1eaf9a5eff699e' then
  raise exception 'Exact observed old Dashboard view changed';end if;
 for expected in select * from (values
  ('public.custodial_open_work()','9af0c49939e4bea29f249fdd32dd08d4'),
  ('public.custodial_operational_location_assignments(date)','c8b8d73bd90e580ab6a81a3c80e7e72d'),
  ('public.get_setting_int(text,integer)','661012346c042b10ca22e0491a495802'),
  ('public.operational_day_start(timestamptz)','5d65060220af58fb51aeeb0a23fadf66'),
  ('public.sch_service_date(timestamptz)','115a49622bc7aa7d24c1e1dfd53e585b'),
  ('public.static_weekly_v6_schedule_authority_state(date)','f8df463c359f46214c6393eae2045ccc')
 ) dependencies(signature,definition_md5) loop
  if to_regprocedure(expected.signature) is null
   or md5(pg_get_functiondef(to_regprocedure(expected.signature))) is distinct from expected.definition_md5
   or not has_function_privilege('custodial_application_reader',to_regprocedure(expected.signature),'EXECUTE') then
   raise exception 'Observed canonical view dependency changed/denied: %',expected.signature;end if;
 end loop;
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)')
  and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=pg_catalog, public']::text[] and md5(p.prosrc)='db291da01ace223486f791a646e98ff0')
  or not coalesce(has_function_privilege('custodial_application_reader',to_regprocedure('public.mz_latest_verified_check(uuid,timestamptz,timestamptz)'),'EXECUTE'),false) then
  raise exception 'Restore exact canonical verified-check reader first';end if;
 if to_regprocedure('public.custodial_release_authority_current_view_definition(text)') is null
  or (select count(*) from public.custodial_release_authority_restore_inventory where object_kind='view' and object_identity='public.v_location_dashboard_status')<>1
  or not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled in('O','A')) then
  raise exception 'Existing exact Dashboard recovery prerequisite missing';end if;
end $predecessor$;
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
create temporary table dashboard_recovery_guard_before on commit drop as
 select tgenabled::text enabled from pg_trigger
 where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
 and tgname='trg_custodial_release_authority_restore_inventory_immutable';

create temporary table dashboard_view_before on commit drop as
 select relowner,reloptions,relacl::text acl_text from pg_class where oid='public.v_location_dashboard_status'::regclass;
create or replace view public.v_location_dashboard_status as
with op_day as (
  select public.operational_day_start(now()) day_start,
    public.sch_service_date(now()) service_date
), authority as (
  select state.*
  from op_day day
  cross join lateral public.static_weekly_v6_schedule_authority_state(day.service_date) state
), scheduled_baseline as (
  select assignment.location_id,
    min((day.service_date + assignment.coverage_start) at time zone 'America/Chicago') baseline_at
  from op_day day
  join lateral public.custodial_operational_location_assignments(day.service_date) assignment on true
  group by assignment.location_id
), latest_scan as (
  select location_id,max(coalesce(scanned_at,created_at)) last_scan_at
  from public.scan_events group by location_id
), open_session as (
  -- Native Start evidence survives the 04:00 boundary until reconciled. Old
  -- sessions rows retain the established current-operational-day display rule.
  select distinct on (work.location_id)
    work.location_id,work.location_code,work.session_id,work.session_uuid,
    work.status session_status,work.started_at,work.ended_at,
    work.duration_minutes,work.duration_display,
    work.employee_name,work.device_identifier
  from public.custodial_open_work() work
  where work.source_kind<>'session'
     or work.started_at>=public.operational_day_start(now())
  order by work.location_id,work.started_at desc,work.created_at desc,work.open_work_id desc
), latest_completed as (
  select distinct on (session.location_id)
    session.location_id,session.id session_id,session.session_uuid,
    session.started_at,session.ended_at,session.duration_minutes,
    session.duration_display,employee.display_name employee_name,
    completion.submitted_at,completion.response_json,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) effective_completed_at
  from public.sessions session
  join public.employees employee on employee.id=session.employee_id
  left join public.completion_responses completion on completion.session_id=session.id
  cross join op_day day
  where session.status='closed'
    and completion.response_json->>'work_result' is distinct from 'checked_no_cleaning_needed'
    and coalesce(session.ended_at,completion.submitted_at,session.started_at)>=day.day_start
  order by session.location_id,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) desc,
    session.started_at desc
), open_tickets as (
  select location_id,count(*) open_ticket_count
  from public.maintenance_tickets where status='open' group by location_id
), truth as (
  select location.id location_id,
    coalesce(open_session.location_code,location.location_code) location_code,
    location.location_name,
    location.location_type,location.form_type,day.day_start,
    latest_scan.last_scan_at,
    open_session.session_id open_session_id,
    open_session.session_uuid open_session_uuid,
    open_session.session_status open_session_status,
    open_session.started_at open_session_started_at,
    open_session.ended_at open_session_ended_at,
    open_session.employee_name open_session_employee_name,
    open_session.device_identifier open_session_device_identifier,
    latest_completed.session_id latest_completed_session_id,
    latest_completed.session_uuid latest_completed_session_uuid,
    latest_completed.started_at latest_started_at,
    latest_completed.ended_at latest_ended_at,
    latest_completed.submitted_at latest_submitted_at,
    latest_completed.effective_completed_at latest_completed_at,
    latest_completed.employee_name latest_employee_name,
    latest_completed.duration_minutes,latest_completed.duration_display,
    latest_completed.response_json,
    coalesce(open_tickets.open_ticket_count,0::bigint) open_ticket_count,
    scheduled_baseline.baseline_at,
    public.mz_latest_verified_check(location.id,day.day_start,now()) verified_check_at,
    case when latest_completed.effective_completed_at is null then null
      else greatest(latest_completed.effective_completed_at,
        public.mz_latest_verified_check(location.id,day.day_start,now())) end due_baseline_at,
    authority.authority_source schedule_authority_source,
    authority.projection_status schedule_projection_status
  from public.locations location
  cross join op_day day
  cross join authority
  left join scheduled_baseline on scheduled_baseline.location_id=location.id
  left join latest_scan on latest_scan.location_id=location.id
  left join open_session on open_session.location_id=location.id
  left join latest_completed on latest_completed.location_id=location.id
  left join open_tickets on open_tickets.location_id=location.id
  where location.active=true
)
select location_id,location_code,location_name,location_type,form_type,
  day_start operational_day_start,last_scan_at,
  open_session_id,open_session_uuid,open_session_status,
  open_session_started_at,open_session_ended_at,
  latest_completed_session_id,latest_completed_session_uuid,
  latest_started_at,latest_ended_at,latest_submitted_at,latest_completed_at,
  latest_employee_name,duration_minutes,duration_display,
  coalesce(response_json->'services_performed',response_json->'servicesPerformed',
    response_json->'services',response_json->'completed_services',
    response_json->'completedServices','[]'::jsonb) services_performed,
  coalesce(response_json->>'notes',response_json->>'cleaning_notes',
    response_json->>'cleaningNotes',response_json->>'maintenance_notes',
    response_json->>'maintenanceNotes',response_json->>'other_service_performed',
    response_json->>'otherServicePerformed',response_json->>'note') notes,
  open_ticket_count,
  case
    when due_baseline_at is null and open_session_status in ('active','pending_submit') then 'in_progress'
    when due_baseline_at is null then 'not_cleaned'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',90)) then 'overdue'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',75)) then 'due_soon'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',210)) then 'overdue'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195)) then 'due_soon'
    when open_session_status in ('active','pending_submit') then 'in_progress'
    else 'okay'
  end status_code,
  case
    when due_baseline_at is null and open_session_status in ('active','pending_submit') then 'blue'
    when due_baseline_at is null then 'black'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',90)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',210))) then 'red'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',75)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195))) then 'yellow'
    when open_session_status in ('active','pending_submit') then 'blue'
    else 'green'
  end status_color,
  to_char(timezone('America/Chicago',day_start),'MM/DD/YYYY HH12:MI AM')||' Central' operational_day_start_display,
  to_char(timezone('America/Chicago',last_scan_at),'MM/DD/YYYY HH12:MI AM')||' Central' last_scan_at_display,
  to_char(timezone('America/Chicago',open_session_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_started_at_display,
  to_char(timezone('America/Chicago',open_session_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_ended_at_display,
  to_char(timezone('America/Chicago',latest_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_started_at_display,
  to_char(timezone('America/Chicago',latest_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_ended_at_display,
  to_char(timezone('America/Chicago',latest_submitted_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_submitted_at_display,
  to_char(timezone('America/Chicago',latest_completed_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_completed_at_display,
  open_session_employee_name,open_session_device_identifier,
  schedule_authority_source,schedule_projection_status,
  greatest(latest_completed_at,verified_check_at) as latest_checked_at
from truth;
-- CREATE OR REPLACE preserves the existing owner/options/ACL; assert it.
do $post$
begin
 if exists(select 1 from pg_class current_view cross join dashboard_view_before before
  where current_view.oid='public.v_location_dashboard_status'::regclass
   and (current_view.relowner is distinct from before.relowner or current_view.reloptions is distinct from before.reloptions
    or current_view.relacl::text is distinct from before.acl_text)) then
  raise exception 'Dashboard existing owner/options/ACL changed';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.v_location_dashboard_status'::regclass
  and attname='latest_checked_at' and atttypid='timestamptz'::regtype and not attisdropped) then
  raise exception 'Canonical latest_checked_at view contract missing';end if;
end $post$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $capture$
declare definition text;changed integer;
begin
 definition:=public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status');
 if definition is null then raise exception 'Canonical Dashboard view recovery unavailable';end if;
 update public.custodial_release_authority_restore_inventory set definition_sql=definition,
  definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
 where object_kind='view' and object_identity='public.v_location_dashboard_status';
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Expected one exact Dashboard view recovery row';end if;
end $capture$;
do $restore_guard$
begin
 if (select enabled from dashboard_recovery_guard_before)='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $restore_guard$;
commit;
