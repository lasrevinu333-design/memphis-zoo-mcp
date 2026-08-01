begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.commit_cleaning_workflow(
  p_client_session_id text,
  p_client_completion_id text,
  p_device_id text,
  p_location_code text,
  p_client_started_at timestamptz,
  p_client_ended_at timestamptz,
  p_response_json jsonb default '{}'::jsonb,
  p_scan_evidence jsonb default '[]'::jsonb,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
  v_client_completion_id text := nullif(btrim(coalesce(p_client_completion_id, '')), '');
  v_correlation_id text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_form_type text;
  v_device_pk uuid;
  v_device_id text;
  v_device_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_session_id uuid;
  v_session_uuid text;
  v_session_status text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_duration_minutes integer;
  v_duration_display text;
  v_session_location_id uuid;
  v_session_device_pk uuid;
  v_session_employee_id uuid;
  v_completion_response_id uuid;
  v_existing_completion_id uuid;
  v_existing_client_completion_id text;
  v_existing_submitted_at timestamptz;
  v_ticket_count integer := 0;
  v_session_created boolean := false;
  v_item jsonb;
  v_event_type text;
  v_event_id text;
begin
  if v_client_session_id is null or length(v_client_session_id) > 200 then
    raise exception 'client_session_id is required and must be at most 200 characters';
  end if;
  if v_client_completion_id is null or length(v_client_completion_id) > 200 then
    raise exception 'client_completion_id is required and must be at most 200 characters';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then raise exception 'device_id is required'; end if;
  if nullif(btrim(coalesce(p_location_code, '')), '') is null then raise exception 'location_code is required'; end if;
  if jsonb_typeof(coalesce(p_response_json, '{}'::jsonb)) <> 'object' then raise exception 'response_json must be an object'; end if;
  if pg_column_size(coalesce(p_response_json, '{}'::jsonb)) > 1048576 then raise exception 'response_json exceeds 1 MB'; end if;
  if jsonb_typeof(coalesce(p_scan_evidence, '[]'::jsonb)) <> 'array' then raise exception 'scan_evidence must be an array'; end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-session:' || v_client_session_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('scan-completion:' || v_client_completion_id, 0));

  select cr.id, cr.submitted_at, s.id, s.session_uuid, s.status, s.started_at, s.ended_at,
         s.duration_minutes, s.duration_display,
         l.id, l.location_code, l.location_name, l.location_type, l.form_type,
         d.id, d.device_id, d.device_name,
         e.id, e.display_name
    into v_existing_completion_id, v_existing_submitted_at,
         v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_location_id, v_location_code, v_location_name, v_location_type, v_form_type,
         v_device_pk, v_device_id, v_device_name,
         v_employee_id, v_employee_name
  from public.completion_responses cr
  join public.sessions s on s.id = cr.session_id
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where cr.client_completion_id = v_client_completion_id
  limit 1;

  if v_existing_completion_id is not null then
    if upper(btrim(v_device_id)) <> upper(btrim(p_device_id)) then
      raise exception 'client_completion_id is already bound to another device';
    end if;
    if v_client_session_id <> (select s.client_session_id from public.sessions s where s.id = v_session_id) then
      raise exception 'client_completion_id is already bound to another client_session_id';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_session_status,
      'started_at', v_started_at,
      'ended_at', v_ended_at,
      'duration_minutes', v_duration_minutes,
      'duration_display', v_duration_display,
      'submitted_at', v_existing_submitted_at,
      'completion_response_id', v_existing_completion_id,
      'replayed', true,
      'correlation_id', v_correlation_id
    );
  end if;

  select l.id, l.location_code, l.location_name, l.location_type, l.form_type
    into v_location_id, v_location_code, v_location_name, v_location_type, v_form_type
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active = true
  limit 1;
  if v_location_id is null then raise exception 'Active location not found for code: %', p_location_code; end if;

  select d.id, d.device_id, d.device_name, e.id, e.display_name
    into v_device_pk, v_device_id, v_device_name, v_employee_id, v_employee_name
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id and e.active = true
  where upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    and d.active = true
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', p_device_id; end if;
  if v_employee_id is null then raise exception 'Device % is not assigned to an active employee', v_device_id; end if;

  -- Keep the requested, freshly resolved identity in v_location_id/v_device_pk/v_employee_id.
  -- A SELECT INTO with no matching session clears every target, so optional session state
  -- must use distinct variables or a first offline completion loses its required identities.
  select s.id, s.session_uuid, s.status, s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.location_id, s.device_id, s.employee_id
    into v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_session_location_id, v_session_device_pk, v_session_employee_id
  from public.sessions s
  where s.client_session_id = v_client_session_id
  for update;

  if v_session_id is not null then
    if v_session_device_pk <> v_device_pk then
      raise exception 'client_session_id is bound to another device';
    end if;
    if v_session_location_id <> v_location_id then
      raise exception 'client_session_id is bound to another location';
    end if;
    if v_session_employee_id <> v_employee_id then
      raise exception 'device assignment changed during this session; manager review required';
    end if;
    if v_session_status = 'cancelled' then
      raise exception 'Session was cancelled before completion reached the server; manager recovery is required';
    end if;
    if exists (select 1 from public.completion_responses cr where cr.session_id = v_session_id) then
      select cr.id, cr.submitted_at, cr.client_completion_id
        into v_existing_completion_id, v_existing_submitted_at, v_existing_client_completion_id
      from public.completion_responses cr where cr.session_id = v_session_id limit 1;
      if v_existing_client_completion_id is distinct from v_client_completion_id then
        raise exception 'client_session_id is already completed with another client_completion_id';
      end if;
      return jsonb_build_object(
        'session_uuid', v_session_uuid,
        'client_session_id', v_client_session_id,
        'client_completion_id', v_existing_client_completion_id,
        'location_code', v_location_code,
        'location_name', v_location_name,
        'location_type', v_location_type,
        'form_type', v_form_type,
        'employee_name', v_employee_name,
        'device_id', v_device_id,
        'device_name', v_device_name,
        'status', v_session_status,
        'started_at', v_started_at,
        'ended_at', v_ended_at,
        'duration_minutes', v_duration_minutes,
        'duration_display', v_duration_display,
        'submitted_at', v_existing_submitted_at,
        'completion_response_id', v_existing_completion_id,
        'replayed', true,
        'correlation_id', v_correlation_id
      );
    end if;
  else
    perform public.expire_stale_open_sessions(now());

    if exists (select 1 from public.sessions s where s.device_id = v_device_pk and s.status in ('active','pending_submit')) then
      raise exception 'Device already has another open session: %', v_device_id;
    end if;
    if exists (select 1 from public.sessions s where s.employee_id = v_employee_id and s.status in ('active','pending_submit')) then
      raise exception 'Assigned employee already has another open session: %', v_employee_name;
    end if;
    if exists (select 1 from public.sessions s where s.location_id = v_location_id and s.status in ('active','pending_submit')) then
      raise exception 'Location already has another open session: %', v_location_code;
    end if;

    v_started_at := coalesce(p_client_started_at, p_client_ended_at, now());
    v_session_uuid := gen_random_uuid()::text;
    insert into public.sessions(
      session_uuid, client_session_id, location_id, employee_id, device_id,
      status, started_at, completion_source
    ) values (
      v_session_uuid, v_client_session_id, v_location_id, v_employee_id, v_device_pk,
      'active', v_started_at, null
    ) returning id into v_session_id;
    v_session_status := 'active';
    v_session_created := true;

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_started',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'employee_name', v_employee_name,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'identity_source', 'devices.assigned_employee_id',
        'created_during_atomic_commit', true
      )
    );
  end if;

  v_started_at := coalesce(v_started_at, p_client_started_at, now());
  v_ended_at := coalesce(p_client_ended_at, now());
  if v_ended_at > now() + interval '10 minutes' then raise exception 'client_ended_at is too far in the future'; end if;
  if v_started_at > v_ended_at then raise exception 'client_started_at cannot be after client_ended_at'; end if;
  if v_started_at < now() - interval '7 days' then raise exception 'client_started_at is too old'; end if;
  if v_ended_at - v_started_at > interval '24 hours' then raise exception 'cleaning duration exceeds 24 hours'; end if;

  v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_started_at)) / 60.0)::integer);
  v_duration_display := v_duration_minutes::text || ' min';

  if v_session_status = 'active' then
    update public.sessions
    set status = 'pending_submit',
        ended_at = v_ended_at,
        duration_minutes = v_duration_minutes,
        duration_display = v_duration_display,
        updated_at = now()
    where id = v_session_id and status = 'active';

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_finished',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'duration_minutes', v_duration_minutes,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'atomic_commit', true
      )
    );
    v_session_status := 'pending_submit';
  elsif v_session_status <> 'pending_submit' then
    raise exception 'Session status % cannot be completed', v_session_status;
  end if;

  insert into public.completion_responses(
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    client_completion_id
  ) values (
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    coalesce(p_response_json, '{}'::jsonb),
    now(),
    v_client_completion_id
  ) returning id, submitted_at into v_completion_response_id, v_existing_submitted_at;

  v_ticket_count := public.create_maintenance_tickets_from_response(
    v_completion_response_id,
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    v_existing_submitted_at,
    coalesce(p_response_json, '{}'::jsonb)
  );

  if jsonb_array_length(coalesce(p_scan_evidence, '[]'::jsonb)) > 200 then
    raise exception 'scan_evidence cannot contain more than 200 events';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_scan_evidence, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_event_type := nullif(btrim(coalesce(v_item->>'event_type', '')), '');
    v_event_id := nullif(btrim(coalesce(v_item->>'client_event_id', '')), '');
    if v_event_type not in (
      'scan_received', 'scan_blocked', 'scan_start', 'scan_finish',
      'scan_resume_pending', 'scan_invalid_location', 'scan_unauthorized_device', 'scan_error'
    ) then
      continue;
    end if;

    insert into public.scan_events(
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
      client_event_id
    ) values (
      coalesce(nullif(v_item->>'scanned_at', '')::timestamptz, now()),
      v_location_id,
      v_location_code,
      v_device_pk,
      v_device_id,
      v_session_id,
      v_event_type,
      nullif(v_item->>'result', ''),
      nullif(v_item->>'notes', ''),
      coalesce(v_item->'payload_json', '{}'::jsonb) || jsonb_build_object('correlation_id', v_correlation_id),
      v_event_id
    )
    on conflict (client_event_id) where client_event_id is not null
    do update set
      session_id = coalesce(public.scan_events.session_id, excluded.session_id),
      location_id = coalesce(public.scan_events.location_id, excluded.location_id),
      device_id = coalesce(public.scan_events.device_id, excluded.device_id),
      payload_json = coalesce(public.scan_events.payload_json, '{}'::jsonb) || excluded.payload_json;
  end loop;

  update public.sessions
  set status = 'closed',
      ended_at = v_ended_at,
      duration_minutes = v_duration_minutes,
      duration_display = v_duration_display,
      completion_source = 'kiosk_form',
      updated_at = now()
  where id = v_session_id and status = 'pending_submit';

  if not found then raise exception 'Session could not transition from pending_submit to closed'; end if;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session_id,
    'session_completed',
    'form',
    v_employee_name,
    jsonb_build_object(
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'correlation_id', v_correlation_id,
      'ticket_count', v_ticket_count,
      'identity_source', 'devices.assigned_employee_id',
      'atomic_commit', true
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'commit_cleaning_workflow', 'Atomic cleaning workflow committed', v_session_id, v_location_id, v_device_pk);

  return jsonb_build_object(
    'session_uuid', v_session_uuid,
    'client_session_id', v_client_session_id,
    'client_completion_id', v_client_completion_id,
    'location_code', v_location_code,
    'location_name', v_location_name,
    'location_type', v_location_type,
    'form_type', v_form_type,
    'employee_name', v_employee_name,
    'device_id', v_device_id,
    'device_name', v_device_name,
    'status', 'closed',
    'started_at', v_started_at,
    'ended_at', v_ended_at,
    'duration_minutes', v_duration_minutes,
    'duration_display', v_duration_display,
    'submitted_at', v_existing_submitted_at,
    'completion_response_id', v_completion_response_id,
    'maintenance_ticket_count', v_ticket_count,
    'session_created_during_commit', v_session_created,
    'replayed', false,
    'correlation_id', v_correlation_id
  );
end
$function$;

comment on function public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)
is 'Atomically commits an online or queued cleaning workflow while preserving resolved identity across an absent-session lookup and replaying idempotently.';

revoke all on function public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)
from public, anon, authenticated;
grant execute on function public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text)
to postgres, service_role;

commit;
