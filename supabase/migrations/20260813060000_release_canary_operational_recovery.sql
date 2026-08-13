begin;

-- The release canary can be stopped without depending on process memory. The
-- state is keyed to the exact physical employee-phone identifier and survives
-- backend restarts and traffic moving between instances.
create table if not exists public.custodial_release_canary_controls (
  device_identifier text primary key check (device_identifier ~ '^KIOSK_(0[2-9]|10)$'),
  paused boolean not null default true,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by_manager_id uuid not null references public.ops_manager_managers(manager_id),
  reason text not null check (length(btrim(reason)) between 1 and 1000)
);

create table if not exists public.custodial_release_canary_rollback_audits (
  audit_id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default statement_timestamp(),
  requested_by_manager_id uuid not null references public.ops_manager_managers(manager_id),
  request_id uuid not null,
  device_identifier text not null check (device_identifier ~ '^KIOSK_(0[2-9]|10)$'),
  action text not null check (action in ('pause_canary','resume_canary','restore_authority')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  authoritative_health jsonb not null,
  result_json jsonb not null default '{}'::jsonb,
  unique (requested_by_manager_id, request_id)
);

-- Capture the reviewed, known-good authority definitions at migration time.
-- A later present-but-broken RPC can be restored forward without reviving any
-- legacy writer or deleting authority evidence.
create table if not exists public.custodial_release_authority_restore_definitions (
  restore_order integer primary key,
  function_identity text not null unique,
  function_definition text not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default statement_timestamp()
);

with wanted(restore_order, function_identity) as (values
  (1, 'public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)'),
  (2, 'public.tool_get_offline_scan_authority_snapshot(text,text,text)'),
  (3, 'public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'),
  (4, 'public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text)'),
  (5, 'public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text)'),
  (6, 'public.tool_complete_session_authoritative(text,jsonb,text,text,text,text)'),
  (7, 'public.custodial_backend_authority_health(text)')
), captured as (
  select w.restore_order, w.function_identity, pg_get_functiondef(to_regprocedure(w.function_identity)) function_definition
  from wanted w
)
insert into public.custodial_release_authority_restore_definitions(
  restore_order, function_identity, function_definition, definition_sha256
)
select restore_order, function_identity, function_definition,
  encode(extensions.digest(convert_to(function_definition,'UTF8'),'sha256'),'hex')
from captured
where function_definition is not null
on conflict (restore_order) do nothing;

do $restore_set$
begin
  if (select count(*) from public.custodial_release_authority_restore_definitions) <> 7 then
    raise exception 'The release authority restoration set is incomplete';
  end if;
end
$restore_set$;

create or replace function public.custodial_release_canary_is_paused(
  p_device_identifier text, p_backend_execution_secret text
) returns boolean language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if upper(btrim(coalesce(p_device_identifier,''))) !~ '^KIOSK_(0[2-9]|10)$' then
    raise exception using errcode='22023', message='an exact employee-phone canary identifier is required';
  end if;
  return coalesce((select paused from public.custodial_release_canary_controls
    where device_identifier=upper(btrim(p_device_identifier))), false);
end
$function$;

create or replace function public.custodial_control_release_canary(
  p_manager_id uuid, p_request_id uuid, p_device_identifier text, p_action text,
  p_reason text, p_authoritative_health jsonb, p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_existing public.custodial_release_canary_rollback_audits%rowtype;
  v_definition public.custodial_release_authority_restore_definitions%rowtype;
  v_device text:=upper(btrim(coalesce(p_device_identifier,'')));
  v_result jsonb;
  v_restored integer:=0;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists (select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then
    raise exception using errcode='42501', message='named release manager authority is required';
  end if;
  if p_request_id is null or v_device !~ '^KIOSK_(0[2-9]|10)$'
     or p_action not in ('pause_canary','resume_canary','restore_authority')
     or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
     or jsonb_typeof(p_authoritative_health) <> 'object' then
    raise exception using errcode='22023', message='stable request, exact canary, supported action, reason, and authority health are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('custodial-release-canary:'||v_device,0));
  select * into v_existing from public.custodial_release_canary_rollback_audits
   where requested_by_manager_id=p_manager_id and request_id=p_request_id for update;
  if found then
    if v_existing.device_identifier<>v_device or v_existing.action<>p_action
       or v_existing.reason<>btrim(p_reason) or v_existing.authoritative_health<>p_authoritative_health then
      raise exception using errcode='23505',message='release control request identity is already bound to different inputs';
    end if;
    return v_existing.result_json || jsonb_build_object('audit_id',v_existing.audit_id,'replayed',true);
  end if;

  if p_action='pause_canary' then
    insert into public.custodial_release_canary_controls(device_identifier,paused,updated_by_manager_id,reason)
    values(v_device,true,p_manager_id,btrim(p_reason))
    on conflict(device_identifier) do update set paused=true,updated_at=statement_timestamp(),
      updated_by_manager_id=excluded.updated_by_manager_id,reason=excluded.reason;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_functions',0);
  elsif p_action='restore_authority' then
    if not coalesce((select paused from public.custodial_release_canary_controls where device_identifier=v_device),false) then
      raise exception using errcode='55000',message='the exact release canary must be paused before authority restoration';
    end if;
    for v_definition in select * from public.custodial_release_authority_restore_definitions order by restore_order loop
      if encode(extensions.digest(convert_to(v_definition.function_definition,'UTF8'),'sha256'),'hex')<>v_definition.definition_sha256 then
        raise exception using errcode='23514',message='a captured authority restoration definition failed its digest';
      end if;
      execute v_definition.function_definition;
      v_restored:=v_restored+1;
    end loop;
    execute 'revoke all on function public.custodial_commit_offline_occurrence(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text) from public,anon,authenticated,service_role';
    execute 'revoke all on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text), public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text), public.tool_get_offline_scan_authority_snapshot(text,text,text), public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text), public.tool_complete_session_authoritative(text,jsonb,text,text,text,text), public.custodial_backend_authority_health(text) from public,anon,authenticated';
    execute 'grant execute on function public.custodial_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text), public.tool_start_offline_occurrence(text,text,text,text,text,text,integer,text,text,text), public.tool_get_offline_scan_authority_snapshot(text,text,text), public.tool_commit_cleaning_workflow_authoritative(text,text,text,text,text,text,jsonb,jsonb,text,text,text,text,text), public.tool_complete_session_authoritative(text,jsonb,text,text,text,text), public.custodial_backend_authority_health(text) to postgres,service_role';
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',true,'restored_functions',v_restored);
  else
    if p_authoritative_health->>'ok'<>'true' then
      raise exception using errcode='55000',message='the release canary cannot resume until authoritative health is green';
    end if;
    insert into public.custodial_release_canary_controls(device_identifier,paused,updated_by_manager_id,reason)
    values(v_device,false,p_manager_id,btrim(p_reason))
    on conflict(device_identifier) do update set paused=false,updated_at=statement_timestamp(),
      updated_by_manager_id=excluded.updated_by_manager_id,reason=excluded.reason;
    v_result:=jsonb_build_object('device_identifier',v_device,'canary_paused',false,'restored_functions',0);
  end if;

  insert into public.custodial_release_canary_rollback_audits(
    requested_by_manager_id,request_id,device_identifier,action,reason,authoritative_health,result_json
  ) values(p_manager_id,p_request_id,v_device,p_action,btrim(p_reason),p_authoritative_health,v_result)
  returning audit_id into v_existing.audit_id;
  return v_result || jsonb_build_object('audit_id',v_existing.audit_id,'replayed',false);
end
$function$;

alter table public.custodial_release_canary_controls enable row level security;
alter table public.custodial_release_canary_controls force row level security;
alter table public.custodial_release_canary_rollback_audits enable row level security;
alter table public.custodial_release_canary_rollback_audits force row level security;
alter table public.custodial_release_authority_restore_definitions enable row level security;
alter table public.custodial_release_authority_restore_definitions force row level security;

revoke all on table public.custodial_release_canary_controls,
  public.custodial_release_canary_rollback_audits,
  public.custodial_release_authority_restore_definitions from public,anon,authenticated,service_role;
revoke all on function public.custodial_release_canary_is_paused(text,text),
  public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.custodial_release_canary_is_paused(text,text),
  public.custodial_control_release_canary(uuid,uuid,text,text,text,jsonb,text) to postgres,service_role;

comment on table public.custodial_release_authority_restore_definitions is
  'Known-good forward restoration set for the canonical canary authority; no legacy writer or destructive down-migration is included.';

commit;
