-- Reproduce the non-secret production role catalog needed to restore the
-- accepted production source schema into the pinned isolated Supabase image.
-- Password material is intentionally excluded; this file is rehearsal-only.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'memphis_zoo_backup') then
    create role memphis_zoo_backup;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_functions_admin') then
    create role supabase_functions_admin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_privileged_role') then
    create role supabase_privileged_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'custodial_application_reader') then
    create role custodial_application_reader;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'custodial_readonly_runtime_20260822') then
    create role custodial_readonly_runtime_20260822;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'static_weekly_control_plane') then
    create role static_weekly_control_plane;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'static_weekly_release_operator') then
    create role static_weekly_release_operator;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'static_weekly_runtime_20260823') then
    create role static_weekly_runtime_20260823;
  end if;
end
$$;

alter role memphis_zoo_backup
  nosuperuser inherit nocreaterole nocreatedb login noreplication bypassrls
  connection limit 2;
alter role supabase_functions_admin
  nosuperuser noinherit createrole nocreatedb login noreplication nobypassrls
  connection limit -1;
alter role supabase_privileged_role
  nosuperuser inherit nocreaterole nocreatedb nologin noreplication nobypassrls
  connection limit -1;
alter role supabase_realtime_admin
  nosuperuser noinherit nocreaterole nocreatedb nologin noreplication nobypassrls
  connection limit -1;
alter role custodial_application_reader
  nosuperuser noinherit nocreaterole nocreatedb nologin noreplication nobypassrls
  connection limit -1;
alter role custodial_readonly_runtime_20260822
  nosuperuser inherit nocreaterole nocreatedb login noreplication nobypassrls
  connection limit -1;
alter role static_weekly_control_plane
  nosuperuser noinherit nocreaterole nocreatedb nologin noreplication nobypassrls
  connection limit -1;
alter role static_weekly_release_operator
  nosuperuser noinherit nocreaterole nocreatedb nologin noreplication nobypassrls
  connection limit -1;
alter role static_weekly_runtime_20260823
  nosuperuser noinherit nocreaterole nocreatedb login noreplication nobypassrls
  connection limit 4;

-- The pinned image's role-setting hook injects supautils into authenticator.
-- Write the non-secret configuration arrays directly so the isolated catalog
-- equals the accepted production source rather than the image's newer default.
update pg_catalog.pg_db_role_setting set setconfig = array[
  'session_preload_libraries=safeupdate',
  'statement_timeout=8s',
  'lock_timeout=8s'
] where setdatabase = 0 and setrole = (select oid from pg_roles where rolname = 'authenticator');
update pg_catalog.pg_db_role_setting set setconfig = array[
  'search_path="$user", public, auth, extensions',
  'log_statement=none'
] where setdatabase = 0 and setrole = (select oid from pg_roles where rolname = 'supabase_admin');
update pg_catalog.pg_db_role_setting set setconfig = array[
  'search_path=auth',
  'idle_in_transaction_session_timeout=60000',
  'log_statement=none'
] where setdatabase = 0 and setrole = (select oid from pg_roles where rolname = 'supabase_auth_admin');
update pg_catalog.pg_db_role_setting set setconfig = array[
  'default_transaction_read_only=on'
] where setdatabase = 0 and setrole = (select oid from pg_roles where rolname = 'supabase_read_only_user');
update pg_catalog.pg_db_role_setting set setconfig = array[
  'search_path=storage',
  'log_statement=none'
] where setdatabase = 0 and setrole = (select oid from pg_roles where rolname = 'supabase_storage_admin');
alter role memphis_zoo_backup set default_transaction_read_only to 'on';
alter role custodial_readonly_runtime_20260822 set default_transaction_read_only to 'on';
alter role custodial_readonly_runtime_20260822 set statement_timeout to '15s';
alter role custodial_readonly_runtime_20260822 set idle_in_transaction_session_timeout to '15s';
alter role static_weekly_runtime_20260823 set statement_timeout to '30s';
alter role static_weekly_runtime_20260823 set lock_timeout to '5s';
alter role static_weekly_runtime_20260823 set idle_in_transaction_session_timeout to '15s';
alter role static_weekly_runtime_20260823 set idle_session_timeout to '5min';

comment on role custodial_application_reader is
  'Non-login application/MCP read authority. No BYPASSRLS, no relation mutation, and consumed only inside an explicit READ ONLY transaction.';
comment on role memphis_zoo_backup is
  'Read-only, RLS-bypassing login used solely by the encrypted disaster-recovery backup workflow.';
comment on role static_weekly_runtime_20260823 is
  'Dedicated NOINHERIT login shell for the Memphis Zoo static-weekly control plane. Password verifier configured 2026-08-23; authority is entered only with SET LOCAL ROLE static_weekly_control_plane.';

revoke supabase_auth_admin from postgres;
revoke supabase_storage_admin from postgres;

grant anon to postgres with admin option;
grant authenticated to postgres with admin option;
grant authenticator to postgres with admin option;
grant memphis_zoo_backup to postgres with admin option;
grant pg_create_subscription to postgres with admin option;
grant pg_monitor to postgres with admin option;
grant pg_monitor to supabase_etl_admin;
grant pg_monitor to supabase_read_only_user;
grant pg_read_all_data to postgres with admin option;
grant pg_read_all_data to supabase_etl_admin;
grant pg_read_all_data to supabase_read_only_user;
grant pg_signal_backend to postgres with admin option;
grant service_role to postgres with admin option;
grant supabase_privileged_role to postgres;
grant supabase_privileged_role to supabase_etl_admin;

-- Preserve the managed role administrator edges before reproducing the
-- migration-owner grants below. PostgreSQL 17 records INHERIT and SET
-- independently for role memberships; the explicit options match production.
grant custodial_application_reader to postgres
  with admin option, inherit false, set false;
grant custodial_readonly_runtime_20260822 to postgres
  with admin option, inherit false, set false;
grant static_weekly_control_plane to postgres
  with admin option, inherit false, set false;
grant static_weekly_release_operator to postgres
  with admin option, inherit false, set false;
grant static_weekly_runtime_20260823 to postgres
  with admin option, inherit false, set false;

set role postgres;
grant pg_read_all_data to memphis_zoo_backup;
grant custodial_application_reader to custodial_readonly_runtime_20260822;
grant static_weekly_control_plane to postgres;
grant static_weekly_release_operator to postgres;
grant static_weekly_control_plane to static_weekly_runtime_20260823
  with inherit false;
reset role;
