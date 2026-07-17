-- Deployed migration history snapshot: 20260714232148 my_schedule_current_and_full_day_contract_20260714

create or replace function public.sch_employee_my_schedule_page(
  p_service_date date,
  p_employee_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  v_base jsonb := '{}'::jsonb;
  v_all_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_employee_name text;
  v_employee_code text;
  v_shift_start time;
  v_shift_end time;
  v_roster_active boolean := false;
  v_local_time time;
  v_phase text;
  v_notice text;
  v_assignment_count integer := 0;
begin
  if p_service_date is null or p_employee_id is null then
    raise exception 'service_date and employee_id are required';
  end if;

  v_base := coalesce(
    public.sch_employee_my_schedule_phase_v1(p_service_date, p_employee_id, p_now),
    '{}'::jsonb
  );

  select e.display_name, e.employee_code
    into v_employee_name, v_employee_code
  from public.employees e
  where e.id = p_employee_id and e.active = true
  limit 1;

  if v_employee_name is null then
    raise exception 'Active employee not found';
  end if;

  select r.shift_start, r.shift_end, r.active
    into v_shift_start, v_shift_end, v_roster_active
  from public.daily_work_roster r
  where r.service_date = p_service_date
    and r.employee_id = p_employee_id
  order by r.active desc, r.updated_at desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', dsa.id,
      'service_date', dsa.service_date,
      'segment_number', dsa.segment_number,
      'location_group_id', dsa.location_group_id,
      'group_code', lg.group_code,
      'group_name', lg.group_name,
      'location_group_code', lg.group_code,
      'location_group_name', lg.group_name,
      'coverage_start', dsa.coverage_start,
      'coverage_end', dsa.coverage_end,
      'start_time', dsa.coverage_start,
      'end_time', dsa.coverage_end,
      'coverage_purpose', dsa.coverage_purpose,
      'purpose', dsa.coverage_purpose,
      'source_type', dsa.source_type,
      'owner_type', dsa.owner_type,
      'status', dsa.status,
      'load_points', dsa.load_points,
      'notes', dsa.notes
    )
    order by dsa.coverage_start, dsa.coverage_end, dsa.segment_number, lg.group_name
  ), '[]'::jsonb), count(*)::integer
    into v_all_items, v_assignment_count
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  where dsa.service_date = p_service_date
    and dsa.assigned_employee_id = p_employee_id
    and dsa.status = 'ASSIGNED';

  v_current_items := case
    when jsonb_typeof(v_base->'items') = 'array' then v_base->'items'
    else '[]'::jsonb
  end;

  v_local_time := (p_now at time zone 'America/Chicago')::time;

  if coalesce(v_roster_active, false) = false then
    v_phase := 'off_day';
    v_notice := 'You are not scheduled to work today.';
  elsif v_assignment_count = 0 then
    v_phase := 'schedule_missing';
    v_notice := 'Your shift exists, but no work assignments were generated. Contact an Ops Manager.';
  elsif v_shift_start is not null and v_local_time < v_shift_start then
    v_phase := 'before_shift';
    v_notice := format('Your full schedule is below. Your shift begins at %s.', to_char(v_shift_start, 'FMHH12:MI AM'));
  elsif v_shift_end is not null and v_local_time >= v_shift_end then
    v_phase := 'after_shift';
    v_notice := 'Your shift is complete. Today''s full schedule remains below.';
    v_current_items := '[]'::jsonb;
  elsif jsonb_array_length(v_current_items) = 0 then
    v_phase := 'between_assignments';
    v_notice := 'You are between scheduled assignments. Your complete day remains below.';
  else
    v_phase := coalesce(nullif(v_base->>'phase', ''), 'current_assignment');
    v_notice := coalesce(nullif(v_base->>'notice', ''), 'Your complete day is shown below.');
  end if;

  return v_base || jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_employee_name,
    'employee_code', v_employee_code,
    'service_date', p_service_date,
    'phase', v_phase,
    'notice', v_notice,
    'shift', case
      when v_shift_start is null or v_shift_end is null then null
      else jsonb_build_object(
        'start', to_char(v_shift_start, 'HH12:MI AM'),
        'end', case when v_shift_end = time '23:59:59' then 'Close' else to_char(v_shift_end, 'HH12:MI AM') end,
        'shift_start', v_shift_start,
        'shift_end', v_shift_end,
        'active', coalesce(v_roster_active, false)
      )
    end,
    'items', v_current_items,
    'all_items', v_all_items,
    'current_items', v_current_items,
    'assignment_count', v_assignment_count,
    'schedule_status', case
      when coalesce(v_roster_active, false) = false then 'off'
      when v_assignment_count = 0 then 'missing_assignments'
      when jsonb_array_length(v_current_items) = 0 then 'between_assignments'
      else 'scheduled'
    end,
    'contract_version', 'my_schedule.v3'
  );
end
$function$;
