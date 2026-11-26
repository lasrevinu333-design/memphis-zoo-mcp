-- Proposed forward SQL. Require exact migration preflight and rehearsal before
-- enrolling this in the production ledger or rolling out its caller.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';

create function public.custodial_feedback_create_current_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  actor jsonb := p_payload->'metadata_json'->'identity_verification';
begin
  if jsonb_typeof(actor) is distinct from 'object'
     or p_payload->>'hub_context' is distinct from 'employee'
     or actor->>'status' is distinct from 'verified'
     or actor->>'kind' is distinct from 'enrolled_employee_device'
     or actor->>'device_id' is distinct from p_payload->>'device_id' then
    raise exception using errcode='42501', message='Current enrolled Feedback identity required';
  end if;

  -- The principal and assignment remain fixed until the command commits.
  perform 1
  from public.devices d
  join public.employees e on e.id=d.assigned_employee_id
  join public.device_auth_credentials c on c.device_id=d.id
  where d.device_id=actor->>'device_id'
    and d.active and e.active
    and e.id=(actor->>'employee_id')::uuid
    and d.assignment_epoch=(actor->>'assignment_epoch')::bigint
    and c.credential_id=(actor->>'credential_id')::uuid
    and c.confirmed_at is not null and c.revoked_at is null
    and c.expires_at>clock_timestamp()
  for share of d,e,c;

  if not found then
    raise exception using errcode='42501', message='Original Feedback assignment is no longer current';
  end if;
  -- Preserve the exact original idempotency key and existing item SQL.
  return public.app_apply_operational_command('feedback_create',p_payload);
end;
$function$;
revoke all on function public.custodial_feedback_create_current_employee(jsonb) from public,anon,authenticated;
grant execute on function public.custodial_feedback_create_current_employee(jsonb) to service_role;
commit;
