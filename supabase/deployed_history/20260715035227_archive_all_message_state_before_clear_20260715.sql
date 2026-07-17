-- Deployed migration history snapshot: 20260715035227 archive_all_message_state_before_clear_20260715

create table if not exists archive.cleared_message_state (
  archive_id uuid primary key default gen_random_uuid(),
  clear_batch text not null,
  source_table text not null,
  source_id text null,
  row_json jsonb not null,
  archived_at timestamptz not null default now(),
  archived_by text not null default 'approved_system_reset'
);

revoke all on table archive.cleared_message_state from public, anon, authenticated;
grant select, insert on table archive.cleared_message_state to service_role;

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_messages',id::text,to_jsonb(m)
from public.msg_messages m
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_messages' and a.source_id=m.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_receipts',id::text,to_jsonb(r)
from public.msg_receipts r
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_receipts' and a.source_id=r.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_message_deletions',id::text,to_jsonb(d)
from public.msg_message_deletions d
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_message_deletions' and a.source_id=d.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_memphis_thread_context',thread_id::text,to_jsonb(c)
from public.msg_memphis_thread_context c
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_memphis_thread_context' and a.source_id=c.thread_id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_thread_visibility',id::text,to_jsonb(v)
from public.msg_thread_visibility v
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_thread_visibility' and a.source_id=v.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.msg_hidden_threads_by_device',id::text,to_jsonb(h)
from public.msg_hidden_threads_by_device h
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.msg_hidden_threads_by_device' and a.source_id=h.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.annie_chat_state',id,to_jsonb(s)
from public.annie_chat_state s
where not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.annie_chat_state' and a.source_id=s.id
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.events_app_notification_log',id::text,to_jsonb(n)
from public.events_app_notification_log n
where n.response_message_id is not null
and not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.events_app_notification_log' and a.source_id=n.id::text
);

insert into archive.cleared_message_state(clear_batch,source_table,source_id,row_json)
select 'all_messages_20260715','public.scan_alert_notification_log',id::text,to_jsonb(n)
from public.scan_alert_notification_log n
where n.msg_message_id is not null or n.escalation_msg_message_id is not null
and not exists (
  select 1 from archive.cleared_message_state a
  where a.clear_batch='all_messages_20260715' and a.source_table='public.scan_alert_notification_log' and a.source_id=n.id::text
);
