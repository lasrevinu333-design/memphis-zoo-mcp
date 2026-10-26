-- Forward-only exact recovery declarations. No runtime function/grant change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_recovery_identity_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE schedule_recovery_identity_surface_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
CREATE TEMP TABLE schedule_recovery_identity_functions_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid IN(
 'public.custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)'::regprocedure,
 'public.custodial_native_schedule_live(uuid,jsonb,timestamptz)'::regprocedure,
 'public.custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)'::regprocedure);
DO $repair$
DECLARE old_body text;patched text;old_id text;canonical_id text;old_token text;new_token text;matches integer;changed integer;
 surface constant regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
BEGIN
 SELECT definition INTO STRICT old_body FROM schedule_recovery_identity_surface_before;
 IF public.static_weekly_digest_text(old_body)<>'2bd75e6d158615b18975e878cc5ddaed8a1aece6a07cc4d166352e96f3b68658'
  OR (SELECT count(*) FROM schedule_recovery_identity_functions_before)<>3
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
   AND to_regprocedure(object_identity)=surface AND definition_sql=old_body
   AND definition_sha256=public.static_weekly_digest_text(old_body)) THEN
  RAISE EXCEPTION 'Exact249 recovery declaration predecessor/guard changed';END IF;
 patched:=old_body;
 FOR old_id IN SELECT unnest(ARRAY[
  'custodial_native_schedule_event_binding(uuid,jsonb,uuid,timestamptz)',
  'custodial_native_schedule_live(uuid,jsonb,timestamptz)',
  'custodial_native_schedule_observation_originals_at(uuid,text,jsonb,timestamptz)']) LOOP
  canonical_id:=replace(old_id,'timestamptz','timestamp with time zone');
  IF to_regprocedure('public.'||old_id) IS NULL
   OR to_regprocedure('public.'||old_id) IS DISTINCT FROM to_regprocedure('public.'||canonical_id)
   OR to_regprocedure('public.'||canonical_id)::text<>canonical_id THEN
   RAISE EXCEPTION 'Exact schedule recovery identity does not name original function';END IF;
  old_token:=quote_literal(old_id);new_token:=quote_literal(canonical_id);
  IF (length(patched)-length(replace(patched,old_token,'')))/length(old_token)<>2
   OR position(new_token IN patched)>0 THEN
   RAISE EXCEPTION 'Exact schedule function/grant source declaration seam changed';END IF;
  SELECT count(*) INTO matches FROM public.custodial_release_authority_restore_inventory
   WHERE object_kind IN('function','grant') AND object_identity=canonical_id;
  IF matches<>2 OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
   WHERE object_kind IN('function','grant') AND object_identity=old_id) THEN
   RAISE EXCEPTION 'Exact original schedule recovery rows missing/ambiguous';END IF;
  patched:=replace(patched,old_token,new_token);
 END LOOP;
 EXECUTE patched;
 IF pg_get_functiondef(surface) IS DISTINCT FROM patched
  OR (SELECT proowner FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT proowner FROM schedule_recovery_identity_surface_before)
  OR (SELECT proacl FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT proacl FROM schedule_recovery_identity_surface_before) THEN
  RAISE EXCEPTION 'Schedule declaration correction changed surface owner/ACL or body';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=patched,definition_sha256=public.static_weekly_digest_text(patched),captured_at=statement_timestamp()
  WHERE object_kind='function' AND to_regprocedure(object_identity)=surface AND definition_sql=old_body;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Exact surface recovery row changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
END $repair$;
DO $scope$
DECLARE surface constant regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
  <> (SELECT count(*) FROM schedule_recovery_identity_inventory_before)
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface())<>755
  OR EXISTS(SELECT old.* FROM schedule_recovery_identity_inventory_before old
   WHERE NOT(CASE WHEN old.object_kind='function' AND old.object_identity LIKE '%(%'
     THEN to_regprocedure(old.object_identity)=surface ELSE false END)
   EXCEPT SELECT now.* FROM public.custodial_release_authority_restore_inventory now)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now
   WHERE NOT(CASE WHEN now.object_kind='function' AND now.object_identity LIKE '%(%'
     THEN to_regprocedure(now.object_identity)=surface ELSE false END)
   EXCEPT SELECT old.* FROM schedule_recovery_identity_inventory_before old)
  OR EXISTS(SELECT 1 FROM schedule_recovery_identity_functions_before old JOIN pg_proc now ON now.oid=old.oid
   WHERE now.proowner IS DISTINCT FROM old.proowner OR now.proacl IS DISTINCT FROM old.proacl
    OR pg_get_functiondef(now.oid) IS DISTINCT FROM old.definition)
  OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() s WHERE NOT EXISTS(
   SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   WHERE i.object_kind=s.object_kind AND i.object_identity=s.object_identity))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Schedule recovery declaration correction scope/coverage/guard failed';END IF;
END $scope$;
COMMIT;
