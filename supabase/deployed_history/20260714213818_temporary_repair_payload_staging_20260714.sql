-- Deployed migration history snapshot: 20260714213818 temporary_repair_payload_staging_20260714

create table if not exists public.temporary_repair_payload_chunks (
  payload_name text not null,
  sequence_no integer not null,
  content text not null,
  created_at timestamptz not null default now(),
  primary key(payload_name, sequence_no)
);
alter table public.temporary_repair_payload_chunks enable row level security;
revoke all on table public.temporary_repair_payload_chunks from public, anon, authenticated;
grant select,insert,update,delete on table public.temporary_repair_payload_chunks to service_role;
