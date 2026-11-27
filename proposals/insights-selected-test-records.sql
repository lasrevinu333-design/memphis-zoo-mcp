-- Held forward candidate. Manager-selected completed test sessions stay in
-- every original history table. Only the two operational Insights reads filter them.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
SELECT custodial_dr.acquire_application_mutation_fence();
CREATE TABLE custodial_leadership_private.insights_archive_previews (
 preview_id uuid PRIMARY KEY, actor_identity jsonb NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 selection jsonb NOT NULL, snapshot jsonb NOT NULL, preview_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL
);
CREATE TABLE custodial_leadership_private.insights_archived_sessions (
 session_id uuid PRIMARY KEY REFERENCES public.sessions(id),
 preview_id uuid NOT NULL REFERENCES custodial_leadership_private.insights_archive_previews(preview_id),
 archived_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON custodial_leadership_private.insights_archive_previews,custodial_leadership_private.insights_archived_sessions FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane;
CREATE TRIGGER immutable_insights_preview BEFORE UPDATE OR DELETE OR TRUNCATE ON custodial_leadership_private.insights_archive_previews FOR EACH STATEMENT EXECUTE FUNCTION public.custodial_reject_release_authority_inventory_mutation();
CREATE TRIGGER immutable_insights_archive BEFORE UPDATE OR DELETE OR TRUNCATE ON custodial_leadership_private.insights_archived_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.custodial_reject_release_authority_inventory_mutation();

CREATE FUNCTION custodial_leadership_private.insights_archive(p_actor jsonb,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $fn$
DECLARE
 actor jsonb:=jsonb_strip_nulls(jsonb_build_object('kind',p_actor->'actor_kind','manager',p_actor->'manager_id',
   'registration',p_actor->'credential_id','browser',p_actor->'device_id','claimed',p_actor->'claimed_account_id'));
 packet custodial_leadership_private.insights_archive_previews%ROWTYPE;
 preview uuid; reason text; selected jsonb; entry jsonb; original jsonb; snapshots jsonb:='[]'; shown jsonb:='[]';
 n integer; archived integer; digest text;
BEGIN
 IF p_action NOT IN ('preview','confirm','status') OR p_action IS NULL OR actor->>'manager' IS NULL
  OR coalesce(actor->>'kind','') NOT IN ('NAMED_MANAGER','CUSTODIAL_LEADERSHIP_COHORT') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
  OR octet_length(p_input::text)>16384 OR jsonb_typeof(p_input->'preview_id') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'Invalid archive request' USING ERRCODE='22023'; END IF;
 preview:=(p_input->>'preview_id')::uuid;
 PERFORM custodial_dr.acquire_application_mutation_fence();
 PERFORM pg_advisory_xact_lock(hashtextextended('custodial.insights.archive:'||preview::text,0));
 SELECT * INTO packet FROM custodial_leadership_private.insights_archive_previews WHERE preview_id=preview;
 IF FOUND AND packet.actor_identity IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Original manager required' USING ERRCODE='42501'; END IF;
 IF p_action='preview' THEN
  IF p_input-ARRAY['preview_id','reason','selections']<>'{}'::jsonb OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_input->'selections') IS DISTINCT FROM 'array' OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 1000
   OR jsonb_array_length(p_input->'selections') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Select 1 to 20 completed test sessions and give a reason' USING ERRCODE='22023';END IF;
  reason:=btrim(p_input->>'reason');
  FOR entry IN SELECT value FROM jsonb_array_elements(p_input->'selections') LOOP
   IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['session_id','session_uuid']<>'{}'::jsonb
    OR jsonb_typeof(entry->'session_id') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'session_uuid') IS DISTINCT FROM 'string'
    OR length(entry->>'session_uuid') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Exact session selection required' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('session_id',(value->>'session_id')::uuid,'session_uuid',value->'session_uuid') ORDER BY (value->>'session_id')::uuid),count(DISTINCT (value->>'session_id')::uuid)
  INTO selected,n FROM jsonb_array_elements(p_input->'selections');
  IF n<>jsonb_array_length(selected) THEN RAISE EXCEPTION 'Duplicate selected session' USING ERRCODE='22023';END IF;
  IF packet.preview_id IS NOT NULL AND (selected<>packet.selection OR reason<>packet.reason) THEN RAISE EXCEPTION 'Original preview changed' USING ERRCODE='40001';END IF;
 ELSE
  IF p_input-ARRAY['preview_id','preview_digest']<>'{}'::jsonb OR jsonb_typeof(p_input->'preview_digest') IS DISTINCT FROM 'string'
   THEN RAISE EXCEPTION 'Exact preview digest required' USING ERRCODE='22023';END IF;
  IF packet.preview_id IS NULL THEN RAISE EXCEPTION 'Archive preview unavailable' USING ERRCODE='P0002'; END IF;
  IF packet.preview_digest IS DISTINCT FROM p_input->>'preview_digest' THEN RAISE EXCEPTION 'Original preview digest changed' USING ERRCODE='40001'; END IF;
  selected:=packet.selection;reason:=packet.reason;
 END IF;
 n:=jsonb_array_length(selected);
 SELECT count(*) INTO archived FROM custodial_leadership_private.insights_archived_sessions WHERE preview_id=preview;
 IF archived=n THEN RETURN jsonb_build_object('state','ARCHIVED','preview_id',preview,'preview_digest',packet.preview_digest,'archived_count',n);END IF;
 IF archived<>0 THEN RAISE EXCEPTION 'Original archive receipt incomplete' USING ERRCODE='40001';END IF;
 IF p_action='status' AND clock_timestamp()>=packet.expires_at THEN RETURN jsonb_build_object('state','EXPIRED','preview_id',preview,'preview_digest',packet.preview_digest);END IF;
 IF packet.preview_id IS NOT NULL AND clock_timestamp()>=packet.expires_at THEN RAISE EXCEPTION 'Archive preview expired' USING ERRCODE='40001';END IF;
 -- Same per-session serialization used by the supported correction command.
 FOR entry IN SELECT value FROM jsonb_array_elements(selected) ORDER BY (value->>'session_id')::uuid LOOP
  PERFORM 1 FROM public.sessions WHERE id=(entry->>'session_id')::uuid FOR UPDATE;
  SELECT to_jsonb(v) INTO original FROM public.v_custodial_cleaning_session_truth v WHERE v.session_id=(entry->>'session_id')::uuid;
  IF original IS NULL OR original->>'session_uuid' IS DISTINCT FROM entry->>'session_uuid' OR original->>'status' IS DISTINCT FROM 'closed'
   OR original->>'current_started_at' IS NULL OR original->>'current_ended_at' IS NULL
   OR (original->>'current_ended_at')::timestamptz<(original->>'current_started_at')::timestamptz
   OR EXISTS(SELECT 1 FROM custodial_leadership_private.insights_archived_sessions WHERE session_id=(entry->>'session_id')::uuid)
   THEN
    IF p_action='status' THEN RETURN jsonb_build_object('state','STALE','preview_id',preview,'preview_digest',packet.preview_digest);END IF;
    RAISE EXCEPTION 'Selected completed session changed or was already archived' USING ERRCODE='40001';
  END IF;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('session_id',entry->'session_id','truth_digest',public.static_weekly_digest_jsonb(original)));
  shown:=shown||jsonb_build_array(jsonb_build_object('session_id',entry->'session_id','session_uuid',entry->'session_uuid','current_employee_name',original->'current_employee_name','current_location_name',original->'current_location_name','current_started_at',original->'current_started_at','current_ended_at',original->'current_ended_at'));
 END LOOP;
 digest:=public.static_weekly_digest_jsonb(jsonb_build_object('preview_id',preview,'actor',actor,'selection',selected,'snapshots',snapshots,'reason',reason));
 IF packet.preview_id IS NULL THEN
  INSERT INTO custodial_leadership_private.insights_archive_previews(preview_id,actor_identity,reason,selection,snapshot,preview_digest,expires_at)
   VALUES(preview,actor,reason,selected,snapshots,digest,clock_timestamp()+interval '15 minutes') RETURNING * INTO packet;
 ELSIF packet.snapshot<>snapshots OR digest<>packet.preview_digest THEN
  IF p_action='status' THEN RETURN jsonb_build_object('state','STALE','preview_id',preview,'preview_digest',packet.preview_digest);END IF;
  RAISE EXCEPTION 'Original session facts changed' USING ERRCODE='40001';
 END IF;
 IF p_action IN ('preview','status') THEN RETURN jsonb_build_object('state','PREVIEW','preview_id',preview,'preview_digest',digest,'expires_at',packet.expires_at,'reason',reason,'records',shown);END IF;
 IF clock_timestamp()>=packet.expires_at THEN RAISE EXCEPTION 'Archive preview expired' USING ERRCODE='40001';END IF;
 INSERT INTO custodial_leadership_private.insights_archived_sessions(session_id,preview_id)
 SELECT (value->>'session_id')::uuid,preview FROM jsonb_array_elements(selected);
 RETURN jsonb_build_object('state','ARCHIVED','preview_id',preview,'preview_digest',digest,'archived_count',n);
END $fn$;
REVOKE ALL ON FUNCTION custodial_leadership_private.insights_archive(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane;
CREATE FUNCTION public.custodial_named_insights_archive_v1(p_manager_id uuid, p_backend_execution_secret text, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor jsonb;
BEGIN
 PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
 SELECT jsonb_build_object('actor_kind','NAMED_MANAGER','manager_id',m.manager_id,'manager_name',m.display_name)
 INTO actor FROM public.ops_manager_managers m WHERE m.manager_id=p_manager_id AND m.active=true AND m.revoked_at IS NULL
  AND m.is_system_principal=false AND m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[];
 IF actor IS NULL THEN RAISE EXCEPTION 'Active named manager required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.insights_archive(actor,p_action,p_input);
END $function$
;
CREATE FUNCTION public.custodial_leadership_insights_archive_v1(p_manager_id uuid, p_credential_id uuid, p_device_id text, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor jsonb;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access','write');
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT' OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME' OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 RETURN custodial_leadership_private.insights_archive(actor,p_action,p_input);
END $function$
;

REVOKE ALL ON FUNCTION public.custodial_named_insights_archive_v1(uuid,text,text,jsonb),public.custodial_leadership_insights_archive_v1(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,static_weekly_control_plane,custodial_application_reader,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_named_insights_archive_v1(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.custodial_leadership_insights_archive_v1(uuid,uuid,text,text,jsonb) TO static_weekly_control_plane;
CREATE VIEW public.v_insights_cleaning_session_facts AS
 SELECT f.* FROM public.v_cleaning_session_facts f WHERE NOT EXISTS
 (SELECT 1 FROM custodial_leadership_private.insights_archived_sessions a WHERE a.session_id=f.session_id);
-- Preserve the established comparison formula, and filter its input before calculating employee and location aggregates.
DO $view$
DECLARE predecessor text:=pg_get_viewdef('public.v_cleaning_performance_comparison'::regclass,true); qualified text;
BEGIN
 IF public.static_weekly_digest_text(predecessor) IS DISTINCT FROM '092e380bf27e6f7c943011411218accbbb07c77e30fe3f7037580fb005acf3f9' THEN RAISE EXCEPTION 'Unexpected predecessor for operational performance totals'; END IF;
 qualified:=replace(predecessor,'FROM v_cleaning_session_facts','FROM public.v_insights_cleaning_session_facts AS v_cleaning_session_facts');
 IF qualified=predecessor THEN RAISE EXCEPTION 'Comparison fact input missing'; END IF;
 EXECUTE 'CREATE VIEW public.v_insights_cleaning_performance_comparison AS '||qualified;
END $view$;
REVOKE ALL ON public.v_insights_cleaning_session_facts,public.v_insights_cleaning_performance_comparison FROM PUBLIC,anon,authenticated,static_weekly_control_plane,custodial_application_reader,static_weekly_release_operator,service_role;
GRANT SELECT ON public.v_insights_cleaning_session_facts,public.v_insights_cleaning_performance_comparison TO service_role;
COMMIT;
