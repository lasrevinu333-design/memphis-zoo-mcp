-- Foundation repair v1: canonical phone identity support, deterministic schedule
-- readiness, rolling schedule generation, lifecycle cleanup, and migration-log
-- compaction. Application source and this migration share the same release ID.

-- Preserve historical OPEN schedule rows without leaving them in the live table.
create table if not exists public.schedule_assignment_archive (
  archive_id uuid primary key default gen_random_uuid(),
  assignment_id uuid null,
  service_date date null,
  assignment_json jsonb not null,
  archive_reason text not null,
  archived_at timestamptz not null default now()
);
alter table public.schedule_assignment_archive enable row level security;
alter table public.schedule_assignment_archive force row level security;
revoke all on table public.schedule_assignment_archive from public, anon, authenticated;
grant select, insert on table public.schedule_assignment_archive to service_role, postgres;

insert into public.schedule_assignment_archive (
  assignment_id, service_date, assignment_json, archive_reason
)
select dsa.id, dsa.service_date, to_jsonb(dsa), 'historical_open_assignment_cleanup_20260716'
from public.daily_schedule_assignments dsa
where dsa.service_date < current_date
  and dsa.status = 'OPEN'
  and not exists (
    select 1
    from public.schedule_assignment_archive a
    where a.assignment_id = dsa.id
  );

delete from public.daily_schedule_assignments
where service_date < current_date
  and status = 'OPEN';

-- Expired PTO is historical evidence, not an active absence. Deactivate exact
-- duplicate ranges first, then all ranges that ended before today.
with ranked as (
  select id,
         row_number() over (
           partition by employee_id, start_date, end_date
           order by updated_at desc nulls last, created_at desc nulls last, id
         ) as row_rank
  from public.employee_planned_time_off
  where active = true
)
update public.employee_planned_time_off p
set active = false,
    notes = trim(concat_ws(' | ', nullif(p.notes, ''), 'Deactivated duplicate PTO during foundation repair.')),
    updated_at = now()
from ranked r
where p.id = r.id
  and r.row_rank > 1;

update public.employee_planned_time_off
set active = false,
    notes = trim(concat_ws(' | ', nullif(notes, ''), 'Archived after PTO end date during foundation repair.')),
    updated_at = now()
where active = true
  and end_date < current_date;

-- Preserve the detailed audit body under a stable helper name, then place a
-- readiness-aware wrapper at the public function name used by the application.
do $block$
begin
  if to_regprocedure('public.sch_audit_schedule_day_detail(date)') is null then
    alter function public.sch_audit_schedule_day(date) rename to sch_audit_schedule_day_detail;
  end if;
end
$block$;

create or replace function public.sch_audit_schedule_day(
  p_service_date date default public.sch_service_date(now())
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_date date := coalesce(p_service_date, public.sch_service_date(now()));
  v_detail jsonb := public.sch_audit_schedule_day_detail(v_date);
  v_roster_count integer := coalesce((v_detail #>> '{counts,active_roster_rows}')::integer, 0);
  v_assignment_count integer := coalesce((v_detail #>> '{counts,assignments_total}')::integer, 0);
  v_open_count integer := coalesce((v_detail #>> '{counts,assignments_open}')::integer, 0);
  v_expected_template_count integer := 0;
  v_schedule_expected boolean := false;
  v_readiness_ok boolean := false;
  v_issue_free boolean := false;
  v_readiness_status text;
begin
  select count(*)::integer
    into v_expected_template_count
  from public.employee_shift_templates est
  join public.employees e on e.id = est.employee_id
  where est.active = true
    and e.active = true
    and est.day_of_week = extract(dow from v_date)::integer;

  v_schedule_expected := v_expected_template_count > 0
    or v_roster_count > 0
    or v_assignment_count > 0;

  v_readiness_status := case
    when not v_schedule_expected then 'not_expected'
    when v_roster_count = 0 then 'missing_roster'
    when v_assignment_count = 0 then 'missing_assignments'
    when v_open_count > 0 then 'open_assignments'
    else 'ready'
  end;

  v_readiness_ok := (not v_schedule_expected)
    or (v_roster_count > 0 and v_assignment_count > 0 and v_open_count = 0);

  v_issue_free := jsonb_array_length(coalesce(v_detail->'assigned_while_absent', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'pto_without_absence_override', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'working_without_assignments', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'assigned_outside_active_roster', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'open_segments', '[]'::jsonb)) = 0;

  return v_detail || jsonb_build_object(
    'ok', v_readiness_ok and v_issue_free,
    'readiness_status', v_readiness_status,
    'schedule_expected', v_schedule_expected,
    'expected_template_count', v_expected_template_count,
    'readiness_ok', v_readiness_ok,
    'issue_free', v_issue_free,
    'readiness_issues', case
      when v_readiness_status = 'ready' or v_readiness_status = 'not_expected' then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'code', v_readiness_status,
        'message', format('Schedule readiness failed for %s: roster=%s assignments=%s open=%s', v_date, v_roster_count, v_assignment_count, v_open_count)
      ))
    end
  );
end
$function$;

revoke all on function public.sch_audit_schedule_day(date) from public, anon, authenticated;
grant execute on function public.sch_audit_schedule_day(date) to service_role, postgres;

-- One canonical rolling window generator replaces a current-day-only cron and
-- removes the need for GET requests to mutate schedule state.
create or replace function public.sch_ensure_schedule_window(
  p_start_date date default public.sch_service_date(now()),
  p_days integer default 14,
  p_reason text default 'scheduled_rolling_window_readiness'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_start date := coalesce(p_start_date, public.sch_service_date(now()));
  v_days integer := greatest(1, least(coalesce(p_days, 14), 31));
  v_offset integer;
  v_date date;
  v_result jsonb;
  v_audit jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ready integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('schedule-window:' || v_start::text || ':' || v_days::text, 0));

  for v_offset in 0..(v_days - 1) loop
    v_date := v_start + v_offset;
    begin
      v_result := public.sch_ensure_daily_schedule(
        v_date,
        coalesce(nullif(btrim(p_reason), ''), 'scheduled_rolling_window_readiness')
      );
      v_audit := public.sch_audit_schedule_day(v_date);
      if coalesce((v_audit->>'ok')::boolean, false) then
        v_ready := v_ready + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', true,
          'result', v_result,
          'audit', v_audit
        ));
      else
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', false,
          'error', 'schedule_audit_failed',
          'result', v_result,
          'audit', v_audit
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'service_date', v_date,
        'ok', false,
        'error', sqlerrm
      ));
    end;
