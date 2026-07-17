-- Deployed migration history snapshot: 20260514224806 install_demo_scan_mock_engine_v2

do $$
declare
  v_missing text[];
begin
  select array_agg(name)
  into v_missing
  from (
    values
      ('public.employees', to_regclass('public.employees')),
      ('public.locations', to_regclass('public.locations')),
      ('public.devices', to_regclass('public.devices')),
      ('public.sessions', to_regclass('public.sessions')),
      ('public.scan_events', to_regclass('public.scan_events')),
      ('public.session_events', to_regclass('public.session_events')),
      ('public.completion_responses', to_regclass('public.completion_responses')),
      ('public.maintenance_tickets', to_regclass('public.maintenance_tickets')),
      ('public.system_settings', to_regclass('public.system_settings')),
      ('public.v_location_dashboard_status', to_regclass('public.v_location_dashboard_status')),
      ('public.v_recent_scan_activity', to_regclass('public.v_recent_scan_activity'))
  ) as t(name, reg)
  where reg is null;

  if v_missing is not null then
    raise exception 'Wrong Supabase database/branch or missing app schema. Missing: %', array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.operational_day_start(timestamp with time zone)') is null then
    raise exception 'Missing required function public.operational_day_start(timestamptz). This is likely the wrong project/branch.';
  end if;
end $$;

create table if not exists public.demo_scan_mock_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'stopped')),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  last_advanced_at timestamptz,
  employee_count integer not null default 0 check (employee_count >= 0),
  cycle_number integer not null default 0 check (cycle_number >= 0),
  notes text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.demo_scan_mock_runs enable row level security;

create index if not exists idx_demo_scan_mock_runs_status_started
  on public.demo_scan_mock_runs(status, started_at desc);

create index if not exists idx_sessions_demo_client_session_id
  on public.sessions(client_session_id)
  where client_session_id like 'demo-scan:%';

create index if not exists idx_scan_events_demo_client_event_id
  on public.scan_events(client_event_id)
  where client_event_id like 'demo-scan-event:%';

create index if not exists idx_completion_responses_demo_client_completion_id
  on public.completion_responses(client_completion_id)
  where client_completion_id like 'demo-completion:%';

create or replace function public.demo_scan_mock_preflight()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
begin
  select array_agg(name)
  into v_missing
  from (
    values
      ('public.employees', to_regclass('public.employees')),
      ('public.locations', to_regclass('public.locations')),
      ('public.devices', to_regclass('public.devices')),
      ('public.sessions', to_regclass('public.sessions')),
      ('public.scan_events', to_regclass('public.scan_events')),
      ('public.session_events', to_regclass('public.session_events')),
      ('public.completion_responses', to_regclass('public.completion_responses')),
      ('public.maintenance_tickets', to_regclass('public.maintenance_tickets')),
      ('public.system_settings', to_regclass('public.system_settings')),
      ('public.v_location_dashboard_status', to_regclass('public.v_location_dashboard_status')),
      ('public.v_recent_scan_activity', to_regclass('public.v_recent_scan_activity'))
  ) as t(name, reg)
  where reg is null;

  if v_missing is not null then
    raise exception 'Wrong Supabase database/branch or missing app schema. Missing: %', array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.operational_day_start(timestamp with time zone)') is null then
    raise exception 'Missing required function public.operational_day_start(timestamptz). This is likely the wrong project/branch.';
  end if;

  if not exists (select 1 from public.employees where active) then
    raise exception 'Cannot start demo: no active employees found.';
  end if;

  if not exists (select 1 from public.devices where active) then
    raise exception 'Cannot start demo: no active devices found.';
  end if;

  if (select count(*) from public.locations where active) < 6 then
    raise exception 'Cannot start demo: at least 6 active locations are required.';
  end if;
end $$;

create or replace function public.demo_scan_mock_cleanup(p_run_id uuid default null)
returns table(
  deleted_tickets integer,
  deleted_completion_responses integer,
  deleted_scan_events integer,
  deleted_session_events integer,
  deleted_sessions integer,
  deleted_runs integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tickets integer := 0;
  v_completions integer := 0;
  v_scans integer := 0;
  v_session_events integer := 0;
  v_sessions integer := 0;
  v_runs integer := 0;
begin
  delete from public.maintenance_tickets mt
  where (
      mt.issue_payload ->> 'demo_mock' = 'true'
      or mt.issue_payload ? 'mock_run_id'
      or exists (
        select 1 from public.sessions s
        where s.id = mt.session_id
          and s.client_session_id like 'demo-scan:%'
      )
      or exists (
        select 1 from public.completion_responses cr
        where cr.id = mt.completion_response_id
          and cr.client_completion_id like 'demo-completion:%'
      )
    )
    and (
      p_run_id is null
      or mt.issue_payload ->> 'mock_run_id' = p_run_id::text
      or exists (
        select 1 from public.sessions s
        where s.id = mt.session_id
          and s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
      )
      or exists (
        select 1 from public.completion_responses cr
        where cr.id = mt.completion_response_id
          and cr.client_completion_id like ('demo-completion:' || p_run_id::text || ':%')
      )
    );
  get diagnostics v_tickets = row_count;

  delete from public.completion_responses cr
  where (
      cr.client_completion_id like 'demo-completion:%'
      or cr.response_json ->> 'demo_mock' = 'true'
      or cr.response_json ? 'mock_run_id'
    )
    and (
      p_run_id is null
      or cr.client_completion_id like ('demo-completion:' || p_run_id::text || ':%')
      or cr.response_json ->> 'mock_run_id' = p_run_id::text
    );
  get diagnostics v_completions = row_count;

  delete from public.scan_events se
  where (
      se.client_event_id like 'demo-scan-event:%'
      or se.payload_json ->> 'demo_mock' = 'true'
      or se.payload_json ? 'mock_run_id'
    )
    and (
      p_run_id is null
      or se.client_event_id like ('demo-scan-event:' || p_run_id::text || ':%')
      or se.payload_json ->> 'mock_run_id' = p_run_id::text
    );
  get diagnostics v_scans = row_count;

  delete from public.session_events ev
  where (
      ev.details_json ->> 'demo_mock' = 'true'
      or ev.details_json ? 'mock_run_id'
      or exists (
        select 1 from public.sessions s
        where s.id = ev.session_id
          and s.client_session_id like 'demo-scan:%'
      )
    )
    and (
      p_run_id is null
      or ev.details_json ->> 'mock_run_id' = p_run_id::text
      or exists (
        select 1 from public.sessions s
        where s.id = ev.session_id
          and s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
      )
    );
  get diagnostics v_session_events = row_count;

  delete from public.sessions s
  where s.client_session_id like 'demo-scan:%'
    and (
      p_run_id is null
      or s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    );
  get diagnostics v_sessions = row_count;

  delete from public.demo_scan_mock_runs r
  where p_run_id is null or r.id = p_run_id;
  get diagnostics v_runs = row_count;

  deleted_tickets := v_tickets;
  deleted_completion_responses := v_completions;
  deleted_scan_events := v_scans;
  deleted_session_events := v_session_events;
  deleted_sessions := v_sessions;
  deleted_runs := v_runs;
  return next;
end $$;

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
    order by (((rn - 1 - (v_cycle * greatest(v_employee_count, 1)))::integer % total_count + total_count) % total_count), rn
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
      offset greatest(ce.slot - 1, 0)
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
      now() - make_interval(mins => ((c.slot * 2) % 11)),
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
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn + v_cycle) % 35))))
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
      on ae.slot = (((lp.rn - 1) % greatest(ae.employee_total, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn - 1) % greatest(ad.device_total, 1)) + 1)
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
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn + v_cycle) % 35))))
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
      on ae.slot = (((lp.rn - 1) % greatest(ae.employee_total, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn - 1) % greatest(ad.device_total, 1)) + 1)
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

create or replace function public.demo_scan_mock_start(
  p_employee_count integer default null,
  p_reset_existing boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_active_employees integer;
  v_active_locations integer;
  v_employee_count integer;
begin
  perform public.demo_scan_mock_preflight();

  if p_reset_existing then
    perform * from public.demo_scan_mock_cleanup(null);
  end if;

  select count(*) into v_active_employees from public.employees where active;
  select count(*) into v_active_locations from public.locations where active;

  v_employee_count := coalesce(p_employee_count, v_active_employees);
  v_employee_count := greatest(1, least(v_employee_count, v_active_employees, greatest(v_active_locations - 6, 1)));

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
    'Memphis Zoo custodial dashboard demo/mock scan-session run. All generated rows are demo-tagged.',
    jsonb_build_object(
      'demo_mock', true,
      'engine_version', 'v2',
      'created_by', 'demo_scan_mock_start',
      'cleanup_tags', jsonb_build_array('demo-scan:%', 'demo-scan-event:%', 'demo-completion:%')
    )
  ) returning id into v_run_id;

  perform public.demo_scan_mock_begin_cycle(v_run_id);
  perform public.demo_scan_mock_refresh_snapshot(v_run_id);

  return v_run_id;
end $$;

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
    status = 'closed',
    ended_at = now(),
    duration_minutes = greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer),
    duration_display = greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min',
    completion_source = 'kiosk_form',
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status in ('active', 'pending_submit');
  get diagnostics v_closed = row_count;

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
    and not exists (
      select 1 from public.completion_responses cr
      where cr.session_id = s.id
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
    coalesce(s.ended_at, now()),
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_finish',
    'demo_active_session_finished',
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
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  )
  select
    s.id,
    'demo_session_completed',
    'system',
    'demo_scan_mock_advance',
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
    case when l.form_type = 'restroom' then 'Demo issue: refill soap dispenser' else 'Demo issue: debris near guest path' end,
    case when l.form_type = 'restroom' then 'supplies' else 'cleanliness' end,
    case when l.form_type = 'restroom' then 'soap_dispenser' else 'guest_path' end,
    case when l.form_type = 'restroom' then 'soap-' || l.location_code else 'path-' || l.location_code end,
    false,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'advance_issue',
      'severity', 'medium'
    ),
    l.location_code,
    l.location_name,
    e.display_name,
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now())
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.completion_responses cr on cr.session_id = s.id
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and s.status = 'closed'
    and ((abs(('x' || substr(md5(s.id::text || v_cycle::text), 1, 8))::bit(32)::int) % 4) = 0)
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

create or replace function public.demo_scan_mock_stop(
  p_run_id uuid default null,
  p_cleanup boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_closed integer := 0;
  v_cleanup jsonb := null;
begin
  select r.id
  into v_run_id
  from public.demo_scan_mock_runs r
  where (p_run_id is null or r.id = p_run_id)
  order by case when r.status = 'active' then 0 else 1 end, r.started_at desc
  limit 1;

  if p_cleanup then
    with cleaned as (
      select * from public.demo_scan_mock_cleanup(p_run_id)
    )
    select to_jsonb(cleaned.*) into v_cleanup from cleaned;

    return jsonb_build_object(
      'run_id', coalesce(v_run_id::text, p_run_id::text, 'all'),
      'stopped', true,
      'cleanup', true,
      'deleted', v_cleanup
    );
  end if;

  if v_run_id is null then
    return jsonb_build_object('run_id', null, 'stopped', false, 'cleanup', false, 'message', 'No demo run found.');
  end if;

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = coalesce(s.completion_source, 'system'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status in ('active', 'pending_submit');
  get diagnostics v_closed = row_count;

  update public.demo_scan_mock_runs
  set status = 'stopped', stopped_at = now(), updated_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id::text,
    'stopped', true,
    'cleanup', false,
    'closed_open_sessions', v_closed
  );
end $$;

create or replace function public.demo_scan_mock_status(p_run_id uuid default null)
returns table(
  run_id uuid,
  run_status text,
  started_at timestamptz,
  stopped_at timestamptz,
  last_advanced_at timestamptz,
  cycle_number integer,
  employee_count integer,
  demo_sessions integer,
  open_demo_sessions integer,
  demo_completion_responses integer,
  demo_scan_events integer,
  demo_session_events integer,
  demo_tickets integer,
  dashboard_counts jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  select r.id
  into v_run_id
  from public.demo_scan_mock_runs r
  where p_run_id is null or r.id = p_run_id
  order by case when r.status = 'active' then 0 else 1 end, r.started_at desc
  limit 1;

  if v_run_id is null then
    return;
  end if;

  return query
  with dashboard as (
    select jsonb_object_agg(status_code || '/' || status_color, location_count order by status_code || '/' || status_color) as counts
    from (
      select status_code, status_color, count(*)::integer as location_count
      from public.v_location_dashboard_status
      group by status_code, status_color
    ) x
  )
  select
    r.id,
    r.status,
    r.started_at,
    r.stopped_at,
    r.last_advanced_at,
    r.cycle_number,
    r.employee_count,
    (select count(*)::integer from public.sessions s where s.client_session_id like ('demo-scan:' || v_run_id::text || ':%')),
    (select count(*)::integer from public.sessions s where s.client_session_id like ('demo-scan:' || v_run_id::text || ':%') and s.status in ('active', 'pending_submit')),
    (select count(*)::integer from public.completion_responses cr where cr.client_completion_id like ('demo-completion:' || v_run_id::text || ':%') or cr.response_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.scan_events se where se.client_event_id like ('demo-scan-event:' || v_run_id::text || ':%') or se.payload_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.session_events ev where ev.details_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.maintenance_tickets mt where mt.issue_payload ->> 'mock_run_id' = v_run_id::text),
    coalesce(dashboard.counts, '{}'::jsonb)
  from public.demo_scan_mock_runs r
  cross join dashboard
  where r.id = v_run_id;
end $$;
