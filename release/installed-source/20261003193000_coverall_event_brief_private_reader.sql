-- Contractor Event brief candidate, not an automatic disclosure or a schedule
-- mutation. The named manager must explicitly confirm the exact safe brief in
-- the server print workflow, which rereads this source before release.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

create function public.static_weekly_coverall_event_brief_candidate(
 p_manager_id uuid,p_event_id uuid,p_event_revision integer,p_capacity_slot_id uuid,
 p_service_date date,p_projection_id uuid,p_expected_authority_revision bigint,
 p_lunch_document_identity text,p_print_document_digest text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,extensions as $function$
declare
 v_manager public.ops_manager_managers%rowtype;
 v_authority record;
 v_control_revision bigint;
 v_capacity public.static_weekly_contractor_capacity_registrations%rowtype;
 v_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_lunch_read jsonb;
 v_event public.events_app_events%rowtype;
 v_place jsonb;
 v_areas jsonb;
 v_replay_digest text;
begin
 if p_manager_id is null or p_event_id is null or p_event_revision is null or p_event_revision<1
  or p_capacity_slot_id is null or p_service_date is null or p_projection_id is null
  or p_expected_authority_revision is null or p_expected_authority_revision<1
  or coalesce(p_lunch_document_identity,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_print_document_digest,'') !~ '^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='exact manager, event, capacity and accepted print basis required';
 end if;
 select * into v_manager from public.ops_manager_managers where manager_id=p_manager_id;
 if v_manager.manager_id is null or v_manager.active is not true or v_manager.revoked_at is not null
  or v_manager.is_system_principal is true
  or (v_manager.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) is not true then
  raise exception using errcode='42501',message='active named manager required for contractor Event brief';
 end if;
 select current_revision into v_control_revision from public.static_weekly_schedule_control where singleton;
 select * into v_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 if v_control_revision is distinct from p_expected_authority_revision
  or v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
  or v_authority.projection_id is distinct from p_projection_id then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','STALE_PRINT_BASIS','disclosure_approved',false);
 end if;
 select * into v_capacity from public.static_weekly_contractor_capacity_registrations
  where capacity_slot_id=p_capacity_slot_id;
 if v_capacity.capacity_slot_id is null or not public.static_weekly_capacity_registered(v_capacity.slot_snapshot)
  or not exists(select 1 from jsonb_array_elements(public.static_weekly_compiler_exception_set(
    v_authority.publication_id,v_authority.week_start)) item(value)
    where item.value->>'type'='cover_all' and item.value->>'serviceDate'=p_service_date::text
      and item.value#>>'{payload,availability,slotId}'=p_capacity_slot_id::text) then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','CAPACITY_NOT_ACCEPTED','disclosure_approved',false);
 end if;
 select * into v_lunch from public.weekly_schedule_lunch_documents
  where projection_id=p_projection_id;
 v_lunch_read:=public.static_weekly_v8_read_lunch_document(p_service_date);
 if v_lunch.projection_id is null or v_lunch.document_identity is distinct from p_lunch_document_identity
  or v_lunch_read->>'persistence_status' is distinct from 'PERSISTED'
  or v_lunch_read->>'document_identity' is distinct from p_lunch_document_identity
  or v_lunch_read->>'projection_id' is distinct from p_projection_id::text then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','STALE_PRINT_BASIS','disclosure_approved',false);
 end if;
 select replay_digest into v_replay_digest from public.weekly_schedule_compiled_projections
  where projection_id=p_projection_id and publication_id=v_authority.publication_id
   and version_id=v_authority.version_id;
 if v_replay_digest is null then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','STALE_PRINT_BASIS','disclosure_approved',false);
 end if;
 select * into v_event from public.events_app_events where id=p_event_id;
 if v_event.id is null or v_event.revision is distinct from p_event_revision
  or v_event.status is distinct from 'SCHEDULED' or coalesce(v_event.needs_review,false)
  or v_event.event_scope='UNKNOWN' or v_event.cancelled_at is not null
  or v_event.archived_at is not null or v_event.superseded_by_event_id is not null
  or v_event.start_instant_utc is null or v_event.end_instant_utc is null
  or v_event.end_instant_utc<=v_event.start_instant_utc
  or v_event.event_date is distinct from p_service_date
  or (v_event.start_instant_utc at time zone 'America/Chicago')::date is distinct from p_service_date
  or coalesce(cardinality(v_event.coverage_location_ids),0)=0 then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','EVENT_NOT_CURRENT_OR_UNSCOPED','disclosure_approved',false);
 end if;
 v_place:=public.app_event_place_authority(to_jsonb(v_event),statement_timestamp());
 if (v_place->>'admissible')::boolean is not true then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','EVENT_PLACE_NEEDS_REVIEW','disclosure_approved',false);
 end if;
 -- The typed readers prove current group/physical identities. Ordinary
 -- ownership and exact accepted lunch loans are separate branches. No Event
 -- venue or display-name equivalence is used as custodial coverage.
 with ordinary as (
  select s.location_group_id,s.group_name,s.coverage_start::time as starts,
   s.coverage_end::time as ends,s.included_location_ids,'area_owner'::text as purpose
  from public.static_weekly_v6_read_schedule_segments(p_service_date) s
  join public.weekly_schedule_occurrences o on o.occurrence_id=s.segment_id
  where s.projection_id=p_projection_id and s.status='ASSIGNED' and s.owner_type='COVERALL'
   and s.service_mode='scan_tracked' and cardinality(s.included_location_ids)>0
   and o.owner_kind='CONTRACTOR_CAPACITY' and o.owner_capacity_id=p_capacity_slot_id
 ), temporary as (
  select s.location_group_id,s.group_name,s.coverage_start starts,s.coverage_end ends,
   s.included_location_ids,'lunch_coverage'::text purpose
  from public.static_weekly_v8_read_lunch_segments(p_service_date) s
  join jsonb_array_elements(v_lunch.document_json->'responsibilities') r(value)
   on r.value->>'responsibility_id'=s.responsibility_id
  where s.projection_id=p_projection_id and s.service_mode='scan_tracked'
   and cardinality(s.included_location_ids)>0
   and r.value->>'coverer_slot_id'=p_capacity_slot_id::text
   and r.value->>'coverer_capacity_id'=p_capacity_slot_id::text
   and r.value->'coverer_person_id'='null'::jsonb
 ), matched as (
  select distinct * from (select * from ordinary union all select * from temporary) areas
  where areas.location_group_id=any(v_event.coverage_location_ids)
 ) select coalesce(jsonb_agg(jsonb_build_object('location_group_id',location_group_id,
    'group_name',group_name,'starts',to_char(starts,'HH24:MI'),
    'ends',to_char(ends,'HH24:MI'),'included_location_ids',included_location_ids,
    'purpose',purpose) order by starts,ends,location_group_id,purpose),'[]'::jsonb)
  into v_areas from matched;
 if jsonb_array_length(v_areas)=0 then
  return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
   'status','NO_MATCHED_ACCEPTED_COVERAGE','disclosure_approved',false);
 end if;
 return jsonb_build_object('schema','custodial.coverall-event-brief-candidate.v1',
  'status','PREVIEW_ONLY','disclosure_approved',false,
  'manager_id',p_manager_id,'capacity_slot_id',p_capacity_slot_id,
  'service_date',p_service_date,'projection_id',p_projection_id,
  'publication_id',v_authority.publication_id,
  'authority_revision',v_control_revision,'projection_replay_digest',v_replay_digest,
  'lunch_document_identity',p_lunch_document_identity,
  'print_document_digest',p_print_document_digest,
  'event_id',v_event.id,'event_revision',v_event.revision,
  'event_name',v_event.event_name,
  'display_location',coalesce(nullif(v_place->>'primary_display_name',''),v_event.display_location),
  'event_date',v_event.event_date,
  'start_instant_utc',v_event.start_instant_utc,'end_instant_utc',v_event.end_instant_utc,
  'start_time',v_event.start_time,'end_time',v_event.end_time,
  'custodial_note_codes',v_event.custodial_note_codes,
  'custodial_public_notes',v_event.custodial_public_notes,
  'matched_areas',v_areas);
end $function$;

-- Discovery is separately typed: no NULL Event shortcut into the exact
-- single-Event reader. All rows still pass that reader's current authority,
-- scope, Place and note classification. Limits never return a partial list as
-- if it were the complete set of eligible Events.
create function public.static_weekly_coverall_event_brief_candidates(
 p_manager_id uuid,p_capacity_slot_id uuid,p_service_date date,p_projection_id uuid,
 p_expected_authority_revision bigint,p_lunch_document_identity text,p_print_document_digest text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,extensions as $function$
declare
 v_manager public.ops_manager_managers%rowtype;
 v_authority record;
 v_control_revision bigint;
 v_capacity public.static_weekly_contractor_capacity_registrations%rowtype;
 v_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_lunch_read jsonb;
 v_event record;
 v_row jsonb;
 v_rows jsonb:='[]'::jsonb;
 v_count integer:=0;
 v_scanned integer;
 v_replay_digest text;
begin
 if p_manager_id is null or p_capacity_slot_id is null or p_service_date is null
  or p_projection_id is null or p_expected_authority_revision is null
  or p_expected_authority_revision<1
  or coalesce(p_lunch_document_identity,'') !~ '^[0-9a-f]{64}$'
  or coalesce(p_print_document_digest,'') !~ '^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='exact manager, capacity and accepted print basis required';
 end if;
 select * into v_manager from public.ops_manager_managers where manager_id=p_manager_id;
 if v_manager.manager_id is null or v_manager.active is not true or v_manager.revoked_at is not null
  or v_manager.is_system_principal is true
  or (v_manager.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) is not true then
  raise exception using errcode='42501',message='active named manager required for contractor Event list';
 end if;
 select current_revision into v_control_revision from public.static_weekly_schedule_control where singleton;
 select * into v_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 select p.replay_digest into v_replay_digest from public.weekly_schedule_compiled_projections p
  where p.projection_id=p_projection_id and p.publication_id=v_authority.publication_id
   and p.version_id=v_authority.version_id;
 if v_control_revision is distinct from p_expected_authority_revision
  or v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
  or v_authority.projection_id is distinct from p_projection_id
  or coalesce(v_replay_digest,'') !~ '^[0-9a-f]{64}$' then
  return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
   'status','STALE_PRINT_BASIS','disclosure_approved',false,'candidates','[]'::jsonb);
 end if;
 select * into v_capacity from public.static_weekly_contractor_capacity_registrations
  where capacity_slot_id=p_capacity_slot_id;
 if v_capacity.capacity_slot_id is null or not public.static_weekly_capacity_registered(v_capacity.slot_snapshot)
  or not exists(select 1 from jsonb_array_elements(public.static_weekly_compiler_exception_set(
    v_authority.publication_id,v_authority.week_start)) item(value)
    where item.value->>'type'='cover_all' and item.value->>'serviceDate'=p_service_date::text
      and item.value#>>'{payload,availability,slotId}'=p_capacity_slot_id::text) then
  return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
   'status','CAPACITY_NOT_ACCEPTED','disclosure_approved',false,'candidates','[]'::jsonb);
 end if;
 select * into v_lunch from public.weekly_schedule_lunch_documents where projection_id=p_projection_id;
 v_lunch_read:=public.static_weekly_v8_read_lunch_document(p_service_date);
 if v_lunch.projection_id is null or v_lunch.document_identity is distinct from p_lunch_document_identity
  or v_lunch_read->>'persistence_status' is distinct from 'PERSISTED'
  or v_lunch_read->>'document_identity' is distinct from p_lunch_document_identity
  or v_lunch_read->>'projection_id' is distinct from p_projection_id::text then
  return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
   'status','STALE_PRINT_BASIS','disclosure_approved',false,'candidates','[]'::jsonb);
 end if;
 select count(*) into v_scanned from (
  select 1 from public.events_app_events e
   where e.event_date=p_service_date and e.status='SCHEDULED'
   order by e.start_instant_utc,e.id limit 33
 ) bounded;
 if v_scanned>32 then
  return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
   'status','LIMIT_EXCEEDED','limit_reason','same_day_scan','disclosure_approved',false,
   'candidates','[]'::jsonb);
 end if;
 for v_event in select e.id,e.revision from public.events_app_events e
  where e.event_date=p_service_date and e.status='SCHEDULED'
  order by e.start_instant_utc,e.id
 loop
  v_row:=public.static_weekly_coverall_event_brief_candidate(p_manager_id,v_event.id,
    v_event.revision,p_capacity_slot_id,p_service_date,p_projection_id,
    p_expected_authority_revision,p_lunch_document_identity,p_print_document_digest);
  if v_row->>'status'='PREVIEW_ONLY' then
   if octet_length(v_row::text)>8192 or v_count>=16 then
    return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
     'status','LIMIT_EXCEEDED','limit_reason','eligible_count_or_size',
     'disclosure_approved',false,'candidates','[]'::jsonb);
   end if;
   v_rows:=v_rows||jsonb_build_array(v_row);
   v_count:=v_count+1;
  end if;
 end loop;
 return jsonb_build_object('schema','custodial.coverall-event-brief-list.v1',
  'status','PREVIEW_ONLY','disclosure_approved',false,
  'manager_id',p_manager_id,'capacity_slot_id',p_capacity_slot_id,
  'service_date',p_service_date,'projection_id',p_projection_id,
  'publication_id',v_authority.publication_id,'projection_replay_digest',v_replay_digest,
  'authority_revision',v_control_revision,'lunch_document_identity',p_lunch_document_identity,
  'print_document_digest',p_print_document_digest,'candidate_limit',16,'scan_limit',32,
  'candidates',v_rows);
end $function$;

revoke all on function public.static_weekly_coverall_event_brief_candidate(
 uuid,uuid,integer,uuid,date,uuid,bigint,text,text)
 from public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.static_weekly_coverall_event_brief_candidate(
 uuid,uuid,integer,uuid,date,uuid,bigint,text,text) to static_weekly_control_plane;
revoke all on function public.static_weekly_coverall_event_brief_candidates(
 uuid,uuid,date,uuid,bigint,text,text)
 from public,anon,authenticated,service_role,custodial_application_reader,
 static_weekly_control_plane,static_weekly_release_operator,static_weekly_runtime_20260823;
grant execute on function public.static_weekly_coverall_event_brief_candidates(
 uuid,uuid,date,uuid,bigint,text,text) to static_weekly_control_plane;

do $recovery$ declare v_identity text;v_definition text;v_grant text;v_order integer;begin
 foreach v_identity in array array[
  'public.static_weekly_coverall_event_brief_candidate(uuid,uuid,integer,uuid,date,uuid,bigint,text,text)',
  'public.static_weekly_coverall_event_brief_candidates(uuid,uuid,date,uuid,bigint,text,text)'] loop
 v_definition:=pg_get_functiondef(v_identity::regprocedure);
 v_grant:=public.custodial_release_authority_current_grant_definition(v_identity);
 if v_definition is null or v_grant is null then raise exception 'CoverAll Event brief recovery unavailable';end if;
 alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 select n into v_order from generate_series(100001,199999) n where not exists(
  select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
  order by n limit 1;
 insert into public.custodial_release_authority_restore_inventory
  (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 values(v_order,'function',v_identity,v_definition,public.static_weekly_digest_text(v_definition));
 select n into v_order from generate_series(900001,999999) n where not exists(
  select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
  order by n limit 1;
 insert into public.custodial_release_authority_restore_inventory
  (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
 values(v_order,'grant',v_identity,v_grant,public.static_weekly_digest_text(v_grant));
 end loop;
 alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
