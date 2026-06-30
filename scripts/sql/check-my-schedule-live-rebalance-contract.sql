select *
from (
-- Memphis custodial My Schedule live-rebalance contract probe.
-- Returns rows only when the current-now display layer fails the specific clock-out / who's-left handoff rules:
--   - first clock-out cohort must go empty
--   - second clock-out cohort must go empty
--   - carry-forward groups from clocked-out owners must appear on exactly one remaining active page
--   - once the final employee clocks out, nobody should still show owned work
with params as (
  select
    public.sch_service_date(now())::date as service_date,
    time '09:45' as cutover,
    coalesce(public.sch_get_schedule_close_time(public.sch_service_date(now())::date), time '18:00') as close_time
), roster as (
  select
    r.employee_id,
    e.display_name as employee_name,
    e.employee_code,
    r.shift_start,
    r.shift_end
  from public.daily_work_roster r
  join public.employees e on e.id = r.employee_id
  cross join params p
  where r.service_date = p.service_date
    and r.active = true
    and r.shift_start < p.close_time
    and exists (
      select 1
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p.service_date
        and dsa.assigned_employee_id = r.employee_id
        and dsa.status = 'ASSIGNED'
        and coalesce(dsa.coverage_purpose, 'area_owner') in (
          'deep_clean',
          'reminder',
          'area_owner',
          'restroom_upkeep',
          'lunch_coverage',
          'late_coverage',
          'response_only'
        )
    )
), distinct_shift_ends as (
  select distinct r.shift_end
  from roster r
  cross join params p
  where r.shift_end > p.cutover
    and r.shift_end < p.close_time
), first_clockout_probe as (
  select
    'first_clockout'::text as scenario_name,
    q.shift_end as cohort_end,
    least(
      p.service_date::timestamp + q.shift_end + interval '30 minutes',
      p.service_date::timestamp + p.close_time - interval '1 minute'
    ) as probe_local_ts
  from (
    select shift_end
    from distinct_shift_ends
    order by shift_end
    limit 1
  ) q
  cross join params p
), second_clockout_probe as (
  select
    'second_clockout'::text as scenario_name,
    q.shift_end as cohort_end,
    least(
      p.service_date::timestamp + q.shift_end + interval '30 minutes',
      p.service_date::timestamp + p.close_time - interval '1 minute'
    ) as probe_local_ts
  from (
    select shift_end
    from distinct_shift_ends
    order by shift_end
    offset 1
    limit 1
  ) q
  cross join params p
), single_remaining_probe as (
  select
    'single_remaining'::text as scenario_name,
    c.shift_end as cohort_end,
    c.probe_local_ts
  from (
    select
      d.shift_end,
      least(
        p.service_date::timestamp + d.shift_end + interval '15 minutes',
        p.service_date::timestamp + p.close_time - interval '1 minute'
      ) as probe_local_ts
    from distinct_shift_ends d
    cross join params p
  ) c
  where (
    select count(*)::int
    from roster r
    where r.shift_start <= c.probe_local_ts::time
      and r.shift_end > c.probe_local_ts::time
  ) = 1
  order by c.probe_local_ts
  limit 1
), after_final_clockout_probe as (
  select
    'after_final_clockout'::text as scenario_name,
    max(r.shift_end) as cohort_end,
    max(p.service_date::timestamp + r.shift_end + interval '5 minutes') as probe_local_ts
  from roster r
  cross join params p
), scenarios as (
  select * from first_clockout_probe
  union all
  select * from second_clockout_probe
  union all
  select * from single_remaining_probe
  union all
  select * from after_final_clockout_probe
), required_scenarios as (
  select *
  from (values
    ('first_clockout'::text),
    ('second_clockout'::text),
    ('single_remaining'::text),
    ('after_final_clockout'::text)
  ) v(scenario_name)
), missing_scenarios as (
  select
    'my_schedule_missing_live_rebalance_probe'::text as violation_type,
    p.service_date,
    rs.scenario_name,
    null::text as probe_time,
    null::uuid as employee_id,
    null::text as employee_name,
    null::text as employee_code,
    null::text as group_code,
    null::text as group_name,
    null::text as coverage_purpose,
    ('Required live rebalance probe scenario was not derivable from the current roster: ' || rs.scenario_name || '.')::text as detail
  from required_scenarios rs
  cross join params p
  left join scenarios s on s.scenario_name = rs.scenario_name
  where s.scenario_name is null
), scenario_active_roster as (
  select
    s.scenario_name,
    s.probe_local_ts,
    r.employee_id,
    r.employee_name,
    r.employee_code,
    r.shift_start,
    r.shift_end
  from scenarios s
  join roster r
    on r.shift_start <= s.probe_local_ts::time
   and r.shift_end > s.probe_local_ts::time
), scenario_active_counts as (
  select
    s.scenario_name,
    count(ar.employee_id)::int as active_count
  from scenarios s
  left join scenario_active_roster ar on ar.scenario_name = s.scenario_name
  group by s.scenario_name
), scenario_pages as (
  select
    s.scenario_name,
    s.probe_local_ts,
    r.employee_id,
    r.employee_name,
    r.employee_code,
    public.sch_employee_my_schedule_page(
      p.service_date,
      r.employee_id,
      s.probe_local_ts at time zone 'America/Chicago'
    ) as page_data
  from scenarios s
  cross join params p
  join roster r on true
), scenario_page_item_counts as (
  select
    sp.scenario_name,
    sp.employee_id,
    jsonb_array_length(coalesce(sp.page_data->'items', '[]'::jsonb))::int as item_count
  from scenario_pages sp
), scenario_page_items as (
  select
    sp.scenario_name,
    sp.probe_local_ts,
    sp.employee_id,
    sp.employee_name,
    sp.employee_code,
    item
  from scenario_pages sp
  cross join lateral jsonb_array_elements(coalesce(sp.page_data->'items', '[]'::jsonb)) item
), scenario_active_page_items as (
  select spi.*
  from scenario_page_items spi
  join scenario_active_roster ar
    on ar.scenario_name = spi.scenario_name
   and ar.employee_id = spi.employee_id
), scenario_current_direct_coverage as (
  select distinct
    s.scenario_name,
    dsa.location_group_id
  from scenarios s
  join scenario_active_roster ar on ar.scenario_name = s.scenario_name
  join public.daily_schedule_assignments dsa
    on dsa.service_date = (select service_date from params)
   and dsa.assigned_employee_id = ar.employee_id
   and dsa.status = 'ASSIGNED'
  where coalesce(dsa.coverage_purpose, 'area_owner') in (
      'deep_clean',
      'area_owner',
      'restroom_upkeep',
      'response_only',
      'late_coverage'
    )
    and dsa.coverage_start <= s.probe_local_ts::time
    and dsa.coverage_end > s.probe_local_ts::time
), scenario_latest_owner_rows as (
  select distinct on (s.scenario_name, dsa.location_group_id)
    s.scenario_name,
    dsa.location_group_id,
    lg.group_code,
    lg.group_name,
    coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
    dsa.assigned_employee_id as owner_employee_id,
    owner_roster.shift_end as owner_shift_end
  from scenarios s
  join public.daily_schedule_assignments dsa
    on dsa.service_date = (select service_date from params)
   and dsa.status = 'ASSIGNED'
   and dsa.assigned_employee_id is not null
  join public.location_groups lg on lg.id = dsa.location_group_id
  left join public.daily_work_roster owner_roster
    on owner_roster.service_date = (select service_date from params)
   and owner_roster.employee_id = dsa.assigned_employee_id
   and owner_roster.active = true
  where coalesce(dsa.coverage_purpose, 'area_owner') in (
      'deep_clean',
      'area_owner',
      'restroom_upkeep',
      'response_only'
    )
    and dsa.coverage_end > (select cutover from params)
  order by s.scenario_name, dsa.location_group_id, dsa.coverage_end desc, dsa.coverage_start desc, dsa.updated_at desc nulls last, dsa.id desc
), scenario_carry_forward_expected as (
  select
    lo.scenario_name,
    lo.location_group_id,
    lo.group_code,
    lo.group_name,
    lo.coverage_purpose,
    lo.owner_employee_id,
    lo.owner_shift_end,
    to_char(greatest(p.cutover, coalesce(lo.owner_shift_end, p.cutover)), 'HH12:MI AM') as expected_start_display
  from scenario_latest_owner_rows lo
  cross join params p
  join scenario_active_counts ac on ac.scenario_name = lo.scenario_name
  left join scenario_current_direct_coverage dc
    on dc.scenario_name = lo.scenario_name
   and dc.location_group_id = lo.location_group_id
  left join scenario_active_roster owner_active
    on owner_active.scenario_name = lo.scenario_name
   and owner_active.employee_id = lo.owner_employee_id
  where lo.scenario_name <> 'after_final_clockout'
    and ac.active_count > 0
    and dc.location_group_id is null
    and owner_active.employee_id is null
), scenario_carry_forward_matches as (
  select
    exp.scenario_name,
    exp.group_code,
    exp.group_name,
    exp.coverage_purpose,
    exp.owner_shift_end,
    exp.expected_start_display,
    count(api.employee_id)::int as displayed_count,
    max(api.item->>'coverage_start') as displayed_start,
    string_agg(distinct api.employee_name, ', ' order by api.employee_name) as displayed_employee_names
  from scenario_carry_forward_expected exp
  left join scenario_active_page_items api
    on api.scenario_name = exp.scenario_name
   and (
     (
       exp.scenario_name = 'single_remaining'
       and api.item->>'group_code' = 'ALL_LOCATIONS'
     )
     or
     (
       exp.scenario_name <> 'single_remaining'
       and api.item->>'group_code' = exp.group_code
       and coalesce(api.item->>'coverage_purpose', 'area_owner') = exp.coverage_purpose
     )
   )
  group by exp.scenario_name, exp.group_code, exp.group_name, exp.coverage_purpose, exp.owner_shift_end, exp.expected_start_display
), clocked_out_employee_items as (
  select
    'my_schedule_clocked_out_employee_still_has_items'::text as violation_type,
    p.service_date,
    s.scenario_name,
    to_char(s.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    r.employee_id,
    r.employee_name,
    r.employee_code,
    null::text as group_code,
    null::text as group_name,
    null::text as coverage_purpose,
    (
      r.employee_name || ' clocked out at ' || to_char(r.shift_end, 'HH12:MI AM') ||
      ' but sch_employee_my_schedule_page still returned ' || spic.item_count::text ||
      ' items during ' || s.scenario_name || '.'
    )::text as detail
  from scenarios s
  cross join params p
  join roster r on r.shift_end <= s.probe_local_ts::time
  left join scenario_active_roster ar
    on ar.scenario_name = s.scenario_name
   and ar.employee_id = r.employee_id
  join scenario_page_item_counts spic
    on spic.scenario_name = s.scenario_name
   and spic.employee_id = r.employee_id
  where s.scenario_name <> 'after_final_clockout'
    and ar.employee_id is null
    and spic.item_count > 0
), missing_carry_forward_groups as (
  select
    'my_schedule_missing_carry_forward_group'::text as violation_type,
    p.service_date,
    m.scenario_name,
    to_char(s.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    null::uuid as employee_id,
    null::text as employee_name,
    null::text as employee_code,
    m.group_code,
    m.group_name,
    m.coverage_purpose,
    (
      m.group_name || ' (' || m.group_code || ') should have been carried forward during ' ||
      m.scenario_name || ' but appeared on zero active My Schedule pages.'
    )::text as detail
  from scenario_carry_forward_matches m
  join scenarios s on s.scenario_name = m.scenario_name
  cross join params p
  where m.displayed_count = 0
), duplicate_carry_forward_groups as (
  select
    'my_schedule_duplicate_carry_forward_group'::text as violation_type,
    p.service_date,
    m.scenario_name,
    to_char(s.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    null::uuid as employee_id,
    null::text as employee_name,
    null::text as employee_code,
    m.group_code,
    m.group_name,
    m.coverage_purpose,
    (
      m.group_name || ' (' || m.group_code || ') appeared on ' || m.displayed_count::text ||
      ' active My Schedule pages during ' || m.scenario_name ||
      ': ' || coalesce(m.displayed_employee_names, '[unknown]') || '.'
    )::text as detail
  from scenario_carry_forward_matches m
  join scenarios s on s.scenario_name = m.scenario_name
  cross join params p
  where m.displayed_count > 1
), drifted_carry_forward_start_times as (
  select
    'my_schedule_carry_forward_start_time_drift'::text as violation_type,
    p.service_date,
    m.scenario_name,
    to_char(s.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    null::uuid as employee_id,
    null::text as employee_name,
    null::text as employee_code,
    m.group_code,
    m.group_name,
    m.coverage_purpose,
    (
      m.group_name || ' (' || m.group_code || ') displayed carry-forward start ' ||
      coalesce(m.displayed_start, '[missing]') || ' during ' || m.scenario_name ||
      ' but should have started at the source owner handoff ' || m.expected_start_display || '.'
    )::text as detail
  from scenario_carry_forward_matches m
  join scenarios s on s.scenario_name = m.scenario_name
  cross join params p
  where m.displayed_count = 1
    and coalesce(m.displayed_start, '') <> m.expected_start_display
), single_remaining_all_locations_shape as (
  select
    s.scenario_name,
    s.probe_local_ts,
    ar.employee_id,
    ar.employee_name,
    ar.employee_code,
    count(spi.item)::int as total_items,
    count(*) filter (where spi.item->>'group_code' = 'ALL_LOCATIONS')::int as all_locations_count,
    max(spi.item->>'name') filter (where spi.item->>'group_code' = 'ALL_LOCATIONS') as all_locations_name,
    max(coalesce(spi.item->>'coverage_purpose', '')) filter (where spi.item->>'group_code' = 'ALL_LOCATIONS') as all_locations_purpose
  from scenarios s
  join scenario_active_roster ar on ar.scenario_name = s.scenario_name
  left join scenario_active_page_items spi
    on spi.scenario_name = s.scenario_name
   and spi.employee_id = ar.employee_id
  where s.scenario_name = 'single_remaining'
  group by s.scenario_name, s.probe_local_ts, ar.employee_id, ar.employee_name, ar.employee_code
), single_remaining_all_locations_violations as (
  select
    'my_schedule_single_remaining_not_collapsed'::text as violation_type,
    p.service_date,
    sr.scenario_name,
    to_char(sr.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    sr.employee_id,
    sr.employee_name,
    sr.employee_code,
    'ALL_LOCATIONS'::text as group_code,
    'All Locations'::text as group_name,
    case when sr.employee_code = 'EMP002' then 'late_coverage' else 'area_owner' end as coverage_purpose,
    (
      sr.employee_name || ' should show a single All Locations row once they are the last active custodian, but got ' ||
      sr.total_items::text || ' items with ' || sr.all_locations_count::text || ' All Locations rows.'
    )::text as detail
  from single_remaining_all_locations_shape sr
  cross join params p
  where sr.total_items <> 1
     or sr.all_locations_count <> 1
     or coalesce(sr.all_locations_name, '') <> 'All Locations'
     or (sr.employee_code = 'EMP002' and coalesce(sr.all_locations_purpose, '') <> 'late_coverage')
), after_final_clockout_items as (
  select
    'my_schedule_after_final_clockout_still_has_items'::text as violation_type,
    p.service_date,
    s.scenario_name,
    to_char(s.probe_local_ts::time, 'HH12:MI AM') as probe_time,
    sp.employee_id,
    sp.employee_name,
    sp.employee_code,
    null::text as group_code,
    null::text as group_name,
    null::text as coverage_purpose,
    (
      sp.employee_name || ' still had ' || spic.item_count::text ||
      ' My Schedule items after the final shift ended.'
    )::text as detail
  from scenarios s
  cross join params p
  join scenario_pages sp on sp.scenario_name = s.scenario_name
  join scenario_page_item_counts spic
    on spic.scenario_name = sp.scenario_name
   and spic.employee_id = sp.employee_id
  where s.scenario_name = 'after_final_clockout'
    and spic.item_count > 0
)
select * from missing_scenarios
union all
select * from clocked_out_employee_items
union all
select * from missing_carry_forward_groups
union all
select * from duplicate_carry_forward_groups
union all
select * from drifted_carry_forward_start_times
union all
select * from single_remaining_all_locations_violations
union all
select * from after_final_clockout_items
order by service_date, scenario_name, violation_type, employee_name nulls last, group_code nulls last
) my_schedule_live_rebalance_contract;
