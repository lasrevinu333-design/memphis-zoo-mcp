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
