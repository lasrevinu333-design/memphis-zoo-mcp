begin;

-- Trigger helpers run only through their owning table triggers. They are not
-- public RPC endpoints and must not be callable through PostgREST.
revoke all on function public.cleaning_inspections_set_snapshot()
  from public,anon,authenticated;
grant execute on function public.cleaning_inspections_set_snapshot()
  to postgres,service_role;

revoke all on function public.events_app_delete_retention_guard()
  from public,anon,authenticated;
grant execute on function public.events_app_delete_retention_guard()
  to postgres,service_role;

-- This helper reads only schema-qualified retention settings. Pinning its
-- search path removes role-dependent resolution from privileged callers.
alter function public.mz_retention_setting_int(text,integer,integer,integer)
  set search_path to 'pg_catalog','public';

commit;
