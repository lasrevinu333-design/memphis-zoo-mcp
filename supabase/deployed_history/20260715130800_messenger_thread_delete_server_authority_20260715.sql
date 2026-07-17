-- Deployed migration history snapshot: 20260715130800 messenger_thread_delete_server_authority_20260715

create or replace function public.msg_mark_thread_deleted(
  p_thread_id uuid,
  p_user_id uuid,
  p_device_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_hidden_before timestamptz := clock_timestamp();
  v_requested_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_canonical_device text;
  v_deleted_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception 'thread_id and user_id are required.';
  end if;
  if not public.msg_is_runtime_user(p_user_id) then
    raise exception 'User is not an active custodial Messenger identity.';
  end if;
  if not exists (
    select 1
    from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
      and tp.left_at is null
  ) then
    raise exception 'User is not an active participant in this thread.';
  end if;

  if v_requested_device is not null then
    select d.device_id into v_canonical_device
    from public.devices d
    where d.active = true
      and upper(btrim(d.device_id)) = upper(v_requested_device)
    limit 1;

    if v_canonical_device is null then
      select d.device_id into v_canonical_device
      from public.device_aliases da
      join public.devices d on d.id = da.canonical_device_id and d.active = true
      where da.active = true
        and upper(btrim(da.alias_identifier)) = upper(v_requested_device)
      limit 1;
    end if;
  end if;

  v_canonical_device := coalesce(v_canonical_device, v_requested_device);
  if v_canonical_device is null then
    raise exception 'device_identifier is required.';
  end if;

  insert into public.msg_thread_visibility(
    thread_id, user_id, device_identifier, hidden_before, created_at, updated_at
  ) values (
    p_thread_id, p_user_id, v_canonical_device, v_hidden_before, now(), now()
  )
  on conflict(thread_id, user_id, device_identifier)
  do update set hidden_before = excluded.hidden_before, updated_at = now();

  insert into public.msg_message_deletions(message_id, user_id, deleted_at)
  select m.id, p_user_id, v_hidden_before
  from public.msg_messages m
  where m.thread_id = p_thread_id
    and m.is_deleted = false
    and coalesce(m.sent_at, m.created_at) <= v_hidden_before
  on conflict(message_id, user_id)
  do update set deleted_at = excluded.deleted_at;
  get diagnostics v_deleted_count = row_count;

  update public.msg_thread_participants
  set left_at = v_hidden_before
  where thread_id = p_thread_id
    and user_id = p_user_id
    and left_at is null;

  update public.msg_threads
  set updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_id', p_user_id,
    'device_identifier', v_canonical_device,
    'hidden_before', v_hidden_before,
    'deleted_message_count', v_deleted_count,
    'participant_left', true
  );
end
$function$;

revoke all on function public.msg_mark_thread_deleted(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.msg_mark_thread_deleted(uuid, uuid, text) to service_role;
