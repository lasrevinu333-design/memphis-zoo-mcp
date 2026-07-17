-- Deployed migration history snapshot: 20260514225919 patch_demo_scan_mock_stop_cancel_open

create or replace function public.demo_scan_mock_stop(p_run_id uuid default null, p_cleanup boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_changed integer := 0;
  v_deleted jsonb := null;
begin
  select id into v_run_id
  from public.demo_scan_mock_runs
  where (p_run_id is null or id = p_run_id)
  order by case when status = 'active' then 0 else 1 end, started_at desc
  limit 1;

  if p_cleanup then
    with x as (select * from public.demo_scan_mock_cleanup(p_run_id))
    select to_jsonb(x.*) into v_deleted from x;
    return jsonb_build_object('run_id', coalesce(v_run_id::text, p_run_id::text, 'all'), 'stopped', true, 'cleanup', true, 'deleted', v_deleted);
  end if;

  if v_run_id is null then
    return jsonb_build_object('run_id', null, 'stopped', false, 'cleanup', false, 'message', 'No demo run found.');
  end if;

  update public.sessions
  set status = 'cancelled', updated_at = now()
  where client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and status = 'active';
  get diagnostics v_changed = row_count;

  update public.demo_scan_mock_runs
  set status = 'stopped', stopped_at = now(), updated_at = now()
  where id = v_run_id;

  return jsonb_build_object('run_id', v_run_id::text, 'stopped', true, 'cleanup', false, 'cancelled_open_sessions', v_changed);
end $$;
