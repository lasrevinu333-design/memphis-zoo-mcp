-- Deployed migration history snapshot: 20260716194539 foundation_repair_legacy_ledger_rollup

create table if not exists public.legacy_application_write_rollups (
  operation_family text primary key,
  source_row_count bigint not null,
  statement_count bigint not null,
  total_sql_bytes bigint not null,
  latest_sql_sha256 text null,
  first_applied_at timestamptz not null,
  last_applied_at timestamptz not null,
  last_applied_by text null,
  updated_at timestamptz not null default now()
);
alter table public.legacy_application_write_rollups enable row level security;
alter table public.legacy_application_write_rollups force row level security;
revoke all on table public.legacy_application_write_rollups from public, anon, authenticated;
grant select, insert, update on table public.legacy_application_write_rollups to service_role, postgres;

with normalized as (
  select
    case
      when migration_name ~ '^[a-z_]+:[0-9a-f-]{8,}' then split_part(migration_name, ':', 1)
      when migration_name ~ '^(attendance_state_upsert|system_feedback_schema|events_app_purge|system_feedback_notification_status|restroom_rebalance_completion|events_app_create|coverall_slots_seed|restroom_rebalance|dashboard_close_ticket|restore_static_schedule_owners|guest_reports_schema)_[0-9].*$' then regexp_replace(migration_name, '_[0-9].*$', '')
      when migration_name like '%:%' then split_part(migration_name, ':', 1)
      when migration_name ~ '^(attendance_state_upsert|system_feedback_schema|events_app_purge|system_feedback_notification_status|restroom_rebalance_completion|events_app_create|coverall_slots_seed|restroom_rebalance|dashboard_close_ticket|restore_static_schedule_owners|guest_reports_schema)[_-][0-9a-f-]{8,}.*$' then regexp_replace(migration_name, '[_-][0-9a-f-]{8,}.*$', '')
      else migration_name
    end as operation_family,
    statement_count,
    total_sql_bytes,
    latest_sql_sha256,
    first_applied_at,
    last_applied_at,
    last_applied_by
  from public.migration_log_summary
), aggregated as (
  select
    operation_family,
    count(*)::bigint as source_row_count,
    sum(statement_count)::bigint as statement_count,
    sum(total_sql_bytes)::bigint as total_sql_bytes,
    (array_agg(latest_sql_sha256 order by last_applied_at desc nulls last))[1] as latest_sql_sha256,
    min(first_applied_at) as first_applied_at,
    max(last_applied_at) as last_applied_at,
    (array_agg(last_applied_by order by last_applied_at desc nulls last))[1] as last_applied_by
  from normalized
  group by operation_family
)
insert into public.legacy_application_write_rollups(
  operation_family, source_row_count, statement_count, total_sql_bytes,
  latest_sql_sha256, first_applied_at, last_applied_at, last_applied_by, updated_at
)
select operation_family, source_row_count, statement_count, total_sql_bytes,
       latest_sql_sha256, first_applied_at, last_applied_at, last_applied_by, now()
from aggregated
on conflict (operation_family) do update set
  source_row_count = excluded.source_row_count,
  statement_count = excluded.statement_count,
  total_sql_bytes = excluded.total_sql_bytes,
  latest_sql_sha256 = excluded.latest_sql_sha256,
  first_applied_at = excluded.first_applied_at,
  last_applied_at = excluded.last_applied_at,
  last_applied_by = excluded.last_applied_by,
  updated_at = now();

truncate table public.migration_log_summary;
