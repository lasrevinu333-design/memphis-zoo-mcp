-- Daily-assignment-backed employee My Schedule page.
-- Keeps /my-day-summary and /my-schedule aligned with generated/repaired daily rows.
create or replace function public.sch_employee_my_schedule_page(
  p_service_date date,
  p_employee_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_local_time time := timezone('America/Chicago', p_as_of)::time;
  v_cutover time := time '09:45';
  v_employee record;
  v_shift record;
  v_has_945_change boolean := false;
  v_items jsonb := '[]'::jsonb;
  v_future_notice text := null;
begin
  select id, display_name, employee_code, role
    into v_employee
  from public.employees
  where id = p_employee_id
    and active = true;

  if v_employee.id is null then
    return jsonb_build_object('ok', false, 'error', 'Employee not found or inactive');
  end if;

  select shift_start, shift_end
    into v_shift
  from public.daily_work_roster
  where service_date = p_service_date
    and employee_id = p_employee_id
    and active = true
  order by shift_start
  limit 1;

  select exists (
    select 1
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.source_type, '') like '%restroom_rebalance_0945%'
  ) into v_has_945_change;

  if v_has_945_change and v_local_time < v_cutover then
    v_future_notice := 'Your restroom ownership changes at 9:45 AM. Check My Schedule then for the updated restroom list.';
  end if;

  with source_rows as (
    select
      dsa.coverage_start,
      dsa.coverage_end,
      coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(lg.id) as is_public_restroom,
      (coalesce(dsa.coverage_purpose, '') = 'reminder') as is_schedule_only_reminder
    from public.daily_schedule_assignments dsa
    join public.location_groups lg on lg.id = dsa.location_group_id
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, 'area_owner') in (
        'deep_clean',
        'reminder',
        'area_owner',
        'restroom_upkeep',
        'lunch_coverage',
        'late_coverage'
      )
      and (
        (
          coalesce(dsa.coverage_purpose, '') in ('deep_clean', 'reminder', 'area_owner', 'restroom_upkeep')
          and (
            (v_local_time < v_cutover and dsa.coverage_start < v_cutover)
            or
            (v_local_time >= v_cutover and dsa.coverage_end > v_local_time)
          )
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'lunch_coverage'
          and dsa.coverage_end > v_local_time
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'late_coverage'
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
      )
  ), dedup as (
    select distinct on (group_code, coverage_purpose)
      group_code,
      group_name,
      coverage_purpose,
      is_public_restroom,
      is_schedule_only_reminder,
      min(coverage_start) over (partition by group_code, coverage_purpose) as first_start,
      max(coverage_end) over (partition by group_code, coverage_purpose) as last_end
    from source_rows
    order by group_code, coverage_purpose, coverage_start
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', group_name,
      'group_code', group_code,
      'coverage_purpose', coverage_purpose,
      'coverage_start', to_char(first_start, 'HH12:MI AM'),
      'coverage_end', case when last_end = time '23:59:59' then 'Close' else to_char(last_end, 'HH12:MI AM') end,
      'is_public_restroom', is_public_restroom,
      'is_schedule_only_reminder', is_schedule_only_reminder
    )
    order by
      case coverage_purpose
        when 'lunch_coverage' then 2
        when 'late_coverage' then 3
        else 1
      end,
      case when is_public_restroom then 0 else 1 end,
      group_name
  ), '[]'::jsonb)
  into v_items
  from dedup;

  return jsonb_build_object(
    'ok', true,
    'service_date', p_service_date,
    'as_of_time', to_char(v_local_time, 'HH12:MI AM'),
    'phase', case when v_local_time < v_cutover then 'morning' else 'current' end,
    'employee', jsonb_build_object(
      'employee_id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'role', v_employee.role
    ),
    'shift', case when v_shift.shift_start is null then null else jsonb_build_object(
      'start', to_char(v_shift.shift_start, 'HH12:MI AM'),
      'end', case when v_shift.shift_end = time '23:59:59' then 'Close' else to_char(v_shift.shift_end, 'HH12:MI AM') end
    ) end,
    'has_945_change', v_has_945_change,
    'notice', v_future_notice,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;
