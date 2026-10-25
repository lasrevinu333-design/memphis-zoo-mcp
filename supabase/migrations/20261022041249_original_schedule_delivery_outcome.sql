-- An uncertain native send may query ONLY its original intent. A current
-- winner, missing receipt, or later revision never authorizes another send.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.static_weekly_v26_read_original_delivery_outcome(
 p_intent uuid,p_target_type text,p_device uuid,p_credential uuid,p_employee uuid,p_epoch bigint
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare intent record;receipt record;expected_render text;
begin
 if p_intent is null or p_target_type is null
  or p_target_type not in ('SCHEDULE','BLOCKED_RECURRING_AUTHORITY')
  or p_epoch is null or p_epoch<1 or p_epoch>9007199254740991 then
  raise exception using errcode='22023',message='exact original delivery identity is required';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='exact original delivery principal is required';end if;
 if p_target_type='SCHEDULE' then
  select i.intent_id,i.device_id,i.credential_id,i.employee_id,i.assignment_epoch,
   i.authority_revision,i.target_digest,i.view_digest into intent
   from public.static_weekly_recurring_application_intents i where i.intent_id=p_intent;
  if not found then
   raise exception using errcode='42501',message='exact original delivery principal is required';end if;
  expected_render:=intent.view_digest;
  select r.receipt_id,r.rendered_digest,r.applied_at,r.received_at into receipt
   from public.static_weekly_recurring_application_receipts r where r.intent_id=p_intent;
 else
  select i.intent_id,i.device_id,i.credential_id,i.employee_id,i.assignment_epoch,
   i.authority_revision,i.target_digest into intent
   from public.static_weekly_recurring_terminal_intents i where i.intent_id=p_intent;
  if not found then
   raise exception using errcode='42501',message='exact original delivery principal is required';end if;
  expected_render:=intent.target_digest;
  select r.receipt_id,r.rendered_digest,r.applied_at,r.received_at into receipt
   from public.static_weekly_recurring_terminal_receipts r where r.intent_id=p_intent;
 end if;
 if intent.device_id is distinct from p_device or intent.credential_id is distinct from p_credential
  or intent.employee_id is distinct from p_employee or intent.assignment_epoch is distinct from p_epoch then
  raise exception using errcode='42501',message='exact original delivery principal is required';end if;
 if receipt.receipt_id is not null and (receipt.rendered_digest is distinct from expected_render
  or not isfinite(receipt.applied_at) or not isfinite(receipt.received_at)) then
  raise exception using errcode='23514',message='original delivery receipt is inconsistent';end if;
 return jsonb_build_object('schema','static-weekly.original-device-delivery-outcome.v1',
  'intentId',intent.intent_id,'targetType',p_target_type,'authorityRevision',intent.authority_revision,
  'targetDigest',intent.target_digest,'renderedDigest',expected_render,
  'status',case when receipt.receipt_id is null then 'NO_RECORDED_RECEIPT' else 'RECEIPT_RECORDED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at,
  'retryAuthorized',false,'currentAuthorityNotInferred',true);
end
$function$;

revoke all on function public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint) to service_role;

do $surface$
declare definition text;rows_sql text;seam text:='  values';
begin
 select format('(%L,%L,%L),','function','public.'||oid::regprocedure::text,
  'authenticated read-only original delivery outcome') into strict rows_sql
 from pg_proc where oid='public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint)'::regprocedure;
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then
  raise exception 'original delivery outcome canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||rows_sql);
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with funcs as (
  select oid,'public.'||oid::regprocedure::text identity from pg_proc
  where oid in ('public.static_weekly_v26_read_original_delivery_outcome(uuid,text,uuid,uuid,uuid,bigint)'::regprocedure,
   'public.custodial_release_canary_authority_surface()'::regprocedure)
 ),objects as (
  select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing original outcome recovery object %',obj.identity;end if;
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
