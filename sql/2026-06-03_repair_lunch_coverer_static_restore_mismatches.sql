-- The code-side static owner restore overwrote lunch_coverage assigned_employee_id
-- on generated lunch rows even though the note still carried the correct "Cover: Name".
-- Put lunch rows back onto the actual coverer named by the lunch coverage planner,
-- but only when that employee exists, is active on that service date, covers the full
-- window, and is not on lunch during that window.
with parsed as (
  select dsa.id,
         dsa.service_date,
         dsa.coverage_start,
         dsa.coverage_end,
         dsa.notes,
         dsa.assigned_employee_id as current_coverer_id,
         trim((regexp_match(coalesce(dsa.notes,''), 'Cover: ([^.]+)\.'))[1]) as note_coverer
  from public.daily_schedule_assignments dsa
  where dsa.service_date between '2026-06-03'::date and '2026-06-17'::date
    and dsa.coverage_purpose = 'lunch_coverage'
    and dsa.status = 'ASSIGNED'
    and dsa.notes ~ 'Cover: '
), eligible as (
  select p.id, e.id as note_coverer_id
  from parsed p
  join public.employees e on e.display_name = p.note_coverer and e.active = true
  join public.daily_work_roster dwr
    on dwr.service_date = p.service_date
   and dwr.employee_id = e.id
   and dwr.active = true
   and dwr.shift_start <= p.coverage_start
   and dwr.shift_end >= p.coverage_end
  left join lateral public.sch_lunch_window_for_employee(p.service_date, e.id) lw on true
  where p.current_coverer_id <> e.id
    and not (lw.lunch_start is not null and lw.lunch_start < p.coverage_end and lw.lunch_end > p.coverage_start)
)
update public.daily_schedule_assignments dsa
   set assigned_employee_id = eligible.note_coverer_id,
       owner_type = 'EMPLOYEE',
       status = 'ASSIGNED',
       source_type = regexp_replace(coalesce(dsa.source_type, ''), ':?static_owner_restored', '', 'g'),
       notes = btrim(replace(coalesce(dsa.notes, ''), ' | Static owner restored because owner is working and not absent.', '')),
       updated_at = now()
  from eligible
 where dsa.id = eligible.id;
