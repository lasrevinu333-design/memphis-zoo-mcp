-- Private native-basis companion. Compose after employment admissions.
BEGIN;
CREATE FUNCTION custodial_employment.native_read(p_service_date date,p_revision bigint,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actual_revision bigint;records jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT current_revision INTO STRICT actual_revision FROM public.static_weekly_schedule_control WHERE singleton FOR SHARE;
 IF p_service_date IS NULL OR NOT isfinite(p_service_date) OR p_revision IS DISTINCT FROM actual_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Exact current native employment date and authority revision required';END IF;
 SELECT jsonb_agg(jsonb_build_object('employeeId',a.employee_id,'employmentRevision',a.employment_revision,
  'acceptedByManagerId',a.manager_id,'command',a.command) ORDER BY a.employee_id) INTO records
 FROM (SELECT DISTINCT ON(employee_id) * FROM custodial_employment.admissions
  WHERE effective_from<=p_service_date ORDER BY employee_id,employment_revision DESC) a;
 IF coalesce(jsonb_array_length(records),0)<>2 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Both dated employment admissions are required';END IF;
 RETURN jsonb_build_object('schema','custodial.employment-admission-read.v1','serviceDate',p_service_date::text,
  'authorityRevision',actual_revision,'employees',records);
END $fn$;
REVOKE ALL ON FUNCTION custodial_employment.native_read(date,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role,
 static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
COMMIT;
