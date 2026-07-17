-- Deployed migration history snapshot: 20260714164417 scheduler_foundation_static_readiness_20260714

create or replace function public.sch_ensure_daily_schedule(
  p_service_date date,
  p_reason text default 'automatic_readiness_check'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_roster_count integer := 0;
  v_assignment_count integer := 0;
  v_generated boolean := false;
  v_generator_result jsonb := '{}'::jsonb;
  v_status text;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('schedule-ready:' || p_service_date::text, 0));

  select count(*)::int into v_roster_count
  from public.daily_work_roster
  where service_date = p_service_date and active = true;

  select count(*)::int into v_assignment_count
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  if v_roster_count = 0 or v_assignment_count = 0 then
    v_generator_result := public.sch_generate_daily_schedule(p_service_date, false);
    v_generated := true;

    select count(*)::int into v_roster_count
    from public.daily_work_roster
    where service_date = p_service_date and active = true;

    select count(*)::int into v_assignment_count
    from public.daily_schedule_assignments
    where service_date = p_service_date;
  end if;

  v_status := case when v_roster_count > 0 and v_assignment_count > 0 then 'completed' else 'failed' end;

  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'daily_static_schedule_ready',
    p_service_date,
    v_status,
    jsonb_build_object(
      'reason', coalesce(nullif(btrim(p_reason), ''), 'automatic_readiness_check'),
      'generated', v_generated,
      'roster_count', v_roster_count,
      'assignment_count', v_assignment_count,
      'generator_result', v_generator_result
    ),
    now(), now()
  )
  on conflict (automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  if v_status <> 'completed' then
    raise exception 'Schedule for % is not ready after generation', p_service_date;
  end if;

  return jsonb_build_object(
    'service_date', p_service_date,
    'generated', v_generated,
    'roster_count', v_roster_count,
    'assignment_count', v_assignment_count,
    'reason', p_reason,
    'generator_result', v_generator_result
  );
end
$function$;

create or replace function public.sch_ensure_current_day_schedule()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.sch_ensure_daily_schedule(
    public.sch_service_date(now()),
    'scheduled_current_day_readiness'
  );
$function$;

revoke all on function public.sch_ensure_daily_schedule(date, text) from public, anon, authenticated;
revoke all on function public.sch_ensure_current_day_schedule() from public, anon, authenticated;
grant execute on function public.sch_ensure_daily_schedule(date, text) to service_role;
grant execute on function public.sch_ensure_current_day_schedule() to service_role;
grant execute on function public.sch_ensure_current_day_schedule() to postgres;

do $do$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'mz-current-day-static-schedule-ready'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'mz-current-day-static-schedule-ready',
    '*/10 * * * *',
    'select public.sch_ensure_current_day_schedule();'
  );
end
$do$;

select public.sch_ensure_current_day_schedule();
