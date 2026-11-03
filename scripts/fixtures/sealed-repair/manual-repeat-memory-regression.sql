-- ROOT-OWNED ISOLATED FIXTURE ONLY, after the guarded lifetime proposal.
-- Sequential full-output digest witnesses; never two full documents in DO locals.
-- All fixture objects and pure negative probes roll back. No writer replay.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
CREATE TEMP TABLE repeat_lifetime_source(source_id uuid,publication_id uuid,frame date,revision bigint,source_digest text,snapshot_digest text) ON COMMIT DROP;
CREATE TEMP TABLE repeat_lifetime_witness(label text PRIMARY KEY,full_output_digest text,bytes integer,assignments integer,loans integer) ON COMMIT DROP;
DO $clone$
DECLARE original text:=$original$CREATE OR REPLACE FUNCTION public.static_weekly_manual_repeat_components(p_source uuid, p_frame date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE origin date;snapshot text;projection jsonb;lunch jsonb;rows jsonb;availability jsonb;
 loans jsonb;responsibilities jsonb;intents jsonb;loan_keys jsonb;authority jsonb;input jsonb;overlay_input jsonb;
 authority_digest text;input_digest text;replay_digest text;source_projection text;source_lunch text;
BEGIN
 SELECT b.effective_start,b.snapshot_digest,b.feasibility#>'{initialBaseline,projection}',b.feasibility->'lunchDocument'
  INTO STRICT origin,snapshot,projection,lunch FROM public.static_weekly_approved_initial_baselines b WHERE source_id=p_source;
 IF p_frame IS NULL OR NOT isfinite(p_frame) OR p_frame<=origin OR mod(p_frame-origin,7)<>0
  OR projection->>'week_start' IS DISTINCT FROM origin::text OR lunch->>'week_start' IS DISTINCT FROM origin::text
  OR jsonb_array_length(projection->'assignments')<>346 OR jsonb_array_length(lunch->'loans')<>40
  OR projection#>>'{authority,compilerInput,version,manualGroupRatingAuthority,manifestSha256}' IS DISTINCT FROM 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
 THEN RAISE EXCEPTION 'Exact later publication-aligned normal period required'; END IF;
 source_projection:=projection->>'database_projection_identity';source_lunch:=lunch->>'document_identity';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'assignments') r WHERE
  (r->>'service_date')::date<>origin+mod((r->>'day_of_week')::integer-extract(dow FROM origin)::integer+7,7)
  OR r->>'status'<>'assigned') THEN RAISE EXCEPTION 'Original normal assignment dates/status differ'; END IF;
 SELECT jsonb_agg(r||jsonb_build_object('service_date',d::text,
  'owner_digest',public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',r->'plan_work_id','slotId',r->'owner_slot_id','personId',r->'owner_person_id','serviceDate',d::text)),
  'exact_owner_identity',public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',r->'plan_work_id','service_date',d::text,
   'optimized_owner_slot_id',r->'owner_slot_id','optimized_owner_person_id',r->'owner_person_id',
   'baseline_owner_slot_id',r->'baseline_owner_slot_id','baseline_owner_person_id',r->'baseline_owner_person_id'))) ORDER BY n) INTO rows
 FROM jsonb_array_elements(projection->'assignments') WITH ORDINALITY x(r,n)
 CROSS JOIN LATERAL(SELECT p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7) d) dates;
 SELECT jsonb_agg(r||jsonb_build_object('serviceDate',(p_frame+mod((r->>'dayOfWeek')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO availability FROM jsonb_array_elements(projection#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n);
 input:=jsonb_set(projection#>'{authority,compilerInput}','{serviceDate}',to_jsonb(p_frame::text),false);
 overlay_input:=jsonb_set(projection#>'{authority,overlayCompilerInput}','{serviceDate}',to_jsonb(p_frame::text),false);
 input_digest:=public.static_weekly_digest_jsonb(overlay_input);
 -- EXACT existing manual/native lunch key language (canonical JSON, no spaces).
 SELECT jsonb_object_agg(r->>'loan_id',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'policy','owner-20260921-two-nearby-full-hour-v1','input',input_digest,
  'serviceDate',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text,
  'ownerSlotId',r->'normal_owner_slot_id','start',r->'coverage_start','end',r->'coverage_end')))) INTO loan_keys
 FROM jsonb_array_elements(lunch->'loans') r;
 SELECT jsonb_agg(r||jsonb_build_object('loan_id',loan_keys->>(r->>'loan_id'),
  'service_date',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO loans FROM jsonb_array_elements(lunch->'loans') WITH ORDINALITY x(r,n);
 SELECT jsonb_agg(r||jsonb_build_object('responsibility_id',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'loanId',loan_keys->>(r->>'loan_id'),'areaId',physical_area.area_id,'covererSlotId',r->'coverer_slot_id'))),
  'loan_id',loan_keys->>(r->>'loan_id'),
  'service_date',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO responsibilities FROM jsonb_array_elements(lunch->'responsibilities') WITH ORDINALITY x(r,n)
 CROSS JOIN LATERAL(SELECT public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_agg(jsonb_build_object(
  'work',segment->'planWorkId','start',extract(epoch FROM (segment#>>'{normalWindow,start}')::time)::integer/60,
  'end',extract(epoch FROM (segment#>>'{normalWindow,end}')::time)::integer/60) ORDER BY segment->>'planWorkId' COLLATE "C"))) area_id
 FROM jsonb_array_elements(r->'segments') seg(segment)) physical_area;
 SELECT jsonb_agg(r||jsonb_build_object('notification_key',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'loanId',loan_keys->>(r->>'loan_id'),'slot',r->'coverer_slot_id','event',r->'event'))),
  'loan_id',loan_keys->>(r->>'loan_id'),'service_date',((r->>'service_date')::date+(p_frame-origin))::text) ORDER BY n)
 INTO intents FROM jsonb_array_elements(lunch->'notification_intents') WITH ORDINALITY x(r,n);
 authority:=((projection->'authority')-ARRAY['lunchIdentityRetention','derivedBaselineDigest','basisDigest','witnessDigest','shiftEndDerivation','mapping'])||jsonb_build_object('effectiveDate',p_frame::text,'compilerInput',input,'overlayCompilerInput',overlay_input,
  'projectionAvailability',availability,'inputDigest',input_digest,'overlayInputDigest',input_digest,'baselineInputDigest',public.static_weekly_digest_jsonb(input),
  'repeatReference',jsonb_build_object('schema','custodial.approved-manual-fixed-period-reference.v1','sourceId',p_source,
   'origin',origin::text,'frameStart',p_frame::text,'baselineSnapshotDigest',snapshot,'originalProjectionIdentity',source_projection,
   'originalLunchIdentity',source_lunch,'originalFixedEvidence',jsonb_build_object('derivedBaselineDigest',projection#>'{authority,derivedBaselineDigest}','basisDigest',projection#>'{authority,basisDigest}','witnessDigest',projection#>'{authority,witnessDigest}','shiftEndDerivation',projection#>'{authority,shiftEndDerivation}','mapping',projection#>'{authority,mapping}'),'witnessMeaning','UNCHANGED_ADMITTED_PATTERN_TRANSLATED_BY_WHOLE_SEVEN_DAY_PERIODS'));
 authority_digest:=public.static_weekly_digest_jsonb(authority);
 -- The exact native replay is bound AFTER the complete fresh lunch body below.
 replay_digest:=NULL;
 projection:=projection-'database_projection_identity';
 projection:=projection||jsonb_build_object('adapter',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-adapter.v1','version','approved-manual-repeat-v1'),
  'service_date',p_frame::text,'week_start',p_frame::text,'week_end',(p_frame+6)::text,'authority',authority,'authority_digest',authority_digest,
  'compiler_version','approved-manual-repeat-v1','replay_digest',replay_digest,'assignments',rows,'applied_exceptions','[]'::jsonb,
  'receipt',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-data.v1','baselineSnapshotDigest',snapshot,
   'originalProjectionIdentity',source_projection,'solverInvoked',false,'newOptimizerOrI1Receipt',false),
  'semantic_snapshot',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-snapshot.v1','sourceId',p_source,
   'origin',origin::text,'frameStart',p_frame::text,'baselineSnapshotDigest',snapshot,'originalProjectionIdentity',source_projection));
 lunch:=lunch-'document_identity';
 lunch:=lunch||jsonb_build_object('week_start',p_frame::text,'base_authority_digest',authority_digest,'base_replay_digest',replay_digest,
  'source_input_digest',input_digest,'candidate_digest',public.static_weekly_digest_jsonb(jsonb_build_object('schema','custodial.approved-manual-repeat-lunch-data.v1','source_input_digest',input_digest,'loans',loans,'responsibilities',responsibilities,'notification_intents',intents)),
  'loans',loans,'responsibilities',responsibilities,'notification_intents',intents,
  'semantic_snapshot',jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
   'loans_digest',public.static_weekly_digest_jsonb(loans),'responsibilities_digest',public.static_weekly_digest_jsonb(responsibilities),
   'notification_intents_digest',public.static_weekly_digest_jsonb(intents)));
 lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];
 replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));
 lunch:=lunch||jsonb_build_object('base_authority_digest',authority_digest,'base_replay_digest',replay_digest);
 lunch:=lunch||jsonb_build_object('document_identity',public.static_weekly_digest_jsonb(lunch));
 projection:=(projection-'database_projection_identity')||jsonb_build_object('replay_digest',replay_digest);
 projection:=projection||jsonb_build_object('database_projection_identity',public.static_weekly_digest_jsonb(projection));
 RETURN jsonb_build_object('projection',projection,'lunchDocument',lunch);
END $function$
$original$;changed text;
BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'Owned fixture administrator only';END IF;
 IF public.static_weekly_digest_text(original)<> '01d1b47593688a3d586e5c90e6bfdc4c49eb613b41645010001126401b9360e6'
 OR public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_repeat_components(uuid,date)'::regprocedure))<> '6cf42446e79ace87729a88338109b82342a9f09c206cc079c0b18791ce579778'
 THEN RAISE EXCEPTION 'Exact original/corrected component definitions required';END IF;
 IF length(original)-length(replace(original,'FUNCTION public.static_weekly_manual_repeat_components(',''))<>length('FUNCTION public.static_weekly_manual_repeat_components(')
 THEN RAISE EXCEPTION 'Unique original component header required';END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_manual_repeat_components(','FUNCTION pg_temp.original_manual_repeat_components_011(');
 IF replace(changed,'FUNCTION pg_temp.original_manual_repeat_components_011(','FUNCTION public.static_weekly_manual_repeat_components(')<>original
 THEN RAISE EXCEPTION 'Only temporary original function header may differ';END IF;
 EXECUTE changed;
 EXECUTE 'revoke all on function pg_temp.original_manual_repeat_components_011(uuid,date) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader';
END $clone$;
INSERT INTO repeat_lifetime_source
 SELECT b.source_id,p.publication_id,b.effective_start+7,c.current_revision,s.source_digest,b.snapshot_digest
 FROM public.static_weekly_approved_initial_baselines b
 JOIN public.static_weekly_authority_source_documents s USING(source_id)
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=b.source_id
 JOIN public.weekly_schedule_publications p USING(version_id)
 CROSS JOIN public.static_weekly_schedule_control c
 WHERE s.active AND s.retired_at IS NULL AND c.singleton
  AND p.effective_start=b.effective_start
  AND public.static_weekly_effective_version(b.effective_start+7)=v.version_id;
DO $one$ BEGIN IF (SELECT count(*) FROM repeat_lifetime_source)<>1 THEN RAISE EXCEPTION 'One actual admitted approved normal source required';END IF;END $one$;
CREATE TEMP TABLE repeat_native_response_witness(value jsonb) ON COMMIT DROP;
DO $actual_producer$
DECLARE native jsonb;reconstructed jsonb;changed jsonb;
BEGIN
 -- Read a genuine already-committed native activation receipt; do not mock
 -- a successful product write or manufacture a replacement projection.
 SELECT r.response_json INTO STRICT native
 FROM repeat_lifetime_source source
 JOIN public.weekly_schedule_compiled_projections p ON p.publication_id=source.publication_id
  AND p.week_start=source.frame-7 AND p.compiler_version='approved-manual-period-v1'
 JOIN public.weekly_schedule_command_receipts r ON r.response_json#>>'{data,projection_id}'=p.projection_id::text
  AND r.command_type='materialize_projection';
 PERFORM public.static_weekly_assert_exact_object(native,
  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],
  ARRAY['operation','revision','content_digest','request_digest','data','output_digest'],'actual native producer response');
 PERFORM public.static_weekly_assert_exact_object(native->'data',
  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],
  ARRAY['projection_id','publication_id','week_start','week_end','replay_digest'],'actual native producer data');
 reconstructed:=public.static_weekly_response_json(native->>'operation',(native->>'revision')::bigint,
  native->>'content_digest',native->>'request_digest',native->'data');
 IF native IS DISTINCT FROM reconstructed OR native ? 'ok' OR native->>'operation'<>'materialize_projection'
  OR (native->'ok' IS DISTINCT FROM 'true'::jsonb) IS NOT TRUE
 THEN RAISE EXCEPTION 'Actual native producer contract or original consumer defect differs';END IF;
 changed:=jsonb_set(native,'{data,week_start}',to_jsonb('1900-01-01'::text),false);
 IF changed->>'output_digest'=public.static_weekly_digest_jsonb(changed-'output_digest')
 THEN RAISE EXCEPTION 'Changed native data retained its original output identity';END IF;
 changed:=jsonb_set(native,'{output_digest}',to_jsonb(repeat('0',64)),false);
 IF changed->>'output_digest'=public.static_weekly_digest_jsonb(changed-'output_digest')
 THEN RAISE EXCEPTION 'Changed native output identity passed';END IF;
 INSERT INTO repeat_native_response_witness VALUES(jsonb_build_object('producerMatchedActualStoredReceipt',true,
  'originalWrongOkCheckRejectsActualSuccess',true,'changedDataDigestRejected',true,'changedOutputDigestRejected',true,
  'projectionId',native#>>'{data,projection_id}','scope','EXISTING_COMMITTED_NATIVE_RESPONSE_CONTRACT_ONLY'));
END $actual_producer$;
WITH component AS MATERIALIZED(SELECT pg_temp.original_manual_repeat_components_011(source_id,frame) value FROM repeat_lifetime_source)
 INSERT INTO repeat_lifetime_witness SELECT 'original',public.static_weekly_digest_jsonb(value),pg_column_size(value),
  jsonb_array_length(value#>'{projection,assignments}'),jsonb_array_length(value#>'{lunchDocument,loans}') FROM component;
-- The previous statement ended; only its small digest/count witness persists.
WITH component AS MATERIALIZED(SELECT public.static_weekly_manual_repeat_components(source_id,frame) value FROM repeat_lifetime_source)
 INSERT INTO repeat_lifetime_witness SELECT 'corrected',public.static_weekly_digest_jsonb(value),pg_column_size(value),
  jsonb_array_length(value#>'{projection,assignments}'),jsonb_array_length(value#>'{lunchDocument,loans}') FROM component;
DO $checks$
DECLARE source record;original record;corrected record;
BEGIN
 SELECT * INTO STRICT source FROM repeat_lifetime_source;
 SELECT * INTO STRICT original FROM repeat_lifetime_witness WHERE label='original';
 SELECT * INTO STRICT corrected FROM repeat_lifetime_witness WHERE label='corrected';
 IF original.full_output_digest IS DISTINCT FROM corrected.full_output_digest OR original.bytes<>corrected.bytes
  OR original.assignments<>346 OR corrected.assignments<>346 OR original.loans<>40 OR corrected.loans<>40
 THEN RAISE EXCEPTION 'Complete repeated projection/lunch data changed';END IF;
 BEGIN
  PERFORM public.static_weekly_assert_manual_repeat_projection('{}'::jsonb,source.publication_id,source.frame,'[]'::jsonb);
  RAISE EXCEPTION 'Malformed envelope was accepted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Repeated normal rows differ from admitted immutable components' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM public.static_weekly_assert_manual_repeat_projection('{}'::jsonb,source.publication_id,source.frame,'[{"synthetic":"exception"}]'::jsonb);
  RAISE EXCEPTION 'Normal repetition admitted dated exceptions';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Dated exceptions require the same native adjustment path' THEN RAISE;END IF;
 END;
 IF source.revision IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
  OR source.source_digest IS DISTINCT FROM(SELECT s.source_digest FROM public.static_weekly_authority_source_documents s WHERE s.source_id=source.source_id)
  OR source.snapshot_digest IS DISTINCT FROM(SELECT b.snapshot_digest FROM public.static_weekly_approved_initial_baselines b WHERE b.source_id=source.source_id)
 THEN RAISE EXCEPTION 'Read-only equivalence probe changed admitted source/revision';END IF;
END $checks$;
SELECT jsonb_build_object('status','PASS','scope','SEQUENTIAL_COMPLETE_OUTPUT_DIGEST_EQUIVALENCE_AND_TWO_EXACT_VALIDATOR_NEGATIVES',
 'witnesses',(SELECT jsonb_agg(to_jsonb(w) ORDER BY label) FROM repeat_lifetime_witness w),
 'actualNativeResponse',(SELECT value FROM repeat_native_response_witness),'normalPlansChanged',false,'writerExecuted',false,'memoryLimitIncreased',false);
ROLLBACK;
