-- Messenger v5: permanent conversation deletion, 14-day deleted-content
-- retention, one shared Ops Manager messaging identity, and removal of the
-- unsolicited singleton Custodial Team room.

alter table public.msg_users
  add column if not exists messaging_identity_key text;

alter table public.msg_users
  drop constraint if exists msg_users_messaging_identity_key_format_chk;
alter table public.msg_users
  add constraint msg_users_messaging_identity_key_format_chk
  check (
    messaging_identity_key is null
    or messaging_identity_key ~ '^[a-z][a-z0-9_]{2,79}$'
  );

create unique index if not exists uq_msg_users_messaging_identity_key
  on public.msg_users(messaging_identity_key)
  where messaging_identity_key is not null;

alter table public.msg_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid,
  add column if not exists purge_after timestamptz;

alter table public.msg_messages
  drop constraint if exists msg_messages_deleted_by_user_id_fkey;
alter table public.msg_messages
  add constraint msg_messages_deleted_by_user_id_fkey
  foreign key (deleted_by_user_id) references public.msg_users(id) on delete set null;

update public.msg_messages
set deleted_at = coalesce(
      case
        when metadata_json ->> 'deleted_at' ~ '^\d{4}-\d{2}-\d{2}T'
        then (metadata_json ->> 'deleted_at')::timestamptz
      end,
      updated_at,
      now()
    ),
    deleted_by_user_id = case
      when metadata_json ->> 'deleted_by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and exists (
         select 1 from public.msg_users u
         where u.id = (metadata_json ->> 'deleted_by')::uuid
       )
      then (metadata_json ->> 'deleted_by')::uuid
      else deleted_by_user_id
    end,
    purge_after = coalesce(
      case
        when metadata_json ->> 'deleted_at' ~ '^\d{4}-\d{2}-\d{2}T'
        then (metadata_json ->> 'deleted_at')::timestamptz
      end,
      updated_at,
      now()
    ) + interval '14 days'
where is_deleted is true
  and (deleted_at is null or purge_after is null);

alter table public.msg_messages
  drop constraint if exists msg_messages_deletion_state_chk;
alter table public.msg_messages
  add constraint msg_messages_deletion_state_chk
  check (
    (is_deleted is false and deleted_at is null and purge_after is null)
    or
    (is_deleted is true and deleted_at is not null and purge_after = deleted_at + interval '14 days')
  );

create index if not exists idx_msg_messages_deleted_purge
  on public.msg_messages(purge_after, id)
  where is_deleted is true;

alter table public.msg_threads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid,
  add column if not exists deletion_operation_id uuid,
  add column if not exists purge_after timestamptz;

alter table public.msg_threads
  drop constraint if exists msg_threads_deleted_by_user_id_fkey;
alter table public.msg_threads
  add constraint msg_threads_deleted_by_user_id_fkey
  foreign key (deleted_by_user_id) references public.msg_users(id) on delete set null;

alter table public.msg_threads
  drop constraint if exists msg_threads_deletion_state_chk;
alter table public.msg_threads
  add constraint msg_threads_deletion_state_chk
  check (
    (deleted_at is null and purge_after is null)
    or
    (is_active is false and deleted_at is not null and purge_after = deleted_at + interval '14 days')
  );

create unique index if not exists uq_msg_threads_deletion_operation
  on public.msg_threads(deletion_operation_id)
  where deletion_operation_id is not null;

create index if not exists idx_msg_threads_deleted_purge
  on public.msg_threads(purge_after, id)
  where deleted_at is not null;

-- Pick the established device-backed generic Ops Manager identity and make it
-- the only public messaging principal for every authenticated manager.
do $shared_ops_identity$
declare
  v_shared_user_id uuid;
begin
  select u.id into v_shared_user_id
  from public.msg_users u
  where u.ops_manager_id is null
    and lower(btrim(u.display_name)) = 'ops manager'
    and u.role in ('manager','ops','ops_manager','operations_manager')
  order by
    (select count(*) from public.msg_device_assignments d where d.msg_user_id=u.id) desc,
    u.created_at,
    u.id
  limit 1
  for update;

  if v_shared_user_id is null then
    insert into public.msg_users(
      display_name, role, is_active, messaging_identity_key
    ) values (
      'Ops Manager', 'manager', true, 'ops_manager_shared_identity_v1'
    )
    returning id into v_shared_user_id;
  else
    update public.msg_users
    set display_name='Ops Manager',
        role='manager',
        is_active=true,
        messaging_identity_key='ops_manager_shared_identity_v1',
        updated_at=now()
    where id=v_shared_user_id;
  end if;

  -- Merge durable delivery state before disabling the individual principals.
  insert into public.msg_receipts(
    message_id,user_id,delivered_at,read_at,displayed_at,acknowledged_at,
    queued_at,delivery_device_identifier,last_delivery_attempt_at,delivery_attempts
  )
  select
    r.message_id,v_shared_user_id,
    min(r.delivered_at),min(r.read_at),min(r.displayed_at),min(r.acknowledged_at),
    min(r.queued_at),max(r.delivery_device_identifier),max(r.last_delivery_attempt_at),max(r.delivery_attempts)
  from public.msg_receipts r
  join public.msg_users u on u.id=r.user_id
  where u.ops_manager_id is not null
  group by r.message_id
  on conflict(message_id,user_id) do update set
    delivered_at=coalesce(msg_receipts.delivered_at,excluded.delivered_at),
    read_at=coalesce(msg_receipts.read_at,excluded.read_at),
    displayed_at=coalesce(msg_receipts.displayed_at,excluded.displayed_at),
    acknowledged_at=coalesce(msg_receipts.acknowledged_at,excluded.acknowledged_at),
    queued_at=least(msg_receipts.queued_at,excluded.queued_at),
    last_delivery_attempt_at=greatest(msg_receipts.last_delivery_attempt_at,excluded.last_delivery_attempt_at),
    delivery_attempts=greatest(msg_receipts.delivery_attempts,excluded.delivery_attempts);

  insert into public.msg_thread_participants(thread_id,user_id,joined_at,left_at)
  select
    p.thread_id,v_shared_user_id,min(p.joined_at),
    case when bool_or(p.left_at is null) then null else max(p.left_at) end
  from public.msg_thread_participants p
  join public.msg_users u on u.id=p.user_id
  where u.ops_manager_id is not null
  group by p.thread_id
  on conflict(thread_id,user_id) do update set
    joined_at=least(msg_thread_participants.joined_at,excluded.joined_at),
    left_at=case
      when msg_thread_participants.left_at is null or excluded.left_at is null then null
      else greatest(msg_thread_participants.left_at,excluded.left_at)
    end;

  insert into public.msg_message_deletions(message_id,user_id,deleted_at)
  select d.message_id,v_shared_user_id,min(d.deleted_at)
  from public.msg_message_deletions d
  join public.msg_users u on u.id=d.user_id
  where u.ops_manager_id is not null
  group by d.message_id
  on conflict(message_id,user_id) do update
  set deleted_at=least(msg_message_deletions.deleted_at,excluded.deleted_at);

  update public.msg_messages m
  set sender_user_id=v_shared_user_id
  from public.msg_users u
  where m.sender_user_id=u.id and u.ops_manager_id is not null;

  update public.msg_message_audit a
  set sender_user_id=v_shared_user_id,
      sender_display_name='Ops Manager',
      sender_role='manager'
  from public.msg_users u
  where a.sender_user_id=u.id and u.ops_manager_id is not null;

  update public.msg_threads t
  set created_by_user_id=v_shared_user_id
  from public.msg_users u
  where t.created_by_user_id=u.id and u.ops_manager_id is not null;

  update public.msg_broadcasts b
  set created_by_user_id=v_shared_user_id
  from public.msg_users u
  where b.created_by_user_id=u.id and u.ops_manager_id is not null;

  insert into public.msg_broadcast_recipients(
    broadcast_id,user_id,delivered_at,read_at,displayed_at,acknowledged_at
  )
  select
    r.broadcast_id,v_shared_user_id,min(r.delivered_at),min(r.read_at),min(r.displayed_at),min(r.acknowledged_at)
  from public.msg_broadcast_recipients r
  join public.msg_users u on u.id=r.user_id
  where u.ops_manager_id is not null
  group by r.broadcast_id
  on conflict(broadcast_id,user_id) do nothing;

  update public.events_app_notification_log l
  set msg_user_id=v_shared_user_id
  from public.msg_users u
  where l.msg_user_id=u.id and u.ops_manager_id is not null;

  update public.scan_alert_notification_log l
  set msg_user_id=v_shared_user_id
  from public.msg_users u
  where l.msg_user_id=u.id and u.ops_manager_id is not null;

  update public.scan_alert_notification_log l
  set escalation_msg_user_id=v_shared_user_id
  from public.msg_users u
  where l.escalation_msg_user_id=u.id and u.ops_manager_id is not null;

  delete from public.msg_receipts r
  using public.msg_users u
  where r.user_id=u.id and u.ops_manager_id is not null;

  delete from public.msg_message_deletions d
  using public.msg_users u
  where d.user_id=u.id and u.ops_manager_id is not null;

  delete from public.msg_thread_visibility v
  using public.msg_users u
  where v.user_id=u.id and u.ops_manager_id is not null;

  delete from public.msg_broadcast_recipients r
  using public.msg_users u
  where r.user_id=u.id and u.ops_manager_id is not null;

  delete from public.msg_thread_participants p
  using public.msg_users u
  where p.user_id=u.id and u.ops_manager_id is not null;

  update public.msg_users
  set is_active=false,
      messaging_identity_key=null,
      updated_at=now()
  where ops_manager_id is not null;
end
$shared_ops_identity$;

-- The former per-manager Memphis threads are empty artifacts from competing
-- principals. After the identity merge, retain one empty canonical Memphis
-- thread and remove only additional empty duplicates. Employee history and any
-- non-empty manager conversation are untouched.
do $remove_duplicate_manager_memphis$
declare v_duplicate_ids uuid[] := '{}'::uuid[];
begin
  select coalesce(array_agg(ranked.id),'{}'::uuid[])
  into v_duplicate_ids
  from (
    select
      t.id,
      row_number() over (order by t.created_at,t.id) as ordinal
    from public.msg_threads t
    join public.msg_users creator on creator.id=t.created_by_user_id
    where creator.messaging_identity_key='ops_manager_shared_identity_v1'
      and t.thread_type='bot'
      and t.system_key is null
      and not exists (select 1 from public.msg_messages m where m.thread_id=t.id)
  ) ranked
  where ranked.ordinal > 1;

  if coalesce(array_length(v_duplicate_ids,1),0) > 0 then
    delete from public.msg_memphis_thread_context where thread_id=any(v_duplicate_ids);
    delete from public.msg_thread_visibility where thread_id=any(v_duplicate_ids);
    delete from public.msg_hidden_threads_by_device where thread_id=any(v_duplicate_ids);
    delete from public.msg_thread_participants where thread_id=any(v_duplicate_ids);
    delete from public.msg_threads where id=any(v_duplicate_ids);
  end if;
end
$remove_duplicate_manager_memphis$;

create or replace function public.msg_ensure_ops_manager_user(
  p_manager_id uuid
) returns public.msg_users
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_user public.msg_users%rowtype;
begin
  if p_manager_id is null then
    raise exception using errcode='22023', message='Authenticated manager id is required';
  end if;

  select * into v_manager
  from public.ops_manager_managers
  where manager_id=p_manager_id
    and active is true
    and revoked_at is null;

  if v_manager.manager_id is null then
    raise exception using errcode='42501', message='Active authenticated manager was not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ops-manager-shared-messaging-identity-v1',0));

  select * into v_user
  from public.msg_users
  where messaging_identity_key='ops_manager_shared_identity_v1'
  limit 1
  for update;

  if v_user.id is null then
    insert into public.msg_users(
      display_name,role,is_active,messaging_identity_key
    ) values (
      'Ops Manager','manager',true,'ops_manager_shared_identity_v1'
    ) returning * into v_user;
  elsif v_user.is_active is false
     or coalesce(v_user.active,true) is false
     or v_user.role <> 'manager'
     or v_user.display_name is distinct from 'Ops Manager' then
    update public.msg_users
    set display_name='Ops Manager',role='manager',is_active=true,updated_at=now()
    where id=v_user.id
    returning * into v_user;
  end if;

  return v_user;
end
$function$;

create or replace function public.msg_send_message_as_ops_manager(
  p_manager_id uuid,
  p_thread_id uuid,
  p_body text,
  p_message_type text default 'text',
  p_metadata_json jsonb default '{}'::jsonb,
  p_client_message_id text default null
) returns public.msg_messages
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_user public.msg_users%rowtype;
  v_message public.msg_messages%rowtype;
begin
  v_user := public.msg_ensure_ops_manager_user(p_manager_id);
  v_message := public.msg_send_message(
    p_thread_id,v_user.id,p_body,p_message_type,
    coalesce(p_metadata_json,'{}'::jsonb) - 'authenticated_ops_manager_id',
    p_client_message_id
  );

  update public.msg_message_audit
  set sender_ops_manager_id=p_manager_id,
      sender_user_id=v_user.id,
      sender_display_name='Ops Manager',
      sender_role='manager'
  where message_id=v_message.id;

  return v_message;
end
$function$;

create or replace function public.msg_delete_message(
  p_message_id uuid,
  p_request_user_id uuid
) returns public.msg_messages
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_message public.msg_messages%rowtype;
  v_request_role text;
  v_now timestamptz := clock_timestamp();
begin
  if p_message_id is null or p_request_user_id is null then
    raise exception using errcode='22023', message='Message and authenticated user are required';
  end if;

  select role into v_request_role
  from public.msg_users
  where id=p_request_user_id and is_active is true;

  if v_request_role is null or not public.msg_is_runtime_user(p_request_user_id) then
    raise exception using errcode='42501', message='Authenticated messaging user was not found';
  end if;

  select * into v_message
  from public.msg_messages
  where id=p_message_id
  for update;

  if v_message.id is null then
    raise exception using errcode='P0002', message='Message not found';
  end if;

  if v_message.sender_user_id <> p_request_user_id
     and v_request_role not in ('manager','admin') then
    raise exception using errcode='42501', message='Only the sender or an Ops Manager can delete this message';
  end if;

  if v_message.is_deleted is false then
    update public.msg_messages
    set is_deleted=true,
        body='[deleted]',
        deleted_at=v_now,
        deleted_by_user_id=p_request_user_id,
        purge_after=v_now + interval '14 days',
        metadata_json=(coalesce(metadata_json,'{}'::jsonb) - 'deleted_by' - 'deleted_at')
          || jsonb_build_object('deletion_retention_days',14),
        updated_at=v_now
    where id=p_message_id
    returning * into v_message;

    update public.msg_threads t
    set last_message_at=(
          select max(m.sent_at) from public.msg_messages m
          where m.thread_id=v_message.thread_id and m.is_deleted is false
        ),
        updated_at=v_now
    where t.id=v_message.thread_id;
  end if;

  return v_message;
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
  v_request_role text;
  v_now timestamptz := clock_timestamp();
  v_deleted_messages integer := 0;
begin
  if p_thread_id is null or p_request_user_id is null or p_operation_id is null then
    raise exception using errcode='22023', message='Thread, authenticated user, and deletion operation are required';
  end if;

  select role into v_request_role
  from public.msg_users
  where id=p_request_user_id and is_active is true;

  if v_request_role is null or not public.msg_is_runtime_user(p_request_user_id) then
    raise exception using errcode='42501', message='Authenticated messaging user was not found';
  end if;

  select * into v_thread
  from public.msg_threads
  where id=p_thread_id
  for update;

  if v_thread.id is null then
    raise exception using errcode='P0002', message='Conversation not found';
  end if;

  if v_thread.system_key='ops_manager_shared_chat_v1' then
    raise exception using errcode='23514', message='The shared Ops Manager conversation cannot be deleted';
  end if;

  if v_request_role not in ('manager','admin')
     and not exists (
       select 1 from public.msg_thread_participants p
       where p.thread_id=p_thread_id
         and p.user_id=p_request_user_id
         and p.left_at is null
     ) then
    raise exception using errcode='42501', message='Only a participant or Ops Manager can delete this conversation';
  end if;

  if v_thread.deleted_at is not null then
    return jsonb_build_object(
      'ok',true,
      'thread_id',v_thread.id,
      'deleted',true,
      'deleted_at',v_thread.deleted_at,
      'purge_after',v_thread.purge_after,
      'operation_id',v_thread.deletion_operation_id,
      'replayed',true
    );
  end if;

  update public.msg_messages
  set is_deleted=true,
      body='[deleted]',
      deleted_at=coalesce(deleted_at,v_now),
      deleted_by_user_id=coalesce(deleted_by_user_id,p_request_user_id),
      purge_after=coalesce(purge_after,coalesce(deleted_at,v_now)+interval '14 days'),
      metadata_json=(coalesce(metadata_json,'{}'::jsonb) - 'deleted_by' - 'deleted_at')
        || jsonb_build_object('deletion_retention_days',14,'conversation_deleted',true),
      updated_at=v_now
  where thread_id=p_thread_id
    and is_deleted is false;
  get diagnostics v_deleted_messages=row_count;

  update public.msg_threads
  set is_active=false,
      deleted_at=v_now,
      deleted_by_user_id=p_request_user_id,
      deletion_operation_id=p_operation_id,
      purge_after=v_now + interval '14 days',
      last_message_at=null,
      updated_at=v_now
  where id=p_thread_id
  returning * into v_thread;

  return jsonb_build_object(
    'ok',true,
    'thread_id',v_thread.id,
    'deleted',true,
    'deleted_at',v_thread.deleted_at,
    'purge_after',v_thread.purge_after,
    'operation_id',v_thread.deletion_operation_id,
    'deleted_message_count',v_deleted_messages,
    'replayed',false
  );
end
$function$;

create or replace function public.msg_purge_deleted_content(
  p_now timestamptz default now(),
  p_batch_limit integer default 1000
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
  v_message_ids uuid[] := '{}'::uuid[];
  v_affected_thread_ids uuid[] := '{}'::uuid[];
  v_thread_ids uuid[] := '{}'::uuid[];
  v_deleted_messages integer := 0;
  v_deleted_threads integer := 0;
  v_deleted_receipts integer := 0;
  v_deleted_audit integer := 0;
begin
  if p_batch_limit is null or p_batch_limit < 1 or p_batch_limit > 10000 then
    raise exception using errcode='22023', message='Purge batch limit must be between 1 and 10000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('messenger-deleted-content-retention-v1',0));

  select
    coalesce(array_agg(candidate.id),'{}'::uuid[]),
    coalesce(array_agg(distinct candidate.thread_id),'{}'::uuid[])
  into v_message_ids,v_affected_thread_ids
  from (
    select m.id,m.thread_id
    from public.msg_messages m
    where m.is_deleted is true
      and m.deleted_at is not null
      and m.purge_after <= p_now
    order by m.purge_after,m.id
    limit p_batch_limit
    for update skip locked
  ) candidate;

  if coalesce(array_length(v_message_ids,1),0) > 0 then
    update public.events_app_notification_log
    set response_message_id=null
    where response_message_id=any(v_message_ids);

    update public.scan_alert_notification_log
    set msg_message_id=null
    where msg_message_id=any(v_message_ids);

    update public.scan_alert_notification_log
    set escalation_msg_message_id=null
    where escalation_msg_message_id=any(v_message_ids);

    delete from public.msg_message_audit where message_id=any(v_message_ids);
    get diagnostics v_deleted_audit=row_count;

    delete from public.msg_message_deletions where message_id=any(v_message_ids);

    delete from public.msg_receipts where message_id=any(v_message_ids);
    get diagnostics v_deleted_receipts=row_count;

    delete from public.msg_messages where id=any(v_message_ids);
    get diagnostics v_deleted_messages=row_count;

    update public.msg_threads t
    set last_message_at=(
          select max(m.sent_at)
          from public.msg_messages m
          where m.thread_id=t.id and m.is_deleted is false
        ),
        updated_at=p_now
    where t.id=any(v_affected_thread_ids)
      and t.deleted_at is null;
  end if;

  select coalesce(array_agg(candidate.id),'{}'::uuid[])
  into v_thread_ids
  from (
    select t.id
    from public.msg_threads t
    where t.deleted_at is not null
      and t.purge_after <= p_now
      and not exists (select 1 from public.msg_messages m where m.thread_id=t.id)
    order by t.purge_after,t.id
    limit p_batch_limit
    for update skip locked
  ) candidate;

  if coalesce(array_length(v_thread_ids,1),0) > 0 then
    update public.events_app_notification_log set thread_id=null where thread_id=any(v_thread_ids);
    update public.scan_alert_notification_log set msg_thread_id=null where msg_thread_id=any(v_thread_ids);
    update public.scan_alert_notification_log set escalation_msg_thread_id=null where escalation_msg_thread_id=any(v_thread_ids);
    delete from public.msg_broadcasts where thread_id=any(v_thread_ids);
    delete from public.msg_memphis_thread_context where thread_id=any(v_thread_ids);
    delete from public.msg_thread_visibility where thread_id=any(v_thread_ids);
    delete from public.msg_hidden_threads_by_device where thread_id=any(v_thread_ids);
    delete from public.msg_thread_participants where thread_id=any(v_thread_ids);
    delete from public.msg_threads where id=any(v_thread_ids);
    get diagnostics v_deleted_threads=row_count;
  end if;

  return jsonb_build_object(
    'ok',true,
    'retention_days',14,
    'purged_at',p_now,
    'deleted_messages',v_deleted_messages,
    'deleted_threads',v_deleted_threads,
    'deleted_receipts',v_deleted_receipts,
    'deleted_message_audit_rows',v_deleted_audit
  );
end
$function$;

create or replace function public.msg_cleanup_deleted_messages()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
declare v_result jsonb;
begin
  v_result := public.msg_purge_deleted_content(now(),1000);
  return coalesce((v_result->>'deleted_messages')::integer,0);
end
$function$;

create or replace function public.msg_purge_messages_older_than_14_days()
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,extensions
as $function$
  select public.msg_purge_deleted_content(now(),1000);
$function$;

create or replace function public.msg_purge_fully_hidden_threads()
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,extensions
as $function$
  select jsonb_build_object(
    'ok',true,
    'retired',true,
    'deleted_threads',0,
    'reason','Conversation archive is retired; only explicit deletion enters retention.'
  );
$function$;

create or replace function public.msg_mark_thread_deleted(
  p_thread_id uuid,
  p_user_id uuid,
  p_device_identifier text default null
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
begin
  raise exception using
    errcode='0A000',
    message='Conversation archive is retired. Refresh Messenger and use Delete Conversation.';
end
$function$;

create or replace function public.msg_get_or_create_custodial_team_thread(
  p_created_by_user_id uuid
) returns public.msg_threads
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $function$
begin
  raise exception using
    errcode='0A000',
    message='The automatic Custodial Team room is retired. Create an ordinary group with Select Everyone.';
end
$function$;

-- Remove the exact application-owned singleton. Its only message is already a
-- deleted tombstone; no user-created group is matched by this cleanup.
update public.events_app_notification_log
set response_message_id=null
where response_message_id in (
  select m.id from public.msg_messages m
  join public.msg_threads t on t.id=m.thread_id
  where t.system_key='custodial_team_chat_v1'
);
update public.events_app_notification_log
set thread_id=null
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
update public.scan_alert_notification_log
set msg_message_id=null
where msg_message_id in (
  select m.id from public.msg_messages m
  join public.msg_threads t on t.id=m.thread_id
  where t.system_key='custodial_team_chat_v1'
);
update public.scan_alert_notification_log
set escalation_msg_message_id=null
where escalation_msg_message_id in (
  select m.id from public.msg_messages m
  join public.msg_threads t on t.id=m.thread_id
  where t.system_key='custodial_team_chat_v1'
);
update public.scan_alert_notification_log
set msg_thread_id=null
where msg_thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
update public.scan_alert_notification_log
set escalation_msg_thread_id=null
where escalation_msg_thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_message_audit
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_message_deletions
where message_id in (
  select m.id from public.msg_messages m
  join public.msg_threads t on t.id=m.thread_id
  where t.system_key='custodial_team_chat_v1'
);
delete from public.msg_receipts
where message_id in (
  select m.id from public.msg_messages m
  join public.msg_threads t on t.id=m.thread_id
  where t.system_key='custodial_team_chat_v1'
);
delete from public.msg_messages
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_broadcasts
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_memphis_thread_context
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_thread_visibility
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_hidden_threads_by_device
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_thread_participants
where thread_id in (select id from public.msg_threads where system_key='custodial_team_chat_v1');
delete from public.msg_threads where system_key='custodial_team_chat_v1';

revoke all on function public.msg_ensure_ops_manager_user(uuid) from public,anon,authenticated;
revoke all on function public.msg_send_message_as_ops_manager(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.msg_delete_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.msg_delete_thread(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.msg_purge_deleted_content(timestamptz,integer) from public,anon,authenticated;
revoke all on function public.msg_cleanup_deleted_messages() from public,anon,authenticated;
revoke all on function public.msg_purge_messages_older_than_14_days() from public,anon,authenticated;
revoke all on function public.msg_purge_fully_hidden_threads() from public,anon,authenticated;
revoke all on function public.msg_mark_thread_deleted(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.msg_get_or_create_custodial_team_thread(uuid) from public,anon,authenticated;

grant execute on function public.msg_ensure_ops_manager_user(uuid) to service_role,postgres;
grant execute on function public.msg_send_message_as_ops_manager(uuid,uuid,text,text,jsonb,text) to service_role,postgres;
grant execute on function public.msg_delete_message(uuid,uuid) to service_role,postgres;
grant execute on function public.msg_delete_thread(uuid,uuid,uuid) to service_role,postgres;
grant execute on function public.msg_purge_deleted_content(timestamptz,integer) to service_role,postgres;
grant execute on function public.msg_cleanup_deleted_messages() to service_role,postgres;
grant execute on function public.msg_purge_messages_older_than_14_days() to service_role,postgres;
grant execute on function public.msg_purge_fully_hidden_threads() to service_role,postgres;
grant execute on function public.msg_mark_thread_deleted(uuid,uuid,text) to service_role,postgres;
grant execute on function public.msg_get_or_create_custodial_team_thread(uuid) to service_role,postgres;

comment on column public.msg_users.messaging_identity_key is
  'Application-owned key for a shared public messaging identity; manager authentication records remain separate.';
comment on function public.msg_delete_thread(uuid,uuid,uuid) is
  'Deletes one ordinary conversation for all participants, tombstones its content immediately, and schedules hard purge after 14 days.';
comment on function public.msg_purge_deleted_content(timestamptz,integer) is
  'Hard-purges only explicitly deleted Messenger content after its 14-day retention interval; never deletes ordinary old messages.';
comment on function public.msg_mark_thread_deleted(uuid,uuid,text) is
  'Retired fail-closed compatibility entry point. Conversation archive is not supported.';
comment on function public.msg_get_or_create_custodial_team_thread(uuid) is
  'Retired fail-closed compatibility entry point. Select Everyone creates an ordinary deletable group.';

-- Replace the disabled, competing archive/age jobs with one authoritative
-- retention job. Use pg_cron's supported functions rather than catalog DML.
do $messenger_retention_cron$
declare v_job record;
declare v_job_id bigint;
begin
  if to_regnamespace('cron') is null
     or to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'pg_cron schedule/unschedule functions are required';
  end if;

  for v_job in
    select jobid from cron.job
    where jobname in (
      'mz-message-cleanup-deleted-hourly',
      'mz-message-hidden-threads-hourly',
      'mz-message-purge-old-hourly',
      'mz-message-deleted-retention-hourly'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  v_job_id := cron.schedule(
    'mz-message-deleted-retention-hourly',
    '18 * * * *',
    'select public.msg_purge_deleted_content(now(),1000);'
  );
  perform cron.alter_job(v_job_id,null,null,null,null,true);
end
$messenger_retention_cron$;
