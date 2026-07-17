-- Deployed migration history snapshot: 20260515145238 demo_mock_v4_assigned_area_tick

create or replace function public.demo_scan_mock_assigned_area_tick(p_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_local_now timestamp;
  v_local_date date;
  v_local_time time;
  v_minutes integer;
  v_slot integer;
  v_slot_start_at timestamptz;
  v_desired_type text;
  v_session_key text;
  v_closed integer := 0;
  v_location_id uuid;
  v_location_code text;
  v_location_type text;
  v_group_name text;
  v_purpose text;
  v_employee_id uuid;
  v_employee_name text;
  v_device_id uuid;
  v_device_identifier text;
  v_session_id uuid;
  v_duration integer;
begin
  perform public.demo_scan_mock_preflight();

  select id into v_run_id
  from public.demo_scan_mock_runs
  where (p_run_id is null or id = p_run_id)
    and status = 'active'
  order by started_at desc
  limit 1;

  if v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_demo_run');
  end if;

  v_local_now := timezone('America/Chicago', now());
  v_local_date := v_local_now::date;
  v_local_time := v_local_now::time;
  v_minutes := extract(hour from v_local_now)::integer * 60 + extract(minute from v_local_now)::integer;

  if v_minutes < 420 then
    return jsonb_build_object('ok', true, 'window', 'before_7am_central', 'started', false, 'run_id', v_run_id::text);
  end if;

  if v_minutes >= 960 then
    v_closed := public.demo_scan_mock_complete_open_dynamic(v_run_id, true);
    return jsonb_build_object('ok', true, 'window', 'after_4pm_central', 'started', false, 'closed_sessions', v_closed, 'run_id', v_run_id::text);
  end if;

  v_closed := public.demo_scan_mock_complete_open_dynamic(v_run_id, false);
  v_slot := floor((v_minutes - 420) / 20.0)::integer;
  v_slot_start_at := (v_local_date::timestamp + time '07:00' + make_interval(mins => (v_slot * 20))) at time zone 'America/Chicago';
  v_desired_type := case when v_slot % 2 = 0 then 'exhibit' else 'restroom' end;
  v_session_key := 'demo-scan:' || v_run_id::text || ':assigned-area:' || to_char(v_local_date, 'YYYYMMDD') || ':slot:' || v_slot::text;

  if exists (select 1 from public.sessions where client_session_id = v_session_key) then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'slot_already_started', 'slot', v_slot, 'closed_sessions', v_closed, 'run_id', v_run_id::text);
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
  ), eligible as (
    select
      al.*,
      lc.completed_at,
      case
        when lc.completed_at is null then true
        when al.form_type = 'restroom' then now() >= lc.completed_at + interval '135 minutes'
        when al.form_type = 'exhibit' then now() >= lc.completed_at + interval '255 minutes'
        else false
      end as is_due
    from public.v_demo_scan_mock_today_assigned_locations al
    left join latest_completed lc on lc.location_id = al.location_id
    where al.service_date = v_local_date
      and al.coverage_start <= v_local_time
      and al.coverage_end > v_local_time
      and not exists (
        select 1 from public.sessions os
        where os.location_id = al.location_id
          and os.status in ('active', 'pending_submit')
      )
  )
  select location_id, location_code, form_type, group_name, coverage_purpose, employee_id, employee_name
  into v_location_id, v_location_code, v_location_type, v_group_name, v_purpose, v_employee_id, v_employee_name
  from eligible
  order by
    case when form_type = v_desired_type then 0 else 1 end,
    case when is_due then 0 else 1 end,
    coalesce(completed_at, public.operational_day_start(now()) - interval '1 hour') asc,
    case coverage_purpose when 'area_owner' then 0 when 'deep_clean' then 1 when 'restroom_upkeep' then 2 when 'late_coverage' then 3 else 4 end,
    sort_order,
    location_code
  limit 1;

  if v_location_id is null then
    return jsonb_build_object('ok', true, 'started', false, 'reason', 'no_assigned_location_available', 'slot', v_slot, 'closed_sessions', v_closed, 'run_id', v_run_id::text);
  end if;

  select d.id, d.device_id
  into v_device_id, v_device_identifier
  from public.devices d
  where d.active = true
  order by case when d.assigned_employee_id = v_employee_id then 0 else 1 end, d.device_id
  limit 1;

  v_duration := public.demo_scan_mock_demo_duration_minutes(v_session_key || v_location_code);

  insert into public.sessions (
    session_uuid, location_id, employee_id, device_id, status, started_at, created_at, updated_at, client_session_id
  ) values (
    v_session_key, v_location_id, v_employee_id, v_device_id, 'active', v_slot_start_at, now(), now(), v_session_key
  ) returning id into v_session_id;

  insert into public.scan_events (
    scanned_at, location_id, location_code, device_id, device_identifier, session_id,
    event_type, result, notes, payload_json, created_at, client_event_id
  ) values (
    v_slot_start_at, v_location_id, v_location_code, v_device_id, v_device_identifier, v_session_id,
    'scan_start', 'demo_assigned_area_session_started',
    'Demo session started from today assigned custodial area schedule.',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'mode', 'assigned_area_schedule',
      'slot', v_slot,
      'group_name', v_group_name,
      'coverage_purpose', v_purpose,
      'location_type', v_location_type,
      'duration_minutes', v_duration,
      'restroom_cadence_minutes', 135,
      'exhibit_cadence_minutes', 255,
      'stagger_minutes', 20
    ),
    v_slot_start_at,
    'demo-scan-event:' || v_run_id::text || ':assigned-area:session:' || v_session_id::text || ':start'
  );

  insert into public.session_events (
    session_id, event_type, actor_type, actor_ref, details_json, created_at
  ) values (
    v_session_id,
    'demo_assigned_area_session_started',
    'system',
    'demo_scan_mock_assigned_area_tick',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'mode', 'assigned_area_schedule',
      'slot', v_slot,
      'group_name', v_group_name,
      'coverage_purpose', v_purpose,
      'location_code', v_location_code,
      'employee_name', v_employee_name,
      'duration_minutes', v_duration
    ),
    v_slot_start_at
  );

  update public.demo_scan_mock_runs
  set
    cycle_number = greatest(cycle_number, v_slot),
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'mode', 'assigned_area_schedule',
      'restroom_interval_minutes', 135,
      'exhibit_interval_minutes', 255,
      'session_duration_min', 15,
      'session_duration_max', 20,
      'stagger_minutes', 20,
      'work_window_central', '07:00-16:00',
      'assignment_source', 'daily_schedule_assignments + location_group_memberships',
      'last_slot', v_slot,
      'last_location_code', v_location_code,
      'last_location_type', v_location_type,
      'last_employee_name', v_employee_name
    )
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id::text,
    'slot', v_slot,
    'started', true,
    'location_code', v_location_code,
    'location_type', v_location_type,
    'employee_name', v_employee_name,
    'group_name', v_group_name,
    'coverage_purpose', v_purpose,
    'duration_minutes', v_duration,
    'closed_sessions', v_closed
  );
end $$;
