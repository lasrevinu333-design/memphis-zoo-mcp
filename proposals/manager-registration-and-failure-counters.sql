-- Independent held follow-up. Apply only after separate admission.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.ops_manager_register_push(p_credential_id uuid,p_manager_id uuid,p_device_id text,
  p_platform text,p_token text,p_app_version text,p_app_build text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE registered public.ops_manager_push_devices%rowtype;
BEGIN
  -- Low-volume registration writes serialize even when both unique keys move.
  -- Existing provider jobs keep their original credential and push-device evidence.
  LOCK TABLE public.ops_manager_push_devices IN SHARE ROW EXCLUSIVE MODE;
  INSERT INTO public.ops_manager_notification_preferences(credential_id,manager_id)
    VALUES (p_credential_id,p_manager_id) ON CONFLICT (credential_id) DO NOTHING;
  DELETE FROM public.ops_manager_push_devices
    WHERE fcm_token=p_token AND credential_id<>p_credential_id;
  INSERT INTO public.ops_manager_push_devices AS d
    (credential_id,manager_id,device_id,platform,fcm_token,app_version,app_build,metadata_json)
    VALUES (p_credential_id,p_manager_id,p_device_id,p_platform,p_token,p_app_version,p_app_build,
      '{"registered_by":"manager_app","notification_defaults":"messages_on_events_locations_off"}')
    ON CONFLICT (credential_id) DO UPDATE SET manager_id=excluded.manager_id,device_id=excluded.device_id,
      platform=excluded.platform,fcm_token=excluded.fcm_token,app_version=excluded.app_version,app_build=excluded.app_build,
      enabled=true,revoked_at=null,last_error=null,last_seen_at=clock_timestamp(),last_registered_at=clock_timestamp(),
      metadata_json=excluded.metadata_json
    RETURNING * INTO STRICT registered;
  RETURN jsonb_build_object('push_device_id',registered.push_device_id,'credential_id',registered.credential_id,
    'manager_id',registered.manager_id,'device_id',registered.device_id,'platform',registered.platform,
    'enabled',registered.enabled,'last_registered_at',registered.last_registered_at,'last_seen_at',registered.last_seen_at);
END $fn$;
REVOKE ALL ON FUNCTION public.ops_manager_register_push(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ops_manager_register_push(uuid,uuid,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.ops_manager_record_auth_failure(p_scope text,p_key_hash text,p_metadata jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE
  target text := CASE p_scope WHEN 'device_security' THEN 'ops_manager_device_security_rate_limits'
    WHEN 'enrollment_code' THEN 'ops_manager_enrollment_code_rate_limits' END;
  answer jsonb;
  observed timestamptz;
BEGIN
  IF target IS NULL OR length(p_key_hash) IS DISTINCT FROM 64 OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A named failure scope, key and metadata are required';
  END IF;
  -- Serialize first-insert and rollover on the same scope/key. Sample the
  -- clock after waiting, so older concurrent attempts cannot shorten a lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(target||':'||p_key_hash,0));
  observed := clock_timestamp();
  EXECUTE format($write$
    INSERT INTO public.%I AS prior(key_hash,failure_count,first_failed_at,last_failed_at,metadata_json)
    VALUES ($1,1,$2,$2,$3)
    ON CONFLICT (key_hash) DO UPDATE SET
      first_failed_at=CASE WHEN prior.first_failed_at>$2-interval '15 min' OR prior.locked_until>$2 THEN prior.first_failed_at ELSE $2 END,
      failure_count=CASE WHEN prior.first_failed_at>$2-interval '15 min' OR prior.locked_until>$2 THEN least(prior.failure_count+1,1000) ELSE 1 END,
      last_failed_at=$2,metadata_json=$3,
      locked_until=CASE WHEN prior.locked_until>$2 THEN prior.locked_until
        WHEN prior.first_failed_at>$2-interval '15 min' AND prior.failure_count>=4 THEN $2+interval '15 min' ELSE NULL END
    RETURNING to_jsonb(prior)
  $write$,target) INTO STRICT answer USING p_key_hash,observed,p_metadata;
  RETURN answer;
END $fn$;
REVOKE ALL ON FUNCTION public.ops_manager_record_auth_failure(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ops_manager_record_auth_failure(text,text,jsonb) TO service_role;
COMMIT;
