-- Deployed migration history snapshot: 20260515145134 demo_mock_v4_complete_dynamic_helper

create or replace function public.demo_scan_mock_demo_duration_minutes(p_seed text)
returns integer
language sql
immutable
as $$
  select 15 + (get_byte(decode(substr(md5(coalesce(p_seed, 'demo')), 1, 2), 'hex'), 0) % 6);
$$;

create or replace function public.demo_scan_mock_complete_open_dynamic(p_run_id uuid, p_force boolean default false)
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
    ended_at = coalesce(
      s.ended_at,
      least(now(), s.started_at + make_interval(mins => public.demo_scan_mock_demo_duration_minutes(s.id::text)))
    ),
    duration_minutes = coalesce(s.duration_minutes, public.demo_scan_mock_demo_duration_minutes(s.id::text)),
    duration_display = coalesce(s.duration_display, public.demo_scan_mock_demo_duration_minutes(s.id::text)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'active'
    and (
      p_force
      or now() >= s.started_at + make_interval(mins => public.demo_scan_mock_demo_duration_minutes(s.id::text))
    );

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = coalesce(s.completion_source, 'kiosk_form'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'pending_submit';
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
      'mode', 'assigned_area_schedule',
      'duration_minutes', s.duration_minutes,
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_checked', 'supplies_checked']::text[]),
      'notes', 'Demo assigned-area cleaning completed in ' || coalesce(s.duration_display, '15-20 min') || '.',
      'cleaning_notes', 'Demo assigned-area cleaning completed in ' || coalesce(s.duration_display, '15-20 min') || '.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || p_run_id::text || ':assigned-area:session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  return v_changed;
end $$;
