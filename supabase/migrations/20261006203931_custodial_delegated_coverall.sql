-- Bounded contractor additions share the existing absence transaction.
-- Preserve the v1 validator for older releases and rollback compatibility.
BEGIN;
CREATE OR REPLACE FUNCTION public.custodial_authorize_coverage_operations_v2(
 p_manager_id uuid,p_credential_id uuid,p_device_id text,p_session_access text,
 p_service_date date,p_publication_id uuid,p_operations jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public
AS $fn$
DECLARE actor jsonb; item jsonb; kind text; source jsonb; slot_id text;
 ordinary jsonb := '[]'::jsonb; capacity jsonb; lunch jsonb;
 shift_start time; shift_end time; lunch_start time; lunch_end time;
BEGIN
 PERFORM public.static_weekly_v3_assert_control_plane();
 actor:=public.custodial_action_actor_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,'manage_absences');
 IF (actor->>'owner')::boolean THEN RETURN actor; END IF;
 IF jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations) NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING errcode='22023',message='One to 25 coverage operations are required';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
  kind:=item->>'exceptionType';
  IF item->>'operation'='cover_all' THEN
   IF item-ARRAY['operation','slotId','shift','reason']<>'{}'::jsonb
     OR jsonb_typeof(item->'shift') IS DISTINCT FROM 'object'
     OR (item->'shift')-ARRAY['start','end']<>'{}'::jsonb
     OR coalesce(item#>>'{shift,start}','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR coalesce(item#>>'{shift,end}','')!~'^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' THEN
    RAISE EXCEPTION USING errcode='42501',message='CoverAll requires one explicit valid shift';
   END IF;
   slot_id:=item->>'slotId';
   IF source IS NULL THEN source:=public.static_weekly_v3_read_publication_source(p_publication_id,p_service_date); END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source#>'{compiler_input,slots}') s
      WHERE s->>'id'=slot_id AND s->>'contractorCapacity'='true'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(s->'contractorAvailability') a
       WHERE (a->>'dayOfWeek')::integer=extract(dow FROM p_service_date)::integer)) THEN
    RAISE EXCEPTION USING errcode='42501',message='CoverAll must use registered contractor capacity on this date';
   END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(p_operations) x WHERE x->>'operation'='cover_all' AND x->>'slotId'=slot_id)<>1
     OR (SELECT count(*) FROM jsonb_array_elements(p_operations) x WHERE x->>'operation'='exception' AND x->>'exceptionType'='lunch' AND x#>>'{payload,slotId}'=slot_id)<>1 THEN
    RAISE EXCEPTION USING errcode='42501',message='Each CoverAll addition requires exactly one recorded lunch';
   END IF;
   SELECT x INTO lunch FROM jsonb_array_elements(p_operations) x WHERE x->>'operation'='exception' AND x->>'exceptionType'='lunch' AND x#>>'{payload,slotId}'=slot_id;
   shift_start:=(item#>>'{shift,start}')::time;shift_end:=(item#>>'{shift,end}')::time;
   IF coalesce(lunch->>'startsAt','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR coalesce(lunch->>'endsAt','')!~'^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' THEN
    RAISE EXCEPTION USING errcode='42501',message='CoverAll lunch requires actual start and end times';
   END IF;
   lunch_start:=(lunch->>'startsAt')::time;lunch_end:=(lunch->>'endsAt')::time;
   IF shift_start>=shift_end OR lunch_start<shift_start OR lunch_end>shift_end OR lunch_end-lunch_start<>interval '1 hour' THEN
    RAISE EXCEPTION USING errcode='42501',message='CoverAll lunch must be one hour within the recorded shift';
   END IF;
  ELSIF item->>'operation'='exception' AND kind='lunch' THEN
   IF (item->'payload')-ARRAY['slotId']<>'{}'::jsonb OR item->>'reversesExceptionId' IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_operations) x WHERE x->>'operation'='cover_all' AND x->>'slotId'=item#>>'{payload,slotId}') THEN
    RAISE EXCEPTION USING errcode='42501',message='Delegated lunch must belong to the CoverAll addition in this batch';
   END IF;
  ELSE
   ordinary:=ordinary||jsonb_build_array(item);
  END IF;
 END LOOP;
 IF jsonb_array_length(ordinary)>0 THEN
  PERFORM public.custodial_authorize_absence_operations_v1(p_manager_id,p_credential_id,p_device_id,p_session_access,p_service_date,p_publication_id,ordinary);
 END IF;
 RETURN actor;
END $fn$;
REVOKE ALL ON FUNCTION public.custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.custodial_authorize_coverage_operations_v2(uuid,uuid,text,text,date,uuid,jsonb) TO static_weekly_control_plane;
COMMIT;
