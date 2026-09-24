-- End occupied-position authority without inventing a replacement employee.
-- Existing history remains append-only; deployment uses ordinary release gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.weekly_roster_slot_incumbency_closures
  alter column replacement_incumbency_id drop not null;
alter table public.weekly_roster_slot_staffing_states
  alter column employee_id drop not null;
alter table public.weekly_roster_slot_staffing_states
  add constraint weekly_roster_slot_staffing_states_vacancy_identity_check
  check ((staffing_state='vacant_unfilled')=(employee_id is null));
alter table public.weekly_schedule_authority_revisions
  drop constraint weekly_schedule_authority_revisions_operation_check;
alter table public.weekly_schedule_authority_revisions
  add constraint weekly_schedule_authority_revisions_operation_check check(operation in (
    'create_draft','update_draft','publish','supersede','rollback','apply_exception',
    'reverse_exception','replace_incumbency','materialize_projection','mark_employee_departed',
    'replace_employee','create_vacant_slot','fill_vacant_slot','restore_existing_employee','vacate_roster_slot'));
alter table public.weekly_schedule_command_receipts
  drop constraint weekly_schedule_command_receipts_command_type_check;
alter table public.weekly_schedule_command_receipts
  add constraint weekly_schedule_command_receipts_command_type_check check(command_type in (
    'create_draft','update_draft','publish','supersede','rollback','apply_exception',
    'reverse_exception','replace_incumbency','materialize_projection','mark_employee_departed',
    'replace_employee','create_vacant_slot','fill_vacant_slot','restore_existing_employee','vacate_roster_slot'));

create function public.static_weekly_v8_guard_vacancy_closure() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $guard$
begin
  if new.replacement_incumbency_id is not null then return new; end if;
  perform public.static_weekly_v3_assert_control_plane();
  if not exists (
    select 1 from public.weekly_schedule_authority_revisions r
    join public.weekly_roster_slot_incumbencies i on i.incumbency_id=new.closed_incumbency_id
    join public.weekly_roster_slot_staffing_states s on s.authority_revision=r.authority_revision
    where r.authority_revision=new.authority_revision and r.operation='vacate_roster_slot'
      and r.actor_manager_id=new.actor_manager_id and r.content_digest=new.content_digest
      and s.slot_id=i.slot_id and s.staffing_state='vacant_unfilled' and s.employee_id is null
      and s.effective_start=new.closed_at_effective_date and i.effective_start<new.closed_at_effective_date
      and (i.effective_end is null or new.closed_at_effective_date<i.effective_end)
  ) then
    raise exception using errcode='23514',message='replacement-free closure requires matching vacancy command and staffing authority';
  end if;
  return new;
end
$guard$;
revoke all on function public.static_weekly_v8_guard_vacancy_closure() from public,anon,authenticated,service_role;
create trigger trg_static_weekly_v8_guard_vacancy_closure
before insert on public.weekly_roster_slot_incumbency_closures
for each row execute function public.static_weekly_v8_guard_vacancy_closure();

-- Private integrity check shared by the mutation writer and completed-action
-- reader. Never use today's roster/source selection to validate a historic retry.
create function public.static_weekly_v8_assert_vacancy_receipt(p_command_id uuid,p_operation text)
returns void language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare
 v_receipt public.weekly_schedule_command_receipts%rowtype;
 v_request jsonb;v_content_digest text;v_response jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 select * into v_receipt from public.weekly_schedule_command_receipts where command_id=p_command_id;
 if not found or p_operation not in ('vacate_roster_slot','materialize_projection') or p_operation is null
   or v_receipt.command_type is distinct from p_operation then
  raise exception using errcode='23514',message='vacancy receipt integrity: missing or wrong command';
 end if;
 v_request:=v_receipt.request_canonical_json;
 if jsonb_typeof(v_request) is distinct from 'object'
   or v_request->>'operation' is distinct from p_operation
   or v_request->'expected_revision' is distinct from to_jsonb(v_receipt.expected_revision)
   or v_request->>'actor_manager_id' is distinct from v_receipt.actor_manager_id::text
   or public.static_weekly_digest_jsonb(v_request) is distinct from v_receipt.request_digest then
  raise exception using errcode='23514',message='vacancy receipt integrity: canonical request mismatch';
 end if;
 if p_operation='vacate_roster_slot' then
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  if v_receipt.response_json#>>'{data,slot_id}' is distinct from v_request->>'slot_id'
    or v_receipt.response_json#>>'{data,former_employee_id}' is distinct from v_request->>'employee_id'
    or v_receipt.response_json#>>'{data,effective_start}' is distinct from v_request->>'effective_start'
    or v_receipt.response_json#>>'{data,source_id}' is distinct from v_request->>'source_id'
    or v_receipt.response_json#>'{data,replacement_employee_id}' is distinct from 'null'::jsonb
    or v_receipt.response_json#>'{data,history_preserved}' is distinct from 'true'::jsonb then
   raise exception using errcode='23514',message='vacancy receipt integrity: mutation response mismatch';
  end if;
 else
  if v_request->>'actor_manager_name' is distinct from v_receipt.actor_manager_name_snapshot then
   raise exception using errcode='23514',message='vacancy receipt integrity: projection actor mismatch';
  end if;
  -- Exactly the materialize_projection writer's canonical content identity.
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
   'publication_id',v_request->'publication_id','week_start',v_request->'service_date',
   'exception_set_digest',v_request->'exception_set_digest','compiler_version',v_request->'compiler_version',
   'objective',v_request->'objective','metrics',v_request->'metrics','replay_digest',v_request->'replay_digest',
   'projection_envelope_identity',v_request#>'{projection_envelope,database_projection_identity}',
   'attestation',v_request#>'{projection_envelope,attestation}'));
 end if;
 v_response:=public.static_weekly_response_json(p_operation,v_receipt.expected_revision+1,
   v_content_digest,v_receipt.request_digest,v_receipt.response_json->'data');
 if jsonb_typeof(v_receipt.response_json->'data') is distinct from 'object'
   or v_receipt.content_digest is distinct from v_content_digest
   or v_receipt.response_json is distinct from v_response
   or v_receipt.response_digest is distinct from v_response->>'output_digest'
   or not exists(select 1 from public.weekly_schedule_authority_revisions r
     where r.command_id=v_receipt.command_id and r.authority_revision=v_receipt.expected_revision+1
       and r.operation=p_operation and r.actor_manager_id=v_receipt.actor_manager_id
       and r.actor_manager_name_snapshot=v_receipt.actor_manager_name_snapshot and r.content_digest=v_content_digest) then
  raise exception using errcode='23514',message='vacancy receipt integrity: response or authority revision mismatch';
 end if;
end
$function$;
revoke all on function public.static_weekly_v8_assert_vacancy_receipt(uuid,text)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create function public.static_weekly_v8_vacate_roster_slot(
  p_source_id uuid,p_slot_id uuid,p_employee_id uuid,p_effective_start date,p_reason text,
  p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_actor jsonb;v_prior public.weekly_schedule_command_receipts%rowtype;
  v_source public.static_weekly_authority_source_documents%rowtype;
  v_incumbent public.v_weekly_roster_slot_incumbency_ranges%rowtype;
  v_employee public.employees%rowtype;v_slot jsonb;v_request jsonb;v_request_digest text;
  v_content_digest text;v_revision bigint;v_command uuid:=gen_random_uuid();v_response jsonb;v_status jsonb;
  v_original_publication uuid;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.custodial_assert_manager(p_manager_id);
  v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_manager_id,
    v_actor->>'manager_name',p_idempotency_key,'vacate_roster_slot');
  if p_source_id is null or p_slot_id is null or p_employee_id is null or p_effective_start is null
    or nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500
    or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='vacancy requires source, position, exact former employee, effective date and bounded reason';
  end if;
  v_request:=jsonb_build_object('operation','vacate_roster_slot','source_id',p_source_id,'slot_id',p_slot_id,
    'employee_id',p_employee_id,'effective_start',p_effective_start,'reason',p_reason,
    'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request);
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts
    where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest<>v_request_digest then
      raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs';
    end if;
    perform public.static_weekly_v8_assert_vacancy_receipt(v_prior.command_id,'vacate_roster_slot');
    return v_prior.response_json;
  end if;
  -- Immediate turnover only. Do not deactivate someone today for a future vacancy.
  if p_effective_start<>public.sch_service_date(statement_timestamp()) then
    raise exception using errcode='23514',message='vacancy effective date must be the current service date; past or future turnover is not supported';
  end if;
  select * into v_source from public.static_weekly_authority_source_documents
    where source_id=p_source_id and active and retired_at is null for share;
  if not found then raise exception using errcode='23514',message='vacancy requires an active registered source'; end if;
  select value into v_slot from jsonb_array_elements(v_source.canonical_source->'slots')
    where value->>'id'=p_slot_id::text;
  if v_slot is null
    or not coalesce((v_source.canonical_source#>'{version,vacancyCapableSlotIds}') ? p_slot_id::text,false)
    or not coalesce((v_source.canonical_source#>'{version,vacantSlotIds}') ? p_slot_id::text,false) then
    raise exception using errcode='23514',message='registered source must declare this stable position vacancy-capable and vacant';
  end if;
  select * into v_incumbent from public.v_weekly_roster_slot_incumbency_ranges
    where slot_id=p_slot_id and effective_start<p_effective_start
      and (effective_end is null or p_effective_start<effective_end);
  if not found or v_incumbent.person_id<>p_employee_id then
    raise exception using errcode='23514',message='vacancy requires the exact effective predecessor incumbent';
  end if;
  if exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges
      where slot_id=p_slot_id and effective_start>=p_effective_start) then
    raise exception using errcode='23514',message='future incumbency already occupies this position';
  end if;
  if exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges
      where person_id=p_employee_id and slot_id<>p_slot_id
        and (effective_end is null or p_effective_start<effective_end)) then
    raise exception using errcode='23514',message='former employee also has another current or future position';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found then raise exception using errcode='23514',message='predecessor employee identity is missing'; end if;
  perform public.static_weekly_v4_assert_employee_turnover_ready(p_employee_id);
  -- Bind the original completion shape under the same authority lock and
  -- effective-week selector as the manager snapshot. Absence of a later
  -- projection receipt must never be interpreted as an unpublished action.
  select publication_id into v_original_publication from public.weekly_schedule_publications
    where version_id=public.static_weekly_effective_version(
      p_effective_start-(extract(isodow from p_effective_start)::integer-1));
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'vacate_roster_slot',
    p_manager_id,v_actor->>'manager_name',v_command,v_content_digest);
  insert into public.weekly_roster_slot_staffing_states(
    slot_id,employee_id,staffing_state,effective_start,authority_revision,
    actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(p_slot_id,null,'vacant_unfilled',p_effective_start,v_revision,
    p_manager_id,v_actor->>'manager_name',p_reason,v_content_digest);
  insert into public.weekly_roster_slot_incumbency_closures(
    closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,
    actor_manager_id,actor_manager_name_snapshot,content_digest)
  values(v_incumbent.incumbency_id,null,p_effective_start,v_revision,
    p_manager_id,v_actor->>'manager_name',v_content_digest);
  v_status:=public.custodial_set_employee_active(p_employee_id,false,p_manager_id,p_reason,true);
  v_response:=public.static_weekly_response_json('vacate_roster_slot',v_revision,v_content_digest,
    v_request_digest,jsonb_build_object('slot_id',p_slot_id,'former_employee_id',p_employee_id,
      'replacement_employee_id',null,'effective_start',p_effective_start,'source_id',p_source_id,
      'source_digest',v_source.source_digest,'employee_status',v_status,'history_preserved',true,
      'completion_mode',case when v_original_publication is null then 'mutation_only' else 'projection_required' end,
      'original_publication_id',v_original_publication));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,
    actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,
    request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_manager_id,v_actor->>'manager_name','vacate_roster_slot',p_idempotency_key,
    p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;
revoke all on function public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)
from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)
to static_weekly_control_plane;

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
    or extract(isodow from p_effective_start)::integer<>1
    or nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500 or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='filling a vacancy requires a stable slot, fresh employee name, Monday effective date, and bounded reason';
  end if;
  v_request:=jsonb_build_object('operation','fill_vacant_slot','slot_id',p_slot_id,'new_employee_name',v_name,'effective_start',p_effective_start,'reason',p_reason,'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  -- A receipt is permanent semantic evidence. Time-dependent new-operation
  -- eligibility must never hide a successful response after its week ends.
  if p_effective_start<v_current_week then
    raise exception using errcode='23514',message='a new vacancy fill cannot start before the current week';
  end if;
  select * into v_slot from public.weekly_roster_slots where slot_id=p_slot_id for share;
  if not found then raise exception using errcode='P0002',message='vacant stable roster position was not found'; end if;
  -- A vacated position is reusable; reject any overlapping or future incumbent.
  if exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges
      where slot_id=p_slot_id and (effective_end is null or p_effective_start<effective_end))
    or (exists(select 1 from public.weekly_roster_slot_incumbencies where slot_id=p_slot_id)
      and not exists(select 1 from public.weekly_roster_slot_staffing_states s
        where s.slot_id=p_slot_id and s.effective_start<=p_effective_start
          and s.staffing_state='vacant_unfilled' and s.employee_id is null
          and not exists(select 1 from public.weekly_roster_slot_staffing_states later
            where later.slot_id=p_slot_id and later.effective_start<=p_effective_start
              and (later.effective_start,later.authority_revision)>(s.effective_start,s.authority_revision)))) then
    raise exception using errcode='23514',message='only a never-filled or explicitly vacated stable position with no current or future incumbent can be filled';
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
    v_date:=v_week_start+mod((v_item->>'dayOfWeek')::integer-extract(dow from v_week_start)::integer+7,7);
    select not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges r
      where r.slot_id=v_slot_id::uuid and r.effective_start<=v_date
        and (r.effective_end is null or v_date<r.effective_end)) into v_is_active_vacant;
    if v_is_active_vacant and not (v_declared_vacant ? v_slot_id) then
      raise exception using errcode='23514',message='dated vacancy requires registered stable-slot capability';
    end if;
    if v_is_active_vacant then
      v_item:=jsonb_set(v_item,'{status}',to_jsonb('vacant_unfilled'::text),true);
    else
      select s.staffing_state into v_state from public.weekly_roster_slot_staffing_states s
      where s.slot_id=v_slot_id::uuid and s.effective_start<=v_date
      order by s.effective_start desc,s.authority_revision desc limit 1;
      if v_state='vacant_unfilled' then
        raise exception using errcode='23514',message='vacant staffing state conflicts with an effective incumbent';
      end if;
      if v_state is not null then v_item:=jsonb_set(v_item,'{status}',to_jsonb(v_state),true);
      elsif v_item->>'status'='vacant_unfilled' then v_item:=jsonb_set(v_item,'{status}',to_jsonb('working'::text),true); end if;
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
  v_vacant:=coalesce(v_document#>'{authority,compilerInput,version,vacancyCapableSlotIds}','[]'::jsonb);
  if jsonb_typeof(v_vacant) is distinct from 'array' then raise exception using errcode='23514',message='draft vacancy authority must be an array'; end if;
  for v_row in select * from public.weekly_schedule_slot_availability where version_id=p_version_id order by day_of_week,slot_id loop
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
    select exists(select 1 from jsonb_array_elements_text(v_vacant) vacancy(slot_id) where vacancy.slot_id=v_row.slot_id::text) into v_is_vacant;
    select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges where slot_id=v_row.slot_id and effective_start<=v_date and (effective_end is null or v_date<effective_end);
    if coalesce((v_document#>'{authority,compilerInput,version,vacantSlotIds}') ? v_row.slot_id::text,false) and v_matches<>0 then
      raise exception using errcode='23514',message='declared whole-week vacancy cannot hide an incumbent';
    end if;
    v_is_vacant:=v_is_vacant and v_matches=0;
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
    v_date:=v_start+mod(v_row.day_of_week-extract(dow from v_start)::integer+7,7);
    if nullif(v_row.payload_json#>>'{authority_facts,baseline_owner_slot_id}','') is not null then
      select exists(select 1 from jsonb_array_elements_text(v_vacant) vacancy(slot_id) where vacancy.slot_id=v_row.payload_json#>>'{authority_facts,baseline_owner_slot_id}') into v_is_vacant;
      select count(*) into v_matches from public.v_weekly_roster_slot_incumbency_ranges
        where slot_id=(v_row.payload_json#>>'{authority_facts,baseline_owner_slot_id}')::uuid
          and effective_start<=v_date and (effective_end is null or v_date<effective_end);
      if v_matches>1 or (v_matches=0 and not v_is_vacant) then
        raise exception using errcode='23514',message='baseline work requires a dated incumbent or registered vacancy capability';
      end if;
      v_is_vacant:=v_is_vacant and v_matches=0;
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

-- A completed vacancy already owns immutable mutation/projection/lunch receipts.
-- Recompiling a retry would create different measured solver diagnostics, which
-- the unchanged exact projection-command binding correctly refuses. Reconstruct
-- the ORIGINAL complete result; never relax a receipt or substitute a new/current
-- projection. The caller first replays the full vacancy writer to validate every
-- original request field, then uses this constrained actor/key lookup.
create function public.static_weekly_v8_read_completed_vacancy(p_manager_id uuid,p_idempotency_key text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare
 v_mutation public.weekly_schedule_command_receipts%rowtype;
 v_receipt public.weekly_schedule_command_receipts%rowtype;
 v_projection public.weekly_schedule_compiled_projections%rowtype;
 v_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_date date;v_week date;v_projection_snapshot jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.custodial_assert_manager(p_manager_id);
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 if p_manager_id is null or nullif(btrim(p_idempotency_key),'') is null then
  raise exception using errcode='22023',message='completed vacancy lookup requires exact manager and command identity';
 end if;
 select * into v_mutation from public.weekly_schedule_command_receipts
  where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key and command_type='vacate_roster_slot';
 if not found then return null; end if;
 perform public.static_weekly_v8_assert_vacancy_receipt(v_mutation.command_id,'vacate_roster_slot');
 if v_mutation.response_json#>>'{data,completion_mode}'='mutation_only'
   and (v_mutation.response_json->'data') ? 'original_publication_id'
   and v_mutation.response_json#>'{data,original_publication_id}'='null'::jsonb then
  return v_mutation.response_json;
 end if;
 if v_mutation.response_json#>>'{data,completion_mode}' is distinct from 'projection_required'
   or nullif(v_mutation.response_json#>>'{data,original_publication_id}','') is null then
  raise exception using errcode='23514',message='completed vacancy original completion binding is missing or inconsistent';
 end if;
 select * into v_receipt from public.weekly_schedule_command_receipts
  where actor_manager_id=p_manager_id and idempotency_key='projection-'||encode(extensions.digest(convert_to(p_idempotency_key,'UTF8'),'sha256'),'hex');
 if not found then
  raise exception using errcode='23514',message='completed vacancy required projection receipt is missing';
 end if;
 perform public.static_weekly_v8_assert_vacancy_receipt(v_receipt.command_id,'materialize_projection');
 v_date:=(v_mutation.request_canonical_json->>'effective_start')::date;
 v_week:=v_date-(extract(isodow from v_date)::integer-1);
 if v_receipt.command_type is distinct from 'materialize_projection'
  or v_receipt.expected_revision is distinct from (v_mutation.response_json->>'revision')::bigint
  or (v_receipt.response_json->>'revision')::bigint is distinct from v_receipt.expected_revision+1
  or v_receipt.request_canonical_json->>'service_date' is distinct from v_week::text
  or v_receipt.request_canonical_json->>'publication_id' is distinct from v_mutation.response_json#>>'{data,original_publication_id}' then
  raise exception using errcode='23514',message='completed vacancy projection receipt does not bind the exact mutation';
 end if;
 select * into v_projection from public.weekly_schedule_compiled_projections
  where projection_id=(v_receipt.response_json#>>'{data,projection_id}')::uuid;
 if not found or v_projection.week_start is distinct from v_week
  or v_projection.publication_id::text is distinct from v_receipt.request_canonical_json->>'publication_id'
  or v_projection.authority_digest is distinct from v_receipt.request_canonical_json#>>'{projection_envelope,authority_digest}'
  or v_projection.replay_digest is distinct from v_receipt.request_canonical_json->>'replay_digest' then
  raise exception using errcode='23514',message='completed vacancy immutable projection binding is missing or inconsistent';
 end if;
 select * into v_lunch from public.weekly_schedule_lunch_documents where projection_id=v_projection.projection_id;
 if not found or v_lunch.accepted_by_manager_id is distinct from p_manager_id
  or v_lunch.document_identity is distinct from v_lunch.document_json->>'document_identity'
  or v_lunch.document_json->>'base_authority_digest' is distinct from v_projection.authority_digest
  or v_lunch.document_json->>'base_replay_digest' is distinct from v_projection.replay_digest then
  raise exception using errcode='23514',message='completed vacancy accepted lunch binding is missing or inconsistent';
 end if;
 perform public.static_weekly_v8_assert_lunch_document(v_projection.projection_id,v_lunch.document_json);
 -- Match the immutable projection descriptor in the manager snapshot used by
 -- the first success. Do not read today's mutable latest-projection selector.
 v_projection_snapshot:=jsonb_build_object(
  'projection_id',v_projection.projection_id::text,'publication_id',v_projection.publication_id::text,
  'version_id',v_projection.version_id::text,'week_start',v_projection.week_start::text,'week_end',v_projection.week_end::text,
  'compiler_version',v_projection.compiler_version,'metrics',v_projection.metrics_json,
  'replay_digest',v_projection.replay_digest,'compiled_at',v_projection.compiled_at,
  'assignments',v_projection.projection_envelope->'assignments');
 return v_receipt.response_json||jsonb_build_object('data',
  (v_mutation.response_json->'data')||(v_receipt.response_json->'data')||
  jsonb_build_object('current_projection',v_projection_snapshot,'mutation',v_mutation.response_json->'data'));
end
$function$;
revoke all on function public.static_weekly_v8_read_completed_vacancy(uuid,text)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v8_read_completed_vacancy(uuid,text) to static_weekly_control_plane;

-- Rebind only this change's objects into the existing release recovery inventory.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare item record; definition text; next_order integer;
begin
  for item in select * from (values
    (1000,'relation','public.weekly_roster_slot_incumbency_closures'),
    (1000,'relation','public.weekly_roster_slot_staffing_states'),
    (100000,'function','public.static_weekly_v8_guard_vacancy_closure()'),
    (100000,'function','public.static_weekly_v8_assert_vacancy_receipt(uuid,text)'),
    (100000,'function','public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'),
    (100000,'function','public.static_weekly_v8_read_completed_vacancy(uuid,text)'),
    (100000,'function','public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'),
    (100000,'function','public.static_weekly_v4_hydrate_compiler_source(jsonb,date)'),
    (100000,'function','public.static_weekly_v3_assert_draft_incumbency(uuid)'),
    (200000,'column','public.weekly_roster_slot_incumbency_closures:replacement_incumbency_id'),
    (200000,'column','public.weekly_roster_slot_staffing_states:employee_id'),
    (500000,'constraint','public.weekly_roster_slot_staffing_states:weekly_roster_slot_staffing_states_vacancy_identity_check'),
    (500000,'constraint','public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check'),
    (500000,'constraint','public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check'),
    (700000,'trigger','public.weekly_roster_slot_incumbency_closures.trg_static_weekly_v8_guard_vacancy_closure'),
    (900000,'grant','public.static_weekly_v8_guard_vacancy_closure()'),
    (900000,'grant','public.static_weekly_v8_assert_vacancy_receipt(uuid,text)'),
    (900000,'grant','public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'),
    (900000,'grant','public.static_weekly_v8_read_completed_vacancy(uuid,text)'),
    (900000,'grant','public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'),
    (900000,'grant','public.static_weekly_v4_hydrate_compiler_source(jsonb,date)'),
    (900000,'grant','public.static_weekly_v3_assert_draft_incumbency(uuid)')
  ) as objects(bucket,kind,identity) order by bucket,identity loop
    definition:=case item.kind
      when 'relation' then public.custodial_release_authority_current_relation_definition(item.identity)
      when 'column' then public.custodial_release_authority_current_column_definition(item.identity)
      when 'constraint' then public.custodial_release_authority_current_constraint_definition(item.identity)
      when 'function' then pg_get_functiondef(to_regprocedure(item.identity))
      when 'grant' then public.custodial_release_authority_current_grant_definition(item.identity)
      when 'trigger' then (select 'drop trigger if exists '||quote_ident(tgname)||
        ' on public.weekly_roster_slot_incumbency_closures; '||pg_get_triggerdef(oid,true)||';'
        from pg_trigger where tgrelid='public.weekly_roster_slot_incumbency_closures'::regclass
          and tgname='trg_static_weekly_v8_guard_vacancy_closure')
      end;
    if definition is null then raise exception 'vacancy recovery object unavailable: %',item.identity; end if;
    update public.custodial_release_authority_restore_inventory
      set definition_sql=definition,definition_sha256=public.static_weekly_digest_text(definition),
        captured_at=statement_timestamp()
      where object_kind=item.kind and object_identity=item.identity;
    if not found then
      select coalesce(max(restore_order),item.bucket)+1 into next_order
        from public.custodial_release_authority_restore_inventory
        where restore_order>=item.bucket
          and restore_order<case when item.bucket=1000 then 100000 else item.bucket+100000 end;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(next_order,item.kind,item.identity,definition,public.static_weekly_digest_text(definition));
    end if;
    if not exists(select 1 from public.custodial_release_authority_restore_inventory
      where object_kind=item.kind and object_identity=item.identity and definition_sql=definition
        and definition_sha256=public.static_weekly_digest_text(definition)) then
      raise exception 'vacancy recovery postflight mismatch: %',item.identity;
    end if;
  end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
