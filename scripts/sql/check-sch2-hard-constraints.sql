select *
from (
  -- SCH2 hard-constraint readiness gate.
  -- Returns rows for missing preview/audit substrate or unsafe catalog shape.
  with required_relations(object_name, object_kind) as (
    values
      ('public.schedule_generation_runs', 'table'),
      ('public.schedule_work_items', 'table'),
      ('public.schedule_candidate_scores', 'table'),
      ('public.schedule_solution_assignments', 'table'),
      ('public.schedule_manual_locks', 'table'),
      ('public.v_sch2_constraint_violations', 'view')
  ), required_functions(object_name, signature) as (
    values
      ('public.sch2_build_work_items', 'sch2_build_work_items(date)'),
      ('public.sch2_generate_preview', 'sch2_generate_preview(date, boolean)'),
      ('public.sch2_audit_solution', 'sch2_audit_solution(uuid)'),
      ('public.sch2_compare_current_vs_preview', 'sch2_compare_current_vs_preview(uuid)'),
      ('public.sch2_explain_assignment', 'sch2_explain_assignment(uuid, uuid)')
  ), expected_columns(object_name, column_name) as (
    values
      ('public.schedule_generation_runs', 'service_date'),
      ('public.schedule_generation_runs', 'generator_version'),
      ('public.schedule_generation_runs', 'input_hash'),
      ('public.schedule_generation_runs', 'status'),
      ('public.schedule_generation_runs', 'mode'),
      ('public.schedule_generation_runs', 'hard_violation_count'),
      ('public.schedule_generation_runs', 'open_required_count'),
      ('public.schedule_work_items', 'work_item_key'),
      ('public.schedule_work_items', 'coverage_purpose'),
      ('public.schedule_work_items', 'required'),
      ('public.schedule_work_items', 'may_be_open'),
      ('public.schedule_work_items', 'scan_required'),
      ('public.schedule_work_items', 'is_public_restroom'),
      ('public.schedule_work_items', 'route_zone'),
      ('public.schedule_work_items', 'bundle_key'),
      ('public.schedule_work_items', 'load_points'),
      ('public.schedule_work_items', 'hard_rule_tags'),
      ('public.schedule_candidate_scores', 'eligible'),
      ('public.schedule_candidate_scores', 'hard_reject_reasons'),
      ('public.schedule_candidate_scores', 'proximity_score'),
      ('public.schedule_candidate_scores', 'route_fit_score'),
      ('public.schedule_candidate_scores', 'workload_score'),
      ('public.schedule_candidate_scores', 'total_score'),
      ('public.schedule_solution_assignments', 'work_item_id'),
      ('public.schedule_solution_assignments', 'assigned_employee_id'),
      ('public.schedule_solution_assignments', 'coverage_purpose'),
      ('public.schedule_solution_assignments', 'source_type'),
      ('public.schedule_solution_assignments', 'assignment_reason'),
      ('public.schedule_solution_assignments', 'score_breakdown')
  ), missing_relations as (
    select
      'missing_sch2_relation'::text as violation_type,
      rr.object_name,
      rr.object_kind,
      'SCH2 preview/audit relation is not present yet'::text as detail
    from required_relations rr
    where to_regclass(rr.object_name) is null
  ), missing_functions as (
    select
      'missing_sch2_function'::text as violation_type,
      rf.object_name,
      'function'::text as object_kind,
      rf.signature || ' is not present yet'::text as detail
    from required_functions rf
    where to_regprocedure('public.' || rf.signature) is null
  ), missing_columns as (
    select
      'missing_sch2_column'::text as violation_type,
      ec.object_name || '.' || ec.column_name as object_name,
      'column'::text as object_kind,
      'Required SCH2 column is not present yet'::text as detail
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
  select * from missing_functions
  union all
  select * from missing_columns
  order by violation_type, object_name
) check_sch2_hard_constraints;
