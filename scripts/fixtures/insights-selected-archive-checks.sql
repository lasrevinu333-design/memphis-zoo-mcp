INSERT INTO public.employees(id,display_name) VALUES ('00000000-0000-4000-8000-000000000003','Fixture employee');
INSERT INTO public.locations(id,location_code,location_name) VALUES ('00000000-0000-4000-8000-000000000004','TEST','Fixture room');
INSERT INTO public.devices(id,device_id) VALUES ('00000000-0000-4000-8000-000000000005','Fixture device');
INSERT INTO public.sessions(id,session_uuid,status,employee_id,location_id,device_id,started_at,ended_at,duration_minutes)
SELECT ('00000000-0000-4000-8000-00000000000'||i)::uuid, 'TEST-'||i,'closed','00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',now()-interval '15 minutes',now(),15
FROM generate_series(1,3) i;
INSERT INTO public.completion_responses(id,session_id,response_json)
SELECT gen_random_uuid(), id,CASE WHEN session_uuid='TEST-3' THEN '{"services_performed":["fixture"],"work_result":"checked_no_cleaning_needed"}'::jsonb
 ELSE '{"services_performed":["Cleaning"]}'::jsonb END FROM public.sessions;
DO $$
DECLARE actor jsonb:='{"actor_kind":"NAMED_MANAGER","manager_id":"00000000-0000-4000-8000-000000000006"}'; other jsonb:=actor||'{"manager_id":"00000000-0000-4000-8000-000000000007"}';
 request jsonb:='{"preview_id":"00000000-0000-4000-8000-000000000008","selections":[{"session_id":"00000000-0000-4000-8000-000000000001","session_uuid":"TEST-1"}],"reason":"Selected synthetic test"}';
 preview jsonb; ref jsonb; receipt jsonb;
BEGIN
 preview:=custodial_leadership_private.insights_archive(actor,'preview',request);
 PERFORM fixture_assert(preview->>'state'='PREVIEW' AND jsonb_array_length(preview->'records')=1,'explicit preview');
 ref:=jsonb_build_object('preview_id',preview->'preview_id','preview_digest',preview->'preview_digest');
 PERFORM fixture_assert(custodial_leadership_private.insights_archive(actor,'status',ref)->>'state'='PREVIEW','pending original');
 BEGIN PERFORM custodial_leadership_private.insights_archive(other,'confirm',ref);RAISE EXCEPTION 'Unexpected foreign archive';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE sessions SET ended_at=ended_at+interval '5 minutes' WHERE session_uuid='TEST-1';
 BEGIN PERFORM custodial_leadership_private.insights_archive(actor,'confirm',ref);RAISE EXCEPTION 'Unexpected stale archive';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM fixture_assert(custodial_leadership_private.insights_archive(actor,'status',ref)->>'state'='STALE','original selection changed without an archive');
 request:=request||jsonb_build_object('preview_id',gen_random_uuid());
 preview:=custodial_leadership_private.insights_archive(actor,'preview',request);
 ref:=jsonb_build_object('preview_id',preview->'preview_id','preview_digest',preview->'preview_digest');
 receipt:=custodial_leadership_private.insights_archive(actor,'confirm',ref);
 PERFORM fixture_assert(receipt->>'state'='ARCHIVED' AND receipt->>'archived_count'='1','exact archive receipt');
 PERFORM fixture_assert(custodial_leadership_private.insights_archive(actor,'confirm',ref)=receipt,'idempotent original');
 PERFORM fixture_assert(custodial_leadership_private.insights_archive(actor,'status',ref)=receipt,'unchanged archive receipt');
 PERFORM fixture_assert((SELECT count(*) FROM sessions)=3 AND (SELECT count(*) FROM completion_responses)=3,'immutable source history preserved');
 PERFORM fixture_assert((SELECT count(*) FROM v_cleaning_session_facts)=3 AND (SELECT count(*) FROM v_insights_cleaning_session_facts)=2,'only selected session excluded from operational view');
 PERFORM fixture_assert((SELECT sum(cleaning_count) FROM v_cleaning_performance_comparison)=2
   AND (SELECT sum(cleaning_count) FROM v_insights_cleaning_performance_comparison)=1,'archived and check-only visits excluded from cleaning totals');
 PERFORM fixture_assert(NOT has_function_privilege('anon','public.custodial_named_insights_archive_v1(uuid,text,text,jsonb)','EXECUTE'),'anonymous archive denied');
END $$;
SELECT 'PASS selected archive, stale or foreign refusal, exact readback, replay and original history';
