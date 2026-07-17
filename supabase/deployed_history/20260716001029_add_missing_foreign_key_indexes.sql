-- Deployed migration history snapshot: 20260716001029 add_missing_foreign_key_indexes

do $ddl$
declare
  r record;
  v_index_name text;
  v_columns text;
begin
  for r in
    with fk as (
      select con.oid,
             ns.nspname as schema_name,
             rel.relname as table_name,
             con.conname,
             con.conrelid,
             con.conkey,
             array_agg(att.attname order by u.ord) as fk_columns
      from pg_constraint con
      join pg_class rel on rel.oid=con.conrelid
      join pg_namespace ns on ns.oid=rel.relnamespace
      join unnest(con.conkey) with ordinality as u(attnum,ord) on true
      join pg_attribute att on att.attrelid=rel.oid and att.attnum=u.attnum
      where con.contype='f' and ns.nspname='public'
      group by con.oid,ns.nspname,rel.relname,con.conname,con.conrelid,con.conkey
    )
    select *
    from fk
    where not exists (
      select 1
      from pg_index i
      where i.indrelid=fk.conrelid
        and i.indisvalid
        and (i.indkey::smallint[])[0:cardinality(fk.conkey)-1]=fk.conkey
    )
    order by table_name,conname
  loop
    v_index_name := left('idx_' || regexp_replace(r.conname,'[^a-zA-Z0-9_]+','_','g'),63);
    select string_agg(format('%I',c),', ')
      into v_columns
    from unnest(r.fk_columns) c;

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      v_index_name,r.schema_name,r.table_name,v_columns
    );
  end loop;
end
$ddl$;
