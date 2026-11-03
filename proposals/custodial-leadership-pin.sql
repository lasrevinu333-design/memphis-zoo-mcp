-- PRIVATE PROPOSAL ONLY. No canonical adoption, secrets, activation, or people creation.
-- Main must explicitly approve policy/cohort/configuration and a restricted server
-- connection before use. No public Data API function, grant, live job or timer.
BEGIN;

-- Normalized catalog owner labels are not PostgreSQL role names. Install only
-- as the actual existing maintained actor owner; never create/assume a role.
DO $actual_installer_owner$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure)
     IS DISTINCT FROM (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname=current_user)
 THEN RAISE EXCEPTION 'Actual maintained privileged installer owner required' USING ERRCODE='42501';END IF;
END $actual_installer_owner$;

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE SCHEMA custodial_leadership_private AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE custodial_leadership_private.policy(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 cohort_principal_id uuid REFERENCES public.ops_manager_managers(manager_id),
 policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version>0),security_epoch integer NOT NULL DEFAULT 1 CHECK(security_epoch>0),
 permissions text[] NOT NULL DEFAULT '{}' CHECK(permissions<@ARRAY['custodial.read','custodial.edit','custodialManagementAdmin']::text[]),
 approved_by uuid REFERENCES public.ops_manager_managers(manager_id),approved_at timestamptz,approval_ref uuid,
 CHECK(NOT enabled OR(cohort_principal_id IS NOT NULL AND cardinality(permissions)>0 AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_ref IS NOT NULL))
);
INSERT INTO custodial_leadership_private.policy(singleton) VALUES(true);
CREATE TABLE custodial_leadership_private.pin_versions(
 pin_version uuid PRIMARY KEY DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN('ACTIVE','UNUSED','RETIRED')),
 verifier jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),activated_at timestamptz,expires_at timestamptz,
 private_delivery_receipt uuid,approval_ref uuid NOT NULL,
 CHECK((state='ACTIVE' AND activated_at IS NOT NULL AND expires_at=activated_at+interval '720 hours')
  OR(state='UNUSED' AND activated_at IS NULL AND expires_at IS NULL) OR state='RETIRED')
);
CREATE UNIQUE INDEX leadership_one_enrollment_pin ON custodial_leadership_private.pin_versions((true)) WHERE state IN('ACTIVE','UNUSED');
CREATE TABLE custodial_leadership_private.attempt_buckets(
 stage text NOT NULL CHECK(stage IN('challenge','enroll')),scope text NOT NULL CHECK(scope IN('global','source','browser','account')),
 key_hash text NOT NULL CHECK(key_hash~'^[a-f0-9]{64}$'),window_start timestamptz NOT NULL,attempts integer NOT NULL CHECK(attempts>0),
 PRIMARY KEY(stage,scope,key_hash,window_start)
);
CREATE TABLE custodial_leadership_private.challenges(
 challenge_hash text PRIMARY KEY CHECK(challenge_hash~'^[a-f0-9]{64}$'),browser_hash text NOT NULL CHECK(browser_hash~'^[a-f0-9]{64}$'),
 pin_version uuid NOT NULL REFERENCES custodial_leadership_private.pin_versions(pin_version),policy_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
);
CREATE TABLE custodial_leadership_private.registrations(
 registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),browser_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),
 browser_hash text NOT NULL CHECK(browser_hash~'^[a-f0-9]{64}$'),claimed_account_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 cohort_principal_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),enrollment_policy_version integer NOT NULL,
 enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 identity_assurance text NOT NULL DEFAULT 'SELF_ASSERTED_NAME' CHECK(identity_assurance='SELF_ASSERTED_NAME'),
 CHECK(expires_at>enrolled_at AND expires_at<=enrolled_at+interval '365 days')
);
CREATE UNIQUE INDEX leadership_one_active_browser ON custodial_leadership_private.registrations(browser_hash) WHERE revoked_at IS NULL;
CREATE TABLE custodial_leadership_private.verified_contacts(
 account_id uuid PRIMARY KEY REFERENCES public.ops_manager_managers(manager_id),email text NOT NULL,
 verified_at timestamptz NOT NULL,verification_ref uuid NOT NULL,
 CHECK(length(email)<=254 AND email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
CREATE TABLE custodial_leadership_private.security_scopes(
 session_id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,browser_id uuid NOT NULL,policy_version integer NOT NULL,security_epoch integer NOT NULL,
 token_hash text NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),csrf_hash text NOT NULL CHECK(csrf_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE custodial_leadership_private.rotation_intents(
 rotation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),previous_pin uuid NOT NULL REFERENCES custodial_leadership_private.pin_versions(pin_version),
 state text NOT NULL CHECK(state IN('AWAITING_PRIVATE_DELIVERY','UNUSED','ARMED')),
 owner_account_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 replacement_pin uuid REFERENCES custodial_leadership_private.pin_versions(pin_version),private_delivery_receipt uuid,
 prepare_approval uuid NOT NULL UNIQUE,delivery_approval uuid,arm_approval uuid
);
CREATE UNIQUE INDEX leadership_one_unconsumed_rotation ON custodial_leadership_private.rotation_intents((true)) WHERE state IN('AWAITING_PRIVATE_DELIVERY','UNUSED');
CREATE TABLE custodial_leadership_private.owner_events(
 approval_id uuid PRIMARY KEY,action text NOT NULL,request_digest text NOT NULL,result_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE custodial_leadership_private.audit(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),at timestamptz NOT NULL DEFAULT clock_timestamp(),event text NOT NULL,
 registration_id uuid,claimed_account_id uuid,cohort_principal_id uuid,policy_version integer,owner_approval_ref uuid,
 identity_assurance text NOT NULL CHECK(identity_assurance IN('SELF_ASSERTED_NAME','INDEPENDENT_OWNER_APPROVAL','NO_CLAIM'))
);
-- No policies granting browser/service roles access. No plaintext PIN/token columns.
DO $private_tables$ DECLARE t record;BEGIN
 FOR t IN SELECT c.oid::regclass name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='custodial_leadership_private' AND c.relkind='r' LOOP
  EXECUTE format('ALTER TABLE %s OWNER TO CURRENT_USER',t.name);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t.name);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated,service_role',t.name);
 END LOOP;
END $private_tables$;

CREATE FUNCTION custodial_leadership_private.approved_names()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $names$
DECLARE result jsonb;valid integer;
BEGIN
 WITH approved(ord,label,key) AS(VALUES
  (1,'Eric McKenney','eric_mckenney_facilities_maintenance_manager'),(2,'Haley','haley_lejman_water_quality_manager'),
  (3,'Brandy Gull','brandy_gull_horticulture_manager'),(4,'Jennifer','jennifer_sheffield_director_operations'),
  (5,'Annie','annie_feist_operations_admin'),(6,'Eric Operle','eric_custodial_manager')),
 matches AS(SELECT a.ord,a.label,m.manager_id,count(*) OVER(PARTITION BY a.ord) n
  FROM approved a JOIN public.ops_manager_managers m ON m.system_key=a.key
  WHERE m.active AND m.revoked_at IS NULL AND m.is_system_principal=false)
 SELECT count(*),jsonb_agg(jsonb_build_object('accountId',manager_id,'displayName',label) ORDER BY ord)
 INTO valid,result FROM matches WHERE n=1;
 IF valid<>6 OR (SELECT count(DISTINCT x->>'accountId') FROM jsonb_array_elements(result) x)<>6 THEN RETURN NULL;END IF;
 RETURN result;
END $names$;

CREATE FUNCTION custodial_leadership_private.take_attempt(p_stage text,p_source text,p_browser text,p_account text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $budget$
DECLARE bucket timestamptz:=to_timestamp(floor(extract(epoch FROM clock_timestamp())/900)*900);r record;n integer;
BEGIN
 IF coalesce(p_source,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_browser,'') !~ '^[a-f0-9]{64}$' OR p_stage NOT IN('challenge','enroll')
  OR(p_account IS NOT NULL AND p_account !~ '^[a-f0-9]{64}$') THEN RETURN false;END IF;
 -- Caller holds the singleton policy row FOR UPDATE: global counter serializes
 -- all replicas. Success never resets a bucket. Global exhaustion stops new keys.
 FOR r IN SELECT * FROM(VALUES('global',repeat('0',64),20),('source',p_source,5),('browser',p_browser,5),('account',p_account,5)) v(scope,key,cap) LOOP
  IF r.key IS NULL THEN CONTINUE;END IF;
  INSERT INTO custodial_leadership_private.attempt_buckets(stage,scope,key_hash,window_start,attempts)
   VALUES(p_stage,r.scope,r.key,bucket,1)
   ON CONFLICT(stage,scope,key_hash,window_start) DO UPDATE SET attempts=custodial_leadership_private.attempt_buckets.attempts+1
   RETURNING attempts INTO n;
  IF n>r.cap THEN RETURN false;END IF;
 END LOOP;RETURN true;
END $budget$;

CREATE FUNCTION custodial_leadership_private.session_view(p_registration uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $session$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 names jsonb;chosen jsonb;contact jsonb;
BEGIN
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=p_registration;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 IF NOT p.enabled OR r.registration_id IS NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=clock_timestamp()
  OR r.cohort_principal_id IS DISTINCT FROM p.cohort_principal_id
  OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
  THEN RETURN NULL;END IF;
 names:=custodial_leadership_private.approved_names();
 SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=r.claimed_account_id::text;
 IF chosen IS NULL OR r.claimed_account_id=p.cohort_principal_id THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('email',v.email,'verifiedAt',v.verified_at) INTO contact
  FROM custodial_leadership_private.verified_contacts v WHERE v.account_id=r.claimed_account_id AND v.verified_at<=clock_timestamp();
 RETURN jsonb_build_object('registrationId',r.registration_id,'browserId',r.browser_id,'credentialExpiresAt',r.expires_at,'csrfBinding',r.browser_hash,'claimedAccount',chosen||jsonb_build_object('contact',contact),
  'cohort',jsonb_build_object('principalId',p.cohort_principal_id,'policyVersion',p.policy_version,'securityEpoch',p.security_epoch,'permissions',to_jsonb(p.permissions)));
END $session$;

CREATE FUNCTION custodial_leadership_private.valid_verifier(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $verifier$
 SELECT coalesce(jsonb_typeof(v)='object' AND v->>'algorithm'='scrypt-hmac-sha256-v1'
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key)=ARRAY['algorithm','digest','salt']
  AND coalesce(v->>'salt','')~'^[a-f0-9]{64}$' AND coalesce(v->>'digest','')~'^[a-f0-9]{64}$',false)
$verifier$;

CREATE FUNCTION custodial_leadership_private.execute(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $execute$
DECLARE p custodial_leadership_private.policy%rowtype;v custodial_leadership_private.pin_versions%rowtype;
 c custodial_leadership_private.challenges%rowtype;r custodial_leadership_private.registrations%rowtype;
 rotation custodial_leadership_private.rotation_intents%rowtype;event custodial_leadership_private.owner_events%rowtype;
 names jsonb;chosen jsonb;result jsonb;verifier jsonb;stamp timestamptz:=clock_timestamp();owner_id uuid;new_id uuid;
 owner_action boolean:=p_action IN('install_initial','prepare_rotation','confirm_private_delivery','arm_enrollment_share');
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>4096 THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton FOR UPDATE;
 stamp:=clock_timestamp();
 IF p.singleton IS NULL THEN RETURN jsonb_build_object('ok',false,'error','policy_unavailable');END IF;
 IF owner_action THEN
  -- This ID is supplied ONLY by Main's independent owner authorizer, NEVER
  -- selected/claimed enrollment. No owner endpoints are mounted by this proposal.
  SELECT manager_id INTO owner_id FROM public.ops_manager_managers WHERE system_key='eric_custodial_manager'
   AND active AND revoked_at IS NULL AND is_system_principal=false;
  IF owner_id IS NULL OR p_data->>'owner_account_id' IS DISTINCT FROM owner_id::text OR p_data->>'approval_id' IS NULL
   THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
  SELECT * INTO event FROM custodial_leadership_private.owner_events WHERE approval_id=(p_data->>'approval_id')::uuid;
  IF event.approval_id IS NOT NULL THEN
   IF event.action IS DISTINCT FROM p_action OR event.request_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_data)
    THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
   RETURN jsonb_build_object('ok',true,'data',event.result_json);
  END IF;
 ELSE
  IF NOT p.enabled OR p.cohort_principal_id IS NULL OR cardinality(p.permissions)=0 OR p.approved_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
   THEN RETURN jsonb_build_object('ok',false,'error','policy_unavailable');END IF;
 END IF;

 IF p_action='begin_challenge' THEN
  IF NOT custodial_leadership_private.take_attempt('challenge',p_data->>'source_hash',p_data->>'browser_hash')
   THEN RETURN jsonb_build_object('ok',false,'error','rate_limited');END IF;
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE state='ACTIVE' AND activated_at<=stamp AND expires_at>stamp;
  IF v.pin_version IS NULL THEN RETURN jsonb_build_object('ok',false,'error','enrollment_unavailable');END IF;
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('pinVersion',v.pin_version,'verifier',v.verifier));
 ELSIF p_action='finish_challenge' THEN
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=(p_data->>'pin_version')::uuid AND state='ACTIVE' AND expires_at>stamp AND activated_at<=stamp;
  names:=custodial_leadership_private.approved_names();
  IF v.pin_version IS NULL OR names IS NULL OR coalesce(p_data->>'challenge_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_data->>'browser_hash','') !~ '^[a-f0-9]{64}$'
   THEN RETURN jsonb_build_object('ok',false,'error','enrollment_unavailable');END IF;
  INSERT INTO custodial_leadership_private.challenges(challenge_hash,browser_hash,pin_version,policy_version,created_at,expires_at)
   VALUES(p_data->>'challenge_hash',p_data->>'browser_hash',v.pin_version,p.policy_version,stamp,stamp+interval '5 minutes');
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('challengeExpiresAt',stamp+interval '5 minutes','approvedNames',names));
 ELSIF p_action='enroll' THEN
  IF NOT custodial_leadership_private.take_attempt('enroll',p_data->>'source_hash',p_data->>'browser_hash',p_data->>'account_key')
   THEN RETURN jsonb_build_object('ok',false,'error','rate_limited');END IF;
  SELECT * INTO c FROM custodial_leadership_private.challenges WHERE challenge_hash=p_data->>'challenge_hash' FOR UPDATE;
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=c.pin_version;
  IF c.challenge_hash IS NULL OR c.browser_hash IS DISTINCT FROM p_data->>'browser_hash' OR c.consumed_at IS NOT NULL OR c.expires_at<=stamp
   OR c.policy_version<>p.policy_version OR v.state IS DISTINCT FROM 'ACTIVE' OR v.expires_at<=stamp
   THEN RETURN jsonb_build_object('ok',false,'error','challenge_unavailable');END IF;
  names:=custodial_leadership_private.approved_names();
  SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=p_data->>'claimed_account_id';
  IF chosen IS NULL OR coalesce(p_data->>'new_browser_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_data->>'token_hash','') !~ '^[a-f0-9]{64}$'
   THEN RETURN jsonb_build_object('ok',false,'error','challenge_unavailable');END IF;
  IF EXISTS(SELECT 1 FROM custodial_leadership_private.registrations WHERE browser_hash=p_data->>'browser_hash' AND revoked_at IS NULL AND expires_at>stamp)
   THEN RETURN jsonb_build_object('ok',false,'error','browser_already_enrolled');END IF;
  INSERT INTO custodial_leadership_private.registrations(token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
   VALUES(p_data->>'token_hash',p_data->>'new_browser_hash',(p_data->>'claimed_account_id')::uuid,p.cohort_principal_id,p.policy_version,stamp,stamp+interval '365 days') RETURNING * INTO r;
  UPDATE custodial_leadership_private.challenges SET consumed_at=stamp WHERE challenge_hash=c.challenge_hash;
  INSERT INTO custodial_leadership_private.audit(event,registration_id,claimed_account_id,cohort_principal_id,policy_version,identity_assurance)
   VALUES('browser_enrolled',r.registration_id,r.claimed_account_id,p.cohort_principal_id,p.policy_version,'SELF_ASSERTED_NAME');
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action='session' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE token_hash=p_data->>'token_hash' AND browser_hash=p_data->>'browser_hash';
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action='credential_readback' THEN
  -- Only the private server connection calls this AFTER central signature
  -- verification; no public router exposes IDs as an authentication shortcut.
  SELECT * INTO r FROM custodial_leadership_private.registrations
   WHERE registration_id=(p_data->>'registration_id')::uuid AND browser_id=(p_data->>'browser_id')::uuid
    AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action IN('security_scope_issue','security_scope_readback','security_scope_revoke') THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=(p_data->>'registration_id')::uuid
   AND browser_id=(p_data->>'browser_id')::uuid AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  IF custodial_leadership_private.session_view(r.registration_id) IS NULL OR NOT('custodialManagementAdmin'=ANY(p.permissions))
   THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  IF p_action='security_scope_issue' THEN
   IF (p_data->>'policy_version')::integer IS DISTINCT FROM p.policy_version OR (p_data->>'security_epoch')::integer IS DISTINCT FROM p.security_epoch
    OR coalesce(p_data->>'token_hash','')!~'^[a-f0-9]{64}$' OR coalesce(p_data->>'csrf_hash','')!~'^[a-f0-9]{64}$'
    OR (p_data->>'expires_at')::timestamptz<=stamp OR (p_data->>'expires_at')::timestamptz>least(stamp+interval '15 minutes',r.expires_at)
    THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
   INSERT INTO custodial_leadership_private.security_scopes(session_id,registration_id,cohort_principal_id,browser_id,policy_version,security_epoch,token_hash,csrf_hash,created_at,expires_at)
   VALUES((p_data->>'session_id')::uuid,r.registration_id,p.cohort_principal_id,r.browser_id,p.policy_version,p.security_epoch,p_data->>'token_hash',p_data->>'csrf_hash',stamp,(p_data->>'expires_at')::timestamptz);
  ELSIF p_action='security_scope_revoke' THEN
   UPDATE custodial_leadership_private.security_scopes SET revoked_at=coalesce(revoked_at,stamp) WHERE session_id=(p_data->>'session_id')::uuid AND registration_id=r.registration_id;
  END IF;
  SELECT jsonb_build_object('session_id',ss.session_id,'security_epoch',ss.security_epoch,'expires_at',ss.expires_at,'revoked_at',ss.revoked_at,'token_hash',ss.token_hash,'csrf_hash',ss.csrf_hash)
   INTO result FROM custodial_leadership_private.security_scopes ss WHERE ss.session_id=(p_data->>'session_id')::uuid AND ss.registration_id=r.registration_id
    AND ss.policy_version=p.policy_version AND ss.security_epoch=p.security_epoch AND ss.expires_at>stamp AND (ss.revoked_at IS NULL OR p_action='security_scope_revoke');
 ELSIF p_action IN('gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome') THEN
  result:=custodial_leadership_private.gemini_operation(p_action,p_data);
 ELSIF p_action='security_epoch_bump' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=(p_data->>'registration_id')::uuid
   AND browser_id=(p_data->>'browser_id')::uuid AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  IF custodial_leadership_private.session_view(r.registration_id) IS NULL OR NOT('custodialManagementAdmin'=ANY(p.permissions))
   THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  UPDATE custodial_leadership_private.policy SET security_epoch=security_epoch+1 WHERE singleton RETURNING security_epoch INTO p.security_epoch;
  result:=jsonb_build_object('securityEpoch',p.security_epoch,'scope','custodial_leadership_device_security','revoked_all',true);
 ELSIF p_action='revoke' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE token_hash=p_data->>'token_hash' AND browser_hash=p_data->>'browser_hash' FOR UPDATE;
  IF r.registration_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  UPDATE custodial_leadership_private.registrations SET revoked_at=coalesce(revoked_at,stamp) WHERE registration_id=r.registration_id;
  UPDATE custodial_leadership_private.challenges SET consumed_at=coalesce(consumed_at,stamp) WHERE browser_hash=r.browser_hash;
  INSERT INTO custodial_leadership_private.audit(event,registration_id,claimed_account_id,cohort_principal_id,policy_version,identity_assurance)
   VALUES('browser_revoked',r.registration_id,r.claimed_account_id,p.cohort_principal_id,p.policy_version,'SELF_ASSERTED_NAME');
  result:=jsonb_build_object('revoked',true);
 ELSIF p_action='install_initial' THEN
  IF EXISTS(SELECT 1 FROM custodial_leadership_private.pin_versions) THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  verifier:=p_data->'verifier';
  IF custodial_leadership_private.valid_verifier(verifier) IS NOT TRUE
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  INSERT INTO custodial_leadership_private.pin_versions(state,verifier,activated_at,expires_at,approval_ref)
   VALUES('ACTIVE',verifier,stamp,stamp+interval '720 hours',(p_data->>'approval_id')::uuid) RETURNING pin_version INTO new_id;
  result:=jsonb_build_object('pinVersion',new_id,'state','ACTIVE','activeUntil',stamp+interval '720 hours','enrollmentOpen',true);
 ELSIF p_action='prepare_rotation' THEN
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents WHERE state IN('AWAITING_PRIVATE_DELIVERY','UNUSED');
  IF rotation.rotation_id IS NOT NULL THEN
   result:=jsonb_build_object('rotationId',rotation.rotation_id,'state',rotation.state,'pinVersion',rotation.replacement_pin,'activeUntil',NULL,'enrollmentOpen',true);
  ELSE
   SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE state='ACTIVE' AND expires_at<=stamp;
   IF v.pin_version IS NULL THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
   INSERT INTO custodial_leadership_private.rotation_intents(previous_pin,state,owner_account_id,prepare_approval)
    VALUES(v.pin_version,'AWAITING_PRIVATE_DELIVERY',owner_id,(p_data->>'approval_id')::uuid) RETURNING * INTO rotation;
   result:=jsonb_build_object('rotationId',rotation.rotation_id,'state',rotation.state,'pinVersion',NULL,'activeUntil',NULL,'enrollmentOpen',true);
  END IF;
 ELSIF p_action='confirm_private_delivery' THEN
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents WHERE rotation_id=(p_data->>'rotation_id')::uuid FOR UPDATE;
  IF rotation.rotation_id IS NULL OR rotation.state<>'AWAITING_PRIVATE_DELIVERY' OR rotation.owner_account_id<>owner_id OR p_data->>'delivery_receipt_id' IS NULL
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  verifier:=p_data->'verifier';
  IF custodial_leadership_private.valid_verifier(verifier) IS NOT TRUE
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  UPDATE custodial_leadership_private.pin_versions SET state='RETIRED' WHERE pin_version=rotation.previous_pin;
  INSERT INTO custodial_leadership_private.pin_versions(state,verifier,private_delivery_receipt,approval_ref)
   VALUES('UNUSED',verifier,(p_data->>'delivery_receipt_id')::uuid,(p_data->>'approval_id')::uuid) RETURNING pin_version INTO new_id;
  UPDATE custodial_leadership_private.rotation_intents AS ri SET state='UNUSED',replacement_pin=new_id,private_delivery_receipt=(p_data->>'delivery_receipt_id')::uuid,delivery_approval=(p_data->>'approval_id')::uuid WHERE ri.rotation_id=rotation.rotation_id;
  result:=jsonb_build_object('rotationId',rotation.rotation_id,'pinVersion',new_id,'state','UNUSED','activeUntil',NULL,'enrollmentOpen',true);
 ELSIF p_action='arm_enrollment_share' THEN
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=(p_data->>'pin_version')::uuid FOR UPDATE;
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents ri WHERE ri.replacement_pin=v.pin_version FOR UPDATE;
  IF v.pin_version IS NULL OR v.state<>'UNUSED' OR v.activated_at IS NOT NULL OR v.expires_at IS NOT NULL OR rotation.state IS DISTINCT FROM 'UNUSED' OR rotation.owner_account_id<>owner_id
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  UPDATE custodial_leadership_private.pin_versions SET state='ACTIVE',activated_at=stamp,expires_at=stamp+interval '720 hours' WHERE pin_version=v.pin_version;
  UPDATE custodial_leadership_private.rotation_intents ri SET state='ARMED',arm_approval=(p_data->>'approval_id')::uuid WHERE ri.rotation_id=rotation.rotation_id;
  result:=jsonb_build_object('pinVersion',v.pin_version,'state','ACTIVE','activeUntil',stamp+interval '720 hours','enrollmentOpen',true);
 ELSE RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 IF owner_action THEN
  INSERT INTO custodial_leadership_private.owner_events(approval_id,action,request_digest,result_json) VALUES((p_data->>'approval_id')::uuid,p_action,public.static_weekly_digest_jsonb(p_data),result);
  INSERT INTO custodial_leadership_private.audit(event,claimed_account_id,owner_approval_ref,identity_assurance) VALUES(p_action,owner_id,(p_data->>'approval_id')::uuid,'INDEPENDENT_OWNER_APPROVAL');
 END IF;
 RETURN jsonb_build_object('ok',true,'data',result);
EXCEPTION WHEN data_exception OR check_violation OR unique_violation THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');
END $execute$;

-- Runtime connection can NEVER invoke owner lifecycle actions. Main grants only
-- this wrapper to its approved enrollment runtime role; execute remains private.
CREATE FUNCTION custodial_leadership_private.runtime(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $runtime$
BEGIN
 IF p_action IS NULL OR p_action NOT IN('begin_challenge','finish_challenge','enroll','session','revoke','credential_readback','security_epoch_bump','security_scope_issue','security_scope_readback','security_scope_revoke','gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome')
  THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
 IF p_action NOT IN('session','credential_readback','security_scope_readback','gemini_context','gemini_original_outcome') THEN PERFORM public.custodial_begin_application_mutation();END IF;
 RETURN custodial_leadership_private.execute(p_action,p_data);
END $runtime$;
ALTER FUNCTION custodial_leadership_private.runtime(text,jsonb) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.valid_verifier(jsonb) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.approved_names() OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.take_attempt(text,text,text,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.session_view(uuid) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.execute(text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- Deliberately no enrollment-runtime schema/table grants or enabled-policy update.
-- Main must bind approved restricted server role and cohort-aware manager actor.

-- Main's explicit cohort request context: authenticated with the real stored
-- per-browser registration on the SAME control-plane transaction/connection.
CREATE TABLE custodial_leadership_private.request_contexts(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,request_id uuid NOT NULL,
 registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,policy_version integer NOT NULL,permission text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(backend_pid,transaction_id)
);
CREATE TABLE custodial_leadership_private.operation_bindings(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,
 original_request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE custodial_leadership_private.request_contexts OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.operation_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.request_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.operation_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_leadership_private.request_contexts,custodial_leadership_private.operation_bindings FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane;

CREATE FUNCTION public.static_weekly_leadership_bind_request(p_browser_hash text,p_token_hash text,p_request uuid,p_permission text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 c custodial_leadership_private.request_contexts%rowtype;view jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF coalesce(p_browser_hash,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$'
  OR p_request IS NULL OR p_permission IS NULL OR p_permission NOT IN('custodial.read','custodial.edit','custodialManagementAdmin')
  THEN RAISE EXCEPTION 'Custodial cohort credential context required' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE browser_hash=p_browser_hash AND token_hash=p_token_hash FOR SHARE;
 view:=custodial_leadership_private.session_view(r.registration_id);
 IF view IS NULL OR NOT(p_permission=ANY(p.permissions)) THEN RAISE EXCEPTION 'Custodial cohort permission unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_request OR c.registration_id<>r.registration_id OR c.permission<>p_permission)
  THEN RAISE EXCEPTION 'Custodial original request context cannot change' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
  VALUES(pg_backend_pid(),txid_current(),p_request,r.registration_id,p.cohort_principal_id,p.policy_version,p_permission)
  ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 RETURN custodial_leadership_private.require_context(p.cohort_principal_id,p_permission);
END $bind$;

CREATE FUNCTION custodial_leadership_private.require_context(p_principal uuid,p_permission text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $context$
DECLARE c custodial_leadership_private.request_contexts%rowtype;view jsonb;
BEGIN
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NULL OR c.cohort_principal_id IS DISTINCT FROM p_principal OR c.permission IS DISTINCT FROM p_permission
  OR c.created_at+interval '5 minutes'<=clock_timestamp()
  THEN RAISE EXCEPTION 'Custodial authenticated original request context required' USING ERRCODE='42501';END IF;
 view:=custodial_leadership_private.session_view(c.registration_id);
 IF view IS NULL OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_principal::text
  OR(view#>>'{cohort,policyVersion}')::integer IS DISTINCT FROM c.policy_version
  OR NOT(view#>'{cohort,permissions}' ? p_permission)
  THEN RAISE EXCEPTION 'Custodial original cohort credential was revoked or changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('manager_id',p_principal,'manager_name','Custodial leadership cohort',
  'actor_kind','CUSTODIAL_LEADERSHIP_COHORT','identity_assurance','SELF_ASSERTED_NAME',
  'credential_id',c.registration_id,'browser_id',view->>'browserId','request_id',c.request_id,'policy_version',c.policy_version,
  'custodialManagementAdmin',view#>'{cohort,permissions}' ? 'custodialManagementAdmin',
  'claimed_account_id',view#>>'{claimedAccount,accountId}','claimed_name',view#>>'{claimedAccount,displayName}',
  'individual_identity_verified',false,'owner',false,'device_id',view->>'browserId');
END $context$;

CREATE FUNCTION custodial_leadership_private.guard_staffing_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $operation$
DECLARE p custodial_leadership_private.policy%rowtype;b custodial_leadership_private.operation_bindings%rowtype;actor jsonb;
BEGIN
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 SELECT * INTO b FROM custodial_leadership_private.operation_bindings WHERE operation_id=NEW.operation_id;
 IF b.operation_id IS NULL AND NEW.prepared_by_manager_id IS DISTINCT FROM p.cohort_principal_id THEN RETURN NEW;END IF;
 actor:=custodial_leadership_private.require_context(NEW.prepared_by_manager_id,'custodialManagementAdmin');
 IF NEW.confirmed_by_manager_id IS NOT NULL AND NEW.confirmed_by_manager_id IS DISTINCT FROM NEW.prepared_by_manager_id
  THEN RAISE EXCEPTION 'Custodial cohort confirmer cannot become a claimed individual' USING ERRCODE='42501';END IF;
 IF b.operation_id IS NULL AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original cohort operation binding is missing; no named-operation adoption' USING ERRCODE='42501';END IF;
 IF b.operation_id IS NOT NULL THEN
  IF b.registration_id::text IS DISTINCT FROM actor->>'credential_id'
   OR b.cohort_principal_id IS DISTINCT FROM NEW.prepared_by_manager_id
   OR b.claimed_account_id::text IS DISTINCT FROM actor->>'claimed_account_id'
   THEN RAISE EXCEPTION 'Original pending operation belongs to another browser registration' USING ERRCODE='42501';END IF;
 ELSE
  INSERT INTO custodial_leadership_private.operation_bindings(operation_id,registration_id,cohort_principal_id,claimed_account_id,original_request_id)
   VALUES(NEW.operation_id,(actor->>'credential_id')::uuid,NEW.prepared_by_manager_id,(actor->>'claimed_account_id')::uuid,(actor->>'request_id')::uuid);
 END IF;
 RETURN NEW;
END $operation$;
CREATE TRIGGER custodial_leadership_original_staffing_registration
 AFTER INSERT OR UPDATE ON public.static_weekly_staffing_commands
 FOR EACH ROW EXECUTE FUNCTION custodial_leadership_private.guard_staffing_operation();
ALTER TABLE public.static_weekly_staffing_commands ENABLE ALWAYS TRIGGER custodial_leadership_original_staffing_registration;

-- Guard only the exact current Source301 named-actor predecessor. All of Main's
-- native-period/read_staffing_command/sourceDigest changes remain untouched.
DO $predecessor$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v3_manager_actor(uuid)'::regprocedure)) IS DISTINCT FROM '9753ab490c2c16490d51b6bb9bbc192b15014be7200118e05cf2dc34202b606d'
 THEN RAISE EXCEPTION 'Named manager actor predecessor differs; compose explicitly';END IF;
END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v3_manager_actor(p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_name text;
begin
  if exists(select 1 from custodial_leadership_private.policy p where p.cohort_principal_id=p_manager_id) then
    return custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
  end if;
  select display_name into v_name from public.ops_manager_managers where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if nullif(btrim(v_name),'') is null then raise exception using errcode='42501',message='an authorized active named manager principal is required'; end if;
  return jsonb_build_object('manager_id',p_manager_id::text,'manager_name',v_name);
end
$function$;

ALTER FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.require_context(uuid,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.guard_staffing_operation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
-- Narrow bind only: this existing role already owns the actual schedule RPCs.
GRANT EXECUTE ON FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) TO static_weekly_control_plane;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;


CREATE FUNCTION public.static_weekly_leadership_bind_verified_request(p_registration uuid,p_browser uuid,p_cohort uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $verified$
DECLARE view jsonb;c custodial_leadership_private.request_contexts%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM 1 FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_registration FOR SHARE;
 view:=custodial_leadership_private.session_view(p_registration);
 IF view IS NULL OR p_request IS NULL OR view->>'browserId' IS DISTINCT FROM p_browser::text
  OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_cohort::text OR NOT(view#>'{cohort,permissions}' ? 'custodialManagementAdmin')
  THEN RAISE EXCEPTION 'Actual cohort credential is unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_request OR c.registration_id<>p_registration OR c.cohort_principal_id<>p_cohort)
  THEN RAISE EXCEPTION 'Original cohort transaction binding changed' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
 VALUES(pg_backend_pid(),txid_current(),p_request,p_registration,p_cohort,(view#>>'{cohort,policyVersion}')::integer,'custodialManagementAdmin')
 ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 RETURN custodial_leadership_private.require_context(p_cohort,'custodialManagementAdmin');
END $verified$;
ALTER FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) TO static_weekly_control_plane;
-- Control plane only, never Main API/Supabase service role; owner execute stays private.
GRANT USAGE ON SCHEMA custodial_leadership_private TO static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION custodial_leadership_private.runtime(text,jsonb) TO static_weekly_control_plane;
DO $action_predecessor$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_action_actor_v1(uuid,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM 'c3953e8993ef86cba598973e36bc0dc34bd393dda0bca2dfc398bf97b5fd412a'
 THEN RAISE EXCEPTION 'Current action actor predecessor differs';END IF;
END $action_predecessor$;
CREATE OR REPLACE FUNCTION public.custodial_action_actor_v1(p_manager_id uuid, p_credential_id uuid, p_device_id text, p_session_access text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.ops_manager_managers%ROWTYPE;c public.ops_manager_trusted_devices%ROWTYPE;is_owner boolean;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','write','close_scan_tickets','manage_absences','manage_coverall','regenerate_routes')
  OR p_session_access IS NULL OR p_session_access NOT IN ('full_access','read_only') THEN
  RAISE EXCEPTION USING errcode='42501',message='Unknown manager action or session access';END IF;
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager_id) THEN
  IF p_session_access<>'full_access' THEN RAISE EXCEPTION 'Current cohort full management context required' USING ERRCODE='42501';END IF;
  DECLARE cohort_actor jsonb;BEGIN
   cohort_actor:=custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
   IF cohort_actor->>'credential_id' IS DISTINCT FROM p_credential_id::text OR cohort_actor->>'device_id' IS DISTINCT FROM p_device_id
    OR cohort_actor->'custodialManagementAdmin' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Original cohort credential differs' USING ERRCODE='42501';END IF;
   RETURN cohort_actor;
  END;
 END IF;
 SELECT * INTO c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential_id FOR SHARE;
 SELECT * INTO m FROM public.ops_manager_managers WHERE manager_id=p_manager_id FOR SHARE;
 IF c.credential_id IS NULL OR m.manager_id IS NULL OR c.manager_id IS DISTINCT FROM m.manager_id
  OR c.device_id IS DISTINCT FROM p_device_id OR c.revoked_at IS NOT NULL
  OR c.expires_at IS NULL OR c.expires_at<=clock_timestamp() OR c.created_at IS NULL OR c.created_at>clock_timestamp()
  OR m.active IS NOT TRUE OR m.revoked_at IS NOT NULL OR m.is_system_principal IS NOT FALSE
  OR coalesce(m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],false) IS NOT TRUE
  OR nullif(btrim(m.display_name),'') IS NULL THEN
  RAISE EXCEPTION USING errcode='42501',message='A current named manager credential is required';END IF;
 is_owner:=coalesce(m.system_key='eric_custodial_manager' AND p_session_access='full_access' AND c.max_access_level='full_access',false);
 IF p_action<>'read' AND m.system_key='eric_custodial_manager' AND NOT is_owner THEN
  RAISE EXCEPTION USING errcode='42501',message='Use a current full-control owner sign-in';END IF;
 IF p_action='write' AND NOT is_owner THEN
  RAISE EXCEPTION USING errcode='42501',message='This action is owner-only';END IF;
 RETURN jsonb_build_object('manager_id',m.manager_id,'manager_name',m.display_name,'owner',is_owner,
  'credential_id',c.credential_id,'device_id',c.device_id,'scheduler_delegation','dated_absences_coverall_routes',
  'owner_unavailability_required',false);
END $function$;


CREATE FUNCTION custodial_leadership_private.read_security_scope(p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,p_version integer,p_security_hash text,p_csrf_hash text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $scope$
DECLARE view jsonb;s custodial_leadership_private.security_scopes%rowtype;observed timestamptz:=clock_timestamp();
BEGIN
 view:=custodial_leadership_private.session_view(p_credential);
 SELECT * INTO s FROM custodial_leadership_private.security_scopes WHERE session_id=p_security_session;
 IF view IS NULL OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_manager::text OR view->>'browserId' IS DISTINCT FROM p_device
  OR NOT(view#>'{cohort,permissions}' ? 'custodialManagementAdmin') OR s.session_id IS NULL OR s.registration_id IS DISTINCT FROM p_credential
  OR s.cohort_principal_id IS DISTINCT FROM p_manager OR s.browser_id::text IS DISTINCT FROM p_device OR s.revoked_at IS NOT NULL
  OR s.policy_version IS DISTINCT FROM (view#>>'{cohort,policyVersion}')::integer OR s.security_epoch IS DISTINCT FROM (view#>>'{cohort,securityEpoch}')::integer
  OR s.security_epoch IS DISTINCT FROM p_version OR s.token_hash IS DISTINCT FROM p_security_hash OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR p_security_hash IS NULL OR p_csrf_hash IS NULL OR s.created_at>observed OR s.expires_at<=observed
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=observed
  THEN RAISE EXCEPTION 'Current original cohort security scope required' USING ERRCODE='42501';END IF;
 RETURN least(observed+interval '5 minutes',p_signed_expires,s.expires_at,(view->>'credentialExpiresAt')::timestamptz);
END $scope$;
CREATE FUNCTION custodial_leadership_private.bind_security_scope(p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,p_version integer,p_security_hash text,p_csrf_hash text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $scope_bind$
DECLARE until_time timestamptz;view jsonb;c custodial_leadership_private.request_contexts%rowtype;
BEGIN
 PERFORM 1 FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_credential FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.security_scopes WHERE session_id=p_security_session FOR SHARE;
 until_time:=custodial_leadership_private.read_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_version,p_security_hash,p_csrf_hash);
 view:=custodial_leadership_private.session_view(p_credential);
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_security_session OR c.registration_id<>p_credential OR c.cohort_principal_id<>p_manager)
  THEN RAISE EXCEPTION 'Original cohort security transaction binding changed' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
 VALUES(pg_backend_pid(),txid_current(),p_security_session,p_credential,p_manager,(view#>>'{cohort,policyVersion}')::integer,'custodialManagementAdmin')
 ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 PERFORM custodial_leadership_private.require_context(p_manager,'custodialManagementAdmin');
 RETURN until_time;
END $scope_bind$;
ALTER FUNCTION custodial_leadership_private.read_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.bind_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.read_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text),custodial_leadership_private.bind_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_recovery.assert_current_manager(uuid,uuid,text,timestamptz,uuid,integer,text,text)'::regprocedure)) IS DISTINCT FROM '7fbb7a0fce95ac59b63403f927b3ce879713f364c70ec46f6bb5eabb1a9e5dd4' THEN RAISE EXCEPTION 'Exact native manager guard predecessor differs';END IF;END $guard$;
CREATE OR REPLACE FUNCTION custodial_recovery.assert_current_manager(p_manager uuid, p_credential uuid, p_device text, p_signed_expires timestamp with time zone, p_security_session uuid, p_password_version integer, p_security_hash text, p_csrf_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor jsonb;m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 decision_time timestamptz;BEGIN
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager) THEN
  RETURN custodial_leadership_private.bind_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 END IF;
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,'full_access','write');
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential FOR SHARE;
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager FOR SHARE;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton FOR SHARE;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session FOR SHARE;
 decision_time:=clock_timestamp();
 IF ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.revoked_at IS NOT NULL
  OR c.expires_at<=decision_time OR c.created_at>decision_time
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=decision_time
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.expires_at<=decision_time OR s.created_at>decision_time
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current same-original owner security session required';END IF;
 RETURN least(decision_time+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $function$;
DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_recovery.assert_inventory_manager_read(uuid,uuid,text,timestamptz,uuid,integer,text,text)'::regprocedure)) IS DISTINCT FROM '145fa565c6c0650801b0ddff2d27edcb537bc31bc14c982f53dd2bf0eb551416' THEN RAISE EXCEPTION 'Exact native manager guard predecessor differs';END IF;END $guard$;
CREATE OR REPLACE FUNCTION custodial_recovery.assert_inventory_manager_read(p_manager uuid, p_credential uuid, p_device text, p_signed_expires timestamp with time zone, p_security_session uuid, p_password_version integer, p_security_hash text, p_csrf_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 observed timestamptz;BEGIN
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager) THEN
  RETURN custodial_leadership_private.read_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 END IF;
 -- Same owner/password/security-session boundary as assert_current_manager,
 -- with NO FOR SHARE or effects: the intended port must work in READ ONLY.
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager;
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session;
 observed:=clock_timestamp();
 IF p_manager IS NULL OR p_credential IS NULL OR p_security_session IS NULL OR nullif(btrim(p_device),'') IS NULL
  OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true
  OR nullif(btrim(m.display_name),'') IS NULL
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.revoked_at IS NOT NULL OR c.created_at IS NULL OR NOT isfinite(c.created_at) OR c.created_at>observed
  OR c.expires_at IS NULL OR NOT isfinite(c.expires_at) OR c.expires_at<=observed
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=observed
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.created_at IS NULL OR NOT isfinite(s.created_at) OR s.created_at>observed
  OR s.expires_at IS NULL OR NOT isfinite(s.expires_at) OR s.expires_at<=observed
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current original inventory owner read session required';END IF;
 RETURN least(observed+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $function$;

-- Browser credentials own NEW cohort originals; no historical operation adoption.
CREATE TABLE custodial_leadership_private.gemini_conversation_bindings(
 conversation_id uuid PRIMARY KEY REFERENCES public.gemini_console_conversations(conversation_id),registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE custodial_leadership_private.gemini_message_bindings(
 message_id uuid PRIMARY KEY REFERENCES public.gemini_console_messages(message_id),registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE custodial_leadership_private.gemini_conversation_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.gemini_message_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.gemini_conversation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.gemini_message_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_leadership_private.gemini_conversation_bindings,custodial_leadership_private.gemini_message_bindings FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE FUNCTION custodial_leadership_private.gemini_operation(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $gemini$
DECLARE v jsonb;inp jsonb:=p_data->'input';r uuid:=(p_data->>'registration_id')::uuid;c uuid:=(p_data->>'cohort_principal_id')::uuid;
 conversation uuid;message uuid;answer jsonb;attachments uuid[];item public.gemini_console_conversations%rowtype;
BEGIN
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=r FOR SHARE;
 v:=custodial_leadership_private.session_view(r);
 IF v IS NULL OR v->>'browserId' IS DISTINCT FROM p_data->>'browser_id' OR v#>>'{cohort,principalId}' IS DISTINCT FROM c::text
  OR NOT(v#>'{cohort,permissions}' ? 'custodialManagementAdmin') OR jsonb_typeof(inp) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Current original cohort Gemini registration required' USING ERRCODE='42501';END IF;
 IF p_action='gemini_context' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(inp))>1 OR EXISTS(SELECT 1 FROM jsonb_object_keys(inp) k WHERE k NOT IN('conversation_id','attachment_id','message_id')) THEN RAISE EXCEPTION 'Exact Gemini context required';END IF;
 ELSIF p_action='gemini_conversation' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['conversation_id','title']::text[] THEN RAISE EXCEPTION 'Exact conversation required';END IF;
 ELSIF p_action='gemini_begin_turn' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['attachment_ids','body','client_message_id','conversation_id','correlation_id']::text[] THEN RAISE EXCEPTION 'Exact logical turn required';END IF;
 ELSIF p_action='gemini_original_outcome' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['client_message_id','conversation_id']::text[] THEN RAISE EXCEPTION 'Exact original lookup required';END IF;
 ELSE RAISE EXCEPTION 'Unknown cohort Gemini operation' USING ERRCODE='42501';END IF;
 conversation:=(inp->>'conversation_id')::uuid;
 IF p_action='gemini_context' THEN
  IF inp ? 'attachment_id' THEN SELECT conversation_id INTO conversation FROM public.gemini_console_attachments WHERE attachment_id=(inp->>'attachment_id')::uuid AND manager_id=c;IF NOT FOUND THEN RAISE EXCEPTION 'Original cohort attachment unavailable' USING ERRCODE='42501';END IF;END IF;
  IF inp ? 'message_id' THEN SELECT conversation_id INTO conversation FROM public.gemini_console_messages WHERE message_id=(inp->>'message_id')::uuid AND manager_id=c;IF NOT FOUND THEN RAISE EXCEPTION 'Original cohort message unavailable' USING ERRCODE='42501';END IF;END IF;
  IF conversation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active')
   THEN RAISE EXCEPTION 'Original conversation belongs to another browser or named manager' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('conversationIds',coalesce(jsonb_agg(x.conversation_id ORDER BY x.last_activity_at DESC),'[]'::jsonb)) INTO answer FROM(
   SELECT g.conversation_id,g.last_activity_at FROM public.gemini_console_conversations g
   JOIN custodial_leadership_private.gemini_conversation_bindings b ON b.conversation_id=g.conversation_id WHERE b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status<>'deleted' ORDER BY g.last_activity_at DESC LIMIT 100) x;
  RETURN answer;
 ELSIF p_action='gemini_conversation' THEN
  IF conversation IS NULL OR nullif(btrim(inp->>'title'),'') IS NULL OR length(inp->>'title')>160 THEN RAISE EXCEPTION 'Exact new conversation required';END IF;
  SELECT * INTO item FROM public.gemini_console_conversations WHERE conversation_id=conversation FOR UPDATE;
  IF FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active') THEN RAISE EXCEPTION 'Existing conversation cannot be adopted' USING ERRCODE='42501';END IF;
  ELSE
   INSERT INTO public.gemini_console_conversations(conversation_id,owner_manager_id,title) VALUES(conversation,c,inp->>'title') RETURNING * INTO item;
   INSERT INTO custodial_leadership_private.gemini_conversation_bindings(conversation_id,registration_id,cohort_principal_id,claimed_account_id) VALUES(conversation,r,c,(v#>>'{claimedAccount,accountId}')::uuid);
  END IF;
  RETURN to_jsonb(item);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active')
  THEN RAISE EXCEPTION 'Original cohort conversation required' USING ERRCODE='42501';END IF;
 IF p_action='gemini_original_outcome' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('original_user',to_jsonb(u),'original_assistant',to_jsonb(a))),'[]'::jsonb) INTO answer
   FROM public.gemini_console_messages u JOIN custodial_leadership_private.gemini_message_bindings b ON b.message_id=u.message_id
   LEFT JOIN public.gemini_console_messages a ON a.response_to_message_id=u.message_id AND a.role='assistant'
   WHERE b.registration_id=r AND b.cohort_principal_id=c AND u.manager_id=c AND u.conversation_id=conversation AND u.client_message_id=(inp->>'client_message_id')::uuid AND u.role='user';
  RETURN answer;
 END IF;
 -- Bind this actual private transaction before existing state-changing RPCs.
 PERFORM public.static_weekly_leadership_bind_verified_request(r,(v->>'browserId')::uuid,c,gen_random_uuid());
 IF p_action='gemini_begin_turn' THEN
  SELECT message_id INTO message FROM public.gemini_console_messages WHERE manager_id=c AND client_message_id=(inp->>'client_message_id')::uuid FOR UPDATE;
  IF FOUND AND NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_message_bindings b WHERE b.message_id=message AND b.registration_id=r AND b.cohort_principal_id=c)
   THEN RAISE EXCEPTION 'Existing logical message cannot be adopted' USING ERRCODE='42501';END IF;
  IF jsonb_typeof(inp->'attachment_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(inp->'attachment_ids')>8 THEN RAISE EXCEPTION 'Exact original attachments required';END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO attachments FROM jsonb_array_elements_text(inp->'attachment_ids');
  answer:=public.gemini_console_begin_turn(conversation,c,(inp->>'client_message_id')::uuid,inp->>'body',attachments,(inp->>'correlation_id')::uuid);
  message:=(answer#>>'{user_message,message_id}')::uuid;
  IF answer->'inserted'='true'::jsonb THEN INSERT INTO custodial_leadership_private.gemini_message_bindings(message_id,registration_id,cohort_principal_id,claimed_account_id) VALUES(message,r,c,(v#>>'{claimedAccount,accountId}')::uuid);END IF;
  IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_message_bindings b WHERE b.message_id=message AND b.registration_id=r AND b.cohort_principal_id=c) THEN RAISE EXCEPTION 'Original message registration differs' USING ERRCODE='42501';END IF;
  RETURN answer;

 END IF;
 RAISE EXCEPTION 'Unknown cohort Gemini operation' USING ERRCODE='42501';
END $gemini$;
ALTER FUNCTION custodial_leadership_private.gemini_operation(text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.gemini_operation(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

COMMIT;
