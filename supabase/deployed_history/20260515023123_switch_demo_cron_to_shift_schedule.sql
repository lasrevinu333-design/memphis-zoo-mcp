-- Deployed migration history snapshot: 20260515023123 switch_demo_cron_to_shift_schedule

do $$
begin
  if exists (select 1 from cron.job where jobname = 'demo_scan_mock_advance_20m') then
    perform cron.unschedule('demo_scan_mock_advance_20m');
  end if;

  if exists (select 1 from cron.job where jobname = 'demo_scan_mock_shift_tick_5m') then
    perform cron.unschedule('demo_scan_mock_shift_tick_5m');
  end if;

  perform cron.schedule(
    'demo_scan_mock_shift_tick_5m',
    '*/5 * * * *',
    'select public.demo_scan_mock_cron_shift_tick();'
  );
end $$;
