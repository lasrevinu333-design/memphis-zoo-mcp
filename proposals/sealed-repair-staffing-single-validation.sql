-- PRE-CANONICAL internal qualification component; Main owns final binding.
-- Remove only duplicate projection validation at the owning staging call site.
-- Same payload predicates and unchanged late projection+lunch validator; no
-- new helper/grants, deadline change, optimizer change or normal-plan rewrite.
-- Main MUST bind the updated existing v10 stage function in its atomic final
-- canonical/recovery closure. Existing inventory/canary stay entirely unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE staffing_validation_recovery_before ON COMMIT DROP AS SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest;
DO $single_validation$
DECLARE item jsonb;target oid:='public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)'::regprocedure;
 original text;changed text;before_metadata jsonb;before_grants text;
 old_seam text:=$old$  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);$old$;
 new_seam text:=$new$  -- Keep the exact twelve-field transport/context checks here. The unchanged
  -- paired lunch validator below performs the full projection validation once,
  -- after lunch selection and before any candidate insert or PREPARED transition.
  DECLARE p_operation uuid:=p_operation_id;p_manager uuid:=p_manager_id;p_payload jsonb:=v_pending.payload;
   ctx jsonb;week date;publication uuid;
  BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 PERFORM public.static_weekly_assert_exact_object(p_payload,
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],
  ARRAY['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision','idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate'],'pending twelve-field transport');
 week:=(p_payload->>'serviceDate')::date;publication:=(p_payload->>'publicationId')::uuid;
 IF p_payload->>'actorManagerId' IS DISTINCT FROM p_manager::text OR p_payload->>'actorManagerName' IS DISTINCT FROM ctx#>>'{actor,manager_name}'
  OR p_payload->'expectedRevision' IS DISTINCT FROM ctx#>'{originalCommand,expectedRevision}'
  OR p_payload->>'idempotencyKey' IS DISTINCT FROM 'staffing:'||p_operation::text||':'||week::text
  OR p_payload->>'serviceDate' IS DISTINCT FROM p_payload#>>'{envelope,week_start}'
  OR p_payload->>'publicationId' IS DISTINCT FROM p_payload#>>'{envelope,semantic_snapshot,originalSource,publication_id}'
  OR p_payload->>'compilerVersion' IS DISTINCT FROM p_payload#>>'{envelope,compiler_version}'
  OR p_payload->'objective' IS DISTINCT FROM p_payload#>'{envelope,objective}'
  OR p_payload->'metrics' IS DISTINCT FROM p_payload#>'{envelope,metrics}'
  OR p_payload->>'replayDigest' IS DISTINCT FROM p_payload#>>'{envelope,replay_digest}'
  OR p_payload->>'exceptionSetDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(public.static_weekly_pending_summary(p_operation,publication,week,NULL))
 THEN RAISE EXCEPTION 'Pending transport original identity differs';END IF;
  END;$new$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained staging function owner required';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements($guards$[
  {
    "identity": "public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)",
    "sha256": "f4a3666025be5a3fde272282e8edd8b1ed4ac07e20ca41fadad4339a916e438d"
  },
  {
    "identity": "public.static_weekly_pending_assert_payload(uuid,uuid,jsonb)",
    "sha256": "3cd46f205ccfef0d64c5cbe1b826117d462608aabcbbdf358fc9a911463e29af"
  },
  {
    "identity": "public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)",
    "sha256": "f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58"
  },
  {
    "identity": "public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)",
    "sha256": "601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987"
  }
]$guards$::jsonb) LOOP
  IF to_regprocedure(item->>'identity') IS NULL
   OR public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(item->>'identity'))) IS DISTINCT FROM item->>'sha256'
  THEN RAISE EXCEPTION 'Exact staging/payload/lunch/projection predecessor differs: %',item->>'identity';END IF;
 END LOOP;
 original:=pg_get_functiondef(target);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE oid=target;
 before_grants:=public.custodial_release_authority_current_grant_definition(target::regprocedure::text);
 IF length(original)-length(replace(original,old_seam,''))<>length(old_seam)
 THEN RAISE EXCEPTION 'Single duplicate staging validation seam required';END IF;
 changed:=replace(original,old_seam,new_seam);
 IF length(changed)-length(replace(changed,new_seam,''))<>length(new_seam)
  OR replace(changed,new_seam,old_seam) IS DISTINCT FROM original
  OR public.static_weekly_digest_text(changed) IS DISTINCT FROM '889455a6388f4365d87d04e238fef2169beb0417985916b42626eee976ac9b1c'
 THEN RAISE EXCEPTION 'Staging single-validation inverse/postimage differs';END IF;
 EXECUTE changed;
 IF pg_get_functiondef(target) IS DISTINCT FROM changed
  OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM before_metadata
  OR public.custodial_release_authority_current_grant_definition(target::regprocedure::text) IS DISTINCT FROM before_grants
 THEN RAISE EXCEPTION 'Staging single-validation postimage/owner/ACL changed';END IF;
 -- All independently callable helpers remain exact and fully validating.
 FOR item IN SELECT value FROM jsonb_array_elements($helpers$[
  {
    "identity": "public.static_weekly_pending_assert_payload(uuid,uuid,jsonb)",
    "sha256": "3cd46f205ccfef0d64c5cbe1b826117d462608aabcbbdf358fc9a911463e29af"
  },
  {
    "identity": "public.static_weekly_pending_assert_lunch(uuid,uuid,uuid,date,jsonb,jsonb)",
    "sha256": "f369414eb5a37e371e3064058394a7c7734932196c5e512739646a6197c85b58"
  },
  {
    "identity": "public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)",
    "sha256": "601588840d94bc7d36601887b1980481090f16c2c27aace5b0905337ee55f987"
  }
]$helpers$::jsonb) LOOP
  IF public.static_weekly_digest_text(pg_get_functiondef(to_regprocedure(item->>'identity'))) IS DISTINCT FROM item->>'sha256'
  THEN RAISE EXCEPTION 'Independent pending helper changed';END IF;
 END LOOP;
 IF EXISTS(SELECT * FROM staffing_validation_recovery_before EXCEPT SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest)
 THEN RAISE EXCEPTION 'Existing recovery inventory/canary changed during pre-canonical qualification';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required throughout';END IF;
END $single_validation$;
COMMIT;
