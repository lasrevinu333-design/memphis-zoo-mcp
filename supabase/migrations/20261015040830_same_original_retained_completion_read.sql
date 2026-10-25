-- UNAPPLIED product source. Purpose-specific retained-original READ ONLY.
-- The normal active-employee completion reader is unchanged. No table/role,
-- WORK submission, ACK, finalizer, key or phone-release capability is created.
-- Qualification and exact recovery-inventory binding remain required.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.read_original_completion(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text,p_original_completion_utf8 text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE target jsonb;p_payload jsonb;p_device_uuid uuid;p_identifier text;p_employee uuid;p_epoch bigint;
 v_control jsonb;v_response jsonb;v_evidence jsonb;v_correlation text;bad boolean;hit record;
 hits integer:=0;fingerprint jsonb;accepted jsonb:=NULL;disposition text:='UNRESOLVED_RETAINED';
BEGIN
 -- Revalidate the same complete retained frame, original credential, inactive
 -- original employee, separation and generation in THIS statement snapshot.
 target:=custodial_recovery.read_original_target(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest);
 IF target IS NULL THEN RETURN NULL;END IF;
 IF p_chunk_index IS DISTINCT FROM 0 OR p_original_completion_utf8 IS NULL
  OR octet_length(p_original_completion_utf8) NOT BETWEEN 1 AND 4194304 THEN
  RAISE EXCEPTION USING errcode='22023',message='bounded original completion DATA required';END IF;
 -- Duplicate detection over JSON, BEFORE jsonb conversion, with no integer/
 -- float coercion. The original raw UTF8 remains the input/hash identity.
 WITH RECURSIVE nodes(v,d) AS (
  SELECT p_original_completion_utf8::json,0
  UNION ALL
  SELECT child.v,n.d+1 FROM nodes n CROSS JOIN LATERAL (
   SELECT value v FROM json_each(CASE WHEN json_typeof(n.v)='object' THEN n.v ELSE '{}'::json END)
   UNION ALL SELECT value FROM json_array_elements(CASE WHEN json_typeof(n.v)='array' THEN n.v ELSE '[]'::json END)
  ) child WHERE n.d<=24
 )
 SELECT count(*)>32768 OR coalesce(max(d),0)>24 OR coalesce(bool_or(
  CASE WHEN json_typeof(v)='object' THEN
   (SELECT count(*)<>count(DISTINCT key COLLATE "C") FROM json_each(v))
  ELSE false END),false) INTO bad FROM nodes;
 IF bad THEN RAISE EXCEPTION USING errcode='22023',message='original completion JSON ambiguity or bounds';END IF;
 p_payload:=p_original_completion_utf8::jsonb;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN(
   'p_device_id','p_client_session_id','p_client_completion_id','p_location_code','p_client_started_at','p_client_ended_at',
   'p_response_json','p_scan_evidence','p_correlation_id','p_native_finish_scan_entry_id',
   'p_native_completion_attestation_version','p_native_completion_attestation',
   'p_native_completion_transport_attestation_version','p_native_completion_transport_attestation',
   'p_context_id','p_occurrence_id','p_submission_proof','p_snapshot_id','p_snapshot_employee_id',
   'p_snapshot_assignment_epoch','p_snapshot_credential_id'))
  OR jsonb_typeof(p_payload->'p_response_json') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'p_scan_evidence') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_payload->'p_scan_evidence') NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING errcode='22023',message='original completion shape required';END IF;
 p_device_uuid:=(target#>>'{original_target,canonical_device_pk}')::uuid;
 p_identifier:=target#>>'{original_target,canonical_device_id}';
 p_employee:=(target#>>'{original_target,employee_id}')::uuid;
 p_epoch:=(target#>>'{original_target,assignment_epoch}')::bigint;
 IF p_device_uuid IS DISTINCT FROM p_device OR p_payload->>'p_device_id' IS DISTINCT FROM p_identifier
  OR (target#>>'{original_target,credential_id}')::uuid IS DISTINCT FROM p_credential
  OR p_payload->>'p_native_completion_attestation_version' IS DISTINCT FROM 'custodial-native-completion.v2'
  OR coalesce(lower(btrim(p_payload->>'p_native_completion_attestation')),'') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING errcode='42501',message='same original completion actor required';END IF;
 v_control:=p_payload#>'{p_response_json,__custodial_offline_reconciliation_v1}';
 IF jsonb_typeof(v_control) IS DISTINCT FROM 'object'
  OR coalesce(v_control->>'context_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR coalesce(v_control->>'submission_proof','') !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING errcode='22023',message='original completion proof required';END IF;
 IF p_payload->'p_submission_proof' IS NOT NULL AND p_payload->'p_submission_proof'<>'null'::jsonb
  AND p_payload->>'p_submission_proof' IS DISTINCT FROM v_control->>'submission_proof' THEN
  RAISE EXCEPTION USING errcode='22023',message='contradictory original completion proof';END IF;
 v_response:=(p_payload->'p_response_json')-'__custodial_offline_reconciliation_v1';
 v_evidence:=p_payload->'p_scan_evidence';
 v_correlation:=coalesce(nullif(p_payload->>'p_correlation_id',''),'scan-commit:'||(p_payload->>'p_client_session_id')||':'||(p_payload->>'p_client_completion_id'));
 -- Carry the existing exact original record/session/native-finish/payload/
 -- proof/evidence predicates. ONLY ordinary active-employee transport checks
 -- are replaced by the preceding same-statement original-target authorization.
 FOR hit IN
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
    'accepted_session_id',session.id,'reconciliation_id',receipt.reconciliation_id,'context_id',context.context_id,
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
    and (p_payload->>'p_device_id')=device.device_id 
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
  limit 2
 LOOP
  hits:=hits+1;
  IF hits>1 THEN RAISE EXCEPTION USING errcode='42501',message='ambiguous accepted original completion';END IF;
  IF jsonb_typeof(hit.event_fingerprints) IS DISTINCT FROM 'array'
   OR jsonb_array_length(hit.event_fingerprints)<>jsonb_array_length(v_evidence) THEN
   RAISE EXCEPTION USING errcode='42501',message='original event fingerprint coverage changed';END IF;
  FOR fingerprint IN SELECT value FROM jsonb_array_elements(hit.event_fingerprints) LOOP
   IF jsonb_typeof(fingerprint) IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM jsonb_object_keys(fingerprint))<>2 OR
    jsonb_typeof(fingerprint->'source') IS DISTINCT FROM 'string' OR
    octet_length(fingerprint->>'source')>16384 OR
    fingerprint->>'fingerprint' IS DISTINCT FROM encode(extensions.digest(convert_to(fingerprint->>'source','UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION USING errcode='42501',message='original event fingerprint changed';END IF;
  END LOOP;
  accepted:=jsonb_build_object(
   'reconciliation_id',hit.original->>'reconciliation_id','context_id',hit.original->>'context_id',
   'occurrence_id',hit.original->>'occurrence_id','session_id',hit.original->>'accepted_session_id',
   'completion_response_id',hit.result->>'completion_response_id','client_session_id',hit.original->>'client_session_id',
   'client_completion_id',hit.original->>'client_completion_id','employee_id',hit.original->>'original_employee_id',
   'credential_id',hit.original->>'original_credential_id','assignment_epoch',hit.original->>'assignment_epoch',
   'payload_fingerprint',hit.original->>'payload_fingerprint',
   'started_at',custodial_recovery.utc_micros((hit.result->>'started_at')::timestamptz),
   'ended_at',custodial_recovery.utc_micros((hit.result->>'ended_at')::timestamptz),
   'submitted_at',custodial_recovery.utc_micros((hit.original->>'submitted_at')::timestamptz),
   'location_id',hit.original->>'location_id');
  disposition:='ACCEPTED_EXACT_ORIGINAL';
 END LOOP;
 -- This purpose's closed response explicitly permits JSON null for retained
 -- unknown work. The preparation signer intentionally rejects null; do not
 -- widen that shared authority serializer or turn unknown into acceptance.
 RETURN jsonb_build_object(
  'schema','custodial.same-original-completion-SQL-read.v1',
  'state','CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK',
  'operation_id',p_operation::text,'original_generation_id',p_generation::text,
  'argument_values_sha256',encode(extensions.digest(convert_to(p_original_completion_utf8,'UTF8'),'sha256'),'hex'),
  'disposition',disposition,'result',accepted,'transaction_authority',false,'limits',custodial_recovery.denied_effects())::text;
END $fn$;
CREATE FUNCTION public.custodial_same_original_completion_read_v1(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_chunk_index integer,p_native_request uuid,p_request_sha256 text,p_attestation_digest text,p_original_completion_utf8 text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.read_original_completion(p_operation,p_device,p_credential,p_credential_hash,p_credential_key_id,
  p_generation,p_chunk_index,p_native_request,p_request_sha256,p_attestation_digest,p_original_completion_utf8)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.read_original_completion(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_same_original_completion_read_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
-- Same existing server-only read principals as the original-target RPC.
-- This is unapplied SOURCE, not an executed permission change.
GRANT EXECUTE ON FUNCTION public.custodial_same_original_completion_read_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)
 TO service_role,custodial_application_reader;
-- Finite owning recovery extension, using the existing original-reader pattern.
-- No business DATA, function body, function owner or callable ACL is changed.
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE completion_read_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE completion_read_surface_before ON COMMIT DROP AS
 SELECT oid,proacl,proowner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
CREATE TEMP TABLE completion_read_guard_before ON COMMIT DROP AS
 SELECT c.oid relation_oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
  t.oid trigger_oid,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid,true) trigger_definition,
  p.proowner,p.proacl,pg_get_functiondef(p.oid) guard_definition
 FROM pg_class c JOIN pg_trigger t ON t.tgrelid=c.oid JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE c.oid='public.custodial_release_authority_restore_inventory'::regclass
  AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT t.tgisinternal;
CREATE TEMP TABLE completion_read_functions ON COMMIT DROP AS
 WITH declared(priority,identity) AS(VALUES
  (0,'custodial_recovery.read_original_completion(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)'),
  (1,'public.custodial_same_original_completion_read_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text,text)'))
 SELECT d.*,p.oid,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef,p.prorettype,
  pg_get_functiondef(p.oid) definition
 FROM declared d JOIN pg_proc p ON p.oid=d.identity::regprocedure;
CREATE TEMP TABLE completion_read_objects ON COMMIT DROP AS
 SELECT 100000 bucket,priority,'function'::text kind,identity,definition FROM completion_read_functions
 UNION ALL SELECT 900000,priority,'grant',identity,
  public.custodial_release_authority_current_grant_definition(identity) FROM completion_read_functions;
DO $completion_predecessor$ DECLARE body text;BEGIN
 SELECT definition INTO STRICT body FROM completion_read_surface_before;
 IF (SELECT count(*) FROM completion_read_functions)<>2
  OR (SELECT count(*) FROM completion_read_objects)<>4
  OR EXISTS(SELECT 1 FROM completion_read_objects WHERE definition IS NULL)
  OR EXISTS(SELECT 1 FROM completion_read_inventory_before WHERE definition_sha256
    IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR (SELECT count(*) FROM completion_read_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    AND definition_sql=body)<>1
  -- Preserve exact predecessor membership and bytes. The original source has
  -- the known reset-helper public qualification representation (a843...)
  -- while its current serializer emits b7d4..., as declared by the existing
  -- manager recovery binding. Admit ONLY that exact no-ACL-change pair; no
  -- arbitrary current/surviving grant is adopted or rewritten here.
  OR (SELECT count(*) FROM completion_read_inventory_before WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)<>1
  OR EXISTS(SELECT 1 FROM completion_read_inventory_before WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    AND definition_sql IS DISTINCT FROM public.custodial_release_authority_current_grant_definition(object_identity)
    AND NOT(restore_order=1000073 AND object_identity='custodial_release_canary_authority_surface()'
     AND definition_sha256='a843e6ab1177177e039163a3d520b95d6552de8105474a48e390b25302692f48'
     AND public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(object_identity))='b7d461eda320ec386b55ce3490063e09848a83723999acdd741e83cad0460498'
     AND replace(definition_sql,'''public.custodial_release_canary_authority_surface()''','''custodial_release_canary_authority_surface()''')
       =public.custodial_release_authority_current_grant_definition(object_identity)))
  OR EXISTS(SELECT 1 FROM completion_read_inventory_before i JOIN completion_read_functions f
    ON i.object_kind IN('function','grant') AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=f.oid)
  OR EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() s JOIN completion_read_functions f
    ON s.object_kind IN('function','grant') AND s.object_identity LIKE '%(%' AND to_regprocedure(s.object_identity)=f.oid)
  OR (SELECT count(*) FROM completion_read_guard_before WHERE tgenabled='A'
    AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure)<>1
 THEN RAISE EXCEPTION 'Original completion finite recovery predecessor changed' USING DETAIL=json_build_object(
  'functions',(SELECT count(*) FROM completion_read_functions),
  'objects',(SELECT count(*) FROM completion_read_objects),
  'null_definitions',(SELECT count(*) FROM completion_read_objects WHERE definition IS NULL),
  'invalid_inventory_hashes',(SELECT count(*) FROM completion_read_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql)),
  'surface_insertions',(length(body)-length(replace(body,'  values','')))/length('  values'),
  'exact_surface_functions',(SELECT count(*) FROM completion_read_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure AND definition_sql=body),
  'exact_surface_grants',(SELECT count(*) FROM completion_read_inventory_before WHERE object_kind='grant' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)),
  'affected_inventory_preexists',(SELECT count(*) FROM completion_read_inventory_before i JOIN completion_read_functions f ON i.object_kind IN('function','grant') AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=f.oid),
  'affected_surface_preexists',(SELECT count(*) FROM public.custodial_release_canary_authority_surface() s JOIN completion_read_functions f ON s.object_kind IN('function','grant') AND s.object_identity LIKE '%(%' AND to_regprocedure(s.object_identity)=f.oid),
  'always_inventory_guards',(SELECT count(*) FROM completion_read_guard_before WHERE tgenabled='A' AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure))::text;END IF;
 -- Match the existing original-target owners and search-path boundary, not a
 -- caller-selected owner/role. Retain the SAME managed postgres administrative
 -- ACL as that fixed predecessor, never treating it as a runtime reader.
 -- The public wrapper adds no readers beyond its two declared server roles.
 IF EXISTS(SELECT 1 FROM completion_read_functions f JOIN pg_proc original
   ON original.oid=CASE f.priority WHEN 0 THEN
     'custodial_recovery.read_original_target(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure
    ELSE 'public.custodial_same_original_preparation_target_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure END
   WHERE f.proowner IS DISTINCT FROM original.proowner OR f.proconfig IS DISTINCT FROM original.proconfig
    OR f.proacl IS DISTINCT FROM original.proacl
    OR f.provolatile<>'s' OR NOT f.prosecdef OR f.prorettype<>'text'::regtype)
  OR EXISTS(SELECT 1 FROM completion_read_functions f
    CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>f.proowner
     AND ((f.priority=0 AND r.rolname IS DISTINCT FROM 'postgres')
      OR r.rolname IS NULL OR r.rolname NOT IN('postgres','service_role','custodial_application_reader')
      OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR EXISTS(SELECT 1 FROM completion_read_functions f WHERE f.priority=1 AND
    (NOT has_function_privilege('service_role',f.oid,'EXECUTE')
     OR NOT has_function_privilege('custodial_application_reader',f.oid,'EXECUTE')))
 THEN RAISE EXCEPTION 'Original completion owner, attributes or exact callable ACL changed' USING DETAIL=(
  SELECT json_agg(json_build_object('priority',f.priority,'owner',f.proowner::regrole::text,'acl',f.proacl,
    'config',f.proconfig,'volatility',f.provolatile,'definer',f.prosecdef,'return_type',f.prorettype::regtype::text,
    'predecessor_owner',original.proowner::regrole::text,'predecessor_acl',original.proacl,'predecessor_config',original.proconfig))::text
  FROM completion_read_functions f JOIN pg_proc original ON original.oid=CASE f.priority WHEN 0 THEN
    'custodial_recovery.read_original_target(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure
   ELSE 'public.custodial_same_original_preparation_target_v1(uuid,uuid,uuid,text,text,uuid,integer,uuid,text,text)'::regprocedure END);END IF;
END $completion_predecessor$;
DO $completion_surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM completion_read_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||
  quote_literal('retained exact original completion disposition read only; no submission, ACK, finalizer, key or release authority')||'),',E'\n'
  ORDER BY kind,priority,identity) INTO entries FROM completion_read_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN completion_read_surface_before old ON p.oid=old.oid
    WHERE p.proowner IS DISTINCT FROM old.proowner OR p.proacl IS DISTINCT FROM old.proacl)
 THEN RAISE EXCEPTION 'Original completion canary exact extension or owner/ACL changed';END IF;
END $completion_surface$;
-- Only the existing inventory's mutation guard is suspended under its
-- exclusive migration lock, as in the owning original-outcome migration.
-- No application/immutable DATA guard, RLS policy or grant is changed.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $completion_inventory$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),
  captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM completion_read_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Original completion exact canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM completion_read_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,obj.bucket+99998) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n)
   ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Original completion finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $completion_inventory$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $completion_scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM completion_read_inventory_before)+4
  OR EXISTS(SELECT old.* FROM completion_read_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM completion_read_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM completion_read_inventory_before)
  OR EXISTS(SELECT 1 FROM completion_read_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
    ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
     OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR EXISTS(SELECT 1 FROM completion_read_functions old LEFT JOIN pg_proc p ON p.oid=old.oid
    WHERE ROW(p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef,p.prorettype,pg_get_functiondef(p.oid))
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.provolatile,old.prosecdef,old.prorettype,old.definition))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() s JOIN completion_read_objects x
    ON x.kind=s.object_kind AND x.identity=s.object_identity)<>4
  OR EXISTS(SELECT * FROM completion_read_guard_before EXCEPT
    SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,t.oid,t.tgfoid,t.tgenabled,
     pg_get_triggerdef(t.oid,true),p.proowner,p.proacl,pg_get_functiondef(p.oid)
    FROM pg_class c JOIN pg_trigger t ON t.tgrelid=c.oid JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE c.oid='public.custodial_release_authority_restore_inventory'::regclass
     AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT t.tgisinternal)
 THEN RAISE EXCEPTION 'Original completion unrelated inventory, exact definitions, guards or owner/RLS/ACL changed';END IF;
END $completion_scope$;
COMMIT;
