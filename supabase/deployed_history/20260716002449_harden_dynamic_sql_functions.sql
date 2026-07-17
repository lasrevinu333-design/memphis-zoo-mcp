-- Deployed migration history snapshot: 20260716002449 harden_dynamic_sql_functions

do $hardening$
declare
  r record;
  v_signature text;
  v_timeout text;
begin
  for r in
    select p.oid,
           n.nspname as schema_name,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('run_sql_readonly', 'run_sql_migration', 'run_application_write')
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    v_signature := format('%I.%I(%s)', r.schema_name, r.proname, r.identity_args);
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
    execute format('alter function %s set search_path = pg_catalog, public', v_signature);

    v_timeout := case r.proname
      when 'run_sql_readonly' then '30s'
      when 'run_application_write' then '60s'
      else '180s'
    end;
    execute format('alter function %s set statement_timeout = %L', v_signature, v_timeout);
  end loop;
end
$hardening$;
