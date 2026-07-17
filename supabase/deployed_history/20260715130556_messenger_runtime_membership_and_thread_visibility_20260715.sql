-- Deployed migration history snapshot: 20260715130556 messenger_runtime_membership_and_thread_visibility_20260715

create or replace function public.msg_is_runtime_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.msg_users mu
    left join public.employees e on e.id = mu.employee_id
    where mu.id = p_user_id
      and mu.is_active = true
      and (
        (mu.role = 'bot' and lower(btrim(mu.display_name)) = 'memphis')
        or (
          mu.role in ('manager','ops','ops_manager','operations_manager')
          and mu.employee_id is null
        )
        or (
          mu.role = 'employee'
          and e.id is not null
          and e.active = true
          and coalesce(e.employee_code, '') ~ '^EMP[0-9]+'
          and exists (
            select 1
            from public.msg_device_assignments mda
            where mda.msg_user_id = mu.id
              and mda.is_active = true
          )
        )
      )
  );
$function$;

revoke all on function public.msg_is_runtime_user(uuid) from public, anon, authenticated;
grant execute on function public.msg_is_runtime_user(uuid) to service_role;

create or replace function public.msg_list_users(p_current_user_id uuid)
returns table(id uuid, display_name text, role text, is_active boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select mu.id, mu.display_name, mu.role, mu.is_active
  from public.msg_users mu
  where mu.is_active = true
    and public.msg_is_runtime_user(mu.id)
    and (p_current_user_id is null or mu.id <> p_current_user_id)
  order by
    case
      when mu.role = 'bot' then 1
      when mu.role in ('manager','ops','ops_manager','operations_manager') then 2
      else 3
    end,
    mu.display_name;
$function$;

revoke all on function public.msg_list_users(uuid) from public, anon, authenticated;
grant execute on function public.msg_list_users(uuid) to service_role;

drop function if exists public.msg_get_or_create_memphis_thread(uuid);
create function public.msg_get_or_create_memphis_thread(p_user_id uuid)
returns public.msg_threads
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_memphis_user_id uuid;
  v_thread public.msg_threads%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required.';
  end if;
  if not public.msg_is_runtime_user(p_user_id) then
    raise exception 'User is not an active custodial Messenger identity.';
  end if;

  select mu.id into v_memphis_user_id
  from public.msg_users mu
  where mu.is_active = true
    and mu.role = 'bot'
    and lower(btrim(mu.display_name)) = 'memphis'
  order by mu.created_at asc
  limit 1;

  if v_memphis_user_id is null then
    raise exception 'Memphis bot user not found.';
  end if;
  if p_user_id = v_memphis_user_id then
    raise exception 'Memphis cannot create a conversation with itself.';
  end if;

  select t.* into v_thread
  from public.msg_threads t
  join public.msg_thread_participants p1
    on p1.thread_id = t.id and p1.user_id = p_user_id and p1.left_at is null
  join public.msg_thread_participants p2
    on p2.thread_id = t.id and p2.user_id = v_memphis_user_id and p2.left_at is null
  where t.is_active = true
    and t.thread_type in ('bot','direct')
    and 2 = (
      select count(*)
      from public.msg_thread_participants px
      where px.thread_id = t.id and px.left_at is null
    )
  order by case when t.thread_type = 'bot' then 0 else 1 end, t.created_at asc
  limit 1;

  if v_thread.id is not null then
    if v_thread.thread_type <> 'bot' or coalesce(v_thread.title,'') <> 'Memphis' then
      update public.msg_threads
      set thread_type = 'bot', title = 'Memphis', updated_at = now()
      where id = v_thread.id
      returning * into v_thread;
    end if;
    return v_thread;
  end if;

  insert into public.msg_threads(thread_type, title, created_by_user_id, is_active)
  values('bot', 'Memphis', p_user_id, true)
  returning * into v_thread;

  insert into public.msg_thread_participants(thread_id, user_id)
  values(v_thread.id, p_user_id), (v_thread.id, v_memphis_user_id);

  return v_thread;
end
$function$;

revoke all on function public.msg_get_or_create_memphis_thread(uuid) from public, anon, authenticated;
grant execute on function public.msg_get_or_create_memphis_thread(uuid) to service_role;

drop function if exists public.msg_mark_thread_deleted(uuid, uuid, text);
create function public.msg_mark_thread_deleted(
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

  return jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_id', p_user_id,
    'device_identifier', v_canonical_device,
    'hidden_before', v_hidden_before,
    'deleted_message_count', v_deleted_count
  );
end
$function$;

revoke all on function public.msg_mark_thread_deleted(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.msg_mark_thread_deleted(uuid, uuid, text) to service_role;
