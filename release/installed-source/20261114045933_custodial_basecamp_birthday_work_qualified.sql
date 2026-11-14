SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.event_venues,public.location_groups IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE basecamp_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE basecamp_candidate_before ON COMMIT DROP AS SELECT
 pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure) AS definition,
 public.custodial_release_authority_current_grant_definition('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)') AS grants;
CREATE TEMP TABLE basecamp_canary_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_canary_authority_surface();
CREATE TEMP TABLE basecamp_groups_before ON COMMIT DROP AS TABLE public.location_groups;
CREATE TEMP TABLE basecamp_venues_before ON COMMIT DROP AS TABLE public.event_venues;
CREATE TEMP TABLE basecamp_overlay_before ON COMMIT DROP AS
 SELECT item AS venue FROM jsonb_array_elements(public.custodial_place_event_venue_overlay(statement_timestamp())->'venues') item;
DO $guard$
BEGIN
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
  OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='custodial_disaster_restore_mutation_fence') IS DISTINCT FROM 'O'
 THEN RAISE EXCEPTION 'Basecamp requires unchanged ALWAYS inventory and ordinary restore fences';END IF;
 IF encode(sha256(convert_to((SELECT definition FROM basecamp_candidate_before),'UTF8')),'hex')
  IS DISTINCT FROM 'fac14efd2624c6edd09ac425404bbcf650a72f1315c186f815efdeaebacf72b0'
  OR encode(sha256(convert_to((SELECT grants FROM basecamp_candidate_before),'UTF8')),'hex')
  IS DISTINCT FROM 'f49a9a2a360ddcfbb5ddc7f02451cca87218e5f5ed52fff46b142b8a841ec53e'
 THEN RAISE EXCEPTION 'Basecamp exact current425 reminder predecessor differs';END IF;
 IF (SELECT count(*) FROM basecamp_inventory_before i WHERE CASE WHEN i.object_kind='function' THEN to_regprocedure(i.object_identity) END='public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure
  AND i.restore_order=100350 AND i.definition_sql=(SELECT definition FROM basecamp_candidate_before)
  AND i.definition_sha256='fac14efd2624c6edd09ac425404bbcf650a72f1315c186f815efdeaebacf72b0')<>1
 OR (SELECT count(*) FROM basecamp_inventory_before i WHERE CASE WHEN i.object_kind='grant' AND position('(' in i.object_identity)>0 THEN to_regprocedure(i.object_identity) END='public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure
  AND i.definition_sql=(SELECT grants FROM basecamp_candidate_before)
  AND i.definition_sha256='f49a9a2a360ddcfbb5ddc7f02451cca87218e5f5ed52fff46b142b8a841ec53e')<>1
 THEN RAISE EXCEPTION 'Basecamp exact reminder recovery predecessor differs';END IF;
 IF to_regprocedure('public.custodial_is_basecamp_birthday(jsonb)') IS NOT NULL
  OR to_regprocedure('public.custodial_basecamp_morning_owner(date)') IS NOT NULL
  OR to_regprocedure('public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM basecamp_inventory_before WHERE restore_order IN (99995,99996))
 THEN RAISE EXCEPTION 'Basecamp source already exists or early dependency slots changed; reconcile original update';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_place_bridge_versions)
  OR EXISTS(SELECT 1 FROM public.custodial_place_source_versions)
 THEN RAISE EXCEPTION 'Catalog change requires separately qualified existing bridge reconciliation';END IF;
 IF EXISTS(SELECT 1 FROM public.event_venues v WHERE lower(v.venue_code)='safari_basecamp'
  OR EXISTS(SELECT 1 FROM unnest(coalesce(v.aliases,'{}'::text[])||ARRAY[v.display_name]) a
   WHERE lower(a) IN ('safari basecamp','basecamp','birthday room')))
 THEN RAISE EXCEPTION 'Basecamp catalog already exists or aliases collide; reconcile original venue';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.location_groups WHERE id='b522be35-654e-4859-8367-4540f92e8af2'
  AND group_code='MEMMEX_RESTROOMS' AND active AND eligible_custodial_coverage)
 THEN RAISE EXCEPTION 'Original MemMex restroom coverage group is unavailable';END IF;
END
$guard$;


INSERT INTO public.location_groups(id,group_code,group_name,active,notes,eligible_event_venue,eligible_event_scope,
 eligible_custodial_coverage,eligible_staffing_assignment,event_venue)
VALUES('7fb74026-1bf3-4931-af6f-85ad11b77b55','SAFARI_BASECAMP','Safari Basecamp',false,
 'Event-only venue. Dated honor work follows the morning MemMex Restrooms assignee. No NFC assignment.',true,false,false,false,true);
INSERT INTO public.event_venues(id,venue_code,display_name,event_scope,location_group_id,eligible_event_venue,
 eligible_event_scope,aliases,active,metadata_json)
VALUES('f4ca341b-0c61-4905-8d6d-c6f83c9d9787','SAFARI_BASECAMP','Safari Basecamp','SINGLE_VENUE','7fb74026-1bf3-4931-af6f-85ad11b77b55',true,false,
 ARRAY['Safari Basecamp','Basecamp','Birthday Room'],true,
 '{"source":"owner_basecamp_birthday_rule_20261113","coverage_group":"MEMMEX_RESTROOMS","cleaning_mode":"honor_based","nfc_assignment":false}'::jsonb);

-- New owner-requested supplemental honor work. No access-note text, NFC tag,
-- cleaning-session row, recurring route item, or completion is written here.
create function public.custodial_is_basecamp_birthday(p_record jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $basecamp$
 select coalesce(p_record->>'event_name' ~* '(^|[^a-z])(birthday|party|parties)([^a-z]|$)',false)
  and p_record->>'event_scope' in ('SINGLE_VENUE','MULTI_VENUE')
  and exists(select 1 from public.event_venues v where v.venue_code='SAFARI_BASECAMP'
   and v.active and v.eligible_event_venue
   and (v.id::text=p_record->>'primary_venue_id' or coalesce(p_record->'venue_ids' ? v.id::text,false)))
$basecamp$;
revoke all on function public.custodial_is_basecamp_birthday(jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader;

create function public.custodial_basecamp_morning_owner(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $basecamp$
declare authority jsonb; authority_count integer; owners integer; owner_id uuid; eligible boolean; earliest time;
 result jsonb:=jsonb_build_object('schema','custodial.basecamp-morning-owner.v1','service_date',p_service_date,'state','unavailable');
begin
 select count(*),(jsonb_agg(to_jsonb(a))->0) into authority_count,authority
 from public.static_weekly_v6_schedule_authority_state(p_service_date) a;
 if authority_count<>1 or authority->'governed' is distinct from 'true'::jsonb
  or authority->>'projection_status' is distinct from 'current'
  or authority->>'publication_id' is null or authority->>'projection_id' is null or authority->>'version_id' is null then return result;end if;
 result:=result||jsonb_build_object('publication_id',authority->>'publication_id','projection_id',authority->>'projection_id');
 with segments as materialized (
  select s.* from public.static_weekly_v6_read_schedule_segments(p_service_date) s
  where s.location_group_id='b522be35-654e-4859-8367-4540f92e8af2'::uuid
   and s.coverage_purpose='area_owner'
 ), first_owner as (
  select s.* from segments s where s.coverage_start::time=(select min(coverage_start::time) from segments)
 )
 select count(distinct s.assigned_employee_id),min(s.assigned_employee_id::text)::uuid,
  coalesce(bool_and((s.owner_type='EMPLOYEE' and s.status='ASSIGNED' and e.active is true
   and s.assigned_employee_id is not null and s.coverage_end::time>s.coverage_start::time) is true),false)
  and not exists(select 1 from segments stale where stale.governed is distinct from true
   or stale.projection_status is distinct from 'current'
   or stale.publication_id::text is distinct from authority->>'publication_id'
   or stale.projection_id::text is distinct from authority->>'projection_id'
   or stale.version_id::text is distinct from authority->>'version_id'),
  min(s.coverage_start::time)
 into owners,owner_id,eligible,earliest from first_owner s left join public.employees e on e.id=s.assigned_employee_id;
 if owners<>1 or not eligible then return result||jsonb_build_object('state','needs_review');end if;
 return result||jsonb_build_object('state','current','employee_id',owner_id,'morning_coverage_start',earliest);
exception when others then
 -- Unavailable/ambiguous source withholds this optional duty; it must never
 -- select a lunch/closing coverer or abort unrelated event reminders.
 return result||jsonb_build_object('state','needs_review');
end
$basecamp$;
revoke all on function public.custodial_basecamp_morning_owner(date)
 from public,anon,authenticated,service_role,custodial_application_reader;

-- The exact live candidate below retains every native workday, absence,
-- full-hour lunch, finite shift and original publication predicate. Only the
-- Basecamp party copy is routed to MemMex and the unique morning owner.
CREATE OR REPLACE FUNCTION public.mz_event_reminder_schedule_candidate(p_record jsonb, p_employee_id uuid, p_notification_kind text)
 RETURNS TABLE(reminder_date date, scheduled_for timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with event as materialized (
    select e.*,e.event_date-offsets.days_before as reminder_date
    from jsonb_populate_record(null::public.events_app_events,
      case when public.custodial_is_basecamp_birthday(p_record) then p_record||jsonb_build_object(
        'location_group_id','b522be35-654e-4859-8367-4540f92e8af2',
        'audience_scope','assigned_location','audience_employee_ids','[]'::jsonb) else p_record end) e
    join public.employees employee on employee.id=p_employee_id and employee.active=true
    cross join (values('three_days_before',3),('two_days_before',2),('shift_plus_15',0)) offsets(kind,days_before)
    where e.status='SCHEDULED' and coalesce(e.needs_review,false)=false
      and e.archived_at is null and e.cancelled_at is null and offsets.kind=p_notification_kind
      and (not public.custodial_is_basecamp_birthday(p_record) or (
        offsets.kind='shift_plus_15' and exists(
          select 1 from (select public.custodial_basecamp_morning_owner(e.event_date) as owner) morning
          where morning.owner->>'state'='current' and morning.owner->>'employee_id'=p_employee_id::text
        )
      ))
      and (coalesce(e.audience_scope,'assigned_location')<>'specific_employees'
        or p_employee_id=any(coalesce(e.audience_employee_ids,'{}'::uuid[])))
  ), dates as (
    select event_date as service_date from event
    union select event.reminder_date from event
  ), roster as materialized (
    select dates.service_date,authority.governed,authority.projection_status,
      r.employee_id,r.slot_id,r.active,r.shift_start,
      count(*) over(partition by dates.service_date) as identity_count,
      projection.projection_envelope,
      -- Native admitted manual rows omit the redundant incumbentSlotId alias.
      -- This predicate is format compatibility inside the exact current join;
      -- it is never independent publication or source admission authority.
      /* native_event_manual_format_begin */
      coalesce((
        authority.governed is true and authority.projection_status='current'
        and projection.projection_id=authority.projection_id
        and projection.publication_id=authority.publication_id
        and projection.version_id=authority.version_id
        and projection.compiler_version='approved-manual-period-v1'
        and projection.projection_envelope->'adapter'=
          '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
        and projection.projection_envelope->>'compiler_version'='approved-manual-period-v1'
        and projection.projection_envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
        and projection.projection_envelope#>'{authority,sourcePublicationId}'=to_jsonb(authority.publication_id::text)
        and projection.projection_envelope#>'{authority,sourceVersionId}'=to_jsonb(authority.version_id::text)
        and projection.projection_envelope#>'{authority,frameStart}'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope#>'{authority,frameEnd}'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'week_start'=to_jsonb(projection.week_start::text)
        and projection.projection_envelope->'week_end'=to_jsonb(projection.week_end::text)
        and projection.projection_envelope->'service_date'=to_jsonb(projection.week_start::text)
        and projection.week_end=projection.week_start+6
        and dates.service_date between projection.week_start and projection.week_end
        and projection.projection_envelope#>'{authority,normalSourceChanged}'='false'::jsonb
        and projection.projection_envelope#>'{authority,objectiveSolverRerun}'='false'::jsonb
        and projection.authority_digest ~ '^[0-9a-f]{64}$'
        and projection.projection_envelope->'authority_digest'=to_jsonb(projection.authority_digest)
      ),false)
      /* native_event_manual_format_end */ as native_manual_projection,
      staffing.staffing_state as explicit_staffing_state
    from dates
    cross join lateral public.static_weekly_v6_schedule_authority_state(dates.service_date) authority
    cross join lateral public.static_weekly_v6_read_roster(dates.service_date) r
    left join public.weekly_schedule_compiled_projections projection
      on projection.projection_id=authority.projection_id and projection.projection_id=r.projection_id
     and projection.publication_id=authority.publication_id and projection.version_id=authority.version_id
    left join lateral (
      select state.staffing_state
      from public.weekly_roster_slot_staffing_states state
      where state.slot_id=r.slot_id and state.effective_start<=dates.service_date
      order by state.effective_start desc,state.authority_revision desc limit 1
    ) staffing on true
    where r.employee_id=p_employee_id
      and (not authority.governed or authority.projection_status='current')
  ), resolved as materialized (
    select r.service_date,r.governed,r.active,r.identity_count,r.explicit_staffing_state,
      r.slot_id,r.employee_id,r.shift_start as legacy_shift_start,r.native_manual_projection,
      availability.entry,availability.match_count,classification.slot,classification.match_count as slot_count
    from roster r
    left join lateral (
      select (jsonb_agg(item.value)->0) as entry,count(*) as match_count
      from jsonb_array_elements(case
        when jsonb_typeof(r.projection_envelope#>'{authority,projectionAvailability}')='array'
          then r.projection_envelope#>'{authority,projectionAvailability}' else '[]'::jsonb end) item(value)
      where item.value->>'serviceDate'=r.service_date::text
        and (item.value->>'slotId'=r.slot_id::text or item.value->>'incumbentPersonId'=r.employee_id::text)
    ) availability on true
    left join lateral (
      select (jsonb_agg(item.value)->0) as slot,count(*) as match_count
      from jsonb_array_elements(case
        when jsonb_typeof(r.projection_envelope#>'{authority,compilerInput,slots}')='array'
          then r.projection_envelope#>'{authority,compilerInput,slots}' else '[]'::jsonb end) item(value)
      where item.value->>'id'=r.slot_id::text
    ) classification on true
  ), workdays as materialized (
    select r.service_date,r.governed,
      case when r.governed then (r.entry#>>'{shift,start}')::time
        else r.legacy_shift_start::time end as shift_start,
      case when r.governed then (r.entry#>>'{shift,end}')::time else null::time end as shift_end,
      case when r.governed then coalesce(r.entry->'blockedWindows','[]'::jsonb) else '[]'::jsonb end as blocked_windows,
      case when r.governed then coalesce((r.slot->>'contractorCapacity')::boolean,false) else false end as contractor_capacity
    from resolved r
    where /* native_event_workday_predicate_begin */
      r.identity_count=1 and case when not r.governed then r.active=true else
      r.match_count=1 and r.slot_count=1
      and coalesce(r.explicit_staffing_state,'working')='working'
      and jsonb_typeof(r.entry)='object'
      and r.entry->>'slotId'=r.slot_id::text
      and (r.entry->>'incumbentSlotId'=r.slot_id::text
        or (r.native_manual_projection is true and not(r.entry ? 'incumbentSlotId')))
      and r.entry->>'incumbentPersonId'=r.employee_id::text
      and r.entry->'dayOfWeek'=to_jsonb(extract(dow from r.service_date)::integer)
      and r.entry->>'status'='working'
      and jsonb_typeof(r.entry->'shift')='object'
      and jsonb_typeof(r.entry#>'{shift,start}')='string'
      and jsonb_typeof(r.entry#>'{shift,end}')='string'
      and (r.entry#>>'{shift,start}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and (r.entry#>>'{shift,end}') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
      and (r.entry#>>'{shift,start}') < (r.entry#>>'{shift,end}')
      and (not(r.slot ? 'contractorCapacity') or jsonb_typeof(r.slot->'contractorCapacity')='boolean')
      and (not(r.entry ? 'blockedWindows') or jsonb_typeof(r.entry->'blockedWindows')='array')
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(r.entry->'blockedWindows')='array'
          then r.entry->'blockedWindows' else '[]'::jsonb end) blocked(value)
        where jsonb_typeof(blocked.value) is distinct from 'object'
          or jsonb_typeof(blocked.value->'start') is distinct from 'string'
          or jsonb_typeof(blocked.value->'end') is distinct from 'string'
          or coalesce(blocked.value->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(blocked.value->>'end','') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
          or (blocked.value->>'start') >= (blocked.value->>'end')
      ) end
      /* native_event_workday_predicate_end */
  ), eligible_workdays as materialized (
    select day.* from workdays day
    where not day.governed or exists (
      select 1 from (
        select day.shift_start as available_at
        union select (blocked.value->>'end')::time
        from jsonb_array_elements(day.blocked_windows) blocked(value)
      ) boundary
      where boundary.available_at>=day.shift_start and boundary.available_at<day.shift_end
        and not exists (
          select 1 from jsonb_array_elements(day.blocked_windows) blocked(value)
          where boundary.available_at>=(blocked.value->>'start')::time
            and boundary.available_at<(blocked.value->>'end')::time
        )
    )
  ), candidate as (
    select e.*,reminder_day.shift_start,reminder_day.shift_end,reminder_day.blocked_windows,
      reminder_day.governed as reminder_governed,
      e.reminder_date+reminder_day.shift_start+interval '15 minutes' as local_scheduled_for
    from event e
    join eligible_workdays event_day on event_day.service_date=e.event_date
    join eligible_workdays reminder_day on reminder_day.service_date=e.reminder_date
    where (coalesce(e.audience_scope,'assigned_location')='specific_employees'
        and p_employee_id=any(coalesce(e.audience_employee_ids,'{}'::uuid[])))
      or coalesce(e.audience_scope,'assigned_location')='all_working_employees'
      or (coalesce(e.audience_scope,'assigned_location')='assigned_location' and case when event_day.governed then
        not event_day.contractor_capacity and exists (
          select 1 from public.static_weekly_v6_read_schedule_segments(e.event_date) segment
          where segment.location_group_id=e.location_group_id and segment.assigned_employee_id=p_employee_id
            and segment.owner_type='EMPLOYEE' and segment.status='ASSIGNED'
        ) else exists (
          select 1 from public.daily_group_assignments legacy
          where legacy.assignment_date=e.event_date and legacy.location_group_id=e.location_group_id
            and legacy.assigned_employee_id=p_employee_id and legacy.active=true and legacy.is_coverall=false
        ) end)
  )
  select candidate.reminder_date,candidate.local_scheduled_for at time zone 'America/Chicago'
  from candidate
  where not candidate.reminder_governed or (
    candidate.local_scheduled_for < candidate.reminder_date+candidate.shift_end
    and not exists (
      select 1 from jsonb_array_elements(candidate.blocked_windows) blocked(value)
      where candidate.local_scheduled_for >= candidate.reminder_date+(blocked.value->>'start')::time
        and candidate.local_scheduled_for < candidate.reminder_date+(blocked.value->>'end')::time
    )
  )
$function$
;

create function public.custodial_basecamp_birthday_work(
 p_service_date date,p_employee_id uuid,p_publication_id uuid,p_projection_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $basecamp$
declare morning jsonb; items jsonb;
 result jsonb:=jsonb_build_object('schema','custodial.basecamp-birthday-work.v1','state','unavailable',
  'service_date',p_service_date,'employee_id',p_employee_id,'publication_id',p_publication_id,'projection_id',p_projection_id,'items','[]'::jsonb);
begin
 morning:=public.custodial_basecamp_morning_owner(p_service_date);
 if morning->>'state' is distinct from 'current'
  or morning->>'publication_id' is distinct from p_publication_id::text
  or morning->>'projection_id' is distinct from p_projection_id::text then return result;end if;
 result:=result||jsonb_build_object('state','current');
 if morning->>'employee_id' is distinct from p_employee_id::text then return result;end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'event_id',e.id,'event_revision',e.revision,'display_name','Safari Basecamp',
  'party_start',e.start_instant_utc,'party_end',e.end_instant_utc,
  'voice_notice_at',reminder.scheduled_for,'voice_notice_state',case when reminder.scheduled_for is null then 'withheld' else 'planned' end,'cleaning_instruction','Clean before and after the party; empty trash.',
  'honor_based',true,'nfc_required',false) order by e.start_instant_utc,e.id),'[]'::jsonb)
 into items from public.events_app_events e
 left join lateral public.mz_event_reminder_schedule(e.id,e.revision,p_employee_id,'shift_plus_15') reminder on true
 where e.event_date=p_service_date and public.custodial_is_basecamp_birthday(to_jsonb(e))
  and coalesce((public.app_event_place_authority(to_jsonb(e),statement_timestamp())->>'admissible')::boolean,false)
  and e.status='SCHEDULED' and coalesce(e.needs_review,false)=false
  and e.archived_at is null and e.cancelled_at is null and e.superseded_by_event_id is null and e.superseded_at is null
  and e.start_instant_utc is not null and e.end_instant_utc is not null
  and isfinite(e.start_instant_utc) and isfinite(e.end_instant_utc) and e.start_instant_utc<e.end_instant_utc
  and (e.start_instant_utc at time zone 'America/Chicago')::date=p_service_date;
 return result||jsonb_build_object('items',items);
end
$basecamp$;
revoke all on function public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)
 to service_role,custodial_application_reader;

DO $grant_guard$
BEGIN
 IF public.custodial_release_authority_current_grant_definition('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)')
  IS DISTINCT FROM (SELECT grants FROM basecamp_candidate_before) THEN RAISE EXCEPTION 'Basecamp changed existing reminder privileges';END IF;
 IF has_function_privilege('anon','public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('custodial_application_reader','public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Basecamp schedule helper privileges differ';END IF;
END
$grant_guard$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $rebind$
DECLARE item record;kind text;definition text;next_order integer;affected integer;
BEGIN
 definition:=pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure);
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=definition,
  definition_sha256=encode(sha256(convert_to(definition,'UTF8')),'hex'),captured_at=statement_timestamp()
 WHERE CASE WHEN object_kind='function' THEN to_regprocedure(object_identity) END='public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure;
 GET DIAGNOSTICS affected=row_count;IF affected<>1 THEN RAISE EXCEPTION 'Basecamp reminder recovery row count differs';END IF;
 FOR item IN SELECT * FROM (VALUES
  ('public.custodial_is_basecamp_birthday(jsonb)',99995),
  ('public.custodial_basecamp_morning_owner(date)',99996),
  ('public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)',NULL::integer)
 ) selected(identity,early_order) LOOP
  FOREACH kind IN ARRAY ARRAY['function','grant'] LOOP
   definition:=CASE kind WHEN 'function' THEN pg_get_functiondef(to_regprocedure(item.identity))
    ELSE public.custodial_release_authority_current_grant_definition(item.identity) END;
   IF definition IS NULL THEN RAISE EXCEPTION 'Basecamp recovery source missing';END IF;
   IF kind='function' THEN
    IF item.early_order IS NOT NULL THEN next_order:=item.early_order;
    ELSE SELECT greatest(100000,coalesce(max(restore_order),100000))+1 INTO next_order
     FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function';END IF;
   ELSE
    SELECT min(n) INTO next_order FROM generate_series(900001,999998)n
     WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n);
   END IF;
   IF next_order IS NULL THEN RAISE EXCEPTION 'Basecamp recovery order unavailable';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,kind,item.identity,definition,encode(sha256(convert_to(definition,'UTF8')),'hex'));
  END LOOP;
 END LOOP;
END
$rebind$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $after$
DECLARE before_row record;after_row record;item record;kind text;definition text;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*)+6 FROM basecamp_inventory_before)
  OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
  OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='custodial_disaster_restore_mutation_fence') IS DISTINCT FROM 'O'
 THEN RAISE EXCEPTION 'Basecamp recovery count or guard differs';END IF;
 FOR before_row IN SELECT * FROM basecamp_inventory_before LOOP
  SELECT * INTO STRICT after_row FROM public.custodial_release_authority_restore_inventory WHERE inventory_id=before_row.inventory_id;
  IF (CASE WHEN before_row.object_kind='function' THEN to_regprocedure(before_row.object_identity)='public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure ELSE false END) THEN
   definition:=pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure);
   IF after_row.definition_sql IS DISTINCT FROM definition
    OR after_row.definition_sha256 IS DISTINCT FROM encode(sha256(convert_to(definition,'UTF8')),'hex')
    OR (to_jsonb(after_row)-ARRAY['definition_sql','definition_sha256','captured_at'])
     IS DISTINCT FROM (to_jsonb(before_row)-ARRAY['definition_sql','definition_sha256','captured_at'])
   THEN RAISE EXCEPTION 'Basecamp reminder recovery or unrelated metadata changed';END IF;
  ELSIF to_jsonb(after_row) IS DISTINCT FROM to_jsonb(before_row) THEN RAISE EXCEPTION 'Unrelated Basecamp recovery row changed';END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('public.custodial_is_basecamp_birthday(jsonb)'),('public.custodial_basecamp_morning_owner(date)'),
  ('public.custodial_basecamp_birthday_work(date,uuid,uuid,uuid)')
 ) selected(identity) LOOP
  FOREACH kind IN ARRAY ARRAY['function','grant'] LOOP
   definition:=CASE kind WHEN 'function' THEN pg_get_functiondef(to_regprocedure(item.identity))
    ELSE public.custodial_release_authority_current_grant_definition(item.identity) END;
   IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i
    WHERE CASE WHEN i.object_kind=kind AND position('(' in i.object_identity)>0 THEN to_regprocedure(i.object_identity) END=to_regprocedure(item.identity)
     AND definition_sql=definition AND definition_sha256=encode(sha256(convert_to(definition,'UTF8')),'hex'))<>1
   THEN RAISE EXCEPTION 'Basecamp exact recovery binding differs';END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT * FROM basecamp_canary_before EXCEPT SELECT * FROM public.custodial_release_canary_authority_surface())
  OR EXISTS(SELECT * FROM public.custodial_release_canary_authority_surface() EXCEPT SELECT * FROM basecamp_canary_before)
 THEN RAISE EXCEPTION 'Basecamp changed unrelated native or schedule canary roots';END IF;
 IF EXISTS(SELECT * FROM basecamp_groups_before EXCEPT SELECT * FROM public.location_groups)
  OR (SELECT count(*) FROM public.location_groups)<>(SELECT count(*)+1 FROM basecamp_groups_before)
  OR EXISTS(SELECT * FROM basecamp_venues_before EXCEPT SELECT * FROM public.event_venues)
  OR (SELECT count(*) FROM public.event_venues)<>(SELECT count(*)+1 FROM basecamp_venues_before)
 THEN RAISE EXCEPTION 'Basecamp changed an existing venue or group';END IF;
 IF EXISTS(SELECT venue FROM basecamp_overlay_before EXCEPT
   SELECT overlay_row.value FROM jsonb_array_elements(public.custodial_place_event_venue_overlay(statement_timestamp())->'venues') overlay_row(value))
 THEN RAISE EXCEPTION 'Basecamp changed existing venue eligibility or mapping';END IF;
END
$after$;
