begin;

-- The shared Operations Leadership room was never part of the requested product.
-- Keep an inactive tombstone only so older deployed backends that still resolve
-- the compatibility RPC cannot recreate or expose the room during rollout.
update public.msg_thread_participants p
set left_at = coalesce(p.left_at, now())
from public.msg_threads t
where p.thread_id = t.id
  and t.system_key = 'ops_manager_shared_chat_v1'
  and p.left_at is null;

update public.msg_threads
set is_active = false,
    title = 'Retired Operations Leadership Chat',
    updated_at = now()
where system_key = 'ops_manager_shared_chat_v1';

create or replace function public.msg_get_or_create_ops_manager_thread(
  p_manager_id uuid
) returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
  v_thread public.msg_threads%rowtype;
begin
  if p_manager_id is null then
    raise exception using errcode = '22023', message = 'Authenticated manager id is required';
  end if;

  select * into v_manager
  from public.ops_manager_managers
  where manager_id = p_manager_id
    and active is true
    and revoked_at is null
    and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];

  if v_manager.manager_id is null then
    raise exception using errcode = '42501', message = 'Active authenticated Ops Manager was not found';
  end if;

  v_user := public.msg_ensure_ops_manager_user(p_manager_id);
  perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-messenger-v1', 0));

  select * into v_thread
  from public.msg_threads
  where system_key = 'ops_manager_shared_chat_v1'
  limit 1
  for update;

  if v_thread.id is null then
    insert into public.msg_threads(
      thread_type,
      title,
      created_by_user_id,
      is_active,
      system_key
    ) values (
      'group',
      'Retired Operations Leadership Chat',
      v_user.id,
      false,
      'ops_manager_shared_chat_v1'
    ) returning * into v_thread;
  else
    update public.msg_threads
    set thread_type = 'group',
        title = 'Retired Operations Leadership Chat',
        is_active = false,
        updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  end if;

  update public.msg_thread_participants
  set left_at = coalesce(left_at, now())
  where thread_id = v_thread.id
    and left_at is null;

  return v_thread;
end;
$$;

revoke all on function public.msg_get_or_create_ops_manager_thread(uuid)
  from public, anon, authenticated;
grant execute on function public.msg_get_or_create_ops_manager_thread(uuid)
  to service_role;

comment on function public.msg_get_or_create_ops_manager_thread(uuid) is
  'Compatibility tombstone for the retired Operations Leadership shared chat. It validates the manager but never reactivates the thread or joins participants.';

commit;
