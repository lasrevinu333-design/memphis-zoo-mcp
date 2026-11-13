-- Restore the already deployed manager GPS readers. The dedicated reader
-- already has SELECT, but FORCE RLS currently withholds every scan event.
-- Admit only GPS events belonging to an original, currently active work item.
-- No history rewrite, new credential, public grant, writer or RLS bypass.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $preflight$
declare reader pg_roles%rowtype;
begin
  select * into strict reader from pg_roles where rolname='custodial_application_reader';
  if reader.rolsuper or reader.rolbypassrls or reader.rolcanlogin then
    raise exception 'Restricted application reader required';
  end if;
  if not exists(select 1 from pg_class where oid='public.scan_events'::regclass
    and relkind='r' and relrowsecurity and relforcerowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.scan_events'::regclass)
    or not has_table_privilege('custodial_application_reader','public.scan_events','SELECT')
    or not has_function_privilege('custodial_application_reader','public.custodial_open_work()','EXECUTE') then
    raise exception 'Original GPS reader authority or policy preimage differs';
  end if;
  if not exists(select 1 from pg_trigger
    where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A')
    or exists(select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='policy' and object_identity='public.scan_events:custodial_application_reader_active_work_gps') then
    raise exception 'Original restore inventory required';
  end if;
end
$preflight$;

create policy custodial_application_reader_active_work_gps
on public.scan_events as permissive for select
to custodial_application_reader
using (
  event_type='work_position_check'
  and exists (
    select 1 from public.custodial_open_work() work
    where work.status='active' and work.ended_at is null
      and scan_events.device_id=work.device_id
      and scan_events.location_id=work.location_id
      and scan_events.device_identifier=work.device_identifier
      and scan_events.location_code=work.location_code
      and case
        when work.source_kind='session' then
          work.session_id is not null and work.context_id is null
          and work.open_work_id=work.session_id
          and scan_events.session_id=work.session_id
          and (nullif(scan_events.payload_json->>'session_uuid','') is null
            or scan_events.payload_json->>'session_uuid'=work.session_uuid)
          and (nullif(scan_events.payload_json->>'client_session_id','') is null
            or scan_events.payload_json->>'client_session_id'=work.client_session_id)
        when work.source_kind='native_offline_context' then
          work.session_id is null and work.context_id is not null
          and work.open_work_id=work.context_id
          and work.session_uuid=work.client_session_id
          and scan_events.session_id is null
          and scan_events.payload_json->>'session_uuid'=work.session_uuid
          and scan_events.payload_json->>'client_session_id'=work.client_session_id
        else false
      end
  )
);

-- Keep the existing restore mechanism able to reconstruct the exact policy.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $capture_policy$
declare
  identity text := 'public.scan_events:custodial_application_reader_active_work_gps';
  definition text;
  next_order integer;
begin
  definition := public.custodial_release_authority_current_policy_definition(identity);
  if definition is null then raise exception 'GPS reader policy capture unavailable'; end if;
  select coalesce(max(restore_order),800000)+1 into next_order
    from public.custodial_release_authority_restore_inventory where object_kind='policy';
  insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  values(next_order,'policy',identity,definition,
    encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
end
$capture_policy$;
alter table public.custodial_release_authority_restore_inventory
  enable always trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
begin
  if not exists(select 1 from pg_policy
    where polrelid='public.scan_events'::regclass
      and polname='custodial_application_reader_active_work_gps'
      and polcmd='r' and polpermissive
      and polroles=array[(select oid from pg_roles where rolname='custodial_application_reader')]) then
    raise exception 'Exact GPS reader policy missing';
  end if;
  if not exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='policy'
      and object_identity='public.scan_events:custodial_application_reader_active_work_gps'
      and definition_sql=public.custodial_release_authority_current_policy_definition(object_identity)
      and definition_sha256=encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')) then
    raise exception 'GPS policy restore binding differs';
  end if;
end
$postflight$;
commit;
