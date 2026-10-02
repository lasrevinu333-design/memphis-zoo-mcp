begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

-- A cancelled review draft remains cancelled. Only a cancellation of an
-- explicitly resolved scheduled event may later become scheduled again.
alter table public.events_app_events add column cancelled_from_status text;
alter table public.events_app_events add constraint events_app_cancel_origin_check
  check (cancelled_from_status is null or
    (status='CANCELLED' and cancelled_from_status in ('SCHEDULED','NEEDS_REVIEW')));

create table public.events_app_transition_receipts (
  operation_id uuid primary key,
  event_id uuid not null references public.events_app_events(id) on delete cascade,
  action text not null check (action in ('cancel','restore')),
  expected_revision integer not null check (expected_revision>0),
  actor_manager_id uuid not null references public.ops_manager_managers(manager_id),
  request_digest text not null,
  history_id uuid not null references public.events_app_event_history(id) on delete cascade,
  result_record jsonb not null check (jsonb_typeof(result_record)='object'),
  created_at timestamptz not null default statement_timestamp()
);
create index events_app_transition_receipts_event_idx
  on public.events_app_transition_receipts(event_id,created_at);
alter table public.events_app_transition_receipts enable row level security;
alter table public.events_app_transition_receipts force row level security;
revoke all on public.events_app_transition_receipts from public,anon,authenticated,service_role,custodial_application_reader;

-- The old five-argument command remains necessary for create/update and old
-- recovery identity, but must not remain an unconditional cancel writer.
do $retire_old_cancel$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.app_apply_event_command(text,uuid,jsonb,text,text)'::regprocedure);
  if strpos(v_definition,$needle$elsif v_command='cancel' then$needle$)=0 then
    raise exception 'unexpected legacy event cancel branch; refusing blind rewrite';
  end if;
  v_definition:=replace(v_definition,$needle$elsif v_command='cancel' then$needle$,
    $replacement$elsif v_command='cancel' then
    raise exception using errcode='22023',message='event cancellation requires expected revision and operation id';$replacement$);
  execute v_definition;
end $retire_old_cancel$;

create function public.app_event_cancellation_transition_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $function$
begin
  if tg_op='UPDATE' and
    ((old.status in ('SCHEDULED','NEEDS_REVIEW') and new.status='CANCELLED')
      or (old.status='CANCELLED' and new.status='SCHEDULED'))
    and current_setting('app.event_cancellation_transition',true) is distinct from 'on' then
    raise exception using errcode='42501',message='revision-bound named manager event transition is required';
  end if;
  return new;
end $function$;
revoke all on function public.app_event_cancellation_transition_guard()
  from public,anon,authenticated,service_role,custodial_application_reader;
create trigger trg_app_event_cancellation_transition_guard
before update on public.events_app_events for each row
execute function public.app_event_cancellation_transition_guard();

create function public.app_transition_event_cancellation(
  p_event_id uuid,p_action text,p_expected_revision integer,
  p_operation_id uuid,p_manager_id uuid,p_reason text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions as $function$
declare
  v_manager public.ops_manager_managers%rowtype;
  v_old public.events_app_events%rowtype;
  v_new public.events_app_events%rowtype;
  v_receipt public.events_app_transition_receipts%rowtype;
  v_previous jsonb;
  v_history_id uuid;
  v_reason text:=left(coalesce(nullif(btrim(p_reason),''),
    case when p_action='restore' then 'Manager-confirmed ordinary cancellation recovery.'
      else 'Manager-confirmed event cancellation.' end),1000);
  v_digest text;
  v_now timestamptz:=statement_timestamp();
begin
  if p_event_id is null or p_action not in ('cancel','restore') or p_action is null
    or p_expected_revision is null or p_expected_revision<1
    or p_operation_id is null or p_manager_id is null then
    raise exception using errcode='22023',message='event, action, revision, operation and named manager are required';
  end if;
  select * into v_manager from public.ops_manager_managers m
    where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null
      and m.is_system_principal=false
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]
    for share;
  if v_manager.manager_id is null or nullif(btrim(v_manager.display_name),'') is null then
    raise exception using errcode='42501',message='active named manager authority is required for event transition';
  end if;
  v_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'event_id',p_event_id,'action',p_action,'expected_revision',p_expected_revision,
    'manager_id',p_manager_id,'reason',v_reason));
  select * into v_old from public.events_app_events e where e.id=p_event_id for update;
  if v_old.id is null then raise exception using errcode='P0002',message='event not found'; end if;
  select * into v_receipt from public.events_app_transition_receipts r
    where r.operation_id=p_operation_id;
  if v_receipt.operation_id is not null then
    if v_receipt.event_id=p_event_id and v_receipt.action=p_action
      and v_receipt.expected_revision=p_expected_revision
      and v_receipt.actor_manager_id=p_manager_id and v_receipt.request_digest=v_digest then
      return jsonb_build_object('event',v_receipt.result_record,'history_id',v_receipt.history_id,
        'operation_id',p_operation_id,'action',p_action,'replayed',true,
        'reminders','current eligibility revalidation pending');
    end if;
    raise exception using errcode='40901',message='Event operation id belongs to a different request.';
  end if;
  if v_old.revision is distinct from p_expected_revision then
    raise exception using errcode='40901',message='Event changed since this preview. Refresh and review before saving.';
  end if;
  if p_action='cancel' then
    if v_old.status not in ('SCHEDULED','NEEDS_REVIEW') or v_old.superseded_by_event_id is not null then
      raise exception using errcode='40901',message='Only a current scheduled or review event can be cancelled.';
    end if;
  else
    if v_old.status<>'CANCELLED' or v_old.cancelled_from_status is distinct from 'SCHEDULED'
      or v_old.superseded_by_event_id is not null or v_old.archived_at is not null
      or coalesce(v_old.needs_review,false) or v_old.event_scope='UNKNOWN' then
      raise exception using errcode='40901',message='Only a resolved ordinary cancellation can be restored.';
    end if;
    if v_old.end_instant_utc is null or v_old.end_instant_utc<=v_now then
      raise exception using errcode='40901',message='Event occurrence is past or lacks a confirmed Chicago instant; correct it before restoring.';
    end if;
    if v_old.event_scope='ZOO_WIDE' then
      if not exists(select 1 from public.event_venues ev
          where ev.id=v_old.primary_venue_id and ev.active and ev.event_scope='ZOO_WIDE') then
        raise exception using errcode='40901',message='Zoo-wide venue is no longer eligible.';
      end if;
    elsif v_old.event_scope in ('SINGLE_VENUE','MULTI_VENUE') then
      if v_old.primary_venue_id is null or not(v_old.primary_venue_id=any(v_old.venue_ids))
        or (v_old.event_scope='MULTI_VENUE' and cardinality(v_old.venue_ids)<2)
        or exists(select 1 from unnest(v_old.venue_ids) selected(id)
          left join public.event_venues ev on ev.id=selected.id
          where ev.id is null or not ev.active or not ev.eligible_event_venue
            or ev.event_scope='ZOO_WIDE') then
        raise exception using errcode='40901',message='Event venue is no longer eligible; manager correction is required.';
      end if;
    elsif v_old.event_scope<>'OFFSITE' then
      raise exception using errcode='40901',message='Event scope is not restorable.';
    end if;
  end if;
  v_previous:=to_jsonb(v_old);
  perform set_config('app.event_cancellation_transition','on',true);
  if p_action='cancel' then
    update public.events_app_events e set status='CANCELLED',cancelled_from_status=v_old.status,
      cancelled_at=v_now,cancelled_by=v_manager.display_name,cancelled_by_manager_id=p_manager_id,
      cancellation_reason=v_reason,overridden_by=v_manager.display_name,overridden_at=v_now,
      updated_by_manager_id=p_manager_id,revision=e.revision+1,updated_at=v_now
      where e.id=p_event_id returning * into v_new;
  else
    update public.events_app_events e set status='SCHEDULED',cancelled_from_status=null,
      cancelled_at=null,cancelled_by=null,cancelled_by_manager_id=null,cancellation_reason=null,
      overridden_by=v_manager.display_name,overridden_at=v_now,
      updated_by_manager_id=p_manager_id,revision=e.revision+1,updated_at=v_now
      where e.id=p_event_id returning * into v_new;
  end if;
  insert into public.events_app_event_history
    (event_id,action,actor,actor_manager_id,reason,previous_record,new_record,created_at)
    values(p_event_id,p_action,v_manager.display_name,p_manager_id,v_reason,v_previous,to_jsonb(v_new),v_now)
    returning id into v_history_id;
  insert into public.events_app_transition_receipts
    (operation_id,event_id,action,expected_revision,actor_manager_id,request_digest,history_id,result_record,created_at)
    values(p_operation_id,p_event_id,p_action,p_expected_revision,p_manager_id,v_digest,v_history_id,to_jsonb(v_new),v_now);
  return jsonb_build_object('event',to_jsonb(v_new),'history_id',v_history_id,
    'operation_id',p_operation_id,'action',p_action,'replayed',false,
    'reminders','current eligibility revalidation pending');
end $function$;
revoke all on function public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)
  to postgres,service_role;

-- Forward recovery inventory is appended/rebound only for Event-owned objects.
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
        'public.app_event_cancellation_transition_guard()'::regprocedure,
        'public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)'::regprocedure])
    union all select 1000,'relation','public.events_app_events',
      public.custodial_release_authority_current_relation_definition('public.events_app_events')
    union all select 1000,'relation','public.events_app_transition_receipts',
      public.custodial_release_authority_current_relation_definition('public.events_app_transition_receipts')
    union all select 200000,'column','public.events_app_events:cancelled_from_status',
      public.custodial_release_authority_current_column_definition('public.events_app_events:cancelled_from_status')
    union all select 200000,'column','public.events_app_transition_receipts:'||a.attname,
      public.custodial_release_authority_current_column_definition('public.events_app_transition_receipts:'||a.attname)
      from pg_attribute a where a.attrelid='public.events_app_transition_receipts'::regclass
        and a.attnum>0 and not a.attisdropped
    union all select 300000,'column_set','public.events_app_events',
      public.custodial_release_authority_current_column_set_definition('public.events_app_events')
    union all select 300000,'column_set','public.events_app_transition_receipts',
      public.custodial_release_authority_current_column_set_definition('public.events_app_transition_receipts')
    union all select 400000,'relation_state','public.events_app_transition_receipts',
      public.custodial_release_authority_current_relation_state_definition('public.events_app_transition_receipts')
    union all select 500000,'constraint','public.events_app_events:events_app_cancel_origin_check',
      public.custodial_release_authority_current_constraint_definition('public.events_app_events:events_app_cancel_origin_check')
    union all select 500000,'constraint',c.conrelid::regclass::text||':'||c.conname,
      public.custodial_release_authority_current_constraint_definition(c.conrelid::regclass::text||':'||c.conname)
      from pg_constraint c where c.conrelid='public.events_app_transition_receipts'::regclass
    union all select 600000,'index',i.indexrelid::regclass::text,
      public.custodial_release_authority_current_index_definition(i.indexrelid::regclass::text)
      from pg_index i where i.indrelid='public.events_app_transition_receipts'::regclass
    union all select 700000,'trigger','public.events_app_events.trg_app_event_cancellation_transition_guard',
      'drop trigger if exists trg_app_event_cancellation_transition_guard on public.events_app_events; '
      ||pg_get_triggerdef(t.oid,true)||'; alter table public.events_app_events enable trigger trg_app_event_cancellation_transition_guard;'
      from pg_trigger t where t.tgrelid='public.events_app_events'::regclass
        and t.tgname='trg_app_event_cancellation_transition_guard'
    union all select 900000,'grant',r.identity,
      public.custodial_release_authority_current_grant_definition(r.identity)
      from (values('public.app_apply_event_command(text,uuid,jsonb,text,text)'),
        ('public.app_event_cancellation_transition_guard()'),
        ('public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)'),
        ('public.events_app_transition_receipts')) r(identity)
  loop
    if obj.definition is null then raise exception 'event transition recovery object missing: %',obj.identity; end if;
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
