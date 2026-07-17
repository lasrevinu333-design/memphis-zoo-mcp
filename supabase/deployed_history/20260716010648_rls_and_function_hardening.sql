-- Deployed migration history snapshot: 20260716010648 rls_and_function_hardening

do $$
declare r record;
begin
  for r in
    select quote_ident(n.nspname) as schema_name,quote_ident(c.relname) as table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  loop
    execute format('alter table %s.%s enable row level security',r.schema_name,r.table_name);
    execute format('alter table %s.%s force row level security',r.schema_name,r.table_name);
  end loop;
end $$;

revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
grant select,insert,update,delete on all tables in schema public to service_role;
grant usage,select,update on all sequences in schema public to service_role;

do $$
declare r record;
begin
  for r in
    select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and (p.proconfig is null or not exists(select 1 from unnest(p.proconfig) x where x like 'search_path=%'))
  loop
    execute format('alter function %I.%I(%s) set search_path=pg_catalog,public',r.nspname,r.proname,r.args);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to service_role;
alter default privileges in schema public grant execute on functions to service_role;
