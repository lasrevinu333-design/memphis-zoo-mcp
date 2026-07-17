-- Deployed migration history snapshot: 20260514224945 patch_demo_scan_mock_make_interval_int_casts

create or replace function public.demo_scan_mock_begin_cycle(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle integer;
  v_employee_count integer;
  v_inserted integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.cycle_number, r.employee_count
  into v_cycle, v_employee_count
  from public.demo_scan_mock_runs r
  where r.id = p_run_id
    and r.status = 'active';

  if not found then
    raise exception 'No active demo run found for %', p_run_id;
  end if;

  with loc_ranked as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      count(*) over () as total_count
    from public.locations l
    where l.active
  ), chosen_locations as (
    select *
    from loc_ranked
    order by (((rn - 1 - (v_cycle * greatest(v_employee_count, 1)))::integer % total_count::integer + total_count::integer) % total_count::integer), rn
    limit v_employee_count
  ), chosen_with_slot as (
    select row_number() over (order by coalesce(sort_order, 999999), location_code) as slot, *
    from chosen_locations
  ), chosen_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name
    from public.employees e
    where e.active
    order by e.display_name, e.id
    limit v_employee_count
  ), employee_devices as (
    select
      ce.slot,
      ce.employee_id,
      ce.display_name,
      coalesce(ad.id, fd.id) as device_pk,
      coalesce(ad.device_id, fd.device_id) as device_identifier
    from chosen_employees ce
    left join lateral (
      select d.id, d.device_id
      from public.devices d
      where d.active and d.assigned_employee_id = ce.employee_id
      order by d.device_id
      limit 1
    ) ad on true
    left join lateral (
      select d.id, d.device_id
      from public.devices d
      where d.active
      order by d.device_id
      offset greatest(ce.slot::integer - 1, 0)
      limit 1
    ) fd on true
  ), ins as (
    insert into public.sessions (
      session_uuid,
      location_id,
      employee_id,
      device_id,
      status,
      started_at,
      completion_source,
      created_at,
      updated_at,
      client_session_id
    )
    select
      'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text,
      c.id,
      ed.employee_id,
      ed.device_pk,
      'active',
      now() - make_interval(mins => (((c.slot::integer * 2) % 11)::integer)),
      null,
      now(),
      now(),
      'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text
    from chosen_with_slot c
    join employee_devices ed on ed.slot = c.slot
    where ed.device_pk is not null
      and not exists (
        select 1 from public.sessions existing
        where existing.session_uuid = 'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text
      )
    returning id
  )
  select count(*) into v_inserted from ins;

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
    s.started_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_start',
    'demo_active_session_started',
    'Demo mock scan session started.',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_start'
    ),
    s.started_at,
    'demo-scan-event:' || p_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':start'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':start'
    );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  )
  select
    s.id,
    'demo_session_started',
    'system',
    'demo_scan_mock',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_start',
      'demo_marker', 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':started'
    ),
    s.started_at
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':started'
    );

  update public.demo_scan_mock_runs
  set updated_at = now()
  where id = p_run_id;

  return v_inserted;
end $$;

create or replace function public.demo_scan_mock_refresh_snapshot(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle integer;
  v_employee_count integer;
  v_inserted integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.cycle_number, r.employee_count
  into v_cycle, v_employee_count
  from public.demo_scan_mock_runs r
  where r.id = p_run_id
    and r.status = 'active';

  if not found then
    raise exception 'No active demo run found for %', p_run_id;
  end if;

  with available_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name,
           count(*) over () as employee_total
    from public.employees e
    where e.active
  ), available_devices as (
    select row_number() over (order by d.device_id, d.id) as slot, d.id as device_pk, d.device_id,
           count(*) over () as device_total
    from public.devices d
    where d.active
  ), eligible_locations as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      row_number() over (partition by l.form_type order by coalesce(l.sort_order, 999999), l.location_code) as type_rn
    from public.locations l
    where l.active
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  ), loc_plan as (
    select
      el.*,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then 'overdue_restroom'
        when el.form_type = 'restroom' and el.type_rn = 2 then 'due_soon_restroom'
        when el.form_type = 'exhibit' and el.type_rn = 1 then 'overdue_exhibit'
        when el.form_type = 'exhibit' and el.type_rn = 2 then 'due_soon_exhibit'
        else 'okay'
      end as demo_status_bucket,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '130 minutes')
        when el.form_type = 'restroom' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '100 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '255 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '205 minutes')
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn::integer + v_cycle) % 35))::integer))
      end as completed_at
    from eligible_locations el
  ), loc_with_people as (
    select
      lp.*,
      ae.employee_id,
      ae.display_name as employee_name,
      ad.device_pk,
      ad.device_id as device_identifier
    from loc_plan lp
    join available_employees ae
      on ae.slot = (((lp.rn::integer - 1) % greatest(ae.employee_total::integer, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn::integer - 1) % greatest(ad.device_total::integer, 1)) + 1)
  ), ins as (
    insert into public.sessions (
      session_uuid,
      location_id,
      employee_id,
      device_id,
      status,
      started_at,
      ended_at,
      duration_minutes,
      duration_display,
      completion_source,
      created_at,
      updated_at,
      client_session_id
    )
    select
      'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code,
      lwp.id,
      lwp.employee_id,
      lwp.device_pk,
      'closed',
      lwp.completed_at - interval '18 minutes',
      lwp.completed_at,
      18,
      '18 min',
      'kiosk_form',
      lwp.completed_at - interval '18 minutes',
      now(),
      'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
    from loc_with_people lwp
    where not exists (
      select 1 from public.sessions existing
      where existing.session_uuid = 'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
    )
    returning id
  )
  select count(*) into v_inserted from ins;

  with available_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name,
           count(*) over () as employee_total
    from public.employees e
    where e.active
  ), available_devices as (
    select row_number() over (order by d.device_id, d.id) as slot, d.id as device_pk, d.device_id,
           count(*) over () as device_total
    from public.devices d
    where d.active
  ), eligible_locations as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      row_number() over (partition by l.form_type order by coalesce(l.sort_order, 999999), l.location_code) as type_rn
    from public.locations l
    where l.active
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  ), loc_plan as (
    select
      el.*,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then 'overdue_restroom'
        when el.form_type = 'restroom' and el.type_rn = 2 then 'due_soon_restroom'
        when el.form_type = 'exhibit' and el.type_rn = 1 then 'overdue_exhibit'
        when el.form_type = 'exhibit' and el.type_rn = 2 then 'due_soon_exhibit'
        else 'okay'
      end as demo_status_bucket,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '130 minutes')
        when el.form_type = 'restroom' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '100 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '255 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '205 minutes')
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn::integer + v_cycle) % 35))::integer))
      end as completed_at
    from eligible_locations el
  ), loc_with_people as (
    select
      lp.*,
      ae.employee_id,
      ae.display_name as employee_name,
      ad.device_pk,
      ad.device_id as device_identifier
    from loc_plan lp
    join available_employees ae
      on ae.slot = (((lp.rn::integer - 1) % greatest(ae.employee_total::integer, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn::integer - 1) % greatest(ad.device_total::integer, 1)) + 1)
  ), demo_sessions as (
    select s.*, lwp.location_code, lwp.location_name, lwp.form_type, lwp.demo_status_bucket, lwp.employee_name, lwp.device_identifier
    from public.sessions s
    join loc_with_people lwp on lwp.id = s.location_id
    where s.client_session_id = 'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
  )
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
    ds.id,
    ds.location_id,
    ds.employee_id,
    ds.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'status_bucket', ds.demo_status_bucket,
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_wiped', 'supplies_checked']::text[]),
      'notes', 'Demo completion seeded for dashboard status: ' || ds.demo_status_bucket,
      'cleaning_notes', 'Demo completion seeded for dashboard status: ' || ds.demo_status_bucket
    ),
    ds.ended_at,
    ds.ended_at,
    'demo-completion:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || ds.id::text
  from demo_sessions ds
  where not exists (
    select 1 from public.completion_responses cr
    where cr.session_id = ds.id
  );

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
    s.started_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_start',
    'demo_snapshot_started',
    'Demo snapshot cleaning started.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'cycle_number', v_cycle, 'phase', 'snapshot_start'),
    s.started_at,
    'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':start'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':start'
    );

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
    s.ended_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_finish',
    'demo_snapshot_finished',
    'Demo snapshot cleaning completed.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'cycle_number', v_cycle, 'phase', 'snapshot_finish'),
    s.ended_at,
    'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':finish'
    );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  )
  select
    s.id,
    'demo_snapshot_completed',
    'system',
    'demo_scan_mock',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'snapshot_completed',
      'demo_marker', 'snapshot:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    ),
    s.ended_at
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'snapshot:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    );

  insert into public.maintenance_tickets (
    completion_response_id,
    session_id,
    location_id,
    reported_by_employee_id,
    device_id,
    issue_source,
    status,
    issue_summary,
    issue_category,
    fixture_type,
    fixture_identifier,
    out_of_order,
    issue_payload,
    location_code_snapshot,
    location_name_snapshot,
    reporter_name_snapshot,
    reported_at,
    created_at
  )
  select
    cr.id,
    s.id,
    s.location_id,
    s.employee_id,
    s.device_id,
    'completion_form',
    'open',
    case when l.form_type = 'restroom' then 'Demo issue: low paper supply' else 'Demo issue: spot clean requested' end,
    case when l.form_type = 'restroom' then 'supplies' else 'cleanliness' end,
    case when l.form_type = 'restroom' then 'paper_towel_dispenser' else 'exhibit_area' end,
    case when l.form_type = 'restroom' then 'dispenser-' || l.location_code else 'zone-' || l.location_code end,
    false,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'snapshot_issue',
      'severity', 'low'
    ),
    l.location_code,
    l.location_name,
    e.display_name,
    s.ended_at,
    s.ended_at
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.completion_responses cr on cr.session_id = s.id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and (
      l.location_code in (
        select location_code
        from public.locations
        where active
        order by coalesce(sort_order, 999999), location_code
        offset ((v_cycle * 3) % greatest((select count(*) from public.locations where active), 1))
        limit 1
      )
      or l.location_code in (
        select location_code
        from public.locations
        where active and form_type = 'exhibit'
        order by coalesce(sort_order, 999999), location_code
        offset (v_cycle % greatest((select count(*) from public.locations where active and form_type = 'exhibit'), 1))
        limit 1
      )
    )
    and not exists (
      select 1 from public.maintenance_tickets mt
      where mt.session_id = s.id
        and mt.issue_payload ->> 'demo_mock' = 'true'
    );

  update public.demo_scan_mock_runs
  set updated_at = now()
  where id = p_run_id;

  return v_inserted;
end $$;
