-- Reconstruct the six production cron records from source without changing
-- their active/inactive policy. cron.schedule(name, ...) updates an existing
-- named job or creates it, so this migration is idempotent and data-preserving.

do $cron_authority$
begin
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron with cron.schedule(text,text,text) is required';
  end if;

  -- Use pg_cron's supported API rather than writing its extension-owned
  -- catalog directly. Hosted Supabase permits these functions but correctly
  -- denies UPDATE on cron.job to migration roles.
  perform cron.alter_job(cron.schedule('mz-free-tier-retention-daily','20 3 * * *','select public.mz_apply_free_tier_retention();'),'20 3 * * *','select public.mz_apply_free_tier_retention();','postgres','postgres',false);
  perform cron.alter_job(cron.schedule('mz-message-cleanup-deleted-hourly','18 * * * *','select public.msg_cleanup_deleted_messages();'),'18 * * * *','select public.msg_cleanup_deleted_messages();','postgres','postgres',false);
  perform cron.alter_job(cron.schedule('mz-message-hidden-threads-hourly','19 * * * *','select public.msg_purge_fully_hidden_threads();'),'19 * * * *','select public.msg_purge_fully_hidden_threads();','postgres','postgres',false);
  perform cron.alter_job(cron.schedule('mz-message-purge-old-hourly','17 * * * *','select public.msg_purge_messages_older_than_14_days();'),'17 * * * *','select public.msg_purge_messages_older_than_14_days();','postgres','postgres',false);
  perform cron.alter_job(cron.schedule('mz-rolling-schedule-window-ready','*/30 * * * *','select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, ''scheduled_rolling_window_readiness'');'),'*/30 * * * *','select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, ''scheduled_rolling_window_readiness'');','postgres','postgres',true);
  perform cron.alter_job(cron.schedule('mz-stale-sessions-hourly','5 * * * *','select public.expire_stale_open_sessions();'),'5 * * * *','select public.expire_stale_open_sessions();','postgres','postgres',true);
end
$cron_authority$;
