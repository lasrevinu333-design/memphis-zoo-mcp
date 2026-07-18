begin;

-- Restore the exact Members Night record that the former process-local
-- expiration timer physically deleted. The guard deliberately aborts instead
-- of overwriting a later legitimate record or creating a duplicate.
do $$
declare
  v_event_id constant uuid := '8204c7d4-b4bd-4417-b43d-b7fe2ced5e16'::uuid;
  v_zoo_location_id uuid;
  v_zoo_venue_id uuid;
  v_existing public.events_app_events%rowtype;
  v_restored public.events_app_events%rowtype;
begin
  if exists (
    select 1
    from public.events_app_events e
    where lower(btrim(e.event_name)) = 'members night'
      and e.event_date = date '2026-07-17'
      and e.id <> v_event_id
  ) then
    raise exception 'Members Night restoration stopped: a conflicting event already exists';
  end if;

  select lg.id into v_zoo_location_id
  from public.location_groups lg
  where lg.group_code = 'ZOO_FOOTPRINT'
    and lg.eligible_event_scope is true
    and lg.zoo_wide_scope is true
  limit 1;

  select ev.id into v_zoo_venue_id
  from public.event_venues ev
  where ev.venue_code = 'ZOO_FOOTPRINT'
    and ev.event_scope = 'ZOO_WIDE'
    and ev.eligible_event_scope is true
    and ev.active is true
  limit 1;

  if v_zoo_location_id is null or v_zoo_venue_id is null then
    raise exception 'Members Night restoration stopped: canonical Zoo Footprint records are missing';
  end if;

  select * into v_existing
  from public.events_app_events e
  where e.id = v_event_id;

  if v_existing.id is not null and not (
    v_existing.event_name = 'Members Night'
    and v_existing.event_scope = 'ZOO_WIDE'
    and v_existing.location_group_id = v_zoo_location_id
    and v_existing.primary_venue_id = v_zoo_venue_id
    and v_existing.display_location = 'Zoo Footprint'
    and v_existing.event_date = date '2026-07-17'
    and v_existing.end_date = date '2026-07-17'
    and v_existing.start_time = time '18:00:00'
    and v_existing.end_time = time '20:30:00'
  ) then
    raise exception 'Members Night restoration stopped: the original id now contains conflicting data';
  end if;

  if v_existing.id is null then
    insert into public.events_app_events (
      id,
      event_name,
      location_group_id,
      event_date,
      start_time,
      end_time,
      attendee_count,
      notes,
      created_by,
      created_at,
      updated_at,
      end_date,
      event_scope,
      primary_venue_id,
      venue_ids,
      display_location,
      coverage_location_ids,
      staffing_area_ids,
      source_location_text,
      source_text,
      source_format,
      parser_confidence,
      needs_review,
      parse_reason,
      manually_overridden,
      overridden_by,
      overridden_at,
      event_timezone,
      operation_id,
      revision,
      status,
      archived_at
    ) values (
      v_event_id,
      'Members Night',
      v_zoo_location_id,
      date '2026-07-17',
      time '18:00:00',
      time '20:30:00',
      null,
      null,
      'Input Console',
      timestamptz '2026-07-06T20:25:09.395678+00:00',
      timestamptz '2026-07-18T02:19:10.846212+00:00',
      date '2026-07-17',
      'ZOO_WIDE',
      v_zoo_venue_id,
      array[v_zoo_venue_id]::uuid[],
      'Zoo Footprint',
      '{}'::uuid[],
      '{}'::uuid[],
      'MemMex Restrooms',
      null,
      'legacy_input_console_record',
      'high',
      false,
      'Production correction: Members Night is a configured zoo-wide event. MemMex Restrooms was the legacy stored custodial area and is not the event venue.',
      true,
      'codex_event_input_console_repair',
      timestamptz '2026-07-18T02:19:10.846212+00:00',
      'America/Chicago',
      v_event_id,
      2,
      'ARCHIVED',
      now()
    )
    returning * into v_restored;
  else
    v_restored := v_existing;
  end if;

  -- Reconstruct the previously accepted correction audit record from the
  -- targeted backup and prior production acceptance evidence.
  insert into public.events_app_event_history (
    id,
    event_id,
    action,
    actor,
    reason,
    previous_record,
    new_record,
    created_at
  ) values (
    'f876e591-748a-48aa-bb7c-21cc562900bf'::uuid,
    v_event_id,
    'production_correction',
    'codex_event_input_console_repair',
    'Corrected Members Night from MemMex Restrooms to ZOO_WIDE / Zoo Footprint without creating a duplicate.',
    jsonb_build_object(
      'id', v_event_id,
      'event_name', 'Members Night',
      'location_group_id', 'b522be35-654e-4859-8367-4540f92e8af2'::uuid,
      'event_date', date '2026-07-17',
      'end_date', date '2026-07-17',
      'start_time', time '18:00:00',
      'end_time', time '20:30:00',
      'attendee_count', null,
      'notes', null,
      'created_by', 'Input Console',
      'created_at', timestamptz '2026-07-06T20:25:09.395678+00:00',
      'updated_at', timestamptz '2026-07-06T20:25:09.395678+00:00'
    ),
    to_jsonb(v_restored),
    timestamptz '2026-07-18T02:19:10.846212+00:00'
  )
  on conflict (id) do nothing;

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
    v_event_id,
    'retention_recovery',
    'codex_custodial_v3_reliability_repair',
    'Restored an accepted historical event after the former expiration timer physically deleted the event and cascaded its audit history.',
    null,
    to_jsonb(v_restored),
    now()
  where not exists (
    select 1
    from public.events_app_event_history h
    where h.event_id = v_event_id
      and h.action = 'retention_recovery'
  );
end
$$;

commit;
