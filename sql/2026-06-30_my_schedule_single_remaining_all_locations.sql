-- Keep My Schedule/device pages grounded in the current now snapshot.
--
-- Rules:
-- - Before 9:45 AM, keep the morning ownership view.
-- - After 9:45 AM, show only rows active right now; do not leak future rows.
-- - When an earlier-shift custodian has clocked out, carry their normal owned areas
--   across still-active custodians using coverage-candidate proximity/familiarity plus a
--   light live-load penalty so ownership stays balanced without throwing areas far away.
-- - If only one active employee remains, that employee owns all carry-forward areas until
--   shift end / close.
-- - If nobody remains, do not fabricate owners.
--
-- This is a display-layer current-state overlay for My Schedule/device pages. The daily
-- assignments table remains the source of truth for planned ownership.
create or replace function public.sch_employee_my_schedule_page(
  p_service_date date,
  p_employee_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
as $function$
declare
  v_local_time time := timezone('America/Chicago', p_as_of)::time;
  v_cutover time := time '09:45';
  v_close_time time := coalesce(public.sch_get_schedule_close_time(p_service_date), time '18:00');
  v_employee record;
  v_shift record;
  v_has_945_change boolean := false;
  v_items jsonb := '[]'::jsonb;
  v_future_notice text := null;
  v_active_employee_ids uuid[] := '{}'::uuid[];
  v_active_count integer := 0;
  v_employee_active_now boolean := false;
  v_loads jsonb := '{}'::jsonb;
  v_load_key text;
  v_candidate record;
  v_single_remaining_start time := null;
  rec record;
begin
  select id, display_name, employee_code, role
    into v_employee
  from public.employees
  where id = p_employee_id
    and active = true;

  if v_employee.id is null then
    return jsonb_build_object('ok', false, 'error', 'Employee not found or inactive');
  end if;

  select shift_start, shift_end
    into v_shift
  from public.daily_work_roster
  where service_date = p_service_date
    and employee_id = p_employee_id
    and active = true
  order by shift_start
  limit 1;

  select exists (
    select 1
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.source_type, '') like '%restroom_rebalance_0945%'
  ) into v_has_945_change;

  if v_has_945_change and v_local_time < v_cutover then
    v_future_notice := 'Your restroom ownership changes at 9:45 AM. Check My Schedule then for the updated restroom list.';
  end if;

  select
    coalesce(array_agg(r.employee_id order by r.shift_end, r.shift_start, e.display_name), '{}'::uuid[]),
    count(*)::int
    into v_active_employee_ids, v_active_count
  from public.daily_work_roster r
  join public.employees e on e.id = r.employee_id
  where r.service_date = p_service_date
    and r.active = true
    and r.shift_start <= v_local_time
    and r.shift_end > v_local_time
    and r.shift_start < v_close_time;

  v_employee_active_now := p_employee_id = any(v_active_employee_ids);

  for rec in
    select x.employee_id::text as employee_id_text
    from unnest(coalesce(v_active_employee_ids, '{}'::uuid[])) as x(employee_id)
  loop
    v_loads := jsonb_set(v_loads, array[rec.employee_id_text], to_jsonb(0), true);
  end loop;

  with source_rows as (
    select
      dsa.coverage_start,
      dsa.coverage_end,
      coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(lg.id) as is_public_restroom,
      (coalesce(dsa.coverage_purpose, '') = 'reminder') as is_schedule_only_reminder
    from public.daily_schedule_assignments dsa
    join public.location_groups lg on lg.id = dsa.location_group_id
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
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
      and (
        (
          v_local_time < v_cutover
          and coalesce(dsa.coverage_purpose, '') in ('deep_clean', 'reminder', 'area_owner', 'restroom_upkeep', 'response_only')
          and dsa.coverage_start < v_cutover
          and dsa.coverage_end > v_local_time
        )
        or
        (
          v_local_time >= v_cutover
          and coalesce(dsa.coverage_purpose, '') in ('deep_clean', 'reminder', 'area_owner', 'restroom_upkeep', 'response_only')
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'lunch_coverage'
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'late_coverage'
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
      )
  ), dedup as (
    select distinct on (group_code, coverage_purpose)
      group_code,
      group_name,
      coverage_purpose,
      is_public_restroom,
      is_schedule_only_reminder,
      min(coverage_start) over (partition by group_code, coverage_purpose) as first_start,
      max(coverage_end) over (partition by group_code, coverage_purpose) as last_end
    from source_rows
    order by group_code, coverage_purpose, coverage_start
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', group_name,
      'group_code', group_code,
      'coverage_purpose', coverage_purpose,
      'coverage_start', to_char(first_start, 'HH12:MI AM'),
      'coverage_end', case when last_end = time '23:59:59' then 'Close' else to_char(last_end, 'HH12:MI AM') end,
      'is_public_restroom', is_public_restroom,
      'is_schedule_only_reminder', is_schedule_only_reminder
    )
    order by
      case coverage_purpose
        when 'lunch_coverage' then 2
        when 'late_coverage' then 3
        else 1
      end,
      case when is_public_restroom then 0 else 1 end,
      group_name
  ), '[]'::jsonb)
  into v_items
  from dedup;

  if v_active_count > 0 then
    for rec in
      select dsa.assigned_employee_id::text as employee_id_text, count(*)::int as item_count
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p_service_date
        and dsa.status = 'ASSIGNED'
        and dsa.assigned_employee_id = any(v_active_employee_ids)
        and coalesce(dsa.coverage_purpose, 'area_owner') in (
          'deep_clean',
          'reminder',
          'area_owner',
          'restroom_upkeep',
          'lunch_coverage',
          'late_coverage',
          'response_only'
        )
        and dsa.coverage_start <= v_local_time
        and dsa.coverage_end > v_local_time
      group by dsa.assigned_employee_id
    loop
      v_load_key := rec.employee_id_text;
      v_loads := jsonb_set(
        v_loads,
        array[v_load_key],
        to_jsonb(coalesce((v_loads ->> v_load_key)::int, 0) + rec.item_count),
        true
      );
    end loop;
  end if;

  if v_local_time >= v_cutover and v_local_time < v_close_time and v_active_count > 0 and v_employee_active_now then
    for rec in
      with active_roster as (
        select r.employee_id
        from public.daily_work_roster r
        where r.service_date = p_service_date
          and r.active = true
          and r.shift_start <= v_local_time
          and r.shift_end > v_local_time
      ), current_direct_coverage as (
        select distinct dsa.location_group_id
        from public.daily_schedule_assignments dsa
        join active_roster ar on ar.employee_id = dsa.assigned_employee_id
        where dsa.service_date = p_service_date
          and dsa.status = 'ASSIGNED'
          and coalesce(dsa.coverage_purpose, 'area_owner') in (
            'deep_clean',
            'area_owner',
            'restroom_upkeep',
            'response_only',
            'late_coverage'
          )
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
      ), latest_owner_rows as (
        select distinct on (dsa.location_group_id)
          dsa.location_group_id,
          lg.group_code,
          lg.group_name,
          coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
          dsa.assigned_employee_id as owner_employee_id,
          owner_roster.shift_end as owner_shift_end,
          public.sch_is_public_restroom_group(lg.id) as is_public_restroom
        from public.daily_schedule_assignments dsa
        join public.location_groups lg on lg.id = dsa.location_group_id
        left join public.daily_work_roster owner_roster
          on owner_roster.service_date = p_service_date
         and owner_roster.employee_id = dsa.assigned_employee_id
         and owner_roster.active = true
        where dsa.service_date = p_service_date
          and dsa.status = 'ASSIGNED'
          and dsa.assigned_employee_id is not null
          and coalesce(dsa.coverage_purpose, 'area_owner') in (
            'deep_clean',
            'area_owner',
            'restroom_upkeep',
            'response_only'
          )
          and dsa.coverage_end > v_cutover
        order by dsa.location_group_id, dsa.coverage_end desc, dsa.coverage_start desc, dsa.updated_at desc nulls last, dsa.id desc
      )
      select lo.*
      from latest_owner_rows lo
      left join current_direct_coverage dc on dc.location_group_id = lo.location_group_id
      where dc.location_group_id is null
        and not (lo.owner_employee_id = any(v_active_employee_ids))
      order by case when lo.is_public_restroom then 0 else 1 end, lo.group_name, lo.group_code
    loop
      v_candidate := null;

      if v_active_count = 1 then
        select
          r.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          least(r.shift_end, v_close_time) as effective_end
          into v_candidate
        from public.daily_work_roster r
        join public.employees e on e.id = r.employee_id
        where r.service_date = p_service_date
          and r.active = true
          and r.employee_id = v_active_employee_ids[1]
        limit 1;
      else
        select
          c.employee_id,
          c.employee_name,
          c.employee_code,
          least(r.shift_end, v_close_time) as effective_end,
          coalesce((v_loads ->> c.employee_id::text)::int, 0) as effective_load,
          c.best_proximity_score,
          c.walking_minutes,
          c.recommendation_score,
          (c.recommendation_score - (coalesce((v_loads ->> c.employee_id::text)::numeric, 0) * 20)) as adjusted_score
          into v_candidate
        from public.sch_get_coverage_candidates(p_service_date, rec.location_group_id, v_local_time, v_close_time) c
        join public.daily_work_roster r
          on r.service_date = p_service_date
         and r.employee_id = c.employee_id
         and r.active = true
        where c.employee_id = any(v_active_employee_ids)
          and r.shift_start <= v_local_time
          and r.shift_end > v_local_time
        order by adjusted_score desc, effective_load asc, c.best_proximity_score desc, c.walking_minutes asc nulls last, c.employee_name asc
        limit 1;

        if v_candidate.employee_id is null then
          select
            r.employee_id,
            e.display_name as employee_name,
            e.employee_code,
            least(r.shift_end, v_close_time) as effective_end,
            coalesce((v_loads ->> r.employee_id::text)::int, 0) as effective_load
            into v_candidate
          from public.daily_work_roster r
          join public.employees e on e.id = r.employee_id
          where r.service_date = p_service_date
            and r.active = true
            and r.employee_id = any(v_active_employee_ids)
            and r.shift_start <= v_local_time
            and r.shift_end > v_local_time
          order by effective_load asc, least(r.shift_end, v_close_time) desc, e.display_name asc
          limit 1;
        end if;
      end if;

      if v_candidate.employee_id is null or v_candidate.effective_end <= v_local_time then
        continue;
      end if;

      v_load_key := v_candidate.employee_id::text;
      v_loads := jsonb_set(
        v_loads,
        array[v_load_key],
        to_jsonb(coalesce((v_loads ->> v_load_key)::int, 0) + 1),
        true
      );

      if v_candidate.employee_id = p_employee_id then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'name', rec.group_name,
          'group_code', rec.group_code,
          'coverage_purpose', rec.coverage_purpose,
          'coverage_start', to_char(greatest(v_cutover, coalesce(rec.owner_shift_end, v_local_time)), 'HH12:MI AM'),
          'coverage_end', case when v_candidate.effective_end = time '23:59:59' then 'Close' else to_char(v_candidate.effective_end, 'HH12:MI AM') end,
          'is_public_restroom', rec.is_public_restroom,
          'is_schedule_only_reminder', false
        ));
      end if;
    end loop;
  end if;

  if v_local_time >= v_cutover and v_active_count = 1 and v_employee_active_now and jsonb_array_length(coalesce(v_items, '[]'::jsonb)) > 0 then
    select greatest(
      v_cutover,
      coalesce(max(r.shift_end), v_local_time)
    )
      into v_single_remaining_start
    from public.daily_work_roster r
    where r.service_date = p_service_date
      and r.active = true
      and r.employee_id <> p_employee_id
      and r.shift_start < v_close_time
      and r.shift_end <= v_local_time;

    v_items := jsonb_build_array(jsonb_build_object(
      'name', 'All Locations',
      'group_code', 'ALL_LOCATIONS',
      'coverage_purpose', case when coalesce(v_employee.employee_code, '') = 'EMP002' then 'late_coverage' else 'area_owner' end,
      'coverage_start', to_char(coalesce(v_single_remaining_start, greatest(v_cutover, v_local_time)), 'HH12:MI AM'),
      'coverage_end', case
        when least(coalesce(v_shift.shift_end, v_close_time), v_close_time) = time '23:59:59' then 'Close'
        else to_char(least(coalesce(v_shift.shift_end, v_close_time), v_close_time), 'HH12:MI AM')
      end,
      'is_public_restroom', false,
      'is_schedule_only_reminder', false
    ));
  end if;

  select coalesce(jsonb_agg(item order by
    case coalesce(item->>'coverage_purpose', 'area_owner')
      when 'lunch_coverage' then 2
      when 'late_coverage' then 3
      else 1
    end,
    case when coalesce((item->>'is_public_restroom')::boolean, false) then 0 else 1 end,
    coalesce(item->>'name', '')
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) item;

  return jsonb_build_object(
    'ok', true,
    'service_date', p_service_date,
    'as_of_time', to_char(v_local_time, 'HH12:MI AM'),
    'phase', case when v_local_time < v_cutover then 'morning' else 'current' end,
    'employee', jsonb_build_object(
      'employee_id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'role', v_employee.role
    ),
    'shift', case when v_shift.shift_start is null then null else jsonb_build_object(
      'start', to_char(v_shift.shift_start, 'HH12:MI AM'),
      'end', case when v_shift.shift_end = time '23:59:59' then 'Close' else to_char(v_shift.shift_end, 'HH12:MI AM') end
    ) end,
    'has_945_change', v_has_945_change,
    'notice', v_future_notice,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;
