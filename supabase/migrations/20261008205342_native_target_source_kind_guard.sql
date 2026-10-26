-- Reject a missing native source kind before any actor/source lookup.
-- One argument-guard change only; no new caller, permission, delivery or history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE native_source_kind_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $source_kind$
DECLARE
 fn constant regprocedure:='public.custodial_native_target_source_at(text,uuid,uuid,uuid,timestamptz)'::regprocedure;
 expected_body_sha256 constant text:='90760fd2d4f03e4022718179f1e9395b5d31b211ca88a52fc65dd82d38102d10';
 old_guard constant text:=$old$if p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null$old$;
 new_guard constant text:=$new$if p_kind is null or p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null$new$;
 body text;definition text;patched text;original_acl aclitem[];original_owner oid;
 saved public.custodial_release_authority_restore_inventory%ROWTYPE;changed integer;
BEGIN
 SELECT prosrc,proacl,proowner INTO STRICT body,original_acl,original_owner FROM pg_proc WHERE oid=fn;
 definition:=pg_get_functiondef(fn);
 IF public.static_weekly_digest_text(body) IS DISTINCT FROM expected_body_sha256 THEN
  RAISE EXCEPTION 'Native source kind exact predecessor changed';END IF;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='function' AND to_regprocedure(object_identity)=fn;
 IF saved.definition_sql IS DISTINCT FROM definition
  OR saved.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition) THEN
  RAISE EXCEPTION 'Native source kind recovery predecessor changed';END IF;
 IF (length(body)-length(replace(body,old_guard,'')))/length(old_guard)<>1
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1 THEN
  RAISE EXCEPTION 'Native source kind replacement seam changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Native source kind ALWAYS recovery guard missing';END IF;
 patched:=replace(definition,body,replace(body,old_guard,new_guard));
 EXECUTE patched;
 IF pg_get_functiondef(fn) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_acl
  OR (SELECT proowner FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_owner THEN
  RAISE EXCEPTION 'Native source kind function metadata changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=pg_get_functiondef(fn),definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(fn)),captured_at=statement_timestamp()
  WHERE inventory_id=saved.inventory_id AND object_kind='function' AND definition_sql=definition
   AND definition_sha256=saved.definition_sha256;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Native source kind recovery update scope changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT u.* FROM native_source_kind_inventory_before u WHERE u.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE i.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM native_source_kind_inventory_before) THEN
  RAISE EXCEPTION 'Unrelated native source kind inventory changed';END IF;
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_acl
  OR (SELECT proowner FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_owner
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Native source kind final privilege/guard readback changed';END IF;
END $source_kind$;
COMMIT;
