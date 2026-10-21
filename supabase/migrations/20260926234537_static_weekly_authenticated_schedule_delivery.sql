-- Authenticated backend-only delivery boundary. Private v19/v22 helpers and
-- their tables remain inaccessible to API clients. No new table or sequence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.static_weekly_v24_read_device_schedule_delivery(
 p_date date,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare a record;v_delivery jsonb;v_dated jsonb;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'schedule delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then
  -- Terminal wins before any older dated or recurring schedule is considered.
  v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   perform public.static_weekly_v19_reconcile_terminal_date(p_date);
   v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_TERMINAL',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false);
 end if;
 if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
  if a.projection_status is distinct from 'current' then
   return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','UNAVAILABLE',
    'projectionStatus',a.projection_status,'delivery',null,'datedApplication',null,'affectedPhonesUpdated',false);
  end if;
  v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   -- Reconcile only a missing current identity. Existing immutable views do
   -- not need all-person reconstruction on every connected phone poll.
   perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
   v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_SCHEDULE',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false);
 end if;
 -- Existing release-registered/dated workflow stays separate. Never use an
 -- old dated target with a different exact current publication/projection.
 v_dated:=public.static_weekly_v10_read_device_schedule_application(p_date,p_device,p_credential,p_employee,p_epoch);
 if a.projection_status is distinct from 'current'
  or v_dated->>'publication_id' is distinct from a.publication_id::text
  or v_dated->>'projection_id' is distinct from a.projection_id::text
  or v_dated->>'authority_revision' is distinct from a.projection_authority_revision::text then v_dated:=null;end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','LEGACY_REGISTERED',
  'delivery',null,'datedApplication',v_dated,'affectedPhonesUpdated',false);
end
$function$;

create function public.static_weekly_v24_ack_device_schedule_delivery(
 p_intent uuid,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint,
 p_target_type text,p_revision bigint,p_target_digest text,p_rendered_digest text,p_applied_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare t public.static_weekly_recurring_application_intents%rowtype;
 terminal public.static_weekly_recurring_terminal_intents%rowtype;dated record;v_result jsonb;
begin
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 if p_target_type='BLOCKED_RECURRING_AUTHORITY' then
  select * into terminal from public.static_weekly_recurring_terminal_intents where intent_id=p_intent;
  if not found or p_target_digest is distinct from terminal.target_digest
   or p_rendered_digest is distinct from p_target_digest then
   raise exception using errcode='23514',message='terminal delivery receipt requires exact target bytes';end if;
  v_result:=public.static_weekly_v19_ack_terminal_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_rendered_digest,p_applied_at);
 elsif p_target_type='SCHEDULE' then
  v_result:=public.static_weekly_v22_ack_recurring_application_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_target_digest,p_rendered_digest,p_applied_at);
  select * into strict t from public.static_weekly_recurring_application_intents where intent_id=p_intent;
  -- A dated absence/cancellation may use the same current recurring winner.
  -- Preserve its existing manager delivery receipt only for the EXACT same
  -- principal, date, revision, projection and lunch just applied. Caller
  -- supplies no dated operation/intent identity. Old/different targets remain
  -- history; no fabricated ACK on enqueue, provider acceptance or new device.
  for dated in select i.* from public.static_weekly_schedule_application_intents i
   join public.static_weekly_staffing_commands c on c.operation_id=i.operation_id and c.state='ACCEPTED'
   where i.service_date=t.service_date and i.employee_id=t.employee_id and i.device_id=t.device_id
    and i.credential_id=t.credential_id and i.assignment_epoch=t.assignment_epoch
    and i.authority_revision=t.authority_revision and i.publication_id=t.publication_id
    and i.projection_id=t.projection_id and i.lunch_document_identity=t.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=i.intent_id)
   order by i.intent_id loop
   perform public.static_weekly_v10_ack_device_schedule_application(dated.intent_id,p_device,p_credential,p_employee,p_epoch,
    p_revision,t.projection_id,t.lunch_document_identity,p_rendered_digest,p_applied_at);
  end loop;
 else raise exception using errcode='22023',message='exact typed schedule delivery receipt required';end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery-receipt.v1','receipt',v_result,
  'currentAuthorityNotInferred',true);
end
$function$;

revoke all on function public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint),
 public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint),
 public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)
 to service_role;

do $surface$
declare definition text;rows_sql text;seam text:='  values';
begin
 select string_agg(format('(%L,%L,%L)','function','public.'||oid::regprocedure::text,
  'authenticated schedule delivery and exact device receipt'),E',\n' order by oid::regprocedure::text)||',' into rows_sql
 from pg_proc where pronamespace='public'::regnamespace and proname like 'static_weekly_v24_%';
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'schedule delivery canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||rows_sql);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and (proname like 'static_weekly_v24_%' or oid='public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing schedule delivery recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when object_kind in ('function','grant')
    and object_identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
