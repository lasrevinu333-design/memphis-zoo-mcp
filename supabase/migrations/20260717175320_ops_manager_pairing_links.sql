-- Ops Manager trusted-device pairing repair.
-- Forward-only/data-preserving.  This replaces routine password enrollment with
-- short-lived, single-use pairing links while preserving the existing
-- ops_manager_trusted_devices cookie/session architecture.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ops_manager_pairing_tokens (
  pairing_id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_by_credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  created_by_device_id text null,
  created_by_actor text not null default 'ops_manager',
  intended_device_label text null,
  max_access_level text not null default 'full_access',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by_credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  used_by_device_id text null,
  revoked_at timestamptz null,
  revoked_reason text null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_pairing_tokens_hash_length check (length(token_hash) = 64),
  constraint ops_manager_pairing_tokens_actor_length check (length(created_by_actor) between 1 and 120),
  constraint ops_manager_pairing_tokens_access_level check (max_access_level in ('read_only','full_access')),
  constraint ops_manager_pairing_tokens_expiration check (expires_at > created_at),
  constraint ops_manager_pairing_tokens_label_length check (intended_device_label is null or length(intended_device_label) <= 160),
  constraint ops_manager_pairing_tokens_created_device_length check (created_by_device_id is null or length(created_by_device_id) between 1 and 96),
  constraint ops_manager_pairing_tokens_used_device_length check (used_by_device_id is null or length(used_by_device_id) between 1 and 96),
  constraint ops_manager_pairing_tokens_revocation_reason_length check (revoked_reason is null or length(revoked_reason) <= 160),
  constraint ops_manager_pairing_tokens_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_pairing_tokens_active
  on public.ops_manager_pairing_tokens (expires_at, created_at)
  where used_at is null and revoked_at is null;

create index if not exists idx_ops_manager_pairing_tokens_created_by
  on public.ops_manager_pairing_tokens (created_by_credential_id, created_at desc);

create index if not exists idx_ops_manager_pairing_tokens_used_by
  on public.ops_manager_pairing_tokens (used_by_credential_id, used_at desc)
  where used_at is not null;

alter table public.ops_manager_pairing_tokens enable row level security;
alter table public.ops_manager_pairing_tokens force row level security;

revoke all on table public.ops_manager_pairing_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_pairing_tokens to postgres, service_role;

comment on table public.ops_manager_pairing_tokens is
  'Short-lived single-use Ops Manager trusted-device pairing tokens. token_hash is persisted; raw pairing tokens are returned only by the server-side creation function.';

create or replace function public.ops_manager_create_pairing_token(
  p_created_by_credential_id uuid default null,
  p_created_by_device_id text default null,
  p_created_by_actor text default 'ops_manager',
  p_intended_device_label text default null,
  p_ttl_seconds integer default 600,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_pairing_id uuid;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_hash text := encode(digest(v_token, 'sha256'), 'hex');
  v_ttl integer := least(900, greatest(60, coalesce(p_ttl_seconds, 600)));
  v_expires_at timestamptz := now() + make_interval(secs => least(900, greatest(60, coalesce(p_ttl_seconds, 600))));
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
  v_access text := 'full_access';
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  if p_created_by_credential_id is not null and not exists (
    select 1
    from public.ops_manager_trusted_devices d
    where d.credential_id = p_created_by_credential_id
      and d.revoked_at is null
      and d.expires_at > now()
      and d.max_access_level = 'full_access'
  ) then
    raise exception 'creating credential is not an active full-access trusted manager device';
  end if;

  insert into public.ops_manager_pairing_tokens (
    token_hash,
    created_by_credential_id,
    created_by_device_id,
    created_by_actor,
    intended_device_label,
    max_access_level,
    expires_at,
    metadata_json
  )
  values (
    v_hash,
    p_created_by_credential_id,
    nullif(left(coalesce(p_created_by_device_id, ''), 96), ''),
    left(coalesce(nullif(p_created_by_actor, ''), 'ops_manager'), 120),
    nullif(left(coalesce(p_intended_device_label, ''), 160), ''),
    v_access,
    v_expires_at,
    v_metadata
  )
  returning pairing_id into v_pairing_id;

  return jsonb_build_object(
    'ok', true,
    'pairing_id', v_pairing_id,
    'pairing_token', v_token,
    'expires_at', v_expires_at,
    'ttl_seconds', v_ttl,
    'max_access_level', v_access
  );
end;
$function$;

create or replace function public.ops_manager_consume_pairing_and_enroll(
  p_token text,
  p_credential_id uuid,
  p_device_id text,
  p_device_label text,
  p_trust_token_hash text,
  p_max_access_level text default 'full_access',
  p_user_agent_hash text default null,
  p_created_ip_hash text default null,
  p_expires_at timestamptz default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_hash text;
  v_pairing public.ops_manager_pairing_tokens%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_now timestamptz := now();
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
  v_max_access text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'malformed');
  end if;
  if p_credential_id is null then
    raise exception 'credential_id is required';
  end if;
  if p_device_id is null or length(trim(p_device_id)) < 1 or length(trim(p_device_id)) > 96 then
    raise exception 'valid device_id is required';
  end if;
  if p_device_label is null or length(trim(p_device_label)) < 1 or length(trim(p_device_label)) > 160 then
    raise exception 'valid device_label is required';
  end if;
  if p_trust_token_hash is null or length(p_trust_token_hash) <> 64 then
    raise exception 'valid trust token hash is required';
  end if;
  if p_expires_at is null or p_expires_at <= v_now then
    raise exception 'future trusted-device expiration is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  v_hash := encode(digest(lower(p_token), 'sha256'), 'hex');

  select *
    into v_pairing
  from public.ops_manager_pairing_tokens
  where token_hash = v_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'invalid');
  end if;
  if v_pairing.used_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'used', 'pairing_id', v_pairing.pairing_id);
  end if;
  if v_pairing.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'revoked', 'pairing_id', v_pairing.pairing_id);
  end if;
  if v_pairing.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'expired', 'pairing_id', v_pairing.pairing_id);
  end if;

  v_max_access := case
    when v_pairing.max_access_level = 'full_access' and coalesce(p_max_access_level, 'full_access') = 'full_access' then 'full_access'
    else 'read_only'
  end;

  update public.ops_manager_trusted_devices
  set revoked_at = v_now,
      revoked_reason = 'device_re-enrolled_by_pairing'
  where device_id = trim(p_device_id)
    and revoked_at is null;

  insert into public.ops_manager_trusted_devices (
    credential_id,
    device_id,
    device_label,
    token_hash,
    max_access_level,
    user_agent_hash,
    created_ip_hash,
    expires_at,
    metadata_json
  )
  values (
    p_credential_id,
    trim(p_device_id),
    trim(p_device_label),
    p_trust_token_hash,
    v_max_access,
    p_user_agent_hash,
    p_created_ip_hash,
    p_expires_at,
    v_metadata || jsonb_build_object(
      'pairing_id', v_pairing.pairing_id,
      'enrollment_source', 'one_time_pairing_link'
    )
  )
  returning * into v_device;

  update public.ops_manager_pairing_tokens
  set used_at = v_now,
      used_by_credential_id = p_credential_id,
      used_by_device_id = trim(p_device_id),
      metadata_json = metadata_json || jsonb_build_object('used_user_agent_hash', p_user_agent_hash, 'used_ip_hash', p_created_ip_hash)
  where pairing_id = v_pairing.pairing_id;

  return jsonb_build_object(
    'ok', true,
    'pairing_id', v_pairing.pairing_id,
    'trusted_device', jsonb_build_object(
      'credential_id', v_device.credential_id,
      'device_id', v_device.device_id,
      'device_label', v_device.device_label,
      'max_access_level', v_device.max_access_level,
      'created_at', v_device.created_at,
      'expires_at', v_device.expires_at
    )
  );
end;
$function$;

revoke all on function public.ops_manager_create_pairing_token(uuid, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ops_manager_consume_pairing_and_enroll(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ops_manager_create_pairing_token(uuid, text, text, text, integer, jsonb) to postgres, service_role;
grant execute on function public.ops_manager_consume_pairing_and_enroll(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) to postgres, service_role;

comment on function public.ops_manager_create_pairing_token(uuid, text, text, text, integer, jsonb) is
  'Creates a short-lived single-use Ops Manager trusted-device pairing token and returns the raw token exactly to the service-role caller.';
comment on function public.ops_manager_consume_pairing_and_enroll(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) is
  'Atomically consumes an Ops Manager pairing token, revokes older credentials for the same browser device_id, and inserts the new trusted-device credential.';
