-- Deployed migration history snapshot: 20260714220206 markiesha_shift_0800_1700_20260714

do $do$
declare
  v_employee_id uuid;
  v_shift_note text := 'Shift updated 2026-07-14: 8:00 AM-5:00 PM.';
begin
  select e.id into v_employee_id
  from public.employees e
  where e.employee_code = 'EMP008'
    and e.display_name = 'Markiesha Warren'
    and e.active = true
  limit 1;

  if v_employee_id is null then
    raise exception 'Active employee EMP008 Markiesha Warren was not found';
  end if;

  update public.employee_shift_templates est
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when position(v_shift_note in coalesce(est.notes, '')) > 0 then est.notes
        when nullif(btrim(est.notes), '') is null then v_shift_note
        else est.notes || ' | ' || v_shift_note
      end,
      updated_at = now()
  where est.employee_id = v_employee_id
    and est.active = true;

  update public.daily_work_roster dwr
  set shift_start = time '08:00',
      shift_end = time '17:00',
      notes = case
        when position(v_shift_note in coalesce(dwr.notes, '')) > 0 then dwr.notes
        when nullif(btrim(dwr.notes), '') is null then v_shift_note
        else dwr.notes || ' | ' || v_shift_note
      end,
      updated_at = now()
  where dwr.employee_id = v_employee_id
    and dwr.service_date = date '2026-07-14';

  update public.daily_schedule_assignments dsa
  set coverage_end = time '17:00',
      notes = case
        when position('Capped to Markiesha 5:00 PM shift end.' in coalesce(dsa.notes, '')) > 0 then dsa.notes
        when nullif(btrim(dsa.notes), '') is null then 'Capped to Markiesha 5:00 PM shift end.'
        else dsa.notes || ' | Capped to Markiesha 5:00 PM shift end.'
      end,
      updated_at = now()
  where dsa.assigned_employee_id = v_employee_id
    and dsa.service_date = date '2026-07-14'
    and dsa.coverage_end > time '17:00';
end
$do$;
