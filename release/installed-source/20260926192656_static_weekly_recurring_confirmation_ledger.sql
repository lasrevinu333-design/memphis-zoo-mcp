-- H03/H04 parent-transaction foundation. No HTTP confirmation/finalizer is
-- enabled by this migration. Only the future complete publication + phone
-- target path may insert its private receipt. A reservation alone cannot
-- commit. The ledger deliberately grants no generic mark-success operation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.static_weekly_recurring_confirmations (
  operation_id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.ops_manager_managers(manager_id) on delete restrict,
  confirmation_key uuid not null,
  request_json jsonb not null check(jsonb_typeof(request_json)='object'),
  request_digest text not null check(request_digest~'^[0-9a-f]{64}$'),
  effective_start date not null check(extract(isodow from effective_start)=1),
  expected_revision bigint not null check(expected_revision>=0),
  preview_digest text not null check(preview_digest~'^[0-9a-f]{64}$'),
  full_nine_source_id uuid references public.static_weekly_authority_source_documents(source_id) on delete restrict,
  owner_xid xid8 not null default pg_current_xact_id(),
  created_at timestamptz not null default statement_timestamp(),
  unique(manager_id,confirmation_key)
);
create index static_weekly_recurring_confirmations_source
  on public.static_weekly_recurring_confirmations(full_nine_source_id)
  where full_nine_source_id is not null;

create table public.static_weekly_recurring_confirmation_receipts (
  operation_id uuid primary key references public.static_weekly_recurring_confirmations(operation_id) on delete restrict,
  source_id uuid not null unique references public.static_weekly_authority_source_documents(source_id) on delete restrict,
  source_digest text not null check(source_digest~'^[0-9a-f]{64}$'),
  publication_id uuid not null unique references public.weekly_schedule_publications(publication_id) on delete restrict,
  projection_id uuid not null unique references public.weekly_schedule_compiled_projections(projection_id) on delete restrict,
  accepted_revision bigint not null unique references public.weekly_schedule_authority_revisions(authority_revision) on delete restrict,
  lunch_document_identity text not null check(lunch_document_identity~'^[0-9a-f]{64}$'),
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'),
  receipt_digest text not null check(receipt_digest~'^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default statement_timestamp()
);

alter table public.static_weekly_recurring_confirmations enable row level security;
alter table public.static_weekly_recurring_confirmations force row level security;
alter table public.static_weekly_recurring_confirmation_receipts enable row level security;
alter table public.static_weekly_recurring_confirmation_receipts force row level security;
revoke all on table public.static_weekly_recurring_confirmations,
  public.static_weekly_recurring_confirmation_receipts from public,anon,authenticated,
  service_role,static_weekly_control_plane,static_weekly_release_operator,custodial_application_reader;

create trigger trg_recurring_confirmation_immutable before update or delete
  on public.static_weekly_recurring_confirmations for each row
  execute function public.static_weekly_reject_update_delete();
create trigger trg_recurring_confirmation_receipt_immutable before update or delete
  on public.static_weekly_recurring_confirmation_receipts for each row
  execute function public.static_weekly_reject_update_delete();

create function public.static_weekly_v13_require_completed_recurring_confirmation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if new.owner_xid<>pg_current_xact_id() or not exists(
    select 1 from public.static_weekly_recurring_confirmation_receipts r
    where r.operation_id=new.operation_id) then
    raise exception using errcode='23514',message='recurring confirmation cannot commit without its complete atomic receipt';
  end if;
  return null;
end
$function$;
create constraint trigger trg_recurring_confirmation_complete
  after insert on public.static_weekly_recurring_confirmations
  deferrable initially deferred for each row
  execute function public.static_weekly_v13_require_completed_recurring_confirmation();

-- Structural receipt proof; the future private acceptance routine must also
-- bind the exact complete decision, generation and durable phone targets.
-- No runtime role can insert this table or call a receipt writer here.
create function public.static_weekly_v13_guard_recurring_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_parent public.static_weekly_recurring_confirmations%rowtype;
begin
  select * into strict v_parent from public.static_weekly_recurring_confirmations
    where operation_id=new.operation_id;
  if v_parent.owner_xid<>pg_current_xact_id()
    or new.accepted_revision<=v_parent.expected_revision
    or new.receipt_digest<>public.static_weekly_digest_jsonb(new.receipt_json)
    or new.receipt_json is distinct from jsonb_build_object(
      'schema','static-weekly.recurring-confirmation-receipt.v1',
      'operationId',new.operation_id,'managerId',v_parent.manager_id,
      'confirmationKey',v_parent.confirmation_key,'requestDigest',v_parent.request_digest,
      'previewDigest',v_parent.preview_digest,'effectiveStart',v_parent.effective_start,
      'sourceId',new.source_id,'sourceDigest',new.source_digest,
      'publicationId',new.publication_id,'projectionId',new.projection_id,
      'authorityRevision',new.accepted_revision,'lunchDocumentIdentity',new.lunch_document_identity,
      'accepted',true,'phoneDeliveryState','PENDING','affectedPhonesUpdated',false)
    or not exists(select 1 from public.weekly_schedule_publications p
      join public.weekly_schedule_versions v on v.version_id=p.version_id
      join public.static_weekly_authority_source_documents s on s.source_id=v.authority_source_id
      join public.weekly_schedule_compiled_projections x on x.publication_id=p.publication_id
        and x.version_id=v.version_id
      join public.weekly_schedule_lunch_documents l on l.projection_id=x.projection_id
      where p.publication_id=new.publication_id and x.projection_id=new.projection_id
        and p.actor_manager_id=v_parent.manager_id and x.compiled_by_manager_id=v_parent.manager_id
        and l.accepted_by_manager_id=v_parent.manager_id
        and p.effective_start=v_parent.effective_start and x.week_start=v_parent.effective_start
        and s.source_id=new.source_id and s.source_digest=new.source_digest
        and s.source_digest=public.static_weekly_digest_jsonb(s.canonical_source)
        and l.document_identity=new.lunch_document_identity
        and p.authority_revision>v_parent.expected_revision
        and p.authority_revision<=new.accepted_revision) then
    raise exception using errcode='23514',message='recurring receipt must bind its original transaction and exact accepted child artifacts';
  end if;
  return new;
end
$function$;
create trigger trg_recurring_confirmation_receipt_binding before insert
  on public.static_weekly_recurring_confirmation_receipts for each row
  execute function public.static_weekly_v13_guard_recurring_receipt();

create function public.static_weekly_v13_begin_recurring_confirmation(
  p_manager_id uuid,p_confirmation_key uuid,p_effective_start date,
  p_expected_revision bigint,p_preview_digest text,p_full_nine_source_id uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  v_request jsonb; v_digest text; v_revision bigint;
  v_parent public.static_weekly_recurring_confirmations%rowtype;
  v_receipt jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.static_weekly_v3_manager_actor(p_manager_id);
  if p_confirmation_key is null or p_effective_start is null
    or extract(isodow from p_effective_start)<>1 or not isfinite(p_effective_start)
    or p_expected_revision is null or p_expected_revision<0
    or p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
    or (p_full_nine_source_id is not null
      and p_full_nine_source_id<>'a00cdf2a-0623-5e2d-bc65-338c1dd67202'::uuid) then
    raise exception using errcode='22023',message='exact recurring confirmation request required';
  end if;
  v_request:=jsonb_build_object('schema','static-weekly.recurring-confirmation-request.v1',
    'managerId',p_manager_id,'confirmationKey',p_confirmation_key,
    'effectiveStart',p_effective_start,'expectedRevision',p_expected_revision,
    'previewDigest',p_preview_digest,'fullNineSourceId',p_full_nine_source_id);
  v_digest:=public.static_weekly_digest_jsonb(v_request);
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  -- Reread a same-key parent BEFORE time/revision staleness. A committed retry
  -- must not accidentally compile/publish against today's roster.
  select * into v_parent from public.static_weekly_recurring_confirmations
    where manager_id=p_manager_id and confirmation_key=p_confirmation_key for update;
  if found then
    if v_parent.request_digest<>v_digest or v_parent.request_json<>v_request then
      raise exception using errcode='23505',message='recurring confirmation idempotency conflict';
    end if;
    select receipt_json into v_receipt from public.static_weekly_recurring_confirmation_receipts
      where operation_id=v_parent.operation_id;
    if v_receipt is not null then
      return jsonb_build_object('state','ACCEPTED','operationId',v_parent.operation_id,'receipt',v_receipt);
    end if;
    if v_parent.owner_xid<>pg_current_xact_id() then
      raise exception using errcode='23514',message='incomplete recurring confirmation from another transaction';
    end if;
    return jsonb_build_object('state','RESERVED','operationId',v_parent.operation_id,'requestDigest',v_digest);
  end if;
  if p_effective_start<=public.sch_service_date(statement_timestamp()) then
    raise exception using errcode='23514',message='new recurring plan must start on a future zoo-local Monday';
  end if;
  select current_revision into v_revision from public.static_weekly_schedule_control where singleton for update;
  if v_revision is distinct from p_expected_revision then
    raise exception using errcode='40001',message='recurring confirmation authority revision changed';
  end if;
  insert into public.static_weekly_recurring_confirmations(manager_id,confirmation_key,
    request_json,request_digest,effective_start,expected_revision,preview_digest,full_nine_source_id)
  values(p_manager_id,p_confirmation_key,v_request,v_digest,p_effective_start,p_expected_revision,
    p_preview_digest,p_full_nine_source_id) returning * into v_parent;
  return jsonb_build_object('state','RESERVED','operationId',v_parent.operation_id,'requestDigest',v_digest);
end
$function$;

create function public.static_weekly_v13_read_recurring_confirmation(p_manager_id uuid,p_confirmation_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_parent public.static_weekly_recurring_confirmations%rowtype;v_receipt jsonb;
begin
  perform public.static_weekly_v3_assert_control_plane();
  perform public.static_weekly_v3_manager_actor(p_manager_id);
  if p_confirmation_key is null then raise exception using errcode='22023',message='exact recurring confirmation key required';end if;
  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
  select * into v_parent from public.static_weekly_recurring_confirmations
    where manager_id=p_manager_id and confirmation_key=p_confirmation_key;
  if not found then return jsonb_build_object('state','NOT_FOUND','confirmationKey',p_confirmation_key);end if;
  select receipt_json into v_receipt from public.static_weekly_recurring_confirmation_receipts
    where operation_id=v_parent.operation_id;
  if v_receipt is null then
    raise exception using errcode='23514',message='recurring confirmation has not committed a complete receipt';
  end if;
  return jsonb_build_object('state','ACCEPTED','operationId',v_parent.operation_id,'receipt',v_receipt);
end
$function$;

revoke all on function public.static_weekly_v13_require_completed_recurring_confirmation(),
  public.static_weekly_v13_guard_recurring_receipt(),
  public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid),
  public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)
  from public,anon,authenticated,service_role,static_weekly_control_plane,
    static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid),
  public.static_weekly_v13_read_recurring_confirmation(uuid,uuid) to static_weekly_control_plane;

-- Forward recovery inventory is appended below before the migration commits.
do $surface$
declare v_definition text;v_additions text;
begin
  v_definition:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
  if (length(v_definition)-length(replace(v_definition,'  values','')))/length('  values')<>1 then
    raise exception 'recurring confirmation canary surface seam changed';
  end if;
  v_additions:=$rows$
 ('relation','public.static_weekly_recurring_confirmations','atomic recurring confirmation parent receipt boundary'),
 ('relation','public.static_weekly_recurring_confirmation_receipts','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_require_completed_recurring_confirmation()','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_guard_recurring_receipt()','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_begin_recurring_confirmation(uuid,uuid,date,bigint,text,uuid)','atomic recurring confirmation parent receipt boundary'),
 ('function','public.static_weekly_v13_read_recurring_confirmation(uuid,uuid)','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmations.trg_recurring_confirmation_immutable','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmations.trg_recurring_confirmation_complete','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmation_receipts.trg_recurring_confirmation_receipt_immutable','atomic recurring confirmation parent receipt boundary'),
 ('trigger','public.static_weekly_recurring_confirmation_receipts.trg_recurring_confirmation_receipt_binding','atomic recurring confirmation parent receipt boundary'),
$rows$;
  execute replace(v_definition,'  values','  values'||E'\n'||v_additions);
end
$surface$;

alter table public.custodial_release_authority_restore_inventory
  disable trigger trg_custodial_release_authority_restore_inventory_immutable;
do $recovery$
declare obj record;next_order integer;
begin
  for obj in with relation_names(name) as (values ('public.static_weekly_recurring_confirmations'),('public.static_weekly_recurring_confirmation_receipts')),
    funcs as (select p.oid,'public.'||p.oid::regprocedure::text identity
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (starts_with(p.proname,'static_weekly_v13_')
        or p.oid='public.custodial_release_canary_authority_surface()'::regprocedure)),
    new_triggers as (select t.oid,c.relname,n.nspname,t.tgname,t.tgenabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgname in (
        'trg_recurring_confirmation_immutable',
        'trg_recurring_confirmation_receipt_immutable',
        'trg_recurring_confirmation_complete',
        'trg_recurring_confirmation_receipt_binding')),
    objects as (
      select 1000 bucket,'relation'::text kind,name identity,
        public.custodial_release_authority_current_relation_definition(name) definition from relation_names
      union all select 100000,'function',identity,pg_get_functiondef(oid) from funcs
      union all select 200000,'column',r.name||':'||a.attname,
        public.custodial_release_authority_current_column_definition(r.name||':'||a.attname)
        from relation_names r join pg_attribute a on a.attrelid=r.name::regclass and a.attnum>0 and not a.attisdropped
      union all select 300000,'column_set',name,
        public.custodial_release_authority_current_column_set_definition(name) from relation_names
      union all select 400000,'relation_state',name,
        public.custodial_release_authority_current_relation_state_definition(name) from relation_names
      union all select 500000,'constraint',r.name||':'||c.conname,
        public.custodial_release_authority_current_constraint_definition(r.name||':'||c.conname)
        from relation_names r join pg_constraint c on c.conrelid=r.name::regclass
      union all select 600000,'index','public.'||quote_ident(ci.relname),
        public.custodial_release_authority_current_index_definition('public.'||quote_ident(ci.relname))
        from relation_names r join pg_index i on i.indrelid=r.name::regclass
        join pg_class ci on ci.oid=i.indexrelid
        where not exists(select 1 from pg_constraint c where c.conindid=i.indexrelid)
      union all select 700000,'trigger',quote_ident(nspname)||'.'||quote_ident(relname)||'.'||quote_ident(tgname),
        'drop trigger if exists '||quote_ident(tgname)||' on '||quote_ident(nspname)||'.'||quote_ident(relname)||'; '
        ||pg_get_triggerdef(oid,true)||'; alter table '||quote_ident(nspname)||'.'||quote_ident(relname)||' '
        ||case tgenabled when 'O' then 'enable' when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' end
        ||' trigger '||quote_ident(tgname)||';' from new_triggers
      union all select 900000,'grant',name,
        public.custodial_release_authority_current_grant_definition(name) from relation_names
      union all select 900000,'grant',identity,
        public.custodial_release_authority_current_grant_definition(identity) from funcs
    ) select * from objects order by bucket,identity loop
    if obj.definition is null then raise exception 'missing recurring confirmation recovery object %',obj.identity;end if;
    update public.custodial_release_authority_restore_inventory set definition_sql=obj.definition,
      definition_sha256=public.static_weekly_digest_text(obj.definition),captured_at=statement_timestamp()
      where object_kind=obj.kind and (object_identity=obj.identity or
        case when obj.kind in ('function','grant') and object_identity like '%(%' and obj.identity like '%(%'
          then to_regprocedure(object_identity)=to_regprocedure(obj.identity) else false end);
    if not found then
      select coalesce(max(restore_order),obj.bucket)+1 into next_order
        from public.custodial_release_authority_restore_inventory
        where restore_order>=obj.bucket and restore_order<case when obj.bucket=1000 then 100000 else obj.bucket+100000 end;
      insert into public.custodial_release_authority_restore_inventory
        (restore_order,object_kind,object_identity,definition_sql,definition_sha256)
        values(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
    end if;
  end loop;
end
$recovery$;
alter table public.custodial_release_authority_restore_inventory
  enable trigger trg_custodial_release_authority_restore_inventory_immutable;

commit;
