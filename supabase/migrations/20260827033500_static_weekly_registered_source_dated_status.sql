begin;

-- Slot availability status is dated roster state.  The immutable registered
-- source owns the slot, shift, lunch, capacity, qualifications, restrictions,
-- route anchor, and vacancy-capability templates; the append-only staffing
-- ledger owns whether that same slot is working, departed, or currently
-- vacant for a particular week.  Remove only the dated status field from the
-- registered-source identity so a roster-hydrated initial draft can still be
-- proven against every immutable release-owned template field.
create or replace function public.static_weekly_v5_registered_source_identity(p_source jsonb)
returns jsonb
language plpgsql
immutable
as $function$
declare
  v_identity jsonb;
  v_version jsonb;
  v_slots jsonb;
  v_availability jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object'
    or coalesce(p_source->'exceptions','[]'::jsonb)<>'[]'::jsonb then
    raise exception using errcode='23514',message='registered scheduler source must be one exception-free recurring compiler input';
  end if;
  if jsonb_typeof(p_source->'version')='object' then
    v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array'
    and jsonb_array_length(p_source->'versions')=1 then
    v_version:=(p_source->'versions')->0;
  else
    raise exception using errcode='23514',message='registered scheduler source must carry exactly one recurring version';
  end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd'-'vacantSlotIds';
  if jsonb_typeof(v_version->'slotAvailability') is distinct from 'array' then
    raise exception using errcode='23514',message='registered scheduler source must retain recurring slot availability templates';
  end if;
  select coalesce(jsonb_agg(item-'status' order by ordinal),'[]'::jsonb)
    into v_availability
  from jsonb_array_elements(v_version->'slotAvailability')
       with ordinality as availability(item,ordinal);
  v_version:=jsonb_set(v_version,'{slotAvailability}',v_availability,true);
  v_identity:=p_source-'serviceDate'-'exceptions'-'version'-'versions';
  if jsonb_typeof(v_identity->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='registered scheduler source must carry stable roster slots';
  end if;
  select coalesce(jsonb_agg(slot-'incumbencies' order by ordinal),'[]'::jsonb)
    into v_slots
  from jsonb_array_elements(v_identity->'slots')
       with ordinality as roster(slot,ordinal);
  v_identity:=jsonb_set(v_identity,'{slots}',v_slots,true);
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

revoke all on function public.static_weekly_v5_registered_source_identity(jsonb)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
       static_weekly_release_operator,custodial_application_reader;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $rebind_release_recovery$
declare
  v_identity text:='public.static_weekly_v5_registered_source_identity(jsonb)';
  v_definition text;
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
    raise exception 'release recovery inventory is missing required function %',v_identity;
  end if;
  v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
  update public.custodial_release_authority_restore_inventory
  set definition_sql=v_definition,
      definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
  where object_kind='grant' and object_identity=v_identity;
  if not found then
    raise exception 'release recovery inventory is missing required function grant %',v_identity;
  end if;
end
$rebind_release_recovery$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $release_recovery_postflight$
declare
  v_identity text:='public.static_weekly_v5_registered_source_identity(jsonb)';
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

comment on function public.static_weekly_v5_registered_source_identity(jsonb) is
  'Binds every immutable recurring source template while excluding dated incumbency, active vacancy, and staffing-status facts supplied by append-only roster authority.';

commit;
