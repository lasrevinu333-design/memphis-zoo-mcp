-- Main normal CLI-generated EMPTY 20261012052430; isolated source264 only.
-- Exact Bfefc135/tree054d + immutable Mail263 02e4e303/e98bf16e prerequisite.
-- Existing RPC signature/composite result/owner/ACL; no new grants or tables.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE event_open_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE event_open_function_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,proconfig,prolang,provolatile,proparallel,prosecdef,prorettype,prosrc,
  pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.mz_mark_employee_event_opened(uuid,text)'::regprocedure;
CREATE TEMP TABLE event_open_surface_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,proconfig,prolang,provolatile,proparallel,prosecdef,prorettype,
  pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;

DO $open$
DECLARE target regprocedure:='public.mz_mark_employee_event_opened(uuid,text)'::regprocedure;
 before text;after text;
 old_body constant text:=$old_body$
declare v_result public.event_push_instances%rowtype;
begin
  update public.event_push_instances i
     set state='opened',opened_at=coalesce(opened_at,now()),updated_at=now()
   where i.notification_key=p_notification_key and i.credential_id=p_credential_id
     and i.state in ('sent','opened')
  returning * into v_result;
  if v_result.instance_id is null then
    raise exception using errcode='P0002',message='Notification was not found for this device credential.';
  end if;
  return v_result;
end
$old_body$;
 new_body constant text:=$new_body$
declare original public.event_push_instances%rowtype;
 d public.devices%rowtype;c public.device_auth_credentials%rowtype;
 employee public.employees%rowtype;e public.events_app_events%rowtype;
 at_time timestamptz;place jsonb;
begin
 if p_credential_id is null or p_notification_key is null
  or octet_length(convert_to(p_notification_key,'UTF8')) not between 1 and 240
  or p_notification_key<>btrim(p_notification_key)
  or p_notification_key ~ '[[:cntrl:]]' then
  raise exception using errcode='22023',message='An exact bounded notification key is required';
 end if;
 -- Same authority order as current native/provider and roster mutations.
 -- Lookup does not adopt anything: original is reread and checked after locks.
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select d0.* into d from public.devices d0
  join public.device_auth_credentials c0 on c0.device_id=d0.id
  where c0.credential_id=p_credential_id for share of d0;
 select * into c from public.device_auth_credentials
  where credential_id=p_credential_id for share;
 select * into employee from public.employees where id=d.assigned_employee_id for share;
 select * into original from public.event_push_instances
  where notification_key=p_notification_key and credential_id=p_credential_id;
 select * into e from public.events_app_events where id=original.event_id for share;
 select * into original from public.event_push_instances
  where notification_key=p_notification_key and credential_id=p_credential_id for update;
 at_time:=clock_timestamp();
 if d.id is null or d.active is not true or d.device_id !~ '^KIOSK_(0[2-9]|10)$'
  or c.credential_id is distinct from p_credential_id or c.device_id is distinct from d.id
  or c.confirmed_at is null or c.revoked_at is not null
  or c.expires_at is null or not isfinite(c.expires_at) or c.expires_at<=at_time
  or employee.id is null or employee.active is not true or employee.employee_code !~ '^EMP[0-9]+$'
  or d.assigned_employee_id is distinct from employee.id
  or original.instance_id is null or original.credential_id is distinct from c.credential_id
  or original.employee_id is distinct from employee.id or original.device_id is distinct from d.id
  or original.assignment_epoch is distinct from d.assignment_epoch
  or original.assignment_epoch not between 1 and 9007199254740991
  or original.state not in ('sent','opened') or original.cancelled_at is not null
  or original.provider_message_id is null or original.sent_at is null
  or not isfinite(original.sent_at) or original.sent_at>at_time
  or (original.state='sent' and original.opened_at is not null)
  or (original.state='opened' and (original.opened_at is null
    or not isfinite(original.opened_at) or original.opened_at<original.sent_at or original.opened_at>at_time))
 then raise exception using errcode='42501',message='Original Event recipient is unavailable or no longer current';end if;
 -- Existing owning event/schedule/place guards, not copied parser/source facts.
 -- Held/review/withdrawn/revised/expired occurrences cannot become an open.
 if e.id is distinct from original.event_id or e.revision is distinct from original.event_revision
  or e.status is distinct from 'SCHEDULED' or coalesce(e.needs_review,false)
  or e.event_scope is null or e.event_scope='UNKNOWN'
  or e.cancelled_at is not null or e.archived_at is not null
  or e.start_instant_utc is null or e.end_instant_utc is null
  or not isfinite(e.start_instant_utc) or not isfinite(e.end_instant_utc)
  or e.start_instant_utc<=at_time or e.end_instant_utc<=e.start_instant_utc
  or original.notification_kind not in ('three_days_before','two_days_before','shift_plus_15')
  or (select count(*) from public.mz_event_reminder_schedule(
    e.id,e.revision,original.employee_id,original.notification_kind) s
    where s.reminder_date=original.service_date and s.scheduled_for=original.scheduled_for)<>1
 then raise exception using errcode='42501',message='Original Event occurrence is withheld or no longer current';end if;
 place:=public.app_event_place_authority(to_jsonb(e),at_time);
 if (place->>'admissible')::boolean is not true then
  raise exception using errcode='42501',message='Original Event Place is withheld';end if;
 -- Idempotent repetition preserves original opened_at and every original pin.
 if original.state='opened' then return original;end if;
 update public.event_push_instances set state='opened',opened_at=at_time,updated_at=at_time
  where instance_id=original.instance_id and notification_key=p_notification_key
   and credential_id=c.credential_id and employee_id=employee.id and device_id=d.id
   and assignment_epoch=d.assignment_epoch and state='sent' and opened_at is null
  returning * into original;
 if not found then raise exception using errcode='40001',message='Original Event open conflicted';end if;
 return original;
end
$new_body$;
BEGIN
 SELECT definition INTO STRICT before FROM event_open_function_before;
 IF (SELECT prosrc FROM event_open_function_before) IS DISTINCT FROM old_body
  OR public.static_weekly_digest_text(old_body) IS DISTINCT FROM 'f36ca009247ef497576b1c0d9aa4e21cf5b23bdb55378e9b17d44f43119336ec'
  OR octet_length(convert_to(old_body,'UTF8'))<>507
  OR (length(before)-length(replace(before,old_body,'')))/length(old_body)<>1
  OR EXISTS(SELECT 1 FROM event_open_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (SELECT count(*) FROM event_open_inventory_before WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=before AND definition_sha256=public.static_weekly_digest_text(before))<>1
  OR (SELECT count(*) FROM event_open_inventory_before WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>1
  OR NOT has_function_privilege('service_role',target,'EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=target AND a.grantee<>p.proowner
     AND (r.rolname IS NULL OR r.rolname NOT IN('postgres','service_role') OR a.is_grantable OR a.privilege_type<>'EXECUTE'))
  OR EXISTS(SELECT 1 FROM event_open_function_before p WHERE p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
    OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.provolatile<>'v'
    OR p.proparallel<>'u' OR p.prosecdef IS NOT TRUE OR p.prorettype<>'public.event_push_instances'::regtype)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Event open exact original source/ACL/recovery predecessor changed';END IF;
 after:=replace(before,old_body,new_body);EXECUTE after;
 IF pg_get_functiondef(target) IS DISTINCT FROM after
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN event_open_function_before old ON old.oid=p.oid
    WHERE ROW(p.proowner,p.proacl,p.proconfig,p.prolang,p.provolatile,p.proparallel,p.prosecdef,p.prorettype)
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,old.prosecdef,old.prorettype))
 THEN RAISE EXCEPTION 'Event open owner/ACL/attributes changed';END IF;
END $open$;

-- Source U4 captures mz_mark's function+grant, but no source through263
-- declares it in the independent canary surface. Register ONLY that exact pair.
DO $surface$
DECLARE target regprocedure:='public.mz_mark_employee_event_opened(uuid,text)'::regprocedure;
 canary regprocedure:='public.custodial_release_canary_authority_surface()'::regprocedure;
 before text;after text;
BEGIN
 SELECT definition INTO STRICT before FROM event_open_surface_before;
 IF (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN('function','grant')
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>0
  OR (SELECT count(*) FROM event_open_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)=canary AND definition_sql=before AND definition_sha256=public.static_weekly_digest_text(before))<>1
  OR (length(before)-length(replace(before,'  values','')))/length('  values')<>1
 THEN RAISE EXCEPTION 'Event open exact canary registration predecessor changed';END IF;
 after:=replace(before,'  values','  values'||E'\n'
  ||'(''function'',''public.mz_mark_employee_event_opened(uuid,text)'',''exact original employee Event open authority''),'
  ||E'\n'||'(''grant'',''public.mz_mark_employee_event_opened(uuid,text)'',''unchanged server-only original Event open ACL''),');
 EXECUTE after;
 IF pg_get_functiondef(canary) IS DISTINCT FROM after
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN event_open_surface_before old ON old.oid=p.oid
    WHERE ROW(p.proowner,p.proacl,p.proconfig,p.prolang,p.provolatile,p.proparallel,p.prosecdef,p.prorettype)
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.prolang,old.provolatile,old.proparallel,old.prosecdef,old.prorettype))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
    AND object_identity='public.mz_mark_employee_event_opened(uuid,text)')<>1
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
    AND object_identity='public.mz_mark_employee_event_opened(uuid,text)')<>1
 THEN RAISE EXCEPTION 'Event open canary extension changed';END IF;
END $surface$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE target regprocedure;changed integer;BEGIN
 FOREACH target IN ARRAY ARRAY['public.mz_mark_employee_event_opened(uuid,text)'::regprocedure,
  'public.custodial_release_canary_authority_surface()'::regprocedure] LOOP
  UPDATE public.custodial_release_authority_restore_inventory i SET definition_sql=pg_get_functiondef(target),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(target)),captured_at=statement_timestamp()
   WHERE i.object_kind='function' AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
    AND i.definition_sql=(SELECT old.definition_sql FROM event_open_inventory_before old WHERE old.inventory_id=i.inventory_id)
    AND i.definition_sha256=public.static_weekly_digest_text(i.definition_sql);
  GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Event open exact recovery function row changed';END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM event_open_inventory_before)
  OR EXISTS(SELECT old.* FROM event_open_inventory_before old WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
    AND to_regprocedure(old.object_identity) IN('public.mz_mark_employee_event_opened(uuid,text)'::regprocedure,
     'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(now.object_kind='function' AND now.object_identity LIKE '%(%'
    AND to_regprocedure(now.object_identity) IN('public.mz_mark_employee_event_opened(uuid,text)'::regprocedure,
     'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM event_open_inventory_before)
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant'
    AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity) IN('public.mz_mark_employee_event_opened(uuid,text)'::regprocedure,
     'public.custodial_release_canary_authority_surface()'::regprocedure)
    AND i.definition_sql IS DISTINCT FROM public.custodial_release_authority_current_grant_definition(i.object_identity))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN('function','grant')
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.mz_mark_employee_event_opened(uuid,text)'::regprocedure)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Event open unrelated inventory/ACL or final ALWAYS guard changed';END IF;
END $scope$;
COMMIT;
