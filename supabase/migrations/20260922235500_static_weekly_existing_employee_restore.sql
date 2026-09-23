-- History-preserving restoration of a previously cancelled named employee to the same stable roster position.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table public.weekly_schedule_authority_revisions
  drop constraint if exists weekly_schedule_authority_revisions_operation_check;
alter table public.weekly_schedule_authority_revisions
  add constraint weekly_schedule_authority_revisions_operation_check
  check(operation in (
    'create_draft','update_draft','publish','supersede','rollback',
    'apply_exception','reverse_exception','replace_incumbency','materialize_projection',
    'mark_employee_departed','replace_employee','create_vacant_slot','fill_vacant_slot',
    'restore_existing_employee'
  ));

alter table public.weekly_schedule_command_receipts
  drop constraint if exists weekly_schedule_command_receipts_command_type_check;
alter table public.weekly_schedule_command_receipts
  add constraint weekly_schedule_command_receipts_command_type_check
  check(command_type in (
    'create_draft','update_draft','publish','supersede','rollback',
    'apply_exception','reverse_exception','replace_incumbency','materialize_projection',
    'mark_employee_departed','replace_employee','create_vacant_slot','fill_vacant_slot',
    'restore_existing_employee'
  ));

create or replace function public.static_weekly_v8_restore_existing_employee(
  p_source_id uuid,
  p_slot_id uuid,
  p_employee_id uuid,
  p_effective_start date,
  p_reason text,
  p_expected_revision bigint,
  p_manager_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_actor jsonb;
  v_prior public.weekly_schedule_command_receipts%rowtype;
  v_slot public.weekly_roster_slots%rowtype;
  v_employee public.employees%rowtype;
  v_source public.static_weekly_authority_source_documents%rowtype;
  v_source_slot jsonb;
  v_source_matches integer;
  v_prior_incumbency_count integer;
  v_request jsonb;
  v_request_digest text;
  v_content_digest text;
  v_command uuid:=gen_random_uuid();
  v_incumbency uuid:=gen_random_uuid();
  v_revision bigint;
  v_response jsonb;
  v_status jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(
    p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,'restore_existing_employee'
  );
  if p_source_id is null or p_slot_id is null or p_employee_id is null or p_effective_start is null
     or p_effective_start<public.sch_service_date(statement_timestamp())
     or nullif(btrim(coalesce(p_reason,'')),'') is null
     or char_length(p_reason)>500 or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='existing-employee restoration requires a release-registered source, stable slot, existing employee, non-past effective date, and bounded reason';
  end if;
  v_request:=jsonb_build_object(
    'operation','restore_existing_employee','source_id',p_source_id,'slot_id',p_slot_id,'employee_id',p_employee_id,
    'effective_start',p_effective_start,'reason',p_reason,
    'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id
  );
  v_request_digest:=public.static_weekly_digest_jsonb(v_request);
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts
    where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest<>v_request_digest then
      raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs';
    end if;
    return v_prior.response_json;
  end if;
  select * into v_slot from public.weekly_roster_slots where slot_id=p_slot_id for share;
  if not found then raise exception using errcode='P0002',message='stable roster position was not found'; end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or v_employee.employee_code!~'^EMP[0-9]+$' then
    raise exception using errcode='23514',message='restoration requires the exact existing custodial employee identity';
  end if;
  if not exists(select 1 from public.msg_users where employee_id=p_employee_id) then
    raise exception using errcode='23514',message='existing employee Messenger identity is missing; restoration will not fabricate a replacement principal';
  end if;
  select * into v_source from public.static_weekly_authority_source_documents
    where source_id=p_source_id and active=true and retired_at is null;
  if not found then
    raise exception using errcode='P0002',message='restoration requires the exact active release-registered recurring source';
  end if;
  select value into v_source_slot from jsonb_array_elements(coalesce(v_source.canonical_source->'slots','[]'::jsonb)) slot(value)
    where value->>'id'=p_slot_id::text;
  if v_source_slot is null then
    raise exception using errcode='23514',message='registered source does not contain the requested stable position';
  end if;
  select count(*) into v_source_matches
  from jsonb_array_elements(coalesce(v_source_slot->'incumbencies','[]'::jsonb)) incumbent(value)
  where value->>'personId'=p_employee_id::text
    and value->>'effectiveStart'=p_effective_start::text
    and (nullif(value->>'effectiveEnd','') is null or p_effective_start<(value->>'effectiveEnd')::date);
  if v_source_matches<>1 then
    raise exception using errcode='23514',message='registered source must bind this exact existing employee to this exact stable position and effective date';
  end if;
  select count(*) into v_prior_incumbency_count
  from public.weekly_roster_slot_incumbencies where slot_id=p_slot_id and person_id=p_employee_id;
  if exists(
    select 1 from public.v_weekly_roster_slot_incumbency_ranges r
    where r.slot_id=p_slot_id
      and (r.effective_start>=p_effective_start
        or (r.effective_start<p_effective_start and (r.effective_end is null or p_effective_start<r.effective_end)))
  ) then
    raise exception using errcode='23514',message='restoration target position already has current or future incumbency authority';
  end if;
  if exists(
    select 1 from public.v_weekly_roster_slot_incumbency_ranges r
    where r.person_id=p_employee_id and r.slot_id<>p_slot_id
      and (r.effective_start>=p_effective_start
        or (r.effective_start<p_effective_start and (r.effective_end is null or p_effective_start<r.effective_end)))
  ) then
    raise exception using errcode='23514',message='existing employee already has current or future authority in another stable position';
  end if;
  perform public.static_weekly_v4_assert_employee_turnover_ready(p_employee_id);
  if exists(
    select 1 from public.weekly_roster_slot_staffing_states
    where slot_id=p_slot_id and effective_start=p_effective_start and staffing_state='working'
  ) then
    raise exception using errcode='23505',message='stable position already has working staffing authority on restoration date';
  end if;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(
    p_expected_revision,'restore_existing_employee',p_manager_id,v_actor->>'manager_name',v_command,v_content_digest
  );
  insert into public.weekly_roster_slot_incumbencies(
    incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,
    created_by_manager_id,created_by_manager_name_snapshot,content_digest
  ) values(
    v_incumbency,p_slot_id,p_employee_id,v_employee.display_name,p_effective_start,
    p_manager_id,v_actor->>'manager_name',v_content_digest
  );
  insert into public.weekly_roster_slot_staffing_states(
    slot_id,employee_id,staffing_state,effective_start,authority_revision,
    actor_manager_id,actor_manager_name_snapshot,reason,content_digest
  ) values(
    p_slot_id,p_employee_id,'working',p_effective_start,v_revision,
    p_manager_id,v_actor->>'manager_name',p_reason,v_content_digest
  );
  v_status:=public.custodial_set_employee_active(p_employee_id,true,p_manager_id,p_reason,false);
  v_response:=public.static_weekly_response_json(
    'restore_existing_employee',v_revision,v_content_digest,v_request_digest,
    jsonb_build_object(
      'slot_id',p_slot_id,'slot_label',v_slot.slot_label,
      'employee_id',p_employee_id,'employee_name',v_employee.display_name,
      'source_id',p_source_id,'source_digest',v_source.source_digest,
      'effective_start',p_effective_start,'prior_scheduler_incumbency_count',v_prior_incumbency_count,
      'restored_incumbency_id',v_incumbency,'employee_status',v_status,
      'phone_assignment',null,'history_preserved',true
    )
  );
  insert into public.weekly_schedule_command_receipts(
    command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,
    expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest
  ) values(
    v_command,p_manager_id,v_actor->>'manager_name','restore_existing_employee',p_idempotency_key,
    p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest
  );
  return v_response;
end
$function$;

revoke all on function public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)
from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)
to static_weekly_control_plane;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare
  v_identity text;
  v_definition text;
  v_restore_order integer;
begin
  foreach v_identity in array array[
    'public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check',
    'public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check'
  ] loop
    v_definition:=public.custodial_release_authority_current_constraint_definition(v_identity);
    if v_definition is null then raise exception 'restore-existing recovery constraint % is unavailable',v_identity; end if;
    update public.custodial_release_authority_restore_inventory
      set definition_sql=v_definition,definition_sha256=public.static_weekly_digest_text(v_definition),captured_at=statement_timestamp()
      where object_kind='constraint' and object_identity=v_identity;
    if not found then
      select coalesce(max(restore_order),500000)+1 into v_restore_order
      from public.custodial_release_authority_restore_inventory where object_kind='constraint';
      insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(v_restore_order,'constraint',v_identity,v_definition,public.static_weekly_digest_text(v_definition));
    end if;
  end loop;
  v_identity:='public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)';
  v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
  if v_definition is null then raise exception 'restore-existing function is unavailable'; end if;
  select coalesce(max(restore_order),100000)+1 into v_restore_order
  from public.custodial_release_authority_restore_inventory where object_kind='function';
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  values(v_restore_order,'function',v_identity,v_definition,public.static_weekly_digest_text(v_definition));
  v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
  if v_definition is null then raise exception 'restore-existing function grant is unavailable'; end if;
  select coalesce(max(restore_order),1000000)+1 into v_restore_order
  from public.custodial_release_authority_restore_inventory where object_kind='grant';
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
  values(v_restore_order,'grant',v_identity,v_definition,public.static_weekly_digest_text(v_definition));
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

do $postflight$
declare v_identity text; v_definition text;
begin
  foreach v_identity in array array[
    'public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check',
    'public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check'
  ] loop
    v_definition:=public.custodial_release_authority_current_constraint_definition(v_identity);
    if not exists(select 1 from public.custodial_release_authority_restore_inventory
      where object_kind='constraint' and object_identity=v_identity
        and definition_sql=v_definition and definition_sha256=public.static_weekly_digest_text(v_definition)) then
      raise exception 'release recovery does not preserve current constraint %',v_identity;
    end if;
  end loop;
  v_identity:='public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text)';
  v_definition:=pg_get_functiondef(to_regprocedure(v_identity));
  if not exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='function' and object_identity=v_identity
      and definition_sql=v_definition and definition_sha256=public.static_weekly_digest_text(v_definition)) then
    raise exception 'release recovery does not preserve restore-existing function';
  end if;
  v_definition:=public.custodial_release_authority_current_grant_definition(v_identity);
  if not exists(select 1 from public.custodial_release_authority_restore_inventory
    where object_kind='grant' and object_identity=v_identity
      and definition_sql=v_definition and definition_sha256=public.static_weekly_digest_text(v_definition)) then
    raise exception 'release recovery does not preserve restore-existing function grant';
  end if;
end
$postflight$;

comment on function public.static_weekly_v8_restore_existing_employee(uuid,uuid,uuid,date,text,bigint,uuid,text) is
  'Restores the same historical employee identity to the same stable roster position by appending new incumbency/staffing authority; prior cancellation history is never erased and no new employee, phone, or Messenger identity is fabricated.';
commit;
