-- Expand event reminder notification kinds for kiosk rollout.
-- Required by backend event maintenance: two days before, day before, and morning-of reminders.

alter table public.events_app_notification_log
  drop constraint if exists events_app_notification_log_kind_check;

alter table public.events_app_notification_log
  add constraint events_app_notification_log_kind_check
  check (notification_kind in ('two_days_before', 'day_before', 'morning_of', 'shift_plus_15'));
