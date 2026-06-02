-- Make lunch coverage incremental/idempotent instead of stopping when any lunch row exists.
-- This lets the 9:45 restroom rebalance add/move restroom rows and then safely fill any
-- lunch-coverage gaps created by the updated assignments.

CREATE OR REPLACE FUNCTION public.sch_apply_lunch_coverage(p_service_date date)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
declare
  v_row record;
  v_candidate record;
  v_lunch_start time;
  v_lunch_end time;
  v_overlap_start time;
  v_overlap_end time;
  v_split_rows integer := 0;
  v_lunch_rows integer := 0;
  v_open_rows integer := 0;
  v_before_after_rows integer := 0;
  v_next_segment integer;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  for v_row in
    select dsa.*, e.display_name as owner_name, lw.lunch_start, lw.lunch_end
    from public.daily_schedule_assignments dsa
    join public.employees e on e.id = dsa.assigned_employee_id
    join lateral public.sch_lunch_window_for_employee(p_service_date, dsa.assigned_employee_id) lw on true
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id is not null
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, '') <> 'lunch_coverage'
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

    v_candidate := null;

    select c.*
      into v_candidate
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

    delete from public.daily_schedule_assignments where id = v_row.id;
    v_split_rows := v_split_rows + 1;

    if v_row.coverage_start < v_overlap_start then
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
      v_candidate.employee_id,
      case when v_candidate.employee_id is null then 'OPEN' else 'EMPLOYEE' end,
      v_overlap_start,
      v_overlap_end,
      case when v_candidate.employee_id is null then 'OPEN' else 'ASSIGNED' end,
      v_row.load_points,
      case
        when v_candidate.employee_id is null then
          trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage needed for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. No available coverage candidate found.'))
        else
          trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. Cover: ' || v_candidate.employee_name || '. ' || coalesce(v_candidate.explanation, '')))
      end,
      case when v_candidate.employee_id is null then 'lunch_coverage_open' else 'lunch_coverage' end,
      'lunch_coverage'
    );
    v_lunch_rows := v_lunch_rows + 1;
    if v_candidate.employee_id is null then
      v_open_rows := v_open_rows + 1;
    end if;

    if v_overlap_end < v_row.coverage_end then
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
$function$;
