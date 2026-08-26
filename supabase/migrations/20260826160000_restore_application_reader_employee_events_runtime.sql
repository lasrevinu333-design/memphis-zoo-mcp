-- Employee Events is an enrolled-phone read surface.  The dedicated
-- application reader retained SELECT grants after the FORCE-RLS cutover but
-- had no policies on the three relations used by listUpcomingEvents, so every
-- authenticated phone request failed at the database boundary.  Restore only
-- that reviewed runtime projection; event audit, parser-rule, alias, and
-- scheduling relations remain outside this policy change.

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
    'events_app_events',
    'location_groups',
    'event_venues'
  ] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'Required Employee Events runtime relation public.% is missing', relation_name;
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
    where p.polrelid in (
      'public.events_app_events'::regclass,
      'public.location_groups'::regclass,
      'public.event_venues'::regclass
    )
      and reader.oid = any(p.polroles)
  ) then
    raise exception 'Unexpected application-reader Employee Events policy exists before cutover';
  end if;

  if to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null
     or to_regprocedure('public.custodial_release_authority_current_policy_definition(text)') is null then
    raise exception 'release recovery inventory authority is unavailable';
  end if;
end
$preflight$;

grant select on table public.events_app_events to custodial_application_reader;
grant select on table public.location_groups to custodial_application_reader;
grant select on table public.event_venues to custodial_application_reader;

create policy custodial_application_reader_events_app_events_runtime
  on public.events_app_events as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_location_groups_events_runtime
  on public.location_groups as permissive for select
  to custodial_application_reader using (true);
create policy custodial_application_reader_event_venues_runtime
  on public.event_venues as permissive for select
  to custodial_application_reader using (true);

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $capture_event_grants$
declare
  relation_identity text;
  definition text;
  next_order integer;
begin
  select coalesce(max(restore_order),1000000) + 1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'grant';

  foreach relation_identity in array array[
    'public.events_app_events',
    'public.location_groups',
    'public.event_venues'
  ] loop
    definition := public.custodial_release_authority_current_grant_definition(relation_identity);
    if definition is null then
      raise exception 'Employee Events grant definition % is unavailable', relation_identity;
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
$capture_event_grants$;

do $capture_event_policies$
declare
  identity text;
  definition text;
  next_order integer;
begin
  select coalesce(max(restore_order),800000) + 1 into next_order
  from public.custodial_release_authority_restore_inventory
  where object_kind = 'policy';

  foreach identity in array array[
    'public.events_app_events:custodial_application_reader_events_app_events_runtime',
    'public.location_groups:custodial_application_reader_location_groups_events_runtime',
    'public.event_venues:custodial_application_reader_event_venues_runtime'
  ] loop
    definition := public.custodial_release_authority_current_policy_definition(identity);
    if definition is null then
      raise exception 'Required Employee Events reader policy % is missing', identity;
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
$capture_event_policies$;

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
    from pg_policy p
    where p.polrelid in (
      'public.events_app_events'::regclass,
      'public.location_groups'::regclass,
      'public.event_venues'::regclass
    )
      and reader_oid = any(p.polroles)
      and p.polcmd = 'r'
      and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid) = 'true'
  ) <> 3 then
    raise exception 'The Employee Events reader RLS policy set is invalid';
  end if;

  if not has_table_privilege('custodial_application_reader','public.events_app_events','select')
     or not has_table_privilege('custodial_application_reader','public.location_groups','select')
     or not has_table_privilege('custodial_application_reader','public.event_venues','select') then
    raise exception 'The Employee Events reader relation projection is incomplete';
  end if;

  if (
    select count(*)
    from public.custodial_release_authority_restore_inventory
    where object_kind = 'policy'
      and object_identity in (
        'public.events_app_events:custodial_application_reader_events_app_events_runtime',
        'public.location_groups:custodial_application_reader_location_groups_events_runtime',
        'public.event_venues:custodial_application_reader_event_venues_runtime'
      )
  ) <> 3 then
    raise exception 'Employee Events reader policy recovery is incomplete';
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
