BEGIN;
INSERT INTO public.custodial_backend_execution_config(config_key,execution_secret_digest,enabled,configured_by)
 VALUES(true,encode(extensions.digest('solo-audit-synthetic-backend-secret-0001','sha256'),'hex'),true,'solo repair fixture')
 ON CONFLICT(config_key) DO UPDATE SET execution_secret_digest=excluded.execution_secret_digest,enabled=true;
INSERT INTO public.ops_manager_managers(manager_id,display_name,roles,active,is_system_principal,system_key)
 VALUES('0a120000-0000-4000-8000-000000000001','Synthetic cohort',array['OPS_MANAGER'],true,true,'timeout_synthetic_cohort'),
 ('0a120000-0000-4000-8000-000000000002','Synthetic individual',array['OPS_MANAGER'],true,false,'timeout_synthetic_individual');
UPDATE custodial_leadership_private.policy SET enabled=true,cohort_principal_id='0a120000-0000-4000-8000-000000000001',permissions=ARRAY['custodialManagementAdmin'],approved_by='0a120000-0000-4000-8000-000000000002',approved_at=clock_timestamp(),approval_ref='0a120000-0000-4000-8000-000000000008' WHERE singleton;
-- Populate only this rollback-only fixture's required six approved-name rows.
WITH required(key) AS(VALUES ('eric_mckenney_facilities_maintenance_manager'),('haley_lejman_water_quality_manager'),('brandy_gull_horticulture_manager'),('jennifer_sheffield_director_operations'),('annie_feist_operations_admin'),('eric_custodial_manager'))
INSERT INTO public.ops_manager_managers(display_name,system_key,active,is_system_principal)
SELECT 'Synthetic approved-name fixture',key,true,false FROM required r WHERE NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.system_key=r.key);
UPDATE public.ops_manager_managers SET active=true,revoked_at=null WHERE system_key IN('eric_mckenney_facilities_maintenance_manager','haley_lejman_water_quality_manager','brandy_gull_horticulture_manager','jennifer_sheffield_director_operations','annie_feist_operations_admin','eric_custodial_manager');
INSERT INTO custodial_leadership_private.registrations(registration_id,browser_id,token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
 SELECT '0a120000-0000-4000-8000-000000000003','0a120000-0000-4000-8000-000000000004',repeat('a',64),repeat('b',64),
 (SELECT manager_id FROM public.ops_manager_managers WHERE system_key='eric_custodial_manager'),'0a120000-0000-4000-8000-000000000001',policy_version,'infinity'::timestamptz
 FROM custodial_leadership_private.policy WHERE singleton;
INSERT INTO public.devices(id,device_id,device_name,assignment_epoch)
 VALUES('0a120000-0000-4000-8000-000000000005','TIMEOUT_SYNTHETIC','Synthetic audit device',1);
INSERT INTO public.employees(id,display_name,role,active) VALUES('0a120000-0000-4000-8000-000000000009','Synthetic test custodian','staff',true);
INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES('0a120000-0000-4000-8000-000000000010','SOLO_TEST','Synthetic test restroom','restroom');

SELECT set_config('custodial.backend_execution_secret','solo-audit-synthetic-backend-secret-0001',true);
INSERT INTO public.devices(id,device_id,device_name,assignment_epoch) VALUES('0a120000-0000-4000-8000-000000000017','TIMEOUT_FUTURE','Future timeout device',1);
INSERT INTO public.employees(id,display_name,role,active) VALUES('0a120000-0000-4000-8000-000000000019','Future timeout employee','staff',true);
INSERT INTO public.locations(id,location_code,location_name,location_type) VALUES('0a120000-0000-4000-8000-000000000020','SOLO_FUTURE','Future timeout restroom','restroom');
INSERT INTO public.sessions(id,session_uuid,location_id,employee_id,device_id,started_at)
 VALUES('0a120000-0000-4000-8000-000000000011','timeout-original-legacy','0a120000-0000-4000-8000-000000000010','0a120000-0000-4000-8000-000000000009','0a120000-0000-4000-8000-000000000005',now()-make_interval(mins=>public.get_setting_int('stale_session_timeout_minutes',120))-interval '1 second'),
 ('0a120000-0000-4000-8000-000000000012','timeout-not-yet-due','0a120000-0000-4000-8000-000000000020','0a120000-0000-4000-8000-000000000019','0a120000-0000-4000-8000-000000000017',now());
INSERT INTO public.device_auth_credentials(credential_id,device_id,token_hash,device_label,confirmed_at,expires_at)
 VALUES('0a120000-0000-4000-8000-000000000013','0a120000-0000-4000-8000-000000000005',repeat('f',64),'Timeout synthetic',now(),now()+interval '1 day');
INSERT INTO public.custodial_offline_actor_contexts(context_id,client_session_id,device_id,employee_id,credential_id,assignment_epoch,location_id,canonical_location_code,started_at,occurrence_fingerprint,expires_at)
 VALUES('0a120000-0000-4000-8000-000000000014','timeout-original-native','0a120000-0000-4000-8000-000000000005','0a120000-0000-4000-8000-000000000009','0a120000-0000-4000-8000-000000000013',1,'0a120000-0000-4000-8000-000000000010','SOLO_TEST',now()-interval '7 days',repeat('e',64),now()-interval '1 second');
INSERT INTO public.custodial_offline_submission_proofs(context_id,proof_digest,issued_submission_proof)
 VALUES('0a120000-0000-4000-8000-000000000014',repeat('d',64),repeat('c',64));
SELECT set_config('fixture.work_before',(SELECT to_jsonb(s)::text FROM public.sessions s WHERE id='0a120000-0000-4000-8000-000000000011'),true);
SELECT set_config('fixture.native_before',(SELECT to_jsonb(c)::text FROM public.custodial_offline_actor_contexts c WHERE context_id='0a120000-0000-4000-8000-000000000014'),true);
SELECT public.expire_stale_open_sessions(now());
DO $t$ DECLARE n integer;BEGIN
 IF (SELECT to_jsonb(s)::text FROM public.sessions s WHERE id='0a120000-0000-4000-8000-000000000011') IS DISTINCT FROM current_setting('fixture.work_before') THEN RAISE EXCEPTION 'timeout changed original work';END IF;
 IF (SELECT to_jsonb(c)::text FROM public.custodial_offline_actor_contexts c WHERE context_id='0a120000-0000-4000-8000-000000000014') IS DISTINCT FROM current_setting('fixture.native_before') THEN RAISE EXCEPTION 'timeout changed native work';END IF;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE client_session_id='timeout-original-native') OR EXISTS(SELECT 1 FROM public.completion_responses WHERE session_id='0a120000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'timeout fabricated terminal/completion';END IF;
 SELECT count(*) INTO n FROM custodial_leadership_private.unfinished_notices_v1 WHERE source_id IN('0a120000-0000-4000-8000-000000000011','0a120000-0000-4000-8000-000000000014');IF n<>2 THEN RAISE EXCEPTION 'two original deadlines not indicated';END IF;
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.unfinished_notices_v1 WHERE source_id='0a120000-0000-4000-8000-000000000012') THEN RAISE EXCEPTION 'early timeout';END IF;
END $t$;
SELECT public.expire_stale_open_sessions(now());
DO $t$ DECLARE actor uuid;other uuid;r jsonb;notice uuid;op uuid:='0a120000-0000-4000-8000-000000000015';BEGIN
 SELECT manager_id INTO actor FROM public.ops_manager_managers WHERE system_key='eric_custodial_manager';
 SELECT manager_id INTO other FROM public.ops_manager_managers WHERE system_key='annie_feist_operations_admin';
 SELECT notice_id INTO notice FROM custodial_leadership_private.unfinished_notices_v1 WHERE source_id='0a120000-0000-4000-8000-000000000011';
 IF (SELECT count(*) FROM public.custodial_offline_reconciliation_outbox WHERE unfinished_notice_id=notice)<>1 THEN RAISE EXCEPTION 'duplicate timeout notice';END IF;
 BEGIN PERFORM public.custodial_named_record_operation_v1(other,'solo-audit-synthetic-backend-secret-0001','unfinished_work','{"limit":100}');RAISE EXCEPTION 'other manager accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','unfinished_work','{"limit":100}');IF jsonb_array_length(r->'items')<>2 THEN RAISE EXCEPTION 'attention list failed';END IF;
 r:=public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','unfinished_work_outcome',jsonb_build_object('notice_id',notice,'operation_id',op));IF r->'found'<>'false' THEN RAISE EXCEPTION 'absent receipt invented';END IF;
 r:=public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','clear_unfinished_work',jsonb_build_object('notice_id',notice,'operation_id',op,'reason','Eric reviewed abandoned original work'));
 IF r->>'status'<>'cancelled_without_completion' OR r->'history_preserved'<>'true' OR r->'phone_released'<>'false' OR r->'key_removal'<>'false' THEN RAISE EXCEPTION 'explicit clear outcome failed';END IF;
 r:=public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','clear_unfinished_work',jsonb_build_object('notice_id',notice,'operation_id',op,'reason','Eric reviewed abandoned original work'));IF r->'replayed'<>'true' THEN RAISE EXCEPTION 'same clear did not replay';END IF;
 r:=public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','unfinished_work_outcome',jsonb_build_object('notice_id',notice,'operation_id',op));IF r->'found'<>'true' THEN RAISE EXCEPTION 'original clear readback failed';END IF;
 BEGIN PERFORM public.custodial_named_record_operation_v1(actor,'solo-audit-synthetic-backend-secret-0001','clear_unfinished_work',jsonb_build_object('notice_id',notice,'operation_id',op,'reason','changed reason'));RAISE EXCEPTION 'changed reason reused original operation';EXCEPTION WHEN unique_violation THEN NULL;END;
 IF (SELECT status FROM public.sessions WHERE id='0a120000-0000-4000-8000-000000000011')<>'cancelled' OR EXISTS(SELECT 1 FROM public.completion_responses WHERE session_id='0a120000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'clear fabricated completion';END IF;
 IF (SELECT count(*) FROM public.session_events WHERE session_id='0a120000-0000-4000-8000-000000000011' AND event_type='unfinished_work_explicitly_reconciled')<>1 THEN RAISE EXCEPTION 'clear history duplicate/missing';END IF;
 BEGIN UPDATE custodial_leadership_private.unfinished_notices_v1 SET snapshot='{}' WHERE notice_id=notice;RAISE EXCEPTION 'notice rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN DELETE FROM custodial_leadership_private.unfinished_clears_v1 WHERE operation_id=op;RAISE EXCEPTION 'receipt deleted';EXCEPTION WHEN check_violation THEN NULL;END;
END $t$;
-- Reuse the real leased delivery state machine; no provider/network send.
DO $t$ DECLARE actor uuid;other uuid;u uuid;wrong_u uuid;o record;bot uuid;thread public.msg_threads%rowtype;message public.msg_messages%rowtype;replay public.msg_messages%rowtype;receipt record;BEGIN
 SELECT manager_id INTO actor FROM public.ops_manager_managers WHERE system_key='eric_custodial_manager';
 SELECT manager_id INTO other FROM public.ops_manager_managers WHERE system_key='annie_feist_operations_admin';
 SELECT user_id INTO u FROM public.custodial_unfinished_work_recipient_v1('solo-audit-synthetic-backend-secret-0001');
 wrong_u:=(custodial_leadership_private.ensure_messaging_account('0a120000-0000-4000-8000-000000000001',other,'Other selected name')).id;
 IF NOT EXISTS(SELECT 1 FROM public.msg_users WHERE id=u AND custodial_cohort_manager_id='0a120000-0000-4000-8000-000000000001' AND custodial_claimed_account_id=actor AND ops_manager_id IS NULL) THEN RAISE EXCEPTION 'timeout selected-name inbox mismatch';END IF;
 SELECT * INTO o FROM public.custodial_claim_offline_reconciliation_notifications('timeout-regression',10,120,'solo-audit-synthetic-backend-secret-0001') WHERE notification_kind='unfinished_work_timeout' LIMIT 1;
 IF o.outbox_id IS NULL THEN RAISE EXCEPTION 'timeout delivery not claimable';END IF;
 BEGIN PERFORM public.custodial_claim_offline_reconciliation_notification_recipients(o.outbox_id,'timeout-regression',o.lease_token,jsonb_build_array(jsonb_build_object('manager_id',other,'user_id',wrong_u)),'solo-audit-synthetic-backend-secret-0001');RAISE EXCEPTION 'other inbox accepted timeout notice';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.custodial_claim_offline_reconciliation_notification_recipients(o.outbox_id,'timeout-regression',o.lease_token,jsonb_build_array(jsonb_build_object('manager_id',actor,'user_id',u)),'solo-audit-synthetic-backend-secret-0001');
 IF NOT EXISTS(SELECT 1 FROM public.custodial_offline_reconciliation_delivery_recipients WHERE outbox_id=o.outbox_id AND manager_id=actor) THEN RAISE EXCEPTION 'Eric original recipient not durably leased';END IF;
 SELECT * INTO receipt FROM public.custodial_offline_reconciliation_delivery_recipients WHERE outbox_id=o.outbox_id AND manager_id=actor;
 INSERT INTO public.msg_users(display_name,role,is_active) VALUES('Memphis','bot',true) RETURNING id INTO bot;
 thread:=public.msg_get_or_create_direct_thread(bot,u);
 message:=public.msg_send_message(thread.id,bot,'Unfinished work needs your attention. Review and explicitly clear it. ./unfinished-work.html','bot_response',jsonb_build_object('client_message_id',receipt.client_message_id,'notification_instance_key',receipt.notification_instance_key));
 replay:=public.msg_send_message(thread.id,bot,'Unfinished work needs your attention. Review and explicitly clear it. ./unfinished-work.html','bot_response',jsonb_build_object('client_message_id',receipt.client_message_id,'notification_instance_key',receipt.notification_instance_key));
 IF message.id IS NULL OR replay.id IS DISTINCT FROM message.id THEN RAISE EXCEPTION 'timeout message original replay duplicated';END IF;
 PERFORM public.custodial_finish_offline_reconciliation_notification_recipient(receipt.delivery_recipient_id,'timeout-regression',receipt.lease_token,true,message.id,NULL,15,false,'{}','solo-audit-synthetic-backend-secret-0001');
 IF NOT EXISTS(SELECT 1 FROM public.custodial_offline_reconciliation_delivery_recipients WHERE delivery_recipient_id=receipt.delivery_recipient_id AND state='delivered' AND message_id=message.id) THEN RAISE EXCEPTION 'timeout original delivery readback failed';END IF;

END $t$;
-- Actual verified registration selects Eric, while owner/individual verification stay false.
SET LOCAL ROLE static_weekly_control_plane;
SELECT public.static_weekly_leadership_bind_verified_request('0a120000-0000-4000-8000-000000000003','0a120000-0000-4000-8000-000000000004','0a120000-0000-4000-8000-000000000001','0a120000-0000-4000-8000-000000000018');
DO $t$ DECLARE r jsonb;notice uuid;BEGIN
 r:=public.custodial_leadership_record_operation_v1('0a120000-0000-4000-8000-000000000001','0a120000-0000-4000-8000-000000000003','0a120000-0000-4000-8000-000000000004','unfinished_work','{"limit":100}');
 notice:=(r->'items'->0->>'notice_id')::uuid;
 r:=public.custodial_leadership_record_operation_v1('0a120000-0000-4000-8000-000000000001','0a120000-0000-4000-8000-000000000003','0a120000-0000-4000-8000-000000000004','clear_unfinished_work',jsonb_build_object('notice_id',notice,'operation_id','0a120000-0000-4000-8000-000000000016','reason','Explicitly reconcile original timed-out native work'));
 IF r->>'status'<>'cancelled_without_completion' THEN RAISE EXCEPTION 'native original clear failed';END IF;
 BEGIN PERFORM custodial_leadership_private.unfinished_work_operation_v1('{}','unfinished_work','{"limit":100}');RAISE EXCEPTION 'direct control-plane helper access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $t$;
RESET ROLE;
DO $t$ BEGIN
 IF (SELECT status FROM public.custodial_offline_actor_contexts WHERE context_id='0a120000-0000-4000-8000-000000000014')<>'cancelled' OR (SELECT state FROM public.custodial_offline_submission_proofs WHERE context_id='0a120000-0000-4000-8000-000000000014')<>'quarantined' THEN RAISE EXCEPTION 'explicit native terminalization failed';END IF;
 IF (SELECT session_uuid FROM public.sessions WHERE client_session_id='timeout-original-native')<>'timeout-original-native' THEN RAISE EXCEPTION 'original native identity lost';END IF;
 IF (SELECT issued_submission_proof FROM public.custodial_offline_submission_proofs WHERE context_id='0a120000-0000-4000-8000-000000000014')<>repeat('c',64) THEN RAISE EXCEPTION 'original proof lost';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.device_auth_credentials WHERE credential_id='0a120000-0000-4000-8000-000000000013' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'clear released credential';END IF;
 IF EXISTS(SELECT 1 FROM public.completion_responses cr JOIN public.sessions s ON s.id=cr.session_id WHERE s.client_session_id='timeout-original-native') THEN RAISE EXCEPTION 'native clear fabricated cleaning';END IF;
END $t$;
SET LOCAL ROLE service_role;
DO $t$ BEGIN
 BEGIN PERFORM public.expire_stale_open_sessions();RAISE EXCEPTION 'service direct expiry allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM custodial_leadership_private.unfinished_notices_v1;RAISE EXCEPTION 'service private work evidence access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $t$;
RESET ROLE;
ROLLBACK;
