-- Memphis missing-assignments report
-- Edit the params CTE, then run the whole file in Supabase SQL.
-- Purpose:
--   1) find rostered employees with zero assigned schedule rows
--   2) surface same-day open schedule rows
--   3) catch assigned employees who are outside the active roster

with params as (
  select
    '2026-05-31'::date as start_date,
    '2026-06-07'::date as end_date
),
active_absences as (
  select
    absence_date as service_date,
    employee_id,
    absence_type,
    notes as absence_notes
  from public.daily_absence_overrides
  where active = true
    and absence_date between (select start_date from params) and (select end_date from params)
),
roster as (
  select
    r.service_date,
    r.employee_id,
    e.employee_code,
    e.display_name as employee_name,
    r.shift_start,
    r.shift_end,
    r.notes as roster_notes,
    a.absence_type,
    a.absence_notes
  from public.daily_work_roster r
  join public.employees e
    on e.id = r.employee_id
  left join active_absences a
    on a.service_date = r.service_date
   and a.employee_id = r.employee_id
  where r.active = true
    and r.service_date between (select start_date from params) and (select end_date from params)
),
assignment_load as (
  select
    service_date,
    assigned_employee_id as employee_id,
    count(*) filter (where status = 'ASSIGNED') as assigned_rows,
    round(sum(coalesce(load_points, 0)) filter (where status = 'ASSIGNED')::numeric, 2) as assigned_load,
    string_agg(distinct coverage_purpose, ', ' order by coverage_purpose)
      filter (where status = 'ASSIGNED' and coverage_purpose is not null) as coverage_purposes
  from public.daily_schedule_assignments
  where service_date between (select start_date from params) and (select end_date from params)
    and assigned_employee_id is not null
  group by service_date, assigned_employee_id
),
open_slots as (
  select
    service_date,
    count(*) filter (where status = 'OPEN') as open_rows,
    round(sum(coalesce(load_points, 0)) filter (where status = 'OPEN')::numeric, 2) as open_load
  from public.daily_schedule_assignments
  where service_date between (select start_date from params) and (select end_date from params)
  group by service_date
),
rostered_without_assignments as (
  select
    r.service_date,
    r.employee_code,
    r.employee_name,
    r.shift_start,
    r.shift_end,
    r.roster_notes,
    r.absence_type,
    r.absence_notes,
    coalesce(al.assigned_rows, 0) as assigned_rows,
    coalesce(al.assigned_load, 0) as assigned_load,
    al.coverage_purposes,
    coalesce(os.open_rows, 0) as day_open_rows,
    coalesce(os.open_load, 0) as day_open_load,
    case
      when r.absence_type is not null then 'ABSENT_ON_OVERRIDE'
      when coalesce(al.assigned_rows, 0) = 0 then 'MISSING_ASSIGNMENTS'
      else 'OK'
    end as status
  from roster r
  left join assignment_load al
    on al.service_date = r.service_date
   and al.employee_id = r.employee_id
  left join open_slots os
    on os.service_date = r.service_date
  where r.absence_type is not null
     or coalesce(al.assigned_rows, 0) = 0
),
assigned_outside_active_roster as (
  select
    dsa.service_date,
    e.employee_code,
    e.display_name as employee_name,
    count(*) filter (where dsa.status = 'ASSIGNED') as assigned_rows,
    round(sum(coalesce(dsa.load_points, 0)) filter (where dsa.status = 'ASSIGNED')::numeric, 2) as assigned_load,
    string_agg(distinct dsa.coverage_purpose, ', ' order by dsa.coverage_purpose)
      filter (where dsa.status = 'ASSIGNED' and dsa.coverage_purpose is not null) as coverage_purposes,
    'ASSIGNED_OUTSIDE_ACTIVE_ROSTER' as status
  from public.daily_schedule_assignments dsa
  join public.employees e
    on e.id = dsa.assigned_employee_id
  left join public.daily_work_roster r
    on r.service_date = dsa.service_date
   and r.employee_id = dsa.assigned_employee_id
   and r.active = true
  where dsa.service_date between (select start_date from params) and (select end_date from params)
    and dsa.status = 'ASSIGNED'
    and dsa.assigned_employee_id is not null
    and r.id is null
  group by dsa.service_date, e.employee_code, e.display_name
)

-- Detail report: missing roster coverage, absences, and out-of-roster assignments.
select
  'rostered_without_assignments' as report_section,
  service_date,
  employee_code,
  employee_name,
  shift_start,
  shift_end,
  assigned_rows,
  assigned_load,
  coverage_purposes,
  day_open_rows,
  day_open_load,
  status,
  roster_notes,
  absence_type,
  absence_notes
from rostered_without_assignments

union all

select
  'assigned_outside_active_roster' as report_section,
  service_date,
  employee_code,
  employee_name,
  null::time as shift_start,
  null::time as shift_end,
  assigned_rows,
  assigned_load,
  coverage_purposes,
  null::bigint as day_open_rows,
  null::numeric as day_open_load,
  status,
  null::text as roster_notes,
  null::text as absence_type,
  null::text as absence_notes
from assigned_outside_active_roster
order by service_date, report_section, employee_name;

-- Optional daily rollup: uncomment when you want a compact manager summary.
-- select
--   d.service_date,
--   count(*) filter (where d.report_section = 'rostered_without_assignments' and d.status = 'MISSING_ASSIGNMENTS') as missing_rostered_workers,
--   count(*) filter (where d.report_section = 'rostered_without_assignments' and d.status = 'ABSENT_ON_OVERRIDE') as absent_rostered_workers,
--   count(*) filter (where d.report_section = 'assigned_outside_active_roster') as outside_roster_workers
-- from (
--   select 'rostered_without_assignments' as report_section, service_date, status from rostered_without_assignments
--   union all
--   select 'assigned_outside_active_roster' as report_section, service_date, status from assigned_outside_active_roster
-- ) d
-- group by d.service_date
-- order by d.service_date;
