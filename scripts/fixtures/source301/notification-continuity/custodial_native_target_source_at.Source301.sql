CREATE OR REPLACE FUNCTION public.custodial_native_target_source_at(p_kind text, p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
 v_now timestamptz:=p_at;
 v_generation public.employee_native_push_generations%rowtype;
 v_registration public.employee_push_registrations%rowtype;
 v_device public.devices%rowtype;
 v_credential public.device_auth_credentials%rowtype;
 v_employee public.employees%rowtype;
 v_job public.operational_notification_jobs%rowtype;
 v_message record;
 v_occurrence public.weekly_schedule_occurrences%rowtype;
 v_authority record;
 v_document public.weekly_schedule_lunch_documents%rowtype;
 v_intent jsonb;
 v_loan jsonb;
 v_responsibility jsonb;
 v_availability jsonb;
 v_service_date date;
 v_scheduled_at timestamptz;
 v_valid_until timestamptz;
 v_source jsonb;
 v_recipient jsonb;
 v_status text;
begin
 if p_kind is null or p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null
  or p_employee_id is null or p_generation_id is null or p_at is null or not isfinite(p_at) then
  raise exception using errcode='22023',message='exact native source kind, original key, employee and generation required';
 end if;
 select * into v_generation from public.employee_native_push_generations
  where generation_id=p_generation_id;
 if not found then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 select * into v_registration from public.employee_push_registrations
  where registration_id=v_generation.registration_id;
 select * into v_device from public.devices where id=v_generation.device_id;
 select * into v_credential from public.device_auth_credentials
  where credential_id=v_generation.credential_id;
 select * into v_employee from public.employees where id=p_employee_id;
 if v_generation.employee_id is distinct from p_employee_id
  or v_generation.dispatch_retired_at is not null or v_generation.revoked_at is not null
  or v_generation.activated_at>v_now or v_registration.registration_id is null
  or v_registration.active is not true or v_registration.revoked_at is not null
  or v_registration.device_id is distinct from v_generation.device_id
  or v_registration.credential_id is distinct from v_generation.credential_id
  or v_registration.employee_id is distinct from p_employee_id
  or v_registration.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_registration.token_hash is distinct from v_generation.token_digest
  or v_device.id is null or v_device.active is not true
  or v_device.device_id is distinct from v_generation.device_identifier
  or v_device.assigned_employee_id is distinct from p_employee_id
  or v_device.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_credential.credential_id is null or v_credential.device_id is distinct from v_device.id
  or v_credential.confirmed_at is null or v_credential.revoked_at is not null
  or v_credential.expires_at<=v_now or v_employee.id is null or v_employee.active is not true then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 v_recipient:=jsonb_build_object('employee_id',p_employee_id,'device_id',v_device.id,
  'device_identifier',v_device.device_id,'credential_id',v_credential.credential_id,
  'assignment_epoch',v_device.assignment_epoch,'generation_id',v_generation.generation_id,
  'principal_digest',v_generation.principal_digest,'token_digest',v_generation.token_digest);

 if p_kind='MESSAGE' then
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.job_key is distinct from 'employee-message-push:'||v_job.source_id::text||':'||v_credential.credential_id::text
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_message'
   or v_job.payload_json#>>'{data_json,message_id}' is distinct from v_job.source_id::text
   or v_job.payload_json#>>'{data_json,notification_key}' is distinct from 'message:'||v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   select m.id,m.thread_id,m.sender_user_id,m.sent_at,m.body,m.metadata_json,
    recipient.id recipient_user_id,r.acknowledged_at
    into v_message
   from public.msg_messages m
   join public.msg_threads t on t.id=m.thread_id and t.is_active is true
    and t.system_key is distinct from 'ops_manager_shared_chat_v1'
   join public.msg_thread_participants tp on tp.thread_id=m.thread_id and tp.left_at is null
   join public.msg_users recipient on recipient.id=tp.user_id and recipient.is_active is true
    and recipient.employee_id=p_employee_id
   join public.msg_receipts r on r.message_id=m.id and r.user_id=recipient.id
   where m.id=v_job.source_id and m.is_deleted is false and m.sender_user_id<>recipient.id
    and m.sent_at<=v_now
    and r.acknowledged_at is null
    and not exists(select 1 from public.msg_message_deletions md
      where md.message_id=m.id and md.user_id=recipient.id)
    and not exists(select 1 from public.msg_thread_visibility visibility
      where visibility.thread_id=m.thread_id and visibility.user_id=recipient.id
       and (visibility.device_identifier is null
         or upper(btrim(visibility.device_identifier))=upper(btrim(v_device.device_id)))
       and coalesce(m.sent_at,m.created_at)<=visibility.hidden_before);
   if not found or v_job.payload_json#>>'{data_json,thread_id}' is distinct from v_message.thread_id::text then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_recipient:=v_recipient||jsonb_build_object('msg_user_id',v_message.recipient_user_id);
    v_source:=jsonb_build_object('source_id',v_message.id,'source_revision',
     public.static_weekly_digest_jsonb(jsonb_build_object('message_id',v_message.id,
      'thread_id',v_message.thread_id,'sender_user_id',v_message.sender_user_id,
      'sent_at',v_message.sent_at,'body',v_message.body,'metadata_json',v_message.metadata_json,
      'recipient_user_id',v_message.recipient_user_id)),
     'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
     'job_status',v_job.status,'valid_from',v_message.sent_at,'valid_until',null);
   end if;
  end if;
 elsif p_kind='SCHEDULE' then
  select * into v_occurrence from public.weekly_schedule_occurrences
   where occurrence_id=p_source_key;
  if not found or v_occurrence.state is distinct from 'created' then
   v_status:='SOURCE_STALE';
  else
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_occurrence.service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.projection_id is distinct from v_occurrence.projection_id
    or v_authority.publication_id is distinct from v_occurrence.publication_id
    or v_authority.version_id is distinct from v_occurrence.version_id
    or (v_occurrence.owner_person_id_snapshot is distinct from p_employee_id
     and not exists(select 1 from public.static_weekly_v8_read_lunch_segments(v_occurrence.service_date) l
      where l.projection_id=v_authority.projection_id
       and l.normal_occurrence_id=v_occurrence.occurrence_id
       and l.normal_owner_id=v_occurrence.owner_person_id_snapshot
       and l.coverer_id=p_employee_id
       and l.coverage_start<=time '09:45' and l.coverage_end>=time '09:45'
       and l.coverage_start<l.coverage_end)) then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_source:=jsonb_build_object('source_id',v_occurrence.projection_id,
     'source_revision',v_authority.projection_authority_revision::text,
     'source_digest',v_occurrence.occurrence_digest,
     'publication_id',v_occurrence.publication_id,'version_id',v_occurrence.version_id,
     'service_date',v_occurrence.service_date,'assignment_occurrence_id',v_occurrence.occurrence_id,
     'delivery_occurrence_id',null,'delivery_key',null,
     'valid_from',null,'valid_until',null);
   end if;
  end if;
 else
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
   or v_job.payload_json#>>'{data_json,projection_id}' is distinct from v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   v_service_date:=(v_job.payload_json#>>'{data_json,service_date}')::date;
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.projection_id is distinct from v_job.source_id then
    v_status:='SOURCE_STALE';
   else
    select * into v_document from public.weekly_schedule_lunch_documents
     where projection_id=v_authority.projection_id;
    if not found or v_document.document_identity is distinct from v_job.payload_json#>>'{data_json,document_identity}' then
     v_status:='SOURCE_STALE';
    else
     perform public.static_weekly_v8_assert_lunch_document(v_document.projection_id,v_document.document_json);
     select value into v_intent from jsonb_array_elements(v_document.document_json->'notification_intents')
      where value->>'notification_key'=v_job.payload_json#>>'{data_json,notification_key}'
       and value->>'service_date'=v_service_date::text;
     select value into v_loan from jsonb_array_elements(v_document.document_json->'loans')
      where value->>'loan_id'=v_intent->>'loan_id' and value->>'status'='PLANNED';
     select value into v_responsibility from jsonb_array_elements(v_document.document_json->'responsibilities')
      where value->>'loan_id'=v_intent->>'loan_id'
       and value->>'coverer_slot_id'=v_intent->>'coverer_slot_id'
       and value->>'coverer_person_id'=p_employee_id::text;
     select value into v_availability
      from public.weekly_schedule_compiled_projections projection,
       jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
      where projection.projection_id=v_authority.projection_id
       and value->>'serviceDate'=v_service_date::text
       and value->>'slotId'=v_intent->>'coverer_slot_id'
       and value->>'incumbentPersonId'=p_employee_id::text
       and value->>'status'='working';
     if v_intent is null or v_loan is null or v_responsibility is null or v_availability is null
      or v_job.job_key is distinct from 'employee-lunch-push:'||(v_intent->>'notification_key')||':'||v_credential.credential_id::text
      or v_job.payload_json#>>'{data_json,event}' is distinct from v_intent->>'event'
      or v_job.payload_json#>>'{data_json,loan_id}' is distinct from v_intent->>'loan_id'
      or v_job.payload_json#>>'{data_json,coverer_slot_id}' is distinct from v_intent->>'coverer_slot_id'
      or v_job.payload_json#>>'{data_json,scheduled_time}' is distinct from v_intent->>'scheduled_time'
      or v_job.payload_json#>>'{data_json,notification_key}' is distinct from v_intent->>'notification_key'
      or v_job.payload_json#>>'{data_json,service_date}' is distinct from v_intent->>'service_date'
      or v_intent->>'event' not in ('start','end') then
      v_status:='SOURCE_STALE';
     else
      v_scheduled_at:=(v_service_date+(v_intent->>'scheduled_time')::time) at time zone 'America/Chicago';
      v_valid_until:=(v_service_date+(case when v_intent->>'event'='start'
       then v_loan->>'coverage_end' else v_availability#>>'{shift,end}' end)::time)
       at time zone 'America/Chicago';
      if v_valid_until is null or v_valid_until<=v_scheduled_at or v_now>=v_valid_until
       or public.sch_service_date(v_now) is distinct from v_service_date then
       v_status:='SOURCE_EXPIRED';
      else
       v_status:='CURRENT_SOURCE_ONLY';
       v_source:=jsonb_build_object('source_id',v_document.projection_id,
        'source_revision',v_authority.projection_authority_revision::text,
        'source_digest',v_document.document_identity,
        'notification_key',v_intent->>'notification_key',
        'loan_id',v_intent->>'loan_id','event',v_intent->>'event',
        'coverer_slot_id',v_intent->>'coverer_slot_id',
        'service_date',v_service_date,
        'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
        'job_status',v_job.status,'valid_from',v_scheduled_at,'valid_until',v_valid_until);
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('schema','custodial.native-target-source.v1',
  'kind',p_kind,'source_key',p_source_key,'status',v_status,
  'delivery_admitted',false,'recipient',case when v_source is null then null else v_recipient end,
  'source',v_source);
end $function$
