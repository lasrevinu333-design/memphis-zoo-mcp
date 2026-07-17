-- Deployed migration history snapshot: 20260714201504 update_markiesha_shift_8_to_5_20260714

do $do$
declare
  v_employee_id uuid;
  v_template_count integer;
  v_roster_count integer;
  v_coverage_count integer;
  v_assignment_count integer;
begin
  select e.id into v_employee_id
  from public.employees e
  where e.display_name = 'Markiesha Warren' and e.active = true
  limit 1;

  if v_employee_id is null then
    raise exception 'Active employee Markiesha Warren was not found';
  end if;

  update public.employee_shift_templates est
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when coalesce(est.notes, '') like '%Shift updated 2026-07-14: 8:00 AM-5:00 PM.%' then est.notes
        else concat_ws(' | ', nullif(est.notes, ''), 'Shift updated 2026-07-14: 8:00 AM-5:00 PM.')
      end,
      updated_at = now()
  where est.employee_id = v_employee_id
    and est.active = true;
  get diagnostics v_template_count = row_count;

  if v_template_count <> 5 then
    raise exception 'Expected 5 active Markiesha shift templates, updated %', v_template_count;
  end if;

  update public.daily_work_roster r
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when coalesce(r.notes, '') like '%Shift updated 2026-07-14: 8:00 AM-5:00 PM.%' then r.notes
        else concat_ws(' | ', nullif(r.notes, ''), 'Shift updated 2026-07-14: 8:00 AM-5:00 PM.')
      end,
      updated_at = now()
  where r.employee_id = v_employee_id
    and r.service_date >= public.sch_service_date(now());
  get diagnostics v_roster_count = row_count;

  update public.coverage_templates ct
  set coverage_end = time '17:00',
      notes = case
        when coalesce(ct.notes, '') like '%Capped to Markiesha 5:00 PM shift end.%' then ct.notes
        else concat_ws(' | ', nullif(ct.notes, ''), 'Capped to Markiesha 5:00 PM shift end.')
      end,
      updated_at = now()
  where ct.assigned_employee_id = v_employee_id
    and ct.active = true
    and ct.coverage_end > time '17:00';
  get diagnostics v_coverage_count = row_count;

  update public.daily_schedule_assignments dsa
  set coverage_end = time '17:00',
      notes = case
        when coalesce(dsa.notes, '') like '%Capped to Markiesha 5:00 PM shift end.%' then dsa.notes
        else concat_ws(' | ', nullif(dsa.notes, ''), 'Capped to Markiesha 5:00 PM shift end.')
      end,
      updated_at = now()
  where dsa.assigned_employee_id = v_employee_id
    and dsa.service_date >= public.sch_service_date(now())
    and dsa.coverage_end > time '17:00';
  get diagnostics v_assignment_count = row_count;

  insert into public.system_logs(level, source, message, created_at)
  values (
    'INFO',
    'schedule_configuration',
    format(
      'Markiesha Warren shift updated to 08:00-17:00. Templates=%s, rosters=%s, coverage templates capped=%s, generated assignments capped=%s.',
      v_template_count, v_roster_count, v_coverage_count, v_assignment_count
    ),
    now()
  );
end
$do$;
