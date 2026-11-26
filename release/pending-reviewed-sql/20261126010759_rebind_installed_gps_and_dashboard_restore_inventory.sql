-- Forward recovery metadata repair for the exact installed 429-row database.
-- Admit these two known live definitions without changing either object or its ACL.
-- The production runner still owns migration authorization and execution.
BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;

DO $repair$
DECLARE
  expected record;
  captured record;
  live_definition text;
  changed integer;
  inventory_count constant integer := 7820;
BEGIN
  IF current_user <> session_user
     OR current_setting('session_replication_role') <> 'origin'
     OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) <> inventory_count
     OR (SELECT tgenabled FROM pg_trigger
         WHERE tgrelid = 'public.custodial_release_authority_restore_inventory'::regclass
           AND tgname = 'trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
  THEN
    RAISE EXCEPTION 'Installed recovery inventory and ALWAYS guard are required';
  END IF;

  ALTER TABLE public.custodial_release_authority_restore_inventory
    DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

  FOR expected IN
    SELECT * FROM (VALUES
      ('function', 'evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamp with time zone)', 100308,
       '6fa48fcc808225665b61e9e7e286e06cc466cb160576bd26522ca0ee3b375170',
       'bcd6226b779ad70162bbdf08ec78706914a6d9f577fcc6f63cd8eff958d1ea92'),
      ('view', 'public.v_location_dashboard_status', 850002,
       '7956b0b208e62458fdd54bf96578c06fc490d583e5fcf06aa66baa2cbe8957d9',
       'd159cb1178773a72ac25d1fa49272d5f4a7338cb775f886976c2c1af081160f8')
    ) AS targets(kind, identity, restore_order, captured_digest, live_digest)
  LOOP
    SELECT i.definition_sql, i.definition_sha256 INTO STRICT captured
    FROM public.custodial_release_authority_restore_inventory i
    WHERE i.object_kind = expected.kind AND i.object_identity = expected.identity
      AND i.restore_order = expected.restore_order;

    IF captured.definition_sha256 IS DISTINCT FROM expected.captured_digest
       OR public.static_weekly_digest_text(captured.definition_sql) IS DISTINCT FROM expected.captured_digest
    THEN
      RAISE EXCEPTION 'Stored recovery definition changed for %', expected.identity;
    END IF;

    live_definition := CASE expected.kind
      WHEN 'function' THEN pg_get_functiondef(to_regprocedure('public.' || expected.identity))
      WHEN 'view' THEN public.custodial_release_authority_current_view_definition(expected.identity)
    END;
    IF public.static_weekly_digest_text(live_definition) IS DISTINCT FROM expected.live_digest THEN
      RAISE EXCEPTION 'Live recoverable definition changed for %', expected.identity;
    END IF;

    UPDATE public.custodial_release_authority_restore_inventory
    SET definition_sql = live_definition,
        definition_sha256 = expected.live_digest,
        captured_at = statement_timestamp()
    WHERE object_kind = expected.kind AND object_identity = expected.identity
      AND restore_order = expected.restore_order AND definition_sha256 = expected.captured_digest;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      RAISE EXCEPTION 'Unexpected recovery update cardinality for %', expected.identity;
    END IF;
  END LOOP;

  ALTER TABLE public.custodial_release_authority_restore_inventory
    ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

  IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) <> inventory_count
     OR (SELECT tgenabled FROM pg_trigger
         WHERE tgrelid = 'public.custodial_release_authority_restore_inventory'::regclass
           AND tgname = 'trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
  THEN
    RAISE EXCEPTION 'Installed recovery count or ALWAYS guard changed';
  END IF;
END
$repair$;
COMMIT;
