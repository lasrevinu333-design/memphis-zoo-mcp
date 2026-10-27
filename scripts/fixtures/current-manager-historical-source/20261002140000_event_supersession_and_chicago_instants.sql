begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Keep historical civil labels intact. New manager writes additionally pin
-- chosen UTC instants; null means a legacy row not yet explicitly interpreted.
alter table public.events_app_events
  add column start_instant_utc timestamptz,
  add column end_instant_utc timestamptz,
  add column superseded_by_event_id uuid references public.events_app_events(id) on delete restrict,
  add column superseded_at timestamptz,
  add column superseded_by_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
  add column supersession_request_digest text;
alter table public.events_app_events drop constraint events_app_events_status_check;
alter table public.events_app_events add constraint events_app_events_status_check
  check (status in ('SCHEDULED','CANCELLED','ARCHIVED','NEEDS_REVIEW','SUPERSEDED'));
alter table public.events_app_events add constraint events_app_event_instant_check check (
  (start_instant_utc is null and end_instant_utc is null) or
  (start_instant_utc is not null and end_instant_utc is not null
    and end_instant_utc>start_instant_utc
    and (start_instant_utc at time zone 'America/Chicago')=(event_date+start_time)
    and (end_instant_utc at time zone 'America/Chicago')=(end_date+end_time))
);
alter table public.events_app_events add constraint events_app_supersession_state_check check (
  (status='SUPERSEDED' and superseded_by_event_id is not null and superseded_at is not null
    and superseded_by_manager_id is not null and supersession_request_digest is not null
    and superseded_by_event_id<>id)
  or (status<>'SUPERSEDED' and superseded_by_event_id is null and superseded_at is null
    and superseded_by_manager_id is null and supersession_request_digest is null)
);
create index events_app_superseded_by_event_id_idx on public.events_app_events(superseded_by_event_id)
  where superseded_by_event_id is not null;
comment on column public.events_app_events.start_instant_utc is
  'Explicit America/Chicago start instant chosen by manager input; null only for legacy/uninterpreted event rows.';
comment on column public.events_app_events.end_instant_utc is
  'Explicit America/Chicago end instant chosen by manager input; null only for legacy/uninterpreted event rows.';

-- Preserve the existing named-manager writer/CAS/history while adding the
-- exact instants to its atomic create and update paths.
do $event_writer$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.app_apply_event_command(text,uuid,jsonb,text,text)'::regprocedure);
  if strpos(v_definition,'start_time,end_time,attendee_count,notes,')=0
     or strpos(v_definition,$needle$(v_record->>'end_time')::time,nullif(v_record->>'attendee_count','')::integer$needle$)=0
     or strpos(v_definition,$needle$end_time=(v_record->>'end_time')::time,$needle$)=0
     or strpos(v_definition,'start_instant_utc')>0 then
    raise exception 'unexpected event writer shape; do not guess instant authority';
  end if;
  v_definition:=replace(v_definition,'start_time,end_time,attendee_count,notes,',
    'start_time,end_time,start_instant_utc,end_instant_utc,attendee_count,notes,');
  v_definition:=replace(v_definition,$needle$(v_record->>'end_time')::time,nullif(v_record->>'attendee_count','')::integer$needle$,
    $replacement$(v_record->>'end_time')::time,(v_record->>'start_instant_utc')::timestamptz,(v_record->>'end_instant_utc')::timestamptz,nullif(v_record->>'attendee_count','')::integer$replacement$);
  v_definition:=replace(v_definition,$needle$end_time=(v_record->>'end_time')::time,$needle$,
    $replacement$end_time=(v_record->>'end_time')::time,start_instant_utc=(v_record->>'start_instant_utc')::timestamptz,end_instant_utc=(v_record->>'end_instant_utc')::timestamptz,$replacement$);
  if strpos(v_definition,$needle$if v_command='create' then$needle$)=0
    or strpos(v_definition,$needle$update public.events_app_events set
      event_name=$needle$)=0 then
    raise exception 'unexpected event writer command branches; do not guess instant authority';
  end if;
  v_definition:=replace(v_definition,$needle$if v_command='create' then$needle$,
    $replacement$if v_command='create' then
    if nullif(v_record->>'start_instant_utc','') is null or nullif(v_record->>'end_instant_utc','') is null then
      raise exception using errcode='22023',message='New event requires explicit Chicago start and end instants';
    end if;$replacement$);
  v_definition:=replace(v_definition,$needle$update public.events_app_events set
      event_name=$needle$,
    $replacement$if (nullif(v_record->>'start_instant_utc','') is null) <> (nullif(v_record->>'end_instant_utc','') is null) then
      raise exception using errcode='22023',message='Event start and end instants must be supplied together';
    end if;
    if nullif(v_record->>'start_instant_utc','') is null and (
      nullif(v_previous->>'start_instant_utc','') is not null
      or nullif(v_previous->>'end_instant_utc','') is not null
      or (v_previous->>'event_date')::date is distinct from (v_record->>'event_date')::date
      or (v_previous->>'end_date')::date is distinct from (v_record->>'end_date')::date
      or (v_previous->>'start_time')::time is distinct from (v_record->>'start_time')::time
      or (v_previous->>'end_time')::time is distinct from (v_record->>'end_time')::time
    ) then
      raise exception using errcode='22023',message='Changed event time requires explicit Chicago start and end instants';
    end if;
    update public.events_app_events set
      event_name=$replacement$);
  execute v_definition;
end $event_writer$;

create function public.app_event_supersession_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $function$
begin
  if tg_op='INSERT' then
    if new.status='SUPERSEDED' then raise exception using errcode='42501',message='new event cannot be born superseded'; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.status='SUPERSEDED' then raise exception using errcode='42501',message='superseded event history cannot be deleted'; end if;
    return old;
  end if;
  if old.status='SUPERSEDED' and new is distinct from old then
    raise exception using errcode='42501',message='superseded event history is immutable';
  end if;
  if old.status<>'SUPERSEDED' and new.status='SUPERSEDED'
    and current_setting('app.event_supersession_command',true) is distinct from 'on' then
    raise exception using errcode='42501',message='named manager supersession command is required';
  end if;
  return new;
end $function$;
revoke all on function public.app_event_supersession_guard() from public,anon,authenticated,service_role,custodial_application_reader;
create trigger trg_app_event_supersession_guard
before insert or update or delete on public.events_app_events
for each row execute function public.app_event_supersession_guard();

-- Replacing an event is one authorized transaction: a new event is created,
-- then the exact old revision is superseded and immutable history captures the
-- link. Parser/import never infers this transition. An exact operation replay
-- returns the linked replacement without creating another event.
create function public.app_replace_event_authoritative(
  p_event_id uuid,p_expected_revision integer,p_record jsonb,p_manager_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $function$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_old public.events_app_events%rowtype;
  v_new public.events_app_events%rowtype;
  v_previous jsonb;
  v_operation_id uuid;
  v_created jsonb;
  v_request_digest text;
  v_now timestamptz:=statement_timestamp();
begin
  select * into v_manager from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if v_manager.manager_id is null or nullif(btrim(v_manager.display_name),'') is null then
    raise exception using errcode='42501',message='active named manager authority is required for event replacement';
  end if;
  if p_event_id is null or p_expected_revision is null or p_expected_revision<1
    or jsonb_typeof(p_record) is distinct from 'object' then
    raise exception using errcode='22023',message='event id, expected revision and normalized replacement are required';
  end if;
  begin v_operation_id:=(p_record->>'operation_id')::uuid;
  exception when others then raise exception using errcode='22023',message='replacement operation id must be a UUID'; end;
  if v_operation_id is null or p_record->>'status'<>'SCHEDULED'
    or coalesce((p_record->>'needs_review')::boolean,true)
    or nullif(p_record->>'start_instant_utc','') is null
    or nullif(p_record->>'end_instant_utc','') is null then
    raise exception using errcode='22023',message='resolved scheduled replacement and explicit Chicago instants are required';
  end if;
  v_request_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'source_event_id',p_event_id,'expected_revision',p_expected_revision,
    'manager_id',p_manager_id,'record',p_record));
  select * into v_old from public.events_app_events e where e.id=p_event_id for update;
  if not found then raise exception using errcode='P0002',message='source event not found'; end if;
  if v_old.status='SUPERSEDED' then
    select * into v_new from public.events_app_events e where e.id=v_old.superseded_by_event_id;
    if v_new.operation_id=v_operation_id and v_old.supersession_request_digest=v_request_digest then
      return jsonb_build_object('old_event',to_jsonb(v_old),'replacement_event',to_jsonb(v_new),'replayed',true);
    end if;
    raise exception using errcode='40901',message='Event was already superseded by another replacement. Refresh before saving.';
  end if;
  if v_old.status<>'SCHEDULED' or coalesce(v_old.needs_review,false) then
    raise exception using errcode='40901',message='Only an active resolved event can be replaced. Refresh before saving.';
  end if;
  if v_old.revision is distinct from p_expected_revision then
    raise exception using errcode='40901',message='Event changed since this preview. Refresh and review before saving.';
  end if;
  if exists(select 1 from public.events_app_events e where e.operation_id=v_operation_id) then
    raise exception using errcode='40901',message='Replacement operation already belongs to another event.';
  end if;
  v_previous:=to_jsonb(v_old);
  v_created:=public.app_apply_event_command('create',null,
    p_record||jsonb_build_object('actor_manager_id',p_manager_id,'manually_overridden',true),null,
    'Manager-confirmed replacement event.');
  select * into v_new from public.events_app_events e where e.id=(v_created->>'id')::uuid;
  if v_new.id is null or v_new.status<>'SCHEDULED' or v_new.operation_id<>v_operation_id then
    raise exception using errcode='22023',message='replacement event did not persist as scheduled';
  end if;
  perform set_config('app.event_supersession_command','on',true);
  update public.events_app_events e set status='SUPERSEDED',superseded_by_event_id=v_new.id,
    superseded_at=v_now,superseded_by_manager_id=p_manager_id,supersession_request_digest=v_request_digest,
    revision=e.revision+1,updated_at=v_now
    where e.id=v_old.id returning * into v_old;
  insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(v_old.id,'supersede',v_manager.display_name,p_manager_id,
      'Manager-confirmed replacement; original event retained.',v_previous,to_jsonb(v_old),v_now);
  insert into public.events_app_event_history(event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(v_new.id,'create_replacement',v_manager.display_name,p_manager_id,
      'Replacement for event '||v_old.id::text,null,to_jsonb(v_new),v_now);
  return jsonb_build_object('old_event',to_jsonb(v_old),'replacement_event',to_jsonb(v_new),'replayed',false);
end $function$;
revoke all on function public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.app_replace_event_authoritative(uuid,integer,jsonb,uuid) to postgres,service_role;

-- Rebind exactly the Event-owned release recovery objects. Any unrelated
-- inventory drift remains a separate HOLD and is never implicitly repaired.
do $recovery$
declare obj record; next_order integer; changed integer;
begin
  if not exists(select 1 from pg_trigger where
    tgrelid='public.custodial_release_authority_restore_inventory'::regclass
    and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='O') then
    raise exception 'release recovery inventory immutability is unavailable';
  end if;
  alter table public.custodial_release_authority_restore_inventory
    disable trigger trg_custodial_release_authority_restore_inventory_immutable;
  for obj in
    select 100000 bucket,'function'::text kind,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
    from pg_proc p where p.oid=any(array[
      'public.app_apply_event_command(text,uuid,jsonb,text,text)'::regprocedure,
      'public.app_event_supersession_guard()'::regprocedure,
      'public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)'::regprocedure])
    union all select 1000,'relation','public.events_app_events',
      public.custodial_release_authority_current_relation_definition('public.events_app_events')
    union all select 200000,'column','public.events_app_events:'||a.attname,
      public.custodial_release_authority_current_column_definition('public.events_app_events:'||a.attname)
      from pg_attribute a where a.attrelid='public.events_app_events'::regclass and a.attnum>0 and not a.attisdropped
        and a.attname in ('start_instant_utc','end_instant_utc','superseded_by_event_id','superseded_at','superseded_by_manager_id','supersession_request_digest')
    union all select 300000,'column_set','public.events_app_events',
      public.custodial_release_authority_current_column_set_definition('public.events_app_events')
    union all select 500000,'constraint','public.events_app_events:'||c.conname,
      public.custodial_release_authority_current_constraint_definition('public.events_app_events:'||c.conname)
      from pg_constraint c where c.conrelid='public.events_app_events'::regclass
        and c.conname in ('events_app_events_status_check','events_app_event_instant_check','events_app_supersession_state_check',
          'events_app_events_superseded_by_event_id_fkey','events_app_events_superseded_by_manager_id_fkey')
    union all select 600000,'index','public.events_app_superseded_by_event_id_idx',
      public.custodial_release_authority_current_index_definition('public.events_app_superseded_by_event_id_idx')
    union all select 700000,'trigger','public.events_app_events.trg_app_event_supersession_guard',
      'drop trigger if exists trg_app_event_supersession_guard on public.events_app_events; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table public.events_app_events enable trigger trg_app_event_supersession_guard;'
      from pg_trigger t where t.tgrelid='public.events_app_events'::regclass and t.tgname='trg_app_event_supersession_guard'
    union all select 900000,'grant',r.identity,
      public.custodial_release_authority_current_grant_definition(r.identity)
      from (values('public.app_apply_event_command(text,uuid,jsonb,text,text)'),
        ('public.app_event_supersession_guard()'),
        ('public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)')) r(identity)
  loop
    if obj.definition is null then raise exception 'event supersession recovery object missing: %',obj.identity; end if;
    update public.custodial_release_authority_restore_inventory
      set object_identity=obj.identity,definition_sql=obj.definition,
        definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'duplicate event recovery identity: %',obj.identity; end if;
    if changed=0 then
      select candidate into next_order
      from generate_series(obj.bucket,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) candidate
      where not exists(select 1 from public.custodial_release_authority_restore_inventory i where i.restore_order=candidate)
      order by candidate limit 1;
      if next_order is null then raise exception 'event recovery bucket exhausted'; end if;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;

commit;
