begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $preflight$
begin
  if to_regclass('public.employee_native_push_delivery_receipts') is null
     or to_regclass('public.v_location_dashboard_status') is null
     or to_regclass('public.custodial_release_authority_restore_inventory') is null
     or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'completed-cleaning reminder prerequisites are unavailable';
  end if;
end $preflight$;

-- Owner-confirmed 2026-09-22. These are elapsed minutes, not shift start offsets.
insert into public.system_settings(setting_key,setting_value,description) values
 ('restroom_due_soon_minutes','75'::jsonb,'Restroom due-soon interval after completed cleaning'),
 ('restroom_overdue_minutes','90'::jsonb,'Restroom overdue interval after completed cleaning'),
 ('exhibit_due_soon_minutes','195'::jsonb,'Exhibit due-soon interval after completed cleaning'),
 ('exhibit_overdue_minutes','210'::jsonb,'Exhibit overdue interval after completed cleaning')
on conflict(setting_key) do update set setting_value=excluded.setting_value,
 description=excluded.description,updated_at=statement_timestamp();

-- Pure timing calculation. Reminder state never changes actual cleaning history.
create or replace function public.mz_cleaning_reminder_cycle(
 p_form_type text,p_cleaned_at timestamptz,p_overdue_sent_at timestamptz,p_now timestamptz
) returns table(cycle_base_at timestamptz,cycle_base_evidence text,
 due_soon_at timestamptz,overdue_at timestamptz,status_code text)
language plpgsql immutable set search_path=pg_catalog,public as $function$
declare v_soon integer;v_overdue integer;
begin
 if p_now is null or not isfinite(p_now) then raise exception 'reminder time is required'; end if;
 if p_cleaned_at is null then return; end if;
 if not isfinite(p_cleaned_at) or p_cleaned_at>p_now then return; end if;
 if p_form_type='restroom' then v_soon:=75;v_overdue:=90;
 elsif p_form_type='exhibit' then v_soon:=195;v_overdue:=210;
 else return; end if;
 cycle_base_at:=p_cleaned_at;cycle_base_evidence:='completed_cleaning';
 if p_overdue_sent_at is not null and isfinite(p_overdue_sent_at)
    and p_overdue_sent_at>=p_cleaned_at and p_overdue_sent_at<=p_now then
   cycle_base_at:=p_overdue_sent_at;cycle_base_evidence:='provider_accepted_overdue';
 end if;
 due_soon_at:=cycle_base_at+make_interval(mins=>v_soon);
 overdue_at:=cycle_base_at+make_interval(mins=>v_overdue);
 status_code:=case when p_now>=overdue_at then 'overdue'
                   when p_now>=due_soon_at then 'due_soon' else null end;
 return next;
end $function$;

-- Read only authoritative completions and real provider-accepted overdue sends.
-- MIN per logical key prevents multiple phones, retries or reassignment moving a cycle.
create or replace function public.mz_location_reminder_candidates(
 p_service_date date,p_now timestamptz default now()
) returns table(location_id uuid,notification_key text,status_code text,
 cycle_base_at timestamptz,cycle_base_evidence text,cleaned_at timestamptz,
 due_soon_at timestamptz,overdue_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
 select s.location_id,
   'location-cycle:'||p_service_date::text||':'||s.location_id::text||':'||cycle.status_code||':'||
   to_char(s.latest_completed_at at time zone 'UTC','YYYYMMDDHH24MISSUS')||':'||
   to_char(cycle.cycle_base_at at time zone 'UTC','YYYYMMDDHH24MISSUS'),
   cycle.status_code,cycle.cycle_base_at,cycle.cycle_base_evidence,s.latest_completed_at,
   cycle.due_soon_at,cycle.overdue_at
 from public.v_location_dashboard_status s
 left join lateral (
   select max(logical.first_sent_at) as last_overdue_sent_at from (
     select min(r.delivered_at) as first_sent_at
     from public.operational_notification_jobs j
     join public.employee_native_push_delivery_receipts r on r.job_id=j.job_id
     where j.source_id=s.location_id and j.job_type='employee_native_push'
       and j.payload_json#>>'{data_json,kind}'='employee_location_status'
       and j.payload_json#>>'{data_json,reminder_contract}'='completed-cleaning-reminders.v1'
       and j.payload_json#>>'{data_json,status_code}'='overdue'
       and j.payload_json#>>'{data_json,service_date}'=p_service_date::text
       and j.payload_json#>>'{data_json,cleaned_at}'=to_char(s.latest_completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       and coalesce(j.payload_json#>>'{data_json,test_delivery}','false')='false'
       and r.delivery_state='delivered' and r.provider_message_id is not null
       and r.delivered_at>=s.latest_completed_at and r.delivered_at<=p_now
     group by j.payload_json#>>'{data_json,notification_key}'
   ) logical
 ) sent on true
 cross join lateral public.mz_cleaning_reminder_cycle(
   s.form_type,s.latest_completed_at,sent.last_overdue_sent_at,p_now) cycle
 where p_service_date=public.sch_service_date(p_now)
   and s.latest_completed_at>=s.operational_day_start
   and s.open_session_status is distinct from 'active'
   and s.open_session_status is distinct from 'pending_submit'
   and cycle.status_code is not null;
$function$;

create or replace function public.mz_enqueue_employee_location_pushes(
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_inserted integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('custodial-reminder-cycles'),hashtext(v_service_date::text));
  with targets as (
    select registration.credential_id, registration.employee_id,
      registration.device_id, registration.assignment_epoch,
      device.device_id as device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id = registration.device_id
     and device.assigned_employee_id = registration.employee_id
     and device.assignment_epoch = registration.assignment_epoch
     and device.active = true
    join public.employees employee on employee.id = registration.employee_id and employee.active = true
    join public.device_auth_credentials credential
      on credential.credential_id = registration.credential_id
     and credential.device_id = device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at > p_now
    where registration.active = true and registration.revoked_at is null
  ), assigned_locations as (
    select distinct on (target.credential_id, assignment.location_id)
      target.*,
      assignment.location_group_id, assignment.group_code, assignment.group_name,
      assignment.location_id, assignment.location_code,
      assignment.location_name, assignment.form_type
    from targets target
    join lateral public.custodial_operational_location_assignments(v_service_date) assignment
      on assignment.assigned_employee_id = target.employee_id
     and assignment.assignment_status = 'ASSIGNED'
     and assignment.coverage_start <= (p_now at time zone 'America/Chicago')::time
     and (p_now at time zone 'America/Chicago')::time < assignment.coverage_end
    order by target.credential_id, assignment.location_id,
      assignment.coverage_start, assignment.group_name, assignment.group_code
  ), candidates as (
    select assigned.*,cycle.status_code,cycle.notification_key,cycle.cleaned_at,
      cycle.cycle_base_at,cycle.cycle_base_evidence,cycle.due_soon_at,cycle.overdue_at
    from assigned_locations assigned
    join public.mz_location_reminder_candidates(v_service_date,p_now) cycle
      on cycle.location_id=assigned.location_id
  )
  insert into public.operational_notification_jobs(job_key, job_type, source_id, available_at, payload_json)
  select 'employee-location-push:' || candidate.notification_key || ':' || candidate.credential_id::text,
    'employee_native_push', candidate.location_id, p_now,
    jsonb_build_object(
      'credential_id', candidate.credential_id,
      'employee_id', candidate.employee_id,
      'device_id', candidate.device_id,
      'device_identifier', candidate.device_identifier,
      'assignment_epoch', candidate.assignment_epoch,
      'channel_id', case when candidate.status_code = 'overdue' then 'employee-overdue' else 'employee-due-soon' end,
      'title', candidate.location_name || case when candidate.status_code = 'overdue' then ' is overdue' else ' is due soon' end,
      'body', candidate.location_name || case when candidate.status_code = 'overdue'
        then ' on your assigned route needs attention now.'
        else ' on your assigned route is approaching its cleaning window.' end,
      'data_json', jsonb_build_object(
        'kind', 'employee_location_status',
        'reminder_contract','completed-cleaning-reminders.v1',
        'cleaned_at',to_char(candidate.cleaned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'cycle_base_at',candidate.cycle_base_at,
        'cycle_base_evidence',candidate.cycle_base_evidence,
        'due_soon_at',candidate.due_soon_at,
        'overdue_at',candidate.overdue_at,
        'notification_type', 'location_status',
        'notification_key', candidate.notification_key,
        'status_code', candidate.status_code,
        'service_date', v_service_date::text,
        'location_id', candidate.location_id::text,
        'location_code', candidate.location_code,
        'location_name', candidate.location_name,
        'form_type', candidate.form_type,
        'group_code', candidate.group_code,
        'group_name', candidate.group_name,
        'route', 'employee-schedule.html?hub=employee&highlight=' ||
          replace(replace(coalesce(candidate.location_code, ''), '%', '%25'), ' ', '%20')
      )
    )
  from candidates candidate
  where not exists (
    select 1 from public.device_notification_acknowledgements acknowledgement
    where upper(btrim(acknowledgement.device_identifier)) = upper(btrim(candidate.device_identifier))
      and acknowledgement.notification_key = candidate.notification_key
      and acknowledgement.acknowledged_at is not null
  )
  on conflict(job_key) do nothing;
  get diagnostics v_inserted = row_count;

  update public.operational_notification_jobs job
  set status = 'dead', completed_at = now(),
    last_error = 'employee_assignment_or_notification_superseded', updated_at = now()
  where job.job_type = 'employee_native_push'
    and job.status in ('pending', 'leased')
    and (
      not exists (
        select 1
        from public.employee_push_registrations registration
        join public.devices device on device.id = registration.device_id
        join public.device_auth_credentials credential on credential.credential_id = registration.credential_id
        where registration.credential_id = (job.payload_json->>'credential_id')::uuid
          and registration.assignment_epoch = (job.payload_json->>'assignment_epoch')::bigint
          and registration.active = true and registration.revoked_at is null
          and device.id = registration.device_id and device.active = true
          and device.assigned_employee_id = registration.employee_id
          and device.assignment_epoch = registration.assignment_epoch
          and credential.device_id = device.id and credential.confirmed_at is not null
          and credential.revoked_at is null and credential.expires_at > p_now
      )
      or (
        job.payload_json->'data_json'->>'notification_type' = 'location_status'
        and exists (
          select 1 from public.device_notification_acknowledgements acknowledgement
          where upper(btrim(acknowledgement.device_identifier)) =
                upper(btrim(job.payload_json->>'device_identifier'))
            and acknowledgement.notification_key = job.payload_json->'data_json'->>'notification_key'
            and acknowledgement.acknowledged_at is not null
        )
      )
    );


  -- Retire stale cycle intents, but never disturb a prepared/provider-accepted send.
  update public.operational_notification_jobs job
  set status='dead',completed_at=p_now,last_error='cleaning_reminder_superseded',updated_at=p_now
  where job.job_type='employee_native_push' and job.status in ('pending','leased')
    and job.payload_json#>>'{data_json,kind}'='employee_location_status'
    and coalesce(job.payload_json#>>'{data_json,test_delivery}','false')='false'
    and not exists(select 1 from public.employee_native_push_delivery_receipts r where r.job_id=job.job_id)
    and not exists(
      select 1 from public.mz_location_reminder_candidates(v_service_date,p_now) c
      join public.custodial_operational_location_assignments(v_service_date) a on a.location_id=c.location_id
      where c.location_id=job.source_id
        and c.notification_key=job.payload_json#>>'{data_json,notification_key}'
        and a.assigned_employee_id::text=job.payload_json->>'employee_id'
        and a.assignment_status='ASSIGNED'
        and a.coverage_start <= (p_now at time zone 'America/Chicago')::time
        and (p_now at time zone 'America/Chicago')::time < a.coverage_end
    );

  return jsonb_build_object('ok', true, 'enqueued', v_inserted,
    'service_date', v_service_date, 'checked_at', p_now);
end
$function$;

revoke all on function public.mz_enqueue_employee_location_pushes(timestamptz)
from public, anon, authenticated;
grant execute on function public.mz_enqueue_employee_location_pushes(timestamptz)
to postgres, service_role;


-- A queued reminder may outlive a cleaning or area handoff. Recheck before FCM.
create or replace function public.mz_validate_employee_location_reminder(
 p_job_id uuid,p_lease_token uuid,p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $function$
declare j public.operational_notification_jobs%rowtype;v_current boolean;
begin
 select * into j from public.operational_notification_jobs where job_id=p_job_id;
 if j.job_id is null or j.job_type is distinct from 'employee_native_push'
    or j.status is distinct from 'leased' or j.lease_token is distinct from p_lease_token
    or j.leased_until is null or j.leased_until<=p_now then
   return jsonb_build_object('current',false,'reason','location_reminder_lease_superseded');
 end if;
 if j.payload_json#>>'{data_json,kind}' is distinct from 'employee_location_status'
    or j.payload_json#>>'{data_json,reminder_contract}' is distinct from 'completed-cleaning-reminders.v1' then
   return jsonb_build_object('current',false,'reason','location_reminder_contract_superseded');
 end if;
 select exists(
   select 1 from public.mz_location_reminder_candidates(public.sch_service_date(p_now),p_now) c
   join public.custodial_operational_location_assignments(public.sch_service_date(p_now)) a
     on a.location_id=c.location_id
   where c.location_id=j.source_id
     and c.notification_key=j.payload_json#>>'{data_json,notification_key}'
     and a.assigned_employee_id::text=j.payload_json->>'employee_id'
     and a.assignment_status='ASSIGNED'
     and a.coverage_start <= (p_now at time zone 'America/Chicago')::time
     and (p_now at time zone 'America/Chicago')::time < a.coverage_end
 ) into v_current;
 return jsonb_build_object('current',v_current,'reason',
   case when v_current then null else 'location_reminder_cycle_or_responsibility_superseded' end);
end $function$;

revoke all on function public.mz_cleaning_reminder_cycle(text,timestamptz,timestamptz,timestamptz),
 public.mz_location_reminder_candidates(date,timestamptz),
 public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mz_cleaning_reminder_cycle(text,timestamptz,timestamptz,timestamptz),
 public.mz_location_reminder_candidates(date,timestamptz),
 public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz) to postgres,service_role;
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $bind_release_recovery$
declare
  identity text;
  canonical text;
  definition text;
  grant_definition text;
  next_order integer;
  changed integer;
begin
  foreach identity in array array[
    'public.mz_cleaning_reminder_cycle(text,timestamptz,timestamptz,timestamptz)',
    'public.mz_location_reminder_candidates(date,timestamptz)',
    'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
    'public.mz_enqueue_employee_location_pushes(timestamptz)'
  ] loop
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if canonical is null or definition is null then
      raise exception 'cleaning reminder recovery function % is missing',identity;
    end if;

    update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,
        definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='function' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory
      where object_kind='function' and restore_order<200000;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(next_order,'function',canonical,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
    elsif changed<>1 then
      raise exception 'cleaning reminder recovery function identity % is duplicated',canonical;
    end if;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    if grant_definition is null then
      raise exception 'cleaning reminder recovery grant for % is unavailable',canonical;
    end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=grant_definition,
        definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='grant' and object_identity=canonical;
    get diagnostics changed=row_count;
    if changed=0 then
      select greatest(coalesce(max(restore_order),900000),900000)+1 into next_order
      from public.custodial_release_authority_restore_inventory;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(next_order,'grant',canonical,grant_definition,
        encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'));
    elsif changed<>1 then
      raise exception 'cleaning reminder recovery grant identity % is duplicated',canonical;
    end if;
  end loop;

  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $bind_release_recovery$;
commit;
