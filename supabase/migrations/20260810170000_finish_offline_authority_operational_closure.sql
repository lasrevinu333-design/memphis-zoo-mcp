begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Phase D completes the operational boundary.  A start proof is durable so a
-- lost response can be recovered by the exact authenticated start command;
-- reconciliation notifications have their own small leased state machine.

alter table public.custodial_offline_submission_proofs
  add column if not exists issued_submission_proof text;
alter table public.custodial_offline_submission_proofs
  drop constraint if exists custodial_offline_submission_proofs_issued_submission_proof_check;
alter table public.custodial_offline_submission_proofs
  add constraint custodial_offline_submission_proofs_issued_submission_proof_check
  check (issued_submission_proof is null or issued_submission_proof ~ '^[0-9a-f]{64}$');

alter table public.custodial_offline_reconciliation_outbox
  add column if not exists disposition_id uuid references public.custodial_offline_reconciliation_dispositions(disposition_id) on delete restrict,
  add column if not exists attempts integer not null default 0,
  add column if not exists claimed_by text,
  add column if not exists lease_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists failed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists delivery_json jsonb not null default '{}'::jsonb;
alter table public.custodial_offline_reconciliation_outbox
  drop constraint if exists custodial_offline_reconciliation_outbox_notification_kind_check;
alter table public.custodial_offline_reconciliation_outbox
  add constraint custodial_offline_reconciliation_outbox_notification_kind_check
  check (notification_kind in ('offline_reconciliation_quarantine','offline_reconciliation_disposition'));
alter table public.custodial_offline_reconciliation_outbox
  drop constraint if exists custodial_offline_reconciliation_outbox_state_check;
alter table public.custodial_offline_reconciliation_outbox
  add constraint custodial_offline_reconciliation_outbox_state_check
  check (state in ('pending','claimed','delivered','failed'));
alter table public.custodial_offline_reconciliation_outbox
  drop constraint if exists custodial_offline_reconciliation_outbox_attempts_check;
alter table public.custodial_offline_reconciliation_outbox
  add constraint custodial_offline_reconciliation_outbox_attempts_check
  check (attempts >= 0 and attempts <= 5);
create unique index if not exists uq_custodial_offline_disposition_notification
  on public.custodial_offline_reconciliation_outbox(disposition_id, notification_kind)
  where disposition_id is not null;
create index if not exists idx_custodial_offline_outbox_claimable
  on public.custodial_offline_reconciliation_outbox(state, next_attempt_at, created_at);

-- The prior outbox trigger intentionally made every row immutable.  Delivery
-- state is operational evidence, so only a backend-secret-bearing canonical
-- claim/finish command may advance it; payload and identity remain immutable.
create or replace function public.custodial_reject_offline_outbox_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='Custodial offline notification evidence is append-only';
  end if;
  if not public.custodial_backend_transition_allowed() then
    raise exception using errcode='23514', message='Custodial offline notification state is mutable only by the canonical delivery worker';
  end if;
  if new.outbox_id is distinct from old.outbox_id
     or new.reconciliation_id is distinct from old.reconciliation_id
     or new.disposition_id is distinct from old.disposition_id
     or new.notification_key is distinct from old.notification_key
     or new.notification_kind is distinct from old.notification_kind
     or new.payload_json is distinct from old.payload_json
     or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514', message='Custodial offline notification identity and payload are immutable';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_custodial_offline_outbox_immutable on public.custodial_offline_reconciliation_outbox;
create trigger trg_custodial_offline_outbox_immutable
before update or delete on public.custodial_offline_reconciliation_outbox
for each row execute function public.custodial_reject_offline_outbox_mutation();

create or replace function public.custodial_enqueue_offline_reconciliation_notification(
  p_reconciliation_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  insert into public.custodial_offline_reconciliation_outbox(
    reconciliation_id, notification_key, notification_kind, payload_json, next_attempt_at
  )
  select r.reconciliation_id,
         'offline-reconciliation:quarantine:' || r.reconciliation_id::text,
         'offline_reconciliation_quarantine',
         jsonb_build_object(
           'reconciliation_id', r.reconciliation_id,
           'state', r.state,
           'reason', r.quarantine_reason,
           'created_at', r.created_at
         ),
         now()
  from public.custodial_offline_reconciliation_records r
  where r.reconciliation_id = p_reconciliation_id
    and r.state = 'quarantined'
  on conflict (reconciliation_id, notification_kind) do nothing;
end
$function$;

create or replace function public.custodial_enqueue_offline_reconciliation_disposition_notice(
  p_disposition_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  insert into public.custodial_offline_reconciliation_outbox(
    reconciliation_id, disposition_id, notification_key, notification_kind, payload_json, next_attempt_at
  )
  select d.reconciliation_id,
         d.disposition_id,
         'offline-reconciliation:disposition:' || d.disposition_id::text,
         'offline_reconciliation_disposition',
         jsonb_build_object(
           'reconciliation_id', d.reconciliation_id,
           'disposition_id', d.disposition_id,
           'disposition', d.disposition,
           'reason', d.reason,
           'manager_id', d.manager_id,
           'created_at', d.created_at
         ),
         now()
  from public.custodial_offline_reconciliation_dispositions d
  where d.disposition_id = p_disposition_id
  on conflict (disposition_id, notification_kind) where disposition_id is not null do nothing;
end
$function$;

create or replace function public.custodial_claim_offline_reconciliation_notifications(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer,
  p_backend_execution_secret text
)
returns table(
  outbox_id uuid, reconciliation_id uuid, disposition_id uuid, notification_kind text,
  payload_json jsonb, attempts integer, lease_token uuid, lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 120), 900));
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_worker_id is null or length(v_worker_id) > 200 then
    raise exception using errcode='22023', message='a bounded notification worker identity is required';
  end if;
  update public.custodial_offline_reconciliation_outbox o
  set state = 'pending', claimed_by = null, lease_token = null, claimed_at = null,
      lease_expires_at = null, next_attempt_at = now(),
      last_error = coalesce(o.last_error, 'delivery lease expired')
  where o.state = 'claimed' and o.lease_expires_at <= now();
  return query
  with candidates as (
    select o.outbox_id
    from public.custodial_offline_reconciliation_outbox o
    where o.state = 'pending' and o.next_attempt_at <= now()
    order by o.created_at, o.outbox_id
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.custodial_offline_reconciliation_outbox o
    set state = 'claimed', claimed_by = v_worker_id, lease_token = gen_random_uuid(),
        claimed_at = now(), lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        attempts = o.attempts + 1
    from candidates c
    where o.outbox_id = c.outbox_id
    returning o.*
  )
  select c.outbox_id, c.reconciliation_id, c.disposition_id, c.notification_kind,
         c.payload_json, c.attempts, c.lease_token, c.lease_expires_at
  from claimed c
  order by c.created_at, c.outbox_id;
end
$function$;

create or replace function public.custodial_finish_offline_reconciliation_notification(
  p_outbox_id uuid,
  p_worker_id text,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text,
  p_retry_seconds integer,
  p_terminal boolean,
  p_delivery_json jsonb,
  p_backend_execution_secret text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_outbox public.custodial_offline_reconciliation_outbox%rowtype;
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_error text := nullif(left(btrim(coalesce(p_error, '')), 2000), '');
  v_retry_seconds integer := greatest(15, least(coalesce(p_retry_seconds, 60), 3600));
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select * into v_outbox
  from public.custodial_offline_reconciliation_outbox
  where outbox_id = p_outbox_id
  for update;
  if v_outbox.outbox_id is null then
    raise exception using errcode='P0002', message='offline reconciliation notification was not found';
  end if;
  if v_worker_id is null or v_outbox.state <> 'claimed'
     or v_outbox.claimed_by <> v_worker_id
     or v_outbox.lease_token is distinct from p_lease_token
     or v_outbox.lease_expires_at <= now() then
    raise exception using errcode='40901', message='notification claim is no longer owned by this worker';
  end if;
  if p_succeeded is true then
    update public.custodial_offline_reconciliation_outbox
    set state = 'delivered', delivered_at = now(), failed_at = null,
        claimed_by = null, lease_token = null, claimed_at = null, lease_expires_at = null,
        last_error = null, delivery_json = coalesce(p_delivery_json, '{}'::jsonb)
    where outbox_id = v_outbox.outbox_id;
  elsif p_terminal is true or v_outbox.attempts >= 5 then
    update public.custodial_offline_reconciliation_outbox
    set state = 'failed', failed_at = now(), claimed_by = null, lease_token = null,
        claimed_at = null, lease_expires_at = null,
        last_error = coalesce(v_error, 'notification delivery reached terminal failure'),
        delivery_json = coalesce(p_delivery_json, '{}'::jsonb)
    where outbox_id = v_outbox.outbox_id;
  else
    update public.custodial_offline_reconciliation_outbox
    set state = 'pending', claimed_by = null, lease_token = null, claimed_at = null,
        lease_expires_at = null, next_attempt_at = now() + make_interval(secs => v_retry_seconds),
        last_error = coalesce(v_error, 'notification delivery failed')
    where outbox_id = v_outbox.outbox_id;
  end if;
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id = v_outbox.outbox_id;
  return jsonb_build_object('outbox_id', v_outbox.outbox_id, 'state', v_outbox.state,
    'attempts', v_outbox.attempts, 'terminal', v_outbox.state in ('delivered', 'failed'),
    'next_attempt_at', v_outbox.next_attempt_at, 'failed_at', v_outbox.failed_at);
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
  v_proof public.custodial_offline_submission_proofs%rowtype;
  v_assignment_change_id uuid;
  v_proof_value text := encode(extensions.gen_random_bytes(32), 'hex');
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
    select * into v_proof from public.custodial_offline_submission_proofs where context_id=v_existing.context_id for update;
    if v_proof.state = 'issued' and v_proof.issued_submission_proof is not null then
      return jsonb_build_object('context_id',v_existing.context_id,'occurrence_id',v_existing.occurrence_id,'client_session_id',v_existing.client_session_id,
        'canonical_location_code',v_existing.canonical_location_code,'location_aliases',v_existing.location_aliases,'started_at',v_existing.started_at,
        'submission_proof',v_proof.issued_submission_proof,'expires_at',v_existing.expires_at,'schema_version','offline-authority.v3','committable',true,'replayed',true);
    end if;
    raise exception using errcode='40901', message='the legacy occurrence cannot recover a completion proof; create a manager-visible recovery disposition';
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
  insert into public.custodial_offline_submission_proofs(context_id,proof_digest,issued_submission_proof)
  values(v_context.context_id,encode(extensions.digest(convert_to(v_proof_value,'UTF8'),'sha256'),'hex'),v_proof_value);
  return jsonb_build_object('context_id',v_context.context_id,'occurrence_id',v_context.occurrence_id,'client_session_id',v_context.client_session_id,
    'canonical_location_code',v_context.canonical_location_code,'location_aliases',v_context.location_aliases,'started_at',v_context.started_at,
    'submission_proof',v_proof_value,'expires_at',v_context.expires_at,'schema_version','offline-authority.v3','committable',true,'replayed',false);
end
$function$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  return jsonb_build_object('ok',true,'authority','offline-authority.v3','phase','D','configured',true,
    'durable_start_proof_replay',true,'reconciliation_notification_lifecycle',true);
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
  perform public.custodial_enqueue_offline_reconciliation_disposition_notice(v_disposition_id);
  return jsonb_build_object('disposition_id',v_disposition_id,'reconciliation_id',p_reconciliation_id,'immutable_original_evidence_fingerprint',v_fingerprint,'replayed',false);
end
$function$;

-- The application no longer submits SQL.  This finite operational command
-- surface carries typed JSON values only; every branch below is deliberately
-- named and contains no dynamic SQL execution.
create or replace function public.app_apply_operational_command(
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_command text := nullif(btrim(coalesce(p_command, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_id uuid;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode='22023', message='operational command payload must be an object';
  end if;
  if v_command = 'public_rate_limit' then
    if coalesce(v_payload->>'bucket_key','') !~ '^[0-9a-f]{64}$' or length(coalesce(v_payload->>'scope','')) not between 1 and 80 then
      raise exception using errcode='22023', message='bounded rate-limit key and scope are required';
    end if;
    insert into public.public_submission_rate_limits(bucket_key,scope,window_started_at,request_count,updated_at)
    values(v_payload->>'bucket_key',v_payload->>'scope',now(),1,now())
    on conflict(bucket_key) do update set
      scope=excluded.scope,
      window_started_at=case when public.public_submission_rate_limits.window_started_at <= now()-interval '60 seconds' then now() else public.public_submission_rate_limits.window_started_at end,
      request_count=case when public.public_submission_rate_limits.window_started_at <= now()-interval '60 seconds' then 1 else public.public_submission_rate_limits.request_count+1 end,
      updated_at=now();
    return jsonb_build_object('ok',true);
  elsif v_command = 'attendance_state_upsert' then
    insert into public.current_attendance_state(id,attendance,last_year,planned,yesterday,yesterday_plan,source,fetched_at,updated_at)
    values(1,(v_payload->>'attendance')::integer,nullif(v_payload->>'last_year','')::integer,nullif(v_payload->>'planned','')::integer,
      nullif(v_payload->>'yesterday','')::integer,nullif(v_payload->>'yesterday_plan','')::integer,nullif(v_payload->>'source',''),
      nullif(v_payload->>'fetched_at','')::timestamptz,now())
    on conflict(id) do update set attendance=excluded.attendance,last_year=excluded.last_year,planned=excluded.planned,
      yesterday=excluded.yesterday,yesterday_plan=excluded.yesterday_plan,source=excluded.source,fetched_at=excluded.fetched_at,updated_at=now();
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_create' then
    insert into public.guest_cleanliness_reports(
      id,operation_id,request_fingerprint,location_code,location_name,issue_type,severity,notes,status,marketing_review_status,notification_status,metadata_json
    ) values(
      (v_payload->>'id')::uuid,(v_payload->>'operation_id')::uuid,v_payload->>'request_fingerprint',v_payload->>'location_code',
      nullif(v_payload->>'location_name',''),v_payload->>'issue_type',v_payload->>'severity',nullif(v_payload->>'notes',''),
      'pending_marketing_review','pending','awaiting_marketing_review',coalesce(v_payload->'metadata_json','{}'::jsonb)
    ) on conflict(operation_id) do nothing;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_notification' then
    update public.guest_cleanliness_reports set
      notification_status=v_payload->>'notification_status', notified_employee_user_id=nullif(v_payload->>'notified_employee_user_id','')::uuid,
      notified_ops_count=coalesce((v_payload->>'notified_ops_count')::integer,0),
      dispatched_at=case when coalesce((v_payload->>'delivered_count')::integer,0)>0 then now() else dispatched_at end,
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_errors',coalesce(v_payload->'notification_errors','[]'::jsonb))
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_review' then
    if v_payload->>'action' = 'approve' then
      update public.guest_cleanliness_reports set marketing_review_status='approved',marketing_reviewed_at=now(),
        marketing_reviewed_by=v_payload->>'actor',marketing_review_notes=nullif(v_payload->>'notes',''),status='open',notification_status='pending'
      where id=(v_payload->>'id')::uuid and status='pending_marketing_review' and marketing_review_status='pending';
      insert into public.operational_notification_jobs(job_key,job_type,source_id,payload_json)
      select 'guest-report:'||id::text,'guest_cleanliness_report',id,jsonb_build_object('operation_id',operation_id,'marketing_approved',true)
      from public.guest_cleanliness_reports where id=(v_payload->>'id')::uuid and status='open' and marketing_review_status='approved'
      on conflict(job_key) do nothing;
    elsif v_payload->>'action' = 'reject' then
      update public.guest_cleanliness_reports set marketing_review_status='rejected',marketing_reviewed_at=now(),
        marketing_reviewed_by=v_payload->>'actor',marketing_review_notes=nullif(v_payload->>'notes',''),status='rejected',resolved_at=now(),
        resolved_by=v_payload->>'actor',notification_status='not_dispatched'
      where id=(v_payload->>'id')::uuid and status='pending_marketing_review' and marketing_review_status='pending';
    else
      raise exception using errcode='22023', message='guest report review action is unsupported';
    end if;
    return jsonb_build_object('ok',true);
  elsif v_command = 'guest_report_resolve' then
    update public.guest_cleanliness_reports set status='resolved',resolved_at=now(),resolved_by=v_payload->>'actor',
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('resolution_notes',nullif(v_payload->>'notes',''))
    where id=(v_payload->>'id')::uuid and status='open' and marketing_review_status='approved';
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_legacy_image_migration' then
    update public.system_feedback_items set metadata_json=coalesce(v_payload->'metadata_json','{}'::jsonb),updated_at=now()
    where id=(v_payload->>'id')::uuid and metadata_json->'image_attachment'->>'data_url' is not null;
    update public.system_feedback_legacy_image_backups set migrated_at=now(),storage_bucket=v_payload->>'storage_bucket',storage_path=v_payload->>'storage_path'
    where feedback_id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_create' then
    insert into public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,device_id,page_url,summary,metadata_json)
    values((v_payload->>'id')::uuid,(v_payload->>'operation_id')::uuid,v_payload->>'request_fingerprint',v_payload->>'category',
      v_payload->>'priority',v_payload->>'message',nullif(v_payload->>'submitted_by',''),v_payload->>'hub_context',nullif(v_payload->>'device_id',''),
      nullif(v_payload->>'page_url',''),v_payload->>'summary',coalesce(v_payload->'metadata_json','{}'::jsonb))
    on conflict(operation_id) do nothing;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_notification' then
    update public.system_feedback_items set notification_status=v_payload->>'notification_status',
      notified_ops_count=coalesce(notified_ops_count,0)+coalesce((v_payload->>'notified_ops_count')::integer,0),last_feedback_reminder_at=now(),
      feedback_reminder_count=coalesce(feedback_reminder_count,0)+coalesce((v_payload->>'reminder_increment')::integer,0),updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_errors',coalesce(v_payload->'notification_errors','[]'::jsonb))
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_status' then
    update public.system_feedback_items set status=v_payload->>'status',
      acknowledged_at=case when v_payload->>'status'='acknowledged' then now() else acknowledged_at end,
      acknowledged_by=case when v_payload->>'status'='acknowledged' then v_payload->>'actor' else acknowledged_by end,
      updated_at=now(),metadata_json=coalesce(metadata_json,'{}'::jsonb)||coalesce(v_payload->'metadata_patch','{}'::jsonb)
    where id=(v_payload->>'id')::uuid and status not in ('closed','resolved');
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_reminder_exhausted' then
    update public.system_feedback_items set status='reminder_exhausted',updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('reminder_exhausted_reason',v_payload->>'reason')
    where id=(v_payload->>'id')::uuid and status not in ('acknowledged','resolved','closed');
    return jsonb_build_object('ok',true);
  elsif v_command = 'feedback_dashboard_only' then
    update public.system_feedback_items set notification_status='dashboard_only',notified_ops_count=0,updated_at=now(),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('notification_delivery','dashboard_only')
    where id=(v_payload->>'id')::uuid;
    return jsonb_build_object('ok',true);
  end if;
  raise exception using errcode='22023', message='unsupported bounded operational command';
end
$function$;

create or replace function public.app_apply_event_command(
  p_command text,
  p_event_id uuid,
  p_record jsonb,
  p_actor text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_command text := nullif(btrim(coalesce(p_command, '')), '');
  v_record jsonb := coalesce(p_record, '{}'::jsonb);
  v_row public.events_app_events%rowtype;
  v_previous jsonb;
  v_actor text := left(coalesce(nullif(btrim(p_actor), ''), 'Input Console'), 200);
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'Event updated from Event Input Console.'), 1000);
begin
  if jsonb_typeof(v_record) <> 'object' then raise exception using errcode='22023', message='event command record must be an object'; end if;
  if v_command = 'create' then
    insert into public.events_app_events(
      event_name,location_group_id,event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,staffing_area_ids,
      source_location_text,parser_confidence,needs_review,parse_reason,source_text,source_format,manually_overridden,overridden_by,
      overridden_at,event_timezone,operation_id,event_date,end_date,start_time,end_time,attendee_count,notes,created_by,updated_at
    ) values(
      v_record->>'event_name',(v_record->>'location_group_id')::uuid,v_record->>'event_scope',nullif(v_record->>'primary_venue_id','')::uuid,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),v_record->>'display_location',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      nullif(v_record->>'source_location_text',''),nullif(v_record->>'parser_confidence',''),coalesce((v_record->>'needs_review')::boolean,false),
      nullif(v_record->>'parse_reason',''),nullif(v_record->>'source_text',''),nullif(v_record->>'source_format',''),
      coalesce((v_record->>'manually_overridden')::boolean,false),nullif(v_record->>'overridden_by',''),nullif(v_record->>'overridden_at','')::timestamptz,
      coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),nullif(v_record->>'operation_id','')::uuid,(v_record->>'event_date')::date,
      (v_record->>'end_date')::date,(v_record->>'start_time')::time,(v_record->>'end_time')::time,nullif(v_record->>'attendee_count','')::integer,
      nullif(v_record->>'notes',''),nullif(v_record->>'created_by',''),now()
    ) on conflict(operation_id) where operation_id is not null do update set updated_at=public.events_app_events.updated_at
    returning * into v_row;
    return to_jsonb(v_row);
  elsif v_command = 'update' then
    select to_jsonb(e.*) into v_previous from public.events_app_events e where e.id=p_event_id for update;
    if v_previous is null then raise exception using errcode='P0002', message='event not found'; end if;
    update public.events_app_events set
      event_name=v_record->>'event_name',location_group_id=(v_record->>'location_group_id')::uuid,event_scope=v_record->>'event_scope',
      primary_venue_id=nullif(v_record->>'primary_venue_id','')::uuid,
      venue_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      display_location=v_record->>'display_location',
      coverage_location_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      staffing_area_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      source_location_text=nullif(v_record->>'source_location_text',''),parser_confidence=nullif(v_record->>'parser_confidence',''),
      needs_review=coalesce((v_record->>'needs_review')::boolean,false),parse_reason=nullif(v_record->>'parse_reason',''),
      source_text=nullif(v_record->>'source_text',''),source_format=nullif(v_record->>'source_format',''),manually_overridden=true,
      overridden_by=v_actor,overridden_at=now(),event_timezone=coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),
      event_date=(v_record->>'event_date')::date,end_date=(v_record->>'end_date')::date,start_time=(v_record->>'start_time')::time,
      end_time=(v_record->>'end_time')::time,attendee_count=nullif(v_record->>'attendee_count','')::integer,notes=nullif(v_record->>'notes',''),
      revision=coalesce(revision,1)+1,updated_at=now()
    where id=p_event_id returning * into v_row;
    insert into public.events_app_event_history(event_id,action,actor,reason,previous_record,new_record,created_at)
    values(v_row.id,'update',v_actor,v_reason,v_previous,to_jsonb(v_row),now());
    return to_jsonb(v_row);
  elsif v_command = 'cancel' then
    select to_jsonb(e.*) into v_previous from public.events_app_events e where e.id=p_event_id for update;
    if v_previous is null then raise exception using errcode='P0002', message='event not found'; end if;
    update public.events_app_events set status='CANCELLED',cancelled_at=coalesce(cancelled_at,now()),cancelled_by=v_actor,
      cancellation_reason=v_reason,revision=coalesce(revision,1)+1,updated_at=now()
    where id=p_event_id returning * into v_row;
    insert into public.events_app_event_history(event_id,action,actor,reason,previous_record,new_record,created_at)
    values(v_row.id,'cancel',v_actor,v_reason,v_previous,to_jsonb(v_row),now());
    return to_jsonb(v_row);
  end if;
  raise exception using errcode='22023', message='unsupported bounded event command';
end
$function$;

-- Scheduler writes are similarly a finite, typed command set.  The static
-- weekly optimizer remains untouched; these commands only replace the former
-- transport-level SQL executor used by operational schedule routes.
create or replace function public.app_apply_schedule_command(
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_command text := nullif(btrim(coalesce(p_command, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_item jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_date date;
  v_assignment public.daily_schedule_assignments%rowtype;
begin
  if jsonb_typeof(v_payload) <> 'object' then raise exception using errcode='22023', message='schedule command payload must be an object'; end if;
  if v_command = 'sch2_guarded_publish' then
    return public.sch2_publish_solution((v_payload->>'run_id')::uuid, true);
  elsif v_command = 'coverall_assignment_link_issue' then
    update public.coverall_assignment_links set revoked_at=now(),revoked_by=left(v_payload->>'created_by',160)
    where service_date=(v_payload->>'service_date')::date and slot_code=v_payload->>'slot_code' and revoked_at is null;
    insert into public.coverall_assignment_links(id,token_hash,service_date,slot_code,created_by,expires_at)
    values((v_payload->>'id')::uuid,v_payload->>'token_hash',(v_payload->>'service_date')::date,v_payload->>'slot_code',left(v_payload->>'created_by',160),(v_payload->>'expires_at')::timestamptz)
    returning to_jsonb(coverall_assignment_links) into v_rows;
    return v_rows;
  elsif v_command = 'coverall_assignment_link_revoke' then
    with updated as (
      update public.coverall_assignment_links set revoked_at=now(),revoked_by=left(v_payload->>'revoked_by',160)
      where service_date=(v_payload->>'service_date')::date and slot_code=v_payload->>'slot_code' and revoked_at is null
      returning id
    ) select coalesce(jsonb_agg(to_jsonb(updated)),'[]'::jsonb) into v_rows from updated;
    return v_rows;
  elsif v_command = 'coverall_slots_publish' then
    v_date := (v_payload->>'service_date')::date;
    for v_item in select value from jsonb_array_elements(coalesce(v_payload->'operations','[]'::jsonb)) loop
      if coalesce((v_item->>'active')::boolean,false) then
        insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,notes,active)
        values(v_date,(v_item->>'employee_id')::uuid,(v_item->>'shift_start')::time,(v_item->>'shift_end')::time,'coverall_manual',nullif(v_item->>'notes',''),true)
        on conflict(service_date,employee_id) do update set shift_start=excluded.shift_start,shift_end=excluded.shift_end,
          source_type=excluded.source_type,notes=excluded.notes,active=true,updated_at=now();
      else
        update public.daily_work_roster set active=false,updated_at=now(),
          notes=trim(concat_ws(' ',nullif(notes,''),'CoverAll slot removed from scheduler.'))
        where service_date=v_date and employee_id=(v_item->>'employee_id')::uuid;
      end if;
    end loop;
    return jsonb_build_object('ok',true);
  elsif v_command = 'coverall_load_balance' then
    v_date := (v_payload->>'service_date')::date;
    for v_item in select value from jsonb_array_elements(coalesce(v_payload->'moves','[]'::jsonb)) loop
      update public.daily_schedule_assignments set assigned_employee_id=(v_item->>'to_employee_id')::uuid,owner_type='EMPLOYEE',status='ASSIGNED',
        source_type='coverall_manual_balance',notes=trim(concat_ws(' ',nullif(notes,''),'Balanced to '||coalesce(v_item->>'to_employee_name','CoverAll')||' from '||coalesce(v_item->>'from_employee_name','previous owner')||' for extra CoverAll help.')),
        updated_at=now()
      where id=(v_item->>'assignment_id')::uuid and service_date=v_date;
    end loop;
    return jsonb_build_object('ok',true);
  elsif v_command = 'restroom_rebalance_0945' then
    v_date := (v_payload->>'service_date')::date;
    perform pg_advisory_xact_lock(hashtextextended(coalesce(v_payload->>'source','restroom_rebalance_0945')||':'||v_date::text,0));
    for v_item in select value from jsonb_array_elements(coalesce(v_payload->'moves','[]'::jsonb)) loop
      update public.daily_schedule_assignments dsa set assigned_employee_id=(v_item->>'to_employee_id')::uuid,owner_type='EMPLOYEE',status='ASSIGNED',
        source_type=coalesce(v_payload->>'source','restroom_rebalance_0945'),
        notes=trim(concat_ws(' ',nullif(dsa.notes,''),coalesce(v_payload->>'note','Restroom rebalance.')||' From '||coalesce(v_item->>'from_employee_name','previous owner')||' to '||coalesce(v_item->>'to_employee_name','new owner')||'.')),
        updated_at=now()
      where dsa.id=(v_item->>'assignment_id')::uuid and dsa.service_date=v_date and dsa.status='ASSIGNED' and dsa.owner_type='EMPLOYEE'
        and dsa.assigned_employee_id=(v_item->>'from_employee_id')::uuid and coalesce(dsa.coverage_purpose,'')<>'lunch_coverage'
        and coalesce(dsa.source_type,'') not ilike '%manual%' and coalesce(dsa.source_type,'') not ilike '%override%' and coalesce(dsa.source_type,'') not ilike '%manager%'
        and exists(select 1 from public.daily_work_roster r where r.service_date=dsa.service_date and r.employee_id=(v_item->>'to_employee_id')::uuid and r.active=true and r.shift_start<=dsa.coverage_start and r.shift_end>=dsa.coverage_end)
        and not public.sch_is_employee_location_group_restricted((v_item->>'to_employee_id')::uuid,dsa.location_group_id,extract(dow from dsa.service_date)::integer)
      returning * into v_assignment;
      if v_assignment.id is not null then
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('assignment_id',v_assignment.id,'assigned_employee_id',v_assignment.assigned_employee_id,'status',v_assignment.status,'owner_type',v_assignment.owner_type,'source_type',v_assignment.source_type));
      end if;
    end loop;
    return v_rows;
  elsif v_command = 'restroom_rebalance_completion' then
    insert into public.schedule_automation_runs(automation_key,service_date,status,result_json,updated_at)
    values(coalesce(v_payload->>'automation_key','restroom_rebalance_0945'),(v_payload->>'service_date')::date,v_payload->>'status',coalesce(v_payload->'result','{}'::jsonb),now())
    on conflict(automation_key,service_date) do update set status=excluded.status,result_json=excluded.result_json,updated_at=now();
    return jsonb_build_object('ok',true);
  elsif v_command = 'coverall_assignment_apply' then
    v_date := (v_payload->>'service_date')::date;
    if jsonb_array_length(coalesce(v_payload->'assignments','[]'::jsonb)) = 0 then return jsonb_build_object('ok',true); end if;
    insert into public.daily_work_roster(service_date,employee_id,shift_start,shift_end,source_type,notes,active,created_at,updated_at)
    select v_date,(v_payload->>'employee_id')::uuid,min((x->>'coverage_start')::time),max((x->>'coverage_end')::time),'coverall',
      'Call CoverAll: 3+ custodial absences detected. CoverAll fills the 3rd and later absence workload.',true,now(),now()
    from jsonb_array_elements(v_payload->'assignments') x
    on conflict(service_date,employee_id) do update set shift_start=least(public.daily_work_roster.shift_start,excluded.shift_start),
      shift_end=greatest(public.daily_work_roster.shift_end,excluded.shift_end),active=true,updated_at=now(),notes=excluded.notes;
    for v_item in select value from jsonb_array_elements(v_payload->'assignments') loop
      update public.daily_schedule_assignments set assigned_employee_id=(v_payload->>'employee_id')::uuid,owner_type='EMPLOYEE',status='ASSIGNED',source_type='coverall_escalation',
        notes=trim(concat_ws(' ',nullif(notes,''),'Call CoverAll: assigned due to 3+ custodial absences.')),updated_at=now()
      where service_date=v_date and location_group_id=(v_item->>'location_group_id')::uuid and coverage_start=(v_item->>'coverage_start')::time and coverage_end=(v_item->>'coverage_end')::time;
    end loop;
    return jsonb_build_object('ok',true);
  elsif v_command = 'pto_import' then
    for v_item in select value from jsonb_array_elements(coalesce(v_payload->'rows','[]'::jsonb)) loop
      insert into public.employee_planned_time_off(employee_id,start_date,end_date,pto_type,source,notes,active)
      values((v_item->>'employee_id')::uuid,(v_item->>'start_date')::date,(v_item->>'end_date')::date,v_item->>'pto_type',v_item->>'source',nullif(v_item->>'notes',''),true)
      on conflict(employee_id,start_date,end_date,pto_type,source) do update set notes=excluded.notes,active=true,updated_at=now();
    end loop;
    return jsonb_build_object('ok',true);
  elsif v_command = 'restore_static_schedule_owners' then
    v_date := (v_payload->>'service_date')::date;
    update public.daily_schedule_assignments dsa set assigned_employee_id=ct.assigned_employee_id,owner_type='EMPLOYEE',status='ASSIGNED',
      source_type=case when dsa.source_type is null or dsa.source_type='' then 'coverage_template_static_owner' when dsa.source_type like '%static_owner%' then dsa.source_type else dsa.source_type||':static_owner_restored' end,
      notes=trim(concat_ws(' | ',nullif(dsa.notes,''),'Static owner restored because owner is working and not absent.')),updated_at=now()
    from public.coverage_templates ct join public.daily_work_roster dwr on dwr.service_date=v_date and dwr.employee_id=ct.assigned_employee_id and dwr.active=true
    where dsa.service_date=v_date and dwr.shift_start<=dsa.coverage_start and dwr.shift_end>=least(dsa.coverage_end,public.sch_get_schedule_close_time(v_date))
      and ct.active=true and ct.day_of_week=extract(dow from v_date)::integer and ct.location_group_id=dsa.location_group_id and ct.segment_number=dsa.segment_number
      and ct.coverage_start=dsa.coverage_start and least(ct.coverage_end,public.sch_get_schedule_close_time(v_date))=dsa.coverage_end
      and coalesce(ct.coverage_purpose,'area_owner')=coalesce(dsa.coverage_purpose,'area_owner') and coalesce(dsa.coverage_purpose,'')<>'lunch_coverage'
      and coalesce(dsa.source_type,'') not ilike '%lunch%' and ct.assigned_employee_id is not null
      and not public.sch_is_employee_location_group_restricted(ct.assigned_employee_id,ct.location_group_id,extract(dow from v_date)::integer)
      and not exists(select 1 from public.daily_absence_overrides dao where dao.absence_date=v_date and dao.employee_id=ct.assigned_employee_id and dao.active=true
                     union all select 1 from public.employee_planned_time_off pto where pto.start_date<=v_date and pto.end_date>=v_date and pto.employee_id=ct.assigned_employee_id and pto.active=true
                     union all select 1 from public.employee_pto ep where ep.start_date<=v_date and ep.end_date>=v_date and ep.employee_id=ct.assigned_employee_id and ep.active=true)
      and coalesce(dsa.source_type,'') not like 'coverall%' and coalesce(dsa.source_type,'') not ilike '%manual%' and coalesce(dsa.source_type,'') not ilike '%override%' and coalesce(dsa.source_type,'') not ilike '%manager%';
    return jsonb_build_object('ok',true);
  elsif v_command = 'manual_absence_publish' then
    v_date := (v_payload->>'service_date')::date;
    update public.daily_absence_overrides dao set active=dao.employee_id=any(coalesce(array(select jsonb_array_elements_text(coalesce(v_payload->'employee_ids','[]'::jsonb)))::uuid[],'{}'::uuid[])),updated_at=now(),
      notes=case when dao.employee_id=any(coalesce(array(select jsonb_array_elements_text(coalesce(v_payload->'employee_ids','[]'::jsonb)))::uuid[],'{}'::uuid[])) then 'Published from simplified absence scheduler' else coalesce(dao.notes,'Cleared by simplified absence scheduler') end
    where dao.absence_date=v_date and dao.absence_type='manual_override';
    insert into public.daily_absence_overrides(id,absence_date,employee_id,absence_type,active,notes,created_at,updated_at)
    select gen_random_uuid(),v_date,(x.value)::uuid,'manual_override',true,'Published from simplified absence scheduler',now(),now()
    from jsonb_array_elements_text(coalesce(v_payload->'employee_ids','[]'::jsonb)) x
    where not exists(select 1 from public.daily_absence_overrides y where y.absence_date=v_date and y.employee_id=(x.value)::uuid);
    return jsonb_build_object('ok',true);
  elsif v_command = 'manual_absence_return' then
    update public.daily_absence_overrides set active=false,updated_at=now(),notes=trim(concat_ws(' ',nullif(notes,''),'Cleared: employee returned to schedule.'))
    where absence_date=(v_payload->>'service_date')::date and employee_id=(v_payload->>'employee_id')::uuid and absence_type='manual_override' and active=true;
    return jsonb_build_object('ok',true);
  end if;
  raise exception using errcode='22023', message='unsupported bounded schedule command';
end
$function$;

-- Retire the arbitrary application SQL executor and the legacy terminal
-- writer.  Only narrow RPC signatures are granted to the application role.
revoke all on function public.run_application_write(text,text), public.run_sql_write(text), public.run_sql_write(text,text), public.run_sql_migration(text,text),
  public.force_close_session(text,text,text), public.tool_force_close_session(text,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.app_apply_operational_command(text,jsonb) from public, anon, authenticated;
grant execute on function public.app_apply_operational_command(text,jsonb) to service_role;
revoke all on function public.app_apply_event_command(text,uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.app_apply_event_command(text,uuid,jsonb,text,text) to service_role;
revoke all on function public.app_apply_schedule_command(text,jsonb) from public, anon, authenticated;
grant execute on function public.app_apply_schedule_command(text,jsonb) to service_role;
revoke all on function public.custodial_claim_offline_reconciliation_notifications(text,integer,integer,text),
  public.custodial_finish_offline_reconciliation_notification(uuid,text,uuid,boolean,text,integer,boolean,jsonb,text),
  public.custodial_enqueue_offline_reconciliation_disposition_notice(uuid)
from public, anon, authenticated;
grant execute on function public.custodial_claim_offline_reconciliation_notifications(text,integer,integer,text),
  public.custodial_finish_offline_reconciliation_notification(uuid,text,uuid,boolean,text,integer,boolean,jsonb,text)
to service_role;

commit;
