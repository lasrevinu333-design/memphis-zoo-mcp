-- Manual Events cohort successor. New scoped writer; historical named-manager writers remain unchanged.
-- Rehearsal candidate only. No production admission or physical acceptance.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.custodial_manual_event_operations (
 operation_id uuid primary key, manager_id uuid not null references public.ops_manager_managers(manager_id),
 credential_id uuid not null, device_id text not null, request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 canonical_digest text not null check(canonical_digest ~ '^[a-f0-9]{64}$'),
 event_id uuid references public.events_app_events(id), receipt jsonb not null, actor jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.custodial_manual_event_operations enable row level security;
alter table public.custodial_manual_event_operations force row level security;
revoke all on public.custodial_manual_event_operations from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger manual_event_operation_immutable before update or delete on public.custodial_manual_event_operations for each row execute function public.static_weekly_reject_update_delete();
alter table public.custodial_manual_event_operations enable always trigger manual_event_operation_immutable;
create trigger manual_event_operation_no_truncate before truncate on public.custodial_manual_event_operations for each statement execute function public.static_weekly_reject_update_delete();
alter table public.custodial_manual_event_operations enable always trigger manual_event_operation_no_truncate;

create function public.custodial_leadership_manual_event_operation_v1(p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions
as $manual$
declare
 actor jsonb; v_command text; v_record jsonb; v_operation uuid; v_digest text; v_fingerprint text;
 v_row public.events_app_events%rowtype; v_previous jsonb; v_prior public.custodial_manual_event_operations%rowtype;
 v_actor_manager_id uuid;v_actor text;v_reason text:='Manual event reviewed by a Custodial leadership browser; selected name is self-asserted.';
 v_now timestamptz:=statement_timestamp(); p_event_id uuid; v_result jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access',case when p_action in ('save','reject') then 'write' else 'read' end);
 if actor->>'actor_kind' is distinct from 'CUSTODIAL_LEADERSHIP_COHORT' or actor->'owner' is distinct from 'false'::jsonb
  or actor->>'identity_assurance' is distinct from 'SELF_ASSERTED_NAME' or actor->'individual_identity_verified' is distinct from 'false'::jsonb
  or actor->>'manager_id' is distinct from p_manager_id::text or actor->>'credential_id' is distinct from p_credential_id::text
  or actor->>'device_id' is distinct from p_device_id or actor->>'request_id' is null then
  raise exception 'Authenticated original cohort context required' using errcode='42501';end if;
 if p_action not in ('save','status','references','reject') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536 then
  raise exception 'Typed bounded manual event operation required' using errcode='22023';end if;
 if p_action='references' then
  if p_input<>'{}'::jsonb then raise exception 'No reference parameters allowed' using errcode='22023';end if;
  return jsonb_build_object(
   'da8b3b303a5edd20fd4b19414717debaea36d7285803ccde923362ac07720c3c',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select
      lg.id as location_group_id,
      lg.group_code,
      lg.group_name,
      coalesce(lg.eligible_event_venue, false) as eligible_event_venue,
      coalesce(lg.eligible_event_scope, false) as eligible_event_scope,
      coalesce(lg.eligible_custodial_coverage, true) as eligible_custodial_coverage,
      coalesce(lg.eligible_staffing_assignment, true) as eligible_staffing_assignment,
      coalesce(lg.public_restroom, false) as public_restroom,
      coalesce(lg.staff_restroom, false) as staff_restroom,
      coalesce(lg.exhibit, false) as exhibit,
      coalesce(lg.restaurant, false) as restaurant,
      coalesce(lg.event_venue, false) as event_venue,
      coalesce(lg.administrative, false) as administrative,
      coalesce(lg.zoo_wide_scope, false) as zoo_wide_scope,
      coalesce(lg.offsite, false) as offsite,
      coalesce(
        array_agg(distinct item.name order by item.name)
          filter (where item.name is not null),
        array[]::text[]
      ) as included_locations
    from public.location_groups lg
    left join lateral (
      select l.location_name as name
      from public.location_group_memberships lgm
      join public.locations l on l.id = lgm.location_id and l.active = true
      where lgm.location_group_id = lg.id and lgm.active = true
      union
      select alias_text as name
      from public.location_group_aliases a
      where a.location_group_id = lg.id and a.active = true
      union
      select alias_text as name
      from public.event_area_aliases eaa
      where eaa.location_group_id = lg.id and eaa.active = true
    ) item on true
    where lg.active = true
       or coalesce(lg.eligible_event_scope, false) = true
       or coalesce(lg.eligible_event_venue, false) = true
    group by lg.id, lg.group_code, lg.group_name
    order by lg.group_name asc
  ) r),
   '1363b7515d793ed6fcc806586238e16fe5622ee8f37f690b7fae83f56fcd77b7',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select
      ev.id as venue_id,
      ev.venue_code,
      ev.display_name,
      ev.event_scope,
      ev.location_group_id,
      lg.group_code,
      lg.group_name,
      coalesce(ev.eligible_event_venue, false) as eligible_event_venue,
      coalesce(ev.eligible_event_scope, false) as eligible_event_scope,
      coalesce(ev.active, true) as active,
      coalesce(ev.aliases, array[]::text[]) as aliases
    from public.event_venues ev
    left join public.location_groups lg on lg.id = ev.location_group_id
    where ev.active = true
    order by case when ev.event_scope = 'ZOO_WIDE' then 0 else 1 end, ev.display_name asc
  ) r),
   '1b1b1ae4e8bfbf240ec0bf46507e9041443d6cb649edb3f2238ffbf25781ea19',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select public.custodial_place_event_venue_overlay(statement_timestamp()) as overlay) r),
   'b4c63e236bdfaee896adc536f50d2cd63affa7084be7c959b0a04c6afa406ae2',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select
      edr.id,
      edr.match_text,
      edr.normalized_match,
      edr.event_scope,
      edr.primary_venue_id,
      ev.display_name,
      ev.venue_code,
      ev.location_group_id,
      coalesce(edr.active, true) as active
    from public.event_default_rules edr
    left join public.event_venues ev on ev.id = edr.primary_venue_id
    where edr.active = true
    order by length(edr.normalized_match) desc, edr.match_text asc
  ) r)
  );
 end if;
 v_operation:=(p_input->>'operation_id')::uuid;
 if v_operation is null then raise exception 'Original operation required' using errcode='22023';end if;
 if p_action='status' then
  if p_input-ARRAY['operation_id']<>'{}'::jsonb then raise exception 'Only original operation identity allowed' using errcode='22023';end if;
  select * into v_prior from public.custodial_manual_event_operations where operation_id=v_operation
   and manager_id=p_manager_id and credential_id=p_credential_id and device_id=p_device_id;
  if not found then return jsonb_build_object('state','OUTCOME_UNKNOWN','operation_id',v_operation);end if;
  return v_prior.receipt;
 end if;
 perform public.custodial_begin_application_mutation();
 if p_action='reject' then
  if p_input-ARRAY['operation_id','request_digest']<>'{}'::jsonb or not(p_input ?& ARRAY['operation_id','request_digest'])
   or coalesce(p_input->>'request_digest','') !~ '^[a-f0-9]{64}$' then raise exception 'Original rejection identity required' using errcode='22023';end if;
  v_digest:=p_input->>'request_digest';
  perform pg_advisory_xact_lock(hashtextextended('custodial-manual-event:'||v_operation::text,0));
  select * into v_prior from public.custodial_manual_event_operations where operation_id=v_operation;
  if found then
   if v_prior.manager_id is distinct from p_manager_id or v_prior.credential_id is distinct from p_credential_id or v_prior.device_id is distinct from p_device_id
    or v_prior.request_digest is distinct from v_digest then raise exception 'Original operation conflict' using errcode='22023';end if;
   return v_prior.receipt;
  end if;
  v_result:=jsonb_build_object('state','NOT_SAVED','operation_id',v_operation,'request_digest',v_digest,'rejection_code','REVIEW_REQUIRED');
  insert into public.custodial_manual_event_operations(operation_id,manager_id,credential_id,device_id,request_digest,canonical_digest,event_id,receipt,actor)
   values(v_operation,p_manager_id,p_credential_id,p_device_id,v_digest,v_digest,null,v_result,actor);
  return v_result;
 end if;
 if p_input-ARRAY['operation_id','event_id','expected_revision','request_digest','record']<>'{}'::jsonb
  or not(p_input ?& ARRAY['operation_id','event_id','expected_revision','request_digest','record']) then raise exception 'Exact save input required' using errcode='22023';end if;
 v_record:=p_input->'record';v_digest:=p_input->>'request_digest';p_event_id:=(p_input->>'event_id')::uuid;
 v_command:=case when p_event_id is null then 'create' else 'update' end;
 if jsonb_typeof(v_record) is distinct from 'object' or v_digest !~ '^[a-f0-9]{64}$'
  or v_record->>'operation_id' is distinct from v_operation::text
  or v_record->>'event_scope' not in ('ZOO_WIDE','SINGLE_VENUE','MULTI_VENUE','OFFSITE')
  or (v_record->>'needs_review')::boolean is distinct from false
  or v_record->>'event_timezone' is distinct from 'America/Chicago'
  or (p_event_id is null and (v_record->>'source_format' is null or v_record->>'source_format' not in ('paste','csv','spreadsheet','manual_form')))
  or length(coalesce(v_record->>'source_text',''))>40000
  or nullif(btrim(v_record->>'event_name'),'') is null
  or nullif(v_record->>'start_instant_utc','') is null or nullif(v_record->>'end_instant_utc','') is null
  or (p_event_id is not null and coalesce((p_input->>'expected_revision')::bigint,0)<1)
  or (p_event_id is null and p_input->'expected_revision'<>'null'::jsonb) then
  raise exception 'Reviewed canonical manual event required' using errcode='22023';end if;
 v_fingerprint:=public.static_weekly_digest_text(jsonb_build_object('event_id',p_event_id,'expected_revision',p_input->'expected_revision','record',v_record)::text);
 perform pg_advisory_xact_lock(hashtextextended('custodial-manual-event:'||v_operation::text,0));
 select * into v_prior from public.custodial_manual_event_operations where operation_id=v_operation;
 if found then
  if v_prior.manager_id is distinct from p_manager_id or v_prior.credential_id is distinct from p_credential_id or v_prior.device_id is distinct from p_device_id
   or v_prior.request_digest is distinct from v_digest then raise exception 'Original operation conflict' using errcode='22023';end if;
  if v_prior.receipt->>'state'='NOT_SAVED' then return v_prior.receipt;end if;
  if v_prior.canonical_digest is distinct from v_fingerprint then raise exception 'Original canonical intent conflict' using errcode='22023';end if;
  return v_prior.receipt;
 end if;
 v_actor_manager_id:=p_manager_id;v_actor:='Custodial leadership cohort';
 begin
  if v_command='create' then
    if nullif(v_record->>'start_instant_utc','') is null or nullif(v_record->>'end_instant_utc','') is null then
      raise exception using errcode='22023',message='New event requires explicit Chicago start and end instants';
    end if;
    insert into public.events_app_events(
      event_name,location_group_id,event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,staffing_area_ids,
      source_location_text,parser_confidence,needs_review,parse_reason,source_text,source_format,manually_overridden,overridden_by,
      overridden_at,event_timezone,operation_id,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,attendee_count,notes,custodial_note_codes,custodial_public_notes,created_by,
      created_by_manager_id,updated_by_manager_id,updated_at
    ) values(
      v_record->>'event_name',(v_record->>'location_group_id')::uuid,v_record->>'event_scope',nullif(v_record->>'primary_venue_id','')::uuid,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),v_record->>'display_location',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      nullif(v_record->>'source_location_text',''),nullif(v_record->>'parser_confidence',''),coalesce((v_record->>'needs_review')::boolean,false),
      nullif(v_record->>'parse_reason',''),nullif(v_record->>'source_text',''),nullif(v_record->>'source_format',''),
      coalesce((v_record->>'manually_overridden')::boolean,false),case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_actor end,
      case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_now end,
      coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),nullif(v_record->>'operation_id','')::uuid,(v_record->>'event_date')::date,
      (v_record->>'end_date')::date,(v_record->>'start_time')::time,(v_record->>'end_time')::time,(v_record->>'start_instant_utc')::timestamptz,(v_record->>'end_instant_utc')::timestamptz,nullif(v_record->>'attendee_count','')::integer,
      nullif(v_record->>'notes',''),coalesce(array(select distinct code from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'::jsonb)) code),'{}'::text[]),coalesce(v_record->>'custodial_public_notes',''),v_actor,v_actor_manager_id,
      case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_actor_manager_id end,v_now
    ) 
    returning * into v_row;

  elsif v_command='update' then
    select to_jsonb(e.*) into v_previous from public.events_app_events e where e.id=p_event_id for update;
    if v_previous is null then raise exception using errcode='P0002',message='event not found'; end if;
    if coalesce((v_previous->>'revision')::bigint,1) is distinct from (p_input->>'expected_revision')::bigint then raise exception using errcode='40901',message='Event changed; review the current revision';end if;
    if exists(select 1 from public.events_app_outlook_sync where event_id=p_event_id) then raise exception using errcode='22023',message='Outlook source event requires held-event review';end if;
    if v_previous->>'status'='CANCELLED' then raise exception using errcode='22023',message='Cancelled event is read-only';end if;
    if v_record->>'source_format' is distinct from v_previous->>'source_format' then raise exception using errcode='22023',message='Original source format must be preserved';end if;
    if (nullif(v_record->>'start_instant_utc','') is null) <> (nullif(v_record->>'end_instant_utc','') is null) then
      raise exception using errcode='22023',message='Event start and end instants must be supplied together';
    end if;
    if nullif(v_record->>'start_instant_utc','') is null and (
      nullif(v_previous->>'start_instant_utc','') is not null
      or nullif(v_previous->>'end_instant_utc','') is not null
      or (v_previous->>'event_date')::date is distinct from (v_record->>'event_date')::date
      or (v_previous->>'end_date')::date is distinct from (v_record->>'end_date')::date
      or (v_previous->>'start_time')::time is distinct from (v_record->>'start_time')::time
      or (v_previous->>'end_time')::time is distinct from (v_record->>'end_time')::time
    ) then
      raise exception using errcode='22023',message='Changed event time requires explicit Chicago start and end instants';
    end if;
    update public.events_app_events set
      event_name=v_record->>'event_name',location_group_id=(v_record->>'location_group_id')::uuid,event_scope=v_record->>'event_scope',
      primary_venue_id=nullif(v_record->>'primary_venue_id','')::uuid,
      venue_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      display_location=v_record->>'display_location',
      coverage_location_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      staffing_area_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      source_location_text=nullif(v_record->>'source_location_text',''),parser_confidence=nullif(v_record->>'parser_confidence',''),
      needs_review=coalesce((v_record->>'needs_review')::boolean,false),parse_reason=nullif(v_record->>'parse_reason',''),
      source_text=nullif(v_record->>'source_text',''),source_format=nullif(v_record->>'source_format',''),manually_overridden=true,
      overridden_by=v_actor,overridden_at=v_now,updated_by_manager_id=v_actor_manager_id,
      event_timezone=coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),event_date=(v_record->>'event_date')::date,
      end_date=(v_record->>'end_date')::date,start_time=(v_record->>'start_time')::time,end_time=(v_record->>'end_time')::time,start_instant_utc=(v_record->>'start_instant_utc')::timestamptz,end_instant_utc=(v_record->>'end_instant_utc')::timestamptz,
      attendee_count=nullif(v_record->>'attendee_count','')::integer,notes=nullif(v_record->>'notes',''),custodial_note_codes=coalesce(array(select distinct code from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'::jsonb)) code),'{}'::text[]),custodial_public_notes=coalesce(v_record->>'custodial_public_notes',''),revision=coalesce(revision,1)+1,updated_at=v_now
    where id=p_event_id returning * into v_row;
    insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(v_row.id,'update',v_actor,v_actor_manager_id,v_reason,v_previous,to_jsonb(v_row),v_now);

  end if;

 if v_row.id is null then raise exception 'Event readback unavailable';end if;
 v_result:=jsonb_build_object('state','SAVED','operation_id',v_operation,'request_digest',v_digest,'event',to_jsonb(v_row));
 exception when SQLSTATE '40901' or SQLSTATE '22023' or SQLSTATE '23503' or SQLSTATE '23514' or SQLSTATE 'P0002' then
  -- This subtransaction rolls back every event/history effect before retaining
  -- a negative original receipt. Unknown/system failures still abort normally.
  v_result:=jsonb_build_object('state','NOT_SAVED','operation_id',v_operation,'request_digest',v_digest,'rejection_code',case when SQLSTATE='40901' then 'EVENT_CHANGED' else 'REVIEW_REQUIRED' end);
 end;
 insert into public.custodial_manual_event_operations(operation_id,manager_id,credential_id,device_id,request_digest,canonical_digest,event_id,receipt,actor)
 values(v_operation,p_manager_id,p_credential_id,p_device_id,v_digest,v_fingerprint,case when v_result->>'state'='SAVED' then v_row.id end,v_result,actor);
 return v_result;
end $manual$;
revoke all on function public.custodial_leadership_manual_event_operation_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
grant execute on function public.custodial_leadership_manual_event_operation_v1(uuid,uuid,text,text,jsonb) to static_weekly_control_plane;
-- Extend the existing exact restore inventory; retain its ALWAYS guard.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;v_order integer;
begin
 for obj in with relations(name) as (values('public.custodial_manual_event_operations')),
 funcs as (select oid,'public.'||oid::regprocedure::text identity from pg_proc where pronamespace='public'::regnamespace
  and proname in ('custodial_leadership_manual_event_operation_v1')),objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relations
  union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relations r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relations
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relations
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relations r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(c.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(c.relname))
   from relations r join pg_index i on i.indrelid=r.name::regclass join pg_class c on c.oid=i.indexrelid
   where not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)
  union all select 700000,'trigger',r.name||'.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||r.name||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||r.name||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
   from relations r join pg_trigger t on t.tgrelid=r.name::regclass and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relations
  union all select 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing manual event recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   where object_kind=obj.kind and (object_identity=obj.identity or case when obj.kind in ('function','grant')
    and object_identity like '%(%' and obj.identity like '%(%' then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into v_order from public.custodial_release_authority_restore_inventory
    where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    values(v_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
