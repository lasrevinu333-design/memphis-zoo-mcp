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
      'source_digest',v_source.source_digest,'employee_status',v_status,'history_preserved',true));
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
    (100000,'function','public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'),
    (100000,'function','public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)'),
    (200000,'column','public.weekly_roster_slot_incumbency_closures:replacement_incumbency_id'),
    (200000,'column','public.weekly_roster_slot_staffing_states:employee_id'),
    (500000,'constraint','public.weekly_roster_slot_staffing_states:weekly_roster_slot_staffing_states_vacancy_identity_check'),
    (500000,'constraint','public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check'),
    (500000,'constraint','public.weekly_schedule_command_receipts:weekly_schedule_command_receipts_command_type_check'),
    (700000,'trigger','public.weekly_roster_slot_incumbency_closures.trg_static_weekly_v8_guard_vacancy_closure'),
    (900000,'grant','public.static_weekly_v8_guard_vacancy_closure()'),
    (900000,'grant','public.static_weekly_v8_vacate_roster_slot(uuid,uuid,uuid,date,text,bigint,uuid,text)'),
    (900000,'grant','public.static_weekly_v7_fill_vacant_roster_slot(uuid,text,date,text,bigint,uuid,text)')
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
