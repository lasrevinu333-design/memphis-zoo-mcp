-- Notification integration F05/F07/F08. Forward-only, no Data API exposure.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- This is the existing dedicated server-side SQL reader, NOT a Data API role.
grant execute on function public.mz_location_reminder_candidates(date,timestamptz)
 to custodial_application_reader;

-- This table already has server-reader SELECT but FORCE RLS has no reader
-- policy. Without this exact bound-ACK read, valid employee acknowledgements
-- silently disappear from the reminder route. No client role or write access.
create policy custodial_reader_bound_notification_ack
 on public.device_notification_acknowledgements for select
 to custodial_application_reader
 using (credential_id is not null and assignment_epoch is not null
   and employee_id is not null and notification_job_id is not null
   and acknowledged_at is not null
   and notification_type in ('location_status','lunch_coverage'));
-- The existing dashboard view executes these read-only dependencies as its
-- caller. Preserve INVOKER behavior; do not elevate the view/functions.
grant execute on function public.operational_day_start(timestamptz),
 public.get_setting_int(text,integer),public.mz_latest_verified_check(uuid,timestamptz,timestamptz)
 to custodial_application_reader;

do $patch$
declare definition text;patch record;signature text;
begin
 foreach signature in array array[
  'public.mz_enqueue_employee_location_pushes(timestamptz)',
  'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
  'public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  for patch in select * from (values
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$  perform pg_advisory_xact_lock(hashtext('custodial-reminder-cycles'),hashtext(v_service_date::text));$$,
    $$  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  perform pg_advisory_xact_lock(hashtext('custodial-reminder-cycles'),hashtext(v_service_date::text));$$),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$      and acknowledgement.notification_key = candidate.notification_key$$,
    $$      and acknowledgement.notification_key = candidate.notification_key
      and acknowledgement.credential_id = candidate.credential_id
      and acknowledgement.assignment_epoch = candidate.assignment_epoch
      and acknowledgement.employee_id = candidate.employee_id$$),
   ('public.mz_enqueue_employee_location_pushes(timestamptz)',
    $$            and acknowledgement.notification_key = job.payload_json->'data_json'->>'notification_key'$$,
    $$            and acknowledgement.notification_key = job.payload_json->'data_json'->>'notification_key'
            and acknowledgement.credential_id::text = job.payload_json->>'credential_id'
            and acknowledgement.assignment_epoch::text = job.payload_json->>'assignment_epoch'
            and acknowledgement.employee_id::text = job.payload_json->>'employee_id'$$),
   ('public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
    $$ ) into v_current;$$,
    $$     and not exists (
       select 1 from public.device_notification_acknowledgements acknowledgement
       where upper(btrim(acknowledgement.device_identifier))=upper(btrim(j.payload_json->>'device_identifier'))
         and acknowledgement.notification_key=j.payload_json#>>'{data_json,notification_key}'
         and acknowledgement.credential_id::text=j.payload_json->>'credential_id'
         and acknowledgement.assignment_epoch::text=j.payload_json->>'assignment_epoch'
         and acknowledgement.employee_id::text=j.payload_json->>'employee_id'
         and acknowledgement.acknowledged_at is not null
     )
 ) into v_current;$$),
   ('public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)',
    $$  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);$$,
    $$  -- Same schedule lock as publication, before registration/job row locks.
  -- A publication that wins before preparation must be seen by the validator.
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);$$),
   ('public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)',
    $$  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id for update;$$,
    $$  -- Recheck in THIS transaction, not only the earlier worker RPC. The job
  -- row lock also serializes exact native ACK admission against preparation.
  if v_job.payload_json#>>'{data_json,kind}'='employee_location_status'
     and coalesce(v_job.payload_json#>>'{data_json,test_delivery}','false')='false' then
    v_delivery:=public.mz_validate_employee_location_reminder(p_job_id,p_lease_token,p_now);
    if coalesce((v_delivery->>'current')::boolean,false) is not true then
      return jsonb_build_object('current',false,'dispatch_authorized',false,
        'reason',coalesce(v_delivery->>'reason','location_reminder_superseded'));
    end if;
  end if;
  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id for update;$$)
  ) changes(owner_signature,old_text,new_text) where owner_signature=signature loop
   if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then
    raise exception 'notification admission predecessor seam changed: %',signature;
   end if;
   definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
 end loop;
end $patch$;

-- The two previously uncaptured read helpers must be recoverable too.
do $surface$
declare definition text;
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,'  values',''))<>length('  values') then
  raise exception 'notification read dependency canary seam changed';end if;
 execute replace(definition,'  values',$v$  values
    ('function','operational_day_start(timestamp with time zone)','dashboard operational-day read dependency'),
    ('function','get_setting_int(text,integer)','dashboard integer-setting read dependency'),$v$);
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare signature text;kind text;definition text;changed int;bucket int;next_order int;
begin
 foreach signature in array array[
  'public.mz_location_reminder_candidates(date,timestamptz)',
  'public.operational_day_start(timestamptz)',
  'public.get_setting_int(text,integer)',
  'public.mz_latest_verified_check(uuid,timestamptz,timestamptz)',
  'public.custodial_release_canary_authority_surface()',
  'public.mz_enqueue_employee_location_pushes(timestamptz)',
  'public.mz_validate_employee_location_reminder(uuid,uuid,timestamptz)',
  'public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz)'
 ] loop
  foreach kind in array array['function','grant'] loop
   definition:=case when kind='function' then pg_get_functiondef(signature::regprocedure)
    else public.custodial_release_authority_current_grant_definition((signature::regprocedure)::text) end;
   if definition is null then raise exception 'missing notification recovery definition: %',signature;end if;
   update public.custodial_release_authority_restore_inventory set definition_sql=definition,
    definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
    where object_kind=kind and object_identity like '%(%' and to_regprocedure(object_identity)=signature::regprocedure;
   get diagnostics changed=row_count;
   if changed=0 and signature in ('public.operational_day_start(timestamptz)','public.get_setting_int(text,integer)') then
    bucket:=case when kind='function' then 100000 else 900000 end;
    select coalesce(max(restore_order),bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
     where restore_order>=bucket and restore_order<bucket+100000;
    insert into public.custodial_release_authority_restore_inventory
     (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
     values(next_order,kind,(signature::regprocedure)::text,definition,public.static_weekly_digest_text(definition));
   elsif changed<>1 then raise exception 'expected one notification recovery %: %',kind,signature;end if;
  end loop;
  -- The inventory enumerator retains its pre-existing private ACL; it is not
  -- a service RPC and this migration does not grant it to runtime callers.
  if signature<>'public.custodial_release_canary_authority_surface()' and
   (has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
   or not has_function_privilege('service_role',signature,'EXECUTE')) then
   raise exception 'notification minimum privileges changed: %',signature;
  end if;
 end loop;
end $recovery$;
do $policy_recovery$
declare identity text:='public.device_notification_acknowledgements:custodial_reader_bound_notification_ack';
 definition text;next_order integer;
begin
 definition:=public.custodial_release_authority_current_policy_definition(identity);
 if definition is null then raise exception 'bound notification reader policy recovery missing';end if;
 select coalesce(max(restore_order),800000)+1 into next_order
  from public.custodial_release_authority_restore_inventory where object_kind='policy';
 insert into public.custodial_release_authority_restore_inventory
  (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 values(next_order,'policy',identity,definition,public.static_weekly_digest_text(definition));
end $policy_recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
