begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Forward-only convergence for the native finish-scan authority added to the
-- preserved 20260813210000 migration.  This is intentionally safe whether that
-- migration was applied before or after its local pre-outage correction.
alter table public.custodial_offline_actor_contexts
  add column if not exists native_finish_scan_entry_id uuid;
alter table public.custodial_offline_actor_contexts
  drop constraint if exists custodial_offline_native_completion_evidence_check;
alter table public.custodial_offline_actor_contexts
  add constraint custodial_offline_native_completion_evidence_check check (
    (native_completion_attestation_version is null and native_completion_attestation_sha256 is null
      and native_completed_at is null and native_finish_scan_entry_id is null)
    or (native_completion_attestation_version='custodial-native-completion.v1'
      and native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$' and native_completed_at is not null
      and native_finish_scan_entry_id is null)
    or (native_completion_attestation_version='custodial-native-completion.v2'
      and native_completion_attestation_sha256 ~ '^[0-9a-f]{64}$' and native_completed_at is not null
      and native_finish_scan_entry_id is not null)
  );
alter table public.custodial_offline_actor_contexts
  drop constraint if exists uq_custodial_offline_native_finish_scan_entry;
alter table public.custodial_offline_actor_contexts
  add constraint uq_custodial_offline_native_finish_scan_entry unique(native_finish_scan_entry_id);

drop function if exists public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text,text,text,text);
create or replace function public.tool_commit_cleaning_workflow_authoritative(
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

-- Deterministic receipt keys are the existing child/projection chain identity.
-- They remain private helpers; the runtime may invoke only the bounded begin
-- function below.
create or replace function public.static_weekly_v4_day_change_child_key(p_parent_key text,p_index integer)
returns text language sql immutable strict security invoker set search_path=pg_catalog,extensions as $function$
  select 'day-change-'||encode(extensions.digest(convert_to(p_parent_key||':'||p_index::text,'UTF8'),'sha256'),'hex')
$function$;

create or replace function public.static_weekly_v4_day_change_projection_key(p_parent_key text)
returns text language sql immutable strict security invoker set search_path=pg_catalog,extensions as $function$
  select 'projection-'||encode(extensions.digest(convert_to(p_parent_key,'UTF8'),'sha256'),'hex')
$function$;

create or replace function public.static_weekly_v4_projection_snapshot(p_projection_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $function$
  select jsonb_build_object(
    'projection_id',p.projection_id::text,
    'publication_id',p.publication_id::text,
    'version_id',p.version_id::text,
    'week_start',p.week_start::text,
    'week_end',p.week_end::text,
    'compiler_version',p.compiler_version,
    'metrics',p.metrics_json,
    'replay_digest',p.replay_digest,
    'compiled_at',p.compiled_at,
    'assignments',p.projection_envelope->'assignments'
  )
  from public.weekly_schedule_compiled_projections p
  where p.projection_id=p_projection_id
$function$;

create or replace function public.static_weekly_v4_begin_day_changes(
  p_service_date date,p_week_start date,p_base_version_id uuid,p_publication_id uuid,
  p_operations jsonb,p_expected_revision bigint,p_manager_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $function$
declare
  v_actor jsonb; v_child public.weekly_schedule_command_receipts%rowtype;
  v_projection public.weekly_schedule_command_receipts%rowtype; v_projection_row public.weekly_schedule_compiled_projections%rowtype;
  v_operation jsonb; v_expected jsonb; v_mutations jsonb:='[]'::jsonb; v_snapshot jsonb;
  v_child_count integer:=0; v_requested_count integer; v_index integer; v_key text; v_expected_command text;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_actor:=public.static_weekly_v3_manager_actor(p_manager_id);
  if p_service_date is null or p_week_start is null or extract(isodow from p_week_start)<>1
     or p_service_date<p_week_start or p_service_date>p_week_start+6
     or p_base_version_id is null or p_publication_id is null or p_expected_revision is null or p_expected_revision<0
     or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null or length(btrim(p_idempotency_key))>200
     or p_operations is null or jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations) not between 1 and 25 then
    raise exception using errcode='22023',message='complete bounded day-change batch identity is required';
  end if;
  p_idempotency_key:=btrim(p_idempotency_key);
  v_requested_count:=jsonb_array_length(p_operations);

  -- The same transaction lock used by every child and projection writer makes
  -- recognition, continuation, and independent-session races one serial order.
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));

  select * into v_projection from public.weekly_schedule_command_receipts r
  where r.actor_manager_id=p_manager_id
    and r.idempotency_key=public.static_weekly_v4_day_change_projection_key(p_idempotency_key);

  -- Index 25 is inspected as a sentinel beyond the maximum accepted batch so
  -- a previously longer chain can never be mistaken for a 25-item replay.
  for v_index in 0..25 loop
    v_key:=public.static_weekly_v4_day_change_child_key(p_idempotency_key,v_index);
    select * into v_child from public.weekly_schedule_command_receipts r
    where r.actor_manager_id=p_manager_id and r.idempotency_key=v_key;
    if found then
      if v_index<>v_child_count then
        raise exception using errcode='23505',message='idempotency key is bound to an incomplete day-change receipt chain';
      end if;
      v_child_count:=v_child_count+1;
    end if;
  end loop;

  if v_child_count=0 and v_projection.command_id is null then
    return jsonb_build_object('replayed',false);
  end if;
  if v_child_count<>v_requested_count or v_projection.command_id is null then
    raise exception using errcode='23505',message='idempotency key is bound to a different complete day-change batch';
  end if;

  for v_index in 0..v_requested_count-1 loop
    v_operation:=p_operations->v_index;
    select * into strict v_child from public.weekly_schedule_command_receipts r
    where r.actor_manager_id=p_manager_id
      and r.idempotency_key=public.static_weekly_v4_day_change_child_key(p_idempotency_key,v_index);
    if jsonb_typeof(v_operation)<>'object' or v_operation->>'operation' not in ('exception','cover_all') then
      raise exception using errcode='22023',message='day-change operations must use the normalized control-plane contract';
    end if;
    v_expected_command:=case when v_operation->>'operation'='exception' and v_operation->>'exceptionType'='reverse' then 'reverse_exception' else 'apply_exception' end;
    if v_operation->>'operation'='exception' then
      v_expected:=jsonb_build_object(
        'operation','apply_exception','exception_type',v_operation->>'exceptionType','service_date',p_service_date,
        'starts_at',case when v_operation->>'startsAt' is null then null else (v_operation->>'startsAt')::time end,
        'ends_at',case when v_operation->>'endsAt' is null then null else (v_operation->>'endsAt')::time end,
        'base_version_id',p_base_version_id,'publication_id',p_publication_id,'reason',v_operation->>'reason',
        'payload',v_operation->'payload','expected_revision',p_expected_revision+v_index,
        'actor_manager_id',p_manager_id,
        'reverses_exception_id',case when v_operation->>'reversesExceptionId' is null then null else (v_operation->>'reversesExceptionId')::uuid end
      );
      if (v_child.request_canonical_json-'actor_manager_name') is distinct from v_expected then
        raise exception using errcode='23505',message='idempotency key was already used for different ordered day-change inputs';
      end if;
    else
      v_expected:=jsonb_build_object(
        'operation','apply_exception','exception_type','cover_all','service_date',p_service_date,
        'starts_at',null,'ends_at',null,'base_version_id',p_base_version_id,'publication_id',p_publication_id,
        'reason',v_operation->>'reason','expected_revision',p_expected_revision+v_index,
        'actor_manager_id',p_manager_id,'reverses_exception_id',null
      );
      if (v_child.request_canonical_json-'actor_manager_name'-'payload') is distinct from v_expected
         or jsonb_typeof(v_child.request_canonical_json->'payload')<>'object'
         or (select count(*) from jsonb_object_keys(v_child.request_canonical_json->'payload'))<>1
         or jsonb_typeof(v_child.request_canonical_json#>'{payload,availability}')<>'object'
         or v_child.request_canonical_json#>>'{payload,availability,slotId}' is distinct from v_operation->>'slotId'
         or (v_operation->'shift'<>'null'::jsonb and v_child.request_canonical_json#>'{payload,availability,shift}' is distinct from v_operation->'shift') then
        raise exception using errcode='23505',message='idempotency key was already used for different ordered day-change inputs';
      end if;
    end if;
    if v_child.command_type<>v_expected_command or v_child.expected_revision<>p_expected_revision+v_index
       or v_child.request_digest<>public.static_weekly_digest_jsonb(v_child.request_canonical_json)
       or v_child.response_json->>'request_digest'<>v_child.request_digest
       or v_child.response_json->>'content_digest'<>v_child.content_digest
       or v_child.response_json->>'operation'<>v_expected_command
       or (v_child.response_json->>'revision')::bigint<>p_expected_revision+v_index+1
       or v_child.response_json#>>'{data,sequence}'<>(p_expected_revision+v_index+1)::text
       or v_child.response_json#>>'{data,service_date}'<>p_service_date::text
       or v_child.response_json->>'output_digest'<>public.static_weekly_digest_jsonb(v_child.response_json-'output_digest')
       or v_child.response_digest<>v_child.response_json->>'output_digest'
       or not exists(
         select 1 from public.weekly_schedule_authority_revisions a
         where a.command_id=v_child.command_id and a.authority_revision=p_expected_revision+v_index+1
           and a.operation=v_expected_command and a.actor_manager_id=p_manager_id and a.content_digest=v_child.content_digest
       ) then
      raise exception using errcode='23505',message='idempotency key is bound to an invalid day-change receipt chain';
    end if;
    v_mutations:=v_mutations||jsonb_build_array(v_child.response_json->'data');
  end loop;

  if v_projection.command_type<>'materialize_projection'
     or v_projection.expected_revision<>p_expected_revision+v_requested_count
     or v_projection.request_canonical_json->>'operation'<>'materialize_projection'
     or v_projection.request_canonical_json->>'publication_id'<>p_publication_id::text
     or v_projection.request_canonical_json->>'service_date'<>p_week_start::text
     or v_projection.request_canonical_json->>'actor_manager_id'<>p_manager_id::text
     or (v_projection.request_canonical_json->>'expected_revision')::bigint<>p_expected_revision+v_requested_count
     or v_projection.request_digest<>public.static_weekly_digest_jsonb(v_projection.request_canonical_json)
     or v_projection.response_json->>'request_digest'<>v_projection.request_digest
     or v_projection.response_json->>'content_digest'<>v_projection.content_digest
     or v_projection.response_json->>'operation'<>'materialize_projection'
     or (v_projection.response_json->>'revision')::bigint<>p_expected_revision+v_requested_count+1
     or v_projection.response_json->>'output_digest'<>public.static_weekly_digest_jsonb(v_projection.response_json-'output_digest')
     or v_projection.response_digest<>v_projection.response_json->>'output_digest'
     or not exists(
       select 1 from public.weekly_schedule_authority_revisions a
       where a.command_id=v_projection.command_id and a.authority_revision=p_expected_revision+v_requested_count+1
         and a.operation='materialize_projection' and a.actor_manager_id=p_manager_id and a.content_digest=v_projection.content_digest
     ) then
    raise exception using errcode='23505',message='idempotency key is bound to an invalid final projection receipt';
  end if;

  begin
    select * into strict v_projection_row from public.weekly_schedule_compiled_projections p
    where p.projection_id=(v_projection.response_json#>>'{data,projection_id}')::uuid;
  exception when no_data_found or too_many_rows then
    raise exception using errcode='23505',message='idempotency key is bound to a missing immutable projection';
  end;
  if v_projection_row.publication_id<>p_publication_id or v_projection_row.version_id<>p_base_version_id
     or v_projection_row.week_start<>p_week_start or v_projection_row.compiled_by_manager_id<>p_manager_id
     or v_projection_row.replay_digest<>v_projection.response_json#>>'{data,replay_digest}' then
    raise exception using errcode='23505',message='idempotency key is bound to a different immutable projection';
  end if;
  v_snapshot:=public.static_weekly_v4_projection_snapshot(v_projection_row.projection_id);
  if v_snapshot is null then
    raise exception using errcode='23505',message='idempotency key is bound to a missing immutable projection';
  end if;
  return jsonb_build_object(
    'replayed',true,
    'response',v_projection.response_json||jsonb_build_object(
      'operation','apply_day_changes',
      'data',(v_projection.response_json->'data')||jsonb_build_object('current_projection',v_snapshot,'mutations',v_mutations)
    )
  );
end
$function$;

create or replace function public.static_weekly_v4_day_changes_health()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare v_ready boolean;
begin
  perform public.static_weekly_v3_assert_control_plane();
  v_ready:=to_regprocedure('public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)') is not null
    and to_regprocedure('public.static_weekly_v4_day_change_child_key(text,integer)') is not null
    and to_regprocedure('public.static_weekly_v4_day_change_projection_key(text)') is not null
    and to_regprocedure('public.static_weekly_v4_projection_snapshot(uuid)') is not null
    and has_function_privilege('static_weekly_control_plane','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
    and not has_function_privilege('anon','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
    and not has_function_privilege('service_role','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE')
    and not has_function_privilege('static_weekly_release_operator','public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text)','EXECUTE');
  return jsonb_build_object('ready',v_ready,'receipt_model','deterministic_child_projection_chain.v1');
end
$function$;

revoke all on function public.static_weekly_v4_day_change_child_key(text,integer) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_day_change_projection_key(text) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_projection_snapshot(uuid) from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text) from public,anon,authenticated,service_role,static_weekly_release_operator;
grant execute on function public.static_weekly_v4_begin_day_changes(date,date,uuid,uuid,jsonb,bigint,uuid,text) to static_weekly_control_plane;
revoke all on function public.static_weekly_v4_day_changes_health() from public,anon,authenticated,service_role,static_weekly_release_operator;
grant execute on function public.static_weekly_v4_day_changes_health() to static_weekly_control_plane;

-- The existing release authority inventory and health surface are refreshed
-- below after the forward repair, so both possible 20260813210000 histories
-- converge on the same recoverable catalog.
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

-- Refresh the dependency-closed recovery inventory only after every forward
-- repair is present.  Its mutation guard is disabled solely for the bounded
-- delete; it is re-enabled before catalog capture so its own recovery entry
-- records the enforced state.
alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
delete from public.custodial_release_authority_restore_inventory;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

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
), grant_functions as (
  select f.oid from authority_functions f
  union
  select i.oid from public.custodial_terminal_writer_inventory i
  where i.mutates_terminal_truth or i.delegates_alternate_terminal_authority
  union
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'run_application_write','run_sql_write','run_sql_migration','force_close_session','tool_force_close_session',
    'purge_closed_scan_history_before','tool_purge_closed_scan_history_before'
  )
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
  union all
  select 1000000+row_number() over(order by p.oid::regprocedure::text)::integer,'grant',p.oid::regprocedure::text,
    public.custodial_release_authority_current_grant_definition(p.oid::regprocedure::text)
  from pg_proc p join grant_functions f on f.oid=p.oid
)
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select restore_order,object_kind,object_identity,definition_sql,
  encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex')
from inventory_rows;

commit;
