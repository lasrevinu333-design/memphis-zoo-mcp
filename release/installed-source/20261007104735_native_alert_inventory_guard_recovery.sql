-- Forward-only correction for the existing native-alert ALWAYS guard.
-- The 232-source inventory still serialized its historical ordinary ENABLE
-- state. Restore must not downgrade the already stronger live trigger.
-- No business records, callable functions, ACLs or historical SQL are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE native_guard_unrelated_inventory ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $rebind$
DECLARE
 identity constant text:='public.custodial_release_authority_restore_inventory.trg_custodial_release_authority_restore_inventory_immutable';
 before_hash constant text:='ff48cf273742e44575d014d0fcf978fe955e809d7949090e844458aca60b7372';
 after_hash constant text:='b3ab6991571f3d233ec13116b59229d4c06f8a5a0205cb097949a5335d3172b8';
 before_sql constant text:=$definition$drop trigger if exists trg_custodial_release_authority_restore_inventory_immutable on public.custodial_release_authority_restore_inventory; CREATE TRIGGER trg_custodial_release_authority_restore_inventory_immutable BEFORE DELETE OR UPDATE ON custodial_release_authority_restore_inventory FOR EACH ROW EXECUTE FUNCTION custodial_reject_release_authority_inventory_mutation(); alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;$definition$;
 after_sql text;actual_sql text;changed integer;
 saved public.custodial_release_authority_restore_inventory%ROWTYPE;
BEGIN
 after_sql:=replace(before_sql,' enable trigger ',' enable always trigger ');
 IF public.static_weekly_digest_text(before_sql)<>before_hash
  OR public.static_weekly_digest_text(after_sql)<>after_hash THEN
  RAISE EXCEPTION 'Native inventory guard source constants changed';END IF;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='trigger' AND object_identity=identity;
 IF saved.restore_order<>700027 OR saved.definition_sql IS DISTINCT FROM before_sql
  OR saved.definition_sha256<>before_hash THEN
  RAISE EXCEPTION 'Native inventory guard saved predecessor changed';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_reject_release_authority_inventory_mutation()'::regprocedure))
  IS DISTINCT FROM '7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6' THEN
  RAISE EXCEPTION 'Native inventory guard mutation function changed';END IF;
 SELECT 'drop trigger if exists '||quote_ident(t.tgname)||' on public.custodial_release_authority_restore_inventory; '
  ||pg_get_triggerdef(t.oid,true)||'; alter table public.custodial_release_authority_restore_inventory enable always trigger '
  ||quote_ident(t.tgname)||';' INTO STRICT actual_sql
  FROM pg_trigger t WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable'
   AND NOT t.tgisinternal AND t.tgenabled='A'
   AND t.tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure;
 IF actual_sql IS DISTINCT FROM after_sql OR public.static_weekly_digest_text(actual_sql)<>after_hash THEN
  RAISE EXCEPTION 'Native inventory guard live ALWAYS definition changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=after_sql,definition_sha256=after_hash,captured_at=statement_timestamp()
  WHERE inventory_id=saved.inventory_id AND object_kind='trigger' AND object_identity=identity
   AND restore_order=700027 AND definition_sql=before_sql AND definition_sha256=before_hash;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Native inventory guard recovery update scope changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT u.* FROM native_guard_unrelated_inventory u WHERE u.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE i.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM native_guard_unrelated_inventory) THEN
  RAISE EXCEPTION 'Unrelated native inventory rows changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
   WHERE inventory_id=saved.inventory_id AND object_identity=identity AND object_kind='trigger'
    AND restore_order=700027 AND definition_sql=actual_sql AND definition_sha256=after_hash) THEN
  RAISE EXCEPTION 'Native inventory ALWAYS guard recovery readback changed';END IF;
END $rebind$;
COMMIT;
