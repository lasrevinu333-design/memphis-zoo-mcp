-- Deployed migration history snapshot: 20260515150336 demo_mock_v4_wire_cron_to_assigned_area

create or replace function public.demo_scan_mock_cron_shift_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.demo_scan_mock_assigned_area_tick(null);
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'demo_scan_mock_shift_tick_5m') then
    perform cron.unschedule('demo_scan_mock_shift_tick_5m');
  end if;

  perform cron.schedule(
    'demo_scan_mock_shift_tick_5m',
    '*/5 * * * *',
    'select public.demo_scan_mock_cron_shift_tick();'
  );
end $$;
