\set ON_ERROR_STOP on
-- ROOT-OWNED DISPOSABLE fresh302 DATABASE ONLY. No network, no production.
-- Apply the proposed successor first. Run as supabase_admin/postgres fixture
-- owner with permission to SET ROLE. Every fixture and injected trigger rolls back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE ticket_cohort_test_results(label text PRIMARY KEY, passed boolean NOT NULL);
CREATE FUNCTION pg_temp.ticket_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label;END IF;
 INSERT INTO ticket_cohort_test_results VALUES(label,true);RAISE NOTICE 'PASS: %',label;
END$$;
CREATE FUNCTION pg_temp.ticket_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.detail_json->>'ticket_id'='c7100000-0000-4000-8000-000000000108' THEN
  RAISE EXCEPTION 'synthetic audit-write failure' USING ERRCODE='PZ001';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER ticket_cohort_fixture_audit_failure BEFORE INSERT ON public.ops_manager_auth_events
 FOR EACH ROW EXECUTE FUNCTION pg_temp.ticket_fail_audit();

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
 VALUES('c7100000-0000-4000-8000-000000000001','Synthetic cohort authority','synthetic_ticket_cohort',ARRAY['OPS_MANAGER'],true),
 ('c7100000-0000-4000-8000-000000000006','Synthetic named delegate','synthetic_ticket_delegate',ARRAY['OPS_MANAGER'],false);
 UPDATE custodial_leadership_private.policy SET enabled=true,
  cohort_principal_id='c7100000-0000-4000-8000-000000000001',policy_version=1,
  permissions=ARRAY['custodial.read','custodial.edit','custodialManagementAdmin'],
  approved_by=owner_id,approved_at=clock_timestamp(),approval_ref='c7100000-0000-4000-8000-000000000009';
 IF NOT FOUND THEN RAISE EXCEPTION 'Fixture requires singleton leadership policy row';END IF;
 INSERT INTO custodial_leadership_private.registrations(registration_id,browser_id,token_hash,browser_hash,
  claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
 VALUES('c7100000-0000-4000-8000-000000000002','c7100000-0000-4000-8000-000000000003',repeat('1',64),repeat('2',64),
  claimed_id,'c7100000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour'),
 ('c7100000-0000-4000-8000-000000000004','c7100000-0000-4000-8000-000000000005',repeat('3',64),repeat('4',64),
  claimed_id,'c7100000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
 INSERT INTO public.ops_manager_trusted_devices(credential_id,manager_id,device_id,device_label,token_hash,max_access_level,created_at,expires_at)
 VALUES('c7100000-0000-4000-8000-000000000007','c7100000-0000-4000-8000-000000000006',
  'synthetic-ticket-delegate','Synthetic delegate browser',repeat('5',64),'read_only',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour'),
 ('c7100000-0000-4000-8000-000000000008',owner_id,'synthetic-ticket-owner','Synthetic owner browser',repeat('6',64),
  'full_access',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
 INSERT INTO public.custodial_backend_execution_config(config_key,enabled,execution_secret_digest)
 VALUES(true,true,encode(extensions.digest(convert_to('synthetic-ticket-test-secret-not-production','UTF8'),'sha256'),'hex'))
 ON CONFLICT(config_key) DO UPDATE SET enabled=excluded.enabled,execution_secret_digest=excluded.execution_secret_digest;
 INSERT INTO public.employees(id,employee_code,display_name) VALUES
 ('c7100000-0000-4000-8000-000000000010','SYNTHETIC-TICKET-TEST','Synthetic ticket employee');
 INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES
 ('c7100000-0000-4000-8000-000000000011','SYNTHETIC-TICKET-TEST','Synthetic ticket location','restroom');
 INSERT INTO public.devices(id,device_id,device_name,assigned_employee_id) VALUES
 ('c7100000-0000-4000-8000-000000000012','SYNTHETIC-TICKET-TEST','Synthetic ticket device','c7100000-0000-4000-8000-000000000010');
 INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,status,started_at,ended_at,completion_source)
 VALUES('c7100000-0000-4000-8000-000000000013','c7100000-0000-4000-8000-000000000013',
  'c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000010','c7100000-0000-4000-8000-000000000012',
  'closed',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '1 minute','kiosk_form');
 INSERT INTO public.completion_responses(id,session_id,location_id,submitted_by_employee_id,device_id,response_json)
 VALUES('c7100000-0000-4000-8000-000000000014','c7100000-0000-4000-8000-000000000013',
  'c7100000-0000-4000-8000-000000000011','c7100000-0000-4000-8000-000000000010','c7100000-0000-4000-8000-000000000012',
  '{"work_result":"checked_no_cleaning_needed","services_performed":[],"maintenance_issues_found":["Synthetic issue"]}');
 INSERT INTO public.maintenance_tickets(id,completion_response_id,session_id,location_id,reported_by_employee_id,device_id,issue_source,issue_summary)
 SELECT ('c7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'c7100000-0000-4000-8000-000000000014','c7100000-0000-4000-8000-000000000013','c7100000-0000-4000-8000-000000000011',
  'c7100000-0000-4000-8000-000000000010','c7100000-0000-4000-8000-000000000012','completion_form','Synthetic ticket '||n
 FROM generate_series(101,110) n;
 -- All bad-provenance tickets obey real table constraints, but cannot be closed by a delegate/cohort.
 UPDATE public.maintenance_tickets SET issue_source='manager_reminder',completion_response_id=NULL,session_id=NULL
 WHERE id='c7100000-0000-4000-8000-000000000103';
 UPDATE public.maintenance_tickets SET device_id=NULL WHERE id='c7100000-0000-4000-8000-000000000104';
 PERFORM pg_temp.ticket_assert(NOT EXISTS(SELECT 1 FROM public.ops_manager_trusted_devices WHERE credential_id IN(
  'c7100000-0000-4000-8000-000000000002','c7100000-0000-4000-8000-000000000004')),
  'cohort registrations are not forged named trusted credentials');
END $fixture$;

DO $tests$
DECLARE
 manager uuid:='c7100000-0000-4000-8000-000000000001';credential uuid:='c7100000-0000-4000-8000-000000000002';
 browser text:='c7100000-0000-4000-8000-000000000003';request uuid:='c7100000-0000-4000-8000-000000000020';
 fixed uuid:='c7100000-0000-4000-8000-000000000101';work_order uuid:='c7100000-0000-4000-8000-000000000102';
 nonscan uuid:='c7100000-0000-4000-8000-000000000103';missing_device uuid:='c7100000-0000-4000-8000-000000000104';
 named_ticket uuid:='c7100000-0000-4000-8000-000000000105';owner_ticket uuid:='c7100000-0000-4000-8000-000000000106';
 rollback_ticket uuid:='c7100000-0000-4000-8000-000000000108';
 payload jsonb;r jsonb;actor jsonb;v_role text;failure_code text;original_history jsonb;owner_id uuid;claimed_id uuid;
 signature text:='public.custodial_leadership_ticket_operation_v1(uuid,uuid,text,text,jsonb)';
BEGIN
 owner_id:=(custodial_leadership_private.approved_names()->5->>'accountId')::uuid;
 claimed_id:=(custodial_leadership_private.approved_names()->0->>'accountId')::uuid;
 payload:=jsonb_build_object('ticket_id',fixed,'outcome','mark_fixed','external_work_order_reference',NULL,'close_notes','Synthetic fixed');
 PERFORM pg_temp.ticket_assert(has_function_privilege('static_weekly_control_plane',signature,'EXECUTE'),'exact control-plane execution grant exists');
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator'] LOOP
  PERFORM pg_temp.ticket_assert(NOT has_function_privilege(v_role,signature,'EXECUTE'),'new operation denied grant: '||v_role);
  BEGIN
   PERFORM set_config('role',v_role,true);
   PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
   RAISE EXCEPTION 'Expected direct role denial: %',v_role;
  EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
  PERFORM pg_temp.ticket_assert(true,'actual denied call: '||v_role);
 END LOOP;
 -- Even an allowed runtime role needs the independently authenticated transaction context.
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'ticket_capabilities',jsonb_build_object('ticket_ids',jsonb_build_array(fixed)));
  RAISE EXCEPTION 'Expected missing context denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'control-plane role alone cannot impersonate a cohort');
 -- A bind rolled back with its subtransaction supplies no surviving authority.
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.static_weekly_leadership_bind_verified_request(credential,browser::uuid,manager,request);
  RAISE EXCEPTION 'synthetic transaction abort' USING ERRCODE='PZ002';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN PERFORM set_config('role','none',true);END;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
  RAISE EXCEPTION 'Expected rolled-back binding denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'rolled-back context cannot authorize a later statement');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.static_weekly_leadership_bind_verified_request(credential,'c7100000-0000-4000-8000-000000000005',manager,request);
  RAISE EXCEPTION 'Expected browser mismatch denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'registration cannot bind another browser');
 PERFORM set_config('role','static_weekly_control_plane',true);
 actor:=public.static_weekly_leadership_bind_verified_request(credential,browser::uuid,manager,request);
 r:=public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'ticket_capabilities',
  jsonb_build_object('ticket_ids',jsonb_build_array(fixed,nonscan,missing_device)));
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(actor->>'manager_id'=manager::text AND actor->>'credential_id'=credential::text
  AND actor->>'owner'='false' AND actor->>'individual_identity_verified'='false' AND actor->>'claimed_account_id'=claimed_id::text,
  'real binder retains cohort authority and self-asserted claimed account');
 PERFORM pg_temp.ticket_assert((SELECT x->>'can_close'='true' AND x->>'scan_session_verified'='true' FROM jsonb_array_elements(r->'tickets') x WHERE x->>'ticket_id'=fixed::text),
  'cohort capabilities permit verified scan-origin ticket');
 PERFORM pg_temp.ticket_assert((SELECT bool_and(x->>'can_close'='false') FROM jsonb_array_elements(r->'tickets') x WHERE x->>'ticket_id' IN(nonscan::text,missing_device::text)),
  'capabilities reject non-scan and broken-provenance tickets');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.static_weekly_leadership_bind_verified_request('c7100000-0000-4000-8000-000000000004','c7100000-0000-4000-8000-000000000005',manager,request);
  RAISE EXCEPTION 'Expected same-transaction credential substitution denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'original transaction cannot be rebound to another registration');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,'c7100000-0000-4000-8000-000000000004',browser,'close_outcome',payload);
  RAISE EXCEPTION 'Expected operation credential mismatch denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'operation must match original bound credential');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(owner_id,'c7100000-0000-4000-8000-000000000008','synthetic-ticket-owner','close_outcome',payload);
  RAISE EXCEPTION 'Expected named actor denial on cohort-only operation';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'cohort-only operation cannot be used as a named-owner adapter');
 -- Revoke / policy-version change / context expiry after bind must all fail closed.
 UPDATE custodial_leadership_private.registrations SET revoked_at=clock_timestamp() WHERE registration_id=credential;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
  RAISE EXCEPTION 'Expected revoked registration denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 UPDATE custodial_leadership_private.registrations SET revoked_at=NULL WHERE registration_id=credential;
 PERFORM pg_temp.ticket_assert(true,'registration revocation is rechecked at mutation');
 UPDATE custodial_leadership_private.policy SET policy_version=2;
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
  RAISE EXCEPTION 'Expected changed policy denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 UPDATE custodial_leadership_private.policy SET policy_version=1;
 PERFORM pg_temp.ticket_assert(true,'policy version change invalidates original context');
 UPDATE custodial_leadership_private.request_contexts SET created_at=clock_timestamp()-interval '6 minutes'
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
  RAISE EXCEPTION 'Expected stale context denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 UPDATE custodial_leadership_private.request_contexts SET created_at=clock_timestamp()
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 PERFORM pg_temp.ticket_assert(true,'expired transaction context is denied');
 FOREACH v_role IN ARRAY ARRAY[nonscan::text,missing_device::text] LOOP
  BEGIN
   PERFORM set_config('role','static_weekly_control_plane',true);
   PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload||jsonb_build_object('ticket_id',v_role));
   RAISE EXCEPTION 'Expected scan provenance denial';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 END LOOP;
 PERFORM pg_temp.ticket_assert((SELECT bool_and(status='open') FROM public.maintenance_tickets WHERE id IN(nonscan,missing_device)),
  'writer rejects non-scan and missing-device provenance without mutation');
 -- Invalid outcome/reference, input identity injection, unknown operation, duplicate list and oversized list.
 FOR r IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  payload||'{"outcome":"work_order_sent"}'::jsonb,
  payload||'{"external_work_order_reference":"NOT-ALLOWED"}'::jsonb,
  payload||'{"outcome":"invented"}'::jsonb,
  payload||jsonb_build_object('close_notes',repeat('x',1001)),
  payload||jsonb_build_object('manager_id',owner_id))) LOOP
  BEGIN
   PERFORM set_config('role','static_weekly_control_plane',true);
   PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',r);
   RAISE EXCEPTION 'Expected invalid typed input denial';
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 END LOOP;
 PERFORM pg_temp.ticket_assert((SELECT status='open' FROM public.maintenance_tickets WHERE id=fixed),'invalid input cannot mutate ticket');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'arbitrary_rpc',payload);
  RAISE EXCEPTION 'Expected unknown action denial';
 EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'fixed operation dispatcher rejects arbitrary RPC/action');
 FOREACH r IN ARRAY ARRAY[
  jsonb_build_object('ticket_ids',jsonb_build_array(fixed,fixed)),
  jsonb_build_object('ticket_ids',(SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1,101))),
  jsonb_build_object('ticket_ids',jsonb_build_array(NULL))] LOOP
  BEGIN
   PERFORM set_config('role','static_weekly_control_plane',true);
   PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'ticket_capabilities',r);
   RAISE EXCEPTION 'Expected bounded unique ticket list denial';
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM set_config('role','none',true);END;
 END LOOP;
 PERFORM pg_temp.ticket_assert(true,'capability list is unique, non-null and bounded to 100');
 -- Successful write, immutable authority/readback, exact replay and conflicting replay.
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'status'='closed' AND r->>'outcome'='mark_fixed' AND r->>'actor_manager_id'=manager::text
  AND r->>'replayed'='false','mark_fixed returns recorded cohort result');
 PERFORM pg_temp.ticket_assert((SELECT status='closed' AND resolution_actor_manager_id=manager AND closed_by='Custodial leadership cohort'
  AND external_work_order_reference IS NULL FROM public.maintenance_tickets WHERE id=fixed),'persisted ticket identifies cohort, never claimed named owner');
 SELECT to_jsonb(h) INTO original_history FROM public.maintenance_ticket_outcome_history h WHERE ticket_id=fixed;
 PERFORM pg_temp.ticket_assert(original_history->>'actor_manager_id'=manager::text AND original_history->>'actor_name_snapshot'='Custodial leadership cohort',
  'append-only outcome history attributes authority to cohort');
 PERFORM pg_temp.ticket_assert((SELECT count(*)=1 FROM public.ops_manager_auth_events e WHERE detail_json->>'ticket_id'=fixed::text
  AND credential_id IS NULL AND device_id=browser AND detail_json#>>'{actor,credential_id}'=credential::text
  AND detail_json#>>'{actor,claimed_account_id}'=claimed_id::text AND detail_json#>>'{actor,request_id}'=request::text
  AND detail_json#>>'{actor,owner}'='false' AND detail_json#>>'{actor,identity_assurance}'='SELF_ASSERTED_NAME'
  AND detail_json#>>'{actor,individual_identity_verified}'='false'),
  'audit records original registration/browser/request and explicitly self-asserted name without invalid legacy FK');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'replayed'='true' AND r->>'actor_manager_id'=manager::text,'identical replay returns original attribution');
 PERFORM pg_temp.ticket_assert((SELECT count(*)=1 AND bool_and(to_jsonb(h)=original_history) FROM public.maintenance_ticket_outcome_history h WHERE ticket_id=fixed)
  AND(SELECT count(*)=1 FROM public.ops_manager_auth_events WHERE detail_json->>'ticket_id'=fixed::text),'replay neither changes history nor appends duplicate audit');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload||'{"close_notes":"changed"}'::jsonb);
  RAISE EXCEPTION 'Expected conflicting replay denial';
 EXCEPTION WHEN SQLSTATE '40901' THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert((SELECT to_jsonb(h)=original_history FROM public.maintenance_ticket_outcome_history h WHERE ticket_id=fixed),
  'conflicting replay cannot replace original history');
 BEGIN
  UPDATE public.maintenance_ticket_outcome_history SET notes='rewritten' WHERE ticket_id=fixed;
  RAISE EXCEPTION 'Expected append-only history denial';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 PERFORM pg_temp.ticket_assert(true,'existing append-only history trigger remains effective');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',
  jsonb_build_object('ticket_id',work_order,'outcome','work_order_sent','external_work_order_reference','  SYNTHETIC-WO-123  ','close_notes',NULL));
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'outcome'='work_order_sent' AND r->>'external_work_order_reference'='SYNTHETIC-WO-123'
  AND(SELECT resolution_outcome='work_order_sent' AND external_work_order_reference='SYNTHETIC-WO-123' FROM public.maintenance_tickets WHERE id=work_order),
  'work_order_sent stores only supplied already-submitted reference');
 BEGIN
  PERFORM set_config('role','static_weekly_control_plane',true);
  PERFORM public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',payload||jsonb_build_object('ticket_id',rollback_ticket));
  RAISE EXCEPTION 'Expected injected audit INSERT failure';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert((SELECT status='open' AND resolution_outcome IS NULL FROM public.maintenance_tickets WHERE id=rollback_ticket)
  AND NOT EXISTS(SELECT 1 FROM public.maintenance_ticket_outcome_history WHERE ticket_id=rollback_ticket)
  AND NOT EXISTS(SELECT 1 FROM public.ops_manager_auth_events WHERE detail_json->>'ticket_id'=rollback_ticket::text),
  'audit-write failure rolls back ticket closure and history atomically');
 -- Legacy named semantics are retained: delegated read-only credential closes only scan tickets;
 -- owner full-access credential can close non-scan tickets; no function replacement is needed.
 PERFORM set_config('role','service_role',true);
 r:=public.custodial_close_scan_ticket_outcome_v1('c7100000-0000-4000-8000-000000000006','c7100000-0000-4000-8000-000000000007',
  'synthetic-ticket-delegate','read_only',named_ticket,'mark_fixed',NULL,'Synthetic named closure','synthetic-ticket-test-secret-not-production');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'actor_manager_id'='c7100000-0000-4000-8000-000000000006'
  AND(SELECT count(*)=1 FROM public.ops_manager_auth_events WHERE detail_json->>'ticket_id'=named_ticket::text
   AND credential_id='c7100000-0000-4000-8000-000000000007'),'legacy named delegate retains original identity and trusted credential audit');
 PERFORM set_config('role','static_weekly_control_plane',true);
 r:=public.custodial_leadership_ticket_operation_v1(manager,credential,browser,'close_outcome',
  jsonb_build_object('ticket_id',named_ticket,'outcome','mark_fixed','external_work_order_reference',NULL,'close_notes','Synthetic named closure'));
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'replayed'='true' AND r->>'actor_manager_id'='c7100000-0000-4000-8000-000000000006'
  AND(SELECT count(*)=1 FROM public.ops_manager_auth_events WHERE detail_json->>'ticket_id'=named_ticket::text),
  'cohort replay of named original preserves named author and creates no new audit');
 BEGIN
  PERFORM set_config('role','service_role',true);
  PERFORM public.custodial_close_scan_ticket_outcome_v1('c7100000-0000-4000-8000-000000000006','c7100000-0000-4000-8000-000000000007',
   'synthetic-ticket-delegate','read_only',nonscan,'mark_fixed',NULL,NULL,'synthetic-ticket-test-secret-not-production');
  RAISE EXCEPTION 'Expected named delegate non-scan denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'legacy named delegate cannot close non-scan ticket');
 UPDATE public.maintenance_tickets SET issue_source='manager_reminder',completion_response_id=NULL,session_id=NULL WHERE id=owner_ticket;
 PERFORM set_config('role','service_role',true);
 r:=public.custodial_close_scan_ticket_outcome_v1(owner_id,'c7100000-0000-4000-8000-000000000008','synthetic-ticket-owner',
  'full_access',owner_ticket,'mark_fixed',NULL,NULL,'synthetic-ticket-test-secret-not-production');
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.ticket_assert(r->>'actor_manager_id'=owner_id::text,'legacy independently named owner retains non-scan closure permission');
 BEGIN
  PERFORM set_config('role','service_role',true);
  PERFORM public.custodial_close_scan_ticket_outcome_v1(owner_id,'c7100000-0000-4000-8000-000000000008','synthetic-ticket-owner',
   'read_only',nonscan,'mark_fixed',NULL,NULL,'synthetic-ticket-test-secret-not-production');
  RAISE EXCEPTION 'Expected limited owner denial';
 EXCEPTION WHEN insufficient_privilege THEN PERFORM set_config('role','none',true);END;
 PERFORM pg_temp.ticket_assert(true,'legacy owner read-only session is not elevated');
END $tests$;
SELECT jsonb_build_object('suite','ticket-cohort-final302-plus-successor','scope','isolated real SQL, synthetic fixtures, transaction rollback',
 'passed',(SELECT count(*) FROM ticket_cohort_test_results),'checks',(SELECT jsonb_agg(label ORDER BY label) FROM ticket_cohort_test_results));
ROLLBACK;
-- Verify rollback cleanup from the same connection. No fixture row/trigger may survive.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.ops_manager_managers WHERE manager_id='c7100000-0000-4000-8000-000000000001')
  OR EXISTS(SELECT 1 FROM public.maintenance_tickets WHERE id BETWEEN 'c7100000-0000-4000-8000-000000000101'::uuid AND 'c7100000-0000-4000-8000-000000000110'::uuid)
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ticket_cohort_fixture_audit_failure')
 THEN RAISE EXCEPTION 'Synthetic ticket fixture cleanup failed';END IF;
 RAISE NOTICE 'PASS: fixture transaction rollback left no cohort/ticket/audit-failure trigger';
END$$;
