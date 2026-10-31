CREATE OR REPLACE FUNCTION custodial_recovery.assert_current_manager(p_manager uuid, p_credential uuid, p_device text, p_signed_expires timestamp with time zone, p_security_session uuid, p_password_version integer, p_security_hash text, p_csrf_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor jsonb;m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 decision_time timestamptz;BEGIN
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
END $function$
