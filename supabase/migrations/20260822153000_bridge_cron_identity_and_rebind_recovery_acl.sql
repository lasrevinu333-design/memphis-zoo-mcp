-- The dedicated application reader must observe the exact release cron
-- catalog without inheriting pg_cron's owner-only row policy or receiving
-- direct authority over cron.job. Keep the bridge fixed, read-only and scoped
-- to the six release-identity columns. Also bind recovery to the corrected
-- post-20260822150000 ACL for the append-only correction table.

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
    raise exception 'The restricted custodial_application_reader role is required.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'The managed supabase_admin owner is required.';
  end if;
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'A managed migration owner is required.';
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'The managed cron.job catalog is required.';
  end if;
  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'The exact release recovery inventory is unavailable.';
  end if;
end
$preflight$;

create schema if not exists custodial_release_identity authorization current_user;
revoke all privileges on schema custodial_release_identity
  from public, anon, authenticated, service_role, custodial_application_reader;
grant usage on schema custodial_release_identity to custodial_application_reader;

create or replace function custodial_release_identity.custodial_schema_identity_cron_jobs()
returns table(
  jobname text,
  schedule text,
  command text,
  database text,
  username text,
  active boolean
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'cron'
set row_security to 'off'
as $function$
  select j.jobname,j.schedule,j.command,j.database,j.username,j.active
  from cron.job j
  order by j.jobname
$function$;

revoke all privileges on function custodial_release_identity.custodial_schema_identity_cron_jobs()
  from public, anon, authenticated, service_role;
grant execute on function custodial_release_identity.custodial_schema_identity_cron_jobs()
  to custodial_application_reader;

revoke select (jobname, schedule, command, database, username, active)
  on table cron.job
  from custodial_application_reader;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $rebind_recovery_acl$
declare
  v_definition text;
  v_updated integer;
begin
  v_definition := public.custodial_release_authority_current_grant_definition(
    'public.custodial_session_corrections'
  );
  if v_definition is null then
    raise exception 'The correction-table ACL cannot be rendered.';
  end if;

  update public.custodial_release_authority_restore_inventory
  set definition_sql = v_definition,
      definition_sha256 = encode(
        extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256'),
        'hex'
      ),
      captured_at = statement_timestamp()
  where object_kind = 'grant'
    and object_identity = 'public.custodial_session_corrections';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected exactly one correction-table ACL recovery row; updated %.', v_updated;
  end if;
end
$rebind_recovery_acl$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
declare
  v_inventory_hash text;
  v_current_definition text;
begin
  if not exists (
    select 1
    from pg_namespace n
    where n.nspname = 'custodial_release_identity'
      and pg_get_userbyid(n.nspowner) = current_user
  ) then
    raise exception 'The release-identity schema is not owned by the managed migration owner.';
  end if;
  if exists (
    select 1
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) acl
    join pg_roles grantee on grantee.oid = acl.grantee
    where a.attrelid = 'cron.job'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and grantee.rolname = 'custodial_application_reader'
      and acl.privilege_type = 'SELECT'
  ) then
    raise exception 'The reader retains an explicit cron.job column grant.';
  end if;
  if has_schema_privilege('custodial_application_reader', 'cron', 'create')
     or not has_schema_privilege('custodial_application_reader', 'cron', 'usage') then
    raise exception 'The reader has an invalid cron schema boundary.';
  end if;
  if has_schema_privilege('custodial_application_reader', 'custodial_release_identity', 'create')
     or not has_schema_privilege('custodial_application_reader', 'custodial_release_identity', 'usage') then
    raise exception 'The reader has an invalid release-identity schema boundary.';
  end if;
  if not has_function_privilege(
    'custodial_application_reader',
    'custodial_release_identity.custodial_schema_identity_cron_jobs()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'custodial_release_identity.custodial_schema_identity_cron_jobs()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'custodial_release_identity.custodial_schema_identity_cron_jobs()',
    'execute'
  ) or has_function_privilege(
    'service_role',
    'custodial_release_identity.custodial_schema_identity_cron_jobs()',
    'execute'
  ) then
    raise exception 'The fixed cron catalog bridge has an invalid execute boundary.';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'custodial_release_identity'
      and p.proname = 'custodial_schema_identity_cron_jobs'
      and p.prosecdef
      and p.provolatile = 's'
      and pg_get_userbyid(p.proowner) in ('postgres', 'supabase_admin')
  ) then
    raise exception 'The fixed cron catalog bridge is not bound to its managed owner.';
  end if;

  select definition_sha256
  into v_inventory_hash
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'grant'
    and object_identity = 'public.custodial_session_corrections';
  v_current_definition := public.custodial_release_authority_current_grant_definition(
    'public.custodial_session_corrections'
  );
  if v_inventory_hash is distinct from encode(
    extensions.digest(convert_to(v_current_definition, 'UTF8'), 'sha256'),
    'hex'
  ) then
    raise exception 'The correction-table recovery ACL remains stale.';
  end if;
  if has_table_privilege(
    'custodial_application_reader',
    'public.custodial_session_corrections',
    'select'
  ) then
    raise exception 'The correction table was reopened to the application reader.';
  end if;
end
$postflight$;

commit;
