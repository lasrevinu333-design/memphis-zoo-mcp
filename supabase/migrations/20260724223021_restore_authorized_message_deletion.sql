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
  where id=p_request_user_id
    and is_active is true;

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

  if v_message.sender_user_id<>p_request_user_id
     and v_request_role<>'manager' then
    raise exception using errcode='42501', message='Only the sender or an Ops Manager can delete this message';
  end if;

  if v_message.is_deleted is false then
    update public.msg_messages
    set is_deleted=true,
        body='[deleted]',
        deleted_at=v_now,
        deleted_by_user_id=p_request_user_id,
        purge_after=v_now+interval '336 hours',
        metadata_json=(coalesce(metadata_json,'{}'::jsonb)
          - 'deleted_by' - 'deleted_at' - 'deletion_retention_days')
          || jsonb_build_object('deletion_retention_hours',336),
        updated_at=v_now
    where id=p_message_id
    returning * into v_message;

    update public.msg_threads t
    set last_message_at=(
          select max(m.sent_at)
          from public.msg_messages m
          where m.thread_id=v_message.thread_id
            and m.is_deleted is false
        ),
        updated_at=v_now
    where t.id=v_message.thread_id;
  end if;

  return v_message;
end
$function$;

revoke all on function public.msg_delete_message(uuid,uuid) from public,anon,authenticated;
grant execute on function public.msg_delete_message(uuid,uuid) to service_role,postgres;

comment on function public.msg_delete_message(uuid,uuid) is
  'Server-only, idempotent message deletion. The authenticated sender or an Ops Manager may soft-delete; retained bytes purge after exactly 336 elapsed hours.';
