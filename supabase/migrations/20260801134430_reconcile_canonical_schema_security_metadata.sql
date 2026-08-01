begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Re-state the canonical named-manager identity function. Production retained
-- the same executable behavior but lost the in-body rationale when the
-- function was deployed outside the tracked migration chain. Keeping the
-- canonical definition exact makes schema fingerprints reproducible.
create or replace function public.msg_ensure_ops_manager_user(
  p_manager_id uuid
) returns public.msg_users
language plpgsql
security definer
set search_path=pg_catalog,public
as $named_manager_user$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
  v_display_name text;
begin
  if p_manager_id is null then
    raise exception using errcode='22023',message='Authenticated leadership manager id is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('named-manager-messenger:'||p_manager_id::text,0));
  select * into v_manager
  from public.ops_manager_managers
  where manager_id=p_manager_id
    and active=true
    and revoked_at is null
    and is_system_principal=false
  for update;
  if v_manager.manager_id is null then
    raise exception using errcode='42501',message='Active named leadership identity was not found';
  end if;

  select * into v_user
  from public.msg_users
  where ops_manager_id=p_manager_id
  order by created_at,id
  limit 1
  for update;

  if v_user.id is null then
    select * into v_user
    from public.msg_users
    where ops_manager_id is null
      and lower(btrim(display_name))=lower(btrim(v_manager.display_name))
      and coalesce(messaging_identity_key,'')<>'ops_manager_shared_identity_v1'
    order by is_active desc,created_at,id
    limit 1
    for update;
    if v_user.id is not null then
      update public.msg_users
      set ops_manager_id=p_manager_id,
          display_name=btrim(v_manager.display_name),
          role='manager',
          is_active=true,
          messaging_identity_key=null,
          updated_at=now()
      where id=v_user.id
      returning * into v_user;
    end if;
  end if;

  if v_user.id is null then
    v_display_name:=btrim(v_manager.display_name);
    if exists(select 1 from public.msg_users where lower(btrim(display_name))=lower(v_display_name)) then
      v_display_name:=left(v_display_name,80)||' · Leadership';
    end if;
    insert into public.msg_users(display_name,role,is_active,ops_manager_id,messaging_identity_key)
    values(v_display_name,'manager',true,p_manager_id,null)
    returning * into v_user;
  elsif v_user.is_active is false or v_user.role<>'manager' or v_user.display_name is distinct from btrim(v_manager.display_name) then
    -- Prefer the exact real name. The fallback preserves startup if an old
    -- unrelated row still owns that globally unique display name.
    begin
      update public.msg_users
      set display_name=btrim(v_manager.display_name),role='manager',is_active=true,
          messaging_identity_key=null,updated_at=now()
      where id=v_user.id
      returning * into v_user;
    exception when unique_violation then
      update public.msg_users
      set role='manager',is_active=true,messaging_identity_key=null,updated_at=now()
      where id=v_user.id
      returning * into v_user;
    end;
  end if;
  return v_user;
end
$named_manager_user$;

revoke all on function public.msg_ensure_ops_manager_user(uuid)
  from public, anon, authenticated;
grant execute on function public.msg_ensure_ops_manager_user(uuid)
  to service_role;
comment on function public.msg_ensure_ops_manager_user(uuid) is null;

-- Re-state the compatibility RPC exactly as represented by the canonical
-- rebuilt schema. It may return the historical room, but it cannot reactivate
-- that room or expose it in active thread listings.
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

revoke all on function public.msg_get_or_create_ops_manager_thread(uuid)
  from public, anon, authenticated;
grant execute on function public.msg_get_or_create_ops_manager_thread(uuid)
  to service_role;
comment on function public.msg_get_or_create_ops_manager_thread(uuid) is
  'Compatibility-only bootstrap RPC. Returns the archived inactive Operations Leadership room and never reactivates it.';

-- These append-only audit tables stay service-only even if a future grant is
-- added accidentally. Recreating named policies is safe on repeat execution.
alter table public.custodial_employee_device_assignment_history
  enable row level security;
alter table public.custodial_employee_device_assignment_history
  force row level security;
revoke all on table public.custodial_employee_device_assignment_history
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.custodial_employee_device_assignment_history
  to postgres, service_role;

drop policy if exists custodial_employee_device_assignment_history_service_all
  on public.custodial_employee_device_assignment_history;
create policy custodial_employee_device_assignment_history_service_all
  on public.custodial_employee_device_assignment_history
  for all
  to service_role
  using (true)
  with check (true);

alter table public.custodial_employee_status_history
  enable row level security;
alter table public.custodial_employee_status_history
  force row level security;
revoke all on table public.custodial_employee_status_history
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.custodial_employee_status_history
  to postgres, service_role;

drop policy if exists custodial_employee_status_history_service_all
  on public.custodial_employee_status_history;
create policy custodial_employee_status_history_service_all
  on public.custodial_employee_status_history
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.ops_manager_notification_queue is
  'Durable manager mobile push queue with leasing, retry and delivery audit state.';

commit;
