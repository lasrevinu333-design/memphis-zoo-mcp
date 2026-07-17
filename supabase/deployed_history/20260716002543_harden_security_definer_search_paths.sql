-- Deployed migration history snapshot: 20260716002543 harden_security_definer_search_paths

do $hardening$
declare
  r record;
  v_signature text;
begin
  for r in
    select n.nspname as schema_name,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    v_signature := format('%I.%I(%s)', r.schema_name, r.proname, r.identity_args);
    execute format(
      'alter function %s set search_path = pg_catalog, public, extensions',
      v_signature
    );
  end loop;
end
$hardening$;
