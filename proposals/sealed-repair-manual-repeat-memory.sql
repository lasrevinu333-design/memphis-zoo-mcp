-- PRE-CANONICAL INTERNAL QUALIFICATION COMPONENT, not release acceptance.
-- Same four exact product postimages as failed aef6; only the recovery
-- predecessor contract is corrected to observed exact absence for all four.
-- Preserve the ENTIRE existing recovery inventory and canary unchanged.
-- Main MUST complete final40-name canonical enrollment/binding in its
-- original-owner prelude snapshot -> FINAL binding before canonical/release
-- acceptance. This component neither captures nor enrolls recovery objects.
-- No changed resource limit, historical migration, source guard or schedule.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE manual_repeat_lifetime_targets(identity text PRIMARY KEY,definition text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE manual_repeat_recovery_witness ON COMMIT DROP AS SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest;
DO $lifetime$
DECLARE item jsonb;edit jsonb;original text;changed text;inverse text;target oid;
 before_owner oid;before_acl aclitem[];before_grants text;
BEGIN
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements($changes$[
  {
    "name": "static_weekly_finish_manual_recurring_normal",
    "identity": "public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text)",
    "beforeSha256": "90e0041bf54c53a04117e3dd8d89e272c291e7f94ed431261f7f823389098e15",
    "afterSha256": "57174a2b1ea56528099e3eae2aa8832f6f0c3cc3c32d4888bfb41363877c5165",
    "replacements": [
      {
        "old": " r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);",
        "new": " -- Reference and employment vector checks above have consumed this copy.\n a.repeat_basis:=NULL;\n r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);"
      }
    ]
  },
  {
    "name": "static_weekly_materialize_manual_repeat",
    "identity": "public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)",
    "beforeSha256": "27adb55afccf85093df87036e44097efa69e3d9d6c5aa953a89b688f7ba5f4cd",
    "afterSha256": "eaa30f710b32b9daf94b5f1150d7ce418a36d2b64d785c11221b1047eff00bb0",
    "replacements": [
      {
        "old": " PERFORM public.custodial_begin_application_mutation();\n components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);",
        "new": " -- All full basis/reference/employment checks above are complete. Retain\n -- only the exact scalar fields read by the unchanged receipt below.\n basis:=jsonb_build_object('sourceId',basis->'sourceId','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd');\n expected:=NULL;vector:=NULL;reasons:=NULL;employee:=NULL;v_day:=NULL;\n PERFORM public.custodial_begin_application_mutation();\n components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);"
      },
      {
        "old": " projection:=components->'projection';\n PERFORM public.static_weekly_manual_assert_lunch_lineage",
        "new": " projection:=components->'projection';\n -- The complete lunch remains; do not also retain a second projection copy.\n components:=components-'projection';\n PERFORM public.static_weekly_manual_assert_lunch_lineage"
      },
      {
        "old": " IF materialized->'ok' IS DISTINCT FROM 'true'::jsonb OR materialized->>'revision' IS NULL OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED' THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist'; END IF;",
        "new": " -- The native producer returns static_weekly_response_json, not an `ok`\n -- wrapper. Bind its exact shape, digest and actual immutable receipt/rows.\n PERFORM public.static_weekly_assert_exact_object(materialized,\n  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],\n  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],'normal repeat native response');\n PERFORM public.static_weekly_assert_exact_object(materialized->'data',\n  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],\n  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],'normal repeat native response data');\n IF materialized->>'operation' IS DISTINCT FROM 'materialize_projection'\n  OR jsonb_typeof(materialized->'revision') IS DISTINCT FROM 'number'\n  OR (materialized->>'revision')::bigint<=revision\n  OR (materialized->>'revision')::bigint IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)\n  OR materialized#>>'{data,publication_id}' IS DISTINCT FROM publication::text\n  OR materialized#>>'{data,week_start}' IS DISTINCT FROM frame::text\n  OR materialized#>>'{data,week_end}' IS DISTINCT FROM (frame+6)::text\n  OR coalesce(materialized->>'content_digest','')!~'^[a-f0-9]{64}$'\n  OR coalesce(materialized->>'request_digest','')!~'^[a-f0-9]{64}$'\n  OR materialized->>'output_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(materialized-'output_digest')\n  OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED'\n  OR lunch->>'projection_id' IS DISTINCT FROM materialized#>>'{data,projection_id}'\n  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_command_receipts command_receipt\n   JOIN public.weekly_schedule_compiled_projections stored_projection\n    ON stored_projection.projection_id::text=materialized#>>'{data,projection_id}'\n   JOIN public.weekly_schedule_lunch_documents stored_lunch USING(projection_id)\n   WHERE command_receipt.actor_manager_id=manager AND command_receipt.idempotency_key=request::text||':normal-period'\n    AND command_receipt.command_type='materialize_projection' AND command_receipt.expected_revision=revision\n    AND command_receipt.request_digest=materialized->>'request_digest'\n    AND command_receipt.content_digest=materialized->>'content_digest'\n    AND command_receipt.response_digest=materialized->>'output_digest' AND command_receipt.response_json=materialized\n    AND stored_projection.publication_id=publication AND stored_projection.week_start=frame AND stored_projection.week_end=frame+6\n    AND stored_projection.compiler_version='approved-manual-repeat-v1'\n    AND stored_projection.replay_digest=materialized#>>'{data,replay_digest}'\n    AND stored_lunch.document_identity=lunch->>'document_identity')\n THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist';END IF;"
      }
    ]
  },
  {
    "name": "static_weekly_manual_repeat_components",
    "identity": "public.static_weekly_manual_repeat_components(uuid,date)",
    "beforeSha256": "01d1b47593688a3d586e5c90e6bfdc4c49eb613b41645010001126401b9360e6",
    "afterSha256": "6cf42446e79ace87729a88338109b82342a9f09c206cc079c0b18791ce579778",
    "replacements": [
      {
        "old": " projection:=projection-'database_projection_identity';",
        "new": " -- Each removed field is replaced in the immediately following expression.\n -- One deletion avoids copying the obsolete authority and assignment arrays.\n projection:=projection-ARRAY['database_projection_identity','authority','assignments'];"
      },
      {
        "old": " lunch:=lunch-'document_identity';",
        "new": " -- The new projection now owns these exact transposed values.\n authority:=NULL;input:=NULL;overlay_input:=NULL;availability:=NULL;\n lunch:=lunch-'document_identity';"
      },
      {
        "old": " lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];",
        "new": " -- The new lunch document now owns these exact arrays and identifiers.\n loans:=NULL;responsibilities:=NULL;intents:=NULL;loan_keys:=NULL;\n lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];"
      },
      {
        "old": " replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));",
        "new": " replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));\n rows:=NULL;"
      }
    ]
  },
  {
    "name": "static_weekly_manual_repeat_materialize_projection",
    "identity": "public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)",
    "beforeSha256": "add0c554df14ce9330c4d4beeddb4a46cd872d7b81a1abb6a9fb30bb019abf4e",
    "afterSha256": "16db921f27ff1627ef42172f5290878500c6c4cc6c9b4f40fd74829e9fc7ac24",
    "replacements": [
      {
        "old": "v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock",
        "new": "v_request_digest:=public.static_weekly_digest_jsonb(v_request);\n  -- Digest the full unchanged request before replay lookup, then release its\n  -- projection copy while the exact native validator reconstructs expected rows.\n  v_request:=NULL;\n  perform pg_advisory_xact_lock"
      },
      {
        "old": "  v_response:=public.static_weekly_response_json('materialize_projection'",
        "new": "  -- Inputs are unchanged; reconstruct the same full canonical request for\n  -- the existing immutable receipt, without retaining it through validation.\n  v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name);\n  v_response:=public.static_weekly_response_json('materialize_projection'"
      }
    ]
  }
]$changes$::jsonb) LOOP
  target:=to_regprocedure(item->>'identity');
  IF target IS NULL THEN RAISE EXCEPTION 'Recurring lifetime predecessor missing';END IF;
  original:=pg_get_functiondef(target);
  IF public.static_weekly_digest_text(original) IS DISTINCT FROM item->>'beforeSha256'
  THEN RAISE EXCEPTION 'Recurring lifetime predecessor changed: %',item->>'identity';END IF;
  SELECT proowner,proacl INTO STRICT before_owner,before_acl FROM pg_proc WHERE oid=target;
  before_grants:=public.custodial_release_authority_current_grant_definition(item->>'identity');
  -- Actual canonical303 predecessor has NONE of these function/grant
  -- aliases or canary roots. Do not accept already/partly enrolled variants.
  IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory
    WHERE CASE WHEN object_kind IN('function','grant') AND position('(' IN object_identity)>0
     THEN to_regprocedure(object_identity) END=target)
   OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface()
    WHERE CASE WHEN object_kind IN('function','grant') AND position('(' IN object_identity)>0
     THEN to_regprocedure(object_identity) END=target)
  THEN RAISE EXCEPTION 'Exact absence of recurring recovery membership and canary roots required';END IF;
  changed:=original;
  FOR edit IN SELECT value FROM jsonb_array_elements(item->'replacements') LOOP
   IF length(changed)-length(replace(changed,edit->>'old',''))<>length(edit->>'old')
   THEN RAISE EXCEPTION 'Recurring lifetime seam missing or repeated';END IF;
   changed:=replace(changed,edit->>'old',edit->>'new');
  END LOOP;
  inverse:=changed;
  FOR edit IN SELECT value FROM jsonb_array_elements(item->'replacements') WITH ORDINALITY x(value,n) ORDER BY n DESC LOOP
   IF length(inverse)-length(replace(inverse,edit->>'new',''))<>length(edit->>'new')
   THEN RAISE EXCEPTION 'Recurring lifetime inverse seam differs';END IF;
   inverse:=replace(inverse,edit->>'new',edit->>'old');
  END LOOP;
  IF inverse IS DISTINCT FROM original OR public.static_weekly_digest_text(changed) IS DISTINCT FROM item->>'afterSha256'
  THEN RAISE EXCEPTION 'Recurring lifetime full inverse/postimage differs';END IF;
  EXECUTE changed;
  IF pg_get_functiondef(target) IS DISTINCT FROM changed
   OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_owner
   OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_acl
   OR public.custodial_release_authority_current_grant_definition(item->>'identity') IS DISTINCT FROM before_grants
  THEN RAISE EXCEPTION 'Recurring lifetime owner/ACL/postimage changed';END IF;
  INSERT INTO manual_repeat_lifetime_targets VALUES(item->>'identity',changed);
 END LOOP;
END $lifetime$;
DO $recovery_preserved$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM manual_repeat_lifetime_targets)<>4 THEN RAISE EXCEPTION 'Exactly four existing recurring functions required';END IF;
 IF EXISTS(SELECT * FROM manual_repeat_recovery_witness EXCEPT SELECT
 (SELECT public.static_weekly_digest_text(string_agg(public.static_weekly_digest_text(to_jsonb(i)::text),E'\n' ORDER BY i.inventory_id))
  FROM public.custodial_release_authority_restore_inventory i) AS inventory_digest,
 (SELECT count(*) FROM public.custodial_release_authority_restore_inventory) AS inventory_rows,
 public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)) AS canary_definition_digest,
 (SELECT public.static_weekly_digest_text(to_jsonb(p)::text) FROM pg_proc p
  WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure) AS canary_metadata_digest,
 (SELECT public.static_weekly_digest_jsonb(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.object_kind,s.object_identity,s.purpose),'[]'::jsonb))
  FROM public.custodial_release_canary_authority_surface() s) AS canary_roots_digest)
 THEN RAISE EXCEPTION 'Entire recovery inventory or canary changed during pre-canonical qualification';END IF;
 IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable') IS DISTINCT FROM 'A'
 THEN RAISE EXCEPTION 'Exact ALWAYS recovery guard required throughout';END IF;
 FOR r IN SELECT * FROM manual_repeat_lifetime_targets LOOP
  IF pg_get_functiondef(to_regprocedure(r.identity)) IS DISTINCT FROM r.definition
  THEN RAISE EXCEPTION 'Final recurring postimage changed';END IF;
 END LOOP;
END $recovery_preserved$;
COMMIT;
