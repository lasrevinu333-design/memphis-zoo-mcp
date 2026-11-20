-- Preserve the exact already-applied compatibility function and its denied
-- browser/service grants during recovery. Does not replace the newer scheduler.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE preserved_coverall_unrelated ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $bind$
DECLARE signature constant text:='custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)';function_oid oid;actual text;grant_sql text;old_surface text;new_surface text;
 current_saved public.custodial_release_authority_restore_inventory%ROWTYPE;next_order integer;changed integer;
BEGIN
 function_oid:=to_regprocedure('public.'||signature);
 IF function_oid IS NULL OR public.static_weekly_digest_text(pg_get_functiondef(function_oid))<>'5bdb1a0874cccc02f6612a04277caa774cc8e232313dafd4dfc6bfe19d97cdf8' THEN
  RAISE EXCEPTION 'Applied compatibility validator differs from reviewed source';END IF;
 IF has_function_privilege('anon',function_oid,'EXECUTE') OR has_function_privilege('authenticated',function_oid,'EXECUTE')
  OR has_function_privilege('service_role',function_oid,'EXECUTE') OR NOT has_function_privilege('static_weekly_control_plane',function_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'Applied compatibility grants differ from the admitted source';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind IN ('function','grant') AND object_identity=signature) THEN
  RAISE EXCEPTION 'Compatibility validator recovery was already captured; reconcile source';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='O') THEN RAISE EXCEPTION 'Inventory immutability guard missing';END IF;
 old_surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF public.static_weekly_digest_text(old_surface)<>'f877d8cacc8090426fb3fef36a2219aa6010ae203a53a7f5def0782a707e77c7' THEN RAISE EXCEPTION 'Unexpected canary predecessor';END IF;
 SELECT * INTO STRICT current_saved FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function' AND object_identity='custodial_release_canary_authority_surface()';
 IF current_saved.definition_sql IS DISTINCT FROM old_surface OR current_saved.definition_sha256<>'f877d8cacc8090426fb3fef36a2219aa6010ae203a53a7f5def0782a707e77c7' THEN RAISE EXCEPTION 'Saved canary predecessor changed';END IF;
 grant_sql:=public.custodial_release_authority_current_grant_definition(signature);IF grant_sql IS NULL THEN RAISE EXCEPTION 'Grant serializer unavailable';END IF;
 new_surface:=replace(old_surface,'  values',E'  values\n'||$entries$    ('function','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),
    ('grant','custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb)','preserve separately applied CoverAll compatibility validator'),
$entries$);
 IF public.static_weekly_digest_text(new_surface)<>'78bf7e443aeeeed42b5a7129678bd12d97f26fa43bce714b53f7199991c451fc' THEN RAISE EXCEPTION 'Derived canary target differs';END IF;
 EXECUTE new_surface;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure))<>'78bf7e443aeeeed42b5a7129678bd12d97f26fa43bce714b53f7199991c451fc' THEN RAISE EXCEPTION 'Installed canary target differs';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 SELECT max(restore_order)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function';
 actual:=pg_get_functiondef(function_oid);
 INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) VALUES(next_order,'function',signature,actual,public.static_weekly_digest_text(actual));
 SELECT max(restore_order)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='grant';
 INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) VALUES(next_order,'grant',signature,grant_sql,public.static_weekly_digest_text(grant_sql));
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=new_surface,definition_sha256='78bf7e443aeeeed42b5a7129678bd12d97f26fa43bce714b53f7199991c451fc',captured_at=statement_timestamp()
 WHERE inventory_id=current_saved.inventory_id AND definition_sha256='f877d8cacc8090426fb3fef36a2219aa6010ae203a53a7f5def0782a707e77c7';
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Canary update scope changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT u.* FROM preserved_coverall_unrelated u WHERE u.inventory_id<>current_saved.inventory_id EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE i.inventory_id<>current_saved.inventory_id AND NOT(i.object_kind IN ('function','grant') AND i.object_identity=signature) EXCEPT SELECT * FROM preserved_coverall_unrelated) THEN RAISE EXCEPTION 'Unrelated recovery inventory changed';END IF;
 IF (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN ('function','grant') AND object_identity=signature)<>2 THEN RAISE EXCEPTION 'Compatibility recovery surface incomplete';END IF;
END $bind$;
COMMIT;
