select *
from (
  -- SCH2 route-span readiness/audit gate.
  -- Returns rows until route_zone / route_spread audit substrate is present.
  with required_relations(object_name, object_kind) as (
    values
      ('public.schedule_work_items', 'table'),
      ('public.schedule_solution_assignments', 'table'),
      ('public.v_sch2_route_audit', 'view')
  ), expected_columns(object_name, column_name) as (
    values
      ('public.schedule_work_items', 'route_zone'),
      ('public.schedule_work_items', 'bundle_key'),
      ('public.schedule_work_items', 'location_group_id'),
      ('public.schedule_solution_assignments', 'assigned_employee_id'),
      ('public.schedule_solution_assignments', 'location_group_id'),
      ('public.schedule_solution_assignments', 'score_breakdown'),
      ('public.v_sch2_route_audit', 'run_id'),
      ('public.v_sch2_route_audit', 'employee_id'),
      ('public.v_sch2_route_audit', 'route_zone_count'),
      ('public.v_sch2_route_audit', 'route_spread_penalty'),
      ('public.v_sch2_route_audit', 'route_spread_violation'),
      ('public.v_sch2_route_audit', 'violation_type')
  ), missing_relations as (
    select
      'missing_route_audit_relation'::text as violation_type,
      rr.object_name,
      rr.object_kind,
      'SCH2 route-span audit relation is not present yet'::text as detail
    from required_relations rr
    where to_regclass(rr.object_name) is null
  ), missing_columns as (
    select
      'missing_route_audit_column'::text as violation_type,
      ec.object_name || '.' || ec.column_name as object_name,
      'column'::text as object_kind,
      'Required route-span audit column is not present yet'::text as detail
    from expected_columns ec
    where to_regclass(ec.object_name) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = split_part(ec.object_name, '.', 1)
           and c.table_name = split_part(ec.object_name, '.', 2)
           and c.column_name = ec.column_name
       )
  )
  select * from missing_relations
  union all
  select * from missing_columns
  order by violation_type, object_name
) check_sch2_route_span;
