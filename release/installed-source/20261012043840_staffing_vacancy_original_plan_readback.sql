-- Main normal CLI-generated scaffold; isolated source263 proposal only.
-- Frozen B1151cf34/treecb7fad. No writer, grant, raw envelope or key output.
-- Original reader prosrc: a45db2e1...e221bc /1836 UTF8 bytes (source256).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE vacancy_plan_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE vacancy_plan_reader_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,proconfig,prolang,provolatile,proparallel,prosecdef,prosrc,
  pg_get_functiondef(oid) definition,
  public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) grant_definition
 FROM pg_proc WHERE oid='public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)'::regprocedure;
CREATE TEMP TABLE vacancy_plan_canary_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;

DO $reader$
DECLARE target regprocedure:='public.static_weekly_read_original_staffing_outcome_v1(uuid,text,text)'::regprocedure;
 before text;after text;changed integer;
 declaration constant text:=$declaration$DECLARE original public.weekly_schedule_command_receipts%rowtype;completed jsonb;$declaration$;
 expanded_declaration constant text:=$expanded$DECLARE original public.weekly_schedule_command_receipts%rowtype;completed jsonb;
 projection_receipt public.weekly_schedule_command_receipts%rowtype;
 original_projection public.weekly_schedule_compiled_projections%rowtype;
 original_lunch public.weekly_schedule_lunch_documents%rowtype;
 request jsonb;persisted_candidate jsonb;worker_candidate jsonb;
 projection_key text;service_date date;week_start date;$expanded$;
 return_needle constant text:=$return$ RETURN jsonb_build_object('schema','custodial.original-staffing-outcome.v1','state','ACCEPTED_ORIGINAL',$return$;
 vacancy_branch constant text:=$vacancy$
 IF p_operation='vacate_roster_slot' THEN
  -- v9 already verifies the original mutation/projection revision chain and
  -- original paired lunch. Repeat full immutable row/request relationships;
  -- never resolve today's latest projection or adopt a caller's saved hash.
  IF original.response_json#>>'{data,completion_mode}' IS DISTINCT FROM 'projection_required'
   OR jsonb_typeof(completed->'data') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION USING errcode='23514',message='Original vacancy prepared plan is unavailable';
  END IF;
  projection_key:='projection-'||public.static_weekly_digest_text(p_idempotency_key);
  SELECT * INTO projection_receipt FROM public.weekly_schedule_command_receipts
   WHERE actor_manager_id=p_manager_id AND idempotency_key=projection_key AND command_type='materialize_projection';
  IF NOT FOUND THEN
   RAISE EXCEPTION USING errcode='23514',message='Original vacancy projection command is unavailable';
  END IF;
  PERFORM public.static_weekly_v8_assert_vacancy_receipt(projection_receipt.command_id,'materialize_projection');
  request:=projection_receipt.request_canonical_json;
  service_date:=(original.request_canonical_json->>'effective_start')::date;
  week_start:=service_date-(extract(isodow FROM service_date)::integer-1);
  IF projection_receipt.expected_revision IS DISTINCT FROM original.expected_revision+1
   OR (projection_receipt.response_json->>'revision')::bigint IS DISTINCT FROM original.expected_revision+2
   OR request->>'publication_id' IS DISTINCT FROM original.response_json#>>'{data,original_publication_id}'
   OR request->>'service_date' IS DISTINCT FROM week_start::text
   OR (completed->>'revision')::bigint IS DISTINCT FROM original.expected_revision+2
   OR completed#>>'{data,projection_id}' IS DISTINCT FROM projection_receipt.response_json#>>'{data,projection_id}' THEN
   RAISE EXCEPTION USING errcode='23514',message='Original vacancy prepared plan command binding changed';
  END IF;
  SELECT * INTO original_projection FROM public.weekly_schedule_compiled_projections
   WHERE projection_id=(projection_receipt.response_json#>>'{data,projection_id}')::uuid;
  IF NOT FOUND
   OR original_projection.publication_id::text IS DISTINCT FROM request->>'publication_id'
   OR original_projection.week_start IS DISTINCT FROM week_start
   OR original_projection.week_end IS DISTINCT FROM week_start+6
   OR original_projection.compiled_by_manager_id IS DISTINCT FROM p_manager_id
   OR original_projection.exception_set_digest IS DISTINCT FROM request->>'exception_set_digest'
   OR public.static_weekly_digest_jsonb(original_projection.exception_set_json) IS DISTINCT FROM original_projection.exception_set_digest
   OR original_projection.compiler_version IS DISTINCT FROM request->>'compiler_version'
   OR original_projection.objective_json IS DISTINCT FROM request->'objective'
   OR original_projection.metrics_json IS DISTINCT FROM request->'metrics'
   OR original_projection.replay_digest IS DISTINCT FROM request->>'replay_digest'
   OR original_projection.projection_envelope IS DISTINCT FROM request->'projection_envelope'
   OR original_projection.authority_digest IS DISTINCT FROM request#>>'{projection_envelope,authority_digest}'
   OR original_projection.receipt_json IS DISTINCT FROM request#>'{projection_envelope,receipt}'
   OR completed#>>'{data,current_projection,projection_id}' IS DISTINCT FROM original_projection.projection_id::text
   OR completed#>>'{data,current_projection,publication_id}' IS DISTINCT FROM original_projection.publication_id::text
   OR completed#>>'{data,current_projection,version_id}' IS DISTINCT FROM original_projection.version_id::text THEN
   RAISE EXCEPTION USING errcode='23514',message='Original vacancy complete prepared projection is inconsistent';
  END IF;
  -- The existing owning assertion checks the CLOSED complete envelope,
  -- source/semantic identity and real versioned HMAC through the normal key
  -- verifier. No key is read or emitted by this reader and no grant is added.
  PERFORM public.static_weekly_assert_projection_envelope_attested(
   original_projection.projection_envelope,original_projection.publication_id,
   original_projection.week_start,original_projection.exception_set_json);
  PERFORM public.static_weekly_assert_authority_attestation(
   original_projection.projection_envelope->'attestation','dated_projection',
   public.static_weekly_projection_attestation_payload(original_projection.projection_envelope));
  SELECT * INTO original_lunch FROM public.weekly_schedule_lunch_documents
   WHERE projection_id=original_projection.projection_id;
  IF NOT FOUND OR original_lunch.accepted_by_manager_id IS DISTINCT FROM p_manager_id
   OR original_lunch.document_identity IS DISTINCT FROM original_lunch.document_json->>'document_identity'
   OR original_lunch.document_json->>'base_authority_digest' IS DISTINCT FROM original_projection.authority_digest
   OR original_lunch.document_json->>'base_replay_digest' IS DISTINCT FROM original_projection.replay_digest THEN
   RAISE EXCEPTION USING errcode='23514',message='Original vacancy paired lunch identity changed';
  END IF;
  PERFORM public.static_weekly_v8_assert_lunch_document(original_projection.projection_id,original_lunch.document_json);
  -- Exact camel DTO mirrors the pure prepared candidate's 12 RPC fields.
  -- The fixed writer stores snake keys; idempotency is the actual receipt key.
  persisted_candidate:=jsonb_build_object(
   'publicationId',request->'publication_id','serviceDate',request->'service_date',
   'exceptionSetDigest',request->'exception_set_digest','compilerVersion',request->'compiler_version',
   'objective',request->'objective','metrics',request->'metrics','replayDigest',request->'replay_digest',
   'envelope',request->'projection_envelope','expectedRevision',request->'expected_revision',
   'actorManagerId',request->'actor_manager_id','idempotencyKey',projection_receipt.idempotency_key,
   'lunchDocument',original_lunch.document_json);
  -- Only v3's source-proved server-added TOP-LEVEL attestation is removed.
  -- Owning assertion above rejects unknown envelope fields/signatures. Keep
  -- complete worker identity/receipt/authority/compiler/source/lunch bytes.
  worker_candidate:=jsonb_set(persisted_candidate,'{envelope}',
   original_projection.projection_envelope-'attestation',false);
  completed:=jsonb_set(completed,'{data}',completed->'data'||jsonb_build_object(
   'persisted_projection_digest',public.static_weekly_digest_jsonb(persisted_candidate),
   'worker_candidate_digest',public.static_weekly_digest_jsonb(worker_candidate),
   'paired_lunch_document_identity',original_lunch.document_identity,
   'projection_authority_digest',original_projection.authority_digest),false);
 END IF;
$vacancy$;
BEGIN
 SELECT definition INTO STRICT before FROM vacancy_plan_reader_before;
 IF (SELECT public.static_weekly_digest_text(prosrc) FROM vacancy_plan_reader_before)
    IS DISTINCT FROM 'a45db2e1c22aa4acb2c9f659aa035c8859b6e933a9c3f39b75e23e7054e221bc'
  OR (SELECT octet_length(convert_to(prosrc,'UTF8')) FROM vacancy_plan_reader_before)<>1836
  OR (length(before)-length(replace(before,declaration,'')))/length(declaration)<>1
  OR (length(before)-length(replace(before,return_needle,'')))/length(return_needle)<>1
  OR EXISTS(SELECT 1 FROM vacancy_plan_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (SELECT count(*) FROM vacancy_plan_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target AND definition_sql=before)<>1
  OR (SELECT count(*) FROM vacancy_plan_inventory_before WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=(SELECT grant_definition FROM vacancy_plan_reader_before))<>1
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface()
    WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
  OR NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface()
    WHERE object_kind='grant' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Original vacancy exact reader/recovery predecessor changed';END IF;
 after:=replace(replace(before,declaration,expanded_declaration),return_needle,vacancy_branch||return_needle);
 EXECUTE after;
 IF pg_get_functiondef(target) IS DISTINCT FROM after
  OR EXISTS(SELECT 1 FROM pg_proc now JOIN vacancy_plan_reader_before old ON old.oid=now.oid
    WHERE ROW(now.proowner,now.proacl,now.proconfig,now.prolang,now.provolatile,now.proparallel,now.prosecdef)
      IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,old.prosecdef))
  OR public.custodial_release_authority_current_grant_definition('public.'||target::text)
    IS DISTINCT FROM (SELECT grant_definition FROM vacancy_plan_reader_before)
 THEN RAISE EXCEPTION 'Original vacancy reader owner/ACL/attributes changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=after,
  definition_sha256=public.static_weekly_digest_text(after),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
   AND definition_sql=before AND definition_sha256=public.static_weekly_digest_text(before);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Original vacancy exact reader recovery row changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM vacancy_plan_inventory_before)
  OR EXISTS(SELECT old.* FROM vacancy_plan_inventory_before old WHERE NOT(object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT current.* FROM public.custodial_release_authority_restore_inventory current WHERE NOT(object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)
    EXCEPT SELECT * FROM vacancy_plan_inventory_before)
  OR EXISTS(SELECT 1 FROM pg_proc now JOIN vacancy_plan_canary_before old ON old.oid=now.oid
    WHERE ROW(now.proowner,now.proacl,pg_get_functiondef(now.oid)) IS DISTINCT FROM ROW(old.proowner,old.proacl,old.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Original vacancy unrelated recovery/canary scope or final ALWAYS guard changed';END IF;
END $reader$;
COMMIT;
