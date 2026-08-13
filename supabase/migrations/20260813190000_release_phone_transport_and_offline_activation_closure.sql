begin;

-- A release resume is valid only after the designated phone has crossed the
-- real native-vault /scan-api/rpc path on the currently deployed backend.
create table public.custodial_release_canary_transport_probes (
  probe_id uuid primary key default gen_random_uuid(),
  device_identifier text not null references public.custodial_release_canary_controls(device_identifier) on delete restrict,
  credential_id uuid not null references public.device_auth_credentials(credential_id) on delete restrict,
  control_updated_at timestamptz not null,
  observed_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  backend_commit_sha text not null check (backend_commit_sha ~ '^[0-9a-f]{40}$'),
  release_id text not null check (length(btrim(release_id)) between 1 and 200),
  native_origin text not null check (native_origin in ('https://localhost','http://localhost','capacitor://localhost','ionic://localhost')),
  app_edition text not null check (app_edition='custodial'),
  route_path text not null default '/scan-api/rpc' check (route_path='/scan-api/rpc'),
  probe_function text not null default 'tool_get_system_settings' check (probe_function='tool_get_system_settings'),
  passed boolean not null default true check (passed),
  check (expires_at>observed_at and expires_at<=observed_at+interval '5 minutes')
);

alter table public.custodial_release_canary_controls
  add column last_transport_probe_id uuid references public.custodial_release_canary_transport_probes(probe_id) on delete restrict;

create or replace function public.custodial_record_release_canary_transport_probe(
  p_device_identifier text,p_credential_id uuid,p_request_sha256 text,
  p_backend_commit_sha text,p_release_id text,p_native_origin text,p_app_edition text,
  p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_device text:=upper(btrim(coalesce(p_device_identifier,'')));
  v_control public.custodial_release_canary_controls%rowtype;
  v_probe public.custodial_release_canary_transport_probes%rowtype;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_device !~ '^KIOSK_(0[2-9]|10)$' or p_credential_id is null
     or lower(btrim(coalesce(p_request_sha256,''))) !~ '^[0-9a-f]{64}$'
     or lower(btrim(coalesce(p_backend_commit_sha,''))) !~ '^[0-9a-f]{40}$'
     or length(btrim(coalesce(p_release_id,''))) not between 1 and 200
     or btrim(coalesce(p_native_origin,'')) not in ('https://localhost','http://localhost','capacitor://localhost','ionic://localhost')
     or lower(btrim(coalesce(p_app_edition,'')))<>'custodial' then
    raise exception using errcode='22023',message='exact native canary transport evidence is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-release-canary:'||v_device,0));
  select * into v_control from public.custodial_release_canary_controls
   where device_identifier=v_device for update;
  if v_control.device_identifier is null or not v_control.paused then
    raise exception using errcode='55000',message='the exact release canary must remain paused while phone transport is proven';
  end if;
  if not exists(
    select 1 from public.device_auth_credentials c join public.devices d on d.id=c.device_id
    where c.credential_id=p_credential_id and c.confirmed_at is not null and c.revoked_at is null
      and c.expires_at>statement_timestamp() and d.active=true and upper(btrim(d.device_id))=v_device
  ) then
    raise exception using errcode='42501',message='a current credential for the exact physical canary is required';
  end if;
  insert into public.custodial_release_canary_transport_probes(
    device_identifier,credential_id,control_updated_at,expires_at,request_sha256,
    backend_commit_sha,release_id,native_origin,app_edition
  ) values(
    v_device,p_credential_id,v_control.updated_at,statement_timestamp()+interval '5 minutes',
    lower(btrim(p_request_sha256)),lower(btrim(p_backend_commit_sha)),btrim(p_release_id),
    btrim(p_native_origin),lower(btrim(p_app_edition))
  ) returning * into v_probe;
  return jsonb_build_object(
    'probe_id',v_probe.probe_id,'device_identifier',v_device,'observed_at',v_probe.observed_at,
    'expires_at',v_probe.expires_at,'backend_commit_sha',v_probe.backend_commit_sha,
    'release_id',v_probe.release_id,'route_path',v_probe.route_path,
    'probe_function',v_probe.probe_function,'ready',v_probe.expires_at>statement_timestamp()
  );
end
$function$;

create or replace function public.custodial_get_release_canary_transport_probe_health(
  p_device_identifier text,p_backend_commit_sha text,p_release_id text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
  v_device text:=upper(btrim(coalesce(p_device_identifier,'')));
  v_control public.custodial_release_canary_controls%rowtype;
  v_probe public.custodial_release_canary_transport_probes%rowtype;
  v_ready boolean:=false;
  v_reason text:='phone_transport_probe_missing';
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_device !~ '^KIOSK_(0[2-9]|10)$'
     or lower(btrim(coalesce(p_backend_commit_sha,''))) !~ '^[0-9a-f]{40}$'
     or length(btrim(coalesce(p_release_id,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='exact canary and deployed release identity are required';
  end if;
  select * into v_control from public.custodial_release_canary_controls where device_identifier=v_device;
  if v_control.device_identifier is null then
    return jsonb_build_object('ready',false,'configured',false,'device_identifier',v_device,'reason','canary_control_not_initialized');
  end if;
  if v_control.paused then
    select p.* into v_probe from public.custodial_release_canary_transport_probes p
    join public.device_auth_credentials c on c.credential_id=p.credential_id
    join public.devices d on d.id=c.device_id
    where p.device_identifier=v_device and p.control_updated_at=v_control.updated_at
      and p.backend_commit_sha=lower(btrim(p_backend_commit_sha)) and p.release_id=btrim(p_release_id)
      and p.passed and p.expires_at>statement_timestamp() and p.observed_at>=v_control.updated_at
      and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp()
      and d.active=true and upper(btrim(d.device_id))=v_device
    order by p.observed_at desc,p.probe_id desc limit 1;
    if v_probe.probe_id is not null then v_ready:=true; v_reason:='fresh_paused_phone_probe'; end if;
  elsif v_control.last_transport_probe_id is not null then
    select p.* into v_probe from public.custodial_release_canary_transport_probes p
    join public.device_auth_credentials c on c.credential_id=p.credential_id
    join public.devices d on d.id=c.device_id
    where p.probe_id=v_control.last_transport_probe_id and p.device_identifier=v_device
      and p.backend_commit_sha=lower(btrim(p_backend_commit_sha)) and p.release_id=btrim(p_release_id)
      and p.passed and c.confirmed_at is not null and c.revoked_at is null
      and c.expires_at>statement_timestamp() and d.active=true and upper(btrim(d.device_id))=v_device;
    if v_probe.probe_id is not null then v_ready:=true; v_reason:='resume_bound_phone_probe'; end if;
  end if;
  return jsonb_build_object(
    'ready',v_ready,'configured',true,'device_identifier',v_device,'canary_paused',v_control.paused,
    'reason',v_reason,'probe_id',v_probe.probe_id,'credential_id',v_probe.credential_id,
    'observed_at',v_probe.observed_at,'expires_at',v_probe.expires_at,
    'backend_commit_sha',v_probe.backend_commit_sha,'release_id',v_probe.release_id,
    'route_path',v_probe.route_path,'probe_function',v_probe.probe_function
  );
end
$function$;

-- A revoked or expired token remains useful only as cryptographic proof for
-- work whose client start predates both credential invalidation and any later
-- employee assignment. New work with stale authority remains rejected.
create or replace function public.custodial_start_offline_occurrence(
  p_device_id text,p_location_code text,p_client_session_id text,p_client_started_at text,
  p_snapshot_id text,p_snapshot_employee_id text,p_snapshot_assignment_epoch integer,
  p_snapshot_credential_id text,p_authenticated_credential_id text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_client_session_id text:=nullif(btrim(coalesce(p_client_session_id,'')), ''); v_started_at timestamptz;
  v_credential_id uuid; v_snapshot_employee_id uuid; v_snapshot_credential_id uuid;
  v_snapshot public.custodial_offline_scan_authority_snapshots%rowtype;
  v_existing public.custodial_offline_actor_contexts%rowtype; v_proof public.custodial_offline_submission_proofs%rowtype;
  v_device record; v_location record; v_assignment_change_id uuid; v_context public.custodial_offline_actor_contexts%rowtype;
  v_proof_value text:=encode(extensions.gen_random_bytes(32),'hex'); v_fingerprint text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id)>200 then raise exception using errcode='22023',message='client_session_id is required for offline occurrence activation'; end if;
  begin
    v_started_at:=nullif(btrim(coalesce(p_client_started_at,'')),'')::timestamptz;
    v_credential_id:=nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))),'')::uuid;
    v_snapshot_employee_id:=nullif(lower(btrim(coalesce(p_snapshot_employee_id,''))),'')::uuid;
    v_snapshot_credential_id:=nullif(lower(btrim(coalesce(p_snapshot_credential_id,''))),'')::uuid;
  exception when others then raise exception using errcode='22023',message='offline activation requires canonical snapshot identity and credential'; end;
  if nullif(lower(btrim(coalesce(p_snapshot_id,''))),'') !~ '^[0-9a-f]{64}$' or p_snapshot_assignment_epoch is null
     or v_snapshot_credential_id<>v_credential_id then raise exception using errcode='22023',message='exact authenticated snapshot identity is required for offline occurrence activation'; end if;
  if not isfinite(v_started_at) or v_started_at>now()+interval '10 minutes' or v_started_at<now()-interval '7 days' then raise exception using errcode='22023',message='offline occurrence start timestamp is outside the accepted window'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-activation:'||v_client_session_id,0));
  select * into v_existing from public.custodial_offline_actor_contexts where client_session_id=v_client_session_id for update;
  if v_existing.context_id is not null then
    if upper(btrim(coalesce(p_device_id,'')))<>upper((select device_id from public.devices where id=v_existing.device_id))
       or v_existing.credential_id<>v_credential_id or v_existing.canonical_location_code<>public.resolve_scan_location_code(p_location_code)
       or v_existing.started_at<>v_started_at or v_existing.snapshot_id<>lower(btrim(p_snapshot_id))
       or v_existing.snapshot_employee_id<>v_snapshot_employee_id or v_existing.snapshot_assignment_epoch<>p_snapshot_assignment_epoch
       or v_existing.snapshot_credential_id<>v_snapshot_credential_id then raise exception using errcode='23505',message='offline occurrence activation replay does not match the original frozen snapshot'; end if;
    select * into v_proof from public.custodial_offline_submission_proofs where context_id=v_existing.context_id for update;
    if v_proof.state='issued' and v_proof.issued_submission_proof is not null then
      return jsonb_build_object('context_id',v_existing.context_id,'occurrence_id',v_existing.occurrence_id,'client_session_id',v_existing.client_session_id,
        'canonical_location_code',v_existing.canonical_location_code,'location_aliases',v_existing.location_aliases,'started_at',v_existing.started_at,
        'employee_id',v_existing.employee_id,'assignment_epoch',v_existing.assignment_epoch,'submission_proof',v_proof.issued_submission_proof,
        'expires_at',v_existing.expires_at,'snapshot_id',v_existing.snapshot_id,'schema_version','offline-authority.v4',
        'committable',true,'replayed',true,'frozen_actor',true);
    end if;
    raise exception using errcode='40901',message='the frozen occurrence cannot recover a completion proof; create a manager-visible recovery disposition';
  end if;
  select * into v_snapshot from public.custodial_offline_scan_authority_snapshots where snapshot_id=lower(btrim(p_snapshot_id)) for share;
  if v_snapshot.snapshot_id is null or v_snapshot.employee_id<>v_snapshot_employee_id or v_snapshot.assignment_epoch<>p_snapshot_assignment_epoch
     or v_snapshot.credential_id<>v_snapshot_credential_id or v_started_at>=v_snapshot.expires_at
     or v_started_at<v_snapshot.generated_at-interval '10 minutes' then
    raise exception using errcode='42501',message='issued offline authority snapshot was not valid when the occurrence began';
  end if;
  select d.id,d.device_id,c.confirmed_at,c.revoked_at,c.expires_at into v_device
    from public.devices d join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id
   where upper(btrim(d.device_id))=upper(btrim(coalesce(p_device_id,''))) and d.active=true for update of d;
  if v_device.id is null or v_device.id<>v_snapshot.device_id or v_device.confirmed_at is null
     or v_device.confirmed_at>v_snapshot.generated_at
     or v_started_at<v_device.confirmed_at-interval '10 minutes'
     or v_started_at>=v_device.expires_at or (v_device.revoked_at is not null and v_started_at>=v_device.revoked_at) then
    raise exception using errcode='42501',message='the device credential was not valid when the offline occurrence began';
  end if;
  if exists(
    select 1 from public.custodial_employee_device_assignment_history h
    where h.device_id=v_snapshot.device_id and h.changed_at>v_snapshot.generated_at and h.changed_at<=v_started_at
  ) then raise exception using errcode='42501',message='the issued offline snapshot no longer owned the phone when the occurrence began'; end if;
  select l.id,l.location_code,jsonb_build_array(l.location_code,upper(btrim(p_location_code))) aliases into v_location
    from public.locations l where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true;
  if v_location.id is null or not exists(select 1 from jsonb_array_elements(v_snapshot.locations_json) x where x->>'location_code'=v_location.location_code) then raise exception using errcode='22023',message='active location is not authorized by the issued offline snapshot'; end if;
  select h.assignment_change_id into v_assignment_change_id from public.custodial_employee_device_assignment_history h
   where h.device_id=v_snapshot.device_id and h.new_employee_id=v_snapshot.employee_id and h.changed_at<=v_snapshot.generated_at
   order by h.changed_at desc limit 1;
  if v_assignment_change_id is null then raise exception using errcode='42501',message='an authoritative device assignment epoch is required for offline occurrence activation'; end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('client_session_id',v_client_session_id,'device_id',v_snapshot.device_id::text,
    'employee_id',v_snapshot.employee_id::text,'credential_id',v_credential_id::text,'assignment_epoch',v_snapshot.assignment_epoch,
    'snapshot_id',v_snapshot.snapshot_id,'snapshot_employee_id',v_snapshot.employee_id::text,'snapshot_assignment_epoch',v_snapshot.assignment_epoch,
    'snapshot_credential_id',v_snapshot.credential_id::text,'assignment_change_id',v_assignment_change_id::text,'location_id',v_location.id::text,
    'location_code',v_location.location_code,'location_aliases',v_location.aliases,'started_at',v_started_at)::text,'UTF8'),'sha256'),'hex');
  insert into public.custodial_offline_actor_contexts(client_session_id,device_id,employee_id,credential_id,assignment_epoch,assignment_change_id,location_id,canonical_location_code,location_aliases,started_at,occurrence_fingerprint,expires_at,snapshot_id,snapshot_employee_id,snapshot_assignment_epoch,snapshot_credential_id)
  values(v_client_session_id,v_snapshot.device_id,v_snapshot.employee_id,v_credential_id,v_snapshot.assignment_epoch,v_assignment_change_id,v_location.id,v_location.location_code,v_location.aliases,v_started_at,v_fingerprint,now()+interval '7 days',v_snapshot.snapshot_id,v_snapshot.employee_id,v_snapshot.assignment_epoch,v_snapshot.credential_id) returning * into v_context;
  insert into public.custodial_offline_submission_proofs(context_id,proof_digest,issued_submission_proof) values(v_context.context_id,encode(extensions.digest(convert_to(v_proof_value,'UTF8'),'sha256'),'hex'),v_proof_value);
  return jsonb_build_object('context_id',v_context.context_id,'occurrence_id',v_context.occurrence_id,'client_session_id',v_context.client_session_id,
    'canonical_location_code',v_context.canonical_location_code,'location_aliases',v_context.location_aliases,'started_at',v_context.started_at,
    'employee_id',v_context.employee_id,'assignment_epoch',v_context.assignment_epoch,'submission_proof',v_proof_value,'expires_at',v_context.expires_at,
    'snapshot_id',v_snapshot.snapshot_id,'schema_version','offline-authority.v4','committable',true,'replayed',false,'frozen_actor',true);
end
$function$;

update public.custodial_release_authority_restore_definitions
set function_definition=pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where function_identity='public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)';

insert into public.custodial_release_authority_restore_definitions(restore_order,function_identity,function_definition,definition_sha256)
select v.restore_order,v.function_identity,pg_get_functiondef(to_regprocedure(v.function_identity)),
  encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(v.function_identity)),'UTF8'),'sha256'),'hex')
from (values
  (8,'public.custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,text)'),
  (9,'public.custodial_get_release_canary_transport_probe_health(text,text,text,text)')
) v(restore_order,function_identity);

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_expected integer; v_missing text[]; v_mismatched text[]; v_checks jsonb; v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select count(*) into v_expected from public.custodial_release_authority_restore_definitions;
  select array_agg(d.function_identity order by d.restore_order) into v_missing from public.custodial_release_authority_restore_definitions d where to_regprocedure(d.function_identity) is null;
  select array_agg(d.function_identity order by d.restore_order) into v_mismatched from public.custodial_release_authority_restore_definitions d
   where to_regprocedure(d.function_identity) is not null and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(d.function_identity)),'UTF8'),'sha256'),'hex')<>d.definition_sha256;
  v_checks:=jsonb_build_object(
    'restore_set_complete',v_expected=9,
    'canonical_functions_present',coalesce(cardinality(v_missing),0)=0,
    'canonical_functions_exact',coalesce(cardinality(v_mismatched),0)=0,
    'authority_ledgers_present',to_regclass('public.custodial_offline_actor_contexts') is not null
      and to_regclass('public.custodial_offline_submission_proofs') is not null
      and to_regclass('public.custodial_offline_scan_authority_snapshots') is not null
      and to_regclass('public.custodial_offline_reconciliation_records') is not null
      and to_regclass('public.custodial_offline_scan_event_evidence') is not null
      and to_regclass('public.custodial_offline_time_reservations') is not null
      and to_regclass('public.custodial_offline_reconciliation_outbox') is not null,
    'snapshot_constraint_validated',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass
      and conname='custodial_offline_actor_contexts_snapshot_identity_check' and convalidated),
    'completion_replay_unique',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_reconciliation_records'::regclass
      and conname='uq_custodial_offline_reconciliation_completion' and contype='u' and convalidated),
    'time_overlap_exclusions_validated',(select count(*)=2 from pg_constraint where conrelid='public.custodial_offline_time_reservations'::regclass
      and conname in ('custodial_offline_employee_time_no_overlap','custodial_offline_device_time_no_overlap') and contype='x' and convalidated),
    'evidence_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_offline_actor_contexts','insert')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','update')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','delete')
      or has_table_privilege('service_role','public.custodial_offline_actor_contexts','truncate')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','insert')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','update')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','delete')
      or has_table_privilege('service_role','public.custodial_offline_submission_proofs','truncate')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','insert')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','update')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','delete')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','truncate')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','insert')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','update')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','delete')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','truncate')
    ),
    'alternate_terminal_writers_absent',not exists(select 1 from public.custodial_terminal_writer_inventory
      where application_callable and (mutates_terminal_truth or delegates_alternate_terminal_authority)
        and proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative')),
    'named_manager_messaging_ready',to_regclass('public.ops_manager_managers') is not null
      and to_regprocedure('public.msg_ensure_ops_manager_user(uuid)') is not null,
    'operational_service_date_boundary',public.sch_service_date('2026-08-13 03:59:59-05'::timestamptz)=date '2026-08-12'
      and public.sch_service_date('2026-08-13 04:00:00-05'::timestamptz)=date '2026-08-13',
    'phone_transport_receipt_ledger',to_regclass('public.custodial_release_canary_transport_probes') is not null
      and exists(select 1 from pg_class c where c.oid='public.custodial_release_canary_transport_probes'::regclass and c.relrowsecurity and c.relforcerowsecurity),
    'phone_transport_receipt_immutable',exists(select 1 from pg_trigger where tgrelid='public.custodial_release_canary_transport_probes'::regclass
      and tgname='trg_custodial_release_canary_transport_probes_immutable' and tgenabled<>'D'),
    'phone_transport_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_release_canary_transport_probes','insert')
      or has_table_privilege('service_role','public.custodial_release_canary_transport_probes','update')
      or has_table_privilege('service_role','public.custodial_release_canary_transport_probes','delete')
      or has_table_privilege('service_role','public.custodial_release_canary_transport_probes','truncate')
    ),
    'phone_transport_resume_binding',exists(select 1 from information_schema.columns where table_schema='public' and table_name='custodial_release_canary_controls' and column_name='last_transport_probe_id')
  );
  select bool_and(value::boolean) into v_ok from jsonb_each_text(v_checks);
  return jsonb_build_object(
    'ok',coalesce(v_ok,false),
    'authority','offline-authority.v4','phase','release-phone-transport-and-offline-activation-closure','configured',true,
    'canonical_functions_expected',9,'canonical_functions_verified',v_expected-coalesce(cardinality(v_missing),0)-coalesce(cardinality(v_mismatched),0),
    'missing_functions',to_jsonb(coalesce(v_missing,array[]::text[])),'mismatched_functions',to_jsonb(coalesce(v_mismatched,array[]::text[])),
    'issued_snapshot_ledger',true,'frozen_exact_replay',true,'operational_day_location_truth',true,'checks',v_checks);
end
$function$;

update public.custodial_release_authority_restore_definitions
set function_definition=pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure),'UTF8'),'sha256'),'hex'),
    captured_at=statement_timestamp()
where function_identity='public.custodial_backend_authority_health(text)';

create or replace function public.custodial_control_release_canary(
  p_manager_id uuid,p_request_id uuid,p_device_identifier text,p_action text,
  p_reason text,p_authoritative_health jsonb,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_existing public.custodial_release_canary_rollback_audits%rowtype;
  v_definition public.custodial_release_authority_restore_definitions%rowtype;
  v_device text:=upper(btrim(coalesce(p_device_identifier,''))); v_result jsonb;
  v_current_health jsonb; v_transport_health jsonb; v_restored integer:=0;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='named release manager authority is required'; end if;
  if p_request_id is null or v_device !~ '^KIOSK_(0[2-9]|10)$' or p_action not in ('pause_canary','resume_canary','restore_authority')
     or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_authoritative_health)<>'object' then raise exception using errcode='22023',message='stable request, exact canary, supported action, reason, and authority health are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-release-canary:'||v_device,0));
  select * into v_existing from public.custodial_release_canary_rollback_audits where requested_by_manager_id=p_manager_id and request_id=p_request_id for update;
  if found then
    if v_existing.device_identifier<>v_device or v_existing.action<>p_action or v_existing.reason<>btrim(p_reason) or v_existing.authoritative_health<>p_authoritative_health then raise exception using errcode='23505',message='release control request identity is already bound to different inputs'; end if;
    return v_existing.result_json||jsonb_build_object('audit_id',v_existing.audit_id,'replayed',true);
  end if;
  if p_action='pause_canary' then
    insert into public.custodial_release_canary_controls(device_identifier,paused,updated_by_manager_id,reason,last_transport_probe_id)
    values(v_device,true,p_manager_id,btrim(p_reason),null) on conflict(device_identifier) do update set paused=true,updated_at=statement_timestamp(),updated_by_manager_id=excluded.updated_by_manager_id,reason=excluded.reason,last_transport_probe_id=null;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_functions',0);
  elsif p_action='restore_authority' then
    if not coalesce((select paused from public.custodial_release_canary_controls where device_identifier=v_device),false) then raise exception using errcode='55000',message='the exact release canary must be paused before authority restoration'; end if;
    for v_definition in select * from public.custodial_release_authority_restore_definitions order by restore_order loop
      if encode(extensions.digest(convert_to(v_definition.function_definition,'UTF8'),'sha256'),'hex')<>v_definition.definition_sha256 then raise exception using errcode='23514',message='a captured authority restoration definition failed its digest'; end if;
      execute v_definition.function_definition; v_restored:=v_restored+1;
    end loop;
    execute 'drop trigger if exists trg_custodial_release_canary_transport_probes_immutable on public.custodial_release_canary_transport_probes';
    execute 'create trigger trg_custodial_release_canary_transport_probes_immutable before update or delete on public.custodial_release_canary_transport_probes for each row execute function public.static_weekly_reject_update_delete()';
    execute 'alter table public.custodial_release_canary_transport_probes enable row level security';
    execute 'alter table public.custodial_release_canary_transport_probes force row level security';
    execute 'revoke all on table public.custodial_release_canary_transport_probes from public,anon,authenticated,service_role';
    execute 'revoke all on function public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text) from public,anon,authenticated,service_role';
    execute 'revoke all on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_get_offline_scan_authority_snapshot(text,text,text),public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),public.custodial_backend_authority_health(text),public.custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,text),public.custodial_get_release_canary_transport_probe_health(text,text,text,text) from public,anon,authenticated';
    execute 'grant execute on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text),public.tool_get_offline_scan_authority_snapshot(text,text,text),public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),public.custodial_backend_authority_health(text),public.custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,text),public.custodial_get_release_canary_transport_probe_health(text,text,text,text) to postgres,service_role';
    update public.custodial_release_canary_controls set updated_at=statement_timestamp(),updated_by_manager_id=p_manager_id,reason=btrim(p_reason),last_transport_probe_id=null where device_identifier=v_device;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_functions',v_restored);
  else
    v_current_health:=public.custodial_run_release_canary_recovery_probe(v_device,p_backend_execution_secret);
    if v_current_health->>'passed'<>'true' then
      raise exception using errcode='55000',message='the release canary cannot resume until a fresh persisted database recovery probe is green';
    end if;
    if coalesce(p_authoritative_health#>>'{scan_rpc_transport,backend_commit_sha}','') !~ '^[0-9a-f]{40}$'
       or nullif(btrim(coalesce(p_authoritative_health#>>'{scan_rpc_transport,release_id}','')),'') is null
       or coalesce(p_authoritative_health#>>'{scan_rpc_transport,probe_id}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='55000',message='the release canary cannot resume until a fresh exact-phone transport receipt is green';
    end if;
    v_transport_health:=public.custodial_get_release_canary_transport_probe_health(v_device,p_authoritative_health#>>'{scan_rpc_transport,backend_commit_sha}',p_authoritative_health#>>'{scan_rpc_transport,release_id}',p_backend_execution_secret);
    if v_transport_health->>'ready'<>'true'
       or p_authoritative_health->>'ok'<>'true' or p_authoritative_health#>>'{scan_rpc_transport,probe_id}' is distinct from v_transport_health->>'probe_id' then
      raise exception using errcode='55000',message='the release canary cannot resume until database recovery and a fresh exact-phone transport receipt are green';
    end if;
    update public.custodial_release_canary_controls set paused=false,updated_at=statement_timestamp(),updated_by_manager_id=p_manager_id,reason=btrim(p_reason),last_transport_probe_id=(v_transport_health->>'probe_id')::uuid where device_identifier=v_device and paused=true;
    if not found then raise exception using errcode='55000',message='the exact release canary must remain paused until resume commits'; end if;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',false,'restored_functions',0,'verified_authoritative_health',v_current_health,'verified_transport_health',v_transport_health);
  end if;
  insert into public.custodial_release_canary_rollback_audits(requested_by_manager_id,request_id,device_identifier,action,reason,authoritative_health,result_json)
  values(p_manager_id,p_request_id,v_device,p_action,btrim(p_reason),p_authoritative_health,v_result) returning audit_id into v_existing.audit_id;
  return v_result||jsonb_build_object('audit_id',v_existing.audit_id,'replayed',false);
end
$function$;

drop trigger if exists trg_custodial_release_canary_transport_probes_immutable on public.custodial_release_canary_transport_probes;
create trigger trg_custodial_release_canary_transport_probes_immutable before update or delete on public.custodial_release_canary_transport_probes for each row execute function public.static_weekly_reject_update_delete();
alter table public.custodial_release_canary_transport_probes enable row level security;
alter table public.custodial_release_canary_transport_probes force row level security;
revoke all on table public.custodial_release_canary_transport_probes from public,anon,authenticated,service_role;
revoke all on function public.custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,text),public.custodial_get_release_canary_transport_probe_health(text,text,text,text) from public,anon,authenticated;
grant execute on function public.custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,text),public.custodial_get_release_canary_transport_probe_health(text,text,text,text) to postgres,service_role;

commit;
