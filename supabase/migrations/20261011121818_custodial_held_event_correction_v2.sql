-- Unapplied, owner-confirmed held-event correction. No original-mail replay.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE held_correction_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE held_correction_surface_before ON COMMIT DROP AS
 SELECT proacl acl,proowner owner,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $held_predecessor$ DECLARE body text;BEGIN
 SELECT definition INTO STRICT body FROM held_correction_surface_before;
 IF (SELECT count(*) FROM held_correction_inventory_before)<>6970
  OR EXISTS(SELECT 1 FROM held_correction_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1
  OR NOT EXISTS(SELECT 1 FROM held_correction_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure AND definition_sql=body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('public.custodial_held_event_previews_v2') IS NOT NULL
 THEN RAISE EXCEPTION 'Held correction source254 recovery predecessor changed'; END IF;
END $held_predecessor$;

-- Main owns migration/recovery registration, normal named-manager mount,
-- restricted service client, SQL qualification, and activation decision.
-- Requires pinned events_app_events/history/outlook_sync/event_venues schema,
-- ops_manager_managers/trusted_devices, mutation lease, pgcrypto digest.
-- Existing source_payload and payload_hash remain immutable original evidence.

create table public.custodial_held_event_previews_v2 (
  preview_id uuid primary key default gen_random_uuid(),
  preview_sha256 text not null check (preview_sha256 ~ '^[a-f0-9]{64}$'),
  ledger_id uuid not null references public.events_app_outlook_sync(id) on delete restrict,
  ui_review_snapshot_sha256 text not null check (ui_review_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  db_review_snapshot_sha256 text not null check (db_review_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_provenance_digest text not null check (source_provenance_digest ~ '^[a-f0-9]{64}$'),
  original_payload_sha256 text not null check (original_payload_sha256 ~ '^[a-f0-9]{64}$'),
  original_message_id text not null,
  original_event_key text not null,
  original_received_at timestamptz not null,
  original_subject text,
  original_sync_note text,
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  venue_id uuid not null references public.event_venues(id) on delete restrict,
  venue_fingerprint text not null check (venue_fingerprint ~ '^[a-f0-9]{64}$'),
  normalized_event jsonb not null check (jsonb_typeof(normalized_event) = 'object'),
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete restrict,
  device_id text not null,
  session_fingerprint text not null check (session_fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'PREVIEW_ONLY' check (state in ('PREVIEW_ONLY','APPLIED')),
  event_id uuid references public.events_app_events(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '5 minutes'),
  applied_at timestamptz,
  constraint held_preview_state_event_pair check (
    (state = 'PREVIEW_ONLY' and event_id is null and applied_at is null)
    or (state = 'APPLIED' and event_id is not null and applied_at is not null))
);
create index custodial_held_event_previews_v2_ledger_idx
  on public.custodial_held_event_previews_v2(ledger_id, created_at desc);
alter table public.custodial_held_event_previews_v2 enable row level security;
alter table public.custodial_held_event_previews_v2 force row level security;
revoke all on table public.custodial_held_event_previews_v2 from public, anon, authenticated;
grant select, insert, update on table public.custodial_held_event_previews_v2 to service_role;
create policy held_event_previews_service_v2 on public.custodial_held_event_previews_v2
  for all to service_role using (true) with check (true);

-- Both RPCs are SECURITY INVOKER, service_role-only. The database validates
-- manager/device state again, but the server's normal signed-token/current
-- trusted-device middleware remains mandatory before and after each await.
-- The caller must never expose service_role to a browser or accept an
-- arbitrary SQL/client callback from a request.
create function public.custodial_held_event_preview_v2(
  p_ledger_id uuid, p_expected_review_snapshot_sha256 text,
  p_source_provenance_digest text, p_manager_id uuid,
  p_credential_id uuid, p_device_id text, p_session_fingerprint text,
  p_event_name text, p_start_at timestamptz, p_end_at timestamptz,
  p_venue_ref uuid, p_manager_fact_confirmation text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, extensions
as $fn$
declare
  v_ledger public.events_app_outlook_sync%rowtype;
  v_venue public.event_venues%rowtype;
  v_preview uuid := gen_random_uuid();
  v_db_snapshot text; v_payload_sha text; v_venue_sha text; v_preview_sha text;
  v_event jsonb; v_source jsonb;
begin
  if p_expected_review_snapshot_sha256 is null or p_expected_review_snapshot_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_provenance_digest is null or p_source_provenance_digest !~ '^[a-f0-9]{64}$'
     or p_session_fingerprint is null or p_session_fingerprint !~ '^[a-f0-9]{64}$'
     or p_manager_fact_confirmation is distinct from 'MANAGER_CONFIRMED_MISSING_ORIGINAL_FACTS'
     or p_manager_id is null or p_credential_id is null or p_device_id is null or length(p_device_id) not between 1 and 96
     or p_event_name is null or length(btrim(p_event_name)) not between 1 and 180
     or p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
     or p_end_at <= p_start_at or p_venue_ref is null then
    raise exception using errcode='22023',message='Closed manager correction preview required';
  end if;
  perform 1 from public.ops_manager_managers m
    join public.ops_manager_trusted_devices d on d.manager_id=m.manager_id
    where m.manager_id=p_manager_id and m.active and m.revoked_at is null
      and not m.is_system_principal
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
      and d.credential_id=p_credential_id and d.device_id=p_device_id
      and d.revoked_at is null and d.expires_at>clock_timestamp()
      and d.max_access_level='full_access' for share of m,d;
  if not found then raise exception using errcode='42501',message='Current named manager required'; end if;
  select * into v_ledger from public.events_app_outlook_sync where id=p_ledger_id;
  if v_ledger.id is null or v_ledger.sync_status<>'NEEDS_REVIEW' or v_ledger.event_id is not null
     or v_ledger.payload_hash is distinct from p_source_provenance_digest
     or v_ledger.source_event_key not like 'custodial-outlook-events-v1/event/%' then
    raise exception using errcode='40901',message='Held original changed'; end if;
  v_source := v_ledger.source_payload->'source';
  if jsonb_typeof(v_ledger.source_payload) is distinct from 'object'
     or (v_ledger.source_payload - 'source' - 'source_event_key' - 'reason') <> '{}'::jsonb
     or jsonb_typeof(v_source) is distinct from 'object'
     or v_source->>'evidence_kind' is distinct from 'original_event_notice'
     or v_source->>'mailbox' is distinct from 'eoperle@memphiszoo.org'
     or v_source->>'message_id' is distinct from v_ledger.outlook_message_id
     or v_ledger.source_event_key is distinct from
        'custodial-outlook-events-v1/event/' || (v_ledger.source_payload->>'source_event_key')
     or v_source->>'received_at' is null
     or (v_source->>'received_at')::timestamptz is distinct from v_ledger.received_at
     or encode(digest(jsonb_build_object('action','review','observation',v_ledger.source_payload)::text,'sha256'),'hex')
        is distinct from v_ledger.payload_hash then
    raise exception using errcode='40901',message='Original source provenance unavailable'; end if;
  v_payload_sha := encode(digest(v_ledger.source_payload::text,'sha256'),'hex');
  select encode(digest(coalesce(jsonb_agg(jsonb_build_array(id,event_id,received_at,payload_hash,sync_status,
    source_event_key,source_payload)
    order by id),'[]'::jsonb)::text,'sha256'),'hex') into v_db_snapshot
    from public.events_app_outlook_sync where source_event_key like 'custodial-outlook-events-v1/event/%'
      and sync_status='NEEDS_REVIEW';
  select * into v_venue from public.event_venues where id=p_venue_ref;
  if v_venue.id is null or not v_venue.active or not v_venue.eligible_event_venue
     or v_venue.location_group_id is null
     or v_venue.event_scope not in ('SINGLE_VENUE','ZOO_WIDE') then
    raise exception using errcode='40901',message='Eligible venue changed'; end if;
  v_venue_sha := encode(digest(jsonb_build_array(v_venue.id,v_venue.display_name,v_venue.location_group_id,
    v_venue.event_scope,v_venue.active,v_venue.eligible_event_venue,v_venue.updated_at)::text,'sha256'),'hex');
  if exists (select 1 from public.events_app_events e where lower(btrim(e.event_name))=lower(btrim(p_event_name))
    and e.event_date=(p_start_at at time zone 'America/Chicago')::date)
     or exists (select 1 from public.events_app_outlook_sync l where l.source_event_key=v_ledger.source_event_key
       and l.id<>v_ledger.id and l.event_id is not null) then
    raise exception using errcode='40901',message='Possible existing event requires identity review'; end if;
  v_event := jsonb_build_object('event_name',btrim(p_event_name),
    'event_date',(p_start_at at time zone 'America/Chicago')::date,
    'start_time',(p_start_at at time zone 'America/Chicago')::time(0),
    'start_instant_utc',p_start_at,'end_date',(p_end_at at time zone 'America/Chicago')::date,
    'end_time',(p_end_at at time zone 'America/Chicago')::time(0),
    'end_instant_utc',p_end_at,'primary_venue_id',v_venue.id,
    'display_location',v_venue.display_name);
  v_preview_sha := encode(digest(jsonb_build_object('preview_id',v_preview,'ledger_id',p_ledger_id,
    'ui_snapshot',p_expected_review_snapshot_sha256,'db_snapshot',v_db_snapshot,
    'original_hash',v_ledger.payload_hash,'original_payload_sha256',v_payload_sha,
    'original_message',v_ledger.outlook_message_id,'original_event_key',v_ledger.source_event_key,
    'original_received_at',v_ledger.received_at,'original_subject',v_ledger.source_subject,
    'original_sync_note',v_ledger.sync_note,'original_created_at',v_ledger.created_at,
    'original_updated_at',v_ledger.updated_at,'venue_fingerprint',v_venue_sha,
    'manager_id',p_manager_id,'credential_id',p_credential_id,'device_id',p_device_id,
    'session_fingerprint',p_session_fingerprint,'normalized_event',v_event)::text,'sha256'),'hex');
  insert into public.custodial_held_event_previews_v2(preview_id,preview_sha256,ledger_id,
    ui_review_snapshot_sha256,db_review_snapshot_sha256,source_provenance_digest,
    original_payload_sha256,original_message_id,original_event_key,original_received_at,
    original_subject,original_sync_note,original_created_at,original_updated_at,
    venue_id,venue_fingerprint,normalized_event,manager_id,credential_id,device_id,session_fingerprint)
  values (v_preview,v_preview_sha,p_ledger_id,p_expected_review_snapshot_sha256,v_db_snapshot,
    v_ledger.payload_hash,v_payload_sha,v_ledger.outlook_message_id,v_ledger.source_event_key,
    v_ledger.received_at,v_ledger.source_subject,v_ledger.sync_note,v_ledger.created_at,v_ledger.updated_at,
    v_venue.id,v_venue_sha,v_event,p_manager_id,p_credential_id,p_device_id,p_session_fingerprint);
  return jsonb_build_object('schema','custodial.held-event-correction-preview.v2',
    'state','PREVIEW_ONLY','preview_id',v_preview,'preview_sha256',v_preview_sha,
    'ledger_id',p_ledger_id,'expected_review_snapshot_sha256',p_expected_review_snapshot_sha256,
    'source_provenance_digest',v_ledger.payload_hash,'venue_fingerprint',v_venue_sha,
    'source_evidence_status','ORIGINAL_FACTS_INCOMPLETE',
    'missing_original_fields',jsonb_build_array('event_name','start_at'),
    'fact_basis',jsonb_build_object('event_name','MANAGER_CONFIRMED','start_at','MANAGER_CONFIRMED',
      'end_at','MANAGER_CONFIRMED','venue_ref','MANAGER_CONFIRMED'),
    'normalized_event',v_event,'published',false,'coverage_assigned',false,'reminder_eligible',false);
end $fn$;
revoke all on function public.custodial_held_event_preview_v2(uuid,text,text,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid,text)
  from public,anon,authenticated;
grant execute on function public.custodial_held_event_preview_v2(uuid,text,text,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid,text)
  to service_role;

create function public.custodial_held_event_confirm_v2(
  p_preview_id uuid, p_preview_sha256 text, p_manager_id uuid,
  p_credential_id uuid, p_device_id text, p_session_fingerprint text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, extensions
as $fn$
declare
  v_preview public.custodial_held_event_previews_v2%rowtype;
  v_ledger public.events_app_outlook_sync%rowtype;
  v_venue public.event_venues%rowtype;
  v_saved public.events_app_events%rowtype;
  v_db_snapshot text; v_venue_sha text; v_calculated_sha text;
  v_lease jsonb; v_request uuid:=gen_random_uuid();
  v_start timestamptz; v_end timestamptz; v_manager_name text;
begin
  if p_preview_id is null or p_preview_sha256 is null or p_preview_sha256 !~ '^[a-f0-9]{64}$'
    or p_manager_id is null or p_credential_id is null or p_device_id is null
    or p_session_fingerprint is null or p_session_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='Exact held preview confirmation required'; end if;
  v_lease:=public.custodial_begin_application_mutation_lease(v_request,'custodial-held-event-correction-v2');
  if v_lease->'mutations_paused' is distinct from 'false'::jsonb then
    raise exception using errcode='55000',message='Event mutations are paused'; end if;
  -- Same lock used by custodial_outlook_event_sync_v1; no changed-source replay.
  perform pg_advisory_xact_lock(hashtextextended('custodial-outlook-events-v1',0));
  select * into v_preview from public.custodial_held_event_previews_v2
    where preview_id=p_preview_id for update;
  if v_preview.preview_id is null or v_preview.state<>'PREVIEW_ONLY'
    or v_preview.expires_at<=clock_timestamp() or v_preview.preview_sha256<>p_preview_sha256
    or v_preview.manager_id<>p_manager_id or v_preview.credential_id<>p_credential_id
    or v_preview.device_id<>p_device_id or v_preview.session_fingerprint<>p_session_fingerprint then
    raise exception using errcode='40901',message='Held preview expired, consumed, or changed'; end if;
  v_calculated_sha := encode(digest(jsonb_build_object('preview_id',v_preview.preview_id,
    'ledger_id',v_preview.ledger_id,'ui_snapshot',v_preview.ui_review_snapshot_sha256,
    'db_snapshot',v_preview.db_review_snapshot_sha256,
    'original_hash',v_preview.source_provenance_digest,
    'original_payload_sha256',v_preview.original_payload_sha256,
    'original_message',v_preview.original_message_id,
    'original_event_key',v_preview.original_event_key,
    'original_received_at',v_preview.original_received_at,
    'original_subject',v_preview.original_subject,
    'original_sync_note',v_preview.original_sync_note,
    'original_created_at',v_preview.original_created_at,
    'original_updated_at',v_preview.original_updated_at,
    'venue_fingerprint',v_preview.venue_fingerprint,
    'manager_id',v_preview.manager_id,'credential_id',v_preview.credential_id,
    'device_id',v_preview.device_id,'session_fingerprint',v_preview.session_fingerprint,
    'normalized_event',v_preview.normalized_event)::text,'sha256'),'hex');
  if v_calculated_sha is distinct from v_preview.preview_sha256 then
    raise exception using errcode='40901',message='Held preview content changed'; end if;
  perform 1 from public.ops_manager_managers m
    join public.ops_manager_trusted_devices d on d.manager_id=m.manager_id
    where m.manager_id=p_manager_id and m.active and m.revoked_at is null
      and not m.is_system_principal
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
      and d.credential_id=p_credential_id and d.device_id=p_device_id
      and d.revoked_at is null and d.expires_at>clock_timestamp()
      and d.max_access_level='full_access' for share of m,d;
  if not found then raise exception using errcode='42501',message='Current named manager required'; end if;
  select * into v_ledger from public.events_app_outlook_sync where id=v_preview.ledger_id for update;
  if v_ledger.id is null or v_ledger.event_id is not null or v_ledger.sync_status<>'NEEDS_REVIEW'
    or v_ledger.payload_hash<>v_preview.source_provenance_digest
    or v_ledger.outlook_message_id<>v_preview.original_message_id
    or v_ledger.source_event_key<>v_preview.original_event_key
    or v_ledger.received_at<>v_preview.original_received_at
    or v_ledger.source_subject is distinct from v_preview.original_subject
    or v_ledger.sync_note is distinct from v_preview.original_sync_note
    or v_ledger.created_at is distinct from v_preview.original_created_at
    or v_ledger.updated_at is distinct from v_preview.original_updated_at
    or encode(digest(v_ledger.source_payload::text,'sha256'),'hex')<>v_preview.original_payload_sha256
    or encode(digest(jsonb_build_object('action','review','observation',v_ledger.source_payload)::text,'sha256'),'hex')
      <>v_ledger.payload_hash then
    raise exception using errcode='40901',message='Original held ledger changed'; end if;
  select encode(digest(coalesce(jsonb_agg(jsonb_build_array(id,event_id,received_at,payload_hash,sync_status,
    source_event_key,source_payload)
    order by id),'[]'::jsonb)::text,'sha256'),'hex') into v_db_snapshot
    from public.events_app_outlook_sync where source_event_key like 'custodial-outlook-events-v1/event/%'
      and sync_status='NEEDS_REVIEW';
  if v_db_snapshot<>v_preview.db_review_snapshot_sha256 then
    raise exception using errcode='40901',message='Held review snapshot changed'; end if;
  select * into v_venue from public.event_venues where id=v_preview.venue_id for share;
  if v_venue.id is null or not v_venue.active or not v_venue.eligible_event_venue
    or v_venue.location_group_id is null or v_venue.event_scope not in ('SINGLE_VENUE','ZOO_WIDE') then
    raise exception using errcode='40901',message='Eligible venue changed'; end if;
  v_venue_sha := encode(digest(jsonb_build_array(v_venue.id,v_venue.display_name,v_venue.location_group_id,
    v_venue.event_scope,v_venue.active,v_venue.eligible_event_venue,v_venue.updated_at)::text,'sha256'),'hex');
  if v_venue_sha<>v_preview.venue_fingerprint then
    raise exception using errcode='40901',message='Venue fingerprint changed'; end if;
  if exists (select 1 from public.events_app_events e
    where lower(btrim(e.event_name))=lower(btrim(v_preview.normalized_event->>'event_name'))
      and e.event_date=(v_preview.normalized_event->>'event_date')::date)
    or exists (select 1 from public.events_app_outlook_sync l
      where l.source_event_key=v_ledger.source_event_key and l.id<>v_ledger.id and l.event_id is not null) then
    raise exception using errcode='40901',message='Possible existing event requires identity review'; end if;
  v_start:=(v_preview.normalized_event->>'start_instant_utc')::timestamptz;
  v_end:=(v_preview.normalized_event->>'end_instant_utc')::timestamptz;
  if v_start is null or v_end is null or v_end<=v_start
    or (v_start at time zone 'America/Chicago')::date<>(v_preview.normalized_event->>'event_date')::date
    or (v_end at time zone 'America/Chicago')::date<>(v_preview.normalized_event->>'end_date')::date
    or (v_start at time zone 'America/Chicago')::time(0)<>(v_preview.normalized_event->>'start_time')::time
    or (v_end at time zone 'America/Chicago')::time(0)<>(v_preview.normalized_event->>'end_time')::time then
    raise exception using errcode='40901',message='Normalized event changed'; end if;
  select display_name into strict v_manager_name from public.ops_manager_managers where manager_id=p_manager_id;
  if nullif(btrim(v_manager_name),'') is null then
    raise exception using errcode='42501',message='Current manager actor snapshot unavailable'; end if;
  insert into public.events_app_events(event_name,event_scope,primary_venue_id,venue_ids,
    location_group_id,display_location,event_date,end_date,start_time,end_time,
    start_instant_utc,end_instant_utc,source_format,created_by_manager_id,
    updated_by_manager_id,created_by,overridden_by,needs_review,manually_overridden,
    overridden_at,event_timezone,revision,operation_id)
  values (v_preview.normalized_event->>'event_name',v_venue.event_scope,v_venue.id,array[v_venue.id],
    v_venue.location_group_id,v_venue.display_name,(v_preview.normalized_event->>'event_date')::date,
    (v_preview.normalized_event->>'end_date')::date,(v_preview.normalized_event->>'start_time')::time,
    (v_preview.normalized_event->>'end_time')::time,v_start,v_end,
    'outlook_held_manager_correction',p_manager_id,p_manager_id,
    v_manager_name,v_manager_name,false,true,clock_timestamp(),'America/Chicago',1,p_preview_id)
  returning * into v_saved;
  insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record)
    values (v_saved.id,'create',v_manager_name,p_manager_id,
      'MANAGER_CONFIRMED_MISSING_ORIGINAL_FACTS; original ledger='||v_ledger.id::text,
      null,jsonb_build_object('event_id',v_saved.id,'revision',v_saved.revision,
        'source_provenance_digest',v_ledger.payload_hash,'preview_id',p_preview_id,
        'manager_id',p_manager_id,'credential_id',p_credential_id,
        'fact_basis',jsonb_build_object('event_name','MANAGER_CONFIRMED','start_at','MANAGER_CONFIRMED',
          'end_at','MANAGER_CONFIRMED','venue_ref','MANAGER_CONFIRMED')));
  -- Only linkage/status/note/updated_at may change. Source payload, subject,
  -- message/key, received_at and original digest stay untouched.
  update public.events_app_outlook_sync set event_id=v_saved.id,sync_status='APPLIED',
    sync_note='Manager-confirmed held event; original facts incomplete',updated_at=clock_timestamp()
    where id=v_ledger.id and event_id is null and sync_status='NEEDS_REVIEW'
      and payload_hash=v_preview.source_provenance_digest;
  if not found then raise exception using errcode='40901',message='Original held ledger changed'; end if;
  update public.custodial_held_event_previews_v2 set state='APPLIED',event_id=v_saved.id,applied_at=clock_timestamp()
    where preview_id=p_preview_id and state='PREVIEW_ONLY';
  if not found then raise exception using errcode='40901',message='Preview already consumed'; end if;
  perform public.custodial_release_application_mutation_lease(v_request);
  return jsonb_build_object('schema','custodial.held-event-correction-confirmed.v2',
    'state','APPLIED','preview_id',p_preview_id,'preview_sha256',p_preview_sha256,
    'ledger_id',v_ledger.id,'event_id',v_saved.id,'revision',v_saved.revision);
end $fn$;
revoke all on function public.custodial_held_event_confirm_v2(uuid,text,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.custodial_held_event_confirm_v2(uuid,text,uuid,uuid,text,text)
  to service_role;

-- Main-owned prerequisites before executing any derivative migration:
-- 1. Verify live schema/policy/role/lease definitions and add exact recovery
--    object inventory, registration, ACL evidence and rollback-safe tests.
-- 2. Verify service_role-only function/table grants, RLS, malformed direct RPC,
--    manager revocation, changed ledger, stale snapshot/venue, duplicate RPC,
--    partial failure rollback and lease behavior in isolated qualified SQL.
-- 3. Mount only through existing normal signed manager + trusted-device write
--    middleware and fixed TEST/prod target; no request-injected service client.
-- 4. Use a separate normally authenticated manager-feed check before claiming
--    display/publication. No automatic staffing/reminder/coverage changes.
CREATE TEMP TABLE held_correction_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_held_event_preview_v2','custodial_held_event_confirm_v2')),
 objects AS(
 SELECT 100000 bucket,0 priority,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,0,'grant','public.'||oid::regprocedure::text,public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM funcs
 UNION ALL SELECT x.bucket,x.priority,x.kind,x.identity,x.definition FROM unnest(array[
  'public.custodial_held_event_previews_v2']) rel CROSS JOIN LATERAL(
  SELECT 1000 bucket,0 priority,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
  UNION ALL SELECT 200000,0,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 300000,0,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
  UNION ALL SELECT 400000,0,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
  UNION ALL SELECT 500000,CASE WHEN contype='f' THEN 1 ELSE 0 END,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rel::regclass
  UNION ALL SELECT 600000,0,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
  UNION ALL SELECT 700000,0,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
  UNION ALL SELECT 800000,0,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rel::regclass
  UNION ALL SELECT 900000,0,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects;
DO $private_objects$ BEGIN
 IF (SELECT count(*) FROM held_correction_objects WHERE kind='function')<>2
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='relation')<>1
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='column')<>26
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='column_set')<>1
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='relation_state')<>1
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='index')<>1
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='trigger')<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger
   WHERE tgrelid='public.custodial_held_event_previews_v2'::regclass
    AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O'
    AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure)
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='policy')<>1
  OR (SELECT count(*) FROM held_correction_objects WHERE kind='grant')<>3
  OR EXISTS(SELECT 1 FROM held_correction_objects WHERE definition IS NULL)
  OR EXISTS(SELECT kind,identity FROM held_correction_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM held_correction_inventory_before old JOIN held_correction_objects x ON x.kind=old.object_kind AND x.identity=old.object_identity)
 THEN RAISE EXCEPTION USING message='Held correction recovery object declaration changed',
  detail=jsonb_build_object('counts',(SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) n FROM held_correction_objects GROUP BY kind)x),
   'undefined',(SELECT jsonb_agg(identity) FROM held_correction_objects WHERE definition IS NULL),
   'duplicates',(SELECT jsonb_agg(identity) FROM (SELECT identity FROM held_correction_objects GROUP BY kind,identity HAVING count(*)<>1)x),
   'existing',(SELECT jsonb_agg(x.identity) FROM held_correction_objects x JOIN held_correction_inventory_before i ON x.kind=i.object_kind AND x.identity=i.object_identity))::text;
 END IF;
END $private_objects$;
DO $private_surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM held_correction_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('explicit owner-confirmed held-event correction; immutable original provenance; no automatic coverage or reminders')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM held_correction_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM held_correction_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM held_correction_surface_before)
 THEN RAISE EXCEPTION 'Private custody canary owner/ACL/body changed outside exact finite extension';END IF;
END $private_surface$;
-- Same normal, exclusive-lock, exact-predecessor inventory extension used by
-- the existing source251/252 migration controls. No application guard is changed.
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM held_correction_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Private custody exact canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM held_correction_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Private custody finite recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $private_recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $private_scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM held_correction_inventory_before)+(SELECT count(*) FROM held_correction_objects)
  OR EXISTS(SELECT old.* FROM held_correction_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM held_correction_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM held_correction_inventory_before)
  OR EXISTS(SELECT 1 FROM held_correction_objects x LEFT JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Private custody unrelated recovery scope, exact new bytes or final ALWAYS inventory guard changed';END IF;
END $private_scope$;
COMMIT;


