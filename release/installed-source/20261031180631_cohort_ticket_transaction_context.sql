-- Canonical Source303 successor, allocated by the maintained Supabase CLI.
-- Exact auditor-tested component follows; its original staging notice describes
-- the component evidence, not release admission for this canonical file.
-- Component SHA256 3c62b4a126687e9fa03e75649ac72a807f667bd345bc84bac0e1d8839b8ac81a
-- STAGING SUCCESSOR ONLY. Not a canonical migration and not release-admitted.
-- Keep all named-manager ticket entrypoints and grants unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $predecessors$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.require_context(uuid,text)'::regprocedure)) IS DISTINCT FROM 'f477a073e82d0299eecb468d87cfdc62096c8fc1ee798bf973c6195ca93e6115' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: require_context'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('custodial_leadership_private.session_view(uuid)'::regprocedure)) IS DISTINCT FROM '9f009ef3449f4b5f1cb197a0262e8cd0e86de0dc0adb7e90c73b122b4e977869' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: session_view'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_action_actor_v1(uuid,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM '95ae99a83afdd36703f4bbe439856cd43c774f0662751d1ef8ab38728dc6c872' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: custodial_action_actor_v1'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_close_scan_ticket_outcome_v1(uuid,uuid,text,text,uuid,text,text,text,text)'::regprocedure)) IS DISTINCT FROM 'ba04a0147ccbed2d58413b4f0b529fb67eb50b4de148ccc29c273216d2cd48c0' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: custodial_close_scan_ticket_outcome_v1'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)'::regprocedure)) IS DISTINCT FROM '0753eee1b9786d5486596d86945648ea030f30fe76171e64955862e27559f21b' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: custodial_set_maintenance_ticket_outcome'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[])'::regprocedure)) IS DISTINCT FROM 'a8434750c2a1341e5a2aaa7cd62ed34cdf0881c6c433961adf04ebcbeb6ca7af' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: custodial_ticket_capabilities_v1'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_leadership_bind_verified_request(uuid,uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'f194815b5f6a7b7fd5772df7ed94d6e0c42545ddce5a63b7a0ba436f036a598a' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: static_weekly_leadership_bind_verified_request'; END IF;
 IF public.static_weekly_digest_text(pg_get_functiondef('public.static_weekly_v3_assert_control_plane()'::regprocedure)) IS DISTINCT FROM '0ca4734520f37c0c979574b378aaa815175cb7cd3bb55916d85945fd390f7ae8' THEN
  RAISE EXCEPTION 'Ticket cohort predecessor differs: static_weekly_v3_assert_control_plane'; END IF;
END $predecessors$;
CREATE FUNCTION public.custodial_leadership_ticket_operation_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_action text,p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $ticket$
DECLARE actor jsonb;ticket public.maintenance_tickets%rowtype;provenance_id uuid;
 ticket_ids uuid[];ticket_id uuid;outcome text;requested_reference text;requested_notes text;
 recorded_at timestamptz:=statement_timestamp();actor_name text;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,'full_access','close_scan_tickets');
 IF actor->>'actor_kind' IS DISTINCT FROM 'CUSTODIAL_LEADERSHIP_COHORT'
  OR actor->'owner' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'identity_assurance' IS DISTINCT FROM 'SELF_ASSERTED_NAME'
  OR actor->'individual_identity_verified' IS DISTINCT FROM 'false'::jsonb
  OR actor->>'manager_id' IS DISTINCT FROM p_manager_id::text
  OR actor->>'credential_id' IS DISTINCT FROM p_credential_id::text
  OR actor->>'device_id' IS DISTINCT FROM p_device_id
  OR actor->>'request_id' IS NULL THEN
  RAISE EXCEPTION 'Authenticated original cohort context required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>32768 THEN
  RAISE EXCEPTION 'Bounded ticket input required' USING ERRCODE='22023';END IF;
 IF p_action='ticket_capabilities' THEN
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_input) key) IS DISTINCT FROM ARRAY['ticket_ids']
   OR jsonb_typeof(p_input->'ticket_ids') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Ticket list required' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(p_input->'ticket_ids')>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'ticket_ids') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string') THEN
   RAISE EXCEPTION 'Bounded unique ticket list required' USING ERRCODE='22023';END IF;
  SELECT coalesce(array_agg(value::uuid),ARRAY[]::uuid[]) INTO ticket_ids FROM jsonb_array_elements_text(p_input->'ticket_ids');
  -- Same canonical read eligibility, under the same bound transaction and actor.
  RETURN public.custodial_ticket_capabilities_v1(p_manager_id,p_credential_id,p_device_id,'full_access',ticket_ids);
 END IF;
 IF p_action IS DISTINCT FROM 'close_outcome'
  OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_input) key)
    IS DISTINCT FROM ARRAY['close_notes','external_work_order_reference','outcome','ticket_id']
  OR jsonb_typeof(p_input->'ticket_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'outcome') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_input->'external_work_order_reference') NOT IN ('string','null')
  OR jsonb_typeof(p_input->'close_notes') NOT IN ('string','null') THEN
  RAISE EXCEPTION 'Typed ticket outcome required' USING ERRCODE='22023';END IF;
 ticket_id:=(p_input->>'ticket_id')::uuid;outcome:=p_input->>'outcome';
 requested_reference:=nullif(btrim(coalesce(p_input->>'external_work_order_reference','')),'');
 requested_notes:=nullif(btrim(coalesce(p_input->>'close_notes','')),'');
 IF outcome NOT IN ('mark_fixed','work_order_sent')
  OR (outcome='work_order_sent' AND (requested_reference IS NULL OR length(requested_reference)>120))
  OR (outcome='mark_fixed' AND requested_reference IS NOT NULL)
  OR length(coalesce(requested_notes,''))>1000 THEN
  RAISE EXCEPTION 'Choose fixed or provide the reference for an already submitted work order' USING ERRCODE='22023';END IF;
 SELECT * INTO ticket FROM public.maintenance_tickets WHERE id=ticket_id FOR UPDATE;
 IF ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE='P0002';END IF;
 -- Cohort never receives the owner's non-scan exception.
 SELECT s.id INTO provenance_id FROM public.completion_responses r JOIN public.sessions s ON s.id=r.session_id
  WHERE r.id=ticket.completion_response_id AND s.id=ticket.session_id AND ticket.issue_source='completion_form'
   AND ticket.location_id=r.location_id AND r.location_id=s.location_id
   AND ticket.device_id=r.device_id AND r.device_id=s.device_id
   AND ticket.reported_by_employee_id=r.submitted_by_employee_id AND r.submitted_by_employee_id=s.employee_id FOR SHARE OF r,s;
 IF provenance_id IS NULL THEN RAISE EXCEPTION 'Delegated closure requires a verified scan-session ticket' USING ERRCODE='42501';END IF;
 IF ticket.status='closed' THEN
  IF ticket.resolution_outcome IS DISTINCT FROM outcome OR ticket.external_work_order_reference IS DISTINCT FROM requested_reference
   OR nullif(btrim(coalesce(ticket.close_notes,'')),'') IS DISTINCT FROM requested_notes THEN
   RAISE EXCEPTION 'Ticket already has a different recorded outcome; refresh instead of replacing history' USING ERRCODE='40901';END IF;
  -- Exact replay preserves the original writer, never the retrying caller.
  RETURN jsonb_build_object('ticket_id',ticket.id,'status','closed','closed_at',ticket.closed_at,'closed_by',ticket.closed_by,
   'outcome',ticket.resolution_outcome,'external_work_order_reference',ticket.external_work_order_reference,
   'actor_manager_id',ticket.resolution_actor_manager_id,'replayed',true);
 END IF;
 IF ticket.status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Maintenance reminder is not open' USING ERRCODE='40901';END IF;
 actor_name:='Custodial leadership cohort';
 UPDATE public.maintenance_tickets t SET status='closed',closed_at=recorded_at,
  closed_by=actor_name,close_notes=requested_notes,closed_via='manager_issue_outcome',
  resolution_outcome=outcome,external_work_order_reference=requested_reference,resolution_actor_manager_id=p_manager_id
  WHERE t.id=ticket_id;
 INSERT INTO public.maintenance_ticket_outcome_history(
  ticket_id,outcome,actor_manager_id,actor_name_snapshot,external_work_order_reference,notes,previous_status,created_at
 ) VALUES(ticket_id,outcome,p_manager_id,actor_name,requested_reference,requested_notes,ticket.status,recorded_at);
 -- registration_id is not a named trusted-device credential. Retain exact
 -- authenticated attribution in detail_json; never manufacture a legacy FK.
 INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
  VALUES(NULL,p_device_id,'scan_ticket_outcome_recorded',true,jsonb_build_object('ticket_id',ticket_id,
   'manager_id',p_manager_id,'outcome',outcome,'owner',false,'actor',actor));
 RETURN jsonb_build_object('ticket_id',ticket_id,'status','closed','outcome',outcome,
  'external_work_order_reference',requested_reference,'actor_manager_id',p_manager_id,'actor_name',actor_name,
  'recorded_at',recorded_at,'closed_at',recorded_at,'closed_by',actor_name,'replayed',false);
END $ticket$;
ALTER FUNCTION public.custodial_leadership_ticket_operation_v1(uuid,uuid,text,text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.custodial_leadership_ticket_operation_v1(uuid,uuid,text,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_leadership_ticket_operation_v1(uuid,uuid,text,text,jsonb) TO static_weekly_control_plane;
COMMIT;
