-- Deployed migration history snapshot: 20260714223858 temporary_repair_payload_chunks_20260714

create table if not exists public.repair_payload_chunks (
  token text not null,
  repository_name text not null,
  sequence_number integer not null,
  chunk_text text not null,
  patch_sha256 text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  primary key (token, sequence_number)
);

alter table public.repair_payload_chunks enable row level security;
revoke all on table public.repair_payload_chunks from public, anon, authenticated;
grant select on table public.repair_payload_chunks to anon;

drop policy if exists temporary_repair_payload_chunk_read on public.repair_payload_chunks;
create policy temporary_repair_payload_chunk_read
on public.repair_payload_chunks
for select
to anon
using (
  token in (
    'backend-scheduler-alerts-gps-v4-20260714',
    'frontend-scheduler-alerts-gps-v4-20260714'
  )
  and expires_at > now()
);
