begin;

create table if not exists public.msg_thread_deletion_operations (
  operation_id uuid primary key,
  thread_id uuid not null,
  user_id uuid not null references public.msg_users(id) on delete cascade,
  deletion_scope text not null check (deletion_scope in ('user','global')),
  deleted_through timestamptz not null,
  deleted_at timestamptz not null default now(),
  thread_type text null,
  metadata_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_json)='object')
);

create index if not exists idx_msg_thread_deletion_operations_target
  on public.msg_thread_deletion_operations(thread_id,user_id,deleted_at desc);

alter table public.msg_thread_deletion_operations enable row level security;
alter table public.msg_thread_deletion_operations force row level security;
revoke all on public.msg_thread_deletion_operations from public,anon,authenticated;
grant select,insert,update,delete on public.msg_thread_deletion_operations to postgres,service_role;

create unique index if not exists uq_msg_thread_visibility_user_scope
  on public.msg_thread_visibility(thread_id,user_id)
  where device_identifier is null;

create or replace function public.msg_delete_message(
  p_message_id uuid,
  p_request_user_id uuid
) returns public.msg_messages
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
begin
  raise exception using
    errcode='0A000',
    message='Individual-message deletion is retired. Delete the conversation instead.';
end
$function$;

create or replace function public.msg_delete_thread(
  p_thread_id uuid,
  p_request_user_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_existing public.msg_thread_deletion_operations%rowtype;
  v_request_role text;
  v_now timestamptz := clock_timestamp();
  v_deleted_through timestamptz;
  v_is_memphis boolean := false;
begin
  if p_thread_id is null or p_request_user_id is null or p_operation_id is null then
    raise exception using errcode='22023',
      message='Thread, authenticated user, and deletion operation are required';
  end if;

  select * into v_existing
  from public.msg_thread_deletion_operations
  where operation_id=p_operation_id;

  if v_existing.operation_id is not null then
    if v_existing.thread_id<>p_thread_id
       or v_existing.user_id<>p_request_user_id
       or v_existing.deletion_scope<>'user' then
      raise exception using errcode='23505',
        message='Deletion operation id was already used for another target';
    end if;
    return jsonb_build_object(
      'ok',true,
      'thread_id',v_existing.thread_id,
      'deleted',true,
      'deletion_scope','user',
      'deleted_at',v_existing.deleted_at,
      'deleted_through',v_existing.deleted_through,
      'operation_id',v_existing.operation_id,
      'replayed',true
    );
  end if;

  select role into v_request_role
  from public.msg_users
  where id=p_request_user_id and is_active is true;

  if v_request_role is null or not public.msg_is_runtime_user(p_request_user_id) then
    raise exception using errcode='42501',
      message='Authenticated messaging user was not found';
  end if;

  select * into v_thread
  from public.msg_threads
  where id=p_thread_id
  for update;

  if v_thread.id is null then
    raise exception using errcode='P0002', message='Conversation not found';
  end if;

  if v_thread.system_key='ops_manager_shared_chat_v1' then
    raise exception using errcode='23514',
      message='The shared Ops Manager conversation cannot be deleted';
  end if;

  if v_request_role not in ('manager','admin')
     and not exists (
       select 1 from public.msg_thread_participants p
       where p.thread_id=p_thread_id
         and p.user_id=p_request_user_id
         and p.left_at is null
     ) then
    raise exception using errcode='42501',
      message='Only a participant or Ops Manager can remove this conversation';
  end if;

  v_deleted_through := greatest(
    v_now,
    coalesce((
      select max(coalesce(m.sent_at,m.created_at))
      from public.msg_messages m
      where m.thread_id=p_thread_id
    ),v_now)
  );

  delete from public.msg_thread_visibility
  where thread_id=p_thread_id
    and user_id=p_request_user_id
    and device_identifier is null;

  insert into public.msg_thread_visibility(
    thread_id,user_id,device_identifier,hidden_before,created_at,updated_at
  ) values (
    p_thread_id,p_request_user_id,null,v_deleted_through,v_now,v_now
  );

  select exists(
    select 1
    from public.msg_thread_participants p
    join public.msg_users u on u.id=p.user_id
    where p.thread_id=p_thread_id
      and p.left_at is null
      and u.role='bot'
      and lower(btrim(u.display_name))='memphis'
  ) into v_is_memphis;

  if v_is_memphis then
    update public.msg_thread_participants
    set left_at=coalesce(left_at,v_now)
    where thread_id=p_thread_id
      and user_id=p_request_user_id
      and left_at is null;
  end if;

  insert into public.msg_thread_deletion_operations(
    operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,
    thread_type,metadata_json
  ) values (
    p_operation_id,p_thread_id,p_request_user_id,'user',v_deleted_through,v_now,
    v_thread.thread_type,
    jsonb_build_object('memphis_generation_ended',v_is_memphis)
  );

  update public.msg_threads
  set updated_at=v_now
  where id=p_thread_id;

  return jsonb_build_object(
    'ok',true,
    'thread_id',p_thread_id,
    'deleted',true,
    'deletion_scope','user',
    'deleted_at',v_now,
    'deleted_through',v_deleted_through,
    'operation_id',p_operation_id,
    'memphis_generation_ended',v_is_memphis,
    'replayed',false
  );
end
$function$;

create or replace function public.msg_admin_tombstone_thread(
  p_thread_id uuid,
  p_request_user_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_thread public.msg_threads%rowtype;
  v_existing public.msg_thread_deletion_operations%rowtype;
  v_request_role text;
  v_now timestamptz := clock_timestamp();
  v_deleted_messages integer := 0;
begin
  if p_thread_id is null or p_request_user_id is null or p_operation_id is null then
    raise exception using errcode='22023',
      message='Thread, authenticated admin, and deletion operation are required';
  end if;

  select * into v_existing
  from public.msg_thread_deletion_operations
  where operation_id=p_operation_id;

  if v_existing.operation_id is not null then
    if v_existing.thread_id<>p_thread_id
       or v_existing.user_id<>p_request_user_id
       or v_existing.deletion_scope<>'global' then
      raise exception using errcode='23505',
        message='Deletion operation id was already used for another target';
    end if;
    return jsonb_build_object(
      'ok',true,
      'thread_id',v_existing.thread_id,
      'deleted',true,
      'deletion_scope','global',
      'deleted_at',v_existing.deleted_at,
      'purge_after',v_existing.deleted_at+interval '14 days',
      'operation_id',v_existing.operation_id,
      'replayed',true
    );
  end if;

  select role into v_request_role
  from public.msg_users
  where id=p_request_user_id and is_active is true;

  if v_request_role<>'admin' then
    raise exception using errcode='42501',
      message='An active Messenger admin is required for global tombstoning';
  end if;

  select * into v_thread
  from public.msg_threads
  where id=p_thread_id
  for update;

  if v_thread.id is null then
    raise exception using errcode='P0002', message='Conversation not found';
  end if;

  if v_thread.system_key='ops_manager_shared_chat_v1' then
    raise exception using errcode='23514',
      message='The shared Ops Manager conversation cannot be globally tombstoned';
  end if;

  update public.msg_messages
  set is_deleted=true,
      body='[deleted]',
      deleted_at=coalesce(deleted_at,v_now),
      deleted_by_user_id=coalesce(deleted_by_user_id,p_request_user_id),
      purge_after=coalesce(purge_after,coalesce(deleted_at,v_now)+interval '14 days'),
      metadata_json=(coalesce(metadata_json,'{}'::jsonb)-'deleted_by'-'deleted_at')
        || jsonb_build_object(
          'deletion_retention_days',14,
          'conversation_globally_tombstoned',true
        ),
      updated_at=v_now
  where thread_id=p_thread_id
    and is_deleted is false;
  get diagnostics v_deleted_messages=row_count;

  update public.msg_threads
  set is_active=false,
      deleted_at=v_now,
      deleted_by_user_id=p_request_user_id,
      deletion_operation_id=p_operation_id,
      purge_after=v_now+interval '14 days',
      last_message_at=null,
      updated_at=v_now
  where id=p_thread_id
  returning * into v_thread;

  insert into public.msg_thread_deletion_operations(
    operation_id,thread_id,user_id,deletion_scope,deleted_through,deleted_at,
    thread_type,metadata_json
  ) values (
    p_operation_id,p_thread_id,p_request_user_id,'global',v_now,v_now,
    v_thread.thread_type,
    jsonb_build_object('deleted_message_count',v_deleted_messages)
  );

  return jsonb_build_object(
    'ok',true,
    'thread_id',p_thread_id,
    'deleted',true,
    'deletion_scope','global',
    'deleted_at',v_now,
    'purge_after',v_now+interval '14 days',
    'operation_id',p_operation_id,
    'deleted_message_count',v_deleted_messages,
    'replayed',false
  );
end
$function$;

create or replace function public.mz_reject_event_messenger_message()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $function$
begin
  if lower(coalesce(new.metadata_json->>'source',''))='events_app' then
    raise exception using
      errcode='23514',
      message='Event notifications are native-only and cannot create Messenger messages';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_mz_reject_event_messenger_message on public.msg_messages;
create trigger trg_mz_reject_event_messenger_message
before insert on public.msg_messages
for each row execute function public.mz_reject_event_messenger_message();

with tombstoned as (
  update public.msg_messages
  set is_deleted=true,
      body='[deleted]',
      deleted_at=coalesce(deleted_at,now()),
      purge_after=coalesce(purge_after,coalesce(deleted_at,now())+interval '14 days'),
      metadata_json=coalesce(metadata_json,'{}'::jsonb)
        || jsonb_build_object(
          'legacy_event_chat_tombstone',true,
          'deletion_retention_days',14
        ),
      updated_at=now()
  where coalesce(metadata_json->>'source','')='events_app'
    and is_deleted is false
  returning thread_id
)
update public.msg_threads t
set last_message_at=(
      select max(coalesce(m.sent_at,m.created_at))
      from public.msg_messages m
      where m.thread_id=t.id and m.is_deleted is false
    ),
    updated_at=now()
where t.id in (select distinct thread_id from tombstoned);

revoke all on function public.msg_delete_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.msg_delete_thread(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.msg_admin_tombstone_thread(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.mz_reject_event_messenger_message() from public,anon,authenticated;
grant execute on function public.msg_delete_message(uuid,uuid) to postgres,service_role;
grant execute on function public.msg_delete_thread(uuid,uuid,uuid) to postgres,service_role;
grant execute on function public.msg_admin_tombstone_thread(uuid,uuid,uuid) to postgres,service_role;

comment on table public.msg_thread_deletion_operations is
  'Replay-safe ledger for user-scoped conversation removal and admin-only global tombstones. Thread ids intentionally survive content purge.';
comment on function public.msg_delete_message(uuid,uuid) is
  'Retired fail-closed compatibility entry point. Messenger deletes whole conversations, not individual messages.';
comment on function public.msg_delete_thread(uuid,uuid,uuid) is
  'Removes a conversation only for the authenticated user through a visibility cutoff. Memphis deletion ends that user thread generation.';
comment on function public.msg_admin_tombstone_thread(uuid,uuid,uuid) is
  'Admin-only global conversation tombstone with immediate hiding and 14-day hard-purge retention.';
comment on function public.mz_reject_event_messenger_message() is
  'Database guard enforcing native-only event delivery by rejecting new events_app Messenger rows.';

commit;
