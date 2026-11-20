-- Main normal CLI 2.109.1 generated 20261012023928; isolated source proposal.
-- Exact committed B6f9559a1954fe84e42b47198743c164375ef0209 / 261-file efbfb694 prefix.
-- Cancel the ORIGINAL accepted private fact; recompile and accept CURRENT
-- plan through the unchanged typed staged/CAS/digest/materializer path.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE original_cancel_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE original_cancel_specs(
 ordinal integer PRIMARY KEY,identity text NOT NULL,source_sha256 text NOT NULL,
 source_bytes integer NOT NULL,prior_grant_members integer NOT NULL,new_body text NOT NULL
) ON COMMIT DROP;
INSERT INTO original_cancel_specs VALUES
 (1,'public.static_weekly_v10_begin_staffing_command(jsonb,uuid,bigint,uuid)','c1708a801e85cf9688c4f37fc59c2cfa696a43296b6261d9445922c87844e80b',4819,0,$target_1$
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
 if v_command_kind='absence' and not exists(select 1 from public.employees where id=v_employee and active=true) then
  raise exception using errcode='23514',message='staffing command employee is not currently active';
 end if;
 if v_command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text where a.absence_id=v_target_absence
   and a.employee_id=v_employee and v_start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and v_start_date<=a.end_date and v_end_date=a.end_date
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
end $target_1$),
 (2,'public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)','5f918fd1251995ea93fb0d5daa3162ae354545223b5e9519f735795760cf139d',9264,0,$target_2$
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
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='staffing cancellation cannot rewrite an elapsed service date during preparation';end if;
 if command.command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text where a.absence_id=command.target_absence_id
   and a.employee_id=command.employee_id and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date
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
end $target_2$),
 (3,'public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)','e35ddb45380f899b36b3c8ed38c44d38dda32b277eca34809ce39add2f47e0cd',21294,0,$target_3$
declare actor jsonb;command public.static_weekly_staffing_commands%rowtype;target_absence public.static_weekly_staffing_absences%rowtype;
 v_candidates jsonb;v_count integer;v_bytes bigint;v_current_revision bigint;v_revision bigint;
 v_content_digest text;v_projection_candidate record;v_lunch jsonb;v_payload jsonb;v_projection_response jsonb;
 v_projection uuid;v_existing public.weekly_schedule_compiled_projections%rowtype;v_existing_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_signed_envelope jsonb;v_request jsonb;v_request_digest text;v_projection_content_digest text;v_projection_receipt jsonb;
 v_projection_map jsonb:='{}'::jsonb;v_refresh record;v_mapping jsonb;v_intent_count integer:=0;
 v_missing_device jsonb:='[]'::jsonb;v_prior_refresh jsonb:='[]'::jsonb;v_receipt jsonb;v_receipt_digest text;v_reused boolean;v_command_id uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.state='ACCEPTED' then
  if command.prepared_by_manager_id is distinct from p_manager_id
   or command.confirmation_key is distinct from p_confirmation_key
   or command.preview_digest is distinct from p_preview_digest then
   raise exception using errcode='23505',message='accepted staffing command was replayed with different confirmation identity';end if;
  return command.accepted_receipt||jsonb_build_object('replayed',true);
 end if;
 if command.state<>'PREPARED' then raise exception using errcode='55000',message='staffing command is not prepared for acceptance';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may confirm this command';end if;
 if p_confirmation_key is null or p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or command.preview_digest is distinct from p_preview_digest then
  raise exception using errcode='22023',message='exact staffing preview and confirmation key are required';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  perform set_config('app.static_weekly_staffing_write','on',true);
  update public.static_weekly_staffing_commands set state='REJECTED' where operation_id=command.operation_id;
  v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','REJECTED',
   'reason','ELAPSED_CANCELLATION','manager_id',p_manager_id,'semantic_digest',command.semantic_digest,
   'preview_digest',command.preview_digest,'recorded_at',statement_timestamp());
  insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
   semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'REJECTED',p_manager_id,
   command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
  return jsonb_build_object('operation_id',command.operation_id,'state','REJECTED',
   'reason','ELAPSED_CANCELLATION','replayed',false);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('candidateKey',candidate_key,'candidateKind',candidate_kind,
  'payload',payload_json,'serviceDate',service_date::text)
  order by service_date,candidate_kind collate "C",candidate_key collate "C"),'[]'::jsonb),
  count(*),coalesce(sum(canonical_bytes),0) into v_candidates,v_count,v_bytes
 from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id;
 if public.static_weekly_digest_jsonb(v_candidates) is distinct from command.candidate_set_digest
  or v_count is distinct from command.candidate_row_count or v_bytes is distinct from command.candidate_bytes
  or v_count>100000 or v_bytes>16777216 then
  raise exception using errcode='23514',message='prepared staffing candidate set no longer matches its complete digest';end if;
 select current_revision into v_current_revision from public.static_weekly_schedule_control where singleton for update;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing confirmation expected revision is stale';end if;
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' then
  select * into target_absence from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
   where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
    and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date and command.end_date=a.end_date
    and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
   for share;
  if not found then raise exception using errcode='23514',message='staffing cancellation must target the exact uncancelled remaining absence window';end if;
 end if;
 if jsonb_typeof(command.publication_vector) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(command.publication_vector) key)
    is distinct from array['expectedRevision','weeks']::text[]
  or (command.publication_vector->>'expectedRevision')::bigint<>command.expected_revision
  or jsonb_typeof(command.publication_vector->'weeks') is distinct from 'array' then
  raise exception using errcode='23514',message='prepared staffing publication vector is invalid';end if;
 if exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
  where jsonb_typeof(week)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(week) key)
      is distinct from array['authorityRevision','publicationId','versionId','weekStart']::text[]
   or (week->>'authorityRevision')::bigint<>command.expected_revision
   or not exists(select 1 from public.weekly_schedule_publications p
    where p.publication_id=(week->>'publicationId')::uuid and p.version_id=(week->>'versionId')::uuid
     and public.static_weekly_effective_version((week->>'weekStart')::date)=p.version_id)) then
  raise exception using errcode='23514',message='prepared staffing publication vector became stale';end if;
 if (select count(*) from jsonb_array_elements(command.publication_vector->'weeks'))<>
    (select count(*) from public.static_weekly_staffing_staged_candidates
      where operation_id=command.operation_id and candidate_kind='projection') then
  raise exception using errcode='23514',message='prepared staffing projection vector is incomplete';end if;

 v_prior_refresh:=public.static_weekly_v11_read_current_refresh_targets(
  command.start_date,command.end_date,p_manager_id);

 v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation_id',command.operation_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'input_digest',command.input_digest,'candidate_set_digest',command.candidate_set_digest,
  'publication_vector',command.publication_vector));
 v_revision:=public.static_weekly_advance_authority(command.expected_revision,'apply_staffing_command',
  p_manager_id,actor->>'manager_name',command.operation_id,v_content_digest);
 if command.command_kind='absence' then
  insert into public.static_weekly_staffing_absences(absence_id,employee_id,absence_kind,start_date,end_date,
   accepted_operation_id,accepted_revision,accepted_by_manager_id)
  values(command.operation_id,command.employee_id,command.absence_kind,command.start_date,command.end_date,
   command.operation_id,v_revision,p_manager_id);
 else
  insert into public.static_weekly_staffing_absence_cancellations(absence_id,accepted_operation_id,
   remaining_start_date,remaining_end_date,accepted_revision,accepted_by_manager_id)
  values(command.target_absence_id,command.operation_id,command.start_date,command.end_date,v_revision,p_manager_id);
 end if;
 perform set_config('app.static_weekly_staffing_batch_operation',command.operation_id::text,true);

 for v_projection_candidate in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='projection' order by service_date,candidate_key loop
  v_payload:=v_projection_candidate.payload_json;
  if (select array_agg(key order by key) from jsonb_object_keys(v_payload) key) is distinct from
   array['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision',
    'idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate']::text[]
   or (v_payload->>'serviceDate')::date is distinct from v_projection_candidate.service_date
   or (v_payload->>'expectedRevision')::bigint is distinct from command.expected_revision
   or v_payload->>'actorManagerId' is distinct from p_manager_id::text
   or v_payload->>'idempotencyKey' is distinct from 'staffing:'||command.operation_id::text||':'||v_projection_candidate.service_date::text
   or not exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
    where week->>'weekStart'=v_projection_candidate.service_date::text
     and week->>'publicationId'=v_payload->>'publicationId'
     and week->>'versionId'=v_payload#>>'{envelope,authority,compilerInput,version,id}') then
   raise exception using errcode='23514',message='staged staffing projection identity is invalid';end if;
  if v_payload->>'exceptionSetDigest' is distinct from public.static_weekly_digest_jsonb(
    public.static_weekly_accepted_exception_set((v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
   or v_payload->>'compilerVersion' is distinct from v_payload#>>'{envelope,compiler_version}'
   or v_payload->'objective' is distinct from v_payload#>'{envelope,objective}'
   or v_payload->'metrics' is distinct from v_payload#>'{envelope,metrics}'
   or v_payload->>'replayDigest' is distinct from v_payload#>>'{envelope,replay_digest}' then
   raise exception using errcode='23514',message='staged staffing projection compiler identity no longer matches accepted exception authority',
    detail=jsonb_build_object('staged_exception_digest',v_payload->>'exceptionSetDigest',
     'database_exception_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date)),
     'staged_exceptions',v_payload#>'{envelope,applied_exceptions}',
     'database_exceptions',public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))::text;end if;
  v_signed_envelope:=jsonb_set(v_payload->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(v_payload->'envelope')),true);
  select * into v_existing from public.weekly_schedule_compiled_projections p
   where p.publication_id=(v_payload->>'publicationId')::uuid
    and p.week_start=v_projection_candidate.service_date
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
     (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
    and p.compiler_version=v_payload->>'compilerVersion'
    and p.authority_digest=v_signed_envelope->>'authority_digest'
   order by p.compiled_at desc,p.projection_id desc limit 1;
  v_reused:=found;
  if v_reused then
   if (v_existing.projection_envelope-array['attestation','receipt','database_projection_identity']) is distinct from
      (v_signed_envelope-array['attestation','receipt','database_projection_identity']) then
    raise exception using errcode='23514',message='historical projection identity conflicts with the exact staged candidate';end if;
   v_projection:=v_existing.projection_id;
   v_command_id:=gen_random_uuid();
   v_request:=jsonb_build_object('operation','materialize_projection','publication_id',(v_payload->>'publicationId')::uuid,
    'service_date',v_projection_candidate.service_date,'exception_set_digest',v_existing.exception_set_digest,
    'compiler_version',v_existing.compiler_version,'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,
    'replay_digest',v_existing.replay_digest,'projection_envelope',v_existing.projection_envelope,
    'expected_revision',command.expected_revision,'actor_manager_id',p_manager_id,'actor_manager_name',actor->>'manager_name');
   v_request_digest:=public.static_weekly_digest_jsonb(v_request);
   v_projection_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
    'exception_set_digest',v_existing.exception_set_digest,'compiler_version',v_existing.compiler_version,
    'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,'replay_digest',v_existing.replay_digest,
    'projection_envelope_identity',v_existing.projection_envelope->>'database_projection_identity',
    'attestation',v_existing.projection_envelope->'attestation'));
   v_projection_receipt:=public.static_weekly_response_json('materialize_projection',v_revision,
    v_projection_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,
     'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
     'week_end',v_existing.week_end,'replay_digest',v_existing.replay_digest));
   insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,
    command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
   values(v_command_id,p_manager_id,actor->>'manager_name','materialize_projection',v_payload->>'idempotencyKey',
    command.expected_revision,v_request_digest,v_request,v_projection_receipt,v_projection_receipt->>'output_digest',v_projection_content_digest);
  else
   v_projection_response:=public.static_weekly_v3_materialize_projection(
    (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',
    v_payload->>'compilerVersion',v_payload->'objective',v_payload->'metrics',v_payload->>'replayDigest',
    v_payload->'envelope',command.expected_revision,p_manager_id,v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  end if;
  select payload_json into strict v_lunch from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='lunch'
    and service_date=v_projection_candidate.service_date;
  perform public.static_weekly_v8_materialize_lunch_document(v_projection,v_lunch,p_manager_id);
  select * into strict v_existing_lunch from public.weekly_schedule_lunch_documents where projection_id=v_projection;
  v_projection_map:=v_projection_map||jsonb_build_object(v_projection_candidate.service_date::text,
   jsonb_build_object('projection_id',v_projection,'publication_id',(v_payload->>'publicationId')::uuid,
    'projection_identity',v_payload#>>'{envelope,database_projection_identity}',
    'lunch_document_identity',v_existing_lunch.document_identity,'reused',v_reused));
 end loop;

 if exists(
 with projection as (select service_date week_start,payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='projection'),
  lunch as (select payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='lunch'),
  expected as (
   select distinct assignment->>'service_date' service_date,assignment->>'owner_person_id' employee_id
   from projection cross join lateral jsonb_array_elements(payload_json#>'{envelope,assignments}') assignment
   where lower(assignment->>'status')='assigned' and assignment->>'owner_person_id' is not null
    and assignment->>'service_date' between command.start_date::text and command.end_date::text
   union select responsibility->>'service_date',responsibility->>'normal_owner_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'normal_owner_person_id' is not null
   union select responsibility->>'service_date',responsibility->>'coverer_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'coverer_person_id' is not null
   union select item->>'serviceDate',item->>'employeeId' from jsonb_array_elements(v_prior_refresh) item
   union select (day::date)::text,command.employee_id::text from generate_series(command.start_date,command.end_date,interval '1 day') day
    where command.command_kind='absence'
  ),actual as (select service_date::text,payload_json->>'employeeId' employee_id
   from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id and candidate_kind='schedule_refresh')
  (select * from expected except select * from actual) union all (select * from actual except select * from expected)
 ) then raise exception using errcode='23514',message='affected employee schedule refresh set is incomplete or excessive';end if;

 for v_refresh in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='schedule_refresh' order by service_date,candidate_key loop
  v_mapping:=v_projection_map->(v_refresh.payload_json->>'weekStart');
  if (select array_agg(key order by key) from jsonb_object_keys(v_refresh.payload_json) key) is distinct from
   array['employeeId','lunchDocumentIdentity','projectionIdentity','publicationId','weekStart']::text[]
   or v_mapping is null or v_refresh.payload_json->>'publicationId' is distinct from v_mapping->>'publication_id'
   or v_refresh.payload_json->>'projectionIdentity' is distinct from v_mapping->>'projection_identity'
   or v_refresh.payload_json->>'lunchDocumentIdentity' is distinct from v_mapping->>'lunch_document_identity'
   or v_refresh.service_date not between command.start_date and command.end_date then
   raise exception using errcode='23514',message='schedule refresh is not bound to the exact accepted projection and lunch';end if;
  insert into public.static_weekly_schedule_application_intents(operation_id,service_date,employee_id,
   device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity)
  select command.operation_id,v_refresh.service_date,(v_refresh.payload_json->>'employeeId')::uuid,
   d.id,c.credential_id,d.assignment_epoch,v_revision,(v_mapping->>'publication_id')::uuid,
   (v_mapping->>'projection_id')::uuid,v_mapping->>'lunch_document_identity'
  from public.devices d join public.device_auth_credentials c on c.device_id=d.id
   and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp()
  where d.active=true and d.assigned_employee_id=(v_refresh.payload_json->>'employeeId')::uuid;
  get diagnostics v_count=row_count;v_intent_count:=v_intent_count+v_count;
  if v_count=0 then v_missing_device:=v_missing_device||jsonb_build_array(jsonb_build_object(
   'service_date',v_refresh.service_date,'employee_id',v_refresh.payload_json->>'employeeId','status','NO_CURRENT_DEVICE'));end if;
 end loop;

 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','ACCEPTED',
  'manager_id',p_manager_id,'original_preparer_manager_id',command.prepared_by_manager_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'candidate_set_digest',command.candidate_set_digest,'authority_revision',v_revision,
  'projections',v_projection_map,'device_intent_count',v_intent_count,
  'missing_device_targets',v_missing_device,'recorded_at',statement_timestamp());
 v_receipt_digest:=public.static_weekly_digest_jsonb(v_receipt);
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='ACCEPTED',confirmation_key=p_confirmation_key,
  confirmed_by_manager_id=p_manager_id,authority_command_id=command.operation_id,accepted_revision=v_revision,
  accepted_receipt=v_receipt,accepted_at=statement_timestamp() where operation_id=command.operation_id;
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'ACCEPTED',p_manager_id,
  command.semantic_digest,v_receipt,v_receipt_digest);
 return v_receipt||jsonb_build_object('replayed',false);
end $target_3$),
 (4,'public.static_weekly_v10_read_staffing_command(uuid,uuid)','e9bafce769907ce4a98028d3a7102a0e9907ca7993044a3f121f9073ab058456',15012,1,$target_4$
declare command public.static_weekly_staffing_commands%rowtype;
 original_target jsonb:=null;target_revision bigint;
 preview_weeks jsonb:='[]'::jsonb; prepared_week jsonb; projection record;
 envelope jsonb; availability jsonb; safe_availability jsonb; a jsonb;
 safe_row jsonb; field text; value jsonb; windows jsonb; w jsonb;
 safe_objective jsonb; safe_metrics jsonb; daily jsonb; day_row jsonb;
 loads jsonb; load_row jsonb; safe_load jsonb; safe_day jsonb; weekly jsonb;
 map_value jsonb; pair record; raw_metrics jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null; end if;
 -- Cancellation refers to an immutable original absence, not today's incumbent.
 -- Only the authenticated current pending command may expose this private target.
 if command.command_kind='cancel_absence' and command.state in ('PREPARING','PREPARED') then
  if command.prepared_by_manager_id is distinct from p_manager_id then
   raise exception using errcode='42501',message='only original authenticated preparer may read cancellation target';end if;
  select control.current_revision into strict target_revision from public.static_weekly_schedule_control control where control.singleton;
  if command.expected_revision is distinct from target_revision then
   raise exception using errcode='40001',message='original cancellation target revision is stale';end if;
  if command.semantic_digest is distinct from public.static_weekly_digest_jsonb(command.semantic_body)
   or command.semantic_body is distinct from jsonb_build_object('absenceKind',null,'commandKind','cancel_absence',
    'employeeId',command.employee_id::text,'endDate',command.end_date::text,'startDate',command.start_date::text,
    'targetAbsenceId',command.target_absence_id::text) then
   raise exception using errcode='23514',message='original cancellation command identity is inconsistent';end if;
  select jsonb_build_object('absenceId',a.absence_id::text,'employeeId',a.employee_id::text,
   'startDate',a.start_date::text,'endDate',a.end_date::text,'acceptedOperationId',a.accepted_operation_id::text,
   'status','accepted') into original_target
  from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
  where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
   and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp()))
   and command.start_date<=a.end_date and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id);
  if not found then raise exception using errcode='23514',message='original accepted cancellation target is unavailable or inconsistent';end if;
 end if;
 -- Only this command's immutable PREPARED candidates may supply these facts.
 -- PREPARING/terminal states retain the original null preview behavior.
 if command.state='PREPARED' then
  if (select count(*) from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='projection')>54 then
   raise exception using errcode='54000',message='prepared preview week bound exceeded';end if;
  for projection in
   select p.*,l.payload_json as lunch_payload
   from public.static_weekly_staffing_staged_candidates p
   left join public.static_weekly_staffing_staged_candidates l
    on l.operation_id=p.operation_id and l.candidate_kind='lunch' and l.service_date=p.service_date
   where p.operation_id=command.operation_id and p.candidate_kind='projection'
   order by p.service_date
  loop
   if projection.payload_digest is distinct from public.static_weekly_digest_jsonb(projection.payload_json) then
    raise exception using errcode='23514',message='prepared preview staged projection digest changed';end if;
   envelope:=projection.payload_json->'envelope';
   availability:=envelope#>'{authority,projectionAvailability}';
   safe_availability:=null;
   if jsonb_typeof(availability)='array' then
    if jsonb_array_length(availability)>1792 then
     raise exception using errcode='54000',message='prepared preview availability bound exceeded';end if;
    safe_availability:='[]'::jsonb;
    for a in select item from jsonb_array_elements(availability) item loop
     if jsonb_typeof(a) is distinct from 'object' then
      raise exception using errcode='23514',message='prepared preview availability row is not an object';end if;
     safe_row:='{}'::jsonb;
     foreach field in array array['serviceDate','slotId','status','incumbentSlotId','incumbentSlotLabel',
      'incumbentPersonId','incumbentName','ownerKind','capacityId','acceptedRouteAnchorLocationId',
      'acceptedRouteStartLocationId','routeAnchorLocationId'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='string'
       and length(a->>field)<=300 then value else null end);
     end loop;
     foreach field in array array['dayOfWeek','productiveCapacityMinutes','maxServiceEffortMinutes',
      'maxLoadPoints','maxDutyMinutes'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
     end loop;
     foreach field in array array['shift','lunch'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='object'
       then jsonb_build_object('start',case when jsonb_typeof(value->'start')='string' and length(value->>'start')<=5 then value->'start' else null end,
        'end',case when jsonb_typeof(value->'end')='string' and length(value->>'end')<=5 then value->'end' else null end) else null end);
     end loop;
     foreach field in array array['blockedWindows','productiveWindows'] loop
      value:=a->field;windows:=null;
      if jsonb_typeof(value)='array' then
       if jsonb_array_length(value)>256 then raise exception using errcode='54000',message='prepared preview window bound exceeded';end if;
       windows:='[]'::jsonb;
       for w in select item from jsonb_array_elements(value) item loop
        if jsonb_typeof(w) is distinct from 'object' then raise exception using errcode='23514',message='prepared preview window is not an object';end if;
        windows:=windows||jsonb_build_array(jsonb_build_object(
         'start',case when jsonb_typeof(w->'start')='string' and length(w->>'start')<=5 then w->'start' else null end,
         'end',case when jsonb_typeof(w->'end')='string' and length(w->>'end')<=5 then w->'end' else null end));
       end loop;
      end if;
      safe_row:=safe_row||jsonb_build_object(field,windows);
     end loop;
     -- Hash arbitrary provenance instead of leaking leave/restriction notes.
     foreach field in array array['productiveCapacityProvenance','capacityProvenance','acceptedRouteProvenance'] loop
      safe_row:=safe_row||jsonb_build_object(field||'Digest',case when a ? field and a->field<>'null'::jsonb
       then public.static_weekly_digest_jsonb(a->field) else null end);
     end loop;
     safe_row:=safe_row||jsonb_build_object('acceptedRoute',case when jsonb_typeof(a->'acceptedRoute')='object'
      then jsonb_build_object('startLocationId',case when jsonb_typeof(a#>'{acceptedRoute,startLocationId}')='string'
       and length(a#>>'{acceptedRoute,startLocationId}')<=300 then a#>'{acceptedRoute,startLocationId}' else null end) else null end);
     safe_row:=safe_row||jsonb_build_object('acceptedRouteDigest',case when jsonb_typeof(a->'acceptedRoute')='object'
      then public.static_weekly_digest_jsonb(a->'acceptedRoute') else null end);
     safe_availability:=safe_availability||jsonb_build_array(safe_row);
    end loop;
   end if;
   -- Safe fields only: never return optimizer certificates, witnesses, raw
   -- compiler slots/exceptions/proximity matrices or preflight source data.
   safe_objective:=null;
   if jsonb_typeof(envelope->'objective')='object' then
    safe_objective:='{}'::jsonb;
    foreach field in array array['mode','policyVersion','integerServiceEffort','serviceEffortWireSemantics',
     'directedTravelDuty','flexibleCoverageTravelRole','acceptedRouteInsertions','weeklyEquityResource',
     'equityIntegerScale','exactEquityCommonDenominator'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value) in ('number','boolean') or (jsonb_typeof(value)='string'
      and length(envelope->'objective'->>field)<=2000) then safe_objective:=safe_objective||jsonb_build_object(field,value);end if;
    end loop;
    foreach field in array array['tiers','rankingOrder'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value)='array' then
      if jsonb_array_length(value)>4096 or exists(select 1 from jsonb_array_elements(value) x
       where jsonb_typeof(x)<>'string' or length(x#>>'{}')>300) then
       raise exception using errcode='54000',message='prepared preview objective text bound exceeded';end if;
      safe_objective:=safe_objective||jsonb_build_object(field,value);
     end if;
    end loop;
   end if;
   raw_metrics:=envelope->'metrics';safe_metrics:=null;
   if jsonb_typeof(raw_metrics)='object' then
    safe_metrics:='{}'::jsonb;map_value:='{}'::jsonb;
    foreach field in array array['workload','service','travel','waiting','protected','totalDuty'] loop
     value:=raw_metrics->'dutySemantics'->field;
     if jsonb_typeof(value)='string' and length(raw_metrics->'dutySemantics'->>field)<=2000 then
      map_value:=map_value||jsonb_build_object(field,value);end if;
    end loop;
    safe_metrics:=safe_metrics||jsonb_build_object('dutySemantics',case when jsonb_typeof(raw_metrics->'dutySemantics')='object' then map_value else null end);
    daily:=null;
    if jsonb_typeof(raw_metrics->'daily')='array' then
     if jsonb_array_length(raw_metrics->'daily')>7 then raise exception using errcode='54000',message='prepared preview metric day bound exceeded';end if;
     daily:='[]'::jsonb;
     for day_row in select item from jsonb_array_elements(raw_metrics->'daily') item loop
      safe_day:='{}'::jsonb;
      foreach field in array array['dayOfWeek','normalizedInequity','exactNormalizedInequity'] loop
       value:=day_row->field;
       safe_day:=safe_day||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
      end loop;
      loads:=null;
      if jsonb_typeof(day_row->'loads')='array' then
       if jsonb_array_length(day_row->'loads')>256 then raise exception using errcode='54000',message='prepared preview metric slot bound exceeded';end if;
       loads:='[]'::jsonb;
       for load_row in select item from jsonb_array_elements(day_row->'loads') item loop
        safe_load:=jsonb_build_object('slotId',case when jsonb_typeof(load_row->'slotId')='string'
         and length(load_row->>'slotId')<=300 then load_row->'slotId' else null end);
        foreach field in array array['effort','capacity','utilization','normalizedLoad','serviceDutyMinutes',
         'serviceEffortMinutes','normalizedServiceLoad','maxServiceEffortMinutes',
         'fixedServiceEffortMinutes','flexibleWorkloadPoints','fixedRouteTravelMinutes','flexibleCoverageTravelMinutes',
         'travelDutyMinutes','waitingMinutes','fixedWindowWaitingMinutes','transitWaitingMinutes',
         'protectedBreakUnavailableMinutes','routeSpanMinutes','routeNodeCount','fixedRouteDutyMinutes',
         'totalDutyMinutes','dutyCapacityMinutes','productiveCapacityMinutes','acceptedRouteTravelMinutes'] loop
         value:=load_row->field;
         if jsonb_typeof(value)='number' then safe_load:=safe_load||jsonb_build_object(field,value);end if;
        end loop;
        loads:=loads||jsonb_build_array(safe_load);
       end loop;
      end if;
      daily:=daily||jsonb_build_array(safe_day||jsonb_build_object('loads',loads));
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('daily',daily);
    weekly:=null;
    if jsonb_typeof(raw_metrics->'weekly')='object' then
     weekly:='{}'::jsonb;
     foreach field in array array['normalizedInequity','incrementalDirectedRouteCost','disruption'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='number' then weekly:=weekly||jsonb_build_object(field,value);end if;
     end loop;
     value:=raw_metrics#>'{weekly,resource}';
     if jsonb_typeof(value)='string' and length(raw_metrics#>>'{weekly,resource}')<=2000 then weekly:=weekly||jsonb_build_object('resource',value);end if;
     foreach field in array array['normalizedLoads','provenancedWorkloadUnits','productiveCapacityMinutes','uncoveredByPriority'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='object' then
       if (select count(*) from jsonb_object_keys(value))>256 then raise exception using errcode='54000',message='prepared preview weekly metric bound exceeded';end if;
       map_value:='{}'::jsonb;
       for pair in select * from jsonb_each(value) loop
        if length(pair.key)<=300 and jsonb_typeof(pair.value)='number' then map_value:=map_value||jsonb_build_object(pair.key,pair.value);end if;
       end loop;
       weekly:=weekly||jsonb_build_object(field,map_value);
      end if;
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('weekly',weekly);
   end if;
   prepared_week:=jsonb_build_object(
    'week_start',projection.service_date::text,
    'assignments',coalesce(projection.payload_json#>'{envelope,assignments}','[]'::jsonb),
    'lunch_responsibilities',coalesce(projection.lunch_payload->'responsibilities','[]'::jsonb),
    'lunch_loans',coalesce(projection.lunch_payload->'loans','[]'::jsonb),
    'publicationId',case when jsonb_typeof(projection.payload_json->'publicationId')='string'
     and length(projection.payload_json->>'publicationId')<=300 then projection.payload_json->'publicationId' else null end,
    'versionId',case when jsonb_typeof(envelope#>'{authority,compilerInput,version,id}')='string'
     and length(envelope#>>'{authority,compilerInput,version,id}')<=300 then envelope#>'{authority,compilerInput,version,id}' else null end,
    'database_projection_identity',case when jsonb_typeof(envelope->'database_projection_identity')='string'
     and envelope->>'database_projection_identity'~'^[a-f0-9]{64}$' then envelope->'database_projection_identity' else null end,
    'replayDigest',case when jsonb_typeof(envelope->'replay_digest')='string'
     and envelope->>'replay_digest'~'^[a-f0-9]{64}$' then envelope->'replay_digest' else null end,
    'compilerVersion',case when jsonb_typeof(envelope->'compiler_version')='string'
     and length(envelope->>'compiler_version')<=300 then envelope->'compiler_version' else null end,
    'objective',safe_objective,'metrics',safe_metrics,'projectionAvailability',safe_availability,
    'projectionAvailabilityDigest',case when jsonb_typeof(availability)='array' then public.static_weekly_digest_jsonb(availability) else null end,
    'projectionAvailabilityBasis','envelope.authority.projectionAvailability',
    'sourceDigest',case when jsonb_typeof(envelope#>'{authority,inputDigest}')='string'
     and envelope#>>'{authority,inputDigest}'~'^[a-f0-9]{64}$' then envelope#>'{authority,inputDigest}' else null end,
    'sourceDigestBasis','envelope.authority.inputDigest',
    'geographyDigest',case when jsonb_typeof(envelope#>'{authority,compilerInput,proximity}')='array'
     then public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput,proximity}') else null end,
    'geographyDigestBasis','envelope.authority.compilerInput.proximity');
   if octet_length(prepared_week::text)>4194304 then raise exception using errcode='54000',message='prepared preview week byte bound exceeded';end if;
   preview_weeks:=preview_weeks||jsonb_build_array(prepared_week);
   if octet_length(preview_weeks::text)>16777216 then raise exception using errcode='54000',message='prepared preview total byte bound exceeded';end if;
  end loop;
 end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
  'original_cancellation_target',original_target,
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
   'weeks',preview_weeks)
   else null end);
end $target_4$),
 (5,'public.static_weekly_v3_read_manager_snapshot(date)','47cb329374e8fd436e445842da41d15758b36799332cd9d6e259e3e3e00aca6b',4362,1,$target_5$
declare
  v_snapshot jsonb;
  v_source jsonb;
  v_roster jsonb; v_terminal jsonb; v_cancel_exceptions jsonb;
  v_original_absences jsonb;v_absence record;v_target_revision bigint;v_target_count integer:=0;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_snapshot:=public.static_weekly_v3_read_manager_snapshot_staffing_base(p_week_start);
  -- Server civil date is a cancellation fence, never the selected week,
  -- client clock, physical clock qualification or acceptance permission.
  v_snapshot:=v_snapshot||jsonb_build_object('current_service_date',public.sch_service_date(statement_timestamp())::text);
  -- Independently expose original private accepted targets even when a
  -- replaced/deactivated person has NO current compiler exception/incumbency.
  -- This is not compiler input, projection enrichment or historical restore.
  select control.current_revision into strict v_target_revision from public.static_weekly_schedule_control control where control.singleton;
  if v_snapshot->>'authority_revision' is distinct from v_target_revision::text then
    raise exception using errcode='40001',message='original absence target snapshot revision is stale';end if;
  v_original_absences:='[]'::jsonb;
  for v_absence in
    select a.*,acceptedcmd.operation_id is not null as valid_original_target
    from public.static_weekly_staffing_absences a
    left join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
    where a.start_date<=p_week_start+6
     and a.end_date>=greatest(p_week_start,public.sch_service_date(statement_timestamp()))
     and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
    order by a.start_date,a.absence_id
  loop
    if not v_absence.valid_original_target then
      raise exception using errcode='23514',message='snapshot original accepted absence identity is inconsistent';end if;
    v_target_count:=v_target_count+1;
    if v_target_count>100000 then raise exception using errcode='54000',message='canonical original absence target row bound exceeded';end if;
    v_original_absences:=v_original_absences||jsonb_build_array(jsonb_build_object(
      'staffingAbsenceId',v_absence.absence_id::text,'staffingEmployeeId',v_absence.employee_id::text,
      'staffingStartDate',v_absence.start_date::text,'staffingEndDate',v_absence.end_date::text,
      'staffingAcceptedOperationId',v_absence.accepted_operation_id::text,'status','accepted',
      'absenceKind',v_absence.absence_kind::text,'actorId',v_absence.accepted_by_manager_id::text,
      'sourceKind','canonical_staffing_absence'));
    if octet_length(v_original_absences::text)>16777216 then
      raise exception using errcode='54000',message='canonical original absence target byte bound exceeded';end if;
  end loop;
  v_snapshot:=v_snapshot||jsonb_build_object('canonical_staffing_absences',v_original_absences);
  -- Enrich ONLY rows already included by the existing canonical compiler
  -- exception-set/cancellation guard. Never reconstruct a range from a week
  -- or an employee from today's slot incumbent, and never add absent rows.
  if jsonb_typeof(v_snapshot->'exceptions')='array' then
    if jsonb_array_length(v_snapshot->'exceptions')>100000 then
      raise exception using errcode='54000',message='manager cancellation target row bound exceeded';
    end if;
    select coalesce(jsonb_agg(
      case when a.absence_id is null then e.value else e.value||jsonb_build_object(
        'staffingEmployeeId',a.employee_id::text,
        'staffingStartDate',a.start_date::text,
        'staffingEndDate',a.end_date::text,
        'staffingAcceptedOperationId',a.accepted_operation_id::text)
      end order by e.ordinal),'[]'::jsonb) into v_cancel_exceptions
    from jsonb_array_elements(v_snapshot->'exceptions') with ordinality e(value,ordinal)
    left join public.static_weekly_staffing_absences a
      on a.absence_id::text=e.value->>'staffingAbsenceId'
      and e.value->>'id'=a.absence_id::text||':'||(e.value->>'serviceDate')
      and e.value->>'serviceDate' between a.start_date::text and a.end_date::text
      and e.value->>'actorId'=a.accepted_by_manager_id::text
      and e.value->>'status'='accepted';
    if octet_length(v_cancel_exceptions::text)>16777216 then
      raise exception using errcode='54000',message='manager cancellation target byte bound exceeded';
    end if;
    v_snapshot:=jsonb_set(v_snapshot,'{exceptions}',v_cancel_exceptions,false);
  end if;


  select jsonb_agg(jsonb_build_object('invalidationId',r.invalidation_id,'publicationId',r.publication_id,
    'authorityRevision',r.authority_revision,'effectiveStart',r.effective_start,'effectiveEnd',r.effective_end,
    'state','BLOCKED_RECURRING_AUTHORITY') order by r.authority_revision,r.invalidation_id) into v_terminal
  from (select distinct i.invalidation_id,i.publication_id,i.authority_revision,i.effective_start,i.effective_end
    from generate_series(0,6) offset_day
    cross join lateral public.static_weekly_v19_current_terminal_range(p_week_start+offset_day) i
    where i.invalidation_id is not null) r;
  if v_terminal is not null then
    return v_snapshot||jsonb_build_object('projection_status','blocked_recurring_authority',
      'latest_projection',null,'assignments','[]'::jsonb,'recurring_invalidations',v_terminal,
      'recurring_repair_required',true);
  end if;
 

  -- A draft or publication already binds its own immutable compiler input.
  if jsonb_typeof(v_snapshot->'display_version')='object' then
    return v_snapshot;
  end if;

  begin
    select s.canonical_source into strict v_source
    from public.static_weekly_authority_source_documents s
    where s.active=true;
  exception
    when no_data_found then
      raise exception using errcode='23514',message='initial manager snapshot requires one active registered recurring source';
    when too_many_rows then
      raise exception using errcode='23514',message='initial manager snapshot requires exactly one active registered recurring source';
  end;

  if jsonb_typeof(v_source->'slots')<>'array' then
    raise exception using errcode='23514',message='active registered recurring source has no canonical slot array';
  end if;

  select coalesce(jsonb_agg(
    item||jsonb_build_object(
      'contractor_capacity',coalesce((
        select lower(slot->>'contractorCapacity')='true'
        from jsonb_array_elements(v_source->'slots') slot
        where slot->>'id'=item->>'slot_id'
        limit 1
      ),false)
    ) order by item->>'slot_label',item->>'slot_id'
  ),'[]'::jsonb) into v_roster
  from jsonb_array_elements(coalesce(v_snapshot->'roster','[]'::jsonb)) item;

  return jsonb_set(v_snapshot,'{roster}',v_roster,true);
end
$target_5$);
CREATE TEMP TABLE original_cancel_functions_before ON COMMIT DROP AS
 SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.provolatile,p.proparallel,p.prosecdef,p.prosrc,
 pg_get_functiondef(p.oid) definition
 FROM pg_proc p WHERE p.oid IN(
  SELECT identity::regprocedure::oid FROM original_cancel_specs
  UNION ALL SELECT 'public.custodial_release_canary_authority_surface()'::regprocedure::oid);
DO $source$
DECLARE spec record;old record;target regprocedure;expected text;
BEGIN
 IF EXISTS(SELECT 1 FROM original_cancel_inventory_before
    WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Original cancellation immutable recovery predecessor changed';END IF;
 FOR spec IN SELECT * FROM original_cancel_specs ORDER BY ordinal LOOP
  target:=spec.identity::regprocedure;
  SELECT * INTO STRICT old FROM original_cancel_functions_before WHERE oid=target;
  IF public.static_weekly_digest_text(old.prosrc) IS DISTINCT FROM spec.source_sha256
   OR octet_length(convert_to(old.prosrc,'UTF8'))<>spec.source_bytes
   OR (length(old.definition)-length(replace(old.definition,old.prosrc,'')))/length(old.prosrc)<>1
   OR (SELECT count(*) FROM original_cancel_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
     AND to_regprocedure(object_identity)=target AND definition_sql=old.definition
     AND definition_sha256=public.static_weekly_digest_text(old.definition))<>1
   OR (SELECT count(*) FROM original_cancel_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
     AND to_regprocedure(object_identity)=target)<>1
   OR (SELECT count(*) FROM original_cancel_inventory_before WHERE object_kind='grant' AND object_identity LIKE '%(%'
     AND to_regprocedure(object_identity)=target
     AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity))<>1
   OR (SELECT count(*) FROM original_cancel_inventory_before WHERE object_kind='grant' AND object_identity LIKE '%(%'
     AND to_regprocedure(object_identity)=target)<>1
   OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
     AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>1
   OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
     AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>spec.prior_grant_members
   OR NOT has_function_privilege('static_weekly_control_plane',target,'EXECUTE')
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']) role_name
     WHERE has_function_privilege(role_name,target,'EXECUTE'))
  THEN RAISE EXCEPTION 'Original cancellation exact source/ACL/canary predecessor changed: %',spec.identity;END IF;
  expected:=replace(old.definition,old.prosrc,spec.new_body);
  EXECUTE expected;
  IF pg_get_functiondef(target) IS DISTINCT FROM expected
   OR (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM spec.new_body
   OR (SELECT ROW(proowner,proacl,proconfig,provolatile,proparallel,prosecdef) FROM pg_proc WHERE oid=target)
     IS DISTINCT FROM ROW(old.proowner,old.proacl,old.proconfig,old.provolatile,old.proparallel,old.prosecdef)
  THEN RAISE EXCEPTION 'Original cancellation source/attributes/owner/ACL changed outside exact body';END IF;
 END LOOP;
END $source$;

-- The three legacy writers already have one source function member but ZERO
-- grant members. Register ONLY those exact saved ACL identities; no live
-- catalog capture, grants, new roles, table access or blanket allowed counts.
DO $canary$
DECLARE before text;expected text;additions text:='';identity text;spec record;target regprocedure;
BEGIN
 SELECT definition INTO STRICT before FROM original_cancel_functions_before
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
 IF (SELECT count(*) FROM original_cancel_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
    AND definition_sql=before AND definition_sha256=public.static_weekly_digest_text(before))<>1
  OR (length(before)-length(replace(before,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'Original cancellation exact source canary VALUES predecessor changed';END IF;
 FOR spec IN SELECT * FROM original_cancel_specs WHERE prior_grant_members=0 ORDER BY ordinal LOOP
  target:=spec.identity::regprocedure;
  SELECT object_identity INTO STRICT identity FROM original_cancel_inventory_before WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target;
  additions:=additions||E'\n'||format('(''grant'',%L,''exact existing CP-only original cancellation writer ACL''),',identity);
 END LOOP;
 expected:=replace(before,'  values','  values'||additions);
 EXECUTE expected;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM expected
  OR (SELECT ROW(proowner,proacl,proconfig,provolatile,proparallel,prosecdef) FROM pg_proc
    WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT ROW(proowner,proacl,proconfig,provolatile,proparallel,prosecdef)
    FROM original_cancel_functions_before WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
 THEN RAISE EXCEPTION 'Original cancellation canary source/owner/ACL scope changed';END IF;
END $canary$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$
DECLARE old record;changed integer;
BEGIN
 FOR old IN SELECT * FROM original_cancel_functions_before LOOP
  UPDATE public.custodial_release_authority_restore_inventory i
   SET definition_sql=pg_get_functiondef(old.oid),definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(old.oid)),
    captured_at=statement_timestamp()
   WHERE object_kind='function' AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=old.oid
    AND definition_sql=old.definition
    AND inventory_id IN(SELECT inventory_id FROM original_cancel_inventory_before WHERE definition_sql=old.definition);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Original cancellation exact recovery function row missing or duplicated';END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$
DECLARE spec record;target regprocedure;
BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM original_cancel_inventory_before)
  OR EXISTS(SELECT old.* FROM original_cancel_inventory_before old WHERE NOT(old.object_kind='function'
    AND old.object_identity LIKE '%(%' AND to_regprocedure(old.object_identity) IN(SELECT oid FROM original_cancel_functions_before))
    EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(now.object_kind='function'
    AND now.object_identity LIKE '%(%' AND to_regprocedure(now.object_identity) IN(SELECT oid FROM original_cancel_functions_before))
    EXCEPT SELECT * FROM original_cancel_inventory_before)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Original cancellation unrelated inventory/final ALWAYS scope changed';END IF;
 FOR spec IN SELECT * FROM original_cancel_specs LOOP
  target:=spec.identity::regprocedure;
  IF (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>1
   OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>1
   OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE object_kind='grant'
    AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
    AND definition_sql IS DISTINCT FROM public.custodial_release_authority_current_grant_definition(object_identity))
  THEN RAISE EXCEPTION 'Original cancellation exact function/grant final scope changed';END IF;
 END LOOP;
END $scope$;
COMMIT;
