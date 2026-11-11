-- Keep unresolved event intake durable but outside every scheduled-event path.
-- The existing manager command remains the sole authorized create/update route.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, public, extensions;

alter table public.events_app_events
  drop constraint events_app_events_status_check;
alter table public.events_app_events
  add constraint events_app_events_status_check
  check (status in ('SCHEDULED','NEEDS_REVIEW','CANCELLED','ARCHIVED'));

create or replace function public.events_app_isolate_needs_review()
returns trigger language plpgsql set search_path = pg_catalog, public as $function$
begin
  -- The earlier venue validator canonicalizes scope before this trigger runs.
  -- A compatibility location_group_id is not an approved cleaning assignment.
  if new.event_scope = 'UNKNOWN' or new.needs_review is true then
    if nullif(btrim(coalesce(new.source_location_text, '')), '') is null
       and nullif(btrim(coalesce(new.display_location, '')), '') is not null
       and new.display_location <> 'Needs Review' then
      new.source_location_text := new.display_location;
    end if;
    new.event_scope := 'UNKNOWN';
    new.needs_review := true;
    new.primary_venue_id := null;
    new.venue_ids := '{}'::uuid[];
    new.coverage_location_ids := '{}'::uuid[];
    new.staffing_area_ids := '{}'::uuid[];
    new.display_location := 'Needs Review';
    if new.status not in ('CANCELLED','ARCHIVED') then
      new.status := 'NEEDS_REVIEW';
    end if;
  elsif new.status = 'NEEDS_REVIEW' then
    -- Reached only after a resolved venue passes the manager write path and
    -- the venue validator. That update increments revision in the command.
    new.status := 'SCHEDULED';
  end if;
  return new;
end;
$function$;
revoke all on function public.events_app_isolate_needs_review()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_events_app_zz_needs_review_isolation on public.events_app_events;
create trigger trg_events_app_zz_needs_review_isolation
before insert or update on public.events_app_events
for each row execute function public.events_app_isolate_needs_review();

-- Preserve original records in the existing event history before moving any
-- legacy scheduled review rows out of the operational status. No row is lost.
with original as (
  select e.id, to_jsonb(e.*) as prior
  from public.events_app_events e
  where e.status = 'SCHEDULED' and (e.needs_review or e.event_scope = 'UNKNOWN')
  for update
), moved as (
  update public.events_app_events e
  set status = 'NEEDS_REVIEW', event_scope = 'UNKNOWN', needs_review = true,
      primary_venue_id = null, venue_ids = '{}'::uuid[],
      coverage_location_ids = '{}'::uuid[], staffing_area_ids = '{}'::uuid[],
      source_location_text = coalesce(nullif(btrim(e.source_location_text), ''),
        nullif(btrim(e.display_location), 'Needs Review')),
      display_location = 'Needs Review', revision = coalesce(e.revision, 1) + 1,
      updated_at = statement_timestamp()
  from original o where e.id = o.id
  returning e.id, to_jsonb(e.*) as current_record
)
insert into public.events_app_event_history
  (event_id, action, actor, reason, previous_record, new_record, created_at)
select m.id, 'review_isolation', 'system migration',
  'Legacy unresolved event moved out of scheduled delivery without deleting original evidence.',
  o.prior, m.current_record, statement_timestamp()
from moved m join original o on o.id = m.id;

alter table public.events_app_events
  add constraint events_app_events_review_isolation_check
  check (
    (status = 'NEEDS_REVIEW' and event_scope = 'UNKNOWN' and needs_review = true
      and primary_venue_id is null and coalesce(cardinality(venue_ids), 0) = 0
      and coalesce(cardinality(coverage_location_ids), 0) = 0
      and coalesce(cardinality(staffing_area_ids), 0) = 0)
    or
    (status <> 'NEEDS_REVIEW' and
      (status in ('CANCELLED','ARCHIVED') or (event_scope <> 'UNKNOWN' and needs_review = false)))
  );

-- Exact recovery identities: the two constraints, private trigger function,
-- its grant boundary and enabled trigger. Existing Data API table ACLs stay put.
do $recovery$
declare obj record; next_order integer; changed integer;
begin
  if not exists(select 1 from pg_trigger where
    tgrelid = 'public.custodial_release_authority_restore_inventory'::regclass
    and tgname = 'trg_custodial_release_authority_restore_inventory_immutable' and tgenabled = 'O') then
    raise exception 'release recovery inventory immutability is unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in
    select 100000 bucket, 'function'::text kind,
      'public.events_app_isolate_needs_review()'::text identity,
      pg_get_functiondef('public.events_app_isolate_needs_review()'::regprocedure) definition
    union all select 500000, 'constraint',
      'public.events_app_events:' || c.conname,
      public.custodial_release_authority_current_constraint_definition('public.events_app_events:' || c.conname)
      from pg_constraint c where c.conrelid = 'public.events_app_events'::regclass
        and c.conname in ('events_app_events_status_check','events_app_events_review_isolation_check')
    union all select 700000, 'trigger',
      'public.events_app_events.trg_events_app_zz_needs_review_isolation',
      'drop trigger if exists ' || quote_ident(t.tgname) || ' on public.events_app_events; '
        || pg_get_triggerdef(t.oid, true)
        || '; alter table public.events_app_events enable trigger ' || quote_ident(t.tgname) || ';'
      from pg_trigger t where t.tgrelid = 'public.events_app_events'::regclass
        and t.tgname = 'trg_events_app_zz_needs_review_isolation' and t.tgenabled = 'O'
    union all select 900000, 'grant',
      'public.events_app_isolate_needs_review()',
      public.custodial_release_authority_current_grant_definition('public.events_app_isolate_needs_review()')
  loop
    if obj.definition is null then raise exception 'event review recovery object missing: %', obj.identity; end if;
    update public.custodial_release_authority_restore_inventory
      set definition_sql = obj.definition,
          definition_sha256 = public.static_weekly_digest_text(obj.definition),
          captured_at = statement_timestamp()
      where object_kind = obj.kind and object_identity = obj.identity;
    get diagnostics changed = row_count;
    if changed > 1 then raise exception 'duplicate recovery identity: %', obj.identity; end if;
    if changed = 0 then
      select coalesce(max(restore_order), obj.bucket) + 1 into next_order
      from public.custodial_release_authority_restore_inventory
      where restore_order >= obj.bucket and restore_order < obj.bucket + 100000;
      if next_order >= obj.bucket + 100000 then raise exception 'event review recovery bucket exhausted'; end if;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order, object_kind, object_identity, definition_sql, definition_sha256)
      values (next_order, obj.kind, obj.identity, obj.definition, public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end;
$recovery$;
commit;
