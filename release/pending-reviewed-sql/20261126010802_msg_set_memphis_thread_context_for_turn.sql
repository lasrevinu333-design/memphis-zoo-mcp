-- Proposed forward SQL. Admit it with the caller through the normal migration gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';

create function public.msg_set_memphis_thread_context_for_turn(
  p_thread_id uuid,p_user_id uuid,p_source_message_id uuid,p_last_intent text,
  p_last_employee_name text,p_last_group_name text,p_last_location_code text,
  p_last_service_date date,p_last_subject_type text,p_context_json jsonb)
returns boolean
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  original_time timestamptz;
begin
  if not public.msg_is_runtime_user(p_user_id) then return false; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);

  select coalesce(m.sent_at,m.created_at) into original_time
    from public.msg_messages m
    join public.msg_threads t on t.id=m.thread_id and t.is_active and t.thread_type='bot'
    join public.msg_thread_participants p on p.thread_id=t.id and p.user_id=m.sender_user_id and p.left_at is null
    join public.msg_thread_participants bot on bot.thread_id=t.id and bot.user_id=public.msg_get_memphis_user_id() and bot.left_at is null
    where m.id=p_source_message_id and m.thread_id=p_thread_id and m.sender_user_id=p_user_id
      and m.message_type='text' and not m.is_deleted
      and (select count(*) from public.msg_thread_participants x where x.thread_id=t.id and x.left_at is null)=2
      and coalesce(m.sent_at,m.created_at)>coalesce((select max(v.hidden_before)
        from public.msg_thread_visibility v where v.thread_id=m.thread_id and v.user_id=m.sender_user_id
        and v.device_identifier is null),'-infinity'::timestamptz)
    for share of m,t,p,bot;
  if original_time is null then return false; end if;

  insert into public.msg_memphis_thread_context as current_context(
    thread_id,last_intent,last_employee_name,last_group_name,last_location_code,
    last_service_date,last_subject_type,context_json,updated_at)
  values(p_thread_id,p_last_intent,p_last_employee_name,p_last_group_name,p_last_location_code,
    p_last_service_date,p_last_subject_type,
    coalesce(p_context_json,'{}'::jsonb)||jsonb_build_object('source_message_id',p_source_message_id),
    statement_timestamp())
  on conflict(thread_id) do update set
    last_intent=excluded.last_intent,last_employee_name=excluded.last_employee_name,
    last_group_name=excluded.last_group_name,last_location_code=excluded.last_location_code,
    last_service_date=excluded.last_service_date,last_subject_type=excluded.last_subject_type,
    context_json=excluded.context_json,updated_at=excluded.updated_at
  where not exists (
    select 1 from public.msg_messages prior
    where prior.id::text=current_context.context_json->>'source_message_id'
      and prior.thread_id=p_thread_id and prior.sender_user_id=p_user_id
      and (coalesce(prior.sent_at,prior.created_at),prior.id)>=(original_time,p_source_message_id)
  );
  return found;
end
$function$;
revoke all on function public.msg_set_memphis_thread_context_for_turn(uuid,uuid,uuid,text,text,text,text,date,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.msg_set_memphis_thread_context_for_turn(uuid,uuid,uuid,text,text,text,text,date,text,jsonb)
  to service_role;
commit;
