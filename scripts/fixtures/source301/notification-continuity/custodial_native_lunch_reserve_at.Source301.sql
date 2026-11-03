CREATE OR REPLACE FUNCTION public.custodial_native_lunch_reserve_at(p_job uuid, p_lease uuid, p_expected jsonb, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare target jsonb;source jsonb;j public.operational_notification_jobs%rowtype;
 c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;prior public.employee_native_push_delivery_receipts%rowtype;
 at_time timestamptz;until_time timestamptz;data jsonb;wire text;digest text;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null or jsonb_typeof(p_expected) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_expected) key) is distinct from
   array['assignment_epoch','credential_id','device_id','employee_id','generation_id','principal_digest','registration_id','token_digest']
  or exists(select 1 from jsonb_each(p_expected) e where jsonb_typeof(e.value)<>'string') then
  raise exception 'exact native lunch recipient required' using errcode='22023';end if;
 -- The target call takes the current schedule, device, credential, registration,
 -- generation and job locks. The final time is sampled *after* those locks.
 target:=public.custodial_native_lunch_target_at(p_job,p_lease,p_test_at);
 if target->'current' is distinct from 'true'::jsonb or target->'expected' is distinct from p_expected then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_recipient_superseded');end if;
 at_time:=coalesce(p_test_at,clock_timestamp());
 select * into j from public.operational_notification_jobs where job_id=p_job;
 select * into c from public.device_auth_credentials where credential_id=(p_expected->>'credential_id')::uuid;
 select * into r from public.employee_push_registrations where registration_id=(p_expected->>'registration_id')::uuid;
 select * into g from public.employee_native_push_generations where generation_id=(p_expected->>'generation_id')::uuid;
 if not isfinite(at_time) or c.expires_at<=at_time or j.job_id is null or j.status is distinct from 'leased'
  or j.lease_token is distinct from p_lease or j.leased_until<=at_time
  or r.active is not true or r.revoked_at is not null or g.dispatch_retired_at is not null or g.revoked_at is not null then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_job_superseded');end if;
 source:=public.custodial_native_target_source_at('LUNCH',p_job,(p_expected->>'employee_id')::uuid,g.generation_id,at_time);
 if source->>'status' is distinct from 'CURRENT_SOURCE_ONLY'
  or (source#>>'{source,valid_from}')::timestamptz>at_time then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_authority_superseded');end if;
 until_time:=(source#>>'{source,valid_until}')::timestamptz;
 select * into prior from public.employee_native_push_delivery_receipts where job_id=p_job for update;
 if prior.job_id is not null then
  if prior.native_generation_id is distinct from g.generation_id or prior.registration_id is distinct from r.registration_id
   or prior.credential_id is distinct from c.credential_id or prior.assignment_epoch::text is distinct from p_expected->>'assignment_epoch'
   or prior.token_hash is distinct from g.token_digest or prior.job_key is distinct from j.job_key
   or prior.source_id is distinct from j.source_id or prior.native_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
   or prior.native_valid_until<=at_time or public.custodial_native_lunch_live(p_job,prior.native_payload,at_time) is not true then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_original_reservation_conflict');end if;
  return jsonb_build_object('current',true,'dispatch_authorized',false,'replayed',true,'delivery_outcome_unknown',true,
   'reason','native_lunch_outcome_unknown_no_resend','payload',prior.native_payload,
   'wire',public.custodial_native_location_canonical(prior.native_payload));
 end if;
 data:=jsonb_build_object('schema','custodial.native-provider-payload.v1','kind','employee_lunch_coverage',
  'notification_type','lunch_coverage','generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
  'token_digest',g.token_digest,'receipt_job_id',j.job_id::text,'receipt_credential_id',c.credential_id::text,
  'receipt_employee_id',p_expected->>'employee_id','receipt_device_id',p_expected->>'device_id',
  'receipt_assignment_epoch',p_expected->>'assignment_epoch','notification_key',source#>>'{source,notification_key}',
  'reservation_at',public.custodial_native_location_utc(at_time),'valid_until',public.custodial_native_location_utc(until_time),
  'title',case source#>>'{source,event}' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
  'body',public.custodial_native_lunch_spoken_body(j.source_id,source#>>'{source,source_digest}',
   source#>>'{source,loan_id}',(p_expected->>'employee_id')::uuid,source#>>'{source,event}'),
  'channel_id','employee-lunch-coverage','route','employee-schedule.html?hub=employee',
  'service_date',j.payload_json#>>'{data_json,service_date}',
  'event',source#>>'{source,event}','loan_id',source#>>'{source,loan_id}',
  'scheduled_time',j.payload_json#>>'{data_json,scheduled_time}',
  'scheduled_at',public.custodial_native_location_utc((source#>>'{source,valid_from}')::timestamptz),
  'coverer_slot_id',source#>>'{source,coverer_slot_id}',
  'projection_id',j.source_id::text,'document_identity',source#>>'{source,source_digest}');
 if public.custodial_native_lunch_live(p_job,data,at_time) is not true then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_authority_superseded');end if;
 if exists(select 1 from jsonb_each_text(data) e where octet_length(e.value)>case when e.key='title' then 180
   when e.key='notification_key' then 240 else 1000 end or e.value ~ '[[:cntrl:]]') then
  raise exception 'native lunch source text unsupported; no truncation';end if;
 digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));
 data:=data||jsonb_build_object('content_sha256',digest);wire:=public.custodial_native_location_canonical(data);
 if octet_length(wire)>3500 then raise exception 'native lunch payload too large; no truncation';end if;
 insert into public.employee_native_push_delivery_receipts(job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,
  registration_id,token_hash,prepared_at,native_generation_id,native_payload,native_payload_sha256,native_valid_until)
 values(j.job_id,j.job_key,j.source_id,p_lease,c.credential_id,(p_expected->>'assignment_epoch')::bigint,
  r.registration_id,g.token_digest,at_time,g.generation_id,data,digest,until_time);
 return jsonb_build_object('current',true,'dispatch_authorized',true,'replayed',false,'delivery_outcome_unknown',false,
  'payload',data,'wire',wire);
end $function$
