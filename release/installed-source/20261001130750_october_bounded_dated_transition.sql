begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Separate four-day authority. Existing seven-day relations and validators
-- remain unchanged. No exposed table or sequence and no new client grants.
create table public.custodial_dated_publications(
 publication_id uuid primary key default gen_random_uuid(),projection_id uuid not null unique default gen_random_uuid(),
 plan_digest text not null check(plan_digest='89f600b965259f6bbf30488ff5eef2a6d754b3cbd0072f00419b318245e9459d'),
 plan jsonb not null,dependency_digest text not null,manager_id uuid not null,
 staged_transaction xid8 not null,expected_revision bigint not null,
 created_at timestamptz not null default statement_timestamp()
);
create table public.custodial_dated_activations(
 activation_id uuid primary key default gen_random_uuid(),publication_id uuid not null references public.custodial_dated_publications,
 authority_revision bigint not null unique references public.weekly_schedule_authority_revisions,
 active boolean not null,manager_id uuid not null,created_at timestamptz not null default statement_timestamp()
);
create table public.custodial_dated_receipts(
 manager_id uuid not null,operation_key text not null,request jsonb not null,response jsonb not null,
 primary key(manager_id,operation_key)
);
create table public.custodial_dated_occurrences(
 occurrence_id uuid primary key default gen_random_uuid(),publication_id uuid not null references public.custodial_dated_publications,
 service_date date not null check(service_date>=date '2026-10-01' and service_date<date '2026-10-05'),
 plan_work_id text not null,assignment jsonb not null,unique(publication_id,service_date,plan_work_id)
);
alter table public.custodial_dated_publications enable row level security;
alter table public.custodial_dated_publications force row level security;
alter table public.custodial_dated_activations enable row level security;
alter table public.custodial_dated_activations force row level security;
alter table public.custodial_dated_receipts enable row level security;
alter table public.custodial_dated_receipts force row level security;
alter table public.custodial_dated_occurrences enable row level security;
alter table public.custodial_dated_occurrences force row level security;
revoke all on table public.custodial_dated_publications,public.custodial_dated_activations,public.custodial_dated_receipts,public.custodial_dated_occurrences from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_dated_assert_plan(p jsonb) returns void language plpgsql
set search_path=pg_catalog,public as $$
begin
 if p->>'planDigest' is distinct from '89f600b965259f6bbf30488ff5eef2a6d754b3cbd0072f00419b318245e9459d'
  or public.static_weekly_digest_jsonb(p-'planDigest') is distinct from p->>'planDigest'
  or p->>'phonePdfRevision' is distinct from 'ee75f76a21e0d3a82291b8c720b5548532e1f168f1941a0cd74e80662302bd08'
  or p->>'effectiveStart' is distinct from '2026-10-01' or p->>'effectiveEndExclusive' is distinct from '2026-10-05'
  then raise exception using errcode='23514',message='exact approved bounded transition identity required'; end if;
end $$;

-- Read current dependency facts explicitly; no HR or leave-reason columns.
create function public.custodial_dated_dependencies(p jsonb) returns jsonb language sql stable
set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.display_name,'active',e.active) order by e.id),'[]')
   from public.employees e where e.id::text in (select r->>'personId' from jsonb_array_elements(p->'rosterSlots') r)),
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

create function public.custodial_dated_record(p_date date default null) returns jsonb language sql stable
set search_path=pg_catalog,public as $$
 select jsonb_build_object('persistenceStatus','PERSISTED','publicationId',p.publication_id,'projectionId',p.projection_id,
 'planDigest',p.plan_digest,'phonePdfRevision',p.plan->>'phonePdfRevision','days',p.plan->'days',
 'plan',p.plan,'revision',a.authority_revision,
 'projectionStatus',case when public.static_weekly_digest_jsonb(public.custodial_dated_dependencies(p.plan))=p.dependency_digest then 'current' else 'stale_dated_dependency' end)
 from public.custodial_dated_publications p join lateral(select * from public.custodial_dated_activations x
  where x.publication_id=p.publication_id order by authority_revision desc limit 1) a on a.active
 where (p_date is null or (p_date>=date '2026-10-01' and p_date<date '2026-10-05'))
 order by a.authority_revision desc limit 1
 $$;

create function public.custodial_dated_control(op text,args jsonb) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor jsonb;manager uuid;plan jsonb;dep text;state jsonb;r public.custodial_dated_publications%rowtype;
 request jsonb;response jsonb;rev bigint;slot jsonb;day jsonb;work jsonb;inc record;actual text;expected bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 if op in ('stage','finalize','rollback') then perform custodial_dr.acquire_application_mutation_fence();end if;
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

create function public.custodial_dated_rows(kind text,p_date date) returns jsonb language plpgsql stable
set search_path=pg_catalog,public as $$
declare rec jsonb:=public.custodial_dated_record(p_date);day jsonb;result jsonb;version text;
begin
 if rec is null then return null; end if;
 select d into day from jsonb_array_elements(rec->'days') d where d->>'serviceDate'=p_date::text;
 version:=day->>'weeklyVersionId';
 if kind='state' then return jsonb_build_array(jsonb_build_object('service_date',p_date,'governed',true,
  'authority_source','static_weekly_projection','projection_status',rec->>'projectionStatus','version_id',version,
  'publication_id',rec->>'publicationId','projection_id',rec->>'projectionId','projection_authority_revision',rec->'revision',
  'staffing_authority_revision',null,'week_start','2026-10-01'));end if;
 if rec->>'projectionStatus'<>'current' then return '[]'::jsonb;end if;
 if kind='roster' then
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',r->>'personId','employee_name',r->>'displayName',
   'employee_code',e.employee_code,'shift_start',a#>>'{shift,start}','shift_end',a#>>'{shift,end}',
   'lunch_start',a#>>'{lunch,start}','lunch_end',a#>>'{lunch,end}','active',coalesce(a->>'status'='working',false),
   'source_type','static_weekly_projection','notes',null,'slot_id',r->>'slotId','slot_code',s.slot_code,
   'slot_label',r->>'slotLabel','staffing_state',coalesce(a->>'status','unavailable'),'governed',true,
   'projection_status','current','version_id',version,'publication_id',rec->>'publicationId','projection_id',rec->>'projectionId') order by r->>'slotId'),'[]') into result
  from jsonb_array_elements(rec#>'{plan,rosterSlots}') r
  join public.weekly_roster_slots s on s.slot_id::text=r->>'slotId'
  left join public.employees e on e.id::text=r->>'personId'
  left join lateral(select value a from jsonb_array_elements(day->'availability') where value->>'slotId'=r->>'slotId') av on true;
  return result;
 elsif kind='segments' then
  select coalesce(jsonb_agg(jsonb_build_object('service_date',p_date,'location_group_id',g.id,
   'group_code',g.group_code,'group_name',a#>>'{workSnapshot,locationNameSnapshot}',
   'included_locations',(select coalesce(jsonb_agg(x->>'locationNameSnapshot'),'[]') from jsonb_array_elements(a#>'{workSnapshot,includedLocations}') x),
   'included_location_ids',(select coalesce(jsonb_agg(x->>'locationId'),'[]') from jsonb_array_elements(a#>'{workSnapshot,includedLocations}') x),
   'segment_id',o.occurrence_id,'segment_number',1,'owner_type',case when a->>'status'='ASSIGNED' then 'EMPLOYEE' else 'OPEN' end,
   'assigned_employee_id',a->>'personId','assigned_employee_name',a->>'displayName','coverage_start',a#>>'{window,start}',
   'coverage_end',a#>>'{window,end}','status',a->>'status','load_points',a->'serviceEffortMinutes',
   'coverage_purpose',case when a#>>'{workSnapshot,serviceMode}'='reminder_only' then 'reminder' else 'area_owner' end,
   'notes',null,'source_type','static_weekly_projection','service_mode',a#>>'{workSnapshot,serviceMode}',
   'governed',true,'projection_status','current','version_id',version,'publication_id',rec->>'publicationId','projection_id',rec->>'projectionId') order by o.plan_work_id),'[]') into result
  from public.custodial_dated_occurrences o cross join lateral(select o.assignment a) w
  join public.location_groups g on g.group_code=a#>>'{workSnapshot,locationCodeSnapshot}' and g.active
  where o.publication_id=(rec->>'publicationId')::uuid and o.service_date=p_date;
  return result;
 elsif kind='lunch' then
  select coalesce(jsonb_agg(jsonb_build_object('projection_id',rec->>'projectionId','loan_id',loan->>'loanId',
   'responsibility_id',responsibility->>'responsibilityId','normal_occurrence_id',o.occurrence_id,
   'normal_owner_id',loan->>'normalOwnerPersonId','coverer_id',responsibility->>'covererPersonId','coverer_name',e.display_name,
   'location_group_id',g.id,'group_code',g.group_code,'group_name',o.assignment#>>'{workSnapshot,locationNameSnapshot}',
   'included_locations',(select jsonb_agg(x->>'locationNameSnapshot') from jsonb_array_elements(segment->'includedLocations') x),
   'included_location_ids',(select jsonb_agg(x->>'locationId') from jsonb_array_elements(segment->'includedLocations') x),
   'included_snapshots',segment->'includedLocations','service_mode',segment->>'serviceMode',
   'coverage_start',segment#>>'{window,start}','coverage_end',segment#>>'{window,end}')
   order by loan->>'loanId',responsibility->>'responsibilityId',o.plan_work_id),'[]') into result
  from jsonb_array_elements(day->'lunchLoans') loan cross join lateral jsonb_array_elements(loan->'responsibilities') responsibility
  cross join lateral jsonb_array_elements(responsibility->'segments') segment
  join public.custodial_dated_occurrences o on o.publication_id=(rec->>'publicationId')::uuid and o.service_date=p_date
    and o.plan_work_id=segment->>'planWorkId'
  join public.employees e on e.id::text=responsibility->>'covererPersonId' and e.active
  join public.location_groups g on g.group_code=o.assignment#>>'{workSnapshot,locationCodeSnapshot}' and g.active;
  return result;
 end if;
 raise exception using errcode='22023',message='unknown reader kind';
end $$;

-- Preserve the exact existing function result types and ACLs; former bodies
-- remain private fallback implementations outside the active bounded range.
do $wrap$
declare name text;kind text;signature text;result_type text;columns text;definition text;oid_before oid;acl_before text;
begin
 for name,kind in values('static_weekly_v6_schedule_authority_state','state'),('static_weekly_v6_read_schedule_segments','segments'),
  ('static_weekly_v6_read_roster','roster'),('static_weekly_v8_read_lunch_segments','lunch') loop
  signature:='public.'||name||'(date)';oid_before:=signature::regprocedure;
  result_type:=pg_get_function_result(oid_before);
  select string_agg(quote_ident(n)||' '||format_type(t,null),',' order by ord) into columns
   from pg_proc p cross join lateral unnest(p.proallargtypes,p.proargmodes,p.proargnames) with ordinality u(t,m,n,ord)
   where p.oid=oid_before and m='t';
  select coalesce(proacl::text,'') into acl_before from pg_proc where oid=oid_before;
  execute format('alter function %s rename to %I',signature,name||'_dated_base');
  execute format('create function public.%I(p_service_date date) returns %s language plpgsql stable security definer set search_path=pg_catalog,public as $body$ declare rows jsonb;begin rows:=public.custodial_dated_rows(%L,p_service_date);if rows is null then return query select * from public.%I(p_service_date);else return query select * from jsonb_to_recordset(rows) as r(%s);end if;end $body$',name,result_type,kind,name||'_dated_base',columns);
  -- Mirror precise predecessor EXECUTEs, never default PUBLIC privilege.
  execute format('revoke all on function public.%I(date) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator',name);
  for definition in select case when grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(grantee)) end
   from aclexplode(coalesce((select proacl from pg_proc where oid=oid_before),acldefault('f',(select proowner from pg_proc where oid=oid_before)))) where privilege_type='EXECUTE' loop
   execute format('grant execute on function public.%I(date) to %s',name,definition);
  end loop;
  execute format('revoke all on function public.%I(date) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator',name||'_dated_base');
 end loop;
end $wrap$;

alter function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) rename to static_weekly_v5_read_employee_day_dated_base;
create function public.static_weekly_v5_read_employee_day(p_service_date date,p_employee_id uuid,p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare rec jsonb:=public.custodial_dated_record(p_service_date);day jsonb;roster jsonb;items jsonb;loans jsonb;working boolean;current_items jsonb;phase text;
begin
 if rec is null then return public.static_weekly_v5_read_employee_day_dated_base(p_service_date,p_employee_id,p_now);end if;
 select d into day from jsonb_array_elements(rec->'days') d where d->>'serviceDate'=p_service_date::text;
 select r into roster from jsonb_array_elements(public.custodial_dated_rows('roster',p_service_date)) r where r->>'employee_id'=p_employee_id::text;
 if rec->>'projectionStatus'<>'current' or roster is null then
  return jsonb_build_object('governed',true,'source','static_weekly_projection','projection_status',
   case when roster is null then 'employee_not_in_dated_roster' else rec->>'projectionStatus' end,
   'service_date',p_service_date,'employee_id',p_employee_id,'publication_id',rec->>'publicationId','projection_id',rec->>'projectionId');end if;
 working:=roster->>'active'='true';
 select coalesce(jsonb_agg(s||jsonb_build_object('id',s->>'segment_id','occurrence_id',s->>'segment_id',
  'name',s->>'group_name','location_group_name',s->>'group_name','location_group_code',s->>'group_code',
  'start_time',s->>'coverage_start','end_time',s->>'coverage_end','included_location_snapshots',o.assignment#>'{workSnapshot,includedLocations}') order by s->>'coverage_start',s->>'segment_id'),'[]') into items
 from jsonb_array_elements(public.custodial_dated_rows('segments',p_service_date)) s
 join public.custodial_dated_occurrences o on o.occurrence_id::text=s->>'segment_id'
 where s->>'assigned_employee_id'=p_employee_id::text;
 select coalesce(jsonb_agg(l||jsonb_build_object('id',(l->>'responsibility_id')||':'||(l->>'normal_occurrence_id'),
  'occurrence_id',l->>'normal_occurrence_id','service_date',p_service_date,
  'name',l->>'group_name','location_group_name',l->>'group_name','location_group_code',l->>'group_code',
  'normal_owner_person_id',l->>'normal_owner_id','coverer_person_id',l->>'coverer_id',
  'start_time',l->>'coverage_start','end_time',l->>'coverage_end',
  'source_type','static_weekly_lunch_coverage','owner_type','EMPLOYEE',
  'purpose','lunch_coverage','section_title','Lunch coverage','coverage_purpose','lunch_coverage',
  'status','ASSIGNED','included_location_snapshots',l->'included_snapshots',
  'on_call_only',coalesce(r->>'responseMode'='on_call_issues_only',false),
  'normal_owner_name',(select person->>'displayName' from jsonb_array_elements(rec#>'{plan,rosterSlots}') person where person->>'personId'=l->>'normal_owner_id'),
  'check_deadline_policy',coalesce(r->>'checkDeadlinePolicy','inherit_existing_90_minute_deadline'),
  'response_mode',r->>'responseMode','instruction',r->>'instruction','creates_deep_clean',false)
  order by l->>'coverage_start',l->>'responsibility_id'),'[]') into loans
 from jsonb_array_elements(public.custodial_dated_rows('lunch',p_service_date)) l
 join lateral(select responsibility r from jsonb_array_elements(day->'lunchLoans') loan
  cross join lateral jsonb_array_elements(loan->'responsibilities') responsibility
  where responsibility->>'responsibilityId'=l->>'responsibility_id') rr on true
 where l->>'coverer_id'=p_employee_id::text;
 items:=items||loans;
 select coalesce(jsonb_agg(x),'[]') into current_items from jsonb_array_elements(items) x
  where (p_now at time zone 'America/Chicago')::date=p_service_date
  and (x->>'coverage_start')::time<=(p_now at time zone 'America/Chicago')::time
  and (p_now at time zone 'America/Chicago')::time<(x->>'coverage_end')::time;
 phase:=case when not working then 'off_day' when (p_now at time zone 'America/Chicago')::time<(roster->>'shift_start')::time then 'before_shift'
  when (p_now at time zone 'America/Chicago')::time>=(roster->>'shift_end')::time then 'after_shift' else 'assigned_areas' end;
 return jsonb_build_object('contract_version','static-weekly-employee-day.v3',
  'governed',true,'source','static_weekly_projection','authority_scope','dated_transition',
  'projection_status','current','service_date',p_service_date,'employee_id',p_employee_id,'employee_name',roster->>'employee_name',
  'employee',jsonb_build_object('id',p_employee_id,'display_name',roster->>'employee_name'),
  'version_id',day->>'weeklyVersionId','publication_id',rec->>'publicationId','projection_id',rec->>'projectionId',
  'candidate_revision',rec->>'phonePdfRevision','authority_revision',rec->'revision','phase',phase,
  'schedule_status',case when working then 'scheduled' else 'off' end,
  'shift',jsonb_build_object('active',working,'start',roster->>'shift_start','end',roster->>'shift_end'),
  'all_items',items,'current_items',current_items,'items',current_items,
  'assignment_count',jsonb_array_length(items),'lunch_coverage_contract','static-weekly-lunch-consumers.v1','lunch_coverage_status','PERSISTED');
end $$;

create function public.static_weekly_v27_read_home_time_facts(p_date date,p_employee uuid,p_publication uuid,p_projection uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare rec jsonb:=public.custodial_dated_record(p_date);roster jsonb;working boolean;
begin
 if p_date is null or p_employee is null or p_publication is null or p_projection is null then return null;end if;
 if rec is null or rec->>'projectionStatus'<>'current' or rec->>'publicationId'<>p_publication::text or rec->>'projectionId'<>p_projection::text then return null;end if;
 select r into roster from jsonb_array_elements(public.custodial_dated_rows('roster',p_date)) r where r->>'employee_id'=p_employee::text;
 if roster is null then return null;end if;working:=roster->>'active'='true';
 return jsonb_build_object('contract_version','employee-home-time-facts.v1','service_date',p_date,'employee_id',p_employee,
  'employee_name',roster->>'employee_name','projection_status','current','projection_id',p_projection,'publication_id',p_publication,
  'candidate_revision',rec->>'phonePdfRevision','source','static_weekly_projection','reason',null,
  'schedule_status',case when working then 'scheduled' else 'off' end,
  'shift',case when working then jsonb_build_object('active',true,'start',roster->>'shift_start','end',roster->>'shift_end',
   'shift_start',roster->>'shift_start','shift_end',roster->>'shift_end','lunch_start',roster->>'lunch_start','lunch_end',roster->>'lunch_end') else jsonb_build_object('active',false) end,
  'lunch',case when working then jsonb_build_object('start',roster->>'lunch_start','end',roster->>'lunch_end') else null end);
end $$;

revoke all on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz),
 public.static_weekly_v5_read_employee_day_dated_base(date,uuid,timestamptz),
 public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz),
 public.static_weekly_v27_read_home_time_facts(date,uuid,uuid,uuid)
 to service_role,custodial_application_reader,static_weekly_control_plane;

revoke all on function public.custodial_dated_assert_plan(jsonb),public.custodial_dated_dependencies(jsonb),public.custodial_dated_record(date),public.custodial_dated_control(text,jsonb),public.custodial_dated_rows(text,date) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.custodial_dated_control(text,jsonb) to static_weekly_control_plane;

create function public.custodial_dated_reject_mutation() returns trigger language plpgsql
set search_path=pg_catalog,public as $$begin raise exception using errcode='55000',message='dated authority history is immutable';end$$;
revoke all on function public.custodial_dated_reject_mutation() from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger dated_publication_immutable before update or delete on public.custodial_dated_publications for each row execute function public.custodial_dated_reject_mutation();
create trigger dated_activation_immutable before update or delete on public.custodial_dated_activations for each row execute function public.custodial_dated_reject_mutation();
create trigger dated_receipt_immutable before update or delete on public.custodial_dated_receipts for each row execute function public.custodial_dated_reject_mutation();
create trigger dated_occurrence_immutable before update or delete on public.custodial_dated_occurrences for each row execute function public.custodial_dated_reject_mutation();

-- A direct/autocommit stage cannot leave a durable unaccepted prefix.
create function public.custodial_dated_assert_complete() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.custodial_dated_activations a join public.custodial_dated_receipts r
  on r.response->>'publicationId'=a.publication_id::text
  where a.publication_id=new.publication_id and a.active and r.response->>'state'='PERSISTED'
    and r.response->>'projectionId'=new.projection_id::text and r.response->>'planDigest'=new.plan_digest
    and (r.response->>'revision')::bigint=a.authority_revision and a.authority_revision=new.expected_revision+1)
  or (select count(*) from public.custodial_dated_occurrences o where o.publication_id=new.publication_id)
    <>(select sum(jsonb_array_length(d->'assignments')) from jsonb_array_elements(new.plan->'days') d) then
  raise exception using errcode='23514',message='bounded stage must commit with complete accepted receipt and occurrences';end if;
 return new;
end $$;
revoke all on function public.custodial_dated_assert_complete() from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create constraint trigger dated_publication_complete after insert on public.custodial_dated_publications
 deferrable initially deferred for each row execute function public.custodial_dated_assert_complete();

-- Exact definitions, column/constraint/trigger state and minimal ACLs remain
-- recoverable through the existing immutable release inventory.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with relations(name) as(values('public.custodial_dated_publications'),('public.custodial_dated_activations'),
  ('public.custodial_dated_receipts'),('public.custodial_dated_occurrences')),
 funcs as(select p.oid,'public.'||p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'custodial_dated_%' or p.proname in(
  'static_weekly_v6_schedule_authority_state','static_weekly_v6_read_schedule_segments','static_weekly_v6_read_roster',
  'static_weekly_v8_read_lunch_segments','static_weekly_v5_read_employee_day','static_weekly_v27_read_home_time_facts',
  'static_weekly_v6_schedule_authority_state_dated_base','static_weekly_v6_read_schedule_segments_dated_base',
  'static_weekly_v6_read_roster_dated_base','static_weekly_v8_read_lunch_segments_dated_base','static_weekly_v5_read_employee_day_dated_base'))),
 objects as(
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 700000,'trigger',r.name||'.'||t.tgname,'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing bounded recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
