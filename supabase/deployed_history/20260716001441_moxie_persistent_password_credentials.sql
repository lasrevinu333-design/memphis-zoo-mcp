-- Deployed migration history snapshot: 20260716001441 moxie_persistent_password_credentials

create table if not exists public.moxie_auth_credentials (
  credential_key text primary key,
  password_salt text not null,
  password_hash text not null,
  password_version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moxie_auth_credentials_key_not_blank check (btrim(credential_key) <> ''),
  constraint moxie_auth_credentials_salt_length check (length(password_salt) between 32 and 256),
  constraint moxie_auth_credentials_hash_length check (length(password_hash) = 128),
  constraint moxie_auth_credentials_version_positive check (password_version > 0)
);

alter table public.moxie_auth_credentials enable row level security;
alter table public.moxie_auth_credentials force row level security;
revoke all on table public.moxie_auth_credentials from public,anon,authenticated;
grant select,insert,update on table public.moxie_auth_credentials to service_role;

comment on table public.moxie_auth_credentials is
  'Server-side persistent Moxie authentication credential. Passwords are scrypt-derived; plaintext is never stored.';
