-- Deployed migration history snapshot: 20260715043425 event_notification_superseded_state_20260715

alter table public.events_app_notification_log
  drop constraint if exists events_app_notification_log_status_check;

alter table public.events_app_notification_log
  add constraint events_app_notification_log_status_check
  check (status = any(array['sending'::text,'sent'::text,'error'::text,'superseded'::text]));

update public.events_app_notification_log
set status='superseded',
    updated_at=now(),
    notes=regexp_replace(coalesce(notes,''),'\s*\|\s*Superseded duplicate',' | Superseded duplicate')
where status='error'
  and notes ilike '%Superseded duplicate event-instance reminder%';
