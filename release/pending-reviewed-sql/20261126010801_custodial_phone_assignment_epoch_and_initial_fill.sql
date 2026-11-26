BEGIN;

CREATE FUNCTION public.custodial_assign_employee_device_at_epoch(
  p_device_identifier text, p_employee_id uuid, p_changed_by_manager_id uuid, p_reason text,
  p_expected_current_employee_id uuid, p_expected_assignment_epoch bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $assignment$
DECLARE
  identifier text := upper(regexp_replace(btrim(coalesce(p_device_identifier,'')), '^KIOSK[-_ ]?', 'KIOSK_', 'i'));
  current_employee uuid;
  current_epoch bigint;
BEGIN
  PERFORM public.custodial_assert_manager(p_changed_by_manager_id);
  IF identifier ~ '^KIOSK_[2-9]$' THEN identifier := 'KIOSK_0'||substring(identifier from 7); END IF;
  IF identifier !~ '^KIOSK_(0[2-9]|10)$' OR p_expected_assignment_epoch IS NULL
     OR p_expected_assignment_epoch NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An exact active kiosk and assignment generation are required.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('custodial-device-assignment:'||identifier,0));
  SELECT d.assigned_employee_id,d.assignment_epoch INTO current_employee,current_epoch
    FROM public.devices d WHERE upper(d.device_id)=identifier AND d.active IS TRUE FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Active employee kiosk not found.';
  END IF;
  IF current_epoch IS DISTINCT FROM p_expected_assignment_epoch
     OR current_employee IS DISTINCT FROM p_expected_current_employee_id THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='This phone assignment changed. Refresh, then review the current assignment.';
  END IF;
  -- The existing writer retains active-employee checks, protected separation,
  -- history, Messenger association and credential/assignment lifecycle.
  RETURN public.custodial_assign_employee_device(identifier,p_employee_id,p_changed_by_manager_id,p_reason,false);
END $assignment$;
REVOKE ALL ON FUNCTION public.custodial_assign_employee_device_at_epoch(text,uuid,uuid,text,uuid,bigint)
  FROM PUBLIC,anon,authenticated,static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION public.custodial_assign_employee_device_at_epoch(text,uuid,uuid,text,uuid,bigint) TO service_role;

CREATE FUNCTION public.static_weekly_initial_fill_slots(uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fill$
DECLARE eligible jsonb;
BEGIN
  PERFORM public.static_weekly_v3_assert_control_plane();
  IF $1 IS NULL OR cardinality($1)>200 OR array_position($1,NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A bounded list of stable positions is required.';
  END IF;
  SELECT coalesce(jsonb_agg(s.slot_id ORDER BY s.slot_id),'[]'::jsonb) INTO eligible
    FROM public.weekly_roster_slots s
    WHERE s.slot_id=ANY($1)
      AND NOT EXISTS(SELECT 1 FROM public.weekly_roster_slot_incumbencies i WHERE i.slot_id=s.slot_id);
  RETURN eligible;
END $fill$;
REVOKE ALL ON FUNCTION public.static_weekly_initial_fill_slots(uuid[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.static_weekly_initial_fill_slots(uuid[]) TO static_weekly_control_plane;

COMMIT;
