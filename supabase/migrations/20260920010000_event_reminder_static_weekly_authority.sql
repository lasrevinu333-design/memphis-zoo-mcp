-- Event reminders consume the same current static-weekly authority as phones.
-- Historical daily rows remain compatibility-only for explicitly ungoverned dates.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.mz_event_reminder_schedule(
  p_event_id uuid,p_event_revision integer,p_employee_id uuid,p_notification_kind text
) returns table(reminder_date date,scheduled_for timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
  with event as materialized (
    select e.*,e.event_date-offsets.days_before as reminder_date
    from public.events_app_events e
    join public.employees employee on employee.id=p_employee_id and employee.active=true
    cross join (values('three_days_before',3),('two_days_before',2),('shift_plus_15',0)) offsets(kind,days_before)
    where e.id=p_event_id and e.revision=p_event_revision and e.status='SCHEDULED'
      and e.archived_at is null and e.cancelled_at is null and offsets.kind=p_notification_kind
      and (e.audience_scope<>'specific_employees' or p_employee_id=any(e.audience_employee_ids))
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
    -- A union of partial absences can cover the whole shift without changing
    -- status to absent. Require at least one uncovered half-open shift point.
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
    where (e.audience_scope='specific_employees' and p_employee_id=any(e.audience_employee_ids))
      or e.audience_scope='all_working_employees'
      or (e.audience_scope='assigned_location' and case when event_day.governed then
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

revoke all on function public.mz_event_reminder_schedule(uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.mz_event_reminder_schedule(uuid,integer,uuid,text) to service_role;

create or replace function public.mz_enqueue_employee_event_pushes(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_inserted integer:=0;
begin
  with recipients as (
    select distinct e.id event_id,e.revision event_revision,e.event_date service_date,
      emp.id employee_id,d.id device_id,d.assignment_epoch,c.credential_id,e.event_name,e.display_location
    from public.events_app_events e
    join public.employees emp on emp.active=true
    join public.devices d on d.assigned_employee_id=emp.id and d.active=true
    join public.device_auth_credentials c
      on c.device_id=d.id and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>p_now
    join public.employee_push_registrations pr
      on pr.device_id=d.id and pr.credential_id=c.credential_id and pr.employee_id=emp.id
     and pr.assignment_epoch=d.assignment_epoch and pr.active=true and pr.revoked_at is null
    where e.status='SCHEDULED' and e.archived_at is null and e.cancelled_at is null
      and e.event_date between ((p_now at time zone 'America/Chicago')::date-1)
                           and ((p_now at time zone 'America/Chicago')::date+60)
  ), reminders as (
    select recipients.*,k.kind notification_kind,s.scheduled_for
    from recipients
    cross join (values('three_days_before'::text),('two_days_before'::text),('shift_plus_15'::text)) k(kind)
    cross join lateral public.mz_event_reminder_schedule(event_id,event_revision,employee_id,k.kind) s
    where s.reminder_date >= (p_now at time zone 'America/Chicago')::date
  ), inserted as (
    insert into public.event_push_instances(
      notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
      assignment_epoch,notification_kind,scheduled_for
    )
    select 'event:'||event_id||':'||event_revision||':'||service_date||':'||employee_id||':'||device_id||':'||assignment_epoch||':'||notification_kind,
      event_id,event_revision,service_date,employee_id,device_id,credential_id,assignment_epoch,notification_kind,scheduled_for
    from reminders
    on conflict(event_id,event_revision,service_date,employee_id,device_id,assignment_epoch,notification_kind)
    do update set scheduled_for=excluded.scheduled_for,state='pending',cancelled_at=null,last_error=null,updated_at=p_now
    where event_push_instances.dispatch_started_at is null and event_push_instances.provider_message_id is null
      and (event_push_instances.state='pending' or (event_push_instances.state='cancelled'
        and event_push_instances.last_error='event_or_assignment_superseded'))
    returning *
  )
  insert into public.operational_notification_jobs(job_key,job_type,source_id,available_at,payload_json)
  select 'employee-event-push:'||i.notification_key,'employee_event_push',i.instance_id,i.scheduled_for,
    jsonb_build_object('instance_id',i.instance_id,'notification_key',i.notification_key,'event_id',i.event_id,
      'employee_id',i.employee_id,'device_id',i.device_id,'credential_id',i.credential_id,
      'assignment_epoch',i.assignment_epoch,'notification_kind',i.notification_kind)
  from inserted i
  on conflict(job_key) do update set available_at=excluded.available_at,status='pending',completed_at=null,last_error=null,updated_at=p_now
    where operational_notification_jobs.status='pending' or (operational_notification_jobs.status='dead'
      and operational_notification_jobs.last_error='event_or_assignment_superseded');
  get diagnostics v_inserted=row_count;

  update public.event_push_instances i
  set state='cancelled',cancelled_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
  where i.state in ('pending','leased') and not exists (
    select 1 from public.events_app_events e
    join public.devices d on d.id=i.device_id
    join public.device_auth_credentials c on c.credential_id=i.credential_id
    join public.employee_push_registrations pr
      on pr.credential_id=i.credential_id and pr.assignment_epoch=i.assignment_epoch
     and pr.employee_id=i.employee_id and pr.active=true and pr.revoked_at is null
    where e.id=i.event_id and e.revision=i.event_revision and e.status='SCHEDULED'
      and e.cancelled_at is null and d.active=true and d.assigned_employee_id=i.employee_id
      and d.assignment_epoch=i.assignment_epoch and c.revoked_at is null and c.expires_at>p_now
      and exists(select 1 from public.mz_event_reminder_schedule(e.id,e.revision,i.employee_id,i.notification_kind) s
        where s.scheduled_for=i.scheduled_for)
  );
  update public.operational_notification_jobs j
  set status='dead',completed_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
  where j.job_type='employee_event_push' and j.status in ('pending','leased')
    and exists(select 1 from public.event_push_instances i where i.instance_id=j.source_id and i.state='cancelled');
  return jsonb_build_object('ok',true,'enqueued',v_inserted,'checked_at',p_now);
end
$function$;

-- Recover these exact corrected definitions without recapturing unrelated drift.
do $bind_event_static_authority_recovery$
declare identity text; canonical text; definition text; grant_definition text; changed integer;
begin
  if not exists(select 1 from pg_trigger
    where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'event authority recovery inventory immutability must be enabled before rebinding';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  foreach identity in array array[
    'public.mz_event_reminder_schedule(uuid,integer,uuid,text)',
    'public.mz_enqueue_employee_event_pushes(timestamp with time zone)'
  ] loop
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    if canonical is null or definition is null or grant_definition is null then
      raise exception 'required event authority recovery function or grant % is missing',identity;
    end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,
      definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
    where object_kind='function' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'event recovery function identity % is missing or duplicated',canonical; end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=grant_definition,
      definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
      captured_at=statement_timestamp()
    where object_kind='grant' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'event recovery grant identity % is missing or duplicated',canonical; end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end
$bind_event_static_authority_recovery$;
commit;
