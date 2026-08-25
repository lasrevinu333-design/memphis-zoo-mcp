-- The dedicated application reader is intentionally non-bypass and executes
-- with row_security=on. Production's identity tables are FORCE RLS and had no
-- policy for that role, so every canonical phone lookup returned zero rows.
-- Restore only the non-secret columns required to resolve an enrolled phone;
-- do not expose employee/device notes or any credential table.

begin;

do $preflight$
declare
  reader pg_roles%rowtype;
  relation_name text;
begin
  select * into strict reader
  from pg_roles
  where rolname = 'custodial_application_reader';

  if reader.rolsuper or reader.rolbypassrls or reader.rolcanlogin then
    raise exception 'custodial_application_reader is not the admitted restricted role';
  end if;

  foreach relation_name in array array['devices','employees','device_aliases'] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'Required identity relation public.% is missing', relation_name;
    end if;
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = relation_name
        and c.relkind = 'r'
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'public.% must retain enabled and forced RLS', relation_name;
    end if;
  end loop;
end
$preflight$;

revoke all privileges on table public.devices from custodial_application_reader;
grant select (
  id, device_id, device_name, active, assigned_employee_id,
  last_seen_at, created_at, updated_at, assignment_epoch
) on table public.devices to custodial_application_reader;

revoke all privileges on table public.employees from custodial_application_reader;
grant select (
  id, employee_code, display_name, active, role, created_at, updated_at
) on table public.employees to custodial_application_reader;

revoke all privileges on table public.device_aliases from custodial_application_reader;
grant select (
  alias_identifier, canonical_device_id, active, source, created_at, updated_at
) on table public.device_aliases to custodial_application_reader;

create policy custodial_application_reader_device_identity
  on public.devices
  as permissive
  for select
  to custodial_application_reader
  using (true);

create policy custodial_application_reader_employee_identity
  on public.employees
  as permissive
  for select
  to custodial_application_reader
  using (true);

create policy custodial_application_reader_device_alias_identity
  on public.device_aliases
  as permissive
  for select
  to custodial_application_reader
  using (true);

do $postflight$
declare
  reader_oid oid;
begin
  select oid into strict reader_oid
  from pg_roles
  where rolname = 'custodial_application_reader';

  if not (
    has_column_privilege('custodial_application_reader','public.devices','id','select')
    and has_column_privilege('custodial_application_reader','public.devices','device_id','select')
    and has_column_privilege('custodial_application_reader','public.devices','assigned_employee_id','select')
    and has_column_privilege('custodial_application_reader','public.employees','id','select')
    and has_column_privilege('custodial_application_reader','public.employees','display_name','select')
    and has_column_privilege('custodial_application_reader','public.employees','employee_code','select')
    and has_column_privilege('custodial_application_reader','public.device_aliases','alias_identifier','select')
    and has_column_privilege('custodial_application_reader','public.device_aliases','canonical_device_id','select')
  ) then
    raise exception 'The application reader identity projection is incomplete';
  end if;

  if has_column_privilege('custodial_application_reader','public.devices','notes','select')
     or has_column_privilege('custodial_application_reader','public.employees','notes','select')
     or has_table_privilege('custodial_application_reader','public.devices','insert')
     or has_table_privilege('custodial_application_reader','public.devices','update')
     or has_table_privilege('custodial_application_reader','public.devices','delete')
     or has_table_privilege('custodial_application_reader','public.employees','insert')
     or has_table_privilege('custodial_application_reader','public.employees','update')
     or has_table_privilege('custodial_application_reader','public.employees','delete')
     or has_table_privilege('custodial_application_reader','public.device_aliases','insert')
     or has_table_privilege('custodial_application_reader','public.device_aliases','update')
     or has_table_privilege('custodial_application_reader','public.device_aliases','delete') then
    raise exception 'The application reader identity projection is over-privileged';
  end if;

  if (
    select count(*)
    from pg_policy p
    where p.polrelid in (
      'public.devices'::regclass,
      'public.employees'::regclass,
      'public.device_aliases'::regclass
    )
      and p.polname in (
        'custodial_application_reader_device_identity',
        'custodial_application_reader_employee_identity',
        'custodial_application_reader_device_alias_identity'
      )
      and p.polcmd = 'r'
      and p.polpermissive
      and p.polroles = array[reader_oid]
      and pg_get_expr(p.polqual, p.polrelid) = 'true'
  ) <> 3 then
    raise exception 'The application reader device-identity RLS policy set is invalid';
  end if;
end
$postflight$;

commit;
