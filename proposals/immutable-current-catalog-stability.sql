-- Current postgres locked catalog stability; no DATA or new admission authority.
-- The unchanged original target_shape() remains the fallback and seal source.
CREATE FUNCTION custodial_dr.immutable_import_lock_catalogs()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $catalog$
DECLARE item record;expected integer;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT count(*) INTO expected FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='pg_catalog' AND c.relkind='r';
 IF expected<>64 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed';END IF;
 FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='pg_catalog' AND c.relkind='r' ORDER BY c.oid LOOP
  EXECUTE format('LOCK TABLE ONLY pg_catalog.%I IN SHARE MODE',item.relname);
 END LOOP;
END $catalog$;
CREATE FUNCTION custodial_dr.immutable_import_catalog_epoch()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $catalog$
DECLARE current_db oid;missing integer;expected integer;invalid integer;members jsonb;settings_digest text;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR current_setting('track_counts')<>'on'
  OR current_setting('session_replication_role')<>'origin'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed';END IF;
 SELECT oid INTO STRICT current_db FROM pg_database WHERE datname=current_database();
 WITH catalog AS MATERIALIZED(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='pg_catalog' AND c.relkind='r'),
 held AS MATERIALIZED(SELECT DISTINCT relation FROM pg_locks WHERE locktype='relation' AND pid=pg_backend_pid()
  AND granted AND database IN(0,current_db) AND mode IN('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))
 SELECT count(*),count(*) FILTER(WHERE h.relation IS NULL) INTO expected,missing
  FROM catalog c LEFT JOIN held h ON h.relation=c.oid;
 IF expected<>64 OR missing<>0 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed';END IF;
 WITH catalog AS MATERIALIZED(SELECT c.oid,pg_relation_filenode(c.oid) AS file_node,
  pg_stat_get_xact_tuples_inserted(c.oid) AS inserted,pg_stat_get_xact_tuples_updated(c.oid) AS updated,
  pg_stat_get_xact_tuples_deleted(c.oid) AS deleted
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='pg_catalog' AND c.relkind='r')
 SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'file_node',c.file_node,
  'inserted',c.inserted::text,'updated',c.updated::text,'deleted',c.deleted::text) ORDER BY c.oid),
  count(*) FILTER(WHERE c.file_node IS NULL OR c.file_node=0 OR c.inserted IS NULL OR c.inserted<0
   OR c.updated IS NULL OR c.updated<0 OR c.deleted IS NULL OR c.deleted<0)
  INTO members,invalid FROM catalog c;
 IF invalid<>0 OR members IS NULL OR jsonb_array_length(members)<>64 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed';END IF;
 SELECT encode(extensions.digest(convert_to(jsonb_object_agg(name,setting ORDER BY name)::text,'UTF8'),'sha256'),'hex')
  INTO settings_digest FROM pg_settings;
 IF settings_digest IS NULL OR settings_digest!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed';END IF;
 RETURN jsonb_build_object('database_oid',current_db::text,'backend_pid',pg_backend_pid(),
  'transaction_id',txid_current()::text,'catalogs',members,'settings',settings_digest);
END $catalog$;
CREATE FUNCTION custodial_dr.immutable_import_catalog_matches(expected_shape jsonb,expected_epoch jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $catalog$
DECLARE before_epoch jsonb;after_epoch jsonb;live_data jsonb;expected_data jsonb;
BEGIN
 -- This is a metadata proof only. It never supplies a context, witness,
 -- phase, actor, source, clock policy, mutation permission or saved verdict.
 before_epoch:=custodial_dr.immutable_import_catalog_epoch();
 IF expected_epoch IS NULL OR before_epoch IS DISTINCT FROM expected_epoch THEN
  RETURN expected_shape IS NOT DISTINCT FROM custodial_dr.immutable_import_target_shape();
 END IF;
 -- The effective later target_shape also seals authority scope/type/codec
 -- definitions. Those are ALL catalog-derived, covered by the same locks,
 -- counters, filenodes and settings. These three inputs are actual DATA and
 -- must still be read freshly on every assertion, under their original guards.
 SELECT jsonb_build_object(
  'migration_head',(SELECT max(version)::text FROM supabase_migrations.schema_migrations),
  'release',(SELECT jsonb_agg(jsonb_build_object('release_id',release_id,'backend_commit',backend_commit,'frontend_commit',frontend_commit,
   'migration_head',migration_head,'migration_manifest_sha256',migration_manifest_sha256) ORDER BY release_id)
   FROM public.release_deployment_manifest WHERE status='deployed'),
  'recovery_inventory',custodial_dr.immutable_import_source_inventory_state()) INTO live_data;
 expected_data:=jsonb_build_object('migration_head',expected_shape->'migration_head',
  'release',expected_shape->'release','recovery_inventory',expected_shape->'recovery_inventory');
 after_epoch:=custodial_dr.immutable_import_catalog_epoch();
 IF after_epoch IS DISTINCT FROM before_epoch OR after_epoch IS DISTINCT FROM expected_epoch THEN
  -- No rebaselining or epoch adoption, even if the full shape still matches.
  RETURN expected_shape IS NOT DISTINCT FROM custodial_dr.immutable_import_target_shape();
 END IF;
 RETURN live_data IS NOT DISTINCT FROM expected_data;
END $catalog$;
DO $catalog_acl$
DECLARE f record;grant_record record;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED';END IF;
 FOR f IN SELECT p.oid,p.proowner,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_lock_catalogs','immutable_import_catalog_epoch','immutable_import_catalog_matches') LOOP
  IF f.proowner<>(SELECT oid FROM pg_roles WHERE rolname=session_user) OR f.prosecdef THEN
   RAISE EXCEPTION 'Original catalog stability function owner differs';END IF;
  FOR grant_record IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid=f.oid),acldefault('f',f.proowner)))
   WHERE grantee<>f.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.oid::regprocedure,
    CASE WHEN grant_record.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_record.grantee)) END);
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='custodial_dr'
  AND p.proname IN('immutable_import_lock_catalogs','immutable_import_catalog_epoch','immutable_import_catalog_matches'))<>3
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_lock_catalogs','immutable_import_catalog_epoch','immutable_import_catalog_matches')
    AND(a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 THEN RAISE EXCEPTION 'Original catalog stability ACL differs';END IF;
END $catalog_acl$;
