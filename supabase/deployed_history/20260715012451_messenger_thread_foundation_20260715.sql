-- Deployed migration history snapshot: 20260715012451 messenger_thread_foundation_20260715

create or replace function public.msg_ensure_employee_memphis_threads()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select u.id
    from public.msg_users u
    where u.is_active = true
      and u.role = 'employee'
    order by u.id
  loop
    perform public.msg_get_or_create_memphis_thread(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

revoke all on function public.msg_ensure_employee_memphis_threads() from public, anon, authenticated;
grant execute on function public.msg_ensure_employee_memphis_threads() to service_role, postgres;

select public.msg_ensure_employee_memphis_threads();
