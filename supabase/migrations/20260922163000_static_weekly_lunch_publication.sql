begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Temporary responsibility is an immutable companion of a verified projection.
-- It never updates normal ownership, cleaning history, or reminder timestamps.
create table public.weekly_schedule_lunch_documents (
 projection_id uuid primary key references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
 document_identity text not null check(document_identity ~ '^[0-9a-f]{64}$'),
 document_json jsonb not null check(jsonb_typeof(document_json)='object'),
 accepted_by_manager_id uuid not null,
 accepted_at timestamptz not null default statement_timestamp()
);
alter table public.weekly_schedule_lunch_documents enable row level security;
alter table public.weekly_schedule_lunch_documents force row level security;
revoke all on public.weekly_schedule_lunch_documents from public,anon,authenticated,service_role,static_weekly_control_plane;
create trigger trg_weekly_schedule_lunch_documents_immutable
 before update or delete on public.weekly_schedule_lunch_documents
 for each row execute function public.static_weekly_reject_update_delete();

create or replace function public.static_weekly_v8_assert_lunch_document(
 p_projection_id uuid,p_document jsonb
) returns void language plpgsql security definer
set search_path=pg_catalog,public as $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection is missing'; end if;
 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,inputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
 where value->>'status'='working' and nullif(value->>'incumbentPersonId','') is not null;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  perform public.static_weekly_assert_exact_object(loan,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'],
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time-start_time<>interval '1 hour' then raise exception 'lunch must last exactly one hour'; end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
      or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or nullif(helper->>'incumbentPersonId','') is null or helper#>>'{lunch,start}' is null
    or helper#>>'{lunch,end}' is null or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverer_slot_id','coverer_person_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}')
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations'],array['planWorkId','workId','serviceMode','window','includedLocations'],'lunch segment');
   select value into base_work from jsonb_array_elements(projection.projection_envelope->'assignments')
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or (base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id')
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   if (segment#>>'{window,start}')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (segment#>>'{window,end}')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
  end loop;
 end loop;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection.projection_envelope->'assignments') a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}') w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e;
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
end $function$;

create or replace function public.static_weekly_v8_materialize_lunch_document(
 p_projection_id uuid,p_document jsonb,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare projection public.weekly_schedule_compiled_projections%rowtype;
 existing public.weekly_schedule_lunch_documents%rowtype;current_authority record;inserted integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection does not exist'; end if;
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(projection.week_start);
 if current_authority.projection_status is distinct from 'current'
  or current_authority.projection_id is distinct from p_projection_id then raise exception 'lunch projection is not current'; end if;
 perform public.static_weekly_v8_assert_lunch_document(p_projection_id,p_document);
 insert into public.weekly_schedule_lunch_documents(projection_id,document_identity,document_json,accepted_by_manager_id)
 values(p_projection_id,p_document->>'document_identity',p_document,p_manager_id) on conflict(projection_id) do nothing;
 get diagnostics inserted=row_count;
 select * into strict existing from public.weekly_schedule_lunch_documents where projection_id=p_projection_id;
 if existing.document_json is distinct from p_document then raise exception 'immutable lunch publication conflicts with existing authority'; end if;
 return jsonb_build_object('ok',true,'persistence_status','PERSISTED','projection_id',p_projection_id,
  'document_identity',existing.document_identity,'replayed',inserted=0);
end $function$;

create or replace function public.static_weekly_v8_read_lunch_document(p_service_date date)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare current_authority record;stored public.weekly_schedule_lunch_documents%rowtype;
begin
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(p_service_date);
 if current_authority.projection_status is distinct from 'current' then
  return jsonb_build_object('persistence_status','UNAVAILABLE','projection_status',current_authority.projection_status); end if;
 select * into stored from public.weekly_schedule_lunch_documents where projection_id=current_authority.projection_id;
 if not found then return jsonb_build_object('persistence_status','MISSING','projection_id',current_authority.projection_id); end if;
 return jsonb_build_object('persistence_status','PERSISTED','projection_id',stored.projection_id,
  'document_identity',stored.document_identity,'service_date',p_service_date,
  'loans',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'loans') where value->>'service_date'=p_service_date::text),'[]'::jsonb),
  'responsibilities',coalesce((select jsonb_agg(value) from jsonb_array_elements(stored.document_json->'responsibilities') where value->>'service_date'=p_service_date::text),'[]'::jsonb));
end $function$;

revoke all on function public.static_weekly_v8_assert_lunch_document(uuid,jsonb),
 public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid),
 public.static_weekly_v8_read_lunch_document(date) from public,anon,authenticated,service_role;
grant execute on function public.static_weekly_v8_assert_lunch_document(uuid,jsonb),
 public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid) to postgres,static_weekly_control_plane;
grant execute on function public.static_weekly_v8_read_lunch_document(date) to postgres,service_role,static_weekly_control_plane,custodial_application_reader;
comment on table public.weekly_schedule_lunch_documents is
 'Immutable verified temporary lunch responsibility bound to one accepted weekly projection; normal ownership and visit clocks are unchanged.';

CREATE OR REPLACE FUNCTION public.custodial_release_canary_authority_surface()
 RETURNS TABLE(object_kind text, object_identity text, purpose text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  values
    ('relation','public.weekly_schedule_lunch_documents','accepted temporary lunch coverage'),
    ('function','static_weekly_v8_assert_lunch_document(uuid,jsonb)','lunch exact projection validation'),
    ('function','static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)','atomic lunch persistence'),
    ('function','static_weekly_v8_read_lunch_document(date)','current projection lunch reader'),
    ('relation','public.devices','phone identity and assignment'),
    ('relation','public.locations','scan location authority'),
    ('relation','public.device_auth_credentials','native credential authority'),
    ('relation','public.device_sync_status','phone queue and release readiness'),
    ('relation','public.device_location_proximity_status','current accepted proximity'),
    ('relation','public.sessions','canonical cleaning session truth'),
    ('relation','public.completion_responses','canonical completion response truth'),
    ('relation','public.scan_events','accepted scan event truth'),
    ('relation','public.maintenance_tickets','completion-derived maintenance truth'),
    ('relation','public.custodial_offline_actor_contexts','frozen offline actor and native evidence'),
    ('relation','public.custodial_offline_submission_proofs','offline submission proof state'),
    ('relation','public.custodial_offline_reconciliation_records','offline reconciliation decision'),
    ('relation','public.custodial_offline_scan_event_evidence','immutable scan evidence binding'),
    ('relation','public.custodial_release_canary_controls','exact canary pause state'),
    ('relation','public.custodial_release_canary_transport_probes','native canary transport proof'),
    ('relation','public.custodial_release_canary_recovery_probes','database canary recovery proof'),
    ('relation','public.events_app_events','canonical event mutation truth'),
    ('relation','public.events_app_event_history','event actor history'),
    ('relation','public.event_push_instances','event push occurrence authority'),
    ('relation','public.employee_push_registrations','employee push recipient authority'),
    ('relation','public.employee_native_push_delivery_receipts','employee push delivery truth'),
    ('relation','public.operational_notification_jobs','durable operational notification jobs'),
    ('relation','public.ops_manager_notification_queue','manager notification jobs'),
    ('relation','public.ops_manager_push_devices','manager push recipient authority'),
    ('relation','public.device_notification_acknowledgements','phone notification acceptance'),
    ('function','tool_get_offline_scan_authority_snapshot(text,text,text)','offline snapshot boundary'),
    ('function','tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)','native offline start boundary'),
    ('function','tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','native completion boundary'),
    ('function','tool_complete_session_authoritative(text,jsonb,text,text,text,text)','online completion boundary'),
    ('function','custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)','maintenance terminal boundary'),
    ('function','custodial_finish_historical_session_authoritative(text,text,uuid,timestamp with time zone,text)','historical exact-finish adapter'),
    ('function','custodial_record_release_canary_transport_probe(text,uuid,text,text,text,text,text,uuid,text,text,text)','native canary transport recorder'),
    ('function','custodial_get_release_canary_transport_probe_health(text,text,text,text)','native canary transport health'),
    ('function','custodial_run_release_canary_recovery_probe(text,text)','persisted recovery probe'),
    ('function','custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)','release canary controller'),
    ('function','custodial_backend_authority_health(text)','database authority health'),
    ('function','app_apply_event_command(text,uuid,jsonb,text,text)','bounded event mutation authority'),
    ('function','custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid)','serialized manager assignment CAS'),
    ('function','mz_register_employee_push(uuid,text,text,text,text,text)','employee push registration authority'),
    ('function','mz_enqueue_employee_event_pushes(timestamp with time zone)','event push enqueue authority'),
    ('function','mz_enqueue_employee_location_pushes(timestamp with time zone)','location push enqueue authority'),
    ('function','mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamp with time zone)','employee push dispatch preparation'),
    ('function','mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamp with time zone)','employee push dispatch completion'),
    ('function','ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text)','manager push dispatch preparation'),
    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion'),
    ('view','public.v_location_status','phone scan-state operational truth'),
    ('view','public.v_location_dashboard_status','manager location operational truth'),
    ('view','public.v_restroom_check_timers','restroom timer operational truth'),
    ('view','public.v_admin_health_snapshot','admin operational health truth'),
    ('view','public.v_exception_queue','manager exception operational truth'),
    ('view','public.v_restroom_package_status','restroom timer dependent projection');
$function$;

-- Capture only this migration's new objects in the existing recovery inventory.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare row record;next_order integer;changed integer;
begin
 for row in
  with relation as (select 'public.weekly_schedule_lunch_documents'::regclass oid), objects as (
   select 1000 bucket,'relation'::text kind,'public.weekly_schedule_lunch_documents'::text identity,
    public.custodial_release_authority_current_relation_definition('public.weekly_schedule_lunch_documents') definition
   union all select 100000,'function',oid::regprocedure::text,pg_get_functiondef(oid)
    from pg_proc where pronamespace='public'::regnamespace and proname in
    ('static_weekly_v8_assert_lunch_document','static_weekly_v8_materialize_lunch_document','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface')
   union all select 200000,'column','public.weekly_schedule_lunch_documents:'||attname,
    public.custodial_release_authority_current_column_definition('public.weekly_schedule_lunch_documents:'||attname)
    from pg_attribute where attrelid=(select oid from relation) and attnum>0 and not attisdropped
   union all select 300000,'column_set','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_column_set_definition('public.weekly_schedule_lunch_documents')
   union all select 400000,'relation_state','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_relation_state_definition('public.weekly_schedule_lunch_documents')
   union all select 500000,'constraint','public.weekly_schedule_lunch_documents:'||conname,
    public.custodial_release_authority_current_constraint_definition('public.weekly_schedule_lunch_documents:'||conname)
    from pg_constraint where conrelid=(select oid from relation)
   union all select 700000,'trigger','public.weekly_schedule_lunch_documents.'||tgname,
    'drop trigger if exists '||quote_ident(tgname)||' on public.weekly_schedule_lunch_documents; '||pg_get_triggerdef(oid,true)||';'
    from pg_trigger where tgrelid=(select oid from relation) and not tgisinternal
   union all select 900000,'grant','public.weekly_schedule_lunch_documents',
    public.custodial_release_authority_current_grant_definition('public.weekly_schedule_lunch_documents')
   union all select 900000,'grant',oid::regprocedure::text,
    public.custodial_release_authority_current_grant_definition(oid::regprocedure::text)
    from pg_proc where pronamespace='public'::regnamespace and proname in
    ('static_weekly_v8_assert_lunch_document','static_weekly_v8_materialize_lunch_document','static_weekly_v8_read_lunch_document','custodial_release_canary_authority_surface')
  ) select * from objects order by bucket,identity
 loop
  if row.definition is null then raise exception 'missing lunch recovery object %',row.identity; end if;
  if row.identity='public.custodial_release_canary_authority_surface()'::regprocedure::text and row.kind in ('function','grant') then
   update public.custodial_release_authority_restore_inventory
   set definition_sql=row.definition,definition_sha256=public.static_weekly_digest_text(row.definition),captured_at=statement_timestamp()
   where object_kind=row.kind and object_identity=row.identity;
   get diagnostics changed=row_count;
   if changed<>1 then raise exception 'existing canary recovery binding missing or duplicated'; end if;
   continue;
  end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory where object_kind=row.kind and object_identity=row.identity) then
   raise exception 'unexpected existing lunch recovery identity %',row.identity; end if;
  select coalesce(max(restore_order),row.bucket)+1 into next_order
   from public.custodial_release_authority_restore_inventory
   where restore_order>=row.bucket and restore_order<case when row.bucket=1000 then 100000 else row.bucket+100000 end;
  insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   values(next_order,row.kind,row.identity,row.definition,public.static_weekly_digest_text(row.definition));
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
