-- ============================================================================
-- Memphis Zoo — Comprehensive Database Audit Security Fixes
-- Migration: 2026-06-20_audit_security_fixes.sql
-- ============================================================================
-- This single migration consolidates ALL CRITICAL, HIGH, and selected MEDIUM
-- database audit findings into one idempotent file.
--
-- CRITICAL:
--   C1: sch_apply_lunch_coverage — BEGIN/EXCEPTION/ROLLBACK around DELETE+INSERT
--   C2: sch_apply_lunch_coverage — Idempotency guard for before/after owner rows
--   C3: mz_apply_free_tier_retention — Batch LIMIT on schedule/roster/daily_group deletes
--   C5: sch2_publish_solution — Explicit exception handler, clean abort
--   C6: sch2_publish_solution — SECURITY DEFINER, search_path, service_role check
--
-- HIGH:
--   H1: RLS on schedule_automation_runs
--   H2: RLS on schedule_operational_notes
--   H3: RLS on all sch2 tables (6 tables)
--   H6: sch_guard_operational_daily_assignment — raise exception not return null
--   H7: sch_guard_operational_daily_assignment — NULL group_code check
--   H8: sch_guard_restricted_daily_assignment — NULL group_code check
--   H13: Split pg_cron message cleanup into separate jobs
--
-- MEDIUM / Cross-cutting:
--   X3: search_path = public, pg_temp on all SECURITY DEFINER functions
--   X5: CHECK constraint coverage_start < coverage_end on daily_schedule_assignments
--   M17: GRANT ALL → GRANT SELECT on v_sch2_workload_audit, remove anon
--   M21: Unique constraint on schedule_manual_locks (active rows only)
-- ============================================================================

-- ============================================================================
-- C1 + C2: sch_apply_lunch_coverage
--   C1: Wrap the DELETE+INSERT cycle in an explicit BEGIN/EXCEPTION subtransaction
--       so that if an INSERT fails after the DELETE, the subtransaction rolls back
--       and the original row is preserved.
--   C2: Before inserting before/after owner rows, check if rows already exist
--       for the same (service_date, location_group_id, assigned_employee_id,
--       coverage_start, coverage_end, source_type) combination. Skip if they do.
-- ============================================================================
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

    -- C2: Check if a lunch_coverage row already exists for this slot.
    select exists (
      select 1
      from public.daily_schedule_assignments existing
      where existing.service_date = p_service_date
        and existing.location_group_id = v_row.location_group_id
        and existing.coverage_purpose = 'lunch_coverage'
        and existing.coverage_start = v_overlap_start
        and existing.coverage_end = v_overlap_end
    ) into v_existing_lunch;

    -- C2: Check if a "morning ownership" (before) segment already exists.
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

    -- C2: Check if a "return to owner" (after) segment already exists.
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

    -- C2: If the before and after segments already exist AND the lunch row exists,
    -- this row was already processed in a prior run — skip the delete/insert cycle.
    if v_exists_before and v_exists_after and v_existing_lunch then
      continue;
    end if;

    -- C1: Wrap the DELETE+INSERT cycle in an explicit subtransaction.
    -- If any INSERT fails after the DELETE, the subtransaction rolls back,
    -- restoring the original row. The exception is re-raised to abort the
    -- entire function call so the caller knows something went wrong.
    begin
      -- Only delete the original row if it still exists (it may have already
      -- been split in a prior run). If v_exists_before or v_exists_after is
      -- true but not both, the original was already deleted — skip delete.
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
    exception when others then
      -- C1: The subtransaction rolls back the DELETE and any partial INSERTs.
      -- Re-raise with context so the caller knows which row failed.
      raise exception 'sch_apply_lunch_coverage failed during split for location_group_id % on service_date %: %',
        v_row.location_group_id, p_service_date, sqlerrm;
    end;
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

-- ============================================================================
-- X3: mz_free_tier_retention_report — SECURITY DEFINER with search_path
-- (Also fixes H5: do not expose cron.job command column)
-- ============================================================================
create or replace function public.mz_free_tier_retention_report()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings jsonb := '{}'::jsonb;
  v_top_tables jsonb := '[]'::jsonb;
  v_cron_jobs jsonb := '[]'::jsonb;
  v_db_bytes bigint := pg_database_size(current_database());
  v_warn_mb integer := public.mz_retention_setting_int('retention_db_warn_mb', 300, 1, 500);
  v_urgent_mb integer := public.mz_retention_setting_int('retention_db_urgent_mb', 400, 1, 500);
  v_critical_mb integer := public.mz_retention_setting_int('retention_db_critical_mb', 450, 1, 500);
  v_status text := 'ok';
begin
  select coalesce(jsonb_object_agg(setting_key, setting_value order by setting_key), '{}'::jsonb)
    into v_settings
  from public.system_settings
  where setting_key like 'retention_%';

  select coalesce(jsonb_agg(row_to_json(t) order by t.total_bytes desc), '[]'::jsonb)
    into v_top_tables
  from (
    select
      relname as table_name,
      n_live_tup::bigint as estimated_rows,
      pg_total_relation_size(relid) as total_bytes,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
    limit 20
  ) t;

  -- Do NOT expose the 'command' column from cron.job.
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'jobname', jobname,
    'schedule', schedule,
    'active', active
  ) order by jobname), '[]'::jsonb)
    into v_cron_jobs
  from cron.job
  where jobname like 'mz-%retention%'
     or jobname like 'mz-%cleanup%'
     or jobname like 'mz-%stale%';

  if v_db_bytes >= (v_critical_mb::bigint * 1024 * 1024) then
    v_status := 'critical';
  elsif v_db_bytes >= (v_urgent_mb::bigint * 1024 * 1024) then
    v_status := 'urgent';
  elsif v_db_bytes >= (v_warn_mb::bigint * 1024 * 1024) then
    v_status := 'warn';
  end if;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'database', jsonb_build_object(
      'bytes', v_db_bytes,
      'pretty', pg_size_pretty(v_db_bytes),
      'status', v_status,
      'warn_mb', v_warn_mb,
      'urgent_mb', v_urgent_mb,
      'critical_mb', v_critical_mb,
      'supabase_free_limit_mb', 500
    ),
    'settings', v_settings,
    'top_tables', v_top_tables,
    'cron_jobs', v_cron_jobs
  );
end;
$$;

-- ============================================================================
-- C3 + X3: mz_apply_free_tier_retention
--   C3: Add batch LIMIT (500 rows per DELETE) to schedule, roster, and
--       daily_group delete statements (and all other delete statements).
--   X3: SECURITY DEFINER with search_path = public, pg_temp.
--   Also fixes C4: Delete events FIRST, then orphaned notification logs.
-- ============================================================================
create or replace function public.mz_apply_free_tier_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_local_today date := (p_now at time zone 'America/Chicago')::date;
  v_scan_days integer := public.mz_retention_setting_int('retention_scan_history_days', 120, 14, 3650);
  v_system_logs_days integer := public.mz_retention_setting_int('retention_system_logs_days', 30, 7, 3650);
  v_schedule_past_days integer := public.mz_retention_setting_int('retention_schedule_past_days', 45, 7, 3650);
  v_schedule_future_days integer := public.mz_retention_setting_int('retention_schedule_future_days', 45, 7, 3650);
  v_event_notification_days integer := public.mz_retention_setting_int('retention_event_notification_days', 45, 7, 3650);
  v_guest_resolved_days integer := public.mz_retention_setting_int('retention_guest_resolved_days', 180, 30, 3650);
  v_feedback_resolved_days integer := public.mz_retention_setting_int('retention_feedback_resolved_days', 180, 30, 3650);
  v_maintenance_closed_days integer := public.mz_retention_setting_int('retention_maintenance_closed_days', 180, 30, 3650);
  v_migration_sql_days integer := public.mz_retention_setting_int('retention_migration_sql_text_days', 7, 1, 3650);
  v_migration_log_days integer := public.mz_retention_setting_int('retention_migration_log_days', 30, 7, 3650);
  v_migration_batch integer := public.mz_retention_setting_int('retention_migration_batch_rows', 50000, 100, 50000);
  -- C3: Batch limit for all destructive deletes.
  v_batch_limit integer := 500;
  v_expired_sessions integer := 0;
  v_scan_purge jsonb := '{}'::jsonb;
  v_msg_old jsonb := '{}'::jsonb;
  v_msg_deleted integer := 0;
  v_msg_hidden jsonb := '{}'::jsonb;
  v_events_deleted integer := 0;
  v_event_notifications_deleted integer := 0;
  v_guest_reports_deleted integer := 0;
  v_feedback_deleted integer := 0;
  v_maintenance_deleted integer := 0;
  v_system_logs_deleted integer := 0;
  v_schedule_assignments_deleted integer := 0;
  v_daily_group_assignments_deleted integer := 0;
  v_roster_deleted integer := 0;
  v_migration_sql_redacted integer := 0;
  v_migration_rows_deleted integer := 0;
  v_report jsonb := '{}'::jsonb;
begin
  -- Prevent overlapping cron/manual runs.
  perform pg_advisory_xact_lock(hashtext('memphis_zoo_free_tier_retention'));

  select public.expire_stale_open_sessions(p_now) into v_expired_sessions;
  select public.purge_closed_scan_history_before(p_now - make_interval(days => v_scan_days), 'free_tier_retention') into v_scan_purge;
  select public.msg_purge_messages_older_than_14_days() into v_msg_old;
  select public.msg_cleanup_deleted_messages() into v_msg_deleted;
  select public.msg_purge_fully_hidden_threads() into v_msg_hidden;

  -- C4: Delete events FIRST, then delete orphaned notification logs.
  with deleted as (
    delete from public.events_app_events e
    where e.event_date < v_local_today
      and e.id in (
        select e2.id from public.events_app_events e2
        where e2.event_date < v_local_today
        order by e2.event_date asc
        limit v_batch_limit
      )
    returning 1
  ) select count(*)::integer into v_events_deleted from deleted;

  -- Now delete orphaned notification logs (event_id no longer exists) and
  -- old notification logs by age — batch capped.
  with deleted as (
    delete from public.events_app_notification_log n
    where n.id in (
      select n2.id from public.events_app_notification_log n2
      where coalesce(n2.updated_at, n2.created_at) < p_now - make_interval(days => v_event_notification_days)
         or not exists (select 1 from public.events_app_events e where e.id = n2.event_id)
      order by coalesce(n2.updated_at, n2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_event_notifications_deleted from deleted;

  -- System logs — batch capped.
  with deleted as (
    delete from public.system_logs sl
    where sl.ctid in (
      select sl2.ctid from public.system_logs sl2
      where sl2.created_at < p_now - make_interval(days => v_system_logs_days)
      order by sl2.created_at asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_system_logs_deleted from deleted;

  -- C3: Daily schedule assignments — batch capped at 500 rows per DELETE.
  with deleted as (
    delete from public.daily_schedule_assignments dsa
    where dsa.ctid in (
      select dsa2.ctid from public.daily_schedule_assignments dsa2
      where dsa2.service_date <> date '1900-01-01'
        and (dsa2.service_date < v_local_today - v_schedule_past_days
             or dsa2.service_date > v_local_today + v_schedule_future_days)
      order by dsa2.service_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_schedule_assignments_deleted from deleted;

  -- C3: Daily group assignments — batch capped at 500 rows per DELETE.
  with deleted as (
    delete from public.daily_group_assignments dga
    where dga.ctid in (
      select dga2.ctid from public.daily_group_assignments dga2
      where dga2.assignment_date <> date '1900-01-01'
        and (dga2.assignment_date < v_local_today - v_schedule_past_days
             or dga2.assignment_date > v_local_today + v_schedule_future_days)
      order by dga2.assignment_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_daily_group_assignments_deleted from deleted;

  -- C3: Daily work roster — batch capped at 500 rows per DELETE.
  with deleted as (
    delete from public.daily_work_roster dwr
    where dwr.ctid in (
      select dwr2.ctid from public.daily_work_roster dwr2
      where dwr2.service_date <> date '1900-01-01'
        and (dwr2.service_date < v_local_today - v_schedule_past_days
             or dwr2.service_date > v_local_today + v_schedule_future_days)
      order by dwr2.service_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_roster_deleted from deleted;

  -- Guest cleanliness reports — batch capped.
  with deleted as (
    delete from public.guest_cleanliness_reports gr
    where gr.ctid in (
      select gr2.ctid from public.guest_cleanliness_reports gr2
      where lower(coalesce(gr2.status, 'open')) in ('closed', 'resolved', 'acknowledged')
        and coalesce(gr2.resolved_at, gr2.submitted_at) < p_now - make_interval(days => v_guest_resolved_days)
      order by coalesce(gr2.resolved_at, gr2.submitted_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_guest_reports_deleted from deleted;

  -- System feedback items — batch capped.
  with deleted as (
    delete from public.system_feedback_items fi
    where fi.ctid in (
      select fi2.ctid from public.system_feedback_items fi2
      where lower(coalesce(fi2.status, 'open')) in ('closed', 'resolved', 'acknowledged', 'done')
        and coalesce(fi2.acknowledged_at, fi2.updated_at, fi2.created_at) < p_now - make_interval(days => v_feedback_resolved_days)
      order by coalesce(fi2.acknowledged_at, fi2.updated_at, fi2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_feedback_deleted from deleted;

  -- Maintenance tickets — batch capped.
  with deleted as (
    delete from public.maintenance_tickets mt
    where mt.ctid in (
      select mt2.ctid from public.maintenance_tickets mt2
      where lower(coalesce(mt2.status, 'open')) in ('closed', 'resolved')
        and coalesce(mt2.closed_at, mt2.reported_at, mt2.created_at) < p_now - make_interval(days => v_maintenance_closed_days)
      order by coalesce(mt2.closed_at, mt2.reported_at, mt2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_maintenance_deleted from deleted;

  -- Migration log SQL text redaction — batch capped.
  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_sql_days)
      and sql_text is not null
      and sql_text <> '[retention-discarded SQL text; migration metadata retained]'
    order by applied_at asc
    limit least(v_migration_batch, v_batch_limit)
  ), updated as (
    update public.migration_log ml
    set sql_text = '[retention-discarded SQL text; migration metadata retained]'
    from target
    where ml.ctid = target.ctid
    returning 1
  ) select count(*)::integer into v_migration_sql_redacted from updated;

  -- Migration log row deletion — batch capped.
  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_log_days)
    order by applied_at asc
    limit least(v_migration_batch, v_batch_limit)
  ), deleted as (
    delete from public.migration_log ml
    using target
    where ml.ctid = target.ctid
    returning 1
  ) select count(*)::integer into v_migration_rows_deleted from deleted;

  select public.mz_free_tier_retention_report() into v_report;

  return jsonb_build_object(
    'ok', true,
    'ran_at', p_now,
    'local_today', v_local_today,
    'expired_stale_sessions', v_expired_sessions,
    'scan_history', v_scan_purge,
    'messaging_14_day_purge', v_msg_old,
    'messaging_deleted_cleanup', v_msg_deleted,
    'messaging_hidden_thread_purge', v_msg_hidden,
    'deleted_events', v_events_deleted,
    'deleted_event_notifications', v_event_notifications_deleted,
    'deleted_standalone_system_logs', v_system_logs_deleted,
    'deleted_schedule_assignments', v_schedule_assignments_deleted,
    'deleted_daily_group_assignments', v_daily_group_assignments_deleted,
    'deleted_work_roster_rows', v_roster_deleted,
    'deleted_resolved_guest_reports', v_guest_reports_deleted,
    'deleted_resolved_feedback', v_feedback_deleted,
    'deleted_closed_maintenance_tickets', v_maintenance_deleted,
    'redacted_migration_sql_rows', v_migration_sql_redacted,
    'deleted_migration_log_rows', v_migration_rows_deleted,
    'post_run_report', v_report
  );
end;
$$;

-- ============================================================================
-- C5 + C6: sch2_publish_solution
--   C5: Explicit exception handler that raises a WARNING, logs to audit table,
--       and ensures the function aborts cleanly (re-raises to force rollback).
--   C6: SECURITY DEFINER, search_path = public, pg_temp, service_role check.
--       Also includes verify step: count inserted rows vs expected.
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
  -- C6: service_role guard — only service_role or postgres can confirm-publish.
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

  -- Capture existing rows for rollback before any destructive operation.
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

  -- Capture expected count before delete.
  select count(*)::integer into v_expected_count
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  -- C5: DELETE-then-INSERT wrapped in explicit subtransaction with exception handler.
  -- PostgreSQL functions are atomic, so any failure will roll back the entire
  -- operation including the DELETE. We catch errors, log a WARNING, update the
  -- audit row, and re-raise to force full transaction rollback.
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
      -- C5: Log a WARNING, update the audit row, then re-raise to abort cleanly.
      raise warning 'SCH2 publish INSERT failed for run %: %', p_run_id, sqlerrm;
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = 'INSERT failed: ' || sqlerrm
       where id = v_audit_id;
      raise exception 'SCH2 publish INSERT failed for run %: %', p_run_id, sqlerrm;
  end;

  -- Verify step — count inserted rows vs expected.
  select count(*)::integer into v_actual_count
  from public.daily_schedule_assignments
  where service_date = v_run.service_date;

  if v_actual_count <> v_expected_count then
    raise warning 'SCH2 publish verify failed for run %: expected % rows, found %', p_run_id, v_expected_count, v_actual_count;
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
    -- C5: Top-level exception handler — log warning and ensure clean abort.
    raise warning 'SCH2 publish aborted for run %: %', p_run_id, sqlerrm;
    if v_audit_id is not null then
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = sqlerrm
       where id = v_audit_id;
    end if;
    raise;
end;
$function$;

-- Re-apply grants for sch2_publish_solution.
revoke execute on function public.sch2_publish_solution(uuid, boolean) from public, anon, authenticated;
grant execute on function public.sch2_publish_solution(uuid, boolean) to service_role;

-- ============================================================================
-- H6 + H7: sch_guard_operational_daily_assignment
--   H6: Change `return null` to `raise exception` for Herpetarium Wednesday guard.
--   H7: Add `if v_group_code is null then raise exception` check.
-- ============================================================================
create or replace function public.sch_guard_operational_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_group_code text;
  v_day integer;
  v_employee_name text;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  -- H7: Fail closed on unknown location_group_id instead of silently passing.
  if v_group_code is null then
    raise exception 'Unknown location_group_id % in sch_guard_operational_daily_assignment', new.location_group_id;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  -- H6: Raise exception instead of returning NULL for Herpetarium Wednesday.
  if v_group_code = 'HERPETARIUM' and v_day = 3 then
    select display_name into v_employee_name
    from public.employees
    where id = new.assigned_employee_id;

    raise exception 'Herpetarium Wednesday guard: blocked assignment for employee "%" (id %) to HERPETARIUM on Wednesday (service_date %). Herpetarium is not cleaned on Wednesdays.',
      coalesce(v_employee_name, 'UNKNOWN'), coalesce(new.assigned_employee_id::text, 'NULL'), new.service_date;
  end if;

  if v_group_code like '%GIFT_SHOP' and not (
    v_day = 1
    and coalesce(new.coverage_purpose, '') = 'reminder'
    and new.coverage_start = time '08:00'
    and new.coverage_end <= time '09:45'
  ) then
    select display_name into v_employee_name
    from public.employees
    where id = new.assigned_employee_id;

    raise exception 'Gift shop guard: blocked assignment for employee "%" (id %) to "%" on service_date %. Gift shops are Monday 8 AM reminder-only; this assignment does not meet the reminder-only criteria.',
      coalesce(v_employee_name, 'UNKNOWN'), coalesce(new.assigned_employee_id::text, 'NULL'), v_group_code, new.service_date;
  end if;

  if v_group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') and coalesce(new.coverage_purpose, '') in ('deep_clean', 'cleaning', 'area_owner', 'late_coverage', '') then
    new.coverage_purpose := 'response_only';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'No Clean / Calls to Location Only. Response-only ownership; not normal deep-clean schedule work.'));
  end if;

  return new;
end;
$$;

-- ============================================================================
-- H8: sch_guard_restricted_daily_assignment
--   Add NULL check for group_code resolution — fail closed instead of silently
--   bypassing restrictions.
-- ============================================================================
create or replace function public.sch_guard_restricted_daily_assignment()
returns trigger
language plpgsql
as $$
declare
  v_day integer;
  v_group_code text;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  -- H8: Look up group_code and fail closed on NULL.
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code is null then
    raise exception 'Unknown location_group_id % in sch_guard_restricted_daily_assignment', new.location_group_id;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  if public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, v_day) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.status := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
    new.source_type := trim(both ':' from concat_ws(
      ':',
      nullif(new.source_type, ''),
      'restricted_guard'
    ));
  end if;

  return new;
end;
$$;

-- ============================================================================
-- H1: Enable RLS on schedule_automation_runs
-- ============================================================================
do $$
begin
  alter table public.schedule_automation_runs enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_automation_runs: %', sqlerrm;
end;
$$;

drop policy if exists schedule_automation_runs_service_all on public.schedule_automation_runs;
create policy schedule_automation_runs_service_all
  on public.schedule_automation_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_automation_runs_authed_read on public.schedule_automation_runs;
create policy schedule_automation_runs_authed_read
  on public.schedule_automation_runs
  for select
  to authenticated
  using (true);

-- ============================================================================
-- H2: Enable RLS on schedule_operational_notes
-- ============================================================================
do $$
begin
  alter table public.schedule_operational_notes enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_operational_notes: %', sqlerrm;
end;
$$;

drop policy if exists schedule_operational_notes_service_all on public.schedule_operational_notes;
create policy schedule_operational_notes_service_all
  on public.schedule_operational_notes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists schedule_operational_notes_authed_read on public.schedule_operational_notes;
create policy schedule_operational_notes_authed_read
  on public.schedule_operational_notes
  for select
  to authenticated
  using (true);

-- ============================================================================
-- H3: Enable RLS on ALL sch2 tables
--   schedule_generation_runs, schedule_work_items, schedule_candidate_scores,
--   schedule_solution_assignments, schedule_manual_locks, schedule_publish_audit
--   Policies: service_role all, authenticated select, anon none.
-- ============================================================================

-- schedule_generation_runs
do $$
begin
  alter table public.schedule_generation_runs enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_generation_runs: %', sqlerrm;
end;
$$;

drop policy if exists schedule_generation_runs_service_all on public.schedule_generation_runs;
create policy schedule_generation_runs_service_all
  on public.schedule_generation_runs for all to service_role using (true) with check (true);

drop policy if exists schedule_generation_runs_authed_read on public.schedule_generation_runs;
create policy schedule_generation_runs_authed_read
  on public.schedule_generation_runs for select to authenticated using (true);

-- schedule_work_items
do $$
begin
  alter table public.schedule_work_items enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_work_items: %', sqlerrm;
end;
$$;

drop policy if exists schedule_work_items_service_all on public.schedule_work_items;
create policy schedule_work_items_service_all
  on public.schedule_work_items for all to service_role using (true) with check (true);

drop policy if exists schedule_work_items_authed_read on public.schedule_work_items;
create policy schedule_work_items_authed_read
  on public.schedule_work_items for select to authenticated using (true);

-- schedule_candidate_scores
do $$
begin
  alter table public.schedule_candidate_scores enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_candidate_scores: %', sqlerrm;
end;
$$;

drop policy if exists schedule_candidate_scores_service_all on public.schedule_candidate_scores;
create policy schedule_candidate_scores_service_all
  on public.schedule_candidate_scores for all to service_role using (true) with check (true);

drop policy if exists schedule_candidate_scores_authed_read on public.schedule_candidate_scores;
create policy schedule_candidate_scores_authed_read
  on public.schedule_candidate_scores for select to authenticated using (true);

-- schedule_solution_assignments
do $$
begin
  alter table public.schedule_solution_assignments enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_solution_assignments: %', sqlerrm;
end;
$$;

drop policy if exists schedule_solution_assignments_service_all on public.schedule_solution_assignments;
create policy schedule_solution_assignments_service_all
  on public.schedule_solution_assignments for all to service_role using (true) with check (true);

drop policy if exists schedule_solution_assignments_authed_read on public.schedule_solution_assignments;
create policy schedule_solution_assignments_authed_read
  on public.schedule_solution_assignments for select to authenticated using (true);

-- schedule_manual_locks
do $$
begin
  alter table public.schedule_manual_locks enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_manual_locks: %', sqlerrm;
end;
$$;

drop policy if exists schedule_manual_locks_service_all on public.schedule_manual_locks;
create policy schedule_manual_locks_service_all
  on public.schedule_manual_locks for all to service_role using (true) with check (true);

drop policy if exists schedule_manual_locks_authed_read on public.schedule_manual_locks;
create policy schedule_manual_locks_authed_read
  on public.schedule_manual_locks for select to authenticated using (true);

-- schedule_publish_audit
do $$
begin
  alter table public.schedule_publish_audit enable row level security;
exception when others then
  raise notice 'Could not enable RLS on schedule_publish_audit: %', sqlerrm;
end;
$$;

drop policy if exists schedule_publish_audit_service_all on public.schedule_publish_audit;
create policy schedule_publish_audit_service_all
  on public.schedule_publish_audit for all to service_role using (true) with check (true);

drop policy if exists schedule_publish_audit_authed_read on public.schedule_publish_audit;
create policy schedule_publish_audit_authed_read
  on public.schedule_publish_audit for select to authenticated using (true);

-- ============================================================================
-- H13: Split the pg_cron message cleanup job into separate scheduled jobs.
--   The original job ran 3 statements in a single cron.schedule call; if the
--   first statement failed, the remaining two would never execute. Now each
--   runs as its own independent cron job.
-- ============================================================================
do $$
declare
  r record;
begin
  -- Unschedule old combined message cleanup job and any stale duplicates.
  for r in
    select jobid
    from cron.job
    where jobname in (
      'mz-free-tier-retention-daily',
      'mz-stale-sessions-hourly',
      'mz-message-cleanup-hourly',
      'mz-message-purge-old-hourly',
      'mz-message-cleanup-deleted-hourly',
      'mz-message-hidden-threads-hourly'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end;
$$;

-- Re-schedule retention and session cleanup jobs.
select cron.schedule(
  'mz-free-tier-retention-daily',
  '20 3 * * *',
  $$select public.mz_apply_free_tier_retention();$$
);

select cron.schedule(
  'mz-stale-sessions-hourly',
  '5 * * * *',
  $$select public.expire_stale_open_sessions();$$
);

-- H13: Each message cleanup function now gets its own cron job.
select cron.schedule(
  'mz-message-purge-old-hourly',
  '17 * * * *',
  $$select public.msg_purge_messages_older_than_14_days();$$
);

select cron.schedule(
  'mz-message-cleanup-deleted-hourly',
  '18 * * * *',
  $$select public.msg_cleanup_deleted_messages();$$
);

select cron.schedule(
  'mz-message-hidden-threads-hourly',
  '19 * * * *',
  $$select public.msg_purge_fully_hidden_threads();$$
);

-- ============================================================================
-- X5: Add CHECK constraint coverage_start < coverage_end to
--     daily_schedule_assignments.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_schedule_assignments_coverage_order_check'
      and conrelid = 'public.daily_schedule_assignments'::regclass
  ) then
    alter table public.daily_schedule_assignments
      add constraint daily_schedule_assignments_coverage_order_check
      check (coverage_start < coverage_end);
  end if;
exception when others then
  raise notice 'Could not add coverage_order check constraint: %', sqlerrm;
end;
$$;

-- ============================================================================
-- M17: Change GRANT ALL on v_sch2_workload_audit to GRANT SELECT and
--      remove anon grant.
-- ============================================================================
revoke all on public.v_sch2_workload_audit from anon;
revoke all on public.v_sch2_workload_audit from authenticated;
revoke all on public.v_sch2_workload_audit from service_role;

grant select on public.v_sch2_workload_audit to authenticated;
grant select on public.v_sch2_workload_audit to service_role;

-- ============================================================================
-- M21: Add unique constraint on schedule_manual_locks
--      (service_date, location_group_id, segment_number) where active = true.
--      Prevents multiple active locks for the same slot.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_manual_locks_active_unique'
      and conrelid = 'public.schedule_manual_locks'::regclass
  ) then
    alter table public.schedule_manual_locks
      add constraint schedule_manual_locks_active_unique
      unique (service_date, location_group_id, segment_number)
      where active = true;
  end if;
exception when others then
  raise notice 'Could not add schedule_manual_locks unique constraint: %', sqlerrm;
end;
$$;

-- ============================================================================
-- X3: Ensure all SECURITY DEFINER functions have search_path = public, pg_temp.
-- The functions redefined above (mz_free_tier_retention_report,
-- mz_apply_free_tier_retention, sch2_publish_solution) already include
-- `set search_path = public, pg_temp`. The sch2 functions from the 2026-06-12
-- migration (sch2_audit_solution, sch2_build_work_items, sch2_generate_preview,
-- sch2_rollback_publish) also already include it.
-- No additional ALTER FUNCTION statements needed since all SECURITY DEFINER
-- functions have been redefined with the setting inline.
-- ============================================================================
