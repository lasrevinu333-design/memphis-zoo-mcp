-- Deployed migration history snapshot: 20260714123412 scan_state_v2_recovery_20260714

create or replace function public.tool_get_location_scan_state_v2(
  p_location_code text,
  p_device_id text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with base as (
    select *
    from public.get_location_scan_state(p_location_code, p_device_id)
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'found', true,
        'location_code', b.location_code,
        'location_name', b.location_name,
        'location_type', b.location_type,
        'form_type', coalesce(l.form_type, b.location_type),
        'location_active', b.location_active,
        'device_approved', b.device_approved,
        'assigned_device_employee_name', de.display_name,
        'assigned_device_name', d.device_name,
        'latest_session_uuid', b.latest_session_uuid,
        'latest_client_session_id', s.client_session_id,
        'latest_session_status', b.latest_session_status,
        'latest_employee_name', b.latest_employee_name,
        'latest_device_id', b.latest_device_id,
        'started_at', b.started_at,
        'ended_at', b.ended_at,
        'duration_minutes', s.duration_minutes,
        'duration_display', s.duration_display,
        'completion_source', s.completion_source,
        'suggested_action', b.suggested_action
      )
      from base b
      left join public.locations l on l.location_code = b.location_code
      left join public.devices d
        on upper(btrim(d.device_id)) = upper(btrim(coalesce(p_device_id, '')))
       and d.active = true
      left join public.employees de on de.id = d.assigned_employee_id and de.active = true
      left join public.sessions s on s.session_uuid = b.latest_session_uuid
      limit 1
    ),
    jsonb_build_object(
      'found', false,
      'location_code', public.resolve_scan_location_code(p_location_code),
      'device_approved', public.is_approved_device(p_device_id),
      'message', 'No scan state found'
    )
  );
$function$;

revoke execute on function public.tool_get_location_scan_state_v2(text, text) from public, anon, authenticated;
grant execute on function public.tool_get_location_scan_state_v2(text, text) to service_role;

comment on function public.tool_get_location_scan_state_v2(text, text) is
  'Returns authoritative scan state including client/server session identity for recovery after browser restart or offline synchronization.';
