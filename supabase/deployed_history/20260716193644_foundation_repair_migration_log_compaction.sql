-- Deployed migration history snapshot: 20260716193644 foundation_repair_migration_log_compaction

insert into public.migration_log_summary(
  migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
  first_applied_at, last_applied_at, last_applied_by, updated_at
)
select
  ml.migration_name,
  count(*)::bigint,
  sum(octet_length(coalesce(ml.sql_text, '')))::bigint,
  (array_agg(encode(extensions.digest(convert_to(coalesce(ml.sql_text, ''), 'UTF8'), 'sha256'), 'hex') order by ml.applied_at desc))[1],
  min(ml.applied_at),
  max(ml.applied_at),
  (array_agg(ml.applied_by order by ml.applied_at desc))[1],
  now()
from public.migration_log ml
group by ml.migration_name
on conflict (migration_name) do update set
  statement_count = greatest(public.migration_log_summary.statement_count, excluded.statement_count),
  total_sql_bytes = greatest(public.migration_log_summary.total_sql_bytes, excluded.total_sql_bytes),
  latest_sql_sha256 = coalesce(excluded.latest_sql_sha256, public.migration_log_summary.latest_sql_sha256),
  first_applied_at = least(public.migration_log_summary.first_applied_at, excluded.first_applied_at),
  last_applied_at = greatest(public.migration_log_summary.last_applied_at, excluded.last_applied_at),
  last_applied_by = coalesce(excluded.last_applied_by, public.migration_log_summary.last_applied_by),
  updated_at = now();

create temporary table migration_log_summary_compact on commit drop as
select * from public.migration_log_summary;
truncate table public.migration_log_summary;
insert into public.migration_log_summary
select * from migration_log_summary_compact;
truncate table public.migration_log;
