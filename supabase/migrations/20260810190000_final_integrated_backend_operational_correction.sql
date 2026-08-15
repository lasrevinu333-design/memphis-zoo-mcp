begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Phase E is deliberately forward-only.  It fences proof recovery to the
-- exact assignment that issued it, retires every alternate terminal writer,
-- and makes reconciliation delivery recipient-idempotent and auditable.

alter table public.custodial_offline_reconciliation_outbox
  drop constraint if exists custodial_offline_reconciliation_outbox_state_check;
alter table public.custodial_offline_reconciliation_outbox
  add constraint custodial_offline_reconciliation_outbox_state_check
  check (state in ('pending','claimed','retry','delivered','failed'));

create table if not exists public.custodial_offline_reconciliation_delivery_recipients (
  delivery_recipient_id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.custodial_offline_reconciliation_outbox(outbox_id) on delete restrict,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  recipient_user_id uuid not null references public.msg_users(id) on delete restrict,
  client_message_id text not null check (length(client_message_id) between 1 and 200),
  notification_instance_key text not null check (length(notification_instance_key) between 1 and 500),
  state text not null default 'pending' check (state in ('pending','claimed','retry','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  claimed_by text,
  lease_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text,
  message_id uuid references public.msg_messages(id) on delete restrict,
  delivery_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (outbox_id, manager_id),
  unique (outbox_id, recipient_user_id),
  unique (client_message_id),
  unique (notification_instance_key)
);

create table if not exists public.custodial_offline_reconciliation_delivery_events (
  delivery_event_id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.custodial_offline_reconciliation_outbox(outbox_id) on delete restrict,
  delivery_recipient_id uuid references public.custodial_offline_reconciliation_delivery_recipients(delivery_recipient_id) on delete restrict,
  event_type text not null check (event_type in ('recipient_declared','outbox_lease_reclaimed','outbox_lease_exhausted','recipient_claimed','recipient_lease_reclaimed','recipient_lease_exhausted','recipient_retry_scheduled','recipient_delivered','recipient_failed','outbox_retry_scheduled','outbox_delivered','outbox_failed')),
  attempt integer,
  worker_id text,
  error_text text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_custodial_offline_delivery_recipients_claimable
  on public.custodial_offline_reconciliation_delivery_recipients(outbox_id, state, next_attempt_at, created_at);
create index if not exists idx_custodial_offline_delivery_events_outbox
  on public.custodial_offline_reconciliation_delivery_events(outbox_id, created_at, delivery_event_id);

create or replace function public.custodial_reject_offline_delivery_recipient_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='Custodial offline recipient delivery evidence is append-only';
  end if;
  if not public.custodial_backend_transition_allowed() then
    raise exception using errcode='23514', message='Custodial offline recipient delivery state is mutable only by the canonical delivery worker';
  end if;
  if new.delivery_recipient_id is distinct from old.delivery_recipient_id
     or new.outbox_id is distinct from old.outbox_id
     or new.manager_id is distinct from old.manager_id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.client_message_id is distinct from old.client_message_id
     or new.notification_instance_key is distinct from old.notification_instance_key
     or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514', message='Custodial offline recipient identity is immutable';
  end if;
  return new;
end
$function$;

create or replace function public.custodial_reject_offline_delivery_event_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  raise exception using errcode='23514', message='Custodial offline delivery event evidence is append-only';
end
$function$;

drop trigger if exists trg_custodial_offline_delivery_recipient_immutable on public.custodial_offline_reconciliation_delivery_recipients;
create trigger trg_custodial_offline_delivery_recipient_immutable
before update or delete on public.custodial_offline_reconciliation_delivery_recipients
for each row execute function public.custodial_reject_offline_delivery_recipient_mutation();
drop trigger if exists trg_custodial_offline_delivery_event_immutable on public.custodial_offline_reconciliation_delivery_events;
create trigger trg_custodial_offline_delivery_event_immutable
before update or delete on public.custodial_offline_reconciliation_delivery_events
for each row execute function public.custodial_reject_offline_delivery_event_mutation();

drop trigger if exists trg_custodial_offline_delivery_recipients_truncate_guard on public.custodial_offline_reconciliation_delivery_recipients;
create trigger trg_custodial_offline_delivery_recipients_truncate_guard
before truncate on public.custodial_offline_reconciliation_delivery_recipients
for each statement execute function public.custodial_reject_offline_evidence_truncate();
drop trigger if exists trg_custodial_offline_delivery_events_truncate_guard on public.custodial_offline_reconciliation_delivery_events;
create trigger trg_custodial_offline_delivery_events_truncate_guard
before truncate on public.custodial_offline_reconciliation_delivery_events
for each statement execute function public.custodial_reject_offline_evidence_truncate();

create or replace function public.custodial_truncate_offline_evidence_for_maintenance(p_table regclass,p_reason text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$ begin raise exception using errcode='0A000',message='Custodial offline evidence truncation is retired; evidence is append-only'; end $function$;
revoke all on function public.custodial_truncate_offline_evidence_for_maintenance(regclass,text) from public, anon, authenticated, service_role, postgres;

revoke all on table public.custodial_offline_reconciliation_delivery_recipients,
  public.custodial_offline_reconciliation_delivery_events
from public, anon, authenticated, service_role;

-- Exact recovery may return an issued proof only when the present request is
-- still bound to the same employee, epoch, change record, credential, and
-- normalized activation fingerprint.  Completion intentionally continues to
-- use the frozen context/proof and therefore does not rewrite its actor.
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
    select d.id,d.device_id,d.assigned_employee_id,d.assignment_epoch,e.active as employee_active,
      c.credential_id,c.confirmed_at,c.revoked_at,c.expires_at
      into v_device
    from public.devices d
    join public.employees e on e.id=d.assigned_employee_id
    join public.device_auth_credentials c on c.credential_id=v_credential_id and c.device_id=d.id
    where d.id=v_existing.device_id and d.active=true
    for update of d;
    select l.id,l.location_code,jsonb_build_array(l.location_code,upper(btrim(p_location_code))) as aliases
      into v_location
    from public.locations l where l.location_code=public.resolve_scan_location_code(p_location_code) and l.active=true;
    select h.assignment_change_id into v_assignment_change_id
      from public.custodial_employee_device_assignment_history h
      where h.device_id=v_existing.device_id and h.new_employee_id=v_device.assigned_employee_id
      order by h.changed_at desc, h.assignment_change_id desc limit 1;
    if v_device.id is null or v_device.assigned_employee_id is distinct from v_existing.employee_id
       or v_device.assignment_epoch is distinct from v_existing.assignment_epoch
       or v_assignment_change_id is distinct from v_existing.assignment_change_id
       or v_device.confirmed_at is null or v_device.revoked_at is not null or v_device.expires_at<=now()
       or v_location.id is null then
      raise exception using errcode='40901', message='offline occurrence replay is fenced because its authoritative assignment changed';
    end if;
    v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('client_session_id',v_client_session_id,'device_id',v_device.id::text,
      'employee_id',v_device.assigned_employee_id::text,'credential_id',v_credential_id::text,'assignment_epoch',v_device.assignment_epoch,
      'assignment_change_id',v_assignment_change_id::text,'location_id',v_location.id::text,'location_code',v_location.location_code,
      'location_aliases',v_location.aliases,'started_at',v_started_at)::text,'UTF8'),'sha256'),'hex');
    if v_fingerprint is distinct from v_existing.occurrence_fingerprint then
      raise exception using errcode='40901', message='offline occurrence replay is fenced because its normalized request fingerprint changed';
    end if;
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
  where h.device_id=v_device.id and h.new_employee_id=v_device.assigned_employee_id order by h.changed_at desc, h.assignment_change_id desc limit 1;
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

-- Expired final attempts fail before candidates are selected.  Thus an
-- exhausted row cannot cause a sixth attempt or block unrelated work.
create or replace function public.custodial_claim_offline_reconciliation_notifications(
  p_worker_id text, p_limit integer, p_lease_seconds integer, p_backend_execution_secret text
)
returns table(
  outbox_id uuid, reconciliation_id uuid, disposition_id uuid, notification_kind text,
  payload_json jsonb, attempts integer, lease_token uuid, lease_expires_at timestamptz
)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_worker_id text := nullif(btrim(coalesce(p_worker_id, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 120), 900));
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_worker_id is null or length(v_worker_id) > 200 then raise exception using errcode='22023', message='a bounded notification worker identity is required'; end if;
  with exhausted as (
    update public.custodial_offline_reconciliation_outbox o
    set state='failed', failed_at=now(), claimed_by=null, lease_token=null, claimed_at=null, lease_expires_at=null,
      last_error='notification delivery lease expired after maximum attempts'
    where o.state='claimed' and o.lease_expires_at<=now() and o.attempts>=5
    returning o.outbox_id,o.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,error_text,evidence_json)
    select e.outbox_id,'outbox_lease_exhausted',e.attempts,'notification delivery lease expired after maximum attempts',jsonb_build_object('terminal',true) from exhausted e;
  with reclaimed as (
    update public.custodial_offline_reconciliation_outbox o
    set state='retry', claimed_by=null, lease_token=null, claimed_at=null, lease_expires_at=null,
      next_attempt_at=now(), last_error=coalesce(nullif(o.last_error,''),'delivery lease expired')
    where o.state='claimed' and o.lease_expires_at<=now() and o.attempts<5
    returning o.outbox_id,o.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,error_text,evidence_json)
    select r.outbox_id,'outbox_lease_reclaimed',r.attempts,'delivery lease expired',jsonb_build_object('requeued',true) from reclaimed r;
  return query
  with candidates as (
    select o.outbox_id from public.custodial_offline_reconciliation_outbox o
    where o.state in ('pending','retry') and o.next_attempt_at<=now() and o.attempts<5
    order by o.created_at,o.outbox_id limit v_limit for update skip locked
  ), claimed as (
    update public.custodial_offline_reconciliation_outbox o
    set state='claimed',claimed_by=v_worker_id,lease_token=gen_random_uuid(),claimed_at=now(),
      lease_expires_at=now()+make_interval(secs=>v_lease_seconds),attempts=o.attempts+1
    from candidates c where o.outbox_id=c.outbox_id returning o.*
  )
  select c.outbox_id,c.reconciliation_id,c.disposition_id,c.notification_kind,c.payload_json,c.attempts,c.lease_token,c.lease_expires_at
  from claimed c order by c.created_at,c.outbox_id;
end
$function$;

create or replace function public.custodial_claim_offline_reconciliation_notification_recipients(
  p_outbox_id uuid, p_worker_id text, p_outbox_lease_token uuid, p_recipients jsonb, p_backend_execution_secret text
)
returns table(
  delivery_recipient_id uuid, manager_id uuid, recipient_user_id uuid, client_message_id text,
  notification_instance_key text, attempts integer, lease_token uuid, lease_expires_at timestamptz
)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_outbox public.custodial_offline_reconciliation_outbox%rowtype;
  v_worker_id text := nullif(btrim(coalesce(p_worker_id,'')), '');
  v_expected integer;
  v_inserted integer;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if v_worker_id is null or length(v_worker_id)>200 or p_outbox_id is null then raise exception using errcode='22023',message='a bounded worker and notification identity are required'; end if;
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id=p_outbox_id for update;
  if v_outbox.outbox_id is null then raise exception using errcode='P0002',message='offline reconciliation notification was not found'; end if;
  if v_outbox.state<>'claimed' or v_outbox.claimed_by<>v_worker_id or v_outbox.lease_token is distinct from p_outbox_lease_token or v_outbox.lease_expires_at<=now() then
    raise exception using errcode='40901',message='notification claim is no longer owned by this worker';
  end if;
  if not exists(select 1 from public.custodial_offline_reconciliation_delivery_recipients where outbox_id=p_outbox_id) then
    if jsonb_typeof(coalesce(p_recipients,'null'::jsonb))<>'array' or jsonb_array_length(p_recipients) not between 1 and 100 then
      raise exception using errcode='22023',message='one to one hundred authoritative named-manager recipients are required';
    end if;
    select count(*) into v_expected from (
      select distinct input.manager_id,input.user_id from jsonb_to_recordset(p_recipients) as input(manager_id uuid,user_id uuid)
    ) candidates;
    insert into public.custodial_offline_reconciliation_delivery_recipients(
      outbox_id,manager_id,recipient_user_id,client_message_id,notification_instance_key
    )
    select p_outbox_id,c.manager_id,c.user_id,
      'offline-reconciliation:'||p_outbox_id::text||':'||c.user_id::text,
      'offline-reconciliation:'||p_outbox_id::text||':'||c.user_id::text
    from (select distinct input.manager_id,input.user_id from jsonb_to_recordset(p_recipients) as input(manager_id uuid,user_id uuid)) c
    join public.ops_manager_managers m on m.manager_id=c.manager_id and m.active=true and m.revoked_at is null and m.is_system_principal=false
    join public.msg_users u on u.id=c.user_id and u.ops_manager_id=m.manager_id and coalesce(u.is_active,true)=true;
    get diagnostics v_inserted=row_count;
    if v_inserted<>v_expected then raise exception using errcode='42501',message='notification recipients must be active named-manager Messenger identities'; end if;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,evidence_json)
      select p_outbox_id,r.delivery_recipient_id,'recipient_declared',jsonb_build_object('manager_id',r.manager_id,'recipient_user_id',r.recipient_user_id,'client_message_id',r.client_message_id)
      from public.custodial_offline_reconciliation_delivery_recipients r where r.outbox_id=p_outbox_id;
  end if;
  with exhausted as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='failed',failed_at=now(),claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,
      last_error='recipient delivery lease expired after maximum attempts'
    where r.outbox_id=p_outbox_id and r.state='claimed' and r.lease_expires_at<=now() and r.attempts>=5
    returning r.delivery_recipient_id,r.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,error_text,evidence_json)
    select p_outbox_id,e.delivery_recipient_id,'recipient_lease_exhausted',e.attempts,'recipient delivery lease expired after maximum attempts',jsonb_build_object('terminal',true) from exhausted e;
  with reclaimed as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='retry',claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,next_attempt_at=now(),
      last_error=coalesce(nullif(r.last_error,''),'recipient delivery lease expired')
    where r.outbox_id=p_outbox_id and r.state='claimed' and r.lease_expires_at<=now() and r.attempts<5
    returning r.delivery_recipient_id,r.attempts
  ) insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,error_text,evidence_json)
    select p_outbox_id,r.delivery_recipient_id,'recipient_lease_reclaimed',r.attempts,'recipient delivery lease expired',jsonb_build_object('requeued',true) from reclaimed r;
  return query
  with candidates as (
    select r.delivery_recipient_id from public.custodial_offline_reconciliation_delivery_recipients r
    where r.outbox_id=p_outbox_id and r.state in ('pending','retry') and r.next_attempt_at<=now() and r.attempts<5
    order by r.created_at,r.delivery_recipient_id for update skip locked
  ), claimed as (
    update public.custodial_offline_reconciliation_delivery_recipients r
    set state='claimed',claimed_by=v_worker_id,lease_token=gen_random_uuid(),claimed_at=now(),lease_expires_at=least(v_outbox.lease_expires_at,now()+interval '120 seconds'),attempts=r.attempts+1
    from candidates c where r.delivery_recipient_id=c.delivery_recipient_id returning r.*
  ), evidence as (
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,worker_id,evidence_json)
    select p_outbox_id,c.delivery_recipient_id,'recipient_claimed',c.attempts,v_worker_id,jsonb_build_object('lease_token',c.lease_token,'lease_expires_at',c.lease_expires_at) from claimed c
  )
  select c.delivery_recipient_id,c.manager_id,c.recipient_user_id,c.client_message_id,c.notification_instance_key,c.attempts,c.lease_token,c.lease_expires_at from claimed c;
end
$function$;

create or replace function public.custodial_finish_offline_reconciliation_notification_recipient(
  p_delivery_recipient_id uuid,p_worker_id text,p_lease_token uuid,p_succeeded boolean,p_message_id uuid,
  p_error text,p_retry_seconds integer,p_terminal boolean,p_delivery_evidence jsonb,p_backend_execution_secret text
)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_recipient public.custodial_offline_reconciliation_delivery_recipients%rowtype;
  v_outbox public.custodial_offline_reconciliation_outbox%rowtype;
  v_worker_id text := nullif(btrim(coalesce(p_worker_id,'')), '');
  v_error text := nullif(left(btrim(coalesce(p_error,'')),500),'');
  v_retry_seconds integer := greatest(15,least(coalesce(p_retry_seconds,60),3600));
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select * into v_recipient from public.custodial_offline_reconciliation_delivery_recipients where delivery_recipient_id=p_delivery_recipient_id for update;
  if v_recipient.delivery_recipient_id is null then raise exception using errcode='P0002',message='offline reconciliation notification recipient was not found'; end if;
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id=v_recipient.outbox_id for key share;
  if v_worker_id is null or v_recipient.state<>'claimed' or v_recipient.claimed_by<>v_worker_id or v_recipient.lease_token is distinct from p_lease_token or v_recipient.lease_expires_at<=now()
     or v_outbox.state<>'claimed' or v_outbox.claimed_by<>v_worker_id or v_outbox.lease_expires_at<=now() then
    raise exception using errcode='40901',message='recipient delivery claim is no longer owned by this worker';
  end if;
  if p_succeeded is true then
    if p_message_id is null or not exists(
      select 1 from public.msg_messages m join public.msg_thread_participants tp on tp.thread_id=m.thread_id and tp.user_id=v_recipient.recipient_user_id and tp.left_at is null
      where m.id=p_message_id and m.client_message_id=v_recipient.client_message_id and m.metadata_json->>'notification_instance_key'=v_recipient.notification_instance_key
    ) then raise exception using errcode='23514',message='recipient delivery evidence must bind the stable Messenger notification identity'; end if;
    update public.custodial_offline_reconciliation_delivery_recipients
    set state='delivered',delivered_at=now(),failed_at=null,claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,last_error=null,message_id=p_message_id,
      delivery_evidence=coalesce(p_delivery_evidence,'{}'::jsonb)||jsonb_build_object('message_id',p_message_id,'client_message_id',v_recipient.client_message_id,'notification_instance_key',v_recipient.notification_instance_key)
    where delivery_recipient_id=v_recipient.delivery_recipient_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,worker_id,evidence_json)
    values(v_recipient.outbox_id,v_recipient.delivery_recipient_id,'recipient_delivered',v_recipient.attempts,v_worker_id,jsonb_build_object('message_id',p_message_id,'client_message_id',v_recipient.client_message_id));
  elsif p_terminal is true or v_recipient.attempts>=5 then
    update public.custodial_offline_reconciliation_delivery_recipients
    set state='failed',failed_at=now(),claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,last_error=coalesce(v_error,'recipient delivery reached terminal failure'),
      delivery_evidence=coalesce(p_delivery_evidence,'{}'::jsonb)
    where delivery_recipient_id=v_recipient.delivery_recipient_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,worker_id,error_text,evidence_json)
    values(v_recipient.outbox_id,v_recipient.delivery_recipient_id,'recipient_failed',v_recipient.attempts,v_worker_id,coalesce(v_error,'recipient delivery reached terminal failure'),coalesce(p_delivery_evidence,'{}'::jsonb));
  else
    update public.custodial_offline_reconciliation_delivery_recipients
    set state='retry',claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,next_attempt_at=now()+make_interval(secs=>v_retry_seconds),last_error=coalesce(v_error,'recipient delivery failed'),
      delivery_evidence=coalesce(p_delivery_evidence,'{}'::jsonb)
    where delivery_recipient_id=v_recipient.delivery_recipient_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,delivery_recipient_id,event_type,attempt,worker_id,error_text,evidence_json)
    values(v_recipient.outbox_id,v_recipient.delivery_recipient_id,'recipient_retry_scheduled',v_recipient.attempts,v_worker_id,coalesce(v_error,'recipient delivery failed'),coalesce(p_delivery_evidence,'{}'::jsonb));
  end if;
  select * into v_recipient from public.custodial_offline_reconciliation_delivery_recipients where delivery_recipient_id=v_recipient.delivery_recipient_id;
  return jsonb_build_object('delivery_recipient_id',v_recipient.delivery_recipient_id,'state',v_recipient.state,'attempts',v_recipient.attempts,'terminal',v_recipient.state in ('delivered','failed'),'message_id',v_recipient.message_id);
end
$function$;

create or replace function public.custodial_finish_offline_reconciliation_notification(
  p_outbox_id uuid,p_worker_id text,p_lease_token uuid,p_succeeded boolean,p_error text,p_retry_seconds integer,p_terminal boolean,p_delivery_json jsonb,p_backend_execution_secret text
)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_outbox public.custodial_offline_reconciliation_outbox%rowtype;
  v_worker_id text := nullif(btrim(coalesce(p_worker_id,'')), '');
  v_error text := nullif(left(btrim(coalesce(p_error,'')),500),'');
  v_retry_seconds integer := greatest(15,least(coalesce(p_retry_seconds,60),3600));
  v_recipients integer := 0;
  v_delivered integer := 0;
  v_failed integer := 0;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id=p_outbox_id for update;
  if v_outbox.outbox_id is null then raise exception using errcode='P0002',message='offline reconciliation notification was not found'; end if;
  if v_worker_id is null or v_outbox.state<>'claimed' or v_outbox.claimed_by<>v_worker_id or v_outbox.lease_token is distinct from p_lease_token or v_outbox.lease_expires_at<=now() then raise exception using errcode='40901',message='notification claim is no longer owned by this worker'; end if;
  select count(*),count(*) filter(where state='delivered'),count(*) filter(where state='failed') into v_recipients,v_delivered,v_failed
    from public.custodial_offline_reconciliation_delivery_recipients where outbox_id=v_outbox.outbox_id;
  if v_failed>0 or p_terminal is true then
    update public.custodial_offline_reconciliation_outbox
    set state='failed',failed_at=now(),claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,
      last_error=coalesce(v_error,case when v_failed>0 then 'one or more named-manager recipients are unavailable' else 'notification delivery reached terminal failure' end),delivery_json=coalesce(p_delivery_json,'{}'::jsonb)
    where outbox_id=v_outbox.outbox_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,worker_id,error_text,evidence_json)
    values(v_outbox.outbox_id,'outbox_failed',v_outbox.attempts,v_worker_id,coalesce(v_error,'notification delivery reached terminal failure'),coalesce(p_delivery_json,'{}'::jsonb));
  elsif v_recipients>0 and v_delivered=v_recipients then
    update public.custodial_offline_reconciliation_outbox
    set state='delivered',delivered_at=now(),failed_at=null,claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,last_error=null,delivery_json=coalesce(p_delivery_json,'{}'::jsonb)
    where outbox_id=v_outbox.outbox_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,worker_id,evidence_json)
    values(v_outbox.outbox_id,'outbox_delivered',v_outbox.attempts,v_worker_id,coalesce(p_delivery_json,'{}'::jsonb));
  elsif v_recipients=0 and p_succeeded is true then
    update public.custodial_offline_reconciliation_outbox
    set state='delivered',delivered_at=now(),failed_at=null,claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,last_error=null,delivery_json=coalesce(p_delivery_json,'{}'::jsonb)
    where outbox_id=v_outbox.outbox_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,worker_id,evidence_json)
    values(v_outbox.outbox_id,'outbox_delivered',v_outbox.attempts,v_worker_id,coalesce(p_delivery_json,'{}'::jsonb));
  elsif v_outbox.attempts>=5 then
    update public.custodial_offline_reconciliation_outbox
    set state='failed',failed_at=now(),claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,last_error=coalesce(v_error,'notification delivery reached maximum attempts'),delivery_json=coalesce(p_delivery_json,'{}'::jsonb)
    where outbox_id=v_outbox.outbox_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,worker_id,error_text,evidence_json)
    values(v_outbox.outbox_id,'outbox_failed',v_outbox.attempts,v_worker_id,coalesce(v_error,'notification delivery reached maximum attempts'),coalesce(p_delivery_json,'{}'::jsonb));
  else
    update public.custodial_offline_reconciliation_outbox
    set state='retry',claimed_by=null,lease_token=null,claimed_at=null,lease_expires_at=null,next_attempt_at=now()+make_interval(secs=>v_retry_seconds),last_error=coalesce(v_error,'notification delivery incomplete'),delivery_json=coalesce(p_delivery_json,'{}'::jsonb)
    where outbox_id=v_outbox.outbox_id;
    insert into public.custodial_offline_reconciliation_delivery_events(outbox_id,event_type,attempt,worker_id,error_text,evidence_json)
    values(v_outbox.outbox_id,'outbox_retry_scheduled',v_outbox.attempts,v_worker_id,coalesce(v_error,'notification delivery incomplete'),coalesce(p_delivery_json,'{}'::jsonb));
  end if;
  select * into v_outbox from public.custodial_offline_reconciliation_outbox where outbox_id=v_outbox.outbox_id;
  return jsonb_build_object('outbox_id',v_outbox.outbox_id,'state',v_outbox.state,'attempts',v_outbox.attempts,'terminal',v_outbox.state in ('delivered','failed'),'next_attempt_at',v_outbox.next_attempt_at,'failed_at',v_outbox.failed_at);
end
$function$;

-- Named managers receive truthful recovery state instead of a bare queue row.
create or replace function public.custodial_manager_list_offline_reconciliations(p_manager_id uuid,p_limit integer,p_before timestamptz,p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='active named manager authority is required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'reconciliation_id',r.reconciliation_id,'state',r.state,'reason',r.quarantine_reason,'original_employee_id',r.original_employee_id,'occurrence_id',r.occurrence_id,'created_at',r.created_at,
    'notifications',coalesce((select jsonb_agg(jsonb_build_object('outbox_id',o.outbox_id,'notification_kind',o.notification_kind,'disposition_id',o.disposition_id,'state',o.state,
      'status_label',case o.state when 'pending' then 'Pending delivery' when 'claimed' then 'Delivery in progress' when 'retry' then 'Retry scheduled' when 'delivered' then 'Delivered' else 'Delivery unavailable' end,
      'attempts',o.attempts,'claimed_at',o.claimed_at,'lease_expires_at',o.lease_expires_at,'next_attempt_at',o.next_attempt_at,'delivered_at',o.delivered_at,'failed_at',o.failed_at,'last_error',nullif(left(coalesce(o.last_error,''),500),''),
      'recipient_count',(select count(*) from public.custodial_offline_reconciliation_delivery_recipients dr where dr.outbox_id=o.outbox_id)) order by o.created_at,o.outbox_id) from public.custodial_offline_reconciliation_outbox o where o.reconciliation_id=r.reconciliation_id),'[]'::jsonb)
  ) order by r.created_at desc) from (select * from public.custodial_offline_reconciliation_records where p_before is null or created_at<p_before order by created_at desc limit greatest(1,least(coalesce(p_limit,50),100))) r),'[]'::jsonb);
end
$function$;

create or replace function public.custodial_manager_get_offline_reconciliation(p_manager_id uuid,p_reconciliation_id uuid,p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_record public.custodial_offline_reconciliation_records%rowtype;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null) then raise exception using errcode='42501',message='active named manager authority is required'; end if;
  select * into v_record from public.custodial_offline_reconciliation_records where reconciliation_id=p_reconciliation_id;
  if v_record.reconciliation_id is null then raise exception using errcode='P0002',message='offline reconciliation not found'; end if;
  return jsonb_build_object('record',to_jsonb(v_record),'audits',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]'::jsonb) from public.custodial_offline_reconciliation_audits a where a.reconciliation_id=v_record.reconciliation_id),'dispositions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at),'[]'::jsonb) from public.custodial_offline_reconciliation_dispositions d where d.reconciliation_id=v_record.reconciliation_id),'notifications',coalesce((select jsonb_agg(jsonb_build_object(
    'outbox_id',o.outbox_id,'notification_key',o.notification_key,'notification_kind',o.notification_kind,'disposition_id',o.disposition_id,'state',o.state,
    'status_label',case o.state when 'pending' then 'Pending delivery' when 'claimed' then 'Delivery in progress' when 'retry' then 'Retry scheduled' when 'delivered' then 'Delivered' else 'Delivery unavailable' end,
    'attempts',o.attempts,'claimed_at',o.claimed_at,'lease_expires_at',o.lease_expires_at,'next_attempt_at',o.next_attempt_at,'delivered_at',o.delivered_at,'failed_at',o.failed_at,'last_error',nullif(left(coalesce(o.last_error,''),500),''),'delivery_evidence',o.delivery_json,
    'recipients',coalesce((select jsonb_agg(jsonb_build_object('delivery_recipient_id',dr.delivery_recipient_id,'manager_id',dr.manager_id,'recipient_user_id',dr.recipient_user_id,'state',dr.state,'attempts',dr.attempts,'claimed_at',dr.claimed_at,'lease_expires_at',dr.lease_expires_at,'next_attempt_at',dr.next_attempt_at,'delivered_at',dr.delivered_at,'failed_at',dr.failed_at,'last_error',nullif(left(coalesce(dr.last_error,''),500),''),'message_id',dr.message_id,'client_message_id',dr.client_message_id,'notification_instance_key',dr.notification_instance_key,'delivery_evidence',dr.delivery_evidence,
      'events',coalesce((select jsonb_agg(jsonb_build_object('event_type',de.event_type,'attempt',de.attempt,'worker_id',de.worker_id,'error',de.error_text,'evidence',de.evidence_json,'created_at',de.created_at) order by de.created_at,de.delivery_event_id) from public.custodial_offline_reconciliation_delivery_events de where de.delivery_recipient_id=dr.delivery_recipient_id),'[]'::jsonb)) order by dr.created_at,dr.delivery_recipient_id) from public.custodial_offline_reconciliation_delivery_recipients dr where dr.outbox_id=o.outbox_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('event_type',de.event_type,'attempt',de.attempt,'worker_id',de.worker_id,'error',de.error_text,'evidence',de.evidence_json,'created_at',de.created_at) order by de.created_at,de.delivery_event_id) from public.custodial_offline_reconciliation_delivery_events de where de.outbox_id=o.outbox_id and de.delivery_recipient_id is null),'[]'::jsonb)
  ) order by o.created_at,o.outbox_id) from public.custodial_offline_reconciliation_outbox o where o.reconciliation_id=v_record.reconciliation_id),'[]'::jsonb));
end
$function$;

-- Closing a ticket remains available only through one typed, secret-bearing
-- command.  All historical ticket/scan/session writers are revoked below.
create or replace function public.custodial_close_maintenance_ticket_authoritative(
  p_ticket_id uuid,p_closed_by text,p_close_notes text,p_backend_execution_secret text
)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_closed_by text := nullif(left(btrim(coalesce(p_closed_by,'')),200),'');
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if p_ticket_id is null or v_closed_by is null then raise exception using errcode='22023',message='ticket identity and named closer are required'; end if;
  return public.close_maintenance_ticket(p_ticket_id,v_closed_by,nullif(left(btrim(coalesce(p_close_notes,'')),1000),''));
end
$function$;

-- The historical purge signatures are retained solely as fail-closed markers;
-- there is no caller-selected destructive retention path.
create or replace function public.purge_closed_scan_history_before(p_cutoff timestamptz,p_requested_by text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$ begin raise exception using errcode='0A000',message='Custodial terminal history purge is retired; terminal evidence is append-only'; end $function$;
create or replace function public.tool_purge_closed_scan_history_before(p_cutoff timestamptz,p_requested_by text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$ begin raise exception using errcode='0A000',message='Custodial terminal history purge is retired; terminal evidence is append-only'; end $function$;

-- This view inventories actual callable mutation capability (including PUBLIC
-- grants), direct terminal-table mutation, and wrappers/delegation.  The DO
-- block revokes each discovered application-callable alternate path rather
-- than relying on a short static name list.
create or replace view public.custodial_terminal_writer_inventory as
select p.oid,p.oid::regprocedure::text as routine_identity,p.proname,
  p.prorettype <> 'pg_catalog.trigger'::regtype and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')) as application_callable,
  lower(pg_get_functiondef(p.oid)) as definition,
  (lower(pg_get_functiondef(p.oid)) ~ '(insert[[:space:]]+into|update|delete[[:space:]]+from|truncate([[:space:]]+table)?)' and lower(pg_get_functiondef(p.oid)) ~ 'public[.]?(sessions|completion_responses|scan_events|maintenance_tickets)') as mutates_terminal_truth,
  (p.proname like 'demo_scan_mock_%' or lower(pg_get_functiondef(p.oid)) ~ 'public[.]demo_scan_mock_' or lower(pg_get_functiondef(p.oid)) ~ 'public[.](purge_closed_scan_history_before|tool_purge_closed_scan_history_before|close_maintenance_ticket|tool_close_maintenance_ticket|force_close_session|tool_force_close_session|start_session|tool_start_session|finish_session|tool_finish_session|complete_session|tool_complete_session|record_scan_event|tool_record_scan_event)') as delegates_alternate_terminal_authority
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';

do $revoke_terminal_writers$
declare r record;
begin
  for r in
    select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as identity_arguments
    from public.custodial_terminal_writer_inventory i
    join pg_proc p on p.oid=i.oid join pg_namespace n on n.oid=p.pronamespace
    where i.application_callable and (i.mutates_terminal_truth or i.delegates_alternate_terminal_authority)
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and p.proname not in ('tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative','custodial_close_maintenance_ticket_authoritative')
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',r.nspname,r.proname,r.identity_arguments);
  end loop;
end
$revoke_terminal_writers$;

revoke all on table public.demo_scan_mock_runs from public, anon, authenticated, service_role;
revoke all on function public.purge_closed_scan_history_before(timestamptz,text),public.tool_purge_closed_scan_history_before(timestamptz,text),
  public.close_maintenance_ticket(uuid,text,text),public.tool_close_maintenance_ticket(text,text,text),
  public.complete_session(text,jsonb,text,text,text),public.record_scan_event(text,text,text,text,text,jsonb,text),public.start_session(text,text,text,text),public.start_session_v2(text,text,text,timestamptz,text),public.finish_session(text,text),
  public.force_close_session(text,text,text),public.tool_force_close_session(text,text,text),public.tool_record_scan_event(text,text,text,text,text,jsonb,text),public.tool_start_session(text,text,text,text),public.tool_start_session_v2(text,text,text,timestamptz,text),public.tool_finish_session(text,text),public.tool_finish_session_exact(text,text,uuid,timestamptz),public.tool_complete_session(text,jsonb,text,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.tool_start_offline_occurrence(text,text,text,text,text,text),
  public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text),
  public.tool_complete_session_authoritative(text,jsonb,text,text,text,text),
  public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text),
  public.custodial_claim_offline_reconciliation_notifications(text,integer,integer,text),
  public.custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text),
  public.custodial_finish_offline_reconciliation_notification_recipient(uuid,text,uuid,boolean,uuid,text,integer,boolean,jsonb,text),
  public.custodial_finish_offline_reconciliation_notification(uuid,text,uuid,boolean,text,integer,boolean,jsonb,text),
  public.custodial_manager_list_offline_reconciliations(uuid,integer,timestamptz,text),
  public.custodial_manager_get_offline_reconciliation(uuid,uuid,text)
to service_role;

do $disable_demo_cron$
declare v_job record;
begin
  for v_job in select jobid from cron.job where lower(command) like '%demo_scan_mock%' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$disable_demo_cron$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  return jsonb_build_object('ok',true,'authority','offline-authority.v3','phase','E','configured',true,
    'durable_start_proof_replay',true,'assignment_fenced_proof_recovery',true,'terminal_writer_inventory',true,
    'reconciliation_notification_lifecycle',true,'recipient_idempotent_delivery',true);
end
$function$;

commit;
