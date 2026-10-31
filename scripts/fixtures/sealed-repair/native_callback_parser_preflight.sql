-- ROOT ONLY: optional syntax/type-binding preflight on the existing owned fixture.
-- No EXECUTE: PREPARE analyzes each statement, never runs its SELECT/INSERT/UPDATE.
-- Does not validate runtime constraints, returned values, provider or release behavior.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- callback line 23 
PREPARE native_fixture_01 AS select public.sch_service_date(statement_timestamp())::text as service_date;
DEALLOCATE native_fixture_01;
-- callback line 26 
PREPARE native_fixture_02 (date) AS select r.employee_id,e.display_name,u.id as user_id,s.scheduled_for
   from public.static_weekly_v6_read_roster($1::date) r
   join public.employees e on e.id=r.employee_id and e.active and e.employee_code ~ '^EMP[0-9]+$'
   join public.msg_users u on u.employee_id=e.id and u.is_active
   cross join lateral public.mz_event_reminder_schedule_candidate(jsonb_build_object(
    'event_date',$1::date,'status','SCHEDULED','needs_review',false,'audience_scope','all_working_employees'),e.id,'shift_plus_15') s
   order by e.employee_code limit 1;
DEALLOCATE native_fixture_02;
-- callback line 33 
PREPARE native_fixture_03 AS select 'KIOSK_'||lpad(n::text,2,'0') as identifier from generate_series(2,10) n
   where not exists(select 1 from public.devices d where d.device_id='KIOSK_'||lpad(n::text,2,'0'))
   and not exists(select 1 from public.msg_device_assignments m where m.device_identifier='KIOSK_'||lpad(n::text,2,'0')) order by n limit 1;
DEALLOCATE native_fixture_03;
-- callback line 36 
PREPARE native_fixture_04 (uuid, text, text, uuid) AS insert into public.devices(id,device_id,device_name,assigned_employee_id,active) values($1,$2,$3,$4,true);
DEALLOCATE native_fixture_04;
-- callback line 37 
PREPARE native_fixture_05 (uuid) AS select assignment_epoch from public.devices where id=$1;
DEALLOCATE native_fixture_05;
-- callback line 38 
PREPARE native_fixture_06 (text, uuid, text) AS insert into public.msg_device_assignments(device_identifier,msg_user_id,is_active,notes) values($1,$2,true,$3);
DEALLOCATE native_fixture_06;
-- callback line 41 
PREPARE native_fixture_07 (uuid, uuid, text) AS insert into public.device_auth_credentials(credential_id,device_id,token_hash,created_at,expires_at,confirmed_at)
   values($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '3 days',clock_timestamp()-interval '30 seconds');
DEALLOCATE native_fixture_07;
-- callback line 50 
PREPARE native_fixture_08 (uuid, text) AS insert into public.msg_users(id,display_name,role,is_active) values($1,$2,'manager',true);
DEALLOCATE native_fixture_08;
-- callback line 52 
PREPARE native_fixture_09 (uuid, uuid) AS insert into public.msg_threads(id,thread_type,title,created_by_user_id) values($1,'direct','Synthetic rollback Unicode thread',$2);
DEALLOCATE native_fixture_09;
-- callback line 53 
PREPARE native_fixture_10 (uuid, uuid, uuid) AS insert into public.msg_thread_participants(thread_id,user_id) values($1,$2),($1,$3);
DEALLOCATE native_fixture_10;
-- callback line 54 
PREPARE native_fixture_11 (uuid, uuid, uuid, text) AS insert into public.msg_messages(id,thread_id,sender_user_id,body) values($1,$2,$3,$4);
DEALLOCATE native_fixture_11;
-- callback line 55 
PREPARE native_fixture_12 (uuid, uuid) AS insert into public.msg_receipts(message_id,user_id) values($1,$2) on conflict(message_id,user_id) do nothing;
DEALLOCATE native_fixture_12;
-- callback line 56 
PREPARE native_fixture_13 (text) AS select job_id,payload_json from public.operational_notification_jobs where job_key=$1;
DEALLOCATE native_fixture_13;
-- callback line 58 
PREPARE native_fixture_14 (uuid, uuid) AS update public.operational_notification_jobs set status='leased',lease_token=$2,leased_at=clock_timestamp(),leased_until=clock_timestamp()+interval '3 days',worker_id='synthetic-no-provider' where job_id=$1;
DEALLOCATE native_fixture_14;
-- callback line 72 
PREPARE native_fixture_15 (uuid, uuid) AS update public.msg_receipts set acknowledged_at=clock_timestamp() where message_id=$1 and user_id=$2;
DEALLOCATE native_fixture_15;
-- callback line 76 
PREPARE native_fixture_16 (uuid) AS select body from public.msg_messages where id=$1;
DEALLOCATE native_fixture_16;
-- callback line 81 
PREPARE native_fixture_17 (uuid, text, date, text) AS insert into public.events_app_events(id,event_name,event_date,end_date,start_time,end_time,event_scope,location_group_id,display_location,
   start_instant_utc,end_instant_utc,audience_scope,needs_review,attendee_count)
   values($1,$2,$3::date,$3::date+1,'00:00','23:59','OFFSITE',
    (select id from public.location_groups where group_code='OFFSITE'),$4,
    $3::date::timestamp at time zone 'America/Chicago',($3::date+1+time '23:59') at time zone 'America/Chicago','all_working_employees',false,25)
   returning *;
DEALLOCATE native_fixture_17;
-- callback line 87 
PREPARE native_fixture_18 (uuid, integer, uuid, text) AS select * from public.mz_event_reminder_schedule($1,$2,$3,$4);
DEALLOCATE native_fixture_18;
-- callback line 89 
PREPARE native_fixture_19 (uuid, text, uuid, integer, date, uuid, uuid, uuid, bigint, timestamp with time zone) AS insert into public.event_push_instances(instance_id,notification_key,event_id,event_revision,service_date,employee_id,device_id,credential_id,assignment_epoch,notification_kind,scheduled_for)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,'shift_plus_15',$10);
DEALLOCATE native_fixture_19;
-- callback line 91 
PREPARE native_fixture_20 (uuid, text, uuid, uuid, jsonb) AS insert into public.operational_notification_jobs(job_id,job_key,job_type,source_id,status,leased_at,leased_until,lease_token,worker_id,payload_json)
   values($1,$2,'employee_event_push',$3,'leased',clock_timestamp(),clock_timestamp()+interval '3 days',$4,'synthetic-no-provider',$5);
DEALLOCATE native_fixture_20;
-- callback line 93 
PREPARE native_fixture_21 (timestamp with time zone) AS select greatest(clock_timestamp(),$1::timestamptz+interval '1 second') as test_at;
DEALLOCATE native_fixture_21;
-- callback line 101 
PREPARE native_fixture_22 (uuid) AS update public.events_app_events set audience_scope='specific_employees',audience_employee_ids='{}'::uuid[] where id=$1;
DEALLOCATE native_fixture_22;
-- callback line 110 
PREPARE native_fixture_23 (uuid, uuid, uuid) AS select (select count(*) from public.devices where id=$1)+(select count(*) from public.msg_messages where id=$2)+(select count(*) from public.events_app_events where id=$3) as n;
DEALLOCATE native_fixture_23;
-- callback line None custodial_native_alert_finalize_at
PREPARE native_fixture_24 (uuid, uuid, uuid, jsonb, jsonb, timestamp with time zone) AS select public.custodial_native_alert_finalize_at($1,$2,$3,$4,$5,$6) as result;
DEALLOCATE native_fixture_24;
-- callback line None custodial_native_alert_prepare_at
PREPARE native_fixture_25 (uuid, uuid, jsonb, timestamp with time zone) AS select public.custodial_native_alert_prepare_at($1,$2,$3,$4) as result;
DEALLOCATE native_fixture_25;
-- callback line None custodial_native_alert_target_at
PREPARE native_fixture_26 (uuid, uuid, timestamp with time zone) AS select public.custodial_native_alert_target_at($1,$2,$3) as result;
DEALLOCATE native_fixture_26;
-- callback line None custodial_native_provider_registration
PREPARE native_fixture_27 (uuid, text, uuid, text, jsonb, boolean) AS select public.custodial_native_provider_registration($1,$2,$3,$4,$5,$6) as result;
DEALLOCATE native_fixture_27;
-- callback line None msg_is_runtime_user
PREPARE native_fixture_28 (uuid) AS select public.msg_is_runtime_user($1) as result;
DEALLOCATE native_fixture_28;
savepoint negative;
rollback to savepoint negative;
savepoint ack_negative;
rollback to savepoint ack_negative;
savepoint audience_negative;
rollback to savepoint audience_negative;
ROLLBACK;
