-- Main implementation component. Apply only after the native period and typed
-- CoverAll workflow components. This exposes no private table or secret.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';

CREATE FUNCTION public.static_weekly_read_coverall_choice_summary(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;q custodial_coverall.choices%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.static_weekly_v3_manager_actor(p_manager);
 SELECT * INTO c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF NOT FOUND OR c.prepared_by_manager_id IS DISTINCT FROM p_manager THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original staffing preparer required';
 END IF;
 SELECT * INTO q FROM custodial_coverall.choices
 WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('choiceId',q.choice_id,'choiceDigest',q.choice_digest,
  'operationId',q.operation_id,'semanticDigest',q.semantic_digest,'expectedRevision',q.expected_revision);
END $fn$;

CREATE FUNCTION public.static_weekly_read_coverall_manager_basis(p_manager uuid,p_operation uuid,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;command jsonb;choice jsonb;
 basis jsonb;frame_row jsonb;day_basis jsonb;r record;source_id uuid;publication uuid;frame date;service date;
 retained jsonb:='[]';sources jsonb:='[]';periods jsonb:='[]';revision bigint;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF c.prepared_by_manager_id IS DISTINCT FROM p_manager THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original staffing preparer required';
 END IF;
 command:=public.static_weekly_v10_read_staffing_command(p_operation,p_manager);
 SELECT q.choice_json INTO choice FROM custodial_coverall.choices q
 WHERE q.operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 -- History and UNKNOWN reconciliation never grant permission to prepare again.
 IF c.state<>'PREPARING' OR c.command_kind<>'absence' THEN
  RETURN jsonb_build_object('schema','custodial.approved-manual-coverall-manager-basis.v1',
   'managerId',p_manager,'operationId',p_operation,'state',c.state,'command',command,
   'originalCommand',NULL,'choice',choice,'retainedDays',retained,'normalSources',sources,
   'authorityRevision',revision,'eligible',false);
 END IF;
 IF c.expected_revision IS DISTINCT FROM revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original third-absence revision changed';
 END IF;
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 FOR frame_row IN SELECT value FROM jsonb_array_elements(
  public.static_weekly_staffing_period_frames(p_operation,p_manager)->'frames') LOOP
  service:=(frame_row->>'serviceDate')::date;frame:=(frame_row->>'frameStart')::date;
  SELECT p.publication_id,v.authority_source_id INTO STRICT publication,source_id
  FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
  WHERE v.version_id=public.static_weekly_effective_version(service);
  SELECT value INTO basis FROM jsonb_array_elements(periods)
  WHERE value->>'publicationId'=publication::text AND value->>'frameStart'=frame::text;
  IF NOT FOUND THEN
   basis:=public.static_weekly_manual_period_basis(p_manager,publication,frame,revision,p_operation);
   periods:=periods||jsonb_build_array(basis);
  END IF;
  SELECT value INTO day_basis FROM jsonb_array_elements(basis->'priorDayBases')
  WHERE value->>'serviceDate'=service::text;
  IF NOT FOUND OR day_basis->>'kind'<>'ABSENCE'
   OR jsonb_array_length(day_basis#>'{input,absentPersonIds}')<>2
   OR (day_basis#>'{input,absentPersonIds}')?(c.semantic_body->>'employeeId')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(day_basis#>'{input,roster}') x
    WHERE x->>'personId'=c.semantic_body->>'employeeId') THEN CONTINUE;END IF;
  SELECT p.projection_id,p.projection_envelope INTO STRICT r
  FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  WHERE p.projection_id=(basis#>>'{priorProjection,projectionId}')::uuid
   AND p.publication_id=publication AND p.week_start=frame AND p.week_end=frame+6
   AND p.projection_envelope->>'database_projection_identity'=
    public.static_weekly_digest_jsonb(p.projection_envelope-'database_projection_identity');
  IF day_basis#>>'{plan,planDigest}' IS DISTINCT FROM
    public.static_weekly_digest_jsonb((day_basis->'plan')-'planDigest')
   OR day_basis#>>'{input,sourceDigest}' IS DISTINCT FROM public.static_weekly_digest_jsonb(basis->'normalSource') THEN
   RAISE EXCEPTION 'Retained two-absence source or plan identity changed';
  END IF;
  retained:=retained||jsonb_build_array(jsonb_build_object('serviceDate',service::text,
   'sourceId',source_id,'publicationId',publication,'projectionId',r.projection_id,
   'envelopeIdentity',r.projection_envelope->'database_projection_identity','dayBasis',day_basis));
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources) x
   WHERE x->>'sourceId'=source_id::text AND x->>'publicationId'=publication::text
    AND x#>>'{source,serviceDate}'=frame::text) THEN
   sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',source_id,
    'publicationId',publication,'source',basis->'normalSource'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('schema','custodial.approved-manual-coverall-manager-basis.v1',
  'managerId',p_manager,'operationId',p_operation,'state',c.state,'command',command,
  'originalCommand',ctx->'originalCommand','choice',choice,'retainedDays',retained,
  'normalSources',sources,'authorityRevision',revision,'eligible',jsonb_array_length(retained)>0);
END $fn$;

REVOKE ALL ON FUNCTION public.static_weekly_read_coverall_choice_summary(uuid,uuid),
 public.static_weekly_read_coverall_manager_basis(uuid,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader,static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_coverall_choice_summary(uuid,uuid),
 public.static_weekly_read_coverall_manager_basis(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;
COMMIT;
