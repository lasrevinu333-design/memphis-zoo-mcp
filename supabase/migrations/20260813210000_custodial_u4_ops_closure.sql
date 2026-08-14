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

-- This inventory is a catalog-derived superset of the native/offline authority
-- closure. It records executable definitions for functions, relation guards,
-- relational constraints, and grants rather than assuming the controller is
-- itself healthy enough to recreate its dependencies.
create table public.custodial_release_authority_restore_inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  restore_order integer not null,
  object_kind text not null check (object_kind in ('function','constraint','index','trigger','policy','relation_state','grant')),
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

create or replace function public.custodial_backend_authority_health(p_backend_execution_secret text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare v_missing text[]; v_mismatched text[]; v_checks jsonb; v_ok boolean;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_missing
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is null)
     or (i.object_kind='constraint' and public.custodial_release_authority_current_constraint_definition(i.object_identity) is null)
     or (i.object_kind='index' and public.custodial_release_authority_current_index_definition(i.object_identity) is null)
     or (i.object_kind='trigger' and not exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal))
     or (i.object_kind='policy' and public.custodial_release_authority_current_policy_definition(i.object_identity) is null)
     or (i.object_kind='relation_state' and public.custodial_release_authority_current_relation_state_definition(i.object_identity) is null)
     or (i.object_kind='grant' and public.custodial_release_authority_current_grant_definition(i.object_identity) is null);
  select array_agg(i.object_identity order by i.restore_order,i.object_identity) into v_mismatched
  from public.custodial_release_authority_restore_inventory i
  where (i.object_kind='function' and to_regprocedure(i.object_identity) is not null and encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure(i.object_identity)),'UTF8'),'sha256'),'hex')<>i.definition_sha256)
     or (i.object_kind='constraint' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_constraint_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='index' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_index_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='trigger' and exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where i.object_identity=quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname) and not t.tgisinternal and encode(extensions.digest(convert_to('drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '||quote_ident(n.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';','UTF8'),'sha256'),'hex')<>i.definition_sha256))
     or (i.object_kind='policy' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_policy_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
     or (i.object_kind='relation_state' and encode(extensions.digest(convert_to(public.custodial_release_authority_current_relation_state_definition(i.object_identity),'UTF8'),'sha256'),'hex') is distinct from i.definition_sha256)
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
    'authority_column_grants_absent',not exists(
      select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and a.attnum>0 and not a.attisdropped and a.attacl is not null
    ),
    'alternate_terminal_writers_absent',not exists(
      select 1 from public.custodial_terminal_writer_inventory i
      where i.application_callable and (i.mutates_terminal_truth or i.delegates_alternate_terminal_authority)
        and i.oid is distinct from to_regprocedure('public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text,text,text,text,text)')
        and i.oid is distinct from to_regprocedure('public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)')
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
  return jsonb_build_object('ok',coalesce(v_ok,false),'authority','offline-authority.v5','canonical_objects_expected',(select count(*) from public.custodial_release_authority_restore_inventory),'missing_objects',to_jsonb(coalesce(v_missing,array[]::text[])),'mismatched_objects',to_jsonb(coalesce(v_mismatched,array[]::text[])),'checks',v_checks);
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
    or c.relname in ('devices','locations','device_auth_credentials','sessions','completion_responses','maintenance_tickets','scan_events')
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
    or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative')
  )
  union
  select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
  from pg_trigger t
  join authority_relations r on r.oid=t.tgrelid
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace
  where not t.tgisinternal and n.nspname='public'
), inventory_rows as (
  select 100+row_number() over(order by proname,args)::integer restore_order,'function'::text object_kind,
    oid::regprocedure::text object_identity,pg_get_functiondef(oid) definition_sql from authority_functions
  union all
  select 9000+row_number() over(order by r.relname)::integer,'relation_state',quote_ident(r.nspname)||'.'||quote_ident(r.relname),
    public.custodial_release_authority_current_relation_state_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)) from authority_relations r
  union all
  select 10000+row_number() over(order by case c.contype when 'p' then 1 when 'u' then 2 when 'f' then 3 else 4 end,r.relname,c.conname)::integer,
    'constraint',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname,
    public.custodial_release_authority_current_constraint_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||c.conname)
  from pg_constraint c join authority_relations r on r.oid=c.conrelid
  union all
  select 15000+row_number() over(order by r.relname,i.relname)::integer,'index',quote_ident(ns.nspname)||'.'||quote_ident(i.relname),
    public.custodial_release_authority_current_index_definition(quote_ident(ns.nspname)||'.'||quote_ident(i.relname))
  from pg_index ix join authority_relations r on r.oid=ix.indrelid join pg_class i on i.oid=ix.indexrelid join pg_namespace ns on ns.oid=i.relnamespace
  where not exists(select 1 from pg_constraint c where c.conindid=ix.indexrelid)
  union all
  select 20000+row_number() over(order by r.relname,t.tgname)::integer,'trigger',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'.'||quote_ident(t.tgname),
    'drop trigger if exists '||quote_ident(t.tgname)||' on '||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||'; '||pg_get_triggerdef(t.oid,true)||'; alter table '
      ||quote_ident(r.nspname)||'.'||quote_ident(r.relname)||' '||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end||' trigger '||quote_ident(t.tgname)||';'
  from pg_trigger t join authority_relations r on r.oid=t.tgrelid where not t.tgisinternal
  union all
  select 25000+row_number() over(order by r.relname,p.polname)::integer,'policy',quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname,
    public.custodial_release_authority_current_policy_definition(quote_ident(r.nspname)||'.'||quote_ident(r.relname)||':'||p.polname)
  from pg_policy p join authority_relations r on r.oid=p.polrelid
  union all
  select 30000+row_number() over(order by nspname,relname)::integer,'grant',quote_ident(nspname)||'.'||quote_ident(relname),
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
    or c.relname in ('devices','locations','device_auth_credentials','sessions','completion_responses','maintenance_tickets','scan_events')
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
    or p.proname in ('create_maintenance_tickets_from_response','resolve_scan_location_code','static_weekly_reject_update_delete','tool_get_device_rollback_readiness',
      'tool_get_offline_scan_authority_snapshot','tool_start_offline_occurrence','tool_commit_cleaning_workflow_authoritative','tool_complete_session_authoritative')
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
select 40000+row_number() over(order by function_identity),'grant',function_identity,
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
