-- Deployed migration history snapshot: 20260515023051 demo_scan_mock_shift_schedule_mode

create or replace function public.demo_scan_mock_complete_open_sessions(
  p_run_id uuid,
  p_force boolean default false,
  p_duration_minutes integer default 35
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
begin
  update public.sessions s
  set
    status = 'pending_submit',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'active'
    and (p_force or s.started_at <= now() - make_interval(mins => p_duration_minutes));

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = coalesce(s.completion_source, 'kiosk_form'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'pending_submit'
    and s.client_session_id like '%:shift:%';
  get diagnostics v_changed = row_count;

  insert into public.completion_responses (
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    created_at,
    client_completion_id
  )
  select
    s.id,
    s.location_id,
    s.employee_id,
    s.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'mode', 'shift_schedule',
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_checked', 'supplies_checked']::text[]),
      'notes', 'Demo shift-schedule cleaning completed.',
      'cleaning_notes', 'Demo shift-schedule cleaning completed.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || p_run_id::text || ':shift:session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.client_session_id like '%:shift:%'
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  )
  select
    coalesce(s.ended_at, now()),
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_finish',
    'demo_shift_session_finished',
    'Demo shift-schedule session finished.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'mode', 'shift_schedule', 'phase', 'finish'),
    coalesce(s.ended_at, now()),
    'demo-scan-event:' || p_run_id::text || ':shift:session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  left join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.client_session_id like '%:shift:%'
    and s.status = 'closed'
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':shift:session:' || s.id::text || ':finish'
    );

  return v_changed;
end $$;

create or replace function public.demo_scan_mock_shift_tick(p_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_employee_count integer;
  v_local_now timestamp;
  v_local_date date;
  v_minutes integer;
  v_slot integer;
  v_slot_start_local timestamp;
  v_slot_start_at timestamptz;
  v_location_id uuid;
  v_location_code text;
  v_location_type text;
  v_employee_id uuid;
  v_device_id uuid;
  v_device_identifier text;
  v_session_id uuid;
  v_session_key text;
  v_closed integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.id, r.employee_count
  into v_run_id, v_employee_count
  from public.demo_scan_mock_runs r
  where (p_run_id is null or r.id = p_run_id)
    and r.status = 'active'
  order by r.started_at desc
  limit 1;

  if v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_demo_run');
  end if;

  v_local_now := timezone('America/Chicago', now());
  v_local_date := v_local_now::date;
  v_minutes := extract(hour from v_local_now)::integer * 60 + extract(minute from v_local_now)::integer;

  if v_minutes < 420 then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'window', 'before_7am_central', 'started', false);
  end if;

  if v_minutes >= 960 then
    v_closed := public.demo_scan_mock_complete_open_sessions(v_run_id, true, 35);
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'window', 'after_4pm_central', 'started', false, 'closed_sessions', v_closed);
  end if;

  v_closed := public.demo_scan_mock_complete_open_sessions(v_run_id, false, 35);

  v_slot := floor((v_minutes - 420) / 20.0)::integer;
  v_slot_start_local := v_local_date::timestamp + time '07:00' + make_interval(mins => (v_slot * 20));
  v_slot_start_at := v_slot_start_local at time zone 'America/Chicago';
  v_session_key := 'demo-scan:' || v_run_id::text || ':shift:' || to_char(v_local_date, 'YYYYMMDD') || ':slot:' || v_slot::text;

  if exists (select 1 from public.sessions where client_session_id = v_session_key) then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', false, 'reason', 'slot_already_started', 'closed_sessions', v_closed);
  end if;

  with latest_completed as (
    select distinct on (s.location_id)
      s.location_id,
      coalesce(cr.submitted_at, s.ended_at, s.started_at) as completed_at
    from public.sessions s
    left join public.completion_responses cr on cr.session_id = s.id
    where s.status = 'closed'
      and coalesce(cr.submitted_at, s.ended_at, s.started_at) >= public.operational_day_start(now())
    order by s.location_id, coalesce(cr.submitted_at, s.ended_at, s.started_at) desc
  ), candidates as (
    select
      l.id,
      l.location_code,
      l.form_type,
      coalesce(l.sort_order, 999999) as sort_order,
      lc.completed_at,
      case when l.form_type = 'restroom' then interval '135 minutes' else interval '255 minutes' end as service_interval,
      case when lc.completed_at is null then true else now() >= lc.completed_at + case when l.form_type = 'restroom' then interval '135 minutes' else interval '255 minutes' end end as is_due
    from public.locations l
    left join latest_completed lc on lc.location_id = l.id
    where l.active = true
      and l.form_type in ('restroom', 'exhibit')
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  )
  select id, location_code, form_type
  into v_location_id, v_location_code, v_location_type
  from candidates
  order by
    case when is_due then 0 else 1 end,
    coalesce(completed_at, public.operational_day_start(now()) - interval '1 hour') asc,
    sort_order,
    location_code
  limit 1;

  if v_location_id is null then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', false, 'reason', 'no_available_location', 'closed_sessions', v_closed);
  end if;

  with emp as (
    select id, row_number() over (order by display_name, id) - 1 as rn, count(*) over () as total
    from public.employees
    where active = true
  )
  select id into v_employee_id
  from emp
  where rn = (v_slot % total)
  limit 1;

  select d.id, d.device_id
  into v_device_id, v_device_identifier
  from public.devices d
  where d.active = true
  order by case when d.assigned_employee_id = v_employee_id then 0 else 1 end, d.device_id
  limit 1;

  insert into public.sessions (
    session_uuid,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    created_at,
    updated_at,
    client_session_id
  ) values (
    v_session_key,
    v_location_id,
    v_employee_id,
    v_device_id,
    'active',
    v_slot_start_at,
    now(),
    now(),
    v_session_key
  )
  returning id into v_session_id;

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  ) values (
    v_slot_start_at,
    v_location_id,
    v_location_code,
    v_device_id,
    v_device_identifier,
    v_session_id,
    'scan_start',
    'demo_shift_session_started',
    'Demo shift-schedule session started. Restrooms use 135-minute cadence; exhibits use 255-minute cadence; starts are staggered by 20 minutes.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'shift_schedule', 'slot', v_slot, 'location_type', v_location_type),
    v_slot_start_at,
    'demo-scan-event:' || v_run_id::text || ':shift:session:' || v_session_id::text || ':start'
  );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  ) values (
    v_session_id,
    'demo_shift_session_started',
    'system',
    'demo_scan_mock_shift_tick',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'shift_schedule', 'slot', v_slot),
    v_slot_start_at
  );

  update public.demo_scan_mock_runs
  set
    cycle_number = greatest(cycle_number, v_slot),
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'mode', 'shift_schedule',
      'restroom_interval_minutes', 135,
      'exhibit_interval_minutes', 255,
      'stagger_minutes', 20,
      'work_window_central', '07:00-16:00',
      'last_slot', v_slot,
      'last_location_code', v_location_code
    )
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', true, 'location_code', v_location_code, 'location_type', v_location_type, 'closed_sessions', v_closed);
end $$;

create or replace function public.demo_scan_mock_start_shift_schedule(
  p_reset_existing boolean default true,
  p_employee_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_active_employees integer;
  v_employee_count integer;
begin
  perform public.demo_scan_mock_preflight();

  if p_reset_existing then
    perform * from public.demo_scan_mock_cleanup(null);
  end if;

  select count(*) into v_active_employees from public.employees where active;
  v_employee_count := greatest(1, least(coalesce(p_employee_count, v_active_employees), v_active_employees));

  insert into public.demo_scan_mock_runs (
    status,
    started_at,
    employee_count,
    cycle_number,
    notes,
    metadata_json
  ) values (
    'active',
    now(),
    v_employee_count,
    0,
    'Shift-schedule demo: 7 AM to 4 PM Central, 20-minute staggered starts, 135-minute restroom cadence, 255-minute exhibit cadence.',
    jsonb_build_object(
      'demo_mock', true,
      'engine_version', 'v3_shift_schedule',
      'mode', 'shift_schedule',
      'restroom_interval_minutes', 135,
      'exhibit_interval_minutes', 255,
      'stagger_minutes', 20,
      'session_duration_minutes', 35,
      'work_start_central', '07:00',
      'work_stop_central', '16:00',
      'operational_day_start_protected', '04:00 Central'
    )
  ) returning id into v_run_id;

  perform public.demo_scan_mock_shift_tick(v_run_id);
  return v_run_id;
end $$;

create or replace function public.demo_scan_mock_cron_shift_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.demo_scan_mock_shift_tick(null);
end $$;
