CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_lunch_coverage_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_authority record;
  v_document jsonb;
  v_inserted integer := 0;
  v_missing integer := 0;
  v_alerts integer := 0;
  v_job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('custodial-lunch-notifications'),hashtext(v_service_date::text));
  select * into strict v_authority
  from public.static_weekly_v6_schedule_authority_state(v_service_date);
  if not v_authority.governed or v_authority.projection_status is distinct from 'current' then
    return jsonb_build_object('ok',true,'enqueued',0,'missing_recipients',0,'manager_alerts',0,
      'skipped','no_current_governed_schedule','service_date',v_service_date);
  end if;

  select document_json into v_document
  from public.weekly_schedule_lunch_documents
  where projection_id=v_authority.projection_id;
  if v_document is null then
    raise exception using errcode='55000',message='current lunch coverage is unavailable; republish the weekly schedule';
  end if;

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
      and n->>'event' in ('start','end')
      and n->>'delivery_state'='NOT_ENQUEUED'
  ), targets as materialized (
    select registration.credential_id,registration.employee_id,registration.device_id,
      registration.assignment_epoch,device.device_id device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), recipient_counts as materialized (
    select intent.employee_id,count(distinct target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    group by intent.employee_id
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':'||target.credential_id::text,
    'employee_native_push',v_authority.projection_id,intent.scheduled_at,
    jsonb_build_object(
      'credential_id',target.credential_id,'employee_id',target.employee_id,
      'device_id',target.device_id,'device_identifier',target.device_identifier,
      'assignment_epoch',target.assignment_epoch,
      'channel_id','employee-events',
      'title',case intent.n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',case intent.n->>'event'
        when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
        else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time',
        'scheduled_at',to_char(intent.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,
        'document_identity',v_document->>'document_identity',
        'route','employee-schedule.html?hub=employee'
      )
    )
  from intents intent
  join recipient_counts count_row on count_row.employee_id=intent.employee_id and count_row.recipient_count=1
  join targets target on target.employee_id=intent.employee_id
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
  ), targets as materialized (
    select registration.credential_id,registration.employee_id
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), unavailable as materialized (
    select intent.*,count(target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    where intent.scheduled_at<=p_now
    group by intent.n,intent.employee_id,intent.scheduled_at
    having count(target.credential_id)<>1
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,status,completed_at,last_error,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':recipient-unavailable',
    'employee_native_push',v_authority.projection_id,'dead',p_now,
    case when intent.recipient_count=0 then 'lunch_coverage_recipient_unavailable'
         else 'lunch_coverage_recipient_ambiguous' end,
    intent.scheduled_at,
    jsonb_build_object(
      'employee_id',intent.employee_id,'device_identifier','assigned custodial phone',
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time','coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,'document_identity',v_document->>'document_identity',
        'recipient_status',case when intent.recipient_count=0 then 'unavailable' else 'ambiguous' end,
        'route','employee-schedule.html?hub=employee'
      )
    )
  from unavailable intent
  on conflict(job_key) do nothing;
  get diagnostics v_missing=row_count;
  for v_job_id in
    select job_id from public.operational_notification_jobs
    where job_type='employee_native_push'
      and source_id=v_authority.projection_id
      and status='dead'
      and payload_json->'data_json'->>'kind'='employee_lunch_coverage'
      and payload_json->'data_json'->>'service_date'=v_service_date::text
      and payload_json->'data_json'->>'recipient_status' in ('unavailable','ambiguous')
      and available_at<=p_now
  loop
    v_alerts:=v_alerts+coalesce((public.ops_manager_enqueue_lunch_delivery_failure(v_job_id,p_now)->>'enqueued')::integer,0);
  end loop;

  return jsonb_build_object('ok',true,'service_date',v_service_date,
    'projection_id',v_authority.projection_id,'document_identity',v_document->>'document_identity',
    'enqueued',v_inserted,'missing_recipients',v_missing,'manager_alerts',v_alerts);
end
$function$
