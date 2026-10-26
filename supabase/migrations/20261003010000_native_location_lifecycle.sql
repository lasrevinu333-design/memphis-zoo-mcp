-- CLI-created20261002081850; parent reserved20261003010000. Guarded source only.
-- No sender/index/native-factory activation or clock qualification.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function public.custodial_native_location_utc(p_at timestamptz)
returns text language sql immutable set search_path=pg_catalog as $fn$
 select to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$fn$;

-- Shared business predicate, independent of a delivery worker's lease. Send
-- retains its existing leased validator and also invokes this same predicate.
create function public.custodial_native_location_live(p_job uuid,p_payload jsonb,p_at timestamptz)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select isfinite(p_at) and (p_payload->>'valid_until')::timestamptz>p_at
 and p_payload->>'service_date'=public.sch_service_date(p_at)::text
 and 1=(select count(*) from public.custodial_operational_location_assignments(public.sch_service_date(p_at)) a
  join public.weekly_schedule_versions v on v.version_id=a.version_id
  join public.weekly_schedule_publications pub on pub.publication_id=a.publication_id and pub.version_id=v.version_id
  join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
  join public.mz_location_reminder_candidates(public.sch_service_date(p_at),p_at) c on c.location_id=a.location_id
  join public.operational_notification_jobs j on j.job_id=p_job and j.source_id=a.location_id
  where j.job_type='employee_native_push' and j.payload_json#>'{data_json,test_delivery}' is null
   and j.payload_json#>>'{data_json,kind}'='employee_location_status'
   and j.job_key='employee-location-push:'||(p_payload->>'notification_key')||':'||(p_payload->>'receipt_credential_id')
   and j.payload_json->>'credential_id'=p_payload->>'receipt_credential_id'
   and j.payload_json->>'employee_id'=p_payload->>'receipt_employee_id'
   and j.payload_json->>'device_identifier'=p_payload->>'receipt_device_id'
   and j.payload_json->>'assignment_epoch'=p_payload->>'receipt_assignment_epoch'
   and j.payload_json#>>'{data_json,notification_key}'=p_payload->>'notification_key'
   and j.payload_json#>>'{data_json,projection_id}'=a.projection_id::text
   and j.payload_json#>>'{data_json,publication_id}'=a.publication_id::text
   and a.assigned_employee_id::text=p_payload->>'receipt_employee_id'
   and a.assignment_status='ASSIGNED' and a.projection_status='current'
   and a.coverage_start<=(p_at at time zone 'America/Chicago')::time
   and a.coverage_end>(p_at at time zone 'America/Chicago')::time
   and a.location_id::text=p_payload->>'location_id'
   and a.location_code=p_payload->>'location_code' and a.location_name=p_payload->>'location_name'
   and a.form_type=p_payload->>'form_type'
   and a.projection_id::text=p_payload->>'projection_id' and a.publication_id::text=p_payload->>'publication_id'
   and a.version_id::text=p_payload->>'version_id' and a.occurrence_id::text=p_payload->>'occurrence_id'
   and a.authority_source=p_payload->>'authority_source' and s.source_id::text=p_payload->>'authority_source_id'
   and s.source_digest=p_payload->>'authority_source_digest'
   and c.notification_key||':projection:'||a.projection_id::text=p_payload->>'notification_key'
   and c.status_code=p_payload->>'status_code'
   and public.custodial_native_location_utc(c.cleaned_at)=p_payload->>'cleaned_at'
   and public.custodial_native_location_utc(c.cycle_base_at)=p_payload->>'cycle_base_at'
   and c.cycle_base_evidence=p_payload->>'cycle_base_evidence'
   and public.custodial_native_location_utc(c.due_soon_at)=p_payload->>'due_soon_at'
   and public.custodial_native_location_utc(c.overdue_at)=p_payload->>'overdue_at'
   and not exists(select 1 from public.device_notification_acknowledgements ack
    where upper(btrim(ack.device_identifier))=p_payload->>'receipt_device_id'
     and ack.notification_key=p_payload->>'notification_key' and ack.credential_id::text=p_payload->>'receipt_credential_id'
     and ack.assignment_epoch::text=p_payload->>'receipt_assignment_epoch' and ack.employee_id::text=p_payload->>'receipt_employee_id'
     and ack.acknowledged_at is not null));
$fn$;

do $shared$ declare definition text;patch record;begin
 definition:=pg_get_functiondef('public.custodial_native_location_reserve_at(uuid,uuid,jsonb,timestamptz)'::regprocedure);
 for patch in select * from (values
  ($old$  return jsonb_build_object('current',true,'dispatch_authorized',false,'replayed',true,'delivery_outcome_unknown',true,$old$,
   $new$  if public.custodial_native_location_live(p_job,prior.native_payload,at_time) is not true then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_authority_superseded');end if;
  if exists(select 1 from public.employee_native_location_outcomes where job_id=p_job and outcome<>'delivery_outcome_unknown') then
   return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_final_outcome_no_resend');end if;
  return jsonb_build_object('current',true,'dispatch_authorized',false,'replayed',true,'delivery_outcome_unknown',true,$new$),
  ($old$ digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));$old$,
   $new$ if public.custodial_native_location_live(p_job,data,at_time) is not true then
  return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_location_authority_superseded');end if;
 digest:=public.static_weekly_digest_text(public.custodial_native_location_canonical(data));$new$)) p(old_text,new_text) loop
  if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then raise exception 'native reservation shared predicate seam changed';end if;
  definition:=replace(definition,patch.old_text,patch.new_text);
 end loop;
 execute definition;
end $shared$;

create function public.custodial_native_location_target_at(p_job uuid,p_lease uuid,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;j public.operational_notification_jobs%rowtype;at_time timestamptz;cid uuid;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null then raise exception 'native target job/lease required' using errcode='22023';end if;
 select (payload_json->>'credential_id')::uuid into cid from public.operational_notification_jobs where job_id=p_job;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id where c0.credential_id=cid for update of d0;
 select * into c from public.device_auth_credentials where credential_id=cid for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into g from public.employee_native_push_generations where device_id=d.id and dispatch_retired_at is null and revoked_at is null for update;
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
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_location_status' or j.payload_json#>'{data_json,test_delivery}' is not null
  or coalesce((public.mz_validate_employee_location_reminder(p_job,p_lease,at_time)->>'current')::boolean,false) is not true then
  return jsonb_build_object('current',false,'reason','native_location_target_unavailable');end if;
 return jsonb_build_object('current',true,'expected',jsonb_build_object('assignment_epoch',d.assignment_epoch::text,
  'credential_id',cid::text,'device_id',d.device_id,'employee_id',d.assigned_employee_id::text,'generation_id',g.generation_id::text,
  'principal_digest',g.principal_digest,'registration_id',r.registration_id::text,'token_digest',g.token_digest),'token',r.fcm_token);
end $fn$;
create function public.custodial_native_location_target(p_job uuid,p_lease uuid)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_location_target_at(p_job,p_lease,null);
$fn$;

-- Append-only evidence, never a mutation of the original immutable reservation.
create table public.employee_native_location_outcomes (
 operation_id uuid primary key,job_id uuid not null references public.employee_native_push_delivery_receipts(job_id),
 generation_id uuid not null references public.employee_native_push_generations(generation_id),
 binding jsonb not null,evidence jsonb not null,
 outcome text not null check(outcome in ('delivery_outcome_unknown','provider_accepted','known_nonacceptance')),
 server_received_at timestamptz not null check(isfinite(server_received_at))
);
create index native_location_outcome_job on public.employee_native_location_outcomes(job_id,server_received_at,operation_id);
create index native_location_outcome_generation on public.employee_native_location_outcomes(generation_id);
create unique index native_location_one_final_outcome on public.employee_native_location_outcomes(job_id)
 where outcome<>'delivery_outcome_unknown';

create function public.custodial_native_location_append_only()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin raise exception 'native location lifecycle evidence immutable' using errcode='23514';end $fn$;
create trigger trg_native_location_outcome_immutable before update or delete on public.employee_native_location_outcomes
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_location_outcomes enable always trigger trg_native_location_outcome_immutable;

create function public.custodial_native_location_outcome_at(p_binding jsonb,p_evidence jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare receipt public.employee_native_push_delivery_receipts%rowtype;g public.employee_native_push_generations%rowtype;
 prior public.employee_native_location_outcomes%rowtype;terminal public.employee_native_location_outcomes%rowtype;
 expected jsonb;operation uuid;state text;at_time timestamptz;replayed boolean:=false;
begin
 perform public.custodial_begin_application_mutation();
 if jsonb_typeof(p_binding) is distinct from 'object' or jsonb_typeof(p_evidence) is distinct from 'object'
  or octet_length(p_binding::text)>4096 or octet_length(p_evidence::text)>4096
  or (select array_agg(key order by key) from jsonb_object_keys(p_evidence) key) is distinct from array['error_code','operation_id','outcome','provider_message_id']
  or jsonb_typeof(p_evidence->'operation_id') is distinct from 'string' or p_evidence->>'operation_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_evidence->'outcome') is distinct from 'string' or p_evidence->>'outcome' not in ('delivery_outcome_unknown','provider_accepted','known_nonacceptance')
  or jsonb_typeof(p_binding->'receipt_job_id') is distinct from 'string' or p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 then raise exception 'exact native outcome binding/evidence required' using errcode='22023';end if;
 state:=p_evidence->>'outcome';operation:=(p_evidence->>'operation_id')::uuid;
 if state='provider_accepted' then
  if jsonb_typeof(p_evidence->'provider_message_id') is distinct from 'string' or length(p_evidence->>'provider_message_id') not between 1 and 1000
   or p_evidence->>'provider_message_id'<>btrim(p_evidence->>'provider_message_id') or p_evidence->>'provider_message_id' ~ '[[:cntrl:]]'
   or p_evidence->'error_code' is distinct from 'null'::jsonb then raise exception 'exact provider acceptance required' using errcode='22023';end if;
 else
  if p_evidence->'provider_message_id' is distinct from 'null'::jsonb or jsonb_typeof(p_evidence->'error_code') is distinct from 'string'
   or p_evidence->>'error_code' !~ '^[a-z][a-z0-9_]{0,99}$' then raise exception 'bounded outcome diagnostic required' using errcode='22023';end if;
 end if;
 select * into receipt from public.employee_native_push_delivery_receipts where job_id=(p_binding->>'receipt_job_id')::uuid;
 if receipt.native_generation_id is null then raise exception 'original native reservation required' using errcode='42501';end if;
 select * into g from public.employee_native_push_generations where generation_id=receipt.native_generation_id;
 -- Original ledger settlement remains legal after rotation/removal/lease expiry;
 -- it neither dispatches nor updates a successor registration's health.
 perform 1 from public.devices where id=g.device_id for update;
 perform 1 from public.device_auth_credentials where credential_id=receipt.credential_id for update;
 perform 1 from public.employee_push_registrations where device_id=g.device_id order by registration_id for update;
 perform 1 from public.employee_native_push_generations where generation_id=g.generation_id for update;
 perform 1 from public.operational_notification_jobs where job_id=receipt.job_id for update;
 select r0.* into receipt from public.employee_native_push_delivery_receipts r0 where r0.job_id=receipt.job_id for update;
 expected:=jsonb_build_object('receipt_job_id',receipt.job_id::text,'lease_token',receipt.lease_token::text,
  'registration_id',receipt.registration_id::text,'generation_id',receipt.native_generation_id::text,
  'reservation_at',public.custodial_native_location_utc(receipt.prepared_at),'content_sha256',receipt.native_payload_sha256,
  'token_digest',receipt.token_hash,'principal_digest',receipt.native_payload->>'principal_digest',
  'receipt_credential_id',receipt.credential_id::text,'receipt_assignment_epoch',receipt.assignment_epoch::text,
  'receipt_employee_id',receipt.native_payload->>'receipt_employee_id','receipt_device_id',receipt.native_payload->>'receipt_device_id');
 if p_binding is distinct from expected then raise exception 'original reservation identity mismatch' using errcode='23505';end if;
 select * into prior from public.employee_native_location_outcomes where operation_id=operation;
 if prior.operation_id is not null then
  if prior.binding is distinct from expected or prior.evidence is distinct from p_evidence then raise exception 'outcome operation identity conflict' using errcode='23505';end if;
  replayed:=true;
 else
  select * into terminal from public.employee_native_location_outcomes where job_id=receipt.job_id and outcome<>'delivery_outcome_unknown';
  if terminal.operation_id is not null then raise exception 'original reservation already has exact final outcome' using errcode='23505';end if;
  at_time:=coalesce(p_test_at,clock_timestamp());
  if not isfinite(at_time) or at_time<receipt.prepared_at then raise exception 'outcome server time unavailable';end if;
  insert into public.employee_native_location_outcomes(operation_id,job_id,generation_id,binding,evidence,outcome,server_received_at)
   values(operation,receipt.job_id,receipt.native_generation_id,expected,p_evidence,state,at_time) returning * into prior;
 end if;
 return jsonb_build_object('schema','custodial.native-location-outcome-receipt.v1','binding',prior.binding,'evidence',prior.evidence,
  'server_received_at',public.custodial_native_location_utc(prior.server_received_at),'replayed',replayed,'dispatch_authorized',false);
end $fn$;

create function public.custodial_native_location_outcome(p_binding jsonb,p_evidence jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_location_outcome_at(p_binding,p_evidence,null);
$fn$;

create function public.custodial_native_location_outcome_status(p_binding jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.employee_native_push_delivery_receipts%rowtype;o public.employee_native_location_outcomes%rowtype;expected jsonb;
begin
 perform public.custodial_begin_application_mutation();
 if jsonb_typeof(p_binding) is distinct from 'object' or octet_length(p_binding::text)>4096
  or jsonb_typeof(p_binding->'receipt_job_id') is distinct from 'string' or p_binding->>'receipt_job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 then raise exception 'exact original outcome status binding required' using errcode='22023';end if;
 -- This read serializes with settlement at its final job->receipt fence. It
 -- acquires no device/generation lock afterward and cannot reverse that order.
 perform 1 from public.operational_notification_jobs where job_id=(p_binding->>'receipt_job_id')::uuid for update;
 select * into r from public.employee_native_push_delivery_receipts where job_id=(p_binding->>'receipt_job_id')::uuid for update;
 if r.native_generation_id is null then raise exception 'original native reservation required' using errcode='42501';end if;
 expected:=jsonb_build_object('receipt_job_id',r.job_id::text,'lease_token',r.lease_token::text,'registration_id',r.registration_id::text,
  'generation_id',r.native_generation_id::text,'reservation_at',public.custodial_native_location_utc(r.prepared_at),
  'content_sha256',r.native_payload_sha256,'token_digest',r.token_hash,'principal_digest',r.native_payload->>'principal_digest',
  'receipt_credential_id',r.credential_id::text,'receipt_assignment_epoch',r.assignment_epoch::text,
  'receipt_employee_id',r.native_payload->>'receipt_employee_id','receipt_device_id',r.native_payload->>'receipt_device_id');
 if p_binding is distinct from expected then raise exception 'original outcome status identity mismatch' using errcode='23505';end if;
 select * into o from public.employee_native_location_outcomes where job_id=r.job_id
  order by (outcome<>'delivery_outcome_unknown') desc,server_received_at desc,operation_id desc limit 1;
 return jsonb_build_object('schema','custodial.native-location-outcome-status.v1','binding',expected,'dispatch_authorized',false,
  'provider_outcome',coalesce(o.outcome,'prepared'),'evidence',o.evidence,'server_received_at',public.custodial_native_location_utc(o.server_received_at));
end $fn$;

-- Frozen candidate IDs additionally prevent a new arrival from entering an old
-- scan even if its timestamp sorts below the ceiling. Capacity failure is an
-- explicit retryable failure, never a truncated successful scan.
create table public.employee_native_location_inventory_scans (
 scan_id uuid primary key,credential_id uuid not null references public.device_auth_credentials(credential_id),
 employee_id uuid not null references public.employees(id),device_identifier text not null,
 assignment_epoch bigint not null check(assignment_epoch between 1 and 9007199254740991),
 principal_digest text not null check(principal_digest ~ '^[0-9a-f]{64}$'),
 generation_ids jsonb not null check(jsonb_typeof(generation_ids)='array' and jsonb_array_length(generation_ids) between 1 and 32),
 server_now timestamptz not null check(isfinite(server_now)),ceiling jsonb not null,
 candidate_jobs uuid[] not null check(cardinality(candidate_jobs)<=4096),
 first_native_request_id uuid not null,first_attestation_digest text not null check(first_attestation_digest ~ '^[0-9a-f]{64}$')
);
create index native_location_scan_credential on public.employee_native_location_inventory_scans(credential_id);
create index native_location_scan_employee on public.employee_native_location_inventory_scans(employee_id);
create trigger trg_native_location_scan_immutable before update or delete on public.employee_native_location_inventory_scans
 for each row execute function public.custodial_native_location_append_only();
alter table public.employee_native_location_inventory_scans enable always trigger trg_native_location_scan_immutable;

create function public.custodial_native_location_tuple(p_tuple jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $fn$
begin
 if p_tuple='null'::jsonb then return true;end if;
 if jsonb_typeof(p_tuple) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_tuple) key) is distinct from array['job_id','reservation_at']
  or jsonb_typeof(p_tuple->'job_id') is distinct from 'string' or p_tuple->>'job_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_tuple->'reservation_at') is distinct from 'string'
  or p_tuple->>'reservation_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
 then return false;end if;
 return public.custodial_native_location_utc((p_tuple->>'reservation_at')::timestamptz)=p_tuple->>'reservation_at';
exception when others then return false;
end $fn$;

create function public.custodial_native_location_inventory_rows(p_credential uuid,p_principal text,p_generations jsonb,p_at timestamptz)
returns table(job_id uuid,reservation_at timestamptz,payload jsonb,provider_outcome text)
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select r.job_id,r.prepared_at,r.native_payload,coalesce(o.outcome,'prepared')
 from public.employee_native_push_delivery_receipts r
 join public.employee_native_push_generations g on g.generation_id=r.native_generation_id
 left join lateral(select outcome from public.employee_native_location_outcomes x where x.job_id=r.job_id
  order by (x.outcome<>'delivery_outcome_unknown') desc,x.server_received_at desc,x.operation_id desc limit 1) o on true
 where r.credential_id=p_credential and g.credential_id=p_credential and g.principal_digest=p_principal
  and p_generations ? g.generation_id::text and g.revoked_at is null
  and g.registration_id=r.registration_id and g.token_digest=r.token_hash and g.assignment_epoch=r.assignment_epoch
  and r.native_payload->>'receipt_employee_id'=g.employee_id::text
  and r.native_payload->>'receipt_device_id'=g.device_identifier and r.native_payload->>'principal_digest'=g.principal_digest
  and r.prepared_at>=g.activated_at and (g.dispatch_retired_at is null or r.prepared_at<=g.dispatch_retired_at)
  and r.native_valid_until>p_at and coalesce(o.outcome,'prepared')<>'known_nonacceptance'
  and public.custodial_native_location_live(r.job_id,r.native_payload,p_at) is true;
$fn$;

create function public.custodial_native_location_inventory_at(p_credential uuid,p_credential_hash text,
 p_native_request uuid,p_attestation_digest text,p_body jsonb,p_test_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare d public.devices%rowtype;c public.device_auth_credentials%rowtype;g public.employee_native_push_generations%rowtype;
 scan public.employee_native_location_inventory_scans%rowtype;at_time timestamptz;sid uuid;ids uuid[];field text;
 bound jsonb;cursor_value jsonb;rows_value jsonb:='[]'::jsonb;entry record;count_rows integer:=0;has_more boolean:=false;result jsonb;
begin
 perform public.custodial_begin_application_mutation();
 if p_credential is null or p_native_request is null or coalesce(p_credential_hash,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_attestation_digest,'') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>65536
  or (select array_agg(key order by key) from jsonb_object_keys(p_body) key) is distinct from
   array['assignment_epoch','ceiling','credential_id','cursor','device_id','employee_id','generation_ids','limit','principal_digest','scan_id','schema','server_now']
  or p_body->>'schema' is distinct from 'custodial.native-provider-inventory-request.v1'
  or p_body->>'credential_id' is distinct from p_credential::text or p_body->'limit' is distinct from '32'::jsonb
  or jsonb_typeof(p_body->'assignment_epoch') is distinct from 'number' or coalesce(p_body->>'assignment_epoch','') !~ '^[1-9][0-9]{0,15}$'
  or (p_body->>'assignment_epoch')::numeric>9007199254740991
  or coalesce(p_body->>'principal_digest','') !~ '^[0-9a-f]{64}$' or coalesce(p_body->>'scan_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_body->'generation_ids') is distinct from 'array' or jsonb_array_length(p_body->'generation_ids') not between 1 and 32
  or public.custodial_native_location_tuple(p_body->'cursor') is not true or public.custodial_native_location_tuple(p_body->'ceiling') is not true
 then raise exception 'exact bounded native inventory request required' using errcode='22023';end if;
 foreach field in array array['schema','credential_id','device_id','employee_id','principal_digest','scan_id'] loop
  if jsonb_typeof(p_body->field) is distinct from 'string' then raise exception 'inventory string required' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_body->'generation_ids') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  or (select count(distinct x) from jsonb_array_elements(p_body->'generation_ids') x)<>jsonb_array_length(p_body->'generation_ids')
 then raise exception 'exact unique native generations required' using errcode='22023';end if;
 sid:=(p_body->>'scan_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id where c0.credential_id=p_credential for update of d0;
 select * into c from public.device_auth_credentials where credential_id=p_credential for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 perform 1 from public.employee_native_push_generations where generation_id in(select x::uuid from jsonb_array_elements_text(p_body->'generation_ids') x) order by generation_id for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or d.id is null or d.active is not true or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or c.token_hash is distinct from p_credential_hash or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or d.device_id is distinct from p_body->>'device_id' or d.assigned_employee_id::text is distinct from p_body->>'employee_id'
  or d.assignment_epoch::text is distinct from p_body->>'assignment_epoch'
  or not exists(select 1 from public.employees where id=d.assigned_employee_id and active and employee_code ~ '^EMP[0-9]+$') then
  raise exception 'current inventory credential required' using errcode='42501';end if;
 for field in select jsonb_array_elements_text(p_body->'generation_ids') loop
  select * into g from public.employee_native_push_generations where generation_id=field::uuid;
  if g.generation_id is null or g.credential_id is distinct from c.credential_id or g.device_id is distinct from d.id
   or g.device_identifier is distinct from d.device_id or g.employee_id is distinct from d.assigned_employee_id
   or g.assignment_epoch is distinct from d.assignment_epoch or g.principal_digest is distinct from p_body->>'principal_digest'
   or g.revoked_at is not null or g.activated_at>at_time then raise exception 'current exact inventory generations required' using errcode='42501';end if;
 end loop;
 select * into scan from public.employee_native_location_inventory_scans where scan_id=sid;
 if scan.scan_id is null then
  if p_body->'cursor'<>'null'::jsonb or p_body->'ceiling'<>'null'::jsonb or p_body->'server_now'<>'null'::jsonb then
   return jsonb_build_object('ok',false,'error','custodial_native_provider_cursor_invalid','schema','custodial.native-provider-inventory-restart.v1',
    'scan_id',sid::text,'principal_digest',p_body->>'principal_digest','cursor',p_body->'cursor','ceiling',p_body->'ceiling',
    'server_now',p_body->'server_now','generation_ids',p_body->'generation_ids');end if;
  select coalesce(array_agg(x.job_id order by x.reservation_at,x.job_id),'{}'::uuid[]) into ids from (
   select * from public.custodial_native_location_inventory_rows(p_credential,p_body->>'principal_digest',p_body->'generation_ids',at_time)
    where reservation_at<=at_time order by reservation_at,job_id limit 4097) x;
  if cardinality(ids)>4096 then raise exception 'inventory bounded snapshot capacity pending';end if;
  bound:='null'::jsonb;
  if cardinality(ids)>0 then select jsonb_build_object('reservation_at',public.custodial_native_location_utc(prepared_at),'job_id',job_id::text)
   into bound from public.employee_native_push_delivery_receipts where job_id=ids[cardinality(ids)];end if;
  insert into public.employee_native_location_inventory_scans(scan_id,credential_id,employee_id,device_identifier,assignment_epoch,principal_digest,
   generation_ids,server_now,ceiling,candidate_jobs,first_native_request_id,first_attestation_digest)
   values(sid,p_credential,d.assigned_employee_id,d.device_id,d.assignment_epoch,p_body->>'principal_digest',p_body->'generation_ids',at_time,bound,ids,p_native_request,p_attestation_digest)
   returning * into scan;
 else
  if scan.credential_id<>p_credential or scan.employee_id<>d.assigned_employee_id or scan.device_identifier<>d.device_id
   or scan.assignment_epoch<>d.assignment_epoch or scan.principal_digest<>p_body->>'principal_digest' or scan.generation_ids<>p_body->'generation_ids'
   then raise exception 'inventory scan original principal conflict' using errcode='23505';end if;
 end if;
 -- Initial response-loss retry may carry all NULL bounds for this same scan.
 if not(p_body->'cursor'='null'::jsonb and p_body->'ceiling'='null'::jsonb and p_body->'server_now'='null'::jsonb) then
  if p_body->'ceiling' is distinct from scan.ceiling
   or p_body->'server_now' is distinct from to_jsonb(public.custodial_native_location_utc(scan.server_now))
   or (p_body->'cursor'<>'null'::jsonb and not exists(select 1 from public.employee_native_push_delivery_receipts r
    where r.job_id=any(scan.candidate_jobs) and r.job_id::text=p_body#>>'{cursor,job_id}'
     and public.custodial_native_location_utc(r.prepared_at)=p_body#>>'{cursor,reservation_at}')) then
   return jsonb_build_object('ok',false,'error','custodial_native_provider_cursor_invalid','schema','custodial.native-provider-inventory-restart.v1',
    'scan_id',sid::text,'principal_digest',p_body->>'principal_digest','cursor',p_body->'cursor','ceiling',p_body->'ceiling',
    'server_now',p_body->'server_now','generation_ids',p_body->'generation_ids');end if;
 end if;
 cursor_value:=p_body->'cursor';
 for entry in select x.* from public.custodial_native_location_inventory_rows(p_credential,scan.principal_digest,scan.generation_ids,at_time) x
  where x.job_id=any(scan.candidate_jobs)
   and (p_body->'cursor'='null'::jsonb or (x.reservation_at,x.job_id)>((p_body#>>'{cursor,reservation_at}')::timestamptz,(p_body#>>'{cursor,job_id}')::uuid))
  order by x.reservation_at,x.job_id limit 33 loop
  if count_rows=32 then has_more:=true;exit;end if;
  count_rows:=count_rows+1;rows_value:=rows_value||jsonb_build_array(jsonb_build_object('payload',entry.payload,'provider_outcome',entry.provider_outcome));
  cursor_value:=jsonb_build_object('reservation_at',public.custodial_native_location_utc(entry.reservation_at),'job_id',entry.job_id::text);
 end loop;
 result:=jsonb_build_object('ok',true,'data',jsonb_build_object('schema','custodial.native-provider-inventory.v1','scan_id',sid::text,
  'principal_digest',scan.principal_digest,'device_id',scan.device_identifier,'credential_id',scan.credential_id::text,'employee_id',scan.employee_id::text,
  'assignment_epoch',scan.assignment_epoch,'generation_ids',scan.generation_ids,'cursor',cursor_value,'ceiling',scan.ceiling,
  'server_now',public.custodial_native_location_utc(scan.server_now),'has_more',has_more,'rows',rows_value));
 if octet_length(result::text)>262144 then raise exception 'inventory bounded response pending';end if;
 return result;
end $fn$;
create function public.custodial_native_location_inventory(p_credential uuid,p_credential_hash text,p_native_request uuid,p_attestation_digest text,p_body jsonb)
returns jsonb language sql volatile security definer set search_path=pg_catalog,public as $fn$
 select public.custodial_native_location_inventory_at(p_credential,p_credential_hash,p_native_request,p_attestation_digest,p_body,null);
$fn$;

do $acl$ declare rel text;f regprocedure;begin
 foreach rel in array array['public.employee_native_location_outcomes','public.employee_native_location_inventory_scans'] loop
  execute 'alter table '||rel||' enable row level security';execute 'alter table '||rel||' force row level security';
  execute 'revoke all on table '||rel||' from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823';
  if not exists(select 1 from pg_trigger where tgrelid=rel::regclass and tgname='custodial_disaster_restore_mutation_fence' and tgenabled='O') then
   raise exception 'new native lifecycle restore mutation fence missing: %',rel;end if;
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
  ('custodial_native_location_utc','custodial_native_location_live','custodial_native_location_target_at','custodial_native_location_target',
   'custodial_native_location_append_only','custodial_native_location_outcome_at','custodial_native_location_outcome','custodial_native_location_outcome_status','custodial_native_location_tuple',
   'custodial_native_location_inventory_rows','custodial_native_location_inventory_at','custodial_native_location_inventory') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823',f);
 end loop;
end $acl$;
grant execute on function public.custodial_native_location_target(uuid,uuid),public.custodial_native_location_outcome(jsonb,jsonb),
 public.custodial_native_location_outcome_status(jsonb),public.custodial_native_location_inventory(uuid,text,uuid,text,jsonb) to service_role;

-- Only the exact new lifecycle objects and changed private reservation function.
-- Parent owns the explicit final combined canary20261003020000.
lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;changed integer;begin
 for obj in with funcs as (
  select p.oid,p.proname,case p.proname
   when 'custodial_native_location_utc' then 0 when 'custodial_native_location_append_only' then 1
   when 'custodial_native_location_tuple' then 2 when 'custodial_native_location_live' then 3
   when 'custodial_native_location_target_at' then 4 when 'custodial_native_location_target' then 5
   when 'custodial_native_location_outcome_at' then 6 when 'custodial_native_location_outcome' then 7 when 'custodial_native_location_inventory_rows' then 8
   when 'custodial_native_location_inventory_at' then 9 when 'custodial_native_location_inventory' then 10 else 11 end rank
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
  ('custodial_native_location_utc','custodial_native_location_live','custodial_native_location_target_at','custodial_native_location_target',
   'custodial_native_location_append_only','custodial_native_location_outcome_at','custodial_native_location_outcome','custodial_native_location_outcome_status','custodial_native_location_tuple',
   'custodial_native_location_inventory_rows','custodial_native_location_inventory_at','custodial_native_location_inventory','custodial_native_location_reserve_at')
 ),objects as (
  select 100000 bucket,rank,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,rank,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
  union all select x.bucket,0,x.kind,x.identity,x.definition from
   unnest(array['public.employee_native_location_outcomes','public.employee_native_location_inventory_scans']) rel cross join lateral (
    select 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
    union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
     from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
    union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
    union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
    union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
     from pg_constraint where conrelid=rel::regclass
    union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
     from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
    union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
     ||pg_get_triggerdef(oid,true)||'; alter table '||rel||case when tgenabled='A' then ' enable always trigger ' else ' enable trigger ' end||quote_ident(tgname)||';'
     from pg_trigger where tgrelid=rel::regclass and not tgisinternal
    union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)
   ) x
 ) select * from objects order by bucket,rank,identity loop
  if obj.definition is null then raise exception 'missing native lifecycle recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  get diagnostics changed=row_count;
  if changed>1 then raise exception 'duplicate native lifecycle recovery object %',obj.identity;end if;
  if changed=0 then
   select n into next_order from generate_series(obj.bucket+1,case when obj.bucket=1000 then 99998 else obj.bucket+99998 end) n
    where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if next_order is null then raise exception 'native lifecycle recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
