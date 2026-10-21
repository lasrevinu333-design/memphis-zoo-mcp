do $preflight$ begin
 if to_regprocedure('public.custodial_outlook_event_sync_v1(text,jsonb)') is not null
  or exists(select 1 from pg_catalog.pg_attribute where attrelid='public.events_app_events'::regclass and not attisdropped
    and attname in ('custodial_public_notes','custodial_note_codes','start_instant_utc','end_instant_utc')) then
  raise exception 'Shared Events target already exists; reconcile its exact source before applying';
 end if;
end $preflight$;

-- One event source; no new public table grants, no human-manager impersonation.
-- Existing event/history/Outlook-ledger rows and restore guards are preserved.
alter table public.events_app_events
 add column if not exists custodial_public_notes text,
 add column if not exists custodial_note_codes text[] not null default '{}',
 add column if not exists start_instant_utc timestamptz,
 add column if not exists end_instant_utc timestamptz;

create or replace function public.custodial_outlook_event_sync_v1(p_action text,p_observation jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
 v_input jsonb:=p_observation; v_source jsonb; v_record jsonb; v_before jsonb;
 v_existing public.events_app_events%rowtype; v_saved public.events_app_events%rowtype;
 v_ledger public.events_app_outlook_sync%rowtype; v_prior public.events_app_outlook_sync%rowtype;
 v_message text;v_key text;v_hash text;v_status text;v_reason text;v_event_id uuid;
 v_source_at timestamptz;v_received_at timestamptz;v_start timestamptz;v_end timestamptz;
 v_date date;v_end_date date;v_start_time time;v_end_time time;v_revision integer;
 v_request uuid:=gen_random_uuid();v_lease jsonb;v_result jsonb;v_actor constant text:='ChatGPT Outlook Sync';
 v_venue public.event_venues%rowtype;v_scope text;v_mailbox constant text:='eoperle@memphiszoo.org';
begin
 if jsonb_typeof(v_input) is distinct from 'object' or octet_length(v_input::text)>65536 then
  raise exception using errcode='22023',message='A bounded JSON observation is required';end if;
 if p_action='status' then
  select * into v_ledger from public.events_app_outlook_sync where source_event_key='custodial-outlook-events-v1/checkpoint'
   order by received_at desc,id desc limit 1;
  return jsonb_build_object('schema','custodial.outlook-event-sync.v1','writer_ready',true,'mailbox',v_mailbox,
   'cursor',v_ledger.source_payload->>'through','checkpoint_at',v_ledger.created_at,
   'last_import_at',(select max(created_at) from public.events_app_outlook_sync where source_event_key like 'custodial-outlook-events-v1/event/%' and sync_status in ('APPLIED','CANCELLED','UNCHANGED')));
 end if;
 if p_action not in ('apply','cancel','review','checkpoint') or p_action is null then
  raise exception using errcode='22023',message='Unsupported Outlook synchronization action';end if;
 -- Same existing restore lease and transaction-level admission lock as the app.
 v_lease:=public.custodial_begin_application_mutation_lease(v_request,'custodial-outlook-events-v1');
 if v_lease->'mutations_paused' is distinct from 'false'::jsonb then
  raise exception using errcode='55000',message='Event mutations are paused';end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-outlook-events-v1',0));
 if p_action='checkpoint' then
  if v_input->>'mailbox' is distinct from v_mailbox or v_input->'complete' is distinct from 'true'::jsonb
   or coalesce(v_input->>'evidence_sha256','') !~ '^[0-9a-f]{64}$' or coalesce(v_input->>'run_id','') !~ '^[0-9a-f-]{36}$'
   or coalesce(v_input->>'pages_read','') !~ '^[1-9][0-9]{0,6}$' then raise exception using errcode='22023',message='Complete authenticated source review evidence is required';end if;
  v_source_at:=(v_input->>'through')::timestamptz;v_received_at:=(v_input->>'from')::timestamptz;
  if v_source_at is null or v_received_at is null or not isfinite(v_source_at) or not isfinite(v_received_at)
   or v_source_at>clock_timestamp()+interval '1 minute' or v_received_at>v_source_at then
   raise exception using errcode='22023',message='Invalid reviewed time window';end if;
  select * into v_prior from public.events_app_outlook_sync where source_event_key='custodial-outlook-events-v1/checkpoint' order by received_at desc limit 1;
  if v_prior.id is not null and v_received_at>(v_prior.source_payload->>'through')::timestamptz then
   raise exception using errcode='22023',message='Collector window leaves a coverage gap';end if;
  v_message:='collector:'||(v_input->>'run_id');v_key:='custodial-outlook-events-v1/checkpoint';v_hash:=encode(digest(v_input::text,'sha256'),'hex');
  select * into v_ledger from public.events_app_outlook_sync where outlook_message_id=v_message and source_event_key=v_key;
  if v_ledger.id is not null and v_ledger.payload_hash is distinct from v_hash then raise exception using errcode='40901',message='Checkpoint replay conflict';end if;
  insert into public.events_app_outlook_sync(outlook_message_id,source_event_key,received_at,payload_hash,sync_status,source_payload)
   values(v_message,v_key,v_source_at,v_hash,'UNCHANGED',v_input) on conflict(outlook_message_id,source_event_key) do nothing;
  perform public.custodial_release_application_mutation_lease(v_request);
  return jsonb_build_object('state','CHECKPOINT_SAVED','through',v_source_at,'replayed',v_ledger.id is not null);
 end if;
 v_source:=v_input->'source';v_message:=v_source->>'message_id';v_key:=v_input->>'source_event_key';
 if jsonb_typeof(v_source) is distinct from 'object' or v_source->>'mailbox' is distinct from v_mailbox
  or coalesce(length(v_message),0) not between 8 and 1500 or coalesce(length(v_key),0) not between 5 and 400
  or coalesce(v_source->>'content_sha256','') !~ '^[0-9a-f]{64}$'
  or coalesce(v_source->>'evidence_kind','') not in ('original_event_notice','event_update','event_cancellation') then
  raise exception using errcode='22023',message='Verified original Outlook event source is required';end if;
 if p_action='cancel' and v_source->>'evidence_kind'<>'event_cancellation' then
  raise exception using errcode='22023',message='Ticket closure is not event cancellation';end if;
 v_source_at:=(v_source->>'source_at')::timestamptz;v_received_at:=(v_source->>'received_at')::timestamptz;
 if v_source_at is null or v_received_at is null or not isfinite(v_source_at) or not isfinite(v_received_at)
  or v_source_at>clock_timestamp()+interval '10 minutes' or v_received_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='Invalid Outlook source timestamps';end if;
 v_key:='custodial-outlook-events-v1/event/'||v_key;
 v_hash:=encode(digest(jsonb_build_object('action',p_action,'observation',v_input)::text,'sha256'),'hex');
 select * into v_ledger from public.events_app_outlook_sync where outlook_message_id=v_message and source_event_key=v_key;
 if v_ledger.id is not null then
  if v_ledger.payload_hash is distinct from v_hash then raise exception using errcode='40901',message='Source identity replay has different content';end if;
  perform public.custodial_release_application_mutation_lease(v_request);
  return jsonb_build_object('state',v_ledger.sync_status,'event_id',v_ledger.event_id,'replayed',true,'ledger_id',v_ledger.id);
 end if;
 select * into v_prior from public.events_app_outlook_sync where source_event_key=v_key and event_id is not null
  and sync_status in ('APPLIED','CANCELLED','UNCHANGED') order by (source_payload->'source'->>'source_at')::timestamptz desc,created_at desc limit 1;
 v_event_id:=coalesce(nullif(v_input->>'event_id','')::uuid,v_prior.event_id);
 if v_prior.event_id is not null and v_prior.event_id is distinct from v_event_id then
  raise exception using errcode='40901',message='Source key belongs to another event';end if;
 if v_event_id is not null then
  select * into v_existing from public.events_app_events where id=v_event_id for update;
  if v_existing.id is null then raise exception using errcode='P0002',message='Referenced event not found';end if;
 end if;
 v_before:=case when v_existing.id is not null then to_jsonb(v_existing) end;
 if p_action='review' then v_status:='NEEDS_REVIEW';v_reason:=left(coalesce(v_input->>'reason','Unresolved event facts'),1000);
 elsif v_existing.manually_overridden then v_status:='BLOCKED_MANUAL';v_reason:='Preserved owner override';
 elsif v_prior.id is not null and v_source_at<(v_prior.source_payload->'source'->>'source_at')::timestamptz then v_status:='UNCHANGED';v_reason:='Older source ignored';
 elsif v_prior.id is not null and v_source_at=(v_prior.source_payload->'source'->>'source_at')::timestamptz then v_status:='NEEDS_REVIEW';v_reason:='Conflicting equal-time source requires review';
 else
  if v_existing.id is not null then
   v_revision:=(v_input->>'expected_revision')::integer;
   if v_revision is null or v_revision is distinct from v_existing.revision then raise exception using errcode='40901',message='Event revision changed; reconcile before retry';end if;
  end if;
  if p_action='cancel' then
   if v_existing.id is null then raise exception using errcode='P0002',message='Cancellation requires an existing event';end if;
   if v_existing.status='CANCELLED' then v_saved:=v_existing;v_status:='UNCHANGED';
   else update public.events_app_events set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=v_actor,
    cancellation_reason=left(coalesce(v_input->>'reason','Authoritative Outlook cancellation'),1000),cancelled_by_manager_id=null,
    revision=coalesce(revision,1)+1,source_format='outlook_auto_sync' where id=v_event_id returning * into v_saved;
    v_status:='CANCELLED';end if;
  else
   v_record:=v_input->'event';v_scope:=v_record->>'event_scope';
   if jsonb_typeof(v_record) is distinct from 'object' or coalesce(length(btrim(v_record->>'event_name')),0) not between 1 and 180
    or v_scope not in ('ZOO_WIDE','SINGLE_VENUE','MULTI_VENUE','OFFSITE') or v_scope is null
    or coalesce(length(v_record->>'custodial_public_notes'),0)>500
    or exists(select 1 from jsonb_object_keys(v_record) k where k not in ('event_name','event_scope','primary_venue_id','venue_ids','location_group_id','display_location','event_date','end_date','start_time','end_time','start_instant_utc','end_instant_utc','attendee_count','custodial_public_notes','custodial_note_codes','coverage_location_ids')) then
    raise exception using errcode='22023',message='Invalid or unapproved event fields';end if;
   v_date:=(v_record->>'event_date')::date;v_end_date:=(v_record->>'end_date')::date;
   v_start_time:=(v_record->>'start_time')::time;v_end_time:=(v_record->>'end_time')::time;
   v_start:=(v_record->>'start_instant_utc')::timestamptz;v_end:=(v_record->>'end_instant_utc')::timestamptz;
   if v_start is null or v_end is null or v_date is null or v_end_date is null or v_start_time is null or v_end_time is null
    or not isfinite(v_start) or not isfinite(v_end) or v_end<=v_start or v_end_date<v_date or v_end_date>v_date+1
    or (v_start at time zone 'America/Chicago')::date<>v_date or (v_end at time zone 'America/Chicago')::date<>v_end_date
    or (v_start at time zone 'America/Chicago')::time<>v_start_time or (v_end at time zone 'America/Chicago')::time<>v_end_time then
    raise exception using errcode='22023',message='Explicit event dates, times and Chicago instants must agree';end if;
   if v_record->'attendee_count' is not null and v_record->'attendee_count'<>'null'::jsonb and (jsonb_typeof(v_record->'attendee_count')<>'number' or (v_record->>'attendee_count') !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='Attendance must be a nonnegative integer or null';end if;
   if jsonb_typeof(coalesce(v_record->'custodial_note_codes','[]'))<>'array' or exists(select 1 from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]')) x where x not in ('trash_boxes','extra_cans','restroom_checks')) then
    raise exception using errcode='22023',message='Unknown custodial note code';end if;
   if v_existing.id is null and exists(select 1 from public.events_app_events where lower(btrim(event_name))=lower(btrim(v_record->>'event_name')) and event_date=v_date) then
    raise exception using errcode='40901',message='Possible existing event; resolve its identity before creating another';end if;
   if v_scope in ('SINGLE_VENUE','ZOO_WIDE') then
    select * into v_venue from public.event_venues where id=nullif(v_record->>'primary_venue_id','')::uuid and active is true;
    if v_venue.id is null or (v_scope='SINGLE_VENUE' and v_venue.eligible_event_venue is not true)
     or (v_scope='ZOO_WIDE' and v_venue.venue_code<>'ZOO_FOOTPRINT') then raise exception using errcode='22023',message='Active eligible venue required';end if;
   end if;
   if v_existing.id is null then
    insert into public.events_app_events(event_name,event_scope,primary_venue_id,venue_ids,location_group_id,display_location,
     event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,attendee_count,custodial_public_notes,custodial_note_codes,
     coverage_location_ids,source_format,created_by,needs_review,manually_overridden,event_timezone,revision)
    values(btrim(v_record->>'event_name'),v_scope,nullif(v_record->>'primary_venue_id','')::uuid,
     array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]')))::uuid[],(v_record->>'location_group_id')::uuid,
     v_record->>'display_location',v_date,v_end_date,v_start_time,v_end_time,v_start,v_end,(v_record->>'attendee_count')::integer,
     v_record->>'custodial_public_notes',array(select jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'))),
     array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]')))::uuid[],
     'outlook_auto_sync',v_actor,false,false,'America/Chicago',1) returning * into v_saved;
   else
    update public.events_app_events set event_name=btrim(v_record->>'event_name'),event_scope=v_scope,
     primary_venue_id=nullif(v_record->>'primary_venue_id','')::uuid,venue_ids=array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]')))::uuid[],
     location_group_id=(v_record->>'location_group_id')::uuid,display_location=v_record->>'display_location',event_date=v_date,end_date=v_end_date,
     start_time=v_start_time,end_time=v_end_time,start_instant_utc=v_start,end_instant_utc=v_end,attendee_count=(v_record->>'attendee_count')::integer,
     custodial_public_notes=v_record->>'custodial_public_notes',custodial_note_codes=array(select jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'))),
     coverage_location_ids=array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]')))::uuid[],
     source_format='outlook_auto_sync',revision=coalesce(revision,1)+1 where id=v_event_id returning * into v_saved;
   end if;
   v_status:='APPLIED';
  end if;
  v_event_id:=v_saved.id;
  if v_status in ('APPLIED','CANCELLED') then
   insert into public.events_app_event_history(event_id,action,actor,reason,previous_record,new_record)
    values(v_event_id,case when v_before is null then 'create' when p_action='cancel' then 'cancel' else 'update' end,v_actor,
     'Original Outlook source '||v_message,v_before,to_jsonb(v_saved));
  end if;
 end if;
 insert into public.events_app_outlook_sync(outlook_message_id,source_event_key,event_id,received_at,source_subject,payload_hash,sync_status,sync_note,source_payload)
  values(v_message,v_key,v_event_id,v_received_at,left(v_source->>'subject',200),v_hash,v_status,v_reason,v_input) returning * into v_ledger;
 perform public.custodial_release_application_mutation_lease(v_request);
 return jsonb_build_object('schema','custodial.outlook-event-sync.v1','state',v_status,'event_id',v_event_id,
  'revision',coalesce(v_saved.revision,v_existing.revision),'ledger_id',v_ledger.id,'source_sha256',v_hash,'replayed',false,'reason',v_reason);
end
$function$;
revoke all on function public.custodial_outlook_event_sync_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.custodial_outlook_event_sync_v1(text,jsonb) to service_role;
