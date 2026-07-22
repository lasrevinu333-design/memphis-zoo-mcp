begin;

create table if not exists public.custodial_employee_device_assignment_history (
  assignment_change_id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete restrict,
  device_identifier text not null,
  previous_employee_id uuid references public.employees(id) on delete set null,
  previous_employee_name text,
  new_employee_id uuid references public.employees(id) on delete set null,
  new_employee_name text,
  changed_by_manager_id uuid references public.ops_manager_managers(manager_id) on delete set null,
  change_reason text,
  source text not null default 'operations_app',
  metadata_json jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists idx_custodial_employee_device_history_device_time
  on public.custodial_employee_device_assignment_history(device_id, changed_at desc);
create index if not exists idx_custodial_employee_device_history_employee_time
  on public.custodial_employee_device_assignment_history(new_employee_id, changed_at desc);

create table if not exists public.custodial_employee_status_history (
  status_change_id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_name text not null,
  previous_active boolean,
  new_active boolean not null,
  changed_by_manager_id uuid references public.ops_manager_managers(manager_id) on delete set null,
  change_reason text,
  source text not null default 'operations_app',
  metadata_json jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists idx_custodial_employee_status_history_employee_time
  on public.custodial_employee_status_history(employee_id, changed_at desc);

create or replace function public.custodial_assert_manager(
  p_manager_id uuid
) returns public.ops_manager_managers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
begin
  if p_manager_id is null then
    raise exception using errcode = '22023', message = 'Custodial Manager identity is required.';
  end if;
  select * into v_manager
  from public.ops_manager_managers
  where manager_id = p_manager_id
    and active is true
    and revoked_at is null
    and is_system_principal is false
  limit 1;
  if v_manager.manager_id is null or not ('CUSTODIAL_MANAGER' = any(coalesce(v_manager.roles, '{}'::text[]))) then
    raise exception using errcode = '42501', message = 'Custodial Manager access is required.';
  end if;
  return v_manager;
end;
$$;

create or replace function public.custodial_next_employee_code()
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  with numbers as (
    select generate_series(1, 999) as n
  )
  select 'EMP' || lpad(n::text, 3, '0')
  from numbers
  where not exists (
    select 1 from public.employees e
    where upper(coalesce(e.employee_code, '')) = 'EMP' || lpad(n::text, 3, '0')
  )
  order by n
  limit 1;
$$;

create or replace function public.custodial_create_employee(
  p_display_name text,
  p_employee_code text default null,
  p_notes text default null,
  p_changed_by_manager_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
  v_code text := upper(btrim(coalesce(p_employee_code, '')));
  v_employee public.employees%rowtype;
  v_user public.msg_users%rowtype;
begin
  v_manager := public.custodial_assert_manager(p_changed_by_manager_id);
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'Employee name must be between 2 and 160 characters.';
  end if;
  if exists (select 1 from public.employees where lower(btrim(display_name)) = lower(v_name)) then
    raise exception using errcode = '23505', message = 'An employee record with that name already exists. Reactivate the existing record instead.';
  end if;
  if v_code = '' then v_code := public.custodial_next_employee_code(); end if;
  if v_code is null or v_code !~ '^EMP[0-9]{3,6}$' then
    raise exception using errcode = '22023', message = 'Employee code must use the EMP number format, such as EMP010.';
  end if;
  if exists (select 1 from public.employees where upper(coalesce(employee_code, '')) = v_code) then
    raise exception using errcode = '23505', message = 'That employee code is already in use.';
  end if;

  insert into public.employees(employee_code, display_name, active, role, notes)
  values (v_code, v_name, true, 'staff', nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_employee;

  insert into public.msg_users(employee_id, display_name, role, is_active)
  values (v_employee.id, v_employee.display_name, 'employee', true)
  returning * into v_user;

  insert into public.custodial_employee_status_history(
    employee_id, employee_name, previous_active, new_active,
    changed_by_manager_id, change_reason, source, metadata_json
  ) values (
    v_employee.id, v_employee.display_name, null, true,
    v_manager.manager_id, 'employee_created', 'operations_app',
    jsonb_build_object('employee_code', v_employee.employee_code, 'msg_user_id', v_user.id)
  );

  return jsonb_build_object(
    'created', true,
    'employee', to_jsonb(v_employee),
    'messenger_user_id', v_user.id
  );
end;
$$;

revoke all on function public.custodial_assert_manager(uuid) from public, anon, authenticated;
revoke all on function public.custodial_next_employee_code() from public, anon, authenticated;
revoke all on function public.custodial_create_employee(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.custodial_assert_manager(uuid) to service_role;
grant execute on function public.custodial_next_employee_code() to service_role;
grant execute on function public.custodial_create_employee(text,text,text,uuid) to service_role;

commit;
