begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $preflight$
begin
 if to_regclass('public.static_weekly_schedule_control') is null
  or to_regclass('public.ops_manager_managers') is null
  or to_regprocedure('public.static_weekly_v3_assert_control_plane()') is null
  or to_regprocedure('public.static_weekly_v3_manager_actor(uuid)') is null
  or to_regprocedure('public.static_weekly_digest_jsonb(jsonb)') is null then
  raise exception 'staffing command ledger prerequisites are unavailable';
 end if;
end $preflight$;

create table public.static_weekly_staffing_commands (
 operation_id uuid primary key default gen_random_uuid(),
 command_kind text not null check(command_kind in ('absence','cancel_absence')),
 employee_id uuid not null references public.employees(id) on delete restrict,
 start_date date not null,
 end_date date not null,
 absence_kind text check(absence_kind in ('daily_absence','pto','unavailable')),
 target_absence_id uuid,
 semantic_body jsonb not null,
 semantic_digest text not null check(semantic_digest~'^[0-9a-f]{64}$'),
 client_prepare_key uuid not null,
 expected_revision bigint not null check(expected_revision>=0),
 prepared_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 state text not null default 'PREPARING' check(state in
  ('PREPARING','PREPARED','ACCEPTED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED')),
 preview_digest text check(preview_digest is null or preview_digest~'^[0-9a-f]{64}$'),
 input_digest text check(input_digest is null or input_digest~'^[0-9a-f]{64}$'),
 candidate_set_digest text check(candidate_set_digest is null or candidate_set_digest~'^[0-9a-f]{64}$'),
 candidate_row_count integer check(candidate_row_count is null or candidate_row_count between 0 and 100000),
 candidate_bytes integer check(candidate_bytes is null or candidate_bytes between 0 and 16777216),
 publication_vector jsonb,
 candidate_summary jsonb,
 accepted_revision bigint check(accepted_revision is null or accepted_revision>=0),
 accepted_receipt jsonb,
 created_at timestamptz not null default statement_timestamp(),
 prepared_at timestamptz,
 accepted_at timestamptz,
 unique(prepared_by_manager_id,client_prepare_key),
 check(start_date<=end_date and end_date-start_date<366),
 check((command_kind='absence' and absence_kind is not null and target_absence_id is null)
    or (command_kind='cancel_absence' and absence_kind is null and target_absence_id is not null)),
 check((state='PREPARING' and preview_digest is null and candidate_set_digest is null and prepared_at is null)
    or state<>'PREPARING'),
 check((state='ACCEPTED' and accepted_revision is not null and accepted_receipt is not null and accepted_at is not null)
    or state<>'ACCEPTED')
);
create index static_weekly_staffing_commands_pending
 on public.static_weekly_staffing_commands(state,created_at,operation_id)
 where state in ('PREPARING','PREPARED');
create index static_weekly_staffing_commands_employee_window
 on public.static_weekly_staffing_commands(employee_id,start_date,end_date,created_at desc);

create table public.static_weekly_staffing_command_receipts (
 receipt_id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 event_kind text not null check(event_kind in
  ('PREPARING','PREPARED','ACCEPTED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED','OBSERVED')),
 actor_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 semantic_digest text not null check(semantic_digest~'^[0-9a-f]{64}$'),
 receipt_json jsonb not null,
 receipt_digest text not null check(receipt_digest~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default statement_timestamp()
);
create index static_weekly_staffing_command_receipts_operation
 on public.static_weekly_staffing_command_receipts(operation_id,recorded_at,receipt_id);

create table public.static_weekly_staffing_staged_candidates (
 operation_id uuid not null references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 candidate_kind text not null check(candidate_kind in ('projection','lunch','schedule_refresh')),
 candidate_key text not null check(length(btrim(candidate_key)) between 1 and 300),
 service_date date not null,
 payload_json jsonb not null,
 payload_digest text not null check(payload_digest~'^[0-9a-f]{64}$'),
 canonical_bytes integer not null check(canonical_bytes between 1 and 16777216),
 staged_at timestamptz not null default statement_timestamp(),
 primary key(operation_id,candidate_kind,candidate_key)
);
create index static_weekly_staffing_staged_candidates_date
 on public.static_weekly_staffing_staged_candidates(operation_id,service_date,candidate_kind,candidate_key);

create table public.static_weekly_staffing_absences (
 absence_id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 absence_kind text not null check(absence_kind in ('daily_absence','pto','unavailable')),
 start_date date not null,
 end_date date not null,
 accepted_operation_id uuid not null unique references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 accepted_revision bigint not null check(accepted_revision>=0),
 accepted_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 accepted_at timestamptz not null default statement_timestamp(),
 check(start_date<=end_date and end_date-start_date<366)
);
alter table public.static_weekly_staffing_commands add constraint static_weekly_staffing_target_absence_fk
 foreign key(target_absence_id) references public.static_weekly_staffing_absences(absence_id) on delete restrict;

create table public.static_weekly_staffing_absence_cancellations (
 cancellation_id uuid primary key default gen_random_uuid(),
 absence_id uuid not null unique references public.static_weekly_staffing_absences(absence_id) on delete restrict,
 accepted_operation_id uuid not null unique references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 remaining_start_date date not null,
 remaining_end_date date not null,
 accepted_revision bigint not null check(accepted_revision>=0),
 accepted_by_manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
 accepted_at timestamptz not null default statement_timestamp(),
 check(remaining_start_date<=remaining_end_date and remaining_end_date-remaining_start_date<366)
);

create table public.static_weekly_schedule_application_intents (
 intent_id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.static_weekly_staffing_commands(operation_id) on delete restrict,
 service_date date not null,
 employee_id uuid not null references public.employees(id) on delete restrict,
 device_id uuid not null references public.devices(id) on delete restrict,
 credential_id uuid not null references public.device_auth_credentials(credential_id) on delete restrict,
 assignment_epoch bigint not null check(assignment_epoch>0),
 authority_revision bigint not null check(authority_revision>=0),
 publication_id uuid not null references public.weekly_schedule_publications(publication_id) on delete restrict,
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 lunch_document_identity text not null check(lunch_document_identity~'^[0-9a-f]{64}$'),
 created_at timestamptz not null default statement_timestamp(),
 unique(operation_id,service_date,employee_id,device_id,assignment_epoch),
 unique(intent_id,employee_id,device_id,credential_id,assignment_epoch)
);
create index static_weekly_schedule_application_intents_pending
 on public.static_weekly_schedule_application_intents(device_id,assignment_epoch,authority_revision desc,created_at desc);

create table public.static_weekly_schedule_application_receipts (
 receipt_id uuid primary key default gen_random_uuid(),
 intent_id uuid not null unique,
 employee_id uuid not null,
 device_id uuid not null,
 credential_id uuid not null,
 assignment_epoch bigint not null check(assignment_epoch>0),
 authority_revision bigint not null check(authority_revision>=0),
 projection_id uuid not null references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 lunch_document_identity text not null check(lunch_document_identity~'^[0-9a-f]{64}$'),
 rendered_digest text not null check(rendered_digest~'^[0-9a-f]{64}$'),
 applied_at timestamptz not null,
 received_at timestamptz not null default statement_timestamp(),
 foreign key(intent_id,employee_id,device_id,credential_id,assignment_epoch)
  references public.static_weekly_schedule_application_intents(intent_id,employee_id,device_id,credential_id,assignment_epoch)
  on delete restrict
);

create or replace function public.static_weekly_v10_staffing_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if tg_op='DELETE' then raise exception 'staffing commands are durable and cannot be deleted'; end if;
 if current_setting('app.static_weekly_staffing_write',true) is distinct from 'on' then
  raise exception 'staffing command transitions require the typed authority RPC';
 end if;
 if (to_jsonb(new)-array['state','preview_digest','input_digest','candidate_set_digest','candidate_row_count',
  'candidate_bytes','publication_vector','candidate_summary','accepted_revision','accepted_receipt',
  'prepared_at','accepted_at']) is distinct from
  (to_jsonb(old)-array['state','preview_digest','input_digest','candidate_set_digest','candidate_row_count',
  'candidate_bytes','publication_vector','candidate_summary','accepted_revision','accepted_receipt',
  'prepared_at','accepted_at']) then raise exception 'immutable staffing command identity changed'; end if;
 if not ((old.state='PREPARING' and new.state in ('PREPARED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED'))
  or (old.state='PREPARED' and new.state in ('ACCEPTED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED')))
  then raise exception 'invalid staffing command state transition'; end if;
 return new;
end $function$;
create trigger trg_static_weekly_staffing_guard before update or delete
 on public.static_weekly_staffing_commands for each row execute function public.static_weekly_v10_staffing_guard();

do $security$
declare relation_name text; role_name text;
begin
 foreach relation_name in array array[
  'static_weekly_staffing_commands','static_weekly_staffing_command_receipts',
  'static_weekly_staffing_staged_candidates','static_weekly_staffing_absences',
  'static_weekly_staffing_absence_cancellations','static_weekly_schedule_application_intents',
  'static_weekly_schedule_application_receipts'] loop
  execute format('alter table public.%I enable row level security',relation_name);
  execute format('alter table public.%I force row level security',relation_name);
  foreach role_name in array array['public','anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'] loop
   if role_name='public' or exists(select 1 from pg_roles where rolname=role_name) then
    execute format('revoke all on table public.%I from %I',relation_name,role_name);
   end if;
  end loop;
 end loop;
end $security$;

create trigger trg_static_weekly_staffing_receipt_immutable before update or delete
 on public.static_weekly_staffing_command_receipts for each row execute function public.static_weekly_reject_update_delete();
create trigger trg_static_weekly_staffing_stage_immutable before update or delete
 on public.static_weekly_staffing_staged_candidates for each row execute function public.static_weekly_reject_update_delete();
create trigger trg_static_weekly_staffing_absence_immutable before update or delete
 on public.static_weekly_staffing_absences for each row execute function public.static_weekly_reject_update_delete();
create trigger trg_static_weekly_staffing_cancel_immutable before update or delete
 on public.static_weekly_staffing_absence_cancellations for each row execute function public.static_weekly_reject_update_delete();
create trigger trg_static_weekly_schedule_intent_immutable before update or delete
 on public.static_weekly_schedule_application_intents for each row execute function public.static_weekly_reject_update_delete();
create trigger trg_static_weekly_schedule_receipt_immutable before update or delete
 on public.static_weekly_schedule_application_receipts for each row execute function public.static_weekly_reject_update_delete();

create or replace function public.static_weekly_v10_begin_staffing_command(
 p_semantic_body jsonb,p_client_prepare_key uuid,
 p_expected_revision bigint,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor jsonb; prior public.static_weekly_staffing_commands%rowtype;
 v_operation uuid:=gen_random_uuid();v_command_kind text;v_employee uuid;v_start_date date;v_end_date date;
 v_absence_kind text;v_target_absence uuid;v_current_revision bigint;v_receipt jsonb;v_semantic_digest text;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 if jsonb_typeof(p_semantic_body) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_semantic_body) key)
   is distinct from array['absenceKind','commandKind','employeeId','endDate','startDate','targetAbsenceId']::text[]
  or p_client_prepare_key is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception using errcode='22023',message='invalid canonical staffing command';
 end if;
 v_semantic_digest:=public.static_weekly_digest_jsonb(p_semantic_body);
 v_command_kind:=p_semantic_body->>'commandKind';
 v_employee:=(p_semantic_body->>'employeeId')::uuid;
 v_start_date:=(p_semantic_body->>'startDate')::date;
 v_end_date:=(p_semantic_body->>'endDate')::date;
 v_absence_kind:=nullif(p_semantic_body->>'absenceKind','');
 v_target_absence:=nullif(p_semantic_body->>'targetAbsenceId','')::uuid;
 if v_start_date>v_end_date or v_end_date-v_start_date>=366
  or (v_command_kind='absence' and (v_absence_kind not in ('daily_absence','pto','unavailable') or v_target_absence is not null))
  or (v_command_kind='cancel_absence' and (v_absence_kind is not null or v_target_absence is null))
  or v_command_kind not in ('absence','cancel_absence') then
  raise exception using errcode='22023',message='invalid staffing command semantics';
 end if;
 select * into prior from public.static_weekly_staffing_commands
  where prepared_by_manager_id=p_manager_id and client_prepare_key=p_client_prepare_key for share;
 if found then
  if prior.semantic_digest is distinct from v_semantic_digest or prior.semantic_body is distinct from p_semantic_body
   or prior.expected_revision is distinct from p_expected_revision then
   raise exception using errcode='23505',message='staffing prepare key was used for different semantics';
  end if;
  return jsonb_build_object('operation_id',prior.operation_id,'state',prior.state,
   'semantic_digest',prior.semantic_digest,'expected_revision',prior.expected_revision,'replayed',true);
 end if;
 if v_command_kind='cancel_absence' and v_start_date<public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='staffing cancellation cannot rewrite an elapsed service date';end if;
 select control.current_revision into v_current_revision from public.static_weekly_schedule_control control where control.singleton for share;
 if v_current_revision is distinct from p_expected_revision then
  raise exception using errcode='40001',message='staffing command expected revision is stale';
 end if;
 if not exists(select 1 from public.employees where id=v_employee and active=true) then
  raise exception using errcode='23514',message='staffing command employee is not currently active';
 end if;
 if v_command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a where a.absence_id=v_target_absence
   and a.employee_id=v_employee and v_start_date between a.start_date and a.end_date and v_end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
 ) then raise exception using errcode='23514',message='cancellation must target the exact uncancelled remaining absence window'; end if;
 perform set_config('app.static_weekly_staffing_write','on',true);
 insert into public.static_weekly_staffing_commands(operation_id,command_kind,employee_id,start_date,end_date,
  absence_kind,target_absence_id,semantic_body,semantic_digest,client_prepare_key,expected_revision,prepared_by_manager_id)
 values(v_operation,v_command_kind,v_employee,v_start_date,v_end_date,v_absence_kind,v_target_absence,p_semantic_body,
  v_semantic_digest,p_client_prepare_key,p_expected_revision,p_manager_id);
 v_receipt:=jsonb_build_object('operation_id',v_operation,'event','PREPARING','manager_id',p_manager_id,
  'semantic_digest',v_semantic_digest,'expected_revision',p_expected_revision,'recorded_at',statement_timestamp());
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest)
 values(v_operation,'PREPARING',p_manager_id,v_semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
 return jsonb_build_object('operation_id',v_operation,'state','PREPARING','semantic_digest',v_semantic_digest,
  'expected_revision',p_expected_revision,'replayed',false);
end $function$;

create or replace function public.static_weekly_v10_stage_staffing_command(
 p_operation_id uuid,p_candidates jsonb,p_preview_digest text,p_input_digest text,
 p_publication_vector jsonb,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor jsonb;command public.static_weekly_staffing_commands%rowtype;
 v_candidate_set_digest text;v_candidate_rows integer;v_candidate_bytes bigint;v_week_count integer;
 v_projection_weeks integer;v_lunch_weeks integer;v_summary jsonb;v_receipt jsonb;v_current_revision bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may stage this command';end if;
 if p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or p_input_digest is null or p_input_digest!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_publication_vector) is distinct from 'object'
  or jsonb_typeof(p_candidates) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid staffing candidate envelope';end if;
 v_candidate_set_digest:=public.static_weekly_digest_jsonb(p_candidates);
 if command.state='PREPARED' then
  if command.candidate_set_digest is distinct from v_candidate_set_digest
   or command.preview_digest is distinct from p_preview_digest
   or command.input_digest is distinct from p_input_digest
   or command.publication_vector is distinct from p_publication_vector then
   raise exception using errcode='23505',message='prepared staffing operation was replayed with different candidates';end if;
  return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
   'candidate_set_digest',command.candidate_set_digest,'candidate_row_count',command.candidate_row_count,
   'candidate_bytes',command.candidate_bytes,'candidate_summary',command.candidate_summary,'replayed',true);
 end if;
 if command.state<>'PREPARING' then raise exception using errcode='55000',message='staffing command cannot be staged from its current state';end if;
 select control.current_revision into v_current_revision from public.static_weekly_schedule_control control where control.singleton for share;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing command expected revision became stale during preparation';end if;
 if not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='staffing cancellation cannot rewrite an elapsed service date during preparation';end if;
 if command.command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a where a.absence_id=command.target_absence_id
   and a.employee_id=command.employee_id and command.start_date between a.start_date and a.end_date
   and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
 ) then raise exception using errcode='23514',message='staffing cancellation remaining window changed during preparation';end if;
 if jsonb_array_length(p_candidates)>100000 then raise exception using errcode='54000',message='staffing candidate row limit exceeded';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item where jsonb_typeof(item)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(item) key)
      is distinct from array['candidateKey','candidateKind','payload','serviceDate']::text[]
   or jsonb_typeof(item->'candidateKind') is distinct from 'string'
   or item->>'candidateKind' not in ('projection','lunch','schedule_refresh')
   or jsonb_typeof(item->'candidateKey') is distinct from 'string'
   or length(btrim(item->>'candidateKey')) not between 1 and 300
   or item->>'candidateKey' is distinct from btrim(item->>'candidateKey')
   or jsonb_typeof(item->'serviceDate') is distinct from 'string'
   or item->>'serviceDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(item->'payload') is distinct from 'object'
   or case when item->>'candidateKind' in ('projection','lunch')
      then (item->>'serviceDate')::date not between date_trunc('week',command.start_date::timestamp)::date
        and date_trunc('week',command.end_date::timestamp)::date
      else (item->>'serviceDate')::date not between command.start_date and command.end_date end) then
  raise exception using errcode='22023',message='invalid staffing candidate row';end if;
 if p_candidates is distinct from (select coalesce(jsonb_agg(item order by (item->>'serviceDate') collate "C",
   (item->>'candidateKind') collate "C",(item->>'candidateKey') collate "C"),'[]'::jsonb) from jsonb_array_elements(p_candidates) item) then
  raise exception using errcode='22023',message='staffing candidates are not in deterministic order';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item
  group by item->>'candidateKind',item->>'candidateKey' having count(*)<>1) then
  raise exception using errcode='23505',message='duplicate staffing candidate identity';end if;
 select count(*) into v_week_count from generate_series(
  date_trunc('week',command.start_date::timestamp)::date,
  date_trunc('week',command.end_date::timestamp)::date,'7 days'::interval);
 select count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='projection'),
  count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='lunch')
 into v_projection_weeks,v_lunch_weeks from jsonb_array_elements(p_candidates) item
 where extract(isodow from (item->>'serviceDate')::date)=1;
 if v_projection_weeks is distinct from v_week_count or v_lunch_weeks is distinct from v_week_count
  or exists(select 1 from generate_series(date_trunc('week',command.start_date::timestamp)::date,
    date_trunc('week',command.end_date::timestamp)::date,'7 days'::interval) week_start
   where not exists(select 1 from jsonb_array_elements(p_candidates) item
    where item->>'candidateKind'='projection' and (item->>'serviceDate')::date=week_start::date)
    or not exists(select 1 from jsonb_array_elements(p_candidates) item
    where item->>'candidateKind'='lunch' and (item->>'serviceDate')::date=week_start::date)) then
  raise exception using errcode='23514',message='staffing projection or lunch candidate weeks are incomplete';end if;
 select count(*),coalesce(sum(octet_length(item::text)),0) into v_candidate_rows,v_candidate_bytes
  from jsonb_array_elements(p_candidates) item;
 if v_candidate_bytes>16777216 then raise exception using errcode='54000',message='staffing candidate byte limit exceeded';end if;
 v_summary:=jsonb_build_object('weeks',v_week_count,
  'projections',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='projection'),
  'lunches',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='lunch'),
  'scheduleRefreshes',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='schedule_refresh'));
 insert into public.static_weekly_staffing_staged_candidates(operation_id,candidate_kind,candidate_key,service_date,
  payload_json,payload_digest,canonical_bytes)
 select command.operation_id,item->>'candidateKind',item->>'candidateKey',(item->>'serviceDate')::date,item->'payload',
  public.static_weekly_digest_jsonb(item->'payload'),octet_length(item::text)
 from jsonb_array_elements(p_candidates) item;
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='PREPARED',preview_digest=p_preview_digest,
  input_digest=p_input_digest,candidate_set_digest=v_candidate_set_digest,candidate_row_count=v_candidate_rows,
  candidate_bytes=v_candidate_bytes,publication_vector=p_publication_vector,candidate_summary=v_summary,
  prepared_at=statement_timestamp() where operation_id=command.operation_id;
 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','PREPARED','manager_id',p_manager_id,
  'semantic_digest',command.semantic_digest,'candidate_set_digest',v_candidate_set_digest,
  'candidate_row_count',v_candidate_rows,'candidate_bytes',v_candidate_bytes,'recorded_at',statement_timestamp());
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'PREPARED',p_manager_id,
  command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
 return jsonb_build_object('operation_id',command.operation_id,'state','PREPARED',
  'candidate_set_digest',v_candidate_set_digest,'candidate_row_count',v_candidate_rows,
  'candidate_bytes',v_candidate_bytes,'candidate_summary',v_summary,'replayed',false);
end $function$;

create or replace function public.static_weekly_v10_read_staffing_command(
 p_operation_id uuid,p_manager_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare command public.static_weekly_staffing_commands%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null; end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
  'semantic_body',command.semantic_body,'semantic_digest',command.semantic_digest,
  'expected_revision',command.expected_revision,'prepared_by_manager_id',command.prepared_by_manager_id,
  'preview_digest',command.preview_digest,'candidate_set_digest',command.candidate_set_digest,
  'input_digest',command.input_digest,'publication_vector',command.publication_vector,
  'candidate_row_count',command.candidate_row_count,'candidate_bytes',command.candidate_bytes,
  'candidate_summary',command.candidate_summary,'accepted_revision',command.accepted_revision,
  'accepted_receipt',command.accepted_receipt,'created_at',command.created_at,'prepared_at',command.prepared_at,
  'accepted_at',command.accepted_at,'current_service_date',public.sch_service_date(statement_timestamp())::text,
  'preview',case when command.state='PREPARED' then jsonb_build_object(
   'schema','memphis-zoo.staffing-command-preview.v1',
   'weeks',coalesce((select jsonb_agg(jsonb_build_object(
    'week_start',projection.service_date::text,
    'assignments',coalesce(projection.payload_json#>'{envelope,assignments}','[]'::jsonb),
    'lunch_responsibilities',coalesce(lunch.payload_json->'responsibilities','[]'::jsonb),
    'lunch_loans',coalesce(lunch.payload_json->'loans','[]'::jsonb)) order by projection.service_date)
   from public.static_weekly_staffing_staged_candidates projection
   left join public.static_weekly_staffing_staged_candidates lunch
    on lunch.operation_id=projection.operation_id and lunch.candidate_kind='lunch'
     and lunch.service_date=projection.service_date
   where projection.operation_id=command.operation_id and projection.candidate_kind='projection'),'[]'::jsonb))
   else null end);
end $function$;

create or replace function public.static_weekly_v10_list_pending_staffing_commands(
 p_manager_id uuid,p_limit integer default 50,p_after_created_at timestamptz default null,p_after_operation_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare rows jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 if p_limit not between 1 and 100 or ((p_after_created_at is null)<>(p_after_operation_id is null)) then
  raise exception using errcode='22023',message='invalid staffing command page'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('operation_id',c.operation_id,'state',c.state,
  'semantic_body',c.semantic_body,'semantic_digest',c.semantic_digest,'expected_revision',c.expected_revision,
  'prepared_by_manager_id',c.prepared_by_manager_id,'preview_digest',c.preview_digest,
  'candidate_summary',c.candidate_summary,'created_at',c.created_at,'prepared_at',c.prepared_at)
  order by c.created_at,c.operation_id),'[]'::jsonb) into rows
 from (select * from public.static_weekly_staffing_commands c
  where c.state in ('PREPARING','PREPARED') and (p_after_created_at is null or (c.created_at,c.operation_id)>(p_after_created_at,p_after_operation_id))
  order by c.created_at,c.operation_id limit p_limit) c;
 return jsonb_build_object('commands',rows,'limit',p_limit);
end $function$;

create or replace function public.static_weekly_v10_read_device_schedule_application(
 p_service_date date,p_device_id uuid,p_credential_id uuid,p_employee_id uuid,p_assignment_epoch bigint
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare target public.static_weekly_schedule_application_intents%rowtype;receipt public.static_weekly_schedule_application_receipts%rowtype;
begin
 if p_service_date is null or p_device_id is null or p_credential_id is null or p_employee_id is null
  or p_assignment_epoch is null or p_assignment_epoch<1 then
  raise exception using errcode='22023',message='complete schedule application principal is required';end if;
 if not exists(select 1 from public.devices d where d.id=p_device_id and d.active=true
   and d.assigned_employee_id=p_employee_id and d.assignment_epoch=p_assignment_epoch)
  or not exists(select 1 from public.device_auth_credentials c where c.credential_id=p_credential_id
   and c.device_id=p_device_id and c.confirmed_at is not null and c.revoked_at is null
   and c.expires_at>statement_timestamp()) then
  raise exception using errcode='42501',message='current schedule application principal is required';end if;
 select * into target from public.static_weekly_schedule_application_intents i
  where i.service_date=p_service_date and i.device_id=p_device_id and i.credential_id=p_credential_id
   and i.employee_id=p_employee_id and i.assignment_epoch=p_assignment_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then return null;end if;
 select * into receipt from public.static_weekly_schedule_application_receipts r where r.intent_id=target.intent_id;
 return jsonb_build_object('intent_id',target.intent_id,'operation_id',target.operation_id,
  'service_date',target.service_date,'employee_id',target.employee_id,'device_id',target.device_id,
  'credential_id',target.credential_id,'assignment_epoch',target.assignment_epoch,
  'authority_revision',target.authority_revision,'publication_id',target.publication_id,
  'projection_id',target.projection_id,'lunch_document_identity',target.lunch_document_identity,
  'application_status',case when receipt.receipt_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'rendered_digest',receipt.rendered_digest,'applied_at',receipt.applied_at,'received_at',receipt.received_at);
end $function$;

create or replace function public.static_weekly_v10_ack_device_schedule_application(
 p_intent_id uuid,p_device_id uuid,p_credential_id uuid,p_employee_id uuid,p_assignment_epoch bigint,
 p_authority_revision bigint,p_projection_id uuid,p_lunch_document_identity text,
 p_rendered_digest text,p_applied_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare target public.static_weekly_schedule_application_intents%rowtype;prior public.static_weekly_schedule_application_receipts%rowtype;v_receipt uuid:=gen_random_uuid();
begin
 if p_rendered_digest is null or p_rendered_digest!~'^[0-9a-f]{64}$' or p_applied_at is null
  or p_applied_at>statement_timestamp()+interval '5 minutes' then
  raise exception using errcode='22023',message='invalid schedule application receipt';end if;
 select * into target from public.static_weekly_schedule_application_intents where intent_id=p_intent_id for share;
 if not found or target.device_id is distinct from p_device_id or target.credential_id is distinct from p_credential_id
  or target.employee_id is distinct from p_employee_id or target.assignment_epoch is distinct from p_assignment_epoch
  or target.authority_revision is distinct from p_authority_revision or target.projection_id is distinct from p_projection_id
  or target.lunch_document_identity is distinct from p_lunch_document_identity or p_applied_at<target.created_at then
  raise exception using errcode='23514',message='schedule application receipt does not match its complete target';end if;
 if not exists(select 1 from public.devices d where d.id=p_device_id and d.active=true
   and d.assigned_employee_id=p_employee_id and d.assignment_epoch=p_assignment_epoch)
  or not exists(select 1 from public.device_auth_credentials c where c.credential_id=p_credential_id
   and c.device_id=p_device_id and c.confirmed_at is not null and c.revoked_at is null
   and c.expires_at>statement_timestamp()) then
  raise exception using errcode='42501',message='current schedule application principal is required';end if;
 select * into prior from public.static_weekly_schedule_application_receipts where intent_id=p_intent_id;
 if found then
  if prior.employee_id is distinct from p_employee_id or prior.device_id is distinct from p_device_id
   or prior.credential_id is distinct from p_credential_id or prior.assignment_epoch is distinct from p_assignment_epoch
   or prior.authority_revision is distinct from p_authority_revision or prior.projection_id is distinct from p_projection_id
   or prior.lunch_document_identity is distinct from p_lunch_document_identity
   or prior.rendered_digest is distinct from p_rendered_digest or prior.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='schedule application intent already has a different receipt';end if;
  return jsonb_build_object('intent_id',prior.intent_id,'receipt_id',prior.receipt_id,
   'application_status','DEVICE_REPORTED_APPLIED','received_at',prior.received_at,'replayed',true);
 end if;
 insert into public.static_weekly_schedule_application_receipts(receipt_id,intent_id,employee_id,device_id,
  credential_id,assignment_epoch,authority_revision,projection_id,lunch_document_identity,rendered_digest,applied_at)
 values(v_receipt,p_intent_id,p_employee_id,p_device_id,p_credential_id,p_assignment_epoch,p_authority_revision,
  p_projection_id,p_lunch_document_identity,p_rendered_digest,p_applied_at);
 return jsonb_build_object('intent_id',p_intent_id,'receipt_id',v_receipt,
  'application_status','DEVICE_REPORTED_APPLIED','received_at',statement_timestamp(),'replayed',false);
end $function$;

create or replace function public.static_weekly_v10_read_staffing_delivery_status(
 p_operation_id uuid,p_manager_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare result jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 if not exists(select 1 from public.static_weekly_staffing_commands where operation_id=p_operation_id) then return null;end if;
 select jsonb_build_object('operation_id',p_operation_id,'targets',coalesce(jsonb_agg(jsonb_build_object(
  'intent_id',i.intent_id,'service_date',i.service_date,'employee_id',i.employee_id,'device_id',i.device_id,
  'credential_id',i.credential_id,'assignment_epoch',i.assignment_epoch,'authority_revision',i.authority_revision,
  'projection_id',i.projection_id,'lunch_document_identity',i.lunch_document_identity,
  'status',case when r.receipt_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'rendered_digest',r.rendered_digest,'applied_at',r.applied_at,'received_at',r.received_at)
  order by i.service_date,i.employee_id,i.device_id),'[]'::jsonb)) into result
 from public.static_weekly_schedule_application_intents i
 left join public.static_weekly_schedule_application_receipts r on r.intent_id=i.intent_id
 where i.operation_id=p_operation_id;
 return result;
end $function$;

create or replace function public.static_weekly_v10_cancel_staffing_preparation(
 p_operation_id uuid,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor jsonb;command public.static_weekly_staffing_commands%rowtype;v_event text;v_receipt jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.state='ACCEPTED' then
  return jsonb_build_object('operation_id',command.operation_id,'state','ACCEPTED',
   'accepted_revision',command.accepted_revision,'accepted_receipt',command.accepted_receipt,'cancelled',false);
 end if;
 if command.state in ('CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED') then
  return jsonb_build_object('operation_id',command.operation_id,'state',command.state,'cancelled',command.state<>'REJECTED','replayed',true);
 end if;
 if command.state not in ('PREPARING','PREPARED') then
  raise exception using errcode='55000',message='staffing command cannot be cancelled from its current state';end if;
 v_event:=case when command.prepared_by_manager_id=p_manager_id then 'CANCELLED' else 'CANCELLED_BY_SUCCESSOR' end;
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state=v_event where operation_id=command.operation_id;
 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event',v_event,'manager_id',p_manager_id,
  'original_preparer_manager_id',command.prepared_by_manager_id,'semantic_digest',command.semantic_digest,
  'recorded_at',statement_timestamp());
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,v_event,p_manager_id,
  command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
 return jsonb_build_object('operation_id',command.operation_id,'state',v_event,'cancelled',true,'replayed',false);
end $function$;

do $acl$ declare signature regprocedure;role_name text;begin
 foreach signature in array array[
  'public.static_weekly_v10_staffing_guard()'::regprocedure,
  'public.static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid)'::regprocedure,
  'public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)'::regprocedure,
  'public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure,
  'public.static_weekly_v10_list_pending_staffing_commands(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
  'public.static_weekly_v10_read_device_schedule_application(date,uuid,uuid,uuid,bigint)'::regprocedure,
  'public.static_weekly_v10_ack_device_schedule_application(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,timestamp with time zone)'::regprocedure,
  'public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure,
  'public.static_weekly_v10_cancel_staffing_preparation(uuid,uuid)'::regprocedure] loop
  execute format('revoke all on function %s from public',signature);
  foreach role_name in array array['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'] loop
   if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on function %s from %I',signature,role_name);end if;
  end loop;
 end loop;
end $acl$;
grant execute on function public.static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid),
 public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid),
 public.static_weekly_v10_read_staffing_command(uuid,uuid),
 public.static_weekly_v10_list_pending_staffing_commands(uuid,integer,timestamptz,uuid),
 public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid),
 public.static_weekly_v10_cancel_staffing_preparation(uuid,uuid)
 to static_weekly_control_plane;
grant execute on function public.static_weekly_v10_read_device_schedule_application(date,uuid,uuid,uuid,bigint),
 public.static_weekly_v10_ack_device_schedule_application(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,timestamptz)
 to service_role;

comment on table public.static_weekly_staffing_commands is
 'Private durable manager staffing-command ledger. PREPARING and PREPARED are not schedule authority.';
comment on table public.static_weekly_staffing_staged_candidates is
 'Private non-authoritative complete candidate staging; rows never become schedule authority without the typed atomic commit.';
comment on table public.static_weekly_schedule_application_receipts is
 'Exact assignment-bound device-reported schedule render evidence; never proof a person read the schedule.';

do $surface$ declare definition text;additions text;begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 then
  raise exception 'staffing canary seam missing';end if;
 select string_agg(format('(%L,%L,%L),','function',p.oid::regprocedure::text,'staffing command authority'),E'\n'
  order by p.proname,pg_get_function_identity_arguments(p.oid)) into additions
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and starts_with(p.proname,'static_weekly_v10_');
 additions:=additions||E'\n'||$rows$
 ('relation','public.static_weekly_staffing_commands','private staffing command ledger'),
 ('relation','public.static_weekly_staffing_command_receipts','append-only staffing command receipts'),
 ('relation','public.static_weekly_staffing_staged_candidates','non-authoritative staffing candidate staging'),
 ('relation','public.static_weekly_staffing_absences','accepted person-bound absences'),
 ('relation','public.static_weekly_staffing_absence_cancellations','append-only absence cancellation lineage'),
 ('relation','public.static_weekly_schedule_application_intents','assignment-bound schedule application intents'),
 ('relation','public.static_weekly_schedule_application_receipts','device-reported schedule application evidence'),
 ('trigger','public.static_weekly_staffing_commands.trg_static_weekly_staffing_guard','typed command transitions'),
 ('trigger','public.static_weekly_staffing_command_receipts.trg_static_weekly_staffing_receipt_immutable','immutable command receipts'),
 ('trigger','public.static_weekly_staffing_staged_candidates.trg_static_weekly_staffing_stage_immutable','immutable staging'),
 ('trigger','public.static_weekly_staffing_absences.trg_static_weekly_staffing_absence_immutable','immutable absences'),
 ('trigger','public.static_weekly_staffing_absence_cancellations.trg_static_weekly_staffing_cancel_immutable','immutable cancellations'),
 ('trigger','public.static_weekly_schedule_application_intents.trg_static_weekly_schedule_intent_immutable','immutable application intents'),
 ('trigger','public.static_weekly_schedule_application_receipts.trg_static_weekly_schedule_receipt_immutable','immutable application receipts'),
$rows$;
 execute replace(definition,'  values','  values'||E'\n'||additions);
end $surface$;

alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;begin
 for obj in with relation_names(name) as (values
  ('public.static_weekly_staffing_commands'),('public.static_weekly_staffing_command_receipts'),
  ('public.static_weekly_staffing_staged_candidates'),('public.static_weekly_staffing_absences'),
  ('public.static_weekly_staffing_absence_cancellations'),('public.static_weekly_schedule_application_intents'),
  ('public.static_weekly_schedule_application_receipts')),
 funcs as (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (starts_with(p.proname,'static_weekly_v10_')
   or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)),
 objects as (
  select 1000 bucket,'relation'::text kind,name identity,public.custodial_release_authority_current_relation_definition(name) definition from relation_names
  union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid) from funcs
  union all select 200000,'column',r.name||':'||a.attname,public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
   from relation_names r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set',name,public.custodial_release_authority_current_column_set_definition(name) from relation_names
  union all select 400000,'relation_state',name,public.custodial_release_authority_current_relation_state_definition(name) from relation_names
  union all select 500000,'constraint',r.name||':'||c.conname,public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
   from relation_names r join pg_constraint c on c.conrelid=r.name::regclass
  union all select 600000,'index','public.'||quote_ident(ci.relname),public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
   from relation_names r join pg_index i on i.indrelid=r.name::regclass join pg_class ci on ci.oid=i.indexrelid
   where not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
  union all select 700000,'trigger',quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname),
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
   ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
   ||' trigger '||quote_ident(t.tgname)||';'
   from relation_names r join pg_class c on c.oid=r.name::regclass join pg_namespace n on n.oid=c.relnamespace
   join pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal
  union all select 900000,'grant',name,public.custodial_release_authority_current_grant_definition(name) from relation_names
  union all select 900000,'grant',oid::regprocedure::text,public.custodial_release_authority_current_grant_definition(oid::regprocedure::text) from funcs
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing staffing recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
  where object_kind=obj.kind and (object_identity=obj.identity or
   case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
    then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
  if not found then
   select coalesce(max(restore_order),obj.bucket)+1 into next_order
   from public.custodial_release_authority_restore_inventory
   where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
   insert into public.custodial_release_authority_restore_inventory
    (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory
 enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
