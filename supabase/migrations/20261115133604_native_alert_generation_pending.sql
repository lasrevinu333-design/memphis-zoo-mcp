-- Forward-only readiness classification; all original recipient/admission checks remain.
-- No message/job/generation/credential/work record is created, replayed or modified.
-- Rebind exactly the existing restore definition in the same locked transaction,
-- using the established guarded inventory migration pattern. Committed guard stays ALWAYS.
DO $native_alert_initial_generation$
DECLARE
 target regprocedure:='public.custodial_native_alert_target_at(uuid,uuid,timestamp with time zone)'::regprocedure;
 identity constant text:='custodial_native_alert_target_at(uuid,uuid,timestamp with time zone)';
 old_definition constant text:=$old_definition$CREATE OR REPLACE FUNCTION public.custodial_native_alert_target_at(p_job uuid, p_lease uuid, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;at_time timestamptz;recipient uuid;epoch bigint;
 kind text;active_count integer;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null then raise exception 'exact alert job lease required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if j.job_id is null or j.status<>'leased' or j.lease_token is distinct from p_lease
  or j.job_type not in ('employee_event_push','employee_native_push') then
  return jsonb_build_object('current',false,'reason','native_alert_job_superseded');end if;
 if j.job_type='employee_event_push' then
  kind:='EVENT';
  select * into i from public.event_push_instances where instance_id=j.source_id;
  recipient:=i.credential_id;epoch:=i.assignment_epoch;
 elsif j.payload_json#>>'{data_json,kind}'='employee_message'
  and (j.payload_json#>'{data_json,test_delivery}') is null
  and j.job_key='employee-message-push:'||j.source_id::text||':'||(j.payload_json->>'credential_id') then
  kind:='MESSAGE';recipient:=(j.payload_json->>'credential_id')::uuid;
  epoch:=(j.payload_json->>'assignment_epoch')::bigint;
 else return jsonb_build_object('current',false,'reason','native_alert_kind_unavailable');end if;
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=recipient for update of d0;
 select * into c from public.device_auth_credentials where credential_id=recipient for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into r from public.employee_push_registrations
  where credential_id=recipient and device_id=d.id and employee_id=d.assigned_employee_id
   and assignment_epoch=d.assignment_epoch and active is true and revoked_at is null
  order by last_seen_at desc,registration_id desc limit 1;
 select count(*) into active_count from public.employee_native_push_generations
  where credential_id=recipient and registration_id=r.registration_id
   and revoked_at is null and dispatch_retired_at is null;
 if active_count=1 then
  select * into g from public.employee_native_push_generations
   where credential_id=recipient and registration_id=r.registration_id
    and revoked_at is null and dispatch_retired_at is null for update;
 end if;
 -- Match the existing native target's device -> credential -> registration
 -- -> generation -> job lock order. Re-read the job after acquiring its lock;
 -- the preliminary recipient lookup is never itself authority.
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or j.job_id is null or j.status<>'leased'
  or j.lease_token is distinct from p_lease or j.leased_until<=at_time
  or j.job_type is distinct from (case kind when 'EVENT' then 'employee_event_push' else 'employee_native_push' end)
  or (kind='EVENT' and j.source_id is distinct from i.instance_id)
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from recipient::text
   or j.payload_json->>'assignment_epoch' is distinct from epoch::text))
  or d.id is null or d.active is not true
  or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or d.assignment_epoch is distinct from epoch or c.device_id is distinct from d.id
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or r.registration_id is null or r.platform is distinct from 'android'
  or r.token_hash is distinct from public.static_weekly_digest_text(r.fcm_token)
  or g.generation_id is null or g.registration_id is distinct from r.registration_id
  or g.device_id is distinct from d.id or g.device_identifier is distinct from d.device_id
  or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
  or g.principal_digest !~ '^[0-9a-f]{64}$' or g.token_digest is distinct from r.token_hash
  or g.activated_at>at_time or not exists(select 1 from public.employees e
   where e.id=d.assigned_employee_id and e.active and e.employee_code~'^EMP[0-9]+$')
  or (kind='EVENT' and (i.instance_id is null or i.credential_id is distinct from c.credential_id
    or i.device_id is distinct from d.id or i.employee_id is distinct from d.assigned_employee_id))
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from c.credential_id::text
    or j.payload_json->>'employee_id' is distinct from d.assigned_employee_id::text
    or j.payload_json->>'device_id' is distinct from d.id::text
    or j.payload_json->>'device_identifier' is distinct from d.device_id
    or j.payload_json->>'assignment_epoch' is distinct from d.assignment_epoch::text)) then
  return jsonb_build_object('current',false,'reason','native_alert_recipient_superseded');end if;
 return jsonb_build_object('current',true,'kind',kind,'token',r.fcm_token,
  'expected',jsonb_build_object('generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
   'token_digest',g.token_digest,'credential_id',c.credential_id::text,'employee_id',d.assigned_employee_id::text,
   'device_id',d.device_id,'device_uuid',d.id::text,'assignment_epoch',d.assignment_epoch::text,
   'registration_id',r.registration_id::text));
end $function$
$old_definition$;
 new_definition constant text:=$new_definition$CREATE OR REPLACE FUNCTION public.custodial_native_alert_target_at(p_job uuid, p_lease uuid, p_test_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare j public.operational_notification_jobs%rowtype;i public.event_push_instances%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;r public.employee_push_registrations%rowtype;
 g public.employee_native_push_generations%rowtype;at_time timestamptz;recipient uuid;epoch bigint;
 kind text;active_count integer;
begin
 perform public.custodial_begin_application_mutation();
 if p_job is null or p_lease is null then raise exception 'exact alert job lease required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if j.job_id is null or j.status<>'leased' or j.lease_token is distinct from p_lease
  or j.job_type not in ('employee_event_push','employee_native_push') then
  return jsonb_build_object('current',false,'reason','native_alert_job_superseded');end if;
 if j.job_type='employee_event_push' then
  kind:='EVENT';
  select * into i from public.event_push_instances where instance_id=j.source_id;
  recipient:=i.credential_id;epoch:=i.assignment_epoch;
 elsif j.payload_json#>>'{data_json,kind}'='employee_message'
  and (j.payload_json#>'{data_json,test_delivery}') is null
  and j.job_key='employee-message-push:'||j.source_id::text||':'||(j.payload_json->>'credential_id') then
  kind:='MESSAGE';recipient:=(j.payload_json->>'credential_id')::uuid;
  epoch:=(j.payload_json->>'assignment_epoch')::bigint;
 else return jsonb_build_object('current',false,'reason','native_alert_kind_unavailable');end if;
 select d0.* into d from public.devices d0 join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=recipient for update of d0;
 select * into c from public.device_auth_credentials where credential_id=recipient for update;
 perform 1 from public.employees where id=d.assigned_employee_id for share;
 perform 1 from public.employee_push_registrations where device_id=d.id order by registration_id for update;
 select * into r from public.employee_push_registrations
  where credential_id=recipient and device_id=d.id and employee_id=d.assigned_employee_id
   and assignment_epoch=d.assignment_epoch and active is true and revoked_at is null
  order by last_seen_at desc,registration_id desc limit 1;
 select count(*) into active_count from public.employee_native_push_generations
  where credential_id=recipient and registration_id=r.registration_id
   and revoked_at is null and dispatch_retired_at is null;
 if active_count=1 then
  select * into g from public.employee_native_push_generations
   where credential_id=recipient and registration_id=r.registration_id
    and revoked_at is null and dispatch_retired_at is null for update;
 end if;
 -- Match the existing native target's device -> credential -> registration
 -- -> generation -> job lock order. Re-read the job after acquiring its lock;
 -- the preliminary recipient lookup is never itself authority.
 select * into j from public.operational_notification_jobs where job_id=p_job for update;
 at_time:=coalesce(p_test_at,clock_timestamp());
 if not isfinite(at_time) or j.job_id is null or j.status<>'leased'
  or j.lease_token is distinct from p_lease or j.leased_until<=at_time
  or j.job_type is distinct from (case kind when 'EVENT' then 'employee_event_push' else 'employee_native_push' end)
  or (kind='EVENT' and j.source_id is distinct from i.instance_id)
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from recipient::text
   or j.payload_json->>'assignment_epoch' is distinct from epoch::text))
  or d.id is null or d.active is not true
  or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or d.assignment_epoch is distinct from epoch or c.device_id is distinct from d.id
  or c.confirmed_at is null or c.revoked_at is not null or c.expires_at<=at_time
  or r.registration_id is null or r.platform is distinct from 'android'
  or r.token_hash is distinct from public.static_weekly_digest_text(r.fcm_token)
  or not exists(select 1 from public.employees e
   where e.id=d.assigned_employee_id and e.active and e.employee_code~'^EMP[0-9]+$')
  or (kind='EVENT' and (i.instance_id is null or i.credential_id is distinct from c.credential_id
    or i.device_id is distinct from d.id or i.employee_id is distinct from d.assigned_employee_id))
  or (kind='MESSAGE' and (j.payload_json->>'credential_id' is distinct from c.credential_id::text
    or j.payload_json->>'employee_id' is distinct from d.assigned_employee_id::text
    or j.payload_json->>'device_id' is distinct from d.id::text
    or j.payload_json->>'device_identifier' is distinct from d.device_id
    or j.payload_json->>'assignment_epoch' is distinct from d.assignment_epoch::text)) then
  return jsonb_build_object('current',false,'reason','native_alert_recipient_superseded');end if;
 -- A current phone may be waiting for its first native generation.
 -- This returns no token/expected tuple and cannot authorize preparation/send.
 if active_count=0 then
  return jsonb_build_object('current',false,'reason','native_alert_generation_pending');end if;
 if active_count<>1
  or g.generation_id is null or g.registration_id is distinct from r.registration_id
  or g.device_id is distinct from d.id or g.device_identifier is distinct from d.device_id
  or g.employee_id is distinct from d.assigned_employee_id or g.assignment_epoch is distinct from d.assignment_epoch
  or g.principal_digest !~ '^[0-9a-f]{64}$' or g.token_digest is distinct from r.token_hash
  or g.activated_at>at_time then
  return jsonb_build_object('current',false,'reason','native_alert_recipient_superseded');end if;
 return jsonb_build_object('current',true,'kind',kind,'token',r.fcm_token,
  'expected',jsonb_build_object('generation_id',g.generation_id::text,'principal_digest',g.principal_digest,
   'token_digest',g.token_digest,'credential_id',c.credential_id::text,'employee_id',d.assigned_employee_id::text,
   'device_id',d.device_id,'device_uuid',d.id::text,'assignment_epoch',d.assignment_epoch::text,
   'registration_id',r.registration_id::text));
end $function$
$new_definition$;
 actual text;guard_definition text;changed integer;before_metadata jsonb;after_metadata jsonb;
 before_trigger jsonb;after_trigger jsonb;before_triggers jsonb;after_triggers jsonb;saved public.custodial_release_authority_restore_inventory%ROWTYPE;
BEGIN
 PERFORM set_config('lock_timeout','5s',true);PERFORM set_config('statement_timeout','30s',true);
 LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO before_triggers FROM pg_trigger t
  WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass;
 IF public.static_weekly_digest_text(old_definition) IS DISTINCT FROM 'd9a688f1cbac206f44f6315ebe6d67d901db8c7373624bbe52cd53ca45952802'
  OR public.static_weekly_digest_text(new_definition) IS DISTINCT FROM 'c80474e9e13c59fe68b125a1e4bd6affbe78a19550037cf3e3d237b565daa8f7'
 THEN RAISE EXCEPTION 'Native alert pending source constants differ';END IF;
 SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' INTO STRICT actual,before_metadata FROM pg_proc p WHERE p.oid=target;
 IF actual IS DISTINCT FROM old_definition OR pg_get_userbyid((before_metadata->>'proowner')::oid)<>'postgres'
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid=target AND a.grantee<>p.proowner AND a.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION 'Native alert exact private predecessor/security differs';END IF;
 SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='function' AND object_identity=identity;
 IF saved.restore_order<>100495 OR saved.definition_sql IS DISTINCT FROM old_definition
  OR saved.definition_sha256 IS DISTINCT FROM 'd9a688f1cbac206f44f6315ebe6d67d901db8c7373624bbe52cd53ca45952802'
 THEN RAISE EXCEPTION 'Native alert retained predecessor differs';END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_reject_release_authority_inventory_mutation()'::regprocedure))
  IS DISTINCT FROM '7904db6a14a4c8d2b93cbe4d53ba34f68052e736d15f0a55323fa04c1fae76f6'
 THEN RAISE EXCEPTION 'Native alert inventory mutation guard differs';END IF;
 SELECT to_jsonb(t),'drop trigger if exists '||quote_ident(t.tgname)||' on public.custodial_release_authority_restore_inventory; '
  ||pg_get_triggerdef(t.oid,true)||'; alter table public.custodial_release_authority_restore_inventory enable always trigger '
  ||quote_ident(t.tgname)||';' INTO STRICT before_trigger,guard_definition
  FROM pg_trigger t WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable' AND NOT t.tgisinternal AND t.tgenabled='A'
   AND t.tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure;
 IF public.static_weekly_digest_text(guard_definition) IS DISTINCT FROM 'b3ab6991571f3d233ec13116b59229d4c06f8a5a0205cb097949a5335d3172b8'
 THEN RAISE EXCEPTION 'Native alert exact ALWAYS guard differs';END IF;
 CREATE TEMP TABLE native_alert_pending_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
 EXECUTE new_definition;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata OR pg_get_functiondef(target) IS DISTINCT FROM new_definition
 THEN RAISE EXCEPTION 'Native alert owner/ACL/attributes changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory
  SET definition_sql=new_definition,definition_sha256=public.static_weekly_digest_text(new_definition),captured_at=statement_timestamp()
  WHERE inventory_id=saved.inventory_id AND object_kind='function' AND object_identity=identity
   AND restore_order=saved.restore_order AND definition_sql=old_definition AND definition_sha256=saved.definition_sha256;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Native alert restore update scope differs';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 SELECT to_jsonb(t) INTO STRICT after_trigger FROM pg_trigger t
  WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND t.tgname='trg_custodial_release_authority_restore_inventory_immutable';
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO after_triggers FROM pg_trigger t
  WHERE t.tgrelid='public.custodial_release_authority_restore_inventory'::regclass;
 IF after_trigger IS DISTINCT FROM before_trigger OR after_triggers IS DISTINCT FROM before_triggers
 THEN RAISE EXCEPTION 'Native alert inventory guard changed';END IF;
 IF EXISTS((SELECT * FROM public.custodial_release_authority_restore_inventory WHERE inventory_id<>saved.inventory_id
    EXCEPT SELECT * FROM native_alert_pending_before WHERE inventory_id<>saved.inventory_id)
   UNION ALL (SELECT * FROM native_alert_pending_before WHERE inventory_id<>saved.inventory_id
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory WHERE inventory_id<>saved.inventory_id))
  OR (SELECT to_jsonb(i)-'definition_sql'-'definition_sha256'-'captured_at' FROM public.custodial_release_authority_restore_inventory i
    WHERE inventory_id=saved.inventory_id) IS DISTINCT FROM (to_jsonb(saved)-'definition_sql'-'definition_sha256'-'captured_at')
  OR (SELECT definition_sql=new_definition AND definition_sha256=public.static_weekly_digest_text(new_definition)
    FROM public.custodial_release_authority_restore_inventory WHERE inventory_id=saved.inventory_id) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Native alert unrelated restoration inventory changed';END IF;
END $native_alert_initial_generation$;
