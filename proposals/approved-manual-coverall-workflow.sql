-- WORKER1 PROPOSAL ONLY. Main is the sole actual installer/canonical writer.
-- Pair with the exact generated native-function counterparts in this release.
-- No Source301/future-Monday bridge function is weakened or edited in place.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
CREATE SCHEMA custodial_coverall;
REVOKE ALL ON SCHEMA custodial_coverall FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TABLE custodial_coverall.choices(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 choice_id uuid UNIQUE NOT NULL,manager_id uuid NOT NULL,semantic_digest text NOT NULL,expected_revision bigint NOT NULL,
 credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 choice_json jsonb NOT NULL,choice_digest text NOT NULL CHECK(choice_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE custodial_coverall.request_actors(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),manager_id uuid NOT NULL,
 credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL);
CREATE TABLE custodial_coverall.staged_bindings(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 choice_operation_id uuid NOT NULL REFERENCES custodial_coverall.choices(operation_id),choice_digest text NOT NULL,
 candidate_set_digest text NOT NULL,preview_digest text NOT NULL);
CREATE TABLE custodial_coverall.accepted_days(
 operation_id uuid NOT NULL REFERENCES custodial_coverall.choices(operation_id),service_date date NOT NULL,
 source_id uuid NOT NULL REFERENCES public.static_weekly_authority_source_documents(source_id),publication_id uuid NOT NULL,
 capacity_id uuid NOT NULL REFERENCES public.weekly_roster_slots(slot_id),accepted_revision bigint NOT NULL,manager_id uuid NOT NULL,
 day_json jsonb NOT NULL,PRIMARY KEY(operation_id,service_date));
CREATE TABLE custodial_coverall.cancellations(
 operation_id uuid NOT NULL REFERENCES public.static_weekly_staffing_commands(operation_id),
 original_operation_id uuid NOT NULL,service_date date NOT NULL,accepted_revision bigint NOT NULL,manager_id uuid NOT NULL,
 PRIMARY KEY(operation_id,original_operation_id,service_date),
 FOREIGN KEY(original_operation_id,service_date) REFERENCES custodial_coverall.accepted_days(operation_id,service_date));
DO $private_tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['choices','request_actors','staged_bindings','accepted_days','cancellations'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $private_tables$;

CREATE FUNCTION public.static_weekly_coverall_bind_actor(p_operation uuid,p_manager uuid,p_credential uuid,p_device text,p_access text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;prior custodial_coverall.request_actors%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 IF c.state<>'PREPARING' OR c.prepared_by_manager_id<>p_manager THEN RAISE EXCEPTION 'Original PREPARING actor required';END IF;
 SELECT * INTO prior FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.manager_id<>p_manager OR prior.credential_id<>p_credential OR prior.device_id<>p_device OR prior.session_access<>p_access THEN RAISE EXCEPTION 'Original supplementary actor binding changed';END IF;
 ELSE INSERT INTO custodial_coverall.request_actors VALUES(p_operation,p_manager,p_credential,p_device,p_access);END IF;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_validate_choice_day(p_operation uuid,p_manager uuid,p_day jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior record;source jsonb;slot jsonb;day_basis jsonb;service date;original_exceptions jsonb;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);service:=(p_day->>'serviceDate')::date;
 IF ctx#>>'{originalCommand,semanticBody,commandKind}'<>'absence'
  OR service<(ctx#>>'{originalCommand,semanticBody,startDate}')::date OR service>(ctx#>>'{originalCommand,semanticBody,endDate}')::date
  OR p_day->'actualHoursConfirmed' IS DISTINCT FROM 'true'::jsonb
  OR nullif(btrim(p_day->>'confirmationReference'),'') IS NULL OR length(p_day->>'confirmationReference')>256
 THEN RAISE EXCEPTION 'Original third-absence actual-hours confirmation required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_day,
  ARRAY['serviceDate','sourceId','publicationId','capacityId','shift','lunch','lunchCovererSlotId','confirmationReference','actualHoursConfirmed','retainedProjectionId','retainedEnvelopeIdentity','retainedPlanDigest','overlayDigest'],
  ARRAY['serviceDate','sourceId','publicationId','capacityId','shift','lunch','lunchCovererSlotId','confirmationReference','actualHoursConfirmed','retainedProjectionId','retainedEnvelopeIdentity','retainedPlanDigest','overlayDigest'],'CoverAll day');
 PERFORM public.static_weekly_v3_assert_window(p_day->'shift','actual CoverAll hours');PERFORM public.static_weekly_v3_assert_window(p_day->'lunch','actual CoverAll lunch');
 IF (p_day#>>'{lunch,end}')::time-(p_day#>>'{lunch,start}')::time<>interval '1 hour'
  OR p_day#>>'{lunch,start}'<p_day#>>'{shift,start}' OR p_day#>>'{lunch,end}'>p_day#>>'{shift,end}'
 THEN RAISE EXCEPTION 'Actual full-hour CoverAll lunch must fit the actual shift';END IF;
 SELECT s.canonical_source INTO STRICT source FROM public.static_weekly_authority_source_documents s
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=s.source_id JOIN public.weekly_schedule_publications p USING(version_id)
 WHERE p.publication_id=(p_day->>'publicationId')::uuid AND s.source_id=(p_day->>'sourceId')::uuid
  AND public.static_weekly_effective_version(service)=v.version_id AND s.active AND s.retired_at IS NULL;
 SELECT x INTO STRICT slot FROM jsonb_array_elements(source->'slots') x WHERE x->>'id'=p_day->>'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(slot);
 IF NOT public.static_weekly_capacity_registered(slot) THEN RAISE EXCEPTION 'Capacity is not registered to this immutable source';END IF;
 SELECT p.projection_id,p.publication_id,p.week_start,p.projection_envelope INTO STRICT prior
 FROM public.weekly_schedule_compiled_projections p WHERE p.projection_id=(p_day->>'retainedProjectionId')::uuid
  AND p.publication_id=(p_day->>'publicationId')::uuid AND service BETWEEN p.week_start AND p.week_end
  AND p.projection_envelope->>'database_projection_identity'=p_day->>'retainedEnvelopeIdentity';
 source:=jsonb_set(source,'{serviceDate}',to_jsonb(prior.week_start::text),true);
 original_exceptions:=public.static_weekly_pending_original_exception_set((p_day->>'publicationId')::uuid,prior.week_start,p_operation);
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p WHERE p.projection_id=prior.projection_id
  AND p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_manual_exception_summary(original_exceptions)))
 THEN RAISE EXCEPTION 'Exact current accepted two-absence projection required';END IF;
 SELECT x INTO STRICT day_basis FROM jsonb_array_elements(prior.projection_envelope#>'{authority,datedDayBases}') x WHERE x->>'serviceDate'=service::text;
 IF day_basis->>'kind'<>'ABSENCE' OR jsonb_array_length(day_basis#>'{input,absentPersonIds}')<>2
  OR day_basis#>>'{plan,planDigest}' IS DISTINCT FROM p_day->>'retainedPlanDigest'
  OR day_basis#>>'{plan,planDigest}' IS DISTINCT FROM public.static_weekly_digest_jsonb((day_basis->'plan')-'planDigest')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(day_basis#>'{input,roster}') r WHERE r->>'personId'=ctx#>>'{originalCommand,semanticBody,employeeId}')
 THEN RAISE EXCEPTION 'Retained two-absence day or third employee changed';END IF;
 RETURN jsonb_build_object('source',source,'slot',slot,'dayBasis',day_basis,'originalCommand',ctx->'originalCommand');
END $fn$;
CREATE FUNCTION public.static_weekly_prepare_coverall_choice(p_choice jsonb,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;prior custodial_coverall.choices%rowtype;d jsonb;actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF p_choice IS NULL OR pg_column_size(p_choice)>262144 OR jsonb_array_length(p_choice->'days') NOT BETWEEN 1 AND 366
  OR p_choice->>'choiceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_choice-'choiceDigest')
  OR p_choice->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-choice.v1'
  OR p_choice->'contractorBooked' IS DISTINCT FROM 'false'::jsonb OR p_choice->'vendorApprovalClaimed' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Exact bounded CoverAll preparing DATA required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_choice,
 ARRAY['schema','choiceId','operationId','managerId','semanticDigest','expectedRevision','days','canonicalSemanticBody','contractorBooked','vendorApprovalClaimed','choiceDigest'],
 ARRAY['schema','choiceId','operationId','managerId','semanticDigest','expectedRevision','days','canonicalSemanticBody','contractorBooked','vendorApprovalClaimed','choiceDigest'],'original CoverAll choice');
 actor:=public.custodial_action_actor_v1((p_choice->>'managerId')::uuid,p_credential,p_device,p_access,'manage_coverall');
 PERFORM public.static_weekly_coverall_bind_actor((p_choice->>'operationId')::uuid,(p_choice->>'managerId')::uuid,p_credential,p_device,p_access);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=(p_choice->>'operationId')::uuid FOR UPDATE;
 ctx:=public.static_weekly_pending_context(c.operation_id,(p_choice->>'managerId')::uuid);
 IF c.state<>'PREPARING' OR c.command_kind<>'absence' OR c.prepared_by_manager_id::text<>p_choice->>'managerId'
  OR c.semantic_body IS DISTINCT FROM p_choice->'canonicalSemanticBody' OR c.semantic_digest IS DISTINCT FROM p_choice->>'semanticDigest'
  OR to_jsonb(c.expected_revision) IS DISTINCT FROM p_choice->'expectedRevision'
 THEN RAISE EXCEPTION 'Supplement cannot change six-field canonical command or its original PREPARING owner';END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'serviceDate') FROM jsonb_array_elements(p_choice->'days') x) THEN RAISE EXCEPTION 'Duplicate actual day choice';END IF;
 SELECT * INTO prior FROM custodial_coverall.choices WHERE operation_id=c.operation_id;
 IF FOUND THEN
  IF prior.choice_json IS DISTINCT FROM p_choice THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original CoverAll choice is immutable';END IF;
  RETURN jsonb_build_object('state','PREPARING','operationId',c.operation_id,'choiceId',prior.choice_id,'choiceDigest',prior.choice_digest,'replayed',true);
 END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_choice->'days') LOOP PERFORM public.static_weekly_coverall_validate_choice_day(c.operation_id,c.prepared_by_manager_id,d);END LOOP;
 INSERT INTO custodial_coverall.choices VALUES(c.operation_id,(p_choice->>'choiceId')::uuid,c.prepared_by_manager_id,c.semantic_digest,c.expected_revision,
  p_credential,p_device,p_access,p_choice,p_choice->>'choiceDigest',clock_timestamp());
 RETURN jsonb_build_object('state','PREPARING','operationId',c.operation_id,'choiceId',p_choice->'choiceId','choiceDigest',p_choice->'choiceDigest','accepted',false);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_stage_companion(p_operation uuid,p_manager uuid,p_candidates jsonb,p_preview text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;choice custodial_coverall.choices%rowtype;prior custodial_coverall.staged_bindings%rowtype;day jsonb;request_actor custodial_coverall.request_actors%rowtype;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT * INTO choice FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT request_actor FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 PERFORM public.custodial_action_actor_v1(p_manager,request_actor.credential_id,request_actor.device_id,request_actor.session_access,'manage_coverall');
 IF c.prepared_by_manager_id<>p_manager OR c.state NOT IN('PREPARING','PREPARED') THEN RAISE EXCEPTION 'Original staffing stage ownership required';END IF;
 IF c.command_kind='absence' THEN
  FOR day IN SELECT value FROM jsonb_array_elements(choice.choice_json->'days') LOOP PERFORM public.static_weekly_coverall_validate_choice_day(p_operation,p_manager,day);END LOOP;
 END IF;
 SELECT * INTO prior FROM custodial_coverall.staged_bindings WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.choice_digest<>choice.choice_digest OR prior.candidate_set_digest<>public.static_weekly_digest_jsonb(p_candidates) OR prior.preview_digest<>p_preview THEN RAISE EXCEPTION 'Staged CoverAll identity changed';END IF;
 ELSE INSERT INTO custodial_coverall.staged_bindings VALUES(p_operation,choice.operation_id,choice.choice_digest,public.static_weekly_digest_jsonb(p_candidates),p_preview);END IF;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_accept_companion(p_operation uuid,p_manager uuid,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;b custodial_coverall.staged_bindings%rowtype;q custodial_coverall.choices%rowtype;d jsonb;request_actor custodial_coverall.request_actors%rowtype;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT * INTO b FROM custodial_coverall.staged_bindings WHERE operation_id=p_operation;IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END) THEN RAISE EXCEPTION 'CoverAll cannot accept without its staged original binding';END IF;RETURN;END IF;
 SELECT * INTO STRICT q FROM custodial_coverall.choices WHERE operation_id=b.choice_operation_id;
 SELECT * INTO STRICT request_actor FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 PERFORM public.custodial_action_actor_v1(p_manager,request_actor.credential_id,request_actor.device_id,request_actor.session_access,'manage_coverall');
 IF c.state<>'PREPARED' OR c.prepared_by_manager_id<>p_manager OR p_revision<>c.expected_revision+1
  OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)<>p_revision
  OR current_setting('app.static_weekly_staffing_batch_operation',true) IS DISTINCT FROM p_operation::text
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.authority_revision=p_revision AND r.command_id=p_operation AND r.operation='apply_staffing_command' AND r.actor_manager_id=p_manager)
  OR c.candidate_set_digest<>b.candidate_set_digest OR c.preview_digest<>b.preview_digest OR q.choice_digest<>b.choice_digest
 THEN RAISE EXCEPTION 'CoverAll acceptance must share the exact canonical native transaction/revision';END IF;
 IF c.command_kind='absence' THEN
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_staffing_absences WHERE absence_id=p_operation AND accepted_revision=p_revision) THEN RAISE EXCEPTION 'Canonical third absence fact missing';END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') LOOP
   INSERT INTO custodial_coverall.accepted_days VALUES(p_operation,(d->>'serviceDate')::date,(d->>'sourceId')::uuid,(d->>'publicationId')::uuid,
    (d->>'capacityId')::uuid,p_revision,p_manager,d);
  END LOOP;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations WHERE accepted_operation_id=p_operation AND absence_id=c.target_absence_id AND accepted_revision=p_revision) THEN RAISE EXCEPTION 'Canonical cancellation fact missing';END IF;
  INSERT INTO custodial_coverall.cancellations SELECT p_operation,a.operation_id,a.service_date,p_revision,p_manager FROM custodial_coverall.accepted_days a
   WHERE a.operation_id=c.target_absence_id AND a.service_date BETWEEN c.start_date AND c.end_date;
 END IF;
END $fn$;
-- Source-bound pending/accepted fact reconstruction. No synthetic person or
-- vendor booking is created. The actual hours remain separate immutable DATA.
CREATE FUNCTION public.static_weekly_coverall_capacity_availability(p_source jsonb,p_day jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE slot jsonb;template jsonb;day integer:=extract(dow FROM (p_day->>'serviceDate')::date)::integer;minutes integer;
BEGIN
 SELECT s INTO STRICT slot FROM jsonb_array_elements(p_source->'slots') s WHERE s->>'id'=p_day->>'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(slot);IF NOT public.static_weekly_capacity_registered(slot) THEN RAISE EXCEPTION 'Unregistered source capacity';END IF;
 SELECT t INTO STRICT template FROM jsonb_array_elements(slot->'contractorAvailability') t WHERE t->>'dayOfWeek'=day::text;
 minutes:=extract(epoch FROM ((p_day#>>'{shift,end}')::time-(p_day#>>'{shift,start}')::time))::integer/60-60;
 IF minutes<=0 THEN RAISE EXCEPTION 'Actual productive capacity is empty';END IF;
 RETURN (template-'breakChoice')||jsonb_build_object('slotId',slot->'id','dayOfWeek',day,'status','working','shift',p_day->'shift',
  'lunch',(p_day->'lunch')||jsonb_build_object('startMinute',extract(epoch FROM (p_day#>>'{lunch,start}')::time)::integer/60,'endMinute',extract(epoch FROM (p_day#>>'{lunch,end}')::time)::integer/60),
  'maxDutyMinutes',minutes,'maxDutyProvenance',template->'productiveCapacityProvenance','blockedWindows','[]'::jsonb);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_day_facts(p_operation uuid,p_day jsonb,p_manager uuid,p_revision bigint,p_choice uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE source jsonb;availability jsonb;version uuid;base jsonb;cover jsonb;lunch jsonb;
BEGIN
 SELECT s.canonical_source,v.version_id INTO STRICT source,version FROM public.static_weekly_authority_source_documents s
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=s.source_id JOIN public.weekly_schedule_publications p USING(version_id)
 WHERE s.source_id=(p_day->>'sourceId')::uuid AND p.publication_id=(p_day->>'publicationId')::uuid;
 availability:=public.static_weekly_coverall_capacity_availability(source,p_day);
 base:=jsonb_build_object('baseVersionId',version,'publicationId',p_day->'publicationId','serviceDate',p_day->'serviceDate',
  'actorId',p_manager,'expectedRevision',p_revision,'reason','Actual manager-confirmed source-bound third-absence capacity','sequence',p_revision+1,'coverAllChoiceId',p_choice,'coverAllOperationId',p_operation);
 cover:=base||jsonb_build_object('id','coverall:'||p_operation||':'||(p_day->>'serviceDate'),
  'type','cover_all','payload',jsonb_build_object('availability',availability),'idempotencyKey','coverall:'||p_operation||':'||(p_day->>'serviceDate'));
 lunch:=base||jsonb_build_object('id','coverall-lunch:'||p_operation||':'||(p_day->>'serviceDate'),
  'type','lunch','window',p_day->'lunch','payload',jsonb_build_object('slotId',p_day->'capacityId'),
  'idempotencyKey','coverall-lunch:'||p_operation||':'||(p_day->>'serviceDate'));
 RETURN jsonb_build_array(cover||jsonb_build_object('payloadDigest',public.static_weekly_digest_jsonb(cover->'payload')),
  lunch||jsonb_build_object('payloadDigest',public.static_weekly_digest_jsonb(jsonb_build_object('payload',lunch->'payload','window',lunch->'window'))));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_effective_facts(p_publication uuid,p_frame date,p_exclude_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE row record;facts jsonb:='[]';
BEGIN
 FOR row IN SELECT a.*,q.choice_id,c.state,c.expected_revision FROM custodial_coverall.accepted_days a
 JOIN custodial_coverall.choices q USING(operation_id) JOIN public.static_weekly_staffing_commands c USING(operation_id)
 JOIN public.static_weekly_staffing_absences original ON original.absence_id=a.operation_id AND original.accepted_operation_id=c.operation_id
  AND original.accepted_revision=a.accepted_revision AND original.accepted_by_manager_id=a.manager_id
 WHERE a.publication_id=p_publication AND a.service_date BETWEEN p_frame AND p_frame+6
  AND (p_exclude_operation IS NULL OR a.operation_id<>p_exclude_operation)
  AND (c.state='ACCEPTED' OR (c.state='PREPARED' AND current_setting('app.static_weekly_staffing_batch_operation',true)=c.operation_id::text
    AND EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.command_id=c.operation_id AND r.authority_revision=a.accepted_revision AND r.operation='apply_staffing_command')))
  AND NOT EXISTS(SELECT 1 FROM custodial_coverall.cancellations x JOIN public.static_weekly_staffing_absence_cancellations k
    ON k.accepted_operation_id=x.operation_id AND k.absence_id=x.original_operation_id AND k.accepted_revision=x.accepted_revision
    JOIN public.static_weekly_staffing_commands cc ON cc.operation_id=x.operation_id
    WHERE x.original_operation_id=a.operation_id AND x.service_date=a.service_date AND (p_exclude_operation IS NULL OR x.operation_id<>p_exclude_operation)
     AND (cc.state='ACCEPTED' OR (cc.state='PREPARED' AND current_setting('app.static_weekly_staffing_batch_operation',true)=cc.operation_id::text)))
 ORDER BY a.service_date,a.operation_id LOOP
  facts:=facts||(SELECT jsonb_agg(e||jsonb_build_object('status','accepted')) FROM jsonb_array_elements(public.static_weekly_coverall_day_facts(row.operation_id,row.day_json,row.manager_id,row.expected_revision,row.choice_id)) e);
 END LOOP;
 RETURN facts;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_pending_facts(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;q custodial_coverall.choices%rowtype;d jsonb;facts jsonb:='[]';
BEGIN
 PERFORM public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF c.command_kind='cancel_absence' THEN RETURN '[]'::jsonb;END IF;
 SELECT * INTO q FROM custodial_coverall.choices WHERE operation_id=p_operation;IF NOT FOUND THEN RETURN facts;END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') WHERE value->>'publicationId'=p_publication::text
  AND (value->>'serviceDate')::date BETWEEN p_frame AND p_frame+6 AND (p_day IS NULL OR value->>'serviceDate'=p_day::text) LOOP
  facts:=facts||public.static_weekly_coverall_day_facts(p_operation,d,p_manager,c.expected_revision,q.choice_id);
 END LOOP;
 RETURN facts;
END $fn$;
-- Native stage/accept/source readers are patched by the exact reversible
-- installer generated in this same release; no old six-field semantic changes.

-- Current-date typed-capacity Source activation. Staging stores DATA only:
-- no Source, registry, roster slot or person is registered until the one atomic
-- confirmation. A deferred complete-receipt trigger prevents half registration.
CREATE TABLE custodial_coverall.activation_packets(
 packet_id uuid PRIMARY KEY,source_id uuid UNIQUE NOT NULL,template_id text UNIQUE NOT NULL,manager_id uuid NOT NULL,
 service_date date NOT NULL,expected_revision bigint NOT NULL,roster_digest text NOT NULL,preview_digest text NOT NULL,
 source_json jsonb NOT NULL,source_digest text NOT NULL,transition_json jsonb NOT NULL,capacity_json jsonb NOT NULL,
 owner_config jsonb NOT NULL,template_json jsonb NOT NULL,binding_json jsonb NOT NULL,approval_json jsonb NOT NULL,
 feasibility_json jsonb NOT NULL,packet_fingerprint text NOT NULL);
CREATE TABLE custodial_coverall.activation_operations(
 operation_id uuid PRIMARY KEY,packet_id uuid UNIQUE NOT NULL REFERENCES custodial_coverall.activation_packets(packet_id),
 manager_id uuid NOT NULL,owner_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),request_json jsonb NOT NULL);
CREATE TABLE custodial_coverall.activation_receipts(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_operations(operation_id),receipt_json jsonb NOT NULL);
DO $private_activation$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['activation_packets','activation_operations','activation_receipts'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $private_activation$;
CREATE FUNCTION public.static_weekly_coverall_require_activation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_receipts WHERE operation_id=NEW.operation_id)
 THEN RAISE EXCEPTION 'Typed capacity Source cannot commit without native publication/projection/lunch receipt';END IF;RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER complete_coverall_activation AFTER INSERT ON custodial_coverall.activation_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.static_weekly_coverall_require_activation_receipt();
CREATE FUNCTION public.static_weekly_coverall_assert_activation_data(p_data jsonb,p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE source jsonb:=p_data->'source';transition jsonb:=p_data->'transition';cp jsonb:=p_data->'capacityTransition';
 oldsource jsonb;oldslot jsonb;newslot jsonb;mapping jsonb;expected jsonb;actual jsonb;ids text[];row jsonb;at date;end_date date;
BEGIN
 IF p_data IS NULL OR pg_column_size(p_data)>33554432 THEN RAISE EXCEPTION 'Bounded current-date activation DATA required';END IF;
 IF p_data->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-activation-data.v1'
  OR jsonb_array_length(p_snapshot->'rosterSlots')<>22 OR p_data->'currentPositions'<>'22'::jsonb
  OR p_data->'additionalCapacityPositions'<>'8'::jsonb OR p_data->'prospectivePositions'<>'30'::jsonb OR p_data->'newEmployees'<>'0'::jsonb
  OR p_data->'weeklyBaselineChanged' IS DISTINCT FROM 'false'::jsonb OR p_data->'registered' IS DISTINCT FROM 'false'::jsonb
  OR p_data->'published' IS DISTINCT FROM 'false'::jsonb OR p_data->'productionWritten' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Exact original22 plus eight NEW nonemployee capacity DATA required';END IF;
 at:=(p_snapshot->>'serviceDate')::date;end_date:=at+6;
 IF source->>'serviceDate'<>at::text OR source#>>'{version,effectiveStart}'<>at::text
  OR p_data->>'serviceDate'<>at::text OR p_data->>'windowEnd'<>end_date::text
  OR source->>'serviceDate'<>p_data#>>'{capacityTransition,serviceDate}'
  OR p_data->>'sourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR source->'exceptions' IS DISTINCT FROM '[]'::jsonb
 THEN RAISE EXCEPTION 'Native capacity activation uses current service date and exact immutable Source';END IF;
 PERFORM public.static_weekly_assert_manual_roster_transition(transition,p_snapshot,p_data->'ownerConfig');
 oldsource:=transition->'projectedSourceDraft';
 IF cp->>'capacityTransitionDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(cp-'capacityTransitionDigest')
  OR cp->>'rosterReadbackDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_snapshot)
  OR cp->>'normalRosterTransitionDigest' IS DISTINCT FROM transition->>'transitionDigest'
  OR jsonb_array_length(cp->'selection')<>8 OR jsonb_array_length(source->'slots')<>17
  OR jsonb_array_length(source#>'{version,assignments}')<>346
  OR (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(source#>'{version,assignments}') x)
   IS DISTINCT FROM(SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(oldsource#>'{version,assignments}') x)
  OR source#>'{version,lunchCoveragePolicy}' IS DISTINCT FROM oldsource#>'{version,lunchCoveragePolicy}'
  OR source->'proximity' IS DISTINCT FROM oldsource->'proximity'
  OR (source->'version')-ARRAY['id','publicationId','status','effectiveStart','namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds','slotAvailability','assignments']
   IS DISTINCT FROM (oldsource->'version')-ARRAY['id','publicationId','status','effectiveStart','namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds','slotAvailability','assignments']
  OR (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(source#>'{version,slotAvailability}') x)
   IS DISTINCT FROM(SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(oldsource#>'{version,slotAvailability}') x)
 THEN RAISE EXCEPTION 'Shared mapper/roster/normal geometry binding differs';END IF;
 SELECT array_agg(x->>'new_capacity_id') INTO ids FROM jsonb_array_elements(cp->'selection') x;
 IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>8 OR EXISTS(SELECT 1 FROM public.weekly_roster_slots WHERE slot_id::text=ANY(ids))
  OR (SELECT count(DISTINCT x->>'capacity_code') FROM jsonb_array_elements(cp->'selection') x)<>8
 THEN RAISE EXCEPTION 'Capacity IDs/codes must be eight unique NEW positions';END IF;
 FOR mapping IN SELECT value FROM jsonb_array_elements(cp->'selection') LOOP
  SELECT x INTO STRICT oldslot FROM jsonb_array_elements(oldsource->'slots') x WHERE x->'id'=mapping->'legacy_slot_id' AND x->'contractorCapacity'='true'::jsonb;
  SELECT x INTO STRICT newslot FROM jsonb_array_elements(source->'slots') x WHERE x->'id'=mapping->'new_capacity_id';
  expected:=jsonb_build_object('id',mapping->'new_capacity_id','capacityId',mapping->'new_capacity_id','label',mapping->'capacity_code',
   'kind','CONTRACTOR_CAPACITY','contractorCapacity',true,'incumbencies','[]'::jsonb,'contractorAvailability',oldslot->'contractorAvailability');
  IF newslot IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM public.static_weekly_contractor_capacity_registrations WHERE capacity_code=mapping->>'capacity_code')
  THEN RAISE EXCEPTION 'Source-bound typed capacity template/codes require explicit reconciliation';END IF;
  PERFORM public.static_weekly_capacity_assert_shape(newslot);
 END LOOP;
 FOR oldslot IN SELECT value FROM jsonb_array_elements(oldsource->'slots') WHERE value->'contractorCapacity' IS DISTINCT FROM 'true'::jsonb LOOP
  SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(oldslot->'incumbencies') WITH ORDINALITY q(x,n)
   WHERE (x->>'effectiveStart')::date<=end_date AND (x->>'effectiveEnd' IS NULL OR (x->>'effectiveEnd')::date>at);
  SELECT x INTO STRICT newslot FROM jsonb_array_elements(source->'slots') x WHERE x->'id'=oldslot->'id';
  IF newslot IS DISTINCT FROM (oldslot||jsonb_build_object('incumbencies',actual)) THEN RAISE EXCEPTION 'Ordinary employee or history facts changed';END IF;
 END LOOP;
 IF p_data#>'{feasibility,candidateSource}' IS DISTINCT FROM source OR p_data#>'{template,source}' IS DISTINCT FROM source
  OR p_data#>'{feasibility,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_data#>'{feasibility,mapping,unchanged}' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_array_length(p_data#>'{feasibility,initialBaseline,projection,assignments}')<>346
  OR jsonb_array_length(p_data#>'{feasibility,lunchDocument,loans}')<>40
 THEN RAISE EXCEPTION 'Existing fixed-pattern adapter snapshot, not a new optimizer receipt, required';END IF;
END $fn$;
-- Same Source301 packet identity and all five integrity checks; only one
-- component JSONB is live at a time. No full document/projection/lunch records
-- are retained while hashing the remaining feasibility body.
CREATE FUNCTION custodial_coverall.activation_packet_fingerprint(p_source uuid,p_template text,p_manager uuid,p_transition jsonb,p_feasibility jsonb)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE component jsonb;metadata jsonb;feasibility_identity text;document_identity text;projection_identity text;lunch_identity text;
BEGIN
 feasibility_identity:=p_feasibility->>'digest';
 IF feasibility_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(p_feasibility-ARRAY['digest','initialBaseline']) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation feasibility identity changed';END IF;
 component:=p_feasibility#>'{initialBaseline,document}';document_identity:=component#>>'{validation,database_document_identity}';
 IF document_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component#-'{validation,database_document_identity}') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation document identity changed';END IF;
 component:=NULL;
 component:=p_feasibility#>'{initialBaseline,projection}';projection_identity:=component->>'database_projection_identity';
 IF projection_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component-'database_projection_identity') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation projection identity changed';END IF;
 component:=NULL;
 component:=p_feasibility->'lunchDocument';lunch_identity:=component->>'document_identity';
 IF lunch_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component-'document_identity') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation lunch identity changed';END IF;
 IF p_feasibility#>'{initialBaseline,lunchDocument}' IS DISTINCT FROM component THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation initial lunch identity changed';END IF;
 component:=NULL;
 metadata:=(p_feasibility->'initialBaseline')-ARRAY['document','projection','lunchDocument'];
 p_feasibility:=NULL;
 RETURN public.static_weekly_digest_jsonb(jsonb_build_object('sourceId',p_source,'templateId',p_template,'managerId',p_manager,
  'transitionDigest',p_transition->>'transitionDigest','feasibilityDigest',feasibility_identity,
  'documentIdentity',document_identity,'projectionIdentity',projection_identity,'lunchIdentity',lunch_identity,'initialMetadata',metadata));
END $fn$;
REVOKE ALL ON FUNCTION custodial_coverall.activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
-- The CoverAll copied reader holds only scalar/small output fields. This
-- owner-only SQL helper reads the immutable full feasibility for one isolated
-- fingerprint call rather than retaining it in the caller's whole-row record.
CREATE FUNCTION custodial_coverall.stored_manual_packet_fingerprint(p_packet uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT custodial_coverall.activation_packet_fingerprint(p.source_id,p.template_id,p.manager_id,p.transition_json,p.feasibility_json)
 FROM public.static_weekly_manual_activation_packets p WHERE p.packet_id=p_packet
$fn$;
REVOKE ALL ON FUNCTION custodial_coverall.stored_manual_packet_fingerprint(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE FUNCTION public.static_weekly_prepare_coverall_activation(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;fingerprint text;body jsonb;feasibility jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_release_operator();PERFORM public.static_weekly_v3_manager_actor((p_data->>'managerId')::uuid);
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 PERFORM public.static_weekly_coverall_assert_activation_data(p_data,snapshot);
 -- Drop the large feasibility field from the caller packet before hashing.
 -- The unchanged full feasibility is persisted below; no wire/data field drops.
 feasibility:=p_data->'feasibility';p_data:=p_data-'feasibility';
 fingerprint:=custodial_coverall.activation_packet_fingerprint((p_data->>'sourceId')::uuid,p_data->>'templateId',(p_data->>'managerId')::uuid,p_data->'transition',feasibility);
 body:=jsonb_build_object('packetId',p_data->'packetId','sourceId',p_data->'sourceId','managerId',p_data->'managerId','expectedRevision',snapshot->'authorityRevision',
  'serviceDate',snapshot->'serviceDate','sourceDigest',p_data->'sourceDigest','rosterDigest',public.static_weekly_digest_jsonb(snapshot),'packetFingerprint',fingerprint);
 INSERT INTO custodial_coverall.activation_packets VALUES((p_data->>'packetId')::uuid,(p_data->>'sourceId')::uuid,p_data->>'templateId',(p_data->>'managerId')::uuid,
  (snapshot->>'serviceDate')::date,(snapshot->>'authorityRevision')::bigint,public.static_weekly_digest_jsonb(snapshot),public.static_weekly_digest_jsonb(body),
  p_data->'source',p_data->>'sourceDigest',p_data->'transition',p_data->'capacityTransition',p_data->'ownerConfig',p_data->'template',p_data->'binding',p_data->'approvalEvidence',feasibility,fingerprint);
 feasibility:=NULL;p_data:=NULL;
 RETURN body||jsonb_build_object('previewDigest',public.static_weekly_digest_jsonb(body),'registered',false,'published',false);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_activation_filtered_roster(p_packet uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;ids jsonb;slots jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_operations o WHERE o.packet_id=p_packet AND o.owner_xid=pg_current_xact_id())
 THEN RAISE EXCEPTION 'Only this atomic original activation may exclude its own eight new empty capacity positions from the original22 CAS';END IF;
 SELECT capacity_json->'newCapacityIds' INTO STRICT ids FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF jsonb_array_length(snapshot->'rosterSlots')<>30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'rosterSlots') s
  WHERE ids?(s->>'slotId') AND jsonb_array_length(s->'incumbencies')<>0) THEN RAISE EXCEPTION 'Expected22 histories plus eight empty nonemployee positions';END IF;
 SELECT jsonb_agg(s ORDER BY s->>'slotId') INTO slots FROM jsonb_array_elements(snapshot->'rosterSlots') s WHERE NOT ids?(s->>'slotId');
 IF jsonb_array_length(slots)<>22 THEN RAISE EXCEPTION 'Original history slot set differs';END IF;
 RETURN jsonb_set(snapshot,'{rosterSlots}',slots,false);
END $fn$;
DO $private_source301_copies$
DECLARE original text;changed text;inverse text;item record;reader_seam record;needle text;guard_position integer;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_register_approved_template(uuid,jsonb,jsonb,jsonb,jsonb)','static_weekly_register_approved_template','static_weekly_coverall_register_template','release'),
 ('public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint)','static_weekly_read_manual_activation_basis','static_weekly_coverall_activation_basis','basis'),
 ('public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)','static_weekly_activate_approved_manual_schedule','static_weekly_coverall_activate_source301','activate')) x(sig,old_name,new_name,kind) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.sig));
  changed:=replace(original,'FUNCTION public.'||item.old_name||'(','FUNCTION public.'||item.new_name||'(');
  IF changed=original THEN RAISE EXCEPTION 'Exact Source301 function header missing';END IF;
  needle:=CASE item.kind WHEN 'release' THEN ' perform public.static_weekly_v3_assert_release_operator();'
   WHEN 'basis' THEN 'snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));'
   ELSE 'public.static_weekly_read_manual_activation_basis(p_manager,p_packet,p_revision)' END;
  IF length(changed)-length(replace(changed,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Source301 private copy seam differs: %',item.sig;END IF;
  guard_position:=position(needle in original);
  changed:=replace(changed,needle,CASE item.kind WHEN 'release' THEN ''
   WHEN 'basis' THEN 'snapshot:=public.static_weekly_coverall_activation_filtered_roster(p_packet);'
   ELSE 'public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision)' END);
  IF item.kind='basis' THEN
   FOR reader_seam IN SELECT * FROM(VALUES
 (0,$reader$declare packet public.static_weekly_manual_activation_packets%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;$reader$,$reader$declare packet record;entry public.static_weekly_approved_template_catalog%rowtype;$reader$),
 (1,$reader$ select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$,$reader$ select packet_id,source_id,template_id,service_date,manager_id,transition_json,packet_digest,
  feasibility_json->>'digest' as feasibility_digest,feasibility_json->'assignments' as assignments,feasibility_json->'lunchDocument' as lunch_document
 into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$),
 (2,$reader$public.static_weekly_manual_activation_packet_fingerprint(
   packet.source_id,packet.template_id,packet.manager_id,packet.transition_json,packet.feasibility_json)$reader$,$reader$custodial_coverall.stored_manual_packet_fingerprint(p_packet)$reader$),
 (3,$reader$packet.feasibility_json->>'digest'$reader$,$reader$packet.feasibility_digest$reader$),
 (4,$reader$packet.feasibility_json->'assignments'$reader$,$reader$packet.assignments$reader$),
 (5,$reader$packet.feasibility_json->'lunchDocument'$reader$,$reader$packet.lunch_document$reader$)
   ) r(n,before_text,after_text) ORDER BY n LOOP
    IF length(changed)-length(replace(changed,reader_seam.before_text,''))<>length(reader_seam.before_text)
    THEN RAISE EXCEPTION 'Exact Source301 CoverAll reader memory seam differs: %',reader_seam.n;END IF;
    changed:=replace(changed,reader_seam.before_text,reader_seam.after_text);
   END LOOP;
  END IF;
  inverse:=changed;
  IF item.kind='basis' THEN
   FOR reader_seam IN SELECT * FROM(VALUES
 (0,$reader$declare packet public.static_weekly_manual_activation_packets%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;$reader$,$reader$declare packet record;entry public.static_weekly_approved_template_catalog%rowtype;$reader$),
 (1,$reader$ select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$,$reader$ select packet_id,source_id,template_id,service_date,manager_id,transition_json,packet_digest,
  feasibility_json->>'digest' as feasibility_digest,feasibility_json->'assignments' as assignments,feasibility_json->'lunchDocument' as lunch_document
 into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$),
 (2,$reader$public.static_weekly_manual_activation_packet_fingerprint(
   packet.source_id,packet.template_id,packet.manager_id,packet.transition_json,packet.feasibility_json)$reader$,$reader$custodial_coverall.stored_manual_packet_fingerprint(p_packet)$reader$),
 (3,$reader$packet.feasibility_json->>'digest'$reader$,$reader$packet.feasibility_digest$reader$),
 (4,$reader$packet.feasibility_json->'assignments'$reader$,$reader$packet.assignments$reader$),
 (5,$reader$packet.feasibility_json->'lunchDocument'$reader$,$reader$packet.lunch_document$reader$)
   ) r(n,before_text,after_text) ORDER BY n DESC LOOP
    inverse:=replace(inverse,reader_seam.after_text,reader_seam.before_text);
   END LOOP;
  END IF;
  inverse:=replace(inverse,'FUNCTION public.'||item.new_name||'(','FUNCTION public.'||item.old_name||'(');
  IF item.kind='release' THEN inverse:=substring(inverse from 1 for guard_position-1)||needle||substring(inverse from guard_position);
  ELSIF item.kind='basis' THEN inverse:=replace(inverse,'snapshot:=public.static_weekly_coverall_activation_filtered_roster(p_packet);',needle);
  ELSE inverse:=replace(inverse,'public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision)',needle);END IF;
  IF inverse<>original THEN RAISE EXCEPTION 'Unexplained Source301 body drift';END IF;
  EXECUTE changed;
 END LOOP;
END $private_source301_copies$;
CREATE FUNCTION public.static_weekly_begin_coverall_activation(p_manager uuid,p_packet uuid,p_operation uuid,p_revision bigint,p_preview text,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE packet record;snapshot jsonb;request jsonb;prior record;slot jsonb;actor jsonb;code text;basis jsonb;result jsonb;employees_before text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 request:=jsonb_build_object('managerId',p_manager,'packetId',p_packet,'operationId',p_operation,'expectedRevision',p_revision,'previewDigest',p_preview);
 SELECT o.request_json,r.receipt_json INTO prior FROM custodial_coverall.activation_operations o JOIN custodial_coverall.activation_receipts r USING(operation_id) WHERE o.operation_id=p_operation;
 IF FOUND THEN IF prior.request_json IS DISTINCT FROM request THEN RAISE EXCEPTION 'Original activation identity conflict';END IF;RETURN prior.receipt_json;END IF;
 -- Explicit scalar/source/config fields ONLY: the outer transaction never
 -- retains a13MBfeasibility record while native helpers allocate components.
 SELECT packet_id,source_id,template_id,manager_id,service_date,expected_revision,roster_digest,preview_digest,
  source_json,source_digest,transition_json,capacity_json,owner_config,template_json,binding_json,approval_json,packet_fingerprint
 INTO STRICT packet FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF p_operation IS NULL OR packet.manager_id<>p_manager OR packet.expected_revision<>p_revision OR packet.preview_digest<>p_preview
  OR packet.service_date::text<>snapshot->>'serviceDate' OR p_revision::text<>snapshot->>'authorityRevision'
  OR packet.roster_digest<>public.static_weekly_digest_jsonb(snapshot)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current typed activation Source/manager/roster/revision changed';END IF;
 SELECT public.static_weekly_digest_jsonb(jsonb_agg(to_jsonb(e) ORDER BY e.id)) INTO employees_before FROM public.employees e;
 INSERT INTO custodial_coverall.activation_operations VALUES(p_operation,p_packet,p_manager,pg_current_xact_id(),request);
 INSERT INTO public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
 VALUES(packet.source_id,packet.source_json,packet.source_digest,'approved-manual-coverall:'||p_operation);
 FOR slot IN SELECT value FROM jsonb_array_elements(packet.source_json->'slots') WHERE value->>'kind'='CONTRACTOR_CAPACITY' LOOP
  PERFORM public.static_weekly_capacity_assert_shape(slot);code:='STATIC_'||upper(replace(slot->>'id','-',''));
  INSERT INTO public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  VALUES((slot->>'id')::uuid,code,slot->>'label',p_manager,actor->>'manager_name',public.static_weekly_digest_jsonb(jsonb_build_object('source_id',packet.source_id,'slot_id',slot->>'id','slot_code',code,'slot_label',slot->>'label')));
  INSERT INTO public.static_weekly_contractor_capacity_registrations(capacity_slot_id,capacity_code,source_id,source_digest,slot_snapshot,slot_digest,registered_by_manager_id,manager_name_snapshot)
  VALUES((slot->>'id')::uuid,slot->>'label',packet.source_id,packet.source_digest,slot,public.static_weekly_digest_jsonb(slot),p_manager,actor->>'manager_name');
 END LOOP;
 PERFORM public.static_weekly_v3_source_identity(packet.source_json);
 PERFORM public.static_weekly_coverall_register_template(packet.source_id,packet.template_json,packet.binding_json,packet.owner_config,packet.approval_json);
 INSERT INTO public.static_weekly_manual_activation_packets(packet_id,source_id,template_id,service_date,manager_id,transition_json,feasibility_json,packet_digest)
 SELECT packet_id,source_id,template_id,service_date,manager_id,transition_json,feasibility_json,packet_fingerprint FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 basis:=public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision);
 result:=public.static_weekly_coverall_activate_source301(p_manager,p_packet,p_revision,basis->>'previewDigest','coverall-source:'||p_operation);
 IF result->>'status'<>'PERSISTED_CURRENT' OR result->>'source_id'<>packet.source_id::text
  OR (SELECT count(*) FROM public.weekly_roster_slots)<>30
  OR employees_before IS DISTINCT FROM(SELECT public.static_weekly_digest_jsonb(jsonb_agg(to_jsonb(e) ORDER BY e.id)) FROM public.employees e)
  OR EXISTS(SELECT 1 FROM public.weekly_roster_slot_incumbencies WHERE slot_id::text IN(SELECT jsonb_array_elements_text(packet.capacity_json->'newCapacityIds')))
 THEN RAISE EXCEPTION 'Atomic source/registry/roster/normal346/40 publication did not preserve employees and empty nonemployee capacity';END IF;
 RETURN public.static_weekly_coverall_record_activation_begin(p_operation,p_manager,p_credential,p_device,p_access,result);
END $fn$;

-- BEGIN GENERATED COVERALL COMPLETION

-- Exact mechanical counterpart of applyApprovedManualCoverAllSubstitute.
CREATE FUNCTION public.static_weekly_coverall_assert_retained_day(p_operation uuid,p_manager uuid,p_day jsonb,p_publication uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE q record;d jsonb;retained jsonb;input jsonb;plan jsonb;o jsonb:=p_day->'overlay';replaced jsonb;capacity jsonb;template jsonb;
 source jsonb;ph jsonb;owners jsonb;phases jsonb:='[]';lunches jsonb:='[]';roster jsonb:='[]';coverage jsonb:='[]';
 r jsonb;l jsonb;helper jsonb;recipient jsonb;areas jsonb;expected jsonb;actual jsonb;edge text;next_edge text;normal_owner text;actual_owner text;
 checked_end text;normal_end text;capacity_id text;replaced_id text;recipient_id text;coverer_id text;last_edge text;
BEGIN
 SELECT c.*,x.day INTO STRICT q FROM custodial_coverall.choices c CROSS JOIN LATERAL jsonb_array_elements(c.choice_json->'days') x(day)
 WHERE x.day->>'publicationId'=p_publication::text AND x.day->'serviceDate'=p_day->'serviceDate'
  AND x.day->>'overlayDigest'=o->>'overlayDigest'
  AND (c.operation_id=p_operation OR EXISTS(SELECT 1 FROM custodial_coverall.accepted_days a
    JOIN public.static_weekly_staffing_commands cmd USING(operation_id)
    WHERE a.operation_id=c.operation_id AND a.service_date=(p_day->>'serviceDate')::date AND cmd.state='ACCEPTED'
     AND NOT EXISTS(SELECT 1 FROM custodial_coverall.cancellations z WHERE z.original_operation_id=a.operation_id AND z.service_date=a.service_date)));
 d:=q.day;
 IF q.operation_id=p_operation THEN PERFORM public.static_weekly_coverall_validate_choice_day(p_operation,p_manager,d);END IF;
 SELECT x INTO STRICT retained FROM public.weekly_schedule_compiled_projections prior
 CROSS JOIN LATERAL jsonb_array_elements(prior.projection_envelope#>'{authority,datedDayBases}') x
 WHERE prior.projection_id=(d->>'retainedProjectionId')::uuid AND prior.publication_id=p_publication
  AND prior.projection_envelope->>'database_projection_identity'=d->>'retainedEnvelopeIdentity'
  AND x->'serviceDate'=p_day->'serviceDate';
 input:=retained->'input';plan:=retained->'plan';
 SELECT canonical_source INTO STRICT source FROM public.static_weekly_authority_source_documents WHERE source_id=(d->>'sourceId')::uuid;
 source:=jsonb_set(source,'{serviceDate}',to_jsonb((SELECT week_start::text FROM public.weekly_schedule_compiled_projections WHERE projection_id=(d->>'retainedProjectionId')::uuid)),true);
 SELECT r0 INTO STRICT replaced FROM jsonb_array_elements(input->'roster') r0 WHERE r0->>'personId'=q.choice_json#>>'{canonicalSemanticBody,employeeId}';
 SELECT s INTO STRICT capacity FROM jsonb_array_elements(source->'slots') s WHERE s->'id'=d->'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(capacity);IF NOT public.static_weekly_capacity_registered(capacity) THEN RAISE EXCEPTION 'Unregistered CoverAll retained owner';END IF;
 SELECT a INTO STRICT template FROM jsonb_array_elements(capacity->'contractorAvailability') a WHERE a->'dayOfWeek'=input->'weekday';
 IF p_day->>'kind'<>'COVERALL' OR p_day->'input' IS DISTINCT FROM input OR p_day->'plan' IS DISTINCT FROM plan
  OR plan->>'planDigest' IS DISTINCT FROM d->>'retainedPlanDigest' OR plan->>'planDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(plan-'planDigest')
  OR o->>'overlayDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(o-'overlayDigest')
  OR o->>'sourceDigest' IS DISTINCT FROM input->>'sourceDigest' OR input->>'sourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR o->>'acceptedPlanDigest' IS DISTINCT FROM plan->>'planDigest'
  OR o->>'replacedPersonId' IS DISTINCT FROM replaced->>'personId'
  OR o->'substitute' IS DISTINCT FROM jsonb_build_object('slotId',d->'capacityId','kind','CONTRACTOR_CAPACITY','shift',d->'shift','lunch',d->'lunch',
    'confirmationReference',d->'confirmationReference','actualHoursConfirmed',true,'managerConfirmationIsCallerInput',true)
 THEN RAISE EXCEPTION 'Original two-absence plan/input or actual-hours overlay identity changed';END IF;
 PERFORM public.static_weekly_assert_exact_object(o,
 ARRAY['schema','status','serviceDate','acceptedPlanDigest','sourceDigest','absentPersonIds','replacedPersonId','substitute','checkedWindow','phaseOwners','lunchPlans','coverage','roster','groups','conservedRatingTotal','solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','formulaApproved','publicationEligible','productionWritten','contractorBooked','overlayDigest']||CASE WHEN o->>'schema'='custodial.approved-manual-coverall-overlay.v2' THEN ARRAY['normalCoverageWindow','confirmedCoverageExtension'] ELSE ARRAY[]::text[] END,
 ARRAY['schema','status','serviceDate','acceptedPlanDigest','sourceDigest','absentPersonIds','replacedPersonId','substitute','checkedWindow','phaseOwners','lunchPlans','coverage','roster','groups','conservedRatingTotal','solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','formulaApproved','publicationEligible','productionWritten','contractorBooked','overlayDigest']||CASE WHEN o->>'schema'='custodial.approved-manual-coverall-overlay.v2' THEN ARRAY['normalCoverageWindow','confirmedCoverageExtension'] ELSE ARRAY[]::text[] END,'exact mechanical CoverAll overlay');
 capacity_id:=d->>'capacityId';replaced_id:=replaced->>'slotId';normal_end:=input#>>'{checkedWindow,end}';checked_end:=greatest(normal_end,d#>>'{shift,end}');
 FOR ph IN SELECT value FROM jsonb_array_elements(plan->'phaseOwners') LOOP
  SELECT jsonb_object_agg(key,CASE WHEN value=to_jsonb(replaced_id) THEN to_jsonb(capacity_id) ELSE value END) INTO owners FROM jsonb_each(ph->'owners');
  phases:=phases||jsonb_build_array(jsonb_build_object('window',ph->'window','owners',owners));
 END LOOP;
 IF checked_end>normal_end THEN
  SELECT jsonb_object_agg(g->>'code',capacity_id) INTO owners FROM jsonb_array_elements(input->'groups') g;
  phases:=phases||jsonb_build_array(jsonb_build_object('window',jsonb_build_object('start',normal_end,'end',checked_end),'owners',owners));
 END IF;
 IF o->'phaseOwners' IS DISTINCT FROM phases OR o->'checkedWindow' IS DISTINCT FROM jsonb_build_object('start',input#>'{checkedWindow,start}','end',checked_end)
 THEN RAISE EXCEPTION 'Only third owner replacement and confirmed later ALL-area inheritance allowed';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(input->'roster') WHERE value->>'slotId'<>replaced_id LOOP
  roster:=roster||jsonb_build_array(jsonb_build_object('slotId',r->'slotId','personId',r->'personId','name',r->'name','shift',r->'shift','lunch',r->'lunch','kind','EMPLOYEE'));
 END LOOP;
 roster:=roster||jsonb_build_array(jsonb_build_object('slotId',capacity_id,'name',capacity->'label','kind','CONTRACTOR_CAPACITY','shift',d->'shift','lunch',d->'lunch','replacesPersonId',replaced->'personId'));
 IF o->'roster' IS DISTINCT FROM roster THEN RAISE EXCEPTION 'Other normal owners or actual static end times changed';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(plan->'lunchPlans') LOOP
  recipient_id:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN capacity_id ELSE l->>'recipientSlotId' END;
  coverer_id:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN d->>'lunchCovererSlotId' WHEN l->>'covererSlotId'=replaced_id THEN capacity_id ELSE l->>'covererSlotId' END;
  expected:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN d->'lunch' ELSE l->'window' END;
  SELECT coalesce(jsonb_agg(to_jsonb(code) ORDER BY code),'[]') INTO areas FROM(
   SELECT DISTINCT own.key code FROM jsonb_array_elements(phases) phase CROSS JOIN LATERAL jsonb_each(phase->'owners') own
   WHERE phase#>>'{window,start}'<expected->>'end' AND expected->>'start'<phase#>>'{window,end}' AND own.value=to_jsonb(recipient_id)) a;
  lunches:=lunches||jsonb_build_array(jsonb_build_object('recipientSlotId',recipient_id,'covererSlotId',coverer_id,'window',expected,'areas',areas));
  SELECT v INTO STRICT recipient FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=recipient_id;
  SELECT v INTO STRICT helper FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=coverer_id;
  IF recipient_id=coverer_id OR expected->>'start'<recipient#>>'{shift,start}' OR expected->>'end'>recipient#>>'{shift,end}'
   OR expected->>'start'<helper#>>'{shift,start}' OR expected->>'end'>helper#>>'{shift,end}'
   OR (expected->>'end')::time-(expected->>'start')::time<>interval '1 hour'
   OR (expected->>'start'<helper#>>'{lunch,end}' AND helper#>>'{lunch,start}'<expected->>'end')
  THEN RAISE EXCEPTION 'Actual full-hour helper is unavailable';END IF;
 END LOOP;
 IF o->'lunchPlans' IS DISTINCT FROM lunches OR EXISTS(SELECT 1 FROM jsonb_array_elements(lunches) a,jsonb_array_elements(lunches) b
  WHERE a<>b AND a->'covererSlotId'=b->'covererSlotId' AND a#>>'{window,start}'<b#>>'{window,end}' AND b#>>'{window,start}'<a#>>'{window,end}')
 THEN RAISE EXCEPTION 'Only matched third-owner lunch substitution is allowed';END IF;
 -- Same real time-slice edges as the maintained pure substitute; no score or optimizer.
 last_edge:=NULL;
 FOR edge IN SELECT DISTINCT t FROM(
  SELECT input#>>'{checkedWindow,start}' t UNION SELECT checked_end
  UNION SELECT phase#>>'{window,start}' FROM jsonb_array_elements(phases) phase
  UNION SELECT phase#>>'{window,end}' FROM jsonb_array_elements(phases) phase
  UNION SELECT v#>>'{shift,start}' FROM jsonb_array_elements(roster) v UNION SELECT v#>>'{shift,end}' FROM jsonb_array_elements(roster) v
  UNION SELECT v#>>'{lunch,start}' FROM jsonb_array_elements(roster) v UNION SELECT v#>>'{lunch,end}' FROM jsonb_array_elements(roster) v
 ) edges WHERE t BETWEEN input#>>'{checkedWindow,start}' AND checked_end ORDER BY t LOOP
  IF last_edge IS NULL THEN last_edge:=edge;CONTINUE;END IF;
  SELECT phase INTO STRICT ph FROM jsonb_array_elements(phases) phase WHERE phase#>>'{window,start}'<=last_edge AND last_edge<phase#>>'{window,end}';owners:='{}';
  FOR r IN SELECT value FROM jsonb_array_elements(input->'groups') LOOP
   normal_owner:=ph#>>ARRAY['owners',r->>'code'];SELECT v INTO STRICT recipient FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=normal_owner;
   IF recipient#>>'{shift,start}'>last_edge OR recipient#>>'{shift,end}'<edge THEN RAISE EXCEPTION 'Confirmed hours miss retained duty; no invented earlier capacity';END IF;
   actual_owner:=normal_owner;
   IF recipient#>>'{lunch,start}'<=last_edge AND last_edge<recipient#>>'{lunch,end}' THEN
    SELECT v->>'covererSlotId' INTO STRICT actual_owner FROM jsonb_array_elements(lunches) v WHERE v->>'recipientSlotId'=normal_owner;
   END IF;
   SELECT v INTO STRICT helper FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=actual_owner;
   IF helper#>>'{shift,start}'>last_edge OR helper#>>'{shift,end}'<edge OR (helper#>>'{lunch,start}'<=last_edge AND last_edge<helper#>>'{lunch,end}')
   THEN RAISE EXCEPTION 'Actual lunch coverage missing';END IF;
   if actual_owner=capacity_id then
    SELECT area->'work' INTO STRICT actual FROM jsonb_array_elements(input->'phases') WITH ORDINALITY x(phase,n)
     CROSS JOIN LATERAL jsonb_array_elements(phase->'areas') area
     WHERE n=least((SELECT ord FROM jsonb_array_elements(phases) WITH ORDINALITY y(v,ord) WHERE v=ph),jsonb_array_length(input->'phases')) AND area->'code'=r->'code';
    IF NOT((template->'qualifications') @> (actual->'requiredQualifications')) OR template->'restrictions' ? (actual->>'locationId') OR actual->'restrictedSlotIds' ? capacity_id
    THEN RAISE EXCEPTION 'CoverAll actual source qualification or physical restriction differs';END IF;
   elsif actual_owner<>normal_owner then
    if NOT(input->'reliefEligibility' ? ((least((SELECT ord FROM jsonb_array_elements(phases) WITH ORDINALITY y(v,ord) WHERE v=ph),jsonb_array_length(input->'phases'))-1)::text||':'||(r->>'code')||':'||actual_owner)) then raise exception 'Unqualified original relief helper';end if;
    SELECT v INTO STRICT helper FROM jsonb_array_elements(input->'roster') v WHERE v->>'slotId'=actual_owner;
    IF helper#>>'{owner,key}'='TAMMY' AND r->>'code'='CHINA' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'coverage') c WHERE c#>>'{window,start}'<=last_edge AND last_edge<c#>>'{window,end}' AND c#>>'{owners,CHINA}'=actual_owner)
    THEN RAISE EXCEPTION 'CoverAll cannot introduce new Tammy extras';END IF;
   end if;
   owners:=owners||jsonb_build_object(r->>'code',actual_owner);
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(owners))<>23 THEN RAISE EXCEPTION 'All23 areas required after every clockout';END IF;
  coverage:=coverage||jsonb_build_array(jsonb_build_object('window',jsonb_build_object('start',last_edge,'end',edge),'owners',owners,
   'zooWideCoverage',(SELECT count(*)=1 FROM jsonb_array_elements(roster) v WHERE v#>>'{shift,start}'<=last_edge AND v#>>'{shift,end}'>=edge)));
  last_edge:=edge;
 END LOOP;
 SELECT jsonb_agg(id ORDER BY id) INTO actual FROM(SELECT value id FROM jsonb_array_elements(input->'absentPersonIds') UNION ALL SELECT replaced->'personId') a;
 IF o->'coverage' IS DISTINCT FROM coverage OR o->'absentPersonIds' IS DISTINCT FROM actual OR o->'groups' IS DISTINCT FROM input->'groups'
  OR o->'conservedRatingTotal'<>'136'::jsonb OR o->>'status'<>'VALIDATED_UNPUBLISHED_COVERALL_OVERLAY'
  OR o->'formulaApproved' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','publicationEligible','productionWritten','contractorBooked']) k WHERE o->k IS DISTINCT FROM 'false'::jsonb)
 THEN RAISE EXCEPTION 'CoverAll exact mechanical coverage, rating or non-publication facts differ';END IF;
 IF checked_end>normal_end THEN
  IF o->>'schema'<>'custodial.approved-manual-coverall-overlay.v2' OR o->'normalCoverageWindow' IS DISTINCT FROM input->'checkedWindow'
   OR o->'confirmedCoverageExtension' IS DISTINCT FROM jsonb_build_object('beforeNormalMinutes',0,
    'afterNormalMinutes',extract(epoch FROM(checked_end::time-normal_end::time))::integer/60,'ownerSlotId',capacity_id,'purpose','INHERITED_ALERTS_AND_ISSUES_ONLY','employeeShiftExtensions',false)
  THEN RAISE EXCEPTION 'Later actual contractor hours may only inherit ALL areas';END IF;
 ELSIF o->>'schema'<>'custodial.approved-manual-coverall-overlay.v1' OR o?'confirmedCoverageExtension' OR o?'normalCoverageWindow'
 THEN RAISE EXCEPTION 'Unexpected normal-window extension';END IF;
 RETURN jsonb_build_object('choiceDay',d,'retained',retained,'overlay',o,'replacedSlotId',replaced_id);
END $fn$;
DO $copy_current_native_validator$
DECLARE original text;changed text;inverse text;item record;seams jsonb;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_manual_assert_native_projection(uuid,uuid,jsonb)'::regprocedure);
 IF original NOT LIKE '%employmentRevisionVector%' OR original NOT LIKE '%PRE_START_NOT_PTO%' THEN RAISE EXCEPTION 'Main current employment-aware native validator is required before CoverAll adoption';END IF;
 -- Preserve Main's current employment/Source301 guards outside these explicit
 -- bounded CoverAll seams. A missing/changed seam refuses installation.
 SELECT jsonb_agg(jsonb_build_object('n',n,'before',before_text,'after',after_text) ORDER BY n) INTO seams FROM(VALUES
(0,$seam$FUNCTION public.static_weekly_manual_assert_native_projection($seam$,$seam$FUNCTION public.static_weekly_coverall_assert_native_projection($seam$),
(1,$seam$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;$seam$,$seam$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;
 coverall jsonb;choice_day jsonb;capacity_id text;replaced_id text;is_coverall boolean;$seam$),
(2,$seam$if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')$seam$,$seam$if exists(select 1 from jsonb_array_elements(exceptions) e where (e->>'type' not in('pto','daily_absence') or e ? 'window')
  and (e->>'type' not in('cover_all','lunch') or not e ? 'coverAllChoiceId'
   or not public.static_weekly_coverall_exact_fact(p_operation,p_manager,publication,frame,e)))$seam$),
(3,$seam$ select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$seam$,$seam$ -- Add only the exact selected active capacity; inactive templates do not create employees.
 for day_basis in select value from jsonb_array_elements(a->'datedDayBases') where value->>'kind'='COVERALL' loop
  coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
  choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';
  select coalesce(jsonb_agg(r),'[]') into expected_availability from jsonb_array_elements(expected_availability) r
   where not(r->>'serviceDate'=choice_day->>'serviceDate' and r->>'slotId'=capacity_id);
  expected_availability:=expected_availability||jsonb_build_array(public.static_weekly_coverall_capacity_availability(source,choice_day)||jsonb_build_object(
   'serviceDate',choice_day->'serviceDate','incumbentPersonId',null,'incumbentName',null,'ownerKind','CONTRACTOR_CAPACITY','capacityId',capacity_id));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$seam$),
(4,$seam$  if day_changed then
   if jsonb_array_length(absent)$seam$,$seam$  is_coverall:=day_basis->>'kind'='COVERALL';coverall:=null;choice_day:=null;capacity_id:=null;replaced_id:=null;
  if coalesce(is_coverall,false) then
   coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
   choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';replaced_id:=coverall->>'replacedSlotId';
   if jsonb_array_length(absent)<>3 or absent is distinct from day_basis#>'{overlay,absentPersonIds}' then raise exception 'Exact third actual absence required';end if;
   input:=day_basis->'input';plan:=day_basis->'overlay';
   select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
   if coalesce(input->'preStartPersonIds','[]') is distinct from expected then raise exception 'Retained2 pre-start classification differs from current actual employment reads';end if;
   complete_start:=plan#>>'{checkedWindow,start}';complete_end:=plan#>>'{checkedWindow,end}';
  end if;
  if day_changed and not coalesce(is_coverall,false) then
   if jsonb_array_length(absent)$seam$),
(5,$seam$   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';$seam$,$seam$   if coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then owner_config:='{}';
   else select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';end if;$seam$),
(6,$seam$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'$seam$,$seam$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id'
    or (case when coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then
      item->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or item->>'capacity_id' is distinct from capacity_id or item->'owner_person_id' is distinct from 'null'::jsonb
     else item ? 'owner_kind' or item ? 'capacity_id' end)$seam$),
(7,$seam$if day_changed and (window_end>parent#>>'{window,end}' or window_start<case$seam$,$seam$if day_changed and ((window_end>parent#>>'{window,end}' and not(coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id
     and parent#>>'{window,end}'=normal_end and window_end<=choice_day#>>'{shift,end}')) or window_start<case$seam$),
(8,$seam$if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'$seam$,$seam$if day_changed and window_start<complete_start and ((item->'owner_slot_id' is distinct from parent->'ownerSlotId'
     and not(coalesce(is_coverall,false) and parent->>'ownerSlotId'=replaced_id and item->>'owner_slot_id'=capacity_id))$seam$),
(9,$seam$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)$seam$,$seam$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
     and not(coalesce(is_coverall,false) and previous_owner=capacity_id and exists(
      select 1 from jsonb_array_elements(day_basis#>'{input,roster}') retained_owner
       where retained_owner->>'slotId'=replaced_id and retained_owner#>>'{shift,end}'=window_start))$seam$),
(10,$seam$  if day_changed then
   perform public.static_weekly_manual_assert_absence_score$seam$,$seam$  if day_changed and not coalesce(is_coverall,false) then
   perform public.static_weekly_manual_assert_absence_score$seam$)) x(n,before_text,after_text);
 changed:=original;
 FOR item IN SELECT x FROM jsonb_array_elements(seams) x LOOP
  IF length(changed)-length(replace(changed,item.x->>'before',''))<>length(item.x->>'before') THEN RAISE EXCEPTION 'Current native CoverAll seam changed: %',item.x->>'n';END IF;
  changed:=replace(changed,item.x->>'before',item.x->>'after');
 END LOOP;
 inverse:=changed;
 FOR item IN SELECT x FROM jsonb_array_elements(seams) x ORDER BY (x->>'n')::integer DESC LOOP inverse:=replace(inverse,item.x->>'after',item.x->>'before');END LOOP;
 IF inverse<>original THEN RAISE EXCEPTION 'Current native CoverAll whole inverse differs';END IF;EXECUTE changed;
END $copy_current_native_validator$;
-- Copy original readers once, preserving every existing exception and command.
DO $copy_readers$
DECLARE n text;original text;changed text;
BEGIN
 FOREACH n IN ARRAY ARRAY['static_weekly_compiler_exception_set','static_weekly_pending_original_exception_set','static_weekly_pending_exception_set'] LOOP
  original:=pg_get_functiondef(CASE n WHEN 'static_weekly_pending_original_exception_set' THEN 'public.static_weekly_pending_original_exception_set(uuid,date,uuid)'::regprocedure
   WHEN 'static_weekly_pending_exception_set' THEN 'public.static_weekly_pending_exception_set(uuid,uuid,date,date)'::regprocedure
   ELSE 'public.static_weekly_compiler_exception_set(uuid,date)'::regprocedure END);
  changed:=replace(original,'FUNCTION public.'||n||'(','FUNCTION public.coverall_original_'||n||'(');
  IF changed=original OR replace(changed,'FUNCTION public.coverall_original_'||n||'(','FUNCTION public.'||n||'(')<>original THEN RAISE EXCEPTION 'Original reader copy/inverse differs';END IF;
  EXECUTE changed;
 END LOOP;
END $copy_readers$;
CREATE FUNCTION public.static_weekly_coverall_sort_facts(p_facts jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') FROM jsonb_array_elements(p_facts) e
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_coverall_sort_facts(public.coverall_original_static_weekly_compiler_exception_set(p_publication_id,p_week_start)||public.static_weekly_coverall_effective_facts(p_publication_id,p_week_start,NULL))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_accepted_exception_set(p_publication_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_manual_exception_summary(public.static_weekly_compiler_exception_set(p_publication_id,p_week_start))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid,p_week_start date,p_operation uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_coverall_sort_facts(public.coverall_original_static_weekly_pending_original_exception_set(p_publication_id,p_week_start,p_operation)||public.static_weekly_coverall_effective_facts(p_publication_id,p_week_start,p_operation))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;facts jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 -- The original function retains all six-field/date/revision/roster checks.
 facts:=public.coverall_original_static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);
 SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO facts FROM jsonb_array_elements(facts) WITH ORDINALITY x(e,n)
 WHERE (e->>'coverAllOperationId'=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id::text ELSE p_operation::text END
  AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date AND (p_day IS NULL OR e->>'serviceDate'=p_day::text)) IS NOT TRUE;
 RETURN public.static_weekly_coverall_sort_facts(facts||public.static_weekly_coverall_pending_facts(p_operation,c.prepared_by_manager_id,p_publication,p_week,p_day));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_exact_fact(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_fact jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_pending_exception_set(p_operation,p_publication,p_frame,NULL)) e
  WHERE e=p_fact AND e ? 'coverAllChoiceId' AND EXISTS(SELECT 1 FROM custodial_coverall.choices q WHERE q.choice_id::text=e->>'coverAllChoiceId'));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_assert_dispatch(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d WHERE d->>'kind'='COVERALL') THEN
  RETURN public.static_weekly_coverall_assert_native_projection(p_operation,p_manager,p_envelope);
 END IF;
 RETURN public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_preparing_basis(p_manager uuid,p_operation uuid,p_publication uuid,p_frame date,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE basis jsonb;q custodial_coverall.choices%rowtype;d jsonb;r record;retained jsonb:='[]';sources jsonb:='[]';c public.static_weekly_staffing_commands%rowtype;
BEGIN
 basis:=public.static_weekly_manual_period_basis(p_manager,p_publication,p_frame,p_revision,p_operation);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 SELECT * INTO q FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF FOUND THEN
  FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') WHERE value->>'publicationId'=p_publication::text AND (value->>'serviceDate')::date BETWEEN p_frame AND p_frame+6 LOOP
   SELECT p.projection_id,p.projection_envelope,s.canonical_source INTO STRICT r FROM public.weekly_schedule_compiled_projections p
    JOIN public.static_weekly_authority_source_documents s ON s.source_id=(d->>'sourceId')::uuid
    WHERE p.projection_id=(d->>'retainedProjectionId')::uuid AND p.publication_id=p_publication AND p.projection_envelope->>'database_projection_identity'=d->>'retainedEnvelopeIdentity';
   retained:=retained||jsonb_build_array(jsonb_build_object('serviceDate',d->'serviceDate','sourceId',d->'sourceId','publicationId',p_publication,
    'projectionId',r.projection_id,'envelopeIdentity',d->'retainedEnvelopeIdentity','dayBasis',(SELECT x FROM jsonb_array_elements(r.projection_envelope#>'{authority,datedDayBases}') x WHERE x->'serviceDate'=d->'serviceDate')));
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources) s WHERE s->'sourceId'=d->'sourceId') THEN
    sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',d->'sourceId','publicationId',p_publication,'source',jsonb_set(r.canonical_source,'{serviceDate}',to_jsonb(p_frame::text),true)));END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('periodBasis',basis,'originalCommand',basis->'originalCommand','choice',q.choice_json,'retainedDays',retained,'normalSources',sources);
END $fn$;
-- Exact current Main-function hooks. These do NOT modify canonical Source301,
-- its memory fix, historical future-Monday bridge or six-field semantic.
DO $native_hooks$
DECLARE original text;changed text;inverse text;item record;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)',
  'public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope)',
  'public.static_weekly_coverall_assert_dispatch(p_operation,p_manager,p_envelope)'),
 ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)',
  ' -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE',
  E' perform public.static_weekly_coverall_stage_companion(p_operation_id,p_manager_id,p_candidates,p_preview_digest);\n -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE'),
 ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)',
  ' perform set_config(''app.static_weekly_staffing_batch_operation'',command.operation_id::text,true);',
  E' perform set_config(''app.static_weekly_staffing_batch_operation'',command.operation_id::text,true);\n perform public.static_weekly_coverall_accept_companion(command.operation_id,p_manager_id,v_revision);')
 ) v(signature,needle,replacement) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.signature));
  IF original IS NULL OR length(original)-length(replace(original,item.needle,''))<>length(item.needle) THEN RAISE EXCEPTION 'Exact native hook changed: %',item.signature;END IF;
  changed:=replace(original,item.needle,item.replacement);inverse:=replace(changed,item.replacement,item.needle);
  IF inverse<>original THEN RAISE EXCEPTION 'Native hook inverse mismatch';END IF;EXECUTE changed;
 END LOOP;
END $native_hooks$;
-- SAME physical checked client/transaction only. The existing deferred complete
-- receipt trigger prohibits COMMIT after begin or stage without finalization.
CREATE TABLE custodial_coverall.activation_progress(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_operations(operation_id),
 owner_xid xid8 NOT NULL,backend_pid integer NOT NULL,manager_id uuid NOT NULL,credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 source_id uuid NOT NULL,publication_id uuid NOT NULL,version_id uuid NOT NULL,frame_start date NOT NULL,authority_revision bigint NOT NULL,
 normal_result jsonb NOT NULL,basis_json jsonb NOT NULL,basis_digest text NOT NULL);
CREATE TABLE custodial_coverall.initial_operational_stages(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_progress(operation_id),
 envelope_json jsonb NOT NULL,lunch_json jsonb NOT NULL,candidate_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $initial_private_tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['activation_progress','initial_operational_stages'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('alter table custodial_coverall.%I force row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $initial_private_tables$;
CREATE FUNCTION public.static_weekly_coverall_record_activation_begin(p_operation uuid,p_manager uuid,p_credential uuid,p_device text,p_access text,p_normal_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a record;projection record;revision bigint;basis jsonb;body jsonb;
BEGIN
 SELECT o.*,p.source_id,p.service_date INTO STRICT a FROM custodial_coverall.activation_operations o
 JOIN custodial_coverall.activation_packets p USING(packet_id) WHERE o.operation_id=p_operation AND o.manager_id=p_manager AND o.owner_xid=pg_current_xact_id();
 SELECT p.publication_id,p.version_id,p.week_start,p.projection_id INTO STRICT projection FROM public.weekly_schedule_compiled_projections p
 JOIN public.weekly_schedule_versions v USING(version_id)
 WHERE v.authority_source_id=a.source_id AND p.week_start=a.service_date AND p.xmin=pg_current_xact_id()::text::xid;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 basis:=public.static_weekly_manual_period_basis(p_manager,projection.publication_id,a.service_date,revision,NULL);
 IF basis->>'sourceId'<>a.source_id::text OR basis->>'frameStart'<>a.service_date::text
  OR jsonb_array_length(basis->'employmentByDate')<>7 OR jsonb_array_length(basis->'employmentRevisionVector')<>14
 THEN RAISE EXCEPTION 'Main current employment-aware native basis (7reads/14bindings) is required';END IF;
 INSERT INTO custodial_coverall.activation_progress VALUES(p_operation,pg_current_xact_id(),pg_backend_pid(),p_manager,p_credential,p_device,p_access,
  a.source_id,projection.publication_id,projection.version_id,a.service_date,revision,p_normal_result,basis,basis->>'basisDigest');
 body:=jsonb_build_object('schema','custodial.coverall-initial-uncommitted.v1','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION','operationId',p_operation,
  'managerId',p_manager,'backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text,'sourceId',a.source_id,
  'publicationId',projection.publication_id,'versionId',projection.version_id,'frameStart',a.service_date,'frameEnd',a.service_date+6,
  'authorityRevision',revision,'basis',basis,'normalBaselineResult',p_normal_result,'normalBaselineIsNotActualCoverage',true,'committed',false,'accepted',false);
 RETURN body;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_initial_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_progress%rowtype;s custodial_coverall.initial_operational_stages%rowtype;fresh jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.activation_progress WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid()
  OR a.authority_revision<>(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
 THEN RAISE EXCEPTION 'Initial operational candidate must stay on its original physical transaction/revision';END IF;
 PERFORM public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 fresh:=public.static_weekly_manual_period_basis(p_manager,a.publication_id,a.frame_start,a.authority_revision,NULL);
 IF fresh IS DISTINCT FROM a.basis_json OR fresh->>'basisDigest'<>a.basis_digest
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Initial normal Source/canonical exceptions/7employment reads or14bindings changed';END IF;
 SELECT * INTO s FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 RETURN jsonb_build_object('schema','custodial.initial-employment-native-sql-context.v1','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
  'operationId',p_operation,'managerId',p_manager,'transactionId',a.owner_xid::text,'backendPid',a.backend_pid,
  'publicationId',a.publication_id,'versionId',a.version_id,'sourceId',a.source_id,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,
  'authorityRevision',a.authority_revision,'basis',fresh,'stagedEnvelope',s.envelope_json,'stagedLunch',s.lunch_json,'candidateDigest',s.candidate_digest);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_initial_assert_payload(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 IF ctx->'stagedEnvelope' IS DISTINCT FROM p_envelope OR ctx->>'candidateDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(
  jsonb_build_object('envelope',p_envelope,'lunch',ctx->'stagedLunch'))
 THEN RAISE EXCEPTION 'Exact staged original INITIAL_EMPLOYMENT_OPERATIONALIZATION data required';END IF;
 -- One explicit Main factoring seam; NOT a boolean, fake staffing command,
 -- optimizer attestation or I1 receipt. Main's entry must derive its context
 -- by calling initial_context above and preserve the real native checks.
 IF to_regprocedure('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Main factored initial-employment native guard not installed';END IF;
 EXECUTE 'select public.static_weekly_manual_assert_initial_employment_projection($1,$2,$3,$4)'
 INTO STRICT proof USING p_operation,p_manager,p_envelope,ctx->'stagedLunch';
 IF proof->'projection_assignments' IS DISTINCT FROM p_envelope->'assignments' OR jsonb_typeof(proof->'assignment_links')<>'object'
 THEN RAISE EXCEPTION 'Factored native guard must return complete checked assignment lineage';END IF;
 PERFORM public.static_weekly_manual_assert_native_lunch(NULL,ctx->'stagedLunch',p_envelope,(ctx->>'publicationId')::uuid,(ctx->>'frameStart')::date);
 RETURN proof;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_stage_initial_operational(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior custodial_coverall.initial_operational_stages%rowtype;fingerprint text;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 IF pg_column_size(p_envelope)>16777216 OR pg_column_size(p_lunch)>16777216 OR p_envelope IS NULL OR p_lunch IS NULL
 THEN RAISE EXCEPTION 'Bounded actual native candidate and full lunch required';END IF;
 fingerprint:=public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch));
 SELECT * INTO prior FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.envelope_json IS DISTINCT FROM p_envelope OR prior.lunch_json IS DISTINCT FROM p_lunch OR prior.candidate_digest<>fingerprint THEN RAISE EXCEPTION 'Immutable initial native candidate conflict';END IF;
 ELSE INSERT INTO custodial_coverall.initial_operational_stages(operation_id,envelope_json,lunch_json,candidate_digest) VALUES(p_operation,p_envelope,p_lunch,fingerprint);END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,p_envelope);
 RETURN jsonb_build_object('state','STAGED_UNCOMMITTED','operationId',p_operation,'candidateDigest',fingerprint,'committed',false);
END $fn$;
-- Mature native storage copy: all relational/owner/receipt/exception guards
-- remain. Only the exact original pending-command validation seam is replaced
-- by the immutable INITIAL-employment scope guard. No staff fact is synthesized.
DO $initial_sink_copy$
DECLARE original text;changed text;needle text;replacement text;inverse text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 changed:=replace(original,'FUNCTION public.static_weekly_pending_projection_sink(','FUNCTION public.static_weekly_coverall_initial_projection_sink(');
 needle:=$old$v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>'{semantic_snapshot,originalCommand,operationId}')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending sink requires actual original acceptance facts';END IF;$old$;
 replacement:=$new$v_pending_validation:=public.static_weekly_coverall_initial_assert_payload((p_assignments#>>'{semantic_snapshot,initialActivation,operationId}')::uuid,p_actor_manager_id,p_assignments);$new$;
 IF changed=original OR length(changed)-length(replace(changed,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact private native sink factoring seam changed';END IF;
 changed:=replace(changed,needle,replacement);inverse:=replace(replace(changed,replacement,needle),'FUNCTION public.static_weekly_coverall_initial_projection_sink(','FUNCTION public.static_weekly_pending_projection_sink(');
 IF inverse<>original THEN RAISE EXCEPTION 'Initial operational native sink whole inverse differs';END IF;EXECUTE changed;
END $initial_sink_copy$;
CREATE FUNCTION public.static_weekly_coverall_finalize_initial_operational(p_operation uuid,p_manager uuid,p_candidate_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_progress%rowtype;s custodial_coverall.initial_operational_stages%rowtype;ctx jsonb;proof jsonb;stored jsonb;lunch jsonb;receipt jsonb;projection uuid;actor jsonb;revision bigint;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT a FROM custodial_coverall.activation_progress WHERE operation_id=p_operation;
 SELECT * INTO STRICT s FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF s.candidate_digest IS DISTINCT FROM p_candidate_digest THEN RAISE EXCEPTION 'Original staged initial candidate identity required';END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,s.envelope_json);
 actor:=public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 IF s.envelope_json#>>'{semantic_snapshot,initialActivation,operationId}' IS DISTINCT FROM p_operation::text
  OR s.envelope_json#>'{authority,employmentRevisionVector}' IS DISTINCT FROM a.basis_json->'employmentRevisionVector'
 THEN RAISE EXCEPTION 'Original initial operation and all14 actual employment revisions must remain bound';END IF;
 stored:=public.static_weekly_coverall_initial_projection_sink(a.publication_id,a.frame_start,
  public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(a.publication_id,a.frame_start)),
  s.envelope_json->>'compiler_version',s.envelope_json->'objective',s.envelope_json->'metrics',s.envelope_json->>'replay_digest',
  s.envelope_json,a.authority_revision,p_manager,actor->>'manager_name','coverall-initial:'||p_operation);
 projection:=(stored#>>'{data,projection_id}')::uuid;
 IF projection IS NULL THEN RAISE EXCEPTION 'Native projection writer did not return actual projection ID';END IF;
 lunch:=public.static_weekly_v8_materialize_lunch_document(projection,s.lunch_json,p_manager);
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  WHERE p.projection_id=projection AND p.publication_id=a.publication_id AND p.projection_envelope=s.envelope_json
   AND l.document_json=s.lunch_json AND l.document_identity=s.lunch_json->>'document_identity')
 THEN RAISE EXCEPTION 'Actual same-transaction operational projection/full lunch missing';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-coverall-source-confirmation.v2','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
  'status','PERSISTED_CURRENT','operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,
  'versionId',a.version_id,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',revision,
  'normalBaselineResult',a.normal_result,'operationalProjectionResult',stored,'lunchResult',lunch,'projectionId',projection,
  'employmentRevisionVector',a.basis_json->'employmentRevisionVector','actualPositions',30,'originalHistoryPositions',22,
  'newNonemployeeCapacityPositions',8,'newEmployeesCreated',false,'weeklyBaselineChanged',false,'contractorBooked',false,
  'candidateDigest',s.candidate_digest,'samePhysicalTransaction',true);
 INSERT INTO custodial_coverall.activation_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_coverall_activation_confirmation(p_manager uuid,p_operation uuid,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT receipt_json INTO r FROM custodial_coverall.activation_receipts r JOIN custodial_coverall.activation_operations o USING(operation_id)
 WHERE o.manager_id=p_manager AND o.operation_id=p_operation;RETURN r;
END $fn$;
DO $typed_lunch_policy$
DECLARE original text;changed text;needle text:='jsonb_array_elements(d#>''{plan,lunchPlans}'')';replacement text:='jsonb_array_elements(case when d->>''kind''=''COVERALL'' then d#>''{overlay,lunchPlans}'' else d#>''{plan,lunchPlans}'' end)';
BEGIN
 original:=pg_get_functiondef('public.static_weekly_manual_native_lunch_policy(jsonb)'::regprocedure);
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact selected typed lunch policy seam changed';END IF;
 changed:=replace(original,needle,replacement);IF replace(changed,replacement,needle)<>original THEN RAISE EXCEPTION 'Typed lunch policy inverse mismatch';END IF;EXECUTE changed;
END $typed_lunch_policy$;
CREATE FUNCTION public.static_weekly_activate_coverall_source(p_manager uuid,p_packet uuid,p_operation uuid,p_revision bigint,p_preview text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Use the original checked transaction begin/stage/finalize path; no baseline-only activation';
END $fn$;
-- No SQL clients receive table DML or direct internal helper capabilities.
DO $new_function_acls$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY['coverall_original_static_weekly_compiler_exception_set','coverall_original_static_weekly_pending_exception_set','coverall_original_static_weekly_pending_original_exception_set','static_weekly_activate_coverall_source','static_weekly_begin_coverall_activation','static_weekly_coverall_accept_companion','static_weekly_coverall_activate_source301','static_weekly_coverall_activation_basis','static_weekly_coverall_activation_filtered_roster','static_weekly_coverall_assert_activation_data','static_weekly_coverall_assert_dispatch','static_weekly_coverall_assert_native_projection','static_weekly_coverall_assert_retained_day','static_weekly_coverall_bind_actor','static_weekly_coverall_capacity_availability','static_weekly_coverall_day_facts','static_weekly_coverall_effective_facts','static_weekly_coverall_exact_fact','static_weekly_coverall_finalize_initial_operational','static_weekly_coverall_initial_assert_payload','static_weekly_coverall_initial_context','static_weekly_coverall_initial_projection_sink','static_weekly_coverall_pending_facts','static_weekly_coverall_preparing_basis','static_weekly_coverall_record_activation_begin','static_weekly_coverall_register_template','static_weekly_coverall_require_activation_receipt','static_weekly_coverall_sort_facts','static_weekly_coverall_stage_companion','static_weekly_coverall_stage_initial_operational','static_weekly_coverall_validate_choice_day','static_weekly_prepare_coverall_activation','static_weekly_prepare_coverall_choice','static_weekly_read_coverall_activation_confirmation']) LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator',f.signature);
 END LOOP;
END $new_function_acls$;
-- Existing public reader ACLs remain literal under CREATE OR REPLACE.
GRANT EXECUTE ON FUNCTION public.static_weekly_prepare_coverall_activation(jsonb) TO static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.static_weekly_coverall_preparing_basis(uuid,uuid,uuid,date,bigint),
 public.static_weekly_prepare_coverall_choice(jsonb,uuid,text,text),public.static_weekly_coverall_bind_actor(uuid,uuid,uuid,text,text),
 public.static_weekly_begin_coverall_activation(uuid,uuid,uuid,bigint,text,uuid,text,text),
 public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb),public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text),
 public.static_weekly_read_coverall_activation_confirmation(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;
-- Main must enroll exact tables/functions/ACLs/mutation fences in its existing
-- canonical capture/canary transaction before adoption. This file is a proposal.
CREATE TABLE custodial_coverall.activation_request_aliases(
 manager_id uuid NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 120),
 operation_id uuid UNIQUE NOT NULL REFERENCES custodial_coverall.activation_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 request_json jsonb NOT NULL,request_digest text NOT NULL,PRIMARY KEY(manager_id,idempotency_key));
ALTER TABLE custodial_coverall.activation_request_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_coverall.activation_request_aliases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_coverall.activation_request_aliases FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON custodial_coverall.activation_request_aliases FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
ALTER TABLE custodial_coverall.activation_request_aliases ENABLE ALWAYS TRIGGER immutable;
CREATE FUNCTION public.static_weekly_read_coverall_activation_basis(p_manager uuid,p_packet uuid,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE packet record;snapshot jsonb;employment jsonb:='[]';vector jsonb;d date;body jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT packet_id,source_id,template_id,manager_id,service_date,expected_revision,roster_digest,preview_digest,packet_fingerprint,source_digest INTO packet
 FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 IF NOT FOUND THEN RETURN NULL;END IF;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF packet.manager_id<>p_manager OR packet.expected_revision<>p_revision OR p_revision::text<>snapshot->>'authorityRevision'
  OR packet.service_date::text<>snapshot->>'serviceDate' OR packet.roster_digest<>public.static_weekly_digest_jsonb(snapshot)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original current typed activation packet/manager/date/roster/revision changed';END IF;
 FOR d IN SELECT generate_series(packet.service_date,packet.service_date+6,'1 day')::date LOOP
  employment:=employment||jsonb_build_array(custodial_employment.native_read(d,p_revision,p_manager));END LOOP;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',day->'serviceDate','employeeId',e->'employeeId','employmentRevision',e->'employmentRevision','requestId',e#>'{command,requestId}') ORDER BY day->>'serviceDate',e->>'employeeId')
 INTO vector FROM jsonb_array_elements(employment) days(day) CROSS JOIN LATERAL jsonb_array_elements(day->'employees') employees(e);
 IF jsonb_array_length(vector)<>14 THEN RAISE EXCEPTION 'Actual fourteen employment bindings required';END IF;
 body:=jsonb_build_object('schema','custodial.approved-manual-coverall-activation-preview-basis.v2','managerId',p_manager,'packetId',p_packet,
  'sourceId',packet.source_id,'templateId',packet.template_id,'serviceDate',packet.service_date,'windowEnd',packet.service_date+6,'expectedRevision',p_revision,
  'packetPreviewDigest',packet.preview_digest,'packetFingerprint',packet.packet_fingerprint,'sourceDigest',packet.source_digest,'employmentRevisionVector',vector,
  'currentPositions',22,'additionalCapacityPositions',8,'prospectivePositions',30,'newEmployees',0);
 RETURN body||jsonb_build_object('previewDigest',public.static_weekly_digest_jsonb(body),'normalPatternSolverInvoked',false,'operationalAdjustmentPending',true,'published',false);
END $fn$;
CREATE FUNCTION public.static_weekly_read_coverall_activation_request(p_manager uuid,p_key text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_request_aliases%rowtype;receipt jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT * INTO a FROM custodial_coverall.activation_request_aliases WHERE manager_id=p_manager AND idempotency_key=p_key;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.activation_receipts WHERE operation_id=a.operation_id;
 IF a.request_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(a.request_json) OR receipt->>'operationId'<>a.operation_id::text OR receipt->>'managerId'<>p_manager::text
 THEN RAISE EXCEPTION 'Original activation request/receipt integrity changed';END IF;
 RETURN jsonb_build_object('request',a.request_json,'receipt',receipt,'operationId',a.operation_id);
END $fn$;
CREATE FUNCTION public.static_weekly_bind_coverall_activation_request(p_manager uuid,p_operation uuid,p_key text,p_packet uuid,p_revision bigint,p_preview text,p_credential uuid,p_device text,p_access text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE request jsonb;prior custodial_coverall.activation_request_aliases%rowtype;preview jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_operation IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 120 OR p_key<>btrim(p_key)
 THEN RAISE EXCEPTION 'Original activation operation/key required';END IF;
 request:=jsonb_build_object('managerId',p_manager,'packetId',p_packet,'operationId',p_operation,'expectedRevision',p_revision,'previewDigest',p_preview,'idempotencyKey',p_key);
 SELECT * INTO prior FROM custodial_coverall.activation_request_aliases WHERE (manager_id=p_manager AND idempotency_key=p_key) OR operation_id=p_operation;
 IF FOUND THEN
  IF prior.manager_id<>p_manager OR prior.idempotency_key<>p_key OR prior.request_json IS DISTINCT FROM request THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original activation operation/key semantic conflict';END IF;RETURN;
 END IF;
 preview:=public.static_weekly_read_coverall_activation_basis(p_manager,p_packet,p_revision);
 IF preview IS NULL OR preview->>'previewDigest' IS DISTINCT FROM p_preview THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Typed activation/employment preview changed';END IF;
 INSERT INTO custodial_coverall.activation_request_aliases VALUES(p_manager,p_key,p_operation,request,public.static_weekly_digest_jsonb(request));
END $fn$;
CREATE FUNCTION public.static_weekly_list_coverall_activation_choices(p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;day date;v_authority_revision bigint;choices jsonb;active jsonb;authority jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 day:=public.sch_service_date(statement_timestamp());snapshot:=public.static_weekly_manual_roster_snapshot(day);v_authority_revision:=(snapshot->>'authorityRevision')::bigint;
 SELECT coalesce(jsonb_agg(jsonb_build_object('packetId',p.packet_id,'label','Owner-approved seven-day normal schedule with source-bound CoverAll capacity',
  'serviceDate',p.service_date,'windowEnd',p.service_date+6,'expectedRevision',p.expected_revision,'activationEligible',true) ORDER BY p.packet_id),'[]') INTO choices
 FROM custodial_coverall.activation_packets p WHERE p.manager_id=p_manager AND p.service_date=day AND p.expected_revision=v_authority_revision
  AND p.roster_digest=public.static_weekly_digest_jsonb(snapshot) AND jsonb_array_length(snapshot->'rosterSlots')=22
  AND NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_operations o WHERE o.packet_id=p.packet_id);
 SELECT to_jsonb(a) INTO authority FROM public.static_weekly_v6_schedule_authority_state(day) a;
 SELECT jsonb_build_object('sourceId',v.authority_source_id,'publicationId',pub.publication_id,
  'projectionId',CASE WHEN authority->>'publication_id'=pub.publication_id::text THEN authority->'projection_id' ELSE 'null'::jsonb END,
  'authorityRevision',v_authority_revision,'projectionStatus',authority->>'projection_status','normalSourceLocked',true,
  'initialOperationId',o.operation_id,'initialProjectionId',r.receipt_json->'projectionId') INTO active
 FROM custodial_coverall.activation_operations o JOIN custodial_coverall.activation_packets p USING(packet_id)
 JOIN custodial_coverall.activation_receipts r USING(operation_id)
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=p.source_id
 JOIN public.weekly_schedule_publications pub USING(version_id)
 WHERE v.version_id=public.static_weekly_effective_version(day) AND r.receipt_json->>'schema'='custodial.approved-manual-coverall-source-confirmation.v2';
 RETURN jsonb_build_object('schema','custodial.approved-manual-activation-options.v2','serviceDate',day,'authorityRevision',v_authority_revision,'choices',choices,'active',active);
END $fn$;
-- Reversible two literal seams in the already-installed begin/finalize; all
-- Source301 copies, normal baseline, eight-slot registration and sinks remain.
DO $cp_companion_hooks$
DECLARE original text;changed text;inverse text;item record;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_begin_coverall_activation(uuid,uuid,uuid,bigint,text,uuid,text,text)',
  'packet.preview_digest<>p_preview',
  'p_preview IS DISTINCT FROM (public.static_weekly_read_coverall_activation_basis(p_manager,p_packet,p_revision)->>''previewDigest'')'),
 ('public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text)',
  '''candidateDigest'',s.candidate_digest,''samePhysicalTransaction'',true',
  '''candidateDigest'',s.candidate_digest,''revision'',revision,''lunchDocumentIdentity'',s.lunch_json->>''document_identity'',''normalPatternSolverInvoked'',false,''operationalSelectionSolverInvoked'',s.envelope_json#>''{receipt,selectionSolverInvoked}'',''samePhysicalTransaction'',true')
 ) v(signature,needle,replacement) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.signature));
  IF original IS NULL OR length(original)-length(replace(original,item.needle,''))<>length(item.needle) THEN RAISE EXCEPTION 'Exact installed CP companion predecessor changed: %',item.signature;END IF;
  changed:=replace(original,item.needle,item.replacement);inverse:=replace(changed,item.replacement,item.needle);
  IF inverse<>original THEN RAISE EXCEPTION 'CP companion whole inverse mismatch';END IF;EXECUTE changed;
 END LOOP;
END $cp_companion_hooks$;
REVOKE ALL ON FUNCTION public.static_weekly_read_coverall_activation_basis(uuid,uuid,bigint),public.static_weekly_read_coverall_activation_request(uuid,text,uuid,text,text),
 public.static_weekly_bind_coverall_activation_request(uuid,uuid,text,uuid,bigint,text,uuid,text,text),public.static_weekly_list_coverall_activation_choices(uuid)
 FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_coverall_activation_basis(uuid,uuid,bigint),public.static_weekly_read_coverall_activation_request(uuid,text,uuid,text,text),
 public.static_weekly_bind_coverall_activation_request(uuid,uuid,text,uuid,bigint,text,uuid,text,text),public.static_weekly_list_coverall_activation_choices(uuid) TO static_weekly_control_plane;
-- Main enrolls these new companion objects/ACLs/fences in its canonical capture.
COMMIT;
