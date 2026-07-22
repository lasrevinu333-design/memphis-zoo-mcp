begin;

create or replace function public.custodial_set_employee_active(
  p_employee_id uuid,
  p_active boolean,
  p_changed_by_manager_id uuid default null,
  p_reason text default null,
  p_release_devices boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_employee public.employees%rowtype;
  v_device public.devices%rowtype;
  v_previous boolean;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_released text[] := '{}'::text[];
begin
  v_manager := public.custodial_assert_manager(p_changed_by_manager_id);
  select * into v_employee from public.employees where id = p_employee_id for update;
  if v_employee.id is null then
    raise exception using errcode = 'P0002', message = 'Employee not found.';
  end if;
  if v_employee.employee_code !~ '^EMP[0-9]+$' then
    raise exception using errcode = '22023', message = 'CoverAll and system staffing slots cannot be changed from Employee Phones.';
  end if;
  v_previous := v_employee.active;
  if v_previous = p_active then
    return jsonb_build_object('changed', false, 'employee', to_jsonb(v_employee), 'released_devices', v_released);
  end if;

  if p_active is false and not p_release_devices and exists (
    select 1 from public.devices where assigned_employee_id = v_employee.id and active is true
  ) then
    raise exception using errcode = '23503', message = 'Release the employee phone before marking this employee inactive.';
  end if;

  if p_active is false and p_release_devices then
    for v_device in
      select * from public.devices
      where assigned_employee_id = v_employee.id and active is true
      order by device_id
      for update
    loop
      update public.devices
      set assigned_employee_id = null,
          device_name = 'Unassigned ' || v_device.device_id,
          updated_at = now()
      where id = v_device.id;

      update public.msg_device_assignments
      set is_active = false,
          notes = 'Employee inactive; phone released by Operations app',
          updated_at = now()
      where upper(device_identifier) = upper(v_device.device_id)
         or upper(device_identifier) in (
           select upper(alias_identifier) from public.device_aliases
           where canonical_device_id = v_device.id and active is true
         );

      insert into public.custodial_employee_device_assignment_history(
        device_id, device_identifier, previous_employee_id, previous_employee_name,
        new_employee_id, new_employee_name, changed_by_manager_id,
        change_reason, source, metadata_json
      ) values (
        v_device.id, v_device.device_id, v_employee.id, v_employee.display_name,
        null, null, v_manager.manager_id,
        coalesce(v_reason, 'employee_inactivated'), 'operations_app',
        jsonb_build_object('employee_status_changed', true)
      );
      v_released := array_append(v_released, v_device.device_id);
    end loop;
  end if;

  update public.employees
  set active = p_active,
      updated_at = now(),
      notes = case
        when p_active then notes
        when v_reason is null then notes
        when notes is null or btrim(notes) = '' then 'Inactive: ' || v_reason
        else notes || E'\nInactive: ' || v_reason
      end
  where id = v_employee.id
  returning * into v_employee;

  update public.msg_users
  set is_active = p_active,
      active = p_active,
      display_name = v_employee.display_name,
      updated_at = now()
  where employee_id = v_employee.id;

  insert into public.custodial_employee_status_history(
    employee_id, employee_name, previous_active, new_active,
    changed_by_manager_id, change_reason, source, metadata_json
  ) values (
    v_employee.id, v_employee.display_name, v_previous, p_active,
    v_manager.manager_id,
    coalesce(v_reason, case when p_active then 'employee_reactivated' else 'employee_inactivated' end),
    'operations_app',
    jsonb_build_object('released_devices', to_jsonb(v_released))
  );

  return jsonb_build_object(
    'changed', true,
    'employee', to_jsonb(v_employee),
    'released_devices', to_jsonb(v_released)
  );
end;
$$;

revoke all on function public.custodial_set_employee_active(uuid,boolean,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.custodial_set_employee_active(uuid,boolean,uuid,text,boolean) to service_role;

commit;
