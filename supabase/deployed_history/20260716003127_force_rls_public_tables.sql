-- Deployed migration history snapshot: 20260716003127 force_rls_public_tables

do $rls$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by c.relname
  loop
    execute format('alter table %I.%I enable row level security',r.schema_name,r.table_name);
    execute format('alter table %I.%I force row level security',r.schema_name,r.table_name);
  end loop;
end
$rls$;
