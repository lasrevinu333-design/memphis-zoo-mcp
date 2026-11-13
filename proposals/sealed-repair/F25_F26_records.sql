-- Staged completed-record/read projection successor. Main allocates canonical identity.
-- No historical definition/grant is changed; named/cohort wrappers independently authorize.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $predecessors$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_append_session_correction(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '1fb800111fa8c6f72d4f0fac47ec3d27eb4600d9b843f8e99e98de5d5d190892' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_append_session_correction'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_manager_open_problems(uuid,integer,text)'::regprocedure)) IS DISTINCT FROM 'd4acd3e3e7b7219aca9b1222ac31efb95522739b090ab51f3887efcb698e8e7d' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_manager_open_problems'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_manager_get_session_truth(uuid,uuid,text)'::regprocedure)) IS DISTINCT FROM '4a6ce83a52c607df1544be726a7f7b0a6b4710465cd7355fd47c73fabbde9e73' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_manager_get_session_truth'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_action_actor_v1(uuid,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM '95ae99a83afdd36703f4bbe439856cd43c774f0662751d1ef8ab38728dc6c872' THEN RAISE EXCEPTION 'Record predecessor differs: custodial_action_actor_v1'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'f194815b5f6a7b7fd5772df7ed94d6e0c42545ddce5a63b7a0ba436f036a598a' THEN RAISE EXCEPTION 'Record predecessor differs: static_weekly_leadership_bind_verified_request'; END IF;
END $predecessors$;

CREATE FUNCTION custodial_leadership_private.record_operation_v1(p_actor jsonb,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions
AS $record$
DECLARE
 p_operation_id uuid;p_session_id uuid;p_manager_id uuid;p_reason text;
 p_corrected_employee_id uuid;p_corrected_location_id uuid;p_corrected_device_id uuid;
 p_corrected_started_at timestamptz;p_corrected_ended_at timestamptz;
 v_fingerprint text;v_existing public.custodial_session_corrections%rowtype;v_current record;
 v_manager_name text;v_employee record;v_location record;v_device record;
 v_employee_id uuid;v_location_id uuid;v_device_id uuid;v_started_at timestamptz;v_ended_at timestamptz;
 v_changed_fields text[];v_inserted public.custodial_session_corrections%rowtype;
 v_result jsonb;v_limit integer;v_key text;v_status text;v_session_uuid text;v_current_correction uuid;
BEGIN
 IF p_actor->>'manager_id' IS NULL OR (p_actor->>'actor_kind' IN ('NAMED_MANAGER','CUSTODIAL_LEADERSHIP_COHORT')) IS NOT TRUE THEN
  RAISE EXCEPTION 'Authorized record actor required' USING ERRCODE='42501'; END IF;
 p_manager_id:=(p_actor->>'manager_id')::uuid;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>16384 THEN
  RAISE EXCEPTION 'Bounded typed record input required' USING ERRCODE='22023';END IF;
 IF p_action='choices' THEN
  IF p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'No choices parameters allowed' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM public.employees)>5000 OR (SELECT count(*) FROM public.locations)>5000 OR (SELECT count(*) FROM public.devices)>5000 THEN
   RAISE EXCEPTION 'Complete bounded choices unavailable' USING ERRCODE='54000';END IF;
  RETURN jsonb_build_object(
   'employees',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',display_name) ORDER BY display_name,id),'[]'::jsonb) FROM public.employees),
   'locations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',location_name||' ('||location_code||')') ORDER BY location_name,id),'[]'::jsonb) FROM public.locations),
   'devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',device_name||' ('||device_id||')') ORDER BY device_name,id),'[]'::jsonb) FROM public.devices));
 ELSIF p_action='open_problems' THEN
  IF NOT(p_input ? 'limit') OR (p_input-ARRAY['limit'])<>'{}'::jsonb OR jsonb_typeof(p_input->'limit') IS DISTINCT FROM 'number'
   OR (p_input->>'limit')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Integer problem limit required' USING ERRCODE='22023';END IF;
  v_limit:=(p_input->>'limit')::integer;IF v_limit<1 OR v_limit>200 THEN RAISE EXCEPTION 'Problem limit out of bounds' USING ERRCODE='22023';END IF;
  with items as (
    select 'maintenance'::text as source, t.id::text as source_id,
      case when t.issue_source='completion_form' then 'Cleaning issue / maintenance reminder'
        else 'Maintenance reminder' end as source_label,
      coalesce(t.location_name_snapshot,l.location_name,t.location_code_snapshot,l.location_code) as location,
      t.issue_summary as summary,t.reported_at as observed_at,'open'::text as status,
      t.issue_source as source_detail
    from public.maintenance_tickets t left join public.locations l on l.id=t.location_id
    where t.status='open'
    union all
    select 'guest'::text,g.id::text,'Approved guest issue'::text,
      coalesce(g.location_name,g.location_code),g.issue_type,g.submitted_at,'open'::text,g.severity
    from public.guest_cleanliness_reports g
    where g.status='open' and g.marketing_review_status='approved'
      and exists(select 1 from public.system_settings s where s.setting_key='guest_issues_feature_approved'
        and s.setting_value='true'::jsonb)
    union all
    select 'saved_work'::text,r.reconciliation_id::text,'Protected saved work needs review'::text,
      coalesce(l.location_name,l.location_code,'Location not available'),
      'Protected work requires manager review'::text,r.created_at,
      'quarantined'::text,'offline_reconciliation'::text
    from public.custodial_offline_reconciliation_records r
    left join public.locations l on l.id=r.location_id
    where r.state='quarantined' and not exists (
      select 1 from public.custodial_offline_reconciliation_dispositions d
      where d.reconciliation_id=r.reconciliation_id and d.disposition='superseded_by_new_occurrence'
    )
  ), bounded as (
    select * from items order by observed_at desc nulls last,source,source_id limit v_limit
  )
  select jsonb_build_object('total',(select count(*) from items),
    'items',coalesce(jsonb_agg(to_jsonb(b) order by b.observed_at desc nulls last,b.source,b.source_id),'[]'::jsonb))
    into v_result from bounded b;
  RETURN v_result||jsonb_build_object('schema','custodial.open-problems.v1','generated_at',clock_timestamp());
 ELSIF p_action='truth' THEN
  IF NOT(p_input ? 'session_id') OR (p_input-ARRAY['session_id'])<>'{}'::jsonb OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Session identity required' USING ERRCODE='22023';END IF;
  SELECT to_jsonb(v) INTO v_result FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=(p_input->>'session_id')::uuid;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;RETURN v_result;
 ELSIF p_action='correction_outcome' THEN
  IF NOT(p_input ?& ARRAY['session_id','operation_id']) OR (p_input-ARRAY['session_id','operation_id'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Original operation and session required' USING ERRCODE='22023';END IF;
  p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
  SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id AND session_id=p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false,'operation_id',p_operation_id,'session_id',p_session_id);END IF;
  RETURN jsonb_build_object('found',true,'correction_id',v_existing.correction_id,'session_id',v_existing.session_id,
   'operation_id',v_existing.operation_id,'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at,
   'actor_manager_id',v_existing.corrected_by_manager_id,'actor_name',v_existing.corrected_by_manager_name_snapshot,'reason',v_existing.reason);
 ELSIF p_action IS DISTINCT FROM 'correct' THEN RAISE EXCEPTION 'Record action unsupported' USING ERRCODE='22023';END IF;
 IF NOT(p_input ?& ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid'])
  OR (p_input-ARRAY['session_id','operation_id','reason','expected_correction_id','expected_session_uuid','corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'])<>'{}'::jsonb
  OR jsonb_typeof(p_input->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'operation_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'expected_session_uuid') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'expected_correction_id') NOT IN ('string','null')
  OR length(p_input->>'expected_session_uuid') NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Typed correction and preview marker required' USING ERRCODE='22023';END IF;
 FOREACH v_key IN ARRAY ARRAY['corrected_employee_id','corrected_location_id','corrected_device_id','corrected_started_at','corrected_ended_at'] LOOP
  IF p_input ? v_key AND jsonb_typeof(p_input->v_key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Typed correction fact required' USING ERRCODE='22023';END IF;
  IF v_key LIKE '%_at' AND p_input->>v_key IS NOT NULL AND (p_input->>v_key)!~'^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,6})?)?(Z|[+-]\d\d:\d\d)$' THEN
   RAISE EXCEPTION 'Explicit timestamp offset required' USING ERRCODE='22023';END IF;
 END LOOP;
 p_session_id:=(p_input->>'session_id')::uuid;p_operation_id:=(p_input->>'operation_id')::uuid;
 p_reason:=btrim(p_input->>'reason');IF length(p_reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Correction reason required' USING ERRCODE='22023';END IF;
 p_corrected_employee_id:=(p_input->>'corrected_employee_id')::uuid;p_corrected_location_id:=(p_input->>'corrected_location_id')::uuid;p_corrected_device_id:=(p_input->>'corrected_device_id')::uuid;
 p_corrected_started_at:=(p_input->>'corrected_started_at')::timestamptz;p_corrected_ended_at:=(p_input->>'corrected_ended_at')::timestamptz;
 v_manager_name:=CASE WHEN p_actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' THEN (p_actor->>'claimed_name')||' (shared PIN; self-asserted)' ELSE p_actor->>'manager_name' END;
 IF nullif(btrim(v_manager_name),'') IS NULL THEN RAISE EXCEPTION 'Original actor label required' USING ERRCODE='42501';END IF;
 v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('actor_kind',p_actor->>'actor_kind','manager_id',p_manager_id,
  'claimed_account_id',p_actor->>'claimed_account_id','operation_id',p_operation_id,'session_id',p_session_id,'reason',p_reason,
  'expected_session_uuid',p_input->>'expected_session_uuid','expected_correction_id',(p_input->>'expected_correction_id')::uuid,
  'employee_id',p_corrected_employee_id,'location_id',p_corrected_location_id,'device_id',p_corrected_device_id,
  'started_at',p_corrected_started_at,'ended_at',p_corrected_ended_at)::text,'UTF8'),'sha256'),'hex');
 -- Serialize the original operation before inspecting its durable result.
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial.record.operation:'||p_operation_id::text,0));
 SELECT * INTO v_existing FROM public.custodial_session_corrections WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'Correction operation payload differs' USING ERRCODE='40901';END IF;
  RETURN jsonb_build_object('correction_id',v_existing.correction_id,'session_id',v_existing.session_id,'operation_id',v_existing.operation_id,
   'replayed',true,'changed_fields',v_existing.changed_fields,'created_at',v_existing.created_at);
 END IF;
 -- Lock first, then use a new statement snapshot to read the latest correction.
 SELECT s.status,s.session_uuid INTO v_status,v_session_uuid FROM public.sessions s WHERE s.id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cleaning session not found' USING ERRCODE='P0002';END IF;
 IF v_status IS DISTINCT FROM 'closed' THEN RAISE EXCEPTION 'Only completed records can be corrected here' USING ERRCODE='40901';END IF;
 SELECT v.current_employee_id employee_id,v.current_location_id location_id,v.current_device_id device_id,
  v.current_started_at started_at,v.current_ended_at ended_at,v.correction_id INTO v_current
 FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=p_session_id;
 IF v_current.ended_at IS NULL OR v_session_uuid IS DISTINCT FROM p_input->>'expected_session_uuid'
  OR v_current.correction_id IS DISTINCT FROM (p_input->>'expected_correction_id')::uuid THEN
  RAISE EXCEPTION 'Correction preview no longer matches completed record' USING ERRCODE='40901';END IF;
  v_employee_id := coalesce(p_corrected_employee_id,v_current.employee_id);
  v_location_id := coalesce(p_corrected_location_id,v_current.location_id);
  v_device_id := coalesce(p_corrected_device_id,v_current.device_id);
  v_started_at := coalesce(p_corrected_started_at,v_current.started_at);
  v_ended_at := coalesce(p_corrected_ended_at,v_current.ended_at);

  v_changed_fields := array_remove(array[
    case when v_employee_id is distinct from v_current.employee_id then 'employee' end,
    case when v_location_id is distinct from v_current.location_id then 'location' end,
    case when v_device_id is distinct from v_current.device_id then 'device' end,
    case when v_started_at is distinct from v_current.started_at then 'started_at' end,
    case when v_ended_at is distinct from v_current.ended_at then 'ended_at' end
  ],null);
  if cardinality(v_changed_fields) = 0 then
    raise exception using errcode='22023', message='Correction must change at least one manager-visible fact';
  end if;
  if v_ended_at is not null and v_ended_at < v_started_at then
    raise exception using errcode='22023', message='Corrected cleaning end time cannot precede its start time';
  end if;

  select e.id,e.display_name into v_employee from public.employees e where e.id = v_employee_id;
  select l.id,l.location_code,l.location_name into v_location from public.locations l where l.id = v_location_id;
  select d.id,d.device_id,d.device_name,d.assignment_epoch into v_device from public.devices d where d.id = v_device_id;
  if v_employee.id is null or v_location.id is null or v_device.id is null then
    raise exception using errcode='23503', message='Corrected employee, location, and phone must exist';
  end if;

  insert into public.custodial_session_corrections(
    operation_id,request_fingerprint,session_id,corrected_by_manager_id,corrected_by_manager_name_snapshot,
    reason,changed_fields,effective_employee_id,effective_employee_name_snapshot,effective_location_id,
    effective_location_code_snapshot,effective_location_name_snapshot,effective_device_id,
    effective_device_identifier_snapshot,effective_device_name_snapshot,effective_assignment_epoch_snapshot,
    effective_started_at,effective_ended_at
  ) values (
    p_operation_id,v_fingerprint,p_session_id,p_manager_id,v_manager_name,btrim(p_reason),v_changed_fields,
    v_employee.id,v_employee.display_name,v_location.id,v_location.location_code,v_location.location_name,
    v_device.id,v_device.device_id,v_device.device_name,v_device.assignment_epoch,v_started_at,v_ended_at
  ) returning * into v_inserted;

  INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
   VALUES(NULL,p_actor->>'device_id','cleaning_record_correction_recorded',true,jsonb_build_object('correction_id',v_inserted.correction_id,'operation_id',p_operation_id,'session_id',p_session_id,'actor',p_actor));
  return jsonb_build_object('correction_id',v_inserted.correction_id,'session_id',v_inserted.session_id,
    'operation_id',v_inserted.operation_id,'replayed',false,'changed_fields',v_inserted.changed_fields,
    'created_at',v_inserted.created_at);
END $record$;
REVOKE ALL ON FUNCTION custodial_leadership_private.record_operation_v1(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

CREATE FUNCTION public.custodial_named_record_operation_v1(p_manager_id uuid,p_backend_execution_secret text,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $named$
DECLARE actor jsonb;
BEGIN
 PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 SELECT jsonb_build_object('actor_kind','NAMED_MANAGER','manager_id',m.manager_id,'manager_name',m.display_name)
 INTO actor FROM public.ops_manager_managers m WHERE m.manager_id=p_manager_id AND m.active=true AND m.revoked_at IS NULL
  AND m.is_system_principal=false AND m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
 IF actor IS NULL THEN RAISE EXCEPTION 'Active named manager required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $named$;
REVOKE ALL ON FUNCTION public.custodial_named_record_operation_v1(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_named_record_operation_v1(uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.custodial_leadership_record_operation_v1(p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $cohort$
DECLARE actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access',CASE WHEN p_action='correct' THEN 'write' ELSE 'read' END);
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.record_operation_v1(actor,p_action,p_input);
END $cohort$;
REVOKE ALL ON FUNCTION public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb) TO static_weekly_control_plane;
COMMIT;
