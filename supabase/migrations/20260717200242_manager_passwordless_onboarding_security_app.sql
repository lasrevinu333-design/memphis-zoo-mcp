-- Manager passwordless onboarding and Device Security app protection.
-- Forward-only/data-preserving.  This preserves the existing Ops Manager
-- trusted-device cookie architecture while adding named manager principals,
-- role-bound invitations, and a separately password-protected Device Security
-- application gate.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ops_manager_managers (
  manager_id uuid primary key default gen_random_uuid(),
  display_name text not null,
  contact_label text null,
  roles text[] not null default array['OPS_MANAGER']::text[],
  active boolean not null default true,
  revoked_at timestamptz null,
  revoked_by_manager_id uuid null,
  revoked_reason text null,
  created_at timestamptz not null default now(),
  created_by_manager_id uuid null,
  created_by_credential_id uuid null,
  last_access_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_managers_display_name_len check (length(btrim(display_name)) between 1 and 160),
  constraint ops_manager_managers_contact_label_len check (contact_label is null or length(contact_label) <= 240),
  constraint ops_manager_managers_roles_valid check (
    cardinality(roles) >= 1
    and roles <@ array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
  ),
  constraint ops_manager_managers_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_managers_active
  on public.ops_manager_managers (active, display_name);

create index if not exists idx_ops_manager_managers_roles
  on public.ops_manager_managers using gin (roles);

alter table public.ops_manager_managers enable row level security;
alter table public.ops_manager_managers force row level security;
revoke all on table public.ops_manager_managers from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_managers to postgres, service_role;

alter table public.ops_manager_trusted_devices
  add column if not exists manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null,
  add column if not exists invitation_id uuid null,
  add column if not exists platform_summary text null;

create index if not exists idx_ops_manager_trusted_devices_manager
  on public.ops_manager_trusted_devices (manager_id, revoked_at, last_used_at desc nulls last);

alter table public.ops_manager_pairing_tokens
  add column if not exists manager_id uuid null references public.ops_manager_managers(manager_id) on delete cascade,
  add column if not exists intended_role text null,
  add column if not exists invitation_kind text not null default 'manager_device',
  add column if not exists max_uses integer not null default 1,
  add column if not exists use_count integer not null default 0;

alter table public.ops_manager_pairing_tokens
  drop constraint if exists ops_manager_pairing_tokens_intended_role;

alter table public.ops_manager_pairing_tokens
  add constraint ops_manager_pairing_tokens_intended_role
  check (intended_role is null or intended_role in ('OPS_MANAGER','DIRECTOR','SECURITY_ADMIN'));

alter table public.ops_manager_pairing_tokens
  drop constraint if exists ops_manager_pairing_tokens_kind;

alter table public.ops_manager_pairing_tokens
  add constraint ops_manager_pairing_tokens_kind
  check (invitation_kind in ('pc','phone','additional_device','manager_device','bootstrap'));

alter table public.ops_manager_pairing_tokens
  drop constraint if exists ops_manager_pairing_tokens_use_count;

alter table public.ops_manager_pairing_tokens
  add constraint ops_manager_pairing_tokens_use_count
  check (max_uses between 1 and 5 and use_count >= 0 and use_count <= max_uses);

create index if not exists idx_ops_manager_pairing_tokens_manager
  on public.ops_manager_pairing_tokens (manager_id, created_at desc);

create table if not exists public.ops_manager_device_security_config (
  singleton boolean primary key default true,
  password_hash text not null,
  password_version integer not null default 1,
  rotated_at timestamptz not null default now(),
  rotated_by_manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null,
  sessions_revoked_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_security_config_singleton check (singleton),
  constraint ops_manager_device_security_config_hash check (length(password_hash) >= 40),
  constraint ops_manager_device_security_config_version check (password_version >= 1),
  constraint ops_manager_device_security_config_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create table if not exists public.ops_manager_device_security_sessions (
  session_id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete cascade,
  credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  token_hash text not null unique,
  csrf_hash text not null,
  password_version integer not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_reason text null,
  ip_hash text null,
  user_agent_hash text null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_security_sessions_hash_len check (length(token_hash) = 64),
  constraint ops_manager_device_security_sessions_csrf_len check (length(csrf_hash) = 64),
  constraint ops_manager_device_security_sessions_exp check (expires_at > created_at),
  constraint ops_manager_device_security_sessions_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_device_security_sessions_active
  on public.ops_manager_device_security_sessions (manager_id, credential_id, expires_at)
  where revoked_at is null;

create table if not exists public.ops_manager_device_security_rate_limits (
  key_hash text primary key,
  failure_count integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  locked_until timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_device_security_rate_limits_count check (failure_count >= 0 and failure_count <= 1000),
  constraint ops_manager_device_security_rate_limits_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create table if not exists public.ops_manager_security_code_events (
  code_event_id uuid primary key default gen_random_uuid(),
  code_id uuid null,
  purpose text not null,
  target_device_id uuid null references public.devices(id) on delete set null,
  manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null,
  credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  constraint ops_manager_security_code_events_purpose_len check (length(purpose) between 1 and 80),
  constraint ops_manager_security_code_events_type_len check (length(event_type) between 1 and 80),
  constraint ops_manager_security_code_events_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

alter table public.ops_manager_device_security_config enable row level security;
alter table public.ops_manager_device_security_config force row level security;
alter table public.ops_manager_device_security_sessions enable row level security;
alter table public.ops_manager_device_security_sessions force row level security;
alter table public.ops_manager_device_security_rate_limits enable row level security;
alter table public.ops_manager_device_security_rate_limits force row level security;
alter table public.ops_manager_security_code_events enable row level security;
alter table public.ops_manager_security_code_events force row level security;

revoke all on table public.ops_manager_device_security_config from public, anon, authenticated;
revoke all on table public.ops_manager_device_security_sessions from public, anon, authenticated;
revoke all on table public.ops_manager_device_security_rate_limits from public, anon, authenticated;
revoke all on table public.ops_manager_security_code_events from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_device_security_config to postgres, service_role;
grant select, insert, update, delete on table public.ops_manager_device_security_sessions to postgres, service_role;
grant select, insert, update, delete on table public.ops_manager_device_security_rate_limits to postgres, service_role;
grant select, insert, update, delete on table public.ops_manager_security_code_events to postgres, service_role;

alter table public.device_auth_enrollment_codes
  add column if not exists purpose text not null default 'employee_device_enrollment',
  add column if not exists max_uses integer not null default 1,
  add column if not exists use_count integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists revoked_by_manager_id uuid null references public.ops_manager_managers(manager_id) on delete set null;

alter table public.device_auth_enrollment_codes
  drop constraint if exists device_auth_enrollment_code_purpose;

alter table public.device_auth_enrollment_codes
  add constraint device_auth_enrollment_code_purpose
  check (length(purpose) between 1 and 80);

alter table public.device_auth_enrollment_codes
  drop constraint if exists device_auth_enrollment_code_use_count;

alter table public.device_auth_enrollment_codes
  add constraint device_auth_enrollment_code_use_count
  check (max_uses between 1 and 5 and use_count >= 0 and use_count <= max_uses);

alter table public.device_auth_enrollment_codes
  drop constraint if exists device_auth_enrollment_code_status;

alter table public.device_auth_enrollment_codes
  add constraint device_auth_enrollment_code_status
  check (status in ('active','used','expired','revoked'));

create index if not exists idx_device_auth_enrollment_codes_status
  on public.device_auth_enrollment_codes (status, expires_at, created_at desc);

-- Bootstrap Eric as the named SECURITY_ADMIN without revoking or replacing the
-- currently trusted desktop.  The predicate intentionally touches only active
-- unassigned Ops Manager trusted-device rows and avoids any Tammy-labeled row.
insert into public.ops_manager_managers (
  manager_id, display_name, contact_label, roles, active, created_by_manager_id,
  created_by_credential_id, metadata_json
) values (
  '00000000-0000-4000-8000-000000000001',
  'Eric',
  'bootstrap security administrator',
  array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[],
  true,
  null,
  null,
  jsonb_build_object('bootstrap', true, 'source', '20260717_passwordless_manager_onboarding')
)
on conflict (manager_id) do update
set roles = array['OPS_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[],
    active = true,
    revoked_at = null,
    revoked_reason = null,
    metadata_json = public.ops_manager_managers.metadata_json || excluded.metadata_json;

update public.ops_manager_trusted_devices d
set manager_id = '00000000-0000-4000-8000-000000000001',
    metadata_json = d.metadata_json || jsonb_build_object('manager_bootstrap', 'eric_security_admin')
where d.manager_id is null
  and d.revoked_at is null
  and d.device_id like 'manager-browser-%'
  and coalesce(d.device_label, '') not ilike '%tammy%';

create or replace function public.ops_manager_consume_manager_invitation(
  p_token text,
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
  v_hash text;
  v_invite public.ops_manager_pairing_tokens%rowtype;
  v_manager public.ops_manager_managers%rowtype;
  v_device public.ops_manager_trusted_devices%rowtype;
  v_now timestamptz := now();
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 400, 'reason', 'malformed');
  end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
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
    into v_invite
  from public.ops_manager_pairing_tokens
  where token_hash = v_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'reason', 'invalid');
  end if;
  if v_invite.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'revoked', 'pairing_id', v_invite.pairing_id);
  end if;
  if v_invite.expires_at <= v_now then
    update public.ops_manager_pairing_tokens
    set metadata_json = metadata_json || jsonb_build_object('expired_checked_at', v_now)
    where pairing_id = v_invite.pairing_id;
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'expired', 'pairing_id', v_invite.pairing_id);
  end if;
  if v_invite.used_at is not null or v_invite.use_count >= v_invite.max_uses then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'used', 'pairing_id', v_invite.pairing_id);
  end if;
  if v_invite.manager_id is null then
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'manager_required', 'pairing_id', v_invite.pairing_id);
  end if;

  select *
    into v_manager
  from public.ops_manager_managers
  where manager_id = v_invite.manager_id
  for update;

  if not found or not v_manager.active or v_manager.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 410, 'reason', 'manager_inactive', 'pairing_id', v_invite.pairing_id);
  end if;
  if v_invite.intended_role is not null and not (v_invite.intended_role = any(v_manager.roles)) then
    return jsonb_build_object('ok', false, 'status', 409, 'reason', 'role_mismatch', 'pairing_id', v_invite.pairing_id);
  end if;

  update public.ops_manager_trusted_devices
  set revoked_at = v_now,
      revoked_reason = 'device_re-enrolled_by_manager_invitation'
  where device_id = trim(p_device_id)
    and revoked_at is null;

  insert into public.ops_manager_trusted_devices (
    credential_id, device_id, device_label, token_hash, max_access_level,
    user_agent_hash, created_ip_hash, expires_at, manager_id, invitation_id,
    platform_summary, metadata_json
  )
  values (
    p_credential_id,
    trim(p_device_id),
    trim(p_device_label),
    p_trust_token_hash,
    'full_access',
    p_user_agent_hash,
    p_created_ip_hash,
    p_expires_at,
    v_manager.manager_id,
    v_invite.pairing_id,
    nullif(left(coalesce(p_platform_summary, ''), 160), ''),
    v_metadata || jsonb_build_object(
      'pairing_id', v_invite.pairing_id,
      'manager_id', v_manager.manager_id,
      'invitation_kind', v_invite.invitation_kind,
      'enrollment_source', 'named_manager_invitation'
    )
  )
  returning * into v_device;

  update public.ops_manager_pairing_tokens
  set use_count = use_count + 1,
      used_at = case when use_count + 1 >= max_uses then v_now else used_at end,
      used_by_credential_id = p_credential_id,
      used_by_device_id = trim(p_device_id),
      metadata_json = metadata_json || jsonb_build_object(
        'used_user_agent_hash', p_user_agent_hash,
        'used_ip_hash', p_created_ip_hash,
        'last_used_at', v_now
      )
  where pairing_id = v_invite.pairing_id;

  update public.ops_manager_managers
  set last_access_at = v_now
  where manager_id = v_manager.manager_id;

  return jsonb_build_object(
    'ok', true,
    'pairing_id', v_invite.pairing_id,
    'manager', jsonb_build_object(
      'manager_id', v_manager.manager_id,
      'display_name', v_manager.display_name,
      'contact_label', v_manager.contact_label,
      'roles', to_jsonb(v_manager.roles)
    ),
    'trusted_device', jsonb_build_object(
      'credential_id', v_device.credential_id,
      'device_id', v_device.device_id,
      'device_label', v_device.device_label,
      'manager_id', v_device.manager_id,
      'created_at', v_device.created_at,
      'expires_at', v_device.expires_at
    )
  );
end;
$function$;

create or replace function public.device_auth_issue_enrollment_code(
  p_device_id uuid,
  p_code_hash text,
  p_created_by text,
  p_expires_at timestamptz,
  p_metadata_json jsonb default '{}'::jsonb
)
returns table(enrollment_id uuid, device_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_row public.device_auth_enrollment_codes%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;
  if coalesce(p_metadata_json, '{}'::jsonb) is null or jsonb_typeof(coalesce(p_metadata_json, '{}'::jsonb)) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;
  if not exists(select 1 from public.devices d where d.id = p_device_id and d.active = true) then
    raise exception 'active device not found';
  end if;

  update public.device_auth_enrollment_codes
  set revoked_at = now(),
      status = 'revoked',
      metadata_json = metadata_json || jsonb_build_object('revoked_reason','replaced')
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null;

  insert into public.device_auth_enrollment_codes(
    device_id, code_hash, created_by, expires_at, metadata_json,
    purpose, max_uses, use_count, status
  ) values (
    p_device_id, p_code_hash,
    coalesce(nullif(left(btrim(coalesce(p_created_by,'')),160),''),'ops_manager'),
    p_expires_at, coalesce(p_metadata_json,'{}'::jsonb),
    coalesce(nullif(left(coalesce(p_metadata_json->>'purpose',''),80),''),'employee_device_enrollment'),
    1, 0, 'active'
  )
  returning * into v_row;

  return query select v_row.enrollment_id, v_row.device_id, v_row.expires_at;
end;
$function$;

create or replace function public.device_auth_consume_enrollment_code(
  p_device_id uuid,
  p_code_hash text,
  p_credential_id uuid,
  p_token_hash text,
  p_device_label text,
  p_expires_at timestamptz,
  p_user_agent_hash text default null,
  p_ip_hash text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_code public.device_auth_enrollment_codes%rowtype;
  v_now timestamptz := now();
  v_credential public.device_auth_credentials%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_credential_id is null then raise exception 'credential_id is required'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'valid token_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= v_now then raise exception 'future expires_at is required'; end if;

  select *
    into v_code
  from public.device_auth_enrollment_codes
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_code.expires_at <= v_now then
    update public.device_auth_enrollment_codes
    set status = 'expired'
    where enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok', false, 'reason', 'expired', 'enrollment_id', v_code.enrollment_id);
  end if;
  if v_code.code_hash <> p_code_hash then
    update public.device_auth_enrollment_codes
    set failed_attempts = least(10, failed_attempts + 1),
        last_failed_at = v_now
    where enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'enrollment_id', v_code.enrollment_id);
  end if;

  update public.device_auth_credentials
  set revoked_at = v_now,
      revoked_reason = 'replaced_by_new_enrollment'
  where device_id = p_device_id
    and revoked_at is null;

  insert into public.device_auth_credentials(
    credential_id, device_id, token_hash, device_label, user_agent_hash,
    created_ip_hash, expires_at, metadata_json
  ) values (
    p_credential_id, p_device_id, p_token_hash, nullif(left(coalesce(p_device_label,''),160),''),
    p_user_agent_hash, p_ip_hash, p_expires_at, coalesce(p_metadata_json,'{}'::jsonb)
  )
  returning * into v_credential;

  update public.device_auth_enrollment_codes
  set consumed_at = v_now,
      consumed_by_credential_id = p_credential_id,
      use_count = 1,
      status = 'used'
  where enrollment_id = v_code.enrollment_id;

  return jsonb_build_object(
    'ok', true,
    'enrollment_id', v_code.enrollment_id,
    'credential_id', v_credential.credential_id,
    'expires_at', v_credential.expires_at
  );
end;
$function$;

revoke all on function public.ops_manager_consume_manager_invitation(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ops_manager_consume_manager_invitation(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) to postgres, service_role;

revoke all on function public.device_auth_issue_enrollment_code(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.device_auth_consume_enrollment_code(uuid, text, uuid, text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.device_auth_issue_enrollment_code(uuid, text, text, timestamptz, jsonb) to postgres, service_role;
grant execute on function public.device_auth_consume_enrollment_code(uuid, text, uuid, text, text, timestamptz, text, text, jsonb) to postgres, service_role;

comment on table public.ops_manager_managers is
  'Named passwordless Ops Manager principals. Device trust is stored separately in ops_manager_trusted_devices.';
comment on table public.ops_manager_device_security_config is
  'Argon2id Device Security application password hash and rotation version. No plaintext password is stored.';
comment on table public.ops_manager_device_security_sessions is
  'Short-lived second-factor Device Security sessions for SECURITY_ADMIN trusted manager devices.';
comment on function public.ops_manager_consume_manager_invitation(text, uuid, text, text, text, text, text, text, timestamptz, jsonb) is
  'Atomically consumes a role-bound named-manager invitation and enrolls the opening browser as a trusted Ops Manager device.';
