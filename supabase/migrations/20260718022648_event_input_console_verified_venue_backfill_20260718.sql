begin;

update public.location_groups
set eligible_event_venue = true,
    event_venue = true,
    exhibit = true,
    eligible_custodial_coverage = true,
    eligible_staffing_assignment = true,
    updated_at = now()
where group_code = 'CAT_COUNTRY';

insert into public.event_venues (
  venue_code,
  display_name,
  event_scope,
  location_group_id,
  eligible_event_venue,
  eligible_event_scope,
  aliases,
  active,
  metadata_json
)
select
  'CAT_COUNTRY',
  'Cat Country',
  'SINGLE_VENUE',
  lg.id,
  true,
  false,
  array['cat country', 'catcountry', 'cat country exhibit']::text[],
  true,
  '{"source":"event_input_console_verified_backfill","verification":"Existing production events and active exhibit taxonomy identify Cat Country as a real venue-capable exhibit, not a restroom or custodial-only checkpoint."}'::jsonb
from public.location_groups lg
where lg.group_code = 'CAT_COUNTRY'
on conflict (venue_code) do update
set display_name = excluded.display_name,
    event_scope = excluded.event_scope,
    location_group_id = excluded.location_group_id,
    eligible_event_venue = true,
    eligible_event_scope = false,
    aliases = excluded.aliases,
    active = true,
    metadata_json = excluded.metadata_json,
    updated_at = now();

with target_events as (
  select e.id, to_jsonb(e.*) as previous_record
  from public.events_app_events e
  join public.location_groups lg on lg.id = e.location_group_id
  where lg.group_code = 'CAT_COUNTRY'
    and e.needs_review = true
    and e.event_scope = 'UNKNOWN'
    and e.event_date >= date '2026-07-17'
  for update
), cat_venue as (
  select ev.id as venue_id, ev.location_group_id
  from public.event_venues ev
  where ev.venue_code = 'CAT_COUNTRY'
), updated as (
  update public.events_app_events e
  set event_scope = 'SINGLE_VENUE',
      primary_venue_id = cat_venue.venue_id,
      venue_ids = array[cat_venue.venue_id]::uuid[],
      display_location = 'Cat Country',
      coverage_location_ids = '{}'::uuid[],
      staffing_area_ids = '{}'::uuid[],
      source_location_text = coalesce(e.source_location_text, 'Cat Country'),
      parser_confidence = 'medium',
      needs_review = false,
      parse_reason = 'Verified venue backfill: legacy Cat Country event rows are active exhibit venue events, not restroom or custodial-only locations.',
      manually_overridden = true,
      overridden_by = 'codex_event_input_console_verified_backfill',
      overridden_at = now(),
      event_timezone = 'America/Chicago',
      revision = coalesce(e.revision, 1) + 1,
      updated_at = now()
  from target_events
  cross join cat_venue
  where e.id = target_events.id
  returning e.*, target_events.previous_record
), history as (
  insert into public.events_app_event_history (
    event_id,
    action,
    actor,
    reason,
    previous_record,
    new_record,
    created_at
  )
  select
    id,
    'verified_venue_backfill',
    'codex_event_input_console_verified_backfill',
    'Cat Country was classified as an eligible event venue and existing Cat Country events were resolved from Needs Review to SINGLE_VENUE.',
    previous_record,
    to_jsonb(updated.*) - 'previous_record',
    now()
  from updated
  returning id
)
select count(*) from history;

with splash_restroom as (
  select id as restroom_group_id
  from public.location_groups
  where group_code = 'SPLASH_PAD_RESTROOMS'
), splash_venue as (
  select ev.id as venue_id, ev.location_group_id
  from public.event_venues ev
  where ev.venue_code = 'SPLASH_PAD'
), target_events as (
  select e.id, e.location_group_id as previous_location_group_id, to_jsonb(e.*) as previous_record
  from public.events_app_events e
  join splash_restroom sr on sr.restroom_group_id = e.location_group_id
  where e.needs_review = true
    and e.event_scope = 'UNKNOWN'
    and e.event_name ~* '\\mSplash\\s+Pad\\M'
    and e.event_date >= date '2026-07-17'
  for update
), updated as (
  update public.events_app_events e
  set location_group_id = splash_venue.location_group_id,
      event_scope = 'SINGLE_VENUE',
      primary_venue_id = splash_venue.venue_id,
      venue_ids = array[splash_venue.venue_id]::uuid[],
      display_location = 'Splash Pad',
      coverage_location_ids = array[target_events.previous_location_group_id]::uuid[],
      staffing_area_ids = coalesce(nullif(e.staffing_area_ids, '{}'::uuid[]), array[target_events.previous_location_group_id]::uuid[]),
      source_location_text = coalesce(e.source_location_text, 'Splash Pad Restrooms'),
      parser_confidence = 'medium',
      needs_review = false,
      parse_reason = 'Verified venue backfill: legacy Splash Pad event rows used Splash Pad Restrooms as the custodial coverage target; event venue is Splash Pad.',
      manually_overridden = true,
      overridden_by = 'codex_event_input_console_verified_backfill',
      overridden_at = now(),
      event_timezone = 'America/Chicago',
      revision = coalesce(e.revision, 1) + 1,
      updated_at = now()
  from target_events
  cross join splash_venue
  where e.id = target_events.id
  returning e.*, target_events.previous_record
), history as (
  insert into public.events_app_event_history (
    event_id,
    action,
    actor,
    reason,
    previous_record,
    new_record,
    created_at
  )
  select
    id,
    'verified_venue_backfill',
    'codex_event_input_console_verified_backfill',
    'Splash Pad Restrooms was retained as custodial coverage while the primary event venue was corrected to Splash Pad.',
    previous_record,
    to_jsonb(updated.*) - 'previous_record',
    now()
  from updated
  returning id
)
select count(*) from history;

commit;
