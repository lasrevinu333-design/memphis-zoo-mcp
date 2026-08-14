begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Native clients sign and persist these values as text. PostgreSQL's JSON
-- timestamptz rendering is session-dependent, so native-wire values use one
-- explicit UTC millisecond representation at every RPC boundary.
create or replace function public.custodial_canonical_utc_millis(p_value timestamptz)
returns text language sql immutable strict
set search_path to 'pg_catalog'
as $function$
  select to_char(date_trunc('milliseconds', p_value at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

-- Event display names remain immutable historical snapshots even if a manager
-- is later renamed or removed. UUID columns retain the accountable principal
-- while ON DELETE SET NULL deliberately leaves the snapshot text untouched.
alter table public.events_app_events
  add column created_by_manager_id uuid,
  add column updated_by_manager_id uuid,
  add column cancelled_by_manager_id uuid,
  add constraint events_app_events_created_by_manager_id_fkey foreign key(created_by_manager_id)
    references public.ops_manager_managers(manager_id) on delete set null,
  add constraint events_app_events_updated_by_manager_id_fkey foreign key(updated_by_manager_id)
    references public.ops_manager_managers(manager_id) on delete set null,
  add constraint events_app_events_cancelled_by_manager_id_fkey foreign key(cancelled_by_manager_id)
    references public.ops_manager_managers(manager_id) on delete set null,
  add constraint events_app_events_created_actor_snapshot_check
    check(created_by_manager_id is null or nullif(btrim(created_by),'') is not null),
  add constraint events_app_events_updated_actor_snapshot_check
    check(updated_by_manager_id is null or nullif(btrim(overridden_by),'') is not null),
  add constraint events_app_events_cancelled_actor_snapshot_check
    check(cancelled_by_manager_id is null or nullif(btrim(cancelled_by),'') is not null);

alter table public.events_app_event_history
  add column actor_manager_id uuid,
  add constraint events_app_event_history_actor_manager_id_fkey foreign key(actor_manager_id)
    references public.ops_manager_managers(manager_id) on delete set null,
  add constraint events_app_event_history_actor_snapshot_check
    check(actor_manager_id is null or nullif(btrim(actor),'') is not null);

comment on column public.events_app_events.created_by_manager_id is 'Authenticated manager UUID for creation; created_by is the historical display-name snapshot.';
comment on column public.events_app_events.updated_by_manager_id is 'Authenticated manager UUID for the latest update; overridden_by is the historical display-name snapshot.';
comment on column public.events_app_events.cancelled_by_manager_id is 'Authenticated manager UUID for cancellation; cancelled_by is the historical display-name snapshot.';

create or replace function public.app_apply_event_command(
  p_command text,p_event_id uuid,p_record jsonb,p_actor text default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_command text:=nullif(btrim(coalesce(p_command,'')),''); v_record jsonb:=coalesce(p_record,'{}'::jsonb);
  v_row public.events_app_events%rowtype; v_previous jsonb; v_manager public.ops_manager_managers%rowtype;
  v_actor_manager_id uuid; v_actor text; v_reason text:=left(coalesce(nullif(btrim(p_reason),''),'Event updated from Event Input Console.'),1000);
  v_now timestamptz:=statement_timestamp();
begin
  if jsonb_typeof(v_record)<>'object' then raise exception using errcode='22023',message='event command record must be an object'; end if;
  begin v_actor_manager_id:=nullif(lower(btrim(coalesce(v_record->>'actor_manager_id',''))),'')::uuid;
  exception when others then raise exception using errcode='22023',message='authenticated manager UUID is required for event mutation'; end;
  select * into v_manager from public.ops_manager_managers m
  where m.manager_id=v_actor_manager_id and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if v_manager.manager_id is null or nullif(btrim(v_manager.display_name),'') is null then
    raise exception using errcode='42501',message='an authorized active named manager principal is required for event mutation';
  end if;
  v_actor:=left(btrim(v_manager.display_name),200);
  if v_command='create' then
    insert into public.events_app_events(
      event_name,location_group_id,event_scope,primary_venue_id,venue_ids,display_location,coverage_location_ids,staffing_area_ids,
      source_location_text,parser_confidence,needs_review,parse_reason,source_text,source_format,manually_overridden,overridden_by,
      overridden_at,event_timezone,operation_id,event_date,end_date,start_time,end_time,attendee_count,notes,created_by,
      created_by_manager_id,updated_by_manager_id,updated_at
    ) values(
      v_record->>'event_name',(v_record->>'location_group_id')::uuid,v_record->>'event_scope',nullif(v_record->>'primary_venue_id','')::uuid,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),v_record->>'display_location',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      nullif(v_record->>'source_location_text',''),nullif(v_record->>'parser_confidence',''),coalesce((v_record->>'needs_review')::boolean,false),
      nullif(v_record->>'parse_reason',''),nullif(v_record->>'source_text',''),nullif(v_record->>'source_format',''),
      coalesce((v_record->>'manually_overridden')::boolean,false),case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_actor end,
      case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_now end,
      coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),nullif(v_record->>'operation_id','')::uuid,(v_record->>'event_date')::date,
      (v_record->>'end_date')::date,(v_record->>'start_time')::time,(v_record->>'end_time')::time,nullif(v_record->>'attendee_count','')::integer,
      nullif(v_record->>'notes',''),v_actor,v_actor_manager_id,
      case when coalesce((v_record->>'manually_overridden')::boolean,false) then v_actor_manager_id end,v_now
    ) on conflict(operation_id) where operation_id is not null do update set updated_at=public.events_app_events.updated_at
    returning * into v_row;
    return to_jsonb(v_row);
  elsif v_command='update' then
    select to_jsonb(e.*) into v_previous from public.events_app_events e where e.id=p_event_id for update;
    if v_previous is null then raise exception using errcode='P0002',message='event not found'; end if;
    update public.events_app_events set
      event_name=v_record->>'event_name',location_group_id=(v_record->>'location_group_id')::uuid,event_scope=v_record->>'event_scope',
      primary_venue_id=nullif(v_record->>'primary_venue_id','')::uuid,
      venue_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      display_location=v_record->>'display_location',
      coverage_location_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      staffing_area_ids=coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'staffing_area_ids','[]'::jsonb)))::uuid[],'{}'::uuid[]),
      source_location_text=nullif(v_record->>'source_location_text',''),parser_confidence=nullif(v_record->>'parser_confidence',''),
      needs_review=coalesce((v_record->>'needs_review')::boolean,false),parse_reason=nullif(v_record->>'parse_reason',''),
      source_text=nullif(v_record->>'source_text',''),source_format=nullif(v_record->>'source_format',''),manually_overridden=true,
      overridden_by=v_actor,overridden_at=v_now,updated_by_manager_id=v_actor_manager_id,
      event_timezone=coalesce(nullif(v_record->>'event_timezone',''),'America/Chicago'),event_date=(v_record->>'event_date')::date,
      end_date=(v_record->>'end_date')::date,start_time=(v_record->>'start_time')::time,end_time=(v_record->>'end_time')::time,
      attendee_count=nullif(v_record->>'attendee_count','')::integer,notes=nullif(v_record->>'notes',''),revision=coalesce(revision,1)+1,updated_at=v_now
    where id=p_event_id returning * into v_row;
    insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(v_row.id,'update',v_actor,v_actor_manager_id,v_reason,v_previous,to_jsonb(v_row),v_now);
    return to_jsonb(v_row);
  elsif v_command='cancel' then
    select to_jsonb(e.*) into v_previous from public.events_app_events e where e.id=p_event_id for update;
    if v_previous is null then raise exception using errcode='P0002',message='event not found'; end if;
    update public.events_app_events set status='CANCELLED',cancelled_at=coalesce(cancelled_at,v_now),cancelled_by=v_actor,
      cancelled_by_manager_id=v_actor_manager_id,cancellation_reason=v_reason,overridden_by=v_actor,overridden_at=v_now,
      updated_by_manager_id=v_actor_manager_id,revision=coalesce(revision,1)+1,updated_at=v_now
    where id=p_event_id returning * into v_row;
    insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(v_row.id,'cancel',v_actor,v_actor_manager_id,v_reason,v_previous,to_jsonb(v_row),v_now);
    return to_jsonb(v_row);
  end if;
  raise exception using errcode='22023',message='unsupported bounded event command';
end
$function$;

revoke all on function public.app_apply_event_command(text,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_apply_event_command(text,uuid,jsonb,text,text) to postgres,service_role;

-- The original five-argument assignment function remains the roster authority.
-- Manager routes use this overload so expected NULL is distinct from omission,
-- and the comparison executes under the same lock as the assignment mutation.
create or replace function public.custodial_assign_employee_device(
  p_device_identifier text,p_employee_id uuid,p_changed_by_manager_id uuid,p_reason text,p_move_existing boolean,
  p_expected_owner_provided boolean,p_expected_current_employee_id uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_identifier text:=upper(regexp_replace(btrim(coalesce(p_device_identifier,'')),'^KIOSK[-_ ]?','KIOSK_','i'));
  v_current_employee_id uuid;
begin
  perform public.custodial_assert_manager(p_changed_by_manager_id);
  if v_identifier ~ '^KIOSK_[2-9]$' then v_identifier:='KIOSK_0'||substring(v_identifier from 7); end if;
  if p_expected_owner_provided is null then raise exception using errcode='22023',message='expected-owner presence must be explicit'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-device-assignment:'||v_identifier,0));
  select d.assigned_employee_id into v_current_employee_id from public.devices d
  where upper(d.device_id)=v_identifier and d.active=true for update;
  if not found then raise exception using errcode='P0002',message='Active employee kiosk not found.'; end if;
  if p_expected_owner_provided and v_current_employee_id is distinct from p_expected_current_employee_id then
    raise exception using errcode='40001',message='This phone assignment changed. Refresh and try again.';
  end if;
  return public.custodial_assign_employee_device(
    v_identifier,p_employee_id,p_changed_by_manager_id,p_reason,p_move_existing
  );
end
$function$;

revoke all on function public.custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function public.custodial_assign_employee_device(text,uuid,uuid,text,boolean,boolean,uuid) to postgres,service_role;

create table public.custodial_offline_authority_activation_events (
  event_id uuid primary key default gen_random_uuid(),
  authority_kind text not null check (authority_kind in ('device','location')),
  authority_id uuid not null,
  active boolean not null,
  occurred_at timestamptz not null,
  source text not null check (length(btrim(source)) between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  unique(authority_kind, authority_id, occurred_at, active)
);

create index idx_custodial_offline_authority_activation_events_lookup
  on public.custodial_offline_authority_activation_events(authority_kind, authority_id, occurred_at desc, event_id desc);

create or replace function public.custodial_reject_offline_authority_activation_mutation()
returns trigger language plpgsql security invoker set search_path to 'pg_catalog','public'
as $function$
begin
  raise exception using errcode='55000',message='offline authority activation history is append-only';
end
$function$;

create trigger trg_custodial_offline_authority_activation_events_immutable
before update or delete on public.custodial_offline_authority_activation_events
for each row execute function public.custodial_reject_offline_authority_activation_mutation();

revoke all on table public.custodial_offline_authority_activation_events from public,anon,authenticated,service_role;

-- Existing active identities predate this ledger. The unbounded opening event
-- is deliberately immutable; later state changes append a precise boundary.
insert into public.custodial_offline_authority_activation_events(authority_kind,authority_id,active,occurred_at,source)
select 'device',d.id,true,'-infinity'::timestamptz,'u4-baseline-active-device'
from public.devices d
where d.active=true
on conflict do nothing;
insert into public.custodial_offline_authority_activation_events(authority_kind,authority_id,active,occurred_at,source)
select 'location',l.id,true,'-infinity'::timestamptz,'u4-baseline-active-location'
from public.locations l
where l.active=true
on conflict do nothing;

create or replace function public.custodial_record_offline_authority_activation_boundary()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_kind text:=case tg_table_name when 'devices' then 'device' else 'location' end;
begin
  if tg_op='INSERT' or old.active is distinct from new.active then
    insert into public.custodial_offline_authority_activation_events(authority_kind,authority_id,active,occurred_at,source)
    values(v_kind,new.id,new.active,clock_timestamp(),tg_table_schema||'.'||tg_table_name||':'||lower(tg_op));
  end if;
  return new;
end
$function$;

create trigger trg_custodial_offline_device_activation_boundary
after insert or update of active on public.devices
for each row execute function public.custodial_record_offline_authority_activation_boundary();
create trigger trg_custodial_offline_location_activation_boundary
after insert or update of active on public.locations
for each row execute function public.custodial_record_offline_authority_activation_boundary();

create or replace function public.custodial_offline_authority_active_at(
  p_authority_kind text,p_authority_id uuid,p_occurred_at timestamptz
) returns boolean language sql stable strict set search_path to 'pg_catalog','public'
as $function$
  select coalesce((
    select e.active
    from public.custodial_offline_authority_activation_events e
    where e.authority_kind=p_authority_kind and e.authority_id=p_authority_id and e.occurred_at<=p_occurred_at
    order by e.occurred_at desc,e.event_id desc
    limit 1
  ),false)
$function$;

-- The snapshot is stored as timestamptz, while the public representation and
-- signature material are canonical strings. This prevents +00:00 and variable
-- microsecond output from becoming native protocol bytes.
do $canonical_snapshot_wire_timestamps$
declare v_definition text; v_rewritten text;
begin
  v_definition:=pg_get_functiondef('public.tool_get_offline_scan_authority_snapshot(text,text,text)'::regprocedure);
  v_rewritten:=replace(v_definition,
    $old$'generated_at',v_generated_at,'expires_at',v_expires_at$old$,
    $new$'generated_at',public.custodial_canonical_utc_millis(v_generated_at),'expires_at',public.custodial_canonical_utc_millis(v_expires_at)$new$);
  v_rewritten:=replace(v_rewritten,
    $old$v_generated_at timestamptz := clock_timestamp()$old$,
    $new$v_generated_at timestamptz := date_trunc('milliseconds',clock_timestamp())$new$);
  v_rewritten:=replace(v_rewritten,
    $old$v_expires_at:=least(v_generated_at+interval '24 hours',v_credential.expires_at)$old$,
    $new$v_expires_at:=date_trunc('milliseconds',least(v_generated_at+interval '24 hours',v_credential.expires_at))$new$);
  if v_rewritten=v_definition then raise exception 'offline snapshot timestamp boundary was not found'; end if;
  execute v_rewritten;
end
$canonical_snapshot_wire_timestamps$;

-- Replay is checked before current authority so a genuine pre-deactivation
-- start can be delivered later. New contexts must have both immutable
-- activation boundaries open at their signed started_at.
do $offline_start_activation_boundaries$
declare v_definition text; v_rewritten text; v_locked text;
begin
  v_definition:=pg_get_functiondef('public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'::regprocedure);
  v_rewritten:=replace(v_definition,
    $old$if v_location.id is null or v_snapshot_location_code is null then raise exception using errcode='22023',message='location is not authorized by the issued offline snapshot'; end if;$old$,
    $new$if v_location.id is null or v_snapshot_location_code is null then raise exception using errcode='22023',message='location is not authorized by the issued offline snapshot'; end if;
  if not public.custodial_offline_authority_active_at('device',v_snapshot.device_id,v_started_at)
     or not public.custodial_offline_authority_active_at('location',v_location.id,v_started_at) then
    raise exception using errcode='42501',message='device or location was not active when the offline occurrence began';
  end if;$new$);
  if v_rewritten=v_definition then raise exception 'offline start location authority boundary was not found'; end if;
  v_locked:=replace(v_rewritten,
    $old$from public.locations l where l.location_code=v_snapshot_location_code;$old$,
    $new$from public.locations l where l.location_code=v_snapshot_location_code for share;$new$);
  if v_locked=v_rewritten then raise exception 'offline start location serialization boundary was not found'; end if;
  v_rewritten:=v_locked;
  v_rewritten:=replace(v_rewritten,$old$'started_at',v_existing.started_at$old$,$new$'started_at',public.custodial_canonical_utc_millis(v_existing.started_at)$new$);
  v_rewritten:=replace(v_rewritten,$old$'started_at',v_context.started_at$old$,$new$'started_at',public.custodial_canonical_utc_millis(v_context.started_at)$new$);
  v_rewritten:=replace(v_rewritten,$old$'expires_at',v_existing.expires_at$old$,$new$'expires_at',public.custodial_canonical_utc_millis(v_existing.expires_at)$new$);
  v_rewritten:=replace(v_rewritten,$old$'expires_at',v_context.expires_at$old$,$new$'expires_at',public.custodial_canonical_utc_millis(v_context.expires_at)$new$);
  if position($old$'started_at',v_existing.started_at$old$ in v_rewritten)>0 or position($old$'started_at',v_context.started_at$old$ in v_rewritten)>0 then
    raise exception 'offline start timestamp output was not canonicalized';
  end if;
  execute v_rewritten;
end
$offline_start_activation_boundaries$;

-- Completion identifiers are UUID protocol values end-to-end. The NOT VALID
-- checks retain historical non-UUID rows while enforcing the invariant for all
-- new writes; the native RPC validates and casts before it can quarantine.
alter table public.custodial_offline_reconciliation_records
  add constraint custodial_offline_reconciliation_client_completion_id_uuid
  check (client_completion_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') not valid;
alter table public.completion_responses
  add constraint completion_responses_client_completion_id_uuid
  check (client_completion_id is null or client_completion_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') not valid;

alter table public.custodial_offline_actor_contexts
  add column native_finish_scan_entry_id uuid,
  drop constraint custodial_offline_native_completion_evidence_check,
  add constraint custodial_offline_native_completion_evidence_check check (
    (native_completion_attestation_version is null and native_completion_attestation_sha256 is null
      and native_completed_at is null and native_finish_scan_entry_id is null)
    or (native_completion_attestation_version='custodial-native-completion.v1'
      and native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$' and native_completed_at is not null
      and native_finish_scan_entry_id is null)
    or (native_completion_attestation_version='custodial-native-completion.v2'
      and native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$' and native_completed_at is not null
      and native_finish_scan_entry_id is not null)
  ),
  add constraint uq_custodial_offline_native_finish_scan_entry unique(native_finish_scan_entry_id);

drop function public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text);
create function public.tool_commit_cleaning_workflow_authoritative(
  p_client_session_id text,p_client_completion_id text,p_device_id text,p_location_code text,
  p_client_started_at text,p_client_ended_at text,p_response_json jsonb,p_scan_evidence jsonb,
  p_correlation_id text,p_context_id text,p_submission_proof text,p_authenticated_credential_id text,p_native_finish_scan_entry_id text,
  p_native_completion_attestation_version text,p_native_completion_attestation text,
  p_native_route_proof_secret text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_completion_id uuid; v_context_id uuid; v_finish_scan_entry_id uuid; v_result jsonb; v_started_at timestamptz; v_completed_at timestamptz;
  v_native_completed_at timestamptz; v_attestation_sha256 text;
begin
  begin
    v_completion_id:=lower(btrim(coalesce(p_client_completion_id,'')))::uuid;
  exception when others then
    raise exception using errcode='22023',message='p_client_completion_id must be a UUID';
  end;
  perform public.custodial_require_native_route_proof_secret(p_native_route_proof_secret);
  if btrim(coalesce(p_native_completion_attestation_version,''))<>'custodial-native-completion.v2'
     or lower(btrim(coalesce(p_native_completion_attestation,''))) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='42501',message='a verified native completion attestation is required';
  end if;
  begin
    v_context_id:=lower(btrim(p_context_id))::uuid;
    v_finish_scan_entry_id:=lower(btrim(p_native_finish_scan_entry_id))::uuid;
    v_native_completed_at:=btrim(p_client_ended_at)::timestamptz;
  exception when others then
    raise exception using errcode='22023',message='native completion evidence is malformed';
  end;
  if not isfinite(v_native_completed_at) then
    raise exception using errcode='22023',message='native completion evidence is malformed';
  end if;
  if jsonb_typeof(p_scan_evidence)<>'array'
     or (select count(*) from jsonb_array_elements(p_scan_evidence) e where e->>'event_type'='scan_finish')<>1
     or not exists(
       select 1 from jsonb_array_elements(p_scan_evidence) e
       where e->>'event_type'='scan_finish'
         and lower(e->>'client_event_id')=v_finish_scan_entry_id::text
         and e->>'result'='ok'
         and e->>'scanned_at'=public.custodial_canonical_utc_millis(v_native_completed_at)
         and e->'payload_json'->>'entry_source'='native-nfc'
     ) then
    raise exception using errcode='42501',message='the signed physical NFC finish scan is required';
  end if;
  v_attestation_sha256:=encode(extensions.digest(convert_to(lower(btrim(p_native_completion_attestation)),'UTF8'),'sha256'),'hex');
  if exists(
    select 1 from public.custodial_offline_actor_contexts c where c.context_id=v_context_id
      and (c.native_start_attestation_version is distinct from 'custodial-native-start.v1'
        or c.native_scan_entry_id is null
        or (c.native_completion_attestation_version is not null and
          (c.native_completion_attestation_version<>p_native_completion_attestation_version
            or c.native_completion_attestation_sha256<>v_attestation_sha256
            or c.native_completed_at<>v_native_completed_at
            or c.native_finish_scan_entry_id<>v_finish_scan_entry_id)))
  ) then
    raise exception using errcode='23505',message='native completion attestation does not match the frozen occurrence';
  end if;
  v_result:=public.custodial_commit_offline_occurrence(
    p_client_session_id,v_completion_id::text,p_device_id,p_location_code,p_client_started_at,p_client_ended_at,
    p_response_json,p_scan_evidence,p_correlation_id,p_context_id,p_submission_proof,p_authenticated_credential_id,p_backend_execution_secret
  );
  if v_result->>'status'='closed' then
    update public.custodial_offline_actor_contexts
       set native_completion_attestation_version=p_native_completion_attestation_version,
           native_completion_attestation_sha256=v_attestation_sha256,
           native_completed_at=v_native_completed_at,
           native_finish_scan_entry_id=v_finish_scan_entry_id
     where context_id=v_context_id and native_completion_attestation_version is null;
    if not found and not exists(
      select 1 from public.custodial_offline_actor_contexts c
      where c.context_id=v_context_id
        and c.native_completion_attestation_version=p_native_completion_attestation_version
        and c.native_completion_attestation_sha256=v_attestation_sha256
        and c.native_completed_at=v_native_completed_at
        and c.native_finish_scan_entry_id=v_finish_scan_entry_id
    ) then
      raise exception using errcode='23505',message='native completion attestation does not match the frozen occurrence';
    end if;
  end if;
  begin
    v_started_at:=nullif(v_result->>'started_at','')::timestamptz;
    v_completed_at:=nullif(coalesce(v_result->>'completed_at',v_result->>'ended_at'),'')::timestamptz;
  exception when others then
    return v_result||jsonb_build_object('native_completion_attested',v_result->>'status'='closed');
  end;
  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'started_at',public.custodial_canonical_utc_millis(v_started_at),
    'ended_at',public.custodial_canonical_utc_millis(v_completed_at),
    'completed_at',public.custodial_canonical_utc_millis(v_completed_at),
    'native_completion_attested',v_result->>'status'='closed',
    'native_finish_scan_entry_id',case when v_result->>'status'='closed' then v_finish_scan_entry_id end
  ));
end
$function$;
revoke all on function public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text) to postgres,service_role;

create or replace function public.custodial_get_device_rollback_readiness(p_device_identifier text)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','public'
as $function$
declare v_device public.devices%rowtype; v_sync public.device_sync_status%rowtype; v_open_sessions integer;
begin
  select d.* into v_device from public.device_aliases a join public.devices d on d.id=a.canonical_device_id
  where a.alias_identifier=btrim(p_device_identifier) and a.active=true and d.active=true limit 1;
  if v_device.id is null then select d.* into v_device from public.devices d where d.device_id=btrim(p_device_identifier) and d.active=true limit 1; end if;
  if v_device.id is null then raise exception using errcode='P0002',message='Active device not found'; end if;
  select * into v_sync from public.device_sync_status where device_id=v_device.id;
  select count(*)::integer into v_open_sessions from public.sessions
  where device_id=v_device.id and status in ('active','pending_submit');
  return jsonb_build_object(
    'contract_version','custodial-rollback-readiness.v2','device_id',v_device.device_id,
    'backend_queue_count',coalesce(v_sync.queue_count,-1),'backend_open_session_count',v_open_sessions,
    'backend_sync_reported_at',v_sync.updated_at,
    'eligible',v_sync.device_id is not null and v_sync.updated_at>=now()-interval '5 minutes'
      and v_sync.queue_count=0 and v_open_sessions=0
  );
end
$function$;

create or replace function public.tool_get_device_rollback_readiness(p_device_identifier text)
returns jsonb language sql stable security definer set search_path to 'pg_catalog','public'
as $function$
  select public.custodial_get_device_rollback_readiness(p_device_identifier)
$function$;
revoke all on function public.custodial_get_device_rollback_readiness(text),public.tool_get_device_rollback_readiness(text) from public,anon,authenticated;
revoke all on function public.custodial_get_device_rollback_readiness(text) from service_role;
grant execute on function public.custodial_get_device_rollback_readiness(text) to postgres;
grant execute on function public.tool_get_device_rollback_readiness(text) to postgres,service_role;

-- Build 22 can leave an exact, UUID-bound finish transition in the durable
-- queue. Drain only that exact identity through the retired function's proven
-- implementation; never revive its location/device replacement path.
create or replace function public.custodial_finish_historical_session_authoritative(
  p_session_identifier text,p_device_id text,p_finish_operation_id uuid,
  p_client_ended_at timestamptz,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  return public.tool_finish_session_exact(
    p_session_identifier,p_device_id,p_finish_operation_id,p_client_ended_at
  );
end
$function$;
revoke all on function public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text) to postgres,service_role;

-- Replace the deployed registration definition at this forward migration. A
-- token generation must not inherit provider success from the token it replaced.
create or replace function public.mz_register_employee_push(
  p_credential_id uuid,p_token text,p_token_hash text,p_platform text,
  p_app_version text default null,p_app_build text default null
) returns public.employee_push_registrations
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare v_device public.devices%rowtype; v_result public.employee_push_registrations%rowtype;
begin
  select d.* into v_device
  from public.device_auth_credentials c join public.devices d on d.id=c.device_id
  where c.credential_id=p_credential_id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>now() and d.active=true
  for update of d;
  if v_device.id is null or v_device.assigned_employee_id is null then
    raise exception using errcode='42501',message='Credential is not assigned to an active employee device.';
  end if;
  if p_platform not in ('android','ios') or length(btrim(coalesce(p_token,'')))<20
     or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='A valid FCM token, token digest, and platform are required.';
  end if;
  update public.employee_push_registrations
  set active=false,revoked_at=now(),revoked_reason='token_rotated',updated_at=now()
  where device_id=v_device.id and active=true and revoked_at is null
    and (credential_id<>p_credential_id or assignment_epoch<>v_device.assignment_epoch or token_hash<>p_token_hash);
  insert into public.employee_push_registrations(
    device_id,credential_id,employee_id,assignment_epoch,platform,fcm_token,token_hash,
    app_version,app_build,active,registered_at,last_seen_at,revoked_at,revoked_reason,last_error,updated_at
  ) values (
    v_device.id,p_credential_id,v_device.assigned_employee_id,v_device.assignment_epoch,p_platform,p_token,p_token_hash,
    nullif(left(coalesce(p_app_version,''),80),''),nullif(left(coalesce(p_app_build,''),120),''),
    true,now(),now(),null,null,null,now()
  ) on conflict(credential_id,assignment_epoch) do update set
    employee_id=excluded.employee_id,platform=excluded.platform,fcm_token=excluded.fcm_token,
    token_hash=excluded.token_hash,app_version=excluded.app_version,app_build=excluded.app_build,
    active=true,registered_at=now(),last_seen_at=now(),
    last_successful_delivery_at=case
      when public.employee_push_registrations.token_hash=excluded.token_hash
        then public.employee_push_registrations.last_successful_delivery_at
      else null
    end,
    revoked_at=null,revoked_reason=null,last_error=null,updated_at=now()
  returning * into v_result;
  return v_result;
end
$function$;
revoke all on function public.mz_register_employee_push(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mz_register_employee_push(uuid,text,text,text,text,text) to postgres,service_role;

-- A registration row is reused when the same device credential rotates its FCM
-- token. Provider results must therefore commit against the selected token
-- generation, not merely the stable registration UUID.
create or replace function public.mz_record_employee_push_delivery(
  p_registration_id uuid,p_token_hash text,p_succeeded boolean,p_permanent boolean,
  p_error text,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_registration public.employee_push_registrations%rowtype;
begin
  if p_registration_id is null or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' or p_succeeded is null or p_permanent is null
     or (p_succeeded and p_permanent) then
    raise exception using errcode='22023',message='exact employee push registration binding and one delivery outcome are required';
  end if;
  select * into v_registration from public.employee_push_registrations
  where registration_id=p_registration_id for update;
  if v_registration.registration_id is null
     or v_registration.token_hash<>p_token_hash
     or v_registration.active is not true
     or v_registration.revoked_at is not null then
    return jsonb_build_object('current',false,'recorded',false,'reason','push_registration_superseded');
  end if;
  if p_succeeded then
    update public.employee_push_registrations
    set last_successful_delivery_at=p_now,last_error=null,updated_at=p_now
    where registration_id=p_registration_id and token_hash=p_token_hash;
  elsif p_permanent then
    update public.employee_push_registrations
    set active=false,revoked_at=p_now,revoked_reason='push_token_rejected',
      last_error=left(coalesce(p_error,'FCM rejected the registration token.'),2000),updated_at=p_now
    where registration_id=p_registration_id and token_hash=p_token_hash;
  else
    update public.employee_push_registrations
    set last_error=left(coalesce(p_error,'FCM provider request failed.'),2000),updated_at=p_now
    where registration_id=p_registration_id and token_hash=p_token_hash;
  end if;
  return jsonb_build_object('current',true,'recorded',true,'registration_id',p_registration_id,'succeeded',p_succeeded);
end
$function$;
revoke all on function public.mz_record_employee_push_delivery(uuid,text,boolean,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mz_record_employee_push_delivery(uuid,text,boolean,boolean,text,timestamptz) to postgres,service_role;

-- Native message/location/test jobs need one durable logical-delivery marker in
-- addition to registration health. If a worker loses its response after this
-- transaction commits, lease recovery reads the receipt and finalizes the job
-- without dispatching the same notification to FCM again.
create table public.employee_native_push_delivery_receipts (
  job_id uuid primary key references public.operational_notification_jobs(job_id) on delete cascade,
  job_key text not null unique,
  source_id uuid not null,
  lease_token uuid not null,
  credential_id uuid not null,
  assignment_epoch bigint not null check (assignment_epoch>0),
  registration_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  delivery_state text not null default 'prepared' check (delivery_state in ('prepared','delivered')),
  provider_message_id text check (provider_message_id is null or length(btrim(provider_message_id)) between 1 and 1000),
  prepared_at timestamptz not null default statement_timestamp(),
  delivered_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (
    (delivery_state='prepared' and provider_message_id is null and delivered_at is null)
    or (delivery_state='delivered' and provider_message_id is not null and delivered_at is not null)
  )
);
alter table public.employee_native_push_delivery_receipts enable row level security;
alter table public.employee_native_push_delivery_receipts force row level security;
revoke all on table public.employee_native_push_delivery_receipts from public,anon,authenticated,service_role;

create or replace function public.mz_get_employee_native_push_delivery_receipt(
  p_job_id uuid,p_lease_token uuid,p_credential_id uuid,p_assignment_epoch bigint
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_job public.operational_notification_jobs%rowtype; v_receipt public.employee_native_push_delivery_receipts%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1 then
    raise exception using errcode='22023',message='exact native push job lease and assignment recipient are required';
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  v_reason:=case
    when v_job.job_id is null then 'employee_native_push_job_missing'
    when v_job.job_type<>'employee_native_push' then 'employee_native_push_job_type_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_native_push_lease_superseded'
    when v_job.payload_json->>'credential_id' is distinct from p_credential_id::text
      or v_job.payload_json->>'assignment_epoch' is distinct from p_assignment_epoch::text then 'employee_native_push_recipient_superseded'
    else null
  end;
  if v_reason is not null then return jsonb_build_object('current',false,'terminal',true,'reason',v_reason); end if;
  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id;
  if v_receipt.job_id is not null then
    if v_receipt.job_key<>v_job.job_key or v_receipt.source_id<>v_job.source_id
       or v_receipt.credential_id<>p_credential_id or v_receipt.assignment_epoch<>p_assignment_epoch then
      raise exception using errcode='23514',message='native push delivery receipt is bound to different job inputs';
    end if;
    if v_receipt.delivery_state='prepared' then
      return jsonb_build_object('current',true,'terminal',true,'already_recorded',false,'recorded',false,
        'dispatch_prepared',true,'delivery_outcome_unknown',true,'reason','native_push_delivery_outcome_unknown',
        'prepared_at',v_receipt.prepared_at);
    end if;
    return jsonb_build_object('current',true,'already_recorded',true,'recorded',true,
      'dispatch_prepared',true,'delivery_outcome_unknown',false,
      'provider_message_id',v_receipt.provider_message_id,'delivered_at',v_receipt.delivered_at);
  end if;
  return jsonb_build_object('current',true,'already_recorded',false,'recorded',false);
end
$function$;

create or replace function public.mz_prepare_employee_native_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_receipt public.employee_native_push_delivery_receipts%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1
     or p_registration_id is null or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='exact native push job, recipient, and token generation are required';
  end if;
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);
  if coalesce((v_delivery->>'ok')::boolean,false) is not true then
    return jsonb_build_object('current',false,'dispatch_authorized',false,
      'reason',coalesce(v_delivery->>'reason','employee_push_recipient_superseded'));
  end if;
  if (v_delivery#>>'{registration,registration_id}')::uuid is distinct from p_registration_id
     or v_delivery#>>'{registration,token_hash}' is distinct from p_token_hash then
    return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','push_registration_superseded');
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  v_reason:=case
    when v_job.job_id is null then 'employee_native_push_job_missing'
    when v_job.job_type<>'employee_native_push' then 'employee_native_push_job_type_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_native_push_lease_superseded'
    when v_job.payload_json->>'credential_id' is distinct from p_credential_id::text
      or v_job.payload_json->>'assignment_epoch' is distinct from p_assignment_epoch::text then 'employee_native_push_recipient_superseded'
    else null
  end;
  if v_reason is not null then
    return jsonb_build_object('current',false,'dispatch_authorized',false,'reason',v_reason);
  end if;
  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id for update;
  if v_receipt.job_id is not null then
    if v_receipt.job_key<>v_job.job_key or v_receipt.source_id<>v_job.source_id
       or v_receipt.credential_id<>p_credential_id or v_receipt.assignment_epoch<>p_assignment_epoch
       or v_receipt.registration_id<>p_registration_id or v_receipt.token_hash<>p_token_hash then
      return jsonb_build_object('current',false,'dispatch_authorized',false,'reason','native_push_delivery_receipt_input_mismatch');
    end if;
    return jsonb_build_object('current',true,'dispatch_authorized',false,'already_prepared',true,
      'already_recorded',v_receipt.delivery_state='delivered','delivery_state',v_receipt.delivery_state,
      'delivery_outcome_unknown',v_receipt.delivery_state='prepared','reason',
      case when v_receipt.delivery_state='prepared' then 'native_push_delivery_outcome_unknown' else 'native_push_delivery_already_recorded' end,
      'provider_message_id',v_receipt.provider_message_id,'prepared_at',v_receipt.prepared_at,'delivered_at',v_receipt.delivered_at);
  end if;
  insert into public.employee_native_push_delivery_receipts(
    job_id,job_key,source_id,lease_token,credential_id,assignment_epoch,registration_id,token_hash,delivery_state,prepared_at
  ) values (
    v_job.job_id,v_job.job_key,v_job.source_id,p_lease_token,p_credential_id,p_assignment_epoch,
    p_registration_id,p_token_hash,'prepared',p_now
  ) returning * into v_receipt;
  return jsonb_build_object('current',true,'dispatch_authorized',true,'already_prepared',false,
    'already_recorded',false,'delivery_state','prepared','delivery_outcome_unknown',false,'prepared_at',v_receipt.prepared_at);
end
$function$;

create or replace function public.mz_release_employee_native_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_job public.operational_notification_jobs%rowtype; v_receipt public.employee_native_push_delivery_receipts%rowtype; v_reason text;
begin
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  v_reason:=case
    when v_job.job_id is null then 'employee_native_push_job_missing'
    when v_job.job_type<>'employee_native_push' then 'employee_native_push_job_type_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_native_push_lease_superseded'
    else null
  end;
  if v_reason is not null then return jsonb_build_object('current',false,'released',false,'reason',v_reason); end if;
  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id for update;
  if v_receipt.job_id is null then return jsonb_build_object('current',true,'released',false,'reason','native_push_delivery_not_prepared'); end if;
  if v_receipt.delivery_state<>'prepared' or v_receipt.lease_token<>p_lease_token
     or v_receipt.credential_id<>p_credential_id or v_receipt.assignment_epoch<>p_assignment_epoch
     or v_receipt.registration_id<>p_registration_id or v_receipt.token_hash<>p_token_hash then
    return jsonb_build_object('current',false,'released',false,'reason','native_push_delivery_receipt_input_mismatch');
  end if;
  delete from public.employee_native_push_delivery_receipts where job_id=p_job_id;
  return jsonb_build_object('current',true,'released',true,'job_id',p_job_id);
end
$function$;

create or replace function public.mz_record_employee_native_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text,p_provider_message_id text,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_receipt public.employee_native_push_delivery_receipts%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1
     or p_registration_id is null or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_provider_message_id,''))) not between 1 and 1000 then
    raise exception using errcode='22023',message='exact native push job, recipient, token generation, and provider result are required';
  end if;
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);
  if coalesce((v_delivery->>'ok')::boolean,false) is not true then
    return jsonb_build_object('current',false,'recorded',false,'reason',coalesce(v_delivery->>'reason','employee_push_recipient_superseded'));
  end if;
  if (v_delivery#>>'{registration,registration_id}')::uuid is distinct from p_registration_id
     or v_delivery#>>'{registration,token_hash}' is distinct from p_token_hash then
    return jsonb_build_object('current',false,'recorded',false,'reason','push_registration_superseded');
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  v_reason:=case
    when v_job.job_id is null then 'employee_native_push_job_missing'
    when v_job.job_type<>'employee_native_push' then 'employee_native_push_job_type_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_native_push_lease_superseded'
    when v_job.payload_json->>'credential_id' is distinct from p_credential_id::text
      or v_job.payload_json->>'assignment_epoch' is distinct from p_assignment_epoch::text then 'employee_native_push_recipient_superseded'
    else null
  end;
  if v_reason is not null then return jsonb_build_object('current',false,'recorded',false,'reason',v_reason); end if;
  select * into v_receipt from public.employee_native_push_delivery_receipts where job_id=p_job_id for update;
  if v_receipt.job_id is null then
    return jsonb_build_object('current',false,'recorded',false,'reason','native_push_delivery_not_prepared');
  end if;
  if v_receipt.job_key<>v_job.job_key or v_receipt.source_id<>v_job.source_id
     or v_receipt.lease_token<>p_lease_token or v_receipt.credential_id<>p_credential_id
     or v_receipt.assignment_epoch<>p_assignment_epoch or v_receipt.registration_id<>p_registration_id
     or v_receipt.token_hash<>p_token_hash then
    return jsonb_build_object('current',false,'recorded',false,'reason','native_push_delivery_receipt_input_mismatch');
  end if;
  if v_receipt.delivery_state='delivered' then
    if v_receipt.provider_message_id<>btrim(p_provider_message_id) then
      return jsonb_build_object('current',false,'recorded',false,'reason','native_push_delivery_receipt_input_mismatch');
    end if;
    return jsonb_build_object('current',true,'already_recorded',true,'recorded',true,
      'provider_message_id',v_receipt.provider_message_id,'delivered_at',v_receipt.delivered_at);
  end if;
  update public.employee_native_push_delivery_receipts
  set delivery_state='delivered',provider_message_id=btrim(p_provider_message_id),delivered_at=p_now
  where job_id=p_job_id and delivery_state='prepared'
  returning * into v_receipt;
  if v_receipt.job_id is null then
    raise exception using errcode='40001',message='native push delivery preparation changed concurrently';
  end if;
  update public.employee_push_registrations
  set last_successful_delivery_at=p_now,last_error=null,updated_at=p_now
  where registration_id=p_registration_id and token_hash=p_token_hash;
  return jsonb_build_object('current',true,'already_recorded',false,'recorded',true,
    'provider_message_id',v_receipt.provider_message_id,'delivered_at',v_receipt.delivered_at);
end
$function$;

revoke all on function public.mz_get_employee_native_push_delivery_receipt(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.mz_release_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mz_get_employee_native_push_delivery_receipt(uuid,uuid,uuid,bigint) to postgres,service_role;
grant execute on function public.mz_prepare_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,timestamptz) to postgres,service_role;
grant execute on function public.mz_release_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text) to postgres,service_role;
grant execute on function public.mz_record_employee_native_push_delivery(uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) to postgres,service_role;

-- Event delivery has an external provider boundary, so it cannot hold a
-- database transaction open while FCM runs. Claim immediately before that
-- boundary, then atomically bind provider acceptance to the same event,
-- assignment, registration, and token generation afterward.
alter table public.event_push_instances
  add column dispatch_job_id uuid,
  add column dispatch_lease_token uuid,
  add column dispatch_registration_id uuid,
  add column dispatch_token_hash text,
  add column dispatch_started_at timestamptz,
  add constraint event_push_instances_dispatch_binding check (
    (dispatch_job_id is null and dispatch_lease_token is null and dispatch_registration_id is null
      and dispatch_token_hash is null and dispatch_started_at is null)
    or (dispatch_job_id is not null and dispatch_lease_token is not null and dispatch_registration_id is not null
      and dispatch_token_hash ~ '^[0-9a-f]{64}$' and dispatch_started_at is not null)
  );
create unique index event_push_instances_dispatch_job_idx on public.event_push_instances(dispatch_job_id) where dispatch_job_id is not null;
drop function if exists public.mz_claim_employee_event_push_delivery(uuid,uuid,bigint,timestamptz);

create or replace function public.mz_claim_employee_event_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_instance_id uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_instance public.event_push_instances%rowtype; v_event public.events_app_events%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null or p_credential_id is null
     or p_assignment_epoch is null or p_assignment_epoch<1 or p_registration_id is null
     or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='exact event job, lease, recipient, and token generation are required';
  end if;
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);
  if coalesce((v_delivery->>'ok')::boolean,false) is not true then return v_delivery; end if;
  if (v_delivery#>>'{registration,registration_id}')::uuid is distinct from p_registration_id
     or v_delivery#>>'{registration,token_hash}' is distinct from p_token_hash then
    return jsonb_build_object('ok',false,'terminal',true,'reason','push_registration_superseded');
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_instance.instance_id is not null then
    select * into v_event from public.events_app_events where id=v_instance.event_id for share;
  end if;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id for update;
  if v_job.job_id is not null and v_job.job_type='employee_event_push' and v_job.source_id=p_instance_id
     and v_job.status='leased' and v_job.lease_token is not distinct from p_lease_token
     and v_job.leased_until>statement_timestamp() and v_instance.state='sent'
     and v_instance.credential_id=p_credential_id and v_instance.assignment_epoch=p_assignment_epoch
     and v_instance.provider_message_id is not null and v_event.id is not null
     and v_event.revision=v_instance.event_revision then
    return jsonb_build_object('ok',true,'terminal',false,'dispatch_authorized',false,'already_recorded',true,
      'instance_id',p_instance_id,'state','sent','provider_message_id',v_instance.provider_message_id);
  end if;
  v_reason:=case
    when v_job.job_id is null then 'employee_event_push_job_missing'
    when v_job.job_type<>'employee_event_push' or v_job.source_id<>p_instance_id then 'employee_event_push_job_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_event_push_lease_superseded'
    when v_instance.instance_id is null then 'event_push_instance_missing'
    when v_instance.credential_id<>p_credential_id or v_instance.assignment_epoch<>p_assignment_epoch then 'event_push_recipient_superseded'
    when v_instance.state='leased' and v_instance.dispatch_job_id=p_job_id
      and v_instance.dispatch_lease_token=p_lease_token and v_instance.dispatch_registration_id=p_registration_id
      and v_instance.dispatch_token_hash=p_token_hash then 'event_push_delivery_in_flight'
    when v_instance.state='leased' and v_instance.dispatch_job_id is not null then 'event_push_delivery_outcome_unknown'
    when v_instance.state not in ('pending','failed') then 'event_push_instance_'||v_instance.state
    when v_event.id is null or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
      or v_event.cancelled_at is not null or v_event.archived_at is not null then 'event_or_revision_superseded'
    when v_instance.employee_id is distinct from (v_delivery->>'employee_id')::uuid
      or v_instance.device_id is distinct from (v_delivery->>'device_id')::uuid then 'event_push_recipient_superseded'
    else null
  end;
  if v_reason is not null then
    if v_reason='event_push_delivery_in_flight' then
      return jsonb_build_object('ok',false,'terminal',false,'defer_finish',true,'dispatch_authorized',false,
        'reason',v_reason,'instance_id',p_instance_id,'state','leased');
    end if;
    update public.event_push_instances set state='cancelled',cancelled_at=coalesce(cancelled_at,p_now),
      last_error=v_reason,updated_at=p_now
    where instance_id=p_instance_id and state in ('pending','leased','failed');
    return jsonb_build_object('ok',false,'terminal',true,'reason',v_reason,'instance_id',p_instance_id);
  end if;
  update public.event_push_instances set state='leased',dispatch_job_id=p_job_id,dispatch_lease_token=p_lease_token,
    dispatch_registration_id=p_registration_id,dispatch_token_hash=p_token_hash,dispatch_started_at=p_now,
    last_error=null,updated_at=p_now
  where instance_id=p_instance_id;
  return jsonb_build_object('ok',true,'terminal',false,'dispatch_authorized',true,'instance_id',p_instance_id,'state','leased');
end
$function$;

drop function if exists public.mz_record_employee_event_push_delivery(uuid,uuid,bigint,uuid,text,text,timestamptz);

create or replace function public.mz_release_employee_event_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_instance_id uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text,p_error text,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_job public.operational_notification_jobs%rowtype; v_instance public.event_push_instances%rowtype; v_reason text;
begin
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id for update;
  v_reason:=case
    when v_job.job_id is null then 'employee_event_push_job_missing'
    when v_job.job_type<>'employee_event_push' or v_job.source_id<>p_instance_id then 'employee_event_push_job_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_event_push_lease_superseded'
    when v_instance.instance_id is null then 'event_push_instance_missing'
    when v_instance.state<>'leased' then 'event_push_instance_'||v_instance.state
    when v_instance.dispatch_job_id<>p_job_id or v_instance.dispatch_lease_token<>p_lease_token
      or v_instance.credential_id<>p_credential_id or v_instance.assignment_epoch<>p_assignment_epoch
      or v_instance.dispatch_registration_id<>p_registration_id or v_instance.dispatch_token_hash<>p_token_hash
      then 'event_push_dispatch_superseded'
    else null
  end;
  if v_reason is not null then
    return jsonb_build_object('current',false,'released',false,'reason',v_reason,'instance_id',p_instance_id);
  end if;
  update public.event_push_instances
  set state='failed',dispatch_job_id=null,dispatch_lease_token=null,dispatch_registration_id=null,
      dispatch_token_hash=null,dispatch_started_at=null,last_error=left(coalesce(p_error,'provider did not accept event push'),2000),updated_at=p_now
  where instance_id=p_instance_id;
  return jsonb_build_object('current',true,'released',true,'instance_id',p_instance_id,'state','failed');
end
$function$;

create or replace function public.mz_record_employee_event_push_delivery(
  p_job_id uuid,p_lease_token uuid,p_instance_id uuid,p_credential_id uuid,p_assignment_epoch bigint,
  p_registration_id uuid,p_token_hash text,p_provider_message_id text,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_delivery jsonb; v_job public.operational_notification_jobs%rowtype; v_instance public.event_push_instances%rowtype; v_event public.events_app_events%rowtype; v_reason text;
begin
  if p_job_id is null or p_lease_token is null or p_instance_id is null or p_credential_id is null or p_assignment_epoch is null or p_assignment_epoch<1
     or p_registration_id is null or coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_provider_message_id,''))) not between 1 and 1000 then
    raise exception using errcode='22023',message='exact event, recipient, token generation, and provider result are required';
  end if;
  v_delivery:=public.mz_resolve_employee_push_delivery(p_credential_id,p_assignment_epoch,p_now);
  if coalesce((v_delivery->>'ok')::boolean,false) is not true then
    return jsonb_build_object('current',false,'recorded',false,'reason',coalesce(v_delivery->>'reason','employee_push_recipient_superseded'));
  end if;
  select * into v_job from public.operational_notification_jobs where job_id=p_job_id for update;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id;
  if v_instance.instance_id is not null then
    select * into v_event from public.events_app_events where id=v_instance.event_id for share;
  end if;
  select * into v_instance from public.event_push_instances where instance_id=p_instance_id for update;
  if v_instance.state='sent' then
    if v_instance.dispatch_job_id=p_job_id and v_instance.dispatch_lease_token=p_lease_token
       and v_instance.credential_id=p_credential_id and v_instance.assignment_epoch=p_assignment_epoch
       and v_instance.dispatch_registration_id=p_registration_id and v_instance.dispatch_token_hash=p_token_hash
       and v_instance.provider_message_id=btrim(p_provider_message_id) then
      return jsonb_build_object('current',true,'already_recorded',true,'recorded',true,
        'instance_id',p_instance_id,'state','sent','provider_message_id',v_instance.provider_message_id);
    end if;
    return jsonb_build_object('current',false,'recorded',false,'reason','event_push_delivery_receipt_input_mismatch');
  end if;
  v_reason:=case
    when v_job.job_id is null then 'employee_event_push_job_missing'
    when v_job.job_type<>'employee_event_push' or v_job.source_id<>p_instance_id then 'employee_event_push_job_mismatch'
    when v_job.status<>'leased' or v_job.lease_token is distinct from p_lease_token
      or v_job.leased_until is null or v_job.leased_until<=statement_timestamp() then 'employee_event_push_lease_superseded'
    when (v_delivery#>>'{registration,registration_id}')::uuid is distinct from p_registration_id
      or v_delivery#>>'{registration,token_hash}' is distinct from p_token_hash then 'push_registration_superseded'
    when v_instance.instance_id is null then 'event_push_instance_missing'
    when v_instance.credential_id<>p_credential_id or v_instance.assignment_epoch<>p_assignment_epoch
      or v_instance.employee_id is distinct from (v_delivery->>'employee_id')::uuid
      or v_instance.device_id is distinct from (v_delivery->>'device_id')::uuid then 'event_push_recipient_superseded'
    when v_instance.state<>'leased' then 'event_push_instance_'||v_instance.state
    when v_instance.dispatch_job_id<>p_job_id or v_instance.dispatch_lease_token<>p_lease_token
      or v_instance.dispatch_registration_id<>p_registration_id or v_instance.dispatch_token_hash<>p_token_hash then 'event_push_dispatch_superseded'
    when v_event.id is null or v_event.revision<>v_instance.event_revision or v_event.status<>'SCHEDULED'
      or v_event.cancelled_at is not null or v_event.archived_at is not null then 'event_or_revision_superseded'
    else null
  end;
  if v_reason is not null then
    update public.event_push_instances set state='cancelled',cancelled_at=coalesce(cancelled_at,p_now),
      last_error=v_reason,updated_at=p_now
    where instance_id=p_instance_id and state in ('pending','leased','failed');
    return jsonb_build_object('current',false,'recorded',false,'reason',v_reason,'instance_id',p_instance_id);
  end if;
  update public.employee_push_registrations
  set last_successful_delivery_at=p_now,last_error=null,updated_at=p_now
  where registration_id=p_registration_id and token_hash=p_token_hash;
  update public.event_push_instances
  set state='sent',sent_at=p_now,provider_message_id=btrim(p_provider_message_id),last_error=null,updated_at=p_now
  where instance_id=p_instance_id;
  return jsonb_build_object('current',true,'already_recorded',false,'recorded',true,
    'instance_id',p_instance_id,'state','sent','provider_message_id',btrim(p_provider_message_id));
end
$function$;

revoke all on function public.mz_claim_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.mz_release_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.mz_record_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mz_claim_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,timestamptz) to postgres,service_role;
grant execute on function public.mz_release_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) to postgres,service_role;
grant execute on function public.mz_record_employee_event_push_delivery(uuid,uuid,uuid,uuid,bigint,uuid,text,text,timestamptz) to postgres,service_role;

-- Exhausting the final retry is a terminal outcome just like success. Preserve
-- that invariant for every notification job, including older job types.
create or replace function public.finish_operational_notification_job(
  p_job_id uuid,p_lease_token uuid,p_succeeded boolean,p_error text default null,p_retry_seconds integer default 30
) returns public.operational_notification_jobs language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_row public.operational_notification_jobs;
begin
  update public.operational_notification_jobs j
  set status=case when p_succeeded then 'completed' when j.attempts>=j.max_attempts then 'dead' else 'pending' end,
      completed_at=case when p_succeeded or j.attempts>=j.max_attempts then now() else null end,
      available_at=case when p_succeeded then j.available_at else now()+make_interval(secs=>greatest(5,least(coalesce(p_retry_seconds,30),3600))) end,
      leased_at=null,leased_until=null,lease_token=null,worker_id=null,
      last_error=case when p_succeeded then null else left(coalesce(p_error,'notification failed'),2000) end,
      updated_at=now()
  where j.job_id=p_job_id and j.status='leased' and j.lease_token=p_lease_token
  returning j.* into v_row;
  if v_row.job_id is null then raise exception 'notification job lease is no longer authoritative'; end if;
  return v_row;
end
$function$;
revoke all on function public.finish_operational_notification_job(uuid,uuid,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.finish_operational_notification_job(uuid,uuid,boolean,text,integer) to postgres,service_role;

-- Manager pushes cross the same non-transactional provider boundary as employee
-- pushes. An unreadable 2xx or transport loss may already represent an accepted
-- FCM request, so it is terminal outcome-unknown and can never be requeued.
alter table public.ops_manager_notification_queue
  add column dispatch_lease_token uuid,
  add column dispatch_push_device_id uuid,
  add column dispatch_fcm_token_sha256 text,
  add column dispatch_started_at timestamptz,
  add constraint ops_manager_notification_queue_dispatch_binding check (
    (dispatch_lease_token is null and dispatch_push_device_id is null
      and dispatch_fcm_token_sha256 is null and dispatch_started_at is null)
    or (dispatch_lease_token is not null and dispatch_push_device_id is not null
      and dispatch_fcm_token_sha256 ~ '^[0-9a-f]{64}$' and dispatch_started_at is not null)
  );

-- A prepared provider boundary is never reclaimed. If its worker disappears,
-- the provider result is unknowable and at-most-once delivery requires a
-- terminal record rather than another FCM call.
create or replace function public.ops_manager_claim_notification_jobs(
  p_worker_id text,p_limit integer default 20,p_lease_seconds integer default 120
) returns setof public.ops_manager_notification_queue language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception using errcode='22023',message='worker id is required'; end if;
  update public.ops_manager_notification_queue q set status='failed',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
    provider_message_id=null,last_error='provider delivery outcome unknown after manager notification worker interruption',updated_at=now()
  where q.status='leased' and q.leased_until<now() and q.dispatch_started_at is not null;
  update public.ops_manager_notification_queue q set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
    last_error='notification recipient authority is no longer current',updated_at=now()
  where (q.status='pending' or (q.status='leased' and q.leased_until<now()))
    and q.dispatch_started_at is null
    and not public.custodial_ops_manager_notification_recipient_is_current(q.credential_id,q.manager_id,now());
  update public.ops_manager_notification_queue q set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
    last_error='event occurrence is no longer upcoming',updated_at=now()
  where q.notification_type='event_digest' and (q.status='pending' or (q.status='leased' and q.leased_until<now()))
    and q.dispatch_started_at is null
    and not exists (
      select 1 from public.events_app_events e
      where e.id=case when coalesce(q.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (q.data_json->>'next_event_id')::uuid else null end
        and e.status='SCHEDULED'
        and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
        and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=q.data_json->'next_event_starts_at'
    );
  update public.ops_manager_notification_queue q set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
    last_error='location dashboard state has changed',updated_at=now()
  where q.notification_type='location_digest' and (q.status='pending' or (q.status='leased' and q.leased_until<now()))
    and q.dispatch_started_at is null
    and not public.custodial_ops_manager_location_digest_is_current(q.credential_id,q.data_json->>'location_fingerprint');
  return query with candidates as (
    select q.queue_id from public.ops_manager_notification_queue q
    where ((q.status='pending' and q.available_at<=now()) or (q.status='leased' and q.leased_until<now()))
      and q.dispatch_started_at is null and q.attempts<q.max_attempts
      and public.custodial_ops_manager_notification_recipient_is_current(q.credential_id,q.manager_id,now())
      and (q.notification_type<>'event_digest' or exists (
        select 1 from public.events_app_events e
        where e.id=case when coalesce(q.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (q.data_json->>'next_event_id')::uuid else null end
          and e.status='SCHEDULED'
          and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
          and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=q.data_json->'next_event_starts_at'
      ))
      and (q.notification_type<>'location_digest' or public.custodial_ops_manager_location_digest_is_current(q.credential_id,q.data_json->>'location_fingerprint'))
    order by q.available_at,q.created_at,q.queue_id for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  ) update public.ops_manager_notification_queue q set status='leased',attempts=q.attempts+1,leased_at=now(),
    leased_until=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,120),900))),lease_token=gen_random_uuid(),
    worker_id=left(btrim(p_worker_id),160),updated_at=now() from candidates c where q.queue_id=c.queue_id returning q.*;
end $function$;

create function public.ops_manager_prepare_notification_dispatch(
  p_queue_id uuid,p_lease_token uuid,p_push_device_id uuid,p_fcm_token_sha256 text
) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_row public.ops_manager_notification_queue%rowtype;
begin
  if p_queue_id is null or p_lease_token is null or p_push_device_id is null
     or coalesce(p_fcm_token_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='exact manager notification lease, device, and token generation are required';
  end if;
  select * into v_row from public.ops_manager_notification_queue
  where queue_id=p_queue_id and status='leased' and lease_token=p_lease_token and leased_until>=now() for update;
  if v_row.queue_id is null or v_row.dispatch_started_at is not null then return false; end if;
  if public.ops_manager_notification_job_is_current(
    p_queue_id,p_lease_token,p_push_device_id,p_fcm_token_sha256
  ) is not true then return false; end if;
  update public.ops_manager_notification_queue set
    dispatch_lease_token=p_lease_token,dispatch_push_device_id=p_push_device_id,
    dispatch_fcm_token_sha256=p_fcm_token_sha256,dispatch_started_at=now(),updated_at=now()
  where queue_id=p_queue_id;
  return true;
end $function$;
revoke all on function public.ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ops_manager_prepare_notification_dispatch(uuid,uuid,uuid,text) to postgres,service_role;

drop function if exists public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer);
create function public.ops_manager_finish_notification_job(
  p_queue_id uuid,p_lease_token uuid,p_push_device_id uuid,p_fcm_token_sha256 text,
  p_succeeded boolean,p_provider_message_id text default null,p_error text default null,
  p_retry_seconds integer default 30,p_delivery_outcome_unknown boolean default false
) returns public.ops_manager_notification_queue language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_row public.ops_manager_notification_queue%rowtype; v_job_current boolean; v_recipient_current boolean; v_dispatch_matches boolean;
begin
  if p_succeeded and p_delivery_outcome_unknown then raise exception using errcode='22023',message='a successful manager push cannot have an unknown provider outcome'; end if;
  select * into v_row from public.ops_manager_notification_queue where queue_id=p_queue_id and status='leased' and lease_token=p_lease_token for update;
  if v_row.queue_id is null then raise exception using errcode='P0002',message='Notification job lease was not found'; end if;
  v_dispatch_matches:=v_row.dispatch_started_at is not null
    and v_row.dispatch_lease_token=p_lease_token and v_row.dispatch_push_device_id=p_push_device_id
    and v_row.dispatch_fcm_token_sha256=p_fcm_token_sha256;
  if (p_succeeded or p_delivery_outcome_unknown or v_row.dispatch_started_at is not null) and not v_dispatch_matches then
    raise exception using errcode='22023',message='manager notification dispatch preparation does not match the exact lease and provider target';
  end if;
  v_recipient_current:=public.custodial_ops_manager_notification_binding_is_current(
    p_push_device_id,v_row.credential_id,v_row.manager_id,p_fcm_token_sha256,now()
  );
  v_job_current:=v_recipient_current;
  if v_row.notification_type='event_digest' then
    select v_job_current and exists (
      select 1 from public.events_app_events e
      where e.id=case when coalesce(v_row.data_json->>'next_event_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (v_row.data_json->>'next_event_id')::uuid else null end
        and e.status='SCHEDULED' and ((e.event_date+e.start_time) at time zone 'America/Chicago')>now()
        and to_jsonb((e.event_date+e.start_time) at time zone 'America/Chicago')=v_row.data_json->'next_event_starts_at'
    ) into v_job_current;
  end if;
  if v_row.notification_type='location_digest' then
    v_job_current:=v_job_current and public.custodial_ops_manager_location_digest_is_current(v_row.credential_id,v_row.data_json->>'location_fingerprint');
  end if;
  if p_delivery_outcome_unknown then
    update public.ops_manager_notification_queue set status='failed',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
      provider_message_id=null,last_error=left('provider delivery outcome unknown: '||coalesce(p_error,'FCM response was not authoritative'),2000),updated_at=now()
    where queue_id=p_queue_id returning * into v_row;
  elsif not v_job_current then
    update public.ops_manager_notification_queue set status='cancelled',completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
      last_error=case when not v_recipient_current then 'notification recipient authority is no longer current' when v_row.notification_type='location_digest' then 'location dashboard state has changed' else 'event occurrence is no longer upcoming' end,
      updated_at=now() where queue_id=p_queue_id returning * into v_row;
  elsif p_succeeded then
    update public.ops_manager_notification_queue set status='sent',sent_at=now(),completed_at=now(),leased_until=null,lease_token=null,worker_id=null,
      provider_message_id=nullif(left(coalesce(p_provider_message_id,''),500),''),last_error=null,updated_at=now()
    where queue_id=p_queue_id returning * into v_row;
    update public.ops_manager_notification_state set last_sent_at=now(),updated_at=now()
    where credential_id=v_row.credential_id and state_key=case when v_row.notification_type='location_digest' then 'location_digest' else '__none__' end;
  else
    update public.ops_manager_notification_queue set status=case when attempts>=max_attempts then 'failed' else 'pending' end,
      available_at=case when attempts>=max_attempts then available_at else now()+make_interval(secs=>greatest(15,least(coalesce(p_retry_seconds,30),86400))) end,
      completed_at=case when attempts>=max_attempts then now() else null end,leased_until=null,lease_token=null,worker_id=null,
      dispatch_lease_token=null,dispatch_push_device_id=null,dispatch_fcm_token_sha256=null,dispatch_started_at=null,
      last_error=left(coalesce(p_error,'Notification delivery failed'),2000),updated_at=now() where queue_id=p_queue_id returning * into v_row;
  end if;
  return v_row;
end $function$;
revoke all on function public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean) to postgres,service_role;

-- This inventory is a catalog-derived superset of the native/offline authority
-- closure. It records executable definitions for functions, relation guards,
-- relational constraints, and grants rather than assuming the controller is
-- itself healthy enough to recreate its dependencies.
create table public.custodial_release_authority_restore_inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  restore_order integer not null,
  object_kind text not null check (object_kind in ('function','relation','column','column_set','constraint','index','trigger','policy','relation_state','grant')),
  object_identity text not null,
  definition_sql text not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default statement_timestamp(),
  unique(object_kind,object_identity)
);

create or replace function public.custodial_reject_release_authority_inventory_mutation()
returns trigger language plpgsql security invoker set search_path to 'pg_catalog','public'
as $function$
begin
  raise exception using errcode='55000',message='release authority restore inventory is immutable';
end
$function$;

create trigger trg_custodial_release_authority_restore_inventory_immutable
before update or delete on public.custodial_release_authority_restore_inventory
for each row execute function public.custodial_reject_release_authority_inventory_mutation();
revoke all on table public.custodial_release_authority_restore_inventory from public,anon,authenticated,service_role;

create table public.custodial_release_authority_bootstrap_definitions (
  bootstrap_key boolean primary key default true check (bootstrap_key),
  function_identity text not null,
  function_definition text not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default statement_timestamp()
);
create trigger trg_custodial_release_authority_bootstrap_definitions_immutable
before update or delete on public.custodial_release_authority_bootstrap_definitions
for each row execute function public.custodial_reject_release_authority_inventory_mutation();
revoke all on table public.custodial_release_authority_bootstrap_definitions from public,anon,authenticated,service_role;

create or replace function public.custodial_release_authority_reset_grants(p_object_identity text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_object_identity); v_function oid:=to_regprocedure(p_object_identity); v_role record; v_column record;
begin
  if v_relation is not null then
    execute format('revoke all privileges on table %s from public',v_relation::regclass);
    for v_role in
      select distinct r.rolname from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a join pg_roles r on r.oid=a.grantee
      where c.oid=v_relation and a.grantee<>c.relowner
    loop execute format('revoke all privileges on table %s from %I',v_relation::regclass,v_role.rolname); end loop;
    for v_column in
      select a.attname,x.grantee,r.rolname from pg_attribute a join pg_class c on c.oid=a.attrelid
      cross join lateral aclexplode(a.attacl) x left join pg_roles r on r.oid=x.grantee
      where c.oid=v_relation and a.attnum>0 and not a.attisdropped and a.attacl is not null and x.grantee<>c.relowner
    loop
      execute format('revoke all privileges (%I) on table %s from %s',v_column.attname,v_relation::regclass,case when v_column.grantee=0 then 'public' else quote_ident(v_column.rolname) end);
    end loop;
    return;
  end if;
  if v_function is not null then
    execute format('revoke all privileges on function %s from public',v_function::regprocedure);
    for v_role in
      select distinct r.rolname from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a join pg_roles r on r.oid=a.grantee
      where p.oid=v_function and a.grantee<>p.proowner
    loop execute format('revoke all privileges on function %s from %I',v_function::regprocedure,v_role.rolname); end loop;
    return;
  end if;
  raise exception using errcode='42704',message='release authority grant target is missing';
end
$function$;

-- Keep this renderer byte-for-byte aligned with the grant rows captured below.
-- Health derives every non-owner ACL from the catalogs, including arbitrary
-- roles and grant options. The reset helper removes unexpected future grants.
create or replace function public.custodial_release_authority_current_grant_definition(p_object_identity text)
returns text language plpgsql stable security invoker set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_object_identity); v_function oid:=to_regprocedure(p_object_identity);
begin
  if v_relation is not null then
    return (
      select 'select public.custodial_release_authority_reset_grants('||quote_literal(p_object_identity)||');'
        ||coalesce((
          select string_agg(
            ' grant '||g.privilege_type||' on table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' to '
              ||case when g.grantee=0 then 'public' else quote_ident(r.rolname) end
              ||case when g.is_grantable then ' with grant option' else '' end||';',
            '' order by g.grantee,g.privilege_type,g.is_grantable
          )
          from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g left join pg_roles r on r.oid=g.grantee
          where g.grantee<>c.relowner
        ),'')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid=v_relation
    );
  end if;
  if v_function is not null then
    return (
      select 'select public.custodial_release_authority_reset_grants('||quote_literal(p_object_identity)||');'
        ||coalesce((
          select string_agg(
            ' grant execute on function '||p.oid::regprocedure::text||' to '
              ||case when a.grantee=0 then 'public' else quote_ident(r.rolname) end
              ||case when a.is_grantable then ' with grant option' else '' end||';',
            '' order by a.grantee,a.is_grantable
          )
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          left join pg_roles r on r.oid=a.grantee
          where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
        ),'')
      from pg_proc p
      where p.oid=v_function
    );
  end if;
  return null;
end
$function$;

create or replace function public.custodial_release_authority_current_index_definition(p_object_identity text)
returns text language sql stable strict set search_path to 'pg_catalog','public'
as $function$
  select 'drop index if exists '||quote_ident(n.nspname)||'.'||quote_ident(i.relname)||'; '||pg_get_indexdef(i.oid)||';'
  from pg_class i join pg_namespace n on n.oid=i.relnamespace where i.oid=to_regclass(p_object_identity) and i.relkind='i'
$function$;

create or replace function public.custodial_release_authority_current_relation_definition(p_object_identity text)
returns text language plpgsql stable strict set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_object_identity); v_schema text; v_name text; v_kind "char"; v_persistence "char"; v_columns text;
begin
  select n.nspname,c.relname,c.relkind,c.relpersistence into v_schema,v_name,v_kind,v_persistence
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.oid=v_relation and c.relkind in ('r','p') and not c.relispartition;
  if v_schema is null then return null; end if;
  select string_agg(
    quote_ident(a.attname)||' '||format_type(a.atttypid,a.atttypmod)
      ||case when a.attcollation<>0 and a.attcollation is distinct from t.typcollation
        then ' collate '||quote_ident(cn.nspname)||'.'||quote_ident(co.collname) else '' end
      ||case
        when a.attidentity<>'' then ' generated '||case a.attidentity when 'a' then 'always' else 'by default' end||' as identity'
        when a.attgenerated<>'' then ' generated always as ('||pg_get_expr(d.adbin,d.adrelid)||') stored'
        when d.adbin is not null then ' default '||pg_get_expr(d.adbin,d.adrelid)
        else ''
      end
      ||case when a.attnotnull then ' not null' else '' end,
    E',\n  ' order by a.attname
  ) into v_columns
  from pg_attribute a
  join pg_type t on t.oid=a.atttypid
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  left join pg_collation co on co.oid=a.attcollation
  left join pg_namespace cn on cn.oid=co.collnamespace
  where a.attrelid=v_relation and a.attnum>0 and not a.attisdropped;
  return 'create '||case when v_persistence='u' then 'unlogged ' else '' end||'table if not exists '
    ||quote_ident(v_schema)||'.'||quote_ident(v_name)||E' (\n  '||coalesce(v_columns,'')||E'\n)'
    ||case when v_kind='p' then ' partition by '||pg_get_partkeydef(v_relation) else '' end||';';
end
$function$;

create or replace function public.custodial_release_authority_restore_column(
  p_relation_identity text,p_column_name text,p_data_type text,p_collation_identity text,
  p_identity_kind text,p_generated_kind text,p_expression text,p_not_null boolean
) returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare
  v_relation oid:=to_regclass(p_relation_identity); v_current record; v_target_type text;
  v_declaration text; v_expected_identity text:=coalesce(p_identity_kind,'');
  v_expected_generated text:=coalesce(p_generated_kind,'');
begin
  if v_relation is null then raise exception using errcode='42704',message='release authority column relation is missing'; end if;
  if p_column_name is null or p_column_name='' or p_data_type is null or p_data_type='' then
    raise exception using errcode='22023',message='release authority column definition is incomplete';
  end if;
  v_target_type:=p_data_type||case when p_collation_identity is null then '' else ' collate '||p_collation_identity end;
  v_declaration:=quote_ident(p_column_name)||' '||v_target_type
    ||case
      when v_expected_generated<>'' then ' generated always as ('||p_expression||') stored'
      when v_expected_identity<>'' then ' generated '||case v_expected_identity when 'a' then 'always' else 'by default' end||' as identity'
      when p_expression is not null then ' default '||p_expression
      else ''
    end
    ||case when p_not_null then ' not null' else '' end;
  select format_type(a.atttypid,a.atttypmod) data_type,a.attidentity identity_kind,a.attgenerated generated_kind,
    pg_get_expr(d.adbin,d.adrelid) expression,a.attnotnull not_null,
    case when a.attcollation<>t.typcollation then quote_ident(cn.nspname)||'.'||quote_ident(co.collname) end collation_identity
  into v_current
  from pg_attribute a join pg_type t on t.oid=a.atttypid
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
  where a.attrelid=v_relation and a.attname=p_column_name and a.attnum>0 and not a.attisdropped;
  if not found then
    execute format('alter table %s add column %s',v_relation::regclass,v_declaration);
    return;
  end if;
  if v_expected_generated<>'' or coalesce(v_current.generated_kind,'')<>'' then
    if v_current.data_type=p_data_type and v_current.collation_identity is not distinct from p_collation_identity
       and coalesce(v_current.generated_kind,'')=v_expected_generated
       and v_current.expression is not distinct from p_expression and v_current.not_null=p_not_null then return; end if;
    execute format('alter table %s drop column %I cascade',v_relation::regclass,p_column_name);
    execute format('alter table %s add column %s',v_relation::regclass,v_declaration);
    return;
  end if;
  if v_current.data_type<>p_data_type or v_current.collation_identity is distinct from p_collation_identity then
    execute format('alter table %s alter column %I type %s using %I::%s',v_relation::regclass,p_column_name,v_target_type,p_column_name,p_data_type);
  end if;
  if coalesce(v_current.identity_kind,'')<>v_expected_identity then
    if coalesce(v_current.identity_kind,'')<>'' then execute format('alter table %s alter column %I drop identity if exists',v_relation::regclass,p_column_name); end if;
    if v_expected_identity<>'' then execute format('alter table %s alter column %I add generated %s as identity',v_relation::regclass,p_column_name,case v_expected_identity when 'a' then 'always' else 'by default' end); end if;
  end if;
  if v_expected_identity='' then
    execute format('alter table %s alter column %I drop default',v_relation::regclass,p_column_name);
    if p_expression is not null then execute format('alter table %s alter column %I set default %s',v_relation::regclass,p_column_name,p_expression); end if;
  end if;
  execute format('alter table %s alter column %I %s not null',v_relation::regclass,p_column_name,case when p_not_null then 'set' else 'drop' end);
end
$function$;

create or replace function public.custodial_release_authority_current_column_definition(p_object_identity text)
returns text language plpgsql stable strict set search_path to 'pg_catalog','public'
as $function$
declare
  v_relation_text text:=split_part(p_object_identity,':',1); v_column_name text:=substr(p_object_identity,position(':' in p_object_identity)+1);
  v_relation oid:=to_regclass(v_relation_text); v_row record;
begin
  select format_type(a.atttypid,a.atttypmod) data_type,a.attidentity identity_kind,a.attgenerated generated_kind,
    pg_get_expr(d.adbin,d.adrelid) expression,a.attnotnull not_null,
    case when a.attcollation<>t.typcollation then quote_ident(cn.nspname)||'.'||quote_ident(co.collname) end collation_identity
  into v_row
  from pg_attribute a join pg_type t on t.oid=a.atttypid
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
  where a.attrelid=v_relation and a.attname=v_column_name and a.attnum>0 and not a.attisdropped;
  if not found then return null; end if;
  return 'select public.custodial_release_authority_restore_column('
    ||quote_literal(v_relation_text)||','||quote_literal(v_column_name)||','||quote_literal(v_row.data_type)||','
    ||coalesce(quote_literal(v_row.collation_identity),'null')||','||quote_literal(v_row.identity_kind::text)||','||quote_literal(v_row.generated_kind::text)||','
    ||coalesce(quote_literal(v_row.expression),'null')||','||case when v_row.not_null then 'true' else 'false' end||');';
end
$function$;

create or replace function public.custodial_release_authority_restore_column_set(p_relation_identity text,p_expected_columns text[])
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_relation_identity); v_column record;
begin
  if v_relation is null then raise exception using errcode='42704',message='release authority column-set relation is missing'; end if;
  for v_column in select a.attname from pg_attribute a
    where a.attrelid=v_relation and a.attnum>0 and not a.attisdropped and not (a.attname=any(p_expected_columns))
    order by a.attname
  loop execute format('alter table %s drop column %I cascade',v_relation::regclass,v_column.attname); end loop;
end
$function$;

create or replace function public.custodial_release_authority_current_column_set_definition(p_relation_identity text)
returns text language plpgsql stable strict set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_relation_identity); v_columns text;
begin
  if v_relation is null then return null; end if;
  select string_agg(quote_literal(a.attname),',' order by a.attname) into v_columns
  from pg_attribute a where a.attrelid=v_relation and a.attnum>0 and not a.attisdropped;
  return 'select public.custodial_release_authority_restore_column_set('||quote_literal(p_relation_identity)
    ||',array['||coalesce(v_columns,'')||']::text[]);';
end
$function$;

create or replace function public.custodial_release_authority_current_relation_state_definition(p_object_identity text)
returns text language sql stable strict set search_path to 'pg_catalog','public'
as $function$
  select 'alter table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '||case when c.relrowsecurity then 'enable' else 'disable' end||' row level security; alter table '
    ||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' '||case when c.relforcerowsecurity then 'force' else 'no force' end||' row level security;'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid=to_regclass(p_object_identity) and c.relkind in ('r','p')
$function$;

create or replace function public.custodial_release_authority_current_policy_definition(p_object_identity text)
returns text language plpgsql stable strict set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(split_part(p_object_identity,':',1)); v_policy text:=substr(p_object_identity,position(':' in p_object_identity)+1);
begin
  return (
    select 'drop policy if exists '||quote_ident(p.polname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||'; create policy '
      ||quote_ident(p.polname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' as '||case when p.polpermissive then 'permissive' else 'restrictive' end
      ||' for '||case p.polcmd when '*' then 'all' when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' end
      ||' to '||(select string_agg(case when role_oid=0 then 'public' else quote_ident(r.rolname) end,',' order by role_oid) from unnest(p.polroles) role_oid left join pg_roles r on r.oid=role_oid)
      ||case when p.polqual is null then '' else ' using ('||pg_get_expr(p.polqual,p.polrelid)||')' end
      ||case when p.polwithcheck is null then '' else ' with check ('||pg_get_expr(p.polwithcheck,p.polrelid)||')' end||';'
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where p.polrelid=v_relation and p.polname=v_policy
  );
end
$function$;

create or replace function public.custodial_release_authority_restore_constraint(p_relation_identity text,p_constraint_name text,p_constraint_definition text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_relation_identity); v_current text;
begin
  if v_relation is null then raise exception using errcode='42704',message='release authority constraint relation is missing'; end if;
  select pg_get_constraintdef(c.oid,true) into v_current from pg_constraint c where c.conrelid=v_relation and c.conname=p_constraint_name;
  if v_current is null then
    execute format('alter table %s add constraint %I %s',v_relation::regclass,p_constraint_name,p_constraint_definition);
  elsif v_current<>p_constraint_definition then
    execute format('alter table %s drop constraint %I cascade',v_relation::regclass,p_constraint_name);
    execute format('alter table %s add constraint %I %s',v_relation::regclass,p_constraint_name,p_constraint_definition);
  end if;
end
$function$;

create or replace function public.custodial_release_authority_current_constraint_definition(p_object_identity text)
returns text language plpgsql stable strict set search_path to 'pg_catalog','public'
as $function$
declare v_relation_text text:=split_part(p_object_identity,':',1); v_relation oid:=to_regclass(v_relation_text); v_constraint text:=substr(p_object_identity,position(':' in p_object_identity)+1); v_definition text;
begin
  select pg_get_constraintdef(c.oid,true) into v_definition from pg_constraint c where c.conrelid=v_relation and c.conname=v_constraint;
  if v_definition is null then return null; end if;
  return 'select public.custodial_release_authority_restore_constraint('||quote_literal(v_relation_text)||','||quote_literal(v_constraint)||','||quote_literal(v_definition)||');';
end
$function$;

-- Approved terminal-writer names are exempt only at their exact signatures in
-- the health function below. Mark every overload by name so a wrapper that only
-- delegates to an exact writer cannot evade the catalog-derived inventory.
create or replace view public.custodial_terminal_writer_inventory as
select p.oid,p.oid::regprocedure::text as routine_identity,p.proname,
  p.prorettype <> 'pg_catalog.trigger'::regtype and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')) as application_callable,
  lower(pg_get_functiondef(p.oid)) as definition,
  (lower(pg_get_functiondef(p.oid)) ~ '(insert[[:space:]]+into|update|delete[[:space:]]+from|truncate([[:space:]]+table)?)' and lower(pg_get_functiondef(p.oid)) ~ 'public[.]?(sessions|completion_responses|scan_events|maintenance_tickets)') as mutates_terminal_truth,
  (p.proname like 'demo_scan_mock_%'
    or p.proname='custodial_finish_historical_session_authoritative'
    or lower(pg_get_functiondef(p.oid)) ~ 'public[.]demo_scan_mock_[a-z0-9_]*[[:space:]]*[(]'
    or lower(pg_get_functiondef(p.oid)) ~ 'public[.](purge_closed_scan_history_before|tool_purge_closed_scan_history_before|close_maintenance_ticket|tool_close_maintenance_ticket|force_close_session|tool_force_close_session|start_session|tool_start_session|finish_session|tool_finish_session|complete_session|tool_complete_session|record_scan_event|tool_record_scan_event)[[:space:]]*[(]') as delegates_alternate_terminal_authority
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';

-- This is the reviewed canary-authority root surface, independent of the
-- name-based catalog capture below. It is intentionally narrower than the
-- public application schema. Catalog capture expands these exact roots through
-- relation and trigger dependencies, while health proves every root is live and
-- represented in that larger recovery inventory.
create or replace function public.custodial_release_canary_authority_surface()
returns table(object_kind text,object_identity text,purpose text)
language sql immutable set search_path to 'pg_catalog','public'
as $function$
  values
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
    ('function','ops_manager_finish_notification_job(uuid,uuid,uuid,text,boolean,text,text,integer,boolean)','manager push dispatch completion');
$function$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_missing text[]; v_mismatched text[]; v_surface_missing text[]; v_surface_uncovered text[]; v_checks jsonb; v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select array_agg(s.object_identity order by s.object_kind,s.object_identity) into v_surface_missing
  from public.custodial_release_canary_authority_surface() s
  where (s.object_kind='function' and to_regprocedure(s.object_identity) is null)
     or (s.object_kind='relation' and to_regclass(s.object_identity) is null);
  select array_agg(s.object_identity order by s.object_kind,s.object_identity) into v_surface_uncovered
  from public.custodial_release_canary_authority_surface() s
  where not exists(
    select 1 from public.custodial_release_authority_restore_inventory i
    where i.object_kind=s.object_kind and i.object_identity=s.object_identity
  );
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_missing
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is null)
     or (i.object_kind='relation' and public.custodial_release_authority_current_relation_definition(i.object_identity) is null)
     or (i.object_kind='column' and public.custodial_release_authority_current_column_definition(i.object_identity) is null)
     or (i.object_kind='column_set' and public.custodial_release_authority_current_column_set_definition(i.object_identity) is null)
     or (i.object_kind='constraint' and public.custodial_release_authority_current_constraint_definition(i.object_identity) is null)
     or (i.object_kind='index' and public.custodial_release_authority_current_index_definition(i.object_identity) is null)
     or (i.object_kind='trigger' and not exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal))
     or (i.object_kind='policy' and public.custodial_release_authority_current_policy_definition(i.object_identity) is null)
     or (i.object_kind='relation_state' and public.custodial_release_authority_current_relation_state_definition(i.object_identity) is null)
     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_mismatched
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is not null and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex')<>i.definition_sha256)
     or (i.object_kind='relation' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_relation_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='column' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_column_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='column_set' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_column_set_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='constraint' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_constraint_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='index' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_index_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='trigger' and exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal and encode(extensions.digest(convert_to('drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';','UTF8'),'sha256'),'hex')<>i.definition_sha256))
     or (i.object_kind='policy' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_policy_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='relation_state' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_relation_state_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='grant' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256);
  v_checks:=jsonb_build_object(
    'restore_inventory_present',(select count(*)>40 from public.custodial_release_authority_restore_inventory),
    'restore_inventory_exact',coalesce(cardinality(v_missing),0)=0 and coalesce(cardinality(v_mismatched),0)=0,
    'canary_authority_surface_live',coalesce(cardinality(v_surface_missing),0)=0,
    'canary_authority_surface_captured',coalesce(cardinality(v_surface_uncovered),0)=0,
    'bootstrap_controller_seed_present',exists(select 1 from public.custodial_release_authority_bootstrap_definitions),
    'authority_activation_history',to_regclass('public.custodial_offline_authority_activation_events') is not null
      and to_regprocedure('public.custodial_offline_authority_active_at(text,uuid,timestamptz)') is not null,
    'completion_uuid_constraints',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_reconciliation_records'::regclass and conname='custodial_offline_reconciliation_client_completion_id_uuid')
      and exists(select 1 from pg_constraint where conrelid='public.completion_responses'::regclass and conname='completion_responses_client_completion_id_uuid'),
    'native_finish_scan_authority',exists(
      select 1 from pg_attribute
      where attrelid='public.custodial_offline_actor_contexts'::regclass
        and attname='native_finish_scan_entry_id' and attnum>0 and not attisdropped
    )
      and exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='custodial_offline_native_completion_evidence_check')
      and exists(select 1 from pg_constraint where conrelid='public.custodial_offline_actor_contexts'::regclass and conname='uq_custodial_offline_native_finish_scan_entry')
      and to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)') is not null
      and to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text)') is null
      and not has_function_privilege('anon','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)','EXECUTE'),
    'offline_evidence_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_offline_actor_contexts','insert')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','insert')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','insert')
    ),
    'authority_column_grants_absent',not exists(
      select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null
    ),
    'alternate_terminal_writers_absent',not exists(
      select 1 from public.custodial_terminal_writer_inventory i
      where i.application_callable and (i.mutates_terminal_truth or i.delegates_alternate_terminal_authority)
        and i.oid is distinct from to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.custodial_finish_historical_session_authoritative(text,text,uuid,timestamptz,text)')
    ),
    'generic_terminal_writer_execute_denied',not exists(
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session',
        'purge_closed_scan_history_before','tool_purge_closed_scan_history_before'
      ) and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))
    ),
    'native_timestamp_renderer',public.custodial_canonical_utc_millis('2026-08-13 12:34:56.789123+00'::timestamptz)='2026-08-13T12:34:56.789Z'
  );
  select bool_and(value::boolean) into v_ok from jsonb_each_text(v_checks);
  return jsonb_build_object(
    'ok',coalesce(v_ok,false),'authority','offline-authority.v5',
    'canonical_objects_expected',(select count(*) from public.custodial_release_authority_restore_inventory),
    'canary_surface_objects_expected',(select count(*) from public.custodial_release_canary_authority_surface()),
    'missing_objects',to_jsonb(coalesce(v_missing,array[]::text[])),
    'mismatched_objects',to_jsonb(coalesce(v_mismatched,array[]::text[])),
    'surface_missing_objects',to_jsonb(coalesce(v_surface_missing,array[]::text[])),
    'surface_uncovered_objects',to_jsonb(coalesce(v_surface_uncovered,array[]::text[])),
    'checks',v_checks
  );
end
$function$;

create or replace function public.custodial_control_release_canary(
  p_manager_id uuid,p_request_id uuid,p_device_identifier text,p_action text,p_reason text,p_authoritative_health jsonb,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_device text:=upper(btrim(coalesce(p_device_identifier,''))); v_existing public.custodial_release_canary_rollback_audits%rowtype;
  v_entry public.custodial_release_authority_restore_inventory%rowtype; v_entries public.custodial_release_authority_restore_inventory[]; v_result jsonb; v_restored integer:=0;
  v_secret_digest text; v_health jsonb; v_transport jsonb;
begin
  select execution_secret_digest into v_secret_digest from public.custodial_backend_execution_config where config_key=true and enabled=true;
  if v_secret_digest is null or length(coalesce(p_backend_execution_secret,''))<32 or encode(extensions.digest(convert_to(p_backend_execution_secret,'UTF8'),'sha256'),'hex')<>v_secret_digest then raise exception using errcode='42501',message='backend execution secret is not authorized'; end if;
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='named release manager authority is required'; end if;
  if p_request_id is null or v_device !~ '^KIOSK_(0[2-9]|10)$' or p_action not in ('pause_canary','resume_canary','restore_authority') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_authoritative_health)<>'object' then raise exception using errcode='22023',message='stable request, exact canary, supported action, reason, and authority health are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-release-canary:'||v_device,0));
  select * into v_existing from public.custodial_release_canary_rollback_audits where requested_by_manager_id=p_manager_id and request_id=p_request_id for update;
  if found then
    if v_existing.device_identifier<>v_device or v_existing.action<>p_action or v_existing.reason<>btrim(p_reason) or v_existing.authoritative_health<>p_authoritative_health then raise exception using errcode='23505',message='release control request identity is already bound to different inputs'; end if;
    return v_existing.result_json||jsonb_build_object('audit_id',v_existing.audit_id,'replayed',true);
  end if;
  if p_action='pause_canary' then
    insert into public.custodial_release_canary_controls(device_identifier,paused,updated_by_manager_id,reason,last_transport_probe_id) values(v_device,true,p_manager_id,btrim(p_reason),null) on conflict(device_identifier) do update set paused=true,updated_at=statement_timestamp(),updated_by_manager_id=excluded.updated_by_manager_id,reason=excluded.reason,last_transport_probe_id=null;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_objects',0);
  elsif p_action='restore_authority' then
    if not coalesce((select paused from public.custodial_release_canary_controls where device_identifier=v_device),false) then raise exception using errcode='55000',message='the exact release canary must be paused before authority restoration'; end if;
    select array_agg(i order by i.restore_order,i.object_identity) into v_entries from public.custodial_release_authority_restore_inventory i;
    foreach v_entry in array v_entries loop
      if encode(extensions.digest(convert_to(v_entry.definition_sql,'UTF8'),'sha256'),'hex')<>v_entry.definition_sha256 then raise exception using errcode='23514',message='a captured authority restoration definition failed its digest'; end if;
      execute v_entry.definition_sql; v_restored:=v_restored+1;
    end loop;
    update public.custodial_release_canary_controls set updated_at=statement_timestamp(),updated_by_manager_id=p_manager_id,reason=btrim(p_reason),last_transport_probe_id=null where device_identifier=v_device;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_objects',v_restored);
  else
    v_health:=public.custodial_run_release_canary_recovery_probe(v_device,p_backend_execution_secret);
    if coalesce((v_health->>'passed')::boolean,false) is not true then raise exception using errcode='55000',message='fresh persisted database recovery probe is green before canary resume'; end if;
    v_transport:=public.custodial_get_release_canary_transport_probe_health(v_device,p_authoritative_health#>>'{scan_rpc_transport,backend_commit_sha}',p_authoritative_health#>>'{scan_rpc_transport,release_id}',p_backend_execution_secret);
    if coalesce((v_transport->>'ready')::boolean,false) is not true then raise exception using errcode='55000',message='fresh native phone transport proof is required before canary resume'; end if;
    update public.custodial_release_canary_controls set paused=false,updated_at=statement_timestamp(),updated_by_manager_id=p_manager_id,reason=btrim(p_reason),last_transport_probe_id=(v_transport->>'probe_id')::uuid where device_identifier=v_device and paused=true;
    if not found then raise exception using errcode='55000',message='the exact release canary must be paused before resume'; end if;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',false,'restored_objects',0,'verified_authoritative_health',v_health,'verified_transport_health',v_transport);
  end if;
  insert into public.custodial_release_canary_rollback_audits(requested_by_manager_id,request_id,device_identifier,action,reason,authoritative_health,result_json) values(p_manager_id,p_request_id,v_device,p_action,btrim(p_reason),p_authoritative_health,v_result) returning audit_id into v_existing.audit_id;
  return v_result||jsonb_build_object('audit_id',v_existing.audit_id,'replayed',false);
end
$function$;

insert into public.custodial_release_authority_bootstrap_definitions(bootstrap_key,function_identity,function_definition,definition_sha256)
select true,'public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)',pg_get_functiondef('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure),encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex');

create or replace function public.custodial_bootstrap_restore_release_authority(
  p_manager_id uuid,p_request_id uuid,p_device_identifier text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_definition public.custodial_release_authority_bootstrap_definitions%rowtype; v_device text:=upper(btrim(coalesce(p_device_identifier,''))); v_secret_digest text;
begin
  select execution_secret_digest into v_secret_digest from public.custodial_backend_execution_config where config_key=true and enabled=true;
  if v_secret_digest is null or length(coalesce(p_backend_execution_secret,''))<32 or encode(extensions.digest(convert_to(p_backend_execution_secret,'UTF8'),'sha256'),'hex')<>v_secret_digest then raise exception using errcode='42501',message='backend execution secret is not authorized'; end if;
  if p_request_id is null or v_device !~ '^KIOSK_(0[2-9]|10)$' or not coalesce((select paused from public.custodial_release_canary_controls where device_identifier=v_device),false) then raise exception using errcode='55000',message='the exact release canary must be paused before bootstrap restoration'; end if;
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then raise exception using errcode='42501',message='named release manager authority is required'; end if;
  select * into v_definition from public.custodial_release_authority_bootstrap_definitions where bootstrap_key=true;
  if v_definition.function_identity is null or encode(extensions.digest(convert_to(v_definition.function_definition,'UTF8'),'sha256'),'hex')<>v_definition.definition_sha256 then raise exception using errcode='23514',message='bootstrap controller definition failed its digest'; end if;
  execute v_definition.function_definition;
  execute 'revoke all on function public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated,service_role';
  execute 'grant execute on function public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text) to postgres,service_role';
  return jsonb_build_object('restored_controller',v_definition.function_identity,'canary_paused',true,'request_id',p_request_id);
end
$function$;

revoke all on function public.custodial_bootstrap_restore_release_authority(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.custodial_bootstrap_restore_release_authority(uuid,uuid,text,text) to postgres,service_role;

do $authority_column_acl_preflight$
begin
  if exists(
    select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null
  ) then raise exception 'explicit authority-column grants require reviewed reconciliation before U4 capture'; end if;
end
$authority_column_acl_preflight$;

with recursive authority_relations as (
  select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (
    c.relname like 'custodial_%'
    or c.relname like '%notification%'
    or c.relname like '%push%'
    or c.relname in ('devices','locations','device_auth_credentials','sessions','completion_responses','maintenance_tickets','scan_events',
      'employee_push_registrations','employee_native_push_delivery_receipts','event_push_instances','events_app_events','operational_notification_jobs')
    or quote_ident(n.nspname)||'.'||quote_ident(c.relname) in (
      select s.object_identity from public.custodial_release_canary_authority_surface() s where s.object_kind='relation'
    )
  )
  union
  select peer.oid,pn.nspname,peer.relname
  from authority_relations r
  join pg_constraint fk on fk.contype='f' and (fk.conrelid=r.oid or fk.confrelid=r.oid)
  join pg_class peer on peer.oid=case when fk.conrelid=r.oid then fk.confrelid else fk.conrelid end
  join pg_namespace pn on pn.oid=peer.relnamespace
  where pn.nspname='public' and peer.relkind in ('r','p')
), authority_functions as (
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname like 'custodial_%'
    or p.proname like '%notification%'
    or p.proname like '%push%'
    or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative',
      'mz_resolve_employee_push_delivery','mz_record_employee_push_delivery','mz_claim_employee_event_push_delivery','mz_record_employee_event_push_delivery',
      'mz_register_employee_push','mz_mark_employee_event_opened','mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes',
      'mz_get_employee_native_push_delivery_receipt','mz_prepare_employee_native_push_delivery','mz_record_employee_native_push_delivery',
      'finish_operational_notification_job','finish_operational_notification_job_terminal')
    or p.oid::regprocedure::text in (
      select s.object_identity from public.custodial_release_canary_authority_surface() s where s.object_kind='function'
    )
  )
  union
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_trigger t
  join authority_relations r on r.oid=t.tgrelid
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace
  where not t.tgisinternal and n.nspname='public'
), inventory_rows as (
  select 1000+row_number() over(order by r.relname)::integer restore_order,'relation'::text object_kind,
    quote_ident(r.nspname)||'.'||quote_ident(r.relname) object_identity,
    public.custodial_release_authority_current_relation_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)) definition_sql
  from authority_relations r
  union all
  select 100000+row_number() over(order by proname,args)::integer,'function',
    oid::regprocedure::text object_identity,pg_get_functiondef(oid) definition_sql from authority_functions
  union all
  select 200000+row_number() over(order by r.relname,a.attname)::integer,'column',
    quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||a.attname,
    public.custodial_release_authority_current_column_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||a.attname)
  from authority_relations r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
  union all
  select 300000+row_number() over(order by r.relname)::integer,'column_set',quote_ident(r.nspname)||'.'||quote_ident(r.relname),
    public.custodial_release_authority_current_column_set_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)) from authority_relations r
  union all
  select 400000+row_number() over(order by r.relname)::integer,'relation_state',quote_ident(r.nspname)||'.'||quote_ident(r.relname),
    public.custodial_release_authority_current_relation_state_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)) from authority_relations r
  union all
  select 500000+row_number() over(order by case c.contype when 'p' then 1 when 'u' then 2 when 'f' then 3 else 4 end,r.relname,c.conname)::integer,
    'constraint',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname,
    public.custodial_release_authority_current_constraint_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname)
  from pg_constraint c join authority_relations r on r.oid=c.conrelid
  union all
  select 600000+row_number() over(order by r.relname,i.relname)::integer,'index',quote_ident(ns.nspname)||'.'||quote_ident(i.relname),
    public.custodial_release_authority_current_index_definition(quote_ident(ns.nspname)||'.'||quote_ident(i.relname))
  from pg_index ix join authority_relations r on r.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace ns on ns.oid=i.relnamespace
  where not exists(select 1 from pg_constraint c where c.conindid=ix.indexrelid)
  union all
  select 700000+row_number() over(order by r.relname,t.tgname)::integer,'trigger',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
    'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '
      ||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
  from pg_trigger t join authority_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 800000+row_number() over(order by r.relname,p.polname)::integer,'policy',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname,
    public.custodial_release_authority_current_policy_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname)
  from pg_policy p join authority_relations r on r.oid=p.polrelid
  union all
  select 900000+row_number() over(order by nspname,relname)::integer,'grant',quote_ident(nspname)||'.'||quote_ident(relname),
    public.custodial_release_authority_current_grant_definition(quote_ident(nspname)||'.'||quote_ident(relname))
  from authority_relations r
)
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select restore_order,object_kind,object_identity,definition_sql,encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex') from inventory_rows;

-- Function EXECUTE grants are generated from the same dependency-closed set as
-- the definitions so trigger helpers cannot drift outside the recovery proof.
with recursive authority_relations as (
  select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (
    c.relname like 'custodial_%'
    or c.relname like '%notification%'
    or c.relname like '%push%'
    or c.relname in ('devices','locations','device_auth_credentials','sessions','completion_responses','maintenance_tickets','scan_events',
      'employee_push_registrations','employee_native_push_delivery_receipts','event_push_instances','events_app_events','operational_notification_jobs')
    or quote_ident(n.nspname)||'.'||quote_ident(c.relname) in (
      select s.object_identity from public.custodial_release_canary_authority_surface() s where s.object_kind='relation'
    )
  )
  union
  select peer.oid,pn.nspname,peer.relname
  from authority_relations r
  join pg_constraint fk on fk.contype='f' and (fk.conrelid=r.oid or fk.confrelid=r.oid)
  join pg_class peer on peer.oid=case when fk.conrelid=r.oid then fk.confrelid else fk.conrelid end
  join pg_namespace pn on pn.oid=peer.relnamespace
  where pn.nspname='public' and peer.relkind in ('r','p')
), authority_functions as (
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname like 'custodial_%'
    or p.proname like '%notification%'
    or p.proname like '%push%'
    or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative',
      'mz_resolve_employee_push_delivery','mz_record_employee_push_delivery','mz_claim_employee_event_push_delivery','mz_record_employee_event_push_delivery',
      'mz_register_employee_push','mz_mark_employee_event_opened','mz_enqueue_employee_event_pushes','mz_enqueue_employee_location_pushes',
      'mz_get_employee_native_push_delivery_receipt','mz_prepare_employee_native_push_delivery','mz_record_employee_native_push_delivery',
      'finish_operational_notification_job','finish_operational_notification_job_terminal')
    or p.oid::regprocedure::text in (
      select s.object_identity from public.custodial_release_canary_authority_surface() s where s.object_kind='function'
    )
  )
  union
  select p.oid from pg_trigger t join authority_relations r on r.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace where not t.tgisinternal and n.nspname='public'
  union
  select i.oid from public.custodial_terminal_writer_inventory i
  where i.mutates_terminal_truth or i.delegates_alternate_terminal_authority
  union
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session',
    'purge_closed_scan_history_before','tool_purge_closed_scan_history_before'
  )
)
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select 1000000+row_number() over(order by function_identity),'grant',function_identity,
  grant_sql,encode(extensions.digest(convert_to(grant_sql,'UTF8'),'sha256'),'hex')
from (
  select p.oid::regprocedure::text function_identity,
    public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text) grant_sql
  from pg_proc p join authority_functions f on f.oid=p.oid
) f;

-- The bootstrap path is intentionally outside the mutable closure inventory.
-- Refresh the controller seed after its final definition has been captured.
alter table public.custodial_release_authority_bootstrap_definitions disable trigger trg_custodial_release_authority_bootstrap_definitions_immutable;
update public.custodial_release_authority_bootstrap_definitions
set function_definition=pg_get_functiondef('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure),
    definition_sha256=encode(extensions.digest(convert_to(pg_get_functiondef('public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex'),captured_at=statement_timestamp()
where bootstrap_key=true;
alter table public.custodial_release_authority_bootstrap_definitions enable trigger trg_custodial_release_authority_bootstrap_definitions_immutable;

commit;
