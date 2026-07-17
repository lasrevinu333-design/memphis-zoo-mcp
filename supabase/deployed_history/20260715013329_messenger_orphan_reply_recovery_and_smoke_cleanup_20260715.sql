-- Deployed migration history snapshot: 20260715013329 messenger_orphan_reply_recovery_and_smoke_cleanup_20260715

with human as (
  select id,thread_id
  from public.msg_messages
  where client_message_id in (
    'live-smoke-29381525577-1-KIOSK_03',
    'live-smoke-29381525577-1-KIOSK_10'
  )
), doomed as (
  select id from human
  union
  select m.id from public.msg_messages m join human h on m.client_message_id='memphis-reply:'||h.id::text
), deleted_receipts as (
  delete from public.msg_receipts r using doomed d where r.message_id=d.id returning r.message_id
)
delete from public.msg_messages m using doomed d where m.id=d.id;

with bot as (
  select id from public.msg_users where role='bot' and lower(display_name)='memphis' limit 1
)
select public.msg_send_message(
  'ea1774f1-4027-48bd-aa87-d601f4cfa810'::uuid,
  bot.id,
  'Michael, your Friday, July 17 shift is 9:00 AM–6:00 PM. Your primary areas are Cat Country, Primate Canyon, and Splash Pad Restrooms. Your lunch coverage includes Cathouse Cafe Restrooms, East End Restrooms, North West Passage, Primate Pavilion, Education, Expo, Komodos, Nocturnal, Bonobos Restrooms, and Herpetarium.',
  'bot_response',
  jsonb_build_object('ai',true,'mode','recovered_orphan_reply','channel','memphis','reply_to_message_id','4fbd5135-fdd6-469a-a3fc-ca91948f230d','client_message_id','recovered-orphan:4fbd5135-fdd6-469a-a3fc-ca91948f230d')
) from bot;

with bot as (
  select id from public.msg_users where role='bot' and lower(display_name)='memphis' limit 1
)
select public.msg_send_message(
  '3569bd18-8e27-4384-b181-ee3f042b086c'::uuid,
  bot.id,
  'Sherita, your Wednesday, July 15 shift is 8:00 AM–5:00 PM. Your primary areas are China and Cathouse Cafe Restrooms. Your lunch coverage includes Breezeway Restrooms, East End Restrooms, North West Passage, Primate Pavilion, Teton, Zambezi, Aquarium, Komodos, West Admin, and Event Center.',
  'bot_response',
  jsonb_build_object('ai',true,'mode','recovered_orphan_reply','channel','memphis','reply_to_message_id','4bcd15f6-3655-4b68-85fe-6ba96d9afeb6','client_message_id','recovered-orphan:4bcd15f6-3655-4b68-85fe-6ba96d9afeb6')
) from bot;

update public.msg_threads t
set last_message_at=(select max(m.sent_at) from public.msg_messages m where m.thread_id=t.id),updated_at=now()
where t.id in ('ea1774f1-4027-48bd-aa87-d601f4cfa810','3569bd18-8e27-4384-b181-ee3f042b086c');
