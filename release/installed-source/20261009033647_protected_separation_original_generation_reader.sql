-- Forward-only local source migration. Original-generation retained identity
-- read only; no inventory ACK, work eligibility, phone reuse or business writes.
-- Exact source-function body was separately proved on an owning SQL subset.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE separation_generation_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE separation_generation_surface_before ON COMMIT DROP AS
 SELECT p.oid AS fn,p.proacl AS acl,p.proowner AS owner,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$
DECLARE saved public.custodial_release_authority_restore_inventory%ROWTYPE;body text;
BEGIN
 IF to_regprocedure('public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'Original generation reader already exists';END IF;
 SELECT definition INTO STRICT body FROM separation_generation_surface_before;
 IF public.static_weekly_digest_text(body) IS DISTINCT FROM '70528f8149de8161ef5bdf651b720ce2da2433486a55833cc5ac2b31be08490c'
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'Original generation reader exact surface predecessor changed';END IF;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='function' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure;
 IF saved.definition_sql IS DISTINCT FROM body OR saved.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(body) THEN
  RAISE EXCEPTION 'Original generation reader recovery predecessor changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Original generation reader ALWAYS inventory guard missing';END IF;
END $predecessor$;

create function public.custodial_v14_read_separation_generation(
 p_device_id uuid,p_credential_id uuid,p_separation_id uuid,p_generation_id uuid,p_principal_digest text)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare context jsonb;original public.employee_native_push_generations%rowtype;cutoff timestamptz;
begin
 if p_device_id is null or p_credential_id is null or p_separation_id is null
  or p_generation_id is null or p_principal_digest is null or p_principal_digest !~ '^[0-9a-f]{64}$'
 then raise exception using errcode='22023',message='exact original separation generation required';end if;
 context:=public.custodial_v13_read_separation_context(p_device_id,p_credential_id);
 if context is null or context->>'separation_id' is distinct from p_separation_id::text
  or context->>'purpose' is distinct from 'SEPARATION_STATUS_ONLY'
  or context->>'state' is distinct from 'PENDING_RECONCILIATION'
  or context->'new_work_allowed' is distinct from 'false'::jsonb
  or context->'phone_released' is distinct from 'false'::jsonb
 then return null;end if;
 cutoff:=(context->>'cutoff_at')::timestamptz;
 if cutoff is null or not isfinite(cutoff) then return null;end if;
 select g.* into original from public.employee_native_push_generations g
 where g.generation_id=p_generation_id and g.principal_digest=p_principal_digest
  and g.device_id=p_device_id and g.device_identifier=context->>'canonical_device_id'
  and g.credential_id=p_credential_id and g.employee_id=(context->>'employee_id')::uuid
  and g.assignment_epoch=(context->>'assignment_epoch')::bigint
  and isfinite(g.activated_at) and g.activated_at<cutoff;
 if not found then return null;end if;
 -- Retired dispatch history is retained identity evidence, not dispatch/work
 -- permission. Never filter to today's generation or create a fallback/backfill.
 return jsonb_build_object('generation_id',original.generation_id,'device_id',original.device_id,
  'device_identifier',original.device_identifier,'credential_id',original.credential_id,
  'employee_id',original.employee_id,'assignment_epoch',original.assignment_epoch,
  'principal_digest',original.principal_digest,
  'activated_at',to_char(original.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $function$;
revoke all on function public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- Same trusted PostgreSQL backend reader boundary as existing v13. Not a
-- browser/JWT/Data API role; direct private generation/fence access stays denied.
grant execute on function public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)
 to custodial_application_reader;

DO $surface$
DECLARE original text;patched text;
BEGIN
 SELECT definition INTO STRICT original FROM separation_generation_surface_before;
 patched:=replace(original,'  values','  values'||E'\n'||
  '(''function'',''public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)'',''purpose-only original native generation retention''),');
 EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
    IS DISTINCT FROM (SELECT acl FROM separation_generation_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
    IS DISTINCT FROM (SELECT owner FROM separation_generation_surface_before) THEN
  RAISE EXCEPTION 'Original generation reader surface metadata changed';END IF;
END $surface$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$
DECLARE target constant regprocedure:='public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)'::regprocedure;
 surface constant regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
 identity text;definition text;next_order integer;changed integer;
BEGIN
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=pg_get_functiondef(surface),definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(surface)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND to_regprocedure(object_identity)=surface
   AND definition_sql=(SELECT prior.definition FROM separation_generation_surface_before prior);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Original generation reader surface inventory scope changed';END IF;
 identity:='public.'||target::text;
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind IN ('function','grant') AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target) THEN
  RAISE EXCEPTION 'Original generation reader recovery identity already exists';END IF;
 definition:=pg_get_functiondef(target);
 SELECT coalesce(max(restore_order),100000)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory
  WHERE restore_order>=100000 AND restore_order<200000;
 INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  VALUES(next_order,'function',identity,definition,public.static_weekly_digest_text(definition));
 definition:=public.custodial_release_authority_current_grant_definition(identity);
 IF definition IS NULL THEN RAISE EXCEPTION 'Original generation reader grant definition missing';END IF;
 SELECT coalesce(max(restore_order),900000)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory
  WHERE restore_order>=900000 AND restore_order<1000000;
 INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  VALUES(next_order,'grant',identity,definition,public.static_weekly_digest_text(definition));
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

DO $scope$
DECLARE surface constant regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
 target constant regprocedure:='public.custodial_v14_read_separation_generation(uuid,uuid,uuid,uuid,text)'::regprocedure;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
  <> (SELECT count(*)+2 FROM separation_generation_inventory_before) THEN
  RAISE EXCEPTION 'Original generation reader inventory cardinality changed';END IF;
 IF EXISTS(SELECT old.* FROM separation_generation_inventory_before old
  WHERE NOT (CASE WHEN old.object_kind='function' AND old.object_identity LIKE '%(%'
   THEN to_regprocedure(old.object_identity)=surface ELSE false END)
  EXCEPT SELECT now.* FROM public.custodial_release_authority_restore_inventory now)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now
   WHERE NOT (CASE WHEN now.object_kind='function' AND now.object_identity LIKE '%(%'
     THEN to_regprocedure(now.object_identity)=surface ELSE false END
    OR CASE WHEN now.object_kind IN ('function','grant') AND now.object_identity LIKE '%(%'
     THEN to_regprocedure(now.object_identity)=target ELSE false END)
   EXCEPT SELECT old.* FROM separation_generation_inventory_before old) THEN
  RAISE EXCEPTION 'Unrelated original generation reader inventory changed';END IF;
 IF (SELECT proacl FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT acl FROM separation_generation_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT owner FROM separation_generation_surface_before)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Original generation reader final surface ACL/guard changed';END IF;
END $scope$;
COMMIT;
