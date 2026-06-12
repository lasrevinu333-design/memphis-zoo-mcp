select *
from (
  -- SCH2 09:45 restroom rebalance readiness/audit gate.
  -- Returns rows until restroom-specific audit labels prove Michael/EMP002 and lunch_coverage protections.
  with required_relations(object_name, object_kind) as (
    values
      ('public.schedule_solution_assignments', 'table'),
      ('public.v_sch2_constraint_violations', 'view')
  ), expected_columns(object_name, column_name) as (
    values
      ('public.schedule_solution_assignments', 'coverage_purpose'),
      ('public.schedule_solution_assignments', 'coverage_start'),
      ('public.schedule_solution_assignments', 'coverage_end'),
      ('public.schedule_solution_assignments', 'assigned_employee_id'),
      ('public.schedule_solution_assignments', 'source_type'),
      ('public.v_sch2_constraint_violations', 'run_id'),
      ('public.v_sch2_constraint_violations', 'violation_type'),
      ('public.v_sch2_constraint_violations', 'severity'),
      ('public.v_sch2_constraint_violations', 'detail')
  ), view_defs as (
    select coalesce(pg_get_viewdef(to_regclass('public.v_sch2_constraint_violations'), true), '') as definition
  ), missing_relations as (
    select
      'missing_restroom_audit_relation'::text as violation_type,
      rr.object_name,
      rr.object_kind,
      'SCH2 restroom rebalance audit relation is not present yet'::text as detail
    from required_relations rr
    where to_regclass(rr.object_name) is null
  ), missing_columns as (
    select
      'missing_restroom_audit_column'::text as violation_type,
      ec.object_name || '.' || ec.column_name as object_name,
      'column'::text as object_kind,
      'Required restroom rebalance audit column is not present yet'::text as detail
    from expected_columns ec
    where to_regclass(ec.object_name) is null
       or not exists (
         select 1
         from information_schema.columns c
         where c.table_schema = split_part(ec.object_name, '.', 1)
           and c.table_name = split_part(ec.object_name, '.', 2)
           and c.column_name = ec.column_name
       )
  ), missing_check_labels as (
    select
      'missing_restroom_violation_label'::text as violation_type,
      label as object_name,
      'audit_label'::text as object_kind,
      'Constraint view must expose 09:45 restroom rebalance ' || label || ' protection'::text as detail
    from (values ('0945'), ('restroom'), ('Michael'), ('EMP002'), ('lunch_coverage')) labels(label)
    cross join view_defs vd
    where to_regclass('public.v_sch2_constraint_violations') is null
       or vd.definition not ilike '%' || label || '%'
  )
  select * from missing_relations
  union all
  select * from missing_columns
  union all
  select * from missing_check_labels
  order by violation_type, object_name
) check_sch2_restroom_rebalance;
