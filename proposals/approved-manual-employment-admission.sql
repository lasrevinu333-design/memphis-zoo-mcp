-- WORKER1 PROPOSAL ONLY. NOT canonical migration302 and NOT EXECUTED.
-- Main must install/qualify under its original-owner guarded transaction and
-- include these objects in its normal authority/recovery inventory before use.
-- No employee, roster/history, normal schedule or native SQL body is updated.
BEGIN;
DO $prerequisites$
BEGIN
 IF current_user<>session_user OR current_user NOT IN ('postgres','supabase_admin')
  OR to_regprocedure('public.static_weekly_v3_assert_control_plane()') IS NULL
  OR to_regprocedure('public.custodial_action_actor_v1(uuid,uuid,text,text,text)') IS NULL
  OR to_regprocedure('public.static_weekly_v3_manager_actor(uuid)') IS NULL
  OR to_regclass('public.static_weekly_schedule_control') IS NULL
 THEN RAISE EXCEPTION 'Employment proposal requires the maintained original-owner/control-plane context'; END IF;
END $prerequisites$;
-- Deliberately no IF NOT EXISTS: never adopt a colliding pre-existing namespace.
CREATE SCHEMA custodial_employment;
REVOKE ALL ON SCHEMA custodial_employment FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT USAGE ON SCHEMA custodial_employment TO static_weekly_control_plane;
CREATE TABLE custodial_employment.admissions (
 employee_id uuid NOT NULL REFERENCES public.employees(id),
 employment_revision bigint NOT NULL CHECK(employment_revision BETWEEN 1 AND 9007199254740991),
 request_id uuid NOT NULL UNIQUE,
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 authority_revision bigint NOT NULL CHECK(authority_revision BETWEEN 0 AND 9007199254740990),
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object'),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(employee_id,employment_revision),
 CHECK(employee_id IN('1318b295-fd70-4e78-8828-62c29302f96f'::uuid,'d5fecc86-659b-464a-bc99-f0d914385db4'::uuid))
);
ALTER TABLE custodial_employment.admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_employment.admissions FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER employment_admissions_immutable BEFORE UPDATE OR DELETE ON custodial_employment.admissions
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
ALTER TABLE custodial_employment.admissions ENABLE ALWAYS TRIGGER employment_admissions_immutable;
-- No sequence and no direct-client RLS policies or table grants. Only narrow
-- private-schema definer RPCs owned by the original installer reach the rows.
CREATE FUNCTION custodial_employment.admit(
 p_command jsonb,p_credential_id uuid,p_device_id text,p_session_access text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE employee uuid;manager uuid;request uuid;expected_authority bigint;expected_employment bigint;
 current_authority bigint;previous custodial_employment.admissions%rowtype;
 replay custodial_employment.admissions%rowtype;admitted custodial_employment.admissions%rowtype;
 actor jsonb;f jsonb;initial_fact jsonb;effective date;first_day date;state text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.static_weekly_assert_exact_object(p_command,
  ARRAY['schema','requestId','managerId','employeeId','expectedAuthorityRevision','expectedEmploymentRevision','fact'],
  ARRAY['schema','requestId','managerId','employeeId','expectedAuthorityRevision','expectedEmploymentRevision','fact'],'employment command');
 IF p_command->>'schema' IS DISTINCT FROM 'custodial.employment-admission-command.v1'
  OR jsonb_typeof(p_command->'expectedAuthorityRevision') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_command->'expectedEmploymentRevision') IS DISTINCT FROM 'number'
  OR coalesce(p_command->>'expectedAuthorityRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
  OR coalesce(p_command->>'expectedEmploymentRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
  OR coalesce(p_command->>'employeeId','') NOT IN ('1318b295-fd70-4e78-8828-62c29302f96f','d5fecc86-659b-464a-bc99-f0d914385db4')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Exact scoped employment command required'; END IF;
 employee:=(p_command->>'employeeId')::uuid;manager:=(p_command->>'managerId')::uuid;request:=(p_command->>'requestId')::uuid;
 IF manager IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Explicit manager and request identities required'; END IF;
 expected_authority:=(p_command->>'expectedAuthorityRevision')::bigint;
 expected_employment:=(p_command->>'expectedEmploymentRevision')::bigint;
 IF expected_authority>9007199254740990 OR expected_employment>9007199254740990 THEN RAISE EXCEPTION 'Revision out of bounds'; END IF;
 -- Reuse the maintained write action. Pre-start is NOT delegated PTO.
 actor:=public.custodial_action_actor_v1(manager,p_credential_id,p_device_id,p_session_access,'write');
 PERFORM public.static_weekly_v3_manager_actor(manager);
 IF actor->>'manager_id' IS DISTINCT FROM manager::text OR NOT (
  actor->'owner'='true'::jsonb OR (
   actor->>'actor_kind'='CUSTODIAL_LEADERSHIP_COHORT' AND actor->'owner'='false'::jsonb
   AND actor->'custodialManagementAdmin'='true'::jsonb
   AND actor->>'credential_id'=p_credential_id::text AND actor->>'device_id'=p_device_id
   AND coalesce(actor->>'request_id','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) IS TRUE
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current Custodial management authority required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO replay FROM custodial_employment.admissions WHERE request_id=request;
 IF FOUND THEN
  IF replay.command IS DISTINCT FROM p_command OR replay.manager_id<>manager THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Employment request reused with changed identity or facts'; END IF;
  RETURN jsonb_build_object('schema','custodial.employment-admission-receipt.v1','status','ACCEPTED',
   'employeeId',replay.employee_id,'employmentRevision',replay.employment_revision,
   'acceptedAuthorityRevision',replay.authority_revision,'acceptedByManagerId',replay.manager_id,'command',replay.command);
 END IF;
 SELECT current_revision INTO STRICT current_authority FROM public.static_weekly_schedule_control WHERE singleton FOR SHARE;
 IF current_authority<>expected_authority THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Employment authority revision changed'; END IF;
 PERFORM 1 FROM public.employees WHERE id=employee AND active IS TRUE
  AND display_name=CASE WHEN employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid THEN 'Xavier Green' ELSE 'Jada Rawlings' END FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing active employee identity required; this RPC creates no employee'; END IF;
 f:=p_command->'fact';
 PERFORM public.static_weekly_assert_exact_object(f,
  ARRAY['effectiveFrom','state','ownerEvidenceSha256'],
  ARRAY['effectiveFrom','state','firstServiceDate','approvedLunch','ownerEvidenceSha256'],'employment fact');
 IF NOT (f ?& ARRAY['firstServiceDate','approvedLunch']) THEN RAISE EXCEPTION 'Both nullable employment fields must be present';END IF;
 IF coalesce(f->>'effectiveFrom','') !~ '^[12][0-9]{3}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(f->>'ownerEvidenceSha256','') !~ '^[a-f0-9]{64}$'
  OR f->>'state' NOT IN ('PRE_START','START_DATE_CONFIRMED') OR f->>'state' IS NULL
 THEN RAISE EXCEPTION 'Typed dated employment fact required'; END IF;
 effective:=(f->>'effectiveFrom')::date;state:=f->>'state';
 IF NOT isfinite(effective) OR effective::text<>(f->>'effectiveFrom')
 THEN RAISE EXCEPTION 'Invalid employment fact date'; END IF;
 IF state='PRE_START' THEN
  IF f->'firstServiceDate' IS DISTINCT FROM 'null'::jsonb OR f->'approvedLunch' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'Pre-start has no invented start or lunch'; END IF;
 ELSE
  IF coalesce(f->>'firstServiceDate','') !~ '^[12][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Explicit first service date required'; END IF;
  first_day:=(f->>'firstServiceDate')::date;
  IF NOT isfinite(first_day) OR first_day::text<>f->>'firstServiceDate' OR first_day<effective THEN RAISE EXCEPTION 'Invalid or backdated first service date'; END IF;
 END IF;
 IF f->'approvedLunch' IS DISTINCT FROM 'null'::jsonb THEN
  PERFORM public.static_weekly_assert_exact_object(f->'approvedLunch',ARRAY['start','end'],ARRAY['start','end'],'employment lunch');
  IF coalesce(f#>>'{approvedLunch,start}','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR coalesce(f#>>'{approvedLunch,end}','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR (f#>>'{approvedLunch,end}')::time-(f#>>'{approvedLunch,start}')::time<>interval '1 hour'
  THEN RAISE EXCEPTION 'An approved lunch remains one full hour'; END IF;
 END IF;
 -- Immutable Xavier instruction; no normal lunch-edit authority is introduced.
 IF employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid AND
  (state<>'START_DATE_CONFIRMED' OR first_day IS DISTINCT FROM date '2026-11-01'
   OR f->'approvedLunch' IS DISTINCT FROM '{"start":"12:30","end":"13:30"}'::jsonb)
 THEN RAISE EXCEPTION 'Xavier first service date or approved lunch differs'; END IF;
 SELECT * INTO previous FROM custodial_employment.admissions WHERE employee_id=employee ORDER BY employment_revision DESC LIMIT 1 FOR UPDATE;
 IF coalesce(previous.employment_revision,0)<>expected_employment THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Employee admission revision changed'; END IF;
 IF previous.employment_revision IS NULL THEN
  initial_fact:=jsonb_build_object('effectiveFrom','2026-10-30','state',CASE WHEN employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid THEN 'START_DATE_CONFIRMED' ELSE 'PRE_START' END,
   'firstServiceDate',CASE WHEN employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid THEN '2026-11-01' ELSE NULL END,
   'approvedLunch',CASE WHEN employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid THEN '{"start":"12:30","end":"13:30"}'::jsonb ELSE 'null'::jsonb END,
   'ownerEvidenceSha256','be6c3f5818a8ae1804b85064e083949662710c8d4ced118823ce2bbc6afdaf5c');
  IF f IS DISTINCT FROM initial_fact THEN RAISE EXCEPTION 'Initial admission must bind the exact recorded Eric instruction'; END IF;
 ELSE
  IF previous.command#>>'{fact,state}'='START_DATE_CONFIRMED' THEN RAISE EXCEPTION 'Already admitted first date is historical; no rewrite through this RPC'; END IF;
  IF effective<public.sch_service_date(statement_timestamp()) OR effective<previous.effective_from
   OR (f->>'ownerEvidenceSha256')=(previous.command#>>'{fact,ownerEvidenceSha256}')
  THEN RAISE EXCEPTION 'A later instruction requires new explicit evidence and no historical rewrite'; END IF;
 END IF;
 INSERT INTO custodial_employment.admissions(employee_id,employment_revision,request_id,manager_id,authority_revision,effective_from,command)
 VALUES(employee,expected_employment+1,request,manager,current_authority,effective,p_command) RETURNING * INTO admitted;
 RETURN jsonb_build_object('schema','custodial.employment-admission-receipt.v1','status','ACCEPTED',
  'employeeId',admitted.employee_id,'employmentRevision',admitted.employment_revision,
  'acceptedAuthorityRevision',admitted.authority_revision,'acceptedByManagerId',admitted.manager_id,'command',admitted.command);
END $fn$;
CREATE FUNCTION custodial_employment.read_admissions(
 p_service_date date,p_expected_authority_revision bigint,p_manager uuid,p_credential uuid,p_device text,p_session_access text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE revision bigint;rows jsonb;actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_session_access,'read');
 IF actor->>'manager_id' IS DISTINCT FROM p_manager::text THEN RAISE EXCEPTION 'Current named manager required'; END IF;
 IF p_service_date IS NULL OR NOT isfinite(p_service_date) OR p_expected_authority_revision IS NULL
  OR p_expected_authority_revision NOT BETWEEN 0 AND 9007199254740990 THEN RAISE EXCEPTION 'Exact service date and revision required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton FOR SHARE;
 IF revision<>p_expected_authority_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Employment reader authority revision changed'; END IF;
 SELECT jsonb_agg(jsonb_build_object('employeeId',a.employee_id,'employmentRevision',a.employment_revision,
  'acceptedByManagerId',a.manager_id,'command',a.command) ORDER BY a.employee_id) INTO rows
 FROM (SELECT DISTINCT ON(employee_id) * FROM custodial_employment.admissions
  WHERE effective_from<=p_service_date ORDER BY employee_id,employment_revision DESC) a;
 IF coalesce(jsonb_array_length(rows),0)<>2 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Both controlled employee admissions must exist for this date'; END IF;
 RETURN jsonb_build_object('schema','custodial.employment-admission-read.v1','serviceDate',p_service_date::text,
  'authorityRevision',revision,'employees',rows);
END $fn$;
REVOKE ALL ON FUNCTION custodial_employment.admit(jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
REVOKE ALL ON FUNCTION custodial_employment.read_admissions(date,bigint,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION custodial_employment.admit(jsonb,uuid,text,text) TO static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION custodial_employment.read_admissions(date,bigint,uuid,uuid,text,text) TO static_weekly_control_plane;
COMMIT;
