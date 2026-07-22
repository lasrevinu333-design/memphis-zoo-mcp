begin;

create table if not exists public.employee_phone_assignment_events (
  event_id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  device_id uuid references public.devices(id) on delete set null,
  device_identifier text,
  previous_employee_id uuid references public.employees(id) on delete set null,
  new_employee_id uuid references public.employees(id) on delete set null,
  manager_id uuid references public.ops_manager_managers(manager_id) on delete set null,
  event_type text not null,
  details_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_phone_assignment_events_device
  on public.employee_phone_assignment_events(device_identifier, created_at desc);
create index if not exists idx_employee_phone_assignment_events_employee
  on public.employee_phone_assignment_events(new_employee_id, created_at desc);

alter table public.employee_phone_assignment_events enable row level security;
revoke all on table public.employee_phone_assignment_events from public, anon, authenticated;
grant select, insert on table public.employee_phone_assignment_events to service_role;

create or replace function public.ops_reassign_employee_phone(
  p_operation_id uuid,
  p_device_identifier text default null,
  p_employee_id uuid default null,
  p_new_employee_name text default null,
  p_expected_current_employee_id uuid default null,
  p_deactivate_previous boolean default false,
  p_manager_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation_id uuid := coalesce(p_operation_id, gen_random_uuid());
  v_identifier text := nullif(upper(btrim(coalesce(p_device_identifier, ''))), '');
  v_new_name text := nullif(regexp_replace(btrim(coalesce(p_new_employee_name, '')), '\s+', ' ', 'g'), '');
  v_device public.devices%rowtype;
  v_previous_employee public.employees%rowtype;
  v_employee public.employees%rowtype;
  v_msg_user_id uuid;
  v_employee_code text;
  v_existing_device text;
  v_existing_result jsonb;
  v_created_employee boolean := false;
  v_previous_deactivated boolean := false;
  v_event_type text;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'Service-role phone assignment access is required.';
  end if;

  select result_json into v_existing_result
  from public.employee_phone_assignment_events
  where operation_id = v_operation_id;
  if found then
    return v_existing_result;
  end if;

  if p_employee_id is not null and v_new_name is not null then
    raise exception using errcode = '22023', message = 'Choose an existing employee or create a new employee, not both.';
  end if;
  if v_identifier is null and v_new_name is null then
    raise exception using errcode = '22023', message = 'A new employee name is required when no phone is selected.';
  end if;
  if v_identifier is not null and v_identifier !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode = '22023', message = 'Only KIOSK_02 through KIOSK_10 can be reassigned.';
  end if;

  if v_new_name is not null then
    if length(v_new_name) < 2 then
      raise exception using errcode = '22023', message = 'Employee name is too short.';
    end if;
    if exists (select 1 from public.employees where lower(display_name) = lower(v_new_name)) then
      raise exception using errcode = '23505', message = 'An employee with that name already exists. Select the existing employee instead.';
    end if;
    perform pg_advisory_xact_lock(hashtext('memphis_employee_code_sequence'));
    select 'EMP' || lpad((coalesce(max(substring(employee_code from 4)::integer), 0) + 1)::text, 3, '0')
      into v_employee_code
    from public.employees
    where employee_code ~ '^EMP[0-9]+$';

    insert into public.employees(employee_code, display_name, active, role, notes, created_at, updated_at)
    values (v_employee_code, v_new_name, true, 'staff', 'Created through Phone Assignments.', now(), now())
    returning * into v_employee;
    v_created_employee := true;
  elsif p_employee_id is not null then
    select * into v_employee
    from public.employees
    where id = p_employee_id
    for update;
    if not found or v_employee.active is not true then
      raise exception using errcode = '22023', message = 'Choose an active employee.';
    end if;
    if coalesce(v_employee.employee_code, '') !~ '^EMP[0-9]+$' then
      raise exception using errcode = '22023', message = 'Only custodial EMP-number employees can be assigned to kiosk phones.';
    end if;
  end if;

  if v_employee.id is not null then
    insert into public.msg_users(employee_id, display_name, role, is_active, active, created_at, updated_at)
    values (v_employee.id, v_employee.display_name, 'employee', true, true, now(), now())
    on conflict (employee_id) do update set
      display_name = excluded.display_name,
      role = 'employee',
      is_active = true,
      active = true,
      updated_at = now()
    returning id into v_msg_user_id;
  end if;

  if v_identifier is not null then
    select * into v_device
    from public.devices
    where upper(device_id) = v_identifier
      and active is true
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Active employee kiosk phone not found.';
    end if;

    if p_expected_current_employee_id is not null
       and v_device.assigned_employee_id is distinct from p_expected_current_employee_id then
      raise exception using errcode = '40001', message = 'This phone assignment changed on another screen. Refresh and try again.';
    end if;

    if exists (
      select 1 from public.sessions s
      where s.device_id = v_device.id
        and s.ended_at is null
        and lower(coalesce(s.status, '')) not in ('closed', 'cancelled', 'completed', 'finished')
    ) then
      raise exception using errcode = '55000', message = 'Finish or force-close the active cleaning before reassigning this phone.';
    end if;

    if v_device.assigned_employee_id is not null then
      select * into v_previous_employee from public.employees where id = v_device.assigned_employee_id;
    end if;

    if v_employee.id is not null then
      select d.device_id into v_existing_device
      from public.devices d
      where d.active is true
        and d.assigned_employee_id = v_employee.id
        and d.id <> v_device.id
      limit 1;
      if v_existing_device is not null then
        raise exception using errcode = '23505', message = format('%s is already assigned to %s.', v_employee.display_name, v_existing_device);
      end if;
    end if;

    update public.devices
    set assigned_employee_id = v_employee.id,
        device_name = case when v_employee.id is null then 'Unassigned ' || v_identifier else v_employee.display_name end,
        updated_at = now()
    where id = v_device.id
    returning * into v_device;

    if v_employee.id is null then
      update public.msg_device_assignments
      set is_active = false,
          notes = 'Unassigned through Phone Assignments.',
          updated_at = now()
      where device_identifier = v_identifier;
    else
      insert into public.msg_device_assignments(device_identifier, msg_user_id, is_active, notes, created_at, updated_at)
      values (v_identifier, v_msg_user_id, true, 'Assigned through Phone Assignments.', now(), now())
      on conflict (device_identifier) do update set
        msg_user_id = excluded.msg_user_id,
        is_active = true,
        notes = excluded.notes,
        updated_at = now();
    end if;

    delete from public.msg_hidden_threads_by_device where device_identifier = v_identifier;
  end if;

  if p_deactivate_previous
     and v_previous_employee.id is not null
     and v_previous_employee.id is distinct from v_employee.id then
    if exists (
      select 1 from public.devices d
      where d.active is true
        and d.assigned_employee_id = v_previous_employee.id
    ) then
      raise exception using errcode = '55000', message = 'The former employee is still assigned to another active phone and was not deactivated.';
    end if;
    update public.employees
    set active = false,
        notes = concat_ws(E'\n', nullif(notes, ''), 'Deactivated during phone reassignment on ' || to_char(now(), 'YYYY-MM-DD HH24:MI TZ')),
        updated_at = now()
    where id = v_previous_employee.id;
    update public.msg_users
    set is_active = false,
        active = false,
        updated_at = now()
    where employee_id = v_previous_employee.id;
    v_previous_deactivated := true;
  end if;

  if v_employee.id is not null then
    perform public.msg_ensure_employee_memphis_threads();
  end if;

  v_event_type := case
    when v_created_employee and v_identifier is not null then 'create_employee_and_assign_phone'
    when v_created_employee then 'create_employee'
    when v_identifier is not null and v_employee.id is null then 'unassign_phone'
    else 'reassign_phone'
  end;

  v_result := jsonb_build_object(
    'operation_id', v_operation_id,
    'event_type', v_event_type,
    'device', case when v_identifier is null then null else jsonb_build_object(
      'id', v_device.id,
      'device_id', v_device.device_id,
      'device_name', v_device.device_name,
      'assigned_employee_id', v_device.assigned_employee_id,
      'refresh_required', true
    ) end,
    'employee', case when v_employee.id is null then null else jsonb_build_object(
      'id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'active', true,
      'created', v_created_employee
    ) end,
    'previous_employee', case when v_previous_employee.id is null then null else jsonb_build_object(
      'id', v_previous_employee.id,
      'employee_code', v_previous_employee.employee_code,
      'display_name', v_previous_employee.display_name,
      'deactivated', v_previous_deactivated
    ) end,
    'created_employee', v_created_employee,
    'previous_deactivated', v_previous_deactivated,
    'completed_at', now()
  );

  insert into public.employee_phone_assignment_events(
    operation_id, device_id, device_identifier, previous_employee_id, new_employee_id,
    manager_id, event_type, details_json, result_json
  ) values (
    v_operation_id,
    v_device.id,
    v_identifier,
    v_previous_employee.id,
    v_employee.id,
    p_manager_id,
    v_event_type,
    jsonb_build_object('deactivate_previous', p_deactivate_previous, 'expected_current_employee_id', p_expected_current_employee_id),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ops_reassign_employee_phone(uuid, text, uuid, text, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.ops_reassign_employee_phone(uuid, text, uuid, text, uuid, boolean, uuid) to service_role;

comment on function public.ops_reassign_employee_phone(uuid, text, uuid, text, uuid, boolean, uuid)
is 'Atomically creates or selects a custodial employee, reassigns a canonical kiosk phone, synchronizes Messenger identity, optionally offboards the previous employee, and preserves historical cleaning records.';

commit;
