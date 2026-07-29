begin;

alter table public.current_attendance_state
  add constraint current_attendance_state_attendance_nonnegative check(attendance is null or attendance>=0) not valid,
  add constraint current_attendance_state_last_year_nonnegative check(last_year is null or last_year>=0) not valid,
  add constraint current_attendance_state_planned_nonnegative check(planned is null or planned>=0) not valid,
  add constraint current_attendance_state_yesterday_nonnegative check(yesterday is null or yesterday>=0) not valid,
  add constraint current_attendance_state_yesterday_plan_nonnegative check(yesterday_plan is null or yesterday_plan>=0) not valid;

alter table public.current_attendance_state validate constraint current_attendance_state_attendance_nonnegative;
alter table public.current_attendance_state validate constraint current_attendance_state_last_year_nonnegative;
alter table public.current_attendance_state validate constraint current_attendance_state_planned_nonnegative;
alter table public.current_attendance_state validate constraint current_attendance_state_yesterday_nonnegative;
alter table public.current_attendance_state validate constraint current_attendance_state_yesterday_plan_nonnegative;

alter table public.cleaning_inspections
  add constraint cleaning_inspections_rubric_nonblank check(length(btrim(rubric_version))>0) not valid,
  add constraint cleaning_inspections_failed_requires_follow_up
    check(follow_up_required or (not critical_failure and overall_score>=pass_threshold)) not valid;

alter table public.cleaning_inspections validate constraint cleaning_inspections_rubric_nonblank;
alter table public.cleaning_inspections validate constraint cleaning_inspections_failed_requires_follow_up;

create or replace function public.cleaning_inspections_set_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_session record;
  v_inspector_name text;
begin
  if tg_op='UPDATE' then
    if new.operation_id is distinct from old.operation_id then
      raise exception using errcode='23514',message='Inspection operation_id is immutable';
    end if;
    if new.session_id is distinct from old.session_id then
      raise exception using errcode='23514',message='Inspection session_id is immutable';
    end if;
  end if;

  select
    s.location_id,s.employee_id,s.started_at,s.ended_at,s.duration_minutes,s.status,
    l.location_code,l.location_name,e.display_name employee_name
  into v_session
  from public.sessions s
  join public.locations l on l.id=s.location_id
  join public.employees e on e.id=s.employee_id
  where s.id=new.session_id;

  if not found then
    raise exception using errcode='P0002',message='Cleaning session was not found';
  end if;
  if v_session.status not in ('pending_submit','closed') then
    raise exception using errcode='23514',message='Only a finished cleaning session can be inspected';
  end if;
  if new.inspected_at<coalesce(v_session.ended_at,v_session.started_at) then
    raise exception using errcode='23514',message='Inspection time cannot be before the cleaning session finished';
  end if;
  if new.inspected_at>clock_timestamp()+interval '5 minutes' then
    raise exception using errcode='23514',message='Inspection time cannot be in the future';
  end if;

  new.location_id:=v_session.location_id;
  new.employee_id:=v_session.employee_id;
  new.employee_name_snapshot:=v_session.employee_name;
  new.location_code_snapshot:=v_session.location_code;
  new.location_name_snapshot:=v_session.location_name;
  new.session_started_at:=v_session.started_at;
  new.session_ended_at:=v_session.ended_at;
  new.session_duration_minutes:=coalesce(
    v_session.duration_minutes,
    case when v_session.ended_at is not null
      then greatest(0,ceil(extract(epoch from (v_session.ended_at-v_session.started_at))/60.0)::integer)
      else null end
  );

  if new.inspector_manager_id is not null then
    select m.display_name into v_inspector_name
    from public.ops_manager_managers m
    where m.manager_id=new.inspector_manager_id
      and m.active=true and m.revoked_at is null and m.is_system_principal=false;
    if not found then
      raise exception using errcode='23503',message='Active inspector manager was not found';
    end if;
    new.inspector_name_snapshot:=v_inspector_name;
  else
    new.inspector_name_snapshot:=coalesce(nullif(btrim(new.inspector_name_snapshot),''),'Custodial Manager');
  end if;

  new.updated_at:=clock_timestamp();
  return new;
end
$function$;

revoke all on function public.cleaning_inspections_set_snapshot() from public,anon,authenticated;
grant execute on function public.cleaning_inspections_set_snapshot() to postgres,service_role;

insert into public.system_settings(setting_key,setting_value,description,updated_at)
values ('inspection_coverage_target_pct','20'::jsonb,'At least 20 percent of finished cleaning sessions in the rolling 30-day window should have a recorded quality inspection.',now())
on conflict(setting_key) do update
set setting_value=excluded.setting_value,
    description=excluded.description,
    updated_at=now();

create or replace view public.v_cleaning_inspection_coverage
with (security_invoker=true)
as
with finished as (
  select s.id,coalesce(s.ended_at,s.started_at) finished_at
  from public.sessions s
  where s.status in ('pending_submit','closed')
    and coalesce(s.ended_at,s.started_at)>=now()-interval '30 days'
), coverage as (
  select
    count(*)::integer completed_session_count,
    count(*) filter(where exists(select 1 from public.cleaning_inspections i where i.session_id=f.id))::integer inspected_session_count,
    count(*) filter(where not exists(select 1 from public.cleaning_inspections i where i.session_id=f.id))::integer uninspected_session_count,
    max(f.finished_at) latest_completed_session_at
  from finished f
), policy as (
  select coalesce((select (setting_value #>> '{}')::numeric from public.system_settings where setting_key='inspection_coverage_target_pct'),20)::numeric target_pct
)
select
  c.completed_session_count,
  c.inspected_session_count,
  c.uninspected_session_count,
  case when c.completed_session_count=0 then 0::numeric
       else round(c.inspected_session_count*100.0/c.completed_session_count,1) end inspection_coverage_pct,
  p.target_pct inspection_coverage_target_pct,
  (c.completed_session_count>0 and c.inspected_session_count*100.0/c.completed_session_count<p.target_pct) needs_attention,
  c.latest_completed_session_at,
  (select max(i.inspected_at) from public.cleaning_inspections i) latest_inspection_at,
  30::integer window_days
from coverage c cross join policy p;

revoke all on table public.v_cleaning_inspection_coverage from public,anon,authenticated;
grant select on table public.v_cleaning_inspection_coverage to postgres,service_role;

comment on view public.v_cleaning_inspection_coverage is
  'Rolling 30-day production quality-inspection coverage with an explicit operational target and attention state.';

commit;
