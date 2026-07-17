-- Deployed migration history snapshot: 20260514225955 add_safe_demo_scan_mock_cron_wrapper

create or replace function public.demo_scan_mock_cron_advance()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  select id
  into v_run_id
  from public.demo_scan_mock_runs
  where status = 'active'
  order by started_at desc
  limit 1;

  if v_run_id is null then
    return null;
  end if;

  return public.demo_scan_mock_advance(v_run_id);
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'demo_scan_mock_advance_20m') then
    perform cron.unschedule('demo_scan_mock_advance_20m');
  end if;

  perform cron.schedule(
    'demo_scan_mock_advance_20m',
    '*/20 * * * *',
    'select public.demo_scan_mock_cron_advance();'
  );
end $$;
