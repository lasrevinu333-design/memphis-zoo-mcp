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
  -- cron.schedule already owns the schedule/command update. Alter only active;
  -- hosted Supabase deliberately reserves database/username reassignment for
  -- superusers, while the executing migration role remains the job owner.
  perform cron.alter_job(cron.schedule('mz-free-tier-retention-daily','20 3 * * *','select public.mz_apply_free_tier_retention();'),null,null,null,null,false);
  perform cron.alter_job(cron.schedule('mz-message-cleanup-deleted-hourly','18 * * * *','select public.msg_cleanup_deleted_messages();'),null,null,null,null,false);
  perform cron.alter_job(cron.schedule('mz-message-hidden-threads-hourly','19 * * * *','select public.msg_purge_fully_hidden_threads();'),null,null,null,null,false);
  perform cron.alter_job(cron.schedule('mz-message-purge-old-hourly','17 * * * *','select public.msg_purge_messages_older_than_14_days();'),null,null,null,null,false);
  perform cron.alter_job(cron.schedule('mz-rolling-schedule-window-ready','*/30 * * * *','select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, ''scheduled_rolling_window_readiness'');'),null,null,null,null,true);
  perform cron.alter_job(cron.schedule('mz-stale-sessions-hourly','5 * * * *','select public.expire_stale_open_sessions();'),null,null,null,null,true);
end
$cron_authority$;
