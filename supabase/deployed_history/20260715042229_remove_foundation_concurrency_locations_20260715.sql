-- Deployed migration history snapshot: 20260715042229 remove_foundation_concurrency_locations_20260715

do $do$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.locations
  where location_code ~ '^ZZF(0[2-9]|10)$'
    and notes = 'temporary foundation concurrency test';

  if v_count <> 9 then
    raise exception 'Expected exactly 9 isolated foundation concurrency locations, found %', v_count;
  end if;

  if exists (
    select 1
    from public.locations l
    where l.location_code ~ '^ZZF(0[2-9]|10)$'
      and (
        exists(select 1 from public.sessions s where s.location_id=l.id)
        or exists(select 1 from public.scan_events se where se.location_id=l.id)
        or exists(select 1 from public.maintenance_tickets mt where mt.location_id=l.id)
        or exists(select 1 from public.location_group_memberships gm where gm.location_id=l.id)
        or exists(select 1 from public.location_proximity_settings p where p.location_id=l.id)
        or exists(select 1 from public.system_logs sl where sl.location_id=l.id)
        or exists(select 1 from public.guest_cleanliness_reports gr where upper(gr.location_code)=upper(l.location_code))
      )
  ) then
    raise exception 'Foundation concurrency locations gained operational references; refusing removal';
  end if;

  insert into archive.removed_operational_test_rows(
    removal_batch,source_table,source_id,row_json,archived_at,archived_by
  )
  select 'foundation_concurrency_locations_20260715','public.locations',l.id::text,to_jsonb(l),now(),'overnight_system_integration_audit'
  from public.locations l
  where l.location_code ~ '^ZZF(0[2-9]|10)$'
    and l.notes = 'temporary foundation concurrency test'
    and not exists(
      select 1 from archive.removed_operational_test_rows a
      where a.removal_batch='foundation_concurrency_locations_20260715'
        and a.source_table='public.locations'
        and a.source_id=l.id::text
    );

  delete from public.locations
  where location_code ~ '^ZZF(0[2-9]|10)$'
    and notes = 'temporary foundation concurrency test';

  get diagnostics v_count = row_count;
  if v_count <> 9 then
    raise exception 'Expected to remove 9 foundation concurrency locations, removed %', v_count;
  end if;
end
$do$;
