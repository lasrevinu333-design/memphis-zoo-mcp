begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regclass('public.weekly_schedule_lunch_documents') is null
     or to_regclass('public.operational_notification_jobs') is null
     or to_regclass('public.employee_push_registrations') is null
     or to_regprocedure('public.static_weekly_v6_schedule_authority_state(date)') is null
     or to_regprocedure('public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamp with time zone)') is null then
    raise exception 'lunch notification producer prerequisites are unavailable';
  end if;
end
$preflight$;

create or replace function public.mz_enqueue_employee_lunch_coverage_pushes(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
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
$function$;

revoke all on function public.mz_enqueue_employee_lunch_coverage_pushes(timestamptz)
from public,anon,authenticated,static_weekly_control_plane,custodial_application_reader;
grant execute on function public.mz_enqueue_employee_lunch_coverage_pushes(timestamptz)
to postgres,service_role;
comment on function public.mz_enqueue_employee_lunch_coverage_pushes(timestamptz) is
  'Durably enqueues accepted lunch start/end notifications for the current assigned credential; unavailable or ambiguous due recipients fail closed into truthful manager delivery review.';

create or replace function public.custodial_release_canary_authority_surface()
returns table(object_kind text,object_identity text,purpose text)
language sql immutable set search_path=pg_catalog,public
as $function$
  values
    ('function','mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)','accepted lunch start/end push producer'),
    ('function','static_weekly_v8_read_lunch_segments(date)','current lunch responsibility consumer'),
    ('function','custodial_operational_location_assignments(date)','current physical responsibility and lunch handoff'),
    ('function','static_weekly_v5_read_employee_day(date,uuid,timestamp with time zone)','employee published lunch display'),
    ('relation','public.weekly_schedule_lunch_documents','accepted temporary lunch coverage'),
    ('function','static_weekly_v8_assert_lunch_document(uuid,jsonb)','lunch exact projection validation'),
    ('function','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','atomic lunch persistence'),
    ('function','static_weekly_v8_read_lunch_document(date)','current projection lunch reader'),
    ('relation','public.devices','phone identity and assignment'),
    ('relation','public.locations','scan location authority'),
    ('relation','public.device_auth_credentials','native credential authority'),
    ('relation','public.device_sync_status','phone queue and release readiness'),
    ('relation','public.device_location_proximity_status','current accepted proximity'),
    ('relation','public.sessions','canonical cleaning session truth'),
    ('relation','public.completion_responses','canonical completion response truth'),
    ('relation','public.scan_events','accepted scan event truth'),
    ('relation','public.maintenance_tickets','completion-derived maintenance truth'),
    ('relation','public.custodial_offline_actor_contexts','frozen offline actor and native evidence'),
    ('relation','public.custodial_offline_submission_proofs','offline submission proof state'),
    ('relation','public.custodial_offline_reconciliation_records','offline reconciliation decision'),
    ('relation','public.custodial_offline_scan_event_evidence','immutable scan evidence binding'),
    ('relation','public.custodial_release_canary_controls','exact canary pause state'),
    ('relation','public.custodial_release_canary_transport_probes','native canary transport proof'),
    ('relation','public.custodial_release_canary_recovery_probes','database canary recovery proof'),
    ('relation','public.events_app_events','canonical event mutation truth'),
    ('relation','public.events_app_event_history','event actor history'),
    ('relation','public.event_push_instances','event push occurrence authority'),
    ('relation','public.employee_push_registrations','employee push recipient authority'),
    ('relation','public.employee_native_push_delivery_receipts','employee push delivery truth'),
    ('relation','public.operational_notification_jobs','durable operational notification jobs'),
    ('relation','public.ops_manager_notification_queue','manager notification jobs'),
    ('relation','public.ops_manager_push_devices','manager push recipient authority'),
    ('relation','public.device_notification_acknowledgements','phone notification acceptance'),
    ('function','tool_get_offline_scan_authority_snapshot(text,text,text)','offline snapshot boundary'),
    ('function','tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)','native offline start boundary'),
    ('function','tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','native completion boundary'),
    ('function','tool_complete_session_authoritative(text,jsonb,text,text,text,text)','online completion boundary'),
    ('function','custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)','maintenance terminal boundary'),
    ('function','custodial_finish_historical_session_authoritative(text,text,uuid,timestamp with time zone,text)','historical exact-finish adapter'),
    ('function','custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,uuid,text,text,text)','native canary transport recorder'),
    ('function','custodial_get_release_canary_transport_probe_health(text,text,text,text)','native canary transport health'),
    ('function','custodial_run_release_canary_recovery_probe(text,text)','persisted recovery probe'),
    ('function','custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)','release canary controller'),
    ('function','custodial_backend_authority_health(text)','database authority health'),
    ('function','app_apply_event_command(text,uuid,jsonb,text,text)','bounded event mutation authority'),
    ('function','custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid)','serialized manager assignment CAS'),
    ('function','mz_register_employee_push(uuid,text,text,text,text,text)','employee push registration authority'),
    ('function','mz_enqueue_employee_event_pushes(timestamp with time zone)','event push enqueue authority'),
    ('function','mz_enqueue_employee_location_pushes(timestamp with time zone)','location push enqueue authority'),
    ('function','mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','employee push dispatch preparation'),
    ('function','mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)','employee push dispatch completion'),
    ('function','ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text)','manager push dispatch preparation'),
    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion'),
    ('view','public.v_location_status','phone scan-state operational truth'),
    ('view','public.v_location_dashboard_status','manager location operational truth'),
    ('view','public.v_restroom_check_timers','restroom timer operational truth'),
    ('view','public.v_admin_health_snapshot','admin operational health truth'),
    ('view','public.v_exception_queue','manager exception operational truth'),
    ('view','public.v_restroom_package_status','restroom timer dependent projection');
$function$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare
  identity text; canonical text; definition text; grant_definition text;
  changed integer; next_order integer;
begin
  foreach identity in array array[
    'public.mz_enqueue_employee_lunch_coverage_pushes(timestamp with time zone)',
    'public.custodial_release_canary_authority_surface()'
  ] loop
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    if canonical is null or definition is null then raise exception 'lunch notification recovery function % is missing',identity; end if;
    update public.custodial_release_authority_restore_inventory
      set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
      where object_kind='function' and object_identity=canonical;
    get diagnostics changed=row_count;
    if identity like '%custodial_release_canary_authority_surface%' then
      if changed<>1 then raise exception 'existing canary recovery binding missing or duplicated'; end if;
    elsif changed=0 then
      select coalesce(max(restore_order),100000)+1 into next_order
      from public.custodial_release_authority_restore_inventory
      where object_kind='function' and restore_order<200000;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,'function',canonical,definition,public.static_weekly_digest_text(definition));
    else raise exception 'unexpected lunch notification recovery function binding';
    end if;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    if grant_definition is null then raise exception 'lunch notification recovery grant % is missing',canonical; end if;
    update public.custodial_release_authority_restore_inventory
      set definition_sql=grant_definition,definition_sha256=public.static_weekly_digest_text(grant_definition),captured_at=statement_timestamp()
      where object_kind='grant' and object_identity=canonical;
    get diagnostics changed=row_count;
    if identity like '%custodial_release_canary_authority_surface%' then
      if changed<>1 then raise exception 'existing canary recovery grant missing or duplicated'; end if;
    elsif changed=0 then
      select coalesce(max(restore_order),900000)+1 into next_order
      from public.custodial_release_authority_restore_inventory;
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,'grant',canonical,grant_definition,public.static_weekly_digest_text(grant_definition));
    else raise exception 'unexpected lunch notification recovery grant binding';
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
