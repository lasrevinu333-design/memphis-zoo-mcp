begin;

-- The named leadership accounts remain valid Messenger participants, but the
-- previously forced Operations Leadership room is retired.  The compatibility
-- RPC continues to return the historical room ID because older clients still
-- expect an ID during identity bootstrap; it never reactivates the room.
update public.msg_threads
set is_active = false,
    title = 'Operations Leadership Chat (Retired)',
    updated_at = now()
where system_key = 'ops_manager_shared_chat_v1';

create or replace function public.msg_get_or_create_ops_manager_thread(
  p_manager_id uuid
) returns public.msg_threads
language plpgsql
security definer
set search_path=pg_catalog,public
as $retired_ops_manager_room$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
  v_thread public.msg_threads%rowtype;
begin
  if p_manager_id is null then
    raise exception using errcode='22023',message='Authenticated leadership manager id is required';
  end if;

  select * into v_manager
  from public.ops_manager_managers
  where manager_id=p_manager_id
    and active=true
    and revoked_at is null
    and is_system_principal=false
    and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
  if v_manager.manager_id is null then
    raise exception using errcode='42501',message='Active authenticated Operations Leadership identity was not found';
  end if;

  v_user:=public.msg_ensure_ops_manager_user(p_manager_id);
  perform pg_advisory_xact_lock(hashtextextended('operations-leadership-chat-v1-retired',0));
  select * into v_thread
  from public.msg_threads
  where system_key='ops_manager_shared_chat_v1'
  order by created_at,id
  limit 1
  for update;

  if v_thread.id is null then
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active,system_key)
    values('group','Operations Leadership Chat (Retired)',v_user.id,false,'ops_manager_shared_chat_v1')
    returning * into v_thread;
  else
    update public.msg_threads
    set is_active=false,
        thread_type='group',
        title='Operations Leadership Chat (Retired)',
        updated_at=now()
    where id=v_thread.id
    returning * into v_thread;
  end if;

  -- Preserve the historical participant/audit relationship without exposing an
  -- active room in thread listings.  This also keeps old message ownership
  -- intelligible if the archived record is inspected later.
  insert into public.msg_thread_participants(thread_id,user_id,joined_at,left_at)
  values(v_thread.id,v_user.id,now(),null)
  on conflict(thread_id,user_id) do update
    set left_at=null
    where public.msg_thread_participants.left_at is not null;

  return v_thread;
end
$retired_ops_manager_room$;

revoke all on function public.msg_get_or_create_ops_manager_thread(uuid) from public,anon,authenticated;
grant execute on function public.msg_get_or_create_ops_manager_thread(uuid) to service_role;

comment on function public.msg_get_or_create_ops_manager_thread(uuid) is
  'Compatibility-only bootstrap RPC. Returns the archived inactive Operations Leadership room and never reactivates it.';

commit;
