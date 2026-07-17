-- Deployed migration history snapshot: 20260714135144 custodial_public_rpc_lockdown_v2_20260714

do $lockdown$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like 'msg\_%' escape '\' or p.proname like 'tool\_%' escape '\' or p.proname in ('run_sql_readonly','run_sql_write','run_sql_migration'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end;
$lockdown$;
alter table public.device_aliases enable row level security;
alter table public.device_sync_status enable row level security;
revoke all on table public.device_aliases,public.device_sync_status from anon,authenticated;
grant select,insert,update,delete on table public.device_aliases,public.device_sync_status to service_role;
