-- Deployed migration history snapshot: 20260714130037 custodial_api_boundary_20260714

-- Memphis Zoo Custodial System — enforce one API boundary.
-- Browsers use the Render API. The Render service uses service_role.
-- Direct PostgREST table/function access is not part of the custodial contract.
-- Annie objects are explicitly excluded because Annie is a separate system.

do $migration$
declare
  r record;
begin
  for r in
    select c.oid::regclass as relation_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname not like 'annie\_%' escape '\'
      and c.relname <> 'spatial_ref_sys'
  loop
    execute format('revoke all privileges on table %s from public, anon, authenticated', r.relation_name);
    execute format('grant all privileges on table %s to service_role', r.relation_name);
    if r.relkind in ('r', 'p') then
      execute format('alter table %s enable row level security', r.relation_name);
    end if;
  end loop;
end
$migration$;

do $migration$
declare
  r record;
begin
  for r in
    select c.oid::regclass as sequence_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and c.relname not like 'annie\_%' escape '\'
  loop
    execute format('revoke all privileges on sequence %s from public, anon, authenticated', r.sequence_name);
    execute format('grant all privileges on sequence %s to service_role', r.sequence_name);
  end loop;
end
$migration$;

do $migration$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as procedure_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname not like 'annie\_%' escape '\'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.procedure_name);
    execute format('grant execute on function %s to service_role', r.procedure_name);
  end loop;
end
$migration$;

comment on schema public is
  'Custodial application objects are accessed through the Render service-role API. Direct browser PostgREST access is not an application contract.';
