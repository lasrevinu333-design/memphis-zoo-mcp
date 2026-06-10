-- Repair the three 2026-06-09 open-owner rows created when the 9:45 restroom
-- rebalance attempted to move non-restroom ownership to a restricted employee.
--
-- Safety gates:
-- - exact assignment IDs only
-- - exact service date/source/status/owner state only
-- - desired employee must be active and on active roster
-- - desired employee's shift must cover the assignment segment
-- - desired employee must not be restricted from the location group that day
-- - single statement: updates only when exactly 3 eligible targets exist;
--   final SELECT intentionally errors and rolls back if exactly 3 rows are not updated.

with target(assignment_id, group_code, desired_employee_name) as (
  values
    ('7c55b0f4-fdc1-4ba0-bbf6-8b2c51600b47'::uuid, 'WEST_ADMIN', 'Kinnaye Peete'),
    ('e7bf1d10-f960-4ecc-aa82-855523ab21cc'::uuid, 'CHINA', 'Markiesha Warren'),
    ('212c35c1-3795-452c-98d5-3576a58b3dc7'::uuid, 'EVENT_CENTER', 'Markiesha Warren')
), eligible_targets as (
  select
    dsa.id,
    e.id as desired_employee_id,
    e.display_name as desired_employee_name
  from target t
  join public.daily_schedule_assignments dsa on dsa.id = t.assignment_id
  join public.location_groups lg on lg.id = dsa.location_group_id
    and lg.group_code = t.group_code
  join public.employees e on e.display_name = t.desired_employee_name
    and e.active = true
  join public.daily_work_roster r on r.service_date = dsa.service_date
    and r.employee_id = e.id
    and r.active = true
    and r.shift_start <= dsa.coverage_start
    and r.shift_end >= dsa.coverage_end
  where dsa.service_date = date '2026-06-09'
    and dsa.status = 'OPEN'
    and dsa.owner_type = 'OPEN'
    and dsa.assigned_employee_id is null
    and dsa.source_type = 'restroom_rebalance_0945:restricted_guard'
    and coalesce(dsa.coverage_purpose, 'area_owner') = 'deep_clean'
    and not public.sch_is_employee_location_group_restricted(
      e.id,
      dsa.location_group_id,
      extract(dow from dsa.service_date)::integer
    )
), eligible_count as (
  select count(*)::integer as n
  from eligible_targets
), updated as (
  update public.daily_schedule_assignments dsa
  set
    assigned_employee_id = et.desired_employee_id,
    owner_type = 'EMPLOYEE',
    status = 'ASSIGNED',
    source_type = 'manual_safe_restore_after_restricted_guard',
    notes = trim(both ' ' from concat_ws(
      ' | ',
      nullif(dsa.notes, ''),
      'Restored by guarded scheduler open-owner repair to ' || et.desired_employee_name || ' after verifying roster, shift coverage, and restriction policy.'
    )),
    updated_at = now()
  from eligible_targets et
  where dsa.id = et.id
    and (select n from eligible_count) = 3
  returning dsa.id
), updated_count as (
  select count(*)::integer as n
  from updated
)
select
  case
    when (select n from eligible_count) = 3
     and (select n from updated_count) = 3
    then 3
    else 1 / ((select n from updated_count) - (select n from updated_count))
  end as restored_scheduler_open_owner_rows;
