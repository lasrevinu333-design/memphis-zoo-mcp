-- Reconstruct the production public-schema privilege boundary.
--
-- The production database was hardened after its original baseline was taken,
-- but those final revokes were not represented by the canonical migration
-- chain.  Keep browser-facing roles out of the database schema: all runtime
-- access is mediated by the backend service role and its authorization layer.

revoke all privileges on all tables in schema public from public, anon, authenticated;
grant all privileges on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Make the same boundary authoritative for objects created by later migrations.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public
  grant execute on functions to service_role;
