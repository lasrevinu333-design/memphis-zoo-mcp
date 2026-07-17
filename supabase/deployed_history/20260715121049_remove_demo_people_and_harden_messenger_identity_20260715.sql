-- Deployed migration history snapshot: 20260715121049 remove_demo_people_and_harden_messenger_identity_20260715

do $do$
declare
  v_batch constant text := 'remove_demo_leadership_profiles_20260715';
  v_clayton_employee constant uuid := '85170562-5f48-4e3d-9df6-760d0e3ff5f0';
  v_jennifer_employee constant uuid := 'f982df75-54fb-4547-a5c6-e8845d54a171';
  v_clayton_user constant uuid := '8b22f104-a097-4d46-80fd-d04de5c3cf0d';
  v_jennifer_user constant uuid := '8366f6d2-7b65-4485-a978-5d21e7e9c3c0';
begin
  if not exists (
    select 1 from public.internal_ops_contacts
    where lower(display_name) = 'jennifer sheffield'
      and active = true
      and nullif(btrim(phone), '') is not null
  ) then
    raise exception 'Jennifer Sheffield operations contact record is missing; refusing cleanup.';
  end if;

  if (select count(*) from public.ops_manager_weekly_schedules
      where lower(display_name) = 'jennifer sheffield' and active = true) = 0 then
    raise exception 'Jennifer Sheffield operations schedule is missing; refusing cleanup.';
  end if;

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.completion_responses', cr.id::text, to_jsonb(cr), 'approved_foundation_repair'
  from public.completion_responses cr
  join public.sessions s on s.id = cr.session_id
  where s.employee_id in (v_clayton_employee, v_jennifer_employee)
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.completion_responses' and a.source_id=cr.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.session_events', se.id::text, to_jsonb(se), 'approved_foundation_repair'
  from public.session_events se
  join public.sessions s on s.id = se.session_id
  where s.employee_id in (v_clayton_employee, v_jennifer_employee)
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.session_events' and a.source_id=se.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.sessions', s.id::text, to_jsonb(s), 'approved_foundation_repair'
  from public.sessions s
  where s.employee_id in (v_clayton_employee, v_jennifer_employee)
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.sessions' and a.source_id=s.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.msg_thread_participants', tp.id::text, to_jsonb(tp), 'approved_foundation_repair'
  from public.msg_thread_participants tp
  where tp.thread_id in (
    select p.thread_id from public.msg_thread_participants p
    where p.user_id in (v_clayton_user, v_jennifer_user)
  )
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.msg_thread_participants' and a.source_id=tp.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.msg_threads', t.id::text, to_jsonb(t), 'approved_foundation_repair'
  from public.msg_threads t
  where t.id in (
    select p.thread_id from public.msg_thread_participants p
    where p.user_id in (v_clayton_user, v_jennifer_user)
  )
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.msg_threads' and a.source_id=t.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.msg_users', mu.id::text, to_jsonb(mu), 'approved_foundation_repair'
  from public.msg_users mu
  where mu.id in (v_clayton_user, v_jennifer_user)
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.msg_users' and a.source_id=mu.id::text
    );

  insert into archive.removed_operational_test_rows(removal_batch, source_table, source_id, row_json, archived_by)
  select v_batch, 'public.employees', e.id::text, to_jsonb(e), 'approved_foundation_repair'
  from public.employees e
  where e.id in (v_clayton_employee, v_jennifer_employee)
    and not exists (
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch=v_batch and a.source_table='public.employees' and a.source_id=e.id::text
    );

  delete from public.completion_responses cr
  using public.sessions s
  where cr.session_id=s.id and s.employee_id in (v_clayton_employee,v_jennifer_employee);

  delete from public.session_events se
  using public.sessions s
  where se.session_id=s.id and s.employee_id in (v_clayton_employee,v_jennifer_employee);

  delete from public.sessions
  where employee_id in (v_clayton_employee,v_jennifer_employee);

  delete from public.msg_threads t
  where t.id in (
    select p.thread_id from public.msg_thread_participants p
    where p.user_id in (v_clayton_user,v_jennifer_user)
  );

  delete from public.msg_users where id in (v_clayton_user,v_jennifer_user);
  delete from public.employees where id in (v_clayton_employee,v_jennifer_employee);

  if exists (select 1 from public.msg_users where id in (v_clayton_user,v_jennifer_user))
     or exists (select 1 from public.employees where id in (v_clayton_employee,v_jennifer_employee)) then
    raise exception 'Demo leadership identities were not completely removed.';
  end if;
end
$do$;

create or replace function public.msg_is_runtime_identity(p_user_id uuid)
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
        or (mu.role = 'employee' and e.id is not null and e.active = true)
        or (
          mu.role = 'manager'
          and mu.employee_id is null
          and lower(btrim(mu.display_name)) = 'ops manager'
        )
      )
  );
$function$;

revoke all on function public.msg_is_runtime_identity(uuid) from public, anon, authenticated;
grant execute on function public.msg_is_runtime_identity(uuid) to service_role;

create or replace function public.msg_list_users(p_current_user_id uuid)
returns table(id uuid, display_name text, role text, is_active boolean)
language sql
stable
set search_path = pg_catalog, public
as $function$
  select mu.id, mu.display_name, mu.role, mu.is_active
  from public.msg_users mu
  where public.msg_is_runtime_identity(mu.id)
    and (p_current_user_id is null or mu.id <> p_current_user_id)
  order by
    case when mu.role = 'bot' then 1 when mu.role = 'manager' then 2 else 3 end,
    mu.display_name;
$function$;

revoke all on function public.msg_list_users(uuid) from public, anon, authenticated;
grant execute on function public.msg_list_users(uuid) to service_role;

create or replace function public.msg_get_or_create_memphis_thread(p_user_id uuid)
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
  if not public.msg_is_runtime_identity(p_user_id)
     or exists (select 1 from public.msg_users where id=p_user_id and role='bot') then
    raise exception 'Runtime employee or Ops Manager user not found or inactive.';
  end if;

  v_memphis_user_id := public.msg_get_memphis_user_id();
  if v_memphis_user_id is null then
    raise exception 'Memphis bot user not found.';
  end if;

  select t.* into v_thread
  from public.msg_threads t
  join public.msg_thread_participants p1 on p1.thread_id=t.id and p1.user_id=p_user_id and p1.left_at is null
  join public.msg_thread_participants p2 on p2.thread_id=t.id and p2.user_id=v_memphis_user_id and p2.left_at is null
  where t.is_active=true
    and t.thread_type in ('bot','direct')
    and 2=(select count(*) from public.msg_thread_participants px where px.thread_id=t.id and px.left_at is null)
  order by case when t.thread_type='bot' then 0 else 1 end,t.created_at asc
  limit 1;

  if v_thread.id is not null then
    if v_thread.thread_type <> 'bot' or coalesce(v_thread.title,'') <> 'Memphis' then
      update public.msg_threads
      set thread_type='bot',title='Memphis',updated_at=now()
      where id=v_thread.id
      returning * into v_thread;
    end if;
    return v_thread;
  end if;

  insert into public.msg_threads(thread_type,title,created_by_user_id,is_active)
  values('bot','Memphis',p_user_id,true)
  returning * into v_thread;

  insert into public.msg_thread_participants(thread_id,user_id)
  values(v_thread.id,p_user_id),(v_thread.id,v_memphis_user_id);

  return v_thread;
end
$function$;

revoke all on function public.msg_get_or_create_memphis_thread(uuid) from public, anon, authenticated;
grant execute on function public.msg_get_or_create_memphis_thread(uuid) to service_role;

create or replace function public.msg_mark_thread_deleted(
  p_thread_id uuid,
  p_user_id uuid,
  p_device_identifier text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_hidden_before timestamptz := clock_timestamp();
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception 'thread_id and user_id are required.';
  end if;
  if not public.msg_is_runtime_identity(p_user_id) then
    raise exception 'Runtime messaging user not found or inactive.';
  end if;
  if not exists (
    select 1 from public.msg_thread_participants tp
    where tp.thread_id=p_thread_id and tp.user_id=p_user_id and tp.left_at is null
  ) then
    raise exception 'User is not an active participant in this thread.';
  end if;

  if v_requested is not null then
    select d.device_id into v_device
    from public.devices d
    where d.active=true and upper(btrim(d.device_id))=upper(v_requested)
    union all
    select d.device_id
    from public.device_aliases da
    join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_requested)
    limit 1;
  end if;
  v_device := coalesce(v_device,v_requested,'server');

  insert into public.msg_thread_visibility(thread_id,user_id,device_identifier,hidden_before,created_at,updated_at)
  values(p_thread_id,p_user_id,v_device,v_hidden_before,now(),now())
  on conflict(thread_id,user_id,device_identifier)
  do update set hidden_before=excluded.hidden_before,updated_at=now();

  insert into public.msg_message_deletions(message_id,user_id,deleted_at)
  select m.id,p_user_id,v_hidden_before
  from public.msg_messages m
  where m.thread_id=p_thread_id
    and m.is_deleted=false
    and coalesce(m.sent_at,m.created_at)<=v_hidden_before
  on conflict(message_id,user_id) do update set deleted_at=excluded.deleted_at;
end
$function$;

create or replace function public.msg_restore_thread_visibility(
  p_thread_id uuid,
  p_user_id uuid,
  p_device_identifier text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception 'thread_id and user_id are required.';
  end if;
  if not public.msg_is_runtime_identity(p_user_id) then
    raise exception 'Runtime messaging user not found or inactive.';
  end if;
  if v_requested is not null then
    select d.device_id into v_device
    from public.devices d
    where d.active=true and upper(btrim(d.device_id))=upper(v_requested)
    union all
    select d.device_id
    from public.device_aliases da
    join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_requested)
    limit 1;
  end if;
  v_device := coalesce(v_device,v_requested,'server');

  delete from public.msg_thread_visibility
  where thread_id=p_thread_id
    and user_id=p_user_id
    and (
      device_identifier is null
      or upper(btrim(device_identifier))=upper(v_device)
      or (v_requested is not null and upper(btrim(device_identifier))=upper(v_requested))
    );
end
$function$;

revoke all on function public.msg_mark_thread_deleted(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.msg_restore_thread_visibility(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.msg_mark_thread_deleted(uuid,uuid,text) to service_role;
grant execute on function public.msg_restore_thread_visibility(uuid,uuid,text) to service_role;
