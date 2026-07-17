-- Deployed migration history snapshot: 20260714224811 messenger_notification_instance_deduplication_20260714

create or replace function public.msg_send_message(
  p_thread_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_message_type text default 'text'::text,
  p_metadata_json jsonb default '{}'::jsonb
)
returns public.msg_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
  v_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id', '')), '');
  v_source text := lower(btrim(coalesce(p_metadata_json->>'source', '')));
  v_event_id text := nullif(btrim(coalesce(p_metadata_json->>'event_id', '')), '');
  v_dedupe_key text := nullif(btrim(coalesce(
    p_metadata_json->>'notification_instance_key',
    p_metadata_json->>'instance_key',
    p_metadata_json->>'notification_key',
    p_metadata_json->>'alert_key',
    p_metadata_json->>'reminder_key',
    ''
  )), '');
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Message body is required.'; end if;
  if length(p_body) > 2000 then raise exception 'Message body cannot exceed 2000 characters.'; end if;
  if v_client_message_id is not null and length(v_client_message_id) > 200 then
    raise exception 'client_message_id cannot exceed 200 characters.';
  end if;
  if not exists (
    select 1 from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_sender_user_id
      and tp.left_at is null
  ) then
    raise exception 'Sender is not an active participant in this thread.';
  end if;

  if v_dedupe_key is null and v_source = 'events_app' and v_event_id is not null then
    v_dedupe_key := 'event:' || v_event_id;
  end if;

  if v_dedupe_key is not null then
    if length(v_dedupe_key) > 500 then raise exception 'notification instance key cannot exceed 500 characters'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'message-notification:' || p_thread_id::text || ':' || p_sender_user_id::text || ':' || v_dedupe_key,
      0
    ));
    select * into v_message
    from public.msg_messages m
    where m.thread_id = p_thread_id
      and m.sender_user_id = p_sender_user_id
      and m.is_deleted = false
      and (
        m.metadata_json->>'notification_instance_key' = v_dedupe_key
        or (v_source = 'events_app' and v_event_id is not null
            and coalesce(m.metadata_json->>'source','') = 'events_app'
            and m.metadata_json->>'event_id' = v_event_id)
      )
    order by m.sent_at
    limit 1;
    if found then return v_message; end if;
    v_metadata := v_metadata || jsonb_build_object('notification_instance_key', v_dedupe_key);
  end if;

  if v_client_message_id is not null then
    select * into v_message
    from public.msg_messages m
    where m.sender_user_id = p_sender_user_id
      and m.client_message_id = v_client_message_id
    limit 1;
    if found then return v_message; end if;
  end if;

  insert into public.msg_messages(
    thread_id, sender_user_id, message_type, body, metadata_json, client_message_id
  ) values (
    p_thread_id,
    p_sender_user_id,
    coalesce(nullif(btrim(p_message_type), ''), 'text'),
    btrim(p_body),
    v_metadata,
    v_client_message_id
  ) returning * into v_message;

  insert into public.msg_receipts(message_id, user_id, delivered_at, displayed_at, read_at, acknowledged_at)
  select v_message.id, tp.user_id, null, null, null, null
  from public.msg_thread_participants tp
  where tp.thread_id = p_thread_id
    and tp.left_at is null
    and tp.user_id <> p_sender_user_id
  on conflict (message_id, user_id) do nothing;

  update public.msg_threads
  set last_message_at = v_message.sent_at, updated_at = now()
  where id = p_thread_id;

  return v_message;
exception
  when unique_violation then
    if v_client_message_id is not null then
      select * into v_message
      from public.msg_messages m
      where m.sender_user_id = p_sender_user_id
        and m.client_message_id = v_client_message_id
      limit 1;
      if found then return v_message; end if;
    end if;
    if v_dedupe_key is not null then
      select * into v_message
      from public.msg_messages m
      where m.thread_id = p_thread_id
        and m.sender_user_id = p_sender_user_id
        and m.metadata_json->>'notification_instance_key' = v_dedupe_key
      limit 1;
      if found then return v_message; end if;
    end if;
    raise;
end
$function$;

revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb) to service_role;
