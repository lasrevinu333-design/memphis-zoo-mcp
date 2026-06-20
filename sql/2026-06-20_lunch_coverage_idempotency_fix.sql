-- C10: Fix sch_apply_lunch_coverage idempotency.
-- Problem: Running sch_apply_lunch_coverage twice on the same date can create
-- duplicate "Morning ownership until lunch" (lunch_split_before) and
-- "Return to owner after lunch" (lunch_split_after) rows because the function
-- deletes the original row and re-inserts the before/after segments every time
-- it encounters a lunch-overlapping assignment.
-- The lunch_coverage row itself already has an existence check (v_existing_lunch),
-- but the before/after owner segments do NOT.
--
-- Fix: Before inserting a 'morning ownership' or 'return to owner' segment,
-- check if one already exists for the same (service_date, location_group_id,
-- assigned_employee_id, coverage_start, coverage_end) combination.  If the row
-- already exists, skip the insert.  This makes the function safe to run multiple
-- times on the same date.

create or replace function public.sch_apply_lunch_coverage(p_service_date date)
returns jsonb
language plpgsql
as $$
declare
  v_row record;
  v_candidate_employee_id uuid;
  v_candidate_employee_name text;
  v_candidate_explanation text;
  v_lunch_start time;
  v_lunch_end time;
  v_overlap_start time;
  v_overlap_end time;
  v_split_rows integer := 0;
  v_lunch_rows integer := 0;
  v_open_rows integer := 0;
  v_before_after_rows integer := 0;
  v_next_segment integer;
  v_existing_lunch boolean := false;
  v_exists_before boolean := false;
  v_exists_after boolean := false;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  for v_row in
    select dsa.*, e.display_name as owner_name, lw.lunch_start, lw.lunch_end
    from public.daily_schedule_assignments dsa
    join public.employees e on e.id = dsa.assigned_employee_id
    join public.location_groups lg on lg.id = dsa.location_group_id
    join lateral public.sch_lunch_window_for_employee(p_service_date, dsa.assigned_employee_id) lw on true
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id is not null
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder', 'response_only')
      and lg.group_code not in ('PRIMATE_CANYON', 'CAT_COUNTRY')
      and lg.group_code not like '%GIFT_SHOP%'
      and dsa.coverage_start < lw.lunch_end
      and dsa.coverage_end > lw.lunch_start
      and dsa.coverage_start < dsa.coverage_end
    order by dsa.coverage_start, dsa.coverage_end, dsa.location_group_id, dsa.segment_number
  loop
    v_lunch_start := v_row.lunch_start;
    v_lunch_end := v_row.lunch_end;
    v_overlap_start := greatest(v_row.coverage_start, v_lunch_start);
    v_overlap_end := least(v_row.coverage_end, v_lunch_end);

    if v_overlap_start >= v_overlap_end then
      continue;
    end if;

    v_candidate_employee_id := null;
    v_candidate_employee_name := null;
    v_candidate_explanation := null;

    select c.employee_id, c.employee_name, c.explanation
      into v_candidate_employee_id, v_candidate_employee_name, v_candidate_explanation
    from public.sch_get_coverage_candidates(
      p_service_date,
      v_row.location_group_id,
      v_overlap_start,
      v_overlap_end
    ) c
    where c.employee_id <> v_row.assigned_employee_id
      and not exists (
        select 1
        from public.sch_lunch_window_for_employee(p_service_date, c.employee_id) clw
        where clw.lunch_start < v_overlap_end
          and clw.lunch_end > v_overlap_start
      )
    order by c.recommendation_score desc, c.employee_name asc
    limit 1;

    select exists (
      select 1
      from public.daily_schedule_assignments existing
      where existing.service_date = p_service_date
        and existing.location_group_id = v_row.location_group_id
        and existing.coverage_purpose = 'lunch_coverage'
        and existing.coverage_start = v_overlap_start
        and existing.coverage_end = v_overlap_end
    ) into v_existing_lunch;

    -- Check if a "morning ownership" (before) segment already exists.
    v_exists_before := false;
    if v_row.coverage_start < v_overlap_start then
      select exists (
        select 1
        from public.daily_schedule_assignments existing
        where existing.service_date = p_service_date
          and existing.location_group_id = v_row.location_group_id
          and existing.assigned_employee_id = v_row.assigned_employee_id
          and existing.coverage_start = v_row.coverage_start
          and existing.coverage_end = v_overlap_start
          and coalesce(existing.source_type, '') like '%lunch_split_before%'
      ) into v_exists_before;
    end if;

    -- Check if a "return to owner" (after) segment already exists.
    v_exists_after := false;
    if v_overlap_end < v_row.coverage_end then
      select exists (
        select 1
        from public.daily_schedule_assignments existing
        where existing.service_date = p_service_date
          and existing.location_group_id = v_row.location_group_id
          and existing.assigned_employee_id = v_row.assigned_employee_id
          and existing.coverage_start = v_overlap_end
          and existing.coverage_end = v_row.coverage_end
          and coalesce(existing.source_type, '') like '%lunch_split_after%'
      ) into v_exists_after;
    end if;

    -- If the before and after segments already exist AND the lunch row exists,
    -- this row was already processed in a prior run — skip the delete/insert cycle.
    if v_exists_before and v_exists_after and v_existing_lunch then
      continue;
    end if;

    -- Only delete the original row if it still exists (it may have already been
    -- split in a prior run and this is a re-process of the before/after segments).
    -- We check whether the current row's coverage still spans the lunch window.
    -- If v_exists_before or v_exists_after is true but not both, the original was
    -- already deleted in a prior run — skip delete.
    if not v_exists_before and not v_exists_after then
      delete from public.daily_schedule_assignments where id = v_row.id;
      v_split_rows := v_split_rows + 1;
    end if;

    if v_row.coverage_start < v_overlap_start and not v_exists_before then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_row.coverage_start, v_overlap_start, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Morning ownership until lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_before')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;

    if not v_existing_lunch then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date,
        v_row.location_group_id,
        v_next_segment,
        v_candidate_employee_id,
        case when v_candidate_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
        v_overlap_start,
        v_overlap_end,
        case when v_candidate_employee_id is null then 'OPEN' else 'ASSIGNED' end,
        v_row.load_points,
        case
          when v_candidate_employee_id is null then
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage needed for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. No available coverage candidate found.'))
          else
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. Cover: ' || v_candidate_employee_name || '. ' || coalesce(v_candidate_explanation, '')))
        end,
        case when v_candidate_employee_id is null then 'lunch_coverage_open' else 'lunch_coverage' end,
        'lunch_coverage'
      );
      v_lunch_rows := v_lunch_rows + 1;
      if v_candidate_employee_id is null then
        v_open_rows := v_open_rows + 1;
      end if;
    end if;

    if v_overlap_end < v_row.coverage_end and not v_exists_after then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_overlap_end, v_row.coverage_end, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Return to owner after lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_after')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;
  end loop;

  update public.daily_schedule_assignments
     set segment_number = segment_number + 100000,
         updated_at = now()
   where service_date = p_service_date;

  with renumbered as (
    select id,
           row_number() over (
             partition by service_date, location_group_id
             order by coverage_start, coverage_end,
               case coverage_purpose when 'lunch_coverage' then 1 else 0 end,
               created_at,
               id
           )::integer as new_segment_number
    from public.daily_schedule_assignments
    where service_date = p_service_date
  )
  update public.daily_schedule_assignments dsa
     set segment_number = r.new_segment_number,
         updated_at = now()
    from renumbered r
   where dsa.id = r.id;

  return jsonb_build_object(
    'service_date', p_service_date,
    'applied', v_split_rows > 0,
    'split_original_segments', v_split_rows,
    'lunch_coverage_rows', v_lunch_rows,
    'open_lunch_coverage_rows', v_open_rows,
    'owner_before_after_rows', v_before_after_rows
  );
end;
$$;
