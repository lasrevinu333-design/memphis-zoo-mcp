-- Deployed migration history snapshot: 20260714232459 backfill_event_read_acknowledgements_20260714

with event_receipts as (
  select r.id receipt_id,
         r.message_id,
         r.user_id,
         coalesce(r.read_at, r.displayed_at, r.delivered_at, m.sent_at, now()) as effective_at,
         m.metadata_json,
         m.sent_at
  from public.msg_receipts r
  join public.msg_messages m on m.id = r.message_id
  where coalesce(m.metadata_json->>'source','') = 'events_app'
    and r.read_at is not null
), updated as (
  update public.msg_receipts r
  set displayed_at = coalesce(r.displayed_at, e.effective_at),
      acknowledged_at = coalesce(r.acknowledged_at, e.effective_at)
  from event_receipts e
  where r.id = e.receipt_id
  returning r.message_id, r.user_id, r.displayed_at, r.acknowledged_at
)
insert into public.device_notification_acknowledgements(
  device_identifier,
  notification_key,
  notification_type,
  displayed_at,
  acknowledged_at,
  metadata_json,
  created_at,
  updated_at
)
select distinct
  coalesce(d.device_id, mda.device_identifier),
  'event:' || u.message_id::text,
  'event',
  u.displayed_at,
  u.acknowledged_at,
  jsonb_build_object(
    'source','historical_event_read_backfill',
    'repair_id','backfill_event_read_acknowledgements_20260714'
  ),
  u.acknowledged_at,
  now()
from updated u
join public.msg_device_assignments mda on mda.msg_user_id = u.user_id and mda.is_active = true
left join public.devices d on upper(btrim(d.device_id)) = upper(btrim(mda.device_identifier)) and d.active = true
on conflict(device_identifier, notification_key) do update set
  displayed_at = coalesce(public.device_notification_acknowledgements.displayed_at, excluded.displayed_at),
  acknowledged_at = coalesce(public.device_notification_acknowledgements.acknowledged_at, excluded.acknowledged_at),
  metadata_json = coalesce(public.device_notification_acknowledgements.metadata_json,'{}'::jsonb) || excluded.metadata_json,
  updated_at = now();
