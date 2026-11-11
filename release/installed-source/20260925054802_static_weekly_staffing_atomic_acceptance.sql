begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $preflight$
begin
 if to_regclass('public.static_weekly_staffing_commands') is null
  or to_regprocedure('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)') is null
  or to_regprocedure('public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)') is null
  or to_regprocedure('public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)') is null then
  raise exception 'atomic staffing acceptance prerequisites are unavailable';
 end if;
end $preflight$;

alter table public.static_weekly_staffing_commands
 add column confirmation_key uuid,
 add column confirmed_by_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
 add column authority_command_id uuid,
 add constraint static_weekly_staffing_confirmation_complete check(
  (state='ACCEPTED' and confirmation_key is not null and confirmed_by_manager_id is not null
   and authority_command_id is not null)
  or state<>'ACCEPTED'),
 add constraint static_weekly_staffing_confirmation_key_unique unique(prepared_by_manager_id,confirmation_key),
 add constraint static_weekly_staffing_authority_command_unique unique(authority_command_id);

create or replace function public.static_weekly_v10_staffing_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if tg_op='DELETE' then raise exception 'staffing commands are durable and cannot be deleted'; end if;
 if current_setting('app.static_weekly_staffing_write',true) is distinct from 'on' then
  raise exception 'staffing command transitions require the typed authority RPC';
 end if;
 if (to_jsonb(new)-array['state','preview_digest','input_digest','candidate_set_digest','candidate_row_count',
  'candidate_bytes','publication_vector','candidate_summary','accepted_revision','accepted_receipt',
  'prepared_at','accepted_at','confirmation_key','confirmed_by_manager_id','authority_command_id']) is distinct from
  (to_jsonb(old)-array['state','preview_digest','input_digest','candidate_set_digest','candidate_row_count',
  'candidate_bytes','publication_vector','candidate_summary','accepted_revision','accepted_receipt',
  'prepared_at','accepted_at','confirmation_key','confirmed_by_manager_id','authority_command_id']) then
  raise exception 'immutable staffing command identity changed'; end if;
 if not ((old.state='PREPARING' and new.state in ('PREPARED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED'))
  or (old.state='PREPARED' and new.state in ('ACCEPTED','CANCELLED','CANCELLED_BY_SUCCESSOR','REJECTED')))
  then raise exception 'invalid staffing command state transition'; end if;
 return new;
end $function$;

alter table public.weekly_schedule_authority_revisions
 drop constraint weekly_schedule_authority_revisions_operation_check;
alter table public.weekly_schedule_authority_revisions
 add constraint weekly_schedule_authority_revisions_operation_check check(operation in (
  'create_draft','update_draft','publish','supersede','rollback','apply_exception',
  'reverse_exception','replace_incumbency','materialize_projection','mark_employee_departed',
  'replace_employee','create_vacant_slot','fill_vacant_slot','restore_existing_employee',
  'vacate_roster_slot','apply_staffing_command'));

-- Person-bound absences are independent of publication identity. Each reader
-- rehydrates the current person-to-position relationship for its service date,
-- so a later replacement can never inherit a former employee's absence.
create or replace function public.static_weekly_accepted_exception_set(
 p_publication_id uuid,p_week_start date
) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
 with accepted as (
  select e.exception_id::text id,e.exception_type type,e.service_date,
   e.payload_digest,e.authority_revision::bigint sequence
  from public.weekly_schedule_exception_commands e
  where e.publication_id=p_publication_id and e.service_date between p_week_start and p_week_start+6
   and e.exception_type<>'reverse'
   and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  union all
  select a.absence_id::text||':'||day.service_date::text,
   case when a.absence_kind='pto' then 'pto' else 'daily_absence' end,
   day.service_date,
   public.static_weekly_digest_text(format('{"slotId":"%s"}',incumbency.slot_id::text)),
   a.accepted_revision+(day.service_date-a.start_date)
  from public.static_weekly_staffing_absences a
  cross join lateral generate_series(a.start_date,a.end_date,interval '1 day') generated(raw_date)
  cross join lateral (select generated.raw_date::date service_date) day
  join lateral (
   select i.slot_id from public.v_weekly_roster_slot_incumbency_ranges i
   where i.person_id=a.employee_id and i.effective_start<=day.service_date
    and (i.effective_end is null or day.service_date<i.effective_end)
  ) incumbency on true
  where day.service_date between p_week_start and p_week_start+6
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c
    where c.absence_id=a.absence_id
     and day.service_date between c.remaining_start_date and c.remaining_end_date)
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',type,'serviceDate',service_date::text,
  'payloadDigest',payload_digest) order by service_date,sequence,id),'[]'::jsonb) from accepted
$function$;

create or replace function public.static_weekly_compiler_exception_set(
 p_publication_id uuid,p_week_start date
) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
 with accepted as (
  select e.service_date,e.authority_revision::bigint sequence,e.exception_id::text id,
   jsonb_strip_nulls(jsonb_build_object('id',e.exception_id::text,'type',e.exception_type,
    'serviceDate',e.service_date::text,'actorId',e.actor_manager_id::text,'reason',e.reason,
    'idempotencyKey',e.idempotency_key,'expectedRevision',e.expected_revision,'status','accepted',
    'window',case when e.starts_at is null then null else jsonb_build_object(
     'start',to_char(e.starts_at,'HH24:MI'),'end',to_char(e.ends_at,'HH24:MI')) end,
    'payload',e.payload_json,'payloadDigest',e.payload_digest,'baseVersionId',e.base_version_id::text,
    'publicationId',e.publication_id::text,'sequence',e.authority_revision)) value
  from public.weekly_schedule_exception_commands e
  where e.publication_id=p_publication_id and e.service_date between p_week_start and p_week_start+6
   and e.exception_type<>'reverse'
   and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  union all
  select day.service_date,a.accepted_revision+(day.service_date-a.start_date),
   a.absence_id::text||':'||day.service_date::text,
   jsonb_build_object('id',a.absence_id::text||':'||day.service_date::text,
    'type',case when a.absence_kind='pto' then 'pto' else 'daily_absence' end,
    'serviceDate',day.service_date::text,'staffingAbsenceId',a.absence_id::text,
    'staffingAbsenceKind',a.absence_kind,'actorId',a.accepted_by_manager_id::text,
    'reason','Approved staffing unavailability',
    'idempotencyKey','staffing:'||a.absence_id::text||':'||day.service_date::text,
    'expectedRevision',command.expected_revision,'status','accepted',
    'payload',jsonb_build_object('slotId',incumbency.slot_id::text),
    'baseVersionId',publication.version_id::text,'publicationId',p_publication_id::text,
    'sequence',a.accepted_revision+(day.service_date-a.start_date))
  from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands command on command.operation_id=a.accepted_operation_id
  join public.weekly_schedule_publications publication on publication.publication_id=p_publication_id
  cross join lateral generate_series(a.start_date,a.end_date,interval '1 day') generated(raw_date)
  cross join lateral (select generated.raw_date::date service_date) day
  join lateral (
   select i.slot_id from public.v_weekly_roster_slot_incumbency_ranges i
   where i.person_id=a.employee_id and i.effective_start<=day.service_date
    and (i.effective_end is null or day.service_date<i.effective_end)
  ) incumbency on true
  where day.service_date between p_week_start and p_week_start+6
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c
    where c.absence_id=a.absence_id
     and day.service_date between c.remaining_start_date and c.remaining_end_date)
 )
 select coalesce(jsonb_agg(value order by service_date,sequence,id),'[]'::jsonb) from accepted
$function$;

create or replace function public.static_weekly_v11_staged_projection_digest_matches(
 p_operation_id uuid,p_content_digest text,p_manager_id uuid
) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare candidate record;signed_envelope jsonb;expected_digest text;matches integer:=0;
begin
 for candidate in select payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=p_operation_id and candidate_kind='projection' loop
  if candidate.payload_json->>'actorManagerId' is distinct from p_manager_id::text then continue;end if;
  signed_envelope:=jsonb_set(candidate.payload_json->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(candidate.payload_json->'envelope')),true);
  expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
   'publication_id',(candidate.payload_json->>'publicationId')::uuid,
   'week_start',(candidate.payload_json->>'serviceDate')::date,
   'exception_set_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
    (candidate.payload_json->>'publicationId')::uuid,(candidate.payload_json->>'serviceDate')::date)),
   'compiler_version',candidate.payload_json->>'compilerVersion','objective',candidate.payload_json->'objective',
   'metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
   'projection_envelope_identity',signed_envelope->>'database_projection_identity',
   'attestation',signed_envelope->'attestation'));
  if expected_digest=p_content_digest then matches:=matches+1;end if;
 end loop;
 return matches=1;
exception when others then return false;
end $function$;

create or replace function public.static_weekly_v11_read_current_refresh_targets(
 p_start_date date,p_end_date date,p_manager_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare targets jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 if p_start_date is null or p_end_date is null or p_start_date>p_end_date or p_end_date-p_start_date>=366 then
  raise exception using errcode='22023',message='invalid staffing refresh target window';end if;
 with dates as (select day::date service_date from generate_series(p_start_date,p_end_date,interval '1 day') day),
 authority as (
  select dates.service_date,state.projection_id from dates
  cross join lateral public.static_weekly_v6_schedule_authority_state(dates.service_date) state
  where state.projection_status='current' and state.projection_id is not null
 ),target as (
  select authority.service_date,assignment->>'owner_person_id' employee_id
  from authority join public.weekly_schedule_compiled_projections projection on projection.projection_id=authority.projection_id
  cross join lateral jsonb_array_elements(coalesce(projection.projection_envelope->'assignments','[]'::jsonb)) assignment
  where assignment->>'service_date'=authority.service_date::text and lower(assignment->>'status')='assigned'
   and assignment->>'owner_person_id'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union
  select authority.service_date,responsibility->>'normal_owner_person_id'
  from authority join public.weekly_schedule_lunch_documents lunch on lunch.projection_id=authority.projection_id
  cross join lateral jsonb_array_elements(coalesce(lunch.document_json->'responsibilities','[]'::jsonb)) responsibility
  where responsibility->>'service_date'=authority.service_date::text
   and responsibility->>'normal_owner_person_id'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union
  select authority.service_date,responsibility->>'coverer_person_id'
  from authority join public.weekly_schedule_lunch_documents lunch on lunch.projection_id=authority.projection_id
  cross join lateral jsonb_array_elements(coalesce(lunch.document_json->'responsibilities','[]'::jsonb)) responsibility
  where responsibility->>'service_date'=authority.service_date::text
   and responsibility->>'coverer_person_id'~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ) select coalesce(jsonb_agg(jsonb_build_object('serviceDate',service_date::text,'employeeId',employee_id)
   order by service_date,employee_id),'[]'::jsonb) into targets from target;
 return targets;
end $function$;

revoke all on function public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)
 to static_weekly_control_plane;
comment on function public.static_weekly_v11_read_current_refresh_targets(date,date,uuid) is
 'Authenticated control-plane read of every employee owning current normal or lunch work in a bounded staffing window.';

-- The mature materializer remains the sole projection writer. During this
-- exact transaction only, it may reuse the one already-created staffing
-- revision, and only for a content digest found in the locked staged set.
create or replace function public.static_weekly_advance_authority(
 p_expected_revision bigint,p_operation text,p_actor_manager_id uuid,
 p_actor_manager_name text,p_command_id uuid,p_digest text
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_revision bigint;v_batch text;v_operation uuid;command public.static_weekly_staffing_commands%rowtype;
begin
 v_batch:=nullif(current_setting('app.static_weekly_staffing_batch_operation',true),'');
 if v_batch is not null then
  if p_operation<>'materialize_projection' then raise exception 'staffing batch context is projection-only';end if;
  begin v_operation:=v_batch::uuid;exception when invalid_text_representation then raise exception 'invalid staffing batch context';end;
  select * into command from public.static_weekly_staffing_commands where operation_id=v_operation for share;
  select current_revision into v_revision from public.static_weekly_schedule_control where singleton for share;
  if not found or command.state<>'PREPARED' or command.prepared_by_manager_id is distinct from p_actor_manager_id
   or command.expected_revision is distinct from p_expected_revision or v_revision<>p_expected_revision+1
   or not exists(select 1 from public.weekly_schedule_authority_revisions r
    where r.authority_revision=v_revision and r.command_id=command.operation_id
     and r.operation='apply_staffing_command' and r.actor_manager_id=p_actor_manager_id)
   or not public.static_weekly_v11_staged_projection_digest_matches(v_operation,p_digest,p_actor_manager_id) then
   raise exception using errcode='42501',message='staffing batch projection is not the exact staged authority';
  end if;
  return v_revision;
 end if;
 update public.static_weekly_schedule_control set current_revision=current_revision+1,
  updated_at=statement_timestamp(),updated_by_manager_id=p_actor_manager_id,
  updated_by_manager_name_snapshot=p_actor_manager_name
 where singleton and current_revision=p_expected_revision returning current_revision into v_revision;
 if v_revision is null then raise exception using errcode='40001',message='stale expected revision';end if;
 insert into public.weekly_schedule_authority_revisions(authority_revision,command_id,operation,
  actor_manager_id,actor_manager_name_snapshot,content_digest)
 values(v_revision,p_command_id,p_operation,p_actor_manager_id,p_actor_manager_name,p_digest);
 return v_revision;
end $function$;

create or replace function public.static_weekly_v11_accept_staffing_command(
 p_operation_id uuid,p_preview_digest text,p_confirmation_key uuid,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
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
 if not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' then
  select * into target_absence from public.static_weekly_staffing_absences a
   where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
    and command.start_date between a.start_date and a.end_date and command.end_date=a.end_date
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
   where lower(assignment->>'status')='assigned' and assignment->>'service_date' between command.start_date::text and command.end_date::text
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
end $function$;

revoke all on function public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid),
 public.static_weekly_v11_read_current_refresh_targets(date,date,uuid),
 public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)
 from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v11_read_current_refresh_targets(date,date,uuid),
 public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)
 to static_weekly_control_plane;

comment on function public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid) is
 'One locked/CAS staffing confirmation: person-bound fact, complete multiweek projections, lunch companions, exact device intents, one revision and one durable receipt, all-or-none.';

create or replace function public.static_weekly_v10_read_staffing_delivery_status(
 p_operation_id uuid,p_manager_id uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare command public.static_weekly_staffing_commands%rowtype;targets jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(item order by item->>'service_date',item->>'employee_id',coalesce(item->>'device_id','')),'[]'::jsonb)
 into targets from (
  select jsonb_build_object(
   'intent_id',i.intent_id,'service_date',i.service_date,'employee_id',i.employee_id,'device_id',i.device_id,
   'credential_id',i.credential_id,'assignment_epoch',i.assignment_epoch,'authority_revision',i.authority_revision,
   'projection_id',i.projection_id,'lunch_document_identity',i.lunch_document_identity,
   'status',case when r.receipt_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
   'rendered_digest',r.rendered_digest,'applied_at',r.applied_at,'received_at',r.received_at) item
  from public.static_weekly_schedule_application_intents i
  left join public.static_weekly_schedule_application_receipts r on r.intent_id=i.intent_id
  where i.operation_id=p_operation_id
  union all
  select missing||jsonb_build_object('intent_id',null,'device_id',null,'credential_id',null,
   'assignment_epoch',null,'authority_revision',command.accepted_revision,'projection_id',null,
   'lunch_document_identity',null,'rendered_digest',null,'applied_at',null,'received_at',null)
  from jsonb_array_elements(coalesce(command.accepted_receipt->'missing_device_targets','[]'::jsonb)) missing
 ) status_rows;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
  'authority_revision',command.accepted_revision,'targets',targets);
end $function$;

revoke all on function public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)
 from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)
 to static_weekly_control_plane;

comment on function public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid) is
 'Manager readback distinguishes exact device receipt, pending current-device intent, and no-current-device targets recorded by accepted staffing authority.';

do $surface$ declare definition text;begin
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 if (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 then
  raise exception 'staffing acceptance canary seam missing';end if;
 execute replace(definition,'  values','  values'||E'\n'||
  ' (''function'',''static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)'',''atomic staffing acceptance''),'||E'\n'||
  ' (''function'',''static_weekly_v11_read_current_refresh_targets(date,date,uuid)'',''current normal and lunch refresh ownership''),'||E'\n'||
  ' (''function'',''static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)'',''private exact staged projection binding''),');
end $surface$;

alter table public.custodial_release_authority_restore_inventory
 disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare obj record;next_order integer;begin
 for obj in with required_public_functions(identity,oid) as (values
   ('public.custodial_oc24_service_trim(text)','public.custodial_oc24_service_trim(text)'::regprocedure),
   ('public.custodial_oc24_assert_completion_selection(jsonb)','public.custodial_oc24_assert_completion_selection(jsonb)'::regprocedure),
   ('public.custodial_oc24_completion_selection_guard()','public.custodial_oc24_completion_selection_guard()'::regprocedure),
   ('public.custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text)','public.custodial_oc24_legacy_replay_allowed(text,text,text,text,text,text,text,jsonb,jsonb,text)'::regprocedure),
   ('public.custodial_oc24_inspection_recording_retired()','public.custodial_oc24_inspection_recording_retired()'::regprocedure),
   ('public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)','public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)'::regprocedure)
 ), objects as (
  select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid in(
   'public.static_weekly_v10_staffing_guard()'::regprocedure,
   'public.static_weekly_accepted_exception_set(uuid,date)'::regprocedure,
   'public.static_weekly_compiler_exception_set(uuid,date)'::regprocedure,
   'public.static_weekly_advance_authority(bigint,text,uuid,text,uuid,text)'::regprocedure,
   'public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)'::regprocedure,
   'public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)'::regprocedure,
   'public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)'::regprocedure,
   'public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure,
   'public.custodial_release_canary_authority_surface()'::regprocedure)
  union all select 100000,'function',f.identity,pg_get_functiondef(f.oid)
   from required_public_functions f
  -- These relations and triggers were extended by later members of the same
  -- still-unapplied 22-migration release. Capture their final definitions only
  -- after every extension has been installed.
  union all select 1000,'relation',r.identity,
   public.custodial_release_authority_current_relation_definition(r.identity)
   from (values('public.device_notification_acknowledgements'),('public.static_weekly_staffing_commands')) r(identity)
  union all select 200000,'column','public.static_weekly_staffing_commands:'||a.attname,
   public.custodial_release_authority_current_column_definition('public.static_weekly_staffing_commands:'||a.attname)
   from pg_attribute a where a.attrelid='public.static_weekly_staffing_commands'::regclass and a.attnum>0 and not a.attisdropped
  union all select 300000,'column_set','public.static_weekly_staffing_commands',
   public.custodial_release_authority_current_column_set_definition('public.static_weekly_staffing_commands')
  union all select 400000,'relation_state','public.static_weekly_staffing_commands',
   public.custodial_release_authority_current_relation_state_definition('public.static_weekly_staffing_commands')
  union all select 500000,'constraint','public.static_weekly_staffing_commands:'||c.conname,
   public.custodial_release_authority_current_constraint_definition('public.static_weekly_staffing_commands:'||c.conname)
   from pg_constraint c where c.conrelid='public.static_weekly_staffing_commands'::regclass
  union all select 500000,'constraint','public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check',
   public.custodial_release_authority_current_constraint_definition('public.weekly_schedule_authority_revisions:weekly_schedule_authority_revisions_operation_check')
  union all select 700000,'trigger','public.static_weekly_staffing_commands.'||t.tgname,
   'drop trigger if exists '||quote_ident(t.tgname)||' on public.static_weekly_staffing_commands; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table public.static_weekly_staffing_commands '
   ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
   ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t where t.tgrelid='public.static_weekly_staffing_commands'::regclass and not t.tgisinternal
  union all select 700000,'trigger',wanted.identity,
   'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; '
   ||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '
   ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
   ||' trigger '||quote_ident(t.tgname)||';'
   from pg_trigger t
   join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   join (values
    ('public.weekly_schedule_lunch_documents.custodial_disaster_restore_mutation_fence'),
    ('public.weekly_schedule_lunch_documents.trg_weekly_schedule_lunch_documents_immutable'),
    ('public.weekly_roster_slot_incumbency_closures.trg_static_weekly_v8_guard_vacancy_closure')
   ) wanted(identity) on wanted.identity=quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'.'||quote_ident(t.tgname)
   where not t.tgisinternal
  union all select 900000,'grant',p.oid::regprocedure::text,
   public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.oid in(
   'public.static_weekly_v11_staged_projection_digest_matches(uuid,text,uuid)'::regprocedure,
    'public.static_weekly_v11_read_current_refresh_targets(date,date,uuid)'::regprocedure,
    'public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)'::regprocedure,
    'public.static_weekly_v10_read_staffing_delivery_status(uuid,uuid)'::regprocedure)
 ) select * from objects order by bucket,identity loop
  if obj.definition is null then raise exception 'missing staffing acceptance recovery object %',obj.identity;end if;
  update public.custodial_release_authority_restore_inventory set object_identity=obj.identity,definition_sql=obj.definition,
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
