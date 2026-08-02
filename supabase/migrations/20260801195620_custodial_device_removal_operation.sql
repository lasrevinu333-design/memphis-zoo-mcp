-- Atomic, credential-bound removal for the native custodial application.
--
-- This migration is forward-only and data-preserving. The operation record is
-- deliberately terminal and retains only the credential UUID plus its
-- non-secret result. The credential's existing one-way token hash remains the
-- proof for an authenticated replay; no plaintext device or push credential is
-- copied into operation history. Application rollback can stop calling the RPC
-- while leaving the immutable removal/audit evidence in place.

begin;

create table if not exists public.device_auth_removal_operations (
  operation_id uuid primary key,
  device_id uuid not null references public.devices(id) on delete restrict,
  credential_id uuid not null unique references public.device_auth_credentials(credential_id) on delete restrict,
  status text not null default 'removed',
  result_json jsonb not null,
  removed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint device_auth_removal_operations_status_check
    check (status = 'removed'),
  constraint device_auth_removal_operations_result_check
    check (jsonb_typeof(result_json) = 'object')
);

create index if not exists idx_device_auth_removal_operations_device_recent
  on public.device_auth_removal_operations(device_id, removed_at desc, operation_id);
create index if not exists idx_operational_notification_jobs_employee_credential_open
  on public.operational_notification_jobs((payload_json->>'credential_id'), status)
  where job_type in ('employee_event_push', 'employee_native_push')
    and status in ('pending', 'leased');

alter table public.device_auth_removal_operations enable row level security;
alter table public.device_auth_removal_operations force row level security;
revoke all on table public.device_auth_removal_operations from public, anon, authenticated;
grant select, insert on table public.device_auth_removal_operations to postgres, service_role;

create or replace function public.device_auth_remove_custodial_credential(
  p_operation_id uuid,
  p_device_id uuid,
  p_credential_id uuid,
  p_token_hash text,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_operation public.device_auth_removal_operations%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_device_identifier text;
  v_push_registrations integer := 0;
  v_event_instances integer := 0;
  v_notification_jobs integer := 0;
  v_claimed_jobs integer := 0;
  v_result jsonb;
begin
  if p_operation_id is null or p_device_id is null or p_credential_id is null
     or p_token_hash is null or length(p_token_hash) <> 64 or p_now is null then
    raise exception using
      errcode = '22023',
      message = 'operation, device, and credential proof are required';
  end if;

  -- A stable operation lock makes concurrent response-loss retries deterministic
  -- even before the terminal operation row exists.
  perform pg_advisory_xact_lock(
    hashtextextended('custodial-device-removal:' || p_operation_id::text, 0)
  );

  select * into v_operation
  from public.device_auth_removal_operations
  where operation_id = p_operation_id
  for update;

  if v_operation.operation_id is not null then
    -- Revocation is intentionally ignored only for this exact terminal replay.
    -- The caller must still prove the original credential ID and one-way hash.
    select * into v_credential
    from public.device_auth_credentials
    where credential_id = p_credential_id
      and device_id = p_device_id
      and token_hash = p_token_hash
    for update;

    if v_credential.credential_id is null
       or v_operation.credential_id <> p_credential_id
       or v_operation.device_id <> p_device_id then
      return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
    end if;

    return v_operation.result_json || jsonb_build_object(
      'ok', true,
      'replayed', true
    );
  end if;

  select * into v_credential
  from public.device_auth_credentials
  where credential_id = p_credential_id
  for update;

  if v_credential.credential_id is null
     or v_credential.device_id <> p_device_id
     or v_credential.token_hash <> p_token_hash then
    return jsonb_build_object('ok', false, 'reason', 'credential_mismatch');
  end if;
  if v_credential.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'credential_revoked');
  end if;
  if v_credential.expires_at <= p_now then
    return jsonb_build_object('ok', false, 'reason', 'credential_expired');
  end if;
  if v_credential.confirmed_at is null then
    return jsonb_build_object('ok', false, 'reason', 'credential_unconfirmed');
  end if;

  select device_id into v_device_identifier
  from public.devices
  where id = p_device_id;
  if v_device_identifier is null
     or v_device_identifier !~ '^KIOSK_(0[2-9]|10)$' then
    return jsonb_build_object('ok', false, 'reason', 'device_not_eligible');
  end if;

  with changed as (
    update public.employee_push_registrations
       set active = false,
           revoked_at = coalesce(revoked_at, p_now),
           revoked_reason = 'custodial_device_removed',
           last_error = 'custodial_device_removed',
           updated_at = p_now
     where credential_id = p_credential_id
       and (active = true or revoked_at is null)
    returning registration_id
  )
  select count(*)::integer into v_push_registrations from changed;

  with changed as (
    update public.event_push_instances
       set state = 'cancelled',
           cancelled_at = coalesce(cancelled_at, p_now),
           last_error = 'custodial_device_removed',
           updated_at = p_now
     where credential_id = p_credential_id
       and state in ('pending', 'leased')
    returning instance_id
  )
  select count(*)::integer into v_event_instances from changed;

  -- Active lease proof is retained on a terminally cancelled claimed job. This
  -- lets the owning worker call finish_operational_notification_job_terminal,
  -- while every claim path rejects the now-dead row after a restart.
  with candidates as (
    select job_id, status as previous_status
    from public.operational_notification_jobs
    where job_type in ('employee_event_push', 'employee_native_push')
      and status in ('pending', 'leased')
      and payload_json->>'credential_id' = p_credential_id::text
    for update
  ), changed as (
    update public.operational_notification_jobs job
       set status = 'dead',
           completed_at = coalesce(job.completed_at, p_now),
           last_error = 'custodial_device_removed',
           updated_at = p_now
      from candidates
     where job.job_id = candidates.job_id
    returning candidates.previous_status
  )
  select count(*)::integer,
         (count(*) filter (where previous_status = 'leased'))::integer
    into v_notification_jobs, v_claimed_jobs
  from changed;

  update public.device_auth_credentials
     set revoked_at = p_now,
         revoked_reason = 'custodial_device_removed'
   where credential_id = p_credential_id;

  v_result := jsonb_build_object(
    'ok', true,
    'removed', true,
    'replayed', false,
    'status', 'removed',
    'operation_id', p_operation_id,
    'credential_id', p_credential_id,
    'device_id', v_device_identifier,
    'removed_at', p_now,
    'push_registrations_deactivated', v_push_registrations,
    'event_push_instances_cancelled', v_event_instances,
    'notification_jobs_cancelled', v_notification_jobs,
    'claimed_notification_jobs_cancelled', v_claimed_jobs
  );

  insert into public.device_auth_removal_operations(
    operation_id, device_id, credential_id, status, result_json, removed_at
  ) values (
    p_operation_id, p_device_id, p_credential_id, 'removed', v_result, p_now
  );

  insert into public.device_auth_events(
    device_id, credential_id, event_type, success, reason, presented_identifier, metadata_json
  ) values (
    p_device_id,
    p_credential_id,
    'custodial_device_removed',
    true,
    'client_requested_removal',
    null,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'push_registrations_deactivated', v_push_registrations,
      'event_push_instances_cancelled', v_event_instances,
      'notification_jobs_cancelled', v_notification_jobs,
      'claimed_notification_jobs_cancelled', v_claimed_jobs
    )
  );

  return v_result;
end
$function$;

revoke all on function public.device_auth_remove_custodial_credential(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.device_auth_remove_custodial_credential(uuid, uuid, uuid, text, timestamptz)
  to postgres, service_role;

comment on table public.device_auth_removal_operations is
  'Immutable terminal replay records for authenticated native custodial device removal. No plaintext credentials are stored.';
comment on function public.device_auth_remove_custodial_credential(uuid, uuid, uuid, text, timestamptz) is
  'Atomically authenticates and removes one custodial credential, reconciles push delivery state, audits the action, and permits only credential-bound terminal replay.';

commit;
