-- UNACTIVATED isolated prototype. Main owns SQL admission and registry recipe.
-- Exact retained pg_dump SHA256:
-- a55d04c7c5ef24e5824bc1ac806990e59db23ec900841b5d66df93df523a44dc
-- Original registry member SHA256:
-- 5f1c651ea94ba9d938e07894e1c0fe375286cb139bfe744b4d571370d8de7f12
-- No BEGIN/COMMIT: preserve the caller's SAME original transaction/fence.
-- No registry writes, grants, owner changes, trigger switches or generic
-- allowlist changes. One DO statement either checks/replaces all FIVE or fails.
-- Task7's invoker matcher must be independently source-pinned by Main before
-- execution. This proposal does not create or substitute that dependency.
DO $immutable_event_restore$
DECLARE
  owner_oid oid;
  relation_oid oid;
  helper_oid oid;
  function_oid oid;
  profile jsonb;
  checked jsonb := '[]'::jsonb;
  original pg_catalog.pg_proc%rowtype;
  after_row pg_catalog.pg_proc%rowtype;
  before_definition text;
  after_definition text;
  after_body text;
  insertion_point constant text := E'\nbegin\n';
  restore_branch constant text := $original_event_branch$  -- ORIGINAL restore DATA only; not event publication or manager authority.
  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'BEFORE'
    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'events_app_events' then
    if TG_RELID = pg_catalog.to_regclass('public.events_app_events')
      and current_user = session_user and current_user = 'supabase_admin'
      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then
      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then
        return NEW;
      end if;
    end if;
  end if;
$original_event_branch$;
  profiles constant jsonb := $original_event_profiles$
[
  {
    "identity": "public.app_event_place_admission_guard()",
    "before_definition": "CREATE OR REPLACE FUNCTION public.app_event_place_admission_guard()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare v_authority jsonb;\nbegin\n  if new.status='SCHEDULED' and coalesce(new.needs_review,false)=false then\n    v_authority:=public.app_event_place_authority(to_jsonb(new),clock_timestamp());\n    if (v_authority->>'admissible')::boolean is not true then\n      raise exception using errcode='40901',message='Event venue mapping is inactive or requires manager review; refresh the venue before scheduling.',\n        detail=v_authority::text;\n    end if;\n  end if;\n  return new;\nend $function$\n",
    "before_definition_sha256": "5b0a58f76a2b77ae50dccd7407657c5601738c6536e612246f1a840169155bb7",
    "before_prosrc_sha256": "ab7403d101fadf9b47533056b3f48349cc2555835a08485910520577fef446d2",
    "after_prosrc_sha256": "d83412f5449650855c649a4cd560f5f054ca881b0f759039ee456025b41bb14b",
    "after_definition_sha256": "2696f90f9a958977887e6d91a94eaf6f413fcda890161d97d7a87fbf56d11a16"
  },
  {
    "identity": "public.app_event_supersession_guard()",
    "before_definition": "CREATE OR REPLACE FUNCTION public.app_event_supersession_guard()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  if tg_op='INSERT' then\n    if new.status='SUPERSEDED' then raise exception using errcode='42501',message='new event cannot be born superseded'; end if;\n    return new;\n  end if;\n  if tg_op='DELETE' then\n    if old.status='SUPERSEDED' then raise exception using errcode='42501',message='superseded event history cannot be deleted'; end if;\n    return old;\n  end if;\n  if old.status='SUPERSEDED' and new is distinct from old then\n    raise exception using errcode='42501',message='superseded event history is immutable';\n  end if;\n  if old.status<>'SUPERSEDED' and new.status='SUPERSEDED'\n    and current_setting('app.event_supersession_command',true) is distinct from 'on' then\n    raise exception using errcode='42501',message='named manager supersession command is required';\n  end if;\n  return new;\nend $function$\n",
    "before_definition_sha256": "2c8e67a8a854642333a774c4d9c0f6a3af6912093e3fc29fd7adfd6bd6b622f0",
    "before_prosrc_sha256": "f2f56530a687ea183ef243bc546933fbca1347ef69400d6e3b06f3e7aa464e9c",
    "after_prosrc_sha256": "5576ec5f6bb734e0a8e4d2062b89145d7b5fb237eedad844aa0aea70465d5c1a",
    "after_definition_sha256": "f12f5c47a9c94a2e7a8430a4fa918650bca36d5e560fd057ef1779866754472b"
  },
  {
    "identity": "public.events_app_events_set_end_date()",
    "before_definition": "CREATE OR REPLACE FUNCTION public.events_app_events_set_end_date()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nbegin\n  if new.end_date is null then\n    new.end_date := new.event_date;\n  end if;\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "d155b8847eaf0ba623c2f107abb66ee5a9025ec9ef5c04b2e8c94908170045b3",
    "before_prosrc_sha256": "a72662b2166007a74ab280d1c2d344fe8eb1a8f84103d75e6ef6f0d09fe4c5c9",
    "after_prosrc_sha256": "366384115b0d5ea7599731a161e93f618c64eb1fef83d809bf50ea3faff348ab",
    "after_definition_sha256": "7826e8a15ebaf376a9453ced929d8cd74e28f1d14cae62cc0d89fc55a3702e30"
  },
  {
    "identity": "public.events_app_validate_scope_venue()",
    "before_definition": "CREATE OR REPLACE FUNCTION public.events_app_validate_scope_venue()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\ndeclare\n  v_scope text;\n  v_zoo_venue public.event_venues%rowtype;\n  v_primary public.event_venues%rowtype;\n  v_bad_count integer;\nbegin\n  v_scope := upper(replace(btrim(coalesce(new.event_scope, 'UNKNOWN')), '-', '_'));\n  if v_scope in ('ZOO', 'ZOO_FOOTPRINT') then\n    v_scope := 'ZOO_WIDE';\n  elsif v_scope in ('SINGLE') then\n    v_scope := 'SINGLE_VENUE';\n  elsif v_scope in ('MULTI', 'MULTIPLE', 'MULTIPLE_VENUES') then\n    v_scope := 'MULTI_VENUE';\n  elsif v_scope = 'OFF_SITE' then\n    v_scope := 'OFFSITE';\n  end if;\n\n  if v_scope not in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN') then\n    raise exception 'Invalid event scope %', new.event_scope using errcode = '23514';\n  end if;\n\n  new.event_scope := v_scope;\n  new.event_timezone := coalesce(nullif(btrim(new.event_timezone), ''), 'America/Chicago');\n  if new.event_timezone <> 'America/Chicago' then\n    raise exception 'event_timezone must be America/Chicago' using errcode = '23514';\n  end if;\n  new.venue_ids := coalesce(new.venue_ids, '{}'::uuid[]);\n  new.coverage_location_ids := coalesce(new.coverage_location_ids, '{}'::uuid[]);\n  new.staffing_area_ids := coalesce(new.staffing_area_ids, '{}'::uuid[]);\n  new.display_location := nullif(btrim(coalesce(new.display_location, '')), '');\n\n  if new.parser_confidence is not null and new.parser_confidence not in ('high', 'medium', 'low') then\n    raise exception 'parser_confidence must be high, medium, or low' using errcode = '23514';\n  end if;\n\n  if v_scope = 'ZOO_WIDE' then\n    select * into v_zoo_venue\n    from public.event_venues\n    where venue_code = 'ZOO_FOOTPRINT' and active = true\n    limit 1;\n    if v_zoo_venue.id is null then\n      raise exception 'Zoo Footprint venue is not configured' using errcode = '23514';\n    end if;\n    new.primary_venue_id := v_zoo_venue.id;\n    new.venue_ids := array[v_zoo_venue.id]::uuid[];\n    new.location_group_id := v_zoo_venue.location_group_id;\n    new.display_location := 'Zoo Footprint';\n    new.needs_review := false;\n  elsif v_scope = 'SINGLE_VENUE' then\n    if new.primary_venue_id is null then\n      raise exception 'SINGLE_VENUE events require one eligible event venue' using errcode = '23514';\n    end if;\n    select * into v_primary\n    from public.event_venues\n    where id = new.primary_venue_id and active = true\n    limit 1;\n    if v_primary.id is null or v_primary.eligible_event_venue is not true or v_primary.event_scope = 'ZOO_WIDE' then\n      raise exception 'Selected event venue is not eligible as a primary event venue' using errcode = '23514';\n    end if;\n    if not (new.primary_venue_id = any(new.venue_ids)) then\n      new.venue_ids := array_prepend(new.primary_venue_id, new.venue_ids);\n    end if;\n    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);\n    new.display_location := coalesce(new.display_location, v_primary.display_name);\n    new.needs_review := false;\n  elsif v_scope = 'MULTI_VENUE' then\n    if coalesce(array_length(new.venue_ids, 1), 0) < 2 then\n      raise exception 'MULTI_VENUE events require at least two eligible event venues' using errcode = '23514';\n    end if;\n    select count(*) into v_bad_count\n    from unnest(new.venue_ids) as selected(venue_id)\n    left join public.event_venues ev on ev.id = selected.venue_id and ev.active = true\n    where ev.id is null or ev.eligible_event_venue is not true or ev.event_scope = 'ZOO_WIDE';\n    if v_bad_count > 0 then\n      raise exception 'MULTI_VENUE events contain an ineligible venue' using errcode = '23514';\n    end if;\n    if new.primary_venue_id is null or not (new.primary_venue_id = any(new.venue_ids)) then\n      new.primary_venue_id := new.venue_ids[1];\n    end if;\n    select * into v_primary from public.event_venues where id = new.primary_venue_id limit 1;\n    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);\n    new.display_location := coalesce(\n      new.display_location,\n      (\n        select string_agg(ev.display_name, ', ' order by ev.display_name)\n        from public.event_venues ev\n        where ev.id = any(new.venue_ids)\n      )\n    );\n    new.needs_review := false;\n  elsif v_scope = 'OFFSITE' then\n    new.display_location := coalesce(new.display_location, 'Offsite');\n    new.needs_review := false;\n  else\n    new.needs_review := true;\n    new.display_location := coalesce(new.display_location, 'Needs Review');\n  end if;\n\n  select count(*) into v_bad_count\n  from unnest(new.coverage_location_ids) as selected(location_group_id)\n  left join public.location_groups lg on lg.id = selected.location_group_id\n  where lg.id is null or lg.eligible_custodial_coverage is not true;\n  if v_bad_count > 0 then\n    raise exception 'coverage_location_ids contains an ineligible custodial coverage location' using errcode = '23514';\n  end if;\n\n  select count(*) into v_bad_count\n  from unnest(new.staffing_area_ids) as selected(location_group_id)\n  left join public.location_groups lg on lg.id = selected.location_group_id\n  where lg.id is null or lg.eligible_staffing_assignment is not true;\n  if v_bad_count > 0 then\n    raise exception 'staffing_area_ids contains an ineligible staffing location' using errcode = '23514';\n  end if;\n\n  if new.event_scope <> 'UNKNOWN' and exists (\n    select 1\n    from public.location_groups lg\n    where lg.id = new.location_group_id\n      and lg.eligible_event_venue is not true\n      and lg.eligible_event_scope is not true\n      and (lg.public_restroom is true or lg.staff_restroom is true or lg.group_name ilike '%restroom%' or lg.group_code ilike '%RESTROOM%')\n  ) then\n    raise exception 'Restroom/custodial coverage locations cannot be saved as primary event venues' using errcode = '23514';\n  end if;\n\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "aa399a485ed888cc45798ea401c3c5c6b04a7ea1fdeb743885089319593a2d6c",
    "before_prosrc_sha256": "ccf5051fa2d5026ff57c5b4d597ee1b56002811c31c7ccda17a4921f0b88ca5a",
    "after_prosrc_sha256": "da58dd07ef86de2e07ef5d55015cd7ab9e2801a1e2cfcb9d2a766f2fda1b2e5b",
    "after_definition_sha256": "aaf70e693824d8d90e55e1b1708c2f088c15ffe014230dfa0871ae7aef8dcf0d"
  },
  {
    "identity": "public.events_app_isolate_needs_review()",
    "before_definition": "CREATE OR REPLACE FUNCTION public.events_app_isolate_needs_review()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$\nbegin\n  -- The earlier venue validator canonicalizes scope before this trigger runs.\n  -- A compatibility location_group_id is not an approved cleaning assignment.\n  if new.event_scope = 'UNKNOWN' or new.needs_review is true then\n    if nullif(btrim(coalesce(new.source_location_text, '')), '') is null\n       and nullif(btrim(coalesce(new.display_location, '')), '') is not null\n       and new.display_location <> 'Needs Review' then\n      new.source_location_text := new.display_location;\n    end if;\n    new.event_scope := 'UNKNOWN';\n    new.needs_review := true;\n    new.primary_venue_id := null;\n    new.venue_ids := '{}'::uuid[];\n    new.coverage_location_ids := '{}'::uuid[];\n    new.staffing_area_ids := '{}'::uuid[];\n    new.display_location := 'Needs Review';\n    if new.status not in ('CANCELLED','ARCHIVED') then\n      new.status := 'NEEDS_REVIEW';\n    end if;\n  elsif new.status = 'NEEDS_REVIEW' then\n    -- Reached only after a resolved venue passes the manager write path and\n    -- the venue validator. That update increments revision in the command.\n    new.status := 'SCHEDULED';\n  end if;\n  return new;\nend;\n$function$\n",
    "before_definition_sha256": "569dd756409aee2b6abe109f07c8d2817442115ec1a9984e58bde3ecffabb7d7",
    "before_prosrc_sha256": "f508d4e0d83c19674c2d994cbfe48e756f442f398c34ed90566533705c454e5c",
    "after_prosrc_sha256": "548cae76b601432fd92174e8384ea4a7ee63a15d7e5cc3124af6df4386ac7df5",
    "after_definition_sha256": "5b5b31f4d3f7f1c96520350c3c078860095e60ff7e490e5e136a6f245953bf72"
  }
]
$original_event_profiles$::jsonb;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
  relation_oid := pg_catalog.to_regclass('public.events_app_events');
  helper_oid := pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
  IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
    OR owner_oid IS NULL OR relation_oid IS NULL OR helper_oid IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=relation_oid AND n.nspname='public' AND c.relname='events_app_events'
        AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
      AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
      AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2)
  THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='Original event restore owner/relation/invoker matcher unavailable';
  END IF;
  -- Checks the actual already-held global xact fence, original session and
  -- original objects. Neither function names nor these DATA hashes mint it.
  PERFORM custodial_dr.immutable_import_owner_fence();
  LOCK TABLE public.events_app_events IN ACCESS EXCLUSIVE MODE;
  IF pg_catalog.jsonb_array_length(profiles)<>5 THEN
    RAISE EXCEPTION 'Closed five-function event profile required';
  END IF;
  -- Validate ALL predecessors before the first CREATE OR REPLACE.
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(profiles) LOOP
    function_oid := pg_catalog.to_regprocedure(profile->>'identity');
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    before_definition := pg_catalog.pg_get_functiondef(function_oid);
    IF original.proowner<>owner_oid OR original.prokind<>'f' OR original.pronargs<>0
      OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset
      OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR before_definition IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_definition_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'before_prosrc_sha256'
      OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))
        <>pg_catalog.length(insertion_point)
    THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original event function predecessor differs';
    END IF;
    after_body := pg_catalog.replace(original.prosrc,insertion_point,insertion_point||restore_branch);
    after_definition := pg_catalog.replace(before_definition,insertion_point,insertion_point||restore_branch);
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_prosrc_sha256'
      OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
        IS DISTINCT FROM profile->>'after_definition_sha256'
    THEN
      RAISE EXCEPTION 'Source-derived event branch transformation differs';
    END IF;
    checked := checked || pg_catalog.jsonb_build_array(profile || pg_catalog.jsonb_build_object(
      'oid',function_oid,'metadata',pg_catalog.to_jsonb(original)-'prosrc',
      'after_definition',after_definition,'after_body',after_body));
  END LOOP;
  FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(checked) LOOP
    function_oid := (profile->>'oid')::oid;
    SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'before_definition'
      OR pg_catalog.to_jsonb(original)-'prosrc' IS DISTINCT FROM profile->'metadata'
    THEN RAISE EXCEPTION 'Original event function changed before replacement'; END IF;
    PERFORM custodial_dr.immutable_import_owner_fence();
    EXECUTE profile->>'after_definition';
    SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF after_row.prosrc IS DISTINCT FROM profile->>'after_body'
      OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM profile->>'after_definition'
      OR pg_catalog.to_jsonb(after_row)-'prosrc' IS DISTINCT FROM profile->'metadata'
    THEN RAISE EXCEPTION 'Event restore changed attributes outside the closed branch'; END IF;
  END LOOP;
END;
$immutable_event_restore$;
