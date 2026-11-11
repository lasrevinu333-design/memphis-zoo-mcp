-- Extend the fixed approved-template READ DTO, not its admission policy.
-- Keep the compact release-entry fingerprint (including approval evidence)
-- and additionally return its exact entries plus the complete input digest.
-- The normal control plane verifies both, rather than confusing the two.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE approved_basis_inventory_before ON COMMIT DROP AS
 TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE approved_basis_function_before ON COMMIT DROP AS
 SELECT p.*,pg_get_functiondef(p.oid) AS definition_sql FROM pg_proc p
 WHERE p.oid='public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)'::regprocedure;

DO $basis_binding$
DECLARE target regprocedure:='public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)'::regprocedure;
 before_body text;after_body text;before_definition text;after_definition text;
 needle text:=$old$'currentSource',source_input,'ownerConfig',config,'templates',templates,'admittedBindings',bindings)$old$;
 replacement text:=$new$'currentSource',source_input,'ownerConfig',config,'templates',templates,'admittedBindings',bindings,
  'templateCatalogEntries',catalog,'templateInputsDigest',public.static_weekly_digest_jsonb(
   jsonb_build_object('templates',templates,'admittedBindings',bindings,'ownerConfig',config)))$new$;
BEGIN
 SELECT prosrc,definition_sql INTO STRICT before_body,before_definition FROM approved_basis_function_before;
 IF public.static_weekly_digest_text(before_body)<>'f3ca2f960e58dae917d38156a729eb3b2178a80b9a3ca64826f9b663c8cc87fe'
  OR (length(before_body)-length(replace(before_body,needle,'')))/length(needle)<>1
  OR current_user<>session_user
  OR (SELECT proowner FROM approved_basis_function_before)<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR NOT has_function_privilege('static_weekly_control_plane',target,'EXECUTE')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT tgisinternal AND tgenabled='A')
  OR (SELECT count(*) FROM approved_basis_inventory_before WHERE object_kind IN('function','grant')
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>2
  OR (SELECT count(*) FROM approved_basis_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=before_definition AND definition_sha256=public.static_weekly_digest_text(before_definition))<>1
 THEN RAISE EXCEPTION 'Approved basis exact predecessor, owner, recovery or ALWAYS guard differs';END IF;
 after_body:=replace(before_body,needle,replacement);
 after_definition:=replace(before_definition,before_body,after_body);
 IF replace(after_body,replacement,needle) IS DISTINCT FROM before_body
  OR replace(after_definition,after_body,before_body) IS DISTINCT FROM before_definition
 THEN RAISE EXCEPTION 'Approved basis READ binding substitution is not exactly reversible';END IF;
 EXECUTE after_definition;
 IF pg_get_functiondef(target) IS DISTINCT FROM after_definition
  OR (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM after_body
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN approved_basis_function_before old ON old.oid=p.oid
    WHERE ROW(p.proowner,p.proacl,p.proconfig,p.prolang,p.provolatile,p.proparallel,p.prosecdef,p.prorettype,
      p.proargtypes,p.proallargtypes,p.proargmodes,p.proargnames,p.proisstrict,p.proleakproof)
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,old.prosecdef,old.prorettype,
      old.proargtypes,old.proallargtypes,old.proargmodes,old.proargnames,old.proisstrict,old.proleakproof))
 THEN RAISE EXCEPTION 'Approved basis unrelated definition, owner, ACL or attributes changed';END IF;
END $basis_binding$;

-- Existing atomic source-migration registration, under the exclusive inventory
-- lock. No application row or privilege changes; restore ALWAYS before commit.
ALTER TABLE public.custodial_release_authority_restore_inventory
 DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $basis_recovery$
DECLARE target regprocedure:='public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)'::regprocedure;
 changed integer;
BEGIN
 UPDATE public.custodial_release_authority_restore_inventory i
  SET definition_sql=pg_get_functiondef(target),definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(target)),
   captured_at=statement_timestamp()
  WHERE i.object_kind='function' AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
   AND i.definition_sql=(SELECT old.definition_sql FROM approved_basis_inventory_before old WHERE old.inventory_id=i.inventory_id)
   AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Approved basis exact original recovery row changed';END IF;
END $basis_recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory
 ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $basis_scope$
DECLARE target regprocedure:='public.static_weekly_read_approved_template_basis(uuid,uuid,date,text,text,bigint)'::regprocedure;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM approved_basis_inventory_before)
  OR EXISTS(SELECT old.* FROM approved_basis_inventory_before old
    WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%' AND to_regprocedure(old.object_identity)=target)
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT live.* FROM public.custodial_release_authority_restore_inventory live
    WHERE NOT(live.object_kind='function' AND live.object_identity LIKE '%(%' AND to_regprocedure(live.object_identity)=target)
    EXCEPT SELECT * FROM approved_basis_inventory_before)
  OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='function'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
    AND i.definition_sql=pg_get_functiondef(target) AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql))<>1
  OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
    AND i.definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity))<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT tgisinternal AND tgenabled='A')
 THEN RAISE EXCEPTION 'Approved basis unrelated recovery, grants or ALWAYS guard changed';END IF;
END $basis_scope$;
COMMIT;
