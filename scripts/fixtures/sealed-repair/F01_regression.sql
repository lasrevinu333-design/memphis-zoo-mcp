-- ROOT-OWNED DISPOSABLE DATABASE ONLY, after F01 successor and the existing
-- c720 signed-setup fixture. Each subtransaction models one fresh CP request;
-- its deliberate rollback removes request_contexts and effects together.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $fixture$
DECLARE names jsonb;chosen uuid;
BEGIN
 names:=custodial_leadership_private.approved_names();chosen:=(names->1->>'accountId')::uuid;
 INSERT INTO custodial_leadership_private.registrations(registration_id,browser_id,token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
 VALUES('c1010000-0000-4000-8000-000000000002','c1010000-0000-4000-8000-000000000003',repeat('1',64),repeat('2',64),chosen,'c7200000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
 -- Seed only test mailbox rows through the exact helper; no trusted-device mirror.
 -- This lets independent rollback request blocks test stable cross-browser IDs.
 PERFORM custodial_leadership_private.ensure_messaging_account('c7200000-0000-4000-8000-000000000001',(n->>'accountId')::uuid,n->>'displayName') FROM jsonb_array_elements(names) n;
END $fixture$;
CREATE TEMP TABLE f01_evidence(label text primary key,value jsonb) ON COMMIT DROP;
DO $test$
DECLARE cohort uuid:='c7200000-0000-4000-8000-000000000001';reg_a uuid:='c7200000-0000-4000-8000-000000000002';browser_a uuid:='c7200000-0000-4000-8000-000000000003';
 reg_a2 uuid:='c7200000-0000-4000-8000-000000000004';browser_a2 uuid:='c7200000-0000-4000-8000-000000000005';
 reg_b uuid:='c1010000-0000-4000-8000-000000000002';browser_b uuid:='c1010000-0000-4000-8000-000000000003';
 a jsonb;b jsonb;again jsonb;names jsonb;u_a uuid;u_b uuid;legacy public.msg_users%rowtype;t public.msg_threads%rowtype;m jsonb;replay jsonb;payload jsonb;actor jsonb;n integer;checks integer:=0;
BEGIN
 names:=custodial_leadership_private.approved_names();
 IF (SELECT count(*) FROM public.msg_users WHERE custodial_cohort_manager_id=cohort)<>jsonb_array_length(names)
 OR EXISTS(SELECT 1 FROM public.msg_users u WHERE u.custodial_cohort_manager_id=cohort AND (
  u.messaging_identity_key IS DISTINCT FROM 'custodial_pin_'||replace(cohort::text,'-','')||'_'||replace(u.custodial_claimed_account_id::text,'-','')
  OR u.messaging_identity_key!~'^[a-z][a-z0-9_]{2,79}$' OR length(u.messaging_identity_key)<>79
  OR u.role<>'manager' OR NOT u.is_active OR u.ops_manager_id IS NOT NULL OR u.employee_id IS NOT NULL
 )) THEN RAISE EXCEPTION 'F01 persisted identity key / role / selected-account cardinality failed';END IF;checks:=checks+1;
 legacy:=public.msg_ensure_ops_manager_user((names->0->>'accountId')::uuid);
 IF has_function_privilege('service_role','public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb)','EXECUTE')
 OR NOT has_function_privilege('static_weekly_control_plane','public.custodial_leadership_messaging_operation_v1(uuid,uuid,text,text,jsonb)','EXECUTE')
 OR has_table_privilege('service_role','custodial_leadership_private.messaging_message_bindings','SELECT')
 OR NOT(select relrowsecurity from pg_class where oid='custodial_leadership_private.messaging_message_bindings'::regclass)
 THEN RAISE EXCEPTION 'F01 ACL/RLS contract failed';END IF;checks:=checks+1;
 BEGIN
  SET LOCAL ROLE static_weekly_control_plane;
  PERFORM public.static_weekly_leadership_bind_verified_request(reg_a,browser_a,cohort,gen_random_uuid());
  a:=public.custodial_leadership_messaging_operation_v1(cohort,reg_a,browser_a::text,'identity','{}');
  RAISE EXCEPTION USING ERRCODE='P0101',MESSAGE='rollback original A context';
 EXCEPTION WHEN SQLSTATE 'P0101' THEN NULL;END;
 BEGIN
  SET LOCAL ROLE static_weekly_control_plane;
  PERFORM public.static_weekly_leadership_bind_verified_request(reg_a2,browser_a2,cohort,gen_random_uuid());
  again:=public.custodial_leadership_messaging_operation_v1(cohort,reg_a2,browser_a2::text,'identity','{}');
  RAISE EXCEPTION USING ERRCODE='P0101',MESSAGE='rollback same selected name other browser';
 EXCEPTION WHEN SQLSTATE 'P0101' THEN NULL;END;
 BEGIN
  SET LOCAL ROLE static_weekly_control_plane;
  PERFORM public.static_weekly_leadership_bind_verified_request(reg_b,browser_b,cohort,gen_random_uuid());
  b:=public.custodial_leadership_messaging_operation_v1(cohort,reg_b,browser_b::text,'identity','{}');
  RAISE EXCEPTION USING ERRCODE='P0101',MESSAGE='rollback selected B context';
 EXCEPTION WHEN SQLSTATE 'P0101' THEN NULL;END;
 u_a:=(a->>'msg_user_id')::uuid;u_b:=(b->>'msg_user_id')::uuid;
 IF u_a IS NULL OR u_b IS NULL OR u_a=u_b OR a->>'msg_user_id' IS DISTINCT FROM again->>'msg_user_id'
 OR u_a=legacy.id OR a->>'ops_manager_id' IS NOT NULL OR a->>'identity_assurance'<>'SELF_ASSERTED_NAME'
 OR a->'individual_identity_verified'<>'false'::jsonb THEN RAISE EXCEPTION 'F01 selected name / legacy separation failed';END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.ops_manager_trusted_devices WHERE credential_id IN(reg_a,reg_a2,reg_b)) THEN RAISE EXCEPTION 'F01 fake named credential mirror';END IF;checks:=checks+1;
 -- Make an own thread and a foreign selected-name thread using real pair writer.
 t:=public.msg_get_or_create_direct_thread(u_a,legacy.id);
 payload:=jsonb_build_object('thread_id',t.id,'body','Synthetic cohort original','message_type','text',
  'metadata_json',jsonb_build_object('authenticated_ops_manager_id',legacy.ops_manager_id,'device_id','forged-browser',
   'custodial_cohort_actor',jsonb_build_object('owner',true,'individual_identity_verified',true),
   'safe_context',jsonb_build_object('preserve',true)),
  'client_message_id','f01-stable-original');
 BEGIN
  SET LOCAL ROLE static_weekly_control_plane;
  PERFORM public.static_weekly_leadership_bind_verified_request(reg_a,browser_a,cohort,gen_random_uuid());
  m:=public.custodial_leadership_messaging_operation_v1(cohort,reg_a,browser_a::text,'send',payload);
  replay:=public.custodial_leadership_messaging_operation_v1(cohort,reg_a,browser_a::text,'send',payload);
  IF m->>'id' IS DISTINCT FROM replay->>'id' OR m->>'sender_user_id'<>u_a::text THEN RAISE EXCEPTION 'F01 send/replay failed';END IF;
  IF (m->'metadata_json') ? 'authenticated_ops_manager_id'::text
   OR m#>>'{metadata_json,device_id}' IS DISTINCT FROM browser_a::text
   OR m#>'{metadata_json,custodial_cohort_actor}' IS DISTINCT FROM jsonb_build_object(
    'schema','custodial.cohort-message-actor.v1','cohort_principal_id',cohort,
    'claimed_account_id',a->>'custodial_claimed_account_id','registration_id',reg_a,
    'identity_assurance','SELF_ASSERTED_NAME','individual_identity_verified',false)
   OR m#>'{metadata_json,safe_context}' IS DISTINCT FROM '{"preserve":true}'::jsonb
   THEN RAISE EXCEPTION 'F01 reserved metadata stripping / authoritative actor overwrite failed';END IF;checks:=checks+1;
  BEGIN
   PERFORM public.custodial_leadership_messaging_operation_v1(cohort,reg_a,browser_a::text,'send',payload||jsonb_build_object('body','Different'));
   RAISE EXCEPTION 'F01 changed payload admitted';
  EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM NOT LIKE 'client_message_id belongs to a different message payload%' THEN RAISE;END IF;END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.msg_messages WHERE sender_user_id=u_a AND client_message_id='f01-stable-original';
  IF n<>1 THEN RAISE EXCEPTION 'F01 duplicate message effect';END IF;
  IF EXISTS(SELECT 1 FROM public.msg_message_audit WHERE message_id=(m->>'id')::uuid AND sender_ops_manager_id IS NOT NULL) THEN RAISE EXCEPTION 'F01 invented named audit actor';END IF;
  actor:=public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_a,browser_a::text);
  IF actor->>'role' IS DISTINCT FROM 'manager' OR actor->>'custodial_claimed_account_id' IS DISTINCT FROM a->>'custodial_claimed_account_id'
   OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'F01 durable current actor unavailable';END IF;
  IF public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_b,browser_a::text) IS NOT NULL
   OR public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_a,browser_b::text) IS NOT NULL THEN RAISE EXCEPTION 'F01 durable foreign actor admitted';END IF;
  UPDATE custodial_leadership_private.registrations SET revoked_at=clock_timestamp() WHERE registration_id=reg_a;
  IF public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_a,browser_a::text) IS NOT NULL THEN RAISE EXCEPTION 'F01 revoked durable actor admitted';END IF;
  UPDATE custodial_leadership_private.registrations SET revoked_at=NULL WHERE registration_id=reg_a;
  UPDATE custodial_leadership_private.policy SET policy_version=policy_version+1 WHERE singleton;
  IF public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_a,browser_a::text) IS NOT NULL THEN RAISE EXCEPTION 'F01 stale policy durable actor admitted';END IF;
  UPDATE custodial_leadership_private.policy SET policy_version=policy_version-1 WHERE singleton;
  UPDATE custodial_leadership_private.registrations SET claimed_account_id=(names->1->>'accountId')::uuid WHERE registration_id=reg_a;
  IF public.msg_custodial_cohort_message_actor_v1((m->>'id')::uuid,u_a,browser_a::text) IS NOT NULL THEN RAISE EXCEPTION 'F01 changed claimed account durable actor admitted';END IF;
  checks:=checks+7;
  RAISE EXCEPTION USING ERRCODE='P0101',MESSAGE='rollback send and all actor changes';
 EXCEPTION WHEN SQLSTATE 'P0101' THEN NULL;END;
 t:=public.msg_get_or_create_direct_thread(u_b,legacy.id);
 BEGIN
  SET LOCAL ROLE static_weekly_control_plane;
  PERFORM public.static_weekly_leadership_bind_verified_request(reg_a,browser_a,cohort,gen_random_uuid());
  BEGIN
   PERFORM public.custodial_leadership_messaging_operation_v1(cohort,reg_a,browser_a::text,'send',payload||jsonb_build_object('thread_id',t.id));
   RAISE EXCEPTION 'F01 cross-inbox send admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  RAISE EXCEPTION USING ERRCODE='P0101',MESSAGE='rollback denied original context';
 EXCEPTION WHEN SQLSTATE 'P0101' THEN NULL;END;checks:=checks+1;
 INSERT INTO f01_evidence VALUES('result',jsonb_build_object('status','PASS','checks',checks,'inbox_a',u_a,'inbox_b',u_b,'legacy_named',legacy.id));
END $test$;
SELECT * FROM f01_evidence;
ROLLBACK;
