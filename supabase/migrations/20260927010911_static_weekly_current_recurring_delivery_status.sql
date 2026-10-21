-- Current delivery readback is distinct from immutable publication acceptance.
-- One materialized date only; no schedule optimization or calendar expansion.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.static_weekly_v25_read_current_recurring_delivery(p_date date,p_manager uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare a record;t public.static_weekly_recurring_invalidations%rowtype;
 v_mode text;v_rows jsonb:='[]'::jsonb;v_count int;v_reported int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'current recurring delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager);
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then
  v_mode:='RECURRING_TERMINAL';
  perform public.static_weekly_v19_reconcile_terminal_date(p_date);
  t:=public.static_weekly_v19_current_terminal_range(p_date);
 elsif a.projection_status='current' and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
  v_mode:='RECURRING_SCHEDULE';
  perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
 else
  v_mode:=case when a.projection_status='current' then 'LEGACY_REGISTERED' else 'UNAVAILABLE' end;
 end if;
 if v_mode in ('RECURRING_SCHEDULE','RECURRING_TERMINAL') then
  with targets as (
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.view_digest rendered_digest,r.receipt_id,r.rendered_digest receipt_digest,r.received_at
   from public.static_weekly_recurring_application_intents i
   left join public.static_weekly_recurring_application_receipts r using(intent_id)
   where v_mode='RECURRING_SCHEDULE' and i.service_date=p_date and i.publication_id=a.publication_id
    and i.projection_id=a.projection_id and i.authority_revision=a.projection_authority_revision
   union all
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.target_digest,r.receipt_id,r.rendered_digest,r.received_at
   from public.static_weekly_recurring_terminal_intents i
   left join public.static_weekly_recurring_terminal_receipts r using(intent_id)
   where v_mode='RECURRING_TERMINAL' and i.service_date=p_date and i.invalidation_id=t.invalidation_id
    and i.authority_revision=t.authority_revision
  ), people as (select distinct employee_id from targets), current_rows as (
   select p.employee_id,e.display_name,e.active,device.id device_id,device.device_name,
    device.credential_id,device.assignment_epoch,x.intent_id,x.target_digest,x.receipt_id,x.received_at,
    case when e.active is distinct from true then 'PROTECTED_PRINCIPAL_PENDING'
     when device.id is null then 'NO_CURRENT_DEVICE'
     when x.intent_id is null then 'PENDING_TARGET_RECONCILIATION'
     when x.receipt_id is null or x.receipt_digest is distinct from x.rendered_digest then 'PENDING'
     when v_mode='RECURRING_TERMINAL' then 'DEVICE_REPORTED_BLOCKED' else 'DEVICE_REPORTED_APPLIED' end status
   from people p join public.employees e on e.id=p.employee_id
   left join lateral (
    select d.id,d.device_name,d.assignment_epoch,c.credential_id from public.devices d
    join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
     and c.revoked_at is null and c.expires_at>statement_timestamp()
    where d.active=true and d.assigned_employee_id=p.employee_id
   ) device on true
   left join targets x on x.employee_id=p.employee_id and x.device_id is not distinct from device.id
    and x.credential_id is not distinct from device.credential_id
    and x.assignment_epoch is not distinct from device.assignment_epoch
  ) select coalesce(jsonb_agg(jsonb_build_object('employeeId',employee_id,'employeeName',display_name,
    'deviceId',device_id,'deviceName',device_name,'credentialId',credential_id,'assignmentEpoch',assignment_epoch,
    'intentId',intent_id,'targetDigest',target_digest,'status',status,
    'receiptId',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then receipt_id end,
    'receivedAt',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then received_at end)
    order by employee_id,device_id,credential_id),'[]'::jsonb) into v_rows from current_rows;
 end if;
 v_count:=jsonb_array_length(v_rows);
 select count(*) into v_reported from jsonb_array_elements(v_rows) row
  where row->>'status' in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED');
 return jsonb_build_object('schema','static-weekly.current-recurring-delivery.v1','serviceDate',p_date,
  'observedAt',statement_timestamp(),'mode',v_mode,'projectionStatus',a.projection_status,
  'currentAuthority',jsonb_build_object('publicationId',a.publication_id,'projectionId',a.projection_id,
    'authorityRevision',case when v_mode='RECURRING_TERMINAL' then t.authority_revision else a.projection_authority_revision end,
    'invalidationId',t.invalidation_id),'targets',v_rows,'targetCount',v_count,'reportedCount',v_reported,
  'allCurrentTargetsReported',v_count>0 and v_count=v_reported,
  'affectedPhonesUpdated',v_mode='RECURRING_SCHEDULE' and v_count>0 and v_count=v_reported,
  'coverageReadinessNotInferred',true);
end
$function$;
revoke all on function public.static_weekly_v25_read_current_recurring_delivery(date,uuid)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v25_read_current_recurring_delivery(date,uuid) to static_weekly_control_plane;

do $surface$
declare definition text;seam text:='  values';
begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if length(definition)-length(replace(definition,seam,''))<>length(seam) then raise exception 'current delivery canary seam changed';end if;
 execute replace(definition,seam,seam||E'\n'||format('(%L,%L,%L),','function',
  'public.static_weekly_v25_read_current_recurring_delivery(date,uuid)','named manager current exact recurring phone readback'));
end
$surface$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where oid in
  ('public.static_weekly_v25_read_current_recurring_delivery(date,uuid)'::regprocedure,
   'public.custodial_release_canary_authority_surface()'::regprocedure)),objects as (
  select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing current delivery recovery object %',obj.identity;end if;
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
