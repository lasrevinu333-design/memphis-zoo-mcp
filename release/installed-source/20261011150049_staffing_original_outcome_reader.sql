-- Source only. Exact original manager/key/operation readback; never replay a writer.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE staffing_original_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE staffing_original_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ DECLARE body text;BEGIN
 SELECT definition INTO STRICT body FROM staffing_original_surface_before;
 IF EXISTS(SELECT 1 FROM staffing_original_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR NOT EXISTS(SELECT 1 FROM staffing_original_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure AND definition_sql=body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regprocedure('public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'Staffing original reader recovery predecessor changed';END IF;
END $predecessor$;

-- Narrow definer lookup is needed because command tables remain RPC-only.
-- Existing control-plane role AND current named-manager registry are required;
-- no browser role, service role, new login, token, or table grant is introduced.
CREATE FUNCTION public.static_weekly_read_original_staffing_outcome_v1(
 p_manager_id uuid,p_idempotency_key text,p_operation text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE original public.weekly_schedule_command_receipts%rowtype;completed jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_assert_manager(p_manager_id);
 PERFORM public.static_weekly_v3_manager_actor(p_manager_id);
 IF p_manager_id IS NULL OR p_operation IS NULL
  OR p_operation NOT IN ('vacate_roster_slot','fill_vacant_slot','restore_existing_employee')
  OR nullif(btrim(p_idempotency_key),'') IS NULL OR p_idempotency_key<>btrim(p_idempotency_key)
  OR char_length(p_idempotency_key)>200 THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact original staffing manager, operation and key required';
 END IF;
 SELECT * INTO original FROM public.weekly_schedule_command_receipts
  WHERE actor_manager_id=p_manager_id AND idempotency_key=p_idempotency_key AND command_type=p_operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema','custodial.original-staffing-outcome.v1',
  'state','OUTCOME_UNCONFIRMED','manager_id',p_manager_id,'operation',p_operation,
  'idempotency_key',p_idempotency_key,'retry_safe',false,'phone_released',false);END IF;
 PERFORM public.static_weekly_v8_assert_vacancy_receipt(original.command_id,p_operation);
 completed:=public.static_weekly_v9_read_completed_roster_change(p_manager_id,p_idempotency_key,p_operation);
 IF completed IS NULL THEN RAISE EXCEPTION USING errcode='23514',message='Original staffing completion unavailable';END IF;
 RETURN jsonb_build_object('schema','custodial.original-staffing-outcome.v1','state','ACCEPTED_ORIGINAL',
  'manager_id',p_manager_id,'operation',p_operation,'idempotency_key',p_idempotency_key,
  'command_id',original.command_id,'original_request',original.request_canonical_json,
  'original_request_digest',original.request_digest,'receipt',completed,'retry_safe',false,'phone_released',false);
END $fn$;
REVOKE ALL ON FUNCTION public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)
 FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)
 TO static_weekly_control_plane;

CREATE TEMP TABLE staffing_original_objects ON COMMIT DROP AS
 WITH f AS(SELECT 'public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)'::regprocedure oid)
 SELECT 100000 bucket,0 priority,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM f
 UNION ALL SELECT 900000,0,'grant','public.'||oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM f;
DO $objects$ BEGIN
 IF (SELECT count(*) FROM staffing_original_objects)<>2
  OR EXISTS(SELECT 1 FROM staffing_original_objects WHERE definition IS NULL)
  OR EXISTS(SELECT 1 FROM staffing_original_inventory_before old JOIN staffing_original_objects x ON x.kind=old.object_kind AND x.identity=old.object_identity)
 THEN RAISE EXCEPTION 'Staffing original reader finite recovery declaration changed';END IF;
END $objects$;
DO $private_surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM staffing_original_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('exact original staffing command readback only; no mutation, resend or phone release')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM staffing_original_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM staffing_original_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM staffing_original_surface_before)
 THEN RAISE EXCEPTION 'Staffing readback canary owner/ACL/body changed outside exact finite extension';END IF;
END $private_surface$;
-- Same normal, exclusive-lock, exact-predecessor inventory extension used by
-- the existing source251/252 migration controls. No application guard is changed.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM staffing_original_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Staffing readback exact canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM staffing_original_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Staffing readback finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $private_recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM staffing_original_inventory_before)+(SELECT count(*) FROM staffing_original_objects)
  OR EXISTS(SELECT old.* FROM staffing_original_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM staffing_original_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM staffing_original_inventory_before)
  OR EXISTS(SELECT 1 FROM staffing_original_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Staffing readback unrelated recovery scope, exact new bytes or final ALWAYS inventory guard changed';END IF;
END $private_scope$;
COMMIT;



