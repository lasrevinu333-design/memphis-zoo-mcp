-- Deployed migration history snapshot: 20260514225800 enable_demo_scan_mock_cron_20m

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'demo_scan_mock_advance_20m'
  ) then
    perform cron.unschedule('demo_scan_mock_advance_20m');
  end if;

  perform cron.schedule(
    'demo_scan_mock_advance_20m',
    '*/20 * * * *',
    'select public.demo_scan_mock_advance();'
  );
end $$;
