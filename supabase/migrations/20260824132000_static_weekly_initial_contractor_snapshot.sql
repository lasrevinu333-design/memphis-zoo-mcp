-- Before the first draft exists there is no display-version document from
-- which the manager snapshot can classify roster slots.  Use the one active,
-- release-registered source only for that pre-draft state.  Once a draft or
-- publication exists, the existing immutable version-bound classification
-- remains authoritative.

alter function public.static_weekly_v3_read_manager_snapshot(date)
  rename to static_weekly_v3_read_manager_snapshot_staffing_base;

revoke all on function public.static_weekly_v3_read_manager_snapshot_staffing_base(date)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

create or replace function public.static_weekly_v3_read_manager_snapshot(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_snapshot jsonb;
  v_source jsonb;
  v_roster jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);

  -- A draft or publication already binds its own immutable compiler input.
  if jsonb_typeof(v_snapshot->'display_version')='object' then
    return v_snapshot;
  end if;

  begin
    select s.canonical_source into strict v_source
    from public.static_weekly_authority_source_documents s
    where s.active=true;
  exception
    when no_data_found then
      raise exception using errcode='23514',message='initial manager snapshot requires one active registered recurring source';
    when too_many_rows then
      raise exception using errcode='23514',message='initial manager snapshot requires exactly one active registered recurring source';
  end;

  if jsonb_typeof(v_source->'slots')<>'array' then
    raise exception using errcode='23514',message='active registered recurring source has no canonical slot array';
  end if;

  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'contractor_capacity',coalesce((
        select lower(slot->>'contractorCapacity')='true'
        from jsonb_array_elements(v_source->'slots') slot
        where slot->>'id'=item->>'slot_id'
        limit 1
      ),false)
    ) order by item->>'slot_label',item->>'slot_id'
  ),'[]'::jsonb) into v_roster
  from jsonb_array_elements(coalesce(v_snapshot->'roster','[]'::jsonb)) item;

  return jsonb_set(v_snapshot,'{roster}',v_roster,true);
end
$function$;

revoke all on function public.static_weekly_v3_read_manager_snapshot(date)
from public,anon,authenticated,service_role,static_weekly_release_operator;
grant execute on function public.static_weekly_v3_read_manager_snapshot(date)
to static_weekly_control_plane;

comment on function public.static_weekly_v3_read_manager_snapshot(date) is
  'Coherent manager week snapshot; pre-draft contractor capacity comes from the one active release-registered source, while draft and publication views remain immutable-version bound.';
