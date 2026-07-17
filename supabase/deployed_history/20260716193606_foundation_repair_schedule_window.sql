-- Deployed migration history snapshot: 20260716193606 foundation_repair_schedule_window

create or replace function public.sch_ensure_schedule_window(
  p_start_date date default public.sch_service_date(now()),
  p_days integer default 14,
  p_reason text default 'scheduled_rolling_window_readiness'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_start date := coalesce(p_start_date, public.sch_service_date(now()));
  v_days integer := greatest(1, least(coalesce(p_days, 14), 31));
  v_offset integer;
  v_date date;
  v_result jsonb;
  v_audit jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ready integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('schedule-window:' || v_start::text || ':' || v_days::text, 0));

  for v_offset in 0..(v_days - 1) loop
    v_date := v_start + v_offset;
    begin
      v_result := public.sch_ensure_daily_schedule(
        v_date,
        coalesce(nullif(btrim(p_reason), ''), 'scheduled_rolling_window_readiness')
      );
      v_audit := public.sch_audit_schedule_day(v_date);
      if coalesce((v_audit->>'ok')::boolean, false) then
        v_ready := v_ready + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', true,
          'result', v_result,
          'audit', v_audit
        ));
      else
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', false,
          'error', 'schedule_audit_failed',
          'result', v_result,
          'audit', v_audit
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'service_date', v_date,
        'ok', false,
        'error', sqlerrm
      ));
    end;
  end loop;

  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'rolling_schedule_window_ready',
    v_start,
    case when v_failed = 0 then 'completed' else 'failed' end,
    jsonb_build_object(
      'start_date', v_start,
      'days', v_days,
      'reason', p_reason,
      'ready_days', v_ready,
      'failed_days', v_failed,
      'results', v_results
    ),
    now(), now()
  )
  on conflict (automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  return jsonb_build_object(
    'ok', v_failed = 0,
    'start_date', v_start,
    'days', v_days,
    'ready_days', v_ready,
    'failed_days', v_failed,
    'results', v_results
  );
end
$function$;

revoke all on function public.sch_ensure_schedule_window(date,integer,text) from public, anon, authenticated;
grant execute on function public.sch_ensure_schedule_window(date,integer,text) to service_role, postgres;
