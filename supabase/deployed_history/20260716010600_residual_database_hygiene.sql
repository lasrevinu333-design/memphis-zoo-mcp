-- Deployed migration history snapshot: 20260716010600 residual_database_hygiene

create schema if not exists custodial_archive;
create schema if not exists extensions;
revoke all on schema custodial_archive from public, anon, authenticated;
grant usage on schema custodial_archive to service_role;

do $$
begin
  if to_regclass('public.mcp_write_test') is not null and to_regclass('custodial_archive.mcp_write_test') is null then
    alter table public.mcp_write_test set schema custodial_archive;
  end if;
end $$;

revoke all on all tables in schema custodial_archive from public, anon, authenticated;
grant select on all tables in schema custodial_archive to service_role;

alter table if exists public.demo_scan_mock_runs enable row level security;
alter table if exists public.demo_scan_mock_runs force row level security;
revoke all on table public.demo_scan_mock_runs from public, anon, authenticated;
grant select,insert,update,delete on table public.demo_scan_mock_runs to service_role;

do $$
declare
  v_relocatable boolean;
  v_schema text;
begin
  select e.extrelocatable,n.nspname into v_relocatable,v_schema
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pg_net';
  if coalesce(v_relocatable,false) and v_schema='public' then
    execute 'alter extension pg_net set schema extensions';
  end if;

  select e.extrelocatable,n.nspname into v_relocatable,v_schema
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';
  if coalesce(v_relocatable,false) and v_schema='public' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end $$;

do $$
declare
  r record;
  v_cols text;
  v_name text;
begin
  for r in
    select con.conrelid,con.conkey,n.nspname,c.relname
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where con.contype='f' and n.nspname='public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid=con.conrelid and i.indisvalid
          and (i.indkey::smallint[])[0:cardinality(con.conkey)-1]=con.conkey
      )
  loop
    select string_agg(quote_ident(a.attname),', ' order by u.ord)
      into v_cols
    from unnest(r.conkey) with ordinality u(attnum,ord)
    join pg_attribute a on a.attrelid=r.conrelid and a.attnum=u.attnum;
    v_name:=left('idx_'||r.relname||'_'||array_to_string(r.conkey,'_')||'_fk',63);
    execute format('create index if not exists %I on %I.%I (%s)',v_name,r.nspname,r.relname,v_cols);
  end loop;
end $$;
