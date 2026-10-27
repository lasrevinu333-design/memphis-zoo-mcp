-- Pure metadata predicate projection only; not actual catalog/owner admission or populated preservation proof.
-- Two known helper profiles, no business data/roles/authority changes. Entire fixture ROLLBACK.
BEGIN;
CREATE TEMP TABLE helper_profiles(required jsonb) ON COMMIT DROP;
INSERT INTO helper_profiles SELECT value FROM jsonb_array_elements($profiles$[{"identity":"static_weekly_compiler_exception_set(uuid,date)","public_identity":"public.static_weekly_compiler_exception_set(uuid,date)","body_sha256":"53bd75e28b947dc643fc711b3684be7e1cdc651fccab2a6cb13aedc5b8ef0529","definition_sha256":"85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212","body_md5":"9a0da514351a45ca4d6c833e5b39bd04","definition_md5":"8da5d21a3ad12577457390367f02fa7e","restore_order":100255,"grant_sql":"select public.custodial_release_authority_reset_grants('static_weekly_compiler_exception_set(uuid,date)');","grant_sha256":"33b08761a92ee41164aa15127e76e17390aecd088655fba28facde99c9b46236","schema":"public","source_oid":"123","public_oid":"123","owner":"postgres","kind":"f","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"argnames":["p_publication_id","p_week_start"],"identity_arguments":"p_publication_id uuid, p_week_start date","result":"jsonb","retset":false,"strict":false,"leakproof":false,"parallel":"u","variadic":0,"defaults":0,"acl":[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false}],"effective":{"postgres":true,"anon":false,"authenticated":false,"service_role":false,"custodial_application_reader":false,"static_weekly_control_plane":false,"static_weekly_release_operator":false,"static_weekly_runtime_20260823":false},"alias_count":1,"alias_kind":"function","alias_identity":"static_weekly_compiler_exception_set(uuid,date)","alias_order":100255,"alias_sha":"85db993fb76b2bd098a0581c44f474c6990576252d1e2f5928555899b8cab212","alias_matches_current":true,"actor":"postgres","session_actor":"postgres","project":"rqquvtjdmugpigbndmne","replication":"origin","read_only":false,"superuser":false,"bypassrls":true,"inventory_owner":"postgres","always_guard":true},{"identity":"static_weekly_accepted_exception_set(uuid,date)","public_identity":"public.static_weekly_accepted_exception_set(uuid,date)","body_sha256":"9d05dcedabab2212f6abc73ccecf1a6ebd2f6f71fb56e482f2a03511e3c74290","definition_sha256":"8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7","body_md5":"e66d9f8b3e1a08aa681f2de8df34b562","definition_md5":"8ccc93ee140e4911f920223460fe97d5","restore_order":100253,"grant_sql":"select public.custodial_release_authority_reset_grants('static_weekly_accepted_exception_set(uuid,date)');","grant_sha256":"7726510b8129c4e59778db1dc250291875ca4ff1e6c3d69551e5c4ed633811b2","schema":"public","source_oid":"123","public_oid":"123","owner":"postgres","kind":"f","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"argnames":["p_publication_id","p_week_start"],"identity_arguments":"p_publication_id uuid, p_week_start date","result":"jsonb","retset":false,"strict":false,"leakproof":false,"parallel":"u","variadic":0,"defaults":0,"acl":[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false}],"effective":{"postgres":true,"anon":false,"authenticated":false,"service_role":false,"custodial_application_reader":false,"static_weekly_control_plane":false,"static_weekly_release_operator":false,"static_weekly_runtime_20260823":false},"alias_count":1,"alias_kind":"function","alias_identity":"static_weekly_accepted_exception_set(uuid,date)","alias_order":100253,"alias_sha":"8ce1e49beaf770567bd3468be0b28aea370e5930ce2138e1597eb90668e348d7","alias_matches_current":true,"actor":"postgres","session_actor":"postgres","project":"rqquvtjdmugpigbndmne","replication":"origin","read_only":false,"superuser":false,"bypassrls":true,"inventory_owner":"postgres","always_guard":true}]$profiles$::jsonb);
CREATE FUNCTION pg_temp.helper_matches(required jsonb,seen jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $predicate$
 SELECT seen->'identity' IS NOT DISTINCT FROM required->'identity'
 AND seen->'public_identity' IS NOT DISTINCT FROM required->'public_identity'
 AND seen->'body_sha256' IS NOT DISTINCT FROM required->'body_sha256'
 AND seen->'definition_sha256' IS NOT DISTINCT FROM required->'definition_sha256'
 AND seen->'body_md5' IS NOT DISTINCT FROM required->'body_md5'
 AND seen->'definition_md5' IS NOT DISTINCT FROM required->'definition_md5'
 AND seen->'restore_order' IS NOT DISTINCT FROM required->'restore_order'
 AND seen->'grant_sql' IS NOT DISTINCT FROM required->'grant_sql'
 AND seen->'grant_sha256' IS NOT DISTINCT FROM required->'grant_sha256'
 AND seen->'schema' IS NOT DISTINCT FROM required->'schema'
 AND seen->'source_oid' IS NOT DISTINCT FROM required->'source_oid'
 AND seen->'public_oid' IS NOT DISTINCT FROM required->'public_oid'
 AND seen->'owner' IS NOT DISTINCT FROM required->'owner'
 AND seen->'kind' IS NOT DISTINCT FROM required->'kind'
 AND seen->'language' IS NOT DISTINCT FROM required->'language'
 AND seen->'security_definer' IS NOT DISTINCT FROM required->'security_definer'
 AND seen->'volatility' IS NOT DISTINCT FROM required->'volatility'
 AND seen->'config' IS NOT DISTINCT FROM required->'config'
 AND seen->'argnames' IS NOT DISTINCT FROM required->'argnames'
 AND seen->'identity_arguments' IS NOT DISTINCT FROM required->'identity_arguments'
 AND seen->'result' IS NOT DISTINCT FROM required->'result'
 AND seen->'retset' IS NOT DISTINCT FROM required->'retset'
 AND seen->'strict' IS NOT DISTINCT FROM required->'strict'
 AND seen->'leakproof' IS NOT DISTINCT FROM required->'leakproof'
 AND seen->'parallel' IS NOT DISTINCT FROM required->'parallel'
 AND seen->'variadic' IS NOT DISTINCT FROM required->'variadic'
 AND seen->'defaults' IS NOT DISTINCT FROM required->'defaults'
 AND seen->'acl' IS NOT DISTINCT FROM required->'acl'
 AND seen->'effective' IS NOT DISTINCT FROM required->'effective'
 AND seen->'alias_count' IS NOT DISTINCT FROM required->'alias_count'
 AND seen->'alias_kind' IS NOT DISTINCT FROM required->'alias_kind'
 AND seen->'alias_identity' IS NOT DISTINCT FROM required->'alias_identity'
 AND seen->'alias_order' IS NOT DISTINCT FROM required->'alias_order'
 AND seen->'alias_sha' IS NOT DISTINCT FROM required->'alias_sha'
 AND seen->'alias_matches_current' IS NOT DISTINCT FROM required->'alias_matches_current'
 AND seen->'actor' IS NOT DISTINCT FROM required->'actor'
 AND seen->'session_actor' IS NOT DISTINCT FROM required->'session_actor'
 AND seen->'project' IS NOT DISTINCT FROM required->'project'
 AND seen->'replication' IS NOT DISTINCT FROM required->'replication'
 AND seen->'read_only' IS NOT DISTINCT FROM required->'read_only'
 AND seen->'superuser' IS NOT DISTINCT FROM required->'superuser'
 AND seen->'bypassrls' IS NOT DISTINCT FROM required->'bypassrls'
 AND seen->'inventory_owner' IS NOT DISTINCT FROM required->'inventory_owner'
 AND seen->'always_guard' IS NOT DISTINCT FROM required->'always_guard';
$predicate$;
DO $tests$
DECLARE r record;m record;candidate jsonb;cases integer:=0;
BEGIN
 FOR r IN SELECT required FROM helper_profiles LOOP
  IF pg_temp.helper_matches(r.required,r.required) IS DISTINCT FROM true THEN RAISE EXCEPTION 'positive refused';END IF;cases:=cases+1;
  FOR m IN SELECT key,value FROM jsonb_each($mutations${"schema":"pg_catalog","source_oid":"999","owner":"service_role","kind":"p","language":"plpgsql","security_definer":false,"volatility":"v","config":null,"argnames":["wrong"],"identity_arguments":"uuid,date","result":"text","retset":true,"strict":true,"leakproof":true,"parallel":"s","variadic":1,"defaults":1,"body_sha256":"0000000000000000000000000000000000000000000000000000000000000000","definition_sha256":"0000000000000000000000000000000000000000000000000000000000000000","body_md5":"00000000000000000000000000000000","definition_md5":"00000000000000000000000000000000","grant_sql":"wrong","grant_sha256":"0000000000000000000000000000000000000000000000000000000000000000","acl":[],"effective":{},"alias_count":2,"alias_kind":"grant","alias_identity":"public.wrong()","alias_order":0,"alias_sha":"0000000000000000000000000000000000000000000000000000000000000000","alias_matches_current":false,"actor":"supabase_admin","session_actor":"other","project":"other","replication":"replica","read_only":true,"superuser":true,"bypassrls":false,"inventory_owner":"other","always_guard":false}$mutations$::jsonb) LOOP
   candidate=jsonb_set(r.required,ARRAY[m.key],m.value);
   IF pg_temp.helper_matches(r.required,candidate) IS DISTINCT FROM false THEN RAISE EXCEPTION 'negative admitted: %',m.key;END IF;cases:=cases+1;
  END LOOP;
  FOR candidate IN SELECT jsonb_set(r.required,'{acl}',x) FROM jsonb_array_elements('[
   [{"grantee":"postgres","grantor":"service_role","privilege":"EXECUTE","grantable":false}],
   [{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":true}],
   [{"grantee":"postgres","grantor":"postgres","privilege":"USAGE","grantable":false}],
   [{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"PUBLIC","grantor":"postgres","privilege":"EXECUTE","grantable":false}]
  ]'::jsonb) x LOOP
   IF pg_temp.helper_matches(r.required,candidate) IS DISTINCT FROM false THEN RAISE EXCEPTION 'wrong grantor/option/privilege/extraACL admitted';END IF;cases:=cases+1;
  END LOOP;
  FOR m IN SELECT key FROM jsonb_each(r.required->'effective') LOOP
   candidate=jsonb_set(r.required,ARRAY['effective',m.key],to_jsonb(NOT (r.required->'effective'->>m.key)::boolean));
   IF pg_temp.helper_matches(r.required,candidate) IS DISTINCT FROM false THEN RAISE EXCEPTION 'wrong effective role admitted';END IF;cases:=cases+1;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'PASS helper metadata projection cases=% positives=2; not actual catalog admission',cases;
END $tests$;
ROLLBACK;
