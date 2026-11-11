-- CLI-created 20261002144157; forward-only H01 LUNCH server seam.
-- No provider/profile/clock activation or historical receipt rewrite.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- The original LOCATION constraint now also admits the *separate* exact native
-- LUNCH wire. NULL historical rows remain exactly as before.
alter table public.employee_native_push_delivery_receipts drop constraint native_location_payload_binding;
alter table public.employee_native_push_delivery_receipts add constraint native_location_payload_binding check (
 (native_generation_id is null and native_payload is null and native_payload_sha256 is null and native_valid_until is null)
 or (native_generation_id is not null and native_payload is not null and native_payload_sha256 is not null and native_valid_until is not null
  and native_payload_sha256 ~ '^[0-9a-f]{64}$' and isfinite(native_valid_until) and native_valid_until>prepared_at
  and native_payload->>'generation_id'=native_generation_id::text
  and native_payload->>'receipt_job_id'=job_id::text
  and native_payload->>'receipt_credential_id'=credential_id::text
  and native_payload->>'receipt_assignment_epoch'=assignment_epoch::text
  and native_payload->>'token_digest'=token_hash
  and native_payload->>'reservation_at'=public.custodial_native_location_utc(prepared_at)
  and native_payload->>'valid_until'=public.custodial_native_location_utc(native_valid_until)
  and native_payload->>'content_sha256'=native_payload_sha256
  and native_payload_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(native_payload-'content_sha256'))
  and octet_length(public.custodial_native_location_canonical(native_payload))<=3500
  and ((native_payload->>'schema'='custodial.native-location-payload.v2' and native_payload->>'location_id'=source_id::text)
    or (native_payload->>'schema'='custodial.native-provider-payload.v1'
     and native_payload->>'kind'='employee_lunch_coverage'
     and native_payload->>'projection_id'=source_id::text
     and native_payload->>'notification_type'='lunch_coverage'
     and native_payload->>'channel_id'='employee-lunch-coverage'))) is true);

-- Read-only business predicate deliberately ignores whether a generation was
-- later retired. An original pre-retirement reservation can be recovered while
-- its accepted publication/loan/coverer remains current; it cannot be resent.
create function public.custodial_native_lunch_live(p_job uuid,p_payload jsonb,p_at timestamptz)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
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
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
  or j.payload_json#>'{data_json,test_delivery}' is not null then return false;end if;
 service_date:=(p_payload->>'service_date')::date;
 if public.sch_service_date(p_at) is distinct from service_date then return false;end if;
 select * into authority from public.static_weekly_v6_schedule_authority_state(service_date);
 if authority.governed is not true or authority.projection_status is distinct from 'current'
  or authority.projection_id is distinct from j.source_id then return false;end if;
 select * into doc from public.weekly_schedule_lunch_documents where projection_id=authority.projection_id;
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
  or (p_payload->>'valid_until')::timestamptz>ends_at
  or (intent->>'event'='start' and ends_at>scheduled+interval '1 hour') then return false;end if;
 return true;
exception when data_exception or invalid_datetime_format or datetime_field_overflow then return false;
end $fn$;

create function public.custodial_native_lunch_target_at(p_job uuid,p_lease uuid,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;
 at_time timestamptz;cid uuid;source jsonb;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null then raise exception 'native lunch target job/lease required' using errcode='22023';end if;
 select (payload_json->>'credential_id')::uuid into cid from public.operational_notification_jobs where job_id=p_job;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=cid for update of d0;
 select * into c from public.device_auth_credentials where credential_id=cid for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into g from public.employee_native_push_generations where device_id=d.id
  and dispatch_retired_at is null and revoked_at is null for update;
 select * into r from public.employee_push_registrations where registration_id=g.registration_id;
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if d.id is null or not isfinite(at_time) or d.active is not true or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or c.device_id is distinct from d.id or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$')
  or g.generation_id is null or g.credential_id is distinct from c.credential_id or g.employee_id is distinct from d.assigned_employee_id
  or g.assignment_epoch is distinct from d.assignment_epoch or g.device_identifier is distinct from d.device_id or g.activated_at>at_time
  or r.registration_id is null or r.device_id is distinct from d.id or r.credential_id is distinct from c.credential_id
  or r.employee_id is distinct from d.assigned_employee_id or r.assignment_epoch is distinct from d.assignment_epoch
  or r.active is not true or r.revoked_at is not null or r.platform is distinct from 'android'
  or r.token_hash is distinct from g.token_digest or public.static_weekly_digest_text(r.fcm_token) is distinct from g.token_digest
  or j.job_type is distinct from 'employee_native_push' or j.status is distinct from 'leased' or j.lease_token is distinct from p_lease
  or j.leased_until is null or j.leased_until<=at_time or j.payload_json->>'credential_id' is distinct from cid::text
  or j.payload_json->>'device_id' is distinct from d.id::text or j.payload_json->>'device_identifier' is distinct from d.device_id
  or j.payload_json->>'employee_id' is distinct from d.assigned_employee_id::text or j.payload_json->>'assignment_epoch' is distinct from d.assignment_epoch::text
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage' or j.payload_json#>'{data_json,test_delivery}' is not null then
  return jsonb_build_object('current',false,'reason','native_lunch_target_unavailable');end if;
 source:=public.custodial_native_target_source_at('LUNCH',p_job,d.assigned_employee_id,g.generation_id,at_time);
 if source->>'status' is distinct from 'CURRENT_SOURCE_ONLY' or
  (source#>>'{source,valid_from}')::timestamptz>at_time then
  return jsonb_build_object('current',false,'reason','native_lunch_target_unavailable');end if;
 return jsonb_build_object('current',true,'expected',jsonb_build_object('assignment_epoch',d.assignment_epoch::text,
  'credential_id',cid::text,'device_id',d.device_id,'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',r.registration_id::text,'token_digest',g.token_digest),'token',r.fcm_token);
end $fn$;
create function public.custodial_native_lunch_target(p_job uuid,p_lease uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_lunch_target_at(p_job,p_lease,null);
$fn$;

create function public.custodial_native_lunch_reserve_at(p_job uuid,p_lease uuid,p_expected jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
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
  'body',case source#>>'{source,event}' when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
   else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,
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
end $fn$;
create function public.custodial_native_lunch_reserve(p_job uuid,p_lease uuid,p_expected jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_lunch_reserve_at(p_job,p_lease,p_expected,null);
$fn$;

-- An inserted attempt permanently consumes this reservation's FCM permission.
-- It survives provider response loss; no second send is inferred from a lease.
create table public.employee_native_lunch_dispatch_attempts (
 job_id uuid primary key references public.employee_native_push_delivery_receipts(job_id),
 attempt_id uuid not null unique default gen_random_uuid(),
 outcome_operation_id uuid not null unique default gen_random_uuid(),
 check(attempt_id<>outcome_operation_id)
);
create trigger trg_native_lunch_dispatch_immutable before update or delete on public.employee_native_lunch_dispatch_attempts
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_lunch_dispatch_attempts enable always trigger trg_native_lunch_dispatch_immutable;
alter table public.employee_native_lunch_dispatch_attempts enable row level security;
alter table public.employee_native_lunch_dispatch_attempts force row level security;

create function public.custodial_native_lunch_dispatch_status(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.employee_native_push_delivery_receipts%rowtype;a public.employee_native_lunch_dispatch_attempts%rowtype;b jsonb;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null then raise exception 'exact original lunch job required' using errcode='22023';end if;
 perform 1 from public.operational_notification_jobs where job_id=p_job for update;
 select * into r from public.employee_native_push_delivery_receipts where job_id=p_job for update;
 if r.job_id is null then return jsonb_build_object('schema','custodial.native-lunch-dispatch-status.v1',
  'reserved',false,'dispatch_authorized',false);end if;
 if r.native_generation_id is null or r.native_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
  or r.native_payload->>'kind' is distinct from 'employee_lunch_coverage' then
  raise exception 'original LUNCH native reservation required' using errcode='42501';end if;
 select * into a from public.employee_native_lunch_dispatch_attempts where job_id=p_job;
 b:=jsonb_build_object('receipt_job_id',r.job_id::text,'lease_token',r.lease_token::text,
  'registration_id',r.registration_id::text,'generation_id',r.native_generation_id::text,
  'reservation_at',public.custodial_native_location_utc(r.prepared_at),'content_sha256',r.native_payload_sha256,
  'token_digest',r.token_hash,'principal_digest',r.native_payload->>'principal_digest',
  'receipt_credential_id',r.credential_id::text,'receipt_assignment_epoch',r.assignment_epoch::text,
  'receipt_employee_id',r.native_payload->>'receipt_employee_id','receipt_device_id',r.native_payload->>'receipt_device_id');
 return jsonb_build_object('schema','custodial.native-lunch-dispatch-status.v1','reserved',true,
  'dispatch_authorized',false,'binding',b,'attempt_id',a.attempt_id,'outcome_operation_id',a.outcome_operation_id);
end $fn$;

create function public.custodial_native_lunch_dispatch_prepare_at(p_job uuid,p_lease uuid,p_expected jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare reserved jsonb;a public.employee_native_lunch_dispatch_attempts%rowtype;ttl bigint;
begin
 perform public.custodial_begin_application_mutation();
 reserved:=public.custodial_native_lunch_reserve_at(p_job,p_lease,p_expected,p_test_at);
 if reserved->'dispatch_authorized' is distinct from 'true'::jsonb then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_lunch_dispatch_not_fresh');end if;
 insert into public.employee_native_lunch_dispatch_attempts(job_id) values(p_job) returning * into a;
 ttl:=least(2419200,floor(extract(epoch from
  (reserved#>>'{payload,valid_until}')::timestamptz-(reserved#>>'{payload,reservation_at}')::timestamptz))::bigint);
 if ttl<=0 then raise exception 'native LUNCH validity unavailable';end if;
 return jsonb_build_object('schema','custodial.native-lunch-dispatch.v1','dispatch_authorized',true,
  'reservation',reserved,'attempt_id',a.attempt_id,'outcome_operation_id',a.outcome_operation_id,'ttl_seconds',ttl);
end $fn$;
create function public.custodial_native_lunch_dispatch_prepare(p_job uuid,p_lease uuid,p_expected jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_lunch_dispatch_prepare_at(p_job,p_lease,p_expected,null);
$fn$;

-- The older append-only outcome ledger is structurally common to both native
-- kinds. Its existing operation/actor/replay/history fences remain intact;
-- LUNCH adds the same database-owned attempt operation requirement.
do $patch$ declare definition text;needle text:=$old$ select * into g from public.employee_native_push_generations where generation_id=receipt.native_generation_id;$old$;begin
 definition:=pg_get_functiondef('public.custodial_native_location_outcome_at(jsonb,jsonb,timestamptz)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'native LUNCH outcome operation seam changed';end if;
 execute replace(definition,needle,$new$ if receipt.native_payload->>'schema'='custodial.native-provider-payload.v1'
  and (receipt.native_payload->>'kind' is distinct from 'employee_lunch_coverage'
   or not exists(select 1 from public.employee_native_lunch_dispatch_attempts
    where job_id=receipt.job_id and outcome_operation_id=operation)) then
  raise exception 'original LUNCH dispatch outcome operation required' using errcode='23505';end if;
$new$||needle);
end $patch$;

create function public.custodial_native_lunch_outcome_at(p_binding jsonb,p_evidence jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.employee_native_push_delivery_receipts%rowtype;v jsonb;
begin
 if p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'exact LUNCH outcome job required' using errcode='22023';end if;
 select * into r from public.employee_native_push_delivery_receipts where job_id=(p_binding->>'receipt_job_id')::uuid;
 if r.native_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
  or r.native_payload->>'kind' is distinct from 'employee_lunch_coverage' then
  raise exception 'original LUNCH reservation required' using errcode='42501';end if;
 v:=public.custodial_native_location_outcome_at(p_binding,p_evidence,p_test_at);
 return (v-'schema')||jsonb_build_object('schema','custodial.native-lunch-outcome-receipt.v1');
end $fn$;
create function public.custodial_native_lunch_outcome(p_binding jsonb,p_evidence jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_lunch_outcome_at(p_binding,p_evidence,null);
$fn$;
create function public.custodial_native_lunch_outcome_status(p_binding jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.employee_native_push_delivery_receipts%rowtype;v jsonb;
begin
 if p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'exact LUNCH status job required' using errcode='22023';end if;
 select * into r from public.employee_native_push_delivery_receipts where job_id=(p_binding->>'receipt_job_id')::uuid;
 if r.native_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
  or r.native_payload->>'kind' is distinct from 'employee_lunch_coverage' then
  raise exception 'original LUNCH reservation required' using errcode='42501';end if;
 v:=public.custodial_native_location_outcome_status(p_binding);
 return (v-'schema')||jsonb_build_object('schema','custodial.native-lunch-outcome-status.v1');
end $fn$;

-- Preserve the full v2 interval/actor/replay receipt algorithm and only admit
-- the separately typed original LUNCH payload. Lunch acknowledgment records
-- an action; it does not project a verified-visit cleaning-clock ACK.
do $patch$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.custodial_native_provider_events_at(uuid,text,uuid,text,jsonb,timestamptz)'::regprocedure);
 old:=$old$or payload->>'schema' is distinct from 'custodial.native-location-payload.v2' then code:='native_provider_original_binding_invalid';end if;$old$;
 replacement:=$new$or (payload->>'schema' is distinct from 'custodial.native-location-payload.v2'
    and not (payload->>'schema'='custodial.native-provider-payload.v1'
     and payload->>'kind'='employee_lunch_coverage')) then code:='native_provider_original_binding_invalid';end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native LUNCH original receipt schema seam changed';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$if code is null and prior.action='acknowledged' then perform public.custodial_native_location_project_ack(prior.event_id,at_time);end if;$old$;
 replacement:=$new$if code is null and prior.action='acknowledged'
   and payload->>'schema'='custodial.native-location-payload.v2' then
   perform public.custodial_native_location_project_ack(prior.event_id,at_time);end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native LUNCH ACK projection seam changed';end if;
 execute replace(definition,old,replacement);
end $patch$;

-- The existing bounded inventory scan keeps its immutable candidate ceiling,
-- cursor, principal/generation and outcome rules. It now includes only LUNCH
-- originals whose exact accepted business source is still live.
do $patch$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.custodial_native_location_inventory_rows(uuid,text,jsonb,timestamptz)'::regprocedure);
 old:=$old$and public.custodial_native_location_live(r.job_id,r.native_payload,p_at) is true;$old$;
 replacement:=$new$and ((r.native_payload->>'schema'='custodial.native-location-payload.v2'
   and public.custodial_native_location_live(r.job_id,r.native_payload,p_at) is true)
   or (r.native_payload->>'schema'='custodial.native-provider-payload.v1'
   and r.native_payload->>'kind'='employee_lunch_coverage'
   and public.custodial_native_lunch_live(r.job_id,r.native_payload,p_at) is true));$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then
  raise exception 'native LUNCH inventory live-source seam changed';end if;
 execute replace(definition,old,replacement);
end $patch$;

do $acl$ declare f regprocedure;begin
 revoke all on table public.employee_native_lunch_dispatch_attempts
  from public,anon,authenticated,service_role,static_weekly_control_plane,
   static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
 if not exists(select 1 from pg_trigger where tgrelid='public.employee_native_lunch_dispatch_attempts'::regclass
  and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O') then
  raise exception 'native LUNCH dispatch restore mutation fence missing';end if;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
  and proname like 'custodial_native_lunch_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_lunch_target(uuid,uuid),
 public.custodial_native_lunch_dispatch_status(uuid),
 public.custodial_native_lunch_dispatch_prepare(uuid,uuid,jsonb),
 public.custodial_native_lunch_outcome(jsonb,jsonb),
 public.custodial_native_lunch_outcome_status(jsonb) to service_role;

lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace
   and (p.proname like 'custodial_native_lunch_%' or p.proname in
    ('custodial_native_location_outcome_at','custodial_native_provider_events_at',
     'custodial_native_location_inventory_rows'))
 ),objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,
   pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
  union all select x.bucket,x.kind,x.identity,x.definition from
   unnest(array['public.employee_native_lunch_dispatch_attempts']) rel cross join lateral (
    select 1000 bucket,'relation'::text kind,rel identity,
     public.custodial_release_authority_current_relation_definition(rel) definition
    union all select 200000,'column',rel||':'||attname,
     public.custodial_release_authority_current_column_definition(rel||':'||attname)
     from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,
     public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
     from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,
     public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
     from pg_index i where indrelid=rel::regclass and not exists
      (select 1 from pg_constraint c where c.conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,
     'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
      ||pg_get_triggerdef(oid,true)||'; alter table '||rel||case when tgenabled='A'
      then ' enable always trigger ' else ' enable trigger ' end||quote_ident(tgname)||';'
     from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
  union all select 500000,'constraint',
   'public.employee_native_push_delivery_receipts:native_location_payload_binding',
   public.custodial_release_authority_current_constraint_definition(
    'public.employee_native_push_delivery_receipts:native_location_payload_binding')
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing native LUNCH recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory
   set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),
    captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    (obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
      and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate native LUNCH recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,
    case when obj.bucket=1000 then 99998 else obj.bucket+99998 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
    order by n limit 1;
   if next_order is null then raise exception 'native LUNCH recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(
    restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
