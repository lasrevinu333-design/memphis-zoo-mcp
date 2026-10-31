\set ON_ERROR_STOP on
-- ROOT-OWNED DISPOSABLE DATABASE ONLY. COMMITTED SYNTHETIC FIXTURES.
-- Root runner destroys its exact owned container in finally; no production use.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
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
 VALUES('c7200000-0000-4000-8000-000000000013','c7200000-0000-4000-8000-000000000013',
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

COMMIT;
SELECT custodial_leadership_private.session_view('c7200000-0000-4000-8000-000000000002') AS session;
