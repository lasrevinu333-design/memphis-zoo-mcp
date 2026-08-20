-- Apply only after the backend is deployed with a verified
-- CUSTODIAL_READONLY_DATABASE_URL. This removes the old service-role ->
-- postgres arbitrary SQL bridge from every application/API role.

begin;

revoke all privileges on function public.run_sql_readonly(text)
  from public, anon, authenticated, service_role;

comment on function public.run_sql_readonly(text) is
  'Retired owner-authority SQL proxy. No application/API role may execute it.';

commit;
