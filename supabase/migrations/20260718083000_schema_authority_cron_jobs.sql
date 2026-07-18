-- Reconstruct the six production cron records from source without changing
-- their active/inactive policy. cron.schedule(name, ...) updates an existing
-- named job or creates it, so this migration is idempotent and data-preserving.

do $cron_authority$
begin
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron with cron.schedule(text,text,text) is required';
  end if;

  perform cron.schedule('mz-free-tier-retention-daily','20 3 * * *','select public.mz_apply_free_tier_retention();');
  perform cron.schedule('mz-message-cleanup-deleted-hourly','18 * * * *','select public.msg_cleanup_deleted_messages();');
  perform cron.schedule('mz-message-hidden-threads-hourly','19 * * * *','select public.msg_purge_fully_hidden_threads();');
  perform cron.schedule('mz-message-purge-old-hourly','17 * * * *','select public.msg_purge_messages_older_than_14_days();');
  perform cron.schedule('mz-rolling-schedule-window-ready','*/30 * * * *','select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, ''scheduled_rolling_window_readiness'');');
  perform cron.schedule('mz-stale-sessions-hourly','5 * * * *','select public.expire_stale_open_sessions();');

  update cron.job
  set active = jobname in ('mz-rolling-schedule-window-ready','mz-stale-sessions-hourly'),
      database = 'postgres',
      username = 'postgres'
  where jobname in (
    'mz-free-tier-retention-daily',
    'mz-message-cleanup-deleted-hourly',
    'mz-message-hidden-threads-hourly',
    'mz-message-purge-old-hourly',
    'mz-rolling-schedule-window-ready',
    'mz-stale-sessions-hourly'
  );
end
$cron_authority$;
