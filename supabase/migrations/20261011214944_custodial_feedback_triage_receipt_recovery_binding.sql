-- Main normal CLI-generated follow-up; source preparation only until main's
-- isolated SQL qualification. Requires the separately sealed Mail reader:
-- 20261011214943_custodial_feedback_triage_receipt_reader.sql
-- SHA256 88ca748da7713fd87502675663e34144ea6dea925a29cedd5d358cfbf55c139b (6672 bytes).
-- No function recreation, actual ACL changes, table grants or catalog recapture.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE feedback_receipt_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE feedback_receipt_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;

-- Verify the Mail-owned exact source/attributes/minimum ACL before using the
-- existing normal serializer. A surviving object is not review authority.
DO $reader_source$
DECLARE
 target regprocedure:=to_regprocedure('public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)');
 reader record;
 expected_grant constant text:=$grant$select public.custodial_release_authority_reset_grants('public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'); grant execute on function custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text) to service_role;$grant$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'Sealed Feedback original reader is missing';END IF;
 SELECT p.*,l.lanname INTO STRICT reader FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=target;
 IF public.static_weekly_digest_text(reader.prosrc) IS DISTINCT FROM '0f71d5055f9fdf3fdb2a5a02d24254822e01be92e263126f6757eb5588d9588d'
  OR octet_length(convert_to(reader.prosrc,'UTF8'))<>4691
  OR reader.lanname IS DISTINCT FROM 'plpgsql' OR reader.prokind IS DISTINCT FROM 'f'
  OR reader.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid OR reader.proretset IS DISTINCT FROM false
  OR reader.provolatile IS DISTINCT FROM 'v' OR reader.proparallel IS DISTINCT FROM 'u'
  OR reader.prosecdef IS DISTINCT FROM true OR reader.proisstrict IS DISTINCT FROM false
  OR reader.proleakproof IS DISTINCT FROM false OR reader.provariadic<>0 OR reader.pronargdefaults<>0
  OR reader.proargnames IS DISTINCT FROM ARRAY['p_request','p_manager','p_credential','p_feedback','p_action','p_expected_version']::text[]
  OR reader.proargmodes IS NOT NULL OR reader.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
  OR reader.proowner IS DISTINCT FROM (SELECT proowner FROM pg_proc
    WHERE oid='public.custodial_feedback_triage(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(reader.proacl,acldefault('f',reader.proowner))) a
    WHERE a.grantee NOT IN(reader.proowner,'service_role'::regrole::oid)
     OR a.privilege_type IS DISTINCT FROM 'EXECUTE'
     OR (a.grantee='service_role'::regrole::oid AND a.is_grantable))
  OR (SELECT count(*) FROM aclexplode(coalesce(reader.proacl,acldefault('f',reader.proowner))) a
    WHERE a.grantee='service_role'::regrole::oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>1
  OR NOT has_function_privilege('service_role',target,'EXECUTE')
  OR public.custodial_release_authority_current_grant_definition('public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)')
    IS DISTINCT FROM expected_grant
 THEN RAISE EXCEPTION 'Feedback original reader sealed body, attributes, owner or minimum ACL changed';END IF;
END $reader_source$;

DO $predecessor$ DECLARE body text;BEGIN
 SELECT definition INTO STRICT body FROM feedback_receipt_surface_before;
 IF EXISTS(SELECT 1 FROM feedback_receipt_inventory_before
   WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR (SELECT count(*) FROM feedback_receipt_inventory_before WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=body)<>1
  OR (SELECT count(*) FROM feedback_receipt_inventory_before WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM feedback_receipt_inventory_before WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
  OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
 THEN RAISE EXCEPTION 'Feedback original reader exact recovery/canary predecessor changed';END IF;
END $predecessor$;

CREATE TEMP TABLE feedback_receipt_recovery_objects ON COMMIT DROP AS
 WITH f AS(SELECT 'public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure oid)
 SELECT 100000 bucket,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM f
 UNION ALL SELECT 900000,'grant','public.'||oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM f;
DO $objects$ BEGIN
 IF (SELECT count(*) FROM feedback_receipt_recovery_objects)<>2
  OR EXISTS(SELECT 1 FROM feedback_receipt_recovery_objects WHERE definition IS NULL)
 THEN RAISE EXCEPTION 'Feedback original reader finite recovery declaration changed';END IF;
END $objects$;

DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM feedback_receipt_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','
  ||quote_literal('exact immutable original Feedback receipt readback; no writer replay or retry authorization')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM feedback_receipt_recovery_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM feedback_receipt_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM feedback_receipt_surface_before)
 THEN RAISE EXCEPTION 'Feedback readback canary changed beyond its exact two-entry extension';END IF;
END $surface$;

-- This one guarded canary-row refresh plus exactly two new recovery rows is
-- the entire permitted inventory delta. The existing ACL row is unchanged.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM feedback_receipt_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Feedback readback exact canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM feedback_receipt_recovery_objects ORDER BY bucket,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Feedback readback finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM feedback_receipt_inventory_before)+2
  OR EXISTS(SELECT old.* FROM feedback_receipt_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM feedback_receipt_recovery_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM feedback_receipt_inventory_before)
  OR EXISTS(SELECT 1 FROM feedback_receipt_recovery_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR EXISTS(SELECT 1 FROM feedback_receipt_recovery_objects x WHERE x.definition IS DISTINCT FROM CASE x.kind
   WHEN 'function' THEN pg_get_functiondef('public.custodial_feedback_triage_receipt(uuid,uuid,uuid,uuid,text,text)'::regprocedure)
   WHEN 'grant' THEN public.custodial_release_authority_current_grant_definition(x.identity) END)
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() s JOIN feedback_receipt_recovery_objects x
   ON x.kind=s.object_kind AND x.identity=s.object_identity)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Feedback readback unrelated recovery rows, exact new source/ACL, canary membership or ALWAYS guard changed';END IF;
END $scope$;
COMMIT;
