-- Owner correction 2026-10-06: authorized managers can make dated absence,
-- route regeneration and manual CoverAll changes at any time. No owner-away
-- switch, general administration grant, employee creation or automatic purchase.
BEGIN;
CREATE OR REPLACE FUNCTION public.custodial_action_actor_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE m public.ops_manager_managers%ROWTYPE;c public.ops_manager_trusted_devices%ROWTYPE;is_owner boolean;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','write','close_scan_tickets','manage_absences','manage_coverall','regenerate_routes')
  OR p_session_access IS NULL OR p_session_access NOT IN ('full_access','read_only') THEN
  RAISE EXCEPTION USING errcode='42501',message='Unknown manager action or session access';END IF;
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
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_action_actor_v1(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_action_actor_v1(uuid,uuid,text,text,text) TO service_role,static_weekly_control_plane;

-- Kept under its existing identity so all existing absence callers inherit the
-- corrected policy. Every operation is inspected before the first mutation.
CREATE OR REPLACE FUNCTION public.custodial_authorize_absence_operations_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,
 p_service_date date,p_publication_id uuid,p_operations jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE actor jsonb;item jsonb;kind text;op text;slot text;capacity jsonb;source jsonb;slots jsonb;
 target public.weekly_schedule_exception_commands%ROWTYPE;reverse_id uuid;other_reverse uuid;
 start_text text;end_text text;shift_start text;shift_end text;
BEGIN
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'manage_absences');
 IF actor->'owner'='true'::jsonb THEN RETURN actor;END IF;
 IF p_service_date IS NULL OR NOT isfinite(p_service_date) OR p_publication_id IS NULL
  OR jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations) NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING errcode='22023',message='One to 25 dated scheduler operations are required';END IF;
 source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_service_date);
 slots:=source#>'{compiler_input,slots}';
 IF jsonb_typeof(slots) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING errcode='42501',message='Published roster source is unavailable';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING errcode='42501',message='Invalid dated scheduler operation';END IF;
  op:=item->>'operation';kind:=coalesce(item->>'exceptionType',item->>'exception_type');
  IF item ? 'exceptionType' AND item ? 'exception_type' AND item->>'exceptionType' IS DISTINCT FROM item->>'exception_type' THEN
   RAISE EXCEPTION USING errcode='42501',message='Conflicting operation type';END IF;
  IF op IN ('cover_all','contractor_capacity') THEN
   slot:=coalesce(item->>'slotId',item->>'slot_id');
   IF item ? 'slotId' AND item ? 'slot_id' AND item->>'slotId' IS DISTINCT FROM item->>'slot_id' THEN
    RAISE EXCEPTION USING errcode='42501',message='Conflicting contractor slot';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(slots) s WHERE s->>'id'=slot AND s->'contractorCapacity'='true'::jsonb) THEN
    RAISE EXCEPTION USING errcode='42501',message='CoverAll changes require an existing contractor-capacity slot';END IF;
   IF item-'operation'-'slotId'-'slot_id'-'shift'-'reason'-'breakChoice'<>'{}'::jsonb
    OR jsonb_typeof(item->'shift') IS DISTINCT FROM 'object' OR (item->'shift')-'start'-'end'<>'{}'::jsonb
    OR coalesce(item#>>'{shift,start}','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR coalesce(item#>>'{shift,end}','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR item#>>'{shift,start}'>=item#>>'{shift,end}' OR (item ? 'breakChoice' AND item->>'breakChoice' IS DISTINCT FROM 'NONE') THEN
    RAISE EXCEPTION USING errcode='42501',message='Only actual dated contractor shift fields are delegated';END IF;
  ELSIF op='exception' AND kind IN ('daily_absence','partial_absence','pto') THEN
   slot:=item#>>'{payload,slotId}';
   IF jsonb_typeof(item->'payload') IS DISTINCT FROM 'object' OR (item->'payload')-'slotId'<>'{}'::jsonb
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(slots) s WHERE s->>'id'=slot AND s->'contractorCapacity' IS DISTINCT FROM 'true'::jsonb) THEN
    RAISE EXCEPTION USING errcode='42501',message='Absence changes require an existing employee slot';END IF;
  ELSIF op='exception' AND kind='lunch' THEN
   slot:=item#>>'{payload,slotId}';capacity:=NULL;
   SELECT x INTO capacity FROM jsonb_array_elements(p_operations) x
    WHERE x->>'operation' IN ('cover_all','contractor_capacity') AND coalesce(x->>'slotId',x->>'slot_id')=slot LIMIT 1;
   start_text:=coalesce(item->>'startsAt',item->>'starts_at');end_text:=coalesce(item->>'endsAt',item->>'ends_at');
   shift_start:=capacity#>>'{shift,start}';shift_end:=capacity#>>'{shift,end}';
   IF capacity IS NULL OR capacity->>'breakChoice'='NONE' OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
    OR (item->'payload')-'slotId'<>'{}'::jsonb OR coalesce(start_text,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR coalesce(end_text,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR start_text<shift_start OR end_text>shift_end OR end_text::time-start_text::time<>interval '1 hour' THEN
    RAISE EXCEPTION USING errcode='42501',message='Only the actual one-hour lunch accompanying dated CoverAll capacity is delegated';END IF;
  ELSIF op='exception' AND kind='reverse' THEN
   reverse_id:=nullif(coalesce(item->>'reversesExceptionId',item->>'reverses_exception_id',item#>>'{payload,reversesExceptionId}'),'')::uuid;
   other_reverse:=nullif(item#>>'{payload,reversesExceptionId}','')::uuid;
   IF reverse_id IS NULL OR (other_reverse IS NOT NULL AND other_reverse<>reverse_id) THEN
    RAISE EXCEPTION USING errcode='42501',message='Conflicting or missing reversal identity';END IF;
   SELECT * INTO target FROM public.weekly_schedule_exception_commands WHERE exception_id=reverse_id FOR SHARE;
   IF target.exception_id IS NULL OR target.service_date IS DISTINCT FROM p_service_date OR target.publication_id IS DISTINCT FROM p_publication_id
    OR target.exception_type NOT IN ('daily_absence','partial_absence','pto','cover_all','lunch') THEN
    RAISE EXCEPTION USING errcode='42501',message='Only an absence or CoverAll change on this published day may be reversed';END IF;
   IF target.exception_type='lunch' THEN
    slot:=target.payload_json->>'slotId';
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(slots) s WHERE s->>'id'=slot AND s->'contractorCapacity'='true'::jsonb) THEN
     RAISE EXCEPTION USING errcode='42501',message='Employee lunch changes remain owner-only';END IF;
   END IF;
  ELSE RAISE EXCEPTION USING errcode='42501',message='Only dated absences and CoverAll changes are delegated';
  END IF;
 END LOOP;
 RETURN actor;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb) TO static_weekly_control_plane;

-- Rebuild authorization does not accept a draft, a template or browser rows.
CREATE OR REPLACE FUNCTION public.custodial_authorize_route_regeneration_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,p_week_start date,p_publication_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE actor jsonb;snapshot jsonb;
BEGIN
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'regenerate_routes');
 IF p_week_start IS NULL OR NOT isfinite(p_week_start) OR extract(isodow FROM p_week_start)<>1 OR p_publication_id IS NULL THEN
  RAISE EXCEPTION USING errcode='22023',message='Current published week is required';END IF;
 snapshot:=public.static_weekly_v3_read_manager_snapshot(p_week_start);
 IF snapshot#>>'{current_publication,publication_id}' IS DISTINCT FROM p_publication_id::text THEN
  RAISE EXCEPTION USING errcode='40001',message='Published schedule changed; refresh before regenerating routes';END IF;
 RETURN actor;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.custodial_authorize_route_regeneration_v1(uuid,uuid,text,text,date,uuid) TO static_weekly_control_plane;
CREATE OR REPLACE FUNCTION public.custodial_close_scan_ticket_v1(
  p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,
  p_ticket_id uuid,p_close_notes text,p_backend_execution_secret text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public
AS $fn$
DECLARE actor jsonb; ticket public.maintenance_tickets%ROWTYPE; provenance_id uuid; result jsonb;
BEGIN
  PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'close_scan_tickets');
  SELECT * INTO ticket FROM public.maintenance_tickets WHERE id=p_ticket_id FOR UPDATE;
  IF ticket.id IS NULL THEN RAISE EXCEPTION USING errcode='P0002',message='Ticket not found'; END IF;
  IF NOT (actor->>'owner')::boolean THEN
    SELECT s.id INTO provenance_id
      FROM public.completion_responses r JOIN public.sessions s ON s.id=r.session_id
      WHERE r.id=ticket.completion_response_id AND s.id=ticket.session_id
        AND ticket.issue_source='completion_form'
        AND ticket.location_id=r.location_id AND r.location_id=s.location_id
        AND ticket.device_id=r.device_id AND r.device_id=s.device_id
        AND ticket.reported_by_employee_id=r.submitted_by_employee_id AND r.submitted_by_employee_id=s.employee_id
      FOR SHARE OF r,s;
    IF provenance_id IS NULL THEN
      RAISE EXCEPTION USING errcode='42501',message='Delegated closure requires a verified scan-session ticket';
    END IF;
  END IF;
  IF ticket.status='closed' THEN
    RETURN jsonb_build_object('ticket_id',ticket.id,'status',ticket.status,'closed_by',ticket.closed_by,
      'closed_at',ticket.closed_at,'closed_via',ticket.closed_via,'replayed',true);
  END IF;
  result:=public.custodial_close_maintenance_ticket_authoritative(ticket.id,
    'manager:'||p_manager_id::text||':'||left(actor->>'manager_name',155),left(p_close_notes,1000),p_backend_execution_secret);
  INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
    VALUES(p_credential_id,p_device_id,'scan_ticket_closed',true,jsonb_build_object('ticket_id',ticket.id,'manager_id',p_manager_id,'owner',(actor->>'owner')::boolean));
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_close_scan_ticket_v1(uuid,uuid,text,text,uuid,text,text) TO service_role;


-- Owner-only selector list; clients never receive or supply template bodies.
CREATE OR REPLACE FUNCTION public.custodial_read_approved_schedule_choices_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE actor jsonb;initial_rows jsonb;
BEGIN
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'write');
 SELECT coalesce(jsonb_agg(jsonb_build_object('source_id',b.source_id,'template_id',b.template_id,
  'effective_start',b.effective_start,'staffing_count',c.staffing_count) ORDER BY b.effective_start DESC,b.source_id),'[]'::jsonb)
 INTO initial_rows FROM public.static_weekly_approved_initial_baselines b
 JOIN public.static_weekly_approved_template_catalog c ON c.template_id=b.template_id
 WHERE NOT EXISTS(SELECT 1 FROM public.static_weekly_approved_template_retirements r WHERE r.template_id=c.template_id);
 RETURN jsonb_build_object('schema','custodial.approved-schedule-choices.v1','initial',initial_rows);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.custodial_read_approved_schedule_choices_v1(uuid,uuid,text,text) TO static_weekly_control_plane;

-- Display eligibility is derived from the SAME immutable scan provenance as
-- the closure writer. It is never inferred from a reporter name or ticket text.
CREATE OR REPLACE FUNCTION public.custodial_ticket_capabilities_v1(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,p_ticket_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE actor jsonb;rows jsonb;
BEGIN
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'close_scan_tickets');
 IF p_ticket_ids IS NULL OR cardinality(p_ticket_ids)>100 OR array_position(p_ticket_ids,NULL) IS NOT NULL
  OR cardinality(p_ticket_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_ticket_ids) id) THEN
  RAISE EXCEPTION USING errcode='22023',message='A bounded unique ticket list is required';END IF;
 WITH requested AS (SELECT unnest(p_ticket_ids) AS id), checked AS (
  SELECT requested.id,t.status,t.id IS NOT NULL AS found,
   EXISTS(SELECT 1 FROM public.completion_responses r JOIN public.sessions s ON s.id=r.session_id
    WHERE r.id=t.completion_response_id AND s.id=t.session_id AND t.issue_source='completion_form'
     AND t.location_id=r.location_id AND r.location_id=s.location_id
     AND t.device_id=r.device_id AND r.device_id=s.device_id
     AND t.reported_by_employee_id=r.submitted_by_employee_id AND r.submitted_by_employee_id=s.employee_id) AS scan_origin
  FROM requested LEFT JOIN public.maintenance_tickets t ON t.id=requested.id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('ticket_id',id,'found',found,'status',status,
   'scan_session_verified',scan_origin,'can_close',coalesce(status='open' AND ((actor->>'owner')::boolean OR scan_origin),false)) ORDER BY id),'[]'::jsonb)
 INTO rows FROM checked;
 RETURN jsonb_build_object('schema','custodial.ticket-capabilities.v1','manager_id',p_manager_id,'credential_id',p_credential_id,
  'generated_at',clock_timestamp(),'tickets',rows);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[]) FROM PUBLIC,anon,authenticated,static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION public.custodial_ticket_capabilities_v1(uuid,uuid,text,text,uuid[]) TO service_role;
COMMIT;
