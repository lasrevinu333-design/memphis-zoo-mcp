-- Approved local original-completion read-boundary repair; no production effect.
-- Backend native authentication/HMAC is required before the exact read. The
-- current SQL credential/assignment and original proof are independently bound.
-- Reuse the existing unexposed backend-read schema, not a public Data API RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE completion_reader_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $preflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='custodial_application_reader'
   AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)
  OR to_regnamespace('custodial_release_identity') IS NULL
  OR NOT has_schema_privilege('custodial_application_reader','custodial_release_identity','USAGE')
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN('public.sessions'::regclass,'public.completion_responses'::regclass)
    AND (NOT relrowsecurity OR NOT relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM completion_reader_inventory_before
    WHERE definition_sha256<>public.static_weekly_digest_text(definition_sql))
 THEN RAISE EXCEPTION 'Original completion reader protected predecessor changed';END IF;
END $preflight$;

CREATE FUNCTION custodial_release_identity.read_original_scan_completion_v1(
 p_device_uuid uuid,p_identifier text,p_employee uuid,p_epoch bigint,p_credential uuid,p_payload jsonb)
RETURNS TABLE(result jsonb,event_fingerprints jsonb,original jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $function$
DECLARE v_control jsonb;v_response jsonb;v_evidence jsonb;v_correlation text;
BEGIN
 IF p_device_uuid IS NULL OR p_identifier IS NULL OR p_employee IS NULL OR p_credential IS NULL
  OR p_epoch IS NULL OR p_epoch<1 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR octet_length(p_payload::text)>1048576
  OR jsonb_typeof(p_payload->'p_response_json') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'p_scan_evidence') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_payload->'p_scan_evidence') NOT BETWEEN 1 AND 100
  OR p_payload->>'p_device_id' IS DISTINCT FROM p_identifier
  OR p_payload->>'p_native_completion_attestation_version' IS DISTINCT FROM 'custodial-native-completion.v2'
  OR coalesce(lower(btrim(p_payload->>'p_native_completion_attestation')),'') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Bounded exact original completion input required';END IF;
 v_control:=p_payload#>'{p_response_json,__custodial_offline_reconciliation_v1}';
 IF jsonb_typeof(v_control) IS DISTINCT FROM 'object'
  OR coalesce(v_control->>'context_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR coalesce(v_control->>'submission_proof','') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Original proof required';END IF;
 v_response:=(p_payload->'p_response_json')-'__custodial_offline_reconciliation_v1';
 v_evidence:=p_payload->'p_scan_evidence';
 v_correlation:=coalesce(nullif(p_payload->>'p_correlation_id',''),'scan-commit:'||(p_payload->>'p_client_session_id')||':'||(p_payload->>'p_client_completion_id'));
 RETURN QUERY
select receipt.result_json || jsonb_build_object(
    'reconciliation_id',receipt.reconciliation_id,
    'started_at',to_char(context.started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ended_at',to_char(context.native_completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completed_at',to_char(context.native_completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'native_completion_attested',true,'native_finish_scan_entry_id',context.native_finish_scan_entry_id) as result,
    (select jsonb_agg(jsonb_build_object('fingerprint',evidence.event_fingerprint,
      'source',jsonb_build_object(
        'client_event_id',evidence.client_event_id,'context_id',context.context_id::text,'device_id',context.device_id::text,
        'event_type',evidence.event_payload->>'event_type','location_id',context.location_id::text,
        'payload_json',coalesce(evidence.event_payload->'payload_json','{}'::jsonb),
        'result',nullif(evidence.event_payload->>'result',''),
        'scanned_at',(evidence.event_payload->>'scanned_at')::timestamptz,
        'session_id',session.id::text,'notes',nullif(evidence.event_payload->>'notes',''))::text)
      order by evidence.client_event_id)
      from public.custodial_offline_scan_event_evidence evidence
      where evidence.reconciliation_id=receipt.reconciliation_id
        and evidence.context_id=context.context_id and evidence.session_id=session.id) as event_fingerprints,
    jsonb_build_object(
    'reconciliation_id',receipt.reconciliation_id,'context_id',context.context_id,
    'occurrence_id',context.occurrence_id,'original_employee_id',context.employee_id,
    'original_credential_id',context.credential_id,'device_id',context.device_id,
    'location_id',context.location_id,'client_session_id',receipt.client_session_id,
    'client_completion_id',receipt.client_completion_id,'assignment_epoch',context.assignment_epoch,
    'payload_fingerprint',receipt.payload_fingerprint,'submitted_at',response.submitted_at) as original
  from public.custodial_offline_reconciliation_records receipt
  join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
  join public.sessions session on session.id=receipt.session_id
  join public.completion_responses response on response.id=receipt.completion_response_id
  join public.devices device on device.id=context.device_id
  join public.employees employee on employee.id=context.employee_id
  join public.locations location on location.id=context.location_id
  join public.custodial_offline_submission_proofs proof on proof.context_id=context.context_id
  join public.device_auth_credentials current_credential on current_credential.credential_id=p_credential
    and current_credential.device_id=p_device_uuid and current_credential.confirmed_at is not null
    and current_credential.revoked_at is null and current_credential.expires_at>statement_timestamp()
  where receipt.client_session_id=(p_payload->>'p_client_session_id')
    and receipt.client_completion_id=(p_payload->>'p_client_completion_id')
    and receipt.context_id=(v_control->>'context_id')::uuid
    and receipt.state='committed' and receipt.quarantine_reason is null
    and context.status='committed' and session.status='closed' and proof.state='consumed'
    and proof.proof_digest=encode(extensions.digest(convert_to(v_control->>'submission_proof','UTF8'),'sha256'),'hex')
    and receipt.occurrence_id=context.occurrence_id and receipt.occurrence_fingerprint=context.occurrence_fingerprint
    and receipt.original_employee_id=context.employee_id and receipt.credential_id=context.credential_id
    and receipt.device_id=context.device_id and receipt.location_id=context.location_id
    and context.client_session_id=session.client_session_id and receipt.client_session_id=session.client_session_id
    and context.employee_id=session.employee_id and context.device_id=session.device_id and context.location_id=session.location_id
    and response.session_id=session.id and response.client_completion_id=receipt.client_completion_id
    and response.location_id=context.location_id and response.device_id=context.device_id
    and response.submitted_by_employee_id=context.employee_id
    and context.started_at=session.started_at and context.native_completed_at=session.ended_at
    and context.started_at=(p_payload->>'p_client_started_at')::timestamptz
    and context.native_completed_at=(p_payload->>'p_client_ended_at')::timestamptz
    and context.native_completed_at>context.started_at and isfinite(context.native_completed_at)
    and context.native_start_attestation_version='custodial-native-start.v1' and context.native_scan_entry_id is not null
    and context.native_completion_attestation_version='custodial-native-completion.v2'
    and context.native_completion_attestation_sha256=encode(extensions.digest(convert_to(lower(btrim(p_payload->>'p_native_completion_attestation')),'UTF8'),'sha256'),'hex')
    and context.native_finish_scan_entry_id=(p_payload->>'p_native_finish_scan_entry_id')::uuid
    and context.native_finish_scan_entry_id<>context.native_scan_entry_id
    and (context.canonical_location_code=(p_payload->>'p_location_code')
      or context.location_aliases @> jsonb_build_array((p_payload->>'p_location_code')::text))
    and location.id=session.location_id
    and device.id=p_device_uuid::uuid and device.device_id=p_identifier
    and (p_payload->>'p_device_id')=device.device_id and device.active and employee.active
    and device.assigned_employee_id=context.employee_id and context.employee_id=p_employee::uuid
    and device.assignment_epoch=context.assignment_epoch and context.assignment_epoch=p_epoch
    and context.credential_id=p_credential::uuid
    and receipt.payload_json->'response_json'=v_response::jsonb
    and response.response_json=receipt.payload_json->'response_json'
    and receipt.payload_json->'scan_evidence'=v_evidence::jsonb
    and receipt.payload_fingerprint=public.custodial_offline_payload_fingerprint(context,
      (p_payload->>'p_client_completion_id'),(p_payload->>'p_client_started_at')::timestamptz,
      (p_payload->>'p_client_ended_at')::timestamptz,v_response::jsonb,
      v_evidence::jsonb,v_correlation)
    and receipt.result_json->>'status'='closed'
    and receipt.result_json->>'client_session_id'=receipt.client_session_id
    and receipt.result_json->>'client_completion_id'=receipt.client_completion_id
    and receipt.result_json->>'session_uuid'=session.session_uuid
    and receipt.result_json->>'completion_response_id'=response.id::text
    and receipt.result_json->>'occurrence_id'=context.occurrence_id::text
    and receipt.result_json->>'original_employee_id'=context.employee_id::text
    and (receipt.result_json->>'started_at')::timestamptz=context.started_at
    and (receipt.result_json->>'ended_at')::timestamptz=context.native_completed_at
    and receipt.result_json->>'correlation_id' is not distinct from nullif(btrim(v_correlation),'')
    and (p_payload->'p_context_id' is null or p_payload->'p_context_id'='null'::jsonb or context.context_id::text=(p_payload->>'p_context_id'))
    and (p_payload->'p_occurrence_id' is null or p_payload->'p_occurrence_id'='null'::jsonb or context.occurrence_id::text=(p_payload->>'p_occurrence_id'))
    and (p_payload->'p_snapshot_id' is null or p_payload->'p_snapshot_id'='null'::jsonb or context.snapshot_id::text=(p_payload->>'p_snapshot_id'))
    and (p_payload->'p_snapshot_employee_id' is null or p_payload->'p_snapshot_employee_id'='null'::jsonb or context.snapshot_employee_id::text=(p_payload->>'p_snapshot_employee_id'))
    and (p_payload->'p_snapshot_assignment_epoch' is null or p_payload->'p_snapshot_assignment_epoch'='null'::jsonb or context.snapshot_assignment_epoch::text=(p_payload->>'p_snapshot_assignment_epoch'))
    and (p_payload->'p_snapshot_credential_id' is null or p_payload->'p_snapshot_credential_id'='null'::jsonb or context.snapshot_credential_id::text=(p_payload->>'p_snapshot_credential_id'))
    and (select count(*) from public.custodial_offline_scan_event_evidence evidence
      where evidence.reconciliation_id=receipt.reconciliation_id)=jsonb_array_length(receipt.payload_json->'scan_evidence')
    and not exists(select 1 from jsonb_array_elements(receipt.payload_json->'scan_evidence') event
      where not exists(select 1 from public.custodial_offline_scan_event_evidence evidence
        where evidence.client_event_id=btrim(event->>'client_event_id') and evidence.context_id=context.context_id
          and evidence.reconciliation_id=receipt.reconciliation_id and evidence.session_id=session.id
          and evidence.event_payload=event))
    and (select count(*) from jsonb_array_elements(receipt.payload_json->'scan_evidence') event
      where event->>'event_type'='scan_finish')=1
    and exists(select 1 from public.custodial_offline_scan_event_evidence evidence
      where evidence.reconciliation_id=receipt.reconciliation_id and evidence.context_id=context.context_id and evidence.session_id=session.id
        and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
        and evidence.event_payload->>'event_type'='scan_finish' and evidence.event_payload->>'result'='ok'
        and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
        and evidence.event_payload->>'scanned_at'=(p_payload->>'p_client_ended_at'))
  limit 2;
END
$function$;

CREATE FUNCTION custodial_release_identity.read_current_original_dashboard_completions_v1()
RETURNS TABLE(location_id uuid,latest_original_completion json)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
select distinct on (receipt.location_id) receipt.location_id,
        json_build_object(
          'schema','custodial.dashboard-original-completion.v1',
          'state','SERVER_ACCEPTED_ORIGINAL_RECORD',
          'reconciliation_id',receipt.reconciliation_id,
          'context_id',context.context_id,
          'occurrence_id',receipt.occurrence_id,
          'occurrence_fingerprint',receipt.occurrence_fingerprint,
          'payload_fingerprint',receipt.payload_fingerprint,
          'employee_id',receipt.original_employee_id,
          'employee_name',employee.display_name,
          'device_id',receipt.device_id,
          'credential_id',receipt.credential_id,
          'assignment_epoch',context.assignment_epoch::text,
          'location_id',receipt.location_id,
          'session_uuid',session.session_uuid,
          'client_session_id',receipt.client_session_id,
          'client_completion_id',receipt.client_completion_id,
          'snapshot_id',context.snapshot_id,
          'started_at',context.started_at,
          'completed_at',context.native_completed_at,
          'accepted_at',receipt.created_at,
          'work_result',response.response_json->>'work_result',
          'services_performed',response.response_json->'services_performed',
          'schedule_authority_revision',null,
          'schedule_authority_revision_available',false
        ) as latest_original_completion
      from public.custodial_offline_reconciliation_records receipt
      join public.custodial_offline_actor_contexts context on context.context_id=receipt.context_id
      join public.sessions session on session.id=receipt.session_id
      join public.completion_responses response on response.id=receipt.completion_response_id
      join public.employees employee on employee.id=receipt.original_employee_id
      where receipt.state='committed' and context.status='committed' and session.status='closed'
        and receipt.result_json->>'status'='closed'
        and receipt.occurrence_id=context.occurrence_id
        and receipt.occurrence_fingerprint=context.occurrence_fingerprint
        and receipt.credential_id=context.credential_id
        and receipt.location_id=session.location_id and context.location_id=session.location_id
        and response.location_id=session.location_id and response.session_id=session.id
        and context.client_session_id=session.client_session_id
        and receipt.client_session_id=session.client_session_id
        and receipt.client_completion_id=response.client_completion_id
        and receipt.original_employee_id=session.employee_id and context.employee_id=session.employee_id
        and receipt.device_id=session.device_id and context.device_id=session.device_id
        and response.device_id=session.device_id and response.submitted_by_employee_id=session.employee_id
        and context.snapshot_employee_id=receipt.original_employee_id
        and context.snapshot_assignment_epoch=context.assignment_epoch
        and context.snapshot_id ~ '^[0-9a-f]{64}$'
        and receipt.payload_json->'response_json'=response.response_json
        and response.response_json->>'work_result' in ('full','details','selective','checked_no_cleaning_needed')
        and jsonb_typeof(response.response_json->'services_performed')='array'
        and (response.response_json->>'work_result'<>'checked_no_cleaning_needed'
          or response.response_json->'services_performed'='[]'::jsonb)
        and context.native_start_attestation_version='custodial-native-start.v1'
        and context.native_scan_entry_id is not null
        and context.native_completion_attestation_version='custodial-native-completion.v2'
        and context.native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$'
        and context.native_finish_scan_entry_id is not null
        and context.native_finish_scan_entry_id<>context.native_scan_entry_id
        and context.started_at=session.started_at and context.native_completed_at=session.ended_at
        and context.native_completed_at>context.started_at
        and context.native_completed_at>=public.operational_day_start(now())
        and context.native_completed_at<=now() and isfinite(context.native_completed_at)
        and exists (
          select 1 from public.custodial_offline_scan_event_evidence evidence
          where evidence.context_id=context.context_id
            and evidence.reconciliation_id=receipt.reconciliation_id
            and evidence.session_id=session.id
            and lower(evidence.client_event_id)=context.native_finish_scan_entry_id::text
            and evidence.event_payload->>'event_type'='scan_finish'
            and evidence.event_payload->>'result'='ok'
            and evidence.event_payload#>>'{payload_json,entry_source}'='native-nfc'
            and evidence.event_payload->>'scanned_at'=
              public.custodial_canonical_utc_millis(context.native_completed_at)
        )
      order by receipt.location_id, context.native_completed_at desc, receipt.reconciliation_id desc
    ;
$function$;

-- Keep the normal migration/recovery owner, as with the existing canonical
-- protected readers. An unrelated hard-coded owner breaks drop/recreate ACL
-- recovery even when the function text is identical.
REVOKE ALL ON FUNCTION custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb),custodial_release_identity.read_current_original_dashboard_completions_v1()
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb),custodial_release_identity.read_current_original_dashboard_completions_v1() TO custodial_application_reader;

DO $surface$
DECLARE definition text;before_acl text;
BEGIN
 before_acl:=public.custodial_release_authority_current_grant_definition('public.custodial_release_canary_authority_surface()');
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1
 THEN RAISE EXCEPTION 'Completion reader canary predecessor changed';END IF;
 EXECUTE replace(definition,'  values','  values'||E'\n'||
  '(''function'',''custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb)'',''Exact original native completion read''),'||E'\n'||
  '(''function'',''custodial_release_identity.read_current_original_dashboard_completions_v1()'',''Current accepted original Dashboard read''),');
 IF public.custodial_release_authority_current_grant_definition('public.custodial_release_canary_authority_surface()') IS DISTINCT FROM before_acl
 THEN RAISE EXCEPTION 'Completion reader changed canary permissions';END IF;
END $surface$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$
DECLARE identity text;definition text;kind text;bucket integer;next_order integer;
BEGIN
 FOREACH identity IN ARRAY ARRAY['custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb)','custodial_release_identity.read_current_original_dashboard_completions_v1()','public.custodial_release_canary_authority_surface()'] LOOP
  FOREACH kind IN ARRAY ARRAY['function','grant'] LOOP
   definition:=CASE WHEN kind='function' THEN pg_get_functiondef(identity::regprocedure)
    ELSE public.custodial_release_authority_current_grant_definition(identity) END;
   IF definition IS NULL THEN RAISE EXCEPTION 'Completion reader recovery definition missing';END IF;
   UPDATE public.custodial_release_authority_restore_inventory
    SET definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    WHERE object_kind=kind AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=identity::regprocedure;
   IF NOT FOUND THEN
    bucket:=CASE WHEN kind='function' THEN 100000 ELSE 900000 END;
    SELECT coalesce(max(restore_order),bucket)+1 INTO next_order FROM public.custodial_release_authority_restore_inventory
     WHERE restore_order>=bucket AND restore_order<bucket+100000;
    INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     VALUES(next_order,kind,identity,definition,public.static_weekly_digest_text(definition));
   END IF;
  END LOOP;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $postflight$
DECLARE identity text;role_name text;
BEGIN
 FOREACH identity IN ARRAY ARRAY['custodial_release_identity.read_original_scan_completion_v1(uuid,text,uuid,bigint,uuid,jsonb)','custodial_release_identity.read_current_original_dashboard_completions_v1()'] LOOP
  IF NOT has_function_privilege('custodial_application_reader',identity,'EXECUTE') THEN RAISE EXCEPTION 'Intended reader denied';END IF;
  -- supabase_admin inherits the administrative postgres owner in the cached
  -- stack; ownership cannot be removed by a runtime EXECUTE revoke. No direct
  -- grant to it remains. Test the actual five non-owner runtime/API callers.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator'] LOOP
   IF has_function_privilege(role_name,identity,'EXECUTE') THEN RAISE EXCEPTION 'Unintended completion reader caller %',role_name;END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=identity::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC completion reader execution';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN('public.sessions'::regclass,'public.completion_responses'::regclass)
   AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'Protected row boundary changed';END IF;
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*)+4 FROM completion_reader_inventory_before)
 THEN RAISE EXCEPTION 'Unexpected completion reader recovery membership';END IF;
 IF EXISTS(SELECT 1 FROM completion_reader_inventory_before old LEFT JOIN public.custodial_release_authority_restore_inventory now USING(inventory_id)
  WHERE old.object_identity NOT IN('public.custodial_release_canary_authority_surface()','custodial_release_canary_authority_surface()')
   AND to_jsonb(old) IS DISTINCT FROM to_jsonb(now)) THEN RAISE EXCEPTION 'Unrelated recovery evidence changed';END IF;
END $postflight$;
COMMIT;
