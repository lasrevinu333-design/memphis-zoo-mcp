-- Michael McWright is afternoon/evening call coverage for the whole zoo, not a normal
-- named-location schedule owner. Keep his shift template active, but deactivate the
-- old expanded late_coverage location templates and remove generated future/today
-- late_coverage rows from the standard daily schedule.

with michael as (
  select id
  from public.employees
  where display_name = 'Michael McWright'
    and employee_code = 'EMP002'
  limit 1
), deactivated_templates as (
  update public.coverage_templates ct
     set active = false,
         notes = trim(concat_ws(' ', nullif(ct.notes, ''), 'Deactivated 2026-06-02: Michael is evening whole-zoo call coverage; named evening tasks will move to Evening Shift page/task list.')),
         updated_at = now()
    from michael m
   where ct.assigned_employee_id = m.id
     and ct.coverage_purpose = 'late_coverage'
     and ct.active = true
  returning ct.id
), removed_daily as (
  delete from public.daily_schedule_assignments dsa
  using michael m
  where dsa.assigned_employee_id = m.id
    and dsa.coverage_purpose = 'late_coverage'
    and dsa.service_date >= current_date
  returning dsa.id
)
select
  (select count(*) from deactivated_templates) as deactivated_late_coverage_templates,
  (select count(*) from removed_daily) as removed_daily_late_coverage_rows;
