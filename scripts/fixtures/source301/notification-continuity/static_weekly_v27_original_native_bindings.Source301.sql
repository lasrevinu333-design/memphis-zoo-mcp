CREATE OR REPLACE FUNCTION public.static_weekly_v27_original_native_bindings(p_body jsonb, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare effect jsonb;normal_data jsonb;payload jsonb;entry jsonb;entries jsonb:='[]'::jsonb;
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
   fields:=case kind when 'employee_lunch_coverage' then
    array['notification_key','kind','service_date','loan_id','event','scheduled_time','scheduled_at','coverer_slot_id','projection_id','document_identity','route']
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
end $function$
