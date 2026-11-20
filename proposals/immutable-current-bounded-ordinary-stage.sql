-- Current postgres bounded staging only; no target DATA insertion.
-- Uses the existing authenticated reader's64KiB chunk ceiling. All original
-- EOF/digest/count checks and the existing final table/cohort INSERT remain.
CREATE FUNCTION custodial_dr.stage_immutable_ordinary_rows(schema_name text,table_name text,first_ordinal bigint,original_rows_utf8 text[],expected_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE ctx custodial_dr.immutable_private_import_context;checked custodial_dr.immutable_private_import_context;
 member jsonb;target_oid oid;actual_witness jsonb;row_text text;keys text[];batch_count integer;
 prior_count bigint;prior_first bigint;prior_last bigint;observed bigint;written bigint;after_count bigint;after_last bigint;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original batch staging owner required';END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 actual_witness:=jsonb_build_object('database_oid',ctx.database_oid::text,'backend_pid',ctx.backend_pid,
  'transaction_id',ctx.transaction_id::text,'restore_id',ctx.restore_id::text,
  'authority_generation',ctx.authority_generation::text,'archive_digest',ctx.archive_digest);
 IF expected_context IS DISTINCT FROM actual_witness THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Immutable import original mutation witness differs';END IF;
 batch_count:=cardinality(original_rows_utf8);
 IF ctx.phase<>'STAGING' OR schema_name NOT IN('public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private')
  OR (schema_name='public' AND table_name IN('release_deployment_manifest','custodial_release_authority_restore_inventory'))
  OR first_ordinal IS NULL OR first_ordinal<1 OR original_rows_utf8 IS NULL
  OR array_ndims(original_rows_utf8) IS DISTINCT FROM 1 OR array_lower(original_rows_utf8,1) IS DISTINCT FROM 1
  OR batch_count IS NULL OR batch_count<1 OR batch_count>65536
  OR EXISTS(SELECT 1 FROM unnest(original_rows_utf8) r WHERE r IS NULL OR r='')
  OR (SELECT sum(octet_length(r)) FROM unnest(original_rows_utf8) r)>65536
 THEN RAISE EXCEPTION 'Bounded original batch staging refused';END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
  WHERE v->>'schema_name'=schema_name AND v->>'table_name'=table_name;
 IF member->>'data_encoding' IS DISTINCT FROM 'postgres-text-columns-line.v2' THEN
  RAISE EXCEPTION 'Original batch requires the authenticated typed-text encoding';END IF;
 target_oid:=to_regclass(format('%I.%I',schema_name,table_name));
 IF target_oid IS NULL THEN RAISE EXCEPTION 'Immutable original relation unavailable';END IF;
 EXECUTE format('SELECT count(*) FROM ONLY %s',target_oid::regclass) INTO observed;
 IF observed<>0 THEN RAISE EXCEPTION 'Immutable ordinary target is not empty';END IF;
 SELECT count(*),min(s.ordinal),max(s.ordinal) INTO prior_count,prior_first,prior_last
  FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=target_oid;
 IF first_ordinal<>prior_count+1 OR (prior_count>0 AND(prior_first<>1 OR prior_last<>prior_count))
  OR prior_count+batch_count>(member->>'row_count')::bigint
 THEN RAISE EXCEPTION 'Immutable ordinary batch original ordinal differs';END IF;
 SELECT array_agg(a.attname::text ORDER BY a.attname) INTO keys FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=target_oid AND a.attnum>0 AND NOT a.attisdropped;
 FOREACH row_text IN ARRAY original_rows_utf8 LOOP
  IF json_typeof(row_text::json)<>'object' OR
   (SELECT array_agg(k ORDER BY k) FROM json_object_keys(row_text::json) k) IS DISTINCT FROM keys
  THEN RAISE EXCEPTION 'Immutable ordinary original columns mismatch';END IF;
 END LOOP;
 -- The fixed encoding is checked against the original member above. These
 -- are the same unchanged native typed codec and projection used by the
 -- single-row wrapper, with no repeated catalog-encoding lookup per row.
 EXECUTE format('INSERT INTO custodial_dr.immutable_ordinary_import_rows(database_oid,backend_pid,transaction_id,table_oid,ordinal,original_row_utf8,original_row_sha256,typed_original_text) SELECT $1,$2,$3,$4,$5+w.ordinality-1,w.raw,encode(extensions.digest(convert_to(w.raw,''UTF8''),''sha256''),''hex''),custodial_dr.immutable_import_text_projection(r) FROM unnest($6::text[]) WITH ORDINALITY w(raw,ordinality) CROSS JOIN LATERAL custodial_dr.immutable_import_text_record(null::%s,w.raw) r ORDER BY w.ordinality',target_oid::regclass)
  USING ctx.database_oid,ctx.backend_pid,ctx.transaction_id,target_oid,first_ordinal,original_rows_utf8;
 GET DIAGNOSTICS written=ROW_COUNT;
 SELECT count(*),max(s.ordinal) INTO after_count,after_last FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id AND s.table_oid=target_oid;
 IF written<>batch_count OR after_count<>prior_count+batch_count OR after_last<>after_count
 THEN RAISE EXCEPTION 'Immutable ordinary batch staged count differs';END IF;
 checked:=custodial_dr.immutable_import_assert_context();
 IF checked IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Original batch staging context changed';END IF;
 RETURN actual_witness;
END $fn$;
REVOKE ALL ON FUNCTION custodial_dr.stage_immutable_ordinary_rows(text,text,bigint,text[],jsonb)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader;
DO $bounded_stage_acl$
DECLARE f pg_catalog.pg_proc%rowtype;acl record;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original bounded staging owner required';END IF;
 SELECT * INTO STRICT f FROM pg_catalog.pg_proc
  WHERE oid='custodial_dr.stage_immutable_ordinary_rows(text,text,bigint,text[],jsonb)'::regprocedure;
 IF f.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) OR f.prosecdef THEN
  RAISE EXCEPTION 'Bounded staging owner or security mode differs';END IF;
 -- Retire every non-owner default grant too, including roles outside the
 -- public API role list. This entry never delegates original-owner effects.
 FOR acl IN SELECT DISTINCT a.grantee FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
  WHERE a.grantee<>f.proowner LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION custodial_dr.stage_immutable_ordinary_rows(text,text,bigint,text[],jsonb) FROM '
   ||CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(acl.grantee)) END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid=f.oid AND (a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 THEN RAISE EXCEPTION 'Bounded staging ACL is not owner-only';END IF;
END $bounded_stage_acl$;
