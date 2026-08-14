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
declare v_definition text; v_rewritten text;
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

create or replace function public.tool_commit_cleaning_workflow_authoritative(
  p_client_session_id text,p_client_completion_id text,p_device_id text,p_location_code text,
  p_client_started_at text,p_client_ended_at text,p_response_json jsonb,p_scan_evidence jsonb,
  p_correlation_id text,p_context_id text,p_submission_proof text,p_authenticated_credential_id text,
  p_native_completion_attestation_version text,p_native_completion_attestation text,
  p_native_route_proof_secret text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_completion_id uuid; v_result jsonb; v_started_at timestamptz; v_completed_at timestamptz;
begin
  begin
    v_completion_id:=lower(btrim(coalesce(p_client_completion_id,'')))::uuid;
  exception when others then
    raise exception using errcode='22023',message='p_client_completion_id must be a UUID';
  end;
  v_result:=public.custodial_commit_offline_occurrence(
    p_client_session_id,v_completion_id::text,p_device_id,p_location_code,p_client_started_at,p_client_ended_at,
    p_response_json,p_scan_evidence,p_correlation_id,p_context_id,p_submission_proof,p_authenticated_credential_id,p_backend_execution_secret
  );
  begin
    v_started_at:=nullif(v_result->>'started_at','')::timestamptz;
    v_completed_at:=nullif(coalesce(v_result->>'completed_at',v_result->>'ended_at'),'')::timestamptz;
  exception when others then
    return v_result;
  end;
  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'started_at',public.custodial_canonical_utc_millis(v_started_at),
    'ended_at',public.custodial_canonical_utc_millis(v_completed_at),
    'completed_at',public.custodial_canonical_utc_millis(v_completed_at)
  ));
end
$function$;

-- This inventory is a catalog-derived superset of the native/offline authority
-- closure. It records executable definitions for functions, relation guards,
-- relational constraints, and grants rather than assuming the controller is
-- itself healthy enough to recreate its dependencies.
create table public.custodial_release_authority_restore_inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  restore_order integer not null,
  object_kind text not null check (object_kind in ('function','constraint','trigger','grant')),
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

-- Keep this renderer byte-for-byte aligned with the grant rows captured below.
-- Health must derive the current ACL from the catalog, not re-hash inventory text.
create or replace function public.custodial_release_authority_current_grant_definition(p_object_identity text)
returns text language plpgsql stable security invoker set search_path to 'pg_catalog','public'
as $function$
declare v_relation oid:=to_regclass(p_object_identity); v_function oid:=to_regprocedure(p_object_identity);
begin
  if v_relation is not null then
    return (
      select 'revoke all on table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' from public,anon,authenticated,service_role;'
        ||coalesce((
          select string_agg(
            ' grant '||g.privilege_type||' on table '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)||' to '
              ||case when lower(g.grantee)='public' then 'public' else quote_ident(g.grantee) end||';',
            '' order by g.grantee,g.privilege_type
          )
          from information_schema.role_table_grants g
          where g.table_schema=n.nspname and g.table_name=c.relname
            and lower(g.grantee) in ('public','anon','authenticated','service_role','postgres')
        ),'')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid=v_relation
    );
  end if;
  if v_function is not null then
    return (
      select 'revoke all on function '||p.oid::regprocedure::text||' from public,anon,authenticated,service_role;'
        ||coalesce((
          select string_agg(
            ' grant execute on function '||p.oid::regprocedure::text||' to '
              ||case when a.grantee=0 then 'public' else quote_ident(r.rolname) end||';',
            '' order by a.grantee
          )
          from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          left join pg_roles r on r.oid=a.grantee
          where a.privilege_type='EXECUTE'
            and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role','postgres'))
        ),'')
      from pg_proc p
      where p.oid=v_function
    );
  end if;
  return null;
end
$function$;

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_missing text[]; v_mismatched text[]; v_checks jsonb; v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_missing
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is null)
     or (i.object_kind='constraint' and not exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(c.conname)))
     or (i.object_kind='trigger' and not exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal))
     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_mismatched
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is not null and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex')<>i.definition_sha256)
     or (i.object_kind='constraint' and exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(c.conname) and encode(extensions.digest(convert_to('alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' drop constraint if exists '||quote_ident(c.conname)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' add constraint '||quote_ident(c.conname)||' '||pg_get_constraintdef(c.oid,true)||';','UTF8'),'sha256'),'hex')<>i.definition_sha256))
     or (i.object_kind='trigger' and exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal and encode(extensions.digest(convert_to('drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||';','UTF8'),'sha256'),'hex')<>i.definition_sha256))
     or (i.object_kind='grant' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_grant_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256);
  v_checks:=jsonb_build_object(
    'restore_inventory_present',(select count(*)>40 from public.custodial_release_authority_restore_inventory),
    'restore_inventory_exact',coalesce(cardinality(v_missing),0)=0 and coalesce(cardinality(v_mismatched),0)=0,
    'bootstrap_controller_seed_present',exists(select 1 from public.custodial_release_authority_bootstrap_definitions),
    'authority_activation_history',to_regclass('public.custodial_offline_authority_activation_events') is not null
      and to_regprocedure('public.custodial_offline_authority_active_at(text,uuid,timestamptz)') is not null,
    'completion_uuid_constraints',exists(select 1 from pg_constraint where conrelid='public.custodial_offline_reconciliation_records'::regclass and conname='custodial_offline_reconciliation_client_completion_id_uuid')
      and exists(select 1 from pg_constraint where conrelid='public.completion_responses'::regclass and conname='completion_responses_client_completion_id_uuid'),
    'offline_evidence_direct_dml_denied',not (
      has_table_privilege('service_role','public.custodial_offline_actor_contexts','insert')
      or has_table_privilege('service_role','public.custodial_offline_reconciliation_records','insert')
      or has_table_privilege('service_role','public.custodial_offline_scan_event_evidence','insert')
    ),
    'native_timestamp_renderer',public.custodial_canonical_utc_millis('2026-08-13 12:34:56.789123+00'::timestamptz)='2026-08-13T12:34:56.789Z'
  );
  select bool_and(value::boolean) into v_ok from jsonb_each_text(v_checks);
  return jsonb_build_object('ok',coalesce(v_ok,false),'authority','offline-authority.v5','canonical_objects_expected',(select count(*) from public.custodial_release_authority_restore_inventory),'missing_objects',to_jsonb(coalesce(v_missing,array[]::text[])),'mismatched_objects',to_jsonb(coalesce(v_mismatched,array[]::text[])),'checks',v_checks);
end
$function$;

create or replace function public.custodial_control_release_canary(
  p_manager_id uuid,p_request_id uuid,p_device_identifier text,p_action text,p_reason text,p_authoritative_health jsonb,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_device text:=upper(btrim(coalesce(p_device_identifier,''))); v_existing public.custodial_release_canary_rollback_audits%rowtype;
  v_entry public.custodial_release_authority_restore_inventory%rowtype; v_result jsonb; v_restored integer:=0;
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
    for v_entry in select * from public.custodial_release_authority_restore_inventory order by restore_order,object_identity loop
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

with authority_functions as (
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (
    p.proname like 'custodial_%'
    or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative')
  )
), authority_relations as (
  select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (
    'devices','locations','device_auth_credentials','sessions','completion_responses','maintenance_tickets','scan_events',
    'custodial_offline_actor_contexts','custodial_offline_submission_proofs','custodial_offline_scan_authority_snapshots',
    'custodial_offline_authority_activation_events','custodial_offline_reconciliation_records','custodial_offline_reconciliation_audits',
    'custodial_offline_scan_event_evidence','custodial_offline_time_reservations','custodial_offline_reconciliation_dispositions',
    'custodial_offline_reconciliation_outbox','custodial_release_canary_controls','custodial_release_canary_transport_probes'
  )
), inventory_rows as (
  select 100+row_number() over(order by proname,args)::integer restore_order,'function'::text object_kind,
    oid::regprocedure::text object_identity,pg_get_functiondef(oid) definition_sql from authority_functions
  union all
  select 10000+row_number() over(order by r.relname,c.conname)::integer,'constraint',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(c.conname),
    'alter table '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' drop constraint if exists '||quote_ident(c.conname)||'; alter table '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' add constraint '||quote_ident(c.conname)||' '||pg_get_constraintdef(c.oid,true)||';'
  from pg_constraint c join authority_relations r on r.oid=c.conrelid
  where c.contype in ('c','x')
     or c.conname in ('custodial_offline_reconciliation_client_completion_id_uuid','completion_responses_client_completion_id_uuid')
  union all
  select 20000+row_number() over(order by r.relname,t.tgname)::integer,'trigger',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
    'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||';'
  from pg_trigger t join authority_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 30000+row_number() over(order by nspname,relname)::integer,'grant',quote_ident(nspname)||'.'||quote_ident(relname),
    'revoke all on table '||quote_ident(nspname)||'.'||quote_ident(relname)||' from public,anon,authenticated,service_role;'
    || coalesce((
      select string_agg(
        ' grant '||g.privilege_type||' on table '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' to '
        || case when lower(g.grantee)='public' then 'public' else quote_ident(g.grantee) end||';',
        '' order by g.grantee,g.privilege_type
      )
      from information_schema.role_table_grants g
      where g.table_schema=r.nspname and g.table_name=r.relname
        and lower(g.grantee) in ('public','anon','authenticated','service_role','postgres')
    ),'')
  from authority_relations r
)
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select restore_order,object_kind,object_identity,definition_sql,encode(extensions.digest(convert_to(definition_sql,'UTF8'),'sha256'),'hex') from inventory_rows;

-- Function EXECUTE grants are part of the closure and are generated separately
-- after all callable definitions so a restore cannot accidentally revive a
-- legacy writer through default ACLs.
insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
select 40000+row_number() over(order by function_identity),'grant',function_identity,
  grant_sql,encode(extensions.digest(convert_to(grant_sql,'UTF8'),'sha256'),'hex')
from (
  select p.oid::regprocedure::text function_identity,
    'revoke all on function '||p.oid::regprocedure::text||' from public,anon,authenticated,service_role;'
    || coalesce((
      select string_agg(
        ' grant execute on function '||p.oid::regprocedure::text||' to '
        || case when a.grantee=0 then 'public' else quote_ident(r.rolname) end||';',
        '' order by a.grantee
      )
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      left join pg_roles r on r.oid=a.grantee
      where a.privilege_type='EXECUTE' and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role','postgres'))
    ),'') grant_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'custodial_%' or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete',
    'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative'))
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
