-- The application reader resolves only public phone identity. Credential
-- secrets are authenticated through the service-owned credential store and
-- must never be an arbitrary read surface, even while FORCE RLS also hides all
-- rows from the reader.

begin;

do $preflight$
begin
  if not exists (
    select 1
    from pg_roles
    where rolname = 'custodial_application_reader'
      and not rolsuper
      and not rolbypassrls
      and not rolcanlogin
  ) then
    raise exception 'The restricted custodial_application_reader role is required';
  end if;

  if to_regclass('public.device_auth_credentials') is null then
    raise exception 'public.device_auth_credentials is required';
  end if;

  if exists (
    select 1
    from pg_policy p
    join pg_roles r on r.oid = any(p.polroles)
    where p.polrelid = 'public.device_auth_credentials'::regclass
      and r.rolname = 'custodial_application_reader'
  ) then
    raise exception 'The application reader already has an unexpected credential RLS policy';
  end if;
end
$preflight$;

revoke all privileges on table public.device_auth_credentials
  from custodial_application_reader;

do $postflight$
begin
  if has_table_privilege(
    'custodial_application_reader',
    'public.device_auth_credentials',
    'select'
  ) or has_column_privilege(
    'custodial_application_reader',
    'public.device_auth_credentials',
    'token_hash',
    'select'
  ) then
    raise exception 'Credential material remains readable by the application reader';
  end if;
end
$postflight$;

commit;
