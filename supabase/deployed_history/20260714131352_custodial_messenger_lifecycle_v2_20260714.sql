-- Deployed migration history snapshot: 20260714131352 custodial_messenger_lifecycle_v2_20260714

alter table public.msg_messages add column if not exists client_message_id text null;
alter table public.msg_receipts add column if not exists queued_at timestamptz null;
alter table public.msg_receipts add column if not exists displayed_at timestamptz null;
alter table public.msg_receipts add column if not exists acknowledged_at timestamptz null;
alter table public.msg_receipts add column if not exists delivery_device_identifier text null;
alter table public.msg_receipts add column if not exists last_delivery_attempt_at timestamptz null;
alter table public.msg_receipts add column if not exists delivery_attempts integer not null default 0;
update public.msg_receipts r set queued_at=coalesce(r.queued_at,m.sent_at) from public.msg_messages m where m.id=r.message_id and r.queued_at is null;
alter table public.msg_receipts alter column queued_at set default now();
create unique index if not exists uq_msg_messages_client_message_id on public.msg_messages(client_message_id) where client_message_id is not null;
create index if not exists idx_msg_receipts_delivery_pending on public.msg_receipts(user_id,queued_at) where delivered_at is null;
create or replace function public.msg_send_message(p_thread_id uuid,p_sender_user_id uuid,p_body text,p_message_type text,p_metadata_json jsonb,p_client_message_id text)
returns public.msg_messages language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_message public.msg_messages%rowtype;
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'Message body is required.'; end if;
  if length(p_body)>4000 then raise exception 'Message body cannot exceed 4000 characters.'; end if;
  if not exists(select 1 from public.msg_thread_participants tp where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null) then raise exception 'Sender is not an active participant in this thread.'; end if;
  if nullif(btrim(coalesce(p_client_message_id,'')),'') is not null then
    select * into v_message from public.msg_messages where client_message_id=btrim(p_client_message_id) limit 1;
    if found then
      if v_message.thread_id<>p_thread_id or v_message.sender_user_id<>p_sender_user_id then raise exception 'client_message_id belongs to another message.'; end if;
      return v_message;
    end if;
  end if;
  insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json,client_message_id)
  values(p_thread_id,p_sender_user_id,coalesce(nullif(btrim(p_message_type),''),'text'),btrim(p_body),coalesce(p_metadata_json,'{}'::jsonb),nullif(btrim(coalesce(p_client_message_id,'')),'')) returning * into v_message;
  insert into public.msg_receipts(message_id,user_id,queued_at,delivered_at,displayed_at,read_at)
  select v_message.id,tp.user_id,now(),null,null,null from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;
  update public.msg_threads set last_message_at=v_message.sent_at,updated_at=now() where id=p_thread_id;
  return v_message;
end;
$function$;
create or replace function public.msg_send_message(p_thread_id uuid,p_sender_user_id uuid,p_body text,p_message_type text default 'text',p_metadata_json jsonb default '{}'::jsonb)
returns public.msg_messages language sql security definer set search_path=pg_catalog,public as $function$
select public.msg_send_message(p_thread_id,p_sender_user_id,p_body,p_message_type,p_metadata_json,null);
$function$;
create or replace function public.msg_mark_message_delivered(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;
create or replace function public.msg_mark_message_displayed(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;
create or replace function public.msg_acknowledge_message(p_message_id uuid,p_user_id uuid,p_device_identifier text)
returns public.msg_receipts language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),read_at=coalesce(read_at,now()),acknowledged_at=coalesce(acknowledged_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),'')
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;
revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.msg_send_message(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.msg_mark_message_delivered(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.msg_mark_message_displayed(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.msg_acknowledge_message(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb,text) to service_role;
grant execute on function public.msg_send_message(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.msg_mark_message_delivered(uuid,uuid,text) to service_role;
grant execute on function public.msg_mark_message_displayed(uuid,uuid,text) to service_role;
grant execute on function public.msg_acknowledge_message(uuid,uuid,text) to service_role;
