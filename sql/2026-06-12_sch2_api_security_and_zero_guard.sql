-- SCH2 API/RPC execution hardening and fail-closed preview guards.
-- Root cause: API-side RPC execution can hit RLS on source lookup tables
-- (notably employees/location_groups), producing zero-item previews that
-- previously looked preview_ready. These functions now run with the migration
-- owner's privileges, fixed search_path, and explicit row-count guards.

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

  return v_result;
end;
$function$;

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
  ), load_summary as (
    select
      dsa.assigned_employee_id as employee_id,
      count(*) filter (where dsa.status = 'ASSIGNED')::numeric as assigned_segments,
      coalesce(sum(dsa.load_points) filter (where dsa.status = 'ASSIGNED'), 0)::numeric as assigned_load_points
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id is not null
    group by dsa.assigned_employee_id
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
      coalesce(ls.assigned_load_points, 0) as assigned_load_points,
      coalesce(ls.assigned_segments, 0) as assigned_segments,
      public.sch_is_employee_location_group_restricted(r.employee_id, wi.location_group_id, extract(dow from p_service_date)::integer) as is_restricted,
      (r.shift_start < wi.coverage_end and r.shift_end > wi.coverage_start) as shift_overlaps,
      lw.lunch_start,
      lw.lunch_end,
      coalesce(public.sch_employee_route_fit_score(r.employee_id, extract(dow from p_service_date)::integer, wi.location_group_id, wi.coverage_purpose), 0)::numeric as route_penalty
    from public.schedule_work_items wi
    cross join roster r
    left join load_summary ls on ls.employee_id = r.employee_id
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

  with ranked as (
    select
      c.*,
      wi.original_assigned_employee_id,
      row_number() over (
        partition by c.work_item_id
        order by
          case when c.employee_id = wi.original_assigned_employee_id then 1 else 0 end desc,
          c.total_score desc,
          c.employee_id
      ) as rn
    from public.schedule_candidate_scores c
    join public.schedule_work_items wi on wi.id = c.work_item_id
    where c.run_id = v_run_id
      and c.eligible = true
  ), chosen as (
    select * from ranked where rn = 1
  ), final_rows as (
    select
      wi.*,
      case
        when wi.required then ch.employee_id
        else wi.original_assigned_employee_id
      end as final_employee_id,
      ch.total_score,
      ch.proximity_score,
      ch.route_fit_score,
      ch.workload_score,
      ch.hard_reject_reasons
    from public.schedule_work_items wi
    left join chosen ch on ch.work_item_id = wi.id
    where wi.run_id = v_run_id
  )
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
    fr.run_id,
    fr.id,
    fr.service_date,
    fr.location_group_id,
    fr.segment_number,
    fr.final_employee_id,
    case when fr.final_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
    fr.coverage_start,
    fr.coverage_end,
    fr.coverage_purpose,
    case when fr.final_employee_id is null then 'OPEN' else 'ASSIGNED' end,
    'sch2_preview',
    fr.source_daily_assignment_id,
    fr.load_points,
    case
      when fr.required and fr.final_employee_id is null then 'no_eligible_candidate_required_open'
      when fr.required and fr.final_employee_id = fr.original_assigned_employee_id then 'kept_existing_owner'
      when fr.required then 'selected_best_candidate'
      else 'preserved_non_required_preview_item'
    end,
    coalesce(fr.total_score, 0),
    jsonb_build_object(
      'total_score', coalesce(fr.total_score, 0),
      'proximity_score', coalesce(fr.proximity_score, 0),
      'route_fit_score', coalesce(fr.route_fit_score, 0),
      'workload_score', coalesce(fr.workload_score, 0),
      'hard_reject_reasons', coalesce(to_jsonb(fr.hard_reject_reasons), '[]'::jsonb)
    ),
    concat_ws(' | ', nullif(fr.notes, ''), 'SCH2 preview')
  from final_rows fr;

  get diagnostics v_solution_count = row_count;

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
begin
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

create or replace function public.sch2_rollback_publish(p_publish_audit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_audit public.schedule_publish_audit%rowtype;
  v_restored integer := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception 'SCH2 rollback requires service_role backend execution';
  end if;

  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_audit
  from public.schedule_publish_audit
  where id = p_publish_audit_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'publish audit row not found', 'publish_audit_id', p_publish_audit_id);
  end if;

  if v_audit.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'publish audit row is not in published status', 'publish_audit_id', p_publish_audit_id, 'status', v_audit.status);
  end if;

  delete from public.daily_schedule_assignments
   where service_date = v_audit.service_date;

  insert into public.daily_schedule_assignments (
    id,
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
    created_at,
    updated_at,
    coverage_purpose
  )
  select
    coalesce(x.id, gen_random_uuid()),
    coalesce(x.service_date, v_audit.service_date),
    x.location_group_id,
    coalesce(x.segment_number, 1),
    x.assigned_employee_id,
    coalesce(x.owner_type, case when x.assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end),
    x.coverage_start,
    x.coverage_end,
    coalesce(x.status, case when x.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end),
    coalesce(x.load_points, 0),
    x.notes,
    coalesce(x.source_type, 'sch2_rollback'),
    coalesce(x.created_at, now()),
    now(),
    coalesce(x.coverage_purpose, 'area_owner')
  from jsonb_to_recordset(v_audit.previous_rows) as x(
    id uuid,
    service_date date,
    location_group_id uuid,
    segment_number integer,
    assigned_employee_id uuid,
    owner_type text,
    coverage_start time,
    coverage_end time,
    status text,
    load_points numeric,
    notes text,
    source_type text,
    created_at timestamptz,
    updated_at timestamptz,
    coverage_purpose text
  );

  get diagnostics v_restored = row_count;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_audit.service_date;

  update public.schedule_publish_audit
     set status = 'rolled_back',
         rolled_back_at = now(),
         rollback_rows = v_rows
   where id = p_publish_audit_id;

  update public.schedule_generation_runs
     set status = 'rolled_back', updated_at = now()
   where id = v_audit.run_id;

  return jsonb_build_object(
    'ok', true,
    'publish_audit_id', p_publish_audit_id,
    'run_id', v_audit.run_id,
    'service_date', v_audit.service_date,
    'restored_rows', v_restored
  );
end;
$function$;

-- Keep direct helper execution tighter than the top-level preview route. The
-- top-level functions still enforce service_role for production mutation.
revoke execute on function public.sch2_build_work_items(date) from public, anon, authenticated;
grant execute on function public.sch2_build_work_items(date) to service_role;

grant execute on function public.sch2_generate_preview(date, boolean) to anon, authenticated, service_role;
grant execute on function public.sch2_audit_solution(uuid) to anon, authenticated, service_role;
revoke execute on function public.sch2_publish_solution(uuid, boolean) from public, anon, authenticated;
grant execute on function public.sch2_publish_solution(uuid, boolean) to service_role;
grant execute on function public.sch2_rollback_publish(uuid) to service_role;
