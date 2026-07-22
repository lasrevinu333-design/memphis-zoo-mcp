begin;

create or replace function public.custodial_assign_employee_device(
  p_device_identifier text,
  p_employee_id uuid default null,
  p_changed_by_manager_id uuid default null,
  p_reason text default null,
  p_move_existing boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_identifier text := upper(regexp_replace(btrim(coalesce(p_device_identifier, '')), '^KIOSK[-_ ]?', 'KIOSK_', 'i'));
  v_device public.devices%rowtype;
  v_old_employee public.employees%rowtype;
  v_new_employee public.employees%rowtype;
  v_new_user public.msg_users%rowtype;
  v_other_device public.devices%rowtype;
  v_alias text;
  v_changed boolean := false;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  v_manager := public.custodial_assert_manager(p_changed_by_manager_id);
  if v_identifier ~ '^KIOSK_[2-9]$' then
    v_identifier := 'KIOSK_0' || substring(v_identifier from 7);
  end if;
  if v_identifier !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode = '22023', message = 'Choose an employee kiosk from KIOSK_02 through KIOSK_10.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('custodial-device-assignment:' || v_identifier, 0));
  select * into v_device
  from public.devices
  where upper(device_id) = v_identifier and active is true
  for update;
  if v_device.id is null then
    raise exception using errcode = 'P0002', message = 'Active employee kiosk not found.';
  end if;

  if v_device.assigned_employee_id is not null then
    select * into v_old_employee from public.employees where id = v_device.assigned_employee_id;
  end if;

  if p_employee_id is not null then
    select * into v_new_employee
    from public.employees
    where id = p_employee_id
    for update;
    if v_new_employee.id is null then
      raise exception using errcode = 'P0002', message = 'Employee not found.';
    end if;
    if v_new_employee.active is not true or v_new_employee.role <> 'staff' or v_new_employee.employee_code !~ '^EMP[0-9]+$' then
      raise exception using errcode = '22023', message = 'Only an active Memphis Zoo custodial employee can be assigned to a phone.';
    end if;

    select * into v_new_user
    from public.msg_users
    where employee_id = v_new_employee.id
    for update;
    if v_new_user.id is null then
      if exists (select 1 from public.msg_users where lower(btrim(display_name)) = lower(v_new_employee.display_name)) then
        raise exception using errcode = '23505', message = 'Messenger already contains a different user with this employee name.';
      end if;
      insert into public.msg_users(employee_id, display_name, role, is_active)
      values (v_new_employee.id, v_new_employee.display_name, 'employee', true)
      returning * into v_new_user;
    else
      update public.msg_users
      set display_name = v_new_employee.display_name,
          role = 'employee',
          is_active = true,
          updated_at = now()
      where id = v_new_user.id
      returning * into v_new_user;
    end if;

    select * into v_other_device
    from public.devices
    where assigned_employee_id = v_new_employee.id
      and id <> v_device.id
      and active is true
    order by device_id
    limit 1
    for update;

    if v_other_device.id is not null and not p_move_existing then
      raise exception using errcode = '23505', message = format('%s is already assigned to %s. Confirm moving the employee to this phone.', v_new_employee.display_name, v_other_device.device_id);
    end if;

    if v_other_device.id is not null then
      update public.devices
      set assigned_employee_id = null,
          device_name = 'Unassigned ' || v_other_device.device_id,
          updated_at = now()
      where id = v_other_device.id;

      update public.msg_device_assignments
      set is_active = false,
          notes = 'Phone unassigned by Operations app',
          updated_at = now()
      where upper(device_identifier) = upper(v_other_device.device_id)
         or upper(device_identifier) in (
           select upper(alias_identifier) from public.device_aliases
           where canonical_device_id = v_other_device.id and active is true
         );

      insert into public.custodial_employee_device_assignment_history(
        device_id, device_identifier, previous_employee_id, previous_employee_name,
        new_employee_id, new_employee_name, changed_by_manager_id,
        change_reason, source, metadata_json
      ) values (
        v_other_device.id, v_other_device.device_id, v_new_employee.id, v_new_employee.display_name,
        null, null, v_manager.manager_id,
        coalesce(v_reason, 'moved_to_' || v_device.device_id), 'operations_app',
        jsonb_build_object('moved_to_device', v_device.device_id)
      );
    end if;
  end if;

  v_changed := v_device.assigned_employee_id is distinct from p_employee_id;

  update public.devices
  set assigned_employee_id = p_employee_id,
      device_name = case when p_employee_id is null then 'Unassigned ' || v_device.device_id else v_new_employee.display_name end,
      updated_at = now()
  where id = v_device.id
  returning * into v_device;

  if p_employee_id is null then
    update public.msg_device_assignments
    set is_active = false,
        notes = 'Phone unassigned by Operations app',
        updated_at = now()
    where upper(device_identifier) = upper(v_device.device_id)
       or upper(device_identifier) in (
         select upper(alias_identifier) from public.device_aliases
         where canonical_device_id = v_device.id and active is true
       );
  else
    insert into public.msg_device_assignments(device_identifier, msg_user_id, is_active, notes)
    values (v_device.device_id, v_new_user.id, true, 'Managed by Operations app')
    on conflict (device_identifier) do update
    set msg_user_id = excluded.msg_user_id,
        is_active = true,
        notes = excluded.notes,
        updated_at = now();

    for v_alias in
      select alias_identifier from public.device_aliases
      where canonical_device_id = v_device.id and active is true
    loop
      insert into public.msg_device_assignments(device_identifier, msg_user_id, is_active, notes)
      values (v_alias, v_new_user.id, true, 'Managed alias for ' || v_device.device_id)
      on conflict (device_identifier) do update
      set msg_user_id = excluded.msg_user_id,
          is_active = true,
          notes = excluded.notes,
          updated_at = now();
    end loop;
  end if;

  if v_changed or v_other_device.id is not null then
    insert into public.custodial_employee_device_assignment_history(
      device_id, device_identifier, previous_employee_id, previous_employee_name,
      new_employee_id, new_employee_name, changed_by_manager_id,
      change_reason, source, metadata_json
    ) values (
      v_device.id, v_device.device_id, v_old_employee.id, v_old_employee.display_name,
      v_new_employee.id, v_new_employee.display_name, v_manager.manager_id,
      coalesce(v_reason, case when p_employee_id is null then 'phone_unassigned' else 'phone_reassigned' end),
      'operations_app',
      jsonb_build_object('move_existing', p_move_existing, 'messenger_user_id', v_new_user.id)
    );
  end if;

  return jsonb_build_object(
    'changed', v_changed,
    'device', jsonb_build_object(
      'device_pk', v_device.id,
      'device_id', v_device.device_id,
      'device_name', v_device.device_name,
      'assigned_employee_id', v_device.assigned_employee_id,
      'assigned_employee_name', v_new_employee.display_name
    ),
    'previous_employee', case when v_old_employee.id is null then null else jsonb_build_object('id', v_old_employee.id, 'display_name', v_old_employee.display_name, 'employee_code', v_old_employee.employee_code) end,
    'new_employee', case when v_new_employee.id is null then null else jsonb_build_object('id', v_new_employee.id, 'display_name', v_new_employee.display_name, 'employee_code', v_new_employee.employee_code, 'msg_user_id', v_new_user.id) end,
    'moved_from_device', v_other_device.device_id
  );
end;
$$;

revoke all on function public.custodial_assign_employee_device(text,uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.custodial_assign_employee_device(text,uuid,uuid,text,boolean) to service_role;

commit;
