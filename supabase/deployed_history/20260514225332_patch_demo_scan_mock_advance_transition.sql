-- Deployed migration history snapshot: 20260514225332 patch_demo_scan_mock_advance_transition

create or replace function public.demo_scan_mock_advance(p_run_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_cycle integer;
  v_closed integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.id, r.cycle_number
  into v_run_id, v_cycle
  from public.demo_scan_mock_runs r
  where (p_run_id is null or r.id = p_run_id)
    and r.status = 'active'
  order by r.started_at desc
  limit 1;

  if v_run_id is null then
    raise exception 'No active demo scan mock run found.';
  end if;

  update public.sessions s
  set
    status = 'pending_submit',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'active';

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = 'kiosk_form',
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'pending_submit';
  get diagnostics v_closed = row_count;

  insert into public.completion_responses (
    session_id, location_id, submitted_by_employee_id, device_id,
    response_json, submitted_at, created_at, client_completion_id
  )
  select
    s.id, s.location_id, s.employee_id, s.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_session_completion',
      'services_performed', to_jsonb(array['trash_removed', 'fixtures_checked', 'floor_spot_cleaned']::text[]),
      'notes', 'Demo active session completed automatically during mock advance.',
      'cleaning_notes', 'Demo active session completed automatically during mock advance.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  insert into public.scan_events (
    scanned_at, location_id, location_code, device_id, device_identifier,
    session_id, event_type, result, notes, payload_json, created_at, client_event_id
  )
  select
    coalesce(s.ended_at, now()), s.location_id, l.location_code, s.device_id, d.device_id,
    s.id, 'scan_finish', 'demo_active_session_finished',
    'Demo active session finished during mock advance.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'cycle_number', v_cycle, 'phase', 'active_finish'),
    coalesce(s.ended_at, now()),
    'demo-scan-event:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':finish'
    );

  insert into public.session_events (
    session_id, event_type, actor_type, actor_ref, details_json, created_at
  )
  select
    s.id, 'demo_session_completed', 'system', 'demo_scan_mock_advance',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_completed',
      'demo_marker', 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    ),
    coalesce(s.ended_at, now())
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    );

  insert into public.maintenance_tickets (
    completion_response_id, session_id, location_id, reported_by_employee_id, device_id,
    issue_source, status, issue_summary, issue_category, fixture_type, fixture_identifier,
    out_of_order, issue_payload, location_code_snapshot, location_name_snapshot,
    reporter_name_snapshot, reported_at, created_at
  )
  select
    cr.id, s.id, s.location_id, s.employee_id, s.device_id,
    'completion_form', 'open',
    case when l.form_type = 'restroom' then 'Demo issue: refill soap dispenser' else 'Demo issue: debris near guest path' end,
    case when l.form_type = 'restroom' then 'supplies' else 'cleanliness' end,
    case when l.form_type = 'restroom' then 'soap_dispenser' else 'guest_path' end,
    case when l.form_type = 'restroom' then 'soap-' || l.location_code else 'path-' || l.location_code end,
    false,
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'cycle_number', v_cycle, 'phase', 'advance_issue', 'severity', 'medium'),
    l.location_code, l.location_name, e.display_name,
    coalesce(s.ended_at, now()), coalesce(s.ended_at, now())
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.completion_responses cr on cr.session_id = s.id
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and s.status = 'closed'
    and ((('x' || substr(md5(s.id::text || v_cycle::text), 1, 8))::bit(32)::bigint % 4) = 0)
    and not exists (
      select 1 from public.maintenance_tickets mt
      where mt.session_id = s.id
        and mt.issue_payload ->> 'demo_mock' = 'true'
    );

  update public.demo_scan_mock_runs
  set
    cycle_number = cycle_number + 1,
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object('last_closed_sessions', v_closed)
  where id = v_run_id;

  perform public.demo_scan_mock_begin_cycle(v_run_id);
  perform public.demo_scan_mock_refresh_snapshot(v_run_id);

  return v_run_id;
end $$;
