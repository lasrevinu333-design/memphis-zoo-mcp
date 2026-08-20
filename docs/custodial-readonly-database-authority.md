# Custodial application read authority

The ordinary backend and authenticated MCP read tool must not execute caller
SQL through a postgres-owned `SECURITY DEFINER` function. They use one
dedicated PostgreSQL login through `CUSTODIAL_READONLY_DATABASE_URL`.

The release operator performs the cutover in this order:

1. Apply `20260820133000_create_application_read_authority.sql`.
2. Create one production LOGIN credential outside source control. The LOGIN
   must be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
   inherit only `custodial_application_reader`, and have no direct grants.
3. Store its URL only in the Render secret `CUSTODIAL_READONLY_DATABASE_URL`.
4. Deploy the corrected backend and require `/health/dependencies` to report
   `read_authority_ready: true`.
5. Verify legitimate dashboard, schedule, Messages, Events, and schema identity
   reads through the deployed backend.
6. Apply `20260820133100_retire_owner_sql_proxy.sql`.
7. Verify `service_role`, `anon`, and `authenticated` cannot execute
   `run_sql_readonly(text)` and repeat the deployed read checks.

Every query begins a `REPEATABLE READ READ ONLY` transaction, enables RLS, and
uses bounded statement and lock timeouts. The role has SELECT access, no table
mutation privilege, and an explicit allowlist for required read functions.

Do not place the generated password in a migration, command transcript,
release manifest, issue, PR, or application log. Rollback is: revoke the LOGIN,
remove the Render secret, roll back the backend deployment, and temporarily
restore only `service_role` EXECUTE on `run_sql_readonly(text)` while the owning
defect is corrected. Do not restore anonymous or authenticated execution.
