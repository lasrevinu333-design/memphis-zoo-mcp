-- Owner/delegate actions. No account, password, historical scan, or schedule rewrite.
-- Only the existing server roles may execute these bounded functions.
BEGIN;
CREATE OR REPLACE FUNCTION public.custodial_action_actor_v1(
  p_manager_id uuid, p_credential_id uuid, p_device_id text,
  p_session_access text, p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $fn$
DECLARE m public.ops_manager_managers%ROWTYPE;
        c public.ops_manager_trusted_devices%ROWTYPE;
        o public.ops_manager_managers%ROWTYPE;
        away jsonb; is_owner boolean;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('read','write','close_scan_tickets','manage_absences') THEN
    RAISE EXCEPTION USING errcode='42501', message='Unknown manager action';
  END IF;
  SELECT * INTO c FROM public.ops_manager_trusted_devices
    WHERE credential_id=p_credential_id FOR SHARE;
  SELECT * INTO m FROM public.ops_manager_managers
    WHERE manager_id=p_manager_id FOR SHARE;
  IF c.credential_id IS NULL OR m.manager_id IS NULL OR c.manager_id IS DISTINCT FROM m.manager_id
     OR c.device_id IS DISTINCT FROM p_device_id OR c.revoked_at IS NOT NULL
     OR c.expires_at<=clock_timestamp() OR c.created_at>clock_timestamp()
     OR NOT m.active OR m.revoked_at IS NOT NULL OR m.is_system_principal
     OR NOT (m.roles && ARRAY['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']) THEN
    RAISE EXCEPTION USING errcode='42501', message='A current named manager credential is required';
  END IF;
  is_owner:=coalesce(m.system_key='eric_custodial_manager'
    AND p_session_access='full_access' AND c.max_access_level='full_access',false);
  IF p_action<>'read' AND m.system_key='eric_custodial_manager' AND NOT is_owner THEN
    RAISE EXCEPTION USING errcode='42501', message='Use a current full-control owner sign-in';
  END IF;
  IF p_action='write' AND NOT is_owner THEN
    RAISE EXCEPTION USING errcode='42501', message='This action is owner-only';
  END IF;
  IF p_action='manage_absences' AND NOT is_owner THEN
    SELECT * INTO o FROM public.ops_manager_managers
      WHERE system_key='eric_custodial_manager' AND active AND revoked_at IS NULL
        AND NOT is_system_principal FOR SHARE;
    away:=o.metadata_json->'custodial_absence_coverage_v1';
    IF o.manager_id IS NULL OR away->>'enabled' IS DISTINCT FROM 'true'
       OR (away->>'starts_at') IS NULL OR (away->>'ends_at') IS NULL
       OR (away->>'starts_at')::timestamptz>clock_timestamp()
       OR (away->>'ends_at')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION USING errcode='42501', message='Absence coverage is not currently delegated by the owner';
    END IF;
  END IF;
  RETURN jsonb_build_object('manager_id',m.manager_id,'manager_name',m.display_name,
    'owner',is_owner,'credential_id',c.credential_id,'device_id',c.device_id);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_action_actor_v1(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_action_actor_v1(uuid,uuid,text,text,text) TO service_role,static_weekly_control_plane;

CREATE OR REPLACE FUNCTION public.custodial_owner_coverage_v1(
  p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,
  p_change jsonb,p_backend_execution_secret text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public
AS $fn$
DECLARE actor jsonb; owner_row public.ops_manager_managers%ROWTYPE;
        state jsonb; revision bigint; until_at timestamptz;
BEGIN
  PERFORM public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,
    CASE WHEN p_change IS NULL THEN 'read' ELSE 'write' END);
  SELECT * INTO owner_row FROM public.ops_manager_managers
    WHERE system_key='eric_custodial_manager' FOR UPDATE;
  IF owner_row.manager_id IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='Owner registry unavailable'; END IF;
  state:=coalesce(owner_row.metadata_json->'custodial_absence_coverage_v1','{}'::jsonb);
  revision:=coalesce((state->>'revision')::bigint,0);
  IF p_change IS NOT NULL THEN
    IF jsonb_typeof(p_change)<>'object' OR p_change - ARRAY['enabled','ends_at','reason','expected_revision']<>'{}'::jsonb
       OR jsonb_typeof(p_change->'enabled') IS DISTINCT FROM 'boolean'
       OR (p_change->>'expected_revision')::bigint IS DISTINCT FROM revision THEN
      RAISE EXCEPTION USING errcode='40001',message='Coverage settings changed; refresh before saving';
    END IF;
    IF (p_change->>'enabled')::boolean THEN
      until_at:=(p_change->>'ends_at')::timestamptz;
      IF until_at IS NULL OR until_at<=clock_timestamp() OR until_at>clock_timestamp()+interval '366 days' THEN
        RAISE EXCEPTION USING errcode='22023',message='A future coverage end within one year is required';
      END IF;
    END IF;
    state:=jsonb_build_object('enabled',(p_change->>'enabled')::boolean,
      'starts_at',clock_timestamp(),'ends_at',until_at,'reason',left(coalesce(p_change->>'reason',''),500),
      'revision',revision+1,'changed_by',p_manager_id);
    UPDATE public.ops_manager_managers SET metadata_json=jsonb_set(metadata_json,'{custodial_absence_coverage_v1}',state,true)
      WHERE manager_id=owner_row.manager_id;
    INSERT INTO public.ops_manager_auth_events(credential_id,device_id,event_type,success,detail_json)
      VALUES(p_credential_id,p_device_id,'owner_absence_coverage_changed',true,state);
  END IF;
  RETURN jsonb_build_object('enabled',coalesce((state->>'enabled')::boolean,false)
      AND coalesce((state->>'starts_at')::timestamptz<=clock_timestamp(),false)
      AND coalesce((state->>'ends_at')::timestamptz>clock_timestamp(),false),
    'starts_at',state->'starts_at','ends_at',state->'ends_at','reason',state->'reason',
    'revision',coalesce((state->>'revision')::bigint,0),'owner_control_unchanged',true);
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_owner_coverage_v1(uuid,uuid,text,text,jsonb,text) TO service_role;

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

CREATE OR REPLACE FUNCTION public.custodial_authorize_absence_operations_v1(
  p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,
  p_service_date date,p_publication_id uuid,p_operations jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public
AS $fn$
DECLARE actor jsonb; item jsonb; kind text; target public.weekly_schedule_exception_commands%ROWTYPE;
BEGIN
  actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'manage_absences');
  IF (actor->>'owner')::boolean THEN RETURN actor; END IF;
  IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations) NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION USING errcode='22023',message='One to 25 absence operations are required';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    kind:=coalesce(item->>'exceptionType',item->>'exception_type');
    IF item->>'operation' IS DISTINCT FROM 'exception' OR kind NOT IN ('daily_absence','partial_absence','pto','reverse') OR kind IS NULL THEN
      RAISE EXCEPTION USING errcode='42501',message='Only absence changes are delegated';
    END IF;
    IF kind='reverse' THEN
      SELECT * INTO target FROM public.weekly_schedule_exception_commands
        WHERE exception_id=(item#>>'{payload,reversesExceptionId}')::uuid FOR SHARE;
      IF target.exception_id IS NULL OR target.exception_type NOT IN ('daily_absence','partial_absence','pto')
         OR target.service_date IS DISTINCT FROM p_service_date OR target.publication_id IS DISTINCT FROM p_publication_id THEN
        RAISE EXCEPTION USING errcode='42501',message='Only an absence on this published service date may be reversed';
      END IF;
    END IF;
  END LOOP;
  RETURN actor;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.custodial_authorize_absence_operations_v1(uuid,uuid,text,text,date,uuid,jsonb) TO static_weekly_control_plane;
COMMIT;
