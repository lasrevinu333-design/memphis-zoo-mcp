-- UNQUALIFIED LOCAL PROPOSAL. Not included in the shipping program yet.
-- Only two fixed original table cohorts; no constraint timing or trigger change.
CREATE FUNCTION custodial_dr.immutable_import_fixed_cohort_relations(anchor_oid oid)
RETURNS oid[] LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE names text[]; result oid[]; relation_name text; relation_oid oid;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original cohort owner unavailable';END IF;
 IF anchor_oid=to_regclass('public.custodial_release_canary_controls') THEN
  names:=ARRAY['public.custodial_release_canary_controls','public.custodial_release_canary_transport_probes'];
 ELSIF anchor_oid=to_regclass('public.ops_manager_enrollment_codes') THEN
  names:=ARRAY['public.ops_manager_enrollment_codes','public.ops_manager_shared_enrollment_windows','public.ops_manager_trusted_devices'];
 ELSE RETURN NULL;END IF;
 result:=ARRAY[]::oid[];
 FOREACH relation_name IN ARRAY names LOOP
  relation_oid:=to_regclass(relation_name);
  IF relation_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
   WHERE c.oid=relation_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition
    AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))
  THEN RAISE EXCEPTION 'Fixed original cohort relation unavailable';END IF;
  result:=array_append(result,relation_oid);
 END LOOP;
 RETURN result;
END $fn$;

-- Recheck every ordinal, original hash and typed text under the existing
-- source/owner witness. This read-only helper never grants a write capability.
CREATE FUNCTION custodial_dr.immutable_import_assert_cohort(anchor_oid oid,require_empty boolean)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; checked custodial_dr.immutable_private_import_context;
 relations oid[]; relation_oid oid; member jsonb; staged record; observed bigint; actual_count bigint;
 projection text; digest text;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 IF ctx.phase NOT IN('STAGING','INSERTING_ORDINARY_SET') OR require_empty IS NULL
 THEN RAISE EXCEPTION 'Original cohort phase unavailable';END IF;
 relations:=custodial_dr.immutable_import_fixed_cohort_relations(anchor_oid);
 IF relations IS NULL OR cardinality(relations) NOT IN(2,3) THEN RAISE EXCEPTION 'Unknown original cohort';END IF;
 FOREACH relation_oid IN ARRAY relations LOOP
  SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
   JOIN pg_catalog.pg_class c ON c.oid=relation_oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE v->>'schema_name'=n.nspname AND v->>'table_name'=c.relname;
  IF (member->>'row_count')::bigint<=0 THEN RAISE EXCEPTION 'Original cohort requires every nonempty member';END IF;
  IF require_empty THEN
   EXECUTE format('SELECT count(*) FROM ONLY %s',relation_oid::regclass) INTO actual_count;
   IF actual_count<>0 THEN RAISE EXCEPTION 'Original cohort target is not empty';END IF;
  END IF;
  observed:=0;
  FOR staged IN SELECT s.* FROM custodial_dr.immutable_ordinary_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
    AND s.table_oid=relation_oid ORDER BY s.ordinal LOOP
   observed:=observed+1;
   IF staged.ordinal IS DISTINCT FROM observed OR staged.original_row_sha256 IS DISTINCT FROM
    encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex')
   THEN RAISE EXCEPTION 'Original cohort ordinal or raw hash differs';END IF;
   EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',relation_oid::regclass)
    INTO projection USING staged.original_row_utf8;
   IF projection IS DISTINCT FROM staged.typed_original_text THEN RAISE EXCEPTION 'Original cohort typed projection differs';END IF;
  END LOOP;
  IF observed<>(member->>'row_count')::bigint THEN RAISE EXCEPTION 'Original cohort source incomplete';END IF;
 END LOOP;
 SELECT encode(extensions.digest(convert_to(string_agg(s.table_oid::text||':'||s.ordinal::text||':'||s.original_row_sha256,E'\n' ORDER BY s.table_oid,s.ordinal),'UTF8'),'sha256'),'hex')
  INTO digest FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=ANY(relations);
 IF digest IS NULL THEN RAISE EXCEPTION 'Original cohort digest unavailable';END IF;
 checked:=custodial_dr.immutable_import_assert_context();
 IF checked IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Original cohort context changed';END IF;
 RETURN digest;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_active_cohort_relation(table_oid oid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; relations oid[]; relation_oid oid; expected bigint; observed bigint;
BEGIN
 IF pg_catalog.pg_trigger_depth()<>1 OR NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN RETURN false;END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 IF ctx.phase<>'INSERTING_ORDINARY_SET' THEN RETURN false;END IF;
 relations:=custodial_dr.immutable_import_fixed_cohort_relations(ctx.active_table_oid);
 IF relations IS NULL OR NOT(table_oid=ANY(relations)) THEN RETURN false;END IF;
 -- A normal single-table staged import may use the same anchor. It remains
 -- on its unchanged path unless the complete fixed cohort was staged.
 FOREACH relation_oid IN ARRAY relations LOOP
  SELECT (v->>'row_count')::bigint INTO STRICT expected FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
   JOIN pg_catalog.pg_class c ON c.oid=relation_oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE v->>'schema_name'=n.nspname AND v->>'table_name'=c.relname;
  SELECT count(*) INTO observed FROM custodial_dr.immutable_ordinary_import_rows s
   WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=relation_oid;
  IF expected<=0 OR observed<>expected THEN RETURN false;END IF;
 END LOOP;
 RETURN custodial_dr.immutable_import_assert_cohort(ctx.active_table_oid,false)=ctx.active_row_sha256;
END $fn$;

CREATE FUNCTION custodial_dr.immutable_import_matches_cohort_staged(table_oid oid,original_row json)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; checked custodial_dr.immutable_private_import_context; matches boolean;
BEGIN
 IF original_row IS NULL OR json_typeof(original_row)<>'object'
  OR custodial_dr.immutable_import_active_cohort_relation(table_oid) IS NOT TRUE THEN RETURN false;END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 SELECT EXISTS(SELECT 1 FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=$1 AND s.typed_original_text=original_row::text) INTO matches;
 checked:=custodial_dr.immutable_import_assert_context();
 IF checked IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Original cohort matching context changed';END IF;
 RETURN matches;
END $fn$;

CREATE FUNCTION custodial_dr.insert_staged_immutable_ordinary_cohort(anchor_oid oid,expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context; witness jsonb; relations oid[]; relation_oid oid;
 digest text; columns_sql text; select_sql text; ctes text[]:=ARRAY[]::text[]; returns text[]:=ARRAY[]::text[];
 index_value integer:=0; mismatches bigint; statement text;
BEGIN
 ctx:=custodial_dr.immutable_import_assert_context();
 witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM witness THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs';END IF;
 IF ctx.phase<>'STAGING' THEN RAISE EXCEPTION 'Original cohort set refused';END IF;
 relations:=custodial_dr.immutable_import_fixed_cohort_relations(anchor_oid);
 IF relations IS NULL THEN RAISE EXCEPTION 'Unknown original cohort';END IF;
 digest:=custodial_dr.immutable_import_assert_cohort(anchor_oid,true);
 FOREACH relation_oid IN ARRAY relations LOOP
  index_value:=index_value+1;
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum),string_agg('r.'||quote_ident(a.attname),',' ORDER BY a.attnum)
   INTO columns_sql,select_sql FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='';
  IF columns_sql IS NULL THEN RAISE EXCEPTION 'Original cohort generated-only relation unsupported';END IF;
  ctes:=array_append(ctes,format('i_%s AS (INSERT INTO %s AS imported (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM custodial_dr.immutable_ordinary_import_rows s CROSS JOIN LATERAL custodial_dr.immutable_import_decode_record(null::%s,s.original_row_utf8) r WHERE s.database_oid=$1 AND s.backend_pid=$2 AND s.transaction_id=$3 AND s.table_oid=($4::oid[])[%s] ORDER BY s.ordinal RETURNING %s::oid AS table_oid,custodial_dr.immutable_import_row_projection(imported) AS image)',
   index_value,relation_oid::regclass,columns_sql,select_sql,relation_oid::regclass,index_value,relation_oid));
  returns:=array_append(returns,format('SELECT table_oid,image FROM i_%s',index_value));
 END LOOP;
 statement:='WITH '||array_to_string(ctes,',')||',actual AS (SELECT table_oid,image,count(*) n FROM ('||array_to_string(returns,' UNION ALL ')||') returned GROUP BY table_oid,image),expected AS (SELECT table_oid,typed_original_text image,count(*) n FROM custodial_dr.immutable_ordinary_import_rows WHERE database_oid=$1 AND backend_pid=$2 AND transaction_id=$3 AND table_oid=ANY($4::oid[]) GROUP BY table_oid,typed_original_text),mismatch AS ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) SELECT count(*) FROM mismatch';
 UPDATE custodial_dr.immutable_private_import_context SET phase='INSERTING_ORDINARY_SET',active_table_oid=anchor_oid,active_row_sha256=digest
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 EXECUTE statement INTO mismatches USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,relations;
 IF mismatches<>0 THEN RAISE EXCEPTION 'Original cohort RETURNING multiset differs';END IF;
 PERFORM custodial_dr.immutable_import_assert_context();
 UPDATE custodial_dr.immutable_private_import_context SET phase='STAGING',active_table_oid=NULL,active_row_sha256=NULL
  WHERE database_oid=ctx.database_oid AND backend_pid=ctx.backend_pid AND transaction_id=ctx.transaction_id;
 PERFORM custodial_dr.immutable_import_assert_context();
 RETURN witness;
END $fn$;

DO $cohort_acl$
DECLARE f record;a record;
BEGIN
 FOR f IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_dr' AND p.proname IN('immutable_import_fixed_cohort_relations','immutable_import_assert_cohort',
   'immutable_import_active_cohort_relation','immutable_import_matches_cohort_staged','insert_staged_immutable_ordinary_cohort') LOOP
  IF f.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) OR current_user<>session_user OR current_user<>'postgres'
  THEN RAISE EXCEPTION 'Original cohort function owner differs';END IF;
  FOR a IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=f.oid),acldefault('f',f.proowner))) WHERE grantee<>f.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.oid::regprocedure,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
 END LOOP;
END $cohort_acl$;
