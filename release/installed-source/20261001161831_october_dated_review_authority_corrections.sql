-- Bounded corrections from the independent 9ce288bc web HOLD, F2/F5/F6.
-- F1/F3 are corrected in the owning JavaScript adapter/controller. Preserve
-- every predecessor byte, immutable publication/history and approved plan.
begin;
create or replace function public.custodial_dated_dependencies(p jsonb) returns jsonb language sql stable
set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.display_name,'code',e.employee_code,'active',e.active) order by e.id),'[]')
   from public.employees e where e.id::text in (select r->>'personId' from jsonb_array_elements(p->'rosterSlots') r)),
 'slots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.slot_id,'code',s.slot_code) order by s.slot_id),'[]')
   from public.weekly_roster_slots s where s.slot_id::text in (select r->>'slotId' from jsonb_array_elements(p->'rosterSlots') r)),
 'incumbents',(select coalesce(jsonb_agg(jsonb_build_object('slot',i.slot_id,'person',i.person_id,'name',i.person_name_snapshot,
   'start',i.effective_start,'end',i.effective_end) order by i.slot_id,i.effective_start),'[]')
   from public.v_weekly_roster_slot_incumbency_ranges i where i.slot_id::text in (select r->>'slotId' from jsonb_array_elements(p->'rosterSlots') r)
   and i.effective_start<date '2026-10-05' and (i.effective_end is null or i.effective_end>date '2026-10-01')),
 'staffing',(select coalesce(jsonb_agg(jsonb_build_object('slot',s.slot_id,'person',s.employee_id,'state',s.staffing_state,
  'start',s.effective_start,'revision',s.authority_revision) order by s.slot_id,s.effective_start,s.authority_revision),'[]')
  from public.weekly_roster_slot_staffing_states s where s.slot_id::text in (select r->>'slotId' from jsonb_array_elements(p->'rosterSlots') r)
  and s.effective_start<date '2026-10-05'),
 'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.location_name,'code',l.location_code,'active',l.active,'form',l.form_type) order by l.id),'[]')
  from public.locations l where l.id::text in(select distinct x->>'locationId' from jsonb_array_elements(p->'days') d
   cross join lateral jsonb_array_elements(d->'assignments') a cross join lateral jsonb_array_elements(a#>'{workSnapshot,includedLocations}') x)),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'code',g.group_code,'name',g.group_name,'active',g.active) order by g.id),'[]')
  from public.location_groups g where g.group_code in(select distinct a#>>'{workSnapshot,locationCodeSnapshot}'
   from jsonb_array_elements(p->'days') d cross join lateral jsonb_array_elements(d->'assignments') a)),
 'exceptions',(select coalesce(jsonb_agg(jsonb_build_object('id',e.exception_id,'date',e.service_date,'revision',e.authority_revision)
  order by e.exception_id),'[]') from public.weekly_schedule_exception_commands e where e.service_date>=date '2026-10-01' and e.service_date<date '2026-10-05'))
 $$;

create or replace function public.custodial_dated_control(op text,args jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor jsonb;manager uuid;plan jsonb;dep text;state jsonb;r public.custodial_dated_publications%rowtype;
 request jsonb;response jsonb;rev bigint;slot jsonb;day jsonb;work jsonb;inc record;actual text;expected bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 -- Direct callers use the same fence-before-authority order as the adapter.
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if jsonb_typeof(args) is distinct from 'object' then raise exception using errcode='22023',message='typed operation arguments required'; end if;
 manager:=nullif(args->>'managerId','')::uuid;
 if op in ('snapshot','receipt','stage','staged','finalize','rollback') then
  actor:=public.static_weekly_v3_manager_actor(manager);
 end if;
 if op='snapshot' then
  -- Status and exact rollback remain available after dependency drift.
  -- This does not authorize a new stage or skip its full admission checks.
  if args->'authorityOnly'='true'::jsonb then return jsonb_build_object('authorizedManagerId',manager,
   'authorityRevision',(select current_revision from public.static_weekly_schedule_control where singleton));end if;
  plan:=args->'plan';perform public.custodial_dated_assert_plan(plan);
  if args->>'start' is distinct from '2026-10-01' or args->>'end' is distinct from '2026-10-05' then
   raise exception using errcode='23514',message='exact bounded date range required'; end if;
  for slot in select value from jsonb_array_elements(plan->'rosterSlots') loop
   if not exists(select 1 from public.weekly_roster_slots s where s.slot_id::text=slot->>'slotId') then
    raise exception using errcode='23514',message='current stable slot missing'; end if;
   for day in select value from jsonb_array_elements(plan->'days') loop
    select count(*)::text into actual from public.v_weekly_roster_slot_incumbency_ranges i
      where i.slot_id::text=slot->>'slotId' and i.effective_start<=(day->>'serviceDate')::date
      and (i.effective_end is null or (day->>'serviceDate')::date<i.effective_end);
    if (slot->>'personId' is null and actual<>'0') or (slot->>'personId' is not null and actual<>'1') then
     raise exception using errcode='23514',message='current incumbent/vacancy mismatch'; end if;
    if slot->>'personId' is not null and not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges i
     join public.employees e on e.id=i.person_id and e.active=true
     where i.slot_id::text=slot->>'slotId' and i.person_id::text=slot->>'personId' and e.display_name=slot->>'displayName'
      and i.effective_start<=(day->>'serviceDate')::date and (i.effective_end is null or (day->>'serviceDate')::date<i.effective_end)) then
     raise exception using errcode='23514',message='current employee identity mismatch'; end if;
   end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(plan->'days') d cross join lateral jsonb_array_elements(d->'assignments') w
   where not exists(select 1 from public.location_groups g where g.group_code=w#>>'{workSnapshot,locationCodeSnapshot}' and g.active))
   or exists(select 1 from jsonb_array_elements(plan->'days') d cross join lateral jsonb_array_elements(d->'assignments') w
    cross join lateral jsonb_array_elements(w#>'{workSnapshot,includedLocations}') x
    where not exists(select 1 from public.locations l where l.id::text=x->>'locationId' and l.active)) then
    raise exception using errcode='23514',message='active physical location mapping required'; end if;
  if exists(select 1 from public.weekly_schedule_exception_commands e where e.service_date>=date '2026-10-01' and e.service_date<date '2026-10-05')
   or exists(select 1 from jsonb_array_elements(plan->'days') d cross join lateral jsonb_array_elements(d->'availability') a
    join lateral(select s.staffing_state from public.weekly_roster_slot_staffing_states s
     where s.slot_id::text=a->>'slotId' and s.effective_start<=(d->>'serviceDate')::date
     order by s.effective_start desc,s.authority_revision desc limit 1) staffing on true
    where a->>'status'='working' and staffing.staffing_state<>'working') then
   raise exception using errcode='23514',message='current staffing/dated exceptions require reconciliation';end if;
  return jsonb_build_object('authorizedManagerId',manager,'authorityRevision',(select current_revision from public.static_weekly_schedule_control where singleton),
   'dependencyDigest',public.static_weekly_digest_jsonb(public.custodial_dated_dependencies(plan)),'rosterSlots',plan->'rosterSlots',
   'approvedAvailability',(select jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','availability',d->'availability') order by d->>'serviceDate') from jsonb_array_elements(plan->'days') d),
   'hasExistingOccurrences',exists(select 1 from public.weekly_schedule_occurrences o where service_date>=date '2026-10-01' and service_date<date '2026-10-05')
    or public.custodial_dated_record() is not null);
 elsif op='receipt' then
  select jsonb_build_object('request',x.request,'response',x.response) into response from public.custodial_dated_receipts x
    where manager_id=manager and operation_key=args->>'key';return response;
 elsif op='stage' then
  plan:=args->'plan';perform public.custodial_dated_assert_plan(plan);
  if public.custodial_dated_record() is not null or exists(select 1 from public.weekly_schedule_occurrences o
    where o.service_date>=date '2026-10-01' and o.service_date<date '2026-10-05') then
   raise exception using errcode='23514',message='existing occurrences require explicit reconciliation'; end if;
  if exists(select 1 from public.custodial_dated_publications where staged_transaction=pg_current_xact_id()) then
   raise exception using errcode='23514',message='one bounded stage per transaction'; end if;
  -- Recheck identities at the writer even if the caller bypassed JS preview.
  state:=public.custodial_dated_control('snapshot',jsonb_build_object('managerId',manager,'plan',plan,'start','2026-10-01','end','2026-10-05'));
  insert into public.custodial_dated_publications(plan_digest,plan,dependency_digest,manager_id,staged_transaction,expected_revision)
   values(plan->>'planDigest',plan,state->>'dependencyDigest',manager,pg_current_xact_id(),(state->>'authorityRevision')::bigint) returning * into r;
  for day in select value from jsonb_array_elements(plan->'days') loop
   for work in select value from jsonb_array_elements(day->'assignments') loop
    insert into public.custodial_dated_occurrences(publication_id,service_date,plan_work_id,assignment)
     values(r.publication_id,(day->>'serviceDate')::date,work->>'planWorkId',work);
   end loop;
  end loop;
  return null;
 elsif op='staged' then
  select * into r from public.custodial_dated_publications where staged_transaction=pg_current_xact_id() and manager_id=manager;
  if not found then raise exception using errcode='55000',message='transaction-local stage required'; end if;
  return jsonb_build_object('persistenceStatus','PERSISTED','publicationId',r.publication_id,'projectionId',r.projection_id,
   'planDigest',r.plan_digest,'phonePdfRevision',r.plan->>'phonePdfRevision','days',r.plan->'days');
 elsif op in ('finalize','rollback') then
  request:=args->'request';expected:=(request->>'expectedRevision')::bigint;
  if request->>'managerId' is distinct from manager::text or request->>'planDigest' is distinct from '89f600b965259f6bbf30488ff5eef2a6d754b3cbd0072f00419b318245e9459d'
   or request->>'phonePdfRevision' is distinct from 'ee75f76a21e0d3a82291b8c720b5548532e1f168f1941a0cd74e80662302bd08'
   or nullif(btrim(request->>'idempotencyKey'),'') is null or length(request->>'idempotencyKey')>200 then
    raise exception using errcode='23514',message='exact authorized operation identity required'; end if;
  if op='finalize' then
   select * into r from public.custodial_dated_publications where staged_transaction=pg_current_xact_id() and manager_id=manager;
   if not found or r.expected_revision is distinct from expected or args#>>'{record,publicationId}' is distinct from r.publication_id::text
     or args#>>'{record,projectionId}' is distinct from r.projection_id::text then
    raise exception using errcode='23514',message='complete transaction-local stage identity required'; end if;
   if request->>'operation' is distinct from 'materialize' or request->>'previewDigest' is distinct from public.static_weekly_digest_jsonb(
     jsonb_build_object('planDigest',r.plan_digest,'managerId',manager::text,'authorityRevision',expected,'dependencyDigest',r.dependency_digest)) then
    raise exception using errcode='23514',message='preview acceptance identity mismatch'; end if;
  else
   state:=public.custodial_dated_record();
   if state is null or request->>'operation' is distinct from 'rollback'
    or request->>'publicationId' is distinct from state->>'publicationId' or request->>'projectionId' is distinct from state->>'projectionId' then
    raise exception using errcode='23514',message='rollback must name exact current publication'; end if;
   select * into strict r from public.custodial_dated_publications where publication_id=(state->>'publicationId')::uuid;
  end if;
  rev:=public.static_weekly_advance_authority(expected,case when op='finalize' then 'materialize_projection' else 'rollback' end,
    manager,actor->>'manager_name',gen_random_uuid(),public.static_weekly_digest_jsonb(request));
  insert into public.custodial_dated_activations(publication_id,authority_revision,active,manager_id) values(r.publication_id,rev,op='finalize',manager);
  response:=jsonb_build_object('state',case when op='finalize' then 'PERSISTED' else 'ROLLED_BACK' end,'revision',rev,
   'publicationId',r.publication_id,'projectionId',r.projection_id,'planDigest',r.plan_digest,'phonePdfRevision',r.plan->>'phonePdfRevision',
   'phoneDeliveryState','PENDING','affectedPhonesUpdated',false);
  insert into public.custodial_dated_receipts values(manager,request->>'idempotencyKey',request,response);
  return response;
 elsif op='current' then return public.custodial_dated_record();
 elsif op='day' then
  state:=public.custodial_dated_record((args->>'date')::date);
  if state->>'projectionStatus' is distinct from 'current' then return null; end if;
  return (select d from jsonb_array_elements(state->'days') d where d->>'serviceDate'=args->>'date');
 else raise exception using errcode='22023',message='unknown bounded operation'; end if;
end $$;

-- Employee/Home reads belong only to the existing application reader/service.
-- A write-capable control-plane role has no employee/Home caller contract.
revoke execute on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz),
 public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)
 from static_weekly_control_plane;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with funcs as(select p.oid,p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('custodial_dated_dependencies','custodial_dated_control','static_weekly_v5_read_employee_day','static_weekly_v27_read_home_time_facts')),
 views(identity) as(select null::text where false),
 objects as(
 select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
 union all select 800000,'view',identity,'create or replace view '||identity||' as '||pg_get_viewdef(identity::regclass,true)||';' from views
 union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from views
 ) select * from objects order by bucket,identity loop
 if obj.definition is null then raise exception 'missing consumer recovery object %',obj.identity;end if;
 update public.custodial_release_authority_restore_inventory set
 definition_sql=case when obj.kind='grant' then public.custodial_release_authority_current_grant_definition(object_identity) else obj.definition end,
 definition_sha256=public.static_weekly_digest_text(case when obj.kind='grant' then public.custodial_release_authority_current_grant_definition(object_identity) else obj.definition end),captured_at=statement_timestamp()
 where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in('function','grant') and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
 if not found then
 select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
 insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end if;end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
