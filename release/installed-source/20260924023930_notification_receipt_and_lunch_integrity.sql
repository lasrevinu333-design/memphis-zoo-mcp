begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Retain legacy evidence as unbound history. Never manufacture a received or
-- acknowledged event from a display, open, timeout, or an old receipt.
alter table public.device_notification_acknowledgements
 add column received_at timestamptz,
 add column credential_id uuid,
 add column assignment_epoch bigint,
 add column employee_id uuid,
 add column notification_job_id uuid,
 add constraint device_notification_receipt_binding check (
  (credential_id is null and assignment_epoch is null and employee_id is null and notification_job_id is null)
  or (credential_id is not null and assignment_epoch is not null and assignment_epoch>0 and employee_id is not null and notification_job_id is not null)
 );
alter table public.device_notification_acknowledgements drop constraint device_notification_ack_unique;
alter table public.device_notification_acknowledgements add constraint device_notification_ack_unique
 unique nulls not distinct(device_identifier,notification_key,credential_id,assignment_epoch);

-- Existing non-native reminders retain their compatibility RPC, explicitly
-- separate from the assignment-bound native evidence added below.
create or replace function public.ack_device_notification(
 p_device_identifier text,p_notification_key text,p_notification_type text default 'notification',
 p_action text default 'dismissed',p_metadata_json jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $function$
declare v_device text;v_key text:=nullif(btrim(p_notification_key),'');v_action text:=lower(btrim(p_action));
 v_type text:=lower(btrim(p_notification_type));v_row public.device_notification_acknowledgements%rowtype;
begin
 if nullif(btrim(p_device_identifier),'') is null or length(p_device_identifier)>200
  or v_key is null or length(v_key)>500 or v_type is null or length(v_type) not between 1 and 80
  or v_action is null or v_action not in ('received','displayed','dismissed','opened','acknowledged')
  or jsonb_typeof(p_metadata_json) is distinct from 'object' then raise exception 'invalid notification receipt'; end if;
 if v_type='lunch_coverage' then raise exception 'native lunch receipt requires exact credential and assignment binding'; end if;
 select d.device_id into v_device from public.devices d where d.active
  and upper(btrim(d.device_id))=upper(btrim(p_device_identifier));
 if v_device is null then select d.device_id into v_device from public.device_aliases a
  join public.devices d on d.id=a.canonical_device_id and d.active where a.active
  and upper(btrim(a.alias_identifier))=upper(btrim(p_device_identifier)); end if;
 if v_device is null then raise exception 'active device not found'; end if;
 insert into public.device_notification_acknowledgements(device_identifier,notification_key,notification_type,
  received_at,displayed_at,dismissed_at,opened_at,acknowledged_at,metadata_json)
 values(v_device,v_key,v_type,
  case when v_action='received' then statement_timestamp() end,
  case when v_action='displayed' then statement_timestamp() end,
  case when v_action='dismissed' then statement_timestamp() end,
  case when v_action='opened' then statement_timestamp() end,
  case when v_action='acknowledged' then statement_timestamp() end,p_metadata_json)
 on conflict(device_identifier,notification_key,credential_id,assignment_epoch) do update set
  received_at=coalesce(device_notification_acknowledgements.received_at,excluded.received_at),
  displayed_at=coalesce(device_notification_acknowledgements.displayed_at,excluded.displayed_at),
  dismissed_at=coalesce(device_notification_acknowledgements.dismissed_at,excluded.dismissed_at),
  opened_at=coalesce(device_notification_acknowledgements.opened_at,excluded.opened_at),
  acknowledged_at=coalesce(device_notification_acknowledgements.acknowledged_at,excluded.acknowledged_at),
  updated_at=statement_timestamp()
 returning * into v_row;
 return to_jsonb(v_row);
end $function$;

create or replace function public.ack_native_device_notification(
 p_device_identifier text,p_credential_id uuid,p_assignment_epoch bigint,p_employee_id uuid,p_job_id uuid,
 p_notification_key text,p_notification_type text,p_action text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_device public.devices%rowtype;v_credential public.device_auth_credentials%rowtype;
 v_job public.operational_notification_jobs%rowtype;v_row public.device_notification_acknowledgements%rowtype;
begin
 if p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 or p_employee_id is null or p_job_id is null
  or nullif(btrim(p_notification_key),'') is null or length(p_notification_key)>500
  or p_notification_type is null or p_notification_type not in ('lunch_coverage','location_status')
  or p_action is null or p_action not in ('received','displayed','opened','dismissed','acknowledged') then
  raise exception 'invalid bound native notification receipt'; end if;
 select * into v_credential from public.device_auth_credentials where credential_id=p_credential_id
  and confirmed_at is not null and revoked_at is null and expires_at>statement_timestamp() for share;
 if not found then raise exception using errcode='42501',message='current confirmed credential required'; end if;
 select * into v_device from public.devices where id=v_credential.device_id and active
  and device_id=p_device_identifier and assigned_employee_id=p_employee_id and assignment_epoch=p_assignment_epoch for share;
 if not found or not exists(select 1 from public.employees where id=p_employee_id and active) then
  raise exception using errcode='42501',message='notification assignment was superseded'; end if;
 select * into v_job from public.operational_notification_jobs where job_id=p_job_id and job_type='employee_native_push' for share;
 if not found or v_job.payload_json->>'credential_id' is distinct from p_credential_id::text
  or v_job.payload_json->>'assignment_epoch' is distinct from p_assignment_epoch::text
  or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
  or v_job.payload_json->>'device_id' is distinct from v_device.id::text
  or v_job.payload_json#>>'{data_json,notification_key}' is distinct from p_notification_key
  or v_job.payload_json#>>'{data_json,kind}' is distinct from
    (case p_notification_type when 'lunch_coverage' then 'employee_lunch_coverage' else 'employee_location_status' end)
  or not exists(select 1 from public.employee_native_push_delivery_receipts r where r.job_id=p_job_id
    and r.credential_id=p_credential_id and r.assignment_epoch=p_assignment_epoch
    and r.delivery_state in ('prepared','delivered')) then
  raise exception using errcode='42501',message='notification has no exact authenticated dispatch binding'; end if;
 insert into public.device_notification_acknowledgements(device_identifier,notification_key,notification_type,
  credential_id,assignment_epoch,employee_id,notification_job_id,received_at,displayed_at,dismissed_at,opened_at,acknowledged_at,
  metadata_json)
 values(v_device.device_id,p_notification_key,p_notification_type,p_credential_id,p_assignment_epoch,p_employee_id,p_job_id,
  case when p_action='received' then statement_timestamp() end,
  case when p_action='displayed' then statement_timestamp() end,
  case when p_action='dismissed' then statement_timestamp() end,
  case when p_action='opened' then statement_timestamp() end,
  case when p_action='acknowledged' then statement_timestamp() end,'{"evidence":"native-notification-outbox.v3"}')
 on conflict(device_identifier,notification_key,credential_id,assignment_epoch) do update set
  received_at=coalesce(device_notification_acknowledgements.received_at,excluded.received_at),
  displayed_at=coalesce(device_notification_acknowledgements.displayed_at,excluded.displayed_at),
  dismissed_at=coalesce(device_notification_acknowledgements.dismissed_at,excluded.dismissed_at),
  opened_at=coalesce(device_notification_acknowledgements.opened_at,excluded.opened_at),
  acknowledged_at=coalesce(device_notification_acknowledgements.acknowledged_at,excluded.acknowledged_at),
  updated_at=statement_timestamp()
 where device_notification_acknowledgements.employee_id=excluded.employee_id
  and device_notification_acknowledgements.notification_job_id=excluded.notification_job_id
  and device_notification_acknowledgements.notification_type=excluded.notification_type
 returning * into v_row;
 if not found then raise exception 'native notification receipt identity conflict'; end if;
 return to_jsonb(v_row);
end $function$;
revoke all on function public.ack_native_device_notification(text,uuid,bigint,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ack_native_device_notification(text,uuid,bigint,uuid,uuid,text,text,text) to service_role;

create or replace function public.static_weekly_v8_read_lunch_document(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare current_authority record;stored public.weekly_schedule_lunch_documents%rowtype;
begin
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 if current_authority.projection_status is distinct from 'current' then
  return jsonb_build_object('persistence_status','UNAVAILABLE','projection_status',current_authority.projection_status); end if;
 select * into stored from public.weekly_schedule_lunch_documents where projection_id=current_authority.projection_id;
 if not found then return jsonb_build_object('persistence_status','MISSING','projection_id',current_authority.projection_id); end if;
 if stored.document_identity is distinct from stored.document_json->>'document_identity' then
  raise exception 'saved lunch document identity mismatch'; end if;
 perform public.static_weekly_v8_assert_lunch_document(stored.projection_id,stored.document_json);
 return jsonb_build_object('persistence_status','PERSISTED','projection_id',stored.projection_id,
  'document_identity',stored.document_identity,'service_date',p_service_date,
  'loans',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'loans') where value->>'service_date'=p_service_date::text),'[]'::jsonb),
  'responsibilities',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'responsibilities') where value->>'service_date'=p_service_date::text),'[]'::jsonb));
end $function$;

-- Include the new receipt authority in connected health and exact recovery.
do $surface$
declare definition text;
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 then
  raise exception 'unexpected canary authority surface shape'; end if;
 execute replace(definition,'  values', '  values
    (''function'',''ack_native_device_notification(text,uuid,bigint,uuid,uuid,text,text,text)'',''assignment-bound native notification lifecycle''),');
end $surface$;

alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with relation as (select 'public.device_notification_acknowledgements'::regclass oid), objects as (
  select 100000 bucket,'function'::text kind,oid::regprocedure::text identity,pg_get_functiondef(oid) definition
   from pg_proc where pronamespace='public'::regnamespace and proname in
   ('ack_native_device_notification','ack_device_notification','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface')
  union all select 200000,'column','public.device_notification_acknowledgements:'||attname,
   public.custodial_release_authority_current_column_definition('public.device_notification_acknowledgements:'||attname)
   from pg_attribute where attrelid=(select oid from relation) and attnum>0 and not attisdropped
  union all select 300000,'column_set','public.device_notification_acknowledgements',
   public.custodial_release_authority_current_column_set_definition('public.device_notification_acknowledgements')
  union all select 500000,'constraint','public.device_notification_acknowledgements:'||conname,
   public.custodial_release_authority_current_constraint_definition('public.device_notification_acknowledgements:'||conname)
   from pg_constraint where conrelid=(select oid from relation)
  union all select 900000,'grant',oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(oid::regprocedure::text)
   from pg_proc where pronamespace='public'::regnamespace and proname in
   ('ack_native_device_notification','ack_device_notification','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface')
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing receipt recovery object %',obj.identity; end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or
    case when obj.kind in ('function','grant') and object_identity like '%(%'
     then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
