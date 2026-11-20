-- CLI created this migration at actual UTC 20261003050234, then its new,
-- empty file alone was relocated to the reserved forward ordering slot
-- 20261003230000. No preceding migration is changed.
-- Keep the existing private v9 validator, all derivation checks and ACLs.
-- The source-bound optional named handoff must also match an actual dated,
-- eligible, directed-proximity-valid segment in the unchanged derivation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public,extensions;

do $named_handoff$
declare
  identity constant text:='public.static_weekly_v9_assert_shift_end_derivation(jsonb)';
  prior_definition text;
  next_definition text;
  prior_grant text;
  next_grant text;
  old_policy constant text:=$old_policy$
 perform public.static_weekly_assert_exact_object(policy,
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],'shift-end source policy');$old_policy$;
  new_policy constant text:=$new_policy$
 perform public.static_weekly_assert_exact_object(policy,
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest'],
  array['schema','algorithm','normalPhaseStart','weights','provenance','policyDigest','namedHandoffs'],'shift-end source policy');
 if policy ? 'namedHandoffs' then
  if jsonb_typeof(policy->'namedHandoffs') is distinct from 'array' then
   raise exception using errcode='23514',message='shift-end named handoffs must be one array';
  end if;
  if jsonb_array_length(policy->'namedHandoffs')>14 then
   raise exception using errcode='23514',message='shift-end named handoffs exceed the source bound';
  end if;
 end if;$new_policy$;
  old_declare constant text:=' minute_samples integer:=0; location_samples integer:=0; location_count integer; span integer;';
  new_declare constant text:=$new_declare$ minute_samples integer:=0; location_samples integer:=0; location_count integer; span integer;
 named jsonb; named_parent jsonb; named_chain jsonb; named_from jsonb; named_to jsonb; named_to_availability jsonb;
 named_parent_id text; named_key text; named_seen text[]:='{}';$new_declare$;
  old_postcheck constant text:=' -- OPEN may retain a stable baseline position, never a fictitious execution';
  new_postcheck constant text:=$new_postcheck$
 -- A policy string alone never authorizes a new recipient. Every named
 -- handoff must occur exactly once in the already-validated immutable
 -- parent chain, at the departing source worker's actual shift end, with a
 -- real eligible/on-duty recipient and all required directed edges. The
 -- accepted six-key historical policy follows this block without change.
 for named in select value from jsonb_array_elements(coalesce(policy->'namedHandoffs','[]'::jsonb)) loop
  perform public.static_weekly_assert_exact_object(named,
   array['dayOfWeek','locationCode','at','fromSlotId','toSlotId','source'],
   array['dayOfWeek','locationCode','at','fromSlotId','toSlotId','source'],'shift-end named handoff');
  if (jsonb_typeof(named->'dayOfWeek')='number'
    and named->>'dayOfWeek' ~ '^[0-6]$'
    and jsonb_typeof(named->'locationCode')='string'
    and (policy->'weights') ? (named->>'locationCode')
    and jsonb_typeof(named->'at')='string'
    and named->>'at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and jsonb_typeof(named->'fromSlotId')='string'
    and named->>'fromSlotId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(named->'toSlotId')='string'
    and named->>'toSlotId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and named->>'fromSlotId'<>named->>'toSlotId'
    and jsonb_typeof(named->'source')='string'
    and length(named->>'source') between 10 and 300) is distinct from true then
   raise exception using errcode='23514',message='shift-end named handoff typed source identity invalid';
  end if;
  named_key:=(named->>'dayOfWeek')||':'||(named->>'locationCode')||':'||(named->>'at');
  if named_key=any(named_seen) then
   raise exception using errcode='23514',message='shift-end named handoff duplicated';
  end if;
  named_seen:=array_append(named_seen,named_key);
  select count(*),max(w->>'workId') into matches,named_parent_id
   from jsonb_array_elements(source#>'{version,assignments}') w
   where w->>'dayOfWeek'=named->>'dayOfWeek'
    and w->>'locationCodeSnapshot'=named->>'locationCode'
    and w#>>'{window,start}'='09:45';
  if matches<>1 then
   raise exception using errcode='23514',message='shift-end named parent source is not unique';
  end if;
  select w into named_parent from jsonb_array_elements(source#>'{version,assignments}') w
   where w->>'dayOfWeek'=named->>'dayOfWeek' and w->>'workId'=named_parent_id;
  select c into named_chain from jsonb_array_elements(receipt->'parentChains') c
   where c->>'dayOfWeek'=named->>'dayOfWeek' and c->>'parentWorkId'=named_parent_id;
  if named_chain is null then
   raise exception using errcode='23514',message='shift-end named parent chain absent';
  end if;
  select count(*) into matches
   from jsonb_array_elements(named_chain->'segments') with ordinality as s(segment,ordinal)
   where s.ordinal>1 and s.segment->>'kind'='handoff'
    and s.segment#>>'{window,start}'=named->>'at'
    and s.segment->>'ownerSlotId'=named->>'toSlotId'
    and (named_chain->'segments'->(s.ordinal::integer-2))->>'ownerSlotId'=named->>'fromSlotId'
    and (named_chain->'segments'->(s.ordinal::integer-2))#>>'{window,end}'=named->>'at';
  if matches<>1 then
   raise exception using errcode='23514',message='shift-end named handoff does not match exactly one derived segment';
  end if;
  select r into named_from from jsonb_array_elements(roster) r
   where r->>'dayOfWeek'=named->>'dayOfWeek' and r->>'slotId'=named->>'fromSlotId';
  select r into named_to from jsonb_array_elements(roster) r
   where r->>'dayOfWeek'=named->>'dayOfWeek' and r->>'slotId'=named->>'toSlotId';
  select a into named_to_availability from jsonb_array_elements(source#>'{version,slotAvailability}') a
   where a->>'dayOfWeek'=named->>'dayOfWeek' and a->>'slotId'=named->>'toSlotId';
  if (named_from->>'status'='working' and named_from->>'personId' is not null
    and named_from#>>'{shift,end}'=named->>'at'
    and named_to->>'status'='working' and named_to->>'personId' is not null
    and named_to#>>'{shift,start}'<=named->>'at'
    and named->>'at'<named_to#>>'{shift,end}'
    and not (named_to#>>'{lunch,start}'<=named->>'at' and named->>'at'<named_to#>>'{lunch,end}')
    and (named_to_availability->'qualifications') @> (named_parent->'requiredQualifications')
    and not ((named_parent->'restrictedSlotIds') ? (named->>'toSlotId'))
    and not exists(select 1 from jsonb_array_elements(case
      when jsonb_array_length(named_parent->'includedLocations')>0 then named_parent->'includedLocations'
      else jsonb_build_array(jsonb_build_object('locationId',named_parent->'locationId')) end) target
      where (named_to_availability->'restrictions') ? (target->>'locationId'))
  ) is distinct from true then
   raise exception using errcode='23514',message='shift-end named handoff source or recipient is not current and eligible';
  end if;
  -- The JS source-derived selector requires a verified directed edge from
  -- at least one exact current-source target-position anchor to every member.
  -- Normal owned members take precedence; only a position owning no normal
  -- row may use its explicit accepted route anchor.
  with anchors as (
   select l->>'locationId' id from jsonb_array_elements(source#>'{version,assignments}') w
    cross join lateral jsonb_array_elements(case when jsonb_array_length(w->'includedLocations')>0
      then w->'includedLocations' else jsonb_build_array(jsonb_build_object('locationId',w->'locationId')) end) l
    where w->>'dayOfWeek'=named->>'dayOfWeek' and w->>'ownerSlotId'=named->>'toSlotId'
     and w#>>'{window,start}'='09:45'
   union all
   select named_to_availability->>'acceptedRouteAnchorLocationId'
    where not exists(select 1 from jsonb_array_elements(source#>'{version,assignments}') w
      where w->>'dayOfWeek'=named->>'dayOfWeek' and w->>'ownerSlotId'=named->>'toSlotId'
       and w#>>'{window,start}'='09:45')
  ), targets as (
   select l->>'locationId' id from jsonb_array_elements(case
     when jsonb_array_length(named_parent->'includedLocations')>0 then named_parent->'includedLocations'
     else jsonb_build_array(jsonb_build_object('locationId',named_parent->'locationId')) end) l
  )
  select count(*) into matches from targets target where not exists(
   select 1 from anchors anchor where anchor.id is not null and
    (anchor.id=target.id or exists(select 1 from jsonb_array_elements(source->'proximity') edge
      where edge->>'fromLocationId'=anchor.id and edge->>'toLocationId'=target.id
       and edge->'verified'='true'::jsonb and jsonb_typeof(edge->'minutes')='number'
       and (edge->>'minutes')::numeric>=0 and (edge->>'minutes')::numeric=trunc((edge->>'minutes')::numeric)
       and nullif(edge->>'provenance','') is not null)));
  if matches<>0 then
   raise exception using errcode='23514',message='shift-end named handoff lacks verified directed source proximity';
  end if;
 end loop;
 -- OPEN may retain a stable baseline position, never a fictitious execution$new_postcheck$;
  changed integer;
  expected_rows integer;
  expected_grants integer;
begin
  prior_definition:=pg_get_functiondef(identity::regprocedure);
  prior_grant:=public.custodial_release_authority_current_grant_definition(identity);
  if prior_definition is null or prior_grant is null then
   raise exception 'Named handoff predecessor function/grant unavailable';
  end if;
  if exists(select 1 from public.custodial_release_authority_restore_inventory i
    where i.object_kind in ('function','grant')
      and position('(' in i.object_identity)>0
      and to_regprocedure(i.object_identity)=identity::regprocedure
      and (i.definition_sql is distinct from case i.object_kind when 'function' then prior_definition
       else public.custodial_release_authority_current_grant_definition(i.object_identity) end
       or i.definition_sha256 is distinct from public.static_weekly_digest_text(i.definition_sql))) then
   raise exception 'Named handoff recovery predecessor changed';
  end if;
  select count(*) into expected_rows from public.custodial_release_authority_restore_inventory i
   where i.object_kind='function' and position('(' in i.object_identity)>0
    and to_regprocedure(i.object_identity)=identity::regprocedure;
  if expected_rows<1 then raise exception 'Named handoff function recovery predecessor missing';end if;
  select count(*) into expected_grants from public.custodial_release_authority_restore_inventory i
   where i.object_kind='grant' and position('(' in i.object_identity)>0
    and to_regprocedure(i.object_identity)=identity::regprocedure;
  if expected_grants<1 then raise exception 'Named handoff grant recovery predecessor missing';end if;
  if (length(prior_definition)-length(replace(prior_definition,old_policy,'')))<>length(old_policy)
    or (length(prior_definition)-length(replace(prior_definition,old_declare,'')))<>length(old_declare)
    or (length(prior_definition)-length(replace(prior_definition,old_postcheck,'')))<>length(old_postcheck) then
   raise exception 'Named handoff exact validator predecessor seam changed';
  end if;
  next_definition:=replace(replace(replace(prior_definition,old_policy,new_policy),old_declare,new_declare),
   old_postcheck,new_postcheck);
  execute next_definition;
  if pg_get_functiondef(identity::regprocedure) is distinct from next_definition then
   raise exception 'Named handoff validator definition did not install exactly';
  end if;
  -- CREATE OR REPLACE preserves privileges. Explicitly reject any accidental
  -- public or runtime EXECUTE; no new grant is required for owner-to-owner use.
  next_grant:=public.custodial_release_authority_current_grant_definition(identity);
  if next_grant is distinct from prior_grant
    or has_function_privilege('anon',identity,'EXECUTE')
    or has_function_privilege('authenticated',identity,'EXECUTE')
    or has_function_privilege('service_role',identity,'EXECUTE')
    or has_function_privilege('static_weekly_control_plane',identity,'EXECUTE')
    or has_function_privilege('static_weekly_release_operator',identity,'EXECUTE')
    or has_function_privilege('custodial_application_reader',identity,'EXECUTE') then
   raise exception 'Named handoff private validator ACL changed';
  end if;
  -- This pre-existing private helper is inventoried and called by the
  -- compiler-authority validator; the canary surface does not name each
  -- internal helper individually. Its callable dependency remains unchanged.
  if position('static_weekly_v9_assert_shift_end_derivation(p_authority)' in
    pg_get_functiondef('public.static_weekly_assert_compiler_authority(jsonb,jsonb,date,boolean)'::regprocedure))=0 then
   raise exception 'Named handoff compiler authority dependency changed';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
   raise exception 'Named handoff recovery inventory immutability unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory
   disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  update public.custodial_release_authority_restore_inventory i
   set definition_sql=pg_get_functiondef(identity::regprocedure),
    definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(identity::regprocedure)),
    captured_at=statement_timestamp()
   where i.object_kind='function' and position('(' in i.object_identity)>0
    and to_regprocedure(i.object_identity)=identity::regprocedure and i.definition_sql=prior_definition;
  get diagnostics changed=row_count;
  if changed<>expected_rows then raise exception 'Named handoff function recovery update count changed';end if;
  update public.custodial_release_authority_restore_inventory i
   set definition_sql=public.custodial_release_authority_current_grant_definition(i.object_identity),
    definition_sha256=public.static_weekly_digest_text(public.custodial_release_authority_current_grant_definition(i.object_identity)),
    captured_at=statement_timestamp()
   where i.object_kind='grant' and position('(' in i.object_identity)>0
    and to_regprocedure(i.object_identity)=identity::regprocedure;
  get diagnostics changed=row_count;
  if changed<>expected_grants then raise exception 'Named handoff grant recovery update count changed';end if;
  alter table public.custodial_release_authority_restore_inventory
   enable trigger trg_custodial_release_authority_restore_inventory_immutable;
  if exists(select 1 from public.custodial_release_authority_restore_inventory i
    where i.object_kind in ('function','grant') and position('(' in i.object_identity)>0
      and to_regprocedure(i.object_identity)=identity::regprocedure
      and (i.definition_sql is distinct from case i.object_kind when 'function'
        then pg_get_functiondef(identity::regprocedure)
        else public.custodial_release_authority_current_grant_definition(i.object_identity) end
       or i.definition_sha256 is distinct from public.static_weekly_digest_text(i.definition_sql))) then
   raise exception 'Named handoff recovery postflight drift';
  end if;
end $named_handoff$;
commit;
