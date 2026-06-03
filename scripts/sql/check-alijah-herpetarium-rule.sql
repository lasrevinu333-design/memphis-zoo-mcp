-- Regression check for the Alijah Collins / Herpetarium scheduler guard.
-- Expected result after the migration: all boolean columns are true and
-- violation_count is 0.

select
  to_regprocedure('public.sch_is_employee_location_group_restricted(uuid, uuid, integer)') is not null as has_restriction_function,
  to_regprocedure('public.sch_validate_alijah_herpetarium_rule(date, date)') is not null as has_validation_function,
  coalesce((
    select public.sch_is_employee_location_group_restricted(e.id, lg.id, 0)
    from public.employees e
    cross join public.location_groups lg
    where e.display_name = 'Alijah Collins'
      and lg.group_code = 'HERPETARIUM'
    limit 1
  ), false) as sunday_alijah_herpetarium_restricted,
  coalesce((
    select count(*) = 0
    from public.sch_validate_alijah_herpetarium_rule(current_date, current_date + 60)
  ), false) as no_current_or_template_violations,
  coalesce((
    select count(*)
    from public.sch_validate_alijah_herpetarium_rule(current_date, current_date + 60)
  ), -1) as violation_count;
