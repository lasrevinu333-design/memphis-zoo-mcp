-- UNAPPLIED source254. Server-only complete opaque frame read in one current
-- SQL snapshot. This is not namespace decryption/semantic ACK or key release.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE complete_frame_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE complete_frame_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ DECLARE body text;digest text;BEGIN
 SELECT definition INTO STRICT body FROM complete_frame_surface_before;
 SELECT encode(extensions.digest(convert_to('['||string_agg(
  '{"object_kind":'||to_json(object_kind)::text||',"object_identity":'||to_json(object_identity)::text||
  ',"restore_order":'||restore_order::text||',"definition_sha256":'||to_json(definition_sha256)::text||'}',','
  ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")||']','UTF8'),'sha256'),'hex')
  INTO digest FROM complete_frame_inventory_before;
 IF (SELECT count(*) FROM complete_frame_inventory_before)<>6968
  OR digest IS DISTINCT FROM 'a91fbc08292f22ba4e1fa326be6fd692777339fc2012b3cd86b80c63f98f26bc'
  OR EXISTS(SELECT 1 FROM complete_frame_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR NOT EXISTS(SELECT 1 FROM complete_frame_inventory_before WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='custodial_private_custody_v1_read_complete_frame')
 THEN RAISE EXCEPTION 'Complete frame exact source253 recovery predecessor changed';END IF;
END $predecessor$;

-- A narrowly scoped privileged lookup is necessary because the existing
-- opaque tables are FORCE-RLS/internal and have NO direct runtime grants.
-- Its only entry is the same exact current credential/generation/original
-- write target already checked by the owning fixed reader, in this snapshot.
CREATE FUNCTION public.custodial_private_custody_v1_read_complete_frame(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE target jsonb;op public.custodial_native_private_custody_operations%rowtype;row_count integer;frame bytea;
BEGIN
 target:=public.custodial_private_custody_v1_read_chunk(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest);
 IF target IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations
  WHERE operation_id=p_operation AND device_id=p_device AND credential_id=p_credential AND generation_id=p_generation;
 SELECT count(*) INTO row_count FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation;
 IF row_count>op.chunk_count OR EXISTS(
  SELECT 1 FROM public.custodial_native_private_custody_chunks c WHERE c.operation_id=p_operation AND
   (c.chunk_index>=op.chunk_count OR octet_length(c.chunk_bytes)<>least(24576,op.frame_bytes-c.chunk_index*24576)
    OR c.chunk_sha256 IS DISTINCT FROM encode(extensions.digest(c.chunk_bytes,'sha256'),'hex')
    OR c.request_body_sha256 IS DISTINCT FROM encode(extensions.digest(c.request_bytes,'sha256'),'hex')))
 THEN RAISE EXCEPTION USING errcode='23514',message='complete original custody chunk closure mismatch';END IF;
 IF row_count<op.chunk_count THEN
  RETURN jsonb_build_object('schema','custodial.private-custody-complete-frame-SQL-input.v1',
   'state','INCOMPLETE_ORIGINAL_OPAQUE_FRAME','readback',target,'frame_bytes',op.frame_bytes,'frame_sha256',op.frame_sha256,
   'record_sha256',op.record_sha256,'plan_sha256',op.plan_sha256,'chunk_count',op.chunk_count,'received_chunk_count',row_count,'frame_base64',NULL);
 END IF;
 -- Unique immutable (operation,index) rows and exact bounded count/length
 -- imply every original index exists. Ordered binary concatenation is not a
 -- new request, write, retry or change to any retained row.
 SELECT string_agg(chunk_bytes,''::bytea ORDER BY chunk_index) INTO frame
  FROM public.custodial_native_private_custody_chunks WHERE operation_id=p_operation;
 IF octet_length(frame) IS DISTINCT FROM op.frame_bytes
  OR encode(extensions.digest(frame,'sha256'),'hex') IS DISTINCT FROM op.frame_sha256
 THEN RAISE EXCEPTION USING errcode='23514',message='complete original custody frame bytes mismatch';END IF;
 RETURN jsonb_build_object('schema','custodial.private-custody-complete-frame-SQL-input.v1',
  'state','COMPLETE_ORIGINAL_OPAQUE_FRAME_BYTES_ONLY','readback',target,'frame_bytes',op.frame_bytes,'frame_sha256',op.frame_sha256,
  'record_sha256',op.record_sha256,'plan_sha256',op.plan_sha256,'chunk_count',op.chunk_count,'received_chunk_count',row_count,
  'frame_base64',replace(encode(frame,'base64'),E'\n',''));
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)
 TO service_role,custodial_application_reader;

CREATE TEMP TABLE complete_frame_objects ON COMMIT DROP AS
 SELECT 100000 bucket,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition
  FROM pg_proc WHERE oid='public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure
 UNION ALL SELECT 900000,'grant','public.'||oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text)
  FROM pg_proc WHERE oid='public.custodial_private_custody_v1_read_complete_frame(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure;
DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 IF (SELECT count(*) FROM complete_frame_objects)<>2 OR EXISTS(SELECT 1 FROM complete_frame_objects WHERE definition IS NULL)
  OR EXISTS(SELECT 1 FROM complete_frame_inventory_before i JOIN complete_frame_objects x ON x.kind=i.object_kind AND x.identity=i.object_identity)
 THEN RAISE EXCEPTION 'Complete frame finite new function/grant declaration changed';END IF;
 SELECT definition INTO STRICT original FROM complete_frame_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('current original opaque frame bytes/syntax only; no ACK, decryption, work, finalizer or key authority')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM complete_frame_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM (SELECT acl FROM complete_frame_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM (SELECT owner FROM complete_frame_surface_before)
 THEN RAISE EXCEPTION 'Complete frame canary owner/ACL/body changed beyond declared source';END IF;
END $surface$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;n integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM complete_frame_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Complete frame canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM complete_frame_objects ORDER BY bucket,identity LOOP
  SELECT candidate INTO n FROM generate_series(obj.bucket+1,obj.bucket+99998) candidate
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=candidate) ORDER BY candidate LIMIT 1;
  IF n IS NULL THEN RAISE EXCEPTION 'Complete frame recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(n,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>6970
  OR EXISTS(SELECT old.* FROM complete_frame_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT 1 FROM complete_frame_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Complete frame exact new recovery scope/ALWAYS guard changed';END IF;
END $scope$;
COMMIT;
