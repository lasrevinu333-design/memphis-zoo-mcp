-- Independent audit T002: original completion projection shared by authenticated named/cohort readers.
BEGIN;
DO $guard$ BEGIN
 IF encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_manager_completion_evidence(uuid,text,text)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM 'fa84ea9975f52cb156dd5383b20548c78dfdfc497ec553f27a4a0efed3812ac1' THEN RAISE EXCEPTION 'Completion reader predecessor changed: public.custodial_manager_completion_evidence(uuid,text,text)'; END IF;
 IF encode(extensions.digest(convert_to(pg_get_functiondef('custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'::regprocedure),'UTF8'),'sha256'),'hex') IS DISTINCT FROM '1483b360a49c661c97e53d27756f62e3dc45a4c435e101605185f718e2e83c88' THEN RAISE EXCEPTION 'Completion reader predecessor changed: custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION custodial_leadership_private.completion_evidence_v1(p_session_uuid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare s public.sessions%rowtype; r public.completion_responses%rowtype;
 v_catalog jsonb; v_digest text; v_native boolean:=false;
 v_issue boolean; v_issue_known boolean:=false; v_work text; v_class text; v_raw_issue_count integer:=0;
 v_open integer:=0; v_work_order integer:=0; v_fixed integer:=0; v_legacy_closed integer:=0; v_total integer:=0;
 v_tickets jsonb:='[]'::jsonb; v_follow_up text;
begin
 select * into s from public.sessions where session_uuid=p_session_uuid;
 if not found then raise exception using errcode='P0002',message='cleaning session was not found'; end if;
 select * into r from public.completion_responses where session_id=s.id;
 if not found then
  return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,
   'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
   'started_at',s.started_at,'ended_at',s.ended_at,
   'session_status',s.status,'completion_recorded',false,'classification','no_completion_record',
   'inspection_evaluation','not_performed_by_this_reader');
 end if;
 select c.catalog_json,c.catalog_sha256 into v_catalog,v_digest from public.custodial_completion_taxonomy_versions c
  where c.version=r.response_json#>>'{taxonomy,version}';
 select exists(
  select 1 from public.custodial_offline_reconciliation_records receipt
  join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
  where receipt.completion_response_id=r.id and receipt.session_id=s.id
   and receipt.state='committed' and context.status='committed' and s.status='closed'
   and receipt.occurrence_id=context.occurrence_id and receipt.occurrence_fingerprint=context.occurrence_fingerprint
   and receipt.credential_id=context.credential_id and receipt.location_id=s.location_id
   and context.location_id=s.location_id and r.location_id=s.location_id
   and context.client_session_id=s.client_session_id and receipt.client_session_id=s.client_session_id
   and receipt.client_completion_id=r.client_completion_id and receipt.original_employee_id=s.employee_id
   and context.employee_id=s.employee_id and receipt.device_id=s.device_id and context.device_id=s.device_id
   and r.device_id=s.device_id and r.submitted_by_employee_id=s.employee_id
   and receipt.payload_json->'response_json'=r.response_json
   and context.native_start_attestation_version='custodial-native-start.v1'
   and context.native_scan_entry_id is not null
   and context.native_completion_attestation_version='custodial-native-completion.v2'
   and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
   and context.native_finish_scan_entry_id is not null
   and context.native_finish_scan_entry_id<>context.native_scan_entry_id
   and context.started_at=s.started_at and context.native_completed_at=s.ended_at
   and context.native_completed_at>context.started_at and context.native_completed_at<=statement_timestamp()
   and exists(select 1 from public.custodial_offline_scan_event_evidence evidence
    where evidence.context_id=context.context_id and evidence.reconciliation_id=receipt.reconciliation_id
      and evidence.session_id=s.id and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
      and evidence.event_payload->>'event_type'='scan_finish'
      and evidence.event_payload->>'result'='ok'
      and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
      and evidence.event_payload->>'scanned_at'=public.custodial_canonical_utc_millis(context.native_completed_at))
 ) into v_native;
 select count(*),count(*) filter(where t.status='open'),
  count(*) filter(where t.resolution_outcome='work_order_sent'),
  count(*) filter(where t.resolution_outcome='mark_fixed'),
  count(*) filter(where t.status='closed' and t.resolution_outcome is null),
  coalesce(jsonb_agg(jsonb_build_object('ticket_id',t.id,'status',t.status,
   'resolution_outcome',t.resolution_outcome,'external_work_order_reference',t.external_work_order_reference,
   'resolution_actor_manager_id',t.resolution_actor_manager_id,'closed_at',t.closed_at,
   'issue_summary',t.issue_summary) order by t.reported_at,t.id) filter(where t.id is not null),'[]'::jsonb)
 into v_total,v_open,v_work_order,v_fixed,v_legacy_closed,v_tickets
 from public.maintenance_tickets t where t.completion_response_id=r.id and t.issue_source='completion_form';
 if jsonb_typeof(r.response_json->'attention_needed')='boolean' then
  v_issue_known:=true; v_issue:=(r.response_json->>'attention_needed')::boolean;
 end if;
 if jsonb_typeof(r.response_json->'maintenance_issues_found')='array' then
  v_raw_issue_count:=jsonb_array_length(r.response_json->'maintenance_issues_found');
 end if;
 if v_raw_issue_count=0 and (lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null) then
  v_raw_issue_count:=1;
 end if;
 if v_total>0 or v_raw_issue_count>0
    or lower(coalesce(r.response_json->>'out_of_order_signed','')) in ('yes','true')
    or nullif(btrim(coalesce(r.response_json->>'out_of_order_details','')),'') is not null then
  v_issue_known:=true; v_issue:=true;
 end if;
 v_work:=r.response_json->>'work_result';
 if not v_issue_known then v_follow_up:='unknown';
 elsif not v_issue then v_follow_up:='none_reported';
 elsif v_total>0 and v_fixed=v_total and v_raw_issue_count>0 and v_total>=v_raw_issue_count
  then v_follow_up:='linked_tickets_marked_fixed_coverage_unverified';
 else v_follow_up:='required_or_unresolved';
 end if;
 if not v_native then v_class:='historical_or_unverified_completion';
 elsif v_work='checked_no_cleaning_needed' then v_class:='checked_only';
 elsif v_work not in ('full','details') or v_work is null then v_class:='unknown';
 elsif v_follow_up='none_reported' then v_class:='cleaned_no_issues_reported';
 elsif v_follow_up='linked_tickets_marked_fixed_coverage_unverified'
  then v_class:='cleaned_linked_tickets_marked_fixed_coverage_unverified';
 elsif v_follow_up='required_or_unresolved' then v_class:='cleaned_follow_up_required';
 else v_class:='cleaned_issue_state_unknown';
 end if;
 return jsonb_build_object('session_id',s.id,'session_uuid',s.session_uuid,'session_status',s.status,
  'location_id',s.location_id,'employee_id',s.employee_id,'device_id',s.device_id,
  'started_at',s.started_at,'ended_at',s.ended_at,
  'completion_recorded',true,'completion_response_id',r.id,'client_completion_id',r.client_completion_id,
  'submitted_at',r.submitted_at,'original_response',r.response_json,
  'taxonomy_version',r.response_json#>>'{taxonomy,version}',
  'taxonomy_digest',r.response_json#>>'{taxonomy,digest}',
  'taxonomy_status',case when not (r.response_json ? 'taxonomy') then 'unversioned_historical_or_protected_draft'
   when v_catalog is null or v_digest is distinct from r.response_json#>>'{taxonomy,digest}' then 'metadata_unverified_legacy'
   else 'versioned_current_catalog' end,
  'catalog_digest',v_digest,'catalog',v_catalog,
  'native_exact_receipt_admitted',v_native,'work_result',v_work,'issue_reported',case when v_issue_known then to_jsonb(v_issue) else 'null'::jsonb end,
  'linked_completion_tickets',v_tickets,'linked_ticket_count',v_total,'linked_open_count',v_open,
  'linked_work_order_sent_count',v_work_order,'linked_mark_fixed_count',v_fixed,
  'linked_legacy_closed_unknown_count',v_legacy_closed,'raw_reported_issue_count',v_raw_issue_count,
  'linked_issue_count_shortfall',greatest(v_raw_issue_count-v_total,0),'follow_up',v_follow_up,
  'classification',v_class,'inspection_evaluation','not_performed_by_this_reader');
end $function$
;

CREATE OR REPLACE FUNCTION public.custodial_manager_completion_evidence(p_manager_id uuid, p_session_uuid text, p_backend_execution_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 if p_manager_id is null or p_session_uuid is null or length(p_session_uuid)=0 or length(p_session_uuid)>200
   or not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
  raise exception using errcode='42501',message='active named manager authority is required';
 end if;
 return custodial_leadership_private.completion_evidence_v1(p_session_uuid);
end $function$
;

CREATE OR REPLACE FUNCTION custodial_leadership_private.record_operation_v1(p_actor jsonb, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
 IF p_action='completion_evidence' THEN
  IF NOT(p_input ? 'session_uuid') OR (p_input-ARRAY['session_uuid'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'session_uuid') IS DISTINCT FROM 'string'
   OR length(p_input->>'session_uuid') NOT BETWEEN 1 AND 200
   OR btrim(p_input->>'session_uuid') IS DISTINCT FROM p_input->>'session_uuid' THEN
   RAISE EXCEPTION 'Exact completion session identity required' USING ERRCODE='22023';END IF;
  RETURN custodial_leadership_private.completion_evidence_v1(p_input->>'session_uuid');
 ELSIF p_action='choices' THEN
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
END $function$
;

-- Canonical catalogs normalize postgres/supabase_admin to migration_owner;
-- resolve the actual predecessor owner instead of assuming that is a role.
DO $owner$ DECLARE original_owner name; BEGIN
 SELECT pg_get_userbyid(proowner) INTO original_owner FROM pg_proc
 WHERE oid='custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)'::regprocedure;
 EXECUTE format('ALTER FUNCTION custodial_leadership_private.completion_evidence_v1(text) OWNER TO %I',original_owner);
END $owner$;
REVOKE ALL ON FUNCTION custodial_leadership_private.completion_evidence_v1(text) FROM PUBLIC, anon, authenticated, service_role, static_weekly_control_plane;
-- CREATE OR REPLACE preserves the two existing wrappers' owners and ACLs.
-- No table grants, defaults, authentication claims or writer authority change.
COMMIT;
