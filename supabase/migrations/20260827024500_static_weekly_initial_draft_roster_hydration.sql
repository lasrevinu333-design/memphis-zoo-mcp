begin;

-- A release source records the immutable vacancy capability of each stable
-- schedule position.  Active vacancy is dated operational state and must be
-- derived from the append-only incumbency ledger before the first draft is
-- compiled.  The legacy one-argument reader remains for exact older callers;
-- current publication uses this explicit dated overload.
create or replace function public.static_weekly_v3_read_authority_source(
  p_source_id uuid,
  p_service_date date
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_source jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  if p_source_id is null or p_service_date is null then
    raise exception using errcode='22023',message='scheduler source read requires one immutable source and service date';
  end if;
  select canonical_source into v_source
  from public.static_weekly_authority_source_documents
  where source_id=p_source_id and active=true and retired_at is null
  for share;
  if not found then
    raise exception using errcode='23514',message='scheduler source is not an active release-registered source of record';
  end if;
  return jsonb_build_object(
    'source_id',p_source_id::text,
    'compiler_input',public.static_weekly_v4_hydrate_compiler_source(v_source,p_service_date),
    'exceptions','[]'::jsonb
  );
end
$function$;

revoke all on function public.static_weekly_v3_read_authority_source(uuid,date)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v3_read_authority_source(uuid,date)
  to static_weekly_control_plane;

-- Exact release recovery must restore both the dated reader definition and its
-- narrow execute grant.  Refreshing the immutable inventory in the same
-- migration prevents a later recovery from silently removing this boundary.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $rebind_release_recovery$
declare
  v_identity text:='public.static_weekly_v3_read_authority_source(uuid,date)';
  v_definition text;
  v_restore_order integer;
begin
  if to_regprocedure(v_identity) is null then
    raise exception 'required current function % is unavailable',v_identity;
  end if;
  v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
  update public.custodial_release_authority_restore_inventory
  set definition_sql=v_definition,
      definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
  where object_kind='function' and object_identity=v_identity;
  if not found then
    select coalesce(max(restore_order),100000)+1 into v_restore_order
    from public.custodial_release_authority_restore_inventory
    where object_kind='function';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values(
      v_restore_order,'function',v_identity,v_definition,
      encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
    );
  end if;

  v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
  if v_definition is null then
    raise exception 'required current function grant % is unavailable',v_identity;
  end if;
  update public.custodial_release_authority_restore_inventory
  set definition_sql=v_definition,
      definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
  where object_kind='grant' and object_identity=v_identity;
  if not found then
    select coalesce(max(restore_order),1000000)+1 into v_restore_order
    from public.custodial_release_authority_restore_inventory
    where object_kind='grant';
    insert into public.custodial_release_authority_restore_inventory(
      restore_order,object_kind,object_identity,definition_sql,definition_sha256
    ) values(
      v_restore_order,'grant',v_identity,v_definition,
      encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
    );
  end if;
end
$rebind_release_recovery$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $release_recovery_postflight$
declare
  v_identity text:='public.static_weekly_v3_read_authority_source(uuid,date)';
  v_definition text;
begin
  v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
  if not exists(
    select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='function' and object_identity=v_identity
      and definition_sql=v_definition
      and definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'release recovery does not preserve current function %',v_identity;
  end if;
  v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
  if not exists(
    select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='grant' and object_identity=v_identity
      and definition_sql=v_definition
      and definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'release recovery does not preserve current function grant %',v_identity;
  end if;
end
$release_recovery_postflight$;

comment on function public.static_weekly_v3_read_authority_source(uuid,date) is
  'Hydrates an immutable vacancy-capable release source against the dated append-only roster before initial-draft compilation.';

commit;
