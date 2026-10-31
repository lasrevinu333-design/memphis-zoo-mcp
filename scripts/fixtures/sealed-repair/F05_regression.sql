-- ROOT-OWNED DISPOSABLE DATABASE ONLY. All fixture state rolls back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE notification_domain_checks(label text PRIMARY KEY);
DO $fixture$
DECLARE names jsonb;claimed uuid;owner_id uuid;current_generation bigint;reply jsonb;message_queue uuid;message_lease uuid;push_id uuid;token_digest text;
 reg uuid:='f0500000-0000-4000-8000-000000000002';
 cohort uuid:='f0500000-0000-4000-8000-000000000001';
 restore uuid:='f0500000-0000-4000-8000-000000000003';
BEGIN
 INSERT INTO public.ops_manager_managers(display_name,system_key,roles)
 SELECT 'Synthetic notification registry '||n,key,ARRAY['OPS_MANAGER']::text[]
 FROM (VALUES(1,'eric_mckenney_facilities_maintenance_manager'),(2,'haley_lejman_water_quality_manager'),
 (3,'brandy_gull_horticulture_manager'),(4,'jennifer_sheffield_director_operations'),
 (5,'annie_feist_operations_admin'),(6,'eric_custodial_manager')) v(n,key)
 WHERE NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.system_key=v.key);
 names:=custodial_leadership_private.approved_names();
 IF names IS NULL THEN RAISE EXCEPTION 'Six-name registry prerequisite failed';END IF;
 claimed:=(names->0->>'accountId')::uuid;owner_id:=(names->5->>'accountId')::uuid;
 INSERT INTO public.ops_manager_managers(manager_id,display_name,system_key,roles,is_system_principal)
 VALUES(cohort,'Synthetic notification cohort','synthetic_security_notification_cohort',ARRAY['OPS_MANAGER'],true);
 UPDATE custodial_leadership_private.policy SET enabled=true,cohort_principal_id=cohort,policy_version=1,
 permissions=ARRAY['custodial.read','custodial.edit','custodialManagementAdmin'],approved_by=owner_id,
 approved_at=clock_timestamp(),approval_ref=restore WHERE singleton;
 SELECT authority_generation INTO current_generation FROM custodial_dr.restore_control
 WHERE singleton AND NOT mutations_paused AND state IN('READY','COMPLETE');
 IF current_generation IS NULL THEN RAISE EXCEPTION 'Owned fixture requires ready protected control';END IF;
 INSERT INTO custodial_leadership_private.registrations(registration_id,token_hash,browser_hash,
 claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
 VALUES(reg,repeat('1',64),repeat('2',64),claimed,cohort,1,clock_timestamp(),clock_timestamp()+interval '1 hour');
 IF custodial_leadership_private.session_view(reg) IS NULL THEN RAISE EXCEPTION 'Current registration prerequisite failed';END IF;
 IF EXISTS(SELECT 1 FROM public.ops_manager_trusted_devices WHERE credential_id=reg) THEN RAISE EXCEPTION 'Fake trusted-device mirror';END IF;
 INSERT INTO custodial_leadership_private.registrations(registration_id,token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,expires_at)
 VALUES('f0500000-0000-4000-8000-000000000004',repeat('4',64),repeat('5',64),(names->1->>'accountId')::uuid,cohort,1,clock_timestamp()+interval '1 hour'),
 ('f0500000-0000-4000-8000-000000000005',repeat('6',64),repeat('7',64),claimed,cohort,1,clock_timestamp()+interval '1 hour');
 INSERT INTO public.ops_manager_managers(manager_id,display_name,system_key,roles,is_system_principal)
 VALUES('f0500000-0000-4000-8000-000000000006','Synthetic legacy notification manager','synthetic_legacy_notification',ARRAY['OPS_MANAGER'],false);
 INSERT INTO public.ops_manager_trusted_devices(credential_id,manager_id,device_id,device_label,token_hash,max_access_level,expires_at)
 VALUES('f0500000-0000-4000-8000-000000000007','f0500000-0000-4000-8000-000000000006','synthetic-legacy-browser','Synthetic',repeat('8',64),'full_access',clock_timestamp()+interval '1 hour');
 INSERT INTO public.ops_manager_notification_preferences(credential_id,manager_id)
 SELECT registration_id,cohort_principal_id FROM custodial_leadership_private.registrations WHERE cohort_principal_id=cohort;
 INSERT INTO public.ops_manager_notification_preferences(credential_id,manager_id)
 VALUES('f0500000-0000-4000-8000-000000000007','f0500000-0000-4000-8000-000000000006');
 INSERT INTO public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
 SELECT registration_id,cohort_principal_id,browser_id::text,'android','SYNTHETIC-NO-PROVIDER-'||registration_id::text
 FROM custodial_leadership_private.registrations WHERE cohort_principal_id=cohort;
 INSERT INTO public.ops_manager_push_devices(credential_id,manager_id,device_id,platform,fcm_token)
 VALUES('f0500000-0000-4000-8000-000000000007','f0500000-0000-4000-8000-000000000006','synthetic-legacy-browser','android','SYNTHETIC-NO-PROVIDER-LEGACY');
 IF (SELECT count(*) FROM public.ops_manager_notification_credentials WHERE leadership_registration_id IN(reg,'f0500000-0000-4000-8000-000000000004','f0500000-0000-4000-8000-000000000005'))<>3
 OR NOT EXISTS(SELECT 1 FROM public.ops_manager_notification_credentials WHERE trusted_credential_id='f0500000-0000-4000-8000-000000000007' AND credential_kind='NAMED_TRUSTED_DEVICE')
 THEN RAISE EXCEPTION 'Credential domains not genuinely bound';END IF;
 INSERT INTO notification_domain_checks VALUES('cohort and named preferences/push use distinct genuine FK domains');
 INSERT INTO public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
 VALUES('SYNTHETIC-NO-PROVIDER-DOMAIN',reg,cohort,'test','Synthetic','Synthetic');
 INSERT INTO public.ops_manager_notification_state(credential_id,state_key,fingerprint) VALUES(reg,'SYNTHETIC','SYNTHETIC');
 INSERT INTO notification_domain_checks VALUES('queue and state preserve genuine private registration identity');
 EXECUTE 'SET LOCAL ROLE service_role';
 UPDATE public.ops_manager_notification_preferences SET messages_enabled=true WHERE credential_id=reg;
 INSERT INTO public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,title,body)
 VALUES('SYNTHETIC-SERVICE-ROLE-NO-PROVIDER',reg,cohort,'test','Synthetic','Synthetic');
 IF NOT public.custodial_ops_manager_notification_recipient_is_current(reg,cohort)
 THEN RAISE EXCEPTION 'Existing backend service role lost intended notification capability';END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO notification_domain_checks VALUES('actual service role can persist current preference and queue through restricted owner triggers');
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM credential_id FROM public.ops_manager_notification_credentials LIMIT 1;
  RAISE EXCEPTION 'Service role directly read typed private authority';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM custodial_leadership_private.notification_credential(reg);
  RAISE EXCEPTION 'Service role directly invoked private credential resolver';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 INSERT INTO notification_domain_checks VALUES('actual service role denied direct registry read and private resolver execution');

 BEGIN
  UPDATE public.ops_manager_notification_preferences SET manager_id='f0500000-0000-4000-8000-000000000006' WHERE credential_id=reg;
  RAISE EXCEPTION 'Wrong manager accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  UPDATE public.ops_manager_push_devices SET device_id='wrong-browser' WHERE credential_id=reg;
  RAISE EXCEPTION 'Wrong browser accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO notification_domain_checks VALUES('cross-manager and mismatched cohort browser writes denied');
 IF NOT public.custodial_ops_manager_notification_recipient_is_current(reg,cohort)
 OR NOT public.custodial_ops_manager_notification_recipient_is_current('f0500000-0000-4000-8000-000000000007','f0500000-0000-4000-8000-000000000006')
 THEN RAISE EXCEPTION 'Current typed recipient rejected';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd WHERE credential_id=reg
 AND public.custodial_ops_manager_notification_binding_is_current(pd.push_device_id,reg,cohort,
 encode(extensions.digest(convert_to(pd.fcm_token,'UTF8'),'sha256'),'hex')))
 OR EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd WHERE credential_id=reg
 AND public.custodial_ops_manager_notification_binding_is_current(pd.push_device_id,reg,cohort,repeat('0',64)))
 THEN RAISE EXCEPTION 'Dispatch token digest fence failed';END IF;
 INSERT INTO notification_domain_checks VALUES('current recipient and exact FCM digest pass; wrong digest denied');
 INSERT INTO public.msg_users(id,display_name,role,is_active) VALUES('f0500000-0000-4000-8000-000000000011','Synthetic sender','manager',true);
 INSERT INTO public.msg_users(id,display_name,role,is_active,custodial_cohort_manager_id,custodial_claimed_account_id)
 VALUES('f0500000-0000-4000-8000-000000000012','Synthetic selected name A','manager',true,cohort,claimed),
 ('f0500000-0000-4000-8000-000000000013','Synthetic selected name B','manager',true,cohort,(names->1->>'accountId')::uuid);
 INSERT INTO public.msg_threads(id,thread_type,title,created_by_user_id)
 VALUES('f0500000-0000-4000-8000-000000000021','direct','Synthetic name A','f0500000-0000-4000-8000-000000000011'),
 ('f0500000-0000-4000-8000-000000000022','direct','Synthetic name B','f0500000-0000-4000-8000-000000000011');
 INSERT INTO public.msg_thread_participants(thread_id,user_id) VALUES
 ('f0500000-0000-4000-8000-000000000021','f0500000-0000-4000-8000-000000000011'),
 ('f0500000-0000-4000-8000-000000000021','f0500000-0000-4000-8000-000000000012'),
 ('f0500000-0000-4000-8000-000000000022','f0500000-0000-4000-8000-000000000011'),
 ('f0500000-0000-4000-8000-000000000022','f0500000-0000-4000-8000-000000000013');
 INSERT INTO public.msg_messages(id,thread_id,sender_user_id,body) VALUES
 ('f0500000-0000-4000-8000-000000000031','f0500000-0000-4000-8000-000000000021','f0500000-0000-4000-8000-000000000011','Synthetic A message'),
 ('f0500000-0000-4000-8000-000000000032','f0500000-0000-4000-8000-000000000022','f0500000-0000-4000-8000-000000000011','Synthetic B message');
 IF (SELECT array_agg(credential_id ORDER BY credential_id) FROM public.ops_manager_notification_queue
 WHERE source_id='f0500000-0000-4000-8000-000000000031') IS DISTINCT FROM ARRAY[reg,'f0500000-0000-4000-8000-000000000005'::uuid]
 OR (SELECT array_agg(credential_id) FROM public.ops_manager_notification_queue
 WHERE source_id='f0500000-0000-4000-8000-000000000032') IS DISTINCT FROM ARRAY['f0500000-0000-4000-8000-000000000004'::uuid]
 THEN RAISE EXCEPTION 'Per selected-name push audience leaked or missed a current browser';END IF;
 INSERT INTO notification_domain_checks VALUES('selected-name A and B inboxes target only corresponding registered browsers');
 SELECT queue_id INTO message_queue FROM public.ops_manager_notification_queue WHERE source_id='f0500000-0000-4000-8000-000000000031' AND credential_id=reg;
 message_lease:=gen_random_uuid();
 UPDATE public.ops_manager_notification_queue SET status='leased',lease_token=message_lease,leased_until=clock_timestamp()+interval '1 minute',worker_id='synthetic-no-provider' WHERE queue_id=message_queue;
 SELECT push_device_id,encode(extensions.digest(convert_to(fcm_token,'UTF8'),'sha256'),'hex') INTO push_id,token_digest FROM public.ops_manager_push_devices WHERE credential_id=reg;
 IF NOT public.ops_manager_notification_job_is_current(message_queue,message_lease,push_id,token_digest)
 THEN RAISE EXCEPTION 'Current selected-name message pre-dispatch rejected';END IF;
 UPDATE custodial_leadership_private.registrations SET claimed_account_id=(names->1->>'accountId')::uuid WHERE registration_id=reg;
 IF public.ops_manager_notification_job_is_current(message_queue,message_lease,push_id,token_digest)
 OR public.ops_manager_prepare_notification_dispatch(message_queue,message_lease,push_id,token_digest)
 THEN RAISE EXCEPTION 'Changed selected name inherited queued private content';END IF;
 UPDATE custodial_leadership_private.registrations SET claimed_account_id=claimed WHERE registration_id=reg;
 UPDATE public.msg_thread_participants SET left_at=clock_timestamp() WHERE thread_id='f0500000-0000-4000-8000-000000000021' AND user_id='f0500000-0000-4000-8000-000000000012';
 IF public.ops_manager_prepare_notification_dispatch(message_queue,message_lease,push_id,token_digest)
 THEN RAISE EXCEPTION 'Removed participant inherited queued private content';END IF;
 UPDATE public.msg_thread_participants SET left_at=NULL WHERE thread_id='f0500000-0000-4000-8000-000000000021' AND user_id='f0500000-0000-4000-8000-000000000012';
 IF NOT public.ops_manager_prepare_notification_dispatch(message_queue,message_lease,push_id,token_digest)
 THEN RAISE EXCEPTION 'Restored current original audience could not prepare exact dispatch';END IF;
 INSERT INTO notification_domain_checks VALUES('actual pre-dispatch rechecks selected name and participant; no stale audience inherits queued content');

 UPDATE public.ops_manager_notification_preferences SET messages_enabled=false WHERE credential_id=reg;
 INSERT INTO public.msg_messages(id,thread_id,sender_user_id,body) VALUES
 ('f0500000-0000-4000-8000-000000000033','f0500000-0000-4000-8000-000000000021','f0500000-0000-4000-8000-000000000011','Synthetic preferences');
 IF (SELECT array_agg(credential_id) FROM public.ops_manager_notification_queue
 WHERE source_id='f0500000-0000-4000-8000-000000000033') IS DISTINCT FROM ARRAY['f0500000-0000-4000-8000-000000000005'::uuid]
 THEN RAISE EXCEPTION 'Per-browser preference ignored';END IF;
 INSERT INTO notification_domain_checks VALUES('per-browser message preference preserved');
 UPDATE custodial_leadership_private.registrations SET revoked_at=clock_timestamp() WHERE registration_id=reg;
 IF public.custodial_ops_manager_notification_recipient_is_current(reg,cohort) THEN RAISE EXCEPTION 'Revoked recipient accepted';END IF;
 -- Cleanup revocation is intentionally still possible after authority expires.
 UPDATE public.ops_manager_push_devices SET enabled=false,revoked_at=clock_timestamp() WHERE credential_id=reg;
 INSERT INTO notification_domain_checks VALUES('revocation denies dispatch while cleanup can still disable stale push');
 UPDATE custodial_leadership_private.policy SET enabled=false WHERE singleton;
 IF public.custodial_ops_manager_notification_recipient_is_current('f0500000-0000-4000-8000-000000000004',cohort)
 THEN RAISE EXCEPTION 'Disabled policy recipient accepted';END IF;
 UPDATE custodial_leadership_private.policy SET enabled=true WHERE singleton;
 UPDATE custodial_dr.restore_control SET authority_generation=current_generation+1,mutations_paused=true,state='VERIFYING',restore_id=restore WHERE singleton;
 IF public.custodial_ops_manager_notification_recipient_is_current('f0500000-0000-4000-8000-000000000004',cohort)
 THEN RAISE EXCEPTION 'Restored old-generation recipient accepted';END IF;
 INSERT INTO notification_domain_checks VALUES('policy disable and protected generation advance deny already queued cohort dispatch');
 IF has_table_privilege('service_role','public.ops_manager_notification_credentials','INSERT')
 OR has_function_privilege('service_role','custodial_leadership_private.notification_credential(uuid,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','public.ops_manager_notification_bind_credential()','EXECUTE')
 THEN RAISE EXCEPTION 'Typed notification authority is publicly writable';END IF;
 INSERT INTO notification_domain_checks VALUES('private resolver and typed registry grant boundary preserved');
END $fixture$;
SELECT jsonb_build_object('suite','notification-credential-domain-v3','passed',count(*),'checks',jsonb_agg(label ORDER BY label)) FROM notification_domain_checks;
ROLLBACK;
