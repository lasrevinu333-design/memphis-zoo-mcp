-- Recovery must preserve every hardened function boundary. The release
-- restore inventory was captured before public SECURITY DEFINER execution and
-- trigger-helper RPC access were removed, so replaying it could resurrect
-- those grants.

begin;

do $reconcile_trigger_recovery_acl$
declare
  routine record;
begin
  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'release authority recovery inventory is unavailable';
  end if;

  -- Reassert the live boundary first, then bind the recovery inventory to that
  -- exact state.
  for routine in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
    order by p.oid::regprocedure::text
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      routine.identity
    );
  end loop;

  -- Registered triggers do not require role-level EXECUTE grants.
  for routine in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
    order by p.oid::regprocedure::text
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated, service_role',
      routine.identity
    );
  end loop;

  -- Release DDL helpers remain internal to the paused recovery controller.
  -- Ordinary application/service authority must never reach them directly.
  revoke all privileges on function public.custodial_release_authority_reset_grants(text)
    from public, anon, authenticated, service_role;
  revoke all privileges on function public.custodial_release_authority_restore_column(text,text,text,text,text,text,text,boolean)
    from public, anon, authenticated, service_role;
  revoke all privileges on function public.custodial_release_authority_restore_column_set(text,text[])
    from public, anon, authenticated, service_role;
  revoke all privileges on function public.custodial_release_authority_restore_constraint(text,text,text)
    from public, anon, authenticated, service_role;

  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;

  -- This owner-authority arbitrary SQL proxy was deliberately retired. Its
  -- pre-retirement recovery records must not recreate it.
  delete from public.custodial_release_authority_restore_inventory
  where object_kind in ('function', 'grant')
    and object_identity = 'run_sql_readonly(text)';

  -- Refresh both relation and function ACL rows. This preserves the new
  -- genuinely read-only application role as well as the function hardening.
  update public.custodial_release_authority_restore_inventory i
  set definition_sql = public.custodial_release_authority_current_grant_definition(i.object_identity),
      definition_sha256 = encode(
        extensions.digest(
          convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity), 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      captured_at = statement_timestamp()
  where i.object_kind = 'grant';

  drop function public.run_sql_readonly(text);

  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;

  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory i
    join pg_proc p on p.oid = to_regprocedure(i.object_identity)
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    left join pg_roles grantee on grantee.oid = acl.grantee
    where i.object_kind = 'grant'
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and coalesce(grantee.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) then
    raise exception 'trigger-only helpers remain callable through the recovery inventory';
  end if;

  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory i
    join pg_proc p on p.oid = to_regprocedure(i.object_identity)
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    left join pg_roles grantee on grantee.oid = acl.grantee
    where i.object_kind = 'grant'
      and p.prosecdef
      and coalesce(grantee.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated')
  ) then
    raise exception 'SECURITY DEFINER functions remain publicly executable through the recovery inventory';
  end if;

  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where object_kind in ('function', 'grant')
      and object_identity = 'run_sql_readonly(text)'
  ) then
    raise exception 'retired owner SQL proxy remains in the recovery inventory';
  end if;
exception
  when others then
    begin
      alter table public.custodial_release_authority_restore_inventory
        enable trigger trg_custodial_release_authority_restore_inventory_immutable;
    exception when others then
      null;
    end;
    raise;
end
$reconcile_trigger_recovery_acl$;

commit;
