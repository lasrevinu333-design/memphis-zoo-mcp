-- PROSPECTIVE SOURCE302 ONLY. NOT canonical, enrolled, applied, or release-authorized.
-- Exact Source301 prefix remains untouched. All components share this single transaction.
BEGIN;

-- COMPONENT employment_admission SHA256 4e73fee3afc7fd9ec1ec2b33ede1189a5f7e852f825575d00b990dff75d58c3e
-- WORKER1 PROPOSAL ONLY. NOT canonical migration302 and NOT EXECUTED.
-- Main must install/qualify under its original-owner guarded transaction and
-- include these objects in its normal authority/recovery inventory before use.
-- No employee, roster/history, normal schedule or native SQL body is updated.

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
  OR f->>'state' NOT IN ('PRE_START','START_DATE_CONFIRMED','ACTIVE_FOR_APPROVED_SCHEDULE') OR f->>'state' IS NULL
 THEN RAISE EXCEPTION 'Typed dated employment fact required'; END IF;
 effective:=(f->>'effectiveFrom')::date;state:=f->>'state';
 IF NOT isfinite(effective) OR effective::text<>(f->>'effectiveFrom')
 THEN RAISE EXCEPTION 'Invalid employment fact date'; END IF;
 IF state='PRE_START' THEN
  IF f->'firstServiceDate' IS DISTINCT FROM 'null'::jsonb OR f->'approvedLunch' IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'Pre-start has no invented start or lunch'; END IF;
 ELSIF state='ACTIVE_FOR_APPROVED_SCHEDULE' THEN
  IF f->'firstServiceDate' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Schedule-active availability must not invent an actual hire date'; END IF;
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
 -- Preserve Xavier's actual recorded start history and approved lunch.
 -- The launch availability state is explicit scheduling data, not a hire-date rewrite.
 IF employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid AND
  ((state='START_DATE_CONFIRMED' AND first_day IS DISTINCT FROM date '2026-11-01')
   OR state NOT IN ('START_DATE_CONFIRMED','ACTIVE_FOR_APPROVED_SCHEDULE')
   OR f->'approvedLunch' IS DISTINCT FROM '{"start":"12:30","end":"13:30"}'::jsonb)
 THEN RAISE EXCEPTION 'Xavier first service date or approved lunch differs'; END IF;
 SELECT * INTO previous FROM custodial_employment.admissions WHERE employee_id=employee ORDER BY employment_revision DESC LIMIT 1 FOR UPDATE;
 IF coalesce(previous.employment_revision,0)<>expected_employment THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Employee admission revision changed'; END IF;
 IF previous.employment_revision IS NULL THEN
  initial_fact:=jsonb_build_object('effectiveFrom','2026-10-30','state','ACTIVE_FOR_APPROVED_SCHEDULE',
   'firstServiceDate',NULL,
   'approvedLunch',CASE WHEN employee='1318b295-fd70-4e78-8828-62c29302f96f'::uuid THEN '{"start":"12:30","end":"13:30"}'::jsonb ELSE 'null'::jsonb END,
   'ownerEvidenceSha256','e2e578dc508efde0bec1cc9b0cfaeac765a44fe36b71417960c7bae3323fbeb4');
  IF f IS DISTINCT FROM initial_fact THEN RAISE EXCEPTION 'Initial admission must bind the exact recorded Eric instruction'; END IF;
 ELSE
  IF previous.command#>>'{fact,state}' IN ('START_DATE_CONFIRMED','ACTIVE_FOR_APPROVED_SCHEDULE')
   AND NOT (previous.command#>>'{fact,state}'='START_DATE_CONFIRMED' AND state='ACTIVE_FOR_APPROVED_SCHEDULE'
    AND f->>'ownerEvidenceSha256'='e2e578dc508efde0bec1cc9b0cfaeac765a44fe36b71417960c7bae3323fbeb4')
  THEN RAISE EXCEPTION 'Already admitted first date or schedule availability is historical; no rewrite through this RPC'; END IF;
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


-- COMPONENT employment_native_read SHA256 b1d7a4074f7ddc41d81ad83a8deb9edc419e695d4d662e7374fdcc4ba3106dd9
-- Private native-basis companion. Compose after employment admissions.

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


-- COMPONENT native_period SHA256 7c81ddec8c1ad51df44ea9ee56e591d461952653c50fd91d03c6535691d07f04
-- Main native implementation components, before canonical adoption; no production application.

-- Component SOURCE302_NATIVE_ADMISSION_DRAFT_20261030.sql
-- WORKING successor draft. Owned fixture only until canonical adoption.
-- No production invocation, source regeneration, or role expansion.

set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.static_weekly_manual_exception_summary(p_exceptions jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',e->'id','type',e->'type','serviceDate',e->'serviceDate',
  'payloadDigest',coalesce(e->'payloadDigest',to_jsonb(public.static_weekly_digest_text(format('{"slotId":"%s"}',e#>>'{payload,slotId}'))))) order by n),'[]')
 from jsonb_array_elements(p_exceptions) with ordinality x(e,n)
$fn$;
revoke all on function public.static_weekly_manual_exception_summary(jsonb) from public,anon,authenticated,service_role,
 static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create or replace function public.static_weekly_manual_period_basis(p_manager uuid,p_publication uuid,p_date date,p_revision bigint,p_operation uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source jsonb;normal_source jsonb;original_source jsonb;exceptions jsonb;original_exceptions jsonb;summary jsonb;
 ctx jsonb;actor jsonb;frame date;version uuid;sid uuid;entry record;prior record;prior_json jsonb:=null;
 day_bases jsonb:='[]';body jsonb;original_revision bigint:=p_revision;employment jsonb:='[]';employment_vector jsonb;employment_day date;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if p_revision is null or p_revision not between 0 and 9007199254740991
  or p_revision is distinct from (select current_revision from public.static_weekly_schedule_control where singleton)
  or p_date is null or not isfinite(p_date) then raise exception using errcode='40001',message='Exact current manual period revision and date required';end if;
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_date);
 if source#>>'{compiler_input,version,manualGroupRatingAuthority,manifestSha256}' is distinct from 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  or source->>'publication_id' is distinct from p_publication::text then raise exception 'Exact approved manual publication required';end if;
 frame:=public.static_weekly_source_window_start(source->'compiler_input',p_date);
 source:=public.static_weekly_v3_read_publication_source(p_publication,frame);
 version:=(source->>'version_id')::uuid;
 if public.static_weekly_effective_version(frame) is distinct from version
  or public.static_weekly_effective_version(frame+6) is distinct from version then raise exception 'Manual period crosses an effective publication';end if;
 select authority_source_id into strict sid from public.weekly_schedule_versions where version_id=version;
 select c.template_id,c.owner_config,c.catalog_entry_digest,c.template_json,c.binding_json,c.approval_evidence into strict entry
 from public.static_weekly_approved_initial_baselines b join public.static_weekly_approved_template_catalog c using(template_id)
 where b.source_id=sid and not exists(select 1 from public.static_weekly_approved_template_retirements r where r.template_id=c.template_id);
 if entry.catalog_entry_digest is distinct from public.static_weekly_digest_jsonb(jsonb_build_object(
  'template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  or entry.owner_config->>'approvedManualDataDigest' is distinct from 'eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8'
 then raise exception 'The admitted manual policy/configuration changed';end if;
 normal_source:=jsonb_set(jsonb_set(source->'compiler_input','{serviceDate}',to_jsonb(frame::text),true),'{exceptions}','[]'::jsonb,true);
 if p_operation is not null then
  ctx:=public.static_weekly_pending_context(p_operation,p_manager);
  original_revision:=(ctx#>>'{originalCommand,expectedRevision}')::bigint;
  if frame>(ctx#>>'{originalCommand,semanticBody,endDate}')::date
   or frame+6<(ctx#>>'{originalCommand,semanticBody,startDate}')::date then raise exception 'Manual frame is outside the original command';end if;
  original_exceptions:=public.static_weekly_pending_original_exception_set(p_publication,frame,p_operation);
  exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication,frame,null);
  summary:=public.static_weekly_pending_summary(p_operation,p_publication,frame,null);
  original_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(original_revision),false),'{exceptions}',original_exceptions,false);
 else
  exceptions:=public.static_weekly_compiler_exception_set(p_publication,frame);original_exceptions:=exceptions;
  summary:=public.static_weekly_accepted_exception_set(p_publication,frame);original_source:=source;
 end if;
 select p.projection_id,p.publication_id,p.version_id,p.week_start,p.week_end,p.projection_envelope,l.document_json into prior
 from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
 where p.publication_id=p_publication and p.version_id=version and p.week_start=frame and p.week_end=frame+6
  and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_manual_exception_summary(original_exceptions))
 order by p.compiled_at desc,p.projection_id desc limit 1;
 if found then
  prior_json:=jsonb_build_object('projectionId',prior.projection_id,'publicationId',prior.publication_id,'versionId',prior.version_id,
   'frameStart',prior.week_start::text,'frameEnd',prior.week_end::text,'lunchDocument',prior.document_json);
  day_bases:=coalesce(prior.projection_envelope#>'{authority,datedDayBases}','[]'::jsonb);
 end if;
 for employment_day in select generate_series(frame,frame+6,'1 day')::date loop
  employment:=employment||jsonb_build_array(custodial_employment.native_read(employment_day,p_revision,p_manager));
 end loop;
 select jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId',
  'employmentRevision',e->'employmentRevision','requestId',e#>>'{command,requestId}') order by d->>'serviceDate',e->>'employeeId')
 into employment_vector from jsonb_array_elements(employment) days(d) cross join lateral jsonb_array_elements(d->'employees') employees(e);
 body:=jsonb_build_object('schema','custodial.approved-manual-period-basis.v1','managerId',p_manager,'actor',actor,
  'publicationId',p_publication,'versionId',version,'sourceId',sid,'frameStart',frame::text,'frameEnd',(frame+6)::text,
  'authorityRevision',original_revision,'currentServiceDate',public.sch_service_date(statement_timestamp())::text,
  'originalCommand',ctx->'originalCommand','originalSource',original_source,'normalSource',normal_source,
  'normalSourceDigest',public.static_weekly_digest_jsonb(normal_source),'ownerConfig',entry.owner_config,
  'catalogEntryDigest',entry.catalog_entry_digest,'generation',public.static_weekly_v15_read_recurring_generation(),
  'employmentByDate',employment,'employmentRevisionVector',employment_vector,
  'preparedExceptions',exceptions,'preparedSummary',summary,'priorProjection',prior_json,'priorDayBases',day_bases,
  'priorRefreshTargets',public.static_weekly_v11_read_current_refresh_targets(
   case when p_operation is null then frame else greatest(frame,(ctx#>>'{originalCommand,semanticBody,startDate}')::date) end,
   case when p_operation is null then frame+6 else least(frame+6,(ctx#>>'{originalCommand,semanticBody,endDate}')::date) end,p_manager));
 return body||jsonb_build_object('basisDigest',public.static_weekly_digest_jsonb(body));
end $fn$;
revoke all on function public.static_weekly_manual_period_basis(uuid,uuid,date,bigint,uuid) from public,anon,authenticated,service_role,
 static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_manual_period_basis(uuid,uuid,date,bigint,uuid) to static_weekly_control_plane;

-- Native validator/storage/lunch consumer amendments follow in this same draft.

-- Component SOURCE302_NATIVE_LUNCH_LINEAGE_20261030.sql

-- This small canonical serializer is used only for deterministic lunch keys.
-- It confers no receipt/approval authority and receives no credentials.
create or replace function public.static_weekly_manual_identity_json(p_value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||public.static_weekly_manual_identity_json(v),',' order by k collate "C"),'')||'}' into result from jsonb_each(p_value) x(k,v);
 when 'array' then select '['||coalesce(string_agg(public.static_weekly_manual_identity_json(v),',' order by n),'')||']' into result from jsonb_array_elements(p_value) with ordinality x(v,n);
 else result:=p_value::text;
 end case;return result;
end $fn$;
revoke all on function public.static_weekly_manual_identity_json(jsonb) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create or replace function public.static_weekly_manual_assert_lunch_lineage(p_envelope jsonb,p_document jsonb,p_publication uuid,p_week date)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare retention jsonb:=p_envelope#>'{authority,lunchIdentityRetention}';prior jsonb;loan jsonb;old_loan jsonb;r jsonb;intent jsonb;
 record jsonb;fresh text;area_id text;expected jsonb;actual jsonb;expected_evidence jsonb;target text;edge jsonb;
 cost integer;total_cost integer;source jsonb:=p_envelope#>'{authority,compilerInput}';
begin
 if p_envelope->>'replay_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-array['base_authority_digest','base_replay_digest','document_identity']))
 then raise exception 'Manual native complete lunch replay differs';end if;
 if retention is not null then
  perform public.static_weekly_assert_exact_object(retention,array['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],array['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'manual native retained lunch lineage');
  if retention->>'schema' is distinct from 'custodial.approved-manual-lunch-identity-retention.v1'
   or retention->'requiresSqlOwnerCurrentnessCheck' is distinct from 'true'::jsonb or jsonb_typeof(retention->'loans') is distinct from 'array'
   or (select count(*)<>count(distinct v->>'loanId') from jsonb_array_elements(retention->'loans') v)
  then raise exception 'Manual native retained lunch lineage malformed';end if;
  select l.document_json into strict prior from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
   where p.projection_id=(retention->>'priorProjectionId')::uuid and p.publication_id=p_publication and p.week_start=p_week and p.week_end=p_week+6
    and p.version_id::text=p_envelope#>>'{authority,sourceVersionId}' and l.document_identity=retention->>'priorDocumentIdentity';
 end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
   'policy','owner-20260921-two-nearby-full-hour-v1','input',p_envelope#>'{authority,overlayInputDigest}',
   'serviceDate',loan->'service_date','ownerSlotId',loan->'normal_owner_slot_id','start',loan->'coverage_start','end',loan->'coverage_end')));
  select v into record from jsonb_array_elements(coalesce(retention->'loans','[]')) v where v->'loanId'=loan->'loan_id';
  if record is not null then
   if record is distinct from jsonb_build_object('serviceDate',loan->'service_date','normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id') then raise exception 'Manual native retained loan scope changed';end if;
   select v into strict old_loan from jsonb_array_elements(prior->'loans') v where v->'loan_id'=loan->'loan_id';
   if loan-array['loan_id','total_distance_minutes'] is distinct from old_loan-array['loan_id','total_distance_minutes'] then raise exception 'Manual native retained loan changed its helper or actual hour';end if;
   select coalesce(jsonb_agg(v-array['loan_id','responsibility_id','proximity_evidence'] order by (v-array['loan_id','responsibility_id','proximity_evidence'])::text),'[]') into expected from jsonb_array_elements(prior->'responsibilities') v where v->'loan_id'=loan->'loan_id';
   select coalesce(jsonb_agg(v-array['loan_id','responsibility_id','proximity_evidence'] order by (v-array['loan_id','responsibility_id','proximity_evidence'])::text),'[]') into actual from jsonb_array_elements(p_document->'responsibilities') v where v->'loan_id'=loan->'loan_id';
   if actual is distinct from expected then raise exception 'Manual native retained physical lunch duties changed';end if;
   select coalesce(jsonb_agg(v-array['loan_id','notification_key'] order by (v-array['loan_id','notification_key'])::text),'[]') into expected from jsonb_array_elements(prior->'notification_intents') v where v->'loan_id'=loan->'loan_id';
   select coalesce(jsonb_agg(v-array['loan_id','notification_key'] order by (v-array['loan_id','notification_key'])::text),'[]') into actual from jsonb_array_elements(p_document->'notification_intents') v where v->'loan_id'=loan->'loan_id';
   if actual is distinct from expected then raise exception 'Manual native retained delivery identities changed';end if;
  elsif loan->>'loan_id' is distinct from fresh then raise exception 'Manual native fresh loan key or retained immutable lineage differs';end if;
  total_cost:=0;
  for r in select value from jsonb_array_elements(p_document->'responsibilities') where value->'loan_id'=loan->'loan_id' loop
   select public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_agg(jsonb_build_object(
    'work',s->'planWorkId','start',extract(epoch from (s#>>'{normalWindow,start}')::time)::integer/60,
    'end',extract(epoch from (s#>>'{normalWindow,end}')::time)::integer/60) order by s->>'planWorkId' collate "C"))) into area_id from jsonb_array_elements(r->'segments') s;
   fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object('loanId',r->'loan_id','areaId',area_id,'covererSlotId',r->'coverer_slot_id')));
   if r->>'responsibility_id' is distinct from fresh then raise exception 'Manual native canonical physical responsibility key differs';end if;
   expected_evidence:='[]';cost:=0;
   for target in select distinct w#>>'{work_snapshot,locationId}' from jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(p_envelope->'assignments') w on w->'plan_work_id'=s->'planWorkId' and w->'service_date'=r->'service_date'
    order by 1 loop
    with current_anchors as (
     select distinct w#>>'{work_snapshot,locationId}' id from jsonb_array_elements(p_envelope->'assignments') w
      where w->'service_date'=r->'service_date' and w->'owner_slot_id'=r->'coverer_slot_id'
       and w#>>'{work_snapshot,window,start}'<loan->>'coverage_end' and loan->>'coverage_start'<w#>>'{work_snapshot,window,end}'
    ), anchors as (
     select id from current_anchors
     union all
     select a->>'acceptedRouteAnchorLocationId' from jsonb_array_elements(p_envelope#>'{authority,projectionAvailability}') a
      where a->'serviceDate'=r->'service_date' and a->'slotId'=r->'coverer_slot_id'
       and jsonb_typeof(a->'acceptedRouteAnchorLocationId')='string'
       and coalesce(btrim(a->>'acceptedRouteProvenance'),'')<>'' and not exists(select 1 from current_anchors)
       and exists(select 1 from (
        select v as availability from jsonb_array_elements(source#>'{version,slotAvailability}') v
        union all
        select v||jsonb_build_object('slotId',s->'id') from jsonb_array_elements(source->'slots') s
         cross join lateral jsonb_array_elements(case when jsonb_typeof(s->'contractorAvailability')='array' then s->'contractorAvailability' else '[]'::jsonb end) v
       ) approved where approved.availability->'slotId'=a->'slotId' and approved.availability->'dayOfWeek'=a->'dayOfWeek'
        and approved.availability->'acceptedRouteAnchorLocationId'=a->'acceptedRouteAnchorLocationId'
        and approved.availability->'acceptedRouteProvenance'=a->'acceptedRouteProvenance')
    ), choices as (
     select jsonb_build_object('fromLocationId',id,'toLocationId',target,'minutes',0,'provenance','same_normal_assigned_area') value from anchors where id=target
     union all
     select jsonb_build_object('fromLocationId',id,'toLocationId',target,'minutes',e->'minutes','provenance',e->'provenance')
      from anchors join jsonb_array_elements(source->'proximity') e on
       (e->>'fromLocationId'=id and e->>'toLocationId'=target or e->>'toLocationId'=id and e->>'fromLocationId'=target)
      where e->'verified'='true'::jsonb and jsonb_typeof(e->'minutes')='number' and coalesce(e->>'provenance','')<>''
    ) select value into edge from choices order by (value->>'minutes')::integer,value->>'fromLocationId' collate "C",value->>'provenance' collate "C" limit 1;
    if edge is null then raise exception 'Manual native full-hour helper lacks verified proximity evidence';end if;
    expected_evidence:=expected_evidence||jsonb_build_array(edge);cost:=greatest(cost,(edge->>'minutes')::integer);
   end loop;
   if r->'proximity_evidence' is distinct from expected_evidence then raise exception 'Manual native full-hour proximity differs from actual source edges and current helper areas';end if;
   total_cost:=total_cost+cost;
  end loop;
  if loan->'total_distance_minutes' is distinct from to_jsonb(total_cost) then raise exception 'Manual native lunch proximity total differs';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(retention->'loans','[]')) retained_item where not exists(select 1 from jsonb_array_elements(p_document->'loans') l where l->'loan_id'=retained_item->'loanId')) then raise exception 'Manual native unused retained lunch key';end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object('loanId',intent->'loan_id','slot',intent->'coverer_slot_id','event',intent->'event')));
  if intent->>'notification_key' is distinct from fresh then raise exception 'Manual native canonical lunch notification key differs';end if;
 end loop;
end $fn$;
revoke all on function public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

-- Component SOURCE302_NATIVE_MANAGER_API_20261030.sql

create or replace function public.static_weekly_staffing_period_frames(p_operation uuid,p_manager uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare ctx jsonb;frames jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 select jsonb_agg(jsonb_build_object('serviceDate',d::date::text,
  'frameStart',public.static_weekly_projection_window_start(d::date)::text) order by d) into frames
  from generate_series((ctx#>>'{originalCommand,semanticBody,startDate}')::date,
   (ctx#>>'{originalCommand,semanticBody,endDate}')::date,'1 day') d;
 return jsonb_build_object('schema','custodial.staffing-source-period-frames.v1','originalCommand',ctx->'originalCommand','frames',frames);
end $fn$;
revoke all on function public.static_weekly_staffing_period_frames(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_staffing_period_frames(uuid,uuid) to static_weekly_control_plane;

create or replace function public.static_weekly_manual_projection_view_basis(p_manager uuid,p_projection uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare p public.weekly_schedule_compiled_projections%rowtype;current_state record;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into strict p from public.weekly_schedule_compiled_projections where projection_id=p_projection;
 select * into current_state from public.static_weekly_v6_schedule_authority_state(p.week_start);
 if current_state.projection_status is distinct from 'current' or current_state.projection_id is distinct from p.projection_id
  or p.compiler_version is distinct from 'approved-manual-period-v1'
  or p.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
 then raise exception using errcode='40001',message='Exact current manual dated projection required for manager display';end if;
 return jsonb_build_object('schema','custodial.approved-manual-projection-view-basis.v1','projectionId',p.projection_id,
  'publicationId',p.publication_id,'versionId',p.version_id,'frameStart',p.week_start::text,'frameEnd',p.week_end::text,
  'projectionAvailability',p.projection_envelope#>'{authority,projectionAvailability}');
end $fn$;
revoke all on function public.static_weekly_manual_projection_view_basis(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_manual_projection_view_basis(uuid,uuid) to static_weekly_control_plane;

-- Component SOURCE302_NATIVE_COMPONENTS_GENERATED_20261030.sql
-- Owned fixture working component, not a canonical migration or production admission.

set local statement_timeout='120s';
create or replace function public.static_weekly_manual_absence_policy() returns jsonb language sql immutable set search_path=pg_catalog,public as $policy$ select $data${"schema":"custodial.approved-manual-absence-policy-sql.v1","manifestSha256":"fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f","manualDataDigest":"eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8","days":[{"day":"monday","weekday":1,"sourcePath":"sources/custodial_manual_monday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms"],"basePoints":18},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms"],"basePoints":19},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Tropical Birds","Cat Country","Komodos"],"basePoints":18},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["China and restrooms","Event Center and restrooms","Herpetarium"],"basePoints":17},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","Nocturnal","Primate Canyon","Bonobos restrooms"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Tropical Birds","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","Nocturnal","Primate Canyon","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["China and restrooms","Event Center and restrooms","Herpetarium"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Jada Rawlings","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Jada Rawlings","Tropical Birds":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":18,"Alijah Collins":19,"Jada Rawlings":18,"Kiltra Horton":17,"Xavier Green":20,"Derrick Henderson":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Jada Rawlings","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Jada Rawlings","Tropical Birds":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":37,"Kiltra Horton":31,"Alijah Collins":28,"Xavier Green":20,"Derrick Henderson":20}},{"start":"15:00","owners":{"Teton and restrooms":"Kiltra Horton","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Derrick Henderson","Tropical Birds":"Derrick Henderson","Cat Country":"Derrick Henderson","Komodos":"Derrick Henderson","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"16:00","zooWideCoverage":false,"points":{"Kiltra Horton":50,"Alijah Collins":28,"Derrick Henderson":38,"Xavier Green":20}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","China and restrooms":"Xavier Green","Event Center and restrooms":"Xavier Green","Herpetarium":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Bonobos restrooms":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"tuesday","weekday":2,"sourcePath":"sources/custodial_manual_tuesday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Karen Robinson","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Tammy Miller","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Xavier Green","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Tammy Miller","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Derrick Henderson":23,"Xavier Green":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Jada Rawlings","East End restrooms":"Jada Rawlings","Zambezi and restrooms":"Kathy Phelps","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":47,"Kathy Phelps":46,"Derrick Henderson":23,"Xavier Green":20}},{"start":"15:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Derrick Henderson","Breezeway restrooms":"Derrick Henderson","Tropical Birds":"Derrick Henderson","East Admin and restrooms":"Derrick Henderson","West Admin and restrooms":"Derrick Henderson","Courtyard restrooms":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Xavier Green":67,"Derrick Henderson":69}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"wednesday","weekday":3,"sourcePath":"sources/custodial_manual_wednesday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"basePoints":27},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"basePoints":29}],"lunches":[{"recipient":"Tammy Miller","coverer":"Karen Robinson","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Derrick Henderson","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Xavier Green","start":"10:30","end":"11:30","groups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Derrick Henderson","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Derrick Henderson","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Derrick Henderson","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","Nocturnal":"Karen Robinson","Primate Canyon":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":27,"Kathy Phelps":29,"Derrick Henderson":27,"Xavier Green":29}},{"start":"14:00","owners":{"Teton and restrooms":"Derrick Henderson","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Derrick Henderson":46,"Xavier Green":43,"Kathy Phelps":47}},{"start":"15:00","owners":{"Teton and restrooms":"Derrick Henderson","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Derrick Henderson","Breezeway restrooms":"Derrick Henderson","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Derrick Henderson","East Admin and restrooms":"Derrick Henderson","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Derrick Henderson":68,"Xavier Green":68}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Herpetarium":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"thursday","weekday":4,"sourcePath":"sources/custodial_manual_thursday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["China and restrooms","Bonobos restrooms","Cat House Cafe restrooms","Event Center and restrooms"],"basePoints":27},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Komodos","Herpetarium"],"basePoints":29}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Alijah Collins","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Kiltra Horton","start":"10:30","end":"11:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Komodos","Herpetarium"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Kathy Phelps","start":"11:30","end":"12:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["China and restrooms","Bonobos restrooms","Cat House Cafe restrooms","Event Center and restrooms"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Alijah Collins","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"07:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Kathy Phelps":29,"Alijah Collins":27,"Kiltra Horton":27,"Derrick Henderson":29}},{"start":"14:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":37,"Kiltra Horton":41,"Kathy Phelps":29,"Derrick Henderson":29}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","East Admin and restrooms":"Kiltra Horton","West Admin and restrooms":"Derrick Henderson","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Alijah Collins","Cat Country":"Derrick Henderson","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":45,"Kiltra Horton":46,"Derrick Henderson":45}}],"checkedWindow":{"start":"07:00","end":"16:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"friday","weekday":5,"sourcePath":"sources/custodial_manual_friday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Kathy Phelps","start":"12:00","end":"13:00","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"07:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Kiltra Horton":23,"Alijah Collins":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Jada Rawlings","East End restrooms":"Jada Rawlings","Zambezi and restrooms":"Kathy Phelps","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":47,"Kathy Phelps":46,"Kiltra Horton":23,"Alijah Collins":20}},{"start":"15:00","owners":{"Teton and restrooms":"Kiltra Horton","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","East Admin and restrooms":"Kiltra Horton","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Kiltra Horton","Cat House Cafe restrooms":"Alijah Collins","Herpetarium":"Alijah Collins","Event Center and restrooms":"Alijah Collins","Cat Country":"Kiltra Horton","Komodos":"Alijah Collins","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"16:00","zooWideCoverage":false,"points":{"Kiltra Horton":67,"Alijah Collins":69}}],"checkedWindow":{"start":"07:00","end":"16:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"saturday","weekday":6,"sourcePath":"sources/custodial_manual_saturday_working_draft.json","employees":[{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Kathy Phelps","start":"12:00","end":"13:00","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Jada Rawlings","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Alijah Collins":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Kiltra Horton":23,"Xavier Green":20}},{"start":"14:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Jada Rawlings","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":36,"Kathy Phelps":29,"Jada Rawlings":28,"Kiltra Horton":23,"Xavier Green":20}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Xavier Green","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Kiltra Horton","Courtyard restrooms":"Kiltra Horton","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","Cat House Cafe restrooms":"Kiltra Horton","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Kiltra Horton","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":45,"Kiltra Horton":52,"Xavier Green":39}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"sunday","weekday":0,"sourcePath":"sources/custodial_manual_sunday_working_draft.json","employees":[{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"basePoints":27},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"basePoints":29}],"lunches":[{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Xavier Green","start":"10:30","end":"11:30","groups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"retainsOwnBase":true}],"transfers":[{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Kiltra Horton","Nocturnal":"Kiltra Horton","Primate Canyon":"Kiltra Horton","East Admin and restrooms":"Jada Rawlings","West Admin and restrooms":"Jada Rawlings","Courtyard restrooms":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Jada Rawlings","Cat Country":"Jada Rawlings","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":24,"Kiltra Horton":27,"Jada Rawlings":29,"Derrick Henderson":27,"Xavier Green":29}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Kiltra Horton","Nocturnal":"Kiltra Horton","Primate Canyon":"Kiltra Horton","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","Cat Country":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":36,"Kiltra Horton":35,"Derrick Henderson":36,"Xavier Green":29}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Herpetarium":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"}],"groups":[{"code":"AQUARIUM","name":"Aquarium","points":5,"locationId":"c09dd3a9-808b-4c41-a237-9759a91be3ab"},{"code":"BONOBOS_RESTROOMS","name":"Bonobos restrooms","points":8,"locationId":"d6f8ab36-555b-4a08-8763-272ba37d2b04"},{"code":"BREEZEWAY_RESTROOMS","name":"Breezeway restrooms","points":6,"locationId":"403edde1-f4c5-4c57-8d9d-b2c2703667f4"},{"code":"CAT_COUNTRY","name":"Cat Country","points":2,"locationId":"6bab7a02-7053-4dc3-88b2-784b15e48d4a"},{"code":"CATHOUSE_CAFE_RESTROOMS","name":"Cat House Cafe restrooms","points":7,"locationId":"9eb69196-c103-4a9f-873a-227d32c42ccd"},{"code":"CHINA","name":"China and restrooms","points":7,"locationId":"cde94274-5631-401d-9d57-812e6b47f5ee"},{"code":"COURTYARD_RESTROOMS","name":"Courtyard restrooms","points":7,"locationId":"79edb5d2-e792-4464-9725-780123431dee"},{"code":"EAST_ADMIN","name":"East Admin and restrooms","points":5,"locationId":"7fdde9c1-b334-4adc-ae3e-350ff9419b2b"},{"code":"EAST_END_RESTROOMS","name":"East End restrooms","points":7,"locationId":"72ba55c0-6f64-42dd-a721-98d1717ae350"},{"code":"EDUCATION","name":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","points":8,"locationId":"5933e02f-1dca-4d19-a5c0-e40e5d2f229c"},{"code":"EVENT_CENTER","name":"Event Center and restrooms","points":5,"locationId":"a6ae6887-394a-42e2-b406-8d3c99395be6"},{"code":"EXPO","name":"Expo and restrooms","points":8,"locationId":"81c5cf06-3808-4da9-88d3-408ecc3d9afd"},{"code":"HERPETARIUM","name":"Herpetarium","points":5,"locationId":"7a6ef424-142e-4d0b-9202-8007c3283ae7"},{"code":"KOMODOS","name":"Komodos","points":4,"locationId":"8513ed80-a2da-4eb4-be09-156f62053a05"},{"code":"MEMMEX_RESTROOMS","name":"MemMex restrooms","points":7,"locationId":"8f158d2b-6a2b-4091-9a3a-ed5cf535f627"},{"code":"NOCTURNAL","name":"Nocturnal","points":3,"locationId":"22b1e8d2-e0ba-4ff8-ae4e-3cbe85df27d3"},{"code":"NORTH_WEST_PASSAGE","name":"Northwest Passage","points":7,"locationId":"a92ecadc-c286-47c7-aaad-2550642abedf"},{"code":"PRIMATE_CANYON","name":"Primate Canyon","points":1,"locationId":"0da4b781-f2d2-49c5-af9a-a81e607a85e2"},{"code":"PRIMATE_PAVILLION","name":"Primate Pavilion","points":3,"locationId":"b47d52a4-15aa-4498-be58-cf8a716e8510"},{"code":"TETON","name":"Teton and restrooms","points":10,"locationId":"e127dc20-98ea-4c21-9a8d-5274d29f8508"},{"code":"TROPICAL_BIRDS","name":"Tropical Birds","points":5,"locationId":"d7d70c17-86cd-4f77-be6b-74b4665cfb9c"},{"code":"WEST_ADMIN","name":"West Admin and restrooms","points":7,"locationId":"58418743-10d7-4d22-97f8-1a33d4a969d4"},{"code":"ZAMBEZI","name":"Zambezi and restrooms","points":9,"locationId":"ca8da3d2-57e0-40be-ae23-f06810ca835b"}],"access":{"schema":"custodial.approved-manual-access-proposal.v1","manifestSha256":"fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f","gpsReferenceSha256":"651ee0aeba8266f4f2b591c13ccc0af86b6fd62b815516ad7f5f10a749ac1c42","source":"packet/REQUIREMENTS_EXTRACTED.json:proximity_planning.explicit_directives","directConnections":[["ZAMBEZI","PRIMATE_PAVILLION"],["PRIMATE_PAVILLION","PRIMATE_CANYON"],["TETON","NORTH_WEST_PASSAGE"],["TETON","EAST_END_RESTROOMS"],["NORTH_WEST_PASSAGE","EAST_END_RESTROOMS"],["COURTYARD_RESTROOMS","BREEZEWAY_RESTROOMS"],["BREEZEWAY_RESTROOMS","EDUCATION"],["BONOBOS_RESTROOMS","CATHOUSE_CAFE_RESTROOMS"]],"neighborhoods":[["ZAMBEZI","PRIMATE_PAVILLION","PRIMATE_CANYON","BREEZEWAY_RESTROOMS"],["PRIMATE_CANYON","CHINA","BONOBOS_RESTROOMS"],["COURTYARD_RESTROOMS","BREEZEWAY_RESTROOMS","EDUCATION","NOCTURNAL","CATHOUSE_CAFE_RESTROOMS","CAT_COUNTRY","PRIMATE_CANYON"],["HERPETARIUM","EVENT_CENTER","BONOBOS_RESTROOMS","CHINA","PRIMATE_CANYON"],["CATHOUSE_CAFE_RESTROOMS","TROPICAL_BIRDS","HERPETARIUM","EVENT_CENTER","KOMODOS"],["HERPETARIUM","EVENT_CENTER","KOMODOS","AQUARIUM"],["HERPETARIUM","KOMODOS","AQUARIUM","EXPO","MEMMEX_RESTROOMS"],["TROPICAL_BIRDS","MEMMEX_RESTROOMS","EXPO","AQUARIUM"]],"pairs":[{"from":"AQUARIUM","to":"BONOBOS_RESTROOMS","meters":257.004111927322,"accessFactor":1,"accessPenaltyMeters":257.004111927322,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"BREEZEWAY_RESTROOMS","meters":311.7026799488406,"accessFactor":1,"accessPenaltyMeters":311.7026799488406,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CAT_COUNTRY","meters":244.88901783393726,"accessFactor":1,"accessPenaltyMeters":244.88901783393726,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CATHOUSE_CAFE_RESTROOMS","meters":261.022480269194,"accessFactor":1,"accessPenaltyMeters":261.022480269194,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CHINA","meters":305.21043399761356,"accessFactor":1,"accessPenaltyMeters":305.21043399761356,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"COURTYARD_RESTROOMS","meters":298.86945592017713,"accessFactor":1,"accessPenaltyMeters":298.86945592017713,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EAST_ADMIN","meters":324.1012486521421,"accessFactor":1,"accessPenaltyMeters":324.1012486521421,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EAST_END_RESTROOMS","meters":629.8890004253901,"accessFactor":1,"accessPenaltyMeters":629.8890004253901,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EDUCATION","meters":311.7026799488406,"accessFactor":1,"accessPenaltyMeters":311.7026799488406,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EVENT_CENTER","meters":207.7444749876901,"accessFactor":0.9,"accessPenaltyMeters":186.9700274889211,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"EXPO","meters":72.72571910300128,"accessFactor":0.9,"accessPenaltyMeters":65.45314719270115,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"HERPETARIUM","meters":188.82264413738795,"accessFactor":0.9,"accessPenaltyMeters":169.94037972364916,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"KOMODOS","meters":172.0143887760625,"accessFactor":0.9,"accessPenaltyMeters":154.81294989845625,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"MEMMEX_RESTROOMS","meters":106.1818567997055,"accessFactor":0.9,"accessPenaltyMeters":95.56367111973495,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"NOCTURNAL","meters":286.74196393773764,"accessFactor":1,"accessPenaltyMeters":286.74196393773764,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"NORTH_WEST_PASSAGE","meters":712.1775186773023,"accessFactor":1,"accessPenaltyMeters":712.1775186773023,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"PRIMATE_CANYON","meters":319.01404359327125,"accessFactor":1,"accessPenaltyMeters":319.01404359327125,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"PRIMATE_PAVILLION","meters":437.3667363814047,"accessFactor":1,"accessPenaltyMeters":437.3667363814047,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"TETON","meters":807.6262463035904,"accessFactor":1,"accessPenaltyMeters":807.6262463035904,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"TROPICAL_BIRDS","meters":183.1939007304591,"accessFactor":0.9,"accessPenaltyMeters":164.8745106574132,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"WEST_ADMIN","meters":315.6230106680201,"accessFactor":1,"accessPenaltyMeters":315.6230106680201,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"ZAMBEZI","meters":447.1331160827563,"accessFactor":1,"accessPenaltyMeters":447.1331160827563,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"BREEZEWAY_RESTROOMS","meters":97.97446535067661,"accessFactor":1,"accessPenaltyMeters":97.97446535067661,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"CAT_COUNTRY","meters":127.22341971151191,"accessFactor":1,"accessPenaltyMeters":127.22341971151191,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"CATHOUSE_CAFE_RESTROOMS","meters":74.60607691833864,"accessFactor":0.8,"accessPenaltyMeters":59.684861534670915,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BONOBOS_RESTROOMS","to":"CHINA","meters":48.28789955688835,"accessFactor":0.9,"accessPenaltyMeters":43.459109601199515,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":140.0911401332584,"accessFactor":1,"accessPenaltyMeters":140.0911401332584,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EAST_ADMIN","meters":147.03047060618735,"accessFactor":1,"accessPenaltyMeters":147.03047060618735,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EAST_END_RESTROOMS","meters":373.0587064180441,"accessFactor":1,"accessPenaltyMeters":373.0587064180441,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EDUCATION","meters":97.97446535067661,"accessFactor":1,"accessPenaltyMeters":97.97446535067661,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EVENT_CENTER","meters":49.38423350740313,"accessFactor":0.9,"accessPenaltyMeters":44.445810156662816,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"EXPO","meters":260.6168058521447,"accessFactor":1,"accessPenaltyMeters":260.6168058521447,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"HERPETARIUM","meters":72.88760050848681,"accessFactor":0.9,"accessPenaltyMeters":65.59884045763813,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"KOMODOS","meters":93.42570568275852,"accessFactor":1,"accessPenaltyMeters":93.42570568275852,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":225.18317973846476,"accessFactor":1,"accessPenaltyMeters":225.18317973846476,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"NOCTURNAL","meters":64.86197652101218,"accessFactor":1,"accessPenaltyMeters":64.86197652101218,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":455.21261039082054,"accessFactor":1,"accessPenaltyMeters":455.21261039082054,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"PRIMATE_CANYON","meters":66.93608236549974,"accessFactor":0.9,"accessPenaltyMeters":60.24247412894977,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"PRIMATE_PAVILLION","meters":186.04355117405305,"accessFactor":1,"accessPenaltyMeters":186.04355117405305,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"TETON","meters":554.5444771863981,"accessFactor":1,"accessPenaltyMeters":554.5444771863981,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"TROPICAL_BIRDS","meters":153.3261126761712,"accessFactor":1,"accessPenaltyMeters":153.3261126761712,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"WEST_ADMIN","meters":161.68402737736082,"accessFactor":1,"accessPenaltyMeters":161.68402737736082,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"ZAMBEZI","meters":214.40929757403515,"accessFactor":1,"accessPenaltyMeters":214.40929757403515,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"CAT_COUNTRY","meters":90.64116456468146,"accessFactor":0.9,"accessPenaltyMeters":81.57704810821332,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"CATHOUSE_CAFE_RESTROOMS","meters":50.680361028353985,"accessFactor":0.9,"accessPenaltyMeters":45.612324925518585,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"CHINA","meters":91.86603152853112,"accessFactor":1,"accessPenaltyMeters":91.86603152853112,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":61.98056921055859,"accessFactor":0.8,"accessPenaltyMeters":49.584455368446875,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BREEZEWAY_RESTROOMS","to":"EAST_ADMIN","meters":55.09476402594937,"accessFactor":1,"accessPenaltyMeters":55.09476402594937,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EAST_END_RESTROOMS","meters":347.4832582621281,"accessFactor":1,"accessPenaltyMeters":347.4832582621281,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EDUCATION","meters":0,"accessFactor":0.8,"accessPenaltyMeters":0,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BREEZEWAY_RESTROOMS","to":"EVENT_CENTER","meters":124.91537376122744,"accessFactor":1,"accessPenaltyMeters":124.91537376122744,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EXPO","meters":292.6439644289392,"accessFactor":1,"accessPenaltyMeters":292.6439644289392,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"HERPETARIUM","meters":129.68957935791545,"accessFactor":1,"accessPenaltyMeters":129.68957935791545,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"KOMODOS","meters":176.87466720919656,"accessFactor":1,"accessPenaltyMeters":176.87466720919656,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":247.09721364160384,"accessFactor":1,"accessPenaltyMeters":247.09721364160384,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"NOCTURNAL","meters":33.63754310973425,"accessFactor":0.9,"accessPenaltyMeters":30.27378879876083,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":420.67598536225546,"accessFactor":1,"accessPenaltyMeters":420.67598536225546,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"PRIMATE_CANYON","meters":63.42718269419478,"accessFactor":0.9,"accessPenaltyMeters":57.0844644247753,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"PRIMATE_PAVILLION","meters":137.60439665597158,"accessFactor":0.9,"accessPenaltyMeters":123.84395699037442,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"TETON","meters":501.11695372347896,"accessFactor":1,"accessPenaltyMeters":501.11695372347896,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"TROPICAL_BIRDS","meters":152.02189623084715,"accessFactor":1,"accessPenaltyMeters":152.02189623084715,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"WEST_ADMIN","meters":77.45629001637936,"accessFactor":1,"accessPenaltyMeters":77.45629001637936,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"ZAMBEZI","meters":135.44450459663543,"accessFactor":0.9,"accessPenaltyMeters":121.90005413697189,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"CATHOUSE_CAFE_RESTROOMS","meters":58.218761179322236,"accessFactor":0.9,"accessPenaltyMeters":52.396885061390016,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"CHINA","meters":153.049528932374,"accessFactor":1,"accessPenaltyMeters":153.049528932374,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"COURTYARD_RESTROOMS","meters":54.34276748638329,"accessFactor":0.9,"accessPenaltyMeters":48.90849073774496,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"EAST_ADMIN","meters":80.6099991177304,"accessFactor":1,"accessPenaltyMeters":80.6099991177304,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EAST_END_RESTROOMS","meters":438.0720024815665,"accessFactor":1,"accessPenaltyMeters":438.0720024815665,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EDUCATION","meters":90.64116456468146,"accessFactor":0.9,"accessPenaltyMeters":81.57704810821332,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"EVENT_CENTER","meters":116.62210534754105,"accessFactor":1,"accessPenaltyMeters":116.62210534754105,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EXPO","meters":212.34583744648936,"accessFactor":1,"accessPenaltyMeters":212.34583744648936,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"HERPETARIUM","meters":101.0182185654753,"accessFactor":1,"accessPenaltyMeters":101.0182185654753,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"KOMODOS","meters":157.66464128798026,"accessFactor":1,"accessPenaltyMeters":157.66464128798026,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"MEMMEX_RESTROOMS","meters":164.12300912204893,"accessFactor":1,"accessPenaltyMeters":164.12300912204893,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"NOCTURNAL","meters":89.02154049815448,"accessFactor":0.9,"accessPenaltyMeters":80.11938644833903,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"NORTH_WEST_PASSAGE","meters":510.3472924355067,"accessFactor":1,"accessPenaltyMeters":510.3472924355067,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"PRIMATE_CANYON","meters":138.63700727545265,"accessFactor":0.9,"accessPenaltyMeters":124.77330654790738,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"PRIMATE_PAVILLION","meters":227.74388903740098,"accessFactor":1,"accessPenaltyMeters":227.74388903740098,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"TETON","meters":585.5164579925811,"accessFactor":1,"accessPenaltyMeters":585.5164579925811,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"TROPICAL_BIRDS","meters":66.66980592695452,"accessFactor":1,"accessPenaltyMeters":66.66980592695452,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"WEST_ADMIN","meters":71.07746619560888,"accessFactor":1,"accessPenaltyMeters":71.07746619560888,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"ZAMBEZI","meters":214.55798217855684,"accessFactor":1,"accessPenaltyMeters":214.55798217855684,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"CHINA","meters":94.89721133761815,"accessFactor":1,"accessPenaltyMeters":94.89721133761815,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":67.06450100755605,"accessFactor":0.9,"accessPenaltyMeters":60.35805090680044,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EAST_ADMIN","meters":79.87082689965402,"accessFactor":1,"accessPenaltyMeters":79.87082689965402,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EAST_END_RESTROOMS","meters":390.4351840007441,"accessFactor":1,"accessPenaltyMeters":390.4351840007441,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EDUCATION","meters":50.680361028353985,"accessFactor":0.9,"accessPenaltyMeters":45.612324925518585,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EVENT_CENTER","meters":82.87540084222886,"accessFactor":0.9,"accessPenaltyMeters":74.58786075800597,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EXPO","meters":243.58068136905638,"accessFactor":1,"accessPenaltyMeters":243.58068136905638,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"HERPETARIUM","meters":81.61249037370736,"accessFactor":0.9,"accessPenaltyMeters":73.45124133633662,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"KOMODOS","meters":133.41146184234546,"accessFactor":0.9,"accessPenaltyMeters":120.07031565811091,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":199.29076067102406,"accessFactor":1,"accessPenaltyMeters":199.29076067102406,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"NOCTURNAL","meters":33.050612202216314,"accessFactor":0.9,"accessPenaltyMeters":29.745550981994683,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":466.34443602712827,"accessFactor":1,"accessPenaltyMeters":466.34443602712827,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"PRIMATE_CANYON","meters":81.86585235182227,"accessFactor":0.9,"accessPenaltyMeters":73.67926711664005,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"PRIMATE_PAVILLION","meters":183.69873468737322,"accessFactor":1,"accessPenaltyMeters":183.69873468737322,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"TETON","meters":550.5804895571487,"accessFactor":1,"accessPenaltyMeters":550.5804895571487,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"TROPICAL_BIRDS","meters":107.54816882623973,"accessFactor":0.9,"accessPenaltyMeters":96.79335194361576,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"WEST_ADMIN","meters":89.298917906417,"accessFactor":1,"accessPenaltyMeters":89.298917906417,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"ZAMBEZI","meters":186.11780189868173,"accessFactor":1,"accessPenaltyMeters":186.11780189868173,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"COURTYARD_RESTROOMS","meters":148.7584361749359,"accessFactor":1,"accessPenaltyMeters":148.7584361749359,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EAST_ADMIN","meters":146.85756541649778,"accessFactor":1,"accessPenaltyMeters":146.85756541649778,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EAST_END_RESTROOMS","meters":324.7775230028438,"accessFactor":1,"accessPenaltyMeters":324.7775230028438,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EDUCATION","meters":91.86603152853112,"accessFactor":1,"accessPenaltyMeters":91.86603152853112,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EVENT_CENTER","meters":97.67212991984556,"accessFactor":0.9,"accessPenaltyMeters":87.90491692786101,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"EXPO","meters":307.93693944002786,"accessFactor":1,"accessPenaltyMeters":307.93693944002786,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"HERPETARIUM","meters":120.31249396125546,"accessFactor":0.9,"accessPenaltyMeters":108.28124456512991,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"KOMODOS","meters":139.07024763527062,"accessFactor":1,"accessPenaltyMeters":139.07024763527062,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"MEMMEX_RESTROOMS","meters":270.89738715563914,"accessFactor":1,"accessPenaltyMeters":270.89738715563914,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"NOCTURNAL","meters":68.30713559280396,"accessFactor":1,"accessPenaltyMeters":68.30713559280396,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"NORTH_WEST_PASSAGE","meters":407.1206389400806,"accessFactor":1,"accessPenaltyMeters":407.1206389400806,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"PRIMATE_CANYON","meters":33.55838030490072,"accessFactor":0.9,"accessPenaltyMeters":30.20254227441065,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"PRIMATE_PAVILLION","meters":142.52585499143,"accessFactor":1,"accessPenaltyMeters":142.52585499143,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"TETON","meters":508.23801969216873,"accessFactor":1,"accessPenaltyMeters":508.23801969216873,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"TROPICAL_BIRDS","meters":192.35624730630792,"accessFactor":1,"accessPenaltyMeters":192.35624730630792,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"WEST_ADMIN","meters":167.52880332919509,"accessFactor":1,"accessPenaltyMeters":167.52880332919509,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"ZAMBEZI","meters":180.58410044340724,"accessFactor":1,"accessPenaltyMeters":180.58410044340724,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EAST_ADMIN","meters":26.89318744860133,"accessFactor":1,"accessPenaltyMeters":26.89318744860133,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EAST_END_RESTROOMS","meters":398.1196110537417,"accessFactor":1,"accessPenaltyMeters":398.1196110537417,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EDUCATION","meters":61.98056921055859,"accessFactor":0.9,"accessPenaltyMeters":55.78251228950273,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"EVENT_CENTER","meters":147.92424941144975,"accessFactor":1,"accessPenaltyMeters":147.92424941144975,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EXPO","meters":266.1457620170777,"accessFactor":1,"accessPenaltyMeters":266.1457620170777,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"HERPETARIUM","meters":140.5502702998514,"accessFactor":1,"accessPenaltyMeters":140.5502702998514,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"KOMODOS","meters":196.0732808302883,"accessFactor":1,"accessPenaltyMeters":196.0732808302883,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":217.49871167512043,"accessFactor":1,"accessPenaltyMeters":217.49871167512043,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"NOCTURNAL","meters":81.00104998248855,"accessFactor":0.9,"accessPenaltyMeters":72.9009449842397,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":466.48087397883535,"accessFactor":1,"accessPenaltyMeters":466.48087397883535,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"PRIMATE_CANYON","meters":124.07250449752162,"accessFactor":0.9,"accessPenaltyMeters":111.66525404776947,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"PRIMATE_PAVILLION","meters":187.40468997235476,"accessFactor":1,"accessPenaltyMeters":187.40468997235476,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"TETON","meters":535.6107524418265,"accessFactor":1,"accessPenaltyMeters":535.6107524418265,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"TROPICAL_BIRDS","meters":120.37980483815592,"accessFactor":1,"accessPenaltyMeters":120.37980483815592,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"WEST_ADMIN","meters":22.36857958471583,"accessFactor":1,"accessPenaltyMeters":22.36857958471583,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"ZAMBEZI","meters":164.26770706974088,"accessFactor":1,"accessPenaltyMeters":164.26770706974088,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EAST_END_RESTROOMS","meters":375.1043654734762,"accessFactor":1,"accessPenaltyMeters":375.1043654734762,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EDUCATION","meters":55.09476402594937,"accessFactor":1,"accessPenaltyMeters":55.09476402594937,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EVENT_CENTER","meters":162.7455838603921,"accessFactor":1,"accessPenaltyMeters":162.7455838603921,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EXPO","meters":292.8073302313168,"accessFactor":1,"accessPenaltyMeters":292.8073302313168,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"HERPETARIUM","meters":159.11308227144238,"accessFactor":1,"accessPenaltyMeters":159.11308227144238,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"KOMODOS","meters":212.91746278849078,"accessFactor":1,"accessPenaltyMeters":212.91746278849078,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"MEMMEX_RESTROOMS","meters":244.27174557131767,"accessFactor":1,"accessPenaltyMeters":244.27174557131767,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"NOCTURNAL","meters":83.21861914156709,"accessFactor":1,"accessPenaltyMeters":83.21861914156709,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"NORTH_WEST_PASSAGE","meters":441.8450846047211,"accessFactor":1,"accessPenaltyMeters":441.8450846047211,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"PRIMATE_CANYON","meters":118.16109893452689,"accessFactor":1,"accessPenaltyMeters":118.16109893452689,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"PRIMATE_PAVILLION","meters":165.28296186298448,"accessFactor":1,"accessPenaltyMeters":165.28296186298448,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"TETON","meters":509.0903654805302,"accessFactor":1,"accessPenaltyMeters":509.0903654805302,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"TROPICAL_BIRDS","meters":147.02365291443957,"accessFactor":1,"accessPenaltyMeters":147.02365291443957,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"WEST_ADMIN","meters":26.391842285513583,"accessFactor":1,"accessPenaltyMeters":26.391842285513583,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"ZAMBEZI","meters":137.9110822304892,"accessFactor":1,"accessPenaltyMeters":137.9110822304892,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EDUCATION","meters":347.4832582621281,"accessFactor":1,"accessPenaltyMeters":347.4832582621281,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EVENT_CENTER","meters":422.4373092416116,"accessFactor":1,"accessPenaltyMeters":422.4373092416116,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EXPO","meters":629.4875888453029,"accessFactor":1,"accessPenaltyMeters":629.4875888453029,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"HERPETARIUM","meters":443.9000316577989,"accessFactor":1,"accessPenaltyMeters":443.9000316577989,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"KOMODOS","meters":460.75663066313615,"accessFactor":1,"accessPenaltyMeters":460.75663066313615,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":588.3256437662415,"accessFactor":1,"accessPenaltyMeters":588.3256437662415,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"NOCTURNAL","meters":358.04084419943996,"accessFactor":1,"accessPenaltyMeters":358.04084419943996,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":87.02097181198371,"accessFactor":0.8,"accessPenaltyMeters":69.61677744958698,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"EAST_END_RESTROOMS","to":"PRIMATE_CANYON","meters":315.2148931645013,"accessFactor":1,"accessPenaltyMeters":315.2148931645013,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"PRIMATE_PAVILLION","meters":210.95461519396002,"accessFactor":1,"accessPenaltyMeters":210.95461519396002,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"TETON","meters":216.25866363286238,"accessFactor":0.8,"accessPenaltyMeters":173.0069309062899,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"EAST_END_RESTROOMS","to":"TROPICAL_BIRDS","meters":497.7174361060428,"accessFactor":1,"accessPenaltyMeters":497.7174361060428,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"WEST_ADMIN","meters":400.36198800392134,"accessFactor":1,"accessPenaltyMeters":400.36198800392134,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"ZAMBEZI","meters":249.59805643413895,"accessFactor":1,"accessPenaltyMeters":249.59805643413895,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"EVENT_CENTER","meters":124.91537376122744,"accessFactor":1,"accessPenaltyMeters":124.91537376122744,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"EXPO","meters":292.6439644289392,"accessFactor":1,"accessPenaltyMeters":292.6439644289392,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"HERPETARIUM","meters":129.68957935791545,"accessFactor":1,"accessPenaltyMeters":129.68957935791545,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"KOMODOS","meters":176.87466720919656,"accessFactor":1,"accessPenaltyMeters":176.87466720919656,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"MEMMEX_RESTROOMS","meters":247.09721364160384,"accessFactor":1,"accessPenaltyMeters":247.09721364160384,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"NOCTURNAL","meters":33.63754310973425,"accessFactor":0.9,"accessPenaltyMeters":30.27378879876083,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EDUCATION","to":"NORTH_WEST_PASSAGE","meters":420.67598536225546,"accessFactor":1,"accessPenaltyMeters":420.67598536225546,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"PRIMATE_CANYON","meters":63.42718269419478,"accessFactor":0.9,"accessPenaltyMeters":57.0844644247753,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EDUCATION","to":"PRIMATE_PAVILLION","meters":137.60439665597158,"accessFactor":1,"accessPenaltyMeters":137.60439665597158,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"TETON","meters":501.11695372347896,"accessFactor":1,"accessPenaltyMeters":501.11695372347896,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"TROPICAL_BIRDS","meters":152.02189623084715,"accessFactor":1,"accessPenaltyMeters":152.02189623084715,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"WEST_ADMIN","meters":77.45629001637936,"accessFactor":1,"accessPenaltyMeters":77.45629001637936,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"ZAMBEZI","meters":135.44450459663543,"accessFactor":1,"accessPenaltyMeters":135.44450459663543,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"EXPO","meters":212.66613791912852,"accessFactor":1,"accessPenaltyMeters":212.66613791912852,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"HERPETARIUM","meters":27.652558020623893,"accessFactor":0.9,"accessPenaltyMeters":24.887302218561505,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"KOMODOS","meters":51.967065132479206,"accessFactor":0.9,"accessPenaltyMeters":46.77035861923129,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"MEMMEX_RESTROOMS","meters":179.81694103476158,"accessFactor":1,"accessPenaltyMeters":179.81694103476158,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"NOCTURNAL","meters":92.51070947277358,"accessFactor":1,"accessPenaltyMeters":92.51070947277358,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"NORTH_WEST_PASSAGE","meters":504.4332578101666,"accessFactor":1,"accessPenaltyMeters":504.4332578101666,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"PRIMATE_CANYON","meters":112.83942386448523,"accessFactor":0.9,"accessPenaltyMeters":101.55548147803671,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"PRIMATE_PAVILLION","meters":232.498073622756,"accessFactor":1,"accessPenaltyMeters":232.498073622756,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"TETON","meters":602.2180129592856,"accessFactor":1,"accessPenaltyMeters":602.2180129592856,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"TROPICAL_BIRDS","meters":120.53612201586888,"accessFactor":0.9,"accessPenaltyMeters":108.482509814282,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"WEST_ADMIN","meters":170.26222150526888,"accessFactor":1,"accessPenaltyMeters":170.26222150526888,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"ZAMBEZI","meters":253.87372653446806,"accessFactor":1,"accessPenaltyMeters":253.87372653446806,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"HERPETARIUM","meters":187.7626483480702,"accessFactor":0.9,"accessPenaltyMeters":168.98638351326318,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"KOMODOS","meters":192.88888516407195,"accessFactor":0.9,"accessPenaltyMeters":173.59999664766477,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"MEMMEX_RESTROOMS","meters":49.47943733871161,"accessFactor":0.9,"accessPenaltyMeters":44.53149360484045,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"NOCTURNAL","meters":273.88360423952054,"accessFactor":1,"accessPenaltyMeters":273.88360423952054,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"NORTH_WEST_PASSAGE","meters":708.2174811290038,"accessFactor":1,"accessPenaltyMeters":708.2174811290038,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"PRIMATE_CANYON","meters":314.27422629080576,"accessFactor":1,"accessPenaltyMeters":314.27422629080576,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"PRIMATE_PAVILLION","meters":426.86471207740277,"accessFactor":1,"accessPenaltyMeters":426.86471207740277,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"TETON","meters":793.7609115822203,"accessFactor":1,"accessPenaltyMeters":793.7609115822203,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"TROPICAL_BIRDS","meters":145.78423847241064,"accessFactor":0.9,"accessPenaltyMeters":131.20581462516958,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"WEST_ADMIN","meters":279.2324654095386,"accessFactor":1,"accessPenaltyMeters":279.2324654095386,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"ZAMBEZI","meters":425.19641400546874,"accessFactor":1,"accessPenaltyMeters":425.19641400546874,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"KOMODOS","meters":56.73350680626607,"accessFactor":0.9,"accessPenaltyMeters":51.060156125639466,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"MEMMEX_RESTROOMS","meters":153.03018933764423,"accessFactor":0.9,"accessPenaltyMeters":137.72717040387982,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"NOCTURNAL","meters":100.41811438880997,"accessFactor":1,"accessPenaltyMeters":100.41811438880997,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"NORTH_WEST_PASSAGE","meters":524.7166323122547,"accessFactor":1,"accessPenaltyMeters":524.7166323122547,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"PRIMATE_CANYON","meters":130.38555266822863,"accessFactor":0.9,"accessPenaltyMeters":117.34699740140577,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"PRIMATE_PAVILLION","meters":248.6050471186126,"accessFactor":1,"accessPenaltyMeters":248.6050471186126,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"TETON","meters":618.8975220846683,"accessFactor":1,"accessPenaltyMeters":618.8975220846683,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"TROPICAL_BIRDS","meters":94.47966780681524,"accessFactor":0.9,"accessPenaltyMeters":85.03170102613372,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"WEST_ADMIN","meters":162.35912008720058,"accessFactor":1,"accessPenaltyMeters":162.35912008720058,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"ZAMBEZI","meters":263.3326921541501,"accessFactor":1,"accessPenaltyMeters":263.3326921541501,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"MEMMEX_RESTROOMS","meters":170.91012293230295,"accessFactor":0.9,"accessPenaltyMeters":153.81911063907268,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"KOMODOS","to":"NOCTURNAL","meters":144.41093910560278,"accessFactor":1,"accessPenaltyMeters":144.41093910560278,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"NORTH_WEST_PASSAGE","meters":544.6090682010657,"accessFactor":1,"accessPenaltyMeters":544.6090682010657,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"PRIMATE_CANYON","meters":160.21300517760437,"accessFactor":1,"accessPenaltyMeters":160.21300517760437,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"PRIMATE_PAVILLION","meters":279.4565263252229,"accessFactor":1,"accessPenaltyMeters":279.4565263252229,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"TETON","meters":647.2573350309109,"accessFactor":1,"accessPenaltyMeters":647.2573350309109,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"TROPICAL_BIRDS","meters":141.06579610513595,"accessFactor":0.9,"accessPenaltyMeters":126.95921649462235,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"KOMODOS","to":"WEST_ADMIN","meters":218.14883674239326,"accessFactor":1,"accessPenaltyMeters":218.14883674239326,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"ZAMBEZI","meters":304.86901090693385,"accessFactor":1,"accessPenaltyMeters":304.86901090693385,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"NOCTURNAL","meters":230.74340107779145,"accessFactor":1,"accessPenaltyMeters":230.74340107779145,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":665.4876367883281,"accessFactor":1,"accessPenaltyMeters":665.4876367883281,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"PRIMATE_CANYON","meters":273.73538371037904,"accessFactor":1,"accessPenaltyMeters":273.73538371037904,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"PRIMATE_PAVILLION","meters":382.98354177722115,"accessFactor":1,"accessPenaltyMeters":382.98354177722115,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"TETON","meters":747.7832286118311,"accessFactor":1,"accessPenaltyMeters":747.7832286118311,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"TROPICAL_BIRDS","meters":97.46150252032129,"accessFactor":0.9,"accessPenaltyMeters":87.71535226828917,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"MEMMEX_RESTROOMS","to":"WEST_ADMIN","meters":230.04903262871892,"accessFactor":1,"accessPenaltyMeters":230.04903262871892,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"ZAMBEZI","meters":378.0164059494047,"accessFactor":1,"accessPenaltyMeters":378.0164059494047,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"NORTH_WEST_PASSAGE","meters":434.7846944837164,"accessFactor":1,"accessPenaltyMeters":434.7846944837164,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"PRIMATE_CANYON","meters":49.61766500484374,"accessFactor":0.9,"accessPenaltyMeters":44.655898504359364,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"NOCTURNAL","to":"PRIMATE_PAVILLION","meters":153.04395928444524,"accessFactor":1,"accessPenaltyMeters":153.04395928444524,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"TETON","meters":521.9138050332882,"accessFactor":1,"accessPenaltyMeters":521.9138050332882,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"TROPICAL_BIRDS","meters":140.44139365573847,"accessFactor":1,"accessPenaltyMeters":140.44139365573847,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"WEST_ADMIN","meters":100.8817304689436,"accessFactor":1,"accessPenaltyMeters":100.8817304689436,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"ZAMBEZI","meters":162.97004643204536,"accessFactor":1,"accessPenaltyMeters":162.97004643204536,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"PRIMATE_CANYON","meters":394.74537474831794,"accessFactor":1,"accessPenaltyMeters":394.74537474831794,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"PRIMATE_PAVILLION","meters":283.13987835370824,"accessFactor":1,"accessPenaltyMeters":283.13987835370824,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"TETON","meters":137.54391742730496,"accessFactor":0.8,"accessPenaltyMeters":110.03513394184398,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"NORTH_WEST_PASSAGE","to":"TROPICAL_BIRDS","meters":572.4916551794838,"accessFactor":1,"accessPenaltyMeters":572.4916551794838,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"WEST_ADMIN","meters":465.8422688581184,"accessFactor":1,"accessPenaltyMeters":465.8422688581184,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"ZAMBEZI","meters":308.1464669653667,"accessFactor":1,"accessPenaltyMeters":308.1464669653667,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"PRIMATE_PAVILLION","meters":119.71053482208401,"accessFactor":0.8,"accessPenaltyMeters":95.76842785766722,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"PRIMATE_CANYON","to":"TETON","meters":489.45561971089785,"accessFactor":1,"accessPenaltyMeters":489.45561971089785,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"TROPICAL_BIRDS","meters":187.56016945260276,"accessFactor":1,"accessPenaltyMeters":187.56016945260276,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"WEST_ADMIN","meters":140.82380738199785,"accessFactor":1,"accessPenaltyMeters":140.82380738199785,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"ZAMBEZI","meters":149.6968413548715,"accessFactor":0.9,"accessPenaltyMeters":134.72715721938437,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"PRIMATE_PAVILLION","to":"TETON","meters":370.293600675028,"accessFactor":1,"accessPenaltyMeters":370.293600675028,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"TROPICAL_BIRDS","meters":289.35534738323804,"accessFactor":1,"accessPenaltyMeters":289.35534738323804,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"WEST_ADMIN","meters":191.14256064372205,"accessFactor":1,"accessPenaltyMeters":191.14256064372205,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"ZAMBEZI","meters":70.1402784666306,"accessFactor":0.8,"accessPenaltyMeters":56.11222277330449,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"TETON","to":"TROPICAL_BIRDS","meters":651.192185626034,"accessFactor":1,"accessPenaltyMeters":651.192185626034,"accessBasis":"GPS_BASELINE"},{"from":"TETON","to":"WEST_ADMIN","meters":529.6270044396,"accessFactor":1,"accessPenaltyMeters":529.6270044396,"accessBasis":"GPS_BASELINE"},{"from":"TETON","to":"ZAMBEZI","meters":371.3934522745182,"accessFactor":1,"accessPenaltyMeters":371.3934522745182,"accessBasis":"GPS_BASELINE"},{"from":"TROPICAL_BIRDS","to":"WEST_ADMIN","meters":134.3538929845857,"accessFactor":1,"accessPenaltyMeters":134.3538929845857,"accessBasis":"GPS_BASELINE"},{"from":"TROPICAL_BIRDS","to":"ZAMBEZI","meters":280.78673609909043,"accessFactor":1,"accessPenaltyMeters":280.78673609909043,"accessBasis":"GPS_BASELINE"},{"from":"WEST_ADMIN","to":"ZAMBEZI","meters":159.75465170947604,"accessFactor":1,"accessPenaltyMeters":159.75465170947604,"accessBasis":"GPS_BASELINE"}],"fixedDenominatorMeters":807.6262463035904,"directConnectionFactor":0.8,"sharedNeighborhoodFactor":0.9,"otherFactor":1,"overlapsStacked":false,"transitiveNeighborhoodMerging":false,"acceptedLongRoute":["ZAMBEZI","TROPICAL_BIRDS"],"acceptedLongRouteDiscounted":false,"formulaApproved":true,"approvalQuestionId":"call_97aaa12c08a84a0e8afed222696e481c","walkingTimeClaimed":false,"walkingDistancesMeasured":false,"productionWritten":false,"accessProposalDigest":"d4100dc85c5b031a537875b0cd84abada922c8bfb16ac510130ac6467750275b"}}$data$::jsonb $policy$;
revoke all on function public.static_weekly_manual_absence_policy() from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
create or replace function public.static_weekly_manual_assert_absence_score(p_day jsonb,p_normal jsonb,p_policy jsonb,p_availability jsonb,p_rows jsonb,p_config jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare input jsonb:=p_day->'input';plan jsonb:=p_day->'plan';d text:=p_day->>'serviceDate';
 start_at text:=plan#>>'{checkedWindow,start}';end_at text:=plan#>>'{checkedWindow,end}';
 phase jsonb;prior jsonb;loan jsonb;helper jsonb;recipient jsonb;group_row jsonb;slice jsonb;owners jsonb;points jsonb;
 expected jsonb;actual jsonb;anchors jsonb;keys jsonb;code text;owner text;normal_owner text;t text;last_t text;
 p_sum numeric:=0;l_sum numeric:=0;total_minutes numeric:=0;p_loss numeric;l_loss numeric;distance numeric;minutes numeric;n integer;
 tammy text:=p_config#>>'{slots,TAMMY,slotId}';china_minutes integer:=0;tammy_reliefs integer:=0;preferred_minutes integer:=0;
 preferred_key text;preferred_slot text;preferred_codes text[];
begin
 select jsonb_agg(r->'code' order by r->>'code') into keys from jsonb_array_elements(p_policy->'groups') r;
 select coalesce(jsonb_agg(jsonb_build_object('start',case when ord=1 then start_at else ph->>'start' end,
  'end',least(ph->>'end',end_at)) order by ord),'[]') into expected
  from jsonb_array_elements(p_normal->'phases') with ordinality x(ph,ord)
  where (case when ord=1 then start_at else ph->>'start' end)<least(ph->>'end',end_at);
 select coalesce(jsonb_agg(ph->'window' order by ord),'[]') into actual from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,ord);
 if actual is distinct from expected then raise exception 'Manual native phase window or static departure changed';end if;
 prior:=null;
 for phase in select value from jsonb_array_elements(plan->'phaseOwners') loop
  if (select coalesce(jsonb_agg(k order by k),'[]') from jsonb_object_keys(phase->'owners') k) is distinct from keys then raise exception 'Manual native phase does not own the 23 exact groups';end if;
  for code,owner in select key,value#>>'{}' from jsonb_each(phase->'owners') loop
   if not exists(select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=owner
    and r->>'status'='working' and r#>>'{shift,start}'<=phase#>>'{window,start}' and r#>>'{shift,end}'>=phase#>>'{window,end}')
   then raise exception 'Manual native phase owner is not actually on shift';end if;
   if prior is not null and prior#>>array['owners',code] is distinct from owner and not exists(
    select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=prior#>>array['owners',code]
     and r#>>'{shift,end}'=phase#>>'{window,start}') then raise exception 'Manual native phase reshuffled an available owner';end if;
  end loop;
  foreach preferred_key in array array['KAREN','KATHY'] loop
   preferred_slot:=p_config#>>array['slots',preferred_key,'slotId'];
   preferred_codes:=case when preferred_key='KAREN' then array['ZAMBEZI','PRIMATE_PAVILLION'] else array['EAST_ADMIN','WEST_ADMIN'] end;
   if exists(select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=preferred_slot
    and r->>'status'='working' and r#>>'{shift,start}'<=phase#>>'{window,start}' and r#>>'{shift,end}'>=phase#>>'{window,end}') then
    foreach code in array preferred_codes loop
     if phase#>>array['owners',code] is distinct from preferred_slot then preferred_minutes:=preferred_minutes+
      extract(epoch from ((phase#>>'{window,end}')::time-(phase#>>'{window,start}')::time))::integer/60;end if;
    end loop;
   end if;
  end loop;
  prior:=phase;
 end loop;
 select coalesce(jsonb_agg(r->'slotId' order by r->>'slotId'),'[]') into expected from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working';
 select coalesce(jsonb_agg(r->'recipientSlotId' order by r->>'recipientSlotId'),'[]') into actual from jsonb_array_elements(plan->'lunchPlans') r;
 if actual is distinct from expected then raise exception 'Manual native full-hour lunch plan omits or duplicates a worker';end if;
 for loan in select value from jsonb_array_elements(plan->'lunchPlans') loop
  select r into strict recipient from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->'slotId'=loan->'recipientSlotId';
  select r into strict helper from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->'slotId'=loan->'covererSlotId';
  if loan->'window' is distinct from recipient->'lunch' or (loan#>>'{window,end}')::time-(loan#>>'{window,start}')::time<>interval '1 hour'
   or loan->'recipientSlotId'=loan->'covererSlotId' or helper->>'status' is distinct from 'working'
   or helper#>>'{shift,start}'>loan#>>'{window,start}' or helper#>>'{shift,end}'<loan#>>'{window,end}'
   or helper#>>'{lunch,start}'<loan#>>'{window,end}' and loan#>>'{window,start}'<helper#>>'{lunch,end}'
  then raise exception 'Manual native full-hour helper availability changed';end if;
  select coalesce(jsonb_agg(to_jsonb(codes.code) order by codes.code collate "C"),'[]') into expected from (
   select distinct key code from jsonb_array_elements(plan->'phaseOwners') p cross join lateral jsonb_each(p->'owners') o
   where p#>>'{window,start}'<loan#>>'{window,end}' and loan#>>'{window,start}'<p#>>'{window,end}' and o.value=loan->'recipientSlotId') codes;
  if loan->'areas' is distinct from expected then raise exception 'Manual native lunch omits inherited groups';end if;
  if loan->>'covererSlotId'=tammy then tammy_reliefs:=tammy_reliefs+1;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(plan->'lunchPlans') a join jsonb_array_elements(plan->'lunchPlans') b
  on a->'recipientSlotId'<b->'recipientSlotId' and a->'covererSlotId'=b->'covererSlotId'
   and a#>>'{window,start}'<b#>>'{window,end}' and b#>>'{window,start}'<a#>>'{window,end}')
 then raise exception 'Manual native helper appointments overlap';end if;
 -- Derive the slice boundaries independently from actual shift/lunch facts.
 select jsonb_agg(v order by v) into expected from (
  select distinct v from (
   select start_at v union all select end_at union all
   select ph#>>'{window,start}' from jsonb_array_elements(plan->'phaseOwners') ph union all
   select ph#>>'{window,end}' from jsonb_array_elements(plan->'phaseOwners') ph union all
   select av#>>'{lunch,start}' from jsonb_array_elements(p_availability) av where av->>'serviceDate'=d and av->>'status'='working' union all
   select av#>>'{lunch,end}' from jsonb_array_elements(p_availability) av where av->>'serviceDate'=d and av->>'status'='working'
  ) q where v>=start_at and v<=end_at) boundaries;
 select jsonb_agg(v order by v) into actual from (select distinct v from (
  select r#>>'{window,start}' v from jsonb_array_elements(plan->'coverage') r union all
  select r#>>'{window,end}' from jsonb_array_elements(plan->'coverage') r) q) boundaries;
 if actual is distinct from expected then raise exception 'Manual native actual duration slices changed';end if;
 last_t:=start_at;
 for slice in select value from jsonb_array_elements(plan->'coverage') loop
  t:=slice#>>'{window,start}';
  if t is distinct from last_t or t>=slice#>>'{window,end}' then raise exception 'Manual native scored coverage has a gap or overlap';end if;
  select ph into strict phase from jsonb_array_elements(plan->'phaseOwners') ph where ph#>>'{window,start}'<=t and t<ph#>>'{window,end}';
  points:='{}';owners:='{}';n:=0;p_loss:=0;
  for recipient in select r from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working'
   and r#>>'{shift,start}'<=t and t<r#>>'{shift,end}' and not(r#>>'{lunch,start}'<=t and t<r#>>'{lunch,end}') loop
   points:=points||jsonb_build_object(recipient->>'slotId',0);n:=n+1;
  end loop;
  if n=0 then raise exception 'Manual native coverage has no actually available owner';end if;
  for group_row in select value from jsonb_array_elements(p_policy->'groups') loop
   code:=group_row->>'code';normal_owner:=phase#>>array['owners',code];owner:=normal_owner;
   select r into strict recipient from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=normal_owner;
   if recipient#>>'{lunch,start}'<=t and t<recipient#>>'{lunch,end}' then
    select l into strict loan from jsonb_array_elements(plan->'lunchPlans') l where l->>'recipientSlotId'=normal_owner;
    owner:=loan->>'covererSlotId';
   end if;
   if not(points ? owner) then raise exception 'Manual native owner is off shift or on lunch';end if;
   owners:=owners||jsonb_build_object(code,owner);points:=jsonb_set(points,array[owner],to_jsonb((points->>owner)::integer+(group_row->>'points')::integer));
   if owner=tammy and code not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA') then raise exception 'Manual native Tammy received an unauthorized extra';end if;
   if code in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS') and points ? tammy and owner is distinct from tammy then raise exception 'Manual native Tammy lost an available core area';end if;
   select r->'baseCodes' into strict anchors from jsonb_array_elements(input->'roster') r where r->>'slotId'=owner;
   select min(case when anchor=code then 0 else (
    select (pair->>'accessPenaltyMeters')::numeric from jsonb_array_elements(p_policy#>'{access,pairs}') pair
     where pair->>'from'=anchor and pair->>'to'=code or pair->>'from'=code and pair->>'to'=anchor) end)
    into distance from jsonb_array_elements_text(anchors) anchor;
   if distance is null then raise exception 'Manual native approved normal distance anchor missing';end if;
   p_loss:=p_loss+distance/807.6262463035904/23;
  end loop;
  select case when n=1 then 0 else sum(abs((v#>>'{}')::numeric-136.0/n))/(272*(1-1.0/n)) end into l_loss from jsonb_each(points) x(k,v);
  minutes:=extract(epoch from ((slice#>>'{window,end}')::time-t::time))/60;
  if slice->'owners' is distinct from owners or slice->'zooWideCoverage' is distinct from to_jsonb(
   (select count(*)=1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working' and r#>>'{shift,start}'<=t and t<r#>>'{shift,end}') and n=1)
   or p_loss not between 0 and 1.000000001 or l_loss not between 0 and 1.000000001
  then raise exception 'Manual native complete 23-group slice, Zoo Wide Coverage or penalty scale differs';end if;
  if owners->>'CHINA'=tammy then china_minutes:=china_minutes+minutes::integer;end if;
  p_sum:=p_sum+minutes*p_loss;l_sum:=l_sum+minutes*l_loss;total_minutes:=total_minutes+minutes;last_t:=slice#>>'{window,end}';
 end loop;
 if last_t is distinct from end_at or total_minutes<=0
  or abs((plan#>>'{scoreBreakdown,proximityPenalty}')::numeric-100*p_sum/total_minutes)>0.000001
  or abs((plan#>>'{scoreBreakdown,workloadPenalty}')::numeric-100*l_sum/total_minutes)>0.000001
  or abs((plan#>>'{scoreBreakdown,combinedPenalty}')::numeric-100*(.75*p_sum+.25*l_sum)/total_minutes)>0.000001
  or abs((plan->>'normalizedScore')::numeric-(.75*p_sum+.25*l_sum)/total_minutes)>0.00000001
  or plan->'policyLimits' is distinct from jsonb_build_object('tammyChinaExtraMinutes',china_minutes,'tammyReliefAppointments',tammy_reliefs,'preferredCoreMovedMinutes',preferred_minutes)
 then raise exception 'Manual native exact fixed 75/25 duration score or personal priority evidence differs';end if;
end $fn$;
revoke all on function public.static_weekly_manual_assert_absence_score(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
-- Successor component, exercised only in the current owned disposable fixture.
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.static_weekly_manual_assert_native_projection(p_operation uuid,p_manager uuid,p_envelope jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare ctx jsonb;basis jsonb;snapshot jsonb:=p_envelope->'semantic_snapshot';a jsonb:=p_envelope->'authority';source jsonb;
 frame date;publication uuid;version uuid;expected_dates jsonb;day date;dow integer;normal_day jsonb;day_basis jsonb;plan jsonb;
 item jsonb;w jsonb;parent jsonb;link jsonb;availability jsonb;expected jsonb;actual jsonb;slot jsonb;person jsonb;
 base jsonb;exceptions jsonb;summary jsonb;links jsonb:='{}';expected_availability jsonb:='[]';absent jsonb;
 complete_start text;complete_end text;normal_start text;normal_end text;previous_owner text;previous_end text;
 row_owner text;owner_config jsonb;code text;normal_changed boolean;day_changed boolean;inherited boolean;
 input jsonb;phase jsonb;previous_phase jsonb;slice jsonb;loan jsonb;owners jsonb;points jsonb;anchors jsonb;policy jsonb;
 p_loss numeric;l_loss numeric;n integer;minutes numeric;total_minutes numeric;weighted_p numeric;weighted_l numeric;actual_effort numeric;
 count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;employment_employee jsonb;pre_start jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 perform public.static_weekly_assert_exact_object(p_envelope,
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'manual native projection');
 perform public.static_weekly_assert_exact_object(snapshot,
  array['schema','originalCommand','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],
  array['schema','originalCommand','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],'manual native original snapshot');
 if snapshot->>'schema' is distinct from 'custodial.approved-manual-pending-staffing-snapshot.v1'
  or snapshot->'originalCommand' is distinct from ctx->'originalCommand'
  or coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(snapshot->>'nativeBasisDigest','')!~'^[0-9a-f]{64}$'
 then raise exception 'Manual native original command differs';end if;
 frame:=(snapshot->>'weekStart')::date;publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 basis:=public.static_weekly_manual_period_basis(p_manager,publication,frame,
  (select current_revision from public.static_weekly_schedule_control where singleton),p_operation);
 source:=basis->'normalSource';version:=(basis->>'versionId')::uuid;exceptions:=basis->'preparedExceptions';summary:=basis->'preparedSummary';
 if frame::text is distinct from basis->>'frameStart' or snapshot->'originalSource' is distinct from basis->'originalSource'
  or snapshot->'generation' is distinct from basis->'generation' or snapshot->'catalogEntryDigest' is distinct from basis->'catalogEntryDigest'
  or (not (ctx->>'afterFact')::boolean and snapshot->'nativeBasisDigest' is distinct from basis->'basisDigest')
 then raise exception 'Manual native current Source or preparation basis changed';end if;
 if (ctx->>'afterFact')::boolean and not exists(select 1 from public.static_weekly_staffing_staged_candidates s
  where s.operation_id=p_operation and s.candidate_kind='projection' and s.service_date=frame and s.payload_json->'envelope'=p_envelope)
 then raise exception 'Manual native acceptance must use the exact immutable staged preview';end if;
 select jsonb_agg(d::date::text order by d) into expected_dates from generate_series(
  greatest(frame,(ctx#>>'{originalCommand,semanticBody,startDate}')::date),
  least(frame+6,(ctx#>>'{originalCommand,semanticBody,endDate}')::date),'1 day') d;
 if snapshot->'scopeDates' is distinct from expected_dates or a->'compilerInput' is distinct from source
  or a->>'schema' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
  or a->>'sourceDigest' is distinct from basis->>'normalSourceDigest'
  or a->>'sourcePublicationId' is distinct from publication::text or a->>'sourceVersionId' is distinct from version::text
  or a->>'frameStart' is distinct from frame::text or a->>'frameEnd' is distinct from (frame+6)::text
  or a->'normalSourceChanged' is distinct from 'false'::jsonb or a->'objectiveSolverRerun' is distinct from 'false'::jsonb
  or a->>'acceptedExceptionsDigest' is distinct from public.static_weekly_digest_jsonb(exceptions)
  or a->'employmentRevisionVector' is distinct from basis->'employmentRevisionVector'
  or a->>'formulaObjectiveDigest' is distinct from '7796e95573b389d8d77fc80502d4f6f7f1b54a5155327f9a7f1eb42a7137f531'
  or p_envelope->'applied_exceptions' is distinct from summary
  or p_envelope->'adapter' is distinct from '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
  or p_envelope->>'compiler_version' is distinct from 'approved-manual-period-v1'
  or p_envelope->>'service_date' is distinct from frame::text or p_envelope->>'week_start' is distinct from frame::text
  or p_envelope->>'week_end' is distinct from (frame+6)::text
  or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(a)
  or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  or p_envelope->'objective' is distinct from jsonb_build_object('contract','OWNER_APPROVED_MANUAL_DATED_75_25_V2',
   'formulaObjectiveDigest',a->'formulaObjectiveDigest','proximityPercent',75,'workloadPercent',25,'normalDaysOptimized',false)
  or p_envelope->'metrics' is distinct from jsonb_build_object('hardConstraints',a->'hardConstraintCount','violations',0)
  or p_envelope#>>'{receipt,schema}' is distinct from 'custodial.approved-manual-native-feasibility-data.v1'
  or p_envelope#>'{receipt,hardConstraintCount}' is distinct from a->'hardConstraintCount'
  or p_envelope#>'{receipt,hardConstraintDigest}' is distinct from a->'hardConstraintDigest'
  or p_envelope#>'{receipt,fixedWitnessDigest}' is distinct from a->'fixedWitnessDigest'
 then raise exception 'Manual native envelope identity or approved formula differs';end if;
 if jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_array_length(p_envelope->'assignments') not between 1 and 4096
  or jsonb_typeof(a->'datedDayBases') is distinct from 'array' or jsonb_array_length(a->'datedDayBases')>7
  or jsonb_typeof(a->'parentLinks') is distinct from 'array' or jsonb_array_length(a->'parentLinks')>4096
  or jsonb_typeof(a->'projectionAvailability') is distinct from 'array' or jsonb_array_length(a->'projectionAvailability')>224
  or (select count(*)<>count(distinct r->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') r)
  or (select count(*)<>count(distinct r->>'serviceDate') from jsonb_array_elements(a->'datedDayBases') r)
  or (select count(*)<>count(distinct r->>'workId') from jsonb_array_elements(a->'parentLinks') r)
 then raise exception 'Manual native bounded unique records required';end if;
 -- This first admission supports full-day canonical PTO/absence and its exact
 -- cancellation. Other exception shapes fail closed, never silently disappear.
 if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')
 then raise exception using errcode='0A000',message='Manual native exception requires its qualified dated profile';end if;
 policy:=public.static_weekly_manual_absence_policy();
 for base in select value from jsonb_array_elements(source#>'{version,slotAvailability}') loop
  dow:=(base->>'dayOfWeek')::integer;day:=frame+mod(dow-extract(dow from frame)::integer+7,7);
  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and (
   exists(select 1 from jsonb_array_elements(exceptions) e
    join jsonb_array_elements(source#>'{version,slotAvailability}') av on av->'slotId'=e#>'{payload,slotId}' and av->>'dayOfWeek'=dow::text and av->>'status'='working'
    where e->>'serviceDate'=day::text and e->>'type' in('pto','daily_absence'))
   or exists(select 1 from jsonb_array_elements(basis->'employmentByDate') ed
    cross join lateral jsonb_array_elements(ed->'employees') ee
    join jsonb_array_elements(source->'slots') es on exists(select 1 from jsonb_array_elements(es->'incumbencies') ei
     where ei->'personId'=ee->'employeeId' and (ei->>'effectiveStart')::date<=day and (ei->>'effectiveEnd' is null or day<(ei->>'effectiveEnd')::date))
    join jsonb_array_elements(source#>'{version,slotAvailability}') ea on ea->'slotId'=es->'id' and ea->>'dayOfWeek'=dow::text and ea->>'status'='working'
    where ed->>'serviceDate'=day::text and (ee#>>'{command,fact,state}'='PRE_START' or day<(ee#>>'{command,fact,firstServiceDate}')::date))) then
   availability:=availability||'{"blockedWindows":[]}'::jsonb;
  end if;
  select s into strict slot from jsonb_array_elements(source->'slots') s where s->'id'=base->'slotId';
  select i into strict person from jsonb_array_elements(slot->'incumbencies') i
   where (i->>'effectiveStart')::date<=day and (i->>'effectiveEnd' is null or day<(i->>'effectiveEnd')::date);
  select e into employment_employee from jsonb_array_elements(basis->'employmentByDate') d
   cross join lateral jsonb_array_elements(d->'employees') e
   where d->>'serviceDate'=day::text and e->'employeeId'=person->'personId';
  if base->>'status'='working' and employment_employee is not null and
   (employment_employee#>>'{command,fact,state}'='PRE_START' or day<(employment_employee#>>'{command,fact,firstServiceDate}')::date) then
   availability:=availability||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}],"unavailabilityClassification":"PRE_START_NOT_PTO"}'::jsonb;
  end if;
  expected_availability:=expected_availability||jsonb_build_array(availability||jsonb_build_object(
   'serviceDate',day::text,'incumbentPersonId',person->'personId','incumbentName',person->'displayName'));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into actual from jsonb_array_elements(a->'projectionAvailability') r;
 if actual is distinct from expected then raise exception 'Manual native static hours, eligibility or actual absence changed';end if;

 for day in select generate_series(frame,frame+6,'1 day')::date loop
  dow:=extract(dow from day)::integer;
  select r into strict normal_day from jsonb_array_elements(policy->'days') r where r->>'weekday'=dow::text;
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into absent
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='absent';
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into pre_start
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
  day_changed:=jsonb_array_length(absent)>0;
  select r into day_basis from jsonb_array_elements(a->'datedDayBases') r where r->>'serviceDate'=day::text;
  if day_changed is distinct from (day_basis is not null) then raise exception 'Manual native complete dated day set differs';end if;
  normal_start:=normal_day#>>'{checkedWindow,start}';normal_end:=normal_day#>>'{checkedWindow,end}';
  select max(r#>>'{shift,start}'),max(r#>>'{shift,end}') into complete_start,complete_end
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
  if complete_start is null or complete_start>=complete_end then raise exception 'Manual native staffed window is empty';end if;
  if day_changed then
   if jsonb_array_length(absent) not between 1 and 2 or day_basis->>'kind' is distinct from 'ABSENCE' then
    raise exception using errcode='0A000',message='Third absence requires the retained two-absence basis and actual CoverAll hours';end if;
   input:=day_basis->'input';plan:=day_basis->'plan';
   if input->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(input-'inputDigest')
    or plan->>'planDigest' is distinct from public.static_weekly_digest_jsonb(plan-'planDigest')
    or input->'sourceDigest' is distinct from a->'sourceDigest' or input->'formulaObjectiveDigest' is distinct from a->'formulaObjectiveDigest'
    or input->>'serviceDate' is distinct from day::text or plan->>'serviceDate' is distinct from day::text
    or input->'absentPersonIds' is distinct from absent or plan->'absentPersonIds' is distinct from absent
    or coalesce(input->'preStartPersonIds','[]') is distinct from pre_start
    or (jsonb_array_length(pre_start)>0 and input->>'preStartClassification' is distinct from 'PRE_START_NOT_PTO')
    or input->'checkedWindow' is distinct from jsonb_build_object('start',complete_start,'end',complete_end)
    or plan->'checkedWindow' is distinct from input->'checkedWindow' or plan->'inputDigest' is distinct from input->'inputDigest'
    or plan->'proposalDigest' is distinct from a->'formulaObjectiveDigest' or input->'access' is distinct from policy->'access'
    or input->'groups' is distinct from policy->'groups' or plan->'groups' is distinct from policy->'groups'
    or plan->'hardFeasibilityValidatedBeforeScoring' is distinct from 'true'::jsonb or plan->'globalOptimalityClaim' is distinct from 'false'::jsonb
    or exists(select 1 from unnest(array['publicationEligible','weeklyBaselineChanged','productionWritten','contractorBooked']) k where plan->k is distinct from 'false'::jsonb)
   then raise exception 'Manual native dated immutable input, source or formula changed';end if;
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'incumbentPersonId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'personId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into actual from jsonb_array_elements(input->'roster') r;
   if expected is distinct from actual then raise exception 'Manual native dated roster changed';end if;
   for item in select value from jsonb_array_elements(input->'roster') loop
    select r->'baseGroups' into strict expected from jsonb_array_elements(normal_day->'employees') r where r->>'name'=item->>'name';
    select coalesce(jsonb_agg(to_jsonb(r->>'code') order by ord),'[]') into actual
     from jsonb_array_elements(expected) with ordinality x(name,ord) join jsonb_array_elements(policy->'groups') r on r->'name'=name;
    if item->'baseCodes' is distinct from actual then raise exception 'Manual native distance anchor changed from approved normal day';end if;
   end loop;
  end if;

  for item in select value from jsonb_array_elements(p_envelope->'assignments') where value->>'service_date'=day::text loop
   w:=item->'work_snapshot';parent:=null;link:=null;
   select r into parent from jsonb_array_elements(source#>'{version,assignments}') r
    where r->>'dayOfWeek'=dow::text and r->'workId'=item->'work_id';
   if parent is null then
    select r into strict link from jsonb_array_elements(a->'parentLinks') r where r->'workId'=item->'work_id';
    select r into strict parent from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->'workId'=link->'parentWorkId';
    if link->'serviceDate' is distinct from item->'service_date' or link->'window' is distinct from w->'window' or link->'slotId' is distinct from item->'owner_slot_id'
     or coalesce(item->>'work_id','')!~'^manual-dated:[0-9a-f]{64}$' then raise exception 'Manual native parent lineage differs';end if;
   end if;
   select r into strict availability from jsonb_array_elements(expected_availability) r where r->'slotId'=item->'owner_slot_id' and r->>'serviceDate'=day::text;
   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';
   window_start:=w#>>'{window,start}';window_end:=w#>>'{window,end}';
   perform public.static_weekly_v3_assert_window(w->'window','manual native custody');
   if item->>'status' is distinct from 'assigned' or item->'reason_code' is distinct from 'null'::jsonb
    or item->>'day_of_week' is distinct from dow::text or item->>'plan_work_id' is distinct from dow::text||':'||(item->>'work_id')
    or item->'owner_person_id' is distinct from availability->'incumbentPersonId' or item->'optimized_owner_person_id' is distinct from item->'owner_person_id'
    or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'
    or availability->>'status' is distinct from 'working' or window_start<availability#>>'{shift,start}' or window_end>availability#>>'{shift,end}'
    or item->'baseline_owner_slot_id' is distinct from parent->'originSlotId' or w->'originSlotId' is distinct from parent->'originSlotId'
   then raise exception 'Manual native actual static owner, window or original actor changed';end if;
   select r into strict base from jsonb_array_elements(expected_availability) r where r->'slotId'=parent->'originSlotId' and r->>'serviceDate'=day::text;
   if item->'baseline_owner_person_id' is distinct from base->'incumbentPersonId' or item->'original_actor_person_id' is distinct from base->'incumbentPersonId'
    or item->'baseline_owner_name' is distinct from base->'incumbentName' or item->'original_actor_name' is distinct from base->'incumbentName'
    or item->>'owner_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',item->'plan_work_id','slotId',item->'owner_slot_id','personId',item->'owner_person_id','serviceDate',item->'service_date'))
    or item->>'exact_owner_identity' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',item->'plan_work_id','service_date',item->'service_date','optimized_owner_slot_id',item->'owner_slot_id','optimized_owner_person_id',item->'owner_person_id','baseline_owner_slot_id',parent->'originSlotId','baseline_owner_person_id',base->'incumbentPersonId'))
   then raise exception 'Manual native owner lineage digest changed';end if;
   inherited:=day_changed and exists(select 1 from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,phase_number)
    where phase_number>1 and ph#>>'{window,start}'<=window_start and window_start<ph#>>'{window,end}');
   expected:=jsonb_build_object('workId',item->'work_id','dayOfWeek',dow,'originSlotId',parent->'originSlotId',
    'locationId',parent->'locationId','locationCodeSnapshot',parent->'locationCodeSnapshot','locationNameSnapshot',parent->'locationNameSnapshot',
    'serviceMode',parent->'serviceMode','includedLocations',parent->'includedLocations','window',w->'window',
    'serviceEffortMinutes',w->'serviceEffortMinutes','serviceEffortProvenance',w->'serviceEffortProvenance',
    'priority',parent->'priority','priorityProvenance',parent->'priorityProvenance','required',parent->'required',
    'coveragePolicy',null,'bestEffortCoverage',false,'coveragePolicyOrder',null,'coveragePolicyProvenance',null,
    'requiredQualifications',parent->'requiredQualifications','qualificationProvenance',parent->'qualificationProvenance',
    'restrictions',parent->'restrictions','restrictionProvenance',parent->'restrictionProvenance','restrictedSlotIds',parent->'restrictedSlotIds',
    'manualLock',false,'manualLockSlotId',null,'overlayWork',false);
   if jsonb_array_length(coalesce(parent->'normalAssignmentRestrictedSlotIds','[]'))>0 then
    expected:=expected||jsonb_build_object('normalAssignmentRestrictedSlotIds',parent->'normalAssignmentRestrictedSlotIds','coveragePurpose',parent->'coveragePurpose');
   end if;
   if inherited and dow<>1 and parent->>'locationCodeSnapshot'='HERPETARIUM'
    and parent->'restrictedSlotIds' ? (basis#>>'{ownerConfig,slots,ALIJAH,slotId}') then
    expected:=expected||jsonb_build_object('restrictedSlotIds',(parent->'restrictedSlotIds')-(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'normalAssignmentRestrictedSlotIds',jsonb_build_array(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'coveragePurpose','INHERITED_ALERTS_AND_ISSUES_ONLY','restrictionProvenance',(parent->>'restrictionProvenance')||';normal-assignment-scope:fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
   end if;
   if w is distinct from expected or not ((availability->'qualifications') @> (w->'requiredQualifications'))
    or w->'restrictedSlotIds' ? (item->>'owner_slot_id') or owner_config->'hardForbiddenFamilies' ? (w->>'locationCodeSnapshot')
    or exists(select 1 from jsonb_array_elements(w->'includedLocations') r where availability->'restrictions' ? (r->>'locationId'))
    or (item->>'owner_slot_id'=basis#>>'{ownerConfig,slots,TAMMY,slotId}' and w->>'locationCodeSnapshot' not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA'))
   then raise exception 'Manual native physical members, hard eligibility or scoped restriction changed: work %, fields %',item->>'work_id',
    (select coalesce(jsonb_agg(k order by k),'[]') from (select jsonb_object_keys(w||expected) k) q where w->k is distinct from expected->k);end if;
   if not day_changed and (link is not null or item->'owner_slot_id' is distinct from parent->'ownerSlotId' or w->'window' is distinct from parent->'window'
    or w->'serviceEffortMinutes' is distinct from parent->'serviceEffortMinutes' or w->'serviceEffortProvenance' is distinct from parent->'serviceEffortProvenance')
   then raise exception 'Manual native changed an approved normal day';end if;
   if day_changed and (window_end>parent#>>'{window,end}' or window_start<case
    when parent#>>'{window,start}'<=normal_start and parent#>>'{window,end}'>normal_start
     then least(parent#>>'{window,start}',complete_start) else parent#>>'{window,start}' end)
   then raise exception 'Manual native custody exceeds its exact parent boundary';end if;
   -- A single unchanged owner can continue across the complete-crew arrival.
   -- That harmless merged row must still preserve the whole early base prefix.
   if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'
    or window_start<>parent#>>'{window,start}' or window_end<least(parent#>>'{window,end}',complete_start))
   then raise exception 'Manual native early own-base custody differs';end if;
   if day_changed and window_end>complete_start then
    if window_end>complete_end then raise exception 'Manual native actual full-site window differs';end if;
    for phase in select value from jsonb_array_elements(plan->'phaseOwners') where value#>>'{window,start}'<window_end and window_start<value#>>'{window,end}' loop
     if phase#>>array['owners',w->>'locationCodeSnapshot'] is distinct from item->>'owner_slot_id' then raise exception 'Manual native selected phase differs from stored custody';end if;
    end loop;
   end if;
   select assignment_id into strict assignment from public.weekly_schedule_slot_assignments
    where version_id=version and day_of_week=dow and work_id=parent->>'workId';
   links:=links||jsonb_build_object(item->>'plan_work_id',assignment::text);
  end loop;

  -- Every physical group tiles the complete actual staffed window once.
  for code in select r->>'code' from jsonb_array_elements(policy->'groups') r loop
   previous_end:=complete_start;previous_owner:=null;
   for item in select r from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text
    and r#>>'{work_snapshot,locationCodeSnapshot}'=code and r#>>'{work_snapshot,window,end}'>complete_start
    order by r#>>'{work_snapshot,window,start}' loop
    window_start:=greatest(complete_start,item#>>'{work_snapshot,window,start}');window_end:=least(complete_end,item#>>'{work_snapshot,window,end}');
    if window_end<=window_start then continue;end if;
    if window_start<>previous_end then raise exception 'Manual native full-site gap or overlap';end if;
    if day_changed and previous_owner is not null and previous_owner<>item->>'owner_slot_id' and not exists(
     select 1 from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
    then raise exception 'Manual native owner moved before the static departure';end if;
    previous_end:=window_end;previous_owner:=item->>'owner_slot_id';
   end loop;
   if previous_end<>complete_end then raise exception 'Manual native full-site coverage incomplete';end if;
   select sum((r->>'serviceEffortMinutes')::integer) into budget from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->>'locationCodeSnapshot'=code;
   select sum((r#>>'{work_snapshot,serviceEffortMinutes}')::integer) into actual_effort from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text and r#>>'{work_snapshot,locationCodeSnapshot}'=code;
   if actual_effort is distinct from budget then raise exception 'Manual native combined group workload budget changed';end if;
  end loop;
  if not day_changed and (select count(*) from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text)
   <>(select count(*) from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text)
  then raise exception 'Manual native omitted approved normal rows';end if;
  if day_changed then
   perform public.static_weekly_manual_assert_absence_score(day_basis,normal_day,policy,expected_availability,p_envelope->'assignments',basis->'ownerConfig');
  end if;
 end loop;
 if (select count(*) from jsonb_object_keys(links))<>jsonb_array_length(p_envelope->'assignments')
  or exists(select 1 from jsonb_array_elements(a->'parentLinks') l where not exists(select 1 from jsonb_array_elements(p_envelope->'assignments') r where r->'work_id'=l->'workId' and r->'service_date'=l->'serviceDate'))
 then raise exception 'Manual native foreign row or unused parent link';end if;
 if (ctx->>'afterFact')::boolean and summary is distinct from public.static_weekly_accepted_exception_set(publication,frame)
 then raise exception 'Manual native original fact did not become exact accepted authority';end if;
 return jsonb_build_object('assignment_links',links,'projection_assignments',p_envelope->'assignments','afterFact',ctx->'afterFact');
end $fn$;
revoke all on function public.static_weekly_manual_assert_native_projection(uuid,uuid,jsonb) from public,anon,authenticated,service_role,
 static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
create or replace function public.static_weekly_manual_native_lunch_policy(p_envelope jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare body jsonb;loans jsonb;
begin
 select coalesce(jsonb_agg(l order by (l->>'dayOfWeek')::integer,l->>'normalOwnerSlotId'),'[]') into loans from(
  select l from jsonb_array_elements(p_envelope#>'{authority,compilerInput,version,lunchCoveragePolicy,loans}') l
   where not exists(select 1 from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d where extract(dow from (d->>'serviceDate')::date)::integer=(l->>'dayOfWeek')::integer)
  union all
  select jsonb_build_object('dayOfWeek',extract(dow from (d->>'serviceDate')::date)::integer,'normalOwnerSlotId',l->'recipientSlotId','window',l->'window',
   'areas',(select case when jsonb_typeof(l->'areas')='array' then coalesce(jsonb_agg(jsonb_build_object('locationCode',c,'covererSlotId',l->'covererSlotId') order by c),'[]'::jsonb) end from jsonb_array_elements_text(l->'areas') c))
   from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d cross join lateral jsonb_array_elements(d#>'{plan,lunchPlans}') l
 ) q;
 body:=jsonb_build_object('schema','memphis-zoo.static-weekly-full-hour-lunch-policy.v1','sourceDigest',p_envelope#>'{authority,sourceDigest}','loans',loans);
 return body||jsonb_build_object('policyDigest',public.static_weekly_digest_jsonb(body));
end $fn$;
revoke all on function public.static_weekly_manual_native_lunch_policy(jsonb) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE OR REPLACE FUNCTION public.static_weekly_manual_assert_native_lunch(p_projection_id uuid,p_document jsonb,p_envelope jsonb,p_publication uuid,p_week date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
 projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;
 full_hour_policy jsonb;full_hour boolean;planned_loan jsonb;normal_segment_window jsonb;
 native_source jsonb;native_availability jsonb;native_slot jsonb;native_day jsonb;native_overlay jsonb;
 native_substitute jsonb;native_template jsonb;native_expected jsonb;native_parties jsonb:='[]'::jsonb;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 if p_projection_id is not null then
  select * into strict projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
  if projection.publication_id is distinct from p_publication or projection.week_start is distinct from p_week
   or projection.projection_envelope is distinct from p_envelope then
   raise exception 'Native lunch stored projection context differs from the exact supplied native envelope';end if;
 end if;
 projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>'authority_digest';projection.replay_digest:=p_envelope->>'replay_digest';

 projection_availability:=projection.projection_envelope#>'{authority,projectionAvailability}';
 projection_assignments:=projection.projection_envelope->'assignments';
 select jsonb_agg(r->'work_snapshot'||'{"schedulingMode":"flexible_coverage_ownership"}'::jsonb) into projection_work from jsonb_array_elements(p_envelope->'assignments') r;
 full_hour_policy:=public.static_weekly_manual_native_lunch_policy(p_envelope);full_hour:=true;
 if full_hour then
  perform public.static_weekly_assert_exact_object(full_hour_policy,
   array['schema','sourceDigest','loans','policyDigest'],array['schema','sourceDigest','loans','policyDigest'],'full lunch policy');
  if full_hour_policy->>'schema' is distinct from 'memphis-zoo.static-weekly-full-hour-lunch-policy.v1'
   or jsonb_typeof(full_hour_policy->'sourceDigest') is distinct from 'string'
   or coalesce(full_hour_policy->>'sourceDigest','') !~ '^[0-9a-f]{64}$'
   or full_hour_policy->>'policyDigest' is distinct from public.static_weekly_digest_jsonb(full_hour_policy-'policyDigest')
   or jsonb_typeof(full_hour_policy->'loans') is distinct from 'array'
   or jsonb_array_length(full_hour_policy->'loans')>1792 then raise exception 'invalid full lunch source policy';end if;
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   perform public.static_weekly_assert_exact_object(planned_loan,
    array['dayOfWeek','normalOwnerSlotId','window','areas'],array['dayOfWeek','normalOwnerSlotId','window','areas'],'full lunch source loan');
   perform public.static_weekly_v3_assert_window(planned_loan->'window','full lunch source window');
   if jsonb_typeof(planned_loan->'dayOfWeek') is distinct from 'number'
    or (planned_loan->>'dayOfWeek') !~ '^[0-6]$'
    or jsonb_typeof(planned_loan->'normalOwnerSlotId') is distinct from 'string'
    or length(planned_loan->>'normalOwnerSlotId') not between 1 and 512
    or jsonb_typeof(planned_loan->'areas') is distinct from 'array'
    or jsonb_array_length(planned_loan->'areas')>128 then raise exception 'invalid full lunch source owner or areas';end if;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(value->'dayOfWeek',value->'normalOwnerSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans')) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select jsonb_build_array(value->'day_of_week',value->'normal_owner_slot_id') entry
    from jsonb_array_elements(p_document->'loans')) q;
  if expected is distinct from actual then raise exception 'full lunch source owner set changed';end if;
 end if;

 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,overlayInputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 -- Native typed capacity has no legacy recurring command and may not yet
 -- have a stored projection. Validate its immutable native source instead.
 if exists(select 1 from jsonb_array_elements(projection_availability) a
   where a->>'status'='working' and (a->>'ownerKind'='CONTRACTOR_CAPACITY' or a ? 'capacityId')) then
  native_source:=p_envelope#>'{authority,compilerInput}';
  if jsonb_typeof(native_source) is distinct from 'object'
   or p_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or p_envelope#>>'{authority,sourceDigest}' is distinct from public.static_weekly_digest_jsonb(native_source)
   or native_source#>>'{version,publicationId}' is distinct from p_publication::text
   or p_envelope#>>'{authority,sourcePublicationId}' is distinct from p_publication::text
   or p_envelope#>>'{authority,sourceVersionId}' is distinct from native_source#>>'{version,id}'
   or nullif(native_source#>>'{version,id}','') is null
   or native_source->>'serviceDate' is distinct from p_week::text
   or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(p_envelope->'authority')
   or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
   then raise exception 'Native typed lunch source or envelope identity changed';end if;
  for native_availability in select value from jsonb_array_elements(projection_availability)
   where value->>'status'='working' and (value->>'ownerKind'='CONTRACTOR_CAPACITY' or value ? 'capacityId') loop
   if native_availability->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY'
    or nullif(native_availability->>'slotId','') is null
    or native_availability->>'capacityId' is distinct from native_availability->>'slotId'
    or native_availability->'incumbentPersonId' is distinct from 'null'::jsonb
    or native_availability->'incumbentName' is distinct from 'null'::jsonb
    or (native_availability->>'serviceDate')::date not between p_week and p_week+6
    or native_availability->'dayOfWeek' is distinct from to_jsonb(extract(dow from (native_availability->>'serviceDate')::date)::integer)
    or (select count(*) from jsonb_array_elements(projection_availability) a
      where a->>'slotId'=native_availability->>'slotId' and a->>'serviceDate'=native_availability->>'serviceDate')<>1
    then raise exception 'Native typed lunch requires unique working capacity with explicit null person';end if;
   select value into strict native_slot from jsonb_array_elements(native_source->'slots')
    where value->>'id'=native_availability->>'slotId';
   if native_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY'
    or native_slot->'incumbencies' is distinct from '[]'::jsonb
    or public.static_weekly_capacity_registered(native_slot) is not true
    then raise exception 'Native typed lunch capacity is not the exact registered nonemployee source slot';end if;
   select value into strict native_day from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}')
    where value->>'serviceDate'=native_availability->>'serviceDate' and value->>'kind'='COVERALL';
   native_overlay:=native_day->'overlay';native_substitute:=native_overlay->'substitute';
   if coalesce(native_overlay->>'schema','') not in('custodial.approved-manual-coverall-overlay.v1','custodial.approved-manual-coverall-overlay.v2')
    or native_overlay->>'status' is distinct from 'VALIDATED_UNPUBLISHED_COVERALL_OVERLAY'
    or native_overlay->>'overlayDigest' is distinct from public.static_weekly_digest_jsonb(native_overlay-'overlayDigest')
    or native_overlay->>'sourceDigest' is distinct from p_envelope#>>'{authority,sourceDigest}'
    or native_overlay->>'serviceDate' is distinct from native_availability->>'serviceDate'
    or native_day#>>'{input,sourceDigest}' is distinct from p_envelope#>>'{authority,sourceDigest}'
    or native_day#>>'{input,inputDigest}' is distinct from public.static_weekly_digest_jsonb((native_day->'input')-'inputDigest')
    or native_day#>>'{plan,planDigest}' is distinct from public.static_weekly_digest_jsonb((native_day->'plan')-'planDigest')
    or native_overlay->>'acceptedPlanDigest' is distinct from native_day#>>'{plan,planDigest}'
    or native_substitute->>'kind' is distinct from 'CONTRACTOR_CAPACITY'
    or native_substitute->>'slotId' is distinct from native_availability->>'slotId'
    or native_substitute->'actualHoursConfirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(native_substitute->'confirmationReference') is distinct from 'string'
    or length(native_substitute->>'confirmationReference') not between 1 and 256
    or native_substitute->'shift' is distinct from native_availability->'shift'
    or native_substitute#>>'{lunch,start}' is distinct from native_availability#>>'{lunch,start}'
    or native_substitute#>>'{lunch,end}' is distinct from native_availability#>>'{lunch,end}'
    then raise exception 'Native typed lunch does not bind its exact confirmed CoverAll overlay';end if;
   select value into strict native_template from jsonb_array_elements(native_slot->'contractorAvailability')
    where value->'dayOfWeek'=native_availability->'dayOfWeek';
   native_expected:=(native_template-'breakChoice')||jsonb_build_object(
    'slotId',native_slot->'id','dayOfWeek',native_availability->'dayOfWeek','status','working',
    'shift',native_substitute->'shift',
    'lunch',(native_substitute->'lunch')||jsonb_build_object(
      'startMinute',(extract(epoch from (native_substitute#>>'{lunch,start}')::time)/60)::integer,
      'endMinute',(extract(epoch from (native_substitute#>>'{lunch,end}')::time)/60)::integer),
    'maxDutyMinutes',(extract(epoch from ((native_substitute#>>'{shift,end}')::time-(native_substitute#>>'{shift,start}')::time))/60)::integer-60,
    'maxDutyProvenance',native_template->'productiveCapacityProvenance','blockedWindows','[]'::jsonb,
    'serviceDate',native_availability->'serviceDate','incumbentPersonId','null'::jsonb,
    'incumbentName','null'::jsonb,'ownerKind','CONTRACTOR_CAPACITY','capacityId',native_slot->'id');
   if native_availability is distinct from native_expected then
    raise exception 'Native typed lunch hours, eligibility or raw lunch differ from registered capacity and confirmed overlay';end if;
   native_parties:=native_parties||jsonb_build_array(jsonb_build_object(
    'service_date',native_availability->'serviceDate','day_of_week',native_availability->'dayOfWeek',
    'slot_id',native_slot->'id','capacity_id',native_slot->'id','person_id','null'::jsonb));
  end loop;
 end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection_availability)
 where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY')
  and (value->>'ownerKind'='CONTRACTOR_CAPACITY' and value->>'breakChoice'='NONE' and value->'lunch'='null'::jsonb) is not true;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  if loan ? 'normal_owner_capacity_id' then
   if not(native_parties @> jsonb_build_array(jsonb_build_object(
     'service_date',loan->'service_date','day_of_week',loan->'day_of_week',
     'slot_id',loan->'normal_owner_slot_id','capacity_id',loan->'normal_owner_capacity_id',
     'person_id',loan->'normal_owner_person_id')))
    or loan->'normal_owner_person_id' is distinct from 'null'::jsonb then
    raise exception 'Native typed lunch party does not match its exact validated capacity tuple';end if;
  else
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,loan,'normal_owner');
  end if;
  perform public.static_weekly_assert_exact_object(loan,
   case when loan ? 'normal_owner_capacity_id' then array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_capacity_id','coverage_start','coverage_end','status','helper_slot_ids']
    else array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'] end,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection_availability)
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time-start_time<>interval '1 hour'
   or ((loan->>'status'='PLANNED' and jsonb_array_length(loan->'helper_slot_ids')=1)
    or (loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0)) is not true
   or loan->'fallback' is distinct from 'null'::jsonb then raise exception 'Manual native lunch requires the complete scheduled hour and exact helper count for its area status';end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and (
      (full_hour and jsonb_array_length(loan->'helper_slot_ids') between 1 and 2
        and (loan->'fallback'='null'::jsonb or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))
      or (not full_hour and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
        or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  if full_hour then
   select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
    where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
   if loan->'helper_slot_ids' is distinct from (
     select coalesce(jsonb_agg(coverer order by coverer collate "C"),'[]'::jsonb)
     from (select distinct area->>'covererSlotId' coverer
       from jsonb_array_elements(planned_loan->'areas') area) named)
    then raise exception 'full lunch source coverer set changed';end if;
  end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection_availability)
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY')
    or ((helper#>>'{lunch,start}' is null or helper#>>'{lunch,end}' is null)
      and (helper->>'ownerKind'='CONTRACTOR_CAPACITY' and helper->>'breakChoice'='NONE' and helper->'lunch'='null'::jsonb) is not true) or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  if responsibility ? 'normal_owner_capacity_id' then
   if not(native_parties @> jsonb_build_array(jsonb_build_object(
     'service_date',responsibility->'service_date','day_of_week',responsibility->'day_of_week',
     'slot_id',responsibility->'normal_owner_slot_id','capacity_id',responsibility->'normal_owner_capacity_id',
     'person_id',responsibility->'normal_owner_person_id')))
    or responsibility->'normal_owner_person_id' is distinct from 'null'::jsonb then
    raise exception 'Native typed lunch party does not match its exact validated capacity tuple';end if;
  else
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'normal_owner');
  end if;
  if responsibility ? 'coverer_capacity_id' then
   if not(native_parties @> jsonb_build_array(jsonb_build_object(
     'service_date',responsibility->'service_date','day_of_week',responsibility->'day_of_week',
     'slot_id',responsibility->'coverer_slot_id','capacity_id',responsibility->'coverer_capacity_id',
     'person_id',responsibility->'coverer_person_id')))
    or responsibility->'coverer_person_id' is distinct from 'null'::jsonb then
    raise exception 'Native typed lunch party does not match its exact validated capacity tuple';end if;
  else
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'coverer');
  end if;
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','coverer_slot_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments']
    ||case when responsibility ? 'normal_owner_capacity_id' then array['normal_owner_capacity_id'] else array['normal_owner_person_id'] end
    ||case when responsibility ? 'coverer_capacity_id' then array['coverer_capacity_id'] else array['coverer_person_id'] end,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverer_slot_id','coverer_person_id','coverer_capacity_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection_availability)
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,'lunch segment');
   select value into base_work from jsonb_array_elements(projection_assignments)
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or ((base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id') and not (
      base_work#>>'{work_snapshot,locationCodeSnapshot}'='HERPETARIUM' and base_work->>'day_of_week'<>'1'
      and responsibility->>'coverer_slot_id'=(select v#>>'{slots,ALIJAH,slotId}' from (select c.owner_config v from public.static_weekly_approved_initial_baselines b join public.static_weekly_approved_template_catalog c using(template_id) join public.weekly_schedule_versions ver on ver.authority_source_id=b.source_id join public.weekly_schedule_publications pub using(version_id) where pub.publication_id=p_publication) cfg)))
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   normal_segment_window:=case when full_hour then segment->'normalWindow' else segment->'window' end;
   perform public.static_weekly_v3_assert_window(normal_segment_window,'original borrowed-area anchor');
   if (normal_segment_window->>'start')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (normal_segment_window->>'end')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
   if full_hour then
    if segment->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
     then raise exception 'full lunch area must cover the entire accepted lunch';end if;
    select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
     where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
    if not exists(select 1 from jsonb_array_elements(planned_loan->'areas') area
     where area->>'locationCode'=base_work#>>'{work_snapshot,locationCodeSnapshot}'
      and area->'covererSlotId'=responsibility->'coverer_slot_id') then
     raise exception 'full lunch recipient differs from the immutable area plan';end if;
   end if;
  end loop;
 end loop;
 if full_hour then
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   for segment in select value from jsonb_array_elements(planned_loan->'areas') loop
    perform public.static_weekly_assert_exact_object(segment,array['locationCode','covererSlotId'],array['locationCode','covererSlotId'],'full lunch source area');
    if jsonb_typeof(segment->'locationCode') is distinct from 'string' or length(segment->>'locationCode') not between 1 and 512
     or jsonb_typeof(segment->'covererSlotId') is distinct from 'string' or length(segment->>'covererSlotId') not between 1 and 512
     or segment->'covererSlotId'=planned_loan->'normalOwnerSlotId' then raise exception 'invalid full lunch source area';end if;
   end loop;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(l->'dayOfWeek',l->'normalOwnerSlotId',a->'locationCode',a->'covererSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans') l cross join lateral jsonb_array_elements(l->'areas') a) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select distinct jsonb_build_array(r->'day_of_week',r->'normal_owner_slot_id',a#>'{work_snapshot,locationCodeSnapshot}',r->'coverer_slot_id') entry
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(projection_assignments) a on a->>'plan_work_id'=s->>'planWorkId'
     and a->'service_date'=r->'service_date') q;
  if expected is distinct from actual then raise exception 'full lunch source areas omitted, duplicated or reassigned';end if;
  if exists(with areas as materialized (
    select r->>'service_date' service_date,loc->>'locationId' location_id,
     jsonb_build_array(r->'coverer_slot_id',r->'coverer_person_id',r->'coverer_capacity_id') recipient,
     (s#>>'{window,start}')::time starts,(s#>>'{window,end}')::time ends
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
     cross join lateral jsonb_array_elements(s->'includedLocations') loc)
   select 1 from areas a join areas b on a.service_date=b.service_date and a.location_id=b.location_id
    and a.recipient is distinct from b.recipient and a.starts<b.ends and b.starts<a.ends) then
   raise exception 'full lunch plans conflict on current physical responsibility';end if;
 end if;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection_assignments) a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection_work) w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e
 where exists(select 1 from jsonb_array_elements(projection_availability) a
  where a->>'slotId'=h and a->>'serviceDate'=l->>'service_date' and nullif(a->>'incumbentPersonId','') is not null);
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'loans') a join jsonb_array_elements(p_document->'loans') b
  on a->>'loan_id'<b->>'loan_id' and a->'service_date'=b->'service_date' and a->'helper_slot_ids'=b->'helper_slot_ids'
  and a->>'coverage_start'<b->>'coverage_end' and b->>'coverage_start'<a->>'coverage_end') then raise exception 'Manual native helper appointments overlap';end if;
 perform public.static_weekly_manual_assert_lunch_lineage(p_envelope,p_document,p_publication,p_week);
end $function$;
revoke all on function public.static_weekly_manual_assert_native_lunch(uuid,jsonb,jsonb,uuid,date) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_assert_projection(p_operation uuid, p_manager uuid, p_envelope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;snapshot jsonb;source jsonb;before_source jsonb;
 publication uuid;week date;date date;expected_dates jsonb;part jsonb;proof jsonb;first_projection jsonb;chosen jsonb;
 expected_rows jsonb:='[]';expected_availability jsonb:='[]';expected_work jsonb:='[]';links jsonb:='{}';item jsonb;
 basis jsonb;first_basis jsonb;summary jsonb;effective jsonb;actual jsonb;expected jsonb;
BEGIN
 IF p_envelope#>>'{semantic_snapshot,schema}'='custodial.approved-manual-pending-staffing-snapshot.v1' THEN
  RETURN public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope);END IF;
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'pending projection');
 snapshot:=p_envelope->'semantic_snapshot';
 PERFORM public.static_weekly_assert_exact_object(snapshot,
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],'pending original snapshot');
 IF snapshot->>'schema' IS DISTINCT FROM 'custodial.approved-static-pending-staffing-projection-snapshot.v1'
  OR snapshot->'originalCommand' IS DISTINCT FROM ctx->'originalCommand'
  OR coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Pending original tuple differs';END IF;
 week:=(snapshot->>'weekStart')::date;
 IF NOT isfinite(week) OR extract(isodow FROM week)<>1 OR week>c.end_date OR week+6<c.start_date THEN RAISE EXCEPTION 'Pending original week differs';END IF;
 publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 source:=public.static_weekly_v3_read_publication_source(publication,week);
 before_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(c.expected_revision),false),'{exceptions}',
  public.static_weekly_pending_original_exception_set(publication,week,p_operation),false);
 IF snapshot->'originalSource' IS DISTINCT FROM before_source OR public.static_weekly_effective_version(week+6)::text IS DISTINCT FROM source->>'version_id'
 THEN RAISE EXCEPTION 'Pending original accepted Source differs';END IF;
 SELECT jsonb_agg(d::date::text ORDER BY d) INTO expected_dates
  FROM generate_series(greatest(c.start_date,week),least(c.end_date,week+6),'1 day') d;
 IF snapshot->'scopeDates' IS DISTINCT FROM expected_dates OR jsonb_typeof(snapshot->'partitions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(snapshot->'partitions')<>jsonb_array_length(expected_dates)
 THEN RAISE EXCEPTION 'Pending complete original day partitions required';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') WITH ORDINALITY x(value,n) ORDER BY n LOOP
  PERFORM public.static_weekly_assert_exact_object(part,ARRAY['serviceDate','projection'],ARRAY['serviceDate','projection'],'pending day partition');
  IF jsonb_typeof(part->'serviceDate') IS DISTINCT FROM 'string' OR NOT(expected_dates ? (part->>'serviceDate'))
   OR (SELECT count(*) FROM jsonb_array_elements(snapshot->'partitions') p WHERE p->'serviceDate'=part->'serviceDate')<>1
   OR part#>'{projection,authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(part->'serviceDate')
  THEN RAISE EXCEPTION 'Pending duplicate or foreign day partition';END IF;
  date:=(part->>'serviceDate')::date;
  basis:=public.static_weekly_read_approved_template_basis(p_manager,publication,date,'DATED_ABSENCE',NULL,
   CASE WHEN (ctx->>'afterFact')::boolean THEN c.expected_revision+1 ELSE c.expected_revision END);
  IF first_basis IS NULL THEN first_basis:=basis;END IF;
  IF basis->'generation' IS DISTINCT FROM snapshot->'generation'
   OR basis->'templateCatalogDigest' IS DISTINCT FROM snapshot->'templateCatalogDigest'
   OR basis->'templateInputsDigest' IS DISTINCT FROM snapshot->'templateInputsDigest'
   OR basis->'ownerConfig' IS DISTINCT FROM first_basis->'ownerConfig'
  THEN RAISE EXCEPTION 'Pending approved catalog config or generation differs';END IF;
  summary:=public.static_weekly_pending_applied_summary(p_operation,publication,week,date);
  proof:=public.static_weekly_pending_assert_day(p_operation,part->'projection',publication,week,summary);
  IF first_projection IS NULL THEN first_projection:=part->'projection';END IF;
 END LOOP;
 -- Deterministic disjoint composition: one source for every changed day and
 -- the exact same original six-day rows for every component's unaffected day.
 FOR date IN SELECT generate_series(week,week+6,'1 day')::date LOOP
  SELECT value->'projection' INTO chosen FROM jsonb_array_elements(snapshot->'partitions') WHERE value->>'serviceDate'=date::text;
  IF NOT FOUND THEN
   chosen:=first_projection;
   FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') LOOP
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(part#>'{projection,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Pending unaffected original day changed';END IF;
   END LOOP;
  END IF;
  proof:=public.static_weekly_pending_assert_day(p_operation,chosen,publication,week,
   public.static_weekly_pending_applied_summary(p_operation,publication,week,(chosen#>>'{authority,scopeDates,0}')::date));
  SELECT expected_rows||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_rows FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
  FOR item IN SELECT value FROM jsonb_array_elements(chosen->'assignments') WHERE value->>'service_date'=date::text LOOP
   links:=links||jsonb_build_object(item->>'plan_work_id',proof#>ARRAY['assignment_links',item->>'plan_work_id']);
  END LOOP;
  SELECT expected_availability||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_availability
   FROM jsonb_array_elements(chosen#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n) WHERE r->>'serviceDate'=date::text;
  SELECT expected_work||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_work
   FROM jsonb_array_elements(chosen#>'{authority,overlayCompilerInput,version,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'dayOfWeek'=extract(dow FROM date)::text;
 END LOOP;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'slotId' COLLATE "C") INTO expected_availability FROM jsonb_array_elements(expected_availability) r;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'workId' COLLATE "C") INTO expected_work FROM jsonb_array_elements(expected_work) r;
 effective:=jsonb_set(jsonb_set(first_projection#>'{authority,overlayCompilerInput}','{version,assignments}',expected_work,false),
  '{exceptions}',public.static_weekly_pending_exception_set(p_operation,publication,week,NULL),false);
 expected:=jsonb_build_object('schema','custodial.approved-static-pending-staffing-authority.v1','effectiveDate',week,
  'compilerInput',first_projection#>'{authority,compilerInput}','overlayCompilerInput',effective,
  'inputDigest',public.static_weekly_digest_jsonb(effective),'projectionAvailability',expected_availability,'solverInvoked',false,'optimized',false);
 IF p_envelope->'assignments' IS DISTINCT FROM expected_rows OR p_envelope->'authority' IS DISTINCT FROM expected
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(expected)
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR p_envelope->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-pending-staffing-adapter.v1","version":"approved-static-pending-staffing-v1"}'::jsonb
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-pending-staffing-v1'
  OR p_envelope->>'week_start' IS DISTINCT FROM week::text OR p_envelope->>'service_date' IS DISTINCT FROM week::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (week+6)::text
  OR p_envelope->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PENDING_STAFFING_NOT_OPTIMALITY"}'::jsonb
  OR p_envelope->'applied_exceptions' IS DISTINCT FROM public.static_weekly_pending_applied_summary(p_operation,publication,week,NULL)
 THEN RAISE EXCEPTION 'Pending merged exact week projection or original relation differs';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_envelope->'receipt',
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],'pending fixed feasibility DATA');
 IF p_envelope#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-pending-feasibility.v1'
  OR p_envelope#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_envelope#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_envelope#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric NOT BETWEEN jsonb_array_length(expected_rows) AND 100000
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_envelope#>>'{receipt,hardConstraintCount}')::numeric)
  OR coalesce(p_envelope#>>'{receipt,hardConstraintDigest}','')!~'^[0-9a-f]{64}$'
  OR coalesce(p_envelope->>'replay_digest','')!~'^[0-9a-f]{64}$'
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',p_envelope#>'{receipt,hardConstraintCount}','violations',0)
 THEN RAISE EXCEPTION 'Pending fixed feasibility DATA malformed';END IF;
 IF (ctx->>'afterFact')::boolean AND public.static_weekly_pending_summary(p_operation,publication,week,NULL)
  IS DISTINCT FROM public.static_weekly_accepted_exception_set(publication,week)
 THEN RAISE EXCEPTION 'Pending original semantics did not become the exact accepted facts';END IF;
 IF public.static_weekly_pending_context(p_operation,p_manager) IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Pending native context changed';END IF;
 RETURN jsonb_build_object('assignment_links',links,'projection_assignments',expected_rows,'afterFact',ctx->'afterFact');
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_assert_lunch(p_operation uuid, p_manager uuid, p_publication uuid, p_week date, p_envelope jsonb, p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 PERFORM public.static_weekly_pending_assert_projection(p_operation,p_manager,p_envelope);
 IF p_envelope#>>'{semantic_snapshot,originalSource,publication_id}' IS DISTINCT FROM p_publication::text
  OR p_envelope->>'week_start' IS DISTINCT FROM p_week::text THEN RAISE EXCEPTION 'Pending lunch original publication or week differs';END IF;
 IF p_envelope->>'replay_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-ARRAY['base_authority_digest','base_replay_digest','document_identity']))
 THEN RAISE EXCEPTION 'Pending complete merged lunch replay differs';END IF;
 IF p_envelope#>>'{semantic_snapshot,schema}'='custodial.approved-manual-pending-staffing-snapshot.v1' THEN
  PERFORM public.static_weekly_manual_assert_native_lunch(NULL,p_document,p_envelope,p_publication,p_week);
 ELSE PERFORM public.static_weekly_pending_lunch_derivation(NULL,p_document,p_envelope,p_publication,p_week,p_operation);END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v8_assert_lunch_document(p_projection_id uuid, p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
 projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;
 full_hour_policy jsonb;full_hour boolean;planned_loan jsonb;normal_segment_window jsonb;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection is missing'; end if;
 if projection.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1' then
  perform public.static_weekly_manual_assert_native_lunch(p_projection_id,p_document,projection.projection_envelope,projection.publication_id,projection.week_start);return;end if;

 projection_availability:=projection.projection_envelope#>'{authority,projectionAvailability}';
 projection_assignments:=projection.projection_envelope->'assignments';
 projection_work:=projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}';
 full_hour_policy:=projection.projection_envelope#>'{authority,compilerInput,version,lunchCoveragePolicy}';
 full_hour:=full_hour_policy is not null;
 if projection.projection_envelope#>'{authority,overlayCompilerInput,version,lunchCoveragePolicy}'
   is distinct from full_hour_policy then raise exception 'full lunch policy changed during projection';end if;
 if full_hour then
  perform public.static_weekly_assert_exact_object(full_hour_policy,
   array['schema','sourceDigest','loans','policyDigest'],array['schema','sourceDigest','loans','policyDigest'],'full lunch policy');
  if full_hour_policy->>'schema' is distinct from 'memphis-zoo.static-weekly-full-hour-lunch-policy.v1'
   or jsonb_typeof(full_hour_policy->'sourceDigest') is distinct from 'string'
   or coalesce(full_hour_policy->>'sourceDigest','') !~ '^[0-9a-f]{64}$'
   or full_hour_policy->>'policyDigest' is distinct from public.static_weekly_digest_jsonb(full_hour_policy-'policyDigest')
   or jsonb_typeof(full_hour_policy->'loans') is distinct from 'array'
   or jsonb_array_length(full_hour_policy->'loans')>1792 then raise exception 'invalid full lunch source policy';end if;
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   perform public.static_weekly_assert_exact_object(planned_loan,
    array['dayOfWeek','normalOwnerSlotId','window','areas'],array['dayOfWeek','normalOwnerSlotId','window','areas'],'full lunch source loan');
   perform public.static_weekly_v3_assert_window(planned_loan->'window','full lunch source window');
   if jsonb_typeof(planned_loan->'dayOfWeek') is distinct from 'number'
    or (planned_loan->>'dayOfWeek') !~ '^[0-6]$'
    or jsonb_typeof(planned_loan->'normalOwnerSlotId') is distinct from 'string'
    or length(planned_loan->>'normalOwnerSlotId') not between 1 and 512
    or jsonb_typeof(planned_loan->'areas') is distinct from 'array'
    or jsonb_array_length(planned_loan->'areas')>128 then raise exception 'invalid full lunch source owner or areas';end if;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(value->'dayOfWeek',value->'normalOwnerSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans')) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select jsonb_build_array(value->'day_of_week',value->'normal_owner_slot_id') entry
    from jsonb_array_elements(p_document->'loans')) q;
  if expected is distinct from actual then raise exception 'full lunch source owner set changed';end if;
 end if;

 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,inputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection_availability)
 where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY')
  and (value->>'ownerKind'='CONTRACTOR_CAPACITY' and value->>'breakChoice'='NONE' and value->'lunch'='null'::jsonb) is not true;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,loan,'normal_owner');
  perform public.static_weekly_assert_exact_object(loan,
   case when loan ? 'normal_owner_capacity_id' then array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_capacity_id','coverage_start','coverage_end','status','helper_slot_ids']
    else array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'] end,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection_availability)
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time<=start_time then raise exception 'accepted lunch end must follow its start'; end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and (
      (full_hour and jsonb_array_length(loan->'helper_slot_ids') between 1 and 2
        and (loan->'fallback'='null'::jsonb or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))
      or (not full_hour and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
        or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  if full_hour then
   select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
    where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
   if loan->'helper_slot_ids' is distinct from (
     select coalesce(jsonb_agg(coverer order by coverer collate "C"),'[]'::jsonb)
     from (select distinct area->>'covererSlotId' coverer
       from jsonb_array_elements(planned_loan->'areas') area) named)
    then raise exception 'full lunch source coverer set changed';end if;
  end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection_availability)
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY')
    or ((helper#>>'{lunch,start}' is null or helper#>>'{lunch,end}' is null)
      and (helper->>'ownerKind'='CONTRACTOR_CAPACITY' and helper->>'breakChoice'='NONE' and helper->'lunch'='null'::jsonb) is not true) or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'normal_owner');
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'coverer');
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','coverer_slot_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments']
    ||case when responsibility ? 'normal_owner_capacity_id' then array['normal_owner_capacity_id'] else array['normal_owner_person_id'] end
    ||case when responsibility ? 'coverer_capacity_id' then array['coverer_capacity_id'] else array['coverer_person_id'] end,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverer_slot_id','coverer_person_id','coverer_capacity_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection_availability)
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,'lunch segment');
   select value into base_work from jsonb_array_elements(projection_assignments)
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or (base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id')
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   normal_segment_window:=case when full_hour then segment->'normalWindow' else segment->'window' end;
   perform public.static_weekly_v3_assert_window(normal_segment_window,'original borrowed-area anchor');
   if (normal_segment_window->>'start')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (normal_segment_window->>'end')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
   if full_hour then
    if segment->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
     then raise exception 'full lunch area must cover the entire accepted lunch';end if;
    select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
     where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
    if not exists(select 1 from jsonb_array_elements(planned_loan->'areas') area
     where area->>'locationCode'=base_work#>>'{work_snapshot,locationCodeSnapshot}'
      and area->'covererSlotId'=responsibility->'coverer_slot_id') then
     raise exception 'full lunch recipient differs from the immutable area plan';end if;
   end if;
  end loop;
 end loop;
 if full_hour then
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   for segment in select value from jsonb_array_elements(planned_loan->'areas') loop
    perform public.static_weekly_assert_exact_object(segment,array['locationCode','covererSlotId'],array['locationCode','covererSlotId'],'full lunch source area');
    if jsonb_typeof(segment->'locationCode') is distinct from 'string' or length(segment->>'locationCode') not between 1 and 512
     or jsonb_typeof(segment->'covererSlotId') is distinct from 'string' or length(segment->>'covererSlotId') not between 1 and 512
     or segment->'covererSlotId'=planned_loan->'normalOwnerSlotId' then raise exception 'invalid full lunch source area';end if;
   end loop;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(l->'dayOfWeek',l->'normalOwnerSlotId',a->'locationCode',a->'covererSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans') l cross join lateral jsonb_array_elements(l->'areas') a) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select distinct jsonb_build_array(r->'day_of_week',r->'normal_owner_slot_id',a#>'{work_snapshot,locationCodeSnapshot}',r->'coverer_slot_id') entry
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(projection_assignments) a on a->>'plan_work_id'=s->>'planWorkId'
     and a->'service_date'=r->'service_date') q;
  if expected is distinct from actual then raise exception 'full lunch source areas omitted, duplicated or reassigned';end if;
  if exists(with areas as materialized (
    select r->>'service_date' service_date,loc->>'locationId' location_id,
     jsonb_build_array(r->'coverer_slot_id',r->'coverer_person_id',r->'coverer_capacity_id') recipient,
     (s#>>'{window,start}')::time starts,(s#>>'{window,end}')::time ends
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
     cross join lateral jsonb_array_elements(s->'includedLocations') loc)
   select 1 from areas a join areas b on a.service_date=b.service_date and a.location_id=b.location_id
    and a.recipient is distinct from b.recipient and a.starts<b.ends and b.starts<a.ends) then
   raise exception 'full lunch plans conflict on current physical responsibility';end if;
 end if;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection_assignments) a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection_work) w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e
 where exists(select 1 from jsonb_array_elements(projection_availability) a
  where a->>'slotId'=h and a->>'serviceDate'=l->>'service_date' and nullif(a->>'incumbentPersonId','') is not null);
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid, p_publication uuid, p_week date, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;result jsonb;d date;slot uuid;version uuid;row jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 ctx:=public.static_weekly_pending_context(p_operation,c.prepared_by_manager_id);
 IF p_week IS NULL OR public.static_weekly_projection_window_start(p_week) IS DISTINCT FROM p_week OR p_week>c.end_date OR p_week+6<c.start_date
  OR p_day IS NOT NULL AND (p_day NOT BETWEEN greatest(p_week,c.start_date) AND least(p_week+6,c.end_date))
 THEN RAISE EXCEPTION 'Pending scope differs';END IF;
 SELECT version_id INTO STRICT version FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 IF public.static_weekly_effective_version(p_week)<>version OR public.static_weekly_effective_version(p_week+6)<>version
 THEN RAISE EXCEPTION 'Pending publication changed within week';END IF;
 result:=public.static_weekly_pending_original_exception_set(p_publication,p_week,p_operation);
 IF c.command_kind='cancel_absence' THEN
  SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO result FROM jsonb_array_elements(result) WITH ORDINALITY x(e,n)
   WHERE (e->>'staffingAbsenceId'=c.target_absence_id::text AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date
    AND (p_day IS NULL OR (e->>'serviceDate')::date=p_day)) IS NOT TRUE;
 ELSE
  FOR d IN SELECT generate_series(greatest(p_week,c.start_date),least(p_week+6,c.end_date),'1 day')::date LOOP
   IF p_day IS NOT NULL AND d<>p_day THEN CONTINUE;END IF;
   SELECT i.slot_id INTO STRICT slot FROM public.v_weekly_roster_slot_incumbency_ranges i WHERE i.person_id=c.employee_id
    AND i.effective_start<=d AND (i.effective_end IS NULL OR d<i.effective_end);
   row:=jsonb_build_object('id',c.operation_id::text||':'||d::text,'type',CASE WHEN c.absence_kind='pto' THEN 'pto' ELSE 'daily_absence' END,
    'serviceDate',d,'staffingAbsenceId',c.operation_id,'staffingAbsenceKind',c.absence_kind,'actorId',c.prepared_by_manager_id,
    'reason','Approved staffing unavailability','idempotencyKey','staffing:'||c.operation_id::text||':'||d::text,
    'expectedRevision',c.expected_revision,'payload',jsonb_build_object('slotId',slot),'baseVersionId',version,'publicationId',p_publication,
    'sequence',c.expected_revision+1+(d-c.start_date));
   -- No accepted/status flag is exported or trusted on this proposed fact.
   result:=result||jsonb_build_array(row);
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') INTO result FROM jsonb_array_elements(result) e;
 RETURN result;
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v10_stage_staffing_command(p_operation_id uuid, p_candidates jsonb, p_preview_digest text, p_input_digest text, p_publication_vector jsonb, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pending record;v_pending_lunch jsonb; actor jsonb;command public.static_weekly_staffing_commands%rowtype;
 v_candidate_set_digest text;v_candidate_rows integer;v_candidate_bytes bigint;v_week_count integer;
 v_projection_weeks integer;v_lunch_weeks integer;v_summary jsonb;v_receipt jsonb;v_current_revision bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may stage this command';end if;
 if p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or p_input_digest is null or p_input_digest!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_publication_vector) is distinct from 'object'
  or jsonb_typeof(p_candidates) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid staffing candidate envelope';end if;
 v_candidate_set_digest:=public.static_weekly_digest_jsonb(p_candidates);
 if command.state='PREPARED' then
  if command.candidate_set_digest is distinct from v_candidate_set_digest
   or command.preview_digest is distinct from p_preview_digest
   or command.input_digest is distinct from p_input_digest
   or command.publication_vector is distinct from p_publication_vector then
   raise exception using errcode='23505',message='prepared staffing operation was replayed with different candidates';end if;
  return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
   'candidate_set_digest',command.candidate_set_digest,'candidate_row_count',command.candidate_row_count,
   'candidate_bytes',command.candidate_bytes,'candidate_summary',command.candidate_summary,'replayed',true);
 end if;
 if command.state<>'PREPARING' then raise exception using errcode='55000',message='staffing command cannot be staged from its current state';end if;
 select control.current_revision into v_current_revision from public.static_weekly_schedule_control control where control.singleton for share;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing command expected revision became stale during preparation';end if;
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='staffing cancellation cannot rewrite an elapsed service date during preparation';end if;
 if command.command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text where a.absence_id=command.target_absence_id
   and a.employee_id=command.employee_id and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date
   and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
 ) then raise exception using errcode='23514',message='staffing cancellation remaining window changed during preparation';end if;
 if jsonb_array_length(p_candidates)>100000 then raise exception using errcode='54000',message='staffing candidate row limit exceeded';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item where jsonb_typeof(item)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(item) key)
      is distinct from array['candidateKey','candidateKind','payload','serviceDate']::text[]
   or jsonb_typeof(item->'candidateKind') is distinct from 'string'
   or item->>'candidateKind' not in ('projection','lunch','schedule_refresh')
   or jsonb_typeof(item->'candidateKey') is distinct from 'string'
   or length(btrim(item->>'candidateKey')) not between 1 and 300
   or item->>'candidateKey' is distinct from btrim(item->>'candidateKey')
   or jsonb_typeof(item->'serviceDate') is distinct from 'string'
   or item->>'serviceDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(item->'payload') is distinct from 'object'
   or case when item->>'candidateKind' in ('projection','lunch')
      then not exists(select 1 from generate_series(command.start_date,command.end_date,'1 day') d where public.static_weekly_projection_window_start(d::date)=(item->>'serviceDate')::date)
      else (item->>'serviceDate')::date not between command.start_date and command.end_date end) then
  raise exception using errcode='22023',message='invalid staffing candidate row';end if;
 if p_candidates is distinct from (select coalesce(jsonb_agg(item order by (item->>'serviceDate') collate "C",
   (item->>'candidateKind') collate "C",(item->>'candidateKey') collate "C"),'[]'::jsonb) from jsonb_array_elements(p_candidates) item) then
  raise exception using errcode='22023',message='staffing candidates are not in deterministic order';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item
  group by item->>'candidateKind',item->>'candidateKey' having count(*)<>1) then
  raise exception using errcode='23505',message='duplicate staffing candidate identity';end if;
 select count(distinct public.static_weekly_projection_window_start(d::date)) into v_week_count from generate_series(command.start_date,command.end_date,'1 day') d;
 select count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='projection'),
  count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='lunch') into v_projection_weeks,v_lunch_weeks from jsonb_array_elements(p_candidates) item;
 if v_projection_weeks is distinct from v_week_count or v_lunch_weeks is distinct from v_week_count
  or exists(select 1 from (select distinct public.static_weekly_projection_window_start(d::date) frame from generate_series(command.start_date,command.end_date,'1 day') d) frames
   where (select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='projection' and (item->>'serviceDate')::date=frame)<>1
    or (select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='lunch' and (item->>'serviceDate')::date=frame)<>1)
 then raise exception using errcode='23514',message='staffing exact source-aligned period companions are incomplete';end if;
 select count(*),coalesce(sum(octet_length(item::text)),0) into v_candidate_rows,v_candidate_bytes
  from jsonb_array_elements(p_candidates) item;
 if v_candidate_bytes>16777216 then raise exception using errcode='54000',message='staffing candidate byte limit exceeded';end if;
 v_summary:=jsonb_build_object('weeks',v_week_count,
  'projections',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='projection'),
  'lunches',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='lunch'),
  'scheduleRefreshes',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='schedule_refresh'));

 -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE
 FOR v_pending IN SELECT item->'payload' payload,item->>'serviceDate' AS service_date_text FROM jsonb_array_elements(p_candidates) item
  WHERE item->>'candidateKind'='projection' AND item#>>'{payload,envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') LOOP
  IF v_pending.payload->>'serviceDate' IS DISTINCT FROM v_pending.service_date_text
   OR p_publication_vector->'expectedRevision' IS DISTINCT FROM to_jsonb(command.expected_revision)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication_vector->'weeks') w
    WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(w) k)=ARRAY['authorityRevision','publicationId','versionId','weekStart']::text[]
     AND w->>'weekStart'=v_pending.service_date_text AND w->'authorityRevision'=to_jsonb(command.expected_revision)
     AND w->'publicationId'=v_pending.payload->'publicationId'
     AND w->'versionId'=v_pending.payload#>'{envelope,semantic_snapshot,originalSource,version_id}')
  THEN RAISE EXCEPTION 'Pending original publication vector differs';END IF;
  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);
  SELECT item->'payload' INTO STRICT v_pending_lunch FROM jsonb_array_elements(p_candidates) item
   WHERE item->>'candidateKind'='lunch' AND item->>'serviceDate'=v_pending.service_date_text;
  PERFORM public.static_weekly_pending_assert_lunch(p_operation_id,p_manager_id,(v_pending.payload->>'publicationId')::uuid,
   v_pending.service_date_text::date,v_pending.payload->'envelope',v_pending_lunch);
 END LOOP;
 -- END PRIVATE ORIGINAL-PENDING APPROVED STAGE
 insert into public.static_weekly_staffing_staged_candidates(operation_id,candidate_kind,candidate_key,service_date,
  payload_json,payload_digest,canonical_bytes)
 select command.operation_id,item->>'candidateKind',item->>'candidateKey',(item->>'serviceDate')::date,item->'payload',
  public.static_weekly_digest_jsonb(item->'payload'),octet_length(item::text)
 from jsonb_array_elements(p_candidates) item;
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='PREPARED',preview_digest=p_preview_digest,
  input_digest=p_input_digest,candidate_set_digest=v_candidate_set_digest,candidate_row_count=v_candidate_rows,
  candidate_bytes=v_candidate_bytes,publication_vector=p_publication_vector,candidate_summary=v_summary,
  prepared_at=statement_timestamp() where operation_id=command.operation_id;
 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','PREPARED','manager_id',p_manager_id,
  'semantic_digest',command.semantic_digest,'candidate_set_digest',v_candidate_set_digest,
  'candidate_row_count',v_candidate_rows,'candidate_bytes',v_candidate_bytes,'recorded_at',statement_timestamp());
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'PREPARED',p_manager_id,
  command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
 return jsonb_build_object('operation_id',command.operation_id,'state','PREPARED',
  'candidate_set_digest',v_candidate_set_digest,'candidate_row_count',v_candidate_rows,
  'candidate_bytes',v_candidate_bytes,'candidate_summary',v_summary,'replayed',false);
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v11_accept_staffing_command(p_operation_id uuid, p_preview_digest text, p_confirmation_key uuid, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pending_check jsonb; actor jsonb;command public.static_weekly_staffing_commands%rowtype;target_absence public.static_weekly_staffing_absences%rowtype;
 v_candidates jsonb;v_count integer;v_bytes bigint;v_current_revision bigint;v_revision bigint;
 v_content_digest text;v_projection_candidate record;v_lunch jsonb;v_payload jsonb;v_projection_response jsonb;
 v_projection uuid;v_existing public.weekly_schedule_compiled_projections%rowtype;v_existing_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_signed_envelope jsonb;v_request jsonb;v_request_digest text;v_projection_content_digest text;v_projection_receipt jsonb;
 v_projection_map jsonb:='{}'::jsonb;v_refresh record;v_mapping jsonb;v_intent_count integer:=0;
 v_missing_device jsonb:='[]'::jsonb;v_prior_refresh jsonb:='[]'::jsonb;v_receipt jsonb;v_receipt_digest text;v_reused boolean;v_command_id uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.state='ACCEPTED' then
  if command.prepared_by_manager_id is distinct from p_manager_id
   or command.confirmation_key is distinct from p_confirmation_key
   or command.preview_digest is distinct from p_preview_digest then
   raise exception using errcode='23505',message='accepted staffing command was replayed with different confirmation identity';end if;
  return command.accepted_receipt||jsonb_build_object('replayed',true);
 end if;
 if command.state<>'PREPARED' then raise exception using errcode='55000',message='staffing command is not prepared for acceptance';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may confirm this command';end if;
 if p_confirmation_key is null or p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or command.preview_digest is distinct from p_preview_digest then
  raise exception using errcode='22023',message='exact staffing preview and confirmation key are required';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  perform set_config('app.static_weekly_staffing_write','on',true);
  update public.static_weekly_staffing_commands set state='REJECTED' where operation_id=command.operation_id;
  v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','REJECTED',
   'reason','ELAPSED_CANCELLATION','manager_id',p_manager_id,'semantic_digest',command.semantic_digest,
   'preview_digest',command.preview_digest,'recorded_at',statement_timestamp());
  insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
   semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'REJECTED',p_manager_id,
   command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
  return jsonb_build_object('operation_id',command.operation_id,'state','REJECTED',
   'reason','ELAPSED_CANCELLATION','replayed',false);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('candidateKey',candidate_key,'candidateKind',candidate_kind,
  'payload',payload_json,'serviceDate',service_date::text)
  order by service_date,candidate_kind collate "C",candidate_key collate "C"),'[]'::jsonb),
  count(*),coalesce(sum(canonical_bytes),0) into v_candidates,v_count,v_bytes
 from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id;
 if public.static_weekly_digest_jsonb(v_candidates) is distinct from command.candidate_set_digest
  or v_count is distinct from command.candidate_row_count or v_bytes is distinct from command.candidate_bytes
  or v_count>100000 or v_bytes>16777216 then
  raise exception using errcode='23514',message='prepared staffing candidate set no longer matches its complete digest';end if;
 select current_revision into v_current_revision from public.static_weekly_schedule_control where singleton for update;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing confirmation expected revision is stale';end if;
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' then
  select * into target_absence from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
   where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
    and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date and command.end_date=a.end_date
    and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
   for share;
  if not found then raise exception using errcode='23514',message='staffing cancellation must target the exact uncancelled remaining absence window';end if;
 end if;
 if jsonb_typeof(command.publication_vector) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(command.publication_vector) key)
    is distinct from array['expectedRevision','weeks']::text[]
  or (command.publication_vector->>'expectedRevision')::bigint<>command.expected_revision
  or jsonb_typeof(command.publication_vector->'weeks') is distinct from 'array' then
  raise exception using errcode='23514',message='prepared staffing publication vector is invalid';end if;
 if exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
  where jsonb_typeof(week)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(week) key)
      is distinct from array['authorityRevision','publicationId','versionId','weekStart']::text[]
   or (week->>'authorityRevision')::bigint<>command.expected_revision
   or not exists(select 1 from public.weekly_schedule_publications p
    where p.publication_id=(week->>'publicationId')::uuid and p.version_id=(week->>'versionId')::uuid
     and public.static_weekly_effective_version((week->>'weekStart')::date)=p.version_id)) then
  raise exception using errcode='23514',message='prepared staffing publication vector became stale';end if;
 if (select count(*) from jsonb_array_elements(command.publication_vector->'weeks'))<>
    (select count(*) from public.static_weekly_staffing_staged_candidates
      where operation_id=command.operation_id and candidate_kind='projection') then
  raise exception using errcode='23514',message='prepared staffing projection vector is incomplete';end if;

 v_prior_refresh:=public.static_weekly_v11_read_current_refresh_targets(
  command.start_date,command.end_date,p_manager_id);

 v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation_id',command.operation_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'input_digest',command.input_digest,'candidate_set_digest',command.candidate_set_digest,
  'publication_vector',command.publication_vector));
 v_revision:=public.static_weekly_advance_authority(command.expected_revision,'apply_staffing_command',
  p_manager_id,actor->>'manager_name',command.operation_id,v_content_digest);
 if command.command_kind='absence' then
  insert into public.static_weekly_staffing_absences(absence_id,employee_id,absence_kind,start_date,end_date,
   accepted_operation_id,accepted_revision,accepted_by_manager_id)
  values(command.operation_id,command.employee_id,command.absence_kind,command.start_date,command.end_date,
   command.operation_id,v_revision,p_manager_id);
 else
  insert into public.static_weekly_staffing_absence_cancellations(absence_id,accepted_operation_id,
   remaining_start_date,remaining_end_date,accepted_revision,accepted_by_manager_id)
  values(command.target_absence_id,command.operation_id,command.start_date,command.end_date,v_revision,p_manager_id);
 end if;
 perform set_config('app.static_weekly_staffing_batch_operation',command.operation_id::text,true);

 for v_projection_candidate in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='projection' order by service_date,candidate_key loop
  v_payload:=v_projection_candidate.payload_json;
  if (select array_agg(key order by key) from jsonb_object_keys(v_payload) key) is distinct from
   array['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision',
    'idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate']::text[]
   or (v_payload->>'serviceDate')::date is distinct from v_projection_candidate.service_date
   or (v_payload->>'expectedRevision')::bigint is distinct from command.expected_revision
   or v_payload->>'actorManagerId' is distinct from p_manager_id::text
   or v_payload->>'idempotencyKey' is distinct from 'staffing:'||command.operation_id::text||':'||v_projection_candidate.service_date::text
   or not exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
    where week->>'weekStart'=v_projection_candidate.service_date::text
     and week->>'publicationId'=v_payload->>'publicationId'
     and week->>'versionId'=v_payload#>>'{envelope,authority,compilerInput,version,id}') then
   raise exception using errcode='23514',message='staged staffing projection identity is invalid';end if;
  if v_payload->>'exceptionSetDigest' is distinct from public.static_weekly_digest_jsonb(
    public.static_weekly_accepted_exception_set((v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
   or v_payload->>'compilerVersion' is distinct from v_payload#>>'{envelope,compiler_version}'
   or v_payload->'objective' is distinct from v_payload#>'{envelope,objective}'
   or v_payload->'metrics' is distinct from v_payload#>'{envelope,metrics}'
   or v_payload->>'replayDigest' is distinct from v_payload#>>'{envelope,replay_digest}' then
   raise exception using errcode='23514',message='staged staffing projection compiler identity no longer matches accepted exception authority',
    detail=jsonb_build_object('staged_exception_digest',v_payload->>'exceptionSetDigest',
     'database_exception_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date)),
     'staged_exceptions',v_payload#>'{envelope,applied_exceptions}',
     'database_exceptions',public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))::text;end if;

  -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  IF v_payload#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   v_pending_check:=public.static_weekly_pending_assert_payload(command.operation_id,p_manager_id,v_payload);
   IF (v_pending_check->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending original fact not accepted in this transaction';END IF;
   v_projection_response:=public.static_weekly_pending_projection_sink((v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',v_payload->>'compilerVersion',v_payload->'objective',
    v_payload->'metrics',v_payload->>'replayDigest',v_payload->'envelope',command.expected_revision,p_manager_id,
    actor->>'manager_name',v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  ELSE
  v_signed_envelope:=jsonb_set(v_payload->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(v_payload->'envelope')),true);
  select * into v_existing from public.weekly_schedule_compiled_projections p
   where p.publication_id=(v_payload->>'publicationId')::uuid
    and p.week_start=v_projection_candidate.service_date
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
     (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
    and p.compiler_version=v_payload->>'compilerVersion'
    and p.authority_digest=v_signed_envelope->>'authority_digest'
   order by p.compiled_at desc,p.projection_id desc limit 1;
  v_reused:=found;
  if v_reused then
   if (v_existing.projection_envelope-array['attestation','receipt','database_projection_identity']) is distinct from
      (v_signed_envelope-array['attestation','receipt','database_projection_identity']) then
    raise exception using errcode='23514',message='historical projection identity conflicts with the exact staged candidate';end if;
   v_projection:=v_existing.projection_id;
   v_command_id:=gen_random_uuid();
   v_request:=jsonb_build_object('operation','materialize_projection','publication_id',(v_payload->>'publicationId')::uuid,
    'service_date',v_projection_candidate.service_date,'exception_set_digest',v_existing.exception_set_digest,
    'compiler_version',v_existing.compiler_version,'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,
    'replay_digest',v_existing.replay_digest,'projection_envelope',v_existing.projection_envelope,
    'expected_revision',command.expected_revision,'actor_manager_id',p_manager_id,'actor_manager_name',actor->>'manager_name');
   v_request_digest:=public.static_weekly_digest_jsonb(v_request);
   v_projection_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
    'exception_set_digest',v_existing.exception_set_digest,'compiler_version',v_existing.compiler_version,
    'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,'replay_digest',v_existing.replay_digest,
    'projection_envelope_identity',v_existing.projection_envelope->>'database_projection_identity',
    'attestation',v_existing.projection_envelope->'attestation'));
   v_projection_receipt:=public.static_weekly_response_json('materialize_projection',v_revision,
    v_projection_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,
     'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
     'week_end',v_existing.week_end,'replay_digest',v_existing.replay_digest));
   insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,
    command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
   values(v_command_id,p_manager_id,actor->>'manager_name','materialize_projection',v_payload->>'idempotencyKey',
    command.expected_revision,v_request_digest,v_request,v_projection_receipt,v_projection_receipt->>'output_digest',v_projection_content_digest);
  else
   v_projection_response:=public.static_weekly_v3_materialize_projection(
    (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',
    v_payload->>'compilerVersion',v_payload->'objective',v_payload->'metrics',v_payload->>'replayDigest',
    v_payload->'envelope',command.expected_revision,p_manager_id,v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  end if;

  END IF;
  -- END PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  select payload_json into strict v_lunch from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='lunch'
    and service_date=v_projection_candidate.service_date;

  IF v_payload#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   PERFORM public.static_weekly_pending_assert_lunch(command.operation_id,p_manager_id,(v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->'envelope',v_lunch);
   IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections WHERE projection_id=v_projection
    AND projection_envelope=v_payload->'envelope' AND compiled_by_manager_id=p_manager_id) THEN RAISE EXCEPTION 'Pending exact persisted original projection differs';END IF;
  END IF;
  perform public.static_weekly_v8_materialize_lunch_document(v_projection,v_lunch,p_manager_id);
  select * into strict v_existing_lunch from public.weekly_schedule_lunch_documents where projection_id=v_projection;
  v_projection_map:=v_projection_map||jsonb_build_object(v_projection_candidate.service_date::text,
   jsonb_build_object('projection_id',v_projection,'publication_id',(v_payload->>'publicationId')::uuid,
    'projection_identity',v_payload#>>'{envelope,database_projection_identity}',
    'lunch_document_identity',v_existing_lunch.document_identity,'reused',v_reused));
 end loop;

 if exists(
 with projection as (select service_date week_start,payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='projection'),
  lunch as (select payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='lunch'),
  expected as (
   select distinct assignment->>'service_date' service_date,assignment->>'owner_person_id' employee_id
   from projection cross join lateral jsonb_array_elements(payload_json#>'{envelope,assignments}') assignment
   where lower(assignment->>'status')='assigned' and assignment->>'owner_person_id' is not null
    and assignment->>'service_date' between command.start_date::text and command.end_date::text
   union select responsibility->>'service_date',responsibility->>'normal_owner_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'normal_owner_person_id' is not null
   union select responsibility->>'service_date',responsibility->>'coverer_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'coverer_person_id' is not null
   union select item->>'serviceDate',item->>'employeeId' from jsonb_array_elements(v_prior_refresh) item
   union select (day::date)::text,command.employee_id::text from generate_series(command.start_date,command.end_date,interval '1 day') day
    where command.command_kind='absence'
  ),actual as (select service_date::text,payload_json->>'employeeId' employee_id
   from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id and candidate_kind='schedule_refresh')
  (select * from expected except select * from actual) union all (select * from actual except select * from expected)
 ) then raise exception using errcode='23514',message='affected employee schedule refresh set is incomplete or excessive';end if;

 for v_refresh in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='schedule_refresh' order by service_date,candidate_key loop
  v_mapping:=v_projection_map->(v_refresh.payload_json->>'weekStart');
  if (select array_agg(key order by key) from jsonb_object_keys(v_refresh.payload_json) key) is distinct from
   array['employeeId','lunchDocumentIdentity','projectionIdentity','publicationId','weekStart']::text[]
   or v_mapping is null or v_refresh.payload_json->>'publicationId' is distinct from v_mapping->>'publication_id'
   or v_refresh.payload_json->>'projectionIdentity' is distinct from v_mapping->>'projection_identity'
   or v_refresh.payload_json->>'lunchDocumentIdentity' is distinct from v_mapping->>'lunch_document_identity'
   or v_refresh.service_date not between command.start_date and command.end_date then
   raise exception using errcode='23514',message='schedule refresh is not bound to the exact accepted projection and lunch';end if;
  insert into public.static_weekly_schedule_application_intents(operation_id,service_date,employee_id,
   device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity)
  select command.operation_id,v_refresh.service_date,(v_refresh.payload_json->>'employeeId')::uuid,
   d.id,c.credential_id,d.assignment_epoch,v_revision,(v_mapping->>'publication_id')::uuid,
   (v_mapping->>'projection_id')::uuid,v_mapping->>'lunch_document_identity'
  from public.devices d join public.device_auth_credentials c on c.device_id=d.id
   and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp()
  where d.active=true and d.assigned_employee_id=(v_refresh.payload_json->>'employeeId')::uuid;
  get diagnostics v_count=row_count;v_intent_count:=v_intent_count+v_count;
  if v_count=0 then v_missing_device:=v_missing_device||jsonb_build_array(jsonb_build_object(
   'service_date',v_refresh.service_date,'employee_id',v_refresh.payload_json->>'employeeId','status','NO_CURRENT_DEVICE'));end if;
 end loop;

 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','ACCEPTED',
  'manager_id',p_manager_id,'original_preparer_manager_id',command.prepared_by_manager_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'candidate_set_digest',command.candidate_set_digest,'authority_revision',v_revision,
  'projections',v_projection_map,'device_intent_count',v_intent_count,
  'missing_device_targets',v_missing_device,'recorded_at',statement_timestamp());
 v_receipt_digest:=public.static_weekly_digest_jsonb(v_receipt);
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='ACCEPTED',confirmation_key=p_confirmation_key,
  confirmed_by_manager_id=p_manager_id,authority_command_id=command.operation_id,accepted_revision=v_revision,
  accepted_receipt=v_receipt,accepted_at=statement_timestamp() where operation_id=command.operation_id;
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'ACCEPTED',p_manager_id,
  command.semantic_digest,v_receipt,v_receipt_digest);
 return v_receipt||jsonb_build_object('replayed',false);
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v11_staged_projection_digest_matches(p_operation_id uuid, p_content_digest text, p_manager_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare candidate record;signed_envelope jsonb;expected_digest text;matches integer:=0;
begin
 for candidate in select payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=p_operation_id and candidate_kind='projection' loop
  if candidate.payload_json->>'actorManagerId' is distinct from p_manager_id::text then continue;end if;

  -- BEGIN PRIVATE ORIGINAL-PENDING BATCH DIGEST
  IF candidate.payload_json#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,candidate.payload_json);
   expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',(candidate.payload_json->>'publicationId')::uuid,'week_start',(candidate.payload_json->>'serviceDate')::date,
    'exception_set_digest',candidate.payload_json->>'exceptionSetDigest','compiler_version',candidate.payload_json->>'compilerVersion',
    'objective',candidate.payload_json->'objective','metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
    'projection_envelope_identity',candidate.payload_json#>>'{envelope,database_projection_identity}','attestation',NULL));
   IF expected_digest=p_content_digest THEN matches:=matches+1;END IF;
   CONTINUE;
  END IF;
  -- END PRIVATE ORIGINAL-PENDING BATCH DIGEST
  signed_envelope:=jsonb_set(candidate.payload_json->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(candidate.payload_json->'envelope')),true);
  expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
   'publication_id',(candidate.payload_json->>'publicationId')::uuid,
   'week_start',(candidate.payload_json->>'serviceDate')::date,
   'exception_set_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
    (candidate.payload_json->>'publicationId')::uuid,(candidate.payload_json->>'serviceDate')::date)),
   'compiler_version',candidate.payload_json->>'compilerVersion','objective',candidate.payload_json->'objective',
   'metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
   'projection_envelope_identity',signed_envelope->>'database_projection_identity',
   'attestation',signed_envelope->'attestation'));
  if expected_digest=p_content_digest then matches:=matches+1;end if;
 end loop;
 return matches=1;
exception when others then return false;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v10_read_staffing_command(p_operation_id uuid, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare command public.static_weekly_staffing_commands%rowtype;
 original_target jsonb:=null;target_revision bigint;
 preview_weeks jsonb:='[]'::jsonb; prepared_week jsonb; projection record;
 envelope jsonb; availability jsonb; safe_availability jsonb; a jsonb;
 safe_row jsonb; field text; value jsonb; windows jsonb; w jsonb;
 safe_objective jsonb; safe_metrics jsonb; daily jsonb; day_row jsonb;
 loads jsonb; load_row jsonb; safe_load jsonb; safe_day jsonb; weekly jsonb;
 map_value jsonb; pair record; raw_metrics jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null; end if;
 -- Cancellation refers to an immutable original absence, not today's incumbent.
 -- Only the authenticated current pending command may expose this private target.
 if command.command_kind='cancel_absence' and command.state in ('PREPARING','PREPARED') then
  if command.prepared_by_manager_id is distinct from p_manager_id then
   raise exception using errcode='42501',message='only original authenticated preparer may read cancellation target';end if;
  select control.current_revision into strict target_revision from public.static_weekly_schedule_control control where control.singleton;
  if command.expected_revision is distinct from target_revision then
   raise exception using errcode='40001',message='original cancellation target revision is stale';end if;
  if command.semantic_digest is distinct from public.static_weekly_digest_jsonb(command.semantic_body)
   or command.semantic_body is distinct from jsonb_build_object('absenceKind',null,'commandKind','cancel_absence',
    'employeeId',command.employee_id::text,'endDate',command.end_date::text,'startDate',command.start_date::text,
    'targetAbsenceId',command.target_absence_id::text) then
   raise exception using errcode='23514',message='original cancellation command identity is inconsistent';end if;
  select jsonb_build_object('absenceId',a.absence_id::text,'employeeId',a.employee_id::text,
   'startDate',a.start_date::text,'endDate',a.end_date::text,'acceptedOperationId',a.accepted_operation_id::text,
   'status','accepted') into original_target
  from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
  where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
   and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp()))
   and command.start_date<=a.end_date and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id);
  if not found then raise exception using errcode='23514',message='original accepted cancellation target is unavailable or inconsistent';end if;
 end if;
 -- Only this command's immutable PREPARED candidates may supply these facts.
 -- PREPARING/terminal states retain the original null preview behavior.
 if command.state='PREPARED' then
  if (select count(*) from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='projection')>54 then
   raise exception using errcode='54000',message='prepared preview week bound exceeded';end if;
  for projection in
   select p.*,l.payload_json as lunch_payload
   from public.static_weekly_staffing_staged_candidates p
   left join public.static_weekly_staffing_staged_candidates l
    on l.operation_id=p.operation_id and l.candidate_kind='lunch' and l.service_date=p.service_date
   where p.operation_id=command.operation_id and p.candidate_kind='projection'
   order by p.service_date
  loop
   if projection.payload_digest is distinct from public.static_weekly_digest_jsonb(projection.payload_json) then
    raise exception using errcode='23514',message='prepared preview staged projection digest changed';end if;
   envelope:=projection.payload_json->'envelope';
   availability:=envelope#>'{authority,projectionAvailability}';
   safe_availability:=null;
   if jsonb_typeof(availability)='array' then
    if jsonb_array_length(availability)>1792 then
     raise exception using errcode='54000',message='prepared preview availability bound exceeded';end if;
    safe_availability:='[]'::jsonb;
    for a in select item from jsonb_array_elements(availability) item loop
     if jsonb_typeof(a) is distinct from 'object' then
      raise exception using errcode='23514',message='prepared preview availability row is not an object';end if;
     safe_row:='{}'::jsonb;
     foreach field in array array['serviceDate','slotId','status','incumbentSlotId','incumbentSlotLabel',
      'incumbentPersonId','incumbentName','ownerKind','capacityId','acceptedRouteAnchorLocationId',
      'acceptedRouteStartLocationId','routeAnchorLocationId'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='string'
       and length(a->>field)<=300 then value else null end);
     end loop;
     foreach field in array array['dayOfWeek','productiveCapacityMinutes','maxServiceEffortMinutes',
      'maxLoadPoints','maxDutyMinutes'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
     end loop;
     foreach field in array array['shift','lunch'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='object'
       then jsonb_build_object('start',case when jsonb_typeof(value->'start')='string' and length(value->>'start')<=5 then value->'start' else null end,
        'end',case when jsonb_typeof(value->'end')='string' and length(value->>'end')<=5 then value->'end' else null end) else null end);
     end loop;
     foreach field in array array['blockedWindows','productiveWindows'] loop
      value:=a->field;windows:=null;
      if jsonb_typeof(value)='array' then
       if jsonb_array_length(value)>256 then raise exception using errcode='54000',message='prepared preview window bound exceeded';end if;
       windows:='[]'::jsonb;
       for w in select item from jsonb_array_elements(value) item loop
        if jsonb_typeof(w) is distinct from 'object' then raise exception using errcode='23514',message='prepared preview window is not an object';end if;
        windows:=windows||jsonb_build_array(jsonb_build_object(
         'start',case when jsonb_typeof(w->'start')='string' and length(w->>'start')<=5 then w->'start' else null end,
         'end',case when jsonb_typeof(w->'end')='string' and length(w->>'end')<=5 then w->'end' else null end));
       end loop;
      end if;
      safe_row:=safe_row||jsonb_build_object(field,windows);
     end loop;
     -- Hash arbitrary provenance instead of leaking leave/restriction notes.
     foreach field in array array['productiveCapacityProvenance','capacityProvenance','acceptedRouteProvenance'] loop
      safe_row:=safe_row||jsonb_build_object(field||'Digest',case when a ? field and a->field<>'null'::jsonb
       then public.static_weekly_digest_jsonb(a->field) else null end);
     end loop;
     safe_row:=safe_row||jsonb_build_object('acceptedRoute',case when jsonb_typeof(a->'acceptedRoute')='object'
      then jsonb_build_object('startLocationId',case when jsonb_typeof(a#>'{acceptedRoute,startLocationId}')='string'
       and length(a#>>'{acceptedRoute,startLocationId}')<=300 then a#>'{acceptedRoute,startLocationId}' else null end) else null end);
     safe_row:=safe_row||jsonb_build_object('acceptedRouteDigest',case when jsonb_typeof(a->'acceptedRoute')='object'
      then public.static_weekly_digest_jsonb(a->'acceptedRoute') else null end);
     safe_availability:=safe_availability||jsonb_build_array(safe_row);
    end loop;
   end if;
   -- Safe fields only: never return optimizer certificates, witnesses, raw
   -- compiler slots/exceptions/proximity matrices or preflight source data.
   safe_objective:=null;
   if jsonb_typeof(envelope->'objective')='object' then
    safe_objective:='{}'::jsonb;
    foreach field in array array['mode','policyVersion','integerServiceEffort','serviceEffortWireSemantics',
     'directedTravelDuty','flexibleCoverageTravelRole','acceptedRouteInsertions','weeklyEquityResource',
     'equityIntegerScale','exactEquityCommonDenominator'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value) in ('number','boolean') or (jsonb_typeof(value)='string'
      and length(envelope->'objective'->>field)<=2000) then safe_objective:=safe_objective||jsonb_build_object(field,value);end if;
    end loop;
    foreach field in array array['tiers','rankingOrder'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value)='array' then
      if jsonb_array_length(value)>4096 or exists(select 1 from jsonb_array_elements(value) x
       where jsonb_typeof(x)<>'string' or length(x#>>'{}')>300) then
       raise exception using errcode='54000',message='prepared preview objective text bound exceeded';end if;
      safe_objective:=safe_objective||jsonb_build_object(field,value);
     end if;
    end loop;
   end if;
   raw_metrics:=envelope->'metrics';safe_metrics:=null;
   if jsonb_typeof(raw_metrics)='object' then
    safe_metrics:='{}'::jsonb;map_value:='{}'::jsonb;
    foreach field in array array['workload','service','travel','waiting','protected','totalDuty'] loop
     value:=raw_metrics->'dutySemantics'->field;
     if jsonb_typeof(value)='string' and length(raw_metrics->'dutySemantics'->>field)<=2000 then
      map_value:=map_value||jsonb_build_object(field,value);end if;
    end loop;
    safe_metrics:=safe_metrics||jsonb_build_object('dutySemantics',case when jsonb_typeof(raw_metrics->'dutySemantics')='object' then map_value else null end);
    daily:=null;
    if jsonb_typeof(raw_metrics->'daily')='array' then
     if jsonb_array_length(raw_metrics->'daily')>7 then raise exception using errcode='54000',message='prepared preview metric day bound exceeded';end if;
     daily:='[]'::jsonb;
     for day_row in select item from jsonb_array_elements(raw_metrics->'daily') item loop
      safe_day:='{}'::jsonb;
      foreach field in array array['dayOfWeek','normalizedInequity','exactNormalizedInequity'] loop
       value:=day_row->field;
       safe_day:=safe_day||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
      end loop;
      loads:=null;
      if jsonb_typeof(day_row->'loads')='array' then
       if jsonb_array_length(day_row->'loads')>256 then raise exception using errcode='54000',message='prepared preview metric slot bound exceeded';end if;
       loads:='[]'::jsonb;
       for load_row in select item from jsonb_array_elements(day_row->'loads') item loop
        safe_load:=jsonb_build_object('slotId',case when jsonb_typeof(load_row->'slotId')='string'
         and length(load_row->>'slotId')<=300 then load_row->'slotId' else null end);
        foreach field in array array['effort','capacity','utilization','normalizedLoad','serviceDutyMinutes',
         'serviceEffortMinutes','normalizedServiceLoad','maxServiceEffortMinutes',
         'fixedServiceEffortMinutes','flexibleWorkloadPoints','fixedRouteTravelMinutes','flexibleCoverageTravelMinutes',
         'travelDutyMinutes','waitingMinutes','fixedWindowWaitingMinutes','transitWaitingMinutes',
         'protectedBreakUnavailableMinutes','routeSpanMinutes','routeNodeCount','fixedRouteDutyMinutes',
         'totalDutyMinutes','dutyCapacityMinutes','productiveCapacityMinutes','acceptedRouteTravelMinutes'] loop
         value:=load_row->field;
         if jsonb_typeof(value)='number' then safe_load:=safe_load||jsonb_build_object(field,value);end if;
        end loop;
        loads:=loads||jsonb_build_array(safe_load);
       end loop;
      end if;
      daily:=daily||jsonb_build_array(safe_day||jsonb_build_object('loads',loads));
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('daily',daily);
    weekly:=null;
    if jsonb_typeof(raw_metrics->'weekly')='object' then
     weekly:='{}'::jsonb;
     foreach field in array array['normalizedInequity','incrementalDirectedRouteCost','disruption'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='number' then weekly:=weekly||jsonb_build_object(field,value);end if;
     end loop;
     value:=raw_metrics#>'{weekly,resource}';
     if jsonb_typeof(value)='string' and length(raw_metrics#>>'{weekly,resource}')<=2000 then weekly:=weekly||jsonb_build_object('resource',value);end if;
     foreach field in array array['normalizedLoads','provenancedWorkloadUnits','productiveCapacityMinutes','uncoveredByPriority'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='object' then
       if (select count(*) from jsonb_object_keys(value))>256 then raise exception using errcode='54000',message='prepared preview weekly metric bound exceeded';end if;
       map_value:='{}'::jsonb;
       for pair in select * from jsonb_each(value) loop
        if length(pair.key)<=300 and jsonb_typeof(pair.value)='number' then map_value:=map_value||jsonb_build_object(pair.key,pair.value);end if;
       end loop;
       weekly:=weekly||jsonb_build_object(field,map_value);
      end if;
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('weekly',weekly);
   end if;
   prepared_week:=jsonb_build_object(
    'week_start',projection.service_date::text,
    'assignments',coalesce(projection.payload_json#>'{envelope,assignments}','[]'::jsonb),
    'lunch_responsibilities',coalesce(projection.lunch_payload->'responsibilities','[]'::jsonb),
    'lunch_loans',coalesce(projection.lunch_payload->'loans','[]'::jsonb),
    'publicationId',case when jsonb_typeof(projection.payload_json->'publicationId')='string'
     and length(projection.payload_json->>'publicationId')<=300 then projection.payload_json->'publicationId' else null end,
    'versionId',case when jsonb_typeof(envelope#>'{authority,compilerInput,version,id}')='string'
     and length(envelope#>>'{authority,compilerInput,version,id}')<=300 then envelope#>'{authority,compilerInput,version,id}' else null end,
    'database_projection_identity',case when jsonb_typeof(envelope->'database_projection_identity')='string'
     and envelope->>'database_projection_identity'~'^[a-f0-9]{64}$' then envelope->'database_projection_identity' else null end,
    'replayDigest',case when jsonb_typeof(envelope->'replay_digest')='string'
     and envelope->>'replay_digest'~'^[a-f0-9]{64}$' then envelope->'replay_digest' else null end,
    'compilerVersion',case when jsonb_typeof(envelope->'compiler_version')='string'
     and length(envelope->>'compiler_version')<=300 then envelope->'compiler_version' else null end,
    'objective',safe_objective,'metrics',safe_metrics,'projectionAvailability',safe_availability,
    'projectionAvailabilityDigest',case when jsonb_typeof(availability)='array' then public.static_weekly_digest_jsonb(availability) else null end,
    'projectionAvailabilityBasis','envelope.authority.projectionAvailability',
    'sourceDigest',case when envelope->>'compiler_version'='approved-manual-period-v1'
      and envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1'
      and envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
     then case when jsonb_typeof(envelope#>'{authority,sourceDigest}')='string'
      and envelope#>>'{authority,sourceDigest}'~'^[a-f0-9]{64}$'
      and envelope#>>'{authority,sourceDigest}'=public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput}')
      then envelope#>'{authority,sourceDigest}' else null end
     else case when jsonb_typeof(envelope#>'{authority,inputDigest}')='string'
      and envelope#>>'{authority,inputDigest}'~'^[a-f0-9]{64}$' then envelope#>'{authority,inputDigest}' else null end end,
    'sourceDigestBasis',case when envelope->>'compiler_version'='approved-manual-period-v1'
      and envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1'
      and envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
     then 'envelope.authority.sourceDigest' else 'envelope.authority.inputDigest' end,
    'geographyDigest',case when jsonb_typeof(envelope#>'{authority,compilerInput,proximity}')='array'
     then public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput,proximity}') else null end,
    'geographyDigestBasis','envelope.authority.compilerInput.proximity');
   if octet_length(prepared_week::text)>4194304 then raise exception using errcode='54000',message='prepared preview week byte bound exceeded';end if;
   preview_weeks:=preview_weeks||jsonb_build_array(prepared_week);
   if octet_length(preview_weeks::text)>16777216 then raise exception using errcode='54000',message='prepared preview total byte bound exceeded';end if;
  end loop;
 end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
  'original_cancellation_target',original_target,
  'semantic_body',command.semantic_body,'semantic_digest',command.semantic_digest,
  'expected_revision',command.expected_revision,'prepared_by_manager_id',command.prepared_by_manager_id,
  'preview_digest',command.preview_digest,'candidate_set_digest',command.candidate_set_digest,
  'input_digest',command.input_digest,'publication_vector',command.publication_vector,
  'candidate_row_count',command.candidate_row_count,'candidate_bytes',command.candidate_bytes,
  'candidate_summary',command.candidate_summary,'accepted_revision',command.accepted_revision,
  'accepted_receipt',command.accepted_receipt,'created_at',command.created_at,'prepared_at',command.prepared_at,
  'accepted_at',command.accepted_at,'current_service_date',public.sch_service_date(statement_timestamp())::text,
  'preview',case when command.state='PREPARED' then jsonb_build_object(
   'schema','memphis-zoo.staffing-command-preview.v1',
   'weeks',preview_weeks)
   else null end);
end $function$;

-- Native manual capacity owner profile; legacy profile remains exact.
CREATE OR REPLACE FUNCTION public.static_weekly_capacity_assert_projection_owner(p_envelope jsonb, p_publication uuid, p_row jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare availability jsonb;optimizer jsonb;capacity jsonb;
 native_source jsonb;native_slot jsonb;native_day jsonb;native_overlay jsonb;
 native_substitute jsonb;native_template jsonb;native_expected jsonb;
begin
 if p_row->>'owner_kind' is null and p_row->>'capacity_id' is null then return;end if;
 if p_row->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or p_row->>'status' is distinct from 'assigned'
  or p_row->>'capacity_id' is distinct from p_row->>'owner_slot_id'
  or p_row->'owner_person_id' is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='typed contractor projection cannot invent employee identity or mismatched capacity';
 end if;
 -- Native manual projections carry fixed-witness DATA, not a legacy
 -- recurring cover_all acceptance or independently selected optimizer result.
 if p_envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1' then
  if p_envelope->'adapter' is distinct from jsonb_build_object(
    'schema','custodial.approved-manual-period-database-adapter.v1','version','approved-manual-period-v1')
   or p_envelope->>'compiler_version' is distinct from 'approved-manual-period-v1'
   or p_envelope#>>'{receipt,schema}' is distinct from 'custodial.approved-manual-native-feasibility-data.v1'
   or coalesce(p_envelope#>>'{receipt,nativePreparationDigest}','') !~ '^[0-9a-f]{64}$'
   or coalesce(p_envelope#>>'{authority,hardConstraintDigest}','') !~ '^[0-9a-f]{64}$'
   or coalesce(p_envelope#>>'{authority,fixedWitnessDigest}','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_envelope#>'{authority,hardConstraintCount}') is distinct from 'number'
   or (p_envelope#>>'{authority,hardConstraintCount}')::bigint<=0
   or p_envelope#>'{receipt,hardConstraintCount}' is distinct from p_envelope#>'{authority,hardConstraintCount}'
   or p_envelope#>'{receipt,hardConstraintDigest}' is distinct from p_envelope#>'{authority,hardConstraintDigest}'
   or p_envelope#>'{receipt,fixedWitnessDigest}' is distinct from p_envelope#>'{authority,fixedWitnessDigest}'
   or jsonb_typeof(p_envelope#>'{receipt,selectionSolverInvoked}') is distinct from 'boolean'
   or p_envelope#>'{metrics,hardConstraints}' is distinct from p_envelope#>'{authority,hardConstraintCount}'
   or p_envelope#>'{metrics,violations}' is distinct from '0'::jsonb
   or p_envelope->>'service_date' is distinct from p_envelope->>'week_start'
   or (p_envelope->>'week_end')::date is distinct from (p_envelope->>'week_start')::date+6
   or jsonb_typeof(p_envelope->'assignments') is distinct from 'array'
   then raise exception using errcode='23514',message='Native capacity owner requires the exact manual adapter and fixed-witness receipt';end if;
  if (select count(*) from jsonb_array_elements(p_envelope->'assignments') r where r=p_row)<>1
   or (select count(*) from jsonb_array_elements(p_envelope->'assignments') r
     where r->>'plan_work_id'=p_row->>'plan_work_id' and r->>'service_date'=p_row->>'service_date')<>1 then
   raise exception using errcode='23514',message='Native capacity owner row is not one exact member of the native envelope';end if;
  native_source:=p_envelope#>'{authority,compilerInput}';
  if jsonb_typeof(native_source) is distinct from 'object'
   or p_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or p_envelope#>>'{authority,sourceDigest}' is distinct from public.static_weekly_digest_jsonb(native_source)
   or native_source#>>'{version,publicationId}' is distinct from p_publication::text
   or p_envelope#>>'{authority,sourcePublicationId}' is distinct from p_publication::text
   or p_envelope#>>'{authority,sourceVersionId}' is distinct from native_source#>>'{version,id}'
   or nullif(native_source#>>'{version,id}','') is null
   or native_source->>'serviceDate' is distinct from (p_envelope->>'week_start')::date::text
   or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(p_envelope->'authority')
   or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
   then raise exception 'Native capacity owner source or envelope identity changed';end if;
  select value into strict availability from jsonb_array_elements(p_envelope#>'{authority,projectionAvailability}')
   where value->>'slotId'=p_row->>'owner_slot_id' and value->>'serviceDate'=p_row->>'service_date';
  if availability->'dayOfWeek' is distinct from p_row->'day_of_week'
   or p_row#>'{work_snapshot,dayOfWeek}' is distinct from p_row->'day_of_week' then
   raise exception using errcode='23514',message='Native capacity owner date or work weekday changed';end if;
   if availability->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY'
    or nullif(availability->>'slotId','') is null
    or availability->>'capacityId' is distinct from availability->>'slotId'
    or availability->'incumbentPersonId' is distinct from 'null'::jsonb
    or availability->'incumbentName' is distinct from 'null'::jsonb
    or (availability->>'serviceDate')::date not between (p_envelope->>'week_start')::date and (p_envelope->>'week_start')::date+6
    or availability->'dayOfWeek' is distinct from to_jsonb(extract(dow from (availability->>'serviceDate')::date)::integer)
    or (select count(*) from jsonb_array_elements(p_envelope#>'{authority,projectionAvailability}') a
      where a->>'slotId'=availability->>'slotId' and a->>'serviceDate'=availability->>'serviceDate')<>1
    then raise exception 'Native capacity owner requires unique working capacity with explicit null person';end if;
   select value into strict native_slot from jsonb_array_elements(native_source->'slots')
    where value->>'id'=availability->>'slotId';
   if native_slot->>'kind' is distinct from 'CONTRACTOR_CAPACITY'
    or native_slot->'incumbencies' is distinct from '[]'::jsonb
    or public.static_weekly_capacity_registered(native_slot) is not true
    then raise exception 'Native capacity owner capacity is not the exact registered nonemployee source slot';end if;
   select value into strict native_day from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}')
    where value->>'serviceDate'=availability->>'serviceDate' and value->>'kind'='COVERALL';
   native_overlay:=native_day->'overlay';native_substitute:=native_overlay->'substitute';
   if coalesce(native_overlay->>'schema','') not in('custodial.approved-manual-coverall-overlay.v1','custodial.approved-manual-coverall-overlay.v2')
    or native_overlay->>'status' is distinct from 'VALIDATED_UNPUBLISHED_COVERALL_OVERLAY'
    or native_overlay->>'overlayDigest' is distinct from public.static_weekly_digest_jsonb(native_overlay-'overlayDigest')
    or native_overlay->>'sourceDigest' is distinct from p_envelope#>>'{authority,sourceDigest}'
    or native_overlay->>'serviceDate' is distinct from availability->>'serviceDate'
    or native_day#>>'{input,sourceDigest}' is distinct from p_envelope#>>'{authority,sourceDigest}'
    or native_day#>>'{input,inputDigest}' is distinct from public.static_weekly_digest_jsonb((native_day->'input')-'inputDigest')
    or native_day#>>'{plan,planDigest}' is distinct from public.static_weekly_digest_jsonb((native_day->'plan')-'planDigest')
    or native_overlay->>'acceptedPlanDigest' is distinct from native_day#>>'{plan,planDigest}'
    or native_substitute->>'kind' is distinct from 'CONTRACTOR_CAPACITY'
    or native_substitute->>'slotId' is distinct from availability->>'slotId'
    or native_substitute->'actualHoursConfirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(native_substitute->'confirmationReference') is distinct from 'string'
    or length(native_substitute->>'confirmationReference') not between 1 and 256
    or native_substitute->'shift' is distinct from availability->'shift'
    or native_substitute#>>'{lunch,start}' is distinct from availability#>>'{lunch,start}'
    or native_substitute#>>'{lunch,end}' is distinct from availability#>>'{lunch,end}'
    then raise exception 'Native capacity owner does not bind its exact confirmed CoverAll overlay';end if;
   select value into strict native_template from jsonb_array_elements(native_slot->'contractorAvailability')
    where value->'dayOfWeek'=availability->'dayOfWeek';
   native_expected:=(native_template-'breakChoice')||jsonb_build_object(
    'slotId',native_slot->'id','dayOfWeek',availability->'dayOfWeek','status','working',
    'shift',native_substitute->'shift',
    'lunch',(native_substitute->'lunch')||jsonb_build_object(
      'startMinute',(extract(epoch from (native_substitute#>>'{lunch,start}')::time)/60)::integer,
      'endMinute',(extract(epoch from (native_substitute#>>'{lunch,end}')::time)/60)::integer),
    'maxDutyMinutes',(extract(epoch from ((native_substitute#>>'{shift,end}')::time-(native_substitute#>>'{shift,start}')::time))/60)::integer-60,
    'maxDutyProvenance',native_template->'productiveCapacityProvenance','blockedWindows','[]'::jsonb,
    'serviceDate',availability->'serviceDate','incumbentPersonId','null'::jsonb,
    'incumbentName','null'::jsonb,'ownerKind','CONTRACTOR_CAPACITY','capacityId',native_slot->'id');
   if availability is distinct from native_expected then
    raise exception 'Native capacity owner hours, eligibility or raw lunch differ from registered capacity and confirmed overlay';end if;
  return;
 end if;
 perform public.static_weekly_capacity_accepted_slot(p_publication,(p_row->>'service_date')::date,(p_row->>'owner_slot_id')::uuid);
 select value into strict optimizer from jsonb_array_elements(p_envelope#>'{authority,optimizerResult,assignments}')
  where value->>'planWorkId'=p_row->>'plan_work_id';
 if optimizer->>'ownerKind' is distinct from p_row->>'owner_kind' or optimizer->>'capacityId' is distinct from p_row->>'capacity_id'
  or optimizer->'personId' is distinct from 'null'::jsonb or optimizer->'displayName' is distinct from 'null'::jsonb then
  raise exception using errcode='23514',message='capacity projection must bind exact independently verified optimizer category';
 end if;
 select value into strict availability from jsonb_array_elements(p_envelope#>'{authority,projectionAvailability}')
  where value->>'slotId'=p_row->>'owner_slot_id' and value->>'serviceDate'=p_row->>'service_date';
 select payload_json->'availability' into capacity from public.weekly_schedule_exception_commands e
  where e.publication_id=p_publication and e.service_date=(p_row->>'service_date')::date and e.exception_type='cover_all'
   and e.payload_json#>>'{availability,slotId}'=p_row->>'owner_slot_id'
   and not exists(select 1 from public.weekly_schedule_exception_commands r where r.reverses_exception_id=e.exception_id)
  order by authority_revision desc limit 1;
 if availability->>'status' is distinct from 'working' or availability->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY'
  or availability->>'capacityId' is distinct from p_row->>'capacity_id' or availability->'incumbentPersonId' is distinct from 'null'::jsonb
  or availability->'shift' is distinct from capacity->'shift'
  or availability->'qualifications' is distinct from capacity->'qualifications'
  or availability->'restrictions' is distinct from capacity->'restrictions' then
  raise exception using errcode='23514',message='contractor owner requires exact accepted current dated shift/eligibility facts';
 end if;
end $function$;


-- COMPONENT coverall SHA256 81cda4dc0dd0a2237975b8968050090f516df7bf0085afe73912e18d97b2c8ca
-- WORKER1 PROPOSAL ONLY. Main is the sole actual installer/canonical writer.
-- Pair with the exact generated native-function counterparts in this release.
-- No Source301/future-Monday bridge function is weakened or edited in place.

SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
CREATE SCHEMA custodial_coverall;
REVOKE ALL ON SCHEMA custodial_coverall FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TABLE custodial_coverall.choices(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 choice_id uuid UNIQUE NOT NULL,manager_id uuid NOT NULL,semantic_digest text NOT NULL,expected_revision bigint NOT NULL,
 credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 choice_json jsonb NOT NULL,choice_digest text NOT NULL CHECK(choice_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE custodial_coverall.request_actors(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),manager_id uuid NOT NULL,
 credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL);
CREATE TABLE custodial_coverall.staged_bindings(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 choice_operation_id uuid NOT NULL REFERENCES custodial_coverall.choices(operation_id),choice_digest text NOT NULL,
 candidate_set_digest text NOT NULL,preview_digest text NOT NULL);
CREATE TABLE custodial_coverall.accepted_days(
 operation_id uuid NOT NULL REFERENCES custodial_coverall.choices(operation_id),service_date date NOT NULL,
 source_id uuid NOT NULL REFERENCES public.static_weekly_authority_source_documents(source_id),publication_id uuid NOT NULL,
 capacity_id uuid NOT NULL REFERENCES public.weekly_roster_slots(slot_id),accepted_revision bigint NOT NULL,manager_id uuid NOT NULL,
 day_json jsonb NOT NULL,PRIMARY KEY(operation_id,service_date));
CREATE TABLE custodial_coverall.cancellations(
 operation_id uuid NOT NULL REFERENCES public.static_weekly_staffing_commands(operation_id),
 original_operation_id uuid NOT NULL,service_date date NOT NULL,accepted_revision bigint NOT NULL,manager_id uuid NOT NULL,
 PRIMARY KEY(operation_id,original_operation_id,service_date),
 FOREIGN KEY(original_operation_id,service_date) REFERENCES custodial_coverall.accepted_days(operation_id,service_date));
DO $private_tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['choices','request_actors','staged_bindings','accepted_days','cancellations'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $private_tables$;

CREATE FUNCTION public.static_weekly_coverall_bind_actor(p_operation uuid,p_manager uuid,p_credential uuid,p_device text,p_access text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;prior custodial_coverall.request_actors%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 IF c.state<>'PREPARING' OR c.prepared_by_manager_id<>p_manager THEN RAISE EXCEPTION 'Original PREPARING actor required';END IF;
 SELECT * INTO prior FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.manager_id<>p_manager OR prior.credential_id<>p_credential OR prior.device_id<>p_device OR prior.session_access<>p_access THEN RAISE EXCEPTION 'Original supplementary actor binding changed';END IF;
 ELSE INSERT INTO custodial_coverall.request_actors VALUES(p_operation,p_manager,p_credential,p_device,p_access);END IF;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_validate_choice_day(p_operation uuid,p_manager uuid,p_day jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior record;source jsonb;slot jsonb;day_basis jsonb;service date;original_exceptions jsonb;
BEGIN
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);service:=(p_day->>'serviceDate')::date;
 IF ctx#>>'{originalCommand,semanticBody,commandKind}'<>'absence'
  OR service<(ctx#>>'{originalCommand,semanticBody,startDate}')::date OR service>(ctx#>>'{originalCommand,semanticBody,endDate}')::date
  OR p_day->'actualHoursConfirmed' IS DISTINCT FROM 'true'::jsonb
  OR nullif(btrim(p_day->>'confirmationReference'),'') IS NULL OR length(p_day->>'confirmationReference')>256
 THEN RAISE EXCEPTION 'Original third-absence actual-hours confirmation required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_day,
  ARRAY['serviceDate','sourceId','publicationId','capacityId','shift','lunch','lunchCovererSlotId','confirmationReference','actualHoursConfirmed','retainedProjectionId','retainedEnvelopeIdentity','retainedPlanDigest','overlayDigest'],
  ARRAY['serviceDate','sourceId','publicationId','capacityId','shift','lunch','lunchCovererSlotId','confirmationReference','actualHoursConfirmed','retainedProjectionId','retainedEnvelopeIdentity','retainedPlanDigest','overlayDigest'],'CoverAll day');
 PERFORM public.static_weekly_v3_assert_window(p_day->'shift','actual CoverAll hours');PERFORM public.static_weekly_v3_assert_window(p_day->'lunch','actual CoverAll lunch');
 IF (p_day#>>'{lunch,end}')::time-(p_day#>>'{lunch,start}')::time<>interval '1 hour'
  OR p_day#>>'{lunch,start}'<p_day#>>'{shift,start}' OR p_day#>>'{lunch,end}'>p_day#>>'{shift,end}'
 THEN RAISE EXCEPTION 'Actual full-hour CoverAll lunch must fit the actual shift';END IF;
 SELECT s.canonical_source INTO STRICT source FROM public.static_weekly_authority_source_documents s
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=s.source_id JOIN public.weekly_schedule_publications p USING(version_id)
 WHERE p.publication_id=(p_day->>'publicationId')::uuid AND s.source_id=(p_day->>'sourceId')::uuid
  AND public.static_weekly_effective_version(service)=v.version_id AND s.active AND s.retired_at IS NULL;
 SELECT x INTO STRICT slot FROM jsonb_array_elements(source->'slots') x WHERE x->>'id'=p_day->>'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(slot);
 IF NOT public.static_weekly_capacity_registered(slot) THEN RAISE EXCEPTION 'Capacity is not registered to this immutable source';END IF;
 SELECT p.projection_id,p.publication_id,p.week_start,p.projection_envelope INTO STRICT prior
 FROM public.weekly_schedule_compiled_projections p WHERE p.projection_id=(p_day->>'retainedProjectionId')::uuid
  AND p.publication_id=(p_day->>'publicationId')::uuid AND service BETWEEN p.week_start AND p.week_end
  AND p.projection_envelope->>'database_projection_identity'=p_day->>'retainedEnvelopeIdentity';
 source:=jsonb_set(source,'{serviceDate}',to_jsonb(prior.week_start::text),true);
 original_exceptions:=public.static_weekly_pending_original_exception_set((p_day->>'publicationId')::uuid,prior.week_start,p_operation);
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p WHERE p.projection_id=prior.projection_id
  AND p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_manual_exception_summary(original_exceptions)))
 THEN RAISE EXCEPTION 'Exact current accepted two-absence projection required';END IF;
 SELECT x INTO STRICT day_basis FROM jsonb_array_elements(prior.projection_envelope#>'{authority,datedDayBases}') x WHERE x->>'serviceDate'=service::text;
 IF day_basis->>'kind'<>'ABSENCE' OR jsonb_array_length(day_basis#>'{input,absentPersonIds}')<>2
  OR day_basis#>>'{plan,planDigest}' IS DISTINCT FROM p_day->>'retainedPlanDigest'
  OR day_basis#>>'{plan,planDigest}' IS DISTINCT FROM public.static_weekly_digest_jsonb((day_basis->'plan')-'planDigest')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(day_basis#>'{input,roster}') r WHERE r->>'personId'=ctx#>>'{originalCommand,semanticBody,employeeId}')
 THEN RAISE EXCEPTION 'Retained two-absence day or third employee changed';END IF;
 RETURN jsonb_build_object('source',source,'slot',slot,'dayBasis',day_basis,'originalCommand',ctx->'originalCommand');
END $fn$;
CREATE FUNCTION public.static_weekly_prepare_coverall_choice(p_choice jsonb,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;prior custodial_coverall.choices%rowtype;d jsonb;actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF p_choice IS NULL OR pg_column_size(p_choice)>262144 OR jsonb_array_length(p_choice->'days') NOT BETWEEN 1 AND 366
  OR p_choice->>'choiceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_choice-'choiceDigest')
  OR p_choice->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-choice.v1'
  OR p_choice->'contractorBooked' IS DISTINCT FROM 'false'::jsonb OR p_choice->'vendorApprovalClaimed' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Exact bounded CoverAll preparing DATA required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_choice,
 ARRAY['schema','choiceId','operationId','managerId','semanticDigest','expectedRevision','days','canonicalSemanticBody','contractorBooked','vendorApprovalClaimed','choiceDigest'],
 ARRAY['schema','choiceId','operationId','managerId','semanticDigest','expectedRevision','days','canonicalSemanticBody','contractorBooked','vendorApprovalClaimed','choiceDigest'],'original CoverAll choice');
 actor:=public.custodial_action_actor_v1((p_choice->>'managerId')::uuid,p_credential,p_device,p_access,'manage_coverall');
 PERFORM public.static_weekly_coverall_bind_actor((p_choice->>'operationId')::uuid,(p_choice->>'managerId')::uuid,p_credential,p_device,p_access);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=(p_choice->>'operationId')::uuid FOR UPDATE;
 ctx:=public.static_weekly_pending_context(c.operation_id,(p_choice->>'managerId')::uuid);
 IF c.state<>'PREPARING' OR c.command_kind<>'absence' OR c.prepared_by_manager_id::text<>p_choice->>'managerId'
  OR c.semantic_body IS DISTINCT FROM p_choice->'canonicalSemanticBody' OR c.semantic_digest IS DISTINCT FROM p_choice->>'semanticDigest'
  OR to_jsonb(c.expected_revision) IS DISTINCT FROM p_choice->'expectedRevision'
 THEN RAISE EXCEPTION 'Supplement cannot change six-field canonical command or its original PREPARING owner';END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'serviceDate') FROM jsonb_array_elements(p_choice->'days') x) THEN RAISE EXCEPTION 'Duplicate actual day choice';END IF;
 SELECT * INTO prior FROM custodial_coverall.choices WHERE operation_id=c.operation_id;
 IF FOUND THEN
  IF prior.choice_json IS DISTINCT FROM p_choice THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original CoverAll choice is immutable';END IF;
  RETURN jsonb_build_object('state','PREPARING','operationId',c.operation_id,'choiceId',prior.choice_id,'choiceDigest',prior.choice_digest,'replayed',true);
 END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_choice->'days') LOOP PERFORM public.static_weekly_coverall_validate_choice_day(c.operation_id,c.prepared_by_manager_id,d);END LOOP;
 INSERT INTO custodial_coverall.choices VALUES(c.operation_id,(p_choice->>'choiceId')::uuid,c.prepared_by_manager_id,c.semantic_digest,c.expected_revision,
  p_credential,p_device,p_access,p_choice,p_choice->>'choiceDigest',clock_timestamp());
 RETURN jsonb_build_object('state','PREPARING','operationId',c.operation_id,'choiceId',p_choice->'choiceId','choiceDigest',p_choice->'choiceDigest','accepted',false);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_stage_companion(p_operation uuid,p_manager uuid,p_candidates jsonb,p_preview text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;choice custodial_coverall.choices%rowtype;prior custodial_coverall.staged_bindings%rowtype;day jsonb;request_actor custodial_coverall.request_actors%rowtype;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT * INTO choice FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT request_actor FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 PERFORM public.custodial_action_actor_v1(p_manager,request_actor.credential_id,request_actor.device_id,request_actor.session_access,'manage_coverall');
 IF c.prepared_by_manager_id<>p_manager OR c.state NOT IN('PREPARING','PREPARED') THEN RAISE EXCEPTION 'Original staffing stage ownership required';END IF;
 IF c.command_kind='absence' THEN
  FOR day IN SELECT value FROM jsonb_array_elements(choice.choice_json->'days') LOOP PERFORM public.static_weekly_coverall_validate_choice_day(p_operation,p_manager,day);END LOOP;
 END IF;
 SELECT * INTO prior FROM custodial_coverall.staged_bindings WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.choice_digest<>choice.choice_digest OR prior.candidate_set_digest<>public.static_weekly_digest_jsonb(p_candidates) OR prior.preview_digest<>p_preview THEN RAISE EXCEPTION 'Staged CoverAll identity changed';END IF;
 ELSE INSERT INTO custodial_coverall.staged_bindings VALUES(p_operation,choice.operation_id,choice.choice_digest,public.static_weekly_digest_jsonb(p_candidates),p_preview);END IF;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_accept_companion(p_operation uuid,p_manager uuid,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;b custodial_coverall.staged_bindings%rowtype;q custodial_coverall.choices%rowtype;d jsonb;request_actor custodial_coverall.request_actors%rowtype;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation FOR UPDATE;
 SELECT * INTO b FROM custodial_coverall.staged_bindings WHERE operation_id=p_operation;IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END) THEN RAISE EXCEPTION 'CoverAll cannot accept without its staged original binding';END IF;RETURN;END IF;
 SELECT * INTO STRICT q FROM custodial_coverall.choices WHERE operation_id=b.choice_operation_id;
 SELECT * INTO STRICT request_actor FROM custodial_coverall.request_actors WHERE operation_id=p_operation;
 PERFORM public.custodial_action_actor_v1(p_manager,request_actor.credential_id,request_actor.device_id,request_actor.session_access,'manage_coverall');
 IF c.state<>'PREPARED' OR c.prepared_by_manager_id<>p_manager OR p_revision<>c.expected_revision+1
  OR (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)<>p_revision
  OR current_setting('app.static_weekly_staffing_batch_operation',true) IS DISTINCT FROM p_operation::text
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.authority_revision=p_revision AND r.command_id=p_operation AND r.operation='apply_staffing_command' AND r.actor_manager_id=p_manager)
  OR c.candidate_set_digest<>b.candidate_set_digest OR c.preview_digest<>b.preview_digest OR q.choice_digest<>b.choice_digest
 THEN RAISE EXCEPTION 'CoverAll acceptance must share the exact canonical native transaction/revision';END IF;
 IF c.command_kind='absence' THEN
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_staffing_absences WHERE absence_id=p_operation AND accepted_revision=p_revision) THEN RAISE EXCEPTION 'Canonical third absence fact missing';END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') LOOP
   INSERT INTO custodial_coverall.accepted_days VALUES(p_operation,(d->>'serviceDate')::date,(d->>'sourceId')::uuid,(d->>'publicationId')::uuid,
    (d->>'capacityId')::uuid,p_revision,p_manager,d);
  END LOOP;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_staffing_absence_cancellations WHERE accepted_operation_id=p_operation AND absence_id=c.target_absence_id AND accepted_revision=p_revision) THEN RAISE EXCEPTION 'Canonical cancellation fact missing';END IF;
  INSERT INTO custodial_coverall.cancellations SELECT p_operation,a.operation_id,a.service_date,p_revision,p_manager FROM custodial_coverall.accepted_days a
   WHERE a.operation_id=c.target_absence_id AND a.service_date BETWEEN c.start_date AND c.end_date;
 END IF;
END $fn$;
-- Source-bound pending/accepted fact reconstruction. No synthetic person or
-- vendor booking is created. The actual hours remain separate immutable DATA.
CREATE FUNCTION public.static_weekly_coverall_capacity_availability(p_source jsonb,p_day jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE slot jsonb;template jsonb;day integer:=extract(dow FROM (p_day->>'serviceDate')::date)::integer;minutes integer;
BEGIN
 SELECT s INTO STRICT slot FROM jsonb_array_elements(p_source->'slots') s WHERE s->>'id'=p_day->>'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(slot);IF NOT public.static_weekly_capacity_registered(slot) THEN RAISE EXCEPTION 'Unregistered source capacity';END IF;
 SELECT t INTO STRICT template FROM jsonb_array_elements(slot->'contractorAvailability') t WHERE t->>'dayOfWeek'=day::text;
 minutes:=extract(epoch FROM ((p_day#>>'{shift,end}')::time-(p_day#>>'{shift,start}')::time))::integer/60-60;
 IF minutes<=0 THEN RAISE EXCEPTION 'Actual productive capacity is empty';END IF;
 RETURN (template-'breakChoice')||jsonb_build_object('slotId',slot->'id','dayOfWeek',day,'status','working','shift',p_day->'shift',
  'lunch',(p_day->'lunch')||jsonb_build_object('startMinute',extract(epoch FROM (p_day#>>'{lunch,start}')::time)::integer/60,'endMinute',extract(epoch FROM (p_day#>>'{lunch,end}')::time)::integer/60),
  'maxDutyMinutes',minutes,'maxDutyProvenance',template->'productiveCapacityProvenance','blockedWindows','[]'::jsonb);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_day_facts(p_operation uuid,p_day jsonb,p_manager uuid,p_revision bigint,p_choice uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE source jsonb;availability jsonb;version uuid;base jsonb;cover jsonb;lunch jsonb;
BEGIN
 SELECT s.canonical_source,v.version_id INTO STRICT source,version FROM public.static_weekly_authority_source_documents s
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=s.source_id JOIN public.weekly_schedule_publications p USING(version_id)
 WHERE s.source_id=(p_day->>'sourceId')::uuid AND p.publication_id=(p_day->>'publicationId')::uuid;
 availability:=public.static_weekly_coverall_capacity_availability(source,p_day);
 base:=jsonb_build_object('baseVersionId',version,'publicationId',p_day->'publicationId','serviceDate',p_day->'serviceDate',
  'actorId',p_manager,'expectedRevision',p_revision,'reason','Actual manager-confirmed source-bound third-absence capacity','sequence',p_revision+1,'coverAllChoiceId',p_choice,'coverAllOperationId',p_operation);
 cover:=base||jsonb_build_object('id','coverall:'||p_operation||':'||(p_day->>'serviceDate'),
  'type','cover_all','payload',jsonb_build_object('availability',availability),'idempotencyKey','coverall:'||p_operation||':'||(p_day->>'serviceDate'));
 lunch:=base||jsonb_build_object('id','coverall-lunch:'||p_operation||':'||(p_day->>'serviceDate'),
  'type','lunch','window',p_day->'lunch','payload',jsonb_build_object('slotId',p_day->'capacityId'),
  'idempotencyKey','coverall-lunch:'||p_operation||':'||(p_day->>'serviceDate'));
 RETURN jsonb_build_array(cover||jsonb_build_object('payloadDigest',public.static_weekly_digest_jsonb(cover->'payload')),
  lunch||jsonb_build_object('payloadDigest',public.static_weekly_digest_jsonb(jsonb_build_object('payload',lunch->'payload','window',lunch->'window'))));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_effective_facts(p_publication uuid,p_frame date,p_exclude_operation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE row record;facts jsonb:='[]';
BEGIN
 FOR row IN SELECT a.*,q.choice_id,c.state,c.expected_revision FROM custodial_coverall.accepted_days a
 JOIN custodial_coverall.choices q USING(operation_id) JOIN public.static_weekly_staffing_commands c USING(operation_id)
 JOIN public.static_weekly_staffing_absences original ON original.absence_id=a.operation_id AND original.accepted_operation_id=c.operation_id
  AND original.accepted_revision=a.accepted_revision AND original.accepted_by_manager_id=a.manager_id
 WHERE a.publication_id=p_publication AND a.service_date BETWEEN p_frame AND p_frame+6
  AND (p_exclude_operation IS NULL OR a.operation_id<>p_exclude_operation)
  AND (c.state='ACCEPTED' OR (c.state='PREPARED' AND current_setting('app.static_weekly_staffing_batch_operation',true)=c.operation_id::text
    AND EXISTS(SELECT 1 FROM public.weekly_schedule_authority_revisions r WHERE r.command_id=c.operation_id AND r.authority_revision=a.accepted_revision AND r.operation='apply_staffing_command')))
  AND NOT EXISTS(SELECT 1 FROM custodial_coverall.cancellations x JOIN public.static_weekly_staffing_absence_cancellations k
    ON k.accepted_operation_id=x.operation_id AND k.absence_id=x.original_operation_id AND k.accepted_revision=x.accepted_revision
    JOIN public.static_weekly_staffing_commands cc ON cc.operation_id=x.operation_id
    WHERE x.original_operation_id=a.operation_id AND x.service_date=a.service_date AND (p_exclude_operation IS NULL OR x.operation_id<>p_exclude_operation)
     AND (cc.state='ACCEPTED' OR (cc.state='PREPARED' AND current_setting('app.static_weekly_staffing_batch_operation',true)=cc.operation_id::text)))
 ORDER BY a.service_date,a.operation_id LOOP
  facts:=facts||(SELECT jsonb_agg(e||jsonb_build_object('status','accepted')) FROM jsonb_array_elements(public.static_weekly_coverall_day_facts(row.operation_id,row.day_json,row.manager_id,row.expected_revision,row.choice_id)) e);
 END LOOP;
 RETURN facts;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_pending_facts(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;q custodial_coverall.choices%rowtype;d jsonb;facts jsonb:='[]';
BEGIN
 PERFORM public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF c.command_kind='cancel_absence' THEN RETURN '[]'::jsonb;END IF;
 SELECT * INTO q FROM custodial_coverall.choices WHERE operation_id=p_operation;IF NOT FOUND THEN RETURN facts;END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') WHERE value->>'publicationId'=p_publication::text
  AND (value->>'serviceDate')::date BETWEEN p_frame AND p_frame+6 AND (p_day IS NULL OR value->>'serviceDate'=p_day::text) LOOP
  facts:=facts||public.static_weekly_coverall_day_facts(p_operation,d,p_manager,c.expected_revision,q.choice_id);
 END LOOP;
 RETURN facts;
END $fn$;
-- Native stage/accept/source readers are patched by the exact reversible
-- installer generated in this same release; no old six-field semantic changes.

-- Current-date typed-capacity Source activation. Staging stores DATA only:
-- no Source, registry, roster slot or person is registered until the one atomic
-- confirmation. A deferred complete-receipt trigger prevents half registration.
CREATE TABLE custodial_coverall.activation_packets(
 packet_id uuid PRIMARY KEY,source_id uuid UNIQUE NOT NULL,template_id text UNIQUE NOT NULL,manager_id uuid NOT NULL,
 service_date date NOT NULL,expected_revision bigint NOT NULL,roster_digest text NOT NULL,preview_digest text NOT NULL,
 source_json jsonb NOT NULL,source_digest text NOT NULL,transition_json jsonb NOT NULL,capacity_json jsonb NOT NULL,
 owner_config jsonb NOT NULL,template_json jsonb NOT NULL,binding_json jsonb NOT NULL,approval_json jsonb NOT NULL,
 feasibility_json jsonb NOT NULL,packet_fingerprint text NOT NULL);
CREATE TABLE custodial_coverall.activation_operations(
 operation_id uuid PRIMARY KEY,packet_id uuid UNIQUE NOT NULL REFERENCES custodial_coverall.activation_packets(packet_id),
 manager_id uuid NOT NULL,owner_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),request_json jsonb NOT NULL);
CREATE TABLE custodial_coverall.activation_receipts(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_operations(operation_id),receipt_json jsonb NOT NULL);
DO $private_activation$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['activation_packets','activation_operations','activation_receipts'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $private_activation$;
CREATE FUNCTION public.static_weekly_coverall_require_activation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_receipts WHERE operation_id=NEW.operation_id)
 THEN RAISE EXCEPTION 'Typed capacity Source cannot commit without native publication/projection/lunch receipt';END IF;RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER complete_coverall_activation AFTER INSERT ON custodial_coverall.activation_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.static_weekly_coverall_require_activation_receipt();
CREATE FUNCTION public.static_weekly_coverall_assert_activation_data(p_data jsonb,p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE source jsonb:=p_data->'source';transition jsonb:=p_data->'transition';cp jsonb:=p_data->'capacityTransition';
 oldsource jsonb;oldslot jsonb;newslot jsonb;mapping jsonb;expected jsonb;actual jsonb;ids text[];row jsonb;at date;end_date date;
BEGIN
 IF p_data IS NULL OR pg_column_size(p_data)>33554432 THEN RAISE EXCEPTION 'Bounded current-date activation DATA required';END IF;
 IF p_data->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-activation-data.v1'
  OR jsonb_array_length(p_snapshot->'rosterSlots')<>22 OR p_data->'currentPositions'<>'22'::jsonb
  OR p_data->'additionalCapacityPositions'<>'8'::jsonb OR p_data->'prospectivePositions'<>'30'::jsonb OR p_data->'newEmployees'<>'0'::jsonb
  OR p_data->'weeklyBaselineChanged' IS DISTINCT FROM 'false'::jsonb OR p_data->'registered' IS DISTINCT FROM 'false'::jsonb
  OR p_data->'published' IS DISTINCT FROM 'false'::jsonb OR p_data->'productionWritten' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Exact original22 plus eight NEW nonemployee capacity DATA required';END IF;
 at:=(p_snapshot->>'serviceDate')::date;end_date:=at+6;
 IF source->>'serviceDate'<>at::text OR source#>>'{version,effectiveStart}'<>at::text
  OR p_data->>'serviceDate'<>at::text OR p_data->>'windowEnd'<>end_date::text
  OR source->>'serviceDate'<>p_data#>>'{capacityTransition,serviceDate}'
  OR p_data->>'sourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR source->'exceptions' IS DISTINCT FROM '[]'::jsonb
 THEN RAISE EXCEPTION 'Native capacity activation uses current service date and exact immutable Source';END IF;
 PERFORM public.static_weekly_assert_manual_roster_transition(transition,p_snapshot,p_data->'ownerConfig');
 oldsource:=transition->'projectedSourceDraft';
 IF cp->>'capacityTransitionDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(cp-'capacityTransitionDigest')
  OR cp->>'rosterReadbackDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_snapshot)
  OR cp->>'normalRosterTransitionDigest' IS DISTINCT FROM transition->>'transitionDigest'
  OR jsonb_array_length(cp->'selection')<>8 OR jsonb_array_length(source->'slots')<>17
  OR jsonb_array_length(source#>'{version,assignments}')<>346
  OR (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(source#>'{version,assignments}') x)
   IS DISTINCT FROM(SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(oldsource#>'{version,assignments}') x)
  OR source#>'{version,lunchCoveragePolicy}' IS DISTINCT FROM oldsource#>'{version,lunchCoveragePolicy}'
  OR source->'proximity' IS DISTINCT FROM oldsource->'proximity'
  OR (source->'version')-ARRAY['id','publicationId','status','effectiveStart','namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds','slotAvailability','assignments']
   IS DISTINCT FROM (oldsource->'version')-ARRAY['id','publicationId','status','effectiveStart','namedAbsentSlotIds','vacancyCapableSlotIds','vacantSlotIds','slotAvailability','assignments']
  OR (SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(source#>'{version,slotAvailability}') x)
   IS DISTINCT FROM(SELECT jsonb_agg(x ORDER BY x::text) FROM jsonb_array_elements(oldsource#>'{version,slotAvailability}') x)
 THEN RAISE EXCEPTION 'Shared mapper/roster/normal geometry binding differs';END IF;
 SELECT array_agg(x->>'new_capacity_id') INTO ids FROM jsonb_array_elements(cp->'selection') x;
 IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>8 OR EXISTS(SELECT 1 FROM public.weekly_roster_slots WHERE slot_id::text=ANY(ids))
  OR (SELECT count(DISTINCT x->>'capacity_code') FROM jsonb_array_elements(cp->'selection') x)<>8
 THEN RAISE EXCEPTION 'Capacity IDs/codes must be eight unique NEW positions';END IF;
 FOR mapping IN SELECT value FROM jsonb_array_elements(cp->'selection') LOOP
  SELECT x INTO STRICT oldslot FROM jsonb_array_elements(oldsource->'slots') x WHERE x->'id'=mapping->'legacy_slot_id' AND x->'contractorCapacity'='true'::jsonb;
  SELECT x INTO STRICT newslot FROM jsonb_array_elements(source->'slots') x WHERE x->'id'=mapping->'new_capacity_id';
  expected:=jsonb_build_object('id',mapping->'new_capacity_id','capacityId',mapping->'new_capacity_id','label',mapping->'capacity_code',
   'kind','CONTRACTOR_CAPACITY','contractorCapacity',true,'incumbencies','[]'::jsonb,'contractorAvailability',oldslot->'contractorAvailability');
  IF newslot IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM public.static_weekly_contractor_capacity_registrations WHERE capacity_code=mapping->>'capacity_code')
  THEN RAISE EXCEPTION 'Source-bound typed capacity template/codes require explicit reconciliation';END IF;
  PERFORM public.static_weekly_capacity_assert_shape(newslot);
 END LOOP;
 FOR oldslot IN SELECT value FROM jsonb_array_elements(oldsource->'slots') WHERE value->'contractorCapacity' IS DISTINCT FROM 'true'::jsonb LOOP
  SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(oldslot->'incumbencies') WITH ORDINALITY q(x,n)
   WHERE (x->>'effectiveStart')::date<=end_date AND (x->>'effectiveEnd' IS NULL OR (x->>'effectiveEnd')::date>at);
  SELECT x INTO STRICT newslot FROM jsonb_array_elements(source->'slots') x WHERE x->'id'=oldslot->'id';
  IF newslot IS DISTINCT FROM (oldslot||jsonb_build_object('incumbencies',actual)) THEN RAISE EXCEPTION 'Ordinary employee or history facts changed';END IF;
 END LOOP;
 IF p_data#>'{feasibility,candidateSource}' IS DISTINCT FROM source OR p_data#>'{template,source}' IS DISTINCT FROM source
  OR p_data#>'{feasibility,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_data#>'{feasibility,mapping,unchanged}' IS DISTINCT FROM 'true'::jsonb
  OR jsonb_array_length(p_data#>'{feasibility,initialBaseline,projection,assignments}')<>346
  OR jsonb_array_length(p_data#>'{feasibility,lunchDocument,loans}')<>40
 THEN RAISE EXCEPTION 'Existing fixed-pattern adapter snapshot, not a new optimizer receipt, required';END IF;
END $fn$;
-- Same Source301 packet identity and all five integrity checks; only one
-- component JSONB is live at a time. No full document/projection/lunch records
-- are retained while hashing the remaining feasibility body.
CREATE FUNCTION custodial_coverall.activation_packet_fingerprint(p_source uuid,p_template text,p_manager uuid,p_transition jsonb,p_feasibility jsonb)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE component jsonb;metadata jsonb;feasibility_identity text;document_identity text;projection_identity text;lunch_identity text;
BEGIN
 feasibility_identity:=p_feasibility->>'digest';
 IF feasibility_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(p_feasibility-ARRAY['digest','initialBaseline']) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation feasibility identity changed';END IF;
 component:=p_feasibility#>'{initialBaseline,document}';document_identity:=component#>>'{validation,database_document_identity}';
 IF document_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component#-'{validation,database_document_identity}') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation document identity changed';END IF;
 component:=NULL;
 component:=p_feasibility#>'{initialBaseline,projection}';projection_identity:=component->>'database_projection_identity';
 IF projection_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component-'database_projection_identity') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation projection identity changed';END IF;
 component:=NULL;
 component:=p_feasibility->'lunchDocument';lunch_identity:=component->>'document_identity';
 IF lunch_identity IS DISTINCT FROM public.static_weekly_digest_jsonb(component-'document_identity') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation lunch identity changed';END IF;
 IF p_feasibility#>'{initialBaseline,lunchDocument}' IS DISTINCT FROM component THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual activation initial lunch identity changed';END IF;
 component:=NULL;
 metadata:=(p_feasibility->'initialBaseline')-ARRAY['document','projection','lunchDocument'];
 p_feasibility:=NULL;
 RETURN public.static_weekly_digest_jsonb(jsonb_build_object('sourceId',p_source,'templateId',p_template,'managerId',p_manager,
  'transitionDigest',p_transition->>'transitionDigest','feasibilityDigest',feasibility_identity,
  'documentIdentity',document_identity,'projectionIdentity',projection_identity,'lunchIdentity',lunch_identity,'initialMetadata',metadata));
END $fn$;
REVOKE ALL ON FUNCTION custodial_coverall.activation_packet_fingerprint(uuid,text,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
-- The CoverAll copied reader holds only scalar/small output fields. This
-- owner-only SQL helper reads the immutable full feasibility for one isolated
-- fingerprint call rather than retaining it in the caller's whole-row record.
CREATE FUNCTION custodial_coverall.stored_manual_packet_fingerprint(p_packet uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT custodial_coverall.activation_packet_fingerprint(p.source_id,p.template_id,p.manager_id,p.transition_json,p.feasibility_json)
 FROM public.static_weekly_manual_activation_packets p WHERE p.packet_id=p_packet
$fn$;
REVOKE ALL ON FUNCTION custodial_coverall.stored_manual_packet_fingerprint(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE FUNCTION public.static_weekly_prepare_coverall_activation(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;fingerprint text;body jsonb;feasibility jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_release_operator();PERFORM public.static_weekly_v3_manager_actor((p_data->>'managerId')::uuid);
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 PERFORM public.static_weekly_coverall_assert_activation_data(p_data,snapshot);
 -- Drop the large feasibility field from the caller packet before hashing.
 -- The unchanged full feasibility is persisted below; no wire/data field drops.
 feasibility:=p_data->'feasibility';p_data:=p_data-'feasibility';
 fingerprint:=custodial_coverall.activation_packet_fingerprint((p_data->>'sourceId')::uuid,p_data->>'templateId',(p_data->>'managerId')::uuid,p_data->'transition',feasibility);
 body:=jsonb_build_object('packetId',p_data->'packetId','sourceId',p_data->'sourceId','managerId',p_data->'managerId','expectedRevision',snapshot->'authorityRevision',
  'serviceDate',snapshot->'serviceDate','sourceDigest',p_data->'sourceDigest','rosterDigest',public.static_weekly_digest_jsonb(snapshot),'packetFingerprint',fingerprint);
 INSERT INTO custodial_coverall.activation_packets VALUES((p_data->>'packetId')::uuid,(p_data->>'sourceId')::uuid,p_data->>'templateId',(p_data->>'managerId')::uuid,
  (snapshot->>'serviceDate')::date,(snapshot->>'authorityRevision')::bigint,public.static_weekly_digest_jsonb(snapshot),public.static_weekly_digest_jsonb(body),
  p_data->'source',p_data->>'sourceDigest',p_data->'transition',p_data->'capacityTransition',p_data->'ownerConfig',p_data->'template',p_data->'binding',p_data->'approvalEvidence',feasibility,fingerprint);
 feasibility:=NULL;p_data:=NULL;
 RETURN body||jsonb_build_object('previewDigest',public.static_weekly_digest_jsonb(body),'registered',false,'published',false);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_activation_filtered_roster(p_packet uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;ids jsonb;slots jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_operations o WHERE o.packet_id=p_packet AND o.owner_xid=pg_current_xact_id())
 THEN RAISE EXCEPTION 'Only this atomic original activation may exclude its own eight new empty capacity positions from the original22 CAS';END IF;
 SELECT capacity_json->'newCapacityIds' INTO STRICT ids FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF jsonb_array_length(snapshot->'rosterSlots')<>30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'rosterSlots') s
  WHERE ids?(s->>'slotId') AND jsonb_array_length(s->'incumbencies')<>0) THEN RAISE EXCEPTION 'Expected22 histories plus eight empty nonemployee positions';END IF;
 SELECT jsonb_agg(s ORDER BY s->>'slotId') INTO slots FROM jsonb_array_elements(snapshot->'rosterSlots') s WHERE NOT ids?(s->>'slotId');
 IF jsonb_array_length(slots)<>22 THEN RAISE EXCEPTION 'Original history slot set differs';END IF;
 RETURN jsonb_set(snapshot,'{rosterSlots}',slots,false);
END $fn$;
DO $private_source301_copies$
DECLARE original text;changed text;inverse text;item record;reader_seam record;needle text;guard_position integer;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_register_approved_template(uuid,jsonb,jsonb,jsonb,jsonb)','static_weekly_register_approved_template','static_weekly_coverall_register_template','release'),
 ('public.static_weekly_read_manual_activation_basis(uuid,uuid,bigint)','static_weekly_read_manual_activation_basis','static_weekly_coverall_activation_basis','basis'),
 ('public.static_weekly_activate_approved_manual_schedule(uuid,uuid,bigint,text,text)','static_weekly_activate_approved_manual_schedule','static_weekly_coverall_activate_source301','activate')) x(sig,old_name,new_name,kind) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.sig));
  changed:=replace(original,'FUNCTION public.'||item.old_name||'(','FUNCTION public.'||item.new_name||'(');
  IF changed=original THEN RAISE EXCEPTION 'Exact Source301 function header missing';END IF;
  needle:=CASE item.kind WHEN 'release' THEN ' perform public.static_weekly_v3_assert_release_operator();'
   WHEN 'basis' THEN 'snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));'
   ELSE 'public.static_weekly_read_manual_activation_basis(p_manager,p_packet,p_revision)' END;
  IF length(changed)-length(replace(changed,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Source301 private copy seam differs: %',item.sig;END IF;
  guard_position:=position(needle in original);
  changed:=replace(changed,needle,CASE item.kind WHEN 'release' THEN ''
   WHEN 'basis' THEN 'snapshot:=public.static_weekly_coverall_activation_filtered_roster(p_packet);'
   ELSE 'public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision)' END);
  IF item.kind='basis' THEN
   FOR reader_seam IN SELECT * FROM(VALUES
 (0,$reader$declare packet public.static_weekly_manual_activation_packets%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;$reader$,$reader$declare packet record;entry public.static_weekly_approved_template_catalog%rowtype;$reader$),
 (1,$reader$ select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$,$reader$ select packet_id,source_id,template_id,service_date,manager_id,transition_json,packet_digest,
  feasibility_json->>'digest' as feasibility_digest,feasibility_json->'assignments' as assignments,feasibility_json->'lunchDocument' as lunch_document
 into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$),
 (2,$reader$public.static_weekly_manual_activation_packet_fingerprint(
   packet.source_id,packet.template_id,packet.manager_id,packet.transition_json,packet.feasibility_json)$reader$,$reader$custodial_coverall.stored_manual_packet_fingerprint(p_packet)$reader$),
 (3,$reader$packet.feasibility_json->>'digest'$reader$,$reader$packet.feasibility_digest$reader$),
 (4,$reader$packet.feasibility_json->'assignments'$reader$,$reader$packet.assignments$reader$),
 (5,$reader$packet.feasibility_json->'lunchDocument'$reader$,$reader$packet.lunch_document$reader$)
   ) r(n,before_text,after_text) ORDER BY n LOOP
    IF length(changed)-length(replace(changed,reader_seam.before_text,''))<>length(reader_seam.before_text)
    THEN RAISE EXCEPTION 'Exact Source301 CoverAll reader memory seam differs: %',reader_seam.n;END IF;
    changed:=replace(changed,reader_seam.before_text,reader_seam.after_text);
   END LOOP;
  END IF;
  inverse:=changed;
  IF item.kind='basis' THEN
   FOR reader_seam IN SELECT * FROM(VALUES
 (0,$reader$declare packet public.static_weekly_manual_activation_packets%rowtype;entry public.static_weekly_approved_template_catalog%rowtype;$reader$,$reader$declare packet record;entry public.static_weekly_approved_template_catalog%rowtype;$reader$),
 (1,$reader$ select * into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$,$reader$ select packet_id,source_id,template_id,service_date,manager_id,transition_json,packet_digest,
  feasibility_json->>'digest' as feasibility_digest,feasibility_json->'assignments' as assignments,feasibility_json->'lunchDocument' as lunch_document
 into strict packet from public.static_weekly_manual_activation_packets where packet_id=p_packet for share;$reader$),
 (2,$reader$public.static_weekly_manual_activation_packet_fingerprint(
   packet.source_id,packet.template_id,packet.manager_id,packet.transition_json,packet.feasibility_json)$reader$,$reader$custodial_coverall.stored_manual_packet_fingerprint(p_packet)$reader$),
 (3,$reader$packet.feasibility_json->>'digest'$reader$,$reader$packet.feasibility_digest$reader$),
 (4,$reader$packet.feasibility_json->'assignments'$reader$,$reader$packet.assignments$reader$),
 (5,$reader$packet.feasibility_json->'lunchDocument'$reader$,$reader$packet.lunch_document$reader$)
   ) r(n,before_text,after_text) ORDER BY n DESC LOOP
    inverse:=replace(inverse,reader_seam.after_text,reader_seam.before_text);
   END LOOP;
  END IF;
  inverse:=replace(inverse,'FUNCTION public.'||item.new_name||'(','FUNCTION public.'||item.old_name||'(');
  IF item.kind='release' THEN inverse:=substring(inverse from 1 for guard_position-1)||needle||substring(inverse from guard_position);
  ELSIF item.kind='basis' THEN inverse:=replace(inverse,'snapshot:=public.static_weekly_coverall_activation_filtered_roster(p_packet);',needle);
  ELSE inverse:=replace(inverse,'public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision)',needle);END IF;
  IF inverse<>original THEN RAISE EXCEPTION 'Unexplained Source301 body drift';END IF;
  EXECUTE changed;
 END LOOP;
END $private_source301_copies$;
CREATE FUNCTION public.static_weekly_begin_coverall_activation(p_manager uuid,p_packet uuid,p_operation uuid,p_revision bigint,p_preview text,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE packet record;snapshot jsonb;request jsonb;prior record;slot jsonb;actor jsonb;code text;basis jsonb;result jsonb;employees_before text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 request:=jsonb_build_object('managerId',p_manager,'packetId',p_packet,'operationId',p_operation,'expectedRevision',p_revision,'previewDigest',p_preview);
 SELECT o.request_json,r.receipt_json INTO prior FROM custodial_coverall.activation_operations o JOIN custodial_coverall.activation_receipts r USING(operation_id) WHERE o.operation_id=p_operation;
 IF FOUND THEN IF prior.request_json IS DISTINCT FROM request THEN RAISE EXCEPTION 'Original activation identity conflict';END IF;RETURN prior.receipt_json;END IF;
 -- Explicit scalar/source/config fields ONLY: the outer transaction never
 -- retains a13MBfeasibility record while native helpers allocate components.
 SELECT packet_id,source_id,template_id,manager_id,service_date,expected_revision,roster_digest,preview_digest,
  source_json,source_digest,transition_json,capacity_json,owner_config,template_json,binding_json,approval_json,packet_fingerprint
 INTO STRICT packet FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF p_operation IS NULL OR packet.manager_id<>p_manager OR packet.expected_revision<>p_revision OR packet.preview_digest<>p_preview
  OR packet.service_date::text<>snapshot->>'serviceDate' OR p_revision::text<>snapshot->>'authorityRevision'
  OR packet.roster_digest<>public.static_weekly_digest_jsonb(snapshot)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current typed activation Source/manager/roster/revision changed';END IF;
 SELECT public.static_weekly_digest_jsonb(jsonb_agg(to_jsonb(e) ORDER BY e.id)) INTO employees_before FROM public.employees e;
 INSERT INTO custodial_coverall.activation_operations VALUES(p_operation,p_packet,p_manager,pg_current_xact_id(),request);
 INSERT INTO public.static_weekly_authority_source_documents(source_id,canonical_source,source_digest,configured_by)
 VALUES(packet.source_id,packet.source_json,packet.source_digest,'approved-manual-coverall:'||p_operation);
 FOR slot IN SELECT value FROM jsonb_array_elements(packet.source_json->'slots') WHERE value->>'kind'='CONTRACTOR_CAPACITY' LOOP
  PERFORM public.static_weekly_capacity_assert_shape(slot);code:='STATIC_'||upper(replace(slot->>'id','-',''));
  INSERT INTO public.weekly_roster_slots(slot_id,slot_code,slot_label,created_by_manager_id,created_by_manager_name_snapshot,content_digest)
  VALUES((slot->>'id')::uuid,code,slot->>'label',p_manager,actor->>'manager_name',public.static_weekly_digest_jsonb(jsonb_build_object('source_id',packet.source_id,'slot_id',slot->>'id','slot_code',code,'slot_label',slot->>'label')));
  INSERT INTO public.static_weekly_contractor_capacity_registrations(capacity_slot_id,capacity_code,source_id,source_digest,slot_snapshot,slot_digest,registered_by_manager_id,manager_name_snapshot)
  VALUES((slot->>'id')::uuid,slot->>'label',packet.source_id,packet.source_digest,slot,public.static_weekly_digest_jsonb(slot),p_manager,actor->>'manager_name');
 END LOOP;
 PERFORM public.static_weekly_v3_source_identity(packet.source_json);
 PERFORM public.static_weekly_coverall_register_template(packet.source_id,packet.template_json,packet.binding_json,packet.owner_config,packet.approval_json);
 INSERT INTO public.static_weekly_manual_activation_packets(packet_id,source_id,template_id,service_date,manager_id,transition_json,feasibility_json,packet_digest)
 SELECT packet_id,source_id,template_id,service_date,manager_id,transition_json,feasibility_json,packet_fingerprint FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 basis:=public.static_weekly_coverall_activation_basis(p_manager,p_packet,p_revision);
 result:=public.static_weekly_coverall_activate_source301(p_manager,p_packet,p_revision,basis->>'previewDigest','coverall-source:'||p_operation);
 IF result->>'status'<>'PERSISTED_CURRENT' OR result->>'source_id'<>packet.source_id::text
  OR (SELECT count(*) FROM public.weekly_roster_slots)<>30
  OR employees_before IS DISTINCT FROM(SELECT public.static_weekly_digest_jsonb(jsonb_agg(to_jsonb(e) ORDER BY e.id)) FROM public.employees e)
  OR EXISTS(SELECT 1 FROM public.weekly_roster_slot_incumbencies WHERE slot_id::text IN(SELECT jsonb_array_elements_text(packet.capacity_json->'newCapacityIds')))
 THEN RAISE EXCEPTION 'Atomic source/registry/roster/normal346/40 publication did not preserve employees and empty nonemployee capacity';END IF;
 RETURN public.static_weekly_coverall_record_activation_begin(p_operation,p_manager,p_credential,p_device,p_access,result);
END $fn$;

-- BEGIN GENERATED COVERALL COMPLETION

-- Exact mechanical counterpart of applyApprovedManualCoverAllSubstitute.
CREATE FUNCTION public.static_weekly_coverall_assert_retained_day(p_operation uuid,p_manager uuid,p_day jsonb,p_publication uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE q record;d jsonb;retained jsonb;input jsonb;plan jsonb;o jsonb:=p_day->'overlay';replaced jsonb;capacity jsonb;template jsonb;
 source jsonb;ph jsonb;owners jsonb;phases jsonb:='[]';lunches jsonb:='[]';roster jsonb:='[]';coverage jsonb:='[]';
 r jsonb;l jsonb;helper jsonb;recipient jsonb;areas jsonb;expected jsonb;actual jsonb;edge text;next_edge text;normal_owner text;actual_owner text;
 checked_end text;normal_end text;capacity_id text;replaced_id text;recipient_id text;coverer_id text;last_edge text;
BEGIN
 SELECT c.*,x.day INTO STRICT q FROM custodial_coverall.choices c CROSS JOIN LATERAL jsonb_array_elements(c.choice_json->'days') x(day)
 WHERE x.day->>'publicationId'=p_publication::text AND x.day->'serviceDate'=p_day->'serviceDate'
  AND x.day->>'overlayDigest'=o->>'overlayDigest'
  AND (c.operation_id=p_operation OR EXISTS(SELECT 1 FROM custodial_coverall.accepted_days a
    JOIN public.static_weekly_staffing_commands cmd USING(operation_id)
    WHERE a.operation_id=c.operation_id AND a.service_date=(p_day->>'serviceDate')::date AND cmd.state='ACCEPTED'
     AND NOT EXISTS(SELECT 1 FROM custodial_coverall.cancellations z WHERE z.original_operation_id=a.operation_id AND z.service_date=a.service_date)));
 d:=q.day;
 IF q.operation_id=p_operation THEN PERFORM public.static_weekly_coverall_validate_choice_day(p_operation,p_manager,d);END IF;
 SELECT x INTO STRICT retained FROM public.weekly_schedule_compiled_projections prior
 CROSS JOIN LATERAL jsonb_array_elements(prior.projection_envelope#>'{authority,datedDayBases}') x
 WHERE prior.projection_id=(d->>'retainedProjectionId')::uuid AND prior.publication_id=p_publication
  AND prior.projection_envelope->>'database_projection_identity'=d->>'retainedEnvelopeIdentity'
  AND x->'serviceDate'=p_day->'serviceDate';
 input:=retained->'input';plan:=retained->'plan';
 SELECT canonical_source INTO STRICT source FROM public.static_weekly_authority_source_documents WHERE source_id=(d->>'sourceId')::uuid;
 source:=jsonb_set(source,'{serviceDate}',to_jsonb((SELECT week_start::text FROM public.weekly_schedule_compiled_projections WHERE projection_id=(d->>'retainedProjectionId')::uuid)),true);
 SELECT r0 INTO STRICT replaced FROM jsonb_array_elements(input->'roster') r0 WHERE r0->>'personId'=q.choice_json#>>'{canonicalSemanticBody,employeeId}';
 SELECT s INTO STRICT capacity FROM jsonb_array_elements(source->'slots') s WHERE s->'id'=d->'capacityId';
 PERFORM public.static_weekly_capacity_assert_shape(capacity);IF NOT public.static_weekly_capacity_registered(capacity) THEN RAISE EXCEPTION 'Unregistered CoverAll retained owner';END IF;
 SELECT a INTO STRICT template FROM jsonb_array_elements(capacity->'contractorAvailability') a WHERE a->'dayOfWeek'=input->'weekday';
 IF p_day->>'kind'<>'COVERALL' OR p_day->'input' IS DISTINCT FROM input OR p_day->'plan' IS DISTINCT FROM plan
  OR plan->>'planDigest' IS DISTINCT FROM d->>'retainedPlanDigest' OR plan->>'planDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(plan-'planDigest')
  OR o->>'overlayDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(o-'overlayDigest')
  OR o->>'sourceDigest' IS DISTINCT FROM input->>'sourceDigest' OR input->>'sourceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(source)
  OR o->>'acceptedPlanDigest' IS DISTINCT FROM plan->>'planDigest'
  OR o->>'replacedPersonId' IS DISTINCT FROM replaced->>'personId'
  OR o->'substitute' IS DISTINCT FROM jsonb_build_object('slotId',d->'capacityId','kind','CONTRACTOR_CAPACITY','shift',d->'shift','lunch',d->'lunch',
    'confirmationReference',d->'confirmationReference','actualHoursConfirmed',true,'managerConfirmationIsCallerInput',true)
 THEN RAISE EXCEPTION 'Original two-absence plan/input or actual-hours overlay identity changed';END IF;
 PERFORM public.static_weekly_assert_exact_object(o,
 ARRAY['schema','status','serviceDate','acceptedPlanDigest','sourceDigest','absentPersonIds','replacedPersonId','substitute','checkedWindow','phaseOwners','lunchPlans','coverage','roster','groups','conservedRatingTotal','solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','formulaApproved','publicationEligible','productionWritten','contractorBooked','overlayDigest']||CASE WHEN o->>'schema'='custodial.approved-manual-coverall-overlay.v2' THEN ARRAY['normalCoverageWindow','confirmedCoverageExtension'] ELSE ARRAY[]::text[] END,
 ARRAY['schema','status','serviceDate','acceptedPlanDigest','sourceDigest','absentPersonIds','replacedPersonId','substitute','checkedWindow','phaseOwners','lunchPlans','coverage','roster','groups','conservedRatingTotal','solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','formulaApproved','publicationEligible','productionWritten','contractorBooked','overlayDigest']||CASE WHEN o->>'schema'='custodial.approved-manual-coverall-overlay.v2' THEN ARRAY['normalCoverageWindow','confirmedCoverageExtension'] ELSE ARRAY[]::text[] END,'exact mechanical CoverAll overlay');
 capacity_id:=d->>'capacityId';replaced_id:=replaced->>'slotId';normal_end:=input#>>'{checkedWindow,end}';checked_end:=greatest(normal_end,d#>>'{shift,end}');
 FOR ph IN SELECT value FROM jsonb_array_elements(plan->'phaseOwners') LOOP
  SELECT jsonb_object_agg(key,CASE WHEN value=to_jsonb(replaced_id) THEN to_jsonb(capacity_id) ELSE value END) INTO owners FROM jsonb_each(ph->'owners');
  phases:=phases||jsonb_build_array(jsonb_build_object('window',ph->'window','owners',owners));
 END LOOP;
 IF checked_end>normal_end THEN
  SELECT jsonb_object_agg(g->>'code',capacity_id) INTO owners FROM jsonb_array_elements(input->'groups') g;
  phases:=phases||jsonb_build_array(jsonb_build_object('window',jsonb_build_object('start',normal_end,'end',checked_end),'owners',owners));
 END IF;
 IF o->'phaseOwners' IS DISTINCT FROM phases OR o->'checkedWindow' IS DISTINCT FROM jsonb_build_object('start',input#>'{checkedWindow,start}','end',checked_end)
 THEN RAISE EXCEPTION 'Only third owner replacement and confirmed later ALL-area inheritance allowed';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(input->'roster') WHERE value->>'slotId'<>replaced_id LOOP
  roster:=roster||jsonb_build_array(jsonb_build_object('slotId',r->'slotId','personId',r->'personId','name',r->'name','shift',r->'shift','lunch',r->'lunch','kind','EMPLOYEE'));
 END LOOP;
 roster:=roster||jsonb_build_array(jsonb_build_object('slotId',capacity_id,'name',capacity->'label','kind','CONTRACTOR_CAPACITY','shift',d->'shift','lunch',d->'lunch','replacesPersonId',replaced->'personId'));
 IF o->'roster' IS DISTINCT FROM roster THEN RAISE EXCEPTION 'Other normal owners or actual static end times changed';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(plan->'lunchPlans') LOOP
  recipient_id:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN capacity_id ELSE l->>'recipientSlotId' END;
  coverer_id:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN d->>'lunchCovererSlotId' WHEN l->>'covererSlotId'=replaced_id THEN capacity_id ELSE l->>'covererSlotId' END;
  expected:=CASE WHEN l->>'recipientSlotId'=replaced_id THEN d->'lunch' ELSE l->'window' END;
  SELECT coalesce(jsonb_agg(to_jsonb(code) ORDER BY code),'[]') INTO areas FROM(
   SELECT DISTINCT own.key code FROM jsonb_array_elements(phases) phase CROSS JOIN LATERAL jsonb_each(phase->'owners') own
   WHERE phase#>>'{window,start}'<expected->>'end' AND expected->>'start'<phase#>>'{window,end}' AND own.value=to_jsonb(recipient_id)) a;
  lunches:=lunches||jsonb_build_array(jsonb_build_object('recipientSlotId',recipient_id,'covererSlotId',coverer_id,'window',expected,'areas',areas));
  SELECT v INTO STRICT recipient FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=recipient_id;
  SELECT v INTO STRICT helper FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=coverer_id;
  IF recipient_id=coverer_id OR expected->>'start'<recipient#>>'{shift,start}' OR expected->>'end'>recipient#>>'{shift,end}'
   OR expected->>'start'<helper#>>'{shift,start}' OR expected->>'end'>helper#>>'{shift,end}'
   OR (expected->>'end')::time-(expected->>'start')::time<>interval '1 hour'
   OR (expected->>'start'<helper#>>'{lunch,end}' AND helper#>>'{lunch,start}'<expected->>'end')
  THEN RAISE EXCEPTION 'Actual full-hour helper is unavailable';END IF;
 END LOOP;
 IF o->'lunchPlans' IS DISTINCT FROM lunches OR EXISTS(SELECT 1 FROM jsonb_array_elements(lunches) a,jsonb_array_elements(lunches) b
  WHERE a<>b AND a->'covererSlotId'=b->'covererSlotId' AND a#>>'{window,start}'<b#>>'{window,end}' AND b#>>'{window,start}'<a#>>'{window,end}')
 THEN RAISE EXCEPTION 'Only matched third-owner lunch substitution is allowed';END IF;
 -- Same real time-slice edges as the maintained pure substitute; no score or optimizer.
 last_edge:=NULL;
 FOR edge IN SELECT DISTINCT t FROM(
  SELECT input#>>'{checkedWindow,start}' t UNION SELECT checked_end
  UNION SELECT phase#>>'{window,start}' FROM jsonb_array_elements(phases) phase
  UNION SELECT phase#>>'{window,end}' FROM jsonb_array_elements(phases) phase
  UNION SELECT v#>>'{shift,start}' FROM jsonb_array_elements(roster) v UNION SELECT v#>>'{shift,end}' FROM jsonb_array_elements(roster) v
  UNION SELECT v#>>'{lunch,start}' FROM jsonb_array_elements(roster) v UNION SELECT v#>>'{lunch,end}' FROM jsonb_array_elements(roster) v
 ) edges WHERE t BETWEEN input#>>'{checkedWindow,start}' AND checked_end ORDER BY t LOOP
  IF last_edge IS NULL THEN last_edge:=edge;CONTINUE;END IF;
  SELECT phase INTO STRICT ph FROM jsonb_array_elements(phases) phase WHERE phase#>>'{window,start}'<=last_edge AND last_edge<phase#>>'{window,end}';owners:='{}';
  FOR r IN SELECT value FROM jsonb_array_elements(input->'groups') LOOP
   normal_owner:=ph#>>ARRAY['owners',r->>'code'];SELECT v INTO STRICT recipient FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=normal_owner;
   IF recipient#>>'{shift,start}'>last_edge OR recipient#>>'{shift,end}'<edge THEN RAISE EXCEPTION 'Confirmed hours miss retained duty; no invented earlier capacity';END IF;
   actual_owner:=normal_owner;
   IF recipient#>>'{lunch,start}'<=last_edge AND last_edge<recipient#>>'{lunch,end}' THEN
    SELECT v->>'covererSlotId' INTO STRICT actual_owner FROM jsonb_array_elements(lunches) v WHERE v->>'recipientSlotId'=normal_owner;
   END IF;
   SELECT v INTO STRICT helper FROM jsonb_array_elements(roster) v WHERE v->>'slotId'=actual_owner;
   IF helper#>>'{shift,start}'>last_edge OR helper#>>'{shift,end}'<edge OR (helper#>>'{lunch,start}'<=last_edge AND last_edge<helper#>>'{lunch,end}')
   THEN RAISE EXCEPTION 'Actual lunch coverage missing';END IF;
   if actual_owner=capacity_id then
    SELECT area->'work' INTO STRICT actual FROM jsonb_array_elements(input->'phases') WITH ORDINALITY x(phase,n)
     CROSS JOIN LATERAL jsonb_array_elements(phase->'areas') area
     WHERE n=least((SELECT ord FROM jsonb_array_elements(phases) WITH ORDINALITY y(v,ord) WHERE v=ph),jsonb_array_length(input->'phases')) AND area->'code'=r->'code';
    IF NOT((template->'qualifications') @> (actual->'requiredQualifications')) OR template->'restrictions' ? (actual->>'locationId') OR actual->'restrictedSlotIds' ? capacity_id
    THEN RAISE EXCEPTION 'CoverAll actual source qualification or physical restriction differs';END IF;
   elsif actual_owner<>normal_owner then
    if NOT(input->'reliefEligibility' ? ((least((SELECT ord FROM jsonb_array_elements(phases) WITH ORDINALITY y(v,ord) WHERE v=ph),jsonb_array_length(input->'phases'))-1)::text||':'||(r->>'code')||':'||actual_owner)) then raise exception 'Unqualified original relief helper';end if;
    SELECT v INTO STRICT helper FROM jsonb_array_elements(input->'roster') v WHERE v->>'slotId'=actual_owner;
    IF helper#>>'{owner,key}'='TAMMY' AND r->>'code'='CHINA' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'coverage') c WHERE c#>>'{window,start}'<=last_edge AND last_edge<c#>>'{window,end}' AND c#>>'{owners,CHINA}'=actual_owner)
    THEN RAISE EXCEPTION 'CoverAll cannot introduce new Tammy extras';END IF;
   end if;
   owners:=owners||jsonb_build_object(r->>'code',actual_owner);
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(owners))<>23 THEN RAISE EXCEPTION 'All23 areas required after every clockout';END IF;
  coverage:=coverage||jsonb_build_array(jsonb_build_object('window',jsonb_build_object('start',last_edge,'end',edge),'owners',owners,
   'zooWideCoverage',(SELECT count(*)=1 FROM jsonb_array_elements(roster) v WHERE v#>>'{shift,start}'<=last_edge AND v#>>'{shift,end}'>=edge)));
  last_edge:=edge;
 END LOOP;
 SELECT jsonb_agg(id ORDER BY id) INTO actual FROM(SELECT value id FROM jsonb_array_elements(input->'absentPersonIds') UNION ALL SELECT replaced->'personId') a;
 IF o->'coverage' IS DISTINCT FROM coverage OR o->'absentPersonIds' IS DISTINCT FROM actual OR o->'groups' IS DISTINCT FROM input->'groups'
  OR o->'conservedRatingTotal'<>'136'::jsonb OR o->>'status'<>'VALIDATED_UNPUBLISHED_COVERALL_OVERLAY'
  OR o->'formulaApproved' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['solverInvoked','scoringRerun','otherNormalOwnersChanged','weeklyBaselineChanged','publicationEligible','productionWritten','contractorBooked']) k WHERE o->k IS DISTINCT FROM 'false'::jsonb)
 THEN RAISE EXCEPTION 'CoverAll exact mechanical coverage, rating or non-publication facts differ';END IF;
 IF checked_end>normal_end THEN
  IF o->>'schema'<>'custodial.approved-manual-coverall-overlay.v2' OR o->'normalCoverageWindow' IS DISTINCT FROM input->'checkedWindow'
   OR o->'confirmedCoverageExtension' IS DISTINCT FROM jsonb_build_object('beforeNormalMinutes',0,
    'afterNormalMinutes',extract(epoch FROM(checked_end::time-normal_end::time))::integer/60,'ownerSlotId',capacity_id,'purpose','INHERITED_ALERTS_AND_ISSUES_ONLY','employeeShiftExtensions',false)
  THEN RAISE EXCEPTION 'Later actual contractor hours may only inherit ALL areas';END IF;
 ELSIF o->>'schema'<>'custodial.approved-manual-coverall-overlay.v1' OR o?'confirmedCoverageExtension' OR o?'normalCoverageWindow'
 THEN RAISE EXCEPTION 'Unexpected normal-window extension';END IF;
 RETURN jsonb_build_object('choiceDay',d,'retained',retained,'overlay',o,'replacedSlotId',replaced_id);
END $fn$;
DO $copy_current_native_validator$
DECLARE original text;changed text;inverse text;item record;seams jsonb;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_manual_assert_native_projection(uuid,uuid,jsonb)'::regprocedure);
 IF original NOT LIKE '%employmentRevisionVector%' OR original NOT LIKE '%PRE_START_NOT_PTO%' THEN RAISE EXCEPTION 'Main current employment-aware native validator is required before CoverAll adoption';END IF;
 -- Preserve Main's current employment/Source301 guards outside these explicit
 -- bounded CoverAll seams. A missing/changed seam refuses installation.
 SELECT jsonb_agg(jsonb_build_object('n',n,'before',before_text,'after',after_text) ORDER BY n) INTO seams FROM(VALUES
(0,$seam$FUNCTION public.static_weekly_manual_assert_native_projection($seam$,$seam$FUNCTION public.static_weekly_coverall_assert_native_projection($seam$),
(1,$seam$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;$seam$,$seam$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;
 coverall jsonb;choice_day jsonb;capacity_id text;replaced_id text;is_coverall boolean;$seam$),
(2,$seam$if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')$seam$,$seam$if exists(select 1 from jsonb_array_elements(exceptions) e where (e->>'type' not in('pto','daily_absence') or e ? 'window')
  and (e->>'type' not in('cover_all','lunch') or not e ? 'coverAllChoiceId'
   or not public.static_weekly_coverall_exact_fact(p_operation,p_manager,publication,frame,e)))$seam$),
(3,$seam$ select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$seam$,$seam$ -- Add only the exact selected active capacity; inactive templates do not create employees.
 for day_basis in select value from jsonb_array_elements(a->'datedDayBases') where value->>'kind'='COVERALL' loop
  coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
  choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';
  select coalesce(jsonb_agg(r),'[]') into expected_availability from jsonb_array_elements(expected_availability) r
   where not(r->>'serviceDate'=choice_day->>'serviceDate' and r->>'slotId'=capacity_id);
  expected_availability:=expected_availability||jsonb_build_array(public.static_weekly_coverall_capacity_availability(source,choice_day)||jsonb_build_object(
   'serviceDate',choice_day->'serviceDate','incumbentPersonId',null,'incumbentName',null,'ownerKind','CONTRACTOR_CAPACITY','capacityId',capacity_id));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$seam$),
(4,$seam$  if day_changed then
   if jsonb_array_length(absent)$seam$,$seam$  is_coverall:=day_basis->>'kind'='COVERALL';coverall:=null;choice_day:=null;capacity_id:=null;replaced_id:=null;
  if coalesce(is_coverall,false) then
   coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
   choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';replaced_id:=coverall->>'replacedSlotId';
   if jsonb_array_length(absent)<>3 or absent is distinct from day_basis#>'{overlay,absentPersonIds}' then raise exception 'Exact third actual absence required';end if;
   input:=day_basis->'input';plan:=day_basis->'overlay';
   select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
   if coalesce(input->'preStartPersonIds','[]') is distinct from expected then raise exception 'Retained2 pre-start classification differs from current actual employment reads';end if;
   complete_start:=plan#>>'{checkedWindow,start}';complete_end:=plan#>>'{checkedWindow,end}';
  end if;
  if day_changed and not coalesce(is_coverall,false) then
   if jsonb_array_length(absent)$seam$),
(5,$seam$   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';$seam$,$seam$   if coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then owner_config:='{}';
   else select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';end if;$seam$),
(6,$seam$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'$seam$,$seam$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id'
    or (case when coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then
      item->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or item->>'capacity_id' is distinct from capacity_id or item->'owner_person_id' is distinct from 'null'::jsonb
     else item ? 'owner_kind' or item ? 'capacity_id' end)$seam$),
(7,$seam$if day_changed and (window_end>parent#>>'{window,end}' or window_start<case$seam$,$seam$if day_changed and ((window_end>parent#>>'{window,end}' and not(coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id
     and parent#>>'{window,end}'=normal_end and window_end<=choice_day#>>'{shift,end}')) or window_start<case$seam$),
(8,$seam$if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'$seam$,$seam$if day_changed and window_start<complete_start and ((item->'owner_slot_id' is distinct from parent->'ownerSlotId'
     and not(coalesce(is_coverall,false) and parent->>'ownerSlotId'=replaced_id and item->>'owner_slot_id'=capacity_id))$seam$),
(9,$seam$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)$seam$,$seam$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
     and not(coalesce(is_coverall,false) and previous_owner=capacity_id and exists(
      select 1 from jsonb_array_elements(day_basis#>'{input,roster}') retained_owner
       where retained_owner->>'slotId'=replaced_id and retained_owner#>>'{shift,end}'=window_start))$seam$),
(10,$seam$  if day_changed then
   perform public.static_weekly_manual_assert_absence_score$seam$,$seam$  if day_changed and not coalesce(is_coverall,false) then
   perform public.static_weekly_manual_assert_absence_score$seam$)) x(n,before_text,after_text);
 changed:=original;
 FOR item IN SELECT x FROM jsonb_array_elements(seams) x LOOP
  IF length(changed)-length(replace(changed,item.x->>'before',''))<>length(item.x->>'before') THEN RAISE EXCEPTION 'Current native CoverAll seam changed: %',item.x->>'n';END IF;
  changed:=replace(changed,item.x->>'before',item.x->>'after');
 END LOOP;
 inverse:=changed;
 FOR item IN SELECT x FROM jsonb_array_elements(seams) x ORDER BY (x->>'n')::integer DESC LOOP inverse:=replace(inverse,item.x->>'after',item.x->>'before');END LOOP;
 IF inverse<>original THEN RAISE EXCEPTION 'Current native CoverAll whole inverse differs';END IF;EXECUTE changed;
END $copy_current_native_validator$;
-- Copy original readers once, preserving every existing exception and command.
DO $copy_readers$
DECLARE n text;original text;changed text;
BEGIN
 FOREACH n IN ARRAY ARRAY['static_weekly_compiler_exception_set','static_weekly_pending_original_exception_set','static_weekly_pending_exception_set'] LOOP
  original:=pg_get_functiondef(CASE n WHEN 'static_weekly_pending_original_exception_set' THEN 'public.static_weekly_pending_original_exception_set(uuid,date,uuid)'::regprocedure
   WHEN 'static_weekly_pending_exception_set' THEN 'public.static_weekly_pending_exception_set(uuid,uuid,date,date)'::regprocedure
   ELSE 'public.static_weekly_compiler_exception_set(uuid,date)'::regprocedure END);
  changed:=replace(original,'FUNCTION public.'||n||'(','FUNCTION public.coverall_original_'||n||'(');
  IF changed=original OR replace(changed,'FUNCTION public.coverall_original_'||n||'(','FUNCTION public.'||n||'(')<>original THEN RAISE EXCEPTION 'Original reader copy/inverse differs';END IF;
  EXECUTE changed;
 END LOOP;
END $copy_readers$;
CREATE FUNCTION public.static_weekly_coverall_sort_facts(p_facts jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') FROM jsonb_array_elements(p_facts) e
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_compiler_exception_set(p_publication_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_coverall_sort_facts(public.coverall_original_static_weekly_compiler_exception_set(p_publication_id,p_week_start)||public.static_weekly_coverall_effective_facts(p_publication_id,p_week_start,NULL))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_accepted_exception_set(p_publication_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_manual_exception_summary(public.static_weekly_compiler_exception_set(p_publication_id,p_week_start))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_original_exception_set(p_publication_id uuid,p_week_start date,p_operation uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT public.static_weekly_coverall_sort_facts(public.coverall_original_static_weekly_pending_original_exception_set(p_publication_id,p_week_start,p_operation)||public.static_weekly_coverall_effective_facts(p_publication_id,p_week_start,p_operation))
$fn$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid,p_publication uuid,p_week date,p_day date)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;facts jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 -- The original function retains all six-field/date/revision/roster checks.
 facts:=public.coverall_original_static_weekly_pending_exception_set(p_operation,p_publication,p_week,p_day);
 SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO facts FROM jsonb_array_elements(facts) WITH ORDINALITY x(e,n)
 WHERE (e->>'coverAllOperationId'=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id::text ELSE p_operation::text END
  AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date AND (p_day IS NULL OR e->>'serviceDate'=p_day::text)) IS NOT TRUE;
 RETURN public.static_weekly_coverall_sort_facts(facts||public.static_weekly_coverall_pending_facts(p_operation,c.prepared_by_manager_id,p_publication,p_week,p_day));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_exact_fact(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_fact jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_pending_exception_set(p_operation,p_publication,p_frame,NULL)) e
  WHERE e=p_fact AND e ? 'coverAllChoiceId' AND EXISTS(SELECT 1 FROM custodial_coverall.choices q WHERE q.choice_id::text=e->>'coverAllChoiceId'));
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_assert_dispatch(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d WHERE d->>'kind'='COVERALL') THEN
  RETURN public.static_weekly_coverall_assert_native_projection(p_operation,p_manager,p_envelope);
 END IF;
 RETURN public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_preparing_basis(p_manager uuid,p_operation uuid,p_publication uuid,p_frame date,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE basis jsonb;q custodial_coverall.choices%rowtype;d jsonb;r record;retained jsonb:='[]';sources jsonb:='[]';c public.static_weekly_staffing_commands%rowtype;
BEGIN
 basis:=public.static_weekly_manual_period_basis(p_manager,p_publication,p_frame,p_revision,p_operation);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 SELECT * INTO q FROM custodial_coverall.choices WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF FOUND THEN
  FOR d IN SELECT value FROM jsonb_array_elements(q.choice_json->'days') WHERE value->>'publicationId'=p_publication::text AND (value->>'serviceDate')::date BETWEEN p_frame AND p_frame+6 LOOP
   SELECT p.projection_id,p.projection_envelope,s.canonical_source INTO STRICT r FROM public.weekly_schedule_compiled_projections p
    JOIN public.static_weekly_authority_source_documents s ON s.source_id=(d->>'sourceId')::uuid
    WHERE p.projection_id=(d->>'retainedProjectionId')::uuid AND p.publication_id=p_publication AND p.projection_envelope->>'database_projection_identity'=d->>'retainedEnvelopeIdentity';
   retained:=retained||jsonb_build_array(jsonb_build_object('serviceDate',d->'serviceDate','sourceId',d->'sourceId','publicationId',p_publication,
    'projectionId',r.projection_id,'envelopeIdentity',d->'retainedEnvelopeIdentity','dayBasis',(SELECT x FROM jsonb_array_elements(r.projection_envelope#>'{authority,datedDayBases}') x WHERE x->'serviceDate'=d->'serviceDate')));
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources) s WHERE s->'sourceId'=d->'sourceId') THEN
    sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',d->'sourceId','publicationId',p_publication,'source',jsonb_set(r.canonical_source,'{serviceDate}',to_jsonb(p_frame::text),true)));END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('periodBasis',basis,'originalCommand',basis->'originalCommand','choice',q.choice_json,'retainedDays',retained,'normalSources',sources);
END $fn$;
-- Exact current Main-function hooks. These do NOT modify canonical Source301,
-- its memory fix, historical future-Monday bridge or six-field semantic.
DO $native_hooks$
DECLARE original text;changed text;inverse text;item record;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_pending_assert_projection(uuid,uuid,jsonb)',
  'public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope)',
  'public.static_weekly_coverall_assert_dispatch(p_operation,p_manager,p_envelope)'),
 ('public.static_weekly_v10_stage_staffing_command(uuid,jsonb,text,text,jsonb,uuid)',
  ' -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE',
  E' perform public.static_weekly_coverall_stage_companion(p_operation_id,p_manager_id,p_candidates,p_preview_digest);\n -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE'),
 ('public.static_weekly_v11_accept_staffing_command(uuid,text,uuid,uuid)',
  ' perform set_config(''app.static_weekly_staffing_batch_operation'',command.operation_id::text,true);',
  E' perform set_config(''app.static_weekly_staffing_batch_operation'',command.operation_id::text,true);\n perform public.static_weekly_coverall_accept_companion(command.operation_id,p_manager_id,v_revision);')
 ) v(signature,needle,replacement) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.signature));
  IF original IS NULL OR length(original)-length(replace(original,item.needle,''))<>length(item.needle) THEN RAISE EXCEPTION 'Exact native hook changed: %',item.signature;END IF;
  changed:=replace(original,item.needle,item.replacement);inverse:=replace(changed,item.replacement,item.needle);
  IF inverse<>original THEN RAISE EXCEPTION 'Native hook inverse mismatch';END IF;EXECUTE changed;
 END LOOP;
END $native_hooks$;
-- SAME physical checked client/transaction only. The existing deferred complete
-- receipt trigger prohibits COMMIT after begin or stage without finalization.
CREATE TABLE custodial_coverall.activation_progress(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_operations(operation_id),
 owner_xid xid8 NOT NULL,backend_pid integer NOT NULL,manager_id uuid NOT NULL,credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 source_id uuid NOT NULL,publication_id uuid NOT NULL,version_id uuid NOT NULL,frame_start date NOT NULL,authority_revision bigint NOT NULL,
 normal_result jsonb NOT NULL,basis_json jsonb NOT NULL,basis_digest text NOT NULL);
CREATE TABLE custodial_coverall.initial_operational_stages(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.activation_progress(operation_id),
 envelope_json jsonb NOT NULL,lunch_json jsonb NOT NULL,candidate_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $initial_private_tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['activation_progress','initial_operational_stages'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',t);
  EXECUTE format('alter table custodial_coverall.%I force row level security',t);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',t);
 END LOOP;
END $initial_private_tables$;
CREATE FUNCTION public.static_weekly_coverall_record_activation_begin(p_operation uuid,p_manager uuid,p_credential uuid,p_device text,p_access text,p_normal_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a record;projection record;revision bigint;basis jsonb;body jsonb;
BEGIN
 SELECT o.*,p.source_id,p.service_date INTO STRICT a FROM custodial_coverall.activation_operations o
 JOIN custodial_coverall.activation_packets p USING(packet_id) WHERE o.operation_id=p_operation AND o.manager_id=p_manager AND o.owner_xid=pg_current_xact_id();
 SELECT p.publication_id,p.version_id,p.week_start,p.projection_id INTO STRICT projection FROM public.weekly_schedule_compiled_projections p
 JOIN public.weekly_schedule_versions v USING(version_id)
 WHERE v.authority_source_id=a.source_id AND p.week_start=a.service_date AND p.xmin=pg_current_xact_id()::text::xid;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 basis:=public.static_weekly_manual_period_basis(p_manager,projection.publication_id,a.service_date,revision,NULL);
 IF basis->>'sourceId'<>a.source_id::text OR basis->>'frameStart'<>a.service_date::text
  OR jsonb_array_length(basis->'employmentByDate')<>7 OR jsonb_array_length(basis->'employmentRevisionVector')<>14
 THEN RAISE EXCEPTION 'Main current employment-aware native basis (7reads/14bindings) is required';END IF;
 INSERT INTO custodial_coverall.activation_progress VALUES(p_operation,pg_current_xact_id(),pg_backend_pid(),p_manager,p_credential,p_device,p_access,
  a.source_id,projection.publication_id,projection.version_id,a.service_date,revision,p_normal_result,basis,basis->>'basisDigest');
 body:=jsonb_build_object('schema','custodial.coverall-initial-uncommitted.v1','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION','operationId',p_operation,
  'managerId',p_manager,'backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text,'sourceId',a.source_id,
  'publicationId',projection.publication_id,'versionId',projection.version_id,'frameStart',a.service_date,'frameEnd',a.service_date+6,
  'authorityRevision',revision,'basis',basis,'normalBaselineResult',p_normal_result,'normalBaselineIsNotActualCoverage',true,'committed',false,'accepted',false);
 RETURN body;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_initial_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_progress%rowtype;s custodial_coverall.initial_operational_stages%rowtype;fresh jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.activation_progress WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid()
  OR a.authority_revision<>(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
 THEN RAISE EXCEPTION 'Initial operational candidate must stay on its original physical transaction/revision';END IF;
 PERFORM public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 fresh:=public.static_weekly_manual_period_basis(p_manager,a.publication_id,a.frame_start,a.authority_revision,NULL);
 IF fresh IS DISTINCT FROM a.basis_json OR fresh->>'basisDigest'<>a.basis_digest
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Initial normal Source/canonical exceptions/7employment reads or14bindings changed';END IF;
 SELECT * INTO s FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 RETURN jsonb_build_object('schema','custodial.initial-employment-native-sql-context.v1','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
  'operationId',p_operation,'managerId',p_manager,'transactionId',a.owner_xid::text,'backendPid',a.backend_pid,
  'publicationId',a.publication_id,'versionId',a.version_id,'sourceId',a.source_id,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,
  'authorityRevision',a.authority_revision,'basis',fresh,'stagedEnvelope',s.envelope_json,'stagedLunch',s.lunch_json,'candidateDigest',s.candidate_digest);
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_initial_assert_payload(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 IF ctx->'stagedEnvelope' IS DISTINCT FROM p_envelope OR ctx->>'candidateDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(
  jsonb_build_object('envelope',p_envelope,'lunch',ctx->'stagedLunch'))
 THEN RAISE EXCEPTION 'Exact staged original INITIAL_EMPLOYMENT_OPERATIONALIZATION data required';END IF;
 -- One explicit Main factoring seam; NOT a boolean, fake staffing command,
 -- optimizer attestation or I1 receipt. Main's entry must derive its context
 -- by calling initial_context above and preserve the real native checks.
 IF to_regprocedure('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Main factored initial-employment native guard not installed';END IF;
 EXECUTE 'select public.static_weekly_manual_assert_initial_employment_projection($1,$2,$3,$4)'
 INTO STRICT proof USING p_operation,p_manager,p_envelope,ctx->'stagedLunch';
 IF proof->'projection_assignments' IS DISTINCT FROM p_envelope->'assignments' OR jsonb_typeof(proof->'assignment_links')<>'object'
 THEN RAISE EXCEPTION 'Factored native guard must return complete checked assignment lineage';END IF;
 PERFORM public.static_weekly_manual_assert_native_lunch(NULL,ctx->'stagedLunch',p_envelope,(ctx->>'publicationId')::uuid,(ctx->>'frameStart')::date);
 RETURN proof;
END $fn$;
CREATE FUNCTION public.static_weekly_coverall_stage_initial_operational(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior custodial_coverall.initial_operational_stages%rowtype;fingerprint text;proof jsonb;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 IF pg_column_size(p_envelope)>16777216 OR pg_column_size(p_lunch)>16777216 OR p_envelope IS NULL OR p_lunch IS NULL
 THEN RAISE EXCEPTION 'Bounded actual native candidate and full lunch required';END IF;
 fingerprint:=public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch));
 SELECT * INTO prior FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.envelope_json IS DISTINCT FROM p_envelope OR prior.lunch_json IS DISTINCT FROM p_lunch OR prior.candidate_digest<>fingerprint THEN RAISE EXCEPTION 'Immutable initial native candidate conflict';END IF;
 ELSE INSERT INTO custodial_coverall.initial_operational_stages(operation_id,envelope_json,lunch_json,candidate_digest) VALUES(p_operation,p_envelope,p_lunch,fingerprint);END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,p_envelope);
 RETURN jsonb_build_object('state','STAGED_UNCOMMITTED','operationId',p_operation,'candidateDigest',fingerprint,'committed',false);
END $fn$;
-- Mature native storage copy: all relational/owner/receipt/exception guards
-- remain. Only the exact original pending-command validation seam is replaced
-- by the immutable INITIAL-employment scope guard. No staff fact is synthesized.
DO $initial_sink_copy$
DECLARE original text;changed text;needle text;replacement text;inverse text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_pending_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 changed:=replace(original,'FUNCTION public.static_weekly_pending_projection_sink(','FUNCTION public.static_weekly_coverall_initial_projection_sink(');
 needle:=$old$v_pending_validation:=public.static_weekly_pending_assert_projection((p_assignments#>>'{semantic_snapshot,originalCommand,operationId}')::uuid,p_actor_manager_id,p_assignments); IF (v_pending_validation->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending sink requires actual original acceptance facts';END IF;$old$;
 replacement:=$new$v_pending_validation:=public.static_weekly_coverall_initial_assert_payload((p_assignments#>>'{semantic_snapshot,initialActivation,operationId}')::uuid,p_actor_manager_id,p_assignments);$new$;
 IF changed=original OR length(changed)-length(replace(changed,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact private native sink factoring seam changed';END IF;
 changed:=replace(changed,needle,replacement);inverse:=replace(replace(changed,replacement,needle),'FUNCTION public.static_weekly_coverall_initial_projection_sink(','FUNCTION public.static_weekly_pending_projection_sink(');
 IF inverse<>original THEN RAISE EXCEPTION 'Initial operational native sink whole inverse differs';END IF;EXECUTE changed;
END $initial_sink_copy$;
CREATE FUNCTION public.static_weekly_coverall_finalize_initial_operational(p_operation uuid,p_manager uuid,p_candidate_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_progress%rowtype;s custodial_coverall.initial_operational_stages%rowtype;ctx jsonb;proof jsonb;stored jsonb;lunch jsonb;receipt jsonb;projection uuid;actor jsonb;revision bigint;
BEGIN
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT a FROM custodial_coverall.activation_progress WHERE operation_id=p_operation;
 SELECT * INTO STRICT s FROM custodial_coverall.initial_operational_stages WHERE operation_id=p_operation;
 IF s.candidate_digest IS DISTINCT FROM p_candidate_digest THEN RAISE EXCEPTION 'Original staged initial candidate identity required';END IF;
 proof:=public.static_weekly_coverall_initial_assert_payload(p_operation,p_manager,s.envelope_json);
 actor:=public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 IF s.envelope_json#>>'{semantic_snapshot,initialActivation,operationId}' IS DISTINCT FROM p_operation::text
  OR s.envelope_json#>'{authority,employmentRevisionVector}' IS DISTINCT FROM a.basis_json->'employmentRevisionVector'
 THEN RAISE EXCEPTION 'Original initial operation and all14 actual employment revisions must remain bound';END IF;
 stored:=public.static_weekly_coverall_initial_projection_sink(a.publication_id,a.frame_start,
  public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(a.publication_id,a.frame_start)),
  s.envelope_json->>'compiler_version',s.envelope_json->'objective',s.envelope_json->'metrics',s.envelope_json->>'replay_digest',
  s.envelope_json,a.authority_revision,p_manager,actor->>'manager_name','coverall-initial:'||p_operation);
 projection:=(stored#>>'{data,projection_id}')::uuid;
 IF projection IS NULL THEN RAISE EXCEPTION 'Native projection writer did not return actual projection ID';END IF;
 lunch:=public.static_weekly_v8_materialize_lunch_document(projection,s.lunch_json,p_manager);
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  WHERE p.projection_id=projection AND p.publication_id=a.publication_id AND p.projection_envelope=s.envelope_json
   AND l.document_json=s.lunch_json AND l.document_identity=s.lunch_json->>'document_identity')
 THEN RAISE EXCEPTION 'Actual same-transaction operational projection/full lunch missing';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-coverall-source-confirmation.v2','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
  'status','PERSISTED_CURRENT','operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,
  'versionId',a.version_id,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',revision,
  'normalBaselineResult',a.normal_result,'operationalProjectionResult',stored,'lunchResult',lunch,'projectionId',projection,
  'employmentRevisionVector',a.basis_json->'employmentRevisionVector','actualPositions',30,'originalHistoryPositions',22,
  'newNonemployeeCapacityPositions',8,'newEmployeesCreated',false,'weeklyBaselineChanged',false,'contractorBooked',false,
  'candidateDigest',s.candidate_digest,'samePhysicalTransaction',true);
 INSERT INTO custodial_coverall.activation_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_coverall_activation_confirmation(p_manager uuid,p_operation uuid,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE r jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT receipt_json INTO r FROM custodial_coverall.activation_receipts r JOIN custodial_coverall.activation_operations o USING(operation_id)
 WHERE o.manager_id=p_manager AND o.operation_id=p_operation;RETURN r;
END $fn$;
DO $typed_lunch_policy$
DECLARE original text;changed text;needle text:='jsonb_array_elements(d#>''{plan,lunchPlans}'')';replacement text:='jsonb_array_elements(case when d->>''kind''=''COVERALL'' then d#>''{overlay,lunchPlans}'' else d#>''{plan,lunchPlans}'' end)';
BEGIN
 original:=pg_get_functiondef('public.static_weekly_manual_native_lunch_policy(jsonb)'::regprocedure);
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact selected typed lunch policy seam changed';END IF;
 changed:=replace(original,needle,replacement);IF replace(changed,replacement,needle)<>original THEN RAISE EXCEPTION 'Typed lunch policy inverse mismatch';END IF;EXECUTE changed;
END $typed_lunch_policy$;
CREATE FUNCTION public.static_weekly_activate_coverall_source(p_manager uuid,p_packet uuid,p_operation uuid,p_revision bigint,p_preview text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 RAISE EXCEPTION USING ERRCODE='0A000',MESSAGE='Use the original checked transaction begin/stage/finalize path; no baseline-only activation';
END $fn$;
-- No SQL clients receive table DML or direct internal helper capabilities.
DO $new_function_acls$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY['coverall_original_static_weekly_compiler_exception_set','coverall_original_static_weekly_pending_exception_set','coverall_original_static_weekly_pending_original_exception_set','static_weekly_activate_coverall_source','static_weekly_begin_coverall_activation','static_weekly_coverall_accept_companion','static_weekly_coverall_activate_source301','static_weekly_coverall_activation_basis','static_weekly_coverall_activation_filtered_roster','static_weekly_coverall_assert_activation_data','static_weekly_coverall_assert_dispatch','static_weekly_coverall_assert_native_projection','static_weekly_coverall_assert_retained_day','static_weekly_coverall_bind_actor','static_weekly_coverall_capacity_availability','static_weekly_coverall_day_facts','static_weekly_coverall_effective_facts','static_weekly_coverall_exact_fact','static_weekly_coverall_finalize_initial_operational','static_weekly_coverall_initial_assert_payload','static_weekly_coverall_initial_context','static_weekly_coverall_initial_projection_sink','static_weekly_coverall_pending_facts','static_weekly_coverall_preparing_basis','static_weekly_coverall_record_activation_begin','static_weekly_coverall_register_template','static_weekly_coverall_require_activation_receipt','static_weekly_coverall_sort_facts','static_weekly_coverall_stage_companion','static_weekly_coverall_stage_initial_operational','static_weekly_coverall_validate_choice_day','static_weekly_prepare_coverall_activation','static_weekly_prepare_coverall_choice','static_weekly_read_coverall_activation_confirmation']) LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator',f.signature);
 END LOOP;
END $new_function_acls$;
-- Existing public reader ACLs remain literal under CREATE OR REPLACE.
GRANT EXECUTE ON FUNCTION public.static_weekly_prepare_coverall_activation(jsonb) TO static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.static_weekly_coverall_preparing_basis(uuid,uuid,uuid,date,bigint),
 public.static_weekly_prepare_coverall_choice(jsonb,uuid,text,text),public.static_weekly_coverall_bind_actor(uuid,uuid,uuid,text,text),
 public.static_weekly_begin_coverall_activation(uuid,uuid,uuid,bigint,text,uuid,text,text),
 public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb),public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text),
 public.static_weekly_read_coverall_activation_confirmation(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;
-- Main must enroll exact tables/functions/ACLs/mutation fences in its existing
-- canonical capture/canary transaction before adoption. This file is a proposal.
CREATE TABLE custodial_coverall.activation_request_aliases(
 manager_id uuid NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 120),
 operation_id uuid UNIQUE NOT NULL REFERENCES custodial_coverall.activation_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 request_json jsonb NOT NULL,request_digest text NOT NULL,PRIMARY KEY(manager_id,idempotency_key));
ALTER TABLE custodial_coverall.activation_request_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_coverall.activation_request_aliases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON custodial_coverall.activation_request_aliases FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON custodial_coverall.activation_request_aliases FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
ALTER TABLE custodial_coverall.activation_request_aliases ENABLE ALWAYS TRIGGER immutable;
CREATE FUNCTION public.static_weekly_read_coverall_activation_basis(p_manager uuid,p_packet uuid,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE packet record;snapshot jsonb;employment jsonb:='[]';vector jsonb;d date;body jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT packet_id,source_id,template_id,manager_id,service_date,expected_revision,roster_digest,preview_digest,packet_fingerprint,source_digest INTO packet
 FROM custodial_coverall.activation_packets WHERE packet_id=p_packet;
 IF NOT FOUND THEN RETURN NULL;END IF;
 snapshot:=public.static_weekly_manual_roster_snapshot(public.sch_service_date(statement_timestamp()));
 IF packet.manager_id<>p_manager OR packet.expected_revision<>p_revision OR p_revision::text<>snapshot->>'authorityRevision'
  OR packet.service_date::text<>snapshot->>'serviceDate' OR packet.roster_digest<>public.static_weekly_digest_jsonb(snapshot)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original current typed activation packet/manager/date/roster/revision changed';END IF;
 FOR d IN SELECT generate_series(packet.service_date,packet.service_date+6,'1 day')::date LOOP
  employment:=employment||jsonb_build_array(custodial_employment.native_read(d,p_revision,p_manager));END LOOP;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',day->'serviceDate','employeeId',e->'employeeId','employmentRevision',e->'employmentRevision','requestId',e#>'{command,requestId}') ORDER BY day->>'serviceDate',e->>'employeeId')
 INTO vector FROM jsonb_array_elements(employment) days(day) CROSS JOIN LATERAL jsonb_array_elements(day->'employees') employees(e);
 IF jsonb_array_length(vector)<>14 THEN RAISE EXCEPTION 'Actual fourteen employment bindings required';END IF;
 body:=jsonb_build_object('schema','custodial.approved-manual-coverall-activation-preview-basis.v2','managerId',p_manager,'packetId',p_packet,
  'sourceId',packet.source_id,'templateId',packet.template_id,'serviceDate',packet.service_date,'windowEnd',packet.service_date+6,'expectedRevision',p_revision,
  'packetPreviewDigest',packet.preview_digest,'packetFingerprint',packet.packet_fingerprint,'sourceDigest',packet.source_digest,'employmentRevisionVector',vector,
  'currentPositions',22,'additionalCapacityPositions',8,'prospectivePositions',30,'newEmployees',0);
 RETURN body||jsonb_build_object('previewDigest',public.static_weekly_digest_jsonb(body),'normalPatternSolverInvoked',false,'operationalAdjustmentPending',true,'published',false);
END $fn$;
CREATE FUNCTION public.static_weekly_read_coverall_activation_request(p_manager uuid,p_key text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.activation_request_aliases%rowtype;receipt jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT * INTO a FROM custodial_coverall.activation_request_aliases WHERE manager_id=p_manager AND idempotency_key=p_key;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.activation_receipts WHERE operation_id=a.operation_id;
 IF a.request_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(a.request_json) OR receipt->>'operationId'<>a.operation_id::text OR receipt->>'managerId'<>p_manager::text
 THEN RAISE EXCEPTION 'Original activation request/receipt integrity changed';END IF;
 RETURN jsonb_build_object('request',a.request_json,'receipt',receipt,'operationId',a.operation_id);
END $fn$;
CREATE FUNCTION public.static_weekly_bind_coverall_activation_request(p_manager uuid,p_operation uuid,p_key text,p_packet uuid,p_revision bigint,p_preview text,p_credential uuid,p_device text,p_access text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE request jsonb;prior custodial_coverall.activation_request_aliases%rowtype;preview jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'write');
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_operation IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 120 OR p_key<>btrim(p_key)
 THEN RAISE EXCEPTION 'Original activation operation/key required';END IF;
 request:=jsonb_build_object('managerId',p_manager,'packetId',p_packet,'operationId',p_operation,'expectedRevision',p_revision,'previewDigest',p_preview,'idempotencyKey',p_key);
 SELECT * INTO prior FROM custodial_coverall.activation_request_aliases WHERE (manager_id=p_manager AND idempotency_key=p_key) OR operation_id=p_operation;
 IF FOUND THEN
  IF prior.manager_id<>p_manager OR prior.idempotency_key<>p_key OR prior.request_json IS DISTINCT FROM request THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original activation operation/key semantic conflict';END IF;RETURN;
 END IF;
 preview:=public.static_weekly_read_coverall_activation_basis(p_manager,p_packet,p_revision);
 IF preview IS NULL OR preview->>'previewDigest' IS DISTINCT FROM p_preview THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Typed activation/employment preview changed';END IF;
 INSERT INTO custodial_coverall.activation_request_aliases VALUES(p_manager,p_key,p_operation,request,public.static_weekly_digest_jsonb(request));
END $fn$;
CREATE FUNCTION public.static_weekly_list_coverall_activation_choices(p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE snapshot jsonb;day date;v_authority_revision bigint;choices jsonb;active jsonb;authority jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 day:=public.sch_service_date(statement_timestamp());snapshot:=public.static_weekly_manual_roster_snapshot(day);v_authority_revision:=(snapshot->>'authorityRevision')::bigint;
 SELECT coalesce(jsonb_agg(jsonb_build_object('packetId',p.packet_id,'label','Owner-approved seven-day normal schedule with source-bound CoverAll capacity',
  'serviceDate',p.service_date,'windowEnd',p.service_date+6,'expectedRevision',p.expected_revision,'activationEligible',true) ORDER BY p.packet_id),'[]') INTO choices
 FROM custodial_coverall.activation_packets p WHERE p.manager_id=p_manager AND p.service_date=day AND p.expected_revision=v_authority_revision
  AND p.roster_digest=public.static_weekly_digest_jsonb(snapshot) AND jsonb_array_length(snapshot->'rosterSlots')=22
  AND NOT EXISTS(SELECT 1 FROM custodial_coverall.activation_operations o WHERE o.packet_id=p.packet_id);
 SELECT to_jsonb(a) INTO authority FROM public.static_weekly_v6_schedule_authority_state(day) a;
 SELECT jsonb_build_object('sourceId',v.authority_source_id,'publicationId',pub.publication_id,
  'projectionId',CASE WHEN authority->>'publication_id'=pub.publication_id::text THEN authority->'projection_id' ELSE 'null'::jsonb END,
  'authorityRevision',v_authority_revision,'projectionStatus',authority->>'projection_status','normalSourceLocked',true,
  'initialOperationId',o.operation_id,'initialProjectionId',r.receipt_json->'projectionId') INTO active
 FROM custodial_coverall.activation_operations o JOIN custodial_coverall.activation_packets p USING(packet_id)
 JOIN custodial_coverall.activation_receipts r USING(operation_id)
 JOIN public.weekly_schedule_versions v ON v.authority_source_id=p.source_id
 JOIN public.weekly_schedule_publications pub USING(version_id)
 WHERE v.version_id=public.static_weekly_effective_version(day) AND r.receipt_json->>'schema'='custodial.approved-manual-coverall-source-confirmation.v2';
 RETURN jsonb_build_object('schema','custodial.approved-manual-activation-options.v2','serviceDate',day,'authorityRevision',v_authority_revision,'choices',choices,'active',active);
END $fn$;
-- Reversible two literal seams in the already-installed begin/finalize; all
-- Source301 copies, normal baseline, eight-slot registration and sinks remain.
DO $cp_companion_hooks$
DECLARE original text;changed text;inverse text;item record;
BEGIN
 FOR item IN SELECT * FROM(VALUES
 ('public.static_weekly_begin_coverall_activation(uuid,uuid,uuid,bigint,text,uuid,text,text)',
  'packet.preview_digest<>p_preview',
  'p_preview IS DISTINCT FROM (public.static_weekly_read_coverall_activation_basis(p_manager,p_packet,p_revision)->>''previewDigest'')'),
 ('public.static_weekly_coverall_finalize_initial_operational(uuid,uuid,text)',
  '''candidateDigest'',s.candidate_digest,''samePhysicalTransaction'',true',
  '''candidateDigest'',s.candidate_digest,''revision'',revision,''lunchDocumentIdentity'',s.lunch_json->>''document_identity'',''normalPatternSolverInvoked'',false,''operationalSelectionSolverInvoked'',s.envelope_json#>''{receipt,selectionSolverInvoked}'',''samePhysicalTransaction'',true')
 ) v(signature,needle,replacement) LOOP
  original:=pg_get_functiondef(to_regprocedure(item.signature));
  IF original IS NULL OR length(original)-length(replace(original,item.needle,''))<>length(item.needle) THEN RAISE EXCEPTION 'Exact installed CP companion predecessor changed: %',item.signature;END IF;
  changed:=replace(original,item.needle,item.replacement);inverse:=replace(changed,item.replacement,item.needle);
  IF inverse<>original THEN RAISE EXCEPTION 'CP companion whole inverse mismatch';END IF;EXECUTE changed;
 END LOOP;
END $cp_companion_hooks$;
REVOKE ALL ON FUNCTION public.static_weekly_read_coverall_activation_basis(uuid,uuid,bigint),public.static_weekly_read_coverall_activation_request(uuid,text,uuid,text,text),
 public.static_weekly_bind_coverall_activation_request(uuid,uuid,text,uuid,bigint,text,uuid,text,text),public.static_weekly_list_coverall_activation_choices(uuid)
 FROM public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_coverall_activation_basis(uuid,uuid,bigint),public.static_weekly_read_coverall_activation_request(uuid,text,uuid,text,text),
 public.static_weekly_bind_coverall_activation_request(uuid,uuid,text,uuid,bigint,text,uuid,text,text),public.static_weekly_list_coverall_activation_choices(uuid) TO static_weekly_control_plane;
-- Main enrolls these new companion objects/ACLs/fences in its canonical capture.


-- COMPONENT coverall_management SHA256 c4f75447efb433ca2258c8aac61795ce38e6d38d5f34b8a9f9f81182f3348b8d
-- Main implementation component. Apply only after the native period and typed
-- CoverAll workflow components. This exposes no private table or secret.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';

CREATE FUNCTION public.static_weekly_read_coverall_choice_summary(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;q custodial_coverall.choices%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.static_weekly_v3_manager_actor(p_manager);
 SELECT * INTO c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF NOT FOUND OR c.prepared_by_manager_id IS DISTINCT FROM p_manager THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original staffing preparer required';
 END IF;
 SELECT * INTO q FROM custodial_coverall.choices
 WHERE operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('choiceId',q.choice_id,'choiceDigest',q.choice_digest,
  'operationId',q.operation_id,'semanticDigest',q.semantic_digest,'expectedRevision',q.expected_revision);
END $fn$;

CREATE FUNCTION public.static_weekly_read_coverall_manager_basis(p_manager uuid,p_operation uuid,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;command jsonb;choice jsonb;
 basis jsonb;frame_row jsonb;day_basis jsonb;r record;source_id uuid;publication uuid;frame date;service date;
 retained jsonb:='[]';sources jsonb:='[]';periods jsonb:='[]';revision bigint;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'manage_coverall');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 IF c.prepared_by_manager_id IS DISTINCT FROM p_manager THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original staffing preparer required';
 END IF;
 command:=public.static_weekly_v10_read_staffing_command(p_operation,p_manager);
 SELECT q.choice_json INTO choice FROM custodial_coverall.choices q
 WHERE q.operation_id=CASE WHEN c.command_kind='cancel_absence' THEN c.target_absence_id ELSE p_operation END;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 -- History and UNKNOWN reconciliation never grant permission to prepare again.
 IF c.state<>'PREPARING' OR c.command_kind<>'absence' THEN
  RETURN jsonb_build_object('schema','custodial.approved-manual-coverall-manager-basis.v1',
   'managerId',p_manager,'operationId',p_operation,'state',c.state,'command',command,
   'originalCommand',NULL,'choice',choice,'retainedDays',retained,'normalSources',sources,
   'authorityRevision',revision,'eligible',false);
 END IF;
 IF c.expected_revision IS DISTINCT FROM revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original third-absence revision changed';
 END IF;
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 FOR frame_row IN SELECT value FROM jsonb_array_elements(
  public.static_weekly_staffing_period_frames(p_operation,p_manager)->'frames') LOOP
  service:=(frame_row->>'serviceDate')::date;frame:=(frame_row->>'frameStart')::date;
  SELECT p.publication_id,v.authority_source_id INTO STRICT publication,source_id
  FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
  WHERE v.version_id=public.static_weekly_effective_version(service);
  SELECT value INTO basis FROM jsonb_array_elements(periods)
  WHERE value->>'publicationId'=publication::text AND value->>'frameStart'=frame::text;
  IF NOT FOUND THEN
   basis:=public.static_weekly_manual_period_basis(p_manager,publication,frame,revision,p_operation);
   periods:=periods||jsonb_build_array(basis);
  END IF;
  SELECT value INTO day_basis FROM jsonb_array_elements(basis->'priorDayBases')
  WHERE value->>'serviceDate'=service::text;
  IF NOT FOUND OR day_basis->>'kind'<>'ABSENCE'
   OR jsonb_array_length(day_basis#>'{input,absentPersonIds}')<>2
   OR (day_basis#>'{input,absentPersonIds}')?(c.semantic_body->>'employeeId')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(day_basis#>'{input,roster}') x
    WHERE x->>'personId'=c.semantic_body->>'employeeId') THEN CONTINUE;END IF;
  SELECT p.projection_id,p.projection_envelope INTO STRICT r
  FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  WHERE p.projection_id=(basis#>>'{priorProjection,projectionId}')::uuid
   AND p.publication_id=publication AND p.week_start=frame AND p.week_end=frame+6
   AND p.projection_envelope->>'database_projection_identity'=
    public.static_weekly_digest_jsonb(p.projection_envelope-'database_projection_identity');
  IF day_basis#>>'{plan,planDigest}' IS DISTINCT FROM
    public.static_weekly_digest_jsonb((day_basis->'plan')-'planDigest')
   OR day_basis#>>'{input,sourceDigest}' IS DISTINCT FROM public.static_weekly_digest_jsonb(basis->'normalSource') THEN
   RAISE EXCEPTION 'Retained two-absence source or plan identity changed';
  END IF;
  retained:=retained||jsonb_build_array(jsonb_build_object('serviceDate',service::text,
   'sourceId',source_id,'publicationId',publication,'projectionId',r.projection_id,
   'envelopeIdentity',r.projection_envelope->'database_projection_identity','dayBasis',day_basis));
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(sources) x
   WHERE x->>'sourceId'=source_id::text AND x->>'publicationId'=publication::text
    AND x#>>'{source,serviceDate}'=frame::text) THEN
   sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',source_id,
    'publicationId',publication,'source',basis->'normalSource'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('schema','custodial.approved-manual-coverall-manager-basis.v1',
  'managerId',p_manager,'operationId',p_operation,'state',c.state,'command',command,
  'originalCommand',ctx->'originalCommand','choice',choice,'retainedDays',retained,
  'normalSources',sources,'authorityRevision',revision,'eligible',jsonb_array_length(retained)>0);
END $fn$;

REVOKE ALL ON FUNCTION public.static_weekly_read_coverall_choice_summary(uuid,uuid),
 public.static_weekly_read_coverall_manager_basis(uuid,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader,static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_coverall_choice_summary(uuid,uuid),
 public.static_weekly_read_coverall_manager_basis(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;


-- COMPONENT initial_employment_native_guard SHA256 cc0bd5b3f4b5132d7a1183b874c6c992662c1e972da86c4acd170682336e1696
-- Main initial operationalization guard; native feasibility remains exact. Not a canonical migration.

create or replace function public.static_weekly_manual_assert_initial_employment_projection(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare ctx jsonb;basis jsonb;snapshot jsonb:=p_envelope->'semantic_snapshot';a jsonb:=p_envelope->'authority';source jsonb;
 frame date;publication uuid;version uuid;expected_dates jsonb;day date;dow integer;normal_day jsonb;day_basis jsonb;plan jsonb;
 item jsonb;w jsonb;parent jsonb;link jsonb;availability jsonb;expected jsonb;actual jsonb;slot jsonb;person jsonb;
 base jsonb;exceptions jsonb;summary jsonb;links jsonb:='{}';expected_availability jsonb:='[]';absent jsonb;
 complete_start text;complete_end text;normal_start text;normal_end text;previous_owner text;previous_end text;
 row_owner text;owner_config jsonb;code text;normal_changed boolean;day_changed boolean;inherited boolean;
 input jsonb;phase jsonb;previous_phase jsonb;slice jsonb;loan jsonb;owners jsonb;points jsonb;anchors jsonb;policy jsonb;
 p_loss numeric;l_loss numeric;n integer;minutes numeric;total_minutes numeric;weighted_p numeric;weighted_l numeric;actual_effort numeric;
 count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;employment_employee jsonb;pre_start jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_coverall_initial_context(p_operation,p_manager);
 if ctx->>'schema' is distinct from 'custodial.initial-employment-native-sql-context.v1'
  or ctx->>'kind' is distinct from 'INITIAL_EMPLOYMENT_OPERATIONALIZATION'
  or ctx->>'operationId' is distinct from p_operation::text or ctx->>'managerId' is distinct from p_manager::text
  or ctx->'stagedEnvelope' is distinct from p_envelope or ctx->'stagedLunch' is distinct from p_lunch
  or ctx->>'candidateDigest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch))
 then raise exception 'Exact original staged initial employment scope required';end if;
 perform public.static_weekly_assert_exact_object(p_envelope,
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'manual native projection');
 perform public.static_weekly_assert_exact_object(snapshot,
  array['schema','initialActivation','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],
  array['schema','initialActivation','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],'manual native original snapshot');
 if snapshot->>'schema' is distinct from 'custodial.approved-manual-initial-employment-snapshot.v1'
  or snapshot->'initialActivation' is distinct from jsonb_build_object('kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION',
   'operationId',p_operation,'managerId',p_manager,'sourceId',ctx->'sourceId','publicationId',ctx->'publicationId','versionId',ctx->'versionId',
   'frameStart',ctx->'frameStart','frameEnd',ctx->'frameEnd','authorityRevision',ctx->'authorityRevision')
  or coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(snapshot->>'nativeBasisDigest','')!~'^[0-9a-f]{64}$'
 then raise exception 'Manual native original command differs';end if;
 frame:=(snapshot->>'weekStart')::date;publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 basis:=ctx->'basis';
 source:=basis->'normalSource';version:=(basis->>'versionId')::uuid;exceptions:=basis->'preparedExceptions';summary:=basis->'preparedSummary';
 if frame::text is distinct from basis->>'frameStart' or snapshot->'originalSource' is distinct from basis->'originalSource'
  or snapshot->'generation' is distinct from basis->'generation' or snapshot->'catalogEntryDigest' is distinct from basis->'catalogEntryDigest'
  or snapshot->'nativeBasisDigest' is distinct from basis->'basisDigest'
 then raise exception 'Manual native current Source or preparation basis changed';end if;
 if frame::text is distinct from ctx->>'frameStart' or publication::text is distinct from ctx->>'publicationId'
  or (frame+6)::text is distinct from ctx->>'frameEnd' then raise exception 'Initial native actual publication/frame changed';end if;
 select jsonb_agg(d::date::text order by d) into expected_dates from generate_series(frame,frame+6,'1 day') d;
 if snapshot->'scopeDates' is distinct from expected_dates or a->'compilerInput' is distinct from source
  or a->>'schema' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
  or a->>'sourceDigest' is distinct from basis->>'normalSourceDigest'
  or a->>'sourcePublicationId' is distinct from publication::text or a->>'sourceVersionId' is distinct from version::text
  or a->>'frameStart' is distinct from frame::text or a->>'frameEnd' is distinct from (frame+6)::text
  or a->'normalSourceChanged' is distinct from 'false'::jsonb or a->'objectiveSolverRerun' is distinct from 'false'::jsonb
  or a->>'acceptedExceptionsDigest' is distinct from public.static_weekly_digest_jsonb(exceptions)
  or a->'employmentRevisionVector' is distinct from basis->'employmentRevisionVector'
  or a->>'formulaObjectiveDigest' is distinct from '7796e95573b389d8d77fc80502d4f6f7f1b54a5155327f9a7f1eb42a7137f531'
  or p_envelope->'applied_exceptions' is distinct from summary
  or p_envelope->'adapter' is distinct from '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
  or p_envelope->>'compiler_version' is distinct from 'approved-manual-period-v1'
  or p_envelope->>'service_date' is distinct from frame::text or p_envelope->>'week_start' is distinct from frame::text
  or p_envelope->>'week_end' is distinct from (frame+6)::text
  or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(a)
  or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  or p_envelope->'objective' is distinct from jsonb_build_object('contract','OWNER_APPROVED_MANUAL_DATED_75_25_V2',
   'formulaObjectiveDigest',a->'formulaObjectiveDigest','proximityPercent',75,'workloadPercent',25,'normalDaysOptimized',false)
  or p_envelope->'metrics' is distinct from jsonb_build_object('hardConstraints',a->'hardConstraintCount','violations',0)
  or p_envelope#>>'{receipt,schema}' is distinct from 'custodial.approved-manual-native-feasibility-data.v1'
  or p_envelope#>'{receipt,hardConstraintCount}' is distinct from a->'hardConstraintCount'
  or p_envelope#>'{receipt,hardConstraintDigest}' is distinct from a->'hardConstraintDigest'
  or p_envelope#>'{receipt,fixedWitnessDigest}' is distinct from a->'fixedWitnessDigest'
 then raise exception 'Manual native envelope identity or approved formula differs';end if;
 if jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_array_length(p_envelope->'assignments') not between 1 and 4096
  or jsonb_typeof(a->'datedDayBases') is distinct from 'array' or jsonb_array_length(a->'datedDayBases')>7
  or jsonb_typeof(a->'parentLinks') is distinct from 'array' or jsonb_array_length(a->'parentLinks')>4096
  or jsonb_typeof(a->'projectionAvailability') is distinct from 'array' or jsonb_array_length(a->'projectionAvailability')>224
  or (select count(*)<>count(distinct r->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') r)
  or (select count(*)<>count(distinct r->>'serviceDate') from jsonb_array_elements(a->'datedDayBases') r)
  or (select count(*)<>count(distinct r->>'workId') from jsonb_array_elements(a->'parentLinks') r)
 then raise exception 'Manual native bounded unique records required';end if;
 -- This first admission supports full-day canonical PTO/absence and its exact
 -- cancellation. Other exception shapes fail closed, never silently disappear.
 if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')
 then raise exception using errcode='0A000',message='Manual native exception requires its qualified dated profile';end if;
 policy:=public.static_weekly_manual_absence_policy();
 for base in select value from jsonb_array_elements(source#>'{version,slotAvailability}') loop
  dow:=(base->>'dayOfWeek')::integer;day:=frame+mod(dow-extract(dow from frame)::integer+7,7);
  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and (
   exists(select 1 from jsonb_array_elements(exceptions) e
    join jsonb_array_elements(source#>'{version,slotAvailability}') av on av->'slotId'=e#>'{payload,slotId}' and av->>'dayOfWeek'=dow::text and av->>'status'='working'
    where e->>'serviceDate'=day::text and e->>'type' in('pto','daily_absence'))
   or exists(select 1 from jsonb_array_elements(basis->'employmentByDate') ed
    cross join lateral jsonb_array_elements(ed->'employees') ee
    join jsonb_array_elements(source->'slots') es on exists(select 1 from jsonb_array_elements(es->'incumbencies') ei
     where ei->'personId'=ee->'employeeId' and (ei->>'effectiveStart')::date<=day and (ei->>'effectiveEnd' is null or day<(ei->>'effectiveEnd')::date))
    join jsonb_array_elements(source#>'{version,slotAvailability}') ea on ea->'slotId'=es->'id' and ea->>'dayOfWeek'=dow::text and ea->>'status'='working'
    where ed->>'serviceDate'=day::text and (ee#>>'{command,fact,state}'='PRE_START' or day<(ee#>>'{command,fact,firstServiceDate}')::date))) then
   availability:=availability||'{"blockedWindows":[]}'::jsonb;
  end if;
  select s into strict slot from jsonb_array_elements(source->'slots') s where s->'id'=base->'slotId';
  select i into strict person from jsonb_array_elements(slot->'incumbencies') i
   where (i->>'effectiveStart')::date<=day and (i->>'effectiveEnd' is null or day<(i->>'effectiveEnd')::date);
  select e into employment_employee from jsonb_array_elements(basis->'employmentByDate') d
   cross join lateral jsonb_array_elements(d->'employees') e
   where d->>'serviceDate'=day::text and e->'employeeId'=person->'personId';
  if base->>'status'='working' and employment_employee is not null and
   (employment_employee#>>'{command,fact,state}'='PRE_START' or day<(employment_employee#>>'{command,fact,firstServiceDate}')::date) then
   availability:=availability||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}],"unavailabilityClassification":"PRE_START_NOT_PTO"}'::jsonb;
  end if;
  expected_availability:=expected_availability||jsonb_build_array(availability||jsonb_build_object(
   'serviceDate',day::text,'incumbentPersonId',person->'personId','incumbentName',person->'displayName'));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into actual from jsonb_array_elements(a->'projectionAvailability') r;
 if actual is distinct from expected then raise exception 'Manual native static hours, eligibility or actual absence changed';end if;

 for day in select generate_series(frame,frame+6,'1 day')::date loop
  dow:=extract(dow from day)::integer;
  select r into strict normal_day from jsonb_array_elements(policy->'days') r where r->>'weekday'=dow::text;
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into absent
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='absent';
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into pre_start
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
  day_changed:=jsonb_array_length(absent)>0;
  select r into day_basis from jsonb_array_elements(a->'datedDayBases') r where r->>'serviceDate'=day::text;
  if day_changed is distinct from (day_basis is not null) then raise exception 'Manual native complete dated day set differs';end if;
  normal_start:=normal_day#>>'{checkedWindow,start}';normal_end:=normal_day#>>'{checkedWindow,end}';
  select max(r#>>'{shift,start}'),max(r#>>'{shift,end}') into complete_start,complete_end
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
  if complete_start is null or complete_start>=complete_end then raise exception 'Manual native staffed window is empty';end if;
  if day_changed then
   if jsonb_array_length(absent) not between 1 and 2 or day_basis->>'kind' is distinct from 'ABSENCE' then
    raise exception using errcode='0A000',message='Third absence requires the retained two-absence basis and actual CoverAll hours';end if;
   input:=day_basis->'input';plan:=day_basis->'plan';
   if input->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(input-'inputDigest')
    or plan->>'planDigest' is distinct from public.static_weekly_digest_jsonb(plan-'planDigest')
    or input->'sourceDigest' is distinct from a->'sourceDigest' or input->'formulaObjectiveDigest' is distinct from a->'formulaObjectiveDigest'
    or input->>'serviceDate' is distinct from day::text or plan->>'serviceDate' is distinct from day::text
    or input->'absentPersonIds' is distinct from absent or plan->'absentPersonIds' is distinct from absent
    or coalesce(input->'preStartPersonIds','[]') is distinct from pre_start
    or (jsonb_array_length(pre_start)>0 and input->>'preStartClassification' is distinct from 'PRE_START_NOT_PTO')
    or input->'checkedWindow' is distinct from jsonb_build_object('start',complete_start,'end',complete_end)
    or plan->'checkedWindow' is distinct from input->'checkedWindow' or plan->'inputDigest' is distinct from input->'inputDigest'
    or plan->'proposalDigest' is distinct from a->'formulaObjectiveDigest' or input->'access' is distinct from policy->'access'
    or input->'groups' is distinct from policy->'groups' or plan->'groups' is distinct from policy->'groups'
    or plan->'hardFeasibilityValidatedBeforeScoring' is distinct from 'true'::jsonb or plan->'globalOptimalityClaim' is distinct from 'false'::jsonb
    or exists(select 1 from unnest(array['publicationEligible','weeklyBaselineChanged','productionWritten','contractorBooked']) k where plan->k is distinct from 'false'::jsonb)
   then raise exception 'Manual native dated immutable input, source or formula changed';end if;
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'incumbentPersonId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'personId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into actual from jsonb_array_elements(input->'roster') r;
   if expected is distinct from actual then raise exception 'Manual native dated roster changed';end if;
   for item in select value from jsonb_array_elements(input->'roster') loop
    select r->'baseGroups' into strict expected from jsonb_array_elements(normal_day->'employees') r where r->>'name'=item->>'name';
    select coalesce(jsonb_agg(to_jsonb(r->>'code') order by ord),'[]') into actual
     from jsonb_array_elements(expected) with ordinality x(name,ord) join jsonb_array_elements(policy->'groups') r on r->'name'=name;
    if item->'baseCodes' is distinct from actual then raise exception 'Manual native distance anchor changed from approved normal day';end if;
   end loop;
  end if;

  for item in select value from jsonb_array_elements(p_envelope->'assignments') where value->>'service_date'=day::text loop
   w:=item->'work_snapshot';parent:=null;link:=null;
   select r into parent from jsonb_array_elements(source#>'{version,assignments}') r
    where r->>'dayOfWeek'=dow::text and r->'workId'=item->'work_id';
   if parent is null then
    select r into strict link from jsonb_array_elements(a->'parentLinks') r where r->'workId'=item->'work_id';
    select r into strict parent from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->'workId'=link->'parentWorkId';
    if link->'serviceDate' is distinct from item->'service_date' or link->'window' is distinct from w->'window' or link->'slotId' is distinct from item->'owner_slot_id'
     or coalesce(item->>'work_id','')!~'^manual-dated:[0-9a-f]{64}$' then raise exception 'Manual native parent lineage differs';end if;
   end if;
   select r into strict availability from jsonb_array_elements(expected_availability) r where r->'slotId'=item->'owner_slot_id' and r->>'serviceDate'=day::text;
   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';
   window_start:=w#>>'{window,start}';window_end:=w#>>'{window,end}';
   perform public.static_weekly_v3_assert_window(w->'window','manual native custody');
   if item->>'status' is distinct from 'assigned' or item->'reason_code' is distinct from 'null'::jsonb
    or item->>'day_of_week' is distinct from dow::text or item->>'plan_work_id' is distinct from dow::text||':'||(item->>'work_id')
    or item->'owner_person_id' is distinct from availability->'incumbentPersonId' or item->'optimized_owner_person_id' is distinct from item->'owner_person_id'
    or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'
    or availability->>'status' is distinct from 'working' or window_start<availability#>>'{shift,start}' or window_end>availability#>>'{shift,end}'
    or item->'baseline_owner_slot_id' is distinct from parent->'originSlotId' or w->'originSlotId' is distinct from parent->'originSlotId'
   then raise exception 'Manual native actual static owner, window or original actor changed';end if;
   select r into strict base from jsonb_array_elements(expected_availability) r where r->'slotId'=parent->'originSlotId' and r->>'serviceDate'=day::text;
   if item->'baseline_owner_person_id' is distinct from base->'incumbentPersonId' or item->'original_actor_person_id' is distinct from base->'incumbentPersonId'
    or item->'baseline_owner_name' is distinct from base->'incumbentName' or item->'original_actor_name' is distinct from base->'incumbentName'
    or item->>'owner_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',item->'plan_work_id','slotId',item->'owner_slot_id','personId',item->'owner_person_id','serviceDate',item->'service_date'))
    or item->>'exact_owner_identity' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',item->'plan_work_id','service_date',item->'service_date','optimized_owner_slot_id',item->'owner_slot_id','optimized_owner_person_id',item->'owner_person_id','baseline_owner_slot_id',parent->'originSlotId','baseline_owner_person_id',base->'incumbentPersonId'))
   then raise exception 'Manual native owner lineage digest changed';end if;
   inherited:=day_changed and exists(select 1 from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,phase_number)
    where phase_number>1 and ph#>>'{window,start}'<=window_start and window_start<ph#>>'{window,end}');
   expected:=jsonb_build_object('workId',item->'work_id','dayOfWeek',dow,'originSlotId',parent->'originSlotId',
    'locationId',parent->'locationId','locationCodeSnapshot',parent->'locationCodeSnapshot','locationNameSnapshot',parent->'locationNameSnapshot',
    'serviceMode',parent->'serviceMode','includedLocations',parent->'includedLocations','window',w->'window',
    'serviceEffortMinutes',w->'serviceEffortMinutes','serviceEffortProvenance',w->'serviceEffortProvenance',
    'priority',parent->'priority','priorityProvenance',parent->'priorityProvenance','required',parent->'required',
    'coveragePolicy',null,'bestEffortCoverage',false,'coveragePolicyOrder',null,'coveragePolicyProvenance',null,
    'requiredQualifications',parent->'requiredQualifications','qualificationProvenance',parent->'qualificationProvenance',
    'restrictions',parent->'restrictions','restrictionProvenance',parent->'restrictionProvenance','restrictedSlotIds',parent->'restrictedSlotIds',
    'manualLock',false,'manualLockSlotId',null,'overlayWork',false);
   if jsonb_array_length(coalesce(parent->'normalAssignmentRestrictedSlotIds','[]'))>0 then
    expected:=expected||jsonb_build_object('normalAssignmentRestrictedSlotIds',parent->'normalAssignmentRestrictedSlotIds','coveragePurpose',parent->'coveragePurpose');
   end if;
   if inherited and dow<>1 and parent->>'locationCodeSnapshot'='HERPETARIUM'
    and parent->'restrictedSlotIds' ? (basis#>>'{ownerConfig,slots,ALIJAH,slotId}') then
    expected:=expected||jsonb_build_object('restrictedSlotIds',(parent->'restrictedSlotIds')-(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'normalAssignmentRestrictedSlotIds',jsonb_build_array(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'coveragePurpose','INHERITED_ALERTS_AND_ISSUES_ONLY','restrictionProvenance',(parent->>'restrictionProvenance')||';normal-assignment-scope:fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
   end if;
   if w is distinct from expected or not ((availability->'qualifications') @> (w->'requiredQualifications'))
    or w->'restrictedSlotIds' ? (item->>'owner_slot_id') or owner_config->'hardForbiddenFamilies' ? (w->>'locationCodeSnapshot')
    or exists(select 1 from jsonb_array_elements(w->'includedLocations') r where availability->'restrictions' ? (r->>'locationId'))
    or (item->>'owner_slot_id'=basis#>>'{ownerConfig,slots,TAMMY,slotId}' and w->>'locationCodeSnapshot' not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA'))
   then raise exception 'Manual native physical members, hard eligibility or scoped restriction changed: work %, fields %',item->>'work_id',
    (select coalesce(jsonb_agg(k order by k),'[]') from (select jsonb_object_keys(w||expected) k) q where w->k is distinct from expected->k);end if;
   if not day_changed and (link is not null or item->'owner_slot_id' is distinct from parent->'ownerSlotId' or w->'window' is distinct from parent->'window'
    or w->'serviceEffortMinutes' is distinct from parent->'serviceEffortMinutes' or w->'serviceEffortProvenance' is distinct from parent->'serviceEffortProvenance')
   then raise exception 'Manual native changed an approved normal day';end if;
   if day_changed and (window_end>parent#>>'{window,end}' or window_start<case
    when parent#>>'{window,start}'<=normal_start and parent#>>'{window,end}'>normal_start
     then least(parent#>>'{window,start}',complete_start) else parent#>>'{window,start}' end)
   then raise exception 'Manual native custody exceeds its exact parent boundary';end if;
   -- A single unchanged owner can continue across the complete-crew arrival.
   -- That harmless merged row must still preserve the whole early base prefix.
   if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'
    or window_start<>parent#>>'{window,start}' or window_end<least(parent#>>'{window,end}',complete_start))
   then raise exception 'Manual native early own-base custody differs';end if;
   if day_changed and window_end>complete_start then
    if window_end>complete_end then raise exception 'Manual native actual full-site window differs';end if;
    for phase in select value from jsonb_array_elements(plan->'phaseOwners') where value#>>'{window,start}'<window_end and window_start<value#>>'{window,end}' loop
     if phase#>>array['owners',w->>'locationCodeSnapshot'] is distinct from item->>'owner_slot_id' then raise exception 'Manual native selected phase differs from stored custody';end if;
    end loop;
   end if;
   select assignment_id into strict assignment from public.weekly_schedule_slot_assignments
    where version_id=version and day_of_week=dow and work_id=parent->>'workId';
   links:=links||jsonb_build_object(item->>'plan_work_id',assignment::text);
  end loop;

  -- Every physical group tiles the complete actual staffed window once.
  for code in select r->>'code' from jsonb_array_elements(policy->'groups') r loop
   previous_end:=complete_start;previous_owner:=null;
   for item in select r from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text
    and r#>>'{work_snapshot,locationCodeSnapshot}'=code and r#>>'{work_snapshot,window,end}'>complete_start
    order by r#>>'{work_snapshot,window,start}' loop
    window_start:=greatest(complete_start,item#>>'{work_snapshot,window,start}');window_end:=least(complete_end,item#>>'{work_snapshot,window,end}');
    if window_end<=window_start then continue;end if;
    if window_start<>previous_end then raise exception 'Manual native full-site gap or overlap';end if;
    if day_changed and previous_owner is not null and previous_owner<>item->>'owner_slot_id' and not exists(
     select 1 from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
    then raise exception 'Manual native owner moved before the static departure';end if;
    previous_end:=window_end;previous_owner:=item->>'owner_slot_id';
   end loop;
   if previous_end<>complete_end then raise exception 'Manual native full-site coverage incomplete';end if;
   select sum((r->>'serviceEffortMinutes')::integer) into budget from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->>'locationCodeSnapshot'=code;
   select sum((r#>>'{work_snapshot,serviceEffortMinutes}')::integer) into actual_effort from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text and r#>>'{work_snapshot,locationCodeSnapshot}'=code;
   if actual_effort is distinct from budget then raise exception 'Manual native combined group workload budget changed';end if;
  end loop;
  if not day_changed and (select count(*) from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text)
   <>(select count(*) from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text)
  then raise exception 'Manual native omitted approved normal rows';end if;
  if day_changed then
   perform public.static_weekly_manual_assert_absence_score(day_basis,normal_day,policy,expected_availability,p_envelope->'assignments',basis->'ownerConfig');
  end if;
 end loop;
 if (select count(*) from jsonb_object_keys(links))<>jsonb_array_length(p_envelope->'assignments')
  or exists(select 1 from jsonb_array_elements(a->'parentLinks') l where not exists(select 1 from jsonb_array_elements(p_envelope->'assignments') r where r->'work_id'=l->'workId' and r->'service_date'=l->'serviceDate'))
 then raise exception 'Manual native foreign row or unused parent link';end if;
 if summary is distinct from public.static_weekly_accepted_exception_set(publication,frame)
 then raise exception 'Manual native original fact did not become exact accepted authority';end if;
 perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);
 return jsonb_build_object('assignment_links',links,'projection_assignments',p_envelope->'assignments','kind','INITIAL_EMPLOYMENT_OPERATIONALIZATION');
end $fn$;
revoke all on function public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;


-- COMPONENT recurring_period SHA256 915145091d548cba80c5908a3f9e2b8e6f08dffa9683a4e98a9a7b4c02cc0c60
-- WORKER1 SOURCE PROPOSAL ONLY. No canonical/source302 amendment or execution.
-- Main owns predecessor/ACL qualification, inventory/canary enrollment and SQL.
-- Reuse the SAME normal publication/source. Never register a dated plan as normal.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
DO $requires$
BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regprocedure('public.static_weekly_source_window_start(jsonb,date)') IS NULL
  OR to_regprocedure('public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)') IS NULL
  OR to_regprocedure('custodial_employment.read_admissions(date,bigint,uuid,uuid,text,text)') IS NULL
  OR to_regprocedure('public.static_weekly_manual_identity_json(jsonb)') IS NULL
  OR to_regprocedure('public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date)') IS NULL
 THEN RAISE EXCEPTION 'Qualified Source301 and employment admission counterparts required'; END IF;
END $requires$;
CREATE TABLE public.static_weekly_manual_repeat_confirmations(
 manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 request_id uuid NOT NULL,request_json jsonb NOT NULL,receipt_json jsonb NOT NULL,
 PRIMARY KEY(manager_id,request_id)
);
ALTER TABLE public.static_weekly_manual_repeat_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.static_weekly_manual_repeat_confirmations FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER manual_repeat_immutable BEFORE UPDATE OR DELETE ON public.static_weekly_manual_repeat_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();

-- Private deterministic date/identity transposition of admitted components.
-- Select JSON paths directly; never SELECT baseline%ROWTYPE or hash feasibility.
CREATE FUNCTION public.static_weekly_manual_repeat_components(p_source uuid,p_frame date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE origin date;snapshot text;projection jsonb;lunch jsonb;rows jsonb;availability jsonb;
 loans jsonb;responsibilities jsonb;intents jsonb;loan_keys jsonb;authority jsonb;input jsonb;overlay_input jsonb;
 authority_digest text;input_digest text;replay_digest text;source_projection text;source_lunch text;
BEGIN
 SELECT b.effective_start,b.snapshot_digest,b.feasibility#>'{initialBaseline,projection}',b.feasibility->'lunchDocument'
  INTO STRICT origin,snapshot,projection,lunch FROM public.static_weekly_approved_initial_baselines b WHERE source_id=p_source;
 IF p_frame IS NULL OR NOT isfinite(p_frame) OR p_frame<=origin OR mod(p_frame-origin,7)<>0
  OR projection->>'week_start' IS DISTINCT FROM origin::text OR lunch->>'week_start' IS DISTINCT FROM origin::text
  OR jsonb_array_length(projection->'assignments')<>346 OR jsonb_array_length(lunch->'loans')<>40
  OR projection#>>'{authority,compilerInput,version,manualGroupRatingAuthority,manifestSha256}' IS DISTINCT FROM 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
 THEN RAISE EXCEPTION 'Exact later publication-aligned normal period required'; END IF;
 source_projection:=projection->>'database_projection_identity';source_lunch:=lunch->>'document_identity';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'assignments') r WHERE
  (r->>'service_date')::date<>origin+mod((r->>'day_of_week')::integer-extract(dow FROM origin)::integer+7,7)
  OR r->>'status'<>'assigned') THEN RAISE EXCEPTION 'Original normal assignment dates/status differ'; END IF;
 SELECT jsonb_agg(r||jsonb_build_object('service_date',d::text,
  'owner_digest',public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',r->'plan_work_id','slotId',r->'owner_slot_id','personId',r->'owner_person_id','serviceDate',d::text)),
  'exact_owner_identity',public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',r->'plan_work_id','service_date',d::text,
   'optimized_owner_slot_id',r->'owner_slot_id','optimized_owner_person_id',r->'owner_person_id',
   'baseline_owner_slot_id',r->'baseline_owner_slot_id','baseline_owner_person_id',r->'baseline_owner_person_id'))) ORDER BY n) INTO rows
 FROM jsonb_array_elements(projection->'assignments') WITH ORDINALITY x(r,n)
 CROSS JOIN LATERAL(SELECT p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7) d) dates;
 SELECT jsonb_agg(r||jsonb_build_object('serviceDate',(p_frame+mod((r->>'dayOfWeek')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO availability FROM jsonb_array_elements(projection#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n);
 input:=jsonb_set(projection#>'{authority,compilerInput}','{serviceDate}',to_jsonb(p_frame::text),false);
 overlay_input:=jsonb_set(projection#>'{authority,overlayCompilerInput}','{serviceDate}',to_jsonb(p_frame::text),false);
 input_digest:=public.static_weekly_digest_jsonb(overlay_input);
 -- EXACT existing manual/native lunch key language (canonical JSON, no spaces).
 SELECT jsonb_object_agg(r->>'loan_id',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'policy','owner-20260921-two-nearby-full-hour-v1','input',input_digest,
  'serviceDate',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text,
  'ownerSlotId',r->'normal_owner_slot_id','start',r->'coverage_start','end',r->'coverage_end')))) INTO loan_keys
 FROM jsonb_array_elements(lunch->'loans') r;
 SELECT jsonb_agg(r||jsonb_build_object('loan_id',loan_keys->>(r->>'loan_id'),
  'service_date',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO loans FROM jsonb_array_elements(lunch->'loans') WITH ORDINALITY x(r,n);
 SELECT jsonb_agg(r||jsonb_build_object('responsibility_id',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'loanId',loan_keys->>(r->>'loan_id'),'areaId',physical_area.area_id,'covererSlotId',r->'coverer_slot_id'))),
  'loan_id',loan_keys->>(r->>'loan_id'),
  'service_date',(p_frame+mod((r->>'day_of_week')::integer-extract(dow FROM p_frame)::integer+7,7))::text) ORDER BY n)
 INTO responsibilities FROM jsonb_array_elements(lunch->'responsibilities') WITH ORDINALITY x(r,n)
 CROSS JOIN LATERAL(SELECT public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_agg(jsonb_build_object(
  'work',segment->'planWorkId','start',extract(epoch FROM (segment#>>'{normalWindow,start}')::time)::integer/60,
  'end',extract(epoch FROM (segment#>>'{normalWindow,end}')::time)::integer/60) ORDER BY segment->>'planWorkId' COLLATE "C"))) area_id
 FROM jsonb_array_elements(r->'segments') seg(segment)) physical_area;
 SELECT jsonb_agg(r||jsonb_build_object('notification_key',public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
  'loanId',loan_keys->>(r->>'loan_id'),'slot',r->'coverer_slot_id','event',r->'event'))),
  'loan_id',loan_keys->>(r->>'loan_id'),'service_date',((r->>'service_date')::date+(p_frame-origin))::text) ORDER BY n)
 INTO intents FROM jsonb_array_elements(lunch->'notification_intents') WITH ORDINALITY x(r,n);
 authority:=((projection->'authority')-ARRAY['lunchIdentityRetention','derivedBaselineDigest','basisDigest','witnessDigest','shiftEndDerivation','mapping'])||jsonb_build_object('effectiveDate',p_frame::text,'compilerInput',input,'overlayCompilerInput',overlay_input,
  'projectionAvailability',availability,'inputDigest',input_digest,'overlayInputDigest',input_digest,'baselineInputDigest',public.static_weekly_digest_jsonb(input),
  'repeatReference',jsonb_build_object('schema','custodial.approved-manual-fixed-period-reference.v1','sourceId',p_source,
   'origin',origin::text,'frameStart',p_frame::text,'baselineSnapshotDigest',snapshot,'originalProjectionIdentity',source_projection,
   'originalLunchIdentity',source_lunch,'originalFixedEvidence',jsonb_build_object('derivedBaselineDigest',projection#>'{authority,derivedBaselineDigest}','basisDigest',projection#>'{authority,basisDigest}','witnessDigest',projection#>'{authority,witnessDigest}','shiftEndDerivation',projection#>'{authority,shiftEndDerivation}','mapping',projection#>'{authority,mapping}'),'witnessMeaning','UNCHANGED_ADMITTED_PATTERN_TRANSLATED_BY_WHOLE_SEVEN_DAY_PERIODS'));
 authority_digest:=public.static_weekly_digest_jsonb(authority);
 -- The exact native replay is bound AFTER the complete fresh lunch body below.
 replay_digest:=NULL;
 projection:=projection-'database_projection_identity';
 projection:=projection||jsonb_build_object('adapter',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-adapter.v1','version','approved-manual-repeat-v1'),
  'service_date',p_frame::text,'week_start',p_frame::text,'week_end',(p_frame+6)::text,'authority',authority,'authority_digest',authority_digest,
  'compiler_version','approved-manual-repeat-v1','replay_digest',replay_digest,'assignments',rows,'applied_exceptions','[]'::jsonb,
  'receipt',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-data.v1','baselineSnapshotDigest',snapshot,
   'originalProjectionIdentity',source_projection,'solverInvoked',false,'newOptimizerOrI1Receipt',false),
  'semantic_snapshot',jsonb_build_object('schema','custodial.approved-manual-recurring-reference-snapshot.v1','sourceId',p_source,
   'origin',origin::text,'frameStart',p_frame::text,'baselineSnapshotDigest',snapshot,'originalProjectionIdentity',source_projection));
 lunch:=lunch-'document_identity';
 lunch:=lunch||jsonb_build_object('week_start',p_frame::text,'base_authority_digest',authority_digest,'base_replay_digest',replay_digest,
  'source_input_digest',input_digest,'candidate_digest',public.static_weekly_digest_jsonb(jsonb_build_object('schema','custodial.approved-manual-repeat-lunch-data.v1','source_input_digest',input_digest,'loans',loans,'responsibilities',responsibilities,'notification_intents',intents)),
  'loans',loans,'responsibilities',responsibilities,'notification_intents',intents,
  'semantic_snapshot',jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
   'loans_digest',public.static_weekly_digest_jsonb(loans),'responsibilities_digest',public.static_weekly_digest_jsonb(responsibilities),
   'notification_intents_digest',public.static_weekly_digest_jsonb(intents)));
 lunch:=lunch-ARRAY['base_authority_digest','base_replay_digest','document_identity'];
 replay_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('projectionAssignments',rows,'lunchDocument',lunch));
 lunch:=lunch||jsonb_build_object('base_authority_digest',authority_digest,'base_replay_digest',replay_digest);
 lunch:=lunch||jsonb_build_object('document_identity',public.static_weekly_digest_jsonb(lunch));
 projection:=(projection-'database_projection_identity')||jsonb_build_object('replay_digest',replay_digest);
 projection:=projection||jsonb_build_object('database_projection_identity',public.static_weekly_digest_jsonb(projection));
 RETURN jsonb_build_object('projection',projection,'lunchDocument',lunch);
END $fn$;

CREATE FUNCTION public.static_weekly_read_manual_repeat_basis(p_manager uuid,p_publication uuid,p_date date,p_revision bigint,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE actor jsonb;v_source_id uuid;v_version_id uuid;origin date;frame date;snapshot text;catalog text;projection jsonb;lunch jsonb;
 entry record;exceptions jsonb;reasons jsonb:='[]';participants jsonb;employment jsonb:='[]';readback jsonb;
 d date;a jsonb;r record;existing uuid;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_revision IS NULL OR p_revision NOT BETWEEN 0 AND 9007199254740990 OR p_revision IS DISTINCT FROM
  (SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
  OR p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current recurring date/revision required'; END IF;
 SELECT v.authority_source_id,v.version_id,p.effective_start INTO STRICT v_source_id,v_version_id,origin
 FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
 WHERE p.publication_id=p_publication;
 SELECT b.snapshot_digest,b.feasibility#>'{initialBaseline,projection}' AS projection_component,b.feasibility->'lunchDocument' AS lunch_component,c.catalog_entry_digest,
  c.template_json,c.binding_json,c.owner_config,c.approval_evidence,c.template_id INTO STRICT entry
 FROM public.static_weekly_approved_initial_baselines b JOIN public.static_weekly_approved_template_catalog c USING(template_id)
 JOIN public.static_weekly_authority_source_documents s ON s.source_id=b.source_id
 WHERE b.source_id=v_source_id AND b.effective_start=origin AND s.active AND s.retired_at IS NULL;
 snapshot:=entry.snapshot_digest;projection:=entry.projection_component;lunch:=entry.lunch_component;catalog:=entry.catalog_entry_digest;
 IF p_date<origin OR entry.template_id IS NULL
  OR EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements WHERE template_id=entry.template_id)
  OR catalog IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object('template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  OR projection#>>'{authority,compilerInput,version,manualGroupRatingAuthority,manifestSha256}' IS DISTINCT FROM 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  OR NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_confirmations c WHERE c.publication_id=p_publication)
 THEN RAISE EXCEPTION 'Current live catalog and original accepted manual publication required'; END IF;
 frame:=public.static_weekly_source_window_start(projection#>'{authority,compilerInput}',p_date);
 IF frame IS DISTINCT FROM origin+((p_date-origin)/7)*7 THEN RAISE EXCEPTION 'Original publication origin differs from Source301 window authority'; END IF;
 IF frame<=origin THEN RAISE EXCEPTION 'Initial frame remains owned by the original activation'; END IF;
 IF public.static_weekly_effective_version(frame) IS DISTINCT FROM v_version_id
  OR public.static_weekly_effective_version(frame+6) IS DISTINCT FROM v_version_id
 THEN RAISE EXCEPTION 'Period crosses or has left the original normal publication'; END IF;
 IF projection->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(projection-'database_projection_identity')
  OR lunch->>'document_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(lunch-'document_identity') THEN RAISE EXCEPTION 'Original admitted component identity differs'; END IF;
 IF jsonb_array_length(projection->'assignments')<>346 OR jsonb_array_length(lunch->'loans')<>40 THEN RAISE EXCEPTION 'Original normal component counts differ'; END IF;
 exceptions:=public.static_weekly_accepted_exception_set(p_publication,frame);
 SELECT jsonb_agg(jsonb_build_object('serviceDate',service_day::date::text,
  'assignmentEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'owner_person_id' id FROM jsonb_array_elements(projection->'assignments') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids),
  'lunchOwnerEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'normal_owner_person_id' id FROM jsonb_array_elements(lunch->'loans') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids),
  'lunchCovererEmployeeIds',(SELECT jsonb_agg(id ORDER BY id) FROM(SELECT DISTINCT item->>'coverer_person_id' id FROM jsonb_array_elements(lunch->'responsibilities') x(item) WHERE (item->>'day_of_week')::integer=extract(dow FROM service_day)::integer) ids)) ORDER BY service_day)
 INTO participants FROM generate_series(frame::timestamp,(frame+6)::timestamp,interval '1 day') dates(service_day);
 FOR d IN SELECT generate_series(frame::timestamp,(frame+6)::timestamp,interval '1 day')::date LOOP
  FOR a IN SELECT value FROM jsonb_array_elements(projection#>'{authority,projectionAvailability}') WHERE value->>'status'='working' AND (value->>'dayOfWeek')::integer=extract(dow FROM d)::integer LOOP
   IF NOT EXISTS(SELECT 1 FROM public.v_weekly_roster_slot_incumbency_ranges incumbency JOIN public.employees e ON e.id=incumbency.person_id
    WHERE incumbency.slot_id=(a->>'slotId')::uuid AND incumbency.person_id=(a->>'incumbentPersonId')::uuid AND incumbency.effective_start<=d
     AND (incumbency.effective_end IS NULL OR d<incumbency.effective_end) AND e.active)
   THEN reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','ACTUAL_ROSTER_CHANGED','serviceDate',d::text,'slotId',a->>'slotId')); END IF;
  END LOOP;
  readback:=custodial_employment.read_admissions(d,p_revision,p_manager,p_credential,p_device,p_access);
  employment:=employment||jsonb_build_array(readback);
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lunch->'loans') l WHERE l->>'normal_owner_person_id'='1318b295-fd70-4e78-8828-62c29302f96f'
  AND (l->>'coverage_start'<>'12:30' OR l->>'coverage_end'<>'13:30')) THEN
  reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','APPROVED_XAVIER_LUNCH_DIFFERS')); END IF;
 -- A bare same-frame projection does not prove current employment14 or a
 -- normal-reference admission. The typed recurring owner always obtains a real
 -- same-request repeat receipt; native writer replay still deduplicates bytes.
 existing:=NULL;
 RETURN jsonb_build_object('schema','custodial.approved-manual-recurring-basis.v1','managerId',p_manager,
  'sourceId',v_source_id,'publicationId',p_publication,'versionId',v_version_id,'origin',origin::text,'frameStart',frame::text,'frameEnd',(frame+6)::text,
  'authorityRevision',p_revision,'generation',public.static_weekly_v15_read_recurring_generation(),
  'manifestSha256','fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f',
  'baselineSnapshotDigest',snapshot,'catalogEntryDigest',catalog,'sourceProjectionIdentity',projection->>'database_projection_identity',
  'sourceLunchIdentity',lunch->>'document_identity','assignmentCount',346,'lunchCount',40,'acceptedExceptions',exceptions,
  'adjustmentReasons',reasons,'participants',participants,'employmentByDate',employment,'existingProjectionId',existing);
END $fn$;

-- Exact reference validator, called only by the private native writer copy.
CREATE FUNCTION public.static_weekly_assert_manual_repeat_projection(p_envelope jsonb,p_publication uuid,p_date date,p_exceptions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE sid uuid;expected jsonb;
BEGIN
 IF p_exceptions IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Dated exceptions require the same native adjustment path'; END IF;
 SELECT authority_source_id INTO STRICT sid FROM public.weekly_schedule_versions v
 JOIN public.weekly_schedule_publications p USING(version_id) WHERE p.publication_id=p_publication;
 expected:=public.static_weekly_manual_repeat_components(sid,p_date)->'projection';
 IF p_envelope IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Repeated normal rows differ from admitted immutable components'; END IF;
END $fn$;
-- No arbitrary rewritten predecessor: header + ONE validator call only;
-- complete inverse must equal the installed Source301 approved writer.
DO $copy_native$
DECLARE original text;changed text;inverse text;needle text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_approved_initial_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 needle:='public.static_weekly_assert_approved_initial_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)';
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Exact approved native validator seam differs'; END IF;
 IF length(original)-length(replace(original,'FUNCTION public.static_weekly_approved_initial_materialize_projection(',''))<>length('FUNCTION public.static_weekly_approved_initial_materialize_projection(') THEN RAISE EXCEPTION 'Native function header is not unique'; END IF;
 changed:=replace(original,'FUNCTION public.static_weekly_approved_initial_materialize_projection(',
  'FUNCTION public.static_weekly_manual_repeat_materialize_projection(');
 IF changed=original THEN RAISE EXCEPTION 'Exact approved native function header differs'; END IF;
 changed:=replace(changed,needle,'public.static_weekly_assert_manual_repeat_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)');
 inverse:=replace(replace(changed,'FUNCTION public.static_weekly_manual_repeat_materialize_projection(',
  'FUNCTION public.static_weekly_approved_initial_materialize_projection('),
  'public.static_weekly_assert_manual_repeat_projection(p_assignments,p_publication_id,p_service_date,v_exception_set)',needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Unexplained native writer drift'; END IF;
 EXECUTE changed;
END $copy_native$;

CREATE FUNCTION public.static_weekly_materialize_manual_repeat(p_reference jsonb,p_reference_digest text,
 p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE manager uuid;publication uuid;request uuid;frame date;revision bigint;basis jsonb;expected jsonb;vector jsonb;reasons jsonb;
 actor jsonb;components jsonb;projection jsonb;materialized jsonb;lunch jsonb;receipt jsonb;prior record;employee jsonb;v_day jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF p_reference IS NULL OR pg_column_size(p_reference)>32768 THEN RAISE EXCEPTION 'Bounded compact normal period reference required'; END IF;
 PERFORM public.static_weekly_assert_exact_object(p_reference,
  ARRAY['schema','managerId','requestId','sourceId','publicationId','versionId','origin','frameStart','frameEnd','expectedRevision','generation','baselineSnapshotDigest','catalogEntryDigest','sourceProjectionIdentity','sourceLunchIdentity','employmentRevisionVector','exceptionSetDigest'],
  ARRAY['schema','managerId','requestId','sourceId','publicationId','versionId','origin','frameStart','frameEnd','expectedRevision','generation','baselineSnapshotDigest','catalogEntryDigest','sourceProjectionIdentity','sourceLunchIdentity','employmentRevisionVector','exceptionSetDigest'],'normal recurring reference');
 IF p_reference->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference.v1'
  OR p_reference_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_reference)
 THEN RAISE EXCEPTION 'Exact compact repeat reference required'; END IF;
 manager:=(p_reference->>'managerId')::uuid;publication:=(p_reference->>'publicationId')::uuid;request:=(p_reference->>'requestId')::uuid;
 frame:=(p_reference->>'frameStart')::date;revision:=(p_reference->>'expectedRevision')::bigint;
 IF manager IS NULL OR publication IS NULL OR request IS NULL THEN RAISE EXCEPTION 'Explicit request/publication/manager identity required'; END IF;
 actor:=public.custodial_action_actor_v1(manager,p_credential,p_device,p_access,'write');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO prior FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=manager AND request_id=request;
 IF FOUND THEN
  IF prior.request_json IS DISTINCT FROM p_reference THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original repeat request identity changed'; END IF;
  RETURN prior.receipt_json;
 END IF;
 basis:=public.static_weekly_read_manual_repeat_basis(manager,publication,frame,revision,p_credential,p_device,p_access);
 reasons:=basis->'adjustmentReasons';
 IF basis->'acceptedExceptions' IS DISTINCT FROM '[]'::jsonb THEN reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','ACCEPTED_EXCEPTIONS')); END IF;
 FOR v_day IN SELECT value FROM jsonb_array_elements(basis->'employmentByDate') LOOP
  FOR employee IN SELECT value FROM jsonb_array_elements(v_day->'employees') LOOP
   IF (employee#>>'{command,fact,state}'='PRE_START' OR (employee#>>'{command,fact,firstServiceDate}')::date>(v_day->>'serviceDate')::date)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(basis->'participants') p WHERE p->>'serviceDate'=v_day->>'serviceDate'
     AND ((p->'assignmentEmployeeIds')?(employee->>'employeeId') OR (p->'lunchOwnerEmployeeIds')?(employee->>'employeeId') OR (p->'lunchCovererEmployeeIds')?(employee->>'employeeId'))) THEN
    reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','PRE_START_NOT_PTO','serviceDate',v_day->>'serviceDate','employeeId',employee->>'employeeId'));
   END IF;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(reasons)>0 THEN RETURN jsonb_build_object('schema','custodial.approved-manual-recurring-decision.v1',
  'status','NEEDS_DATED_ADJUSTMENT','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd','reasons',reasons,
  'route','SAME_NATIVE_APPROVED_MANUAL_DATED_OWNER_PATH','normalSourceChanged',false,'solverInvoked',false,'published',false); END IF;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',day_row->>'serviceDate','employeeId',employee_row->>'employeeId',
  'employmentRevision',employee_row->'employmentRevision','requestId',employee_row#>>'{command,requestId}') ORDER BY day_row->>'serviceDate',employee_row->>'employeeId') INTO vector
 FROM jsonb_array_elements(basis->'employmentByDate') days(day_row) CROSS JOIN LATERAL jsonb_array_elements(day_row->'employees') employees(employee_row);
 expected:=jsonb_build_object('schema','custodial.approved-manual-recurring-reference.v1','managerId',manager,'requestId',request,
  'sourceId',basis->'sourceId','publicationId',basis->'publicationId','versionId',basis->'versionId','origin',basis->'origin',
  'frameStart',basis->'frameStart','frameEnd',basis->'frameEnd','expectedRevision',revision,'generation',basis->'generation',
  'baselineSnapshotDigest',basis->'baselineSnapshotDigest','catalogEntryDigest',basis->'catalogEntryDigest',
  'sourceProjectionIdentity',basis->'sourceProjectionIdentity','sourceLunchIdentity',basis->'sourceLunchIdentity',
  'employmentRevisionVector',vector,'exceptionSetDigest',public.static_weekly_digest_jsonb(basis->'acceptedExceptions'));
 IF expected IS DISTINCT FROM p_reference THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current repeat source/catalog/generation/employment/reference changed'; END IF;
 IF basis->'existingProjectionId' IS DISTINCT FROM 'null'::jsonb THEN RETURN jsonb_build_object('status','ALREADY_MATERIALIZED',
  'projectionId',basis->'existingProjectionId','frameStart',basis->'frameStart','published',false); END IF;
 PERFORM public.custodial_begin_application_mutation();
 components:=public.static_weekly_manual_repeat_components((basis->>'sourceId')::uuid,frame);
 projection:=components->'projection';
 PERFORM public.static_weekly_manual_assert_lunch_lineage(projection,components->'lunchDocument',publication,frame);
 materialized:=public.static_weekly_manual_repeat_materialize_projection(publication,frame,public.static_weekly_digest_jsonb('[]'::jsonb),
  projection->>'compiler_version',projection->'objective',projection->'metrics',projection->>'replay_digest',projection,revision,
  manager,actor->>'manager_name',request::text||':normal-period');
 projection:=NULL;
 lunch:=public.static_weekly_v8_materialize_lunch_document((materialized#>>'{data,projection_id}')::uuid,components->'lunchDocument',manager);
 IF materialized->'ok' IS DISTINCT FROM 'true'::jsonb OR materialized->>'revision' IS NULL OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED' THEN RAISE EXCEPTION 'Native repeated period/lunch did not persist'; END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v1','status','PERSISTED_CURRENT',
  'source_id',basis->'sourceId','publication_id',publication,'projection_id',materialized#>'{data,projection_id}',
  'authority_revision',materialized->'revision','frameStart',basis->'frameStart','frameEnd',basis->'frameEnd',
  'lunch_document_identity',lunch->'document_identity','referenceDigest',p_reference_digest,'solverInvoked',false,'normalSourceChanged',false);
 INSERT INTO public.static_weekly_manual_repeat_confirmations VALUES(manager,request,p_reference,receipt);
 RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_manual_repeat_confirmation(p_manager uuid,p_request uuid,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT jsonb_build_object('request',request_json,'receipt',receipt_json) INTO result FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=p_manager AND request_id=p_request;
 RETURN result; -- NULL is absence DATA, not retry/resend permission.
END $fn$;
DO $private$
DECLARE sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.static_weekly_manual_repeat_components(uuid,date)',
  'public.static_weekly_assert_manual_repeat_projection(jsonb,uuid,date,jsonb)',
  'public.static_weekly_manual_repeat_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)',
  'public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)',
  'public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)',
  'public.static_weekly_read_manual_repeat_confirmation(uuid,uuid,uuid,text,text)'] LOOP
  EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',sig);
 END LOOP;
END $private$;
GRANT EXECUTE ON FUNCTION public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text),
 public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text),
 public.static_weekly_read_manual_repeat_confirmation(uuid,uuid,uuid,text,text) TO static_weekly_control_plane;
-- Main must enroll all new objects in its SAME original-owner authority/recovery
-- inventory/canary transaction and qualify before permitting these RPCs.


-- COMPONENT typed_recurring_native SHA256 5c79a7798d602a86da157b6e1f171e92da841d855783550b8f4ffd06d6a6800f
-- Worker1 typed recurring materialization companion. Main SQL qualification REQUIRED.
-- Install AFTER employment/native/CoverAll/initial guard/recurring-period;
-- BEFORE notification continuity, typed device delivery and admission-proof LAST.
-- No normal source, staffing command, employee, exception or optimizer receipt is created.

SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
DO $requires$ BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regprocedure('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)') IS NULL
  OR to_regprocedure('public.static_weekly_coverall_initial_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)') IS NULL
  OR to_regprocedure('public.static_weekly_materialize_manual_repeat(jsonb,text,uuid,text,text)') IS NULL
 THEN RAISE EXCEPTION 'Qualified current manual native/initial/recurring predecessors required';END IF;
END $requires$;
-- Bounded successor of the already-installed repeat reader. Do not rerun its
-- schema. Only the unsafe bare-projection shortcut changes, with full inverse.
DO $repeat_reader_counterpart$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)'::regprocedure);
 needle:=$old$ SELECT p.projection_id INTO existing FROM public.weekly_schedule_compiled_projections p
 WHERE p.publication_id=p_publication AND p.version_id=v_version_id AND p.week_start=frame AND p.week_end=frame+6
  AND p.exception_set_digest=public.static_weekly_digest_jsonb(exceptions)
 ORDER BY p.compiled_at DESC,p.projection_id DESC LIMIT 1;$old$;
 replacement:=$new$ -- A bare same-frame projection does not prove current employment14 or a
 -- normal-reference admission. The typed recurring owner always obtains a real
 -- same-request repeat receipt; native writer replay still deduplicates bytes.
 existing:=NULL;$new$;
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_proc WHERE oid='public.static_weekly_read_manual_repeat_basis(uuid,uuid,date,bigint,uuid,text,text)'::regprocedure))=ANY(ARRAY['a5b472d11b7ccf60cf88879f92f6dba17548ae15bc9b635e4104958ce088d0ad','9afab5601c8b799fd57d51c06c56d350dc7acbd2174259f2a28c8b55ba2848f4'])
 THEN RETURN;END IF;
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Installed repeat reader shortcut predecessor differs';END IF;
 changed:=replace(original,needle,replacement);inverse:=replace(changed,replacement,needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Repeat reader full inverse differs';END IF;EXECUTE changed;
END $repeat_reader_counterpart$;
CREATE TABLE custodial_coverall.recurring_materialization_operations(
 operation_id uuid PRIMARY KEY,manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_json jsonb NOT NULL,
 owner_xid xid8 NOT NULL,backend_pid integer NOT NULL,credential_id uuid NOT NULL,device_id text NOT NULL,session_access text NOT NULL,
 source_id uuid NOT NULL,publication_id uuid NOT NULL,version_id uuid NOT NULL,frame_start date NOT NULL,authority_revision bigint NOT NULL,
 basis_json jsonb,repeat_basis jsonb,source_digest text NOT NULL,catalog_digest text NOT NULL,generation bigint NOT NULL,
 UNIQUE(manager_id,idempotency_key),CHECK((basis_json IS NULL)<>(repeat_basis IS NULL))
);
CREATE TABLE custodial_coverall.recurring_materialization_stages(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.recurring_materialization_operations,
 envelope_json jsonb NOT NULL,lunch_json jsonb NOT NULL,candidate_digest text NOT NULL
);
CREATE TABLE custodial_coverall.recurring_materialization_receipts(
 operation_id uuid PRIMARY KEY REFERENCES custodial_coverall.recurring_materialization_operations,receipt_json jsonb NOT NULL
);
DO $tables$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['recurring_materialization_operations','recurring_materialization_stages','recurring_materialization_receipts'] LOOP
  EXECUTE format('alter table custodial_coverall.%I enable row level security',n);
  EXECUTE format('revoke all on custodial_coverall.%I from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',n);
  EXECUTE format('create trigger immutable before update or delete on custodial_coverall.%I for each row execute function public.static_weekly_reject_update_delete()',n);
  EXECUTE format('alter table custodial_coverall.%I enable always trigger immutable',n);
 END LOOP;
END $tables$;
CREATE FUNCTION public.static_weekly_manual_recurring_require_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=NEW.operation_id)
 THEN RAISE EXCEPTION 'Recurring begin/stage cannot COMMIT without its same-transaction accepted projection and lunch';END IF;
 RETURN NEW;
END $fn$;
CREATE CONSTRAINT TRIGGER complete_recurring_receipt AFTER INSERT ON custodial_coverall.recurring_materialization_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.static_weekly_manual_recurring_require_receipt();
ALTER TABLE custodial_coverall.recurring_materialization_operations ENABLE ALWAYS TRIGGER complete_recurring_receipt;

-- Only recorded original normal incumbencies are mathematical source. A live
-- replacement never silently becomes a new normal owner. Roster drift excludes
-- the original employee as unavailable DATA, not a fabricated canonical PTO.
CREATE FUNCTION public.static_weekly_manual_recurring_roster_unavailable(p_source jsonb,p_frame date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT coalesce(jsonb_agg(jsonb_build_object('serviceDate',d::date::text,'slotId',s->'id','employeeId',i->'personId') ORDER BY d,s->>'id'),'[]')
 FROM generate_series(p_frame,p_frame+6,'1 day') days(d)
 CROSS JOIN LATERAL jsonb_array_elements(p_source->'slots') slots(s)
 CROSS JOIN LATERAL jsonb_array_elements(s->'incumbencies') inc(i)
 JOIN LATERAL jsonb_array_elements(p_source#>'{version,slotAvailability}') av(a)
  ON a->'slotId'=s->'id' AND (a->>'dayOfWeek')::integer=extract(dow FROM d)::integer AND a->>'status'='working'
 WHERE (i->>'effectiveStart')::date<=d::date AND (i->>'effectiveEnd' IS NULL OR d::date<(i->>'effectiveEnd')::date)
  AND NOT EXISTS(SELECT 1 FROM public.v_weekly_roster_slot_incumbency_ranges r JOIN public.employees e ON e.id=r.person_id
   WHERE r.slot_id=(s->>'id')::uuid AND r.person_id=(i->>'personId')::uuid AND r.effective_start<=d::date
    AND (r.effective_end IS NULL OR d::date<r.effective_end) AND e.active)
$fn$;
CREATE FUNCTION public.static_weekly_manual_recurring_basis(p_manager uuid,p_publication uuid,p_frame date,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE basis jsonb;fixed_source jsonb;slots jsonb;canonical jsonb;days jsonb;body jsonb;
BEGIN
 basis:=public.static_weekly_manual_period_basis(p_manager,p_publication,p_frame,p_revision,NULL);
 SELECT s.canonical_source INTO STRICT canonical FROM public.static_weekly_authority_source_documents s
 WHERE s.source_id=(basis->>'sourceId')::uuid AND s.active AND s.retired_at IS NULL;
 IF NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_confirmations c WHERE c.publication_id=p_publication)
 THEN RAISE EXCEPTION 'Original accepted manual activation required';END IF;
 -- Preserve actual publication/version metadata, immutable original normal slots.
 fixed_source:=jsonb_set(basis->'normalSource','{slots}',canonical->'slots',false);
 SELECT coalesce(jsonb_agg(a.day_json||jsonb_build_object('choiceId',q.choice_id) ORDER BY a.service_date,a.operation_id),'[]') INTO days
 FROM custodial_coverall.accepted_days a JOIN custodial_coverall.choices q USING(operation_id)
 JOIN public.static_weekly_staffing_commands c USING(operation_id)
 WHERE a.publication_id=p_publication AND a.service_date BETWEEN p_frame AND p_frame+6 AND c.state='ACCEPTED'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_coverall_effective_facts(p_publication,p_frame)) e
    WHERE e->>'type'='cover_all' AND e->>'coverAllChoiceId'=q.choice_id::text AND e->>'serviceDate'=a.service_date::text);
 body:=(basis-'basisDigest')||jsonb_build_object('normalSource',fixed_source,'normalSourceDigest',public.static_weekly_digest_jsonb(fixed_source),
  'rosterUnavailableByDate',public.static_weekly_manual_recurring_roster_unavailable(fixed_source,p_frame),'acceptedCoverAllDays',days);
 IF jsonb_array_length(body->'employmentByDate')<>7 OR jsonb_array_length(body->'employmentRevisionVector')<>14
 THEN RAISE EXCEPTION 'Seven actual employment reads and14 bindings required';END IF;
 RETURN body||jsonb_build_object('basisDigest',public.static_weekly_digest_jsonb(body));
END $fn$;
CREATE FUNCTION public.static_weekly_begin_manual_recurring(p_request jsonb,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE manager uuid;op uuid;pub uuid;rev bigint;frame date;origin date;sid uuid;vid uuid;actor jsonb;basis jsonb;repeat_basis jsonb;
 prior custodial_coverall.recurring_materialization_operations%rowtype;receipt jsonb;source_digest text;catalog text;generation bigint;needs_native boolean;reason jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 IF p_request IS NULL OR pg_column_size(p_request)>16384 THEN RAISE EXCEPTION 'Bounded recurring original request required';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_request,
  ARRAY['schema','kind','operationId','managerId','publicationId','serviceDate','expectedRevision','idempotencyKey'],
  ARRAY['schema','kind','operationId','managerId','publicationId','serviceDate','expectedRevision','idempotencyKey'],'recurring original request');
 IF p_request->>'schema'<>'custodial.approved-manual-recurring-request.v1' OR p_request->>'kind'<>'RECURRING_MANUAL_MATERIALIZATION'
  OR jsonb_typeof(p_request->'idempotencyKey') IS DISTINCT FROM 'string' OR jsonb_typeof(p_request->'expectedRevision') IS DISTINCT FROM 'number'
  OR length(p_request->>'idempotencyKey') NOT BETWEEN 1 AND 200 OR btrim(p_request->>'idempotencyKey')<>p_request->>'idempotencyKey'
 THEN RAISE EXCEPTION 'Exact typed recurring request required';END IF;
 manager:=(p_request->>'managerId')::uuid;op:=(p_request->>'operationId')::uuid;pub:=(p_request->>'publicationId')::uuid;
 rev:=(p_request->>'expectedRevision')::bigint;frame:=(p_request->>'serviceDate')::date;
 actor:=public.custodial_action_actor_v1(manager,p_credential,p_device,p_access,'write');
 SELECT * INTO prior FROM custodial_coverall.recurring_materialization_operations WHERE manager_id=manager AND idempotency_key=p_request->>'idempotencyKey';
 IF FOUND THEN
  IF prior.request_json IS DISTINCT FROM p_request THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original recurring operation identity conflict';END IF;
  SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=prior.operation_id;
  RETURN jsonb_build_object('state','ORIGINAL_RECEIPT','operationId',op,'receipt',receipt,'currentReadbackRepeated',false);
 END IF;
 IF rev IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton) OR frame IS NULL OR NOT isfinite(frame)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current recurring revision/date required';END IF;
 SELECT v.authority_source_id,v.version_id,p.effective_start,s.source_digest INTO STRICT sid,vid,origin,source_digest
 FROM public.weekly_schedule_publications p JOIN public.weekly_schedule_versions v USING(version_id)
 JOIN public.static_weekly_authority_source_documents s ON s.source_id=v.authority_source_id AND s.active AND s.retired_at IS NULL WHERE p.publication_id=pub;
 IF frame<origin OR mod(frame-origin,7)<>0 THEN RAISE EXCEPTION 'Exact publication-origin aligned frame required';END IF;
 needs_native:=frame=origin;
 IF NOT needs_native THEN
  repeat_basis:=public.static_weekly_read_manual_repeat_basis(manager,pub,frame,rev,p_credential,p_device,p_access);
  needs_native:=jsonb_array_length(repeat_basis->'adjustmentReasons')>0 OR jsonb_array_length(repeat_basis->'acceptedExceptions')>0 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(repeat_basis->'employmentByDate') ed CROSS JOIN LATERAL jsonb_array_elements(ed->'employees') ee
    JOIN LATERAL jsonb_array_elements(repeat_basis->'participants') part ON part->'serviceDate'=ed->'serviceDate'
   WHERE (ee#>>'{command,fact,state}'='PRE_START' OR (ed->>'serviceDate')::date<(ee#>>'{command,fact,firstServiceDate}')::date)
    AND ((part->'assignmentEmployeeIds')?(ee->>'employeeId') OR (part->'lunchOwnerEmployeeIds')?(ee->>'employeeId') OR (part->'lunchCovererEmployeeIds')?(ee->>'employeeId')));
 END IF;
 IF needs_native THEN basis:=public.static_weekly_manual_recurring_basis(manager,pub,frame,rev);repeat_basis:=NULL;END IF;
 catalog:=coalesce(basis->>'catalogEntryDigest',repeat_basis->>'catalogEntryDigest');generation:=coalesce((basis->>'generation')::bigint,(repeat_basis->>'generation')::bigint);
 PERFORM public.custodial_begin_application_mutation();
 INSERT INTO custodial_coverall.recurring_materialization_operations VALUES(op,manager,p_request->>'idempotencyKey',p_request,
  pg_current_xact_id(),pg_backend_pid(),p_credential,p_device,p_access,sid,pub,vid,frame,rev,basis,repeat_basis,source_digest,catalog,generation);
 RETURN jsonb_build_object('state',CASE WHEN needs_native THEN 'NATIVE_ADJUSTMENT_REQUIRED' ELSE 'NORMAL_REFERENCE_REQUIRED' END,
  'operationId',op,'backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text,'basis',basis,'repeatBasis',repeat_basis,'accepted',false,'committed',false);
END $fn$;
CREATE FUNCTION public.static_weekly_manual_recurring_context(p_operation uuid,p_manager uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.recurring_materialization_operations%rowtype;stage_row custodial_coverall.recurring_materialization_stages%rowtype;
 employment jsonb:='[]';vector jsonb;service_day date;source_digest text;catalog text;ctx jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid()
  OR a.authority_revision IS DISTINCT FROM(SELECT current_revision FROM public.static_weekly_schedule_control WHERE singleton)
  OR a.generation IS DISTINCT FROM public.static_weekly_v15_read_recurring_generation()
  OR public.static_weekly_effective_version(a.frame_start) IS DISTINCT FROM a.version_id
  OR public.static_weekly_effective_version(a.frame_start+6) IS DISTINCT FROM a.version_id
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original physical recurring transaction/revision/generation/publication changed';END IF;
 PERFORM public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 IF a.basis_json IS NULL THEN RAISE EXCEPTION 'Native recurring context required';END IF;
 SELECT s.source_digest,c.catalog_entry_digest INTO STRICT source_digest,catalog FROM public.static_weekly_authority_source_documents s
 JOIN public.static_weekly_approved_initial_baselines b ON b.source_id=s.source_id JOIN public.static_weekly_approved_template_catalog c USING(template_id)
 WHERE s.source_id=a.source_id AND s.active AND s.retired_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements r WHERE r.template_id=c.template_id);
 FOR service_day IN SELECT generate_series(a.frame_start,a.frame_start+6,'1 day')::date LOOP employment:=employment||jsonb_build_array(custodial_employment.native_read(service_day,a.authority_revision,p_manager));END LOOP;
 SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId','employmentRevision',e->'employmentRevision',
  'requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId') INTO vector
 FROM jsonb_array_elements(employment) days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e);
 IF source_digest IS DISTINCT FROM a.source_digest OR catalog IS DISTINCT FROM a.catalog_digest
  OR employment IS DISTINCT FROM a.basis_json->'employmentByDate' OR vector IS DISTINCT FROM a.basis_json->'employmentRevisionVector'
  OR public.static_weekly_compiler_exception_set(a.publication_id,a.frame_start) IS DISTINCT FROM a.basis_json->'preparedExceptions'
  OR public.static_weekly_accepted_exception_set(a.publication_id,a.frame_start) IS DISTINCT FROM a.basis_json->'preparedSummary'
  OR public.static_weekly_manual_recurring_roster_unavailable(a.basis_json->'normalSource',a.frame_start) IS DISTINCT FROM a.basis_json->'rosterUnavailableByDate'
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Actual recurring source/catalog/accepted facts/employment14/roster changed';END IF;
 SELECT * INTO stage_row FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 RETURN jsonb_build_object('schema','custodial.recurring-employment-native-sql-context.v1','kind','RECURRING_MANUAL_MATERIALIZATION',
  'operationId',p_operation,'managerId',p_manager,'publicationId',a.publication_id,'versionId',a.version_id,'sourceId',a.source_id,
  'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',a.authority_revision,'basis',a.basis_json,
  'stagedEnvelope',stage_row.envelope_json,'stagedLunch',stage_row.lunch_json,'candidateDigest',stage_row.candidate_digest);
END $fn$;
CREATE FUNCTION public.static_weekly_recurring_exact_accepted_coverall_fact(p_operation uuid,p_manager uuid,p_publication uuid,p_frame date,p_fact jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM custodial_coverall.recurring_materialization_operations o
  WHERE o.operation_id=p_operation AND o.manager_id=p_manager AND o.publication_id=p_publication AND o.frame_start=p_frame
   AND o.owner_xid=pg_current_xact_id() AND o.backend_pid=pg_backend_pid())
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.static_weekly_coverall_effective_facts(p_publication,p_frame)) e WHERE e=p_fact)
$fn$;

-- Preserve the installed full Main guard. Exact source-body hash and whole
-- inverse are mandatory: every native feasibility/hour/lunch check survives.
DO $guard_copy$
DECLARE original text;changed text;inverse text;seams jsonb;item jsonb;
BEGIN
 IF public.static_weekly_digest_text((SELECT prosrc FROM pg_proc WHERE oid='public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)'::regprocedure))
  IS DISTINCT FROM '851cb804b31409e79d386808d5e7982e920f8c8847824418b24a3c7d6212acff' THEN RAISE EXCEPTION 'Current Main initial guard body differs from selected predecessor';END IF;
 original:=pg_get_functiondef('public.static_weekly_manual_assert_initial_employment_projection(uuid,uuid,jsonb,jsonb)'::regprocedure);
 SELECT jsonb_agg(jsonb_build_object('n',n,'before',a,'after',b) ORDER BY n) INTO seams FROM(VALUES
(0,$before0$FUNCTION public.static_weekly_manual_assert_initial_employment_projection($before0$,$after0$FUNCTION public.static_weekly_manual_assert_recurring_projection($after0$),
(1,$before1$public.static_weekly_coverall_initial_context(p_operation,p_manager)$before1$,$after1$public.static_weekly_manual_recurring_context(p_operation,p_manager)$after1$),
(2,$before2$custodial.initial-employment-native-sql-context.v1$before2$,$after2$custodial.recurring-employment-native-sql-context.v1$after2$),
(3,$before3$INITIAL_EMPLOYMENT_OPERATIONALIZATION$before3$,$after3$RECURRING_MANUAL_MATERIALIZATION$after3$),
(4,$before4$initialActivation$before4$,$after4$recurringOperation$after4$),
(5,$before5$custodial.approved-manual-initial-employment-snapshot.v1$before5$,$after5$custodial.approved-manual-recurring-adjustment-snapshot.v1$after5$),
(6,$before6$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;$before6$,$after6$count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;
 coverall jsonb;choice_day jsonb;capacity_id text;replaced_id text;is_coverall boolean;$after6$),
(7,$before7$if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')$before7$,$after7$if exists(select 1 from jsonb_array_elements(exceptions) e where (e->>'type' not in('pto','daily_absence') or e ? 'window')
  and (e->>'type' not in('cover_all','lunch') or not e ? 'coverAllChoiceId'
   or not public.static_weekly_recurring_exact_accepted_coverall_fact(p_operation,p_manager,publication,frame,e)))$after7$),
(8,$before8$ select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$before8$,$after8$ -- Add only the exact selected active capacity; inactive templates do not create employees.
 for day_basis in select value from jsonb_array_elements(a->'datedDayBases') where value->>'kind'='COVERALL' loop
  coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
  choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';
  select coalesce(jsonb_agg(r),'[]') into expected_availability from jsonb_array_elements(expected_availability) r
   where not(r->>'serviceDate'=choice_day->>'serviceDate' and r->>'slotId'=capacity_id);
  expected_availability:=expected_availability||jsonb_build_array(public.static_weekly_coverall_capacity_availability(source,choice_day)||jsonb_build_object(
   'serviceDate',choice_day->'serviceDate','incumbentPersonId',null,'incumbentName',null,'ownerKind','CONTRACTOR_CAPACITY','capacityId',capacity_id));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;$after8$),
(9,$before9$  if day_changed then
   if jsonb_array_length(absent)$before9$,$after9$  is_coverall:=day_basis->>'kind'='COVERALL';coverall:=null;choice_day:=null;capacity_id:=null;replaced_id:=null;
  if coalesce(is_coverall,false) then
   coverall:=public.static_weekly_coverall_assert_retained_day(p_operation,p_manager,day_basis,publication);
   choice_day:=coverall->'choiceDay';capacity_id:=choice_day->>'capacityId';replaced_id:=coverall->>'replacedSlotId';
   if jsonb_array_length(absent)<>3 or absent is distinct from day_basis#>'{overlay,absentPersonIds}' then raise exception 'Exact third actual absence required';end if;
   input:=day_basis->'input';plan:=day_basis->'overlay';
   select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'unavailabilityClassification'='PRE_START_NOT_PTO';
   if coalesce(input->'preStartPersonIds','[]') is distinct from expected then raise exception 'Retained2 pre-start classification differs from current actual employment reads';end if;
   complete_start:=plan#>>'{checkedWindow,start}';complete_end:=plan#>>'{checkedWindow,end}';
  end if;
  if day_changed and not coalesce(is_coverall,false) then
   if jsonb_array_length(absent)$after9$),
(10,$before10$   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';$before10$,$after10$   if coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then owner_config:='{}';
   else select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';end if;$after10$),
(11,$before11$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'$before11$,$after11$or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id'
    or (case when coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id then
      item->>'owner_kind' is distinct from 'CONTRACTOR_CAPACITY' or item->>'capacity_id' is distinct from capacity_id or item->'owner_person_id' is distinct from 'null'::jsonb
     else item ? 'owner_kind' or item ? 'capacity_id' end)$after11$),
(12,$before12$if day_changed and (window_end>parent#>>'{window,end}' or window_start<case$before12$,$after12$if day_changed and ((window_end>parent#>>'{window,end}' and not(coalesce(is_coverall,false) and item->>'owner_slot_id'=capacity_id
     and parent#>>'{window,end}'=normal_end and window_end<=choice_day#>>'{shift,end}')) or window_start<case$after12$),
(13,$before13$if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'$before13$,$after13$if day_changed and window_start<complete_start and ((item->'owner_slot_id' is distinct from parent->'ownerSlotId'
     and not(coalesce(is_coverall,false) and parent->>'ownerSlotId'=replaced_id and item->>'owner_slot_id'=capacity_id))$after13$),
(14,$before14$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)$before14$,$after14$where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
     and not(coalesce(is_coverall,false) and previous_owner=capacity_id and exists(
      select 1 from jsonb_array_elements(day_basis#>'{input,roster}') retained_owner
       where retained_owner->>'slotId'=replaced_id and retained_owner#>>'{shift,end}'=window_start))$after14$),
(15,$before15$  if day_changed then
   perform public.static_weekly_manual_assert_absence_score$before15$,$after15$  if day_changed and not coalesce(is_coverall,false) then
   perform public.static_weekly_manual_assert_absence_score$after15$),
(16,$before16$  if base->>'status'='working' and employment_employee is not null and$before16$,$after16$  if base->>'status'='working' and exists(select 1 from jsonb_array_elements(basis->'rosterUnavailableByDate') r
   where r->>'serviceDate'=day::text and r->'slotId'=base->'slotId' and r->'employeeId'=person->'personId') then
   availability:=availability||'{"status":"absent","blockedWindows":[{"start":"00:00","end":"23:59"}]}'::jsonb;
  end if;
  if base->>'status'='working' and employment_employee is not null and$after16$),
(17,$before17$  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);$before17$,$after17$  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and exists(select 1 from jsonb_array_elements(basis->'rosterUnavailableByDate') r where r->>'serviceDate'=day::text)
  then availability:=availability||'{"blockedWindows":[]}'::jsonb;end if;$after17$),
(18,$before18$ perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);$before18$,$after18$ if exists(select 1 from jsonb_array_elements(p_envelope->'assignments') assigned where assigned->>'owner_person_id' is not null
  and not exists(select 1 from public.v_weekly_roster_slot_incumbency_ranges r join public.employees e on e.id=r.person_id
   where r.slot_id=(assigned->>'owner_slot_id')::uuid and r.person_id=(assigned->>'owner_person_id')::uuid and r.effective_start<=(assigned->>'service_date')::date
    and (r.effective_end is null or (assigned->>'service_date')::date<r.effective_end) and e.active))
 then raise exception 'Recurring assignment cannot use a displaced/inactive historical employee';end if;
 perform public.static_weekly_manual_assert_native_lunch(NULL,p_lunch,p_envelope,publication,frame);$after18$)
 ) seam_rows(n,a,b);
 changed:=original;
 FOR item IN SELECT value FROM jsonb_array_elements(seams) LOOP
  IF position(item->>'before' IN changed)=0 OR position(item->>'after' IN changed)>0 THEN RAISE EXCEPTION 'Recurring native factoring seam changed: %',item->>'n';END IF;
  IF (item->>'n')::integer NOT IN(3,4) AND length(changed)-length(replace(changed,item->>'before',''))<>length(item->>'before') THEN RAISE EXCEPTION 'Recurring native seam not unique';END IF;
  changed:=replace(changed,item->>'before',item->>'after');
 END LOOP;
 inverse:=changed;FOR item IN SELECT value FROM jsonb_array_elements(seams) ORDER BY (value->>'n')::integer DESC LOOP inverse:=replace(inverse,item->>'after',item->>'before');END LOOP;
 IF inverse<>original THEN RAISE EXCEPTION 'Recurring native full inverse differs';END IF;EXECUTE changed;
END $guard_copy$;
CREATE FUNCTION public.static_weekly_manual_recurring_assert_payload(p_operation uuid,p_manager uuid,p_envelope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;proof jsonb;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);
 IF ctx->'stagedEnvelope' IS DISTINCT FROM p_envelope THEN RAISE EXCEPTION 'Exact same-transaction recurring stage required';END IF;
 proof:=public.static_weekly_manual_assert_recurring_projection(p_operation,p_manager,p_envelope,ctx->'stagedLunch');
 IF proof->'projection_assignments' IS DISTINCT FROM p_envelope->'assignments' OR jsonb_typeof(proof->'assignment_links') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Full native recurring feasibility/assignment proof required';END IF;
 RETURN proof;
END $fn$;
CREATE FUNCTION public.static_weekly_stage_manual_recurring(p_operation uuid,p_manager uuid,p_envelope jsonb,p_lunch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;prior custodial_coverall.recurring_materialization_stages%rowtype;fingerprint text;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 IF p_envelope IS NULL OR p_lunch IS NULL OR pg_column_size(p_envelope)>16777216 OR pg_column_size(p_lunch)>16777216
 THEN RAISE EXCEPTION 'Bounded actual native recurring projection and lunch required';END IF;
 fingerprint:=public.static_weekly_digest_jsonb(jsonb_build_object('envelope',p_envelope,'lunch',p_lunch));
 SELECT * INTO prior FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 IF FOUND THEN
  IF prior.envelope_json IS DISTINCT FROM p_envelope OR prior.lunch_json IS DISTINCT FROM p_lunch OR prior.candidate_digest<>fingerprint
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Original recurring candidate conflict';END IF;
 ELSE INSERT INTO custodial_coverall.recurring_materialization_stages VALUES(p_operation,p_envelope,p_lunch,fingerprint);END IF;
 PERFORM public.static_weekly_manual_recurring_assert_payload(p_operation,p_manager,p_envelope);
 RETURN jsonb_build_object('state','STAGED_UNCOMMITTED','operationId',p_operation,'candidateDigest',fingerprint,'committed',false);
END $fn$;
DO $sink_copy$
DECLARE original text;changed text;inverse text;needle text;replacement text;
BEGIN
 original:=pg_get_functiondef('public.static_weekly_coverall_initial_projection_sink(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text,text)'::regprocedure);
 needle:=$before$v_pending_validation:=public.static_weekly_coverall_initial_assert_payload((p_assignments#>>'{semantic_snapshot,initialActivation,operationId}')::uuid,p_actor_manager_id,p_assignments);$before$;
 replacement:=$after$v_pending_validation:=public.static_weekly_manual_recurring_assert_payload((p_assignments#>>'{semantic_snapshot,recurringOperation,operationId}')::uuid,p_actor_manager_id,p_assignments);$after$;
 IF length(original)-length(replace(original,needle,''))<>length(needle)
  OR length(original)-length(replace(original,'FUNCTION public.static_weekly_coverall_initial_projection_sink(',''))<>length('FUNCTION public.static_weekly_coverall_initial_projection_sink(')
 THEN RAISE EXCEPTION 'Selected native relational sink seam differs';END IF;
 changed:=replace(replace(original,'FUNCTION public.static_weekly_coverall_initial_projection_sink(','FUNCTION public.static_weekly_manual_recurring_projection_sink('),needle,replacement);
 inverse:=replace(replace(changed,replacement,needle),'FUNCTION public.static_weekly_manual_recurring_projection_sink(','FUNCTION public.static_weekly_coverall_initial_projection_sink(');
 IF inverse<>original THEN RAISE EXCEPTION 'Recurring native sink whole inverse differs';END IF;EXECUTE changed;
END $sink_copy$;
CREATE FUNCTION public.static_weekly_finalize_manual_recurring(p_operation uuid,p_manager uuid,p_candidate_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE ctx jsonb;a custodial_coverall.recurring_materialization_operations%rowtype;s custodial_coverall.recurring_materialization_stages%rowtype;
 actor jsonb;stored jsonb;lunch jsonb;receipt jsonb;projection uuid;revision bigint;
BEGIN
 ctx:=public.static_weekly_manual_recurring_context(p_operation,p_manager);PERFORM public.custodial_begin_application_mutation();
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 SELECT * INTO STRICT s FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=p_operation;
 IF s.candidate_digest IS DISTINCT FROM p_candidate_digest THEN RAISE EXCEPTION 'Original recurring candidate digest required';END IF;
 PERFORM public.static_weekly_manual_recurring_assert_payload(p_operation,p_manager,s.envelope_json);
 actor:=public.custodial_action_actor_v1(p_manager,a.credential_id,a.device_id,a.session_access,'write');
 stored:=public.static_weekly_manual_recurring_projection_sink(a.publication_id,a.frame_start,
  public.static_weekly_digest_jsonb(a.basis_json->'preparedSummary'),s.envelope_json->>'compiler_version',s.envelope_json->'objective',s.envelope_json->'metrics',
  s.envelope_json->>'replay_digest',s.envelope_json,a.authority_revision,p_manager,actor->>'manager_name','manual-recurring:'||p_operation);
 projection:=(stored#>>'{data,projection_id}')::uuid;
 IF projection IS NULL THEN RAISE EXCEPTION 'Actual native recurring projection ID missing';END IF;
 lunch:=public.static_weekly_v8_materialize_lunch_document(projection,s.lunch_json,p_manager);
 IF lunch->'ok' IS DISTINCT FROM 'true'::jsonb OR lunch->>'persistence_status' IS DISTINCT FROM 'PERSISTED'
  OR lunch->>'document_identity' IS DISTINCT FROM s.lunch_json->>'document_identity'
  OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
   WHERE p.projection_id=projection AND p.publication_id=a.publication_id AND p.version_id=a.version_id AND p.week_start=a.frame_start AND p.week_end=a.frame_start+6
    AND p.projection_envelope=s.envelope_json AND l.document_json=s.lunch_json AND l.document_identity=s.lunch_json->>'document_identity')
 THEN RAISE EXCEPTION 'Actual same-transaction recurring projection/full-hour lunch missing';END IF;
 SELECT current_revision INTO STRICT revision FROM public.static_weekly_schedule_control WHERE singleton;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v2','kind','RECURRING_MANUAL_MATERIALIZATION','status','PERSISTED_CURRENT',
  'operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,'versionId',a.version_id,
  'projectionId',projection,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',revision,'candidateDigest',s.candidate_digest,
  'lunchDocumentIdentity',s.lunch_json->'document_identity','employmentRevisionVector',a.basis_json->'employmentRevisionVector',
  'normalPatternSolverInvoked',false,'operationalSelectionSolverInvoked',s.envelope_json#>'{receipt,selectionSolverInvoked}',
  'normalSourceChanged',false,'newStaffingCommandCreated',false,'newPTOCreated',false,'samePhysicalTransaction',true);
 INSERT INTO custodial_coverall.recurring_materialization_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_finish_manual_recurring_normal(p_operation uuid,p_manager uuid,p_reference jsonb,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE a custodial_coverall.recurring_materialization_operations%rowtype;r jsonb;receipt jsonb;projection uuid;doc text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT a FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=p_operation;
 IF a.manager_id<>p_manager OR a.owner_xid<>pg_current_xact_id() OR a.backend_pid<>pg_backend_pid() OR a.repeat_basis IS NULL
  OR p_reference->>'managerId' IS DISTINCT FROM p_manager::text OR p_reference->>'requestId' IS DISTINCT FROM p_operation::text
  OR p_reference->>'publicationId' IS DISTINCT FROM a.publication_id::text OR p_reference->>'sourceId' IS DISTINCT FROM a.source_id::text
  OR p_reference->>'frameStart' IS DISTINCT FROM a.frame_start::text OR (p_reference->>'expectedRevision')::bigint IS DISTINCT FROM a.authority_revision
  OR p_reference->'employmentRevisionVector' IS DISTINCT FROM(SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId',
    'employmentRevision',e->'employmentRevision','requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId')
    FROM jsonb_array_elements(a.repeat_basis->'employmentByDate') days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e))
 THEN RAISE EXCEPTION 'Original physical recurring normal request/reference differs';END IF;
 r:=public.static_weekly_materialize_manual_repeat(p_reference,p_digest,a.credential_id,a.device_id,a.session_access);
 IF r->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT' THEN RAISE EXCEPTION 'Normal repeat did not accept current source/employment';END IF;
 projection:=(r->>'projection_id')::uuid;doc:=r->>'lunch_document_identity';
 IF projection IS NULL OR doc IS NULL OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections p
  JOIN public.weekly_schedule_lunch_documents l USING(projection_id) WHERE p.projection_id=projection AND p.publication_id=a.publication_id
   AND p.week_start=a.frame_start AND p.week_end=a.frame_start+6 AND l.document_identity=doc)
 THEN RAISE EXCEPTION 'Actual repeated normal/lunch row missing';END IF;
 receipt:=jsonb_build_object('schema','custodial.approved-manual-recurring-confirmation.v2','kind','RECURRING_MANUAL_MATERIALIZATION','status','PERSISTED_CURRENT',
  'operationId',p_operation,'managerId',p_manager,'sourceId',a.source_id,'publicationId',a.publication_id,'versionId',a.version_id,
  'projectionId',projection,'frameStart',a.frame_start,'frameEnd',a.frame_start+6,'authorityRevision',r->'authority_revision','lunchDocumentIdentity',doc,
  'normalPatternSolverInvoked',false,'operationalSelectionSolverInvoked',false,'normalSourceChanged',false,'samePhysicalTransaction',true,
  'originalRepeatReceipt',r,'employmentRevisionVector',p_reference->'employmentRevisionVector');
 INSERT INTO custodial_coverall.recurring_materialization_receipts VALUES(p_operation,receipt);RETURN receipt;
END $fn$;
CREATE FUNCTION public.static_weekly_read_manual_recurring_outcome(p_manager uuid,p_key text,p_credential uuid,p_device text,p_access text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.custodial_action_actor_v1(p_manager,p_credential,p_device,p_access,'read');
 SELECT jsonb_build_object('request',o.request_json,'receipt',r.receipt_json,'currentReadbackRepeated',false) INTO result
 FROM custodial_coverall.recurring_materialization_operations o JOIN custodial_coverall.recurring_materialization_receipts r USING(operation_id)
 WHERE o.manager_id=p_manager AND o.idempotency_key=p_key;
 RETURN result;-- NULL never authorizes automatic resend of an UNKNOWN operation.
END $fn$;
DO $private$ DECLARE r record;sig text;BEGIN
 FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY['static_weekly_manual_recurring_require_receipt','static_weekly_manual_recurring_roster_unavailable',
   'static_weekly_manual_recurring_basis','static_weekly_begin_manual_recurring','static_weekly_manual_recurring_context','static_weekly_recurring_exact_accepted_coverall_fact',
   'static_weekly_manual_assert_recurring_projection','static_weekly_manual_recurring_assert_payload','static_weekly_stage_manual_recurring',
   'static_weekly_manual_recurring_projection_sink','static_weekly_finalize_manual_recurring','static_weekly_finish_manual_recurring_normal','static_weekly_read_manual_recurring_outcome'])
 LOOP EXECUTE format('revoke all on function %s from public,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',r.sig);END LOOP;
END $private$;
GRANT EXECUTE ON FUNCTION public.static_weekly_begin_manual_recurring(jsonb,uuid,text,text),public.static_weekly_stage_manual_recurring(uuid,uuid,jsonb,jsonb),
 public.static_weekly_finalize_manual_recurring(uuid,uuid,text),public.static_weekly_finish_manual_recurring_normal(uuid,uuid,jsonb,text),
 public.static_weekly_read_manual_recurring_outcome(uuid,text,uuid,text,text) TO static_weekly_control_plane;


-- COMPONENT notification_continuity SHA256 67d6ca0bce075b4110afce588d721c13258f9f33c0b678634f3f2e28d6df636c
-- Proposal only: not a canonical migration and not applied.
-- Requires Main's accepted-native manual projection + lunch-lineage components.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- Private membership lookup. Only persisted current SQL authority can return a basis.
-- No caller document, preparation label, job update, clock adjustment or delivery replay.
CREATE OR REPLACE FUNCTION public.static_weekly_manual_lunch_current_basis(
 p_source uuid,p_source_document text,p_notification_key text,p_service_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $continuity$
DECLARE
 authority record;origin public.weekly_schedule_compiled_projections%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;
 prior_projection public.weekly_schedule_compiled_projections%rowtype;
 original_doc public.weekly_schedule_lunch_documents%rowtype;
 current_doc public.weekly_schedule_lunch_documents%rowtype;
 prior_doc public.weekly_schedule_lunch_documents%rowtype;
 original_intent jsonb;intent jsonb;original_loan jsonb;loan jsonb;retention jsonb;
 expected jsonb;actual jsonb;matches integer;visited uuid[]:='{}';hop integer:=0;
 current_id uuid;current_identity text;
BEGIN
 IF p_source IS NULL OR p_service_date IS NULL OR NOT isfinite(p_service_date)
  OR coalesce(p_source_document,'') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_notification_key,'') !~ '^[0-9a-f]{64}$' THEN RETURN NULL;END IF;
 SELECT * INTO authority FROM public.static_weekly_v6_schedule_authority_state(p_service_date);
 IF authority.governed IS NOT TRUE OR authority.projection_status IS DISTINCT FROM 'current'
  OR authority.projection_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_source;
 SELECT * INTO original_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_source;
 SELECT * INTO current_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=authority.projection_id;
 SELECT * INTO current_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=authority.projection_id;
 IF origin.projection_id IS NULL OR original_doc.projection_id IS NULL
  OR current_projection.projection_id IS NULL OR current_doc.projection_id IS NULL
  OR original_doc.document_identity IS DISTINCT FROM p_source_document
  OR origin.publication_id IS DISTINCT FROM authority.publication_id
  OR origin.version_id IS DISTINCT FROM authority.version_id
  OR origin.week_start IS DISTINCT FROM current_projection.week_start
  OR origin.week_end IS DISTINCT FROM current_projection.week_end
  OR p_service_date NOT BETWEEN origin.week_start AND origin.week_end THEN RETURN NULL;END IF;
 PERFORM public.static_weekly_v8_assert_lunch_document(origin.projection_id,original_doc.document_json);
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT n INTO original_intent FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT l INTO original_loan FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 current_id:=current_projection.projection_id;current_identity:=current_doc.document_identity;
 LOOP
  -- Fail closed after 128 immutable links or a cycle; never repair/reset a job.
  hop:=hop+1;
  IF hop>128 OR current_projection.projection_id=ANY(visited)
   OR current_projection.publication_id IS DISTINCT FROM origin.publication_id
   OR current_projection.version_id IS DISTINCT FROM origin.version_id
   OR current_projection.week_start IS DISTINCT FROM origin.week_start
   OR current_projection.week_end IS DISTINCT FROM origin.week_end
   OR current_doc.projection_id IS DISTINCT FROM current_projection.projection_id
   OR current_doc.document_identity IS DISTINCT FROM current_doc.document_json->>'document_identity'
   THEN RETURN NULL;END IF;
  visited:=array_append(visited,current_projection.projection_id);
  PERFORM public.static_weekly_v8_assert_lunch_document(current_projection.projection_id,current_doc.document_json);
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT n INTO intent FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF intent IS DISTINCT FROM original_intent THEN RETURN NULL;END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT l INTO loan FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF loan-'total_distance_minutes' IS DISTINCT FROM original_loan-'total_distance_minutes' THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'responsibilities') r WHERE r->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'responsibilities') r WHERE r->'loan_id'=loan->'loan_id';
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n WHERE n->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n WHERE n->'loan_id'=loan->'loan_id';
  IF actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  -- Original spoken owner/principal and original shift-end validity remain exact.
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO expected
   FROM jsonb_array_elements(origin.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=original_loan->>'normal_owner_slot_id' OR original_loan->'helper_slot_ids' ? (a->>'slotId'));
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO actual
   FROM jsonb_array_elements(current_projection.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=loan->>'normal_owner_slot_id' OR loan->'helper_slot_ids' ? (a->>'slotId'));
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  IF current_projection.projection_id=p_source THEN
   IF current_doc.document_identity IS DISTINCT FROM p_source_document THEN RETURN NULL;END IF;
   RETURN jsonb_build_object('source_projection_id',p_source,'source_document_identity',p_source_document,
    'current_projection_id',current_id,'current_document_identity',current_identity,'notification_key',p_notification_key);
  END IF;
  IF current_projection.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR current_projection.projection_envelope->'adapter' IS DISTINCT FROM
    '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
   THEN RETURN NULL;END IF;
  retention:=current_projection.projection_envelope#>'{authority,lunchIdentityRetention}';
  IF retention IS NULL THEN RETURN NULL;END IF;
  PERFORM public.static_weekly_assert_exact_object(retention,
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'notification immutable lunch lineage');
  IF retention->>'schema' IS DISTINCT FROM 'custodial.approved-manual-lunch-identity-retention.v1'
   OR retention->'requiresSqlOwnerCurrentnessCheck' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(retention->'loans') IS DISTINCT FROM 'array'
   OR coalesce(retention->>'priorDocumentIdentity','') !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM jsonb_array_elements(retention->'loans') r
    WHERE r=jsonb_build_object('serviceDate',p_service_date::text,'normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id'))<>1
   THEN RETURN NULL;END IF;
  SELECT * INTO prior_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=(retention->>'priorProjectionId')::uuid;
  SELECT * INTO prior_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=prior_projection.projection_id;
  IF prior_projection.projection_id IS NULL OR prior_doc.projection_id IS NULL
   OR prior_doc.document_identity IS DISTINCT FROM retention->>'priorDocumentIdentity' THEN RETURN NULL;END IF;
  current_projection:=prior_projection;current_doc:=prior_doc;
 END LOOP;
EXCEPTION WHEN data_exception OR check_violation OR cardinality_violation THEN RETURN NULL;
END $continuity$;
-- Inherit the maintained consumer owner. The source installer is postgres in
-- Supabase and supabase_admin in the owned replay; do not invent a new role.
DO $continuity_owner$
DECLARE authority_owner name;owners name[];
BEGIN
 SELECT array_agg(DISTINCT pg_get_userbyid(p.proowner)::name) INTO owners
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('mz_enqueue_employee_lunch_coverage_pushes',
  'custodial_native_target_source_at','custodial_native_lunch_live','static_weekly_v27_original_native_bindings');
 IF array_length(owners,1) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Notification consumer ownership requires exact reconciliation';END IF;
 authority_owner:=owners[1];
 EXECUTE format('ALTER FUNCTION public.static_weekly_manual_lunch_current_basis(uuid,text,text,date) OWNER TO %I',authority_owner);
END $continuity_owner$;
REVOKE ALL ON FUNCTION public.static_weekly_manual_lunch_current_basis(uuid,text,text,date)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_lunch_coverage_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_authority record;
  v_document jsonb;
  v_inserted integer := 0;
  v_missing integer := 0;
  v_alerts integer := 0;
  v_job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  perform pg_advisory_xact_lock(hashtext('custodial-lunch-notifications'),hashtext(v_service_date::text));
  select * into strict v_authority
  from public.static_weekly_v6_schedule_authority_state(v_service_date);
  if not v_authority.governed or v_authority.projection_status is distinct from 'current' then
    return jsonb_build_object('ok',true,'enqueued',0,'missing_recipients',0,'manager_alerts',0,
      'skipped','no_current_governed_schedule','service_date',v_service_date);
  end if;

  select document_json into v_document
  from public.weekly_schedule_lunch_documents
  where projection_id=v_authority.projection_id;
  if v_document is null then
    raise exception using errcode='55000',message='current lunch coverage is unavailable; republish the weekly schedule';
  end if;

  -- Validate the exact current persisted document; never materialize a prepared draft.
  perform public.static_weekly_v8_assert_lunch_document(v_authority.projection_id,v_document);

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
      and n->>'event' in ('start','end')
      and n->>'delivery_state'='NOT_ENQUEUED'
  ), targets as materialized (
    select registration.credential_id,registration.employee_id,registration.device_id,
      registration.assignment_epoch,device.device_id device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), recipient_counts as materialized (
    select intent.employee_id,count(distinct target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    group by intent.employee_id
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':'||target.credential_id::text,
    'employee_native_push',v_authority.projection_id,intent.scheduled_at,
    jsonb_build_object(
      'credential_id',target.credential_id,'employee_id',target.employee_id,
      'device_id',target.device_id,'device_identifier',target.device_identifier,
      'assignment_epoch',target.assignment_epoch,
      'channel_id','employee-events',
      'title',case intent.n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',case intent.n->>'event'
        when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
        else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time',
        'scheduled_at',to_char(intent.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,
        'document_identity',v_document->>'document_identity',
        'route','employee-schedule.html?hub=employee'
      )
    )
  from intents intent
  join recipient_counts count_row on count_row.employee_id=intent.employee_id and count_row.recipient_count=1
  join targets target on target.employee_id=intent.employee_id
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
  ), targets as materialized (
    select registration.credential_id,registration.employee_id
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), unavailable as materialized (
    select intent.*,count(target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    where intent.scheduled_at<=p_now
    group by intent.n,intent.employee_id,intent.scheduled_at
    having count(target.credential_id)<>1
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,status,completed_at,last_error,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':recipient-unavailable',
    'employee_native_push',v_authority.projection_id,'dead',p_now,
    case when intent.recipient_count=0 then 'lunch_coverage_recipient_unavailable'
         else 'lunch_coverage_recipient_ambiguous' end,
    intent.scheduled_at,
    jsonb_build_object(
      'employee_id',intent.employee_id,'device_identifier','assigned custodial phone',
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time','coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,'document_identity',v_document->>'document_identity',
        'recipient_status',case when intent.recipient_count=0 then 'unavailable' else 'ambiguous' end,
        'route','employee-schedule.html?hub=employee'
      )
    )
  from unavailable intent
  on conflict(job_key) do nothing;
  get diagnostics v_missing=row_count;
  for v_job_id in
    select job_id from public.operational_notification_jobs
    where job_type='employee_native_push'
      and source_id=v_authority.projection_id
      and status='dead'
      and payload_json->'data_json'->>'kind'='employee_lunch_coverage'
      and payload_json->'data_json'->>'service_date'=v_service_date::text
      and payload_json->'data_json'->>'recipient_status' in ('unavailable','ambiguous')
      and available_at<=p_now
  loop
    v_alerts:=v_alerts+coalesce((public.ops_manager_enqueue_lunch_delivery_failure(v_job_id,p_now)->>'enqueued')::integer,0);
  end loop;

  return jsonb_build_object('ok',true,'service_date',v_service_date,
    'projection_id',v_authority.projection_id,'document_identity',v_document->>'document_identity',
    'enqueued',v_inserted,'missing_recipients',v_missing,'manager_alerts',v_alerts);
end
$function$;
CREATE OR REPLACE FUNCTION public.custodial_native_target_source_at(p_kind text, p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
 v_now timestamptz:=p_at;
 v_generation public.employee_native_push_generations%rowtype;
 v_registration public.employee_push_registrations%rowtype;
 v_device public.devices%rowtype;
 v_credential public.device_auth_credentials%rowtype;
 v_employee public.employees%rowtype;
 v_job public.operational_notification_jobs%rowtype;
 v_message record;
 v_occurrence public.weekly_schedule_occurrences%rowtype;
 v_authority record;
 v_document public.weekly_schedule_lunch_documents%rowtype;
 v_intent jsonb;
 v_loan jsonb;
 v_responsibility jsonb;
 v_availability jsonb;
 v_service_date date;
 v_scheduled_at timestamptz;
 v_valid_until timestamptz;
 v_source jsonb;
 v_recipient jsonb;
 v_status text;
begin
 if p_kind is null or p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null
  or p_employee_id is null or p_generation_id is null or p_at is null or not isfinite(p_at) then
  raise exception using errcode='22023',message='exact native source kind, original key, employee and generation required';
 end if;
 select * into v_generation from public.employee_native_push_generations
  where generation_id=p_generation_id;
 if not found then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 select * into v_registration from public.employee_push_registrations
  where registration_id=v_generation.registration_id;
 select * into v_device from public.devices where id=v_generation.device_id;
 select * into v_credential from public.device_auth_credentials
  where credential_id=v_generation.credential_id;
 select * into v_employee from public.employees where id=p_employee_id;
 if v_generation.employee_id is distinct from p_employee_id
  or v_generation.dispatch_retired_at is not null or v_generation.revoked_at is not null
  or v_generation.activated_at>v_now or v_registration.registration_id is null
  or v_registration.active is not true or v_registration.revoked_at is not null
  or v_registration.device_id is distinct from v_generation.device_id
  or v_registration.credential_id is distinct from v_generation.credential_id
  or v_registration.employee_id is distinct from p_employee_id
  or v_registration.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_registration.token_hash is distinct from v_generation.token_digest
  or v_device.id is null or v_device.active is not true
  or v_device.device_id is distinct from v_generation.device_identifier
  or v_device.assigned_employee_id is distinct from p_employee_id
  or v_device.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_credential.credential_id is null or v_credential.device_id is distinct from v_device.id
  or v_credential.confirmed_at is null or v_credential.revoked_at is not null
  or v_credential.expires_at<=v_now or v_employee.id is null or v_employee.active is not true then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 v_recipient:=jsonb_build_object('employee_id',p_employee_id,'device_id',v_device.id,
  'device_identifier',v_device.device_id,'credential_id',v_credential.credential_id,
  'assignment_epoch',v_device.assignment_epoch,'generation_id',v_generation.generation_id,
  'principal_digest',v_generation.principal_digest,'token_digest',v_generation.token_digest);

 if p_kind='MESSAGE' then
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.job_key is distinct from 'employee-message-push:'||v_job.source_id::text||':'||v_credential.credential_id::text
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_message'
   or v_job.payload_json#>>'{data_json,message_id}' is distinct from v_job.source_id::text
   or v_job.payload_json#>>'{data_json,notification_key}' is distinct from 'message:'||v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   select m.id,m.thread_id,m.sender_user_id,m.sent_at,m.body,m.metadata_json,
    recipient.id recipient_user_id,r.acknowledged_at
    into v_message
   from public.msg_messages m
   join public.msg_threads t on t.id=m.thread_id and t.is_active is true
    and t.system_key is distinct from 'ops_manager_shared_chat_v1'
   join public.msg_thread_participants tp on tp.thread_id=m.thread_id and tp.left_at is null
   join public.msg_users recipient on recipient.id=tp.user_id and recipient.is_active is true
    and recipient.employee_id=p_employee_id
   join public.msg_receipts r on r.message_id=m.id and r.user_id=recipient.id
   where m.id=v_job.source_id and m.is_deleted is false and m.sender_user_id<>recipient.id
    and m.sent_at<=v_now
    and r.acknowledged_at is null
    and not exists(select 1 from public.msg_message_deletions md
      where md.message_id=m.id and md.user_id=recipient.id)
    and not exists(select 1 from public.msg_thread_visibility visibility
      where visibility.thread_id=m.thread_id and visibility.user_id=recipient.id
       and (visibility.device_identifier is null
         or upper(btrim(visibility.device_identifier))=upper(btrim(v_device.device_id)))
       and coalesce(m.sent_at,m.created_at)<=visibility.hidden_before);
   if not found or v_job.payload_json#>>'{data_json,thread_id}' is distinct from v_message.thread_id::text then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_recipient:=v_recipient||jsonb_build_object('msg_user_id',v_message.recipient_user_id);
    v_source:=jsonb_build_object('source_id',v_message.id,'source_revision',
     public.static_weekly_digest_jsonb(jsonb_build_object('message_id',v_message.id,
      'thread_id',v_message.thread_id,'sender_user_id',v_message.sender_user_id,
      'sent_at',v_message.sent_at,'body',v_message.body,'metadata_json',v_message.metadata_json,
      'recipient_user_id',v_message.recipient_user_id)),
     'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
     'job_status',v_job.status,'valid_from',v_message.sent_at,'valid_until',null);
   end if;
  end if;
 elsif p_kind='SCHEDULE' then
  select * into v_occurrence from public.weekly_schedule_occurrences
   where occurrence_id=p_source_key;
  if not found or v_occurrence.state is distinct from 'created' then
   v_status:='SOURCE_STALE';
  else
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_occurrence.service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.projection_id is distinct from v_occurrence.projection_id
    or v_authority.publication_id is distinct from v_occurrence.publication_id
    or v_authority.version_id is distinct from v_occurrence.version_id
    or (v_occurrence.owner_person_id_snapshot is distinct from p_employee_id
     and not exists(select 1 from public.static_weekly_v8_read_lunch_segments(v_occurrence.service_date) l
      where l.projection_id=v_authority.projection_id
       and l.normal_occurrence_id=v_occurrence.occurrence_id
       and l.normal_owner_id=v_occurrence.owner_person_id_snapshot
       and l.coverer_id=p_employee_id
       and l.coverage_start<=time '09:45' and l.coverage_end>=time '09:45'
       and l.coverage_start<l.coverage_end)) then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_source:=jsonb_build_object('source_id',v_occurrence.projection_id,
     'source_revision',v_authority.projection_authority_revision::text,
     'source_digest',v_occurrence.occurrence_digest,
     'publication_id',v_occurrence.publication_id,'version_id',v_occurrence.version_id,
     'service_date',v_occurrence.service_date,'assignment_occurrence_id',v_occurrence.occurrence_id,
     'delivery_occurrence_id',null,'delivery_key',null,
     'valid_from',null,'valid_until',null);
   end if;
  end if;
 else
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
   or v_job.payload_json#>>'{data_json,projection_id}' is distinct from v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   v_service_date:=(v_job.payload_json#>>'{data_json,service_date}')::date;
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or public.static_weekly_manual_lunch_current_basis(v_job.source_id,
     v_job.payload_json#>>'{data_json,document_identity}',v_job.payload_json#>>'{data_json,notification_key}',v_service_date) is null then
    v_status:='SOURCE_STALE';
   else
    select * into v_document from public.weekly_schedule_lunch_documents
     where projection_id=v_job.source_id;
    if not found or v_document.document_identity is distinct from v_job.payload_json#>>'{data_json,document_identity}' then
     v_status:='SOURCE_STALE';
    else
     perform public.static_weekly_v8_assert_lunch_document(v_document.projection_id,v_document.document_json);
     select value into v_intent from jsonb_array_elements(v_document.document_json->'notification_intents')
      where value->>'notification_key'=v_job.payload_json#>>'{data_json,notification_key}'
       and value->>'service_date'=v_service_date::text;
     select value into v_loan from jsonb_array_elements(v_document.document_json->'loans')
      where value->>'loan_id'=v_intent->>'loan_id' and value->>'status'='PLANNED';
     select value into v_responsibility from jsonb_array_elements(v_document.document_json->'responsibilities')
      where value->>'loan_id'=v_intent->>'loan_id'
       and value->>'coverer_slot_id'=v_intent->>'coverer_slot_id'
       and value->>'coverer_person_id'=p_employee_id::text;
     select value into v_availability
      from public.weekly_schedule_compiled_projections projection,
       jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
      where projection.projection_id=v_authority.projection_id
       and value->>'serviceDate'=v_service_date::text
       and value->>'slotId'=v_intent->>'coverer_slot_id'
       and value->>'incumbentPersonId'=p_employee_id::text
       and value->>'status'='working';
     if v_intent is null or v_loan is null or v_responsibility is null or v_availability is null
      or v_job.job_key is distinct from 'employee-lunch-push:'||(v_intent->>'notification_key')||':'||v_credential.credential_id::text
      or v_job.payload_json#>>'{data_json,event}' is distinct from v_intent->>'event'
      or v_job.payload_json#>>'{data_json,loan_id}' is distinct from v_intent->>'loan_id'
      or v_job.payload_json#>>'{data_json,coverer_slot_id}' is distinct from v_intent->>'coverer_slot_id'
      or v_job.payload_json#>>'{data_json,scheduled_time}' is distinct from v_intent->>'scheduled_time'
      or v_job.payload_json#>>'{data_json,notification_key}' is distinct from v_intent->>'notification_key'
      or v_job.payload_json#>>'{data_json,service_date}' is distinct from v_intent->>'service_date'
      or v_intent->>'event' not in ('start','end') then
      v_status:='SOURCE_STALE';
     else
      v_scheduled_at:=(v_service_date+(v_intent->>'scheduled_time')::time) at time zone 'America/Chicago';
      v_valid_until:=(v_service_date+(case when v_intent->>'event'='start'
       then v_loan->>'coverage_end' else v_availability#>>'{shift,end}' end)::time)
       at time zone 'America/Chicago';
      if v_valid_until is null or v_valid_until<=v_scheduled_at or v_now>=v_valid_until
       or public.sch_service_date(v_now) is distinct from v_service_date then
       v_status:='SOURCE_EXPIRED';
      else
       v_status:='CURRENT_SOURCE_ONLY';
       v_source:=jsonb_build_object('source_id',v_document.projection_id,
        'source_revision',v_authority.projection_authority_revision::text,
        'source_digest',v_document.document_identity,
        'notification_key',v_intent->>'notification_key',
        'loan_id',v_intent->>'loan_id','event',v_intent->>'event',
        'coverer_slot_id',v_intent->>'coverer_slot_id',
        'service_date',v_service_date,
        'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
        'job_status',v_job.status,'valid_from',v_scheduled_at,'valid_until',v_valid_until);
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('schema','custodial.native-target-source.v1',
  'kind',p_kind,'source_key',p_source_key,'status',v_status,
  'delivery_admitted',false,'recipient',case when v_source is null then null else v_recipient end,
  'source',v_source);
end $function$;
CREATE OR REPLACE FUNCTION public.custodial_native_lunch_live(p_job uuid, p_payload jsonb, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare j public.operational_notification_jobs%rowtype;authority record;
 doc public.weekly_schedule_lunch_documents%rowtype;intent jsonb;loan jsonb;responsibility jsonb;available jsonb;
 service_date date;scheduled timestamptz;ends_at timestamptz;
begin
 if p_job is null or p_at is null or not isfinite(p_at)
  or p_payload->>'schema' is distinct from 'custodial.native-provider-payload.v1'
  or p_payload->>'kind' is distinct from 'employee_lunch_coverage'
  or p_payload->>'valid_until' is null or (p_payload->>'valid_until')::timestamptz<=p_at then return false;end if;
 select * into j from public.operational_notification_jobs where job_id=p_job;
 if j.job_id is null or j.job_type is distinct from 'employee_native_push'
  or j.source_id::text is distinct from p_payload->>'projection_id'
  or j.job_key is distinct from 'employee-lunch-push:'||(p_payload->>'notification_key')||':'||(p_payload->>'receipt_credential_id')
  or j.payload_json->>'credential_id' is distinct from p_payload->>'receipt_credential_id'
  or j.payload_json->>'employee_id' is distinct from p_payload->>'receipt_employee_id'
  or j.payload_json->>'device_identifier' is distinct from p_payload->>'receipt_device_id'
  or j.payload_json->>'assignment_epoch' is distinct from p_payload->>'receipt_assignment_epoch'
  or j.payload_json#>>'{data_json,projection_id}' is distinct from j.source_id::text
  or j.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
  or j.payload_json#>'{data_json,test_delivery}' is not null then return false;end if;
 service_date:=(p_payload->>'service_date')::date;
 if public.sch_service_date(p_at) is distinct from service_date then return false;end if;
 select * into authority from public.static_weekly_v6_schedule_authority_state(service_date);
 if authority.governed is not true or authority.projection_status is distinct from 'current'
  or public.static_weekly_manual_lunch_current_basis(j.source_id,p_payload->>'document_identity',
   p_payload->>'notification_key',service_date) is null then return false;end if;
 select * into doc from public.weekly_schedule_lunch_documents where projection_id=j.source_id;
 if doc.projection_id is null or doc.document_identity is distinct from p_payload->>'document_identity' then return false;end if;
 perform public.static_weekly_v8_assert_lunch_document(doc.projection_id,doc.document_json);
 select value into intent from jsonb_array_elements(doc.document_json->'notification_intents') value
  where value->>'notification_key'=p_payload->>'notification_key'
   and value->>'service_date'=service_date::text;
 select value into loan from jsonb_array_elements(doc.document_json->'loans') value
  where value->>'loan_id'=intent->>'loan_id' and value->>'status'='PLANNED';
 select value into responsibility from jsonb_array_elements(doc.document_json->'responsibilities') value
  where value->>'loan_id'=intent->>'loan_id'
   and value->>'coverer_slot_id'=intent->>'coverer_slot_id'
   and value->>'coverer_person_id'=p_payload->>'receipt_employee_id';
 select value into available from public.weekly_schedule_compiled_projections projection,
  jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
  where projection.projection_id=authority.projection_id and value->>'serviceDate'=service_date::text
   and value->>'slotId'=intent->>'coverer_slot_id'
   and value->>'incumbentPersonId'=p_payload->>'receipt_employee_id' and value->>'status'='working';
 if intent is null or loan is null or responsibility is null or available is null
  or intent->>'event' not in ('start','end')
  or j.payload_json#>>'{data_json,notification_key}' is distinct from intent->>'notification_key'
  or j.payload_json#>>'{data_json,loan_id}' is distinct from intent->>'loan_id'
  or j.payload_json#>>'{data_json,event}' is distinct from intent->>'event'
  or j.payload_json#>>'{data_json,coverer_slot_id}' is distinct from intent->>'coverer_slot_id'
  or j.payload_json#>>'{data_json,scheduled_time}' is distinct from intent->>'scheduled_time'
  or j.payload_json#>>'{data_json,scheduled_at}' is distinct from public.custodial_native_location_utc(
    (service_date+(intent->>'scheduled_time')::time) at time zone 'America/Chicago')
  or j.payload_json#>>'{data_json,document_identity}' is distinct from doc.document_identity
  or p_payload->>'event' is distinct from intent->>'event'
  or p_payload->>'loan_id' is distinct from intent->>'loan_id'
  or p_payload->>'coverer_slot_id' is distinct from intent->>'coverer_slot_id'
  or p_payload->>'scheduled_time' is distinct from intent->>'scheduled_time'
  or p_payload->>'document_identity' is distinct from doc.document_identity then return false;end if;
 scheduled:=(service_date+(intent->>'scheduled_time')::time) at time zone 'America/Chicago';
 ends_at:=(service_date+(case when intent->>'event'='start' then loan->>'coverage_end'
  else available#>>'{shift,end}' end)::time) at time zone 'America/Chicago';
 if ends_at is null or ends_at<=scheduled or p_at<scheduled or p_at>=ends_at
  or p_payload->>'scheduled_at' is distinct from public.custodial_native_location_utc(scheduled)
  or (p_payload->>'valid_until')::timestamptz>ends_at then return false;end if;
 return true;
exception when data_exception or invalid_datetime_format or datetime_field_overflow then return false;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_original_native_bindings(p_body jsonb, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare lunch_basis jsonb;effect jsonb;normal_data jsonb;payload jsonb;entry jsonb;entries jsonb:='[]'::jsonb;
 original record;matches integer;kind text;field text;fields text[];seen text[]:='{}'::text[];counted integer:=0;
 unavailable jsonb:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','UNAVAILABLE','entries','[]'::jsonb);
begin
 if p_at is null or not isfinite(p_at) or jsonb_typeof(p_body->'required_effects') is distinct from 'array'
  or jsonb_array_length(p_body->'required_effects') not between 1 and 1024 then return unavailable;end if;
 for effect in select value from jsonb_array_elements(p_body->'required_effects') loop
  counted:=counted+1;normal_data:=case effect->>'origin' when 'FULL_ACCEPTED_LUNCH_DOCUMENT' then effect#>'{notification,data}'
   when 'EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES' then effect->'data' else null end;
  kind:=normal_data->>'kind';
  if kind not in ('employee_lunch_coverage','employee_location_status') or kind is null
   or effect->>'notification_key' is null or effect->>'notification_key'=any(seen)
   or normal_data->>'notification_key' is distinct from effect->>'notification_key'
   or normal_data->>'service_date' is distinct from p_body->>'service_date'
   or normal_data->>'receipt_employee_id' is distinct from p_body->>'employee_id'
   or normal_data->>'receipt_credential_id' is distinct from p_body->>'credential_id'
   or normal_data->>'receipt_device_id' is distinct from p_body->>'canonical_device_id'
   or normal_data->>'receipt_assignment_epoch' is distinct from p_body->>'assignment_epoch' then return unavailable;end if;
  seen:=array_append(seen,effect->>'notification_key');matches:=0;
  for original in
   select receipt.*,generation.principal_digest as original_principal_digest
   from public.employee_native_push_delivery_receipts receipt
   join public.operational_notification_jobs job on job.job_id=receipt.job_id and job.job_key=receipt.job_key
   join public.employee_native_push_generations generation on generation.generation_id=receipt.native_generation_id
    and generation.registration_id=receipt.registration_id
   join public.employee_push_registrations registration on registration.registration_id=generation.registration_id
   where receipt.credential_id=(p_body->>'credential_id')::uuid and receipt.assignment_epoch=(p_body->>'assignment_epoch')::bigint
    and generation.device_id=(p_body->>'device_pk')::uuid and generation.credential_id=receipt.credential_id
    and generation.employee_id=(p_body->>'employee_id')::uuid and generation.assignment_epoch=receipt.assignment_epoch
    and generation.device_identifier=p_body->>'canonical_device_id' and generation.revoked_at is null
    and generation.activated_at<=receipt.prepared_at
    and (generation.dispatch_retired_at is null or receipt.prepared_at<=generation.dispatch_retired_at)
    and registration.device_id=generation.device_id and registration.credential_id=generation.credential_id
    and registration.employee_id=generation.employee_id and registration.assignment_epoch=generation.assignment_epoch
    and registration.platform='android' and registration.provider='fcm'
    and job.job_type='employee_native_push' and job.payload_json#>'{data_json,test_delivery}' is null
    and job.payload_json#>>'{data_json,kind}'=kind
    and job.payload_json->>'credential_id'=p_body->>'credential_id'
    and job.payload_json->>'employee_id'=p_body->>'employee_id'
    and job.payload_json->>'device_id'=p_body->>'device_pk'
    and job.payload_json->>'device_identifier'=p_body->>'canonical_device_id'
    and job.payload_json->>'assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload is not null and receipt.native_payload_sha256~'^[a-f0-9]{64}$'
    and receipt.native_valid_until>p_at and receipt.prepared_at<=p_at
    and receipt.native_payload->>'notification_key'=effect->>'notification_key'
    and receipt.native_payload->>'kind'=kind and receipt.native_payload->>'service_date'=p_body->>'service_date'
    and receipt.native_payload->>'receipt_employee_id'=p_body->>'employee_id'
    and receipt.native_payload->>'receipt_credential_id'=p_body->>'credential_id'
    and receipt.native_payload->>'receipt_device_id'=p_body->>'canonical_device_id'
    and receipt.native_payload->>'receipt_assignment_epoch'=p_body->>'assignment_epoch'
    and receipt.native_payload->>'receipt_job_id'=receipt.job_id::text
    and receipt.native_payload->>'generation_id'=generation.generation_id::text
    and receipt.native_payload->>'principal_digest'=generation.principal_digest
    and receipt.native_payload->>'token_digest'=generation.token_digest and receipt.token_hash=generation.token_digest
    and receipt.native_payload->>'content_sha256'=receipt.native_payload_sha256
    and receipt.native_payload_sha256=public.static_weekly_digest_text(public.custodial_native_location_canonical(receipt.native_payload-'content_sha256'))
    and receipt.native_payload->>'reservation_at'=public.custodial_native_location_utc(receipt.prepared_at)
    and receipt.native_payload->>'valid_until'=public.custodial_native_location_utc(receipt.native_valid_until)
    and octet_length(public.custodial_native_location_canonical(receipt.native_payload))<=3500
    and case kind when 'employee_lunch_coverage' then
     exists(select 1 from public.employee_native_lunch_dispatch_attempts attempt where attempt.job_id=receipt.job_id)
      and public.custodial_native_lunch_live(receipt.job_id,receipt.native_payload,p_at)
     else public.custodial_native_location_live(receipt.job_id,receipt.native_payload,p_at) end
   order by receipt.job_id limit 2 loop
   matches:=matches+1;payload:=original.native_payload;
   -- Do not equate native location spoken words with normal renderer wording.
   -- Bind the original native audio source separately, but require exact
   -- nonsecret semantic key/principal/current accepted source correspondence.
   if kind='employee_lunch_coverage' then
    lunch_basis:=public.static_weekly_manual_lunch_current_basis((payload->>'projection_id')::uuid,
     payload->>'document_identity',payload->>'notification_key',(payload->>'service_date')::date);
    if lunch_basis is null
     or normal_data->>'projection_id' is distinct from lunch_basis->>'current_projection_id'
     or normal_data->>'document_identity' is distinct from lunch_basis->>'current_document_identity'
     then return unavailable;end if;
   end if;
   fields:=case kind when 'employee_lunch_coverage' then
    array['notification_key','kind','service_date','loan_id','event','scheduled_time','scheduled_at','coverer_slot_id','route']
    else array['notification_key','kind','service_date','location_id','location_code','location_name','form_type','group_code','group_name','status_code','projection_id','publication_id'] end;
   foreach field in array fields loop
    if payload->>field is distinct from normal_data->>field then return unavailable;end if;
   end loop;
   entry:=jsonb_build_object('notification_key',payload->>'notification_key','receipt_job_id',original.job_id::text,
    'generation_id',original.native_generation_id::text,'registration_id',original.registration_id::text,
    'principal_digest',original.original_principal_digest,'token_digest',original.token_hash,
    'reservation_at',public.custodial_native_location_utc(original.prepared_at),
    'valid_until',public.custodial_native_location_utc(original.native_valid_until),'content_sha256',original.native_payload_sha256,
    'native_kind',kind,'audio_origin','ORIGINAL_NATIVE_JOB','speech_sha256',public.static_weekly_digest_text(payload->>'body'));
  end loop;
  if matches<>1 then return unavailable;end if;
  entries:=entries||jsonb_build_array(entry);
 end loop;
 if counted<>jsonb_array_length(entries) then return unavailable;end if;
 entry:=jsonb_build_object('schema','custodial.recurring-original-native-delivery-bindings.v1','state','ORIGINAL_NATIVE_RESERVATIONS','entries',entries);
 if octet_length(entry::text)>196608 then raise exception 'original native binding bound exceeded' using errcode='54000';end if;
 return entry;
end $function$;
-- No DML against jobs/receipts/attempts/documents; existing ACLs are preserved.


-- COMPONENT leadership_pin SHA256 7e8f1ba2fe97231b2dc6823bb4fb6171ad8889d2623aeb8bd37742cf5f20828f
-- PRIVATE PROPOSAL ONLY. No canonical adoption, secrets, activation, or people creation.
-- Main must explicitly approve policy/cohort/configuration and a restricted server
-- connection before use. No public Data API function, grant, live job or timer.


-- Normalized catalog owner labels are not PostgreSQL role names. Install only
-- as the actual existing maintained actor owner; never create/assume a role.
DO $actual_installer_owner$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure)
     IS DISTINCT FROM (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname=current_user)
 THEN RAISE EXCEPTION 'Actual maintained privileged installer owner required' USING ERRCODE='42501';END IF;
END $actual_installer_owner$;

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE SCHEMA custodial_leadership_private AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE custodial_leadership_private.policy(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 cohort_principal_id uuid REFERENCES public.ops_manager_managers(manager_id),
 policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version>0),security_epoch integer NOT NULL DEFAULT 1 CHECK(security_epoch>0),
 permissions text[] NOT NULL DEFAULT '{}' CHECK(permissions<@ARRAY['custodial.read','custodial.edit','custodialManagementAdmin']::text[]),
 approved_by uuid REFERENCES public.ops_manager_managers(manager_id),approved_at timestamptz,approval_ref uuid,
 CHECK(NOT enabled OR(cohort_principal_id IS NOT NULL AND cardinality(permissions)>0 AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_ref IS NOT NULL))
);
INSERT INTO custodial_leadership_private.policy(singleton) VALUES(true);
CREATE TABLE custodial_leadership_private.pin_versions(
 pin_version uuid PRIMARY KEY DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN('ACTIVE','UNUSED','RETIRED')),
 verifier jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),activated_at timestamptz,expires_at timestamptz,
 private_delivery_receipt uuid,approval_ref uuid NOT NULL,
 CHECK((state='ACTIVE' AND activated_at IS NOT NULL AND expires_at=activated_at+interval '720 hours')
  OR(state='UNUSED' AND activated_at IS NULL AND expires_at IS NULL) OR state='RETIRED')
);
CREATE UNIQUE INDEX leadership_one_enrollment_pin ON custodial_leadership_private.pin_versions((true)) WHERE state IN('ACTIVE','UNUSED');
CREATE TABLE custodial_leadership_private.attempt_buckets(
 stage text NOT NULL CHECK(stage IN('challenge','enroll')),scope text NOT NULL CHECK(scope IN('global','source','browser','account')),
 key_hash text NOT NULL CHECK(key_hash~'^[a-f0-9]{64}$'),window_start timestamptz NOT NULL,attempts integer NOT NULL CHECK(attempts>0),
 PRIMARY KEY(stage,scope,key_hash,window_start)
);
CREATE TABLE custodial_leadership_private.challenges(
 challenge_hash text PRIMARY KEY CHECK(challenge_hash~'^[a-f0-9]{64}$'),browser_hash text NOT NULL CHECK(browser_hash~'^[a-f0-9]{64}$'),
 pin_version uuid NOT NULL REFERENCES custodial_leadership_private.pin_versions(pin_version),policy_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,consumed_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
);
CREATE TABLE custodial_leadership_private.registrations(
 registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),browser_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),
 browser_hash text NOT NULL CHECK(browser_hash~'^[a-f0-9]{64}$'),claimed_account_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),
 cohort_principal_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),enrollment_policy_version integer NOT NULL,
 enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 identity_assurance text NOT NULL DEFAULT 'SELF_ASSERTED_NAME' CHECK(identity_assurance='SELF_ASSERTED_NAME'),
 CHECK(expires_at>enrolled_at AND expires_at<=enrolled_at+interval '365 days')
);
CREATE UNIQUE INDEX leadership_one_active_browser ON custodial_leadership_private.registrations(browser_hash) WHERE revoked_at IS NULL;
CREATE TABLE custodial_leadership_private.verified_contacts(
 account_id uuid PRIMARY KEY REFERENCES public.ops_manager_managers(manager_id),email text NOT NULL,
 verified_at timestamptz NOT NULL,verification_ref uuid NOT NULL,
 CHECK(length(email)<=254 AND email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
CREATE TABLE custodial_leadership_private.security_scopes(
 session_id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,browser_id uuid NOT NULL,policy_version integer NOT NULL,security_epoch integer NOT NULL,
 token_hash text NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),csrf_hash text NOT NULL CHECK(csrf_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE custodial_leadership_private.rotation_intents(
 rotation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),previous_pin uuid NOT NULL REFERENCES custodial_leadership_private.pin_versions(pin_version),
 state text NOT NULL CHECK(state IN('AWAITING_PRIVATE_DELIVERY','UNUSED','ARMED')),
 owner_account_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 replacement_pin uuid REFERENCES custodial_leadership_private.pin_versions(pin_version),private_delivery_receipt uuid,
 prepare_approval uuid NOT NULL UNIQUE,delivery_approval uuid,arm_approval uuid
);
CREATE UNIQUE INDEX leadership_one_unconsumed_rotation ON custodial_leadership_private.rotation_intents((true)) WHERE state IN('AWAITING_PRIVATE_DELIVERY','UNUSED');
CREATE TABLE custodial_leadership_private.owner_events(
 approval_id uuid PRIMARY KEY,action text NOT NULL,request_digest text NOT NULL,result_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE custodial_leadership_private.audit(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),at timestamptz NOT NULL DEFAULT clock_timestamp(),event text NOT NULL,
 registration_id uuid,claimed_account_id uuid,cohort_principal_id uuid,policy_version integer,owner_approval_ref uuid,
 identity_assurance text NOT NULL CHECK(identity_assurance IN('SELF_ASSERTED_NAME','INDEPENDENT_OWNER_APPROVAL','NO_CLAIM'))
);
-- No policies granting browser/service roles access. No plaintext PIN/token columns.
DO $private_tables$ DECLARE t record;BEGIN
 FOR t IN SELECT c.oid::regclass name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='custodial_leadership_private' AND c.relkind='r' LOOP
  EXECUTE format('ALTER TABLE %s OWNER TO CURRENT_USER',t.name);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t.name);
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated,service_role',t.name);
 END LOOP;
END $private_tables$;

CREATE FUNCTION custodial_leadership_private.approved_names()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $names$
DECLARE result jsonb;valid integer;
BEGIN
 WITH approved(ord,label,key) AS(VALUES
  (1,'Eric McKenney','eric_mckenney_facilities_maintenance_manager'),(2,'Haley','haley_lejman_water_quality_manager'),
  (3,'Brandy Gull','brandy_gull_horticulture_manager'),(4,'Jennifer','jennifer_sheffield_director_operations'),
  (5,'Annie','annie_feist_operations_admin'),(6,'Eric Operle','eric_custodial_manager')),
 matches AS(SELECT a.ord,a.label,m.manager_id,count(*) OVER(PARTITION BY a.ord) n
  FROM approved a JOIN public.ops_manager_managers m ON m.system_key=a.key
  WHERE m.active AND m.revoked_at IS NULL AND m.is_system_principal=false)
 SELECT count(*),jsonb_agg(jsonb_build_object('accountId',manager_id,'displayName',label) ORDER BY ord)
 INTO valid,result FROM matches WHERE n=1;
 IF valid<>6 OR (SELECT count(DISTINCT x->>'accountId') FROM jsonb_array_elements(result) x)<>6 THEN RETURN NULL;END IF;
 RETURN result;
END $names$;

CREATE FUNCTION custodial_leadership_private.take_attempt(p_stage text,p_source text,p_browser text,p_account text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $budget$
DECLARE bucket timestamptz:=to_timestamp(floor(extract(epoch FROM clock_timestamp())/900)*900);r record;n integer;
BEGIN
 IF coalesce(p_source,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_browser,'') !~ '^[a-f0-9]{64}$' OR p_stage NOT IN('challenge','enroll')
  OR(p_account IS NOT NULL AND p_account !~ '^[a-f0-9]{64}$') THEN RETURN false;END IF;
 -- Caller holds the singleton policy row FOR UPDATE: global counter serializes
 -- all replicas. Success never resets a bucket. Global exhaustion stops new keys.
 FOR r IN SELECT * FROM(VALUES('global',repeat('0',64),20),('source',p_source,5),('browser',p_browser,5),('account',p_account,5)) v(scope,key,cap) LOOP
  IF r.key IS NULL THEN CONTINUE;END IF;
  INSERT INTO custodial_leadership_private.attempt_buckets(stage,scope,key_hash,window_start,attempts)
   VALUES(p_stage,r.scope,r.key,bucket,1)
   ON CONFLICT(stage,scope,key_hash,window_start) DO UPDATE SET attempts=custodial_leadership_private.attempt_buckets.attempts+1
   RETURNING attempts INTO n;
  IF n>r.cap THEN RETURN false;END IF;
 END LOOP;RETURN true;
END $budget$;

CREATE FUNCTION custodial_leadership_private.session_view(p_registration uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $session$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 names jsonb;chosen jsonb;contact jsonb;
BEGIN
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=p_registration;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 IF NOT p.enabled OR r.registration_id IS NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=clock_timestamp()
  OR r.cohort_principal_id IS DISTINCT FROM p.cohort_principal_id
  OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
  THEN RETURN NULL;END IF;
 names:=custodial_leadership_private.approved_names();
 SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=r.claimed_account_id::text;
 IF chosen IS NULL OR r.claimed_account_id=p.cohort_principal_id THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('email',v.email,'verifiedAt',v.verified_at) INTO contact
  FROM custodial_leadership_private.verified_contacts v WHERE v.account_id=r.claimed_account_id AND v.verified_at<=clock_timestamp();
 RETURN jsonb_build_object('registrationId',r.registration_id,'browserId',r.browser_id,'credentialExpiresAt',r.expires_at,'csrfBinding',r.browser_hash,'claimedAccount',chosen||jsonb_build_object('contact',contact),
  'cohort',jsonb_build_object('principalId',p.cohort_principal_id,'policyVersion',p.policy_version,'securityEpoch',p.security_epoch,'permissions',to_jsonb(p.permissions)));
END $session$;

CREATE FUNCTION custodial_leadership_private.valid_verifier(v jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $verifier$
 SELECT coalesce(jsonb_typeof(v)='object' AND v->>'algorithm'='scrypt-hmac-sha256-v1'
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key)=ARRAY['algorithm','digest','salt']
  AND coalesce(v->>'salt','')~'^[a-f0-9]{64}$' AND coalesce(v->>'digest','')~'^[a-f0-9]{64}$',false)
$verifier$;

CREATE FUNCTION custodial_leadership_private.execute(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $execute$
DECLARE p custodial_leadership_private.policy%rowtype;v custodial_leadership_private.pin_versions%rowtype;
 c custodial_leadership_private.challenges%rowtype;r custodial_leadership_private.registrations%rowtype;
 rotation custodial_leadership_private.rotation_intents%rowtype;event custodial_leadership_private.owner_events%rowtype;
 names jsonb;chosen jsonb;result jsonb;verifier jsonb;stamp timestamptz:=clock_timestamp();owner_id uuid;new_id uuid;
 owner_action boolean:=p_action IN('install_initial','prepare_rotation','confirm_private_delivery','arm_enrollment_share');
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>4096 THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton FOR UPDATE;
 stamp:=clock_timestamp();
 IF p.singleton IS NULL THEN RETURN jsonb_build_object('ok',false,'error','policy_unavailable');END IF;
 IF owner_action THEN
  -- This ID is supplied ONLY by Main's independent owner authorizer, NEVER
  -- selected/claimed enrollment. No owner endpoints are mounted by this proposal.
  SELECT manager_id INTO owner_id FROM public.ops_manager_managers WHERE system_key='eric_custodial_manager'
   AND active AND revoked_at IS NULL AND is_system_principal=false;
  IF owner_id IS NULL OR p_data->>'owner_account_id' IS DISTINCT FROM owner_id::text OR p_data->>'approval_id' IS NULL
   THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
  SELECT * INTO event FROM custodial_leadership_private.owner_events WHERE approval_id=(p_data->>'approval_id')::uuid;
  IF event.approval_id IS NOT NULL THEN
   IF event.action IS DISTINCT FROM p_action OR event.request_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(p_data)
    THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
   RETURN jsonb_build_object('ok',true,'data',event.result_json);
  END IF;
 ELSE
  IF NOT p.enabled OR p.cohort_principal_id IS NULL OR cardinality(p.permissions)=0 OR p.approved_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id AND m.active AND m.revoked_at IS NULL AND m.is_system_principal=true)
   THEN RETURN jsonb_build_object('ok',false,'error','policy_unavailable');END IF;
 END IF;

 IF p_action='begin_challenge' THEN
  IF NOT custodial_leadership_private.take_attempt('challenge',p_data->>'source_hash',p_data->>'browser_hash')
   THEN RETURN jsonb_build_object('ok',false,'error','rate_limited');END IF;
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE state='ACTIVE' AND activated_at<=stamp AND expires_at>stamp;
  IF v.pin_version IS NULL THEN RETURN jsonb_build_object('ok',false,'error','enrollment_unavailable');END IF;
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('pinVersion',v.pin_version,'verifier',v.verifier));
 ELSIF p_action='finish_challenge' THEN
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=(p_data->>'pin_version')::uuid AND state='ACTIVE' AND expires_at>stamp AND activated_at<=stamp;
  names:=custodial_leadership_private.approved_names();
  IF v.pin_version IS NULL OR names IS NULL OR coalesce(p_data->>'challenge_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_data->>'browser_hash','') !~ '^[a-f0-9]{64}$'
   THEN RETURN jsonb_build_object('ok',false,'error','enrollment_unavailable');END IF;
  INSERT INTO custodial_leadership_private.challenges(challenge_hash,browser_hash,pin_version,policy_version,created_at,expires_at)
   VALUES(p_data->>'challenge_hash',p_data->>'browser_hash',v.pin_version,p.policy_version,stamp,stamp+interval '5 minutes');
  RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('challengeExpiresAt',stamp+interval '5 minutes','approvedNames',names));
 ELSIF p_action='enroll' THEN
  IF NOT custodial_leadership_private.take_attempt('enroll',p_data->>'source_hash',p_data->>'browser_hash',p_data->>'account_key')
   THEN RETURN jsonb_build_object('ok',false,'error','rate_limited');END IF;
  SELECT * INTO c FROM custodial_leadership_private.challenges WHERE challenge_hash=p_data->>'challenge_hash' FOR UPDATE;
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=c.pin_version;
  IF c.challenge_hash IS NULL OR c.browser_hash IS DISTINCT FROM p_data->>'browser_hash' OR c.consumed_at IS NOT NULL OR c.expires_at<=stamp
   OR c.policy_version<>p.policy_version OR v.state IS DISTINCT FROM 'ACTIVE' OR v.expires_at<=stamp
   THEN RETURN jsonb_build_object('ok',false,'error','challenge_unavailable');END IF;
  names:=custodial_leadership_private.approved_names();
  SELECT n INTO chosen FROM jsonb_array_elements(names) n WHERE n->>'accountId'=p_data->>'claimed_account_id';
  IF chosen IS NULL OR coalesce(p_data->>'new_browser_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_data->>'token_hash','') !~ '^[a-f0-9]{64}$'
   THEN RETURN jsonb_build_object('ok',false,'error','challenge_unavailable');END IF;
  IF EXISTS(SELECT 1 FROM custodial_leadership_private.registrations WHERE browser_hash=p_data->>'browser_hash' AND revoked_at IS NULL AND expires_at>stamp)
   THEN RETURN jsonb_build_object('ok',false,'error','browser_already_enrolled');END IF;
  INSERT INTO custodial_leadership_private.registrations(token_hash,browser_hash,claimed_account_id,cohort_principal_id,enrollment_policy_version,enrolled_at,expires_at)
   VALUES(p_data->>'token_hash',p_data->>'new_browser_hash',(p_data->>'claimed_account_id')::uuid,p.cohort_principal_id,p.policy_version,stamp,stamp+interval '365 days') RETURNING * INTO r;
  UPDATE custodial_leadership_private.challenges SET consumed_at=stamp WHERE challenge_hash=c.challenge_hash;
  INSERT INTO custodial_leadership_private.audit(event,registration_id,claimed_account_id,cohort_principal_id,policy_version,identity_assurance)
   VALUES('browser_enrolled',r.registration_id,r.claimed_account_id,p.cohort_principal_id,p.policy_version,'SELF_ASSERTED_NAME');
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action='session' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE token_hash=p_data->>'token_hash' AND browser_hash=p_data->>'browser_hash';
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action='credential_readback' THEN
  -- Only the private server connection calls this AFTER central signature
  -- verification; no public router exposes IDs as an authentication shortcut.
  SELECT * INTO r FROM custodial_leadership_private.registrations
   WHERE registration_id=(p_data->>'registration_id')::uuid AND browser_id=(p_data->>'browser_id')::uuid
    AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  result:=custodial_leadership_private.session_view(r.registration_id);
 ELSIF p_action IN('security_scope_issue','security_scope_readback','security_scope_revoke') THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=(p_data->>'registration_id')::uuid
   AND browser_id=(p_data->>'browser_id')::uuid AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  IF custodial_leadership_private.session_view(r.registration_id) IS NULL OR NOT('custodialManagementAdmin'=ANY(p.permissions))
   THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  IF p_action='security_scope_issue' THEN
   IF (p_data->>'policy_version')::integer IS DISTINCT FROM p.policy_version OR (p_data->>'security_epoch')::integer IS DISTINCT FROM p.security_epoch
    OR coalesce(p_data->>'token_hash','')!~'^[a-f0-9]{64}$' OR coalesce(p_data->>'csrf_hash','')!~'^[a-f0-9]{64}$'
    OR (p_data->>'expires_at')::timestamptz<=stamp OR (p_data->>'expires_at')::timestamptz>least(stamp+interval '15 minutes',r.expires_at)
    THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
   INSERT INTO custodial_leadership_private.security_scopes(session_id,registration_id,cohort_principal_id,browser_id,policy_version,security_epoch,token_hash,csrf_hash,created_at,expires_at)
   VALUES((p_data->>'session_id')::uuid,r.registration_id,p.cohort_principal_id,r.browser_id,p.policy_version,p.security_epoch,p_data->>'token_hash',p_data->>'csrf_hash',stamp,(p_data->>'expires_at')::timestamptz);
  ELSIF p_action='security_scope_revoke' THEN
   UPDATE custodial_leadership_private.security_scopes SET revoked_at=coalesce(revoked_at,stamp) WHERE session_id=(p_data->>'session_id')::uuid AND registration_id=r.registration_id;
  END IF;
  SELECT jsonb_build_object('session_id',ss.session_id,'security_epoch',ss.security_epoch,'expires_at',ss.expires_at,'revoked_at',ss.revoked_at,'token_hash',ss.token_hash,'csrf_hash',ss.csrf_hash)
   INTO result FROM custodial_leadership_private.security_scopes ss WHERE ss.session_id=(p_data->>'session_id')::uuid AND ss.registration_id=r.registration_id
    AND ss.policy_version=p.policy_version AND ss.security_epoch=p.security_epoch AND ss.expires_at>stamp AND (ss.revoked_at IS NULL OR p_action='security_scope_revoke');
 ELSIF p_action IN('gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome') THEN
  result:=custodial_leadership_private.gemini_operation(p_action,p_data);
 ELSIF p_action='security_epoch_bump' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE registration_id=(p_data->>'registration_id')::uuid
   AND browser_id=(p_data->>'browser_id')::uuid AND cohort_principal_id=(p_data->>'cohort_principal_id')::uuid;
  IF custodial_leadership_private.session_view(r.registration_id) IS NULL OR NOT('custodialManagementAdmin'=ANY(p.permissions))
   THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  UPDATE custodial_leadership_private.policy SET security_epoch=security_epoch+1 WHERE singleton RETURNING security_epoch INTO p.security_epoch;
  result:=jsonb_build_object('securityEpoch',p.security_epoch,'scope','custodial_leadership_device_security','revoked_all',true);
 ELSIF p_action='revoke' THEN
  SELECT * INTO r FROM custodial_leadership_private.registrations WHERE token_hash=p_data->>'token_hash' AND browser_hash=p_data->>'browser_hash' FOR UPDATE;
  IF r.registration_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','registration_unavailable');END IF;
  UPDATE custodial_leadership_private.registrations SET revoked_at=coalesce(revoked_at,stamp) WHERE registration_id=r.registration_id;
  UPDATE custodial_leadership_private.challenges SET consumed_at=coalesce(consumed_at,stamp) WHERE browser_hash=r.browser_hash;
  INSERT INTO custodial_leadership_private.audit(event,registration_id,claimed_account_id,cohort_principal_id,policy_version,identity_assurance)
   VALUES('browser_revoked',r.registration_id,r.claimed_account_id,p.cohort_principal_id,p.policy_version,'SELF_ASSERTED_NAME');
  result:=jsonb_build_object('revoked',true);
 ELSIF p_action='install_initial' THEN
  IF EXISTS(SELECT 1 FROM custodial_leadership_private.pin_versions) THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  verifier:=p_data->'verifier';
  IF custodial_leadership_private.valid_verifier(verifier) IS NOT TRUE
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  INSERT INTO custodial_leadership_private.pin_versions(state,verifier,activated_at,expires_at,approval_ref)
   VALUES('ACTIVE',verifier,stamp,stamp+interval '720 hours',(p_data->>'approval_id')::uuid) RETURNING pin_version INTO new_id;
  result:=jsonb_build_object('pinVersion',new_id,'state','ACTIVE','activeUntil',stamp+interval '720 hours','enrollmentOpen',true);
 ELSIF p_action='prepare_rotation' THEN
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents WHERE state IN('AWAITING_PRIVATE_DELIVERY','UNUSED');
  IF rotation.rotation_id IS NOT NULL THEN
   result:=jsonb_build_object('rotationId',rotation.rotation_id,'state',rotation.state,'pinVersion',rotation.replacement_pin,'activeUntil',NULL,'enrollmentOpen',true);
  ELSE
   SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE state='ACTIVE' AND expires_at<=stamp;
   IF v.pin_version IS NULL THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
   INSERT INTO custodial_leadership_private.rotation_intents(previous_pin,state,owner_account_id,prepare_approval)
    VALUES(v.pin_version,'AWAITING_PRIVATE_DELIVERY',owner_id,(p_data->>'approval_id')::uuid) RETURNING * INTO rotation;
   result:=jsonb_build_object('rotationId',rotation.rotation_id,'state',rotation.state,'pinVersion',NULL,'activeUntil',NULL,'enrollmentOpen',true);
  END IF;
 ELSIF p_action='confirm_private_delivery' THEN
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents WHERE rotation_id=(p_data->>'rotation_id')::uuid FOR UPDATE;
  IF rotation.rotation_id IS NULL OR rotation.state<>'AWAITING_PRIVATE_DELIVERY' OR rotation.owner_account_id<>owner_id OR p_data->>'delivery_receipt_id' IS NULL
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  verifier:=p_data->'verifier';
  IF custodial_leadership_private.valid_verifier(verifier) IS NOT TRUE
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  UPDATE custodial_leadership_private.pin_versions SET state='RETIRED' WHERE pin_version=rotation.previous_pin;
  INSERT INTO custodial_leadership_private.pin_versions(state,verifier,private_delivery_receipt,approval_ref)
   VALUES('UNUSED',verifier,(p_data->>'delivery_receipt_id')::uuid,(p_data->>'approval_id')::uuid) RETURNING pin_version INTO new_id;
  UPDATE custodial_leadership_private.rotation_intents AS ri SET state='UNUSED',replacement_pin=new_id,private_delivery_receipt=(p_data->>'delivery_receipt_id')::uuid,delivery_approval=(p_data->>'approval_id')::uuid WHERE ri.rotation_id=rotation.rotation_id;
  result:=jsonb_build_object('rotationId',rotation.rotation_id,'pinVersion',new_id,'state','UNUSED','activeUntil',NULL,'enrollmentOpen',true);
 ELSIF p_action='arm_enrollment_share' THEN
  SELECT * INTO v FROM custodial_leadership_private.pin_versions WHERE pin_version=(p_data->>'pin_version')::uuid FOR UPDATE;
  SELECT * INTO rotation FROM custodial_leadership_private.rotation_intents ri WHERE ri.replacement_pin=v.pin_version FOR UPDATE;
  IF v.pin_version IS NULL OR v.state<>'UNUSED' OR v.activated_at IS NOT NULL OR v.expires_at IS NOT NULL OR rotation.state IS DISTINCT FROM 'UNUSED' OR rotation.owner_account_id<>owner_id
   THEN RETURN jsonb_build_object('ok',false,'error','rotation_not_eligible');END IF;
  UPDATE custodial_leadership_private.pin_versions SET state='ACTIVE',activated_at=stamp,expires_at=stamp+interval '720 hours' WHERE pin_version=v.pin_version;
  UPDATE custodial_leadership_private.rotation_intents ri SET state='ARMED',arm_approval=(p_data->>'approval_id')::uuid WHERE ri.rotation_id=rotation.rotation_id;
  result:=jsonb_build_object('pinVersion',v.pin_version,'state','ACTIVE','activeUntil',stamp+interval '720 hours','enrollmentOpen',true);
 ELSE RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 IF owner_action THEN
  INSERT INTO custodial_leadership_private.owner_events(approval_id,action,request_digest,result_json) VALUES((p_data->>'approval_id')::uuid,p_action,public.static_weekly_digest_jsonb(p_data),result);
  INSERT INTO custodial_leadership_private.audit(event,claimed_account_id,owner_approval_ref,identity_assurance) VALUES(p_action,owner_id,(p_data->>'approval_id')::uuid,'INDEPENDENT_OWNER_APPROVAL');
 END IF;
 RETURN jsonb_build_object('ok',true,'data',result);
EXCEPTION WHEN data_exception OR check_violation OR unique_violation THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');
END $execute$;

-- Runtime connection can NEVER invoke owner lifecycle actions. Main grants only
-- this wrapper to its approved enrollment runtime role; execute remains private.
CREATE FUNCTION custodial_leadership_private.runtime(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $runtime$
BEGIN
 IF p_action IS NULL OR p_action NOT IN('begin_challenge','finish_challenge','enroll','session','revoke','credential_readback','security_epoch_bump','security_scope_issue','security_scope_readback','security_scope_revoke','gemini_context','gemini_conversation','gemini_begin_turn','gemini_original_outcome')
  THEN RETURN jsonb_build_object('ok',false,'error','owner_authorization_required');END IF;
 IF p_action NOT IN('session','credential_readback','security_scope_readback','gemini_context','gemini_original_outcome') THEN PERFORM public.custodial_begin_application_mutation();END IF;
 RETURN custodial_leadership_private.execute(p_action,p_data);
END $runtime$;
ALTER FUNCTION custodial_leadership_private.runtime(text,jsonb) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.valid_verifier(jsonb) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.approved_names() OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.take_attempt(text,text,text,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.session_view(uuid) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.execute(text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
-- Deliberately no enrollment-runtime schema/table grants or enabled-policy update.
-- Main must bind approved restricted server role and cohort-aware manager actor.

-- Main's explicit cohort request context: authenticated with the real stored
-- per-browser registration on the SAME control-plane transaction/connection.
CREATE TABLE custodial_leadership_private.request_contexts(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,request_id uuid NOT NULL,
 registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,policy_version integer NOT NULL,permission text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(backend_pid,transaction_id)
);
CREATE TABLE custodial_leadership_private.operation_bindings(
 operation_id uuid PRIMARY KEY REFERENCES public.static_weekly_staffing_commands(operation_id),
 registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,
 original_request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE custodial_leadership_private.request_contexts OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.operation_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.request_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.operation_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_leadership_private.request_contexts,custodial_leadership_private.operation_bindings FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane;

CREATE FUNCTION public.static_weekly_leadership_bind_request(p_browser_hash text,p_token_hash text,p_request uuid,p_permission text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE r custodial_leadership_private.registrations%rowtype;p custodial_leadership_private.policy%rowtype;
 c custodial_leadership_private.request_contexts%rowtype;view jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 IF coalesce(p_browser_hash,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$'
  OR p_request IS NULL OR p_permission IS NULL OR p_permission NOT IN('custodial.read','custodial.edit','custodialManagementAdmin')
  THEN RAISE EXCEPTION 'Custodial cohort credential context required' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 SELECT * INTO r FROM custodial_leadership_private.registrations WHERE browser_hash=p_browser_hash AND token_hash=p_token_hash FOR SHARE;
 view:=custodial_leadership_private.session_view(r.registration_id);
 IF view IS NULL OR NOT(p_permission=ANY(p.permissions)) THEN RAISE EXCEPTION 'Custodial cohort permission unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_request OR c.registration_id<>r.registration_id OR c.permission<>p_permission)
  THEN RAISE EXCEPTION 'Custodial original request context cannot change' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
  VALUES(pg_backend_pid(),txid_current(),p_request,r.registration_id,p.cohort_principal_id,p.policy_version,p_permission)
  ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 RETURN custodial_leadership_private.require_context(p.cohort_principal_id,p_permission);
END $bind$;

CREATE FUNCTION custodial_leadership_private.require_context(p_principal uuid,p_permission text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $context$
DECLARE c custodial_leadership_private.request_contexts%rowtype;view jsonb;
BEGIN
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NULL OR c.cohort_principal_id IS DISTINCT FROM p_principal OR c.permission IS DISTINCT FROM p_permission
  OR c.created_at+interval '5 minutes'<=clock_timestamp()
  THEN RAISE EXCEPTION 'Custodial authenticated original request context required' USING ERRCODE='42501';END IF;
 view:=custodial_leadership_private.session_view(c.registration_id);
 IF view IS NULL OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_principal::text
  OR(view#>>'{cohort,policyVersion}')::integer IS DISTINCT FROM c.policy_version
  OR NOT(view#>'{cohort,permissions}' ? p_permission)
  THEN RAISE EXCEPTION 'Custodial original cohort credential was revoked or changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('manager_id',p_principal,'manager_name','Custodial leadership cohort',
  'actor_kind','CUSTODIAL_LEADERSHIP_COHORT','identity_assurance','SELF_ASSERTED_NAME',
  'credential_id',c.registration_id,'browser_id',view->>'browserId','request_id',c.request_id,'policy_version',c.policy_version,
  'custodialManagementAdmin',view#>'{cohort,permissions}' ? 'custodialManagementAdmin',
  'claimed_account_id',view#>>'{claimedAccount,accountId}','claimed_name',view#>>'{claimedAccount,displayName}',
  'individual_identity_verified',false,'owner',false,'device_id',view->>'browserId');
END $context$;

CREATE FUNCTION custodial_leadership_private.guard_staffing_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $operation$
DECLARE p custodial_leadership_private.policy%rowtype;b custodial_leadership_private.operation_bindings%rowtype;actor jsonb;
BEGIN
 SELECT * INTO p FROM custodial_leadership_private.policy WHERE singleton;
 SELECT * INTO b FROM custodial_leadership_private.operation_bindings WHERE operation_id=NEW.operation_id;
 IF b.operation_id IS NULL AND NEW.prepared_by_manager_id IS DISTINCT FROM p.cohort_principal_id THEN RETURN NEW;END IF;
 actor:=custodial_leadership_private.require_context(NEW.prepared_by_manager_id,'custodialManagementAdmin');
 IF NEW.confirmed_by_manager_id IS NOT NULL AND NEW.confirmed_by_manager_id IS DISTINCT FROM NEW.prepared_by_manager_id
  THEN RAISE EXCEPTION 'Custodial cohort confirmer cannot become a claimed individual' USING ERRCODE='42501';END IF;
 IF b.operation_id IS NULL AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original cohort operation binding is missing; no named-operation adoption' USING ERRCODE='42501';END IF;
 IF b.operation_id IS NOT NULL THEN
  IF b.registration_id::text IS DISTINCT FROM actor->>'credential_id'
   OR b.cohort_principal_id IS DISTINCT FROM NEW.prepared_by_manager_id
   OR b.claimed_account_id::text IS DISTINCT FROM actor->>'claimed_account_id'
   THEN RAISE EXCEPTION 'Original pending operation belongs to another browser registration' USING ERRCODE='42501';END IF;
 ELSE
  INSERT INTO custodial_leadership_private.operation_bindings(operation_id,registration_id,cohort_principal_id,claimed_account_id,original_request_id)
   VALUES(NEW.operation_id,(actor->>'credential_id')::uuid,NEW.prepared_by_manager_id,(actor->>'claimed_account_id')::uuid,(actor->>'request_id')::uuid);
 END IF;
 RETURN NEW;
END $operation$;
CREATE TRIGGER custodial_leadership_original_staffing_registration
 AFTER INSERT OR UPDATE ON public.static_weekly_staffing_commands
 FOR EACH ROW EXECUTE FUNCTION custodial_leadership_private.guard_staffing_operation();
ALTER TABLE public.static_weekly_staffing_commands ENABLE ALWAYS TRIGGER custodial_leadership_original_staffing_registration;

-- Guard only the exact current Source301 named-actor predecessor. All of Main's
-- native-period/read_staffing_command/sourceDigest changes remain untouched.
DO $predecessor$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v3_manager_actor(uuid)'::regprocedure)) IS DISTINCT FROM '9753ab490c2c16490d51b6bb9bbc192b15014be7200118e05cf2dc34202b606d'
 THEN RAISE EXCEPTION 'Named manager actor predecessor differs; compose explicitly';END IF;
END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v3_manager_actor(p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_name text;
begin
  if exists(select 1 from custodial_leadership_private.policy p where p.cohort_principal_id=p_manager_id) then
    return custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
  end if;
  select display_name into v_name from public.ops_manager_managers where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if nullif(btrim(v_name),'') is null then raise exception using errcode='42501',message='an authorized active named manager principal is required'; end if;
  return jsonb_build_object('manager_id',p_manager_id::text,'manager_name',v_name);
end
$function$;

ALTER FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.require_context(uuid,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.guard_staffing_operation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
-- Narrow bind only: this existing role already owns the actual schedule RPCs.
GRANT EXECUTE ON FUNCTION public.static_weekly_leadership_bind_request(text,text,uuid,text) TO static_weekly_control_plane;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA custodial_leadership_private FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;


CREATE FUNCTION public.static_weekly_leadership_bind_verified_request(p_registration uuid,p_browser uuid,p_cohort uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $verified$
DECLARE view jsonb;c custodial_leadership_private.request_contexts%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 PERFORM 1 FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_registration FOR SHARE;
 view:=custodial_leadership_private.session_view(p_registration);
 IF view IS NULL OR p_request IS NULL OR view->>'browserId' IS DISTINCT FROM p_browser::text
  OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_cohort::text OR NOT(view#>'{cohort,permissions}' ? 'custodialManagementAdmin')
  THEN RAISE EXCEPTION 'Actual cohort credential is unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_request OR c.registration_id<>p_registration OR c.cohort_principal_id<>p_cohort)
  THEN RAISE EXCEPTION 'Original cohort transaction binding changed' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
 VALUES(pg_backend_pid(),txid_current(),p_request,p_registration,p_cohort,(view#>>'{cohort,policyVersion}')::integer,'custodialManagementAdmin')
 ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 RETURN custodial_leadership_private.require_context(p_cohort,'custodialManagementAdmin');
END $verified$;
ALTER FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid) TO static_weekly_control_plane;
-- Control plane only, never Main API/Supabase service role; owner execute stays private.
GRANT USAGE ON SCHEMA custodial_leadership_private TO static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION custodial_leadership_private.runtime(text,jsonb) TO static_weekly_control_plane;
DO $action_predecessor$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_action_actor_v1(uuid,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM 'c3953e8993ef86cba598973e36bc0dc34bd393dda0bca2dfc398bf97b5fd412a'
 THEN RAISE EXCEPTION 'Current action actor predecessor differs';END IF;
END $action_predecessor$;
CREATE OR REPLACE FUNCTION public.custodial_action_actor_v1(p_manager_id uuid, p_credential_id uuid, p_device_id text, p_session_access text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.ops_manager_managers%ROWTYPE;c public.ops_manager_trusted_devices%ROWTYPE;is_owner boolean;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','write','close_scan_tickets','manage_absences','manage_coverall','regenerate_routes')
  OR p_session_access IS NULL OR p_session_access NOT IN ('full_access','read_only') THEN
  RAISE EXCEPTION USING errcode='42501',message='Unknown manager action or session access';END IF;
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager_id) THEN
  IF p_session_access<>'full_access' THEN RAISE EXCEPTION 'Current cohort full management context required' USING ERRCODE='42501';END IF;
  DECLARE cohort_actor jsonb;BEGIN
   cohort_actor:=custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
   IF cohort_actor->>'credential_id' IS DISTINCT FROM p_credential_id::text OR cohort_actor->>'device_id' IS DISTINCT FROM p_device_id
    OR cohort_actor->'custodialManagementAdmin' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Original cohort credential differs' USING ERRCODE='42501';END IF;
   RETURN cohort_actor;
  END;
 END IF;
 SELECT * INTO c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential_id FOR SHARE;
 SELECT * INTO m FROM public.ops_manager_managers WHERE manager_id=p_manager_id FOR SHARE;
 IF c.credential_id IS NULL OR m.manager_id IS NULL OR c.manager_id IS DISTINCT FROM m.manager_id
  OR c.device_id IS DISTINCT FROM p_device_id OR c.revoked_at IS NOT NULL
  OR c.expires_at IS NULL OR c.expires_at<=clock_timestamp() OR c.created_at IS NULL OR c.created_at>clock_timestamp()
  OR m.active IS NOT TRUE OR m.revoked_at IS NOT NULL OR m.is_system_principal IS NOT FALSE
  OR coalesce(m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN'],false) IS NOT TRUE
  OR nullif(btrim(m.display_name),'') IS NULL THEN
  RAISE EXCEPTION USING errcode='42501',message='A current named manager credential is required';END IF;
 is_owner:=coalesce(m.system_key='eric_custodial_manager' AND p_session_access='full_access' AND c.max_access_level='full_access',false);
 IF p_action<>'read' AND m.system_key='eric_custodial_manager' AND NOT is_owner THEN
  RAISE EXCEPTION USING errcode='42501',message='Use a current full-control owner sign-in';END IF;
 IF p_action='write' AND NOT is_owner THEN
  RAISE EXCEPTION USING errcode='42501',message='This action is owner-only';END IF;
 RETURN jsonb_build_object('manager_id',m.manager_id,'manager_name',m.display_name,'owner',is_owner,
  'credential_id',c.credential_id,'device_id',c.device_id,'scheduler_delegation','dated_absences_coverall_routes',
  'owner_unavailability_required',false);
END $function$;


CREATE FUNCTION custodial_leadership_private.read_security_scope(p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,p_version integer,p_security_hash text,p_csrf_hash text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $scope$
DECLARE view jsonb;s custodial_leadership_private.security_scopes%rowtype;observed timestamptz:=clock_timestamp();
BEGIN
 view:=custodial_leadership_private.session_view(p_credential);
 SELECT * INTO s FROM custodial_leadership_private.security_scopes WHERE session_id=p_security_session;
 IF view IS NULL OR view#>>'{cohort,principalId}' IS DISTINCT FROM p_manager::text OR view->>'browserId' IS DISTINCT FROM p_device
  OR NOT(view#>'{cohort,permissions}' ? 'custodialManagementAdmin') OR s.session_id IS NULL OR s.registration_id IS DISTINCT FROM p_credential
  OR s.cohort_principal_id IS DISTINCT FROM p_manager OR s.browser_id::text IS DISTINCT FROM p_device OR s.revoked_at IS NOT NULL
  OR s.policy_version IS DISTINCT FROM (view#>>'{cohort,policyVersion}')::integer OR s.security_epoch IS DISTINCT FROM (view#>>'{cohort,securityEpoch}')::integer
  OR s.security_epoch IS DISTINCT FROM p_version OR s.token_hash IS DISTINCT FROM p_security_hash OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR p_security_hash IS NULL OR p_csrf_hash IS NULL OR s.created_at>observed OR s.expires_at<=observed
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=observed
  THEN RAISE EXCEPTION 'Current original cohort security scope required' USING ERRCODE='42501';END IF;
 RETURN least(observed+interval '5 minutes',p_signed_expires,s.expires_at,(view->>'credentialExpiresAt')::timestamptz);
END $scope$;
CREATE FUNCTION custodial_leadership_private.bind_security_scope(p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,p_security_session uuid,p_version integer,p_security_hash text,p_csrf_hash text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $scope_bind$
DECLARE until_time timestamptz;view jsonb;c custodial_leadership_private.request_contexts%rowtype;
BEGIN
 PERFORM 1 FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=p_credential FOR SHARE;
 PERFORM 1 FROM custodial_leadership_private.security_scopes WHERE session_id=p_security_session FOR SHARE;
 until_time:=custodial_leadership_private.read_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_version,p_security_hash,p_csrf_hash);
 view:=custodial_leadership_private.session_view(p_credential);
 SELECT * INTO c FROM custodial_leadership_private.request_contexts WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF c.request_id IS NOT NULL AND(c.request_id<>p_security_session OR c.registration_id<>p_credential OR c.cohort_principal_id<>p_manager)
  THEN RAISE EXCEPTION 'Original cohort security transaction binding changed' USING ERRCODE='42501';END IF;
 INSERT INTO custodial_leadership_private.request_contexts(backend_pid,transaction_id,request_id,registration_id,cohort_principal_id,policy_version,permission)
 VALUES(pg_backend_pid(),txid_current(),p_security_session,p_credential,p_manager,(view#>>'{cohort,policyVersion}')::integer,'custodialManagementAdmin')
 ON CONFLICT(backend_pid,transaction_id) DO NOTHING;
 PERFORM custodial_leadership_private.require_context(p_manager,'custodialManagementAdmin');
 RETURN until_time;
END $scope_bind$;
ALTER FUNCTION custodial_leadership_private.read_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) OWNER TO CURRENT_USER;
ALTER FUNCTION custodial_leadership_private.bind_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.read_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text),custodial_leadership_private.bind_security_scope(uuid,uuid,text,timestamptz,uuid,integer,text,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_recovery.assert_current_manager(uuid,uuid,text,timestamptz,uuid,integer,text,text)'::regprocedure)) IS DISTINCT FROM '7fbb7a0fce95ac59b63403f927b3ce879713f364c70ec46f6bb5eabb1a9e5dd4' THEN RAISE EXCEPTION 'Exact native manager guard predecessor differs';END IF;END $guard$;
CREATE OR REPLACE FUNCTION custodial_recovery.assert_current_manager(p_manager uuid, p_credential uuid, p_device text, p_signed_expires timestamp with time zone, p_security_session uuid, p_password_version integer, p_security_hash text, p_csrf_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor jsonb;m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 decision_time timestamptz;BEGIN
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager) THEN
  RETURN custodial_leadership_private.bind_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 END IF;
 actor:=public.custodial_action_actor_v1(p_manager,p_credential,p_device,'full_access','write');
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential FOR SHARE;
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager FOR SHARE;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton FOR SHARE;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session FOR SHARE;
 decision_time:=clock_timestamp();
 IF ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.revoked_at IS NOT NULL
  OR c.expires_at<=decision_time OR c.created_at>decision_time
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=decision_time
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.expires_at<=decision_time OR s.created_at>decision_time
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current same-original owner security session required';END IF;
 RETURN least(decision_time+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $function$;
DO $guard$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('custodial_recovery.assert_inventory_manager_read(uuid,uuid,text,timestamptz,uuid,integer,text,text)'::regprocedure)) IS DISTINCT FROM '145fa565c6c0650801b0ddff2d27edcb537bc31bc14c982f53dd2bf0eb551416' THEN RAISE EXCEPTION 'Exact native manager guard predecessor differs';END IF;END $guard$;
CREATE OR REPLACE FUNCTION custodial_recovery.assert_inventory_manager_read(p_manager uuid, p_credential uuid, p_device text, p_signed_expires timestamp with time zone, p_security_session uuid, p_password_version integer, p_security_hash text, p_csrf_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.ops_manager_managers%rowtype;c public.ops_manager_trusted_devices%rowtype;
 cfg public.ops_manager_device_security_config%rowtype;s public.ops_manager_device_security_sessions%rowtype;
 observed timestamptz;BEGIN
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.policy p WHERE p.cohort_principal_id=p_manager) THEN
  RETURN custodial_leadership_private.read_security_scope(p_manager,p_credential,p_device,p_signed_expires,p_security_session,p_password_version,p_security_hash,p_csrf_hash);
 END IF;
 -- Same owner/password/security-session boundary as assert_current_manager,
 -- with NO FOR SHARE or effects: the intended port must work in READ ONLY.
 SELECT * INTO STRICT m FROM public.ops_manager_managers WHERE manager_id=p_manager;
 SELECT * INTO STRICT c FROM public.ops_manager_trusted_devices WHERE credential_id=p_credential;
 SELECT * INTO STRICT cfg FROM public.ops_manager_device_security_config WHERE singleton;
 SELECT * INTO STRICT s FROM public.ops_manager_device_security_sessions WHERE session_id=p_security_session;
 observed:=clock_timestamp();
 IF p_manager IS NULL OR p_credential IS NULL OR p_security_session IS NULL OR nullif(btrim(p_device),'') IS NULL
  OR m.active IS DISTINCT FROM true OR m.revoked_at IS NOT NULL OR m.is_system_principal IS DISTINCT FROM false
  OR m.system_key IS DISTINCT FROM 'eric_custodial_manager' OR ('SECURITY_ADMIN'=ANY(m.roles)) IS DISTINCT FROM true
  OR nullif(btrim(m.display_name),'') IS NULL
  OR c.manager_id IS DISTINCT FROM p_manager OR c.device_id IS DISTINCT FROM p_device OR c.max_access_level IS DISTINCT FROM 'full_access'
  OR c.revoked_at IS NOT NULL OR c.created_at IS NULL OR NOT isfinite(c.created_at) OR c.created_at>observed
  OR c.expires_at IS NULL OR NOT isfinite(c.expires_at) OR c.expires_at<=observed
  OR p_signed_expires IS NULL OR NOT isfinite(p_signed_expires) OR p_signed_expires<=observed
  OR s.manager_id IS DISTINCT FROM p_manager OR s.credential_id IS DISTINCT FROM p_credential
  OR s.revoked_at IS NOT NULL OR s.created_at IS NULL OR NOT isfinite(s.created_at) OR s.created_at>observed
  OR s.expires_at IS NULL OR NOT isfinite(s.expires_at) OR s.expires_at<=observed
  OR s.password_version IS DISTINCT FROM cfg.password_version OR s.password_version IS DISTINCT FROM p_password_version
  OR p_security_hash IS NULL OR p_security_hash !~ '^[a-f0-9]{64}$' OR s.token_hash IS DISTINCT FROM p_security_hash
  OR p_csrf_hash IS NULL OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR s.csrf_hash IS DISTINCT FROM p_csrf_hash
  OR cfg.sessions_revoked_at IS NOT NULL AND s.created_at<=cfg.sessions_revoked_at THEN
  RAISE EXCEPTION USING errcode='42501',message='current original inventory owner read session required';END IF;
 RETURN least(observed+interval '5 minutes',p_signed_expires,c.expires_at,s.expires_at);
END $function$;

-- Browser credentials own NEW cohort originals; no historical operation adoption.
CREATE TABLE custodial_leadership_private.gemini_conversation_bindings(
 conversation_id uuid PRIMARY KEY REFERENCES public.gemini_console_conversations(conversation_id),registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE custodial_leadership_private.gemini_message_bindings(
 message_id uuid PRIMARY KEY REFERENCES public.gemini_console_messages(message_id),registration_id uuid NOT NULL REFERENCES custodial_leadership_private.registrations(registration_id),
 cohort_principal_id uuid NOT NULL,claimed_account_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE custodial_leadership_private.gemini_conversation_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.gemini_message_bindings OWNER TO CURRENT_USER;
ALTER TABLE custodial_leadership_private.gemini_conversation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodial_leadership_private.gemini_message_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_leadership_private.gemini_conversation_bindings,custodial_leadership_private.gemini_message_bindings FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE FUNCTION custodial_leadership_private.gemini_operation(p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $gemini$
DECLARE v jsonb;inp jsonb:=p_data->'input';r uuid:=(p_data->>'registration_id')::uuid;c uuid:=(p_data->>'cohort_principal_id')::uuid;
 conversation uuid;message uuid;answer jsonb;attachments uuid[];item public.gemini_console_conversations%rowtype;
BEGIN
 PERFORM 1 FROM custodial_leadership_private.registrations WHERE registration_id=r FOR SHARE;
 v:=custodial_leadership_private.session_view(r);
 IF v IS NULL OR v->>'browserId' IS DISTINCT FROM p_data->>'browser_id' OR v#>>'{cohort,principalId}' IS DISTINCT FROM c::text
  OR NOT(v#>'{cohort,permissions}' ? 'custodialManagementAdmin') OR jsonb_typeof(inp) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Current original cohort Gemini registration required' USING ERRCODE='42501';END IF;
 IF p_action='gemini_context' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(inp))>1 OR EXISTS(SELECT 1 FROM jsonb_object_keys(inp) k WHERE k NOT IN('conversation_id','attachment_id','message_id')) THEN RAISE EXCEPTION 'Exact Gemini context required';END IF;
 ELSIF p_action='gemini_conversation' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['conversation_id','title']::text[] THEN RAISE EXCEPTION 'Exact conversation required';END IF;
 ELSIF p_action='gemini_begin_turn' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['attachment_ids','body','client_message_id','conversation_id','correlation_id']::text[] THEN RAISE EXCEPTION 'Exact logical turn required';END IF;
 ELSIF p_action='gemini_original_outcome' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inp) k) IS DISTINCT FROM ARRAY['client_message_id','conversation_id']::text[] THEN RAISE EXCEPTION 'Exact original lookup required';END IF;
 ELSE RAISE EXCEPTION 'Unknown cohort Gemini operation' USING ERRCODE='42501';END IF;
 conversation:=(inp->>'conversation_id')::uuid;
 IF p_action='gemini_context' THEN
  IF inp ? 'attachment_id' THEN SELECT conversation_id INTO conversation FROM public.gemini_console_attachments WHERE attachment_id=(inp->>'attachment_id')::uuid AND manager_id=c;IF NOT FOUND THEN RAISE EXCEPTION 'Original cohort attachment unavailable' USING ERRCODE='42501';END IF;END IF;
  IF inp ? 'message_id' THEN SELECT conversation_id INTO conversation FROM public.gemini_console_messages WHERE message_id=(inp->>'message_id')::uuid AND manager_id=c;IF NOT FOUND THEN RAISE EXCEPTION 'Original cohort message unavailable' USING ERRCODE='42501';END IF;END IF;
  IF conversation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active')
   THEN RAISE EXCEPTION 'Original conversation belongs to another browser or named manager' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('conversationIds',coalesce(jsonb_agg(x.conversation_id ORDER BY x.last_activity_at DESC),'[]'::jsonb)) INTO answer FROM(
   SELECT g.conversation_id,g.last_activity_at FROM public.gemini_console_conversations g
   JOIN custodial_leadership_private.gemini_conversation_bindings b ON b.conversation_id=g.conversation_id WHERE b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status<>'deleted' ORDER BY g.last_activity_at DESC LIMIT 100) x;
  RETURN answer;
 ELSIF p_action='gemini_conversation' THEN
  IF conversation IS NULL OR nullif(btrim(inp->>'title'),'') IS NULL OR length(inp->>'title')>160 THEN RAISE EXCEPTION 'Exact new conversation required';END IF;
  SELECT * INTO item FROM public.gemini_console_conversations WHERE conversation_id=conversation FOR UPDATE;
  IF FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active') THEN RAISE EXCEPTION 'Existing conversation cannot be adopted' USING ERRCODE='42501';END IF;
  ELSE
   INSERT INTO public.gemini_console_conversations(conversation_id,owner_manager_id,title) VALUES(conversation,c,inp->>'title') RETURNING * INTO item;
   INSERT INTO custodial_leadership_private.gemini_conversation_bindings(conversation_id,registration_id,cohort_principal_id,claimed_account_id) VALUES(conversation,r,c,(v#>>'{claimedAccount,accountId}')::uuid);
  END IF;
  RETURN to_jsonb(item);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_conversation_bindings b JOIN public.gemini_console_conversations g ON g.conversation_id=b.conversation_id WHERE b.conversation_id=conversation AND b.registration_id=r AND b.cohort_principal_id=c AND g.owner_manager_id=c AND g.status='active')
  THEN RAISE EXCEPTION 'Original cohort conversation required' USING ERRCODE='42501';END IF;
 IF p_action='gemini_original_outcome' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('original_user',to_jsonb(u),'original_assistant',to_jsonb(a))),'[]'::jsonb) INTO answer
   FROM public.gemini_console_messages u JOIN custodial_leadership_private.gemini_message_bindings b ON b.message_id=u.message_id
   LEFT JOIN public.gemini_console_messages a ON a.response_to_message_id=u.message_id AND a.role='assistant'
   WHERE b.registration_id=r AND b.cohort_principal_id=c AND u.manager_id=c AND u.conversation_id=conversation AND u.client_message_id=(inp->>'client_message_id')::uuid AND u.role='user';
  RETURN answer;
 END IF;
 -- Bind this actual private transaction before existing state-changing RPCs.
 PERFORM public.static_weekly_leadership_bind_verified_request(r,(v->>'browserId')::uuid,c,gen_random_uuid());
 IF p_action='gemini_begin_turn' THEN
  SELECT message_id INTO message FROM public.gemini_console_messages WHERE manager_id=c AND client_message_id=(inp->>'client_message_id')::uuid FOR UPDATE;
  IF FOUND AND NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_message_bindings b WHERE b.message_id=message AND b.registration_id=r AND b.cohort_principal_id=c)
   THEN RAISE EXCEPTION 'Existing logical message cannot be adopted' USING ERRCODE='42501';END IF;
  IF jsonb_typeof(inp->'attachment_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(inp->'attachment_ids')>8 THEN RAISE EXCEPTION 'Exact original attachments required';END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO attachments FROM jsonb_array_elements_text(inp->'attachment_ids');
  answer:=public.gemini_console_begin_turn(conversation,c,(inp->>'client_message_id')::uuid,inp->>'body',attachments,(inp->>'correlation_id')::uuid);
  message:=(answer#>>'{user_message,message_id}')::uuid;
  IF answer->'inserted'='true'::jsonb THEN INSERT INTO custodial_leadership_private.gemini_message_bindings(message_id,registration_id,cohort_principal_id,claimed_account_id) VALUES(message,r,c,(v#>>'{claimedAccount,accountId}')::uuid);END IF;
  IF NOT EXISTS(SELECT 1 FROM custodial_leadership_private.gemini_message_bindings b WHERE b.message_id=message AND b.registration_id=r AND b.cohort_principal_id=c) THEN RAISE EXCEPTION 'Original message registration differs' USING ERRCODE='42501';END IF;
  RETURN answer;

 END IF;
 RAISE EXCEPTION 'Unknown cohort Gemini operation' USING ERRCODE='42501';
END $gemini$;
ALTER FUNCTION custodial_leadership_private.gemini_operation(text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION custodial_leadership_private.gemini_operation(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;



-- COMPONENT leadership_runtime_grants SHA256 6f4e00db25d788c3a2558d42e597dc4cdd3a5a93f2adc5df20b92a1422ca5661
-- Only the existing scheduler control-plane role may use the bounded runtime
-- wrapper. It receives no private table or owner-lifecycle privileges.

GRANT USAGE ON SCHEMA custodial_leadership_private TO static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION custodial_leadership_private.runtime(text,jsonb) TO static_weekly_control_plane;


-- COMPONENT owner_release_packet_preparation SHA256 66cc11c2b2a80980125df00335ae458e339533797d8ac10be279f920ea1fb1d0
-- Worker1 preparation-only successor. Main owns SQL qualification/application.
-- AFTER custodial-leadership-pin; BEFORE device delivery and proof LAST.
-- No runtime privilege, chosen-name assertion, context, credential or owner actor.

SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';
DO $requires$ BEGIN
 IF current_user<>session_user OR current_user NOT IN('postgres','supabase_admin')
  OR to_regclass('custodial_leadership_private.policy') IS NULL
  OR to_regprocedure('public.static_weekly_prepare_coverall_activation(jsonb)') IS NULL
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure) IS DISTINCT FROM current_user::regrole::oid
 THEN RAISE EXCEPTION 'Current original packet owner and installed PIN/cohort policy required';END IF;
END $requires$;
CREATE FUNCTION custodial_coverall.assert_packet_preparation_target(p_manager uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE p custodial_leadership_private.policy%rowtype;
BEGIN
 IF p_manager IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Explicit packet preparation target required';END IF;
 SELECT * INTO STRICT p FROM custodial_leadership_private.policy WHERE singleton FOR SHARE;
 IF p_manager=p.cohort_principal_id THEN
  IF p.enabled IS DISTINCT FROM true OR NOT coalesce('custodialManagementAdmin'=ANY(p.permissions),false)
   OR p.approved_by IS NULL OR p.approved_at IS NULL OR p.approval_ref IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.ops_manager_managers m WHERE m.manager_id=p.cohort_principal_id
    AND m.active IS TRUE AND m.revoked_at IS NULL AND m.is_system_principal IS TRUE)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact enabled approved management cohort target required';END IF;
  RETURN; -- Target eligibility ONLY; not an authenticated actor or browser.
 END IF;
 -- Named-target semantics remain the original manager_actor call, unchanged.
 PERFORM public.static_weekly_v3_manager_actor(p_manager);
END $fn$;
REVOKE ALL ON FUNCTION custodial_coverall.assert_packet_preparation_target(uuid)
 FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
DO $single_clause$
DECLARE original text;changed text;inverse text;needle text;replacement text;metadata jsonb;
BEGIN
 SELECT to_jsonb(p)-'prosrc' INTO STRICT metadata FROM pg_proc p WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure;
 original:=pg_get_functiondef('public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure);
 needle:=$before$PERFORM public.static_weekly_v3_manager_actor((p_data->>'managerId')::uuid);$before$;
 replacement:=$after$PERFORM custodial_coverall.assert_packet_preparation_target((p_data->>'managerId')::uuid);$after$;
 IF length(original)-length(replace(original,needle,''))<>length(needle)
  OR position('PERFORM public.static_weekly_v3_assert_release_operator();' IN original)=0
  OR position(replacement IN original)>0
 THEN RAISE EXCEPTION 'Exact release-only packet target predecessor differs';END IF;
 changed:=replace(original,needle,replacement);inverse:=replace(changed,replacement,needle);
 IF inverse<>original THEN RAISE EXCEPTION 'Packet target single-clause whole inverse differs';END IF;
 EXECUTE changed;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='public.static_weekly_prepare_coverall_activation(jsonb)'::regprocedure) IS DISTINCT FROM metadata
 THEN RAISE EXCEPTION 'Packet preparation owner/ACL/signature/config/volatility changed';END IF;
END $single_clause$;
-- Helper is owner-only. Existing release-only prepare EXECUTE and ALL runtime
-- activation/request/credential/permission guards remain byte-literal.


-- COMPONENT manual_device_delivery SHA256 791bf5cb308694e06c4ac170c7d3190f5f68566a1ecf7fb0039ff988b92779c9
-- Source-only proposal. Install AFTER current coverall/native accepted authority.
-- No old recurring confirmation/FK/job/receipt is modified or fabricated.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $owner$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR to_regnamespace('custodial_coverall') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_operations') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_stages') IS NULL
  OR to_regclass('custodial_coverall.recurring_materialization_receipts') IS NULL
  THEN RAISE EXCEPTION 'Actual maintained privileged owner and qualified typed recurring predecessor required';END IF;
END $owner$;
CREATE TABLE custodial_coverall.manual_application_bindings(
 operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),origin text NOT NULL CHECK(origin='MANUAL_INITIAL'),
 publication_id uuid UNIQUE NOT NULL REFERENCES public.weekly_schedule_publications(publication_id),
 source_id uuid NOT NULL REFERENCES public.static_weekly_authority_source_documents(source_id),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),
 version_id uuid NOT NULL REFERENCES public.weekly_schedule_versions(version_id),predecessor_publication_id uuid REFERENCES public.weekly_schedule_publications(publication_id),
 initial_manager_id uuid NOT NULL REFERENCES public.ops_manager_managers(manager_id),initial_idempotency_key text NOT NULL,
 initial_request_json jsonb NOT NULL,initial_receipt_json jsonb NOT NULL,initial_receipt_digest text NOT NULL CHECK(initial_receipt_digest~'^[a-f0-9]{64}$'),
 initial_projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 activation_operation_id uuid UNIQUE REFERENCES custodial_coverall.activation_receipts(operation_id),
 activation_receipt_json jsonb,activation_receipt_digest text,
 original_projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 original_lunch_identity text NOT NULL CHECK(original_lunch_identity~'^[a-f0-9]{64}$'),original_authority_revision bigint NOT NULL REFERENCES public.weekly_schedule_authority_revisions(authority_revision),
 frame_start date NOT NULL,frame_end date NOT NULL,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK(frame_end=frame_start+6),CHECK((activation_operation_id IS NULL AND activation_receipt_json IS NULL AND activation_receipt_digest IS NULL) OR
  (activation_operation_id IS NOT NULL AND activation_receipt_json IS NOT NULL AND activation_receipt_digest~'^[a-f0-9]{64}$'))
);
CREATE TABLE custodial_coverall.manual_application_intents(
 LIKE public.static_weekly_recurring_application_intents INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);
CREATE TABLE custodial_coverall.manual_application_receipts(
 LIKE public.static_weekly_recurring_application_receipts INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
);
ALTER TABLE custodial_coverall.manual_application_intents ADD FOREIGN KEY(operation_id) REFERENCES custodial_coverall.manual_application_bindings(operation_id) ON DELETE RESTRICT;
ALTER TABLE custodial_coverall.manual_application_intents ADD CONSTRAINT manual_application_publication_binding_fkey
 FOREIGN KEY(publication_id) REFERENCES custodial_coverall.manual_application_bindings(publication_id) ON DELETE RESTRICT;
ALTER TABLE custodial_coverall.manual_application_receipts ADD FOREIGN KEY(intent_id) REFERENCES custodial_coverall.manual_application_intents(intent_id) ON DELETE RESTRICT;
-- LIKE deliberately copies no foreign keys. Both legacy origin links must
-- target the genuine MANUAL_INITIAL binding, whose publication FK anchors the
-- native public.weekly_schedule_publications row. Preserve all five existing
-- non-origin principal/projection/revision foreign keys verbatim.
DO $fks$ DECLARE row record;BEGIN
 FOR row IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.static_weekly_recurring_application_intents'::regclass AND contype='f'
  AND conkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.static_weekly_recurring_application_intents'::regclass AND attname='operation_id')]::smallint[]
  AND conkey IS DISTINCT FROM ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.static_weekly_recurring_application_intents'::regclass AND attname='publication_id')]::smallint[] LOOP
  EXECUTE format('ALTER TABLE custodial_coverall.manual_application_intents ADD CONSTRAINT %I %s','manual_'||row.conname,row.definition);
 END LOOP;
END $fks$;
DO $tables$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['manual_application_bindings','manual_application_intents','manual_application_receipts'] LOOP
  EXECUTE format('ALTER TABLE custodial_coverall.%I OWNER TO CURRENT_USER',t);
  EXECUTE format('ALTER TABLE custodial_coverall.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE custodial_coverall.%I FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',t);
  EXECUTE format('CREATE TRIGGER manual_delivery_immutable BEFORE UPDATE OR DELETE ON custodial_coverall.%I FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete()',t);
  EXECUTE format('CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.%I FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()',t);
  EXECUTE format('CREATE TRIGGER custodial_manual_notification_plan_source_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.%I FOR EACH STATEMENT EXECUTE FUNCTION public.static_weekly_v27_notification_plan_source_write_fence()',t);
  EXECUTE format('ALTER TABLE custodial_coverall.%I ENABLE ALWAYS TRIGGER custodial_manual_notification_plan_source_fence',t);
 END LOOP;
END $tables$;
CREATE FUNCTION custodial_coverall.bind_manual_application(p_publication uuid,p_expected_receipt_digest text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $bind$
DECLARE initial public.static_weekly_approved_initial_confirmations%rowtype;publication public.weekly_schedule_publications%rowtype;
 version public.weekly_schedule_versions%rowtype;source public.static_weekly_authority_source_documents%rowtype;
 progress custodial_coverall.activation_progress%rowtype;activation custodial_coverall.activation_receipts%rowtype;
 projection public.weekly_schedule_compiled_projections%rowtype;lunch public.weekly_schedule_lunch_documents%rowtype;
 prior custodial_coverall.manual_application_bindings%rowtype;binding uuid;original_projection uuid;revision bigint;receipt jsonb;prior_publication uuid;
BEGIN
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT publication FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 SELECT * INTO STRICT initial FROM public.static_weekly_approved_initial_confirmations WHERE publication_id=p_publication;
 SELECT * INTO STRICT version FROM public.weekly_schedule_versions WHERE version_id=publication.version_id;
 SELECT * INTO STRICT source FROM public.static_weekly_authority_source_documents WHERE source_id=version.authority_source_id;
 IF initial.receipt_json->>'schema' IS DISTINCT FROM 'custodial.approved-static-initial-confirmation.v1'
  OR initial.receipt_json->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT' OR initial.receipt_json->'ok' IS DISTINCT FROM 'true'::jsonb
  OR initial.receipt_json->>'publication_id' IS DISTINCT FROM p_publication::text OR initial.receipt_json->>'projection_id' IS DISTINCT FROM initial.projection_id::text
  OR initial.receipt_json->>'source_id' IS DISTINCT FROM source.source_id::text OR initial.request_json->>'sourceId' IS DISTINCT FROM source.source_id::text
  OR initial.request_json->>'idempotencyKey' IS DISTINCT FROM initial.idempotency_key
  OR source.source_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(source.canonical_source)
  OR NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_baselines b WHERE b.source_id=source.source_id
    AND b.feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f')
  OR EXISTS(SELECT 1 FROM public.static_weekly_recurring_publication_bindings WHERE publication_id=p_publication)
  THEN RAISE EXCEPTION 'Exact genuine manual initial confirmation/source required';END IF;
 original_projection:=initial.projection_id;receipt:=initial.receipt_json;revision:=(receipt->>'authority_revision')::bigint;
 SELECT * INTO progress FROM custodial_coverall.activation_progress WHERE publication_id=p_publication;
 IF FOUND THEN
  SELECT * INTO STRICT activation FROM custodial_coverall.activation_receipts WHERE operation_id=progress.operation_id;
  receipt:=activation.receipt_json;original_projection:=(receipt->>'projectionId')::uuid;revision:=(receipt->>'authorityRevision')::bigint;
  IF receipt->>'schema' IS DISTINCT FROM 'custodial.approved-manual-coverall-source-confirmation.v2'
   OR receipt->>'kind' IS DISTINCT FROM 'INITIAL_EMPLOYMENT_OPERATIONALIZATION' OR receipt->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
   OR receipt->>'operationId' IS DISTINCT FROM progress.operation_id::text OR receipt->>'managerId' IS DISTINCT FROM progress.manager_id::text
   OR receipt->>'publicationId' IS DISTINCT FROM p_publication::text OR receipt->>'sourceId' IS DISTINCT FROM source.source_id::text
   OR receipt->>'versionId' IS DISTINCT FROM version.version_id::text OR receipt->'normalBaselineResult' IS DISTINCT FROM progress.normal_result
   OR NOT EXISTS(SELECT 1 FROM public.static_weekly_manual_activation_confirmations m
     JOIN custodial_coverall.activation_operations o ON o.operation_id=progress.operation_id AND o.packet_id=m.packet_id
     WHERE m.manager_id=progress.manager_id AND m.idempotency_key='coverall-source:'||progress.operation_id::text
      AND initial.manager_id=m.manager_id AND initial.idempotency_key=m.idempotency_key||':initial'
      AND m.receipt_json=progress.normal_result AND m.receipt_digest=public.static_weekly_digest_jsonb(m.receipt_json)
      AND m.receipt_json->>'schema'='custodial.approved-manual-activation-confirmation.v1'
      AND m.receipt_json->>'status'='PERSISTED_CURRENT' AND m.receipt_json->>'publication_id'=initial.publication_id::text
      AND m.receipt_json->>'projection_id'=initial.projection_id::text AND m.receipt_json->>'source_id'=source.source_id::text
      AND m.receipt_json->>'lunch_document_identity'=initial.receipt_json->>'lunch_document_identity')
   OR receipt->'samePhysicalTransaction' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'Exact genuine final operational activation receipt required';END IF;
 END IF;
 IF p_expected_receipt_digest IS NOT NULL AND public.static_weekly_digest_jsonb(receipt) IS DISTINCT FROM p_expected_receipt_digest THEN RAISE EXCEPTION 'Selected original receipt digest differs';END IF;
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=original_projection;
 SELECT * INTO STRICT lunch FROM public.weekly_schedule_lunch_documents WHERE projection_id=original_projection;
 PERFORM public.static_weekly_v8_assert_lunch_document(original_projection,lunch.document_json);
 IF projection.publication_id IS DISTINCT FROM p_publication OR projection.version_id IS DISTINCT FROM version.version_id
  OR lunch.document_identity IS DISTINCT FROM coalesce(receipt->>'lunchDocumentIdentity',receipt#>>'{lunchResult,document_identity}',initial.receipt_json->>'lunch_document_identity')
  OR lunch.document_identity IS DISTINCT FROM lunch.document_json->>'document_identity'
  OR projection.week_end IS DISTINCT FROM projection.week_start+6
  THEN RAISE EXCEPTION 'Original full publication/projection/lunch receipt correspondence differs';END IF;
 SELECT publication_id INTO prior_publication FROM public.weekly_schedule_publications WHERE version_id=publication.prior_version_id ORDER BY authority_revision DESC LIMIT 1;
 SELECT * INTO prior FROM custodial_coverall.manual_application_bindings WHERE publication_id=p_publication;
 IF FOUND THEN
  IF prior.source_id IS DISTINCT FROM source.source_id OR prior.source_digest IS DISTINCT FROM source.source_digest OR prior.version_id IS DISTINCT FROM version.version_id
   OR prior.initial_manager_id IS DISTINCT FROM initial.manager_id OR prior.initial_idempotency_key IS DISTINCT FROM initial.idempotency_key
   OR prior.initial_request_json IS DISTINCT FROM initial.request_json OR prior.initial_receipt_json IS DISTINCT FROM initial.receipt_json
   OR prior.initial_receipt_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(initial.receipt_json)
   OR prior.initial_projection_id IS DISTINCT FROM initial.projection_id OR prior.activation_operation_id IS DISTINCT FROM activation.operation_id
   OR prior.activation_receipt_json IS DISTINCT FROM activation.receipt_json OR prior.activation_receipt_digest IS DISTINCT FROM (CASE WHEN activation.operation_id IS NULL THEN NULL ELSE public.static_weekly_digest_jsonb(activation.receipt_json) END)
   OR prior.original_projection_id IS DISTINCT FROM projection.projection_id OR prior.original_lunch_identity IS DISTINCT FROM lunch.document_identity
   OR prior.original_authority_revision IS DISTINCT FROM revision OR prior.frame_start IS DISTINCT FROM projection.week_start OR prior.frame_end IS DISTINCT FROM projection.week_end
   OR prior.predecessor_publication_id IS DISTINCT FROM prior_publication THEN RAISE EXCEPTION 'Immutable original manual delivery binding conflict';END IF;
  RETURN prior.operation_id;
 END IF;
 INSERT INTO custodial_coverall.manual_application_bindings(origin,publication_id,source_id,source_digest,version_id,predecessor_publication_id,
  initial_manager_id,initial_idempotency_key,initial_request_json,initial_receipt_json,initial_receipt_digest,initial_projection_id,
  activation_operation_id,activation_receipt_json,activation_receipt_digest,original_projection_id,original_lunch_identity,original_authority_revision,frame_start,frame_end)
 VALUES('MANUAL_INITIAL',p_publication,source.source_id,source.source_digest,version.version_id,prior_publication,initial.manager_id,initial.idempotency_key,
  initial.request_json,initial.receipt_json,public.static_weekly_digest_jsonb(initial.receipt_json),initial.projection_id,
  activation.operation_id,activation.receipt_json,CASE WHEN activation.operation_id IS NULL THEN NULL ELSE public.static_weekly_digest_jsonb(activation.receipt_json) END,
  original_projection,lunch.document_identity,revision,projection.week_start,projection.week_end) RETURNING operation_id INTO binding;
 RETURN binding;
END $bind$;

-- A later frame is not an old recurring confirmation. Require its real immutable
-- typed operation/receipt and exact stored native stage OR original normal-repeat
-- receipt. This is post-admission correspondence, never a feasibility substitute.
CREATE FUNCTION custodial_coverall.manual_recurring_projection_accepted(p_binding uuid,p_projection uuid,p_revision bigint,p_operation uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $accepted_recurring$
DECLARE b custodial_coverall.manual_application_bindings%rowtype;
 p public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
 o custodial_coverall.recurring_materialization_operations%rowtype;
 s custodial_coverall.recurring_materialization_stages%rowtype;
 normal public.static_weekly_manual_repeat_confirmations%rowtype;
 receipt jsonb;vector jsonb;
BEGIN
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=p_binding;
 SELECT * INTO STRICT p FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;
 IF p_projection=b.original_projection_id THEN RETURN false;END IF;
 -- A legitimate normal replay can retain the same projection for another
 -- original request. Any real matching admission proves the immutable bytes;
 -- the receipt trigger supplies its exact NEW operation, never an arbitrary one.
 SELECT operation.* INTO o FROM custodial_coverall.recurring_materialization_operations operation
  JOIN custodial_coverall.recurring_materialization_receipts r USING(operation_id)
  WHERE r.receipt_json->>'projectionId'=p_projection::text AND (p_operation IS NULL OR operation.operation_id=p_operation)
  ORDER BY operation.operation_id LIMIT 1;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT receipt_json INTO STRICT receipt FROM custodial_coverall.recurring_materialization_receipts WHERE operation_id=o.operation_id;
 SELECT * INTO STRICT l FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection;
 IF b.origin<>'MANUAL_INITIAL' OR o.source_id IS DISTINCT FROM b.source_id OR o.source_digest IS DISTINCT FROM b.source_digest
  OR o.publication_id IS DISTINCT FROM b.publication_id OR o.version_id IS DISTINCT FROM b.version_id
  OR p.publication_id IS DISTINCT FROM b.publication_id OR p.version_id IS DISTINCT FROM b.version_id
  OR p.week_start IS DISTINCT FROM o.frame_start OR p.week_end<>o.frame_start+6
  OR receipt->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-confirmation.v2'
  OR receipt->>'kind' IS DISTINCT FROM 'RECURRING_MANUAL_MATERIALIZATION' OR receipt->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
  OR receipt->'operationId' IS DISTINCT FROM to_jsonb(o.operation_id) OR receipt->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id)
  OR receipt->'sourceId' IS DISTINCT FROM to_jsonb(b.source_id) OR receipt->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
  OR receipt->'versionId' IS DISTINCT FROM to_jsonb(b.version_id) OR receipt->'projectionId' IS DISTINCT FROM to_jsonb(p_projection)
  OR receipt->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start) OR receipt->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6)
  OR receipt->'authorityRevision' IS DISTINCT FROM to_jsonb(p_revision) OR p_revision<o.authority_revision
  OR receipt->'lunchDocumentIdentity' IS DISTINCT FROM to_jsonb(l.document_identity)
  OR receipt->'normalSourceChanged' IS DISTINCT FROM 'false'::jsonb OR receipt->'samePhysicalTransaction' IS DISTINCT FROM 'true'::jsonb
  OR receipt->'normalPatternSolverInvoked' IS DISTINCT FROM 'false'::jsonb
  OR o.request_json->'operationId' IS DISTINCT FROM to_jsonb(o.operation_id)
  OR o.request_json->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id)
  OR o.request_json->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
  OR o.request_json->'serviceDate' IS DISTINCT FROM to_jsonb(o.frame_start)
  OR o.request_json->'expectedRevision' IS DISTINCT FROM to_jsonb(o.authority_revision)
  OR o.request_json->>'idempotencyKey' IS DISTINCT FROM o.idempotency_key
  OR o.request_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-request.v1'
  OR o.request_json->>'kind' IS DISTINCT FROM 'RECURRING_MANUAL_MATERIALIZATION'
  OR l.document_json->>'document_identity' IS DISTINCT FROM l.document_identity
  OR l.document_json->>'base_authority_digest' IS DISTINCT FROM p.authority_digest
  OR l.document_json->>'base_replay_digest' IS DISTINCT FROM p.replay_digest
 THEN RAISE EXCEPTION 'Original typed recurring receipt/source/publication/frame/lunch correspondence differs';END IF;
 IF o.basis_json IS NOT NULL AND o.repeat_basis IS NULL THEN
  SELECT * INTO STRICT s FROM custodial_coverall.recurring_materialization_stages WHERE operation_id=o.operation_id;
  IF s.envelope_json IS DISTINCT FROM p.projection_envelope OR s.lunch_json IS DISTINCT FROM l.document_json
   OR s.candidate_digest IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object('envelope',s.envelope_json,'lunch',s.lunch_json))
   OR receipt->>'candidateDigest' IS DISTINCT FROM s.candidate_digest
   OR receipt->'employmentRevisionVector' IS DISTINCT FROM o.basis_json->'employmentRevisionVector'
   OR p.projection_envelope#>'{semantic_snapshot,recurringOperation,operationId}' IS DISTINCT FROM to_jsonb(o.operation_id)
   OR p.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR p.projection_envelope#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-database-adapter.v1'
   OR p.projection_envelope#>'{authority,sourcePublicationId}' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR p.projection_envelope#>'{authority,sourceVersionId}' IS DISTINCT FROM to_jsonb(b.version_id)
   OR p.projection_envelope#>'{authority,normalSourceChanged}' IS DISTINCT FROM 'false'::jsonb
   OR receipt->'newStaffingCommandCreated' IS DISTINCT FROM 'false'::jsonb OR receipt->'newPTOCreated' IS DISTINCT FROM 'false'::jsonb
  THEN RAISE EXCEPTION 'Prepared or changed recurring native stage is not accepted delivery authority';END IF;
 ELSIF o.repeat_basis IS NOT NULL AND o.basis_json IS NULL THEN
  SELECT * INTO STRICT normal FROM public.static_weekly_manual_repeat_confirmations WHERE manager_id=o.manager_id AND request_id=o.operation_id;
  SELECT jsonb_agg(jsonb_build_object('serviceDate',d->'serviceDate','employeeId',e->'employeeId',
   'employmentRevision',e->'employmentRevision','requestId',e#>>'{command,requestId}') ORDER BY d->>'serviceDate',e->>'employeeId') INTO vector
   FROM jsonb_array_elements(o.repeat_basis->'employmentByDate') days(d) CROSS JOIN LATERAL jsonb_array_elements(d->'employees') employees(e);
  IF receipt->'originalRepeatReceipt' IS DISTINCT FROM normal.receipt_json
   OR receipt->'employmentRevisionVector' IS DISTINCT FROM vector OR normal.request_json->'employmentRevisionVector' IS DISTINCT FROM vector
   OR normal.request_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference.v1'
   OR normal.request_json->'managerId' IS DISTINCT FROM to_jsonb(o.manager_id) OR normal.request_json->'requestId' IS DISTINCT FROM to_jsonb(o.operation_id)
   OR normal.request_json->'sourceId' IS DISTINCT FROM to_jsonb(b.source_id) OR normal.request_json->'publicationId' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR normal.request_json->'versionId' IS DISTINCT FROM to_jsonb(b.version_id) OR normal.request_json->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start)
   OR normal.request_json->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6) OR normal.request_json->'expectedRevision' IS DISTINCT FROM to_jsonb(o.authority_revision)
   OR normal.request_json->'generation' IS DISTINCT FROM to_jsonb(o.generation) OR normal.request_json->>'catalogEntryDigest' IS DISTINCT FROM o.catalog_digest
   OR normal.request_json->'origin' IS DISTINCT FROM o.repeat_basis->'origin'
   OR normal.request_json->'baselineSnapshotDigest' IS DISTINCT FROM o.repeat_basis->'baselineSnapshotDigest'
   OR normal.request_json->'sourceProjectionIdentity' IS DISTINCT FROM o.repeat_basis->'sourceProjectionIdentity'
   OR normal.request_json->'sourceLunchIdentity' IS DISTINCT FROM o.repeat_basis->'sourceLunchIdentity'
   OR normal.request_json->>'exceptionSetDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb('[]'::jsonb)
   OR normal.receipt_json->>'schema' IS DISTINCT FROM 'custodial.approved-manual-recurring-confirmation.v1'
   OR normal.receipt_json->>'status' IS DISTINCT FROM 'PERSISTED_CURRENT'
   OR normal.receipt_json->'source_id' IS DISTINCT FROM to_jsonb(b.source_id) OR normal.receipt_json->'publication_id' IS DISTINCT FROM to_jsonb(b.publication_id)
   OR normal.receipt_json->'projection_id' IS DISTINCT FROM to_jsonb(p_projection)
   OR normal.receipt_json->'authority_revision' IS DISTINCT FROM to_jsonb(p_revision)
   OR normal.receipt_json->'frameStart' IS DISTINCT FROM to_jsonb(o.frame_start) OR normal.receipt_json->'frameEnd' IS DISTINCT FROM to_jsonb(o.frame_start+6)
   OR normal.receipt_json->>'lunch_document_identity' IS DISTINCT FROM l.document_identity
   OR normal.receipt_json->>'referenceDigest' IS DISTINCT FROM public.static_weekly_digest_jsonb(normal.request_json)
   OR normal.receipt_json->'normalSourceChanged' IS DISTINCT FROM 'false'::jsonb OR normal.receipt_json->'solverInvoked' IS DISTINCT FROM 'false'::jsonb
   OR receipt->'operationalSelectionSolverInvoked' IS DISTINCT FROM 'false'::jsonb
   OR p.compiler_version IS DISTINCT FROM 'approved-manual-repeat-v1'
   OR p.projection_envelope->>'compiler_version' IS DISTINCT FROM 'approved-manual-repeat-v1'
   OR p.projection_envelope->'applied_exceptions' IS DISTINCT FROM '[]'::jsonb
   OR p.projection_envelope#>>'{adapter,schema}' IS DISTINCT FROM 'custodial.approved-manual-recurring-reference-adapter.v1'
   OR p.projection_envelope#>>'{authority,repeatReference,schema}' IS DISTINCT FROM 'custodial.approved-manual-fixed-period-reference.v1'
   OR p.projection_envelope#>'{authority,repeatReference,sourceId}' IS DISTINCT FROM to_jsonb(b.source_id)
   OR p.projection_envelope#>'{authority,repeatReference,frameStart}' IS DISTINCT FROM to_jsonb(o.frame_start)
   OR p.projection_envelope#>'{authority,repeatReference,origin}' IS DISTINCT FROM normal.request_json->'origin'
   OR p.projection_envelope#>'{authority,repeatReference,baselineSnapshotDigest}' IS DISTINCT FROM normal.request_json->'baselineSnapshotDigest'
   OR p.projection_envelope#>'{authority,repeatReference,originalProjectionIdentity}' IS DISTINCT FROM normal.request_json->'sourceProjectionIdentity'
   OR p.projection_envelope#>'{authority,repeatReference,originalLunchIdentity}' IS DISTINCT FROM normal.request_json->'sourceLunchIdentity'
  THEN RAISE EXCEPTION 'Original admitted normal repeat correspondence differs';END IF;
 ELSE RAISE EXCEPTION 'One exact typed recurring admission kind required';END IF;
 RETURN true;
END $accepted_recurring$;

CREATE OR REPLACE FUNCTION custodial_coverall.reconcile_manual_application_date(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;b custodial_coverall.manual_application_bindings%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
v_recurring_accepted boolean:=false;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 select * into b from custodial_coverall.manual_application_bindings where publication_id=a.publication_id;
 if not found then return 0;end if;
 select * into strict current_projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
 if current_projection.publication_id is distinct from b.publication_id or current_projection.version_id is distinct from b.version_id
  or not exists(select 1 from public.weekly_schedule_versions v join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where v.version_id=b.version_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  or not exists(select 1 from public.static_weekly_approved_initial_confirmations i where i.publication_id=b.publication_id and i.manager_id=b.initial_manager_id
    and i.idempotency_key=b.initial_idempotency_key and i.receipt_json=b.initial_receipt_json and i.request_json=b.initial_request_json
    and public.static_weekly_digest_jsonb(i.receipt_json)=b.initial_receipt_digest)
  then raise exception 'Manual target origin/current source correspondence differs';end if;
 if current_projection.projection_id<>b.original_projection_id then
  v_recurring_accepted:=custodial_coverall.manual_recurring_projection_accepted(b.operation_id,current_projection.projection_id,a.projection_authority_revision);
 end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and
  (current_projection.projection_envelope#>>'{authority,schema}' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
   or current_projection.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
   or current_projection.projection_envelope#>>'{authority,sourcePublicationId}' is distinct from b.publication_id::text
   or current_projection.projection_envelope#>>'{authority,sourceVersionId}' is distinct from b.version_id::text
   or current_projection.projection_envelope#>'{authority,normalSourceChanged}' is distinct from 'false'::jsonb)
  then raise exception 'Only accepted original or exact native manual lineage creates targets';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(
  select 1 from public.static_weekly_staffing_commands command
  join public.static_weekly_staffing_staged_candidates staged on staged.operation_id=command.operation_id and staged.candidate_kind='projection'
  join public.static_weekly_staffing_command_receipts receipt on receipt.operation_id=command.operation_id and receipt.event_kind='ACCEPTED'
  where command.state='ACCEPTED' and staged.payload_json->'envelope'=current_projection.projection_envelope
   and command.accepted_receipt->>'event'='ACCEPTED' and command.accepted_receipt->>'operation_id'=command.operation_id::text
   and command.accepted_receipt->>'semantic_digest'=command.semantic_digest
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'publication_id']=b.publication_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and receipt.receipt_json=command.accepted_receipt and receipt.receipt_digest=public.static_weekly_digest_jsonb(receipt.receipt_json))
  then raise exception 'Prepared native document is not an accepted original operation';end if;
 if b.activation_operation_id is not null and not exists(select 1 from custodial_coverall.activation_receipts r where r.operation_id=b.activation_operation_id
  and r.receipt_json=b.activation_receipt_json and public.static_weekly_digest_jsonb(r.receipt_json)=b.activation_receipt_digest)
  then raise exception 'Original operational activation receipt changed';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 if current_projection.projection_id<>b.original_projection_id and not v_recurring_accepted and not exists(select 1 from public.static_weekly_staffing_commands command
  where command.state='ACCEPTED' and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'projection_id']=current_projection.projection_id::text
   and command.accepted_receipt#>>ARRAY['projections',current_projection.week_start::text,'lunch_document_identity']=l.document_identity)
  then raise exception 'Accepted original native full lunch correspondence differs';end if;
 for person in with people as (
  select (r->>'incumbentPersonId')::uuid employee_id from jsonb_array_elements(coalesce(current_projection.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where r->>'incumbentPersonId' is not null and r->>'serviceDate'=p_date::text
  union select (r->>'incumbentPersonId')::uuid from public.weekly_schedule_compiled_projections old
   cross join lateral jsonb_array_elements(coalesce(old.projection_envelope#>'{authority,projectionAvailability}','[]')) r
   where old.projection_id=b.original_projection_id and r->>'incumbentPersonId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select (r->>'personId')::uuid from public.weekly_schedule_versions v
   cross join lateral jsonb_array_elements(coalesce(v.draft_document#>'{authority,compilerInput,roster}','[]')) r
   where v.version_id=b.version_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union select old.employee_id from custodial_coverall.manual_application_intents old where old.publication_id=b.publication_id and old.service_date=p_date
  union select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and x.service_date=p_date and x.owner_person_id_snapshot is not null
  union select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in(b.publication_id,b.predecessor_publication_id) and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from custodial_coverall.manual_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into custodial_coverall.manual_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$
;
CREATE OR REPLACE FUNCTION custodial_coverall.read_manual_application_target(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t custodial_coverall.manual_application_intents%rowtype;receipt custodial_coverall.manual_application_receipts%rowtype;a record;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application read requires finite date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 select * into t from custodial_coverall.manual_application_intents i
  where i.service_date=p_date and i.device_id=p_device and i.credential_id=p_credential
   and i.employee_id=p_employee and i.assignment_epoch=p_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then
  if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
   return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
  return null;
 end if;
 if a.projection_status is distinct from 'current' or t.publication_id is distinct from a.publication_id
  or t.projection_id is distinct from a.projection_id or t.authority_revision is distinct from a.projection_authority_revision
  or not exists(select 1 from public.weekly_schedule_lunch_documents l where l.projection_id=a.projection_id and l.document_identity=t.lunch_document_identity) then
  return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
 if t.target_json->>'operationId' is distinct from t.operation_id::text or t.target_digest is distinct from public.static_weekly_digest_jsonb(t.target_json)
  or t.view_digest is distinct from public.static_weekly_digest_jsonb(t.view_json)
  or not exists(select 1 from custodial_coverall.manual_application_bindings b join public.weekly_schedule_versions v using(version_id)
    join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
    where b.operation_id=t.operation_id and b.publication_id=a.publication_id and s.source_id=b.source_id and s.source_digest=b.source_digest and s.active=true)
  then raise exception 'Exact typed manual intent/current source bytes differ';end if;
 -- Current typed recurring data must retain its actual immutable admission,
 -- even when a target already exists. Metadata/mode alone is not acceptance.
 if exists(select 1 from public.weekly_schedule_compiled_projections p where p.projection_id=a.projection_id
   and (p.projection_envelope#>'{semantic_snapshot,recurringOperation}' is not null
     or p.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-recurring-reference-adapter.v1'))
  and not custodial_coverall.manual_recurring_projection_accepted(t.operation_id,a.projection_id,a.projection_authority_revision)
 then raise exception 'Exact current typed recurring acceptance is unavailable';end if;
 select * into receipt from custodial_coverall.manual_application_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'view',t.view_json,'viewJsonText',t.view_json::text,'viewDigest',t.view_digest,
  'applicationStatus',case when receipt.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at);
end
$function$
;
CREATE OR REPLACE FUNCTION custodial_coverall.ack_manual_application_target(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t custodial_coverall.manual_application_intents%rowtype;r custodial_coverall.manual_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into t from custodial_coverall.manual_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from custodial_coverall.manual_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into custodial_coverall.manual_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_reconcile_recurring_application_date(date)'::regprocedure)) IS DISTINCT FROM 'fbe23313ab9e85fea04e6901f8367f0051ba9ba550840e4e31c203aaae2ff4d2' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_reconcile_recurring_application_date';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_reconcile_recurring_application_date(p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;b public.static_weekly_recurring_publication_bindings%rowtype;
 p public.static_weekly_recurring_confirmations%rowtype;l public.weekly_schedule_lunch_documents%rowtype;
person record;device record;v_view jsonb;v_target jsonb;v_view_digest text;v_intent uuid;v_count int:=0;v_devices int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application reconciliation requires one finite date';end if;
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_reconcile_terminal_date(p_date);end if;
 if a.projection_status is distinct from 'current' or a.projection_id is null then raise exception 'recurring schedule projection is unavailable';end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 select * into b from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id;
 if not found then return custodial_coverall.reconcile_manual_application_date(p_date);end if; -- exact manual origin is separate, never a recurring confirmation
 select * into strict p from public.static_weekly_recurring_confirmations where operation_id=b.operation_id;
 if not exists(select 1 from public.static_weekly_recurring_confirmation_receipts r where r.operation_id=b.operation_id)
  and (b.owner_xid<>pg_current_xact_id() or p.owner_xid<>pg_current_xact_id()) then
  raise exception 'unaccepted recurring parent cannot create phone targets';end if;
 select * into l from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
 if not found then raise exception 'exact recurring lunch companion is unavailable';end if;
 for person in with people as (
  select (r->>'personId')::uuid employee_id from jsonb_array_elements(b.dependency_snapshot->'roster') r
   where r->>'personId' is not null and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select (r->>'personId')::uuid from public.static_weekly_recurring_publication_bindings prior
   cross join lateral jsonb_array_elements(prior.dependency_snapshot->'roster') r
   where prior.publication_id=b.predecessor_publication_id and r->>'personId' is not null
    and extract(isodow from (r->>'serviceDate')::date)=extract(isodow from p_date)
  union
  select x.owner_person_id_snapshot from public.weekly_schedule_occurrences x
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id) and x.service_date=p_date
    and x.owner_person_id_snapshot is not null
  union
  select (r->>'normal_owner_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'normal_owner_person_id' is not null
  union
  select (r->>'coverer_person_id')::uuid from public.weekly_schedule_lunch_documents lunch
   join public.weekly_schedule_compiled_projections projection using(projection_id)
   cross join lateral jsonb_array_elements(lunch.document_json->'responsibilities') r
   where projection.publication_id in (a.publication_id,b.predecessor_publication_id)
    and r->>'service_date'=p_date::text and r->>'coverer_person_id' is not null
 ) select distinct people.employee_id from people join public.employees e on e.id=people.employee_id order by people.employee_id loop
  v_view:=public.static_weekly_v22_recurring_render_view(a.projection_id,p_date,person.employee_id);
  v_view_digest:=public.static_weekly_digest_jsonb(v_view);v_devices:=0;
  -- Rotation/reconnect must not silently create a different view at the same
  -- authority identity, nor make ON CONFLICT hide changed display bytes.
  if exists(select 1 from public.static_weekly_recurring_application_intents i
   where i.publication_id=a.publication_id and i.projection_id=a.projection_id
    and i.service_date=p_date and i.employee_id=person.employee_id
    and i.authority_revision=a.projection_authority_revision
    and (i.view_json is distinct from v_view or i.view_digest is distinct from v_view_digest
      or i.lunch_document_identity is distinct from l.document_identity)) then
   raise exception using errcode='23514',message='recurring render changed without a new exact authority identity';end if;
  for device in select d.id,c.credential_id,d.assignment_epoch from public.devices d
   join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
    and c.revoked_at is null and c.expires_at>statement_timestamp()
   where d.active=true and d.assigned_employee_id=person.employee_id
   order by d.id,c.credential_id loop
   v_devices:=v_devices+1;
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',device.id,'credentialId',device.credential_id,
    'assignmentEpoch',device.assignment_epoch,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,device_id,credential_id,assignment_epoch,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,device.id,device.credential_id,
    device.assignment_epoch,a.projection_authority_revision,l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end loop;
  if v_devices=0 then
   v_target:=jsonb_build_object('schema','static-weekly.recurring-application-target.v1','targetType','SCHEDULE',
    'operationId',b.operation_id,'publicationId',a.publication_id,'projectionId',a.projection_id,'serviceDate',p_date,
    'authorityRevision',a.projection_authority_revision,'lunchDocumentIdentity',l.document_identity,
    'employeeId',person.employee_id,'deviceId',null,'credentialId',null,'assignmentEpoch',null,'viewDigest',v_view_digest);
   insert into public.static_weekly_recurring_application_intents(operation_id,publication_id,projection_id,service_date,
    employee_id,authority_revision,lunch_document_identity,view_json,view_digest,target_json,target_digest)
   values(b.operation_id,a.publication_id,a.projection_id,p_date,person.employee_id,a.projection_authority_revision,
    l.document_identity,v_view,v_view_digest,v_target,public.static_weekly_digest_jsonb(v_target))
   on conflict do nothing returning intent_id into v_intent;
   if found then v_count:=v_count+1;end if;
  end if;
 end loop;
 return v_count;
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_read_recurring_application_target(date,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM 'a2d04f831cce37de5bd503adea6e648f8b99545e24c111a74c9b0764807990da' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_read_recurring_application_target';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_read_recurring_application_target(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;receipt public.static_weekly_recurring_application_receipts%rowtype;a record;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'recurring application read requires finite date';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if a.projection_status='blocked_recurring_authority' then return public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  return custodial_coverall.read_manual_application_target(p_date,p_device,p_credential,p_employee,p_epoch);end if;
 select * into t from public.static_weekly_recurring_application_intents i
  where i.service_date=p_date and i.device_id=p_device and i.credential_id=p_credential
   and i.employee_id=p_employee and i.assignment_epoch=p_epoch
  order by i.authority_revision desc,i.created_at desc,i.intent_id desc limit 1;
 if not found then
  if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
   return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
  return null;
 end if;
 if a.projection_status is distinct from 'current' or t.publication_id is distinct from a.publication_id
  or t.projection_id is distinct from a.projection_id or t.authority_revision is distinct from a.projection_authority_revision then
  return jsonb_build_object('applicationStatus','PENDING_TARGET_RECONCILIATION','affectedPhonesUpdated',false);end if;
 select * into receipt from public.static_weekly_recurring_application_receipts where intent_id=t.intent_id;
 return jsonb_build_object('intentId',t.intent_id,'target',t.target_json,'targetDigest',t.target_digest,
  'view',t.view_json,'viewJsonText',t.view_json::text,'viewDigest',t.view_digest,
  'applicationStatus',case when receipt.intent_id is null then 'PENDING' else 'DEVICE_REPORTED_APPLIED' end,
  'receiptId',receipt.receipt_id,'appliedAt',receipt.applied_at,'receivedAt',receipt.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v22_ack_recurring_application_target(uuid,uuid,uuid,uuid,bigint,bigint,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '12b247915de07ae32eee0209b82ce2c30d7470dbc16184f4cc7f3b5e30b3d6d9' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v22_ack_recurring_application_target';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v22_ack_recurring_application_target(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;r public.static_weekly_recurring_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
  if exists(select 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent) then raise exception 'Ambiguous typed intent ownership';end if;
  return custodial_coverall.ack_manual_application_target(p_intent,p_device,p_credential,p_employee,p_epoch,p_revision,p_target_digest,p_rendered_digest,p_applied_at);end if;
 select * into t from public.static_weekly_recurring_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from public.static_weekly_recurring_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into public.static_weekly_recurring_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v24_read_device_schedule_delivery(date,uuid,uuid,uuid,bigint)'::regprocedure)) IS DISTINCT FROM '063b3b106479fc656269ad0729e119d480e65dcac72c6c311dbbfdd65cfe7a38' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v24_read_device_schedule_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v24_read_device_schedule_delivery(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;v_delivery jsonb;v_dated jsonb;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'schedule delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if a.projection_status='blocked_recurring_authority' then
  -- Terminal wins before any older dated or recurring schedule is considered.
  v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   perform public.static_weekly_v19_reconcile_terminal_date(p_date);
   v_delivery:=public.static_weekly_v19_read_terminal_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_TERMINAL',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false);
 end if;
 if exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id)
  or exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  if a.projection_status is distinct from 'current' then
   return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','UNAVAILABLE',
    'projectionStatus',a.projection_status,'delivery',null,'datedApplication',null,'affectedPhonesUpdated',false);
  end if;
  v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  if v_delivery->>'intentId' is null then
   -- Reconcile only a missing current identity. Existing immutable views do
   -- not need all-person reconstruction on every connected phone poll.
   perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
   v_delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
  end if;
  return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','RECURRING_SCHEDULE',
   'delivery',v_delivery,'datedApplication',null,'affectedPhonesUpdated',false,
   'authorityOrigin',case when exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    then (select jsonb_build_object('kind','MANUAL_INITIAL','bindingId',operation_id) from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    else jsonb_build_object('kind','RECURRING_CONFIRMATION','bindingId',v_delivery#>'{target,operationId}') end);
 end if;
 -- Existing release-registered/dated workflow stays separate. Never use an
 -- old dated target with a different exact current publication/projection.
 v_dated:=public.static_weekly_v10_read_device_schedule_application(p_date,p_device,p_credential,p_employee,p_epoch);
 if a.projection_status is distinct from 'current'
  or v_dated->>'publication_id' is distinct from a.publication_id::text
  or v_dated->>'projection_id' is distinct from a.projection_id::text
  or v_dated->>'authority_revision' is distinct from a.projection_authority_revision::text then v_dated:=null;end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery.v1','mode','LEGACY_REGISTERED',
  'delivery',null,'datedApplication',v_dated,'affectedPhonesUpdated',false);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v24_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '6a07f3cbb6d04adf6f93045a90ef1917a057b4dbcf52530db311e459dbecc89b' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v24_ack_device_schedule_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v24_ack_device_schedule_delivery(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_target_type text, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;
 terminal public.static_weekly_recurring_terminal_intents%rowtype;dated record;v_result jsonb;
begin
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='schedule delivery requires an active employee principal';end if;
 if p_target_type='BLOCKED_RECURRING_AUTHORITY' then
  select * into terminal from public.static_weekly_recurring_terminal_intents where intent_id=p_intent;
  if not found or p_target_digest is distinct from terminal.target_digest
   or p_rendered_digest is distinct from p_target_digest then
   raise exception using errcode='23514',message='terminal delivery receipt requires exact target bytes';end if;
  v_result:=public.static_weekly_v19_ack_terminal_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_rendered_digest,p_applied_at);
 elsif p_target_type='SCHEDULE' then
  v_result:=public.static_weekly_v22_ack_recurring_application_target(p_intent,p_device,p_credential,p_employee,p_epoch,
   p_revision,p_target_digest,p_rendered_digest,p_applied_at);
  if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
   select * into strict t from custodial_coverall.manual_application_intents where intent_id=p_intent;
  else
   select * into strict t from public.static_weekly_recurring_application_intents where intent_id=p_intent;
  end if;
  -- A dated absence/cancellation may use the same current recurring winner.
  -- Preserve its existing manager delivery receipt only for the EXACT same
  -- principal, date, revision, projection and lunch just applied. Caller
  -- supplies no dated operation/intent identity. Old/different targets remain
  -- history; no fabricated ACK on enqueue, provider acceptance or new device.
  for dated in select i.* from public.static_weekly_schedule_application_intents i
   join public.static_weekly_staffing_commands c on c.operation_id=i.operation_id and c.state='ACCEPTED'
   where i.service_date=t.service_date and i.employee_id=t.employee_id and i.device_id=t.device_id
    and i.credential_id=t.credential_id and i.assignment_epoch=t.assignment_epoch
    and i.authority_revision=t.authority_revision and i.publication_id=t.publication_id
    and i.projection_id=t.projection_id and i.lunch_document_identity=t.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=i.intent_id)
   order by i.intent_id loop
   perform public.static_weekly_v10_ack_device_schedule_application(dated.intent_id,p_device,p_credential,p_employee,p_epoch,
    p_revision,t.projection_id,t.lunch_document_identity,p_rendered_digest,p_applied_at);
  end loop;
 else raise exception using errcode='22023',message='exact typed schedule delivery receipt required';end if;
 return jsonb_build_object('schema','static-weekly.device-schedule-delivery-receipt.v1','receipt',v_result,
  'currentAuthorityNotInferred',true);
end
$function$
;
DO $predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v25_read_current_recurring_delivery(date,uuid)'::regprocedure)) IS DISTINCT FROM '3bf65a972869ff81372ad3f3952daace5739a139985f685a5b368bbdaaa602d7' THEN RAISE EXCEPTION 'Exact delivery predecessor differs: static_weekly_v25_read_current_recurring_delivery';END IF;END $predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v25_read_current_recurring_delivery(p_date date, p_manager uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a record;t public.static_weekly_recurring_invalidations%rowtype;
 v_mode text;v_rows jsonb:='[]'::jsonb;v_count int;v_reported int;
begin
 if p_date is null or not isfinite(p_date) then raise exception 'current recurring delivery requires one finite service date';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v3_manager_actor(p_manager);
 select * into a from public.static_weekly_v6_schedule_authority_state(p_date);
 if exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
  and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then raise exception 'Conflicting current manual/recurring origins';end if;
 if a.projection_status='blocked_recurring_authority' then
  v_mode:='RECURRING_TERMINAL';
  perform public.static_weekly_v19_reconcile_terminal_date(p_date);
  t:=public.static_weekly_v19_current_terminal_range(p_date);
 elsif a.projection_status='current' and exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) then
  v_mode:='RECURRING_SCHEDULE';
  perform custodial_coverall.reconcile_manual_application_date(p_date);
 elsif a.projection_status='current' and exists(select 1 from public.static_weekly_recurring_publication_bindings where publication_id=a.publication_id) then
  v_mode:='RECURRING_SCHEDULE';
  perform public.static_weekly_v22_reconcile_recurring_application_date(p_date);
 else
  v_mode:=case when a.projection_status='current' then 'LEGACY_REGISTERED' else 'UNAVAILABLE' end;
 end if;
 if v_mode in ('RECURRING_SCHEDULE','RECURRING_TERMINAL') then
  with targets as (
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.view_digest rendered_digest,r.receipt_id,r.rendered_digest receipt_digest,r.received_at
   from public.static_weekly_recurring_application_intents i
   left join public.static_weekly_recurring_application_receipts r using(intent_id)
   where v_mode='RECURRING_SCHEDULE' and i.service_date=p_date and i.publication_id=a.publication_id
    and i.projection_id=a.projection_id and i.authority_revision=a.projection_authority_revision
   union all
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.view_digest,r.receipt_id,r.rendered_digest,r.received_at
   from custodial_coverall.manual_application_intents i
   left join custodial_coverall.manual_application_receipts r using(intent_id)
   where v_mode='RECURRING_SCHEDULE' and i.service_date=p_date and i.publication_id=a.publication_id
    and i.projection_id=a.projection_id and i.authority_revision=a.projection_authority_revision
   union all
   select i.employee_id,i.device_id,i.credential_id,i.assignment_epoch,i.intent_id,
    i.target_digest,i.target_digest,r.receipt_id,r.rendered_digest,r.received_at
   from public.static_weekly_recurring_terminal_intents i
   left join public.static_weekly_recurring_terminal_receipts r using(intent_id)
   where v_mode='RECURRING_TERMINAL' and i.service_date=p_date and i.invalidation_id=t.invalidation_id
    and i.authority_revision=t.authority_revision
  ), people as (select distinct employee_id from targets), current_rows as (
   select p.employee_id,e.display_name,e.active,device.id device_id,device.device_name,
    device.credential_id,device.assignment_epoch,x.intent_id,x.target_digest,x.receipt_id,x.received_at,
    case when e.active is distinct from true then 'PROTECTED_PRINCIPAL_PENDING'
     when device.id is null then 'NO_CURRENT_DEVICE'
     when x.intent_id is null then 'PENDING_TARGET_RECONCILIATION'
     when x.receipt_id is null or x.receipt_digest is distinct from x.rendered_digest then 'PENDING'
     when v_mode='RECURRING_TERMINAL' then 'DEVICE_REPORTED_BLOCKED' else 'DEVICE_REPORTED_APPLIED' end status
   from people p join public.employees e on e.id=p.employee_id
   left join lateral (
    select d.id,d.device_name,d.assignment_epoch,c.credential_id from public.devices d
    join public.device_auth_credentials c on c.device_id=d.id and c.confirmed_at is not null
     and c.revoked_at is null and c.expires_at>statement_timestamp()
    where d.active=true and d.assigned_employee_id=p.employee_id
   ) device on true
   left join targets x on x.employee_id=p.employee_id and x.device_id is not distinct from device.id
    and x.credential_id is not distinct from device.credential_id
    and x.assignment_epoch is not distinct from device.assignment_epoch
  ) select coalesce(jsonb_agg(jsonb_build_object('employeeId',employee_id,'employeeName',display_name,
    'deviceId',device_id,'deviceName',device_name,'credentialId',credential_id,'assignmentEpoch',assignment_epoch,
    'intentId',intent_id,'targetDigest',target_digest,'status',status,
    'receiptId',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then receipt_id end,
    'receivedAt',case when status in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED') then received_at end)
    order by employee_id,device_id,credential_id),'[]'::jsonb) into v_rows from current_rows;
 end if;
 v_count:=jsonb_array_length(v_rows);
 select count(*) into v_reported from jsonb_array_elements(v_rows) row
  where row->>'status' in ('DEVICE_REPORTED_APPLIED','DEVICE_REPORTED_BLOCKED');
 return jsonb_build_object('schema','static-weekly.current-recurring-delivery.v1','serviceDate',p_date,
  'observedAt',statement_timestamp(),'mode',v_mode,'projectionStatus',a.projection_status,
  'currentAuthority',jsonb_build_object('publicationId',a.publication_id,'projectionId',a.projection_id,
    'authorityRevision',case when v_mode='RECURRING_TERMINAL' then t.authority_revision else a.projection_authority_revision end,
    'invalidationId',t.invalidation_id),'targets',v_rows,'targetCount',v_count,'reportedCount',v_reported,
  'allCurrentTargetsReported',v_count>0 and v_count=v_reported,
  'affectedPhonesUpdated',v_mode='RECURRING_SCHEDULE' and v_count>0 and v_count=v_reported,
  'authorityOrigin',case when exists(select 1 from custodial_coverall.manual_application_bindings where publication_id=a.publication_id)
    then (select jsonb_build_object('kind','MANUAL_INITIAL','bindingId',operation_id) from custodial_coverall.manual_application_bindings where publication_id=a.publication_id) else null end,
  'coverageReadinessNotInferred',true);
end
$function$
;
CREATE FUNCTION custodial_coverall.reconcile_manual_publication(p_publication uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $pub$
DECLARE b custodial_coverall.manual_application_bindings%rowtype;day date;a record;
BEGIN
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE publication_id=p_publication;
 FOR day IN SELECT DISTINCT d::date FROM public.weekly_schedule_compiled_projections p
  JOIN public.weekly_schedule_lunch_documents l USING(projection_id)
  CROSS JOIN LATERAL generate_series(p.week_start,p.week_end,'1 day') d WHERE p.publication_id=b.publication_id ORDER BY d::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status='current' AND a.publication_id=b.publication_id THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
 END LOOP;
END $pub$;
-- Genuine explicit catch-up: exact stored receipt, once; never acceptance replay.
CREATE FUNCTION public.static_weekly_bind_manual_device_delivery(p_manager uuid,p_publication uuid,p_receipt_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $catchup$
DECLARE binding uuid;b custodial_coverall.manual_application_bindings%rowtype;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();PERFORM public.static_weekly_v3_manager_actor(p_manager);
 IF coalesce(p_receipt_digest,'')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Exact original receipt digest required';END IF;
 binding:=custodial_coverall.bind_manual_application(p_publication,p_receipt_digest);
 PERFORM custodial_coverall.reconcile_manual_publication(p_publication);
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=binding;
 RETURN jsonb_build_object('schema','custodial.manual-device-delivery-binding.v1','origin','MANUAL_INITIAL','bindingId',binding,
  'publicationId',b.publication_id,'sourceId',b.source_id,'originalProjectionId',b.original_projection_id,
  'originalLunchDocumentIdentity',b.original_lunch_identity,'originalReceiptDigest',coalesce(b.activation_receipt_digest,b.initial_receipt_digest),
  'phoneDeliveryState','PENDING','affectedPhonesUpdated',false,'acceptanceRerun',false);
END $catchup$;
CREATE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $accepted$
DECLARE pub uuid;binding uuid;b custodial_coverall.manual_application_bindings%rowtype;day date;a record;
BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='static_weekly_approved_initial_confirmations' THEN
  IF NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_baselines baseline WHERE baseline.source_id=(NEW.receipt_json->>'source_id')::uuid
   AND baseline.feasibility#>>'{candidateSource,version,manualGroupRatingAuthority,manifestSha256}'='fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f') THEN RETURN NEW;END IF;
  pub:=NEW.publication_id;
 ELSIF TG_TABLE_SCHEMA='custodial_coverall' AND TG_TABLE_NAME='activation_receipts' THEN
  SELECT publication_id INTO STRICT pub FROM custodial_coverall.activation_progress WHERE operation_id=NEW.operation_id;
 ELSE RAISE EXCEPTION 'Exact accepted manual receipt owner required';END IF;
 binding:=custodial_coverall.bind_manual_application(pub,NULL);
 PERFORM custodial_coverall.reconcile_manual_publication(pub);
 SELECT * INTO STRICT b FROM custodial_coverall.manual_application_bindings WHERE operation_id=binding;
 FOR day IN SELECT generate_series(b.frame_start,b.frame_end,'1 day')::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status IS DISTINCT FROM 'current' OR a.publication_id IS DISTINCT FROM pub OR a.projection_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.weekly_schedule_lunch_documents WHERE projection_id=a.projection_id)
   THEN RAISE EXCEPTION 'New manual acceptance requires all seven exact current projection/full-lunch days in this transaction';END IF;
 END LOOP;RETURN NEW;
END $accepted$;
CREATE CONSTRAINT TRIGGER manual_initial_delivery_complete
 AFTER INSERT ON public.static_weekly_approved_initial_confirmations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance();
CREATE TRIGGER manual_operational_delivery_complete
 AFTER INSERT ON custodial_coverall.activation_receipts FOR EACH ROW EXECUTE FUNCTION custodial_coverall.bind_manual_delivery_after_acceptance();
-- The actual full accepted projection+lunch is available only after its writer.
-- Deferred execution observes final native acceptance, not a prepared document.
CREATE FUNCTION custodial_coverall.reconcile_manual_delivery_after_lunch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $lunch$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;day date;a record;
BEGIN
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=NEW.projection_id;
 IF EXISTS(SELECT 1 FROM custodial_coverall.manual_application_bindings WHERE publication_id=projection.publication_id) THEN
  FOR day IN SELECT generate_series(projection.week_start,projection.week_end,'1 day')::date LOOP
   SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
   IF a.projection_status='current' AND a.publication_id=projection.publication_id AND a.projection_id=projection.projection_id
    THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
  END LOOP;
 END IF;RETURN NEW;
END $lunch$;
CREATE CONSTRAINT TRIGGER manual_native_delivery_after_lunch
 AFTER INSERT ON public.weekly_schedule_lunch_documents DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.reconcile_manual_delivery_after_lunch();
-- Receipt insertion follows the real native/normal writer. Deferred execution
-- observes its final stored rows in the same transaction, not a staged candidate.
CREATE FUNCTION custodial_coverall.reconcile_manual_delivery_after_recurring_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $recurring_delivery$
DECLARE operation custodial_coverall.recurring_materialization_operations%rowtype;
 binding uuid;projection uuid;day date;a record;
BEGIN
 IF TG_TABLE_SCHEMA<>'custodial_coverall' OR TG_TABLE_NAME<>'recurring_materialization_receipts'
 THEN RAISE EXCEPTION 'Exact typed recurring receipt owner required';END IF;
 SELECT * INTO STRICT operation FROM custodial_coverall.recurring_materialization_operations WHERE operation_id=NEW.operation_id;
 SELECT operation_id INTO STRICT binding FROM custodial_coverall.manual_application_bindings WHERE publication_id=operation.publication_id;
 projection:=(NEW.receipt_json->>'projectionId')::uuid;
 IF NOT custodial_coverall.manual_recurring_projection_accepted(binding,projection,(NEW.receipt_json->>'authorityRevision')::bigint,NEW.operation_id)
 THEN RAISE EXCEPTION 'Actual accepted recurring receipt required before delivery reconciliation';END IF;
 FOR day IN SELECT generate_series(operation.frame_start,operation.frame_start+6,'1 day')::date LOOP
  SELECT * INTO a FROM public.static_weekly_v6_schedule_authority_state(day);
  IF a.projection_status='current' AND a.publication_id=operation.publication_id AND a.projection_id=projection
   THEN PERFORM custodial_coverall.reconcile_manual_application_date(day);END IF;
 END LOOP;
 RETURN NEW;
END $recurring_delivery$;
CREATE CONSTRAINT TRIGGER manual_recurring_delivery_after_receipt
 AFTER INSERT ON custodial_coverall.recurring_materialization_receipts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION custodial_coverall.reconcile_manual_delivery_after_recurring_receipt();
-- Only manual typed intent/projection SHARE NOWAIT locks are added; principal,
-- reservation/current-plan/token/time and final original ACK checks stay literal.
DO $ack_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v27_ack_device_schedule_delivery(uuid,uuid,uuid,uuid,uuid,bigint,text,bigint,text,text,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM 'faa0f55d4896f4363000c5953a2fef8caa864d5db77902a9bf047071d55f3ff2' THEN RAISE EXCEPTION 'Exact v27 original ACK predecessor differs';END IF;END $ack_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_ack_device_schedule_delivery(p_plan_read uuid, p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_target_type text, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare original public.static_weekly_recurring_notification_plan_reads%rowtype;principal jsonb;current_plan jsonb;body jsonb;
 result jsonb;semantic text;at_time timestamptz;until_time timestamptz;locked record;
begin
 perform public.static_weekly_v27_lock_notification_plan_sources();
 principal:=public.static_weekly_v27_notification_plan_backend_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict original from public.static_weekly_recurring_notification_plan_reads where plan_read_id=p_plan_read;
 if original.intent_id is distinct from p_intent or original.device_id is distinct from p_device
  or original.credential_id is distinct from p_credential or original.employee_id is distinct from p_employee
  or original.assignment_epoch is distinct from p_epoch or original.target_type is distinct from p_target_type
  or original.authority_revision is distinct from p_revision or original.target_digest is distinct from p_target_digest
  or original.rendered_digest is distinct from p_rendered_digest or original.backend_principal is distinct from principal then
  raise exception 'exact issued notification plan read required' using errcode='42501';end if;
 -- A complete normal plan with unavailable original jobs is UI DATA only.
 -- It must never grant the same receipt through a header/token-only caller.
 if original.plan_body->>'schema'='custodial.recurring-current-notification-plan.v2'
  and (original.plan_body#>>'{delivery_bindings,state}' is distinct from 'ORIGINAL_NATIVE_RESERVATIONS'
   or case when jsonb_typeof(original.plan_body#>'{delivery_bindings,entries}')='array'
    then jsonb_array_length(original.plan_body#>'{delivery_bindings,entries}') else 0 end<>jsonb_array_length(original.plan_body->'required_effects')
   or jsonb_array_length(original.plan_body->'required_effects')<1) then
  raise exception 'issued original native bindings unavailable' using errcode='42501';end if;
 at_time:=clock_timestamp();if at_time>=original.valid_until then raise exception 'issued notification plan expired' using errcode='40001';end if;
 current_plan:=public.static_weekly_v27_notification_plan_at(original.service_date,p_device,p_credential,p_employee,p_epoch,p_intent,p_target_digest,at_time);
 body:=current_plan->'body';until_time:=least((body->>'valid_until')::timestamptz,(principal->>'credential_expires_at')::timestamptz);
 body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(until_time)))
  ||jsonb_build_object('backend_principal_digest',public.static_weekly_digest_jsonb(principal));
 semantic:=public.static_weekly_digest_jsonb(body-'observed_at');
 -- Exact original job selection is separately bound/recompared. A future
 -- semantic-effect refactor must not silently omit native-original custody.
 if (body->'delivery_bindings') is distinct from (original.plan_body->'delivery_bindings')
  or (body->>'schema') is distinct from (original.plan_body->>'schema') then
  raise exception 'issued original native binding changed' using errcode='40001';end if;
 if semantic is distinct from original.semantic_digest or until_time is distinct from original.valid_until then
  raise exception 'issued notification plan source changed' using errcode='40001';end if;
 -- Old writer's explicit row locks and FK key-share probes are pre-admitted
 -- with NOWAIT, including pure row-locking transactions (ROW SHARE table mode).
 -- Source-exclusive prevents new recurring rows; auxiliary SRE prevents new
 -- dated intent/receipt rows. Any pre-existing conflicting row lock refuses.
 if p_target_type='SCHEDULE' then
  if exists(select 1 from custodial_coverall.manual_application_intents where intent_id=p_intent) then
   if exists(select 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent)
    then raise exception 'Ambiguous original manual/recurring intent owner';end if;
  perform 1 from custodial_coverall.manual_application_intents where intent_id=p_intent for share nowait;
  perform 1 from public.weekly_schedule_compiled_projections p
   join custodial_coverall.manual_application_intents i on i.projection_id=p.projection_id
   where i.intent_id=p_intent for share of p nowait;
  for locked in select d.intent_id,d.projection_id
   from public.static_weekly_schedule_application_intents d
   join custodial_coverall.manual_application_intents i on i.intent_id=p_intent
   join public.static_weekly_staffing_commands c on c.operation_id=d.operation_id and c.state='ACCEPTED'
   where d.service_date=i.service_date and d.employee_id=i.employee_id and d.device_id=i.device_id
    and d.credential_id=i.credential_id and d.assignment_epoch=i.assignment_epoch
    and d.authority_revision=i.authority_revision and d.publication_id=i.publication_id
    and d.projection_id=i.projection_id and d.lunch_document_identity=i.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=d.intent_id)
   order by d.intent_id for share of d nowait loop
   perform 1 from public.weekly_schedule_compiled_projections where projection_id=locked.projection_id for share nowait;
  end loop;
  else
  perform 1 from public.static_weekly_recurring_application_intents where intent_id=p_intent for share nowait;
  perform 1 from public.weekly_schedule_compiled_projections p
   join public.static_weekly_recurring_application_intents i on i.projection_id=p.projection_id
   where i.intent_id=p_intent for share of p nowait;
  for locked in select d.intent_id,d.projection_id
   from public.static_weekly_schedule_application_intents d
   join public.static_weekly_recurring_application_intents i on i.intent_id=p_intent
   join public.static_weekly_staffing_commands c on c.operation_id=d.operation_id and c.state='ACCEPTED'
   where d.service_date=i.service_date and d.employee_id=i.employee_id and d.device_id=i.device_id
    and d.credential_id=i.credential_id and d.assignment_epoch=i.assignment_epoch
    and d.authority_revision=i.authority_revision and d.publication_id=i.publication_id
    and d.projection_id=i.projection_id and d.lunch_document_identity=i.lunch_document_identity
    and not exists(select 1 from public.static_weekly_schedule_application_receipts r where r.intent_id=d.intent_id)
   order by d.intent_id for share of d nowait loop
   perform 1 from public.weekly_schedule_compiled_projections where projection_id=locked.projection_id for share nowait;
  end loop;
  end if;
 else
  perform 1 from public.static_weekly_recurring_terminal_intents where intent_id=p_intent for share nowait;
 end if;
 result:=public.static_weekly_v24_ack_device_schedule_delivery(p_intent,p_device,p_credential,p_employee,p_epoch,
  p_target_type,p_revision,p_target_digest,p_rendered_digest,p_applied_at);
 -- All sources stay write-fenced until COMMIT. Fresh server time AFTER the
 -- original receipt writer is the final check; a failure rolls back its rows.
 if clock_timestamp()>=original.valid_until then raise exception 'issued notification plan expired during receipt' using errcode='40001';end if;
 return result;
end $function$;
DO $private_owners$ DECLARE row record;BEGIN
 FOR row IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_coverall' AND p.proname=ANY(ARRAY['bind_manual_application','manual_recurring_projection_accepted','reconcile_manual_application_date','read_manual_application_target','ack_manual_application_target','reconcile_manual_publication','bind_manual_delivery_after_acceptance','reconcile_manual_delivery_after_lunch','reconcile_manual_delivery_after_recurring_receipt']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',row.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',row.signature);
 END LOOP;
END $private_owners$;
ALTER FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
GRANT EXECUTE ON FUNCTION public.static_weekly_bind_manual_device_delivery(uuid,uuid,text) TO static_weekly_control_plane;
-- The accepted exception identity is invariant across projection/receipt rows.
-- A genuinely uncorrelated scalar subquery makes it an InitPlan (at most once
-- per employee-day reader statement), without eager work on an empty join.
-- No materialized/cache/GUC authority, relaxed equality, view or time change.
DO $employee_day_digest_initplan$
DECLARE target oid:='public.static_weekly_v5_read_employee_day_single_location_base(date,uuid,timestamptz)'::regprocedure;
 before_metadata jsonb;after_metadata jsonb;original_definition text;next_definition text;
 old_expression text:=$old_expression$p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(v_publication,v_week_start))$old_expression$;
 new_expression text:=$new_expression$p.exception_set_digest=(select public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(v_publication,v_week_start)))$new_expression$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v3_manager_actor(uuid)'::regprocedure)
    IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained installer and original reader owner required';END IF;
 original_definition:=pg_get_functiondef(target);
 IF public.static_weekly_digest_text(original_definition) IS DISTINCT FROM '25faf446ca1ec9ee0f295f0114617eafc565cfd9f19ff41a3a8bde845fa6da38'
  OR (SELECT public.static_weekly_digest_text(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '3f146d909d4584b7ab621d8753f0d6876f2044b46b67f7d31c918c326bc554f4'
  OR (length(original_definition)-length(replace(original_definition,old_expression,'')))/length(old_expression)<>1
 THEN RAISE EXCEPTION 'Exact original employee-day reader required; reconcile changed source before proceeding';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE p.oid=target;
 next_definition:=replace(original_definition,old_expression,new_expression);
 IF public.static_weekly_digest_text(next_definition) IS DISTINCT FROM '242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'
 THEN RAISE EXCEPTION 'Exact single InitPlan substitution differs';END IF;
 EXECUTE next_definition;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata
  OR public.static_weekly_digest_text(pg_get_functiondef(target)) IS DISTINCT FROM '242caba9fbe188e9bdc635a4b27475e81efa25d0fc523fa33457c701b694cb87'
 THEN RAISE EXCEPTION 'Employee-day reader identity/owner/ACL/attributes or exact successor differs';END IF;
END $employee_day_digest_initplan$;


-- COMPONENT lunch_admission_proof SHA256 c70332e65a459db5a53a74486a9a59dc4bf0892ffc11d6960239c3bb07ffcdad
-- PRIVATE post-admission optimization. Actual full admission mathematics remains
-- in the byte-preserved existing v8 materializer/validator. No new public RPC.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $installer$ BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid='public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)'::regprocedure)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR to_regnamespace('custodial_coverall') IS NULL THEN RAISE EXCEPTION 'Actual maintained lunch installer owner required';END IF;
END $installer$;
CREATE TABLE custodial_coverall.manual_lunch_admission_proofs(
 projection_id uuid NOT NULL REFERENCES public.weekly_schedule_compiled_projections(projection_id),
 document_identity text NOT NULL CHECK(document_identity~'^[a-f0-9]{64}$'),
 validator_fingerprint text NOT NULL CHECK(validator_fingerprint~'^[a-f0-9]{64}$'),
 projection_digest text NOT NULL CHECK(projection_digest~'^[a-f0-9]{64}$'),document_digest text NOT NULL CHECK(document_digest~'^[a-f0-9]{64}$'),
 full_projection_json jsonb NOT NULL,full_document_json jsonb NOT NULL,
 validated_at timestamptz NOT NULL DEFAULT clock_timestamp(),validated_by name NOT NULL DEFAULT current_user,
 validation_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
 PRIMARY KEY(projection_id,document_identity,validator_fingerprint),
 CHECK(full_projection_json->>'projection_id'=projection_id::text AND full_document_json->>'document_identity'=document_identity),
 CHECK(projection_digest=public.static_weekly_digest_jsonb(full_projection_json)),
 CHECK(document_digest=public.static_weekly_digest_jsonb(full_document_json))
);
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs OWNER TO CURRENT_USER;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custodial_coverall.manual_lunch_admission_proofs FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;
CREATE TRIGGER manual_lunch_admission_immutable BEFORE UPDATE OR DELETE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH ROW EXECUTE FUNCTION public.static_weekly_reject_update_delete();
CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation();
CREATE TRIGGER manual_lunch_proof_source_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON custodial_coverall.manual_lunch_admission_proofs
 FOR EACH STATEMENT EXECUTE FUNCTION public.static_weekly_v27_notification_plan_source_write_fence();
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER manual_lunch_proof_source_fence;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER manual_lunch_admission_immutable;
ALTER TABLE custodial_coverall.manual_lunch_admission_proofs ENABLE ALWAYS TRIGGER custodial_disaster_restore_mutation_fence;
DO $materializer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)'::regprocedure)) IS DISTINCT FROM 'b37945e14e5f804f4bbde542115bd017f8c7e64b909933658d8a23ec6979a9e9' THEN RAISE EXCEPTION 'Exact real materializer predecessor differs';END IF;END $materializer_predecessor$;
CREATE OR REPLACE FUNCTION custodial_coverall.original_v8_materialize_lunch_document(p_projection_id uuid, p_document jsonb, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare projection public.weekly_schedule_compiled_projections%rowtype;
 existing public.weekly_schedule_lunch_documents%rowtype;current_authority record;inserted integer;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection does not exist'; end if;
 select * into current_authority from public.static_weekly_v6_schedule_authority_state(projection.week_start);
 if current_authority.projection_status is distinct from 'current'
  or current_authority.projection_id is distinct from p_projection_id then raise exception 'lunch projection is not current'; end if;
 perform public.static_weekly_v8_assert_lunch_document(p_projection_id,p_document);
 insert into public.weekly_schedule_lunch_documents(projection_id,document_identity,document_json,accepted_by_manager_id)
 values(p_projection_id,p_document->>'document_identity',p_document,p_manager_id) on conflict(projection_id) do nothing;
 get diagnostics inserted=row_count;
 select * into strict existing from public.weekly_schedule_lunch_documents where projection_id=p_projection_id;
 if existing.document_json is distinct from p_document then raise exception 'immutable lunch publication conflicts with existing authority'; end if;
 return jsonb_build_object('ok',true,'persistence_status','PERSISTED','projection_id',p_projection_id,
  'document_identity',existing.document_identity,'replayed',inserted=0);
end $function$
;
CREATE FUNCTION custodial_coverall.lunch_validator_fingerprint()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fingerprint$
DECLARE signatures text[]:=ARRAY[
 'public.static_weekly_v8_assert_lunch_document(uuid,jsonb)',
 'public.static_weekly_manual_assert_native_lunch(uuid,jsonb,jsonb,uuid,date)',
 'public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date)',
 'public.static_weekly_manual_native_lunch_policy(jsonb)',
 'public.static_weekly_manual_identity_json(jsonb)',
 'public.static_weekly_assert_exact_object(jsonb,text[],text[],text)',
 'public.static_weekly_capacity_assert_lunch_party(uuid,jsonb,text)',
 'public.static_weekly_capacity_accepted_slot(uuid,date,uuid)',
 'public.static_weekly_capacity_registered(jsonb)',
 'public.static_weekly_digest_jsonb(jsonb)','public.static_weekly_digest_text(text)',
 'public.static_weekly_v3_assert_string_array(jsonb,text,boolean,integer)',
 'public.static_weekly_v3_assert_window(jsonb,text)','public.static_weekly_v3_assert_text(jsonb,text,integer)'];
 wrapper_signatures text[]:=ARRAY[
 'public.static_weekly_v8_materialize_lunch_document(uuid,jsonb,uuid)',
 'custodial_coverall.original_v8_materialize_lunch_document(uuid,jsonb,uuid)',
 'custodial_coverall.owner_revalidate_lunch_admission(uuid)',
 'custodial_coverall.require_lunch_admission_proof(uuid,jsonb)',
 'custodial_coverall.lunch_validator_fingerprint()',
 'public.static_weekly_reject_update_delete()','custodial_dr.guard_application_mutation()',
 'public.static_weekly_v27_notification_plan_source_write_fence()'];
 signature text;qualified_names text[];oid_value oid;definition text;definitions jsonb:='[]';wrappers jsonb:='[]';relations jsonb:='[]';
 relation text;crypto_schema text;crypto jsonb;metadata jsonb;
BEGIN
 SELECT array_agg(split_part(value,'(',1)) INTO qualified_names FROM unnest(signatures) value;
 FOREACH signature IN ARRAY signatures LOOP
  oid_value:=to_regprocedure(signature);IF oid_value IS NULL THEN RAISE EXCEPTION 'Complete full-lunch guard closure missing: %',signature USING ERRCODE='55000';END IF;
  definition:=pg_get_functiondef(oid_value);
  -- Changed definitions invalidate old proofs. New/unlisted nonbuilt-in guard
  -- callees or unsupported dynamic SQL refuse until this owning Source updates.
  IF EXISTS(SELECT 1 FROM regexp_matches(definition,'\m(public|custodial_coverall|extensions)\.([a-z_][a-z_0-9]*)[[:space:]]*\(','gi') m(parts)
   WHERE NOT(lower(m.parts[1]||'.'||m.parts[2])=ANY(qualified_names))) THEN
   RAISE EXCEPTION 'Unsupported changed full-lunch guard call closure: %',signature USING ERRCODE='55000';END IF;
  IF definition~*'\mexecute\M' AND signature<>'public.static_weekly_digest_text(text)' THEN RAISE EXCEPTION 'Unsupported dynamic full-lunch guard: %',signature USING ERRCODE='55000';END IF;
  IF signature='public.static_weekly_digest_text(text)' AND public.static_weekly_digest_text(definition)<>'5337ef6187e2febb0668f1350092fa49de3258317ae19537317a889900a0e1c3'
   THEN RAISE EXCEPTION 'Unsupported dynamic digest helper changed' USING ERRCODE='55000';END IF;
  SELECT jsonb_build_object('signature',signature,'oid',p.oid::text,'definition',definition,'owner',pg_get_userbyid(p.proowner),
   'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',to_jsonb(p.proconfig),'acl',p.proacl::text,'binary',p.probin,'source',p.prosrc) INTO metadata FROM pg_proc p WHERE p.oid=oid_value;
  definitions:=definitions||jsonb_build_array(metadata);
 END LOOP;
 FOREACH signature IN ARRAY wrapper_signatures LOOP
  oid_value:=to_regprocedure(signature);IF oid_value IS NULL THEN RAISE EXCEPTION 'Complete admission wrapper missing: %',signature USING ERRCODE='55000';END IF;
  SELECT jsonb_build_object('signature',signature,'oid',p.oid::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
   'securityDefiner',p.prosecdef,'config',to_jsonb(p.proconfig),'acl',p.proacl::text) INTO metadata FROM pg_proc p WHERE p.oid=oid_value;
  wrappers:=wrappers||jsonb_build_array(metadata);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['public.weekly_schedule_compiled_projections','public.weekly_schedule_lunch_documents','custodial_coverall.manual_lunch_admission_proofs'] LOOP
  oid_value:=to_regclass(relation);IF oid_value IS NULL THEN RAISE EXCEPTION 'Immutable admission relation missing';END IF;
  SELECT jsonb_build_object('relation',relation,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,
   'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid),x.convalidated) ORDER BY x.conname COLLATE "C") FROM pg_constraint x WHERE x.conrelid=c.oid),
   'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) INTO metadata FROM pg_class c WHERE c.oid=oid_value;
  relations:=relations||jsonb_build_array(metadata);
 END LOOP;
 SELECT n.nspname,jsonb_build_object('name',e.extname,'version',e.extversion,'namespace',n.nspname) INTO crypto_schema,crypto FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
 IF crypto_schema IS NULL OR crypto_schema NOT IN('extensions','public') THEN RAISE EXCEPTION 'Exact installed pgcrypto guard unavailable';END IF;
 oid_value:=to_regprocedure(format('%I.digest(bytea,text)',crypto_schema));IF oid_value IS NULL THEN RAISE EXCEPTION 'Actual SHA256 function unavailable';END IF;
 SELECT crypto||jsonb_build_object('oid',p.oid::text,'definition',pg_get_functiondef(p.oid),'source',p.prosrc,'binary',p.probin,'owner',pg_get_userbyid(p.proowner)) INTO crypto FROM pg_proc p WHERE p.oid=oid_value;
 RETURN public.static_weekly_digest_jsonb(jsonb_build_object('schema','custodial.full-lunch-validator-closure.v1','serverVersion',current_setting('server_version_num'),
  'guards',definitions,'admissionWrappers',wrappers,'immutableRelations',relations,'crypto',crypto));
END $fingerprint$;

CREATE FUNCTION custodial_coverall.require_lunch_admission_proof(p_projection uuid,p_document jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $require$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 proof custodial_coverall.manual_lunch_admission_proofs%rowtype;fingerprint text;
BEGIN
 IF p_projection IS NULL OR jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR coalesce(p_document->>'document_identity','')!~'^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'Exact immutable admitted lunch document required' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection;
 fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 SELECT * INTO proof FROM custodial_coverall.manual_lunch_admission_proofs WHERE projection_id=p_projection
  AND document_identity=document.document_identity AND validator_fingerprint=fingerprint;
 IF NOT FOUND OR document.document_identity IS DISTINCT FROM p_document->>'document_identity'
  OR document.document_json IS DISTINCT FROM p_document OR proof.full_document_json IS DISTINCT FROM p_document
  OR proof.full_projection_json IS DISTINCT FROM to_jsonb(projection)
  THEN RAISE EXCEPTION 'Full lunch admission proof missing, stale, or source bytes changed; owner revalidation required' USING ERRCODE='55000';END IF;
 -- Snapshot digests are CHECK-constrained at admission; exact full JSONB source
 -- equality above binds these admitted hashes without repeating all-loan math.
END $require$;

CREATE FUNCTION custodial_coverall.owner_revalidate_lunch_admission(p_projection uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $backfill$
DECLARE projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 proof custodial_coverall.manual_lunch_admission_proofs%rowtype;before_fingerprint text;after_fingerprint text;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR session_user NOT IN('postgres','supabase_admin')
  OR coalesce(current_setting('role',true),'none') NOT IN('none',session_user::text)
  THEN RAISE EXCEPTION 'Actual owning administrator must explicitly revalidate stored lunch' USING ERRCODE='42501';END IF;
 PERFORM public.custodial_begin_application_mutation();PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection FOR SHARE;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection FOR SHARE;
 before_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 -- Always REAL complete validation of the actual stored body, not caller data,
 -- a prepared label, GUC, cached boolean or success receipt. Historical rows stay.
 PERFORM public.static_weekly_v8_assert_lunch_document(p_projection,document.document_json);
 after_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 IF after_fingerprint IS DISTINCT FROM before_fingerprint THEN RAISE EXCEPTION 'Lunch validator changed during full revalidation';END IF;
 INSERT INTO custodial_coverall.manual_lunch_admission_proofs(projection_id,document_identity,validator_fingerprint,projection_digest,document_digest,full_projection_json,full_document_json)
 VALUES(p_projection,document.document_identity,after_fingerprint,public.static_weekly_digest_jsonb(to_jsonb(projection)),
  public.static_weekly_digest_jsonb(document.document_json),to_jsonb(projection),document.document_json) ON CONFLICT DO NOTHING;
 PERFORM custodial_coverall.require_lunch_admission_proof(p_projection,document.document_json);
 SELECT * INTO STRICT proof FROM custodial_coverall.manual_lunch_admission_proofs WHERE projection_id=p_projection AND document_identity=document.document_identity AND validator_fingerprint=after_fingerprint;
 RETURN jsonb_build_object('schema','custodial.full-lunch-admission-proof.v1','projectionId',proof.projection_id,'documentIdentity',proof.document_identity,
  'validatorFingerprint',proof.validator_fingerprint,'projectionDigest',proof.projection_digest,'documentDigest',proof.document_digest,
  'validatedAt',proof.validated_at,'validationTransactionId',proof.validation_transaction::text,'scope','FULL_STORED_VALIDATION_ONLY_NOT_CURRENT_AUTHORITY_OR_DEVICE_DELIVERY');
END $backfill$;

CREATE OR REPLACE FUNCTION public.static_weekly_v8_materialize_lunch_document(p_projection_id uuid,p_document jsonb,p_manager_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $admit$
DECLARE result jsonb;projection public.weekly_schedule_compiled_projections%rowtype;document public.weekly_schedule_lunch_documents%rowtype;
 before_fingerprint text;after_fingerprint text;
BEGIN
 before_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 -- The private original is an exact whole-body clone. It retains real actor,
 -- current projection, restore/authority lock, complete v8 validator and insert
 -- constraints. This wrapper does not replace admission with a prior proof.
 result:=custodial_coverall.original_v8_materialize_lunch_document(p_projection_id,p_document,p_manager_id);
 SELECT * INTO STRICT projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_projection_id;
 SELECT * INTO STRICT document FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_projection_id;
 after_fingerprint:=custodial_coverall.lunch_validator_fingerprint();
 IF before_fingerprint IS DISTINCT FROM after_fingerprint OR document.document_json IS DISTINCT FROM p_document
  OR document.document_identity IS DISTINCT FROM p_document->>'document_identity'
  OR result->>'projection_id' IS DISTINCT FROM p_projection_id::text OR result->>'document_identity' IS DISTINCT FROM document.document_identity
  THEN RAISE EXCEPTION 'Actual same-transaction full lunch admission/store correspondence changed';END IF;
 INSERT INTO custodial_coverall.manual_lunch_admission_proofs(projection_id,document_identity,validator_fingerprint,projection_digest,document_digest,full_projection_json,full_document_json)
 VALUES(p_projection_id,document.document_identity,after_fingerprint,public.static_weekly_digest_jsonb(to_jsonb(projection)),
  public.static_weekly_digest_jsonb(document.document_json),to_jsonb(projection),document.document_json) ON CONFLICT DO NOTHING;
 PERFORM custodial_coverall.require_lunch_admission_proof(p_projection_id,p_document);
 RETURN result; -- Original receipt bytes/state/leases/delivery claims unchanged.
END $admit$;

DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_manual_lunch_current_basis(uuid,text,text,date)'::regprocedure)) IS DISTINCT FROM 'cc2c41c4270f002296fe710d3fc1f87cf18752303b8e9772c28c53e71aba9a7d' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: static_weekly_manual_lunch_current_basis';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_manual_lunch_current_basis(p_source uuid, p_source_document text, p_notification_key text, p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 authority record;origin public.weekly_schedule_compiled_projections%rowtype;
 current_projection public.weekly_schedule_compiled_projections%rowtype;
 prior_projection public.weekly_schedule_compiled_projections%rowtype;
 original_doc public.weekly_schedule_lunch_documents%rowtype;
 current_doc public.weekly_schedule_lunch_documents%rowtype;
 prior_doc public.weekly_schedule_lunch_documents%rowtype;
 original_intent jsonb;intent jsonb;original_loan jsonb;loan jsonb;retention jsonb;
 expected jsonb;actual jsonb;matches integer;visited uuid[]:='{}';hop integer:=0;
 current_id uuid;current_identity text;
BEGIN
 IF p_source IS NULL OR p_service_date IS NULL OR NOT isfinite(p_service_date)
  OR coalesce(p_source_document,'') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_notification_key,'') !~ '^[0-9a-f]{64}$' THEN RETURN NULL;END IF;
 SELECT * INTO authority FROM public.static_weekly_v6_schedule_authority_state(p_service_date);
 IF authority.governed IS NOT TRUE OR authority.projection_status IS DISTINCT FROM 'current'
  OR authority.projection_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.weekly_schedule_compiled_projections WHERE projection_id=p_source;
 SELECT * INTO original_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=p_source;
 SELECT * INTO current_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=authority.projection_id;
 SELECT * INTO current_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=authority.projection_id;
 IF origin.projection_id IS NULL OR original_doc.projection_id IS NULL
  OR current_projection.projection_id IS NULL OR current_doc.projection_id IS NULL
  OR original_doc.document_identity IS DISTINCT FROM p_source_document
  OR origin.publication_id IS DISTINCT FROM authority.publication_id
  OR origin.version_id IS DISTINCT FROM authority.version_id
  OR origin.week_start IS DISTINCT FROM current_projection.week_start
  OR origin.week_end IS DISTINCT FROM current_projection.week_end
  OR p_service_date NOT BETWEEN origin.week_start AND origin.week_end THEN RETURN NULL;END IF;
 PERFORM custodial_coverall.require_lunch_admission_proof(origin.projection_id,original_doc.document_json);
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT n INTO original_intent FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n
  WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
 SELECT count(*) INTO matches FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 IF matches<>1 THEN RETURN NULL;END IF;
 SELECT l INTO original_loan FROM jsonb_array_elements(original_doc.document_json->'loans') l
  WHERE l->>'loan_id'=original_intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
 current_id:=current_projection.projection_id;current_identity:=current_doc.document_identity;
 LOOP
  -- Fail closed after 128 immutable links or a cycle; never repair/reset a job.
  hop:=hop+1;
  IF hop>128 OR current_projection.projection_id=ANY(visited)
   OR current_projection.publication_id IS DISTINCT FROM origin.publication_id
   OR current_projection.version_id IS DISTINCT FROM origin.version_id
   OR current_projection.week_start IS DISTINCT FROM origin.week_start
   OR current_projection.week_end IS DISTINCT FROM origin.week_end
   OR current_doc.projection_id IS DISTINCT FROM current_projection.projection_id
   OR current_doc.document_identity IS DISTINCT FROM current_doc.document_json->>'document_identity'
   THEN RETURN NULL;END IF;
  visited:=array_append(visited,current_projection.projection_id);
  PERFORM custodial_coverall.require_lunch_admission_proof(current_projection.projection_id,current_doc.document_json);
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT n INTO intent FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n
   WHERE n->>'notification_key'=p_notification_key AND n->>'service_date'=p_service_date::text;
  IF intent IS DISTINCT FROM original_intent THEN RETURN NULL;END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF matches<>1 THEN RETURN NULL;END IF;
  SELECT l INTO loan FROM jsonb_array_elements(current_doc.document_json->'loans') l
   WHERE l->>'loan_id'=intent->>'loan_id' AND l->>'service_date'=p_service_date::text AND l->>'status'='PLANNED';
  IF loan-'total_distance_minutes' IS DISTINCT FROM original_loan-'total_distance_minutes' THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'responsibilities') r WHERE r->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(r-'proximity_evidence' ORDER BY (r-'proximity_evidence')::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'responsibilities') r WHERE r->'loan_id'=loan->'loan_id';
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO expected
   FROM jsonb_array_elements(original_doc.document_json->'notification_intents') n WHERE n->'loan_id'=original_loan->'loan_id';
  SELECT coalesce(jsonb_agg(n ORDER BY n::text),'[]') INTO actual
   FROM jsonb_array_elements(current_doc.document_json->'notification_intents') n WHERE n->'loan_id'=loan->'loan_id';
  IF actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  -- Original spoken owner/principal and original shift-end validity remain exact.
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO expected
   FROM jsonb_array_elements(origin.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=original_loan->>'normal_owner_slot_id' OR original_loan->'helper_slot_ids' ? (a->>'slotId'));
  SELECT coalesce(jsonb_agg(a-ARRAY['incumbentSlotId','incumbentSlotLabel'] ORDER BY (a-ARRAY['incumbentSlotId','incumbentSlotLabel'])::text),'[]') INTO actual
   FROM jsonb_array_elements(current_projection.projection_envelope#>'{authority,projectionAvailability}') a
   WHERE a->>'serviceDate'=p_service_date::text
    AND (a->>'slotId'=loan->>'normal_owner_slot_id' OR loan->'helper_slot_ids' ? (a->>'slotId'));
  IF expected='[]'::jsonb OR actual IS DISTINCT FROM expected THEN RETURN NULL;END IF;
  IF current_projection.projection_id=p_source THEN
   IF current_doc.document_identity IS DISTINCT FROM p_source_document THEN RETURN NULL;END IF;
   RETURN jsonb_build_object('source_projection_id',p_source,'source_document_identity',p_source_document,
    'current_projection_id',current_id,'current_document_identity',current_identity,'notification_key',p_notification_key);
  END IF;
  IF current_projection.projection_envelope#>>'{authority,schema}' IS DISTINCT FROM 'custodial.approved-manual-period-projection-authority.v1'
   OR current_projection.projection_envelope->'adapter' IS DISTINCT FROM
    '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
   THEN RETURN NULL;END IF;
  retention:=current_projection.projection_envelope#>'{authority,lunchIdentityRetention}';
  IF retention IS NULL THEN RETURN NULL;END IF;
  PERFORM public.static_weekly_assert_exact_object(retention,
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],
   ARRAY['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'notification immutable lunch lineage');
  IF retention->>'schema' IS DISTINCT FROM 'custodial.approved-manual-lunch-identity-retention.v1'
   OR retention->'requiresSqlOwnerCurrentnessCheck' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(retention->'loans') IS DISTINCT FROM 'array'
   OR coalesce(retention->>'priorDocumentIdentity','') !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM jsonb_array_elements(retention->'loans') r
    WHERE r=jsonb_build_object('serviceDate',p_service_date::text,'normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id'))<>1
   THEN RETURN NULL;END IF;
  SELECT * INTO prior_projection FROM public.weekly_schedule_compiled_projections WHERE projection_id=(retention->>'priorProjectionId')::uuid;
  SELECT * INTO prior_doc FROM public.weekly_schedule_lunch_documents WHERE projection_id=prior_projection.projection_id;
  IF prior_projection.projection_id IS NULL OR prior_doc.projection_id IS NULL
   OR prior_doc.document_identity IS DISTINCT FROM retention->>'priorDocumentIdentity' THEN RETURN NULL;END IF;
  current_projection:=prior_projection;current_doc:=prior_doc;
 END LOOP;
EXCEPTION WHEN data_exception OR check_violation OR cardinality_violation THEN RETURN NULL;
END $function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.mz_enqueue_employee_lunch_coverage_pushes(timestamptz)'::regprocedure)) IS DISTINCT FROM 'ffcbc000d66492d0d3ddf886b68803b1236630d6cd24051be3030756f6b2f694' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: mz_enqueue_employee_lunch_coverage_pushes';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_lunch_coverage_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_service_date date := public.sch_service_date(p_now);
  v_authority record;
  v_document jsonb;
  v_inserted integer := 0;
  v_missing integer := 0;
  v_alerts integer := 0;
  v_job_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  perform pg_advisory_xact_lock(hashtext('custodial-lunch-notifications'),hashtext(v_service_date::text));
  select * into strict v_authority
  from public.static_weekly_v6_schedule_authority_state(v_service_date);
  if not v_authority.governed or v_authority.projection_status is distinct from 'current' then
    return jsonb_build_object('ok',true,'enqueued',0,'missing_recipients',0,'manager_alerts',0,
      'skipped','no_current_governed_schedule','service_date',v_service_date);
  end if;

  select document_json into v_document
  from public.weekly_schedule_lunch_documents
  where projection_id=v_authority.projection_id;
  if v_document is null then
    raise exception using errcode='55000',message='current lunch coverage is unavailable; republish the weekly schedule';
  end if;

  -- Validate the exact current persisted document; never materialize a prepared draft.
  perform custodial_coverall.require_lunch_admission_proof(v_authority.projection_id,v_document);

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
      and n->>'event' in ('start','end')
      and n->>'delivery_state'='NOT_ENQUEUED'
  ), targets as materialized (
    select registration.credential_id,registration.employee_id,registration.device_id,
      registration.assignment_epoch,device.device_id device_identifier
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), recipient_counts as materialized (
    select intent.employee_id,count(distinct target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    group by intent.employee_id
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':'||target.credential_id::text,
    'employee_native_push',v_authority.projection_id,intent.scheduled_at,
    jsonb_build_object(
      'credential_id',target.credential_id,'employee_id',target.employee_id,
      'device_id',target.device_id,'device_identifier',target.device_identifier,
      'assignment_epoch',target.assignment_epoch,
      'channel_id','employee-events',
      'title',case intent.n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',case intent.n->>'event'
        when 'start' then 'Your temporary lunch coverage has started. Open My Schedule for borrowed areas.'
        else 'Your temporary lunch coverage has ended. Your normal assignments remain unchanged.' end,
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time',
        'scheduled_at',to_char(intent.scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,
        'document_identity',v_document->>'document_identity',
        'route','employee-schedule.html?hub=employee'
      )
    )
  from intents intent
  join recipient_counts count_row on count_row.employee_id=intent.employee_id and count_row.recipient_count=1
  join targets target on target.employee_id=intent.employee_id
  on conflict(job_key) do nothing;
  get diagnostics v_inserted=row_count;

  with intents as materialized (
    select n,(mapped.coverer_person_id)::uuid employee_id,
      ((n->>'service_date')::date+(n->>'scheduled_time')::time) at time zone 'America/Chicago' scheduled_at
    from jsonb_array_elements(v_document->'notification_intents') n
    join lateral (
      select distinct r.value->>'coverer_person_id' coverer_person_id
      from jsonb_array_elements(v_document->'responsibilities') r(value)
      where r.value->>'loan_id'=n->>'loan_id'
        and r.value->>'coverer_slot_id'=n->>'coverer_slot_id'
    ) mapped on true
    where n->>'service_date'=v_service_date::text
  ), targets as materialized (
    select registration.credential_id,registration.employee_id
    from public.employee_push_registrations registration
    join public.devices device
      on device.id=registration.device_id
     and device.assigned_employee_id=registration.employee_id
     and device.assignment_epoch=registration.assignment_epoch
     and device.active=true
    join public.employees employee on employee.id=registration.employee_id and employee.active=true
    join public.device_auth_credentials credential
      on credential.credential_id=registration.credential_id
     and credential.device_id=device.id
     and credential.confirmed_at is not null
     and credential.revoked_at is null
     and credential.expires_at>p_now
    where registration.active=true and registration.revoked_at is null
  ), unavailable as materialized (
    select intent.*,count(target.credential_id) recipient_count
    from intents intent left join targets target on target.employee_id=intent.employee_id
    where intent.scheduled_at<=p_now
    group by intent.n,intent.employee_id,intent.scheduled_at
    having count(target.credential_id)<>1
  )
  insert into public.operational_notification_jobs(
    job_key,job_type,source_id,status,completed_at,last_error,available_at,payload_json
  )
  select 'employee-lunch-push:'||(intent.n->>'notification_key')||':recipient-unavailable',
    'employee_native_push',v_authority.projection_id,'dead',p_now,
    case when intent.recipient_count=0 then 'lunch_coverage_recipient_unavailable'
         else 'lunch_coverage_recipient_ambiguous' end,
    intent.scheduled_at,
    jsonb_build_object(
      'employee_id',intent.employee_id,'device_identifier','assigned custodial phone',
      'data_json',jsonb_build_object(
        'kind','employee_lunch_coverage','notification_type','lunch_coverage',
        'notification_key',intent.n->>'notification_key','event',intent.n->>'event',
        'service_date',intent.n->>'service_date','loan_id',intent.n->>'loan_id',
        'scheduled_time',intent.n->>'scheduled_time','coverer_slot_id',intent.n->>'coverer_slot_id',
        'projection_id',v_authority.projection_id::text,'document_identity',v_document->>'document_identity',
        'recipient_status',case when intent.recipient_count=0 then 'unavailable' else 'ambiguous' end,
        'route','employee-schedule.html?hub=employee'
      )
    )
  from unavailable intent
  on conflict(job_key) do nothing;
  get diagnostics v_missing=row_count;
  for v_job_id in
    select job_id from public.operational_notification_jobs
    where job_type='employee_native_push'
      and source_id=v_authority.projection_id
      and status='dead'
      and payload_json->'data_json'->>'kind'='employee_lunch_coverage'
      and payload_json->'data_json'->>'service_date'=v_service_date::text
      and payload_json->'data_json'->>'recipient_status' in ('unavailable','ambiguous')
      and available_at<=p_now
  loop
    v_alerts:=v_alerts+coalesce((public.ops_manager_enqueue_lunch_delivery_failure(v_job_id,p_now)->>'enqueued')::integer,0);
  end loop;

  return jsonb_build_object('ok',true,'service_date',v_service_date,
    'projection_id',v_authority.projection_id,'document_identity',v_document->>'document_identity',
    'enqueued',v_inserted,'missing_recipients',v_missing,'manager_alerts',v_alerts);
end
$function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_native_target_source_at(text,uuid,uuid,uuid,timestamptz)'::regprocedure)) IS DISTINCT FROM '37f92acda48420c6c6a99142e9ef110b505d714a7a0ae4162ecdb17eafe9f61b' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: custodial_native_target_source_at';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.custodial_native_target_source_at(p_kind text, p_source_key uuid, p_employee_id uuid, p_generation_id uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
 v_now timestamptz:=p_at;
 v_generation public.employee_native_push_generations%rowtype;
 v_registration public.employee_push_registrations%rowtype;
 v_device public.devices%rowtype;
 v_credential public.device_auth_credentials%rowtype;
 v_employee public.employees%rowtype;
 v_job public.operational_notification_jobs%rowtype;
 v_message record;
 v_occurrence public.weekly_schedule_occurrences%rowtype;
 v_authority record;
 v_document public.weekly_schedule_lunch_documents%rowtype;
 v_intent jsonb;
 v_loan jsonb;
 v_responsibility jsonb;
 v_availability jsonb;
 v_service_date date;
 v_scheduled_at timestamptz;
 v_valid_until timestamptz;
 v_source jsonb;
 v_recipient jsonb;
 v_status text;
begin
 if p_kind is null or p_kind not in ('MESSAGE','SCHEDULE','LUNCH') or p_source_key is null
  or p_employee_id is null or p_generation_id is null or p_at is null or not isfinite(p_at) then
  raise exception using errcode='22023',message='exact native source kind, original key, employee and generation required';
 end if;
 select * into v_generation from public.employee_native_push_generations
  where generation_id=p_generation_id;
 if not found then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 select * into v_registration from public.employee_push_registrations
  where registration_id=v_generation.registration_id;
 select * into v_device from public.devices where id=v_generation.device_id;
 select * into v_credential from public.device_auth_credentials
  where credential_id=v_generation.credential_id;
 select * into v_employee from public.employees where id=p_employee_id;
 if v_generation.employee_id is distinct from p_employee_id
  or v_generation.dispatch_retired_at is not null or v_generation.revoked_at is not null
  or v_generation.activated_at>v_now or v_registration.registration_id is null
  or v_registration.active is not true or v_registration.revoked_at is not null
  or v_registration.device_id is distinct from v_generation.device_id
  or v_registration.credential_id is distinct from v_generation.credential_id
  or v_registration.employee_id is distinct from p_employee_id
  or v_registration.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_registration.token_hash is distinct from v_generation.token_digest
  or v_device.id is null or v_device.active is not true
  or v_device.device_id is distinct from v_generation.device_identifier
  or v_device.assigned_employee_id is distinct from p_employee_id
  or v_device.assignment_epoch is distinct from v_generation.assignment_epoch
  or v_credential.credential_id is null or v_credential.device_id is distinct from v_device.id
  or v_credential.confirmed_at is null or v_credential.revoked_at is not null
  or v_credential.expires_at<=v_now or v_employee.id is null or v_employee.active is not true then
  return jsonb_build_object('schema','custodial.native-target-source.v1','kind',p_kind,
   'source_key',p_source_key,'status','TARGET_STALE','delivery_admitted',false);
 end if;
 v_recipient:=jsonb_build_object('employee_id',p_employee_id,'device_id',v_device.id,
  'device_identifier',v_device.device_id,'credential_id',v_credential.credential_id,
  'assignment_epoch',v_device.assignment_epoch,'generation_id',v_generation.generation_id,
  'principal_digest',v_generation.principal_digest,'token_digest',v_generation.token_digest);

 if p_kind='MESSAGE' then
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.job_key is distinct from 'employee-message-push:'||v_job.source_id::text||':'||v_credential.credential_id::text
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_message'
   or v_job.payload_json#>>'{data_json,message_id}' is distinct from v_job.source_id::text
   or v_job.payload_json#>>'{data_json,notification_key}' is distinct from 'message:'||v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   select m.id,m.thread_id,m.sender_user_id,m.sent_at,m.body,m.metadata_json,
    recipient.id recipient_user_id,r.acknowledged_at
    into v_message
   from public.msg_messages m
   join public.msg_threads t on t.id=m.thread_id and t.is_active is true
    and t.system_key is distinct from 'ops_manager_shared_chat_v1'
   join public.msg_thread_participants tp on tp.thread_id=m.thread_id and tp.left_at is null
   join public.msg_users recipient on recipient.id=tp.user_id and recipient.is_active is true
    and recipient.employee_id=p_employee_id
   join public.msg_receipts r on r.message_id=m.id and r.user_id=recipient.id
   where m.id=v_job.source_id and m.is_deleted is false and m.sender_user_id<>recipient.id
    and m.sent_at<=v_now
    and r.acknowledged_at is null
    and not exists(select 1 from public.msg_message_deletions md
      where md.message_id=m.id and md.user_id=recipient.id)
    and not exists(select 1 from public.msg_thread_visibility visibility
      where visibility.thread_id=m.thread_id and visibility.user_id=recipient.id
       and (visibility.device_identifier is null
         or upper(btrim(visibility.device_identifier))=upper(btrim(v_device.device_id)))
       and coalesce(m.sent_at,m.created_at)<=visibility.hidden_before);
   if not found or v_job.payload_json#>>'{data_json,thread_id}' is distinct from v_message.thread_id::text then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_recipient:=v_recipient||jsonb_build_object('msg_user_id',v_message.recipient_user_id);
    v_source:=jsonb_build_object('source_id',v_message.id,'source_revision',
     public.static_weekly_digest_jsonb(jsonb_build_object('message_id',v_message.id,
      'thread_id',v_message.thread_id,'sender_user_id',v_message.sender_user_id,
      'sent_at',v_message.sent_at,'body',v_message.body,'metadata_json',v_message.metadata_json,
      'recipient_user_id',v_message.recipient_user_id)),
     'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
     'job_status',v_job.status,'valid_from',v_message.sent_at,'valid_until',null);
   end if;
  end if;
 elsif p_kind='SCHEDULE' then
  select * into v_occurrence from public.weekly_schedule_occurrences
   where occurrence_id=p_source_key;
  if not found or v_occurrence.state is distinct from 'created' then
   v_status:='SOURCE_STALE';
  else
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_occurrence.service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or v_authority.projection_id is distinct from v_occurrence.projection_id
    or v_authority.publication_id is distinct from v_occurrence.publication_id
    or v_authority.version_id is distinct from v_occurrence.version_id
    or (v_occurrence.owner_person_id_snapshot is distinct from p_employee_id
     and not exists(select 1 from public.static_weekly_v8_read_lunch_segments(v_occurrence.service_date) l
      where l.projection_id=v_authority.projection_id
       and l.normal_occurrence_id=v_occurrence.occurrence_id
       and l.normal_owner_id=v_occurrence.owner_person_id_snapshot
       and l.coverer_id=p_employee_id
       and l.coverage_start<=time '09:45' and l.coverage_end>=time '09:45'
       and l.coverage_start<l.coverage_end)) then
    v_status:='SOURCE_STALE';
   else
    v_status:='SOURCE_ONLY_POLICY_MISSING';
    v_source:=jsonb_build_object('source_id',v_occurrence.projection_id,
     'source_revision',v_authority.projection_authority_revision::text,
     'source_digest',v_occurrence.occurrence_digest,
     'publication_id',v_occurrence.publication_id,'version_id',v_occurrence.version_id,
     'service_date',v_occurrence.service_date,'assignment_occurrence_id',v_occurrence.occurrence_id,
     'delivery_occurrence_id',null,'delivery_key',null,
     'valid_from',null,'valid_until',null);
   end if;
  end if;
 else
  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;
  if not found or v_job.job_type is distinct from 'employee_native_push'
   or v_job.status not in ('pending','leased')
   or v_job.payload_json->>'credential_id' is distinct from v_credential.credential_id::text
   or v_job.payload_json->>'employee_id' is distinct from p_employee_id::text
   or v_job.payload_json->>'device_id' is distinct from v_device.id::text
   or v_job.payload_json->>'device_identifier' is distinct from v_device.device_id
   or v_job.payload_json->>'assignment_epoch' is distinct from v_device.assignment_epoch::text
   or v_job.payload_json#>>'{data_json,kind}' is distinct from 'employee_lunch_coverage'
   or v_job.payload_json#>>'{data_json,projection_id}' is distinct from v_job.source_id::text then
   v_status:='SOURCE_STALE';
  else
   v_service_date:=(v_job.payload_json#>>'{data_json,service_date}')::date;
   select * into v_authority from public.static_weekly_v6_schedule_authority_state(v_service_date);
   if v_authority.governed is not true or v_authority.projection_status is distinct from 'current'
    or public.static_weekly_manual_lunch_current_basis(v_job.source_id,
     v_job.payload_json#>>'{data_json,document_identity}',v_job.payload_json#>>'{data_json,notification_key}',v_service_date) is null then
    v_status:='SOURCE_STALE';
   else
    select * into v_document from public.weekly_schedule_lunch_documents
     where projection_id=v_job.source_id;
    if not found or v_document.document_identity is distinct from v_job.payload_json#>>'{data_json,document_identity}' then
     v_status:='SOURCE_STALE';
    else
     perform custodial_coverall.require_lunch_admission_proof(v_document.projection_id,v_document.document_json);
     select value into v_intent from jsonb_array_elements(v_document.document_json->'notification_intents')
      where value->>'notification_key'=v_job.payload_json#>>'{data_json,notification_key}'
       and value->>'service_date'=v_service_date::text;
     select value into v_loan from jsonb_array_elements(v_document.document_json->'loans')
      where value->>'loan_id'=v_intent->>'loan_id' and value->>'status'='PLANNED';
     select value into v_responsibility from jsonb_array_elements(v_document.document_json->'responsibilities')
      where value->>'loan_id'=v_intent->>'loan_id'
       and value->>'coverer_slot_id'=v_intent->>'coverer_slot_id'
       and value->>'coverer_person_id'=p_employee_id::text;
     select value into v_availability
      from public.weekly_schedule_compiled_projections projection,
       jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
      where projection.projection_id=v_authority.projection_id
       and value->>'serviceDate'=v_service_date::text
       and value->>'slotId'=v_intent->>'coverer_slot_id'
       and value->>'incumbentPersonId'=p_employee_id::text
       and value->>'status'='working';
     if v_intent is null or v_loan is null or v_responsibility is null or v_availability is null
      or v_job.job_key is distinct from 'employee-lunch-push:'||(v_intent->>'notification_key')||':'||v_credential.credential_id::text
      or v_job.payload_json#>>'{data_json,event}' is distinct from v_intent->>'event'
      or v_job.payload_json#>>'{data_json,loan_id}' is distinct from v_intent->>'loan_id'
      or v_job.payload_json#>>'{data_json,coverer_slot_id}' is distinct from v_intent->>'coverer_slot_id'
      or v_job.payload_json#>>'{data_json,scheduled_time}' is distinct from v_intent->>'scheduled_time'
      or v_job.payload_json#>>'{data_json,notification_key}' is distinct from v_intent->>'notification_key'
      or v_job.payload_json#>>'{data_json,service_date}' is distinct from v_intent->>'service_date'
      or v_intent->>'event' not in ('start','end') then
      v_status:='SOURCE_STALE';
     else
      v_scheduled_at:=(v_service_date+(v_intent->>'scheduled_time')::time) at time zone 'America/Chicago';
      v_valid_until:=(v_service_date+(case when v_intent->>'event'='start'
       then v_loan->>'coverage_end' else v_availability#>>'{shift,end}' end)::time)
       at time zone 'America/Chicago';
      if v_valid_until is null or v_valid_until<=v_scheduled_at or v_now>=v_valid_until
       or public.sch_service_date(v_now) is distinct from v_service_date then
       v_status:='SOURCE_EXPIRED';
      else
       v_status:='CURRENT_SOURCE_ONLY';
       v_source:=jsonb_build_object('source_id',v_document.projection_id,
        'source_revision',v_authority.projection_authority_revision::text,
        'source_digest',v_document.document_identity,
        'notification_key',v_intent->>'notification_key',
        'loan_id',v_intent->>'loan_id','event',v_intent->>'event',
        'coverer_slot_id',v_intent->>'coverer_slot_id',
        'service_date',v_service_date,
        'delivery_occurrence_id',v_job.job_id,'delivery_key',v_job.job_key,
        'job_status',v_job.status,'valid_from',v_scheduled_at,'valid_until',v_valid_until);
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('schema','custodial.native-target-source.v1',
  'kind',p_kind,'source_key',p_source_key,'status',v_status,
  'delivery_admitted',false,'recipient',case when v_source is null then null else v_recipient end,
  'source',v_source);
end $function$
;
DO $consumer_predecessor$ BEGIN IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v27_notification_plan_at(date,uuid,uuid,uuid,bigint,uuid,text,timestamptz)'::regprocedure)) IS DISTINCT FROM '59ae64a1a55284bd5348e2ec7fb6cb607f39123d30cba7969ef9f75d17b2fcf1' THEN RAISE EXCEPTION 'Exact post-delivery notification consumer differs: static_weekly_v27_notification_plan_at';END IF;END $consumer_predecessor$;
CREATE OR REPLACE FUNCTION public.static_weekly_v27_notification_plan_at(p_date date, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_intent uuid, p_target_digest text, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 at_time timestamptz:=p_at; delivery jsonb; target jsonb; a record;
 doc public.weekly_schedule_lunch_documents%rowtype; projection public.weekly_schedule_compiled_projections%rowtype;
 device public.devices%rowtype; person public.employees%rowtype; roster public.daily_work_roster%rowtype;
 n jsonb; loan jsonb; mapped jsonb; availability jsonb; candidate record; item jsonb;
 all_intents jsonb:='[]'; effects jsonb:='[]'; audio jsonb:='[]';
 expected jsonb; body jsonb; wire text; notification_state jsonb;
 scheduled timestamptz; ends_at timestamptz; expires timestamptz; boundary timestamptz;
 matches integer; total_intents integer:=0; total_locations integer:=0;
 role_name text; override_enabled boolean; silent boolean; reason text; kind text;
begin
 if at_time is null or not isfinite(at_time) or p_date is null or p_date is distinct from public.sch_service_date(at_time)
  or p_intent is null or coalesce(p_target_digest,'')!~'^[a-f0-9]{64}$'
  or p_epoch is null or p_epoch<1 or p_epoch>9007199254740991 then
  raise exception 'exact current recurring notification plan principal required' using errcode='22023';end if;
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 select * into strict device from public.devices where id=p_device;
 select * into strict person from public.employees where id=p_employee and active=true;
 if not exists(select 1 from public.device_auth_credentials c where c.credential_id=p_credential and c.device_id=p_device
  and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>at_time) then
  raise exception 'current notification plan credential expired' using errcode='42501';end if;
 delivery:=public.static_weekly_v22_read_recurring_application_target(p_date,p_device,p_credential,p_employee,p_epoch);
 target:=delivery->'target';
 if delivery->>'intentId' is distinct from p_intent::text or delivery->>'targetDigest' is distinct from p_target_digest
  or target->>'serviceDate' is distinct from p_date::text then
  raise exception 'recurring notification plan target superseded' using errcode='40001';end if;
 expires:=((p_date+1)::timestamp+make_interval(hours=>public.get_setting_int('operational_day_start_hour',4))) at time zone 'America/Chicago';
 select * into strict a from public.static_weekly_v6_schedule_authority_state(p_date);
 if target->>'targetType'='BLOCKED_RECURRING_AUTHORITY' then
  if a.projection_status is distinct from 'blocked_recurring_authority' then
   raise exception 'terminal notification plan authority differs' using errcode='40001';end if;
  kind:='AUTHENTICATED_BLOCKED_TARGET';
 elsif target->>'targetType'='SCHEDULE' then
  if a.projection_status is distinct from 'current' or a.projection_id::text is distinct from target->>'projectionId'
   or a.publication_id::text is distinct from target->>'publicationId'
   or a.projection_authority_revision::text is distinct from target->>'authorityRevision' then
   raise exception 'notification plan accepted authority differs' using errcode='40001';end if;
  select * into strict doc from public.weekly_schedule_lunch_documents where projection_id=a.projection_id;
  select * into strict projection from public.weekly_schedule_compiled_projections where projection_id=a.projection_id;
  if doc.document_identity is distinct from target->>'lunchDocumentIdentity' then
   raise exception 'notification plan lunch companion differs' using errcode='23514';end if;
  if jsonb_array_length(doc.document_json->'notification_intents')>16384
   or jsonb_array_length(doc.document_json->'responsibilities')>16384 then
   raise exception 'complete notification plan source bound exceeded' using errcode='54000';end if;
  perform custodial_coverall.require_lunch_admission_proof(doc.projection_id,doc.document_json);
  -- Exactly the normal device notification shift/override policy. A mapping
  -- role is observed from the same active normal device-user source, not from
  -- caller metadata or an inferred employee label.
  select lower(coalesce(mu.role,'')) into role_name from public.msg_device_assignments mda
   join public.msg_users mu on mu.id=mda.msg_user_id
   where mda.device_identifier=device.device_id and mda.is_active=true and mu.is_active=true
   order by mda.updated_at desc nulls last,mda.created_at desc nulls last limit 1;
  select * into roster from public.daily_work_roster r where r.service_date=p_date and r.employee_id=p_employee and r.active=true
   order by r.updated_at desc nulls last,r.created_at desc nulls last limit 1;
  select coalesce(setting_value='true'::jsonb,false) into override_enabled from public.system_settings
   where setting_key='off_shift_employee_notifications_override_enabled';
  override_enabled:=coalesce(override_enabled,false);
  if coalesce(role_name,'') in ('manager','bot','ops','ops_manager','operations_manager') then silent:=false;reason:='not_employee_device';
  elsif override_enabled then silent:=false;reason:='admin_overtime_override_enabled';
  elsif roster.id is null then silent:=true;reason:='no_active_roster_shift';
  elsif roster.shift_start is null or roster.shift_end is null then silent:=true;reason:='invalid_roster_shift_window';
  elsif (at_time at time zone 'America/Chicago') < p_date+roster.shift_start then silent:=true;reason:='scheduled_shift_not_started';
  elsif (at_time at time zone 'America/Chicago') >= p_date+roster.shift_end then silent:=true;reason:='scheduled_shift_ended';
  else silent:=false;reason:='on_shift';end if;
  notification_state:=jsonb_build_object('notifications_silent',silent,'silent_reason',reason,'override_enabled',override_enabled);
  foreach boundary in array array[(p_date+roster.shift_start) at time zone 'America/Chicago',(p_date+roster.shift_end) at time zone 'America/Chicago'] loop
   if boundary>at_time then expires:=least(expires,boundary);end if;
  end loop;
  -- Validate the whole accepted document before selecting this recipient. No
  -- truncated page or pre-existing job list can hide a required accepted intent.
  for n in select ni.value from jsonb_array_elements(doc.document_json->'notification_intents') ni(value)
   where ni.value->>'service_date'=p_date::text and exists(
    select 1 from jsonb_array_elements(doc.document_json->'responsibilities') rr(value)
     where rr.value->>'loan_id'=ni.value->>'loan_id' and rr.value->>'coverer_slot_id'=ni.value->>'coverer_slot_id'
      and rr.value->>'coverer_person_id'=p_employee::text)
   order by ni.value->>'scheduled_time',ni.value->>'notification_key' loop
   total_intents:=total_intents+1;if total_intents>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   select value into strict loan from jsonb_array_elements(doc.document_json->'loans') value
    where value->>'loan_id'=n->>'loan_id' and value->>'status'='PLANNED';
   select count(*) into matches from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   if matches<>1 then raise exception 'notification plan recipient availability ambiguous' using errcode='23514';end if;
   select value into strict availability from jsonb_array_elements(projection.projection_envelope#>'{authority,projectionAvailability}') value
    where value->>'serviceDate'=p_date::text and value->>'slotId'=n->>'coverer_slot_id'
     and value->>'incumbentPersonId'=p_employee::text and value->>'status'='working';
   scheduled:=(p_date+(n->>'scheduled_time')::time) at time zone 'America/Chicago';
   ends_at:=(p_date+(case when n->>'event'='start' then loan->>'coverage_end' else availability#>>'{shift,end}' end)::time) at time zone 'America/Chicago';
   if ends_at is null or ends_at<=scheduled or n->>'event' not in ('start','end') then
    raise exception 'notification plan accepted interval unsupported' using errcode='23514';end if;
   if scheduled>at_time then expires:=least(expires,scheduled);end if;
   if ends_at>at_time then expires:=least(expires,ends_at);end if;
   all_intents:=all_intents||jsonb_build_array(jsonb_build_object('intent',n,'valid_from',public.custodial_native_location_utc(scheduled),
    'valid_until',public.custodial_native_location_utc(ends_at)));
   if not silent and scheduled<=at_time and at_time<ends_at and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=n->>'notification_key' and ack.credential_id=p_credential and ack.assignment_epoch=p_epoch
     and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_lunch_coverage','notification_type','lunch_coverage',
     'notification_key',n->>'notification_key','service_date',p_date,'loan_id',n->>'loan_id','event',n->>'event',
     'scheduled_time',n->>'scheduled_time','scheduled_at',public.custodial_native_location_utc(scheduled),
     'valid_until',public.custodial_native_location_utc(ends_at),'coverer_slot_id',n->>'coverer_slot_id',
     'projection_id',a.projection_id,'document_identity',doc.document_identity,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text,
     'route','employee-schedule.html?hub=employee');
    item:=jsonb_build_object('origin','FULL_ACCEPTED_LUNCH_DOCUMENT','notification_key',n->>'notification_key',
     'notification',jsonb_build_object('title',case n->>'event' when 'start' then 'Lunch coverage starts now' else 'Lunch coverage ended' end,
      'body',public.custodial_native_lunch_spoken_body(a.projection_id,doc.document_identity,n->>'loan_id',p_employee,n->>'event'),
      'data',expected),'required_audio',true);
    effects:=effects||jsonb_build_array(item);audio:=audio||jsonb_build_array(n->>'notification_key');
   end if;
  end loop;
  -- The same normal operational assignment + cycle source as the reminder
  -- route, but exhaustive for this exact employee/current accepted projection.
  -- No LIMIT: overflow refuses the WHOLE observation instead of empty/subset.
  for candidate in
   select distinct on (assignment.location_id) assignment.*,cycle.notification_key as cycle_key,
    cycle.status_code,cycle.due_soon_at,cycle.overdue_at
   from public.custodial_operational_location_assignments(p_date) assignment
   left join public.mz_location_reminder_candidates(p_date,at_time) cycle on cycle.location_id=assignment.location_id
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and assignment.coverage_start <= (at_time at time zone 'America/Chicago')::time
    and (at_time at time zone 'America/Chicago')::time < assignment.coverage_end
   order by assignment.location_id,assignment.coverage_start,assignment.group_name,assignment.group_code loop
   total_locations:=total_locations+1;if total_locations>1024 then raise exception 'complete notification plan bound exceeded' using errcode='54000';end if;
   boundary:=(p_date+candidate.coverage_end) at time zone 'America/Chicago';if boundary>at_time then expires:=least(expires,boundary);end if;
   if candidate.due_soon_at>at_time then expires:=least(expires,candidate.due_soon_at);end if;
   if candidate.overdue_at>at_time then expires:=least(expires,candidate.overdue_at);end if;
   if not silent and candidate.status_code in ('due_soon','overdue') and not exists(
    select 1 from public.device_notification_acknowledgements ack where upper(btrim(ack.device_identifier))=upper(btrim(device.device_id))
     and ack.notification_key=candidate.cycle_key||':projection:'||a.projection_id::text and ack.credential_id=p_credential
     and ack.assignment_epoch=p_epoch and ack.employee_id=p_employee and ack.acknowledged_at is not null) then
    expected:=jsonb_build_object('kind','employee_location_status','notification_type','location_status',
     'notification_key',candidate.cycle_key||':projection:'||a.projection_id::text,'service_date',p_date,
     'device_id',device.device_id,'employee_id',p_employee,'employee_name',person.display_name,
     'projection_id',a.projection_id,'publication_id',a.publication_id,'schedule_authority_revision',a.projection_authority_revision::text,
     'location_id',candidate.location_id,'location_code',candidate.location_code,'location_name',candidate.location_name,
     'group_code',candidate.group_code,'group_name',candidate.group_name,'form_type',candidate.form_type,'status_code',candidate.status_code,
     'receipt_employee_id',p_employee,'receipt_credential_id',p_credential,'receipt_device_id',device.device_id,'receipt_assignment_epoch',p_epoch::text);
    effects:=effects||jsonb_build_array(jsonb_build_object('origin','EXHAUSTIVE_NORMAL_CURRENT_LOCATION_CYCLES',
     'notification_key',expected->>'notification_key','data',expected,'required_audio',true));
    audio:=audio||jsonb_build_array(expected->>'notification_key');
   end if;
  end loop;
  -- The ordinary candidate function omits not-yet-due rows. Sample the SAME
  -- underlying verified normal cycle for expiry only, so empty coverage cannot
  -- cross a first due threshold or the existing five-minute overdue repeat.
  select min(b.x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   join public.v_location_dashboard_status status on status.location_id=assignment.location_id
   cross join lateral public.mz_verified_location_reminder_cycle(status.location_id,status.form_type,status.latest_completed_at,
    public.mz_latest_verified_check(status.location_id,status.operational_day_start,at_time),at_time) cycle
   cross join lateral (values (cycle.due_soon_at),(cycle.overdue_at),
    (case when cycle.overdue_at<=at_time then cycle.overdue_at+make_interval(secs=>((cycle.repeat_index+1)*300)::double precision) else null end)) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id
    and status.latest_completed_at>=status.operational_day_start and b.x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  -- Include ALL future normal assignment boundaries, including locations not
  -- active in the loop above. Otherwise a currently-empty plan could outlive
  -- the next accepted work window and pretend no future transition exists.
  select min(x) into boundary from public.custodial_operational_location_assignments(p_date) assignment
   cross join lateral (values ((p_date+assignment.coverage_start) at time zone 'America/Chicago'),
    ((p_date+assignment.coverage_end) at time zone 'America/Chicago')) b(x)
   where assignment.assigned_employee_id=p_employee and assignment.assignment_status='ASSIGNED'
    and assignment.projection_status='current' and assignment.projection_id=a.projection_id and x>at_time;
  if boundary is not null then expires:=least(expires,boundary);end if;
  kind:='FULL_ACCEPTED_LUNCH_AND_EXHAUSTIVE_CURRENT_LOCATION_DERIVATION';
 else raise exception 'unsupported recurring notification plan target' using errcode='22023';end if;
 if expires<=at_time or jsonb_array_length(effects)>1024 then raise exception 'complete notification plan time/bound unsupported' using errcode='54000';end if;
 body:=jsonb_build_object('schema','custodial.recurring-current-notification-plan.v1','complete',true,'receipt_eligible',false,
  'scope','CURRENT_PRESENTATION_AND_FULL_EFFECTS_REQUIRED_BY_ACCEPTED_TARGET_NOT_FUTURE_ALARM_INVENTORY',
  'source',kind,'service_date',p_date,'intent_id',p_intent,'target_digest',p_target_digest,'target',target,
  'rendered_digest',case when target->>'targetType'='SCHEDULE' then target->>'viewDigest' else p_target_digest end,
  'device_pk',p_device,'canonical_device_id',device.device_id,'employee_id',p_employee,'credential_id',p_credential,'assignment_epoch',p_epoch::text,
  'observed_at',public.custodial_native_location_utc(at_time),'valid_until',public.custodial_native_location_utc(expires),
  'notification_state',coalesce(notification_state,jsonb_build_object('notifications_silent',true,'silent_reason','blocked_recurring_authority','override_enabled',false)),
  'accepted_lunch_intents',all_intents,'required_effects',effects,'required_audio',audio,
  'source_counts',jsonb_build_object('accepted_lunch_intents',total_intents,'current_assigned_locations',total_locations));
 -- EMPTY/BLOCKED v1 stays byte-contract compatible. Nonempty v2 MUST carry
 -- an explicit original-binding state; missing history is never empty proof.
 if jsonb_array_length(effects)>0 then
  body:=body||jsonb_build_object('schema','custodial.recurring-current-notification-plan.v2',
   'delivery_bindings',public.static_weekly_v27_original_native_bindings(body,at_time));
  if body#>>'{delivery_bindings,state}'='ORIGINAL_NATIVE_RESERVATIONS' then
   select min((value->>'valid_until')::timestamptz) into boundary
    from jsonb_array_elements(body#>'{delivery_bindings,entries}');
   expires:=least(expires,boundary);
   body:=jsonb_set(body,'{valid_until}',to_jsonb(public.custodial_native_location_utc(expires)));
  end if;
 end if;
 wire:=body::text;if octet_length(wire)>196608 then raise exception 'complete notification plan byte bound exceeded' using errcode='54000';end if;
 return jsonb_build_object('schema',case body->>'schema' when 'custodial.recurring-current-notification-plan.v2' then 'custodial.recurring-current-notification-plan-envelope.v2' else 'custodial.recurring-current-notification-plan-envelope.v1' end,'body',body,
  'bodyJsonText',wire,'bodyDigest',public.static_weekly_digest_text(wire));
end $function$
;
DO $private_owners$ DECLARE item record;BEGIN
 FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='custodial_coverall' AND p.proname=ANY(ARRAY['original_v8_materialize_lunch_document','lunch_validator_fingerprint','require_lunch_admission_proof','owner_revalidate_lunch_admission']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',item.signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader',item.signature);
 END LOOP;
END $private_owners$;
-- Existing public materializer + consumer owner/ACL remain unchanged by CREATE
-- OR REPLACE; private original/proof functions gain no public/runtime grants.
-- Post-admission native reader only: use the existing immutable certificate
-- created by real full v8 admission. Currentness and exact returned views stay
-- in the unchanged public reader; missing/stale native proofs fail closed.
DO $native_lunch_reader_proof_dispatch$
DECLARE target oid:='public.static_weekly_v8_read_lunch_document(date)'::regprocedure;
 proof_reader oid:='custodial_coverall.require_lunch_admission_proof(uuid,jsonb)'::regprocedure;
 before_metadata jsonb;after_metadata jsonb;original_definition text;next_definition text;
 old_assertion text:=$old_lunch_assertion$ perform public.static_weekly_v8_assert_lunch_document(stored.projection_id,stored.document_json);$old_lunch_assertion$;
 native_dispatch text:=$native_lunch_dispatch$ -- Native-manual documents were fully admitted by the exact real v8
 -- materializer before their immutable proof was appended. Require that exact
 -- current-validator/full-projection/full-document certificate here; never
 -- substitute a prepared label, missing proof or caller-controlled flag.
 if exists(select 1 from public.weekly_schedule_compiled_projections projection
  where projection.projection_id=stored.projection_id
   and projection.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1') then
  perform custodial_coverall.require_lunch_admission_proof(stored.projection_id,stored.document_json);
 else
  -- Historical/non-native generic readers retain the original full validator.
  perform public.static_weekly_v8_assert_lunch_document(stored.projection_id,stored.document_json);
 end if;$native_lunch_dispatch$;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
  OR (SELECT proowner FROM pg_proc WHERE oid=proof_reader) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Actual maintained public/private lunch reader owner required';END IF;
 original_definition:=pg_get_functiondef(target);
 IF public.static_weekly_digest_text(original_definition) IS DISTINCT FROM '8e19ebff428a4883e35acd09d50986228f6efea9b12ade4450da0c53aeb327d0'
  OR (SELECT public.static_weekly_digest_text(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'b39a01240618becb9e8b3c35eb910096daa651cef7166c1ac02317284c9508a9'
  OR (length(original_definition)-length(replace(original_definition,old_assertion,'')))/length(old_assertion)<>1
 THEN RAISE EXCEPTION 'Exact original generic lunch reader differs; reconcile changed source before proceeding';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT before_metadata FROM pg_proc p WHERE p.oid=target;
 next_definition:=replace(original_definition,old_assertion,native_dispatch);
 IF public.static_weekly_digest_text(next_definition) IS DISTINCT FROM 'b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15'
 THEN RAISE EXCEPTION 'Exact native proof dispatch substitution differs';END IF;
 EXECUTE next_definition;
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=target;
 IF after_metadata IS DISTINCT FROM before_metadata
  OR public.static_weekly_digest_text(pg_get_functiondef(target)) IS DISTINCT FROM 'b15fe4047739f187438c3081128ff49f8c81e3a63c6e0c12c9a0efdb9685ce15'
 THEN RAISE EXCEPTION 'Generic lunch reader identity/owner/ACL/attributes or exact successor differs';END IF;
END $native_lunch_reader_proof_dispatch$;


COMMIT;
