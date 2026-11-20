-- Fresh-source nonemployee capacity registration. No historical incumbent,
-- employee, publication, phone, route or completion record is changed.
-- Dated manual activation remains the existing named-manager command boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

create table public.static_weekly_contractor_capacity_registrations(
 capacity_slot_id uuid primary key references public.weekly_roster_slots(slot_id) on delete restrict,
 capacity_code text not null unique check(capacity_code ~ '^CoverAll0[1-8]$'),
 source_id uuid not null references public.static_weekly_authority_source_documents(source_id) on delete restrict,
 source_digest text not null check(source_digest ~ '^[0-9a-f]{64}$'),
 slot_snapshot jsonb not null,
 slot_digest text not null check(slot_digest ~ '^[0-9a-f]{64}$'),
 registered_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 manager_name_snapshot text not null,
 registered_at timestamptz not null default statement_timestamp(),
 check((slot_snapshot->>'id'=capacity_slot_id::text and slot_snapshot->>'capacityId'=capacity_slot_id::text
  and slot_snapshot->>'label'=capacity_code and slot_snapshot->>'kind'='CONTRACTOR_CAPACITY'
  and slot_snapshot->'contractorCapacity'='true'::jsonb and slot_snapshot->'incumbencies'='[]'::jsonb) is true)
);
create index static_weekly_capacity_registration_source on public.static_weekly_contractor_capacity_registrations(source_id);
create index static_weekly_capacity_registration_manager on public.static_weekly_contractor_capacity_registrations(registered_by_manager_id);
alter table public.static_weekly_contractor_capacity_registrations enable row level security;
alter table public.static_weekly_contractor_capacity_registrations force row level security;
revoke all on table public.static_weekly_contractor_capacity_registrations from public,anon,authenticated,service_role,
 static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;
create trigger static_weekly_capacity_registration_immutable before update or delete
 on public.static_weekly_contractor_capacity_registrations for each row execute function public.static_weekly_reject_update_delete();

create function public.static_weekly_capacity_assert_shape(p_slot jsonb) returns void
language plpgsql immutable set search_path=pg_catalog,public as $fn$
begin
 if p_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY'
  or p_slot->'contractorCapacity' is distinct from 'true'::jsonb
  or p_slot->>'id' is distinct from p_slot->>'capacityId'
  or p_slot->>'label' is null or p_slot->>'label' !~ '^CoverAll0[1-8]$'
  or p_slot->'incumbencies' is distinct from '[]'::jsonb
  or coalesce(p_slot->'vacancyCapable','false'::jsonb) is distinct from 'false'::jsonb
  or coalesce(p_slot->'declaredVacant','false'::jsonb) is distinct from 'false'::jsonb
  or jsonb_typeof(p_slot->'contractorAvailability') is distinct from 'array'
  or jsonb_array_length(p_slot->'contractorAvailability') not between 1 and 7 then
   raise exception using errcode='23514',message='nonemployee capacity requires exact typed stable identity, CoverAll01..08, no incumbent/vacancy, and registered dated templates';
 end if;
 perform public.static_weekly_v3_assert_uuid(p_slot->'id','nonemployee capacity slot id');
end $fn$;

-- Immutable registration, NOT mutable source active/retired state, decides the
-- category. No public EXECUTE; constraints/writers call it as their owner.
create function public.static_weekly_capacity_registered(p_slot jsonb) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $fn$
 select coalesce(exists(select 1 from public.static_weekly_contractor_capacity_registrations r
  join public.static_weekly_authority_source_documents s using(source_id)
  where r.capacity_slot_id::text=p_slot->>'id'
   and r.slot_snapshot=p_slot and r.slot_digest=public.static_weekly_digest_jsonb(p_slot)
   and r.source_digest=public.static_weekly_digest_jsonb(s.canonical_source)
   and exists(select 1 from jsonb_array_elements(s.canonical_source->'slots') slot where slot=r.slot_snapshot)),false)
$fn$;
revoke all on function public.static_weekly_capacity_assert_shape(jsonb),public.static_weekly_capacity_registered(jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

-- Modify only the existing initializer's explicit typed branch. Keep its
-- release-operator ACL, named manager, lock, complete preflight and replay.
do $patch$ declare body text;old text;new text;begin
 body:=pg_get_functiondef('public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text)'::regprocedure);
 old:=$s$    v_incumbencies:=v_slot->'incumbencies';
    if jsonb_typeof(v_incumbencies) is distinct from 'array' or jsonb_array_length(v_incumbencies)=0 or jsonb_array_length(v_incumbencies)>64 then$s$;
 new:=$s$    v_incumbencies:=v_slot->'incumbencies';
    if v_slot->>'kind'='CONTRACTOR_CAPACITY' then perform public.static_weekly_capacity_assert_shape(v_slot); end if;
    if jsonb_typeof(v_incumbencies) is distinct from 'array'
      or (jsonb_array_length(v_incumbencies)=0 and v_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY')
      or jsonb_array_length(v_incumbencies)>64 then$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected initializer preflight predecessor';end if;body:=replace(body,old,new);
 old:=$s$      for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop$s$;
 new:=$s$      if v_slot->>'kind'='CONTRACTOR_CAPACITY' and not public.static_weekly_capacity_registered(v_slot) then v_mismatch:=true; exit; end if;
      for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected initializer replay predecessor';end if;body:=replace(body,old,new);
 old:=$s$    for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop$s$;
 -- The replay branch has six leading spaces; use the preceding insertion end
 -- to identify only the four-space fresh-insertion branch, not its substring.
 old:=$s$    );
    for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop$s$;
 new:=$s$    );
    if v_slot->>'kind'='CONTRACTOR_CAPACITY' then
      insert into public.static_weekly_contractor_capacity_registrations(
       capacity_slot_id,capacity_code,source_id,source_digest,slot_snapshot,slot_digest,registered_by_manager_id,manager_name_snapshot)
      values(v_slot_id,v_slot->>'label',p_source_id,public.static_weekly_digest_jsonb(v_source),v_slot,
       public.static_weekly_digest_jsonb(v_slot),p_manager_id,v_actor->>'manager_name');
    end if;
    for v_incumbent in select value from jsonb_array_elements(v_slot->'incumbencies') loop$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected initializer insertion predecessor';end if;body:=replace(body,old,new);
 execute body;

 body:=pg_get_functiondef('public.static_weekly_v4_hydrate_compiler_source(jsonb,date)'::regprocedure);
 old:=$s$    v_slot_id:=v_slot->>'id';
    select coalesce(jsonb_agg$s$;
 new:=$s$    v_slot_id:=v_slot->>'id';
    if v_slot->>'kind'='CONTRACTOR_CAPACITY' then
      perform public.static_weekly_capacity_assert_shape(v_slot);
      if not public.static_weekly_capacity_registered(v_slot)
        or exists(select 1 from public.weekly_roster_slot_incumbencies where slot_id=v_slot_id::uuid)
        or v_declared_vacant ? v_slot_id then
        raise exception using errcode='23514',message='nonemployee source capacity must match immutable registration and cannot hide an incumbent/vacancy';
      end if;
      v_slots:=v_slots||jsonb_build_array(v_slot);continue;
    end if;
    select coalesce(jsonb_agg$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity hydration slot predecessor';end if;body:=replace(body,old,new);
 old:=$s$    v_slot_id:=v_item->>'slotId';
    v_date:=$s$;
 new:=$s$    v_slot_id:=v_item->>'slotId';
    if exists(select 1 from jsonb_array_elements(v_slots) slot where slot->>'id'=v_slot_id and slot->>'kind'='CONTRACTOR_CAPACITY') then
      if v_item->>'status' is distinct from 'unavailable' then
        raise exception using errcode='23514',message='registered contractor capacity cannot be activated by a recurring source';
      end if;
      v_availability:=v_availability||jsonb_build_array(v_item);continue;
    end if;
    v_date:=$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity hydration availability predecessor';end if;body:=replace(body,old,new);execute body;

 body:=pg_get_functiondef('public.static_weekly_v3_assert_draft_incumbency(uuid)'::regprocedure);
 old:=$s$    if coalesce((v_document#>'{authority,compilerInput,version,vacantSlotIds}')$s$;
 new:=$s$    if exists(select 1 from jsonb_array_elements(v_document#>'{authority,compilerInput,slots}') slot
      where slot->>'id'=v_row.slot_id::text and slot->>'kind'='CONTRACTOR_CAPACITY' and public.static_weekly_capacity_registered(slot)) then
      if v_matches<>0 or v_row.availability_state<>'unavailable'
        or v_row.incumbent_person_id_snapshot is not null or v_row.incumbent_name_snapshot is not null
        or v_is_vacant then
        raise exception using errcode='23514',message='recurring nonemployee capacity must remain unavailable with no person/vacancy';
      end if;
      continue;
    end if;
    if coalesce((v_document#>'{authority,compilerInput,version,vacantSlotIds}')$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity draft predecessor';end if;body:=replace(body,old,new);execute body;
end $patch$;

-- Stable category/FK, not a mutable lookup in a CHECK. Existing employees and
-- OPEN/REVIEW rows retain their exact old branch and NULL new metadata.
do $columns$ declare rel text;c record;begin
 foreach rel in array array['weekly_schedule_occurrences','weekly_schedule_projection_assignments'] loop
  execute format('alter table public.%I add column owner_kind text check(owner_kind is null or owner_kind=''CONTRACTOR_CAPACITY''), add column owner_capacity_id uuid references public.static_weekly_contractor_capacity_registrations(capacity_slot_id) on delete restrict',rel);
  execute format('create index %I on public.%I(owner_capacity_id)',rel||'_capacity',rel);
  select conname,pg_get_constraintdef(oid) definition into strict c from pg_constraint
   where conrelid=('public.'||rel)::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%owner_person_id_snapshot%' and pg_get_constraintdef(oid) like '%owner_slot_label_snapshot%';
  if left(c.definition,7)<>'CHECK (' then raise exception 'Unexpected owner constraint predecessor';end if;
  execute format('alter table public.%I drop constraint %I',rel,c.conname);
  execute format('alter table public.%I add constraint %I check((owner_kind is null and owner_capacity_id is null and %s) or (owner_kind=''CONTRACTOR_CAPACITY'' and owner_slot_id is not null and owner_capacity_id is not null and owner_capacity_id=owner_slot_id and owner_slot_label_snapshot is not null and owner_person_id_snapshot is null and owner_name_snapshot is null and %I=%L))',
   rel,c.conname,substr(c.definition,7),case rel when 'weekly_schedule_occurrences' then 'state' else 'status' end,
   case rel when 'weekly_schedule_occurrences' then 'created' else 'assigned' end);
 end loop;
end $columns$;

create function public.static_weekly_capacity_accepted_slot(p_publication uuid,p_date date,p_slot uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare slot jsonb;version_id uuid;
begin
 select s.value,v.version_id into slot,version_id from public.weekly_schedule_publications p
  join public.weekly_schedule_versions v using(version_id)
  cross join lateral jsonb_array_elements(v.draft_document#>'{authority,compilerInput,slots}') s(value)
  where p.publication_id=p_publication and s.value->>'id'=p_slot::text;
 if slot is null or not public.static_weekly_capacity_registered(slot)
  or exists(select 1 from public.weekly_roster_slot_incumbencies i where i.slot_id=p_slot)
  or not exists(select 1 from public.weekly_schedule_exception_commands capacity
   where capacity.base_version_id=version_id and capacity.publication_id=p_publication
    and capacity.service_date=p_date and capacity.exception_type='cover_all'
    and capacity.payload_json#>>'{availability,slotId}'=p_slot::text
    and not exists(select 1 from public.weekly_schedule_exception_commands reversal where reversal.reverses_exception_id=capacity.exception_id)) then
  raise exception using errcode='23514',message='typed capacity owner requires immutable publication source and exact accepted dated manual command';
 end if;
 return slot;
end $fn$;

create function public.static_weekly_capacity_assert_projection_owner(p_envelope jsonb,p_publication uuid,p_row jsonb) returns void
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare availability jsonb;optimizer jsonb;capacity jsonb;
begin
 if p_row->>'owner_kind' is null and p_row->>'capacity_id' is null then return;end if;
 if p_row->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or p_row->>'status' is distinct from 'assigned'
  or p_row->>'capacity_id' is distinct from p_row->>'owner_slot_id'
  or p_row->'owner_person_id' is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='typed contractor projection cannot invent employee identity or mismatched capacity';
 end if;
 perform public.static_weekly_capacity_accepted_slot(p_publication,(p_row->>'service_date')::date,(p_row->>'owner_slot_id')::uuid);
 select value into strict optimizer from jsonb_array_elements(p_envelope#>'{authority,optimizerResult,assignments}')
  where value->>'planWorkId'=p_row->>'plan_work_id';
 if optimizer->>'ownerKind' is distinct from p_row->>'owner_kind' or optimizer->>'capacityId' is distinct from p_row->>'capacity_id'
  or optimizer->'personId' is distinct from 'null'::jsonb or optimizer->'displayName' is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='capacity projection must bind exact independently verified optimizer category';
 end if;
 select value into strict availability from jsonb_array_elements(p_envelope#>'{authority,projectionAvailability}')
  where value->>'slotId'=p_row->>'owner_slot_id' and value->>'serviceDate'=p_row->>'service_date';
 select payload_json->'availability' into capacity from public.weekly_schedule_exception_commands e
  where e.publication_id=p_publication and e.service_date=(p_row->>'service_date')::date and e.exception_type='cover_all'
   and e.payload_json#>>'{availability,slotId}'=p_row->>'owner_slot_id'
   and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  order by authority_revision desc limit 1;
 if availability->>'status' is distinct from 'working' or availability->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY'
  or availability->>'capacityId' is distinct from p_row->>'capacity_id' or availability->'incumbentPersonId' is distinct from 'null'::jsonb
  or availability->'shift' is distinct from capacity->'shift'
  or availability->'qualifications' is distinct from capacity->'qualifications'
  or availability->'restrictions' is distinct from capacity->'restrictions' then
  raise exception using errcode='23514',message='contractor owner requires exact accepted current dated shift/eligibility facts';
 end if;
end $fn$;
revoke all on function public.static_weekly_capacity_accepted_slot(uuid,date,uuid),public.static_weekly_capacity_assert_projection_owner(jsonb,uuid,jsonb)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

do $writer$ declare body text;old text;new text;begin
 body:=pg_get_functiondef('public.static_weekly_v2_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 old:=$s$if upper(v_item->>'status')='ASSIGNED' then select * into v_owner$s$;
 new:=$s$perform public.static_weekly_capacity_assert_projection_owner(p_assignments,p_publication_id,v_item);
    if upper(v_item->>'status')='ASSIGNED' and v_item->>'owner_kind'='CONTRACTOR_CAPACITY' then
      v_owner:=null;
    elsif upper(v_item->>'status')='ASSIGNED' then select * into v_owner$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity assigned-owner predecessor';end if;body:=replace(body,old,new);
 old:='owner_person_id_snapshot,owner_name_snapshot';new:=old||',owner_kind,owner_capacity_id';
 if length(body)-length(replace(body,old,''))<>length(old)*2 then raise exception 'Unexpected dated owner-column insert predecessor';end if;body:=replace(body,old,new);
 old:=$s$case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,$s$;
 new:=old||$s$nullif(v_item->>'owner_kind',''),nullif(v_item->>'capacity_id','')::uuid,$s$;
 if length(body)-length(replace(body,old,''))<>length(old)*2 then raise exception 'Unexpected dated owner-value insert predecessor';end if;body:=replace(body,old,new);
 old:=$s$'work_snapshot',v_work),public.static_weekly_digest_jsonb(v_item)$s$;
 new:=$s$'work_snapshot',v_work)||case when v_item->>'owner_kind'='CONTRACTOR_CAPACITY' then jsonb_build_object('owner_kind','CONTRACTOR_CAPACITY','capacity_id',v_item->>'capacity_id') else '{}'::jsonb end,public.static_weekly_digest_jsonb(v_item)$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity authority-facts predecessor';end if;body:=replace(body,old,new);execute body;

 -- The frozen dated-reader wrapper is untouched. Its underlying source now
 -- records an honest nonemployee type into NEW snapshots; old rows stay old.
 body:=pg_get_functiondef('public.static_weekly_v6_read_schedule_segments_dated_base(date)'::regprocedure);
 old:=$s$case when occurrence.state = 'created' and occurrence.owner_person_id_snapshot is not null
      then 'EMPLOYEE' else 'OPEN' end$s$;
 new:=$s$case when occurrence.state='created' and occurrence.owner_kind='CONTRACTOR_CAPACITY' then 'COVERALL'
      when occurrence.state = 'created' and occurrence.owner_person_id_snapshot is not null
      then 'EMPLOYEE' else 'OPEN' end$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity segment type predecessor';end if;body:=replace(body,old,new);
 old:=$s$    occurrence.state_reason,
    'static_weekly_projection'::text,$s$;
 new:=$s$    case when occurrence.owner_kind='CONTRACTOR_CAPACITY' then concat_ws(' — ',occurrence.owner_slot_label_snapshot,occurrence.state_reason) else occurrence.state_reason end,
    'static_weekly_projection'::text,$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected capacity display predecessor';end if;body:=replace(body,old,new);execute body;
end $writer$;

create function public.static_weekly_capacity_assert_lunch_party(p_projection uuid,p_row jsonb,p_prefix text) returns void
language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare projection public.weekly_schedule_compiled_projections%rowtype;availability jsonb;slot_id text;capacity_id text;
begin
 if p_prefix not in('normal_owner','coverer') then raise exception 'Invalid private lunch party';end if;
 slot_id:=p_row->>(p_prefix||'_slot_id');capacity_id:=p_row->>(p_prefix||'_capacity_id');
 if not (p_row ? (p_prefix||'_capacity_id')) then
  if nullif(p_row->>(p_prefix||'_person_id'),'') is null then
   raise exception using errcode='23514',message='ordinary lunch party still requires a real incumbent person';
  end if;
  return;
 end if;
 if capacity_id is null or capacity_id is distinct from slot_id
  or p_row->(p_prefix||'_person_id') is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='typed lunch party requires matching capacity identity and explicit null person';
 end if;
 select * into strict projection from public.weekly_schedule_compiled_projections where projection_id=p_projection;
 perform public.static_weekly_capacity_accepted_slot(projection.publication_id,(p_row->>'service_date')::date,slot_id::uuid);
 select value into strict availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
  where value->>'slotId'=slot_id and value->>'serviceDate'=p_row->>'service_date';
 if availability->>'status' is distinct from 'working' or availability->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY'
  or availability->>'capacityId' is distinct from capacity_id or availability->'incumbentPersonId' is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='typed lunch party must bind exact accepted nonemployee projection availability';
 end if;
end $fn$;
revoke all on function public.static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823;

do $lunch$ declare body text;old text;new text;begin
 body:=pg_get_functiondef('public.static_weekly_v8_assert_lunch_document(uuid,jsonb)'::regprocedure);
 old:=$s$where value->>'status'='working' and nullif(value->>'incumbentPersonId','') is not null;$s$;
 new:=$s$where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY');$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch owner inventory predecessor';end if;body:=replace(body,old,new);
 old:=$s$  perform public.static_weekly_assert_exact_object(loan,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'],
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');$s$;
 new:=$s$  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,loan,'normal_owner');
  perform public.static_weekly_assert_exact_object(loan,
   case when loan ? 'normal_owner_capacity_id' then array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_capacity_id','coverage_start','coverage_end','status','helper_slot_ids']
    else array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'] end,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch exact-loan predecessor';end if;body:=replace(body,old,new);
 old:=$s$or nullif(helper->>'incumbentPersonId','') is null or helper#>>'{lunch,start}' is null$s$;
 new:=$s$or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY') or helper#>>'{lunch,start}' is null$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch helper identity predecessor';end if;body:=replace(body,old,new);
 old:=$s$  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');$s$;
 new:=$s$  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'normal_owner');
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'coverer');
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','coverer_slot_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments']
    ||case when responsibility ? 'normal_owner_capacity_id' then array['normal_owner_capacity_id'] else array['normal_owner_person_id'] end
    ||case when responsibility ? 'coverer_capacity_id' then array['coverer_capacity_id'] else array['coverer_person_id'] end,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverer_slot_id','coverer_person_id','coverer_capacity_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch exact-responsibility predecessor';end if;body:=replace(body,old,new);
 old:=$s$ cross join unnest(array['start','end']) e;$s$;
 new:=$s$ cross join unnest(array['start','end']) e
 where exists(select 1 from jsonb_array_elements(projection_availability) a
  where a->>'slotId'=h and a->>'serviceDate'=l->>'service_date' and nullif(a->>'incumbentPersonId','') is not null);$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch recipient inventory predecessor';end if;body:=replace(body,old,new);execute body;
end $lunch$;

do $readers$ declare body text;old text;new text;begin
 body:=pg_get_functiondef('public.static_weekly_v8_read_lunch_segments_dated_base(date)'::regprocedure);
 old:=$s$o.owner_person_id_snapshot::text=r->>'normal_owner_person_id'$s$;
 new:=$s$o.owner_person_id_snapshot::text is not distinct from r->>'normal_owner_person_id'
  and o.owner_capacity_id::text is not distinct from r->>'normal_owner_capacity_id'$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch normal-owner reader predecessor';end if;body:=replace(body,old,new);
 old:=$s$(r->>'coverer_person_id')::uuid,e.display_name,g.id$s$;
 new:=$s$(r->>'coverer_person_id')::uuid,coalesce(e.display_name,c.capacity_code),g.id$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch display reader predecessor';end if;body:=replace(body,old,new);
 old:=$s$ join public.employees e on e.id=(r->>'coverer_person_id')::uuid and e.active=true$s$;
 new:=$s$ left join public.employees e on e.id=(r->>'coverer_person_id')::uuid and e.active=true
 left join public.static_weekly_contractor_capacity_registrations c
  on c.capacity_slot_id::text=r->>'coverer_capacity_id' and c.capacity_slot_id::text=r->>'coverer_slot_id'
  and r->'coverer_person_id'='null'::jsonb$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch helper reader predecessor';end if;body:=replace(body,old,new);
 old:=$s$ where r->>'service_date'=p_service_date::text$s$;
 new:=$s$ where r->>'service_date'=p_service_date::text and (e.id is not null or c.capacity_slot_id is not null)$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch actor reader predecessor';end if;body:=replace(body,old,new);execute body;

 -- NULL for a nonemployee helper is meaningful. It must never fall back to
 -- the employee whose responsibility was temporarily loaned away.
 body:=pg_get_functiondef('public.custodial_operational_location_assignments(date)'::regprocedure);
 old:=$s$coalesce(l.coverer_id,b.assigned_employee_id),coalesce(l.coverer_name,b.assigned_employee_name)$s$;
 new:=$s$case when l.responsibility_id is null then b.assigned_employee_id else l.coverer_id end,
    case when l.responsibility_id is null then b.assigned_employee_name when l.coverer_id is not null then l.coverer_name else null end$s$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'Unexpected lunch operational actor predecessor';end if;body:=replace(body,old,new);execute body;
end $readers$;

-- Explicit ACL after replacement (no widening from CREATE FUNCTION defaults).
revoke all on function public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v6_initialize_registered_roster(uuid,uuid,text) to static_weekly_release_operator;

-- Owning recovery inventory follows the actual definitions, including private
-- lookup ACL and append-only registration. No unrelated health normalization.
do $recovery$ declare obj record;ord integer;changed integer;begin
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then raise exception 'Recovery immutability unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 for obj in select * from (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition from pg_proc p where pronamespace='public'::regnamespace and proname in('static_weekly_capacity_assert_shape','static_weekly_capacity_registered','static_weekly_capacity_accepted_slot','static_weekly_capacity_assert_projection_owner','static_weekly_capacity_assert_lunch_party','static_weekly_v6_initialize_registered_roster','static_weekly_v4_hydrate_compiler_source','static_weekly_v3_assert_draft_incumbency','static_weekly_v2_materialize_projection','static_weekly_v6_read_schedule_segments_dated_base','static_weekly_v8_assert_lunch_document','static_weekly_v8_read_lunch_segments_dated_base','custodial_operational_location_assignments')
  union all select 900000,'grant',p.oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) from pg_proc p where pronamespace='public'::regnamespace and proname in('static_weekly_capacity_assert_shape','static_weekly_capacity_registered','static_weekly_capacity_accepted_slot','static_weekly_capacity_assert_projection_owner','static_weekly_capacity_assert_lunch_party','static_weekly_v6_initialize_registered_roster','static_weekly_v4_hydrate_compiler_source','static_weekly_v3_assert_draft_incumbency','static_weekly_v2_materialize_projection','static_weekly_v6_read_schedule_segments_dated_base','static_weekly_v8_assert_lunch_document','static_weekly_v8_read_lunch_segments_dated_base','custodial_operational_location_assignments')
  union all select x.* from (values('public.static_weekly_contractor_capacity_registrations'),('public.weekly_schedule_occurrences'),('public.weekly_schedule_projection_assignments')) tables(rel) cross join lateral (
   select 1000,'relation'::text,rel,public.custodial_release_authority_current_relation_definition(rel)
   union all select 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname) from pg_attribute where attrelid=rel::regclass and attnum>0 and not attisdropped
   union all select 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
   union all select 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
   union all select 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname) from pg_constraint where conrelid=rel::regclass
   union all select 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text) from pg_index i where indrelid=rel::regclass and not exists(select 1 from pg_constraint where conindid=i.indexrelid)
   union all select 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '||pg_get_triggerdef(oid,true)||'; alter table '||rel||' enable trigger '||quote_ident(tgname)||';' from pg_trigger where tgrelid=rel::regclass and not tgisinternal
   union all select 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x
 ) objects order by bucket,identity loop
  if obj.definition is null then raise exception 'Missing capacity recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or (obj.kind in('function','grant') and obj.identity like '%(%' and object_identity like '%(%' and to_regprocedure(object_identity)=to_regprocedure(obj.identity)));
  get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate recovery identity';end if;
  if changed=0 then
   select n into ord from generate_series(obj.bucket+1,(case when obj.bucket=1000 then 100000 else obj.bucket+100000 end)-1) n where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n) order by n limit 1;
   if ord is null then raise exception 'Recovery order exhausted';end if;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
 alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
