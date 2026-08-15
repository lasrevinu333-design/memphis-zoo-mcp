begin;

-- Named managers have durable individual Messenger principals.  The former
-- Operations Leadership singleton is historical-only: preserve its records,
-- but remove the RPC authority that could recreate active membership.
drop function if exists public.msg_get_or_create_ops_manager_thread(uuid);

update public.msg_threads
set is_active = false,
    title = 'Operations Leadership Chat (Retired)',
    updated_at = now()
where system_key = 'ops_manager_shared_chat_v1';

update public.msg_thread_participants p
set left_at = coalesce(p.left_at, now())
from public.msg_threads t
where t.id = p.thread_id
  and t.system_key = 'ops_manager_shared_chat_v1';

-- Table writes remain available to normal Messenger workflows, so enforce the
-- retirement at the data boundary as well as by dropping the legacy RPC.
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
    if new.system_key is distinct from old.system_key then
      raise exception using
        errcode = '23514',
        message = 'The retired Operations Leadership system key is immutable';
    end if;
    if new.is_active is true then
      raise exception using
        errcode = '23514',
        message = 'The retired Operations Leadership conversation must remain inactive';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.msg_reject_retired_ops_manager_shared_thread_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_thread_mutation
  on public.msg_threads;
create trigger trg_msg_reject_retired_ops_manager_shared_thread_mutation
before insert or update of system_key, is_active on public.msg_threads
for each row execute function public.msg_reject_retired_ops_manager_shared_thread_mutation();

create or replace function public.msg_reject_retired_ops_manager_shared_participation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.left_at is null and exists (
    select 1
    from public.msg_threads t
    where t.id = new.thread_id
      and t.system_key = 'ops_manager_shared_chat_v1'
  ) then
    raise exception using
      errcode = '23514',
      message = 'The retired Operations Leadership conversation cannot have active participants';
  end if;

  return new;
end
$function$;

revoke all on function public.msg_reject_retired_ops_manager_shared_participation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_msg_reject_retired_ops_manager_shared_participation
  on public.msg_thread_participants;
create trigger trg_msg_reject_retired_ops_manager_shared_participation
before insert or update of thread_id, left_at on public.msg_thread_participants
for each row execute function public.msg_reject_retired_ops_manager_shared_participation();

comment on function public.msg_reject_retired_ops_manager_shared_thread_mutation() is
  'Prevents recreation, system-key removal, and reactivation of the retired Operations Leadership room.';
comment on function public.msg_reject_retired_ops_manager_shared_participation() is
  'Prevents active participation in the retired Operations Leadership room while preserving historical rows.';

commit;
