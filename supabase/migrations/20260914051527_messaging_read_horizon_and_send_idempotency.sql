begin;

-- A durable read acknowledgement must be bounded by the newest message the
-- viewer actually saw. The legacy two-argument function remains untouched for
-- older clients; current clients use this separately named, non-overloaded RPC.
create or replace function public.msg_mark_thread_read_through(
  p_thread_id uuid,
  p_user_id uuid,
  p_through_message_id uuid
) returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_through_at timestamptz;
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null or p_through_message_id is null then
    raise exception using errcode='22023', message='thread_id, user_id, and through_message_id are required.';
  end if;

  perform public.msg_assert_active_mutable_thread(p_thread_id);
  if not exists(
    select 1 from public.msg_thread_participants tp
    where tp.thread_id=p_thread_id and tp.user_id=p_user_id and tp.left_at is null
  ) then
    raise exception using errcode='42501', message='Reader is not an active participant in this thread.';
  end if;

  select coalesce(m.sent_at, m.created_at)
    into v_through_at
  from public.msg_messages m
  where m.id=p_through_message_id
    and m.thread_id=p_thread_id
    and m.is_deleted is false;

  if not found then
    raise exception using errcode='22023', message='through_message_id does not belong to this visible thread.';
  end if;

  update public.msg_receipts r
  set delivered_at=coalesce(r.delivered_at,now()),
      displayed_at=coalesce(r.displayed_at,now()),
      read_at=coalesce(r.read_at,now())
  from public.msg_messages m
  where r.message_id=m.id
    and r.user_id=p_user_id
    and r.read_at is null
    and m.thread_id=p_thread_id
    and m.is_deleted is false
    and (coalesce(m.sent_at,m.created_at),m.id) <= (v_through_at,p_through_message_id);

  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

revoke all on function public.msg_mark_thread_read_through(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.msg_mark_thread_read_through(uuid,uuid,uuid) to service_role,postgres;

-- A client-message replay binds every metadata value. There are no mutable
-- metadata exclusions here: server-owned manager attribution is injected by
-- its wrapper before msg_send_message and therefore remains part of the exact
-- replay payload. Normalize the duplicated client id and any notification-key
-- aliases so both a new request and an already stored row have one effective
-- metadata representation.
create or replace function public.msg_effective_message_metadata(
  p_metadata_json jsonb,
  p_client_message_id text
) returns jsonb
language plpgsql
immutable
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_metadata jsonb := coalesce(p_metadata_json,'{}'::jsonb);
  v_metadata_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id','')),'');
  v_client_message_id text := nullif(btrim(coalesce(p_client_message_id,'')),'');
  v_source text := lower(btrim(coalesce(p_metadata_json->>'source','')));
  v_event_id text := nullif(btrim(coalesce(p_metadata_json->>'event_id','')),'');
  v_dedupe_key text := nullif(btrim(coalesce(
    p_metadata_json->>'notification_instance_key',
    p_metadata_json->>'instance_key',
    p_metadata_json->>'notification_key',
    p_metadata_json->>'alert_key',
    p_metadata_json->>'reminder_key',
    ''
  )), '');
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception using errcode='22023',message='Message metadata must be a JSON object.';
  end if;
  if v_client_message_id is null then
    v_client_message_id:=v_metadata_client_message_id;
  elsif v_metadata_client_message_id is not null and v_metadata_client_message_id<>v_client_message_id then
    raise exception using errcode='22023',message='client_message_id must match metadata_json.client_message_id.';
  end if;
  if v_client_message_id is not null and length(v_client_message_id)>200 then
    raise exception using errcode='22023',message='client_message_id cannot exceed 200 characters.';
  end if;

  v_metadata := v_metadata - 'client_message_id';
  if v_client_message_id is not null then
    v_metadata := v_metadata || jsonb_build_object('client_message_id',v_client_message_id);
  end if;
  if v_dedupe_key is null and v_source='events_app' and v_event_id is not null then
    v_dedupe_key:='event:'||v_event_id;
  end if;
  if v_dedupe_key is not null then
    if length(v_dedupe_key)>500 then
      raise exception using errcode='22023',message='notification instance key cannot exceed 500 characters.';
    end if;
    v_metadata := (v_metadata
      - 'notification_instance_key'
      - 'instance_key'
      - 'notification_key'
      - 'alert_key'
      - 'reminder_key')
      || jsonb_build_object('notification_instance_key',v_dedupe_key);
  end if;
  return v_metadata;
end
$function$;

revoke all on function public.msg_effective_message_metadata(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.msg_effective_message_metadata(jsonb,text) to postgres;

-- Preserve the notification-instance behavior of the five-argument overload,
-- while making its optional client_message_id globally serialized and exact.
create or replace function public.msg_send_message(
  p_thread_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_message_type text default 'text',
  p_metadata_json jsonb default '{}'::jsonb
) returns public.msg_messages
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_message_type text := coalesce(nullif(btrim(coalesce(p_message_type,'')),''),'text');
  v_metadata jsonb := coalesce(p_metadata_json,'{}'::jsonb);
  v_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id','')),'');
  v_source text := lower(btrim(coalesce(p_metadata_json->>'source','')));
  v_event_id text := nullif(btrim(coalesce(p_metadata_json->>'event_id','')),'');
  v_dedupe_key text := nullif(btrim(coalesce(
    p_metadata_json->>'notification_instance_key',
    p_metadata_json->>'instance_key',
    p_metadata_json->>'notification_key',
    p_metadata_json->>'alert_key',
    p_metadata_json->>'reminder_key',
    ''
  )), '');
begin
  if p_thread_id is null then raise exception using errcode='22023',message='thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception using errcode='22023',message='sender_user_id is required.'; end if;
  if v_body='' then raise exception using errcode='22023',message='Message body is required.'; end if;
  if length(v_body)>2000 then raise exception using errcode='22023',message='Message body cannot exceed 2000 characters.'; end if;
  if v_client_message_id is not null and length(v_client_message_id)>200 then
    raise exception using errcode='22023',message='client_message_id cannot exceed 200 characters.';
  end if;

  -- Canonicalize before either client-id or notification-key lookup.
  v_metadata := public.msg_effective_message_metadata(p_metadata_json,v_client_message_id);
  if v_dedupe_key is null and v_source='events_app' and v_event_id is not null then
    v_dedupe_key:='event:'||v_event_id;
  end if;

  perform public.msg_assert_active_mutable_thread(p_thread_id);
  if not exists(
    select 1 from public.msg_thread_participants tp
    where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null
  ) then
    raise exception using errcode='42501',message='Sender is not an active participant in this thread.';
  end if;

  if v_client_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('msg-client-message:'||v_client_message_id,0));
    select * into v_message
    from public.msg_messages m
    where m.client_message_id=v_client_message_id
    limit 1;
    if found then
      if v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='client_message_id belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;

  if v_dedupe_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'message-notification:'||p_thread_id::text||':'||p_sender_user_id::text||':'||v_dedupe_key,0
    ));
    select * into v_message
    from public.msg_messages m
    where m.thread_id=p_thread_id
      and m.sender_user_id=p_sender_user_id
      and m.is_deleted is false
      and (m.metadata_json->>'notification_instance_key'=v_dedupe_key
        or (v_source='events_app' and v_event_id is not null
          and coalesce(m.metadata_json->>'source','')='events_app'
          and m.metadata_json->>'event_id'=v_event_id))
    order by m.sent_at
    limit 1;
    if found then
      if (v_client_message_id is not null and v_message.client_message_id is distinct from v_client_message_id)
        or v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='notification instance key belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;

  insert into public.msg_messages(
    thread_id,sender_user_id,message_type,body,metadata_json,client_message_id
  ) values (
    p_thread_id,p_sender_user_id,v_message_type,v_body,v_metadata,v_client_message_id
  ) returning * into v_message;

  insert into public.msg_receipts(
    message_id,user_id,delivered_at,displayed_at,read_at,acknowledged_at
  )
  select v_message.id,tp.user_id,null,null,null,null
  from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;

  update public.msg_threads
  set last_message_at=v_message.sent_at,updated_at=now()
  where id=p_thread_id;

  return v_message;
exception when unique_violation then
  if v_client_message_id is not null then
    select * into v_message
    from public.msg_messages m
    where m.client_message_id=v_client_message_id
    limit 1;
    if found then
      if v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='client_message_id belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;
  if v_dedupe_key is not null then
    select * into v_message
    from public.msg_messages m
    where m.thread_id=p_thread_id
      and m.sender_user_id=p_sender_user_id
      and m.metadata_json->>'notification_instance_key'=v_dedupe_key
    limit 1;
    if found then
      if (v_client_message_id is not null and v_message.client_message_id is distinct from v_client_message_id)
        or v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='notification instance key belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;
  raise;
end
$function$;

revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb) to service_role,postgres;

-- Serialize the explicit six-argument client_message_id inside the transaction.
-- Its metadata uses the same immutable canonical payload as the five-argument
-- overload, so callers cannot replay an id with altered metadata.
create or replace function public.msg_send_message(
  p_thread_id uuid,
  p_sender_user_id uuid,
  p_body text,
  p_message_type text,
  p_metadata_json jsonb,
  p_client_message_id text
) returns public.msg_messages
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_body text := btrim(coalesce(p_body,''));
  v_message_type text := coalesce(nullif(btrim(coalesce(p_message_type,'')),''),'text');
  v_metadata jsonb := coalesce(p_metadata_json,'{}'::jsonb);
  v_metadata_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id','')),'');
  v_client_message_id text := nullif(btrim(coalesce(p_client_message_id,'')),'');
begin
  if p_thread_id is null then raise exception using errcode='22023',message='thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception using errcode='22023',message='sender_user_id is required.'; end if;
  if v_client_message_id is null then
    v_client_message_id:=v_metadata_client_message_id;
  elsif v_metadata_client_message_id is not null and v_metadata_client_message_id<>v_client_message_id then
    raise exception using errcode='22023',message='client_message_id must match metadata_json.client_message_id.';
  end if;
  if v_body='' then raise exception using errcode='22023',message='Message body is required.'; end if;
  if length(v_body)>2000 then raise exception using errcode='22023',message='Message body cannot exceed 2000 characters.'; end if;
  if v_client_message_id is not null and length(v_client_message_id)>200 then
    raise exception using errcode='22023',message='client_message_id cannot exceed 200 characters.';
  end if;

  v_metadata := public.msg_effective_message_metadata(p_metadata_json,v_client_message_id);

  perform public.msg_assert_active_mutable_thread(p_thread_id);
  if not exists(
    select 1 from public.msg_thread_participants tp
    where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null
  ) then
    raise exception using errcode='42501',message='Sender is not an active participant in this thread.';
  end if;

  if v_client_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('msg-client-message:'||v_client_message_id,0));
    select * into v_message
    from public.msg_messages m
    where m.client_message_id=v_client_message_id
    limit 1;
    if found then
      if v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='client_message_id belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;

  insert into public.msg_messages(
    thread_id,sender_user_id,message_type,body,metadata_json,client_message_id
  ) values (
    p_thread_id,p_sender_user_id,v_message_type,v_body,
    v_metadata,v_client_message_id
  ) returning * into v_message;

  insert into public.msg_receipts(
    message_id,user_id,queued_at,delivered_at,displayed_at,read_at
  )
  select v_message.id,tp.user_id,now(),null,null,null
  from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;

  update public.msg_threads
  set last_message_at=v_message.sent_at,updated_at=now()
  where id=p_thread_id;

  return v_message;
exception when unique_violation then
  if v_client_message_id is not null then
    select * into v_message
    from public.msg_messages m
    where m.client_message_id=v_client_message_id
    limit 1;
    if found then
      if v_message.thread_id<>p_thread_id
        or v_message.sender_user_id<>p_sender_user_id
        or v_message.body<>v_body
        or v_message.message_type<>v_message_type
        or public.msg_effective_message_metadata(v_message.metadata_json,v_message.client_message_id) is distinct from v_metadata then
        raise exception using errcode='22023',message='client_message_id belongs to a different message payload.';
      end if;
      return v_message;
    end if;
  end if;
  raise;
end
$function$;

revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb,text) to service_role,postgres;

commit;
