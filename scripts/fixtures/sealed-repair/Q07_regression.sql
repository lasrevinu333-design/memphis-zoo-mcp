-- ROOT ONLY, isolated successor catalog; no live events or provider calls.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $offsite$
DECLARE outside_group uuid;onsite public.event_venues%rowtype;coverage uuid;event_row public.events_app_events%rowtype;
 d date:=(clock_timestamp() at time zone 'America/Chicago')::date+20; start_at timestamptz;end_at timestamptz;
BEGIN
 SELECT id INTO STRICT outside_group FROM public.location_groups WHERE group_code='OFFSITE' AND group_name='Off campus event'
  AND active=false AND offsite=true AND eligible_event_scope=true AND eligible_custodial_coverage=false AND eligible_staffing_assignment=false;
 SELECT * INTO STRICT onsite FROM public.event_venues WHERE venue_code='CAT_HOUSE_CAFE' AND active=true;
 SELECT id INTO STRICT coverage FROM public.location_groups WHERE eligible_custodial_coverage=true AND active=true ORDER BY group_code LIMIT 1;
 start_at:=(d+'10:00'::time) at time zone 'America/Chicago';end_at:=(d+'11:00'::time) at time zone 'America/Chicago';
 INSERT INTO public.events_app_events(event_name,event_scope,location_group_id,display_location,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,status,needs_review)
 VALUES('SYNTH_Q07_OFF_CAMPUS','OFFSITE',null,'Known outside venue',d,d,'10:00','11:00',start_at,end_at,'SCHEDULED',false) RETURNING * INTO event_row;
 IF event_row.location_group_id<>outside_group OR event_row.display_location<>'Known outside venue'
  OR cardinality(event_row.coverage_location_ids)<>0 OR cardinality(event_row.staffing_area_ids)<>0
  OR event_row.primary_venue_id IS NOT NULL OR cardinality(event_row.venue_ids)<>0 THEN
  RAISE EXCEPTION 'OFFSITE mapping lost outside venue or manufactured Zoo allocation';END IF;
 UPDATE public.events_app_events SET display_location='Updated known outside venue' WHERE id=event_row.id RETURNING * INTO event_row;
 IF event_row.location_group_id<>outside_group OR event_row.display_location<>'Updated known outside venue' THEN RAISE EXCEPTION 'OFFSITE update changed approved classification';END IF;
 BEGIN
  UPDATE public.events_app_events SET coverage_location_ids=ARRAY[coverage] WHERE id=event_row.id;
  RAISE EXCEPTION 'OFFSITE Zoo cleaning allocation accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  UPDATE public.events_app_events SET location_group_id=onsite.location_group_id WHERE id=event_row.id;
  RAISE EXCEPTION 'OFFSITE Zoo group accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  UPDATE public.events_app_events SET primary_venue_id=onsite.id,venue_ids=ARRAY[onsite.id] WHERE id=event_row.id;
  RAISE EXCEPTION 'OFFSITE Zoo venue accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO public.events_app_events(event_name,event_scope,primary_venue_id,venue_ids,location_group_id,display_location,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,status,needs_review)
 VALUES('SYNTH_Q07_ONSITE_UNCHANGED','SINGLE_VENUE',onsite.id,ARRAY[onsite.id],onsite.location_group_id,onsite.display_name,d,d,'10:00','11:00',start_at,end_at,'SCHEDULED',false) RETURNING * INTO event_row;
 IF event_row.location_group_id<>onsite.location_group_id OR event_row.primary_venue_id<>onsite.id OR event_row.event_scope<>'SINGLE_VENUE' THEN RAISE EXCEPTION 'onsite valid group changed';END IF;
END $offsite$;
SELECT 'Q07_OFFSITE_MAPPING_OUTSIDE_VENUE_NO_COVERAGE_ONSITE_PRESERVED_PASS';
ROLLBACK;
