begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Temporary responsibility is an immutable companion of a verified projection.
-- It never updates normal ownership, cleaning history, or reminder timestamps.
create table public.weekly_schedule_lunch_documents (
 projection_id uuid primary key references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 document_identity text not null check(document_identity ~ '^[0-9a-f]{64}$'),
 document_json jsonb not null check(jsonb_typeof(document_json)='object'),
 accepted_by_manager_id uuid not null,
 accepted_at timestamptz not null default statement_timestamp()
);
alter table public.weekly_schedule_lunch_documents enable row level security;
alter table public.weekly_schedule_lunch_documents force row level security;
revoke all on public.weekly_schedule_lunch_documents from public,anon,authenticated,service_role,static_weekly_control_plane;
create trigger trg_weekly_schedule_lunch_documents_immutable
 before update or delete on public.weekly_schedule_lunch_documents
 for each row execute function public.static_weekly_reject_update_delete();

create or replace function public.static_weekly_v8_assert_lunch_document(
 p_projection_id uuid,p_document jsonb
) returns void language plpgsql security definer
set search_path=pg_catalog,public as $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection is missing'; end if;
 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,inputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
 where value->>'status'='working' and nullif(value->>'incumbentPersonId','') is not null;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  perform public.static_weekly_assert_exact_object(loan,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'],
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time-start_time<>interval '1 hour' then raise exception 'lunch must last exactly one hour'; end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
      or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or nullif(helper->>'incumbentPersonId','') is null or helper#>>'{lunch,start}' is null
    or helper#>>'{lunch,end}' is null or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations'],array['planWorkId','workId','serviceMode','window','includedLocations'],'lunch segment');
   select value into base_work from jsonb_array_elements(projection.projection_envelope->'assignments')
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or (base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id')
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   if (segment#>>'{window,start}')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (segment#>>'{window,end}')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
  end loop;
 end loop;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection.projection_envelope->'assignments') a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}') w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e;
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
end $function$;

create or replace function public.static_weekly_v8_materialize_lunch_document(
 p_projection_id uuid,p_document jsonb,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare projection public.weekly_schedule_compiled_projections%rowtype;
 existing public.weekly_schedule_lunch_documents%rowtype;current_authority record;inserted integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection does not exist'; end if;
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(projection.week_start);
 if current_authority.projection_status is distinct from 'current'
  or current_authority.projection_id is distinct from p_projection_id then raise exception 'lunch projection is not current'; end if;
 perform public.static_weekly_v8_assert_lunch_document(p_projection_id,p_document);
 insert into public.weekly_schedule_lunch_documents(projection_id,document_identity,document_json,accepted_by_manager_id)
 values(p_projection_id,p_document->>'document_identity',p_document,p_manager_id) on conflict(projection_id) do nothing;
 get diagnostics inserted=row_count;
 select * into strict existing from public.weekly_schedule_lunch_documents where projection_id=p_projection_id;
 if existing.document_json is distinct from p_document then raise exception 'immutable lunch publication conflicts with existing authority'; end if;
 return jsonb_build_object('ok',true,'persistence_status','PERSISTED','projection_id',p_projection_id,
  'document_identity',existing.document_identity,'replayed',inserted=0);
end $function$;

create or replace function public.static_weekly_v8_read_lunch_document(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare current_authority record;stored public.weekly_schedule_lunch_documents%rowtype;
begin
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 if current_authority.projection_status is distinct from 'current' then
  return jsonb_build_object('persistence_status','UNAVAILABLE','projection_status',current_authority.projection_status); end if;
 select * into stored from public.weekly_schedule_lunch_documents where projection_id=current_authority.projection_id;
 if not found then return jsonb_build_object('persistence_status','MISSING','projection_id',current_authority.projection_id); end if;
 return jsonb_build_object('persistence_status','PERSISTED','projection_id',stored.projection_id,
  'document_identity',stored.document_identity,'service_date',p_service_date,
  'loans',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'loans') where value->>'service_date'=p_service_date::text),'[]'::jsonb),
  'responsibilities',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'responsibilities') where value->>'service_date'=p_service_date::text),'[]'::jsonb));
end $function$;

revoke all on function public.static_weekly_v8_assert_lunch_document(uuid,jsonb),
 public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid),
 public.static_weekly_v8_read_lunch_document(date) from public,anon,authenticated,service_role;
grant execute on function public.static_weekly_v8_assert_lunch_document(uuid,jsonb),
 public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid) to postgres,static_weekly_control_plane;
grant execute on function public.static_weekly_v8_read_lunch_document(date) to postgres,service_role,static_weekly_control_plane,custodial_application_reader;
comment on table public.weekly_schedule_lunch_documents is
 'Immutable verified temporary lunch responsibility bound to one accepted weekly projection; normal ownership and visit clocks are unchanged.';

-- Read temporary responsibilities only from the accepted current publication.
create or replace function public.static_weekly_v8_read_lunch_segments(p_service_date date)
returns table(projection_id uuid,loan_id text,responsibility_id text,normal_occurrence_id uuid,
 normal_owner_id uuid,coverer_id uuid,coverer_name text,location_group_id uuid,group_code text,
 group_name text,included_locations text[],included_location_ids uuid[],included_snapshots jsonb,
 service_mode text,coverage_start time,coverage_end time)
language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare authority record;document jsonb;expected_count integer;actual_count integer;
begin
 select * into strict authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 if not authority.governed or authority.projection_status<>'current' then return; end if;
 document:=public.static_weekly_v8_read_lunch_document(p_service_date);
 if document->>'persistence_status' is distinct from 'PERSISTED'
  or document->>'projection_id' is distinct from authority.projection_id::text then
  raise exception using errcode='55000',message='current lunch coverage is unavailable; republish the weekly schedule';
 end if;
 select count(*) into expected_count from jsonb_array_elements(document->'responsibilities') r
 cross join lateral jsonb_array_elements(r->'segments') s;
 return query select authority.projection_id,r->>'loan_id',r->>'responsibility_id',o.occurrence_id,
 o.owner_person_id_snapshot,(r->>'coverer_person_id')::uuid,e.display_name,g.id,g.group_code,g.group_name,
 array(select x->>'locationNameSnapshot' from jsonb_array_elements(s->'includedLocations') x),
 array(select (x->>'locationId')::uuid from jsonb_array_elements(s->'includedLocations') x),
 s->'includedLocations',s->>'serviceMode',(s#>>'{window,start}')::time,(s#>>'{window,end}')::time
 from jsonb_array_elements(document->'responsibilities') r
 cross join lateral jsonb_array_elements(r->'segments') s
 join public.weekly_schedule_occurrences o on o.projection_id=authority.projection_id
  and o.service_date=p_service_date and o.work_id=s->>'workId'
  and o.owner_person_id_snapshot::text=r->>'normal_owner_person_id'
  and o.owner_slot_id::text=r->>'normal_owner_slot_id' and o.state='created'
  and o.coverage_start<=(s#>>'{window,start}')::time
  and o.coverage_end>=(s#>>'{window,end}')::time
  and o.authority_facts_json#>'{work_snapshot,includedLocations}'=s->'includedLocations'
  and o.authority_facts_json#>>'{work_snapshot,serviceMode}'=s->>'serviceMode'
 join public.employees e on e.id=(r->>'coverer_person_id')::uuid and e.active=true
 join public.location_groups g on upper(g.group_code)=upper(o.location_code_snapshot) and g.active=true
 where r->>'service_date'=p_service_date::text
 order by (s#>>'{window,start}')::time,r->>'loan_id',r->>'responsibility_id',o.occurrence_id;
 get diagnostics actual_count=row_count;
 if actual_count<>expected_count then
  raise exception using errcode='55000',message='accepted lunch coverage no longer maps exactly to current areas and employees';
 end if;
end $function$;
revoke all on function public.static_weekly_v8_read_lunch_segments(date)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v8_read_lunch_segments(date)
 to custodial_application_reader;
comment on function public.static_weekly_v8_read_lunch_segments(date) is
 'Current accepted lunch responsibility with original occurrence identity; missing current publication fails closed.';


create or replace function public.custodial_operational_location_assignments(
  p_service_date date
) returns table(
  service_date date,
  authority_source text,
  projection_status text,
  version_id uuid,
  publication_id uuid,
  projection_id uuid,
  occurrence_id uuid,
  location_group_id uuid,
  group_code text,
  group_name text,
  assigned_employee_id uuid,
  assigned_employee_name text,
  assignment_status text,
  coverage_start time,
  coverage_end time,
  location_id uuid,
  location_code text,
  location_name text,
  form_type text
) language sql stable security definer
set search_path = pg_catalog, public
as $function$
  with base(service_date,authority_source,projection_status,version_id,publication_id,projection_id,occurrence_id,location_group_id,group_code,group_name,assigned_employee_id,assigned_employee_name,assignment_status,coverage_start,coverage_end,location_id,location_code,location_name,form_type) as materialized (
    select segment.service_date,
    segment.source_type,
    segment.projection_status,
    segment.version_id,
    segment.publication_id,
    segment.projection_id,
    segment.segment_id,
    segment.location_group_id,
    segment.group_code,
    segment.group_name,
    segment.assigned_employee_id,
    segment.assigned_employee_name,
    segment.status,
    segment.coverage_start::time,
    segment.coverage_end::time,
    location.id,
    location.location_code,
    location.location_name,
    location.form_type
  from public.static_weekly_v6_read_schedule_segments(p_service_date) segment
  cross join lateral unnest(segment.included_location_ids) included(location_id)
  join public.locations location on location.id = included.location_id and location.active = true
  where segment.service_mode = 'scan_tracked'
  ), lunch as materialized (
    select * from public.static_weekly_v8_read_lunch_segments(p_service_date)
    where service_mode='scan_tracked'
  ), cuts as (
    select occurrence_id,location_id,coverage_start as boundary from base
    union select occurrence_id,location_id,coverage_end from base
    union select b.occurrence_id,b.location_id,l.coverage_start from base b join lunch l
      on l.normal_occurrence_id=b.occurrence_id and b.location_id=any(l.included_location_ids)
    union select b.occurrence_id,b.location_id,l.coverage_end from base b join lunch l
      on l.normal_occurrence_id=b.occurrence_id and b.location_id=any(l.included_location_ids)
  ), pieces as (
    select occurrence_id,location_id,boundary as starts,
      lead(boundary) over(partition by occurrence_id,location_id order by boundary) as ends
    from cuts
  ) select b.service_date,
    case when l.responsibility_id is null then b.authority_source else 'static_weekly_lunch_coverage' end,
    b.projection_status,b.version_id,b.publication_id,b.projection_id,b.occurrence_id,
    b.location_group_id,b.group_code,b.group_name,
    coalesce(l.coverer_id,b.assigned_employee_id),coalesce(l.coverer_name,b.assigned_employee_name),
    b.assignment_status,p.starts,p.ends,b.location_id,b.location_code,b.location_name,b.form_type
  from base b join pieces p on p.occurrence_id is not distinct from b.occurrence_id
    and p.location_id=b.location_id and p.starts>=b.coverage_start and p.ends<=b.coverage_end
  left join lunch l on l.normal_occurrence_id=b.occurrence_id
    and b.location_id=any(l.included_location_ids) and p.starts>=l.coverage_start and p.ends<=l.coverage_end
  where p.starts<p.ends

$function$;

create or replace function public.static_weekly_v5_read_employee_day(
  p_service_date date,p_employee_id uuid,p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare
  v_result jsonb;
  v_field text;
  v_items jsonb;
  v_lunch_items jsonb;
  v_current_lunch jsonb;
begin
  v_result:=public.static_weekly_v5_read_employee_day_single_location_base(p_service_date,p_employee_id,p_now);
  foreach v_field in array array['items','all_items','current_items'] loop
    select coalesce(jsonb_agg(
      case when o.occurrence_id is null then item.value
      else item.value||jsonb_build_object(
        'service_mode',i.service_mode,
        'included_locations',i.location_names,
        'included_location_ids',i.location_ids,
        'included_location_snapshots',i.location_snapshots,
        'is_public_restroom',case when i.service_mode='scan_tracked' then i.has_public_restroom else false end
      ) end
      order by item.ordinality
    ),'[]'::jsonb) into v_items
    from jsonb_array_elements(coalesce(v_result->v_field,'[]'::jsonb)) with ordinality item(value,ordinality)
    left join public.weekly_schedule_occurrences o on o.occurrence_id::text=item.value->>'occurrence_id'
    left join lateral (
      select
        coalesce(o.authority_facts_json#>>'{work_snapshot,serviceMode}','scan_tracked') as service_mode,
        coalesce(jsonb_agg(location.value order by location.ordinality) filter(where location.value is not null),'[]'::jsonb) as location_snapshots,
        coalesce(jsonb_agg(to_jsonb(location.value->>'locationId') order by location.ordinality) filter(where location.value is not null),'[]'::jsonb) as location_ids,
        coalesce(jsonb_agg(to_jsonb(location.value->>'locationNameSnapshot') order by location.ordinality) filter(where location.value is not null),'[]'::jsonb) as location_names,
        coalesce(bool_or(lower(location.value->>'locationNameSnapshot') like '%restroom%'
          or lower(location.value->>'locationNameSnapshot') like '%bathroom%') filter(where location.value is not null),false) as has_public_restroom
      from jsonb_array_elements(
        case when jsonb_typeof(o.authority_facts_json#>'{work_snapshot,includedLocations}')='array'
          then o.authority_facts_json#>'{work_snapshot,includedLocations}' else '[]'::jsonb end
      ) with ordinality location(value,ordinality)
    ) i on true;
    v_result:=jsonb_set(v_result,array[v_field],v_items,true);
  end loop;
  if v_result->>'governed'='true' and v_result->>'projection_status'='current' then
    -- Same accepted reader drives employee display and operational reminder ownership.
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.responsibility_id||':'||l.normal_occurrence_id::text,
      'occurrence_id',l.normal_occurrence_id::text,'normal_occurrence_id',l.normal_occurrence_id::text,
      'projection_id',l.projection_id::text,'service_date',p_service_date::text,
      'loan_id',l.loan_id,'responsibility_id',l.responsibility_id,
      'normal_owner_person_id',l.normal_owner_id::text,'coverer_person_id',l.coverer_id::text,
      'location_group_id',l.location_group_id::text,'group_code',l.group_code,'group_name',l.group_name,
      'location_group_code',l.group_code,'location_group_name',l.group_name,'location_name',l.group_name,
      'included_locations',to_jsonb(l.included_locations),'included_location_ids',to_jsonb(l.included_location_ids),
      'included_location_snapshots',l.included_snapshots,'service_mode',l.service_mode,
      'coverage_start',to_char(l.coverage_start,'HH24:MI:SS'),'coverage_end',to_char(l.coverage_end,'HH24:MI:SS'),
      'start_time',to_char(l.coverage_start,'HH24:MI:SS'),'end_time',to_char(l.coverage_end,'HH24:MI:SS'),
      'coverage_purpose','lunch_coverage','purpose','lunch_coverage','section_title','Lunch coverage',
      'source_type','static_weekly_lunch_coverage','owner_type','EMPLOYEE','status','ASSIGNED',
      'load_points',0,'notes','Temporary responsibility; existing check deadlines unchanged.',
      'check_deadline_policy','inherit_existing_90_minute_deadline','creates_deep_clean',false,
      'is_public_restroom',l.service_mode='scan_tracked' and public.sch_is_public_restroom_group(l.location_group_id)
    ) order by l.coverage_start,l.loan_id,l.responsibility_id,l.normal_occurrence_id),'[]') into v_lunch_items
    from public.static_weekly_v8_read_lunch_segments(p_service_date) l where l.coverer_id=p_employee_id;
    select coalesce(jsonb_agg(item order by ordinal),'[]') into v_current_lunch
    from jsonb_array_elements(v_lunch_items) with ordinality rows(item,ordinal)
    where (p_now at time zone 'America/Chicago')::date=p_service_date
      and (item->>'coverage_start')::time<=(p_now at time zone 'America/Chicago')::time
      and (p_now at time zone 'America/Chicago')::time<(item->>'coverage_end')::time;
    v_result:=jsonb_set(v_result,'{all_items}',coalesce(v_result->'all_items','[]')||v_lunch_items);
    v_result:=jsonb_set(v_result,'{current_items}',coalesce(v_result->'current_items','[]')||v_current_lunch);
    v_result:=jsonb_set(v_result,'{items}',coalesce(v_result->'items','[]')||v_current_lunch);
    v_result:=v_result||jsonb_build_object('lunch_coverage_status','PERSISTED',
      'lunch_coverage_contract','static-weekly-lunch-consumers.v1',
      'assignment_count',jsonb_array_length(v_result->'all_items'));
  else
    v_result:=v_result||jsonb_build_object('lunch_coverage_status','UNAVAILABLE');
  end if;
  return jsonb_set(v_result,'{contract_version}',to_jsonb('static-weekly-employee-day.v3'::text),true);
end
$function$;

comment on function public.custodial_operational_location_assignments(date) is 'Current physical responsibility splits at accepted lunch boundaries; normal source ownership and original occurrence identity remain unchanged.';
comment on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) is 'Employee day v3 with accepted current lunch coverage; regular assignments and temporary loans remain separate.';

CREATE OR REPLACE FUNCTION public.custodial_release_canary_authority_surface()
 RETURNS TABLE(object_kind text, object_identity text, purpose text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  values
    ('function','static_weekly_v8_read_lunch_segments(date)','current lunch responsibility consumer'),
    ('function','custodial_operational_location_assignments(date)','current physical responsibility and lunch handoff'),
    ('function','static_weekly_v5_read_employee_day(date,uuid,timestamp with time zone)','employee published lunch display'),
    ('relation','public.weekly_schedule_lunch_documents','accepted temporary lunch coverage'),
    ('function','static_weekly_v8_assert_lunch_document(uuid,jsonb)','lunch exact projection validation'),
    ('function','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','atomic lunch persistence'),
    ('function','static_weekly_v8_read_lunch_document(date)','current projection lunch reader'),
    ('relation','public.devices','phone identity and assignment'),
    ('relation','public.locations','scan location authority'),
    ('relation','public.device_auth_credentials','native credential authority'),
    ('relation','public.device_sync_status','phone queue and release readiness'),
    ('relation','public.device_location_proximity_status','current accepted proximity'),
    ('relation','public.sessions','canonical cleaning session truth'),
    ('relation','public.completion_responses','canonical completion response truth'),
    ('relation','public.scan_events','accepted scan event truth'),
    ('relation','public.maintenance_tickets','completion-derived maintenance truth'),
    ('relation','public.custodial_offline_actor_contexts','frozen offline actor and native evidence'),
    ('relation','public.custodial_offline_submission_proofs','offline submission proof state'),
    ('relation','public.custodial_offline_reconciliation_records','offline reconciliation decision'),
    ('relation','public.custodial_offline_scan_event_evidence','immutable scan evidence binding'),
    ('relation','public.custodial_release_canary_controls','exact canary pause state'),
    ('relation','public.custodial_release_canary_transport_probes','native canary transport proof'),
    ('relation','public.custodial_release_canary_recovery_probes','database canary recovery proof'),
    ('relation','public.events_app_events','canonical event mutation truth'),
    ('relation','public.events_app_event_history','event actor history'),
    ('relation','public.event_push_instances','event push occurrence authority'),
    ('relation','public.employee_push_registrations','employee push recipient authority'),
    ('relation','public.employee_native_push_delivery_receipts','employee push delivery truth'),
    ('relation','public.operational_notification_jobs','durable operational notification jobs'),
    ('relation','public.ops_manager_notification_queue','manager notification jobs'),
    ('relation','public.ops_manager_push_devices','manager push recipient authority'),
    ('relation','public.device_notification_acknowledgements','phone notification acceptance'),
    ('function','tool_get_offline_scan_authority_snapshot(text,text,text)','offline snapshot boundary'),
    ('function','tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)','native offline start boundary'),
    ('function','tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','native completion boundary'),
    ('function','tool_complete_session_authoritative(text,jsonb,text,text,text,text)','online completion boundary'),
    ('function','custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)','maintenance terminal boundary'),
    ('function','custodial_finish_historical_session_authoritative(text,text,uuid,timestamp with time zone,text)','historical exact-finish adapter'),
    ('function','custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,uuid,text,text,text)','native canary transport recorder'),
    ('function','custodial_get_release_canary_transport_probe_health(text,text,text,text)','native canary transport health'),
    ('function','custodial_run_release_canary_recovery_probe(text,text)','persisted recovery probe'),
    ('function','custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)','release canary controller'),
    ('function','custodial_backend_authority_health(text)','database authority health'),
    ('function','app_apply_event_command(text,uuid,jsonb,text,text)','bounded event mutation authority'),
    ('function','custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid)','serialized manager assignment CAS'),
    ('function','mz_register_employee_push(uuid,text,text,text,text,text)','employee push registration authority'),
    ('function','mz_enqueue_employee_event_pushes(timestamp with time zone)','event push enqueue authority'),
    ('function','mz_enqueue_employee_location_pushes(timestamp with time zone)','location push enqueue authority'),
    ('function','mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','employee push dispatch preparation'),
    ('function','mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)','employee push dispatch completion'),
    ('function','ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text)','manager push dispatch preparation'),
    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion'),
    ('view','public.v_location_status','phone scan-state operational truth'),
    ('view','public.v_location_dashboard_status','manager location operational truth'),
    ('view','public.v_restroom_check_timers','restroom timer operational truth'),
    ('view','public.v_admin_health_snapshot','admin operational health truth'),
    ('view','public.v_exception_queue','manager exception operational truth'),
    ('view','public.v_restroom_package_status','restroom timer dependent projection');
$function$;

-- Capture only this migration's new objects in the existing recovery inventory.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare row record;next_order integer;changed integer;
begin
 for row in
  with relation as (select 'public.weekly_schedule_lunch_documents'::regclass oid), objects as (
   select 1000 bucket,'relation'::text kind,'public.weekly_schedule_lunch_documents'::text identity,
    public.custodial_release_authority_current_relation_definition('public.weekly_schedule_lunch_documents') definition
   union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid)
    from pg_proc where pronamespace='public'::regnamespace and proname in
    ('static_weekly_v8_assert_lunch_document','static_weekly_v8_materialize_lunch_document','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface','static_weekly_v8_read_lunch_segments','custodial_operational_location_assignments','static_weekly_v5_read_employee_day')
   union all select 200000,'column','public.weekly_schedule_lunch_documents:'||attname,
    public.custodial_release_authority_current_column_definition('public.weekly_schedule_lunch_documents:'||attname)
    from pg_attribute where attrelid=(select oid from relation) and attnum>0 and not attisdropped
   union all select 300000,'column_set','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_column_set_definition('public.weekly_schedule_lunch_documents')
   union all select 400000,'relation_state','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_relation_state_definition('public.weekly_schedule_lunch_documents')
   union all select 500000,'constraint','public.weekly_schedule_lunch_documents:'||conname,
    public.custodial_release_authority_current_constraint_definition('public.weekly_schedule_lunch_documents:'||conname)
    from pg_constraint where conrelid=(select oid from relation)
   union all select 700000,'trigger','public.weekly_schedule_lunch_documents.'||tgname,
    'drop trigger if exists '||quote_ident(tgname)||' on public.weekly_schedule_lunch_documents; '||pg_get_triggerdef(oid,true)||';'
    from pg_trigger where tgrelid=(select oid from relation) and not tgisinternal
   union all select 900000,'grant','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_grant_definition('public.weekly_schedule_lunch_documents')
   union all select 900000,'grant',oid::regprocedure::text,
    public.custodial_release_authority_current_grant_definition(oid::regprocedure::text)
    from pg_proc where pronamespace='public'::regnamespace and proname in
    ('static_weekly_v8_assert_lunch_document','static_weekly_v8_materialize_lunch_document','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface','static_weekly_v8_read_lunch_segments','custodial_operational_location_assignments','static_weekly_v5_read_employee_day')
  ) select * from objects order by bucket,identity
 loop
  if row.definition is null then raise exception 'missing lunch recovery object %',row.identity; end if;
  if row.identity='public.custodial_release_canary_authority_surface()'::regprocedure::text and row.kind in ('function','grant') then
   update public.custodial_release_authority_restore_inventory
   set definition_sql=row.definition,definition_sha256=public.static_weekly_digest_text(row.definition),captured_at=statement_timestamp()
   where object_kind=row.kind and object_identity=row.identity;
   get diagnostics changed=row_count;
   if changed<>1 then raise exception 'existing canary recovery binding missing or duplicated'; end if;
   continue;
  end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind=row.kind and object_identity=row.identity) then
   raise exception 'unexpected existing lunch recovery identity %',row.identity; end if;
  select coalesce(max(restore_order),row.bucket)+1 into next_order
   from public.custodial_release_authority_restore_inventory
   where restore_order>=row.bucket and restore_order<case when row.bucket=1000 then 100000 else row.bucket+100000 end;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,row.kind,row.identity,row.definition,public.static_weekly_digest_text(row.definition));
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
