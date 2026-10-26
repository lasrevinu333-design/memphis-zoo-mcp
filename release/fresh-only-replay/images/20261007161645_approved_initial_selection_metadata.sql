-- Exact owner/credential-bound initial selection metadata; no baseline mutation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.custodial_read_approved_initial_selection_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,p_week_start date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE choices jsonb;revision bigint;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF p_week_start IS NULL OR NOT isfinite(p_week_start) OR extract(isodow FROM p_week_start)<>1 THEN
  RAISE EXCEPTION USING errcode='22023',message='Approved initial selection requires a Monday week';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 -- Reuse current credential/device/registry/owner decisions, not token claims.
 choices:=public.custodial_read_approved_schedule_choices_v1(p_manager_id,p_credential_id,p_device_id,p_session_access);
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 RETURN choices||jsonb_build_object('schema','custodial.approved-initial-selection.v1',
  'week_start',p_week_start,'week_end',p_week_start+6,'authority_revision',revision,
  'published',false,'snapshot_authority','SELECTION_METADATA_ONLY');
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_read_approved_initial_selection_v1(uuid,uuid,text,text,date)
 FROM PUBLIC,postgres,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
-- Pinned Supabase images add a postgres default function grant when the owner
-- is supabase_admin. Revoke it on this new RPC, not on historical objects or
-- global defaults; the migration owner retains its inherent object authority.
GRANT EXECUTE ON FUNCTION public.custodial_read_approved_initial_selection_v1(uuid,uuid,text,text,date) TO static_weekly_control_plane;

-- Source-controlled append and exact canary rebinding. Existing helpers,
-- grants and unrelated captured rows must remain unchanged.
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE initial_selection_inventory_before AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $capture$
DECLARE
 identity text:='custodial_read_approved_initial_selection_v1(uuid,uuid,text,text,date)';
 old_surface text;new_surface text;actual_surface text;fn text;grants text;n integer;
 saved public.custodial_release_authority_restore_inventory%ROWTYPE;
BEGIN
 old_surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF public.static_weekly_digest_text(old_surface)<>'e5ecce088ed0356d4ad9528f82ee3644d7d5a36418c070b72ce070adf455198b'
  OR public.static_weekly_digest_text(pg_get_functiondef('public.custodial_reject_release_authority_inventory_mutation()'::regprocedure))<>'7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6' THEN
  RAISE EXCEPTION 'Initial selection recovery predecessor changed';END IF;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function' AND object_identity='custodial_release_canary_authority_surface()';
 IF saved.restore_order<>100071 OR saved.definition_sql IS DISTINCT FROM old_surface OR saved.definition_sha256<>public.static_weekly_digest_text(old_surface)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Initial selection saved surface/ALWAYS guard changed';END IF;
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_identity=identity OR restore_order IN(800049,1000236)) THEN
  RAISE EXCEPTION 'Initial selection recovery identities/orders already used';END IF;
 IF (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
   WHERE p.oid=('public.'||identity)::regprocedure AND a.grantee<>p.proowner AND a.privilege_type='EXECUTE') IS DISTINCT FROM ARRAY['static_weekly_control_plane']::text[] THEN
  RAISE EXCEPTION 'Initial selection precise execute ACL changed';END IF;
 fn:=pg_get_functiondef(('public.'||identity)::regprocedure);
 -- Capture the exact inventory key, as consumed by the unchanged live checker.
 -- The serializer already fixes its search_path to pg_catalog,public.
 grants:=public.custodial_release_authority_current_grant_definition(identity);
 IF grants IS NULL THEN RAISE EXCEPTION 'Initial selection grant capture missing';END IF;
 new_surface:=replace(old_surface,E'  values\n',E'  values\n    (''function'','''||identity||E''',''approved initial selection metadata''),\n    (''grant'','''||identity||E''',''approved initial selection metadata''),\n');
 IF new_surface=old_surface THEN RAISE EXCEPTION 'Initial selection canary values seam changed';END IF;
 EXECUTE new_surface;actual_surface:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF actual_surface IS DISTINCT FROM new_surface THEN RAISE EXCEPTION 'Initial selection canary serialization changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=actual_surface,definition_sha256=public.static_weekly_digest_text(actual_surface),captured_at=statement_timestamp()
  WHERE inventory_id=saved.inventory_id AND definition_sha256=saved.definition_sha256 AND restore_order=saved.restore_order;
 GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Initial selection surface update scope changed';END IF;
 INSERT INTO public.custodial_release_authority_restore_inventory(object_kind,object_identity,definition_sql,definition_sha256,restore_order)
 VALUES('function',identity,fn,public.static_weekly_digest_text(fn),800049),('grant',identity,grants,public.static_weekly_digest_text(grants),1000236);
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS(SELECT * FROM initial_selection_inventory_before WHERE inventory_id<>saved.inventory_id EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT * FROM public.custodial_release_authority_restore_inventory WHERE inventory_id<>saved.inventory_id AND object_identity<>identity EXCEPT SELECT * FROM initial_selection_inventory_before) THEN
  RAISE EXCEPTION 'Unrelated initial selection recovery rows changed';END IF;
 IF (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_identity=identity AND object_kind IN('function','grant'))<>2
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Initial selection recovery/canary/guard readback changed';END IF;
END $capture$;
DROP TABLE initial_selection_inventory_before;
COMMIT;
