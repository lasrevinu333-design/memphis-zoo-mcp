-- Exact existing postgres NEW-creator equivalence; canonical bodies/other-role revocations unchanged.
-- Authoritative, read-only09:45 source interval. No job, reservation, device
-- clock/effect, retention or delivery authority is created by this lookup.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- BEGIN FINITE NEW-CREATOR PROFILE 103
DO $creator_pre$ BEGIN
 IF current_user<>'postgres' OR session_user<>current_user
  OR current_setting('custodial.deployment_project_ref',true) IS DISTINCT FROM 'rqquvtjdmugpigbndmne'
  OR current_setting('session_replication_role')<>'origin'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolbypassrls)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.custodial_release_authority_restore_inventory'::regclass AND relowner='postgres'::regrole)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR to_regclass('pg_temp.custodial_creator_acl_103_before') IS NOT NULL
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) x WHERE to_regclass(x) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_window_source_at','custodial_native_schedule_window_source']::text[]))
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
   CROSS JOIN LATERAL(SELECT regexp_replace(i.object_identity,'[[:space:]"]','','g') identity) clean
   WHERE (i.object_kind IN('function','grant') AND EXISTS(SELECT 1 FROM unnest(ARRAY['custodial_native_schedule_window_source_at','custodial_native_schedule_window_source']::text[]) name
    WHERE split_part(clean.identity,'(',1)=ANY(ARRAY[name,'public.'||name])))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[]::text[]) relation
     WHERE starts_with(clean.identity,relation) OR starts_with(clean.identity,substr(relation,8)))) THEN
  RAISE EXCEPTION 'Finite creator Source103 original owner/new-object boundary changed';
 END IF;
END $creator_pre$;
CREATE TEMP TABLE custodial_creator_acl_103_before(class text NOT NULL,signature text PRIMARY KEY,object_oid oid NOT NULL,owner_oid oid NOT NULL,owner_acl jsonb NOT NULL,definition_md5 text) ON COMMIT DROP;
-- END FINITE NEW-CREATOR PROFILE 103
CREATE FUNCTION public.custodial_native_schedule_window_source_at(
 p_source_key uuid,p_employee_id uuid,p_generation_id uuid,p_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,extensions AS $fn$
DECLARE
 target jsonb;day date;projection uuid;publication uuid;version uuid;availability jsonb;matches integer;
 segments jsonb;physical jsonb;loans jsonb;analysis jsonb;before_units jsonb;after_units jsonb;
 cut time;shift_end time;start_at timestamptz;end_at timestamptz;credential_end timestamptz;
 name text;source_document jsonb;source_digest text;window_data jsonb;v_status text;
BEGIN
 IF p_source_key IS NULL OR p_employee_id IS NULL OR p_generation_id IS NULL OR p_at IS NULL OR NOT isfinite(p_at) THEN
  RAISE EXCEPTION 'exact native SCHEDULE source and server time required' USING errcode='22023';END IF;
 target:=public.custodial_native_target_source_at('SCHEDULE',p_source_key,p_employee_id,p_generation_id,p_at);
 IF target->>'status' IS DISTINCT FROM 'SOURCE_ONLY_POLICY_MISSING' THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status',target->>'status',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 day:=(target#>>'{source,service_date}')::date;projection:=(target#>>'{source,source_id}')::uuid;
 publication:=(target#>>'{source,publication_id}')::uuid;version:=(target#>>'{source,version_id}')::uuid;
 SELECT count(*),min(value::text)::jsonb INTO matches,availability
  FROM public.weekly_schedule_compiled_projections p,
   jsonb_array_elements(p.projection_envelope#>'{authority,projectionAvailability}') value
  WHERE p.projection_id=projection AND value->>'serviceDate'=day::text
   AND value->>'incumbentPersonId'=p_employee_id::text AND value->>'status'='working';
 IF matches<>1 OR availability#>>'{shift,start}' IS NULL OR availability#>>'{shift,end}' IS NULL
  OR (availability#>>'{shift,start}')::time>time '09:45'
  OR (availability#>>'{shift,end}')::time<=time '09:45' THEN
  RAISE EXCEPTION 'exact working SCHEDULE recipient availability required' USING errcode='22023';END IF;
 name:=availability->>'incumbentName';shift_end:=(availability#>>'{shift,end}')::time;
 IF name IS NULL OR btrim(name)='' OR octet_length(name)>180 OR name~'[[:cntrl:]]' THEN
  RAISE EXCEPTION 'accepted SCHEDULE recipient name unsupported' USING errcode='22023';END IF;
 -- Trusted canonical readers, not a caller-supplied DTO or SQL expression.
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY segment_id),'[]'::jsonb) INTO segments FROM (
  SELECT service_date,projection_status,version_id,publication_id,projection_id,segment_id,location_group_id,
   included_location_ids,owner_type,assigned_employee_id,coverage_start,coverage_end,status,source_type,service_mode,governed
  FROM public.static_weekly_v6_read_schedule_segments(day)) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY occurrence_id,location_id,coverage_start),'[]'::jsonb) INTO physical FROM (
  SELECT service_date,projection_status,version_id,publication_id,projection_id,occurrence_id,location_group_id,location_id,
   assigned_employee_id,coverage_start,coverage_end,assignment_status,authority_source
  FROM public.custodial_operational_location_assignments(day)) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY normal_occurrence_id,responsibility_id,coverage_start),'[]'::jsonb) INTO loans FROM (
  SELECT projection_id,loan_id,responsibility_id,normal_occurrence_id,normal_owner_id,coverer_id,location_group_id,
   included_location_ids,included_snapshots='[]'::jsonb AS included_snapshots_empty,service_mode,coverage_start,coverage_end
  FROM public.static_weekly_v8_read_lunch_segments(day)) r;
 IF jsonb_array_length(segments)>4096 OR jsonb_array_length(physical)>4096 OR jsonb_array_length(loans)>4096
  OR octet_length(jsonb_build_array(segments,physical,loans)::text)>2097152 THEN
  RAISE EXCEPTION 'SCHEDULE source limit exceeded' USING errcode='22023';END IF;
 WITH s AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(segments) AS r(service_date date,projection_status text,
  version_id uuid,publication_id uuid,projection_id uuid,segment_id uuid,location_group_id uuid,included_location_ids uuid[],
  owner_type text,assigned_employee_id uuid,coverage_start time,coverage_end time,status text,source_type text,service_mode text,governed boolean)),
 p AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(physical) AS r(service_date date,projection_status text,version_id uuid,
  publication_id uuid,projection_id uuid,occurrence_id uuid,location_group_id uuid,location_id uuid,assigned_employee_id uuid,
  coverage_start time,coverage_end time,assignment_status text,authority_source text)),
 l AS MATERIALIZED(SELECT * FROM jsonb_to_recordset(loans) AS r(projection_id uuid,loan_id text,responsibility_id text,
  normal_occurrence_id uuid,normal_owner_id uuid,coverer_id uuid,location_group_id uuid,included_location_ids uuid[],
  included_snapshots_empty boolean,service_mode text,coverage_start time,coverage_end time)),
 sides AS(SELECT * FROM (VALUES(0,true),(1,false)) r(side,pre)),
 active AS(SELECT sides.side,sides.pre,s.* FROM s CROSS JOIN sides WHERE
  CASE WHEN sides.pre THEN s.coverage_start<time '09:45' AND s.coverage_end>=time '09:45'
   ELSE s.coverage_start<=time '09:45' AND s.coverage_end>time '09:45' END),
 effective AS(SELECT a.*,loan.n AS loan_count,CASE WHEN loan.n=1 THEN loan.coverer ELSE a.assigned_employee_id END AS effective_owner
  FROM active a CROSS JOIN LATERAL(SELECT count(*) AS n,(array_agg(l.coverer_id))[1] AS coverer FROM l
   WHERE l.normal_occurrence_id=a.segment_id AND CASE WHEN a.pre THEN l.coverage_start<time '09:45' AND l.coverage_end>=time '09:45'
    ELSE l.coverage_start<=time '09:45' AND l.coverage_end>time '09:45' END) loan),
 selected_physical AS(SELECT e.side,e.segment_id,e.effective_owner,e.loan_count,p.* FROM effective e JOIN p
  ON p.occurrence_id=e.segment_id AND CASE WHEN e.pre THEN p.coverage_start<time '09:45' AND p.coverage_end>=time '09:45'
   ELSE p.coverage_start<=time '09:45' AND p.coverage_end>time '09:45' END),
 units AS(SELECT e.side,'DUTY:'||e.service_mode||':'||e.location_group_id::text AS key,e.effective_owner AS owner
   FROM effective e WHERE e.service_mode IN('reminder_only','response_only_no_clean')
  UNION ALL SELECT p.side,'LOCATION:'||p.location_id::text,p.assigned_employee_id FROM selected_physical p),
 invalid_segments AS(SELECT 1 FROM s WHERE s.service_date IS DISTINCT FROM day OR s.projection_id IS DISTINCT FROM projection
  OR s.publication_id IS DISTINCT FROM publication OR s.version_id IS DISTINCT FROM version OR s.projection_status IS DISTINCT FROM 'current'
  OR s.governed IS DISTINCT FROM true OR s.source_type IS DISTINCT FROM 'static_weekly_projection'
  OR s.coverage_start IS NULL OR s.coverage_end IS NULL OR s.coverage_start>=s.coverage_end
  OR s.service_mode IS NULL OR s.service_mode NOT IN('scan_tracked','reminder_only','response_only_no_clean')
  OR s.included_location_ids IS NULL OR (s.service_mode='scan_tracked' AND cardinality(s.included_location_ids)=0)
  OR (s.service_mode<>'scan_tracked' AND cardinality(s.included_location_ids)<>0)
  OR NOT((s.status='ASSIGNED' AND ((s.owner_type='EMPLOYEE' AND s.assigned_employee_id IS NOT NULL)
   OR(s.owner_type='COVERALL' AND s.assigned_employee_id IS NULL))) OR(s.status='OPEN' AND s.owner_type='OPEN' AND s.assigned_employee_id IS NULL))),
 invalid_loans AS(SELECT 1 FROM l LEFT JOIN s ON s.segment_id=l.normal_occurrence_id WHERE s.segment_id IS NULL
  OR s.status IS DISTINCT FROM 'ASSIGNED' OR l.projection_id IS DISTINCT FROM projection
  OR l.normal_owner_id IS DISTINCT FROM s.assigned_employee_id OR l.location_group_id IS DISTINCT FROM s.location_group_id
  OR l.service_mode IS DISTINCT FROM s.service_mode OR l.coverage_start IS NULL OR l.coverage_end IS NULL
  OR l.coverage_start>=l.coverage_end OR l.coverage_start<s.coverage_start OR l.coverage_end>s.coverage_end
  OR (l.service_mode='scan_tracked' AND (l.included_snapshots_empty IS DISTINCT FROM false OR l.included_location_ids IS NULL))
  OR (l.service_mode<>'scan_tracked' AND l.included_snapshots_empty IS DISTINCT FROM true)
  OR ARRAY(SELECT unnest(coalesce(l.included_location_ids,'{}'::uuid[])) ORDER BY 1)
    IS DISTINCT FROM ARRAY(SELECT unnest(s.included_location_ids) ORDER BY 1)),
 invalid_physical AS(SELECT 1 FROM p LEFT JOIN s ON s.segment_id=p.occurrence_id WHERE s.segment_id IS NULL
  OR s.service_mode IS DISTINCT FROM 'scan_tracked' OR p.location_id IS NULL OR NOT(p.location_id=ANY(s.included_location_ids))
  OR p.location_group_id IS DISTINCT FROM s.location_group_id OR p.projection_id IS DISTINCT FROM projection
  OR p.publication_id IS DISTINCT FROM publication OR p.version_id IS DISTINCT FROM version OR p.service_date IS DISTINCT FROM day
  OR p.projection_status IS DISTINCT FROM 'current' OR p.assignment_status IS DISTINCT FROM s.status
  OR p.coverage_start IS NULL OR p.coverage_end IS NULL OR p.coverage_start>=p.coverage_end
  OR p.coverage_start<s.coverage_start OR p.coverage_end>s.coverage_end
  OR p.authority_source IS NULL OR p.authority_source NOT IN('static_weekly_projection','static_weekly_lunch_coverage')),
 edges AS(SELECT coverage_start AS edge FROM s WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_end FROM s WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_start FROM p WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_end FROM p WHERE assigned_employee_id=p_employee_id UNION ALL
  SELECT coverage_start FROM l WHERE normal_owner_id=p_employee_id OR coverer_id=p_employee_id UNION ALL
  SELECT coverage_end FROM l WHERE normal_owner_id=p_employee_id OR coverer_id=p_employee_id)
 SELECT jsonb_build_object(
  'before_units',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM units WHERE side=0 AND owner=p_employee_id),'[]'::jsonb),
  'after_units',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM units WHERE side=1 AND owner=p_employee_id),'[]'::jsonb),
  'cut',(SELECT min(edge) FROM edges WHERE edge>time '09:45'),
  'invalid',EXISTS(SELECT 1 FROM invalid_segments) OR EXISTS(SELECT 1 FROM invalid_loans) OR EXISTS(SELECT 1 FROM invalid_physical)
   OR EXISTS(SELECT 1 FROM effective WHERE loan_count>1)
   OR EXISTS(SELECT 1 FROM units GROUP BY side,key HAVING count(*)<>1)
   OR EXISTS(SELECT 1 FROM effective e WHERE e.service_mode='scan_tracked' AND
    (SELECT count(*) FROM selected_physical p WHERE p.side=e.side AND p.segment_id=e.segment_id)<>cardinality(e.included_location_ids))
   OR EXISTS(SELECT 1 FROM selected_physical p WHERE p.assigned_employee_id IS DISTINCT FROM p.effective_owner
    OR p.authority_source IS DISTINCT FROM CASE WHEN p.loan_count=1 THEN 'static_weekly_lunch_coverage' ELSE 'static_weekly_projection' END)) INTO analysis;
 IF (analysis->>'invalid')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'current accepted SCHEDULE source incomplete or ambiguous' USING errcode='22023';END IF;
 before_units:=analysis->'before_units';after_units:=analysis->'after_units';
 IF before_units=after_units THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','NO_OWNERSHIP_CHANGE',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 cut:=(analysis->>'cut')::time;
 -- Working availability is an additional authoritative ceiling, never an
 -- invented expiry. Credential and04:00 operational-day ceilings also apply.
 cut:=least(coalesce(cut,shift_end),shift_end);
 start_at:=(day+time '09:45') AT TIME ZONE 'America/Chicago';
 SELECT expires_at INTO STRICT credential_end FROM public.device_auth_credentials
  WHERE credential_id=(target#>>'{recipient,credential_id}')::uuid;
 end_at:=least((day+cut) AT TIME ZONE 'America/Chicago',credential_end,
  ((day+1)+time '04:00') AT TIME ZONE 'America/Chicago');
 IF end_at<=start_at THEN RAISE EXCEPTION 'finite SCHEDULE source interval unavailable' USING errcode='22023';END IF;
 IF p_at>=end_at OR (p_at>=start_at AND public.sch_service_date(p_at) IS DISTINCT FROM day) THEN
  RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status','SOURCE_WINDOW_EXPIRED',
   'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',null);END IF;
 source_document:=jsonb_build_object('schema','custodial.native-schedule-server-source-evidence.v1','target',target,
  'availability',availability,'segments',segments,'physical',physical,'loans',loans,
  'valid_from',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 source_digest:=public.static_weekly_digest_jsonb(source_document);
 window_data:=jsonb_build_object('schema','custodial.native-schedule-server-window.v1','logical_key','schedule-ownership:'||day::text||':'||p_employee_id::text||':09:45',
  'service_date',day,'timezone','America/Chicago','employee_id',p_employee_id,'employee_name',name,'generation_id',p_generation_id,
  'recipient',target->'recipient','projection_id',projection,'publication_id',publication,'version_id',version,
  'source_revision',target#>>'{source,source_revision}','assignment_occurrence_id',p_source_key,'before_units',before_units,'after_units',after_units,
  'server_source_sha256',source_digest,'server_digest_format','postgres-jsonb-sha256.v1',
  'valid_from',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'valid_until',to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'server_now',to_char(p_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 v_status:=CASE WHEN p_at<start_at THEN 'WINDOW_NOT_STARTED' ELSE 'CURRENT_WINDOW_SOURCE_ONLY' END;
 RETURN jsonb_build_object('schema','custodial.native-schedule-server-window-source.v1','status',v_status,
  'delivery_admitted',false,'dispatch_authorized',false,'clock_effect_authority',null,'retention_authority',null,'window',window_data);
END $fn$;
CREATE FUNCTION public.custodial_native_schedule_window_source(p_source_key uuid,p_employee_id uuid,p_generation_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT public.custodial_native_schedule_window_source_at(p_source_key,p_employee_id,p_generation_id,statement_timestamp());
$fn$;

DO $creator_function_before$ DECLARE spec record;p record;BEGIN
 FOR spec IN SELECT * FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_window_source_at","body_md5":"b704bfc4885dbf293f9f9294744ebdd7","argument_names":["p_source_key","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public, extensions"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_window_source(uuid,uuid,uuid)","name":"custodial_native_schedule_window_source","body_md5":"70c249b4e920f23c3e024b1f461a416f","argument_names":["p_source_key","p_employee_id","p_generation_id"],"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
  AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) LOOP
  SELECT f.*,l.lanname INTO STRICT p FROM pg_proc f JOIN pg_language l ON l.oid=f.prolang WHERE f.oid=to_regprocedure(spec.signature) AND f.pronamespace='public'::regnamespace;
  IF p.proowner<>'postgres'::regrole OR p.proname<>spec.name OR md5(p.prosrc)<>spec.body_md5
   OR p.proargnames IS DISTINCT FROM spec.argument_names OR pg_get_function_result(p.oid)<>spec.returns OR p.lanname<>spec.language
   OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility OR p.proconfig IS DISTINCT FROM spec.config
   OR p.prokind<>'f' OR p.proretset OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR NOT has_function_privilege(current_user,p.oid,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner AND(a.grantor<>p.proowner OR a.is_grantable)) THEN
   RAISE EXCEPTION 'Finite creator Source103 new routine owner/body/ordinary EXECUTE unavailable';END IF;
  INSERT INTO pg_temp.custodial_creator_acl_103_before VALUES('function',spec.signature,p.oid,p.proowner,(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner),md5(pg_get_functiondef(p.oid)));
 END LOOP;
END $creator_function_before$;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
REVOKE ALL ON FUNCTION public.custodial_native_schedule_window_source(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_native_schedule_window_source(uuid,uuid,uuid) TO service_role;
DO $creator_before_capture$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_window_source_at','custodial_native_schedule_window_source']::text[]))<>2
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_103_before)<>2 THEN
  RAISE EXCEPTION 'Finite creator Source103 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_103_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source103 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source103 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_window_source_at","body_md5":"b704bfc4885dbf293f9f9294744ebdd7","argument_names":["p_source_key","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public, extensions"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_window_source(uuid,uuid,uuid)","name":"custodial_native_schedule_window_source","body_md5":"70c249b4e920f23c3e024b1f461a416f","argument_names":["p_source_key","p_employee_id","p_generation_id"],"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source103 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_before_capture$;

DO $surface$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'SCHEDULE source window canary seam changed';END IF;
 EXECUTE replace(definition,'  values','  values'||chr(10)||
  '    (''function'',''custodial_native_schedule_window_source(uuid,uuid,uuid)'',''private server-bound SCHEDULE source window; no delivery authority''),');
END $surface$;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
DO $recovery$ DECLARE obj record;ord integer;changed integer;BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'SCHEDULE window ALWAYS inventory guard missing';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 FOR obj IN SELECT 100000 AS bucket,'function'::text AS kind,p.oid::regprocedure::text AS identity,pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p WHERE p.oid=ANY(ARRAY['public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)'::regprocedure,
   'public.custodial_native_schedule_window_source(uuid,uuid,uuid)'::regprocedure,'public.custodial_release_canary_authority_surface()'::regprocedure])
  UNION ALL SELECT 900000,'grant',identity,public.custodial_release_authority_current_grant_definition(identity)
  FROM(VALUES('public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)'::regprocedure::text),
   ('public.custodial_native_schedule_window_source(uuid,uuid,uuid)'::regprocedure::text),
   ('public.custodial_release_canary_authority_surface()'::regprocedure::text)) r(identity)
 LOOP
  IF obj.definition IS NULL THEN RAISE EXCEPTION 'SCHEDULE source recovery definition missing';END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=obj.definition,
   definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
   WHERE object_kind=obj.kind AND object_identity IN(regexp_replace(obj.identity,'^public\.',''),
    'public.'||regexp_replace(obj.identity,'^public\.',''));
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>1 THEN RAISE EXCEPTION 'SCHEDULE source recovery identity ambiguous';END IF;
  IF changed=0 THEN
   SELECT n INTO ord FROM generate_series(obj.bucket+1,obj.bucket+99999) n
    WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
   IF ord IS NULL THEN RAISE EXCEPTION 'SCHEDULE source recovery order exhausted';END IF;
   INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
    VALUES(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
  END IF;
 END LOOP;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
END $recovery$;

DO $creator_after$ DECLARE before record;p record;c record;spec record;actual_acl jsonb;populated boolean;BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['custodial_native_schedule_window_source_at','custodial_native_schedule_window_source']::text[]))<>2
  OR (SELECT count(*) FROM pg_temp.custodial_creator_acl_103_before)<>2 THEN
  RAISE EXCEPTION 'Finite creator Source103 exact new-object signature/OID census changed';END IF;
 FOR before IN SELECT * FROM pg_temp.custodial_creator_acl_103_before LOOP
  IF before.class='relation' THEN
   SELECT * INTO STRICT c FROM pg_class WHERE oid=to_regclass(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=c.relowner);
   IF c.oid<>before.object_oid OR c.relowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     CROSS JOIN aclexplode(acldefault('r',c.relowner)) ordinary WHERE has_table_privilege(role,c.oid,ordinary.privilege_type))
    OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND tgname='custodial_disaster_restore_mutation_fence' AND tgenabled='O' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgtype=62 AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM jsonb_to_recordset($creator_triggers$[]$creator_triggers$::jsonb) AS x(relation text,name text,function text,type integer,enabled text)
     WHERE relation=before.signature AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname=x.name AND t.tgfoid=to_regprocedure(x.function) AND t.tgtype=x.type AND t.tgenabled::text=x.enabled AND NOT t.tgisinternal))
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)<>2 THEN
    RAISE EXCEPTION 'Finite creator Source103 new relation owner/ACL/RLS/trigger boundary changed';END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %s)',c.oid::regclass) INTO populated;
   IF populated THEN RAISE EXCEPTION 'Finite creator Source103 new relation unexpectedly populated';END IF;
  ELSE
   SELECT * INTO STRICT p FROM pg_proc WHERE oid=to_regprocedure(before.signature);
   actual_acl:=(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=p.proowner);
   SELECT * INTO STRICT spec FROM jsonb_to_recordset($creator_specs$[{"signature":"public.custodial_native_schedule_window_source_at(uuid,uuid,uuid,timestamptz)","name":"custodial_native_schedule_window_source_at","body_md5":"b704bfc4885dbf293f9f9294744ebdd7","argument_names":["p_source_key","p_employee_id","p_generation_id","p_at"],"returns":"jsonb","language":"plpgsql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public, extensions"],"nonowner_execute":[]},{"signature":"public.custodial_native_schedule_window_source(uuid,uuid,uuid)","name":"custodial_native_schedule_window_source","body_md5":"70c249b4e920f23c3e024b1f461a416f","argument_names":["p_source_key","p_employee_id","p_generation_id"],"returns":"jsonb","language":"sql","security_definer":true,"volatility":"s","config":["search_path=pg_catalog, public"],"nonowner_execute":["service_role"]}]$creator_specs$::jsonb)
    AS x(signature text,name text,body_md5 text,argument_names text[],returns text,language text,security_definer boolean,volatility text,config text[],nonowner_execute text[]) WHERE signature=before.signature;
   IF p.oid<>before.object_oid OR p.proowner<>before.owner_oid OR actual_acl IS DISTINCT FROM before.owner_acl
    OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM before.definition_md5
    OR md5(p.prosrc)<>spec.body_md5 OR p.proconfig IS DISTINCT FROM spec.config OR p.prosecdef<>spec.security_definer OR p.provolatile::text<>spec.volatility
    OR (SELECT coalesce(array_agg(r.rolname::text ORDER BY r.rolname),'{}'::text[]) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner) IS DISTINCT FROM spec.nonowner_execute
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>p.proowner)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_control_plane','static_weekly_release_operator','static_weekly_runtime_20260823']) role
     WHERE has_function_privilege(role,p.oid,'EXECUTE') IS DISTINCT FROM (role=ANY(spec.nonowner_execute))) THEN
    RAISE EXCEPTION 'Finite creator Source103 new routine owner/nonowner ACL/body changed';END IF;
  END IF;
 END LOOP;
END $creator_after$;
COMMIT;
