begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Generic imported/manager notes are never a speech source. Only these
-- deliberately selected, fixed custodial operations have a public wording.
alter table public.events_app_events
  add column custodial_note_codes text[] not null default '{}'::text[],
  add column custodial_public_notes text not null default '',
  add constraint events_app_custodial_note_codes_check check (
    custodial_note_codes <@ array['trash_boxes','extra_cans','restroom_checks']::text[]
    and array_position(custodial_note_codes,null) is null
  ),
  add constraint events_app_custodial_public_notes_check check (length(custodial_public_notes)<=500);
comment on column public.events_app_events.custodial_note_codes is
  'Manager-selected custodial-only reminder codes. Never infer from generic notes, source text, parser, or ticket details.';
comment on column public.events_app_events.custodial_public_notes is
  'Explicit manager-classified employee-visible and spoken custodial preparation. Never infer from generic notes, source text, parser, or ticket details.';

-- Extend the existing named-manager event writer in place so the event row,
-- its revision/CAS check, and immutable history stay one atomic operation.
do $event_writer$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.app_apply_event_command(text,uuid,jsonb,text,text)'::regprocedure);
  if strpos(v_definition,'attendee_count,notes,created_by,')=0
     or strpos(v_definition,$needle$nullif(v_record->>'notes',''),v_actor,v_actor_manager_id$needle$)=0
     or strpos(v_definition,$needle$notes=nullif(v_record->>'notes',''),revision=$needle$)=0
     or strpos(v_definition,'custodial_note_codes')>0 then
    raise exception 'unexpected event mutation function shape; do not guess note authority';
  end if;
  v_definition:=replace(v_definition,'attendee_count,notes,created_by,',
    'attendee_count,notes,custodial_note_codes,custodial_public_notes,created_by,');
  v_definition:=replace(v_definition,$needle$nullif(v_record->>'notes',''),v_actor,v_actor_manager_id$needle$,
    $replacement$nullif(v_record->>'notes',''),coalesce(array(select distinct code from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'::jsonb)) code),'{}'::text[]),coalesce(v_record->>'custodial_public_notes',''),v_actor,v_actor_manager_id$replacement$);
  v_definition:=replace(v_definition,$needle$notes=nullif(v_record->>'notes',''),revision=$needle$,
    $replacement$notes=nullif(v_record->>'notes',''),custodial_note_codes=coalesce(array(select distinct code from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'::jsonb)) code),'{}'::text[]),custodial_public_notes=coalesce(v_record->>'custodial_public_notes',''),revision=$replacement$);
  execute v_definition;
end $event_writer$;

-- Candidate and persisted reminders share this one projection. It has no
-- event write, coverage write, notification write, or provider side effect.
create function public.mz_event_reminder_schedule_candidate(
  p_record jsonb,p_employee_id uuid,p_notification_kind text
) returns table(reminder_date date,scheduled_for timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
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
      r.slot_id,r.employee_id,r.shift_start as legacy_shift_start,
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
    where r.identity_count=1 and case when not r.governed then r.active=true else
      r.match_count=1 and r.slot_count=1
      and coalesce(r.explicit_staffing_state,'working')='working'
      and jsonb_typeof(r.entry)='object'
      and r.entry->>'slotId'=r.slot_id::text
      and r.entry->>'incumbentSlotId'=r.slot_id::text
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
revoke all on function public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.mz_event_reminder_schedule_candidate(jsonb,uuid,text) to postgres,service_role;

create or replace function public.mz_event_reminder_schedule(
  p_event_id uuid,p_event_revision integer,p_employee_id uuid,p_notification_kind text
) returns table(reminder_date date,scheduled_for timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
  select candidate.reminder_date,candidate.scheduled_for
  from public.events_app_events e
  cross join lateral public.mz_event_reminder_schedule_candidate(to_jsonb(e),p_employee_id,p_notification_kind) candidate
  where e.id=p_event_id and e.revision=p_event_revision
$function$;
revoke all on function public.mz_event_reminder_schedule(uuid,integer,uuid,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.mz_event_reminder_schedule(uuid,integer,uuid,text) to postgres,service_role;

create function public.mz_preview_event_impact(
  p_candidate jsonb,p_manager_id uuid,p_event_id uuid,p_expected_revision integer
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,extensions as $function$
declare
  v_current public.events_app_events%rowtype;
  v_candidate jsonb;
  v_recipients jsonb;
  v_total integer;
  v_now timestamptz:=statement_timestamp();
begin
  if p_manager_id is null or not exists(select 1 from public.ops_manager_managers m
    where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.is_system_principal=false
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
    raise exception using errcode='42501',message='active named manager authority is required for event impact preview';
  end if;
  if jsonb_typeof(p_candidate) is distinct from 'object' then
    raise exception using errcode='22023',message='normalized event candidate is required';
  end if;
  if p_event_id is not null then
    select * into v_current from public.events_app_events e where e.id=p_event_id;
    if not found then raise exception using errcode='P0002',message='event not found'; end if;
    if p_expected_revision is null or p_expected_revision<1 or v_current.revision is distinct from p_expected_revision then
      raise exception using errcode='40901',message='Event changed since this preview. Refresh before saving.';
    end if;
  end if;
  v_candidate:=p_candidate || jsonb_build_object(
    'audience_scope',coalesce(v_current.audience_scope,'assigned_location'),
    'audience_employee_ids',coalesce(to_jsonb(v_current.audience_employee_ids),'[]'::jsonb));
  if v_candidate->>'status'='NEEDS_REVIEW' or v_candidate->>'event_scope'='UNKNOWN' then
    return jsonb_build_object('status','needs_review','projected_at',v_now,'schedule_mutation',false,
      'recipients','[]'::jsonb,'recipient_count',0,'reason','Unresolved venue has no employee reminder or cleaning coverage.');
  end if;
  if v_candidate->>'status'<>'SCHEDULED' or nullif(v_candidate->>'location_group_id','') is null
     or nullif(v_candidate->>'event_date','') is null then
    raise exception using errcode='22023',message='scheduled event date and resolved venue are required for impact preview';
  end if;
  with projected as (
    select emp.id employee_id,emp.display_name employee_name,k.kind notification_kind,
      scheduled.reminder_date,scheduled.scheduled_for,
      (select count(distinct d.id)::integer from public.devices d
       join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
         and c.revoked_at is null and c.expires_at>v_now
       join public.employee_push_registrations pr on pr.device_id=d.id and pr.credential_id=c.credential_id
         and pr.employee_id=emp.id and pr.assignment_epoch=d.assignment_epoch and pr.active=true and pr.revoked_at is null
       where d.assigned_employee_id=emp.id and d.active=true) registered_phone_count
    from public.employees emp
    cross join (values('three_days_before'::text),('two_days_before'::text),('shift_plus_15'::text)) k(kind)
    cross join lateral public.mz_event_reminder_schedule_candidate(v_candidate,emp.id,k.kind) scheduled
    where emp.active=true
  )
  select count(distinct employee_id)::integer,
    coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'employee_name',employee_name,
      'notification_kind',notification_kind,'reminder_date',reminder_date,'scheduled_for',scheduled_for,
      'registered_phone_count',registered_phone_count,'within_enqueue_horizon',
        (v_candidate->>'event_date')::date between ((v_now at time zone 'America/Chicago')::date-1)
          and ((v_now at time zone 'America/Chicago')::date+60),
      'reminder_date_not_past',reminder_date>=(v_now at time zone 'America/Chicago')::date)
      order by reminder_date,scheduled_for,employee_name,notification_kind),'[]'::jsonb)
    into v_total,v_recipients from projected;
  return jsonb_build_object('status','projected','projected_at',v_now,'schedule_mutation',false,
    'recipient_count',v_total,'recipients',v_recipients,
    'notice','Projection only; staffing is not changed and recipient/phone authority is revalidated before delivery.');
end $function$;
revoke all on function public.mz_preview_event_impact(jsonb,uuid,uuid,integer)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.mz_preview_event_impact(jsonb,uuid,uuid,integer) to postgres,service_role;

-- Keep release replay/recovery pinned to the exact post-migration Event
-- authority. Existing unrelated inventory drift remains a separate HOLD.
do $recovery$
declare obj record; next_order integer; changed integer;
begin
  if not exists(select 1 from pg_trigger where
    tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'release recovery inventory immutability is unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
    from pg_proc p where p.oid=any(array[
      'public.app_apply_event_command(text,uuid,jsonb,text,text)'::regprocedure,
      'public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'::regprocedure,
      'public.mz_event_reminder_schedule(uuid,integer,uuid,text)'::regprocedure,
      'public.mz_preview_event_impact(jsonb,uuid,uuid,integer)'::regprocedure])
    union all select 1000,'relation','public.events_app_events',
      public.custodial_release_authority_current_relation_definition('public.events_app_events')
    union all select 200000,'column','public.events_app_events:'||a.attname,
      public.custodial_release_authority_current_column_definition('public.events_app_events:'||a.attname)
      from pg_attribute a where a.attrelid='public.events_app_events'::regclass and a.attname in ('custodial_note_codes','custodial_public_notes')
    union all select 300000,'column_set','public.events_app_events',
      public.custodial_release_authority_current_column_set_definition('public.events_app_events')
    union all select 500000,'constraint','public.events_app_events:events_app_custodial_note_codes_check',
      public.custodial_release_authority_current_constraint_definition('public.events_app_events:events_app_custodial_note_codes_check')
    union all select 500000,'constraint','public.events_app_events:events_app_custodial_public_notes_check',
      public.custodial_release_authority_current_constraint_definition('public.events_app_events:events_app_custodial_public_notes_check')
    union all select 900000,'grant',r.identity,
      public.custodial_release_authority_current_grant_definition(r.identity)
      from (values('public.app_apply_event_command(text,uuid,jsonb,text,text)'),
        ('public.mz_event_reminder_schedule_candidate(jsonb,uuid,text)'),
        ('public.mz_event_reminder_schedule(uuid,integer,uuid,text)'),
        ('public.mz_preview_event_impact(jsonb,uuid,uuid,integer)')) r(identity)
  loop
    if obj.definition is null then raise exception 'event impact recovery object missing: %',obj.identity; end if;
    update public.custodial_release_authority_restore_inventory
      set object_identity=obj.identity,
        definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),
        captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity)
          else false end);
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'duplicate event recovery identity: %',obj.identity; end if;
    if changed=0 then
      select candidate into next_order
      from generate_series(obj.bucket,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) candidate
      where not exists(select 1 from public.custodial_release_authority_restore_inventory i
        where i.restore_order=candidate)
      order by candidate limit 1;
      if next_order is null then raise exception 'event recovery bucket exhausted'; end if;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;

commit;
