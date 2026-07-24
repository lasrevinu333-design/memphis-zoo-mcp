-- One canonical room is shared by every authenticated Ops Manager principal.
-- Individual browser sessions never choose the room, participant, sender, or
-- role; the backend supplies its server-verified manager_id to this RPC.

alter table public.msg_threads
  add column if not exists system_key text;

alter table public.msg_threads
  drop constraint if exists msg_threads_system_key_format_check;
alter table public.msg_threads
  add constraint msg_threads_system_key_format_check
  check (
    system_key is null
    or system_key ~ '^[a-z][a-z0-9_]{2,79}$'
  );

create unique index if not exists uq_msg_threads_system_key
  on public.msg_threads(system_key)
  where system_key is not null;

-- Message edits such as a soft deletion need their own reconciliation cursor.
-- sent_at remains immutable message ordering; updated_at is only for change
-- propagation to other open browsers.
alter table public.msg_messages
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_msg_messages_thread_updated_cursor
  on public.msg_messages(thread_id, updated_at, id);

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

  select * into v_thread
  from public.msg_threads
  where system_key = 'ops_manager_shared_chat_v1'
  limit 1;

  if v_thread.id is null then
    -- Serialize singleton creation only. Established rooms do not contend on
    -- this global lock during ordinary polling and message traffic.
    perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-messenger-v1', 0));
    select * into v_thread
    from public.msg_threads
    where system_key = 'ops_manager_shared_chat_v1'
    limit 1;
    if v_thread.id is null then
      insert into public.msg_threads(
        thread_type,
        title,
        created_by_user_id,
        is_active,
        system_key
      ) values (
        'group',
        'Ops Manager Chat',
        v_user.id,
        true,
        'ops_manager_shared_chat_v1'
      )
      returning * into v_thread;
    end if;
  elsif v_thread.is_active is false
     or v_thread.thread_type <> 'group'
     or v_thread.title is distinct from 'Ops Manager Chat' then
    update public.msg_threads
    set is_active = true,
        thread_type = 'group',
        title = 'Ops Manager Chat',
        updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  end if;

  insert into public.msg_thread_participants(thread_id, user_id, joined_at, left_at)
  values (v_thread.id, v_user.id, now(), null)
  on conflict (thread_id, user_id) do update
  set left_at = null
  where msg_thread_participants.left_at is not null;

  -- A manager who first opens Messenger after messages already exist must see
  -- and be able to acknowledge that history. Missing receipts are backfilled;
  -- existing delivery/read evidence is never overwritten.
  insert into public.msg_receipts(message_id, user_id, queued_at)
  select m.id, v_user.id, now()
  from public.msg_messages m
  where m.thread_id = v_thread.id
    and m.is_deleted is false
    and m.sender_user_id <> v_user.id
  on conflict (message_id, user_id) do nothing;

  return v_thread;
end;
$$;

revoke all on function public.msg_get_or_create_ops_manager_thread(uuid)
  from public, anon, authenticated;
grant execute on function public.msg_get_or_create_ops_manager_thread(uuid)
  to service_role;

comment on column public.msg_threads.system_key is
  'Immutable application-owned identity for singleton/system threads; null for ordinary user-created conversations.';
comment on function public.msg_get_or_create_ops_manager_thread(uuid) is
  'Returns the one canonical Ops Manager chat and transactionally reconciles the authenticated manager principal as an active participant.';

-- Deletion is intentionally a soft, idempotent, transactionally visible
-- transition. The browser never supplies an authoritative actor: the API
-- passes the server-derived Messenger principal for the authenticated session.
create or replace function public.msg_delete_message(
  p_message_id uuid,
  p_request_user_id uuid
) returns public.msg_messages
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_message public.msg_messages%rowtype;
  v_request_role text;
  v_now timestamptz := now();
begin
  if p_message_id is null or p_request_user_id is null then
    raise exception using errcode = '22023', message = 'Message and authenticated user are required';
  end if;

  select role into v_request_role
  from public.msg_users
  where id = p_request_user_id
    and is_active is true;

  if v_request_role is null then
    raise exception using errcode = '42501', message = 'Authenticated messaging user was not found';
  end if;

  select * into v_message
  from public.msg_messages
  where id = p_message_id
  for update;

  if v_message.id is null then
    raise exception using errcode = 'P0002', message = 'Message not found';
  end if;

  if v_message.sender_user_id <> p_request_user_id
     and v_request_role not in ('manager', 'admin') then
    raise exception using errcode = '42501', message = 'Only the sender or an Ops Manager can delete this message';
  end if;

  if v_message.is_deleted is false then
    update public.msg_messages
    set is_deleted = true,
        body = '[deleted]',
        metadata_json = coalesce(metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'deleted_by', p_request_user_id,
            'deleted_at', v_now
          ),
        updated_at = v_now
    where id = p_message_id
    returning * into v_message;

    update public.msg_threads
    set updated_at = v_now
    where id = v_message.thread_id;
  end if;

  return v_message;
end;
$$;

revoke all on function public.msg_delete_message(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.msg_delete_message(uuid, uuid)
  to service_role;

comment on column public.msg_messages.updated_at is
  'Server-owned message-change cursor; sent_at remains immutable display ordering.';
comment on function public.msg_delete_message(uuid, uuid) is
  'Soft-deletes one message idempotently after server-derived sender/manager authorization and advances cross-device reconciliation.';
