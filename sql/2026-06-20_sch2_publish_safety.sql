-- C12 + C13 + H25-H27: SCH2 publish safety, service_role guard, and zero-guards.
--
-- C12: Fix sch2_publish_solution DELETE-then-INSERT safety.
--      Add explicit error handling and a verify step that counts inserted rows
--      vs expected and raises if mismatch.
-- C13: Fix sch2_publish_solution service_role guard.
--      Ensure SECURITY DEFINER, SET search_path, and role check.
-- H25: Add zero-work-item guard to sch2_build_work_items (raise if zero items).
-- H26: Add zero-candidate guard to sch2_generate_preview (raise if zero candidates).
-- H27: Add work_item_count/solution_count check to sch2_audit_solution.

-- ============================================================================
-- H27: Fix sch2_audit_solution to raise on count mismatch (not just set status).
-- ============================================================================
create or replace function public.sch2_audit_solution(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_hard integer := 0;
  v_open integer := 0;
  v_workload integer := 0;
  v_route integer := 0;
  v_score numeric := 0;
  v_work_items integer := 0;
  v_solutions integer := 0;
  v_result jsonb;
begin
  select count(*)::integer into v_hard
  from public.v_sch2_constraint_violations
  where run_id = p_run_id
    and severity = 'hard';

  select count(*)::integer into v_open
  from public.schedule_solution_assignments sa
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  where sa.run_id = p_run_id
    and wi.required = true
    and (sa.status <> 'ASSIGNED' or sa.assigned_employee_id is null);

  select count(*)::integer into v_workload
  from public.v_sch2_workload_audit
  where run_id = p_run_id
    and violation_type is not null;

  select count(*)::integer into v_route
  from public.v_sch2_route_audit
  where run_id = p_run_id
    and route_spread_violation = true;

  select coalesce(sum(score_total), 0)::numeric into v_score
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  select count(*)::integer into v_work_items
  from public.schedule_work_items
  where run_id = p_run_id;

  select count(*)::integer into v_solutions
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  v_result := jsonb_build_object(
    'ok', v_hard = 0 and v_open = 0 and v_work_items > 0 and v_solutions = v_work_items,
    'run_id', p_run_id,
    'hard_violation_count', v_hard,
    'open_required_count', v_open,
    'workload_warning_count', v_workload,
    'route_warning_count', v_route,
    'score_total', v_score,
    'work_item_count', v_work_items,
    'solution_assignment_count', v_solutions
  );

  update public.schedule_generation_runs
     set hard_violation_count = v_hard,
         open_required_count = v_open,
         score_total = v_score,
         audit_summary = v_result,
         status = case
          when v_work_items = 0 then 'preview_blocked'
          when v_solutions <> v_work_items then 'preview_blocked'
          when v_hard = 0 and v_open = 0 then 'preview_ready'
          else 'preview_blocked'
        end,
         updated_at = now()
   where id = p_run_id;

  -- H27: Raise if work_item_count and solution_count don't match.
  if v_work_items > 0 and v_solutions <> v_work_items then
    raise exception 'SCH2 audit count mismatch for run %: work_items=%, solution_assignments=%',
      p_run_id, v_work_items, v_solutions;
  end if;

  return v_result;
end;
$function$;

-- ============================================================================
-- H25: Fix sch2_build_work_items to raise if zero items inserted.
-- ============================================================================
create or replace function public.sch2_build_work_items(p_service_date date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run_id uuid;
  v_input_hash text;
  v_inserted integer := 0;
  v_daily_source_count integer := 0;
  v_template_source_count integer := 0;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  insert into public.schedule_generation_runs (
    service_date, generator_version, input_hash, status, mode, force
  ) values (
    p_service_date, 'sch2-preview-2026-06-11', v_input_hash, 'building_work_items', 'preview', false
  ) returning id into v_run_id;

  with has_daily as (
    select exists (
      select 1 from public.daily_schedule_assignments dsa where dsa.service_date = p_service_date
    ) as ok
  ), source_rows as (
    select
      dsa.id as source_daily_assignment_id,
      dsa.service_date,
      dsa.location_group_id,
      dsa.segment_number,
      dsa.assigned_employee_id,
      dsa.owner_type,
      dsa.coverage_start,
      dsa.coverage_end,
      dsa.coverage_purpose,
      dsa.status,
      dsa.load_points,
      dsa.source_type,
      dsa.notes
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date

    union all

    select
      null::uuid as source_daily_assignment_id,
      p_service_date as service_date,
      ct.location_group_id,
      ct.segment_number,
      ct.assigned_employee_id,
      ct.owner_type,
      ct.coverage_start,
      ct.coverage_end,
      ct.coverage_purpose,
      case when ct.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end as status,
      coalesce(public.sch_group_adjusted_load_points(ct.location_group_id), 1)::numeric as load_points,
      'coverage_template'::text as source_type,
      ct.notes
    from public.coverage_templates ct
    cross join has_daily hd
    where hd.ok = false
      and ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer
  ), enriched as (
    select
      sr.*,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(sr.location_group_id) as is_public_restroom
    from source_rows sr
    join public.location_groups lg on lg.id = sr.location_group_id
    where lg.active = true
  )
  insert into public.schedule_work_items (
    run_id,
    service_date,
    work_item_key,
    source_daily_assignment_id,
    location_group_id,
    segment_number,
    coverage_start,
    coverage_end,
    coverage_purpose,
    required,
    may_be_open,
    scan_required,
    is_public_restroom,
    route_zone,
    bundle_key,
    load_points,
    original_assigned_employee_id,
    original_owner_type,
    original_status,
    original_source_type,
    notes,
    hard_rule_tags
  )
  select
    v_run_id,
    e.service_date,
    concat_ws(':', e.location_group_id::text, e.segment_number::text, e.coverage_start::text, e.coverage_end::text, e.coverage_purpose) as work_item_key,
    e.source_daily_assignment_id,
    e.location_group_id,
    e.segment_number,
    e.coverage_start,
    e.coverage_end,
    e.coverage_purpose,
    not (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
      or (
        (e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP'))
        and extract(dow from e.service_date)::integer = 1
        and e.coverage_purpose = 'reminder'
        and e.coverage_start = time '08:00'
        and e.coverage_end <= time '09:45'
      )
    ) as required,
    (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    ) as may_be_open,
    not (e.coverage_purpose in ('reminder', 'response_only') or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')) as scan_required,
    e.is_public_restroom,
    case
      when e.group_code in ('EXPO', 'EXPO_RESTROOMS', 'AQUARIUM', 'KOMODOS', 'MEMMEX_RESTROOMS') then 'west'
      when e.group_code in ('TETON', 'TETON_RESTROOMS', 'NORTH_WEST_PASSAGE', 'NWP', 'EAST_END_RESTROOMS', 'EAST_END_BREAK_ROOM') then 'east'
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_event'
      when e.group_code in ('CAT_HOUSE_CAFE_RESTROOMS', 'CATHOUSE_CAFE_RESTROOMS', 'TROPICAL_BIRDS', 'HERPETARIUM') then 'central_east'
      else lower(regexp_replace(coalesce(split_part(e.group_code, '_', 1), 'unknown'), '[^a-zA-Z0-9]+', '_', 'g'))
    end as route_zone,
    case
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'BONOBOS_SPLASH_EVENT'
      else e.group_code
    end as bundle_key,
    coalesce(e.load_points, 0),
    e.assigned_employee_id,
    e.owner_type,
    e.status,
    e.source_type,
    e.notes,
    array_remove(array[
      case when e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') then 'response_only' end,
      case when e.group_code = 'HERPETARIUM' and extract(dow from e.service_date)::integer = 3 then 'herpetarium_wednesday' end,
      case when e.is_public_restroom then 'restroom' end,
      case when e.coverage_purpose = 'lunch_coverage' then 'lunch_coverage' end,
      case when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_splash_event_bundle' end,
      case when e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP') then 'gift_shop_reminder_only' end
    ]::text[], null)
  from enriched e;

  get diagnostics v_inserted = row_count;

  -- H25: Zero-work-item guard.
  if v_inserted = 0 then
    select count(*)::integer into v_daily_source_count
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date;

    select count(*)::integer into v_template_source_count
    from public.coverage_templates ct
    where ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer;

    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 build produced zero work items for %s; daily_source_rows=%s; template_source_rows=%s', p_service_date, v_daily_source_count, v_template_source_count),
           updated_at = now()
     where id = v_run_id;

    raise exception 'SCH2 build produced zero work items for %, daily_source_rows=%, template_source_rows=%',
      p_service_date, v_daily_source_count, v_template_source_count;
  end if;

  update public.schedule_generation_runs
     set status = 'work_items_ready', updated_at = now()
   where id = v_run_id;

  return v_run_id;
end;
$function$;

-- ============================================================================
-- H26: Fix sch2_generate_preview to raise if zero candidates generated.
-- ============================================================================
create or replace function public.sch2_generate_preview(p_service_date date, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run_id uuid;
  v_input_hash text;
  v_existing_run_id uuid;
  v_audit jsonb;
  v_diff jsonb;
  v_work_item_count integer := 0;
  v_candidate_count integer := 0;
  v_solution_count integer := 0;
  v_item record;
  v_choice record;
  v_target_required_load numeric := 0;
  v_target_required_location_count numeric := 0;
  v_final_employee_id uuid;
  v_final_total_score numeric := 0;
  v_final_proximity_score numeric := 0;
  v_final_route_fit_score numeric := 0;
  v_final_workload_score numeric := 0;
  v_final_hard_reject_reasons text[] := array[]::text[];
  v_final_current_solution_load numeric := 0;
  v_final_required_location_count integer := 0;
  v_final_target_load_gap_after numeric := 0;
  v_final_balanced_rank integer := null;
  v_assignment_reason text;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  if not coalesce(p_force, false) then
    select id into v_existing_run_id
    from public.schedule_generation_runs
    where service_date = p_service_date
      and input_hash = v_input_hash
      and status in ('preview_ready', 'preview_blocked')
    order by created_at desc
    limit 1;

    if v_existing_run_id is not null then
      v_audit := public.sch2_audit_solution(v_existing_run_id);
      v_diff := public.sch2_compare_current_vs_preview(v_existing_run_id);
      return jsonb_build_object(
        'ok', true,
        'reused', true,
        'run_id', v_existing_run_id,
        'service_date', p_service_date,
        'audit', v_audit,
        'diff', v_diff
      );
    end if;
  end if;

  v_run_id := public.sch2_build_work_items(p_service_date);

  select count(*)::integer into v_work_item_count
  from public.schedule_work_items
  where run_id = v_run_id;

  if v_work_item_count = 0 then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = 'SCH2 preview cannot continue: zero work items were generated',
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview cannot continue: zero work items were generated for %', p_service_date;
  end if;

  update public.schedule_generation_runs
     set force = coalesce(p_force, false), status = 'scoring_candidates', updated_at = now()
   where id = v_run_id;

  with roster as (
    select
      r.employee_id,
      e.display_name as employee_name,
      e.employee_code,
      r.shift_start,
      r.shift_end
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
  ), base as materialized (
    select
      wi.id as work_item_id,
      wi.run_id,
      r.employee_id,
      r.employee_name,
      r.employee_code,
      wi.location_group_id,
      wi.coverage_start,
      wi.coverage_end,
      wi.coverage_purpose,
      wi.original_assigned_employee_id,
      wi.required,
      0::numeric as assigned_load_points,
      0::numeric as assigned_segments,
      public.sch_is_employee_location_group_restricted(r.employee_id, wi.location_group_id, extract(dow from p_service_date)::integer) as is_restricted,
      (r.shift_start < wi.coverage_end and r.shift_end > wi.coverage_start) as shift_overlaps,
      lw.lunch_start,
      lw.lunch_end,
      coalesce(public.sch_employee_route_fit_score(r.employee_id, extract(dow from p_service_date)::integer, wi.location_group_id, wi.coverage_purpose), 0)::numeric as route_penalty
    from public.schedule_work_items wi
    cross join roster r
    left join lateral public.sch_lunch_window_for_employee(p_service_date, r.employee_id) lw on true
    where wi.run_id = v_run_id
  ), scored as materialized (
    select
      b.*,
      array_remove(array[
        case when b.is_restricted then 'restricted' end,
        case when not b.shift_overlaps then 'shift_no_overlap' end,
        case when b.employee_code = 'EMP002' and b.coverage_purpose <> 'late_coverage' then 'Michael_EMP002_not_regular_worker' end,
        case when b.coverage_purpose = 'lunch_coverage'
              and b.lunch_start is not null
              and b.lunch_end is not null
              and b.lunch_start < b.coverage_end
              and b.lunch_end > b.coverage_start then 'same_lunch_overlap' end
      ]::text[], null) as hard_reject_reasons,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as route_fit_score,
      greatest(0, 100 - (coalesce(b.assigned_load_points, 0) * 8) - (coalesce(b.assigned_segments, 0) * 4))::numeric as workload_score,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as proximity_score
    from base b
  )
  insert into public.schedule_candidate_scores (
    run_id,
    work_item_id,
    employee_id,
    eligible,
    hard_reject_reasons,
    proximity_score,
    route_fit_score,
    workload_score,
    total_score,
    explanation
  )
  select
    s.run_id,
    s.work_item_id,
    s.employee_id,
    cardinality(s.hard_reject_reasons) = 0,
    s.hard_reject_reasons,
    round(s.proximity_score, 2),
    round(s.route_fit_score, 2),
    round(s.workload_score, 2),
    round(((s.route_fit_score * 0.75) + (s.workload_score * 0.25))::numeric, 2),
    concat_ws('; ',
      'route_fit=' || round(s.route_fit_score, 2)::text,
      'workload=' || round(s.workload_score, 2)::text,
      'current_load=' || s.assigned_load_points::text,
      case when cardinality(s.hard_reject_reasons) > 0 then 'reject=' || array_to_string(s.hard_reject_reasons, ',') else 'eligible' end
    )
  from scored s;

  get diagnostics v_candidate_count = row_count;

  -- H26: Zero-candidate guard.
  if v_candidate_count = 0 then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 preview produced zero candidate scores for %s work items', v_work_item_count),
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview produced zero candidate scores for % work items on %', v_work_item_count, p_service_date;
  end if;

  update public.schedule_generation_runs
     set status = 'building_solution', updated_at = now()
   where id = v_run_id;

  with regular_roster as (
    select distinct r.employee_id
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
      and coalesce(e.employee_code, '') <> 'EMP002'
  ), employee_count as (
    select count(*)::numeric as n from regular_roster
  ), work_totals as (
    select
      coalesce(sum(wi.load_points) filter (where wi.required), 0)::numeric as required_load,
      count(distinct wi.location_group_id) filter (where wi.required)::numeric as required_locations
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
  )
  select
    coalesce(wt.required_load / nullif(ec.n, 0), 0)::numeric,
    coalesce(wt.required_locations / nullif(ec.n, 0), 0)::numeric
  into v_target_required_load, v_target_required_location_count
  from work_totals wt
  cross join employee_count ec;

  for v_item in
    select wi.*
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
      and wi.required = true
    order by
      wi.load_points desc,
      wi.is_public_restroom desc,
      wi.coverage_start,
      wi.bundle_key,
      wi.id
  loop
    with current_solution_load as (
      select
        c.employee_id,
        coalesce(sum(sa.load_points) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true), 0)::numeric as assigned_load_points,
        count(distinct sa.location_group_id) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true)::integer as required_location_count,
        coalesce(bool_or(sa.location_group_id = v_item.location_group_id) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true), false)::boolean as has_current_location_group
      from public.schedule_candidate_scores c
      left join public.schedule_solution_assignments sa
        on sa.run_id = c.run_id
       and sa.assigned_employee_id = c.employee_id
      left join public.schedule_work_items assigned_wi
        on assigned_wi.id = sa.work_item_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
      group by c.employee_id
    ), candidate_balance as (
      select
        c.*,
        coalesce(csl.assigned_load_points, 0)::numeric as current_solution_load,
        coalesce(csl.required_location_count, 0)::integer as current_required_location_count,
        (coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0))::numeric as projected_solution_load,
        (coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end)::integer as projected_required_location_count,
        abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load)::numeric as target_load_gap_after,
        abs((coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - v_target_required_location_count)::numeric as target_location_gap_after,
        greatest(
          0,
          100
            - ((abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load) / greatest(v_target_required_load, 1)) * 80)
            - ((abs((coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - v_target_required_location_count) / greatest(v_target_required_location_count, 1)) * 20)
            - ((greatest(0, (coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - (v_target_required_load * 1.20)) / greatest(v_target_required_load, 1)) * 100)
            - (greatest(0, (coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - (ceil(v_target_required_location_count)::integer + 1)) * 10)
        )::numeric as dynamic_workload_score
      from public.schedule_candidate_scores c
      join current_solution_load csl on csl.employee_id = c.employee_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
    ), candidate_rank_base as (
      select
        cb.*,
        min(cb.projected_solution_load) over () as min_projected_solution_load,
        min(cb.projected_required_location_count) over () as min_projected_required_location_count,
        round(((cb.route_fit_score * 0.75) + (cb.dynamic_workload_score * 0.25))::numeric, 2) as balanced_total_score
      from candidate_balance cb
    ), candidate_ranked as (
      select
        cb.*,
        row_number() over (
          order by
            case
              when cb.projected_solution_load > greatest(v_target_required_load * 1.20, coalesce(v_item.load_points, 0))
               and cb.min_projected_solution_load <= greatest(v_target_required_load * 1.20, coalesce(v_item.load_points, 0)) then 1
              else 0
            end asc,
            case
              when cb.projected_required_location_count > (ceil(v_target_required_location_count)::integer + 1)
               and cb.min_projected_required_location_count <= (ceil(v_target_required_location_count)::integer + 1) then 1
              else 0
            end asc,
            cb.balanced_total_score desc,
            cb.target_load_gap_after asc,
            cb.target_location_gap_after asc,
            cb.current_required_location_count asc,
            cb.current_solution_load asc,
            case when cb.employee_id = v_item.original_assigned_employee_id then 0 else 1 end,
            cb.employee_id
        )::integer as balanced_rank
      from candidate_rank_base cb
    )
    select * into v_choice
    from candidate_ranked
    order by balanced_rank asc
    limit 1;

    if not found then
      v_final_employee_id := null;
      v_final_total_score := 0;
      v_final_proximity_score := 0;
      v_final_route_fit_score := 0;
      v_final_workload_score := 0;
      v_final_hard_reject_reasons := array['no_eligible_candidate']::text[];
      v_final_current_solution_load := 0;
      v_final_required_location_count := 0;
      v_final_target_load_gap_after := 0;
      v_final_balanced_rank := null;
      v_assignment_reason := 'no_eligible_candidate_required_open';
    else
      v_final_employee_id := v_choice.employee_id;
      v_final_total_score := coalesce(v_choice.total_score, 0);
      v_final_proximity_score := coalesce(v_choice.proximity_score, 0);
      v_final_route_fit_score := coalesce(v_choice.route_fit_score, 0);
      v_final_workload_score := coalesce(v_choice.dynamic_workload_score, v_choice.workload_score, 0);
      v_final_hard_reject_reasons := coalesce(v_choice.hard_reject_reasons, array[]::text[]);
      v_final_current_solution_load := coalesce(v_choice.current_solution_load, 0);
      v_final_required_location_count := coalesce(v_choice.current_required_location_count, 0);
      v_final_target_load_gap_after := coalesce(v_choice.target_load_gap_after, 0);
      v_final_total_score := coalesce(v_choice.balanced_total_score, v_final_total_score);
      v_final_balanced_rank := v_choice.balanced_rank;
      v_assignment_reason := case
        when v_final_employee_id = v_item.original_assigned_employee_id then 'kept_existing_owner_after_fairness'
        else 'selected_fair_balanced_candidate'
      end;
    end if;

    insert into public.schedule_solution_assignments (
      run_id,
      work_item_id,
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      coverage_purpose,
      status,
      source_type,
      source_daily_assignment_id,
      load_points,
      assignment_reason,
      score_total,
      score_breakdown,
      notes
    ) values (
      v_item.run_id,
      v_item.id,
      v_item.service_date,
      v_item.location_group_id,
      v_item.segment_number,
      v_final_employee_id,
      case when v_final_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
      v_item.coverage_start,
      v_item.coverage_end,
      v_item.coverage_purpose,
      case when v_final_employee_id is null then 'OPEN' else 'ASSIGNED' end,
      'sch2_preview',
      v_item.source_daily_assignment_id,
      v_item.load_points,
      v_assignment_reason,
      v_final_total_score,
      jsonb_build_object(
        'total_score', v_final_total_score,
        'proximity_score', v_final_proximity_score,
        'route_fit_score', v_final_route_fit_score,
        'workload_score', v_final_workload_score,
        'target_required_load', v_target_required_load,
        'target_required_location_count', v_target_required_location_count,
        'current_solution_load', v_final_current_solution_load,
        'current_required_location_count', v_final_required_location_count,
        'target_load_gap_after', v_final_target_load_gap_after,
        'projected_solution_load', coalesce(v_choice.projected_solution_load, case when v_final_employee_id is null then 0 else v_final_current_solution_load + coalesce(v_item.load_points, 0) end),
        'projected_required_location_count', coalesce(v_choice.projected_required_location_count, v_final_required_location_count),
        'target_location_gap_after', coalesce(v_choice.target_location_gap_after, 0),
        'balanced_rank', v_final_balanced_rank,
        'hard_reject_reasons', coalesce(to_jsonb(v_final_hard_reject_reasons), '[]'::jsonb)
      ),
      concat_ws(' | ', nullif(v_item.notes, ''), 'SCH2 preview')
    );
  end loop;

  insert into public.schedule_solution_assignments (
    run_id,
    work_item_id,
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    coverage_purpose,
    status,
    source_type,
    source_daily_assignment_id,
    load_points,
    assignment_reason,
    score_total,
    score_breakdown,
    notes
  )
  select
    wi.run_id,
    wi.id,
    wi.service_date,
    wi.location_group_id,
    wi.segment_number,
    wi.original_assigned_employee_id,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
    wi.coverage_start,
    wi.coverage_end,
    wi.coverage_purpose,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end,
    'sch2_preview',
    wi.source_daily_assignment_id,
    wi.load_points,
    'preserved_non_required_preview_item',
    0,
    jsonb_build_object(
      'target_required_load', v_target_required_load,
      'target_required_location_count', v_target_required_location_count,
      'hard_reject_reasons', '[]'::jsonb
    ),
    concat_ws(' | ', nullif(wi.notes, ''), 'SCH2 preview')
  from public.schedule_work_items wi
  where wi.run_id = v_run_id
    and wi.required = false;

  select count(*)::integer into v_solution_count
  from public.schedule_solution_assignments
  where run_id = v_run_id;

  if v_solution_count <> v_work_item_count then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 preview solution count mismatch: work_items=%s, solution_assignments=%s', v_work_item_count, v_solution_count),
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview solution count mismatch for %: work_items=%, solution_assignments=%', p_service_date, v_work_item_count, v_solution_count;
  end if;

  v_audit := public.sch2_audit_solution(v_run_id);
  v_diff := public.sch2_compare_current_vs_preview(v_run_id);

  update public.schedule_generation_runs
     set diff_summary = v_diff, updated_at = now()
   where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'run_id', v_run_id,
    'service_date', p_service_date,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_run_id is not null then
      update public.schedule_generation_runs
         set status = 'preview_error', error_message = sqlerrm, updated_at = now()
       where id = v_run_id;
    end if;
    raise;
end;
$function$;

-- ============================================================================
-- C12 + C13: Fix sch2_publish_solution with service_role guard, explicit
--            transactional error handling, and verify step.
-- ============================================================================
create or replace function public.sch2_publish_solution(p_run_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run public.schedule_generation_runs%rowtype;
  v_audit jsonb;
  v_diff jsonb;
  v_audit_id uuid;
  v_previous_rows jsonb := '[]'::jsonb;
  v_published_rows jsonb := '[]'::jsonb;
  v_current_hash text;
  v_inserted integer := 0;
  v_expected_count integer := 0;
  v_actual_count integer := 0;
begin
  -- C13: service_role guard — already present but reinforced here.
  if coalesce(p_confirm, false)
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception 'SCH2 publish confirm requires service_role backend execution';
  end if;

  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_run
  from public.schedule_generation_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SCH2 run not found', 'run_id', p_run_id);
  end if;

  v_current_hash := public.sch2_input_hash(v_run.service_date);
  if v_current_hash is distinct from v_run.input_hash then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 preview is stale; regenerate before publishing',
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'preview_input_hash', v_run.input_hash,
      'current_input_hash', v_current_hash
    );
  end if;

  v_audit := public.sch2_audit_solution(p_run_id);
  if coalesce((v_audit->>'hard_violation_count')::integer, 0) > 0
     or coalesce((v_audit->>'open_required_count')::integer, 0) > 0
     or coalesce((v_audit->>'work_item_count')::integer, 0) = 0
     or coalesce((v_audit->>'solution_assignment_count')::integer, 0) = 0
     or coalesce((v_audit->>'solution_assignment_count')::integer, 0) <> coalesce((v_audit->>'work_item_count')::integer, 0) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 publish blocked by hard violations, required OPEN rows, empty preview, or preview row-count mismatch',
      'run_id', p_run_id,
      'audit', v_audit
    );
  end if;

  v_diff := public.sch2_compare_current_vs_preview(p_run_id);

  -- C12: Capture existing rows for rollback before any destructive operation.
  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_previous_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  insert into public.schedule_publish_audit (
    run_id,
    service_date,
    previous_rows,
    published_rows,
    diff_summary,
    published_by,
    status,
    published_at
  ) values (
    p_run_id,
    v_run.service_date,
    v_previous_rows,
    '[]'::jsonb,
    v_diff,
    current_user,
    case when coalesce(p_confirm, false) then 'publishing' else 'dry_run' end,
    now()
  ) returning id into v_audit_id;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'publish_audit_id', v_audit_id,
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'audit', v_audit,
      'diff', v_diff
    );
  end if;

  -- C12: Capture expected count before delete.
  select count(*)::integer into v_expected_count
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  -- C12: DELETE-then-INSERT with explicit error handling.
  -- PostgreSQL functions are atomic, so any failure will roll back the entire
  -- operation including the DELETE. We wrap in a sub-block to catch errors,
  -- log them to the audit row, and re-raise to force full rollback.
  begin
    delete from public.daily_schedule_assignments
     where service_date = v_run.service_date;

    insert into public.daily_schedule_assignments (
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      status,
      load_points,
      notes,
      source_type,
      coverage_purpose
    )
    select
      sa.service_date,
      sa.location_group_id,
      sa.segment_number,
      sa.assigned_employee_id,
      sa.owner_type,
      sa.coverage_start,
      sa.coverage_end,
      sa.status,
      sa.load_points,
      concat_ws(' | ', nullif(sa.notes, ''), 'Published by SCH2 run ' || p_run_id::text),
      'sch2_published',
      sa.coverage_purpose
    from public.schedule_solution_assignments sa
    where sa.run_id = p_run_id
    order by sa.coverage_start, sa.location_group_id, sa.segment_number;

    get diagnostics v_inserted = row_count;
  exception
    when others then
      -- C12: Log the error to the audit row, then re-raise to force rollback.
      -- The RAISE will abort the transaction, undoing the DELETE.
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = 'INSERT failed: ' || sqlerrm
       where id = v_audit_id;
      raise exception 'SCH2 publish INSERT failed for run %: %', p_run_id, sqlerrm;
  end;

  -- C12: Verify step — count inserted rows vs expected.
  select count(*)::integer into v_actual_count
  from public.daily_schedule_assignments
  where service_date = v_run.service_date;

  if v_actual_count <> v_expected_count then
    -- Row count mismatch — the data is in an inconsistent state.
    -- Raise to force full transaction rollback (including the DELETE).
    update public.schedule_publish_audit
       set status = 'publish_error',
           error_message = format('Row count mismatch: expected %s, actual %s', v_expected_count, v_actual_count)
     where id = v_audit_id;
    raise exception 'SCH2 publish verify failed for run %: expected % rows, found %',
      p_run_id, v_expected_count, v_actual_count;
  end if;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_published_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  update public.schedule_publish_audit
     set published_rows = v_published_rows,
         status = 'published',
         published_at = now()
   where id = v_audit_id;

  update public.schedule_generation_runs
     set status = 'published', published_at = now(), published_by = current_user, updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'publish_audit_id', v_audit_id,
    'run_id', p_run_id,
    'service_date', v_run.service_date,
    'inserted_rows', v_inserted,
    'expected_rows', v_expected_count,
    'verified_rows', v_actual_count,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_audit_id is not null then
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = sqlerrm
       where id = v_audit_id;
    end if;
    raise;
end;
$function$;

-- Re-apply grants from the original migration.
revoke execute on function public.sch2_build_work_items(date) from public, anon, authenticated;
grant execute on function public.sch2_build_work_items(date) to service_role;

grant execute on function public.sch2_generate_preview(date, boolean) to anon, authenticated, service_role;
grant execute on function public.sch2_audit_solution(uuid) to anon, authenticated, service_role;
revoke execute on function public.sch2_publish_solution(uuid, boolean) from public, anon, authenticated;
grant execute on function public.sch2_publish_solution(uuid, boolean) to service_role;
