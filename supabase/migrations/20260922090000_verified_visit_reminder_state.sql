begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Owner: overdue repeats every five minutes until a completed physical visit.
-- Alert acceptance, dismissal, and scan-in alone are not completion evidence.
create or replace function public.mz_latest_verified_check(
 p_location_id uuid,p_day_start timestamptz,p_now timestamptz
) returns timestamptz language sql stable security definer
set search_path=pg_catalog,public as $function$
 select max(context.native_completed_at)
 from public.custodial_offline_reconciliation_records receipt
 join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
 join public.sessions session on session.id=receipt.session_id
 join public.completion_responses response on response.id=receipt.completion_response_id
 where receipt.state='committed' and context.status='committed' and session.status='closed'
   and receipt.occurrence_id=context.occurrence_id
   and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id
   and receipt.location_id=p_location_id and session.location_id=p_location_id
   and context.location_id=p_location_id and response.location_id=p_location_id
   and response.session_id=session.id and context.client_session_id=session.client_session_id
   and receipt.client_session_id=session.client_session_id
   and receipt.client_completion_id=response.client_completion_id
   and receipt.original_employee_id=session.employee_id and context.employee_id=session.employee_id
   and receipt.device_id=session.device_id and context.device_id=session.device_id
   and response.device_id=session.device_id and response.submitted_by_employee_id=session.employee_id
   and response.response_json->>'work_result'='checked_no_cleaning_needed'
   and response.response_json->'services_performed'='[]'::jsonb
   and receipt.payload_json->'response_json'=response.response_json
   and context.native_start_attestation_version='custodial-native-start.v1'
   and context.native_scan_entry_id is not null
   and context.native_completion_attestation_version='custodial-native-completion.v2'
   and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
   and context.native_finish_scan_entry_id is not null
   and context.native_finish_scan_entry_id<>context.native_scan_entry_id
   and context.started_at=session.started_at
   and context.native_completed_at=session.ended_at
   and context.native_completed_at>context.started_at
   and context.native_completed_at>=p_day_start and context.native_completed_at<=p_now
   and isfinite(context.native_completed_at)
   and exists (
     select 1 from public.custodial_offline_scan_event_evidence evidence
     where evidence.context_id=context.context_id
       and evidence.reconciliation_id=receipt.reconciliation_id
       and evidence.session_id=session.id
       and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
       and evidence.event_payload->>'event_type'='scan_finish'
       and evidence.event_payload->>'result'='ok'
       and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
       and evidence.event_payload->>'scanned_at'=
         public.custodial_canonical_utc_millis(context.native_completed_at)
   );
$function$;

create or replace function public.mz_verified_visit_reminder_cycle(
 p_form_type text,p_cleaned_at timestamptz,p_checked_at timestamptz,p_now timestamptz
) returns table(cycle_base_at timestamptz,cycle_base_evidence text,
 due_soon_at timestamptz,overdue_at timestamptz,status_code text,repeat_index bigint)
language plpgsql immutable set search_path=pg_catalog,public as $function$
declare v_soon integer;v_overdue integer;
begin
 if p_now is null or not isfinite(p_now) then raise exception 'reminder time is required'; end if;
 -- An uncleaned location cannot be armed by a check-only visit.
 if p_cleaned_at is null or not isfinite(p_cleaned_at) or p_cleaned_at>p_now then return; end if;
 if p_form_type='restroom' then v_soon:=75;v_overdue:=90;
 elsif p_form_type='exhibit' then v_soon:=195;v_overdue:=210;
 else return; end if;
 cycle_base_at:=p_cleaned_at;cycle_base_evidence:='completed_cleaning';
 if p_checked_at is not null and isfinite(p_checked_at)
    and p_checked_at>p_cleaned_at and p_checked_at<=p_now then
   cycle_base_at:=p_checked_at;cycle_base_evidence:='verified_check_checkout';
 end if;
 due_soon_at:=cycle_base_at+make_interval(mins=>v_soon);
 overdue_at:=cycle_base_at+make_interval(mins=>v_overdue);
 status_code:=case when p_now>=overdue_at then 'overdue'
                   when p_now>=due_soon_at then 'due_soon' else null end;
 repeat_index:=case when p_now>=overdue_at
   then floor(extract(epoch from(p_now-overdue_at))/300)::bigint else 0 end;
 return next;
end $function$;

revoke all on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz),
 public.mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz)
 from public,anon,authenticated;
grant execute on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz),
 public.mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz)
 to postgres,service_role;


-- Keep real cleaning history separate from verified check-only visits.
create or replace view public.v_location_dashboard_status as
with op_day as (
  select public.operational_day_start(now()) day_start,
    public.sch_service_date(now()) service_date
), authority as (
  select state.*
  from op_day day
  cross join lateral public.static_weekly_v6_schedule_authority_state(day.service_date) state
), scheduled_baseline as (
  select assignment.location_id,
    min((day.service_date + assignment.coverage_start) at time zone 'America/Chicago') baseline_at
  from op_day day
  join lateral public.custodial_operational_location_assignments(day.service_date) assignment on true
  group by assignment.location_id
), latest_scan as (
  select location_id,max(coalesce(scanned_at,created_at)) last_scan_at
  from public.scan_events group by location_id
), open_session as (
  -- Native Start evidence survives the 04:00 boundary until reconciled. Old
  -- sessions rows retain the established current-operational-day display rule.
  select distinct on (work.location_id)
    work.location_id,work.location_code,work.session_id,work.session_uuid,
    work.status session_status,work.started_at,work.ended_at,
    work.duration_minutes,work.duration_display,
    work.employee_name,work.device_identifier
  from public.custodial_open_work() work
  where work.source_kind<>'session'
     or work.started_at>=public.operational_day_start(now())
  order by work.location_id,work.started_at desc,work.created_at desc,work.open_work_id desc
), latest_completed as (
  select distinct on (session.location_id)
    session.location_id,session.id session_id,session.session_uuid,
    session.started_at,session.ended_at,session.duration_minutes,
    session.duration_display,employee.display_name employee_name,
    completion.submitted_at,completion.response_json,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) effective_completed_at
  from public.sessions session
  join public.employees employee on employee.id=session.employee_id
  left join public.completion_responses completion on completion.session_id=session.id
  cross join op_day day
  where session.status='closed'
    and completion.response_json->>'work_result' is distinct from 'checked_no_cleaning_needed'
    and coalesce(session.ended_at,completion.submitted_at,session.started_at)>=day.day_start
  order by session.location_id,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) desc,
    session.started_at desc
), open_tickets as (
  select location_id,count(*) open_ticket_count
  from public.maintenance_tickets where status='open' group by location_id
), truth as (
  select location.id location_id,
    coalesce(open_session.location_code,location.location_code) location_code,
    location.location_name,
    location.location_type,location.form_type,day.day_start,
    latest_scan.last_scan_at,
    open_session.session_id open_session_id,
    open_session.session_uuid open_session_uuid,
    open_session.session_status open_session_status,
    open_session.started_at open_session_started_at,
    open_session.ended_at open_session_ended_at,
    open_session.employee_name open_session_employee_name,
    open_session.device_identifier open_session_device_identifier,
    latest_completed.session_id latest_completed_session_id,
    latest_completed.session_uuid latest_completed_session_uuid,
    latest_completed.started_at latest_started_at,
    latest_completed.ended_at latest_ended_at,
    latest_completed.submitted_at latest_submitted_at,
    latest_completed.effective_completed_at latest_completed_at,
    latest_completed.employee_name latest_employee_name,
    latest_completed.duration_minutes,latest_completed.duration_display,
    latest_completed.response_json,
    coalesce(open_tickets.open_ticket_count,0::bigint) open_ticket_count,
    scheduled_baseline.baseline_at,
    public.mz_latest_verified_check(location.id,day.day_start,now()) verified_check_at,
    case when latest_completed.effective_completed_at is null then null
      else greatest(latest_completed.effective_completed_at,
        public.mz_latest_verified_check(location.id,day.day_start,now())) end due_baseline_at,
    authority.authority_source schedule_authority_source,
    authority.projection_status schedule_projection_status
  from public.locations location
  cross join op_day day
  cross join authority
  left join scheduled_baseline on scheduled_baseline.location_id=location.id
  left join latest_scan on latest_scan.location_id=location.id
  left join open_session on open_session.location_id=location.id
  left join latest_completed on latest_completed.location_id=location.id
  left join open_tickets on open_tickets.location_id=location.id
  where location.active=true
)
select location_id,location_code,location_name,location_type,form_type,
  day_start operational_day_start,last_scan_at,
  open_session_id,open_session_uuid,open_session_status,
  open_session_started_at,open_session_ended_at,
  latest_completed_session_id,latest_completed_session_uuid,
  latest_started_at,latest_ended_at,latest_submitted_at,latest_completed_at,
  latest_employee_name,duration_minutes,duration_display,
  coalesce(response_json->'services_performed',response_json->'servicesPerformed',
    response_json->'services',response_json->'completed_services',
    response_json->'completedServices','[]'::jsonb) services_performed,
  coalesce(response_json->>'notes',response_json->>'cleaning_notes',
    response_json->>'cleaningNotes',response_json->>'maintenance_notes',
    response_json->>'maintenanceNotes',response_json->>'other_service_performed',
    response_json->>'otherServicePerformed',response_json->>'note') notes,
  open_ticket_count,
  case
    when due_baseline_at is null and open_session_status in ('active','pending_submit') then 'in_progress'
    when due_baseline_at is null then 'not_cleaned'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',90)) then 'overdue'
    when form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',75)) then 'due_soon'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',210)) then 'overdue'
    when form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195)) then 'due_soon'
    when open_session_status in ('active','pending_submit') then 'in_progress'
    else 'okay'
  end status_code,
  case
    when due_baseline_at is null and open_session_status in ('active','pending_submit') then 'blue'
    when due_baseline_at is null then 'black'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_overdue_minutes',90)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_overdue_minutes',210))) then 'red'
    when (form_type='restroom' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('restroom_due_soon_minutes',75)))
      or (form_type='exhibit' and now()>=due_baseline_at+make_interval(mins=>public.get_setting_int('exhibit_due_soon_minutes',195))) then 'yellow'
    when open_session_status in ('active','pending_submit') then 'blue'
    else 'green'
  end status_color,
  to_char(timezone('America/Chicago',day_start),'MM/DD/YYYY HH12:MI AM')||' Central' operational_day_start_display,
  to_char(timezone('America/Chicago',last_scan_at),'MM/DD/YYYY HH12:MI AM')||' Central' last_scan_at_display,
  to_char(timezone('America/Chicago',open_session_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_started_at_display,
  to_char(timezone('America/Chicago',open_session_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' open_session_ended_at_display,
  to_char(timezone('America/Chicago',latest_started_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_started_at_display,
  to_char(timezone('America/Chicago',latest_ended_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_ended_at_display,
  to_char(timezone('America/Chicago',latest_submitted_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_submitted_at_display,
  to_char(timezone('America/Chicago',latest_completed_at),'MM/DD/YYYY HH12:MI AM')||' Central' latest_completed_at_display,
  open_session_employee_name,open_session_device_identifier,
  schedule_authority_source,schedule_projection_status,
  greatest(latest_completed_at,verified_check_at) as latest_checked_at
from truth;

-- No provider receipts enter this calculation. A started but unfinished visit
-- remains overdue; each five-minute bucket has its own stable delivery key.
create or replace function public.mz_location_reminder_candidates(
 p_service_date date,p_now timestamptz default now()
) returns table(location_id uuid,notification_key text,status_code text,
 cycle_base_at timestamptz,cycle_base_evidence text,cleaned_at timestamptz,
 due_soon_at timestamptz,overdue_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
 select status.location_id,
   'location-visit:'||p_service_date::text||':'||status.location_id::text||':'||
   cycle.status_code||':'||to_char(cycle.cycle_base_at at time zone 'UTC',
     'YYYYMMDDHH24MISSUS')||':'||cycle.repeat_index::text,
   cycle.status_code,cycle.cycle_base_at,cycle.cycle_base_evidence,
   status.latest_completed_at,cycle.due_soon_at,cycle.overdue_at
 from public.v_location_dashboard_status status
 cross join lateral public.mz_verified_visit_reminder_cycle(
   status.form_type,status.latest_completed_at,
   public.mz_latest_verified_check(status.location_id,status.operational_day_start,p_now),p_now) cycle
 where p_service_date=public.sch_service_date(p_now)
   and status.latest_completed_at>=status.operational_day_start
   and cycle.status_code is not null;
$function$;
revoke all on function public.mz_location_reminder_candidates(date,timestamptz)
 from public,anon,authenticated;
grant execute on function public.mz_location_reminder_candidates(date,timestamptz)
 to postgres,service_role;

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
        else ' on your assigned route is due for a check soon.' end,
      'data_json', jsonb_build_object(
        'kind', 'employee_location_status',
        'reminder_contract','verified-visit-reminders.v2',
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
    or j.payload_json#>>'{data_json,reminder_contract}' is distinct from 'verified-visit-reminders.v2' then
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

-- Retain the exact native Start/Finish authentication boundary.
create or replace function public.tool_commit_cleaning_workflow_authoritative(
  p_client_session_id text,p_client_completion_id text,p_device_id text,p_location_code text,
  p_client_started_at text,p_client_ended_at text,p_response_json jsonb,p_scan_evidence jsonb,
  p_correlation_id text,p_context_id text,p_submission_proof text,p_authenticated_credential_id text,p_native_finish_scan_entry_id text,
  p_native_completion_attestation_version text,p_native_completion_attestation text,
  p_native_route_proof_secret text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_completion_id uuid; v_context_id uuid; v_finish_scan_entry_id uuid; v_result jsonb; v_started_at timestamptz; v_completed_at timestamptz;
  v_native_completed_at timestamptz; v_attestation_sha256 text;
begin
  -- Validate explicit new outcomes without redefining legacy response records.
  if jsonb_typeof(p_response_json) is distinct from 'object' then
    raise exception using errcode='22023',message='completion response must be an object';
  end if;
  if p_response_json ? 'work_result' then
    if coalesce(p_response_json->>'work_result','') not in ('full','details','checked_no_cleaning_needed') then
      raise exception using errcode='22023',message='unsupported completion outcome';
    end if;
    if jsonb_typeof(p_response_json->'services_performed') is distinct from 'array' then
      raise exception using errcode='22023',message='completion services must be an array';
    end if;
    if p_response_json->>'work_result'='checked_no_cleaning_needed' then
      if p_response_json->'services_performed'<>'[]'::jsonb then
        raise exception using errcode='22023',message='check-only outcome cannot claim cleaning services';
      end if;
    elsif jsonb_array_length(p_response_json->'services_performed')=0 or exists (
      select 1 from jsonb_array_elements(p_response_json->'services_performed') item
      where jsonb_typeof(item)<>'string' or btrim(item#>>'{}')=''
    ) then
      raise exception using errcode='22023',message='cleaning outcome requires actual services';
    end if;
  end if;
  begin
    v_completion_id:=lower(btrim(coalesce(p_client_completion_id,'')))::uuid;
  exception when others then
    raise exception using errcode='22023',message='p_client_completion_id must be a UUID';
  end;
  perform public.custodial_require_native_route_proof_secret(p_native_route_proof_secret);
  if btrim(coalesce(p_native_completion_attestation_version,''))<>'custodial-native-completion.v2'
     or lower(btrim(coalesce(p_native_completion_attestation,''))) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='42501',message='a verified native completion attestation is required';
  end if;
  begin
    v_context_id:=lower(btrim(p_context_id))::uuid;
    v_finish_scan_entry_id:=lower(btrim(p_native_finish_scan_entry_id))::uuid;
    v_native_completed_at:=btrim(p_client_ended_at)::timestamptz;
  exception when others then
    raise exception using errcode='22023',message='native completion evidence is malformed';
  end;
  if not isfinite(v_native_completed_at) then
    raise exception using errcode='22023',message='native completion evidence is malformed';
  end if;
  if jsonb_typeof(p_scan_evidence)<>'array'
     or (select count(*) from jsonb_array_elements(p_scan_evidence) e where e->>'event_type'='scan_finish')<>1
     or not exists(
       select 1 from jsonb_array_elements(p_scan_evidence) e
       where e->>'event_type'='scan_finish'
         and lower(e->>'client_event_id')=v_finish_scan_entry_id::text
         and e->>'result'='ok'
         and e->>'scanned_at'=public.custodial_canonical_utc_millis(v_native_completed_at)
         and e->'payload_json'->>'entry_source'='native-nfc'
     ) then
    raise exception using errcode='42501',message='the signed physical NFC finish scan is required';
  end if;
  if exists (
    select 1 from public.custodial_offline_actor_contexts c
    where c.context_id=v_context_id and c.native_scan_entry_id=v_finish_scan_entry_id
  ) then
    raise exception using errcode='42501',message='native finish scan must differ from the start scan';
  end if;
  v_attestation_sha256:=encode(extensions.digest(convert_to(lower(btrim(p_native_completion_attestation)),'UTF8'),'sha256'),'hex');
  if exists(
    select 1 from public.custodial_offline_actor_contexts c where c.context_id=v_context_id
      and (c.native_start_attestation_version is distinct from 'custodial-native-start.v1'
        or c.native_scan_entry_id is null
        or (c.native_completion_attestation_version is not null and
          (c.native_completion_attestation_version<>p_native_completion_attestation_version
            or c.native_completion_attestation_sha256<>v_attestation_sha256
            or c.native_completed_at<>v_native_completed_at
            or c.native_finish_scan_entry_id<>v_finish_scan_entry_id)))
  ) then
    raise exception using errcode='23505',message='native completion attestation does not match the frozen occurrence';
  end if;
  v_result:=public.custodial_commit_offline_occurrence(
    p_client_session_id,v_completion_id::text,p_device_id,p_location_code,p_client_started_at,p_client_ended_at,
    p_response_json,p_scan_evidence,p_correlation_id,p_context_id,p_submission_proof,p_authenticated_credential_id,p_backend_execution_secret
  );
  if v_result->>'status'='closed' then
    update public.custodial_offline_actor_contexts
       set native_completion_attestation_version=p_native_completion_attestation_version,
           native_completion_attestation_sha256=v_attestation_sha256,
           native_completed_at=v_native_completed_at,
           native_finish_scan_entry_id=v_finish_scan_entry_id
     where context_id=v_context_id and native_completion_attestation_version is null;
    if not found and not exists(
      select 1 from public.custodial_offline_actor_contexts c
      where c.context_id=v_context_id
        and c.native_completion_attestation_version=p_native_completion_attestation_version
        and c.native_completion_attestation_sha256=v_attestation_sha256
        and c.native_completed_at=v_native_completed_at
        and c.native_finish_scan_entry_id=v_finish_scan_entry_id
    ) then
      raise exception using errcode='23505',message='native completion attestation does not match the frozen occurrence';
    end if;
  end if;
  begin
    v_started_at:=nullif(v_result->>'started_at','')::timestamptz;
    v_completed_at:=nullif(coalesce(v_result->>'completed_at',v_result->>'ended_at'),'')::timestamptz;
  exception when others then
    return v_result||jsonb_build_object('native_completion_attested',v_result->>'status'='closed');
  end;
  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'started_at',public.custodial_canonical_utc_millis(v_started_at),
    'ended_at',public.custodial_canonical_utc_millis(v_completed_at),
    'completed_at',public.custodial_canonical_utc_millis(v_completed_at),
    'native_completion_attested',v_result->>'status'='closed',
    'native_finish_scan_entry_id',case when v_result->>'status'='closed' then v_finish_scan_entry_id end
  ));
end
$function$;

-- Align the existing restroom timer with completed visits, never Start alone.
create or replace view public.v_restroom_check_timers as
with restroom_locations as (
  select group_row.id location_group_id,group_row.group_code,group_row.group_name,
    location.id location_id,location.location_code,location.location_name
  from public.location_groups group_row
  join public.location_group_memberships membership
    on membership.location_group_id=group_row.id and membership.active=true
  join public.locations location on location.id=membership.location_id and location.active=true
  where group_row.active=true
    and lower(coalesce(location.form_type,location.location_type,''))='restroom'
    and public.sch_is_public_restroom_group(group_row.id)
    and not (
      location.location_name ilike '%East Admin%'
      or location.location_name ilike '%West Admin%'
      or location.location_name ilike '%Elephant Trunk%'
    )
), activity as (
  select session.location_id,
    coalesce(session.ended_at,completion.submitted_at,session.started_at) activity_at,
    coalesce(submitter.display_name,employee.display_name) actor_name,
    coalesce(completion_device.device_id,device.device_id) device_identifier
  from public.sessions session
  left join public.completion_responses completion on completion.session_id=session.id
  left join public.employees submitter on submitter.id=completion.submitted_by_employee_id
  left join public.employees employee on employee.id=session.employee_id
  left join public.devices completion_device on completion_device.id=completion.device_id
  left join public.devices device on device.id=session.device_id
  where coalesce(session.ended_at,completion.submitted_at,session.started_at)>=public.operational_day_start(now())
    and session.status='closed'
    and (completion.response_json->>'work_result' is distinct from 'checked_no_cleaning_needed'
      or session.ended_at=public.mz_latest_verified_check(session.location_id,public.operational_day_start(now()),now()))
), latest_completion as (
  select distinct on (restroom.location_id)
    restroom.location_id,
    activity.activity_at last_completed_at,
    activity.actor_name last_completed_by,
    activity.device_identifier last_completed_device
  from restroom_locations restroom
  left join activity on activity.location_id=restroom.location_id
  order by restroom.location_id,activity.activity_at desc nulls last
), current_owner as (
  select distinct on (assignment.location_group_id)
    assignment.location_group_id,assignment.assigned_employee_id,
    employee.display_name assigned_owner,assignment.coverage_start::time coverage_start,
    assignment.coverage_end::time coverage_end,assignment.coverage_purpose,assignment.status
  from public.static_weekly_v6_read_schedule_segments(public.sch_service_date(now())) assignment
  left join public.employees employee on employee.id=assignment.assigned_employee_id
  where assignment.service_date=public.sch_service_date(now())
    and timezone('America/Chicago',now())::time>=assignment.coverage_start::time
    and timezone('America/Chicago',now())::time<assignment.coverage_end::time
  order by assignment.location_group_id,
    case when assignment.coverage_purpose in ('restroom_check','restroom_upkeep','area_owner') then 0 else 1 end,
    assignment.coverage_start desc
)
select public.sch_service_date(now()) service_date,
  restroom.location_group_id,restroom.group_code,
  restroom.group_name schedule_package_name,restroom.location_id,
  restroom.location_code,restroom.location_name scanned_restroom_name,
  latest.last_completed_at,
  timezone('America/Chicago',latest.last_completed_at) last_completed_at_central,
  latest.last_completed_by,latest.last_completed_device,
  case when dashboard.latest_completed_at is not null and latest.last_completed_at is not null
    then latest.last_completed_at+interval '90 minutes' end next_check_due_at,
  case when dashboard.latest_completed_at is not null and latest.last_completed_at is not null
    then timezone('America/Chicago',latest.last_completed_at+interval '90 minutes') end next_check_due_at_central,
  case
    when dashboard.latest_completed_at is null or latest.last_completed_at is null then 'not_cleaned_yet'
    when latest.last_completed_at+interval '90 minutes'<=now() then 'overdue'
    when latest.last_completed_at+interval '90 minutes'<=now()+interval '15 minutes' then 'due_soon'
    else 'ok'
  end timer_status,
  case when dashboard.latest_completed_at is not null and latest.last_completed_at is not null then
    round(extract(epoch from latest.last_completed_at+interval '90 minutes'-now())/60.0)::integer
  end minutes_until_due,
  owner.assigned_employee_id,owner.assigned_owner,
  to_char(owner.coverage_start::interval,'HH24:MI') owner_coverage_start,
  to_char(owner.coverage_end::interval,'HH24:MI') owner_coverage_end,
  owner.coverage_purpose,owner.status owner_status,
  case when dashboard.latest_completed_at is not null and latest.last_completed_at is not null then 'scan_completion' else 'no_scan_today' end timer_source
from restroom_locations restroom
left join public.v_location_dashboard_status dashboard on dashboard.location_id=restroom.location_id
left join latest_completion latest on latest.location_id=restroom.location_id
left join current_owner owner on owner.location_group_id=restroom.location_group_id;

revoke all on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz),
 public.mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz),
 public.mz_location_reminder_candidates(date,timestamptz),
 public.mz_enqueue_employee_location_pushes(timestamptz),
 public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz),
 public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mz_latest_verified_check(uuid,timestamptz,timestamptz),
 public.mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz),
 public.mz_location_reminder_candidates(date,timestamptz),
 public.mz_enqueue_employee_location_pushes(timestamptz),
 public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz),
 public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text) to postgres,service_role;

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
    'public.mz_latest_verified_check(uuid,timestamptz,timestamptz)',
    'public.mz_verified_visit_reminder_cycle(text,timestamptz,timestamptz,timestamptz)',
    'public.mz_location_reminder_candidates(date,timestamptz)',
    'public.mz_enqueue_employee_location_pushes(timestamptz)',
    'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
    'public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)'
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

  foreach identity in array array['public.v_location_dashboard_status','public.v_restroom_check_timers'] loop
    definition:=public.custodial_release_authority_current_view_definition(identity);
    if definition is null then raise exception 'visit timer view % is missing',identity; end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=definition,
        definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='view' and object_identity=identity;
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'visit timer recovery view % missing or duplicated',identity; end if;
  end loop;

  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $bind_release_recovery$;
commit;
