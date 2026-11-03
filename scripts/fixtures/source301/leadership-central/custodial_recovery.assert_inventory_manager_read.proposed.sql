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
END $function$
