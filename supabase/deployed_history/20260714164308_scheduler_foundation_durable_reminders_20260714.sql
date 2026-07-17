-- Deployed migration history snapshot: 20260714164308 scheduler_foundation_durable_reminders_20260714

create table if not exists public.device_reminder_dismissals (
  instance_key text not null,
  device_id text not null,
  reminder_kind text not null,
  source_id text null,
  dismissed_at timestamptz not null default now(),
  dismissed_by text not null default 'device',
  metadata_json jsonb not null default '{}'::jsonb,
  primary key (instance_key, device_id)
);

alter table public.device_reminder_dismissals enable row level security;
revoke all on table public.device_reminder_dismissals from public, anon, authenticated;
grant select, insert, update, delete on table public.device_reminder_dismissals to service_role;

create index if not exists idx_device_reminder_dismissals_device_time
  on public.device_reminder_dismissals(device_id, dismissed_at desc);

create or replace function public.dismiss_device_reminder(
  p_instance_key text,
  p_device_id text,
  p_reminder_kind text default 'notification',
  p_source_id text default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_instance_key text := nullif(btrim(coalesce(p_instance_key, '')), '');
  v_presented_device text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_canonical_device text;
  v_kind text := left(coalesce(nullif(btrim(p_reminder_kind), ''), 'notification'), 80);
begin
  if v_instance_key is null or length(v_instance_key) > 500 then
    raise exception 'instance_key is required and must be at most 500 characters';
  end if;
  if v_presented_device is null or length(v_presented_device) > 200 then
    raise exception 'device_id is required and must be at most 200 characters';
  end if;

  select d.device_id
    into v_canonical_device
  from public.devices d
  where d.active = true
    and upper(btrim(d.device_id)) = upper(v_presented_device)
  union all
  select d.device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true
    and upper(btrim(da.alias_identifier)) = upper(v_presented_device)
  limit 1;

  if v_canonical_device is null then
    raise exception 'Active device not found: %', v_presented_device;
  end if;

  insert into public.device_reminder_dismissals(
    instance_key, device_id, reminder_kind, source_id, dismissed_at, dismissed_by, metadata_json
  ) values (
    v_instance_key,
    v_canonical_device,
    v_kind,
    nullif(left(coalesce(p_source_id, ''), 200), ''),
    now(),
    'device',
    coalesce(p_metadata_json, '{}'::jsonb) || jsonb_build_object('presented_device_id', v_presented_device)
  )
  on conflict (instance_key, device_id) do update set
    reminder_kind = excluded.reminder_kind,
    source_id = coalesce(excluded.source_id, public.device_reminder_dismissals.source_id),
    dismissed_at = now(),
    metadata_json = coalesce(public.device_reminder_dismissals.metadata_json, '{}'::jsonb) || excluded.metadata_json;

  if v_kind = 'event' and nullif(btrim(coalesce(p_source_id, '')), '') is not null then
    update public.msg_receipts r
       set displayed_at = coalesce(r.displayed_at, now()),
           read_at = coalesce(r.read_at, now())
      from public.msg_messages m,
           public.msg_device_assignments mda
     where r.message_id = m.id
       and r.user_id = mda.msg_user_id
       and mda.is_active = true
       and upper(btrim(mda.device_identifier)) = upper(btrim(v_canonical_device))
       and coalesce(m.metadata_json->>'source', '') = 'events_app'
       and coalesce(m.metadata_json->>'event_id', '') = btrim(p_source_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'instance_key', v_instance_key,
    'device_id', v_canonical_device,
    'dismissed_at', now()
  );
end
$function$;

revoke all on function public.dismiss_device_reminder(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.dismiss_device_reminder(text, text, text, text, jsonb) to service_role;

alter table public.events_app_notification_log drop constraint if exists events_app_notification_log_status_check;
alter table public.events_app_notification_log add constraint events_app_notification_log_status_check
  check (status = any(array['sending'::text, 'sent'::text, 'error'::text]));

create or replace function public.claim_event_notification(
  p_event_id uuid,
  p_employee_id uuid,
  p_msg_user_id uuid,
  p_notification_kind text,
  p_scheduled_for_local text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_kind text := nullif(btrim(coalesce(p_notification_kind, '')), '');
  v_scheduled timestamp;
  v_existing public.events_app_notification_log%rowtype;
begin
  if p_event_id is null or p_employee_id is null or p_msg_user_id is null then
    raise exception 'event_id, employee_id, and msg_user_id are required';
  end if;
  if v_kind is null or length(v_kind) > 120 then
    raise exception 'notification_kind is required and must be at most 120 characters';
  end if;
  begin
    v_scheduled := p_scheduled_for_local::timestamp;
  exception when others then
    raise exception 'scheduled_for_local is invalid';
  end;

  perform pg_advisory_xact_lock(hashtextextended('event-reminder:' || p_event_id::text || ':' || p_employee_id::text, 0));

  select log.* into v_existing
  from public.events_app_notification_log log
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.status in ('sent', 'sending')
    and (log.status = 'sent' or log.updated_at > now() - interval '10 minutes')
  order by case when log.status = 'sent' then 0 else 1 end, log.updated_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'reason', case when v_existing.status = 'sent' then 'event_already_notified' else 'event_notification_in_flight' end,
      'notification_kind', v_existing.notification_kind,
      'response_message_id', v_existing.response_message_id,
      'status', v_existing.status
    );
  end if;

  insert into public.events_app_notification_log(
    event_id, employee_id, msg_user_id, notification_kind, scheduled_for_local,
    sent_at, status, notes, created_at, updated_at
  ) values (
    p_event_id, p_employee_id, p_msg_user_id, v_kind, v_scheduled,
    now(), 'sending', 'Claimed before message delivery', now(), now()
  )
  on conflict (event_id, employee_id, notification_kind) do update set
    msg_user_id = excluded.msg_user_id,
    scheduled_for_local = excluded.scheduled_for_local,
    sent_at = now(),
    status = 'sending',
    response_message_id = null,
    notes = 'Retry claimed before message delivery',
    updated_at = now()
  where public.events_app_notification_log.status = 'error'
     or (public.events_app_notification_log.status = 'sending'
         and public.events_app_notification_log.updated_at <= now() - interval '10 minutes')
  returning * into v_existing;

  if not found then
    select log.* into v_existing
    from public.events_app_notification_log log
    where log.event_id = p_event_id
      and log.employee_id = p_employee_id
      and log.notification_kind = v_kind
    limit 1;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'notification_already_claimed',
      'response_message_id', v_existing.response_message_id,
      'status', v_existing.status
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'claim_created',
    'notification_kind', v_kind,
    'log_id', v_existing.id,
    'status', v_existing.status
  );
end
$function$;

create or replace function public.finalize_event_notification(
  p_event_id uuid,
  p_employee_id uuid,
  p_notification_kind text,
  p_status text,
  p_thread_id uuid default null,
  p_response_message_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_row public.events_app_notification_log%rowtype;
begin
  if v_status not in ('sent', 'error') then
    raise exception 'status must be sent or error';
  end if;

  update public.events_app_notification_log log
  set status = v_status,
      thread_id = p_thread_id,
      response_message_id = p_response_message_id,
      sent_at = case when v_status = 'sent' then now() else log.sent_at end,
      notes = left(coalesce(p_notes, log.notes, ''), 4000),
      updated_at = now()
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.notification_kind = p_notification_kind
  returning * into v_row;

  if not found then
    raise exception 'Event notification claim was not found';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'response_message_id', v_row.response_message_id,
    'updated_at', v_row.updated_at
  );
end
$function$;

revoke all on function public.claim_event_notification(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_event_notification(uuid, uuid, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_event_notification(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.finalize_event_notification(uuid, uuid, text, text, uuid, uuid, text) to service_role;
