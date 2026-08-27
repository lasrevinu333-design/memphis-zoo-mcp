-- First-class vacant positions for the recurring static-weekly schedule.
--
-- A vacancy is a stable schedule position with a shift, lunch, and recurring
-- work template but no person identity.  It must remain visibly OPEN until a
-- named manager fills the position with a fresh employee identity.  This
-- avoids fake "Employee 1" people and lets future hiring change roster truth
-- without changing or rebuilding an employee APK.
begin;

alter table public.weekly_schedule_authority_revisions
  drop constraint if exists weekly_schedule_authority_revisions_operation_check;
alter table public.weekly_schedule_authority_revisions
  add constraint weekly_schedule_authority_revisions_operation_check
  check(operation in (
    'create_draft','update_draft','publish','supersede','rollback',
    'apply_exception','reverse_exception','replace_incumbency',
    'materialize_projection','mark_employee_departed','replace_employee',
    'create_vacant_slot','fill_vacant_slot'
  ));

alter table public.weekly_schedule_command_receipts
  drop constraint if exists weekly_schedule_command_receipts_command_type_check;
alter table public.weekly_schedule_command_receipts
  add constraint weekly_schedule_command_receipts_command_type_check
  check(command_type in (
    'create_draft','update_draft','publish','supersede','rollback',
    'apply_exception','reverse_exception','replace_incumbency',
    'materialize_projection','mark_employee_departed','replace_employee',
    'create_vacant_slot','fill_vacant_slot'
  ));

alter table public.weekly_schedule_slot_availability
  drop constraint if exists weekly_schedule_slot_availability_availability_state_check;
alter table public.weekly_schedule_slot_availability
  add constraint weekly_schedule_slot_availability_availability_state_check
  check(availability_state in ('working','departed_named_absent','vacant_unfilled','absent','unavailable'));
alter table public.weekly_schedule_slot_availability
  add constraint weekly_schedule_slot_availability_vacancy_template_check
  check(
    availability_state<>'vacant_unfilled'
    or (
      shift_start is not null and shift_end is not null
      and lunch_start is not null and lunch_end is not null
      and shift_start<lunch_start and lunch_end<shift_end
      and capacity_units>0 and max_load_points>0
    )
  );

-- Vacancy is dated staffing state only after the slot is filled.  The first
-- empty publication has no employee to reference and therefore needs no
-- synthetic staffing-state row.
alter table public.weekly_roster_slot_staffing_states
  drop constraint if exists weekly_roster_slot_staffing_states_staffing_state_check;
alter table public.weekly_roster_slot_staffing_states
  add constraint weekly_roster_slot_staffing_states_staffing_state_check
  check(staffing_state in ('working','departed_named_absent','vacant_unfilled'));

-- Incumbency and active vacancy membership are dated staffing facts.  They
-- are removed from both identities that compare a hydrated compiler input
-- with its immutable registered source.  The immutable
-- vacancyCapableSlotIds set remains source authority, alongside shift, lunch,
-- capacity, eligibility, route, and work templates.
create or replace function public.static_weekly_v5_projection_source_identity(p_source jsonb)
returns jsonb language plpgsql immutable as $function$
declare v_identity jsonb; v_version jsonb; v_slots jsonb; v_availability jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object' then
    raise exception using errcode='23514',message='projection source must be one compiler input object';
  end if;
  if jsonb_typeof(p_source->'version')='object' then
    v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then
    v_version:=(p_source->'versions')->0;
  else
    raise exception using errcode='23514',message='projection source must carry exactly one recurring version';
  end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd'-'namedAbsentSlotIds'-'vacantSlotIds';
  if jsonb_typeof(v_version->'slotAvailability') is distinct from 'array' then
    raise exception using errcode='23514',message='projection source must retain recurring slot availability templates';
  end if;
  select coalesce(jsonb_agg(item-'status' order by ordinal),'[]'::jsonb) into v_availability
  from jsonb_array_elements(v_version->'slotAvailability') with ordinality as a(item,ordinal);
  v_version:=jsonb_set(v_version,'{slotAvailability}',v_availability,true);
  v_identity:=p_source-'serviceDate'-'version'-'versions';
  if jsonb_typeof(v_identity->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='projection source must carry stable roster slots';
  end if;
  select coalesce(jsonb_agg(slot-'incumbencies' order by ordinal),'[]'::jsonb) into v_slots
  from jsonb_array_elements(v_identity->'slots') with ordinality as s(slot,ordinal);
  v_identity:=jsonb_set(v_identity,'{slots}',v_slots,true);
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

create or replace function public.static_weekly_v5_registered_source_identity(p_source jsonb)
returns jsonb language plpgsql immutable as $function$
declare v_identity jsonb; v_version jsonb; v_slots jsonb;
begin
  if jsonb_typeof(p_source) is distinct from 'object' or coalesce(p_source->'exceptions','[]'::jsonb)<>'[]'::jsonb then
    raise exception using errcode='23514',message='registered scheduler source must be one exception-free recurring compiler input';
  end if;
  if jsonb_typeof(p_source->'version')='object' then v_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then v_version:=(p_source->'versions')->0;
  else raise exception using errcode='23514',message='registered scheduler source must carry exactly one recurring version'; end if;
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd'-'vacantSlotIds';
  v_identity:=p_source-'serviceDate'-'exceptions'-'version'-'versions';
  if jsonb_typeof(v_identity->'slots') is distinct from 'array' then raise exception using errcode='23514',message='registered scheduler source must carry stable roster slots'; end if;
  select coalesce(jsonb_agg(slot-'incumbencies' order by ordinal),'[]'::jsonb) into v_slots
  from jsonb_array_elements(v_identity->'slots') with ordinality as s(slot,ordinal);
  v_identity:=jsonb_set(v_identity,'{slots}',v_slots,true);
  return jsonb_set(v_identity,'{version}',v_version,true);
end
$function$;

create or replace function public.static_weekly_v3_source_identity(p_source jsonb)
returns jsonb language sql immutable as $function$
  select public.static_weekly_v5_registered_source_identity(p_source)
$function$;

create or replace function public.static_weekly_v4_recurring_source_identity(p_source jsonb)
returns jsonb language sql immutable as $function$
  select public.static_weekly_v5_projection_source_identity(p_source)
$function$;

-- Hydration replaces source incumbency snapshots with the append-only roster
-- ledger.  A zero-incumbent slot is accepted only when the immutable source
-- explicitly declares that stable slot vacancy-capable.  Once a manager fills
-- it, the dated incumbency and working staffing row remove it from the active
-- vacant set without changing the recurring shift or lunch template.
create or replace function public.static_weekly_v4_hydrate_compiler_source(p_source jsonb,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_slots jsonb:='[]'::jsonb;
  v_slot jsonb;
  v_ranges jsonb;
  v_hydrated jsonb;
  v_source_version jsonb;
  v_version jsonb;
  v_declared_vacant jsonb:='[]'::jsonb;
  v_active_vacant jsonb:='[]'::jsonb;
  v_availability jsonb:='[]'::jsonb;
  v_item jsonb;
  v_date date;
  v_week_start date;
  v_state text;
  v_slot_id text;
  v_is_declared_vacant boolean;
  v_is_active_vacant boolean;
begin
  if p_service_date is null or jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_source->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='dated scheduler source requires one service date and stable slot array';
  end if;
  v_week_start:=p_service_date-(extract(isodow from p_service_date)::integer-1);
  if jsonb_typeof(p_source->'version')='object' then v_source_version:=p_source->'version';
  elsif jsonb_typeof(p_source->'versions')='array' and jsonb_array_length(p_source->'versions')=1 then v_source_version:=(p_source->'versions')->0;
  else raise exception using errcode='23514',message='dated scheduler source must carry exactly one recurring version'; end if;
  if jsonb_typeof(coalesce(v_source_version->'vacancyCapableSlotIds','[]'::jsonb)) is distinct from 'array'
    or jsonb_typeof(coalesce(v_source_version->'vacantSlotIds','[]'::jsonb)) is distinct from 'array' then
    raise exception using errcode='23514',message='vacancy-capable and active-vacancy stable-slot authority must be arrays';
  end if;
  v_declared_vacant:=coalesce(v_source_version->'vacancyCapableSlotIds','[]'::jsonb);

  for v_slot in select value from jsonb_array_elements(p_source->'slots') loop
    if jsonb_typeof(v_slot->'id') is distinct from 'string' or v_slot->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='23514',message='registered scheduler source contains a non-UUID stable roster slot identity';
    end if;
    v_slot_id:=v_slot->>'id';
    select coalesce(jsonb_agg(jsonb_build_object(
      'personId',r.person_id::text,'displayName',r.person_name_snapshot,
      'effectiveStart',r.effective_start::text,
      'effectiveEnd',case when r.effective_end is null then null else r.effective_end::text end
    ) order by r.effective_start,r.incumbency_id),'[]'::jsonb) into v_ranges
    from public.v_weekly_roster_slot_incumbency_ranges r
    where r.slot_id=v_slot_id::uuid and r.effective_start<=v_week_start+6
      and (r.effective_end is null or r.effective_end>v_week_start);
    select exists(select 1 from jsonb_array_elements_text(v_declared_vacant) vacancy(slot_id) where vacancy.slot_id=v_slot_id)
      into v_is_declared_vacant;
    if jsonb_array_length(v_ranges)=0 then
      if not v_is_declared_vacant then
        raise exception using errcode='23514',message='every non-vacant projected stable roster slot requires closure-aware incumbent history for the requested horizon';
      end if;
      v_active_vacant:=v_active_vacant||jsonb_build_array(v_slot_id);
    end if;
    v_slot:=jsonb_set(v_slot,'{incumbencies}',v_ranges,true);
    v_slots:=v_slots||jsonb_build_array(v_slot);
  end loop;

  v_hydrated:=jsonb_set(p_source,'{slots}',v_slots,true);
  if jsonb_typeof(v_hydrated->'version')='object' then v_version:=v_hydrated->'version';
  else v_version:=(v_hydrated->'versions')->0; end if;
  v_version:=jsonb_set(v_version,'{vacantSlotIds}',v_active_vacant,true);
  for v_item in select value from jsonb_array_elements(coalesce(v_version->'slotAvailability','[]'::jsonb)) loop
    v_slot_id:=v_item->>'slotId';
    select exists(select 1 from jsonb_array_elements_text(v_active_vacant) vacancy(slot_id) where vacancy.slot_id=v_slot_id)
      into v_is_active_vacant;
    if v_is_active_vacant then
      v_item:=jsonb_set(v_item,'{status}',to_jsonb('vacant_unfilled'::text),true);
    else
      v_date:=v_week_start+mod((v_item->>'dayOfWeek')::integer-extract(dow from v_week_start)::integer+7,7);
      select s.staffing_state into v_state from public.weekly_roster_slot_staffing_states s
      where s.slot_id=v_slot_id::uuid and s.effective_start<=v_date
      order by s.effective_start desc,s.authority_revision desc limit 1;
      if v_state is not null then v_item:=jsonb_set(v_item,'{status}',to_jsonb(v_state),true); end if;
    end if;
    v_availability:=v_availability||jsonb_build_array(v_item);
  end loop;
  v_version:=jsonb_set(v_version,'{slotAvailability}',v_availability,true);
  if jsonb_typeof(v_hydrated->'version')='object' then v_hydrated:=jsonb_set(v_hydrated,'{version}',v_version,true);
  else v_hydrated:=jsonb_set(v_hydrated,'{versions}',jsonb_build_array(v_version),true); end if;
  return jsonb_set(v_hydrated,'{serviceDate}',to_jsonb(p_service_date::text),true);
end
$function$;

create or replace function public.static_weekly_v3_assert_draft_incumbency(p_version_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_start date; v_document jsonb; v_vacant jsonb:='[]'::jsonb; v_row record; v_person uuid; v_name text; v_date date; v_matches integer; v_is_vacant boolean;
begin
  select effective_start,draft_document into v_start,v_document from public.weekly_schedule_versions where version_id=p_version_id for share;
  if v_start is null then raise exception using errcode='23514',message='draft version does not exist'; end if;
  v_vacant:=coalesce(v_document#>'{authority,compilerInput,version,vacantSlotIds}','[]'::jsonb);
  if jsonb_typeof(v_vacant) is distinct from 'array' then raise exception using errcode='23514',message='draft vacancy authority must be an array'; end if;
  for v_row in select * from public.weekly_schedule_slot_availability where version_id=p_version_id order by day_of_week,slot_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
    select exists(select 1 from jsonb_array_elements_text(v_vacant) vacancy(slot_id) where vacancy.slot_id=v_row.slot_id::text) into v_is_vacant;
    select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if v_is_vacant then
      if v_row.availability_state<>'vacant_unfilled' or v_matches<>0
        or v_row.incumbent_person_id_snapshot is not null or v_row.incumbent_name_snapshot is not null then
        raise exception using errcode='23514',message='vacant draft slot must retain its shift and lunch with zero incumbent identity';
      end if;
    else
      if v_row.availability_state='vacant_unfilled' or v_matches<>1 then
        raise exception using errcode='23514',message='non-vacant draft roster slot must resolve exactly one closure-aware incumbent at each service date';
      end if;
      select person_id,person_name_snapshot into v_person,v_name from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
      if v_row.incumbent_person_id_snapshot is distinct from v_person or v_row.incumbent_name_snapshot is distinct from v_name then
        raise exception using errcode='23514',message='draft roster incumbency snapshot is stale or incomplete at publication service date';
      end if;
    end if;
  end loop;
  for v_row in select * from public.weekly_schedule_slot_assignments where version_id=p_version_id order by day_of_week,assignment_id loop
    if nullif(v_row.payload_json#>>'{authority_facts,baseline_owner_slot_id}','') is not null then
      select exists(select 1 from jsonb_array_elements_text(v_vacant) vacancy(slot_id) where vacancy.slot_id=v_row.payload_json#>>'{authority_facts,baseline_owner_slot_id}') into v_is_vacant;
      if v_is_vacant and (v_row.status<>'open' or v_row.owner_slot_id is not null or v_row.owner_person_id_snapshot is not null
        or nullif(v_row.payload_json#>>'{authority_facts,baseline_owner_person_id}','') is not null) then
        raise exception using errcode='23514',message='vacant recurring work must remain OPEN with no invented owner or original actor';
      end if;
    end if;
    if v_row.owner_slot_id is not null then
      v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
      select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.owner_slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
      if v_matches<>1 then raise exception using errcode='23514',message='draft assignment owner must resolve exactly one closure-aware incumbent at each service date'; end if;
      select person_id,person_name_snapshot into v_person,v_name from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.owner_slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
      if v_row.owner_person_id_snapshot is distinct from v_person or v_row.owner_name_snapshot is distinct from v_name then raise exception using errcode='23514',message='draft recurring owner snapshot is stale or incomplete at publication service date'; end if;
    end if;
  end loop;
end
$function$;

create or replace function public.static_weekly_v7_create_vacant_roster_slot(
  p_slot_id uuid,p_slot_label text,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_actor jsonb; v_prior public.weekly_schedule_command_receipts%rowtype;
  v_label text:=regexp_replace(btrim(coalesce(p_slot_label,'')),'\s+',' ','g');
  v_code text; v_request jsonb; v_request_digest text; v_content_digest text;
  v_command uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,'create_vacant_slot');
  if p_slot_id is null or length(v_label) not between 2 and 200 then raise exception using errcode='22023',message='vacant roster position requires a stable UUID and label'; end if;
  v_code:='STATIC_'||upper(replace(p_slot_id::text,'-',''));
  v_request:=jsonb_build_object('operation','create_vacant_slot','slot_id',p_slot_id,'slot_code',v_code,'slot_label',v_label,'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  if exists(select 1 from public.weekly_roster_slots where slot_id=p_slot_id or slot_code=v_code) then raise exception using errcode='23505',message='stable roster position already exists'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'create_vacant_slot',p_manager_id,v_actor->>'manager_name',v_command,v_content_digest);
  insert into public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values(p_slot_id,v_code,v_label,p_manager_id,v_actor->>'manager_name',v_content_digest);
  v_response:=public.static_weekly_response_json('create_vacant_slot',v_revision,v_content_digest,v_request_digest,jsonb_build_object('slot_id',p_slot_id,'slot_code',v_code,'slot_label',v_label,'vacant',true));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_manager_id,v_actor->>'manager_name','create_vacant_slot',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v7_fill_vacant_roster_slot(
  p_slot_id uuid,p_new_employee_name text,p_effective_start date,p_reason text,
  p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_actor jsonb; v_prior public.weekly_schedule_command_receipts%rowtype; v_slot public.weekly_roster_slots%rowtype;
  v_name text:=regexp_replace(btrim(coalesce(p_new_employee_name,'')),'\s+',' ','g');
  v_request jsonb; v_request_digest text; v_content_digest text; v_command uuid:=gen_random_uuid();
  v_revision bigint; v_response jsonb; v_created jsonb; v_employee_id uuid; v_incumbency uuid:=gen_random_uuid();
  v_current_week date:=public.sch_service_date(statement_timestamp())-(extract(isodow from public.sch_service_date(statement_timestamp()))::integer-1);
begin
  perform public.static_weekly_v3_assert_control_plane(); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,'fill_vacant_slot');
  if p_slot_id is null or length(v_name) not between 2 and 160 or p_effective_start is null
    or extract(isodow from p_effective_start)::integer<>1 or p_effective_start<v_current_week
    or nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500 or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='filling a vacancy requires a stable slot, fresh employee name, Monday effective date, and bounded reason';
  end if;
  v_request:=jsonb_build_object('operation','fill_vacant_slot','slot_id',p_slot_id,'new_employee_name',v_name,'effective_start',p_effective_start,'reason',p_reason,'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  select * into v_slot from public.weekly_roster_slots where slot_id=p_slot_id for share;
  if not found then raise exception using errcode='P0002',message='vacant stable roster position was not found'; end if;
  if exists(select 1 from public.weekly_roster_slot_incumbencies where slot_id=p_slot_id)
    or exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges where slot_id=p_slot_id and effective_start<=p_effective_start and (effective_end is null or p_effective_start<effective_end)) then
    raise exception using errcode='23514',message='only a never-filled vacant stable position can use the initial fill operation';
  end if;
  v_created:=public.static_weekly_v5_create_replacement_employee(v_name,p_manager_id);
  v_employee_id:=(v_created#>>'{employee,id}')::uuid;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'fill_vacant_slot',p_manager_id,v_actor->>'manager_name',v_command,v_content_digest);
  insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values(v_incumbency,p_slot_id,v_employee_id,v_name,p_effective_start,p_manager_id,v_actor->>'manager_name',v_content_digest);
  insert into public.weekly_roster_slot_staffing_states(slot_id,employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(p_slot_id,v_employee_id,'working',p_effective_start,v_revision,p_manager_id,v_actor->>'manager_name',p_reason,v_content_digest);
  v_response:=public.static_weekly_response_json('fill_vacant_slot',v_revision,v_content_digest,v_request_digest,jsonb_build_object(
    'slot_id',p_slot_id,'slot_label',v_slot.slot_label,'new_employee_id',v_employee_id,'new_employee_name',v_name,
    'new_employee_code',v_created#>>'{employee,employee_code}','effective_start',p_effective_start,'phone_assignment',null
  ));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_manager_id,v_actor->>'manager_name','fill_vacant_slot',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

revoke all on function public.static_weekly_v5_projection_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v5_registered_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v4_hydrate_compiler_source(jsonb,date) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v3_assert_draft_incumbency(uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
revoke all on function public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text) to static_weekly_control_plane;

-- Release recovery is an exact catalog restoration mechanism.  Refresh every
-- changed constraint and function that it can touch, and add the new vacancy
-- surfaces before re-enabling its immutable inventory trigger.  Otherwise a
-- later canary recovery would silently restore the pre-vacancy constraints
-- and make a healthy current schema drift backward.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $rebind_release_recovery$
declare
  v_identity text;
  v_definition text;
  v_restore_order integer;
begin
  if to_regprocedure('public.custodial_release_authority_current_constraint_definition(text)') is null
    or to_regprocedure('public.custodial_release_authority_current_grant_definition(text)') is null then
    raise exception 'exact release-recovery renderers are unavailable';
  end if;

  foreach v_identity in array array[
    'public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check',
    'public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check',
    'public.weekly_schedule_slot_availability:weekly_schedule_slot_availability_availability_state_check',
    'public.weekly_schedule_slot_availability:weekly_schedule_slot_availability_vacancy_template_check',
    'public.weekly_roster_slot_staffing_states:weekly_roster_slot_staffing_states_staffing_state_check'
  ] loop
    v_definition:=public.custodial_release_authority_current_constraint_definition(v_identity);
    if v_definition is null then raise exception 'required current constraint % is unavailable',v_identity; end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=v_definition,
        definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='constraint' and object_identity=v_identity;
    if not found then
      select coalesce(max(restore_order),500000)+1 into v_restore_order
      from public.custodial_release_authority_restore_inventory where object_kind='constraint';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(
        v_restore_order,'constraint',v_identity,v_definition,
        encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;

  foreach v_identity in array array[
    'public.static_weekly_v5_projection_source_identity(jsonb)',
    'public.static_weekly_v5_registered_source_identity(jsonb)',
    'public.static_weekly_v3_source_identity(jsonb)',
    'public.static_weekly_v4_recurring_source_identity(jsonb)',
    'public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
    'public.static_weekly_v3_assert_draft_incumbency(uuid)',
    'public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text)',
    'public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'
  ] loop
    if to_regprocedure(v_identity) is null then raise exception 'required current function % is unavailable',v_identity; end if;
    v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
    update public.custodial_release_authority_restore_inventory
    set definition_sql=v_definition,
        definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='function' and object_identity=v_identity;
    if not found then
      select coalesce(max(restore_order),100000)+1 into v_restore_order
      from public.custodial_release_authority_restore_inventory where object_kind='function';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(
        v_restore_order,'function',v_identity,v_definition,
        encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
      );
    end if;

    v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
    if v_definition is null then raise exception 'required current function grant % is unavailable',v_identity; end if;
    update public.custodial_release_authority_restore_inventory
    set definition_sql=v_definition,
        definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex'),
        captured_at=statement_timestamp()
    where object_kind='grant' and object_identity=v_identity;
    if not found then
      select coalesce(max(restore_order),1000000)+1 into v_restore_order
      from public.custodial_release_authority_restore_inventory where object_kind='grant';
      insert into public.custodial_release_authority_restore_inventory(
        restore_order,object_kind,object_identity,definition_sql,definition_sha256
      ) values(
        v_restore_order,'grant',v_identity,v_definition,
        encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
      );
    end if;
  end loop;
end
$rebind_release_recovery$;

alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $release_recovery_postflight$
declare v_identity text; v_definition text;
begin
  foreach v_identity in array array[
    'public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check',
    'public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check',
    'public.weekly_schedule_slot_availability:weekly_schedule_slot_availability_availability_state_check',
    'public.weekly_schedule_slot_availability:weekly_schedule_slot_availability_vacancy_template_check',
    'public.weekly_roster_slot_staffing_states:weekly_roster_slot_staffing_states_staffing_state_check'
  ] loop
    v_definition:=public.custodial_release_authority_current_constraint_definition(v_identity);
    if not exists(
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='constraint' and object_identity=v_identity
        and definition_sql=v_definition
        and definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
    ) then raise exception 'release recovery does not preserve current constraint %',v_identity; end if;
  end loop;

  foreach v_identity in array array[
    'public.static_weekly_v5_projection_source_identity(jsonb)',
    'public.static_weekly_v5_registered_source_identity(jsonb)',
    'public.static_weekly_v3_source_identity(jsonb)',
    'public.static_weekly_v4_recurring_source_identity(jsonb)',
    'public.static_weekly_v4_hydrate_compiler_source(jsonb,date)',
    'public.static_weekly_v3_assert_draft_incumbency(uuid)',
    'public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text)',
    'public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'
  ] loop
    v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
    if not exists(
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='function' and object_identity=v_identity
        and definition_sql=v_definition
        and definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
    ) then raise exception 'release recovery does not preserve current function %',v_identity; end if;
    v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
    if not exists(
      select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='grant' and object_identity=v_identity
        and definition_sql=v_definition
        and definition_sha256=encode(extensions.digest(convert_to(v_definition,'UTF8'),'sha256'),'hex')
    ) then raise exception 'release recovery does not preserve current function grant %',v_identity; end if;
  end loop;
end
$release_recovery_postflight$;

comment on function public.static_weekly_v7_create_vacant_roster_slot(uuid,text,bigint,uuid,text) is
  'Creates one append-only stable schedule position with no synthetic employee identity.';
comment on function public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text) is
  'Fills a never-used vacant schedule position with a fresh employee and Messenger identity; shift, lunch, and area authority remain in the recurring source.';

commit;
