-- Deployed migration history snapshot: 20260715233040 device_credential_foundation

-- Foundation: cryptographic, revocable identity for employee kiosk/browser devices.
-- Rollout is explicit: ENROLL mode preserves current operation while phones receive
-- one-time credentials; ENFORCE is permitted only after all nine employee kiosks
-- have a valid registry assignment and active credential.

create table if not exists public.device_auth_policy (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'enroll' check (mode in ('observe','enroll','enforce')),
  updated_by text not null default 'foundation_migration',
  updated_at timestamptz not null default now()
);

insert into public.device_auth_policy(singleton, mode, updated_by)
values (true, 'enroll', 'foundation_migration')
on conflict (singleton) do nothing;

create table if not exists public.device_auth_credentials (
  credential_id uuid primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  token_hash text not null unique,
  device_label text null,
  user_agent_hash text null,
  created_ip_hash text null,
  last_user_agent_hash text null,
  last_ip_hash text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  last_used_at timestamptz null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_reason text null,
  constraint device_auth_credentials_hash_length check (length(token_hash) = 64),
  constraint device_auth_credentials_label_length check (device_label is null or length(device_label) <= 160),
  constraint device_auth_credentials_expiration check (expires_at > created_at),
  constraint device_auth_credentials_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create unique index if not exists idx_device_auth_credentials_one_active_per_device
  on public.device_auth_credentials(device_id)
  where revoked_at is null;

create index if not exists idx_device_auth_credentials_active_expiry
  on public.device_auth_credentials(expires_at)
  where revoked_at is null;

create index if not exists idx_device_auth_credentials_last_used
  on public.device_auth_credentials(last_used_at desc nulls last);

create table if not exists public.device_auth_enrollment_codes (
  enrollment_id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  code_hash text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_by_credential_id uuid null references public.device_auth_credentials(credential_id) on delete set null,
  revoked_at timestamptz null,
  failed_attempts integer not null default 0,
  last_failed_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint device_auth_enrollment_code_hash_length check (length(code_hash) = 64),
  constraint device_auth_enrollment_code_expiration check (expires_at > created_at),
  constraint device_auth_enrollment_failed_attempts check (failed_attempts between 0 and 10),
  constraint device_auth_enrollment_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create unique index if not exists idx_device_auth_enrollment_one_active_per_device
  on public.device_auth_enrollment_codes(device_id)
  where consumed_at is null and revoked_at is null;

create index if not exists idx_device_auth_enrollment_expiry
  on public.device_auth_enrollment_codes(expires_at)
  where consumed_at is null and revoked_at is null;

create table if not exists public.device_auth_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid null references public.devices(id) on delete set null,
  credential_id uuid null references public.device_auth_credentials(credential_id) on delete set null,
  event_type text not null,
  success boolean not null,
  reason text null,
  presented_identifier text null,
  ip_hash text null,
  user_agent_hash text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint device_auth_events_event_type_length check (length(event_type) between 1 and 100),
  constraint device_auth_events_identifier_length check (presented_identifier is null or length(presented_identifier) <= 200),
  constraint device_auth_events_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_device_auth_events_recent
  on public.device_auth_events(created_at desc);

create index if not exists idx_device_auth_events_device_recent
  on public.device_auth_events(device_id, created_at desc)
  where device_id is not null;

create index if not exists idx_device_auth_events_credential_recent
  on public.device_auth_events(credential_id, created_at desc)
  where credential_id is not null;

alter table public.device_auth_policy enable row level security;
alter table public.device_auth_policy force row level security;
alter table public.device_auth_credentials enable row level security;
alter table public.device_auth_credentials force row level security;
alter table public.device_auth_enrollment_codes enable row level security;
alter table public.device_auth_enrollment_codes force row level security;
alter table public.device_auth_events enable row level security;
alter table public.device_auth_events force row level security;

revoke all on table public.device_auth_policy from public, anon, authenticated;
revoke all on table public.device_auth_credentials from public, anon, authenticated;
revoke all on table public.device_auth_enrollment_codes from public, anon, authenticated;
revoke all on table public.device_auth_events from public, anon, authenticated;
grant select, insert, update, delete on table public.device_auth_policy to service_role;
grant select, insert, update, delete on table public.device_auth_credentials to service_role;
grant select, insert, update, delete on table public.device_auth_enrollment_codes to service_role;
grant select, insert on table public.device_auth_events to service_role;

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
set search_path = pg_catalog, public
as $function$
declare
  v_row public.device_auth_enrollment_codes%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;
  if not exists(select 1 from public.devices d where d.id = p_device_id and d.active = true) then
    raise exception 'active device not found';
  end if;

  update public.device_auth_enrollment_codes
  set revoked_at = now(),
      metadata_json = metadata_json || jsonb_build_object('revoked_reason','replaced')
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null;

  insert into public.device_auth_enrollment_codes(
    device_id, code_hash, created_by, expires_at, metadata_json
  ) values (
    p_device_id, p_code_hash,
    coalesce(nullif(left(btrim(coalesce(p_created_by,'')),160),''),'ops_manager'),
    p_expires_at, coalesce(p_metadata_json,'{}'::jsonb)
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
set search_path = pg_catalog, public
as $function$
declare
  v_code public.device_auth_enrollment_codes%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_failed_attempts integer;
begin
  if p_device_id is null or p_credential_id is null then raise exception 'device_id and credential_id are required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'valid token_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;

  select * into v_code
  from public.device_auth_enrollment_codes
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null
  order by created_at desc
  limit 1
  for update;

  if v_code.enrollment_id is null or v_code.expires_at <= now() then
    if v_code.enrollment_id is not null then
      update public.device_auth_enrollment_codes
      set revoked_at = coalesce(revoked_at, now()),
          metadata_json = metadata_json || jsonb_build_object('revoked_reason','expired')
      where enrollment_id = v_code.enrollment_id;
    end if;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.failed_attempts >= 10 then
    update public.device_auth_enrollment_codes
    set revoked_at = coalesce(revoked_at, now()),
        metadata_json = metadata_json || jsonb_build_object('revoked_reason','attempt_limit')
    where enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.code_hash <> p_code_hash then
    v_failed_attempts := least(v_code.failed_attempts + 1, 10);
    update public.device_auth_enrollment_codes
    set failed_attempts = v_failed_attempts,
        last_failed_at = now(),
        revoked_at = case when v_failed_attempts >= 10 then now() else revoked_at end,
        metadata_json = case
          when v_failed_attempts >= 10 then metadata_json || jsonb_build_object('revoked_reason','attempt_limit')
          else metadata_json
        end
    where enrollment_id = v_code.enrollment_id;

    insert into public.device_auth_events(
      device_id, credential_id, event_type, success, reason,
      ip_hash, user_agent_hash, metadata_json
    ) values (
      p_device_id, null, 'device_enrollment_failed', false, 'invalid_code',
      p_ip_hash, p_user_agent_hash,
      jsonb_build_object('enrollment_id',v_code.enrollment_id,'failed_attempts',v_failed_attempts)
    );
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  update public.device_auth_credentials
  set revoked_at = now(), revoked_reason = 're_enrolled'
  where device_id = p_device_id and revoked_at is null;

  insert into public.device_auth_credentials(
    credential_id, device_id, token_hash, device_label,
    user_agent_hash, created_ip_hash, last_user_agent_hash, last_ip_hash,
    metadata_json, confirmed_at, last_used_at, expires_at
  ) values (
    p_credential_id, p_device_id, p_token_hash,
    nullif(left(btrim(coalesce(p_device_label,'')),160),''),
    p_user_agent_hash, p_ip_hash, p_user_agent_hash, p_ip_hash,
    coalesce(p_metadata_json,'{}'::jsonb), null, null, p_expires_at
  ) returning * into v_credential;

  update public.device_auth_enrollment_codes
  set consumed_at = now(), consumed_by_credential_id = v_credential.credential_id
  where enrollment_id = v_code.enrollment_id;

  insert into public.device_auth_events(
    device_id, credential_id, event_type, success, reason,
    ip_hash, user_agent_hash, metadata_json
  ) values (
    p_device_id, v_credential.credential_id, 'device_enrolled', true, null,
    p_ip_hash, p_user_agent_hash,
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('enrollment_id',v_code.enrollment_id)
  );

  return jsonb_build_object(
    'ok', true,
    'credential_id', v_credential.credential_id,
    'device_id', v_credential.device_id,
    'device_label', v_credential.device_label,
    'created_at', v_credential.created_at,
    'confirmed_at', v_credential.confirmed_at,
    'expires_at', v_credential.expires_at
  );
end;
$function$;

revoke all on function public.device_auth_issue_enrollment_code(uuid,text,text,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.device_auth_consume_enrollment_code(uuid,text,uuid,text,text,timestamptz,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.device_auth_issue_enrollment_code(uuid,text,text,timestamptz,jsonb) to service_role;
grant execute on function public.device_auth_consume_enrollment_code(uuid,text,uuid,text,text,timestamptz,text,text,jsonb) to service_role;

comment on table public.device_auth_policy is
  'Explicit staged rollout state for employee-device credentials: observe, enroll, then enforce.';
comment on table public.device_auth_credentials is
  'Revocable employee-device credentials. Only HMAC token hashes are stored.';
comment on table public.device_auth_enrollment_codes is
  'Short-lived one-time enrollment codes generated by an authenticated Ops Manager.';
comment on table public.device_auth_events is
  'Privacy-preserving device authentication audit events.';
