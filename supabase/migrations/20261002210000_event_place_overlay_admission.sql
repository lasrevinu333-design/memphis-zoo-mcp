-- Event-only admission of the explicit legacy Event Venue -> canonical Place overlay.
-- Legacy venue/group UUIDs, raw source evidence and cleaning authority are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

create function public.app_event_place_authority(p_record jsonb,p_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $function$
declare
  v_overlay jsonb;
  v_row jsonb;
  v_id text;
  v_primary text:=nullif(p_record->>'primary_venue_id','');
  v_count integer:=0;
  v_primary_display text;
  v_primary_status text;
begin
  if p_record is null or jsonb_typeof(p_record)<>'object' or p_at is null or not isfinite(p_at) then
    raise exception using errcode='22023',message='Event record and finite overlay clock required';
  end if;
  v_overlay:=public.custodial_place_event_venue_overlay(p_at);
  if jsonb_typeof(v_overlay->'venues')<>'array' then
    raise exception using errcode='55000',message='Event venue overlay unavailable';
  end if;
  for v_id in
    select distinct selected.id from (
      select v_primary as id
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(p_record->'venue_ids')='array'
        then p_record->'venue_ids' else '[]'::jsonb end)
    ) selected where selected.id is not null and selected.id<>''
  loop
    v_count:=v_count+1;
    if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('admissible',false,'review_reason','invalid_legacy_venue_id','venue_id',v_id);
    end if;
    select item.value into v_row from jsonb_array_elements(v_overlay->'venues') item(value)
      where item.value->>'venue_id'=v_id;
    if v_row is null then
      return jsonb_build_object('admissible',false,'review_reason','legacy_venue_missing','venue_id',v_id);
    end if;
    if v_row->>'mapping_status' not in ('MAPPED','UNMAPPED')
      or coalesce((v_row->>'event_eligible')::boolean,false) is not true then
      return jsonb_build_object('admissible',false,'review_reason',coalesce(v_row->>'review_reason','legacy_venue_ineligible'),
        'mapping_status',v_row->>'mapping_status','venue_id',v_id,'source_drift',v_row->'source_drift');
    end if;
    if v_id=v_primary then
      v_primary_status:=v_row->>'mapping_status';
      if v_primary_status='MAPPED' then v_primary_display:=v_row->>'display_name'; end if;
    end if;
    v_row:=null;
  end loop;
  -- Older scheduled rows can be group-only. No bridge assignment is invented.
  if v_count=0 and coalesce(p_record->>'event_scope','UNKNOWN') not in ('ZOO_WIDE','OFFSITE','SINGLE_VENUE','MULTI_VENUE') then
    return jsonb_build_object('admissible',false,'review_reason','unresolved_event_scope');
  end if;
  return jsonb_build_object('admissible',true,'mapping_status',coalesce(v_primary_status,'LEGACY_UNMAPPED'),
    'primary_display_name',v_primary_display,'venue_count',v_count,
    'capability_authority',case when v_primary_status='MAPPED' then 'CANONICAL_EVENT_ONLY' else 'LEGACY_UNMAPPED' end);
end $function$;
revoke all on function public.app_event_place_authority(jsonb,timestamptz)
  from public,anon,authenticated,service_role,custodial_application_reader;
grant execute on function public.app_event_place_authority(jsonb,timestamptz)
  to postgres,service_role,custodial_application_reader;

create function public.app_event_place_admission_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_authority jsonb;
begin
  if new.status='SCHEDULED' and coalesce(new.needs_review,false)=false then
    v_authority:=public.app_event_place_authority(to_jsonb(new),clock_timestamp());
    if (v_authority->>'admissible')::boolean is not true then
      raise exception using errcode='40901',message='Event venue mapping is inactive or requires manager review; refresh the venue before scheduling.',
        detail=v_authority::text;
    end if;
  end if;
  return new;
end $function$;
revoke all on function public.app_event_place_admission_guard()
  from public,anon,authenticated,service_role,custodial_application_reader;
create trigger trg_app_event_place_admission_guard
before insert or update on public.events_app_events for each row
execute function public.app_event_place_admission_guard();

create or replace function public.mz_event_reminder_schedule(
  p_event_id uuid,p_event_revision integer,p_employee_id uuid,p_notification_kind text
) returns table(reminder_date date,scheduled_for timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $function$
  select candidate.reminder_date,candidate.scheduled_for
  from public.events_app_events e
  cross join lateral public.mz_event_reminder_schedule_candidate(to_jsonb(e),p_employee_id,p_notification_kind) candidate
  where e.id=p_event_id and e.revision=p_event_revision
    and (public.app_event_place_authority(to_jsonb(e),statement_timestamp())->>'admissible')::boolean is true
$function$;
revoke all on function public.mz_event_reminder_schedule(uuid,integer,uuid,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.mz_event_reminder_schedule(uuid,integer,uuid,text) to postgres,service_role;

-- Preview must not advertise employees for a mapped venue that is no longer admitted.
do $preview_guard$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.mz_preview_event_impact(jsonb,uuid,uuid,integer)'::regprocedure);
  if strpos(v_definition,'  with projected as (')=0
    or strpos(v_definition,'app_event_place_authority(v_candidate')>0 then
    raise exception 'Unexpected Event impact preview definition; refusing overlay insertion';
  end if;
  v_definition:=replace(v_definition,'  with projected as (',
    '  if (public.app_event_place_authority(v_candidate,v_now)->>''admissible'')::boolean is not true then'||chr(10)||
    '    raise exception using errcode=''40901'',message=''Event venue mapping requires manager review; refresh impact preview.'';'||chr(10)||
    '  end if;'||chr(10)||'  with projected as (');
  execute v_definition;
end $preview_guard$;

-- Rebind only changed Event authority, leaving unrelated release inventory drift alone.
do $recovery$ declare obj record;ord integer;changed integer;begin
  if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'Recovery inventory immutability unavailable';end if;
  alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
    from pg_proc p where p.oid=any(array[
      'public.app_event_place_authority(jsonb,timestamptz)'::regprocedure,
      'public.app_event_place_admission_guard()'::regprocedure,
      'public.mz_event_reminder_schedule(uuid,integer,uuid,text)'::regprocedure,
      'public.mz_preview_event_impact(jsonb,uuid,uuid,integer)'::regprocedure])
    union all select 700000,'trigger','public.events_app_events.trg_app_event_place_admission_guard',
      'drop trigger if exists trg_app_event_place_admission_guard on public.events_app_events; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table public.events_app_events enable trigger trg_app_event_place_admission_guard;'
      from pg_trigger t where t.tgrelid='public.events_app_events'::regclass and t.tgname='trg_app_event_place_admission_guard'
    union all select 900000,'grant',x.identity,public.custodial_release_authority_current_grant_definition(x.identity)
      from (values('public.app_event_place_authority(jsonb,timestamptz)'),
        ('public.app_event_place_admission_guard()'),
        ('public.mz_event_reminder_schedule(uuid,integer,uuid,text)'),
        ('public.mz_preview_event_impact(jsonb,uuid,uuid,integer)')) x(identity)
  loop
    if obj.definition is null then raise exception 'Missing Event venue recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and object_identity=obj.identity;
    get diagnostics changed=row_count;if changed>1 then raise exception 'Duplicate Event recovery identity %',obj.identity;end if;
    if changed=0 then
      select n into ord from generate_series(obj.bucket+1,obj.bucket+99999) n
      where not exists(select 1 from public.custodial_release_authority_restore_inventory where restore_order=n)
      order by n limit 1;
      if ord is null then raise exception 'Event recovery order exhausted';end if;
      insert into public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(ord,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;
commit;
