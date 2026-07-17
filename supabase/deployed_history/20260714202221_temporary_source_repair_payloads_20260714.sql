-- Deployed migration history snapshot: 20260714202221 temporary_source_repair_payloads_20260714

create table if not exists public.repair_payloads (
  token text primary key,
  repository_name text not null,
  patch_b64 text not null,
  patch_sha256 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 hours')
);

alter table public.repair_payloads enable row level security;
revoke all on table public.repair_payloads from public, anon, authenticated;
grant select on table public.repair_payloads to anon, authenticated;

drop policy if exists temporary_repair_payload_read on public.repair_payloads;
create policy temporary_repair_payload_read
on public.repair_payloads
for select
to anon, authenticated
using (expires_at > now());

create index if not exists idx_repair_payloads_expires_at on public.repair_payloads(expires_at);
