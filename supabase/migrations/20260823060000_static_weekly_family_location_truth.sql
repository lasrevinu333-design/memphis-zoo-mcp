-- Preserve every physical area in a static-weekly family from release source
-- through the attested projection and employee schedule. Historical
-- single-location projections remain readable; no stored authority is
-- rewritten by this migration.
begin;

alter function public.static_weekly_v3_assert_work_payload(jsonb,boolean)
  rename to static_weekly_v3_assert_work_payload_single_location_base;

revoke all on function public.static_weekly_v3_assert_work_payload_single_location_base(jsonb,boolean)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v3_assert_work_payload(p_work jsonb,p_added boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_required text[]:=array['workId','locationId','locationCodeSnapshot','locationNameSnapshot','window','serviceEffortMinutes','serviceEffortProvenance','priority','priorityProvenance','requiredQualifications','qualificationProvenance','restrictions','restrictionProvenance'];
  v_allowed text[];
  v_location jsonb;
  v_locations jsonb;
begin
  if p_added then
    v_required:=v_required||array['dayOfWeek','originSlotId'];
  end if;
  v_allowed:=v_required||array['includedLocations'];
  perform public.static_weekly_assert_exact_object(
    p_work,v_required,v_allowed,
    case when p_added then 'event added work' else 'event patch work' end
  );
  perform public.static_weekly_v3_assert_work_payload_single_location_base(p_work-'includedLocations',p_added);

  if p_work ? 'includedLocations' then
    v_locations:=p_work->'includedLocations';
    if jsonb_typeof(v_locations) is distinct from 'array'
       or jsonb_array_length(v_locations)<1
       or jsonb_array_length(v_locations)>256 then
      raise exception using errcode='23514',message='event included locations require one through 256 exact snapshots';
    end if;
    for v_location in select value from jsonb_array_elements(v_locations) loop
      perform public.static_weekly_assert_exact_object(
        v_location,
        array['locationId','locationNameSnapshot'],
        array['locationId','locationNameSnapshot'],
        'event included location snapshot'
      );
      perform public.static_weekly_v3_assert_uuid(v_location->'locationId','event included locationId');
      perform public.static_weekly_v3_assert_text(v_location->'locationNameSnapshot','event included location name');
    end loop;
    if (select count(*) from jsonb_array_elements(v_locations))
       <> (select count(distinct value->>'locationId') from jsonb_array_elements(v_locations)) then
      raise exception using errcode='23514',message='event included locations may not repeat a location identity';
    end if;
    if not exists(
      select 1 from jsonb_array_elements(v_locations) x
      where x->>'locationId'=p_work->>'locationId'
    ) then
      raise exception using errcode='23514',message='event included locations must contain the routing location';
    end if;
  end if;
end
$function$;

revoke all on function public.static_weekly_v3_assert_work_payload(jsonb,boolean)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

alter function public.static_weekly_v4_assert_projection_envelope(jsonb,uuid,date,jsonb)
  rename to static_weekly_v4_assert_projection_envelope_single_location_base;

revoke all on function public.static_weekly_v4_assert_projection_envelope_single_location_base(jsonb,uuid,date,jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

create function public.static_weekly_v4_assert_projection_envelope(
  p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_assignment jsonb;
  v_location jsonb;
  v_locations jsonb;
  v_legacy jsonb;
  v_legacy_assignments jsonb;
begin
  if jsonb_typeof(p_envelope->'assignments') is distinct from 'array' then
    raise exception using errcode='23514',message='projection assignments require exact included location authority';
  end if;
  for v_assignment in select value from jsonb_array_elements(p_envelope->'assignments') loop
    v_locations:=v_assignment#>'{work_snapshot,includedLocations}';
    if jsonb_typeof(v_locations) is distinct from 'array'
       or jsonb_array_length(v_locations)<1
       or jsonb_array_length(v_locations)>256 then
      raise exception using errcode='23514',message='each projection work snapshot requires one through 256 included location snapshots';
    end if;
    for v_location in select value from jsonb_array_elements(v_locations) loop
      perform public.static_weekly_assert_exact_object(
        v_location,
        array['locationId','locationNameSnapshot'],
        array['locationId','locationNameSnapshot'],
        'included location snapshot'
      );
      if jsonb_typeof(v_location->'locationId') is distinct from 'string'
         or (v_location->>'locationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or jsonb_typeof(v_location->'locationNameSnapshot') is distinct from 'string'
         or nullif(btrim(v_location->>'locationNameSnapshot'),'') is null then
        raise exception using errcode='23514',message='included location snapshots require canonical location identities and nonblank names';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(v_locations))
       <> (select count(distinct value->>'locationId') from jsonb_array_elements(v_locations)) then
      raise exception using errcode='23514',message='included location snapshots may not repeat a location identity';
    end if;
    if not exists(
      select 1 from jsonb_array_elements(v_locations) x
      where x->>'locationId'=v_assignment#>>'{work_snapshot,locationId}'
    ) then
      raise exception using errcode='23514',message='the routing location must be one of the work family included locations';
    end if;
  end loop;

  select jsonb_agg(
    jsonb_set(a.value,'{work_snapshot}',(a.value->'work_snapshot')-'includedLocations',false)
    order by a.ordinality
  ) into v_legacy_assignments
  from jsonb_array_elements(p_envelope->'assignments') with ordinality a(value,ordinality);
  v_legacy:=jsonb_set(p_envelope,'{assignments}',v_legacy_assignments,false);
  v_legacy:=jsonb_set(
    v_legacy,'{database_projection_identity}',
    to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true
  );
  perform public.static_weekly_v4_assert_projection_envelope_single_location_base(
    v_legacy,p_publication_id,p_week_start,p_exception_set
  );
end
$function$;

revoke all on function public.static_weekly_v4_assert_projection_envelope(jsonb,uuid,date,jsonb)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

alter function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz)
  rename to static_weekly_v5_read_employee_day_single_location_base;

revoke all on function public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamptz)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v5_read_employee_day(
  p_service_date date,p_employee_id uuid,p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare
  v_result jsonb;
  v_field text;
  v_items jsonb;
begin
  v_result:=public.static_weekly_v5_read_employee_day_single_location_base(p_service_date,p_employee_id,p_now);
  foreach v_field in array array['items','all_items','current_items'] loop
    select coalesce(jsonb_agg(
      case when o.occurrence_id is null or jsonb_array_length(i.location_snapshots)=0 then item.value
      else item.value||jsonb_build_object(
        'included_locations',i.location_names,
        'included_location_ids',i.location_ids,
        'included_location_snapshots',i.location_snapshots,
        'is_public_restroom',i.has_public_restroom
      ) end
      order by item.ordinality
    ),'[]'::jsonb) into v_items
    from jsonb_array_elements(coalesce(v_result->v_field,'[]'::jsonb)) with ordinality item(value,ordinality)
    left join public.weekly_schedule_occurrences o
      on o.occurrence_id::text=item.value->>'occurrence_id'
    left join lateral (
      select
        coalesce(jsonb_agg(location.value order by location.ordinality),'[]'::jsonb) as location_snapshots,
        coalesce(jsonb_agg(to_jsonb(location.value->>'locationId') order by location.ordinality),'[]'::jsonb) as location_ids,
        coalesce(jsonb_agg(to_jsonb(location.value->>'locationNameSnapshot') order by location.ordinality),'[]'::jsonb) as location_names,
        coalesce(bool_or(lower(location.value->>'locationNameSnapshot') like '%restroom%'
          or lower(location.value->>'locationNameSnapshot') like '%bathroom%'),false) as has_public_restroom
      from jsonb_array_elements(
        case when jsonb_typeof(o.authority_facts_json#>'{work_snapshot,includedLocations}')='array'
          then o.authority_facts_json#>'{work_snapshot,includedLocations}' else '[]'::jsonb end
      ) with ordinality location(value,ordinality)
    ) i on true;
    v_result:=jsonb_set(v_result,array[v_field],v_items,true);
  end loop;
  return jsonb_set(v_result,'{contract_version}',to_jsonb('static-weekly-employee-day.v2'::text),true);
end
$function$;

revoke all on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz)
to service_role,custodial_application_reader;

comment on function public.static_weekly_v4_assert_projection_envelope(jsonb,uuid,date,jsonb) is
'Validates an attested projection with exact, nonempty, deduplicated family location snapshots while preserving all prior optimizer and source checks.';
comment on function public.static_weekly_v3_assert_work_payload(jsonb,boolean) is
'Validates exact event work payloads with an optional complete family-location snapshot; legacy single-location event payloads remain accepted.';
comment on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) is
'Employee static-weekly read that exposes every included family area and remains compatible with historical single-location projections.';

commit;
