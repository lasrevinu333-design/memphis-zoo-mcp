-- PRIVATE post-admission optimization. Actual full admission mathematics remains
-- in the byte-preserved existing v8 materializer/validator. No new public RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $installer$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR to_regnamespace('custodial_coverall') IS NULL THEN RAISE EXCEPTION 'Actual maintained lunch installer owner required';END IF;
END $installer$;
CREATE TABLE custodial_coverall.manual_lunch_admission_proofs(
 projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 document_identity text NOT NULL CHECK(document_identity~'^[a-f0-9]{64}$'),
 validator_fingerprint text NOT NULL CHECK(validator_fingerprint~'^[a-f0-9]{64}$'),
 projection_digest text NOT NULL CHECK(projection_digest~'^[a-f0-9]{64}$'),document_digest text NOT NULL CHECK(document_digest~'^[a-f0-9]{64}$'),
 full_projection_json jsonb NOT NULL,full_document_json jsonb NOT NULL,
 validated_at timestamptz NOT NULL DEFAULT clock_timestamp(),validated_by name NOT NULL DEFAULT current_user,
 validation_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
 PRIMARY KEY(projection_id,document_identity,validator_fingerprint),
 CHECK(full_projection_json->>'projection_id'=projection_id::text AND full_document_json->>'document_identity'=document_identity),
 CHECK(projection_digest=public.static_weekly_digest_jsonb(full_projection_json)),
 CHECK(document_digest=public.static_weekly_digest_jsonb(full_document_json))
);
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs OWNER TO CURRENT_USER;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_coverall.manual_lunch_admission_proofs FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER manual_lunch_admission_immutable BEFORE UPDATE OR DELETE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation();
CREATE TRIGGER manual_lunch_proof_source_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH STATEMENT EXECUTE FUNCTION public.static_weekly_v27_notification_plan_source_write_fence();
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER manual_lunch_proof_source_fence;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER manual_lunch_admission_immutable;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER custodial_disaster_restore_mutation_fence;
DO $materializer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM 'b37945e14e5f804f4bbde542115bd017f8c7e64b909933658d8a23ec6979a9e9' THEN RAISE EXCEPTION 'Exact real materializer predecessor differs';END IF;END $materializer_predecessor$;
CREATE OR REPLACE FUNCTION custodial_coverall.original_v8_materialize_lunch_document(p_projection_id uuid, p_document jsonb, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare projection public.weekly_schedule_compiled_projections%rowtype;
 existing public.weekly_schedule_lunch_documents%rowtype;current_authority record;inserted integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection does not exist'; end if;
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(projection.week_start);
 if current_authority.projection_status is distinct from 'current'
  or current_authority.projection_id is distinct from p_projection_id then raise exception 'lunch projection is not current'; end if;
 perform public.static_weekly_v8_assert_lunch_document(p_projection_id,p_document);
 insert into public.weekly_schedule_lunch_documents(projection_id,document_identity,document_json,accepted_by_manager_id)
 values(p_projection_id,p_document->>'document_identity',p_document,p_manager_id) on conflict(projection_id) do nothing;
 get diagnostics inserted=row_count;
 select * into strict existing from public.weekly_schedule_lunch_documents where projection_id=p_projection_id;
 if existing.document_json is distinct from p_document then raise exception 'immutable lunch publication conflicts with existing authority'; end if;
 return jsonb_build_object('ok',true,'persistence_status','PERSISTED','projection_id',p_projection_id,
  'document_identity',existing.document_identity,'replayed',inserted=0);
end $function$
;
CREATE FUNCTION custodial_coverall.lunch_validator_fingerprint()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fingerprint$
DECLARE signatures text[]:=ARRAY[
 'public.static_weekly_v8_assert_lunch_document(uuid,jsonb)',
 'public.static_weekly_manual_assert_native_lunch(uuid,jsonb,jsonb,uuid,date)',
 'public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date)',
 'public.static_weekly_manual_native_lunch_policy(jsonb)',
 'public.static_weekly_manual_identity_json(jsonb)',
 'public.static_weekly_assert_exact_object(jsonb,text[],text[],text)',
 'public.static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)',
 'public.static_weekly_capacity_accepted_slot(uuid,date,uuid)',
 'public.static_weekly_capacity_registered(jsonb)',
 'public.static_weekly_digest_jsonb(jsonb)','public.static_weekly_digest_text(text)',
 'public.static_weekly_v3_assert_string_array(jsonb,text,boolean,integer)',
 'public.static_weekly_v3_assert_window(jsonb,text)','public.static_weekly_v3_assert_text(jsonb,text,integer)'];
 wrapper_signatures text[]:=ARRAY[
 'public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)',
 'custodial_coverall.original_v8_materialize_lunch_document(uuid,jsonb,uuid)',
 'custodial_coverall.owner_revalidate_lunch_admission(uuid)',
 'custodial_coverall.require_lunch_admission_proof(uuid,jsonb)',
 'custodial_coverall.lunch_validator_fingerprint()',
 'public.static_weekly_reject_update_delete()','custodial_dr.guard_application_mutation()',
 'public.static_weekly_v27_notification_plan_source_write_fence()'];
 signature text;qualified_names text[];oid_value oid;definition text;definitions jsonb:='[]';wrappers jsonb:='[]';relations jsonb:='[]';
 relation text;crypto_schema text;crypto jsonb;metadata jsonb;
BEGIN
 SELECT array_agg(split_part(value,'(',1)) INTO qualified_names FROM unnest(signatures) value;
 FOREACH signature IN ARRAY signatures LOOP
  oid_value:=to_regprocedure(signature);IF oid_value IS NULL THEN RAISE EXCEPTION 'Complete full-lunch guard closure missing: %',signature USING ERRCODE='55000';END IF;
  definition:=pg_get_functiondef(oid_value);
  -- Changed definitions invalidate old proofs. New/unlisted nonbuilt-in guard
  -- callees or unsupported dynamic SQL refuse until this owning Source updates.
  IF EXISTS(SELECT 1 FROM regexp_matches(definition,'\m(public|custodial_coverall|extensions)\.([a-z_][a-z_0-9]*)[[:space:]]*\(','gi') m(parts)
   WHERE NOT(lower(m.parts[1]||'.'||m.parts[2])=ANY(qualified_names))) THEN
   RAISE EXCEPTION 'Unsupported changed full-lunch guard call closure: %',signature USING ERRCODE='55000';END IF;
  IF definition~*'\mexecute\M' AND signature<>'public.static_weekly_digest_text(text)' THEN RAISE EXCEPTION 'Unsupported dynamic full-lunch guard: %',signature USING ERRCODE='55000';END IF;
  IF signature='public.static_weekly_digest_text(text)' AND public.static_weekly_digest_text(definition)<>'5337ef6187e2febb0668f1350092fa49de3258317ae19537317a889900a0e1c3'
   THEN RAISE EXCEPTION 'Unsupported dynamic digest helper changed' USING ERRCODE='55000';END IF;
  SELECT jsonb_build_object('signature',signature,'oid',p.oid::text,'definition',definition,'owner',pg_get_userbyid(p.proowner),
   'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',to_jsonb(p.proconfig),'acl',p.proacl::text,'binary',p.probin,'source',p.prosrc) INTO metadata FROM pg_proc p WHERE p.oid=oid_value;
  definitions:=definitions||jsonb_build_array(metadata);
 END LOOP;
 FOREACH signature IN ARRAY wrapper_signatures LOOP
  oid_value:=to_regprocedure(signature);IF oid_value IS NULL THEN RAISE EXCEPTION 'Complete admission wrapper missing: %',signature USING ERRCODE='55000';END IF;
  SELECT jsonb_build_object('signature',signature,'oid',p.oid::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
   'securityDefiner',p.prosecdef,'config',to_jsonb(p.proconfig),'acl',p.proacl::text) INTO metadata FROM pg_proc p WHERE p.oid=oid_value;
  wrappers:=wrappers||jsonb_build_array(metadata);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['public.weekly_schedule_compiled_projections','public.weekly_schedule_lunch_documents','custodial_coverall.manual_lunch_admission_proofs'] LOOP
  oid_value:=to_regclass(relation);IF oid_value IS NULL THEN RAISE EXCEPTION 'Immutable admission relation missing';END IF;
  SELECT jsonb_build_object('relation',relation,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,
   'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid),x.convalidated) ORDER BY x.conname COLLATE "C") FROM pg_constraint x WHERE x.conrelid=c.oid),
   'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) INTO metadata FROM pg_class c WHERE c.oid=oid_value;
  relations:=relations||jsonb_build_array(metadata);
 END LOOP;
 SELECT n.nspname,jsonb_build_object('name',e.extname,'version',e.extversion,'namespace',n.nspname) INTO crypto_schema,crypto FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
 IF crypto_schema IS NULL OR crypto_schema NOT IN('extensions','public') THEN RAISE EXCEPTION 'Exact installed pgcrypto guard unavailable';END IF;
 oid_value:=to_regprocedure(format('%I.digest(bytea,text)',crypto_schema));IF oid_value IS NULL THEN RAISE EXCEPTION 'Actual SHA256 function unavailable';END IF;
 SELECT crypto||jsonb_build_object('oid',p.oid::text,'definition',pg_get_functiondef(p.oid),'source',p.prosrc,'binary',p.probin,'owner',pg_get_userbyid(p.proowner)) INTO crypto FROM pg_proc p WHERE p.oid=oid_value;
 RETURN public.static_weekly_digest_jsonb(jsonb_build_object('schema','custodial.full-lunch-validator-closure.v1','serverVersion',current_setting('server_version_num'),
  'guards',definitions,'admissionWrappers',wrappers,'immutableRelations',relations,'crypto',crypto));
END $fingerprint$;

CREATE FUNCTION custodial_coverall.require_lunch_admission_proof(p_projection uuid,p_document jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $require$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 proof custodial_coverall.manual_lunch_admission_proofs%rowtype;fingerprint text;
BEGIN
 IF p_projection IS NULL OR jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR coalesce(p_document->>'document_identity','')!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'Exact immutable admitted lunch document required' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection;
 fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 SELECT * INTO proof FROM custodial_coverall.manual_lunch_admission_proofs WHERE projection_id=p_projection
  AND document_identity=document.document_identity AND validator_fingerprint=fingerprint;
 IF NOT FOUND OR document.document_identity IS DISTINCT FROM p_document->>'document_identity'
  OR document.document_json IS DISTINCT FROM p_document OR proof.full_document_json IS DISTINCT FROM p_document
  OR proof.full_projection_json IS DISTINCT FROM to_jsonb(projection)
  THEN RAISE EXCEPTION 'Full lunch admission proof missing, stale, or source bytes changed; owner revalidation required' USING ERRCODE='55000';END IF;
 -- Snapshot digests are CHECK-constrained at admission; exact full JSONB source
 -- equality above binds these admitted hashes without repeating all-loan math.
END $require$;

CREATE FUNCTION custodial_coverall.owner_revalidate_lunch_admission(p_projection uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $backfill$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 proof custodial_coverall.manual_lunch_admission_proofs%rowtype;before_fingerprint text;after_fingerprint text;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR session_user NOT IN('postgres','supabase_admin')
  OR coalesce(current_setting('role',true),'none') NOT IN('none',session_user::text)
  THEN RAISE EXCEPTION 'Actual owning administrator must explicitly revalidate stored lunch' USING ERRCODE='42501';END IF;
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection FOR SHARE;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection FOR SHARE;
 before_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 -- Always REAL complete validation of the actual stored body, not caller data,
 -- a prepared label, GUC, cached boolean or success receipt. Historical rows stay.
 PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,document.document_json);
 after_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 IF after_fingerprint IS DISTINCT FROM before_fingerprint THEN RAISE EXCEPTION 'Lunch validator changed during full revalidation';END IF;
 INSERT INTO custodial_coverall.manual_lunch_admission_proofs(projection_id,document_identity,validator_fingerprint,projection_digest,document_digest,full_projection_json,full_document_json)
 VALUES(p_projection,document.document_identity,after_fingerprint,public.static_weekly_digest_jsonb(to_jsonb(projection)),
  public.static_weekly_digest_jsonb(document.document_json),to_jsonb(projection),document.document_json) ON CONFLICT DO NOTHING;
 PERFORM custodial_coverall.require_lunch_admission_proof(p_projection,document.document_json);
 SELECT * INTO STRICT proof FROM custodial_coverall.manual_lunch_admission_proofs WHERE projection_id=p_projection AND document_identity=document.document_identity AND validator_fingerprint=after_fingerprint;
 RETURN jsonb_build_object('schema','custodial.full-lunch-admission-proof.v1','projectionId',proof.projection_id,'documentIdentity',proof.document_identity,
  'validatorFingerprint',proof.validator_fingerprint,'projectionDigest',proof.projection_digest,'documentDigest',proof.document_digest,
  'validatedAt',proof.validated_at,'validationTransactionId',proof.validation_transaction::text,'scope','FULL_STORED_VALIDATION_ONLY_NOT_CURRENT_AUTHORITY_OR_DEVICE_DELIVERY');
END $backfill$;

CREATE OR REPLACE FUNCTION public.static_weekly_v8_materialize_lunch_document(p_projection_id uuid,p_document jsonb,p_manager_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $admit$
DECLARE result jsonb;projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 before_fingerprint text;after_fingerprint text;
BEGIN
 before_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 -- The private original is an exact whole-body clone. It retains real actor,
 -- current projection, restore/authority lock, complete v8 validator and insert
 -- constraints. This wrapper does not replace admission with a prior proof.
 result:=custodial_coverall.original_v8_materialize_lunch_document(p_projection_id,p_document,p_manager_id);
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection_id;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection_id;
 after_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 IF before_fingerprint IS DISTINCT FROM after_fingerprint OR document.document_json IS DISTINCT FROM p_document
  OR document.document_identity IS DISTINCT FROM p_document->>'document_identity'
  OR result->>'projection_id' IS DISTINCT FROM p_projection_id::text OR result->>'document_identity' IS DISTINCT FROM document.document_identity
  THEN RAISE EXCEPTION 'Actual same-transaction full lunch admission/store correspondence changed';END IF;
 INSERT INTO custodial_coverall.manual_lunch_admission_proofs(projection_id,document_identity,validator_fingerprint,projection_digest,document_digest,full_projection_json,full_document_json)
 VALUES(p_projection_id,document.document_identity,after_fingerprint,public.static_weekly_digest_jsonb(to_jsonb(projection)),
  public.static_weekly_digest_jsonb(document.document_json),to_jsonb(projection),document.document_json) ON CONFLICT DO NOTHING;
 PERFORM custodial_coverall.require_lunch_admission_proof(p_projection_id,p_document);
 RETURN result; -- Original receipt bytes/state/leases/delivery claims unchanged.
END $admit$;

DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_lunch_current_basis(uuid,text,text,date)'::regprocedure)) IS DISTINCT FROM 'cc2c41c4270f002296fe710d3fc1f87cf18752303b8e9772c28c53e71aba9a7d' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: static_weekly_manual_lunch_current_basis';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_manual_lunch_current_basis(p_source uuid, p_source_document text, p_notification_key text, p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 authority record;origin public.weekly_schedule_compiled_projections%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;
 prior_projection public.weekly_schedule_compiled_projections%rowtype;
 original_doc public.weekly_schedule_lunch_documents%rowtype;
 current_doc public.weekly_schedule_lunch_documents%rowtype;
 prior_doc public.weekly_schedule_lunch_documents%rowtype;
 original_intent jsonb;intent jsonb;original_loan jsonb;loan jsonb;retention jsonb;
 expected jsonb;actual jsonb;matches integer;visited uuid[]:='{}';hop integer:=0;
 current_id uuid;current_identity text;
BEGIN
 IF p_source IS NULL OR p_service_date IS NULL OR NOT isfinite(p_service_date)
  OR coalesce(p_source_document,'') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_notification_key,'') !~ '^[0-9a-f]{64}$' THEN RETURN NULL;END IF;
 SELECT * INTO authority FROM public.static_weekly_v6_schedule_authority_state(p_service_date);
 IF authority.governed IS NOT TRUE OR authority.projection_status IS DISTINCT FROM 'current'
  OR authority.projection_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_source;
 SELECT * INTO original_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_source;
 SELECT * INTO current_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=authority.projection_id;
 SELECT * INTO current_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=authority.projection_id;
 IF origin.projection_id IS NULL OR original_doc.projection_id IS NULL
  OR current_projection.projection_id IS NULL OR current_doc.projection_id IS NULL
  OR original_doc.document_identity IS DISTINCT FROM p_source_document
  OR origin.publication_id IS DISTINCT FROM authority.publication_id
  OR origin.version_id IS DISTINCT FROM authority.version_id
  OR origin.week_start IS DISTINCT FROM current_projection.week_start
  OR origin.week_end IS DISTINCT FROM current_projection.week_end
  OR p_service_date NOT BETWEEN origin.week_start AND origin.week_end THEN RETURN NULL;END IF;
 PERFORM custodial_coverall.require_lunch_admission_proof(origin.projection_id,original_doc.document_json);
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT n INTO original_intent FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT l INTO original_loan FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 current_id:=current_projection.projection_id;current_identity:=current_doc.document_identity;
 LOOP
  -- Fail closed after 128 immutable links or a cycle; never repair/reset a job.
  hop:=hop+1;
  IF hop>128 OR current_projection.projection_id=ANY(visited)
   OR current_projection.publication_id IS DISTINCT FROM origin.publication_id
   OR current_projection.version_id IS DISTINCT FROM origin.version_id
   OR current_projection.week_start IS DISTINCT FROM origin.week_start
   OR current_projection.week_end IS DISTINCT FROM origin.week_end
   OR current_doc.projection_id IS DISTINCT FROM current_projection.projection_id
   OR current_doc.document_identity IS DISTINCT FROM current_doc.document_json->>'document_identity'
   THEN RETURN NULL;END IF;
  visited:=array_append(visited,current_projection.projection_id);
  PERFORM custodial_coverall.require_lunch_admission_proof(current_projection.projection_id,current_doc.document_json);
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT n INTO intent FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF intent IS DISTINCT FROM original_intent THEN RETURN NULL;END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT l INTO loan FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF loan-'total_distance_minutes' IS DISTINCT FROM original_loan-'total_distance_minutes' THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'responsibilities') r WHERE r->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'responsibilities') r WHERE r->'loan_id'=loan->'loan_id';
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n WHERE n->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n WHERE n->'loan_id'=loan->'loan_id';
  IF actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  -- Original spoken owner/principal and original shift-end validity remain exact.
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO expected
   FROM jsonb_array_elements(origin.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=original_loan->>'normal_owner_slot_id' OR original_loan->'helper_slot_ids' ? (a->>'slotId'));
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO actual
   FROM jsonb_array_elements(current_projection.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=loan->>'normal_owner_slot_id' OR loan->'helper_slot_ids' ? (a->>'slotId'));
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  IF current_projection.projection_id=p_source THEN
   IF current_doc.document_identity IS DISTINCT FROM p_source_document THEN RETURN NULL;END IF;
   RETURN jsonb_build_object('source_projection_id',p_source,'source_document_identity',p_source_document,
    'current_projection_id',current_id,'current_document_identity',current_identity,'notification_key',p_notification_key);
  END IF;
  IF current_projection.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR current_projection.projection_envelope->'adapter' IS DISTINCT FROM
    '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
   THEN RETURN NULL;END IF;
  retention:=current_projection.projection_envelope#>'{authority,lunchIdentityRetention}';
  IF retention IS NULL THEN RETURN NULL;END IF;
  PERFORM public.static_weekly_assert_exact_object(retention,
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'notification immutable lunch lineage');
  IF retention->>'schema' IS DISTINCT FROM 'custodial.approved-manual-lunch-identity-retention.v1'
   OR retention->'requiresSqlOwnerCurrentnessCheck' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(retention->'loans') IS DISTINCT FROM 'array'
   OR coalesce(retention->>'priorDocumentIdentity','') !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM jsonb_array_elements(retention->'loans') r
    WHERE r=jsonb_build_object('serviceDate',p_service_date::text,'normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id'))<>1
   THEN RETURN NULL;END IF;
  SELECT * INTO prior_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=(retention->>'priorProjectionId')::uuid;
  SELECT * INTO prior_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=prior_projection.projection_id;
  IF prior_projection.projection_id IS NULL OR prior_doc.projection_id IS NULL
   OR prior_doc.document_identity IS DISTINCT FROM retention->>'priorDocumentIdentity' THEN RETURN NULL;END IF;
  current_projection:=prior_projection;current_doc:=prior_doc;
 END LOOP;
EXCEPTION WHEN data_exception OR check_violation OR cardinality_violation THEN RETURN NULL;
END $function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_enqueue_employee_lunch_coverage_pushes(timestamptz)'::regprocedure)) IS DISTINCT FROM 'ffcbc000d66492d0d3ddf886b68803b1236630d6cd24051be3030756f6b2f694' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: mz_enqueue_employee_lunch_coverage_pushes';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_lunch_coverage_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_authority record;
  v_document jsonb;
  v_inserted integer := 0;
  v_missing integer := 0;
  v_alerts integer := 0;
  v_job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  perform pg_advisory_xact_lock(hashtext('custodial-lunch-notifications'),hashtext(v_service_date::text));
  select * into strict v_authority
  from public.static_weekly_v6_schedule_authority_state(v_service_date);
  if not v_authority.governed or v_authority.projection_status is distinct from 'current' then
    return jsonb_build_object('ok',true,'enqueued',0,'missing_recipients',0,'manager_alerts',0,
      'skipped','no_current_governed_schedule','service_date',v_service_date);
  end if;

  select document_json into v_document
  from public.weekly_schedule_lunch_documents
  where projection_id=v_authority.projection_id;
  if v_document is null then
    raise exception using errcode='55000',message='current lunch coverage is unavailable; republish the weekly schedule';
  end if;

  -- Validate the exact current persisted document; never materialize a prepared draft.
  perform custodial_coverall.require_lunch_admission_proof(v_authority.projection_id,v_document);

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
      and n->>'event' in ('start','end')
      and n->>'delivery_state'='NOT_ENQUEUED'
  ), targets as materialized (
    select registration.credential_id,registration.employee_id,registration.device_id,
      registration.assignment_epoch,device.device_id device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), recipient_counts as materialized (
    select intent.employee_id,count(distinct target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    group by intent.employee_id
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':'||target.credential_id::text,
    'employee_native_push',v_authority.projection_id,intent.scheduled_at,
    jsonb_build_object(
      'credential_id',target.credential_id,'employee_id',target.employee_id,
      'device_id',target.device_id,'device_identifier',target.device_identifier,
      'assignment_epoch',target.assignment_epoch,
      'channel_id','employee-events',
      'title',case intent.n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',case intent.n->>'event'
        when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
        else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time',
        'scheduled_at',to_char(intent.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,
        'document_identity',v_document->>'document_identity',
        'route','employee-schedule.html?hub=employee'
      )
    )
  from intents intent
  join recipient_counts count_row on count_row.employee_id=intent.employee_id and count_row.recipient_count=1
  join targets target on target.employee_id=intent.employee_id
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
  ), targets as materialized (
    select registration.credential_id,registration.employee_id
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), unavailable as materialized (
    select intent.*,count(target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    where intent.scheduled_at<=p_now
    group by intent.n,intent.employee_id,intent.scheduled_at
    having count(target.credential_id)<>1
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,status,completed_at,last_error,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':recipient-unavailable',
    'employee_native_push',v_authority.projection_id,'dead',p_now,
    case when intent.recipient_count=0 then 'lunch_coverage_recipient_unavailable'
         else 'lunch_coverage_recipient_ambiguous' end,
    intent.scheduled_at,
    jsonb_build_object(
      'employee_id',intent.employee_id,'device_identifier','assigned custodial phone',
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time','coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,'document_identity',v_document->>'document_identity',
        'recipient_status',case when intent.recipient_count=0 then 'unavailable' else 'ambiguous' end,
        'route','employee-schedule.html?hub=employee'
      )
    )
  from unavailable intent
  on conflict(job_key) do nothing;
  get diagnostics v_missing=row_count;
  for v_job_id in
    select job_id from public.operational_notification_jobs
    where job_type='employee_native_push'
      and source_id=v_authority.projection_id
      and status='dead'
      and payload_json->'data_json'->>'kind'='employee_lunch_coverage'
      and payload_json->'data_json'->>'service_date'=v_service_date::text
      and payload_json->'data_json'->>'recipient_status' in ('unavailable','ambiguous')
      and available_at<=p_now
  loop
    v_alerts:=v_alerts+coalesce((public.ops_manager_enqueue_lunch_delivery_failure(v_job_id,p_now)->>'enqueued')::integer,0);
  end loop;

  return jsonb_build_object('ok',true,'service_date',v_service_date,
    'projection_id',v_authority.projection_id,'document_identity',v_document->>'document_identity',
    'enqueued',v_inserted,'missing_recipients',v_missing,'manager_alerts',v_alerts);
end
$function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_target_source_at(text,uuid,uuid,uuid,timestamptz)'::regprocedure)) IS DISTINCT FROM '37f92acda48420c6c6a99142e9ef110b505d714a7a0ae4162ecdb17eafe9f61b' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: custodial_native_target_source_at';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.custodial_native_target_source_at(p_kind text, p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
 v_now timestamptz:=p_at;
 v_generation public.employee_native_push_generations%rowtype;
 v_registration public.employee_push_registrations%rowtype;
 v_device public.devices%rowtype;
 v_credential public.device_auth_credentials%rowtype;
 v_employee public.employees%rowtype;
 v_job public.operational_notification_jobs%rowtype;
 v_message record;
 v_occurrence public.weekly_schedule_occurrences%rowtype;
 v_authority record;
 v_document public.weekly_schedule_lunch_documents%rowtype;
 v_intent jsonb;
 v_loan jsonb;
 v_responsibility jsonb;
 v_availability jsonb;
 v_service_date date;
 v_scheduled_at timestamptz;
 v_valid_until timestamptz;
 v_source jsonb;
 v_recipient jsonb;
 v_status text;
begin
 if p_kind is null or p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null
  or p_employee_id is null or p_generation_id is null or p_at is null or not isfinite(p_at) then
  raise exception using errcode='22023',message='exact native source kind, original key, employee and generation required';
 end if;
 select * into v_generation from public.employee_native_push_generations
  where generation_id=p_generation_id;
 if not found then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 select * into v_registration from public.employee_push_registrations
  where registration_id=v_generation.registration_id;
 select * into v_device from public.devices where id=v_generation.device_id;
 select * into v_credential from public.device_auth_credentials
  where credential_id=v_generation.credential_id;
 select * into v_employee from public.employees where id=p_employee_id;
 if v_generation.employee_id is distinct from p_employee_id
  or v_generation.dispatch_retired_at is not null or v_generation.revoked_at is not null
  or v_generation.activated_at>v_now or v_registration.registration_id is null
  or v_registration.active is not true or v_registration.revoked_at is not null
  or v_registration.device_id is distinct from v_generation.device_id
  or v_registration.credential_id is distinct from v_generation.credential_id
  or v_registration.employee_id is distinct from p_employee_id
  or v_registration.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_registration.token_hash is distinct from v_generation.token_digest
  or v_device.id is null or v_device.active is not true
  or v_device.device_id is distinct from v_generation.device_identifier
  or v_device.assigned_employee_id is distinct from p_employee_id
  or v_device.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_credential.credential_id is null or v_credential.device_id is distinct from v_device.id
  or v_credential.confirmed_at is null or v_credential.revoked_at is not null
  or v_credential.expires_at<=v_now or v_employee.id is null or v_employee.active is not true then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 v_recipient:=jsonb_build_object('employee_id',p_employee_id,'device_id',v_device.id,
  'device_identifier',v_device.device_id,'credential_id',v_credential.credential_id,
  'assignment_epoch',v_device.assignment_epoch,'generation_id',v_generation.generation_id,
  'principal_digest',v_generation.principal_digest,'token_digest',v_generation.token_digest);

 if p_kind='MESSAGE' then
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.job_key is distinct from 'employee-message-push:'||v_job.source_id::text||':'||v_credential.credential_id::text
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_message'
   or v_job.payload_json#>>'{data_json,message_id}' is distinct from v_job.source_id::text
   or v_job.payload_json#>>'{data_json,notification_key}' is distinct from 'message:'||v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   select m.id,m.thread_id,m.sender_user_id,m.sent_at,m.body,m.metadata_json,
    recipient.id recipient_user_id,r.acknowledged_at
    into v_message
   from public.msg_messages m
   join public.msg_threads t on t.id=m.thread_id and t.is_active is true
    and t.system_key is distinct from 'ops_manager_shared_chat_v1'
   join public.msg_thread_participants tp on tp.thread_id=m.thread_id and tp.left_at is null
   join public.msg_users recipient on recipient.id=tp.user_id and recipient.is_active is true
    and recipient.employee_id=p_employee_id
   join public.msg_receipts r on r.message_id=m.id and r.user_id=recipient.id
   where m.id=v_job.source_id and m.is_deleted is false and m.sender_user_id<>recipient.id
    and m.sent_at<=v_now
    and r.acknowledged_at is null
    and not exists(select 1 from public.msg_message_deletions md
      where md.message_id=m.id and md.user_id=recipient.id)
    and not exists(select 1 from public.msg_thread_visibility visibility
      where visibility.thread_id=m.thread_id and visibility.user_id=recipient.id
       and (visibility.device_identifier is null
         or upper(btrim(visibility.device_identifier))=upper(btrim(v_device.device_id)))
       and coalesce(m.sent_at,m.created_at)<=visibility.hidden_before);
   if not found or v_job.payload_json#>>'{data_json,thread_id}' is distinct from v_message.thread_id::text then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_recipient:=v_recipient||jsonb_build_object('msg_user_id',v_message.recipient_user_id);
    v_source:=jsonb_build_object('source_id',v_message.id,'source_revision',
     public.static_weekly_digest_jsonb(jsonb_build_object('message_id',v_message.id,
      'thread_id',v_message.thread_id,'sender_user_id',v_message.sender_user_id,
      'sent_at',v_message.sent_at,'body',v_message.body,'metadata_json',v_message.metadata_json,
      'recipient_user_id',v_message.recipient_user_id)),
     'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
     'job_status',v_job.status,'valid_from',v_message.sent_at,'valid_until',null);
   end if;
  end if;
 elsif p_kind='SCHEDULE' then
  select * into v_occurrence from public.weekly_schedule_occurrences
   where occurrence_id=p_source_key;
  if not found or v_occurrence.state is distinct from 'created' then
   v_status:='SOURCE_STALE';
  else
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_occurrence.service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.projection_id is distinct from v_occurrence.projection_id
    or v_authority.publication_id is distinct from v_occurrence.publication_id
    or v_authority.version_id is distinct from v_occurrence.version_id
    or (v_occurrence.owner_person_id_snapshot is distinct from p_employee_id
     and not exists(select 1 from public.static_weekly_v8_read_lunch_segments(v_occurrence.service_date) l
      where l.projection_id=v_authority.projection_id
       and l.normal_occurrence_id=v_occurrence.occurrence_id
       and l.normal_owner_id=v_occurrence.owner_person_id_snapshot
       and l.coverer_id=p_employee_id
       and l.coverage_start<=time '09:45' and l.coverage_end>=time '09:45'
       and l.coverage_start<l.coverage_end)) then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_source:=jsonb_build_object('source_id',v_occurrence.projection_id,
     'source_revision',v_authority.projection_authority_revision::text,
     'source_digest',v_occurrence.occurrence_digest,
     'publication_id',v_occurrence.publication_id,'version_id',v_occurrence.version_id,
     'service_date',v_occurrence.service_date,'assignment_occurrence_id',v_occurrence.occurrence_id,
     'delivery_occurrence_id',null,'delivery_key',null,
     'valid_from',null,'valid_until',null);
   end if;
  end if;
 else
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
   or v_job.payload_json#>>'{data_json,projection_id}' is distinct from v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   v_service_date:=(v_job.payload_json#>>'{data_json,service_date}')::date;
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or public.static_weekly_manual_lunch_current_basis(v_job.source_id,
     v_job.payload_json#>>'{data_json,document_identity}',v_job.payload_json#>>'{data_json,notification_key}',v_service_date) is null then
    v_status:='SOURCE_STALE';
   else
    select * into v_document from public.weekly_schedule_lunch_documents
     where projection_id=v_job.source_id;
    if not found or v_document.document_identity is distinct from v_job.payload_json#>>'{data_json,document_identity}' then
     v_status:='SOURCE_STALE';
    else
     perform custodial_coverall.require_lunch_admission_proof(v_document.projection_id,v_document.document_json);
     select value into v_intent from jsonb_array_elements(v_document.document_json->'notification_intents')
      where value->>'notification_key'=v_job.payload_json#>>'{data_json,notification_key}'
       and value->>'service_date'=v_service_date::text;
     select value into v_loan from jsonb_array_elements(v_document.document_json->'loans')
      where value->>'loan_id'=v_intent->>'loan_id' and value->>'status'='PLANNED';
     select value into v_responsibility from jsonb_array_elements(v_document.document_json->'responsibilities')
      where value->>'loan_id'=v_intent->>'loan_id'
       and value->>'coverer_slot_id'=v_intent->>'coverer_slot_id'
       and value->>'coverer_person_id'=p_employee_id::text;
     select value into v_availability
      from public.weekly_schedule_compiled_projections projection,
       jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
      where projection.projection_id=v_authority.projection_id
       and value->>'serviceDate'=v_service_date::text
       and value->>'slotId'=v_intent->>'coverer_slot_id'
       and value->>'incumbentPersonId'=p_employee_id::text
       and value->>'status'='working';
     if v_intent is null or v_loan is null or v_responsibility is null or v_availability is null
      or v_job.job_key is distinct from 'employee-lunch-push:'||(v_intent->>'notification_key')||':'||v_credential.credential_id::text
      or v_job.payload_json#>>'{data_json,event}' is distinct from v_intent->>'event'
      or v_job.payload_json#>>'{data_json,loan_id}' is distinct from v_intent->>'loan_id'
      or v_job.payload_json#>>'{data_json,coverer_slot_id}' is distinct from v_intent->>'coverer_slot_id'
      or v_job.payload_json#>>'{data_json,scheduled_time}' is distinct from v_intent->>'scheduled_time'
      or v_job.payload_json#>>'{data_json,notification_key}' is distinct from v_intent->>'notification_key'
      or v_job.payload_json#>>'{data_json,service_date}' is distinct from v_intent->>'service_date'
      or v_intent->>'event' not in ('start','end') then
      v_status:='SOURCE_STALE';
     else
      v_scheduled_at:=(v_service_date+(v_intent->>'scheduled_time')::time) at time zone 'America/Chicago';
      v_valid_until:=(v_service_date+(case when v_intent->>'event'='start'
       then v_loan->>'coverage_end' else v_availability#>>'{shift,end}' end)::time)
       at time zone 'America/Chicago';
      if v_valid_until is null or v_valid_until<=v_scheduled_at or v_now>=v_valid_until
       or public.sch_service_date(v_now) is distinct from v_service_date then
       v_status:='SOURCE_EXPIRED';
      else
       v_status:='CURRENT_SOURCE_ONLY';
       v_source:=jsonb_build_object('source_id',v_document.projection_id,
        'source_revision',v_authority.projection_authority_revision::text,
        'source_digest',v_document.document_identity,
        'notification_key',v_intent->>'notification_key',
        'loan_id',v_intent->>'loan_id','event',v_intent->>'event',
        'coverer_slot_id',v_intent->>'coverer_slot_id',
        'service_date',v_service_date,
        'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
        'job_status',v_job.status,'valid_from',v_scheduled_at,'valid_until',v_valid_until);
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('schema','custodial.native-target-source.v1',
  'kind',p_kind,'source_key',p_source_key,'status',v_status,
  'delivery_admitted',false,'recipient',case when v_source is null then null else v_recipient end,
  'source',v_source);
end $function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '59ae64a1a55284bd5348e2ec7fb6cb607f39123d30cba7969ef9f75d17b2fcf1' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: static_weekly_v27_notification_plan_at';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_notification_plan_at(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_intent uuid, p_target_digest text, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 at_time timestamptz:=p_at; delivery jsonb; target jsonb; a record;
 doc public.weekly_schedule_lunch_documents%rowtype; projection public.weekly_schedule_compiled_projections%rowtype;
 device public.devices%rowtype; person public.employees%rowtype; roster public.daily_work_roster%rowtype;
 n jsonb; loan jsonb; mapped jsonb; availability jsonb; candidate record; item jsonb;
 all_intents jsonb:='[]'; effects jsonb:='[]'; audio jsonb:='[]';
 expected jsonb; body jsonb; wire text; notification_state jsonb;
 scheduled timestamptz; ends_at timestamptz; expires timestamptz; boundary timestamptz;
 matches integer; total_intents integer:=0; total_locations integer:=0;
 role_name text; override_enabled boolean; silent boolean; reason text; kind text;
begin
 if at_time is null or not isfinite(at_time) or p_date is null or p_date is distinct from public.sch_service_date(at_time)
  or p_intent is null or coalesce(p_target_digest,'')!~'^[a-f0-9]{64}$'
  or p_epoch is null or p_epoch<1 or p_epoch>9007199254740991 then
  raise exception 'exact current recurring notification plan principal required' using errcode='22023';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict device from public.devices where id=p_device;
 select * into strict person from public.employees where id=p_employee and active=true;
 if not exists(select 1 from public.device_auth_credentials c where c.credential_id=p_credential and c.device_id=p_device
  and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>at_time) then
  raise exception 'current notification plan credential expired' using errcode='42501';end if;
 delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
 target:=delivery->'target';
 if delivery->>'intentId' is distinct from p_intent::text or delivery->>'targetDigest' is distinct from p_target_digest
  or target->>'serviceDate' is distinct from p_date::text then
  raise exception 'recurring notification plan target superseded' using errcode='40001';end if;
 expires:=((p_date+1)::timestamp+make_interval(hours=>public.get_setting_int('operational_day_start_hour',4))) at time zone 'America/Chicago';
 select * into strict a from public.static_weekly_v6_schedule_authority_state(p_date);
 if target->>'targetType'='BLOCKED_RECURRING_AUTHORITY' then
  if a.projection_status is distinct from 'blocked_recurring_authority' then
   raise exception 'terminal notification plan authority differs' using errcode='40001';end if;
  kind:='AUTHENTICATED_BLOCKED_TARGET';
 elsif target->>'targetType'='SCHEDULE' then
  if a.projection_status is distinct from 'current' or a.projection_id::text is distinct from target->>'projectionId'
   or a.publication_id::text is distinct from target->>'publicationId'
   or a.projection_authority_revision::text is distinct from target->>'authorityRevision' then
   raise exception 'notification plan accepted authority differs' using errcode='40001';end if;
  select * into strict doc from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
  select * into strict projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
  if doc.document_identity is distinct from target->>'lunchDocumentIdentity' then
   raise exception 'notification plan lunch companion differs' using errcode='23514';end if;
  if jsonb_array_length(doc.document_json->'notification_intents')>16384
   or jsonb_array_length(doc.document_json->'responsibilities')>16384 then
   raise exception 'complete notification plan source bound exceeded' using errcode='54000';end if;
  perform custodial_coverall.require_lunch_admission_proof(doc.projection_id,doc.document_json);
  -- Exactly the normal device notification shift/override policy. A mapping
  -- role is observed from the same active normal device-user source, not from
  -- caller metadata or an inferred employee label.
  select lower(coalesce(mu.role,'')) into role_name from public.msg_device_assignments mda
   join public.msg_users mu on mu.id=mda.msg_user_id
   where mda.device_identifier=device.device_id and mda.is_active=true and mu.is_active=true
   order by mda.updated_at desc nulls last,mda.created_at desc nulls last limit 1;
  select * into roster from public.daily_work_roster r where r.service_date=p_date and r.employee_id=p_employee and r.active=true
   order by r.updated_at desc nulls last,r.created_at desc nulls last limit 1;
  select coalesce(setting_value='true'::jsonb,false) into override_enabled from public.system_settings
   where setting_key='off_shift_employee_notifications_override_enabled';
  override_enabled:=coalesce(override_enabled,false);
  if coalesce(role_name,'') in ('manager','bot','ops','ops_manager','operations_manager') then silent:=false;reason:='not_employee_device';
  elsif override_enabled then silent:=false;reason:='admin_overtime_override_enabled';
  elsif roster.id is null then silent:=true;reason:='no_active_roster_shift';
  elsif roster.shift_start is null or roster.shift_end is null then silent:=true;reason:='invalid_roster_shift_window';
  elsif (at_time at time zone 'America/Chicago') < p_date+roster.shift_start then silent:=true;reason:='scheduled_shift_not_started';
  elsif (at_time at time zone 'America/Chicago') >= p_date+roster.shift_end then silent:=true;reason:='scheduled_shift_ended';
  else silent:=false;reason:='on_shift';end if;
  notification_state:=jsonb_build_object('notifications_silent',silent,'silent_reason',reason,'override_enabled',override_enabled);
  foreach boundary in array array[(p_date+roster.shift_start) at time zone 'America/Chicago',(p_date+roster.shift_end) at time zone 'America/Chicago'] loop
   if boundary>at_time then expires:=least(expires,boundary);end if;
  end loop;
  -- Validate the whole accepted document before selecting this recipient. No
  -- truncated page or pre-existing job list can hide a required accepted intent.
  for n in select ni.value from jsonb_array_elements(doc.document_json->'notification_intents') ni(value)
   where ni.value->>'service_date'=p_date::text and exists(
    select 1 from jsonb_array_elements(doc.document_json->'responsibilities') rr(value)
     where rr.value->>'loan_id'=ni.value->>'loan_id' and rr.value->>'coverer_slot_id'=ni.value->>'coverer_slot_id'
      and rr.value->>'coverer_person_id'=p_employee::text)
   order by ni.value->>'scheduled_time',ni.value->>'notification_key' loop
   total_intents:=total_intents+1;if total_intents>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   select value into strict loan from jsonb_array_elements(doc.document_json->'loans') value
    where value->>'loan_id'=n->>'loan_id' and value->>'status'='PLANNED';
   select count(*) into matches from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   if matches<>1 then raise exception 'notification plan recipient availability ambiguous' using errcode='23514';end if;
   select value into strict availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   scheduled:=(p_date+(n->>'scheduled_time')::time) at time zone 'America/Chicago';
   ends_at:=(p_date+(case when n->>'event'='start' then loan->>'coverage_end' else availability#>>'{shift,end}' end)::time) at time zone 'America/Chicago';
   if ends_at is null or ends_at<=scheduled or n->>'event' not in ('start','end') then
    raise exception 'notification plan accepted interval unsupported' using errcode='23514';end if;
   if scheduled>at_time then expires:=least(expires,scheduled);end if;
   if ends_at>at_time then expires:=least(expires,ends_at);end if;
   all_intents:=all_intents||jsonb_build_array(jsonb_build_object('intent',n,'valid_from',public.custodial_native_location_utc(scheduled),
    'valid_until',public.custodial_native_location_utc(ends_at)));
   if not silent and scheduled<=at_time and at_time<ends_at and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=n->>'notification_key' and ack.credential_id=p_credential and ack.assignment_epoch=p_epoch
     and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_lunch_coverage','notification_type','lunch_coverage',
     'notification_key',n->>'notification_key','service_date',p_date,'loan_id',n->>'loan_id','event',n->>'event',
     'scheduled_time',n->>'scheduled_time','scheduled_at',public.custodial_native_location_utc(scheduled),
     'valid_until',public.custodial_native_location_utc(ends_at),'coverer_slot_id',n->>'coverer_slot_id',
     'projection_id',a.projection_id,'document_identity',doc.document_identity,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text,
     'route','employee-schedule.html?hub=employee');
    item:=jsonb_build_object('origin','FULL_ACCEPTED_LUNCH_DOCUMENT','notification_key',n->>'notification_key',
     'notification',jsonb_build_object('title',case n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',public.custodial_native_lunch_spoken_body(a.projection_id,doc.document_identity,n->>'loan_id',p_employee,n->>'event'),
      'data',expected),'required_audio',true);
    effects:=effects||jsonb_build_array(item);audio:=audio||jsonb_build_array(n->>'notification_key');
   end if;
  end loop;
  -- The same normal operational assignment + cycle source as the reminder
  -- route, but exhaustive for this exact employee/current accepted projection.
  -- No LIMIT: overflow refuses the WHOLE observation instead of empty/subset.
  for candidate in
   select distinct on (assignment.location_id) assignment.*,cycle.notification_key as cycle_key,
    cycle.status_code,cycle.due_soon_at,cycle.overdue_at
   from public.custodial_operational_location_assignments(p_date) assignment
   left join public.mz_location_reminder_candidates(p_date,at_time) cycle on cycle.location_id=assignment.location_id
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and assignment.coverage_start <= (at_time at time zone 'America/Chicago')::time
    and (at_time at time zone 'America/Chicago')::time < assignment.coverage_end
   order by assignment.location_id,assignment.coverage_start,assignment.group_name,assignment.group_code loop
   total_locations:=total_locations+1;if total_locations>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   boundary:=(p_date+candidate.coverage_end) at time zone 'America/Chicago';if boundary>at_time then expires:=least(expires,boundary);end if;
   if candidate.due_soon_at>at_time then expires:=least(expires,candidate.due_soon_at);end if;
   if candidate.overdue_at>at_time then expires:=least(expires,candidate.overdue_at);end if;
   if not silent and candidate.status_code in ('due_soon','overdue') and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=candidate.cycle_key||':projection:'||a.projection_id::text and ack.credential_id=p_credential
     and ack.assignment_epoch=p_epoch and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_location_status','notification_type','location_status',
     'notification_key',candidate.cycle_key||':projection:'||a.projection_id::text,'service_date',p_date,
     'device_id',device.device_id,'employee_id',p_employee,'employee_name',person.display_name,
     'projection_id',a.projection_id,'publication_id',a.publication_id,'schedule_authority_revision',a.projection_authority_revision::text,
     'location_id',candidate.location_id,'location_code',candidate.location_code,'location_name',candidate.location_name,
     'group_code',candidate.group_code,'group_name',candidate.group_name,'form_type',candidate.form_type,'status_code',candidate.status_code,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text);
    effects:=effects||jsonb_build_array(jsonb_build_object('origin','EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES',
     'notification_key',expected->>'notification_key','data',expected,'required_audio',true));
    audio:=audio||jsonb_build_array(expected->>'notification_key');
   end if;
  end loop;
  -- The ordinary candidate function omits not-yet-due rows. Sample the SAME
  -- underlying verified normal cycle for expiry only, so empty coverage cannot
  -- cross a first due threshold or the existing five-minute overdue repeat.
  select min(b.x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   join public.v_location_dashboard_status status on status.location_id=assignment.location_id
   cross join lateral public.mz_verified_location_reminder_cycle(status.location_id,status.form_type,status.latest_completed_at,
    public.mz_latest_verified_check(status.location_id,status.operational_day_start,at_time),at_time) cycle
   cross join lateral (values (cycle.due_soon_at),(cycle.overdue_at),
    (case when cycle.overdue_at<=at_time then cycle.overdue_at+make_interval(secs=>((cycle.repeat_index+1)*300)::double precision) else null end)) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and status.latest_completed_at>=status.operational_day_start and b.x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  -- Include ALL future normal assignment boundaries, including locations not
  -- active in the loop above. Otherwise a currently-empty plan could outlive
  -- the next accepted work window and pretend no future transition exists.
  select min(x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   cross join lateral (values ((p_date+assignment.coverage_start) at time zone 'America/Chicago'),
    ((p_date+assignment.coverage_end) at time zone 'America/Chicago')) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id and x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  kind:='FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION';
 else raise exception 'unsupported recurring notification plan target' using errcode='22023';end if;
 if expires<=at_time or jsonb_array_length(effects)>1024 then raise exception 'complete notification plan time/bound unsupported' using errcode='54000';end if;
 body:=jsonb_build_object('schema','custodial.recurring-current-notification-plan.v1','complete',true,'receipt_eligible',false,
  'scope','CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY',
  'source',kind,'service_date',p_date,'intent_id',p_intent,'target_digest',p_target_digest,'target',target,
  'rendered_digest',case when target->>'targetType'='SCHEDULE' then target->>'viewDigest' else p_target_digest end,
  'device_pk',p_device,'canonical_device_id',device.device_id,'employee_id',p_employee,'credential_id',p_credential,'assignment_epoch',p_epoch::text,
  'observed_at',public.custodial_native_location_utc(at_time),'valid_until',public.custodial_native_location_utc(expires),
  'notification_state',coalesce(notification_state,jsonb_build_object('notifications_silent',true,'silent_reason','blocked_recurring_authority','override_enabled',false)),
  'accepted_lunch_intents',all_intents,'required_effects',effects,'required_audio',audio,
  'source_counts',jsonb_build_object('accepted_lunch_intents',total_intents,'current_assigned_locations',total_locations));
 -- EMPTY/BLOCKED v1 stays byte-contract compatible. Nonempty v2 MUST carry
 -- an explicit original-binding state; missing history is never empty proof.
 if jsonb_array_length(effects)>0 then
  body:=body||jsonb_build_object('schema','custodial.recurring-current-notification-plan.v2',
   'delivery_bindings',public.static_weekly_v27_original_native_bindings(body,at_time));
  if body#>>'{delivery_bindings,state}'='ORIGINAL_NATIVE_RESERVATIONS' then
   select min((value->>'valid_until')::timestamptz) into boundary
    from jsonb_array_elements(body#>'{delivery_bindings,entries}');
   expires:=least(expires,boundary);
   body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(expires)));
  end if;
 end if;
 wire:=body::text;if octet_length(wire)>196608 then raise exception 'complete notification plan byte bound exceeded' using errcode='54000';end if;
 return jsonb_build_object('schema',case body->>'schema' when 'custodial.recurring-current-notification-plan.v2' then 'custodial.recurring-current-notification-plan-envelope.v2' else 'custodial.recurring-current-notification-plan-envelope.v1' end,'body',body,
  'bodyJsonText',wire,'bodyDigest',public.static_weekly_digest_text(wire));
end $function$
;
DO $private_owners$ DECLARE item record;BEGIN
 FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_coverall' AND p.proname=ANY(ARRAY['original_v8_materialize_lunch_document','lunch_validator_fingerprint','require_lunch_admission_proof','owner_revalidate_lunch_admission']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',item.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',item.signature);
 END LOOP;
END $private_owners$;
-- Existing public materializer + consumer owner/ACL remain unchanged by CREATE
-- OR REPLACE; private original/proof functions gain no public/runtime grants.
-- Post-admission native reader only: use the existing immutable certificate
-- created by real full v8 admission. Currentness and exact returned views stay
-- in the unchanged public reader; missing/stale native proofs fail closed.
DO $native_lunch_reader_proof_dispatch$
DECLARE target oid:='public.static_weekly_v8_read_lunch_document(date)'::regprocedure;
 proof_reader oid:='custodial_coverall.require_lunch_admission_proof(uuid,jsonb)'::regprocedure;
 before_metadata jsonb;after_metadata jsonb;original_definition text;next_definition text;
 old_assertion text:=$old_lunch_assertion$ perform public.static_weekly_v8_assert_lunch_document(stored.projection_id,stored.document_json);$old_lunch_assertion$;
 native_dispatch text:=$native_lunch_dispatch$ -- Native-manual documents were fully admitted by the exact real v8
 -- materializer before their immutable proof was appended. Require that exact
 -- current-validator/full-projection/full-document certificate here; never
 -- substitute a prepared label, missing proof or caller-controlled flag.
 if exists(select 1 from public.weekly_schedule_compiled_projections projection
  where projection.projection_id=stored.projection_id
   and projection.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1') then
  perform custodial_coverall.require_lunch_admission_proof(stored.projection_id,stored.document_json);
 else
  -- Historical/non-native generic readers retain the original full validator.
  perform public.static_weekly_v8_assert_lunch_document(stored.projection_id,stored.document_json);
 end if;$native_lunch_dispatch$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
  OR (SELECT proowner FROM pg_proc WHERE oid=proof_reader) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained public/private lunch reader owner required';END IF;
 original_definition:=pg_get_functiondef(target);
 IF public.static_weekly_digest_text(original_definition) IS DISTINCT FROM '8e19ebff428a4883e35acd09d50986228f6efea9b12ade4450da0c53aeb327d0'
  OR (SELECT public.static_weekly_digest_text(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'b39a01240618becb9e8b3c35eb910096daa651cef7166c1ac02317284c9508a9'
  OR (length(original_definition)-length(replace(original_definition,old_assertion,'')))/length(old_assertion)<>1
 THEN RAISE EXCEPTION 'Exact original generic lunch reader differs; reconcile changed source before proceeding';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE p.oid=target;
 next_definition:=replace(original_definition,old_assertion,native_dispatch);
 IF public.static_weekly_digest_text(next_definition) IS DISTINCT FROM 'b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15'
 THEN RAISE EXCEPTION 'Exact native proof dispatch substitution differs';END IF;
 EXECUTE next_definition;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata
  OR public.static_weekly_digest_text(pg_get_functiondef(target)) IS DISTINCT FROM 'b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15'
 THEN RAISE EXCEPTION 'Generic lunch reader identity/owner/ACL/attributes or exact successor differs';END IF;
END $native_lunch_reader_proof_dispatch$;
COMMIT;
