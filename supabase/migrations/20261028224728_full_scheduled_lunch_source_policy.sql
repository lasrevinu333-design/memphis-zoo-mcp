-- Full scheduled-lunch coverage is opted into by the immutable compiler
-- source, never a request flag. Original duty intersections remain separate
-- anchors, with unchanged work/person/location/qualification checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $full_lunch$
declare body text;seam record;old text;new text;before_acl text;identity text;
begin
 foreach identity in array array[
  'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
  'public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)',
  'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
  'public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)'] loop
  before_acl:=public.custodial_release_authority_current_grant_definition(identity);
  execute format('alter function %s set plan_cache_mode=force_generic_plan',identity);
  if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
   raise exception 'draft RPC ACL changed: %',identity;end if;
 end loop;
 -- These validators inspect opaque, production-sized JSON parameters. A
 -- value-specific SPI plan can retain many copies of a complete authority
 -- while folding its immutable checks. Reuse parameterized plans locally;
 -- every validator expression, size bound and admission check still runs.
 identity:='public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 alter function public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)
  set plan_cache_mode=force_generic_plan;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'compiler validator ACL changed';end if;
 -- Source binding changes only one UUID. Comparing full rows through JSON
 -- expands both complete draft documents unnecessarily. A typed row copy
 -- masks that same UUID and compares every remaining column, including any
 -- later-added columns, with exact NULL-aware equality. The guard remains
 -- installed and its other transition rules are unchanged.
 identity:='public.static_weekly_version_guard()';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 for seam in select * from (values
 ($old$AS $function$
begin$old$,
  $new$AS $function$
declare source_comparison public.weekly_schedule_versions%rowtype;
begin$new$),
 ($old$  if old.lifecycle_state='draft' and current_setting('app.static_weekly_source_bind',true)='on' and old.authority_source_id is null and new.authority_source_id is not null and (to_jsonb(new)-'authority_source_id')=(to_jsonb(old)-'authority_source_id') then return new; end if;$old$,
  $new$  if old.lifecycle_state='draft' and current_setting('app.static_weekly_source_bind',true)='on' and old.authority_source_id is null and new.authority_source_id is not null then
    source_comparison:=new;
    source_comparison.authority_source_id:=old.authority_source_id;
    if source_comparison is not distinct from old then return new; end if;
  end if;$new$)
 ) changes(old,new) loop
  if length(body)-length(replace(body,seam.old,''))<>length(seam.old) then raise exception 'exact version guard predecessor mismatch';end if;
  body:=replace(body,seam.old,seam.new);
 end loop;
 execute body;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'version guard ACL changed';end if;
 -- Remove excluded top-level keys in one traversal. Retain only the
 -- published compiler input needed for the exact source comparison, rather
 -- than a second complete signed draft. No identity or admission rule moves.
 identity:='public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 for seam in select * from (values
  ($old$(p_envelope-'attestation')-'database_projection_identity'$old$,
   $new$p_envelope-array['attestation','database_projection_identity']$new$),
  ($old$select v.draft_document into v_document$old$,
   $new$select v.draft_document#>'{authority,compilerInput}' into v_document$new$),
  ($old$public.static_weekly_v5_projection_source_identity(v_document#>'{authority,compilerInput}')$old$,
   $new$public.static_weekly_v5_projection_source_identity(v_document)$new$),
  ($old$p_envelope-'semantic_snapshot'-'attestation'$old$,
   $new$p_envelope-array['semantic_snapshot','attestation']$new$)
 ) changes(old,new) loop
  if length(body)-length(replace(body,seam.old,''))<>length(seam.old) then raise exception 'exact projection identity predecessor mismatch';end if;
  body:=replace(body,seam.old,seam.new);
 end loop;
 execute body;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'projection identity validator ACL changed';end if;
 identity:='public.static_weekly_v8_assert_lunch_document(uuid,jsonb)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 for seam in select * from (values
 ($old$ projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;$old$,
  $new$ projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;
 full_hour_policy jsonb;full_hour boolean;planned_loan jsonb;normal_segment_window jsonb;$new$),
 ($old$ projection_work:=projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}';$old$,
  $new$ projection_work:=projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}';
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
 end if;$new$),
 ($old$  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop$old$,
  $new$  if full_hour then
   select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
    where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
  end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop$new$),
 ($old$   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations'],array['planWorkId','workId','serviceMode','window','includedLocations'],'lunch segment');$old$,
  $new$   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,'lunch segment');$new$),
 ($old$   if (segment#>>'{window,start}')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (segment#>>'{window,end}')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;$old$,
  $new$   normal_segment_window:=case when full_hour then segment->'normalWindow' else segment->'window' end;
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
   end if;$new$),
 ($old$ -- Account for every normal flexible duty that intersects each scheduled lunch.$old$,
  $new$ if full_hour then
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
 -- Account for every normal flexible duty that intersects each scheduled lunch.$new$)
 ) replacements(old_body,new_body) loop
  if length(body)-length(replace(body,seam.old_body,''))<>length(seam.old_body) then
   raise exception 'exact full lunch validator predecessor mismatch: %',left(seam.old_body,100);end if;
  body:=replace(body,seam.old_body,seam.new_body);
 end loop;
 execute body;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'full lunch validator ACL changed';end if;

 -- The reader emits full coverage, but joins against the retained original
 -- intersection. It still verifies the exact occurrence, owner and members.
 identity:='public.static_weekly_v8_read_lunch_segments_dated_base(date)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 old:=$old$  and o.coverage_start<=(s#>>'{window,start}')::time
  and o.coverage_end>=(s#>>'{window,end}')::time$old$;
 new:=$new$  and o.coverage_start<=coalesce(s#>>'{normalWindow,start}',s#>>'{window,start}')::time
  and o.coverage_end>=coalesce(s#>>'{normalWindow,end}',s#>>'{window,end}')::time$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact full lunch reader predecessor mismatch';end if;
 execute replace(body,old,new);
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'full lunch reader ACL changed';end if;

 -- Reassign each CURRENT physical duty piece, including the 09:45 successor,
 -- rather than extending or inventing the donor's old occurrence. Multiple
 -- anchors/loans for the same accepted helper collapse only in this routing
 -- view; the immutable loan and occurrence histories remain separate.
 identity:='public.custodial_operational_location_assignments(date)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 old:=$old$    select * from public.static_weekly_v8_read_lunch_segments(p_service_date)
    where service_mode='scan_tracked'$old$;
 new:=$new$    select segment.*,coalesce((select p.projection_envelope#>>'{authority,compilerInput,version,lunchCoveragePolicy,schema}'
      ='memphis-zoo.static-weekly-full-hour-lunch-policy.v1'
      from public.weekly_schedule_compiled_projections p where p.projection_id=segment.projection_id),false) full_scheduled_lunch
    from public.static_weekly_v8_read_lunch_segments(p_service_date) segment where segment.service_mode='scan_tracked'$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact full lunch routing source predecessor mismatch';end if;
 body:=replace(body,old,new);
 old:=$old$on l.normal_occurrence_id=b.occurrence_id and b.location_id=any(l.included_location_ids)$old$;
 new:=$new$on (l.normal_occurrence_id=b.occurrence_id or (l.full_scheduled_lunch and l.projection_id=b.projection_id))
       and b.location_id=any(l.included_location_ids)$new$;
 if length(body)-length(replace(body,old,''))<>2*length(old) then raise exception 'exact full lunch routing boundary predecessor mismatch';end if;
 body:=replace(body,old,new);
 old:=$old$  left join lunch l on l.normal_occurrence_id=b.occurrence_id
    and b.location_id=any(l.included_location_ids) and p.starts>=l.coverage_start and p.ends<=l.coverage_end$old$;
 new:=$new$  left join lateral (select candidate.* from lunch candidate
    where (candidate.normal_occurrence_id=b.occurrence_id or (candidate.full_scheduled_lunch and candidate.projection_id=b.projection_id))
      and b.location_id=any(candidate.included_location_ids) and p.starts>=candidate.coverage_start and p.ends<=candidate.coverage_end
    order by candidate.loan_id,candidate.responsibility_id,candidate.normal_occurrence_id limit 1) l on true$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact full lunch routing join predecessor mismatch';end if;
 execute replace(body,old,new);
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'full lunch routing ACL changed';end if;

 -- The paired closing map already exists in the maintained JS authoring and
 -- dated derivation paths. Admit its exact source shape only together with
 -- SQL validation of all seven contiguous plans, real roster/eligibility,
 -- directed proximity and the complete effective parent-chain ownership.
 identity:='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
 before_acl:=public.custodial_release_authority_current_grant_definition(identity);
 body:=pg_get_functiondef(to_regprocedure(identity));
 old:=$old$array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest','namedHandoffs'],'shift-end source policy');$old$;
 new:=$new$array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest','namedHandoffs','plannedClosingOwnership'],'shift-end source policy');$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact planned closing policy predecessor mismatch';end if;
 body:=replace(body,old,new);
 old:=$old$ minute_samples integer:=0; location_samples integer:=0; location_count integer; span integer;$old$;
 new:=old||E'\n planned_day text;planned_stages jsonb;planned_stage jsonb;planned_parent jsonb;planned_person jsonb;planned_availability jsonb;planned_families jsonb;planned_previous time;planned_last time;planned_start time;planned_end time;planned_coverage interval;planned_valid_edges jsonb;';
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact planned closing declarations predecessor mismatch';end if;
 body:=replace(body,old,new);
 old:=$old$ -- OPEN may retain a stable baseline position, never a fictitious execution$old$;
 new:=$new$ if policy ? 'plannedClosingOwnership' then
  if jsonb_typeof(policy->'plannedClosingOwnership') is distinct from 'object'
   or (select jsonb_agg(k order by k) from jsonb_object_keys(policy->'plannedClosingOwnership') k)
     is distinct from '["0","1","2","3","4","5","6"]'::jsonb then
   raise exception 'planned closing source must bind all seven days';end if;
  -- Index the same verified directed edges once. Expanding the complete
  -- proximity graph again for every inherited physical member needlessly
  -- materializes it hundreds of times for a complete weekly schedule.
  select coalesce(jsonb_object_agg(jsonb_build_array(e->>'fromLocationId',e->>'toLocationId')::text,true),'{}'::jsonb)
   into planned_valid_edges from jsonb_array_elements(source->'proximity') e
   where e->'verified'='true'::jsonb and jsonb_typeof(e->'minutes')='number'
    and (e->>'minutes')::numeric>=0 and (e->>'minutes')::numeric=trunc((e->>'minutes')::numeric)
    and nullif(e->>'provenance','') is not null;
  for planned_day,planned_stages in select * from jsonb_each(policy->'plannedClosingOwnership') loop
   if jsonb_typeof(planned_stages) is distinct from 'array' or jsonb_array_length(planned_stages) not between 1 and 8
    then raise exception 'planned closing stages must be bounded';end if;
   select min((r#>>'{shift,end}')::time),max((r#>>'{shift,end}')::time) into planned_previous,planned_last
    from jsonb_array_elements(roster) r where r->>'dayOfWeek'=planned_day and r->>'status'='working'
     and r->'vacant'='false'::jsonb and r->>'personId' is not null;
   if planned_previous is null or planned_previous<='09:45'::time then raise exception 'planned closing needs a real afternoon roster';end if;
   select jsonb_agg(code order by code) into planned_families from
    (select distinct w->>'locationCodeSnapshot' code from jsonb_array_elements(source#>'{version,assignments}') w
     where w->>'dayOfWeek'=planned_day and w#>>'{window,start}'='09:45') f;
   if planned_families is null then raise exception 'planned closing normal families missing';end if;
   -- Before the first departure every family retains its normal source owner.
   if exists(select 1 from jsonb_array_elements(source#>'{version,assignments}') p
    join jsonb_array_elements(effective#>'{version,assignments}') w on w->'dayOfWeek'=p->'dayOfWeek'
     and w->'locationCodeSnapshot'=p->'locationCodeSnapshot'
    where p->>'dayOfWeek'=planned_day and p#>>'{window,start}'='09:45'
     and (w#>>'{window,start}')::time<planned_previous and (w#>>'{window,end}')::time>'09:45'::time
     and w->'ownerSlotId' is distinct from p->'ownerSlotId') then raise exception 'planned closing changed pre-departure ownership';end if;
   for planned_stage in select value from jsonb_array_elements(planned_stages) loop
    perform public.static_weekly_assert_exact_object(planned_stage,array['start','end','owners'],array['start','end','owners'],'planned closing stage');
    perform public.static_weekly_v3_assert_window(planned_stage-'owners','planned closing interval');
    planned_start:=(planned_stage->>'start')::time;planned_end:=(planned_stage->>'end')::time;
    if planned_start<>planned_previous or planned_end>planned_last or jsonb_typeof(planned_stage->'owners') is distinct from 'object'
     or (select jsonb_agg(k order by k) from jsonb_object_keys(planned_stage->'owners') k) is distinct from planned_families
     then raise exception 'planned closing stages must cover every family without gaps';end if;
    for planned_parent in select w from jsonb_array_elements(source#>'{version,assignments}') w
      where w->>'dayOfWeek'=planned_day and w#>>'{window,start}'='09:45' loop
     key:=planned_stage#>>array['owners',planned_parent->>'locationCodeSnapshot'];
     select r into planned_person from jsonb_array_elements(roster) r where r->>'dayOfWeek'=planned_day and r->>'slotId'=key;
     select a into planned_availability from jsonb_array_elements(source#>'{version,slotAvailability}') a
      where a->>'dayOfWeek'=planned_day and a->>'slotId'=key;
     if planned_person is null or planned_availability is null or planned_person->>'status'<>'working'
      or planned_person->>'personId' is null or planned_person->'vacant' is distinct from 'false'::jsonb
      or (planned_person#>>'{shift,start}')::time>planned_start or (planned_person#>>'{shift,end}')::time<planned_end
      or ((planned_person#>>'{lunch,start}')::time<planned_end and planned_start<(planned_person#>>'{lunch,end}')::time)
      or (planned_parent->'restrictedSlotIds') ? key
      or not ((planned_availability->'qualifications') @> (planned_parent->'requiredQualifications'))
      or exists(select 1 from jsonb_array_elements(planned_parent->'includedLocations') loc
       where (planned_availability->'restrictions') ? (loc->>'locationId'))
      then raise exception 'planned closing recipient is absent, off duty, restricted or unqualified';end if;
     if exists(select 1 from jsonb_array_elements(effective#>'{version,assignments}') w
      where w->>'dayOfWeek'=planned_day and w->'locationCodeSnapshot'=planned_parent->'locationCodeSnapshot'
       and (w#>>'{window,start}')::time<planned_end and planned_start<(w#>>'{window,end}')::time
       and w->>'ownerSlotId' is distinct from key) then raise exception 'derived closing owner differs from exact source plan';end if;
     select coalesce(sum(least((w#>>'{window,end}')::time,planned_end)-greatest((w#>>'{window,start}')::time,planned_start)),interval '0')
      into planned_coverage from jsonb_array_elements(effective#>'{version,assignments}') w
      where w->>'dayOfWeek'=planned_day and w->'locationCodeSnapshot'=planned_parent->'locationCodeSnapshot'
       and (w#>>'{window,start}')::time<planned_end and planned_start<(w#>>'{window,end}')::time;
     if planned_coverage<>planned_end-planned_start then raise exception 'derived closing responsibility has a gap or overlap';end if;
     with anchors as (
      select l->>'locationId' id from jsonb_array_elements(source#>'{version,assignments}') w
       cross join lateral jsonb_array_elements(case when jsonb_array_length(w->'includedLocations')>0 then w->'includedLocations'
        else jsonb_build_array(jsonb_build_object('locationId',w->'locationId')) end) l
       where w->>'dayOfWeek'=planned_day and w->>'ownerSlotId'=key and w#>>'{window,start}'='09:45'
      union all select planned_availability->>'acceptedRouteAnchorLocationId' where not exists(
       select 1 from jsonb_array_elements(source#>'{version,assignments}') w
        where w->>'dayOfWeek'=planned_day and w->>'ownerSlotId'=key and w#>>'{window,start}'='09:45')
     ), targets as (select l->>'locationId' id from jsonb_array_elements(case when jsonb_array_length(planned_parent->'includedLocations')>0
       then planned_parent->'includedLocations' else jsonb_build_array(jsonb_build_object('locationId',planned_parent->'locationId')) end) l)
     select count(*) into matches from targets t where not exists(select 1 from anchors a where a.id is not null
      and (a.id=t.id or planned_valid_edges ? jsonb_build_array(a.id,t.id)::text));
     if matches<>0 then raise exception 'planned closing lacks verified directed source proximity';end if;
    end loop;
    planned_previous:=planned_end;
   end loop;
   if planned_previous is distinct from planned_last then raise exception 'planned closing must reach final staffed departure';end if;
  end loop;
 end if;
 -- OPEN may retain a stable baseline position, never a fictitious execution$new$;
 if length(body)-length(replace(body,old,''))<>length(old) then raise exception 'exact planned closing final validation predecessor mismatch';end if;
 execute replace(body,old,new);
 alter function public.static_weekly_v9_assert_shift_end_derivation(jsonb)
  set plan_cache_mode=force_generic_plan;
 if public.custodial_release_authority_current_grant_definition(identity) is distinct from before_acl then
  raise exception 'planned closing validator ACL changed';end if;
end $full_lunch$;

-- Existing functions and grants only. Keep exact recovery and ALWAYS guards.
alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$ declare identity text;definition text;changed integer;begin
 foreach identity in array array['public.static_weekly_v8_assert_lunch_document(uuid,jsonb)',
  'public.static_weekly_v8_read_lunch_segments_dated_base(date)','public.custodial_operational_location_assignments(date)',
  'public.static_weekly_v9_assert_shift_end_derivation(jsonb)',
  'public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)',
  'public.static_weekly_version_guard()',
  'public.static_weekly_assert_projection_envelope_attested(jsonb,uuid,date,jsonb)',
  'public.static_weekly_v3_create_draft(date,text,jsonb,jsonb,jsonb,bigint,uuid,text,uuid)',
  'public.static_weekly_v3_update_draft(uuid,jsonb,jsonb,jsonb,bigint,bigint,uuid,text)',
  'public.static_weekly_v3_publish_draft(uuid,bigint,bigint,uuid,text,text,uuid)',
  'public.static_weekly_v3_materialize_projection(uuid,date,text,text,jsonb,jsonb,text,jsonb,bigint,uuid,text)'] loop
  definition:=pg_get_functiondef(to_regprocedure(identity));
  update public.custodial_release_authority_restore_inventory i set definition_sql=definition,
   definition_sha256=public.static_weekly_digest_text(definition),captured_at=statement_timestamp()
   where i.object_kind='function' and to_regprocedure(i.object_identity)=to_regprocedure(identity);
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'full lunch exact recovery row missing/duplicated: %',identity;end if;
 end loop;
end $recovery$;
alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
commit;
