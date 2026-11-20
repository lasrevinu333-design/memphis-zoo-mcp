-- Forward-only, read-only SCHEDULE source eligibility correction.
-- A legitimate accepted lunch coverer may own the09:45 boundary even when
-- the exact anchor's usual owner is somebody else. No job, native wire,
-- validity/retention policy, clock authority or delivery right is added.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE schedule_source_prior_inventory ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $source$
DECLARE
 fn constant regprocedure:='public.custodial_native_target_source_at(text,uuid,uuid,uuid,timestamptz)'::regprocedure;
 prior_hash constant text:='729f66b50b4307afa9a636e39dbb93ef9931e3e58351840c231acc3f526ed475';
 definition text;original_acl aclitem[];saved public.custodial_release_authority_restore_inventory%ROWTYPE;changed integer;
 owner_gate constant text:=$old$if not found or v_occurrence.state is distinct from 'created'
   or v_occurrence.owner_person_id_snapshot is distinct from p_employee_id then$old$;
 new_owner_gate constant text:=$new$if not found or v_occurrence.state is distinct from 'created' then$new$;
 authority_gate constant text:=$old$or v_authority.version_id is distinct from v_occurrence.version_id then$old$;
 new_authority_gate constant text:=$new$or v_authority.version_id is distinct from v_occurrence.version_id
    or (v_occurrence.owner_person_id_snapshot is distinct from p_employee_id
     and not exists(select 1 from public.static_weekly_v8_read_lunch_segments(v_occurrence.service_date) l
      where l.projection_id=v_authority.projection_id
       and l.normal_occurrence_id=v_occurrence.occurrence_id
       and l.normal_owner_id=v_occurrence.owner_person_id_snapshot
       and l.coverer_id=p_employee_id
       and l.coverage_start<=time '09:45' and l.coverage_end>=time '09:45'
       and l.coverage_start<l.coverage_end)) then$new$;
BEGIN
 definition:=pg_get_functiondef(fn);
 IF public.static_weekly_digest_text(definition)<>prior_hash THEN
  RAISE EXCEPTION 'Exact native SCHEDULE source predecessor changed';END IF;
 SELECT proacl INTO STRICT original_acl FROM pg_proc WHERE oid=fn;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='function' AND to_regprocedure(object_identity)=fn;
 IF saved.definition_sql IS DISTINCT FROM definition OR saved.definition_sha256<>prior_hash THEN
  RAISE EXCEPTION 'Native SCHEDULE source recovery predecessor changed';END IF;
 IF (length(definition)-length(replace(definition,owner_gate,'')))/length(owner_gate)<>1
  OR (length(definition)-length(replace(definition,authority_gate,'')))/length(authority_gate)<>1 THEN
  RAISE EXCEPTION 'Native SCHEDULE source exact replacement seam changed';END IF;
 definition:=replace(replace(definition,owner_gate,new_owner_gate),authority_gate,new_authority_gate);
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_acl THEN
  RAISE EXCEPTION 'Native SCHEDULE source permissions changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Native SCHEDULE source ALWAYS recovery guard missing';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=pg_get_functiondef(fn),definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(fn)),captured_at=statement_timestamp()
  WHERE inventory_id=saved.inventory_id AND object_kind='function' AND definition_sha256=prior_hash;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Native SCHEDULE source recovery update scope changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT u.* FROM schedule_source_prior_inventory u WHERE u.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT i.* FROM public.custodial_release_authority_restore_inventory i WHERE i.inventory_id<>saved.inventory_id
   EXCEPT SELECT * FROM schedule_source_prior_inventory) THEN
  RAISE EXCEPTION 'Unrelated native SCHEDULE source inventory changed';END IF;
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM original_acl
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Native SCHEDULE source final privilege/guard readback changed';END IF;
END $source$;
COMMIT;
