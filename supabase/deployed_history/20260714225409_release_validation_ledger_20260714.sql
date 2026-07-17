-- Deployed migration history snapshot: 20260714225409 release_validation_ledger_20260714

create table if not exists public.release_validation_runs (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  area text not null,
  status text not null check (status in ('pass','fail','warning')),
  details_json jsonb not null default '{}'::jsonb,
  validated_at timestamptz not null default now()
);

alter table public.release_validation_runs enable row level security;
revoke all on table public.release_validation_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.release_validation_runs to service_role;
create index if not exists idx_release_validation_runs_release_time
  on public.release_validation_runs(release_id, validated_at desc);
create index if not exists idx_release_validation_runs_area
  on public.release_validation_runs(area, status, validated_at desc);
