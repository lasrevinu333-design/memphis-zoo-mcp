-- F15/F16 integration dependency: compatibility with the already admitted native manual projection format.
-- REVIEWABLE SUCCESSOR ONLY. Main owns canonical identity/recovery guard binding.
-- No historical migrations, stored source, approval records or eligibility policy change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $guard$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure))
  IS DISTINCT FROM '9882aee1324bec65acfaf5252c8d876a13f06f250cd194620dfd8e0b25deceb5' THEN
  RAISE EXCEPTION 'native Event manual-format predecessor changed';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.mz_event_reminder_schedule_candidate(p_record jsonb, p_employee_id uuid, p_notification_kind text)
 RETURNS TABLE(reminder_date date, scheduled_for timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with event as materialized (
    select e.*,e.event_date-offsets.days_before as reminder_date
    from jsonb_populate_record(null::public.events_app_events,p_record) e
    join public.employees employee on employee.id=p_employee_id and employee.active=true
    cross join (values('three_days_before',3),('two_days_before',2),('shift_plus_15',0)) offsets(kind,days_before)
    where e.status='SCHEDULED' and coalesce(e.needs_review,false)=false
      and e.archived_at is null and e.cancelled_at is null and offsets.kind=p_notification_kind
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
$function$;
COMMIT;
