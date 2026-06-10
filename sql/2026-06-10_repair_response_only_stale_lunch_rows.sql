-- Exact, fail-closed repair for stale generated Primate Canyon response-only
-- rows in the current scheduler window. This is intentionally separate from
-- the sch_apply_lunch_coverage function guard so a data-repair mismatch cannot
-- partially rewrite unrelated rows.
--
-- Safety gates:
-- - exact assignment IDs only
-- - exact service dates, group code, segment numbers, purposes, times, source types
-- - only the observed stale response-only split shape: 05:00-09:00 owner,
--   09:00-10:00 lunch_coverage, 10:00-14:00 owner
-- - no late_coverage/manual/manager/override rows are targeted
-- - owner row employee must still be active, on roster, full-shift eligible,
--   and unrestricted for the location/date
-- - single SQL statement errors and rolls back unless exactly 4 owner rows are
--   normalized and exactly 8 stale split/lunch rows are deleted.

with target(assignment_id, service_date, group_code, segment_number, coverage_start, coverage_end, coverage_purpose, source_type, keep_row) as (
  values
    ('debb3e48-1390-4d2b-8699-dff093c3000e'::uuid, date '2026-06-09', 'PRIMATE_CANYON', 1, time '05:00:00', time '09:00:00', 'deep_clean', 'coverage_template:lunch_split_before', true),
    ('1b84c429-9498-4471-a3d9-04718f19de8f'::uuid, date '2026-06-09', 'PRIMATE_CANYON', 2, time '09:00:00', time '10:00:00', 'lunch_coverage', 'lunch_coverage', false),
    ('ee21b8a9-7449-420b-af03-cc5f7369ca0b'::uuid, date '2026-06-09', 'PRIMATE_CANYON', 3, time '10:00:00', time '14:00:00', 'deep_clean', 'coverage_template:lunch_split_after', false),
    ('cf804066-1cd0-4c1d-b4c8-56ebb23d419b'::uuid, date '2026-06-10', 'PRIMATE_CANYON', 1, time '05:00:00', time '09:00:00', 'deep_clean', 'coverage_template:lunch_split_before:static_owner_restored', true),
    ('38e6c5f7-cd55-4047-854d-6280831e2739'::uuid, date '2026-06-10', 'PRIMATE_CANYON', 2, time '09:00:00', time '10:00:00', 'lunch_coverage', 'lunch_coverage', false),
    ('43561b85-a5ed-4ecc-8813-a37203f28f81'::uuid, date '2026-06-10', 'PRIMATE_CANYON', 3, time '10:00:00', time '14:00:00', 'deep_clean', 'coverage_template:lunch_split_after', false),
    ('9bc7e4ad-110a-4523-8bf4-e2b0f16acc3e'::uuid, date '2026-06-12', 'PRIMATE_CANYON', 1, time '05:00:00', time '09:00:00', 'deep_clean', 'coverage_template:lunch_split_before', true),
    ('3c5e7743-9395-45ba-bcb5-7bc426bad452'::uuid, date '2026-06-12', 'PRIMATE_CANYON', 2, time '09:00:00', time '10:00:00', 'lunch_coverage', 'lunch_coverage', false),
    ('2fce2cd3-9cdd-4562-b28e-11158e945628'::uuid, date '2026-06-12', 'PRIMATE_CANYON', 3, time '10:00:00', time '14:00:00', 'deep_clean', 'coverage_template:lunch_split_after', false),
    ('5702b171-b7ae-471b-9bc2-b18146d76031'::uuid, date '2026-06-13', 'PRIMATE_CANYON', 1, time '05:00:00', time '09:00:00', 'deep_clean', 'coverage_template:lunch_split_before', true),
    ('b1ac0f88-510b-4ceb-80c2-425942f38959'::uuid, date '2026-06-13', 'PRIMATE_CANYON', 2, time '09:00:00', time '10:00:00', 'lunch_coverage', 'lunch_coverage', false),
    ('95e1585f-c92d-4444-a0fd-19ff1b274188'::uuid, date '2026-06-13', 'PRIMATE_CANYON', 3, time '10:00:00', time '14:00:00', 'deep_clean', 'coverage_template:lunch_split_after', false)
), eligible as (
  select
    t.*,
    dsa.id,
    dsa.location_group_id,
    dsa.assigned_employee_id,
    e.display_name as owner_name
  from target t
  join public.daily_schedule_assignments dsa on dsa.id = t.assignment_id
  join public.location_groups lg on lg.id = dsa.location_group_id
    and lg.group_code = t.group_code
  join public.employees e on e.id = dsa.assigned_employee_id
    and e.active = true
  where dsa.service_date = t.service_date
    and dsa.segment_number = t.segment_number
    and dsa.coverage_start = t.coverage_start
    and dsa.coverage_end = t.coverage_end
    and coalesce(dsa.coverage_purpose, '') = t.coverage_purpose
    and dsa.source_type = t.source_type
    and dsa.status = 'ASSIGNED'
    and dsa.owner_type = 'EMPLOYEE'
    and dsa.assigned_employee_id is not null
    and coalesce(dsa.notes, '') ilike '%Response-only daytime ownership%'
    and dsa.source_type not ilike '%manual%'
    and dsa.source_type not ilike '%manager%'
    and dsa.source_type not ilike '%override%'
), group_checks as (
  select
    service_date,
    group_code,
    location_group_id,
    count(*)::integer as row_count,
    count(*) filter (where keep_row)::integer as keep_count,
    count(*) filter (where coverage_purpose = 'lunch_coverage')::integer as lunch_count,
    count(*) filter (where not keep_row)::integer as stale_count,
    min(coverage_start) as min_start,
    max(coverage_end) as max_end
  from eligible
  group by service_date, group_code, location_group_id
), eligible_keeper_checks as (
  select e.id
  from eligible e
  join public.daily_work_roster r on r.service_date = e.service_date
    and r.employee_id = e.assigned_employee_id
    and r.active = true
    and r.shift_start <= time '05:00:00'
    and r.shift_end >= time '14:00:00'
  where e.keep_row
    and not public.sch_is_employee_location_group_restricted(
      e.assigned_employee_id,
      e.location_group_id,
      extract(dow from e.service_date)::integer
    )
), guard as (
  select
    (select count(*) from target)::integer as target_count,
    (select count(*) from eligible)::integer as eligible_count,
    (select count(*) from eligible_keeper_checks)::integer as eligible_keeper_count,
    (select count(*) from group_checks where row_count = 3 and keep_count = 1 and lunch_count = 1 and stale_count = 2 and min_start = time '05:00:00' and max_end = time '14:00:00')::integer as valid_group_count
), normalized as (
  update public.daily_schedule_assignments dsa
     set coverage_start = time '05:00:00',
         coverage_end = time '14:00:00',
         coverage_purpose = 'response_only',
         load_points = 0,
         source_type = 'response_only_exception_repair',
         notes = trim(concat_ws(
           ' | ',
           nullif(dsa.notes, ''),
           'No Clean / Calls to Location Only. Stale lunch/deep-clean split collapsed by exact scheduler response-only repair.'
         )),
         updated_at = now()
    from eligible e, guard g
   where dsa.id = e.id
     and e.keep_row
     and g.target_count = 12
     and g.eligible_count = 12
     and g.eligible_keeper_count = 4
     and g.valid_group_count = 4
  returning dsa.id
), deleted as (
  delete from public.daily_schedule_assignments dsa
  using eligible e, guard g
  where dsa.id = e.id
    and not e.keep_row
    and g.target_count = 12
    and g.eligible_count = 12
    and g.eligible_keeper_count = 4
    and g.valid_group_count = 4
  returning dsa.id, dsa.coverage_purpose
), counts as (
  select
    (select target_count from guard)::integer as target_count,
    (select eligible_count from guard)::integer as eligible_count,
    (select eligible_keeper_count from guard)::integer as eligible_keeper_count,
    (select valid_group_count from guard)::integer as valid_group_count,
    (select count(*) from normalized)::integer as normalized_count,
    (select count(*) from deleted)::integer as deleted_count,
    (select count(*) from deleted where coverage_purpose = 'lunch_coverage')::integer as deleted_lunch_count
)
select case
  when target_count = 12
   and eligible_count = 12
   and eligible_keeper_count = 4
   and valid_group_count = 4
   and normalized_count = 4
   and deleted_count = 8
   and deleted_lunch_count = 4
  then jsonb_build_object(
    'normalized_response_only_rows', normalized_count,
    'deleted_stale_split_rows', deleted_count,
    'deleted_lunch_coverage_rows', deleted_lunch_count
  )
  else jsonb_build_object('error', 1 / (normalized_count - normalized_count))
end as response_only_stale_lunch_repair
from counts;
