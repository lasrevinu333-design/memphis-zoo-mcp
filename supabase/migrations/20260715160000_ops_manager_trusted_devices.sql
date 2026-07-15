-- Foundation: one-time manager-device enrollment with revocable server-side sessions.
-- Browser cookies contain only a random opaque token; the database stores its SHA-256 hash.

create table if not exists public.ops_manager_device_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  device_id text not null,
  device_label text,
  access_level text not null default 'full_access'
    check (access_level in ('read_only', 'full_access')),
  user_agent_hash text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  constraint ops_manager_device_sessions_device_id_not_blank
    check (length(btrim(device_id)) between 1 and 96),
  constraint ops_manager_device_sessions_expiry_after_creation
    check (expires_at > created_at)
);

create index if not exists ops_manager_device_sessions_active_device_idx
  on public.ops_manager_device_sessions (device_id, expires_at desc)
  where revoked_at is null;

create index if not exists ops_manager_device_sessions_expiry_idx
  on public.ops_manager_device_sessions (expires_at)
  where revoked_at is null;

create table if not exists public.ops_manager_auth_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  device_id text,
  session_id uuid references public.ops_manager_device_sessions(id) on delete set null,
  success boolean not null default false,
  reason text,
  ip_hash text,
  user_agent_hash text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_manager_auth_events_created_idx
  on public.ops_manager_auth_events (created_at desc);

create index if not exists ops_manager_auth_events_device_idx
  on public.ops_manager_auth_events (device_id, created_at desc);

alter table public.ops_manager_device_sessions enable row level security;
alter table public.ops_manager_device_sessions force row level security;
alter table public.ops_manager_auth_events enable row level security;
alter table public.ops_manager_auth_events force row level security;

revoke all on table public.ops_manager_device_sessions from public, anon, authenticated;
revoke all on table public.ops_manager_auth_events from public, anon, authenticated;
grant all on table public.ops_manager_device_sessions to service_role;
grant all on table public.ops_manager_auth_events to service_role;

comment on table public.ops_manager_device_sessions is
  'Revocable one-time trusted-device enrollments for Ops Manager browser access. Raw tokens are never stored.';
comment on table public.ops_manager_auth_events is
  'Hashed, non-secret audit evidence for manager enrollment, validation, logout, and revocation.';
