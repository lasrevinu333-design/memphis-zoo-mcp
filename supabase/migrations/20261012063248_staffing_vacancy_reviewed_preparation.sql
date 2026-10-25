-- Main normal CLI-created 63248; isolated source265 after immutable event264.
-- Exact first reviewed candidate retention. UNSUBMITTED is not work acceptance.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE vacancy_review_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE vacancy_review_surface_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ BEGIN
 IF to_regclass('public.static_weekly_vacancy_reviewed_preparations') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('static_weekly_vacancy_reviewed_packet',
     'static_weekly_vacancy_reviewed_current','static_weekly_vacancy_reviewed_descriptor',
     'static_weekly_vacancy_reviewed_input','static_weekly_vacancy_reviewed_guard',
     'static_weekly_stage_vacancy_reviewed_preparation','static_weekly_read_vacancy_reviewed_preparation',
     'static_weekly_consume_vacancy_reviewed_preparation'))
  OR EXISTS(SELECT 1 FROM vacancy_review_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR (SELECT count(*) FROM vacancy_review_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    AND definition_sql=(SELECT definition FROM vacancy_review_surface_before))<>1
 THEN RAISE EXCEPTION 'Vacancy reviewed preparation exact recovery predecessor changed';END IF;
END $predecessor$;

CREATE TABLE public.static_weekly_vacancy_reviewed_preparations (
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL,
 credential_id uuid NOT NULL REFERENCES public.ops_manager_trusted_devices(credential_id) ON DELETE RESTRICT,
 device_identifier text NOT NULL,
 generation bigint NOT NULL,
 state text NOT NULL DEFAULT 'UNSUBMITTED',
 packet_utf8 text NOT NULL,
 payload_sha256 text NOT NULL,
 preview_digest text NOT NULL,
 worker_candidate_digest text NOT NULL,
 staged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 consumed_at timestamptz,
 accepted_witness jsonb,
 accepted_witness_sha256 text,
 CONSTRAINT static_weekly_vacancy_reviewed_preparations_pkey PRIMARY KEY(manager_id,idempotency_key),
 CONSTRAINT vacancy_review_key CHECK(length(idempotency_key) BETWEEN 1 AND 200
   AND idempotency_key=btrim(idempotency_key) AND idempotency_key !~ '[[:cntrl:]]'),
 CONSTRAINT vacancy_review_device CHECK(length(device_identifier) BETWEEN 1 AND 200
   AND device_identifier=btrim(device_identifier) AND device_identifier !~ '[[:cntrl:]]'),
 CONSTRAINT vacancy_review_generation CHECK(generation BETWEEN 0 AND 9007199254740991),
 CONSTRAINT vacancy_review_packet CHECK(octet_length(convert_to(packet_utf8,'UTF8')) BETWEEN 1 AND 67108864
   AND payload_sha256=public.static_weekly_digest_text(packet_utf8)),
 CONSTRAINT vacancy_review_digests CHECK(payload_sha256~'^[0-9a-f]{64}$'
   AND preview_digest~'^[0-9a-f]{64}$' AND worker_candidate_digest~'^[0-9a-f]{64}$'),
 CONSTRAINT vacancy_review_terminal CHECK((state='UNSUBMITTED' AND consumed_at IS NULL
   AND accepted_witness IS NULL AND accepted_witness_sha256 IS NULL)
   OR (state='CONSUMED' AND consumed_at IS NOT NULL AND accepted_witness IS NOT NULL
     AND accepted_witness_sha256 IS NOT NULL AND jsonb_typeof(accepted_witness)='object'
     AND accepted_witness_sha256=public.static_weekly_digest_jsonb(accepted_witness)))
);
ALTER TABLE public.static_weekly_vacancy_reviewed_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.static_weekly_vacancy_reviewed_preparations FORCE ROW LEVEL SECURITY;
DO $table_acl$ DECLARE role_name text;BEGIN
 FOREACH role_name IN ARRAY ARRAY['public','postgres','anon','authenticated','service_role',
  'static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader','static_weekly_runtime_20260823'] LOOP
  IF role_name='public' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('revoke all on table public.static_weekly_vacancy_reviewed_preparations from %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public.static_weekly_vacancy_reviewed_preparations'::regclass AND a.grantee<>c.relowner)
 THEN RAISE EXCEPTION 'Vacancy private table has an unexpected default grantee';END IF;
END $table_acl$;

-- Exact normal CP helper323 shape, not registered recurring-source shape.
CREATE FUNCTION public.static_weekly_vacancy_reviewed_input(p_source jsonb,p_week date)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE raw jsonb:=p_source->'compiler_input';BEGIN
 IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR jsonb_typeof(raw->'version') IS DISTINCT FROM 'object'
  OR jsonb_typeof(raw->'slots') IS DISTINCT FROM 'array' OR jsonb_typeof(raw->'proximity') IS DISTINCT FROM 'array'
  OR (p_source ? 'exceptions' AND jsonb_typeof(p_source->'exceptions') IS DISTINCT FROM 'array')
  OR p_week IS NULL OR NOT isfinite(p_week) THEN RAISE EXCEPTION 'Vacancy normal compiler source unavailable';END IF;
 RETURN jsonb_build_object('serviceDate',p_week::text,
  'timezone',coalesce(nullif(raw->>'timezone',''),'America/Chicago'),'slots',raw->'slots',
  'proximity',raw->'proximity','exceptions',coalesce(p_source->'exceptions','[]'::jsonb),'versions',jsonb_build_array(raw->'version'));
END $fn$;

-- Validate transport integrity/closed storage grammar, not compiler acceptance.
-- Only the CP may stage; normal materializer must still validate ALL proofs.
CREATE FUNCTION public.static_weekly_vacancy_reviewed_packet(p_utf8 text,p_manager uuid,p_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE packet jsonb;v jsonb;p jsonb;canonical jsonb;binding jsonb;field text;BEGIN
 IF p_utf8 IS NULL OR octet_length(convert_to(p_utf8,'UTF8')) NOT BETWEEN 1 AND 67108864
  OR p_manager IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_key<>btrim(p_key)
  OR p_key~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Vacancy reviewed preparation exact key/packet required';END IF;
 packet:=p_utf8::jsonb;
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' OR packet->>'schema' IS DISTINCT FROM 'custodial.vacancy-reviewed-preparation.v1'
  OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(packet) key) IS DISTINCT FROM
   ARRAY['postInputUtf8','preInputUtf8','preparedProjectionUtf8','previewCanonicalUtf8','previewUtf8','reason','schema']
 THEN RAISE EXCEPTION 'Vacancy reviewed preparation closed packet required';END IF;
 FOREACH field IN ARRAY ARRAY['preInputUtf8','postInputUtf8','preparedProjectionUtf8','previewCanonicalUtf8','previewUtf8'] LOOP
  IF jsonb_typeof(packet->field) IS DISTINCT FROM 'string'
   OR octet_length(convert_to(packet->>field,'UTF8')) NOT BETWEEN 1 AND 16777216
   OR jsonb_typeof((packet->>field)::jsonb) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Vacancy reviewed preparation exact raw JSON text required';END IF;
 END LOOP;
 PERFORM public.static_weekly_v3_assert_text(packet->'reason','vacancy reason',500);
 IF packet->>'reason'<>btrim(packet->>'reason') THEN RAISE EXCEPTION 'Vacancy normalized original reason required';END IF;
 v:=(packet->>'previewUtf8')::jsonb;p:=(packet->>'preparedProjectionUtf8')::jsonb;
 canonical:=(packet->>'previewCanonicalUtf8')::jsonb;
 IF v->>'schema' IS DISTINCT FROM 'custodial.stable-vacancy-preview.v1'
  OR v->>'managerId' IS DISTINCT FROM p_manager::text OR v->>'idempotencyKey' IS DISTINCT FROM p_key
  OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key) IS DISTINCT FROM
   ARRAY['accepted','currentSourceDigest','effectiveStart','employeeId','expectedRevision','idempotencyKey','managerId','managerName',
    'persisted','phoneUpdated','preview','previewDigest','projectionExpectedRevision','projectionIdempotencyKey','publicationId',
    'reasonDigest','registeredSourceDigest','resultingRevision','schema','slotId','sourceId','weekStart','workerCandidateDigest']
  OR v->'accepted' IS DISTINCT FROM 'false'::jsonb OR v->'persisted' IS DISTINCT FROM 'false'::jsonb
  OR v->'phoneUpdated' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(v->'preview') IS DISTINCT FROM 'object'
  OR jsonb_typeof(v->'expectedRevision') IS DISTINCT FROM 'number' OR v->>'expectedRevision' !~ '^(0|[1-9][0-9]*)$'
  OR (v->>'expectedRevision')::numeric>9007199254740989
 THEN RAISE EXCEPTION 'Vacancy complete unaccepted preview required';END IF;
 FOREACH field IN ARRAY ARRAY['sourceId','slotId','employeeId','publicationId'] LOOP
  PERFORM public.static_weekly_v3_assert_uuid(v->field,'vacancy original identity');
 END LOOP;
 FOREACH field IN ARRAY ARRAY['previewDigest','workerCandidateDigest','reasonDigest','registeredSourceDigest','currentSourceDigest'] LOOP
  IF jsonb_typeof(v->field) IS DISTINCT FROM 'string' OR v->>field !~ '^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'Vacancy original digest required';END IF;
 END LOOP;
 IF v->>'reasonDigest' IS DISTINCT FROM public.static_weekly_digest_text(packet->>'reason')
  OR jsonb_typeof(v->'effectiveStart') IS DISTINCT FROM 'string' OR v->>'effectiveStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(v->'weekStart') IS DISTINCT FROM 'string' OR v->>'weekStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR (v->>'weekStart')::date IS DISTINCT FROM (v->>'effectiveStart')::date-(extract(isodow FROM (v->>'effectiveStart')::date)::integer-1)
  OR v->'projectionExpectedRevision' IS DISTINCT FROM to_jsonb((v->>'expectedRevision')::bigint+1)
  OR v->'resultingRevision' IS DISTINCT FROM to_jsonb((v->>'expectedRevision')::bigint+2)
  OR v->>'projectionIdempotencyKey' IS DISTINCT FROM 'projection-'||public.static_weekly_digest_text(p_key)
  OR NOT(p ?& ARRAY['publicationId','serviceDate','exceptionSetDigest','compilerVersion','objective','metrics','replayDigest',
    'envelope','expectedRevision','actorManagerId','actorManagerName','idempotencyKey','lunchDocument'])
  OR p-ARRAY['publicationId','serviceDate','exceptionSetDigest','compilerVersion','objective','metrics','replayDigest',
    'envelope','expectedRevision','actorManagerId','actorManagerName','idempotencyKey','lunchDocument','openingCoverageReport']<>'{}'::jsonb
  OR p->>'publicationId' IS DISTINCT FROM v->>'publicationId' OR p->>'serviceDate' IS DISTINCT FROM v->>'weekStart'
  OR p->'expectedRevision' IS DISTINCT FROM v->'projectionExpectedRevision'
  OR p->>'actorManagerId' IS DISTINCT FROM p_manager::text OR p->'actorManagerName' IS DISTINCT FROM v->'managerName'
  OR p->'idempotencyKey' IS DISTINCT FROM v->'projectionIdempotencyKey'
  OR jsonb_typeof(p->'envelope') IS DISTINCT FROM 'object' OR p->'envelope' ? 'attestation'
  OR jsonb_typeof(p->'lunchDocument') IS DISTINCT FROM 'object'
  OR v->>'workerCandidateDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p-'actorManagerName'-'openingCoverageReport')
 THEN RAISE EXCEPTION 'Vacancy full prepared candidate binding changed';END IF;
 binding:=jsonb_build_object('managerId',v->'managerId','sourceId',v->'sourceId','slotId',v->'slotId','employeeId',v->'employeeId',
  'effectiveStart',v->'effectiveStart','weekStart',v->'weekStart','expectedRevision',v->'expectedRevision','idempotencyKey',v->'idempotencyKey',
  'reasonDigest',v->'reasonDigest','registeredSourceDigest',v->'registeredSourceDigest','currentSourceDigest',v->'currentSourceDigest','publicationId',v->'publicationId');
 IF canonical IS DISTINCT FROM jsonb_build_object('schema','custodial.stable-vacancy-preview.v1','binding',binding,'projection',p)
  OR public.static_weekly_digest_text(packet->>'previewCanonicalUtf8') IS DISTINCT FROM v->>'previewDigest'
 THEN RAISE EXCEPTION 'Vacancy full original preview bytes/digest changed';END IF;
 RETURN packet;
END $fn$;

CREATE FUNCTION public.static_weekly_vacancy_reviewed_current(
 r public.static_weekly_vacancy_reviewed_preparations,p_generation bigint,p_actor_name text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE packet jsonb;v jsonb;snapshot jsonb;original_source jsonb;current_source jsonb;published jsonb;week date;BEGIN
 IF r.state<>'UNSUBMITTED' OR r.generation IS DISTINCT FROM p_generation THEN RETURN false;END IF;
 packet:=public.static_weekly_vacancy_reviewed_packet(r.packet_utf8,r.manager_id,r.idempotency_key);
 IF public.static_weekly_digest_text(r.packet_utf8) IS DISTINCT FROM r.payload_sha256 THEN
  RAISE EXCEPTION 'Vacancy original stored checksum changed';END IF;
 v:=(packet->>'previewUtf8')::jsonb;week:=(v->>'weekStart')::date;
 IF v->>'managerName' IS DISTINCT FROM p_actor_name
  OR (v->>'effectiveStart')::date IS DISTINCT FROM public.sch_service_date(statement_timestamp()) THEN RETURN false;END IF;
 snapshot:=public.static_weekly_v3_read_manager_snapshot(week);
 IF snapshot->'authority_revision' IS DISTINCT FROM v->'expectedRevision'
  OR snapshot#>>'{current_publication,publication_id}' IS DISTINCT FROM v->>'publicationId'
 THEN RETURN false;END IF;
 SELECT jsonb_build_object('compiler_input',canonical_source) INTO original_source
  FROM public.static_weekly_authority_source_documents WHERE source_id=(v->>'sourceId')::uuid
   AND active IS TRUE AND retired_at IS NULL AND source_digest=public.static_weekly_digest_jsonb(canonical_source) FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 current_source:=public.static_weekly_v3_read_authority_source((v->>'sourceId')::uuid,week);
 published:=public.static_weekly_v3_read_publication_source((v->>'publicationId')::uuid,week);
 RETURN coalesce(v->>'registeredSourceDigest'=public.static_weekly_digest_jsonb(original_source->'compiler_input')
  AND v->>'currentSourceDigest'=public.static_weekly_digest_jsonb(current_source->'compiler_input')
  AND (packet->>'preInputUtf8')::jsonb=public.static_weekly_vacancy_reviewed_input(published,week),false);
END $fn$;

CREATE FUNCTION public.static_weekly_vacancy_reviewed_descriptor(
 r public.static_weekly_vacancy_reviewed_preparations,p_current boolean,p_replayed boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
DECLARE v jsonb;BEGIN
 v:=(public.static_weekly_vacancy_reviewed_packet(r.packet_utf8,r.manager_id,r.idempotency_key)->>'previewUtf8')::jsonb;
 IF public.static_weekly_digest_text(r.packet_utf8) IS DISTINCT FROM r.payload_sha256
  OR v->>'previewDigest' IS DISTINCT FROM r.preview_digest
  OR v->>'workerCandidateDigest' IS DISTINCT FROM r.worker_candidate_digest
 THEN RAISE EXCEPTION 'Vacancy private reviewed preparation checksum changed';END IF;
 RETURN jsonb_build_object('found',true,'state',r.state,'current',p_current,'replayed',p_replayed,
  'preview_digest',r.preview_digest,'worker_candidate_digest',r.worker_candidate_digest,
  'generation',r.generation,'staged_at',to_char(r.staged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'packet_utf8',r.packet_utf8,'payload_sha256',r.payload_sha256);
END $fn$;

CREATE FUNCTION public.static_weekly_vacancy_reviewed_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF tg_op='DELETE' OR current_setting('app.static_weekly_vacancy_preparation_write',true) IS DISTINCT FROM 'consume'
  OR old.state<>'UNSUBMITTED' OR new.state<>'CONSUMED'
  OR to_jsonb(new)-ARRAY['state','consumed_at','accepted_witness','accepted_witness_sha256'] IS DISTINCT FROM
   to_jsonb(old)-ARRAY['state','consumed_at','accepted_witness','accepted_witness_sha256']
 THEN RAISE EXCEPTION 'Vacancy original reviewed preparation is immutable';END IF;
 RETURN new;
END $fn$;
CREATE TRIGGER trg_static_weekly_vacancy_reviewed_guard BEFORE UPDATE OR DELETE
 ON public.static_weekly_vacancy_reviewed_preparations FOR EACH ROW
 EXECUTE FUNCTION public.static_weekly_vacancy_reviewed_guard();
ALTER TABLE public.static_weekly_vacancy_reviewed_preparations ENABLE ALWAYS TRIGGER trg_static_weekly_vacancy_reviewed_guard;

CREATE FUNCTION public.static_weekly_stage_vacancy_reviewed_preparation(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_key text,p_packet_utf8 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;generation bigint;packet jsonb;v jsonb;r public.static_weekly_vacancy_reviewed_preparations%rowtype;
 prior public.static_weekly_vacancy_reviewed_preparations%rowtype;BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();generation:=public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 packet:=public.static_weekly_vacancy_reviewed_packet(p_packet_utf8,p_manager,p_key);v:=(packet->>'previewUtf8')::jsonb;
 SELECT * INTO prior FROM public.static_weekly_vacancy_reviewed_preparations WHERE manager_id=p_manager AND idempotency_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF prior.credential_id IS DISTINCT FROM p_credential OR prior.device_identifier IS DISTINCT FROM p_device
   OR prior.packet_utf8 IS DISTINCT FROM p_packet_utf8 OR prior.payload_sha256 IS DISTINCT FROM public.static_weekly_digest_text(p_packet_utf8)
   OR public.static_weekly_vacancy_reviewed_current(prior,generation,actor->>'manager_name') IS NOT TRUE
  THEN RAISE EXCEPTION USING errcode='23505',message='Original vacancy review key is occupied or no longer current';END IF;
  RETURN public.static_weekly_vacancy_reviewed_descriptor(prior,true,true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_schedule_command_receipts WHERE actor_manager_id=p_manager
   AND idempotency_key IN(p_key,'projection-'||public.static_weekly_digest_text(p_key))) THEN
  RAISE EXCEPTION 'Vacancy preview cannot adopt an existing original mutation';END IF;
 r.manager_id:=p_manager;r.idempotency_key:=p_key;r.credential_id:=p_credential;r.device_identifier:=p_device;
 r.generation:=generation;r.state:='UNSUBMITTED';r.packet_utf8:=p_packet_utf8;
 r.payload_sha256:=public.static_weekly_digest_text(p_packet_utf8);r.preview_digest:=v->>'previewDigest';
 r.worker_candidate_digest:=v->>'workerCandidateDigest';r.staged_at:=clock_timestamp();
 IF public.static_weekly_vacancy_reviewed_current(r,generation,actor->>'manager_name') IS NOT TRUE THEN
  RAISE EXCEPTION USING errcode='40001',message='Vacancy original source/revision/current actor changed';END IF;
 INSERT INTO public.static_weekly_vacancy_reviewed_preparations SELECT r.*;
 RETURN public.static_weekly_vacancy_reviewed_descriptor(r,true,false);
END $fn$;

CREATE FUNCTION public.static_weekly_read_vacancy_reviewed_preparation(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;generation bigint;r public.static_weekly_vacancy_reviewed_preparations%rowtype;BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();generation:=public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_key<>btrim(p_key) OR p_key~'[[:cntrl:]]'
 THEN RAISE EXCEPTION 'Vacancy exact original read key required';END IF;
 SELECT * INTO r FROM public.static_weekly_vacancy_reviewed_preparations WHERE manager_id=p_manager AND idempotency_key=p_key FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false);END IF;
 IF r.credential_id IS DISTINCT FROM p_credential OR r.device_identifier IS DISTINCT FROM p_device THEN
  RAISE EXCEPTION USING errcode='42501',message='Vacancy original private review actor mismatch';END IF;
 RETURN public.static_weekly_vacancy_reviewed_descriptor(r,
  public.static_weekly_vacancy_reviewed_current(r,generation,actor->>'manager_name'),true);
END $fn$;

CREATE FUNCTION public.static_weekly_consume_vacancy_reviewed_preparation(
 p_manager uuid,p_credential uuid,p_device text,p_access text,p_key text,p_preview_digest text,p_post_input_utf8 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;generation bigint;r public.static_weekly_vacancy_reviewed_preparations%rowtype;
 packet jsonb;v jsonb;p jsonb;completed jsonb;mutation public.weekly_schedule_command_receipts%rowtype;
 projection public.weekly_schedule_command_receipts%rowtype;mutation_xid bigint;projection_xid bigint;BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();generation:=public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 SELECT * INTO r FROM public.static_weekly_vacancy_reviewed_preparations WHERE manager_id=p_manager AND idempotency_key=p_key FOR UPDATE;
 IF NOT FOUND OR r.credential_id IS DISTINCT FROM p_credential OR r.device_identifier IS DISTINCT FROM p_device
  OR r.generation IS DISTINCT FROM generation OR r.preview_digest IS DISTINCT FROM p_preview_digest
 THEN RAISE EXCEPTION 'Vacancy original retained preparation/actor/generation/digest required';END IF;
 packet:=public.static_weekly_vacancy_reviewed_packet(r.packet_utf8,p_manager,p_key);
 v:=(packet->>'previewUtf8')::jsonb;p:=(packet->>'preparedProjectionUtf8')::jsonb;
 IF public.static_weekly_digest_text(r.packet_utf8) IS DISTINCT FROM r.payload_sha256
  OR p_post_input_utf8 IS NULL OR octet_length(convert_to(p_post_input_utf8,'UTF8')) NOT BETWEEN 1 AND 16777216
  OR p_post_input_utf8::jsonb IS DISTINCT FROM (packet->>'postInputUtf8')::jsonb THEN
  RAISE EXCEPTION 'Vacancy actual post-mutation full compiler input changed';END IF;
 -- Normal source263 fixed read validates immutable mutation/projection/lunch,
 -- original actor/revisions, closed server attestation and actual owning HMAC.
 -- No staged parent, caller Boolean or a future/current selector is acceptance.
 completed:=public.static_weekly_read_original_staffing_outcome_v1(p_manager,p_key,'vacate_roster_slot');
 IF completed->>'schema' IS DISTINCT FROM 'custodial.original-staffing-outcome.v1'
  OR completed->>'state' IS DISTINCT FROM 'ACCEPTED_ORIGINAL'
  OR completed#>>'{original_request,operation}' IS DISTINCT FROM 'vacate_roster_slot'
  OR completed#>>'{original_request,source_id}' IS DISTINCT FROM v->>'sourceId'
  OR completed#>>'{original_request,slot_id}' IS DISTINCT FROM v->>'slotId'
  OR completed#>>'{original_request,employee_id}' IS DISTINCT FROM v->>'employeeId'
  OR completed#>>'{original_request,effective_start}' IS DISTINCT FROM v->>'effectiveStart'
  OR completed#>>'{original_request,reason}' IS DISTINCT FROM packet->>'reason'
  OR completed#>>'{receipt,data,worker_candidate_digest}' IS DISTINCT FROM r.worker_candidate_digest
  OR completed#>>'{receipt,data,paired_lunch_document_identity}' IS DISTINCT FROM p#>>'{lunchDocument,document_identity}'
 THEN RAISE EXCEPTION 'Vacancy exact accepted original candidate witness required';END IF;
 SELECT * INTO mutation FROM public.weekly_schedule_command_receipts WHERE actor_manager_id=p_manager AND idempotency_key=p_key
  AND command_type='vacate_roster_slot';
 SELECT * INTO projection FROM public.weekly_schedule_command_receipts WHERE actor_manager_id=p_manager
  AND idempotency_key='projection-'||public.static_weekly_digest_text(p_key) AND command_type='materialize_projection';
 IF mutation.command_id IS NULL OR projection.command_id IS NULL
  OR mutation.expected_revision IS DISTINCT FROM (v->>'expectedRevision')::bigint
  OR projection.expected_revision IS DISTINCT FROM mutation.expected_revision+1
  OR projection.request_canonical_json->>'publication_id' IS DISTINCT FROM v->>'publicationId'
  OR (projection.response_json->>'revision')::bigint IS DISTINCT FROM (v->>'resultingRevision')::bigint
 THEN RAISE EXCEPTION 'Vacancy accepted original revision/publication witness changed';END IF;
 IF r.state='CONSUMED' THEN
  IF r.accepted_witness IS DISTINCT FROM completed OR r.accepted_witness_sha256 IS DISTINCT FROM public.static_weekly_digest_jsonb(completed)
  THEN RAISE EXCEPTION 'Vacancy original consumed witness changed';END IF;
  RETURN public.static_weekly_vacancy_reviewed_descriptor(r,false,true);
 END IF;
 -- Normal writers insert both immutable receipts directly in this same outer
 -- transaction. A later transaction cannot manufacture initial consumption.
 SELECT xmin::text::bigint INTO mutation_xid FROM public.weekly_schedule_command_receipts WHERE command_id=mutation.command_id;
 SELECT xmin::text::bigint INTO projection_xid FROM public.weekly_schedule_command_receipts WHERE command_id=projection.command_id;
 IF mutation_xid IS DISTINCT FROM mod(txid_current(),4294967296)
  OR projection_xid IS DISTINCT FROM mod(txid_current(),4294967296)
  OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) IS DISTINCT FROM (v->>'resultingRevision')::bigint
 THEN RAISE EXCEPTION 'Vacancy consume requires this same accepted authority transaction';END IF;
 PERFORM set_config('app.static_weekly_vacancy_preparation_write','consume',true);
 UPDATE public.static_weekly_vacancy_reviewed_preparations SET state='CONSUMED',consumed_at=clock_timestamp(),
  accepted_witness=completed,accepted_witness_sha256=public.static_weekly_digest_jsonb(completed)
  WHERE manager_id=p_manager AND idempotency_key=p_key AND state='UNSUBMITTED' RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vacancy original reviewed consumption conflicted';END IF;
 PERFORM set_config('app.static_weekly_vacancy_preparation_write','',true);
 RETURN public.static_weekly_vacancy_reviewed_descriptor(r,false,false);
END $fn$;

-- Precise existing NOLOGIN capability only. No new role or table/sequence grant.
DO $functions_acl$ DECLARE target text;role_name text;BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.static_weekly_vacancy_reviewed_input(jsonb,date)',
  'public.static_weekly_vacancy_reviewed_packet(text,uuid,text)',
  'public.static_weekly_vacancy_reviewed_current(public.static_weekly_vacancy_reviewed_preparations,bigint,text)',
  'public.static_weekly_vacancy_reviewed_descriptor(public.static_weekly_vacancy_reviewed_preparations,boolean,boolean)',
  'public.static_weekly_vacancy_reviewed_guard()',
  'public.static_weekly_stage_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text)',
  'public.static_weekly_read_vacancy_reviewed_preparation(uuid,uuid,text,text,text)',
  'public.static_weekly_consume_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text,text)'] LOOP
  FOREACH role_name IN ARRAY ARRAY['public','postgres','anon','authenticated','service_role','static_weekly_control_plane',
   'static_weekly_release_operator','custodial_application_reader','static_weekly_runtime_20260823'] LOOP
   IF role_name='public' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('revoke all on function %s from %I',target,role_name);
   END IF;
  END LOOP;
  IF target LIKE 'public.static_weekly_stage_vacancy%' OR target LIKE 'public.static_weekly_read_vacancy%'
   OR target LIKE 'public.static_weekly_consume_vacancy%' THEN
   EXECUTE format('grant execute on function %s to static_weekly_control_plane',target);
  END IF;
 END LOOP;
END $functions_acl$;

-- Recovery/canary registration follows below; every newly declared object is
-- captured ONLY from this migration's fresh table/routines, never other drift.
CREATE TEMP TABLE vacancy_review_new_objects(
 bucket integer NOT NULL,priority integer NOT NULL,kind text NOT NULL,identity text NOT NULL,definition text NOT NULL,
 PRIMARY KEY(kind,identity)
) ON COMMIT DROP;
INSERT INTO vacancy_review_new_objects
 SELECT 1000,0,'relation','public.static_weekly_vacancy_reviewed_preparations',
  public.custodial_release_authority_current_relation_definition('public.static_weekly_vacancy_reviewed_preparations')
 UNION ALL SELECT 300000,0,'column_set','public.static_weekly_vacancy_reviewed_preparations',
  public.custodial_release_authority_current_column_set_definition('public.static_weekly_vacancy_reviewed_preparations')
 UNION ALL SELECT 400000,0,'relation_state','public.static_weekly_vacancy_reviewed_preparations',
  public.custodial_release_authority_current_relation_state_definition('public.static_weekly_vacancy_reviewed_preparations')
 UNION ALL SELECT 900000,0,'grant','public.static_weekly_vacancy_reviewed_preparations',
  public.custodial_release_authority_current_grant_definition('public.static_weekly_vacancy_reviewed_preparations');
INSERT INTO vacancy_review_new_objects
 SELECT 200000,a.attnum,'column','public.static_weekly_vacancy_reviewed_preparations:'||a.attname,
  public.custodial_release_authority_current_column_definition('public.static_weekly_vacancy_reviewed_preparations:'||a.attname)
 FROM pg_attribute a WHERE a.attrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass AND a.attnum>0 AND NOT a.attisdropped;
INSERT INTO vacancy_review_new_objects
 SELECT 500000,0,'constraint','public.static_weekly_vacancy_reviewed_preparations:'||c.conname,
  public.custodial_release_authority_current_constraint_definition('public.static_weekly_vacancy_reviewed_preparations:'||c.conname)
 FROM pg_constraint c WHERE c.conrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass;
INSERT INTO vacancy_review_new_objects
 SELECT 600000,0,'index','public.'||quote_ident(c.relname),
  public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass
  AND NOT EXISTS(SELECT 1 FROM pg_constraint own_constraint WHERE own_constraint.conindid=i.indexrelid);
-- The PK's owned index is restored by its constraint, never separately DROPped.
INSERT INTO vacancy_review_new_objects
 SELECT 700000,0,'trigger','public.static_weekly_vacancy_reviewed_preparations.'||t.tgname,
  'drop trigger if exists '||quote_ident(t.tgname)||' on public.static_weekly_vacancy_reviewed_preparations; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table public.static_weekly_vacancy_reviewed_preparations '
   ||CASE t.tgenabled WHEN 'A' THEN 'enable always' WHEN 'O' THEN 'enable' ELSE 'invalid' END
   ||' trigger '||quote_ident(t.tgname)||';'
 FROM pg_trigger t WHERE t.tgrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass AND NOT t.tgisinternal;
-- Existing grant/reset helpers eagerly parse a relation identity first. Avoid
-- a second schema dot INSIDE a composite argument without changing its type.
-- Both actual resolvers must select exactly the same declared public routine.
DO $composite_identity$ BEGIN
 IF to_regtype('static_weekly_vacancy_reviewed_preparations') IS DISTINCT FROM
    'public.static_weekly_vacancy_reviewed_preparations'::regtype
  OR 'public.static_weekly_vacancy_reviewed_current(static_weekly_vacancy_reviewed_preparations,bigint,text)'::regprocedure IS DISTINCT FROM
    'public.static_weekly_vacancy_reviewed_current(public.static_weekly_vacancy_reviewed_preparations,bigint,text)'::regprocedure
  OR 'public.static_weekly_vacancy_reviewed_descriptor(static_weekly_vacancy_reviewed_preparations,boolean,boolean)'::regprocedure IS DISTINCT FROM
    'public.static_weekly_vacancy_reviewed_descriptor(public.static_weekly_vacancy_reviewed_preparations,boolean,boolean)'::regprocedure
  OR to_regclass('public.static_weekly_vacancy_reviewed_current(static_weekly_vacancy_reviewed_preparations,bigint,text)') IS NOT NULL
  OR to_regclass('public.static_weekly_vacancy_reviewed_descriptor(static_weekly_vacancy_reviewed_preparations,boolean,boolean)') IS NOT NULL
 THEN RAISE EXCEPTION 'Vacancy composite recovery identity does not resolve to the exact public source type/routine';END IF;
END $composite_identity$;
INSERT INTO vacancy_review_new_objects
 WITH f AS(SELECT identity,identity::regprocedure oid FROM unnest(ARRAY[
  'public.static_weekly_vacancy_reviewed_input(jsonb,date)',
  'public.static_weekly_vacancy_reviewed_packet(text,uuid,text)',
  'public.static_weekly_vacancy_reviewed_current(static_weekly_vacancy_reviewed_preparations,bigint,text)',
  'public.static_weekly_vacancy_reviewed_descriptor(static_weekly_vacancy_reviewed_preparations,boolean,boolean)',
  'public.static_weekly_vacancy_reviewed_guard()',
  'public.static_weekly_stage_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text)',
  'public.static_weekly_read_vacancy_reviewed_preparation(uuid,uuid,text,text,text)',
  'public.static_weekly_consume_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text,text)']) identity)
 SELECT 100000,0,'function',identity,pg_get_functiondef(oid) FROM f
 UNION ALL SELECT 900000,1,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) FROM f;

DO $new_scope$ DECLARE owner_oid oid;BEGIN
 SELECT relowner INTO STRICT owner_oid FROM pg_class WHERE oid='public.static_weekly_vacancy_reviewed_preparations'::regclass;
 IF owner_oid IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid='public.static_weekly_staffing_commands'::regclass)
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN vacancy_review_new_objects o
    ON CASE WHEN o.kind='function' THEN to_regprocedure(o.identity) END=p.oid
    WHERE p.proowner<>owner_oid)
  OR EXISTS(SELECT 1 FROM vacancy_review_new_objects n JOIN vacancy_review_inventory_before old
    ON old.object_kind=n.kind AND old.object_identity=n.identity)
  OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() old JOIN vacancy_review_new_objects n
    ON old.object_kind=n.kind AND old.object_identity=n.identity)
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass)
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass
    AND attnum>0 AND attacl IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass
    AND NOT tgisinternal AND tgenabled NOT IN('A','O'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.static_weekly_vacancy_reviewed_preparations'::regclass
    AND tgname='trg_static_weekly_vacancy_reviewed_guard' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM vacancy_review_new_objects o JOIN pg_proc p
    ON CASE WHEN o.kind='function' THEN to_regprocedure(o.identity) END=p.oid
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner AND
     (r.rolname IS DISTINCT FROM 'static_weekly_control_plane' OR a.is_grantable
      OR o.identity NOT IN('public.static_weekly_stage_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text)',
       'public.static_weekly_read_vacancy_reviewed_preparation(uuid,uuid,text,text,text)',
       'public.static_weekly_consume_vacancy_reviewed_preparation(uuid,uuid,text,text,text,text,text)')))
 THEN RAISE EXCEPTION 'Vacancy reviewed preparation new source/ACL scope changed';END IF;
END $new_scope$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $capture$ DECLARE o record;next_order integer;surface regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
 before text;after text;additions text:='';changed integer;BEGIN
 FOR o IN SELECT * FROM vacancy_review_new_objects ORDER BY bucket,priority,kind,identity LOOP
  SELECT coalesce(max(restore_order),o.bucket-1)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory
   WHERE restore_order BETWEEN o.bucket AND o.bucket+99999;
  IF next_order>=o.bucket+100000 THEN RAISE EXCEPTION 'Vacancy reviewed source recovery bucket exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,o.kind,o.identity,o.definition,public.static_weekly_digest_text(o.definition));
  additions:=additions||format(E'    (%L,%L,%L),\n',o.kind,o.identity,'exact source265 private vacancy reviewed preparation');
 END LOOP;
 SELECT definition INTO STRICT before FROM vacancy_review_surface_before;
 IF (length(before)-length(replace(before,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'Vacancy reviewed canary VALUES predecessor changed';END IF;
 after:=replace(before,'  values',E'  values\n'||additions);EXECUTE after;
 IF pg_get_functiondef(surface) IS DISTINCT FROM after
  OR (SELECT proowner FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT proowner FROM vacancy_review_surface_before)
  OR (SELECT proacl FROM pg_proc WHERE oid=surface) IS DISTINCT FROM (SELECT proacl FROM vacancy_review_surface_before)
 THEN RAISE EXCEPTION 'Vacancy reviewed canary owner/ACL/source changed';END IF;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=after,
  definition_sha256=public.static_weekly_digest_text(after),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=surface
   AND definition_sql=before AND definition_sha256=public.static_weekly_digest_text(before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Vacancy reviewed exact canary recovery row changed';END IF;
END $capture$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $final$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)
    <>(SELECT count(*) FROM vacancy_review_inventory_before)+(SELECT count(*) FROM vacancy_review_new_objects)
  OR EXISTS(SELECT old.* FROM vacancy_review_inventory_before old WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now
    WHERE NOT(now.object_kind='function' AND now.object_identity LIKE '%(%'
      AND to_regprocedure(now.object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
     AND NOT EXISTS(SELECT 1 FROM vacancy_review_new_objects n WHERE n.kind=now.object_kind AND n.identity=now.object_identity)
    EXCEPT SELECT * FROM vacancy_review_inventory_before)
  OR EXISTS(SELECT 1 FROM vacancy_review_new_objects n LEFT JOIN public.custodial_release_authority_restore_inventory i
    ON i.object_kind=n.kind AND i.object_identity=n.identity
    WHERE i.inventory_id IS NULL OR i.definition_sql IS DISTINCT FROM n.definition
      OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(n.definition))
  OR EXISTS(SELECT 1 FROM vacancy_review_new_objects n WHERE (SELECT count(*) FROM public.custodial_release_canary_authority_surface() s
    WHERE s.object_kind=n.kind AND s.object_identity=n.identity)<>1)
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Vacancy reviewed unrelated recovery membership or final ALWAYS guard changed';END IF;
END $final$;
COMMIT;
