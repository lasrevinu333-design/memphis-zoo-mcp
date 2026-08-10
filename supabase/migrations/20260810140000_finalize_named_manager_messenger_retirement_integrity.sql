begin;

-- This later correction deliberately leaves both prior retirement migrations
-- untouched. It closes runtime authority gaps while preserving every already
--retired row and every normal active conversation contract.

-- A single locked predicate is the final authority for every mutable
-- conversation path. Locking the row keeps a concurrent tombstone or raw
--state transition from slipping between validation and the writer.
create or replace function public.msg_assert_active_mutable_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_thread public.msg_threads%rowtype;
begin
  if p_thread_id is null then
    raise exception using errcode='22023',message='thread_id is required.';
  end if;
  select * into v_thread
  from public.msg_threads
  where id=p_thread_id
  for update;
  if v_thread.id is null then
    raise exception using errcode='P0002',message='Conversation not found';
  end if;
  if v_thread.system_key='ops_manager_shared_chat_v1' then
    raise exception using errcode='23514',message='The retired Operations Leadership conversation is immutable';
  end if;
  if v_thread.is_active is not true then
    raise exception using errcode='23514',message='Conversation is retired or inactive';
  end if;
end
$function$;

create or replace function public.msg_assert_active_mutable_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare v_thread_id uuid;
begin
  if p_message_id is null then
    raise exception using errcode='22023',message='message_id is required.';
  end if;
  select m.thread_id into v_thread_id
  from public.msg_messages m
  where m.id=p_message_id
  for key share;
  if v_thread_id is null then
    raise exception using errcode='P0002',message='Message not found';
  end if;
  perform public.msg_assert_active_mutable_thread(v_thread_id);
end
$function$;

-- Event acknowledgement owns both the native-notification receipt and the
--Messenger receipt in one transaction. All message, thread, membership, and
--receipt validation happens before either durable acknowledgement is written.
create or replace function public.msg_acknowledge_event_device_notification(
  p_device_identifier text,
  p_notification_key text,
  p_notification_type text,
  p_action text,
  p_metadata_json jsonb,
  p_message_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread_id uuid;
  v_notification jsonb;
  v_receipt public.msg_receipts%rowtype;
begin
  if p_message_id is null or p_user_id is null then
    raise exception using errcode='22023',message='Linked message and Messenger user are required for event acknowledgement';
  end if;

  select m.thread_id into v_thread_id
  from public.msg_messages m
  where m.id=p_message_id
  for key share;
  if v_thread_id is null then
    raise exception using errcode='P0002',message='Linked event message was not found';
  end if;
  perform public.msg_assert_active_mutable_thread(v_thread_id);

  if not exists (
    select 1
    from public.msg_thread_participants p
    where p.thread_id=v_thread_id
      and p.user_id=p_user_id
      and p.left_at is null
  ) then
    raise exception using errcode='42501',message='Messenger user is not an active participant in the linked conversation';
  end if;
  if not exists (
    select 1
    from public.msg_receipts r
    where r.message_id=p_message_id
      and r.user_id=p_user_id
  ) then
    raise exception using errcode='P0002',message='Linked event message receipt was not found';
  end if;

  v_notification:=public.ack_device_notification(
    p_device_identifier,p_notification_key,p_notification_type,p_action,p_metadata_json
  );
  v_receipt:=public.msg_acknowledge_message(p_message_id,p_user_id,p_device_identifier);
  return v_notification || jsonb_build_object('message_receipt_id',v_receipt.id);
end
$function$;

-- Final precedence for the two send signatures: the common locked predicate
--runs before a replay lookup as well as before every message, receipt, audit,
--and thread cursor mutation.
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
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  if not exists (
    select 1 from public.msg_thread_participants tp
    where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null
  ) then raise exception 'Sender is not an active participant in this thread.'; end if;

  if v_dedupe_key is null and v_source='events_app' and v_event_id is not null then
    v_dedupe_key:='event:'||v_event_id;
  end if;
  if v_dedupe_key is not null then
    if length(v_dedupe_key)>500 then raise exception 'notification instance key cannot exceed 500 characters'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'message-notification:'||p_thread_id::text||':'||p_sender_user_id::text||':'||v_dedupe_key,0
    ));
    select * into v_message from public.msg_messages m
    where m.thread_id=p_thread_id and m.sender_user_id=p_sender_user_id and m.is_deleted is false
      and (m.metadata_json->>'notification_instance_key'=v_dedupe_key
        or (v_source='events_app' and v_event_id is not null
          and coalesce(m.metadata_json->>'source','')='events_app'
          and m.metadata_json->>'event_id'=v_event_id))
    order by m.sent_at limit 1;
    if found then return v_message; end if;
    v_metadata:=v_metadata||jsonb_build_object('notification_instance_key',v_dedupe_key);
  end if;
  if v_client_message_id is not null then
    select * into v_message from public.msg_messages m
    where m.sender_user_id=p_sender_user_id and m.client_message_id=v_client_message_id limit 1;
    if found then return v_message; end if;
  end if;
  insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json,client_message_id)
  values(p_thread_id,p_sender_user_id,coalesce(nullif(btrim(p_message_type),''),'text'),btrim(p_body),v_metadata,v_client_message_id)
  returning * into v_message;
  insert into public.msg_receipts(message_id,user_id,delivered_at,displayed_at,read_at,acknowledged_at)
  select v_message.id,tp.user_id,null,null,null,null from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;
  update public.msg_threads set last_message_at=v_message.sent_at,updated_at=now() where id=p_thread_id;
  return v_message;
exception when unique_violation then
  if v_client_message_id is not null then
    select * into v_message from public.msg_messages m
    where m.sender_user_id=p_sender_user_id and m.client_message_id=v_client_message_id limit 1;
    if found then return v_message; end if;
  end if;
  if v_dedupe_key is not null then
    select * into v_message from public.msg_messages m
    where m.thread_id=p_thread_id and m.sender_user_id=p_sender_user_id
      and m.metadata_json->>'notification_instance_key'=v_dedupe_key limit 1;
    if found then return v_message; end if;
  end if;
  raise;
end
$function$;

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
declare v_message public.msg_messages%rowtype;
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'Message body is required.'; end if;
  if length(p_body)>4000 then raise exception 'Message body cannot exceed 4000 characters.'; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  if not exists(select 1 from public.msg_thread_participants tp where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null) then
    raise exception 'Sender is not an active participant in this thread.';
  end if;
  if nullif(btrim(coalesce(p_client_message_id,'')),'') is not null then
    select * into v_message from public.msg_messages where client_message_id=btrim(p_client_message_id) limit 1;
    if found then
      if v_message.thread_id<>p_thread_id or v_message.sender_user_id<>p_sender_user_id then raise exception 'client_message_id belongs to another message.'; end if;
      return v_message;
    end if;
  end if;
  insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json,client_message_id)
  values(p_thread_id,p_sender_user_id,coalesce(nullif(btrim(p_message_type),''),'text'),btrim(p_body),coalesce(p_metadata_json,'{}'::jsonb),nullif(btrim(coalesce(p_client_message_id,'')),''))
  returning * into v_message;
  insert into public.msg_receipts(message_id,user_id,queued_at,delivered_at,displayed_at,read_at)
  select v_message.id,tp.user_id,now(),null,null,null from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;
  update public.msg_threads set last_message_at=v_message.sent_at,updated_at=now() where id=p_thread_id;
  return v_message;
end
$function$;

create or replace function public.msg_acknowledge_message(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_active_mutable_message(p_message_id);
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),read_at=coalesce(read_at,now()),acknowledged_at=coalesce(acknowledged_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), '')
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_message_delivered(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_active_mutable_message(p_message_id);
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), ''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_message_displayed(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_active_mutable_message(p_message_id);
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), ''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_messages_delivered(p_thread_id uuid,p_user_id uuid,p_message_ids uuid[] default '{}'::uuid[])
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_count integer:=0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  update public.msg_receipts r set delivered_at=coalesce(r.delivered_at,now())
  from public.msg_messages m where r.message_id=m.id and r.user_id=p_user_id and m.thread_id=p_thread_id
    and (coalesce(array_length(p_message_ids,1),0)=0 or m.id=any(p_message_ids));
  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_messages_displayed(p_thread_id uuid,p_user_id uuid,p_message_ids uuid[] default '{}'::uuid[])
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_count integer:=0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  update public.msg_receipts r set delivered_at=coalesce(r.delivered_at,now()),displayed_at=coalesce(r.displayed_at,now())
  from public.msg_messages m where r.message_id=m.id and r.user_id=p_user_id and m.thread_id=p_thread_id
    and (coalesce(array_length(p_message_ids,1),0)=0 or m.id=any(p_message_ids));
  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_thread_read(p_thread_id uuid,p_user_id uuid)
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_count integer:=0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  update public.msg_receipts r set delivered_at=coalesce(r.delivered_at,now()),displayed_at=coalesce(r.displayed_at,now()),read_at=coalesce(r.read_at,now())
  from public.msg_messages m where r.message_id=m.id and r.user_id=p_user_id and m.thread_id=p_thread_id;
  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

-- Memphis context and device visibility are mutable thread side effects too;
--they use the same final predicate even though they do not write messages.
create or replace function public.msg_set_memphis_thread_context(
  p_thread_id uuid,
  p_last_intent text default null,
  p_last_employee_name text default null,
  p_last_group_name text default null,
  p_last_location_code text default null,
  p_last_service_date date default null,
  p_last_subject_type text default null,
  p_context_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_row public.msg_memphis_thread_context%rowtype;
begin
  if p_thread_id is null then raise exception 'p_thread_id is required'; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  insert into public.msg_memphis_thread_context(
    thread_id,last_intent,last_employee_name,last_group_name,last_location_code,
    last_service_date,last_subject_type,context_json,updated_at
  ) values (
    p_thread_id,p_last_intent,p_last_employee_name,p_last_group_name,p_last_location_code,
    p_last_service_date,p_last_subject_type,coalesce(p_context_json,'{}'::jsonb),now()
  ) on conflict(thread_id) do update set
    last_intent=coalesce(excluded.last_intent,public.msg_memphis_thread_context.last_intent),
    last_employee_name=coalesce(excluded.last_employee_name,public.msg_memphis_thread_context.last_employee_name),
    last_group_name=coalesce(excluded.last_group_name,public.msg_memphis_thread_context.last_group_name),
    last_location_code=coalesce(excluded.last_location_code,public.msg_memphis_thread_context.last_location_code),
    last_service_date=coalesce(excluded.last_service_date,public.msg_memphis_thread_context.last_service_date),
    last_subject_type=coalesce(excluded.last_subject_type,public.msg_memphis_thread_context.last_subject_type),
    context_json=coalesce(excluded.context_json,public.msg_memphis_thread_context.context_json),
    updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'thread_id',v_row.thread_id,'last_intent',v_row.last_intent,
    'last_employee_name',v_row.last_employee_name,'last_group_name',v_row.last_group_name,
    'last_location_code',v_row.last_location_code,'last_service_date',v_row.last_service_date,
    'last_subject_type',v_row.last_subject_type,'context_json',v_row.context_json,'updated_at',v_row.updated_at
  );
end
$function$;

create or replace function public.msg_unhide_thread_for_device(p_thread_id uuid,p_device_identifier text)
returns integer
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_count integer:=0; v_device text;
begin
  v_device:=btrim(coalesce(p_device_identifier,''));
  if p_thread_id is null or v_device='' then return 0; end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  delete from public.msg_hidden_threads_by_device where thread_id=p_thread_id and device_identifier=v_device;
  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

-- Individual-message deletion remains retired. Conversation-level removal is
-- the only supported user deletion contract.
create or replace function public.msg_delete_message(p_message_id uuid,p_request_user_id uuid)
returns public.msg_messages
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
begin
  raise exception using
    errcode='0A000',
    message='Individual-message deletion is retired. Delete the conversation instead.';
end
$function$;

-- User deletion remains replay-safe because a verified replay makes no
--mutation. A new operation always checks the locked target before touching
--visibility, participants, operation evidence, or the thread cursor.
create or replace function public.msg_delete_thread(p_thread_id uuid,p_request_user_id uuid,p_operation_id uuid)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_existing public.msg_thread_deletion_operations%rowtype;
  v_request_role text;
  v_now timestamptz:=clock_timestamp();
  v_deleted_through timestamptz;
  v_is_memphis boolean:=false;
begin
  if p_thread_id is null or p_request_user_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='Thread, authenticated user, and deletion operation are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.msg_thread_deletion_operations where operation_id=p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.thread_id<>p_thread_id or v_existing.user_id<>p_request_user_id or v_existing.deletion_scope<>'user' then
      raise exception using errcode='23505',message='Deletion operation id was already used for another target';
    end if;
    return jsonb_build_object('ok',true,'thread_id',v_existing.thread_id,'deleted',true,'deletion_scope','user','deleted_at',v_existing.deleted_at,'deleted_through',v_existing.deleted_through,'operation_id',v_existing.operation_id,'replayed',true);
  end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  select role into v_request_role from public.msg_users where id=p_request_user_id and is_active is true;
  if v_request_role is null or not public.msg_is_runtime_user(p_request_user_id) then
    raise exception using errcode='42501',message='Authenticated messaging user was not found';
  end if;
  select * into v_thread from public.msg_threads where id=p_thread_id for update;
  if v_request_role not in ('manager','admin') and not exists (
    select 1 from public.msg_thread_participants p where p.thread_id=p_thread_id and p.user_id=p_request_user_id and p.left_at is null
  ) then raise exception using errcode='42501',message='Only a participant or Ops Manager can remove this conversation'; end if;
  v_deleted_through:=greatest(v_now,coalesce((select max(coalesce(m.sent_at,m.created_at)) from public.msg_messages m where m.thread_id=p_thread_id),v_now));
  delete from public.msg_thread_visibility where thread_id=p_thread_id and user_id=p_request_user_id and device_identifier is null;
  insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before,created_at,updated_at)
  values(p_thread_id,p_request_user_id,null,v_deleted_through,v_now,v_now);
  select exists(select 1 from public.msg_thread_participants p join public.msg_users u on u.id=p.user_id where p.thread_id=p_thread_id and p.left_at is null and u.role='bot' and lower(btrim(u.display_name))='memphis') into v_is_memphis;
  if v_is_memphis then update public.msg_thread_participants set left_at=coalesce(left_at,v_now) where thread_id=p_thread_id and user_id=p_request_user_id and left_at is null; end if;
  insert into public.msg_thread_deletion_operations(operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,thread_type,metadata_json)
  values(p_operation_id,p_thread_id,p_request_user_id,'user',v_deleted_through,v_now,v_thread.thread_type,jsonb_build_object('memphis_generation_ended',v_is_memphis));
  update public.msg_threads set updated_at=v_now where id=p_thread_id;
  return jsonb_build_object('ok',true,'thread_id',p_thread_id,'deleted',true,'deletion_scope','user','deleted_at',v_now,'deleted_through',v_deleted_through,'operation_id',p_operation_id,'memphis_generation_ended',v_is_memphis,'replayed',false);
end
$function$;

create or replace function public.msg_admin_tombstone_thread(p_thread_id uuid,p_request_user_id uuid,p_operation_id uuid)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_existing public.msg_thread_deletion_operations%rowtype;
  v_request_role text;
  v_now timestamptz:=clock_timestamp();
  v_deleted_messages integer:=0;
begin
  if p_thread_id is null or p_request_user_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='Thread, authenticated admin, and deletion operation are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.msg_thread_deletion_operations where operation_id=p_operation_id;
  if v_existing.operation_id is not null then
    if v_existing.thread_id<>p_thread_id or v_existing.user_id<>p_request_user_id or v_existing.deletion_scope<>'global' then
      raise exception using errcode='23505',message='Deletion operation id was already used for another target';
    end if;
    return jsonb_build_object('ok',true,'thread_id',v_existing.thread_id,'deleted',true,'deletion_scope','global','deleted_at',v_existing.deleted_at,'purge_after',v_existing.deleted_at+interval '14 days','operation_id',v_existing.operation_id,'replayed',true);
  end if;
  perform public.msg_assert_active_mutable_thread(p_thread_id);
  select role into v_request_role from public.msg_users where id=p_request_user_id and is_active is true;
  if v_request_role<>'admin' then raise exception using errcode='42501',message='An active Messenger admin is required for global tombstoning'; end if;
  select * into v_thread from public.msg_threads where id=p_thread_id for update;
  update public.msg_messages set is_deleted=true,body='[deleted]',deleted_at=coalesce(deleted_at,v_now),deleted_by_user_id=coalesce(deleted_by_user_id,p_request_user_id),purge_after=coalesce(purge_after,coalesce(deleted_at,v_now)+interval '14 days'),metadata_json=(coalesce(metadata_json,'{}'::jsonb)-'deleted_by'-'deleted_at')||jsonb_build_object('deletion_retention_days',14,'conversation_globally_tombstoned',true),updated_at=v_now
  where thread_id=p_thread_id and is_deleted is false;
  get diagnostics v_deleted_messages=row_count;
  update public.msg_threads set is_active=false,deleted_at=v_now,deleted_by_user_id=p_request_user_id,deletion_operation_id=p_operation_id,purge_after=v_now+interval '14 days',last_message_at=null,updated_at=v_now where id=p_thread_id returning * into v_thread;
  insert into public.msg_thread_deletion_operations(operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,thread_type,metadata_json)
  values(p_operation_id,p_thread_id,p_request_user_id,'global',v_now,v_now,v_thread.thread_type,jsonb_build_object('deleted_message_count',v_deleted_messages));
  return jsonb_build_object('ok',true,'thread_id',p_thread_id,'deleted',true,'deletion_scope','global','deleted_at',v_now,'purge_after',v_now+interval '14 days','operation_id',p_operation_id,'deleted_message_count',v_deleted_messages,'replayed',false);
end
$function$;

-- Archive tables must not be table-wide erased. Statement triggers defend
--against accidental owner-level truncation; service_role also loses the
--underlying capability on every direct archive/evidence relation.
create or replace function public.msg_reject_archive_truncate()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $function$
begin
  raise exception using errcode='23514',message='Messenger archive and evidence tables cannot be truncated';
end
$function$;

do $archive_truncate_guards$
declare v_table text;
begin
  foreach v_table in array array[
    'msg_threads','msg_thread_participants','msg_messages','msg_message_audit','msg_receipts','msg_message_deletions',
    'msg_thread_visibility','msg_hidden_threads_by_device','msg_memphis_thread_context','msg_thread_deletion_operations'
  ] loop
    execute format('revoke truncate on table public.%I from service_role',v_table);
    execute format('drop trigger if exists trg_msg_reject_archive_truncate on public.%I',v_table);
    execute format('create trigger trg_msg_reject_archive_truncate before truncate on public.%I for each statement execute function public.msg_reject_archive_truncate()',v_table);
  end loop;
end
$archive_truncate_guards$;

-- Only an existing exact manager binding or a separately reviewed legacy link
--may be adopted. A display label is never identity authority.
create table if not exists public.msg_ops_manager_legacy_identity_links (
  manager_id uuid primary key references public.ops_manager_managers(manager_id) on delete restrict,
  msg_user_id uuid not null unique references public.msg_users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  verified_by text not null default 'reviewed_migration',
  created_at timestamptz not null default now()
);
alter table public.msg_ops_manager_legacy_identity_links enable row level security;
alter table public.msg_ops_manager_legacy_identity_links force row level security;
revoke all on table public.msg_ops_manager_legacy_identity_links from public,anon,authenticated,service_role;

create or replace function public.msg_ensure_ops_manager_user(p_manager_id uuid)
returns public.msg_users
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
  v_link public.msg_ops_manager_legacy_identity_links%rowtype;
  v_display_name text;
  v_identity_key text;
begin
  if p_manager_id is null then raise exception using errcode='22023',message='Authenticated leadership manager id is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('named-manager-messenger:'||p_manager_id::text,0));
  select * into v_manager from public.ops_manager_managers
  where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false for update;
  if v_manager.manager_id is null then raise exception using errcode='42501',message='Active named leadership identity was not found'; end if;
  v_identity_key:='ops_manager_named_'||replace(p_manager_id::text,'-','');

  select * into v_user from public.msg_users where ops_manager_id=p_manager_id order by created_at,id limit 1 for update;
  if v_user.id is null then
    select * into v_link from public.msg_ops_manager_legacy_identity_links where manager_id=p_manager_id for update;
    if v_link.manager_id is not null then
      select * into v_user from public.msg_users where id=v_link.msg_user_id for update;
      if v_user.id is null or (v_user.ops_manager_id is not null and v_user.ops_manager_id<>p_manager_id) then
        raise exception using errcode='23514',message='Verified legacy Messenger identity link is invalid';
      end if;
    end if;
  end if;

  v_display_name:=btrim(v_manager.display_name);
  if exists(select 1 from public.msg_users u where lower(btrim(u.display_name))=lower(v_display_name) and (v_user.id is null or u.id<>v_user.id)) then
    v_display_name:=left(v_display_name,64)||' · Leadership '||left(p_manager_id::text,8);
  end if;
  if v_user.id is null then
    insert into public.msg_users(display_name,role,is_active,ops_manager_id,messaging_identity_key)
    values(v_display_name,'manager',true,p_manager_id,v_identity_key)
    returning * into v_user;
  else
    update public.msg_users
    set ops_manager_id=p_manager_id,display_name=v_display_name,role='manager',is_active=true,messaging_identity_key=v_identity_key,updated_at=now()
    where id=v_user.id
    returning * into v_user;
  end if;
  return v_user;
end
$function$;

-- A raw pair assembly is serialized on the same canonical lock namespace as
--the RPCs. It fails after the second active candidate becomes visible rather
--than silently allowing a split active conversation.
create or replace function public.msg_assert_no_ambiguous_active_pair_for_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_low uuid;
  v_high uuid;
  v_candidate_count integer;
begin
  select * into v_thread from public.msg_threads where id=p_thread_id;
  if v_thread.id is null or v_thread.is_active is not true or v_thread.thread_type not in ('direct','bot') then return; end if;
  select (array_agg(p.user_id order by p.user_id))[1],(array_agg(p.user_id order by p.user_id))[2] into v_low,v_high
  from public.msg_thread_participants p where p.thread_id=p_thread_id and p.left_at is null;
  if v_low is null or v_low=v_high or 2<>(select count(*) from public.msg_thread_participants p where p.thread_id=p_thread_id and p.left_at is null) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('msg-canonical-conversation-pair:v1:'||v_low::text||':'||v_high::text,0));
  select count(*) into v_candidate_count
  from public.msg_threads t
  join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=v_low and p1.left_at is null
  join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=v_high and p2.left_at is null
  where t.is_active is true and t.thread_type in ('direct','bot')
    and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null);
  if v_candidate_count>1 then
    raise exception using errcode='23505',message='Ambiguous active Messenger canonical pair has more than one candidate';
  end if;
end
$function$;

create or replace function public.msg_enforce_canonical_active_pair_participants()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  perform public.msg_assert_no_ambiguous_active_pair_for_thread(case when tg_op='DELETE' then old.thread_id else new.thread_id end);
  if tg_op='UPDATE' and old.thread_id is distinct from new.thread_id then
    perform public.msg_assert_no_ambiguous_active_pair_for_thread(old.thread_id);
  end if;
  return null;
end
$function$;

create or replace function public.msg_enforce_canonical_active_pair_thread()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  perform public.msg_assert_no_ambiguous_active_pair_for_thread(new.id);
  return null;
end
$function$;

drop trigger if exists trg_msg_enforce_canonical_active_pair_participants on public.msg_thread_participants;
create trigger trg_msg_enforce_canonical_active_pair_participants
after insert or update of thread_id,user_id,left_at or delete on public.msg_thread_participants
for each row execute function public.msg_enforce_canonical_active_pair_participants();
drop trigger if exists trg_msg_enforce_canonical_active_pair_thread on public.msg_threads;
create trigger trg_msg_enforce_canonical_active_pair_thread
after insert or update of is_active,thread_type on public.msg_threads
for each row execute function public.msg_enforce_canonical_active_pair_thread();

-- Both public resolution paths enumerate and lock the complete active set
--after acquiring the canonical pair lock. A stale mapping can be reconciled;
--more than one live candidate can never be selected or rewritten.
create or replace function public.msg_get_or_create_direct_thread(p_user_a uuid,p_user_b uuid)
returns public.msg_threads
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_pair public.msg_canonical_thread_pairs%rowtype;
  v_candidate_ids uuid[];
  v_candidate_count integer:=0;
  v_low uuid;
  v_high uuid;
begin
  if p_user_a is null or p_user_b is null then raise exception 'Both users are required.'; end if;
  if p_user_a=p_user_b then raise exception 'Direct thread requires two different users.'; end if;
  if not exists(select 1 from public.msg_users where id=p_user_a and is_active is true) then raise exception 'User A not found or inactive.'; end if;
  if not exists(select 1 from public.msg_users where id=p_user_b and is_active is true) then raise exception 'User B not found or inactive.'; end if;
  v_low:=least(p_user_a,p_user_b); v_high:=greatest(p_user_a,p_user_b);
  perform pg_advisory_xact_lock(hashtextextended('msg-canonical-conversation-pair:v1:'||v_low::text||':'||v_high::text,0));
  select * into v_pair from public.msg_canonical_thread_pairs where principal_low_id=v_low and principal_high_id=v_high for update;
  with candidates as materialized (
    select t.id from public.msg_threads t
    join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_a and p1.left_at is null
    join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=p_user_b and p2.left_at is null
    where t.thread_type='direct' and t.is_active is true
      and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null)
    order by t.created_at,t.id for update of t
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]),count(*) into v_candidate_ids,v_candidate_count from candidates;
  if v_candidate_count>1 then raise exception using errcode='23505',message='Ambiguous active Messenger canonical pair has more than one direct candidate'; end if;
  if v_candidate_count=1 then
    select * into v_thread from public.msg_threads where id=v_candidate_ids[1] for update;
  elsif v_pair.thread_id is not null then
    delete from public.msg_canonical_thread_pairs where principal_low_id=v_low and principal_high_id=v_high;
  end if;
  if v_thread.id is null then
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active) values('direct',null,p_user_a,true) returning * into v_thread;
    insert into public.msg_thread_participants(thread_id,user_id) values(v_thread.id,p_user_a),(v_thread.id,p_user_b);
  end if;
  insert into public.msg_canonical_thread_pairs(principal_low_id,principal_high_id,thread_id,conversation_type)
  values(v_low,v_high,v_thread.id,'direct')
  on conflict(principal_low_id,principal_high_id) do update set thread_id=excluded.thread_id,conversation_type=excluded.conversation_type
  where public.msg_canonical_thread_pairs.thread_id is distinct from excluded.thread_id or public.msg_canonical_thread_pairs.conversation_type is distinct from excluded.conversation_type;
  return v_thread;
end
$function$;

create or replace function public.msg_get_or_create_memphis_thread(p_user_id uuid)
returns public.msg_threads
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_memphis_user_id uuid;
  v_thread public.msg_threads%rowtype;
  v_pair public.msg_canonical_thread_pairs%rowtype;
  v_candidate_ids uuid[];
  v_candidate_count integer:=0;
  v_low uuid;
  v_high uuid;
begin
  if p_user_id is null then raise exception 'user_id is required.'; end if;
  if not public.msg_is_runtime_user(p_user_id) then raise exception 'User is not an active custodial Messenger identity.'; end if;
  select mu.id into v_memphis_user_id from public.msg_users mu
  where mu.is_active is true and mu.role='bot' and lower(btrim(mu.display_name))='memphis'
  order by mu.created_at,mu.id limit 1;
  if v_memphis_user_id is null then raise exception 'Memphis bot user not found.'; end if;
  if p_user_id=v_memphis_user_id then raise exception 'Memphis cannot create a conversation with itself.'; end if;
  v_low:=least(p_user_id,v_memphis_user_id); v_high:=greatest(p_user_id,v_memphis_user_id);
  perform pg_advisory_xact_lock(hashtextextended('msg-canonical-conversation-pair:v1:'||v_low::text||':'||v_high::text,0));
  select * into v_pair from public.msg_canonical_thread_pairs where principal_low_id=v_low and principal_high_id=v_high for update;
  with candidates as materialized (
    select t.id from public.msg_threads t
    join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_id and p1.left_at is null
    join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=v_memphis_user_id and p2.left_at is null
    where t.thread_type in ('direct','bot') and t.is_active is true
      and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null)
    order by case when t.thread_type='bot' then 0 else 1 end,t.created_at,t.id for update of t
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]),count(*) into v_candidate_ids,v_candidate_count from candidates;
  if v_candidate_count>1 then raise exception using errcode='23505',message='Ambiguous active Messenger canonical pair has more than one Memphis candidate'; end if;
  if v_candidate_count=1 then
    select * into v_thread from public.msg_threads where id=v_candidate_ids[1] for update;
  elsif v_pair.thread_id is not null then
    delete from public.msg_canonical_thread_pairs where principal_low_id=v_low and principal_high_id=v_high;
  end if;
  if v_thread.id is null then
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active) values('bot','Memphis',p_user_id,true) returning * into v_thread;
    insert into public.msg_thread_participants(thread_id,user_id) values(v_thread.id,p_user_id),(v_thread.id,v_memphis_user_id);
  elsif v_thread.thread_type is distinct from 'bot' or v_thread.title is distinct from 'Memphis' then
    update public.msg_threads set thread_type='bot',title='Memphis',updated_at=now() where id=v_thread.id returning * into v_thread;
  end if;
  insert into public.msg_canonical_thread_pairs(principal_low_id,principal_high_id,thread_id,conversation_type)
  values(v_low,v_high,v_thread.id,'bot')
  on conflict(principal_low_id,principal_high_id) do update set thread_id=excluded.thread_id,conversation_type=excluded.conversation_type
  where public.msg_canonical_thread_pairs.thread_id is distinct from excluded.thread_id or public.msg_canonical_thread_pairs.conversation_type is distinct from excluded.conversation_type;
  return v_thread;
end
$function$;

revoke all on function public.msg_assert_active_mutable_thread(uuid) from public,anon,authenticated,service_role;
revoke all on function public.msg_assert_active_mutable_message(uuid) from public,anon,authenticated,service_role;
revoke all on function public.msg_reject_archive_truncate() from public,anon,authenticated,service_role;
revoke all on function public.msg_assert_no_ambiguous_active_pair_for_thread(uuid) from public,anon,authenticated,service_role;
revoke all on function public.msg_enforce_canonical_active_pair_participants() from public,anon,authenticated,service_role;
revoke all on function public.msg_enforce_canonical_active_pair_thread() from public,anon,authenticated,service_role;
revoke all on function public.msg_acknowledge_event_device_notification(text,text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function public.msg_delete_message(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.msg_acknowledge_event_device_notification(text,text,text,text,jsonb,uuid,uuid) to service_role;
grant execute on function public.msg_delete_message(uuid,uuid) to service_role;
grant execute on function public.msg_ensure_ops_manager_user(uuid) to service_role;
grant execute on function public.msg_get_or_create_direct_thread(uuid,uuid) to service_role;
grant execute on function public.msg_get_or_create_memphis_thread(uuid) to service_role;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.msg_acknowledge_message(uuid,uuid,text) to service_role;
grant execute on function public.msg_mark_message_delivered(uuid,uuid,text) to service_role;
grant execute on function public.msg_mark_message_displayed(uuid,uuid,text) to service_role;
grant execute on function public.msg_mark_messages_delivered(uuid,uuid,uuid[]) to service_role;
grant execute on function public.msg_mark_messages_displayed(uuid,uuid,uuid[]) to service_role;
grant execute on function public.msg_mark_thread_read(uuid,uuid) to service_role;
grant execute on function public.msg_set_memphis_thread_context(uuid,text,text,text,text,date,text,jsonb) to service_role;
grant execute on function public.msg_unhide_thread_for_device(uuid,text) to service_role;
grant execute on function public.msg_delete_thread(uuid,uuid,uuid) to service_role;
grant execute on function public.msg_admin_tombstone_thread(uuid,uuid,uuid) to service_role;

commit;
