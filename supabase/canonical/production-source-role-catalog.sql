-- Reproduce the non-secret production role catalog needed to restore the
-- accepted 31d6... source schema into the pinned isolated Supabase image.
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

set role postgres;
grant pg_read_all_data to memphis_zoo_backup;
reset role;
