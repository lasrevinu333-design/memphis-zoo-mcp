\set ON_ERROR_STOP on
-- ROOT ONLY. Isolated clean source303 clone with RECORD_OPERATIONS_PROPOSAL applied.
-- Contributor-prepared; NOT EXECUTED by native lane. No connection/resource creation.
-- Exact signed-setup fixture block reused below, with an intentionally opaque
-- session_uuid at INSERT. Its transaction markers/session SELECT are omitted.
-- All fixture changes are inside this one outer transaction and roll back.
-- No disabled triggers, RLS bypass setting, grants, external notifications or network.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog,public;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.ops_manager_managers WHERE manager_id='c7200000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'Clean disposable database required: signed fixture already present';END IF;
END$$;
CREATE TEMP TABLE record_operation_checks(label text PRIMARY KEY);
CREATE FUNCTION pg_temp.record_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label;END IF;
 INSERT INTO record_operation_checks VALUES(label);RAISE NOTICE 'PASS: %',label;
END$$;
DO $fixture$
DECLARE owner_id uuid;claimed_id uuid;reg jsonb;
BEGIN
 -- On a blank-seeded isolated target only, fill missing approved registry keys.
 -- Existing registry rows are read as fixture metadata, never changed.
 INSERT INTO public.ops_manager_managers(display_name,system_key,roles)
 SELECT 'Synthetic registry fixture '||n,key,ARRAY['OPS_MANAGER']::text[]
 FROM (VALUES(1,'eric_mckenney_facilities_maintenance_manager'),(2,'haley_lejman_water_quality_manager'),
  (3,'brandy_gull_horticulture_manager'),(4,'jennifer_sheffield_director_operations'),
  (5,'annie_feist_operations_admin'),(6,'eric_custodial_manager')) v(n,key)
 WHERE NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.system_key=v.key);
 reg:=custodial_leadership_private.approved_names();
 IF reg IS NULL THEN RAISE EXCEPTION 'Fixture requires valid approved six-name registry';END IF;
 claimed_id:=(reg->0->>'accountId')::uuid;owner_id:=(reg->5->>'accountId')::uuid;
 INSERT INTO public.ops_manager_managers(manager_id,display_name,system_key,roles,is_system_principal)
 VALUES('c7200000-0000-4000-8000-000000000001','Synthetic cohort authority','synthetic_signed_ticket_cohort',ARRAY['OPS_MANAGER'],true),
 ('c7200000-0000-4000-8000-000000000006','Synthetic named delegate','synthetic_signed_ticket_delegate',ARRAY['OPS_MANAGER'],false);
 UPDATE custodial_leadership_private.policy SET enabled=true,
  cohort_principal_id='c7200000-0000-4000-8000-000000000001',policy_version=1,
  permissions=ARRAY['custodial.read','custodial.edit','custodialManagementAdmin'],
  approved_by=owner_id,approved_at=clock_timestamp(),approval_ref='c7200000-0000-4000-8000-000000000009';
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture requires singleton leadership policy row';END IF;
 INSERT INTO custodial_leadership_private.registrations(registration_id,browser_id,token_hash,browser_hash,
  claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
 VALUES('c7200000-0000-4000-8000-000000000002','c7200000-0000-4000-8000-000000000003',repeat('a',64),repeat('b',64),
  claimed_id,'c7200000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour'),
 ('c7200000-0000-4000-8000-000000000004','c7200000-0000-4000-8000-000000000005',repeat('c',64),repeat('d',64),
  claimed_id,'c7200000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
 INSERT INTO public.ops_manager_trusted_devices(credential_id,manager_id,device_id,device_label,token_hash,max_access_level,created_at,expires_at)
 VALUES('c7200000-0000-4000-8000-000000000007','c7200000-0000-4000-8000-000000000006',
  'synthetic-ticket-delegate','Synthetic delegate browser',repeat('e',64),'read_only',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour'),
 ('c7200000-0000-4000-8000-000000000008',owner_id,'synthetic-ticket-owner','Synthetic owner browser',repeat('f',64),
  'full_access',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
 INSERT INTO public.custodial_backend_execution_config(config_key,enabled,execution_secret_digest)
 VALUES(true,true,encode(extensions.digest(convert_to('synthetic-ticket-test-secret-not-production','UTF8'),'sha256'),'hex'))
 ON CONFLICT(config_key) DO UPDATE SET enabled=excluded.enabled,execution_secret_digest=excluded.execution_secret_digest;
 INSERT INTO public.employees(id,employee_code,display_name) VALUES
 ('c7200000-0000-4000-8000-000000000010','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic ticket employee');
 INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES
 ('c7200000-0000-4000-8000-000000000011','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic ticket location','restroom');
 INSERT INTO public.devices(id,device_id,device_name,assigned_employee_id) VALUES
 ('c7200000-0000-4000-8000-000000000012','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic ticket device','c7200000-0000-4000-8000-000000000010');
 INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,completion_source)
 VALUES('c7200000-0000-4000-8000-000000000013','legacy:original/record#Ω',
  'c7200000-0000-4000-8000-000000000011','c7200000-0000-4000-8000-000000000010','c7200000-0000-4000-8000-000000000012',
  'closed',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '1 minute','kiosk_form');
 INSERT INTO public.completion_responses(id,session_id,location_id,submitted_by_employee_id,device_id,response_json)
 VALUES('c7200000-0000-4000-8000-000000000014','c7200000-0000-4000-8000-000000000013',
  'c7200000-0000-4000-8000-000000000011','c7200000-0000-4000-8000-000000000010','c7200000-0000-4000-8000-000000000012',
  '{"work_result":"checked_no_cleaning_needed","services_performed":[],"maintenance_issues_found":["Synthetic issue"]}');
 INSERT INTO public.maintenance_tickets(id,completion_response_id,session_id,location_id,reported_by_employee_id,device_id,issue_source,issue_summary)
 SELECT ('c7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'c7200000-0000-4000-8000-000000000014','c7200000-0000-4000-8000-000000000013','c7200000-0000-4000-8000-000000000011',
  'c7200000-0000-4000-8000-000000000010','c7200000-0000-4000-8000-000000000012','completion_form','Synthetic ticket '||n
 FROM generate_series(101,110) n;
 -- All bad-provenance tickets obey real table constraints, but cannot be closed by a delegate/cohort.
 UPDATE public.maintenance_tickets SET issue_source='manager_reminder',completion_response_id=NULL,session_id=NULL
 WHERE id='c7200000-0000-4000-8000-000000000103';
 UPDATE public.maintenance_tickets SET device_id=NULL WHERE id='c7200000-0000-4000-8000-000000000104';
END $fixture$;

-- Additional completed/open identities and directories. Preserve all normal table guards.
INSERT INTO public.employees(id,employee_code,display_name) VALUES
 ('c7200000-0000-4000-8000-000000000201','SYNTHETIC-RECORD-ALTERNATE','Synthetic corrected employee'),
 ('c7200000-0000-4000-8000-000000000211','SYNTHETIC-RECORD-PENDING','Synthetic pending employee');
INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES
 ('c7200000-0000-4000-8000-000000000202','SYNTHETIC-RECORD-ALTERNATE','Synthetic corrected location','restroom'),
 ('c7200000-0000-4000-8000-000000000212','SYNTHETIC-RECORD-PENDING','Synthetic pending location','restroom');
INSERT INTO public.devices(id,device_id,device_name,assigned_employee_id) VALUES
 ('c7200000-0000-4000-8000-000000000203','SYNTHETIC-RECORD-ALTERNATE','Synthetic corrected device','c7200000-0000-4000-8000-000000000201'),
 ('c7200000-0000-4000-8000-000000000213','SYNTHETIC-RECORD-PENDING','Synthetic pending device','c7200000-0000-4000-8000-000000000211');
INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,completion_source)
SELECT ('c7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'record-fixture-'||n,
 CASE WHEN n=205 THEN 'c7200000-0000-4000-8000-000000000202' ELSE 'c7200000-0000-4000-8000-000000000011' END::uuid,
 CASE WHEN n=205 THEN 'c7200000-0000-4000-8000-000000000201' ELSE 'c7200000-0000-4000-8000-000000000010' END::uuid,
 CASE WHEN n=205 THEN 'c7200000-0000-4000-8000-000000000203' ELSE 'c7200000-0000-4000-8000-000000000012' END::uuid,
 CASE n WHEN 204 THEN 'active' WHEN 205 THEN 'pending_submit' ELSE 'closed' END,
 clock_timestamp()-interval '5 minutes',CASE WHEN n=204 THEN NULL ELSE clock_timestamp()-interval '1 minute' END,
 CASE WHEN n IN(204,205) THEN NULL ELSE 'kiosk_form' END
FROM unnest(ARRAY[204,205,206,208]) n;

DO $records$
DECLARE
 manager uuid:='c7200000-0000-4000-8000-000000000001';credential uuid:='c7200000-0000-4000-8000-000000000002';
 browser text:='c7200000-0000-4000-8000-000000000003';request uuid:='c7200000-0000-4000-8000-000000000020';
 named uuid:='c7200000-0000-4000-8000-000000000006';original_session_id uuid:='c7200000-0000-4000-8000-000000000013';
 operation uuid:='c7200000-0000-4000-8000-000000000301';second_operation uuid:='c7200000-0000-4000-8000-000000000302';
 cohort_signature text:='public.custodial_leadership_record_operation_v1(uuid,uuid,text,text,jsonb)';
 named_signature text:='public.custodial_named_record_operation_v1(uuid,text,text,jsonb)';
 private_signature text:='custodial_leadership_private.record_operation_v1(jsonb,text,jsonb)';
 payload jsonb;other jsonb;r jsonb;first_result jsonb;receipt jsonb;later_receipt jsonb;actor jsonb;
 original_session jsonb;original_response jsonb;original_correction jsonb;claimed uuid;role_name text;signature text;bad_status integer;
 first_correction uuid;second_correction uuid;started timestamptz;ended timestamptz;before_count bigint;
BEGIN
 SELECT to_jsonb(s),s.started_at,s.ended_at INTO original_session,started,ended FROM public.sessions s WHERE id=original_session_id;
 SELECT to_jsonb(c) INTO original_response FROM public.completion_responses c WHERE id='c7200000-0000-4000-8000-000000000014';
 claimed:=(custodial_leadership_private.approved_names()->0->>'accountId')::uuid;
 payload:=jsonb_build_object('session_id',original_session_id,'operation_id',operation,'reason','Synthetic original correction',
  'expected_correction_id',NULL,'expected_session_uuid','legacy:original/record#Ω',
  'corrected_employee_id','c7200000-0000-4000-8000-000000000201',
  'corrected_location_id','c7200000-0000-4000-8000-000000000202',
  'corrected_device_id','c7200000-0000-4000-8000-000000000203',
  'corrected_started_at',started-interval '1 minute','corrected_ended_at',ended+interval '30 seconds');
 PERFORM pg_temp.record_assert(has_function_privilege('static_weekly_control_plane',cohort_signature,'EXECUTE')
  AND has_function_privilege('service_role',named_signature,'EXECUTE'),'exact separate named and cohort execution grants');
 FOREACH signature IN ARRAY ARRAY[cohort_signature,named_signature,private_signature] LOOP
  PERFORM pg_temp.record_assert(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid=signature::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'no PUBLIC execute: '||signature);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator'] LOOP
  PERFORM pg_temp.record_assert(NOT has_function_privilege(role_name,cohort_signature,'EXECUTE'),'cohort ACL denies '||role_name);
  BEGIN
   PERFORM set_config('role',role_name,true);
   PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'choices','{}');
   RAISE EXCEPTION 'Expected denied role call: %',role_name;
  EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
  PERFORM pg_temp.record_assert(true,'cohort actual role denial: '||role_name);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','static_weekly_control_plane','custodial_application_reader','static_weekly_release_operator'] LOOP
  PERFORM pg_temp.record_assert(NOT has_function_privilege(role_name,named_signature,'EXECUTE'),'named ACL denies '||role_name);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','static_weekly_control_plane','custodial_application_reader','static_weekly_release_operator'] LOOP
  PERFORM pg_temp.record_assert(NOT has_function_privilege(role_name,private_signature,'EXECUTE'),'private operation denies '||role_name);
 END LOOP;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'truth',jsonb_build_object('session_id',original_session_id));
  RAISE EXCEPTION 'Expected absent authenticated transaction context denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'control-plane role alone cannot authorize record access');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.static_weekly_leadership_bind_verified_request(credential,'c7200000-0000-4000-8000-000000000005',manager,request);
  RAISE EXCEPTION 'Expected original browser mismatch denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'opaque registration cannot bind a different browser');
 PERFORM set_config('role','static_weekly_control_plane',true);
 actor:=public.static_weekly_leadership_bind_verified_request(credential,browser::uuid,manager,request);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'choices','{}');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert(actor->>'claimed_account_id'=claimed::text AND actor->>'owner'='false'
  AND actor->>'individual_identity_verified'='false','actual binder preserves self-asserted selected name and non-owner cohort authority');
 PERFORM pg_temp.record_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(r->'employees') x WHERE x->>'id'='c7200000-0000-4000-8000-000000000201')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'locations') x WHERE x->>'id'='c7200000-0000-4000-8000-000000000202')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'devices') x WHERE x->>'id'='c7200000-0000-4000-8000-000000000203'),'choices return actual employee/location/phone identity values');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,'c7200000-0000-4000-8000-000000000004',browser,'correct',payload);
  RAISE EXCEPTION 'Expected original credential mismatch denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'record operation cannot substitute opaque registration');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload||'{"expected_session_uuid":"different opaque original"}'::jsonb);
  RAISE EXCEPTION 'Expected original session identity mismatch';
 EXCEPTION WHEN SQLSTATE '40901' THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'opaque session identity mismatch is denied without UUID coercion');
 FOR bad_status IN SELECT unnest(ARRAY[204,205]) LOOP
  BEGIN
   PERFORM set_config('role','static_weekly_control_plane',true);
   PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload||jsonb_build_object(
    'session_id',('c7200000-0000-4000-8000-'||lpad(bad_status::text,12,'0')),'expected_session_uuid','record-fixture-'||bad_status));
   RAISE EXCEPTION 'Expected unfinished session denial';
  EXCEPTION WHEN SQLSTATE '40901' THEN PERFORM set_config('role','none',true);END;
 END LOOP;
 PERFORM pg_temp.record_assert(NOT EXISTS(SELECT 1 FROM public.custodial_session_corrections WHERE session_id IN(
  'c7200000-0000-4000-8000-000000000204','c7200000-0000-4000-8000-000000000205')),'active and pending_submit cannot receive completed-record correction');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'truth','{"session_id":"not-a-uuid"}');
  RAISE EXCEPTION 'Expected malformed database row ID denial';
 EXCEPTION WHEN invalid_text_representation THEN PERFORM set_config('role','none',true);END;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'truth','{"session_id":"c7200000-0000-4000-8000-000000009999"}');
  RAISE EXCEPTION 'Expected missing database row ID denial';
 EXCEPTION WHEN no_data_found THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'invalid and missing database row IDs fail explicitly');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'arbitrary_rpc','{}');
  RAISE EXCEPTION 'Expected unknown action denial';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload||jsonb_build_object('manager_id',named));
  RAISE EXCEPTION 'Expected supplied actor injection denial';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'unknown actions and input actor injection are rejected');
 PERFORM set_config('role','static_weekly_control_plane',true);
 first_result:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'truth',jsonb_build_object('session_id',original_session_id));
 receipt:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'correction_outcome',jsonb_build_object('session_id',original_session_id,'operation_id',operation));
 PERFORM set_config('role','none',true);first_correction:=(first_result->>'correction_id')::uuid;
 PERFORM pg_temp.record_assert(first_result->>'replayed'='false' AND first_result->>'session_id'=original_session_id::text
  AND jsonb_array_length(first_result->'changed_fields')=5,'completed correction writes all five supplied changed facts once');
 PERFORM pg_temp.record_assert(r->>'correction_id'=first_correction::text AND r->>'current_employee_id'='c7200000-0000-4000-8000-000000000201'
  AND r->>'current_location_id'='c7200000-0000-4000-8000-000000000202' AND r->>'current_device_id'='c7200000-0000-4000-8000-000000000203'
  AND (r->>'current_started_at')::timestamptz=started-interval '1 minute' AND (r->>'current_ended_at')::timestamptz=ended+interval '30 seconds',
  'truth projection reads corrected facts without replacing original record');
 PERFORM pg_temp.record_assert((SELECT to_jsonb(s)=original_session FROM public.sessions s WHERE id=original_session_id)
  AND(SELECT to_jsonb(c)=original_response FROM public.completion_responses c WHERE id='c7200000-0000-4000-8000-000000000014'),'original session and submitted response remain byte-equivalent JSON facts');
 SELECT to_jsonb(c) INTO original_correction FROM public.custodial_session_corrections c WHERE correction_id=first_correction;
 PERFORM pg_temp.record_assert(original_correction->>'corrected_by_manager_id'=manager::text
  AND original_correction->>'corrected_by_manager_name_snapshot'=(actor->>'claimed_name')||' (shared PIN; self-asserted)',
  'correction attribution distinguishes cohort authority and selected self-asserted name');
 PERFORM pg_temp.record_assert((SELECT count(*)=1 FROM public.ops_manager_auth_events WHERE event_type='cleaning_record_correction_recorded'
  AND detail_json->>'operation_id'=operation::text AND credential_id IS NULL AND device_id=browser
  AND detail_json#>>'{actor,claimed_account_id}'=claimed::text AND detail_json#>>'{actor,credential_id}'=credential::text
  AND detail_json#>>'{actor,request_id}'=request::text AND detail_json#>>'{actor,owner}'='false'
  AND detail_json#>>'{actor,individual_identity_verified}'='false'),'audit retains selected claim, original registration/browser/request and non-owner assurance');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert(r->>'replayed'='true' AND r->>'correction_id'=first_correction::text
  AND(SELECT count(*)=1 FROM public.custodial_session_corrections WHERE operation_id=operation)
  AND(SELECT count(*)=1 FROM public.ops_manager_auth_events WHERE detail_json->>'operation_id'=operation::text),'identical replay returns original correction without duplicate row/audit');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload||'{"reason":"changed payload"}'::jsonb);
  RAISE EXCEPTION 'Expected conflicting original operation denial';
 EXCEPTION WHEN SQLSTATE '40901' THEN PERFORM set_config('role','none',true);END;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',payload||jsonb_build_object('operation_id',second_operation));
  RAISE EXCEPTION 'Expected stale preview CAS denial';
 EXCEPTION WHEN SQLSTATE '40901' THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert((SELECT to_jsonb(c)=original_correction FROM public.custodial_session_corrections c WHERE correction_id=first_correction)
  AND NOT EXISTS(SELECT 1 FROM public.custodial_session_corrections WHERE operation_id=second_operation),'different payload and stale preview cannot change original correction');
 other:=jsonb_build_object('session_id',original_session_id,'operation_id',second_operation,'reason','Synthetic later correction',
  'expected_correction_id',first_correction,'expected_session_uuid','legacy:original/record#Ω','corrected_ended_at',ended+interval '40 seconds');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'correct',other);
 later_receipt:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'correction_outcome',jsonb_build_object('session_id',original_session_id,'operation_id',operation));
 PERFORM set_config('role','none',true);second_correction:=(r->>'correction_id')::uuid;
 PERFORM pg_temp.record_assert(second_correction<>first_correction AND later_receipt=receipt
  AND(SELECT to_jsonb(c)=original_correction FROM public.custodial_session_corrections c WHERE correction_id=first_correction),'read-only original receipt stays exact after a later correction');
 PERFORM pg_temp.record_assert((SELECT correction_id=second_correction FROM public.v_custodial_cleaning_session_truth WHERE session_id=original_session_id),'latest truth follows later correction');
 -- Named successor and preserved named predecessor execute under service_role.
 BEGIN
  PERFORM set_config('role','service_role',true);
  PERFORM public.custodial_named_record_operation_v1(named,'wrong-secret','choices','{}');
  RAISE EXCEPTION 'Expected bad backend boundary denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 BEGIN
  PERFORM set_config('role','service_role',true);
  PERFORM public.custodial_named_record_operation_v1(manager,'synthetic-ticket-test-secret-not-production','choices','{}');
  RAISE EXCEPTION 'Expected cohort system principal rejected by named wrapper';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.record_assert(true,'named wrapper requires backend secret and independently named actor');
 PERFORM set_config('role','service_role',true);
 r:=public.custodial_named_record_operation_v1(named,'synthetic-ticket-test-secret-not-production','correct',jsonb_build_object(
  'session_id','c7200000-0000-4000-8000-000000000206','operation_id','c7200000-0000-4000-8000-000000000303','reason','Synthetic named successor',
  'expected_correction_id',NULL,'expected_session_uuid','record-fixture-206','corrected_employee_id','c7200000-0000-4000-8000-000000000201'));
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert((SELECT corrected_by_manager_id=named AND corrected_by_manager_name_snapshot='Synthetic named delegate'
  FROM public.custodial_session_corrections WHERE correction_id=(r->>'correction_id')::uuid),'named successor retains named identity without shared-PIN claim');
 PERFORM set_config('role','service_role',true);
 r:=public.custodial_append_session_correction('c7200000-0000-4000-8000-000000000304','c7200000-0000-4000-8000-000000000208',named,
  'Synthetic legacy named correction','synthetic-ticket-test-secret-not-production','c7200000-0000-4000-8000-000000000201',NULL,NULL,NULL,NULL);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert((SELECT corrected_by_manager_id=named FROM public.custodial_session_corrections WHERE correction_id=(r->>'correction_id')::uuid),'preserved named predecessor remains callable and attributed');
 PERFORM pg_temp.record_assert((SELECT to_jsonb(s)=original_session FROM public.sessions s WHERE id=original_session_id)
  AND(SELECT to_jsonb(c)=original_response FROM public.completion_responses c WHERE id='c7200000-0000-4000-8000-000000000014'),'all later operations still preserve original raw session and response');
END $records$;

-- All three approved open-problem sources, with negative rows retained intact.
UPDATE public.maintenance_tickets SET status='closed',closed_at=clock_timestamp(),closed_by='Synthetic fixture'
WHERE id='c7200000-0000-4000-8000-000000000110';
INSERT INTO public.guest_cleanliness_reports(id,location_code,location_name,issue_type,severity,status,marketing_review_status,notification_status)
VALUES
 ('c7200000-0000-4000-8000-000000000601','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic approved guest location','Synthetic approved issue','normal','open','approved','awaiting_marketing_review'),
 ('c7200000-0000-4000-8000-000000000602','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic unapproved guest location','Synthetic pending issue','normal','pending_marketing_review','pending','awaiting_marketing_review'),
 ('c7200000-0000-4000-8000-000000000603','SYNTHETIC-SIGNED-TICKET-TEST','Synthetic resolved guest location','Synthetic resolved issue','normal','resolved','approved','awaiting_marketing_review');
INSERT INTO public.custodial_offline_reconciliation_records(reconciliation_id,original_employee_id,device_id,location_id,
 client_session_id,client_completion_id,payload_fingerprint,payload_json,state,quarantine_reason,result_json)
SELECT ('c7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'c7200000-0000-4000-8000-000000000010','c7200000-0000-4000-8000-000000000012','c7200000-0000-4000-8000-000000000011',
 'synthetic-record-reconciliation-'||n,'c7200000-0000-4000-8000-'||lpad(n::text,12,'0'),repeat('a',64),jsonb_build_object('original',n),
 CASE WHEN n=632 THEN 'committed' ELSE 'quarantined' END,CASE WHEN n=632 THEN NULL ELSE 'synthetic_review_required' END,'{}'::jsonb
FROM unnest(ARRAY[630,631,632]) n;
INSERT INTO public.custodial_offline_reconciliation_dispositions(reconciliation_id,manager_id,disposition,reason,original_evidence_fingerprint,request_id,request_fingerprint)
VALUES('c7200000-0000-4000-8000-000000000631','c7200000-0000-4000-8000-000000000001','superseded_by_new_occurrence','Synthetic fixture only',repeat('a',64),'c7200000-0000-4000-8000-000000000633',
 encode(extensions.digest(convert_to('synthetic-record-disposition-631','UTF8'),'sha256'),'hex'));
INSERT INTO public.system_settings(setting_key,setting_value) VALUES('guest_issues_feature_approved','false'::jsonb)
ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value;
DO $problems$
DECLARE manager uuid:='c7200000-0000-4000-8000-000000000001';credential uuid:='c7200000-0000-4000-8000-000000000002';
 browser text:='c7200000-0000-4000-8000-000000000003';r jsonb;small jsonb;before_pending bigint;bad jsonb;original_saved jsonb;
BEGIN
 SELECT to_jsonb(x) INTO original_saved FROM public.custodial_offline_reconciliation_records x WHERE reconciliation_id='c7200000-0000-4000-8000-000000000630';
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'open_problems','{"limit":200}');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source'='guest'),
  'feature-unapproved guest reports are absent from manager open problems');
 UPDATE public.system_settings SET setting_value='true'::jsonb WHERE setting_key='guest_issues_feature_approved';
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'open_problems','{"limit":200}');
 small:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'open_problems','{"limit":1}');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert(r->>'schema'='custodial.open-problems.v1'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source'='maintenance' AND x->>'source_id'='c7200000-0000-4000-8000-000000000101')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source'='guest' AND x->>'source_id'='c7200000-0000-4000-8000-000000000601')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source'='saved_work' AND x->>'source_id'='c7200000-0000-4000-8000-000000000630'),
  'open-problems union includes open maintenance, approved guest and retained quarantine');
 PERFORM pg_temp.record_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source_id' IN(
  'c7200000-0000-4000-8000-000000000110','c7200000-0000-4000-8000-000000000602','c7200000-0000-4000-8000-000000000603',
  'c7200000-0000-4000-8000-000000000631','c7200000-0000-4000-8000-000000000632','c7200000-0000-4000-8000-000000000205')),
  'closed/unapproved/resolved/superseded/committed and pending_submit rows are excluded');
 PERFORM pg_temp.record_assert(jsonb_array_length(small->'items')=1 AND small->'total'=r->'total'
  AND small->'items'->0=r->'items'->0,'problem limit bounds items without truncating total or changing first winner');
 before_pending:=(r->>'total')::bigint;
 INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at)
 VALUES('c7200000-0000-4000-8000-000000000209','record-fixture-pending-not-problem',
  'c7200000-0000-4000-8000-000000000212','c7200000-0000-4000-8000-000000000211','c7200000-0000-4000-8000-000000000213',
  'pending_submit',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '1 minute');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_record_operation_v1(manager,credential,browser,'open_problems','{"limit":200}');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.record_assert((r->>'total')::bigint=before_pending
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') x WHERE x->>'source_id'='c7200000-0000-4000-8000-000000000209'),
  'adding ordinary pending submission never creates an open problem');
 FOREACH bad IN ARRAY ARRAY['{"limit":0}'::jsonb,'{"limit":201}'::jsonb,'{"limit":"1"}'::jsonb,'{}'::jsonb,'{"limit":1,"actor":"injected"}'::jsonb] LOOP
  BEGIN
   PERFORM set_config('role','static_weekly_control_plane',true);
   PERFORM public.custodial_leadership_record_operation_v1(manager,credential,browser,'open_problems',bad);
   RAISE EXCEPTION 'Expected bounded typed problem limit denial';
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 END LOOP;
 PERFORM pg_temp.record_assert(true,'problem query rejects unbounded, untyped and extra input');
 PERFORM pg_temp.record_assert((SELECT to_jsonb(x)=original_saved FROM public.custodial_offline_reconciliation_records x WHERE reconciliation_id='c7200000-0000-4000-8000-000000000630'),
  'open-problems reads preserve original quarantined evidence');
END $problems$;
SELECT jsonb_build_object('suite','record-operations-completed-truth-open-problems','scope','isolated real SQL only when executed by root; synthetic fixtures; full rollback',
 'passed',count(*),'checks',jsonb_agg(label ORDER BY label)) FROM record_operation_checks;
ROLLBACK;
-- Same-connection read-only cleanup check. No owned fixture row or helper survives.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.ops_manager_managers WHERE manager_id='c7200000-0000-4000-8000-000000000001')
  OR EXISTS(SELECT 1 FROM public.custodial_session_corrections WHERE operation_id IN(
   'c7200000-0000-4000-8000-000000000301','c7200000-0000-4000-8000-000000000302','c7200000-0000-4000-8000-000000000303','c7200000-0000-4000-8000-000000000304'))
  OR EXISTS(SELECT 1 FROM public.guest_cleanliness_reports WHERE id='c7200000-0000-4000-8000-000000000601')
  OR EXISTS(SELECT 1 FROM public.custodial_offline_reconciliation_records WHERE reconciliation_id='c7200000-0000-4000-8000-000000000630')
  OR to_regclass('pg_temp.record_operation_checks') IS NOT NULL THEN
  RAISE EXCEPTION 'Synthetic record fixture rollback cleanup failed';END IF;
 RAISE NOTICE 'PASS: entire record-operation fixture rolled back';
END$$;
