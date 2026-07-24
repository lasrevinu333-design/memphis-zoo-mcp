begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ops_manager_notification_preferences (
  credential_id uuid primary key references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete cascade,
  messages_enabled boolean not null default true,
  event_reminders_enabled boolean not null default false,
  event_reminder_weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  event_reminder_time time without time zone not null default '08:00'::time,
  event_lookahead_days integer not null default 7,
  due_soon_enabled boolean not null default false,
  overdue_enabled boolean not null default false,
  location_repeat_minutes integer not null default 240,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_manager_notification_weekdays_valid check (
    event_reminder_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    and cardinality(event_reminder_weekdays) between 1 and 7
  ),
  constraint ops_manager_notification_lookahead_valid check (event_lookahead_days between 1 and 30),
  constraint ops_manager_notification_repeat_valid check (location_repeat_minutes between 15 and 1440),
  constraint ops_manager_notification_timezone_len check (length(btrim(timezone)) between 1 and 80)
);

create index if not exists idx_ops_manager_notification_preferences_manager
  on public.ops_manager_notification_preferences(manager_id,credential_id);

create table if not exists public.ops_manager_push_devices (
  push_device_id uuid primary key default gen_random_uuid(),
  credential_id uuid not null unique references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete cascade,
  device_id text not null,
  provider text not null default 'fcm',
  platform text not null,
  fcm_token text not null unique,
  enabled boolean not null default true,
  app_version text null,
  app_build text null,
  last_registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  last_error text null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_manager_push_devices_provider check (provider='fcm'),
  constraint ops_manager_push_devices_platform check (platform in ('ios','android')),
  constraint ops_manager_push_devices_id_len check (length(btrim(device_id)) between 1 and 96),
  constraint ops_manager_push_devices_token_len check (length(fcm_token) between 20 and 4096),
  constraint ops_manager_push_devices_metadata_object check (jsonb_typeof(metadata_json)='object')
);

create index if not exists idx_ops_manager_push_devices_active
  on public.ops_manager_push_devices(manager_id,credential_id,last_seen_at desc)
  where enabled=true and revoked_at is null;

create table if not exists public.ops_manager_notification_queue (
  queue_id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete cascade,
  notification_type text not null,
  source_id uuid null,
  title text not null,
  body text not null,
  data_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  leased_at timestamptz null,
  leased_until timestamptz null,
  lease_token uuid null,
  worker_id text null,
  sent_at timestamptz null,
  completed_at timestamptz null,
  last_error text null,
  provider_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_manager_notification_queue_type check (notification_type in ('message','event_digest','location_digest','test')),
  constraint ops_manager_notification_queue_status check (status in ('pending','leased','sent','failed','cancelled')),
  constraint ops_manager_notification_queue_attempts check (attempts>=0 and max_attempts between 1 and 20),
  constraint ops_manager_notification_queue_title_len check (length(btrim(title)) between 1 and 180),
  constraint ops_manager_notification_queue_body_len check (length(btrim(body)) between 1 and 1000),
  constraint ops_manager_notification_queue_data_object check (jsonb_typeof(data_json)='object')
);

create index if not exists idx_ops_manager_notification_queue_claim
  on public.ops_manager_notification_queue(status,available_at,created_at)
  where status in ('pending','leased');

create index if not exists idx_ops_manager_notification_queue_credential
  on public.ops_manager_notification_queue(credential_id,created_at desc);

create table if not exists public.ops_manager_notification_state (
  credential_id uuid not null references public.ops_manager_trusted_devices(credential_id) on delete cascade,
  state_key text not null,
  fingerprint text not null default '',
  last_enqueued_at timestamptz null,
  last_sent_at timestamptz null,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(credential_id,state_key),
  constraint ops_manager_notification_state_key_len check (length(btrim(state_key)) between 1 and 80),
  constraint ops_manager_notification_state_metadata_object check (jsonb_typeof(metadata_json)='object')
);

alter table public.ops_manager_notification_preferences enable row level security;
alter table public.ops_manager_notification_preferences force row level security;
alter table public.ops_manager_push_devices enable row level security;
alter table public.ops_manager_push_devices force row level security;
alter table public.ops_manager_notification_queue enable row level security;
alter table public.ops_manager_notification_queue force row level security;
alter table public.ops_manager_notification_state enable row level security;
alter table public.ops_manager_notification_state force row level security;

revoke all on table public.ops_manager_notification_preferences from public,anon,authenticated;
revoke all on table public.ops_manager_push_devices from public,anon,authenticated;
revoke all on table public.ops_manager_notification_queue from public,anon,authenticated;
revoke all on table public.ops_manager_notification_state from public,anon,authenticated;
grant select,insert,update,delete on table public.ops_manager_notification_preferences to postgres,service_role;
grant select,insert,update,delete on table public.ops_manager_push_devices to postgres,service_role;
grant select,insert,update,delete on table public.ops_manager_notification_queue to postgres,service_role;
grant select,insert,update,delete on table public.ops_manager_notification_state to postgres,service_role;

create or replace function public.ops_manager_notification_validate_owner()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_manager_id uuid;
begin
  select manager_id into v_manager_id
  from public.ops_manager_trusted_devices
  where credential_id=new.credential_id
    and revoked_at is null
    and expires_at>now();
  if v_manager_id is null or v_manager_id is distinct from new.manager_id then
    raise exception using errcode='23514',message='Notification record must belong to the active trusted manager device.';
  end if;
  new.updated_at:=now();
  return new;
end
$function$;

revoke all on function public.ops_manager_notification_validate_owner() from public,anon,authenticated;

drop trigger if exists trg_ops_manager_notification_preferences_owner on public.ops_manager_notification_preferences;
create trigger trg_ops_manager_notification_preferences_owner
before insert or update on public.ops_manager_notification_preferences
for each row execute function public.ops_manager_notification_validate_owner();

drop trigger if exists trg_ops_manager_push_devices_owner on public.ops_manager_push_devices;
create trigger trg_ops_manager_push_devices_owner
before insert or update on public.ops_manager_push_devices
for each row execute function public.ops_manager_notification_validate_owner();

create or replace function public.ops_manager_enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  if new.is_deleted=true then return new; end if;

  insert into public.ops_manager_notification_queue(
    job_key,credential_id,manager_id,notification_type,source_id,title,body,data_json
  )
  select
    'manager-message:'||new.id::text||':'||pd.credential_id::text,
    pd.credential_id,
    pd.manager_id,
    'message',
    new.id,
    left(coalesce(nullif(sender.display_name,''),'Memphis Zoo Ops'),180),
    left(coalesce(nullif(regexp_replace(new.body,'[[:space:]]+',' ','g'),''),'New message'),1000),
    jsonb_build_object(
      'kind','message',
      'thread_id',new.thread_id::text,
      'message_id',new.id::text,
      'route','messages-chatscope.html?thread_id='||new.thread_id::text,
      'sender_name',coalesce(sender.display_name,'Memphis Zoo Ops'),
      'thread_title',coalesce(t.title,'Conversation')
    )
  from public.msg_thread_participants participant
  join public.msg_users recipient on recipient.id=participant.user_id
  join public.ops_manager_managers manager on manager.manager_id=recipient.ops_manager_id
  join public.ops_manager_push_devices pd on pd.manager_id=manager.manager_id
  join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=manager.manager_id
  left join public.ops_manager_notification_preferences pref on pref.credential_id=pd.credential_id
  left join public.msg_users sender on sender.id=new.sender_user_id
  left join public.msg_threads t on t.id=new.thread_id
  where participant.thread_id=new.thread_id
    and participant.left_at is null
    and participant.user_id<>new.sender_user_id
    and manager.active=true
    and manager.revoked_at is null
    and manager.is_system_principal=false
    and pd.enabled=true
    and pd.revoked_at is null
    and td.revoked_at is null
    and td.expires_at>now()
    and coalesce(pref.messages_enabled,true)=true
  on conflict(job_key) do nothing;

  return new;
end
$function$;

revoke all on function public.ops_manager_enqueue_message_push() from public,anon,authenticated;
drop trigger if exists trg_ops_manager_enqueue_message_push on public.msg_messages;
create trigger trg_ops_manager_enqueue_message_push
after insert on public.msg_messages
for each row execute function public.ops_manager_enqueue_message_push();

create or replace function public.ops_manager_enqueue_scheduled_notifications(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_local_now timestamp without time zone:=p_now at time zone 'America/Chicago';
  v_local_date date:=(p_now at time zone 'America/Chicago')::date;
  v_local_time time:=(p_now at time zone 'America/Chicago')::time;
  v_dow smallint:=extract(dow from p_now at time zone 'America/Chicago')::smallint;
  v_target record;
  v_event_count integer;
  v_next_event record;
  v_location_count integer;
  v_due_count integer;
  v_overdue_count integer;
  v_location_fingerprint text;
  v_location_rows jsonb;
  v_state public.ops_manager_notification_state%rowtype;
  v_bucket bigint;
  v_inserted integer:=0;
begin
  for v_target in
    select pd.credential_id,pd.manager_id,
           coalesce(pref.messages_enabled,true) messages_enabled,
           coalesce(pref.event_reminders_enabled,false) event_reminders_enabled,
           coalesce(pref.event_reminder_weekdays,array[0,1,2,3,4,5,6]::smallint[]) event_reminder_weekdays,
           coalesce(pref.event_reminder_time,'08:00'::time) event_reminder_time,
           coalesce(pref.event_lookahead_days,7) event_lookahead_days,
           coalesce(pref.due_soon_enabled,false) due_soon_enabled,
           coalesce(pref.overdue_enabled,false) overdue_enabled,
           coalesce(pref.location_repeat_minutes,240) location_repeat_minutes
    from public.ops_manager_push_devices pd
    join public.ops_manager_trusted_devices td on td.credential_id=pd.credential_id and td.manager_id=pd.manager_id
    join public.ops_manager_managers m on m.manager_id=pd.manager_id
    left join public.ops_manager_notification_preferences pref on pref.credential_id=pd.credential_id
    where pd.enabled=true and pd.revoked_at is null
      and td.revoked_at is null and td.expires_at>p_now
      and m.active=true and m.revoked_at is null and m.is_system_principal=false
  loop
    if v_target.event_reminders_enabled
       and v_dow=any(v_target.event_reminder_weekdays)
       and v_local_time>=v_target.event_reminder_time then
      select count(*)::integer into v_event_count
      from public.events_app_events e
      where e.status='SCHEDULED'
        and coalesce(e.end_date,e.event_date)>=v_local_date
        and e.event_date<=v_local_date+v_target.event_lookahead_days;

      if v_event_count>0 then
        select e.event_name,e.event_date,e.start_time,e.display_location
        into v_next_event
        from public.events_app_events e
        where e.status='SCHEDULED'
          and coalesce(e.end_date,e.event_date)>=v_local_date
          and e.event_date<=v_local_date+v_target.event_lookahead_days
        order by e.event_date,e.start_time,e.event_name
        limit 1;

        insert into public.ops_manager_notification_queue(
          job_key,credential_id,manager_id,notification_type,title,body,data_json
        ) values (
          'manager-event-digest:'||v_target.credential_id::text||':'||to_char(v_local_date,'YYYYMMDD'),
          v_target.credential_id,
          v_target.manager_id,
          'event_digest',
          'Upcoming Memphis Zoo Events',
          left(format('%s event%s in the next %s day%s. Next: %s on %s%s.',
            v_event_count,case when v_event_count=1 then '' else 's' end,
            v_target.event_lookahead_days,case when v_target.event_lookahead_days=1 then '' else 's' end,
            coalesce(v_next_event.event_name,'Event'),to_char(v_next_event.event_date,'Mon FMDD'),
            case when v_next_event.display_location is null then '' else ' at '||v_next_event.display_location end
          ),1000),
          jsonb_build_object('kind','event_digest','route','events.html','service_date',v_local_date::text,'lookahead_days',v_target.event_lookahead_days)
        ) on conflict(job_key) do nothing;
        get diagnostics v_event_count=row_count;
        v_inserted:=v_inserted+v_event_count;
      end if;
    end if;

    if v_target.due_soon_enabled or v_target.overdue_enabled then
      select
        count(*)::integer,
        count(*) filter(where s.status_code='due_soon')::integer,
        count(*) filter(where s.status_code='overdue')::integer,
        md5(coalesce(string_agg(s.location_code||':'||s.status_code,',' order by s.status_code,s.location_code),'')),
        coalesce(jsonb_agg(jsonb_build_object('location_code',s.location_code,'location_name',s.location_name,'status',s.status_code) order by s.status_code,s.location_name),'[]'::jsonb)
      into v_location_count,v_due_count,v_overdue_count,v_location_fingerprint,v_location_rows
      from public.v_location_dashboard_status s
      where (v_target.due_soon_enabled and s.status_code='due_soon')
         or (v_target.overdue_enabled and s.status_code='overdue');

      select * into v_state
      from public.ops_manager_notification_state
      where credential_id=v_target.credential_id and state_key='location_digest'
      for update;

      if v_location_count=0 then
        insert into public.ops_manager_notification_state(credential_id,state_key,fingerprint,metadata_json,updated_at)
        values(v_target.credential_id,'location_digest','',jsonb_build_object('due_soon',0,'overdue',0),p_now)
        on conflict(credential_id,state_key) do update
        set fingerprint='',metadata_json=excluded.metadata_json,updated_at=p_now;
      elsif v_state.credential_id is null
         or v_state.fingerprint is distinct from v_location_fingerprint
         or v_state.last_enqueued_at is null
         or v_state.last_enqueued_at<=p_now-make_interval(mins=>v_target.location_repeat_minutes) then
        v_bucket:=floor(extract(epoch from p_now)/(v_target.location_repeat_minutes*60))::bigint;
        insert into public.ops_manager_notification_queue(
          job_key,credential_id,manager_id,notification_type,title,body,data_json
        ) values (
          'manager-location-digest:'||v_target.credential_id::text||':'||v_location_fingerprint||':'||v_bucket::text,
          v_target.credential_id,
          v_target.manager_id,
          'location_digest',
          'Custodial Location Attention',
          left(format('%s overdue and %s due soon across all active areas. Tap to review the dashboard.',v_overdue_count,v_due_count),1000),
          jsonb_build_object('kind','location_digest','route','dashboard.html','overdue_count',v_overdue_count,'due_soon_count',v_due_count,'locations',v_location_rows)
        ) on conflict(job_key) do nothing;
        get diagnostics v_location_count=row_count;
        v_inserted:=v_inserted+v_location_count;

        insert into public.ops_manager_notification_state(credential_id,state_key,fingerprint,last_enqueued_at,metadata_json,updated_at)
        values(v_target.credential_id,'location_digest',v_location_fingerprint,p_now,jsonb_build_object('due_soon',v_due_count,'overdue',v_overdue_count),p_now)
        on conflict(credential_id,state_key) do update
        set fingerprint=excluded.fingerprint,last_enqueued_at=p_now,metadata_json=excluded.metadata_json,updated_at=p_now;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'enqueued',v_inserted,'checked_at',p_now,'local_date',v_local_date);
end
$function$;

revoke all on function public.ops_manager_enqueue_scheduled_notifications(timestamptz) from public,anon,authenticated;
grant execute on function public.ops_manager_enqueue_scheduled_notifications(timestamptz) to postgres,service_role;

create or replace function public.ops_manager_claim_notification_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns setof public.ops_manager_notification_queue
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  if nullif(btrim(p_worker_id),'') is null then
    raise exception using errcode='22023',message='worker id is required';
  end if;
  return query
  with candidates as (
    select q.queue_id
    from public.ops_manager_notification_queue q
    where (
      (q.status='pending' and q.available_at<=now())
      or (q.status='leased' and q.leased_until<now())
    )
      and q.attempts<q.max_attempts
    order by q.available_at,q.created_at,q.queue_id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.ops_manager_notification_queue q
  set status='leased',attempts=q.attempts+1,leased_at=now(),
      leased_until=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,120),900))),
      lease_token=gen_random_uuid(),worker_id=left(btrim(p_worker_id),160),updated_at=now()
  from candidates c
  where q.queue_id=c.queue_id
  returning q.*;
end
$function$;

revoke all on function public.ops_manager_claim_notification_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function public.ops_manager_claim_notification_jobs(text,integer,integer) to postgres,service_role;

create or replace function public.ops_manager_finish_notification_job(
  p_queue_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry_seconds integer default 30
) returns public.ops_manager_notification_queue
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  v_row public.ops_manager_notification_queue%rowtype;
begin
  select * into v_row
  from public.ops_manager_notification_queue
  where queue_id=p_queue_id and status='leased' and lease_token=p_lease_token
  for update;
  if v_row.queue_id is null then
    raise exception using errcode='P0002',message='Notification job lease was not found';
  end if;

  if p_succeeded then
    update public.ops_manager_notification_queue
    set status='sent',sent_at=now(),completed_at=now(),leased_until=null,lease_token=null,
        provider_message_id=nullif(left(coalesce(p_provider_message_id,''),500),''),last_error=null,updated_at=now()
    where queue_id=p_queue_id
    returning * into v_row;
    update public.ops_manager_notification_state
    set last_sent_at=now(),updated_at=now()
    where credential_id=v_row.credential_id and state_key=case when v_row.notification_type='location_digest' then 'location_digest' else '__none__' end;
  else
    update public.ops_manager_notification_queue
    set status=case when attempts>=max_attempts then 'failed' else 'pending' end,
        available_at=case when attempts>=max_attempts then available_at else now()+make_interval(secs=>greatest(15,least(coalesce(p_retry_seconds,30),86400))) end,
        completed_at=case when attempts>=max_attempts then now() else null end,
        leased_until=null,lease_token=null,last_error=left(coalesce(p_error,'Notification delivery failed'),2000),updated_at=now()
    where queue_id=p_queue_id
    returning * into v_row;
  end if;

  return v_row;
end
$function$;

revoke all on function public.ops_manager_finish_notification_job(uuid,uuid,boolean,text,text,integer) from public,anon,authenticated;
grant execute on function public.ops_manager_finish_notification_job(uuid,uuid,boolean,text,text,integer) to postgres,service_role;

comment on table public.ops_manager_notification_preferences is 'Per-manager-app-installation notification choices. Messages default on; event and location alerts default off.';
comment on table public.ops_manager_push_devices is 'FCM registration tokens for named manager app installations only; employee kiosk devices are not eligible.';
comment on table public.ops_manager_notification_queue is 'Durable manager mobile push queue with leasing, retry and delivery audit state.';

commit;
