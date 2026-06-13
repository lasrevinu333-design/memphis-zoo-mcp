with latest_monday_run as (
  select r.id as run_id, r.service_date
  from public.schedule_generation_runs r
  where extract(dow from r.service_date)::integer = 1
    and r.status in ('preview_ready', 'preview_blocked', 'published')
  order by r.created_at desc
  limit 1
), solution_rows as (
  select
    lmr.run_id,
    lmr.service_date,
    e.display_name as employee_name,
    lg.group_code,
    wi.required,
    wi.location_group_id,
    sa.assigned_employee_id
  from latest_monday_run lmr
  join public.schedule_solution_assignments sa on sa.run_id = lmr.run_id
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  join public.location_groups lg on lg.id = wi.location_group_id
  left join public.employees e on e.id = sa.assigned_employee_id
  where sa.status = 'ASSIGNED'
), employee_summary as (
  select
    sr.run_id,
    sr.service_date,
    sr.employee_name,
    count(distinct sr.location_group_id) filter (where sr.required = true)::integer as required_location_count,
    count(distinct sr.location_group_id) filter (
      where sr.required = false
        and (sr.group_code like '%GIFT_SHOP%' or sr.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP'))
    )::integer as gift_shop_reminder_count
  from solution_rows sr
  where sr.employee_name is not null
  group by sr.run_id, sr.service_date, sr.employee_name
), workload as (
  select
    wa.run_id,
    lmr.service_date,
    wa.employee_id,
    e.display_name as employee_name,
    wa.required_location_count,
    wa.target_required_location_count,
    wa.location_count_spread,
    wa.violation_type
  from latest_monday_run lmr
  join public.v_sch2_workload_audit wa on wa.run_id = lmr.run_id
  join public.employees e on e.id = wa.employee_id
)
select *
from (
  select
    'missing_monday_preview_run'::text as violation_type,
    null::date as service_date,
    'Markiesha Warren'::text as employee_name,
    'No Monday SCH2 preview run is available for workload fairness proof'::text as detail,
    null::numeric as metric_value
  where not exists (select 1 from latest_monday_run)

  union all

  select
    'monday_location_count_spread_high'::text as violation_type,
    w.service_date,
    w.employee_name,
    'Monday SCH2 preview location_count_spread is above 1; required locations are not evenly distributed'::text as detail,
    w.location_count_spread::numeric as metric_value
  from workload w
  where w.location_count_spread > 1

  union all

  select
    'markiesha_only_gift_shop'::text as violation_type,
    es.service_date,
    es.employee_name,
    'Markiesha Warren has only TRADING_POST/GIFT_SHOP reminder work and no required scan work'::text as detail,
    es.gift_shop_reminder_count::numeric as metric_value
  from employee_summary es
  where lower(trim(es.employee_name)) = 'markiesha warren'
    and es.required_location_count = 0
    and es.gift_shop_reminder_count > 0

  union all

  select
    'markiesha_under_target_required_locations'::text as violation_type,
    w.service_date,
    w.employee_name,
    'Markiesha Warren is below the Monday target_required_location_count floor'::text as detail,
    w.required_location_count::numeric as metric_value
  from workload w
  where lower(trim(w.employee_name)) = 'markiesha warren'
    and w.required_location_count < greatest(1, floor(w.target_required_location_count)::integer)
) check_sch2_monday_balanced_preview
order by violation_type, employee_name;
