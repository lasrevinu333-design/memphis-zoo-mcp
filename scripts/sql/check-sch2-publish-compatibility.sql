select *
from (
  -- SCH2 publish compatibility readiness gate.
  -- Returns rows until guarded publish, rollback, diff, and audit substrate are present.
  with required_relations(object_name, object_kind) as (
    values
      ('public.schedule_publish_audit', 'table'),
      ('public.v_sch2_publish_diff', 'view'),
      ('public.daily_schedule_assignments', 'compatibility_table')
  ), required_functions(object_name, signature) as (
    values
      ('public.sch2_publish_solution', 'sch2_publish_solution(uuid, boolean)'),
      ('public.sch2_rollback_publish', 'sch2_rollback_publish(uuid)')
  ), expected_columns(object_name, column_name) as (
    values
      ('public.schedule_publish_audit', 'run_id'),
      ('public.schedule_publish_audit', 'service_date'),
      ('public.schedule_publish_audit', 'previous_rows'),
      ('public.schedule_publish_audit', 'published_rows'),
      ('public.schedule_publish_audit', 'diff_summary'),
      ('public.schedule_publish_audit', 'published_by'),
      ('public.daily_schedule_assignments', 'service_date'),
      ('public.daily_schedule_assignments', 'location_group_id'),
      ('public.daily_schedule_assignments', 'segment_number'),
      ('public.daily_schedule_assignments', 'assigned_employee_id'),
      ('public.daily_schedule_assignments', 'owner_type'),
      ('public.daily_schedule_assignments', 'coverage_start'),
      ('public.daily_schedule_assignments', 'coverage_end'),
      ('public.daily_schedule_assignments', 'coverage_purpose'),
      ('public.daily_schedule_assignments', 'status'),
      ('public.daily_schedule_assignments', 'source_type'),
      ('public.daily_schedule_assignments', 'load_points')
  ), missing_relations as (
    select
      'missing_publish_relation'::text as violation_type,
      rr.object_name,
      rr.object_kind,
      'Publish compatibility relation is not present yet'::text as detail
    from required_relations rr
    where to_regclass(rr.object_name) is null
  ), missing_functions as (
    select
      'missing_publish_function'::text as violation_type,
      rf.object_name,
      'function'::text as object_kind,
      rf.signature || ' is not present yet'::text as detail
    from required_functions rf
    where to_regprocedure('public.' || rf.signature) is null
  ), missing_columns as (
    select
      'missing_publish_column'::text as violation_type,
      ec.object_name || '.' || ec.column_name as object_name,
      'column'::text as object_kind,
      'Required publish compatibility column is not present yet'::text as detail
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
) check_sch2_publish_compatibility;
