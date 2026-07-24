begin;

-- KIOSK_01 is the one manager-operated shared scan device. It intentionally
-- has no fixed employee assignment; KIOSK_02 through KIOSK_10 continue to
-- resolve employees exclusively through devices.assigned_employee_id.
insert into public.devices(device_id, device_name, active, assigned_employee_id, notes)
values (
  'KIOSK_01',
  'Ops Manager Shared Control',
  true,
  null,
  'Manager-authenticated shared scan device. Employee identity is selected per session and validated by the database.'
)
on conflict(device_id) do update
set device_name = excluded.device_name,
    active = true,
    assigned_employee_id = null,
    notes = excluded.notes,
    updated_at = now();

-- Shared-device selection is UUID-authoritative. Names remain presentation
-- only, so the employee list must include the immutable employee identifier.
create or replace function public.tool_list_active_employees()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', e.id,
        'employee_code', e.employee_code,
        'display_name', e.display_name,
        'role', e.role,
        'active', e.active
      )
      order by e.display_name, e.id
    ),
    '[]'::jsonb
  )
  from public.employees e
  where e.active is true;
$$;

revoke all on function public.tool_list_active_employees() from public, anon, authenticated;
grant execute on function public.tool_list_active_employees() to service_role;

create or replace function public.tool_start_shared_session_v1(
  p_location_code text,
  p_device_id text,
  p_selected_employee_id uuid,
  p_client_session_id text,
  p_client_started_at timestamptz,
  p_actor_manager_id uuid,
  p_correlation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_client_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
  v_location public.locations%rowtype;
  v_device public.devices%rowtype;
  v_employee public.employees%rowtype;
  v_session public.sessions%rowtype;
  v_started_at timestamptz;
begin
  if v_client_id is null or length(v_client_id) > 200 then
    raise exception using errcode = '22023', message = 'client_session_id is required and must be at most 200 characters';
  end if;
  if upper(btrim(coalesce(p_device_id, ''))) <> 'KIOSK_01' then
    raise exception using errcode = '42501', message = 'Shared employee selection is allowed only on KIOSK_01';
  end if;
  if p_selected_employee_id is null then
    raise exception using errcode = '22023', message = 'A selected employee id is required';
  end if;
  if p_actor_manager_id is null or not exists (
    select 1
    from public.ops_manager_managers m
    where m.manager_id = p_actor_manager_id
      and m.active is true
      and m.revoked_at is null
      and coalesce(m.roles, array[]::text[]) && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ) then
    raise exception using errcode = '42501', message = 'An active authorized Ops Manager is required for shared-device scanning';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-start:' || v_client_id, 0));

  select s.* into v_session
  from public.sessions s
  where s.client_session_id = v_client_id
  for update;

  if v_session.id is not null then
    select * into v_device from public.devices where id = v_session.device_id;
    select * into v_location from public.locations where id = v_session.location_id;
    select * into v_employee from public.employees where id = v_session.employee_id;
    if upper(btrim(v_device.device_id)) <> 'KIOSK_01' then
      raise exception 'client_session_id is already bound to another device';
    end if;
    if v_employee.id <> p_selected_employee_id then
      raise exception 'client_session_id is already bound to another employee';
    end if;
    if v_location.location_code <> public.resolve_scan_location_code(p_location_code) then
      raise exception 'client_session_id is already bound to another location';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_client_id,
      'location_code', v_location.location_code,
      'location_name', v_location.location_name,
      'location_type', v_location.location_type,
      'form_type', v_location.form_type,
      'employee_id', v_employee.id,
      'employee_name', v_employee.display_name,
      'device_id', v_device.device_id,
      'device_name', v_device.device_name,
      'status', v_session.status,
      'started_at', v_session.started_at,
      'replayed', true,
      'identity_source', 'manager_authorized_employee_id',
      'actor_manager_id', p_actor_manager_id,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    );
  end if;

  select * into v_location
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active is true
  for update;
  if v_location.id is null then
    raise exception 'Active location not found for code: %', p_location_code;
  end if;

  select * into v_device
  from public.devices d
  where upper(btrim(d.device_id)) = 'KIOSK_01'
    and d.active is true
  for update;
  if v_device.id is null then
    raise exception 'Active shared device KIOSK_01 was not found';
  end if;
  if v_device.assigned_employee_id is not null then
    raise exception 'KIOSK_01 must remain unassigned for shared-device scanning';
  end if;

  select * into v_employee
  from public.employees e
  where e.id = p_selected_employee_id
    and e.active is true
  for share;
  if v_employee.id is null then
    raise exception 'Selected employee is not active or does not exist';
  end if;

  perform public.expire_stale_open_sessions(now());
  if exists(select 1 from public.sessions s where s.device_id = v_device.id and s.status in ('active','pending_submit')) then
    raise exception 'KIOSK_01 already has another open session';
  end if;
  if exists(select 1 from public.sessions s where s.employee_id = v_employee.id and s.status in ('active','pending_submit')) then
    raise exception 'Selected employee already has another open session: %', v_employee.display_name;
  end if;
  if exists(select 1 from public.sessions s where s.location_id = v_location.id and s.status in ('active','pending_submit')) then
    raise exception 'Location already has another open session: %', v_location.location_code;
  end if;

  v_started_at := coalesce(p_client_started_at, now());
  if v_started_at > now() + interval '10 minutes' then
    raise exception 'client_started_at is too far in the future';
  end if;
  if v_started_at < now() - interval '7 days' then
    raise exception 'client_started_at is too old';
  end if;

  insert into public.sessions(
    session_uuid,
    client_session_id,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    completion_source
  ) values (
    gen_random_uuid()::text,
    v_client_id,
    v_location.id,
    v_employee.id,
    v_device.id,
    'active',
    v_started_at,
    null
  )
  returning * into v_session;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session.id,
    'session_started',
    'ops_manager',
    p_actor_manager_id::text,
    jsonb_build_object(
      'location_code', v_location.location_code,
      'device_id', v_device.device_id,
      'employee_id', v_employee.id,
      'employee_name', v_employee.display_name,
      'client_session_id', v_client_id,
      'identity_source', 'manager_authorized_employee_id',
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'tool_start_shared_session_v1', 'Manager-authorized shared session started', v_session.id, v_location.id, v_device.id);

  return jsonb_build_object(
    'session_uuid', v_session.session_uuid,
    'client_session_id', v_client_id,
    'location_code', v_location.location_code,
    'location_name', v_location.location_name,
    'location_type', v_location.location_type,
    'form_type', v_location.form_type,
    'employee_id', v_employee.id,
    'employee_name', v_employee.display_name,
    'device_id', v_device.device_id,
    'device_name', v_device.device_name,
    'status', v_session.status,
    'started_at', v_session.started_at,
    'replayed', false,
    'identity_source', 'manager_authorized_employee_id',
    'actor_manager_id', p_actor_manager_id,
    'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
  );
end;
$$;

revoke all on function public.tool_start_shared_session_v1(text,text,uuid,text,timestamptz,uuid,text) from public, anon, authenticated;
grant execute on function public.tool_start_shared_session_v1(text,text,uuid,text,timestamptz,uuid,text) to service_role;

-- The shared completion wrapper keeps finish + completion in one database
-- transaction. If either half fails, PostgreSQL rolls both back.
create or replace function public.tool_commit_shared_cleaning_workflow_v1(
  p_client_session_id text,
  p_client_completion_id text,
  p_device_id text,
  p_location_code text,
  p_client_started_at timestamptz,
  p_client_ended_at timestamptz,
  p_response_json jsonb,
  p_scan_evidence jsonb,
  p_actor_manager_id uuid,
  p_correlation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_session public.sessions%rowtype;
  v_device public.devices%rowtype;
  v_employee public.employees%rowtype;
  v_location public.locations%rowtype;
  v_result jsonb;
begin
  if upper(btrim(coalesce(p_device_id, ''))) <> 'KIOSK_01' then
    raise exception using errcode = '42501', message = 'Shared completion is allowed only on KIOSK_01';
  end if;
  if p_client_session_id is null or btrim(p_client_session_id) = '' then
    raise exception using errcode = '22023', message = 'p_client_session_id is required';
  end if;
  if p_client_completion_id is null
     or p_client_completion_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'p_client_completion_id must be a stable UUID';
  end if;
  if p_actor_manager_id is null or not exists (
    select 1 from public.ops_manager_managers m
    where m.manager_id = p_actor_manager_id
      and m.active is true
      and m.revoked_at is null
      and coalesce(m.roles, array[]::text[]) && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ) then
    raise exception using errcode = '42501', message = 'An active authorized Ops Manager is required for shared-device completion';
  end if;

  select s.* into v_session
  from public.sessions s
  where s.client_session_id = btrim(p_client_session_id)
  for update;
  if v_session.id is null then
    raise exception 'KIOSK_01 completion requires a server-authorized start session';
  end if;
  select * into v_device from public.devices where id = v_session.device_id;
  select * into v_employee from public.employees where id = v_session.employee_id;
  select * into v_location from public.locations where id = v_session.location_id;
  if upper(btrim(v_device.device_id)) <> 'KIOSK_01' then
    raise exception 'Shared completion session does not belong to KIOSK_01';
  end if;
  if v_location.location_code <> public.resolve_scan_location_code(p_location_code) then
    raise exception 'Shared completion session is bound to another location';
  end if;

  if v_session.status = 'active' then
    perform public.tool_finish_session_exact(
      v_session.client_session_id,
      'KIOSK_01',
      p_client_completion_id::uuid,
      p_client_ended_at
    );
  end if;

  v_result := public.tool_complete_session(
    v_session.client_session_id,
    coalesce(p_response_json, '{}'::jsonb),
    v_employee.display_name,
    'KIOSK_01',
    p_client_completion_id
  );

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  select
    v_session.id,
    'shared_device_completion_authorized',
    'ops_manager',
    p_actor_manager_id::text,
    jsonb_build_object(
      'device_id', 'KIOSK_01',
      'employee_id', v_employee.id,
      'client_session_id', v_session.client_session_id,
      'client_completion_id', p_client_completion_id,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), ''),
      'scan_evidence_count', case when jsonb_typeof(coalesce(p_scan_evidence, '[]'::jsonb)) = 'array' then jsonb_array_length(coalesce(p_scan_evidence, '[]'::jsonb)) else 0 end
    )
  where not exists (
    select 1
    from public.session_events se
    where se.session_id = v_session.id
      and se.event_type = 'shared_device_completion_authorized'
      and se.details_json->>'client_completion_id' = p_client_completion_id
  );

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'employee_id', v_employee.id,
    'actor_manager_id', p_actor_manager_id,
    'identity_source', 'manager_authorized_employee_id',
    'atomic_shared_commit', true
  );
end;
$$;

revoke all on function public.tool_commit_shared_cleaning_workflow_v1(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.tool_commit_shared_cleaning_workflow_v1(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,uuid,text) to service_role;

comment on function public.tool_start_shared_session_v1(text,text,uuid,text,timestamptz,uuid,text) is
  'Starts KIOSK_01 work for one active employee selected by a server-authenticated Ops Manager. Fixed employee kiosks never call this function.';
comment on function public.tool_commit_shared_cleaning_workflow_v1(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,uuid,text) is
  'Atomically finishes and completes an existing KIOSK_01 session under a server-authenticated Ops Manager identity.';
comment on function public.tool_list_active_employees() is
  'Returns active employee presentation fields plus employee_id for manager-authorized KIOSK_01 selection.';

commit;
