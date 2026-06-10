select *
from (
-- Memphis custodial My Schedule source-of-truth contract probe.
-- Returns rows only when sch_employee_my_schedule_page leaks non-owned daily rows
-- or fails to show daily-assignment-backed rows that should be visible at the probe time.
with params as (
  select
    public.sch_service_date(now())::date as service_date,
    (public.sch_service_date(now())::date + time '10:00') at time zone 'America/Chicago' as morning_as_of,
    (public.sch_service_date(now())::date + time '16:00') at time zone 'America/Chicago' as afternoon_as_of
), employee_pages as (
  select
    e.id as employee_id,
    e.display_name as employee_name,
    e.employee_code,
    public.sch_employee_my_schedule_page(p.service_date, e.id, p.morning_as_of) as morning_data,
    public.sch_employee_my_schedule_page(p.service_date, e.id, p.afternoon_as_of) as afternoon_data
  from public.employees e
  cross join params p
  where e.active = true
    and exists (
      select 1
      from public.daily_work_roster r
      where r.service_date = p.service_date
        and r.employee_id = e.id
        and r.active = true
    )
), morning_expected as (
  select distinct
    dsa.service_date,
    dsa.assigned_employee_id as employee_id,
    e.display_name as employee_name,
    lg.group_code,
    lg.group_name,
    coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  join public.employees e on e.id = dsa.assigned_employee_id
  cross join params p
  where dsa.service_date = p.service_date
    and dsa.status = 'ASSIGNED'
    and dsa.assigned_employee_id is not null
    and coalesce(dsa.coverage_purpose, 'area_owner') in (
      'deep_clean',
      'reminder',
      'area_owner',
      'restroom_upkeep',
      'lunch_coverage'
    )
    and dsa.coverage_end > time '10:00'
), morning_missing as (
  select
    'my_schedule_missing_owned_morning_item'::text as violation_type,
    exp.service_date,
    exp.employee_id,
    exp.employee_name,
    exp.group_code,
    exp.group_name,
    exp.coverage_purpose,
    'Owned daily assignment is absent from sch_employee_my_schedule_page(..., 10:00).'::text as detail
  from morning_expected exp
  join employee_pages page on page.employee_id = exp.employee_id
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(page.morning_data->'items', '[]'::jsonb)) item
    where item->>'group_code' = exp.group_code
      and coalesce(item->>'coverage_purpose', 'area_owner') = exp.coverage_purpose
  )
), morning_leaked as (
  select
    'my_schedule_leaked_unowned_morning_item'::text as violation_type,
    p.service_date,
    page.employee_id,
    page.employee_name,
    item->>'group_code' as group_code,
    item->>'name' as group_name,
    coalesce(item->>'coverage_purpose', 'area_owner') as coverage_purpose,
    'sch_employee_my_schedule_page(..., 10:00) returned an item without a matching owned daily assignment.'::text as detail
  from employee_pages page
  cross join params p
  cross join lateral jsonb_array_elements(coalesce(page.morning_data->'items', '[]'::jsonb)) item
  where not exists (
    select 1
    from public.daily_schedule_assignments dsa
    join public.location_groups lg on lg.id = dsa.location_group_id
    where dsa.service_date = p.service_date
      and dsa.assigned_employee_id = page.employee_id
      and dsa.status = 'ASSIGNED'
      and lg.group_code = item->>'group_code'
      and coalesce(dsa.coverage_purpose, 'area_owner') = coalesce(item->>'coverage_purpose', 'area_owner')
      and coalesce(dsa.coverage_purpose, 'area_owner') in (
        'deep_clean',
        'reminder',
        'area_owner',
        'restroom_upkeep',
        'lunch_coverage'
      )
      and dsa.coverage_end > time '10:00'
  )
), michael_late_expected as (
  select distinct
    dsa.service_date,
    dsa.assigned_employee_id as employee_id,
    e.display_name as employee_name,
    lg.group_code,
    lg.group_name,
    coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  join public.employees e on e.id = dsa.assigned_employee_id
  cross join params p
  where dsa.service_date = p.service_date
    and dsa.status = 'ASSIGNED'
    and dsa.assigned_employee_id is not null
    and (e.employee_code = 'EMP002' or e.display_name ilike 'Michael McWright')
    and coalesce(dsa.coverage_purpose, 'area_owner') = 'late_coverage'
    and dsa.coverage_start <= time '16:00'
    and dsa.coverage_end > time '16:00'
), michael_late_missing as (
  select
    'my_schedule_missing_michael_late_coverage'::text as violation_type,
    exp.service_date,
    exp.employee_id,
    exp.employee_name,
    exp.group_code,
    exp.group_name,
    exp.coverage_purpose,
    'Michael has active daily late_coverage at 16:00, but My Schedule did not return it.'::text as detail
  from michael_late_expected exp
  join employee_pages page on page.employee_id = exp.employee_id
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(page.afternoon_data->'items', '[]'::jsonb)) item
    where item->>'group_code' = exp.group_code
      and coalesce(item->>'coverage_purpose', 'area_owner') = 'late_coverage'
  )
), normal_staff_late_leak as (
  select
    'my_schedule_normal_staff_late_coverage_leak'::text as violation_type,
    p.service_date,
    page.employee_id,
    page.employee_name,
    item->>'group_code' as group_code,
    item->>'name' as group_name,
    coalesce(item->>'coverage_purpose', 'area_owner') as coverage_purpose,
    'Non-Michael employee received late_coverage without a matching owned daily assignment.'::text as detail
  from employee_pages page
  cross join params p
  cross join lateral jsonb_array_elements(coalesce(page.afternoon_data->'items', '[]'::jsonb)) item
  where page.employee_code <> 'EMP002'
    and coalesce(item->>'coverage_purpose', 'area_owner') = 'late_coverage'
    and not exists (
      select 1
      from public.daily_schedule_assignments dsa
      join public.location_groups lg on lg.id = dsa.location_group_id
      where dsa.service_date = p.service_date
        and dsa.assigned_employee_id = page.employee_id
        and dsa.status = 'ASSIGNED'
        and lg.group_code = item->>'group_code'
        and coalesce(dsa.coverage_purpose, 'area_owner') = 'late_coverage'
        and dsa.coverage_start <= time '16:00'
        and dsa.coverage_end > time '16:00'
    )
)
select * from morning_missing
union all
select * from morning_leaked
union all
select * from michael_late_missing
union all
select * from normal_staff_late_leak
order by service_date, violation_type, employee_name, group_code
) my_schedule_source_contract;
