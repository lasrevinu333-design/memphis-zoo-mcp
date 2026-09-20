-- D7/B-006: approved reminder dates and current-owner checks. Draft only, not deployed.
ALTER TABLE public.event_push_instances DROP CONSTRAINT event_push_instances_notification_kind_check;
ALTER TABLE public.event_push_instances ADD CONSTRAINT event_push_instances_notification_kind_check
 CHECK(notification_kind IN ('day_before','shift_plus_15','three_days_before','two_days_before'));
-- Shared current-owner and reminder-day eligibility; historical entries remain intact.
CREATE OR REPLACE FUNCTION public.mz_event_reminder_schedule(
 p_event_id uuid,p_event_revision integer,p_employee_id uuid,p_notification_kind text)
RETURNS TABLE(reminder_date date,scheduled_for timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
 SELECT e.event_date-o.days_before,
   (((e.event_date-o.days_before)+r.shift_start) AT TIME ZONE 'America/Chicago') + interval '15 minutes'
 FROM public.events_app_events e
 JOIN public.employees emp ON emp.id=p_employee_id AND emp.active=true
 CROSS JOIN (VALUES('three_days_before',3),('two_days_before',2),('shift_plus_15',0)) o(kind,days_before)
 JOIN public.daily_work_roster r ON r.employee_id=emp.id AND r.service_date=e.event_date-o.days_before AND r.active=true
 WHERE e.id=p_event_id AND e.revision=p_event_revision AND e.status='SCHEDULED'
  AND e.archived_at IS NULL AND e.cancelled_at IS NULL AND o.kind=p_notification_kind
  AND EXISTS(SELECT 1 FROM public.daily_work_roster er WHERE er.employee_id=emp.id AND er.service_date=e.event_date AND er.active=true)
  AND ((e.audience_scope='specific_employees' AND emp.id=ANY(e.audience_employee_ids))
   OR e.audience_scope='all_working_employees'
   OR (e.audience_scope='assigned_location' AND EXISTS(
    SELECT 1 FROM public.daily_group_assignments ga WHERE ga.assignment_date=e.event_date
     AND ga.location_group_id=e.location_group_id AND ga.assigned_employee_id=emp.id
     AND ga.active=true AND ga.is_coverall=false)))
$$;
REVOKE ALL ON FUNCTION public.mz_event_reminder_schedule(uuid,integer,uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mz_event_reminder_schedule(uuid,integer,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_event_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_inserted integer:=0;
begin
  with recipients as (
    select distinct
      e.id event_id,e.revision event_revision,e.event_date service_date,
      emp.id employee_id,d.id device_id,d.assignment_epoch,c.credential_id,
      e.event_name,e.display_location,r.shift_start
    from public.events_app_events e
    join public.employees emp on emp.active=true and (
      (e.audience_scope='specific_employees' and emp.id=any(e.audience_employee_ids))
      or (e.audience_scope='all_working_employees' and exists (
        select 1 from public.daily_work_roster rw
        where rw.service_date=e.event_date and rw.employee_id=emp.id and rw.active=true
      ))
      or (e.audience_scope='assigned_location' and exists (
        select 1 from public.daily_group_assignments ga
        where ga.assignment_date=e.event_date and ga.location_group_id=e.location_group_id
          and ga.assigned_employee_id=emp.id and ga.active=true and ga.is_coverall=false
      ))
    )
    join public.daily_work_roster r
      on r.service_date=e.event_date and r.employee_id=emp.id and r.active=true
    join public.devices d
      on d.assigned_employee_id=emp.id and d.active=true
    join public.device_auth_credentials c
      on c.device_id=d.id and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>p_now
    join public.employee_push_registrations pr
      on pr.device_id=d.id and pr.credential_id=c.credential_id and pr.employee_id=emp.id
     and pr.assignment_epoch=d.assignment_epoch and pr.active=true and pr.revoked_at is null
    where e.status='SCHEDULED' and e.archived_at is null and e.cancelled_at is null
      and e.event_date between ((p_now at time zone 'America/Chicago')::date - 1)
                           and ((p_now at time zone 'America/Chicago')::date + 60)
  ), reminders as (
    select recipients.*,k.kind notification_kind,s.scheduled_for
    from recipients
    cross join (values('three_days_before'::text),('two_days_before'::text),('shift_plus_15'::text)) k(kind)
    cross join lateral public.mz_event_reminder_schedule(event_id,event_revision,employee_id,k.kind) s
    where s.reminder_date >= (p_now at time zone 'America/Chicago')::date
  ), inserted as (
    insert into public.event_push_instances(
      notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,
      assignment_epoch,notification_kind,scheduled_for
    )
    select
      'event:'||event_id||':'||event_revision||':'||service_date||':'||employee_id||':'||device_id||':'||assignment_epoch||':'||notification_kind,
      event_id,event_revision,service_date,employee_id,device_id,credential_id,
      assignment_epoch,notification_kind,scheduled_for
    from reminders
    on conflict(event_id,event_revision,service_date,employee_id,device_id,assignment_epoch,notification_kind)
    do update set scheduled_for=excluded.scheduled_for,state='pending',cancelled_at=null,
      last_error=null,updated_at=p_now
    where event_push_instances.dispatch_started_at is null and event_push_instances.provider_message_id is null
      and (event_push_instances.state='pending' or (event_push_instances.state='cancelled'
        and event_push_instances.last_error='event_or_assignment_superseded'))
    returning *
  )
  insert into public.operational_notification_jobs(job_key,job_type,source_id,available_at,payload_json)
  select
    'employee-event-push:'||i.notification_key,
    'employee_event_push',
    i.instance_id,
    i.scheduled_for,
    jsonb_build_object(
      'instance_id',i.instance_id,'notification_key',i.notification_key,'event_id',i.event_id,
      'employee_id',i.employee_id,'device_id',i.device_id,'credential_id',i.credential_id,
      'assignment_epoch',i.assignment_epoch,'notification_kind',i.notification_kind
    )
  from inserted i
  on conflict(job_key) do update set available_at=excluded.available_at,status='pending',
    completed_at=null,last_error=null,updated_at=p_now
    where operational_notification_jobs.status='pending' or (operational_notification_jobs.status='dead'
      and operational_notification_jobs.last_error='event_or_assignment_superseded');
  get diagnostics v_inserted=row_count;

  update public.event_push_instances i
     set state='cancelled',cancelled_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
   where i.state in ('pending','leased') and not exists (
     select 1 from public.events_app_events e
     join public.devices d on d.id=i.device_id
     join public.device_auth_credentials c on c.credential_id=i.credential_id
     join public.employee_push_registrations pr
       on pr.credential_id=i.credential_id and pr.assignment_epoch=i.assignment_epoch
      and pr.employee_id=i.employee_id and pr.active=true and pr.revoked_at is null
     where e.id=i.event_id and e.revision=i.event_revision and e.status='SCHEDULED'
       and e.cancelled_at is null and d.active=true and d.assigned_employee_id=i.employee_id
       and d.assignment_epoch=i.assignment_epoch and c.revoked_at is null and c.expires_at>p_now
       and exists(select 1 from public.mz_event_reminder_schedule(e.id,e.revision,i.employee_id,i.notification_kind) s
         where s.scheduled_for=i.scheduled_for)
   );

  update public.operational_notification_jobs j
     set status='dead',completed_at=now(),last_error='event_or_assignment_superseded',updated_at=now()
   where j.job_type='employee_event_push' and j.status in ('pending','leased')
     and exists (
       select 1 from public.event_push_instances i
       where i.instance_id=j.source_id and i.state='cancelled'
     );

  return jsonb_build_object('ok',true,'enqueued',v_inserted,'checked_at',p_now);
end
$function$
;

CREATE OR REPLACE FUNCTION public.mz_claim_employee_event_push_delivery(p_job_id uuid, p_lease_token uuid, p_instance_id uuid, p_credential_id uuid, p_assignment_epoch bigint, p_registration_id uuid, p_token_hash text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_instance public.event_push_instances%rowtype; v_event public.events_app_events%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null or p_credential_id is null
     or p_assignment_epoch is null or p_assignment_epoch<1 or p_registration_id is null
     or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='exact event job, lease, recipient, and token generation are required';
  end if;
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);
  if coalesce((v_delivery->>'ok')::boolean,false) is not true then return v_delivery; end if;
  if (v_delivery#>>'{registration,registration_id}')::uuid is distinct from p_registration_id
     or v_delivery#>>'{registration,token_hash}' is distinct from p_token_hash then
    return jsonb_build_object('ok',false,'terminal',true,'reason','push_registration_superseded');
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_instance.instance_id is not null then
    select * into v_event from public.events_app_events where id=v_instance.event_id for share;
  end if;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id for update;
  if v_job.job_id is not null and v_job.job_type='employee_event_push' and v_job.source_id=p_instance_id
     and v_job.status='leased' and v_job.lease_token is not distinct from p_lease_token
     and v_job.leased_until>statement_timestamp() and v_instance.state='sent'
     and v_instance.credential_id=p_credential_id and v_instance.assignment_epoch=p_assignment_epoch
     and v_instance.provider_message_id is not null and v_event.id is not null
     and v_event.revision=v_instance.event_revision then
    return jsonb_build_object('ok',true,'terminal',false,'dispatch_authorized',false,'already_recorded',true,
      'instance_id',p_instance_id,'state','sent','provider_message_id',v_instance.provider_message_id);
  end if;
  v_reason:=case
    when v_job.job_id is null then 'employee_event_push_job_missing'
    when v_job.job_type<>'employee_event_push' or v_job.source_id<>p_instance_id then 'employee_event_push_job_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_event_push_lease_superseded'
    when v_instance.instance_id is null then 'event_push_instance_missing'
    when v_instance.credential_id<>p_credential_id or v_instance.assignment_epoch<>p_assignment_epoch then 'event_push_recipient_superseded'
    when not exists(select 1 from public.mz_event_reminder_schedule(v_instance.event_id,v_instance.event_revision,v_instance.employee_id,v_instance.notification_kind) s
      where s.scheduled_for=v_instance.scheduled_for) then 'event_owner_or_schedule_superseded'
    when v_instance.scheduled_for>p_now then 'event_push_not_due'
    when v_instance.state='leased' and v_instance.dispatch_job_id=p_job_id
      and v_instance.dispatch_lease_token=p_lease_token and v_instance.dispatch_registration_id=p_registration_id
      and v_instance.dispatch_token_hash=p_token_hash then 'event_push_delivery_in_flight'
    when v_instance.state='leased' and v_instance.dispatch_job_id is not null then 'event_push_delivery_outcome_unknown'
    when v_instance.state not in ('pending','failed') then 'event_push_instance_'||v_instance.state
    when v_event.id is null or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
      or v_event.cancelled_at is not null or v_event.archived_at is not null then 'event_or_revision_superseded'
    when v_instance.employee_id is distinct from (v_delivery->>'employee_id')::uuid
      or v_instance.device_id is distinct from (v_delivery->>'device_id')::uuid then 'event_push_recipient_superseded'
    else null
  end;
  if v_reason is not null then
    if v_reason='event_push_not_due' then
      return jsonb_build_object('ok',false,'terminal',false,'defer_finish',true,'dispatch_authorized',false,'reason',v_reason);
    end if;
    if v_reason='event_push_delivery_in_flight' then
      return jsonb_build_object('ok',false,'terminal',false,'defer_finish',true,'dispatch_authorized',false,
        'reason',v_reason,'instance_id',p_instance_id,'state','leased');
    end if;
    update public.event_push_instances set state='cancelled',cancelled_at=coalesce(cancelled_at,p_now),
      last_error=case when v_reason='event_owner_or_schedule_superseded' then 'event_or_assignment_superseded' else v_reason end,updated_at=p_now
    where instance_id=p_instance_id and state in ('pending','leased','failed');
    return jsonb_build_object('ok',false,'terminal',true,'reason',v_reason,'instance_id',p_instance_id);
  end if;
  update public.event_push_instances set state='leased',dispatch_job_id=p_job_id,dispatch_lease_token=p_lease_token,
    dispatch_registration_id=p_registration_id,dispatch_token_hash=p_token_hash,dispatch_started_at=p_now,
    last_error=null,updated_at=p_now
  where instance_id=p_instance_id;
  return jsonb_build_object('ok',true,'terminal',false,'dispatch_authorized',true,'instance_id',p_instance_id,'state','leased');
end
$function$
;

-- Build 52 changes must remain the known-good recovery authority after deploy.
-- Rebind only the exact functions/grants changed by the three pending migrations
-- and this migration's event constraint. Do not recapture unrelated catalog drift.
-- One DO statement makes the temporary inventory-unlock and every rebind atomic.
DO $bind_build52_recovery_inventory$
DECLARE
  identity text;
  canonical text;
  definition text;
  grant_definition text;
  next_order integer;
  helper_order integer;
  changed integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      AND tgname='trg_custodial_release_authority_restore_inventory_immutable'
      AND tgenabled='O'
  ) THEN
    RAISE EXCEPTION 'Build 52 recovery inventory immutability must be enabled before rebinding';
  END IF;
  SELECT min(restore_order)-2 INTO helper_order
  FROM public.custodial_release_authority_restore_inventory
  WHERE object_kind='function' AND object_identity NOT IN (
    to_regprocedure('public.claim_operational_notification_jobs_v2(text,integer,integer,boolean)')::text,
    to_regprocedure('public.mz_event_reminder_schedule(uuid,integer,uuid,text)')::text
  );
  IF helper_order IS NULL OR helper_order<=1000 THEN
    RAISE EXCEPTION 'Build 52 recovery function ordering is unavailable';
  END IF;
  ALTER TABLE public.custodial_release_authority_restore_inventory
    DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;

  FOREACH identity IN ARRAY ARRAY[
    'public.claim_operational_notification_jobs_v2(text,integer,integer,boolean)',
    'public.mz_event_reminder_schedule(uuid,integer,uuid,text)',
    'public.app_apply_coverall_assignment_policy_v2(jsonb)',
    'public.claim_operational_notification_jobs(text,integer,integer)',
    'public.pause_guest_notification_job(uuid,uuid)',
    'public.mz_enqueue_employee_event_pushes(timestamp with time zone)',
    'public.mz_claim_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)'
  ] LOOP
    canonical:=to_regprocedure(identity)::text;
    definition:=pg_get_functiondef(to_regprocedure(identity));
    IF canonical IS NULL OR definition IS NULL THEN
      RAISE EXCEPTION 'Required Build 52 recovery function % is missing',identity;
    END IF;
    -- The new helpers must exist before the old SQL wrapper/PLpgSQL callers.
    next_order:=NULL;
    IF identity='public.claim_operational_notification_jobs_v2(text,integer,integer,boolean)' THEN
      next_order:=helper_order;
    ELSIF identity='public.mz_event_reminder_schedule(uuid,integer,uuid,text)' THEN
      next_order:=helper_order+1;
    END IF;
    UPDATE public.custodial_release_authority_restore_inventory
       SET definition_sql=definition,
           definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
           restore_order=coalesce(next_order,restore_order),captured_at=statement_timestamp()
     WHERE object_kind='function' AND object_identity=canonical;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=0 THEN
      IF next_order IS NULL THEN
        SELECT coalesce(max(restore_order),100000)+1 INTO next_order
        FROM public.custodial_release_authority_restore_inventory
        WHERE object_kind='function' AND restore_order<200000;
      END IF;
      INSERT INTO public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) VALUES(next_order,'function',canonical,definition,
        encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'));
    ELSIF changed<>1 THEN
      RAISE EXCEPTION 'Build 52 recovery function identity % is duplicated',canonical;
    END IF;

    grant_definition:=public.custodial_release_authority_current_grant_definition(canonical);
    IF grant_definition IS NULL THEN
      RAISE EXCEPTION 'Build 52 recovery grant for % is unavailable',canonical;
    END IF;
    UPDATE public.custodial_release_authority_restore_inventory
       SET definition_sql=grant_definition,
           definition_sha256=encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'),
           captured_at=statement_timestamp()
     WHERE object_kind='grant' AND object_identity=canonical;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=0 THEN
      SELECT coalesce(max(restore_order),900000)+1 INTO next_order
      FROM public.custodial_release_authority_restore_inventory;
      INSERT INTO public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) VALUES(next_order,'grant',canonical,grant_definition,
        encode(extensions.digest(convert_to(grant_definition,'UTF8'),'sha256'),'hex'));
    ELSIF changed<>1 THEN
      RAISE EXCEPTION 'Build 52 recovery grant identity % is duplicated',canonical;
    END IF;
  END LOOP;

  identity:='public.event_push_instances:event_push_instances_notification_kind_check';
  definition:=public.custodial_release_authority_current_constraint_definition(identity);
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Build 52 event reminder constraint is unavailable';
  END IF;
  UPDATE public.custodial_release_authority_restore_inventory
     SET definition_sql=definition,
         definition_sha256=encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex'),
         captured_at=statement_timestamp()
   WHERE object_kind='constraint' AND object_identity=identity;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN
    RAISE EXCEPTION 'Build 52 event reminder constraint inventory row is missing or duplicated';
  END IF;
  ALTER TABLE public.custodial_release_authority_restore_inventory
    ENABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
END
$bind_build52_recovery_inventory$;
