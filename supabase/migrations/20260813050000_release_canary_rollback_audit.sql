-- Post-enforcement rollback is a traffic safety control, not a second writer.
-- It can only pause the named canary; it never restores grants, procedures, or
-- pre-enforcement data paths.
create table if not exists public.custodial_release_canary_rollback_audits (
  audit_id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default statement_timestamp(),
  requested_by_manager_id uuid not null references public.ops_manager_managers(manager_id),
  request_id uuid not null,
  action text not null check (action in ('pause_canary','resume_canary')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  authoritative_health jsonb not null,
  unique (requested_by_manager_id, request_id)
);

alter table public.custodial_release_canary_rollback_audits enable row level security;
alter table public.custodial_release_canary_rollback_audits force row level security;

create or replace function public.custodial_audit_release_canary_rollback(
  p_manager_id uuid, p_request_id uuid, p_action text, p_reason text,
  p_authoritative_health jsonb, p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_existing public.custodial_release_canary_rollback_audits%rowtype; v_audit_id uuid;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists (select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null and m.roles && array['DIRECTOR','SECURITY_ADMIN']::text[]) then
    raise exception using errcode='42501', message='director or security administrator authority is required';
  end if;
  if p_request_id is null or p_action not in ('pause_canary','resume_canary') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_authoritative_health) <> 'object' then
    raise exception using errcode='22023', message='stable request identity, supported action, reason, and authoritative health are required';
  end if;
  select * into v_existing from public.custodial_release_canary_rollback_audits where requested_by_manager_id=p_manager_id and request_id=p_request_id for update;
  if found then
    if v_existing.action<>p_action or v_existing.reason<>btrim(p_reason) or v_existing.authoritative_health<>p_authoritative_health then raise exception using errcode='23505',message='rollback request identity is already bound to different inputs'; end if;
    return jsonb_build_object('audit_id',v_existing.audit_id,'replayed',true);
  end if;
  insert into public.custodial_release_canary_rollback_audits(requested_by_manager_id,request_id,action,reason,authoritative_health)
  values(p_manager_id,p_request_id,p_action,btrim(p_reason),p_authoritative_health) returning audit_id into v_audit_id;
  return jsonb_build_object('audit_id',v_audit_id,'replayed',false);
end
$function$;

revoke all on table public.custodial_release_canary_rollback_audits from public, anon, authenticated, service_role;
revoke all on function public.custodial_audit_release_canary_rollback(uuid,uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.custodial_audit_release_canary_rollback(uuid,uuid,text,text,jsonb,text) to service_role;
comment on table public.custodial_release_canary_rollback_audits is 'Immutable operator audit for reversible post-enforcement canary traffic pause/resume; it cannot restore a legacy writer or down-migrate schema.';
