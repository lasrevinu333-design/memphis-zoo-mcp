-- Deployed migration history snapshot: 20260716002500 migration_log_governance

create table if not exists public.migration_log_summary (
  migration_name text primary key,
  statement_count bigint not null default 0,
  total_sql_bytes bigint not null default 0,
  latest_sql_sha256 text not null,
  first_applied_at timestamptz,
  last_applied_at timestamptz,
  last_applied_by text,
  updated_at timestamptz not null default now(),
  constraint migration_log_summary_hash check (latest_sql_sha256 ~ '^[0-9a-f]{64}$')
);

alter table public.migration_log_summary enable row level security;
alter table public.migration_log_summary force row level security;
revoke all on table public.migration_log_summary from public, anon, authenticated;
grant select, insert, update on table public.migration_log_summary to service_role;

insert into public.migration_log_summary(
  migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
  first_applied_at, last_applied_at, last_applied_by, updated_at
)
select migration_name,
       count(*)::bigint,
       sum(octet_length(sql_text))::bigint,
       encode(digest((array_agg(sql_text order by applied_at desc, id desc))[1], 'sha256'), 'hex'),
       min(applied_at),
       max(applied_at),
       (array_agg(applied_by order by applied_at desc, id desc))[1],
       now()
from public.migration_log
group by migration_name
on conflict (migration_name) do update
set statement_count = excluded.statement_count,
    total_sql_bytes = excluded.total_sql_bytes,
    latest_sql_sha256 = excluded.latest_sql_sha256,
    first_applied_at = excluded.first_applied_at,
    last_applied_at = excluded.last_applied_at,
    last_applied_by = excluded.last_applied_by,
    updated_at = now();

create index if not exists idx_migration_log_applied_at on public.migration_log(applied_at desc);
create index if not exists idx_migration_log_name_applied on public.migration_log(migration_name, applied_at desc);

create or replace function public.sync_migration_log_summary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.migration_log_summary(
    migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
    first_applied_at, last_applied_at, last_applied_by, updated_at
  ) values (
    new.migration_name, 1, octet_length(new.sql_text),
    encode(digest(new.sql_text, 'sha256'), 'hex'),
    new.applied_at, new.applied_at, new.applied_by, now()
  )
  on conflict (migration_name) do update
  set statement_count = public.migration_log_summary.statement_count + 1,
      total_sql_bytes = public.migration_log_summary.total_sql_bytes + excluded.total_sql_bytes,
      latest_sql_sha256 = excluded.latest_sql_sha256,
      first_applied_at = least(public.migration_log_summary.first_applied_at, excluded.first_applied_at),
      last_applied_at = greatest(public.migration_log_summary.last_applied_at, excluded.last_applied_at),
      last_applied_by = excluded.last_applied_by,
      updated_at = now();
  return new;
end
$function$;

revoke all on function public.sync_migration_log_summary() from public, anon, authenticated;
grant execute on function public.sync_migration_log_summary() to service_role;

drop trigger if exists trg_sync_migration_log_summary on public.migration_log;
create trigger trg_sync_migration_log_summary
after insert on public.migration_log
for each row execute function public.sync_migration_log_summary();
