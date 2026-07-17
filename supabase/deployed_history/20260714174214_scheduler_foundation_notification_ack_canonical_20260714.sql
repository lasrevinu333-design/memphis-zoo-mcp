-- Deployed migration history snapshot: 20260714174214 scheduler_foundation_notification_ack_canonical_20260714

create table if not exists public.device_notification_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  device_identifier text not null,
  notification_key text not null,
  notification_type text not null default 'notification',
  displayed_at timestamptz null,
  dismissed_at timestamptz null,
  opened_at timestamptz null,
  acknowledged_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_notification_ack_key_length check (length(notification_key) between 1 and 500),
  constraint device_notification_ack_unique unique(device_identifier, notification_key)
);

alter table public.device_notification_acknowledgements enable row level security;
revoke all on table public.device_notification_acknowledgements from public, anon, authenticated;
grant select, insert, update, delete on table public.device_notification_acknowledgements to service_role;
create index if not exists idx_device_notification_ack_recent
  on public.device_notification_acknowledgements(device_identifier, updated_at desc);
create index if not exists idx_device_notification_ack_type
  on public.device_notification_acknowledgements(notification_type, acknowledged_at, dismissed_at);

do $do$
begin
  if to_regclass('public.device_reminder_dismissals') is not null then
    execute $sql$
      insert into public.device_notification_acknowledgements(
        device_identifier, notification_key, notification_type,
        dismissed_at, acknowledged_at, metadata_json, created_at, updated_at
      )
      select device_id, instance_key, reminder_kind,
             dismissed_at, dismissed_at, metadata_json, dismissed_at, dismissed_at
      from public.device_reminder_dismissals
      on conflict(device_identifier, notification_key) do update set
        dismissed_at = coalesce(public.device_notification_acknowledgements.dismissed_at, excluded.dismissed_at),
        acknowledged_at = coalesce(public.device_notification_acknowledgements.acknowledged_at, excluded.acknowledged_at),
        metadata_json = coalesce(public.device_notification_acknowledgements.metadata_json,'{}'::jsonb) || excluded.metadata_json,
        updated_at = greatest(public.device_notification_acknowledgements.updated_at, excluded.updated_at)
    $sql$;
  end if;
end
$do$;

create or replace function public.ack_device_notification(
  p_device_identifier text,
  p_notification_key text,
  p_notification_type text default 'notification',
  p_action text default 'dismissed',
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_key text := nullif(btrim(coalesce(p_notification_key,'')), '');
  v_type text := left(lower(coalesce(nullif(btrim(p_notification_type),''), 'notification')), 80);
  v_action text := lower(coalesce(nullif(btrim(p_action),''), 'dismissed'));
  v_row public.device_notification_acknowledgements%rowtype;
begin
  if v_requested is null or length(v_requested) > 200 then
    raise exception 'device_identifier is required and must be at most 200 characters';
  end if;
  if v_key is null or length(v_key) > 500 then
    raise exception 'notification_key is required and must be at most 500 characters';
  end if;
  if v_action not in ('displayed','dismissed','opened','acknowledged') then
    raise exception 'unsupported notification action: %', v_action;
  end if;
  if jsonb_typeof(coalesce(p_metadata_json,'{}'::jsonb)) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  select d.device_id into v_device
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_requested)
  limit 1;

  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_requested)
    limit 1;
  end if;

  if v_device is null then raise exception 'Active device not found: %', v_requested; end if;

  insert into public.device_notification_acknowledgements(
    device_identifier, notification_key, notification_type,
    displayed_at, dismissed_at, opened_at, acknowledged_at,
    metadata_json, updated_at
  ) values (
    v_device, v_key, v_type,
    case when v_action='displayed' then now() else null end,
    case when v_action='dismissed' then now() else null end,
    case when v_action='opened' then now() else null end,
    case when v_action in ('dismissed','opened','acknowledged') then now() else null end,
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('presented_device_identifier',v_requested),
    now()
  )
  on conflict(device_identifier, notification_key) do update
  set notification_type = excluded.notification_type,
      displayed_at = coalesce(public.device_notification_acknowledgements.displayed_at, excluded.displayed_at),
      dismissed_at = coalesce(public.device_notification_acknowledgements.dismissed_at, excluded.dismissed_at),
      opened_at = coalesce(public.device_notification_acknowledgements.opened_at, excluded.opened_at),
      acknowledged_at = coalesce(public.device_notification_acknowledgements.acknowledged_at, excluded.acknowledged_at),
      metadata_json = coalesce(public.device_notification_acknowledgements.metadata_json,'{}'::jsonb) || excluded.metadata_json,
      updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'device_identifier', v_row.device_identifier,
    'notification_key', v_row.notification_key,
    'notification_type', v_row.notification_type,
    'displayed_at', v_row.displayed_at,
    'dismissed_at', v_row.dismissed_at,
    'opened_at', v_row.opened_at,
    'acknowledged_at', v_row.acknowledged_at
  );
end
$function$;

create or replace function public.dismiss_device_reminder(
  p_instance_key text,
  p_device_id text,
  p_reminder_kind text default 'notification',
  p_source_id text default null,
  p_metadata_json jsonb default '{}'::jsonb
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.ack_device_notification(
    p_device_id,
    p_instance_key,
    p_reminder_kind,
    'dismissed',
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('source_id',p_source_id)
  );
$function$;

revoke all on function public.ack_device_notification(text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.dismiss_device_reminder(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ack_device_notification(text,text,text,text,jsonb) to service_role;
grant execute on function public.dismiss_device_reminder(text,text,text,text,jsonb) to service_role;

drop table if exists public.device_reminder_dismissals;
