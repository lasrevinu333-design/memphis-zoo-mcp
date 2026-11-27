-- Replace upstream identities/place resolution with explicit fixture inputs.
-- The retained queue writer, candidate, freshness reader, console ownership,
-- turn writer and manual schedule target enumeration run in PostgreSQL.
create function fixture_id(x int) returns uuid language sql immutable as $$ select ('ee000000-0000-4000-8000-'||lpad(x::text,12,'0'))::uuid $$;
create or replace function app_event_place_authority(p_record jsonb,p_at timestamptz default statement_timestamp()) returns jsonb language sql as $$select '{"admissible":true}'::jsonb$$;
create or replace function custodial_ops_manager_notification_recipient_is_current(p_credential_id uuid,p_manager_id uuid,p_now timestamptz default now()) returns boolean language sql as $$select $1=fixture_id(1) and $2=fixture_id(2)$$;
insert into ops_manager_notification_credentials(credential_id) values(fixture_id(1));
insert into ops_manager_push_devices(credential_id,manager_id,enabled) values(fixture_id(1),fixture_id(2),true);
insert into ops_manager_notification_preferences(credential_id,event_reminders_enabled,event_reminder_time,event_lookahead_days) values(fixture_id(1),true,'08:00',7);
create function fixture_event(n int,starts timestamptz) returns void language sql as $$
 insert into events_app_events(id,revision,status,event_scope,event_name,event_date,start_instant_utc,end_instant_utc,display_location) values(fixture_id(n),1,'SCHEDULED','SINGLE_VENUE','Fixture '||n,starts::date,starts,starts+interval '1 hour','Fixture location')$$;
select fixture_event(10,'2030-05-11 15:00Z');
select fixture_event(11,'2030-05-12 15:00Z');
select fixture_assert(ops_manager_enqueue_scheduled_notifications('2030-05-10 17:00Z')->>'enqueued'='1','Two event digest queued');
create temporary table orig as select data_json from ops_manager_notification_queue;
select fixture_assert(app_event_manager_digest_is_current(data_json,'2030-05-10 17:00Z'),'Original next and count admitted') from orig;
update events_app_events set status='CANCELLED' where id=fixture_id(11);
select fixture_assert(not app_event_manager_digest_is_current(data_json,'2030-05-10 17:00Z'),'Count-only change refused before send') from orig;
select fixture_assert(ops_manager_enqueue_scheduled_notifications('2030-05-10 17:00Z')->>'enqueued'='1','Replacement with changed count has distinct identity');
select fixture_event(12,'2030-05-11 13:00Z');
select fixture_assert(not app_event_manager_digest_is_current(data_json,'2030-05-10 17:00Z'),'Earlier event invalidates old next even at same count') from orig;
select fixture_assert(ops_manager_enqueue_scheduled_notifications('2030-05-10 17:00Z')->>'enqueued'='1','Earlier next event replacement queued');
select fixture_assert(ops_manager_enqueue_scheduled_notifications('2030-05-10 17:00Z')->>'enqueued'='0','Unchanged current queue idempotent');
select fixture_assert(count(*) filter(where app_event_manager_digest_is_current(data_json,'2030-05-10 17:00Z'))=1,'Exactly one unsent digest current') from ops_manager_notification_queue;
insert into event_venues(id,venue_code,active,eligible_event_venue) values(fixture_id(20),'SAFARI_BASECAMP',true,true);
create function fixture_birthday(title text,raw text,venue int default 20) returns boolean language sql as $$ select custodial_is_basecamp_birthday(jsonb_build_object('event_name',title,'event_scope','SINGLE_VENUE','primary_venue_id',fixture_id(venue),'source_text',raw)) $$;
select fixture_assert(not fixture_birthday('Volunteer Party','annual party') and not fixture_birthday('Non-birthday party','') and fixture_birthday('Birthday Party','') and fixture_birthday('Smith booking',E'Contact: Fixture\nEvent Type: Birthday Party\nGuests: 12') and not fixture_birthday('Party','Email me about birthday prices') and not fixture_birthday('Birthday','',21),'Basecamp requires original birthday evidence and eligible venue');
insert into custodial_leadership_private.policy(singleton,enabled,cohort_principal_id,permissions,approved_at) values(true,true,fixture_id(31),array['custodialManagementAdmin'],now());
create or replace function custodial_leadership_private.session_view(p_registration uuid) returns jsonb language sql as $$ select jsonb_build_object('browserId',fixture_id(30),'cohort',jsonb_build_object('principalId',fixture_id(31),'permissions',array['custodialManagementAdmin']),'claimedAccount',jsonb_build_object('accountId',fixture_id(34))) where $1=fixture_id(32) $$;
create or replace function static_weekly_leadership_bind_verified_request(p_registration uuid,p_browser uuid,p_cohort uuid,p_request uuid) returns jsonb language sql as $$select '{}'::jsonb where $1=fixture_id(32) and $2=fixture_id(30) and $3=fixture_id(31)$$;
insert into custodial_leadership_private.registrations(registration_id,browser_id,cohort_principal_id) values(fixture_id(32),fixture_id(30),fixture_id(31));
insert into ops_manager_managers(manager_id,active,is_system_principal) values(fixture_id(31),true,true);
insert into gemini_console_conversations(conversation_id,owner_manager_id,status) values(fixture_id(33),fixture_id(31),'active');
insert into custodial_leadership_private.gemini_conversation_bindings(conversation_id,registration_id,cohort_principal_id) values(fixture_id(33),fixture_id(32),fixture_id(31));
create function fixture_turn(text) returns jsonb language sql as $$select jsonb_build_object('registration_id',fixture_id(32),'browser_id',fixture_id(30),'cohort_principal_id',fixture_id(31),'input',jsonb_build_object('body',$1,'conversation_id',fixture_id(33),'client_message_id',fixture_id(39),'correlation_id',fixture_id(38),'attachment_ids','[]'::jsonb))$$;
select fixture_assert(custodial_leadership_private.execute('gemini_begin_turn',fixture_turn(repeat('🦒',30000)))#>>'{data,inserted}'='true','Full 30000-character original Unicode turn persisted');
select fixture_assert(custodial_leadership_private.execute('gemini_begin_turn',fixture_turn(repeat('🦒',30000)))#>>'{data,inserted}'='false','Same logical turn replay reused original');
select fixture_assert(count(*)=1 and min(length(body))=30000,'One untruncated original console row') from gemini_console_messages;
select fixture_assert(custodial_leadership_private.execute('gemini_begin_turn',fixture_turn(repeat('x',30001)))->>'error'='invalid_gemini_turn_input','30001 characters refused as invalid input');
select fixture_assert(custodial_leadership_private.execute('session',fixture_turn(repeat('x',4100)))->>'error'='invalid_request','Unrelated context action retains 4096 byte limit');
select fixture_reject($test$select custodial_leadership_private.execute('gemini_begin_turn',fixture_turn('surprise')||jsonb_build_object('browser_id',fixture_id(42)))$test$,'Current original cohort');
-- Synthetic admitted source, employee, off-day view and original enrollment.
-- The normal manager reader calls the guarded manual reconcile procedure.
create or replace function static_weekly_v3_manager_actor(p_manager_id uuid) returns jsonb language sql as $$ select '{"manager_name":"Fixture"}'::jsonb where $1=fixture_id(2) $$;
create or replace function static_weekly_v6_schedule_authority_state(p_service_date date) returns table(service_date date,governed boolean,authority_source text,projection_status text,version_id uuid,publication_id uuid,projection_id uuid,projection_authority_revision bigint,staffing_authority_revision bigint,week_start date) language sql as $$select $1,true,'fixture','current',fixture_id(50),fixture_id(51),fixture_id(52),1::bigint,1::bigint,$1$$;
create or replace function static_weekly_v5_read_employee_day(p_service_date date,p_employee_id uuid,p_now timestamptz default now()) returns jsonb language sql as $$ select jsonb_build_object('governed',true,'source','static_weekly_projection','projection_status','current','service_date',$1,'employee_id',$2,'publication_id',fixture_id(51),'projection_id',fixture_id(52),'phase','off_day','schedule_status','off','shift',null,'all_items','[]'::jsonb) $$;
create or replace function static_weekly_v22_recurring_render_view(p_projection uuid,p_date date,p_employee uuid) returns jsonb language sql as $$select jsonb_build_object('date',$2,'employee',$3)$$;
insert into static_weekly_authority_source_documents(source_id,source_digest,active) values(fixture_id(53),'fixture-authority',true);
insert into weekly_schedule_versions(version_id,authority_source_id) values(fixture_id(50),fixture_id(53));
insert into weekly_schedule_compiled_projections(projection_id,publication_id,version_id,projection_envelope) values(fixture_id(52),fixture_id(51),fixture_id(50),'{}');
insert into weekly_schedule_lunch_documents(projection_id,document_identity,document_json) values(fixture_id(52),'fixture-lunch','{}');
insert into static_weekly_approved_initial_confirmations(publication_id,manager_id,idempotency_key,receipt_json,request_json) values(fixture_id(51),fixture_id(2),'initial','{}','{}');
insert into custodial_coverall.manual_application_bindings(operation_id,publication_id,original_projection_id,version_id,source_id,source_digest,initial_manager_id,initial_idempotency_key,initial_receipt_json,initial_request_json,initial_receipt_digest) values(fixture_id(55),fixture_id(51),fixture_id(52),fixture_id(50),fixture_id(53),'fixture-authority',fixture_id(2),'initial','{}','{}',static_weekly_digest_jsonb('{}'::jsonb));
insert into employees(id,display_name,active) values(fixture_id(56),'Synthetic employee',true);
insert into devices(id,active,assigned_employee_id,assignment_epoch) values(fixture_id(57),true,fixture_id(56),3);
insert into device_auth_credentials(credential_id,device_id,confirmed_at,expires_at,metadata_json) values(fixture_id(58),fixture_id(57),now(),now()+interval '1 day','{"retained_original_enrollment":{}}');
select fixture_assert(static_weekly_v25_read_current_recurring_delivery(current_date,fixture_id(2))->>'targetCount'='0','Off-day phone having only original retained enrollment excluded');
insert into device_auth_credentials(credential_id,device_id,confirmed_at,expires_at,metadata_json) values(fixture_id(59),fixture_id(57),now(),now()+interval '1 day','{}');
select fixture_assert(static_weekly_v25_read_current_recurring_delivery(current_date,fixture_id(2))->>'targetCount'='1','Current new registration creates exactly one reportable target');
select fixture_assert(count(*)=1 and bool_and(credential_id=fixture_id(59)),'Original preserved registration never gets delivery intent') from custodial_coverall.manual_application_intents;
