-- Contractor capacity is not an enrolled employee. Preserve the exact
-- employee refresh-set equality; exclude only absent employee identities in
-- the new assignment branch, matching the existing typed refresh reader.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE staffing_refresh_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE staffing_refresh_function_before ON COMMIT DROP AS
 SELECT oid,proacl,proowner,proconfig,pg_get_functiondef(oid) definition
 FROM pg_proc WHERE oid='public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)'::regprocedure;

DO $source$ DECLARE before text;after text;changed integer;target regprocedure;
 needle constant text:=$needle$where lower(assignment->>'status')='assigned' and assignment->>'service_date' between command.start_date::text and command.end_date::text$needle$;
 replacement constant text:=$replacement$where lower(assignment->>'status')='assigned' and assignment->>'owner_person_id' is not null
    and assignment->>'service_date' between command.start_date::text and command.end_date::text$replacement$;
BEGIN
 target:='public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)'::regprocedure;
 SELECT definition INTO STRICT before FROM staffing_refresh_function_before;
 IF (SELECT public.static_weekly_digest_text(prosrc) FROM pg_proc WHERE oid=target)
   IS DISTINCT FROM '78427ecee0fb6f4f8e5bf9ed31131619fe4b22440ffa83a0155708adf0627485'
  OR (SELECT octet_length(convert_to(prosrc,'UTF8')) FROM pg_proc WHERE oid=target)<>21243
  OR (length(before)-length(replace(before,needle,'')))/length(needle)<>1
  OR EXISTS(SELECT 1 FROM staffing_refresh_inventory_before
   WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (SELECT count(*) FROM staffing_refresh_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target AND definition_sql=before)<>1
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface()
    WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Staffing refresh exact source/recovery predecessor changed';END IF;
 after:=replace(before,needle,replacement);EXECUTE after;
 IF pg_get_functiondef(target) IS DISTINCT FROM after
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proacl FROM staffing_refresh_function_before)
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proowner FROM staffing_refresh_function_before)
  OR (SELECT proconfig FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proconfig FROM staffing_refresh_function_before)
 THEN RAISE EXCEPTION 'Staffing refresh correction changed source attributes or ACL';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=after,
  definition_sha256=public.static_weekly_digest_text(after),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target AND definition_sql=before;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Staffing refresh exact recovery row changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM staffing_refresh_inventory_before)
  OR EXISTS(SELECT old.* FROM staffing_refresh_inventory_before old WHERE NOT(object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT current.* FROM public.custodial_release_authority_restore_inventory current WHERE NOT(object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
    EXCEPT SELECT * FROM staffing_refresh_inventory_before)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Staffing refresh unrelated recovery scope changed';END IF;
END $source$;
COMMIT;
