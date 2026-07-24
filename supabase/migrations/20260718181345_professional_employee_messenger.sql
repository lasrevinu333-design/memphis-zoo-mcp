-- Professional employee Messenger: durable group creation, one canonical
-- all-staff room, and truthful per-device conversation archiving.

alter table public.msg_threads
  add column if not exists client_thread_id text;

alter table public.msg_threads
  drop constraint if exists msg_threads_client_thread_id_format_chk;

alter table public.msg_threads
  add constraint msg_threads_client_thread_id_format_chk
  check (
    client_thread_id is null
    or (
      length(btrim(client_thread_id)) between 8 and 200
      and client_thread_id = btrim(client_thread_id)
    )
  );

create unique index if not exists uq_msg_threads_creator_client_thread_id
  on public.msg_threads (created_by_user_id, client_thread_id)
  where client_thread_id is not null;

create index if not exists idx_msg_thread_visibility_user_device_thread
  on public.msg_thread_visibility (
    user_id,
    upper(btrim(device_identifier)),
    thread_id,
    hidden_before desc
  );

create or replace function public.msg_create_group_thread_v2(
  p_created_by_user_id uuid,
  p_title text,
  p_member_user_ids uuid[],
  p_client_thread_id text
)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_member_ids uuid[];
  v_title text;
  v_client_thread_id text;
begin
  if p_created_by_user_id is null then
    raise exception using errcode = '22023', message = 'Authenticated group creator is required';
  end if;
  if not public.msg_is_runtime_user(p_created_by_user_id) then
    raise exception using errcode = '42501', message = 'Group creator is not an active Messenger user';
  end if;

  v_member_ids := array(
    select distinct member_id
    from unnest(coalesce(p_member_user_ids, array[]::uuid[])) as selected(member_id)
    where member_id is not null
      and member_id <> p_created_by_user_id
    order by member_id
  );

  if coalesce(array_length(v_member_ids, 1), 0) < 2 then
    raise exception using errcode = '22023', message = 'A group requires at least two recipients';
  end if;
  if coalesce(array_length(v_member_ids, 1), 0) > 100 then
    raise exception using errcode = '22023', message = 'A group may contain at most 100 recipients';
  end if;
  if exists (
    select 1
    from unnest(v_member_ids) as selected(member_id)
    where not public.msg_is_runtime_user(selected.member_id)
  ) then
    raise exception using errcode = '22023', message = 'One or more recipients are invalid or inactive';
  end if;

  v_title := nullif(left(btrim(coalesce(p_title, '')), 120), '');
  v_client_thread_id := nullif(btrim(coalesce(p_client_thread_id, '')), '');
  if v_client_thread_id is null or length(v_client_thread_id) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'A stable client thread operation id is required';
  end if;

  insert into public.msg_threads (
    thread_type,
    title,
    created_by_user_id,
    client_thread_id,
    is_active
  ) values (
    'group',
    v_title,
    p_created_by_user_id,
    v_client_thread_id,
    true
  )
  on conflict (created_by_user_id, client_thread_id)
    where client_thread_id is not null
  do nothing
  returning * into v_thread;

  if v_thread.id is null then
    select * into v_thread
    from public.msg_threads
    where created_by_user_id = p_created_by_user_id
      and client_thread_id = v_client_thread_id
    limit 1;
    if v_thread.id is null then
      raise exception using errcode = '40001', message = 'Concurrent group creation could not be reconciled';
    end if;
    return v_thread;
  end if;

  insert into public.msg_thread_participants (thread_id, user_id)
  values (v_thread.id, p_created_by_user_id)
  on conflict (thread_id, user_id)
  do update set left_at = null;

  insert into public.msg_thread_participants (thread_id, user_id)
  select v_thread.id, member_id
  from unnest(v_member_ids) as selected(member_id)
  on conflict (thread_id, user_id)
  do update set left_at = null;

  return v_thread;
end
$function$;

create or replace function public.msg_get_or_create_custodial_team_thread(
  p_created_by_user_id uuid
)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
begin
  if p_created_by_user_id is null or not public.msg_is_runtime_user(p_created_by_user_id) then
    raise exception using errcode = '42501', message = 'An active authenticated Messenger user is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('msg:custodial_team_chat_v1', 0));

  select * into v_thread
  from public.msg_threads
  where system_key = 'custodial_team_chat_v1'
  limit 1
  for update;

  if v_thread.id is null then
    insert into public.msg_threads (
      thread_type,
      title,
      created_by_user_id,
      system_key,
      is_active
    ) values (
      'group',
      'Custodial Team',
      p_created_by_user_id,
      'custodial_team_chat_v1',
      true
    )
    returning * into v_thread;
  elsif v_thread.is_active is false or v_thread.title is distinct from 'Custodial Team' then
    update public.msg_threads
    set is_active = true,
        title = 'Custodial Team',
        updated_at = now()
    where id = v_thread.id
    returning * into v_thread;
  end if;

  insert into public.msg_thread_participants (thread_id, user_id)
  select v_thread.id, mu.id
  from public.msg_users mu
  where mu.is_active is true
    and mu.role <> 'bot'
    and public.msg_is_runtime_user(mu.id)
  on conflict (thread_id, user_id)
  do update set left_at = null;

  update public.msg_thread_participants tp
  set left_at = coalesce(tp.left_at, now())
  where tp.thread_id = v_thread.id
    and not exists (
      select 1
      from public.msg_users mu
      where mu.id = tp.user_id
        and mu.is_active is true
        and mu.role <> 'bot'
        and public.msg_is_runtime_user(mu.id)
    );

  return v_thread;
end
$function$;

create or replace function public.msg_mark_thread_deleted(
  p_thread_id uuid,
  p_user_id uuid,
  p_device_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_hidden_before timestamptz := clock_timestamp();
  v_requested_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_canonical_device text;
  v_role text;
  v_system_key text;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception using errcode = '22023', message = 'Thread and authenticated user are required';
  end if;
  select role into v_role
  from public.msg_users
  where id = p_user_id
    and is_active is true;
  if v_role is null or not public.msg_is_runtime_user(p_user_id) then
    raise exception using errcode = '42501', message = 'User is not an active Messenger identity';
  end if;

  select system_key into v_system_key
  from public.msg_threads
  where id = p_thread_id
    and is_active is true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active conversation not found';
  end if;
  if v_system_key in ('ops_manager_shared_chat_v1', 'custodial_team_chat_v1') then
    raise exception using errcode = '23514', message = 'Required shared conversations cannot be archived';
  end if;
  if v_role not in ('manager', 'admin') and not exists (
    select 1
    from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
      and tp.left_at is null
  ) then
    raise exception using errcode = '42501', message = 'User is not an active participant in this conversation';
  end if;

  if v_requested_device is not null then
    select d.device_id into v_canonical_device
    from public.devices d
    where d.active is true
      and upper(btrim(d.device_id)) = upper(v_requested_device)
    union all
    select d.device_id
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active is true
    where da.active is true
      and upper(btrim(da.alias_identifier)) = upper(v_requested_device)
    limit 1;
  end if;
  v_canonical_device := coalesce(v_canonical_device, v_requested_device);
  if v_canonical_device is null then
    raise exception using errcode = '22023', message = 'A canonical device identifier is required';
  end if;

  insert into public.msg_thread_visibility (
    thread_id,
    user_id,
    device_identifier,
    hidden_before,
    created_at,
    updated_at
  ) values (
    p_thread_id,
    p_user_id,
    v_canonical_device,
    v_hidden_before,
    now(),
    now()
  )
  on conflict (thread_id, user_id, device_identifier)
  do update set hidden_before = excluded.hidden_before,
                updated_at = now();

  update public.msg_threads
  set updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_id', p_user_id,
    'device_identifier', v_canonical_device,
    'hidden_before', v_hidden_before,
    'archived_on_device', true,
    'participant_left', false
  );
end
$function$;

-- Message removal is an authoritative, idempotent soft-delete.  The API
-- derives p_request_user_id from the authenticated session and validates the
-- returned tombstone before reporting success.  Recompute last_message_at so
-- an erased newest message cannot keep a stale preview/order timestamp.
create or replace function public.msg_delete_message(
  p_message_id uuid,
  p_request_user_id uuid
)
returns public.msg_messages
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_request_role text;
  v_now timestamptz := clock_timestamp();
begin
  if p_message_id is null or p_request_user_id is null then
    raise exception using errcode = '22023', message = 'Message and authenticated user are required';
  end if;

  select role into v_request_role
  from public.msg_users
  where id = p_request_user_id
    and is_active is true;

  if v_request_role is null or not public.msg_is_runtime_user(p_request_user_id) then
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

    update public.msg_threads t
    set last_message_at = (
          select max(m.sent_at)
          from public.msg_messages m
          where m.thread_id = v_message.thread_id
            and m.is_deleted is false
        ),
        updated_at = v_now
    where t.id = v_message.thread_id;
  end if;

  return v_message;
end
$function$;

-- Repair memberships that the former device-only archive function incorrectly
-- marked as left. The tight timestamp match proves these rows were produced by
-- that function, not by an independent membership action.
update public.msg_thread_participants tp
set left_at = null
from public.msg_thread_visibility tv
where tv.thread_id = tp.thread_id
  and tv.user_id = tp.user_id
  and tp.left_at is not null
  and abs(extract(epoch from (tp.left_at - tv.hidden_before))) <= 5;

revoke all on function public.msg_create_group_thread_v2(uuid, text, uuid[], text) from public, anon, authenticated;
revoke all on function public.msg_get_or_create_custodial_team_thread(uuid) from public, anon, authenticated;
revoke all on function public.msg_mark_thread_deleted(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.msg_delete_message(uuid, uuid) from public, anon, authenticated;

grant execute on function public.msg_create_group_thread_v2(uuid, text, uuid[], text) to service_role;
grant execute on function public.msg_get_or_create_custodial_team_thread(uuid) to service_role;
grant execute on function public.msg_mark_thread_deleted(uuid, uuid, text) to service_role;
grant execute on function public.msg_delete_message(uuid, uuid) to service_role;

comment on function public.msg_create_group_thread_v2(uuid, text, uuid[], text)
  is 'Creates employee or manager groups idempotently from a server-authenticated creator.';
comment on function public.msg_get_or_create_custodial_team_thread(uuid)
  is 'Returns the canonical all-active-staff Custodial Team conversation and reconciles membership.';
comment on function public.msg_mark_thread_deleted(uuid, uuid, text)
  is 'Archives a non-system conversation on one authenticated device without removing membership or messages.';
comment on function public.msg_delete_message(uuid, uuid)
  is 'Idempotently soft-deletes one authorized message and recomputes its conversation cursor so every device removes it.';
