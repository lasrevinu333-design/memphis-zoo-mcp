-- Main CLI-generated forward migration; PREPARED source facts only.
-- Frozen backend48ce2fc8f9755cc1d65aa3dc3b0f9712c7bbe1d6.
-- No solver replay, publication, writer, raw staging grant or physical claim.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE prepared_preview_inventory_before ON COMMIT DROP AS
 SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE prepared_preview_reader_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,prosrc,pg_get_functiondef(oid) definition
 FROM pg_proc WHERE oid='public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure;
CREATE TEMP TABLE prepared_preview_surface_before ON COMMIT DROP AS
 SELECT proowner,proacl,pg_get_functiondef(oid) definition FROM pg_proc
 WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $reader$
DECLARE target regprocedure:='public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure;
 old_body constant text:=$old_body$
declare command public.static_weekly_staffing_commands%rowtype;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null; end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
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
   'weeks',coalesce((select jsonb_agg(jsonb_build_object(
    'week_start',projection.service_date::text,
    'assignments',coalesce(projection.payload_json#>'{envelope,assignments}','[]'::jsonb),
    'lunch_responsibilities',coalesce(lunch.payload_json->'responsibilities','[]'::jsonb),
    'lunch_loans',coalesce(lunch.payload_json->'loans','[]'::jsonb)) order by projection.service_date)
   from public.static_weekly_staffing_staged_candidates projection
   left join public.static_weekly_staffing_staged_candidates lunch
    on lunch.operation_id=projection.operation_id and lunch.candidate_kind='lunch'
     and lunch.service_date=projection.service_date
   where projection.operation_id=command.operation_id and projection.candidate_kind='projection'),'[]'::jsonb))
   else null end);
end $old_body$;
 new_body constant text:=$new_body$
declare command public.static_weekly_staffing_commands%rowtype;
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
    'sourceDigest',case when jsonb_typeof(envelope#>'{authority,inputDigest}')='string'
     and envelope#>>'{authority,inputDigest}'~'^[a-f0-9]{64}$' then envelope#>'{authority,inputDigest}' else null end,
    'sourceDigestBasis','envelope.authority.inputDigest',
    'geographyDigest',case when jsonb_typeof(envelope#>'{authority,compilerInput,proximity}')='array'
     then public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput,proximity}') else null end,
    'geographyDigestBasis','envelope.authority.compilerInput.proximity');
   if octet_length(prepared_week::text)>4194304 then raise exception using errcode='54000',message='prepared preview week byte bound exceeded';end if;
   preview_weeks:=preview_weeks||jsonb_build_array(prepared_week);
   if octet_length(preview_weeks::text)>16777216 then raise exception using errcode='54000',message='prepared preview total byte bound exceeded';end if;
  end loop;
 end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
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
end $new_body$;
 definition text;
BEGIN
 SELECT b.definition INTO STRICT definition FROM prepared_preview_reader_before b;
 IF public.static_weekly_digest_text(old_body)<>'b913416cec6ab2e31e062a87f69a8bdba1d8a45a3e86c7bc45ec7549c6fd063e'
  OR (SELECT prosrc FROM prepared_preview_reader_before) IS DISTINCT FROM old_body
  OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1
  OR (SELECT count(*) FROM prepared_preview_inventory_before WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target AND definition_sql=definition
   AND definition_sha256=public.static_weekly_digest_text(definition))<>1
  OR (SELECT count(*) FROM prepared_preview_inventory_before WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target
   AND definition_sql=public.custodial_release_authority_current_grant_definition(object_identity)
   AND definition_sha256=public.static_weekly_digest_text(definition_sql))<>1
  OR NOT has_function_privilege('static_weekly_control_plane',target,'EXECUTE')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','custodial_application_reader','static_weekly_release_operator']) role_name
   WHERE has_function_privilege(role_name,target,'EXECUTE'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Prepared preview exact reader/source/ACL/inventory predecessor changed';END IF;
 EXECUTE replace(definition,old_body,new_body);
 IF (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_body
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proowner FROM prepared_preview_reader_before)
  OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM (SELECT proacl FROM prepared_preview_reader_before)
 THEN RAISE EXCEPTION 'Prepared preview owner/ACL/body changed beyond the exact DTO extension';END IF;
END $reader$;

-- Existing function canary entry remains exact. Add only its grant entry if
-- the historical function-only surface lacks it; do not duplicate entries.
DO $canary$
DECLARE target regprocedure:='public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure;
 definition text;patched text;identity text;
BEGIN
 SELECT b.definition INTO STRICT definition FROM prepared_preview_surface_before b;
 IF (SELECT count(*) FROM prepared_preview_inventory_before WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=definition AND definition_sha256=public.static_weekly_digest_text(definition))<>1
  OR EXISTS(SELECT 1 FROM prepared_preview_inventory_before WHERE definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='function'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)<>1
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target)>1
 THEN RAISE EXCEPTION 'Prepared preview exact canary predecessor changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.custodial_release_canary_authority_surface() WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target) THEN
  IF (length(definition)-length(replace(definition,'  values','')))/length('  values')<>1 THEN
   RAISE EXCEPTION 'Prepared preview canary VALUES seam changed';END IF;
  SELECT object_identity INTO STRICT identity FROM prepared_preview_inventory_before WHERE object_kind='grant'
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)=target;
  patched:=replace(definition,'  values','  values'||E'\n'||'(''grant'','||quote_literal(identity)||',''existing CP-only prepared staffing read; no raw staged access''),');
  EXECUTE patched;
  IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched THEN
   RAISE EXCEPTION 'Prepared preview canary changed outside its exact grant entry';END IF;
 END IF;
 IF (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT proowner FROM prepared_preview_surface_before)
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT proacl FROM prepared_preview_surface_before) THEN
  RAISE EXCEPTION 'Prepared preview canary owner/ACL changed';END IF;
END $canary$;

ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE target regprocedure;changed integer;BEGIN
 FOREACH target IN ARRAY ARRAY['public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure,
  'public.custodial_release_canary_authority_surface()'::regprocedure] LOOP
  UPDATE public.custodial_release_authority_restore_inventory i SET definition_sql=pg_get_functiondef(target),
   definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(target)),captured_at=statement_timestamp()
   WHERE i.object_kind='function' AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=target
    AND i.definition_sql=(SELECT old.definition_sql FROM prepared_preview_inventory_before old WHERE old.inventory_id=i.inventory_id);
  GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Prepared preview exact recovery row missing/duplicated';END IF;
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>(SELECT count(*) FROM prepared_preview_inventory_before)
  OR EXISTS(SELECT old.* FROM prepared_preview_inventory_before old WHERE NOT(old.object_kind='function' AND old.object_identity LIKE '%(%'
   AND to_regprocedure(old.object_identity) IN('public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(now.object_kind='function' AND now.object_identity LIKE '%(%'
   AND to_regprocedure(now.object_identity) IN('public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure,
    'public.custodial_release_canary_authority_surface()'::regprocedure)) EXCEPT SELECT * FROM prepared_preview_inventory_before)
  OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i WHERE i.object_kind='grant' AND i.object_identity LIKE '%(%'
   AND to_regprocedure(i.object_identity)='public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure
   AND i.definition_sql IS DISTINCT FROM public.custodial_release_authority_current_grant_definition(i.object_identity))
  OR (SELECT count(*) FROM public.custodial_release_canary_authority_surface() WHERE object_kind IN('function','grant')
   AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.static_weekly_v10_read_staffing_command(uuid,uuid)'::regprocedure)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Prepared preview unrelated inventory/ACL/canary/final ALWAYS scope changed';END IF;
END $scope$;
COMMIT;
