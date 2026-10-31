-- STAGING ONLY. Main owns canonical integration. F05 genuine typed credentials.
-- Requires F01 selected-name msg_users columns; never creates legacy trust rows.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $predecessor$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
 OR (SELECT proowner FROM pg_proc WHERE oid='public.ops_manager_notification_validate_owner()'::regprocedure)
 IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'Maintained privileged notification owner required';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.msg_users'::regclass
 AND attname='custodial_claimed_account_id' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.msg_users'::regclass
 AND attname='custodial_cohort_manager_id' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Selected-name Messenger authority predecessor required';END IF;
 IF strpos(pg_get_functiondef('public.ops_manager_notification_validate_owner()'::regprocedure),'from public.ops_manager_trusted_devices')=0
 THEN RAISE EXCEPTION 'Notification owner predecessor differs';END IF;
END $predecessor$;

CREATE TABLE public.ops_manager_notification_credentials(
 credential_id uuid PRIMARY KEY,
 credential_kind text NOT NULL CHECK(credential_kind IN('NAMED_TRUSTED_DEVICE','CUSTODIAL_LEADERSHIP_REGISTRATION')),
 trusted_credential_id uuid UNIQUE REFERENCES public.ops_manager_trusted_devices(credential_id) ON DELETE CASCADE,
 leadership_registration_id uuid UNIQUE REFERENCES custodial_leadership_private.registrations(registration_id) ON DELETE CASCADE,
 CHECK((credential_kind='NAMED_TRUSTED_DEVICE' AND trusted_credential_id IS NOT NULL AND trusted_credential_id=credential_id AND leadership_registration_id IS NULL)
 OR(credential_kind='CUSTODIAL_LEADERSHIP_REGISTRATION' AND leadership_registration_id IS NOT NULL AND leadership_registration_id=credential_id AND trusted_credential_id IS NULL))
);
ALTER TABLE public.ops_manager_notification_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_manager_notification_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_manager_notification_credentials FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ops_manager_notification_credentials TO postgres;
INSERT INTO public.ops_manager_notification_credentials(credential_id,credential_kind,trusted_credential_id)
 SELECT credential_id,'NAMED_TRUSTED_DEVICE',credential_id FROM (
 SELECT credential_id FROM public.ops_manager_notification_preferences UNION
 SELECT credential_id FROM public.ops_manager_push_devices UNION
 SELECT credential_id FROM public.ops_manager_notification_queue UNION
 SELECT credential_id FROM public.ops_manager_notification_state) existing;
DO $typed_foreign_keys$
DECLARE target text;original_name text;matches integer;
BEGIN
 FOREACH target IN ARRAY ARRAY['ops_manager_notification_preferences','ops_manager_push_devices','ops_manager_notification_queue','ops_manager_notification_state'] LOOP
 SELECT count(*),min(c.conname) INTO matches,original_name FROM pg_constraint c
 WHERE c.conrelid=('public.'||target)::regclass AND c.contype='f'
 AND c.confrelid='public.ops_manager_trusted_devices'::regclass
 AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='credential_id')]::smallint[];
 IF matches<>1 THEN RAISE EXCEPTION 'Notification FK predecessor differs: %',target;END IF;
 EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',target,original_name);
 EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(credential_id) REFERENCES public.ops_manager_notification_credentials(credential_id) ON DELETE CASCADE',target,original_name);
 END LOOP;
END $typed_foreign_keys$;

-- No public/service-role EXECUTE or private-table privilege. This is called only
-- by the existing maintained owner functions/triggers and never returns secrets.
CREATE FUNCTION custodial_leadership_private.notification_credential(p_credential uuid,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $credential$
DECLARE legacy public.ops_manager_trusted_devices%rowtype;view jsonb;has_registration boolean;
BEGIN
 IF p_credential IS NULL OR p_now IS NULL OR NOT isfinite(p_now) THEN RETURN NULL;END IF;
 SELECT * INTO legacy FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential;
 SELECT EXISTS(SELECT 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_credential) INTO has_registration;
 IF legacy.credential_id IS NOT NULL AND has_registration THEN RETURN NULL;END IF;
 IF has_registration THEN
  view:=custodial_leadership_private.session_view(p_credential);
  IF view IS NULL THEN RETURN NULL;END IF;
  RETURN jsonb_build_object('kind','CUSTODIAL_LEADERSHIP_REGISTRATION','managerId',view->'cohort'->>'principalId',
   'claimedAccountId',view->'claimedAccount'->>'accountId','deviceId',view->>'browserId');
 END IF;
 IF legacy.credential_id IS NULL OR legacy.revoked_at IS NOT NULL OR legacy.expires_at<=p_now
 OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=legacy.manager_id
 AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=false) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('kind','NAMED_TRUSTED_DEVICE','managerId',legacy.manager_id,'claimedAccountId',legacy.manager_id,'deviceId',legacy.device_id);
END $credential$;
REVOKE ALL ON FUNCTION custodial_leadership_private.notification_credential(uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

CREATE FUNCTION public.ops_manager_notification_bind_credential()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE authority jsonb;bound public.ops_manager_notification_credentials%rowtype;
BEGIN
 authority:=custodial_leadership_private.notification_credential(NEW.credential_id);
 IF authority IS NULL OR (TG_TABLE_NAME<>'ops_manager_notification_state'
 AND authority->>'managerId' IS DISTINCT FROM to_jsonb(NEW)->>'manager_id')
 THEN RAISE EXCEPTION 'Current typed manager notification credential required' USING ERRCODE='23514';END IF;
 INSERT INTO public.ops_manager_notification_credentials(credential_id,credential_kind,trusted_credential_id,leadership_registration_id)
 VALUES(NEW.credential_id,authority->>'kind',CASE WHEN authority->>'kind'='NAMED_TRUSTED_DEVICE' THEN NEW.credential_id ELSE NULL END,
 CASE WHEN authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' THEN NEW.credential_id ELSE NULL END)
 ON CONFLICT(credential_id) DO NOTHING;
 SELECT * INTO bound FROM public.ops_manager_notification_credentials WHERE credential_id=NEW.credential_id;
 IF bound.credential_kind IS DISTINCT FROM authority->>'kind' THEN RAISE EXCEPTION 'Notification credential domain mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $bind$;
REVOKE ALL ON FUNCTION public.ops_manager_notification_bind_credential() FROM PUBLIC,anon,authenticated,service_role;
DO $bind_triggers$ DECLARE target text;BEGIN
 FOREACH target IN ARRAY ARRAY['ops_manager_notification_preferences','ops_manager_push_devices','ops_manager_notification_queue'] LOOP
 EXECUTE format('CREATE TRIGGER a_notification_bind_credential BEFORE INSERT OR UPDATE OF credential_id,manager_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_bind_credential()',target);
 END LOOP;
 CREATE TRIGGER a_notification_bind_credential BEFORE INSERT OR UPDATE OF credential_id ON public.ops_manager_notification_state
 FOR EACH ROW EXECUTE FUNCTION public.ops_manager_notification_bind_credential();
END $bind_triggers$;

CREATE OR REPLACE FUNCTION public.ops_manager_notification_validate_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $owner$
DECLARE authority jsonb;
BEGIN
 -- Revocation must remain possible after authority becomes stale, including
 -- the existing restore invalidation. It cannot resurrect or reassign a row.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='ops_manager_push_devices' THEN
  IF NOT NEW.enabled AND NEW.revoked_at IS NOT NULL AND NEW.credential_id=OLD.credential_id AND NEW.manager_id=OLD.manager_id
  AND NEW.device_id=OLD.device_id AND NEW.fcm_token=OLD.fcm_token THEN NEW.updated_at:=now();RETURN NEW;END IF;
 END IF;
 authority:=custodial_leadership_private.notification_credential(NEW.credential_id);
 IF authority IS NULL OR authority->>'managerId' IS DISTINCT FROM NEW.manager_id::text
 OR(TG_TABLE_NAME='ops_manager_push_devices' AND authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION'
 AND authority->>'deviceId' IS DISTINCT FROM to_jsonb(NEW)->>'device_id')
 THEN RAISE EXCEPTION 'Notification record must belong to its current typed manager credential' USING ERRCODE='23514';END IF;
 NEW.updated_at:=now();RETURN NEW;
END $owner$;

CREATE OR REPLACE FUNCTION public.custodial_ops_manager_notification_recipient_is_current(p_credential_id uuid,p_manager_id uuid,p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $recipient$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd
 JOIN public.ops_manager_notification_credentials c USING(credential_id)
 WHERE pd.credential_id=p_credential_id AND pd.manager_id=p_manager_id AND pd.enabled AND pd.revoked_at IS NULL
 AND custodial_leadership_private.notification_credential(pd.credential_id,p_now)->>'kind'=c.credential_kind
 AND custodial_leadership_private.notification_credential(pd.credential_id,p_now)->>'managerId'=pd.manager_id::text);
$recipient$;
CREATE OR REPLACE FUNCTION public.custodial_ops_manager_notification_binding_is_current(
 p_push_device_id uuid,p_credential_id uuid,p_manager_id uuid,p_fcm_token_sha256 text,p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $binding$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_push_devices pd WHERE pd.push_device_id=p_push_device_id
 AND pd.credential_id=p_credential_id AND pd.manager_id=p_manager_id
 AND encode(extensions.digest(convert_to(pd.fcm_token,'UTF8'),'sha256'),'hex')=p_fcm_token_sha256
 AND public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now));
$binding$;

-- Existing durable dispatch/job leases and original-notification truth checks
-- call the two functions above; their lease/content/idempotency logic is unchanged.
CREATE OR REPLACE FUNCTION public.ops_manager_enqueue_message_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $message$
BEGIN
 IF NEW.is_deleted=true THEN RETURN NEW;END IF;
 INSERT INTO public.ops_manager_notification_queue(job_key,credential_id,manager_id,notification_type,source_id,title,body,data_json)
 SELECT 'manager-message:'||NEW.id::text||':'||pd.credential_id::text,pd.credential_id,pd.manager_id,'message',NEW.id,
 left(coalesce(nullif(sender.display_name,''),'Memphis Zoo Ops'),180),
 left(coalesce(nullif(regexp_replace(NEW.body,'[[:space:]]+',' ','g'),''),'New message'),1000),
 jsonb_build_object('kind','message','thread_id',NEW.thread_id::text,'message_id',NEW.id::text,
 'route','messages-chatscope.html?thread_id='||NEW.thread_id::text,'sender_name',coalesce(sender.display_name,'Memphis Zoo Ops'),'thread_title',coalesce(t.title,'Conversation'))
 FROM public.msg_thread_participants participant JOIN public.msg_users recipient ON recipient.id=participant.user_id
 JOIN public.ops_manager_push_devices pd ON pd.manager_id=coalesce(recipient.custodial_cohort_manager_id,recipient.ops_manager_id)
 CROSS JOIN LATERAL (SELECT custodial_leadership_private.notification_credential(pd.credential_id) authority) current_credential
 LEFT JOIN public.ops_manager_notification_preferences pref ON pref.credential_id=pd.credential_id
 LEFT JOIN public.msg_users sender ON sender.id=NEW.sender_user_id LEFT JOIN public.msg_threads t ON t.id=NEW.thread_id
 WHERE participant.thread_id=NEW.thread_id AND participant.left_at IS NULL AND participant.user_id<>NEW.sender_user_id
 AND pd.enabled AND pd.revoked_at IS NULL AND coalesce(pref.messages_enabled,true)
 AND current_credential.authority->>'managerId'=pd.manager_id::text
 AND ((current_credential.authority->>'kind'='NAMED_TRUSTED_DEVICE' AND recipient.ops_manager_id=pd.manager_id
       AND recipient.custodial_cohort_manager_id IS NULL AND recipient.custodial_claimed_account_id IS NULL)
 OR (current_credential.authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' AND recipient.ops_manager_id IS NULL
     AND recipient.custodial_cohort_manager_id=pd.manager_id
     AND recipient.custodial_claimed_account_id::text=current_credential.authority->>'claimedAccountId'))
 ON CONFLICT(job_key) DO NOTHING;
 RETURN NEW;
END $message$;

-- Recheck the selected inbox at the actual pre-send boundary. A changed
-- registration claim, removed participant, disabled preference or deleted message
-- cannot inherit a queue row produced for another selected-name inbox.
CREATE FUNCTION public.custodial_ops_manager_message_push_is_current(p_queue_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $message_current$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_notification_queue q
 WHERE q.queue_id=p_queue_id AND (q.notification_type<>'message' OR EXISTS(
 SELECT 1 FROM public.msg_messages message JOIN public.msg_thread_participants participant ON participant.thread_id=message.thread_id
 JOIN public.msg_users recipient ON recipient.id=participant.user_id
 LEFT JOIN public.ops_manager_notification_preferences pref ON pref.credential_id=q.credential_id
 CROSS JOIN LATERAL (SELECT custodial_leadership_private.notification_credential(q.credential_id) authority) current_credential
 WHERE message.id=q.source_id AND NOT message.is_deleted AND participant.left_at IS NULL
 AND participant.user_id<>message.sender_user_id AND recipient.is_active AND coalesce(pref.messages_enabled,true)
 AND current_credential.authority->>'managerId'=q.manager_id::text
 AND ((current_credential.authority->>'kind'='NAMED_TRUSTED_DEVICE' AND recipient.ops_manager_id=q.manager_id
       AND recipient.custodial_cohort_manager_id IS NULL AND recipient.custodial_claimed_account_id IS NULL)
 OR(current_credential.authority->>'kind'='CUSTODIAL_LEADERSHIP_REGISTRATION' AND recipient.ops_manager_id IS NULL
    AND recipient.custodial_cohort_manager_id=q.manager_id
    AND recipient.custodial_claimed_account_id::text=current_credential.authority->>'claimedAccountId')))));
$message_current$;
REVOKE ALL ON FUNCTION public.custodial_ops_manager_message_push_is_current(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader;

CREATE OR REPLACE FUNCTION public.ops_manager_notification_job_is_current(
 p_queue_id uuid,p_lease_token uuid,p_push_device_id uuid,p_fcm_token_sha256 text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $job$
 SELECT EXISTS(SELECT 1 FROM public.ops_manager_notification_queue q
 WHERE q.queue_id=p_queue_id AND q.status='leased' AND q.lease_token=p_lease_token AND q.leased_until>=now()
 AND public.custodial_ops_manager_notification_binding_is_current(p_push_device_id,q.credential_id,q.manager_id,p_fcm_token_sha256,now())
 AND public.custodial_ops_manager_message_push_is_current(q.queue_id)
 AND (q.notification_type<>'event_digest' OR public.app_event_manager_digest_is_current(q.data_json,now()))
 AND (q.notification_type<>'location_digest' OR public.custodial_ops_manager_location_digest_is_current(q.credential_id,q.data_json->>'location_fingerprint')));
$job$;
DO $finish_current$
DECLARE definition text;old_fragment text:='v_job_current:=v_recipient_current;';
BEGIN
 definition:=pg_get_functiondef('public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR strpos(definition,'public.app_event_manager_digest_is_current')=0 THEN RAISE EXCEPTION 'Manager finish recipient predecessor differs';END IF;
 EXECUTE replace(definition,old_fragment,'v_job_current:=v_recipient_current AND public.custodial_ops_manager_message_push_is_current(v_row.queue_id);');
END $finish_current$;

-- Change only the authenticated recipient query, preserving current Event,
-- location, reminder, durable queue and operational-failure projection logic.
DO $scheduled$
DECLARE definition text;old_fragment text;new_fragment text;
BEGIN
 definition:=pg_get_functiondef('public.ops_manager_enqueue_scheduled_notifications(timestamptz)'::regprocedure);
 old_fragment:='join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id join public.ops_manager_managers m on m.manager_id=pd.manager_id';
 new_fragment:='join public.ops_manager_notification_credentials nc on nc.credential_id=pd.credential_id';
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR (length(definition)-length(replace(definition,'and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false','')))/length('and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false')<>1
 THEN RAISE EXCEPTION 'Scheduled notification recipient predecessor differs';END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 definition:=replace(definition,'and td.revoked_at is null and td.expires_at>p_now and m.active=true and m.revoked_at is null and m.is_system_principal=false',
 'and public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now)');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.ops_manager_enqueue_lunch_delivery_failure(uuid,timestamptz)'::regprocedure);
 old_fragment:=$old$join public.ops_manager_trusted_devices td
    on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id
  join public.ops_manager_managers manager on manager.manager_id=pd.manager_id$old$;
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 OR strpos(definition,'and manager.is_system_principal=false')=0 THEN RAISE EXCEPTION 'Lunch failure recipient predecessor differs';END IF;
 definition:=replace(definition,old_fragment,'join public.ops_manager_notification_credentials nc on nc.credential_id=pd.credential_id');
 definition:=replace(definition,$old$and td.revoked_at is null and td.expires_at>p_now
    and manager.active=true and manager.revoked_at is null
    and manager.is_system_principal=false$old$,
 'and public.custodial_ops_manager_notification_recipient_is_current(pd.credential_id,pd.manager_id,p_now)');
 IF strpos(definition,'td.')>0 OR strpos(definition,'manager.is_system_principal')>0 THEN RAISE EXCEPTION 'Lunch recipient replacement incomplete';END IF;
 EXECUTE definition;
END $scheduled$;
COMMIT;
