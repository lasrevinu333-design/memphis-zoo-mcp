-- Preserve the production July 15 cancellation-reconciliation behavior in source control.
-- A phone may still hold start/finish/completion queue entries after an administrator
-- safely cancels the corresponding server session. These wrappers return a terminal,
-- idempotent acknowledgement so the phone can discard only that cancelled local
-- workflow without inventing a cleaning completion.

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
begin
  select
    s.id,
    s.session_uuid,
    s.client_session_id,
    s.status,
    s.started_at,
    s.ended_at,
    s.duration_minutes,
    s.duration_display,
    l.location_code,
    l.location_name,
    l.location_type,
    l.form_type,
    d.device_id,
    d.device_name,
    e.display_name as employee_name
  into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where s.client_session_id = nullif(btrim(coalesce(p_client_session_id, '')), '')
  limit 1;

  if v_session.id is not null and v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'client_completion_id', nullif(btrim(coalesce(p_client_completion_id, '')), ''),
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'device_name', v_session.device_name,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'terminal', true,
      'discard_local_workflow', true,
      'authoritative_completion', false,
      'replayed', true,
      'reason', 'server_session_cancelled',
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
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
  v_session record;
  v_result record;
begin
  select
    s.session_uuid,
    s.client_session_id,
    s.status,
    s.started_at,
    s.ended_at,
    s.duration_minutes,
    s.duration_display,
    l.location_code,
    l.location_name,
    l.location_type,
    l.form_type,
    d.device_id,
    d.device_name,
    e.display_name as employee_name
  into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and d.id = coalesce(
      (
        select da.canonical_device_id
        from public.device_aliases da
        where da.active = true
          and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
        limit 1
      ),
      (
        select direct_device.id
        from public.devices direct_device
        where direct_device.active = true
          and upper(btrim(direct_device.device_id)) = upper(btrim(p_device_id))
        limit 1
      )
    )
  order by
    case s.status
      when 'active' then 0
      when 'pending_submit' then 1
      when 'closed' then 2
      when 'cancelled' then 3
      else 4
    end,
    s.started_at desc
  limit 1;

  if v_session.session_uuid is not null and v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'device_name', v_session.device_name,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'terminal', true,
      'discard_local_workflow', true,
      'authoritative_completion', false,
      'replayed', true,
      'reason', 'server_session_cancelled'
    );
  end if;

  select * into v_result
  from public.finish_session(p_location_code, p_device_id);

  return to_jsonb(v_result);
end
$function$;

create or replace function public.tool_complete_session(
  p_session_uuid text,
  p_response_json jsonb,
  p_device_id text,
  p_location_code text,
  p_employee_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session record;
  v_result record;
begin
  select
    s.session_uuid,
    s.client_session_id,
    s.status,
    s.started_at,
    s.ended_at,
    s.duration_minutes,
    s.duration_display,
    l.location_code,
    l.location_name,
    l.location_type,
    l.form_type,
    d.device_id,
    d.device_name,
    e.display_name as employee_name
  into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where s.session_uuid = nullif(btrim(coalesce(p_session_uuid, '')), '')
     or s.client_session_id = nullif(btrim(coalesce(p_session_uuid, '')), '')
  order by case when s.session_uuid = p_session_uuid then 0 else 1 end
  limit 1;

  if v_session.session_uuid is not null and v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'device_name', v_session.device_name,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'terminal', true,
      'discard_local_workflow', true,
      'authoritative_completion', false,
      'replayed', true,
      'reason', 'server_session_cancelled'
    );
  end if;

  select * into v_result
  from public.complete_session(
    p_session_uuid,
    p_response_json,
    p_device_id,
    p_location_code,
    p_employee_name
  );

  return to_jsonb(v_result);
end
$function$;

revoke all on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.tool_finish_session(text,text) from public, anon, authenticated;
revoke all on function public.tool_complete_session(text,jsonb,text,text,text) from public, anon, authenticated;

grant execute on function public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text) to service_role;
grant execute on function public.tool_finish_session(text,text) to service_role;
grant execute on function public.tool_complete_session(text,jsonb,text,text,text) to service_role;
