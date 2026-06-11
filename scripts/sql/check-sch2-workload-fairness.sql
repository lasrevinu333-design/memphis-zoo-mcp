select *
from (
  -- SCH2 workload fairness readiness/audit gate.
  -- Returns rows until workload audit substrate can prove fair load_points distribution.
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
  )
  select * from missing_relations
  union all
  select * from missing_columns
  order by violation_type, object_name
) check_sch2_workload_fairness;
