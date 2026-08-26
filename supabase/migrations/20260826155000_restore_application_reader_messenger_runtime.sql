-- The dedicated application reader executes with FORCE RLS enabled.  The
-- original reader cutover retained relation SELECT grants on Messenger tables
-- but supplied no reader policy, so canonical device assignments and messages
-- were invisible at runtime.  Restore only the eight relations used by the
-- reviewed Messenger read path and remove the role from every other msg_*
-- relation.

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

  foreach relation_name in array array[
    'msg_users',
    'msg_device_assignments',
    'msg_threads',
    'msg_thread_participants',
    'msg_thread_visibility',
    'msg_messages',
    'msg_receipts',
    'msg_memphis_thread_context'
  ] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'Required Messenger runtime relation public.% is missing', relation_name;
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

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and reader.oid = any(p.polroles)
  ) then
    raise exception 'Unexpected application-reader Messenger policy exists before cutover';
  end if;

  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
     or to_regprocedure('public.custodial_release_authority_current_policy_definition(text)') is null then
    raise exception 'release recovery inventory authority is unavailable';
  end if;
end
$preflight$;

-- Remove the broad historical reader grant from every Messenger relation,
-- including audit, deletion, broadcast, and administrative surfaces.
do $revoke_historical_messenger_grants$
declare
  relation_identity text;
begin
  for relation_identity in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and c.relkind in ('r','p','v','m')
    order by c.relname
  loop
    execute format('revoke all privileges on table %s from custodial_application_reader', relation_identity);
  end loop;
end
$revoke_historical_messenger_grants$;

grant select on table public.msg_users to custodial_application_reader;
grant select on table public.msg_device_assignments to custodial_application_reader;
grant select on table public.msg_threads to custodial_application_reader;
grant select on table public.msg_thread_participants to custodial_application_reader;
grant select on table public.msg_thread_visibility to custodial_application_reader;
grant select on table public.msg_messages to custodial_application_reader;
grant select on table public.msg_receipts to custodial_application_reader;
grant select on table public.msg_memphis_thread_context to custodial_application_reader;

create policy custodial_application_reader_msg_users_runtime
  on public.msg_users as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_device_assignments_runtime
  on public.msg_device_assignments as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_threads_runtime
  on public.msg_threads as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_thread_participants_runtime
  on public.msg_thread_participants as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_thread_visibility_runtime
  on public.msg_thread_visibility as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_messages_runtime
  on public.msg_messages as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_receipts_runtime
  on public.msg_receipts as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_msg_memphis_thread_context_runtime
  on public.msg_memphis_thread_context as permissive for select
  to custodial_application_reader using (true);

-- A canary restore must reproduce the same narrow Messenger grants and FORCE
-- RLS policies.  Refresh all msg_* grant rows because this migration also
-- removes historical reader authority from non-runtime Messenger relations.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $capture_messenger_grants$
declare
  relation_identity text;
  definition text;
  next_order integer;
begin
  select coalesce(max(restore_order),1000000) + 1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'grant';

  for relation_identity in
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and c.relkind in ('r','p','v','m')
    order by c.relname
  loop
    definition := public.custodial_release_authority_current_grant_definition(relation_identity);
    if definition is null then
      raise exception 'Messenger grant definition % is unavailable', relation_identity;
    end if;
    if exists (
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind = 'grant' and object_identity = relation_identity
    ) then
      update public.custodial_release_authority_restore_inventory
      set definition_sql = definition,
          definition_sha256 = encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
          captured_at = statement_timestamp()
      where object_kind = 'grant' and object_identity = relation_identity;
    else
      insert into public.custodial_release_authority_restore_inventory(
        restore_order, object_kind, object_identity, definition_sql, definition_sha256
      ) values (
        next_order, 'grant', relation_identity, definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
      next_order := next_order + 1;
    end if;
  end loop;
end
$capture_messenger_grants$;

do $capture_messenger_policies$
declare
  identity text;
  definition text;
  next_order integer;
begin
  select coalesce(max(restore_order),800000) + 1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'policy';

  foreach identity in array array[
    'public.msg_users:custodial_application_reader_msg_users_runtime',
    'public.msg_device_assignments:custodial_application_reader_msg_device_assignments_runtime',
    'public.msg_threads:custodial_application_reader_msg_threads_runtime',
    'public.msg_thread_participants:custodial_application_reader_msg_thread_participants_runtime',
    'public.msg_thread_visibility:custodial_application_reader_msg_thread_visibility_runtime',
    'public.msg_messages:custodial_application_reader_msg_messages_runtime',
    'public.msg_receipts:custodial_application_reader_msg_receipts_runtime',
    'public.msg_memphis_thread_context:custodial_application_reader_msg_memphis_thread_context_runtime'
  ] loop
    definition := public.custodial_release_authority_current_policy_definition(identity);
    if definition is null then
      raise exception 'Required Messenger reader policy % is missing', identity;
    end if;
    if exists (
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind = 'policy' and object_identity = identity
    ) then
      update public.custodial_release_authority_restore_inventory
      set definition_sql = definition,
          definition_sha256 = encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
          captured_at = statement_timestamp()
      where object_kind = 'policy' and object_identity = identity;
    else
      insert into public.custodial_release_authority_restore_inventory(
        restore_order, object_kind, object_identity, definition_sql, definition_sha256
      ) values (
        next_order, 'policy', identity, definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')
      );
      next_order := next_order + 1;
    end if;
  end loop;
end
$capture_messenger_policies$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
declare
  reader_oid oid;
begin
  select oid into strict reader_oid
  from pg_roles
  where rolname = 'custodial_application_reader';

  if (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and c.relkind in ('r','p','v','m')
      and acl.grantee = reader_oid
      and acl.privilege_type = 'SELECT'
      and not acl.is_grantable
  ) <> 8 then
    raise exception 'The Messenger reader relation projection is incomplete';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) acl
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and c.relkind in ('r','p','v','m')
      and acl.grantee = reader_oid
      and (
        acl.privilege_type <> 'SELECT'
        or c.relname not in (
          'msg_users','msg_device_assignments','msg_threads','msg_thread_participants',
          'msg_thread_visibility','msg_messages','msg_receipts','msg_memphis_thread_context'
        )
      )
  ) then
    raise exception 'The application reader retains an unapproved Messenger relation privilege';
  end if;

  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
      and acl.grantee = reader_oid
  ) then
    raise exception 'Unexpected Messenger column privilege remains on the application reader';
  end if;

  if (
    select count(*)
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and left(c.relname,4) = 'msg_'
      and reader_oid = any(p.polroles)
      and p.polcmd = 'r'
      and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid) = 'true'
  ) <> 8 then
    raise exception 'The Messenger reader RLS policy set is invalid';
  end if;

  if (
    select count(*)
    from public.custodial_release_authority_restore_inventory
    where object_kind = 'policy'
      and left(split_part(object_identity,':',1),11) = 'public.msg_'
      and left(split_part(object_identity,':',2),29) = 'custodial_application_reader_'
  ) <> 8 then
    raise exception 'Messenger reader policy recovery is incomplete';
  end if;

  if exists (
    select 1
    from public.custodial_release_authority_restore_inventory
    where definition_sha256 <> encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'Release recovery inventory digest mismatch';
  end if;
end
$postflight$;

commit;
