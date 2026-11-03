-- Proposal only: not a canonical migration and not applied.
-- Requires Main's accepted-native manual projection + lunch-lineage components.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- Private membership lookup. Only persisted current SQL authority can return a basis.
-- No caller document, preparation label, job update, clock adjustment or delivery replay.
CREATE OR REPLACE FUNCTION public.static_weekly_manual_lunch_current_basis(
 p_source uuid,p_source_document text,p_notification_key text,p_service_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $continuity$
DECLARE
 authority record;origin public.weekly_schedule_compiled_projections%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;
 prior_projection public.weekly_schedule_compiled_projections%rowtype;
 original_doc public.weekly_schedule_lunch_documents%rowtype;
 current_doc public.weekly_schedule_lunch_documents%rowtype;
 prior_doc public.weekly_schedule_lunch_documents%rowtype;
 original_intent jsonb;intent jsonb;original_loan jsonb;loan jsonb;retention jsonb;
 expected jsonb;actual jsonb;matches integer;visited uuid[]:='{}';hop integer:=0;
 current_id uuid;current_identity text;
BEGIN
 IF p_source IS NULL OR p_service_date IS NULL OR NOT isfinite(p_service_date)
  OR coalesce(p_source_document,'') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_notification_key,'') !~ '^[0-9a-f]{64}$' THEN RETURN NULL;END IF;
 SELECT * INTO authority FROM public.static_weekly_v6_schedule_authority_state(p_service_date);
 IF authority.governed IS NOT TRUE OR authority.projection_status IS DISTINCT FROM 'current'
  OR authority.projection_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_source;
 SELECT * INTO original_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_source;
 SELECT * INTO current_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=authority.projection_id;
 SELECT * INTO current_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=authority.projection_id;
 IF origin.projection_id IS NULL OR original_doc.projection_id IS NULL
  OR current_projection.projection_id IS NULL OR current_doc.projection_id IS NULL
  OR original_doc.document_identity IS DISTINCT FROM p_source_document
  OR origin.publication_id IS DISTINCT FROM authority.publication_id
  OR origin.version_id IS DISTINCT FROM authority.version_id
  OR origin.week_start IS DISTINCT FROM current_projection.week_start
  OR origin.week_end IS DISTINCT FROM current_projection.week_end
  OR p_service_date NOT BETWEEN origin.week_start AND origin.week_end THEN RETURN NULL;END IF;
 PERFORM public.static_weekly_v8_assert_lunch_document(origin.projection_id,original_doc.document_json);
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT n INTO original_intent FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT l INTO original_loan FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 current_id:=current_projection.projection_id;current_identity:=current_doc.document_identity;
 LOOP
  -- Fail closed after 128 immutable links or a cycle; never repair/reset a job.
  hop:=hop+1;
  IF hop>128 OR current_projection.projection_id=ANY(visited)
   OR current_projection.publication_id IS DISTINCT FROM origin.publication_id
   OR current_projection.version_id IS DISTINCT FROM origin.version_id
   OR current_projection.week_start IS DISTINCT FROM origin.week_start
   OR current_projection.week_end IS DISTINCT FROM origin.week_end
   OR current_doc.projection_id IS DISTINCT FROM current_projection.projection_id
   OR current_doc.document_identity IS DISTINCT FROM current_doc.document_json->>'document_identity'
   THEN RETURN NULL;END IF;
  visited:=array_append(visited,current_projection.projection_id);
  PERFORM public.static_weekly_v8_assert_lunch_document(current_projection.projection_id,current_doc.document_json);
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT n INTO intent FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF intent IS DISTINCT FROM original_intent THEN RETURN NULL;END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT l INTO loan FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF loan-'total_distance_minutes' IS DISTINCT FROM original_loan-'total_distance_minutes' THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'responsibilities') r WHERE r->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'responsibilities') r WHERE r->'loan_id'=loan->'loan_id';
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n WHERE n->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n WHERE n->'loan_id'=loan->'loan_id';
  IF actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  -- Original spoken owner/principal and original shift-end validity remain exact.
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO expected
   FROM jsonb_array_elements(origin.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=original_loan->>'normal_owner_slot_id' OR original_loan->'helper_slot_ids' ? (a->>'slotId'));
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO actual
   FROM jsonb_array_elements(current_projection.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=loan->>'normal_owner_slot_id' OR loan->'helper_slot_ids' ? (a->>'slotId'));
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  IF current_projection.projection_id=p_source THEN
   IF current_doc.document_identity IS DISTINCT FROM p_source_document THEN RETURN NULL;END IF;
   RETURN jsonb_build_object('source_projection_id',p_source,'source_document_identity',p_source_document,
    'current_projection_id',current_id,'current_document_identity',current_identity,'notification_key',p_notification_key);
  END IF;
  IF current_projection.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR current_projection.projection_envelope->'adapter' IS DISTINCT FROM
    '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
   THEN RETURN NULL;END IF;
  retention:=current_projection.projection_envelope#>'{authority,lunchIdentityRetention}';
  IF retention IS NULL THEN RETURN NULL;END IF;
  PERFORM public.static_weekly_assert_exact_object(retention,
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'notification immutable lunch lineage');
  IF retention->>'schema' IS DISTINCT FROM 'custodial.approved-manual-lunch-identity-retention.v1'
   OR retention->'requiresSqlOwnerCurrentnessCheck' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(retention->'loans') IS DISTINCT FROM 'array'
   OR coalesce(retention->>'priorDocumentIdentity','') !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM jsonb_array_elements(retention->'loans') r
    WHERE r=jsonb_build_object('serviceDate',p_service_date::text,'normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id'))<>1
   THEN RETURN NULL;END IF;
  SELECT * INTO prior_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=(retention->>'priorProjectionId')::uuid;
  SELECT * INTO prior_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=prior_projection.projection_id;
  IF prior_projection.projection_id IS NULL OR prior_doc.projection_id IS NULL
   OR prior_doc.document_identity IS DISTINCT FROM retention->>'priorDocumentIdentity' THEN RETURN NULL;END IF;
  current_projection:=prior_projection;current_doc:=prior_doc;
 END LOOP;
EXCEPTION WHEN data_exception OR check_violation OR cardinality_violation THEN RETURN NULL;
END $continuity$;
-- Inherit the maintained consumer owner. The source installer is postgres in
-- Supabase and supabase_admin in the owned replay; do not invent a new role.
DO $continuity_owner$
DECLARE authority_owner name;owners name[];
BEGIN
 SELECT array_agg(DISTINCT pg_get_userbyid(p.proowner)::name) INTO owners
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('mz_enqueue_employee_lunch_coverage_pushes',
  'custodial_native_target_source_at','custodial_native_lunch_live','static_weekly_v27_original_native_bindings');
 IF array_length(owners,1) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Notification consumer ownership requires exact reconciliation';END IF;
 authority_owner:=owners[1];
 EXECUTE format('ALTER FUNCTION public.static_weekly_manual_lunch_current_basis(uuid,text,text,date) OWNER TO %I',authority_owner);
END $continuity_owner$;
REVOKE ALL ON FUNCTION public.static_weekly_manual_lunch_current_basis(uuid,text,text,date)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

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
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
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

  -- Validate the exact current persisted document; never materialize a prepared draft.
  perform public.static_weekly_v8_assert_lunch_document(v_authority.projection_id,v_document);

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
    or public.static_weekly_manual_lunch_current_basis(v_job.source_id,
     v_job.payload_json#>>'{data_json,document_identity}',v_job.payload_json#>>'{data_json,notification_key}',v_service_date) is null then
    v_status:='SOURCE_STALE';
   else
    select * into v_document from public.weekly_schedule_lunch_documents
     where projection_id=v_job.source_id;
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
end $function$;
CREATE OR REPLACE FUNCTION public.custodial_native_lunch_live(p_job uuid, p_payload jsonb, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare j public.operational_notification_jobs%rowtype;authority record;
 doc public.weekly_schedule_lunch_documents%rowtype;intent jsonb;loan jsonb;responsibility jsonb;available jsonb;
 service_date date;scheduled timestamptz;ends_at timestamptz;
begin
 if p_job is null or p_at is null or not isfinite(p_at)
  or p_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
  or p_payload->>'kind' is distinct from 'employee_lunch_coverage'
  or p_payload->>'valid_until' is null or (p_payload->>'valid_until')::timestamptz<=p_at then return false;end if;
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if j.job_id is null or j.job_type is distinct from 'employee_native_push'
  or j.source_id::text is distinct from p_payload->>'projection_id'
  or j.job_key is distinct from 'employee-lunch-push:'||(p_payload->>'notification_key')||':'||(p_payload->>'receipt_credential_id')
  or j.payload_json->>'credential_id' is distinct from p_payload->>'receipt_credential_id'
  or j.payload_json->>'employee_id' is distinct from p_payload->>'receipt_employee_id'
  or j.payload_json->>'device_identifier' is distinct from p_payload->>'receipt_device_id'
  or j.payload_json->>'assignment_epoch' is distinct from p_payload->>'receipt_assignment_epoch'
  or j.payload_json#>>'{data_json,projection_id}' is distinct from j.source_id::text
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
  or j.payload_json#>'{data_json,test_delivery}' is not null then return false;end if;
 service_date:=(p_payload->>'service_date')::date;
 if public.sch_service_date(p_at) is distinct from service_date then return false;end if;
 select * into authority from public.static_weekly_v6_schedule_authority_state(service_date);
 if authority.governed is not true or authority.projection_status is distinct from 'current'
  or public.static_weekly_manual_lunch_current_basis(j.source_id,p_payload->>'document_identity',
   p_payload->>'notification_key',service_date) is null then return false;end if;
 select * into doc from public.weekly_schedule_lunch_documents where projection_id=j.source_id;
 if doc.projection_id is null or doc.document_identity is distinct from p_payload->>'document_identity' then return false;end if;
 perform public.static_weekly_v8_assert_lunch_document(doc.projection_id,doc.document_json);
 select value into intent from jsonb_array_elements(doc.document_json->'notification_intents') value
  where value->>'notification_key'=p_payload->>'notification_key'
   and value->>'service_date'=service_date::text;
 select value into loan from jsonb_array_elements(doc.document_json->'loans') value
  where value->>'loan_id'=intent->>'loan_id' and value->>'status'='PLANNED';
 select value into responsibility from jsonb_array_elements(doc.document_json->'responsibilities') value
  where value->>'loan_id'=intent->>'loan_id'
   and value->>'coverer_slot_id'=intent->>'coverer_slot_id'
   and value->>'coverer_person_id'=p_payload->>'receipt_employee_id';
 select value into available from public.weekly_schedule_compiled_projections projection,
  jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
  where projection.projection_id=authority.projection_id and value->>'serviceDate'=service_date::text
   and value->>'slotId'=intent->>'coverer_slot_id'
   and value->>'incumbentPersonId'=p_payload->>'receipt_employee_id' and value->>'status'='working';
 if intent is null or loan is null or responsibility is null or available is null
  or intent->>'event' not in ('start','end')
  or j.payload_json#>>'{data_json,notification_key}' is distinct from intent->>'notification_key'
  or j.payload_json#>>'{data_json,loan_id}' is distinct from intent->>'loan_id'
  or j.payload_json#>>'{data_json,event}' is distinct from intent->>'event'
  or j.payload_json#>>'{data_json,coverer_slot_id}' is distinct from intent->>'coverer_slot_id'
  or j.payload_json#>>'{data_json,scheduled_time}' is distinct from intent->>'scheduled_time'
  or j.payload_json#>>'{data_json,scheduled_at}' is distinct from public.custodial_native_location_utc(
    (service_date+(intent->>'scheduled_time')::time) at time zone 'America/Chicago')
  or j.payload_json#>>'{data_json,document_identity}' is distinct from doc.document_identity
  or p_payload->>'event' is distinct from intent->>'event'
  or p_payload->>'loan_id' is distinct from intent->>'loan_id'
  or p_payload->>'coverer_slot_id' is distinct from intent->>'coverer_slot_id'
  or p_payload->>'scheduled_time' is distinct from intent->>'scheduled_time'
  or p_payload->>'document_identity' is distinct from doc.document_identity then return false;end if;
 scheduled:=(service_date+(intent->>'scheduled_time')::time) at time zone 'America/Chicago';
 ends_at:=(service_date+(case when intent->>'event'='start' then loan->>'coverage_end'
  else available#>>'{shift,end}' end)::time) at time zone 'America/Chicago';
 if ends_at is null or ends_at<=scheduled or p_at<scheduled or p_at>=ends_at
  or p_payload->>'scheduled_at' is distinct from public.custodial_native_location_utc(scheduled)
  or (p_payload->>'valid_until')::timestamptz>ends_at then return false;end if;
 return true;
exception when data_exception or invalid_datetime_format or datetime_field_overflow then return false;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_original_native_bindings(p_body jsonb, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare lunch_basis jsonb;effect jsonb;normal_data jsonb;payload jsonb;entry jsonb;entries jsonb:='[]'::jsonb;
 original record;matches integer;kind text;field text;fields text[];seen text[]:='{}'::text[];counted integer:=0;
 unavailable jsonb:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','UNAVAILABLE','entries','[]'::jsonb);
begin
 if p_at is null or not isfinite(p_at) or jsonb_typeof(p_body->'required_effects') is distinct from 'array'
  or jsonb_array_length(p_body->'required_effects') not between 1 and 1024 then return unavailable;end if;
 for effect in select value from jsonb_array_elements(p_body->'required_effects') loop
  counted:=counted+1;normal_data:=case effect->>'origin' when 'FULL_ACCEPTED_LUNCH_DOCUMENT' then effect#>'{notification,data}'
   when 'EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES' then effect->'data' else null end;
  kind:=normal_data->>'kind';
  if kind not in ('employee_lunch_coverage','employee_location_status') or kind is null
   or effect->>'notification_key' is null or effect->>'notification_key'=any(seen)
   or normal_data->>'notification_key' is distinct from effect->>'notification_key'
   or normal_data->>'service_date' is distinct from p_body->>'service_date'
   or normal_data->>'receipt_employee_id' is distinct from p_body->>'employee_id'
   or normal_data->>'receipt_credential_id' is distinct from p_body->>'credential_id'
   or normal_data->>'receipt_device_id' is distinct from p_body->>'canonical_device_id'
   or normal_data->>'receipt_assignment_epoch' is distinct from p_body->>'assignment_epoch' then return unavailable;end if;
  seen:=array_append(seen,effect->>'notification_key');matches:=0;
  for original in
   select receipt.*,generation.principal_digest as original_principal_digest
   from public.employee_native_push_delivery_receipts receipt
   join public.operational_notification_jobs job on job.job_id=receipt.job_id and job.job_key=receipt.job_key
   join public.employee_native_push_generations generation on generation.generation_id=receipt.native_generation_id
    and generation.registration_id=receipt.registration_id
   join public.employee_push_registrations registration on registration.registration_id=generation.registration_id
   where receipt.credential_id=(p_body->>'credential_id')::uuid and receipt.assignment_epoch=(p_body->>'assignment_epoch')::bigint
    and generation.device_id=(p_body->>'device_pk')::uuid and generation.credential_id=receipt.credential_id
    and generation.employee_id=(p_body->>'employee_id')::uuid and generation.assignment_epoch=receipt.assignment_epoch
    and generation.device_identifier=p_body->>'canonical_device_id' and generation.revoked_at is null
    and generation.activated_at<=receipt.prepared_at
    and (generation.dispatch_retired_at is null or receipt.prepared_at<=generation.dispatch_retired_at)
    and registration.device_id=generation.device_id and registration.credential_id=generation.credential_id
    and registration.employee_id=generation.employee_id and registration.assignment_epoch=generation.assignment_epoch
    and registration.platform='android' and registration.provider='fcm'
    and job.job_type='employee_native_push' and job.payload_json#>'{data_json,test_delivery}' is null
    and job.payload_json#>>'{data_json,kind}'=kind
    and job.payload_json->>'credential_id'=p_body->>'credential_id'
    and job.payload_json->>'employee_id'=p_body->>'employee_id'
    and job.payload_json->>'device_id'=p_body->>'device_pk'
    and job.payload_json->>'device_identifier'=p_body->>'canonical_device_id'
    and job.payload_json->>'assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload is not null and receipt.native_payload_sha256~'^[a-f0-9]{64}$'
    and receipt.native_valid_until>p_at and receipt.prepared_at<=p_at
    and receipt.native_payload->>'notification_key'=effect->>'notification_key'
    and receipt.native_payload->>'kind'=kind and receipt.native_payload->>'service_date'=p_body->>'service_date'
    and receipt.native_payload->>'receipt_employee_id'=p_body->>'employee_id'
    and receipt.native_payload->>'receipt_credential_id'=p_body->>'credential_id'
    and receipt.native_payload->>'receipt_device_id'=p_body->>'canonical_device_id'
    and receipt.native_payload->>'receipt_assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload->>'receipt_job_id'=receipt.job_id::text
    and receipt.native_payload->>'generation_id'=generation.generation_id::text
    and receipt.native_payload->>'principal_digest'=generation.principal_digest
    and receipt.native_payload->>'token_digest'=generation.token_digest and receipt.token_hash=generation.token_digest
    and receipt.native_payload->>'content_sha256'=receipt.native_payload_sha256
    and receipt.native_payload_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(receipt.native_payload-'content_sha256'))
    and receipt.native_payload->>'reservation_at'=public.custodial_native_location_utc(receipt.prepared_at)
    and receipt.native_payload->>'valid_until'=public.custodial_native_location_utc(receipt.native_valid_until)
    and octet_length(public.custodial_native_location_canonical(receipt.native_payload))<=3500
    and case kind when 'employee_lunch_coverage' then
     exists(select 1 from public.employee_native_lunch_dispatch_attempts attempt where attempt.job_id=receipt.job_id)
      and public.custodial_native_lunch_live(receipt.job_id,receipt.native_payload,p_at)
     else public.custodial_native_location_live(receipt.job_id,receipt.native_payload,p_at) end
   order by receipt.job_id limit 2 loop
   matches:=matches+1;payload:=original.native_payload;
   -- Do not equate native location spoken words with normal renderer wording.
   -- Bind the original native audio source separately, but require exact
   -- nonsecret semantic key/principal/current accepted source correspondence.
   if kind='employee_lunch_coverage' then
    lunch_basis:=public.static_weekly_manual_lunch_current_basis((payload->>'projection_id')::uuid,
     payload->>'document_identity',payload->>'notification_key',(payload->>'service_date')::date);
    if lunch_basis is null
     or normal_data->>'projection_id' is distinct from lunch_basis->>'current_projection_id'
     or normal_data->>'document_identity' is distinct from lunch_basis->>'current_document_identity'
     then return unavailable;end if;
   end if;
   fields:=case kind when 'employee_lunch_coverage' then
    array['notification_key','kind','service_date','loan_id','event','scheduled_time','scheduled_at','coverer_slot_id','route']
    else array['notification_key','kind','service_date','location_id','location_code','location_name','form_type','group_code','group_name','status_code','projection_id','publication_id'] end;
   foreach field in array fields loop
    if payload->>field is distinct from normal_data->>field then return unavailable;end if;
   end loop;
   entry:=jsonb_build_object('notification_key',payload->>'notification_key','receipt_job_id',original.job_id::text,
    'generation_id',original.native_generation_id::text,'registration_id',original.registration_id::text,
    'principal_digest',original.original_principal_digest,'token_digest',original.token_hash,
    'reservation_at',public.custodial_native_location_utc(original.prepared_at),
    'valid_until',public.custodial_native_location_utc(original.native_valid_until),'content_sha256',original.native_payload_sha256,
    'native_kind',kind,'audio_origin','ORIGINAL_NATIVE_JOB','speech_sha256',public.static_weekly_digest_text(payload->>'body'));
  end loop;
  if matches<>1 then return unavailable;end if;
  entries:=entries||jsonb_build_array(entry);
 end loop;
 if counted<>jsonb_array_length(entries) then return unavailable;end if;
 entry:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','ORIGINAL_NATIVE_RESERVATIONS','entries',entries);
 if octet_length(entry::text)>196608 then raise exception 'original native binding bound exceeded' using errcode='54000';end if;
 return entry;
end $function$;
-- No DML against jobs/receipts/attempts/documents; existing ACLs are preserved.
COMMIT;
