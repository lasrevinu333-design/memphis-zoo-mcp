-- Foundation: one-time Ops Manager device enrollment with revocable, long-lived trust.
-- Browser access tokens remain short-lived; the persistent credential is held only in an
-- HttpOnly cookie and only its HMAC hash is stored in the database.

create table if not exists public.ops_manager_trusted_devices (
  credential_id uuid primary key,
  device_id text not null,
  device_label text not null,
  token_hash text not null,
  max_access_level text not null default 'full_access',
  user_agent_hash text null,
  created_ip_hash text null,
  last_user_agent_hash text null,
  last_ip_hash text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_reason text null,
  constraint ops_manager_trusted_devices_device_id_length check (length(device_id) between 1 and 96),
  constraint ops_manager_trusted_devices_label_length check (length(device_label) between 1 and 160),
  constraint ops_manager_trusted_devices_hash_length check (length(token_hash) = 64),
  constraint ops_manager_trusted_devices_access_level check (max_access_level in ('read_only','full_access')),
  constraint ops_manager_trusted_devices_expiration check (expires_at > created_at),
  constraint ops_manager_trusted_devices_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists idx_ops_manager_trusted_devices_active_device
  on public.ops_manager_trusted_devices (device_id, expires_at desc)
  where revoked_at is null;

create index if not exists idx_ops_manager_trusted_devices_last_used
  on public.ops_manager_trusted_devices (last_used_at desc nulls last);

alter table public.ops_manager_trusted_devices enable row level security;
revoke all on table public.ops_manager_trusted_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_manager_trusted_devices to service_role;

create table if not exists public.ops_manager_auth_events (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid null references public.ops_manager_trusted_devices(credential_id) on delete set null,
  device_id text null,
  event_type text not null,
  success boolean not null,
  ip_hash text null,
  user_agent_hash text null,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_manager_auth_events_event_type_length check (length(event_type) between 1 and 100),
  constraint ops_manager_auth_events_device_id_length check (device_id is null or length(device_id) <= 96),
  constraint ops_manager_auth_events_detail_object check (jsonb_typeof(detail_json) = 'object')
);

create index if not exists idx_ops_manager_auth_events_recent
  on public.ops_manager_auth_events (created_at desc);

create index if not exists idx_ops_manager_auth_events_credential
  on public.ops_manager_auth_events (credential_id, created_at desc)
  where credential_id is not null;

create index if not exists idx_ops_manager_auth_events_device
  on public.ops_manager_auth_events (device_id, created_at desc)
  where device_id is not null;

alter table public.ops_manager_auth_events enable row level security;
revoke all on table public.ops_manager_auth_events from public, anon, authenticated;
grant select, insert on table public.ops_manager_auth_events to service_role;

comment on table public.ops_manager_trusted_devices is
  'Revocable Ops Manager trusted-device credentials. token_hash is an HMAC; raw cookie secrets are never persisted.';
comment on table public.ops_manager_auth_events is
  'Privacy-preserving authentication audit events. IP and user agent values are stored only as HMAC hashes.';
