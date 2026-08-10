begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Phase B: final precedence.  Phase A was additive and can coexist with the
-- accepted legacy flow.  This migration is applied only with a backend that
-- injects CUSTODIAL_BACKEND_PROOF_SECRET and translates both old and new Engine
-- calls to the two authoritative adapters below.
create extension if not exists btree_gist with schema extensions;

create table if not exists public.custodial_offline_reconciliation_records (
  reconciliation_id uuid primary key default gen_random_uuid(),
  context_id uuid references public.custodial_offline_actor_contexts(context_id) on delete restrict,
  occurrence_id uuid,
  occurrence_fingerprint text,
  original_employee_id uuid references public.employees(id) on delete restrict,
  device_id uuid references public.devices(id) on delete restrict,
  credential_id uuid references public.device_auth_credentials(credential_id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  client_session_id text not null check (length(btrim(client_session_id)) between 1 and 200),
  client_completion_id text not null check (length(btrim(client_completion_id)) between 1 and 200),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_json jsonb not null,
  state text not null check (state in ('committed','quarantined')),
  quarantine_reason text,
  result_json jsonb not null,
  session_id uuid references public.sessions(id) on delete restrict,
  completion_response_id uuid references public.completion_responses(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint uq_custodial_offline_reconciliation_completion unique(client_completion_id),
  constraint uq_custodial_offline_reconciliation_session unique(client_session_id),
  check ((state='quarantined') = (quarantine_reason is not null))
);

create table if not exists public.custodial_offline_reconciliation_audits (
  audit_id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.custodial_offline_reconciliation_records(reconciliation_id) on delete restrict,
  event_type text not null check (event_type in ('accepted','quarantined','replayed','payload_fingerprint_conflict','disposition_recorded')),
  actor_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
  reason text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.custodial_offline_scan_event_evidence (
  client_event_id text primary key check (length(btrim(client_event_id)) between 1 and 200),
  context_id uuid not null references public.custodial_offline_actor_contexts(context_id) on delete restrict,
  reconciliation_id uuid not null references public.custodial_offline_reconciliation_records(reconciliation_id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete restrict,
  event_fingerprint text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  event_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.custodial_offline_time_reservations (
  occurrence_id uuid primary key references public.custodial_offline_actor_contexts(occurrence_id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  device_id uuid not null references public.devices(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  occurred_range tstzrange generated always as (tstzrange(started_at, ended_at, '[)')) stored,
  created_at timestamptz not null default now(),
  check (ended_at > started_at)
);

alter table public.custodial_offline_time_reservations drop constraint if exists custodial_offline_employee_time_no_overlap;
alter table public.custodial_offline_time_reservations add constraint custodial_offline_employee_time_no_overlap
  exclude using gist (employee_id with =, occurred_range with &&);
alter table public.custodial_offline_time_reservations drop constraint if exists custodial_offline_device_time_no_overlap;
alter table public.custodial_offline_time_reservations add constraint custodial_offline_device_time_no_overlap
  exclude using gist (device_id with =, occurred_range with &&);

create table if not exists public.custodial_offline_reconciliation_dispositions (
  disposition_id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.custodial_offline_reconciliation_records(reconciliation_id) on delete restrict,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  disposition text not null check (disposition in ('reviewed','retained_for_recovery','superseded_by_new_occurrence')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  original_evidence_fingerprint text not null check (original_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists idx_custodial_offline_reconciliation_manager_list
  on public.custodial_offline_reconciliation_records(state, created_at desc, reconciliation_id);

-- Generic service_role retains many historical application grants.  These
-- authority records are different: only SECURITY DEFINER canonical writers may
-- touch them, and their transition trigger separately verifies the release key.
revoke all on table public.custodial_offline_reconciliation_records,
  public.custodial_offline_reconciliation_audits,
  public.custodial_offline_scan_event_evidence,
  public.custodial_offline_time_reservations,
  public.custodial_offline_reconciliation_dispositions
from public, anon, authenticated, service_role;

drop trigger if exists trg_custodial_offline_reconciliation_immutable on public.custodial_offline_reconciliation_records;
create trigger trg_custodial_offline_reconciliation_immutable
before update or delete on public.custodial_offline_reconciliation_records
for each row execute function public.custodial_reject_offline_evidence_mutation();
drop trigger if exists trg_custodial_offline_audit_immutable on public.custodial_offline_reconciliation_audits;
create trigger trg_custodial_offline_audit_immutable
before update or delete on public.custodial_offline_reconciliation_audits
for each row execute function public.custodial_reject_offline_evidence_mutation();
drop trigger if exists trg_custodial_offline_scan_evidence_immutable on public.custodial_offline_scan_event_evidence;
create trigger trg_custodial_offline_scan_evidence_immutable
before update or delete on public.custodial_offline_scan_event_evidence
for each row execute function public.custodial_reject_offline_evidence_mutation();
drop trigger if exists trg_custodial_offline_reservation_immutable on public.custodial_offline_time_reservations;
create trigger trg_custodial_offline_reservation_immutable
before update or delete on public.custodial_offline_time_reservations
for each row execute function public.custodial_reject_offline_evidence_mutation();
drop trigger if exists trg_custodial_offline_disposition_immutable on public.custodial_offline_reconciliation_dispositions;
create trigger trg_custodial_offline_disposition_immutable
before update or delete on public.custodial_offline_reconciliation_dispositions
for each row execute function public.custodial_reject_offline_evidence_mutation();

create or replace function public.custodial_offline_payload_fingerprint(
  p_context public.custodial_offline_actor_contexts,
  p_client_completion_id text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_response_json jsonb,
  p_scan_evidence jsonb,
  p_correlation_id text
)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'actor_employee_id', p_context.employee_id::text,
    'assignment_change_id', p_context.assignment_change_id::text,
    'assignment_epoch', p_context.assignment_epoch,
    'canonical_location_code', p_context.canonical_location_code,
    'client_completion_id', btrim(p_client_completion_id),
    'client_session_id', p_context.client_session_id,
    'correlation_id', nullif(btrim(coalesce(p_correlation_id,'')),''),
    'credential_id', p_context.credential_id::text,
    'device_id', p_context.device_id::text,
    'ended_at', p_ended_at,
    'location_aliases', p_context.location_aliases,
    'location_id', p_context.location_id::text,
    'occurrence_fingerprint', p_context.occurrence_fingerprint,
    'occurrence_id', p_context.occurrence_id::text,
    'response_json', coalesce(p_response_json,'{}'::jsonb),
    'scan_evidence', coalesce(p_scan_evidence,'[]'::jsonb),
    'started_at', p_started_at
  )::text, 'UTF8'), 'sha256'), 'hex');
$function$;

create or replace function public.custodial_quarantine_offline_submission(
  p_client_session_id text,
  p_client_completion_id text,
  p_context_id uuid,
  p_payload_fingerprint text,
  p_payload_json jsonb,
  p_reason text,
  p_details jsonb,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_existing public.custodial_offline_reconciliation_records%rowtype;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_reconciliation_id uuid;
  v_result jsonb;
  v_reason text := left(nullif(btrim(coalesce(p_reason,'')), ''), 200);
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  v_reason := coalesce(v_reason, 'offline_authority_rejected');
  select * into v_existing from public.custodial_offline_reconciliation_records
   where client_completion_id=btrim(p_client_completion_id) or client_session_id=btrim(p_client_session_id)
   order by case when client_completion_id=btrim(p_client_completion_id) then 0 else 1 end
   limit 1 for update;
  if v_existing.reconciliation_id is not null then
    insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,reason,evidence_json)
    values (v_existing.reconciliation_id, 'payload_fingerprint_conflict', v_reason,
      jsonb_build_object('attempt_payload_fingerprint',p_payload_fingerprint,'existing_payload_fingerprint',v_existing.payload_fingerprint,'details',coalesce(p_details,'{}'::jsonb)));
    return jsonb_build_object('status','quarantined','terminal',true,'automatic_replay_fenced',true,
      'reconciliation_id',v_existing.reconciliation_id,'reason',v_reason,'replayed',true);
  end if;
  if p_context_id is not null then
    select * into v_context from public.custodial_offline_actor_contexts where context_id=p_context_id for update;
  end if;
  v_result := jsonb_build_object('status','quarantined','terminal',true,'automatic_replay_fenced',true,
    'discard_local_workflow',false,'reason',v_reason,'client_session_id',btrim(p_client_session_id),
    'client_completion_id',btrim(p_client_completion_id));
  insert into public.custodial_offline_reconciliation_records(
    context_id,occurrence_id,occurrence_fingerprint,original_employee_id,device_id,credential_id,location_id,
    client_session_id,client_completion_id,payload_fingerprint,payload_json,state,quarantine_reason,result_json
  ) values (
    v_context.context_id,v_context.occurrence_id,v_context.occurrence_fingerprint,v_context.employee_id,v_context.device_id,v_context.credential_id,v_context.location_id,
    btrim(p_client_session_id),btrim(p_client_completion_id),p_payload_fingerprint,coalesce(p_payload_json,'{}'::jsonb),'quarantined',v_reason,v_result
  ) returning reconciliation_id into v_reconciliation_id;
  if v_context.context_id is not null then
    update public.custodial_offline_actor_contexts set status='quarantined' where context_id=v_context.context_id and status='activated';
    update public.custodial_offline_submission_proofs set state='quarantined', consumed_at=now()
      where context_id=v_context.context_id and state='issued';
  end if;
  insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,reason,evidence_json)
  values (v_reconciliation_id,'quarantined',v_reason,coalesce(p_details,'{}'::jsonb));
  return v_result || jsonb_build_object('reconciliation_id',v_reconciliation_id,'occurrence_id',v_context.occurrence_id);
end
$function$;

create or replace function public.custodial_commit_offline_occurrence(
  p_client_session_id text,
  p_client_completion_id text,
  p_device_id text,
  p_location_code text,
  p_client_started_at text,
  p_client_ended_at text,
  p_response_json jsonb,
  p_scan_evidence jsonb,
  p_correlation_id text,
  p_context_id text,
  p_submission_proof text,
  p_authenticated_credential_id text,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id,'')), '');
  v_client_completion_id text := nullif(btrim(coalesce(p_client_completion_id,'')), '');
  v_context_id uuid;
  v_credential_id uuid;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_proof public.custodial_offline_submission_proofs%rowtype;
  v_existing public.custodial_offline_reconciliation_records%rowtype;
  v_device public.devices%rowtype;
  v_employee public.employees%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_location record;
  v_session public.sessions%rowtype;
  v_completion_response_id uuid;
  v_submitted_at timestamptz;
  v_ticket_count integer := 0;
  v_payload_fingerprint text;
  v_result jsonb;
  v_item jsonb;
  v_event_type text;
  v_event_id text;
  v_event_time timestamptz;
  v_event_fingerprint text;
  v_known_event public.custodial_offline_scan_event_evidence%rowtype;
  v_duration_minutes integer;
  v_duration_display text;
  v_failure_reason text;
  v_failure_detail text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id)>200 or v_client_completion_id is null or length(v_client_completion_id)>200 then
    raise exception using errcode='22023', message='stable client_session_id and client_completion_id are required';
  end if;
  if jsonb_typeof(coalesce(p_response_json,'{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_response_json,'{}'::jsonb)) > 1048576
     or jsonb_typeof(coalesce(p_scan_evidence,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_scan_evidence,'[]'::jsonb)) > 200 then
    raise exception using errcode='22023', message='completion payload shape is invalid';
  end if;
  begin
    v_context_id := nullif(lower(btrim(coalesce(p_context_id,''))), '')::uuid;
    v_credential_id := nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))), '')::uuid;
    v_started_at := nullif(btrim(coalesce(p_client_started_at,'')), '')::timestamptz;
    v_ended_at := nullif(btrim(coalesce(p_client_ended_at,'')), '')::timestamptz;
  exception when others then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,null,
      encode(extensions.digest(convert_to(coalesce(p_client_session_id,'')||':'||coalesce(p_client_completion_id,''),'UTF8'),'sha256'),'hex'),
      jsonb_build_object('response_json',coalesce(p_response_json,'{}'::jsonb),'scan_evidence',coalesce(p_scan_evidence,'[]'::jsonb)),
      'malformed_authority_or_timestamp',jsonb_build_object('context_id',p_context_id,'credential_id',p_authenticated_credential_id),p_backend_execution_secret);
  end;
  if v_started_at is null or v_ended_at is null or v_ended_at <= v_started_at or v_ended_at > now()+interval '10 minutes'
     or v_started_at < now()-interval '7 days' or v_ended_at-v_started_at > interval '24 hours' then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context_id,
      encode(extensions.digest(convert_to(coalesce(p_client_session_id,'')||':'||coalesce(p_client_completion_id,'')||':invalid-time','UTF8'),'sha256'),'hex'),
      jsonb_build_object('response_json',coalesce(p_response_json,'{}'::jsonb),'scan_evidence',coalesce(p_scan_evidence,'[]'::jsonb)),
      'invalid_occurrence_timestamps','{}'::jsonb,p_backend_execution_secret);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-session:'||v_client_session_id,0));
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-completion:'||v_client_completion_id,0));
  select * into v_existing from public.custodial_offline_reconciliation_records
   where client_completion_id=v_client_completion_id or client_session_id=v_client_session_id
   order by case when client_completion_id=v_client_completion_id then 0 else 1 end limit 1 for update;
  select * into v_context from public.custodial_offline_actor_contexts where context_id=v_context_id for update;
  if v_context.context_id is null then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,null,
      encode(extensions.digest(convert_to(v_client_session_id||':'||v_client_completion_id||':missing-context','UTF8'),'sha256'),'hex'),
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'offline_actor_context_not_found','{}'::jsonb,p_backend_execution_secret);
  end if;
  v_payload_fingerprint := public.custodial_offline_payload_fingerprint(v_context,v_client_completion_id,v_started_at,v_ended_at,p_response_json,p_scan_evidence,p_correlation_id);
  if v_existing.reconciliation_id is not null then
    if v_existing.client_session_id=v_client_session_id and v_existing.client_completion_id=v_client_completion_id and v_existing.payload_fingerprint=v_payload_fingerprint then
      insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,evidence_json)
      values(v_existing.reconciliation_id,'replayed',jsonb_build_object('exact_payload_replay',true));
      return v_existing.result_json || jsonb_build_object('reconciliation_id',v_existing.reconciliation_id,'replayed',true);
    end if;
    insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,reason,evidence_json)
    values(v_existing.reconciliation_id,'payload_fingerprint_conflict','payload_fingerprint_conflict',jsonb_build_object('attempt_payload_fingerprint',v_payload_fingerprint));
    return jsonb_build_object('status','quarantined','terminal',true,'automatic_replay_fenced',true,
      'reconciliation_id',v_existing.reconciliation_id,'reason','payload_fingerprint_conflict');
  end if;
  if v_context.client_session_id <> v_client_session_id or v_context.status <> 'activated' or v_context.expires_at <= now()
     or upper(btrim(coalesce(p_device_id,''))) <> upper((select device_id from public.devices where id=v_context.device_id))
     or public.resolve_scan_location_code(p_location_code) <> v_context.canonical_location_code
     or v_context.credential_id <> v_credential_id
     or v_context.started_at <> v_started_at then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'context_binding_mismatch','{}'::jsonb,p_backend_execution_secret);
  end if;
  select * into v_proof from public.custodial_offline_submission_proofs where context_id=v_context.context_id for update;
  if v_proof.state <> 'issued' or coalesce(p_submission_proof,'') !~ '^[0-9a-f]{64}$'
     or encode(extensions.digest(convert_to(lower(p_submission_proof),'UTF8'),'sha256'),'hex') <> v_proof.proof_digest then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'submission_proof_invalid','{}'::jsonb,p_backend_execution_secret);
  end if;
  select * into v_device from public.devices where id=v_context.device_id for update;
  select * into v_employee from public.employees where id=v_context.employee_id;
  select * into v_credential from public.device_auth_credentials where credential_id=v_context.credential_id;
  select l.id,l.location_code,l.location_name,l.location_type,l.form_type into v_location from public.locations l where l.id=v_context.location_id and l.active=true;
  if v_device.id is null or v_device.active is not true or v_employee.id is null or v_employee.active is not true
     or v_credential.credential_id is null or v_credential.device_id<>v_context.device_id or v_credential.confirmed_at is null
     or v_credential.revoked_at is not null or v_credential.expires_at<=now() or v_location.id is null
     or not exists (select 1 from public.custodial_employee_device_assignment_history h where h.assignment_change_id=v_context.assignment_change_id and h.device_id=v_context.device_id and h.new_employee_id=v_context.employee_id) then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'permanent_actor_or_credential_proof_loss','{}'::jsonb,p_backend_execution_secret);
  end if;
  -- Parse every event before the operational subtransaction.  A malformed
  -- timestamp never gets as far as completion/ticket creation.
  begin
    for v_item in select value from jsonb_array_elements(p_scan_evidence) loop
      if jsonb_typeof(v_item) <> 'object' then raise exception using errcode='22023', message='scan event must be an object'; end if;
      v_event_type := nullif(btrim(coalesce(v_item->>'event_type','')), '');
      v_event_id := nullif(btrim(coalesce(v_item->>'client_event_id','')), '');
      if v_event_type not in ('scan_received','scan_blocked','scan_start','scan_finish','scan_resume_pending','scan_invalid_location','scan_unauthorized_device','scan_error')
         or v_event_id is null or length(v_event_id)>200 then
        raise exception using errcode='22023', message='scan event identity is invalid';
      end if;
      v_event_time := nullif(btrim(coalesce(v_item->>'scanned_at','')), '')::timestamptz;
    end loop;
  exception when others then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'malformed_scan_evidence',jsonb_build_object('detail',sqlerrm),p_backend_execution_secret);
  end;
  begin
    insert into public.custodial_offline_time_reservations(occurrence_id,employee_id,device_id,started_at,ended_at)
    values(v_context.occurrence_id,v_context.employee_id,v_context.device_id,v_started_at,v_ended_at);
    select * into v_session from public.sessions where client_session_id=v_client_session_id for update;
    if v_session.id is null then
      insert into public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes,duration_display,completion_source)
      values(gen_random_uuid()::text,v_client_session_id,v_context.location_id,v_context.employee_id,v_context.device_id,'pending_submit',v_started_at,v_ended_at,
        greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer),greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer)::text||' min','kiosk_form')
      returning * into v_session;
    elsif v_session.device_id<>v_context.device_id or v_session.employee_id<>v_context.employee_id or v_session.location_id<>v_context.location_id or v_session.status not in ('active','pending_submit') then
      raise exception using errcode='23514', message='server session is not bound to the activated occurrence';
    else
      update public.sessions set status='pending_submit',ended_at=v_ended_at,duration_minutes=greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer),duration_display=greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer)::text||' min'
        where id=v_session.id and status='active';
      select * into v_session from public.sessions where id=v_session.id;
    end if;
    insert into public.completion_responses(session_id,location_id,submitted_by_employee_id,device_id,response_json,submitted_at,client_completion_id)
    values(v_session.id,v_context.location_id,v_context.employee_id,v_context.device_id,p_response_json,now(),v_client_completion_id)
    returning id,submitted_at into v_completion_response_id,v_submitted_at;
    v_ticket_count := public.create_maintenance_tickets_from_response(v_completion_response_id,v_session.id,v_context.location_id,v_context.employee_id,v_context.device_id,v_submitted_at,p_response_json);
    update public.sessions set status='closed',completion_source='kiosk_form',updated_at=now() where id=v_session.id and status='pending_submit';
    if not found then raise exception using errcode='40001', message='session did not reach the canonical pending_submit state'; end if;
    for v_item in select value from jsonb_array_elements(p_scan_evidence) loop
      v_event_type := v_item->>'event_type'; v_event_id := btrim(v_item->>'client_event_id'); v_event_time := (v_item->>'scanned_at')::timestamptz;
      v_event_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
        'client_event_id',v_event_id,'context_id',v_context.context_id::text,'device_id',v_context.device_id::text,
        'event_type',v_event_type,'location_id',v_context.location_id::text,'payload_json',coalesce(v_item->'payload_json','{}'::jsonb),
        'result',nullif(v_item->>'result',''),'scanned_at',v_event_time,'session_id',v_session.id::text,'notes',nullif(v_item->>'notes','')
      )::text,'UTF8'),'sha256'),'hex');
      select * into v_known_event from public.custodial_offline_scan_event_evidence where client_event_id=v_event_id for update;
      if v_known_event.client_event_id is not null and v_known_event.event_fingerprint<>v_event_fingerprint then
        raise exception using errcode='23514', message='scan event identity is already bound to different immutable evidence';
      end if;
    end loop;
  exception when exclusion_violation then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'overlapping_employee_or_device_occurrence','{}'::jsonb,p_backend_execution_secret);
  when others then
    v_failure_detail := sqlerrm;
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'operational_commit_exception',jsonb_build_object('detail',v_failure_detail),p_backend_execution_secret);
  end;
  v_result := jsonb_build_object('status','closed','terminal',true,'client_session_id',v_client_session_id,'client_completion_id',v_client_completion_id,
    'session_uuid',v_session.session_uuid,'completion_response_id',v_completion_response_id,'occurrence_id',v_context.occurrence_id,
    'original_employee_id',v_context.employee_id,'started_at',v_started_at,'ended_at',v_ended_at,'correlation_id',nullif(btrim(coalesce(p_correlation_id,'')),''),
    'maintenance_ticket_count',v_ticket_count,'replayed',false);
  insert into public.custodial_offline_reconciliation_records(
    context_id,occurrence_id,occurrence_fingerprint,original_employee_id,device_id,credential_id,location_id,
    client_session_id,client_completion_id,payload_fingerprint,payload_json,state,result_json,session_id,completion_response_id
  ) values (
    v_context.context_id,v_context.occurrence_id,v_context.occurrence_fingerprint,v_context.employee_id,v_context.device_id,v_context.credential_id,v_context.location_id,
    v_client_session_id,v_client_completion_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'committed',v_result,v_session.id,v_completion_response_id
  ) returning reconciliation_id into v_existing.reconciliation_id;
  for v_item in select value from jsonb_array_elements(p_scan_evidence) loop
    v_event_type := v_item->>'event_type'; v_event_id := btrim(v_item->>'client_event_id'); v_event_time := (v_item->>'scanned_at')::timestamptz;
    v_event_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
      'client_event_id',v_event_id,'context_id',v_context.context_id::text,'device_id',v_context.device_id::text,
      'event_type',v_event_type,'location_id',v_context.location_id::text,'payload_json',coalesce(v_item->'payload_json','{}'::jsonb),
      'result',nullif(v_item->>'result',''),'scanned_at',v_event_time,'session_id',v_session.id::text,'notes',nullif(v_item->>'notes','')
    )::text,'UTF8'),'sha256'),'hex');
    if not exists(select 1 from public.custodial_offline_scan_event_evidence where client_event_id=v_event_id) then
      insert into public.custodial_offline_scan_event_evidence(client_event_id,context_id,reconciliation_id,session_id,event_fingerprint,event_payload)
      values(v_event_id,v_context.context_id,v_existing.reconciliation_id,v_session.id,v_event_fingerprint,v_item);
      insert into public.scan_events(scanned_at,location_id,location_code,device_id,device_identifier,session_id,event_type,result,notes,payload_json,client_event_id)
      values(v_event_time,v_context.location_id,v_context.canonical_location_code,v_context.device_id,v_device.device_id,v_session.id,v_event_type,
        nullif(v_item->>'result',''),nullif(v_item->>'notes',''),coalesce(v_item->'payload_json','{}'::jsonb)||jsonb_build_object('offline_occurrence_id',v_context.occurrence_id),v_event_id)
      on conflict (client_event_id) where client_event_id is not null do nothing;
    end if;
  end loop;
  update public.custodial_offline_actor_contexts set status='committed' where context_id=v_context.context_id and status='activated';
  update public.custodial_offline_submission_proofs set state='consumed', consumed_at=now() where context_id=v_context.context_id and state='issued';
  insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,evidence_json)
  values(v_existing.reconciliation_id,'accepted',jsonb_build_object('occurrence_fingerprint',v_context.occurrence_fingerprint,'payload_fingerprint',v_payload_fingerprint));
  return v_result || jsonb_build_object('reconciliation_id',v_existing.reconciliation_id);
end
$function$;

create or replace function public.tool_commit_cleaning_workflow_authoritative(
  p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text,
  p_client_started_at text, p_client_ended_at text, p_response_json jsonb, p_scan_evidence jsonb,
  p_correlation_id text, p_context_id text, p_submission_proof text, p_authenticated_credential_id text,
  p_backend_execution_secret text
) returns jsonb language sql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
  select public.custodial_commit_offline_occurrence(p_client_session_id,p_client_completion_id,p_device_id,p_location_code,p_client_started_at,p_client_ended_at,p_response_json,p_scan_evidence,p_correlation_id,p_context_id,p_submission_proof,p_authenticated_credential_id,p_backend_execution_secret);
$function$;

-- The explicit compatibility adapter derives its occurrence from an already
-- server-started session.  It never calls complete_session and therefore
-- converges into the same reconciliation record/authoritative transaction.
create or replace function public.tool_complete_session_authoritative(
  p_session_uuid text, p_response_json jsonb, p_device_id text, p_client_completion_id text,
  p_authenticated_credential_id text, p_backend_execution_secret text
) returns jsonb
language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_session record;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_existing public.custodial_offline_reconciliation_records%rowtype;
  v_proof text := encode(extensions.gen_random_bytes(32), 'hex');
  v_occurrence_fingerprint text;
  v_assignment_change_id uuid;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select s.*, d.device_id as canonical_device_id, l.location_code, c.credential_id
    into v_session from public.sessions s join public.devices d on d.id=s.device_id join public.locations l on l.id=s.location_id
    join public.device_auth_credentials c on c.credential_id=nullif(lower(btrim(p_authenticated_credential_id)),'')::uuid and c.device_id=s.device_id
   where s.session_uuid=p_session_uuid or s.client_session_id=p_session_uuid
   order by case when s.session_uuid=p_session_uuid then 0 else 1 end limit 1 for update of s;
  if v_session.id is null or upper(btrim(coalesce(p_device_id,'')))<>upper(v_session.canonical_device_id) then
    raise exception using errcode='42501', message='legacy completion is not bound to an authenticated server session';
  end if;
  -- A legacy caller never receives the one-time proof.  Its exact retry is
  -- therefore resolved from the immutable reconciliation record, while any
  -- altered completion id or response is fenced as an identity conflict.
  select * into v_existing from public.custodial_offline_reconciliation_records
    where client_session_id=v_session.client_session_id or client_completion_id=btrim(p_client_completion_id)
    order by case when client_completion_id=btrim(p_client_completion_id) then 0 else 1 end
    limit 1 for update;
  if v_existing.reconciliation_id is not null then
    if v_existing.client_session_id=v_session.client_session_id
       and v_existing.client_completion_id=btrim(p_client_completion_id)
       and v_existing.payload_json=jsonb_build_object('response_json',coalesce(p_response_json,'{}'::jsonb),'scan_evidence','[]'::jsonb) then
      insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,evidence_json)
      values(v_existing.reconciliation_id,'replayed',jsonb_build_object('exact_legacy_adapter_replay',true));
      return v_existing.result_json || jsonb_build_object('reconciliation_id',v_existing.reconciliation_id,'replayed',true);
    end if;
    return public.custodial_quarantine_offline_submission(
      v_session.client_session_id,p_client_completion_id,v_existing.context_id,
      encode(extensions.digest(convert_to(v_session.client_session_id||':'||coalesce(p_client_completion_id,'')||':legacy-conflict','UTF8'),'sha256'),'hex'),
      jsonb_build_object('response_json',coalesce(p_response_json,'{}'::jsonb),'scan_evidence','[]'::jsonb),
      'legacy_adapter_payload_fingerprint_conflict','{}'::jsonb,p_backend_execution_secret);
  end if;
  select * into v_context from public.custodial_offline_actor_contexts where client_session_id=v_session.client_session_id for update;
  if v_context.context_id is null then
    select assignment_change_id into v_assignment_change_id from public.custodial_employee_device_assignment_history
      where device_id=v_session.device_id and new_employee_id=v_session.employee_id order by changed_at desc limit 1;
    if v_assignment_change_id is null then raise exception using errcode='42501', message='legacy completion has no authoritative assignment epoch'; end if;
    v_occurrence_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('legacy_server_session_id',v_session.id::text,'employee_id',v_session.employee_id::text,'device_id',v_session.device_id::text,'location_id',v_session.location_id::text,'started_at',v_session.started_at,'client_session_id',v_session.client_session_id)::text,'UTF8'),'sha256'),'hex');
    insert into public.custodial_offline_actor_contexts(client_session_id,device_id,employee_id,credential_id,assignment_epoch,assignment_change_id,location_id,canonical_location_code,location_aliases,started_at,occurrence_fingerprint,expires_at)
    select v_session.client_session_id,v_session.device_id,v_session.employee_id,v_session.credential_id,d.assignment_epoch,v_assignment_change_id,v_session.location_id,v_session.location_code,jsonb_build_array(v_session.location_code),v_session.started_at,v_occurrence_fingerprint,now()+interval '7 days'
      from public.devices d where d.id=v_session.device_id
    returning * into v_context;
    insert into public.custodial_offline_submission_proofs(context_id,proof_digest) values(v_context.context_id,encode(extensions.digest(convert_to(v_proof,'UTF8'),'sha256'),'hex'));
  else
    raise exception using errcode='0A000', message='legacy completion must use the existing canonical occurrence adapter';
  end if;
  return public.custodial_commit_offline_occurrence(v_context.client_session_id,p_client_completion_id,v_session.canonical_device_id,v_session.location_code,
    v_context.started_at::text,coalesce(v_session.ended_at,now())::text,coalesce(p_response_json,'{}'::jsonb),'[]'::jsonb,
    'legacy-completion:'||p_client_completion_id,v_context.context_id::text,v_proof,v_context.credential_id::text,p_backend_execution_secret);
end
$function$;

create or replace function public.commit_cleaning_workflow(
  p_client_session_id text,p_client_completion_id text,p_device_id text,p_location_code text,p_client_started_at timestamptz,p_client_ended_at timestamptz,p_response_json jsonb default '{}'::jsonb,p_scan_evidence jsonb default '[]'::jsonb,p_correlation_id text default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$ begin raise exception using errcode='0A000', message='Use tool_commit_cleaning_workflow_authoritative through the authenticated scan backend'; end $function$;
create or replace function public.tool_commit_cleaning_workflow(
  p_client_session_id text,p_client_completion_id text,p_device_id text,p_location_code text,p_client_started_at timestamptz,p_client_ended_at timestamptz,p_response_json jsonb default '{}'::jsonb,p_scan_evidence jsonb default '[]'::jsonb,p_correlation_id text default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$ begin raise exception using errcode='0A000', message='Use tool_commit_cleaning_workflow_authoritative through the authenticated scan backend'; end $function$;
create or replace function public.tool_complete_session(
  p_session_uuid text,p_response_json jsonb default '{}'::jsonb,p_submitted_by_employee_name text default null,p_device_id text default null,p_client_completion_id text default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$ begin raise exception using errcode='0A000', message='Use tool_complete_session_authoritative through the authenticated scan backend'; end $function$;

create or replace function public.custodial_manager_list_offline_reconciliations(p_manager_id uuid,p_limit integer,p_before timestamptz,p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
    raise exception using errcode='42501', message='active named manager authority is required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('reconciliation_id',r.reconciliation_id,'state',r.state,'reason',r.quarantine_reason,'original_employee_id',r.original_employee_id,'occurrence_id',r.occurrence_id,'created_at',r.created_at) order by r.created_at desc)
    from (select * from public.custodial_offline_reconciliation_records where p_before is null or created_at<p_before order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) r),'[]'::jsonb);
end $function$;
create or replace function public.custodial_manager_get_offline_reconciliation(p_manager_id uuid,p_reconciliation_id uuid,p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare v_record public.custodial_offline_reconciliation_records%rowtype;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null) then raise exception using errcode='42501',message='active named manager authority is required'; end if;
  select * into v_record from public.custodial_offline_reconciliation_records where reconciliation_id=p_reconciliation_id;
  if v_record.reconciliation_id is null then raise exception using errcode='P0002',message='offline reconciliation not found'; end if;
  return jsonb_build_object('record',to_jsonb(v_record),'audits',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]'::jsonb) from public.custodial_offline_reconciliation_audits a where a.reconciliation_id=v_record.reconciliation_id),'dispositions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at),'[]'::jsonb) from public.custodial_offline_reconciliation_dispositions d where d.reconciliation_id=v_record.reconciliation_id));
end $function$;
create or replace function public.custodial_manager_dispose_offline_reconciliation(p_manager_id uuid,p_reconciliation_id uuid,p_disposition text,p_reason text,p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare v_fingerprint text; v_disposition_id uuid;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='named recovery manager authority is required'; end if;
  select encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') into v_fingerprint from public.custodial_offline_reconciliation_records r where r.reconciliation_id=p_reconciliation_id;
  if v_fingerprint is null then raise exception using errcode='P0002',message='offline reconciliation not found'; end if;
  insert into public.custodial_offline_reconciliation_dispositions(reconciliation_id,manager_id,disposition,reason,original_evidence_fingerprint) values(p_reconciliation_id,p_manager_id,p_disposition,btrim(p_reason),v_fingerprint) returning disposition_id into v_disposition_id;
  insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,actor_manager_id,reason,evidence_json) values(p_reconciliation_id,'disposition_recorded',p_manager_id,btrim(p_reason),jsonb_build_object('disposition_id',v_disposition_id,'disposition',p_disposition));
  return jsonb_build_object('disposition_id',v_disposition_id,'reconciliation_id',p_reconciliation_id,'immutable_original_evidence_fingerprint',v_fingerprint);
end $function$;

-- Close the accepted Messenger audit's remaining dormant destructive writer at
-- final precedence; the correct conversation deletion/tombstone APIs remain.
create or replace function public.msg_delete_thread_permanently(p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog', 'public', 'extensions'
as $function$ begin raise exception using errcode='0A000', message='Permanent Messenger thread deletion is retired; use the audited tombstone workflow'; end $function$;

revoke all on function public.custodial_quarantine_offline_submission(text,text,uuid,text,jsonb,text,jsonb,text),
  public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),
  public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),
  public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),
  public.custodial_manager_list_offline_reconciliations(uuid,integer,timestamptz,text),
  public.custodial_manager_get_offline_reconciliation(uuid,uuid,text),
  public.custodial_manager_dispose_offline_reconciliation(uuid,uuid,text,text,text)
from public, anon, authenticated;
grant execute on function public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),
  public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),
  public.custodial_manager_list_offline_reconciliations(uuid,integer,timestamptz,text),
  public.custodial_manager_get_offline_reconciliation(uuid,uuid,text),
  public.custodial_manager_dispose_offline_reconciliation(uuid,uuid,text,text,text)
to postgres, service_role;
revoke all on function public.commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text),
  public.tool_commit_cleaning_workflow(text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text),
  public.tool_complete_session(text,jsonb,text,text,text),
  public.msg_delete_thread_permanently(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.tool_complete_session(text,jsonb,text,text,text), public.msg_delete_thread_permanently(uuid) to postgres, service_role;

commit;
