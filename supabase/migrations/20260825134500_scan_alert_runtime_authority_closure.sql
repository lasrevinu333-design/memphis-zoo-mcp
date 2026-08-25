-- Close the production runtime regression exposed after static-weekly cutover.
-- The generic service role intentionally cannot execute canonical schedule
-- readers. Queueing due alerts therefore crosses one fixed, secret-bound
-- application RPC whose definer owns the complete read/write operation.

create or replace function public.custodial_backend_queue_due_scan_alerts(
  p_limit integer default 50,
  p_dry_run boolean default true,
  p_cooldown_minutes integer default 30,
  p_manager_escalation_grace_minutes integer default 30,
  p_backend_execution_secret text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if p_limit is null or p_limit not between 1 and 200
     or p_cooldown_minutes is null or p_cooldown_minutes not between 1 and 1440
     or p_manager_escalation_grace_minutes is null
     or p_manager_escalation_grace_minutes not between 0 and 1440 then
    raise exception using errcode = '22023', message = 'bounded scan-alert queue policy is required';
  end if;
  return public.sch_queue_due_scan_alerts(
    p_limit,
    coalesce(p_dry_run, true),
    p_cooldown_minutes,
    p_manager_escalation_grace_minutes
  );
end
$function$;

revoke all on function public.custodial_backend_queue_due_scan_alerts(integer,boolean,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.custodial_backend_queue_due_scan_alerts(integer,boolean,integer,integer,text)
  to service_role;

-- Retire the weaker direct runtime route. The owner keeps implicit authority;
-- production callers must use the fixed secret-bound wrapper above.
revoke execute on function public.sch_queue_due_scan_alerts(integer,boolean,integer,integer)
  from service_role;
revoke execute on function public.sch_queue_due_scan_alerts(integer,boolean,integer)
  from service_role;

comment on function public.custodial_backend_queue_due_scan_alerts(integer,boolean,integer,integer,text) is
  'Secret-bound fixed backend authority for canonical due-scan alert queueing; generic canonical readers remain unavailable to service_role.';
