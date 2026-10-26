-- Source04 constrained platform FUNCTION prerequisites; not full vendor NORMAL.
-- No application data, auth/storage fixtures, app RPCs or migration edits.
BEGIN;
DO $fresh_original$ BEGIN
 IF session_user<>'supabase_admin' OR current_user<>'supabase_admin'
 OR NOT (SELECT rolsuper AND rolcreatedb AND rolcreaterole AND rolcanlogin AND rolreplication AND rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user)
 OR (SELECT count(*) FROM pg_catalog.pg_default_acl)<>0
 OR (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database())<>'supabase_admin'
 OR current_setting('server_version_num')::integer/10000<>17
 OR current_setting('session_replication_role')<>'origin'
 OR current_setting('cron.launch_active_jobs')<>'off'
 OR current_setting('listen_addresses')<>''
 THEN RAISE EXCEPTION 'Fresh selected original admin/platform baseline mismatch'; END IF;
END $fresh_original$;
CREATE ROLE postgres NOSUPERUSER CREATEDB CREATEROLE LOGIN INHERIT REPLICATION BYPASSRLS;
CREATE ROLE anon NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN INHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN INHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN INHERIT NOREPLICATION BYPASSRLS;
GRANT anon, authenticated, service_role TO postgres WITH ADMIN OPTION;
CREATE SCHEMA extensions AUTHORIZATION supabase_admin;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
 GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER ROLE supabase_admin SET search_path TO "\$user",public,auth,extensions;
ALTER ROLE postgres SET search_path TO "\$user",public,extensions;
ALTER ROLE anon SET statement_timeout='3s';
ALTER ROLE authenticated SET statement_timeout='8s';
SET LOCAL search_path TO "\$user",public,auth,extensions;
-- Read-only catalog assertions after bootstrap writes; no application RPC/canary.
DO $selected_catalog_assertions$
DECLARE d record; expected_roles oid[]; expected_creators oid[]; selected_roles oid[];
BEGIN
 SELECT array_agg(oid ORDER BY oid) INTO expected_roles FROM pg_catalog.pg_roles
  WHERE rolname IN('postgres','anon','authenticated','service_role');
 SELECT array_agg(oid ORDER BY oid) INTO expected_creators FROM pg_catalog.pg_roles
  WHERE rolname IN('postgres','supabase_admin');
 SELECT array_agg(oid ORDER BY oid) INTO selected_roles FROM pg_catalog.pg_roles
  WHERE rolname IN('postgres','supabase_admin','anon','authenticated','service_role');
 IF cardinality(expected_roles)<>4 OR cardinality(expected_creators)<>2 OR cardinality(selected_roles)<>5
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreatedb AND rolcreaterole AND rolcanlogin AND rolinherit AND rolreplication AND rolbypassrls)
 OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN('anon','authenticated','service_role') AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolcanlogin AND rolinherit AND NOT rolreplication AND rolbypassrls=(rolname='service_role'))<>3
 OR NOT (SELECT p.oid<a.oid AND a.oid<b.oid AND b.oid<s.oid FROM pg_catalog.pg_roles p,pg_catalog.pg_roles a,pg_catalog.pg_roles b,pg_catalog.pg_roles s WHERE p.rolname='postgres' AND a.rolname='anon' AND b.rolname='authenticated' AND s.rolname='service_role')
 THEN RAISE EXCEPTION 'Selected platform role attributes/creation order mismatch'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE member=ANY(selected_roles) OR roleid=ANY(selected_roles))<>3
 OR (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles p ON p.oid=m.member
  WHERE p.rolname='postgres' AND r.rolname IN('anon','authenticated','service_role')
   AND m.grantor='supabase_admin'::regrole AND m.admin_option AND m.inherit_option AND m.set_option)<>3
 THEN RAISE EXCEPTION 'Selected three API to postgres membership edges mismatch'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_default_acl)<>2
 OR (SELECT count(*) FROM pg_catalog.pg_default_acl WHERE defaclrole=ANY(expected_creators) AND defaclnamespace='public'::regnamespace AND defaclobjtype='f')<>2
 THEN RAISE EXCEPTION 'Exactly two creator-scoped public FUNCTION default profiles required'; END IF;
 FOR d IN SELECT * FROM pg_catalog.pg_default_acl LOOP
  IF (SELECT count(*) FROM pg_catalog.aclexplode(d.defaclacl))<>4
  OR (SELECT array_agg(a.grantee ORDER BY a.grantee) FROM pg_catalog.aclexplode(d.defaclacl) a) IS DISTINCT FROM expected_roles
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(d.defaclacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>d.defaclrole)
  THEN RAISE EXCEPTION 'Creator-specific FUNCTION default ACL/grantor mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclnamespace=0 OR defaclobjtype IN('r','S'))
 THEN RAISE EXCEPTION 'Global function override or initial TABLE/SEQUENCE default grants are forbidden in this selected profile'; END IF;
 IF (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='supabase_admin') IS DISTINCT FROM ARRAY[$rawadmin$search_path="\$user", public, auth, extensions$rawadmin$]::text[]
 OR (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='postgres') IS DISTINCT FROM ARRAY[$rawpostgres$search_path="\$user", public, extensions$rawpostgres$]::text[]
 OR (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='anon') IS DISTINCT FROM ARRAY['statement_timeout=3s']::text[]
 OR (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='authenticated') IS DISTINCT FROM ARRAY['statement_timeout=8s']::text[]
 OR (SELECT rolconfig FROM pg_catalog.pg_roles WHERE rolname='service_role') IS NOT NULL
 THEN RAISE EXCEPTION 'Literal pinned role settings/timeouts mismatch'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles r CROSS JOIN (VALUES('public'),('extensions')) n(name)
  WHERE r.rolname IN('postgres','anon','authenticated','service_role') AND pg_catalog.has_schema_privilege(r.oid,n.name,'USAGE'))<>8
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='extensions' AND nspowner='supabase_admin'::regrole)
 THEN RAISE EXCEPTION 'Selected public/extensions usage/schema owner mismatch'; END IF;
END $selected_catalog_assertions$;
SELECT jsonb_build_object(
 'schema','custodial.fresh291.scoped-pinned-function-bootstrap04.v1',
 'state','OBSERVED_SELECTED_FUNCTION_PLATFORM_PROFILE04_ONLY_NOT_NORMAL_REFERENCE',
 'Root_selected_profile','{"path":"/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-selected-pinned-function-platform-profile04-20261024T1233Z/ROOT_SELECTED_PROFILE.json","sha256":"5f9edfaed64318fd01134a6d01491fb0315fbb5d823e7adc40d10be1e0770b4a","bytes":3653}'::jsonb,
 'session_user',session_user,'current_user',current_user,
 'database_owner',(SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()),
 'server_version_num',current_setting('server_version_num')::integer,
 'initial_default_acl_rows',(SELECT count(*) FROM pg_catalog.pg_default_acl),
 'initial_table_sequence_default_acl_rows',(SELECT count(*) FROM pg_catalog.pg_default_acl WHERE defaclobjtype IN('r','S')),
 'global_function_default_acl_rows',(SELECT count(*) FROM pg_catalog.pg_default_acl WHERE defaclnamespace=0 AND defaclobjtype='f'),
 'cron_active',current_setting('cron.launch_active_jobs'),'listen_addresses',current_setting('listen_addresses'),
 'session_search_path',current_setting('search_path'),
 'roles',(SELECT jsonb_agg(jsonb_build_object('oid',oid::bigint,'name',rolname,'superuser',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,'login',rolcanlogin,'bypassrls',rolbypassrls,'replication',rolreplication,'inherit',rolinherit,'config',rolconfig) ORDER BY oid) FROM pg_catalog.pg_roles WHERE rolname IN('supabase_admin','postgres','anon','authenticated','service_role')),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('role_oid',m.roleid::bigint,'role_name',r.rolname,'member_oid',m.member::bigint,'member_name',p.rolname,'grantor_oid',m.grantor::bigint,'grantor_name',g.rolname,'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option) ORDER BY m.roleid,m.member,m.grantor) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles p ON p.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor WHERE p.rolname='postgres'),
 'function_default_acl',(SELECT jsonb_agg(jsonb_build_object('creator_oid',d.defaclrole::bigint,'creator_name',r.rolname,'schema','public','object_type',d.defaclobjtype::text,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee_oid',a.grantee::bigint,'grantee_name',g.rolname,'grantor_oid',a.grantor::bigint,'grantor_name',z.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee) FROM pg_catalog.aclexplode(d.defaclacl) a JOIN pg_catalog.pg_roles g ON g.oid=a.grantee JOIN pg_catalog.pg_roles z ON z.oid=a.grantor)) ORDER BY d.defaclrole) FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='f'),
 'catalog_assertions_completed',true,
 'global_native_PUBLIC_function_default_not_overridden',true,
 'full_vendor_NORMAL',false,'expected_fingerprint_authority',null,'application_function_called',false);
COMMIT;
