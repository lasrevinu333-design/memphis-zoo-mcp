with required_relations(object_name, object_kind) as (
  values
    ('public.schedule_generation_runs', 'table'),
    ('public.schedule_solution_assignments', 'table'),
    ('public.v_sch2_workload_audit', 'view')
), expected_columns(object_name, column_name) as (
  values
    ('public.schedule_generation_runs', 'hard_violation_count'),
    ('public.schedule_generation_runs', 'open_required_count'),
    ('public.schedule_generation_runs', 'score_total'),
    ('public.schedule_solution_assignments', 'assigned_employee_id'),
    ('public.schedule_solution_assignments', 'load_points'),
    ('public.schedule_solution_assignments', 'coverage_purpose'),
    ('public.schedule_solution_assignments', 'score_total'),
    ('public.v_sch2_workload_audit', 'run_id'),
    ('public.v_sch2_workload_audit', 'employee_id'),
    ('public.v_sch2_workload_audit', 'assigned_load_points'),
    ('public.v_sch2_workload_audit', 'restroom_load_points'),
    ('public.v_sch2_workload_audit', 'workload_spread'),
    ('public.v_sch2_workload_audit', 'assigned_segments'),
    ('public.v_sch2_workload_audit', 'required_location_count'),
    ('public.v_sch2_workload_audit', 'target_required_load'),
    ('public.v_sch2_workload_audit', 'target_required_location_count'),
    ('public.v_sch2_workload_audit', 'location_count_spread'),
    ('public.v_sch2_workload_audit', 'violation_type')
), missing_relations as (
  select
    'missing_workload_audit_relation'::text as violation_type,
    rr.object_name,
    rr.object_kind,
    'SCH2 workload fairness audit relation is not present yet'::text as detail
  from required_relations rr
  where to_regclass(rr.object_name) is null
), missing_columns as (
  select
    'missing_workload_audit_column'::text as violation_type,
    ec.object_name || '.' || ec.column_name as object_name,
    'column'::text as object_kind,
    'Required workload fairness audit column is not present yet'::text as detail
  from expected_columns ec
  where to_regclass(ec.object_name) is null
     or not exists (
       select 1
       from information_schema.columns c
       where c.table_schema = split_part(ec.object_name, '.', 1)
         and c.table_name = split_part(ec.object_name, '.', 2)
         and c.column_name = ec.column_name
     )
), latest_runs as (
  select
    r.id,
    r.service_date,
    r.status,
    r.hard_violation_count,
    r.open_required_count,
    r.score_total,
    r.created_at,
    row_number() over (partition by r.service_date order by r.created_at desc) as day_rank
  from public.schedule_generation_runs r
  where r.status in ('preview_ready', 'preview_blocked', 'published')
), recent_runs as (
  select lr.*
  from latest_runs lr
  where lr.day_rank = 1
  order by lr.service_date desc
  limit 14
), missing_recent_runs as (
  select
    'missing_recent_workload_audit_runs'::text as violation_type,
    'public.schedule_generation_runs'::text as object_name,
    'run'::text as object_kind,
    'No recent SCH2 preview/published run is available for daily or weekly workload fairness audit'::text as detail
  where not exists (select 1 from recent_runs)
), audit_rows as (
  select
    rr.id as run_id,
    rr.service_date,
    rr.status,
    rr.hard_violation_count,
    rr.open_required_count,
    rr.score_total,
    wa.employee_id,
    coalesce(e.display_name, wa.employee_id::text) as employee_name,
    wa.assigned_load_points,
    wa.restroom_load_points,
    wa.assigned_segments,
    wa.required_location_count,
    wa.target_required_load,
    wa.target_required_location_count,
    wa.workload_spread,
    wa.location_count_spread,
    wa.violation_type as workload_violation_type
  from recent_runs rr
  join public.v_sch2_workload_audit wa on wa.run_id = rr.id
  left join public.employees e on e.id = wa.employee_id
), run_failures as (
  select
    'sch2_run_has_hard_or_open_violations'::text as violation_type,
    rr.id::text as object_name,
    'run'::text as object_kind,
    'SCH2 run ' || rr.service_date::text || ' status=' || rr.status ||
      ' hard_violation_count=' || coalesce(rr.hard_violation_count, 0)::text ||
      ' open_required_count=' || coalesce(rr.open_required_count, 0)::text as detail
  from recent_runs rr
  where coalesce(rr.hard_violation_count, 0) > 0
     or coalesce(rr.open_required_count, 0) > 0
), workload_failures as (
  select
    coalesce(ar.workload_violation_type, 'sch2_workload_fairness_violation')::text as violation_type,
    ar.run_id::text as object_name,
    'employee'::text as object_kind,
    'SCH2 ' || ar.service_date::text || ' employee=' || ar.employee_name ||
      ' load_points=' || coalesce(ar.assigned_load_points, 0)::text ||
      ' required_locations=' || coalesce(ar.required_location_count, 0)::text ||
      ' target_required_load=' || coalesce(round(ar.target_required_load, 2), 0)::text ||
      ' target_required_location_count=' || coalesce(round(ar.target_required_location_count, 2), 0)::text ||
      ' workload_spread=' || coalesce(round(ar.workload_spread, 2), 0)::text ||
      ' location_count_spread=' || coalesce(ar.location_count_spread, 0)::text as detail
  from audit_rows ar
  where ar.workload_violation_type is not null
     or coalesce(ar.location_count_spread, 0) > 1
     or coalesce(ar.workload_spread, 0) > greatest(6, coalesce(ar.target_required_load, 0) * 0.35)
), target_failures as (
  select
    'missing_workload_fairness_target'::text as violation_type,
    ar.run_id::text as object_name,
    'employee'::text as object_kind,
    'SCH2 ' || ar.service_date::text || ' employee=' || ar.employee_name ||
      ' is missing target_required_load or target_required_location_count in workload audit'::text as detail
  from audit_rows ar
  where ar.target_required_load is null
     or ar.target_required_location_count is null
)
select * from missing_relations
union all
select * from missing_columns
union all
select * from missing_recent_runs
union all
select * from run_failures
union all
select * from workload_failures
union all
select * from target_failures
order by violation_type, object_kind, object_name;
