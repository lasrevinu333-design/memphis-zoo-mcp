-- Atomic employee turnover for the static weekly scheduler.
--
-- A stable roster slot owns the recurring route. Employee identity, phone
-- assignment, active state, and staffing availability change together while
-- completed work remains attached to the former immutable employee ID.
begin;

-- Departed Messenger principals remain immutable historical actors, but only
-- active principals reserve an operational display name. This permits a fresh
-- employee identity to reuse a former employee's name without moving history.
alter table public.msg_users drop constraint if exists msg_users_display_name_unique;
create unique index if not exists msg_users_active_display_name_unique
  on public.msg_users(display_name) where is_active is true;

alter table public.weekly_schedule_authority_revisions
  drop constraint if exists weekly_schedule_authority_revisions_operation_check;
alter table public.weekly_schedule_authority_revisions
  add constraint weekly_schedule_authority_revisions_operation_check
  check(operation in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','replace_incumbency','materialize_projection','mark_employee_departed','replace_employee'));

alter table public.weekly_schedule_command_receipts
  drop constraint if exists weekly_schedule_command_receipts_command_type_check;
alter table public.weekly_schedule_command_receipts
  add constraint weekly_schedule_command_receipts_command_type_check
  check(command_type in ('create_draft','update_draft','publish','supersede','rollback','apply_exception','reverse_exception','replace_incumbency','materialize_projection','mark_employee_departed','replace_employee'));

create table if not exists public.weekly_roster_slot_staffing_states (
  staffing_state_id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.weekly_roster_slots(slot_id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  staffing_state text not null check(staffing_state in ('working','departed_named_absent')),
  effective_start date not null,
  authority_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  actor_manager_id uuid not null,
  actor_manager_name_snapshot text not null check(length(btrim(actor_manager_name_snapshot))>0),
  reason text not null check(length(btrim(reason)) between 1 and 500 and reason !~ '[\x00-\x1f\x7f]'),
  content_digest text not null check(content_digest~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(slot_id,effective_start,staffing_state)
);

create index if not exists idx_weekly_roster_slot_staffing_state_ranges
  on public.weekly_roster_slot_staffing_states(slot_id,effective_start desc);

drop trigger if exists trg_static_weekly_weekly_roster_slot_staffing_states_immutable
  on public.weekly_roster_slot_staffing_states;
create trigger trg_static_weekly_weekly_roster_slot_staffing_states_immutable
before update or delete on public.weekly_roster_slot_staffing_states
for each row execute function public.static_weekly_reject_update_delete();

alter table public.weekly_roster_slot_staffing_states enable row level security;
alter table public.weekly_roster_slot_staffing_states force row level security;
revoke all on table public.weekly_roster_slot_staffing_states from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

-- Staffing state is a dated overlay. Stable projection identity retains the
-- shift, capacity, eligibility, routes, and work graph but excludes only the
-- fields deliberately supplied by the append-only staffing ledger.
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
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd'-'namedAbsentSlotIds';
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

-- Registration remains exact. Only dated projections may replace staffing
-- state and incumbent ranges from their append-only ledgers.
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
  v_version:=v_version-'id'-'publicationId'-'status'-'effectiveStart'-'effectiveEnd';
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

create or replace function public.static_weekly_v5_source_availability_template(p_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_source jsonb; v_version jsonb; v_rows jsonb;
begin
  select d.canonical_source into v_source
  from public.static_weekly_authority_source_documents d
  join public.weekly_schedule_versions v on v.authority_source_id=d.source_id
  where v.lifecycle_state='published' and d.active=true and d.retired_at is null
    and exists(select 1 from jsonb_array_elements(d.canonical_source->'slots') slot where slot->>'id'=p_slot_id::text)
  order by v.published_at desc,v.version_id desc limit 1;
  if jsonb_typeof(v_source->'version')='object' then v_version:=v_source->'version';
  elsif jsonb_typeof(v_source->'versions')='array' and jsonb_array_length(v_source->'versions')=1 then v_version:=(v_source->'versions')->0;
  end if;
  select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(v_version->'slotAvailability','[]'::jsonb)) with ordinality as a(item,ordinal)
  where item->>'slotId'=p_slot_id::text;
  if jsonb_array_length(coalesce(v_rows,'[]'::jsonb))=0 then
    raise exception using errcode='23514',message='employee turnover requires a verified recurring availability template for the stable slot';
  end if;
  return v_rows;
end
$function$;

create or replace function public.static_weekly_v4_hydrate_compiler_source(p_source jsonb,p_service_date date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_slots jsonb; v_slot jsonb; v_ranges jsonb; v_hydrated jsonb; v_version jsonb; v_availability jsonb; v_item jsonb; v_date date; v_state text;
begin
  if p_service_date is null or jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_source->'slots') is distinct from 'array' then
    raise exception using errcode='23514',message='dated scheduler source requires one canonical service date and stable slot array';
  end if;
  for v_slot in select value from jsonb_array_elements(p_source->'slots') loop
    if jsonb_typeof(v_slot->'id') is distinct from 'string' or v_slot->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='23514',message='registered scheduler source contains a non-UUID stable roster slot identity';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'personId',r.person_id::text,'displayName',r.person_name_snapshot,
      'effectiveStart',r.effective_start::text,
      'effectiveEnd',case when r.effective_end is null then null else r.effective_end::text end
    ) order by r.effective_start,r.incumbency_id),'[]'::jsonb) into v_ranges
    from public.v_weekly_roster_slot_incumbency_ranges r
    where r.slot_id=(v_slot->>'id')::uuid and r.effective_start<=p_service_date+6
      and (r.effective_end is null or r.effective_end>p_service_date);
    if jsonb_array_length(v_ranges)=0 then
      raise exception using errcode='23514',message='every projected stable roster slot requires closure-aware incumbent history for the requested horizon';
    end if;
    v_slot:=jsonb_set(v_slot,'{incumbencies}',v_ranges,true);
    v_slots:=coalesce(v_slots,'[]'::jsonb)||jsonb_build_array(v_slot);
  end loop;
  v_hydrated:=jsonb_set(p_source,'{slots}',coalesce(v_slots,'[]'::jsonb),true);
  if jsonb_typeof(v_hydrated->'version')='object' then v_version:=v_hydrated->'version';
  elsif jsonb_typeof(v_hydrated->'versions')='array' and jsonb_array_length(v_hydrated->'versions')=1 then v_version:=(v_hydrated->'versions')->0;
  else raise exception using errcode='23514',message='dated scheduler source must carry exactly one recurring version';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(v_version->'slotAvailability','[]'::jsonb)) loop
    v_date:=p_service_date+mod((v_item->>'dayOfWeek')::integer-extract(dow from p_service_date)::integer+7,7);
    select s.staffing_state into v_state from public.weekly_roster_slot_staffing_states s
    where s.slot_id=(v_item->>'slotId')::uuid and s.effective_start<=v_date
    order by s.effective_start desc,s.authority_revision desc limit 1;
    if v_state is not null then v_item:=jsonb_set(v_item,'{status}',to_jsonb(v_state),true); end if;
    v_availability:=coalesce(v_availability,'[]'::jsonb)||jsonb_build_array(v_item);
  end loop;
  v_version:=jsonb_set(v_version,'{slotAvailability}',coalesce(v_availability,'[]'::jsonb),true);
  if jsonb_typeof(v_hydrated->'version')='object' then v_hydrated:=jsonb_set(v_hydrated,'{version}',v_version,true);
  else v_hydrated:=jsonb_set(v_hydrated,'{versions}',jsonb_build_array(v_version),true); end if;
  return jsonb_set(v_hydrated,'{serviceDate}',to_jsonb(p_service_date::text),true);
end
$function$;

create or replace function public.static_weekly_v4_assert_employee_turnover_ready(p_employee_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if exists(select 1 from public.sessions where employee_id=p_employee_id and status in ('active','pending_submit')) then
    raise exception using errcode='23514',message='employee turnover is blocked while cleaning work is active or awaiting submission';
  end if;
  if exists(select 1 from public.custodial_offline_actor_contexts where employee_id=p_employee_id and status='activated') then
    raise exception using errcode='23514',message='employee turnover is blocked while offline work remains activated and unreconciled';
  end if;
end
$function$;

create or replace function public.static_weekly_v5_create_replacement_employee(p_display_name text,p_manager_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_manager public.ops_manager_managers%rowtype; v_name text:=regexp_replace(btrim(coalesce(p_display_name,'')),'\s+',' ','g'); v_code text; v_employee public.employees%rowtype; v_user public.msg_users%rowtype;
begin
  v_manager:=public.custodial_assert_manager(p_manager_id);
  if length(v_name) not between 2 and 160 then raise exception using errcode='22023',message='Employee name must be between 2 and 160 characters.'; end if;
  if exists(select 1 from public.employees where active is true and lower(btrim(display_name))=lower(v_name)) then
    raise exception using errcode='23505',message='An active employee record with that name already exists.';
  end if;
  v_code:=public.custodial_next_employee_code();
  if v_code is null then raise exception using errcode='23514',message='No employee code is available for the replacement.'; end if;
  insert into public.employees(employee_code,display_name,active,role,notes)
  values(v_code,v_name,true,'staff','Fresh employee created by atomic stable-slot replacement') returning * into v_employee;
  insert into public.msg_users(employee_id,display_name,role,is_active)
  values(v_employee.id,v_employee.display_name,'employee',true) returning * into v_user;
  insert into public.custodial_employee_status_history(employee_id,employee_name,previous_active,new_active,changed_by_manager_id,change_reason,source,metadata_json)
  values(v_employee.id,v_employee.display_name,null,true,v_manager.manager_id,'employee_created','static_weekly_turnover',jsonb_build_object('employee_code',v_employee.employee_code,'msg_user_id',v_user.id));
  return jsonb_build_object('created',true,'employee',to_jsonb(v_employee),'messenger_user_id',v_user.id);
end
$function$;

create or replace function public.static_weekly_v4_mark_employee_departed(
  p_slot_id uuid,p_reason text,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_manager public.ops_manager_managers%rowtype; v_prior public.weekly_schedule_command_receipts%rowtype; v_incumbent public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_employee public.employees%rowtype; v_request jsonb; v_request_digest text; v_content_digest text; v_command uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb; v_status jsonb; v_effective_start date:=public.sch_service_date(statement_timestamp());
begin
  perform public.static_weekly_v3_assert_control_plane(); v_manager:=public.custodial_assert_manager(p_manager_id); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,'mark_employee_departed');
  if p_slot_id is null or nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500 or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='departure requires a stable slot and control-free reason of at most 500 characters';
  end if;
  v_request:=jsonb_build_object('operation','mark_employee_departed','slot_id',p_slot_id,'effective_start',v_effective_start,'reason',p_reason,'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  perform public.static_weekly_v5_source_availability_template(p_slot_id);
  select * into v_incumbent from public.v_weekly_roster_slot_incumbency_ranges where slot_id=p_slot_id and effective_start<=v_effective_start and (effective_end is null or v_effective_start<effective_end) order by effective_start desc limit 1;
  if not found then raise exception using errcode='23514',message='departure requires one effective stable-slot incumbent'; end if;
  select * into v_employee from public.employees where id=v_incumbent.person_id for update;
  if not found or v_employee.active is not true then raise exception using errcode='23514',message='departure requires one active custodial employee matching the stable-slot incumbent'; end if;
  perform public.static_weekly_v4_assert_employee_turnover_ready(v_employee.id);
  if exists(select 1 from public.weekly_roster_slot_staffing_states where slot_id=p_slot_id and effective_start=v_effective_start and staffing_state='departed_named_absent') then raise exception using errcode='23505',message='stable slot is already marked departed today'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'mark_employee_departed',p_manager_id,v_actor->>'manager_name',v_command,v_content_digest);
  insert into public.weekly_roster_slot_staffing_states(slot_id,employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(p_slot_id,v_employee.id,'departed_named_absent',v_effective_start,v_revision,p_manager_id,v_actor->>'manager_name',p_reason,v_content_digest);
  v_status:=public.custodial_set_employee_active(v_employee.id,false,p_manager_id,p_reason,true);
  v_response:=public.static_weekly_response_json('mark_employee_departed',v_revision,v_content_digest,v_request_digest,jsonb_build_object('slot_id',p_slot_id,'former_employee_id',v_employee.id,'former_employee_name',v_employee.display_name,'effective_start',v_effective_start,'employee_status',v_status));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_manager_id,v_actor->>'manager_name','mark_employee_departed',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

create or replace function public.static_weekly_v4_replace_employee(
  p_slot_id uuid,p_new_employee_name text,p_reason text,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_actor jsonb; v_manager public.ops_manager_managers%rowtype; v_prior public.weekly_schedule_command_receipts%rowtype; v_incumbent public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_old public.employees%rowtype; v_request jsonb; v_request_digest text; v_content_digest text; v_command uuid:=gen_random_uuid(); v_new_incumbency uuid:=gen_random_uuid(); v_revision bigint; v_response jsonb; v_created jsonb; v_status jsonb; v_assignment jsonb; v_new_employee_id uuid; v_new_name text:=regexp_replace(btrim(coalesce(p_new_employee_name,'')),'\s+',' ','g'); v_device text; v_device_count integer; v_effective_start date:=public.sch_service_date(statement_timestamp());
begin
  perform public.static_weekly_v3_assert_control_plane(); v_manager:=public.custodial_assert_manager(p_manager_id); v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_manager_id,v_actor->>'manager_name',p_idempotency_key,'replace_employee');
  if p_slot_id is null or length(v_new_name) not between 2 and 160 or nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(p_reason)>500 or p_reason~'[\x00-\x1f\x7f]' then
    raise exception using errcode='23514',message='replacement requires a stable slot, new employee name, and control-free reason of at most 500 characters';
  end if;
  v_request:=jsonb_build_object('operation','replace_employee','slot_id',p_slot_id,'new_employee_name',v_new_name,'effective_start',v_effective_start,'reason',p_reason,'expected_revision',p_expected_revision,'actor_manager_id',p_manager_id);
  v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_manager_id and idempotency_key=p_idempotency_key;
  if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  perform public.static_weekly_v5_source_availability_template(p_slot_id);
  select * into v_incumbent from public.v_weekly_roster_slot_incumbency_ranges where slot_id=p_slot_id and effective_start<v_effective_start and (effective_end is null or v_effective_start<effective_end) order by effective_start desc limit 1;
  if not found then raise exception using errcode='23514',message='replacement requires one predecessor stable-slot incumbent'; end if;
  select * into v_old from public.employees where id=v_incumbent.person_id for update;
  if not found then raise exception using errcode='23514',message='replacement predecessor must resolve to a custodial employee'; end if;
  perform public.static_weekly_v4_assert_employee_turnover_ready(v_old.id);
  if exists(select 1 from public.weekly_roster_slot_staffing_states where slot_id=p_slot_id and effective_start=v_effective_start and staffing_state='working') then raise exception using errcode='23505',message='stable slot already has a replacement today'; end if;
  select count(*),min(device_id) into v_device_count,v_device from public.devices where active=true and assigned_employee_id=v_old.id;
  if v_device_count=0 then
    select count(*),min(d.device_id) into v_device_count,v_device
    from public.devices d where d.active=true and d.assigned_employee_id is null and exists(
      select 1 from public.custodial_employee_device_assignment_history h where h.device_id=d.id and h.previous_employee_id=v_old.id and h.new_employee_id is null
        and not exists(select 1 from public.custodial_employee_device_assignment_history newer where newer.device_id=h.device_id and (newer.changed_at,newer.assignment_change_id)>(h.changed_at,h.assignment_change_id))
    );
  end if;
  if v_device_count>1 then raise exception using errcode='23514',message='replacement phone is ambiguous; assign one phone to the stable slot before retrying'; end if;
  if v_old.active then v_status:=public.custodial_set_employee_active(v_old.id,false,p_manager_id,p_reason,true);
  else update public.msg_users set is_active=false,updated_at=statement_timestamp() where employee_id=v_old.id and is_active is true; v_status:=jsonb_build_object('changed',false,'employee',to_jsonb(v_old),'released_devices','[]'::jsonb); end if;
  v_created:=public.static_weekly_v5_create_replacement_employee(v_new_name,p_manager_id);
  v_new_employee_id:=(v_created#>>'{employee,id}')::uuid;
  if v_device is not null then v_assignment:=public.custodial_assign_employee_device(v_device,v_new_employee_id,p_manager_id,p_reason,false); end if;
  v_content_digest:=public.static_weekly_digest_jsonb(v_request-'expected_revision'-'actor_manager_id'-'operation');
  v_revision:=public.static_weekly_advance_authority(p_expected_revision,'replace_employee',p_manager_id,v_actor->>'manager_name',v_command,v_content_digest);
  insert into public.weekly_roster_slot_incumbencies(incumbency_id,slot_id,person_id,person_name_snapshot,effective_start,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  values(v_new_incumbency,p_slot_id,v_new_employee_id,v_new_name,v_effective_start,p_manager_id,v_actor->>'manager_name',v_content_digest);
  insert into public.weekly_roster_slot_incumbency_closures(closed_incumbency_id,replacement_incumbency_id,closed_at_effective_date,authority_revision,actor_manager_id,actor_manager_name_snapshot,content_digest)
  values(v_incumbent.incumbency_id,v_new_incumbency,v_effective_start,v_revision,p_manager_id,v_actor->>'manager_name',v_content_digest);
  insert into public.weekly_roster_slot_staffing_states(slot_id,employee_id,staffing_state,effective_start,authority_revision,actor_manager_id,actor_manager_name_snapshot,reason,content_digest)
  values(p_slot_id,v_new_employee_id,'working',v_effective_start,v_revision,p_manager_id,v_actor->>'manager_name',p_reason,v_content_digest);
  v_response:=public.static_weekly_response_json('replace_employee',v_revision,v_content_digest,v_request_digest,jsonb_build_object('slot_id',p_slot_id,'former_employee_id',v_old.id,'former_employee_name',v_old.display_name,'new_employee_id',v_new_employee_id,'new_employee_name',v_new_name,'new_employee_code',v_created#>>'{employee,employee_code}','effective_start',v_effective_start,'device_id',v_device,'phone_assignment',v_assignment,'former_employee_status',v_status));
  insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
  values(v_command,p_manager_id,v_actor->>'manager_name','replace_employee',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest);
  return v_response;
end
$function$;

-- Preserve the original publication/draft snapshot implementation as an
-- internal base, then enrich its roster and availability with effective-dated
-- employee, staffing, and phone truth. Published rows remain immutable.
alter function public.static_weekly_v3_read_manager_snapshot(date)
  rename to static_weekly_v3_read_manager_snapshot_base;

revoke all on function public.static_weekly_v3_read_manager_snapshot_base(date)
from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;

create or replace function public.static_weekly_v3_read_manager_snapshot(p_week_start date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_snapshot jsonb; v_availability jsonb:='[]'::jsonb; v_roster jsonb:='[]'::jsonb; v_item jsonb; v_date date; v_state text; v_person uuid; v_name text; v_active boolean; v_devices jsonb; v_week_staffing jsonb; v_projection_revision bigint; v_staffing_revision bigint; v_projection_status text:='missing';
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_base(p_week_start);
  for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'availability','[]'::jsonb)) loop
    v_date:=p_week_start+mod((v_item->>'day_of_week')::integer-extract(dow from p_week_start)::integer+7,7);
    select s.staffing_state into v_state from public.weekly_roster_slot_staffing_states s
    where s.slot_id=(v_item->>'slot_id')::uuid and s.effective_start<=v_date
    order by s.effective_start desc,s.authority_revision desc limit 1;
    select r.person_id,r.person_name_snapshot into v_person,v_name from public.v_weekly_roster_slot_incumbency_ranges r
    where r.slot_id=(v_item->>'slot_id')::uuid and r.effective_start<=v_date and (r.effective_end is null or v_date<r.effective_end)
    order by r.effective_start desc,r.incumbency_id desc limit 1;
    select e.active into v_active from public.employees e where e.id=v_person;
    select coalesce(jsonb_agg(d.device_id order by d.device_id),'[]'::jsonb) into v_devices from public.devices d where d.active=true and d.assigned_employee_id=v_person;
    v_item:=v_item||jsonb_build_object(
      'service_date',v_date::text,
      'availability_state',coalesce(v_state,v_item->>'availability_state'),
      'person_id',v_person::text,
      'person_name',v_name,
      'employee_active',v_active,
      'device_ids',coalesce(v_devices,'[]'::jsonb)
    );
    v_availability:=v_availability||jsonb_build_array(v_item);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(v_snapshot->'roster','[]'::jsonb)) loop
    select coalesce(jsonb_agg(a order by a->>'service_date'),'[]'::jsonb) into v_week_staffing
    from jsonb_array_elements(v_availability) a where a->>'slot_id'=v_item->>'slot_id';
    v_roster:=v_roster||jsonb_build_array(v_item||jsonb_build_object('week_staffing',v_week_staffing));
  end loop;
  if jsonb_typeof(v_snapshot->'latest_projection')='object' then
    select (r.response_json->>'revision')::bigint into v_projection_revision
    from public.weekly_schedule_command_receipts r
    where r.command_type='materialize_projection'
      and r.response_json#>>'{data,projection_id}'=v_snapshot#>>'{latest_projection,projection_id}'
    order by r.accepted_at desc,r.command_id desc limit 1;
  end if;
  select max(s.authority_revision) into v_staffing_revision
  from public.weekly_roster_slot_staffing_states s
  where s.effective_start<=p_week_start+6;
  if v_projection_revision is not null and (v_staffing_revision is null or v_projection_revision>v_staffing_revision) then
    v_projection_status:='current';
  elsif v_projection_revision is not null or v_staffing_revision is not null then
    v_projection_status:='stale_staffing_change';
    v_snapshot:=jsonb_set(v_snapshot,'{latest_projection}','null'::jsonb,true);
  end if;
  return jsonb_set(jsonb_set(v_snapshot,'{availability}',v_availability,true),'{roster}',v_roster,true)
    ||jsonb_build_object('projection_status',v_projection_status,'projection_authority_revision',v_projection_revision,'staffing_authority_revision',v_staffing_revision);
end
$function$;

-- Employee phones consume the same effective publication and latest immutable
-- projection as the manager workspace. A governed date never falls back to the
-- legacy daily scheduler when its projection is missing or stale.
create or replace function public.static_weekly_v5_read_employee_day(
  p_service_date date,p_employee_id uuid,p_now timestamptz default now()
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_version uuid; v_publication uuid; v_week_start date; v_projection uuid; v_projection_revision bigint; v_staffing_revision bigint; v_status text:='missing_projection'; v_employee public.employees%rowtype; v_slot uuid; v_slot_count integer; v_shift_start time; v_shift_end time; v_staffing_state text; v_items jsonb:='[]'::jsonb; v_current jsonb:='[]'::jsonb; v_local_date date; v_local_time time; v_phase text; v_notice text;
begin
  if p_service_date is null or p_employee_id is null or p_now is null then raise exception using errcode='22023',message='employee day requires service_date, employee_id, and current time'; end if;
  v_version:=public.static_weekly_effective_version(p_service_date);
  if v_version is null then return jsonb_build_object('governed',false,'service_date',p_service_date::text,'source','legacy_daily_schedule'); end if;
  select p.publication_id into v_publication from public.weekly_schedule_publications p where p.version_id=v_version;
  v_week_start:=p_service_date-(extract(isodow from p_service_date)::integer-1);
  select p.projection_id,(r.response_json->>'revision')::bigint into v_projection,v_projection_revision from public.weekly_schedule_compiled_projections p
  join public.weekly_schedule_command_receipts r on r.command_type='materialize_projection' and r.response_json#>>'{data,projection_id}'=p.projection_id::text
  where p.publication_id=v_publication and p.week_start=v_week_start
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(v_publication,v_week_start))
  order by (r.response_json->>'revision')::bigint desc,r.command_id desc limit 1;
  select max(s.authority_revision) into v_staffing_revision from public.weekly_roster_slot_staffing_states s where s.effective_start<=v_week_start+6;
  if v_projection_revision is not null and (v_staffing_revision is null or v_projection_revision>v_staffing_revision) then v_status:='current';
  elsif v_projection is not null then v_status:='stale_staffing_change'; end if;
  select * into v_employee from public.employees e where e.id=p_employee_id;
  if not found then raise exception using errcode='P0002',message='employee not found'; end if;
  if v_status<>'current' then return jsonb_build_object('governed',true,'source','static_weekly_projection','service_date',p_service_date::text,'week_start',v_week_start::text,'publication_id',v_publication::text,'projection_id',case when v_projection is null then null else v_projection::text end,'projection_status',v_status,'projection_authority_revision',v_projection_revision,'staffing_authority_revision',v_staffing_revision,'employee_id',v_employee.id::text,'employee_name',v_employee.display_name,'items','[]'::jsonb,'all_items','[]'::jsonb,'current_items','[]'::jsonb); end if;
  select count(*),(array_agg(r.slot_id order by r.slot_id))[1] into v_slot_count,v_slot from public.v_weekly_roster_slot_incumbency_ranges r
  where r.person_id=p_employee_id and r.effective_start<=p_service_date and (r.effective_end is null or p_service_date<r.effective_end);
  if v_slot_count>1 then raise exception using errcode='23514',message='employee resolves to more than one effective weekly roster slot'; end if;
  if v_slot is not null then
    select a.shift_start,a.shift_end into v_shift_start,v_shift_end from public.weekly_schedule_slot_availability a
    where a.version_id=v_version and a.slot_id=v_slot and a.day_of_week=extract(dow from p_service_date)::integer;
    select s.staffing_state into v_staffing_state from public.weekly_roster_slot_staffing_states s where s.slot_id=v_slot and s.effective_start<=p_service_date order by s.effective_start desc,s.authority_revision desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.occurrence_id::text,'occurrence_id',o.occurrence_id::text,'projection_id',o.projection_id::text,'service_date',o.service_date::text,
    'segment_number',row_number_value,'location_id',case when o.location_id is null then null else o.location_id::text end,
    'group_code',o.location_code_snapshot,'group_name',o.location_name_snapshot,'location_group_code',o.location_code_snapshot,'location_group_name',o.location_name_snapshot,
    'location_name',o.location_name_snapshot,'included_locations',jsonb_build_array(o.location_name_snapshot),
    'coverage_start',to_char(o.coverage_start,'HH24:MI'),'coverage_end',to_char(o.coverage_end,'HH24:MI'),'start_time',to_char(o.coverage_start,'HH24:MI'),'end_time',to_char(o.coverage_end,'HH24:MI'),
    'coverage_purpose',coalesce(nullif(o.authority_facts_json#>>'{work_snapshot,coveragePurpose}',''),nullif(o.authority_facts_json#>>'{work_snapshot,purpose}',''),'area_owner'),'purpose',coalesce(nullif(o.authority_facts_json#>>'{work_snapshot,coveragePurpose}',''),nullif(o.authority_facts_json#>>'{work_snapshot,purpose}',''),'area_owner'),
    'section_title',case coalesce(nullif(o.authority_facts_json#>>'{work_snapshot,coveragePurpose}',''),nullif(o.authority_facts_json#>>'{work_snapshot,purpose}',''),'area_owner') when 'area_owner' then 'Primary area coverage' when 'restroom_upkeep' then 'Restroom upkeep' when 'deep_clean' then 'Deep cleaning' when 'late_coverage' then 'Late coverage' when 'lunch_coverage' then 'Lunch coverage' else initcap(replace(coalesce(nullif(o.authority_facts_json#>>'{work_snapshot,coveragePurpose}',''),nullif(o.authority_facts_json#>>'{work_snapshot,purpose}',''),'assigned coverage'),'_',' ')) end,
    'source_type','static_weekly_projection','owner_type','EMPLOYEE','status','ASSIGNED','load_points',coalesce((o.authority_facts_json#>>'{work_snapshot,serviceEffortMinutes}')::numeric,1),'notes',null,
    'is_public_restroom',(lower(o.location_name_snapshot) like '%restroom%' or lower(o.location_name_snapshot) like '%bathroom%')
  ) order by o.coverage_start,o.coverage_end,o.location_name_snapshot,o.work_id),'[]'::jsonb) into v_items
  from (select occurrence.*,row_number() over(order by coverage_start,coverage_end,location_name_snapshot,work_id) as row_number_value from public.weekly_schedule_occurrences occurrence where occurrence.projection_id=v_projection and occurrence.service_date=p_service_date and occurrence.owner_person_id_snapshot=p_employee_id and occurrence.state='created') o;
  v_local_date:=(p_now at time zone 'America/Chicago')::date; v_local_time:=(p_now at time zone 'America/Chicago')::time;
  if v_local_date=p_service_date then select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into v_current from jsonb_array_elements(v_items) with ordinality current_item(item,ordinal) where (item->>'coverage_start')::time<=v_local_time and v_local_time<(item->>'coverage_end')::time; end if;
  if v_employee.active is not true or coalesce(v_staffing_state,'working')<>'working' or v_shift_start is null or v_shift_end is null then v_phase:='off_day'; v_notice:='You are not scheduled to work today.';
  elsif jsonb_array_length(v_items)=0 then v_phase:='schedule_missing'; v_notice:='Your shift is active, but no assignments were published. Contact a Custodial Manager.';
  elsif v_local_date<p_service_date or (v_local_date=p_service_date and v_local_time<v_shift_start) then v_phase:='before_shift'; v_notice:=format('Your assigned areas are below. Your shift begins at %s.',to_char(v_shift_start,'FMHH12:MI AM'));
  elsif v_local_date>p_service_date or (v_local_date=p_service_date and v_local_time>=v_shift_end) then v_phase:='after_shift'; v_notice:='Your shift is complete. Today''s assigned areas remain below.';
  elsif jsonb_array_length(v_current)=0 then v_phase:='between_assignments'; v_notice:='No coverage window is active at this moment. Your assigned areas remain below.';
  else v_phase:='assigned_areas'; v_notice:='Your assigned areas are shown below. Choose the practical cleaning order.'; end if;
  return jsonb_build_object('ok',true,'governed',true,'source','static_weekly_projection','contract_version','static-weekly-employee-day.v1','service_date',p_service_date::text,'week_start',v_week_start::text,'publication_id',v_publication::text,'projection_id',v_projection::text,'projection_status',v_status,'projection_authority_revision',v_projection_revision,'staffing_authority_revision',v_staffing_revision,'employee_id',v_employee.id::text,'employee_name',v_employee.display_name,'employee_code',v_employee.employee_code,'employee',jsonb_build_object('id',v_employee.id::text,'display_name',v_employee.display_name,'employee_code',v_employee.employee_code),'shift',case when v_shift_start is null or v_shift_end is null then null else jsonb_build_object('start',to_char(v_shift_start,'HH12:MI AM'),'end',to_char(v_shift_end,'HH12:MI AM'),'shift_start',to_char(v_shift_start,'HH24:MI'),'shift_end',to_char(v_shift_end,'HH24:MI'),'active',v_employee.active and coalesce(v_staffing_state,'working')='working') end,'phase',v_phase,'notice',v_notice,'items',v_current,'all_items',v_items,'current_items',v_current,'assignment_count',jsonb_array_length(v_items),'schedule_status',case when v_phase='off_day' then 'off' when v_phase='schedule_missing' then 'missing_assignments' when v_phase='after_shift' then 'completed' when v_phase='between_assignments' then 'between_assignments' else 'scheduled' end);
end
$function$;

revoke all on function public.static_weekly_v3_read_manager_snapshot(date)
from public,anon,authenticated,service_role,static_weekly_release_operator;
grant execute on function public.static_weekly_v3_read_manager_snapshot(date)
to static_weekly_control_plane;

-- Recompiling one week after a dated roster or staffing change appends a new
-- immutable projection. Exact retries remain unique by authority digest.
alter table public.weekly_schedule_compiled_projections
  drop constraint if exists weekly_schedule_compiled_proj_publication_id_week_start_exc_key;
alter table public.weekly_schedule_compiled_projections
  add constraint weekly_schedule_compiled_proj_publication_id_week_start_exc_key
  unique(publication_id,week_start,exception_set_digest,compiler_version,authority_digest);

create or replace function public.static_weekly_v2_materialize_projection(
  p_publication_id uuid,p_service_date date,p_exception_set_digest text,p_compiler_version text,p_objective jsonb,p_metrics jsonb,p_replay_digest text,p_assignments jsonb,p_expected_revision bigint,p_actor_manager_id uuid,p_actor_manager_name text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_request jsonb; v_request_digest text; v_prior public.weekly_schedule_command_receipts%rowtype; v_publication public.weekly_schedule_publications%rowtype; v_effective_start date; v_effective_end date; v_exception_set jsonb; v_exception_digest text; v_command uuid:=gen_random_uuid(); v_projection uuid:=gen_random_uuid(); v_revision bigint; v_content_digest text; v_response jsonb; v_item jsonb; v_assignment public.weekly_schedule_slot_assignments%rowtype; v_owner public.v_weekly_roster_slot_incumbency_ranges%rowtype; v_occurrence uuid; v_work jsonb;
begin
  perform public.static_weekly_assert_command_identity(p_expected_revision,p_actor_manager_id,p_actor_manager_name,p_idempotency_key,'materialize_projection'); v_request:=jsonb_build_object('operation','materialize_projection','publication_id',p_publication_id,'service_date',p_service_date,'exception_set_digest',p_exception_set_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope',p_assignments,'expected_revision',p_expected_revision,'actor_manager_id',p_actor_manager_id,'actor_manager_name',p_actor_manager_name); v_request_digest:=public.static_weekly_digest_jsonb(v_request); perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_prior from public.weekly_schedule_command_receipts where actor_manager_id=p_actor_manager_id and idempotency_key=p_idempotency_key; if found then if v_prior.request_digest<>v_request_digest then raise exception using errcode='23505',message='idempotency key was already used for different semantic inputs'; end if; return v_prior.response_json; end if;
  select * into v_publication from public.weekly_schedule_publications where publication_id=p_publication_id; select effective_start,effective_end into v_effective_start,v_effective_end from public.v_weekly_schedule_effective_ranges where version_id=v_publication.version_id; if not found or v_publication.publication_id is null or p_service_date is null or public.static_weekly_effective_version(p_service_date) is distinct from v_publication.version_id or mod(p_service_date-v_effective_start,7)<>0 or (v_effective_end is not null and p_service_date+6>=v_effective_end) then raise exception using errcode='23514',message='projection must be an aligned complete seven-day horizon wholly within one effective publication'; end if;
  v_exception_set:=public.static_weekly_accepted_exception_set(p_publication_id,p_service_date); v_exception_digest:=public.static_weekly_digest_jsonb(v_exception_set); if p_exception_set_digest is distinct from v_exception_digest or p_compiler_version is distinct from p_assignments->>'compiler_version' or p_objective is distinct from p_assignments->'objective' or p_metrics is distinct from p_assignments->'metrics' or p_replay_digest is distinct from p_assignments->>'replay_digest' then raise exception using errcode='23514',message='projection command identity must include exact compiler, objective, metrics, replay, and weekly exception authority'; end if;
  perform public.static_weekly_assert_projection_envelope_attested(p_assignments,p_publication_id,p_service_date,v_exception_set); if exists(select 1 from public.weekly_schedule_compiled_projections where publication_id=p_publication_id and week_start=p_service_date and exception_set_digest=v_exception_digest and compiler_version=p_compiler_version and authority_digest=p_assignments->>'authority_digest') then raise exception using errcode='23505',message='immutable projection already exists for this exact weekly authority'; end if;
  v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('publication_id',p_publication_id,'week_start',p_service_date,'exception_set_digest',v_exception_digest,'compiler_version',p_compiler_version,'objective',p_objective,'metrics',p_metrics,'replay_digest',p_replay_digest,'projection_envelope_identity',p_assignments->>'database_projection_identity','attestation',p_assignments->'attestation')); v_revision:=public.static_weekly_advance_authority(p_expected_revision,'materialize_projection',p_actor_manager_id,p_actor_manager_name,v_command,v_content_digest);
  insert into public.weekly_schedule_compiled_projections(projection_id,publication_id,version_id,week_start,week_end,exception_set_json,exception_set_digest,compiler_version,objective_json,metrics_json,replay_digest,authority_digest,receipt_json,projection_envelope,compiled_by_manager_id) values(v_projection,p_publication_id,v_publication.version_id,p_service_date,p_service_date+6,v_exception_set,v_exception_digest,p_compiler_version,p_objective,p_metrics,p_replay_digest,p_assignments->>'authority_digest',p_assignments->'receipt',p_assignments,p_actor_manager_id);
  for v_item in select value from jsonb_array_elements(p_assignments->'assignments') loop
    v_owner:=null; v_assignment:=null; v_work:=v_item->'work_snapshot'; select * into v_assignment from public.weekly_schedule_slot_assignments where version_id=v_publication.version_id and day_of_week=(v_item->>'day_of_week')::smallint and work_id=v_item->>'work_id'; if v_assignment.assignment_id is null and (v_work->>'overlayWork') is distinct from 'true' then raise exception using errcode='23514',message='active baseline work must retain its stored baseline assignment link'; end if;
    if upper(v_item->>'status')='ASSIGNED' then select * into v_owner from public.v_weekly_roster_slot_incumbency_ranges where slot_id=(v_item->>'owner_slot_id')::uuid and effective_start<=(v_item->>'service_date')::date and (effective_end is null or (v_item->>'service_date')::date<effective_end); if not found or v_owner.person_id::text is distinct from v_item->>'owner_person_id' then raise exception using errcode='23514',message='projection assigned owner lacks an effective dated incumbent'; end if; elsif upper(v_item->>'status') not in ('OPEN','REVIEW') or v_item->>'owner_slot_id' is not null or v_item->>'owner_person_id' is not null then raise exception using errcode='23514',message='open and review projection rows must have null owner facts'; end if;
    insert into public.weekly_schedule_occurrences(projection_id,publication_id,version_id,assignment_id,service_date,work_id,day_of_week,location_id,location_code_snapshot,location_name_snapshot,coverage_start,coverage_end,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,state,state_reason,original_actor_person_id,original_actor_name_snapshot,authority_facts_json,occurrence_digest) values(v_projection,p_publication_id,v_publication.version_id,v_assignment.assignment_id,(v_item->>'service_date')::date,v_item->>'work_id',(v_item->>'day_of_week')::smallint,nullif(v_work->>'locationId','')::uuid,coalesce(v_work->>'locationCodeSnapshot',v_item->>'work_id'),coalesce(v_work->>'locationNameSnapshot',v_item->>'work_id'),(v_work#>>'{window,start}')::time,(v_work#>>'{window,end}')::time,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,case lower(v_item->>'status') when 'assigned' then 'created' when 'open' then 'open' else 'review' end,v_item->>'reason_code',nullif(v_item->>'original_actor_person_id','')::uuid,nullif(v_item->>'original_actor_name',''),jsonb_build_object('baseline_owner_slot_id',v_item->>'baseline_owner_slot_id','baseline_owner_person_id',v_item->>'baseline_owner_person_id','baseline_owner_name',v_item->>'baseline_owner_name','original_actor_person_id',v_item->>'original_actor_person_id','original_actor_name',v_item->>'original_actor_name','optimized_owner_slot_id',v_item->>'optimized_owner_slot_id','optimized_owner_person_id',v_item->>'optimized_owner_person_id','actual_actor_person_id',v_item->>'actual_actor_person_id','work_snapshot',v_work),public.static_weekly_digest_jsonb(v_item)) returning occurrence_id into v_occurrence;
    insert into public.weekly_schedule_projection_assignments(projection_id,occurrence_id,work_id,status,reason_code,owner_slot_id,owner_slot_label_snapshot,owner_person_id_snapshot,owner_name_snapshot,authority_facts_json,explanation_json,content_digest) values(v_projection,v_occurrence,v_item->>'work_id',lower(v_item->>'status'),v_item->>'reason_code',case when lower(v_item->>'status')='assigned' then (v_item->>'owner_slot_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then (select slot_label from public.weekly_roster_slots where slot_id=(v_item->>'owner_slot_id')::uuid) else null end,case when lower(v_item->>'status')='assigned' then (v_item->>'owner_person_id')::uuid else null end,case when lower(v_item->>'status')='assigned' then v_owner.person_name_snapshot else null end,(select authority_facts_json from public.weekly_schedule_occurrences where occurrence_id=v_occurrence),coalesce(v_item->'explanation','{}'::jsonb),public.static_weekly_digest_jsonb(v_item));
  end loop;
  v_response:=public.static_weekly_response_json('materialize_projection',v_revision,v_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,'publication_id',p_publication_id,'week_start',p_service_date,'week_end',p_service_date+6,'replay_digest',p_replay_digest)); insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest) values(v_command,p_actor_manager_id,p_actor_manager_name,'materialize_projection',p_idempotency_key,p_expected_revision,v_request_digest,v_request,v_response,v_response->>'output_digest',v_content_digest); return v_response;
end
$function$;

create or replace function public.static_weekly_assert_projection_envelope_attested(p_envelope jsonb,p_publication_id uuid,p_week_start date,p_exception_set jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_legacy jsonb; v_snapshot jsonb; v_document jsonb;
begin
  perform public.static_weekly_assert_exact_object(p_envelope,array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','database_projection_identity','semantic_snapshot','attestation'],'attested projection envelope');
  perform public.static_weekly_assert_authority_attestation(p_envelope->'attestation','dated_projection',public.static_weekly_projection_attestation_payload(p_envelope));
  if p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb((p_envelope-'attestation')-'database_projection_identity') then raise exception using errcode='23514',message='projection semantic identity must bind the complete attested envelope'; end if;
  v_snapshot:=p_envelope->'semantic_snapshot'; perform public.static_weekly_assert_exact_object(v_snapshot,array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],array['schema','recurring_source','overlay_source','applied_exceptions','active_assignments'],'projection semantic snapshot');
  select draft_document into v_document from public.weekly_schedule_versions v join public.weekly_schedule_publications p on p.version_id=v.version_id where p.publication_id=p_publication_id;
  if v_snapshot->>'schema' is distinct from 'memphis-zoo.static-weekly-projection-semantic-snapshot.v1'
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,compilerInput}')
    or v_snapshot->'recurring_source' is distinct from public.static_weekly_v5_projection_source_identity(v_document#>'{semantic_snapshot,recurring_source}')
    or v_snapshot->'overlay_source' is distinct from public.static_weekly_v5_projection_source_identity(p_envelope#>'{authority,overlayCompilerInput}')
    or v_snapshot->'applied_exceptions' is distinct from p_envelope->'applied_exceptions' or v_snapshot->'active_assignments' is distinct from p_envelope->'assignments' then
    raise exception using errcode='23514',message='projection must bind stable recurring source, dated staffing and exceptions, and active assignments';
  end if;
  v_legacy:=p_envelope-'semantic_snapshot'-'attestation'; v_legacy:=jsonb_set(v_legacy,'{database_projection_identity}',to_jsonb(public.static_weekly_digest_jsonb(v_legacy-'database_projection_identity')),true);
  perform public.static_weekly_v4_assert_projection_envelope(v_legacy,p_publication_id,p_week_start,p_exception_set);
end
$function$;

revoke all on function public.static_weekly_v5_projection_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v5_registered_source_identity(jsonb) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v5_source_availability_template(uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_assert_employee_turnover_ready(uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v5_create_replacement_employee(text,uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_mark_employee_departed(uuid,text,bigint,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_replace_employee(uuid,text,text,bigint,uuid,text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.static_weekly_v4_mark_employee_departed(uuid,text,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v4_replace_employee(uuid,text,text,bigint,uuid,text) to static_weekly_control_plane;
grant execute on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) to service_role;

-- The pre-turnover writer accepted arbitrary people and dates without employee,
-- phone, staffing, or projection integration. Historical receipts remain valid,
-- but no executable legacy authority surface survives this migration.
drop function if exists public.static_weekly_v3_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text);
drop function if exists public.static_weekly_v2_replace_incumbency(uuid,uuid,text,date,bigint,uuid,text,text);

comment on table public.weekly_roster_slot_staffing_states is 'Append-only effective-dated working/departed state for a stable recurring roster slot.';
comment on function public.static_weekly_v4_replace_employee(uuid,text,text,bigint,uuid,text) is 'Atomic current-day fresh-start replacement: new employee identity and statistics, stable schedule slot, optional unambiguous phone transfer, former-employee retirement, and immutable turnover receipt.';
comment on function public.static_weekly_v3_read_manager_snapshot(date) is 'One coherent manager week read enriched with effective-dated staffing, incumbent identity, employee active state, and assigned phone truth.';
comment on function public.static_weekly_v5_read_employee_day(date,uuid,timestamptz) is 'Read-only employee phone projection from the current static weekly schedule; governed dates fail visibly when projection authority is stale or missing.';

commit;
