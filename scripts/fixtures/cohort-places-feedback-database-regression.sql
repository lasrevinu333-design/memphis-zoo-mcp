BEGIN;
INSERT INTO public.custodial_backend_execution_config(config_key,execution_secret_digest,enabled,configured_by)
 VALUES(true,encode(extensions.digest('solo-audit-synthetic-backend-secret-0001','sha256'),'hex'),true,'solo repair fixture')
 ON CONFLICT(config_key) DO UPDATE SET execution_secret_digest=excluded.execution_secret_digest,enabled=true;
INSERT INTO public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal,system_key)
 VALUES('0a110000-0000-4000-8000-000000000001','Synthetic cohort',array['OPS_MANAGER'],true,true,'solo_repair_synthetic_cohort'),
 ('0a110000-0000-4000-8000-000000000002','Synthetic individual',array['OPS_MANAGER'],true,false,'solo_repair_synthetic_individual');
UPDATE custodial_leadership_private.policy SET enabled=true,cohort_principal_id='0a110000-0000-4000-8000-000000000001',permissions=ARRAY['custodialManagementAdmin'],approved_by='0a110000-0000-4000-8000-000000000002',approved_at=clock_timestamp(),approval_ref='0a110000-0000-4000-8000-000000000008' WHERE singleton;
-- Populate only this rollback-only fixture's required six approved-name rows.
WITH required(key) AS(VALUES ('eric_mckenney_facilities_maintenance_manager'),('haley_lejman_water_quality_manager'),('brandy_gull_horticulture_manager'),('jennifer_sheffield_director_operations'),('annie_feist_operations_admin'),('eric_custodial_manager'))
INSERT INTO public.ops_manager_managers(display_name,system_key,active,is_system_principal)
SELECT 'Synthetic approved-name fixture',key,true,false FROM required r WHERE NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.system_key=r.key);
UPDATE public.ops_manager_managers SET active=true,revoked_at=null WHERE system_key IN('eric_mckenney_facilities_maintenance_manager','haley_lejman_water_quality_manager','brandy_gull_horticulture_manager','jennifer_sheffield_director_operations','annie_feist_operations_admin','eric_custodial_manager');
INSERT INTO custodial_leadership_private.registrations(registration_id,browser_id,token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
 SELECT '0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004',repeat('a',64),repeat('b',64),
 (custodial_leadership_private.approved_names()->0->>'accountId')::uuid,'0a110000-0000-4000-8000-000000000001',policy_version,'infinity'::timestamptz
 FROM custodial_leadership_private.policy WHERE singleton;
INSERT INTO public.devices(id,device_id,device_name,assignment_epoch)
 VALUES('0a110000-0000-4000-8000-000000000005','SOLO_AUDIT_SYNTHETIC','Synthetic audit device',1);
INSERT INTO public.employees(id,display_name,role,active) VALUES('0a110000-0000-4000-8000-000000000009','Synthetic test custodian','staff',true);
INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES('0a110000-0000-4000-8000-000000000010','SOLO_TEST','Synthetic test restroom','restroom');
INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,started_at)
 SELECT '0a110000-0000-4000-8000-000000000006',E'..\t原始/session?#',l.id,e.id,'0a110000-0000-4000-8000-000000000005','2026-10-01T12:00:00Z'
 FROM (SELECT id FROM public.locations WHERE id='0a110000-0000-4000-8000-000000000010') l CROSS JOIN (SELECT id FROM public.employees WHERE id='0a110000-0000-4000-8000-000000000009') e;
DO $fixture$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sessions WHERE id='0a110000-0000-4000-8000-000000000006') THEN RAISE EXCEPTION 'Synthetic session fixture was not inserted';END IF;END $fixture$;
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.custodial_manager_completion_evidence('0a110000-0000-4000-8000-000000000002',E'..\t原始/session?#','solo-audit-synthetic-backend-secret-0001');
 IF result->>'session_uuid' IS DISTINCT FROM E'..\t原始/session?#' OR result->'completion_recorded' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'named exact target projection failed';END IF;
 PERFORM set_config('solo.expected_completion',result::text,true);
 BEGIN PERFORM public.custodial_manager_completion_evidence('0a110000-0000-4000-8000-000000000001',E'..\t原始/session?#','solo-audit-synthetic-backend-secret-0001');RAISE EXCEPTION 'named wrapper accepted cohort impersonation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $test$;
SET LOCAL ROLE static_weekly_control_plane;
DO $test$ BEGIN
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','completion_evidence',jsonb_build_object('session_uuid',E'..\t原始/session?#'));RAISE EXCEPTION 'unbound cohort read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM custodial_leadership_private.completion_evidence_v1(E'..\t原始/session?#');RAISE EXCEPTION 'private helper directly callable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $test$;
SELECT public.static_weekly_leadership_bind_verified_request('0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000007');
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','completion_evidence',jsonb_build_object('session_uuid',E'..\t原始/session?#'));
 IF result IS DISTINCT FROM current_setting('solo.expected_completion')::jsonb THEN RAISE EXCEPTION 'cohort and named original projections differ';END IF;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','forged-browser','completion_evidence',jsonb_build_object('session_uuid',E'..\t原始/session?#'));RAISE EXCEPTION 'changed browser accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','completion_evidence',jsonb_build_object('session_uuid',E'..\t原始/session?#','manager_id','forged'));RAISE EXCEPTION 'extra actor input accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','completion_evidence',jsonb_build_object('session_uuid','nonexistent'));RAISE EXCEPTION 'missing session invented';EXCEPTION WHEN no_data_found THEN NULL;END;
END $test$;
RESET ROLE;
UPDATE public.ops_manager_managers SET roles=ARRAY['CUSTODIAL_MANAGER'] WHERE manager_id='0a110000-0000-4000-8000-000000000002';
SET LOCAL ROLE static_weekly_control_plane;
SELECT set_config('solo.cohort_actor',public.custodial_action_actor_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','full_access','read')::text,true);
RESET ROLE;
INSERT INTO public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,device_id,metadata_json)
SELECT '0b330000-0000-4000-8000-000000000001','0b330000-0000-4000-8000-000000000002',repeat('f',64),'other','normal','Synthetic cohort original feedback','Synthetic cohort','manager','0a110000-0000-4000-8000-000000000004',jsonb_build_object('identity_verification',jsonb_build_object('status','verified_cohort','kind','custodial_leadership_cohort','manager_id',a->>'manager_id','credential_id',a->>'credential_id','device_id',a->>'device_id','claimed_account_id',a->>'claimed_account_id','claimed_name',a->>'claimed_name','identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false)) FROM (SELECT current_setting('solo.cohort_actor')::jsonb a) x;
DO $t$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.system_feedback_email_intents WHERE feedback_id='0b330000-0000-4000-8000-000000000001' AND original_actor->>'status'='verified_cohort' AND recipient='eoperle@memphiszoo.org' AND state='queued') THEN RAISE EXCEPTION 'Truthful approved cohort email intent missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.custodial_place_preview('0a110000-0000-4000-8000-000000000002')) THEN RAISE EXCEPTION 'Original named preview broken';END IF;
 BEGIN PERFORM public.custodial_place_preview('0a110000-0000-4000-8000-000000000001');RAISE EXCEPTION 'Original named guard widened';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,device_id,metadata_json)
 SELECT '0b330000-0000-4000-8000-000000000003','0b330000-0000-4000-8000-000000000004',repeat('a',64),'other','normal','Forged browser','Synthetic','manager','forged',metadata_json FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000001';RAISE EXCEPTION 'Forged feedback metadata accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $t$;
SELECT set_config('solo.feedback_before',(SELECT jsonb_build_object('message',message,'notification_status',notification_status,'notified_ops_count',notified_ops_count,'actor',metadata_json->'identity_verification')::text FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000001'),true);
SELECT set_config('solo.feedback_version',(SELECT public.custodial_feedback_triage_version(status,updated_at) FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000001'),true);
INSERT INTO public.event_venues(id,venue_code,display_name,event_scope,active) VALUES('0b330000-0000-4000-8000-000000000016','SOLO_EVENT_TEST','Unique solo cohort venue','SINGLE_VENUE',true);
SELECT set_config('solo.event_venue','0b330000-0000-4000-8000-000000000016',true);
SET LOCAL ROLE static_weekly_control_plane;
DO $t$ DECLARE r jsonb;v jsonb;cmd jsonb;fb jsonb;first_receipt jsonb;preview uuid;gid uuid;BEGIN
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation','{"action":"preview","input":{}}');
 IF jsonb_typeof(r->'places') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Cohort catalog unavailable';END IF;
 cmd:='{"action":"command","input":{"request_id":"0b330000-0000-4000-8000-000000000011","place_id":"0b330000-0000-4000-8000-000000000012","expected_revision":0,"action":"add","effective_at":null,"payload":{"canonical_code":"SOLO_COHORT_TEST","display_name":"Solo cohort test","cleaning_mode":"NEVER_CLEAN","event_eligible":true,"aliases":["Unique solo cohort alias"]},"reason":"Synthetic regression"}}';
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',cmd);
 IF r->>'revision'<>'1' THEN RAISE EXCEPTION 'Cohort place add failed';END IF;
 v:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',cmd);
 IF v->'replayed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Place replay missing';END IF;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',jsonb_set(cmd,'{input,reason}','"Changed content"'));RAISE EXCEPTION 'Changed-content place replay allowed';EXCEPTION WHEN unique_violation THEN NULL;END;
 cmd:=jsonb_set(jsonb_set(jsonb_set(cmd,'{input,request_id}','"0b330000-0000-4000-8000-000000000013"'),'{input,action}','"rename"'),'{input,payload}','{"display_name":"Renamed synthetic place"}');
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',cmd);RAISE EXCEPTION 'Stale revision accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 cmd:=jsonb_set(cmd,'{input,expected_revision}','1');
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',cmd);IF r->>'revision'<>'2' THEN RAISE EXCEPTION 'Rename failed';END IF;
 -- Existing venue is only private setup metadata; no cutover/tag/schedule mutation.
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',jsonb_build_object('action','bridge_preview','input',jsonb_build_object('legacy_kind','event_venue','legacy_id',current_setting('solo.event_venue'),'action','map','target_place_id','0b330000-0000-4000-8000-000000000012','effective_at',null,'reason','Synthetic bridge')));
 preview:=(r->>'preview_id')::uuid;IF preview IS NULL THEN RAISE EXCEPTION 'Bridge preview missing';END IF;
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',jsonb_build_object('action','bridge_confirm','input',jsonb_build_object('request_id','0b330000-0000-4000-8000-000000000014','preview_id',preview)));
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation','{"action":"source_preview","input":{"legacy_kind":"location_group","legacy_id":null,"action":"add","payload":{"canonical_code":"SOLO_SOURCE_TEST","legacy_code":"SOLO_SOURCE_TEST","display_name":"Synthetic setup group","cleaning_mode":"REMINDER_ONLY","event_eligible":true,"member_location_ids":[]},"effective_at":null,"reason":"Synthetic source setup"}}');
 preview:=(r->>'preview_id')::uuid;IF preview IS NULL THEN RAISE EXCEPTION 'Source preview missing';END IF;
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','place_operation',jsonb_build_object('action','source_confirm','input',jsonb_build_object('request_id','0b330000-0000-4000-8000-000000000015','preview_id',preview)));
 IF r->>'status'<>'COMMITTED' AND r->>'canonical_revision' IS NULL THEN RAISE EXCEPTION 'Source confirmation failed';END IF;
 fb:=jsonb_build_object('request_id','0b330000-0000-4000-8000-000000000021','feedback_id','0b330000-0000-4000-8000-000000000001','status','acknowledged','expected_version',current_setting('solo.feedback_version'),'expected_manager_id','0a110000-0000-4000-8000-000000000001','expected_credential_id','0a110000-0000-4000-8000-000000000003');
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','feedback_triage',fb);first_receipt:=r->'receipt';
 IF r->'replayed' IS DISTINCT FROM 'false'::jsonb OR first_receipt->>'status'<>'acknowledged' THEN RAISE EXCEPTION 'Feedback triage failed';END IF;
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','feedback_triage',fb);IF r->'replayed' IS DISTINCT FROM 'true'::jsonb OR r->'receipt' IS DISTINCT FROM first_receipt THEN RAISE EXCEPTION 'Feedback replay changed original receipt';END IF;
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','feedback_triage_status',fb);IF r->>'outcome'<>'APPLIED' OR r->'receipt' IS DISTINCT FROM first_receipt OR r->'retry_safe' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Exact original cohort receipt unavailable';END IF;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','feedback_triage',jsonb_set(fb,'{status}','"closed"'));RAISE EXCEPTION 'Changed-content feedback replay allowed';EXCEPTION WHEN serialization_failure THEN NULL;END;
 r:=public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','feedback_triage_status',jsonb_set(fb,'{request_id}','"0b330000-0000-4000-8000-000000000099"'));IF r->>'outcome'<>'UNKNOWN' OR r->'retry_safe' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Missing receipt fabricated';END IF;
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','changed-browser','feedback_triage',fb);RAISE EXCEPTION 'Changed browser permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $t$;
RESET ROLE;
DO $t$ BEGIN
 IF (SELECT jsonb_build_object('message',message,'notification_status',notification_status,'notified_ops_count',notified_ops_count,'actor',metadata_json->'identity_verification') FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000001') IS DISTINCT FROM current_setting('solo.feedback_before')::jsonb THEN RAISE EXCEPTION 'Original feedback or delivery data changed';END IF;
 BEGIN UPDATE custodial_leadership_private.feedback_triage_receipts_v1 SET command=command;RAISE EXCEPTION 'Receipt mutation allowed';EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;END;
END $t$;

RESET ROLE;
INSERT INTO public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,expires_at)
VALUES('0b330000-0000-4000-8000-000000000031','SOLO_NAMED_TEST','Synthetic named',repeat('c',64),'full_access','0a110000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 day');
INSERT INTO public.system_feedback_items(id,operation_id,request_fingerprint,category,priority,message,submitted_by,hub_context,metadata_json)
VALUES('0b330000-0000-4000-8000-000000000032','0b330000-0000-4000-8000-000000000033',repeat('c',64),'other','normal','Synthetic named feedback','Synthetic named','manager',jsonb_build_object('identity_verification',jsonb_build_object('status','verified','kind','named_manager_session','manager_id','0a110000-0000-4000-8000-000000000002','credential_id','0b330000-0000-4000-8000-000000000031')));
DO $t$ DECLARE v text;r jsonb;BEGIN
 SELECT public.custodial_feedback_triage_version(status,updated_at) INTO v FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000032';
 BEGIN PERFORM public.custodial_feedback_triage('0b330000-0000-4000-8000-000000000021','0a110000-0000-4000-8000-000000000002','0b330000-0000-4000-8000-000000000031','0b330000-0000-4000-8000-000000000032','acknowledged',v);RAISE EXCEPTION 'Cross-lane duplicate request admitted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 IF (SELECT status FROM public.system_feedback_items WHERE id='0b330000-0000-4000-8000-000000000032')<>'new' THEN RAISE EXCEPTION 'Cross-lane failure changed feedback';END IF;
 r:=public.custodial_feedback_triage('0b330000-0000-4000-8000-000000000034','0a110000-0000-4000-8000-000000000002','0b330000-0000-4000-8000-000000000031','0b330000-0000-4000-8000-000000000032','acknowledged',v);
 IF r->'ok' IS DISTINCT FROM 'true'::jsonb OR r->'replayed' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Original named triage regressed';END IF;
 r:=public.custodial_feedback_triage_receipt('0b330000-0000-4000-8000-000000000034','0a110000-0000-4000-8000-000000000002','0b330000-0000-4000-8000-000000000031','0b330000-0000-4000-8000-000000000032','acknowledged',v);
 IF r->>'outcome'<>'APPLIED' THEN RAISE EXCEPTION 'Original named receipt regressed';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='custodial_leadership_private' AND p.proname IN ('assert_scoped_cohort_actor_v1','place_operation_v1','feedback_operation_v1','valid_feedback_cohort_identity_v1') AND (p.prosecdef OR a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole,'static_weekly_control_plane'::regrole))) THEN RAISE EXCEPTION 'New helper privilege escape';END IF;
 IF NOT(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='custodial_leadership_private.feedback_triage_receipts_v1'::regclass) THEN RAISE EXCEPTION 'Private receipt RLS missing';END IF;
END $t$;
SET LOCAL ROLE anon;
DO $t$ BEGIN BEGIN PERFORM custodial_leadership_private.place_operation_v1('{}','{}');RAISE EXCEPTION 'anon private call permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $t$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $t$ BEGIN BEGIN PERFORM custodial_leadership_private.feedback_operation_v1('{}','feedback_triage','{}');RAISE EXCEPTION 'authenticated private call permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $t$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $t$ BEGIN BEGIN PERFORM custodial_leadership_private.place_operation_v1('{}','{}');RAISE EXCEPTION 'service private call permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $t$;
RESET ROLE;
SET LOCAL ROLE static_weekly_control_plane;
DO $t$ BEGIN BEGIN PERFORM custodial_leadership_private.feedback_operation_v1('{}','feedback_triage','{}');RAISE EXCEPTION 'control private call permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $t$;
RESET ROLE;

RESET ROLE;
UPDATE custodial_leadership_private.registrations SET revoked_at=clock_timestamp() WHERE registration_id='0a110000-0000-4000-8000-000000000003';
SET LOCAL ROLE static_weekly_control_plane;
DO $test$ BEGIN
 BEGIN PERFORM public.custodial_leadership_record_operation_v1('0a110000-0000-4000-8000-000000000001','0a110000-0000-4000-8000-000000000003','0a110000-0000-4000-8000-000000000004','completion_evidence',jsonb_build_object('session_uuid',E'..\t原始/session?#'));RAISE EXCEPTION 'revoked registration accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $test$;
ROLLBACK;
SELECT 'PASS: cohort Places six operations, immutable Feedback intent/triage/receipt, replay/CAS/spoof/unchanged-original/authority tests; named/cohort exact projection, old cohort rejection, unbound context, private helper, changed browser, extra actor, absent session, revoked registration; fixture rolled back';
