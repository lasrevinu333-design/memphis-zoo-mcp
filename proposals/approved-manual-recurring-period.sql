-- WORKER1 SOURCE PROPOSAL ONLY. No canonical/source302 amendment or execution.
-- Main owns predecessor/ACL qualification, inventory/canary enrollment and SQL.
-- Reuse the SAME normal publication/source. Never register a dated plan as normal.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $requires$
BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regprocedure('public.static_weekly_source_window_start(jsonb,date)') IS NULL
  OR to_regprocedure('public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)') IS NULL
  OR to_regprocedure('custodial_employment.read_admissions(date,bigint,uuid,uuid,text,text)') IS NULL
  OR to_regprocedure('public.static_weekly_manual_identity_json(jsonb)') IS NULL
  OR to_regprocedure('public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date)') IS NULL
 THEN RAISE EXCEPTION 'Qualified Source301 and employment admission counterparts required'; END IF;
END $requires$;
CREATE TABLE public.static_weekly_manual_repeat_confirmations(
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 request_id uuid NOT NULL,request_json jsonb NOT NULL,receipt_json jsonb NOT NULL,
 PRIMARY KEY(manager_id,request_id)
);
ALTER TABLE public.static_weekly_manual_repeat_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.static_weekly_manual_repeat_confirmations FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER manual_repeat_immutable BEFORE UPDATE OR DELETE ON public.static_weekly_manual_repeat_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();

-- Private deterministic date/identity transposition of admitted components.
-- Select JSON paths directly; never SELECT baseline%ROWTYPE or hash feasibility.
CREATE FUNCTION public.static_weekly_manual_repeat_components(p_source uuid,p_frame date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
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
END $fn$;

CREATE FUNCTION public.static_weekly_read_manual_repeat_basis(p_manager uuid,p_publication uuid,p_date date,p_revision bigint,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;v_source_id uuid;v_version_id uuid;origin date;frame date;snapshot text;catalog text;projection jsonb;lunch jsonb;
 entry record;exceptions jsonb;reasons jsonb:='[]';participants jsonb;employment jsonb:='[]';readback jsonb;
 d date;a jsonb;r record;existing uuid;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_revision IS NULL OR p_revision NOT BETWEEN 0 AND 9007199254740990 OR p_revision IS DISTINCT FROM
  (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
  OR p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current recurring date/revision required'; END IF;
 SELECT v.authority_source_id,v.version_id,p.effective_start INTO STRICT v_source_id,v_version_id,origin
 FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
 WHERE p.publication_id=p_publication;
 SELECT b.snapshot_digest,b.feasibility#>'{initialBaseline,projection}' AS projection_component,b.feasibility->'lunchDocument' AS lunch_component,c.catalog_entry_digest,
  c.template_json,c.binding_json,c.owner_config,c.approval_evidence,c.template_id INTO STRICT entry
 FROM public.static_weekly_approved_initial_baselines b JOIN public.static_weekly_approved_template_catalog c USING(template_id)
 JOIN public.static_weekly_authority_source_documents s ON s.source_id=b.source_id
 WHERE b.source_id=v_source_id AND b.effective_start=origin AND s.active AND s.retired_at IS NULL;
 snapshot:=entry.snapshot_digest;projection:=entry.projection_component;lunch:=entry.lunch_component;catalog:=entry.catalog_entry_digest;
 IF p_date<origin OR entry.template_id IS NULL
  OR EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements WHERE template_id=entry.template_id)
  OR catalog IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object('template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  OR projection#>>'{authority,compilerInput,version,manualGroupRatingAuthority,manifestSha256}' IS DISTINCT FROM 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  OR NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_confirmations c WHERE c.publication_id=p_publication)
 THEN RAISE EXCEPTION 'Current live catalog and original accepted manual publication required'; END IF;
 frame:=public.static_weekly_source_window_start(projection#>'{authority,compilerInput}',p_date);
 IF frame IS DISTINCT FROM origin+((p_date-origin)/7)*7 THEN RAISE EXCEPTION 'Original publication origin differs from Source301 window authority'; END IF;
 IF frame<=origin THEN RAISE EXCEPTION 'Initial frame remains owned by the original activation'; END IF;
 IF public.static_weekly_effective_version(frame) IS DISTINCT FROM v_version_id
  OR public.static_weekly_effective_version(frame+6) IS DISTINCT FROM v_version_id
 THEN RAISE EXCEPTION 'Period crosses or has left the original normal publication'; END IF;
 IF projection->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(projection-'database_projection_identity')
  OR lunch->>'document_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(lunch-'document_identity') THEN RAISE EXCEPTION 'Original admitted component identity differs'; END IF;
 IF jsonb_array_length(projection->'assignments')<>346 OR jsonb_array_length(lunch->'loans')<>40 THEN RAISE EXCEPTION 'Original normal component counts differ'; END IF;
 exceptions:=public.static_weekly_accepted_exception_set(p_publication,frame);
 SELECT jsonb_agg(jsonb_build_object('serviceDate',service_day::date::text,
  'assignmentEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'owner_person_id' id FROM jsonb_array_elements(projection->'assignments') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids),
  'lunchOwnerEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'normal_owner_person_id' id FROM jsonb_array_elements(lunch->'loans') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids),
  'lunchCovererEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'coverer_person_id' id FROM jsonb_array_elements(lunch->'responsibilities') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids)) ORDER BY service_day)
 INTO participants FROM generate_series(frame::timestamp,(frame+6)::timestamp,interval '1 day') dates(service_day);
 FOR d IN SELECT generate_series(frame::timestamp,(frame+6)::timestamp,interval '1 day')::date LOOP
  FOR a IN SELECT value FROM jsonb_array_elements(projection#>'{authority,projectionAvailability}') WHERE value->>'status'='working' AND (value->>'dayOfWeek')::integer=extract(dow FROM d)::integer LOOP
   IF NOT EXISTS(SELECT 1 FROM public.v_weekly_roster_slot_incumbency_ranges incumbency JOIN public.employees e ON e.id=incumbency.person_id
    WHERE incumbency.slot_id=(a->>'slotId')::uuid AND incumbency.person_id=(a->>'incumbentPersonId')::uuid AND incumbency.effective_start<=d
     AND (incumbency.effective_end IS NULL OR d<incumbency.effective_end) AND e.active)
   THEN reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','ACTUAL_ROSTER_CHANGED','serviceDate',d::text,'slotId',a->>'slotId')); END IF;
  END LOOP;
  readback:=custodial_employment.read_admissions(d,p_revision,p_manager,p_credential,p_device,p_access);
  employment:=employment||jsonb_build_array(readback);
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lunch->'loans') l WHERE l->>'normal_owner_person_id'='1318b295-fd70-4e78-8828-62c29302f96f'
  AND (l->>'coverage_start'<>'12:30' OR l->>'coverage_end'<>'13:30')) THEN
  reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','APPROVED_XAVIER_LUNCH_DIFFERS')); END IF;
 -- A bare same-frame projection does not prove current employment14 or a
 -- normal-reference admission. The typed recurring owner always obtains a real
 -- same-request repeat receipt; native writer replay still deduplicates bytes.
 existing:=NULL;
 RETURN jsonb_build_object('schema','custodial.approved-manual-recurring-basis.v1','managerId',p_manager,
  'sourceId',v_source_id,'publicationId',p_publication,'versionId',v_version_id,'origin',origin::text,'frameStart',frame::text,'frameEnd',(frame+6)::text,
  'authorityRevision',p_revision,'generation',public.static_weekly_v15_read_recurring_generation(),
  'manifestSha256','fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f',
  'baselineSnapshotDigest',snapshot,'catalogEntryDigest',catalog,'sourceProjectionIdentity',projection->>'database_projection_identity',
  'sourceLunchIdentity',lunch->>'document_identity','assignmentCount',346,'lunchCount',40,'acceptedExceptions',exceptions,
  'adjustmentReasons',reasons,'participants',participants,'employmentByDate',employment,'existingProjectionId',existing);
END $fn$;

-- Exact reference validator, called only by the private native writer copy.
CREATE FUNCTION public.static_weekly_assert_manual_repeat_projection(p_envelope jsonb,p_publication uuid,p_date date,p_exceptions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE sid uuid;expected jsonb;
BEGIN
 IF p_exceptions IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Dated exceptions require the same native adjustment path'; END IF;
 SELECT authority_source_id INTO STRICT sid FROM public.weekly_schedule_versions v
 JOIN public.weekly_schedule_publications p USING(version_id) WHERE p.publication_id=p_publication;
 expected:=public.static_weekly_manual_repeat_components(sid,p_date)->'projection';
 IF p_envelope IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Repeated normal rows differ from admitted immutable components'; END IF;
END $fn$;
-- No arbitrary rewritten predecessor: header + ONE validator call only;
-- complete inverse must equal the installed Source301 approved writer.
DO $copy_native$
DECLARE original text;changed text;inverse text;needle text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 needle:='public.static_weekly_assert_approved_initial_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)';
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact approved native validator seam differs'; END IF;
 IF length(original)-length(replace(original,'FUNCTION public.static_weekly_approved_initial_materialize_projection(',''))<>length('FUNCTION public.static_weekly_approved_initial_materialize_projection(') THEN RAISE EXCEPTION 'Native function header is not unique'; END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_approved_initial_materialize_projection(',
  'FUNCTION public.static_weekly_manual_repeat_materialize_projection(');
 IF changed=original THEN RAISE EXCEPTION 'Exact approved native function header differs'; END IF;
 changed:=replace(changed,needle,'public.static_weekly_assert_manual_repeat_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)');
 inverse:=replace(replace(changed,'FUNCTION public.static_weekly_manual_repeat_materialize_projection(',
  'FUNCTION public.static_weekly_approved_initial_materialize_projection('),
  'public.static_weekly_assert_manual_repeat_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)',needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Unexplained native writer drift'; END IF;
 EXECUTE changed;
END $copy_native$;

CREATE FUNCTION public.static_weekly_materialize_manual_repeat(p_reference jsonb,p_reference_digest text,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE manager uuid;publication uuid;request uuid;frame date;revision bigint;basis jsonb;expected jsonb;vector jsonb;reasons jsonb;
 actor jsonb;components jsonb;projection jsonb;materialized jsonb;lunch jsonb;receipt jsonb;prior record;employee jsonb;v_day jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF p_reference IS NULL OR pg_column_size(p_reference)>32768 THEN RAISE EXCEPTION 'Bounded compact normal period reference required'; END IF;
 PERFORM public.static_weekly_assert_exact_object(p_reference,
  ARRAY['schema','managerId','requestId','sourceId','publicationId','versionId','origin','frameStart','frameEnd','expectedRevision','generation','baselineSnapshotDigest','catalogEntryDigest','sourceProjectionIdentity','sourceLunchIdentity','employmentRevisionVector','exceptionSetDigest'],
  ARRAY['schema','managerId','requestId','sourceId','publicationId','versionId','origin','frameStart','frameEnd','expectedRevision','generation','baselineSnapshotDigest','catalogEntryDigest','sourceProjectionIdentity','sourceLunchIdentity','employmentRevisionVector','exceptionSetDigest'],'normal recurring reference');
 IF p_reference->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference.v1'
  OR p_reference_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_reference)
 THEN RAISE EXCEPTION 'Exact compact repeat reference required'; END IF;
 manager:=(p_reference->>'managerId')::uuid;publication:=(p_reference->>'publicationId')::uuid;request:=(p_reference->>'requestId')::uuid;
 frame:=(p_reference->>'frameStart')::date;revision:=(p_reference->>'expectedRevision')::bigint;
 IF manager IS NULL OR publication IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Explicit request/publication/manager identity required'; END IF;
 actor:=public.custodial_action_actor_v1(manager,p_credential,p_device,p_access,'write');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO prior FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=manager AND request_id=request;
 IF FOUND THEN
  IF prior.request_json IS DISTINCT FROM p_reference THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original repeat request identity changed'; END IF;
  RETURN prior.receipt_json;
 END IF;
 basis:=public.static_weekly_read_manual_repeat_basis(manager,publication,frame,revision,p_credential,p_device,p_access);
 reasons:=basis->'adjustmentReasons';
 IF basis->'acceptedExceptions' IS DISTINCT FROM '[]'::jsonb THEN reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','ACCEPTED_EXCEPTIONS')); END IF;
 FOR v_day IN SELECT value FROM jsonb_array_elements(basis->'employmentByDate') LOOP
  FOR employee IN SELECT value FROM jsonb_array_elements(v_day->'employees') LOOP
   IF (employee#>>'{command,fact,state}'='PRE_START' OR (employee#>>'{command,fact,firstServiceDate}')::date>(v_day->>'serviceDate')::date)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(basis->'participants') p WHERE p->>'serviceDate'=v_day->>'serviceDate'
     AND ((p->'assignmentEmployeeIds')?(employee->>'employeeId') OR (p->'lunchOwnerEmployeeIds')?(employee->>'employeeId') OR (p->'lunchCovererEmployeeIds')?(employee->>'employeeId'))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','PRE_START_NOT_PTO','serviceDate',v_day->>'serviceDate','employeeId',employee->>'employeeId'));
   END IF;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(reasons)>0 THEN RETURN jsonb_build_object('schema','custodial.approved-manual-recurring-decision.v1',
  'status','NEEDS_DATED_ADJUSTMENT','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd','reasons',reasons,
  'route','SAME_NATIVE_APPROVED_MANUAL_DATED_OWNER_PATH','normalSourceChanged',false,'solverInvoked',false,'published',false); END IF;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',day_row->>'serviceDate','employeeId',employee_row->>'employeeId',
  'employmentRevision',employee_row->'employmentRevision','requestId',employee_row#>>'{command,requestId}') ORDER BY day_row->>'serviceDate',employee_row->>'employeeId') INTO vector
 FROM jsonb_array_elements(basis->'employmentByDate') days(day_row) CROSS JOIN LATERAL jsonb_array_elements(day_row->'employees') employees(employee_row);
 expected:=jsonb_build_object('schema','custodial.approved-manual-recurring-reference.v1','managerId',manager,'requestId',request,
  'sourceId',basis->'sourceId','publicationId',basis->'publicationId','versionId',basis->'versionId','origin',basis->'origin',
  'frameStart',basis->'frameStart','frameEnd',basis->'frameEnd','expectedRevision',revision,'generation',basis->'generation',
  'baselineSnapshotDigest',basis->'baselineSnapshotDigest','catalogEntryDigest',basis->'catalogEntryDigest',
  'sourceProjectionIdentity',basis->'sourceProjectionIdentity','sourceLunchIdentity',basis->'sourceLunchIdentity',
  'employmentRevisionVector',vector,'exceptionSetDigest',public.static_weekly_digest_jsonb(basis->'acceptedExceptions'));
 IF expected IS DISTINCT FROM p_reference THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current repeat source/catalog/generation/employment/reference changed'; END IF;
 IF basis->'existingProjectionId' IS DISTINCT FROM 'null'::jsonb THEN RETURN jsonb_build_object('status','ALREADY_MATERIALIZED',
  'projectionId',basis->'existingProjectionId','frameStart',basis->'frameStart','published',false); END IF;
 PERFORM public.custodial_begin_application_mutation();
 components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);
 projection:=components->'projection';
 PERFORM public.static_weekly_manual_assert_lunch_lineage(projection,components->'lunchDocument',publication,frame);
 materialized:=public.static_weekly_manual_repeat_materialize_projection(publication,frame,public.static_weekly_digest_jsonb('[]'::jsonb),
  projection->>'compiler_version',projection->'objective',projection->'metrics',projection->>'replay_digest',projection,revision,
  manager,actor->>'manager_name',request::text||':normal-period');
 projection:=NULL;
 lunch:=public.static_weekly_v8_materialize_lunch_document((materialized#>>'{data,projection_id}')::uuid,components->'lunchDocument',manager);
 IF materialized->'ok' IS DISTINCT FROM 'true'::jsonb OR materialized->>'revision' IS NULL OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED' THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist'; END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v1','status','PERSISTED_CURRENT',
  'source_id',basis->'sourceId','publication_id',publication,'projection_id',materialized#>'{data,projection_id}',
  'authority_revision',materialized->'revision','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd',
  'lunch_document_identity',lunch->'document_identity','referenceDigest',p_reference_digest,'solverInvoked',false,'normalSourceChanged',false);
 INSERT INTO public.static_weekly_manual_repeat_confirmations VALUES(manager,request,p_reference,receipt);
 RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_manual_repeat_confirmation(p_manager uuid,p_request uuid,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT jsonb_build_object('request',request_json,'receipt',receipt_json) INTO result FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=p_manager AND request_id=p_request;
 RETURN result; -- NULL is absence DATA, not retry/resend permission.
END $fn$;
DO $private$
DECLARE sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.static_weekly_manual_repeat_components(uuid,date)',
  'public.static_weekly_assert_manual_repeat_projection(jsonb,uuid,date,jsonb)',
  'public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',
  'public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)',
  'public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)',
  'public.static_weekly_read_manual_repeat_confirmation(uuid,uuid,uuid,text,text)'] LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',sig);
 END LOOP;
END $private$;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text),
 public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text),
 public.static_weekly_read_manual_repeat_confirmation(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;
-- Main must enroll all new objects in its SAME original-owner authority/recovery
-- inventory/canary transaction and qualify before permitting these RPCs.
COMMIT;
