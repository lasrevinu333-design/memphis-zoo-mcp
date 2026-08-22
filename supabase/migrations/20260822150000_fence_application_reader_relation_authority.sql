-- Keep the dedicated application reader explicit and independent of which
-- equivalent managed migration owner creates a later public relation.
--
-- The original reader migration granted SELECT on all then-current relations
-- and installed a broad postgres-owner default. Production therefore granted
-- two later correction-evidence relations to the reader while the clean
-- supabase_admin rebuild did not. Neither relation is an admitted application
-- read surface. Future reader access must be granted explicitly by the owning
-- migration instead of arriving through an owner-dependent default.

do $migration$
begin
  if not exists (select 1 from pg_roles where rolname = 'custodial_application_reader') then
    raise exception 'The restricted custodial_application_reader role is required.';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    join pg_roles owner on owner.oid = d.defaclrole
    left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) x
    join pg_roles grantee on grantee.oid = x.grantee
    where owner.rolname = 'supabase_admin'
      and n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and grantee.rolname = 'custodial_application_reader'
      and x.privilege_type = 'SELECT'
  ) then
    raise exception 'supabase_admin has a reader default that requires an owner-authorized correction.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'alter default privileges for role postgres in schema public revoke select on tables from custodial_application_reader';
  end if;

  if to_regclass('public.custodial_session_corrections') is not null then
    revoke select on table public.custodial_session_corrections from custodial_application_reader;
  end if;
  if to_regclass('public.v_custodial_cleaning_session_truth') is not null then
    revoke select on table public.v_custodial_cleaning_session_truth from custodial_application_reader;
  end if;
end
$migration$;

do $verify$
begin
  if has_table_privilege(
    'custodial_application_reader',
    'public.custodial_session_corrections',
    'select'
  ) then
    raise exception 'custodial_session_corrections remains an unapproved application-reader surface.';
  end if;
  if has_table_privilege(
    'custodial_application_reader',
    'public.v_custodial_cleaning_session_truth',
    'select'
  ) then
    raise exception 'v_custodial_cleaning_session_truth remains an unapproved application-reader surface.';
  end if;
  if exists (
    select 1
    from pg_default_acl d
    join pg_roles owner on owner.oid = d.defaclrole
    left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) x
    join pg_roles grantee on grantee.oid = x.grantee
    where owner.rolname in ('postgres', 'supabase_admin')
      and n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and grantee.rolname = 'custodial_application_reader'
      and x.privilege_type = 'SELECT'
  ) then
    raise exception 'A managed migration owner still grants future public relations to custodial_application_reader.';
  end if;
end
$verify$;
