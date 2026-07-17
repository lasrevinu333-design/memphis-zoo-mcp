-- Deployed migration history snapshot: 20260515145151 demo_mock_v4_assigned_locations_view

create or replace view public.v_demo_scan_mock_today_assigned_locations as
select distinct on (dsa.service_date, l.id, dsa.assigned_employee_id, dsa.coverage_start, dsa.coverage_end)
  dsa.service_date,
  dsa.coverage_start,
  dsa.coverage_end,
  dsa.coverage_purpose,
  lg.group_name,
  l.id as location_id,
  l.location_code,
  l.location_name,
  l.form_type,
  coalesce(l.sort_order, 999999) as sort_order,
  e.id as employee_id,
  e.display_name as employee_name
from public.daily_schedule_assignments dsa
join public.location_groups lg
  on lg.id = dsa.location_group_id
 and lg.active = true
join public.location_group_memberships lgm
  on lgm.location_group_id = dsa.location_group_id
 and lgm.active = true
join public.locations l
  on l.id = lgm.location_id
 and l.active = true
join public.employees e
  on e.id = dsa.assigned_employee_id
 and e.active = true
where dsa.status = 'ASSIGNED'
  and dsa.assigned_employee_id is not null
  and l.form_type in ('restroom', 'exhibit')
order by dsa.service_date, l.id, dsa.assigned_employee_id, dsa.coverage_start, dsa.coverage_end,
  case dsa.coverage_purpose
    when 'area_owner' then 0
    when 'deep_clean' then 1
    when 'restroom_upkeep' then 2
    when 'late_coverage' then 3
    else 4
  end;
