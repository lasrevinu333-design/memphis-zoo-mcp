-- Deployed migration history snapshot: 20260715004418 terminal_cancelled_queue_reconciliation_20260715

create or replace function public.tool_finish_session(
  p_location_code text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_resolved_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_canonical_device_id text;
  v_existing record;
  v_finished record;
begin
  select d.id, d.device_id
    into v_device_pk, v_canonical_device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true
    and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
  union all
  select d.id, d.device_id
  from public.devices d
  where d.active = true
    and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
  limit 1;

  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;

  select s.session_uuid, s.client_session_id, l.location_name,
         e.display_name as employee_name, d.device_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, l.location_type, l.form_type
    into v_existing
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.device_id = v_device_pk
    and l.location_code = v_resolved_code
    and s.status in ('active','pending_submit','closed','cancelled')
  order by s.started_at desc
  limit 1;

  if v_existing.session_uuid is null then
    raise exception 'No session found for location % and device %', coalesce(v_resolved_code,p_location_code), v_canonical_device_id;
  end if;

  if v_existing.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_existing.session_uuid,
      'client_session_id', v_existing.client_session_id,
      'location_name', v_existing.location_name,
      'employee_name', v_existing.employee_name,
      'device_id', v_existing.device_id,
      'status', 'cancelled',
      'started_at', v_existing.started_at,
      'ended_at', v_existing.ended_at,
      'duration_minutes', v_existing.duration_minutes,
      'duration_display', v_existing.duration_display,
      'completion_source', v_existing.completion_source,
      'location_type', v_existing.location_type,
      'form_type', v_existing.form_type,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion'
    );
  end if;

  if v_existing.status in ('pending_submit','closed') then
    return jsonb_build_object(
      'session_uuid', v_existing.session_uuid,
      'client_session_id', v_existing.client_session_id,
      'location_name', v_existing.location_name,
      'employee_name', v_existing.employee_name,
      'device_id', v_existing.device_id,
      'status', v_existing.status,
      'started_at', v_existing.started_at,
      'ended_at', v_existing.ended_at,
      'duration_minutes', v_existing.duration_minutes,
      'duration_display', v_existing.duration_display,
      'completion_source', v_existing.completion_source,
      'location_type', v_existing.location_type,
      'form_type', v_existing.form_type,
      'replayed', true
    );
  end if;

  select * into v_finished
  from public.finish_session(p_location_code, v_canonical_device_id)
  limit 1;

  return jsonb_build_object(
    'session_uuid', v_finished.session_uuid,
    'location_name', v_finished.location_name,
    'employee_name', v_finished.employee_name,
    'device_id', v_finished.device_id,
    'status', v_finished.status,
    'started_at', v_finished.started_at,
    'ended_at', v_finished.ended_at,
    'duration_minutes', v_finished.duration_minutes,
    'duration_display', v_finished.duration_display,
    'location_type', v_existing.location_type,
    'form_type', v_existing.form_type,
    'replayed', false
  );
end
$function$;

create or replace function public.tool_complete_session(
  p_session_uuid text,
  p_response_json jsonb default '{}'::jsonb,
  p_submitted_by_employee_name text default null,
  p_device_id text default null,
  p_client_completion_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session record;
  v_presented_device_pk uuid;
  v_row record;
begin
  select s.id, s.session_uuid, s.client_session_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, s.device_id as session_device_pk,
         l.location_name, l.location_code, l.location_type, l.form_type,
         e.display_name as employee_name, d.device_id
    into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.session_uuid = p_session_uuid or s.client_session_id = p_session_uuid
  order by case when s.session_uuid = p_session_uuid then 0 else 1 end
  limit 1;

  if v_session.session_uuid is null then
    raise exception 'Session not found for server or client identifier: %', p_session_uuid;
  end if;

  if nullif(btrim(coalesce(p_device_id,'')), '') is not null then
    select d.id into v_presented_device_pk
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
    union all
    select d.id from public.devices d
    where d.active = true and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    limit 1;
    if v_presented_device_pk is null or v_presented_device_pk <> v_session.session_device_pk then
      raise exception 'Session does not belong to device %', p_device_id;
    end if;
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'completion_source', v_session.completion_source,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion'
    );
  end if;

  if v_session.status = 'closed' and exists(
    select 1 from public.completion_responses cr where cr.session_id = v_session.id
  ) then
    return (
      select jsonb_build_object(
        'session_uuid', v_session.session_uuid,
        'client_session_id', v_session.client_session_id,
        'location_code', v_session.location_code,
        'location_name', v_session.location_name,
        'location_type', v_session.location_type,
        'form_type', v_session.form_type,
        'employee_name', v_session.employee_name,
        'device_id', v_session.device_id,
        'status', 'closed',
        'submitted_at', cr.submitted_at,
        'replayed', true
      )
      from public.completion_responses cr
      where cr.session_id = v_session.id
      limit 1
    );
  end if;

  select * into v_row
  from public.complete_session(
    v_session.session_uuid,
    p_response_json,
    p_submitted_by_employee_name,
    v_session.device_id,
    p_client_completion_id
  )
  limit 1;

  return jsonb_build_object(
    'session_uuid', v_row.session_uuid,
    'client_session_id', v_session.client_session_id,
    'location_code', v_session.location_code,
    'location_name', v_row.location_name,
    'location_type', v_session.location_type,
    'form_type', v_session.form_type,
    'employee_name', v_row.employee_name,
    'device_id', v_session.device_id,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at,
    'replayed', false
  );
end
$function$;

create or replace function public.tool_commit_cleaning_workflow(
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
set search_path = pg_catalog, public
as $function$
declare
  v_session record;
  v_presented_device_pk uuid;
begin
  select s.id, s.session_uuid, s.client_session_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, s.device_id as session_device_pk,
         l.location_code, l.location_name, l.location_type, l.form_type,
         e.display_name as employee_name, d.device_id
    into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id = btrim(p_client_session_id)
  limit 1;

  if v_session.session_uuid is not null and v_session.status = 'cancelled' then
    select d.id into v_presented_device_pk
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
    union all
    select d.id from public.devices d
    where d.active = true and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    limit 1;

    if v_presented_device_pk is null or v_presented_device_pk <> v_session.session_device_pk then
      raise exception 'Session does not belong to device %', p_device_id;
    end if;

    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'client_completion_id', p_client_completion_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'completion_source', v_session.completion_source,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion',
      'correlation_id', p_correlation_id
    );
  end if;

  return public.commit_cleaning_workflow(
    p_client_session_id,
    p_client_completion_id,
    p_device_id,
    p_location_code,
    p_client_started_at,
    p_client_ended_at,
    p_response_json,
    p_scan_evidence,
    p_correlation_id
  );
end
$function$;

revoke all on function public.tool_finish_session(text,text) from public, anon, authenticated;
revoke all on function public.tool_complete_session(text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.tool_finish_session(text,text) to service_role;
grant execute on function public.tool_complete_session(text,jsonb,text,text,text) to service_role;
grant execute on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) to service_role;
