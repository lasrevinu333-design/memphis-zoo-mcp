-- Deployed migration history snapshot: 20260715021411 event_notification_one_instance_guarantee_v2_20260715

with ranked_logs as (
  select l.id,
         row_number() over(
           partition by l.event_id,l.employee_id
           order by case when l.status='sent' then 0 when l.status='sending' then 1 else 2 end,
                    l.sent_at desc nulls last,l.updated_at desc,l.id
         ) rn
  from public.events_app_notification_log l
  where l.status in ('sent','sending')
)
update public.events_app_notification_log l
set status='error',
    notes=concat_ws(' | ',nullif(l.notes,''),'Superseded duplicate event-instance reminder during 2026-07-15 foundation repair.'),
    updated_at=now()
from ranked_logs x
where l.id=x.id and x.rn>1;

create unique index if not exists ux_event_notification_one_active_instance
on public.events_app_notification_log(event_id,employee_id)
where status in ('sent','sending');

with ranked_messages as (
  select m.id,
         row_number() over(
           partition by m.thread_id,(m.metadata_json->>'event_id')
           order by m.sent_at desc,m.created_at desc,m.id
         ) rn
  from public.msg_messages m
  where m.is_deleted=false
    and coalesce(m.metadata_json->>'source','')='events_app'
    and nullif(m.metadata_json->>'event_id','') is not null
)
update public.msg_messages m
set is_deleted=true,
    metadata_json=coalesce(m.metadata_json,'{}'::jsonb)||jsonb_build_object(
      'superseded_duplicate',true,
      'superseded_at',now(),
      'superseded_reason','one reminder per event instance'
    )
from ranked_messages x
where m.id=x.id and x.rn>1;

create unique index if not exists ux_msg_event_one_visible_per_thread
on public.msg_messages(thread_id,(metadata_json->>'event_id'))
where is_deleted=false
  and coalesce(metadata_json->>'source','')='events_app'
  and nullif(metadata_json->>'event_id','') is not null;

update public.msg_receipts r
set delivered_at=coalesce(r.delivered_at,now()),
    displayed_at=coalesce(r.displayed_at,now()),
    read_at=coalesce(r.read_at,now()),
    acknowledged_at=coalesce(r.acknowledged_at,now())
from public.msg_messages m,public.msg_users u,public.employees e
where r.message_id=m.id
  and u.id=r.user_id
  and e.id=u.employee_id
  and e.display_name='Markiesha Warren'
  and coalesce(m.metadata_json->>'source','')='events_app';

-- Verify the database now enforces one active event claim and one visible event message per instance.
do $do$
declare v_count integer;
begin
  select count(*) into v_count from (
    select event_id,employee_id from public.events_app_notification_log
    where status in ('sent','sending') group by event_id,employee_id having count(*)>1
  ) q;
  if v_count<>0 then raise exception '% duplicate active event notification claims remain',v_count; end if;

  select count(*) into v_count from (
    select thread_id,metadata_json->>'event_id' event_id from public.msg_messages
    where is_deleted=false and coalesce(metadata_json->>'source','')='events_app'
      and nullif(metadata_json->>'event_id','') is not null
    group by thread_id,metadata_json->>'event_id' having count(*)>1
  ) q;
  if v_count<>0 then raise exception '% duplicate visible event messages remain',v_count; end if;
end
$do$;
