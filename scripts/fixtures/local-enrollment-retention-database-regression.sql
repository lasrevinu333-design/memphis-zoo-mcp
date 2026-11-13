BEGIN;
DO $test$ DECLARE actor text;sig text:='public.custodial_record_local_enrollment_retention_v1(uuid,text,text,text)';n integer;
BEGIN
 FOR actor IN SELECT unnest(ARRAY['anon','authenticated','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']) LOOP
  IF has_function_privilege(actor,sig,'EXECUTE') THEN RAISE EXCEPTION 'unintended retention RPC grant: %',actor;END IF;
 END LOOP;
 IF NOT has_function_privilege('service_role',sig,'EXECUTE') THEN RAISE EXCEPTION 'owning service RPC unavailable';END IF;
 FOR actor IN SELECT unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator']) LOOP
  IF has_table_privilege(actor,'custodial_employment.local_retained_enrollments_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'direct retained-history exposure: %',actor;END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='custodial_employment.local_retained_enrollments_v1'::regclass AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'forced RLS missing';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='custodial_employment.local_retained_enrollments_v1'::regclass AND tgenabled='A' AND tgfoid='custodial_recovery.reject_original_mutation()'::regprocedure)<>2 THEN RAISE EXCEPTION 'immutable guards missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='custodial_employment.local_retained_enrollments_v1'::regclass AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'restore mutation fence missing';END IF;
 SELECT count(*) INTO n FROM custodial_employment.local_retained_enrollments_v1;IF n<>0 THEN RAISE EXCEPTION 'nonempty original isolated fixture';END IF;
 BEGIN PERFORM public.custodial_record_local_enrollment_retention_v1(NULL,NULL,NULL,NULL);RAISE EXCEPTION 'missing fact accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.custodial_record_local_enrollment_retention_v1('a1000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'{}');RAISE EXCEPTION 'caller JSON accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.custodial_record_local_enrollment_retention_v1('a1000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('x',16385));RAISE EXCEPTION 'unbounded fact accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF (SELECT count(*) FROM custodial_employment.local_retained_enrollments_v1)<>n THEN RAISE EXCEPTION 'denial fabricated custody receipt';END IF;
 IF pg_get_functiondef('public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure) NOT LIKE '%and not (metadata_json ? ''retained_original_enrollment'')%' THEN RAISE EXCEPTION 'enrollment revokes retained original credential';END IF;
END $test$;
SET LOCAL ROLE service_role;
DO $test$ BEGIN
 BEGIN PERFORM count(*) FROM custodial_employment.local_retained_enrollments_v1;RAISE EXCEPTION 'service direct history read accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.custodial_record_local_enrollment_retention_v1(NULL,NULL,NULL,NULL);RAISE EXCEPTION 'service missing original accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $test$;
RESET ROLE;
SELECT jsonb_build_object('pass',true,'groups',13,'scope','ACTUAL_SQL_ACL_RLS_DENIAL_AND_CONSUMER_FLOOR','positive_manager_native_join',false);
ROLLBACK;
