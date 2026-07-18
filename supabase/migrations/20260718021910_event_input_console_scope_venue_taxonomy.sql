begin;

alter table public.location_groups
  add column if not exists eligible_event_venue boolean not null default false,
  add column if not exists eligible_event_scope boolean not null default false,
  add column if not exists eligible_custodial_coverage boolean not null default true,
  add column if not exists eligible_staffing_assignment boolean not null default true,
  add column if not exists public_restroom boolean not null default false,
  add column if not exists staff_restroom boolean not null default false,
  add column if not exists exhibit boolean not null default false,
  add column if not exists restaurant boolean not null default false,
  add column if not exists event_venue boolean not null default false,
  add column if not exists administrative boolean not null default false,
  add column if not exists zoo_wide_scope boolean not null default false,
  add column if not exists offsite boolean not null default false;

comment on column public.location_groups.eligible_event_venue is 'True only for canonical locations that may be selected as a primary event venue.';
comment on column public.location_groups.eligible_custodial_coverage is 'True for locations/areas that may be selected as custodial coverage targets; this is separate from event venue eligibility.';
comment on column public.location_groups.zoo_wide_scope is 'True for the canonical Zoo Footprint scope record.';

insert into public.location_groups (group_code, group_name, active, notes)
values
  ('ZOO_FOOTPRINT', 'Zoo Footprint', false, 'Canonical event-only zoo-wide scope. Not a cleaning, scan, or staffing area.'),
  ('OFFSITE', 'Offsite', false, 'Canonical event-only offsite scope. Not a cleaning, scan, or staffing area.'),
  ('CAT_HOUSE_CAFE', 'Cat House Café', false, 'Canonical event-only venue. Separate from Cathouse Cafe Restrooms custodial coverage.'),
  ('COURTYARD', 'Courtyard', false, 'Canonical event-only venue. Separate from Courtyard Restrooms custodial coverage.'),
  ('SPLASH_PAD', 'Splash Pad', false, 'Canonical event-only venue. Separate from Splash Pad Restrooms custodial coverage.')
on conflict (group_code) do update
set group_name = excluded.group_name,
    active = excluded.active,
    notes = excluded.notes,
    updated_at = now();

update public.location_groups
set eligible_custodial_coverage = true,
    eligible_staffing_assignment = true,
    public_restroom = (upper(group_code) like '%RESTROOM%' or group_name ilike '%restroom%'),
    staff_restroom = false,
    administrative = (upper(group_code) like '%ADMIN%' or group_name ilike '%admin%' or group_name ilike '%break room%'),
    restaurant = (group_code in ('CAT_HOUSE_CAFE', 'CATHOUSE_CAFE_RESTROOMS', 'MEMMEX_RESTROOMS')),
    exhibit = (group_code in ('AQUARIUM', 'CAT_COUNTRY', 'CHINA', 'EXPO', 'HERPETARIUM', 'KOMODOS', 'NOCTURNAL', 'NORTH_WEST_PASSAGE', 'PRIMATE_CANYON', 'PRIMATE_PAVILLION', 'TETON', 'TROPICAL_BIRDS', 'ZAMBEZI')),
    eligible_event_scope = false,
    zoo_wide_scope = false,
    offsite = false,
    updated_at = now();

update public.location_groups
set eligible_event_venue = false,
    event_venue = false,
    eligible_custodial_coverage = true,
    eligible_staffing_assignment = true,
    public_restroom = true,
    updated_at = now()
where upper(group_code) like '%RESTROOM%' or group_name ilike '%restroom%';

update public.location_groups
set eligible_event_venue = true,
    event_venue = true,
    updated_at = now()
where group_code in (
  'EVENT_CENTER',
  'TETON',
  'CHINA',
  'EXPO',
  'NORTH_WEST_PASSAGE',
  'PRIMATE_CANYON',
  'PRIMATE_PAVILLION',
  'ZAMBEZI'
);

update public.location_groups
set eligible_event_venue = true,
    event_venue = true,
    eligible_custodial_coverage = false,
    eligible_staffing_assignment = false,
    updated_at = now()
where group_code in ('CAT_HOUSE_CAFE', 'COURTYARD', 'SPLASH_PAD');

update public.location_groups
set eligible_event_scope = true,
    zoo_wide_scope = true,
    eligible_event_venue = false,
    event_venue = false,
    eligible_custodial_coverage = false,
    eligible_staffing_assignment = false,
    public_restroom = false,
    staff_restroom = false,
    exhibit = false,
    restaurant = false,
    administrative = false,
    offsite = false,
    updated_at = now()
where group_code = 'ZOO_FOOTPRINT';

update public.location_groups
set eligible_event_scope = true,
    offsite = true,
    eligible_event_venue = false,
    event_venue = false,
    eligible_custodial_coverage = false,
    eligible_staffing_assignment = false,
    public_restroom = false,
    staff_restroom = false,
    exhibit = false,
    restaurant = false,
    administrative = false,
    zoo_wide_scope = false,
    updated_at = now()
where group_code = 'OFFSITE';

update public.event_area_aliases a
set active = false,
    notes = concat_ws(' ', nullif(a.notes, ''), 'Deactivated by event scope/venue repair: this generic venue alias moved to event_venues so restroom groups remain coverage-only.'),
    updated_at = now()
from public.location_groups lg
where lg.id = a.location_group_id
  and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'COURTYARD_RESTROOMS', 'SPLASH_PAD_RESTROOMS')
  and lower(a.alias_text) in (
    'cat house',
    'cat house cafe',
    'cathouse',
    'courtyard',
    'entrance courtyard',
    'entrance plaza',
    'plaza',
    'splash pad'
  );

create table if not exists public.event_venues (
  id uuid primary key default gen_random_uuid(),
  venue_code text not null unique,
  display_name text not null,
  event_scope text not null default 'SINGLE_VENUE',
  location_group_id uuid references public.location_groups(id),
  eligible_event_venue boolean not null default true,
  eligible_event_scope boolean not null default false,
  aliases text[] not null default '{}'::text[],
  active boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_venues_scope_check check (event_scope in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN')),
  constraint event_venues_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

alter table public.event_venues enable row level security;
alter table public.event_venues force row level security;
revoke all on table public.event_venues from public, anon, authenticated;
grant select, insert, update, delete on table public.event_venues to postgres, service_role;

drop policy if exists event_venues_service_all on public.event_venues;
create policy event_venues_service_all
  on public.event_venues
  for all
  to service_role
  using (true)
  with check (true);

create index if not exists idx_event_venues_active_display on public.event_venues (active, display_name);
create index if not exists idx_event_venues_location_group on public.event_venues (location_group_id);
create index if not exists idx_event_venues_aliases_gin on public.event_venues using gin (aliases);

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
  seed.venue_code,
  seed.display_name,
  seed.event_scope,
  lg.id as location_group_id,
  seed.eligible_event_venue,
  seed.eligible_event_scope,
  seed.aliases,
  seed.active,
  seed.metadata_json
from (
  values
    ('ZOO_FOOTPRINT', 'Zoo Footprint', 'ZOO_WIDE', 'ZOO_FOOTPRINT', false, true, array['Zoo Footprint','zoo wide','zoo-wide','entire zoo','whole zoo','across the zoo','full zoo','entire footprint','campus wide','campus-wide','park wide','park-wide']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('OFFSITE', 'Offsite', 'OFFSITE', 'OFFSITE', false, true, array['Offsite','Off-site','off site']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('EVENT_CENTER', 'Event Center', 'SINGLE_VENUE', 'EVENT_CENTER', true, false, array['Event Center','Event Centre','EC','event building']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('TETON_LODGE', 'Teton Lodge', 'SINGLE_VENUE', 'TETON', true, false, array['Teton Lodge','Teton Trek Lodge','Teton Trek','Teton']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('CHINA_EXHIBIT', 'China Exhibit', 'SINGLE_VENUE', 'CHINA', true, false, array['China','China Exhibit','China Theater']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('CAT_HOUSE_CAFE', 'Cat House Café', 'SINGLE_VENUE', 'CAT_HOUSE_CAFE', true, false, array['Cat House Café','Cat House Cafe','Cathouse Cafe','Cathouse','Cat House']::text[], true, '{"source":"event_input_console_repair","coverage_group":"CATHOUSE_CAFE_RESTROOMS"}'::jsonb),
    ('COURTYARD', 'Courtyard', 'SINGLE_VENUE', 'COURTYARD', true, false, array['Courtyard','Entrance Courtyard','Entrance Plaza','Plaza']::text[], true, '{"source":"event_input_console_repair","coverage_group":"COURTYARD_RESTROOMS"}'::jsonb),
    ('SPLASH_PAD', 'Splash Pad', 'SINGLE_VENUE', 'SPLASH_PAD', true, false, array['Splash Pad','Splashpad']::text[], true, '{"source":"event_input_console_repair","coverage_group":"SPLASH_PAD_RESTROOMS"}'::jsonb),
    ('EXPO', 'Expo', 'SINGLE_VENUE', 'EXPO', true, false, array['Expo','Expo building','Farm','Farm area','Once Upon A Farm']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('NORTH_WEST_PASSAGE', 'North West Passage', 'SINGLE_VENUE', 'NORTH_WEST_PASSAGE', true, false, array['North West Passage','Northwest Passage','NWP','North West']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('PRIMATE_PAVILION', 'Primate Pavilion', 'SINGLE_VENUE', 'PRIMATE_PAVILLION', true, false, array['Primate Pavilion','Primate Pavillion','Primate','Pavilion','PP']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('PRIMATE_CANYON', 'Primate Canyon', 'SINGLE_VENUE', 'PRIMATE_CANYON', true, false, array['Primate Canyon']::text[], true, '{"source":"event_input_console_repair"}'::jsonb),
    ('ZAMBEZI', 'Zambezi', 'SINGLE_VENUE', 'ZAMBEZI', true, false, array['Zambezi','Zambezi River']::text[], true, '{"source":"event_input_console_repair"}'::jsonb)
) as seed(venue_code, display_name, event_scope, location_group_code, eligible_event_venue, eligible_event_scope, aliases, active, metadata_json)
join public.location_groups lg on lg.group_code = seed.location_group_code
on conflict (venue_code) do update
set display_name = excluded.display_name,
    event_scope = excluded.event_scope,
    location_group_id = excluded.location_group_id,
    eligible_event_venue = excluded.eligible_event_venue,
    eligible_event_scope = excluded.eligible_event_scope,
    aliases = excluded.aliases,
    active = excluded.active,
    metadata_json = excluded.metadata_json,
    updated_at = now();

create table if not exists public.event_default_rules (
  id uuid primary key default gen_random_uuid(),
  match_text text not null,
  normalized_match text not null unique,
  event_scope text not null,
  primary_venue_id uuid references public.event_venues(id),
  display_location text,
  active boolean not null default true,
  notes text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_default_rules_scope_check check (event_scope in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN'))
);

alter table public.event_default_rules enable row level security;
alter table public.event_default_rules force row level security;
revoke all on table public.event_default_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.event_default_rules to postgres, service_role;

drop policy if exists event_default_rules_service_all on public.event_default_rules;
create policy event_default_rules_service_all
  on public.event_default_rules
  for all
  to service_role
  using (true)
  with check (true);

create index if not exists idx_event_default_rules_active_match on public.event_default_rules (active, normalized_match);

insert into public.event_default_rules (
  match_text,
  normalized_match,
  event_scope,
  primary_venue_id,
  display_location,
  active,
  notes,
  created_by
)
select
  seed.match_text,
  seed.normalized_match,
  seed.event_scope,
  ev.id,
  seed.display_location,
  true,
  seed.notes,
  'event_input_console_repair'
from (
  values
    ('Members Night', 'members night', 'ZOO_WIDE', 'Zoo Footprint', 'Recurring member event defaults to zoo-wide unless an operator explicitly selects another scope.'),
    ('Member Night', 'member night', 'ZOO_WIDE', 'Zoo Footprint', 'Recurring member event defaults to zoo-wide unless an operator explicitly selects another scope.')
) as seed(match_text, normalized_match, event_scope, display_location, notes)
join public.event_venues ev on ev.venue_code = 'ZOO_FOOTPRINT'
on conflict (normalized_match) do update
set match_text = excluded.match_text,
    event_scope = excluded.event_scope,
    primary_venue_id = excluded.primary_venue_id,
    display_location = excluded.display_location,
    active = true,
    notes = excluded.notes,
    updated_at = now();

alter table public.events_app_events
  add column if not exists event_scope text not null default 'UNKNOWN',
  add column if not exists primary_venue_id uuid references public.event_venues(id),
  add column if not exists venue_ids uuid[] not null default '{}'::uuid[],
  add column if not exists display_location text,
  add column if not exists coverage_location_ids uuid[] not null default '{}'::uuid[],
  add column if not exists staffing_area_ids uuid[] not null default '{}'::uuid[],
  add column if not exists source_location_text text,
  add column if not exists source_text text,
  add column if not exists source_format text,
  add column if not exists parser_confidence text,
  add column if not exists needs_review boolean not null default false,
  add column if not exists parse_reason text,
  add column if not exists manually_overridden boolean not null default false,
  add column if not exists overridden_by text,
  add column if not exists overridden_at timestamptz,
  add column if not exists event_timezone text not null default 'America/Chicago',
  add column if not exists operation_id uuid,
  add column if not exists revision integer not null default 1;

comment on column public.events_app_events.event_scope is 'Canonical event scope. Coverage and staffing areas must not overwrite this value.';
comment on column public.events_app_events.primary_venue_id is 'Canonical primary event venue, separate from custodial coverage locations.';
comment on column public.events_app_events.coverage_location_ids is 'Custodial coverage target location groups. These are not event venues.';
comment on column public.events_app_events.source_location_text is 'Raw source text/label for the event location input before canonical normalization.';
comment on column public.events_app_events.needs_review is 'True when parser could not resolve a valid event scope/venue and a manager must choose one before operational use.';

create unique index if not exists idx_events_app_events_operation_id_unique
  on public.events_app_events (operation_id)
  where operation_id is not null;
create index if not exists idx_events_app_events_event_scope_date
  on public.events_app_events (event_scope, event_date, start_time);
create index if not exists idx_events_app_events_primary_venue_date
  on public.events_app_events (primary_venue_id, event_date);
create index if not exists idx_events_app_events_coverage_locations_gin
  on public.events_app_events using gin (coverage_location_ids);
create index if not exists idx_events_app_events_venue_ids_gin
  on public.events_app_events using gin (venue_ids);
create index if not exists idx_events_app_events_needs_review
  on public.events_app_events (needs_review, event_date)
  where needs_review = true;

create table if not exists public.events_app_event_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events_app_events(id) on delete cascade,
  action text not null,
  actor text,
  reason text,
  previous_record jsonb,
  new_record jsonb,
  created_at timestamptz not null default now(),
  constraint events_app_event_history_action_len check (length(action) between 1 and 80),
  constraint events_app_event_history_previous_object check (previous_record is null or jsonb_typeof(previous_record) = 'object'),
  constraint events_app_event_history_new_object check (new_record is null or jsonb_typeof(new_record) = 'object')
);

alter table public.events_app_event_history enable row level security;
alter table public.events_app_event_history force row level security;
revoke all on table public.events_app_event_history from public, anon, authenticated;
grant select, insert, update, delete on table public.events_app_event_history to postgres, service_role;

drop policy if exists events_app_event_history_service_all on public.events_app_event_history;
create policy events_app_event_history_service_all
  on public.events_app_event_history
  for all
  to service_role
  using (true)
  with check (true);

create index if not exists idx_events_app_event_history_event_created
  on public.events_app_event_history (event_id, created_at desc);

with resolved as (
  select
    e.id,
    e.location_group_id,
    lg.group_name,
    ev.id as venue_id,
    ev.display_name as venue_display_name,
    ev.event_scope as venue_scope
  from public.events_app_events e
  join public.location_groups lg on lg.id = e.location_group_id
  left join public.event_venues ev
    on ev.location_group_id = e.location_group_id
   and ev.active = true
   and ev.event_scope <> 'ZOO_WIDE'
)
update public.events_app_events e
set event_scope = case when r.venue_id is not null then coalesce(r.venue_scope, 'SINGLE_VENUE') else 'UNKNOWN' end,
    primary_venue_id = r.venue_id,
    venue_ids = case when r.venue_id is not null then array[r.venue_id]::uuid[] else '{}'::uuid[] end,
    display_location = coalesce(r.venue_display_name, r.group_name, e.display_location, 'Needs Review'),
    coverage_location_ids = case when r.venue_id is null then array[e.location_group_id]::uuid[] else coalesce(e.coverage_location_ids, '{}'::uuid[]) end,
    staffing_area_ids = coalesce(e.staffing_area_ids, '{}'::uuid[]),
    source_location_text = coalesce(e.source_location_text, r.group_name),
    source_format = coalesce(e.source_format, 'legacy_input_console_record'),
    parser_confidence = coalesce(e.parser_confidence, case when r.venue_id is not null then 'medium' else 'low' end),
    needs_review = (r.venue_id is null),
    parse_reason = coalesce(
      e.parse_reason,
      case
        when r.venue_id is not null then 'Backfilled from legacy Event Input Console location_group_id after event venue taxonomy repair.'
        else 'Legacy event used a custodial/restroom/non-venue location group as the event venue. Marked for manager review; coverage preserved separately.'
      end
    ),
    event_timezone = 'America/Chicago',
    revision = coalesce(e.revision, 1),
    updated_at = now()
from resolved r
where e.id = r.id
  and e.id <> '8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid;

with before_row as (
  select e.*
  from public.events_app_events e
  where e.id = '8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid
  for update
), target as (
  select
    before_row.id,
    zoo_lg.id as zoo_location_group_id,
    zoo_ev.id as zoo_venue_id,
    before_lg.group_name as previous_location_name
  from before_row
  join public.location_groups before_lg on before_lg.id = before_row.location_group_id
  join public.location_groups zoo_lg on zoo_lg.group_code = 'ZOO_FOOTPRINT'
  join public.event_venues zoo_ev on zoo_ev.venue_code = 'ZOO_FOOTPRINT'
), updated as (
  update public.events_app_events e
  set event_name = 'Members Night',
      location_group_id = target.zoo_location_group_id,
      event_scope = 'ZOO_WIDE',
      primary_venue_id = target.zoo_venue_id,
      venue_ids = array[target.zoo_venue_id]::uuid[],
      display_location = 'Zoo Footprint',
      coverage_location_ids = '{}'::uuid[],
      staffing_area_ids = '{}'::uuid[],
      source_location_text = target.previous_location_name,
      source_text = coalesce(e.source_text, null),
      source_format = coalesce(e.source_format, 'legacy_input_console_record'),
      parser_confidence = 'high',
      needs_review = false,
      parse_reason = 'Production correction: Members Night is a configured zoo-wide event. MemMex Restrooms was the legacy stored custodial area and is not the event venue.',
      manually_overridden = true,
      overridden_by = 'codex_event_input_console_repair',
      overridden_at = now(),
      event_timezone = 'America/Chicago',
      event_date = '2026-07-17'::date,
      end_date = '2026-07-17'::date,
      start_time = '18:00:00'::time,
      end_time = '20:30:00'::time,
      attendee_count = null,
      notes = null,
      revision = coalesce(e.revision, 1) + 1,
      updated_at = now()
  from target
  where e.id = target.id
  returning e.*, (select to_jsonb(before_row.*) from before_row) as previous_record
)
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
  'production_correction',
  'codex_event_input_console_repair',
  'Corrected Members Night from MemMex Restrooms to ZOO_WIDE / Zoo Footprint without creating a duplicate.',
  previous_record,
  to_jsonb(updated.*) - 'previous_record',
  now()
from updated;

create or replace function public.events_app_validate_scope_venue()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_scope text;
  v_zoo_venue public.event_venues%rowtype;
  v_primary public.event_venues%rowtype;
  v_bad_count integer;
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
    new.display_location := coalesce(new.display_location, 'Offsite');
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

drop trigger if exists trg_events_app_validate_scope_venue on public.events_app_events;
create trigger trg_events_app_validate_scope_venue
before insert or update of
  event_scope,
  primary_venue_id,
  venue_ids,
  display_location,
  coverage_location_ids,
  staffing_area_ids,
  event_timezone,
  location_group_id,
  parser_confidence,
  needs_review
on public.events_app_events
for each row
execute function public.events_app_validate_scope_venue();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_event_scope_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_event_scope_check
      check (event_scope in ('ZOO_WIDE', 'SINGLE_VENUE', 'MULTI_VENUE', 'OFFSITE', 'UNKNOWN'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_timezone_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_timezone_check
      check (event_timezone = 'America/Chicago');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_parser_confidence_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_parser_confidence_check
      check (parser_confidence is null or parser_confidence in ('high', 'medium', 'low'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_zoo_wide_display_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_zoo_wide_display_check
      check (event_scope <> 'ZOO_WIDE' or display_location = 'Zoo Footprint');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_single_venue_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_single_venue_check
      check (event_scope <> 'SINGLE_VENUE' or primary_venue_id is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_multi_venue_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_multi_venue_check
      check (event_scope <> 'MULTI_VENUE' or coalesce(array_length(venue_ids, 1), 0) >= 2);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_app_events_unknown_review_check'
      and conrelid = 'public.events_app_events'::regclass
  ) then
    alter table public.events_app_events
      add constraint events_app_events_unknown_review_check
      check (event_scope <> 'UNKNOWN' or needs_review is true);
  end if;
end $$;

commit;
