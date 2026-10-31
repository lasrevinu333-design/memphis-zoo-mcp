-- Source-only proposal. Install AFTER current coverall/native accepted authority.
-- No old recurring confirmation/FK/job/receipt is modified or fabricated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR to_regnamespace('custodial_coverall') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_operations') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_stages') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_receipts') IS NULL
  THEN RAISE EXCEPTION 'Actual maintained privileged owner and qualified typed recurring predecessor required';END IF;
END $owner$;
CREATE TABLE custodial_coverall.manual_application_bindings(
 operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origin text NOT NULL CHECK(origin='MANUAL_INITIAL'),
 publication_id uuid UNIQUE NOT NULL REFERENCES public.weekly_schedule_publications(publication_id),
 source_id uuid NOT NULL REFERENCES public.static_weekly_authority_source_documents(source_id),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 version_id uuid NOT NULL REFERENCES public.weekly_schedule_versions(version_id),predecessor_publication_id uuid REFERENCES public.weekly_schedule_publications(publication_id),
 initial_manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),initial_idempotency_key text NOT NULL,
 initial_request_json jsonb NOT NULL,initial_receipt_json jsonb NOT NULL,initial_receipt_digest text NOT NULL CHECK(initial_receipt_digest~'^[a-f0-9]{64}$'),
 initial_projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 activation_operation_id uuid UNIQUE REFERENCES custodial_coverall.activation_receipts(operation_id),
 activation_receipt_json jsonb,activation_receipt_digest text,
 original_projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 original_lunch_identity text NOT NULL CHECK(original_lunch_identity~'^[a-f0-9]{64}$'),original_authority_revision bigint NOT NULL REFERENCES public.weekly_schedule_authority_revisions(authority_revision),
 frame_start date NOT NULL,frame_end date NOT NULL,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK(frame_end=frame_start+6),CHECK((activation_operation_id IS NULL AND activation_receipt_json IS NULL AND activation_receipt_digest IS NULL) OR
  (activation_operation_id IS NOT NULL AND activation_receipt_json IS NOT NULL AND activation_receipt_digest~'^[a-f0-9]{64}$'))
);
CREATE TABLE custodial_coverall.manual_application_intents(
 LIKE public.static_weekly_recurring_application_intents INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);
CREATE TABLE custodial_coverall.manual_application_receipts(
 LIKE public.static_weekly_recurring_application_receipts INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);
ALTER TABLE custodial_coverall.manual_application_intents ADD FOREIGN KEY(operation_id) REFERENCES custodial_coverall.manual_application_bindings(operation_id) ON DELETE RESTRICT;
ALTER TABLE custodial_coverall.manual_application_intents ADD CONSTRAINT manual_application_publication_binding_fkey
 FOREIGN KEY(publication_id) REFERENCES custodial_coverall.manual_application_bindings(publication_id) ON DELETE RESTRICT;
ALTER TABLE custodial_coverall.manual_application_receipts ADD FOREIGN KEY(intent_id) REFERENCES custodial_coverall.manual_application_intents(intent_id) ON DELETE RESTRICT;
-- LIKE deliberately copies no foreign keys. Both legacy origin links must
-- target the genuine MANUAL_INITIAL binding, whose publication FK anchors the
-- native public.weekly_schedule_publications row. Preserve all five existing
-- non-origin principal/projection/revision foreign keys verbatim.
DO $fks$ DECLARE row record;BEGIN
 FOR row IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.static_weekly_recurring_application_intents'::regclass AND contype='f'
  AND conkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.static_weekly_recurring_application_intents'::regclass AND attname='operation_id')]::smallint[]
  AND conkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.static_weekly_recurring_application_intents'::regclass AND attname='publication_id')]::smallint[] LOOP
  EXECUTE format('ALTER TABLE custodial_coverall.manual_application_intents ADD CONSTRAINT %I %s','manual_'||row.conname,row.definition);
 END LOOP;
END $fks$;
DO $tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['manual_application_bindings','manual_application_intents','manual_application_receipts'] LOOP
  EXECUTE format('ALTER TABLE custodial_coverall.%I OWNER TO CURRENT_USER',t);
  EXECUTE format('ALTER TABLE custodial_coverall.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE custodial_coverall.%I FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('CREATE TRIGGER manual_delivery_immutable BEFORE UPDATE OR DELETE ON custodial_coverall.%I FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete()',t);
  EXECUTE format('CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.%I FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()',t);
  EXECUTE format('CREATE TRIGGER custodial_manual_notification_plan_source_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.%I FOR EACH STATEMENT EXECUTE FUNCTION public.static_weekly_v27_notification_plan_source_write_fence()',t);
  EXECUTE format('ALTER TABLE custodial_coverall.%I ENABLE ALWAYS TRIGGER custodial_manual_notification_plan_source_fence',t);
 END LOOP;
END $tables$;
CREATE FUNCTION custodial_coverall.bind_manual_application(p_publication uuid,p_expected_receipt_digest text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE initial public.static_weekly_approved_initial_confirmations%rowtype;publication public.weekly_schedule_publications%rowtype;
 version public.weekly_schedule_versions%rowtype;source public.static_weekly_authority_source_documents%rowtype;
 progress custodial_coverall.activation_progress%rowtype;activation custodial_coverall.activation_receipts%rowtype;
 projection public.weekly_schedule_compiled_projections%rowtype;lunch public.weekly_schedule_lunch_documents%rowtype;
 prior custodial_coverall.manual_application_bindings%rowtype;binding uuid;original_projection uuid;revision bigint;receipt jsonb;prior_publication uuid;
BEGIN
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT publication FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 SELECT * INTO STRICT initial FROM public.static_weekly_approved_initial_confirmations WHERE publication_id=p_publication;
 SELECT * INTO STRICT version FROM public.weekly_schedule_versions WHERE version_id=publication.version_id;
 SELECT * INTO STRICT source FROM public.static_weekly_authority_source_documents WHERE source_id=version.authority_source_id;
 IF initial.receipt_json->>'schema' IS DISTINCT FROM 'custodial.approved-static-initial-confirmation.v1'
  OR initial.receipt_json->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT' OR initial.receipt_json->'ok' IS DISTINCT FROM 'true'::jsonb
  OR initial.receipt_json->>'publication_id' IS DISTINCT FROM p_publication::text OR initial.receipt_json->>'projection_id' IS DISTINCT FROM initial.projection_id::text
  OR initial.receipt_json->>'source_id' IS DISTINCT FROM source.source_id::text OR initial.request_json->>'sourceId' IS DISTINCT FROM source.source_id::text
  OR initial.request_json->>'idempotencyKey' IS DISTINCT FROM initial.idempotency_key
  OR source.source_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(source.canonical_source)
  OR NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_baselines b WHERE b.source_id=source.source_id
    AND b.feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f')
  OR EXISTS(SELECT 1 FROM public.static_weekly_recurring_publication_bindings WHERE publication_id=p_publication)
  THEN RAISE EXCEPTION 'Exact genuine manual initial confirmation/source required';END IF;
 original_projection:=initial.projection_id;receipt:=initial.receipt_json;revision:=(receipt->>'authority_revision')::bigint;
 SELECT * INTO progress FROM custodial_coverall.activation_progress WHERE publication_id=p_publication;
 IF FOUND THEN
  SELECT * INTO STRICT activation FROM custodial_coverall.activation_receipts WHERE operation_id=progress.operation_id;
  receipt:=activation.receipt_json;original_projection:=(receipt->>'projectionId')::uuid;revision:=(receipt->>'authorityRevision')::bigint;
  IF receipt->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-source-confirmation.v2'
   OR receipt->>'kind' IS DISTINCT FROM 'INITIAL_EMPLOYMENT_OPERATIONALIZATION' OR receipt->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
   OR receipt->>'operationId' IS DISTINCT FROM progress.operation_id::text OR receipt->>'managerId' IS DISTINCT FROM progress.manager_id::text
   OR receipt->>'publicationId' IS DISTINCT FROM p_publication::text OR receipt->>'sourceId' IS DISTINCT FROM source.source_id::text
   OR receipt->>'versionId' IS DISTINCT FROM version.version_id::text OR receipt->'normalBaselineResult' IS DISTINCT FROM progress.normal_result
   OR NOT EXISTS(SELECT 1 FROM public.static_weekly_manual_activation_confirmations m
     JOIN custodial_coverall.activation_operations o ON o.operation_id=progress.operation_id AND o.packet_id=m.packet_id
     WHERE m.manager_id=progress.manager_id AND m.idempotency_key='coverall-source:'||progress.operation_id::text
      AND initial.manager_id=m.manager_id AND initial.idempotency_key=m.idempotency_key||':initial'
      AND m.receipt_json=progress.normal_result AND m.receipt_digest=public.static_weekly_digest_jsonb(m.receipt_json)
      AND m.receipt_json->>'schema'='custodial.approved-manual-activation-confirmation.v1'
      AND m.receipt_json->>'status'='PERSISTED_CURRENT' AND m.receipt_json->>'publication_id'=initial.publication_id::text
      AND m.receipt_json->>'projection_id'=initial.projection_id::text AND m.receipt_json->>'source_id'=source.source_id::text
      AND m.receipt_json->>'lunch_document_identity'=initial.receipt_json->>'lunch_document_identity')
   OR receipt->'samePhysicalTransaction' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'Exact genuine final operational activation receipt required';END IF;
 END IF;
 IF p_expected_receipt_digest IS NOT NULL AND public.static_weekly_digest_jsonb(receipt) IS DISTINCT FROM p_expected_receipt_digest THEN RAISE EXCEPTION 'Selected original receipt digest differs';END IF;
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=original_projection;
 SELECT * INTO STRICT lunch FROM public.weekly_schedule_lunch_documents WHERE projection_id=original_projection;
 PERFORM public.static_weekly_v8_assert_lunch_document(original_projection,lunch.document_json);
 IF projection.publication_id IS DISTINCT FROM p_publication OR projection.version_id IS DISTINCT FROM version.version_id
  OR lunch.document_identity IS DISTINCT FROM coalesce(receipt->>'lunchDocumentIdentity',receipt#>>'{lunchResult,document_identity}',initial.receipt_json->>'lunch_document_identity')
  OR lunch.document_identity IS DISTINCT FROM lunch.document_json->>'document_identity'
  OR projection.week_end IS DISTINCT FROM projection.week_start+6
  THEN RAISE EXCEPTION 'Original full publication/projection/lunch receipt correspondence differs';END IF;
 SELECT publication_id INTO prior_publication FROM public.weekly_schedule_publications WHERE version_id=publication.prior_version_id ORDER BY authority_revision DESC LIMIT 1;
 SELECT * INTO prior FROM custodial_coverall.manual_application_bindings WHERE publication_id=p_publication;
 IF FOUND THEN
  IF prior.source_id IS DISTINCT FROM source.source_id OR prior.source_digest IS DISTINCT FROM source.source_digest OR prior.version_id IS DISTINCT FROM version.version_id
   OR prior.initial_manager_id IS DISTINCT FROM initial.manager_id OR prior.initial_idempotency_key IS DISTINCT FROM initial.idempotency_key
   OR prior.initial_request_json IS DISTINCT FROM initial.request_json OR prior.initial_receipt_json IS DISTINCT FROM initial.receipt_json
   OR prior.initial_receipt_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(initial.receipt_json)
   OR prior.initial_projection_id IS DISTINCT FROM initial.projection_id OR prior.activation_operation_id IS DISTINCT FROM activation.operation_id
   OR prior.activation_receipt_json IS DISTINCT FROM activation.receipt_json OR prior.activation_receipt_digest IS DISTINCT FROM (CASE WHEN activation.operation_id IS NULL THEN NULL ELSE public.static_weekly_digest_jsonb(activation.receipt_json) END)
   OR prior.original_projection_id IS DISTINCT FROM projection.projection_id OR prior.original_lunch_identity IS DISTINCT FROM lunch.document_identity
   OR prior.original_authority_revision IS DISTINCT FROM revision OR prior.frame_start IS DISTINCT FROM projection.week_start OR prior.frame_end IS DISTINCT FROM projection.week_end
   OR prior.predecessor_publication_id IS DISTINCT FROM prior_publication THEN RAISE EXCEPTION 'Immutable original manual delivery binding conflict';END IF;
  RETURN prior.operation_id;
 END IF;
 INSERT INTO custodial_coverall.manual_application_bindings(origin,publication_id,source_id,source_digest,version_id,predecessor_publication_id,
  initial_manager_id,initial_idempotency_key,initial_request_json,initial_receipt_json,initial_receipt_digest,initial_projection_id,
  activation_operation_id,activation_receipt_json,activation_receipt_digest,original_projection_id,original_lunch_identity,original_authority_revision,frame_start,frame_end)
 VALUES('MANUAL_INITIAL',p_publication,source.source_id,source.source_digest,version.version_id,prior_publication,initial.manager_id,initial.idempotency_key,
  initial.request_json,initial.receipt_json,public.static_weekly_digest_jsonb(initial.receipt_json),initial.projection_id,
  activation.operation_id,activation.receipt_json,CASE WHEN activation.operation_id IS NULL THEN NULL ELSE public.static_weekly_digest_jsonb(activation.receipt_json) END,
  original_projection,lunch.document_identity,revision,projection.week_start,projection.week_end) RETURNING operation_id INTO binding;
 RETURN binding;
END $bind$;

-- A later frame is not an old recurring confirmation. Require its real immutable
-- typed operation/receipt and exact stored native stage OR original normal-repeat
-- receipt. This is post-admission correspondence, never a feasibility substitute.
CREATE FUNCTION custodial_coverall.manual_recurring_projection_accepted(p_binding uuid,p_projection uuid,p_revision bigint,p_operation uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $accepted_recurring$
DECLARE b custodial_coverall.manual_application_bindings%rowtype;
 p public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
 o custodial_coverall.recurring_materialization_operations%rowtype;
 s custodial_coverall.recurring_materialization_stages%rowtype;
 normal public.static_weekly_manual_repeat_confirmations%rowtype;
 receipt jsonb;vector jsonb;
BEGIN
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=p_binding;
 SELECT * INTO STRICT p FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;
 IF p_projection=b.original_projection_id THEN RETURN false;END IF;
 -- A legitimate normal replay can retain the same projection for another
 -- original request. Any real matching admission proves the immutable bytes;
 -- the receipt trigger supplies its exact NEW operation, never an arbitrary one.
 SELECT operation.* INTO o FROM custodial_coverall.recurring_materialization_operations operation
  JOIN custodial_coverall.recurring_materialization_receipts r USING(operation_id)
  WHERE r.receipt_json->>'projectionId'=p_projection::text AND (p_operation IS NULL OR operation.operation_id=p_operation)
  ORDER BY operation.operation_id LIMIT 1;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=o.operation_id;
 SELECT * INTO STRICT l FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection;
 IF b.origin<>'MANUAL_INITIAL' OR o.source_id IS DISTINCT FROM b.source_id OR o.source_digest IS DISTINCT FROM b.source_digest
  OR o.publication_id IS DISTINCT FROM b.publication_id OR o.version_id IS DISTINCT FROM b.version_id
  OR p.publication_id IS DISTINCT FROM b.publication_id OR p.version_id IS DISTINCT FROM b.version_id
  OR p.week_start IS DISTINCT FROM o.frame_start OR p.week_end<>o.frame_start+6
  OR receipt->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-confirmation.v2'
  OR receipt->>'kind' IS DISTINCT FROM 'RECURRING_MANUAL_MATERIALIZATION' OR receipt->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
  OR receipt->'operationId' IS DISTINCT FROM to_jsonb(o.operation_id) OR receipt->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id)
  OR receipt->'sourceId' IS DISTINCT FROM to_jsonb(b.source_id) OR receipt->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
  OR receipt->'versionId' IS DISTINCT FROM to_jsonb(b.version_id) OR receipt->'projectionId' IS DISTINCT FROM to_jsonb(p_projection)
  OR receipt->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start) OR receipt->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6)
  OR receipt->'authorityRevision' IS DISTINCT FROM to_jsonb(p_revision) OR p_revision<o.authority_revision
  OR receipt->'lunchDocumentIdentity' IS DISTINCT FROM to_jsonb(l.document_identity)
  OR receipt->'normalSourceChanged' IS DISTINCT FROM 'false'::jsonb OR receipt->'samePhysicalTransaction' IS DISTINCT FROM 'true'::jsonb
  OR receipt->'normalPatternSolverInvoked' IS DISTINCT FROM 'false'::jsonb
  OR o.request_json->'operationId' IS DISTINCT FROM to_jsonb(o.operation_id)
  OR o.request_json->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id)
  OR o.request_json->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
  OR o.request_json->'serviceDate' IS DISTINCT FROM to_jsonb(o.frame_start)
  OR o.request_json->'expectedRevision' IS DISTINCT FROM to_jsonb(o.authority_revision)
  OR o.request_json->>'idempotencyKey' IS DISTINCT FROM o.idempotency_key
  OR o.request_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-request.v1'
  OR o.request_json->>'kind' IS DISTINCT FROM 'RECURRING_MANUAL_MATERIALIZATION'
  OR l.document_json->>'document_identity' IS DISTINCT FROM l.document_identity
  OR l.document_json->>'base_authority_digest' IS DISTINCT FROM p.authority_digest
  OR l.document_json->>'base_replay_digest' IS DISTINCT FROM p.replay_digest
 THEN RAISE EXCEPTION 'Original typed recurring receipt/source/publication/frame/lunch correspondence differs';END IF;
 IF o.basis_json IS NOT NULL AND o.repeat_basis IS NULL THEN
  SELECT * INTO STRICT s FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=o.operation_id;
  IF s.envelope_json IS DISTINCT FROM p.projection_envelope OR s.lunch_json IS DISTINCT FROM l.document_json
   OR s.candidate_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object('envelope',s.envelope_json,'lunch',s.lunch_json))
   OR receipt->>'candidateDigest' IS DISTINCT FROM s.candidate_digest
   OR receipt->'employmentRevisionVector' IS DISTINCT FROM o.basis_json->'employmentRevisionVector'
   OR p.projection_envelope#>'{semantic_snapshot,recurringOperation,operationId}' IS DISTINCT FROM to_jsonb(o.operation_id)
   OR p.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR p.projection_envelope#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-database-adapter.v1'
   OR p.projection_envelope#>'{authority,sourcePublicationId}' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR p.projection_envelope#>'{authority,sourceVersionId}' IS DISTINCT FROM to_jsonb(b.version_id)
   OR p.projection_envelope#>'{authority,normalSourceChanged}' IS DISTINCT FROM 'false'::jsonb
   OR receipt->'newStaffingCommandCreated' IS DISTINCT FROM 'false'::jsonb OR receipt->'newPTOCreated' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'Prepared or changed recurring native stage is not accepted delivery authority';END IF;
 ELSIF o.repeat_basis IS NOT NULL AND o.basis_json IS NULL THEN
  SELECT * INTO STRICT normal FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=o.manager_id AND request_id=o.operation_id;
  SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId',
   'employmentRevision',e->'employmentRevision','requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId') INTO vector
   FROM jsonb_array_elements(o.repeat_basis->'employmentByDate') days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e);
  IF receipt->'originalRepeatReceipt' IS DISTINCT FROM normal.receipt_json
   OR receipt->'employmentRevisionVector' IS DISTINCT FROM vector OR normal.request_json->'employmentRevisionVector' IS DISTINCT FROM vector
   OR normal.request_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference.v1'
   OR normal.request_json->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id) OR normal.request_json->'requestId' IS DISTINCT FROM to_jsonb(o.operation_id)
   OR normal.request_json->'sourceId' IS DISTINCT FROM to_jsonb(b.source_id) OR normal.request_json->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR normal.request_json->'versionId' IS DISTINCT FROM to_jsonb(b.version_id) OR normal.request_json->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start)
   OR normal.request_json->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6) OR normal.request_json->'expectedRevision' IS DISTINCT FROM to_jsonb(o.authority_revision)
   OR normal.request_json->'generation' IS DISTINCT FROM to_jsonb(o.generation) OR normal.request_json->>'catalogEntryDigest' IS DISTINCT FROM o.catalog_digest
   OR normal.request_json->'origin' IS DISTINCT FROM o.repeat_basis->'origin'
   OR normal.request_json->'baselineSnapshotDigest' IS DISTINCT FROM o.repeat_basis->'baselineSnapshotDigest'
   OR normal.request_json->'sourceProjectionIdentity' IS DISTINCT FROM o.repeat_basis->'sourceProjectionIdentity'
   OR normal.request_json->'sourceLunchIdentity' IS DISTINCT FROM o.repeat_basis->'sourceLunchIdentity'
   OR normal.request_json->>'exceptionSetDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb('[]'::jsonb)
   OR normal.receipt_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-confirmation.v1'
   OR normal.receipt_json->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
   OR normal.receipt_json->'source_id' IS DISTINCT FROM to_jsonb(b.source_id) OR normal.receipt_json->'publication_id' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR normal.receipt_json->'projection_id' IS DISTINCT FROM to_jsonb(p_projection)
   OR normal.receipt_json->'authority_revision' IS DISTINCT FROM to_jsonb(p_revision)
   OR normal.receipt_json->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start) OR normal.receipt_json->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6)
   OR normal.receipt_json->>'lunch_document_identity' IS DISTINCT FROM l.document_identity
   OR normal.receipt_json->>'referenceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(normal.request_json)
   OR normal.receipt_json->'normalSourceChanged' IS DISTINCT FROM 'false'::jsonb OR normal.receipt_json->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
   OR receipt->'operationalSelectionSolverInvoked' IS DISTINCT FROM 'false'::jsonb
   OR p.compiler_version IS DISTINCT FROM 'approved-manual-repeat-v1'
   OR p.projection_envelope->>'compiler_version' IS DISTINCT FROM 'approved-manual-repeat-v1'
   OR p.projection_envelope->'applied_exceptions' IS DISTINCT FROM '[]'::jsonb
   OR p.projection_envelope#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference-adapter.v1'
   OR p.projection_envelope#>>'{authority,repeatReference,schema}' IS DISTINCT FROM 'custodial.approved-manual-fixed-period-reference.v1'
   OR p.projection_envelope#>'{authority,repeatReference,sourceId}' IS DISTINCT FROM to_jsonb(b.source_id)
   OR p.projection_envelope#>'{authority,repeatReference,frameStart}' IS DISTINCT FROM to_jsonb(o.frame_start)
   OR p.projection_envelope#>'{authority,repeatReference,origin}' IS DISTINCT FROM normal.request_json->'origin'
   OR p.projection_envelope#>'{authority,repeatReference,baselineSnapshotDigest}' IS DISTINCT FROM normal.request_json->'baselineSnapshotDigest'
   OR p.projection_envelope#>'{authority,repeatReference,originalProjectionIdentity}' IS DISTINCT FROM normal.request_json->'sourceProjectionIdentity'
   OR p.projection_envelope#>'{authority,repeatReference,originalLunchIdentity}' IS DISTINCT FROM normal.request_json->'sourceLunchIdentity'
  THEN RAISE EXCEPTION 'Original admitted normal repeat correspondence differs';END IF;
 ELSE RAISE EXCEPTION 'One exact typed recurring admission kind required';END IF;
 RETURN true;
END $accepted_recurring$;

CREATE OR REPLACE FUNCTION custodial_coverall.reconcile_manual_application_date(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;b custodial_coverall.manual_application_bindings%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
v_recurring_accepted boolean:=false;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 select * into b from custodial_coverall.manual_application_bindings where publication_id=a.publication_id;
 if not found then return 0;end if;
 select * into strict current_projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
 if current_projection.publication_id is distinct from b.publication_id or current_projection.version_id is distinct from b.version_id
  or not exists(select 1 from public.weekly_schedule_versions v join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where v.version_id=b.version_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  or not exists(select 1 from public.static_weekly_approved_initial_confirmations i where i.publication_id=b.publication_id and i.manager_id=b.initial_manager_id
    and i.idempotency_key=b.initial_idempotency_key and i.receipt_json=b.initial_receipt_json and i.request_json=b.initial_request_json
    and public.static_weekly_digest_jsonb(i.receipt_json)=b.initial_receipt_digest)
  then raise exception 'Manual target origin/current source correspondence differs';end if;
 if current_projection.projection_id<>b.original_projection_id then
  v_recurring_accepted:=custodial_coverall.manual_recurring_projection_accepted(b.operation_id,current_projection.projection_id,a.projection_authority_revision);
 end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and
  (current_projection.projection_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or current_projection.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
   or current_projection.projection_envelope#>>'{authority,sourcePublicationId}' is distinct from b.publication_id::text
   or current_projection.projection_envelope#>>'{authority,sourceVersionId}' is distinct from b.version_id::text
   or current_projection.projection_envelope#>'{authority,normalSourceChanged}' is distinct from 'false'::jsonb)
  then raise exception 'Only accepted original or exact native manual lineage creates targets';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(
  select 1 from public.static_weekly_staffing_commands command
  join public.static_weekly_staffing_staged_candidates staged on staged.operation_id=command.operation_id and staged.candidate_kind='projection'
  join public.static_weekly_staffing_command_receipts receipt on receipt.operation_id=command.operation_id and receipt.event_kind='ACCEPTED'
  where command.state='ACCEPTED' and staged.payload_json->'envelope'=current_projection.projection_envelope
   and command.accepted_receipt->>'event'='ACCEPTED' and command.accepted_receipt->>'operation_id'=command.operation_id::text
   and command.accepted_receipt->>'semantic_digest'=command.semantic_digest
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'publication_id']=b.publication_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and receipt.receipt_json=command.accepted_receipt and receipt.receipt_digest=public.static_weekly_digest_jsonb(receipt.receipt_json))
  then raise exception 'Prepared native document is not an accepted original operation';end if;
 if b.activation_operation_id is not null and not exists(select 1 from custodial_coverall.activation_receipts r where r.operation_id=b.activation_operation_id
  and r.receipt_json=b.activation_receipt_json and public.static_weekly_digest_jsonb(r.receipt_json)=b.activation_receipt_digest)
  then raise exception 'Original operational activation receipt changed';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(select 1 from public.static_weekly_staffing_commands command
  where command.state='ACCEPTED' and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'lunch_document_identity']=l.document_identity)
  then raise exception 'Accepted original native full lunch correspondence differs';end if;
 for person in with people as (
  select (r->>'incumbentPersonId')::uuid employee_id from jsonb_array_elements(coalesce(current_projection.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where r->>'incumbentPersonId' is not null and r->>'serviceDate'=p_date::text
  union select (r->>'incumbentPersonId')::uuid from public.weekly_schedule_compiled_projections old
   cross join lateral jsonb_array_elements(coalesce(old.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where old.projection_id=b.original_projection_id and r->>'incumbentPersonId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select (r->>'personId')::uuid from public.weekly_schedule_versions v
   cross join lateral jsonb_array_elements(coalesce(v.draft_document#>'{authority,compilerInput,roster}','[]')) r
   where v.version_id=b.version_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select old.employee_id from custodial_coverall.manual_application_intents old where old.publication_id=b.publication_id and old.service_date=p_date
  union select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and x.service_date=p_date and x.owner_person_id_snapshot is not null
  union select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from custodial_coverall.manual_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$
;
CREATE OR REPLACE FUNCTION custodial_coverall.read_manual_application_target(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t custodial_coverall.manual_application_intents%rowtype;receipt custodial_coverall.manual_application_receipts%rowtype;a record;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application read requires finite date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 select * into t from custodial_coverall.manual_application_intents i
  where i.service_date=p_date and i.device_id=p_device and i.credential_id=p_credential
   and i.employee_id=p_employee and i.assignment_epoch=p_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then
  if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
   return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
  return null;
 end if;
 if a.projection_status is distinct from 'current' or t.publication_id is distinct from a.publication_id
  or t.projection_id is distinct from a.projection_id or t.authority_revision is distinct from a.projection_authority_revision
  or not exists(select 1 from public.weekly_schedule_lunch_documents l where l.projection_id=a.projection_id and l.document_identity=t.lunch_document_identity) then
  return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
 if t.target_json->>'operationId' is distinct from t.operation_id::text or t.target_digest is distinct from public.static_weekly_digest_jsonb(t.target_json)
  or t.view_digest is distinct from public.static_weekly_digest_jsonb(t.view_json)
  or not exists(select 1 from custodial_coverall.manual_application_bindings b join public.weekly_schedule_versions v using(version_id)
    join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where b.operation_id=t.operation_id and b.publication_id=a.publication_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  then raise exception 'Exact typed manual intent/current source bytes differ';end if;
 -- Current typed recurring data must retain its actual immutable admission,
 -- even when a target already exists. Metadata/mode alone is not acceptance.
 if exists(select 1 from public.weekly_schedule_compiled_projections p where p.projection_id=a.projection_id
   and (p.projection_envelope#>'{semantic_snapshot,recurringOperation}' is not null
     or p.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-recurring-reference-adapter.v1'))
  and not custodial_coverall.manual_recurring_projection_accepted(t.operation_id,a.projection_id,a.projection_authority_revision)
 then raise exception 'Exact current typed recurring acceptance is unavailable';end if;
 select * into receipt from custodial_coverall.manual_application_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'view',t.view_json,'viewJsonText',t.view_json::text,'viewDigest',t.view_digest,
  'applicationStatus',case when receipt.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at);
end
$function$
;
CREATE OR REPLACE FUNCTION custodial_coverall.ack_manual_application_target(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t custodial_coverall.manual_application_intents%rowtype;r custodial_coverall.manual_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into t from custodial_coverall.manual_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from custodial_coverall.manual_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into custodial_coverall.manual_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_reconcile_recurring_application_date(date)'::regprocedure)) IS DISTINCT FROM 'fbe23313ab9e85fea04e6901f8367f0051ba9ba550840e4e31c203aaae2ff4d2' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_reconcile_recurring_application_date';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_reconcile_recurring_application_date(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;b public.static_weekly_recurring_publication_bindings%rowtype;
 p public.static_weekly_recurring_confirmations%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 select * into b from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id;
 if not found then return custodial_coverall.reconcile_manual_application_date(p_date);end if; -- exact manual origin is separate, never a recurring confirmation
 select * into strict p from public.static_weekly_recurring_confirmations where operation_id=b.operation_id;
 if not exists(select 1 from public.static_weekly_recurring_confirmation_receipts r where r.operation_id=b.operation_id)
  and (b.owner_xid<>pg_current_xact_id() or p.owner_xid<>pg_current_xact_id()) then
  raise exception 'unaccepted recurring parent cannot create phone targets';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 for person in with people as (
  select (r->>'personId')::uuid employee_id from jsonb_array_elements(b.dependency_snapshot->'roster') r
   where r->>'personId' is not null and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select (r->>'personId')::uuid from public.static_weekly_recurring_publication_bindings prior
   cross join lateral jsonb_array_elements(prior.dependency_snapshot->'roster') r
   where prior.publication_id=b.predecessor_publication_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id) and x.service_date=p_date
    and x.owner_person_id_snapshot is not null
  union
  select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union
  select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from public.static_weekly_recurring_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM 'a2d04f831cce37de5bd503adea6e648f8b99545e24c111a74c9b0764807990da' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_read_recurring_application_target';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_read_recurring_application_target(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;receipt public.static_weekly_recurring_application_receipts%rowtype;a record;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application read requires finite date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  return custodial_coverall.read_manual_application_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 select * into t from public.static_weekly_recurring_application_intents i
  where i.service_date=p_date and i.device_id=p_device and i.credential_id=p_credential
   and i.employee_id=p_employee and i.assignment_epoch=p_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then
  if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
   return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
  return null;
 end if;
 if a.projection_status is distinct from 'current' or t.publication_id is distinct from a.publication_id
  or t.projection_id is distinct from a.projection_id or t.authority_revision is distinct from a.projection_authority_revision then
  return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
 select * into receipt from public.static_weekly_recurring_application_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'view',t.view_json,'viewJsonText',t.view_json::text,'viewDigest',t.view_digest,
  'applicationStatus',case when receipt.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_ack_recurring_application_target(uuid,uuid,uuid,uuid,bigint,bigint,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '12b247915de07ae32eee0209b82ce2c30d7470dbc16184f4cc7f3b5e30b3d6d9' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_ack_recurring_application_target';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_ack_recurring_application_target(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;r public.static_weekly_recurring_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
  if exists(select 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent) then raise exception 'Ambiguous typed intent ownership';end if;
  return custodial_coverall.ack_manual_application_target(p_intent,p_device,p_credential,p_employee,p_epoch,p_revision,p_target_digest,p_rendered_digest,p_applied_at);end if;
 select * into t from public.static_weekly_recurring_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from public.static_weekly_recurring_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into public.static_weekly_recurring_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM '063b3b106479fc656269ad0729e119d480e65dcac72c6c311dbbfdd65cfe7a38' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v24_read_device_schedule_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v24_read_device_schedule_delivery(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;v_delivery jsonb;v_dated jsonb;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'schedule delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if a.projection_status='blocked_recurring_authority' then
  -- Terminal wins before any older dated or recurring schedule is considered.
  v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   perform public.static_weekly_v19_reconcile_terminal_date(p_date);
   v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_TERMINAL',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false);
 end if;
 if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id)
  or exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  if a.projection_status is distinct from 'current' then
   return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','UNAVAILABLE',
    'projectionStatus',a.projection_status,'delivery',null,'datedApplication',null,'affectedPhonesUpdated',false);
  end if;
  v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   -- Reconcile only a missing current identity. Existing immutable views do
   -- not need all-person reconstruction on every connected phone poll.
   perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
   v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_SCHEDULE',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false,
   'authorityOrigin',case when exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    then (select jsonb_build_object('kind','MANUAL_INITIAL','bindingId',operation_id) from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    else jsonb_build_object('kind','RECURRING_CONFIRMATION','bindingId',v_delivery#>'{target,operationId}') end);
 end if;
 -- Existing release-registered/dated workflow stays separate. Never use an
 -- old dated target with a different exact current publication/projection.
 v_dated:=public.static_weekly_v10_read_device_schedule_application(p_date,p_device,p_credential,p_employee,p_epoch);
 if a.projection_status is distinct from 'current'
  or v_dated->>'publication_id' is distinct from a.publication_id::text
  or v_dated->>'projection_id' is distinct from a.projection_id::text
  or v_dated->>'authority_revision' is distinct from a.projection_authority_revision::text then v_dated:=null;end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','LEGACY_REGISTERED',
  'delivery',null,'datedApplication',v_dated,'affectedPhonesUpdated',false);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '6a07f3cbb6d04adf6f93045a90ef1917a057b4dbcf52530db311e459dbecc89b' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v24_ack_device_schedule_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v24_ack_device_schedule_delivery(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_target_type text, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;
 terminal public.static_weekly_recurring_terminal_intents%rowtype;dated record;v_result jsonb;
begin
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 if p_target_type='BLOCKED_RECURRING_AUTHORITY' then
  select * into terminal from public.static_weekly_recurring_terminal_intents where intent_id=p_intent;
  if not found or p_target_digest is distinct from terminal.target_digest
   or p_rendered_digest is distinct from p_target_digest then
   raise exception using errcode='23514',message='terminal delivery receipt requires exact target bytes';end if;
  v_result:=public.static_weekly_v19_ack_terminal_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_rendered_digest,p_applied_at);
 elsif p_target_type='SCHEDULE' then
  v_result:=public.static_weekly_v22_ack_recurring_application_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_target_digest,p_rendered_digest,p_applied_at);
  if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
   select * into strict t from custodial_coverall.manual_application_intents where intent_id=p_intent;
  else
   select * into strict t from public.static_weekly_recurring_application_intents where intent_id=p_intent;
  end if;
  -- A dated absence/cancellation may use the same current recurring winner.
  -- Preserve its existing manager delivery receipt only for the EXACT same
  -- principal, date, revision, projection and lunch just applied. Caller
  -- supplies no dated operation/intent identity. Old/different targets remain
  -- history; no fabricated ACK on enqueue, provider acceptance or new device.
  for dated in select i.* from public.static_weekly_schedule_application_intents i
   join public.static_weekly_staffing_commands c on c.operation_id=i.operation_id and c.state='ACCEPTED'
   where i.service_date=t.service_date and i.employee_id=t.employee_id and i.device_id=t.device_id
    and i.credential_id=t.credential_id and i.assignment_epoch=t.assignment_epoch
    and i.authority_revision=t.authority_revision and i.publication_id=t.publication_id
    and i.projection_id=t.projection_id and i.lunch_document_identity=t.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=i.intent_id)
   order by i.intent_id loop
   perform public.static_weekly_v10_ack_device_schedule_application(dated.intent_id,p_device,p_credential,p_employee,p_epoch,
    p_revision,t.projection_id,t.lunch_document_identity,p_rendered_digest,p_applied_at);
  end loop;
 else raise exception using errcode='22023',message='exact typed schedule delivery receipt required';end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery-receipt.v1','receipt',v_result,
  'currentAuthorityNotInferred',true);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v25_read_current_recurring_delivery(date,uuid)'::regprocedure)) IS DISTINCT FROM '3bf65a972869ff81372ad3f3952daace5739a139985f685a5b368bbdaaa602d7' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v25_read_current_recurring_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v25_read_current_recurring_delivery(p_date date, p_manager uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;t public.static_weekly_recurring_invalidations%rowtype;
 v_mode text;v_rows jsonb:='[]'::jsonb;v_count int;v_reported int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'current recurring delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager);
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if a.projection_status='blocked_recurring_authority' then
  v_mode:='RECURRING_TERMINAL';
  perform public.static_weekly_v19_reconcile_terminal_date(p_date);
  t:=public.static_weekly_v19_current_terminal_range(p_date);
 elsif a.projection_status='current' and exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  v_mode:='RECURRING_SCHEDULE';
  perform custodial_coverall.reconcile_manual_application_date(p_date);
 elsif a.projection_status='current' and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
  v_mode:='RECURRING_SCHEDULE';
  perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
 else
  v_mode:=case when a.projection_status='current' then 'LEGACY_REGISTERED' else 'UNAVAILABLE' end;
 end if;
 if v_mode in ('RECURRING_SCHEDULE','RECURRING_TERMINAL') then
  with targets as (
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.view_digest rendered_digest,r.receipt_id,r.rendered_digest receipt_digest,r.received_at
   from public.static_weekly_recurring_application_intents i
   left join public.static_weekly_recurring_application_receipts r using(intent_id)
   where v_mode='RECURRING_SCHEDULE' and i.service_date=p_date and i.publication_id=a.publication_id
    and i.projection_id=a.projection_id and i.authority_revision=a.projection_authority_revision
   union all
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.view_digest,r.receipt_id,r.rendered_digest,r.received_at
   from custodial_coverall.manual_application_intents i
   left join custodial_coverall.manual_application_receipts r using(intent_id)
   where v_mode='RECURRING_SCHEDULE' and i.service_date=p_date and i.publication_id=a.publication_id
    and i.projection_id=a.projection_id and i.authority_revision=a.projection_authority_revision
   union all
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.target_digest,r.receipt_id,r.rendered_digest,r.received_at
   from public.static_weekly_recurring_terminal_intents i
   left join public.static_weekly_recurring_terminal_receipts r using(intent_id)
   where v_mode='RECURRING_TERMINAL' and i.service_date=p_date and i.invalidation_id=t.invalidation_id
    and i.authority_revision=t.authority_revision
  ), people as (select distinct employee_id from targets), current_rows as (
   select p.employee_id,e.display_name,e.active,device.id device_id,device.device_name,
    device.credential_id,device.assignment_epoch,x.intent_id,x.target_digest,x.receipt_id,x.received_at,
    case when e.active is distinct from true then 'PROTECTED_PRINCIPAL_PENDING'
     when device.id is null then 'NO_CURRENT_DEVICE'
     when x.intent_id is null then 'PENDING_TARGET_RECONCILIATION'
     when x.receipt_id is null or x.receipt_digest is distinct from x.rendered_digest then 'PENDING'
     when v_mode='RECURRING_TERMINAL' then 'DEVICE_REPORTED_BLOCKED' else 'DEVICE_REPORTED_APPLIED' end status
   from people p join public.employees e on e.id=p.employee_id
   left join lateral (
    select d.id,d.device_name,d.assignment_epoch,c.credential_id from public.devices d
    join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
     and c.revoked_at is null and c.expires_at>statement_timestamp()
    where d.active=true and d.assigned_employee_id=p.employee_id
   ) device on true
   left join targets x on x.employee_id=p.employee_id and x.device_id is not distinct from device.id
    and x.credential_id is not distinct from device.credential_id
    and x.assignment_epoch is not distinct from device.assignment_epoch
  ) select coalesce(jsonb_agg(jsonb_build_object('employeeId',employee_id,'employeeName',display_name,
    'deviceId',device_id,'deviceName',device_name,'credentialId',credential_id,'assignmentEpoch',assignment_epoch,
    'intentId',intent_id,'targetDigest',target_digest,'status',status,
    'receiptId',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then receipt_id end,
    'receivedAt',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then received_at end)
    order by employee_id,device_id,credential_id),'[]'::jsonb) into v_rows from current_rows;
 end if;
 v_count:=jsonb_array_length(v_rows);
 select count(*) into v_reported from jsonb_array_elements(v_rows) row
  where row->>'status' in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED');
 return jsonb_build_object('schema','static-weekly.current-recurring-delivery.v1','serviceDate',p_date,
  'observedAt',statement_timestamp(),'mode',v_mode,'projectionStatus',a.projection_status,
  'currentAuthority',jsonb_build_object('publicationId',a.publication_id,'projectionId',a.projection_id,
    'authorityRevision',case when v_mode='RECURRING_TERMINAL' then t.authority_revision else a.projection_authority_revision end,
    'invalidationId',t.invalidation_id),'targets',v_rows,'targetCount',v_count,'reportedCount',v_reported,
  'allCurrentTargetsReported',v_count>0 and v_count=v_reported,
  'affectedPhonesUpdated',v_mode='RECURRING_SCHEDULE' and v_count>0 and v_count=v_reported,
  'authorityOrigin',case when exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    then (select jsonb_build_object('kind','MANUAL_INITIAL','bindingId',operation_id) from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) else null end,
  'coverageReadinessNotInferred',true);
end
$function$
;
CREATE FUNCTION custodial_coverall.reconcile_manual_publication(p_publication uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $pub$
DECLARE b custodial_coverall.manual_application_bindings%rowtype;day date;a record;
BEGIN
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE publication_id=p_publication;
 FOR day IN SELECT DISTINCT d::date FROM public.weekly_schedule_compiled_projections p
  JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  CROSS JOIN LATERAL generate_series(p.week_start,p.week_end,'1 day') d WHERE p.publication_id=b.publication_id ORDER BY d::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status='current' AND a.publication_id=b.publication_id THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
 END LOOP;
END $pub$;
-- Genuine explicit catch-up: exact stored receipt, once; never acceptance replay.
CREATE FUNCTION public.static_weekly_bind_manual_device_delivery(p_manager uuid,p_publication uuid,p_receipt_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $catchup$
DECLARE binding uuid;b custodial_coverall.manual_application_bindings%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 IF coalesce(p_receipt_digest,'')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Exact original receipt digest required';END IF;
 binding:=custodial_coverall.bind_manual_application(p_publication,p_receipt_digest);
 PERFORM custodial_coverall.reconcile_manual_publication(p_publication);
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=binding;
 RETURN jsonb_build_object('schema','custodial.manual-device-delivery-binding.v1','origin','MANUAL_INITIAL','bindingId',binding,
  'publicationId',b.publication_id,'sourceId',b.source_id,'originalProjectionId',b.original_projection_id,
  'originalLunchDocumentIdentity',b.original_lunch_identity,'originalReceiptDigest',coalesce(b.activation_receipt_digest,b.initial_receipt_digest),
  'phoneDeliveryState','PENDING','affectedPhonesUpdated',false,'acceptanceRerun',false);
END $catchup$;
CREATE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $accepted$
DECLARE pub uuid;binding uuid;b custodial_coverall.manual_application_bindings%rowtype;day date;a record;
BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='static_weekly_approved_initial_confirmations' THEN
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_baselines baseline WHERE baseline.source_id=(NEW.receipt_json->>'source_id')::uuid
   AND baseline.feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f') THEN RETURN NEW;END IF;
  pub:=NEW.publication_id;
 ELSIF TG_TABLE_SCHEMA='custodial_coverall' AND TG_TABLE_NAME='activation_receipts' THEN
  SELECT publication_id INTO STRICT pub FROM custodial_coverall.activation_progress WHERE operation_id=NEW.operation_id;
 ELSE RAISE EXCEPTION 'Exact accepted manual receipt owner required';END IF;
 binding:=custodial_coverall.bind_manual_application(pub,NULL);
 PERFORM custodial_coverall.reconcile_manual_publication(pub);
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=binding;
 FOR day IN SELECT generate_series(b.frame_start,b.frame_end,'1 day')::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status IS DISTINCT FROM 'current' OR a.publication_id IS DISTINCT FROM pub OR a.projection_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_lunch_documents WHERE projection_id=a.projection_id)
   THEN RAISE EXCEPTION 'New manual acceptance requires all seven exact current projection/full-lunch days in this transaction';END IF;
 END LOOP;RETURN NEW;
END $accepted$;
CREATE CONSTRAINT TRIGGER manual_initial_delivery_complete
 AFTER INSERT ON public.static_weekly_approved_initial_confirmations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance();
CREATE TRIGGER manual_operational_delivery_complete
 AFTER INSERT ON custodial_coverall.activation_receipts FOR EACH ROW EXECUTE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance();
-- The actual full accepted projection+lunch is available only after its writer.
-- Deferred execution observes final native acceptance, not a prepared document.
CREATE FUNCTION custodial_coverall.reconcile_manual_delivery_after_lunch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $lunch$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;day date;a record;
BEGIN
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=NEW.projection_id;
 IF EXISTS(SELECT 1 FROM custodial_coverall.manual_application_bindings WHERE publication_id=projection.publication_id) THEN
  FOR day IN SELECT generate_series(projection.week_start,projection.week_end,'1 day')::date LOOP
   SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
   IF a.projection_status='current' AND a.publication_id=projection.publication_id AND a.projection_id=projection.projection_id
    THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
  END LOOP;
 END IF;RETURN NEW;
END $lunch$;
CREATE CONSTRAINT TRIGGER manual_native_delivery_after_lunch
 AFTER INSERT ON public.weekly_schedule_lunch_documents DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.reconcile_manual_delivery_after_lunch();
-- Receipt insertion follows the real native/normal writer. Deferred execution
-- observes its final stored rows in the same transaction, not a staged candidate.
CREATE FUNCTION custodial_coverall.reconcile_manual_delivery_after_recurring_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $recurring_delivery$
DECLARE operation custodial_coverall.recurring_materialization_operations%rowtype;
 binding uuid;projection uuid;day date;a record;
BEGIN
 IF TG_TABLE_SCHEMA<>'custodial_coverall' OR TG_TABLE_NAME<>'recurring_materialization_receipts'
 THEN RAISE EXCEPTION 'Exact typed recurring receipt owner required';END IF;
 SELECT * INTO STRICT operation FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=NEW.operation_id;
 SELECT operation_id INTO STRICT binding FROM custodial_coverall.manual_application_bindings WHERE publication_id=operation.publication_id;
 projection:=(NEW.receipt_json->>'projectionId')::uuid;
 IF NOT custodial_coverall.manual_recurring_projection_accepted(binding,projection,(NEW.receipt_json->>'authorityRevision')::bigint,NEW.operation_id)
 THEN RAISE EXCEPTION 'Actual accepted recurring receipt required before delivery reconciliation';END IF;
 FOR day IN SELECT generate_series(operation.frame_start,operation.frame_start+6,'1 day')::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status='current' AND a.publication_id=operation.publication_id AND a.projection_id=projection
   THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
 END LOOP;
 RETURN NEW;
END $recurring_delivery$;
CREATE CONSTRAINT TRIGGER manual_recurring_delivery_after_receipt
 AFTER INSERT ON custodial_coverall.recurring_materialization_receipts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.reconcile_manual_delivery_after_recurring_receipt();
-- Only manual typed intent/projection SHARE NOWAIT locks are added; principal,
-- reservation/current-plan/token/time and final original ACK checks stay literal.
DO $ack_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM 'faa0f55d4896f4363000c5953a2fef8caa864d5db77902a9bf047071d55f3ff2' THEN RAISE EXCEPTION 'Exact v27 original ACK predecessor differs';END IF;END $ack_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_ack_device_schedule_delivery(p_plan_read uuid, p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_target_type text, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare original public.static_weekly_recurring_notification_plan_reads%rowtype;principal jsonb;current_plan jsonb;body jsonb;
 result jsonb;semantic text;at_time timestamptz;until_time timestamptz;locked record;
begin
 perform public.static_weekly_v27_lock_notification_plan_sources();
 principal:=public.static_weekly_v27_notification_plan_backend_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict original from public.static_weekly_recurring_notification_plan_reads where plan_read_id=p_plan_read;
 if original.intent_id is distinct from p_intent or original.device_id is distinct from p_device
  or original.credential_id is distinct from p_credential or original.employee_id is distinct from p_employee
  or original.assignment_epoch is distinct from p_epoch or original.target_type is distinct from p_target_type
  or original.authority_revision is distinct from p_revision or original.target_digest is distinct from p_target_digest
  or original.rendered_digest is distinct from p_rendered_digest or original.backend_principal is distinct from principal then
  raise exception 'exact issued notification plan read required' using errcode='42501';end if;
 -- A complete normal plan with unavailable original jobs is UI DATA only.
 -- It must never grant the same receipt through a header/token-only caller.
 if original.plan_body->>'schema'='custodial.recurring-current-notification-plan.v2'
  and (original.plan_body#>>'{delivery_bindings,state}' is distinct from 'ORIGINAL_NATIVE_RESERVATIONS'
   or case when jsonb_typeof(original.plan_body#>'{delivery_bindings,entries}')='array'
    then jsonb_array_length(original.plan_body#>'{delivery_bindings,entries}') else 0 end<>jsonb_array_length(original.plan_body->'required_effects')
   or jsonb_array_length(original.plan_body->'required_effects')<1) then
  raise exception 'issued original native bindings unavailable' using errcode='42501';end if;
 at_time:=clock_timestamp();if at_time>=original.valid_until then raise exception 'issued notification plan expired' using errcode='40001';end if;
 current_plan:=public.static_weekly_v27_notification_plan_at(original.service_date,p_device,p_credential,p_employee,p_epoch,p_intent,p_target_digest,at_time);
 body:=current_plan->'body';until_time:=least((body->>'valid_until')::timestamptz,(principal->>'credential_expires_at')::timestamptz);
 body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(until_time)))
  ||jsonb_build_object('backend_principal_digest',public.static_weekly_digest_jsonb(principal));
 semantic:=public.static_weekly_digest_jsonb(body-'observed_at');
 -- Exact original job selection is separately bound/recompared. A future
 -- semantic-effect refactor must not silently omit native-original custody.
 if (body->'delivery_bindings') is distinct from (original.plan_body->'delivery_bindings')
  or (body->>'schema') is distinct from (original.plan_body->>'schema') then
  raise exception 'issued original native binding changed' using errcode='40001';end if;
 if semantic is distinct from original.semantic_digest or until_time is distinct from original.valid_until then
  raise exception 'issued notification plan source changed' using errcode='40001';end if;
 -- Old writer's explicit row locks and FK key-share probes are pre-admitted
 -- with NOWAIT, including pure row-locking transactions (ROW SHARE table mode).
 -- Source-exclusive prevents new recurring rows; auxiliary SRE prevents new
 -- dated intent/receipt rows. Any pre-existing conflicting row lock refuses.
 if p_target_type='SCHEDULE' then
  if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
   if exists(select 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent)
    then raise exception 'Ambiguous original manual/recurring intent owner';end if;
  perform 1 from custodial_coverall.manual_application_intents where intent_id=p_intent for share nowait;
  perform 1 from public.weekly_schedule_compiled_projections p
   join custodial_coverall.manual_application_intents i on i.projection_id=p.projection_id
   where i.intent_id=p_intent for share of p nowait;
  for locked in select d.intent_id,d.projection_id
   from public.static_weekly_schedule_application_intents d
   join custodial_coverall.manual_application_intents i on i.intent_id=p_intent
   join public.static_weekly_staffing_commands c on c.operation_id=d.operation_id and c.state='ACCEPTED'
   where d.service_date=i.service_date and d.employee_id=i.employee_id and d.device_id=i.device_id
    and d.credential_id=i.credential_id and d.assignment_epoch=i.assignment_epoch
    and d.authority_revision=i.authority_revision and d.publication_id=i.publication_id
    and d.projection_id=i.projection_id and d.lunch_document_identity=i.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=d.intent_id)
   order by d.intent_id for share of d nowait loop
   perform 1 from public.weekly_schedule_compiled_projections where projection_id=locked.projection_id for share nowait;
  end loop;
  else
  perform 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent for share nowait;
  perform 1 from public.weekly_schedule_compiled_projections p
   join public.static_weekly_recurring_application_intents i on i.projection_id=p.projection_id
   where i.intent_id=p_intent for share of p nowait;
  for locked in select d.intent_id,d.projection_id
   from public.static_weekly_schedule_application_intents d
   join public.static_weekly_recurring_application_intents i on i.intent_id=p_intent
   join public.static_weekly_staffing_commands c on c.operation_id=d.operation_id and c.state='ACCEPTED'
   where d.service_date=i.service_date and d.employee_id=i.employee_id and d.device_id=i.device_id
    and d.credential_id=i.credential_id and d.assignment_epoch=i.assignment_epoch
    and d.authority_revision=i.authority_revision and d.publication_id=i.publication_id
    and d.projection_id=i.projection_id and d.lunch_document_identity=i.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=d.intent_id)
   order by d.intent_id for share of d nowait loop
   perform 1 from public.weekly_schedule_compiled_projections where projection_id=locked.projection_id for share nowait;
  end loop;
  end if;
 else
  perform 1 from public.static_weekly_recurring_terminal_intents where intent_id=p_intent for share nowait;
 end if;
 result:=public.static_weekly_v24_ack_device_schedule_delivery(p_intent,p_device,p_credential,p_employee,p_epoch,
  p_target_type,p_revision,p_target_digest,p_rendered_digest,p_applied_at);
 -- All sources stay write-fenced until COMMIT. Fresh server time AFTER the
 -- original receipt writer is the final check; a failure rolls back its rows.
 if clock_timestamp()>=original.valid_until then raise exception 'issued notification plan expired during receipt' using errcode='40001';end if;
 return result;
end $function$;
DO $private_owners$ DECLARE row record;BEGIN
 FOR row IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_coverall' AND p.proname=ANY(ARRAY['bind_manual_application','manual_recurring_projection_accepted','reconcile_manual_application_date','read_manual_application_target','ack_manual_application_target','reconcile_manual_publication','bind_manual_delivery_after_acceptance','reconcile_manual_delivery_after_lunch','reconcile_manual_delivery_after_recurring_receipt']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',row.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',row.signature);
 END LOOP;
END $private_owners$;
ALTER FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) TO static_weekly_control_plane;
-- The accepted exception identity is invariant across projection/receipt rows.
-- A genuinely uncorrelated scalar subquery makes it an InitPlan (at most once
-- per employee-day reader statement), without eager work on an empty join.
-- No materialized/cache/GUC authority, relaxed equality, view or time change.
DO $employee_day_digest_initplan$
DECLARE target oid:='public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamptz)'::regprocedure;
 before_metadata jsonb;after_metadata jsonb;original_definition text;next_definition text;
 old_expression text:=$old_expression$p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(v_publication,v_week_start))$old_expression$;
 new_expression text:=$new_expression$p.exception_set_digest=(select public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(v_publication,v_week_start)))$new_expression$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure)
    IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained installer and original reader owner required';END IF;
 original_definition:=pg_get_functiondef(target);
 IF public.static_weekly_digest_text(original_definition) IS DISTINCT FROM '25faf446ca1ec9ee0f295f0114617eafc565cfd9f19ff41a3a8bde845fa6da38'
  OR (SELECT public.static_weekly_digest_text(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '3f146d909d4584b7ab621d8753f0d6876f2044b46b67f7d31c918c326bc554f4'
  OR (length(original_definition)-length(replace(original_definition,old_expression,'')))/length(old_expression)<>1
 THEN RAISE EXCEPTION 'Exact original employee-day reader required; reconcile changed source before proceeding';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE p.oid=target;
 next_definition:=replace(original_definition,old_expression,new_expression);
 IF public.static_weekly_digest_text(next_definition) IS DISTINCT FROM '242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'
 THEN RAISE EXCEPTION 'Exact single InitPlan substitution differs';END IF;
 EXECUTE next_definition;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata
  OR public.static_weekly_digest_text(pg_get_functiondef(target)) IS DISTINCT FROM '242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'
 THEN RAISE EXCEPTION 'Employee-day reader identity/owner/ACL/attributes or exact successor differs';END IF;
END $employee_day_digest_initplan$;
COMMIT;
