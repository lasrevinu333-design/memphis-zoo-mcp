-- C11 + C14 + H21 + H28: Retention batch caps, event/notification deletion order,
-- cron.job command column redaction, and pg_cron message cleanup split.
--
-- C11: Add LIMIT 5000 batch caps to ALL delete statements in
--      mz_apply_free_tier_retention (not just migration_log).
-- C14: Delete events FIRST, then delete orphaned notification logs
--      (where event_id no longer exists), rather than notifications first.
-- H21: Remove the 'command' column from mz_free_tier_retention_report output.
-- H28: Split the 3-statement cron job into 3 separate cron jobs.

-- ============================================================================
-- H21: Fix mz_free_tier_retention_report exposing cron.job command column.
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

  -- H21: Do NOT expose the 'command' column from cron.job.
  -- Only expose jobname, schedule, and active status.
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
-- C11 + C14: Rebuild mz_apply_free_tier_retention with batch caps and
--            corrected event/notification deletion order.
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
  v_batch_limit integer := 5000;
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

  -- C14: Delete events FIRST, then delete orphaned notification logs.
  -- This fixes the dependency order: events must be deleted before
  -- notification logs that reference them.
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
  -- old notification logs by age.
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

  -- Daily schedule assignments — batch capped.
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

  -- Daily group assignments — batch capped.
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

  -- Daily work roster — batch capped.
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

  -- Migration log SQL text redaction — already batch capped.
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

  -- Migration log row deletion — already batch capped.
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
-- H28: Split the 3-statement message cleanup cron job into 3 separate jobs.
-- The original job ran 3 statements in a single cron.schedule call; if the first
-- statement failed, the remaining two would never execute. Now each runs as its
-- own independent cron job.
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

-- H28: Each message cleanup function now gets its own cron job.
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
