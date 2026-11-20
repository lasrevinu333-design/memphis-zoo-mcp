-- Format compatibility for an already admitted native manual publication only.
-- No schedule, identity, absence, grant, source admission or credential writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $precondition$ begin
  if public.static_weekly_digest_text(pg_get_functiondef('public.custodial_memphis_schedule_day(date)'::regprocedure)) <> 'bf158e709360425ca96b19b4bd396f61b8c2724df4e46828dc9556af1f816d21' then
    raise exception 'Unexpected Memphis schedule predecessor';end if;
end $precondition$;
CREATE OR REPLACE FUNCTION public.custodial_memphis_schedule_day(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_authority record;
  v_dated jsonb;
  v_dated_day jsonb;
  v_envelope jsonb;
  v_native_manual boolean:=false;
  v_row record;
  v_entry jsonb;
  v_matches integer;
  v_identity_matches integer;
  v_seen uuid[]:=array[]::uuid[];
  v_rows jsonb:='[]'::jsonb;
  v_working boolean;
  v_start text;
  v_end text;
begin
  if p_service_date is null or not isfinite(p_service_date) then
    raise exception using errcode='22023',message='Finite schedule service date required';
  end if;
  select * into strict v_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
  if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.publication_id is null or v_authority.projection_id is null then
    return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
      'service_date',p_service_date,'projection_status',v_authority.projection_status,
      'governed',v_authority.governed,'rows','[]'::jsonb);
  end if;
  v_dated:=public.custodial_dated_record(p_service_date);
  if v_dated is not null then
    if v_dated->>'projectionStatus' is distinct from 'current'
      or v_dated->>'publicationId' is distinct from v_authority.publication_id::text
      or v_dated->>'projectionId' is distinct from v_authority.projection_id::text
      or jsonb_typeof(v_dated->'days') is distinct from 'array'
      or jsonb_typeof(v_dated#>'{plan,rosterSlots}') is distinct from 'array' then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','dated_authority_mismatch','rows','[]'::jsonb);
    end if;
    select count(*),(jsonb_agg(day.value)->0) into v_matches,v_dated_day
    from jsonb_array_elements(v_dated->'days') day(value)
    where day.value->>'serviceDate'=p_service_date::text;
    if v_matches<>1 or jsonb_typeof(v_dated_day->'availability') is distinct from 'array' then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','dated_day_missing','rows','[]'::jsonb);
    end if;
  else
    select projection.projection_envelope,
      /* memphis_native_manual_format_begin */
      coalesce((
        v_authority.governed is true and v_authority.projection_status='current'
        and projection.projection_id=v_authority.projection_id
        and projection.publication_id=v_authority.publication_id
        and projection.version_id=v_authority.version_id
        and projection.compiler_version='approved-manual-period-v1'
        and projection.projection_envelope->'adapter'=
          '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
        and projection.projection_envelope->>'compiler_version'='approved-manual-period-v1'
        and projection.projection_envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
        and projection.projection_envelope#>'{authority,sourcePublicationId}'=to_jsonb(v_authority.publication_id::text)
        and projection.projection_envelope#>'{authority,sourceVersionId}'=to_jsonb(v_authority.version_id::text)
        and projection.projection_envelope#>'{authority,frameStart}'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope#>'{authority,frameEnd}'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'week_start'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope->'week_end'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'service_date'=to_jsonb(projection.week_start::text)
        and projection.week_end=projection.week_start+6
        and p_service_date between projection.week_start and projection.week_end
        and projection.projection_envelope#>'{authority,normalSourceChanged}'='false'::jsonb
        and projection.projection_envelope#>'{authority,objectiveSolverRerun}'='false'::jsonb
        and projection.authority_digest ~ '^[0-9a-f]{64}$'
        and projection.projection_envelope->'authority_digest'=to_jsonb(projection.authority_digest)
      ),false)
      /* memphis_native_manual_format_end */
      into v_envelope,v_native_manual
    from public.weekly_schedule_compiled_projections projection
    where projection.projection_id=v_authority.projection_id
      and projection.publication_id=v_authority.publication_id
      and projection.version_id=v_authority.version_id;
    if jsonb_typeof(v_envelope#>'{authority,projectionAvailability}') is distinct from 'array' then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','availability_missing','rows','[]'::jsonb);
    end if;
  end if;
  for v_row in select roster.* from public.static_weekly_v6_read_roster(p_service_date) roster loop
    if v_row.governed is not true or v_row.projection_status is distinct from 'current'
      or v_row.publication_id is distinct from v_authority.publication_id
      or v_row.projection_id is distinct from v_authority.projection_id then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','roster_authority_mismatch','rows','[]'::jsonb);
    end if;
    if v_row.employee_id is null then continue;end if;
    if v_row.employee_id=any(v_seen) then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','duplicate_employee_slot','rows','[]'::jsonb);
    end if;
    v_seen:=array_append(v_seen,v_row.employee_id);
    if not exists(select 1 from public.employees employee where employee.id=v_row.employee_id and employee.active=true) then
      continue;
    end if;
    v_working:=v_row.active is true;
    v_start:=left(coalesce(v_row.shift_start,''),5);
    v_end:=left(coalesce(v_row.shift_end,''),5);
    if v_dated is not null then
      select count(*) into v_identity_matches
      from jsonb_array_elements(v_dated#>'{plan,rosterSlots}') slot(value)
      where slot.value->>'slotId'=v_row.slot_id::text
        and slot.value->>'personId'=v_row.employee_id::text;
      select count(*),(jsonb_agg(availability.value)->0) into v_matches,v_entry
      from jsonb_array_elements(v_dated_day->'availability') availability(value)
      where availability.value->>'slotId'=v_row.slot_id::text;
      if v_identity_matches<>1 or v_matches<>1 or jsonb_typeof(v_entry) is distinct from 'object'
        or coalesce(v_entry->>'status','') not in ('working','absent','unavailable','departed_named_absent','vacant_unfilled')
        or (v_row.active is true) is distinct from (v_entry->>'status'='working') then
        return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
          'service_date',p_service_date,'projection_status','dated_identity_ambiguous','rows','[]'::jsonb);
      end if;
      v_working:=v_entry->>'status'='working';
      v_start:=v_entry#>>'{shift,start}';
      v_end:=v_entry#>>'{shift,end}';
    else
      if v_row.slot_id is null then
        return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
          'service_date',p_service_date,'projection_status','slot_identity_missing','rows','[]'::jsonb);
      end if;
      select count(*),(jsonb_agg(item.value)->0) into v_matches,v_entry
      from jsonb_array_elements(v_envelope#>'{authority,projectionAvailability}') item(value)
      where item.value->>'serviceDate'=p_service_date::text
        and item.value->>'slotId'=v_row.slot_id::text
        and (item.value->>'incumbentSlotId'=v_row.slot_id::text
          or (v_native_manual and not (item.value ? 'incumbentSlotId')))
        and item.value->>'incumbentPersonId'=v_row.employee_id::text
        and item.value->'dayOfWeek'=to_jsonb(extract(dow from p_service_date)::integer);
      if v_matches<>1 or jsonb_typeof(v_entry) is distinct from 'object'
        or coalesce(v_entry->>'status','') not in ('working','absent','unavailable','departed_named_absent','vacant_unfilled') then
        return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
          'service_date',p_service_date,'projection_status','availability_ambiguous','rows','[]'::jsonb);
      end if;
      v_working:=v_working and v_entry->>'status'='working';
      v_start:=v_entry#>>'{shift,start}';
      v_end:=v_entry#>>'{shift,end}';
    end if;
    if v_working and (coalesce(v_start,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(v_end,'') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
      or v_start>=v_end) then
      return jsonb_build_object('schema','memphis.schedule-day.v1','status','unavailable',
        'service_date',p_service_date,'projection_status','shift_invalid','rows','[]'::jsonb);
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employee_id',v_row.employee_id,
      'employee_name',v_row.employee_name,'employee_code',v_row.employee_code,
      'working',v_working,'shift_start',case when v_working then v_start else null end,
      'shift_end',case when v_working then v_end else null end,
      'slot_id',v_row.slot_id));
  end loop;
  return jsonb_build_object('schema','memphis.schedule-day.v1','status','current',
    'service_date',p_service_date,'governed',true,'publication_id',v_authority.publication_id,
    'projection_id',v_authority.projection_id,'rows',v_rows);
end $function$;

do $recovery$ declare definition text; changed integer; begin
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
    raise exception 'Recovery inventory immutability unavailable';end if;
  definition:=pg_get_functiondef('public.custodial_memphis_schedule_day(date)'::regprocedure);
  alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind='function' and object_identity='public.custodial_memphis_schedule_day(date)';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Exact schedule recovery row required';end if;
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
