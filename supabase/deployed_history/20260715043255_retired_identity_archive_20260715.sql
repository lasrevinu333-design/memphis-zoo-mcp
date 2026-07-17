-- Deployed migration history snapshot: 20260715043255 retired_identity_archive_20260715

create table if not exists archive.retired_identity_records (
  archive_id uuid primary key default gen_random_uuid(),
  retirement_batch text not null,
  source_table text not null,
  source_id text null,
  reason text not null,
  row_json jsonb not null,
  retired_at timestamptz not null default now(),
  retired_by text not null default 'overnight_system_integration_audit'
);

revoke all on table archive.retired_identity_records from public, anon, authenticated;
grant select, insert on table archive.retired_identity_records to service_role;
