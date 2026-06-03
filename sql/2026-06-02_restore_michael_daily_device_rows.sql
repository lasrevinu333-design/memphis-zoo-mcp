-- Restore Michael McWright's generated device-facing rows for the current Tuesday schedule
-- after the mistaken cleanup removed them. This does not affect the paper printout logic;
-- it only preserves My Schedule / all-locations-have-an-owner behavior.

with params as (
  select '2026-06-02'::date as service_date
), michael as (
  select id as employee_id
  from public.employees
  where display_name = 'Michael McWright'
    and employee_code = 'EMP002'
  limit 1
), template_rows as (
  select
    p.service_date,
    ct.location_group_id,
    ct.assigned_employee_id,
    ct.owner_type,
    ct.coverage_start,
    least(ct.coverage_end, public.sch_get_schedule_close_time(p.service_date)) as coverage_end,
    public.sch_group_load_points(ct.location_group_id) as load_points,
    ct.notes,
    ct.coverage_purpose,
    row_number() over (partition by ct.location_group_id order by ct.coverage_start, ct.coverage_end, ct.id)::integer as rn
  from params p
  join michael m on true
  join public.coverage_templates ct on ct.assigned_employee_id = m.employee_id
  join public.location_groups lg on lg.id = ct.location_group_id and lg.active = true
  join public.daily_work_roster dwr
    on dwr.service_date = p.service_date
   and dwr.employee_id = m.employee_id
   and dwr.active = true
  where ct.active = true
    and ct.coverage_purpose = 'late_coverage'
    and ct.day_of_week = extract(dow from p.service_date)::integer
    and ct.coverage_start < public.sch_get_schedule_close_time(p.service_date)
    and dwr.shift_start <= ct.coverage_start
    and dwr.shift_end >= least(ct.coverage_end, public.sch_get_schedule_close_time(p.service_date))
    and not exists (
      select 1
      from public.daily_schedule_assignments existing
      where existing.service_date = p.service_date
        and existing.location_group_id = ct.location_group_id
        and existing.assigned_employee_id = m.employee_id
        and existing.coverage_start = ct.coverage_start
        and existing.coverage_end = least(ct.coverage_end, public.sch_get_schedule_close_time(p.service_date))
        and existing.coverage_purpose = 'late_coverage'
    )
), max_segments as (
  select service_date, location_group_id, coalesce(max(segment_number), 0) as max_segment
  from public.daily_schedule_assignments
  where service_date = (select service_date from params)
  group by service_date, location_group_id
)
insert into public.daily_schedule_assignments (
  service_date,
  location_group_id,
  segment_number,
  assigned_employee_id,
  owner_type,
  coverage_start,
  coverage_end,
  status,
  load_points,
  notes,
  source_type,
  coverage_purpose
)
select
  tr.service_date,
  tr.location_group_id,
  coalesce(ms.max_segment, 0) + tr.rn,
  tr.assigned_employee_id,
  'EMPLOYEE',
  tr.coverage_start,
  tr.coverage_end,
  'ASSIGNED',
  tr.load_points,
  tr.notes,
  'coverage_template:restored_michael_device_late_coverage',
  tr.coverage_purpose
from template_rows tr
left join max_segments ms
  on ms.service_date = tr.service_date
 and ms.location_group_id = tr.location_group_id;
