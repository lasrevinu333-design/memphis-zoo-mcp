-- SOURCE PROPOSAL ONLY. NOT a generated/registered/applied migration.
-- Main must qualify and register EVERY changed guard/recovery definition.
-- No activation of production-restore's unsupported branch is included.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $owner$
DECLARE operator_oid oid; namespace_owner_oid oid; import_namespace_oid oid; private_namespace_oid oid;
BEGIN
 SELECT oid INTO operator_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 SELECT oid INTO namespace_owner_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
 SELECT oid INTO import_namespace_oid FROM pg_catalog.pg_namespace WHERE nspname='custodial_dr';
 SELECT oid INTO private_namespace_oid FROM pg_catalog.pg_namespace WHERE nspname='custodial_release_identity';
 -- Approved migration names are only a refusal floor, NEVER owner authority.
 -- Database/schema ownership is separate: do not re-own those namespaces or
 -- accept a database owner that does not own these SAME original objects.
 IF current_user <> session_user OR current_user NOT IN('postgres','supabase_admin') OR operator_oid IS NULL
  OR import_namespace_oid IS NULL OR private_namespace_oid IS NULL
  OR namespace_owner_oid IS NULL
  OR (SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database()) IS DISTINCT FROM namespace_owner_oid
  OR (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid=import_namespace_oid) IS DISTINCT FROM namespace_owner_oid
  OR NOT coalesce(has_schema_privilege(operator_oid,import_namespace_oid,'USAGE'),false)
  OR NOT coalesce(has_schema_privilege(operator_oid,import_namespace_oid,'CREATE'),false)
  OR NOT coalesce(has_schema_privilege(operator_oid,private_namespace_oid,'USAGE'),false)
  OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN(
       to_regclass('custodial_dr.restore_control'),to_regclass('custodial_dr.restore_manifests'),
       to_regclass('custodial_dr.application_mutation_leases'),
       to_regclass('custodial_release_identity.group_original_creations'),
       to_regclass('custodial_release_identity.employee_message_original_outcomes'))
      AND c.relkind='r' AND c.relowner=operator_oid)<>5
  OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN(
       to_regprocedure('custodial_dr.guard_application_mutation()'),
       to_regprocedure('custodial_release_identity.guard_group_original_creation()'),
       to_regprocedure('public.custodial_feedback_triage_immutable()'))
      AND p.proowner=operator_oid AND p.prokind='f' AND p.prorettype='trigger'::regtype)<>3
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'; END IF;
END $owner$;

-- Non-restored, owner-only transaction ancestry, NEVER a caller capability.
CREATE TABLE custodial_dr.immutable_private_import_context(
 database_oid oid NOT NULL, backend_pid integer NOT NULL, transaction_id bigint NOT NULL,
 restore_id uuid NOT NULL, authority_generation bigint NOT NULL, archive_digest text NOT NULL,
 original_manifest jsonb NOT NULL, original_control jsonb NOT NULL, target_shape jsonb NOT NULL,
 phase text NOT NULL CHECK(phase IN('STAGING','INSERTING_ORDINARY','INSERTING_ORDINARY_SET','INSERTING','FINISHED')),
 active_table_oid oid, active_row_sha256 text,
 CHECK((phase IN('INSERTING_ORDINARY','INSERTING_ORDINARY_SET') AND active_table_oid IS NOT NULL AND active_row_sha256 IS NOT NULL AND active_row_sha256 ~ '^[a-f0-9]{64}$')
   OR (phase NOT IN('INSERTING_ORDINARY','INSERTING_ORDINARY_SET') AND active_table_oid IS NULL AND active_row_sha256 IS NULL)),
 PRIMARY KEY(database_oid,backend_pid,transaction_id),
 UNIQUE(restore_id,authority_generation)
);
CREATE TABLE custodial_dr.immutable_private_import_rows(
 database_oid oid NOT NULL, backend_pid integer NOT NULL, transaction_id bigint NOT NULL,
 table_oid oid NOT NULL, ordinal bigint NOT NULL CHECK(ordinal>0), original_row_utf8 text NOT NULL CHECK(original_row_utf8<>''),
 original_row_sha256 text NOT NULL CHECK(original_row_sha256 ~ '^[a-f0-9]{64}$'), typed_original jsonb NOT NULL CHECK(jsonb_typeof(typed_original)='object'),
 PRIMARY KEY(database_oid,backend_pid,transaction_id,table_oid,ordinal),
 FOREIGN KEY(database_oid,backend_pid,transaction_id)
  REFERENCES custodial_dr.immutable_private_import_context(database_oid,backend_pid,transaction_id)
);
-- Ordinary JSON may preserve lexical DATA which jsonb cannot represent.
-- Stage exact UTF8 plus the target composite's JSON TEXT, not a jsonb image.
CREATE TABLE custodial_dr.immutable_ordinary_import_rows(
 database_oid oid NOT NULL,backend_pid integer NOT NULL,transaction_id bigint NOT NULL,
 table_oid oid NOT NULL,ordinal bigint NOT NULL CHECK(ordinal>0),original_row_utf8 text NOT NULL CHECK(original_row_utf8<>''),
 original_row_sha256 text NOT NULL CHECK(original_row_sha256 ~ '^[a-f0-9]{64}$'),typed_original_text text NOT NULL,
 PRIMARY KEY(database_oid,backend_pid,transaction_id,table_oid,ordinal),
 FOREIGN KEY(database_oid,backend_pid,transaction_id)
 REFERENCES custodial_dr.immutable_private_import_context(database_oid,backend_pid,transaction_id)
);
ALTER TABLE custodial_dr.immutable_ordinary_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_dr.immutable_ordinary_import_rows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_dr.immutable_ordinary_import_rows FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader;
ALTER TABLE custodial_dr.immutable_private_import_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_dr.immutable_private_import_context FORCE ROW LEVEL SECURITY;
ALTER TABLE custodial_dr.immutable_private_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_dr.immutable_private_import_rows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_dr.immutable_private_import_context,custodial_dr.immutable_private_import_rows
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader;
-- Bind policies to THIS already-validated creator's name AND OID, not to a
-- global migration-role list, membership, namespace owner or caller setting.
DO $policies$
DECLARE operator_oid oid; item record; predicate text;
BEGIN
 SELECT oid INTO operator_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF current_user<>session_user OR operator_oid IS NULL
  OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN(
    'custodial_dr.immutable_private_import_context'::regclass,'custodial_dr.immutable_private_import_rows'::regclass,
    'custodial_dr.immutable_ordinary_import_rows'::regclass) AND c.relowner=operator_oid)<>3
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Immutable import policy creator changed'; END IF;
 predicate:=format('current_user=session_user AND current_user=%L AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)=%L::oid',
   current_user,operator_oid::text);
 FOR item IN SELECT * FROM (VALUES
   ('immutable_private_import_context','immutable_import_context_owner'),
   ('immutable_private_import_rows','immutable_import_rows_owner'),
   ('immutable_ordinary_import_rows','immutable_ordinary_rows_owner')) fixed(table_name,policy_name) LOOP
  EXECUTE format('CREATE POLICY %I ON custodial_dr.%I FOR ALL TO %I USING (%s) WITH CHECK (%s)',
    item.policy_name,item.table_name,current_user,predicate,predicate);
 END LOOP;
END $policies$;
-- Only the three internal phase-transfer fields may change after begin.
-- Original source/control/target ancestry is never caller-replaceable DATA.
CREATE FUNCTION custodial_dr.immutable_import_context_source_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND TG_LEVEL='ROW' AND TG_TABLE_SCHEMA='custodial_dr'
  AND TG_TABLE_NAME='immutable_private_import_context' AND TG_NARGS=0
  AND TG_NAME='immutable_import_context_source_immutable'
  AND TG_RELID='custodial_dr.immutable_private_import_context'::regclass THEN
  IF ROW(NEW.database_oid,NEW.backend_pid,NEW.transaction_id,NEW.restore_id,NEW.authority_generation,
    NEW.archive_digest,NEW.original_manifest,NEW.original_control,NEW.target_shape)
    IS DISTINCT FROM ROW(OLD.database_oid,OLD.backend_pid,OLD.transaction_id,OLD.restore_id,OLD.authority_generation,
     OLD.archive_digest,OLD.original_manifest,OLD.original_control,OLD.target_shape)
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original immutable import context cannot be replaced'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original immutable import context cannot be removed';
END $fn$;
CREATE TRIGGER immutable_import_context_source_immutable BEFORE UPDATE OR DELETE ON custodial_dr.immutable_private_import_context
 FOR EACH ROW EXECUTE FUNCTION custodial_dr.immutable_import_context_source_immutable();
CREATE TRIGGER immutable_import_context_source_no_truncate BEFORE TRUNCATE ON custodial_dr.immutable_private_import_context
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.immutable_import_context_source_immutable();
ALTER TABLE custodial_dr.immutable_private_import_context ENABLE ALWAYS TRIGGER immutable_import_context_source_immutable;
ALTER TABLE custodial_dr.immutable_private_import_context ENABLE ALWAYS TRIGGER immutable_import_context_source_no_truncate;

CREATE FUNCTION custodial_dr.immutable_import_staged_rows_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original staged private DATA cannot be replaced or removed'; END $fn$;
CREATE TRIGGER immutable_import_staged_rows_immutable BEFORE UPDATE OR DELETE ON custodial_dr.immutable_private_import_rows
 FOR EACH ROW EXECUTE FUNCTION custodial_dr.immutable_import_staged_rows_immutable();
CREATE TRIGGER immutable_ordinary_staged_rows_immutable BEFORE UPDATE OR DELETE ON custodial_dr.immutable_ordinary_import_rows
 FOR EACH ROW EXECUTE FUNCTION custodial_dr.immutable_import_staged_rows_immutable();
CREATE TRIGGER immutable_import_staged_rows_no_truncate BEFORE TRUNCATE ON custodial_dr.immutable_private_import_rows
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.immutable_import_staged_rows_immutable();
CREATE TRIGGER immutable_ordinary_staged_rows_no_truncate BEFORE TRUNCATE ON custodial_dr.immutable_ordinary_import_rows
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.immutable_import_staged_rows_immutable();
ALTER TABLE custodial_dr.immutable_ordinary_import_rows ENABLE ALWAYS TRIGGER immutable_ordinary_staged_rows_immutable;
ALTER TABLE custodial_dr.immutable_ordinary_import_rows ENABLE ALWAYS TRIGGER immutable_ordinary_staged_rows_no_truncate;
ALTER TABLE custodial_dr.immutable_private_import_rows ENABLE ALWAYS TRIGGER immutable_import_staged_rows_immutable;
ALTER TABLE custodial_dr.immutable_private_import_rows ENABLE ALWAYS TRIGGER immutable_import_staged_rows_no_truncate;

CREATE FUNCTION custodial_dr.immutable_import_owner_fence()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE owner_oid oid; namespace_owner_oid oid; database_oid oid; fence_key bigint;
BEGIN
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 SELECT oid INTO namespace_owner_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
 SELECT oid INTO STRICT database_oid FROM pg_catalog.pg_database WHERE datname=current_database();
 IF current_user <> session_user OR current_user NOT IN('postgres','supabase_admin') OR owner_oid IS NULL
  OR namespace_owner_oid IS NULL
  OR (SELECT datdba FROM pg_catalog.pg_database WHERE oid=database_oid) IS DISTINCT FROM namespace_owner_oid
  OR (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname='custodial_dr') IS DISTINCT FROM namespace_owner_oid
  OR current_setting('session_replication_role') <> 'origin'
  OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN(
       to_regclass('custodial_dr.restore_control'),to_regclass('custodial_dr.restore_manifests'),
       to_regclass('custodial_dr.application_mutation_leases'),
       to_regclass('custodial_release_identity.group_original_creations'),
       to_regclass('custodial_release_identity.employee_message_original_outcomes'),
       'custodial_dr.immutable_private_import_context'::regclass,'custodial_dr.immutable_private_import_rows'::regclass,
       'custodial_dr.immutable_ordinary_import_rows'::regclass)
      AND c.relkind='r' AND c.relowner=owner_oid)<>8
  OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN(
       to_regprocedure('custodial_dr.guard_application_mutation()'),
       to_regprocedure('custodial_release_identity.guard_group_original_creation()'),
       to_regprocedure('public.custodial_feedback_triage_immutable()'))
      AND p.proowner=owner_oid AND p.prokind='f' AND p.prorettype='trigger'::regtype)<>3
  OR EXISTS(SELECT 1 FROM custodial_dr.application_mutation_leases)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'; END IF;
 fence_key:=pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence',0);
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='advisory'
   AND l.pid=pg_backend_pid() AND l.database=database_oid AND l.granted AND l.mode='ExclusiveLock'
   AND l.classid=((fence_key>>32)&4294967295)::oid AND l.objid=(fence_key&4294967295)::oid AND l.objsubid=1)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original global fence unavailable'; END IF;
END $fn$;

-- Memoized Source metadata only, never import/caller authority. The original
-- rowset is sealed in ctx.target_shape; reuse requires a fresh locked epoch.
CREATE FUNCTION custodial_dr.immutable_import_source_inventory_state()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE owner_oid oid; current_db_oid oid; current_pid integer; current_xid bigint;
 inventory_oid oid; context_oid oid; guard_oid oid; file_node oid;
 inserted_count bigint; updated_count bigint; deleted_count bigint;
 boundary integer; context_count bigint; context_values jsonb;
 before_epoch jsonb; fresh_epoch jsonb; result jsonb;
BEGIN
 FOR boundary IN 1..2 LOOP
  PERFORM custodial_dr.immutable_import_owner_fence();
  SELECT oid INTO STRICT current_db_oid FROM pg_catalog.pg_database WHERE datname=current_database();
  SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
  current_pid:=pg_catalog.pg_backend_pid(); current_xid:=pg_catalog.txid_current();
  inventory_oid:=pg_catalog.to_regclass('public.custodial_release_authority_restore_inventory');
  context_oid:=pg_catalog.to_regclass('custodial_dr.immutable_private_import_context');
  guard_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_import_context_source_immutable()');
  IF pg_catalog.current_setting('track_counts') IS DISTINCT FROM 'on'
   OR current_user IS DISTINCT FROM session_user OR current_db_oid=0 OR owner_oid=0
   OR current_pid<=0 OR current_xid<=0 OR inventory_oid IS NULL OR context_oid IS NULL OR guard_oid IS NULL
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=inventory_oid
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=context_oid
     AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
     AND c.relrowsecurity AND c.relforcerowsecurity
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
       WHERE a.grantee<>c.relowner))
   OR (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=context_oid)<>1
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=context_oid
     AND p.polname='immutable_import_context_owner' AND p.polcmd='*' AND p.polpermissive
     AND p.polroles=ARRAY[owner_oid] AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL)
   -- No missing-lock fallback. SHARE and these stronger modes conflict with
   -- every other backend's ROW EXCLUSIVE writers on this actual relation.
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='relation'
     AND l.database=current_db_oid AND l.relation=inventory_oid AND l.pid=current_pid AND l.granted
     AND l.mode IN('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=guard_oid
     AND p.proowner=owner_oid AND p.prokind='f' AND p.pronargs=0 AND NOT p.proretset AND NOT p.prosecdef
     AND p.prorettype='pg_catalog.trigger'::regtype
     AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
     AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
       ='102e3c2b0bdcd9108a79c1aeb497a294e749937b8950cdee1760ba2749eaee44'
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE a.grantee<>p.proowner))
   OR (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=context_oid AND NOT t.tgisinternal)<>2
   OR (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN (VALUES
       ('immutable_import_context_source_immutable',27),
       ('immutable_import_context_source_no_truncate',34)) fixed(name,kind)
       ON t.tgname=fixed.name AND t.tgtype=fixed.kind
     WHERE t.tgrelid=context_oid AND t.tgfoid=guard_oid AND t.tgenabled='A' AND NOT t.tgisinternal
       AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0 AND t.tgqual IS NULL
       AND t.tgattr::text='' AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND t.tgparentid=0)<>2
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import Source inventory epoch unavailable'; END IF;
  file_node:=pg_catalog.pg_relation_filenode(inventory_oid);
  -- Own-transaction counters, not the cached cumulative statistics snapshot.
  inserted_count:=pg_catalog.pg_stat_get_xact_tuples_inserted(inventory_oid);
  updated_count:=pg_catalog.pg_stat_get_xact_tuples_updated(inventory_oid);
  deleted_count:=pg_catalog.pg_stat_get_xact_tuples_deleted(inventory_oid);
  IF file_node IS NULL OR file_node=0 OR inserted_count IS NULL OR inserted_count<0
   OR updated_count IS NULL OR updated_count<0 OR deleted_count IS NULL OR deleted_count<0
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import Source inventory epoch unavailable'; END IF;
  fresh_epoch:=pg_catalog.jsonb_build_object(
   'database_oid',current_db_oid::text,'backend_pid',current_pid::text,'transaction_id',current_xid::text,
   'relation_oid',inventory_oid::text,'relation_filenode',file_node::text,
   'inserted',inserted_count::text,'updated',updated_count::text,'deleted',deleted_count::text);
  IF boundary=1 THEN
   before_epoch:=fresh_epoch;
   SELECT count(*),pg_catalog.jsonb_agg(c.target_shape->'recovery_inventory')
    INTO context_count,context_values FROM custodial_dr.immutable_private_import_context c
    WHERE c.database_oid=current_db_oid AND c.backend_pid=current_pid AND c.transaction_id=current_xid;
   IF context_count=0 THEN
    -- Same full canonical algorithm/order as the original target_shape().
    SELECT pg_catalog.jsonb_build_object(
     'relation','public.custodial_release_authority_restore_inventory','relation_oid',inventory_oid,
     'row_count',count(*)::text,
     'canonical_rowset_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
       coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.restore_order,i.object_kind,i.object_identity,i.inventory_id),'[]'::jsonb)::text,
       'UTF8'),'sha256'),'hex'),'epoch',before_epoch)
     INTO result FROM public.custodial_release_authority_restore_inventory i;
   ELSIF context_count=1 THEN
    result:=context_values->0;
   ELSE
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import Source inventory context changed';
   END IF;
   IF pg_catalog.jsonb_typeof(result) IS DISTINCT FROM 'object'
    OR NOT(result ?& ARRAY['relation','relation_oid','row_count','canonical_rowset_sha256','epoch'])
    OR result-ARRAY['relation','relation_oid','row_count','canonical_rowset_sha256','epoch']<>'{}'::jsonb
    OR pg_catalog.jsonb_typeof(result->'relation') IS DISTINCT FROM 'string'
    OR result->>'relation' IS DISTINCT FROM 'public.custodial_release_authority_restore_inventory'
    OR result->'relation_oid' IS DISTINCT FROM pg_catalog.to_jsonb(inventory_oid)
    OR pg_catalog.jsonb_typeof(result->'row_count') IS DISTINCT FROM 'string'
    OR result->>'row_count' !~ '^[1-9][0-9]*$'
    OR pg_catalog.length(result->>'row_count')>19
    OR (pg_catalog.length(result->>'row_count')=19 AND (result->>'row_count') COLLATE "C" > '9223372036854775807' COLLATE "C")
    OR pg_catalog.jsonb_typeof(result->'canonical_rowset_sha256') IS DISTINCT FROM 'string'
    OR result->>'canonical_rowset_sha256' !~ '^[a-f0-9]{64}$'
    -- Exact equality also closes every epoch key/type/identity/counter.
    OR result->'epoch' IS DISTINCT FROM before_epoch
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import Source inventory original changed'; END IF;
  ELSIF fresh_epoch IS DISTINCT FROM before_epoch THEN
   -- Never rehash/adopt/update a changed original epoch, even at equal counts.
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import Source inventory original changed';
  END IF;
 END LOOP;
 RETURN result;
END $fn$;

-- All DATA schemas remain identity/guard-pinned. The caller consumes ordinary
-- DATA in this same transaction; target bootstrap authority is NOT imported.
CREATE FUNCTION custodial_dr.immutable_import_target_shape()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 WITH selected_relations AS MATERIALIZED (
   SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('public','auth','storage','custodial_release_identity') AND c.relkind IN('r','p','f')
 ),
 relation_column_shapes AS MATERIALIZED (
   SELECT a.attrelid,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
     'notnull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attnum>0 AND NOT a.attisdropped GROUP BY a.attrelid
 ),
 relation_constraint_shapes AS MATERIALIZED (
   SELECT k.conrelid,jsonb_agg(jsonb_build_object('name',k.conname,'valid',k.convalidated,'type',k.contype,
     'definition',pg_get_constraintdef(k.oid,true)) ORDER BY k.conname) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid GROUP BY k.conrelid
 ),
 relation_index_shapes AS MATERIALIZED (
   SELECT i.indrelid,jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_index i ON i.indrelid=c.oid GROUP BY i.indrelid
 ),
 relation_policy_shapes AS MATERIALIZED (
   SELECT p.polrelid,jsonb_agg(to_jsonb(p) ORDER BY p.polname) AS shape
   FROM selected_relations c JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid GROUP BY p.polrelid
 ),
 selected_triggers AS MATERIALIZED (
   SELECT t.* FROM selected_relations c JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid WHERE NOT t.tgisinternal
 ),
 trigger_function_shapes AS MATERIALIZED (
   SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition
   FROM pg_catalog.pg_proc p JOIN (SELECT DISTINCT tgfoid FROM selected_triggers) used ON used.tgfoid=p.oid
 ),
 relation_trigger_shapes AS MATERIALIZED (
   SELECT t.tgrelid,jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,'type',t.tgtype,
     'function_oid',f.oid) ORDER BY t.tgname) AS shape
   FROM selected_triggers t JOIN trigger_function_shapes f ON f.oid=t.tgfoid GROUP BY t.tgrelid
 )
 SELECT jsonb_build_object('database',current_database(),'database_oid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()),
 'owner_contract',jsonb_build_object(
   'operator',(SELECT jsonb_build_object('oid',r.oid,'name',r.rolname,'session_user',session_user,
     'superuser',r.rolsuper,'inherit',r.rolinherit,'create_role',r.rolcreaterole,'create_database',r.rolcreatedb,
     'login',r.rolcanlogin,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
     'connection_limit',r.rolconnlimit,'valid_until',r.rolvaliduntil)
     FROM pg_catalog.pg_roles r WHERE r.rolname=current_user),
   'database_owner',(SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database()),
   'namespaces',(SELECT jsonb_agg(jsonb_build_object('oid',n.oid,'name',n.nspname,'owner',n.nspowner,'acl',n.nspacl)
     ORDER BY n.nspname) FROM pg_catalog.pg_namespace n WHERE n.nspname IN('custodial_dr','custodial_release_identity')),
   'original_relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'schema',n.nspname,'name',c.relname,
     'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
     FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid IN(
       to_regclass('custodial_dr.restore_control'),to_regclass('custodial_dr.restore_manifests'),
       to_regclass('custodial_dr.application_mutation_leases'),
       to_regclass('custodial_release_identity.group_original_creations'),
       to_regclass('custodial_release_identity.employee_message_original_outcomes'))),
   'original_guards',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'identity',p.oid::regprocedure::text,
     'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,
     'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text)
     FROM pg_catalog.pg_proc p WHERE p.oid IN(to_regprocedure('custodial_dr.guard_application_mutation()'),
       to_regprocedure('custodial_release_identity.guard_group_original_creation()'),
       to_regprocedure('public.custodial_feedback_triage_immutable()')))),
 'migration_head',(SELECT max(version)::text FROM supabase_migrations.schema_migrations),
 'release',(SELECT jsonb_agg(jsonb_build_object('release_id',release_id,'backend_commit',backend_commit,'frontend_commit',frontend_commit,
   'migration_head',migration_head,'migration_manifest_sha256',migration_manifest_sha256) ORDER BY release_id)
   FROM public.release_deployment_manifest WHERE status='deployed'),
 -- Current target SOURCE metadata, initialized under the real unexposed
 -- bootstrap fence before begin(). This is NOT its archive-file digest or
 -- proof of initializer provenance. Bind EVERY typed row/field, including
 -- inventory identity/order/captured_at, for each later assert_context().
 'recovery_inventory',custodial_dr.immutable_import_source_inventory_state(),
 'trigger_functions',(SELECT jsonb_agg(jsonb_build_object('oid',f.oid,'definition',f.definition,
   'owner',f.proowner,'acl',f.proacl,'definer',f.prosecdef,'config',f.proconfig) ORDER BY f.oid)
   FROM trigger_function_shapes f),
 'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'schema',c.nspname,'name',c.relname,'owner',c.relowner,
   'kind',c.relkind,'partition',c.relispartition,'persistence',c.relpersistence,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
   'columns',column_shape.shape,'constraints',constraint_shape.shape,'indexes',index_shape.shape,
   'policies',policy_shape.shape,'triggers',trigger_shape.shape)
   ORDER BY c.nspname,c.relname) FROM selected_relations c
   LEFT JOIN relation_column_shapes column_shape ON column_shape.attrelid=c.oid
   LEFT JOIN relation_constraint_shapes constraint_shape ON constraint_shape.conrelid=c.oid
   LEFT JOIN relation_index_shapes index_shape ON index_shape.indrelid=c.oid
   LEFT JOIN relation_policy_shapes policy_shape ON policy_shape.polrelid=c.oid
   LEFT JOIN relation_trigger_shapes trigger_shape ON trigger_shape.tgrelid=c.oid))
$fn$;

CREATE FUNCTION custodial_dr.immutable_import_assert_context()
RETURNS custodial_dr.immutable_private_import_context LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; ctl jsonb;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT * INTO STRICT ctx FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() FOR UPDATE;
 SELECT to_jsonb(c) INTO STRICT ctl FROM custodial_dr.restore_control c WHERE singleton FOR UPDATE;
 IF ctx.phase='FINISHED' OR ctl IS DISTINCT FROM ctx.original_control
   OR NOT (ctl->>'mutations_paused')::boolean OR ctl->>'state'<>'PREPARING'
   OR ctx.target_shape IS DISTINCT FROM custodial_dr.immutable_import_target_shape()
   OR (ctx.original_manifest->>'expires_at')::timestamptz<=clock_timestamp()
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original context changed'; END IF;
 RETURN ctx;
END $fn$;

CREATE FUNCTION custodial_dr.begin_immutable_private_import(restore_id uuid,authority_generation bigint,archive_digest text,original_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctl custodial_dr.restore_control; item jsonb; r record; oid_value oid; table_columns jsonb;
 private_names text[]; affected_names text[]; count_value bigint; target jsonb; field_name text;
 unsupported_insert_guard record;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 LOCK TABLE custodial_dr.application_mutation_leases IN SHARE MODE;
 LOCK TABLE public.release_deployment_manifest,public.custodial_release_authority_restore_inventory,
   supabase_migrations.schema_migrations IN SHARE MODE;
 SELECT * INTO STRICT ctl FROM custodial_dr.restore_control WHERE singleton FOR UPDATE;
 IF NOT ctl.mutations_paused OR ctl.state<>'PREPARING' OR ctl.restore_id IS DISTINCT FROM restore_id
  OR ctl.authority_generation IS DISTINCT FROM authority_generation OR ctl.archive_digest IS DISTINCT FROM archive_digest
  OR NOT EXISTS(SELECT 1 FROM custodial_dr.restore_manifests m WHERE m.restore_id=ctl.restore_id
    AND m.authority_generation=ctl.authority_generation AND m.archive_digest=ctl.archive_digest AND NOT m.database_verified)
  OR jsonb_typeof(original_manifest) IS DISTINCT FROM 'object'
  OR NOT (original_manifest ?& ARRAY['schema','archive_digest','source_identity_sha256','source_project_ref','target_project_ref','actor','expires_at','target_migration_head','target_release_identity','catalog','private_data_members'])
  OR original_manifest-ARRAY['schema','archive_digest','source_identity_sha256','source_project_ref','target_project_ref','actor','expires_at','target_migration_head','target_release_identity','catalog','private_data_members']<>'{}'::jsonb
  OR original_manifest->>'schema'<>'custodial.immutable-private-import-manifest.v1'
  OR original_manifest->>'archive_digest' IS DISTINCT FROM ctl.archive_digest
  OR original_manifest->>'source_project_ref' IS DISTINCT FROM ctl.source_project_ref
  OR original_manifest->>'target_project_ref' IS DISTINCT FROM ctl.target_project_ref
  OR original_manifest->>'actor' IS DISTINCT FROM ctl.started_by
  OR original_manifest->>'source_identity_sha256' !~ '^[a-f0-9]{64}$'
  OR (original_manifest->>'expires_at')::timestamptz<=clock_timestamp()
  OR jsonb_typeof(original_manifest->'catalog') IS DISTINCT FROM 'array'
  OR jsonb_typeof(original_manifest->'private_data_members') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'; END IF;
 FOREACH field_name IN ARRAY ARRAY['schema','archive_digest','source_identity_sha256','source_project_ref','target_project_ref','actor','expires_at','target_migration_head'] LOOP
  IF jsonb_typeof(original_manifest->field_name) IS DISTINCT FROM 'string' OR original_manifest->>field_name=''
   THEN RAISE EXCEPTION 'Immutable import manifest field type invalid'; END IF;
 END LOOP;
 IF jsonb_typeof(original_manifest->'target_release_identity') IS DISTINCT FROM 'object'
  OR jsonb_array_length(original_manifest->'catalog')=0 THEN RAISE EXCEPTION 'Immutable import manifest original target absent'; END IF;
 SELECT array_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname) INTO affected_names
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN('public','auth','storage','custodial_release_identity') AND c.relkind IN('r','p','f');
 IF affected_names IS DISTINCT FROM (SELECT array_agg((v->>'schema_name')||'.'||(v->>'table_name') ORDER BY v->>'schema_name',v->>'table_name')
   FROM jsonb_array_elements(original_manifest->'catalog') v)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import full target catalog mismatch'; END IF;
 SELECT array_agg(v->>'table_name' ORDER BY v->>'table_name') INTO private_names
  FROM jsonb_array_elements(original_manifest->'catalog') v WHERE v->>'schema_name'='custodial_release_identity';
 -- Closed CURRENT guard profiles, NOT silent exclusion of unknown originals.
 IF private_names IS DISTINCT FROM ARRAY['employee_message_original_outcomes','group_original_creations']::text[]
  OR private_names IS DISTINCT FROM (SELECT array_agg(v->>'table_name' ORDER BY v->>'table_name') FROM jsonb_array_elements(original_manifest->'private_data_members') v)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable private guard kind unsupported'; END IF;
 FOR item IN SELECT v FROM jsonb_array_elements(original_manifest->'private_data_members') v LOOP
  FOREACH field_name IN ARRAY ARRAY['schema_name','table_name','row_count','data_file','sha256','bytes','data_encoding'] LOOP
   IF jsonb_typeof(item->field_name) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Immutable import member type invalid'; END IF;
  END LOOP;
  IF jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['schema_name','table_name','row_count','data_file','sha256','bytes','data_encoding'])
   OR item-ARRAY['schema_name','table_name','row_count','data_file','sha256','bytes','data_encoding']<>'{}'::jsonb
   OR item->>'schema_name'<>'custodial_release_identity'
   OR item->>'data_encoding' NOT IN('postgres-json-text-line.v1','postgres-text-columns-line.v2')
   OR item->>'sha256' !~ '^[a-f0-9]{64}$' OR item->>'bytes' !~ '^(0|[1-9][0-9]*)$'
   OR item->>'data_file' IS DISTINCT FROM 'database/custodial_release_identity.'||(item->>'table_name')||'.jsonl'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original_manifest->'catalog') c WHERE c->>'schema_name'=item->>'schema_name'
     AND c->>'table_name'=item->>'table_name' AND c->>'row_count'=item->>'row_count' AND c->>'data_file'=item->>'data_file'
     AND c->>'data_encoding'=item->>'data_encoding') THEN RAISE EXCEPTION 'Immutable import private source member invalid'; END IF;
 END LOOP;
 FOR item IN SELECT v FROM jsonb_array_elements(original_manifest->'catalog') v ORDER BY v->>'schema_name',v->>'table_name' LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'schema_name') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'table_name') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'row_count') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'columns') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'primary_key') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'Immutable import catalog shape invalid'; END IF;
  IF item->>'schema_name' NOT IN('public','auth','storage','custodial_release_identity')
   OR item->>'row_count' !~ '^(0|[1-9][0-9]*)$'
   OR jsonb_typeof(item->'data_encoding') IS DISTINCT FROM 'string'
   OR item->>'data_encoding' NOT IN('postgres-json-text-line.v1','postgres-text-columns-line.v2')
   THEN RAISE EXCEPTION 'Immutable import catalog invalid'; END IF;
  oid_value:=to_regclass(format('%I.%I',item->>'schema_name',item->>'table_name'));
  IF oid_value IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=oid_value AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
   THEN RAISE EXCEPTION 'Immutable import relation kind unsupported'; END IF;
  EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',oid_value::regclass);
  SELECT jsonb_agg(jsonb_build_object('name',a.attname,'data_type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity) ORDER BY a.attnum)
   INTO table_columns FROM pg_catalog.pg_attribute a WHERE a.attrelid=oid_value AND a.attnum>0 AND NOT a.attisdropped;
  IF table_columns IS DISTINCT FROM item->'columns' THEN RAISE EXCEPTION 'Immutable import exact columns changed'; END IF;
  IF coalesce((SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM pg_catalog.pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=oid_value AND i.indisprimary),'[]'::jsonb)
    IS DISTINCT FROM item->'primary_key' THEN RAISE EXCEPTION 'Immutable import original primary key changed'; END IF;
  EXECUTE format('SELECT count(*) FROM ONLY %s',oid_value::regclass) INTO count_value;
  IF item->>'schema_name'='public' AND item->>'table_name'='release_deployment_manifest' THEN
   IF count_value<>1 THEN RAISE EXCEPTION 'Immutable import release bootstrap not exact'; END IF;
  ELSIF item->>'schema_name'='public' AND item->>'table_name'='custodial_release_authority_restore_inventory' THEN
   -- Only the two independently checked guard definitions may differ from
   -- the authenticated original registry; no rows may disappear or be added.
   -- Main's initializer verifies that recipe and the consumer still consumes
   -- this complete original archive member/EOF/digest without inserting it.
   IF count_value=0 OR count_value<>(item->>'row_count')::bigint
    THEN RAISE EXCEPTION 'Immutable import current Source registry bootstrap not exact'; END IF;
  ELSIF count_value<>0 THEN RAISE EXCEPTION 'Immutable import target DATA is not fresh'; END IF;
  -- SOURCE nonempty is not target freshness. Refuse an unsupported ACTUAL
  -- INSERT guard before staging/inserting anything, rather than bypass it.
  -- Only exact Source-pinned statement and row guards composed below may
  -- participate. No generic trigger exception, DDL, UPDATE/DELETE/TRUNCATE
  -- admission or caller-selected function profile is accepted here.
  IF item->>'schema_name'<>'custodial_release_identity' AND (item->>'row_count')::bigint<>0
    AND NOT(item->>'schema_name'='public' AND item->>'table_name' IN('release_deployment_manifest','custodial_release_authority_restore_inventory')) THEN
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=oid_value
     AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='')
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED'; END IF;
   SELECT guard_relation_namespace.nspname::text AS schema_name,guard_relation.relname::text AS table_name,
    t.tgname::text AS trigger_name,t.tgtype::integer AS trigger_type,t.tgenabled::text AS enabled,
    CASE WHEN guard_function.oid IS NOT NULL THEN pg_catalog.left(pg_catalog.format('%I.%I(%s)',
      guard_function_namespace.nspname,guard_function.proname,
      pg_catalog.pg_get_function_identity_arguments(guard_function.oid)),512) END AS function_identity,
    pg_catalog.left(pg_catalog.pg_get_userbyid(guard_function.proowner),63) AS owner_name,
    CASE WHEN guard_function.prokind='f' AND guard_function.prorettype='pg_catalog.trigger'::regtype
      AND guard_function.pronargs=0
     THEN public.static_weekly_digest_text(pg_catalog.pg_get_functiondef(guard_function.oid)) END AS function_sha256
    INTO unsupported_insert_guard
    FROM pg_catalog.pg_trigger t
    LEFT JOIN pg_catalog.pg_class guard_relation ON guard_relation.oid=t.tgrelid
    LEFT JOIN pg_catalog.pg_namespace guard_relation_namespace ON guard_relation_namespace.oid=guard_relation.relnamespace
    LEFT JOIN pg_catalog.pg_proc guard_function ON guard_function.oid=t.tgfoid
    LEFT JOIN pg_catalog.pg_namespace guard_function_namespace ON guard_function_namespace.oid=guard_function.pronamespace
    WHERE t.tgrelid=oid_value
     AND NOT t.tgisinternal AND t.tgenabled IN('O','A') AND (t.tgtype & 4)<>0
     AND NOT(t.tgfoid=to_regprocedure('custodial_dr.guard_application_mutation()') AND t.tgtype=62
       AND (SELECT proowner FROM pg_catalog.pg_proc WHERE oid=t.tgfoid)=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))
     AND NOT EXISTS(
      SELECT 1 FROM (VALUES
       ('public','devices','trg_custodial_offline_device_activation_boundary',21,'public.custodial_record_offline_authority_activation_boundary()',
        '14bde0e8c994bf8b0cb325fe39c6f60dd8531944a8cc766faf921ec2540449be',ARRAY['active']::text[]),
       ('public','ops_manager_push_devices','trg_ops_manager_push_devices_owner',23,'public.ops_manager_notification_validate_owner()',
        'a94e65887e886b4b16163382e7f9cdfa5795a3aed6a2a35db371675a5d2d8cc6',ARRAY[]::text[]),
       ('public','employees','trg_recurring_authority_lock',30,'public.static_weekly_v15_lock_recurring_mutation()',
        '541eba3c620076ef528a3c57c8566d52c741a205f33b898d5e4225470988c850',ARRAY[]::text[]),
       ('public','employees','trg_recurring_authority_generation',29,'public.static_weekly_v15_advance_recurring_generation()',
        'a43c5876d0046de8f2eb55b27aaa347760f2a178ca3608bccdefd9ebfdad155c',ARRAY[]::text[]),
       ('public','events_app_events','trg_app_event_place_admission_guard',23,'public.app_event_place_admission_guard()',
        '2696f90f9a958977887e6d91a94eaf6f413fcda890161d97d7a87fbf56d11a16',ARRAY[]::text[]),
       ('public','events_app_events','trg_app_event_supersession_guard',31,'public.app_event_supersession_guard()',
        'f12f5c47a9c94a2e7a8430a4fa918650bca36d5e560fd057ef1779866754472b',ARRAY[]::text[]),
       ('public','events_app_events','trg_events_app_events_set_end_date',23,'public.events_app_events_set_end_date()',
        '7826e8a15ebaf376a9453ced929d8cd74e28f1d14cae62cc0d89fc55a3702e30',ARRAY['end_date','event_date']::text[]),
       ('public','events_app_events','trg_events_app_validate_scope_venue',23,'public.events_app_validate_scope_venue()',
        'aaf70e693824d8d90e55e1b1708c2f088c15ffe014230dfa0871ae7aef8dcf0d',
        ARRAY['coverage_location_ids','display_location','event_scope','event_timezone','location_group_id','needs_review','parser_confidence','primary_venue_id','staffing_area_ids','venue_ids']::text[]),
       ('public','events_app_events','trg_events_app_zz_needs_review_isolation',23,'public.events_app_isolate_needs_review()',
        '5b5b31f4d3f7f1c96520350c3c078860095e60ff7e490e5e136a6f245953bf72',ARRAY[]::text[]),
       ('public','msg_message_audit','trg_msg_reject_retired_ops_manager_shared_audit_guard',31,'public.msg_reject_retired_ops_manager_shared_message_audit_mutation()',
        '1dd682ce84ef7572ed78f6ec355d7f06036ef2ebc4195e69125b1f980222e692',ARRAY[]::text[]),
       ('public','msg_messages','trg_msg_reject_retired_ops_manager_shared_message_mutation',31,'public.msg_reject_retired_ops_manager_shared_message_mutation()',
        '5bf8519f4297836c0b2f99db47fb8b3e60dbf294786a747413631cfffe8175d6',ARRAY[]::text[]),
       ('public','msg_messages','trg_mz_reject_event_messenger_message',7,'public.mz_reject_event_messenger_message()',
        'ac2257d8e9062cbbf83df46a5cc865fd3cd3d55765c8d3c6e2a201af550e0a07',ARRAY[]::text[]),
       ('public','msg_receipts','trg_msg_reject_retired_ops_manager_shared_receipt_mutation',31,'public.msg_reject_retired_ops_manager_shared_receipt_mutation()',
        'e536858663fb0afdee50da41f05dd209576a01436823bd966860610ea505c6a1',ARRAY[]::text[]),
       ('public','msg_thread_participants','trg_msg_enforce_canonical_active_pair_participants',29,'public.msg_enforce_canonical_active_pair_participants()',
        'aa4cfddd420f816b1fa1a14a350c8ef942ece81521c4de253aba9d08338303c6',ARRAY['left_at','thread_id','user_id']::text[]),
       ('public','msg_threads','trg_msg_enforce_canonical_active_pair_thread',21,'public.msg_enforce_canonical_active_pair_thread()',
        'ab4983eadde2033585c0090578c485eaa5f88d0c19b2ec2bcf1e1c69c9cacaa4',ARRAY['is_active','thread_type']::text[]),
       ('public','msg_threads','trg_msg_preserve_original_group_creation',23,'public.msg_preserve_original_group_creation()',
        '2f344eb3dec0191a707067d3b37a223cb47e1a97cda134cd957fe1964edb6ee0',ARRAY[]::text[]),
       ('public','msg_thread_participants','trg_msg_reject_retired_ops_manager_shared_participation',31,'public.msg_reject_retired_ops_manager_shared_participation()',
        'd8636eae240797ad58aa906fab3c0cd71f451d205a8b34c87910a5b8e7d07fe5',ARRAY[]::text[]),
       ('public','msg_threads','trg_msg_reject_retired_ops_manager_shared_thread_mutation',31,'public.msg_reject_retired_ops_manager_shared_thread_mutation()',
        '1db72f65a7322057cd190f2b019a8383d9523e92b0c62b340264ba5d7f250499',ARRAY[]::text[])
       ,('public','msg_messages','trg_msg_enqueue_background_work',5,'public.msg_enqueue_background_work()',
        '697c62e17d7333004df058159ffa9592c25368aa8575d4b714954f6a4308b9fb',ARRAY[]::text[])
       ,('public','msg_messages','trg_msg_memphis_pre_generate_schedule',5,'public.msg_memphis_pre_generate_schedule()',
        'a32e898e4f0807d85b8ebbf5254a39091380451f6070718c12adbd08f879aff6',ARRAY[]::text[])
       ,('public','msg_messages','trg_msg_message_immutable_audit',5,'public.msg_audit_persisted_message()',
        'ddbfb3e3d17773ad30ce24e2fe8caf7b962b58ecd9e5d6c32e78d5698e840d57',ARRAY[]::text[])
       ,('public','msg_messages','trg_mz_enqueue_employee_message_push',5,'public.mz_enqueue_employee_message_push()',
        'ed86b03776d740a1f75482092a16e76ca75848142982187bf303e73eb567d459',ARRAY[]::text[])
       ,('public','msg_messages','trg_ops_manager_enqueue_message_push',5,'public.ops_manager_enqueue_message_push()',
        '2488028c7f06420255bc3825053b2c0d58c63c43faf99ad5cd779853a19abff1',ARRAY[]::text[])
      ) fixed(schema_name,table_name,trigger_name,trigger_type,function_identity,definition_sha256,update_columns)
      JOIN pg_catalog.pg_proc f ON f.oid=to_regprocedure(fixed.function_identity)
      WHERE fixed.schema_name=item->>'schema_name' AND fixed.table_name=item->>'table_name'
       AND t.tgname=fixed.trigger_name AND t.tgfoid=f.oid AND t.tgtype=fixed.trigger_type
       AND t.tgenabled='O' AND t.tgqual IS NULL AND octet_length(t.tgargs)=0
       AND coalesce((SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(t.tgattr::smallint[]) number(attnum) JOIN pg_catalog.pg_attribute a
        ON a.attrelid=t.tgrelid AND a.attnum=number.attnum),ARRAY[]::text[]) = fixed.update_columns
       AND f.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
       AND public.static_weekly_digest_text(pg_get_functiondef(f.oid))=fixed.definition_sha256
       AND EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
        WHERE i.object_kind='function' AND i.definition_sql=pg_get_functiondef(f.oid)
         AND i.definition_sha256=fixed.definition_sha256))
    ORDER BY t.tgname,t.oid LIMIT 1;
   IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED',
     DETAIL=pg_catalog.left(jsonb_build_object('schema',unsupported_insert_guard.schema_name,
      'table',unsupported_insert_guard.table_name,'trigger',unsupported_insert_guard.trigger_name,
      'function_identity',unsupported_insert_guard.function_identity,'tgtype',unsupported_insert_guard.trigger_type,
      'enabled',unsupported_insert_guard.enabled,'owner',unsupported_insert_guard.owner_name,
      'function_sha256',unsupported_insert_guard.function_sha256)::text,8192);
   END IF;
  END IF;
 END LOOP;
 -- The fresh registry is independently curated Source authority, not a
 -- survivor inventory to adopt or an UPDATE exception. Refuse empty/corrupt
 -- metadata and a stale registered private guard before begin. The mutation
 -- guard belongs to NON-restored custodial_dr, not this archived application
 -- registry. Its Source-exact predecessor/recipe is checked by the initializer
 -- and its complete definition is bound in target_shape.original_guards.
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory)
  OR (SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable'
      AND NOT t.tgisinternal AND t.tgenabled='A' AND t.tgtype=27
      AND t.tgqual IS NULL AND octet_length(t.tgargs)=0
      AND t.tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure)<>1
  OR public.static_weekly_digest_text(pg_get_functiondef('public.custodial_reject_release_authority_inventory_mutation()'::regprocedure))
    IS DISTINCT FROM '7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6'
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
    WHERE i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(i.definition_sql))
  OR EXISTS(SELECT 1 FROM (VALUES
      ('custodial_release_identity.guard_group_original_creation()')) required(identity)
    LEFT JOIN public.custodial_release_authority_restore_inventory i
      ON i.object_kind='function' AND i.object_identity=required.identity
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(required.identity)
    WHERE i.inventory_id IS NULL OR p.oid IS NULL
      OR p.proowner IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      OR i.definition_sql IS DISTINCT FROM pg_get_functiondef(p.oid)
      OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(pg_get_functiondef(p.oid)))
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import current Source registry unavailable or stale'; END IF;
 -- Require exact captured owner/constraints/ACL/RLS/guards, never caller DDL.
 FOR r IN SELECT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='custodial_release_identity' AND c.relkind='r' LOOP
  IF r.relowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) OR NOT r.relrowsecurity OR NOT r.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a WHERE a.grantee<>r.relowner)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped AND (a.attacl IS NOT NULL OR a.attgenerated<>'' OR a.attidentity<>''))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid AND (NOT c.convalidated OR c.contype NOT IN('p','u','c')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=r.oid AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid=i.indexrelid))
   THEN RAISE EXCEPTION 'Immutable import private owner/schema boundary changed'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid)<>(CASE r.relname WHEN 'group_original_creations' THEN 4 ELSE 5 END)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=r.oid AND NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
     WHERE i.object_kind='constraint' AND i.object_identity='custodial_release_identity.'||r.relname||':'||c.conname
       AND i.definition_sql=public.custodial_release_authority_current_constraint_definition(i.object_identity)
       AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql)))
   OR (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=r.oid)<>(CASE r.relname WHEN 'group_original_creations' THEN 1 ELSE 0 END)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=r.oid AND (p.polname<>'group_original_creation_definer_owner'
     OR p.polroles<>ARRAY[r.relowner] OR p.polcmd<>'*' OR NOT p.polpermissive
     OR pg_get_expr(p.polqual,p.polrelid)<>'true' OR pg_get_expr(p.polwithcheck,p.polrelid)<>'true'))
   THEN RAISE EXCEPTION 'Immutable import exact constraints or policy changed'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal)
    <> (CASE r.relname WHEN 'group_original_creations' THEN 2 ELSE 1 END)
   OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal AND
      (t.tgenabled<>'A' OR t.tgqual IS NOT NULL OR octet_length(t.tgargs)<>0 OR NOT EXISTS(
       SELECT 1 FROM public.custodial_release_authority_restore_inventory i JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
       WHERE i.object_kind='function' AND (
         (i.object_identity='custodial_release_identity.guard_group_original_creation()'
          AND f.oid=to_regprocedure('custodial_release_identity.guard_group_original_creation()'))
         OR (i.object_identity IN('public.custodial_feedback_triage_immutable()','custodial_feedback_triage_immutable()')
          AND f.oid=to_regprocedure('public.custodial_feedback_triage_immutable()')))
        AND i.definition_sql=pg_get_functiondef(f.oid)
        AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql) AND f.proowner=r.relowner)))
   THEN RAISE EXCEPTION 'Immutable import ALWAYS/source guard unqualified'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal AND NOT (
      (r.relname='group_original_creations' AND t.tgname='group_original_creation_immutable' AND t.tgtype=31
        AND t.tgfoid='custodial_release_identity.guard_group_original_creation()'::regprocedure)
      OR (r.relname='group_original_creations' AND t.tgname='group_original_creation_no_truncate' AND t.tgtype=34
        AND t.tgfoid='custodial_release_identity.guard_group_original_creation()'::regprocedure)
      OR (r.relname='employee_message_original_outcomes' AND t.tgname='employee_message_original_outcomes_immutable' AND t.tgtype=27
        AND t.tgfoid='public.custodial_feedback_triage_immutable()'::regprocedure)))
   THEN RAISE EXCEPTION 'Immutable import exact ALWAYS scope changed'; END IF;
  -- The exact existing recovery serializers are the supported metadata path.
  IF NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='relation'
    AND i.object_identity='custodial_release_identity.'||r.relname AND i.definition_sql=public.custodial_release_authority_current_relation_definition(i.object_identity)
    AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql))
   OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='column_set'
    AND i.object_identity='custodial_release_identity.'||r.relname AND i.definition_sql=public.custodial_release_authority_current_column_set_definition(i.object_identity))
   OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='relation_state'
    AND i.object_identity='custodial_release_identity.'||r.relname AND i.definition_sql=public.custodial_release_authority_current_relation_state_definition(i.object_identity))
   OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
    AND i.object_identity='custodial_release_identity.'||r.relname AND i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity))
   THEN RAISE EXCEPTION 'Immutable import exact recovery metadata unavailable'; END IF;
 END LOOP;
 target:=custodial_dr.immutable_import_target_shape();
 IF target->>'migration_head' IS DISTINCT FROM original_manifest->>'target_migration_head'
  OR target->'release' IS DISTINCT FROM jsonb_build_array(original_manifest->'target_release_identity')
  OR original_manifest->'target_release_identity' IS DISTINCT FROM ctl.release_identity->'target'
 THEN RAISE EXCEPTION 'Immutable import original target identity changed'; END IF;
 INSERT INTO custodial_dr.immutable_private_import_context VALUES((SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),
  pg_backend_pid(),txid_current(),ctl.restore_id,ctl.authority_generation,ctl.archive_digest,original_manifest,to_jsonb(ctl),target,'STAGING',NULL,NULL);
 RETURN jsonb_build_object('database_oid',target->>'database_oid','backend_pid',pg_backend_pid(),'transaction_id',txid_current()::text,
   'restore_id',ctl.restore_id,'authority_generation',ctl.authority_generation::text,'archive_digest',ctl.archive_digest);
END $fn$;

-- Native typed-text DATA codec. These invoker-only functions do not read or
-- write target rows and mint no context/ACK/effect authority. Use actual row
-- types and native catalog column/type identities, never caller SQL or casts.
CREATE FUNCTION custodial_dr.immutable_import_text_projection(original_record anyelement)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
 SET extra_float_digits=3 SET datestyle='ISO, YMD' SET timezone='UTC'
 SET intervalstyle='postgres' SET bytea_output='hex' AS $fn$
DECLARE relation_oid oid; keys_sql text; values_sql text; image text;
BEGIN
 SELECT c.oid INTO STRICT relation_oid FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.reltype=pg_typeof(original_record)::oid AND c.relkind='r'
   AND c.relpersistence='p' AND NOT c.relispartition
   AND n.nspname IN('public','auth','storage','custodial_release_identity');
 SELECT string_agg(format('%L',a.attname),',' ORDER BY a.attnum),
   string_agg(format('($1).%I::text',a.attname),',' ORDER BY a.attnum)
  INTO keys_sql,values_sql FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped;
 IF keys_sql IS NULL THEN RAISE EXCEPTION 'Immutable text original row type unavailable'; END IF;
 EXECUTE format('SELECT pg_catalog.json_object(ARRAY[%s]::text[],ARRAY[%s]::text[])::text',keys_sql,values_sql)
  INTO STRICT image USING original_record;
 RETURN image;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_text_record(prototype anyelement,original_row_utf8 text)
RETURNS anyelement LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
 SET extra_float_digits=3 SET datestyle='ISO, YMD' SET timezone='UTC'
 SET intervalstyle='postgres' SET bytea_output='hex' AS $fn$
DECLARE decoded ALIAS FOR $0; relation_oid oid; rowtype_oid oid; values_sql text;
BEGIN
 SELECT c.oid,c.reltype INTO STRICT relation_oid,rowtype_oid FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE c.reltype=pg_typeof(prototype)::oid AND c.relkind='r'
   AND c.relpersistence='p' AND NOT c.relispartition
   AND n.nspname IN('public','auth','storage','custodial_release_identity');
 IF original_row_utf8 IS NULL OR json_typeof(original_row_utf8::json) IS DISTINCT FROM 'object'
  OR (SELECT array_agg(k ORDER BY k) FROM json_object_keys(original_row_utf8::json) k)
    IS DISTINCT FROM (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped)
  OR EXISTS(SELECT 1 FROM json_each(original_row_utf8::json) e WHERE json_typeof(e.value) NOT IN('string','null'))
 THEN RAISE EXCEPTION 'Immutable native text original columns mismatch'; END IF;
 SELECT string_agg(format('(($1::json)->>%L)::%s',a.attname,format_type(a.atttypid,a.atttypmod)),',' ORDER BY a.attnum)
  INTO values_sql FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped;
 IF values_sql IS NULL THEN RAISE EXCEPTION 'Immutable text original row type unavailable'; END IF;
 -- Materialize once: expanding a composite must not repeat custom input IO.
 EXECUTE format('WITH decoded AS MATERIALIZED (SELECT ROW(%s)::%s image) SELECT (d.image).* FROM decoded d',
   values_sql,rowtype_oid::regtype) INTO STRICT decoded USING original_row_utf8;
 -- Values are only strings/null, so this comparison cannot round numeric
 -- DATA or normalize a stored JSON column. Reject lossy native input casts.
 IF custodial_dr.immutable_import_text_projection(decoded)::jsonb IS DISTINCT FROM original_row_utf8::jsonb
 THEN RAISE EXCEPTION 'Immutable native text original does not round trip'; END IF;
 RETURN decoded;
END $fn$;

-- Encoding comes ONLY from this backend/transaction's immutable signed
-- catalog. Neither a caller tag nor inspecting row bytes can select a codec.
CREATE FUNCTION custodial_dr.immutable_import_row_encoding(table_oid oid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE encoding text;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR
  (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.immutable_private_import_context'::regclass)
    IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Immutable original codec owner unavailable'; END IF;
 SELECT v->>'data_encoding' INTO STRICT encoding FROM custodial_dr.immutable_private_import_context ctx
  CROSS JOIN LATERAL jsonb_array_elements(ctx.original_manifest->'catalog') v
  JOIN pg_catalog.pg_class c ON c.oid=table_oid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE ctx.database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND ctx.backend_pid=pg_backend_pid() AND ctx.transaction_id=txid_current()
   AND v->>'schema_name'=n.nspname AND v->>'table_name'=c.relname;
 IF encoding IS NULL OR encoding NOT IN('postgres-json-text-line.v1','postgres-text-columns-line.v2')
 THEN RAISE EXCEPTION 'Immutable original codec unsupported'; END IF;
 RETURN encoding;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_decode_record(prototype anyelement,original_row_utf8 text)
RETURNS anyelement LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE decoded ALIAS FOR $0; relation_oid oid;
BEGIN
 SELECT c.oid INTO STRICT relation_oid FROM pg_catalog.pg_class c WHERE c.reltype=pg_typeof(prototype)::oid;
 IF custodial_dr.immutable_import_row_encoding(relation_oid)='postgres-text-columns-line.v2' THEN
  decoded:=custodial_dr.immutable_import_text_record(prototype,original_row_utf8);
 ELSE
  decoded:=pg_catalog.json_populate_record(prototype,original_row_utf8::json);
 END IF;
 RETURN decoded;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_row_projection(original_record anyelement)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE relation_oid oid;
BEGIN
 SELECT c.oid INTO STRICT relation_oid FROM pg_catalog.pg_class c WHERE c.reltype=pg_typeof(original_record)::oid;
 IF custodial_dr.immutable_import_row_encoding(relation_oid)='postgres-text-columns-line.v2' THEN
  RETURN custodial_dr.immutable_import_text_projection(original_record);
 END IF;
 RETURN pg_catalog.row_to_json(original_record)::text;
END $fn$;

-- Trigger-facing exact ordinary DATA match, not admission from a supplied row.
-- No context leaves normal trigger behavior unchanged; an existing invalid
-- context must still refuse through assert_context(), never an exception catch.
CREATE FUNCTION custodial_dr.immutable_import_matches_ordinary_staged(table_oid oid,original_row json)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; checked custodial_dr.immutable_private_import_context;
 staged custodial_dr.immutable_ordinary_import_rows; projection text; matches boolean;
 member jsonb; observed bigint; staged_count bigint; stage_digest text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN RETURN false; END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 IF ctx.phase NOT IN('INSERTING_ORDINARY','INSERTING_ORDINARY_SET') OR table_oid IS DISTINCT FROM ctx.active_table_oid
  OR original_row IS NULL OR json_typeof(original_row)<>'object' THEN RETURN false; END IF;
 IF ctx.phase='INSERTING_ORDINARY_SET' THEN
  SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v,
   pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE c.oid=ctx.active_table_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
    AND n.nspname IN('public','auth','storage')
    AND NOT(n.nspname='public' AND c.relname IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
    AND v->>'schema_name'=n.nspname AND v->>'table_name'=c.relname;
  -- Validate EVERY immutable ordinal, raw hash and typed JSON TEXT, even
  -- after a matching row is found. A digest or one equal row is not a set.
  observed:=0; matches:=false;
  FOR staged IN SELECT s.* FROM custodial_dr.immutable_ordinary_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
    AND s.table_oid=ctx.active_table_oid ORDER BY s.ordinal LOOP
   observed:=observed+1;
   IF staged.ordinal IS DISTINCT FROM observed
    OR staged.original_row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex')
   THEN RETURN false; END IF;
   EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',ctx.active_table_oid::regclass)
    INTO projection USING staged.original_row_utf8;
   IF projection IS DISTINCT FROM staged.typed_original_text THEN RETURN false; END IF;
   IF staged.typed_original_text IS NOT DISTINCT FROM original_row::text THEN matches:=true; END IF;
  END LOOP;
  -- EXACT set-writer recipe: ordinal:originalhash, newline BETWEEN rows,
  -- never a caller hash, jsonb image, deduplicated set or trailing newline.
  SELECT count(*),encode(extensions.digest(convert_to(coalesce(string_agg(s.ordinal::text||':'||s.original_row_sha256,E'\n' ORDER BY s.ordinal),''),'UTF8'),'sha256'),'hex')
   INTO staged_count,stage_digest FROM custodial_dr.immutable_ordinary_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
    AND s.table_oid=ctx.active_table_oid;
  IF observed=0 OR staged_count IS DISTINCT FROM observed
   OR staged_count IS DISTINCT FROM (member->>'row_count')::bigint
   OR stage_digest IS DISTINCT FROM ctx.active_row_sha256 THEN RETURN false; END IF;
  checked:=custodial_dr.immutable_import_assert_context();
  IF checked IS DISTINCT FROM ctx
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable ordinary active original set changed'; END IF;
  -- Membership only. The unchanged one INSERT...RETURNING multiset check
  -- owns multiplicity; equal original rows remain distinct staged ordinals.
  RETURN matches;
 END IF;
 -- The synchronous single-row path appends exactly one immutable ordinal
 -- before transferring phase. Select that one original, not any older equal
 -- hash/row: repeated archived DATA retains its original multiplicity.
 SELECT s.* INTO staged FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=ctx.active_table_oid ORDER BY s.ordinal DESC LIMIT 1;
 IF NOT FOUND THEN RETURN false; END IF;
 IF staged.original_row_sha256 IS DISTINCT FROM ctx.active_row_sha256
  OR staged.original_row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex')
  OR staged.typed_original_text IS DISTINCT FROM original_row::text THEN RETURN false; END IF;
 -- Recompute the target's typed row_to_json TEXT from the untouched raw
 -- original. jsonb would lose ordinary JSON lexical DATA and numeric precision.
 EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',ctx.active_table_oid::regclass)
  INTO projection USING staged.original_row_utf8;
 matches:=projection IS NOT DISTINCT FROM staged.typed_original_text;
 checked:=custodial_dr.immutable_import_assert_context();
 IF checked.phase IS DISTINCT FROM ctx.phase OR checked.active_table_oid IS DISTINCT FROM ctx.active_table_oid
  OR checked.active_row_sha256 IS DISTINCT FROM ctx.active_row_sha256
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable ordinary active original changed'; END IF;
 RETURN matches;
END $fn$;
REVOKE ALL ON FUNCTION custodial_dr.immutable_import_matches_ordinary_staged(oid,json)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader;

-- Only the actual trigger composite reaches the matcher. JSON conversion
-- before this boundary would erase SQL NULL versus stored JSON null.
CREATE FUNCTION custodial_dr.immutable_import_matches_ordinary_record(table_oid oid,new_row anyelement)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN RETURN false; END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=table_oid AND c.reltype=pg_typeof(new_row)::oid)
 THEN RETURN false; END IF;
 RETURN custodial_dr.immutable_import_matches_ordinary_staged(table_oid,
   custodial_dr.immutable_import_row_projection(new_row)::json);
END $fn$;

-- One synchronous invoker-owned original row. Neither table name nor raw JSON
-- creates admission: begin() has already locked the entire exact catalog and
-- proved an empty target under the original owner/control/fence. No client
-- statement runs between the private phase transfer and its fixed INSERT.
CREATE FUNCTION custodial_dr.insert_immutable_ordinary_row(schema_name text,table_name text,original_row_utf8 text,expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; member jsonb; target_oid oid;
 original_projection text; actual_projection text; original_sha256 text;
 columns_sql text; observed bigint; staged_count bigint; staged_last bigint;
 actual_witness jsonb;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 actual_witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM actual_witness
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs'; END IF;
 IF ctx.phase<>'STAGING' OR schema_name NOT IN('public','auth','storage')
  OR (schema_name='public' AND table_name IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
  OR original_row_utf8 IS NULL OR original_row_utf8=''
 THEN RAISE EXCEPTION 'Immutable ordinary original row refused'; END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
  WHERE v->>'schema_name'=schema_name AND v->>'table_name'=table_name;
 target_oid:=to_regclass(format('%I.%I',schema_name,table_name));
 IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable original relation unavailable'; END IF;
 EXECUTE format('SELECT count(*) FROM ONLY %s',target_oid::regclass) INTO observed;
 IF observed>=(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable original row count exceeded'; END IF;
 IF json_typeof(original_row_utf8::json)<>'object' OR
   (SELECT array_agg(k ORDER BY k) FROM json_object_keys(original_row_utf8::json) k) IS DISTINCT FROM
   (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped)
 THEN RAISE EXCEPTION 'Immutable ordinary original columns mismatch'; END IF;
 -- Do NOT cast ordinary JSON columns to jsonb: that both loses lexical DATA
 -- and rejects otherwise valid JSON (for example its escaped zero character).
 -- Compare the SAME typed composite's JSON text without replacing the raw
 -- original INSERT parameter. Column order/type is already catalog-pinned.
 EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',target_oid::regclass)
  INTO original_projection USING original_row_utf8;
 SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO columns_sql FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='';
 IF columns_sql IS NULL THEN RAISE EXCEPTION 'Immutable generated-only original unsupported'; END IF;
 -- A single-row import cannot adopt a separately pre-staged set or an orphan
 -- original. Every earlier immutable ordinal must have its already inserted
 -- target row; the new ordinal is bounded by the original catalog count above.
 SELECT count(*),coalesce(max(s.ordinal),0) INTO staged_count,staged_last
  FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=target_oid;
 IF staged_count<>observed OR staged_last<>observed
 THEN RAISE EXCEPTION 'Immutable ordinary single-row staging differs'; END IF;
 original_sha256:=encode(extensions.digest(convert_to(original_row_utf8,'UTF8'),'sha256'),'hex');
 INSERT INTO custodial_dr.immutable_ordinary_import_rows VALUES(ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid,observed+1,
  original_row_utf8,original_sha256,original_projection);
 PERFORM custodial_dr.immutable_import_assert_context();
 UPDATE custodial_dr.immutable_private_import_context SET phase='INSERTING_ORDINARY',active_table_oid=target_oid,
  active_row_sha256=original_sha256
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 EXECUTE format('INSERT INTO %s AS imported (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) RETURNING custodial_dr.immutable_import_row_projection(imported)',
  target_oid::regclass,columns_sql,columns_sql,target_oid::regclass) INTO STRICT actual_projection USING original_row_utf8;
 IF actual_projection IS DISTINCT FROM original_projection
  THEN RAISE EXCEPTION 'Immutable ordinary original row readback differs'; END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 UPDATE custodial_dr.immutable_private_import_context SET phase='STAGING',active_table_oid=NULL,active_row_sha256=NULL
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 RETURN actual_witness;
END $fn$;

-- Self-referencing ordinary relations require one SQL INSERT statement, not
-- row sorting, deferred constraints or disabled triggers. Stage the complete
-- exact source first; the caller must authenticate its EOF before insertion.
CREATE FUNCTION custodial_dr.stage_immutable_ordinary_row(schema_name text,table_name text,original_row_utf8 text,expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; member jsonb; target_oid oid;
 next_row bigint; projection text; observed bigint;
 actual_witness jsonb;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 actual_witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM actual_witness
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs'; END IF;
 IF ctx.phase<>'STAGING' OR schema_name NOT IN('public','auth','storage')
  OR (schema_name='public' AND table_name IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
  OR original_row_utf8 IS NULL OR original_row_utf8='' THEN RAISE EXCEPTION 'Immutable ordinary staging refused';END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
  WHERE v->>'schema_name'=schema_name AND v->>'table_name'=table_name;
 target_oid:=to_regclass(format('%I.%I',schema_name,table_name));
 IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable original relation unavailable';END IF;
 EXECUTE format('SELECT count(*) FROM ONLY %s',target_oid::regclass) INTO observed;
 IF observed<>0 THEN RAISE EXCEPTION 'Immutable ordinary target is not empty';END IF;
 SELECT count(*)+1 INTO next_row FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=target_oid;
 IF next_row>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable ordinary staged row count exceeded';END IF;
 IF json_typeof(original_row_utf8::json)<>'object' OR
  (SELECT array_agg(k ORDER BY k) FROM json_object_keys(original_row_utf8::json) k) IS DISTINCT FROM
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped)
 THEN RAISE EXCEPTION 'Immutable ordinary original columns mismatch';END IF;
 EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',target_oid::regclass)
  INTO projection USING original_row_utf8;
 INSERT INTO custodial_dr.immutable_ordinary_import_rows VALUES(ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid,next_row,
  original_row_utf8,encode(extensions.digest(convert_to(original_row_utf8,'UTF8'),'sha256'),'hex'),projection);
 PERFORM custodial_dr.immutable_import_assert_context();
 RETURN actual_witness;
END $fn$;

CREATE FUNCTION custodial_dr.insert_staged_immutable_ordinary_table(schema_name text,table_name text,expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; member jsonb; target_oid oid; staged record;
 observed bigint; columns_sql text; projection text; stage_digest text; mismatches bigint;
 actual_witness jsonb;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 actual_witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM actual_witness
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs'; END IF;
 IF ctx.phase<>'STAGING' OR schema_name NOT IN('public','auth','storage')
  OR (schema_name='public' AND table_name IN('release_deployment_manifest','custodial_release_authority_restore_inventory')) THEN RAISE EXCEPTION 'Immutable ordinary set refused';END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
  WHERE v->>'schema_name'=schema_name AND v->>'table_name'=table_name;
 target_oid:=to_regclass(format('%I.%I',schema_name,table_name));
 IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable original relation unavailable';END IF;
 EXECUTE format('SELECT count(*) FROM ONLY %s',target_oid::regclass) INTO observed;
 IF observed<>0 THEN RAISE EXCEPTION 'Immutable ordinary target is not empty';END IF;
 SELECT count(*),encode(extensions.digest(convert_to(coalesce(string_agg(s.ordinal::text||':'||s.original_row_sha256,E'\n' ORDER BY s.ordinal),''),'UTF8'),'sha256'),'hex')
  INTO observed,stage_digest FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=target_oid;
 IF observed<>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable ordinary staged source incomplete';END IF;
 FOR staged IN SELECT s.* FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=target_oid ORDER BY s.ordinal LOOP
  IF staged.original_row_sha256<>encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'Immutable staged original changed';END IF;
  EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',target_oid::regclass)
   INTO projection USING staged.original_row_utf8;
  IF projection IS DISTINCT FROM staged.typed_original_text THEN RAISE EXCEPTION 'Immutable staged typed original changed';END IF;
 END LOOP;
 SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO columns_sql FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='';
 IF columns_sql IS NULL THEN RAISE EXCEPTION 'Immutable generated-only original unsupported';END IF;
 UPDATE custodial_dr.immutable_private_import_context SET phase='INSERTING_ORDINARY_SET',active_table_oid=target_oid,active_row_sha256=stage_digest
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 -- All rows enter one ordinary statement: PostgreSQL checks immediate self
 -- foreign keys against this complete set. Compare typed TEXT multisets to
 -- preserve multiplicity, numeric precision and ordinary JSON lexical DATA.
 EXECUTE format('WITH inserted AS (INSERT INTO %s AS imported (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM custodial_dr.immutable_ordinary_import_rows s CROSS JOIN LATERAL custodial_dr.immutable_import_decode_record(null::%s,s.original_row_utf8) r WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=$4 ORDER BY s.ordinal RETURNING custodial_dr.immutable_import_row_projection(imported) AS image), actual AS (SELECT image,count(*) n FROM inserted GROUP BY image), expected AS (SELECT typed_original_text image,count(*) n FROM custodial_dr.immutable_ordinary_import_rows WHERE database_oid=$1 AND backend_pid=$2 AND transaction_id=$3 AND table_oid=$4 GROUP BY typed_original_text), mismatch AS ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) SELECT count(*) FROM mismatch',
  target_oid::regclass,columns_sql,(SELECT string_agg('r.'||quote_ident(a.attname),',' ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''),target_oid::regclass)
  INTO mismatches USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid;
 IF mismatches<>0 THEN RAISE EXCEPTION 'Immutable ordinary set readback differs';END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 UPDATE custodial_dr.immutable_private_import_context SET phase='STAGING',active_table_oid=NULL,active_row_sha256=NULL
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 RETURN actual_witness;
END $fn$;

CREATE FUNCTION custodial_dr.stage_immutable_private_row(schema_name text,table_name text,original_row_utf8 text,expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; v_table_oid oid; member jsonb; image jsonb; next_row bigint;
 actual_witness jsonb;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 actual_witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM actual_witness
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs'; END IF;
 IF ctx.phase<>'STAGING' OR schema_name<>'custodial_release_identity'
  OR table_name NOT IN('employee_message_original_outcomes','group_original_creations') OR original_row_utf8 IS NULL OR original_row_utf8=''
 THEN RAISE EXCEPTION 'Immutable import stage unsupported'; END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v WHERE v->>'table_name'=table_name;
 v_table_oid:=to_regclass(format('%I.%I',schema_name,table_name));
 SELECT coalesce(max(ordinal),0)+1 INTO next_row FROM custodial_dr.immutable_private_import_rows
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id AND immutable_private_import_rows.table_oid=v_table_oid;
 IF next_row>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable import extra row'; END IF;
 EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r)::jsonb FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',v_table_oid::regclass) INTO image USING original_row_utf8;
 IF json_typeof(original_row_utf8::json)<>'object' OR
   (SELECT array_agg(k ORDER BY k) FROM json_object_keys(original_row_utf8::json) k) IS DISTINCT FROM
   (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table_oid AND a.attnum>0 AND NOT a.attisdropped)
 THEN RAISE EXCEPTION 'Immutable import raw columns mismatch'; END IF;
 INSERT INTO custodial_dr.immutable_private_import_rows VALUES(ctx.database_oid,ctx.backend_pid,ctx.transaction_id,v_table_oid,next_row,original_row_utf8,
  encode(extensions.digest(convert_to(original_row_utf8,'UTF8'),'sha256'),'hex'),image);
 PERFORM custodial_dr.immutable_import_assert_context();
 RETURN actual_witness;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_matches_staged(table_oid oid,new_row jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context;
BEGIN
 -- Ordinary operation outside import is unchanged. No fabricated context.
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND phase='INSERTING') THEN RETURN false; END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 RETURN EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_rows s WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=immutable_import_matches_staged.table_oid AND s.typed_original=new_row
   AND s.original_row_sha256=encode(extensions.digest(convert_to(s.original_row_utf8,'UTF8'),'sha256'),'hex'));
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_matches_private_record(table_oid oid,new_row anyelement)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND phase='INSERTING') THEN RETURN false; END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=table_oid AND c.reltype=pg_typeof(new_row)::oid)
 THEN RETURN false; END IF;
 RETURN custodial_dr.immutable_import_matches_staged(table_oid,
   custodial_dr.immutable_import_row_projection(new_row)::jsonb);
END $fn$;

CREATE FUNCTION custodial_dr.finish_immutable_private_import()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; member jsonb; staged record; columns_sql text; observed bigint; total bigint:=0; typed_again jsonb;
 target_oid oid; staged_count bigint; staged_last bigint; invalid_originals bigint; mismatches bigint;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 IF ctx.phase<>'STAGING' THEN RAISE EXCEPTION 'Immutable import already finished'; END IF;
 -- All ordinary source EOFs/digests were consumed by the authenticated caller
 -- before finish. Also count actual locked target DATA here, never caller
 -- row_count=0 as a freshness or whole-DATA completion witness.
 -- The Source registry is not reinserted, but its count must still equal the
 -- original member count. Its complete current DATA digest is independently
 -- pinned by ctx.target_shape and checked above and after all insertions.
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
   WHERE v->>'schema_name'<>'custodial_release_identity' LOOP
  EXECUTE format('SELECT count(*) FROM ONLY %I.%I',member->>'schema_name',member->>'table_name') INTO observed;
  IF observed<>(CASE WHEN member->>'schema_name'='public' AND member->>'table_name'='release_deployment_manifest'
     THEN 1 ELSE (member->>'row_count')::bigint END)
   THEN RAISE EXCEPTION 'Immutable import actual mixed DATA count changed'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_rows s WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v
     WHERE s.table_oid=to_regclass(format('%I.%I',v->>'schema_name',v->>'table_name'))))
 THEN RAISE EXCEPTION 'Immutable import foreign staged relation refused'; END IF;
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v LOOP
  SELECT count(*) INTO observed FROM custodial_dr.immutable_private_import_rows s WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=to_regclass(format('%I.%I',member->>'schema_name',member->>'table_name'));
  IF observed<>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable import partial staged original'; END IF;
 END LOOP;
 UPDATE custodial_dr.immutable_private_import_context SET phase='INSERTING' WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 FOR staged IN SELECT s.* FROM custodial_dr.immutable_private_import_rows s WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id ORDER BY s.table_oid,s.ordinal LOOP
  PERFORM custodial_dr.immutable_import_assert_context();
  IF staged.original_row_sha256<>encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'Immutable import original raw changed'; END IF;
  EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r)::jsonb FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',staged.table_oid::regclass) INTO typed_again USING staged.original_row_utf8;
  IF typed_again IS DISTINCT FROM staged.typed_original THEN RAISE EXCEPTION 'Immutable import typed original changed'; END IF;
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO columns_sql FROM pg_catalog.pg_attribute a WHERE a.attrelid=staged.table_oid AND a.attnum>0 AND NOT a.attisdropped;
  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text)',staged.table_oid::regclass,columns_sql,columns_sql,staged.table_oid::regclass) USING staged.original_row_utf8;
  total:=total+1;
 END LOOP;
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v LOOP
  EXECUTE format('SELECT count(*) FROM ONLY %I.%I',member->>'schema_name',member->>'table_name') INTO observed;
  IF observed<>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Immutable import actual inserted count changed'; END IF;
 END LOOP;
 -- Only now, AFTER every private INSERT and its triggers, compare complete
 -- locked target DATA. Earlier per-row/readback counts cannot detect a later
 -- same-cardinality cross-table change. No staged original may be ignored.
 PERFORM custodial_dr.immutable_import_assert_context();
 IF EXISTS(SELECT 1 FROM custodial_dr.immutable_ordinary_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
      WHERE v->>'schema_name'<>'custodial_release_identity'
       AND NOT(v->>'schema_name'='public' AND v->>'table_name' IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
       AND s.table_oid=to_regclass(format('%I.%I',v->>'schema_name',v->>'table_name'))))
  OR EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v
      WHERE s.table_oid=to_regclass(format('%I.%I',v->>'schema_name',v->>'table_name'))))
 THEN RAISE EXCEPTION 'Immutable import foreign final staged relation refused'; END IF;
 -- Check before the first ordinary read. Each member's terminal check below
 -- also guards the next member: only fixed jsonb loop traversal and qualified
 -- relation-name selection intervene. Keep EVERY post-conversion check;
 -- begin pins type names, not a closed set of type input/output functions.
 PERFORM custodial_dr.immutable_import_assert_context();
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
   WHERE v->>'schema_name'<>'custodial_release_identity'
    AND NOT(v->>'schema_name'='public' AND v->>'table_name' IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
    AND NOT(v->>'row_count'='0' AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=v->>'schema_name' AND c.relname=v->>'table_name'
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)) LOOP
  target_oid:=to_regclass(format('%I.%I',member->>'schema_name',member->>'table_name'));
  IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable ordinary final relation unavailable'; END IF;
  -- Unique positive ordinals with count=max imply exactly 1..count, including
  -- the empty case. Recompute from untouched raw JSON, NEVER through jsonb.
  EXECUTE format('SELECT count(*),coalesce(max(s.ordinal),0),count(*) FILTER (WHERE s.original_row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(s.original_row_utf8,''UTF8''),''sha256''),''hex'') OR convert_to(custodial_dr.immutable_import_row_projection(r),''UTF8'') IS DISTINCT FROM convert_to(s.typed_original_text,''UTF8'')) FROM custodial_dr.immutable_ordinary_import_rows s CROSS JOIN LATERAL custodial_dr.immutable_import_decode_record(null::%s,s.original_row_utf8) r WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=$4',
   target_oid::regclass) INTO staged_count,staged_last,invalid_originals USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid;
  IF staged_count<>(member->>'row_count')::bigint OR staged_last<>staged_count OR invalid_originals<>0
   THEN RAISE EXCEPTION 'Immutable ordinary final staged originals differ'; END IF;
  -- UTF8 bytea equality and EXCEPT ALL bind exact typed TEXT/multiplicity,
  -- independent of collation; no sorted identities or normalized JSON image.
  EXECUTE format('WITH actual AS (SELECT convert_to(custodial_dr.immutable_import_row_projection(r),''UTF8'') AS image FROM ONLY %s r), expected AS (SELECT convert_to(s.typed_original_text,''UTF8'') AS image FROM custodial_dr.immutable_ordinary_import_rows s WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=$4), mismatch AS ((SELECT image FROM actual EXCEPT ALL SELECT image FROM expected) UNION ALL (SELECT image FROM expected EXCEPT ALL SELECT image FROM actual)) SELECT count(*) FROM mismatch',
   target_oid::regclass) INTO mismatches USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid;
  IF mismatches<>0 THEN RAISE EXCEPTION 'Immutable ordinary final DATA multiset differs'; END IF;
  PERFORM custodial_dr.immutable_import_assert_context();
 END LOOP;
 -- Run after all ordinary conversions/policy-bearing reads, not before them:
 -- never carry an empty-DATA verdict across those possible callbacks.
 -- A zero in the immutable manifest is NOT an empty-target witness. First
 -- prove no staged row/ordinal exists for the whole count-only subset. This
 -- staging relation is forced-RLS: keep its own full before/after boundary.
 PERFORM custodial_dr.immutable_import_assert_context();
 SELECT count(*),coalesce(max(s.ordinal),0) INTO staged_count,staged_last
  FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
    JOIN pg_catalog.pg_class c ON c.oid=s.table_oid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE v->>'schema_name'<>'custodial_release_identity' AND v->>'row_count'='0'
     AND NOT(v->>'schema_name'='public' AND v->>'table_name' IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
     AND n.nspname=v->>'schema_name' AND c.relname=v->>'table_name'
     AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
     AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity);
 IF staged_count<>0 OR staged_last<>0 THEN RAISE EXCEPTION 'Immutable ordinary final staged originals differ'; END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 -- Begin holds ACCESS EXCLUSIVE locks on these exact ordinary-table OIDs.
 -- ONLY excludes inheritance; both RLS flags must be false, regardless of
 -- role. These target counts perform no row conversion or policy evaluation.
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
   WHERE v->>'schema_name'<>'custodial_release_identity' AND v->>'row_count'='0'
    AND NOT(v->>'schema_name'='public' AND v->>'table_name' IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=v->>'schema_name' AND c.relname=v->>'table_name'
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) LOOP
  target_oid:=to_regclass(format('%I.%I',member->>'schema_name',member->>'table_name'));
  IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable ordinary final relation unavailable'; END IF;
  EXECUTE format('SELECT count(*) FROM ONLY %I.%I',member->>'schema_name',member->>'table_name') INTO observed;
  IF observed<>0 THEN RAISE EXCEPTION 'Immutable ordinary final DATA multiset differs'; END IF;
 END LOOP;
 PERFORM custodial_dr.immutable_import_assert_context();
 -- Keep private typed_original checks, but do NOT use jsonb equality for
 -- final DATA: derive typed row_to_json TEXT from untouched raw once more.
 -- Its UTF8 bytes preserve numeric/JSON lexical distinctions after triggers.
 FOR member IN SELECT v FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') v LOOP
  PERFORM custodial_dr.immutable_import_assert_context();
  target_oid:=to_regclass(format('%I.%I',member->>'schema_name',member->>'table_name'));
  IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable private final relation unavailable'; END IF;
  EXECUTE format('SELECT count(*),coalesce(max(s.ordinal),0),count(*) FILTER (WHERE s.original_row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(s.original_row_utf8,''UTF8''),''sha256''),''hex'') OR custodial_dr.immutable_import_row_projection(r)::jsonb IS DISTINCT FROM s.typed_original) FROM custodial_dr.immutable_private_import_rows s CROSS JOIN LATERAL custodial_dr.immutable_import_decode_record(null::%s,s.original_row_utf8) r WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=$4',
   target_oid::regclass) INTO staged_count,staged_last,invalid_originals USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid;
  IF staged_count<>(member->>'row_count')::bigint OR staged_last<>staged_count OR invalid_originals<>0
   THEN RAISE EXCEPTION 'Immutable private final staged originals differ'; END IF;
  EXECUTE format('WITH actual AS (SELECT convert_to(custodial_dr.immutable_import_row_projection(r),''UTF8'') AS image FROM ONLY %s r), expected AS (SELECT convert_to(custodial_dr.immutable_import_row_projection(r),''UTF8'') AS image FROM custodial_dr.immutable_private_import_rows s CROSS JOIN LATERAL custodial_dr.immutable_import_decode_record(null::%s,s.original_row_utf8) r WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=$4), mismatch AS ((SELECT image FROM actual EXCEPT ALL SELECT image FROM expected) UNION ALL (SELECT image FROM expected EXCEPT ALL SELECT image FROM actual)) SELECT count(*) FROM mismatch',
   target_oid::regclass,target_oid::regclass) INTO mismatches USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid;
  IF mismatches<>0 THEN RAISE EXCEPTION 'Immutable private final DATA multiset differs'; END IF;
  PERFORM custodial_dr.immutable_import_assert_context();
 END LOOP;
 PERFORM custodial_dr.immutable_import_assert_context();
 UPDATE custodial_dr.immutable_private_import_context SET phase='FINISHED' WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 RETURN jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,'transaction_id',ctx.transaction_id::text,
   'restore_id',ctx.restore_id,'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest,
   'private_rows',total::text,'transaction_authority',false,'admission_resumed',false);
END $fn$;

-- Guard patch is source-exact and requires the actual original owner.
DO $guard$
DECLARE before text; after text; old_clause text; new_clause text;
BEGIN
 IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='custodial_release_identity.guard_group_original_creation()'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original group owner differs; original object owner required'; END IF;
 SELECT pg_get_functiondef('custodial_release_identity.guard_group_original_creation()'::regprocedure) INTO before;
 old_clause:=E'      and t.original_group_creation=NEW.original_tuple) then';
 new_clause:=E'      and t.original_group_creation=NEW.original_tuple)\n    and not custodial_dr.immutable_import_matches_private_record(TG_RELID,NEW) then';
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='custodial_release_identity.guard_group_original_creation()'::regprocedure))
    <>'29708f9ca161950f4e3b4b71b2e7dd85b2f31a6031407a353635713678a3386f'
  OR (length(before)-length(replace(before,old_clause,'')))<>length(old_clause)
 THEN RAISE EXCEPTION 'Original group guard predecessor differs'; END IF;
 -- Parenthesize to keep recipient checks unconditional; only missing live
 -- public-group requirement gains the private SAME staged row alternative.
 after:=replace(before,E'    or not exists(select 1 from public.msg_threads t where t.id=NEW.group_uuid',E'    or (not exists(select 1 from public.msg_threads t where t.id=NEW.group_uuid');
 after:=replace(after,old_clause,replace(new_clause,' then',') then'));
 EXECUTE after;
 -- Main's fenced fresh-metadata initializer must INSERT the independently
 -- checked current Source registration before begin(). NEVER update an
 -- existing registry row or disable its ALWAYS guard; no RLS/ACL changed.
END $guard$;

-- Compose ONLY the original statement INSERT fence. Its definer/owner/ACL and
-- all normal paused admission remain unchanged. This local proposal is still
-- unactivated; Main must initialize its independently checked fresh Source
-- registration and qualify real owner/target/transaction behavior before use.
DO $ordinary_guard$
DECLARE before text; after text; old_clause text; new_clause text;
BEGIN
 IF (SELECT proowner FROM pg_catalog.pg_proc WHERE oid='custodial_dr.guard_application_mutation()'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original application fence owner differs; original object owner required'; END IF;
 SELECT pg_get_functiondef('custodial_dr.guard_application_mutation()'::regprocedure) INTO before;
 old_clause:=E'  perform custodial_dr.acquire_application_mutation_fence();';
 new_clause:=E'  if TG_OP = ''INSERT'' and TG_LEVEL = ''STATEMENT'' and TG_WHEN = ''BEFORE''\n'
  ||E'    and current_user = session_user\n'
  ||E'    and (select oid from pg_catalog.pg_roles where rolname = session_user)\n'
  ||E'      = (select relowner from pg_catalog.pg_class where oid = ''custodial_dr.restore_control''::regclass)\n'
  ||E'    and exists (select 1 from custodial_dr.immutable_private_import_context c\n'
  ||E'      where c.database_oid = (select oid from pg_catalog.pg_database where datname = current_database())\n'
  ||E'        and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()\n'
  ||E'        and c.phase in (''INSERTING_ORDINARY'',''INSERTING_ORDINARY_SET'') and c.active_table_oid = TG_RELID\n'
  ||E'        and c.active_row_sha256 ~ ''^[a-f0-9]{64}$'') then\n'
  ||E'    perform custodial_dr.immutable_import_assert_context();\n'
  ||E'    return null;\n'
  ||E'  end if;\n' || old_clause;
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='custodial_dr.guard_application_mutation()'::regprocedure))
    <>'aba484a103212b76c82f119ece6279c917fce4b0806e07381ef4fce527a9bc95'
  OR (length(before)-length(replace(before,old_clause,'')))<>length(old_clause)
 THEN RAISE EXCEPTION 'Original application fence predecessor differs'; END IF;
 after:=replace(before,old_clause,new_clause);
 EXECUTE after;
END $ordinary_guard$;

-- Refuse default privileges rather than leaving any runtime path exposed.
DO $acl$
DECLARE f record; a record;
BEGIN
 FOR f IN SELECT c.oid,c.relowner FROM pg_catalog.pg_class c WHERE c.oid IN('custodial_dr.immutable_private_import_context'::regclass,'custodial_dr.immutable_private_import_rows'::regclass,'custodial_dr.immutable_ordinary_import_rows'::regclass) LOOP
  FOR a IN SELECT grantee FROM aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class WHERE oid=f.oid),acldefault('r',f.relowner))) WHERE grantee<>f.relowner LOOP
   EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',f.oid::regclass,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_owner_fence','immutable_import_target_shape','immutable_import_assert_context',
    'immutable_import_context_source_immutable','immutable_import_source_inventory_state',
    'immutable_import_text_projection','immutable_import_text_record','immutable_import_row_encoding',
    'immutable_import_decode_record','immutable_import_row_projection',
    'immutable_import_matches_ordinary_record','immutable_import_matches_private_record',
    'begin_immutable_private_import','insert_immutable_ordinary_row','stage_immutable_ordinary_row','insert_staged_immutable_ordinary_table','stage_immutable_private_row','immutable_import_matches_staged','immutable_import_matches_ordinary_staged','finish_immutable_private_import','immutable_import_staged_rows_immutable') LOOP
  FOR a IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=f.oid),acldefault('f',f.proowner))) WHERE grantee<>f.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.oid::regprocedure,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
 END LOOP;
END $acl$;
COMMIT;
