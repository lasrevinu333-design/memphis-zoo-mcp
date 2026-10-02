begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Historical closed tickets remain closed with an unknown outcome. Do not
-- re-label them as fixed or infer that an external work order existed.
alter table public.maintenance_tickets
  add column resolution_outcome text,
  add column external_work_order_reference text,
  add column resolution_actor_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
  add constraint maintenance_ticket_resolution_outcome_check
    check (resolution_outcome is null or resolution_outcome in ('mark_fixed','work_order_sent')),
  add constraint maintenance_ticket_resolution_evidence_check check ((
    resolution_outcome is null and external_work_order_reference is null and resolution_actor_manager_id is null
    or resolution_outcome='mark_fixed' and status='closed' and closed_at is not null
       and resolution_actor_manager_id is not null and external_work_order_reference is null
    or resolution_outcome='work_order_sent' and status='closed' and closed_at is not null
       and resolution_actor_manager_id is not null and length(btrim(external_work_order_reference)) between 1 and 120
  ) is true);

-- Preserve the old column order for dependent callers; append the genuine
-- source label rather than treating every completion issue as a work order.
create or replace view public.v_open_maintenance_tickets as
select mt.id as ticket_id,
  coalesce(mt.location_code_snapshot,l.location_code) as location_code,
  coalesce(mt.location_name_snapshot,l.location_name) as location_name,
  mt.reported_at as date_submitted,
  mt.issue_summary as maintenance_issue,
  coalesce(mt.reporter_name_snapshot,e.display_name) as reported_by,
  mt.fixture_type,mt.fixture_identifier,mt.out_of_order,mt.status,mt.issue_payload,
  mt.close_notes,mt.created_at,
  to_char(timezone('America/Chicago',mt.reported_at),'MM/DD/YYYY') as date_submitted_date_display,
  to_char(timezone('America/Chicago',mt.reported_at),'MM/DD/YYYY HH12:MI AM')||' Central' as date_submitted_display,
  to_char(timezone('America/Chicago',mt.created_at),'MM/DD/YYYY HH12:MI AM')||' Central' as created_at_display,
  mt.issue_source
from public.maintenance_tickets mt
left join public.locations l on l.id=mt.location_id
left join public.employees e on e.id=mt.reported_by_employee_id
where mt.status='open';

create table public.maintenance_ticket_outcome_history (
  outcome_id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete restrict,
  outcome text not null check (outcome in ('mark_fixed','work_order_sent')),
  actor_manager_id uuid references public.ops_manager_managers(manager_id) on delete restrict,
  actor_name_snapshot text not null check (length(btrim(actor_name_snapshot)) between 1 and 200),
  external_work_order_reference text,
  notes text,
  previous_status text not null,
  created_at timestamptz not null default statement_timestamp(),
  check ((outcome='mark_fixed' and external_work_order_reference is null
    or outcome='work_order_sent' and length(btrim(external_work_order_reference)) between 1 and 120) is true)
);
create unique index maintenance_ticket_outcome_once on public.maintenance_ticket_outcome_history(ticket_id);
create index maintenance_ticket_outcome_actor_time on public.maintenance_ticket_outcome_history(actor_manager_id,created_at desc);
alter table public.maintenance_ticket_outcome_history enable row level security;
alter table public.maintenance_ticket_outcome_history force row level security;
revoke all on table public.maintenance_ticket_outcome_history from public,anon,authenticated,service_role,custodial_application_reader;

create function public.maintenance_ticket_outcome_history_immutable()
returns trigger language plpgsql security invoker set search_path to 'pg_catalog','public'
as $function$
begin
  raise exception using errcode='55000',message='maintenance outcome history is append-only';
end
$function$;
create trigger maintenance_ticket_outcome_history_immutable
before update or delete on public.maintenance_ticket_outcome_history
for each row execute function public.maintenance_ticket_outcome_history_immutable();
revoke all on function public.maintenance_ticket_outcome_history_immutable() from public,anon,authenticated,service_role;

create function public.custodial_set_maintenance_ticket_outcome(
  p_ticket_id uuid,p_outcome text,p_manager_id uuid,p_external_work_order_reference text,p_notes text,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_ticket public.maintenance_tickets%rowtype;
  v_manager public.ops_manager_managers%rowtype;
  v_outcome text:=btrim(coalesce(p_outcome,''));
  v_reference text:=nullif(btrim(coalesce(p_external_work_order_reference,'')),'');
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_at timestamptz:=statement_timestamp();
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if p_ticket_id is null or p_manager_id is null or v_outcome not in ('mark_fixed','work_order_sent') then
    raise exception using errcode='22023',message='ticket, named manager, and supported outcome are required';
  end if;
  select * into v_manager from public.ops_manager_managers m
    where m.manager_id=p_manager_id and m.active=true and m.revoked_at is null
      and m.is_system_principal=false
      and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if not found or nullif(btrim(v_manager.display_name),'') is null then
    raise exception using errcode='42501',message='active named manager authority is required';
  end if;
  if v_outcome='work_order_sent' and (v_reference is null or length(v_reference)>120) then
    raise exception using errcode='22023',message='a real external work-order reference is required';
  end if;
  if v_outcome='mark_fixed' and v_reference is not null then
    raise exception using errcode='22023',message='Mark fixed cannot claim an external work-order reference';
  end if;
  if v_notes is not null and length(v_notes)>1000 then
    raise exception using errcode='22023',message='outcome notes exceed 1000 characters';
  end if;
  select * into v_ticket from public.maintenance_tickets t where t.id=p_ticket_id for update;
  if not found then raise exception using errcode='P0002',message='maintenance reminder not found'; end if;
  if v_ticket.status<>'open' then
    raise exception using errcode='40901',message='Maintenance reminder already has a closed outcome. Refresh before acting.';
  end if;
  update public.maintenance_tickets t set status='closed',closed_at=v_at,
    closed_by=left(btrim(v_manager.display_name),200),close_notes=v_notes,closed_via='manager_issue_outcome',
    resolution_outcome=v_outcome,external_work_order_reference=v_reference,
    resolution_actor_manager_id=p_manager_id
    where t.id=p_ticket_id;
  insert into public.maintenance_ticket_outcome_history(
    ticket_id,outcome,actor_manager_id,actor_name_snapshot,external_work_order_reference,notes,previous_status,created_at
  ) values(p_ticket_id,v_outcome,p_manager_id,left(btrim(v_manager.display_name),200),v_reference,v_notes,v_ticket.status,v_at);
  return jsonb_build_object('ticket_id',p_ticket_id,'status','closed','outcome',v_outcome,
    'external_work_order_reference',v_reference,'actor_manager_id',p_manager_id,
    'actor_name',left(btrim(v_manager.display_name),200),'recorded_at',v_at);
end
$function$;
revoke all on function public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text) to postgres,service_role;
-- The historical close command could not distinguish a repair from an
-- externally sent order. Preserve its definition/history, but retire runtime
-- EXECUTE so it cannot silently close new reminders without an outcome.
revoke all on function public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)
  from public,anon,authenticated,service_role;

-- One manager-only read projection. Guest data stays behind the existing
-- approval flag and Marketing review, and protected saved-work payloads never
-- enter this queue. An open item in one source does not clear another.
create function public.custodial_manager_open_problems(
  p_manager_id uuid,p_limit integer,p_backend_execution_secret text
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),200));
  v_result jsonb;
begin
  perform public.custodial_require_backend_execution_secret(p_backend_execution_secret);
  if not exists(select 1 from public.ops_manager_managers m where m.manager_id=p_manager_id
    and m.active=true and m.revoked_at is null and m.is_system_principal=false
    and m.roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[]) then
    raise exception using errcode='42501',message='active named manager authority is required';
  end if;
  with items as (
    select 'maintenance'::text as source, t.id::text as source_id,
      case when t.issue_source='completion_form' then 'Cleaning issue / maintenance reminder'
        else 'Maintenance reminder' end as source_label,
      coalesce(t.location_name_snapshot,l.location_name,t.location_code_snapshot,l.location_code) as location,
      t.issue_summary as summary,t.reported_at as observed_at,'open'::text as status,
      t.issue_source as source_detail
    from public.maintenance_tickets t left join public.locations l on l.id=t.location_id
    where t.status='open'
    union all
    select 'guest'::text,g.id::text,'Approved guest issue'::text,
      coalesce(g.location_name,g.location_code),g.issue_type,g.submitted_at,'open'::text,g.severity
    from public.guest_cleanliness_reports g
    where g.status='open' and g.marketing_review_status='approved'
      and exists(select 1 from public.system_settings s where s.setting_key='guest_issues_feature_approved'
        and s.setting_value='true'::jsonb)
    union all
    select 'saved_work'::text,r.reconciliation_id::text,'Protected saved work needs review'::text,
      coalesce(l.location_name,l.location_code,'Location not available'),
      'Protected work requires manager review'::text,r.created_at,
      'quarantined'::text,'offline_reconciliation'::text
    from public.custodial_offline_reconciliation_records r
    left join public.locations l on l.id=r.location_id
    where r.state='quarantined' and not exists (
      select 1 from public.custodial_offline_reconciliation_dispositions d
      where d.reconciliation_id=r.reconciliation_id and d.disposition='superseded_by_new_occurrence'
    )
  ), bounded as (
    select * from items order by observed_at desc nulls last,source,source_id limit v_limit
  )
  select jsonb_build_object('total',(select count(*) from items),
    'items',coalesce(jsonb_agg(to_jsonb(b) order by b.observed_at desc nulls last,b.source,b.source_id),'[]'::jsonb))
    into v_result from bounded b;
  return v_result;
end
$function$;
revoke all on function public.custodial_manager_open_problems(uuid,integer,text)
  from public,anon,authenticated,custodial_application_reader;
grant execute on function public.custodial_manager_open_problems(uuid,integer,text) to postgres,service_role;

-- The existing release health gate has an exact terminal-writer identity
-- allowlist. Replace only the retired close writer with this outcome writer;
-- retaining the old identity there would mask an unauthorized second path.
do $health$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.custodial_backend_authority_health(text)'::regprocedure);
  if strpos(v_definition,'public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)')=0
     or strpos(v_definition,'public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)')>0 then
    raise exception 'unexpected backend authority health identity; do not alter the allowlist blindly';
  end if;
  execute replace(v_definition,
    'public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)',
    'public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)');
end $health$;

-- Capture the exact new authority and grant boundary in the immutable release
-- recovery inventory. Rebind the old RPC grant to its now-denied state so a
-- later recovery cannot silently re-enable undifferentiated closure.
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
      'public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)'::regprocedure,
      'public.custodial_manager_open_problems(uuid,integer,text)'::regprocedure,
      'public.maintenance_ticket_outcome_history_immutable()'::regprocedure,
      'public.custodial_backend_authority_health(text)'::regprocedure])
    union all select 1000,'relation','public.maintenance_tickets',
      public.custodial_release_authority_current_relation_definition('public.maintenance_tickets')
    union all select 1000,'relation','public.maintenance_ticket_outcome_history',
      public.custodial_release_authority_current_relation_definition('public.maintenance_ticket_outcome_history')
    union all select 200000,'column','public.maintenance_tickets:'||a.attname,
      public.custodial_release_authority_current_column_definition('public.maintenance_tickets:'||a.attname)
      from pg_attribute a where a.attrelid='public.maintenance_tickets'::regclass and a.attnum>0 and not a.attisdropped
        and a.attname in ('resolution_outcome','external_work_order_reference','resolution_actor_manager_id')
    union all select 200000,'column','public.maintenance_ticket_outcome_history:'||a.attname,
      public.custodial_release_authority_current_column_definition('public.maintenance_ticket_outcome_history:'||a.attname)
      from pg_attribute a where a.attrelid='public.maintenance_ticket_outcome_history'::regclass and a.attnum>0 and not a.attisdropped
    union all select 300000,'column_set',r.identity,
      public.custodial_release_authority_current_column_set_definition(r.identity)
      from (values('public.maintenance_tickets'),('public.maintenance_ticket_outcome_history')) r(identity)
    union all select 400000,'relation_state','public.maintenance_ticket_outcome_history',
      public.custodial_release_authority_current_relation_state_definition('public.maintenance_ticket_outcome_history')
    union all select 500000,'constraint',c.conrelid::regclass::text||':'||c.conname,
      public.custodial_release_authority_current_constraint_definition(c.conrelid::regclass::text||':'||c.conname)
      from pg_constraint c where c.conrelid in ('public.maintenance_tickets'::regclass,'public.maintenance_ticket_outcome_history'::regclass)
        and (c.conrelid='public.maintenance_ticket_outcome_history'::regclass
          or c.conname like 'maintenance_ticket_resolution_%' or c.conname='maintenance_tickets_resolution_actor_manager_id_fkey')
    union all select 600000,'index',i.indexrelid::regclass::text,
      public.custodial_release_authority_current_index_definition(i.indexrelid::regclass::text)
      from pg_index i where i.indrelid='public.maintenance_ticket_outcome_history'::regclass
    union all select 700000,'trigger','public.maintenance_ticket_outcome_history.'||t.tgname,
      'drop trigger if exists '||quote_ident(t.tgname)||' on public.maintenance_ticket_outcome_history; '
        ||pg_get_triggerdef(t.oid,true)||'; alter table public.maintenance_ticket_outcome_history '
        ||case t.tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
        ||' trigger '||quote_ident(t.tgname)||';'
      from pg_trigger t where t.tgrelid='public.maintenance_ticket_outcome_history'::regclass and not t.tgisinternal
    union all select 850000,'view','public.v_open_maintenance_tickets',
      public.custodial_release_authority_current_view_definition('public.v_open_maintenance_tickets')
    union all select 900000,'grant',r.identity,
      public.custodial_release_authority_current_grant_definition(r.identity)
      from (values('public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)'),
        ('public.custodial_set_maintenance_ticket_outcome(uuid,text,uuid,text,text,text)'),
        ('public.custodial_manager_open_problems(uuid,integer,text)'),
        ('public.maintenance_ticket_outcome_history')) r(identity)
  loop
    if obj.definition is null then raise exception 'issue outcome recovery object missing: %',obj.identity; end if;
    update public.custodial_release_authority_restore_inventory
      set object_identity=obj.identity,
        definition_sql=obj.definition,definition_sha256=public.static_weekly_digest_text(obj.definition),
        captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity)
          else false end);
    get diagnostics changed=row_count;
    if changed>1 then raise exception 'duplicate issue recovery identity: %',obj.identity; end if;
    if changed=0 then
      select candidate into next_order
      from generate_series(obj.bucket,case when obj.bucket=1000 then 99999 else obj.bucket+99999 end) candidate
      where not exists(select 1 from public.custodial_release_authority_restore_inventory i
        where i.restore_order=candidate)
      order by candidate limit 1;
      if next_order is null then raise exception 'issue recovery bucket exhausted'; end if;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
      values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
  alter table public.custodial_release_authority_restore_inventory
    enable trigger trg_custodial_release_authority_restore_inventory_immutable;
end $recovery$;

commit;
