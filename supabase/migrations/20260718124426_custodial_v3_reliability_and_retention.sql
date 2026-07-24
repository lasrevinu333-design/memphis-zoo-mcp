begin;

-- Events are operational history. Expiration only affects the upcoming-events
-- query; it must never physically delete an event or its audit trail.
alter table public.events_app_events
  add column if not exists status text not null default 'SCHEDULED',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text,
  add column if not exists archived_at timestamptz;

update public.events_app_events
set status = 'SCHEDULED'
where status is null or btrim(status) = '';

alter table public.events_app_events
  drop constraint if exists events_app_events_status_check;
alter table public.events_app_events
  add constraint events_app_events_status_check
  check (status in ('SCHEDULED','CANCELLED','ARCHIVED'));

alter table public.events_app_event_history
  drop constraint if exists events_app_event_history_event_id_fkey;
alter table public.events_app_event_history
  add constraint events_app_event_history_event_id_fkey
  foreign key (event_id) references public.events_app_events(id) on delete restrict;

create index if not exists idx_events_app_events_status_date
  on public.events_app_events(status, event_date, start_time, id);

-- A finish transition must target the exact server/client session identifier.
-- The legacy location/device function remains reconstructable for old source,
-- but current callers are adapted to this immutable-operation contract.
alter table public.sessions
  add column if not exists finish_operation_id uuid;

create unique index if not exists uq_sessions_finish_operation_id
  on public.sessions(finish_operation_id)
  where finish_operation_id is not null;

create or replace function public.tool_finish_session_exact(
  p_session_identifier text,
  p_device_id text,
  p_finish_operation_id uuid,
  p_client_ended_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_identifier text := nullif(btrim(coalesce(p_session_identifier, '')), '');
  v_device_pk uuid;
  v_canonical_device_id text;
  v_session public.sessions%rowtype;
  v_location public.locations%rowtype;
  v_employee public.employees%rowtype;
  v_ended_at timestamptz;
  v_duration_minutes integer;
  v_replayed boolean := false;
begin
  if v_identifier is null then
    raise exception using errcode = '22023', message = 'p_session_identifier is required';
  end if;
  if p_finish_operation_id is null then
    raise exception using errcode = '22023', message = 'p_finish_operation_id is required';
  end if;

  select d.id, d.device_id
    into v_device_pk, v_canonical_device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active is true
  where da.active is true
    and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
  union all
  select d.id, d.device_id
  from public.devices d
  where d.active is true
    and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
  limit 1;

  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;

  if exists (
    select 1 from public.sessions s
    where s.finish_operation_id = p_finish_operation_id
      and s.session_uuid <> v_identifier
      and coalesce(s.client_session_id, '') <> v_identifier
  ) then
    raise exception using errcode = '23505', message = 'Finish operation id is already bound to another session';
  end if;

  select s.* into v_session
  from public.sessions s
  where (s.session_uuid = v_identifier or s.client_session_id = v_identifier)
    and s.device_id = v_device_pk
  order by case when s.session_uuid = v_identifier then 0 else 1 end
  for update
  limit 1;

  if v_session.id is null then
    raise exception 'Session not found for exact server/client identifier and device: %', v_identifier;
  end if;

  select * into v_location from public.locations where id = v_session.location_id;
  select * into v_employee from public.employees where id = v_session.employee_id;

  if v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'status', 'cancelled',
      'terminal', true,
      'discard_local_workflow', true,
      'replayed', true
    );
  end if;

  if v_session.status not in ('active', 'pending_submit', 'closed') then
    raise exception 'Session % cannot transition from status %', v_session.session_uuid, v_session.status;
  end if;

  if v_session.finish_operation_id is not null
     and v_session.finish_operation_id <> p_finish_operation_id then
    raise exception using errcode = '23505', message = 'Session was already finished by another operation id';
  end if;

  if v_session.status = 'active' then
    -- Server time is authoritative. The client timestamp is intentionally not
    -- used to calculate operational duration.
    v_ended_at := now();
    v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_session.started_at)) / 60.0));
    update public.sessions s
    set status = 'pending_submit',
        ended_at = v_ended_at,
        duration_minutes = v_duration_minutes,
        duration_display = v_duration_minutes::text || ' min',
        finish_operation_id = p_finish_operation_id,
        updated_at = now()
    where s.id = v_session.id
    returning * into v_session;
  else
    v_replayed := v_session.finish_operation_id = p_finish_operation_id;
    if v_session.finish_operation_id is null then
      update public.sessions s
      set finish_operation_id = p_finish_operation_id,
          updated_at = now()
      where s.id = v_session.id
      returning * into v_session;
    end if;
  end if;

  return jsonb_build_object(
    'session_uuid', v_session.session_uuid,
    'client_session_id', v_session.client_session_id,
    'location_name', v_location.location_name,
    'employee_name', v_employee.display_name,
    'device_id', v_canonical_device_id,
    'status', v_session.status,
    'started_at', v_session.started_at,
    'ended_at', v_session.ended_at,
    'duration_minutes', v_session.duration_minutes,
    'duration_display', v_session.duration_display,
    'location_type', v_location.location_type,
    'form_type', v_location.form_type,
    'finish_operation_id', coalesce(v_session.finish_operation_id, p_finish_operation_id),
    'client_ended_at_received', p_client_ended_at is not null,
    'replayed', v_replayed
  );
end;
$$;

revoke all on function public.tool_finish_session_exact(text,text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.tool_finish_session_exact(text,text,uuid,timestamptz) to service_role;

-- A trusted manager must have a server-derived Messenger actor. Browser
-- supplied employee, device, sender, or receipt identities are never used for
-- manager requests.
alter table public.msg_users
  add column if not exists ops_manager_id uuid;

alter table public.msg_users
  drop constraint if exists msg_users_ops_manager_id_fkey;
alter table public.msg_users
  add constraint msg_users_ops_manager_id_fkey
  foreign key (ops_manager_id) references public.ops_manager_managers(manager_id) on delete set null;

create unique index if not exists uq_msg_users_ops_manager_id
  on public.msg_users(ops_manager_id)
  where ops_manager_id is not null;

create index if not exists idx_msg_messages_thread_cursor
  on public.msg_messages(thread_id, sent_at desc, id desc)
  where is_deleted is false;

create or replace function public.msg_ensure_ops_manager_user(
  p_manager_id uuid
) returns public.msg_users
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
  v_display_name text;
begin
  if p_manager_id is null then
    raise exception using errcode = '22023', message = 'Authenticated manager id is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('manager-messaging-user:' || p_manager_id::text, 0));
  select * into v_manager
  from public.ops_manager_managers
  where manager_id = p_manager_id
    and active is true
    and revoked_at is null
  for update;
  if v_manager.manager_id is null then
    raise exception using errcode = '42501', message = 'Active authenticated manager was not found';
  end if;

  select * into v_user
  from public.msg_users
  where ops_manager_id = p_manager_id
  limit 1;
  if v_user.id is not null then
    if v_user.is_active is false or v_user.role <> 'manager' then
      update public.msg_users
      set is_active = true, role = 'manager', updated_at = now()
      where id = v_user.id
      returning * into v_user;
    end if;
    return v_user;
  end if;

  select * into v_user
  from public.msg_users
  where ops_manager_id is null
    and is_active is true
    and role in ('manager','ops','ops_manager','operations_manager')
    and lower(btrim(display_name)) = lower(btrim(v_manager.display_name))
  order by created_at, id
  limit 1
  for update;
  if v_user.id is not null then
    update public.msg_users
    set ops_manager_id = p_manager_id, role = 'manager', updated_at = now()
    where id = v_user.id
    returning * into v_user;
    return v_user;
  end if;

  v_display_name := btrim(v_manager.display_name);
  if exists (select 1 from public.msg_users where lower(btrim(display_name)) = lower(v_display_name)) then
    v_display_name := left(v_display_name, 80) || ' · Ops Manager';
  end if;
  if exists (select 1 from public.msg_users where lower(btrim(display_name)) = lower(v_display_name)) then
    v_display_name := left(v_display_name, 68) || ' · ' || left(p_manager_id::text, 8);
  end if;
  insert into public.msg_users(display_name, role, is_active, ops_manager_id)
  values (v_display_name, 'manager', true, p_manager_id)
  returning * into v_user;
  return v_user;
end;
$$;

revoke all on function public.msg_ensure_ops_manager_user(uuid) from public, anon, authenticated;
grant execute on function public.msg_ensure_ops_manager_user(uuid) to service_role;

create table if not exists public.msg_message_audit (
  audit_id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.msg_messages(id) on delete restrict,
  thread_id uuid not null references public.msg_threads(id) on delete restrict,
  sender_user_id uuid not null references public.msg_users(id) on delete restrict,
  sender_ops_manager_id uuid references public.ops_manager_managers(manager_id) on delete set null,
  client_message_id text,
  message_type text not null,
  sender_display_name text not null,
  sender_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_msg_message_audit_sender_created
  on public.msg_message_audit(sender_user_id, created_at desc, audit_id);
create index if not exists idx_msg_message_audit_manager_created
  on public.msg_message_audit(sender_ops_manager_id, created_at desc, audit_id)
  where sender_ops_manager_id is not null;

alter table public.msg_message_audit enable row level security;
alter table public.msg_message_audit force row level security;
revoke all on table public.msg_message_audit from public, anon, authenticated;
grant select on table public.msg_message_audit to service_role;

create or replace function public.msg_audit_persisted_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.msg_message_audit(
    message_id, thread_id, sender_user_id, sender_ops_manager_id,
    client_message_id, message_type, sender_display_name, sender_role, created_at
  )
  select
    new.id, new.thread_id, new.sender_user_id, u.ops_manager_id,
    new.client_message_id, new.message_type, u.display_name, u.role, new.created_at
  from public.msg_users u
  where u.id = new.sender_user_id
  on conflict (message_id) do nothing;
  return new;
end;
$$;

revoke all on function public.msg_audit_persisted_message() from public, anon, authenticated;
drop trigger if exists trg_msg_message_immutable_audit on public.msg_messages;
create trigger trg_msg_message_immutable_audit
after insert on public.msg_messages
for each row execute function public.msg_audit_persisted_message();

-- Anonymous guest/feedback submissions receive server-verified immutable
-- operation identities. A retry can resolve the authoritative row instead of
-- creating another report.
alter table public.guest_cleanliness_reports
  add column if not exists operation_id uuid,
  add column if not exists request_fingerprint text;

update public.guest_cleanliness_reports
set operation_id = gen_random_uuid()
where operation_id is null;

alter table public.guest_cleanliness_reports
  alter column operation_id set not null,
  alter column operation_id set default gen_random_uuid();

alter table public.guest_cleanliness_reports
  drop constraint if exists guest_cleanliness_reports_request_fingerprint_check;
alter table public.guest_cleanliness_reports
  add constraint guest_cleanliness_reports_request_fingerprint_check
  check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');

create unique index if not exists uq_guest_cleanliness_reports_operation_id
  on public.guest_cleanliness_reports(operation_id);

alter table public.system_feedback_items
  add column if not exists operation_id uuid,
  add column if not exists request_fingerprint text;

update public.system_feedback_items
set operation_id = gen_random_uuid()
where operation_id is null;

alter table public.system_feedback_items
  alter column operation_id set not null,
  alter column operation_id set default gen_random_uuid();

alter table public.system_feedback_items
  drop constraint if exists system_feedback_items_request_fingerprint_check;
alter table public.system_feedback_items
  add constraint system_feedback_items_request_fingerprint_check
  check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');

create unique index if not exists uq_system_feedback_items_operation_id
  on public.system_feedback_items(operation_id);

-- Preserve the exact legacy metadata before the storage worker removes inline
-- image data. This table is service-role only and provides a forward-recovery
-- source without keeping the private payload in the operational row.
create table if not exists public.system_feedback_legacy_image_backups (
  feedback_id uuid primary key references public.system_feedback_items(id) on delete restrict,
  metadata_json jsonb not null,
  metadata_sha256 text not null,
  backed_up_at timestamptz not null default now(),
  migrated_at timestamptz,
  storage_bucket text,
  storage_path text,
  constraint system_feedback_legacy_image_backups_sha256_check
    check (metadata_sha256 ~ '^[0-9a-f]{64}$'),
  constraint system_feedback_legacy_image_backups_storage_pair_check
    check ((storage_bucket is null) = (storage_path is null))
);

insert into public.system_feedback_legacy_image_backups(feedback_id, metadata_json, metadata_sha256)
select id,
       metadata_json,
       encode(digest(convert_to(metadata_json::text, 'UTF8'), 'sha256'), 'hex')
from public.system_feedback_items
where metadata_json->'image_attachment'->>'data_url' is not null
on conflict (feedback_id) do nothing;

alter table public.system_feedback_legacy_image_backups enable row level security;
alter table public.system_feedback_legacy_image_backups force row level security;
revoke all on table public.system_feedback_legacy_image_backups from public, anon, authenticated;
grant select, insert, update on table public.system_feedback_legacy_image_backups to service_role;

-- Durable notification outbox. Job claims use database leases and
-- SKIP LOCKED so a Render restart or second worker cannot duplicate a claim.
create table if not exists public.operational_notification_jobs (
  job_id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  job_type text not null,
  source_id uuid not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  available_at timestamptz not null default now(),
  leased_at timestamptz,
  leased_until timestamptz,
  lease_token uuid,
  worker_id text,
  completed_at timestamptz,
  last_error text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_notification_jobs_status_check
    check (status in ('pending','leased','completed','dead')),
  constraint operational_notification_jobs_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 100),
  constraint operational_notification_jobs_key_length
    check (length(job_key) between 1 and 240),
  constraint operational_notification_jobs_type_length
    check (length(job_type) between 1 and 100)
);

create index if not exists idx_operational_notification_jobs_claim
  on public.operational_notification_jobs(status, available_at, created_at, job_id)
  where status in ('pending','leased');
create index if not exists idx_operational_notification_jobs_source
  on public.operational_notification_jobs(job_type, source_id, created_at desc);

alter table public.operational_notification_jobs enable row level security;
alter table public.operational_notification_jobs force row level security;
revoke all on table public.operational_notification_jobs from public, anon, authenticated;
grant select, insert, update on table public.operational_notification_jobs to service_role;

create or replace function public.claim_operational_notification_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 90
) returns setof public.operational_notification_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;
  return query
  with candidates as (
    select j.job_id
    from public.operational_notification_jobs j
    where (
      (j.status = 'pending' and j.available_at <= now())
      or (j.status = 'leased' and j.leased_until < now())
    )
      and j.attempts < j.max_attempts
    order by j.available_at, j.created_at, j.job_id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  )
  update public.operational_notification_jobs j
  set status = 'leased',
      attempts = j.attempts + 1,
      leased_at = now(),
      leased_until = now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 900))),
      lease_token = gen_random_uuid(),
      worker_id = left(p_worker_id, 160),
      updated_at = now()
  from candidates c
  where j.job_id = c.job_id
  returning j.*;
end;
$$;

create or replace function public.finish_operational_notification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_seconds integer default 30
) returns public.operational_notification_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.operational_notification_jobs;
begin
  update public.operational_notification_jobs j
  set status = case
        when p_succeeded then 'completed'
        when j.attempts >= j.max_attempts then 'dead'
        else 'pending'
      end,
      completed_at = case when p_succeeded then now() else null end,
      available_at = case when p_succeeded then j.available_at else now() + make_interval(secs => greatest(5, least(coalesce(p_retry_seconds, 30), 3600))) end,
      leased_at = null,
      leased_until = null,
      lease_token = null,
      worker_id = null,
      last_error = case when p_succeeded then null else left(coalesce(p_error, 'notification failed'), 2000) end,
      updated_at = now()
  where j.job_id = p_job_id
    and j.status = 'leased'
    and j.lease_token = p_lease_token
  returning j.* into v_row;
  if v_row.job_id is null then
    raise exception 'notification job lease is no longer authoritative';
  end if;
  return v_row;
end;
$$;

revoke all on function public.claim_operational_notification_jobs(text,integer,integer) from public, anon, authenticated;
revoke all on function public.finish_operational_notification_job(uuid,uuid,boolean,text,integer) from public, anon, authenticated;
grant execute on function public.claim_operational_notification_jobs(text,integer,integer) to service_role;
grant execute on function public.finish_operational_notification_job(uuid,uuid,boolean,text,integer) to service_role;

create or replace function public.claim_operational_notification_job_by_key(
  p_job_key text,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns public.operational_notification_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.operational_notification_jobs;
begin
  if nullif(btrim(p_job_key), '') is null or nullif(btrim(p_worker_id), '') is null then
    raise exception 'job key and worker id are required';
  end if;
  update public.operational_notification_jobs j
  set status = 'leased',
      attempts = j.attempts + 1,
      leased_at = now(),
      leased_until = now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 900))),
      lease_token = gen_random_uuid(),
      worker_id = left(p_worker_id, 160),
      updated_at = now()
  where j.job_key = btrim(p_job_key)
    and (
      (j.status = 'pending' and j.available_at <= now())
      or (j.status = 'leased' and j.leased_until < now())
    )
    and j.attempts < j.max_attempts
  returning j.* into v_row;
  return v_row;
end;
$$;

revoke all on function public.claim_operational_notification_job_by_key(text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_operational_notification_job_by_key(text,text,integer) to service_role;

create or replace function public.msg_enqueue_background_work()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if lower(coalesce(new.metadata_json->>'channel','')) = 'memphis'
     and lower(coalesce(new.metadata_json->>'ai','false')) not in ('true','1','yes')
     and new.message_type <> 'bot_response' then
    insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)
    values (
      'memphis-reply:' || new.id::text,
      'memphis_bot_reply',
      new.id,
      jsonb_build_object('message_id', new.id, 'thread_id', new.thread_id, 'sender_user_id', new.sender_user_id)
    )
    on conflict (job_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.msg_enqueue_background_work() from public, anon, authenticated;
drop trigger if exists trg_msg_enqueue_background_work on public.msg_messages;
create trigger trg_msg_enqueue_background_work
after insert on public.msg_messages
for each row execute function public.msg_enqueue_background_work();

-- The Render worker uses its existing private Supabase Storage authority to
-- move legacy inline images. The source row remains untouched until the
-- private object upload succeeds, and retries are leased/idempotent.
insert into public.operational_notification_jobs(job_key, job_type, source_id, payload_json)
select 'feedback-image-migration:' || b.feedback_id::text,
       'feedback_image_migration',
       b.feedback_id,
       jsonb_build_object('feedback_id', b.feedback_id, 'backup_sha256', b.metadata_sha256)
from public.system_feedback_legacy_image_backups b
where b.migrated_at is null
on conflict (job_key) do nothing;

-- Annie's shared chat state now uses optimistic concurrency. This makes Clear
-- Chat authoritative and prevents a stale second browser from silently
-- restoring or overwriting it.
alter table public.annie_chat_state
  add column if not exists revision bigint not null default 1;

create or replace function public.moxie_save_chat_state(
  p_expected_revision bigint,
  p_history jsonb,
  p_saved_chats jsonb
) returns public.annie_chat_state
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.annie_chat_state;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if jsonb_typeof(coalesce(p_history, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_saved_chats, '[]'::jsonb)) <> 'array' then
    raise exception 'chat state must contain arrays';
  end if;
  insert into public.annie_chat_state(id, history, saved_chats, revision, updated_at)
  values ('default', coalesce(p_history, '[]'::jsonb), coalesce(p_saved_chats, '[]'::jsonb), 1, now())
  on conflict (id) do nothing;
  update public.annie_chat_state
  set history = coalesce(p_history, '[]'::jsonb),
      saved_chats = coalesce(p_saved_chats, '[]'::jsonb),
      revision = revision + 1,
      updated_at = now()
  where id = 'default'
    and revision = p_expected_revision
  returning * into v_row;
  if v_row.id is null then
    raise exception using errcode = '40001', message = 'Moxie chat state changed in another browser.';
  end if;
  return v_row;
end;
$$;

revoke all on function public.moxie_save_chat_state(bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.moxie_save_chat_state(bigint,jsonb,jsonb) to service_role;

commit;
