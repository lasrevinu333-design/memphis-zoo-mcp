begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog;
create function public.mz_is_approved_admin_location(p_location uuid,p_now timestamptz) returns boolean language sql immutable set search_path=pg_catalog,public as $$ select coalesce((p_now at time zone 'America/Chicago')::date>=date '2026-10-01' and p_location in('12c90b1e-d53e-47b6-860e-823ae0fee1a8'::uuid,'181a8d59-3a98-4823-8ca4-b9ecd958d90e'::uuid,'198be106-b98d-4604-b323-a0c8d5e4fd1a'::uuid,'58418743-10d7-4d22-97f8-1a33d4a969d4'::uuid,'7fdde9c1-b334-4adc-ae3e-350ff9419b2b'::uuid,'a8fa8f6b-6a90-4448-a125-ea1045fbe261'::uuid,'c33d6d08-95bb-40df-ad88-03482df6165d'::uuid,'c51107e4-2d66-487b-9765-09489e2f84c9'::uuid),false) $$;
create function public.mz_verified_location_reminder_cycle(p_location uuid,p_form_type text,p_cleaned_at timestamptz,p_checked_at timestamptz,p_now timestamptz)
returns table(cycle_base_at timestamptz,cycle_base_evidence text,due_soon_at timestamptz,overdue_at timestamptz,status_code text,repeat_index bigint)
language sql stable security definer set search_path=pg_catalog,public as $$
 with original as materialized (select * from public.mz_verified_visit_reminder_cycle(p_form_type,p_cleaned_at,p_checked_at,p_now)),
 policy as materialized(select original.*,public.mz_is_approved_admin_location(p_location,p_now) admin from original),
 deadlines as(select cycle_base_at,cycle_base_evidence,
  case when admin then cycle_base_at+interval '165 minutes' else due_soon_at end soon,
  case when admin then cycle_base_at+interval '180 minutes' else overdue_at end overdue from policy)
 select cycle_base_at,cycle_base_evidence,soon,overdue,
  case when p_now>=overdue then 'overdue' when p_now>=soon then 'due_soon' else null end,
  case when p_now>=overdue then floor(extract(epoch from(p_now-overdue))/300)::bigint else 0 end from deadlines;
$$;
revoke all on function public.mz_is_approved_admin_location(uuid,timestamptz),public.mz_verified_location_reminder_cycle(uuid,text,timestamptz,timestamptz,timestamptz)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.mz_is_approved_admin_location(uuid,timestamptz) to service_role,custodial_application_reader;
grant execute on function public.mz_verified_location_reminder_cycle(uuid,text,timestamptz,timestamptz,timestamptz) to service_role;
create or replace function public.custodial_dated_rows(kind text,p_date date) returns jsonb language plpgsql stable
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
   'coverage_purpose',case when a#>>'{workSnapshot,serviceMode}'='reminder_only' then 'reminder' when a#>>'{workSnapshot,serviceMode}'='response_only_no_clean' then 'response_only_no_clean' else 'area_owner' end,
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
create or replace function public.static_weekly_v5_read_employee_day(p_service_date date,p_employee_id uuid,p_now timestamptz default now())
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
 phase:=case when not working then 'off_day' when (p_now at time zone 'America/Chicago')::date<p_service_date or ((p_now at time zone 'America/Chicago')::date=p_service_date and (p_now at time zone 'America/Chicago')::time<(roster->>'shift_start')::time) then 'before_shift'
  when (p_now at time zone 'America/Chicago')::date>p_service_date or ((p_now at time zone 'America/Chicago')::date=p_service_date and (p_now at time zone 'America/Chicago')::time>=(roster->>'shift_end')::time) then 'after_shift' else 'assigned_areas' end;
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
-- Parsed views retain function OIDs across renames. Explicitly rebind those
-- three consumers, retaining columns, view identities and existing ACLs.
do $views$
declare name text;definition text;kind text;minutes integer;
begin
 foreach name in array array['v_location_dashboard_status','v_memphis_area_schedule','v_restroom_check_timers'] loop
  definition:=pg_get_viewdef(('public.'||name)::regclass,true);
  definition:=replace(definition,'static_weekly_v6_schedule_authority_state_dated_base(','static_weekly_v6_schedule_authority_state(');
  definition:=replace(definition,'static_weekly_v6_read_schedule_segments_dated_base(','static_weekly_v6_read_schedule_segments(');
  if name='v_location_dashboard_status' then
   -- Preserve generic configured intervals; only exact approved Admin IDs get
   -- the new three-hour policy, beginning October1. Evidence/reset joins stay.
   foreach kind in array array['restroom','exhibit'] loop
    foreach minutes in array array[case when kind='restroom' then 90 else 210 end,case when kind='restroom' then 75 else 195 end] loop
     definition:=replace(definition,format('public.get_setting_int(%L::text, %s)',kind||case when minutes in(90,210) then '_overdue_minutes' else '_due_soon_minutes' end,minutes),
       format('(case when public.mz_is_approved_admin_location(truth.location_id, now()) then %s else public.get_setting_int(%L::text, %s) end)',case when minutes in(90,210) then 180 else 165 end,kind||case when minutes in(90,210) then '_overdue_minutes' else '_due_soon_minutes' end,minutes));
    end loop;
   end loop;
  end if;
  execute format('create or replace view public.%I as %s',name,definition);
 end loop;
end $views$;

-- The area view's date union must admit active four-day authority even when
-- there are no legacy/weekly rows. A private definer reader exposes dates only.
create function public.custodial_dated_service_dates() returns table(service_date date)
language sql stable security definer set search_path=pg_catalog,public as $$
 select (d->>'serviceDate')::date from jsonb_array_elements(public.custodial_dated_record()->'days') d
$$;
revoke all on function public.custodial_dated_service_dates() from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.custodial_dated_service_dates() to custodial_application_reader,service_role;
create or replace view public.v_memphis_area_schedule as
with authority_dates as (
 select distinct occurrence.service_date from public.weekly_schedule_occurrences occurrence
 union select distinct assignment.service_date from public.daily_schedule_assignments assignment
 union select service_date from public.custodial_dated_service_dates()
)
select segment.service_date,segment.location_group_id,segment.group_code,segment.group_name,
 segment.segment_number,segment.assigned_employee_id,segment.assigned_employee_name,employee.employee_code,
 left(segment.coverage_start,5) as coverage_start,left(segment.coverage_end,5) as coverage_end,
 segment.status,segment.owner_type,segment.load_points::numeric(10,2),segment.source_type,segment.notes
from authority_dates authority_date
cross join lateral public.static_weekly_v6_read_schedule_segments(authority_date.service_date) segment
left join public.employees employee on employee.id=segment.assigned_employee_id;

-- Keep the existing function OID so stored callers see the location-aware
-- calculation. Its original completion/check evidence and no-cleaning guards
-- remain unchanged.
do $reminder$
declare definition text;
begin
 definition:=pg_get_functiondef('public.mz_location_reminder_candidates(date,timestamptz)'::regprocedure);
 definition:=replace(definition,'public.mz_verified_visit_reminder_cycle(', 'public.mz_verified_location_reminder_cycle(status.location_id,');
 execute definition;
end $reminder$;
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
 for obj in with funcs as(select p.oid,p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('mz_is_approved_admin_location','mz_verified_location_reminder_cycle','custodial_dated_service_dates','custodial_dated_rows','static_weekly_v5_read_employee_day','mz_location_reminder_candidates')),
 views(identity) as(values('public.v_location_dashboard_status'),('public.v_memphis_area_schedule'),('public.v_restroom_check_timers')),
 objects as(
 select 100000 bucket,'function'::text kind,identity,pg_get_functiondef(oid) definition from funcs
 union all select 800000,'view',identity,'create or replace view '||identity||' as '||pg_get_viewdef(identity::regclass,true)||';' from views
 union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from views
 ) select * from objects order by bucket,identity loop
 if obj.definition is null then raise exception 'missing consumer recovery object %',obj.identity;end if;
 update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
 where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in('function','grant') and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
 if not found then
 select coalesce(max(restore_order),obj.bucket)+1 into next_order from public.custodial_release_authority_restore_inventory where restore_order>=obj.bucket and restore_order<obj.bucket+100000;
 insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256) values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 end if;end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
