-- ROOT ONLY, isolated source303 clone after proposal. No external callbacks.
-- Every fixture/data write rolls back. No trigger, RLS or privilege bypass.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $utf8$
DECLARE r record; actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  (repeat('é',501),1000,repeat('é',500)),
  (repeat('漢',334),1000,repeat('漢',333)),
  (repeat('😀',249)||'é😀',1000,repeat('😀',249)||'é'),
  (repeat('A',1000),1000,repeat('A',1000)),
  (repeat('é',91),180,repeat('é',90)),
  ('unchanged',1000,'unchanged'),('',1000,''),('x',0,'')) v(source,budget,expected)
 LOOP
  actual:=public.custodial_native_alert_utf8_prefix(r.source,r.budget);
  IF actual IS DISTINCT FROM r.expected OR octet_length(actual)>r.budget THEN
   RAISE EXCEPTION 'UTF8 source-bound prefix mismatch';
  END IF;
 END LOOP;
 IF has_function_privilege('anon','public.custodial_native_alert_utf8_prefix(text,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.custodial_native_alert_utf8_prefix(text,integer)','EXECUTE')
  OR has_function_privilege('service_role','public.custodial_native_alert_utf8_prefix(text,integer)','EXECUTE') THEN
   RAISE EXCEPTION 'private prefix unexpectedly callable';END IF;
END $utf8$;
SELECT 'F14_UTF8_SQL_8_CONTENT_3_ACL_CHECKS_PASS';

INSERT INTO public.employees(id,employee_code,display_name,active,role) VALUES
 ('f1200000-0000-4000-8000-000000000001','OPF1201','Synthetic Operations Worker',true,'staff'),
 ('f1200000-0000-4000-8000-000000000002','OPF1202','Synthetic Other Worker',true,'staff');
INSERT INTO public.locations(id,location_code,location_name,location_type,form_type,active) VALUES
 ('f1200000-0000-4000-8000-000000000003','OP_F12','Synthetic GPS Work','exhibit','exhibit',true);
INSERT INTO public.devices(id,device_id,device_name,active,assigned_employee_id) VALUES
 ('f1200000-0000-4000-8000-000000000004','OP_F12_PHONE','Synthetic GPS Phone',true,'f1200000-0000-4000-8000-000000000001');
INSERT INTO public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at,assignment_epoch_snapshot)
 SELECT 'f1200000-0000-4000-8000-000000000005','op-f12-active','op-f12-active',
 'f1200000-0000-4000-8000-000000000003',assigned_employee_id,id,'active',clock_timestamp()-interval '10 minutes',assignment_epoch
 FROM public.devices WHERE id='f1200000-0000-4000-8000-000000000004';
INSERT INTO public.location_proximity_settings(location_id,latitude,longitude,coordinate_source,coordinate_confidence,active,authority_radius_m,authority_surveyed_at)
 VALUES ('f1200000-0000-4000-8000-000000000003',35.15,-90.05,'synthetic_survey','surveyed',true,80,clock_timestamp()-interval '1 day');
DO $gps$
DECLARE r jsonb; n integer; s text; observed timestamptz;
BEGIN
 FOR s IN SELECT unnest(ARRAY[NULL::text,'',' ']) LOOP
  r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,s,'op-f12-missing-'||coalesce(s,'NULL'),'op-f12',clock_timestamp());
  IF r->>'result'<>'gps_session_unavailable' OR r->'authoritative'<>'false'::jsonb OR r->'scan_event_id'<>'null'::jsonb THEN RAISE EXCEPTION 'missing session GPS persisted';END IF;
 END LOOP;
 FOREACH observed IN ARRAY ARRAY[NULL::timestamptz,'infinity'::timestamptz,clock_timestamp()-interval '20 minutes',clock_timestamp()+interval '1 minute'] LOOP
  r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-bad-time','op-f12',observed);
  IF r->>'result'<>'gps_timestamp_unavailable' OR r->'authoritative'<>'false'::jsonb THEN RAISE EXCEPTION 'invalid capture GPS accepted';END IF;
 END LOOP;
 SELECT count(*) INTO n FROM public.scan_events WHERE location_id='f1200000-0000-4000-8000-000000000003';
 IF n<>0 OR EXISTS(SELECT 1 FROM public.device_location_proximity_status WHERE device_id='f1200000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'rejected GPS wrote telemetry';END IF;
 r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-valid','op-f12',clock_timestamp());
 IF r->>'result'<>'near' OR r->'authoritative'<>'true'::jsonb OR r->>'original_employee_id'<>'f1200000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'active original actor GPS unavailable: %',r;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.scan_events WHERE client_event_id='op-f12-valid' AND session_id='f1200000-0000-4000-8000-000000000005' AND payload_json->>'original_employee_id'='f1200000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'GPS original actor evidence missing';END IF;
 BEGIN
  PERFORM public.tool_evaluate_location_proximity_v2('OP_F12','OP_WRONG_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-wrong-device','op-f12',clock_timestamp());
  RAISE EXCEPTION 'wrong device inherited original session';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 UPDATE public.devices SET assigned_employee_id='f1200000-0000-4000-8000-000000000002' WHERE id='f1200000-0000-4000-8000-000000000004';
 r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-reassigned','op-f12',clock_timestamp());
 IF r->>'result'<>'gps_original_actor_unavailable' OR r->'authoritative'<>'false'::jsonb THEN RAISE EXCEPTION 'new actor inherited old session';END IF;
 UPDATE public.devices SET assigned_employee_id='f1200000-0000-4000-8000-000000000001' WHERE id='f1200000-0000-4000-8000-000000000004';
 r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-old-epoch','op-f12',clock_timestamp());
 IF r->>'result'<>'gps_original_actor_unavailable' OR r->'authoritative'<>'false'::jsonb THEN RAISE EXCEPTION 'returning employee revived old assignment epoch';END IF;
 UPDATE public.sessions SET status='pending_submit',ended_at=clock_timestamp(),duration_minutes=10,duration_display='10 min' WHERE session_uuid='op-f12-active';
 r:=public.tool_evaluate_location_proximity_v2('OP_F12','OP_F12_PHONE',35.15,-90.05,5,'op-f12-active','op-f12-after-finish','op-f12',clock_timestamp());
 IF r->>'result'<>'post_session' OR r->'authoritative'<>'false'::jsonb THEN RAISE EXCEPTION 'finished session GPS active';END IF;
 IF (SELECT count(*) FROM public.scan_events WHERE location_id='f1200000-0000-4000-8000-000000000003')<>1 THEN RAISE EXCEPTION 'late GPS stored new telemetry';END IF;
END $gps$;
SELECT 'F12_MISSING_CAPTURE_ACTIVE_ORIGINAL_ACTOR_FINISH_CHECKS_PASS';

-- Distinct actual cleaning and check-only sessions retain raw facts. Comparison
-- must count only performed cleaning; check-only duration must not alter mean.
INSERT INTO public.sessions(id,session_uuid,client_session_id,location_id,employee_id,device_id,status,started_at,ended_at,duration_minutes,duration_display,completion_source)
 VALUES
 ('f1700000-0000-4000-8000-000000000001','op-f17-clean','op-f17-clean','f1200000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000004','closed',now()-interval '60 minutes',now()-interval '40 minutes',20,'20 min','kiosk_form'),
 ('f1700000-0000-4000-8000-000000000002','op-f17-check','op-f17-check','f1200000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000004','closed',now()-interval '20 minutes',now()-interval '19 minutes',1,'1 min','kiosk_form'),
 ('f1700000-0000-4000-8000-000000000003','op-f17-unknown','op-f17-unknown','f1200000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000004','closed',now()-interval '10 minutes',now()-interval '9 minutes',1,'1 min','kiosk_form');
INSERT INTO public.completion_responses(session_id,location_id,submitted_by_employee_id,device_id,response_json,client_completion_id)
 SELECT id,location_id,employee_id,device_id,
 CASE session_uuid WHEN 'op-f17-clean' THEN '{"work_result":"full","services_performed":["Full Cleaning Services"]}'::jsonb
 ELSE '{"work_result":"checked_no_cleaning_needed","services_performed":[]}'::jsonb END,id::text
 FROM public.sessions WHERE session_uuid IN ('op-f17-clean','op-f17-check');
DO $analytics$
DECLARE r record;
BEGIN
 SELECT * INTO STRICT r FROM public.v_cleaning_performance_comparison WHERE employee_id='f1200000-0000-4000-8000-000000000001' AND location_id='f1200000-0000-4000-8000-000000000003';
 IF r.cleaning_count<>1 OR r.average_duration_minutes<>20 OR r.median_duration_minutes<>20 OR r.minimum_duration_minutes<>20 OR r.maximum_duration_minutes<>20 OR r.location_average_duration_minutes<>20 THEN RAISE EXCEPTION 'check-only contaminates cleaning comparison';END IF;
 IF r.latest_cleaning_at IS DISTINCT FROM (SELECT started_at FROM public.sessions WHERE session_uuid='op-f17-clean') THEN RAISE EXCEPTION 'check-only changes latest cleaned';END IF;
 IF (SELECT count(*) FROM public.v_cleaning_session_facts WHERE session_uuid IN ('op-f17-clean','op-f17-check','op-f17-unknown'))<>3 THEN RAISE EXCEPTION 'raw work facts lost';END IF;
END $analytics$;
SELECT 'F17_CLEANING_COMPARISON_8_CHECKS_PASS';
ROLLBACK;
