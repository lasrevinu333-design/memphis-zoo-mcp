-- Ops Manager one-time numeric code enrollment.
-- Forward-only/data-preserving. Link-based pairing remains in place for
-- rollback/bootstrap compatibility, but normal production manager enrollment
-- uses hashed eight-digit codes consumed through the normal Hub URL.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ops_manager_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete cascade,
  code_hash text not null unique,
  role_snapshot text not null,
  created_by_manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null,
  created_by_credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  revoked_at timestamptz null,
  revoked_reason text null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  consumed_credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  consumed_device_id text null,
  status text not null default 'active',
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_enrollment_codes_hash_len check (length(code_hash) = 64),
  constraint ops_manager_enrollment_codes_role check (role_snapshot in ('OPS_MANAGER','DIRECTOR','SECURITY_ADMIN')),
  constraint ops_manager_enrollment_codes_expiration check (expires_at > created_at),
  constraint ops_manager_enrollment_codes_attempts check (max_attempts between 1 and 20 and attempt_count >= 0 and attempt_count <= max_attempts),
  constraint ops_manager_enrollment_codes_status check (status in ('active','used','expired','revoked','locked')),
  constraint ops_manager_enrollment_codes_device_len check (consumed_device_id is null or length(consumed_device_id) between 1 and 96),
  constraint ops_manager_enrollment_codes_revoked_reason_len check (revoked_reason is null or length(revoked_reason) <= 160),
  constraint ops_manager_enrollment_codes_metadata_object check (jsonb_typeof(metadata_json) = 'object'),
  constraint ops_manager_enrollment_codes_consumption_consistent check (
    (consumed_at is null and consumed_credential_id is null and consumed_device_id is null and status <> 'used')
    or
    (consumed_at is not null and consumed_credential_id is not null and consumed_device_id is not null and status = 'used')
  )
);

create index if not exists idx_ops_manager_enrollment_codes_manager
  on public.ops_manager_enrollment_codes (manager_id, created_at desc);

create index if not exists idx_ops_manager_enrollment_codes_active
  on public.ops_manager_enrollment_codes (expires_at, created_at)
  where consumed_at is null and revoked_at is null and status = 'active';

create index if not exists idx_ops_manager_enrollment_codes_created_by
  on public.ops_manager_enrollment_codes (created_by_manager_id, created_at desc)
  where created_by_manager_id is not null;

alter table public.ops_manager_enrollment_codes enable row level security;
alter table public.ops_manager_enrollment_codes force row level security;

revoke all on table public.ops_manager_enrollment_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_enrollment_codes to postgres, service_role;

alter table public.ops_manager_trusted_devices
  add column if not exists manager_enrollment_code_id uuid null references public.ops_manager_enrollment_codes(id) on delete set null;

create index if not exists idx_ops_manager_trusted_devices_manager_code
  on public.ops_manager_trusted_devices (manager_enrollment_code_id)
  where manager_enrollment_code_id is not null;

create table if not exists public.ops_manager_enrollment_code_rate_limits (
  key_hash text primary key,
  failure_count integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  locked_until timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_enrollment_code_rate_limits_key_len check (length(key_hash) = 64),
  constraint ops_manager_enrollment_code_rate_limits_count check (failure_count >= 0 and failure_count <= 1000),
  constraint ops_manager_enrollment_code_rate_limits_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_enrollment_code_rate_limits_locked
  on public.ops_manager_enrollment_code_rate_limits (locked_until)
  where locked_until is not null;

alter table public.ops_manager_enrollment_code_rate_limits enable row level security;
alter table public.ops_manager_enrollment_code_rate_limits force row level security;

revoke all on table public.ops_manager_enrollment_code_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_enrollment_code_rate_limits to postgres, service_role;

create or replace function public.ops_manager_consume_enrollment_code(
  p_code_hash text,
  p_credential_id uuid,
  p_device_id text,
  p_device_label text,
  p_trust_token_hash text,
  p_user_agent_hash text default null,
  p_created_ip_hash text default null,
  p_platform_summary text default null,
  p_expires_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_code public.ops_manager_enrollment_codes%rowtype;
  v_manager public.ops_manager_managers%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_now timestamptz := now();
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'malformed');
  end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 1 or length(trim(p_device_id)) > 96 then
    raise exception 'valid device_id is required';
  end if;
  if p_device_label is null or length(trim(p_device_label)) < 1 or length(trim(p_device_label)) > 160 then
    raise exception 'valid device_label is required';
  end if;
  if p_trust_token_hash is null or p_trust_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid trust token hash is required';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'future trusted-device expiration is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  select *
    into v_code
  from public.ops_manager_enrollment_codes
  where code_hash = lower(p_code_hash)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'invalid');
  end if;

  if v_code.status = 'used' or v_code.consumed_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'used', 'code_id', v_code.id);
  end if;
  if v_code.status = 'revoked' or v_code.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'revoked', 'code_id', v_code.id);
  end if;
  if v_code.status = 'locked' or v_code.attempt_count >= v_code.max_attempts then
    update public.ops_manager_enrollment_codes
       set status = 'locked',
           attempt_count = least(max_attempts, attempt_count + 1),
           metadata_json = metadata_json || jsonb_build_object('last_attempt_at', v_now)
     where id = v_code.id;
    return jsonb_build_object('ok', false, 'status', 429, 'reason', 'locked', 'code_id', v_code.id);
  end if;
  if v_code.expires_at <= v_now then
    update public.ops_manager_enrollment_codes
       set status = 'expired',
           attempt_count = least(max_attempts, attempt_count + 1),
           metadata_json = metadata_json || jsonb_build_object('expired_checked_at', v_now)
     where id = v_code.id;
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'expired', 'code_id', v_code.id);
  end if;

  select *
    into v_manager
  from public.ops_manager_managers
  where manager_id = v_code.manager_id
  for update;

  if not found or v_manager.active is not true or v_manager.revoked_at is not null then
    update public.ops_manager_enrollment_codes
       set attempt_count = least(max_attempts, attempt_count + 1),
           metadata_json = metadata_json || jsonb_build_object('manager_rejected_at', v_now)
     where id = v_code.id;
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'manager_inactive', 'code_id', v_code.id);
  end if;

  if not (v_code.role_snapshot = any(v_manager.roles)) then
    update public.ops_manager_enrollment_codes
       set attempt_count = least(max_attempts, attempt_count + 1),
           metadata_json = metadata_json || jsonb_build_object('role_rejected_at', v_now)
     where id = v_code.id;
    return jsonb_build_object('ok', false, 'status', 403, 'reason', 'role_mismatch', 'code_id', v_code.id);
  end if;

  update public.ops_manager_trusted_devices
     set revoked_at = v_now,
         revoked_reason = 'device_re-enrolled_by_manager_code'
   where device_id = trim(p_device_id)
     and revoked_at is null;

  insert into public.ops_manager_trusted_devices (
    credential_id,
    device_id,
    device_label,
    token_hash,
    max_access_level,
    manager_id,
    manager_enrollment_code_id,
    user_agent_hash,
    created_ip_hash,
    platform_summary,
    expires_at,
    metadata_json
  )
  values (
    p_credential_id,
    trim(p_device_id),
    trim(p_device_label),
    lower(p_trust_token_hash),
    'full_access',
    v_manager.manager_id,
    v_code.id,
    p_user_agent_hash,
    p_created_ip_hash,
    nullif(left(coalesce(p_platform_summary, ''), 160), ''),
    p_expires_at,
    v_metadata || jsonb_build_object(
      'manager_enrollment_code_id', v_code.id,
      'enrollment_source', 'one_time_manager_code',
      'role_snapshot', v_code.role_snapshot
    )
  )
  returning * into v_device;

  update public.ops_manager_enrollment_codes
     set consumed_at = v_now,
         consumed_credential_id = p_credential_id,
         consumed_device_id = trim(p_device_id),
         status = 'used',
         metadata_json = metadata_json || jsonb_build_object(
           'used_user_agent_hash', p_user_agent_hash,
           'used_ip_hash', p_created_ip_hash,
           'platform_summary', nullif(left(coalesce(p_platform_summary, ''), 160), '')
         )
   where id = v_code.id;

  update public.ops_manager_managers
     set last_access_at = v_now
   where manager_id = v_manager.manager_id;

  return jsonb_build_object(
    'ok', true,
    'code_id', v_code.id,
    'manager', jsonb_build_object(
      'manager_id', v_manager.manager_id,
      'display_name', v_manager.display_name,
      'contact_label', v_manager.contact_label,
      'roles', v_manager.roles,
      'active', v_manager.active,
      'revoked_at', v_manager.revoked_at,
      'created_at', v_manager.created_at,
      'last_access_at', v_now
    ),
    'trusted_device', jsonb_build_object(
      'credential_id', v_device.credential_id,
      'device_id', v_device.device_id,
      'device_label', v_device.device_label,
      'manager_id', v_device.manager_id,
      'manager_enrollment_code_id', v_code.id,
      'max_access_level', v_device.max_access_level,
      'created_at', v_device.created_at,
      'expires_at', v_device.expires_at
    )
  );
end;
$function$;

revoke all on function public.ops_manager_consume_enrollment_code(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ops_manager_consume_enrollment_code(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) to postgres, service_role;

comment on table public.ops_manager_enrollment_codes is
  'Short-lived single-use Ops Manager browser enrollment codes. code_hash is an HMAC of the normalized code; plaintext codes are returned only once by the backend and are never persisted.';
comment on table public.ops_manager_enrollment_code_rate_limits is
  'Server-side abuse protection for numeric Ops Manager enrollment code attempts. Keys are privacy-preserving HMAC hashes.';
comment on function public.ops_manager_consume_enrollment_code(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) is
  'Atomically consumes a hashed one-time Ops Manager code and creates a revocable trusted manager-device credential.';
