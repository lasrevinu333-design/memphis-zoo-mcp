-- Refresh SCH2 workload audit view shape after the dynamic-load scheduler fix.
--
-- Why this exists: the original additive SCH2 migration used CREATE OR REPLACE
-- VIEW, but production already had the older seven-column view. PostgreSQL does
-- not allow CREATE OR REPLACE VIEW to rename/reorder existing columns, so the
-- older workload audit view survived while the scheduler function was updated.
-- Drop/recreate is safe here because the dependency check shows no external
-- objects depend on the view beyond its own rewrite/type entries.

drop view if exists public.v_sch2_workload_audit;

create view public.v_sch2_workload_audit as
with regular_roster as (
  select
    r.id as run_id,
    dwr.employee_id
  from public.schedule_generation_runs r
  join public.daily_work_roster dwr
    on dwr.service_date = r.service_date
   and dwr.active = true
  join public.employees e
    on e.id = dwr.employee_id
   and e.active = true
  left join public.daily_absence_overrides dao
    on dao.absence_date = r.service_date
   and dao.employee_id = dwr.employee_id
   and dao.active = true
  where dao.id is null
    and coalesce(e.employee_code, '') <> 'EMP002'
), employee_counts as (
  select run_id, count(distinct employee_id)::numeric as regular_employee_count
  from regular_roster
  group by run_id
), work_totals as (
  select
    run_id,
    coalesce(sum(load_points) filter (where required = true), 0)::numeric as total_required_load,
    count(distinct location_group_id) filter (where required = true)::numeric as total_required_locations
  from public.schedule_work_items
  group by run_id
), targets as (
  select
    wt.run_id,
    coalesce(wt.total_required_load / nullif(ec.regular_employee_count, 0), 0)::numeric as target_required_load,
    coalesce(wt.total_required_locations / nullif(ec.regular_employee_count, 0), 0)::numeric as target_required_location_count
  from work_totals wt
  left join employee_counts ec on ec.run_id = wt.run_id
), employee_load as (
  select
    rr.run_id,
    rr.employee_id,
    coalesce(sum(coalesce(sa.load_points, 0)) filter (where sa.status = 'ASSIGNED' and wi.required = true), 0)::numeric as assigned_load_points,
    coalesce(sum(case when wi.is_public_restroom then coalesce(sa.load_points, 0) else 0 end) filter (where sa.status = 'ASSIGNED' and wi.required = true), 0)::numeric as restroom_load_points,
    count(sa.id) filter (where sa.status = 'ASSIGNED' and wi.required = true)::integer as assigned_segments,
    count(distinct sa.location_group_id) filter (where sa.status = 'ASSIGNED' and wi.required = true)::integer as required_location_count
  from regular_roster rr
  left join public.schedule_solution_assignments sa
    on sa.run_id = rr.run_id
   and sa.assigned_employee_id = rr.employee_id
   and sa.coverage_purpose not in ('reminder', 'response_only', 'late_coverage')
  left join public.schedule_work_items wi on wi.id = sa.work_item_id
  group by rr.run_id, rr.employee_id
), spread as (
  select
    el.*,
    t.target_required_load,
    t.target_required_location_count,
    (max(el.assigned_load_points) over (partition by el.run_id) - min(el.assigned_load_points) over (partition by el.run_id))::numeric as workload_spread,
    (max(el.required_location_count) over (partition by el.run_id) - min(el.required_location_count) over (partition by el.run_id))::integer as location_count_spread
  from employee_load el
  left join targets t on t.run_id = el.run_id
)
select
  run_id,
  employee_id,
  assigned_load_points,
  restroom_load_points,
  workload_spread,
  assigned_segments,
  required_location_count,
  target_required_load,
  target_required_location_count,
  location_count_spread,
  case
    when location_count_spread > 1 then 'location_count_spread_high'
    when workload_spread > greatest(6, coalesce(target_required_load, 0) * 0.35) then 'workload_spread_high'
    else null::text
  end as violation_type
from spread;

grant all on public.v_sch2_workload_audit to anon, authenticated, service_role;
