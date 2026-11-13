-- APPROVED Q07 successor proposal. Main owns canonical migration and recovery binding.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path=pg_catalog,public;
DO $guard$ BEGIN
 IF public.static_weekly_digest_text(pg_get_functiondef('public.events_app_validate_scope_venue()'::regprocedure)) IS DISTINCT FROM 'aa399a485ed888cc45798ea401c3c5c6b04a7ea1fdeb743885089319593a2d6c' THEN
  RAISE EXCEPTION 'OFFSITE scope trigger predecessor changed';END IF;
 IF (SELECT count(*) FROM public.location_groups WHERE group_code='OFFSITE'
  AND offsite=true AND active=false AND eligible_event_scope=true
  AND eligible_custodial_coverage=false AND eligible_staffing_assignment=false)<>1 THEN
  RAISE EXCEPTION 'Existing event-only OFFSITE classification unavailable';END IF;
END $guard$;
UPDATE public.location_groups SET group_name='Off campus event',updated_at=statement_timestamp()
 WHERE group_code='OFFSITE' AND offsite=true AND active=false
  AND eligible_event_scope=true AND eligible_custodial_coverage=false AND eligible_staffing_assignment=false;
CREATE OR REPLACE FUNCTION public.events_app_validate_scope_venue()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_scope text;
  v_zoo_venue public.event_venues%rowtype;
  v_primary public.event_venues%rowtype;
  v_bad_count integer;
  v_offsite_group public.location_groups%rowtype;
begin
  v_scope := upper(replace(btrim(coalesce(new.event_scope, 'UNKNOWN')), '-', '_'));
  if v_scope in ('ZOO', 'ZOO_FOOTPRINT') then
    v_scope := 'ZOO_WIDE';
  elsif v_scope in ('SINGLE') then
    v_scope := 'SINGLE_VENUE';
  elsif v_scope in ('MULTI', 'MULTIPLE', 'MULTIPLE_VENUES') then
    v_scope := 'MULTI_VENUE';
  elsif v_scope = 'OFF_SITE' then
    v_scope := 'OFFSITE';
  end if;

  if v_scope not in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN') then
    raise exception 'Invalid event scope %', new.event_scope using errcode = '23514';
  end if;

  new.event_scope := v_scope;
  new.event_timezone := coalesce(nullif(btrim(new.event_timezone), ''), 'America/Chicago');
  if new.event_timezone <> 'America/Chicago' then
    raise exception 'event_timezone must be America/Chicago' using errcode = '23514';
  end if;
  new.venue_ids := coalesce(new.venue_ids, '{}'::uuid[]);
  new.coverage_location_ids := coalesce(new.coverage_location_ids, '{}'::uuid[]);
  new.staffing_area_ids := coalesce(new.staffing_area_ids, '{}'::uuid[]);
  new.display_location := nullif(btrim(coalesce(new.display_location, '')), '');

  if new.parser_confidence is not null and new.parser_confidence not in ('high', 'medium', 'low') then
    raise exception 'parser_confidence must be high, medium, or low' using errcode = '23514';
  end if;

  if v_scope = 'ZOO_WIDE' then
    select * into v_zoo_venue
    from public.event_venues
    where venue_code = 'ZOO_FOOTPRINT' and active = true
    limit 1;
    if v_zoo_venue.id is null then
      raise exception 'Zoo Footprint venue is not configured' using errcode = '23514';
    end if;
    new.primary_venue_id := v_zoo_venue.id;
    new.venue_ids := array[v_zoo_venue.id]::uuid[];
    new.location_group_id := v_zoo_venue.location_group_id;
    new.display_location := 'Zoo Footprint';
    new.needs_review := false;
  elsif v_scope = 'SINGLE_VENUE' then
    if new.primary_venue_id is null then
      raise exception 'SINGLE_VENUE events require one eligible event venue' using errcode = '23514';
    end if;
    select * into v_primary
    from public.event_venues
    where id = new.primary_venue_id and active = true
    limit 1;
    if v_primary.id is null or v_primary.eligible_event_venue is not true or v_primary.event_scope = 'ZOO_WIDE' then
      raise exception 'Selected event venue is not eligible as a primary event venue' using errcode = '23514';
    end if;
    if not (new.primary_venue_id = any(new.venue_ids)) then
      new.venue_ids := array_prepend(new.primary_venue_id, new.venue_ids);
    end if;
    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);
    new.display_location := coalesce(new.display_location, v_primary.display_name);
    new.needs_review := false;
  elsif v_scope = 'MULTI_VENUE' then
    if coalesce(array_length(new.venue_ids, 1), 0) < 2 then
      raise exception 'MULTI_VENUE events require at least two eligible event venues' using errcode = '23514';
    end if;
    select count(*) into v_bad_count
    from unnest(new.venue_ids) as selected(venue_id)
    left join public.event_venues ev on ev.id = selected.venue_id and ev.active = true
    where ev.id is null or ev.eligible_event_venue is not true or ev.event_scope = 'ZOO_WIDE';
    if v_bad_count > 0 then
      raise exception 'MULTI_VENUE events contain an ineligible venue' using errcode = '23514';
    end if;
    if new.primary_venue_id is null or not (new.primary_venue_id = any(new.venue_ids)) then
      new.primary_venue_id := new.venue_ids[1];
    end if;
    select * into v_primary from public.event_venues where id = new.primary_venue_id limit 1;
    new.location_group_id := coalesce(v_primary.location_group_id, new.location_group_id);
    new.display_location := coalesce(
      new.display_location,
      (
        select string_agg(ev.display_name, ', ' order by ev.display_name)
        from public.event_venues ev
        where ev.id = any(new.venue_ids)
      )
    );
    new.needs_review := false;
  elsif v_scope = 'OFFSITE' then
    -- Approved event-only classification, never a Zoo cleaning/staffing area.
    select * into v_offsite_group from public.location_groups
      where group_code='OFFSITE' and group_name='Off campus event'
        and offsite=true and active=false and eligible_event_scope=true
        and eligible_custodial_coverage=false and eligible_staffing_assignment=false;
    if v_offsite_group.id is null then
      raise exception 'Off campus event classification is unavailable' using errcode='23514';
    end if;
    if new.location_group_id is not null and new.location_group_id<>v_offsite_group.id then
      raise exception 'OFFSITE event requires Off campus event classification' using errcode='23514';
    end if;
    if cardinality(new.coverage_location_ids)<>0 or cardinality(new.staffing_area_ids)<>0 then
      raise exception 'OFFSITE event cannot allocate Zoo cleaning or staffing areas' using errcode='23514';
    end if;
    if (new.primary_venue_id is not null and not exists(select 1 from public.event_venues
          where id=new.primary_venue_id and event_scope='OFFSITE' and active=true))
      or exists(select 1 from unnest(new.venue_ids) selected(id)
        left join public.event_venues ev on ev.id=selected.id
        where ev.id is null or ev.event_scope<>'OFFSITE' or ev.active is not true) then
      raise exception 'OFFSITE event cannot claim a Zoo venue' using errcode='23514';
    end if;
    new.location_group_id := v_offsite_group.id;
    new.display_location := coalesce(new.display_location, 'Off campus event');
    new.needs_review := false;
  else
    new.needs_review := true;
    new.display_location := coalesce(new.display_location, 'Needs Review');
  end if;

  select count(*) into v_bad_count
  from unnest(new.coverage_location_ids) as selected(location_group_id)
  left join public.location_groups lg on lg.id = selected.location_group_id
  where lg.id is null or lg.eligible_custodial_coverage is not true;
  if v_bad_count > 0 then
    raise exception 'coverage_location_ids contains an ineligible custodial coverage location' using errcode = '23514';
  end if;

  select count(*) into v_bad_count
  from unnest(new.staffing_area_ids) as selected(location_group_id)
  left join public.location_groups lg on lg.id = selected.location_group_id
  where lg.id is null or lg.eligible_staffing_assignment is not true;
  if v_bad_count > 0 then
    raise exception 'staffing_area_ids contains an ineligible staffing location' using errcode = '23514';
  end if;

  if new.event_scope <> 'UNKNOWN' and exists (
    select 1
    from public.location_groups lg
    where lg.id = new.location_group_id
      and lg.eligible_event_venue is not true
      and lg.eligible_event_scope is not true
      and (lg.public_restroom is true or lg.staff_restroom is true or lg.group_name ilike '%restroom%' or lg.group_code ilike '%RESTROOM%')
  ) then
    raise exception 'Restroom/custodial coverage locations cannot be saved as primary event venues' using errcode = '23514';
  end if;

  return new;
end;
$function$;
-- Exact recovery-inventory successor binding remains Main-owned. No new privilege.
COMMIT;
