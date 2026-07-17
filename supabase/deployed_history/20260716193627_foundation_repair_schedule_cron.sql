-- Deployed migration history snapshot: 20260716193627 foundation_repair_schedule_cron

do $block$
declare
  v_job record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job in
      select jobid
      from cron.job
      where jobname in ('mz-current-day-static-schedule-ready', 'mz-rolling-schedule-window-ready')
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;

    perform cron.schedule(
      'mz-rolling-schedule-window-ready',
      '*/30 * * * *',
      $cron$select public.sch_ensure_schedule_window(public.sch_service_date(now()), 14, 'scheduled_rolling_window_readiness');$cron$
    );
  end if;
end
$block$;
