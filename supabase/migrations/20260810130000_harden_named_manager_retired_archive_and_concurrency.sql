begin;

-- This is deliberately a forward correction to the first retirement.  Do not
-- rewrite the historical migration: deployed databases may already contain
-- its archived room and every row attached to it.
--
-- Normalize only the two retirement values that were authoritative before
-- this guard is installed.  The predicates make a replay a true data no-op
-- (including msg_threads.updated_at), while preserving the original creator,
-- type, key, timestamps, and all historical relationships.
update public.msg_threads
set is_active = false,
    title = 'Operations Leadership Chat (Retired)'
where system_key = 'ops_manager_shared_chat_v1'
  and (
    is_active is distinct from false
    or title is distinct from 'Operations Leadership Chat (Retired)'
  );

update public.msg_thread_participants p
set left_at = now()
from public.msg_threads t
where t.id = p.thread_id
  and t.system_key = 'ops_manager_shared_chat_v1'
  and p.left_at is null;

-- Principal-pair rows are the structural uniqueness authority for active
-- direct and Memphis conversations.  Existing data is only indexed after it
-- is proven unambiguous; a duplicate fails closed without deleting or merging
-- any thread or message history.
create table if not exists public.msg_canonical_thread_pairs (
  principal_low_id uuid not null references public.msg_users(id) on delete restrict,
  principal_high_id uuid not null references public.msg_users(id) on delete restrict,
  thread_id uuid not null unique references public.msg_threads(id) on delete cascade,
  conversation_type text not null check (conversation_type in ('direct', 'bot')),
  created_at timestamptz not null default now(),
  primary key (principal_low_id, principal_high_id),
  constraint msg_canonical_thread_pairs_distinct_principals
    check (principal_low_id < principal_high_id)
);

revoke all on table public.msg_canonical_thread_pairs from public, anon, authenticated, service_role;

do $reconcile_canonical_thread_pairs$
declare
  v_conflict text;
begin
  with candidates as (
    select
      t.id as thread_id,
      t.thread_type as conversation_type,
      (array_agg(p.user_id order by p.user_id))[1] as principal_low_id,
      (array_agg(p.user_id order by p.user_id))[2] as principal_high_id
    from public.msg_threads t
    join public.msg_thread_participants p
      on p.thread_id = t.id
     and p.left_at is null
    where t.is_active is true
      and t.thread_type in ('direct', 'bot')
    group by t.id, t.thread_type
    having count(*) = 2
  ), duplicates as (
    select principal_low_id, principal_high_id, array_agg(thread_id order by thread_id) as thread_ids
    from candidates
    group by principal_low_id, principal_high_id
    having count(*) > 1
  )
  select format('%s:%s:%s', principal_low_id, principal_high_id, thread_ids)
  into v_conflict
  from duplicates
  order by principal_low_id, principal_high_id
  limit 1;

  if v_conflict is not null then
    raise exception using
      errcode = '23505',
      message = 'Cannot install canonical Messenger pair uniqueness while duplicate active direct or bot conversations exist: ' || v_conflict;
  end if;

  with candidates as (
    select
      t.id as thread_id,
      t.thread_type as conversation_type,
      (array_agg(p.user_id order by p.user_id))[1] as principal_low_id,
      (array_agg(p.user_id order by p.user_id))[2] as principal_high_id
    from public.msg_threads t
    join public.msg_thread_participants p
      on p.thread_id = t.id
     and p.left_at is null
    where t.is_active is true
      and t.thread_type in ('direct', 'bot')
    group by t.id, t.thread_type
    having count(*) = 2
  )
  insert into public.msg_canonical_thread_pairs(
    principal_low_id, principal_high_id, thread_id, conversation_type
  )
  select principal_low_id, principal_high_id, thread_id, conversation_type
  from candidates
  on conflict (principal_low_id, principal_high_id) do nothing;
end
$reconcile_canonical_thread_pairs$;

create or replace function public.msg_is_retired_ops_manager_shared_thread(p_thread_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.msg_threads t
    where t.id = p_thread_id
      and t.system_key = 'ops_manager_shared_chat_v1'
  );
$function$;

create or replace function public.msg_is_retired_ops_manager_shared_message(p_message_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.msg_messages m
    join public.msg_threads t on t.id = m.thread_id
    where m.id = p_message_id
      and t.system_key = 'ops_manager_shared_chat_v1'
  );
$function$;

create or replace function public.msg_assert_not_retired_ops_manager_shared_thread(p_thread_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if public.msg_is_retired_ops_manager_shared_thread(p_thread_id) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership conversation is immutable';
  end if;
end
$function$;

create or replace function public.msg_assert_not_retired_ops_manager_shared_message(p_message_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if public.msg_is_retired_ops_manager_shared_message(p_message_id) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message history is immutable';
  end if;
end
$function$;

-- Use OLD and NEW identity, never title text, to keep the exact archived room
-- and historical participation immutable even to service_role.  INSERT is
-- included to reserve the key permanently; UPDATE and DELETE preserve every
-- physical column and prevent FK cascades from erasing history.
create or replace function public.msg_reject_retired_ops_manager_shared_thread_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' and new.system_key = 'ops_manager_shared_chat_v1' then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership conversation cannot be recreated';
  end if;

  if tg_op = 'UPDATE'
     and (old.system_key = 'ops_manager_shared_chat_v1'
       or new.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership conversation is immutable';
  end if;

  if tg_op = 'DELETE' and old.system_key = 'ops_manager_shared_chat_v1' then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership conversation cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create or replace function public.msg_reject_retired_ops_manager_shared_participation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT'
     and exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership participant history is immutable';
  end if;

  if tg_op = 'UPDATE'
     and (
       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership participant history is immutable';
  end if;

  if tg_op = 'DELETE'
     and exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership participant history cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create or replace function public.msg_reject_retired_ops_manager_shared_message_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT'
     and exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'No message may be created in the retired Operations Leadership conversation';
  end if;

  if tg_op = 'UPDATE'
     and (
       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message history is immutable';
  end if;

  if tg_op = 'DELETE'
     and exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message history cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create or replace function public.msg_reject_retired_ops_manager_shared_message_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT'
     and (
       exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message audit is immutable';
  end if;

  if tg_op = 'UPDATE'
     and (
       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_threads t where t.id = new.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message audit is immutable';
  end if;

  if tg_op = 'DELETE'
     and (
       exists (select 1 from public.msg_threads t where t.id = old.thread_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership message audit cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create or replace function public.msg_reject_retired_ops_manager_shared_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT'
     and exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership receipt history is immutable';
  end if;

  if tg_op = 'UPDATE'
     and (
       exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership receipt history is immutable';
  end if;

  if tg_op = 'DELETE'
     and exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership receipt history cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

-- Message-deletion marks are also evidence attached to the archived message.
-- This closes the remaining direct-DML relationship without changing normal
-- deletion behavior for every other thread.
create or replace function public.msg_reject_retired_ops_manager_shared_message_deletion_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT'
     and exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using errcode = '23514', message = 'The retired Operations Leadership message state is immutable';
  end if;
  if tg_op = 'UPDATE'
     and (
       exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1')
       or exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = new.message_id and t.system_key = 'ops_manager_shared_chat_v1')
     ) then
    raise exception using errcode = '23514', message = 'The retired Operations Leadership message state is immutable';
  end if;
  if tg_op = 'DELETE'
     and exists (select 1 from public.msg_messages m join public.msg_threads t on t.id = m.thread_id where m.id = old.message_id and t.system_key = 'ops_manager_shared_chat_v1') then
    raise exception using errcode = '23514', message = 'The retired Operations Leadership message state cannot be deleted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

revoke all on function public.msg_is_retired_ops_manager_shared_thread(uuid) from public, anon, authenticated, service_role;
revoke all on function public.msg_is_retired_ops_manager_shared_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.msg_assert_not_retired_ops_manager_shared_thread(uuid) from public, anon, authenticated, service_role;
revoke all on function public.msg_assert_not_retired_ops_manager_shared_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_thread_mutation() from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_participation() from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_message_mutation() from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_message_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_receipt_mutation() from public, anon, authenticated, service_role;
revoke all on function public.msg_reject_retired_ops_manager_shared_message_deletion_mutation() from public, anon, authenticated, service_role;

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_thread_mutation on public.msg_threads;
create trigger trg_msg_reject_retired_ops_manager_shared_thread_mutation
before insert or update or delete on public.msg_threads
for each row execute function public.msg_reject_retired_ops_manager_shared_thread_mutation();

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_participation on public.msg_thread_participants;
create trigger trg_msg_reject_retired_ops_manager_shared_participation
before insert or update or delete on public.msg_thread_participants
for each row execute function public.msg_reject_retired_ops_manager_shared_participation();

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_message_mutation on public.msg_messages;
create trigger trg_msg_reject_retired_ops_manager_shared_message_mutation
before insert or update or delete on public.msg_messages
for each row execute function public.msg_reject_retired_ops_manager_shared_message_mutation();

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_audit_guard on public.msg_message_audit;
create trigger trg_msg_reject_retired_ops_manager_shared_audit_guard
before insert or update or delete on public.msg_message_audit
for each row execute function public.msg_reject_retired_ops_manager_shared_message_audit_mutation();

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_receipt_mutation on public.msg_receipts;
create trigger trg_msg_reject_retired_ops_manager_shared_receipt_mutation
before insert or update or delete on public.msg_receipts
for each row execute function public.msg_reject_retired_ops_manager_shared_receipt_mutation();

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_message_delete on public.msg_message_deletions;
create trigger trg_msg_reject_retired_ops_manager_shared_message_delete
before insert or update or delete on public.msg_message_deletions
for each row execute function public.msg_reject_retired_ops_manager_shared_message_deletion_mutation();

-- All receipt state writers reject the archive before attempting an UPDATE.
-- The table trigger remains the final authority for raw service_role DML.
create or replace function public.msg_acknowledge_message(p_message_id uuid, p_user_id uuid, p_device_identifier text)
returns public.msg_receipts
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_not_retired_ops_manager_shared_message(p_message_id);
  update public.msg_receipts
  set delivered_at=coalesce(delivered_at,now()),
      displayed_at=coalesce(displayed_at,now()),
      read_at=coalesce(read_at,now()),
      acknowledged_at=coalesce(acknowledged_at,now()),
      delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), '')
  where message_id=p_message_id and user_id=p_user_id
  returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_message_delivered(p_message_id uuid, p_user_id uuid, p_device_identifier text)
returns public.msg_receipts
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_not_retired_ops_manager_shared_message(p_message_id);
  update public.msg_receipts
  set delivered_at=coalesce(delivered_at,now()),
      delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), ''),
      last_delivery_attempt_at=now(),
      delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id
  returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_message_displayed(p_message_id uuid, p_user_id uuid, p_device_identifier text)
returns public.msg_receipts
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  perform public.msg_assert_not_retired_ops_manager_shared_message(p_message_id);
  update public.msg_receipts
  set delivered_at=coalesce(delivered_at,now()),
      displayed_at=coalesce(displayed_at,now()),
      delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')), ''),
      last_delivery_attempt_at=now(),
      delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id
  returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if;
  return v_receipt;
end
$function$;

create or replace function public.msg_mark_messages_delivered(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[] default '{}'::uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_not_retired_ops_manager_shared_thread(p_thread_id);
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_messages_displayed(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[] default '{}'::uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_not_retired_ops_manager_shared_thread(p_thread_id);
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function public.msg_mark_thread_read(p_thread_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  perform public.msg_assert_not_retired_ops_manager_shared_thread(p_thread_id);
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now()),
      read_at = coalesce(r.read_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

-- One transaction-scoped lock namespace covers both direct and Memphis pair
-- resolution.  The post-lock recheck and unique pair row make retries and
-- concurrent devices converge on one stable thread id.
create or replace function public.msg_get_or_create_direct_thread(p_user_a uuid, p_user_b uuid)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_pair public.msg_canonical_thread_pairs%rowtype;
  v_low uuid;
  v_high uuid;
begin
  if p_user_a is null or p_user_b is null then raise exception 'Both users are required.'; end if;
  if p_user_a = p_user_b then raise exception 'Direct thread requires two different users.'; end if;
  if not exists (select 1 from public.msg_users where id = p_user_a and is_active is true) then raise exception 'User A not found or inactive.'; end if;
  if not exists (select 1 from public.msg_users where id = p_user_b and is_active is true) then raise exception 'User B not found or inactive.'; end if;

  v_low := least(p_user_a, p_user_b);
  v_high := greatest(p_user_a, p_user_b);
  perform pg_advisory_xact_lock(hashtextextended(
    'msg-canonical-conversation-pair:v1:' || v_low::text || ':' || v_high::text,
    0
  ));

  select * into v_pair
  from public.msg_canonical_thread_pairs
  where principal_low_id = v_low and principal_high_id = v_high
  for update;

  if v_pair.thread_id is not null then
    select t.* into v_thread
    from public.msg_threads t
    join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_a and p1.left_at is null
    join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=p_user_b and p2.left_at is null
    where t.id=v_pair.thread_id
      and t.is_active is true
      and t.thread_type in ('direct','bot')
      and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null);
    if v_thread.id is not null then return v_thread; end if;
    delete from public.msg_canonical_thread_pairs
    where principal_low_id=v_low and principal_high_id=v_high;
  end if;

  select t.* into v_thread
  from public.msg_threads t
  join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_a and p1.left_at is null
  join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=p_user_b and p2.left_at is null
  where t.thread_type='direct'
    and t.is_active is true
    and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null)
  order by t.created_at asc, t.id asc
  limit 1;

  if v_thread.id is null then
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active)
    values ('direct',null,p_user_a,true)
    returning * into v_thread;
    insert into public.msg_thread_participants(thread_id,user_id)
    values (v_thread.id,p_user_a),(v_thread.id,p_user_b);
  end if;

  insert into public.msg_canonical_thread_pairs(principal_low_id,principal_high_id,thread_id,conversation_type)
  values(v_low,v_high,v_thread.id,v_thread.thread_type)
  on conflict (principal_low_id,principal_high_id) do nothing;
  return v_thread;
end
$function$;

create or replace function public.msg_get_or_create_memphis_thread(p_user_id uuid)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_memphis_user_id uuid;
  v_thread public.msg_threads%rowtype;
  v_pair public.msg_canonical_thread_pairs%rowtype;
  v_low uuid;
  v_high uuid;
begin
  if p_user_id is null then raise exception 'user_id is required.'; end if;
  if not public.msg_is_runtime_user(p_user_id) then raise exception 'User is not an active custodial Messenger identity.'; end if;

  select mu.id into v_memphis_user_id
  from public.msg_users mu
  where mu.is_active is true
    and mu.role='bot'
    and lower(btrim(mu.display_name))='memphis'
  order by mu.created_at asc, mu.id asc
  limit 1;
  if v_memphis_user_id is null then raise exception 'Memphis bot user not found.'; end if;
  if p_user_id=v_memphis_user_id then raise exception 'Memphis cannot create a conversation with itself.'; end if;

  v_low := least(p_user_id,v_memphis_user_id);
  v_high := greatest(p_user_id,v_memphis_user_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'msg-canonical-conversation-pair:v1:' || v_low::text || ':' || v_high::text,
    0
  ));

  select * into v_pair
  from public.msg_canonical_thread_pairs
  where principal_low_id=v_low and principal_high_id=v_high
  for update;

  if v_pair.thread_id is not null then
    select t.* into v_thread
    from public.msg_threads t
    join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_id and p1.left_at is null
    join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=v_memphis_user_id and p2.left_at is null
    where t.id=v_pair.thread_id
      and t.is_active is true
      and t.thread_type in ('direct','bot')
      and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null);
    if v_thread.id is null then
      delete from public.msg_canonical_thread_pairs where principal_low_id=v_low and principal_high_id=v_high;
    end if;
  end if;

  if v_thread.id is null then
    select t.* into v_thread
    from public.msg_threads t
    join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_id and p1.left_at is null
    join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=v_memphis_user_id and p2.left_at is null
    where t.is_active is true
      and t.thread_type in ('bot','direct')
      and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null)
    order by case when t.thread_type='bot' then 0 else 1 end, t.created_at asc, t.id asc
    limit 1;
  end if;

  if v_thread.id is null then
    insert into public.msg_threads(thread_type,title,created_by_user_id,is_active)
    values('bot','Memphis',p_user_id,true)
    returning * into v_thread;
    insert into public.msg_thread_participants(thread_id,user_id)
    values(v_thread.id,p_user_id),(v_thread.id,v_memphis_user_id);
  elsif v_thread.thread_type is distinct from 'bot' or v_thread.title is distinct from 'Memphis' then
    update public.msg_threads
    set thread_type='bot',title='Memphis',updated_at=now()
    where id=v_thread.id
    returning * into v_thread;
  end if;

  insert into public.msg_canonical_thread_pairs(principal_low_id,principal_high_id,thread_id,conversation_type)
  values(v_low,v_high,v_thread.id,'bot')
  on conflict (principal_low_id,principal_high_id)
  do update set thread_id=excluded.thread_id,conversation_type=excluded.conversation_type
  where public.msg_canonical_thread_pairs.thread_id is distinct from excluded.thread_id
     or public.msg_canonical_thread_pairs.conversation_type is distinct from excluded.conversation_type;
  return v_thread;
end
$function$;

comment on function public.msg_reject_retired_ops_manager_shared_thread_mutation() is
  'Preserves the exact retired Operations Leadership room against recreation, mutation, deletion, and cascades.';
comment on function public.msg_reject_retired_ops_manager_shared_participation() is
  'Preserves every retired Operations Leadership participant relationship against fabrication, reassignment, mutation, and deletion.';
comment on function public.msg_reject_retired_ops_manager_shared_message_mutation() is
  'Prevents post-retirement messages and preserves archived Operations Leadership messages byte-for-byte.';
comment on function public.msg_reject_retired_ops_manager_shared_message_audit_mutation() is
  'Preserves archived Operations Leadership message audit relationships byte-for-byte.';
comment on function public.msg_reject_retired_ops_manager_shared_receipt_mutation() is
  'Preserves archived Operations Leadership delivery, display, read, and acknowledgement receipt state byte-for-byte.';

commit;
