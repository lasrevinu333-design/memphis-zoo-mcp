begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The migration authority differs by environment: managed production uses
-- postgres while the pinned isolated Supabase image uses supabase_admin.
-- Keep both authorities fail-closed for objects created after this release.
revoke usage on schema public from public;

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

commit;
