BEGIN;
-- Successor fragment for Main integration; never alters a historical migration.
-- A request receipt and its effects commit atomically. The key is supplied by
-- the original caller, scoped to the server-derived sender, never generated here.
create table public.msg_broadcast_request_receipts (
  sender_user_id uuid not null,
  client_broadcast_id text not null check (length(client_broadcast_id) between 1 and 200 and client_broadcast_id = btrim(client_broadcast_id)),
  request_title text,
  request_body text not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (sender_user_id, client_broadcast_id)
);
alter table public.msg_broadcast_request_receipts enable row level security;
revoke all on public.msg_broadcast_request_receipts from public, anon, authenticated, service_role;

create function public.msg_broadcast_operation_v1(
  p_sender_user_id uuid, p_client_broadcast_id text, p_title text, p_body text, p_read_only boolean default false
) returns table(thread_id uuid, broadcast_id uuid, message_id uuid, recipient_count integer)
language plpgsql security definer set search_path to pg_catalog, public
as $function$
declare
  v_receipt public.msg_broadcast_request_receipts%rowtype;
  v_result jsonb;
begin
  if p_sender_user_id is null or not exists (
    select 1 from public.msg_users u where u.id=p_sender_user_id and u.is_active and u.role in ('manager','admin')
  ) then raise exception 'Manager role required.' using errcode='42501'; end if;
  if p_client_broadcast_id is null or length(p_client_broadcast_id) not between 1 and 200
     or p_client_broadcast_id <> btrim(p_client_broadcast_id) then
    raise exception 'A stable client_broadcast_id is required.' using errcode='22023';
  end if;
  if p_body is null or btrim(p_body)='' or length(btrim(p_body))>2000 then
    raise exception 'Broadcast body must contain 1–2000 characters.' using errcode='22023';
  end if;
  if p_read_only is null then raise exception 'Read-only mode is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('msg-broadcast:'||p_sender_user_id::text||':'||p_client_broadcast_id,0));
  select r.* into v_receipt from public.msg_broadcast_request_receipts r
    where r.sender_user_id=p_sender_user_id and r.client_broadcast_id=p_client_broadcast_id;
  if found then
    if v_receipt.request_title is distinct from p_title or v_receipt.request_body is distinct from p_body then
      raise exception 'Client broadcast ID already belongs to a different payload.' using errcode='23505';
    end if;
    v_result := v_receipt.result;
  elsif p_read_only then
    return;
  else
    select to_jsonb(outcome) into strict v_result from public.msg_send_broadcast(p_sender_user_id,p_title,p_body) outcome;
    insert into public.msg_broadcast_request_receipts(sender_user_id,client_broadcast_id,request_title,request_body,result)
      values(p_sender_user_id,p_client_broadcast_id,p_title,p_body,v_result);
  end if;
  return query select (v_result->>'thread_id')::uuid,(v_result->>'broadcast_id')::uuid,
    (v_result->>'message_id')::uuid,(v_result->>'recipient_count')::integer;
end
$function$;
revoke all on function public.msg_broadcast_operation_v1(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.msg_broadcast_operation_v1(uuid,text,text,text,boolean) to service_role;

COMMIT;
