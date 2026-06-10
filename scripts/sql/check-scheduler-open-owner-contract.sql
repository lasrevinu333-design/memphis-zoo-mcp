select *
from (
-- Memphis custodial scheduler open-owner contract probe.
-- Returns rows only when normal daily assignment work is OPEN/missing an employee.
-- Intended verification window: scheduler service date through +14 days.
with params as (
  select
    public.sch_service_date(now())::date as start_date,
    public.sch_service_date(now())::date + 14 as end_date
), violations as (
  select
    dsa.id as assignment_id,
    dsa.service_date,
    lg.group_code,
    lg.group_name,
    to_char(dsa.coverage_start, 'HH24:MI') as coverage_start,
    to_char(dsa.coverage_end, 'HH24:MI') as coverage_end,
    coalesce(dsa.coverage_purpose, '') as coverage_purpose,
    dsa.status,
    dsa.owner_type,
    dsa.assigned_employee_id,
    e.display_name as assigned_employee_name,
    dsa.source_type,
    dsa.notes,
    case
      when dsa.status = 'OPEN' then 'status_open'
      when dsa.owner_type = 'OPEN' then 'owner_type_open'
      when dsa.assigned_employee_id is null then 'missing_assigned_employee_id'
      else 'unknown_open_owner'
    end as violation_reason
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  left join public.employees e on e.id = dsa.assigned_employee_id
  cross join params p
  where dsa.service_date between p.start_date and p.end_date
    and (
      dsa.status = 'OPEN'
      or dsa.owner_type = 'OPEN'
      or dsa.assigned_employee_id is null
    )
    and coalesce(dsa.coverage_purpose, '') in (
      'deep_clean',
      'area_owner',
      'restroom_upkeep',
      'late_coverage'
    )
    and lg.group_code not in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    and not (
      lg.group_code like '%GIFT_SHOP%'
      and extract(dow from dsa.service_date)::integer = 1
      and coalesce(dsa.coverage_purpose, '') = 'reminder'
      and dsa.coverage_start = time '08:00'
      and dsa.coverage_end <= time '09:45'
    )
)
select *
from violations
order by service_date, coverage_start, group_code
) scheduler_open_owner_contract;
