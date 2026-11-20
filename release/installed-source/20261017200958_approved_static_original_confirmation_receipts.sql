-- Original fixed-approved recurring receipts and closed ordinary materializer.
-- No generic receipt writer, acceptance seed or old-v13 ledger change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE approved_original_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE approved_original_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ DECLARE body text;BEGIN
 SELECT definition INTO STRICT body FROM approved_original_surface_before;
 IF EXISTS(SELECT 1 FROM approved_original_inventory_before
   WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR (SELECT count(*) FROM approved_original_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure AND definition_sql=body)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('public.static_weekly_approved_template_confirmations') IS NOT NULL
  OR to_regprocedure('public.static_weekly_guard_approved_template_confirmation()') IS NOT NULL
  OR to_regprocedure('public.static_weekly_read_approved_template_confirmation(uuid,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'Approved original confirmation recovery predecessor changed';END IF;
END $predecessor$;

CREATE TABLE public.static_weekly_approved_template_confirmations (
 manager_id uuid NOT NULL,
 idempotency_key text NOT NULL,
 request_json jsonb NOT NULL,
 receipt_json jsonb NOT NULL,
 source_publication_id uuid NOT NULL,
 publication_id uuid NOT NULL,
 projection_id uuid NOT NULL,
 CONSTRAINT approved_confirmation_original_key PRIMARY KEY(manager_id,idempotency_key),
 CONSTRAINT approved_confirmation_manager_fk FOREIGN KEY(manager_id)
  REFERENCES public.ops_manager_managers(manager_id) ON DELETE RESTRICT,
 CONSTRAINT approved_confirmation_source_fk FOREIGN KEY(source_publication_id)
  REFERENCES public.weekly_schedule_publications(publication_id) ON DELETE RESTRICT,
 CONSTRAINT approved_confirmation_publication_fk FOREIGN KEY(publication_id)
  REFERENCES public.weekly_schedule_publications(publication_id) ON DELETE RESTRICT,
 CONSTRAINT approved_confirmation_projection_fk FOREIGN KEY(projection_id)
  REFERENCES public.weekly_schedule_compiled_projections(projection_id) ON DELETE RESTRICT,
 CONSTRAINT approved_confirmation_projection_once UNIQUE(projection_id),
 CONSTRAINT approved_confirmation_key_shape CHECK(length(idempotency_key)=36
  AND idempotency_key~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 CONSTRAINT approved_confirmation_objects CHECK((jsonb_typeof(request_json)='object' AND jsonb_typeof(receipt_json)='object') IS TRUE),
 CONSTRAINT approved_confirmation_publication_profile CHECK((
  jsonb_typeof(request_json->'kind')='string' AND (
   (request_json->>'kind'='RECURRING_STAFFING' AND request_json->'publicationId'='null'::jsonb
    AND publication_id<>source_publication_id)
   OR (request_json->>'kind'='DATED_ABSENCE' AND request_json->'publicationId'=to_jsonb(source_publication_id::text)
    AND publication_id=source_publication_id)
  )) IS TRUE)
);
-- A recurring replacement is still unique per new publication. Distinct
-- dated original confirmations may retain that publication, never a projection.
CREATE UNIQUE INDEX approved_confirmation_publication_once
 ON public.static_weekly_approved_template_confirmations(publication_id)
 WHERE request_json->>'kind'='RECURRING_STAFFING';
-- The original manager/key lookup uses the composite primary key. Accepted
-- child FKs use their unique indexes; only the source FK needs another index.
CREATE INDEX approved_confirmation_source_publication_idx
 ON public.static_weekly_approved_template_confirmations(source_publication_id);
ALTER TABLE public.static_weekly_approved_template_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.static_weekly_approved_template_confirmations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.static_weekly_approved_template_confirmations
 FROM public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;

-- Private structural binding, not a publication/certificate/admission API.
-- Only a future controlled writer can insert; this migration inserts NO receipt.
CREATE FUNCTION public.static_weekly_guard_approved_template_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_expected_revision numeric;v_accepted_revision numeric;v_service_date date;v_kind text;v_week date;
 v_actor jsonb;v_generation bigint;v_checked jsonb;
 v_publication public.weekly_schedule_publications%rowtype;
 v_projection public.weekly_schedule_compiled_projections%rowtype;
 v_lunch public.weekly_schedule_lunch_documents%rowtype;
BEGIN
 IF TG_RELID<>'public.static_weekly_approved_template_confirmations'::regclass
  OR TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'static_weekly_approved_template_confirmations'
  OR TG_OP<>'INSERT' OR TG_WHEN<>'BEFORE' OR TG_LEVEL<>'ROW' THEN
  RAISE EXCEPTION USING errcode='23514',message='Exact approved original confirmation trigger required';END IF;
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 PERFORM public.static_weekly_v3_manager_actor(NEW.manager_id);
 PERFORM public.static_weekly_assert_exact_object(NEW.request_json,
  ARRAY['serviceDate','kind','expectedRevision','previewDigest','idempotencyKey'],
  ARRAY['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'],
  'original approved recurring request');
 IF NOT (NEW.request_json ?& ARRAY['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'])
  OR jsonb_typeof(NEW.request_json->'kind') IS DISTINCT FROM 'string'
  OR NEW.request_json->>'kind' NOT IN('RECURRING_STAFFING','DATED_ABSENCE')
  OR NEW.request_json->'idempotencyKey' IS DISTINCT FROM to_jsonb(NEW.idempotency_key)
  OR jsonb_typeof(NEW.request_json->'serviceDate') IS DISTINCT FROM 'string'
  OR length(NEW.request_json->>'serviceDate')<>10
  OR NEW.request_json->>'serviceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(NEW.request_json->'expectedRevision') IS DISTINCT FROM 'number'
  OR NEW.request_json->>'expectedRevision' !~ '^(0|[1-9][0-9]*)$'
  OR jsonb_typeof(NEW.request_json->'previewDigest') IS DISTINCT FROM 'string'
  OR length(NEW.request_json->>'previewDigest')<>64
  OR NEW.request_json->>'previewDigest' !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING errcode='23514',message='Exact original recurring request identity required';END IF;
 IF NEW.request_json->'templateId' IS DISTINCT FROM 'null'::jsonb THEN
  PERFORM public.static_weekly_v3_assert_text(NEW.request_json->'templateId','original approved template',128);
  IF NEW.request_json->>'templateId' IS DISTINCT FROM btrim(NEW.request_json->>'templateId') THEN
   RAISE EXCEPTION USING errcode='23514',message='Original approved template identity must not be normalized';END IF;
 END IF;
 v_kind:=NEW.request_json->>'kind';
 IF (v_kind='RECURRING_STAFFING' AND (NEW.request_json->'publicationId' IS DISTINCT FROM 'null'::jsonb
    OR NEW.publication_id=NEW.source_publication_id))
  OR (v_kind='DATED_ABSENCE' AND (NEW.request_json->'publicationId' IS DISTINCT FROM to_jsonb(NEW.source_publication_id::text)
    OR NEW.publication_id IS DISTINCT FROM NEW.source_publication_id))
 THEN RAISE EXCEPTION USING errcode='23514',message='Original approved kind and publication profile differs';END IF;
 v_service_date:=(NEW.request_json->>'serviceDate')::date;
 v_expected_revision:=(NEW.request_json->>'expectedRevision')::numeric;
 IF NOT isfinite(v_service_date) OR (v_kind='RECURRING_STAFFING' AND extract(isodow FROM v_service_date)<>1) OR v_expected_revision>9007199254740991 THEN
  RAISE EXCEPTION USING errcode='23514',message='Original recurring Monday and supported exact revision required';END IF;
 PERFORM public.static_weekly_assert_exact_object(NEW.receipt_json,
  ARRAY['schema','status','ok','persistence_status','publication_id','projection_id','authority_revision','revision',
   'feasibility_digest','lunch_document_identity','previewDigest','solverInvoked'],
  ARRAY['schema','status','ok','persistence_status','source_id','publication_id','projection_id','authority_revision','revision',
   'feasibility_digest','lunch_document_identity','previewDigest','solverInvoked'],'original approved recurring receipt');
 IF NEW.receipt_json->'schema' IS DISTINCT FROM '"custodial.approved-static-confirmation.v1"'::jsonb
  OR NEW.receipt_json->'status' IS DISTINCT FROM '"PERSISTED_CURRENT"'::jsonb
  OR NEW.receipt_json->'ok' IS DISTINCT FROM 'true'::jsonb
  OR NEW.receipt_json->'persistence_status' IS DISTINCT FROM '"PERSISTED"'::jsonb
  OR NEW.receipt_json->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
  OR NEW.receipt_json->'publication_id' IS DISTINCT FROM to_jsonb(NEW.publication_id::text)
  OR NEW.receipt_json->'projection_id' IS DISTINCT FROM to_jsonb(NEW.projection_id::text)
  OR NEW.receipt_json->'previewDigest' IS DISTINCT FROM NEW.request_json->'previewDigest'
  OR jsonb_typeof(NEW.receipt_json->'authority_revision') IS DISTINCT FROM 'number'
  OR NEW.receipt_json->>'authority_revision' !~ '^[1-9][0-9]*$'
  OR jsonb_typeof(NEW.receipt_json->'revision') IS DISTINCT FROM 'number'
  OR NEW.receipt_json->>'revision' !~ '^[1-9][0-9]*$'
  OR NEW.receipt_json->'revision' IS DISTINCT FROM NEW.receipt_json->'authority_revision'
  OR jsonb_typeof(NEW.receipt_json->'feasibility_digest') IS DISTINCT FROM 'string'
  OR length(NEW.receipt_json->>'feasibility_digest')<>64 OR NEW.receipt_json->>'feasibility_digest' !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(NEW.receipt_json->'lunch_document_identity') IS DISTINCT FROM 'string'
  OR length(NEW.receipt_json->>'lunch_document_identity')<>64 OR NEW.receipt_json->>'lunch_document_identity' !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING errcode='23514',message='Exact original accepted recurring receipt required';END IF;
 v_accepted_revision:=(NEW.receipt_json->>'authority_revision')::numeric;
 IF v_accepted_revision<=v_expected_revision OR v_accepted_revision>9007199254740991 THEN
  RAISE EXCEPTION USING errcode='23514',message='Original accepted recurring revision must advance exactly within the supported range';END IF;
 -- source_id is an existing optional accepted-result field, not a newly
 -- required writer field. If present, bind it to the actual accepted version.
 IF NEW.receipt_json ? 'source_id' THEN
  IF jsonb_typeof(NEW.receipt_json->'source_id') IS DISTINCT FROM 'string'
   OR length(NEW.receipt_json->>'source_id')<>36
   OR NEW.receipt_json->>'source_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION USING errcode='23514',message='Original accepted source identity differs';END IF;
 END IF;
 IF v_kind='RECURRING_STAFFING' THEN
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_publications p
  JOIN public.weekly_schedule_versions v ON v.version_id=p.version_id
  JOIN public.weekly_schedule_compiled_projections x ON x.publication_id=p.publication_id AND x.version_id=v.version_id
  JOIN public.weekly_schedule_lunch_documents l ON l.projection_id=x.projection_id
  WHERE p.publication_id=NEW.publication_id AND x.projection_id=NEW.projection_id
   AND p.actor_manager_id=NEW.manager_id AND x.compiled_by_manager_id=NEW.manager_id AND l.accepted_by_manager_id=NEW.manager_id
   AND p.effective_start=v_service_date AND x.week_start=v_service_date AND x.week_end=v_service_date+6
   AND p.authority_revision>v_expected_revision AND p.authority_revision<=v_accepted_revision
   AND l.document_identity=NEW.receipt_json->>'lunch_document_identity'
   AND (NOT (NEW.receipt_json ? 'source_id') OR NEW.receipt_json->>'source_id'=v.authority_source_id::text)) THEN
  RAISE EXCEPTION USING errcode='23514',message='Original recurring receipt must reference its actual accepted publication projection and lunch';
 END IF;
 ELSE
  -- Prove the actual same-publication dated write, not the old publication's
  -- creator/effective start/revision. No receipt JSON is an admission flag.
  v_week:=v_service_date-(extract(isodow FROM v_service_date)::integer-1);
  v_actor:=public.static_weekly_v3_manager_actor(NEW.manager_id);
  v_generation:=public.static_weekly_v15_read_recurring_generation();
  IF v_generation IS NULL OR v_generation NOT BETWEEN 0 AND 9007199254740991
   OR NOT(NEW.receipt_json ? 'source_id')
   OR v_accepted_revision IS DISTINCT FROM v_expected_revision+1
   OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM v_accepted_revision
  THEN RAISE EXCEPTION USING errcode='23514',message='Dated original current actor generation or exact advanced revision differs';END IF;
  SELECT * INTO STRICT v_publication FROM public.weekly_schedule_publications
   WHERE publication_id=NEW.source_publication_id;
  SELECT * INTO STRICT v_projection FROM public.weekly_schedule_compiled_projections
   WHERE projection_id=NEW.projection_id;
  SELECT * INTO STRICT v_lunch FROM public.weekly_schedule_lunch_documents
   WHERE projection_id=NEW.projection_id;
  IF v_projection.publication_id IS DISTINCT FROM NEW.publication_id
   OR v_projection.version_id IS DISTINCT FROM v_publication.version_id
   OR public.static_weekly_effective_version(v_week) IS DISTINCT FROM v_publication.version_id
   OR public.static_weekly_effective_version(v_week+6) IS DISTINCT FROM v_publication.version_id
   OR v_projection.week_start IS DISTINCT FROM v_week OR v_projection.week_end IS DISTINCT FROM v_week+6
   OR v_projection.compiled_by_manager_id IS DISTINCT FROM NEW.manager_id
   OR v_lunch.accepted_by_manager_id IS DISTINCT FROM NEW.manager_id
   OR v_lunch.document_identity IS DISTINCT FROM NEW.receipt_json->>'lunch_document_identity'
   OR v_lunch.document_json->>'document_identity' IS DISTINCT FROM v_lunch.document_identity
   OR v_lunch.document_json->>'week_start' IS DISTINCT FROM v_week::text
   OR v_projection.receipt_json IS DISTINCT FROM v_projection.projection_envelope->'receipt'
   OR v_projection.receipt_json->'feasibilityDigest' IS DISTINCT FROM NEW.receipt_json->'feasibility_digest'
   OR v_projection.projection_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-dated-v1'
   OR v_projection.projection_envelope#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-static-dated-adapter.v1'
   OR v_projection.projection_envelope#>>'{authority,originalPublicationId}' IS DISTINCT FROM NEW.publication_id::text
   OR v_projection.projection_envelope#>>'{authority,originalVersionId}' IS DISTINCT FROM v_publication.version_id::text
   OR v_projection.projection_envelope#>'{authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(v_service_date::text)
   OR v_projection.projection_envelope#>'{authority,scopeDays}' IS DISTINCT FROM jsonb_build_array(extract(dow FROM v_service_date)::integer)
   OR v_projection.authority_digest IS DISTINCT FROM v_projection.projection_envelope->>'authority_digest'
   OR v_projection.replay_digest IS DISTINCT FROM v_projection.projection_envelope->>'replay_digest'
   OR v_projection.exception_set_json IS DISTINCT FROM public.static_weekly_accepted_exception_set(NEW.publication_id,v_week)
   OR v_projection.exception_set_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(v_projection.exception_set_json)
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_versions v
    JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id
    WHERE v.version_id=v_publication.version_id AND s.active
     AND s.source_id::text=NEW.receipt_json->>'source_id'
     AND s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source))
  THEN RAISE EXCEPTION USING errcode='23514',message='Dated receipt does not bind its actual original current Source projection and lunch';END IF;
  -- Existing immutable command/revision records prove that THIS manager
  -- actually advanced the original requested revision for THIS projection.
  -- They are not fabricated here, and old publication metadata is not changed.
  IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_command_receipts c
   JOIN public.weekly_schedule_authority_revisions a ON a.command_id=c.command_id
   WHERE c.actor_manager_id=NEW.manager_id AND a.actor_manager_id=NEW.manager_id
    AND c.command_type='materialize_projection' AND a.operation='materialize_projection'
    AND c.idempotency_key=(NEW.request_json->>'previewDigest')||':dated-projection'
    AND c.expected_revision=v_expected_revision AND a.authority_revision=v_accepted_revision
    AND a.content_digest=c.content_digest
    AND c.request_digest=public.static_weekly_digest_jsonb(c.request_canonical_json)
    AND c.request_canonical_json->'publication_id'=to_jsonb(NEW.publication_id::text)
    AND c.request_canonical_json->'service_date'=to_jsonb(v_week::text)
    AND c.request_canonical_json->'expected_revision'=NEW.request_json->'expectedRevision'
    AND c.request_canonical_json->'actor_manager_id'=to_jsonb(NEW.manager_id::text)
    AND c.request_canonical_json->'projection_envelope'=v_projection.projection_envelope
    AND c.response_json#>'{data,projection_id}'=to_jsonb(NEW.projection_id::text)
    AND c.response_json#>'{data,publication_id}'=to_jsonb(NEW.publication_id::text)
    AND c.response_json->'revision'=NEW.receipt_json->'authority_revision')
  THEN RAISE EXCEPTION USING errcode='23514',message='Dated original native projection command and revision proof differs';END IF;
  -- Reuse only the actual independent DATED validators on actual stored rows;
  -- never call a writer or pass a recurring/ordinary proof for mapped work.
  v_checked:=public.static_weekly_assert_approved_dated_projection(v_projection.projection_envelope,
   NEW.publication_id,v_week,public.static_weekly_accepted_exception_set(NEW.publication_id,v_week));
  IF v_checked->>'source_id' IS DISTINCT FROM NEW.receipt_json->>'source_id'
  THEN RAISE EXCEPTION USING errcode='23514',message='Dated independently checked original Source differs';END IF;
  PERFORM public.static_weekly_assert_approved_dated_lunch(NEW.projection_id,v_lunch.document_json);
  IF public.static_weekly_v3_manager_actor(NEW.manager_id) IS DISTINCT FROM v_actor
   OR public.static_weekly_v15_read_recurring_generation() IS DISTINCT FROM v_generation
   OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM v_accepted_revision
   OR public.static_weekly_effective_version(v_week) IS DISTINCT FROM v_publication.version_id
   OR public.static_weekly_effective_version(v_week+6) IS DISTINCT FROM v_publication.version_id
  THEN RAISE EXCEPTION USING errcode='40001',message='Dated original currentness changed during ledger proof';END IF;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER approved_confirmation_binding BEFORE INSERT ON public.static_weekly_approved_template_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_guard_approved_template_confirmation();
CREATE TRIGGER approved_confirmation_immutable BEFORE UPDATE OR DELETE ON public.static_weekly_approved_template_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
CREATE TRIGGER approved_confirmation_no_truncate BEFORE TRUNCATE ON public.static_weekly_approved_template_confirmations
 FOR EACH STATEMENT EXECUTE FUNCTION public.static_weekly_reject_update_delete();
ALTER TABLE public.static_weekly_approved_template_confirmations ENABLE ALWAYS TRIGGER approved_confirmation_binding;
ALTER TABLE public.static_weekly_approved_template_confirmations ENABLE ALWAYS TRIGGER approved_confirmation_immutable;
ALTER TABLE public.static_weekly_approved_template_confirmations ENABLE ALWAYS TRIGGER approved_confirmation_no_truncate;

-- Narrow definer lookup is necessary because the ledger has NO direct table
-- grants. Same authority-lock ordering as the existing control-plane caller.
-- NULL is an observation only; it never means that resending is safe.
CREATE FUNCTION public.static_weekly_read_approved_template_confirmation(p_manager_id uuid,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 PERFORM public.static_weekly_v3_manager_actor(p_manager_id);
 IF p_key IS NULL OR length(p_key)<>36
  OR p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact original approved confirmation UUID key required';END IF;
 IF p_key IS DISTINCT FROM (p_key::uuid)::text THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact original approved confirmation UUID key required';END IF;
 SELECT jsonb_build_object('request',request_json,'receipt',receipt_json) INTO result
  FROM public.static_weekly_approved_template_confirmations WHERE manager_id=p_manager_id AND idempotency_key=p_key;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.static_weekly_guard_approved_template_confirmation(),
 public.static_weekly_read_approved_template_confirmation(uuid,text)
 FROM public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_approved_template_confirmation(uuid,text) TO static_weekly_control_plane;

-- The managed platform can pregrant its postgres maintenance principal on
-- new public objects even with all client defaults absent. These originals
-- remain owner-only/RPC-only: remove that nonowner object grant, never the
-- creator's own access and never a global default privilege or other role.
DO $managed_private_defaults$ DECLARE function_id regprocedure;BEGIN
 IF (SELECT relowner FROM pg_class WHERE oid='public.static_weekly_approved_template_confirmations'::regclass)
   <> 'postgres'::regrole THEN
  REVOKE ALL ON TABLE public.static_weekly_approved_template_confirmations FROM postgres;
 END IF;
 FOR function_id IN SELECT oid::regprocedure FROM pg_proc WHERE oid IN(
  'public.static_weekly_guard_approved_template_confirmation()'::regprocedure,
  'public.static_weekly_read_approved_template_confirmation(uuid,text)'::regprocedure)
   AND proowner<>'postgres'::regrole LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM postgres',function_id);
 END LOOP;
END $managed_private_defaults$;

-- Separate recurring validation: no initial-baseline registration, optimizer
-- certificate, caller receipt flag or digest is used as feasibility authority.
-- Template work is reconstructed through a bijective current-person role map;
-- current physical coverage, eligibility and complete fixed routes are checked
-- independently. The original registered source and initial path are untouched.
CREATE FUNCTION public.static_weekly_assert_approved_recurring_document(
 p_document jsonb,p_date date,p_publishable boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE authority jsonb:=p_document->'authority';source jsonb;live_source jsonb;approved_source jsonb;config jsonb;entry record;current_source record;
 expected_availability jsonb:='[]';expected_slots jsonb:='[]';expected_rows jsonb:='[]';expected_projection jsonb:='[]';
 slot jsonb;availability jsonb;incumbent jsonb;owner_config jsonb;work jsonb;normalized_work jsonb;person jsonb;owner_key text;
 roster jsonb:='[]';projection_availability jsonb;item jsonb;identity_key text;d date;day integer;baseline_person jsonb;
 productive numeric;effort numeric;duty numeric;v_source_id uuid;employee_count integer;working_count integer:=0;
 mapped_rows jsonb;mapping jsonb;role_availability jsonb;actual_availability jsonb;role_profile jsonb;actual_profile jsonb;
 route jsonb;stops jsonb;stop jsonb;nodes jsonb;node jsonb;previous_node jsonb;blocked jsonb;protected_windows jsonb;
 route_start text;route_provenance text;node_start integer;node_end integer;previous_end integer;shift_start integer;shift_end integer;
 block_start integer;block_end integer;cursor_minute integer;protected_minutes integer;travel integer;available_gap integer;
 committed_duty numeric;stop_effort numeric;stop_duration integer;route_count integer:=0;route_pass integer;baseline_travel integer;staged_stop_nodes jsonb;
 prior_version uuid;
 derived_receipt jsonb;original_open boolean;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_date IS NULL OR NOT isfinite(p_date) OR extract(isodow FROM p_date)<>1 OR p_publishable IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='Finite recurring Monday and explicit validation purpose required';END IF;
 SELECT s.source_id,s.canonical_source,s.source_digest,v.draft_document,p.prior_version_id,v.version_id INTO STRICT current_source
  FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
  JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id
  WHERE v.version_id=public.static_weekly_effective_version(p_date) AND s.active AND s.retired_at IS NULL;
 -- During projection the just-published server-owned version is effective.
 -- Resolve only its actual immutable predecessor, not a caller Source ID.
 IF current_source.draft_document=p_document AND current_source.version_id<>(authority#>>'{compilerInput,version,id}')::uuid THEN
  prior_version:=current_source.prior_version_id;
  SELECT s.source_id,s.canonical_source,s.source_digest,v.draft_document,p.prior_version_id,v.version_id INTO STRICT current_source
   FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
   JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id
   WHERE v.version_id=prior_version AND s.active AND s.retired_at IS NULL;
 END IF;
 v_source_id:=current_source.source_id;
 IF current_source.source_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(current_source.canonical_source) THEN
  RAISE EXCEPTION 'Recurring registered source digest differs';END IF;
 live_source:=public.static_weekly_v4_hydrate_compiler_source(current_source.draft_document#>'{authority,compilerInput}',p_date);
 source:=authority->'compilerInput';
 SELECT c.owner_config INTO STRICT config FROM public.static_weekly_approved_template_source_configs c
  WHERE c.source_id=v_source_id AND c.config_digest=public.static_weekly_digest_jsonb(c.owner_config);
 IF config->>'schema' IS DISTINCT FROM 'custodial.owner-corrected-recurring-schedule.v2'
  OR jsonb_typeof(config->'slots') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Recurring typed owner configuration required';END IF;
 FOR owner_key,owner_config IN SELECT key,value FROM jsonb_each(config->'slots') LOOP
  IF owner_config ? 'normalAllowedFamilies' OR owner_config ? 'forbiddenFamilies'
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['normalAssignmentFamilies','hardForbiddenFamilies']) f
    WHERE owner_config ? f AND (jsonb_typeof(owner_config->f) IS DISTINCT FROM 'array'
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(owner_config->f) family WHERE jsonb_typeof(family)<>'string' OR family#>>'{}' !~ '^[A-Z0-9_]+$')
     OR (SELECT count(*) FROM jsonb_array_elements(owner_config->f))<>(SELECT count(DISTINCT family) FROM jsonb_array_elements(owner_config->f) family))) THEN
   RAISE EXCEPTION 'Recurring normal geography and hard exclusions require exact separate typed families';END IF;
  IF (owner_config->>'personId'='3da709bb-2223-4e15-8e3a-db02e3f32e97' AND (owner_key<>'KAREN' OR owner_config->>'slotId'<>'f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f'))
   OR (owner_config->>'personId'='cd97111e-cfa0-4228-b4d7-401bc7a5ac13' AND (owner_key<>'TAMMY' OR owner_config->>'slotId'<>'4a5a83ca-d297-5a30-8344-db08d05b978c'))
   OR (owner_config->>'personId'='30ec85e0-a579-45a8-9c27-c164e77a9190' AND (owner_key<>'KATHY' OR owner_config->>'slotId'<>'55e5939c-175c-5026-94fd-c4350d538922'))
   OR (owner_config->>'personId'='77d50e9a-6338-43b1-aed5-9f47d7129466' AND (owner_key<>'ALIJAH' OR owner_config->>'slotId'<>'36829381-70d7-521b-9f14-bad0af16ba87'
    OR owner_config->'hardForbiddenFamilies' IS DISTINCT FROM '["HERPETARIUM"]'::jsonb)) THEN
   RAISE EXCEPTION 'Recurring original personal geography identity or hard exclusion differs';END IF;
 END LOOP;
 SELECT * INTO STRICT entry FROM public.static_weekly_approved_template_catalog
  WHERE template_id=authority#>>'{mapping,templateId}'
   AND NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements r
    WHERE r.template_id=static_weekly_approved_template_catalog.template_id);
 IF entry.owner_config IS DISTINCT FROM config OR entry.catalog_entry_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(
  jsonb_build_object('template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  OR entry.binding_json->>'patternAuthority' IS DISTINCT FROM 'OWNER_APPROVED_OPERATIONAL_PATTERN'
  OR public.static_weekly_v3_source_identity(live_source)#-'{version,assignments}' IS DISTINCT FROM
   public.static_weekly_v3_source_identity(current_source.canonical_source)#-'{version,assignments}'
  OR source->'exceptions' IS DISTINCT FROM '[]'::jsonb
  OR source-'version' IS DISTINCT FROM live_source-'version'
  OR (source->'version')-'assignments' IS DISTINCT FROM (live_source->'version')-'assignments'
  OR authority#>>'{mapping,schema}' IS DISTINCT FROM 'custodial.approved-static-template-mapping.v1'
  OR authority#>>'{mapping,contract}' IS DISTINCT FROM 'FIXED_APPROVED_GEOMETRY_COMPATIBILITY_NOT_GLOBAL_OPTIMALITY'
  OR authority#>'{mapping,staffingCount}' IS DISTINCT FROM to_jsonb(entry.staffing_count)
  OR authority#>>'{mapping,serviceDate}' IS DISTINCT FROM p_date::text
  OR authority#>'{mapping,solverInvoked}' IS DISTINCT FROM 'false'::jsonb
  OR authority#>'{mapping,admitted}' IS DISTINCT FROM 'false'::jsonb
  OR authority#>'{mapping,published}' IS DISTINCT FROM 'false'::jsonb
  OR authority#>'{mapping,scopeDays}' IS DISTINCT FROM '[0,1,2,3,4,5,6]'::jsonb THEN
  RAISE EXCEPTION USING errcode='23514',message='Exact current admitted recurring Source metadata required';END IF;
 approved_source:=entry.template_json->'source';
 IF jsonb_typeof(approved_source->'version') IS DISTINCT FROM 'object'
  OR approved_source->'exceptions' IS DISTINCT FROM '[]'::jsonb
  OR approved_source#>'{version,shiftEndContinuityPolicy}' IS DISTINCT FROM live_source#>'{version,shiftEndContinuityPolicy}'
  OR approved_source->'proximity' IS DISTINCT FROM live_source->'proximity'
  OR jsonb_typeof(authority#>'{mapping,slotMapping}') IS DISTINCT FROM 'array'
  OR jsonb_array_length(authority#>'{mapping,slotMapping}')<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'patternSlotId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'actualSlotId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count
  OR (SELECT count(DISTINCT m->>'actualPersonId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>entry.staffing_count THEN
  RAISE EXCEPTION 'Recurring bijective role mapping or immutable route policy differs';END IF;
 FOR mapping IN SELECT value FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') LOOP
  PERFORM public.static_weekly_assert_exact_object(mapping,ARRAY['patternSlotId','actualSlotId','actualPersonId'],
   ARRAY['patternSlotId','actualSlotId','actualPersonId'],'recurring current role map');
  IF NOT(entry.template_json->'roleSlotIds' ? (mapping->>'patternSlotId'))
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(live_source->'slots') s
    WHERE s->'id'=mapping->'actualSlotId' AND coalesce(s->'contractorCapacity','false'::jsonb)='false'::jsonb)
   OR NOT EXISTS(SELECT 1 FROM jsonb_each(config->'slots') c WHERE c.value->'slotId'=mapping->'actualSlotId'
    AND c.value->'personId'=mapping->'actualPersonId' AND c.value->'vacancy' IS DISTINCT FROM 'true'::jsonb)
   OR EXISTS(SELECT 1 FROM generate_series(0,6) days(n) WHERE
    (SELECT count(*) FROM jsonb_array_elements(live_source->'slots') s CROSS JOIN LATERAL jsonb_array_elements(s->'incumbencies') i
     WHERE s->'id'=mapping->'actualSlotId' AND i->'personId'=mapping->'actualPersonId'
      AND (i->>'effectiveStart')::date<=p_date+days.n AND (i->>'effectiveEnd' IS NULL OR p_date+days.n<(i->>'effectiveEnd')::date))<>1) THEN
   RAISE EXCEPTION 'Recurring role must bind one actual configured current person for the whole week';END IF;
  FOR day IN SELECT DISTINCT (w->>'dayOfWeek')::integer FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
    WHERE w->'ownerSlotId'=mapping->'patternSlotId' LOOP
   SELECT value INTO STRICT role_availability FROM jsonb_array_elements(approved_source#>'{version,slotAvailability}')
    WHERE value->'slotId'=mapping->'patternSlotId' AND value->>'dayOfWeek'=day::text;
   SELECT value INTO STRICT actual_availability FROM jsonb_array_elements(live_source#>'{version,slotAvailability}')
    WHERE value->'slotId'=mapping->'actualSlotId' AND value->>'dayOfWeek'=day::text;
   IF NOT(role_availability ? 'acceptedRoute') AND approved_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'patternSlotId'] IS NOT NULL THEN
    role_availability:=role_availability||jsonb_build_object('acceptedRoute',approved_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'patternSlotId']);
   END IF;
   IF NOT(actual_availability ? 'acceptedRoute') AND live_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'actualSlotId'] IS NOT NULL THEN
    actual_availability:=actual_availability||jsonb_build_object('acceptedRoute',live_source#>ARRAY['version','acceptedRoutesBySlot',mapping->>'actualSlotId']);
   END IF;
   -- Exact mapper role profile, not historical people or a count-only fit.
   SELECT jsonb_build_object('shift',a->'shift','lunch',a->'lunch','blocked',coalesce(a->'blockedWindows','[]'::jsonb),
    'service',coalesce(a->'maxServiceEffortMinutes',a->'maxLoadPoints'),'duty',coalesce(a->'maxDutyMinutes',a->'max_duty_minutes'),
    'route',a->'acceptedRoute','start',coalesce(a->'acceptedRouteStartLocationId',a->'acceptedRouteAnchorLocationId',a->'routeAnchorLocationId'),
    'stops',a->'acceptedRouteStops') INTO role_profile FROM (SELECT role_availability a) t;
   SELECT jsonb_build_object('shift',a->'shift','lunch',a->'lunch','blocked',coalesce(a->'blockedWindows','[]'::jsonb),
    'service',coalesce(a->'maxServiceEffortMinutes',a->'maxLoadPoints'),'duty',coalesce(a->'maxDutyMinutes',a->'max_duty_minutes'),
    'route',a->'acceptedRoute','start',coalesce(a->'acceptedRouteStartLocationId',a->'acceptedRouteAnchorLocationId',a->'routeAnchorLocationId'),
    'stops',a->'acceptedRouteStops') INTO actual_profile FROM (SELECT actual_availability a) t;
   IF actual_availability->>'status' IS DISTINCT FROM 'working' THEN
    RAISE EXCEPTION 'Recurring mapped current role must be working';END IF;
   -- Do not transfer a historical role's lunch/route proof. Current duty,
   -- routes and lunches are independently checked below and by v8, including
   -- when the newly selected person's profile differs from the original role.
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
  WHERE (SELECT count(*) FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m WHERE m->'patternSlotId'=w->'ownerSlotId')<>1)
  OR (SELECT count(*) FROM jsonb_array_elements(approved_source#>'{version,assignments}'))<1
  OR (SELECT count(*) FROM jsonb_array_elements(approved_source#>'{version,assignments}'))<>(SELECT count(DISTINCT (w->>'dayOfWeek',w->>'workId')) FROM jsonb_array_elements(approved_source#>'{version,assignments}') w) THEN
  RAISE EXCEPTION 'Recurring approved work identity or role coverage differs';END IF;
 SELECT jsonb_agg(jsonb_set(w,'{ownerSlotId}',m->'actualSlotId') ORDER BY (w->>'dayOfWeek')::integer,w->>'workId' COLLATE "C") INTO mapped_rows
  FROM jsonb_array_elements(approved_source#>'{version,assignments}') w JOIN jsonb_array_elements(authority#>'{mapping,slotMapping}') m
   ON m->'patternSlotId'=w->'ownerSlotId';
 IF source#>'{version,assignments}' IS DISTINCT FROM mapped_rows THEN RAISE EXCEPTION 'Recurring candidate must be exact approved geometry with only current owner substitution';END IF;
 -- Physical responsibility is independent of group/work/role IDs. Preserve
 -- every member multiplicity, effort and coverage/eligibility fact on each day.
 IF EXISTS(WITH rows AS(
   SELECT 0 side,w FROM jsonb_array_elements(approved_source#>'{version,assignments}') w
   UNION ALL SELECT 1,w FROM jsonb_array_elements(live_source#>'{version,assignments}') w
  UNION ALL SELECT 2,w FROM jsonb_array_elements(current_source.canonical_source#>'{version,assignments}') w
  ), facts AS(SELECT side,w,jsonb_build_object('day',w->'dayOfWeek','family',w->'locationCodeSnapshot',
   'phase',CASE WHEN w#>>'{window,end}'='09:45' THEN '"morning"'::jsonb WHEN w#>>'{window,start}'='09:45' THEN '"equalized"'::jsonb ELSE w->'window' END,
   'mode',w->'serviceMode','scheduling',w->'schedulingMode','required',coalesce(w->'required','true'::jsonb),
   'priority',w->'priority','qualifications',w->'requiredQualifications','restrictions',w->'restrictions',
   'restrictedSlots',coalesce(w->'restrictedSlotIds','[]'::jsonb),'policy',w->'coveragePolicy','order',w->'coveragePolicyOrder') f FROM rows),
  efforts AS(SELECT side,f,sum((w->>'serviceEffortMinutes')::numeric) effort FROM facts GROUP BY side,f),
  members AS(SELECT side,f,jsonb_agg(member ORDER BY member) members FROM facts CROSS JOIN LATERAL
   jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(w->'includedLocations','[]'::jsonb))>0 THEN w->'includedLocations'
    ELSE jsonb_build_array(jsonb_build_object('locationId',w->'locationId','locationNameSnapshot',w->'locationNameSnapshot')) END) member GROUP BY side,f),
  domain AS(SELECT side,f,effort,members FROM efforts JOIN members USING(side,f))
  (SELECT f,effort,members FROM domain WHERE side=0 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=0)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=1 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=2)
  UNION ALL(SELECT f,effort,members FROM domain WHERE side=2 EXCEPT ALL SELECT f,effort,members FROM domain WHERE side=1)) THEN
  RAISE EXCEPTION 'Recurring approved physical responsibility multiset differs from current Source';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_document,
  ARRAY['adapter','authority','receipt','objective','slot_availability','assignments','objective_inputs','semantic_snapshot','validation'],
  ARRAY['adapter','authority','receipt','objective','slot_availability','assignments','objective_inputs','semantic_snapshot','validation'],'approved recurring document');
 PERFORM public.static_weekly_assert_exact_object(authority,
  ARRAY['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','derivedBaselineDigest','shiftEndDerivation','projectionAvailability','mapping','basisDigest','witnessDigest','solverInvoked','optimized'],
  ARRAY['schema','effectiveDate','compilerInput','overlayCompilerInput','inputDigest','baselineInputDigest','derivedBaselineDigest','shiftEndDerivation','projectionAvailability','mapping','basisDigest','witnessDigest','solverInvoked','optimized'],'approved recurring authority');
 IF p_document->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-baseline-adapter.v1","version":"approved-static-fixed-v1"}'::jsonb
  OR p_document->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PATTERN_NOT_OPTIMALITY"}'::jsonb
  OR authority->>'schema' IS DISTINCT FROM 'custodial.approved-static-authority.v1'
  OR authority->>'effectiveDate' IS DISTINCT FROM p_date::text
  OR authority->'solverInvoked' IS DISTINCT FROM 'false'::jsonb OR authority->'optimized' IS DISTINCT FROM 'false'::jsonb
  OR authority->>'baselineInputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR authority->>'inputDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(authority->'overlayCompilerInput')
  OR p_document#>>'{validation,database_document_identity}' IS DISTINCT FROM public.static_weekly_digest_jsonb(
   jsonb_set(p_document,'{validation}',(p_document->'validation')-'database_document_identity'))
  OR p_document#>>'{validation,status}' IS DISTINCT FROM 'FEASIBLE'
  OR p_document#>>'{validation,publication_authority}' IS DISTINCT FROM 'FIXED_APPROVED'
  OR p_document#>>'{validation,compiler_version}' IS DISTINCT FROM 'approved-static-fixed-v1'
  OR p_document#>>'{validation,input_digest}' IS DISTINCT FROM authority->>'inputDigest'
  OR p_document#>>'{validation,baseline_input_digest}' IS DISTINCT FROM authority->>'baselineInputDigest'
  OR p_document#>>'{validation,authority_digest}' IS DISTINCT FROM public.static_weekly_digest_jsonb(authority)
  OR p_document->'semantic_snapshot' IS DISTINCT FROM jsonb_build_object('schema','custodial.approved-static-recurring-snapshot.v1','recurring_source',source)
 THEN RAISE EXCEPTION 'Approved recurring document identity or fixed semantics differs';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_document->'validation',
  ARRAY['status','publication_authority','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest','database_document_identity'],
  ARRAY['status','publication_authority','compiler_version','input_digest','baseline_input_digest','authority_digest','replay_digest','database_document_identity'],'approved recurring document validation');
 PERFORM public.static_weekly_assert_exact_object(p_document->'receipt',
  ARRAY['schema','feasibilityDigest','hardConstraintCount','hardConstraintDigest','independentDerivations','solverInvoked','optimized'],
  ARRAY['schema','feasibilityDigest','hardConstraintCount','hardConstraintDigest','independentDerivations','solverInvoked','optimized'],'approved recurring serialization receipt');
 IF p_document#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-feasibility-receipt.v1'
  OR p_document#>'{receipt,independentDerivations}' IS DISTINCT FROM '2'::jsonb
  OR p_document#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_document#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR p_document->'objective_inputs' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('input_key','approved_static_feasibility',
   'input_value',p_document->'receipt','provenance',jsonb_build_object('adapter_schema','custodial.approved-static-baseline-adapter.v1','independently_verified',true))) THEN
  RAISE EXCEPTION 'Recurring typed serialization receipt differs';END IF;
 IF source#>'{version,shiftEndContinuityPolicy}' IS NOT NULL THEN
  IF authority#>>'{shiftEndDerivation,schema}'='custodial.approved-mapped-shift-end-derivation.v1' THEN
   PERFORM public.static_weekly_assert_approved_recurring_shift_end_derivation(authority,approved_source,live_source,config);
  ELSE
   PERFORM public.static_weekly_v9_assert_shift_end_derivation(authority);
  END IF;
 ELSIF authority->'overlayCompilerInput' IS DISTINCT FROM source OR authority->'shiftEndDerivation' IS DISTINCT FROM 'null'::jsonb
  OR authority->>'derivedBaselineDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source) THEN
  RAISE EXCEPTION 'Recurring derived work requires independently checked shift-end policy';END IF;
 -- Exact ordinary dated roster and availability, not a caller roster snapshot.
 FOR availability IN SELECT value FROM jsonb_array_elements(source#>'{version,slotAvailability}') LOOP
  SELECT value INTO STRICT slot FROM jsonb_array_elements(source->'slots') WHERE value->>'id'=availability->>'slotId';
  IF NOT(availability ? 'acceptedRoute') AND source#>ARRAY['version','acceptedRoutesBySlot',slot->>'id'] IS NOT NULL THEN
   availability:=availability||jsonb_build_object('acceptedRoute',source#>ARRAY['version','acceptedRoutesBySlot',slot->>'id']);
  END IF;
  day:=(availability->>'dayOfWeek')::integer;d:=p_date+mod(day+6,7);
  incumbent:=NULL;
  IF coalesce(slot->'contractorCapacity','false'::jsonb)='false'::jsonb THEN
   SELECT value INTO incumbent FROM jsonb_array_elements(slot->'incumbencies')
    WHERE (value->>'effectiveStart')::date<=d AND (value->>'effectiveEnd' IS NULL OR d<(value->>'effectiveEnd')::date);
   IF (SELECT count(*) FROM jsonb_array_elements(slot->'incumbencies')
     WHERE (value->>'effectiveStart')::date<=d AND (value->>'effectiveEnd' IS NULL OR d<(value->>'effectiveEnd')::date))>1 THEN
    RAISE EXCEPTION 'Recurring dated incumbent is ambiguous';END IF;
  ELSIF availability->>'status'='working' THEN
   RAISE EXCEPTION 'Active contractor capacity is not an ordinary recurring employee profile';END IF;
  projection_availability:=jsonb_build_object('dayOfWeek',day,'serviceDate',d::text)||availability||jsonb_build_object(
   'incumbentSlotId',slot->'id','incumbentSlotLabel',slot->'label',
   'incumbentPersonId',incumbent->'personId','incumbentName',incumbent->'displayName');
  IF slot->>'kind'='CONTRACTOR_CAPACITY' THEN
   IF slot->'capacityId' IS DISTINCT FROM slot->'id' OR slot->'incumbencies' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Recurring inactive capacity original identity differs';END IF;
   projection_availability:=projection_availability||jsonb_build_object('ownerKind','CONTRACTOR_CAPACITY','capacityId',slot->'id');
  END IF;
  expected_availability:=expected_availability||jsonb_build_array(projection_availability);
  roster:=roster||jsonb_build_array(projection_availability);
  IF coalesce(slot->'contractorCapacity','false'::jsonb)='true'::jsonb THEN CONTINUE;END IF;
  IF availability->>'status'='working' THEN
   working_count:=working_count+1;
   SELECT value INTO STRICT owner_config FROM jsonb_each(config->'slots')
    WHERE value->>'slotId'=slot->>'id' AND value->>'personId'=incumbent->>'personId' AND value->'vacancy' IS DISTINCT FROM 'true'::jsonb;
   IF incumbent IS NULL OR NOT EXISTS(SELECT 1 FROM public.employees e
    WHERE e.id=(incumbent->>'personId')::uuid AND e.active AND e.display_name=incumbent->>'displayName') THEN
    RAISE EXCEPTION 'Recurring owner requires the exact active current employee';END IF;
   PERFORM public.static_weekly_v3_assert_window(availability->'shift','recurring shift');
   PERFORM public.static_weekly_v3_assert_window(availability->'lunch','recurring lunch');
   -- Flexible responsibility is not an appointment. Fixed work and accepted
   -- stops instead share one independently reconstructed chronological route.
   route:=coalesce(availability->'acceptedRoute','{}'::jsonb);
   route_start:=coalesce(route->>'startLocationId',route->>'start_location_id',availability->>'acceptedRouteStartLocationId',
    availability->>'acceptedRouteAnchorLocationId',availability->>'routeAnchorLocationId');
   route_provenance:=coalesce(route->>'provenance',availability->>'acceptedRouteProvenance');
   stops:=coalesce(route->'stops',route->'existingStops',availability->'acceptedRouteStops','[]'::jsonb);
   IF jsonb_typeof(route) IS DISTINCT FROM 'object' OR jsonb_typeof(stops) IS DISTINCT FROM 'array'
    OR nullif(route_start,'') IS NULL OR nullif(route_provenance,'') IS NULL
    OR jsonb_typeof(coalesce(availability->'blockedWindows','[]'::jsonb)) IS DISTINCT FROM 'array'
    OR nullif(availability->>'productiveCapacityProvenance','') IS NULL
    OR nullif(availability->>'maxServiceEffortProvenance','') IS NULL
    OR nullif(availability->>'qualificationProvenance','') IS NULL
    OR nullif(availability->>'restrictionProvenance','') IS NULL
    OR jsonb_typeof(availability->'qualifications') IS DISTINCT FROM 'array'
    OR jsonb_typeof(availability->'restrictions') IS DISTINCT FROM 'array'
    OR availability#>>'{lunch,start}'<availability#>>'{shift,start}'
    OR availability#>>'{lunch,end}'>availability#>>'{shift,end}' THEN
    RAISE EXCEPTION 'Recurring current duty route and eligibility provenance invalid';END IF;
   shift_start:=extract(epoch FROM (availability#>>'{shift,start}')::time)::integer/60;
   shift_end:=extract(epoch FROM (availability#>>'{shift,end}')::time)::integer/60;
   protected_windows:=coalesce(availability->'blockedWindows','[]'::jsonb)||jsonb_build_array(availability->'lunch');
   FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) LOOP
    PERFORM public.static_weekly_v3_assert_window(blocked,'recurring protected interval');
   END LOOP;
   -- Union clipped lunch/blocked intervals: overlaps are not double charged.
   cursor_minute:=shift_start;protected_minutes:=0;
   FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) ORDER BY value->>'start',value->>'end' LOOP
    block_start:=greatest(shift_start,extract(epoch FROM (blocked->>'start')::time)::integer/60);
    block_end:=least(shift_end,extract(epoch FROM (blocked->>'end')::time)::integer/60);
    IF block_end>greatest(cursor_minute,block_start) THEN
     protected_minutes:=protected_minutes+block_end-greatest(cursor_minute,block_start);cursor_minute:=block_end;
    END IF;
   END LOOP;
   productive:=shift_end-shift_start-protected_minutes;
   duty:=coalesce((availability->>'maxDutyMinutes')::numeric,(availability->>'max_duty_minutes')::numeric,productive);
   IF productive<=0 OR duty<=0 OR duty>productive OR duty<>trunc(duty)
    OR ((availability ? 'maxDutyMinutes' OR availability ? 'max_duty_minutes')
     AND nullif(coalesce(availability->>'maxDutyProvenance',availability->>'max_duty_provenance'),'') IS NULL)
    OR jsonb_typeof(availability->'maxServiceEffortMinutes') IS DISTINCT FROM 'number'
    OR (availability->>'maxServiceEffortMinutes')::numeric<=0
    OR (availability->>'maxServiceEffortMinutes')::numeric<>trunc((availability->>'maxServiceEffortMinutes')::numeric) THEN
    RAISE EXCEPTION 'Recurring independent duty or workload capacity invalid';END IF;
   nodes:='[]'::jsonb;stop_effort:=0;committed_duty:=0;
   FOR stop IN SELECT value FROM jsonb_array_elements(stops) LOOP
    PERFORM public.static_weekly_v3_assert_window(stop->'window','recurring accepted stop');
    node_start:=extract(epoch FROM (stop#>>'{window,start}')::time)::integer/60;
    node_end:=extract(epoch FROM (stop#>>'{window,end}')::time)::integer/60;
    stop_duration:=node_end-node_start;
    IF nullif(coalesce(stop->>'locationId',stop->>'location'),'') IS NULL
     OR nullif(coalesce(stop->>'provenance',route_provenance),'') IS NULL
     OR nullif(coalesce(stop->>'serviceEffortProvenance',stop->>'service_effort_provenance',stop->>'provenance',route_provenance),'') IS NULL
     OR node_start<shift_start OR node_end>shift_end
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)<=0
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)>stop_duration
     OR coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)<>
      trunc(coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration)) THEN
     RAISE EXCEPTION 'Recurring accepted stop window effort or provenance invalid';END IF;
    stop_effort:=stop_effort+coalesce((stop->>'serviceEffortMinutes')::numeric,(stop->>'service_effort_minutes')::numeric,stop_duration);
    nodes:=nodes||jsonb_build_array(jsonb_build_object('start',node_start,'end',node_end,'location',coalesce(stop->>'locationId',stop->>'location')));
   END LOOP;
   staged_stop_nodes:=nodes;
   FOR route_pass IN 1..2 LOOP
   nodes:=staged_stop_nodes;baseline_travel:=0;committed_duty:=0;
   IF route_pass=2 THEN
    FOR work IN SELECT value FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}')
     WHERE value->'ownerSlotId'=slot->'id' AND value->>'dayOfWeek'=day::text AND NOT(value ? 'schedulingMode') LOOP
     PERFORM public.static_weekly_v3_assert_window(work->'window','recurring fixed appointment');
     nodes:=nodes||jsonb_build_array(jsonb_build_object('start',extract(epoch FROM (work#>>'{window,start}')::time)::integer/60,
      'end',extract(epoch FROM (work#>>'{window,end}')::time)::integer/60,'location',work->>'locationId'));
    END LOOP;
   END IF;
   previous_end:=shift_start;previous_node:=jsonb_build_object('location',route_start);
   FOR node IN SELECT value FROM jsonb_array_elements(nodes) ORDER BY (value->>'start')::integer,(value->>'end')::integer,value->>'location' COLLATE "C" LOOP
    node_start:=(node->>'start')::integer;node_end:=(node->>'end')::integer;
    IF node_start<previous_end OR node_start<shift_start OR node_end>shift_end
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(protected_windows) b
      WHERE extract(epoch FROM (b->>'start')::time)/60<node_end AND extract(epoch FROM (b->>'end')::time)/60>node_start) THEN
     RAISE EXCEPTION 'Recurring fixed route overlaps another node lunch blocked interval or shift';END IF;
    travel:=NULL;
    IF previous_node->'location'=node->'location' THEN travel:=0;
    ELSE SELECT min((e->>'minutes')::integer) INTO travel FROM jsonb_array_elements(source->'proximity') e
     WHERE ((e->>'fromLocationId'=previous_node->>'location' AND e->>'toLocationId'=node->>'location')
      OR ((e->'bidirectional'='true'::jsonb OR e->'symmetric'='true'::jsonb)
       AND e->>'toLocationId'=previous_node->>'location' AND e->>'fromLocationId'=node->>'location'))
      AND e->'verified'='true'::jsonb AND jsonb_typeof(e->'minutes')='number'
      AND (e->>'minutes')::numeric>0 AND (e->>'minutes')::numeric=trunc((e->>'minutes')::numeric)
      AND nullif(e->>'provenance','') IS NOT NULL;
    END IF;
    cursor_minute:=previous_end;protected_minutes:=0;available_gap:=0;
    FOR blocked IN SELECT value FROM jsonb_array_elements(protected_windows) ORDER BY value->>'start',value->>'end' LOOP
     block_start:=greatest(previous_end,extract(epoch FROM (blocked->>'start')::time)::integer/60);
     block_end:=least(node_start,extract(epoch FROM (blocked->>'end')::time)::integer/60);
     IF block_end>block_start THEN
      available_gap:=greatest(available_gap,block_start-cursor_minute);
      protected_minutes:=protected_minutes+greatest(0,block_end-greatest(cursor_minute,block_start));
      cursor_minute:=greatest(cursor_minute,block_end);
     END IF;
    END LOOP;
    available_gap:=greatest(available_gap,node_start-cursor_minute);
    IF travel IS NULL OR (route_pass=1 AND node_start-previous_end<travel) OR (route_pass=2 AND available_gap<travel) THEN
     RAISE EXCEPTION 'Recurring fixed route has no contiguous protected-safe directed transit';END IF;
    baseline_travel:=baseline_travel+travel;
    committed_duty:=committed_duty+node_end-node_start+travel+greatest(0,node_start-previous_end-travel-protected_minutes);
    previous_end:=node_end;previous_node:=node;
   END LOOP;
   IF route_pass=1 AND stop_effort+baseline_travel>productive THEN RAISE EXCEPTION 'Recurring immutable accepted route baseline exceeds productive capacity';END IF;
   IF route_pass=2 AND committed_duty>duty THEN RAISE EXCEPTION 'Recurring fixed service travel and committed waiting exceed duty capacity';END IF;
   END LOOP;
   route_count:=route_count+jsonb_array_length(stops);
   SELECT coalesce(sum((w->>'serviceEffortMinutes')::numeric),0) INTO effort
    FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}') w
    WHERE w->>'ownerSlotId'=slot->>'id' AND w->>'dayOfWeek'=day::text;
   IF effort+stop_effort>(availability->>'maxServiceEffortMinutes')::numeric THEN RAISE EXCEPTION 'Recurring hard workload capacity including original stops exceeded';END IF;
  END IF;
  expected_slots:=expected_slots||jsonb_build_array(jsonb_build_object(
   'slot_id',slot->'id','day_of_week',day,'availability_state',availability->'status',
   'shift_start',availability#>'{shift,start}','shift_end',availability#>'{shift,end}',
   'lunch_start',availability#>'{lunch,start}','lunch_end',availability#>'{lunch,end}',
   'capacity_units',availability->'productiveCapacityMinutes','max_load_points',availability->'maxServiceEffortMinutes',
   'qualification_snapshot',coalesce(availability->'qualifications','[]'::jsonb),
   'qualification_provenance',jsonb_build_object('source',availability->'qualificationProvenance'),
   'restriction_snapshot',coalesce(availability->'restrictions','[]'::jsonb),
   'restriction_provenance',jsonb_build_object('source',availability->'restrictionProvenance'),
   'slot_label_snapshot',slot->'label','incumbent_person_id_snapshot',incumbent->'personId','incumbent_name_snapshot',incumbent->'displayName'));
 END LOOP;
 -- Array order is serialization, not a different roster; preserve multiplicity.
 IF EXISTS((SELECT value FROM jsonb_array_elements(expected_availability) EXCEPT ALL SELECT value FROM jsonb_array_elements(authority->'projectionAvailability'))
  UNION ALL (SELECT value FROM jsonb_array_elements(authority->'projectionAvailability') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_availability)))
  OR EXISTS((SELECT value FROM jsonb_array_elements(expected_slots) EXCEPT ALL SELECT value FROM jsonb_array_elements(p_document->'slot_availability'))
  UNION ALL (SELECT value FROM jsonb_array_elements(p_document->'slot_availability') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_slots))) THEN
  RAISE EXCEPTION 'Recurring exact dated availability differs';END IF;
 SELECT count(DISTINCT value->>'incumbentPersonId') INTO employee_count FROM jsonb_array_elements(roster)
  WHERE value->>'incumbentPersonId' IS NOT NULL;
 IF employee_count<>entry.staffing_count OR employee_count NOT BETWEEN 6 AND 9
  OR jsonb_array_length(entry.template_json->'roleSlotIds')<>employee_count
  OR jsonb_array_length(authority#>'{mapping,slotMapping}')<>employee_count
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m
   WHERE NOT(entry.template_json->'roleSlotIds' ? (m->>'patternSlotId'))
    OR EXISTS(SELECT 1 FROM generate_series(0,6) AS days(n) WHERE
     (SELECT count(*) FROM jsonb_array_elements(source->'slots') s CROSS JOIN LATERAL jsonb_array_elements(s->'incumbencies') i
      WHERE s->>'id'=m->>'actualSlotId' AND i->>'personId'=m->>'actualPersonId'
       AND (i->>'effectiveStart')::date<=p_date+days.n
       AND (i->>'effectiveEnd' IS NULL OR p_date+days.n<(i->>'effectiveEnd')::date))<>1))
  OR (SELECT count(DISTINCT m->>'actualSlotId') FROM jsonb_array_elements(authority#>'{mapping,slotMapping}') m)<>employee_count THEN
  RAISE EXCEPTION 'Recurring exact scope people and bijective current role binding differ';END IF;
 -- Prove every immutable parent row and every derived segment independently.
 FOR work IN SELECT value FROM jsonb_array_elements(source#>'{version,assignments}') LOOP
  day:=(work->>'dayOfWeek')::integer;
  SELECT value INTO STRICT slot FROM jsonb_array_elements(source->'slots') WHERE value->'id'=work->'ownerSlotId';
  SELECT value INTO STRICT person FROM jsonb_array_elements(roster) WHERE value->'slotId'=work->'ownerSlotId' AND value->>'dayOfWeek'=day::text;
  IF person->>'incumbentPersonId' IS NULL THEN RAISE EXCEPTION 'Recurring baseline work cannot invent a person';END IF;
  expected_rows:=expected_rows||jsonb_build_array(jsonb_build_object(
   'work_id',work->'workId','day_of_week',day,'status','assigned','location_id',work->'locationId',
   'location_code_snapshot',work->'locationCodeSnapshot','location_name_snapshot',work->'locationNameSnapshot',
   'coverage_start',work#>'{window,start}','coverage_end',work#>'{window,end}','owner_slot_id',slot->'id',
   'owner_slot_label_snapshot',slot->'label','owner_person_id_snapshot',person->'incumbentPersonId','owner_name_snapshot',person->'incumbentName',
   'required_qualifications_snapshot',coalesce(work->'requiredQualifications','[]'::jsonb),'restriction_snapshot',coalesce(work->'restrictions','[]'::jsonb),
   'workload_points',work->'serviceEffortMinutes','workload_provenance',jsonb_build_object('source',work->'serviceEffortProvenance'),
   'manual_lock',coalesce(work->'manualLock','false'::jsonb),'payload_json',jsonb_build_object('plan_work_id',day::text||':'||(work->>'workId'),'status','assigned',
    'authority_facts',jsonb_build_object('stable_roster_slot_id',coalesce(work->'originSlotId',work->'ownerSlotId'),
     'baseline_owner_slot_id',slot->'id','baseline_owner_person_id',person->'incumbentPersonId','baseline_owner_name',person->'incumbentName',
     'original_actor_person_id',person->'incumbentPersonId','original_actor_name',person->'incumbentName',
     'optimized_owner_slot_id',slot->'id','optimized_owner_person_id',person->'incumbentPersonId',
     'service_mode',work->'serviceMode','included_locations',work->'includedLocations'))));
 END LOOP;
 IF EXISTS((SELECT value FROM jsonb_array_elements(expected_rows) EXCEPT ALL SELECT value FROM jsonb_array_elements(p_document->'assignments'))
  UNION ALL (SELECT value FROM jsonb_array_elements(p_document->'assignments') EXCEPT ALL SELECT value FROM jsonb_array_elements(expected_rows))) THEN
  RAISE EXCEPTION 'Recurring baseline typed rows differ from exact original source';END IF;
 derived_receipt:=CASE WHEN authority#>>'{shiftEndDerivation,schema}'='custodial.approved-mapped-shift-end-derivation.v1'
  THEN authority#>'{shiftEndDerivation,derivation}' ELSE authority->'shiftEndDerivation' END;
 FOR work IN SELECT value FROM jsonb_array_elements(authority#>'{overlayCompilerInput,version,assignments}') LOOP
  day:=(work->>'dayOfWeek')::integer;
  SELECT value INTO STRICT person FROM jsonb_array_elements(roster) WHERE value->'slotId'=work->'ownerSlotId' AND value->>'dayOfWeek'=day::text;
  SELECT value INTO STRICT owner_config FROM jsonb_each(config->'slots') WHERE value->'slotId'=work->'ownerSlotId' AND value->'personId'=person->'incumbentPersonId';
  -- Retained v9 vacancy responsibility is OPEN, never an execution owner.
  -- Its exact unique chain was checked above by ordinary or mapped derivation;
  -- caller status/flags cannot create an OPEN escape for required real work.
  original_open:=person->>'status'='vacant_unfilled' AND person->'incumbentPersonId'='null'::jsonb
   AND coalesce(source#>'{version,vacancyCapableSlotIds}','[]'::jsonb) ? (work->>'ownerSlotId')
   AND (SELECT count(*) FROM jsonb_array_elements(derived_receipt->'parentChains') chain
    CROSS JOIN LATERAL jsonb_array_elements(chain->'segments') segment WHERE chain->'dayOfWeek'=work->'dayOfWeek'
     AND segment->'workId'=work->'workId' AND segment->'ownerSlotId'=work->'ownerSlotId' AND segment->>'kind'='open')=1;
  original_open:=coalesce(original_open,false);
  PERFORM public.static_weekly_v3_assert_window(work->'window','recurring independently derived work');
  IF (work ? 'schedulingMode' AND work->'schedulingMode' IS DISTINCT FROM '"flexible_coverage_ownership"'::jsonb)
   OR (NOT original_open AND (person->>'status' IS DISTINCT FROM 'working' OR person->'incumbentPersonId'='null'::jsonb OR person->>'incumbentPersonId' IS NULL))
   OR jsonb_typeof(work->'serviceEffortMinutes') IS DISTINCT FROM 'number'
   OR jsonb_typeof(work->'requiredQualifications') IS DISTINCT FROM 'array'
   OR jsonb_typeof(work->'restrictions') IS DISTINCT FROM 'array'
   OR nullif(work->>'qualificationProvenance','') IS NULL OR nullif(work->>'restrictionProvenance','') IS NULL
   OR (coalesce(work->'required','true'::jsonb) NOT IN('true'::jsonb,'false'::jsonb))
   OR (coalesce(work->'required','true'::jsonb)='true'::jsonb AND (jsonb_typeof(work->'priority') IS DISTINCT FROM 'number'
    OR (work->>'priority')::numeric<>trunc((work->>'priority')::numeric) OR nullif(work->>'priorityProvenance','') IS NULL))
   OR (work->>'serviceEffortMinutes')::numeric<=0 OR (work->>'serviceEffortMinutes')::numeric<>trunc((work->>'serviceEffortMinutes')::numeric)
   OR nullif(work->>'serviceEffortProvenance','') IS NULL
   OR (NOT(work ? 'schedulingMode') AND (work->>'serviceEffortMinutes')::numeric>
    extract(epoch FROM ((work#>>'{window,end}')::time-(work#>>'{window,start}')::time))/60)
   OR work#>>'{window,start}'<person#>>'{shift,start}' OR work#>>'{window,end}'>person#>>'{shift,end}'
   OR NOT(person->'qualifications' @> coalesce(work->'requiredQualifications','[]'::jsonb))
   OR coalesce(work->'restrictedSlotIds','[]'::jsonb) ? (work->>'ownerSlotId')
   OR coalesce(owner_config->'hardForbiddenFamilies','[]'::jsonb) ? (work->>'locationCodeSnapshot')
   OR (person->'restrictions') ? (work->>'locationId')
   OR (work->'manualLock'='true'::jsonb AND work->'ownerSlotId' IS DISTINCT FROM work->'originSlotId')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(work->'includedLocations','[]'::jsonb)) l WHERE (person->'restrictions') ? (l->>'locationId')) THEN
   RAISE EXCEPTION 'Recurring independent fixed owner eligibility or work window differs';END IF;
  route_start:=coalesce(person#>>'{acceptedRoute,startLocationId}',person#>>'{acceptedRoute,start_location_id}',person->>'acceptedRouteStartLocationId',
   person->>'acceptedRouteAnchorLocationId',person->>'routeAnchorLocationId');
  IF work->>'schedulingMode'='flexible_coverage_ownership' AND work->>'serviceMode'<>'reminder_only' AND route_start IS DISTINCT FROM work->>'locationId'
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source->'proximity') edge
    WHERE ((edge->>'fromLocationId'=route_start AND edge->>'toLocationId'=work->>'locationId')
     OR ((edge->'bidirectional'='true'::jsonb OR edge->'symmetric'='true'::jsonb) AND edge->>'toLocationId'=route_start AND edge->>'fromLocationId'=work->>'locationId'))
     AND edge->'verified'='true'::jsonb AND jsonb_typeof(edge->'minutes')='number'
     AND (edge->>'minutes')::numeric>=0 AND (edge->>'minutes')::numeric=trunc((edge->>'minutes')::numeric)
     AND nullif(edge->>'provenance','') IS NOT NULL) THEN
   RAISE EXCEPTION 'Recurring fixed flexible area lacks exact verified directed geography';END IF;
  IF (person->>'incumbentPersonId',person->>'slotId') IN(
    ('3da709bb-2223-4e15-8e3a-db02e3f32e97','f22348e9-d4b9-5a7e-b8fd-d0d2c1ec534f'),
    ('cd97111e-cfa0-4228-b4d7-401bc7a5ac13','4a5a83ca-d297-5a30-8344-db08d05b978c'),
    ('30ec85e0-a579-45a8-9c27-c164e77a9190','55e5939c-175c-5026-94fd-c4350d538922'))
   AND NOT(coalesce(owner_config->'normalAssignmentFamilies','[]'::jsonb) ? (work->>'locationCodeSnapshot')) THEN
   RAISE EXCEPTION 'Recurring original personal geography differs';END IF;
  SELECT value INTO baseline_person FROM jsonb_array_elements(roster) WHERE value->'slotId'=work->'originSlotId' AND value->>'dayOfWeek'=day::text;
  d:=p_date+mod(day+6,7);identity_key:=day::text||':'||(work->>'workId');
  normalized_work:=jsonb_build_object('workId',work->'workId','dayOfWeek',day,'originSlotId',work->'originSlotId',
   'locationId',work->'locationId','locationCodeSnapshot',work->'locationCodeSnapshot','locationNameSnapshot',work->'locationNameSnapshot',
   'serviceMode',work->'serviceMode','includedLocations',work->'includedLocations','window',work->'window',
   'serviceEffortMinutes',work->'serviceEffortMinutes','serviceEffortProvenance',work->'serviceEffortProvenance',
   'priority',CASE WHEN original_open OR work->'required'='false'::jsonb THEN '0'::jsonb ELSE work->'priority' END,
   'priorityProvenance',work->'priorityProvenance','required',CASE WHEN original_open THEN 'false'::jsonb ELSE coalesce(work->'required','true'::jsonb) END,
   'coveragePolicy',work->'coveragePolicy','bestEffortCoverage',coalesce(work->'required'='false'::jsonb,false) AND
    (coalesce(work->'coveragePolicy'='"best_effort"'::jsonb,false) OR coalesce(work->'bestEffortCoverage'='true'::jsonb,false)),
   'coveragePolicyOrder',CASE WHEN work->'required'='false'::jsonb AND
    (work->>'coveragePolicy'='best_effort' OR work->'bestEffortCoverage'='true'::jsonb) THEN coalesce(work->'coveragePolicyOrder','1'::jsonb) ELSE 'null'::jsonb END,
   'coveragePolicyProvenance',work->'coveragePolicyProvenance',
   'requiredQualifications',coalesce(work->'requiredQualifications','[]'::jsonb),'qualificationProvenance',work->'qualificationProvenance',
   'restrictions',coalesce(work->'restrictions','[]'::jsonb),'restrictionProvenance',work->'restrictionProvenance',
   'restrictedSlotIds',coalesce(work->'restrictedSlotIds','[]'::jsonb),'manualLock',coalesce(work->'manualLock','false'::jsonb),
   'manualLockSlotId',CASE WHEN work->'manualLock'='true'::jsonb THEN work->'originSlotId' ELSE 'null'::jsonb END,'overlayWork',false);
  expected_projection:=expected_projection||jsonb_build_array(jsonb_build_object('plan_work_id',identity_key,'work_id',work->'workId',
   'day_of_week',day,'service_date',d::text,'status',CASE WHEN original_open THEN 'open' ELSE 'assigned' END,
   'reason_code',CASE WHEN original_open THEN 'permitted_open' ELSE NULL END,
   'owner_slot_id',CASE WHEN original_open THEN 'null'::jsonb ELSE work->'ownerSlotId' END,'owner_person_id',person->'incumbentPersonId',
   'owner_digest',public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',identity_key,'slotId',CASE WHEN original_open THEN 'null'::jsonb ELSE work->'ownerSlotId' END,'personId',person->'incumbentPersonId','serviceDate',d::text)),
   'exact_owner_identity',public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',identity_key,'service_date',d::text,
    'optimized_owner_slot_id',CASE WHEN original_open THEN 'null'::jsonb ELSE work->'ownerSlotId' END,'optimized_owner_person_id',person->'incumbentPersonId',
    'baseline_owner_slot_id',work->'originSlotId','baseline_owner_person_id',baseline_person->'incumbentPersonId')),
   'baseline_owner_slot_id',work->'originSlotId','baseline_owner_person_id',baseline_person->'incumbentPersonId','baseline_owner_name',baseline_person->'incumbentName',
   'original_actor_person_id',baseline_person->'incumbentPersonId','original_actor_name',baseline_person->'incumbentName',
   'optimized_owner_slot_id',CASE WHEN original_open THEN 'null'::jsonb ELSE work->'ownerSlotId' END,'optimized_owner_person_id',person->'incumbentPersonId','work_snapshot',normalized_work,
   'explanation',jsonb_build_object('contract','fixed_approved_pattern','hardConstraints','satisfied',
    'reasons',CASE WHEN original_open THEN '[{"code":"permitted_open"}]'::jsonb ELSE '[]'::jsonb END)));
 END LOOP;
 IF jsonb_array_length(expected_rows)=0 OR jsonb_array_length(expected_projection)=0 THEN RAISE EXCEPTION 'Recurring work cannot be empty';END IF;
 -- Complete semantics above establish feasibility, never this model-size DATA.
 -- Fixed candidate-universe nodes vary independently of the selected path.
 IF jsonb_typeof(p_document#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_document#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_document#>>'{receipt,hardConstraintCount}')::numeric)
  OR (p_document#>>'{receipt,hardConstraintCount}')::numeric<jsonb_array_length(expected_projection)+5*working_count+2*route_count
  OR (p_document#>>'{receipt,hardConstraintCount}')::numeric>100000 THEN RAISE EXCEPTION 'Recurring model-size serialization invalid';END IF;
 RETURN jsonb_build_object('source_id',v_source_id,'projection_assignments',expected_projection,
  'staffing_count',employee_count,'hard_constraint_count',p_document#>'{receipt,hardConstraintCount}');
END $fn$;

CREATE FUNCTION public.static_weekly_assert_approved_recurring_projection(p_envelope jsonb,p_publication_id uuid,p_date date,p_exceptions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE publication record;checked jsonb;document jsonb;
BEGIN
 SELECT p.*,v.draft_document,v.authority_source_id INTO STRICT publication FROM public.weekly_schedule_publications p
  JOIN public.weekly_schedule_versions v USING(version_id) WHERE p.publication_id=p_publication_id;
 document:=publication.draft_document;
 checked:=public.static_weekly_assert_approved_recurring_document(document,p_date,false);
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'approved recurring projection');
 IF p_exceptions IS DISTINCT FROM '[]'::jsonb OR p_envelope->'applied_exceptions' IS DISTINCT FROM '[]'::jsonb
  OR publication.version_id<>public.static_weekly_effective_version(p_date)
  OR publication.authority_source_id IS DISTINCT FROM (checked->>'source_id')::uuid
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_versions prior WHERE prior.version_id=publication.prior_version_id
   AND prior.authority_source_id=publication.authority_source_id
   AND prior.draft_document#>>'{authority,compilerInput,version,id}'=document#>>'{authority,compilerInput,version,id}'
   AND prior.draft_document#>>'{authority,compilerInput,version,publicationId}'=document#>>'{authority,compilerInput,version,publicationId}')
  OR p_envelope->'authority' IS DISTINCT FROM document->'authority' OR p_envelope->'receipt' IS DISTINCT FROM document->'receipt'
  OR p_envelope->'adapter' IS DISTINCT FROM document->'adapter' OR p_envelope->'objective' IS DISTINCT FROM document->'objective'
  OR p_envelope->>'service_date' IS DISTINCT FROM p_date::text OR p_envelope->>'week_start' IS DISTINCT FROM p_date::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (p_date+6)::text
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(document->'authority')
  OR p_envelope->>'replay_digest' IS DISTINCT FROM document#>>'{validation,replay_digest}'
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-fixed-v1'
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',checked->'hard_constraint_count','violations',0)
  OR EXISTS((SELECT value FROM jsonb_array_elements(checked->'projection_assignments') EXCEPT ALL SELECT value FROM jsonb_array_elements(p_envelope->'assignments'))
   UNION ALL(SELECT value FROM jsonb_array_elements(p_envelope->'assignments') EXCEPT ALL SELECT value FROM jsonb_array_elements(checked->'projection_assignments'))) THEN
  RAISE EXCEPTION 'Recurring projection requires exact new relational version and original source lineage';END IF;
END $fn$;

-- Separate private checked copy. The ordinary v9 function and its origin/owner
-- invariant remain untouched; this function instead binds both original and
-- mapped parents to actual immutable catalog/current Source supplied above.
DO $approved_mapped_derivation_copy$
DECLARE original text;changed text;reversed text;needle text;replacement text;prefix text;declarations text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_v9_assert_shift_end_derivation(jsonb)'::regprocedure);
 IF NOT EXISTS(SELECT 1 FROM approved_original_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
  AND to_regprocedure(object_identity)='public.static_weekly_v9_assert_shift_end_derivation(jsonb)'::regprocedure
  AND definition_sql=original AND definition_sha256=public.static_weekly_digest_text(original))
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v9_assert_shift_end_derivation(jsonb)'::regprocedure)<>current_user::regrole
  OR to_regprocedure('public.static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Approved mapped derivation exact private predecessor differs';END IF;
 declarations:=$declarations$
 approved_receipt jsonb:=p_authority->'shiftEndDerivation';approved_ref jsonb;original_parent jsonb;mapped_parent jsonb;owner_mapping jsonb;
 actual_slot jsonb;actual_availability jsonb;current_person jsonb;actual_config jsonb;approved_date date;
$declarations$;
 prefix:=$mapped_lineage$
 perform public.static_weekly_assert_exact_object(approved_receipt,
  array['schema','algorithm','originalTemplateDigest','currentSourceDigest','mappedSourceDigest','ownerConfigDigest','parentReferences','derivation'],
  array['schema','algorithm','originalTemplateDigest','currentSourceDigest','mappedSourceDigest','ownerConfigDigest','parentReferences','derivation'],'approved mapped derivation');
 if approved_receipt->>'schema' is distinct from 'custodial.approved-mapped-shift-end-derivation.v1'
  or approved_receipt->>'algorithm' is distinct from 'dated-real-staff-directed-proximity-weighted-v1'
  or approved_receipt->>'originalTemplateDigest' is distinct from public.static_weekly_digest_jsonb(p_original_source)
  or approved_receipt->>'currentSourceDigest' is distinct from public.static_weekly_digest_jsonb(p_current_source)
  or approved_receipt->>'mappedSourceDigest' is distinct from public.static_weekly_digest_jsonb(source)
  or approved_receipt->>'ownerConfigDigest' is distinct from public.static_weekly_digest_jsonb(p_owner_config)
  or source-'version' is distinct from p_current_source-'version'
  or (source->'version')-'assignments' is distinct from (p_current_source->'version')-'assignments'
  or jsonb_typeof(approved_receipt->'parentReferences') is distinct from 'array'
  or jsonb_array_length(approved_receipt->'parentReferences')<>jsonb_array_length(source#>'{version,assignments}')
  or jsonb_array_length(approved_receipt->'parentReferences')<>jsonb_array_length(p_original_source#>'{version,assignments}')
  or (select count(distinct (r->>'dayOfWeek',r->>'parentWorkId')) from jsonb_array_elements(approved_receipt->'parentReferences') r)
   <>jsonb_array_length(approved_receipt->'parentReferences') then
  raise exception 'Approved mapped original/current Source lineage differs';end if;
 for approved_ref in select value from jsonb_array_elements(approved_receipt->'parentReferences') loop
  perform public.static_weekly_assert_exact_object(approved_ref,
   array['dayOfWeek','parentWorkId','originalParent','mappedParent','originalOwnerSlotId','mappedOwnerSlotId','currentPersonId'],
   array['dayOfWeek','parentWorkId','originalParent','mappedParent','originalOwnerSlotId','mappedOwnerSlotId','currentPersonId'],'approved mapped parent reference');
  select w into strict original_parent from jsonb_array_elements(p_original_source#>'{version,assignments}') w
   where w->'dayOfWeek'=approved_ref->'dayOfWeek' and w->'workId'=approved_ref->'parentWorkId';
  select w into strict mapped_parent from jsonb_array_elements(source#>'{version,assignments}') w
   where w->'dayOfWeek'=approved_ref->'dayOfWeek' and w->'workId'=approved_ref->'parentWorkId';
  select m into strict owner_mapping from jsonb_array_elements(p_authority#>'{mapping,slotMapping}') m where m->'patternSlotId'=original_parent->'ownerSlotId';
  select s into strict actual_slot from jsonb_array_elements(p_current_source->'slots') s where s->'id'=mapped_parent->'ownerSlotId';
  select a into strict actual_availability from jsonb_array_elements(p_current_source#>'{version,slotAvailability}') a
   where a->'slotId'=mapped_parent->'ownerSlotId' and a->'dayOfWeek'=mapped_parent->'dayOfWeek';
  approved_date:=(source->>'serviceDate')::date+mod((mapped_parent->>'dayOfWeek')::integer+6,7);
  select i into strict current_person from jsonb_array_elements(actual_slot->'incumbencies') i where
   (i->>'effectiveStart')::date<=approved_date and (i->>'effectiveEnd' is null or approved_date<(i->>'effectiveEnd')::date);
  select c.value into strict actual_config from jsonb_each(p_owner_config->'slots') c where c.value->'slotId'=actual_slot->'id';
  if approved_ref->'originalParent' is distinct from original_parent or approved_ref->'mappedParent' is distinct from mapped_parent
   or approved_ref->'originalOwnerSlotId' is distinct from original_parent->'ownerSlotId'
   or approved_ref->'mappedOwnerSlotId' is distinct from mapped_parent->'ownerSlotId'
   or mapped_parent is distinct from jsonb_set(original_parent,'{ownerSlotId}',owner_mapping->'actualSlotId')
   or mapped_parent->'originSlotId' is distinct from original_parent->'originSlotId'
   or owner_mapping->'actualSlotId' is distinct from mapped_parent->'ownerSlotId'
   or owner_mapping->'actualPersonId' is distinct from current_person->'personId'
   or approved_ref->'currentPersonId' is distinct from current_person->'personId'
   or coalesce(actual_slot->'contractorCapacity','false'::jsonb)<>'false'::jsonb
   or actual_availability->>'status' is distinct from 'working'
   or mapped_parent#>>'{window,start}'<actual_availability#>>'{shift,start}'
   or mapped_parent#>>'{window,end}'>actual_availability#>>'{shift,end}'
   or (mapped_parent#>>'{window,start}'='09:45' and mapped_parent#>'{window,end}' is distinct from actual_availability#>'{shift,end}')
   or not(coalesce(actual_config->'workDays','[]'::jsonb) @> jsonb_build_array(mapped_parent->'dayOfWeek'))
   or actual_availability->'shift' is distinct from jsonb_build_object(
    'start',coalesce(actual_config#>array['shiftByDay',mapped_parent->>'dayOfWeek'],actual_config->'shift')->0,
    'end',coalesce(actual_config#>array['shiftByDay',mapped_parent->>'dayOfWeek'],actual_config->'shift')->1)
   or actual_availability->'lunch' is distinct from jsonb_build_object(
    'start',coalesce(actual_config#>array['lunchByDay',mapped_parent->>'dayOfWeek'],actual_config->'lunch')->0,
    'end',coalesce(actual_config#>array['lunchByDay',mapped_parent->>'dayOfWeek'],actual_config->'lunch')->1)
   or not exists(select 1 from jsonb_each(p_owner_config->'slots') c where c.value->'slotId'=actual_slot->'id'
    and c.value->'personId'=current_person->'personId' and c.value->'vacancy' is distinct from 'true'::jsonb) then
   raise exception 'Approved mapped parent original/current position person or shift differs';end if;
 end loop;
$mapped_lineage$;
 changed:=original;
 FOR needle,replacement IN SELECT * FROM(VALUES
  ('FUNCTION public.static_weekly_v9_assert_shift_end_derivation(p_authority jsonb)',
   'FUNCTION public.static_weekly_assert_approved_recurring_shift_end_derivation(p_authority jsonb, p_original_source jsonb, p_current_source jsonb, p_owner_config jsonb)'),
  ($old$receipt jsonb:=p_authority->'shiftEndDerivation';$old$,$new$receipt jsonb:=p_authority#>'{shiftEndDerivation,derivation}';$new$),
  (E'declare\n',E'declare\n'||declarations),
  (E'begin\n',E'begin\n'||prefix),
  ($old$or parent->'originSlotId' is distinct from parent->'ownerSlotId'$old$,
   $new$or parent->'originSlotId' is distinct from (select r#>'{originalParent,originSlotId}' from jsonb_array_elements(approved_receipt->'parentReferences') r where r->'dayOfWeek'=parent->'dayOfWeek' and r->'parentWorkId'=parent->'workId')$new$),
  ($old$or work->'ownerSlotId' is distinct from work->'originSlotId'$old$,
   $new$or work->'originSlotId' is distinct from (case when work->'workId'=parent->'workId' then parent->'originSlotId' else work->'ownerSlotId' end)$new$)) seams LOOP
  IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Approved mapped private derivation Source seam differs';END IF;
  changed:=replace(changed,needle,replacement);
 END LOOP;
 reversed:=replace(changed,'FUNCTION public.static_weekly_assert_approved_recurring_shift_end_derivation(p_authority jsonb, p_original_source jsonb, p_current_source jsonb, p_owner_config jsonb)',
  'FUNCTION public.static_weekly_v9_assert_shift_end_derivation(p_authority jsonb)');
 reversed:=replace(reversed,$new$receipt jsonb:=p_authority#>'{shiftEndDerivation,derivation}';$new$,$old$receipt jsonb:=p_authority->'shiftEndDerivation';$old$);
 reversed:=replace(reversed,E'declare\n'||declarations,E'declare\n');reversed:=replace(reversed,E'begin\n'||prefix,E'begin\n');
 reversed:=replace(reversed,$new$or parent->'originSlotId' is distinct from (select r#>'{originalParent,originSlotId}' from jsonb_array_elements(approved_receipt->'parentReferences') r where r->'dayOfWeek'=parent->'dayOfWeek' and r->'parentWorkId'=parent->'workId')$new$,
  $old$or parent->'originSlotId' is distinct from parent->'ownerSlotId'$old$);
 reversed:=replace(reversed,$new$or work->'originSlotId' is distinct from (case when work->'workId'=parent->'workId' then parent->'originSlotId' else work->'ownerSlotId' end)$new$,
  $old$or work->'ownerSlotId' is distinct from work->'originSlotId'$old$);
 IF reversed IS DISTINCT FROM original THEN RAISE EXCEPTION 'Approved mapped derivation copy has unexplained drift';END IF;
 EXECUTE changed;
END $approved_mapped_derivation_copy$;

-- Private copies only. Exact installed Source registration and a unique,
-- reversible finite replacement recipe retain all other writer checks.
DO $recurring_writer_copies$
DECLARE identity text;old_name text;new_name text;original text;changed text;reversed text;needle text;replacement text;
BEGIN
 FOR identity,old_name,new_name IN SELECT * FROM(VALUES
  ('public.static_weekly_v2_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)','static_weekly_v2_create_draft','static_weekly_approved_recurring_create_draft'),
  ('public.static_weekly_v2_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)','static_weekly_v2_publish_draft','static_weekly_approved_recurring_publish_draft'),
  ('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)','static_weekly_v2_materialize_projection','static_weekly_approved_recurring_materialize_projection')) x LOOP
  original:=pg_get_functiondef(identity::regprocedure);
  IF NOT EXISTS(SELECT 1 FROM approved_original_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)=identity::regprocedure AND definition_sql=original AND definition_sha256=public.static_weekly_digest_text(original))
   OR (SELECT proowner FROM pg_proc WHERE oid=identity::regprocedure)<>current_user::regrole
   OR to_regprocedure(replace(identity,old_name,new_name)) IS NOT NULL THEN RAISE EXCEPTION 'Recurring exact writer predecessor differs';END IF;
  changed:=replace(original,'FUNCTION public.'||old_name||'(','FUNCTION public.'||new_name||'(');
  IF changed=original THEN RAISE EXCEPTION 'Recurring writer header differs';END IF;
  FOR needle,replacement IN SELECT * FROM(VALUES
   (CASE WHEN old_name='static_weekly_v2_materialize_projection' THEN 'public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set)'
    WHEN old_name='static_weekly_v2_create_draft' THEN 'public.static_weekly_assert_document_attested(p_document,p_effective_start,true)'
    ELSE 'public.static_weekly_assert_document_attested(v_draft.draft_document,v_draft.effective_start,true)' END,
    CASE WHEN old_name='static_weekly_v2_materialize_projection' THEN 'public.static_weekly_assert_approved_recurring_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)'
    WHEN old_name='static_weekly_v2_create_draft' THEN 'public.static_weekly_assert_approved_recurring_document(p_document,p_effective_start,true)'
    ELSE 'public.static_weekly_assert_approved_recurring_document(v_draft.draft_document,v_draft.effective_start,true)' END)) seam LOOP
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Recurring validator seam differs';END IF;
   changed:=replace(changed,needle,replacement);
  END LOOP;
  IF old_name='static_weekly_v2_create_draft' THEN
   needle:='p_document#>''{authority,optimizerResult,objective}''';replacement:='p_document->''objective''';
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Recurring fixed objective seam differs';END IF;
   changed:=replace(changed,needle,replacement);
   needle:=$old$begin v_version:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;$old$;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Recurring new version allocation seam differs';END IF;
   changed:=replace(changed,needle,'v_version:=gen_random_uuid();');
  ELSIF old_name='static_weekly_v2_publish_draft' THEN
   needle:=$old$begin v_publication:=(v_draft.draft_document#>>'{authority,compilerInput,version,publicationId}')::uuid; exception when others then raise exception using errcode='23514',message='compiler publication identity must be a canonical UUID'; end;$old$;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Recurring new publication allocation seam differs';END IF;
   changed:=replace(changed,needle,'v_publication:=gen_random_uuid();');
  ELSE
   needle:=$old$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$old$;
   IF (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Recurring parent derivation seam differs';END IF;
   changed:=replace(changed,needle,$new$p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'$new$);
  END IF;
  reversed:=replace(changed,'FUNCTION public.'||new_name||'(','FUNCTION public.'||old_name||'(');
  reversed:=replace(reversed,'static_weekly_assert_approved_recurring_document','static_weekly_assert_document_attested');
  reversed:=replace(reversed,'static_weekly_assert_approved_recurring_projection','static_weekly_assert_projection_envelope_attested');
  IF old_name='static_weekly_v2_create_draft' THEN
   reversed:=replace(reversed,'p_document->''objective''','p_document#>''{authority,optimizerResult,objective}''');
   reversed:=replace(reversed,'v_version:=gen_random_uuid();',$old$begin v_version:=(p_document#>>'{authority,compilerInput,version,id}')::uuid; exception when others then raise exception using errcode='23514',message='compiler weekly version identity must be a canonical UUID'; end;$old$);
  ELSIF old_name='static_weekly_v2_publish_draft' THEN
   reversed:=replace(reversed,'v_publication:=gen_random_uuid();',$old$begin v_publication:=(v_draft.draft_document#>>'{authority,compilerInput,version,publicationId}')::uuid; exception when others then raise exception using errcode='23514',message='compiler publication identity must be a canonical UUID'; end;$old$);
  ELSE
   reversed:=replace(reversed,$new$p_assignments#>>'{authority,schema}'='custodial.approved-static-authority.v1'$new$,$old$p_assignments#>>'{authority,schema}'='memphis-zoo.static-weekly-authority.v4'$old$);
  END IF;
  IF reversed IS DISTINCT FROM original THEN RAISE EXCEPTION 'Recurring writer copy has unexplained Source drift';END IF;
  EXECUTE changed;
 END LOOP;
END $recurring_writer_copies$;

CREATE FUNCTION public.static_weekly_materialize_approved_template(
 p_manager_id uuid,p_source_publication_id uuid,p_date date,p_kind text,p_revision bigint,p_generation bigint,p_key text,p_preview_digest text,p_envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;basis jsonb;prior public.static_weekly_approved_template_confirmations%rowtype;checked jsonb;
 feasibility jsonb:=p_envelope->'feasibility';material jsonb;document jsonb;projection jsonb;provenance jsonb;
 draft jsonb;published jsonb;materialized jsonb;lunch jsonb;receipt jsonb;v_version_id uuid;v_publication_id uuid;v_projection_id uuid;revision bigint;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 -- BEGIN DATED_ORIGINAL_CONFIRMATION_DISPATCH
 IF p_kind='DATED_ABSENCE' THEN
  -- Same owner, restore fence and authority queue as the unchanged recurring
  -- path. The private writer validates the selected dated Source independently;
  -- no recurring draft/publication or caller receipt is used for this branch.
  PERFORM public.static_weekly_assert_exact_object(p_envelope,
   ARRAY['schema','managerId','sourcePublicationId','serviceDate','kind','expectedRevision','generation','templateCatalogDigest','templateInputsDigest','feasibility','previewDigest','request'],
   ARRAY['schema','managerId','sourcePublicationId','serviceDate','kind','expectedRevision','generation','templateCatalogDigest','templateInputsDigest','feasibility','previewDigest','request'],'approved dated materialization');
  PERFORM public.static_weekly_assert_exact_object(p_envelope->'request',
   ARRAY['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'],
   ARRAY['publicationId','serviceDate','kind','templateId','expectedRevision','previewDigest','idempotencyKey'],'approved dated original request');
  IF p_source_publication_id IS NULL OR p_date IS NULL OR NOT isfinite(p_date)
   OR p_revision IS NULL OR p_revision NOT BETWEEN 0 AND 9007199254740991
   OR p_generation IS NULL OR p_generation NOT BETWEEN 0 AND 9007199254740991
   OR p_key IS NULL OR length(p_key)<>36 OR p_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR p_key IS DISTINCT FROM (p_key::uuid)::text
   OR p_preview_digest IS NULL OR length(p_preview_digest)<>64 OR p_preview_digest!~'^[0-9a-f]{64}$'
   OR p_envelope->>'schema' IS DISTINCT FROM 'custodial.approved-static-materialization.v1'
   OR p_envelope->'managerId' IS DISTINCT FROM to_jsonb(p_manager_id::text)
   OR p_envelope->'sourcePublicationId' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
   OR p_envelope->'serviceDate' IS DISTINCT FROM to_jsonb(p_date::text)
   OR p_envelope->'kind' IS DISTINCT FROM to_jsonb(p_kind)
   OR p_envelope->'expectedRevision' IS DISTINCT FROM to_jsonb(p_revision)
   OR p_envelope->'generation' IS DISTINCT FROM to_jsonb(p_generation)
   OR p_envelope->'previewDigest' IS DISTINCT FROM to_jsonb(p_preview_digest)
   OR p_preview_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest')
   OR p_envelope#>'{request,publicationId}' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
   OR p_envelope->'request' IS DISTINCT FROM jsonb_build_object(
    'publicationId',p_source_publication_id,'serviceDate',p_date,'kind',p_kind,
    'templateId',p_envelope#>'{request,templateId}','expectedRevision',p_revision,
    'previewDigest',p_preview_digest,'idempotencyKey',p_key)
  THEN RAISE EXCEPTION USING errcode='22023',message='Dated exact original scalar envelope request and preview required';END IF;
  -- A null original template selector means automatic selection, not permission to
  -- replace it with the chosen template in the immutable original request.
  IF p_envelope#>'{request,templateId}' IS DISTINCT FROM 'null'::jsonb AND
   (jsonb_typeof(p_envelope#>'{request,templateId}') IS DISTINCT FROM 'string'
    OR length(p_envelope#>>'{request,templateId}') NOT BETWEEN 1 AND 128
    OR p_envelope#>>'{request,templateId}' IS DISTINCT FROM btrim(p_envelope#>>'{request,templateId}'))
  THEN RAISE EXCEPTION USING errcode='22023',message='Dated original template selector differs';END IF;
  SELECT * INTO prior FROM public.static_weekly_approved_template_confirmations
   WHERE manager_id=p_manager_id AND idempotency_key=p_key;
  IF FOUND THEN
   IF prior.request_json IS DISTINCT FROM p_envelope->'request'
    OR prior.source_publication_id IS DISTINCT FROM p_source_publication_id
    OR prior.publication_id IS DISTINCT FROM p_source_publication_id
    OR prior.receipt_json->'schema' IS DISTINCT FROM '"custodial.approved-static-confirmation.v1"'::jsonb
    OR prior.receipt_json->'status' IS DISTINCT FROM '"PERSISTED_CURRENT"'::jsonb
    OR prior.receipt_json->'ok' IS DISTINCT FROM 'true'::jsonb
    OR prior.receipt_json->'persistence_status' IS DISTINCT FROM '"PERSISTED"'::jsonb
    OR prior.receipt_json->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
    OR prior.receipt_json->'publication_id' IS DISTINCT FROM to_jsonb(prior.publication_id::text)
    OR prior.receipt_json->'projection_id' IS DISTINCT FROM to_jsonb(prior.projection_id::text)
    OR p_preview_digest IS DISTINCT FROM prior.receipt_json->>'previewDigest'
   THEN RAISE EXCEPTION USING errcode='23505',message='Original dated confirmation identity conflict';END IF;
   -- Historical exact receipt, not a fresh currentness assertion. No basis
   -- reread, materialization, new identifier or write on original replay.
   RETURN prior.receipt_json;
  END IF;
  basis:=public.static_weekly_read_approved_template_basis(p_manager_id,p_source_publication_id,p_date,
   p_kind,p_envelope#>>'{request,templateId}',p_revision);
  IF basis->>'schema' IS DISTINCT FROM 'custodial.approved-static-template-basis.v1'
   OR basis->'publicationId' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
   OR basis->'serviceDate' IS DISTINCT FROM to_jsonb(p_date::text) OR basis->'kind' IS DISTINCT FROM to_jsonb(p_kind)
   OR basis->'authorityRevision' IS DISTINCT FROM to_jsonb(p_revision)
   OR basis->'generation' IS DISTINCT FROM to_jsonb(p_generation)
   OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM p_revision
   OR p_generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
   OR public.static_weekly_v3_manager_actor(p_manager_id) IS DISTINCT FROM actor
   OR p_envelope->'templateCatalogDigest' IS DISTINCT FROM basis->'templateCatalogDigest'
   OR p_envelope->'templateInputsDigest' IS DISTINCT FROM basis->'templateInputsDigest'
   OR jsonb_typeof(feasibility) IS DISTINCT FROM 'object'
   OR feasibility->>'currentSourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(basis->'currentSource')
   OR jsonb_typeof(feasibility#>'{mapping,templateId}') IS DISTINCT FROM 'string'
   OR (p_envelope#>'{request,templateId}' IS DISTINCT FROM 'null'::jsonb
    AND p_envelope#>'{request,templateId}' IS DISTINCT FROM feasibility#>'{mapping,templateId}')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(basis->'templates') t
    WHERE t->'templateId'=feasibility#>'{mapping,templateId}')
  THEN RAISE EXCEPTION USING errcode='40001',message='Dated original current actor Source basis revision generation or selected template differs';END IF;
  receipt:=public.static_weekly_approved_dated_materialize_projection(
   p_manager_id,p_source_publication_id,p_date,feasibility#>>'{mapping,templateId}',
   p_revision,p_generation,p_preview_digest,feasibility);
  -- Keep the actual private receipt byte-for-value as jsonb. No receipt
  -- synthesis, acceptance fallback or conversion to a new publication.
  PERFORM public.static_weekly_assert_exact_object(receipt,
   ARRAY['schema','status','ok','persistence_status','source_id','publication_id','projection_id','authority_revision','revision','feasibility_digest','lunch_document_identity','previewDigest','solverInvoked'],
   ARRAY['schema','status','ok','persistence_status','source_id','publication_id','projection_id','authority_revision','revision','feasibility_digest','lunch_document_identity','previewDigest','solverInvoked'],'approved dated actual receipt');
  IF receipt->'schema' IS DISTINCT FROM '"custodial.approved-static-confirmation.v1"'::jsonb
   OR receipt->'status' IS DISTINCT FROM '"PERSISTED_CURRENT"'::jsonb
   OR receipt->'ok' IS DISTINCT FROM 'true'::jsonb OR receipt->'persistence_status' IS DISTINCT FROM '"PERSISTED"'::jsonb
   OR receipt->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
   OR receipt->'publication_id' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
   OR receipt->'previewDigest' IS DISTINCT FROM to_jsonb(p_preview_digest)
   OR receipt->>'feasibility_digest' IS DISTINCT FROM feasibility->>'digest'
   OR jsonb_typeof(receipt->'authority_revision') IS DISTINCT FROM 'number'
   OR coalesce(receipt->>'authority_revision','')!~'^[1-9][0-9]*$'
   OR (receipt->>'authority_revision')::numeric NOT BETWEEN p_revision+1 AND 9007199254740991
   OR receipt->'revision' IS DISTINCT FROM receipt->'authority_revision'
   OR jsonb_typeof(receipt->'projection_id') IS DISTINCT FROM 'string'
   OR length(receipt->>'projection_id')<>36 OR receipt->>'projection_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(receipt->'source_id') IS DISTINCT FROM 'string'
   OR length(receipt->>'source_id')<>36 OR receipt->>'source_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(receipt->'lunch_document_identity') IS DISTINCT FROM 'string'
   OR length(receipt->>'lunch_document_identity')<>64 OR receipt->>'lunch_document_identity'!~'^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING errcode='23514',message='Dated actual private materialization receipt differs';END IF;
  v_projection_id:=(receipt->>'projection_id')::uuid;revision:=(receipt->>'authority_revision')::bigint;
  IF public.static_weekly_v3_manager_actor(p_manager_id) IS DISTINCT FROM actor
   OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM revision
   OR p_generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_publications p
    JOIN public.weekly_schedule_versions v USING(version_id)
    JOIN public.weekly_schedule_compiled_projections x ON x.publication_id=p.publication_id AND x.version_id=v.version_id
    JOIN public.weekly_schedule_lunch_documents l ON l.projection_id=x.projection_id
    WHERE p.publication_id=p_source_publication_id AND x.projection_id=v_projection_id
     AND v.authority_source_id::text=receipt->>'source_id'
     AND x.week_start=p_date-(extract(isodow FROM p_date)::integer-1) AND x.week_end=x.week_start+6
     AND x.compiled_by_manager_id=p_manager_id AND l.accepted_by_manager_id=p_manager_id
     AND x.projection_envelope=feasibility#>'{datedAbsence,projection}'
     AND l.document_json=feasibility#>'{datedAbsence,lunchDocument}'
     AND l.document_identity=receipt->>'lunch_document_identity')
  THEN RAISE EXCEPTION USING errcode='40001',message='Dated actual original publication projection lunch or currentness differs';END IF;
  -- No exception handler or bypass: the kind-specific native ledger guard
  -- and original manager/key/projection uniqueness remain authoritative.
  INSERT INTO public.static_weekly_approved_template_confirmations(manager_id,idempotency_key,request_json,receipt_json,source_publication_id,publication_id,projection_id)
   VALUES(p_manager_id,p_key,p_envelope->'request',receipt,p_source_publication_id,p_source_publication_id,v_projection_id);
  SELECT * INTO STRICT prior FROM public.static_weekly_approved_template_confirmations
   WHERE manager_id=p_manager_id AND idempotency_key=p_key;
  IF prior.request_json IS DISTINCT FROM p_envelope->'request' OR prior.receipt_json IS DISTINCT FROM receipt
   OR prior.source_publication_id IS DISTINCT FROM p_source_publication_id OR prior.publication_id IS DISTINCT FROM p_source_publication_id
   OR prior.projection_id IS DISTINCT FROM v_projection_id
   OR public.static_weekly_v3_manager_actor(p_manager_id) IS DISTINCT FROM actor
   OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM revision
   OR p_generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
  THEN RAISE EXCEPTION USING errcode='40001',message='Dated immutable original confirmation readback differs';END IF;
  RETURN receipt;
 END IF;
 -- END DATED_ORIGINAL_CONFIRMATION_DISPATCH
 IF p_kind IS DISTINCT FROM 'RECURRING_STAFFING' OR p_key IS NULL OR length(p_key)<>36
  OR p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR p_key IS DISTINCT FROM (p_key::uuid)::text THEN
  RAISE EXCEPTION USING errcode='22023',message='Exact recurring original UUID key required; DATED_ABSENCE unsupported';END IF;
 IF p_date IS NULL OR NOT isfinite(p_date) OR extract(isodow FROM p_date)<>1
  OR p_envelope->'managerId' IS DISTINCT FROM to_jsonb(p_manager_id::text)
  OR p_envelope->'sourcePublicationId' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
  OR p_envelope->'serviceDate' IS DISTINCT FROM to_jsonb(p_date::text)
  OR p_envelope->'kind' IS DISTINCT FROM to_jsonb(p_kind)
  OR p_envelope->'expectedRevision' IS DISTINCT FROM to_jsonb(p_revision)
  OR p_envelope->'generation' IS DISTINCT FROM to_jsonb(p_generation) THEN
  RAISE EXCEPTION 'Recurring exact original scalar arguments differ';END IF;
 SELECT * INTO prior FROM public.static_weekly_approved_template_confirmations WHERE manager_id=p_manager_id AND idempotency_key=p_key;
 IF FOUND THEN
  IF prior.request_json IS DISTINCT FROM p_envelope->'request' OR prior.source_publication_id IS DISTINCT FROM p_source_publication_id
   OR p_preview_digest IS DISTINCT FROM prior.receipt_json->>'previewDigest'
   OR p_envelope->>'previewDigest' IS DISTINCT FROM p_preview_digest
   OR p_preview_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest') THEN
   RAISE EXCEPTION USING errcode='23505',message='Original recurring confirmation identity conflict';END IF;
  RETURN prior.receipt_json;END IF;
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['schema','managerId','sourcePublicationId','serviceDate','kind','expectedRevision','generation','templateCatalogDigest','templateInputsDigest','feasibility','previewDigest','request'],
  ARRAY['schema','managerId','sourcePublicationId','serviceDate','kind','expectedRevision','generation','templateCatalogDigest','templateInputsDigest','feasibility','previewDigest','request'],'approved recurring materialization');
 basis:=public.static_weekly_read_approved_template_basis(p_manager_id,p_source_publication_id,p_date,p_kind,p_envelope#>>'{request,templateId}',p_revision);
 IF p_revision IS NULL OR p_revision<0 OR p_revision>9007199254740991 OR p_generation IS NULL OR p_generation<0 OR p_generation>9007199254740991
  OR p_generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
  OR p_envelope->>'schema' IS DISTINCT FROM 'custodial.approved-static-materialization.v1'
  OR p_envelope->'managerId' IS DISTINCT FROM to_jsonb(p_manager_id::text)
  OR p_envelope->'sourcePublicationId' IS DISTINCT FROM to_jsonb(p_source_publication_id::text)
  OR p_envelope->'serviceDate' IS DISTINCT FROM to_jsonb(p_date::text) OR p_envelope->'kind' IS DISTINCT FROM to_jsonb(p_kind)
  OR p_envelope->'expectedRevision' IS DISTINCT FROM to_jsonb(p_revision) OR p_envelope->'generation' IS DISTINCT FROM to_jsonb(p_generation)
  OR p_envelope->'templateCatalogDigest' IS DISTINCT FROM basis->'templateCatalogDigest'
  OR p_envelope->'templateInputsDigest' IS DISTINCT FROM basis->'templateInputsDigest'
  OR p_preview_digest IS NULL OR length(p_preview_digest)<>64 OR p_preview_digest !~ '^[a-f0-9]{64}$'
  OR p_envelope->'previewDigest' IS DISTINCT FROM to_jsonb(p_preview_digest)
  OR p_preview_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'request'-'previewDigest')
  OR p_envelope->'request' IS DISTINCT FROM jsonb_build_object('publicationId',NULL,'serviceDate',p_date,'kind',p_kind,
   'templateId',p_envelope#>'{request,templateId}','expectedRevision',p_revision,'previewDigest',p_preview_digest,'idempotencyKey',p_key)
  OR basis#>'{currentSource,exceptions}' IS DISTINCT FROM '[]'::jsonb
  OR (feasibility->'candidateSource')-'version' IS DISTINCT FROM (basis->'currentSource')-'version'
  OR (feasibility#>'{candidateSource,version}')-'assignments' IS DISTINCT FROM (basis#>'{currentSource,version}')-'assignments'
  OR feasibility->>'currentSourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(basis->'currentSource')
  OR feasibility->>'digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(feasibility-'digest'-'recurringStaffing')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(basis->'templates') t WHERE t->>'templateId'=feasibility#>>'{mapping,templateId}') THEN
  RAISE EXCEPTION USING errcode='23514',message='Recurring original current actor source basis revision generation request and preview differ';END IF;
 material:=feasibility->'recurringStaffing';document:=material->'document';projection:=material->'projection';
 PERFORM public.static_weekly_assert_exact_object(material,ARRAY['schema','document','projection','objective','lunchDocument'],
  ARRAY['schema','document','projection','objective','lunchDocument'],'approved recurring typed materialization');
 checked:=public.static_weekly_assert_approved_recurring_document(document,p_date,true);
 IF document#>'{authority,compilerInput}' IS DISTINCT FROM feasibility->'candidateSource' THEN
  RAISE EXCEPTION 'Recurring candidate Source differs from independently checked document';END IF;
 PERFORM public.static_weekly_assert_exact_object(feasibility,
  ARRAY['schema','contract','mapping','sourceDigest','currentSourceDigest','candidateSource','assignments','projectionAssignments','lunchDocument','baseAuthorityDigest','baseReplayDigest','compilerInput','overlayCompilerInput','baselineAssignments','slotAvailability','projectionAvailability','shiftEndDerivation','derivedBaselineDigest','baselineInputDigest','inputDigest','basisDigest','hardConstraintDigest','hardConstraintCount','witnessDigest','lunch','solverInvoked','optimized','publicationAuthority','digest','recurringStaffing'],
  ARRAY['schema','contract','mapping','sourceDigest','currentSourceDigest','candidateSource','assignments','projectionAssignments','lunchDocument','baseAuthorityDigest','baseReplayDigest','compilerInput','overlayCompilerInput','baselineAssignments','slotAvailability','projectionAvailability','shiftEndDerivation','derivedBaselineDigest','baselineInputDigest','inputDigest','basisDigest','hardConstraintDigest','hardConstraintCount','witnessDigest','lunch','solverInvoked','optimized','publicationAuthority','digest','recurringStaffing'],'approved recurring feasibility');
 IF material->>'schema' IS DISTINCT FROM 'custodial.approved-static-recurring-staffing.v1'
  OR feasibility->>'schema' IS DISTINCT FROM 'custodial.approved-static-feasibility.v1'
  OR feasibility->>'contract' IS DISTINCT FROM 'FIXED_APPROVED_PATTERN_COMPLETE_HARD_CONSTRAINTS_NOT_OPTIMALITY'
  OR feasibility->'solverInvoked' IS DISTINCT FROM 'false'::jsonb OR feasibility->'optimized' IS DISTINCT FROM 'false'::jsonb
  OR feasibility->>'publicationAuthority' IS DISTINCT FROM 'NOT_PUBLISHED'
  OR document->'assignments' IS DISTINCT FROM feasibility->'baselineAssignments'
  OR document->'slot_availability' IS DISTINCT FROM feasibility->'slotAvailability'
  OR projection->'assignments' IS DISTINCT FROM feasibility->'projectionAssignments'
  OR material->'objective' IS DISTINCT FROM document->'objective'
  OR material->'lunchDocument' IS DISTINCT FROM feasibility->'lunchDocument'
  OR feasibility->'mapping' IS DISTINCT FROM document#>'{authority,mapping}'
  OR feasibility->'compilerInput' IS DISTINCT FROM document#>'{authority,compilerInput}'
  OR feasibility->'overlayCompilerInput' IS DISTINCT FROM document#>'{authority,overlayCompilerInput}'
  OR feasibility->'projectionAvailability' IS DISTINCT FROM document#>'{authority,projectionAvailability}'
  OR feasibility->'shiftEndDerivation' IS DISTINCT FROM document#>'{authority,shiftEndDerivation}'
  OR feasibility->'baseAuthorityDigest' IS DISTINCT FROM document#>'{validation,authority_digest}'
  OR feasibility->'inputDigest' IS DISTINCT FROM document#>'{authority,inputDigest}'
  OR feasibility->'baselineInputDigest' IS DISTINCT FROM document#>'{authority,baselineInputDigest}'
  OR feasibility->'derivedBaselineDigest' IS DISTINCT FROM document#>'{authority,derivedBaselineDigest}'
  OR feasibility->'basisDigest' IS DISTINCT FROM document#>'{authority,basisDigest}'
  OR feasibility->'witnessDigest' IS DISTINCT FROM document#>'{authority,witnessDigest}'
  OR feasibility->>'baseReplayDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
   'projectionAssignments',feasibility->'projectionAssignments','lunch',feasibility->'lunch'))
  OR feasibility->'baseReplayDigest' IS DISTINCT FROM document#>'{validation,replay_digest}'
  OR feasibility->'baseReplayDigest' IS DISTINCT FROM material#>'{lunchDocument,base_replay_digest}'
  OR feasibility->'baseAuthorityDigest' IS DISTINCT FROM material#>'{lunchDocument,base_authority_digest}'
  OR projection->'semantic_snapshot' IS DISTINCT FROM jsonb_build_object('schema','custodial.approved-static-projection-snapshot.v1',
   'sourceDigest',public.static_weekly_digest_jsonb(basis->'currentSource'),'feasibilityDigest',feasibility->>'digest')
  OR document#>>'{receipt,feasibilityDigest}' IS DISTINCT FROM feasibility->>'digest'
  OR (SELECT count(*) FROM jsonb_array_elements(basis->'templates') t WHERE t->'staffingCount'=checked->'staffing_count')<>1
  OR feasibility->'hardConstraintCount' IS DISTINCT FROM checked->'hard_constraint_count'
  OR document#>'{receipt,hardConstraintDigest}' IS DISTINCT FROM feasibility->'hardConstraintDigest'
  OR jsonb_typeof(feasibility->'hardConstraintDigest') IS DISTINCT FROM 'string'
  OR length(feasibility->>'hardConstraintDigest')<>64 OR feasibility->>'hardConstraintDigest' !~ '^[a-f0-9]{64}$'
  OR document#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb
  OR document#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR document#>'{receipt,hardConstraintCount}' IS DISTINCT FROM checked->'hard_constraint_count' THEN
  RAISE EXCEPTION 'Recurring independently derived typed materialization differs';END IF;
 provenance:=jsonb_build_object('adapter_schema',document#>>'{adapter,schema}','compiler_version',document#>>'{validation,compiler_version}',
  'input_digest',document#>>'{validation,input_digest}','baseline_input_digest',document#>>'{validation,baseline_input_digest}',
  'authority_digest',document#>>'{validation,authority_digest}','replay_digest',document#>>'{validation,replay_digest}');
 draft:=public.static_weekly_approved_recurring_create_draft(p_date,projection->>'compiler_version',projection->'objective',provenance,
  document,p_revision,p_manager_id,actor->>'manager_name',p_key||':draft');
 v_version_id:=(draft#>>'{data,version_id}')::uuid;revision:=(draft->>'revision')::bigint;
 PERFORM set_config('app.static_weekly_source_bind','on',true);
 UPDATE public.weekly_schedule_versions v SET authority_source_id=(checked->>'source_id')::uuid WHERE v.version_id=v_version_id AND v.authority_source_id IS NULL;
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_versions v WHERE v.version_id=v_version_id
  AND v.authority_source_id=(checked->>'source_id')::uuid AND v.draft_document=document) THEN RAISE EXCEPTION 'Recurring relational version original source binding differs';END IF;
 PERFORM public.static_weekly_v3_assert_draft_incumbency(v_version_id);
 published:=public.static_weekly_approved_recurring_publish_draft(v_version_id,(draft#>>'{data,draft_revision}')::bigint,revision,
  p_manager_id,actor->>'manager_name',p_key||':publish','supersede',NULL);
 v_publication_id:=(published#>>'{data,publication_id}')::uuid;revision:=(published->>'revision')::bigint;
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_publications original
  ON original.version_id=p.prior_version_id WHERE p.publication_id=v_publication_id AND original.publication_id=p_source_publication_id) THEN
  RAISE EXCEPTION 'Recurring new publication original current lineage differs';END IF;
 materialized:=public.static_weekly_approved_recurring_materialize_projection(v_publication_id,p_date,public.static_weekly_digest_jsonb('[]'::jsonb),
  projection->>'compiler_version',projection->'objective',projection->'metrics',projection->>'replay_digest',projection,revision,
  p_manager_id,actor->>'manager_name',p_key||':projection');
 v_projection_id:=(materialized#>>'{data,projection_id}')::uuid;revision:=(materialized->>'revision')::bigint;
 lunch:=public.static_weekly_v8_materialize_lunch_document(v_projection_id,material->'lunchDocument',p_manager_id);
 IF lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED' THEN RAISE EXCEPTION 'Recurring exact lunch not persisted';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-static-confirmation.v1','status','PERSISTED_CURRENT','ok',true,'persistence_status','PERSISTED',
  'publication_id',v_publication_id,'projection_id',v_projection_id,'authority_revision',revision,'revision',revision,
  'feasibility_digest',feasibility->>'digest','lunch_document_identity',lunch->>'document_identity','previewDigest',p_preview_digest,'solverInvoked',false);
 INSERT INTO public.static_weekly_approved_template_confirmations(manager_id,idempotency_key,request_json,receipt_json,source_publication_id,publication_id,projection_id)
  VALUES(p_manager_id,p_key,p_envelope->'request',receipt,p_source_publication_id,v_publication_id,v_projection_id);
 RETURN receipt;
END $fn$;
REVOKE ALL ON FUNCTION public.static_weekly_assert_approved_recurring_document(jsonb,date,boolean),
 public.static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb),
 public.static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb),
 public.static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text),
 public.static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid),
 public.static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text),
 public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)
 FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
GRANT EXECUTE ON FUNCTION public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb) TO static_weekly_control_plane;

-- The same observed managed default applies to these seven NEW routines only.
-- Preserve the actual creator; do not change defaults or another principal.
DO $recurring_managed_private_defaults$ DECLARE function_id regprocedure;BEGIN
 FOR function_id IN SELECT oid::regprocedure FROM pg_proc WHERE oid IN(
  'public.static_weekly_assert_approved_recurring_document(jsonb,date,boolean)'::regprocedure,
  'public.static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb)'::regprocedure,
  'public.static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
  'public.static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure,
  'public.static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)'::regprocedure)
   AND proowner<>'postgres'::regrole LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM postgres',function_id);
 END LOOP;
END $recurring_managed_private_defaults$;

DO $private_acl$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE c.oid='public.static_weekly_approved_template_confirmations'::regclass AND a.grantee<>c.relowner)
  OR EXISTS(SELECT 1 FROM pg_attribute c JOIN pg_class r ON r.oid=c.attrelid CROSS JOIN LATERAL aclexplode(c.attacl) a
   WHERE c.attrelid='public.static_weekly_approved_template_confirmations'::regclass AND a.grantee<>r.relowner)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader',
    'static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) AS denied(role_name)
   WHERE has_table_privilege(role_name,'public.static_weekly_approved_template_confirmations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(role_name,'public.static_weekly_approved_template_confirmations','SELECT,INSERT,UPDATE,REFERENCES'))
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid IN('public.static_weekly_guard_approved_template_confirmation()'::regprocedure,
    'public.static_weekly_read_approved_template_confirmation(uuid,text)'::regprocedure,
    'public.static_weekly_assert_approved_recurring_document(jsonb,date,boolean)'::regprocedure,
    'public.static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb)'::regprocedure,
    'public.static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)'::regprocedure,
    'public.static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure,
    'public.static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
    'public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)'::regprocedure) AND a.grantee<>p.proowner
    AND NOT(p.oid IN('public.static_weekly_read_approved_template_confirmation(uuid,text)'::regprocedure,
     'public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)'::regprocedure)
     AND a.grantee='static_weekly_control_plane'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
  OR NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)'::regprocedure
    AND a.grantee='static_weekly_control_plane'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='public.static_weekly_read_approved_template_confirmation(uuid,text)'::regprocedure
    AND a.grantee='static_weekly_control_plane'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.static_weekly_approved_template_confirmations'::regclass
   AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.static_weekly_approved_template_confirmations'::regclass
   AND NOT tgisinternal)<>4
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.static_weekly_approved_template_confirmations'::regclass
   AND tgenabled='A' AND tgnargs=0 AND tgqual IS NULL AND NOT tgisinternal AND (
    (tgname='approved_confirmation_binding' AND tgtype=7 AND tgfoid='public.static_weekly_guard_approved_template_confirmation()'::regprocedure)
    OR(tgname='approved_confirmation_immutable' AND tgtype=27 AND tgfoid='public.static_weekly_reject_update_delete()'::regprocedure)
    OR(tgname='approved_confirmation_no_truncate' AND tgtype=34 AND tgfoid='public.static_weekly_reject_update_delete()'::regprocedure)))<>3
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.static_weekly_approved_template_confirmations'::regclass
   AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled IN('O','A') AND tgtype=62
   AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgnargs=0 AND tgqual IS NULL AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'Approved original confirmation private ACL RLS or existing application fence differs';END IF;
END $private_acl$;

-- Exact existing Source serializers, including an explicit empty table-grant
-- definition and private-helper grant definition. No default privileges infer
-- access. Regprocedure/regclass identities retain their actual serialization.
CREATE TEMP TABLE approved_original_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.oid IN(
  'public.static_weekly_guard_approved_template_confirmation()'::regprocedure,
  'public.static_weekly_read_approved_template_confirmation(uuid,text)'::regprocedure,
  'public.static_weekly_assert_approved_recurring_document(jsonb,date,boolean)'::regprocedure,
  'public.static_weekly_assert_approved_recurring_projection(jsonb,uuid,date,jsonb)'::regprocedure,
  'public.static_weekly_assert_approved_recurring_shift_end_derivation(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
  'public.static_weekly_approved_recurring_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_approved_recurring_publish_draft(uuid,bigint,bigint,uuid,text,text,text,uuid)'::regprocedure,
  'public.static_weekly_approved_recurring_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure,
  'public.static_weekly_materialize_approved_template(uuid,uuid,date,text,bigint,bigint,text,text,jsonb)'::regprocedure)),
 relations(name) AS(VALUES('public.static_weekly_approved_template_confirmations'::text))
 SELECT 100000 bucket,0 priority,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,0,'grant',oid::regprocedure::text,
  public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) FROM funcs
 UNION ALL SELECT x.bucket,0,x.kind,x.identity,x.definition FROM relations r CROSS JOIN LATERAL(
  SELECT 1000 bucket,'relation'::text kind,r.name identity,public.custodial_release_authority_current_relation_definition(r.name) definition
  UNION ALL SELECT 200000,'column',r.name||':'||attname,public.custodial_release_authority_current_column_definition(r.name||':'||attname)
   FROM pg_attribute WHERE attrelid=r.name::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 300000,'column_set',r.name,public.custodial_release_authority_current_column_set_definition(r.name)
  UNION ALL SELECT 400000,'relation_state',r.name,public.custodial_release_authority_current_relation_state_definition(r.name)
  UNION ALL SELECT 500000,'constraint',r.name||':'||conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||conname)
   FROM pg_constraint WHERE conrelid=r.name::regclass
  UNION ALL SELECT 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=r.name::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
  UNION ALL SELECT 700000,'trigger',r.name||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||r.name||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||r.name||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=r.name::regclass AND NOT tgisinternal
  UNION ALL SELECT 900000,'grant',r.name,public.custodial_release_authority_current_grant_definition(r.name)) x;
DO $objects$ BEGIN
 IF EXISTS(SELECT 1 FROM approved_original_objects WHERE definition IS NULL OR definition='')
  OR EXISTS(SELECT kind,identity FROM approved_original_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM approved_original_inventory_before old JOIN approved_original_objects x ON x.kind=old.object_kind
   AND (x.identity=old.object_identity OR(x.kind IN('function','grant') AND x.identity LIKE '%(%' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(x.identity)=to_regprocedure(old.object_identity))))
 THEN RAISE EXCEPTION 'Approved original confirmation finite recovery declaration changed';END IF;
END $objects$;
DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM approved_original_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('immutable original fixed-approved confirmation and controlled recurring writer; no resend permission')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM approved_original_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM approved_original_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM approved_original_surface_before)
 THEN RAISE EXCEPTION 'Approved original confirmation canary owner ACL or exact extension changed';END IF;
END $surface$;

-- The normal migration's exclusive, exact-predecessor Source-inventory
-- extension, not any confirmation mutation or application-guard exception.
-- Only this captured canary definition changes; every prior DATA row stays.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM approved_original_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Approved original exact canary predecessor differs';END IF;
 FOR obj IN SELECT * FROM approved_original_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Approved original finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM approved_original_inventory_before)+(SELECT count(*) FROM approved_original_objects)
  OR EXISTS(SELECT old.* FROM approved_original_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM approved_original_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM approved_original_inventory_before)
  OR EXISTS(SELECT 1 FROM approved_original_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Approved original unrelated recovery bytes or final ALWAYS guard changed';END IF;
END $scope$;
COMMIT;
