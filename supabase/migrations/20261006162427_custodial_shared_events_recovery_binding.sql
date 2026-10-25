-- Extend only the recovery definitions affected by the Shared Events migration.
-- This does not alter application records, roles, policies or runtime functions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public, extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE custodial_events_recovery_targets(
  object_kind text, object_identity text, definition_sql text,
  predecessor_sha256 text, target_sha256 text,
  PRIMARY KEY(object_kind,object_identity)
) ON COMMIT DROP;
INSERT INTO custodial_events_recovery_targets
SELECT * FROM jsonb_to_recordset($targets$[{"object_kind":"column_set","object_identity":"public.events_app_events","definition_sql":"select public.custodial_release_authority_restore_column_set('public.events_app_events',array['archived_at','attendee_count','audience_employee_ids','audience_scope','cancellation_reason','cancelled_at','cancelled_by','cancelled_by_manager_id','coverage_location_ids','created_at','created_by','created_by_manager_id','custodial_note_codes','custodial_public_notes','display_location','end_date','end_instant_utc','end_time','event_date','event_name','event_scope','event_timezone','id','location_group_id','manually_overridden','needs_review','notes','operation_id','overridden_at','overridden_by','parse_reason','parser_confidence','primary_venue_id','revision','source_format','source_location_text','source_text','staffing_area_ids','start_instant_utc','start_time','status','updated_at','updated_by_manager_id','venue_ids']::text[]);","predecessor_sha256":"fedc604747bc2a4ddadf9bc36ab1d412bd5f57d962c6823cf527f37d3fcc8469","target_sha256":"f7ac1387312123aaa09c81b6a61f683ce266a0b9bb7ace99c7410b698674a5a7"},{"object_kind":"relation","object_identity":"public.events_app_events","definition_sql":"create table if not exists public.events_app_events (\n  archived_at timestamp with time zone,\n  attendee_count integer,\n  audience_employee_ids uuid[] default '{}'::uuid[] not null,\n  audience_scope text default 'assigned_location'::text not null,\n  cancellation_reason text,\n  cancelled_at timestamp with time zone,\n  cancelled_by text,\n  cancelled_by_manager_id uuid,\n  coverage_location_ids uuid[] default '{}'::uuid[] not null,\n  created_at timestamp with time zone default now() not null,\n  created_by text,\n  created_by_manager_id uuid,\n  custodial_note_codes text[] default '{}'::text[] not null,\n  custodial_public_notes text,\n  display_location text,\n  end_date date not null,\n  end_instant_utc timestamp with time zone,\n  end_time time without time zone,\n  event_date date not null,\n  event_name text not null,\n  event_scope text default 'UNKNOWN'::text not null,\n  event_timezone text default 'America/Chicago'::text not null,\n  id uuid default gen_random_uuid() not null,\n  location_group_id uuid not null,\n  manually_overridden boolean default false not null,\n  needs_review boolean default false not null,\n  notes text,\n  operation_id uuid,\n  overridden_at timestamp with time zone,\n  overridden_by text,\n  parse_reason text,\n  parser_confidence text,\n  primary_venue_id uuid,\n  revision integer default 1 not null,\n  source_format text,\n  source_location_text text,\n  source_text text,\n  staffing_area_ids uuid[] default '{}'::uuid[] not null,\n  start_instant_utc timestamp with time zone,\n  start_time time without time zone not null,\n  status text default 'SCHEDULED'::text not null,\n  updated_at timestamp with time zone default now() not null,\n  updated_by_manager_id uuid,\n  venue_ids uuid[] default '{}'::uuid[] not null\n);","predecessor_sha256":"2e7f7f4abb847a7104be258188cbd0bd567b7deb10f503b7f47348df191310bb","target_sha256":"00d96d076b1084a0ef851b76f7f6036982eb2ef0ec851786dd06f516fc58aba8"},{"object_kind":"column","object_identity":"public.events_app_events:custodial_note_codes","definition_sql":"select public.custodial_release_authority_restore_column('public.events_app_events','custodial_note_codes','text[]',null,'','','''{}''::text[]',true);","predecessor_sha256":null,"target_sha256":"8ba11b63746e6184bd957789a728afe1eb8aa3802547201d29adf739fae3c2a0"},{"object_kind":"column","object_identity":"public.events_app_events:custodial_public_notes","definition_sql":"select public.custodial_release_authority_restore_column('public.events_app_events','custodial_public_notes','text',null,'','',null,false);","predecessor_sha256":null,"target_sha256":"23dda9691705934b0a7965cec8ba311ff4faebc3f875f7e3142019f6f98fab95"},{"object_kind":"column","object_identity":"public.events_app_events:end_instant_utc","definition_sql":"select public.custodial_release_authority_restore_column('public.events_app_events','end_instant_utc','timestamp with time zone',null,'','',null,false);","predecessor_sha256":null,"target_sha256":"47396e92efba0a4cbb9ab0526e727a3f029fe33452aefdda467c97b7f3e2c732"},{"object_kind":"column","object_identity":"public.events_app_events:start_instant_utc","definition_sql":"select public.custodial_release_authority_restore_column('public.events_app_events','start_instant_utc','timestamp with time zone',null,'','',null,false);","predecessor_sha256":null,"target_sha256":"106a679f7e85be9e039b7f6f07c223f81d1041868318a025d650524970945c7c"}]$targets$::jsonb)
AS x(object_kind text,object_identity text,definition_sql text,predecessor_sha256 text,target_sha256 text);

DO $preflight$
DECLARE item record; actual text; writer oid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='O') THEN
  RAISE EXCEPTION 'Recovery inventory immutability guard is not enabled';
 END IF;
 FOR item IN SELECT * FROM custodial_events_recovery_targets LOOP
  actual:=CASE item.object_kind
   WHEN 'relation' THEN public.custodial_release_authority_current_relation_definition(item.object_identity)
   WHEN 'column_set' THEN public.custodial_release_authority_current_column_set_definition(item.object_identity)
   WHEN 'column' THEN public.custodial_release_authority_current_column_definition(item.object_identity) END;
  IF actual IS DISTINCT FROM item.definition_sql
    OR encode(extensions.digest(convert_to(actual,'UTF8'),'sha256'),'hex') IS DISTINCT FROM item.target_sha256 THEN
   RAISE EXCEPTION 'Shared Events source definition mismatch: % %',item.object_kind,item.object_identity;
  END IF;
 END LOOP;
 writer:=to_regprocedure('public.custodial_outlook_event_sync_v1(text,jsonb)');
 IF writer IS NULL OR encode(extensions.digest(convert_to(pg_get_functiondef(writer),'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM '943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067' THEN
  RAISE EXCEPTION 'Shared Events writer does not match the admitted source';
 END IF;
 -- Grant renderer includes the actual migration owner; verify rights, not its environment-specific name.
 IF has_function_privilege('anon',writer,'EXECUTE') OR has_function_privilege('authenticated',writer,'EXECUTE')
    OR NOT has_function_privilege('service_role',writer,'EXECUTE') OR EXISTS(
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=writer AND (a.privilege_type<>'EXECUTE' OR a.is_grantable
        OR a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname='postgres'),(SELECT oid FROM pg_roles WHERE rolname='service_role')))
    ) THEN RAISE EXCEPTION 'Shared Events writer grants are not the service-only source'; END IF;
 actual:=pg_get_functiondef(writer);
 INSERT INTO custodial_events_recovery_targets VALUES
  ('function',writer::regprocedure::text,actual,NULL,encode(extensions.digest(convert_to(actual,'UTF8'),'sha256'),'hex'));
 actual:=public.custodial_release_authority_current_grant_definition(writer::regprocedure::text);
 IF actual IS NULL THEN RAISE EXCEPTION 'Shared Events writer grant definition is absent'; END IF;
 INSERT INTO custodial_events_recovery_targets VALUES
  ('grant',writer::regprocedure::text,actual,NULL,encode(extensions.digest(convert_to(actual,'UTF8'),'sha256'),'hex'));
 FOR item IN SELECT t.*,i.definition_sql AS saved_definition,i.definition_sha256 AS saved_hash,i.inventory_id
   FROM custodial_events_recovery_targets t LEFT JOIN public.custodial_release_authority_restore_inventory i
   USING(object_kind,object_identity) LOOP
  IF item.inventory_id IS NULL THEN
   IF item.predecessor_sha256 IS NOT NULL THEN RAISE EXCEPTION 'Required predecessor recovery row is missing: %',item.object_kind; END IF;
  ELSIF item.saved_hash IS DISTINCT FROM encode(extensions.digest(convert_to(item.saved_definition,'UTF8'),'sha256'),'hex')
     OR (item.saved_hash IS DISTINCT FROM item.target_sha256 AND item.saved_hash IS DISTINCT FROM item.predecessor_sha256) THEN
   RAISE EXCEPTION 'Unexpected predecessor recovery binding: % %',item.object_kind,item.object_identity;
  END IF;
 END LOOP;
END $preflight$;
CREATE TEMP TABLE custodial_events_unrelated_inventory ON COMMIT DROP AS
 SELECT i.* FROM public.custodial_release_authority_restore_inventory i
 WHERE NOT EXISTS(SELECT 1 FROM custodial_events_recovery_targets t
  WHERE t.object_kind=i.object_kind AND t.object_identity=i.object_identity);

-- Same transaction-scoped inventory update pattern used by previous release migrations.
-- The exclusive lock is held until the guard is re-enabled and all checks have passed.
ALTER TABLE public.custodial_release_authority_restore_inventory
 DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $bind$
DECLARE item record; next_order integer;
BEGIN
 FOR item IN SELECT * FROM custodial_events_recovery_targets ORDER BY object_kind,object_identity LOOP
  IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
   WHERE object_kind=item.object_kind AND object_identity=item.object_identity) THEN
   UPDATE public.custodial_release_authority_restore_inventory
    SET definition_sql=item.definition_sql,definition_sha256=item.target_sha256,captured_at=statement_timestamp()
    WHERE object_kind=item.object_kind AND object_identity=item.object_identity
      AND definition_sha256 IS DISTINCT FROM item.target_sha256;
  ELSE
   SELECT max(restore_order)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory
    WHERE object_kind=item.object_kind;
   IF next_order IS NULL THEN RAISE EXCEPTION 'Recovery order is unavailable: %',item.object_kind; END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(next_order,item.object_kind,item.object_identity,item.definition_sql,item.target_sha256);
  END IF;
 END LOOP;
END $bind$;
ALTER TABLE public.custodial_release_authority_restore_inventory
 ENABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $postflight$
BEGIN
 IF (SELECT count(*) FROM custodial_events_recovery_targets)<>8 OR EXISTS(
  SELECT 1 FROM custodial_events_recovery_targets t LEFT JOIN public.custodial_release_authority_restore_inventory i
  USING(object_kind,object_identity) WHERE i.definition_sql IS DISTINCT FROM t.definition_sql
    OR i.definition_sha256 IS DISTINCT FROM t.target_sha256
 ) THEN RAISE EXCEPTION 'Shared Events recovery binding is incomplete'; END IF;
 IF EXISTS(SELECT * FROM custodial_events_unrelated_inventory EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
 OR EXISTS(SELECT i.* FROM public.custodial_release_authority_restore_inventory i
  WHERE NOT EXISTS(SELECT 1 FROM custodial_events_recovery_targets t WHERE t.object_kind=i.object_kind AND t.object_identity=i.object_identity)
  EXCEPT SELECT * FROM custodial_events_unrelated_inventory) THEN
  RAISE EXCEPTION 'Unrelated recovery inventory changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='O') THEN
  RAISE EXCEPTION 'Recovery inventory guard was not restored'; END IF;
 IF (SELECT max(i.restore_order) FROM public.custodial_release_authority_restore_inventory i
   JOIN custodial_events_recovery_targets t USING(object_kind,object_identity) WHERE i.object_kind='column')
  >=(SELECT restore_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='column_set' AND object_identity='public.events_app_events')
 OR (SELECT restore_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function'
   AND object_identity='public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure::text)
  >=(SELECT restore_order FROM public.custodial_release_authority_restore_inventory WHERE object_kind='grant'
   AND object_identity='public.custodial_outlook_event_sync_v1(text,jsonb)'::regprocedure::text) THEN
  RAISE EXCEPTION 'Shared Events recovery dependency order is invalid'; END IF;
END $postflight$;
COMMIT;
