select *
from (
-- Memphis custodial scheduler exception contract probe.
-- Returns rows when known exception groups drift into normal daily work.
with params as (
  select
    public.sch_service_date(now())::date as start_date,
    public.sch_service_date(now())::date + 14 as end_date
), daily_rows as (
  select
    dsa.id as assignment_id,
    dsa.service_date,
    extract(dow from dsa.service_date)::integer as day_of_week,
    lg.group_code,
    lg.group_name,
    to_char(dsa.coverage_start, 'HH24:MI') as coverage_start,
    to_char(dsa.coverage_end, 'HH24:MI') as coverage_end,
    coalesce(dsa.coverage_purpose, '') as coverage_purpose,
    dsa.status,
    dsa.owner_type,
    e.display_name as assigned_employee_name,
    dsa.source_type,
    dsa.notes
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  left join public.employees e on e.id = dsa.assigned_employee_id
  cross join params p
  where dsa.service_date between p.start_date and p.end_date
), violations as (
  select
    'response_only_group_has_normal_work'::text as violation_type,
    *
  from daily_rows
  where group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    and coverage_purpose in ('deep_clean', 'area_owner', 'restroom_upkeep', 'lunch_coverage')

  union all

  select
    'gift_shop_not_monday_0800_reminder'::text as violation_type,
    *
  from daily_rows
  where (
      group_code like '%GIFT_SHOP%'
      or group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP')
    )
    and not (
      day_of_week = 1
      and coverage_purpose = 'reminder'
      and coverage_start = '08:00'
      and coverage_end <= '09:45'
    )

  union all

  select
    'herpetarium_wednesday_daily_assignment'::text as violation_type,
    *
  from daily_rows
  where group_code = 'HERPETARIUM'
    and day_of_week = 3
)
select *
from violations
order by service_date, violation_type, group_code, coverage_start
) scheduler_exception_contract;
