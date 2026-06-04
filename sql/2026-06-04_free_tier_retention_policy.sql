-- Memphis Zoo free-tier retention controls
-- Goal: keep Supabase/Render/GitHub usage inside free-tier operating margins by
-- deleting low-value operational history while preserving live/open work, templates,
-- current schedules, and recent audit context.

insert into public.system_settings (setting_key, setting_value, description)
values
  ('retention_scan_history_days', to_jsonb(120), 'Keep closed scan sessions, scan events, completion responses, and tied system logs this many days.'),
  ('retention_message_days', to_jsonb(14), 'Keep Memphis Messenger message bodies this many days; old messages/empty threads are purged.'),
  ('retention_system_logs_days', to_jsonb(30), 'Keep standalone system log rows this many days.'),
  ('retention_schedule_past_days', to_jsonb(45), 'Keep generated daily schedule rows this many days in the past; timeless 1900-01-01 templates are preserved.'),
  ('retention_schedule_future_days', to_jsonb(45), 'Keep generated daily schedule rows this many days in the future.'),
  ('retention_event_notification_days', to_jsonb(45), 'Keep event notification log rows this many days.'),
  ('retention_guest_resolved_days', to_jsonb(180), 'Keep resolved guest cleanliness reports this many days; open reports are preserved.'),
  ('retention_feedback_resolved_days', to_jsonb(180), 'Keep acknowledged/resolved/closed program feedback this many days; open feedback is preserved.'),
  ('retention_maintenance_closed_days', to_jsonb(180), 'Keep closed maintenance tickets this many days; open tickets are preserved.'),
  ('retention_migration_sql_text_days', to_jsonb(7), 'Keep full migration SQL text this many days, then redact SQL text while retaining migration metadata.'),
  ('retention_migration_log_days', to_jsonb(30), 'Keep migration log metadata rows this many days.'),
  ('retention_migration_batch_rows', to_jsonb(50000), 'Maximum migration_log rows to redact/delete per retention run to avoid long locks.'),
  ('retention_db_warn_mb', to_jsonb(300), 'Database-size soft warning threshold in megabytes.'),
  ('retention_db_urgent_mb', to_jsonb(400), 'Database-size urgent warning threshold in megabytes.'),
  ('retention_db_critical_mb', to_jsonb(450), 'Database-size critical warning threshold in megabytes before Supabase free limit.')
on conflict (setting_key) do update set
  setting_value = excluded.setting_value,
  description = excluded.description,
  updated_at = now();

create or replace function public.mz_retention_setting_int(
  p_key text,
  p_default integer,
  p_min integer default 1,
  p_max integer default 1000000
)
returns integer
language plpgsql
stable
as $$
declare
  v_value integer;
begin
  v_value := public.get_setting_int(p_key, p_default);
  if v_value is null then
    v_value := p_default;
  end if;
  return greatest(p_min, least(p_max, v_value));
exception when others then
  return p_default;
end;
$$;

create or replace function public.mz_free_tier_retention_report()
returns jsonb
language plpgsql
security definer
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'jobname', jobname,
    'schedule', schedule,
    'active', active,
    'command', command
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

create or replace function public.mz_apply_free_tier_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
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

  with deleted as (
    delete from public.events_app_notification_log n
    where coalesce(n.updated_at, n.created_at) < p_now - make_interval(days => v_event_notification_days)
       or exists (
         select 1
         from public.events_app_events e
         where e.id = n.event_id
           and e.event_date < v_local_today
       )
       or not exists (select 1 from public.events_app_events e where e.id = n.event_id)
    returning 1
  ) select count(*)::integer into v_event_notifications_deleted from deleted;

  with deleted as (
    delete from public.events_app_events e
    where e.event_date < v_local_today
    returning 1
  ) select count(*)::integer into v_events_deleted from deleted;

  with deleted as (
    delete from public.system_logs sl
    where sl.created_at < p_now - make_interval(days => v_system_logs_days)
    returning 1
  ) select count(*)::integer into v_system_logs_deleted from deleted;

  with deleted as (
    delete from public.daily_schedule_assignments dsa
    where dsa.service_date <> date '1900-01-01'
      and (dsa.service_date < v_local_today - v_schedule_past_days
           or dsa.service_date > v_local_today + v_schedule_future_days)
    returning 1
  ) select count(*)::integer into v_schedule_assignments_deleted from deleted;

  with deleted as (
    delete from public.daily_group_assignments dga
    where dga.assignment_date <> date '1900-01-01'
      and (dga.assignment_date < v_local_today - v_schedule_past_days
           or dga.assignment_date > v_local_today + v_schedule_future_days)
    returning 1
  ) select count(*)::integer into v_daily_group_assignments_deleted from deleted;

  with deleted as (
    delete from public.daily_work_roster dwr
    where dwr.service_date <> date '1900-01-01'
      and (dwr.service_date < v_local_today - v_schedule_past_days
           or dwr.service_date > v_local_today + v_schedule_future_days)
    returning 1
  ) select count(*)::integer into v_roster_deleted from deleted;

  with deleted as (
    delete from public.guest_cleanliness_reports gr
    where lower(coalesce(gr.status, 'open')) in ('closed', 'resolved', 'acknowledged')
      and coalesce(gr.resolved_at, gr.submitted_at) < p_now - make_interval(days => v_guest_resolved_days)
    returning 1
  ) select count(*)::integer into v_guest_reports_deleted from deleted;

  with deleted as (
    delete from public.system_feedback_items fi
    where lower(coalesce(fi.status, 'open')) in ('closed', 'resolved', 'acknowledged', 'done')
      and coalesce(fi.acknowledged_at, fi.updated_at, fi.created_at) < p_now - make_interval(days => v_feedback_resolved_days)
    returning 1
  ) select count(*)::integer into v_feedback_deleted from deleted;

  with deleted as (
    delete from public.maintenance_tickets mt
    where lower(coalesce(mt.status, 'open')) in ('closed', 'resolved')
      and coalesce(mt.closed_at, mt.reported_at, mt.created_at) < p_now - make_interval(days => v_maintenance_closed_days)
    returning 1
  ) select count(*)::integer into v_maintenance_deleted from deleted;

  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_sql_days)
      and sql_text is not null
      and sql_text <> '[retention-discarded SQL text; migration metadata retained]'
    order by applied_at asc
    limit v_migration_batch
  ), updated as (
    update public.migration_log ml
    set sql_text = '[retention-discarded SQL text; migration metadata retained]'
    from target
    where ml.ctid = target.ctid
    returning 1
  ) select count(*)::integer into v_migration_sql_redacted from updated;

  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_log_days)
    order by applied_at asc
    limit v_migration_batch
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

do $$
declare
  r record;
begin
  for r in
    select jobid
    from cron.job
    where jobname in (
      'mz-free-tier-retention-daily',
      'mz-stale-sessions-hourly',
      'mz-message-cleanup-hourly'
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

select cron.schedule(
  'mz-message-cleanup-hourly',
  '17 * * * *',
  $$select public.msg_purge_messages_older_than_14_days(); select public.msg_cleanup_deleted_messages(); select public.msg_purge_fully_hidden_threads();$$
);
