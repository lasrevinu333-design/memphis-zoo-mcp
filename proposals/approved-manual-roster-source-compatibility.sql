-- Candidate for the catalog that already contains the accepted seven-person update.
-- This repairs the existing initial eight-person preparation path. The historical
-- 346 and corrected 327 counts are still enforced by its original caller.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SET LOCAL search_path = pg_catalog, public;
SELECT custodial_dr.acquire_application_mutation_fence();
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;

DO $roster_source$
DECLARE
  identity constant text := 'static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)';
  target constant oid := 'public.static_weekly_assert_manual_roster_transition(jsonb,jsonb,jsonb)'::regprocedure;
  inventory constant regclass := 'public.custodial_release_authority_restore_inventory'::regclass;
  before_sha constant text := 'd2f88ac9a55e05d9eab8deaf01df001fcc7fcde00737a220b85a155b9018b26e';
  after_sha constant text := '1718705122d236b212c463c9a12b53259604ab64c46e0b04f566a41d41686968';
  grant_sha constant text := '5f63380fb0e32dc45579988f2618c2d0525932ebad878de2297d446b7661c8fe';
  old_branch constant text := $old$p_transition->>'manualDataDigest'='eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8'$old$;
  new_branch constant text := $new$p_transition->>'manualDataDigest' in ('eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8',
     '85ad93db39597cffc033992ec74d5eea98612ce9a8388a9e93f5566f4e38bc4c')
    and p_transition->>'manualDataDigest'=p_config->>'approvedManualDataDigest'$new$;
  original text := pg_get_functiondef(target);
  successor text := replace(original,old_branch,new_branch);
  grants text := public.custodial_release_authority_current_grant_definition(identity);
  saved public.custodial_release_authority_restore_inventory%rowtype;
  saved_grant public.custodial_release_authority_restore_inventory%rowtype;
  updated public.custodial_release_authority_restore_inventory%rowtype;
BEGIN
  IF current_user <> 'postgres' OR session_user <> current_user OR current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=target AND proowner='postgres'::regrole
      AND proacl::text='{postgres=X/postgres}' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'])
    OR public.static_weekly_digest_text(original) IS DISTINCT FROM before_sha
    OR public.static_weekly_digest_text(successor) IS DISTINCT FROM after_sha
    OR replace(successor,new_branch,old_branch) IS DISTINCT FROM original
    OR public.static_weekly_digest_text(grants) IS DISTINCT FROM grant_sha
    OR public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_coverall_assert_activation_data(jsonb,jsonb)'::regprocedure))
      IS DISTINCT FROM 'dc7bac7c1230bd9b4fa56a61a375f1b7143ae8cbfba22997c80d67cd02527f0f'
  THEN RAISE EXCEPTION 'Exact roster, caller, grant and original release owner required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname='custodial_dr_guard_application_ddl'
      AND evtfoid='custodial_dr.guard_application_ddl()'::regprocedure AND evtenabled IN ('A','O'))
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=inventory AND tgname='custodial_disaster_restore_mutation_fence'
      AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled IN ('A','O'))
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=inventory AND tgname='trg_custodial_release_authority_restore_inventory_immutable'
      AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure AND tgenabled='A')
  THEN RAISE EXCEPTION 'Original DDL, mutation fence and ALWAYS inventory guard required'; END IF;
  SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
    WHERE object_kind='function' AND object_identity=identity;
  SELECT * INTO STRICT saved_grant FROM public.custodial_release_authority_restore_inventory
    WHERE object_kind='grant' AND object_identity=identity;
  IF saved.definition_sql IS DISTINCT FROM original OR saved.definition_sha256 IS DISTINCT FROM before_sha
    OR saved_grant.definition_sql IS DISTINCT FROM grants OR saved_grant.definition_sha256 IS DISTINCT FROM grant_sha
    OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface()
      WHERE object_identity=identity AND object_kind IN ('function','grant')) <> 2
  THEN RAISE EXCEPTION 'Original function and grant recovery bindings required'; END IF;

  EXECUTE successor;
  -- Same one-row, owner-only catalog rebind used by the accepted seven-person
  -- migration. Its exclusive lock covers both ALTERs. The DDL and DML fences
  -- continue to run. An exception rolls the routine and catalog back together.
  ALTER TABLE public.custodial_release_authority_restore_inventory
    DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
  UPDATE public.custodial_release_authority_restore_inventory
    SET definition_sql=successor,definition_sha256=after_sha,captured_at=statement_timestamp()
    WHERE inventory_id=saved.inventory_id AND definition_sha256=before_sha
    RETURNING * INTO STRICT updated;
  ALTER TABLE public.custodial_release_authority_restore_inventory
    ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

  IF pg_get_functiondef(target) IS DISTINCT FROM successor
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=target AND proowner='postgres'::regrole
      AND proacl::text='{postgres=X/postgres}' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'])
    OR public.custodial_release_authority_current_grant_definition(identity) IS DISTINCT FROM grants
    OR updated.definition_sql IS DISTINCT FROM successor OR updated.definition_sha256 IS DISTINCT FROM after_sha
    OR (to_jsonb(updated)-ARRAY['definition_sql','definition_sha256','captured_at'])
      IS DISTINCT FROM (to_jsonb(saved)-ARRAY['definition_sql','definition_sha256','captured_at'])
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=inventory AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  THEN RAISE EXCEPTION 'Roster source and its original recovery binding must agree'; END IF;
END $roster_source$;
COMMIT;
