-- Trigger functions are internal table behavior, not PostgREST RPC methods.
-- Revoking EXECUTE from API roles does not disable their registered triggers.

begin;

do $revoke_trigger_rpc$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
    order by p.oid::regprocedure::text
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated, service_role',
      routine.identity
    );
  end loop;
end
$revoke_trigger_rpc$;

commit;
