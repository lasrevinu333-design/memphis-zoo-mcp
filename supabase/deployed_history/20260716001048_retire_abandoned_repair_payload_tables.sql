-- Deployed migration history snapshot: 20260716001048 retire_abandoned_repair_payload_tables

create table if not exists public.foundation_removal_archive (
  archive_id uuid primary key default gen_random_uuid(),
  removal_batch text not null,
  source_table text not null,
  source_id text,
  row_json jsonb not null,
  archived_at timestamptz not null default now(),
  archived_by text not null default 'approved_foundation_repair'
);

alter table public.foundation_removal_archive enable row level security;
revoke all on table public.foundation_removal_archive from public, anon, authenticated;
grant select,insert on table public.foundation_removal_archive to service_role;

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_repair_payload_tables_20260715',
       'temporary_repair_payload_chunks',
       payload_name || ':' || sequence_no::text,
       to_jsonb(t),
       'foundation_cleanup'
from public.temporary_repair_payload_chunks t;

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_repair_payload_tables_20260715',
       'repair_payload_chunks',
       token || ':' || sequence_number::text,
       to_jsonb(t),
       'foundation_cleanup'
from public.repair_payload_chunks t;

revoke all on table public.temporary_repair_payload_chunks from public,anon,authenticated;
revoke all on table public.repair_payload_chunks from public,anon,authenticated;

drop table public.temporary_repair_payload_chunks;
drop table public.repair_payload_chunks;
