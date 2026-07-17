-- Deployed migration history snapshot: 20260715043004 disable_destructive_retention_jobs_20260715

do $do$
declare
  v_job record;
  v_disabled integer := 0;
  v_job_names text[] := array[
    'mz-free-tier-retention-daily',
    'mz-message-purge-old-hourly',
    'mz-message-cleanup-deleted-hourly',
    'mz-message-hidden-threads-hourly'
  ];
begin
  for v_job in
    select jobid,jobname
    from cron.job
    where jobname = any(v_job_names)
  loop
    perform cron.alter_job(job_id => v_job.jobid, active => false);
    v_disabled := v_disabled + 1;
  end loop;

  if v_disabled <> 4 then
    raise exception 'Expected to disable 4 destructive retention jobs, disabled %', v_disabled;
  end if;

  insert into public.system_logs(level,source,message,created_at)
  values(
    'INFO',
    'retention_governance',
    'Disabled broad automatic deletion jobs for events, messages, scan history, schedules, logs, guest issues, feedback, tickets, and migration history. Destructive retention now requires an explicit audited operation.',
    now()
  );
end
$do$;

revoke all on function public.mz_apply_free_tier_retention(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.msg_purge_messages_older_than_14_days() from public, anon, authenticated, service_role;
revoke all on function public.msg_cleanup_deleted_messages() from public, anon, authenticated, service_role;
revoke all on function public.msg_purge_fully_hidden_threads() from public, anon, authenticated, service_role;
revoke all on function public.purge_closed_scan_history_before(timestamptz,text) from public, anon, authenticated, service_role;

grant execute on function public.mz_apply_free_tier_retention(timestamptz) to postgres;
grant execute on function public.msg_purge_messages_older_than_14_days() to postgres;
grant execute on function public.msg_cleanup_deleted_messages() to postgres;
grant execute on function public.msg_purge_fully_hidden_threads() to postgres;
grant execute on function public.purge_closed_scan_history_before(timestamptz,text) to postgres;

comment on function public.mz_apply_free_tier_retention(timestamptz) is 'Destructive legacy retention routine. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only; use solely after explicit audited approval.';
comment on function public.msg_purge_messages_older_than_14_days() is 'Destructive legacy message purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';
comment on function public.msg_cleanup_deleted_messages() is 'Destructive legacy message cleanup. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';
comment on function public.msg_purge_fully_hidden_threads() is 'Destructive legacy hidden-thread purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';
comment on function public.purge_closed_scan_history_before(timestamptz,text) is 'Destructive scan-history purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';
