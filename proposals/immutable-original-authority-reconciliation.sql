-- SOURCE PROPOSAL ONLY; no migration/activation or runtime grant is included.
-- Install as the SAME original restore-control object owner, AFTER the base
-- immutable import proposal, BEFORE begin_immutable_private_import().
-- Main must independently review/install these TWO closed integrations:
-- (1) immutable_import_target_shape() adds the fixed property
--     'authority_reconciliation',custodial_dr.immutable_original_authority_scope_shape()
--     BEFORE the original import seals target_shape. Missing binding REFUSES.
-- (2) In the existing guard_application_mutation(), BEFORE the unchanged
--     acquire_application_mutation_fence() call, add ONLY:
--   IF TG_WHEN='BEFORE' AND TG_LEVEL='STATEMENT' AND TG_NARGS=0
--    AND TG_NAME='custodial_disaster_restore_mutation_fence'
--    AND TG_OP IN('UPDATE','DELETE')
--    AND custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP)
--   THEN RETURN NULL; END IF;
-- This file DOES NOT edit that definer/normal guard or its INSERT allowance.
-- Main's private same-native-client COMMIT_ACKNOWLEDGED factory must complete
-- private+ordinary+Storage original DATA readback and current intent/Source
-- checks under its existing fences before the ONE call below. Expected scalar
-- witness arguments are comparisons, NEVER a JSON/caller capability.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $owner$
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR
  (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.restore_control'::regclass)
   IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority scope creator differs'; END IF;
END $owner$;

-- Non-restored operation-local scope + consumed record. No open/begin/reset
-- API exists. A completed original cannot get another scope in any later xid.
CREATE TABLE custodial_dr.immutable_original_authority_scopes(
 database_oid oid NOT NULL, backend_pid integer NOT NULL CHECK(backend_pid>0),
 transaction_id bigint NOT NULL CHECK(transaction_id>0),
 original_transaction_id bigint NOT NULL CHECK(original_transaction_id>0 AND original_transaction_id<>transaction_id),
 restore_id uuid NOT NULL, authority_generation bigint NOT NULL CHECK(authority_generation>0),
 archive_digest text NOT NULL CHECK(length(archive_digest)=64 AND archive_digest ~ '^[a-f0-9]{64}$'),
 owner_oid oid NOT NULL, original_snapshot jsonb NOT NULL CHECK(jsonb_typeof(original_snapshot)='object'),
 phase text NOT NULL CHECK(phase IN('RUNNING','CONSUMED')),
 completed_step smallint NOT NULL CHECK(completed_step BETWEEN 0 AND 6),
 active_table_oid oid, counts jsonb NOT NULL CHECK(jsonb_typeof(counts)='object'), result jsonb,
 CHECK((phase='RUNNING' AND result IS NULL) OR
       (phase='CONSUMED' AND completed_step=6 AND active_table_oid IS NULL AND jsonb_typeof(result)='object')),
 PRIMARY KEY(database_oid,backend_pid,transaction_id), UNIQUE(restore_id,authority_generation)
);
ALTER TABLE custodial_dr.immutable_original_authority_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_dr.immutable_original_authority_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_dr.immutable_original_authority_scopes FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader;
DO $policy$
DECLARE creator oid; predicate text;
BEGIN
 SELECT oid INTO STRICT creator FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF current_user<>session_user OR creator IS DISTINCT FROM
  (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.restore_control'::regclass)
  OR creator IS DISTINCT FROM
  (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.immutable_original_authority_scopes'::regclass)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority policy creator differs'; END IF;
 predicate:=format('current_user=session_user AND current_user=%L AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)=%L::oid',current_user,creator::text);
 EXECUTE format('CREATE POLICY immutable_original_authority_owner ON custodial_dr.immutable_original_authority_scopes FOR ALL TO %I USING (%s) WITH CHECK (%s)',current_user,predicate,predicate);
END $policy$;

CREATE FUNCTION custodial_dr.immutable_original_authority_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE expected_oid oid; key_name text; expected_result jsonb;
BEGIN
 IF current_user<>session_user OR TG_RELID<>'custodial_dr.immutable_original_authority_scopes'::regclass
  OR TG_TABLE_SCHEMA<>'custodial_dr' OR TG_TABLE_NAME<>'immutable_original_authority_scopes'
  OR TG_WHEN<>'BEFORE' OR TG_NARGS<>0
  OR TG_NAME NOT IN('immutable_original_authority_scope_immutable','immutable_original_authority_scope_no_truncate')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority scope mutation refused'; END IF;
 IF TG_OP='DELETE' OR TG_OP='TRUNCATE' OR TG_LEVEL<>'ROW' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority scope cannot be removed'; END IF;
 IF NEW.database_oid IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
  OR NEW.backend_pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
  OR NEW.transaction_id IS DISTINCT FROM pg_catalog.txid_current()
  OR NEW.owner_oid IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR NEW.owner_oid IS DISTINCT FROM (SELECT relowner FROM pg_catalog.pg_class WHERE oid=TG_RELID)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority scope owner or transaction differs'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.phase='RUNNING' AND NEW.completed_step=0 AND NEW.active_table_oid IS NULL
   AND NEW.counts='{}'::jsonb AND NEW.result IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_OP='UPDATE' AND OLD.phase='RUNNING' THEN
  IF ROW(NEW.database_oid,NEW.backend_pid,NEW.transaction_id,NEW.original_transaction_id,
    NEW.restore_id,NEW.authority_generation,NEW.archive_digest,NEW.owner_oid,NEW.original_snapshot)
   IS DISTINCT FROM ROW(OLD.database_oid,OLD.backend_pid,OLD.transaction_id,OLD.original_transaction_id,
    OLD.restore_id,OLD.authority_generation,OLD.archive_digest,OLD.owner_oid,OLD.original_snapshot)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority source cannot be replaced'; END IF;
  expected_oid:=CASE OLD.completed_step+1
   WHEN 1 THEN 'public.device_auth_credentials'::regclass WHEN 2 THEN 'public.device_auth_enrollment_codes'::regclass
   WHEN 3 THEN 'public.ops_manager_push_devices'::regclass WHEN 4 THEN 'public.ops_manager_enrollment_codes'::regclass
   WHEN 5 THEN 'public.ops_manager_trusted_devices'::regclass WHEN 6 THEN 'auth.sessions'::regclass END;
  key_name:=CASE OLD.completed_step+1 WHEN 1 THEN 'employee_credentials' WHEN 2 THEN 'employee_enrollment'
   WHEN 3 THEN 'manager_push' WHEN 4 THEN 'manager_enrollment' WHEN 5 THEN 'manager_credentials' WHEN 6 THEN 'auth_sessions' END;
  -- Arm only the next fixed statement, then close it before arming another.
  IF NEW.phase='RUNNING' AND NEW.result IS NULL AND OLD.active_table_oid IS NULL
   AND OLD.completed_step<6 AND NEW.completed_step=OLD.completed_step
   AND NEW.active_table_oid=expected_oid AND NEW.counts=OLD.counts THEN RETURN NEW; END IF;
  IF NEW.phase='RUNNING' AND NEW.result IS NULL AND OLD.active_table_oid=expected_oid
   AND NEW.active_table_oid IS NULL AND NEW.completed_step=OLD.completed_step+1
   AND jsonb_typeof(NEW.counts->key_name)='string'
   AND NEW.counts->>key_name ~ '^(0|[1-9][0-9]*)$' AND length(NEW.counts->>key_name)<=19
   AND (NEW.counts->>key_name)::numeric<=9223372036854775807
   AND NEW.counts=OLD.counts||jsonb_build_object(key_name,NEW.counts->key_name)
  THEN RETURN NEW; END IF;
  expected_result:=jsonb_build_object('database_oid',OLD.database_oid::text,'backend_pid',OLD.backend_pid,
   'transaction_id',OLD.transaction_id::text,'original_transaction_id',OLD.original_transaction_id::text,
   'restore_id',OLD.restore_id,'authority_generation',OLD.authority_generation::text,'archive_digest',OLD.archive_digest,
   'state','CONSUMED_PAUSED','revocations',OLD.counts);
  IF OLD.completed_step=6 AND OLD.active_table_oid IS NULL AND NEW.phase='CONSUMED'
   AND NEW.completed_step=6 AND NEW.active_table_oid IS NULL AND NEW.counts=OLD.counts
   AND NEW.result=expected_result THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority scope transition refused';
END $fn$;
CREATE TRIGGER immutable_original_authority_scope_immutable BEFORE INSERT OR UPDATE OR DELETE
 ON custodial_dr.immutable_original_authority_scopes FOR EACH ROW EXECUTE FUNCTION custodial_dr.immutable_original_authority_scope_guard();
CREATE TRIGGER immutable_original_authority_scope_no_truncate BEFORE TRUNCATE
 ON custodial_dr.immutable_original_authority_scopes FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.immutable_original_authority_scope_guard();
ALTER TABLE custodial_dr.immutable_original_authority_scopes ENABLE ALWAYS TRIGGER immutable_original_authority_scope_immutable;
ALTER TABLE custodial_dr.immutable_original_authority_scopes ENABLE ALWAYS TRIGGER immutable_original_authority_scope_no_truncate;

-- Exact fresh catalog DATA, sealed only by Main's extended original import
-- target_shape. Not a target-derived replacement for the archived Source.
CREATE FUNCTION custodial_dr.immutable_original_authority_scope_shape()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT jsonb_build_object('relation',(SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,
  'kind',c.relkind,'persistence',c.relpersistence,'partition',c.relispartition,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
  'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notnull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl) ORDER BY a.attnum)
   FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid,true) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
  'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
  'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,
   'function_oid',t.tgfoid) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
  FROM pg_catalog.pg_class c WHERE c.oid='custodial_dr.immutable_original_authority_scopes'::regclass),
 'import_ancestry',jsonb_build_object('relation',(SELECT jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,
   'kind',c.relkind,'persistence',c.relpersistence,'partition',c.relispartition,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
     'notnull',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid,true) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
   'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
   'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
   'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,
     'function_oid',t.tgfoid) ORDER BY t.tgname) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
   FROM pg_catalog.pg_class c WHERE c.oid='custodial_dr.immutable_private_import_context'::regclass),
  'function',(SELECT jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,
    'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'parallel',p.proparallel)
    FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('custodial_dr.immutable_import_context_source_immutable()'))),
 -- Seal the actual DATA decoding types before the original import begins.
 -- A successful earlier RO comparator is not permission to invoke changed
 -- enum labels, owners or I/O functions in a later RW transaction. This
 -- catalog fingerprint is currentness DATA, never an original type allowlist.
 'data_types',(WITH RECURSIVE used_types(oid) AS (
   SELECT DISTINCT a.atttypid FROM pg_catalog.pg_attribute a
   JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('public','auth','storage','custodial_release_identity')
    AND c.relkind IN('r','p','f') AND a.attnum>0 AND NOT a.attisdropped
   UNION
   SELECT dependency.oid FROM used_types u JOIN pg_catalog.pg_type t ON t.oid=u.oid
   CROSS JOIN LATERAL (SELECT t.typelem oid WHERE t.typelem<>0
    UNION SELECT t.typbasetype WHERE t.typbasetype<>0
    UNION SELECT r.rngsubtype FROM pg_catalog.pg_range r WHERE r.rngtypid=t.oid) dependency
  ) SELECT jsonb_agg(jsonb_build_object('type',to_jsonb(t),'namespace',to_jsonb(n),
   'owner',(SELECT to_jsonb(r) FROM pg_catalog.pg_roles r WHERE r.oid=t.typowner),
   'namespace_owner',(SELECT to_jsonb(r) FROM pg_catalog.pg_roles r WHERE r.oid=n.nspowner),
   'enum_labels',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.enumsortorder,e.oid) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid),
   'io',(SELECT jsonb_agg(jsonb_build_object('procedure',to_jsonb(p),'definition',pg_get_functiondef(p.oid),
      'namespace',to_jsonb(pn),'language',to_jsonb(l),
      'owner',(SELECT to_jsonb(r) FROM pg_catalog.pg_roles r WHERE r.oid=p.proowner)) ORDER BY p.oid)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
     JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid IN(t.typinput,t.typoutput,t.typreceive,t.typsend)))
    ORDER BY n.nspname,t.typname,t.oid)
   FROM used_types u JOIN pg_catalog.pg_type t ON t.oid=u.oid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace),
 -- Pure typed-text recipes are a new dependency of the later RW comparison.
 -- Seal their complete native metadata (including overloads) alongside the
 -- original types, not just the earlier RO reader's success or function names.
 'text_codecs',(SELECT jsonb_agg(jsonb_build_object('procedure',to_jsonb(p),'definition',pg_get_functiondef(p.oid),
   'namespace',to_jsonb(n),'language',to_jsonb(l),
   'owner',(SELECT to_jsonb(r) FROM pg_catalog.pg_roles r WHERE r.oid=p.proowner)) ORDER BY p.proname,p.oid)
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_text_projection','immutable_import_text_record')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
  'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'parallel',p.proparallel) ORDER BY p.oid)
  FROM pg_catalog.pg_proc p WHERE p.oid IN(
   to_regprocedure('custodial_dr.immutable_original_authority_scope_guard()'),
   to_regprocedure('custodial_dr.immutable_original_authority_scope_shape()'),
   to_regprocedure('custodial_dr.immutable_original_authority_snapshot(bigint)'),
   to_regprocedure('custodial_dr.immutable_original_authority_guard_matches(oid,text)'),
   to_regprocedure('custodial_dr.reconcile_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)'),
   to_regprocedure('custodial_dr.read_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)'))))
$fn$;

CREATE FUNCTION custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; ctl custodial_dr.restore_control;
 manifest custodial_dr.restore_manifests; event custodial_dr.restore_events;
 db_oid oid; actor_oid oid; source jsonb; old_inventory jsonb; fresh_inventory jsonb; scope_shape jsonb; r record;
 imported jsonb; expected_database jsonb; expected_event jsonb; private_rows bigint; table_count bigint; row_count bigint;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT oid INTO STRICT db_oid FROM pg_catalog.pg_database WHERE datname=current_database();
 SELECT oid INTO STRICT actor_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF current_user<>session_user OR actor_oid IS DISTINCT FROM
   (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.restore_control'::regclass)
  OR actor_oid IS DISTINCT FROM (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.immutable_original_authority_scopes'::regclass)
  OR current_setting('transaction_read_only')<>'off' OR current_setting('transaction_isolation') NOT IN('repeatable read','serializable')
  OR current_setting('session_replication_role')<>'origin' OR current_setting('row_security')<>'off'
  OR current_setting('search_path')<>'pg_catalog, pg_temp' OR (pg_catalog.current_schemas(true))[1]<>'pg_catalog'
  OR p_original_transaction_id IS NULL OR p_original_transaction_id<=0 OR p_original_transaction_id=pg_catalog.txid_current()
  OR EXISTS(SELECT 1 FROM custodial_dr.application_mutation_leases)
  OR (SELECT count(*) FROM unnest(ARRAY['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
    WHERE EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='advisory' AND l.database=db_oid
     AND l.pid=pg_catalog.pg_backend_pid() AND l.granted AND l.mode='ExclusiveLock' AND l.objsubid=1
     AND l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
     AND l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid))<>2
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='relation' AND l.database=db_oid
    AND l.pid=pg_catalog.pg_backend_pid() AND l.relation='public.custodial_release_authority_restore_inventory'::regclass
    AND l.granted AND l.mode IN('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority owner transaction unavailable'; END IF;
 FOR r IN SELECT * FROM (VALUES('auth.sessions'),('public.device_auth_credentials'),('public.device_auth_enrollment_codes'),
   ('public.ops_manager_enrollment_codes'),('public.ops_manager_push_devices'),('public.ops_manager_trusted_devices')) fixed(identity) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(r.identity) AND c.relkind='r'
    AND c.relpersistence='p' AND NOT c.relispartition
    AND pg_catalog.has_table_privilege(actor_oid,c.oid,'SELECT')
    AND pg_catalog.has_table_privilege(actor_oid,c.oid,CASE WHEN r.identity='auth.sessions' THEN 'DELETE' ELSE 'UPDATE' END)
    AND NOT pg_catalog.row_security_active(c.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='relation' AND l.database=db_oid AND l.relation=c.oid
     AND l.pid=pg_catalog.pg_backend_pid() AND l.granted AND l.mode='AccessExclusiveLock'))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority fixed target unavailable'; END IF;
 END LOOP;
 -- The five application statements keep their original ORIGIN statement
 -- fences. Auth's vendor table is NOT given a fabricated application trigger.
 IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN(
   'public.device_auth_credentials'::regclass,'public.device_auth_enrollment_codes'::regclass,
   'public.ops_manager_trusted_devices'::regclass,'public.ops_manager_enrollment_codes'::regclass,
   'public.ops_manager_push_devices'::regclass)
   AND t.tgname='custodial_disaster_restore_mutation_fence' AND NOT t.tgisinternal
   AND t.tgtype=62 AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
   AND t.tgfoid='custodial_dr.guard_application_mutation()'::regprocedure)<>5
  OR position('custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP)' in
    (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='custodial_dr.guard_application_mutation()'::regprocedure))=0
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority reviewed application guard unavailable'; END IF;
 -- Missing columns/domains/custom generated values are not zero authority.
 IF (SELECT count(*) FROM (VALUES
   ('public.device_auth_credentials','revoked_at','pg_catalog.timestamptz'),('public.device_auth_credentials','revoked_reason','pg_catalog.text'),
   ('public.device_auth_enrollment_codes','revoked_at','pg_catalog.timestamptz'),
   ('public.ops_manager_trusted_devices','revoked_at','pg_catalog.timestamptz'),('public.ops_manager_trusted_devices','revoked_reason','pg_catalog.text'),
   ('public.ops_manager_enrollment_codes','status','pg_catalog.text'),('public.ops_manager_enrollment_codes','revoked_at','pg_catalog.timestamptz'),
   ('public.ops_manager_enrollment_codes','revoked_reason','pg_catalog.text'),('public.ops_manager_push_devices','enabled','pg_catalog.bool'),
   ('public.ops_manager_push_devices','revoked_at','pg_catalog.timestamptz'),
   ('auth.sessions','id','pg_catalog.uuid')) fixed(identity,name,type)
  JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass(fixed.identity) AND a.attname=fixed.name
   AND a.atttypid=to_regtype(fixed.type) AND a.atttypmod=-1 AND NOT a.attisdropped
   AND a.attnum>0 AND a.attgenerated='' AND a.attidentity='')<>11
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority fixed columns unavailable'; END IF;
 IF (SELECT count(*) FROM custodial_dr.immutable_private_import_context)<>1
  OR (SELECT count(*) FROM custodial_dr.restore_control)<>1 OR (SELECT count(*) FROM custodial_dr.restore_manifests)<>1
  OR (SELECT count(*) FROM custodial_dr.restore_events)<>1
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority ancestry is ambiguous'; END IF;
 SELECT * INTO STRICT ctx FROM custodial_dr.immutable_private_import_context WHERE database_oid=db_oid
  AND backend_pid=pg_catalog.pg_backend_pid() AND transaction_id=p_original_transaction_id FOR SHARE;
 SELECT * INTO STRICT ctl FROM custodial_dr.restore_control WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT manifest FROM custodial_dr.restore_manifests WHERE restore_id=ctx.restore_id FOR UPDATE;
 SELECT * INTO STRICT event FROM custodial_dr.restore_events WHERE restore_id=ctx.restore_id;
 IF ctx.phase<>'FINISHED' OR ctx.active_table_oid IS NOT NULL OR ctx.active_row_sha256 IS NOT NULL
  OR ctx.authority_generation<=0 OR ctl.authority_generation IS DISTINCT FROM ctx.authority_generation
  OR ctl.restore_id IS DISTINCT FROM ctx.restore_id OR ctl.archive_digest IS DISTINCT FROM ctx.archive_digest
  OR ctl.state<>'DATABASE_RESTORED' OR ctl.mutations_paused IS DISTINCT FROM true
  OR ctx.original_control->>'state' IS DISTINCT FROM 'PREPARING'
  OR ctx.original_control->'mutations_paused' IS DISTINCT FROM 'true'::jsonb
  OR (to_jsonb(ctl)-ARRAY['state','updated_at']) IS DISTINCT FROM (ctx.original_control-ARRAY['state','updated_at'])
  OR (ctx.original_manifest->>'expires_at')::timestamptz<=clock_timestamp()
  OR isfinite((ctx.original_manifest->>'expires_at')::timestamptz) IS DISTINCT FROM true
  OR ctx.original_manifest->>'archive_digest' IS DISTINCT FROM ctx.archive_digest
  OR ctx.original_manifest->>'actor' IS DISTINCT FROM ctl.started_by
  OR ctx.original_manifest->>'source_project_ref' IS DISTINCT FROM ctl.source_project_ref
  OR ctx.original_manifest->>'target_project_ref' IS DISTINCT FROM ctl.target_project_ref
  OR ctx.original_manifest->>'schema' IS DISTINCT FROM 'custodial.immutable-private-import-manifest.v1'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority committed ancestry differs'; END IF;
 source:=custodial_dr.immutable_import_target_shape();
 scope_shape:=custodial_dr.immutable_original_authority_scope_shape();
 IF ctx.target_shape->'authority_reconciliation' IS NULL
  OR ctx.target_shape->'authority_reconciliation' IS DISTINCT FROM scope_shape
  OR jsonb_array_length(scope_shape->'functions') IS DISTINCT FROM 6
  OR (ctx.target_shape-'recovery_inventory') IS DISTINCT FROM (source-'recovery_inventory')
  OR jsonb_array_length(scope_shape->'text_codecs') IS DISTINCT FROM 2
  OR (SELECT count(*) FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_text_projection','immutable_import_text_record')
     AND p.proowner=actor_oid AND p.prokind='f' AND l.lanname='plpgsql' AND l.lanispl AND l.lanpltrusted
     AND NOT p.prosecdef AND NOT p.proleakproof AND NOT p.proisstrict AND NOT p.proretset
     AND p.provolatile='v' AND p.proparallel='u' AND p.procost=100 AND p.prorows=0
     AND p.provariadic=0 AND p.prosupport=0 AND p.pronargdefaults=0 AND p.proargdefaults IS NULL
     AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.protrftypes IS NULL AND p.prosqlbody IS NULL
     AND p.proargtypes::text=CASE p.proname WHEN 'immutable_import_text_record' THEN '2283 25' ELSE '2283' END
     AND p.prorettype=CASE p.proname WHEN 'immutable_import_text_record' THEN 2283 ELSE 25 END::oid
     AND p.pronargs=CASE p.proname WHEN 'immutable_import_text_record' THEN 2 ELSE 1 END
     AND p.proargnames=CASE p.proname WHEN 'immutable_import_text_record'
       THEN ARRAY['prototype','original_row_utf8'] ELSE ARRAY['original_record'] END
     AND ARRAY(SELECT lower(split_part(option,'=',1))||substr(option,strpos(option,'='))
       FROM unnest(p.proconfig) WITH ORDINALITY settings(option,ordinal) ORDER BY ordinal)
       =ARRAY['search_path=pg_catalog','extra_float_digits=3','datestyle=ISO, YMD',
         'timezone=UTC','intervalstyle=postgres','bytea_output=hex']
     AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
       =CASE p.proname WHEN 'immutable_import_text_record'
         THEN '030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb'
         ELSE '814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8' END
     AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=1
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable))<>2
  OR scope_shape->'relation'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'relation'->'rls' IS DISTINCT FROM 'true'::jsonb OR scope_shape->'relation'->'force' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'relation'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'import_ancestry'->'relation'->'rls' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'relation'->'force' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'function'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'import_ancestry'->'function'->'definer' IS DISTINCT FROM 'false'::jsonb
  OR scope_shape->'import_ancestry'->'function'->'config' IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class
    WHERE oid='custodial_dr.immutable_original_authority_scopes'::regclass),pg_catalog.acldefault('r',actor_oid))) a WHERE a.grantee<>actor_oid)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_shape->'functions') f WHERE f->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
    OR f->'definer' IS DISTINCT FROM 'false'::jsonb OR f->>'parallel' IS DISTINCT FROM 'u'
    OR f->'config' IS DISTINCT FROM '["search_path=pg_catalog, pg_temp"]'::jsonb)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_shape->'functions') f
    JOIN pg_catalog.pg_proc p ON p.oid=(f->>'oid')::oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE a.grantee<>actor_oid)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority sealed Source differs'; END IF;
 old_inventory:=ctx.target_shape->'recovery_inventory'; fresh_inventory:=source->'recovery_inventory';
 IF old_inventory IS NULL OR fresh_inventory IS NULL
  OR (old_inventory-'epoch') IS DISTINCT FROM (fresh_inventory-'epoch')
  OR old_inventory->'epoch'->>'relation_filenode' IS DISTINCT FROM fresh_inventory->'epoch'->>'relation_filenode'
  OR fresh_inventory->'epoch'->>'database_oid' IS DISTINCT FROM db_oid::text
  OR fresh_inventory->'epoch'->>'backend_pid' IS DISTINCT FROM pg_catalog.pg_backend_pid()::text
  OR fresh_inventory->'epoch'->>'transaction_id' IS DISTINCT FROM pg_catalog.txid_current()::text
  OR fresh_inventory->'epoch'->>'inserted' IS DISTINCT FROM '0'
  OR fresh_inventory->'epoch'->>'updated' IS DISTINCT FROM '0' OR fresh_inventory->'epoch'->>'deleted' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority Source inventory differs'; END IF;
 SELECT count(*) INTO private_rows FROM custodial_dr.immutable_private_import_rows
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 IF private_rows IS DISTINCT FROM (SELECT coalesce(sum((m->>'row_count')::bigint),0)::bigint
    FROM jsonb_array_elements(ctx.original_manifest->'private_data_members') m)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority private originals differ'; END IF;
 imported:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,'transaction_id',ctx.transaction_id::text,
  'restore_id',ctx.restore_id,'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest,
  'private_rows',private_rows::text,'transaction_authority',false,'admission_resumed',false);
 SELECT count(*),coalesce(sum((m->>'row_count')::bigint),0)::bigint INTO table_count,row_count
  FROM jsonb_array_elements(ctx.original_manifest->'catalog') m
  WHERE NOT(m->>'schema_name'='public' AND m->>'table_name'='release_deployment_manifest');
 expected_event:=jsonb_build_object('tables',table_count,'unvalidated_check_constraints',
  jsonb_build_object('constraints','[]'::jsonb,'count',0,'sha256',public.static_weekly_digest_text('[]'),'mode','NOT_SUSPENDED'),
  'original_data_import',imported,'consumed_source_tables',jsonb_array_length(ctx.original_manifest->'catalog'),
  'consumed_source_rows',(SELECT coalesce(sum((m->>'row_count')::bigint),0)::bigint::text
    FROM jsonb_array_elements(ctx.original_manifest->'catalog') m),'preserved_current_release_bootstrap',true);
 expected_database:=(expected_event-'tables')||jsonb_build_object('tables',table_count,'rows',row_count::text);
 IF manifest.authority_generation IS DISTINCT FROM ctx.authority_generation OR manifest.archive_digest IS DISTINCT FROM ctx.archive_digest
  OR manifest.database_verified IS DISTINCT FROM true OR manifest.storage_verified IS DISTINCT FROM false
  OR manifest.authority_invalidated IS DISTINCT FROM false OR manifest.post_restore_verified IS DISTINCT FROM false
  OR manifest.database_evidence IS DISTINCT FROM expected_database OR manifest.storage_evidence IS DISTINCT FROM '{}'::jsonb
  OR manifest.authority_evidence IS DISTINCT FROM '{}'::jsonb OR manifest.final_manifest_sha256 IS NOT NULL OR manifest.reconciliation_manifest_sha256 IS NOT NULL
  OR event.authority_generation IS DISTINCT FROM ctx.authority_generation OR event.phase<>'DATABASE' OR event.outcome<>'PASSED'
  OR event.actor IS DISTINCT FROM ctl.started_by OR event.evidence_json IS DISTINCT FROM expected_event
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority DATABASE evidence differs'; END IF;
 -- Heavy Source/shape/evidence reads above may themselves consume the
 -- original finite window. Never return a pre-read freshness observation.
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF (ctx.original_manifest->>'expires_at')::timestamptz<=clock_timestamp()
  OR isfinite((ctx.original_manifest->>'expires_at')::timestamptz) IS DISTINCT FROM true
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority expired during validation'; END IF;
 RETURN jsonb_build_object('database_oid',db_oid::text,'backend_pid',pg_catalog.pg_backend_pid(),'transaction_id',pg_catalog.txid_current()::text,
  'original_transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id,'authority_generation',ctx.authority_generation::text,
  -- Stable native transaction time, durably inside the immutable original
  -- snapshot. The existing push owner trigger writes now() to updated_at;
  -- later image verification must not borrow its expected value from that
  -- current row or a caller timestamp. This is DATA, never effect authority.
  'archive_digest',ctx.archive_digest,'owner_oid',actor_oid::text,
  'effect_transaction_started_at',pg_catalog.transaction_timestamp(),'control',to_jsonb(ctl),'manifest',to_jsonb(manifest),
  'event',to_jsonb(event),'import_context',to_jsonb(ctx),'private_rows',private_rows::text,'source_shape',source);
END $fn$;

-- Reviewed direct callers are the existing BEFORE STATEMENT application guard
-- and the exact trg_mz_reconcile_employee_push_credential_state AFTER ROW
-- adapter on device_auth_credentials. That adapter additionally verifies its
-- trigger identity, effect-1 scope and OLD/NEW binary row image before returning
-- NEW unchanged. No other caller is admitted by a name, receipt or flag.
-- No scope / consumed scope => FALSE.
-- Existing invalid/mixed scope => refusal, never ordinary-mutation fallback.
CREATE FUNCTION custodial_dr.immutable_original_authority_guard_matches(p_table_oid oid,p_operation text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE scope custodial_dr.immutable_original_authority_scopes; expected_oid oid;
BEGIN
 IF pg_catalog.pg_trigger_depth()<>1 OR current_user<>session_user THEN RETURN false; END IF;
 SELECT * INTO scope FROM custodial_dr.immutable_original_authority_scopes
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_catalog.pg_backend_pid() AND transaction_id=pg_catalog.txid_current();
 IF NOT FOUND OR scope.phase='CONSUMED' THEN RETURN false; END IF;
 expected_oid:=CASE scope.completed_step+1 WHEN 1 THEN 'public.device_auth_credentials'::regclass
  WHEN 2 THEN 'public.device_auth_enrollment_codes'::regclass WHEN 3 THEN 'public.ops_manager_push_devices'::regclass
  WHEN 4 THEN 'public.ops_manager_enrollment_codes'::regclass WHEN 5 THEN 'public.ops_manager_trusted_devices'::regclass
  WHEN 6 THEN 'auth.sessions'::regclass END;
 IF scope.phase<>'RUNNING' OR scope.active_table_oid IS DISTINCT FROM expected_oid OR p_table_oid IS DISTINCT FROM expected_oid
  OR p_operation IS DISTINCT FROM (CASE WHEN scope.completed_step=5 THEN 'DELETE' ELSE 'UPDATE' END)
  OR scope.original_snapshot IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(scope.original_transaction_id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority active statement differs'; END IF;
 RETURN true;
END $fn$;

CREATE FUNCTION custodial_dr.reconcile_committed_immutable_original_authority(
 p_database_oid oid,p_backend_pid integer,p_transaction_id bigint,p_restore_id uuid,
 p_authority_generation bigint,p_archive_digest text,p_original_transaction_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE original jsonb; effect_counts jsonb:='{}'::jsonb; completion jsonb; expected bigint; affected bigint; step integer;
 target_oid oid; key_name text; reason text;
 data_table record; data_oid oid; data_counts record; staging_relation text; data_decoder text; data_projection text;
BEGIN
 -- First actual native owner/fence check; expected IDs alone are insufficient.
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF p_database_oid IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
  OR p_backend_pid IS DISTINCT FROM pg_catalog.pg_backend_pid() OR p_transaction_id IS DISTINCT FROM pg_catalog.txid_current()
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority mutation witness differs'; END IF;
 -- Deterministic locks before any scope/effect write, including real Auth.
 LOCK TABLE ONLY auth.sessions, ONLY public.device_auth_credentials, ONLY public.device_auth_enrollment_codes,
  ONLY public.ops_manager_enrollment_codes, ONLY public.ops_manager_push_devices, ONLY public.ops_manager_trusted_devices IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE custodial_dr.restore_control,custodial_dr.restore_manifests,custodial_dr.restore_events,
  custodial_dr.immutable_private_import_context,custodial_dr.immutable_private_import_rows,custodial_dr.immutable_ordinary_import_rows IN SHARE MODE;
 original:=custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id);
 IF original->>'restore_id' IS DISTINCT FROM p_restore_id::text OR original->>'authority_generation' IS DISTINCT FROM p_authority_generation::text
  OR original->>'archive_digest' IS DISTINCT FROM p_archive_digest OR original->>'original_transaction_id' IS DISTINCT FROM p_original_transaction_id::text
  OR EXISTS(SELECT 1 FROM custodial_dr.immutable_original_authority_scopes
    WHERE restore_id=p_restore_id AND authority_generation=p_authority_generation)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority attempt unavailable or consumed'; END IF;
 -- Main's private factory additionally requires its own genuine successful
 -- post-COMMIT readback. Recheck the original staged DATA inside THIS RW
 -- transaction: the Auth/Storage providers are not application writers and
 -- may have changed their rows between the earlier RO and this transaction.
 -- These are read comparisons/locks only; the six effect targets stay fixed.
 FOR data_table IN
  SELECT e->>'schema_name' schema_name,e->>'table_name' table_name,
   (e->>'row_count')::bigint row_count
  FROM jsonb_array_elements(original#>'{import_context,original_manifest,catalog}') e
  ORDER BY e->>'schema_name' COLLATE "C",e->>'table_name' COLLATE "C"
 LOOP
  IF data_table.schema_name NOT IN('public','auth','storage','custodial_release_identity')
   OR data_table.table_name IS NULL OR data_table.table_name='' OR octet_length(data_table.table_name)>63
   OR data_table.row_count IS NULL OR data_table.row_count<0
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority DATA selector unavailable'; END IF;
  data_oid:=to_regclass(format('%I.%I',data_table.schema_name,data_table.table_name));
  IF data_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid=data_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid))
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority DATA relation unavailable'; END IF;
  EXECUTE format('LOCK TABLE ONLY %I.%I IN SHARE MODE',data_table.schema_name,data_table.table_name);
 END LOOP;
 IF original IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority Source changed before DATA comparison'; END IF;
 FOR data_table IN
  SELECT e->>'schema_name' schema_name,e->>'table_name' table_name,
   (e->>'row_count')::bigint row_count,e->>'data_encoding' data_encoding
  FROM jsonb_array_elements(original#>'{import_context,original_manifest,catalog}') e
  ORDER BY e->>'schema_name' COLLATE "C",e->>'table_name' COLLATE "C"
 LOOP
  -- These are the two deliberately preserved CURRENT Source-bootstrap
  -- relations, already checked by the native Source/manifest/epoch reader.
  -- They are never labelled original DATA MATCH or reinserted here.
  IF data_table.schema_name='public' AND data_table.table_name IN(
    'release_deployment_manifest','custodial_release_authority_restore_inventory') THEN CONTINUE; END IF;
  data_oid:=to_regclass(format('%I.%I',data_table.schema_name,data_table.table_name));
  staging_relation:=CASE WHEN data_table.schema_name='custodial_release_identity'
   THEN 'custodial_dr.immutable_private_import_rows' ELSE 'custodial_dr.immutable_ordinary_import_rows' END;
  -- The prior import transaction has committed: its context-bound dispatcher
  -- cannot be borrowed by this new transaction. Only the already-authenticated
  -- original snapshot's catalog selects these two fixed, sealed DATA recipes.
  -- No caller tag, row sniffing or current data can choose the representation.
  IF data_table.data_encoding='postgres-text-columns-line.v2' THEN
   data_projection:='custodial_dr.immutable_import_text_projection';
   data_decoder:=format('custodial_dr.immutable_import_text_record(null::%I.%I,i.original_row_utf8)',
     data_table.schema_name,data_table.table_name);
  ELSIF data_table.data_encoding='postgres-json-text-line.v1' THEN
   data_projection:='pg_catalog.row_to_json';
   data_decoder:=format('pg_catalog.json_populate_record(null::%I.%I,i.original_row_utf8::json)',
     data_table.schema_name,data_table.table_name);
  ELSE RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority DATA selector unavailable'; END IF;
  EXECUTE format($data_compare$
   WITH staged AS MATERIALIZED (
    SELECT original_row_utf8,original_row_sha256 FROM %s
    WHERE database_oid=$1 AND backend_pid=$2 AND transaction_id=$3 AND table_oid=$4
   ), expected_rows AS MATERIALIZED (
    SELECT %s(r)::text COLLATE "C" row_data FROM staged i
    CROSS JOIN LATERAL %s r
   ), current_rows AS MATERIALIZED (
    SELECT %s(t)::text COLLATE "C" row_data FROM ONLY %I.%I t
   ), missing AS (SELECT row_data FROM expected_rows EXCEPT ALL SELECT row_data FROM current_rows),
      extra AS (SELECT row_data FROM current_rows EXCEPT ALL SELECT row_data FROM expected_rows)
   SELECT (SELECT count(*) FROM staged) staged_rows,(SELECT count(*) FROM expected_rows) original_rows,
    (SELECT count(*) FROM current_rows) current_rows,(SELECT count(*) FROM missing) missing_rows,
    (SELECT count(*) FROM extra) extra_rows,
    (SELECT count(*) FROM staged WHERE original_row_sha256 IS DISTINCT FROM
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original_row_utf8,'UTF8'),'sha256'),'hex')) bad_original_hashes
   $data_compare$,staging_relation,data_projection,data_decoder,data_projection,data_table.schema_name,data_table.table_name)
   INTO data_counts USING p_database_oid,p_backend_pid,p_original_transaction_id,data_oid;
  IF data_counts.staged_rows IS DISTINCT FROM data_table.row_count
   OR data_counts.original_rows IS DISTINCT FROM data_table.row_count
   OR data_counts.current_rows IS DISTINCT FROM data_table.row_count
   OR data_counts.missing_rows IS DISTINCT FROM 0::bigint OR data_counts.extra_rows IS DISTINCT FROM 0::bigint
   OR data_counts.bad_original_hashes IS DISTINCT FROM 0::bigint
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority current DATA differs'; END IF;
 END LOOP;
 IF original IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority Source changed after DATA comparison'; END IF;
 INSERT INTO custodial_dr.immutable_original_authority_scopes(database_oid,backend_pid,transaction_id,original_transaction_id,
  restore_id,authority_generation,archive_digest,owner_oid,original_snapshot,phase,completed_step,active_table_oid,counts)
 VALUES(p_database_oid,p_backend_pid,p_transaction_id,p_original_transaction_id,p_restore_id,p_authority_generation,p_archive_digest,
  (original->>'owner_oid')::oid,original,'RUNNING',0,NULL,effect_counts);
 reason:='disaster_restore_generation_'||p_authority_generation::text;
 FOR step IN 1..6 LOOP
  IF original IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority pre-effect context changed'; END IF;
  target_oid:=CASE step WHEN 1 THEN 'public.device_auth_credentials'::regclass WHEN 2 THEN 'public.device_auth_enrollment_codes'::regclass
   WHEN 3 THEN 'public.ops_manager_push_devices'::regclass WHEN 4 THEN 'public.ops_manager_enrollment_codes'::regclass
   WHEN 5 THEN 'public.ops_manager_trusted_devices'::regclass WHEN 6 THEN 'auth.sessions'::regclass END;
  key_name:=CASE step WHEN 1 THEN 'employee_credentials' WHEN 2 THEN 'employee_enrollment' WHEN 3 THEN 'manager_push'
   WHEN 4 THEN 'manager_enrollment' WHEN 5 THEN 'manager_credentials' WHEN 6 THEN 'auth_sessions' END;
  UPDATE custodial_dr.immutable_original_authority_scopes SET active_table_oid=target_oid
   WHERE database_oid=p_database_oid AND backend_pid=p_backend_pid AND transaction_id=p_transaction_id AND phase='RUNNING'
    AND completed_step=step-1 AND active_table_oid IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority arm differs'; END IF;
  -- Same six predicates/assignments as invalidateRestoredAuthority(). The
  -- push owner guard requires its existing trusted credential to remain
  -- active, so retire manager children BEFORE that credential. Every arm,
  -- row guard and count still uses this one fixed sequence; no guard bypass
  -- or caller table/column/SQL/identity/effect selector is introduced.
  CASE step
   WHEN 1 THEN
    SELECT count(*) INTO expected FROM public.device_auth_credentials WHERE revoked_at IS NULL;
    UPDATE public.device_auth_credentials SET revoked_at=clock_timestamp(),revoked_reason=reason WHERE revoked_at IS NULL;
    GET DIAGNOSTICS affected=ROW_COUNT;
   WHEN 2 THEN
    SELECT count(*) INTO expected FROM public.device_auth_enrollment_codes WHERE revoked_at IS NULL;
    UPDATE public.device_auth_enrollment_codes SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
    GET DIAGNOSTICS affected=ROW_COUNT;
   WHEN 3 THEN
    SELECT count(*) INTO expected FROM public.ops_manager_push_devices WHERE coalesce(enabled,true)=true OR revoked_at IS NULL;
    UPDATE public.ops_manager_push_devices SET enabled=false,revoked_at=clock_timestamp()
     WHERE coalesce(enabled,true)=true OR revoked_at IS NULL;
    GET DIAGNOSTICS affected=ROW_COUNT;
   WHEN 4 THEN
    SELECT count(*) INTO expected FROM public.ops_manager_enrollment_codes WHERE status='active';
    UPDATE public.ops_manager_enrollment_codes SET status='revoked',revoked_at=clock_timestamp(),revoked_reason=reason WHERE status='active';
    GET DIAGNOSTICS affected=ROW_COUNT;
   WHEN 5 THEN
    SELECT count(*) INTO expected FROM public.ops_manager_trusted_devices WHERE revoked_at IS NULL;
    UPDATE public.ops_manager_trusted_devices SET revoked_at=clock_timestamp(),revoked_reason=reason WHERE revoked_at IS NULL;
    GET DIAGNOSTICS affected=ROW_COUNT;
   WHEN 6 THEN
    SELECT count(*) INTO expected FROM auth.sessions;
    DELETE FROM auth.sessions;
    GET DIAGNOSTICS affected=ROW_COUNT;
  END CASE;
  IF affected IS DISTINCT FROM expected THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority effect count differs'; END IF;
  IF original IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority post-effect context changed'; END IF;
  effect_counts:=effect_counts||jsonb_build_object(key_name,affected::text);
  UPDATE custodial_dr.immutable_original_authority_scopes SET active_table_oid=NULL,completed_step=step,counts=effect_counts
   WHERE database_oid=p_database_oid AND backend_pid=p_backend_pid AND transaction_id=p_transaction_id
    AND phase='RUNNING' AND completed_step=step-1 AND active_table_oid=target_oid;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority close-statement differs'; END IF;
 END LOOP;
 completion:=jsonb_build_object('database_oid',p_database_oid::text,'backend_pid',p_backend_pid,'transaction_id',p_transaction_id::text,
  'original_transaction_id',p_original_transaction_id::text,'restore_id',p_restore_id,'authority_generation',p_authority_generation::text,
  'archive_digest',p_archive_digest,'state','CONSUMED_PAUSED','revocations',effect_counts);
 UPDATE custodial_dr.immutable_original_authority_scopes SET phase='CONSUMED',result=completion
  WHERE database_oid=p_database_oid AND backend_pid=p_backend_pid AND transaction_id=p_transaction_id
   AND phase='RUNNING' AND completed_step=6 AND active_table_oid IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 OR original IS DISTINCT FROM custodial_dr.immutable_original_authority_snapshot(p_original_transaction_id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original authority final context changed'; END IF;
 RETURN completion; -- Completion DATA only; control stays paused and no COMMIT.
 -- An error is rethrown: the entire statement, all six effects and its scope
 -- roll back atomically. Main consumes its native attempt before await and
 -- treats missing/malformed/lost reply or unknown COMMIT as UNKNOWN, no retry.
EXCEPTION WHEN OTHERS THEN RAISE;
END $fn$;

-- Fixed historical readback only, including after expiry or process restart.
-- The effect PID/xid arguments identify a RECORDED operation; neither is the
-- reader's native admission. No missing record can authorize another attempt.
CREATE FUNCTION custodial_dr.read_committed_immutable_original_authority(
 p_database_oid oid,p_effect_backend_pid integer,p_effect_transaction_id bigint,p_restore_id uuid,
 p_authority_generation bigint,p_archive_digest text,p_original_transaction_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE scope custodial_dr.immutable_original_authority_scopes; ctx custodial_dr.immutable_private_import_context;
 db_oid oid; actor_oid oid; record_count bigint; item text; value text; expected_result jsonb;
 fresh_source jsonb; scope_shape jsonb; recorded_source jsonb; inventory_oid oid; file_node oid;
 fresh_inventory jsonb; recorded_inventory jsonb; import_inventory jsonb; import_epoch jsonb;
BEGIN
 SELECT oid INTO STRICT db_oid FROM pg_catalog.pg_database WHERE datname=current_database();
 SELECT oid INTO STRICT actor_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 IF current_user<>session_user OR actor_oid IS DISTINCT FROM
   (SELECT relowner FROM pg_catalog.pg_class WHERE oid='custodial_dr.restore_control'::regclass)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='custodial_dr.immutable_private_import_context'::regclass
    AND c.relowner=actor_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
    AND c.relrowsecurity AND c.relforcerowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee<>actor_oid))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='custodial_dr.immutable_original_authority_scopes'::regclass
    AND c.relowner=actor_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
    AND c.relrowsecurity AND c.relforcerowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee<>actor_oid))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNAVAILABLE',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 IF current_setting('transaction_read_only')<>'on'
  OR current_setting('transaction_isolation') NOT IN('repeatable read','serializable')
  OR current_setting('session_replication_role')<>'origin'
  OR current_setting('search_path')<>'pg_catalog, pg_temp' OR (pg_catalog.current_schemas(true))[1]<>'pg_catalog'
  OR p_database_oid IS DISTINCT FROM db_oid OR p_effect_backend_pid IS NULL OR p_effect_backend_pid<=0
  OR p_effect_transaction_id IS NULL OR p_effect_transaction_id<=0
  OR p_original_transaction_id IS NULL OR p_original_transaction_id<=0 OR p_original_transaction_id=p_effect_transaction_id
  OR p_restore_id IS NULL OR p_authority_generation IS NULL OR p_authority_generation<=0
  OR p_archive_digest IS NULL OR length(p_archive_digest)<>64 OR p_archive_digest !~ '^[a-f0-9]{64}$'
  -- Do not assign an xid merely for observation, and do not observe one's
  -- own uncommitted operation as if a separate transaction saw its COMMIT.
  OR pg_catalog.txid_current_if_assigned() IS NOT DISTINCT FROM p_effect_transaction_id
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 SELECT count(*) INTO record_count FROM custodial_dr.immutable_original_authority_scopes s
  WHERE s.database_oid=db_oid AND s.restore_id=p_restore_id AND s.authority_generation=p_authority_generation;
 IF record_count<>1 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 SELECT * INTO STRICT scope FROM custodial_dr.immutable_original_authority_scopes s
  WHERE s.database_oid=db_oid AND s.restore_id=p_restore_id AND s.authority_generation=p_authority_generation;
 IF scope.backend_pid IS DISTINCT FROM p_effect_backend_pid OR scope.transaction_id IS DISTINCT FROM p_effect_transaction_id
  OR scope.original_transaction_id IS DISTINCT FROM p_original_transaction_id OR scope.archive_digest IS DISTINCT FROM p_archive_digest
  OR scope.owner_oid IS DISTINCT FROM actor_oid OR scope.phase IS DISTINCT FROM 'CONSUMED'
  OR scope.completed_step IS DISTINCT FROM 6 OR scope.active_table_oid IS NOT NULL
  OR jsonb_typeof(scope.counts) IS DISTINCT FROM 'object'
  OR NOT(scope.counts ?& ARRAY['employee_credentials','employee_enrollment','manager_credentials','manager_enrollment','manager_push','auth_sessions'])
  OR scope.counts-ARRAY['employee_credentials','employee_enrollment','manager_credentials','manager_enrollment','manager_push','auth_sessions']<>'{}'::jsonb
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 FOREACH item IN ARRAY ARRAY['employee_credentials','employee_enrollment','manager_credentials','manager_enrollment','manager_push','auth_sessions'] LOOP
  value:=scope.counts->>item;
  IF jsonb_typeof(scope.counts->item) IS DISTINCT FROM 'string' OR value IS NULL
   OR value !~ '^(0|[1-9][0-9]*)$' OR translate(value,'0123456789','')<>'' OR length(value)>19
   OR (length(value)=19 AND value COLLATE "C">'9223372036854775807' COLLATE "C")
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 END LOOP;
 expected_result:=jsonb_build_object('database_oid',scope.database_oid::text,'backend_pid',scope.backend_pid,
  'transaction_id',scope.transaction_id::text,'original_transaction_id',scope.original_transaction_id::text,
  'restore_id',scope.restore_id,'authority_generation',scope.authority_generation::text,'archive_digest',scope.archive_digest,
  'state','CONSUMED_PAUSED','revocations',scope.counts);
 IF scope.result IS DISTINCT FROM expected_result OR jsonb_typeof(scope.original_snapshot) IS DISTINCT FROM 'object'
  OR NOT(scope.original_snapshot ?& ARRAY['database_oid','backend_pid','transaction_id','original_transaction_id','restore_id',
    'authority_generation','archive_digest','owner_oid','effect_transaction_started_at','control','manifest','event','import_context','private_rows','source_shape'])
  OR jsonb_typeof(scope.original_snapshot->'effect_transaction_started_at') IS DISTINCT FROM 'string'
  OR pg_catalog.isfinite((scope.original_snapshot->>'effect_transaction_started_at')::timestamptz) IS DISTINCT FROM true
  OR (scope.original_snapshot-ARRAY['control','manifest','event','import_context','private_rows','source_shape']) IS DISTINCT FROM
    jsonb_build_object('database_oid',scope.database_oid::text,'backend_pid',scope.backend_pid,'transaction_id',scope.transaction_id::text,
     'original_transaction_id',scope.original_transaction_id::text,'restore_id',scope.restore_id,
     'authority_generation',scope.authority_generation::text,'archive_digest',scope.archive_digest,'owner_oid',scope.owner_oid::text,
     'effect_transaction_started_at',scope.original_snapshot->'effect_transaction_started_at')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 SELECT count(*) INTO record_count FROM custodial_dr.immutable_private_import_context c WHERE c.database_oid=db_oid
  AND c.backend_pid=p_effect_backend_pid AND c.transaction_id=p_original_transaction_id;
 IF record_count<>1 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 SELECT * INTO STRICT ctx FROM custodial_dr.immutable_private_import_context c WHERE c.database_oid=db_oid
  AND c.backend_pid=p_effect_backend_pid AND c.transaction_id=p_original_transaction_id;
 IF ctx.phase IS DISTINCT FROM 'FINISHED' OR ctx.active_table_oid IS NOT NULL OR ctx.active_row_sha256 IS NOT NULL
  OR ctx.restore_id IS DISTINCT FROM scope.restore_id OR ctx.authority_generation IS DISTINCT FROM scope.authority_generation
  OR ctx.archive_digest IS DISTINCT FROM scope.archive_digest OR to_jsonb(ctx) IS DISTINCT FROM scope.original_snapshot->'import_context'
  OR scope.original_snapshot->'private_rows' IS DISTINCT FROM to_jsonb((SELECT count(*)::text FROM custodial_dr.immutable_private_import_rows r
    WHERE r.database_oid=db_oid AND r.backend_pid=p_effect_backend_pid AND r.transaction_id=p_original_transaction_id))
  OR jsonb_typeof(scope.original_snapshot->'control') IS DISTINCT FROM 'object'
  OR scope.original_snapshot->'control'->'state' IS DISTINCT FROM '"DATABASE_RESTORED"'::jsonb
  OR scope.original_snapshot->'control'->'mutations_paused' IS DISTINCT FROM 'true'::jsonb
  OR ((scope.original_snapshot->'control')-ARRAY['state','updated_at']) IS DISTINCT FROM (ctx.original_control-ARRAY['state','updated_at'])
  OR jsonb_typeof(scope.original_snapshot->'manifest') IS DISTINCT FROM 'object'
  OR jsonb_typeof(scope.original_snapshot->'event') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;

 -- Exact fixed catalog projection from the pinned original target-shape
 -- Source, without calling its live owner-fence/epoch-memoizer dependency.
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
 'authority_reconciliation',custodial_dr.immutable_original_authority_scope_shape(),
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
   LEFT JOIN relation_trigger_shapes trigger_shape ON trigger_shape.tgrelid=c.oid)) INTO fresh_source;
 recorded_source:=scope.original_snapshot->'source_shape';
 scope_shape:=custodial_dr.immutable_original_authority_scope_shape();
 IF jsonb_typeof(recorded_source) IS DISTINCT FROM 'object'
  OR (recorded_source-'recovery_inventory') IS DISTINCT FROM (ctx.target_shape-'recovery_inventory')
  OR (recorded_source-'recovery_inventory') IS DISTINCT FROM fresh_source
  OR recorded_source->'authority_reconciliation' IS DISTINCT FROM scope_shape
  OR jsonb_array_length(scope_shape->'functions') IS DISTINCT FROM 6
  OR scope_shape->'relation'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'relation'->'rls' IS DISTINCT FROM 'true'::jsonb OR scope_shape->'relation'->'force' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'relation'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'import_ancestry'->'relation'->'rls' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'relation'->'force' IS DISTINCT FROM 'true'::jsonb
  OR scope_shape->'import_ancestry'->'function'->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
  OR scope_shape->'import_ancestry'->'function'->'definer' IS DISTINCT FROM 'false'::jsonb
  OR scope_shape->'import_ancestry'->'function'->'config' IS DISTINCT FROM '["search_path=pg_catalog"]'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_shape->'functions') f WHERE f->'owner' IS DISTINCT FROM to_jsonb(actor_oid)
    OR f->'definer' IS DISTINCT FROM 'false'::jsonb OR f->>'parallel' IS DISTINCT FROM 'u'
    OR f->'config' IS DISTINCT FROM '["search_path=pg_catalog, pg_temp"]'::jsonb)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope_shape->'functions') f JOIN pg_catalog.pg_proc p ON p.oid=(f->>'oid')::oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee<>actor_oid)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;

 -- Fresh canonical Source DATA, not the historical archive-file digest and
 -- not a current mutation epoch/capability. No counters are changed/read as
 -- a replacement for the original committed effect epoch.
 inventory_oid:=to_regclass('public.custodial_release_authority_restore_inventory');
 file_node:=pg_catalog.pg_relation_filenode(inventory_oid);
 IF inventory_oid IS NULL OR file_node IS NULL OR file_node=0 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 SELECT jsonb_build_object('relation','public.custodial_release_authority_restore_inventory','relation_oid',inventory_oid,
  'row_count',count(*)::text,'canonical_rowset_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.restore_order,i.object_kind,i.object_identity,i.inventory_id),'[]'::jsonb)::text,
    'UTF8'),'sha256'),'hex')) INTO fresh_inventory FROM public.custodial_release_authority_restore_inventory i;
 recorded_inventory:=recorded_source->'recovery_inventory'; import_inventory:=ctx.target_shape->'recovery_inventory';
 import_epoch:=import_inventory->'epoch';
 IF jsonb_typeof(recorded_inventory) IS DISTINCT FROM 'object' OR jsonb_typeof(import_inventory) IS DISTINCT FROM 'object'
  OR fresh_inventory->>'row_count'='0'
  OR (recorded_inventory-'epoch') IS DISTINCT FROM fresh_inventory OR (import_inventory-'epoch') IS DISTINCT FROM fresh_inventory
  OR recorded_inventory->'epoch' IS DISTINCT FROM jsonb_build_object('database_oid',db_oid::text,'backend_pid',p_effect_backend_pid::text,
    'transaction_id',p_effect_transaction_id::text,'relation_oid',inventory_oid::text,'relation_filenode',file_node::text,
    'inserted','0','updated','0','deleted','0')
  OR jsonb_typeof(import_epoch) IS DISTINCT FROM 'object'
  OR import_epoch IS DISTINCT FROM jsonb_build_object('database_oid',db_oid::text,'backend_pid',p_effect_backend_pid::text,
    'transaction_id',p_original_transaction_id::text,'relation_oid',inventory_oid::text,'relation_filenode',file_node::text,
    'inserted',import_epoch->'inserted','updated',import_epoch->'updated','deleted',import_epoch->'deleted')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 FOREACH item IN ARRAY ARRAY['inserted','updated','deleted'] LOOP
  value:=import_epoch->>item;
  IF jsonb_typeof(import_epoch->item) IS DISTINCT FROM 'string' OR value IS NULL
   OR value !~ '^(0|[1-9][0-9]*)$' OR translate(value,'0123456789','')<>'' OR length(value)>19
   OR (length(value)=19 AND value COLLATE "C">'9223372036854775807' COLLATE "C")
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IMMUTABLE_ORIGINAL_AUTHORITY_STATUS_UNKNOWN',DETAIL='outcome=UNKNOWN;retry_safe=false'; END IF;
 END LOOP;
 -- No expiry test: this is a historical completion observation. Current
 -- admission requires Main's separate live native/Source/intent factory.
 RETURN jsonb_build_object('state','OBSERVED_COMMITTED_CONSUMED','database_oid',scope.database_oid::text,
  'effect_backend_pid',scope.backend_pid,'effect_transaction_id',scope.transaction_id::text,
  'original_transaction_id',scope.original_transaction_id::text,'restore_id',scope.restore_id,
  'authority_generation',scope.authority_generation::text,'archive_digest',scope.archive_digest,'revocations',scope.counts);
END $fn$;

-- New private objects only. Remove ALL unintended creator default ACL extras;
-- do not alter any existing object's grants or default-privilege policy.
DO $acl$
DECLARE item record; entry record; owner_oid oid;
BEGIN
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname=current_user;
 FOR item IN SELECT c.oid,c.relowner FROM pg_catalog.pg_class c
  WHERE c.oid='custodial_dr.immutable_original_authority_scopes'::regclass LOOP
  IF item.relowner<>owner_oid THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority table owner differs'; END IF;
  FOR entry IN SELECT DISTINCT grantee FROM pg_catalog.aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class WHERE oid=item.oid),pg_catalog.acldefault('r',owner_oid))) WHERE grantee<>owner_oid LOOP
   EXECUTE format('REVOKE ALL ON TABLE %s FROM %s RESTRICT',item.oid::regclass,CASE WHEN entry.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END);
  END LOOP;
 END LOOP;
 FOR item IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p WHERE p.oid IN(
   to_regprocedure('custodial_dr.immutable_original_authority_scope_guard()'),
   to_regprocedure('custodial_dr.immutable_original_authority_scope_shape()'),
   to_regprocedure('custodial_dr.immutable_original_authority_snapshot(bigint)'),
   to_regprocedure('custodial_dr.immutable_original_authority_guard_matches(oid,text)'),
   to_regprocedure('custodial_dr.reconcile_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)'),
   to_regprocedure('custodial_dr.read_committed_immutable_original_authority(oid,integer,bigint,uuid,bigint,text,bigint)')) LOOP
  IF item.proowner<>owner_oid THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority function owner differs'; END IF;
  FOR entry IN SELECT DISTINCT grantee FROM pg_catalog.aclexplode(coalesce((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=item.oid),pg_catalog.acldefault('f',owner_oid))) WHERE grantee<>owner_oid LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s RESTRICT',item.oid::regprocedure,CASE WHEN entry.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(entry.grantee)) END);
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=item.oid),pg_catalog.acldefault('f',owner_oid))) a
    WHERE a.grantee<>owner_oid)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority function ACL remains nonprivate'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce((SELECT relacl FROM pg_catalog.pg_class
   WHERE oid='custodial_dr.immutable_original_authority_scopes'::regclass),pg_catalog.acldefault('r',owner_oid))) a WHERE a.grantee<>owner_oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original authority table ACL remains nonprivate'; END IF;
END $acl$;
COMMIT;
