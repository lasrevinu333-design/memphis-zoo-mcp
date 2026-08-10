begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Phase C closes the final authority seams without rewriting either already
-- deployed Phase A or Phase B history.  Every application write now enters a
-- small SECURITY DEFINER command surface and every terminal rejection leaves
-- immutable evidence for named-manager follow-up.

create table if not exists public.custodial_offline_reconciliation_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.custodial_offline_reconciliation_records(reconciliation_id) on delete restrict,
  notification_key text not null unique check (length(notification_key) between 1 and 200),
  notification_kind text not null check (notification_kind = 'offline_reconciliation_quarantine'),
  payload_json jsonb not null,
  state text not null default 'pending' check (state in ('pending','claimed','delivered','failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (reconciliation_id, notification_kind)
);

alter table public.custodial_offline_actor_contexts
  add column if not exists activation_mode text not null default 'offline_authority_v2';
alter table public.custodial_offline_actor_contexts
  drop constraint if exists custodial_offline_actor_contexts_activation_mode_check;
alter table public.custodial_offline_actor_contexts
  add constraint custodial_offline_actor_contexts_activation_mode_check
  check (activation_mode in ('offline_authority_v2','legacy_compatibility_bridge'));

alter table public.custodial_offline_reconciliation_dispositions
  add column if not exists request_id uuid;
alter table public.custodial_offline_reconciliation_dispositions
  add column if not exists request_fingerprint text;
update public.custodial_offline_reconciliation_dispositions
set request_id = coalesce(request_id, gen_random_uuid()),
    request_fingerprint = coalesce(request_fingerprint, encode(extensions.digest(convert_to(to_jsonb(custodial_offline_reconciliation_dispositions)::text,'UTF8'),'sha256'),'hex'))
where request_id is null or request_fingerprint is null;
alter table public.custodial_offline_reconciliation_dispositions
  alter column request_id set not null;
alter table public.custodial_offline_reconciliation_dispositions
  alter column request_fingerprint set not null;
alter table public.custodial_offline_reconciliation_dispositions
  drop constraint if exists custodial_offline_reconciliation_dispositions_request_fingerprint_check;
alter table public.custodial_offline_reconciliation_dispositions
  add constraint custodial_offline_reconciliation_dispositions_request_fingerprint_check
  check (request_fingerprint ~ '^[0-9a-f]{64}$');
create unique index if not exists uq_custodial_offline_disposition_request
  on public.custodial_offline_reconciliation_dispositions(manager_id, request_id);

alter table public.custodial_offline_reconciliation_audits
  drop constraint if exists custodial_offline_reconciliation_audits_event_type_check;
alter table public.custodial_offline_reconciliation_audits
  add constraint custodial_offline_reconciliation_audits_event_type_check
  check (event_type in ('accepted','quarantined','replayed','payload_fingerprint_conflict','conflict_fenced','disposition_recorded'));

create or replace function public.custodial_reject_offline_evidence_truncate()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if current_setting('custodial.offline_evidence_maintenance', true) is distinct from 'approved' then
    raise exception using errcode='42501', message='Custodial offline authority evidence may be truncated only by the explicit maintenance procedure';
  end if;
  return null;
end
$function$;

create or replace function public.custodial_truncate_offline_evidence_for_maintenance(
  p_table regclass,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if p_table::text not in (
    'custodial_offline_actor_contexts','custodial_offline_submission_proofs',
    'custodial_offline_reconciliation_records','custodial_offline_reconciliation_audits',
    'custodial_offline_scan_event_evidence','custodial_offline_time_reservations',
    'custodial_offline_reconciliation_dispositions','custodial_offline_reconciliation_outbox'
  ) or nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception using errcode='22023', message='an approved offline evidence table and maintenance reason are required';
  end if;
  perform set_config('custodial.offline_evidence_maintenance', 'approved', true);
  execute format('truncate table public.%I', p_table::text);
end
$function$;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'custodial_offline_actor_contexts','custodial_offline_submission_proofs',
    'custodial_offline_reconciliation_records','custodial_offline_reconciliation_audits',
    'custodial_offline_scan_event_evidence','custodial_offline_time_reservations',
    'custodial_offline_reconciliation_dispositions','custodial_offline_reconciliation_outbox'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || v_table || '_truncate_guard', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.custodial_reject_offline_evidence_truncate()', 'trg_' || v_table || '_truncate_guard', v_table);
  end loop;
end
$triggers$;

drop trigger if exists trg_custodial_offline_outbox_immutable on public.custodial_offline_reconciliation_outbox;
create trigger trg_custodial_offline_outbox_immutable
before update or delete on public.custodial_offline_reconciliation_outbox
for each row execute function public.custodial_reject_offline_evidence_mutation();

create or replace function public.custodial_require_backend_execution_secret(p_execution_secret text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_expected text;
  v_enabled boolean;
begin
  select execution_secret_digest,enabled into v_expected,v_enabled
  from public.custodial_backend_execution_config where config_key=true;
  if v_enabled is not true or v_expected is null or length(coalesce(p_execution_secret,''))<32
     or encode(extensions.digest(convert_to(p_execution_secret,'UTF8'),'sha256'),'hex')<>v_expected then
    raise exception using errcode='42501',message='custodial backend execution boundary is not authorized';
  end if;
  perform set_config('custodial.backend_execution_secret',p_execution_secret,true);
end
$function$;

create or replace function public.custodial_lock_offline_reconciliation_keys(
  p_client_session_id text,
  p_client_completion_id text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_first text := 'custodial-offline-key:session:' || coalesce(p_client_session_id,'');
  v_second text := 'custodial-offline-key:completion:' || coalesce(p_client_completion_id,'');
begin
  if v_first <= v_second then
    perform pg_advisory_xact_lock(hashtextextended(v_first, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_second, 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_second, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_first, 0));
  end if;
end
$function$;

create or replace function public.custodial_enqueue_offline_reconciliation_notification(
  p_reconciliation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  insert into public.custodial_offline_reconciliation_outbox(reconciliation_id,notification_key,notification_kind,payload_json)
  select r.reconciliation_id,
         'offline-reconciliation:' || r.reconciliation_id::text,
         'offline_reconciliation_quarantine',
         jsonb_build_object('reconciliation_id',r.reconciliation_id,'state',r.state,'reason',r.quarantine_reason,'created_at',r.created_at)
  from public.custodial_offline_reconciliation_records r
  where r.reconciliation_id=p_reconciliation_id
  on conflict (reconciliation_id, notification_kind) do nothing;
end
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
  v_reason text := left(nullif(btrim(coalesce(p_reason,'')), ''), 200);
  v_fingerprint text;
  v_session_id text;
  v_completion_id text;
  v_safe_payload jsonb := coalesce(p_payload_json,'{}'::jsonb);
  v_result jsonb;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  v_reason := coalesce(v_reason, 'offline_authority_rejected');
  v_fingerprint := case when coalesce(p_payload_fingerprint,'') ~ '^[0-9a-f]{64}$' then p_payload_fingerprint
    else encode(extensions.digest(convert_to(coalesce(p_client_session_id,'') || ':' || coalesce(p_client_completion_id,'') || ':' || v_safe_payload::text,'UTF8'),'sha256'),'hex') end;
  v_session_id := nullif(btrim(coalesce(p_client_session_id,'')), '');
  v_completion_id := nullif(btrim(coalesce(p_client_completion_id,'')), '');
  if v_session_id is null or length(v_session_id)>200 then v_session_id := 'invalid-session:' || substr(v_fingerprint,1,48); end if;
  if v_completion_id is null or length(v_completion_id)>200 then v_completion_id := 'invalid-completion:' || substr(v_fingerprint,1,45); end if;
  if pg_column_size(v_safe_payload)>1048576 then
    v_safe_payload := jsonb_build_object('payload_omitted',true,'payload_bytes',pg_column_size(coalesce(p_payload_json,'{}'::jsonb)),'payload_fingerprint',v_fingerprint);
  end if;
  perform public.custodial_lock_offline_reconciliation_keys(v_session_id,v_completion_id);
  if p_context_id is not null then
    select * into v_context from public.custodial_offline_actor_contexts where context_id=p_context_id for update;
  end if;
  select * into v_existing from public.custodial_offline_reconciliation_records
  where client_completion_id=v_completion_id or client_session_id=v_session_id
  order by case when client_completion_id=v_completion_id then 0 else 1 end
  limit 1 for update;
  if v_existing.reconciliation_id is not null then
    if v_context.context_id is not null then
      update public.custodial_offline_actor_contexts set status='quarantined'
       where context_id=v_context.context_id and status='activated';
      update public.custodial_offline_submission_proofs set state='quarantined', consumed_at=now()
       where context_id=v_context.context_id and state='issued';
    end if;
    insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,reason,evidence_json)
    values (v_existing.reconciliation_id,'conflict_fenced',v_reason,
      jsonb_build_object('attempt_payload_fingerprint',v_fingerprint,'attempt_context_id',p_context_id,
        'attempt_occurrence_id',v_context.occurrence_id,'details',coalesce(p_details,'{}'::jsonb),'payload',v_safe_payload));
    perform public.custodial_enqueue_offline_reconciliation_notification(v_existing.reconciliation_id);
    return jsonb_build_object('status','quarantined','terminal',true,'automatic_replay_fenced',true,
      'reconciliation_id',v_existing.reconciliation_id,'reason',v_reason,'replayed',true,
      'attempt_context_fenced',v_context.context_id is not null);
  end if;
  v_result := jsonb_build_object('status','quarantined','terminal',true,'automatic_replay_fenced',true,
    'discard_local_workflow',false,'reason',v_reason,'client_session_id',v_session_id,'client_completion_id',v_completion_id);
  insert into public.custodial_offline_reconciliation_records(
    context_id,occurrence_id,occurrence_fingerprint,original_employee_id,device_id,credential_id,location_id,
    client_session_id,client_completion_id,payload_fingerprint,payload_json,state,quarantine_reason,result_json
  ) values (
    v_context.context_id,v_context.occurrence_id,v_context.occurrence_fingerprint,v_context.employee_id,v_context.device_id,v_context.credential_id,v_context.location_id,
    v_session_id,v_completion_id,v_fingerprint,v_safe_payload,'quarantined',v_reason,v_result
  ) returning reconciliation_id into v_reconciliation_id;
  if v_context.context_id is not null then
    update public.custodial_offline_actor_contexts set status='quarantined' where context_id=v_context.context_id and status='activated';
    update public.custodial_offline_submission_proofs set state='quarantined', consumed_at=now() where context_id=v_context.context_id and state='issued';
  end if;
  insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,reason,evidence_json)
  values (v_reconciliation_id,'quarantined',v_reason,coalesce(p_details,'{}'::jsonb));
  perform public.custodial_enqueue_offline_reconciliation_notification(v_reconciliation_id);
  return v_result || jsonb_build_object('reconciliation_id',v_reconciliation_id,'occurrence_id',v_context.occurrence_id);
end
$function$;

create or replace function public.custodial_start_offline_occurrence(
  p_device_id text, p_location_code text, p_client_session_id text, p_client_started_at text,
  p_authenticated_credential_id text, p_backend_execution_secret text
)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id,'')), '');
  v_credential_id uuid;
  v_started_at timestamptz;
  v_device record;
  v_location record;
  v_context public.custodial_offline_actor_contexts%rowtype;
  v_existing public.custodial_offline_actor_contexts%rowtype;
  v_assignment_change_id uuid;
  v_proof text := encode(extensions.gen_random_bytes(32), 'hex');
  v_fingerprint text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id)>200 then raise exception using errcode='22023',message='client_session_id is required for offline occurrence activation'; end if;
  begin
    v_credential_id := nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))), '')::uuid;
    v_started_at := nullif(btrim(coalesce(p_client_started_at,'')), '')::timestamptz;
  exception when others then raise exception using errcode='22023',message='offline occurrence activation requires canonical credential and start timestamp'; end;
  if not isfinite(v_started_at) or v_started_at > now()+interval '10 minutes' or v_started_at < now()-interval '7 days' then
    raise exception using errcode='22023',message='offline occurrence start timestamp is outside the accepted window';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-activation:'||v_client_session_id,0));
  select * into v_existing from public.custodial_offline_actor_contexts where client_session_id=v_client_session_id for update;
  if v_existing.context_id is not null then
    if upper(btrim(coalesce(p_device_id,'')))<>upper((select device_id from public.devices where id=v_existing.device_id))
       or v_existing.credential_id<>v_credential_id or v_existing.canonical_location_code<>public.resolve_scan_location_code(p_location_code)
       or v_existing.started_at<>v_started_at then raise exception using errcode='23505',message='offline occurrence activation replay does not match the original occurrence'; end if;
    return jsonb_build_object('context_id',v_existing.context_id,'occurrence_id',v_existing.occurrence_id,'client_session_id',v_existing.client_session_id,
      'started_at',v_existing.started_at,'proof_replay_requires_durable_local_copy',true,'schema_version','offline-authority.v2');
  end if;
  select d.id,d.device_id,d.assigned_employee_id,d.assignment_epoch,e.active as employee_active,c.credential_id,c.confirmed_at,c.revoked_at,c.expires_at into v_device
  from public.devices d join public.employees e on e.id=d.assigned_employee_id
  join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id
  where upper(btrim(d.device_id))=upper(btrim(p_device_id)) and d.active=true for update of d;
  if v_device.id is null or v_device.assigned_employee_id is null or v_device.employee_active is not true or v_device.confirmed_at is null or v_device.revoked_at is not null or v_device.expires_at<=now() then
    raise exception using errcode='42501',message='active authenticated actor assignment is required for offline occurrence activation';
  end if;
  select l.id,l.location_code,jsonb_build_array(l.location_code,upper(btrim(p_location_code))) as aliases into v_location
  from public.locations l where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true;
  if v_location.id is null then raise exception using errcode='22023',message='active canonical location is required for offline occurrence activation'; end if;
  select h.assignment_change_id into v_assignment_change_id from public.custodial_employee_device_assignment_history h
  where h.device_id=v_device.id and h.new_employee_id=v_device.assigned_employee_id order by h.changed_at desc limit 1;
  if v_assignment_change_id is null then raise exception using errcode='42501',message='an authoritative device assignment epoch is required for offline occurrence activation'; end if;
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('client_session_id',v_client_session_id,'device_id',v_device.id::text,
    'employee_id',v_device.assigned_employee_id::text,'credential_id',v_credential_id::text,'assignment_epoch',v_device.assignment_epoch,
    'assignment_change_id',v_assignment_change_id::text,'location_id',v_location.id::text,'location_code',v_location.location_code,
    'location_aliases',v_location.aliases,'started_at',v_started_at)::text,'UTF8'),'sha256'),'hex');
  insert into public.custodial_offline_actor_contexts(client_session_id,device_id,employee_id,credential_id,assignment_epoch,assignment_change_id,location_id,canonical_location_code,location_aliases,started_at,occurrence_fingerprint,expires_at)
  values(v_client_session_id,v_device.id,v_device.assigned_employee_id,v_credential_id,v_device.assignment_epoch,v_assignment_change_id,v_location.id,v_location.location_code,v_location.aliases,v_started_at,v_fingerprint,now()+interval '7 days') returning * into v_context;
  insert into public.custodial_offline_submission_proofs(context_id,proof_digest) values(v_context.context_id,encode(extensions.digest(convert_to(v_proof,'UTF8'),'sha256'),'hex'));
  return jsonb_build_object('context_id',v_context.context_id,'occurrence_id',v_context.occurrence_id,'client_session_id',v_context.client_session_id,'canonical_location_code',v_context.canonical_location_code,'location_aliases',v_context.location_aliases,'started_at',v_context.started_at,'submission_proof',v_proof,'expires_at',v_context.expires_at,'schema_version','offline-authority.v2','committable',true);
end
$function$;

create or replace function public.custodial_commit_offline_occurrence(
  p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text,
  p_client_started_at text, p_client_ended_at text, p_response_json jsonb, p_scan_evidence jsonb,
  p_correlation_id text, p_context_id text, p_submission_proof text, p_authenticated_credential_id text,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql security definer
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
  v_event_ids text[] := array[]::text[];
  v_reconciliation_id uuid;
  v_failure_detail text;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_client_session_id is null or length(v_client_session_id)>200 or v_client_completion_id is null or length(v_client_completion_id)>200 then
    return public.custodial_quarantine_offline_submission(p_client_session_id,p_client_completion_id,null,null,
      jsonb_build_object('response_json',coalesce(p_response_json,'null'::jsonb),'scan_evidence',coalesce(p_scan_evidence,'null'::jsonb)),
      'invalid_stable_submission_identity','{}'::jsonb,p_backend_execution_secret);
  end if;
  if jsonb_typeof(p_response_json) is distinct from 'object' or pg_column_size(coalesce(p_response_json,'null'::jsonb))>1048576
     or jsonb_typeof(p_scan_evidence) is distinct from 'array' or coalesce(jsonb_array_length(p_scan_evidence),0)>100
     or pg_column_size(coalesce(p_scan_evidence,'null'::jsonb))>1048576 then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,null,null,
      jsonb_build_object('response_json',coalesce(p_response_json,'null'::jsonb),'scan_evidence',coalesce(p_scan_evidence,'null'::jsonb)),
      'invalid_payload_shape_or_bounds','{}'::jsonb,p_backend_execution_secret);
  end if;
  begin
    v_context_id := nullif(lower(btrim(coalesce(p_context_id,''))), '')::uuid;
    v_credential_id := nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))), '')::uuid;
    v_started_at := nullif(btrim(coalesce(p_client_started_at,'')), '')::timestamptz;
    v_ended_at := nullif(btrim(coalesce(p_client_ended_at,'')), '')::timestamptz;
  exception when others then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,null,null,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'malformed_authority_or_timestamp',jsonb_build_object('context_id',p_context_id,'credential_id',p_authenticated_credential_id),p_backend_execution_secret);
  end;
  if not isfinite(v_started_at) or not isfinite(v_ended_at) or v_ended_at<=v_started_at or v_ended_at>now()+interval '10 minutes'
     or v_started_at<now()-interval '7 days' or v_ended_at-v_started_at>interval '24 hours' then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context_id,null,
      jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'invalid_occurrence_timestamps','{}'::jsonb,p_backend_execution_secret);
  end if;
  perform public.custodial_lock_offline_reconciliation_keys(v_client_session_id,v_client_completion_id);
  select * into v_context from public.custodial_offline_actor_contexts where context_id=v_context_id for update;
  if v_context.context_id is null then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,null,null,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'offline_actor_context_not_found','{}'::jsonb,p_backend_execution_secret);
  end if;
  v_payload_fingerprint := public.custodial_offline_payload_fingerprint(v_context,v_client_completion_id,v_started_at,v_ended_at,p_response_json,p_scan_evidence,p_correlation_id);
  select * into v_existing from public.custodial_offline_reconciliation_records where client_completion_id=v_client_completion_id or client_session_id=v_client_session_id order by case when client_completion_id=v_client_completion_id then 0 else 1 end limit 1 for update;
  if v_existing.reconciliation_id is not null then
    if v_existing.client_session_id=v_client_session_id and v_existing.client_completion_id=v_client_completion_id and v_existing.payload_fingerprint=v_payload_fingerprint then
      insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,evidence_json) values(v_existing.reconciliation_id,'replayed',jsonb_build_object('exact_payload_replay',true));
      return v_existing.result_json || jsonb_build_object('reconciliation_id',v_existing.reconciliation_id,'replayed',true);
    end if;
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'payload_fingerprint_conflict','{}'::jsonb,p_backend_execution_secret);
  end if;
  if v_context.client_session_id<>v_client_session_id or v_context.status<>'activated' or v_context.expires_at<=now()
     or upper(btrim(coalesce(p_device_id,'')))<>upper((select device_id from public.devices where id=v_context.device_id))
     or public.resolve_scan_location_code(p_location_code)<>v_context.canonical_location_code or v_context.credential_id<>v_credential_id or v_context.started_at<>v_started_at then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'context_binding_mismatch','{}'::jsonb,p_backend_execution_secret);
  end if;
  select * into v_proof from public.custodial_offline_submission_proofs where context_id=v_context.context_id for update;
  if v_proof.state<>'issued' or coalesce(p_submission_proof,'') !~ '^[0-9a-f]{64}$' or encode(extensions.digest(convert_to(lower(p_submission_proof),'UTF8'),'sha256'),'hex')<>v_proof.proof_digest then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'submission_proof_invalid','{}'::jsonb,p_backend_execution_secret);
  end if;
  select * into v_device from public.devices where id=v_context.device_id for update;
  select * into v_employee from public.employees where id=v_context.employee_id;
  select * into v_credential from public.device_auth_credentials where credential_id=v_context.credential_id;
  select l.id,l.location_code,l.location_name,l.location_type,l.form_type into v_location from public.locations l where l.id=v_context.location_id and l.active=true;
  if v_device.id is null or v_device.active is not true or v_employee.id is null or v_employee.active is not true or v_credential.credential_id is null or v_credential.device_id<>v_context.device_id or v_credential.confirmed_at is null or v_credential.revoked_at is not null or v_credential.expires_at<=now() or v_location.id is null or not exists(select 1 from public.custodial_employee_device_assignment_history h where h.assignment_change_id=v_context.assignment_change_id and h.device_id=v_context.device_id and h.new_employee_id=v_context.employee_id) then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'permanent_actor_or_credential_proof_loss','{}'::jsonb,p_backend_execution_secret);
  end if;
  begin
    for v_item in select value from jsonb_array_elements(p_scan_evidence) loop
      if jsonb_typeof(v_item)<>'object' or pg_column_size(v_item)>65536 or jsonb_typeof(v_item->'event_type')<>'string' or jsonb_typeof(v_item->'client_event_id')<>'string' or jsonb_typeof(v_item->'scanned_at')<>'string' then raise exception using errcode='22023',message='scan event shape is invalid'; end if;
      v_event_type := nullif(btrim(v_item->>'event_type'),''); v_event_id := nullif(btrim(v_item->>'client_event_id'),'');
      if v_event_type not in ('scan_received','scan_blocked','scan_start','scan_finish','scan_resume_pending','scan_invalid_location','scan_unauthorized_device','scan_error') or v_event_id is null or length(v_event_id)>200 or length(coalesce(v_item->>'result',''))>200 or length(coalesce(v_item->>'notes',''))>4000 or jsonb_typeof(coalesce(v_item->'payload_json','{}'::jsonb))<>'object' or pg_column_size(coalesce(v_item->'payload_json','{}'::jsonb))>32768 then raise exception using errcode='22023',message='scan event fields are invalid'; end if;
      v_event_time := (v_item->>'scanned_at')::timestamptz;
      if not isfinite(v_event_time) or v_event_time<v_started_at-interval '10 minutes' or v_event_time>v_ended_at+interval '10 minutes' then raise exception using errcode='22023',message='scan event timestamp is outside the occurrence window'; end if;
      if array_position(v_event_ids,v_event_id) is not null then raise exception using errcode='23505',message='duplicate scan event identity in one payload'; end if;
      v_event_ids := array_append(v_event_ids,v_event_id);
    end loop;
  exception when others then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'malformed_scan_evidence',jsonb_build_object('detail',sqlerrm),p_backend_execution_secret);
  end;
  for v_event_id in select unnest(v_event_ids) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('custodial-offline-event:'||v_event_id,0));
    if exists(select 1 from public.custodial_offline_scan_event_evidence where client_event_id=v_event_id) or exists(select 1 from public.scan_events where client_event_id=v_event_id) then
      return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'scan_event_identity_already_bound',jsonb_build_object('client_event_id',v_event_id),p_backend_execution_secret);
    end if;
  end loop;
  begin
    insert into public.custodial_offline_time_reservations(occurrence_id,employee_id,device_id,started_at,ended_at) values(v_context.occurrence_id,v_context.employee_id,v_context.device_id,v_started_at,v_ended_at);
    select * into v_session from public.sessions where client_session_id=v_client_session_id for update;
    if v_session.id is null then
      insert into public.sessions(session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes,duration_display,completion_source)
      values(gen_random_uuid()::text,v_client_session_id,v_context.location_id,v_context.employee_id,v_context.device_id,'pending_submit',v_started_at,v_ended_at,greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer),greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer)::text||' min','kiosk_form') returning * into v_session;
    elsif v_session.device_id<>v_context.device_id or v_session.employee_id<>v_context.employee_id or v_session.location_id<>v_context.location_id or v_session.status not in ('active','pending_submit') then raise exception using errcode='23514',message='server session is not bound to the activated occurrence';
    else
      update public.sessions set status='pending_submit',ended_at=v_ended_at,duration_minutes=greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer),duration_display=greatest(0,round(extract(epoch from(v_ended_at-v_started_at))/60.0)::integer)::text||' min' where id=v_session.id and status='active';
      select * into v_session from public.sessions where id=v_session.id;
    end if;
    insert into public.completion_responses(session_id,location_id,submitted_by_employee_id,device_id,response_json,submitted_at,client_completion_id) values(v_session.id,v_context.location_id,v_context.employee_id,v_context.device_id,p_response_json,now(),v_client_completion_id) returning id,submitted_at into v_completion_response_id,v_submitted_at;
    v_ticket_count := public.create_maintenance_tickets_from_response(v_completion_response_id,v_session.id,v_context.location_id,v_context.employee_id,v_context.device_id,v_submitted_at,p_response_json);
    update public.sessions set status='closed',completion_source='kiosk_form',updated_at=now() where id=v_session.id and status='pending_submit';
    if not found then raise exception using errcode='40001',message='session did not reach the canonical pending_submit state'; end if;
    v_result := jsonb_build_object('status','closed','terminal',true,'client_session_id',v_client_session_id,'client_completion_id',v_client_completion_id,'session_uuid',v_session.session_uuid,'completion_response_id',v_completion_response_id,'occurrence_id',v_context.occurrence_id,'original_employee_id',v_context.employee_id,'started_at',v_started_at,'ended_at',v_ended_at,'correlation_id',nullif(btrim(coalesce(p_correlation_id,'')),''),'maintenance_ticket_count',v_ticket_count,'replayed',false);
    insert into public.custodial_offline_reconciliation_records(context_id,occurrence_id,occurrence_fingerprint,original_employee_id,device_id,credential_id,location_id,client_session_id,client_completion_id,payload_fingerprint,payload_json,state,result_json,session_id,completion_response_id)
    values(v_context.context_id,v_context.occurrence_id,v_context.occurrence_fingerprint,v_context.employee_id,v_context.device_id,v_context.credential_id,v_context.location_id,v_client_session_id,v_client_completion_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'committed',v_result,v_session.id,v_completion_response_id) returning reconciliation_id into v_reconciliation_id;
    for v_item in select value from jsonb_array_elements(p_scan_evidence) loop
      v_event_type := v_item->>'event_type'; v_event_id := btrim(v_item->>'client_event_id'); v_event_time := (v_item->>'scanned_at')::timestamptz;
      v_event_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('client_event_id',v_event_id,'context_id',v_context.context_id::text,'device_id',v_context.device_id::text,'event_type',v_event_type,'location_id',v_context.location_id::text,'payload_json',coalesce(v_item->'payload_json','{}'::jsonb),'result',nullif(v_item->>'result',''),'scanned_at',v_event_time,'session_id',v_session.id::text,'notes',nullif(v_item->>'notes',''))::text,'UTF8'),'sha256'),'hex');
      insert into public.custodial_offline_scan_event_evidence(client_event_id,context_id,reconciliation_id,session_id,event_fingerprint,event_payload) values(v_event_id,v_context.context_id,v_reconciliation_id,v_session.id,v_event_fingerprint,v_item);
      insert into public.scan_events(scanned_at,location_id,location_code,device_id,device_identifier,session_id,event_type,result,notes,payload_json,client_event_id) values(v_event_time,v_context.location_id,v_context.canonical_location_code,v_context.device_id,v_device.device_id,v_session.id,v_event_type,nullif(v_item->>'result',''),nullif(v_item->>'notes',''),coalesce(v_item->'payload_json','{}'::jsonb)||jsonb_build_object('offline_occurrence_id',v_context.occurrence_id),v_event_id);
    end loop;
    update public.custodial_offline_actor_contexts set status='committed' where context_id=v_context.context_id and status='activated';
    update public.custodial_offline_submission_proofs set state='consumed',consumed_at=now() where context_id=v_context.context_id and state='issued';
    insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,evidence_json) values(v_reconciliation_id,'accepted',jsonb_build_object('occurrence_fingerprint',v_context.occurrence_fingerprint,'payload_fingerprint',v_payload_fingerprint));
  exception when exclusion_violation then
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'overlapping_employee_or_device_occurrence','{}'::jsonb,p_backend_execution_secret);
  when others then
    v_failure_detail := sqlerrm;
    return public.custodial_quarantine_offline_submission(v_client_session_id,v_client_completion_id,v_context.context_id,v_payload_fingerprint,jsonb_build_object('response_json',p_response_json,'scan_evidence',p_scan_evidence),'operational_commit_exception',jsonb_build_object('detail',v_failure_detail),p_backend_execution_secret);
  end;
  return v_result || jsonb_build_object('reconciliation_id',v_reconciliation_id);
end
$function$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  return jsonb_build_object('ok',true,'authority','offline-authority.v2','phase','C','configured',true);
end
$function$;

create or replace function public.custodial_quarantine_malformed_scan_http(
  p_request_digest text,
  p_authenticated_credential_id text,
  p_content_length integer,
  p_backend_execution_secret text
)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_digest text := lower(btrim(coalesce(p_request_digest,'')));
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_digest !~ '^[0-9a-f]{64}$' or nullif(lower(btrim(coalesce(p_authenticated_credential_id,''))), '')::uuid is null
     or coalesce(p_content_length, -1) < 0 or p_content_length > 10485760 then
    raise exception using errcode='22023',message='malformed HTTP quarantine requires a bounded request digest and authenticated credential';
  end if;
  return public.custodial_quarantine_offline_submission(
    'http-malformed-session:' || substr(v_digest,1,48),
    'http-malformed-completion:' || substr(v_digest,1,45),
    null,v_digest,
    jsonb_build_object('http_payload_digest',v_digest,'content_length',p_content_length,'authenticated_credential_id',p_authenticated_credential_id),
    'malformed_or_oversized_http_scan_request','{}'::jsonb,p_backend_execution_secret
  );
end
$function$;

create or replace function public.custodial_manager_dispose_offline_reconciliation(
  p_manager_id uuid,p_reconciliation_id uuid,p_disposition text,p_reason text,p_request_id uuid,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_fingerprint text; v_request_fingerprint text; v_existing public.custodial_offline_reconciliation_dispositions%rowtype; v_disposition_id uuid;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='named recovery manager authority is required'; end if;
  if p_request_id is null or p_disposition not in ('reviewed','retained_for_recovery','superseded_by_new_occurrence') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception using errcode='22023',message='stable disposition request identity, disposition, and reason are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-offline-disposition:'||p_manager_id::text||':'||p_request_id::text,0));
  v_request_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('reconciliation_id',p_reconciliation_id,'disposition',p_disposition,'reason',btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.custodial_offline_reconciliation_dispositions where manager_id=p_manager_id and request_id=p_request_id for update;
  if v_existing.disposition_id is not null then
    if v_existing.request_fingerprint<>v_request_fingerprint then raise exception using errcode='23505',message='disposition request identity is already bound to a different recovery outcome'; end if;
    return jsonb_build_object('disposition_id',v_existing.disposition_id,'reconciliation_id',v_existing.reconciliation_id,'immutable_original_evidence_fingerprint',v_existing.original_evidence_fingerprint,'replayed',true);
  end if;
  select encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') into v_fingerprint from public.custodial_offline_reconciliation_records r where r.reconciliation_id=p_reconciliation_id;
  if v_fingerprint is null then raise exception using errcode='P0002',message='offline reconciliation not found'; end if;
  insert into public.custodial_offline_reconciliation_dispositions(reconciliation_id,manager_id,disposition,reason,original_evidence_fingerprint,request_id,request_fingerprint) values(p_reconciliation_id,p_manager_id,p_disposition,btrim(p_reason),v_fingerprint,p_request_id,v_request_fingerprint) returning disposition_id into v_disposition_id;
  insert into public.custodial_offline_reconciliation_audits(reconciliation_id,event_type,actor_manager_id,reason,evidence_json) values(p_reconciliation_id,'disposition_recorded',p_manager_id,btrim(p_reason),jsonb_build_object('disposition_id',v_disposition_id,'disposition',p_disposition,'request_id',p_request_id));
  return jsonb_build_object('disposition_id',v_disposition_id,'reconciliation_id',p_reconciliation_id,'immutable_original_evidence_fingerprint',v_fingerprint,'replayed',false);
end
$function$;

create or replace function public.custodial_manager_dispose_offline_reconciliation(
  p_manager_id uuid,p_reconciliation_id uuid,p_disposition text,p_reason text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$ begin raise exception using errcode='0A000',message='A stable disposition request_id is required by the offline authority recovery command'; end $function$;

-- The service transport may read operational state, but it cannot forge it.
revoke all on table public.sessions,public.completion_responses,public.scan_events,public.maintenance_tickets,
  public.custodial_backend_execution_config,public.custodial_offline_actor_contexts,public.custodial_offline_submission_proofs,
  public.custodial_offline_reconciliation_records,public.custodial_offline_reconciliation_audits,public.custodial_offline_scan_event_evidence,
  public.custodial_offline_time_reservations,public.custodial_offline_reconciliation_dispositions,public.custodial_offline_reconciliation_outbox
from service_role;
grant select on table public.sessions,public.completion_responses,public.scan_events,public.maintenance_tickets to service_role;

revoke all on function public.complete_session(text,jsonb,text,text,text),public.record_scan_event(text,text,text,text,text,jsonb,text),
  public.start_session(text,text,text,text),public.start_session_v2(text,text,text,timestamptz,text),public.finish_session(text,text),
  public.force_close_session(text,text,text),public.tool_force_close_session(text,text,text),public.tool_record_scan_event(text,text,text,text,text,jsonb,text),
  public.tool_start_session(text,text,text,text),public.tool_start_session_v2(text,text,text,timestamptz,text),public.tool_finish_session(text,text),
  public.tool_finish_session_exact(text,text,uuid,timestamptz),public.tool_complete_session(text,jsonb,text,text,text)
from public,anon,authenticated,service_role;
revoke all on function public.custodial_truncate_offline_evidence_for_maintenance(regclass,text),
  public.custodial_lock_offline_reconciliation_keys(text,text),public.custodial_enqueue_offline_reconciliation_notification(uuid),
  public.custodial_backend_authority_health(text),public.custodial_quarantine_malformed_scan_http(text,text,integer,text),public.custodial_manager_dispose_offline_reconciliation(uuid,uuid,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.tool_start_offline_occurrence(text,text,text,text,text,text),
  public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),
  public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),
  public.custodial_manager_list_offline_reconciliations(uuid,integer,timestamptz,text),
  public.custodial_manager_get_offline_reconciliation(uuid,uuid,text),
  public.custodial_manager_dispose_offline_reconciliation(uuid,uuid,text,text,uuid,text),
  public.custodial_backend_authority_health(text),public.custodial_quarantine_malformed_scan_http(text,text,integer,text)
to service_role;
grant execute on function public.custodial_truncate_offline_evidence_for_maintenance(regclass,text) to postgres;

commit;
