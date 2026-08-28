-- The feedback runtime intentionally adds a second bounded column projection
-- for custodial_application_reader. Release health must verify the three-table
-- employee/device identity projection without treating that later, separately
-- inventoried feedback projection as identity-authority drift.

begin;

do $preflight$
declare
  health_definition text;
  old_filter text := E'      where n.nspname=''public'' and a.attnum>0 and not a.attisdropped and a.attacl is not null\n        and acl.grantee<>c.relowner';
  old_filter_count integer;
  identity_projection_exact boolean;
  feedback_projection_exact boolean;
begin
  if to_regprocedure('public.custodial_backend_authority_health(text)') is null
     or to_regclass('public.custodial_release_authority_restore_inventory') is null then
    raise exception 'Release health and recovery inventory are required';
  end if;

  health_definition := pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
  if encode(extensions.digest(convert_to(health_definition,'UTF8'),'sha256'),'hex')
       <> 'bb04f7c05f72d959b4aba5a3a047adad1163eaf6b88aeeebd5d0f9f6a3b10baf' then
    raise exception 'Release health definition does not match the admitted predecessor';
  end if;
  old_filter_count := (length(health_definition)-length(replace(health_definition,old_filter,'')))/length(old_filter);
  if old_filter_count <> 1 then
    raise exception 'The obsolete global column-authority filter is not uniquely identifiable';
  end if;

  select count(*)=22
    and bool_and(grantee.rolname='custodial_application_reader'
      and acl.privilege_type='SELECT' and not acl.is_grantable)
    and bool_and((c.relname,a.attname) in (
      ('devices','id'),('devices','device_id'),('devices','device_name'),('devices','active'),
      ('devices','assigned_employee_id'),('devices','last_seen_at'),('devices','created_at'),
      ('devices','updated_at'),('devices','assignment_epoch'),('employees','id'),
      ('employees','employee_code'),('employees','display_name'),('employees','active'),
      ('employees','role'),('employees','created_at'),('employees','updated_at'),
      ('device_aliases','alias_identifier'),('device_aliases','canonical_device_id'),
      ('device_aliases','active'),('device_aliases','source'),('device_aliases','created_at'),
      ('device_aliases','updated_at')
    ))
  into identity_projection_exact
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles grantee on grantee.oid=acl.grantee
  where n.nspname='public'
    and c.relname in ('devices','employees','device_aliases')
    and a.attnum>0 and not a.attisdropped and a.attacl is not null
    and acl.grantee<>c.relowner;

  select count(*)=21
    and bool_and(grantee.rolname='custodial_application_reader'
      and acl.privilege_type='SELECT' and not acl.is_grantable)
  into feedback_projection_exact
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles grantee on grantee.oid=acl.grantee
  where n.nspname='public' and c.relname='system_feedback_items'
    and a.attnum>0 and not a.attisdropped and a.attacl is not null
    and acl.grantee<>c.relowner;

  if identity_projection_exact is not true or feedback_projection_exact is not true then
    raise exception 'The admitted identity and feedback projections are not exact';
  end if;
end
$preflight$;

do $repair$
declare
  health_definition text;
  old_filter text := E'      where n.nspname=''public'' and a.attnum>0 and not a.attisdropped and a.attacl is not null\n        and acl.grantee<>c.relowner';
  scoped_filter text := E'      where n.nspname=''public'' and a.attnum>0 and not a.attisdropped and a.attacl is not null\n        and acl.grantee<>c.relowner\n        and c.relname in (''devices'',''employees'',''device_aliases'')';
begin
  health_definition := pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
  execute replace(health_definition,old_filter,scoped_filter);
end
$repair$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $refresh_inventory$
declare
  changed integer;
  definition text := pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
begin
  update public.custodial_release_authority_restore_inventory
  set definition_sql=definition,
      definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
  where object_kind='function'
    and object_identity in (
      'custodial_backend_authority_health(text)',
      'public.custodial_backend_authority_health(text)'
    );
  get diagnostics changed=row_count;
  if changed <> 1 then
    raise exception 'Release health recovery inventory row is missing or duplicated';
  end if;
end
$refresh_inventory$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
declare
  health_definition text := pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
  inventory_definition text;
  inventory_digest text;
  identity_projection_exact boolean;
begin
  select definition_sql,definition_sha256
  into strict inventory_definition,inventory_digest
  from public.custodial_release_authority_restore_inventory
  where object_kind='function'
    and object_identity in (
      'custodial_backend_authority_health(text)',
      'public.custodial_backend_authority_health(text)'
    );

  if health_definition is distinct from inventory_definition
     or inventory_digest is distinct from encode(extensions.digest(convert_to(health_definition,'UTF8'),'sha256'),'hex')
     or health_definition not like '%and c.relname in (''devices'',''employees'',''device_aliases'')%' then
    raise exception 'Corrected release health is not exactly recoverable';
  end if;

  select count(*)=22
    and bool_and(grantee.rolname='custodial_application_reader'
      and acl.privilege_type='SELECT' and not acl.is_grantable)
    and bool_and((c.relname,a.attname) in (
      ('devices','id'),('devices','device_id'),('devices','device_name'),('devices','active'),
      ('devices','assigned_employee_id'),('devices','last_seen_at'),('devices','created_at'),
      ('devices','updated_at'),('devices','assignment_epoch'),('employees','id'),
      ('employees','employee_code'),('employees','display_name'),('employees','active'),
      ('employees','role'),('employees','created_at'),('employees','updated_at'),
      ('device_aliases','alias_identifier'),('device_aliases','canonical_device_id'),
      ('device_aliases','active'),('device_aliases','source'),('device_aliases','created_at'),
      ('device_aliases','updated_at')
    ))
  into identity_projection_exact
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles grantee on grantee.oid=acl.grantee
  where n.nspname='public'
    and c.relname in ('devices','employees','device_aliases')
    and a.attnum>0 and not a.attisdropped and a.attacl is not null
    and acl.grantee<>c.relowner;

  if identity_projection_exact is not true then
    raise exception 'Corrected release health identity projection is not exact';
  end if;

  if exists (
    select 1 from public.custodial_release_authority_restore_inventory
    where definition_sha256<>encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'Release recovery inventory digest mismatch';
  end if;
end
$postflight$;

commit;
